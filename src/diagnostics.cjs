'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const NAMESPACE = 'diagnostics-v1';
const LIMITS = Object.freeze({ retentionMs: 30 * 86400_000, bytes: 200 * 1024 * 1024,
  eventBytes: 64 * 1024, stderrBytes: 256 * 1024, entries: 20000 });
const STAGES = Object.freeze(['startup', 'session', 'admission', 'inspection', 'preparation', 'capability',
  'invocation', 'encoding', 'validation', 'publication', 'cancellation', 'shutdown', 'recovery', 'global']);
const OUTCOMES = ['completed', 'cancelled', 'failed', 'interrupted'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROCESS_TOKEN = randomUUID();
// Every recognized open session keeps one compact lifecycle record in reserve.
// Appending ordinary incidents cannot consume the space needed to close it or
// mark its dead owner interrupted on restart. The write path enforces this bound.
const TERMINAL_RESERVE_BYTES = 1536;
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const fail = (code, message) => Object.assign(new Error(message), { code });
const sameObject = (a, b) => a.dev === b.dev && a.ino === b.ino;
const clone = value => structuredClone(value);
function requireId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'A diagnostic UUID is required.');
  return id;
}
const cursorOf = event => Buffer.from(JSON.stringify([event.at, event.sequence, event.id])).toString('base64url');
function parseCursor(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic cursor.');
  let tuple;
  try { tuple = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic cursor.'); }
  if (!Array.isArray(tuple) || tuple.length !== 3 || !Number.isSafeInteger(tuple[0]) || tuple[0] < 0
    || !Number.isSafeInteger(tuple[1]) || tuple[1] < 0 || typeof tuple[2] !== 'string' || !UUID.test(tuple[2])) {
    throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic cursor.');
  }
  const record = { at: tuple[0], sequence: tuple[1], id: tuple[2] };
  if (cursorOf(record) !== value) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic cursor.');
  return record;
}
const newestFirst = (a, b) => b.at - a.at || b.sequence - a.sequence || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
function requestObject(value, allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d, 'value'))) {
    throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Unknown or invalid diagnostic request fields.');
  }
}
function boundedText(value, bytes, tail = false) {
  if (typeof value !== 'string') throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Diagnostic text must be a string.');
  // Limit work before allocating a UTF-8 buffer. A caller's already large
  // stderr/message must not cause another full-sized allocation to retain a
  // small tail. UTF-8 always needs at least as many bytes as UTF-16 code units.
  const sample = value.length > bytes ? value.slice(tail ? -bytes : 0, tail ? undefined : bytes) : value;
  const clean = sample.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '\uFFFD');
  const buffer = Buffer.from(clean);
  let result = buffer.length <= bytes ? clean : buffer.subarray(tail ? buffer.length - bytes : 0, tail ? undefined : bytes).toString('utf8');
  // Cutting a UTF-8 codepoint can add a replacement character. The byte limit
  // applies to what is actually written, not to the original sliced buffer.
  while (Buffer.byteLength(result) > bytes) result = tail ? result.slice(1) : result.slice(0, -1);
  return { text: result, truncated: result !== value };
}
function boundedContext(value, maximum) {
  let remaining = maximum, truncated = false, nodes = 0;
  const seen = new Set();
  const visit = (item, depth) => {
    if (++nodes > 2048 || depth > 7 || remaining < 32) { truncated = true; return null; }
    remaining -= 16;
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (Number.isFinite(item)) return item; truncated = true; return null; }
    if (typeof item === 'string') {
      const result = boundedText(item, Math.min(4096, Math.max(0, remaining)));
      remaining -= Buffer.byteLength(result.text); truncated ||= result.truncated; return result.text;
    }
    if ((!plain(item) && !Array.isArray(item)) || seen.has(item)) { truncated = true; return null; }
    seen.add(item);
    const result = Array.isArray(item) ? [] : Object.create(null);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Object.keys(descriptors).filter(key => key !== 'length');
    if (keys.length > 128) truncated = true;
    for (const key of keys.slice(0, 128)) {
      if (remaining < 64) { truncated = true; break; }
      const descriptor = descriptors[key];
      // Never execute metadata accessors, retain prototype-mutation keys, or
      // invoke arbitrary toJSON methods supplied by an untrusted object.
      if (!Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
        || key.length > 128 || /[\x00-\x1f]/.test(key)) { truncated = true; continue; }
      remaining -= Buffer.byteLength(key) + 4;
      if (Array.isArray(result)) result.push(visit(descriptor.value, depth + 1));
      else result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(item); return result;
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > maximum) return { value: null, truncated: true };
  return { value: result, truncated };
}
function liveOwner(owner) {
  if (owner.pid === process.pid) return owner.token === PROCESS_TOKEN;
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : null; }
}

/**
 * Main-only local journal. Immutable, fsynced records are published with an
 * exclusive hard link; a partial record is never a valid stage transition.
 * No record grants filesystem, cleanup, prepared-plan or process authority.
 * This guards ordinary/replaced paths, not every hostile same-user OS race.
 * Main's single-instance lock must precede startSession().
 */
class DiagnosticJournal {
  #pending = Promise.resolve();
  #initialized = false;
  #directories = new Map();
  #records = new Map();
  #session = null;
  #sequence = 0;
  #started = false;
  #closed = false;
  #status = { available: true, incomplete: false, failures: 0, lastFailure: null, notices: [] };
  constructor({ directory, versions = {}, now = () => Date.now(), isOwnerAlive = liveOwner, io = fs, limits = {} }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\0\r\n]/.test(directory)) {
      throw new TypeError('Diagnostics require an absolute main-owned application directory.');
    }
    this.base = path.resolve(directory); this.directory = path.join(this.base, NAMESPACE);
    this.eventDirectory = path.join(this.directory, 'events'); this.stderrDirectory = path.join(this.directory, 'stderr');
    this.io = io; this.now = now; this.isOwnerAlive = isOwnerAlive;
    this.limits = { ...LIMITS, ...limits };
    if (Object.keys(limits).some(key => !Object.hasOwn(LIMITS, key)) || Object.entries(this.limits).some(([key, value]) =>
      !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) || this.limits.eventBytes < 4096) throw new TypeError('Invalid diagnostic bounds.');
    this.versions = this.#versions(versions);
  }
  #versions(value) {
    requestObject(value, ['app', 'electron', 'ffmpeg', 'ffprobe']);
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, boundedText(val, 512).text]));
  }
  #time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) throw new Error('Invalid diagnostic clock.');
    return value;
  }
  #enqueue(operation) {
    const result = this.#pending.then(operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }
  #notice(message) {
    this.#status.incomplete = true;
    if (!this.#status.notices.includes(message) && this.#status.notices.length < 20) this.#status.notices.push(message);
  }
  #failure(error) {
    this.#status.available = false; this.#status.incomplete = true; this.#status.failures++;
    // A filesystem error may contain a private path. Only a bounded code is
    // part of the generic status; private details belong in deliberate local UI.
    this.#status.lastFailure = { code: /^[A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'DIAGNOSTICS_UNAVAILABLE',
      message: 'Diagnostic history could not be persisted or read completely. Current work must not be reported as fully logged.' };
    return { persisted: false, status: this.snapshot() };
  }
  snapshot() { return clone({ ...this.#status, sessionId: this.#session, directory: this.directory }); }
  flush() { return this.#pending.then(() => this.snapshot()); }

  async #guard(directory, create = false) {
    const parent = path.dirname(directory);
    if (parent !== directory) await this.#guard(parent);
    let stat;
    try { stat = await this.io.lstat(directory); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await this.io.mkdir(directory); stat = await this.io.lstat(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('UNSAFE_DIAGNOSTIC_PATH', 'Diagnostic directories must not be links or reparse aliases.');
    const prior = this.#directories.get(directory);
    if (prior && !sameObject(prior, stat)) throw fail('DIAGNOSTIC_PATH_CHANGED', 'Diagnostic directory identity changed.');
    this.#directories.set(directory, stat);
  }
  async #safeRead(filename, maximum) {
    await this.#guard(path.dirname(filename));
    const before = await this.io.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) throw fail('UNSAFE_DIAGNOSTIC_FILE', 'Invalid diagnostic file.');
    const handle = await this.io.open(filename, 'r');
    try {
      const opened = await handle.stat();
      if (!sameObject(before, opened) || !opened.isFile() || opened.nlink !== 1 || opened.size > maximum) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Diagnostic file changed.');
      const bytes = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break; length += read.bytesRead;
      }
      const after = await handle.stat(), linked = await this.io.lstat(filename);
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || !sameObject(after, linked) || linked.isSymbolicLink() || after.nlink !== 1 || linked.nlink !== 1) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Diagnostic file changed while reading.');
      return { bytes: bytes.subarray(0, length), stat: after };
    } finally { await handle.close(); }
  }
  #decode(bytes, id) {
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (!plain(envelope) || envelope.namespace !== NAMESPACE || envelope.version !== 1 || !plain(envelope.event)
      || envelope.digest !== sha(JSON.stringify(envelope.event))) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid diagnostic record.');
    const event = envelope.event;
    if (event.id !== id || !UUID.test(event.id) || !UUID.test(event.sessionId) || !Number.isSafeInteger(event.sequence) || event.sequence < 0
      || !Number.isSafeInteger(event.at) || event.at < 0 || !['session-start', 'event', 'session-end', 'session-interrupted'].includes(event.type)
      || !STAGES.includes(event.stage) || !/^[A-Z][A-Z0-9_]{0,79}$/.test(event.reason)
      || !['info', 'warning', 'error', 'critical'].includes(event.severity)) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid diagnostic record fields.');
    if (event.type === 'session-start' && (!plain(event.owner) || !Number.isSafeInteger(event.owner.pid) || event.owner.pid < 1
      || !UUID.test(event.owner.token))) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid session owner.');
    if (['session-end', 'session-interrupted'].includes(event.type) && !OUTCOMES.includes(event.outcome)) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid terminal outcome.');
    if (event.stderr && (!plain(event.stderr) || !Number.isSafeInteger(event.stderr.bytes) || event.stderr.bytes < 0
      || event.stderr.bytes > this.limits.stderrBytes || typeof event.stderr.truncated !== 'boolean'
      || !/^[a-f0-9]{64}$/.test(event.stderr.sha256))) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid stderr descriptor.');
    if (event.stderr && Object.hasOwn(event.stderr, 'totalBytes') && (!Number.isSafeInteger(event.stderr.totalBytes)
      || event.stderr.totalBytes < Math.ceil(event.stderr.bytes / 3)
      || (!event.stderr.truncated && event.stderr.totalBytes > event.stderr.bytes))) {
      throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid upstream stderr byte count.');
    }
    for (const field of ['messageTruncated', 'contextTruncated']) if (Object.hasOwn(event, field) && typeof event[field] !== 'boolean') {
      throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid diagnostic truncation descriptor.');
    }
    if (Object.hasOwn(event, 'message') && (typeof event.message !== 'string'
      || boundedText(event.message, Math.min(8192, this.limits.eventBytes / 4)).truncated)) {
      throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid diagnostic message.');
    }
    if (Object.hasOwn(event, 'context')) {
      const checked = boundedContext(event.context, Math.floor(this.limits.eventBytes / 2));
      if (checked.truncated || JSON.stringify(checked.value) !== JSON.stringify(event.context)) {
        throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid diagnostic context.');
      }
    }
    if (event.loggingGap && (!plain(event.loggingGap) || !Number.isSafeInteger(event.loggingGap.failures)
      || event.loggingGap.failures < 1 || !/^[A-Z0-9_]{1,80}$/.test(event.loggingGap.lastCode))) throw fail('INVALID_DIAGNOSTIC_RECORD', 'Invalid logging-gap descriptor.');
    return event;
  }
  async #initialize() {
    if (this.#initialized) return;
    // Do not memoize a rejecting initialization promise. Public operations are
    // serialized and may retry transient mkdir/read failures on this instance.
    // Publish the recovered index only after the bounded scan finishes; a
    // failed partial scan must not leave stale records in a later retry.
    await this.#guard(this.base);
    await this.#guard(this.directory, true); await this.#guard(this.eventDirectory, true); await this.#guard(this.stderrDirectory, true);
    // Existing hostile/foreign data cannot force recovery to parse more than
    // the full configured storage allowance. Preserve it and report the limit.
    const usage = await this.#usage();
    if (usage.bytes > this.limits.bytes || usage.entries > this.limits.entries) throw fail('DIAGNOSTIC_STORAGE_LIMIT', 'Existing diagnostic data exceeds the recovery bounds.');
    const names = await this.io.readdir(this.eventDirectory);
    if (names.length > this.limits.entries) throw fail('DIAGNOSTIC_ENTRY_LIMIT', 'Too many diagnostic entries for bounded recovery.');
    const recovered = new Map();
    let recoveredBytes = 0;
    for (const name of names) {
      if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) { this.#notice('Unrecognized diagnostic files were preserved.'); continue; }
      try {
        const read = await this.#safeRead(path.join(this.eventDirectory, name), this.limits.eventBytes);
        recoveredBytes += read.bytes.length;
        if (recoveredBytes > this.limits.bytes) throw fail('DIAGNOSTIC_STORAGE_LIMIT', 'Diagnostic records grew beyond the recovery allowance.');
        const event = this.#decode(read.bytes, name.slice(0, -5));
        recovered.set(event.id, { event, stat: read.stat });
        if (event.loggingGap) this.#notice('A previous logging failure left diagnostic history incomplete.');
      } catch (error) {
        if (error.code === 'DIAGNOSTIC_STORAGE_LIMIT') throw error;
        this.#notice('Unreadable or changed diagnostic records were preserved; history is incomplete.');
      }
    }
    this.#records = recovered;
    this.#initialized = true;
  }
  async #publish(directory, name, bytes) {
    await this.#guard(directory);
    const temporary = path.join(directory, randomUUID() + '.tmp');
    const final = path.join(directory, name);
    let handle, owned;
    try {
      handle = await this.io.open(temporary, 'wx', 0o600); owned = await handle.stat();
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await this.#guard(directory);
      const linked = await this.io.lstat(temporary);
      if (!sameObject(owned, linked) || linked.isSymbolicLink() || linked.nlink !== 1) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Owned temporary diagnostic file changed.');
      await this.io.link(temporary, final);
    } finally {
      await handle?.close().catch(() => {});
      if (owned) {
        try {
          await this.#guard(directory);
          const current = await this.io.lstat(temporary);
          if (sameObject(owned, current) && !current.isSymbolicLink()) await this.io.unlink(temporary);
          else this.#notice('An uncertain diagnostic temporary file was retained.');
        } catch (error) { if (error.code !== 'ENOENT') this.#notice('Diagnostic temporary cleanup was incomplete.'); }
      }
    }
    return (await this.#safeRead(final, bytes.length)).stat;
  }
  async #usage() {
    let bytes = 0, entries = 0;
    for (const directory of [this.eventDirectory, this.stderrDirectory]) {
      await this.#guard(directory);
      const names = await this.io.readdir(directory);
      if (names.length > this.limits.entries) throw fail('DIAGNOSTIC_ENTRY_LIMIT', 'Too many diagnostic files.');
      for (const name of names) {
        const stat = await this.io.lstat(path.join(directory, name));
        // Unknown files consume space but never become cleanup authority.
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
          throw fail('UNSAFE_DIAGNOSTIC_FILE', 'An unsafe or unaccountable diagnostic entry was preserved.');
        }
        bytes += stat.size; entries++;
      }
    }
    return { bytes, entries };
  }
  #sessions() {
    const groups = new Map();
    for (const { event } of this.#records.values()) {
      if (!groups.has(event.sessionId)) groups.set(event.sessionId, []);
      groups.get(event.sessionId).push(event);
    }
    return [...groups].map(([id, events]) => {
      events.sort((a, b) => a.sequence - b.sequence || a.at - b.at);
      const start = events.find(e => e.type === 'session-start');
      const terminal = events.findLast(e => ['session-end', 'session-interrupted'].includes(e.type));
      return { id, events, start, terminal };
    });
  }
  async #removeRecord(event) {
    const filename = path.join(this.eventDirectory, event.id + '.json');
    const checked = await this.#safeRead(filename, this.limits.eventBytes);
    if (JSON.stringify(this.#decode(checked.bytes, event.id)) !== JSON.stringify(event)) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Retention record changed.');
    // Only matching regular files named by a validated internal UUID are ever
    // deleted. Unknown files and linked/replaced objects remain untouched.
    if (event.stderr) {
      const stderrPath = path.join(this.stderrDirectory, event.id + '.txt');
      try {
        const read = await this.#safeRead(stderrPath, this.limits.stderrBytes);
        if (sha(read.bytes) !== event.stderr.sha256) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Stderr changed.');
        await this.#guard(this.stderrDirectory); await this.io.unlink(stderrPath);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await this.#guard(this.eventDirectory);
    const current = await this.io.lstat(filename);
    if (!sameObject(checked.stat, current) || current.isSymbolicLink() || current.nlink !== 1) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Retention file changed.');
    await this.io.unlink(filename); this.#records.delete(event.id);
  }
  #terminalReserve(nextEvent) {
    const terminal = nextEvent && ['session-end', 'session-interrupted'].includes(nextEvent.type);
    const open = this.#sessions().filter(session => session.start && !session.terminal
      && !(terminal && session.id === nextEvent.sessionId));
    const starting = nextEvent?.type === 'session-start' && !open.some(session => session.id === nextEvent.sessionId);
    const count = open.length + (starting ? 1 : 0);
    return { bytes: count * TERMINAL_RESERVE_BYTES, entries: count };
  }
  async #prune(extra = 0, extraEntries = 0, nextEvent) {
    let usage = await this.#usage();
    const reserve = this.#terminalReserve(nextEvent);
    const fits = () => usage.bytes + extra + reserve.bytes <= this.limits.bytes
      && usage.entries + extraEntries + reserve.entries <= this.limits.entries;
    const cutoff = this.#time() - this.limits.retentionMs;
    const closed = this.#sessions().filter(s => s.start && s.terminal && s.id !== this.#session)
      .sort((a, b) => a.terminal.at - b.terminal.at);
    for (const session of closed) {
      if (session.terminal.at >= cutoff && fits()) break;
      // Keep the terminal marker until the final deletion, so an interrupted
      // rotation cannot manufacture a newly interrupted session on startup.
      const ordered = session.events.filter(e => e.id !== session.terminal.id).concat(session.terminal);
      for (const event of ordered) await this.#removeRecord(event);
      usage = await this.#usage();
    }
    if (!fits()) {
      throw fail('DIAGNOSTIC_STORAGE_LIMIT', 'Active or unrecognized diagnostic files exhaust the retention allowance, including protected terminal capacity.');
    }
    return usage;
  }
  async #write(event, stderr, stderrCapture) {
    // If storage becomes usable again, retain evidence of the gap. A later
    // restart must not turn a previously disclosed logging failure into a
    // misleadingly complete history merely because all surviving JSON parses.
    if (this.#status.failures) event.loggingGap = { failures: this.#status.failures, lastCode: this.#status.lastFailure?.code };
    let tail;
    if (stderr !== undefined) {
      tail = boundedText(stderr, this.limits.stderrBytes, true);
      event.stderr = { bytes: Buffer.byteLength(tail.text), sha256: sha(tail.text),
        truncated: tail.truncated || Boolean(stderrCapture?.truncated),
        ...(stderrCapture ? { totalBytes: stderrCapture.totalBytes } : {}) };
    }
    const bytes = Buffer.from(JSON.stringify({ namespace: NAMESPACE, version: 1, event, digest: sha(JSON.stringify(event)) }));
    if (bytes.length > this.limits.eventBytes) throw fail('DIAGNOSTIC_EVENT_LIMIT', 'Structured diagnostic event exceeds its bounded limit.');
    if (['session-end', 'session-interrupted'].includes(event.type) && (tail || bytes.length > TERMINAL_RESERVE_BYTES)) {
      throw fail('DIAGNOSTIC_EVENT_LIMIT', 'Terminal diagnostic record exceeds its reserved compact limit.');
    }
    await this.#prune(bytes.length + (event.stderr?.bytes || 0), tail ? 2 : 1, event);
    if (tail) await this.#publish(this.stderrDirectory, event.id + '.txt', Buffer.from(tail.text));
    // If this publication fails, a bounded orphan stderr may remain. Preserve
    // it and disclose incomplete logging; it is not a successful transition.
    const stat = await this.#publish(this.eventDirectory, event.id + '.json', bytes);
    this.#records.set(event.id, { event: clone(event), stat });
    this.#status.available = true;
    return { persisted: true, eventId: event.id, sequence: event.sequence, status: this.snapshot() };
  }
  startSession(options = {}) {
    requestObject(options, ['versions']);
    const versions = options.versions === undefined ? this.versions : this.#versions(options.versions);
    return this.#enqueue(async () => {
      if (this.#started) return { sessionId: this.#session, persisted: true, recovered: [], closed: this.#closed, status: this.snapshot() };
      const recovered = []; this.#session ||= randomUUID();
      try {
        await this.#initialize();
        for (const session of this.#sessions()) {
          if (!session.start || session.terminal) continue;
          const alive = await this.isOwnerAlive(session.start.owner);
          if (alive !== false) { this.#notice('An active or uncertain previous session was protected from retention.'); continue; }
          const event = { id: randomUUID(), sessionId: session.id, sequence: Math.max(...session.events.map(e => e.sequence)) + 1,
            at: this.#time(), type: 'session-interrupted', stage: 'recovery', reason: 'SESSION_INTERRUPTED', severity: 'warning', outcome: 'interrupted',
            message: 'The previous owner no longer exists. Work after its last durable event is unknown; no files or jobs were resumed.',
            context: { lastEventId: session.events.at(-1).id, recoveredBySessionId: this.#session } };
          await this.#write(event); recovered.push({ sessionId: session.id, lastEventId: event.context.lastEventId });
        }
        const result = await this.#write({ id: randomUUID(), sessionId: this.#session, sequence: 0, at: this.#time(), type: 'session-start',
          stage: 'startup', reason: 'SESSION_STARTED', severity: 'info', owner: { pid: process.pid, token: PROCESS_TOKEN }, versions });
        this.#started = true;
        return { ...result, sessionId: this.#session, recovered };
      } catch (error) { return { ...this.#failure(error), sessionId: this.#session, recovered }; }
    });
  }
  append(request) {
    requestObject(request, ['stage', 'reason', 'severity', 'message', 'context', 'stderr', 'stderrCapture', 'batchId', 'planId', 'fileId', 'jobId', 'invocationId']);
    if (!STAGES.includes(request.stage) || typeof request.reason !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(request.reason)
      || request.severity !== undefined && !['info', 'warning', 'error', 'critical'].includes(request.severity)) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic stage, reason or severity.');
    const fields = { stage: request.stage, reason: request.reason, severity: request.severity || 'info' };
    for (const key of ['batchId', 'planId', 'fileId', 'jobId', 'invocationId']) if (request[key] !== undefined) {
      if (typeof request[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request[key])) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid correlation ID.');
      fields[key] = request[key];
    }
    if (request.message !== undefined) {
      const text = boundedText(request.message, Math.min(8192, this.limits.eventBytes / 4)); fields.message = text.text; fields.messageTruncated = text.truncated;
    }
    if (request.context !== undefined) {
      const context = boundedContext(request.context, Math.floor(this.limits.eventBytes / 2)); fields.context = context.value; fields.contextTruncated = context.truncated;
    }
    const stderr = request.stderr;
    if (stderr !== undefined && typeof stderr !== 'string') throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Stderr must be text.');
    let stderrCapture;
    if (request.stderrCapture !== undefined) {
      requestObject(request.stderrCapture, ['totalBytes', 'truncated']);
      const { totalBytes, truncated } = request.stderrCapture;
      // The original byte count is descriptive evidence from the owned child,
      // never process authority. A tail already shortened upstream cannot become
      // a complete capture merely because it fits this journal's own limit.
      // totalBytes counts raw pipe bytes. UTF-8 replacement decoding may expand
      // each invalid byte into a three-byte U+FFFD; it is not lost capture.
      const textBytes = typeof stderr === 'string' ? Buffer.byteLength(stderr) : 0;
      const minimumRawBytes = typeof stderr === 'string' ? textBytes - 2 * (stderr.match(/\uFFFD/g)?.length || 0) : 0;
      if (typeof stderr !== 'string' || !Number.isSafeInteger(totalBytes) || totalBytes < 0
        || typeof truncated !== 'boolean' || totalBytes < minimumRawBytes
        || (!truncated && totalBytes > textBytes)) {
        throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Inconsistent upstream stderr capture descriptor.');
      }
      stderrCapture = { totalBytes, truncated };
    }
    return this.#enqueue(async () => {
      if (!this.#session || this.#closed) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Start an open diagnostic session first.');
      if (!this.#started) return this.#failure(fail('DIAGNOSTIC_SESSION_NOT_PERSISTED', 'The session start was not persisted.'));
      try {
        await this.#initialize();
        return await this.#write({ id: randomUUID(), sessionId: this.#session, sequence: ++this.#sequence,
          at: this.#time(), type: 'event', ...fields }, stderr, stderrCapture);
      } catch (error) { return this.#failure(error); }
    });
  }
  closeSession(options = {}) {
    requestObject(options, ['outcome']);
    const { outcome = 'completed' } = options;
    if (!OUTCOMES.includes(outcome) || outcome === 'interrupted') throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Choose a normal terminal session outcome.');
    return this.#enqueue(async () => {
      if (!this.#session || this.#closed) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'No open diagnostic session.');
      if (!this.#started) return this.#failure(fail('DIAGNOSTIC_SESSION_NOT_PERSISTED', 'The session start was not persisted.'));
      try {
        await this.#initialize();
        const result = await this.#write({ id: randomUUID(), sessionId: this.#session, sequence: ++this.#sequence,
          at: this.#time(), type: 'session-end', stage: 'shutdown', reason: outcome === 'cancelled' ? 'SESSION_CANCELLED' : 'SESSION_ENDED',
          severity: outcome === 'failed' ? 'error' : 'info', outcome });
        this.#closed = true; return result;
      } catch (error) { return this.#failure(error); }
    });
  }
  list(options = {}) {
    requestObject(options, ['limit', 'before', 'cursor']);
    const { limit = 50, before = Number.MAX_SAFE_INTEGER } = options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(before) || before < 0) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid diagnostic pagination.');
    if (options.cursor !== undefined && options.before !== undefined) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Use either a cursor or a timestamp filter.');
    const cursor = options.cursor === undefined ? null : parseCursor(options.cursor);
    return this.#enqueue(async () => {
      try {
        await this.#initialize();
        // The opaque cursor includes tie-breakers. Timestamp-only paging would
        // silently lose records sharing a millisecond at a page boundary.
        // `before` remains an optional time filter, not a next-page cursor.
        const eligible = [...this.#records.values()].map(r => r.event)
          .filter(e => e.at < before && (!cursor || newestFirst(e, cursor) > 0)).sort(newestFirst);
        const events = eligible.slice(0, limit);
        return { events: events.map(({ id, sessionId, at, type, stage, reason, severity, outcome }) => ({ id, sessionId, at, type, stage, reason, severity, ...(outcome ? { outcome } : {}) })),
          nextCursor: eligible.length > events.length ? cursorOf(events.at(-1)) : null, status: this.snapshot() };
      } catch (error) { return { events: [], nextCursor: null, ...this.#failure(error) }; }
    });
  }
  async #readEvent(id) {
    const known = this.#records.get(id);
    if (!known) throw fail('DIAGNOSTIC_NOT_FOUND', 'The diagnostic record is missing or has expired.');
    const record = await this.#safeRead(path.join(this.eventDirectory, id + '.json'), this.limits.eventBytes);
    const event = this.#decode(record.bytes, id);
    if (JSON.stringify(event) !== JSON.stringify(known.event)) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Diagnostic record changed.');
    if (event.stderr) {
      try {
        const read = await this.#safeRead(path.join(this.stderrDirectory, id + '.txt'), this.limits.stderrBytes);
        if (sha(read.bytes) !== event.stderr.sha256 || read.bytes.length !== event.stderr.bytes) throw fail('DIAGNOSTIC_FILE_CHANGED', 'Stderr content changed.');
        event.stderr.text = read.bytes.toString('utf8');
      } catch { event.stderr.unavailable = true; this.#notice('An invocation stderr tail is missing or changed.'); }
    }
    return event;
  }
  read(id) {
    requireId(id);
    return this.#enqueue(async () => {
      try { await this.#initialize(); return { event: await this.#readEvent(id), status: this.snapshot() }; }
      catch (error) { return { event: null, ...this.#failure(error) }; }
    });
  }
  readSession(id, options = {}) {
    requireId(id); requestObject(options, ['limit', 'afterSequence']);
    const { limit = 100, afterSequence = -1 } = options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(afterSequence) || afterSequence < -1) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Invalid session pagination.');
    return this.#enqueue(async () => {
      try {
        await this.#initialize();
        const session = this.#sessions().find(s => s.id === id);
        if (!session) return { session: null, status: this.snapshot() };
        const selected = session.events.filter(e => e.sequence > afterSequence).slice(0, limit);
        const events = [];
        for (const event of selected) events.push(await this.#readEvent(event.id));
        return { session: { id, outcome: session.terminal?.outcome || 'open', events,
          nextSequence: selected.length === limit ? selected.at(-1).sequence : null }, status: this.snapshot() };
      } catch (error) { return { session: null, ...this.#failure(error) }; }
    });
  }
  prune() {
    return this.#enqueue(async () => {
      try { await this.#initialize(); return { ...(await this.#prune()), status: this.snapshot() }; }
      catch (error) { return this.#failure(error); }
    });
  }
  buildRedactedExport(options = {}) {
    requestObject(options, ['eventIds']);
    const { eventIds } = options;
    if (!Array.isArray(eventIds) || eventIds.length < 1 || eventIds.length > 50) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Choose 1 to 50 distinct diagnostic IDs.');
    const descriptors = Object.getOwnPropertyDescriptors(eventIds);
    if (Reflect.ownKeys(descriptors).length !== eventIds.length + 1 || Array.from({ length: eventIds.length }, (_, index) =>
      descriptors[index]).some(descriptor => !descriptor || !Object.hasOwn(descriptor, 'value'))) {
      throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Diagnostic IDs must be a plain list of values.');
    }
    // Snapshot the selected IDs before queuing; later caller edits cannot
    // change which private records the user deliberately selected for export.
    const selectedIds = Array.from({ length: eventIds.length }, (_, index) => requireId(descriptors[index].value));
    if (new Set(selectedIds).size !== selectedIds.length) throw fail('INVALID_DIAGNOSTIC_REQUEST', 'Choose 1 to 50 distinct diagnostic IDs.');
    return this.#enqueue(async () => {
      try {
        await this.#initialize();
        const events = [];
        for (const id of selectedIds) events.push(await this.#readEvent(id));
        const data = redactEvents(events);
        // Selected records can be intact while another session has a known
        // gap. Keep that distinction, and never describe a redacted subset as
        // complete history merely because its surviving files parse.
        data.coverage.journalKnownIncomplete = this.#status.incomplete;
        data.coverage.journalAvailable = this.#status.available;
        data.coverage.journalFailureCount = this.#status.failures;
        return { data, json: JSON.stringify(data, null, 2), status: this.snapshot() };
      } catch (error) { return { data: null, json: null, ...this.#failure(error) }; }
    });
  }
}

const EXPORT_SCALARS = new Set(['codec', 'codec_name', 'profile', 'profileId', 'backend', 'encoder', 'preset', 'qualityMode', 'recipeId',
  'pix_fmt', 'pixelFormat', 'color_primaries', 'color_transfer', 'color_space', 'color_range', 'format_name', 'signal', 'exitCode',
  'width', 'height', 'bitDepth', 'quality', 'channels', 'sample_rate', 'duration', 'durationSeconds', 'frames', 'frameCount', 'rate',
  'start', 'end', 'startUs', 'endUs', 'size', 'bytes', 'cancelled', 'valid', 'mode', 'code', 'phase', 'outcome', 'retained', 'published',
  'mtimeNs', 'ctimeNs', 'birthtimeNs', 'version', 'kind', 'status', 'stage', 'checkpoint', 'comparison', 'contentMismatch',
  'readFailure', 'validationCurrent', 'completed', 'reason', 'complete', 'algorithm', 'failures', 'lastCode']);
const EXPORT_GROUPS = new Set(['settings', 'requestedSettings', 'resolvedSettings', 'probe', 'streams', 'format', 'video', 'audio',
  'source', 'expected', 'actual', 'before', 'after', 'validation', 'identity', 'operation', 'output', 'exit',
  'sourceIdentityDiagnostic', 'sourceAssessment', 'diagnostic', 'outputDisposition', 'cleanup', 'warnings', 'warning', 'contentEvidence']);
const PATH_KEYS = new Set(['path', 'inputPath', 'outputPath', 'canonicalPath', 'sourcePath', 'destinationPath', 'executablePath', 'file', 'directory', 'destination']);
const IDENTITY_FIELDS = new Set(['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest']);
const PRIVATE_IDENTITY = new Map([['dev', 'DEVICE'], ['ino', 'FILE'], ['sparseDigest', 'DIGEST'], ['sha256', 'DIGEST'], ['digest', 'DIGEST']]);
const VALUE_OPTIONS = /^-(?:c(?::[avs](?::\d+)?)?|codec(?::[avs](?::\d+)?)?|preset|crf|cq|b|rc|tune|profile|pix_fmt|color_primaries|color_trc|colorspace|color_range|fps_mode|f|map|map_metadata|map_chapters|disposition|q|qp_i|qp_p|qp_b|global_quality|multipass|bf|b_ref_mode|ar|ac|ss|t|to|frames|loglevel|progress)(?::[avs](?::\d+)?)?(?::\d+)?$/;
const isPath = value => typeof value === 'string' && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value));
const containsLocation = value => /[+-]\d{2,3}(?:\.\d+)?[+-]\d{2,3}(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?\/?/.test(value)
  || /(?:^|[_.:-])(?:gps|latitude|longitude|geolocation|location|iso6709)(?:$|[_.:-])/i.test(value);

/** Export intentionally omits all free prose, stderr and arbitrary metadata.
 * Regexes alone cannot reliably remove an address or coordinates embedded in
 * a sentence. Raw local evidence remains available for deliberate review, but
 * default sharing never includes it or a reverse path-alias dictionary.
 */
function redactEvents(events) {
  const aliases = new Map();
  const alias = value => {
    const key = /^[a-z]:[\\/]|^\\\\/i.test(value) ? value.replace(/\//g, '\\').toLowerCase() : value;
    if (!aliases.has(key)) aliases.set(key, `PATH_${String(aliases.size + 1).padStart(3, '0')}`);
    return `[${aliases.get(key)}]`;
  };
  const identifiers = new Map(), counts = new Map();
  const identifier = (value, kind) => {
    if (value === null || value === undefined) return null;
    if (!['string', 'number'].includes(typeof value)) return '[omitted]';
    // Equality/difference remains reviewable without exposing device IDs,
    // file IDs or content fingerprints which could correlate private media.
    const key = kind + ':' + value;
    if (!identifiers.has(key)) {
      const count = (counts.get(kind) || 0) + 1; counts.set(kind, count);
      identifiers.set(key, `[${kind}_${String(count).padStart(3, '0')}]`);
    }
    return identifiers.get(key);
  };
  const safeValue = value => typeof value === 'number' || typeof value === 'boolean' || value === null ? value
    : typeof value === 'string' && /^[a-zA-Z0-9_.:+\/-]{1,128}$/.test(value) && !isPath(value)
      && !/\w+:\/\//.test(value) && !containsLocation(value) ? value : '[omitted]';
  const args = values => {
    if (!Array.isArray(values)) return '[omitted]';
    const result = [];
    for (let i = 0; i < Math.min(values.length, 256); i++) {
      const value = values[i];
      if (isPath(value)) result.push(alias(value));
      else if (typeof value === 'string' && /^-metadata(?::[a-z0-9:]+)?$/i.test(value)) { result.push(value, '[metadata omitted]'); i++; }
      else if (value === '-i') { result.push(value, isPath(values[i + 1]) ? alias(values[++i]) : '[input omitted]'); if (!isPath(values[i])) i++; }
      else if (typeof value === 'string' && VALUE_OPTIONS.test(value)) { result.push(value, safeValue(values[++i])); }
      else if (['-n', '-nostdin', '-nostats', '-hide_banner', '-an', '-sn', '-dn', '-xerror'].includes(value)) result.push(value);
      else { result.push('[argument omitted]'); if (typeof value === 'string' && value.startsWith('-') && i + 1 < values.length && !String(values[i + 1]).startsWith('-')) i++; }
    }
    return result;
  };
  const context = value => {
    if (Array.isArray(value)) return value.slice(0, 128).map(item => plain(item) ? context(item) : '[omitted]');
    if (!plain(value)) return '[omitted]';
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (PATH_KEYS.has(key)) result[key] = isPath(item) ? alias(item) : '[omitted]';
      else if (PRIVATE_IDENTITY.has(key)) result[key] = identifier(item, PRIVATE_IDENTITY.get(key));
      else if (key === 'changedFields') result[key] = Array.isArray(item)
        ? item.slice(0, 32).map(field => IDENTITY_FIELDS.has(field) ? field : '[unknown field]') : '[omitted]';
      else if (key === 'argv' || key === 'args') result[key] = args(item);
      else if (key === 'runtimeVersions' && plain(item)) result[key] = Object.fromEntries(
        Object.entries(item).filter(([name]) => ['ffmpeg', 'ffprobe'].includes(name))
          .map(([name, version]) => [name, typeof version === 'string' && /^\d+(?:\.\d+){1,3}(?:[-+][a-zA-Z0-9._-]+)?$/.test(version) ? version : '[omitted]']));
      else if (EXPORT_GROUPS.has(key)) result[key] = context(item);
      else if (EXPORT_SCALARS.has(key)) result[key] = safeValue(item);
    }
    return result;
  };
  const capture = event => ({ messageTruncated: Boolean(event.messageTruncated), contextTruncated: Boolean(event.contextTruncated),
    stderrTruncated: Boolean(event.stderr?.truncated), stderrUnavailable: Boolean(event.stderr?.unavailable),
    stderrUpstreamUnknown: Boolean(event.stderr && !Object.hasOwn(event.stderr, 'totalBytes')), loggingGap: Boolean(event.loggingGap) });
  const complete = event => !Object.values(capture(event)).some(Boolean);
  return { namespace: 'ffmpeg-encoder-redacted-diagnostics', version: 1,
    notice: 'Review before sharing. Free-form messages, stderr, all metadata/tags and unknown fields are omitted. Paths, device/file identifiers and content fingerprints are aliased without an included reverse mapping. No upload is performed.',
    coverage: { scope: 'selected-events-only', selectedEvents: events.length, exportedEvents: events.length,
      selectedCaptureComplete: events.every(complete), intentionalPrivacyRedaction: true,
      journalKnownIncomplete: null, journalAvailable: null, journalFailureCount: null },
    events: events.map(event => ({ id: event.id, sessionId: event.sessionId, sequence: event.sequence, at: event.at, type: event.type,
      stage: event.stage, reason: event.reason, severity: event.severity, ...(event.outcome ? { outcome: event.outcome } : {}),
      capture: { ...capture(event), complete: complete(event) },
      ...Object.fromEntries(['batchId', 'planId', 'fileId', 'jobId', 'invocationId'].filter(key => event[key] !== undefined)
        .map(key => [key, identifier(event[key], key.replace(/Id$/, '').toUpperCase())])),
      ...(event.versions ? { versions: Object.fromEntries(Object.entries(event.versions).filter(([key]) => ['app', 'electron', 'ffmpeg', 'ffprobe'].includes(key))
        .map(([key, value]) => [key, /^\d+(?:\.\d+){1,3}(?:[-+][a-zA-Z0-9.-]+)?$/.test(value) ? value : '[omitted]'])) } : {}),
      ...(event.message ? { message: '[Free-form message omitted]' } : {}),
      ...(event.loggingGap ? { loggingGap: context(event.loggingGap) } : {}),
      ...(event.context ? { context: context(event.context) } : {}),
      ...(event.stderr ? { stderr: { omitted: true, bytes: event.stderr.bytes, truncated: event.stderr.truncated,
        ...(Object.hasOwn(event.stderr, 'totalBytes') ? { totalBytes: event.stderr.totalBytes } : {}), unavailable: Boolean(event.stderr.unavailable) } } : {}) })) };
}

module.exports = { DiagnosticJournal, NAMESPACE, LIMITS, STAGES, redactEvents };
