'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const APPEARANCE_NAMESPACE = 'appearance-v1';
const APPEARANCE_FILE = 'settings.json';
const MAX_APPEARANCE_BYTES = 16 * 1024;
const MAX_PENDING_APPEARANCE_WRITES = 8;
const STAMP_FIELDS = ['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs'];
const pendingByFile = new Map();
const fail = (code, message) => Object.assign(new Error(message), { code });

function exactData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable);
}

function validateTheme(request) {
  if (!exactData(request, ['theme']) || !['dark', 'light'].includes(request.theme)) {
    throw fail('INVALID_APPEARANCE', 'Appearance requires exactly one supported theme: dark or light.');
  }
  return request.theme;
}

function decode(record) {
  if (!exactData(record, ['namespace', 'schema', 'theme'])
    || record.namespace !== APPEARANCE_NAMESPACE || record.schema !== 1) {
    throw fail('APPEARANCE_SCHEMA', 'Stored appearance uses an invalid or unknown schema.');
  }
  return validateTheme({ theme: record.theme });
}

const reliable = stat => stat.dev !== 0n && stat.ino !== 0n;
const sameObject = (a, b) => a && b && reliable(a) && reliable(b)
  && ['dev', 'ino', 'birthtimeNs'].every(key => a[key] === b[key]);
const sameStamp = (a, b) => sameObject(a, b)
  && STAMP_FIELDS.every(key => a[key] === b[key]) && a.nlink === b.nlink;
const sameContentStamp = (a, b) => sameObject(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs;
const sameObservation = (a, b) => a && b && (a.missing || b.missing
  ? a.missing === b.missing
  : sameStamp(a.stat, b.stat) && (a.bytes === null ? b.bytes === null : b.bytes !== null && a.bytes.equals(b.bytes)));

// Appearance is an additive app-owned preference. It never reads processing
// defaults, profile recipes, folder grants, browser storage or media paths.
class AppearanceSettings {
  #loaded;
  #rootIdentity;
  #directoryIdentity;
  #baseline;
  #theme = 'dark';
  #invalid = false;
  #blocked = false;
  #notices = [];
  #persistence = { state: 'default', persisted: false };
  #accepted = new Set();
  #admissionClosed = false;

  constructor({ directory }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)
      || /[\u0000-\u001f]/.test(directory) || /^\\\\[.?]\\/.test(directory)) {
      throw new TypeError('AppearanceSettings requires an absolute app-owned directory.');
    }
    Object.defineProperties(this, {
      rootDirectory: { value: path.resolve(directory), enumerable: true },
      directory: { value: path.join(path.resolve(directory), APPEARANCE_NAMESPACE), enumerable: true },
      filename: { value: path.join(path.resolve(directory), APPEARANCE_NAMESPACE, APPEARANCE_FILE), enumerable: true },
    });
  }

  snapshot() {
    return structuredClone({ schema: 1, theme: this.#theme,
      persistence: this.#persistence, notices: this.#notices });
  }

  #notice(message) { if (!this.#notices.includes(message)) this.#notices.push(message); }

  async #ordinaryDirectory(directory, create, expected) {
    let stat;
    try { stat = await fs.lstat(directory, { bigint: true }); }
    catch (error) {
      if (error.code === 'ENOENT' && expected) {
        throw fail('APPEARANCE_CHANGED', 'An appearance directory disappeared or was replaced. Reopen to review it.');
      }
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(directory, { recursive: directory === this.rootDirectory });
      stat = await fs.lstat(directory, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat)
      || (expected && (!sameObject(expected.stat, stat) || expected.canonical !== await fs.realpath(directory)))) {
      throw fail('APPEARANCE_UNSAFE_PATH', 'Appearance requires unchanged ordinary app-owned directories.');
    }
    return { stat, canonical: await fs.realpath(directory) };
  }

  async #ensureDirectory(create = false) {
    this.#rootIdentity = await this.#ordinaryDirectory(this.rootDirectory, create, this.#rootIdentity);
    this.#directoryIdentity = await this.#ordinaryDirectory(this.directory, create, this.#directoryIdentity);
  }

  async #observe({ permittedLinks = 1 } = {}) {
    try { await this.#ensureDirectory(); }
    catch (error) { if (error.code === 'ENOENT') return { missing: true }; throw error; }
    let before;
    try { before = await fs.lstat(this.filename, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return { missing: true }; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || !reliable(before) || before.nlink !== BigInt(permittedLinks)) {
      throw fail('APPEARANCE_UNSAFE_FILE', 'Stored appearance must be an ordinary file without unrelated links.');
    }
    // An oversized original can be archived by exclusive hard link without
    // loading an unbounded file or guessing at its contents.
    if (before.size > BigInt(MAX_APPEARANCE_BYTES)) return { stat: before, bytes: null };
    const handle = await fs.open(this.filename, 'r');
    try {
      const opened = await handle.stat({ bigint: true });
      if (!sameStamp(before, opened)) throw fail('APPEARANCE_CHANGED', 'Stored appearance changed while opening.');
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
        throw fail('APPEARANCE_CHANGED', 'Stored appearance changed while reading.');
      }
      return { stat: after, bytes: buffer.subarray(0, length) };
    } finally { await handle.close(); }
  }

  load() {
    this.#loaded ||= (async () => {
      try {
        this.#baseline = await this.#observe();
      } catch {
        this.#blocked = true;
        this.#persistence = { state: 'unavailable', persisted: false };
        this.#notice('Stored appearance could not be safely read. Dark is used; no stored file was changed. Reopen to review it before saving.');
        return;
      }
      if (this.#baseline.missing) return;
      try {
        if (this.#baseline.bytes === null) throw fail('APPEARANCE_TOO_LARGE', 'Stored appearance exceeds its size limit.');
        this.#theme = decode(JSON.parse(this.#baseline.bytes.toString('utf8')));
        this.#persistence = { state: 'saved', persisted: true };
      } catch {
        this.#invalid = true;
        this.#persistence = { state: 'invalid', persisted: false };
        this.#notice('Stored appearance is invalid or uses an unknown schema. Dark is used and the original is preserved. Choosing a theme explicitly will archive the original before saving.');
      }
    })();
    return this.#loaded.then(() => this.snapshot());
  }

  async #checkBaseline(options) {
    const actual = await this.#observe(options);
    if (!sameObservation(this.#baseline, actual)) {
      this.#blocked = true;
      this.#notice('Stored appearance changed outside this view. No replacement was authorized; reopen to review it before saving.');
      throw fail('APPEARANCE_CHANGED', 'Stored appearance changed outside this view. No file was overwritten.');
    }
    return actual;
  }

  async #write(theme) {
    await this.#ensureDirectory(true);
    let current = await this.#checkBaseline();
    const serialized = JSON.stringify({ namespace: APPEARANCE_NAMESPACE, schema: 1, theme });
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    let handle, temporaryIdentity, archive, renamed = false;
    try {
      handle = await fs.open(temporary, 'wx');
      temporaryIdentity = await handle.stat({ bigint: true });
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      temporaryIdentity = await handle.stat({ bigint: true });
      await handle.close(); handle = null;
      current = await this.#checkBaseline();
      if (this.#invalid && !current.missing) {
        const directory = path.join(this.directory, 'archives');
        const bound = await this.#ordinaryDirectory(directory, true);
        archive = { directory, bound, file: path.join(directory, `${randomUUID()}.json`),
          originalStat: current.stat, created: false, stat: null };
        await fs.link(this.filename, archive.file); // exclusive; archives are never overwritten
        archive.created = true;
        const archived = await fs.lstat(archive.file, { bigint: true });
        const observed = await this.#observe({ permittedLinks: 2 });
        await this.#ordinaryDirectory(directory, false, bound);
        if (observed.missing || !sameContentStamp(current.stat, archived) || !sameStamp(archived, observed.stat)
          || (current.bytes === null ? observed.bytes !== null : observed.bytes === null || !current.bytes.equals(observed.bytes))) {
          throw fail('APPEARANCE_ARCHIVE_UNCERTAIN', 'Original appearance archive could not be confirmed. All files were preserved.');
        }
        archive.stat = archived;
        current = observed;
      }
      const beforeCommit = await this.#observe({ permittedLinks: archive ? 2 : 1 });
      if (!sameObservation(current, beforeCommit)) {
        this.#blocked = true;
        throw fail('APPEARANCE_CHANGED', 'Stored appearance changed before saving.');
      }
      if (archive) {
        await this.#ordinaryDirectory(archive.directory, false, archive.bound);
        if (!sameStamp(archive.stat, await fs.lstat(archive.file, { bigint: true }))) {
          throw fail('APPEARANCE_ARCHIVE_UNCERTAIN', 'Original appearance archive changed before saving. All files were preserved.');
        }
      }
      const staged = await fs.lstat(temporary, { bigint: true });
      if (!staged.isFile() || staged.isSymbolicLink() || staged.nlink !== 1n || !sameStamp(temporaryIdentity, staged)) {
        throw fail('APPEARANCE_CHANGED', 'Temporary appearance changed before saving.');
      }
      await fs.rename(temporary, this.filename);
      renamed = true;
      // A write is saved only after both syncing its bytes and verifying the
      // identity/content published at the exact app-owned destination.
      const committed = await this.#observe();
      if (committed.missing || !sameContentStamp(temporaryIdentity, committed.stat)
        || committed.bytes?.toString('utf8') !== serialized) {
        throw fail('APPEARANCE_WRITE_UNCERTAIN', 'Appearance may have been saved but its committed file could not be confirmed.');
      }
      this.#baseline = committed;
    } catch (error) {
      if (renamed) {
        this.#blocked = true;
        this.#notice('Appearance may have been saved, but its committed file could not be confirmed. Reopen to review it; no uncertain file was removed.');
      } else if (archive?.created) {
        // A failed replacement keeps the original. Remove only our positively
        // bound duplicate link; uncertain originals and archives both survive.
        let removed = false;
        try {
          await this.#ensureDirectory();
          await this.#ordinaryDirectory(archive.directory, false, archive.bound);
          const named = await fs.lstat(this.filename, { bigint: true });
          const archived = await fs.lstat(archive.file, { bigint: true });
          if (sameContentStamp(archive.originalStat, archived) && (!archive.stat || sameStamp(archive.stat, archived))
            && sameStamp(archived, named) && named.nlink === 2n) {
            await fs.unlink(archive.file);
            this.#baseline = await this.#observe();
            removed = true;
          }
        } catch { /* An uncertain name never authorizes deletion. */ }
        if (!removed) {
          this.#blocked = true;
          this.#notice('An original appearance archive was retained after an interrupted save. Both names were preserved; their identity needs review before another save.');
        }
      }
      throw error;
    } finally {
      await handle?.close().catch(() => {});
      if (temporaryIdentity) {
        try {
          await this.#ensureDirectory();
          const named = await fs.lstat(temporary, { bigint: true });
          if (named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && sameObject(temporaryIdentity, named)) await fs.unlink(temporary);
        } catch { /* Unknown or replaced temporary objects remain preserved. */ }
      }
    }
  }

  set(request) {
    // Shutdown closes admission synchronously before draining. Both the active
    // write and queued writes count toward this fixed, main-owned resource cap.
    if (this.#admissionClosed) throw fail('APPEARANCE_CLOSED', 'Appearance changes are closed while the application exits.');
    if (this.#accepted.size >= MAX_PENDING_APPEARANCE_WRITES) {
      throw fail('APPEARANCE_BUSY', 'Appearance changes are still saving. Wait before choosing another theme.');
    }
    // Capture the one allowed data value before yielding. A renderer cannot
    // mutate a queued DTO into paths, processing settings or another theme.
    const theme = validateTheme(request);
    const previous = pendingByFile.get(this.filename) || Promise.resolve();
    const operation = previous.then(async () => {
      await this.load();
      try {
        if (this.#blocked) throw fail('APPEARANCE_UNAVAILABLE', 'Stored appearance is preserved. Reopen to review its identity before saving.');
        await this.#write(theme);
      } catch (error) {
        this.#persistence = { state: 'unavailable', persisted: false };
        this.#notice('Appearance was not confirmed saved. The previous theme remains selected for this session.');
        throw error;
      }
      const recovered = this.#invalid;
      this.#theme = theme;
      this.#invalid = false;
      this.#notices = recovered ? ['The previous stored appearance was archived before saving this theme.'] : [];
      this.#persistence = { state: 'saved', persisted: true };
      return this.snapshot();
    });
    const idle = operation.then(() => undefined, () => undefined);
    pendingByFile.set(this.filename, idle);
    void idle.then(() => { if (pendingByFile.get(this.filename) === idle) pendingByFile.delete(this.filename); });
    const accepted = operation.finally(() => this.#accepted.delete(accepted));
    this.#accepted.add(accepted); // shutdown owns accepted writes synchronously
    return accepted;
  }

  closeAdmission() { this.#admissionClosed = true; }

  async flush() {
    // Also drain writes accepted while an earlier write is finishing. Failure
    // remains visible in its set() result/snapshot and must not obstruct close.
    while (this.#accepted.size) await Promise.allSettled([...this.#accepted]);
    return this.snapshot();
  }
}

module.exports = { AppearanceSettings, APPEARANCE_NAMESPACE, APPEARANCE_FILE, MAX_APPEARANCE_BYTES, MAX_PENDING_APPEARANCE_WRITES };
