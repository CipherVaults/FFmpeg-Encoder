'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PINS } = require('./runtime.cjs');
const { createWorkbenchRunner, LinuxWorkbenchService, START_MESSAGE } = require('./workbench-service.cjs');
const { StorageEligibility } = require('../src/storage-eligibility.cjs');

function harness() {
  const verified = [], calls = [];
  return { verified, calls, run: createWorkbenchRunner({
    verify: async kind => { verified.push(kind); },
    execute: async (...args) => { calls.push(args); return { exitCode: 0, stdout: '', stderr: '' }; },
  }) };
}
test('fixed Linux tools are reverified for every inspection call; service limits survive', async () => {
  const h = harness(), signal = new AbortController().signal;
  for (const stdoutLimit of [8 * 1024 * 1024, 16 * 1024 * 1024]) {
    await h.run(PINS.ffprobe.path, ['-version'], { signal, stdoutLimit, stderrLimit: 65536, timeoutMs: 20000 });
    const options = h.calls.at(-1)[2];
    assert.equal(options.stdoutLimit, stdoutLimit); assert.equal(options.stderrLimit, 65536);
    assert.equal(options.signal, signal); assert.equal(options.timeoutMs, 20000);
    assert.equal(typeof options.onOutputBytes, 'function');
  }
  assert.deepEqual(h.verified, ['ffprobe', 'ffprobe']);
});
test('unknown tools, GPU encoders and acceleration never reach verifier or child', async () => {
  const h = harness();
  await assert.rejects(h.run('ffmpeg', []), { code: 'LINUX_WORKBENCH_TOOL' });
  for (const args of [['-c:v:0', 'hevc_nvenc'], ['-c:v', 'h264_amf'], ['-vcodec', 'av1_qsv'],
    ['-codec', 'mystery'], ['-hwaccel', 'auto'], ['-init_hw_device', 'cuda']]) {
    await assert.rejects(h.run(PINS.ffmpeg.path, args), { code: 'LINUX_WORKBENCH_GPU_UNTESTED' });
  }
  assert.equal(h.calls.length, 0); assert.equal(h.verified.length, 0);
});
test('CPU capability invocations retain their exact argv', async () => {
  const h = harness();
  for (const encoder of ['copy', 'ffv1', 'libx264', 'libx265', 'libsvtav1']) {
    const args = ['-c:v:0', encoder]; await h.run(PINS.ffmpeg.path, args);
    assert.equal(h.calls.at(-1)[1], args);
  }
});
test('unsupported/unbounded options cannot be silently dropped or replaced', async () => {
  const h = harness();
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 60001 }, { stdoutLimit: 16777217 },
    { stderrLimit: 262145 }, { onStdoutChunk() {} }, { spawnImpl() {} }, { input: 'payload' },
    { signal: {} }, { onProgress: true }, { [Symbol('hidden')]: true }, null]) {
    await assert.rejects(h.run(PINS.ffprobe.path, [], options), { code: 'LINUX_WORKBENCH_OPTIONS' });
  }
  for (const args of [null, [1], ['\0'], Array(513).fill('x')]) {
    await assert.rejects(h.run(PINS.ffprobe.path, args), { code: 'LINUX_WORKBENCH_ARGUMENTS' });
  }
  assert.equal(h.calls.length, 0);
});
test('changed runtime and cancellation after verification prevent launch', async () => {
  let called = false;
  const bad = createWorkbenchRunner({ verify: async () => { throw Object.assign(new Error('changed'), { code: 'CHANGED' }); }, execute() { called = true; } });
  await assert.rejects(bad(PINS.ffprobe.path, []), { code: 'CHANGED' });
  const controller = new AbortController();
  const cancelled = createWorkbenchRunner({ verify: async () => controller.abort(), execute() { called = true; } });
  await assert.rejects(cancelled(PINS.ffprobe.path, [], { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(called, false);
});
test('progress and child observers remain main-owned and preserve process settlement', async () => {
  const observed = [], child = {}, progress = { ended: true };
  const run = createWorkbenchRunner({ verify: async () => {}, onChild: value => observed.push(value),
    execute: async (_exe, _args, options) => { options.onChild(child); options.onProgress(progress); return 'closed'; } });
  assert.equal(await run(PINS.ffmpeg.path, [], { onProgress: value => observed.push(value) }), 'closed');
  assert.deepEqual(observed, [child, progress]);
});
test('original service remains the implementation, but media Start is explicitly refused before mutation', () => {
  const service = new LinuxWorkbenchService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path,
    stateDir: path.join(__dirname, 'artifacts', 'workbench-unit-state') });
  const before = service.snapshot();
  assert.throws(() => service.startBatch({}), { code: 'LINUX_WORKBENCH_EXECUTION_PENDING', message: START_MESSAGE });
  assert.deepEqual(service.snapshot(), before);
  assert.equal(service.remuxOperations, null); assert.equal(service.hdrOperations, null);
});
test('Linux composition does not grant persistent inspection reuse', async () => {
  assert.equal((await new StorageEligibility().check('/tmp/example', {})).eligible, false);
});
test('entry uses original assets/IPC, isolated state and explicit security restrictions', async () => {
  const main = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  for (const required of ["path.join(root, 'ui')", "path.join(root, 'preload.js')", "require('../src/ipc.cjs')",
    "'artifacts', 'workbench-preview'", 'app.enableSandbox()', 'contextIsolation: true', 'nodeIntegration: false',
    'webSecurity: true', 'will-frame-navigate', 'render-process-gone', 'closeAdmission()', 'closeDiagnostics',
    'appearance?.flush()', 'requestSingleInstanceLock()', 'resolveAsset(details.url, details.method)']) assert.ok(main.includes(required), required);
  assert.ok(!main.includes('no-sandbox')); assert.ok(!main.includes('verifyCandidateRuntime'));
});
