'use strict';

// Q2d parameterised copy of v07-remux-service-smoke.cjs; the original is retained.
// Root must admit a fresh prospectus before running this, once per mode. Unit
// imports expose only pure configuration; no child or file operation runs there.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { LIMITS: STORAGE_LIMITS } = require('../src/operation-storage.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const OLD_AAC = path.join(OWNED, 'outputs/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/aac-calibration-delayed.mkv');
// Retained synthetic masters, pinned by encode-operation/01349687/report.json.
// 10fps has exact 100ms steps in Matroska; the 30fps envelope fixture would
// alternate 33/34ms and cannot establish the constant-cadence validator branch.
const CFR_MASTER = path.join(OWNED, 'fixtures/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/landscape.mp4');
const MASTER_HASHES = Object.freeze({ cfr: '488a30e753a3129a2a64ef9314a69be91e4db1bc508a6bd14b26ad5fc01f10e4',
  vfr: '5ef90a319c77abe5eca10df81b7afcc27571b323b05316d180ae653641abd2b4' });
const BFRAME_REPORT = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const BFRAME_REPORT_SHA = '17f7e802480f092093f5dcaebc61f78c0710a5fc36b444f016933871c4e647a9';
const BFRAME_MASTER = path.join(OWNED, 'fixtures/sdr-envelope-6b317682-605b-4d40-8ff3-b3f84678f0ae/B-1280x720-30fps.mov');
const BFRAME_MASTER_SHA = 'd6030cb3613006b72da5ea02a80fefd82ad14f57c76268b823a691f83e162273';
const ENTRY_MODULES = ['main.js', 'preload.js', 'scripts/v07-remux-mkv-mp4-smoke.cjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const CASES = Object.freeze(['timeline-video-mp4', 'cfr-video-mp4', 'bframe-video-mp4']);
// Five copies: three MP4 cases and two production-route MKV seeds. The detailed
// prospective allocation is in this job's progress.md; root admits it afresh.
const LIMITS = Object.freeze({ totalMs: 60 * 60000, forecastBytes: 2 * 1024 ** 3, maxInvocations: 128, maxStarts: 5 });
const MARGIN_BYTES = 512 * 1024 ** 2;
const VENDOR_WARNING = Object.freeze({ code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', key: 'VENDOR_ID',
  message: "Stream 0 → 0: descriptive metadata 'VENDOR_ID' is missing or changed in its requested representation." });
const AVERAGE_WARNING = Object.freeze({ code: 'OPERATION_VALIDATION_WARNING', key: null,
  message: 'Stream 0 → 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.' });
// These are prospective expectations, not measured results. A different result
// stays failed for review; never accept an additional warning after a run.
const OUTCOMES = Object.freeze({
  'timeline-video-mp4': Object.freeze({ outcome: 'saved-with-warning', warnings: Object.freeze([VENDOR_WARNING, AVERAGE_WARNING]) }),
  'cfr-video-mp4': Object.freeze({ outcome: 'saved', warnings: Object.freeze([]) }),
  'bframe-video-mp4': Object.freeze({ outcome: 'saved-with-warning', warnings: Object.freeze([VENDOR_WARNING]) }),
  'cfr-seed-mkv': Object.freeze({ outcome: 'saved', warnings: Object.freeze([]) }),
  'bframe-seed-mkv': Object.freeze({ outcome: 'saved', warnings: Object.freeze([]) }),
});
function configuration(cli) {
  assert.ok(Array.isArray(cli) && cli.length === 4 && cli[0] === '--run-owned-remux'
    && ['--qualify', '--normal'].includes(cli[1]) && cli[2] === '--cases' && typeof cli[3] === 'string', 'Exact Q2d arguments required.');
  const choices = cli[3].split(',');
  assert.ok(choices.length > 0 && new Set(choices).size === choices.length && choices.every(value => CASES.includes(value)), 'Only explicit Q2d cases are admitted.');
  return Object.freeze({ mode: cli[1], choices: Object.freeze(choices) });
}
function routeOptions(mode) {
  assert.ok(['--qualify', '--normal'].includes(mode), 'An explicit laboratory or production mode is required.');
  // Production is always the real catalog, never a fallback laboratory policy.
  if (mode === '--normal') {
    requireProductionRoute(REMUX_POLICIES);
    return { remuxPolicies: REMUX_POLICIES, remuxPolicyIdentity: REMUX_POLICY_ID };
  }
  return { remuxPolicies: [...REMUX_POLICIES.filter(value => value.inputFamily !== 'matroska' || value.target !== 'mp4'), {
    id: 'q2d-laboratory-matroska-mp4', inputFamily: 'matroska', target: 'mp4', allowAncillary: false, allowRotation90: false,
    audio: 'explicitly-omitted-only', evidenceIds: ['q2d-fresh-prospective-qualification'],
    runtimeIdentity: '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6',
  }],
  remuxPolicyIdentity: 'q2d-fresh-prospective-laboratory-v1' };
}
function requireProductionRoute(policies) {
  const route = policies.find(value => value.inputFamily === 'matroska' && value.target === 'mp4');
  assert.ok(route?.id === 'full-remux-matroska-mp4-v1' && route.audio === 'explicitly-omitted-only',
    'Normal Q2d proof requires full-remux-matroska-mp4-v1 with explicitly-omitted-only audio in the real production catalog.');
  return route;
}
function requireOmissionRefusal(item) {
  assert.equal(item.status, 'unsupported');
  assert.equal(item.reasonCode ?? item.remux?.blockers?.[0]?.code, 'REMUX_AUDIO_OMISSION_REQUIRED', 'The explicit audio policy must refuse before omission.');
}
function requireOutcome(label, result, essence) {
  assert.ok(Object.hasOwn(OUTCOMES, label), 'Only named Q2d result expectations are available.');
  const expected = OUTCOMES[label];
  assert.equal(result.outcome, expected.outcome, `${label}: unexpected publication outcome`);
  const warningSet = warnings => warnings.map(value => JSON.stringify({ code: value.code, key: value.key ?? null, message: value.message })).sort();
  const actual = warningSet(result.warnings ?? []);
  if (label === 'bframe-video-mp4') {
    // Both sets are declared before measurement. The additional exact summary
    // warning needs the collector's variable cadence on BOTH sides; it never
    // waives any validator check or permits another warning.
    const variants = [expected.warnings, [...expected.warnings, AVERAGE_WARNING]];
    const index = variants.findIndex(warnings => JSON.stringify(warningSet(warnings)) === JSON.stringify(actual));
    assert.ok(index >= 0, `${label}: unexpected warning codes, keys or messages`);
    if (index === 1) requireCadence(essence, 'variable');
    return index === 0 ? 'vendor-only' : 'vendor-and-variable-average';
  }
  assert.deepEqual(actual, warningSet(expected.warnings), `${label}: unexpected warning codes, keys or messages`);
  return null;
}
function requireCfrRates(probe) {
  const video = probe.streams.find(value => value.codec_type === 'video');
  assert.ok(typeof video?.avg_frame_rate === 'string' && video.avg_frame_rate.length > 0
    && video.avg_frame_rate === video.r_frame_rate, 'CFR Matroska source must enter the strict equal-average/nominal-rate branch.');
}
function bframeFixture(bytes, digest = sha) {
  assert.equal(digest(bytes), BFRAME_REPORT_SHA, 'Retained B-frame fixture receipt changed.');
  return requireBframeSource(JSON.parse(bytes.toString('utf8')));
}
function requireBframeSource(receipt) {
  const specimen = receipt.cases.find(value => value.id === 'B');
  assert.equal(specimen?.output, BFRAME_MASTER); assert.equal(specimen.file.sha256, BFRAME_MASTER_SHA);
  const capture = receipt.invocations.find(value => value.kind === 'metadata' && value.argv.at(-1) === BFRAME_MASTER);
  assert.equal(capture?.exitCode, 0);
  const video = JSON.parse(capture.stdout).streams.find(value => value.codec_type === 'video');
  requireBframeObservation(video);
  return { file: BFRAME_MASTER, sha256: BFRAME_MASTER_SHA,
    proof: { kind: 'retained-raw-metadata', receiptSha256: BFRAME_REPORT_SHA, field: 'has_b_frames', value: video.has_b_frames } };
}
function requireBframeObservation(video) {
  assert.ok(Number.isSafeInteger(video?.has_b_frames) && video.has_b_frames > 0, 'Pinned B source must have an actual retained B-frame observation.');
}
function requireSpace(value) {
  assert.ok(Number.isSafeInteger(value.DFreeBytes) && value.DFreeBytes >= 25 * 1024 ** 3, 'D: needs 25GiB free.');
  assert.ok(Number.isSafeInteger(value.FFreeBytes) && value.FFreeBytes >= STORAGE_LIMITS.minFreeBytes + LIMITS.forecastBytes + MARGIN_BYTES,
    'F: needs the 25GiB evidence storage floor plus forecast bytes and 512MiB margin.');
}
function countFileCopy(file, args, ffmpeg, owned, count) {
  if (file !== ffmpeg || ['-', 'pipe:1'].includes(args.at(-1))) return count;
  assert.equal(args[args.indexOf('-c') + 1], 'copy', 'Every file-writing job must be stream copy.');
  assert.ok(args.at(-1).startsWith(owned + path.sep), 'File-writing job must stay inside this run.');
  requireStartBudget(count); return count + 1;
}
function requireGrowth(before, after) {
  assert.ok(Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= 0 && after >= before
    && after - before <= LIMITS.forecastBytes, 'Owned folder growth exceeds the prospective byte forecast.');
  return after - before;
}
async function ownedBytes(directory, io = fs) {
  let bytes = 0, entries = 0;
  async function walk(file, depth) {
    assert.ok(depth <= 16 && ++entries <= 8192, 'Owned growth walk exceeds its structural bound.');
    const stat = await io.lstat(file);
    assert.ok(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), 'Owned growth walk refuses links and special files.');
    if (stat.isFile()) { assert.ok(Number.isSafeInteger(stat.size) && stat.size >= 0 && Number.isSafeInteger(bytes + stat.size)); bytes += stat.size; }
    else for (const name of await io.readdir(file)) {
      assert.ok(typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name), 'Owned growth walk needs single-component names.');
      await walk(path.join(file, name), depth + 1);
    }
  }
  await walk(directory, 0); return bytes;
}
function requireCadence(essence, cadence) {
  assert.ok(['constant', 'variable'].includes(cadence));
  const streams = essence.streams;
  assert.equal(streams.length, 1); assert.equal(streams[0].codecType, 'video');
  for (const side of ['source', 'output']) assert.equal(streams[0][side].cadence.classification, cadence);
}
function requireStartBudget(acceptedStarts) {
  assert.ok(Number.isSafeInteger(acceptedStarts) && acceptedStarts >= 0 && acceptedStarts < LIMITS.maxStarts, 'Prospective Start ceiling');
}
// Imported-module test seam only. The CLI always constructs the default
// factory below; no argument, file or child output can supply dependencies.
function createSmoke({ fs: io = fs, runTool: executeTool = runTool, verifyCandidateRuntime: verifyRuntime = verifyCandidateRuntime,
  createOperationControls: controlsFactory = createOperationControls, EncoderService: Service = EncoderService,
  randomUUID: makeId = randomUUID, sha: digest = sha } = {}) {
  return cli => runSmoke(cli, { io, executeTool, verifyRuntime, controlsFactory, Service, makeId, digest });
}
async function runSmoke(cli, { io, executeTool, verifyRuntime, controlsFactory, Service, makeId, digest }) {
  const fs = io, sha = digest;
  const { mode, choices } = configuration(cli);
  const policyOptions = routeOptions(mode);
  const id = makeId(), directory = path.join(ROOT, 'artifacts/v0.7/q2d-mkv-mp4', id);
  const owned = path.join(OWNED, 'outputs', 'q2d-mkv-mp4-' + id), stateDir = path.join(owned, 'state');
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock'), children = new Set();
  let runtime, service, lease, leaseIdentity;
  const controller = new AbortController();
  const report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), directory, owned,
    mode, selectedCases: choices, cases: [], invocations: [], acceptedStarts: 0, fileWritingCopies: 0, maxConcurrentChildren: 0,
    limits: LIMITS,
    limitations: ['Real service, not native BrowserWindow/picker/portable acceptance.',
      mode === '--qualify' ? 'Prospective main-trusted laboratory policies; not default catalog enablement.' : 'Normal fixed production policy/catalog.',
      'Root separately budgets initial/final process censuses (two children); this harness does not run or claim them.',
      'Full-only copy; no benchmark, quality/default search or personal media.', 'Distinct destinations; no new same-folder eligibility claim.'] };
  const save = () => { const text = JSON.stringify(report, null, 2); assert.ok(Buffer.byteLength(text) <= 32 * 1024 * 1024, 'Bounded report'); return fs.writeFile(path.join(directory, 'report.json'), text); };
  const timer = setTimeout(() => { controller.abort(); void service?.cancelCurrent(); }, report.limits.totalMs); timer.unref();
  const sources = [];
  async function freezeModules() {
    const entries = await fs.readdir(path.join(ROOT, 'src'), { withFileTypes: true });
    assert.ok(entries.length <= 128 && entries.every(value => value.isFile() && !value.isSymbolicLink() && value.name.endsWith('.cjs')));
    const files = [...ENTRY_MODULES, ...entries.map(value => 'src/' + value.name)].sort();
    return Promise.all(files.map(async file => {
      const source = path.join(ROOT, file), stat = await fs.lstat(source);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 ** 2);
      return { file, sha256: sha(await fs.readFile(source)) };
    }));
  }
  async function space() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const value = { DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize, at: new Date().toISOString() };
    requireSpace(value); return value;
  }
  async function run(file, args, options = {}, execute = executeTool) {
    assert.ok(!controller.signal.aborted); assert.equal(children.size, 0); assert.ok(report.invocations.length < report.limits.maxInvocations);
    const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (path.normalize(file).toLowerCase() === path.normalize(helper).toLowerCase()) {
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(args.length, 5); assert.ok(args[4].includes('[System.IO.DriveInfo]::new')); assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
    } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(file));
    assert.ok(!args.includes('-y'));
    for (let i = 0; i < args.length; i++) if (['-i', '-attach'].includes(args[i])) assert.ok(args[i + 1].startsWith(owned + path.sep));
    assert.deepEqual(await freezeModules(), report.sourcesBefore);
    // Every invocation path, including a wrongly accepted refusal-path Start,
    // reserves a copy slot here before the actual child can be created.
    report.fileWritingCopies = countFileCopy(file, args, runtime.ffmpeg, owned, report.fileWritingCopies);
    const entry = { file, args, status: 'running', startedAt: new Date().toISOString() }; report.invocations.push(entry); await save();
    let child;
    try {
      const value = await execute(file, args, { ...options, signal: options.signal || controller.signal, onChild(value) {
        child = value; children.add(value); report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
        value.once('close', (code, signal) => { entry.closed = { code, signal }; children.delete(value); }); options.onChild?.(value);
      } });
      entry.status = 'completed'; entry.exitCode = value.exitCode; entry.stderr = value.stderr; entry.stderrCapture = value.stderrCapture;
      return value;
    } catch (error) { Object.assign(entry, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture }); throw error; }
    finally { if (child) assert.ok(entry.closed); entry.finishedAt = new Date().toISOString(); await save(); }
  }
  async function copySource(file, name, expectedSha) {
    const before = await fs.lstat(file, { bigint: true }); assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n);
    const bytes = await fs.readFile(file); const after = await fs.lstat(file, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(before[key], after[key]);
    assert.ok(bytes.length <= 512 * 1024 ** 2); if (expectedSha) assert.equal(sha(bytes), expectedSha);
    const folder = path.join(owned, 'input-' + name); await fs.mkdir(folder); const target = path.join(folder, path.basename(file)); await fs.writeFile(target, bytes, { flag: 'wx' });
    sources.push({ file: target, sha256: sha(bytes), origin: file, bytes: bytes.length }); return target;
  }
  async function prepare(file, output, target) {
    const a = await service.registerFolder(path.dirname(file), 'input'), b = await service.registerFolder(output, 'output');
    await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target }); await service.taskPromise;
    let s = service.snapshot(); assert.equal(s.phase, 'ready', s.error); let item = s.items.find(value => value.name === path.basename(file));
    const generatedExcluded = item.status === 'generated';
    if (generatedExcluded) { await service.reencodeOutputs({ planId: s.planId, fileIds: [item.id] }); await service.taskPromise; s = service.snapshot(); item = s.items.find(value => value.id === item.id); }
    return { s, item, generatedExcluded };
  }
  async function omitAllAudio(s, item, omissionCount) {
    requireOmissionRefusal(item);
    const ids = item.remux.omissionCandidates.filter(value => /audio/.test(value.label)).map(value => value.id);
    assert.equal(ids.length, omissionCount);
    await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: ids });
    await service.taskPromise; s = service.snapshot(); item = s.items.find(value => value.id === item.id);
    assert.equal(item.status, 'ready', item.reason); return { s, item, ids };
  }
  async function job(label, file, target, { omissionCount = 0, cadence } = {}) {
    const output = path.join(owned, 'output-' + label); await fs.mkdir(output);
    const record = { label, source: file, target, omissionCount, status: 'preparing' }; report.cases.push(record); await save();
    let { s, item } = await prepare(file, output, target);
    record.initial = s;
    if (omissionCount) {
      const omitted = await omitAllAudio(s, item, omissionCount); ({ s, item } = omitted); record.omissionIds = omitted.ids;
    }
    record.prepared = s; assert.equal(item.status, 'ready', item.reason);
    record.detailsBefore = service.getEncodingDetails({ planId: s.planId, fileId: item.id });
    if (label === 'cfr-video-mp4') requireCfrRates(service.plan.entries.get(item.id).inspection.probe);
    requireStartBudget(report.acceptedStarts);
    service.startBatch({ planId: s.planId, fileIds: [item.id] }); report.acceptedStarts++; await service.taskPromise;
    record.result = service.snapshot(); const result = record.result.items.find(value => value.id === item.id), entry = service.plan.entries.get(item.id);
    record.detailsAfter = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); record.evidence = entry.operationEvidence;
    assert.equal(result.status, 'success', result.reason); assert.equal(record.evidence.status, 'completed'); assert.equal(result.evidenceStorage.final.violations.length, 0);
    record.warningSet = requireOutcome(label, result, record.evidence.essenceEvidence);
    if (cadence) requireCadence(record.evidence.essenceEvidence, cadence);
    record.output = { file: entry.destination, bytes: (await fs.stat(entry.destination)).size, sha256: sha(await fs.readFile(entry.destination)) };
    record.status = 'passed-real-full-remux-service';
    assert.equal(children.size, 0); await save(); return record;
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(stateDir);
    report.ownedBytesBefore = await ownedBytes(owned, fs); report.resourcesBefore = await space(); await save();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: 'Bounded Q2d fresh MKV-to-MP4 root-only proof' })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    runtime = await verifyRuntime({ root: ROOT }); report.runtime = runtime.verified; report.sourcesBefore = await freezeModules();
    const controls = controlsFactory({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...policyOptions });
    const observed = controls.operationRuntime, invoke = observed.invoke.bind(observed);
    observed.invoke = (token, tool, args, options) => run(runtime[tool], args, options, (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new Service({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1,
      runtimeIdentity: FAMILIES[0].runtimeIdentity, run, ...controls }); await service.initializeDiagnostics();
    for (const choice of choices) {
      if (choice === 'timeline-video-mp4') {
        const timeline = await copySource(OLD_AAC, 'timeline', MASTER_HASHES.vfr);
        await job(choice, timeline, 'mp4', { omissionCount: 2, cadence: 'variable' });
      } else if (choice === 'cfr-video-mp4') {
        const master = await copySource(CFR_MASTER, 'cfr-master', MASTER_HASHES.cfr);
        // The seed uses the already-qualified real production ISOBMFF->MKV
        // policy in BOTH modes; no direct muxer argv or encoder is substituted.
        const seed = await job('cfr-seed-mkv', master, 'matroska', { cadence: 'constant' });
        await job(choice, seed.output.file, 'mp4', { cadence: 'constant' });
      } else {
        const specimen = bframeFixture(await fs.readFile(BFRAME_REPORT), sha); report.bframeSourceProof = specimen.proof;
        const master = await copySource(specimen.file, 'bframe-master', specimen.sha256);
        const seed = await job('bframe-seed-mkv', master, 'matroska');
        await job(choice, seed.output.file, 'mp4', { omissionCount: 1 });
      }
    }
    {
      const result = report.cases.find(value => value.target === 'mp4' && value.output);
      const target = path.join(owned, 'ready-cancel-output'); await fs.mkdir(target);
      let scan = await prepare(result.source, target, 'mp4');
      if (result.omissionCount) scan = await omitAllAudio(scan.s, scan.item, result.omissionCount);
      assert.equal(scan.item.status, 'ready', scan.item.reason);
      report.preparedCancel = { prepared: scan.s };
      const beforeCancel = report.invocations.length;
      await service.cancelBatch({ batchId: scan.s.batchId }); assert.equal(service.snapshot().phase, 'cancelled');
      assert.throws(() => { service.startBatch({ planId: scan.s.planId, fileIds: [scan.item.id] }); report.acceptedStarts++; }, { code: 'STALE_PLAN' });
      assert.equal(report.invocations.length, beforeCancel);
      assert.deepEqual(await fs.readdir(target), []);
      Object.assign(report.preparedCancel, { cancelled: service.snapshot(), staleStartRefused: true, noNewChild: true });
      const beforeCopies = report.invocations.filter(value => value.args.includes('-c') && value.args[value.args.indexOf('-c') + 1] === 'copy').length;
      const repeated = await prepare(result.source, path.dirname(result.output.file), result.target);
      assert.equal(repeated.item.status, 'skipped', repeated.item.reason);
      assert.throws(() => { service.startBatch({ planId: repeated.s.planId, fileIds: [repeated.item.id] }); report.acceptedStarts++; }, { code: 'INVALID_SELECTION' });
      assert.equal(report.invocations.filter(value => value.args.includes('-c') && value.args[value.args.indexOf('-c') + 1] === 'copy').length, beforeCopies);
      assert.equal(sha(await fs.readFile(result.output.file)), result.output.sha256);
      report.existingOutputSkip = { snapshot: repeated.s, noNewCopy: true, outputSha256: result.output.sha256 };
    }
    for (const source of sources) {
      assert.equal(sha(await fs.readFile(source.file)), source.sha256);
      if (path.isAbsolute(source.origin)) assert.equal(sha(await fs.readFile(source.origin)), source.sha256);
    }
    for (const item of report.cases.filter(value => value.output)) assert.equal(sha(await fs.readFile(item.output.file)), item.output.sha256);
    report.sources = sources; report.resourcesAfter = await space(); report.status = 'passed-bounded-copy-service';
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; }
  finally {
    clearTimeout(timer); report.closureFailures = [];
    async function attempt(label, action) { try { await action(); } catch (error) { report.closureFailures.push({ label, code: error.code, message: error.message }); report.status = 'failed-retained'; } }
    if (service) { await attempt('cancel', () => service.cancelCurrent()); await attempt('resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => { report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed'); assert.equal(report.diagnosticClosure.persisted, true); }); }
    if (report.ownedBytesBefore !== undefined) await attempt('owned-growth', async () => {
      report.ownedBytesAfter = await ownedBytes(owned, fs); report.ownedGrowthBytes = requireGrowth(report.ownedBytesBefore, report.ownedBytesAfter);
    });
    report.liveChildren = children.size; await attempt('child-closure', async () => assert.equal(children.size, 0));
    if (lease && children.size === 0) await attempt('media-lease', async () => {
      const named = await fs.lstat(leasePath, { bigint: true }); assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino);
      assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).token, id); await lease.close(); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    if (report.sourcesBefore) await attempt('module-freeze', async () => { report.sourcesAfter = await freezeModules(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); });
    report.finishedAt = new Date().toISOString(); await save();
  }
  return report;
}
module.exports = { createSmoke, configuration, routeOptions, requireCadence, requireStartBudget, requireProductionRoute, requireOmissionRefusal,
  requireOutcome, requireCfrRates, bframeFixture, requireBframeSource, requireBframeObservation, requireSpace, countFileCopy, requireGrowth, ownedBytes, CASES, LIMITS };
if (require.main === module) createSmoke()(process.argv.slice(2)).then(report => {
  if (report.status === 'failed-retained') process.exitCode = 1;
  console.log(JSON.stringify({ id: report.id, status: report.status, report: path.join(report.directory, 'report.json'), failure: report.failure }));
}).catch(error => { console.error(error); process.exitCode = 1; });
