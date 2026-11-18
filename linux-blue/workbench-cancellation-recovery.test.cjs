'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
const { runTool } = require('../src/process-runner.cjs');
const { PROFILES } = require('../src/media.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cancelled = () => Object.assign(new Error('Inert inspection settled after cancellation'), { code: 'CANCELLED' });
async function harness(t, { holdTarget = false, holdInspection = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-cancellation-')); let service;
  const targetGate = deferred(), inspectionGate = deferred(), targetEntered = deferred(), inspectionEntered = deferred();
  t.after(async () => { targetGate.resolve(); inspectionGate.resolve(); if (service) { service.closeAdmission(); await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics('completed'); } await fs.rm(root, { recursive: true, force: true }); });
  const input = path.join(root, 'input'), output = path.join(root, 'output'); await fs.mkdir(input); await fs.mkdir(output);
  for (const name of ['a.mp4', 'b.mp4']) await fs.writeFile(path.join(input, name), 'Owned inert source '+name);
  const pins = { ffmpeg: { path: path.join(root, 'inert-ffmpeg') }, ffprobe: { path: path.join(root, 'inert-ffprobe') } };
  for (const pin of Object.values(pins)) await fs.writeFile(pin.path, 'Not executable; injected process only');
  const video = { index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', disposition: { default: 1 } };
  const inspection = () => ({ probe: { streams: [video] }, color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] }, duration: 2,
    summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } });
  const children = [], invocations = [], verified = [], targetProgress = [], inspectCallbacks = [], targets = [];
  let live = 0, maximum = 0, inspections = 0;
  function spawnImpl(executable, args, spawnOptions) {
    assert.equal(spawnOptions.shell, false); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kills = []; child.kill = signal => { child.kills.push(signal || 'SIGTERM'); return true; };
    child.closed = false; children.push(child); live++; maximum = Math.max(maximum, live);
    const target = executable === pins.ffmpeg.path;
    if (target) targets.push({ child, args: [...args], file: args.at(-1) });
    setImmediate(async () => {
      try {
        if (target) {
          await fs.writeFile(args.at(-1), 'Inert staged output'); child.stdout.write('frame=1\nout_time_us=100000\nprogress=continue\n');
          if (holdTarget && targets.length === 1) { targetEntered.resolve(); await targetGate.promise; }
          if (child.kills.length) { child.stdout.end(); child.stderr.end(); child.closed = true; live--; child.emit('close', null, 'SIGTERM'); return; }
          child.stdout.end('frame=60\nout_time_us=2000000\nprogress=end\n');
        } else {
          const encoded = targets.find(row => row.file === args.at(-1)); const tags = {};
          for (let i = 0; i < (encoded?.args.length || 0); i++) if (encoded.args[i] === '-metadata') {
            const value = encoded.args[i+1], cut = value.indexOf('='); tags[value.slice(0,cut)] = value.slice(cut+1);
          }
          child.stdout.end(JSON.stringify({ ...inspection().probe, format: { tags } }));
        }
        child.stderr.end(); child.closed = true; live--; child.emit('close', 0, null);
      } catch (error) { child.emit('error', error); child.stdout.end(); child.stderr.end(); child.closed = true; live--; child.emit('close', 1, null); }
    });
    return child;
  }
  // Real factory, real ordinary runner/argument validator and real process settlement.
  // Only fixed-tool verification and process spawn are injected; no binary executes.
  const filename = path.join(__dirname, 'workbench-service.cjs'), originalRequire = createRequire(filename), module = { exports: {} };
  const localRequire = name => name === './runtime.cjs' ? { PINS: pins, verifyTool: async kind => { verified.push(kind); return pins[kind]; } }
    : name === '../src/process-runner.cjs' ? { ...originalRequire(name), runTool: (exe, args, options) => {
      invocations.push({ exe, args: [...args], options }); if (typeof options.onProgress === 'function' && exe === pins.ffmpeg.path) targetProgress.push(options.onProgress);
      return runTool(exe, args, { ...options, spawnImpl });
    } } : originalRequire(name);
  new Function('require', 'module', 'exports', await fs.readFile(filename, 'utf8'))(localRequire, module, module.exports);
  service = await module.exports.createWorkbenchService({ stateDir: path.join(root, 'state') });
  assert.deepEqual(verified, ['ffmpeg', 'ffprobe']); assert.ok(service instanceof module.exports.LinuxWorkbenchService);
  // Capability/media facts are inert inputs, not a claim to exercise startup codec tests.
  service.capabilities = async () => ({ profiles: PROFILES.map(p => ({ ...p, available: p.hardware === 'CPU', supportedBitDepths: [8,10] })), versions: {} });
  service.inspect = async (file, options) => { inspections++; inspectCallbacks.push(options.onStage); options.onStage?.({ stage: 'inert-inspection' });
    if (holdInspection && inspections === 1) { inspectionEntered.resolve(); await inspectionGate.promise; }
    if (options.signal?.aborted) throw cancelled(); return inspection(); };
  service.verify = () => ({ valid: true, errors: [] });
  const inf = await service.registerFolder(input, 'input'), outf = await service.registerFolder(output, 'output');
  const prepare = () => service.prepareBatch({ inputFolderId: inf.id, outputFolderId: outf.id, settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 } });
  const start = p => service.startBatch({ planId: p.planId, fileIds: p.items.map(row => row.id) });
  return { service, prepare, start, output, targetGate, inspectionGate, targetEntered, inspectionEntered, targets, children, targetProgress, inspectCallbacks,
    counters: () => ({ live, maximum, spawned: children.length, closed: children.filter(c => c.closed).length }), invocations, verified };
}
test('ordinary active cancellation owns child close, stops queue and supports fresh preparation/start on same service', async t => {
  const h = await harness(t, { holdTarget: true }); const plan = await h.prepare(); assert.ok(plan.items.every(i => i.status === 'ready'));
  h.start(plan); await h.targetEntered.promise; assert.equal(h.targets.length, 1); assert.equal(h.service.snapshot().progress.frame, 1);
  let settled = false; const cancelling = h.service.cancelCurrent().then(r => { settled = true; return r; }); await tick();
  assert.equal(settled, false); assert.equal(h.service.busy, true); assert.equal(h.service.snapshot().phase, 'cancelling');
  assert.throws(() => h.start(plan), { code: 'BUSY' }); await assert.rejects(h.prepare(), { code: 'BUSY' });
  assert.equal(h.targets[0].child.closed, false); assert.ok(h.targets[0].child.kills.length > 0);
  h.targetGate.resolve(); const stopped = await cancelling;
  assert.equal(stopped.phase, 'cancelled'); assert.equal(h.targets.length, 1); assert.equal(stopped.counts.cancelled, 1); assert.equal(stopped.counts.unprocessed, 1);
  assert.equal(stopped.items[0].outputAccess, undefined);
  assert.equal(stopped.items[0].outputDisposition, undefined);
  assert.equal(stopped.items[0].cleanup.retained, true);
  assert.match(stopped.items[0].cleanup.reason, /never identity-bound/);
  for (const item of stopped.items) await assert.rejects(fs.stat(path.join(h.output, item.outputName)), { code: 'ENOENT' });
  // A written unvalidated stage may remain owned and retained. It is not publication.
  const remaining = await fs.readdir(h.output); assert.ok(remaining.every(name => name.startsWith('.ffmpeg-encoder-')));
  assert.equal(h.counters().live, 0);
  const next = await h.prepare(); h.start(next); await h.service.taskPromise;
  const completed = h.service.snapshot(); assert.equal(completed.counts.success, 2); assert.equal(h.targets.length, 3);
  const revision = completed.revision; h.targetProgress[0]({ seconds: 999, frame: 999, ended: true }); await tick();
  assert.equal(h.service.snapshot().revision, revision); assert.notEqual(h.service.snapshot().progress.seconds, 999);
  assert.equal(h.counters().spawned, h.counters().closed); assert.equal(h.counters().maximum, 1);
  assert.ok(h.invocations.filter(x => x.exe.endsWith('inert-ffmpeg')).every(x => x.options.timeoutMs === 1800000));
});
test('ordinary preparation cancel drains inspection, revokes plan and fences old callbacks during new preparation', async t => {
  const h = await harness(t, { holdInspection: true }); const pending = h.prepare(); await h.inspectionEntered.promise;
  let settled = false; const cancel = h.service.cancelCurrent().then(r => { settled = true; return r; }); await tick();
  assert.equal(settled, false); assert.equal(h.service.busy, true); assert.equal(h.targets.length, 0);
  h.inspectionGate.resolve(); await pending; await cancel; assert.equal(h.service.plan, null);
  const old = h.inspectCallbacks[0]; const next = await h.prepare(); const revision = h.service.snapshot().revision;
  old({ stage: 'STALE_INSPECTOR', window: 999 }); assert.equal(h.service.snapshot().revision, revision);
  assert.notEqual(h.service.snapshot().preparation?.stage, 'STALE_INSPECTOR');
  h.start(next); await h.service.taskPromise; assert.equal(h.service.snapshot().counts.success, 2);
  assert.equal(h.counters().live, 0); assert.equal(h.counters().spawned, h.counters().closed);
});
