'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { LinuxWorkbenchService, ENCODE_LIMIT_MS } = require('./workbench-service.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { checkCapabilities } = require('../src/capabilities.cjs');
const { createCandidateOrdinaryService, RESTORATION_ROOT } = require('./candidate-ordinary-service.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(t, { missing = false, execute, closeFail = false, acquireFail = false } = {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ordinary-candidate-test-'));
  let handle, closes = 0, acquisitions = 0; const calls = [], accesses = [];
  t.after(async () => { await handle?.close(); await fs.rm(root, { recursive: true }); });
  const pins = {};
  for (const kind of ['ffmpeg', 'ffprobe']) {
    const bytes = Buffer.from('inert never executed ' + kind), file = path.join(root, kind);
    await fs.writeFile(file, bytes); pins[kind] = { path: file, size: bytes.length, sha256: sha(bytes) };
  }
  const identity = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(k => ({ sizeBytes: pins[k].size, sha256: pins[k].sha256 }))));
  const source = await fs.readFile(path.join(__dirname, 'candidate-ordinary-service.cjs'), 'utf8');
  const original = createRequire(path.join(__dirname, 'candidate-ordinary-service.cjs')), module = { exports: {} };
  const overrides = {
    'node:fs/promises': { ...fs, access: async file => { accesses.push(file); if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    './candidate-calibration-runtime.cjs': { openCandidateCalibrationRuntime: async (manifest, seams) => {
      acquisitions++; assert.equal(manifest.runtimeIdentity, '1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9');
      assert.equal(manifest.dependencies.length, 7); assert.equal(manifest.pins.ffmpeg.path, path.join(RESTORATION_ROOT, 'ffmpeg'));
      assert.equal(manifest.pins.ffmpeg.sha256, 'ae5b2e8b48ad0e9b51b89ebab000ebcfc0b76a09b8cb80c88e18fddcc5d9e8ba');
      assert.equal(manifest.pins.ffprobe.sha256, '923dab8640da8804c445418b6e2efe4b395665bdb9d4cfc84f6a244ed0fb156b');
      assert.equal(typeof seams.execute, 'function');
      if (acquireFail) throw new Error('Injected identity failure');
      // VM-only acquisition seam supplies a genuine privately issued handle
      // over inert bytes. No fixed runtime file or calibration receipt is read.
      handle = await openCandidateCalibrationRuntime({ pins, runtimeIdentity: identity, dependencies: [] }, {
        execute: async (file, args, options) => { calls.push({ file, args, options });
          const child = new (require('node:events').EventEmitter)(); child.kill = () => {}; options.onChild(child);
          try { return execute ? await execute(file, args, options) : { exitCode: 0, stdout: '', stderr: '' }; }
          finally { child.emit('close', 0, null); }
        }
      });
      return { ...handle, async close() { closes++; await handle.close(); if (closeFail) throw new Error('Injected close failure'); } };
    } },
  };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: 'candidate-ordinary-service.cjs' })(
    name => Object.hasOwn(overrides, name) ? overrides[name] : original(name), module, module.exports, __dirname);
  return { api: module.exports, root, pins, calls, accesses, counts: () => ({ closes, acquisitions }), handle: () => handle };
}
const args = encoder => ['-nostdin', '-n', '-i', '/inert.mkv', '-c:v:0', encoder, '-progress', 'pipe:1', '-f', 'matroska', '/stage.mkv'];
test('ordinary candidate accepts only inert main-owned options; no arbitrary runtime/report controls', async () => {
  let getters = 0;
  for (const options of [null, {}, { stateDir: 'relative' }, { stateDir: '/tmp/x', runtime: {} },
    { stateDir: '/tmp/x', report: '/anything' }, { stateDir: '/tmp/x', outputAccess: {} },
    Object.defineProperty({}, 'stateDir', { enumerable: true, get() { getters++; return '/tmp/x'; } })])
    await assert.rejects(createCandidateOrdinaryService(options), { code: 'CANDIDATE_ORDINARY_OPTIONS' });
  assert.equal(getters, 0);
});
test('source-only missing fixed pair refuses before acquisition with no fallback or report read', async t => {
  const h = await fixture(t, { missing: true });
  await assert.rejects(h.api.createCandidateOrdinaryService({ stateDir: h.root }), { code: 'CANDIDATE_ORDINARY_NOT_RESTORED' });
  assert.equal(h.counts().acquisitions, 0); assert.equal(h.calls.length, 0);
  assert.deepEqual(h.accesses, [path.join(RESTORATION_ROOT, 'ffmpeg')]);
});
test('genuine composition retains superclass, fresh canonical capability checker and unmodified preference defaults', async t => {
  const h = await fixture(t), s = await h.api.createCandidateOrdinaryService({ stateDir: path.join(h.root, 'state') });
  assert.ok(s instanceof LinuxWorkbenchService); assert.ok(s instanceof EncoderService);
  assert.equal(s.capabilities, checkCapabilities); assert.equal(s.capabilityResult, null);
  assert.equal(s.remuxOperations, null); assert.equal(s.hdrOperations, null); assert.equal(s.operationQualifications, null);
  assert.equal(s.ffmpeg, h.pins.ffmpeg.path); assert.equal(h.calls.length, 0);
  const baseline = new LinuxWorkbenchService({ ffmpeg: h.pins.ffmpeg.path, ffprobe: h.pins.ffprobe.path, stateDir: path.join(h.root, 'baseline') });
  const a = await s.getPreferences(), b = await baseline.getPreferences();
  assert.equal(a.profileId, b.profileId); assert.deepEqual(a.settingsByProfile, b.settingsByProfile);
  await s.closeOperationResources(); await s.closeOperationResources(); assert.equal(h.counts().closes, 1);
  await s.closeDiagnostics(); await baseline.closeDiagnostics();
});
test('three ordinary CPU encoders retain argv, limits and terminal progress through genuine runtime wrapper', async t => {
  const h = await fixture(t, { execute: async (_f, _a, o) => { o.onProgress?.({ ended: true }); return { exitCode: 0, stdout: '', stderr: '' }; } });
  const s = await h.api.createCandidateOrdinaryService({ stateDir: h.root });
  for (const encoder of ['libx264', 'libx265', 'libsvtav1']) {
    const input = args(encoder); let terminal = false;
    await s.run(s.ffmpeg, input, { timeoutMs: 0, onProgress: p => terminal ||= p.ended });
    assert.deepEqual(h.calls.at(-1).args, input); assert.equal(h.calls.at(-1).options.timeoutMs, ENCODE_LIMIT_MS);
    assert.equal(h.calls.at(-1).options.stdoutLimit, 16 * 1024 * 1024); assert.equal(terminal, true);
  }
  await s.closeOperationResources();
});
test('unknown tools, GPU, unbounded calls and missing terminal progress refuse without silent fallback', async t => {
  const h = await fixture(t), s = await h.api.createCandidateOrdinaryService({ stateDir: h.root });
  await assert.rejects(s.run('/other', []), { code: 'LINUX_WORKBENCH_TOOL' });
  await assert.rejects(s.run(s.ffmpeg, ['-c:v:0', 'hevc_nvenc']), { code: 'LINUX_WORKBENCH_GPU_UNTESTED' });
  await assert.rejects(s.run(s.ffprobe, [], { timeoutMs: 0 }), { code: 'LINUX_WORKBENCH_OPTIONS' });
  assert.equal(h.calls.length, 0);
  await assert.rejects(s.run(s.ffmpeg, args('libx264'), { timeoutMs: 0, onProgress() {} }), { code: 'LINUX_WORKBENCH_INCOMPLETE' });
  await s.closeOperationResources();
});
test('changed inert runtime bytes refuse before execution and repeated resource close is single flight', async t => {
  const h = await fixture(t), s = await h.api.createCandidateOrdinaryService({ stateDir: h.root });
  await fs.appendFile(h.pins.ffmpeg.path, 'changed');
  await assert.rejects(s.run(s.ffprobe, ['-version'])); assert.equal(h.calls.length, 0);
  const a = s.closeOperationResources(), b = s.closeOperationResources(); assert.equal(a, b); await a;
  assert.equal(h.counts().closes, 1);
});
test('cancellation synchronously closes admission; cleanup failure remains failed and cannot reopen owner', async t => {
  const h = await fixture(t, { closeFail: true }), s = await h.api.createCandidateOrdinaryService({ stateDir: h.root });
  const pending = s.cancelCurrent(); assert.equal(s.admissionClosed, true);
  assert.throws(() => s.startBatch({ fileIds: ['x'] }), { code: 'SHUTTING_DOWN' }); await pending;
  await assert.rejects(s.closeOperationResources(), AggregateError); await assert.rejects(s.closeOperationResources(), AggregateError);
  assert.equal(h.counts().closes, 1); await assert.rejects(h.handle().requireCurrent());
});
test('ordinary admission preserves unsupported edits and delegates stale plan validation to superclass', async t => {
  const h = await fixture(t), s = await h.api.createCandidateOrdinaryService({ stateDir: h.root });
  assert.throws(() => s.startBatch({ planId: '00000000-0000-0000-0000-000000000000', fileIds: [] }), { code: 'STALE_PLAN' });
  s.plan = { operation: 'encode', sameFolder: true, settings: { profileId: 'h264-cpu' }, entries: new Map() };
  assert.throws(() => s.startBatch({ fileIds: ['x'] }), { code: 'LINUX_WORKBENCH_ROUTE_UNAVAILABLE' });
  s.plan.sameFolder = false;
  s.plan.entries.set('x', { operationPlan: { compatibilityPath: false } });
  assert.throws(() => s.startBatch({ fileIds: ['x'] }), { code: 'LINUX_WORKBENCH_ROUTE_UNAVAILABLE' });
  s.plan = null; await s.closeOperationResources();
});
test('fresh capability initialization executes canonical version validation and never borrows baseline availability', async t => {
  const h = await fixture(t), s = await h.api.createCandidateOrdinaryService({ stateDir: path.join(h.root, 'state') });
  await assert.rejects(s.getCapabilities(), { code: 'CAPABILITIES_FAILED' });
  assert.equal(s.capabilityResult, null); assert.ok(h.calls.length > 0);
  assert.deepEqual(h.calls[0].args, ['-version']); assert.equal(h.calls[0].file, h.pins.ffmpeg.path);
  assert.equal(s.capabilities, checkCapabilities);
  await s.cancelCurrent(); await s.closeOperationResources(); await s.closeDiagnostics();
});
test('fixed candidate acquisition failure produces no service or baseline fallback', async t => {
  const h = await fixture(t, { acquireFail: true });
  await assert.rejects(h.api.createCandidateOrdinaryService({ stateDir: path.join(h.root, 'not-created') }), /Injected identity failure/);
  assert.equal(h.counts().acquisitions, 1); assert.equal(h.calls.length, 0);
  await assert.rejects(fs.stat(path.join(h.root, 'not-created')), { code: 'ENOENT' });
});

test('ordinary snapshot publishes sticky closed notice synchronously before cancellation drainage',async t=>{
 const h=await fixture(t),s=await h.api.createCandidateOrdinaryService({stateDir:h.root});
 const updates=[];s.on('update',snapshot=>updates.push(snapshot));
 const before=s.snapshot();assert.equal(before.developerOrdinary.relaunchRequired,false);
 const cancellation=s.cancelCurrent();assert.equal(updates[0].developerOrdinary.relaunchRequired,true);
 assert.match(updates[0].developerOrdinary.relaunchNotice,/drain.*relaunch/);
 await cancellation;assert.equal(s.snapshot().developerOrdinary.relaunchRequired,true);
 await s.closeOperationResources();
});
