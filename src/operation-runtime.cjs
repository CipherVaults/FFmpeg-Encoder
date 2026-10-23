'use strict';

// Main-private observations, never IPC grants. A retained read handle lets us
// compare the same file object at each boundary; Windows CreateProcess still
// opens its executable by path. Node does not expose an executable image pin or
// Windows share-mode control, so this is bounded observation, not immunity to
// hostile concurrent replacement between checks and process creation.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { ToolError, runTool, boundedToolStderr } = require('./process-runner.cjs');

const TOOLS = ['ffmpeg', 'ffprobe'];
const MAX_HASH_AGE_MS = 5 * 60 * 1000;
const MAX_HASH_INVOCATIONS = 64;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const UUID = /^GPU-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DRIVER = /^\d{1,4}\.\d{1,6}(?:\.\d{1,6}){0,2}$/;
const LIMITATIONS = Object.freeze([
  'Executable paths, retained file handles and stamps are checked before invocation and after child close. The initial pair and each five-minute/64-invocation boundary receive full SHA256 checks.',
  'Windows CreateProcess opens by path; retained Node read handles do not pin the launched image or prevent every concurrent rename/write. Same-stamp hostile mutation between full hashes is outside this observation guarantee.',
  'A current NVIDIA UUID and driver observation binds an exact environment; it does not qualify media, encoder settings, driver internals or an unobserved multi-adapter selection.',
]);
const own = (value, key) => Object.hasOwn(value, key);
const fail = (code, message, details) => { throw new ToolError(code, message, details); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_OPERATION_RUNTIME', 'Runtime options must be inert records.');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !own(value, key)) || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) fail('INVALID_OPERATION_RUNTIME', 'Runtime options have missing or unsupported fields.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) fail('INVALID_OPERATION_RUNTIME', 'Runtime options cannot contain accessors or hidden fields.');
  }
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function signalValue(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_OPERATION_RUNTIME', 'An operation signal must be a native AbortSignal.');
}
function interrupted(signal) { if (signal?.aborted) fail('CANCELLED', 'Runtime observation was cancelled.'); }
function stamp(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])]));
}
function ordinary(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino <= 0n) fail('OPERATION_RUNTIME_STALE', 'Runtime must remain an ordinary, singly linked file with a known file identity.');
}
function reason(value) {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,512}$/.test(value) || !value.trim()) fail('INVALID_OPERATION_RUNTIME', 'Invalidation needs a bounded diagnostic reason.');
  return value;
}
function nvidia(value) {
  record(value, ['adapterIdentity', 'driverVersion']);
  if (typeof value.adapterIdentity !== 'string' || !UUID.test(value.adapterIdentity)
      || typeof value.driverVersion !== 'string' || !DRIVER.test(value.driverVersion)) fail('INVALID_NVIDIA_OBSERVATION', 'One exact observed NVIDIA UUID and driver version are required.');
  return { adapterIdentity: `GPU-${value.adapterIdentity.slice(4).toLowerCase()}`, driverVersion: value.driverVersion };
}

// The main-owned provider uses a fixed executable and fixed two-column query.
// Empty/extra rows, headers and additional columns are ambiguous, not defaults.
function parseNvidiaObservation(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536) fail('INVALID_NVIDIA_OBSERVATION', 'NVIDIA observation exceeds its bounded output.');
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length !== 1) fail('INVALID_NVIDIA_OBSERVATION', 'NVIDIA observation must identify exactly one adapter.');
  const columns = lines[0].split(',').map(value => value.trim());
  if (columns.length !== 2) fail('INVALID_NVIDIA_OBSERVATION', 'NVIDIA observation must contain only UUID and driver version.');
  return freeze(nvidia({ adapterIdentity: columns[0], driverVersion: columns[1] }));
}

class OperationRuntimeObserver {
  #runtime; #pins; #observeNvidia; #run; #now; #hashAge; #hashCalls;
  #pair = null; #epoch = 0; #tokens = new WeakMap(); #tail = Promise.resolve(); #closed = false; #closing = null; #active = null;
  constructor(options) {
    const keys = ['runtime', 'pins', 'observeNvidia', 'run', 'now', 'maxHashAgeMs', 'maxInvocationsBetweenHashes'];
    record(options, keys, ['runtime', 'pins']); record(options.runtime, TOOLS); record(options.pins, TOOLS);
    this.#runtime = {}; this.#pins = {};
    for (const name of TOOLS) {
      const file = options.runtime[name], pin = options.pins[name];
      if (typeof file !== 'string' || file.length > 32767 || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) fail('INVALID_OPERATION_RUNTIME', 'Main must provide fixed absolute runtime paths.');
      record(pin, ['sizeBytes', 'sha256']);
      if (!Number.isSafeInteger(pin.sizeBytes) || pin.sizeBytes < 1 || pin.sizeBytes > MAX_BINARY_BYTES
          || typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256)) fail('INVALID_OPERATION_RUNTIME', 'Runtime pins must be bounded immutable sizes and SHA256 hashes.');
      this.#runtime[name] = path.resolve(file); this.#pins[name] = { sizeBytes: pin.sizeBytes, sha256: pin.sha256 };
    }
    if ((process.platform === 'win32' ? this.#runtime.ffmpeg.toLowerCase() : this.#runtime.ffmpeg)
        === (process.platform === 'win32' ? this.#runtime.ffprobe.toLowerCase() : this.#runtime.ffprobe)) fail('INVALID_OPERATION_RUNTIME', 'The paired runtime needs two distinct fixed paths.');
    this.#observeNvidia = options.observeNvidia;
    this.#run = options.run === undefined ? runTool : options.run; this.#now = options.now === undefined ? Date.now : options.now;
    if (this.#observeNvidia !== undefined && typeof this.#observeNvidia !== 'function'
        || typeof this.#run !== 'function' || typeof this.#now !== 'function') fail('INVALID_OPERATION_RUNTIME', 'Runtime collectors, runner and clock must be main-owned functions.');
    this.#hashAge = options.maxHashAgeMs === undefined ? MAX_HASH_AGE_MS : options.maxHashAgeMs;
    this.#hashCalls = options.maxInvocationsBetweenHashes === undefined ? MAX_HASH_INVOCATIONS : options.maxInvocationsBetweenHashes;
    if (!Number.isSafeInteger(this.#hashAge) || this.#hashAge < 1 || this.#hashAge > MAX_HASH_AGE_MS
        || !Number.isSafeInteger(this.#hashCalls) || this.#hashCalls < 1 || this.#hashCalls > MAX_HASH_INVOCATIONS) fail('INVALID_OPERATION_RUNTIME', 'Full hashing cannot exceed the five-minute/64-invocation policy.');
    freeze(this.#runtime); freeze(this.#pins);
  }
  #time() {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) fail('OPERATION_RUNTIME_STALE', 'Runtime observation clock is unavailable.');
    return value;
  }
  #serial(action) {
    const work = this.#tail.then(action); this.#tail = work.catch(() => {}); return work;
  }
  #token(token) {
    const observed = token && typeof token === 'object' ? this.#tokens.get(token) : null;
    if (this.#closed || !observed || observed.epoch !== this.#epoch || observed.invalidated) fail('OPERATION_RUNTIME_STALE', 'Only this observer\'s current in-process runtime observation is usable.');
    return observed;
  }
  async #dropPair() {
    const pair = this.#pair; this.#pair = null; this.#epoch++;
    if (pair) await Promise.all(TOOLS.map(name => pair.tools[name].handle.close()));
  }
  async #stable(tool) {
    await assertOrdinaryPath(tool.canonicalPath);
    const [held, atPath] = await Promise.all([tool.handle.stat({ bigint: true }), fsp.lstat(tool.canonicalPath, { bigint: true })]);
    ordinary(held); ordinary(atPath);
    if (!same(stamp(held), tool.identity) || !same(stamp(atPath), tool.identity)) fail('OPERATION_RUNTIME_STALE', 'The runtime path, file object or stamp changed.');
    const canonical = await fsp.realpath(tool.canonicalPath);
    if ((process.platform === 'win32' ? canonical.toLowerCase() : canonical)
        !== (process.platform === 'win32' ? tool.canonicalPath.toLowerCase() : tool.canonicalPath)) fail('OPERATION_RUNTIME_STALE', 'Runtime canonical path changed.');
  }
  async #hash(tool, pin, signal) {
    await this.#stable(tool); interrupted(signal);
    const hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(1024 * 1024, pin.sizeBytes));
    for (let position = 0; position < pin.sizeBytes;) {
      interrupted(signal);
      const { bytesRead } = await tool.handle.read(buffer, 0, Math.min(buffer.length, pin.sizeBytes - position), position);
      if (!bytesRead) fail('OPERATION_RUNTIME_STALE', 'Runtime bytes ended before the pinned size.');
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const actual = hash.digest('hex'); await this.#stable(tool); interrupted(signal);
    if (actual !== pin.sha256) fail('OPERATION_RUNTIME_STALE', 'Runtime SHA256 differs from its immutable main-owned pin.');
    return actual;
  }
  async #openPair(signal) {
    const tools = {};
    try {
      for (const name of TOOLS) {
        interrupted(signal); const canonicalPath = await assertOrdinaryPath(this.#runtime[name]);
        const before = await fsp.lstat(canonicalPath, { bigint: true }); ordinary(before);
        if (before.size !== BigInt(this.#pins[name].sizeBytes)) fail('OPERATION_RUNTIME_STALE', 'Runtime size differs from its immutable main-owned pin.');
        const handle = await fsp.open(canonicalPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        tools[name] = { canonicalPath, handle, identity: stamp(before), sizeBytes: this.#pins[name].sizeBytes };
        tools[name].sha256 = await this.#hash(tools[name], this.#pins[name], signal);
      }
      // The first binary must also remain unchanged while the second is read.
      for (const name of TOOLS) await this.#stable(tools[name]);
      const runtimeIdentity = createHash('sha256').update(JSON.stringify(TOOLS.map(name => ({ sizeBytes: tools[name].sizeBytes, sha256: tools[name].sha256 })))).digest('hex');
      this.#pair = { tools, runtimeIdentity, hashedAt: this.#time(), invocations: 0 };
    } catch (error) {
      await Promise.all(Object.values(tools).map(tool => tool.handle.close())); this.#epoch++;
      if (error.code === 'CANCELLED' || error.code === 'OPERATION_RUNTIME_STALE') throw error;
      throw new ToolError('OPERATION_RUNTIME_STALE', `The fixed runtime could not be observed: ${String(error.message).slice(0, 512)}`, { cause: error });
    }
  }
  async #checkPair(signal) {
    if (!this.#pair) fail('OPERATION_RUNTIME_STALE', 'Runtime file observation is unavailable.');
    const pair = this.#pair;
    try {
      interrupted(signal);
      for (const name of TOOLS) await this.#stable(pair.tools[name]);
      const time = this.#time();
      if (time < pair.hashedAt || time - pair.hashedAt >= this.#hashAge || pair.invocations >= this.#hashCalls) {
        for (const name of TOOLS) await this.#hash(pair.tools[name], this.#pins[name], signal);
        pair.hashedAt = this.#time(); pair.invocations = 0;
      }
      interrupted(signal);
    } catch (error) {
      await this.#dropPair();
      if (error.code === 'CANCELLED') throw error;
      throw new ToolError('OPERATION_RUNTIME_STALE', 'The observed runtime file pair is no longer current.', { cause: error });
    }
  }
  async #environment(hardware, signal) {
    if (hardware === 'CPU') return null;
    if (!this.#observeNvidia) fail('OPERATION_RUNTIME_UNOBSERVED', 'A fixed main-owned NVIDIA observation provider is required.');
    interrupted(signal); const observed = nvidia(await this.#observeNvidia({ signal })); interrupted(signal);
    return { ...observed, runtimeVersion: `FFmpeg9.0.2:${this.#pair.runtimeIdentity}` };
  }
  async observe(options) {
    record(options, ['hardware', 'signal'], ['hardware']); signalValue(options.signal);
    if (!['CPU', 'NVIDIA'].includes(options.hardware)) fail('INVALID_OPERATION_RUNTIME', 'Only CPU or an exactly observed NVIDIA environment is supported.');
    return this.#serial(async () => {
      if (this.#closed) fail('OPERATION_RUNTIME_STALE', 'Runtime observer is closed.');
      if (this.#active) fail('OPERATION_RUNTIME_BUSY', 'An owned runtime child is still active.');
      interrupted(options.signal);
      if (!this.#pair) await this.#openPair(options.signal); else await this.#checkPair(options.signal);
      let environment;
      try { environment = await this.#environment(options.hardware, options.signal); await this.#checkPair(options.signal); }
      catch (error) { this.#epoch++; throw error; }
      if (this.#closed) fail('OPERATION_RUNTIME_STALE', 'Runtime observer closed during observation.');
      const token = Object.freeze({}), snapshot = freeze({ runtimeIdentity: this.#pair.runtimeIdentity, environment,
        observedAt: this.#time(), tools: Object.fromEntries(TOOLS.map(name => { const tool = this.#pair.tools[name];
          return [name, { canonicalPath: tool.canonicalPath, sizeBytes: tool.sizeBytes, sha256: tool.sha256, identity: { ...tool.identity } }]; })), limitations: [...LIMITATIONS] });
      this.#tokens.set(token, { epoch: this.#epoch, hardware: options.hardware, snapshot, invalidated: null }); return token;
    });
  }
  snapshot(token) { return this.#token(token).snapshot; }
  async requireCurrent(token, options = {}) {
    record(options, ['signal'], []); signalValue(options.signal);
    return this.#serial(async () => {
      const observed = this.#token(token);
      try {
        interrupted(options.signal); await this.#checkPair(options.signal);
        const environment = await this.#environment(observed.hardware, options.signal); await this.#checkPair(options.signal);
        if (!same(environment, observed.snapshot.environment)) fail('OPERATION_RUNTIME_STALE', 'The observed NVIDIA adapter or driver changed.');
        this.#token(token); return observed.snapshot;
      } catch (error) {
        observed.invalidated = 'A current runtime/environment observation failed.';
        if (error.code === 'CANCELLED') throw error;
        throw new ToolError('OPERATION_RUNTIME_STALE', 'The exact runtime/device observation is no longer current.', { cause: error });
      }
    });
  }
  invalidate(token, diagnosticReason) { const observed = this.#token(token); observed.invalidated = reason(diagnosticReason); }
  async invoke(token, tool, argv, options = {}) {
    const allowed = ['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onChild', 'onProgress', 'onStdoutChunk', 'onOutputBytes', 'input'];
    record(options, allowed, []); signalValue(options.signal);
    if (!TOOLS.includes(tool) || !Array.isArray(argv) || argv.length > 8192
        || Reflect.ownKeys(argv).length !== argv.length + 1) fail('INVALID_OPERATION_RUNTIME', 'Invoke requires one fixed runtime tool and bounded main-built arguments.');
    let argumentBytes = 0;
    for (let index = 0; index < argv.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(argv, String(index));
      if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string'
          || descriptor.value.includes('\0') || descriptor.value.length > 32767) fail('INVALID_OPERATION_RUNTIME', 'Runtime arguments must be dense inert strings.');
      argumentBytes += Buffer.byteLength(descriptor.value);
    }
    if (argumentBytes > 1024 * 1024 || options.onChild !== undefined && typeof options.onChild !== 'function'
        || options.onOutputBytes !== undefined && typeof options.onOutputBytes !== 'function') fail('INVALID_OPERATION_RUNTIME', 'Runtime invocation arguments or callbacks are invalid.');
    this.#token(token);
    if (this.#active) fail('OPERATION_RUNTIME_BUSY', 'An owned runtime invocation is already active.');
    const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const active = { controller, done: null }; this.#active = active;
    const work = (async () => {
      let child, childClose, closePromise, primary, result, postError;
      const stop = () => { try { child?.kill(); } catch { /* retain actual ownership until close */ } };
      try {
        await this.requireCurrent(token, { signal });
        this.#pair.invocations++;
        result = await this.#run(this.#runtime[tool], argv.slice(), { ...options, signal, onChild: owned => {
          if (child || !owned || typeof owned.once !== 'function' || typeof owned.kill !== 'function') fail('OPERATION_RUNTIME_CHILD_INVALID', 'Runner supplied an invalid or duplicate child handle.');
          child = owned; closePromise = new Promise(resolve => { owned.once('close', (code, exitSignal) => { childClose = { code, signal: exitSignal }; resolve(); }); });
          signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop(); options.onChild?.(owned);
        } });
        if (!child) fail('OPERATION_RUNTIME_CHILD_UNOBSERVED', 'A successful runner result without an observed child cannot establish invocation closure.');
      } catch (error) { primary = error; }
      finally {
        if (child) { if (!childClose) stop(); await closePromise; signal.removeEventListener('abort', stop); }
        // The production runner settles after close AND sink drainage. An
        // injected early runner still cannot bypass a real supplied close event.
        try { await this.requireCurrent(token, { signal }); }
        catch (error) { postError = error; }
        if (signal.aborted || primary?.code === 'CANCELLED' || primary?.code === 'OPERATION_RUNTIME_CHILD_UNOBSERVED'
            || primary?.code === 'OPERATION_RUNTIME_CHILD_INVALID') {
          const observed = this.#tokens.get(token); if (observed) observed.invalidated = 'Invocation cancelled or child ownership was unobserved.';
        }
      }
      // Publication uncertainty is an earlier ownership fact, not a stale
      // runtime retry opportunity. Preserve it and its original diagnostics.
      if (primary?.code === 'PUBLICATION_UNCERTAIN' || primary?.code === 'CANCELLED') {
        if (postError) primary.runtimeFreshnessError = { code: postError.code, message: postError.message };
        throw primary;
      }
      if (postError) {
        if (primary) { postError.cause = primary; Object.assign(postError, boundedToolStderr(primary));
          for (const key of ['stdoutCapture', 'exitCode', 'exitSignal']) if (own(primary, key)) postError[key] = primary[key]; }
        throw postError;
      }
      if (primary) throw primary;
      if (childClose.code !== 0) fail('OPERATION_RUNTIME_CHILD_FAILED', 'The observed runtime child did not close successfully.', {
        ...boundedToolStderr(result), exitCode: childClose.code, exitSignal: childClose.signal,
        ...(result && own(result, 'stdoutCapture') ? { stdoutCapture: result.stdoutCapture } : {}),
      });
      return result;
    })();
    active.done = work;
    try { return await work; }
    finally { if (this.#active === active) this.#active = null; }
  }
  async close() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      if (this.#active) { this.#active.controller.abort(); try { await this.#active.done; } catch { /* close still owns file-handle cleanup */ } }
      await this.#serial(() => this.#dropPair());
    })();
    return this.#closing;
  }
}

module.exports = { OperationRuntimeObserver, parseNvidiaObservation };
