'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { micros, count, SOURCES, campaign } = require('./workbench-long-range-calibration.cjs');
test('observed generated durations are parsed exactly without floating-point rounding', () => {
  assert.equal(micros('150.000000'), 150000000); assert.equal(micros('11'), 11000000);
  assert.equal(micros('0.000001'), 1); assert.equal(micros('1.013'), 1013000);
  for (const value of ['-1', 'NaN', '1.0000001', '1e6', '9007199254740992']) assert.throws(() => micros(value));
});
test('fixed campaigns retain the original geometry and isolate resize qualification', () => {
  const ordinary = campaign(), resize = campaign('resize1080to720');
  assert.equal(ordinary.width, 1280); assert.equal(ordinary.height, 720); assert.equal(ordinary.resolution, 'source');
  assert.equal(resize.width, 1920); assert.equal(resize.height, 1080); assert.equal(resize.resolution, '720');
  assert.notEqual(ordinary.familyId, resize.familyId); assert.notEqual(ordinary.resourcePolicy, resize.resourcePolicy);
  assert.notEqual(ordinary.label, resize.label); assert.notEqual(ordinary.derive, resize.derive);
  assert.ok(Object.isFrozen(ordinary) && Object.isFrozen(resize));
  assert.throws(() => campaign('../other'));
});
test('independent half-open source count arithmetic covers aligned and nonaligned ranges', () => {
  assert.equal(count(100000000, 140000000, 30), 1200);
  assert.equal(count(130000000, 150000000, 30), 600);
  assert.equal(count(1013000, 3087000, 30), 62);
  assert.equal(count(413000, 8621000, 48000), 393984);
});
test('campaign crosses both legacy duration ceilings and uses an independently generated held-out pattern', () => {
  assert.ok(SOURCES[0].seconds > 120);
  assert.ok(SOURCES[0].cases[0].range.endUs - SOURCES[0].cases[0].range.startUs > 30000000);
  assert.equal(SOURCES[0].cases[1].range.endUs, undefined);
  assert.notEqual(SOURCES[0].flip, SOURCES[1].flip); assert.notEqual(SOURCES[0].frequency, SOURCES[1].frequency);
});

test('Full resize keeps null requests and independently counts a longer complete audio tail', () => {
  const { sourcesForCampaign, selectedCounts } = require('./workbench-long-range-calibration.cjs');
  const full = campaign('fullResize1080to720'), sources = sourcesForCampaign('fullResize1080to720');
  assert.equal(full.full, true); assert.equal(full.familyId, 'cfr-sdr-full-resize-flac-v1');
  assert.equal(full.resourcePolicy, 'cfr1080p30-full-to720p-flac-resources-v1');
  assert.notEqual(full.derive, campaign('resize1080to720').derive);
  assert.deepEqual(sources.map(s => s.cases[0].range), [null, null]);
  assert.deepEqual(selectedCounts(full, sources[0], null, 150000000), { frames: 4500, samples: 7200000 });
  assert.deepEqual(selectedCounts(full, sources[1], null, 43217000), { frames: 1293, samples: 2074416 });
  assert.throws(() => selectedCounts(full, sources[1], { startUs: 0 }, 43217000));
  sources[0].seconds = 1; assert.equal(sourcesForCampaign('fullResize1080to720')[0].seconds, 150);
  assert.equal(sourcesForCampaign('keep720')[0].cases[0].range.startUs, 100000000);
});

test('non-round fixture durations get a positive integer deadline without relaxing runner guards', () => {
  const { fixtureTimeoutMs } = require('./workbench-long-range-calibration.cjs');
  assert.equal(fixtureTimeoutMs(150, 1920, 1080), 1042500);
  assert.equal(fixtureTimeoutMs(43.217, 1920, 1080), 321715);
  assert.equal(fixtureTimeoutMs(11, 1280, 720), 63000);
  assert.throws(() => fixtureTimeoutMs(Infinity, 1920, 1080));
  assert.throws(() => fixtureTimeoutMs(1e9, 1920, 1080));
});


test('1440p Full calibration has a distinct fixed short matrix and independent audio-tail counts', () => {
  const { sourcesForCampaign, selectedCounts, fixtureTimeoutMs } = require('./workbench-long-range-calibration.cjs');
  const next = campaign('fullResize1440to720'), old = campaign('fullResize1080to720');
  assert.equal(next.width, 2560); assert.equal(next.height, 1440); assert.equal(next.resolution, '720');
  assert.equal(next.familyId, 'cfr-sdr-full-1440-to720-flac-v1');
  assert.equal(next.resourcePolicy, 'cfr1440p30-full-to720p-flac-resources-v1');
  assert.notEqual(next.derive, old.derive); assert.notEqual(next.label, old.label);
  const sources = sourcesForCampaign('fullResize1440to720');
  assert.deepEqual(sources.map(s => s.cases[0].range), [null, null]);
  assert.deepEqual(selectedCounts(next, sources[0], null, 12000000), { frames: 360, samples: 576000 });
  assert.deepEqual(selectedCounts(next, sources[1], null, 7217000), { frames: 213, samples: 346416 });
  assert.notEqual(sources[0].flip, sources[1].flip); assert.notEqual(sources[0].frequency, sources[1].frequency);
  assert.equal(fixtureTimeoutMs(7.217, 2560, 1440), 116604);
  sources[0].seconds = 500; assert.equal(sourcesForCampaign('fullResize1440to720')[0].seconds, 12);
  assert.equal(sourcesForCampaign('fullResize1080to720')[0].seconds, 150);
  assert.equal(campaign().width, 1280);
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { prepareCandidateKeep720Case, runCandidateKeep720Campaign } = require('./workbench-long-range-calibration.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { buildEncodeOperation, withEncodeOperationTelemetry } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { assertProportionalCollectionSelection } = require('../src/operation-family.cjs');
const { deriveCfrFlacResources } = require('../src/operation-resource-budget.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
function candidateProbe(size) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360',
    start_pts: 0, start_time: '0', duration_ts: 2304000, duration: '150', disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 7200000, duration: '150', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '150', size: String(size), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, chapters: [], programs: [], stream_groups: [] };
}
async function candidateFixture(t, execute, resize = false) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'ffmpeg-candidate-case-'));
  let runtime; t.after(async () => { await runtime?.close(); assert.equal(await fs.realpath(root), root); await fs.rm(root, { recursive: true }); });
  const pins = {};
  for (const k of ['ffmpeg', 'ffprobe']) { const data = Buffer.from('non-executable fixture ' + k); pins[k] = { path: path.join(root, k), size: data.length, sha256: digest(data) }; await fs.writeFile(pins[k].path, data); }
  const runtimeIdentity = digest(JSON.stringify(['ffmpeg', 'ffprobe'].map(k => ({ sizeBytes: pins[k].size, sha256: pins[k].sha256 }))));
  const dependency = { path: path.join(root, 'codec.fixture'), size: 5, sha256: digest('codec') };
  await fs.writeFile(dependency.path, 'codec');
  runtime = await openCandidateCalibrationRuntime({ pins, runtimeIdentity, dependencies: [dependency] }, { execute: execute || (async () => { throw new Error('No process expected'); }) });
  const source = path.join(root, 'source.fixture'); await fs.writeFile(source, 'synthetic source bytes');
  const sourceIdentity = await readSourceIdentity(source), probe = candidateProbe(sourceIdentity.size);
  if (resize) { probe.streams[0].width = 1920; probe.streams[0].height = 1080; }
  const makePlan = (range = { startUs: 100000000, endUs: 140000000 }, resolution = resize ? '720' : 'source') => withEncodeOperationTelemetry(buildEncodeOperation({
    input: source, output: path.join(root, 'output.mkv'), settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, runtimeIdentity,
    inspection: { probe, color: classifyColor(probe), duration: 150 },
    ...(resize && resolution === '720' ? { identityOrientationQualification: { evidenceId: 'synthetic-owned-identity', runtimeIdentity, sourceEvidenceFingerprint: require('../src/encode-operation.cjs').fingerprintEncodeSource(probe), videoIndex: 0 } } : {}),
    request: resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: { range, resolution, audioPolicy: 'precision-flac' } }) }));
  return { root, source, runtime, dependency, probe, makePlan, options: { verifiedRuntime: runtime, plan: makePlan(), sourceIdentity, evidenceId: 'synthetic-preregistered-only' } };
}
test('candidate case binds final instrumented plan and identical approved collection objects', async t => {
  const h = await candidateFixture(t), selected = await prepareCandidateKeep720Case(h.options), q = selected.selection;
  assert.match(selected.boundsClassification, /not measured production qualification/);
  assert.deepEqual(selected.resources, deriveCfrFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 40000000, sourceBytes: h.options.sourceIdentity.size }));
  const collection = { plan: h.options.plan, sourcePath: h.source, sourceProbe: h.probe, budget: q.budget, timingQualification: q.timingQualification, sourcePolicy: q.sourcePolicy };
  assert.doesNotThrow(() => assertProportionalCollectionSelection(q, collection));
  for (const changed of [{ plan: h.makePlan() }, { budget: { ...q.budget } }, { sourcePolicy: { ...q.sourcePolicy } }])
    assert.throws(() => assertProportionalCollectionSelection(q, { ...collection, ...changed }));
  assert.equal(await selected.requireCurrent(), q); selected.close(); await assert.rejects(selected.requireCurrent());
});
test('candidate case refuses stale source and closed runtime without widening other families', async t => {
  const h = await candidateFixture(t), selected = await prepareCandidateKeep720Case(h.options);
  await fs.appendFile(h.source, 'changed'); await assert.rejects(selected.requireCurrent());
  await assert.rejects(prepareCandidateKeep720Case(h.options));
  await h.runtime.close(); await assert.rejects(prepareCandidateKeep720Case(h.options));
});
test('copied candidate and accessor fields refuse before campaign filesystem effects', async t => {
  const h = await candidateFixture(t); let writes = 0, reads = 0;
  t.mock.method(fs, 'mkdtemp', async () => { writes++; throw new Error('Unexpected directory creation'); });
  await assert.rejects(runCandidateKeep720Campaign({ verifiedRuntime: { ...h.runtime } }));
  await h.runtime.close(); await assert.rejects(runCandidateKeep720Campaign({ verifiedRuntime: h.runtime }));
  const request = Object.defineProperty({}, 'verifiedRuntime', { enumerable: true, get() { reads++; return h.runtime; } });
  await assert.rejects(runCandidateKeep720Campaign(request)); assert.equal(reads, 0); assert.equal(writes, 0);
});
test('valid candidate campaign reaches only injected fixture runner and retains failure without catalog authority', async t => {
  let calls = 0; const h = await candidateFixture(t, async (file, args, options) => {
    calls++; assert.ok(args.includes('lavfi')); const child = new EventEmitter(); child.kill = () => {}; options.onChild(child); child.emit('close', 1, null);
    throw Object.assign(new Error('Deliberate stop before any generated media.'), { code: 'SYNTHETIC_FIXTURE_STOP' });
  });
  const mkdtemp = fs.mkdtemp; t.mock.method(fs, 'mkdtemp', prefix => {
    assert.ok(prefix.endsWith('candidate-keep720-calibration-')); return mkdtemp(path.join(h.root, 'campaign-'));
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 100n * 1024n ** 3n, bsize: 1n }));
  const report = await runCandidateKeep720Campaign({ verifiedRuntime: h.runtime });
  assert.equal(calls, 1); assert.equal(report.status, 'failed-retained'); assert.equal(report.failure.code, 'SYNTHETIC_FIXTURE_STOP');
  assert.deepEqual(report.census, { spawned: 1, closed: 1, live: 0, maximum: 1 });
  assert.equal(report.catalogActivated, false); assert.equal(report.publicationAuthorized, false); assert.equal(report.cases.length, 0);
  await assert.rejects(h.runtime.requireCurrent());
});

test('candidate campaign saves child failure and bounded settlement dependency diagnostic', async t => {
  let calls = 0;
  const h = await candidateFixture(t, async (file, args, options) => {
    calls++; const child = new EventEmitter(); child.kill = () => {}; options.onChild(child);
    await fs.appendFile(h.dependency.path, 'changed'); child.emit('close', 1, null);
    throw Object.assign(new Error('Injected child failure before media generation'), { code: 'SYNTHETIC_FIXTURE_STOP' });
  });
  const mkdtemp = fs.mkdtemp;
  t.mock.method(fs, 'mkdtemp', prefix => {
    assert.ok(prefix.endsWith('candidate-keep720-calibration-')); return mkdtemp(path.join(h.root, 'campaign-'));
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 100n * 1024n ** 3n, bsize: 1n }));
  const report = await runCandidateKeep720Campaign({ verifiedRuntime: h.runtime });
  const saved = JSON.parse(await fs.readFile(path.join(report.root, 'report.json'), 'utf8'));
  assert.equal(calls, 1); assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.failure.code, 'CANDIDATE_CALIBRATION_CHANGED_AFTER_FAILURE');
  assert.equal(saved.failure.cause.code, 'SYNTHETIC_FIXTURE_STOP');
  assert.deepEqual(saved.failure.postVerificationFailure, {
    code: 'CANDIDATE_CALIBRATION_RUNTIME', message: 'Listed candidate dependency changed path or size.' });
  assert.deepEqual(saved.failure, report.failure);
  assert.deepEqual(saved.census, { spawned: 1, closed: 1, live: 0, maximum: 1 });
  assert.equal(saved.catalogActivated, false); assert.equal(saved.publicationAuthorized, false);
});

const { prepareCandidateResize1080to720Case, runCandidateResize1080to720Campaign, requireValidCampaignTelemetry } = require('./workbench-long-range-calibration.cjs');
test('candidate resize binds its genuine final plan and distinct resize resource formula', async t => {
  const h = await candidateFixture(t, undefined, true);
  const selected = await prepareCandidateResize1080to720Case(h.options);
  assert.deepEqual(selected.resources, require('../src/operation-resource-budget.cjs').deriveCfrResizeFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 40000000, sourceBytes: h.options.sourceIdentity.size }));
  assert.equal(selected.selection.sourcePolicy.id, campaign('resize1080to720').familyId);
  assert.equal(await selected.requireCurrent(), selected.selection);
  await assert.rejects(prepareCandidateKeep720Case(h.options));
  await assert.rejects(prepareCandidateResize1080to720Case({ ...h.options, verifiedRuntime: { ...h.runtime } }));
  await assert.rejects(prepareCandidateResize1080to720Case({ ...h.options, plan: h.makePlan(undefined, 'source') }));
  const q = selected.selection;
  assert.throws(() => assertProportionalCollectionSelection(q, { plan: h.options.plan, sourcePath: h.source, sourceProbe: h.probe,
    budget: deriveCfrFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 40000000, sourceBytes: h.options.sourceIdentity.size }).budget,
    timingQualification: q.timingQualification, sourcePolicy: q.sourcePolicy }));
  selected.close(); await assert.rejects(selected.requireCurrent());
});
test('resize campaign preserves bounded stderr on failed injected child and closes runtime', async t => {
  const { PassThrough } = require('node:stream');
  const h = await candidateFixture(t, async (file, args, options) => {
    assert.ok(args.includes('testsrc2=size=1920x1080:rate=30:duration=150'));
    const child = new EventEmitter(); child.kill = () => {}; child.stderr = new PassThrough(); options.onChild(child);
    child.stderr.write(Buffer.alloc(256 * 1024 + 19, 120)); child.stderr.end(); child.emit('close', 1, null);
    throw Object.assign(new Error('Injected resize fixture stop'), { code: 'SYNTHETIC_FIXTURE_STOP' });
  });
  const mkdtemp = fs.mkdtemp; t.mock.method(fs, 'mkdtemp', prefix => {
    assert.ok(prefix.endsWith('candidate-resize1080to720-calibration-')); return mkdtemp(path.join(h.root, 'campaign-'));
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 100n * 1024n ** 3n, bsize: 1n }));
  const report = await runCandidateResize1080to720Campaign({ verifiedRuntime: h.runtime });
  assert.equal(report.failure.code, 'SYNTHETIC_FIXTURE_STOP'); assert.equal(report.resourcePolicy, campaign('resize1080to720').resourcePolicy);
  assert.equal(report.children.length, 1); const c = report.children[0];
  assert.equal(c.stderr.totalBytes, 256 * 1024 + 19); assert.equal(c.stderr.retainedBytes, 256 * 1024); assert.equal(c.stderr.truncated, true);
  assert.equal((await fs.readFile(c.stderr.path)).length, 256 * 1024); assert.equal(c.exitCode, 1);
  assert.equal(c.failure.code, 'SYNTHETIC_FIXTURE_STOP'); await assert.rejects(h.runtime.requireCurrent());
});
test('campaign acceptance refuses invalid or unknown-row telemetry', () => {
  assert.throws(() => requireValidCampaignTelemetry({ valid: false, streams: [] }));
  assert.throws(() => requireValidCampaignTelemetry({ valid: true, streams: [{ unknownInputRecords: '1' }] }));
  assert.throws(() => requireValidCampaignTelemetry({ valid: true, streams: [] }));
  assert.throws(() => requireValidCampaignTelemetry({ valid: true, streams: [{ kind: 'video', unknownInputRecords: '1' }, { kind: 'audio', unknownInputRecords: '0' }] }), /Unknown telemetry input rows refused/);
  assert.doesNotThrow(() => requireValidCampaignTelemetry({ valid: true, streams: [{ kind: 'video', unknownInputRecords: '0' }, { kind: 'audio', unknownInputRecords: '0' }] }));
});

test('resize candidate supports late open-end and nonaligned plans but refuses Full and stale source', async t => {
  const h = await candidateFixture(t, undefined, true);
  for (const range of [{ startUs: 130000000 }, { startUs: 413000, endUs: 8621000 }]) {
    const chosen = await prepareCandidateResize1080to720Case({ ...h.options, plan: h.makePlan(range) });
    await chosen.requireCurrent(); chosen.close();
  }
  await assert.rejects(async () => prepareCandidateResize1080to720Case({ ...h.options, plan: h.makePlan(null) }));
  const selected = await prepareCandidateResize1080to720Case(h.options);
  await fs.appendFile(h.source, 'changed'); await assert.rejects(selected.requireCurrent()); selected.close();
  await h.runtime.close(); await assert.rejects(runCandidateResize1080to720Campaign({ verifiedRuntime: h.runtime }));
});
test('successful injected child stderr is retained before a subsequent fixture failure', async t => {
  const { PassThrough } = require('node:stream');
  const h = await candidateFixture(t, async (file, args, options) => {
    const child = new EventEmitter(); child.kill = () => {}; child.stderr = new PassThrough(); options.onChild(child);
    child.stderr.write('retained warning\n'); child.stderr.end(); child.emit('close', 0, null);
    // Deliberately do not create generated media: later fileHash fails, after successful child settlement.
    return { exitCode: 0, stdout: '', stderr: 'retained warning\n' };
  });
  const mkdtemp = fs.mkdtemp; t.mock.method(fs, 'mkdtemp', prefix => mkdtemp(path.join(h.root, 'campaign-')));
  t.mock.method(fs, 'statfs', async () => ({ bavail: 100n * 1024n ** 3n, bsize: 1n }));
  const report = await runCandidateResize1080to720Campaign({ verifiedRuntime: h.runtime });
  assert.equal(report.status, 'failed-retained'); assert.equal(report.failure.code, 'ENOENT');
  const row = report.children[0]; assert.equal(row.closed, true); assert.equal(row.exitCode, 0);
  assert.equal(row.stderr.available, true); assert.equal(row.stderr.truncated, false);
  assert.equal(await fs.readFile(row.stderr.path, 'utf8'), 'retained warning\n');
  assert.equal(row.stderr.sha256, digest('retained warning\n'));
});
