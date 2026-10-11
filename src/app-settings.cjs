'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const APP_SETTINGS_NAMESPACE = 'appsettings-v1';
const APP_SETTINGS_FILE = 'settings.json';
const MAX_APP_SETTINGS_BYTES = 16 * 1024;
const MAX_ARCHIVE_RECOVERY_ENTRIES = 256;
const ARCHIVE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/;
const FIELDS = Object.freeze({
  fullAudioPolicy: ['copy', 'precision-aac', 'precision-flac'],
  rangeAudioPolicy: ['precision-aac', 'precision-flac', 'copy'],
  resolution: ['source', '2160', '1440', '1080', '720'],
  hdrPolicy: ['preserve', 'sdr'],
  remuxTarget: ['matroska', 'mp4', 'mov'],
  previewExpanded: null,
});
const STAMP_FIELDS = ['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs'];
// Each application owns one store. Serialize instances in this process too so
// a second consumer cannot race another consumer's optimistic revision check.
const pendingByFile = new Map();

function fail(code, message, cause) {
  return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable);
}

function revisionOf(value) { return Number.isSafeInteger(value) && value >= 0; }

function defaultAppSettings() {
  return { fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-aac', resolution: 'source',
    hdrPolicy: 'preserve', remuxTarget: 'matroska', previewExpanded: false };
}

function validateDefaults(value) {
  if (!exactObject(value, Object.keys(FIELDS)) || Object.entries(FIELDS).some(([key, values]) =>
    values ? !values.includes(value[key]) : typeof value[key] !== 'boolean')) {
    throw fail('INVALID_APP_SETTINGS', 'App Settings require the exact supported default fields and values.');
  }
  return { ...value };
}

function decode(record) {
  if (!exactObject(record, ['namespace', 'schema', 'revision', 'defaults'])
    || record.namespace !== APP_SETTINGS_NAMESPACE || record.schema !== 1 || !revisionOf(record.revision)) {
    throw fail('APP_SETTINGS_SCHEMA', 'Stored App Settings use an invalid or unknown schema.');
  }
  return { revision: record.revision, defaults: validateDefaults(record.defaults) };
}

const reliable = stat => stat.dev !== 0n && stat.ino !== 0n;
const sameObject = (a, b) => a && b && reliable(a) && reliable(b)
  && ['dev', 'ino', 'birthtimeNs'].every(key => a[key] === b[key]);
const sameStamp = (a, b) => sameObject(a, b) && STAMP_FIELDS.every(key => a[key] === b[key]) && a.nlink === b.nlink;
const sameContentStamp = (a, b) => sameObject(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs;
const sameObservation = (a, b) => a && b && (a.missing || b.missing
  ? a.missing === b.missing
  : sameStamp(a.stat, b.stat) && (a.bytes === null ? b.bytes === null : b.bytes !== null && a.bytes.equals(b.bytes)));

class AppSettings {
  #loaded;
  #rootIdentity;
  #directoryIdentity;
  #baseline;
  #revision = 0;
  #defaults = defaultAppSettings();
  #notices = [];
  #persistence = { state: 'unloaded', persisted: false, resetRequired: false };

  constructor({ directory }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\u0000-\u001f]/.test(directory)
      || /^\\\\[.?]\\/.test(directory)) throw new TypeError('AppSettings require an absolute app-owned directory.');
    Object.defineProperties(this, {
      rootDirectory: { value: path.resolve(directory), enumerable: true },
      directory: { value: path.join(path.resolve(directory), APP_SETTINGS_NAMESPACE), enumerable: true },
      filename: { value: path.join(path.resolve(directory), APP_SETTINGS_NAMESPACE, APP_SETTINGS_FILE), enumerable: true },
    });
  }

  snapshot() {
    // Defaults describe future drafts only; no folders, prepared plans, source
    // grants or execution choices can be persisted through this schema.
    return structuredClone({ schema: 1, revision: this.#revision, defaults: this.#defaults,
      notices: this.#notices, persistence: this.#persistence });
  }

  #notice(message) { if (!this.#notices.includes(message)) this.#notices.push(message); }

  async #ordinaryDirectory(directory, create, expected) {
    let stat;
    try { stat = await fs.lstat(directory, { bigint: true }); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create || expected) throw error;
      await fs.mkdir(directory, { recursive: true });
      stat = await fs.lstat(directory, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat)
      || (expected && (!sameObject(expected.stat, stat) || expected.canonical !== await fs.realpath(directory)))) {
      throw fail('APP_SETTINGS_UNSAFE_PATH', 'App Settings require unchanged ordinary app-owned directories.');
    }
    return { stat, canonical: await fs.realpath(directory) };
  }

  async #ensureDirectory(create = false) {
    this.#rootIdentity = await this.#ordinaryDirectory(this.rootDirectory, create, this.#rootIdentity);
    this.#directoryIdentity = await this.#ordinaryDirectory(this.directory, create, this.#directoryIdentity);
  }

  async #observe({ permittedLinks = 1 } = {}) {
    try { await this.#ensureDirectory(); }
    catch (error) {
      if (error.code === 'ENOENT' && !this.#directoryIdentity) return { missing: true };
      throw error;
    }
    let before;
    try { before = await fs.lstat(this.filename, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return { missing: true }; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || !reliable(before) || before.nlink !== BigInt(permittedLinks)) {
      throw fail('APP_SETTINGS_UNSAFE_FILE', 'Stored App Settings must be an ordinary file with no unrelated links.');
    }
    // Reset may archive an oversized file by exclusive hard link, never by
    // loading or copying an unbounded corrupt file into memory.
    if (before.size > BigInt(MAX_APP_SETTINGS_BYTES)) return { stat: before, bytes: null };
    const handle = await fs.open(this.filename, 'r');
    try {
      const opened = await handle.stat({ bigint: true });
      if (!sameStamp(before, opened)) throw fail('APP_SETTINGS_CHANGED', 'Stored App Settings changed while opening.');
      const buffer = Buffer.alloc(Number(opened.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const named = await fs.lstat(this.filename, { bigint: true });
      await this.#ensureDirectory();
      if (length !== Number(opened.size) || !sameStamp(opened, after) || !sameStamp(after, named)) {
        throw fail('APP_SETTINGS_CHANGED', 'Stored App Settings changed while reading.');
      }
      return { stat: after, bytes: buffer.subarray(0, length) };
    } finally { await handle.close(); }
  }

  #readOnly(message) {
    this.#persistence = { state: 'reset-required', persisted: false, resetRequired: true };
    this.#notice(message);
  }

  load() {
    this.#loaded ||= (async () => {
      try {
        this.#baseline = await this.#observe();
        if (!this.#baseline.missing) {
          if (this.#baseline.bytes === null) throw fail('APP_SETTINGS_TOO_LARGE', 'Stored App Settings exceed the bounded size limit.');
          const decoded = decode(JSON.parse(this.#baseline.bytes.toString('utf8')));
          this.#revision = decoded.revision;
          this.#defaults = decoded.defaults;
        }
        this.#persistence = { state: 'ready', persisted: !this.#baseline.missing, resetRequired: false };
      } catch {
        this.#readOnly('Stored App Settings could not be read or use an unknown schema. They are preserved. Reset explicitly to archive them and restore defaults.');
      }
    })();
    return this.#loaded.then(() => this.snapshot());
  }

  #queue(operation) {
    const previous = pendingByFile.get(this.filename) || Promise.resolve();
    const pending = previous.then(operation);
    const idle = pending.then(() => undefined, () => undefined);
    pendingByFile.set(this.filename, idle);
    void idle.then(() => { if (pendingByFile.get(this.filename) === idle) pendingByFile.delete(this.filename); });
    return pending;
  }

  #checkRevision(revision) {
    if (revision !== this.#revision) throw fail('APP_SETTINGS_REVISION_CONFLICT', 'App Settings changed. Review the current defaults before saving again.');
    if (revision >= Number.MAX_SAFE_INTEGER) throw fail('APP_SETTINGS_REVISION_EXHAUSTED', 'App Settings revision cannot be advanced safely.');
  }

  async #checkBaseline(options) {
    const actual = await this.#observe(options);
    if (!sameObservation(this.#baseline, actual)) {
      // Keep the newly observed bytes for a subsequent *explicit* reset, while
      // invalidating requests from the older view. Never silently adopt outside
      // defaults or overwrite them merely because their schema is recognized.
      this.#baseline = actual;
      if (this.#revision < Number.MAX_SAFE_INTEGER) this.#revision++;
      this.#readOnly('Stored App Settings changed outside this view. They are preserved; reopen the application to review them or explicitly reset.');
      throw fail('APP_SETTINGS_REVISION_CONFLICT', 'Stored App Settings changed outside this view. No file was overwritten.');
    }
    return actual;
  }

  async #archive(current, retainTransaction) {
    const directory = path.join(this.directory, 'archives');
    const bound = await this.#ordinaryDirectory(directory, true);
    const file = path.join(directory, `${randomUUID()}.json`);
    // Retain the transaction before any fallible post-link observation. A
    // thrown stat/guard must not hide the newly created owned link from cleanup.
    const transaction = { file, directory, bound, originalStat: current.stat, created: false, stat: null };
    retainTransaction(transaction);
    await fs.link(this.filename, file); // exclusive; never overwrite an archive
    transaction.created = true;
    const archived = await fs.lstat(file, { bigint: true });
    const named = await fs.lstat(this.filename, { bigint: true });
    await this.#ordinaryDirectory(directory, false, bound);
    if (!sameContentStamp(current.stat, archived) || !sameStamp(archived, named) || named.nlink !== 2n) {
      throw fail('APP_SETTINGS_ARCHIVE_UNCERTAIN', 'The settings archive changed during reset; all files were preserved.');
    }
    Object.assign(transaction, { stat: archived, observation: { ...current, stat: named } });
    return transaction;
  }

  async #existingArchiveForReset() {
    // Automatic load/save still refuses linked settings. Only an explicit
    // reset may finish a previously interrupted reset, preserving the existing
    // archive. Account for both links; an unrelated/outside link never qualifies.
    let named;
    try { named = await fs.lstat(this.filename, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!named.isFile() || named.isSymbolicLink() || !reliable(named) || named.nlink !== 2n) return null;
    const directory = path.join(this.directory, 'archives');
    let bound;
    try { bound = await this.#ordinaryDirectory(directory, false); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let match = null, count = 0;
    const entries = await fs.opendir(directory);
    for await (const entry of entries) {
      if (++count > MAX_ARCHIVE_RECOVERY_ENTRIES) throw fail('APP_SETTINGS_ARCHIVE_UNCERTAIN', 'Reset recovery exceeds its bounded archive inspection. All files were preserved.');
      if (!ARCHIVE_NAME.test(entry.name)) continue;
      const file = path.join(directory, entry.name), stat = await fs.lstat(file, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || !sameStamp(named, stat)) continue;
      if (match) throw fail('APP_SETTINGS_ARCHIVE_UNCERTAIN', 'Reset archive identity is ambiguous. All files were preserved.');
      match = { file, directory, bound, originalStat: named, created: false, stat };
    }
    if (!match) return null;
    await this.#ordinaryDirectory(directory, false, bound);
    const current = await this.#observe({ permittedLinks: 2 });
    const archived = await fs.lstat(match.file, { bigint: true });
    if (current.missing || !sameStamp(named, current.stat) || !sameStamp(current.stat, archived)) {
      throw fail('APP_SETTINGS_ARCHIVE_UNCERTAIN', 'Reset recovery identity changed. All files were preserved.');
    }
    if (this.#baseline && (this.#baseline.missing || !sameContentStamp(this.#baseline.stat, current.stat)
      || (this.#baseline.bytes === null ? current.bytes !== null : current.bytes === null || !this.#baseline.bytes.equals(current.bytes)))) {
      throw fail('APP_SETTINGS_CHANGED', 'Settings content changed after the interrupted reset. Reopen to review it; all files were preserved.');
    }
    // A failed initial load has no baseline; explicit reset is the authorization
    // to replace this settings name after its old bytes are positively archived.
    this.#baseline = current;
    match.observation = current;
    return match;
  }

  async #write(defaults, revision, reset) {
    await this.#ensureDirectory(true);
    let archive = reset ? await this.#existingArchiveForReset() : null;
    let current = await this.#checkBaseline({ permittedLinks: archive ? 2 : 1 });
    const serialized = JSON.stringify({ namespace: APP_SETTINGS_NAMESPACE, schema: 1, revision, defaults });
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    let handle, temporaryIdentity, renamed = false;
    try {
      handle = await fs.open(temporary, 'wx');
      temporaryIdentity = await handle.stat({ bigint: true });
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      temporaryIdentity = await handle.stat({ bigint: true });
      await handle.close(); handle = null;
      current = await this.#checkBaseline({ permittedLinks: archive ? 2 : 1 });
      if (reset && !current.missing && !archive) {
        archive = await this.#archive(current, transaction => { archive = transaction; });
        current = archive.observation;
      }
      const beforeCommit = await this.#observe({ permittedLinks: archive ? 2 : 1 });
      if (!sameObservation(current, beforeCommit)) throw fail('APP_SETTINGS_CHANGED', 'Stored App Settings changed before commit.');
      if (archive) {
        await this.#ordinaryDirectory(archive.directory, false, archive.bound);
        if (!sameStamp(archive.stat, await fs.lstat(archive.file, { bigint: true }))) {
          throw fail('APP_SETTINGS_ARCHIVE_UNCERTAIN', 'The bound reset archive changed before commit. All files were preserved.');
        }
      }
      const staged = await fs.lstat(temporary, { bigint: true });
      if (!staged.isFile() || staged.isSymbolicLink() || staged.nlink !== 1n || !sameStamp(temporaryIdentity, staged)) {
        throw fail('APP_SETTINGS_CHANGED', 'The temporary App Settings file changed before commit.');
      }
      await fs.rename(temporary, this.filename);
      renamed = true;
      // Successful rename is the durable commit. Observe it before granting the
      // caller a new revision; an uncertain observation is never reported saved.
      const committed = await this.#observe();
      if (committed.missing || !sameContentStamp(temporaryIdentity, committed.stat) || committed.bytes?.toString('utf8') !== serialized) {
        throw fail('APP_SETTINGS_WRITE_UNCERTAIN', 'App Settings may have been saved but their committed identity could not be verified.');
      }
      this.#baseline = committed;
    } catch (error) {
      if (renamed) {
        this.#readOnly('App Settings may have been saved, but the committed file could not be confirmed. Reopen to review it; no uncertain file was removed.');
      }
      // A failed reset must not strand an ordinary original behind a second
      // link. Remove only our exact archive when the original still matches it.
      // Any uncertain identity instead preserves both names for review.
      if (archive) {
        let removed = false;
        try {
          await this.#ordinaryDirectory(archive.directory, false, archive.bound);
          const named = await fs.lstat(this.filename, { bigint: true });
          const archived = await fs.lstat(archive.file, { bigint: true });
          if (archive.created && sameContentStamp(archive.originalStat, archived)
            && (!archive.stat || sameStamp(archive.stat, archived)) && sameStamp(archived, named) && named.nlink === 2n) {
            await fs.unlink(archive.file);
            this.#baseline = await this.#observe();
            removed = true;
          }
        } catch { /* Failed identity observations preserve both names. */ }
        if (!removed && !renamed) this.#readOnly('A reset archive was retained after an interrupted write. No uncertain file was removed. Reset explicitly to recover once its identity can be confirmed.');
      }
      throw error;
    } finally {
      await handle?.close().catch(() => {});
      if (temporaryIdentity) {
        try {
          await this.#ensureDirectory();
          const named = await fs.lstat(temporary, { bigint: true });
          if (named.isFile() && !named.isSymbolicLink() && sameObject(temporaryIdentity, named)) await fs.unlink(temporary);
        } catch { /* Unknown/replaced temporary objects are deliberately retained. */ }
      }
    }
  }

  #change(revision, defaults, reset) {
    return this.#queue(async () => {
      await this.load();
      this.#checkRevision(revision);
      if (!reset && this.#persistence.resetRequired) throw fail('APP_SETTINGS_RESET_REQUIRED', 'Stored App Settings are preserved. Reset explicitly before saving new defaults.');
      try { await this.#write(defaults, revision + 1, reset); }
      catch (error) {
        this.#persistence = { ...this.#persistence, persisted: false,
          state: this.#persistence.resetRequired ? 'reset-required' : 'write-failed' };
        this.#notice('App Settings were not confirmed saved. Previous in-memory defaults and revision remain unchanged.');
        throw error;
      }
      this.#defaults = defaults;
      this.#revision = revision + 1;
      this.#notices = reset ? ['Previous stored App Settings, if present, were archived. Defaults apply to new batches only.'] : [];
      this.#persistence = { state: 'ready', persisted: true, resetRequired: false };
      return this.snapshot();
    });
  }

  save(request) {
    if (!exactObject(request, ['revision', 'defaults']) || !revisionOf(request.revision)) {
      throw fail('INVALID_APP_SETTINGS', 'Save requires the current revision and exact default settings.');
    }
    return this.#change(request.revision, validateDefaults(request.defaults), false);
  }

  reset(request) {
    if (!exactObject(request, ['revision']) || !revisionOf(request.revision)) {
      throw fail('INVALID_APP_SETTINGS', 'Reset requires the current App Settings revision.');
    }
    return this.#change(request.revision, defaultAppSettings(), true);
  }
}

module.exports = { AppSettings, defaultAppSettings, APP_SETTINGS_NAMESPACE, APP_SETTINGS_FILE, MAX_APP_SETTINGS_BYTES };
