'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { openCandidateCalibrationRuntime, requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ffmpeg-candidate-binding-'));
  let handle; t.after(async () => { if (handle) await requireCandidateCalibrationRuntime(handle).close(); assert.equal(await fs.realpath(root), root); await fs.rm(root, { recursive: true }); });
  const pins = {};
  for (const kind of ['ffmpeg', 'ffprobe']) { const bytes = Buffer.from('synthetic non-executable ' + kind), file = path.join(root, kind); await fs.writeFile(file, bytes); pins[kind] = { path: file, size: bytes.length, sha256: sha(bytes) }; }
  const dependency = { path: path.join(root, 'codec.fixture'), size: 5, sha256: sha('codec') }; await fs.writeFile(dependency.path, 'codec');
  const runtimeIdentity = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(k => ({ sizeBytes: pins[k].size, sha256: pins[k].sha256 }))));
  const manifest = { pins, runtimeIdentity, dependencies: [dependency] }; let calls = 0, live = 0;
  const execute = async (file, args, options) => { calls++; const child = new EventEmitter(); child.kill = () => {}; live++; options.onChild(child); child.emit('close', 0, null); live--; return { exitCode: 0, stdout: '', stderr: '' }; };
  return { root, manifest, execute, counts: () => ({ calls, live }), open: async (runner = execute) => handle = await openCandidateCalibrationRuntime(manifest, { execute: runner }) };
}
test('candidate handle requires exact pair identity and verified bytes before any execution', async t => {
  const h = await fixture(t);
  await assert.rejects(openCandidateCalibrationRuntime({ ...h.manifest, runtimeIdentity: 'b'.repeat(64) }, { execute: h.execute }));
  await fs.appendFile(h.manifest.pins.ffmpeg.path, 'changed'); await assert.rejects(h.open());
  assert.deepEqual(h.counts(), { calls: 0, live: 0 });
});
test('genuine candidate owns fixed CPU calls, rejects copies and closes currentness', async t => {
  const h = await fixture(t), handle = await h.open(), runtime = requireCandidateCalibrationRuntime(handle);
  for (const forged of [{ ...handle }, {}, null]) assert.throws(() => requireCandidateCalibrationRuntime(forged));
  let observed = 0; const run = runtime.createRunner({ onChild: () => observed++ });
  await run(runtime.pins.ffmpeg.path, ['-version'], { timeoutMs: 1000 });
  assert.equal(observed, 1); assert.deepEqual(h.counts(), { calls: 1, live: 0 });
  await assert.rejects(run('/other/tool', ['-version'], { timeoutMs: 1000 }));
  await assert.rejects(run(runtime.pins.ffmpeg.path, ['-c:v', 'h264_nvenc'], { timeoutMs: 1000 }));
  await assert.rejects(run(runtime.pins.ffmpeg.path, ['-version'], { timeoutMs: 0 }));
  await runtime.close(); await assert.rejects(runtime.requireCurrent());
});
test('changed listed dependency refuses before another child, with no fallback', async t => {
  const h = await fixture(t), runtime = requireCandidateCalibrationRuntime(await h.open());
  await fs.appendFile(h.manifest.dependencies[0].path, 'changed');
  await assert.rejects(runtime.createRunner()(runtime.pins.ffmpeg.path, ['-version'], { timeoutMs: 1000 }));
  assert.equal(h.counts().calls, 0);
});
test('failed child plus changed dependency retains both failures after closure', async t => {
  const h = await fixture(t), primary = Object.assign(new Error('Injected child failure'), { code: 'SYNTHETIC_CHILD_FAILURE' });
  const runtime = requireCandidateCalibrationRuntime(await h.open(async (file, args, options) => {
    const child = new EventEmitter(); child.kill = () => {}; options.onChild(child);
    await fs.appendFile(h.manifest.dependencies[0].path, 'changed'); child.emit('close', 1, null); throw primary;
  }));
  await assert.rejects(runtime.createRunner()(runtime.pins.ffmpeg.path, ['-version'], { timeoutMs: 1000 }), error => {
    assert.equal(error.code, 'CANDIDATE_CALIBRATION_CHANGED_AFTER_FAILURE'); assert.equal(error.cause, primary);
    assert.equal(error.postVerificationFailure.code, 'CANDIDATE_CALIBRATION_RUNTIME'); return true;
  });
});
test('invocation snapshots inert caller arrays before asynchronous observation', async t => {
  const h = await fixture(t); let seen;
  const runtime = requireCandidateCalibrationRuntime(await h.open(async (file, args, options) => {
    seen = args; const child = new EventEmitter(); child.kill = () => {}; options.onChild(child); child.emit('close', 0, null);
    return { exitCode: 0, stdout: '', stderr: '' };
  }));
  const args = ['-version'], options = { timeoutMs: 1000 }, run = runtime.createRunner();
  const promise = run(runtime.pins.ffmpeg.path, args, options); args[0] = '-other'; options.timeoutMs = 0;
  await promise; assert.deepEqual(seen, ['-version']);
  let reads = 0; const hostile = Object.defineProperty({ timeoutMs: 1000 }, 'onChild', { enumerable: true, get() { reads++; } });
  await assert.rejects(run(runtime.pins.ffmpeg.path, ['-version'], hostile)); assert.equal(reads, 0);
});

test('ordinary child cancellation preserves its original failure after independent integrity check', async t => {
  const h = await fixture(t), controller = new AbortController();
  const primary = Object.assign(new Error('Injected cancellation'), { code: 'CANCELLED' });
  const runtime = await h.open(async (file, args, options) => {
    const child = new EventEmitter(); child.kill = () => {}; options.onChild(child);
    controller.abort(); child.emit('close', null, 'SIGTERM'); throw primary;
  });
  await assert.rejects(runtime.createRunner()(runtime.pins.ffmpeg.path, ['-version'], { timeoutMs: 1000, signal: controller.signal }), error => {
    assert.equal(error, primary); return true;
  });
  await assert.rejects(runtime.requireCurrent()); // Settlement never revives cancellation.
});
