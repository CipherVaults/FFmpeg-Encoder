'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { types } = require('node:util');
const { validateVendorSettings } = require('./vendor-profiles.cjs');

const VENDOR_PREFERENCES_NAMESPACE = 'vendorpreferences-v1';
const VENDOR_PREFERENCES_FILE = 'vendor-preferences.json';
const MAX_BYTES = 256 * 1024;
function dataRecord(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === keys.length && keys.every(key => Object.hasOwn(fields, key)
    && fields[key].enumerable && Object.hasOwn(fields[key], 'value'));
}
function decodeVendorPreferences(record) {
  if (!dataRecord(record, ['namespace', 'version', 'settingsByProfile'])
      || record.namespace !== VENDOR_PREFERENCES_NAMESPACE || record.version !== 1) throw new Error('Unrecognized vendor preference schema.');
  const values = record.settingsByProfile;
  if (types.isProxy(values) || !values || !dataRecord(values, Object.keys(values))) throw new Error('Invalid vendor settings map.');
  const settingsByProfile = {};
  for (const [profileId, value] of Object.entries(values)) {
    if (!dataRecord(value, ['preset', 'quality'])) throw new Error('Invalid vendor settings record.');
    const settings = validateVendorSettings({ profileId, preset: value.preset, quality: value.quality });
    settingsByProfile[profileId] = { preset: settings.preset, quality: settings.quality };
  }
  return { settingsByProfile };
}

// Independent storage keeps accepted 0.6's main-file schema intact. The same
// owned-file, bounded read and atomic replacement rules apply as Preferences.
class VendorPreferences {
  #loaded;
  #pending = Promise.resolve();
  #data = { settingsByProfile: {} };
  #notices = [];
  #readOnly = false;
  constructor({ directory }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Vendor preferences require an absolute app-owned directory.');
    this.directory = path.join(directory, VENDOR_PREFERENCES_NAMESPACE);
    this.filename = path.join(this.directory, VENDOR_PREFERENCES_FILE);
  }
  snapshot() { return structuredClone({ ...this.#data, notices: this.#notices }); }
  #notice() {
    const message = 'Vendor preferences could not be read or saved. Stored data is preserved; current choices apply this session only.';
    if (!this.#notices.includes(message)) this.#notices.push(message);
  }
  async #ensureDirectory(create = false) {
    let stat;
    try { stat = await fs.lstat(this.directory); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(this.directory, { recursive: true }); stat = await fs.lstat(this.directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Vendor preference namespace must be an ordinary directory.');
  }
  async #read() {
    await this.#ensureDirectory();
    const before = await fs.lstat(this.filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_BYTES) throw new Error('Invalid vendor preference file.');
    const handle = await fs.open(this.filename, 'r');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
          || opened.size > MAX_BYTES) throw new Error('Vendor preference file changed.');
      const buffer = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        throw new Error('Vendor preference file changed during reading.');
      }
      return JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally { await handle.close(); }
  }
  load() {
    this.#loaded ||= (async () => {
      try { this.#data = decodeVendorPreferences(await this.#read()); }
      catch (error) { if (error.code !== 'ENOENT') { this.#readOnly = true; this.#notice(); } }
    })();
    return this.#loaded.then(() => this.snapshot());
  }
  async #write() {
    if (this.#readOnly) return;
    const serialized = JSON.stringify({ namespace: VENDOR_PREFERENCES_NAMESPACE, version: 1, ...this.#data });
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new Error('Vendor preferences exceed the storage bound.');
    await this.#ensureDirectory(true);
    try { decodeVendorPreferences(await this.#read()); }
    catch (error) { if (error.code !== 'ENOENT') { this.#readOnly = true; this.#notice(); return; } }
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx');
      await handle.writeFile(serialized, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await this.#ensureDirectory();
      await fs.rename(temporary, this.filename);
    } finally {
      await handle?.close().catch(() => {});
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  saveSettings(request) {
    const settings = validateVendorSettings(request);
    const pending = this.#pending.then(async () => {
      await this.load();
      this.#data.settingsByProfile[settings.profileId] = { preset: settings.preset, quality: settings.quality };
      try { await this.#write(); } catch { this.#notice(); }
      return this.snapshot();
    });
    this.#pending = pending.then(() => undefined, () => undefined);
    return pending;
  }
  forget() {
    const pending = this.#pending.then(async () => {
      await this.load();
      try {
        await this.#ensureDirectory();
        const stat = await fs.lstat(this.filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Vendor preference file must be an ordinary file.');
        await fs.unlink(this.filename);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.#data = { settingsByProfile: {} }; this.#notices = []; this.#readOnly = false;
      return this.snapshot();
    });
    this.#pending = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

module.exports = { VendorPreferences, decodeVendorPreferences, VENDOR_PREFERENCES_NAMESPACE, VENDOR_PREFERENCES_FILE };
