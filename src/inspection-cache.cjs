'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { INSPECTION_POLICY, reconstructInspection, cacheableInspection } = require('./inspection.cjs');

const CACHE_NAMESPACE = 'inspection-v1';
const CACHE_LIMITS = Object.freeze({ diskEntries: 2000, diskBytes: 128 * 1024 * 1024, recordBytes: 4 * 1024 * 1024, hotEntries: 128, hotBytes: 16 * 1024 * 1024 });
const RECORD_NAME = /^[a-f0-9]{64}\.json$/;
const TEMP_NAME = /^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/;
const HASH = /^[a-f0-9]{64}$/;
const IDENTITY_FIELDS = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
const digest = text => createHash('sha256').update(text).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identityOf(value) {
  if (!object(value)) throw new Error('Invalid inspection-cache identity.');
  const identity = {};
  for (const key of IDENTITY_FIELDS) {
    if (typeof value[key] !== 'string' || value[key].length > (key === 'canonicalPath' ? 32768 : 128)) throw new Error('Invalid inspection-cache identity.');
    identity[key] = value[key];
  }
  if (!identity.canonicalPath || /[\0\r\n]/.test(identity.canonicalPath)
      || (!path.isAbsolute(identity.canonicalPath) && !path.win32.isAbsolute(identity.canonicalPath))
      || !/^sha256-sparse-v1:[a-f0-9]{64}$/.test(identity.sparseDigest)
      || !['dev', 'ino', 'size'].every(key => /^\d+$/.test(identity[key]))
      || !['mtimeNs', 'ctimeNs', 'birthtimeNs'].every(key => /^-?\d+$/.test(identity[key]))) throw new Error('Invalid inspection-cache identity.');
  return identity;
}

// Validate shape/complexity before stringify, and cap bytes before JSON.parse.
// Paths inside evidence are inert metadata; only a locally derived digest becomes
// a cache filename. No cached value can select an input, executable or argument.
function boundedJson(value) {
  let nodes = 0;
  let characters = 0;
  const seen = new Set();
  function visit(entry, depth) {
    if (++nodes > 100000 || depth > 12) throw new Error('Inspection cache evidence is too complex.');
    if (typeof entry === 'string') {
      characters += entry.length;
      if (entry.length > 262144 || characters > CACHE_LIMITS.recordBytes) throw new Error('Inspection cache evidence is too large.');
    } else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new Error('Invalid cache number.');
    } else if (entry !== null && typeof entry !== 'boolean') {
      if ((!Array.isArray(entry) && !object(entry)) || seen.has(entry)) throw new Error('Invalid cache object.');
      seen.add(entry);
      const keys = Object.keys(entry);
      if (keys.length > 20000) throw new Error('Inspection cache collection is too large.');
      for (const key of keys) {
        if (key.length > 1024 || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid cache key.');
        characters += key.length;
        visit(entry[key], depth + 1);
      }
      seen.delete(entry);
    }
  }
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > CACHE_LIMITS.recordBytes) throw new Error('Inspection cache record is too large.');
  return serialized;
}

class InspectionCache {
  #hot = new Map();
  #hotBytes = 0;
  #pending = Promise.resolve();

  constructor({ directory, ffprobeHash }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof ffprobeHash !== 'string' || !HASH.test(ffprobeHash)) {
      throw new TypeError('InspectionCache requires an absolute app-owned directory and SHA-256 ffprobe hash.');
    }
    this.directory = path.join(directory, CACHE_NAMESPACE);
    this.ffprobeHash = ffprobeHash;
    this.warning = null;
  }

  get stats() { return { hotEntries: this.#hot.size, hotBytes: this.#hotBytes }; }

  #sequence(operation, fallback) {
    const task = this.#pending.then(operation).catch(error => {
      this.warning = `Inspection cache unavailable; fresh inspection remains available. ${String(error.message).slice(0, 200)}`;
      return fallback;
    });
    this.#pending = task.then(() => undefined);
    return task;
  }

  #key(identity) {
    return digest(JSON.stringify({ namespace: CACHE_NAMESPACE, ffprobeHash: this.ffprobeHash, policy: INSPECTION_POLICY, identity }));
  }

  async #ensureDirectory(create = false) {
    let stat;
    try { stat = await fs.lstat(this.directory); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      await fs.mkdir(this.directory, { recursive: true });
      stat = await fs.lstat(this.directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Cache namespace must be an owned regular directory.');
  }

  #forget(key) {
    const previous = this.#hot.get(key);
    if (previous) { this.#hotBytes -= previous.bytes; this.#hot.delete(key); }
  }

  #remember(key, serialized) {
    this.#forget(key);
    const bytes = Buffer.byteLength(serialized);
    if (bytes > CACHE_LIMITS.hotBytes) return;
    this.#hot.set(key, { serialized, bytes });
    this.#hotBytes += bytes;
    while (this.#hot.size > CACHE_LIMITS.hotEntries || this.#hotBytes > CACHE_LIMITS.hotBytes) this.#forget(this.#hot.keys().next().value);
  }

  #decode(serialized, identity, key) {
    if (Buffer.byteLength(serialized) > CACHE_LIMITS.recordBytes) throw new Error('Oversized cache record.');
    const record = JSON.parse(serialized);
    boundedJson(record);
    if (!exactKeys(record, ['namespace', 'version', 'key', 'ffprobeHash', 'policy', 'identity', 'payload', 'checksum'])
        || record.namespace !== CACHE_NAMESPACE || record.version !== 1 || record.key !== key
        || record.ffprobeHash !== this.ffprobeHash || JSON.stringify(record.policy) !== JSON.stringify(INSPECTION_POLICY)
        || JSON.stringify(record.identity) !== JSON.stringify(identity)
        || !exactKeys(record.payload, ['probe', 'evidence']) || !HASH.test(record.checksum)) throw new Error('Stale or invalid cache schema.');
    const { checksum, ...body } = record;
    if (digest(JSON.stringify(body)) !== checksum) throw new Error('Cache checksum mismatch.');
    const inspection = reconstructInspection(record.payload.probe, record.payload.evidence);
    if (JSON.stringify({ probe: inspection.probe, evidence: inspection.evidence }) !== JSON.stringify(record.payload)
        || !cacheableInspection(inspection)) throw new Error('Incomplete or non-normalized cache evidence.');
    return inspection;
  }

  async #read(file) {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > CACHE_LIMITS.recordBytes) throw new Error('Invalid cache file.');
    const handle = await fs.open(file, 'r');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > CACHE_LIMITS.recordBytes) throw new Error('Cache file changed.');
      const buffer = Buffer.alloc(Math.min(opened.size + 1, CACHE_LIMITS.recordBytes + 1));
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('Cache file changed during reading.');
      return buffer.subarray(0, length).toString('utf8');
    } finally { await handle.close(); }
  }

  async #touchOwned(filename) {
    let handle;
    try {
      await this.#ensureDirectory();
      const before = await fs.lstat(filename, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) return;
      handle = await fs.open(filename, 'r+');
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1n) return;
      // Touch only the checked object. A pathname utimes could follow a record
      // replaced by a symlink and mutate timestamps on unrelated media.
      await handle.utimes(new Date(), new Date());
    } catch { /* Read-only or changed cache records need no LRU timestamp write. */ }
    finally { await handle?.close().catch(() => {}); }
  }

  lookup(identityValue) {
    return this.#sequence(async () => {
      const identity = identityOf(identityValue);
      const key = this.#key(identity);
      const hot = this.#hot.get(key);
      if (hot) {
        const result = this.#decode(hot.serialized, identity, key);
        this.#remember(key, hot.serialized);
        // Reflect hot hits in the disk LRU too. A missing/read-only namespace
        // cannot invalidate already verified in-memory evidence.
        try {
          await this.#ensureDirectory();
          await this.#touchOwned(path.join(this.directory, `${key}.json`));
        } catch {}
        return result;
      }
      try {
        await this.#ensureDirectory();
        const filename = path.join(this.directory, `${key}.json`);
        const serialized = await this.#read(filename);
        const result = this.#decode(serialized, identity, key);
        this.#remember(key, serialized);
        // A read-only cache can still supply valid evidence. LRU timestamp updates
        // are optional and never turn that successful read into an inspection error.
        await this.#touchOwned(filename);
        return result;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }, null);
  }

  async #files() {
    const entries = [];
    let count = 0;
    const directory = await fs.opendir(this.directory);
    for await (const entry of directory) {
      if (++count > 10000) throw new Error('Cache namespace has excessive entries.');
      if (!RECORD_NAME.test(entry.name) && !TEMP_NAME.test(entry.name)) continue;
      const filename = path.join(this.directory, entry.name);
      try {
        const stat = await fs.lstat(filename);
        if (stat.isFile() && !stat.isSymbolicLink()) entries.push({ filename, name: entry.name, size: stat.size, time: stat.mtimeMs });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return entries;
  }

  async #prune(incomingBytes) {
    const files = (await this.#files()).sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    let count = files.length;
    let bytes = files.reduce((total, entry) => total + entry.size, 0);
    for (const entry of files) {
      if (count + 1 <= CACHE_LIMITS.diskEntries && bytes + incomingBytes <= CACHE_LIMITS.diskBytes) break;
      await fs.unlink(entry.filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      count--;
      bytes -= entry.size;
      this.#forget(entry.name.slice(0, 64));
    }
  }

  store(identityValue, inspectionValue) {
    return this.#sequence(async () => {
      const identity = identityOf(identityValue);
      // Discard display/approval fields. Only current, complete evidence may be
      // persisted, including definitive unsupported HDR observed in metadata.
      const payload = { probe: inspectionValue?.probe, evidence: inspectionValue?.evidence };
      boundedJson(payload);
      const inspection = reconstructInspection(payload.probe, payload.evidence);
      if (!cacheableInspection(inspection)) return false;
      const key = this.#key(identity);
      const body = { namespace: CACHE_NAMESPACE, version: 1, key, ffprobeHash: this.ffprobeHash, policy: INSPECTION_POLICY, identity,
        payload: { probe: inspection.probe, evidence: inspection.evidence } };
      const record = { ...body, checksum: digest(boundedJson(body)) };
      const serialized = boundedJson(record);
      await this.#ensureDirectory(true);
      await this.#prune(Buffer.byteLength(serialized));
      const temporary = path.join(this.directory, `${key}.${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fs.open(temporary, 'wx');
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(temporary, path.join(this.directory, `${key}.json`));
      } finally {
        await handle?.close().catch(() => {});
        await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      this.#remember(key, serialized);
      return true;
    }, false);
  }

  clear() {
    return this.#sequence(async () => {
      this.#hot.clear();
      this.#hotBytes = 0;
      try { await this.#ensureDirectory(); }
      catch (error) { if (error.code === 'ENOENT') return true; throw error; }
      // Inspection cache only: never recurse, consult media paths in records, or
      // touch the separate provenance namespace used for generated-output safety.
      for (const entry of await this.#files()) await fs.unlink(entry.filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return true;
    }, false);
  }
}

module.exports = { InspectionCache, CACHE_NAMESPACE, CACHE_LIMITS };
