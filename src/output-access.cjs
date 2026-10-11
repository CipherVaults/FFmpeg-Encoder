'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readSourceIdentity, sameIdentity, sameStamp } = require('./source-identity.cjs');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MEDIA_EXTENSIONS = new Set(['.mkv', '.mp4', '.mov']);
const STAMP_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const IDENTITY_FIELDS = ['canonicalPath', ...STAMP_FIELDS, 'sparseDigest'];
const MAX_COMPONENTS = 128;
const MAX_ENTRIES = 4096;

function fail(code, message, cause) {
  return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });
}

function exactData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable);
}

function ordinaryPath(file) {
  if (typeof file !== 'string' || !file || file.length > 32760 || /[\u0000-\u001f\u007f]/.test(file)
      || !path.isAbsolute(file) || path.normalize(file) !== file || !MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw fail('INVALID_OUTPUT_ACCESS', 'Only a canonical completed MKV, MP4 or MOV file can receive an output action.');
  }
  const root = path.parse(file).root;
  // A renderer never supplies these names. Still refuse shell namespaces,
  // network/device paths, alternate data streams and Windows path aliases at
  // this main-only boundary before any filesystem or shell operation.
  if (process.platform === 'win32' ? !/^[A-Za-z]:\\$/.test(root) : root !== '/' || file.startsWith('//')) {
    throw fail('INVALID_OUTPUT_ACCESS', 'Output actions require an ordinary local filesystem path.');
  }
  const components = file.slice(root.length).split(path.sep);
  if (components.length > MAX_COMPONENTS || components.some(component => !component || /[<>:"|?*]/.test(component)
      || /[. ]$/.test(component) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component))) {
    throw fail('INVALID_OUTPUT_ACCESS', 'The completed output path is unsafe or exceeds its component limit.');
  }
  return { root, components };
}

function identitySnapshot(identity, file) {
  if (!exactData(identity, IDENTITY_FIELDS) || identity.canonicalPath !== file
      || STAMP_FIELDS.some(field => typeof identity[field] !== 'string' || !/^-?\d{1,30}$/.test(identity[field]))
      || !/^[1-9]\d*$/.test(identity.dev) || !/^[1-9]\d*$/.test(identity.ino)
      || !sameIdentity(identity, identity) || !Number.isSafeInteger(Number(identity.size))) {
    throw fail('INVALID_OUTPUT_ACCESS', 'A complete main-owned published-output identity is required.');
  }
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map(field => [field, identity[field]])));
}

function objectIdentity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}

function sameObject(a, b) {
  return a && b && ['dev', 'ino', 'birthtimeNs'].every(field => a[field] === b[field]);
}

/**
 * Ephemeral, main-owned access to outputs already validated and published.
 * `issue` is not an IPC method: its caller must establish publication and finish
 * owned-link cleanup first, then provide a fresh readSourceIdentity observation.
 * A path, persisted journal, provenance marker or renderer ID cannot recreate a
 * grant after reset/restart. No method executes a command or accepts arguments.
 *
 * Actions use bounded sparse identity plus strict stamps, not a full-file hash.
 * Ordinary lstat/realpath guards reject links, junctions and redirected names;
 * they are not a general proof about every Windows filesystem filter/reparse
 * type. Electron shell APIs ultimately open by path, so this does not claim an
 * atomic handle-bound launch against a malicious same-user replacement between
 * the final check and OS dispatch. Uncertain observations always refuse access.
 */
class OutputAccess {
  #grants = new Map();
  #byFile = new Map();
  #issues = new Map();
  #actions = new Map();
  #issueQueue = Promise.resolve();
  #generation = 0;
  #openPath;
  #showItemInFolder;
  #io;
  #readIdentity;
  #limit;

  constructor({ openPath, showItemInFolder, maxEntries = 512, io = fs, readIdentity = readSourceIdentity } = {}) {
    if (typeof openPath !== 'function' || typeof showItemInFolder !== 'function' || typeof readIdentity !== 'function'
        || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) {
      throw new TypeError('OutputAccess requires trusted shell callbacks and a bounded grant limit.');
    }
    this.#openPath = openPath; this.#showItemInFolder = showItemInFolder;
    this.#io = io; this.#readIdentity = readIdentity; this.#limit = maxEntries;
  }

  #requireCurrent(generation, record) {
    if (generation !== this.#generation || (record && this.#grants.get(record.outputId) !== record)) {
      throw fail('OUTPUT_ACCESS_EXPIRED', 'This completed-output action expired. No file was opened.');
    }
  }

  async #observe(file, identity, expectedDirectories) {
    const { root, components } = ordinaryPath(file);
    const directories = [];
    let name = root;
    let fileStat;
    for (let index = -1; index < components.length; index++) {
      if (index >= 0) name = path.join(name, components[index]);
      const stat = await this.#io.lstat(name, { bigint: true });
      const isFile = index === components.length - 1;
      if (stat.isSymbolicLink() || stat.dev === 0n || stat.ino === 0n
          || (isFile ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())) {
        throw fail('OUTPUT_ACCESS_CHANGED', 'The completed output or a parent directory is linked, replaced or not an ordinary local object.');
      }
      if (isFile) fileStat = stat;
      else directories.push(objectIdentity(stat));
    }
    if (expectedDirectories && (directories.length !== expectedDirectories.length
        || directories.some((entry, index) => !sameObject(entry, expectedDirectories[index])))) {
      throw fail('OUTPUT_ACCESS_CHANGED', 'A directory containing the completed output changed. No file was opened.');
    }
    const canonicalPath = await this.#io.realpath(file);
    const actual = { canonicalPath, ...Object.fromEntries(STAMP_FIELDS.map(field => [field, String(fileStat[field])])) };
    if (canonicalPath !== file || !sameStamp(identity, actual)) {
      throw fail('OUTPUT_ACCESS_CHANGED', 'The completed output path or file identity changed. No file was opened.');
    }
    return directories;
  }

  #revoke(record) {
    if (this.#grants.get(record.outputId) !== record) return;
    this.#grants.delete(record.outputId);
    if (this.#byFile.get(record.file) === record.outputId) this.#byFile.delete(record.file);
  }

  issue(request) {
    // Validate and snapshot before queuing; later caller mutations cannot
    // change which completed file receives this narrowly scoped authority.
    if (!exactData(request, ['file', 'identity'])) return Promise.reject(fail('INVALID_OUTPUT_ACCESS', 'Output issuance requires only file and identity.'));
    let file, identity;
    try { file = request.file; ordinaryPath(file); identity = identitySnapshot(request.identity, file); }
    catch (error) { return Promise.reject(error); }
    const key = JSON.stringify(identity), generation = this.#generation;
    const existingIssue = this.#issues.get(key);
    if (existingIssue) return existingIssue;
    if (this.#issues.size >= this.#limit) return Promise.reject(fail('OUTPUT_ACCESS_BUSY', 'Too many output-access requests are pending.'));
    const pending = this.#issueQueue.then(async () => {
      this.#requireCurrent(generation);
      let directories;
      try { directories = await this.#observe(file, identity); }
      catch (cause) { throw fail('OUTPUT_ACCESS_CHANGED', 'The published output could not be bound safely. No access token was issued.', cause); }
      this.#requireCurrent(generation);
      const current = this.#grants.get(this.#byFile.get(file));
      if (current && sameIdentity(current.identity, identity)
          && directories.every((entry, index) => sameObject(entry, current.directories[index]))) {
        return { outputId: current.outputId };
      }
      if (current) this.#revoke(current);
      while (this.#grants.size >= this.#limit) this.#revoke(this.#grants.values().next().value);
      const outputId = randomUUID();
      const record = { outputId, file, identity, directories };
      this.#grants.set(outputId, record); this.#byFile.set(file, outputId);
      return { outputId };
    });
    this.#issueQueue = pending.then(() => undefined, () => undefined);
    this.#issues.set(key, pending);
    const settled = () => { if (this.#issues.get(key) === pending) this.#issues.delete(key); };
    void pending.then(settled, settled);
    return pending;
  }

  action(request) {
    if (!exactData(request, ['outputId', 'action']) || typeof request.outputId !== 'string'
        || !UUID.test(request.outputId) || !['open', 'reveal'].includes(request.action)) {
      return Promise.reject(fail('INVALID_OUTPUT_ACCESS', 'Choose an issued output ID and either open or reveal.'));
    }
    const { outputId, action } = request;
    const record = this.#grants.get(outputId);
    if (!record) return Promise.reject(fail('OUTPUT_ACCESS_EXPIRED', 'This output action is unknown or expired. No file was opened.'));
    const key = `${outputId}:${action}`, existing = this.#actions.get(key);
    if (existing) return existing;
    if (this.#actions.size >= this.#limit * 2) return Promise.reject(fail('OUTPUT_ACCESS_BUSY', 'Too many output actions are pending.'));
    const generation = this.#generation;
    const pending = (async () => {
      try {
        this.#requireCurrent(generation, record);
        await this.#observe(record.file, record.identity, record.directories);
        const actual = await this.#readIdentity(record.file);
        if (!sameIdentity(record.identity, actual)) throw fail('OUTPUT_ACCESS_CHANGED', 'The completed output changed after publication.');
        // Revalidate the name and ancestor objects after bounded sampling. A
        // matching digest never relaxes ctime or any other strict stamp field.
        await this.#observe(record.file, record.identity, record.directories);
        this.#requireCurrent(generation, record);
      } catch (cause) {
        this.#revoke(record);
        if (cause?.code === 'OUTPUT_ACCESS_EXPIRED') throw cause;
        throw fail('OUTPUT_ACCESS_CHANGED', 'The completed output is missing, changed or could not be verified. No file was opened.', cause);
      }
      try {
        if (action === 'open') {
          const error = await this.#openPath(record.file);
          // Electron resolves openPath with an error string on failure. A
          // fulfilled promise by itself is not evidence of successful dispatch.
          if (error !== '') throw fail('OUTPUT_OPEN_FAILED', typeof error === 'string' && error
            ? `The system could not open the output: ${error.slice(0, 1500)}` : 'The system did not confirm opening the output.');
        } else {
          const result = await this.#showItemInFolder(record.file);
          if (result !== undefined) throw fail('OUTPUT_REVEAL_FAILED', 'The system did not confirm revealing the output.');
        }
      } catch (cause) {
        if (['OUTPUT_OPEN_FAILED', 'OUTPUT_REVEAL_FAILED'].includes(cause?.code)) throw cause;
        throw fail(action === 'open' ? 'OUTPUT_OPEN_FAILED' : 'OUTPUT_REVEAL_FAILED',
          action === 'open' ? 'The system could not open the completed output.' : 'The system could not reveal the completed output.', cause);
      }
      // A successful OS dispatch is not a playback, rendering or Explorer
      // observation. Return only what this API can honestly establish.
      return { outputId, action, dispatched: true };
    })();
    this.#actions.set(key, pending);
    const settled = () => { if (this.#actions.get(key) === pending) this.#actions.delete(key); };
    void pending.then(settled, settled);
    return pending;
  }

  clear() {
    const revoked = this.#grants.size;
    this.#generation++;
    this.#grants.clear(); this.#byFile.clear(); this.#issues.clear(); this.#actions.clear();
    return { revoked };
  }
}

module.exports = { OutputAccess };
