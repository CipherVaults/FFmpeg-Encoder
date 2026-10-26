'use strict';

// Native-only complete source observation. A retained Node read handle binds
// comparisons to a file object; it does not lock what FFmpeg opens by path.
// No source bytes are written, and no file-policy or execution grant is minted.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { readSourceIdentity, sameIdentity, assessCompletedSource } = require('./source-identity.cjs');
const { NATIVE_FILE_CANDIDATE } = require('./native-file-contract.cjs');

const FIELDS = ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const stamp = stat => Object.fromEntries(FIELDS.map(key => [key, String(stat[key])]));
const same = (a, b, completion = false) => FIELDS.every(key => completion && key === 'ctimeNs' || a[key] === b[key]);
const identityMatches = (identity, file, observed) => identity.canonicalPath === file
  && FIELDS.filter(key => key !== 'nlink').every(key => identity[key] === observed[key]);
function record(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_NATIVE_SOURCE', 'Native source options must be inert records.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
      || !keys.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('INVALID_NATIVE_SOURCE', 'Unknown, missing or accessor source fields.');
}
function ordinary(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.dev <= 0n || stat.ino <= 0n) fail('NATIVE_SOURCE_CHANGED', 'A native source must remain an ordinary singly linked known file object.');
}
function checkSignal(signal) { if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_NATIVE_SOURCE', 'Main must supply an AbortSignal.'); }
function cancelled(signal) { if (signal?.aborted) fail('CANCELLED', 'Complete native source observation was cancelled.'); }
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

class NativeFileSourceOwner {
  #maximum; #tokens = new WeakMap(); #held = new Set(); #active = null; #closed = false; #closing = null;
  constructor(options = {}) {
    record(options, ['maximumBytes'], []);
    this.#maximum = options.maximumBytes === undefined ? Number(NATIVE_FILE_CANDIDATE.maximumSourceBytes) : options.maximumBytes;
    if (!Number.isSafeInteger(this.#maximum) || this.#maximum < 1 || this.#maximum > Number(NATIVE_FILE_CANDIDATE.maximumSourceBytes)) fail('INVALID_NATIVE_SOURCE', 'Source reads cannot exceed the finite native engineering bound.');
  }
  #entry(token) {
    const entry = token && typeof token === 'object' && this.#tokens.get(token);
    if (this.#closed || !entry || entry.released || entry.failed || entry.phase === 'completed') fail('NATIVE_SOURCE_STALE', 'Use this owner\'s original unreleased native source observation.');
    return entry;
  }
  async #work(signal, action) {
    checkSignal(signal); cancelled(signal);
    if (this.#closed) fail('NATIVE_SOURCE_STALE', 'The native source owner is closed.');
    if (this.#active) fail('NATIVE_SOURCE_BUSY', 'Wait for the complete source observation to drain.');
    const controller = new AbortController(), linked = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const active = { controller, done: null }; this.#active = active;
    const work = Promise.resolve().then(() => action(linked)); active.done = work;
    try { return await work; } finally { if (this.#active === active) this.#active = null; }
  }
  async #stable(entry, { completion = false, exact } = {}) {
    await assertOrdinaryPath(entry.file);
    const [held, named] = await Promise.all([entry.handle.stat({ bigint: true }), fsp.lstat(entry.file, { bigint: true })]);
    ordinary(held); ordinary(named);
    const current = stamp(held), atPath = stamp(named);
    // The named path and retained object must always agree, including ctime.
    if (!same(current, atPath) || !same(exact || entry.initialStamp, current, completion)) fail('NATIVE_SOURCE_CHANGED', 'The native source object, path or content-significant stamp changed.');
    return current;
  }
  async #hash(entry, signal, completion = false) {
    cancelled(signal); const before = await this.#stable(entry, { completion });
    const bytes = Number(before.size), digest = createHash('sha256'), buffer = Buffer.alloc(Math.min(bytes, 1024 * 1024));
    for (let position = 0; position < bytes;) {
      cancelled(signal);
      const { bytesRead } = await entry.handle.read(buffer, 0, Math.min(buffer.length, bytes - position), position);
      if (!bytesRead) fail('NATIVE_SOURCE_CHANGED', 'Native source ended before its complete observed size.');
      digest.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const after = await this.#stable(entry, { exact: before }); cancelled(signal);
    return freeze({ stamp: after, content: { complete: true, algorithm: 'sha256', bytes: String(bytes), digest: digest.digest('hex') } });
  }
  async seal(file, options = {}) {
    record(options, ['expectedIdentity', 'signal'], []);
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.length > 32767 || /[\x00-\x1f\x7f]/.test(file)) fail('INVALID_NATIVE_SOURCE', 'Main must provide an ordinary absolute source path.');
    let expected;
    if (options.expectedIdentity !== undefined) {
      record(options.expectedIdentity, ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest']);
      if (Object.values(options.expectedIdentity).some(value => typeof value !== 'string' || value.length > 32767)) fail('INVALID_NATIVE_SOURCE', 'Expected source identity must contain bounded strings.');
      expected = { ...options.expectedIdentity };
    }
    return this.#work(options.signal, async signal => {
      if (this.#held.size) fail('NATIVE_SOURCE_BUSY', 'The first native route retains at most one source at a time.');
      let entry;
      try {
        const canonical = await assertOrdinaryPath(file), before = await fsp.lstat(canonical, { bigint: true }); ordinary(before);
        if (before.size < 1n || before.size > BigInt(this.#maximum)) fail('NATIVE_SOURCE_SIZE', 'Native source size is outside the finite complete-read bound.');
        cancelled(signal);
        entry = { file: canonical, handle: await fsp.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)), initialStamp: stamp(before), phase: 'prepared', failed: false, released: false };
        this.#held.add(entry);
        await this.#stable(entry);
        const identity = await readSourceIdentity(canonical, { signal });
        await this.#stable(entry);
        if (!identityMatches(identity, canonical, entry.initialStamp)) fail('NATIVE_SOURCE_CHANGED', 'The sparse observation describes a different file object or stamp.');
        if (expected && !sameIdentity(expected, identity)) fail('NATIVE_SOURCE_CHANGED', 'Complete-source preparation differs from the previously inspected source.');
        const complete = await this.#hash(entry, signal);
        if (!identityMatches(identity, canonical, complete.stamp)) fail('NATIVE_SOURCE_CHANGED', 'Complete and sparse preparation observations do not share the exact file stamp.');
        const content = complete.content;
        const token = freeze({ schema: 1, kind: 'native-complete-source', file: canonical, identity: { ...identity }, content,
          assurance: 'complete-held-read-and-path-comparison; no-write-lock-or-atomic-executable-source-pin', executionAuthority: 'none' });
        entry.token = token; this.#tokens.set(token, entry); return token;
      } catch (error) {
        if (entry) { entry.failed = true; try { await entry.handle.close(); entry.released = true; this.#held.delete(entry); }
          catch (closeError) { error.sourceCloseFailure = { code: closeError.code || 'NATIVE_SOURCE_CLOSE_FAILED' }; } }
        throw error;
      }
    });
  }
  async requireCurrent(token, options = {}) {
    record(options, ['signal'], []);
    return this.#work(options.signal, async signal => {
      const entry = this.#entry(token);
      if (entry.phase !== 'prepared') fail('NATIVE_SOURCE_COMPLETION_ONLY', 'A completed encoder source cannot become a fresh input grant.');
      try { await this.#stable(entry); cancelled(signal); return token; } catch (error) { entry.failed = true; throw error; }
    });
  }
  async beginCompletion(token, options = {}) {
    record(options, ['signal'], []);
    return this.#work(options.signal, async signal => {
      const entry = this.#entry(token);
      if (entry.phase !== 'prepared') fail('NATIVE_SOURCE_COMPLETION_ONLY', 'Completion begins once on the original prepared observation.');
      entry.phase = 'completion';
      try { await this.#stable(entry, { completion: true }); cancelled(signal); return token; } catch (error) { entry.failed = true; throw error; }
    });
  }
  async requireCompletionSource(token, options = {}) {
    record(options, ['signal'], []);
    return this.#work(options.signal, async signal => {
      const entry = this.#entry(token);
      if (entry.phase !== 'completion') fail('NATIVE_SOURCE_COMPLETION_ONLY', 'Only a source already in completed-encode assessment can supply evidence reads.');
      try { await this.#stable(entry, { completion: true }); cancelled(signal); return token; } catch (error) { entry.failed = true; throw error; }
    });
  }
  async assessCompleted(token, options = {}) {
    record(options, ['signal'], []);
    return this.#work(options.signal, async signal => {
      const entry = this.#entry(token);
      if (entry.phase !== 'completion') fail('NATIVE_SOURCE_COMPLETION_ONLY', 'Complete the encoder before final source disposition.');
      try {
        const complete = await this.#hash(entry, signal, true), identity = await readSourceIdentity(entry.file, { signal });
        await this.#stable(entry, { exact: complete.stamp });
        if (!identityMatches(identity, entry.file, complete.stamp)) fail('NATIVE_SOURCE_CHANGED', 'Final complete and sampled observations disagree.');
        const contentEvidence = freeze({ before: token.content, after: complete.content });
        const assessment = assessCompletedSource(token.identity, identity, { stage: 'native-after-complete-output', contentEvidence });
        entry.phase = 'completed';
        return freeze({ schema: 1, kind: 'native-complete-source-assessment', assessment, contentEvidence,
          finalIdentity: identity, executionAuthority: 'none', publicationRequires: 'independent-complete-output-validation-and-current-file-policy' });
      } catch (error) { entry.failed = true; throw error; }
    });
  }
  async release(token) {
    const entry = token && typeof token === 'object' && this.#tokens.get(token);
    if (!entry) fail('NATIVE_SOURCE_STALE', 'Only this owner can release its original source observation.');
    if (entry.released) return;
    return this.#work(undefined, async () => {
      entry.failed = true;
      await entry.handle.close(); entry.released = true; this.#held.delete(entry);
    });
  }
  async close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      if (this.#active) { this.#active.controller.abort(); await this.#active.done.catch(() => {}); }
      const results = await Promise.allSettled([...this.#held].map(async entry => { await entry.handle.close(); entry.released = true; this.#held.delete(entry); }));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Native source handle closure is incomplete.');
    })(); return this.#closing;
  }
}

module.exports = { NativeFileSourceOwner };
