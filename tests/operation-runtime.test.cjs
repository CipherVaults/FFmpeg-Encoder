'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { OperationRuntimeObserver, parseNvidiaObservation } = require('../src/operation-runtime.cjs');

// These are tiny owned bytes, injected observations and EventEmitter children.
// No executable, native media, GPU, driver, application or network is exercised.
const UUID = 'GPU-01234567-89ab-cdef-0123-456789abcdef';
const GPU = { adapterIdentity: UUID, driverVersion: '581.80' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));
const success = { stdout: '', stderr: '', stderrCapture: { totalBytes: 0, truncated: false }, exitCode: 0 };
function child() {
  const owned = new EventEmitter(); owned.kills = 0; owned.kill = () => { owned.kills++; }; return owned;
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'operation-runtime-test-'));
  const runtime = { ffmpeg: path.join(root, 'ffmpeg.exe'), ffprobe: path.join(root, 'ffprobe.exe') };
  const bytes = { ffmpeg: Buffer.from('owned-non-executable-ffmpeg-bytes'), ffprobe: Buffer.from('owned-non-executable-ffprobe-bytes') };
  for (const name of Object.keys(runtime)) await fs.writeFile(runtime[name], bytes[name], { flag: 'wx' });
  const pins = Object.fromEntries(Object.keys(runtime).map(name => [name, { sizeBytes: bytes[name].length, sha256: sha(bytes[name]) }]));
  const calls = [], state = { now: 1000, gpuCalls: 0, gpu: { ...GPU }, gpuError: null };
  const observer = new OperationRuntimeObserver({ runtime, pins, now: () => state.now,
    observeNvidia: async ({ signal }) => { assert.ok(signal === undefined || signal instanceof AbortSignal); state.gpuCalls++;
      if (state.gpuError) throw state.gpuError; return typeof state.gpu === 'function' ? state.gpu(state.gpuCalls) : state.gpu; },
    run: options.run || (async (executable, argv, runOptions) => {
      const owned = child(); calls.push({ executable, argv, options: runOptions, child: owned });
      runOptions.onChild(owned); owned.emit('close', 0, null); return { ...success };
    }), ...options.observer });
  t.after(async () => { await observer.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, runtime, pins, bytes, state, calls, observer,
    observe: hardware => observer.observe({ hardware: hardware || 'CPU' }) };
}

test('strict fixed-query NVIDIA parser accepts one UUID/driver and rejects missing or ambiguous observations', () => {
  assert.deepEqual(parseNvidiaObservation(` ${UUID.toUpperCase()}, 581.80\r\n`), GPU);
  for (const value of ['', 'uuid, driver_version', `${UUID}, N/A`, `${UUID}, 581.80, extra`,
    `${UUID}, 581.80\n${UUID}, 581.80`, 'GPU-not-a-uuid, 581.80', 'x'.repeat(65537), null]) {
    assert.throws(() => parseNvidiaObservation(value), { code: 'INVALID_NVIDIA_OBSERVATION' });
  }
});

test('CPU observation binds actual paired bytes and exact handles with unforgeable in-process ownership', async t => {
  const h = await fixture(t), token = await h.observe(), snapshot = h.observer.snapshot(token);
  const expected = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => h.pins[name])));
  assert.equal(snapshot.runtimeIdentity, expected); assert.equal(snapshot.environment, null); assert.equal(h.state.gpuCalls, 0);
  assert.equal(snapshot.tools.ffmpeg.canonicalPath, await fs.realpath(h.runtime.ffmpeg));
  assert.equal(snapshot.tools.ffmpeg.sha256, sha(h.bytes.ffmpeg)); assert.equal(snapshot.tools.ffmpeg.identity.nlink, '1');
  assert.ok(Object.isFrozen(token)); assert.ok(Object.isFrozen(snapshot.tools.ffmpeg.identity));
  assert.match(snapshot.limitations.join(' '), /Windows CreateProcess.*Same-stamp hostile mutation/);
  assert.equal(await h.observer.requireCurrent(token), snapshot);
  for (const fake of [{}, structuredClone(token), structuredClone(snapshot), null]) {
    assert.throws(() => h.observer.snapshot(fake), { code: 'OPERATION_RUNTIME_STALE' });
    await assert.rejects(h.observer.requireCurrent(fake), { code: 'OPERATION_RUNTIME_STALE' });
  }
  const other = await fixture(t);
  await assert.rejects(other.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('main pins are copied and immutable while a changed observed file permanently revokes its prior tokens', async t => {
  const h = await fixture(t), token = await h.observe();
  h.pins.ffmpeg.sha256 = 'a'.repeat(64); h.pins.ffprobe.sizeBytes++;
  assert.ok(await h.observer.requireCurrent(token));
  await fs.appendFile(h.runtime.ffmpeg, 'changed');
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', []), { code: 'OPERATION_RUNTIME_STALE' }); assert.equal(h.calls.length, 0);
  await assert.rejects(h.observe(), { code: 'OPERATION_RUNTIME_STALE' });
  await fs.writeFile(h.runtime.ffmpeg, h.bytes.ffmpeg);
  const renewed = await h.observe(); assert.ok(await h.observer.requireCurrent(renewed));
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('ordinary-path checks reject hard links and redirected ancestors before granting an observation', async t => {
  const h = await fixture(t);
  await fs.link(h.runtime.ffmpeg, path.join(h.root, 'other-name.exe'));
  await assert.rejects(h.observe(), { code: 'OPERATION_RUNTIME_STALE' });
  await fs.unlink(path.join(h.root, 'other-name.exe'));
  const real = path.join(h.root, 'real'); await fs.mkdir(real);
  for (const name of ['ffmpeg', 'ffprobe']) await fs.writeFile(path.join(real, `${name}.exe`), h.bytes[name]);
  const linked = path.join(h.root, 'redirected');
  try { await fs.symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('This host did not permit the owned directory-link fixture.'); return; } throw error; }
  const redirected = new OperationRuntimeObserver({ runtime: { ffmpeg: path.join(linked, 'ffmpeg.exe'), ffprobe: path.join(linked, 'ffprobe.exe') }, pins: h.pins });
  t.after(() => redirected.close());
  await assert.rejects(redirected.observe({ hardware: 'CPU' }), /link\/reparse point|redirected ancestor/);
});

test('full hash rejects same-size untrusted bytes and initial observation holds no authority from a startup string', async t => {
  const h = await fixture(t); await fs.writeFile(h.runtime.ffmpeg, Buffer.alloc(h.bytes.ffmpeg.length, 42));
  await assert.rejects(h.observe(), { code: 'OPERATION_RUNTIME_STALE' });
  assert.equal(h.calls.length, 0);
  assert.throws(() => new OperationRuntimeObserver({ runtime: h.runtime, pins: h.pins, runtimeIdentity: 'a'.repeat(64) }), { code: 'INVALID_OPERATION_RUNTIME' });
});

test('same-byte path replacement cannot reuse the prior held file identity', async t => {
  const h = await fixture(t), token = await h.observe();
  await fs.rename(h.runtime.ffmpeg, path.join(h.root, 'preserved-original.exe'));
  await fs.writeFile(h.runtime.ffmpeg, h.bytes.ffmpeg, { flag: 'wx' });
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
  const replacement = await h.observe();
  assert.notEqual(h.observer.snapshot(replacement).tools.ffmpeg.identity.ino, '0');
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('NVIDIA is freshly observed at every boundary and its runtime tag derives from the hashed pair', async t => {
  const h = await fixture(t), token = await h.observe('NVIDIA');
  const initial = h.observer.snapshot(token);
  assert.deepEqual(initial.environment, { ...GPU, runtimeVersion: `FFmpeg9.0.2:${initial.runtimeIdentity}` });
  assert.equal(h.state.gpuCalls, 1); await h.observer.requireCurrent(token); assert.equal(h.state.gpuCalls, 2);
  await h.observer.invoke(token, 'ffprobe', ['-version']); assert.equal(h.state.gpuCalls, 4);
  assert.equal(h.calls[0].executable, h.runtime.ffprobe);
});

test('trusted synchronous pipe-byte accounting callback is passed through without inventing capture evidence', async t => {
  const observed = [];
  const h = await fixture(t, { run: async (_file, _args, options) => {
    const owned = child(); options.onChild(owned);
    options.onOutputBytes({ stream: 'stdout', bytes: 3 }); options.onOutputBytes({ stream: 'stderr', bytes: 2 });
    owned.emit('close', 0, null); return success;
  } }), token = await h.observe();
  const result = await h.observer.invoke(token, 'ffmpeg', [], { onOutputBytes: value => observed.push(value) });
  assert.deepEqual(observed, [{ stream: 'stdout', bytes: 3 }, { stream: 'stderr', bytes: 2 }]);
  assert.equal(result, success); assert.equal(Object.hasOwn(result, 'runtimeReceipt'), false);
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', [], { onOutputBytes: 'not-a-callback' }), { code: 'INVALID_OPERATION_RUNTIME' });
});

test('changed UUID/driver, unavailable provider and ambiguous current data revoke the exact NVIDIA token', async t => {
  for (const mutate of [h => { h.state.gpu = { ...GPU, driverVersion: '582.10' }; },
    h => { h.state.gpu = { ...GPU, adapterIdentity: 'GPU-11234567-89ab-cdef-0123-456789abcdef' }; },
    h => { h.state.gpuError = new Error('injected unavailable collector'); },
    h => { h.state.gpu = [GPU, GPU]; }]) {
    const h = await fixture(t), token = await h.observe('NVIDIA'); mutate(h);
    await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
    h.state.gpuError = null; h.state.gpu = GPU;
    await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
    assert.equal(h.calls.length, 0);
  }
  const h = await fixture(t, { observer: { observeNvidia: undefined } });
  await assert.rejects(h.observe('NVIDIA'), { code: 'OPERATION_RUNTIME_UNOBSERVED' });
  assert.ok(await h.observe('CPU'));
});

test('post-close environment drift discards a successful injected process result', async t => {
  let h;
  h = await fixture(t, { run: async (_file, _args, options) => {
    const owned = child(); options.onChild(owned); h.state.gpu.driverVersion = '582.10'; owned.emit('close', 0, null); return success;
  } });
  const token = await h.observe('NVIDIA');
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', ['-version']), { code: 'OPERATION_RUNTIME_STALE' });
  assert.throws(() => h.observer.snapshot(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('successful early injected result retains an observed child until actual supplied close, then checks files', async t => {
  let owned, started; const ready = new Promise(resolve => { started = resolve; });
  const h = await fixture(t, { run: async (_file, _args, options) => { owned = child(); options.onChild(owned); started(); return success; } });
  const token = await h.observe(); let settled = false;
  const work = h.observer.invoke(token, 'ffmpeg', ['-version']).finally(() => { settled = true; });
  await ready; await turn(); assert.equal(settled, false); assert.equal(owned.kills, 1);
  await assert.rejects(h.observer.invoke(token, 'ffprobe', []), { code: 'OPERATION_RUNTIME_BUSY' });
  await fs.appendFile(h.runtime.ffprobe, 'drift'); owned.emit('close', 0, null);
  await assert.rejects(work, { code: 'OPERATION_RUNTIME_STALE' }); assert.equal(settled, true);
});

test('success without an exposed child is rejected promptly and never invents close evidence', async t => {
  const h = await fixture(t, { run: async () => success }), token = await h.observe();
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', []), { code: 'OPERATION_RUNTIME_CHILD_UNOBSERVED' });
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('cancellation kills only the observed child and waits for close before invalidating the token', async t => {
  let owned, started; const ready = new Promise(resolve => { started = resolve; });
  const h = await fixture(t, { run: async (_file, _args, options) => { owned = child(); options.onChild(owned); started(); return success; } });
  const token = await h.observe(), controller = new AbortController(); let settled = false;
  const work = h.observer.invoke(token, 'ffmpeg', [], { signal: controller.signal }).finally(() => { settled = true; });
  await ready; await turn(); controller.abort(); await turn(); assert.ok(owned.kills >= 1); assert.equal(settled, false);
  owned.emit('close', null, 'SIGTERM'); await assert.rejects(work, { code: 'CANCELLED' });
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('pre-aborted invocation remains cancellation and never launches a child', async t => {
  const h = await fixture(t), token = await h.observe(), controller = new AbortController(); controller.abort();
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', [], { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(h.calls.length, 0); await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
});

test('spawn failure has no fabricated child, preserves diagnostics and still checks the runtime pair', async t => {
  const injected = Object.assign(new Error('injected spawn failure'), { code: 'SPAWN_FAILED', stderr: 'bounded spawn detail', stderrCapture: { totalBytes: 20, truncated: false } });
  const h = await fixture(t, { run: async () => { throw injected; } }), token = await h.observe();
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', []), error => error === injected);
  assert.ok(await h.observer.requireCurrent(token));
});

test('post-close stale failure retains process diagnostics and PUBLICATION_UNCERTAIN keeps its ownership fact', async t => {
  for (const code of ['TOOL_FAILED', 'PUBLICATION_UNCERTAIN']) {
    let h; const primary = Object.assign(new Error('injected run failure'), { code, stderr: 'x'.repeat(300000),
      stderrCapture: { totalBytes: 300000, truncated: false }, exitCode: 1, cause: new Error('prior cause') });
    h = await fixture(t, { run: async (_file, _args, options) => { const owned = child(); options.onChild(owned);
      await fs.appendFile(h.runtime.ffprobe, 'drift'); owned.emit('close', 1, null); throw primary; } });
    const token = await h.observe();
    await assert.rejects(h.observer.invoke(token, 'ffprobe', []), error => {
      if (code === 'PUBLICATION_UNCERTAIN') { assert.equal(error, primary); assert.equal(error.cause.message, 'prior cause'); assert.equal(error.runtimeFreshnessError.code, 'OPERATION_RUNTIME_STALE'); }
      else { assert.equal(error.code, 'OPERATION_RUNTIME_STALE'); assert.equal(error.cause, primary); assert.equal(Buffer.byteLength(error.stderr), 256 * 1024); assert.equal(error.stderrCapture.truncated, true); assert.equal(error.exitCode, 1); }
      return true;
    });
  }
});

test('retained handles avoid per-child hashing and obey tighter age/invocation policies', async t => {
  const originalOpen = fs.open; let reads = 0;
  fs.open = async (...args) => { const handle = await originalOpen(...args), originalRead = handle.read.bind(handle);
    handle.read = async (...readArgs) => { reads++; return originalRead(...readArgs); }; return handle; };
  try {
    const h = await fixture(t, { observer: { maxHashAgeMs: 10, maxInvocationsBetweenHashes: 2 } }), token = await h.observe();
    assert.equal(reads, 2); await h.observer.requireCurrent(token); assert.equal(reads, 2);
    await h.observer.invoke(token, 'ffmpeg', []); assert.equal(reads, 2);
    await h.observer.invoke(token, 'ffprobe', []); assert.equal(reads, 4);
    h.state.now += 10; await h.observer.requireCurrent(token); assert.equal(reads, 6);
    await fs.appendFile(h.runtime.ffmpeg, 'changed stamp');
    await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' }); assert.equal(reads, 6, 'Changed stamps revoke authority before any attempt to repin bytes.');
  } finally { fs.open = originalOpen; }
});

test('hostile records, arbitrary tools, altered policies and hidden argv do not reach a runner', async t => {
  const h = await fixture(t), token = await h.observe(); let getterRead = false;
  await assert.rejects(h.observer.observe({ get hardware() { getterRead = true; return 'CPU'; } }), { code: 'INVALID_OPERATION_RUNTIME' });
  assert.equal(getterRead, false);
  for (const tool of [h.runtime.ffmpeg, 'cmd.exe', 'powershell', null]) await assert.rejects(h.observer.invoke(token, tool, []), { code: 'INVALID_OPERATION_RUNTIME' });
  const argv = []; Object.defineProperty(argv, '0', { enumerable: true, get() { getterRead = true; return '-version'; } }); argv.length = 1;
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', argv), { code: 'INVALID_OPERATION_RUNTIME' }); assert.equal(getterRead, false);
  await assert.rejects(h.observer.invoke(token, 'ffmpeg', [], { shell: true }), { code: 'INVALID_OPERATION_RUNTIME' });
  for (const policy of [{ maxHashAgeMs: 300001 }, { maxInvocationsBetweenHashes: 65 }]) assert.throws(() => new OperationRuntimeObserver({ runtime: h.runtime, pins: h.pins, ...policy }), { code: 'INVALID_OPERATION_RUNTIME' });
  assert.equal(h.calls.length, 0);
});

test('explicit invalidation and observer close revoke tokens and close remains idempotent', async t => {
  const h = await fixture(t), token = await h.observe();
  h.observer.invalidate(token, 'Main policy was replaced.');
  await assert.rejects(h.observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
  const renewed = await h.observe(); await h.observer.close(); await h.observer.close();
  assert.throws(() => h.observer.snapshot(renewed), { code: 'OPERATION_RUNTIME_STALE' });
  await assert.rejects(h.observe(), { code: 'OPERATION_RUNTIME_STALE' });
});

test('all concurrent close callers await the supplied active child close before file cleanup completes', async t => {
  let owned, started; const ready = new Promise(resolve => { started = resolve; });
  const h = await fixture(t, { run: async (_file, _args, options) => { owned = child(); options.onChild(owned); started(); return success; } });
  const token = await h.observe(), work = h.observer.invoke(token, 'ffmpeg', []);
  await ready; await turn(); let closed = 0;
  const first = h.observer.close().then(() => { closed++; }), second = h.observer.close().then(() => { closed++; });
  await turn(); assert.equal(closed, 0); assert.ok(owned.kills >= 1);
  owned.emit('close', null, 'SIGTERM');
  await assert.rejects(work, { code: 'OPERATION_RUNTIME_STALE' }); await Promise.all([first, second]); assert.equal(closed, 2);
});
