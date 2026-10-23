'use strict';

// Root-scheduled finite-family qualification. Real normal inspection/capability,
// controls, collection, validation and publication; no BrowserWindow/display or
// portable/benchmark acceptance. Laboratory policies are explicit and retained.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { EncoderService } = require('../src/encoder-service.cjs');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { HDR_POLICIES } = require('../src/hdr-catalog.cjs');
const { runTool } = require('../src/process-runner.cjs');
const { frameIdentity } = require('./v07-hdr-smoke.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SEEDS = path.join(OWNED, 'fixtures/hdr-preserve-28c95f1e-de3a-41fd-92e1-e6726dedabaf');
const FIXTURES = Object.freeze([
  { name: 'pq', transfer: 'smpte2084', bytes: 129857, sha256: '15cc2f166e4f8a3f61ac741129ce5a5243b44351849c09f6a494fb7abcbba095' },
  { name: 'hlg', transfer: 'arib-std-b67', bytes: 118634, sha256: 'f7e48e0fd2eee885d1167b544fd4f1aca5cc64f47a471801ce9c6fdc2ffa28b7' },
]);
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const mode = process.argv[2];
  assert.equal(process.argv.length, 3);
  assert.ok(['--laboratory', '--production'].includes(mode));
  if (mode === '--production') assert.equal(HDR_POLICIES.length, 2, 'Production confirmation requires the reviewed two-cell catalog');
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/slice4a/service', id);
  const owned = path.join(OWNED, 'outputs/hdr-family-' + id), input = path.join(owned, 'input'), stateDir = path.join(owned, 'state');
  const report = { schema: 1, id, mode, status: 'running', startedAt: new Date().toISOString(), directory, owned, stateDir,
    purpose: 'Finite CPU PQ/HLG normal-service preservation and failure/closure qualification',
    limits: { totalMs: 15 * 60000, maxInvocations: 160, forecastBytes: 1024 ** 3 }, invocations: [], cases: [],
    maximumConcurrentChildren: 0, limitations: ['Exactly two tiny generated96-frame320x180CPU cells; not general HDR.',
      'No HDR-display judgment, native UI, independent-machine, portable or vendor hardware acceptance.',
      'Laboratory mode supplies prospective main-private policies; only a fresh default-factory production run proves active catalog wiring.',
      'Numeric frame IDs prove generated presentation membership/order, not perceptual quality or lossless pixels.'] };
  const children = new Set(), started = Date.now(), leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
  let runtime, service, lease, leaseIdentity, aborted = false, cancelCollector = false, corruptEncode = false, cancelTimer;
  const save = () => fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const abort = () => { aborted = true; void service?.cancelCurrent(); };
  const timer = setTimeout(abort, report.limits.totalMs); timer.unref();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  async function resources() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const value = { observedAt: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize };
    assert.ok(value.DFreeBytes >= 25 * 1024 ** 3 && value.FFreeBytes >= report.limits.forecastBytes + 512 * 1024 ** 2);
    return value;
  }
  async function tracked(executable, argv, options = {}, execute = runTool) {
    assert.ok(!aborted && Date.now() - started < report.limits.totalMs, 'Whole endpoint budget');
    const storageHelper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (executable === storageHelper) {
      assert.deepEqual(argv.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(argv.length, 5); assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
      assert.ok(argv[4].includes('[System.IO.DriveInfo]::new'));
    } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(executable), 'Fixed observed tools only');
    assert.equal(children.size, 0, 'Actual children remain sequential through close');
    assert.ok(report.invocations.length < report.limits.maxInvocations); assert.ok(!argv.includes('-y'));
    for (let i = 0; i < argv.length; i++) if (argv[i] === '-i') {
      const source = argv[i + 1]; assert.ok(source.startsWith(owned + path.sep) || source.startsWith('color=') || source.startsWith('testsrc2='), 'Only owned/capability sources');
    }
    const call = { executable, argv: [...argv], startedAt: new Date().toISOString(), status: 'running' };
    report.invocations.push(call); await save(); let child;
    try {
      const result = await execute(executable, argv, { ...options, onChild(value) {
        child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size);
        value.once('close', (code, signal) => { call.closed = { code, signal }; children.delete(value); }); options.onChild?.(value);
        if (cancelCollector && service?.state.progress?.stage === 'evidence-collection' && argv.includes('-show_frames')) {
          cancelCollector = false; call.testInjection = 'Requested cancellation after the actual complete-frame evidence child started.';
          call.cancellationStage = service.state.progress.stage;
          cancelTimer = setTimeout(() => void service.cancelCurrent(), 0);
        }
      } });
      Object.assign(call, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr,
        stderrCapture: result.stderrCapture, stdoutCapture: result.stdoutCapture });
      if (corruptEncode && argv.includes('-stats_enc_pre:0')) {
        corruptEncode = false; const stage = argv.at(-1);
        assert.ok(stage.startsWith(owned + path.sep));
        const handle = await fs.open(stage, 'r+'); try { await handle.write(Buffer.from('NOHDR123'), 0, 8, 0); await handle.sync(); } finally { await handle.close(); }
        call.testInjection = 'Corrupted only this owned incomplete stage after actual encode close; no substituted validator/probe result.';
      }
      return result;
    } catch (error) { Object.assign(call, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture }); throw error; }
    finally { if (child) assert.ok(call.closed, 'Actual child close observed'); call.finishedAt = new Date().toISOString(); await save(); }
  }
  async function producerManifest() {
    const files = ['main.js', 'preload.js', 'package.json', 'resources/binary-manifest.json', 'ui/index.html', 'ui/renderer.js', 'ui/styles.css',
      'scripts/v07-hdr-family-service.cjs', 'scripts/v07-hdr-smoke.cjs', ...(await fs.readdir(path.join(ROOT, 'src'))).filter(name => name.endsWith('.cjs')).map(name => 'src/' + name)];
    return Promise.all(files.map(async file => ({ file, sha256: sha(await fs.readFile(path.join(ROOT, file))) })));
  }
  async function prepare(outputName, sourceDirectory = input) {
    const output = path.join(owned, outputName); await fs.mkdir(output);
    const source = await service.registerFolder(sourceDirectory, 'input'), destination = await service.registerFolder(output, 'output');
    await service.prepareBatch({ inputFolderId: source.id, outputFolderId: destination.id, settings: SETTINGS }); await service.taskPromise;
    const snapshot = service.snapshot(); assert.equal(snapshot.phase, 'ready', snapshot.error);
    for (const item of snapshot.items) assert.equal(item.status, 'ready', item.reason);
    assert.equal(snapshot.items.length, sourceDirectory === input ? 2 : 1);
    return { snapshot, output };
  }
  async function numericIds(file) {
    const bytesPerFrame = 320 * 180 * 3, ids = []; let pending = Buffer.alloc(0);
    await tracked(runtime.ffmpeg, ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0',
      '-an', '-sn', '-dn', '-fps_mode', 'passthrough', '-pix_fmt', 'yuv420p10le', '-f', 'rawvideo', 'pipe:1'],
    { timeoutMs: 120000, stdoutLimit: 20 * 1024 ** 2, onStdoutChunk(chunk) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= bytesPerFrame) { const observed = frameIdentity(pending.subarray(0, bytesPerFrame)); assert.equal(observed, ids.length); ids.push(observed); pending = pending.subarray(bytesPerFrame); }
      assert.ok(ids.length <= 96 && pending.length < bytesPerFrame);
    } });
    assert.equal(pending.length, 0); assert.equal(ids.length, 96);
    return { frameCount: ids.length, everyPresentationIdMatched: true, frameIdsSha256: sha(JSON.stringify(ids)), pixelQualityClaim: 'none' };
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(input); await fs.mkdir(stateDir); await save();
    report.resourcesBefore = await resources();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: report.purpose })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    report.sourcesBefore = await producerManifest(); runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified;
    report.gpuBefore = (await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/nvidia-smi.exe'),
      ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 10000, maxBuffer: 65536 })).stdout.trim();
    const gpu = report.gpuBefore.split(',').map(value => value.trim()); assert.equal(gpu.length, 4); assert.equal(Number(gpu[2]), 0); assert.equal(Number(gpu[3]), 0);
    report.fixtures = [];
    for (const fixture of FIXTURES) {
      const origin = path.join(SEEDS, fixture.name + '-seed.mkv'), bytes = await fs.readFile(origin); assert.equal(bytes.length, fixture.bytes); assert.equal(sha(bytes), fixture.sha256);
      const file = path.join(input, fixture.name + '.mkv'); await fs.writeFile(file, bytes, { flag: 'wx' }); report.fixtures.push({ ...fixture, origin, file });
    }
    const runtimeIdentity = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    const policies = FIXTURES.map(value => ({ id: 'tiny-cpu-hdr-' + value.name + '-v1', transfer: value.transfer, sourceSha256: value.sha256,
      evidenceIds: ['slice4a-laboratory-' + id + '-' + value.name], runtimeIdentity }));
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(mode === '--laboratory' ? { hdrPolicies: policies, hdrPolicyIdentity: 'tiny-cpu-hdr-laboratory-v1:' + id } : {}) });
    report.policy = mode === '--laboratory' ? { identity: 'tiny-cpu-hdr-laboratory-v1:' + id, cells: policies } : { cells: HDR_POLICIES };
    const observer = controls.operationRuntime, invoke = observer.invoke.bind(observer);
    observer.invoke = (token, tool, argv, options) => tracked(runtime[tool], argv, options, (_file, args, opts) => invoke(token, tool, args, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1, runtimeIdentity, run: tracked, ...controls });
    await service.initializeDiagnostics(); const good = await prepare('qualified-output');
    report.prepared = good.snapshot; report.preparedDetails = good.snapshot.items.map(item => service.getEncodingDetails({ planId: good.snapshot.planId, fileId: item.id }));
    service.startBatch({ planId: good.snapshot.planId, fileIds: good.snapshot.items.map(item => item.id) }); await service.taskPromise;
    report.result = service.snapshot(); assert.equal(report.result.phase, 'completed', report.result.error);
    for (const selected of good.snapshot.items) {
      const item = report.result.items.find(value => value.id === selected.id), entry = service.plan.entries.get(selected.id);
      assert.equal(item.status, 'success', item.reason); assert.equal(entry.operationEvidence.status, 'completed'); assert.equal(entry.telemetryValidation.valid, true);
      assert.equal(item.evidenceStorage.final.violations.length, 0); assert.equal(item.outputDisposition.published, true);
      report.cases.push({ name: selected.name, status: 'passed-normal-service', item, evidence: entry.operationEvidence,
        telemetry: entry.operationTelemetryReceipt, telemetryValidation: entry.telemetryValidation,
        detailsAfter: service.getEncodingDetails({ planId: good.snapshot.planId, fileId: selected.id }),
        output: { file: entry.destination, sha256: sha(await fs.readFile(entry.destination)) }, numeric: await numericIds(entry.destination) }); await save();
    }
    const ready = await prepare('ready-cancel'); const count = report.invocations.length;
    await service.cancelCurrent(); assert.equal(service.snapshot().phase, 'cancelled');
    assert.throws(() => service.startBatch({ planId: ready.snapshot.planId, fileIds: [ready.snapshot.items[0].id] }), { code: 'STALE_PLAN' });
    assert.equal(report.invocations.length, count); report.readyCancellation = { staleStartRefused: true, noChild: true };
    if (mode === '--laboratory') {
      for (const kind of ['collect-cancel', 'invalid-output']) {
        const prepared = await prepare(kind); cancelCollector = kind === 'collect-cancel'; corruptEncode = kind === 'invalid-output';
        const firstNegativeCall = report.invocations.length;
        service.startBatch({ planId: prepared.snapshot.planId, fileIds: [prepared.snapshot.items[0].id] }); await service.taskPromise;
        const result = service.snapshot(), entry = service.plan.entries.get(prepared.snapshot.items[0].id);
        const calls = report.invocations.slice(firstNegativeCall), encoded = calls.find(call => call.argv.includes('-stats_enc_pre:0'));
        assert.equal(encoded?.closed?.code, 0, 'The real encode succeeded before the negative stimulus');
        const resultItem = result.items.find(value => value.id === prepared.snapshot.items[0].id);
        assert.equal(resultItem.status, kind === 'collect-cancel' ? 'cancelled' : 'failed');
        if (kind === 'collect-cancel') {
          assert.equal(result.phase, 'cancelled'); assert.equal(resultItem.reasonCode, 'CANCELLED');
          assert.equal(entry.operationEvidence.status, 'cancelled'); assert.equal(entry.operationEvidence.failure.code, 'CANCELLED');
          assert.equal(cancelCollector, false); assert.ok(calls.some(call => call.testInjection && call.cancellationStage === 'evidence-collection'));
        } else {
          assert.equal(corruptEncode, false); assert.ok(encoded.testInjection?.startsWith('Corrupted only this owned incomplete stage'));
          assert.equal(resultItem.reasonCode, 'TOOL_FAILED');
          assert.ok(calls.some(call => call.executable === runtime.ffprobe && call.status === 'failed'));
        }
        await assert.rejects(fs.stat(entry.destination), { code: 'ENOENT' });
        assert.notEqual(result.items.find(value => value.id === prepared.snapshot.items[0].id).outputDisposition?.published, true);
        report.cases.push({ name: kind, status: 'passed-no-publication-negative', result }); await save();
      }
      const collision = await prepare('collision'), chosen = collision.snapshot.items[0], entry = service.plan.entries.get(chosen.id);
      const sentinel = Buffer.from('Owned collision sentinel; never replaced'); await fs.writeFile(entry.destination, sentinel, { flag: 'wx' });
      const countBeforeStart = report.invocations.length; service.startBatch({ planId: collision.snapshot.planId, fileIds: [chosen.id] }); await service.taskPromise;
      assert.equal(service.snapshot().items.find(value => value.id === chosen.id).status, 'skipped'); assert.equal(report.invocations.length, countBeforeStart);
      assert.deepEqual(await fs.readFile(entry.destination), sentinel); report.collision = { unchanged: true, noChild: true };
      const changedInput = path.join(owned, 'changed-input'); await fs.mkdir(changedInput);
      const changedFile = path.join(changedInput, 'owned-change.mkv');
      await fs.copyFile(report.fixtures[0].file, changedFile, require('node:fs').constants.COPYFILE_EXCL);
      const changed = await prepare('source-change', changedInput), changedItem = changed.snapshot.items[0];
      const changedEntry = service.plan.entries.get(changedItem.id), beforeChangeCalls = report.invocations.length;
      // Intentional mutation of a fresh owned negative-test copy only. The
      // retained seeds and positive inputs/outputs remain byte-protected.
      await fs.appendFile(changedFile, Buffer.from('owned source-identity negative'));
      service.startBatch({ planId: changed.snapshot.planId, fileIds: [changedItem.id] }); await service.taskPromise;
      const changedResult = service.snapshot(), failed = changedResult.items.find(value => value.id === changedItem.id);
      assert.equal(failed.status, 'failed'); assert.equal(failed.reasonCode, 'INPUT_CHANGED');
      assert.equal(report.invocations.slice(beforeChangeCalls).filter(call => call.executable === runtime.ffmpeg).length, 0);
      await assert.rejects(fs.stat(changedEntry.destination), { code: 'ENOENT' });
      report.sourceChange = { refused: true, noEncodeChild: true, result: changedResult }; await save();
    }
    const restartPrepared = await prepare('restart-stale-start');
    const restartCount = report.invocations.length;
    await service.cancelCurrent(); await service.closeOperationResources();
    report.preRestartDiagnosticClosure = await service.closeDiagnostics('completed');
    assert.equal(report.preRestartDiagnosticClosure?.persisted, true);
    // Recreate the actual default factory/service against the same persisted
    // state. An old UI plan ID cannot restore main-private process authority.
    const restartedControls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(mode === '--laboratory' ? { hdrPolicies: policies, hdrPolicyIdentity: 'tiny-cpu-hdr-laboratory-v1:' + id } : {}) });
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1, runtimeIdentity, run: tracked, ...restartedControls });
    await service.initializeDiagnostics();
    assert.equal(service.plan, null);
    assert.throws(() => service.startBatch({ planId: restartPrepared.snapshot.planId, fileIds: [restartPrepared.snapshot.items[0].id] }), { code: 'STALE_PLAN' });
    assert.equal(report.invocations.length, restartCount);
    report.serviceRecreation = { samePersistedState: true, noRestoredPlan: true, staleStartRefused: true, noChild: true,
      nativeApplicationRestart: 'not-assessed' };
    for (const source of report.fixtures) { assert.equal(sha(await fs.readFile(source.origin)), source.sha256); assert.equal(sha(await fs.readFile(source.file)), source.sha256); }
    for (const value of report.cases.filter(value => value.output)) assert.equal(sha(await fs.readFile(value.output.file)), value.output.sha256);
    report.status = 'passed-bounded-hdr-family-service';
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    clearTimeout(timer); clearTimeout(cancelTimer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    report.closureFailures = [];
    async function attempt(label, action) { try { await action(); } catch (error) { report.closureFailures.push({ label, code: error.code, message: error.message }); report.status = 'failed-retained'; process.exitCode = 1; } }
    if (service) {
      await attempt('cancel', () => service.cancelCurrent()); await attempt('operation-resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => { report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed'); assert.equal(report.diagnosticClosure?.persisted, true); });
    }
    report.liveChildren = children.size; await attempt('actual-child-closure', async () => assert.equal(children.size, 0));
    if (lease && !children.size && !report.closureFailures.length) await attempt('media-lease', async () => {
      const named = await fs.lstat(leasePath, { bigint: true }); assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino);
      assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).token, id); await lease.close(); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    if (report.sourcesBefore) await attempt('source-freeze', async () => { report.sourcesAfter = await producerManifest(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); });
    if (report.resourcesBefore) await attempt('final-space', async () => { report.resourcesAfter = await resources(); });
    report.finishedAt = new Date().toISOString(); await save();
    process.stdout.write(JSON.stringify({ id, status: report.status, report: path.join(directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }) + '\n');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { FIXTURES, SETTINGS };
