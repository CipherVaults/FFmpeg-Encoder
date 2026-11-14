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
function remuxAssessment() {
  return require('../src/remux-contract.cjs').assessRemux({ sourceFingerprint: 'b'.repeat(64), probe: {
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 2, height: 2, pix_fmt: 'yuv420p',
      color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv', sample_aspect_ratio: '1:1',
      time_base: '1/1000', duration: '2', tags: {}, disposition: {} }], format: { format_name: 'matroska,webm',
      duration: '2', nb_streams: 1, nb_programs: 0, nb_stream_groups: 0, tags: {} }, chapters: [], programs: [], stream_groups: [] },
    request: { fileId: 'owned-remux', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'matroska', range: null, omissionRequestIds: [] } });
}
const until = async predicate => { const end = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < end, 'owned fake failed to reach its boundary'); await turn(); } };
function child() {
  const owned = new EventEmitter(); owned.kills = 0; owned.kill = () => { owned.kills++; }; return owned;
}

test('genuine remux group owns at most two children, accounts both and rejects foreign, closed, ordinary/range and third-child borrowing', async t => {
  const pending = [];
  const h = await fixture(t, { run: (_file, _argv, options) => new Promise((resolve, reject) => {
    const owned = child(); let done = false;
    const settle = (error = null) => { if (done) return; done = true; owned.emit('close', error ? 1 : 0, null); error ? reject(error) : resolve({ ...success }); };
    owned.kill = () => setImmediate(() => settle(Object.assign(Error('cancelled'), { code: 'CANCELLED' })));
    options.onChild(owned); pending.push({ owned, settle });
  }) }), token = await h.observe(), assessment = remuxAssessment();
  assert.throws(() => h.observer.createRemuxGroup(token, structuredClone(assessment)), { code: 'INVALID_REMUX_RUNTIME_GROUP' });
  assert.throws(() => h.observer.createRemuxGroup({}, assessment), { code: 'OPERATION_RUNTIME_STALE' });
  const group = h.observer.createRemuxGroup(token, assessment);
  await assert.rejects(h.observer.invokeRemux({}, 'ffmpeg', []), { code: 'INVALID_REMUX_RUNTIME_GROUP' });
  const a = h.observer.invokeRemux(group, 'ffprobe', ['source']), b = h.observer.invokeRemux(group, 'ffprobe', ['output']);
  await until(() => pending.length === 2);
  await assert.rejects(h.observer.invokeRemux(group, 'ffmpeg', ['third']), { code: 'REMUX_RUNTIME_CHILD_LIMIT' });
  for (const argv of [['ordinary'], ['range', '-t', '1']]) await assert.rejects(h.observer.invoke(token, 'ffmpeg', argv), { code: 'OPERATION_RUNTIME_BUSY' });
  await assert.rejects(h.observe(), { code: 'OPERATION_RUNTIME_BUSY' });
  assert.throws(() => h.observer.createRemuxGroup(token, assessment), { code: 'OPERATION_RUNTIME_BUSY' });
  pending.forEach(p => p.settle()); await Promise.all([a, b]);
  const receipt = await h.observer.closeRemuxGroup(group);
  assert.deepEqual([receipt.started, receipt.completed, receipt.live, receipt.childrenStarted, receipt.childrenClosed, receipt.liveChildren, receipt.peakChildren], [2, 2, 0, 2, 2, 0, 2]);
  await assert.rejects(h.observer.invokeRemux(group, 'ffmpeg', []), { code: 'INVALID_REMUX_RUNTIME_GROUP' });
});

for (const mode of ['cancel', 'failure']) test(`remux group ${mode} stops its sibling and drains both actual close events`, async t => {
  const pending = [], controller = new AbortController();
  const h = await fixture(t, { run: (_file, _argv, options) => new Promise((resolve, reject) => {
    const owned = child(); let done = false;
    const settle = (error = null) => { if (done) return; done = true; owned.emit('close', error ? 1 : 0, null); error ? reject(error) : resolve({ ...success }); };
    owned.kill = () => setImmediate(() => settle(Object.assign(Error('cancelled'), { code: 'CANCELLED' })));
    options.onChild(owned); pending.push({ owned, settle });
  }) }), token = await h.observe(), group = h.observer.createRemuxGroup(token, remuxAssessment());
  const work = Promise.allSettled([h.observer.invokeRemux(group, 'ffprobe', ['source'], { signal: controller.signal }),
    h.observer.invokeRemux(group, 'ffmpeg', ['output'], { signal: controller.signal })]);
  await until(() => pending.length === 2);
  if (mode === 'cancel') controller.abort(); else pending[0].settle(Object.assign(Error('bad stream'), { code: 'TOOL_FAILED' }));
  assert.ok((await work).every(r => r.status === 'rejected'));
  const receipt = await h.observer.closeRemuxGroup(group); assert.equal(receipt.liveChildren, 0); assert.equal(receipt.childrenClosed, 2); assert.equal(receipt.live, 0);
});
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'operation-runtime-test-'));
  const runtime = { ffmpeg: path.join(root, 'ffmpeg.exe'), ffprobe: path.join(root, 'ffprobe.exe') };
  const bytes = { ffmpeg: Buffer.from('owned-non-executable-ffmpeg-bytes'), ffprobe: Buffer.from('owned-non-executable-ffprobe-bytes') };
  for (const name of Object.keys(runtime)) await fs.writeFile(runtime[name], bytes[name], { flag: 'wx' });
  const pins = Object.fromEntries(Object.keys(runtime).map(name => [name, { sizeBytes: bytes[name].length, sha256: sha(bytes[name]) }]));
  const calls = [], state = { now: 1000, gpuCalls: 0, gpu: { ...GPU }, gpuError: null };
  const observer = new (options.Observer || OperationRuntimeObserver)({ runtime, pins, now: () => state.now,
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

async function groupBoundary(t, Observer = OperationRuntimeObserver, mode = 'limit') {
  const pending = [], errors = [], works = [];
  const h = await fixture(t, { Observer, run: (_file, _argv, options) => new Promise((resolve, reject) => {
    const owned = child(); let done = false;
    const settle = error => { if (done) return; done = true; owned.emit('close', error ? 1 : 0, null); error ? reject(error) : resolve(success); };
    owned.kill = () => { owned.kills++; setImmediate(() => settle(Object.assign(Error('cancelled'), { code: 'CANCELLED' }))); };
    options.onChild(owned); pending.push({ owned, settle });
  }) }), token = await h.observe();
  if (mode === 'brand') { assert.throws(() => h.observer.createRemuxGroup(token, structuredClone(remuxAssessment())), { code: 'INVALID_REMUX_RUNTIME_GROUP' }); return; }
  const group = h.observer.createRemuxGroup(token, remuxAssessment());
  const launch = promise => { works.push(promise.catch(error => { errors.push(error.code); })); };
  try {
    launch(h.observer.invokeRemux(group, 'ffprobe', ['source'])); launch(h.observer.invokeRemux(group, 'ffprobe', ['output']));
    await until(() => pending.length === 2);
    if (mode === 'failure') {
      pending[0].settle(Object.assign(Error('bad packets'), { code: 'TOOL_FAILED' }));
      await until(() => errors.length > 0); await turn();
      assert.ok(pending[1].owned.kills > 0, 'first admitted failure must stop its sibling');
    } else {
      if (mode === 'ordinary') launch(h.observer.invoke(token, 'ffmpeg', ['ordinary', '-t', '1']));
      else launch(h.observer.invokeRemux(group, 'ffmpeg', ['third']));
      await turn(); await turn();
      assert.deepEqual(errors, [mode === 'ordinary' ? 'OPERATION_RUNTIME_BUSY' : 'REMUX_RUNTIME_CHILD_LIMIT']);
      assert.equal(pending.length, 2);
    }
  } finally {
    // A deliberately widened mutant may have admitted an ordinary invocation;
    // settle its injected child too, without depending on the broken group.
    pending.forEach(item => item.settle(Object.assign(Error('test drain'), { code: 'CANCELLED' })));
    await h.observer.close(); await h.observer.closeRemuxGroup(group); await Promise.all(works);
  }
  const receipt = h.observer.remuxGroupSnapshot(group);
  assert.equal(receipt.childrenStarted, 2); assert.equal(receipt.childrenClosed, 2); assert.equal(receipt.liveChildren, 0);
  assert.equal(receipt.live, 0); assert.equal(receipt.completed, 2);
}

test('remux group capability, width, ordinary isolation, sibling stop and accounting mutants are killed', async t => {
  const filename = require.resolve('../src/operation-runtime.cjs'), source = await fs.readFile(filename, 'utf8'), Module = require('node:module');
  for (const [name, before, after, mode] of [
    ['brand', "require('./remux-contract.cjs').getRemuxAssessmentSource(assessment);", '', 'brand'],
    ['two', 'group.active.size >= 2', 'group.active.size >= 3', 'limit'],
    ['ordinary', 'this.#active || this.#remuxGroup)\n      fail(group', 'this.#active)\n      fail(group', 'ordinary'],
    ['sibling stop', 'group.failure = error; group.controller.abort();', 'group.failure = error;', 'failure'],
    ['account both starts', 'group.childrenStarted++;', '', 'limit'],
    ['account both closes', 'group.childrenClosed++;', '', 'limit'],
  ]) await t.test(name, async sub => {
    assert.ok(source.includes(before), `missing mutant ${name}`);
    const unit = new Module(filename, module); unit.filename = filename; unit.paths = module.paths; unit._compile(source.replace(before, after), filename);
    await assert.rejects(groupBoundary(sub, unit.exports.OperationRuntimeObserver, mode), assert.AssertionError);
  });
});

test('duplicate live child handles cannot count as two independently owned remux children', async t => {
  const owned = child(); let calls = 0, finish;
  const h = await fixture(t, { run: (_file, _argv, options) => {
    if (++calls === 2) { options.onChild(owned); return Promise.resolve(success); }
    return new Promise(resolve => { finish = () => { owned.emit('close', 0, null); resolve(success); };
      owned.kill = () => setImmediate(finish); options.onChild(owned); });
  } }), token = await h.observe(), group = h.observer.createRemuxGroup(token, remuxAssessment());
  const a = h.observer.invokeRemux(group, 'ffmpeg', ['a']);
  await until(() => calls === 1);
  const b = h.observer.invokeRemux(group, 'ffmpeg', ['b']);
  const settled = await Promise.allSettled([a, b]); assert.ok(settled.every(value => value.status === 'rejected'));
  const receipt = await h.observer.closeRemuxGroup(group);
  assert.equal(receipt.childrenStarted, 1); assert.equal(receipt.childrenClosed, 1); assert.equal(receipt.liveChildren, 0);
});

test('group close waits for runner sink drainage even after both children close', async t => {
  const pending = [];
  const h = await fixture(t, { run: (_file, _argv, options) => new Promise(resolve => {
    const owned = child(); options.onChild(owned); pending.push({ owned, drain: () => resolve(success) });
  }) }), token = await h.observe(), group = h.observer.createRemuxGroup(token, remuxAssessment());
  const work = Promise.allSettled([h.observer.invokeRemux(group, 'ffmpeg', ['a']), h.observer.invokeRemux(group, 'ffprobe', ['b'])]);
  await until(() => pending.length === 2); pending.forEach(item => item.owned.emit('close', 0, null));
  let closed = false; const closing = h.observer.closeRemuxGroup(group).then(() => { closed = true; });
  await turn(); assert.equal(closed, false); assert.equal(h.observer.remuxGroupSnapshot(group).live, 2);
  pending.forEach(item => item.drain()); await work; await closing;
  assert.equal(closed, true); assert.equal(h.observer.remuxGroupSnapshot(group).live, 0);
});

async function ordinaryCannotGrantGroup(t, Observer = OperationRuntimeObserver, argv = ['ordinary']) {
  let owned, finish;
  const h = await fixture(t, { Observer, run: (_file, _argv, options) => new Promise(resolve => {
    owned = child(); finish = () => { owned.emit('close', 0, null); resolve(success); }; owned.kill = () => setImmediate(finish); options.onChild(owned);
  }) }), token = await h.observe(), work = h.observer.invoke(token, 'ffmpeg', argv);
  try {
    await until(() => owned);
    await assert.rejects(h.observer.invoke(token, 'ffprobe', ['second']), { code: 'OPERATION_RUNTIME_BUSY' });
    assert.throws(() => h.observer.createRemuxGroup(token, remuxAssessment()), { code: 'OPERATION_RUNTIME_BUSY' });
  } finally { finish(); await work; }
}
test('ordinary and range invocations keep one child and cannot lend an occupied observer to a remux group (mutant killed)', async t => {
  await ordinaryCannotGrantGroup(t); await ordinaryCannotGrantGroup(t, undefined, ['range', '-ss', '1', '-t', '1']);
  const filename = require.resolve('../src/operation-runtime.cjs'), source = await fs.readFile(filename, 'utf8'), Module = require('node:module');
  const before = "if (this.#active || this.#remuxGroup) fail('OPERATION_RUNTIME_BUSY', 'An operation already owns this runtime.');";
  assert.ok(source.includes(before)); const unit = new Module(filename, module); unit.filename = filename; unit.paths = module.paths;
  unit._compile(source.replace(before, "if (this.#remuxGroup) fail('OPERATION_RUNTIME_BUSY', 'An operation already owns this runtime.');"), filename);
  await assert.rejects(ordinaryCannotGrantGroup(t, unit.exports.OperationRuntimeObserver), assert.AssertionError);
});
