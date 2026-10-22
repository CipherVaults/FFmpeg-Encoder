'use strict';

// Bounded development endpoint, not benchmark, native-UI or arbitrary-media
// qualification. Only the pinned owned fixture and CPU x265 AAC/FLAC cells run.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { runTool } = require('../src/process-runner.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { OperationQualificationSelector } = require('../src/operation-qualification.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { PROFILES } = require('../src/media.cjs');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = process.argv[2] || 'h265-cpu';
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const HISTORICAL = path.join(ROOT, 'artifacts/v0.7/operation-profiles/9c10a4a8-5c79-4841-abd1-647dc69c2d84/report.json');
const REPORT_SHA = 'd72ed2a80b928e1903a55411dd3d67ab0cf36e2775512ba835c334c59befd169';
const FIXTURE_SHA = 'db3532f3977964d37cc4edcff21db0f1040b23465e514daf2d6542dcb08c4dc8';
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const TOOL_SHA = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0',
  ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
const NVIDIA_REPORTS = [
  ['227618b5-9ee9-4c86-ba6e-df46129b80d8', '9526bf1126c59c9711fd29aa5331119dcaf605b7c493527a09b465c935175c13'],
  ['71a4192d-4c00-48cd-8c3b-4c9783a43ada', '1941da7d2394a06fff918e30e235063fe8c12aa3df68037dea9ffe0db545ac7f'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const id = randomUUID();
const directory = path.join(ROOT, 'artifacts/v0.7/slice2/service-endpoint', id);
const ownedRun = path.join(OWNED, 'outputs', 'qualified-service-' + id);
const leaseFile = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const children = new Set();
const report = { schema: 1, id, profile: PROFILE, purpose: 'Exact owned fixture through production EncoderService, injected trusted catalog and cached inspection facts; no benchmark or native UI acceptance',
  status: 'running', startedAt: new Date().toISOString(), runtimeIdentity: RUNTIME, directory, ownedRun, invocations: [], cases: [],
  maximumConcurrentChildren: 0, limitations: ['Only this exact newly attested fixture identity and retained request/settings.',
    'Main application has no general-purpose transformed-operation catalog yet.', 'Only the selected backend on this observed runtime/device; no AMD, Intel, HDR, resize, alternate layout or native UI acceptance.',
    'No benchmark timing/quality/default claims; all children sequential.'] };
let lease, leaseIdentity, source, input;
async function gpu() {
  const executable = path.join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe');
  const { stdout } = await promisify(execFile)(executable,
    ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder,utilization.gpu,memory.used,temperature.gpu', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
  const lines = stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1, 'Exact single adapter expected');
  const [adapterIdentity, driverVersion, encoder, decoder, utilization, memoryMiB, temperatureC] = lines[0].split(',').map(value => value.trim());
  assert.match(adapterIdentity, /^GPU-[a-f0-9-]+$/i); assert.match(driverVersion, /^\d+\.\d+$/);
  return { environment: { adapterIdentity, driverVersion, runtimeVersion: 'FFmpeg9.0.2:' + RUNTIME },
    encoder: Number(encoder), decoder: Number(decoder), utilization: Number(utilization), memoryMiB: Number(memoryMiB), temperatureC: Number(temperatureC) };
}
async function save() { await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); }
async function pinned(file, expected, max = 256 * 1024 * 1024) {
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(max));
  assert.equal(await fs.realpath(file), path.resolve(file));
  const bytes = await fs.readFile(file);
  const after = await fs.lstat(file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(after[key], before[key]);
  assert.equal(sha(bytes), expected);
  return bytes;
}
async function run(executable, args, options = {}) {
  assert.ok(Object.values(report.tools).includes(executable), 'Exact candidate tools only');
  assert.ok(!args.includes('-y') && !args.some(arg => typeof arg !== 'string'));
  assert.equal(children.size, 0, 'Real media children stay sequential');
  const inputs = args.flatMap((arg, i) => arg === '-i' ? [args[i + 1]] : []);
  for (const file of inputs) assert.ok(file === input || file.startsWith(ownedRun + path.sep), 'Only this owned run is readable by media children');
  const entry = { executable, argv: args, status: 'running', startedAt: new Date().toISOString() };
  report.invocations.push(entry); await save();
  let child;
  try {
    const result = await runTool(executable, args, { ...options,
      onChild(value) { child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size); } });
    Object.assign(entry, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr,
      stderrCapture: result.stderrCapture, stdoutCapture: result.stdoutCapture });
    return result;
  } catch (error) {
    Object.assign(entry, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture });
    throw error;
  } finally {
    if (child) { assert.notEqual(child.exitCode === null && child.signalCode === null, true, 'Runner must settle only after close'); children.delete(child); }
    entry.finishedAt = new Date().toISOString(); await save();
  }
}
async function main() {
  assert.ok(process.argv.length <= 3 && ['h265-cpu', 'h265-nvidia'].includes(PROFILE), 'Only the two explicit HEVC endpoint profiles are supported');
  await fs.mkdir(directory, { recursive: true }); await save();
  const d = await fs.statfs(ROOT), f = await fs.statfs(OWNED);
  report.freeSpace = { D: d.bavail * d.bsize, F: f.bavail * f.bsize, forecastAdditionalBytes: 128 * 1024 * 1024 };
  assert.ok(report.freeSpace.D >= 25 * 1024 ** 3 && report.freeSpace.F > 512 * 1024 ** 2);
  lease = await fs.open(leaseFile, 'wx+');
  await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: 'Slice2 CPU service endpoint', startedAt: report.startedAt }));
  await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
  const historical = JSON.parse(await pinned(HISTORICAL, REPORT_SHA, 16 * 1024 * 1024));
  assert.equal(historical.status, 'failed'); assert.equal(historical.runtimeIdentity, RUNTIME);
  source = historical.source;
  const master = await pinned(source, FIXTURE_SHA, 16 * 1024 * 1024);
  const originalReport = path.join(ROOT, 'artifacts/v0.7/encode-operation/01349687-ff85-4606-b3be-b2baec87d06b/report.json');
  const original = JSON.parse(await fs.readFile(originalReport, 'utf8'));
  assert.equal(original.artifacts[source].sha256, FIXTURE_SHA);
  const inspection = original.sourceEvidence.timeline.inspection;
  const sourceProbeFingerprint = fingerprintEncodeSource(inspection.probe);
  await fs.mkdir(path.join(ownedRun, 'input'), { recursive: true });
  input = path.join(ownedRun, 'input', 'known-vfr-source.mov'); await fs.writeFile(input, master, { flag: 'wx' });
  const sourceIdentity = await readSourceIdentity(input);
  report.fixture = { original: source, copy: input, sha256: FIXTURE_SHA, sourceIdentity, sourceProbeFingerprint };
  let retainedCases = historical.cases, environment = null;
  if (PROFILE === 'h265-nvidia') {
    retainedCases = [];
    for (const [runId, hash] of NVIDIA_REPORTS) {
      const record = JSON.parse(await pinned(path.join(ROOT, 'artifacts/v0.7/operation-profiles', runId, 'report.json'), hash, 16 * 1024 * 1024));
      assert.equal(record.status, 'passed-bounded-profile-cells'); assert.equal(record.sourceBefore.sha256, FIXTURE_SHA);
      assert.equal(record.sourceAfter.sha256, FIXTURE_SHA); retainedCases.push(...record.cases);
    }
    report.gpuBefore = await gpu(); environment = report.gpuBefore.environment;
    assert.equal(report.gpuBefore.encoder, 0, 'Competing encoder workload; do not control OBS or launch GPU work');
    assert.equal(report.gpuBefore.decoder, 0, 'Competing decoder workload');
    report.limitations.push('Historical NVIDIA reports lacked device/driver identity; this is the new exact current-device service observation, not portable or persistent general qualification.');
  }
  report.tools = Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin', name + '.exe')]));
  report.runtime = {};
  for (const [name, file] of Object.entries(report.tools)) {
    await pinned(file, TOOL_SHA[name]);
    const version = await run(file, ['-version']);
    report.runtime[name] = { path: file, sha256: TOOL_SHA[name], version: version.stdout.split(/\r?\n/)[0] };
    assert.equal(report.runtime[name].version, historical.runtime[name].version.split(/\r?\n/)[0]);
  }
  report.modules = {};
  for (const name of ['encode-operation', 'operation-qualification', 'operation-evidence', 'encoder-service', 'outputs', 'process-runner']) {
    report.modules[name] = sha(await fs.readFile(path.join(ROOT, 'src', name + '.cjs')));
  }
  const policyIdentity = sha(Buffer.from(JSON.stringify({ version: 1, modules: report.modules, report: REPORT_SHA, fixture: FIXTURE_SHA })));
  for (const mode of ['precision-aac', 'precision-flac']) {
    const retained = retainedCases.find(item => item.id === PROFILE + ':' + mode);
    assert.equal(retained.status, 'passed'); assert.equal(retained.validation.valid, true); assert.equal(retained.collection.status, 'completed');
    const budget = retained.collection.budget;
    const evidenceIds = [...new Set([retained.qualification.evidenceId, retained.collection.timingQualification.evidenceId])];
    const keys = ['range', 'resolution', 'target', 'hdrPolicy', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'];
    const cell = { evidenceIds, runtimeIdentity: RUNTIME, sourceIdentity, sourceProbeFingerprint, settings: retained.settings,
      request: Object.fromEntries(keys.map(key => [key, retained.plan.contract.request[key]])), qualification: retained.qualification,
      timingQualification: retained.collection.timingQualification, budget, environment };
    const selector = new OperationQualificationSelector({ policyIdentity, cells: [cell] });
    const output = path.join(ownedRun, mode); await fs.mkdir(output);
    const endpoint = { mode, output, status: 'running', events: [] }; report.cases.push(endpoint); await save();
    const service = new EncoderService({ ...report.tools, stateDir: path.join(ownedRun, 'state-' + mode), runtimeIdentity: RUNTIME, run,
      inspectionWorkers: 1, inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false, reason: 'Development endpoint uses attested fixture facts only.' }) },
      operationQualifications: selector, operationEvidenceBudget: budget,
      operationEnvironment: environment ? () => environment : null,
      capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: profile.id === PROFILE, supportedBitDepths: profile.id === PROFILE ? [8] : [] })), versions: { ffmpeg: report.runtime.ffmpeg.version } }),
      inspect: async (file, options) => {
        const probe = await inspectMetadata(file, options);
        assert.equal(fingerprintEncodeSource(probe), sourceProbeFingerprint, 'Fresh metadata must match cached inspected fixture facts exactly');
        return { ...structuredClone(inspection), probe };
      },
    });
    try {
      const a = await service.registerFolder(path.dirname(input), 'input'), b = await service.registerFolder(output, 'output');
      service.on('update', state => {
        const progress = state.progress;
        if (progress && endpoint.events.at(-1)?.stage !== progress.stage) endpoint.events.push({ stage: progress.stage, duration: progress.duration, percent: progress.percent });
      });
      let prepared = await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: retained.settings }); await service.taskPromise; prepared = service.snapshot();
      assert.equal(prepared.items.length, 1); assert.equal(prepared.items[0].status, 'ready');
      const draft = prepared.operationDraft;
      await service.updateFileOperations({ planId: prepared.planId, draftId: draft.id, revision: draft.revision, fileIds: [prepared.items[0].id],
        overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: mode } });
      await service.taskPromise; prepared = service.snapshot(); endpoint.prepared = prepared;
      assert.equal(prepared.items[0].status, 'ready', prepared.items[0].reason);
      const fileId = prepared.items[0].id;
      endpoint.detailsBefore = service.getEncodingDetails({ planId: prepared.planId, fileId });
      service.startBatch({ planId: prepared.planId, fileIds: [fileId] }); await service.taskPromise;
      endpoint.result = service.snapshot(); endpoint.detailsAfter = service.getEncodingDetails({ planId: prepared.planId, fileId });
      assert.equal(endpoint.result.items[0].status, 'success', endpoint.result.items[0].reason);
      assert.deepEqual(endpoint.detailsBefore.args.slice(0, -1), endpoint.detailsAfter.args.slice(0, -1));
      assert.equal(endpoint.detailsAfter.kind, 'actual-invocation'); assert.equal(endpoint.detailsAfter.operation.compatibilityPath, false);
      assert.ok(endpoint.events.some(event => event.stage === 'evidence-collection' && event.duration === 2.074 && event.percent === null));
      const entry = service.plan.entries.get(fileId); endpoint.evidence = entry.operationEvidence; assert.equal(endpoint.evidence.status, 'completed');
      endpoint.output = { path: entry.destination, sha256: sha(await fs.readFile(entry.destination)) };
      assert.equal(sha(await fs.readFile(input)), FIXTURE_SHA); endpoint.status = 'passed';
    } finally { await service.cancelCurrent(); await service.closeDiagnostics(); await save(); }
  }
  await pinned(source, FIXTURE_SHA, 16 * 1024 * 1024);
  await pinned(HISTORICAL, REPORT_SHA, 16 * 1024 * 1024);
  if (environment) { report.gpuAfter = await gpu(); assert.deepEqual(report.gpuAfter.environment, environment); }
  report.status = PROFILE === 'h265-cpu' ? 'passed-exact-cpu-service-cells' : 'passed-exact-nvidia-service-cells';
}
main().catch(error => { report.status = 'failed'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; })
  .finally(async () => {
    report.finishedAt = new Date().toISOString(); report.liveChildren = children.size;
    if (lease) {
      assert.equal(children.size, 0, 'Do not release media ownership before close');
      const named = await fs.lstat(leaseFile, { bigint: true }); const opened = await lease.stat({ bigint: true });
      assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino); assert.equal(opened.ino, named.ino);
      assert.equal(JSON.parse(await fs.readFile(leaseFile, 'utf8')).token, id);
      await lease.close(); await fs.unlink(leaseFile); report.leaseReleased = true;
    }
    await save(); process.stdout.write(JSON.stringify({ id, status: report.status, cases: report.cases.map(item => ({ mode: item.mode, status: item.status })), failure: report.failure, report: path.join(directory, 'report.json') }) + '\n');
  });
