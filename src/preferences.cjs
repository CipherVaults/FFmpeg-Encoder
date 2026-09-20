'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PROFILES, validateSettings } = require('./media.cjs');

const PREFERENCES_NAMESPACE = 'localpreferences-v1';
const PREFERENCES_FILE = 'preferences.json';
const MAX_PREFERENCES_BYTES = 256 * 1024;
const MAX_PATH_LENGTH = 32768;
const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => object(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function defaultPreferences() {
  return {
    inputPath: null, outputPath: null, profileId: 'h265-cpu',
    settingsByProfile: Object.fromEntries(PROFILES.map(profile => [profile.id,
      { preset: profile.defaultPreset, quality: profile.quality.default }])),
  };
}

function validPath(value) {
  // Disk paths are preferences, never IPC authority. Relative/device paths and
  // control characters have no useful remembered-folder meaning.
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH
    && !/[\u0000-\u001f]/.test(value) && path.isAbsolute(value)
    && !/^\\\\[.?]\\/.test(value);
}

function decodePreferences(record) {
  const keys = ['namespace', 'version', 'inputPath', 'outputPath', 'profileId', 'settingsByProfile'];
  if (!exactKeys(record, keys) || record.namespace !== PREFERENCES_NAMESPACE || ![1, 2].includes(record.version)
      || !object(record.settingsByProfile)
      || Object.keys(record.settingsByProfile).some(key => !PROFILES.some(profile => profile.id === key))) {
    throw new Error('Unrecognized preference schema.');
  }
  const data = defaultPreferences();
  const notices = [];
  for (const role of ['input', 'output']) {
    const key = `${role}Path`;
    if (record[key] === null || validPath(record[key])) data[key] = record[key];
    else notices.push(`The remembered ${role} location is invalid. Choose a folder again.`);
  }
  if (PROFILES.some(profile => profile.id === record.profileId)) data.profileId = record.profileId;
  else notices.push('The remembered profile is invalid. H265 · CPU Tested Default is selected.');
  for (const profile of PROFILES) {
    const value = record.settingsByProfile[profile.id];
    try {
      const recipe = record.version === 2 && value && Object.hasOwn(value, 'recipeId') ? { recipeId: value.recipeId } : {};
      if (!exactKeys(value, ['preset', 'quality', ...Object.keys(recipe)])) throw new Error('Invalid profile settings.');
      const settings = validateSettings({ profileId: profile.id, preset: value.preset, quality: value.quality, ...recipe });
      const { profileId, ...saved } = settings;
      data.settingsByProfile[profile.id] = saved;
    } catch {
      notices.push(`${profile.label}: invalid or missing remembered settings; using Tested Default (${profile.defaultPreset} / ${profile.quality.mode} ${profile.quality.default}).`);
    }
  }
  return { data, notices };
}

class Preferences {
  #loaded;
  #pending = Promise.resolve();
  #data = defaultPreferences();
  #notices = [];
  #readOnly = false;

  constructor({ directory }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Preferences require an absolute app-owned directory.');
    this.directory = path.join(directory, PREFERENCES_NAMESPACE);
    this.filename = path.join(this.directory, PREFERENCES_FILE);
  }

  snapshot() { return structuredClone({ ...this.#data, notices: this.#notices }); }

  #notice(message) { if (!this.#notices.includes(message)) this.#notices.push(message); }

  async #ensureDirectory(create = false) {
    let stat;
    try { stat = await fs.lstat(this.directory); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(this.directory, { recursive: true });
      stat = await fs.lstat(this.directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Preference namespace must be an ordinary app-owned directory.');
  }

  async #read() {
    await this.#ensureDirectory();
    const before = await fs.lstat(this.filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_PREFERENCES_BYTES) throw new Error('Invalid preference file.');
    const handle = await fs.open(this.filename, 'r');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
          || opened.size > MAX_PREFERENCES_BYTES) throw new Error('Preference file changed.');
      const buffer = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        throw new Error('Preference file changed during reading.');
      }
      return JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally { await handle.close(); }
  }

  load() {
    // One load per process. Re-reading preferences must not replace live manual
    // settings or create a second set of folder authority tokens.
    this.#loaded ||= (async () => {
      try {
        const decoded = decodePreferences(await this.#read());
        this.#data = decoded.data;
        this.#notices = decoded.notices;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.#readOnly = true;
          this.#notice('Remembered preferences could not be read or use an unknown schema. They are preserved; changes apply this session only until Forget remembered locations/settings is used.');
        }
      }
      return this.snapshot();
    })();
    return this.#loaded.then(() => this.snapshot());
  }

  async #write() {
    if (this.#readOnly) return;
    // Version 2 prevents older builds from silently dropping compound settings.
    // They preserve an unknown schema; this reader still accepts ordinary v1.
    const version = Object.values(this.#data.settingsByProfile).some(settings => settings.recipeId) ? 2 : 1;
    const record = { namespace: PREFERENCES_NAMESPACE, version, ...this.#data };
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized) > MAX_PREFERENCES_BYTES) throw new Error('Preferences exceed the bounded storage limit.');
    await this.#ensureDirectory(true);
    // Never overwrite a replacement with an unknown version even if another
    // application changed it after our initial load.
    try { decodePreferences(await this.#read()); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        this.#readOnly = true;
        this.#notice('Stored preferences changed or became unreadable. They are preserved; changes apply this session only until Forget remembered locations/settings is used.');
        return;
      }
    }
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.#ensureDirectory();
      await fs.rename(temporary, this.filename);
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  #change(mutate) {
    const pending = this.#pending.then(async () => {
      await this.load();
      mutate(this.#data);
      try { await this.#write(); }
      catch { this.#notice('Preferences could not be saved. The current choices remain usable for this session.'); }
      return this.snapshot();
    });
    this.#pending = pending.then(() => undefined, () => undefined);
    return pending;
  }

  rememberFolder(role, canonicalPath) {
    if (!['input', 'output'].includes(role) || !validPath(canonicalPath)) throw new TypeError('A validated folder role and absolute path are required.');
    return this.#change(data => { data[`${role}Path`] = canonicalPath; });
  }

  saveSettings(request) {
    const settings = validateSettings(request);
    return this.#change(data => {
      data.profileId = settings.profileId;
      const { profileId, ...saved } = settings;
      data.settingsByProfile[settings.profileId] = saved;
    });
  }

  resetProfile(profileId) {
    const profile = PROFILES.find(entry => entry.id === profileId);
    if (!profile) throw Object.assign(new Error('Choose a supported encoding profile.'), { code: 'INVALID_SETTINGS' });
    return this.saveSettings({ profileId, preset: profile.defaultPreset, quality: profile.quality.default });
  }

  forget() {
    const pending = this.#pending.then(async () => {
      await this.load();
      // Only this exact preferences file is forgotten. No paths from its
      // contents, cache entries, provenance records or media are ever deleted.
      try {
        await this.#ensureDirectory();
        const stat = await fs.lstat(this.filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Preference file must be an ordinary file.');
        await fs.unlink(this.filename);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.#data = defaultPreferences();
      this.#notices = [];
      this.#readOnly = false;
      return this.snapshot();
    });
    this.#pending = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

module.exports = { Preferences, defaultPreferences, decodePreferences, PREFERENCES_NAMESPACE, PREFERENCES_FILE, MAX_PREFERENCES_BYTES };
