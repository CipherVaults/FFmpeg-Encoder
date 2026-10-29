'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('./process-runner.cjs');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_NATIVE_TOOL', 'Main must supply an inert tool record.');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !Object.hasOwn(fields, key)) || Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !allowed.includes(key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail('INVALID_NATIVE_TOOL', 'Unknown, missing or accessor tool fields.');
}
function integer(value, max) { if (!Number.isSafeInteger(value) || value < 1 || value > max) fail('INVALID_NATIVE_TOOL', 'Explicit finite tool limits are required.'); return value; }
const digest = value => createHash('sha256').update(value).digest('hex');

// Main-private owned runner, not an executable/argv permission grant. The file
// runtime supplies only its own fixed commands under a separately admitted plan.
class NativeFileToolOwner {
  #run; #now; #lastTime = -1; #maximum; #deadline; #calls = 0; #children = 0; #bytes = 0; #active = null; #closed = false; #blocked = false; #receipts = new WeakMap(); #closing = null;
  constructor(options) {
    record(options, ['run', 'now', 'maximumChildren', 'maximumBytes', 'deadlineMs'], ['maximumChildren', 'maximumBytes', 'deadlineMs']);
    this.#run = options.run === undefined ? runTool : options.run; this.#now = options.now === undefined ? Date.now : options.now;
    if (typeof this.#run !== 'function' || typeof this.#now !== 'function') fail('INVALID_NATIVE_TOOL', 'Main-owned runner and clock required.');
    this.#maximum = { children: integer(options.maximumChildren, 64), bytes: integer(options.maximumBytes, 3 * 1024 ** 3) };
    const duration = integer(options.deadlineMs, 1800000), start = this.#time(); this.#deadline = start + duration;
    if (!Number.isSafeInteger(this.#deadline)) fail('NATIVE_TOOL_CLOCK', 'Native deadline exceeds its safe clock bound.');
  }
  #time() { const time = this.#now(); if (!Number.isSafeInteger(time) || time < this.#lastTime || time < 0) fail('NATIVE_TOOL_CLOCK', 'Native clock must remain safe and nondecreasing.'); this.#lastTime = time; return time; }
  snapshot() { return freeze({ calls: this.#calls, observedChildren: this.#children, bytes: this.#bytes, busy: Boolean(this.#active), admissionClosed: this.#closed, ownershipUnknown: this.#blocked }); }
  requireReceipt(receipt) { const owned = receipt && typeof receipt === 'object' && this.#receipts.get(receipt); if (!owned) fail('NATIVE_TOOL_RECEIPT_UNOWNED', 'Use this owner\'s original fully closed invocation.'); return owned; }
  async invoke(executable, argv, options = {}) {
    record(options, ['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onProgress', 'onStdoutChunk', 'onOutputBytes'], ['timeoutMs', 'stdoutLimit', 'stderrLimit']);
    if (this.#closed || this.#blocked) fail('NATIVE_TOOL_CLOSED', 'Native tool admission is closed.');
    if (this.#active) fail('NATIVE_TOOL_BUSY', 'The prior child, pipes, runner and sinks must fully drain.');
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('INVALID_NATIVE_TOOL', 'Main must supply an AbortSignal.');
    if (options.signal?.aborted) fail('CANCELLED', 'Native invocation was cancelled before admission.');
    for (const key of ['onProgress', 'onStdoutChunk', 'onOutputBytes']) if (options[key] !== undefined && typeof options[key] !== 'function') fail('INVALID_NATIVE_TOOL', 'Native sink must be a function.');
    if (options.onProgress && options.onStdoutChunk) fail('INVALID_NATIVE_TOOL', 'Progress and binary stdout cannot share one pipe.');
    if (typeof executable !== 'string' || !executable.length || executable.length > 32767 || /[\x00-\x1f\x7f]/.test(executable)) fail('INVALID_NATIVE_TOOL', 'Fixed executable path required.');
    if (!Array.isArray(argv) || Object.getPrototypeOf(argv) !== Array.prototype || argv.length > 8192) fail('INVALID_NATIVE_TOOL', 'Bounded dense argv required.');
    const fields = Object.getOwnPropertyDescriptors(argv);
    if (Reflect.ownKeys(fields).length !== argv.length + 1) fail('INVALID_NATIVE_TOOL', 'Unknown or sparse argv fields.');
    for (let i = 0; i < argv.length; i++) if (!fields[i]?.enumerable || !Object.hasOwn(fields[i], 'value') || typeof fields[i].value !== 'string'
      || fields[i].value.length > 32767 || fields[i].value.includes('\0')) fail('INVALID_NATIVE_TOOL', 'Invalid native argument.');
    argv = argv.slice(); if (Buffer.byteLength(JSON.stringify(argv)) > 1024 ** 2) fail('INVALID_NATIVE_TOOL', 'Native argv JSON exceeds its bound.');
    integer(options.timeoutMs, 1800000); integer(options.stdoutLimit, options.onStdoutChunk ? 1244160000 : 16 * 1024 ** 2); integer(options.stderrLimit, 262144);
    const admittedAt = this.#time(), remaining = this.#deadline - admittedAt, callDeadline = admittedAt + Math.min(options.timeoutMs, Math.max(0, remaining));
    if (remaining <= 0 || this.#calls >= this.#maximum.children) fail('NATIVE_TOOL_LIMIT', 'The finite tool deadline/call allowance is exhausted.');
    this.#calls++;
    const controller = new AbortController(), signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const active = { controller, done: null }, children = [], pending = new Set(); let failure, result, runnerError, runnerDone = false, terminal = false;
    let stdoutBytes = 0, stderrBytes = 0, deliveredBytes = 0; const stderr = [], stdout = [], stdoutHash = createHash('sha256'), sinkHash = createHash('sha256');
    const drain = () => { if (failure && !pending.size) for (const item of children) for (const name of ['stdout', 'stderr']) { try { item.child[name].resume?.(); } catch { /* terminal pipe observation remains required */ } } };
    const stop = error => { failure ||= error; controller.abort(); for (const item of children) if (!item.closed) { try { item.child.kill(); } catch { /* real close remains required */ } } drain(); };
    const sink = action => {
      let work; try { work = Promise.resolve(action()); } catch (error) { work = Promise.reject(error); }
      pending.add(work); work.then(() => { pending.delete(work); drain(); }, error => { pending.delete(work); stop(error); }); return work;
    };
    const child = owned => {
      if (terminal) { this.#blocked = true; try { owned?.kill?.(); } catch { /* late runner callbacks cannot restore ownership */ } return; }
      if (runnerDone) this.#blocked = true;
      if (!owned || typeof owned.once !== 'function' || typeof owned.on !== 'function' || typeof owned.kill !== 'function' || owned.stdout === owned.stderr
          || [owned.stdout, owned.stderr].some(pipe => !pipe || typeof pipe.on !== 'function' || typeof pipe.once !== 'function')) {
        this.#blocked = true; stop(Object.assign(new Error('Native runner did not expose an observable child and both pipes.'), { code: 'NATIVE_CHILD_UNOBSERVED' }));
        try { owned?.kill?.(); } catch { /* unknown ownership stays quarantined */ } return;
      }
      if (children.some(item => item.child === owned)) { stop(Object.assign(new Error('A native child was reported twice.'), { code: 'NATIVE_CHILD_DUPLICATE' })); return; }
      const item = { child: owned, closed: false, code: null, signal: null, eof: { stdout: false, stderr: false } }; children.push(item); this.#children++;
      item.done = new Promise(resolve => { try { const check = () => { if (item.closed && item.stdoutDone && item.stderrDone) resolve(); };
        owned.once('close', (code, exitSignal) => { item.closed = true; item.code = code; item.signal = exitSignal; check(); });
        owned.on('error', error => stop(error));
        for (const name of ['stdout', 'stderr']) {
          const pipe = owned[name];
          pipe.once('end', () => { item.eof[name] = true; item[name + 'Done'] = true; check(); });
          pipe.once('close', () => { item[name + 'Done'] = true; check(); });
          pipe.on('error', error => stop(error));
          pipe.on('data', chunk => {
            try {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); this.#bytes += bytes.length;
              if (name === 'stdout') { stdoutBytes += bytes.length; stdoutHash.update(bytes); if (!options.onStdoutChunk && !options.onProgress && stdoutBytes <= options.stdoutLimit) stdout.push(Buffer.from(bytes)); }
              else { stderrBytes += bytes.length; if (stderrBytes <= options.stderrLimit) stderr.push(Buffer.from(bytes)); }
              if (this.#bytes > this.#maximum.bytes || stdoutBytes > options.stdoutLimit || stderrBytes > options.stderrLimit) stop(Object.assign(new Error('Native pipe byte limit exceeded.'), { code: 'NATIVE_TOOL_LIMIT' }));
            } catch (error) { stop(error); }
          });
        }
      } catch (error) { this.#blocked = true; stop(error); resolve(); }
      });
      if (children.length !== 1) stop(Object.assign(new Error('More than one child was returned for one invocation.'), { code: 'NATIVE_CHILD_DUPLICATE' }));
      if (signal.aborted) { try { owned.kill(); } catch { /* await actual close */ } }
    };
    const abort = () => stop(Object.assign(new Error('Native invocation cancelled.'), { code: 'CANCELLED' }));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Object.assign(new Error('Native invocation deadline reached.'), { code: 'NATIVE_TOOL_TIMEOUT' })), Math.min(options.timeoutMs, remaining)); timer.unref();
    this.#active = active;
    active.done = Promise.resolve().then(async () => {
      try {
        if (signal.aborted) fail('CANCELLED', 'Native invocation cancelled before entering the runner.');
        try { result = await this.#run(executable, argv, { signal, timeoutMs: Math.min(options.timeoutMs, remaining), stdoutLimit: options.stdoutLimit, stderrLimit: options.stderrLimit, onChild: child,
          onOutputBytes: event => { if (options.onOutputBytes) return sink(() => options.onOutputBytes(event)); },
          ...(options.onProgress ? { onProgress: event => sink(() => options.onProgress(event)) } : {}),
          ...(options.onStdoutChunk ? { onStdoutChunk: chunk => sink(() => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); deliveredBytes += bytes.length; sinkHash.update(bytes); return options.onStdoutChunk(chunk); }) } : {}) }); }
        catch (error) { runnerError = error; stop(error); } finally { runnerDone = true; }
        let joined = 0;
        while (joined < children.length || pending.size) { const batch = children.slice(joined); joined = children.length; await Promise.allSettled([...batch.map(item => item.done), ...pending]); }
        terminal = true;
        if (!children.length || this.#blocked) { this.#blocked = true; fail('NATIVE_CHILD_UNOBSERVED', 'Actual child/pipe ownership cannot be inferred from a runner result.'); }
        if (failure) throw failure;
        if (signal.aborted) fail('CANCELLED', 'Cancelled native invocation cannot become successful evidence.');
        if (this.#time() >= callDeadline) fail('NATIVE_TOOL_TIMEOUT', 'Native closure finished after its admitted deadline.');
        if (children.length !== 1 || children.some(item => item.code !== 0 || item.signal !== null || !item.eof.stdout || !item.eof.stderr)) fail('NATIVE_CHILD_INCOMPLETE', 'Successful close and both pipe EOFs are required.');
        if (runnerError || !runnerDone || result?.exitCode !== 0) fail('NATIVE_RUNNER_INCOMPLETE', 'The original runner did not complete successfully.');
        const actualStderr = Buffer.concat(stderr).toString('utf8');
        if (result.stderr !== actualStderr || result.stderrCapture?.totalBytes !== stderrBytes || result.stderrCapture?.truncated !== false
            || Buffer.byteLength(actualStderr) !== stderrBytes) fail('NATIVE_CAPTURE_MISMATCH', 'Returned stderr is not the complete actual pipe capture.');
        const stdoutSha256 = stdoutHash.digest('hex');
        if (options.onStdoutChunk) {
          if (deliveredBytes !== stdoutBytes || sinkHash.digest('hex') !== stdoutSha256 || result.stdoutCapture?.totalBytes !== stdoutBytes
              || result.stdoutCapture?.truncated !== false || result.stdoutCapture?.streamed !== true) fail('NATIVE_CAPTURE_MISMATCH', 'The complete actual stdout and delivered sink bytes differ.');
        } else if (!options.onProgress && (typeof result.stdout !== 'string' || !Buffer.concat(stdout).equals(Buffer.from(result.stdout, 'utf8')))) fail('NATIVE_CAPTURE_MISMATCH', 'Returned metadata stdout differs from actual pipe bytes.');
        const receipt = Object.freeze({ schema: 1, invocationId: randomUUID() });
        this.#receipts.set(receipt, freeze({ invocationId: receipt.invocationId, executable, argv, argvSha256: digest(JSON.stringify(argv)), close: { code: 0, signal: null },
          stdoutBytes, stdoutSha256, stderrBytes, stderr: actualStderr, stderrCapture: { totalBytes: stderrBytes, truncated: false }, stdout: options.onStdoutChunk || options.onProgress ? null : result.stdout,
          resourceClosureConfirmed: true, evidenceComplete: true })); return receipt;
      } finally { terminal = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (this.#active === active) this.#active = null; }
    });
    return active.done;
  }
  async close() {
    if (this.#closing) return this.#closing; this.#closed = true;
    this.#closing = (async () => { const active = this.#active; if (active) { active.controller.abort(); await active.done.catch(() => {}); } if (this.#blocked) fail('NATIVE_TOOL_OWNERSHIP_UNKNOWN', 'Unknown ownership cannot release a native lease.'); return this.snapshot(); })();
    return this.#closing;
  }
}
module.exports = { NativeFileToolOwner };
