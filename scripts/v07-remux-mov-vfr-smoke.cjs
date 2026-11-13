'use strict';

// Q2g parameterised copy of v07-remux-mov-smoke.cjs; the original is retained.
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
const { getCollectedMovRepresentation } = require('../src/remux-evidence.cjs');
const { getMovRepresentation } = require('../src/mov-representation.cjs');
const { parseProbeJson, normalizeProbe } = require('../src/inspection.cjs');
const { FIXTURES: VFR_SPECS, assessMetadata, assessVideoFrames } = require('./v07-mov-vfr-fixtures.cjs');
const { remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const { LIMITS: STORAGE_LIMITS } = require('../src/operation-storage.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
// ROOT MUST FILL both pins after generating and reviewing the fixture report.
// Importing is inert; every run refuses placeholders before any I/O or lease.
const FIXTURE_ID = 'a12935df-d553-4fb2-856a-53b60d83034b';
const FIXTURE_REPORT_SHA = 'a39f5a557c30c6ebd30beacd7dfda35a44ff34b4f45194e464469e40c157f63e';
const FIXTURE_REPORT = path.join(ROOT, 'artifacts/v0.7/q2g-vfr-fixtures', FIXTURE_ID, 'report.json');
const CONTROL_REPORT = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const CONTROL_REPORT_SHA = '17f7e802480f092093f5dcaebc61f78c0710a5fc36b444f016933871c4e647a9';
const FIXTURES = Object.freeze({
  'vfr-mp4-mov': Object.freeze({ id: 'VMP4', file: path.join(OWNED, 'fixtures', 'mov-vfr-' + FIXTURE_ID, 'VMP4-1280x720-vfr.mp4'),
    report: FIXTURE_REPORT, reportSha256: FIXTURE_REPORT_SHA, cadence: 'variable', frames: '320' }),
  'vfr-mov-mov': Object.freeze({ id: 'VMOV', file: path.join(OWNED, 'fixtures', 'mov-vfr-' + FIXTURE_ID, 'VMOV-1280x720-vfr.mov'),
    report: FIXTURE_REPORT, reportSha256: FIXTURE_REPORT_SHA, cadence: 'variable', frames: '320' }),
  'cfr-mp4-mov': Object.freeze({ id: 'A', file: path.join(OWNED, 'fixtures/sdr-envelope-6b317682-605b-4d40-8ff3-b3f84678f0ae/A-1920x1080-30fps.mp4'),
    report: CONTROL_REPORT, reportSha256: CONTROL_REPORT_SHA, cadence: 'constant', frames: '300', fps: '30/1',
    sha256: '8f9a4f320fcf214759ba0d4ba0b7a1aad4e2393c6b56360b9858752e5e15ebdc', bytes: 7302143 }),
});
const need = (condition, code, message) => { if (!condition) throw Object.assign(new Error(message), { code }); };
function requireFixtureBinding(id, digest) {
  need(typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest),
  'MOV_VFR_FIXTURE_BINDING', 'ROOT must pin the reviewed VFR fixture UUID and report SHA256 before any proof runs.');
}
const SOURCE_ENVELOPE = 'h264-aac-lc-48k-stereo-v2';
const ENTRY_MODULES = ['main.js', 'preload.js', 'scripts/v07-remux-mov-vfr-smoke.cjs', 'scripts/v07-mov-vfr-fixtures.cjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const CASES = Object.freeze(Object.keys(FIXTURES));
// Per mode: three direct copies; no seeds/encodes. See job progress.md for the
// prospective allocation. Root admits each run afresh after reviewing the code.
const LIMITS = Object.freeze({ totalMs: 45 * 60000, forecastBytes: 2 * 1024 ** 3, maxInvocations: 64, maxStarts: 3 });
const MARGIN_BYTES = 512 * 1024 ** 2;
const AVERAGE_WARNING = Object.freeze({ code: 'OPERATION_VALIDATION_WARNING', key: null,
  message: 'Stream 0 \u2192 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.' });
// Native ISOBMFF fixtures predict zero warnings. The sole prospectively declared
// alternative is the existing exact average-summary warning on a VFR pair.
const OUTCOMES = Object.freeze({
  'vfr-mp4-mov': Object.freeze(['no-warnings', 'variable-average']),
  'vfr-mov-mov': Object.freeze(['no-warnings', 'variable-average']),
  'cfr-mp4-mov': Object.freeze(['no-warnings']),
});
function configuration(cli) {
  assert.ok(Array.isArray(cli) && cli.length === 4 && cli[0] === '--run-owned-remux'
    && ['--qualify', '--normal'].includes(cli[1]) && cli[2] === '--cases' && typeof cli[3] === 'string', 'Exact Q2g arguments required.');
  const choices = cli[3].split(',');
  assert.ok(choices.length > 0 && new Set(choices).size === choices.length && choices.every(value => CASES.includes(value)), 'Only explicit Q2g cases are admitted.');
  return Object.freeze({ mode: cli[1], choices: Object.freeze(choices) });
}
function routeOptions(mode) {
  assert.ok(['--qualify', '--normal'].includes(mode), 'An explicit laboratory or production mode is required.');
  if (mode === '--normal') {
    requireProductionRoute(REMUX_POLICIES);
    return { remuxPolicies: REMUX_POLICIES, remuxPolicyIdentity: REMUX_POLICY_ID };
  }
  return { remuxPolicies: [...REMUX_POLICIES.filter(value => value.inputFamily !== 'isobmff' || value.target !== 'mov'), {
    id: 'q2g-vfr-laboratory-isobmff-mov', inputFamily: 'isobmff', target: 'mov', allowAncillary: false, allowRotation90: false,
    sourceEnvelope: SOURCE_ENVELOPE, evidenceIds: ['q2g-vfr-fresh-prospective-qualification'],
    runtimeIdentity: '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6',
  }], remuxPolicyIdentity: 'q2g-vfr-fresh-prospective-laboratory-v1' };
}
function requireProductionRoute(policies) {
  const matches = policies.filter(value => value.inputFamily === 'isobmff' && value.target === 'mov');
  need(matches.length === 1, 'MOV_VFR_PRODUCTION_ROUTE', 'Normal proof requires exactly one production ISOBMFF-to-MOV route.');
  const route = matches[0];
  need(['full-remux-isobmff-mov-v1', 'full-remux-isobmff-mov-v2'].includes(route?.id) && route.sourceEnvelope === SOURCE_ENVELOPE
    && route.allowAncillary === false && route.allowRotation90 === false,
  'MOV_VFR_PRODUCTION_ROUTE', 'Normal Q2g proof requires the v2 source envelope in the real production catalog.');
  return route;
}
function requireOutcome(label, result, essence) {
  need(Object.hasOwn(OUTCOMES, label), 'MOV_VFR_PROOF_OUTCOME', 'Only named Q2g outcomes are admitted.');
  const warningSet = warnings => warnings.map(value => JSON.stringify({ code: value.code, key: value.key ?? null, message: value.message })).sort();
  const actual = warningSet(result.warnings ?? []);
  const choice = actual.length === 0 && result.outcome === 'saved' ? 'no-warnings'
    : result.outcome === 'saved-with-warning' && JSON.stringify(actual) === JSON.stringify(warningSet([AVERAGE_WARNING])) ? 'variable-average' : null;
  need(OUTCOMES[label].includes(choice), 'MOV_VFR_PROOF_OUTCOME', label + ': unexpected publication outcome or warning code/key/message set');
  if (choice === 'variable-average') requireCadence(essence, FIXTURES[label]);
  return choice;
}
function fixtureSource(bytes, label, digest = sha) {
  need(Object.hasOwn(FIXTURES, label), 'MOV_VFR_FIXTURE_CASE', 'Only pinned fixture cases are available.');
  const expected = FIXTURES[label];
  need(digest(bytes) === expected.reportSha256, 'MOV_VFR_FIXTURE_REPORT', 'Retained fixture receipt changed.');
  const receipt = JSON.parse(bytes.toString('utf8'));
  const specimen = receipt.cases.find(value => value.id === expected.id);
  need(specimen?.output === expected.file && /^[a-f0-9]{64}$/.test(specimen.file?.sha256)
    && Number.isSafeInteger(specimen.file.bytes) && specimen.file.bytes > 0 && specimen.file.bytes <= 256 * 1024 ** 2,
  'MOV_VFR_FIXTURE_SOURCE', 'Fixture source path, SHA256 and bounded byte count must bind the reviewed receipt.');
  if (expected.sha256) need(specimen.file.sha256 === expected.sha256 && specimen.file.bytes === expected.bytes,
    'MOV_VFR_FIXTURE_SOURCE', 'The retained constant control source changed.');
  const capture = receipt.invocations.find(value => value.kind === 'metadata' && value.argv.at(-1) === expected.file);
  need(capture?.exitCode === 0, 'MOV_VFR_FIXTURE_METADATA', 'Successful retained source metadata is required.');
  const probe = JSON.parse(capture.stdout);
  requireSourceObservation(probe);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  let videoTiming = null;
  if (expected.cadence === 'variable') {
    need(receipt.id === FIXTURE_ID && receipt.status === 'generated-and-inspected-owned-fixtures' && receipt.leaseReleased === true
      && receipt.liveChildren === 0 && receipt.allTrackedChildrenClosed === true && receipt.maximumConcurrentChildren === 1
      && receipt.runtime?.runtimeIdentity === FAMILIES[0].runtimeIdentity && specimen.status === 'generated-and-inspected',
    'MOV_VFR_FIXTURE_CLOSURE', 'Only the complete closed pinned-runtime fixture run is admitted.');
    const spec = VFR_SPECS.find(value => value.id === expected.id);
    assessMetadata(spec, normalizeProbe(probe));
    const frames = receipt.invocations.find(value => value.kind === 'source-video-timing' && value.argv.at(-1) === expected.file);
    need(frames?.exitCode === 0 && frames.stderr === '' && !frames.stdoutCapture?.truncated && !frames.stderrCapture?.truncated,
      'MOV_VFR_FIXTURE_TIMING', 'A complete error-free retained frame probe is required.');
    videoTiming = assessVideoFrames(spec, probe, frames.stdout);
    need(JSON.stringify(videoTiming) === JSON.stringify(specimen.videoTiming)
      && remuxProbeFingerprint(probe) === remuxProbeFingerprint(specimen.probe),
    'MOV_VFR_FIXTURE_TIMING', 'Stored fixture timing/header must agree with its raw complete observations.');
  } else need(video.avg_frame_rate === expected.fps && video.r_frame_rate === expected.fps,
    'MOV_VFR_FIXTURE_RATE', 'Pinned control rate summaries changed.');
  return { ...expected, sha256: specimen.file.sha256, bytes: specimen.file.bytes,
    proof: { receiptSha256: expected.reportSha256, hasBFrames: video.has_b_frames, cadence: expected.cadence,
      averageRate: video.avg_frame_rate, nominalRate: video.r_frame_rate, videoTiming } };
}
function requireSourceObservation(probe) {
  assert.equal(probe.streams.length, 2);
  const video = probe.streams.find(value => value.codec_type === 'video'), audio = probe.streams.find(value => value.codec_type === 'audio');
  assert.ok(Number.isSafeInteger(video?.has_b_frames) && video.has_b_frames > 0, 'Pinned source must have observed B frames.');
  assert.ok(video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && video.profile === 'High'
    && video.field_order === 'progressive' && video.color_range === 'tv'
    && ['color_transfer', 'color_primaries', 'color_space'].every(key => video[key] === 'bt709'), 'Pinned H264 SDR source observation required.');
  assert.ok(audio?.codec_name === 'aac' && audio.profile === 'LC' && audio.sample_fmt === 'fltp' && audio.sample_rate === '48000'
    && audio.channels === 2 && audio.channel_layout === 'stereo', 'Pinned 48kHz stereo AAC LC observation required.');
  assert.deepEqual(probe.chapters, []);
}
function readMovReceipt(evidence, entry) {
  const mov = getCollectedMovRepresentation(evidence, { assessment: entry.remuxAssessment,
    runtimeIdentity: entry.operationPlan.runtimeIdentity, outputId: entry.outputId });
  return getMovRepresentation(mov, { outputId: entry.outputId.toLowerCase(),
    outputEvidenceFingerprint: evidence.outputProbeFingerprint, outputSha256: evidence.essenceEvidence.outputFileSha256 });
}
function requireMovReceipt(mov, evidence, outputId, outputSha256) {
  assert.ok(mov?.kind === 'owned-mov-mdhd-language' && mov.version === 1, 'Collected MOV representation receipt is required.');
  assert.equal(mov.outputId, outputId.toLowerCase(), 'MOV receipt belongs to another output.');
  assert.equal(mov.outputSha256, outputSha256, 'MOV receipt must bind published bytes.');
  assert.equal(evidence.essenceEvidence.outputFileSha256, outputSha256, 'Collected seal must bind published bytes.');
  assert.ok(typeof mov.outputEvidenceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(mov.outputEvidenceFingerprint));
  assert.equal(mov.outputEvidenceFingerprint, evidence.outputProbeFingerprint, 'MOV receipt must bind the collected output probe.');
  assert.equal(mov.tracks.length, 2);
  assert.deepEqual(mov.tracks.map(value => value.outputIndex), [0, 1]);
  assert.equal(new Set(mov.tracks.map(value => value.trackId)).size, 2);
  for (const track of mov.tracks) assert.ok(Number.isSafeInteger(track.trackId) && track.trackId > 0
    && track.languageCode === 32767 && /^[a-f0-9]{64}$/.test(track.mdhdSha256), 'Pinned MOV tracks need genuine unspecified mdhd languages.');
  return mov;
}
function requireOutputProbe(invocations, evidence, ffprobe, expected) {
  const capture = invocations.find(value => value.file === ffprobe && value.args.includes('-show_format')
    && value.args.at(-1) === evidence.outputPath);
  const probe = capture?.metadataProbe;
  assert.ok(probe && remuxProbeFingerprint(probe) === evidence.outputProbeFingerprint,
    'The actual output header must bind the complete collector output probe.');
  assert.deepEqual(probe.streams.map(stream => [stream.codec_type, stream.codec_name, stream.codec_tag_string]),
    [['video', 'h264', 'avc1'], ['audio', 'aac', 'mp4a']], 'Pinned MOV codec/sample-entry tags changed.');
  assert.deepEqual(probe.streams.map(stream => stream.tags.handler_name), ['VideoHandler', 'SoundHandler'],
    'Pinned MOV handler names changed.');
  if (expected?.cadence === 'variable') need(probe.streams[0].time_base === '1/60000',
    'MOV_VFR_PROOF_CLOCK', 'The measured variable MOV output must retain its exact60000Hz video clock.');
  // The sealed native observer proves qt ftyp. Retain demuxed brand tags here
  // too, including the reviewed stale-mdta-brand limitation; no new allowance.
  return probe;
}
function requireCadence(essence, expected) {
  const videos = essence.streams.filter(stream => stream.codecType === 'video'), video = videos[0];
  need(videos.length === 1 && ['constant', 'variable'].includes(expected?.cadence)
    && ['source', 'output'].every(side => video[side]?.complete === true && video[side].unitCount === expected.frames
      && video[side].cadence?.version === 1 && video[side].cadence.classification === expected.cadence
      && video[side].cadence.intervalCount === String(BigInt(expected.frames) - 1n)),
  'MOV_VFR_PROOF_CADENCE', 'The exact case needs matching complete source/output cadence and every expected frame interval.');
  const rational = value => value && /^-?\d{1,40}$/.test(value.numerator) && /^[1-9]\d{0,39}$/.test(value.denominator);
  for (const side of ['source', 'output']) {
    const cadence = video[side].cadence;
    need(rational(cadence.firstStep) && BigInt(cadence.firstStep.numerator) > 0n,
      'MOV_VFR_PROOF_CADENCE', 'Complete cadence needs its positive observed first step.');
    if (expected.cadence === 'variable') need(rational(cadence.differingStep) && BigInt(cadence.differingStep.numerator) > 0n
      && BigInt(cadence.firstStep.numerator) * BigInt(cadence.differingStep.denominator)
        !== BigInt(cadence.differingStep.numerator) * BigInt(cadence.firstStep.denominator),
    'MOV_VFR_PROOF_CADENCE', 'Variable cadence needs mathematically distinct positive observed steps.');
    else need(cadence.differingStep === null, 'MOV_VFR_PROOF_CADENCE', 'A constant control cannot carry a differing step.');
  }
  // A proof on exactly representable clocks must actually observe zero error.
  // This narrows this experiment only; production keeps its1/500s validator.
  need(video.timestamps?.complete === true && video.timestamps.comparedUnits === expected.frames
    && ['maxPtsError', 'maxDurationError'].every(field => rational(video.timestamps[field]) && BigInt(video.timestamps[field].numerator) === 0n)
    && ['firstPts', 'endPts'].every(field => rational(video.source[field]) && rational(video.output[field])
      && BigInt(video.source[field].numerator) * BigInt(video.output[field].denominator)
        === BigInt(video.output[field].numerator) * BigInt(video.source[field].denominator)),
  'MOV_VFR_PROOF_TIMING', 'Exactly representable MOV fixture timestamps and complete intervals must measure zero drift.');
  return { classification: expected.cadence, source: video.source.cadence, output: video.output.cadence,
    timestamps: video.timestamps, exactClockMeasured: true };
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
function requireStartBudget(acceptedStarts) {
  assert.ok(Number.isSafeInteger(acceptedStarts) && acceptedStarts >= 0 && acceptedStarts < LIMITS.maxStarts, 'Prospective Start ceiling');
}
// Imported-module test seam only. The CLI always constructs the default
// factory below; no argument, file or child output can supply dependencies.
function createSmoke({ fs: io = fs, runTool: executeTool = runTool, verifyCandidateRuntime: verifyRuntime = verifyCandidateRuntime,
  createOperationControls: controlsFactory = createOperationControls, EncoderService: Service = EncoderService,
  randomUUID: makeId = randomUUID, sha: digest = sha, readMovReceipt: readMov = readMovReceipt } = {}) {
  return cli => runSmoke(cli, { io, executeTool, verifyRuntime, controlsFactory, Service, makeId, digest, readMov });
}
async function runSmoke(cli, { io, executeTool, verifyRuntime, controlsFactory, Service, makeId, digest, readMov }) {
  const fs = io, sha = digest;
  const { mode, choices } = configuration(cli);
  requireFixtureBinding(FIXTURE_ID, FIXTURE_REPORT_SHA);
  const policyOptions = routeOptions(mode);
  const id = makeId(), directory = path.join(ROOT, 'artifacts/v0.7/q2g-vfr-isobmff-mov', id);
  const owned = path.join(OWNED, 'outputs', 'q2g-vfr-isobmff-mov-' + id), stateDir = path.join(owned, 'state');
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
    assert.ok(!controller.signal.aborted);
    assert.equal(children.size, 0, 'Concurrent child admission is forbidden.');
    assert.ok(report.invocations.length < report.limits.maxInvocations, 'Prospective invocation ceiling');
    const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (path.normalize(file).toLowerCase() === path.normalize(helper).toLowerCase()) {
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(args.length, 5); assert.ok(args[4].includes('[System.IO.DriveInfo]::new')); assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
    } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(file));
    assert.ok(!args.includes('-y'));
    for (let i = 0; i < args.length; i++) if (['-i', '-attach'].includes(args[i])) assert.ok(args[i + 1].startsWith(owned + path.sep));
    assert.deepEqual(await freezeModules(), report.sourcesBefore, 'Source modules changed before child admission.');
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
      if (file === runtime.ffprobe && args.includes('-show_format') && args.includes('-show_streams'))
        entry.metadataProbe = parseProbeJson(value.stdout, 'Q2g retained metadata');
      return value;
    } catch (error) { Object.assign(entry, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture }); throw error; }
    finally { if (child) assert.ok(entry.closed); entry.finishedAt = new Date().toISOString(); await save(); }
  }
  async function copySource(file, name, expectedSha, expectedBytes) {
    const before = await fs.lstat(file, { bigint: true }); assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n);
    const bytes = await fs.readFile(file); const after = await fs.lstat(file, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(before[key], after[key]);
    assert.ok(bytes.length <= 512 * 1024 ** 2); if (expectedSha) assert.equal(sha(bytes), expectedSha);
    need(bytes.length === expectedBytes, 'MOV_VFR_FIXTURE_SOURCE', 'Copied source byte count must match the pinned fixture receipt.');
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
  async function job(label, file, target) {
    const output = path.join(owned, 'output-' + label); await fs.mkdir(output);
    const record = { label, source: file, target, status: 'preparing' }; report.cases.push(record); await save();
    let { s, item } = await prepare(file, output, target);
    record.initial = s;
    record.prepared = s; assert.equal(item.status, 'ready', item.reason);
    record.detailsBefore = service.getEncodingDetails({ planId: s.planId, fileId: item.id });
    requireStartBudget(report.acceptedStarts);
    service.startBatch({ planId: s.planId, fileIds: [item.id] }); report.acceptedStarts++; await service.taskPromise;
    record.result = service.snapshot(); const result = record.result.items.find(value => value.id === item.id), entry = service.plan.entries.get(item.id);
    record.detailsAfter = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); record.evidence = entry.operationEvidence;
    assert.equal(result.status, 'success', result.reason); assert.equal(record.evidence.status, 'completed'); assert.equal(result.evidenceStorage.final.violations.length, 0);
    record.warningSet = requireOutcome(label, result, record.evidence.essenceEvidence);
    record.cadence = requireCadence(record.evidence.essenceEvidence, FIXTURES[label]);
    record.output = { file: entry.destination, bytes: (await fs.stat(entry.destination)).size, sha256: sha(await fs.readFile(entry.destination)) };
    record.movRepresentation = requireMovReceipt(readMov(record.evidence, entry), record.evidence, entry.outputId, record.output.sha256);
    record.outputProbe = requireOutputProbe(report.invocations, record.evidence, runtime.ffprobe, FIXTURES[label]);
    record.status = 'passed-real-full-remux-service';
    assert.equal(children.size, 0); await save(); return record;
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(stateDir);
    report.ownedBytesBefore = await ownedBytes(owned, fs); report.resourcesBefore = await space(); await save();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: 'Bounded Q2g fresh ISOBMFF-to-MOV root-only proof' })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    runtime = await verifyRuntime({ root: ROOT }); report.runtime = runtime.verified; report.sourcesBefore = await freezeModules();
    const controls = controlsFactory({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...policyOptions });
    const observed = controls.operationRuntime, invoke = observed.invoke.bind(observed);
    observed.invoke = (token, tool, args, options) => run(runtime[tool], args, options, (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new Service({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1,
      runtimeIdentity: FAMILIES[0].runtimeIdentity, run, ...controls }); await service.initializeDiagnostics();
    for (const choice of choices) {
      const specimen = fixtureSource(await fs.readFile(FIXTURES[choice].report), choice, sha);
      report.sourceProofs ??= {}; report.sourceProofs[choice] = specimen.proof;
      const master = await copySource(specimen.file, choice, specimen.sha256, specimen.bytes);
      await job(choice, master, 'mov');
    }
    {
      const result = report.cases.find(value => value.target === 'mov' && value.output);
      const target = path.join(owned, 'ready-cancel-output'); await fs.mkdir(target);
      const scan = await prepare(result.source, target, 'mov');
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
module.exports = { createSmoke, configuration, routeOptions, requireStartBudget, requireProductionRoute,
  requireOutcome, fixtureSource, requireSourceObservation, requireMovReceipt, readMovReceipt, requireOutputProbe,
  requireSpace, countFileCopy, requireGrowth, ownedBytes, requireCadence, requireFixtureBinding, CASES, LIMITS, FIXTURES, AVERAGE_WARNING };
if (require.main === module) createSmoke()(process.argv.slice(2)).then(report => {
  if (report.status === 'failed-retained') process.exitCode = 1;
  console.log(JSON.stringify({ id: report.id, status: report.status, report: path.join(report.directory, 'report.json'), failure: report.failure }));
}).catch(error => { console.error(error); process.exitCode = 1; });
