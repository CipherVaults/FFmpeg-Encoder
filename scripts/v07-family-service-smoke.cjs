'use strict';

// Root-scheduled functional endpoint. Uses normal production inspection,
// capability checks and the same main-private controls/catalog as main.js.
// This is not a native window, benchmark, portable or release acceptance.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const FIXTURES = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.deepEqual(process.argv.slice(2), ['--run-owned-service']);
  const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
  // Record 47 Q2a: one CPU cell plus one NVIDIA cell per measured driver.
  assert.ok(FAMILIES.length >= 2 && FAMILIES.filter(item => item.settings.profileId === 'h265-cpu').length === 1
    && FAMILIES.some(item => item.settings.profileId === 'h265-nvidia'), 'A reviewed CPU/NVIDIA catalog is required before this endpoint');
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/slice2/family-service', id);
  const owned = path.join(OWNED, 'outputs', 'family-service-' + id), input = path.join(owned, 'media'), stateDir = path.join(owned, 'state');
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock'), children = new Set();
  const report = { schema: 1, id, status: 'running', directory, owned, startedAt: new Date().toISOString(),
    purpose: 'Fresh normal service inspection/capabilities and main factory/catalog; no native UI/benchmark acceptance',
    invocations: [], cases: [], maximumConcurrentChildren: 0, limits: { totalMs: 15 * 60000, forecastBytes: 1024 ** 3, maxInvocations: 120 },
    limitations: ['No native BrowserWindow input or packaged endpoint.', 'Only the exact qualified short SDR family and current observed NVIDIA UUID/driver.',
      'Runtime observation helpers may run nvidia-smi separately; media child accounting describes FFmpeg/ffprobe.',
      'Distinct owned destinations: same-folder native storage eligibility is not established by this endpoint.'] };
  let lease, leaseIdentity, service, runtime, cancellationTimer, cancelEncodeRequested = false, abortRequested = false;
  const started = Date.now();
  const save = () => fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const cancel = () => { abortRequested = true; void service?.cancelCurrent(); };
  const timer = setTimeout(cancel, report.limits.totalMs); timer.unref();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  async function resources() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const observation = { DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize, observedAt: new Date().toISOString() };
    assert.ok(observation.DFreeBytes >= 25 * 1024 ** 3 && observation.FFreeBytes >= 1024 ** 3 + 512 * 1024 ** 2); return observation;
  }
  async function tracked(executable, argv, options = {}, execute = runTool) {
    assert.ok(!abortRequested && Date.now() - started < report.limits.totalMs);
    const storageHelper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (executable === storageHelper) {
      assert.deepEqual(argv.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']); assert.equal(argv.length, 5);
      assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
      assert.ok(argv[4].includes('[System.IO.DriveInfo]::new'), 'The normal fixed storage query must run, never a fabricated trust result');
    } else assert.ok(Object.values({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe }).includes(executable));
    assert.equal(children.size, 0, 'Media children remain sequential'); assert.ok(report.invocations.length < report.limits.maxInvocations);
    assert.ok(!argv.includes('-y'));
    for (let i = 0; i < argv.length; i++) if (argv[i] === '-i') {
      const source = argv[i + 1];
      assert.ok(source.startsWith(owned + path.sep) || source.startsWith('color=') || source.startsWith('testsrc2='), 'Only owned fixtures/capability lavfi');
    }
    const invocation = { executable, argv: [...argv], startedAt: new Date().toISOString(), status: 'running' };
    report.invocations.push(invocation); await save(); let child;
    try {
      const result = await execute(executable, argv, { ...options, onChild(value) {
        child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size);
        value.once('close', (code, signal) => { invocation.closed = { code, signal }; children.delete(value); });
        options.onChild?.(value);
        if (cancelEncodeRequested && argv.includes('-stats_enc_pre:0')) {
          cancelEncodeRequested = false; cancellationTimer = setTimeout(() => void service.cancelCurrent(), 150);
        }
      } });
      Object.assign(invocation, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture, stdoutCapture: result.stdoutCapture });
      return result;
    } catch (error) {
      Object.assign(invocation, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture }); throw error;
    } finally {
      if (child) assert.ok(invocation.closed, 'Actual observed close is required');
      invocation.finishedAt = new Date().toISOString(); await save();
    }
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(input); await fs.mkdir(stateDir);
    await save(); report.resourcesBefore = await resources();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: report.purpose }));
    await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    const sourceFiles = ['main.js', 'src/encoder-service.cjs', 'src/encode-operation.cjs', 'src/operation-evidence.cjs', 'src/container-clock.cjs', 'src/operation-telemetry.cjs', 'src/process-runner.cjs', 'src/operation-runtime.cjs', 'src/operation-storage.cjs', 'src/operation-family.cjs', 'src/operation-controls.cjs', 'src/operation-catalog.cjs', 'scripts/v07-family-service-smoke.cjs'];
    report.sourcesBefore = await Promise.all(sourceFiles.map(async file => ({ file, sha256: sha(await fs.readFile(path.join(ROOT, file))) })));
    runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified;
    const fixture = JSON.parse(await fs.readFile(FIXTURES, 'utf8'));
    const specimen = fixture.cases.find(value => value.id === 'E');
    const sourceBytes = await fs.readFile(specimen.output); assert.equal(sha(sourceBytes), specimen.file.sha256);
    const source = path.join(input, 'fresh-source.mp4'); await fs.writeFile(source, sourceBytes, { flag: 'wx' });
    report.source = { file: source, bytes: sourceBytes.length, sha256: sha(sourceBytes), origin: specimen.output };
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID });
    const observer = controls.operationRuntime, invoke = observer.invoke.bind(observer);
    observer.invoke = (token, tool, argv, options) => tracked(runtime[tool], argv, options,
      (_file, args, opts) => invoke(token, tool, args, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1,
      runtimeIdentity: FAMILIES[0].runtimeIdentity, run: tracked, ...controls });
    await service.initializeDiagnostics();
    for (const profileId of ['h265-cpu', 'h265-nvidia']) {
      if (profileId === 'h265-nvidia') {
        const result = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/nvidia-smi.exe'),
          ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 10000 });
        report.gpuBefore = result.stdout.trim(); const fields = result.stdout.trim().split(',').map(value => value.trim());
        assert.equal(fields.length, 4); assert.equal(Number(fields[2]), 0); assert.equal(Number(fields[3]), 0);
      }
      const output = path.join(owned, profileId + '-output'); await fs.mkdir(output);
      const selection = await service.registerFolder(input, 'input'), destination = await service.registerFolder(output, 'output');
      const settings = { profileId, preset: profileId === 'h265-cpu' ? 'slow' : 'p5', quality: 25 };
      const endpoint = { profileId, status: 'preparing', events: [] }; report.cases.push(endpoint); await save();
      service.on('update', snapshot => {
        if (endpoint.status === 'passed-fresh-main-factory-service') return;
        if (snapshot.progress?.stage && endpoint.events.at(-1) !== snapshot.progress.stage) endpoint.events.push(snapshot.progress.stage);
      });
      await service.prepareBatch({ inputFolderId: selection.id, outputFolderId: destination.id, settings }); await service.taskPromise;
      let prepared = service.snapshot(); assert.equal(prepared.phase, 'ready', prepared.error);
      const selected = prepared.items.find(item => item.name === path.basename(source)); assert.equal(selected.status, 'ready', selected.reason);
      // This endpoint uses distinct owned destinations; it does not claim a
      // fresh same-folder/generated-output native eligibility result.
      await service.updateFileOperations({ planId: prepared.planId, draftId: prepared.operationDraft.id, revision: prepared.operationDraft.revision,
        fileIds: [selected.id], overrides: { range: { startUs: 1013000, endUs: 2787000 }, resolution: '720', audioPolicy: 'precision-aac' } });
      await service.taskPromise; prepared = service.snapshot(); endpoint.prepared = prepared;
      assert.equal(prepared.items.find(item => item.id === selected.id).status, 'ready', prepared.items.find(item => item.id === selected.id).reason);
      endpoint.detailsBefore = service.getEncodingDetails({ planId: prepared.planId, fileId: selected.id });
      service.startBatch({ planId: prepared.planId, fileIds: [selected.id] }); await service.taskPromise;
      endpoint.result = service.snapshot(); const item = endpoint.result.items.find(item => item.id === selected.id);
      assert.equal(item.status, 'success', item.reason); const entry = service.plan.entries.get(selected.id);
      endpoint.detailsAfter = service.getEncodingDetails({ planId: prepared.planId, fileId: selected.id });
      endpoint.evidence = entry.operationEvidence; endpoint.telemetryValidation = entry.telemetryValidation;
      assert.equal(endpoint.telemetryValidation.valid, true); assert.equal(endpoint.evidence.status, 'completed');
      assert.equal(item.evidenceStorage.final.violations.length, 0); assert.ok(endpoint.evidence.decodedEvidence.containerClock);
      endpoint.output = { file: entry.destination, sha256: sha(await fs.readFile(entry.destination)) };
      assert.equal(sha(await fs.readFile(source)), report.source.sha256);
      endpoint.status = 'passed-fresh-main-factory-service';
      report.resourcesLatest = await resources(); await save();
    }
    const cancelOutput = path.join(owned, 'cancel-output'); await fs.mkdir(cancelOutput);
    const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(cancelOutput, 'output');
    const settings = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 };
    await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings }); await service.taskPromise;
    let prepared = service.snapshot(), selected = prepared.items.find(item => item.name === path.basename(source));
    assert.equal(selected.status, 'ready', selected.reason);
    await service.updateFileOperations({ planId: prepared.planId, draftId: prepared.operationDraft.id, revision: prepared.operationDraft.revision,
      fileIds: [selected.id], overrides: { range: { startUs: 1013000, endUs: 31000000 }, resolution: '720', audioPolicy: 'precision-aac' } });
    await service.taskPromise; prepared = service.snapshot(); assert.equal(prepared.items.find(item => item.id === selected.id).status, 'ready');
    cancelEncodeRequested = true; service.startBatch({ planId: prepared.planId, fileIds: [selected.id] }); await service.taskPromise;
    report.cancel = service.snapshot(); assert.equal(report.cancel.phase, 'cancelled');
    assert.equal(report.cancel.items.find(item => item.id === selected.id).status, 'cancelled'); assert.equal(children.size, 0);
    const cancelledEntry = service.plan.entries.get(selected.id);
    await assert.rejects(fs.stat(cancelledEntry.destination), { code: 'ENOENT' });
    assert.notEqual(report.cancel.items.find(item => item.id === selected.id).outputDisposition?.published, true);
    report.cancelRetainedEntries = await fs.readdir(cancelOutput); // sealed stages may legitimately remain
    await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings }); await service.taskPromise;
    const restart = service.snapshot(); assert.equal(restart.phase, 'ready');
    assert.equal(restart.items.find(item => item.name === path.basename(source)).status, 'ready'); report.reprepareAfterCancel = { phase: restart.phase, ready: true, encodeStarted: false };
    assert.equal(sha(await fs.readFile(source)), report.source.sha256);
    for (const endpoint of report.cases) assert.equal(sha(await fs.readFile(endpoint.output.file)), endpoint.output.sha256);
    report.status = 'passed-bounded-fresh-service';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1;
  } finally {
    clearTimeout(timer); clearTimeout(cancellationTimer); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    report.closureFailures = [];
    async function attempt(label, action) { try { await action(); } catch (error) { report.closureFailures.push({ label, message: error.message, code: error.code }); report.status = 'failed-retained'; process.exitCode = 1; } }
    if (service) {
      await attempt('cancel', () => service.cancelCurrent());
      await attempt('operation-resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => {
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure?.persisted, true, 'The terminal diagnostic record must be durably written');
      });
    }
    report.liveChildren = children.size;
    await attempt('actual-child-closure', async () => assert.equal(children.size, 0));
    if (lease && children.size === 0) await attempt('media-lease', async () => {
      const named = await fs.lstat(leasePath, { bigint: true }); assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino);
      assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).token, id); await lease.close(); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    if (report.sourcesBefore) await attempt('source-freeze', async () => {
      report.sourcesAfter = await Promise.all(report.sourcesBefore.map(async item => ({ file: item.file, sha256: sha(await fs.readFile(path.join(ROOT, item.file))) })));
      assert.deepEqual(report.sourcesAfter, report.sourcesBefore);
    });
    report.finishedAt = new Date().toISOString(); await save();
    process.stdout.write(JSON.stringify({ id, status: report.status, report: path.join(directory, 'report.json'), failure: report.failure }) + '\n');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
