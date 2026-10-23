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
const { readSourceIdentity } = require('../src/source-identity.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const mode = process.argv[2];
  const adversarial = mode === '--adversarial';
  assert.equal(process.argv.length, 4);
  const manifestPath = path.resolve(process.argv[3]), manifestBytes = await fs.readFile(manifestPath), manifest = JSON.parse(manifestBytes);
  const FIXTURES = manifest.fixtures; assert.ok(Array.isArray(FIXTURES) && FIXTURES.length > 0 && FIXTURES.length <= (adversarial ? 9 : 6));
  for (const fixture of FIXTURES) assert.ok(fixture.origin.startsWith(OWNED + path.sep) && /^[a-f0-9]{64}$/.test(fixture.sha256));
  if (adversarial) {
    assert.equal(new Set(FIXTURES.map(value => value.name)).size, FIXTURES.length);
    for (const fixture of FIXTURES) {
      assert.match(fixture.name, /^[A-Za-z][A-Za-z0-9-]{0,40}$/);
      assert.equal(path.resolve(fixture.origin), fixture.origin);
      assert.ok(Number.isSafeInteger(fixture.bytes) && fixture.bytes > 0 && fixture.bytes <= 32 * 1024 ** 2);
      assert.ok(Array.isArray(fixture.expectedRefusals) && fixture.expectedRefusals.length > 0 && fixture.expectedRefusals.length <= 4);
      for (const expected of fixture.expectedRefusals) assert.ok(typeof expected.code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(expected.code)
        && typeof expected.reasonIncludes === 'string' && expected.reasonIncludes.length >= 12 && expected.reasonIncludes.length <= 400);
    }
  }
  const profileBytes = await fs.readFile(path.resolve(manifest.profiles)), profiles = JSON.parse(profileBytes).profiles.map(({role,...profile}) => ({role,profile}));
  assert.ok(['--laboratory', '--production', '--adversarial'].includes(mode));
  if (mode === '--production' || adversarial) assert.ok(HDR_POLICIES.length === 2 && HDR_POLICIES.every(cell => cell.profiles?.length), 'Default-factory confirmation requires reviewed content-derived catalog');
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/hdr-eligibility/service', id);
  const owned = path.join(OWNED, 'outputs/hdr-content-service-' + id), input = path.join(owned, 'input'), stateDir = path.join(owned, 'state');
  const report = { schema: 1, id, mode, status: 'running', startedAt: new Date().toISOString(), directory, owned, stateDir,
    purpose: 'Content-derived CPU PQ/HLG normal-service preservation, complete inspection and protected-publication qualification', manifestPath, manifestSha256: sha(manifestBytes), profilesSha256: sha(profileBytes),
    limits: { totalMs: 15 * 60000, maxInvocations: 160, forecastBytes: 1024 ** 3 }, invocations: [], cases: [],
    maximumConcurrentChildren: 0, limitations: ['Only the explicitly reviewed parameter-set configurations and conjunctive byte/count/duration/pixel-work bounds; not general HEVC/HDR.',
      'No HDR-display judgment, native UI, independent-machine, portable or vendor hardware acceptance.',
      'Laboratory mode supplies prospective main-private policies; only a fresh default-factory production run proves active catalog wiring.',
      'Complete native timing/count, input telemetry and container/independent output pixel hashes do not prove perceptual quality or source/output losslessness.'] };
  if (adversarial) {
    report.purpose = 'Default-factory normal-service adversarial source refusal before Ready, fixture encode or publication';
    report.limitations.push('Ordinary fresh capability sample encodes remain part of preparation; no adversarial fixture may reach a media encode child.');
  }
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
      if (adversarial && executable === runtime.ffmpeg) assert.ok(!report.fixtures.some(fixture => fixture.file === source), 'An adversarial fixture must never reach an FFmpeg child');
    }
    if (adversarial) assert.ok(!argv.includes('-stats_enc_pre:0'), 'No qualified fixture encode may start in refusal mode');
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
      'scripts/v07-hdr-content-service.cjs', 'resources/hdr-content-configurations.json', 'resources/hdr-content-producers.json', ...(await fs.readdir(path.join(ROOT, 'src'))).filter(name => name.endsWith('.cjs')).map(name => 'src/' + name)];
    if (adversarial) files.push('scripts/v07-hdr-content-adversarial.cjs', 'scripts/v07-hdr-content-adversarial-fixtures.cjs');
    return Promise.all(files.map(async file => ({ file, sha256: sha(await fs.readFile(path.join(ROOT, file))) })));
  }
  async function prepare(outputName, sourceDirectory = input) {
    const output = path.join(owned, outputName); await fs.mkdir(output);
    const source = await service.registerFolder(sourceDirectory, 'input'), destination = await service.registerFolder(output, 'output');
    await service.prepareBatch({ inputFolderId: source.id, outputFolderId: destination.id, settings: SETTINGS }); await service.taskPromise;
    const snapshot = service.snapshot(); assert.equal(snapshot.phase, 'ready', snapshot.error);
    report.lastPreparedSnapshot = snapshot; await save();
    for (const item of snapshot.items) assert.equal(item.status, 'ready', item.reason);
    assert.equal(snapshot.items.length, sourceDirectory === input ? FIXTURES.length : 1);
    return { snapshot, output };
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(input); await fs.mkdir(stateDir); await save();
    report.resourcesBefore = await resources();
    if (adversarial) {
      report.processesBefore = (await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '@(Get-Process ffmpeg,ffprobe,electron -ErrorAction SilentlyContinue | Select-Object ProcessName,Id) | ConvertTo-Json -Compress'],
        { windowsHide: true, timeout: 10000, maxBuffer: 65536 })).stdout.trim();
      assert.equal(report.processesBefore, '', 'No concurrent media or Electron process');
    }
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: report.purpose })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    report.sourcesBefore = await producerManifest(); runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified;
    report.gpuBefore = (await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/nvidia-smi.exe'),
      ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 10000, maxBuffer: 65536 })).stdout.trim();
    const gpu = report.gpuBefore.split(',').map(value => value.trim()); assert.equal(gpu.length, 4); assert.equal(Number(gpu[2]), 0); assert.equal(Number(gpu[3]), 0);
    report.fixtures = [];
    for (const fixture of FIXTURES) {
      const identityBefore = adversarial ? await readSourceIdentity(fixture.origin) : null;
      const origin = fixture.origin, bytes = await fs.readFile(origin); assert.equal(bytes.length, fixture.bytes); assert.equal(sha(bytes), fixture.sha256);
      const inputDirectory = adversarial ? path.join(input, fixture.name) : input;
      if (adversarial) await fs.mkdir(inputDirectory);
      const file = path.join(inputDirectory, fixture.name + '.mkv'); await fs.writeFile(file, bytes, { flag: 'wx' });
      const preservation = adversarial ? { inputDirectory, identityBefore, copyIdentityBefore: await readSourceIdentity(file) } : {};
      report.fixtures.push({ ...fixture, origin, file, ...preservation });
    }
    const runtimeIdentity = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    const policies = ['smpte2084','arib-std-b67'].map(transfer => ({ id: 'content-cpu-hdr-' + transfer + '-v1', transfer, runtimeIdentity,
      evidenceIds: ['content-hdr-laboratory-' + id + '-' + transfer], profiles: profiles.filter(p=>p.role==='source' && p.profile.transfer===transfer).map(p=>p.profile),
      outputProfiles: profiles.filter(p=>p.role==='output' && p.profile.transfer===transfer).map(p=>p.profile) }));
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(mode === '--laboratory' ? { hdrPolicies: policies, hdrPolicyIdentity: 'content-cpu-hdr-laboratory-v1:' + id } : {}) });
    report.policy = mode === '--laboratory' ? { identity: 'content-cpu-hdr-laboratory-v1:' + id, cells: policies } : { cells: HDR_POLICIES };
    const observer = controls.operationRuntime, invoke = observer.invoke.bind(observer);
    observer.invoke = (token, tool, argv, options) => tracked(runtime[tool], argv, options, (_file, args, opts) => invoke(token, tool, args, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1, runtimeIdentity, run: tracked, ...controls });
    await service.initializeDiagnostics();
    if (adversarial) {
      for (const fixture of report.fixtures) {
        const output = path.join(owned, 'refused-output-' + fixture.name); await fs.mkdir(output);
        const source = await service.registerFolder(fixture.inputDirectory, 'input'), destination = await service.registerFolder(output, 'output');
        const callStart = report.invocations.length;
        await service.prepareBatch({ inputFolderId: source.id, outputFolderId: destination.id, settings: SETTINGS }); await service.taskPromise;
        const snapshot = service.snapshot(); report.lastPreparedSnapshot = snapshot;
        report.cases.push({ name: fixture.name, status: 'checking-refusal', expectedRefusals: fixture.expectedRefusals, snapshot, output }); await save();
        const selected = report.cases.at(-1); assert.equal(snapshot.phase, 'ready', snapshot.error); assert.equal(snapshot.items.length, 1);
        assert.equal(snapshot.items.some(item => item.status === 'ready' || item.status === 'conflict'), false, 'No Ready or executable fixture');
        const item = snapshot.items[0]; assert.equal(item.status, 'unsupported', item.reason); assert.equal(item.hdr, undefined);
        const matched = fixture.expectedRefusals.find(expected => item.reasonCode === expected.code && item.reason.includes(expected.reasonIncludes));
        assert.ok(matched, `Unexpected ${fixture.name} refusal ${item.reasonCode}: ${item.reason}`);
        assert.equal(service.plan.entries.has(item.id), false, 'No prepared HDR authority survives refusal');
        const beforeStart = report.invocations.length;
        assert.throws(() => service.startBatch({ planId: snapshot.planId, fileIds: [item.id] }), { code: 'INVALID_SELECTION' });
        assert.equal(report.invocations.length, beforeStart); assert.deepEqual(await fs.readdir(output), []);
        const calls = report.invocations.slice(callStart);
        assert.equal(calls.some(call => call.argv.includes('-stats_enc_pre:0') || call.executable === runtime.ffmpeg && call.argv.some((arg, index) => arg === '-i' && call.argv[index + 1] === fixture.file)), false);
        assert.equal(sha(await fs.readFile(fixture.origin)), fixture.sha256); assert.equal(sha(await fs.readFile(fixture.file)), fixture.sha256);
        fixture.identityAfter = await readSourceIdentity(fixture.origin); fixture.copyIdentityAfter = await readSourceIdentity(fixture.file);
        assert.deepEqual(fixture.identityAfter, fixture.identityBefore); assert.deepEqual(fixture.copyIdentityAfter, fixture.copyIdentityBefore);
        Object.assign(selected, { status: 'passed-specific-refusal', observedRefusal: { code: item.reasonCode, reason: item.reason }, matched,
          noReady: true, startRefused: true, noFixtureEncodeChild: true, noOutput: true, invocationRange: [callStart, report.invocations.length] }); await save();
      }
      report.status = 'passed-bounded-hdr-adversarial-refusals';
    } else {
    const good = await prepare('qualified-output');
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
        output: { file: entry.destination, sha256: sha(await fs.readFile(entry.destination)) }, complete: (() => { const facts = entry.operationEvidence.hdrEvidence;
          assert.equal(facts.complete,true); const fixture = report.fixtures.find(value=>selected.name===value.name+'.mkv');
          assert.ok(fixture); assert.equal(facts.source.decodedFrameCount,fixture.frameCount); assert.equal(entry.telemetryValidation.records,String(fixture.frameCount));
          return {sourceFrames:facts.source.decodedFrameCount,containerFrames:facts.container.decodedFrameCount,bitstreamFrames:facts.bitstream.decodedFrameCount,
            timestamps:facts.timestamps, sourceFileSha256:facts.sourceFileSha256, outputFileSha256:facts.outputFileSha256,
            inputConfiguration:facts.source.compressed?.configuration, outputConfiguration:facts.bitstream.compressed?.configuration,
            evidenceState:'retained-facts-after-completed-plan-invalidation; no-current-execution-authority'}; })() }); await save();
    }
    // Exercise shared lifecycle seams with one already qualified input. This
    // keeps the finite campaign within its unchanged 160-child parent budget.
    const negativeInput = path.join(owned,'negative-input'); await fs.mkdir(negativeInput);
    await fs.copyFile(report.fixtures.at(-1).file,path.join(negativeInput,'negative-source.mkv'),require('node:fs').constants.COPYFILE_EXCL);
    const ready = await prepare('ready-cancel',negativeInput); const count = report.invocations.length;
    await service.cancelCurrent(); assert.equal(service.snapshot().phase, 'cancelled');
    assert.throws(() => service.startBatch({ planId: ready.snapshot.planId, fileIds: [ready.snapshot.items[0].id] }), { code: 'STALE_PLAN' });
    assert.equal(report.invocations.length, count); report.readyCancellation = { staleStartRefused: true, noChild: true };
    if (mode === '--laboratory') {
      for (const kind of ['collect-cancel', 'invalid-output']) {
        const prepared = await prepare(kind,negativeInput); cancelCollector = kind === 'collect-cancel'; corruptEncode = kind === 'invalid-output';
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
      const collision = await prepare('collision',negativeInput), chosen = collision.snapshot.items[0], entry = service.plan.entries.get(chosen.id);
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
    const restartPrepared = await prepare('restart-stale-start',negativeInput);
    const restartCount = report.invocations.length;
    await service.cancelCurrent(); await service.closeOperationResources();
    report.preRestartDiagnosticClosure = await service.closeDiagnostics('completed');
    assert.equal(report.preRestartDiagnosticClosure?.persisted, true);
    // Recreate the actual default factory/service against the same persisted
    // state. An old UI plan ID cannot restore main-private process authority.
    const restartedControls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(mode === '--laboratory' ? { hdrPolicies: policies, hdrPolicyIdentity: 'content-cpu-hdr-laboratory-v1:' + id } : {}) });
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
    }
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack };
    if (service) report.failureSnapshot = service.snapshot(); process.exitCode = 1; }
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
module.exports = { SETTINGS };
