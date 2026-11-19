'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { FAMILY_ID, RESOURCE_POLICY, deriveCfrFlacResources } = require('../src/operation-resource-budget.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { operationCostLimits } = require('../src/encoder-service.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
// In-memory fixtures only: not measured qualification, process or media execution.
const RUNTIME = 'a'.repeat(64), settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const LEGACY_BUDGET = { sourceDecode: 'complete', timeoutMs: 1000, maxFrameBytes: 16384, maxPcmBytes: 1048576, maxRecords: 500, maxSpoolBytes: 65536 };
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}

function descriptor() {
  const frozen = frozenQualifications('synthetic-proportional', RUNTIME, probe());
  return { id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity: RUNTIME, environment: null, settings: { ...settings },
    qualification: frozen.qualification, timingQualification: frozen.timingQualification, evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] };
}
function legacy() {
  const f = descriptor(); delete f.resourcePolicy;
  return { ...f, id: 'short-sdr-range-flac-v1', budget: { ...LEGACY_BUDGET }, executionBudgetMs: 60000 };
}
function fixture({ duration = 150, range = { startUs: 121000000, endUs: 141000000 }, mutate = () => {}, families = [descriptor()], legacyMode = false } = {}) {
  const source = probe(duration); mutate(source);
  const identity = { canonicalPath: path.resolve('/synthetic-proportional/input.mov'), dev: '1', ino: '2', size: source.format.size,
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range, resolution: 'source', audioPolicy: 'precision-flac' } });
  const plan = buildEncodeOperation({ input: identity.canonicalPath, output: path.resolve('/synthetic-proportional/output.mkv'), settings,
    inspection: { probe: source, color: classifyColor(source), duration }, request, runtimeIdentity: RUNTIME });
  const bindings = { plan, settings, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME,
    environment: null, budget: legacyMode ? { ...LEGACY_BUDGET } : null, executionBudgetMs: legacyMode ? 60000 : 120000 };
  const selector = new OperationFamilySelector({ families, policyIdentity: 'synthetic-proportional-policy' });
  return { source, plan, bindings, selector };
}
const choose = h => { const token = h.selector.select(h.bindings); return { token, result: h.selector.requireCurrent(token, h.bindings) }; };
const required = action => assert.throws(action, { code: 'OPERATION_QUALIFICATION_REQUIRED' });
function receipt(h, duration = 150) {
  return { schema: 1, status: 'completed', runtimeIdentity: RUNTIME, planFingerprint: h.plan.planFingerprint,
    sourcePath: h.bindings.sourceIdentity.canonicalPath, completeSource: { video: { frames: duration * 30,
      firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, maximumNominalCadenceErrorUs: 0,
      maximumNominalDurationErrorUs: 0, maximumNominalPhaseErrorUs: 0,
      properties: { policy: FAMILY_ID, sampleAspectRatio: '1:1', chromaLocation: 'left', sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: duration * 30 } },
    audio: [{ inputIndex: 1, sampleCount: String(duration * 48000), firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, gaps: 0 }] } };
}
test('genuine late, long, open-ended and independent ranges fund complete-source decoding', () => {
  for (const [duration, range, selectedExtentUs] of [[150, { startUs: 121000000, endUs: 141000000 }, 20000000],
    [150, { startUs: 100000000, endUs: 140000000 }, 40000000], [150, { startUs: 130000000 }, 20000000],
    [11, { startUs: 413000, endUs: 8621000 }, 8208000]]) {
    const h = fixture({ duration, range }), { result } = choose(h);
    const expected = deriveCfrFlacResources({ sourceExtentUs: duration * 1000000, selectedExtentUs, sourceBytes: h.bindings.sourceIdentity.size });
    assert.equal(result.proportional, true); assert.equal(isProportionalFamilySelection(result, h.plan), true);
    assert.deepEqual(result.budget, expected.budget); assert.deepEqual(result.resources, expected.resources);
    assert.equal(result.executionBudgetMs, expected.executionBudgetMs); assert.equal(result.resourcePolicy, RESOURCE_POLICY);
    assert.deepEqual(result.sourcePolicy, { id: FAMILY_ID, rate: 30, maximumExtentUs: duration * 1000000 });
    assert.ok(Object.isFrozen(result.resources)); assert.ok(Object.isFrozen(result.budget));
  }
});
test('complete source maximum includes audio/container tails and rounds upward exactly', () => {
  for (const duration of ['150.000001', '150.0000001']) {
    const h = fixture({ mutate: p => { p.format.duration = duration; } });
    const { result } = choose(h);
    assert.equal(result.sourcePolicy.maximumExtentUs, 150000001);
    assert.deepEqual(result.resources, deriveCfrFlacResources({ sourceExtentUs: 150000001, selectedExtentUs: 20000000, sourceBytes: '100000000' }).resources);
  }
});
test('core proportional family requires its measured clocks without a composition wrapper', () => {
  for (const [index, tick] of [[0, 30000], [1, 96000]]) {
    const h = fixture({ mutate: p => {
      p.streams[index].time_base = `1/${tick}`;
      p.streams[index].duration_ts = 150 * tick;
    } });
    assert.throws(() => choose(h), { code: 'OPERATION_QUALIFICATION_REQUIRED', message: /measured.*clocks/ });
  }
});
test('family schema admits only exact policy/CPU/provenance and refuses hostile records', () => {
  for (const mutate of [f => { f.resourcePolicy = 'other'; }, f => { f.id = 'cfr-sdr-range-resize-flac-v1'; },
    f => { f.budget = LEGACY_BUDGET; }, f => { f.resources = {}; }, f => { delete f.resourcePolicy; },
    f => { f.settings = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 }; },
    f => { f.qualification.tolerances.sampleCount = 1; }, f => { f.qualification.containerDuration = 'span'; },
    f => { f.timingQualification.aac = {}; }, f => { f.evidenceIds = []; },
    f => Object.defineProperty(f, 'id', { get() { assert.fail('No getter execution'); }, enumerable: true })]) {
    const f = descriptor(); mutate(f);
    assert.throws(() => new OperationFamilySelector({ families: [f], policyIdentity: 'test' }), { code: 'INVALID_OPERATION_QUALIFICATION' });
  }
});
test('no unqualified geometry, rate, clock shape, format, audio or overridden budget is admitted', () => {
  for (const mutate of [p => { p.streams[0].width = 1920; p.streams[0].height = 1080; },
    p => { p.streams[0].avg_frame_rate = p.streams[0].r_frame_rate = '60/1'; },
    p => { p.format.tags.major_brand = 'mp42'; }, p => { p.streams[1].sample_rate = '44100'; },
    p => { p.format.size = String(Number.MAX_SAFE_INTEGER); }]) {
    const h = fixture({ mutate }); required(() => choose(h));
  }
  const h = fixture(); required(() => h.selector.select({ ...h.bindings, budget: LEGACY_BUDGET }));
  required(() => h.selector.select({ ...h.bindings, executionBudgetMs: 0 }));
  required(() => choose(fixture({ duration: 200000, range: { startUs: 1000000, endUs: 2000000 } })));
});
test('whole-source actual bytes and every retained identity binding remain current', () => {
  const h = fixture(), { token } = choose(h);
  for (const [key, value] of Object.entries({ ino: '3', size: '100000001', mtimeNs: '1002', sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` })) {
    assert.throws(() => h.selector.requireCurrent(token, { ...h.bindings, sourceIdentity: { ...h.bindings.sourceIdentity, [key]: value } }), { code: 'OPERATION_QUALIFICATION_STALE' });
  }
  for (const patch of [{ executionBudgetMs: 120001 }, { budget: LEGACY_BUDGET }, { runtimeIdentity: 'c'.repeat(64) },
    { sourceProbeFingerprint: 'c'.repeat(64) }, { settings: { ...settings, quality: 26 } }]) {
    assert.throws(() => h.selector.requireCurrent(token, { ...h.bindings, ...patch }));
  }
  const other = fixture(); assert.throws(() => h.selector.requireCurrent(token, other.bindings), { code: 'OPERATION_QUALIFICATION_STALE' });
  assert.throws(() => other.selector.requireCurrent(token, h.bindings), { code: 'OPERATION_QUALIFICATION_STALE' });
  assert.throws(() => h.selector.select({ ...h.bindings, plan: structuredClone(h.plan) }), { code: 'INVALID_ENCODE_OPERATION' });
});
test('private result brand rejects clones, flags, borrowing and invalidated epochs', () => {
  const h = fixture(), { result, token } = choose(h), other = fixture();
  for (const fake of [{ proportional: true }, { ...result }, structuredClone(result), JSON.parse(JSON.stringify(result)), Object.create(result), {}, null]) {
    assert.equal(isProportionalFamilySelection(fake), false);
    if (fake?.proportional) assert.throws(() => operationCostLimits({ operationPlan: h.plan }, fake), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  }
  assert.equal(isProportionalFamilySelection(result, other.plan), false);
  assert.throws(() => operationCostLimits({ operationPlan: other.plan }, result), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  h.selector.invalidate('synthetic policy changed'); assert.equal(isProportionalFamilySelection(result), false);
  assert.throws(() => operationCostLimits({ operationPlan: h.plan }, result), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  assert.throws(() => h.selector.requireCurrent(token, h.bindings), { code: 'OPERATION_QUALIFICATION_STALE' });
});
test('descriptor snapshots are immutable and hostile binding/claim getters never execute', () => {
  const retained = descriptor(), h = fixture({ families: [retained] });
  retained.resourcePolicy = 'changed'; retained.settings.quality = 26;
  retained.qualification.tolerances.sampleCount = 100;
  const { result } = choose(h); assert.equal(result.qualification.tolerances.sampleCount, 0);
  let calls = 0;
  const hostile = { ...h.bindings };
  Object.defineProperty(hostile, 'runtimeIdentity', { enumerable: true, get() { calls++; return RUNTIME; } });
  required(() => h.selector.select(hostile));
  const identity = { ...h.bindings.sourceIdentity };
  Object.defineProperty(identity, 'ino', { enumerable: true, get() { calls++; return '2'; } });
  required(() => h.selector.select({ ...h.bindings, sourceIdentity: identity }));
  const claim = Object.defineProperty({}, 'proportional', { get() { calls++; return true; } });
  assert.throws(() => operationCostLimits({ operationPlan: h.plan }, claim), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  assert.equal(calls, 0);
});
test('legacy range/size/duration/fixed-budget bounds survive and overlap is ambiguous', () => {
  const options = { duration: 20, range: { startUs: 1000000, endUs: 3000000 }, families: [legacy()], legacyMode: true };
  const h = fixture(options), { result } = choose(h); assert.equal(isProportionalFamilySelection(result), false);
  assert.deepEqual(result.budget, LEGACY_BUDGET); assert.equal(result.executionBudgetMs, 60000);
  for (const patch of [{ duration: 150 }, { duration: 120, range: { startUs: 1000000, endUs: 32000000 } },
    { mutate: p => { p.format.size = String(512 * 1024 * 1024 + 1); } }]) required(() => choose(fixture({ ...options, ...patch })));
  required(() => h.selector.select({ ...h.bindings, budget: { ...LEGACY_BUDGET, maxRecords: 501 } }));
  const overlap = fixture({ ...options, families: [legacy(), descriptor()] });
  assert.throws(() => choose(overlap), { code: 'OPERATION_FAMILY_AMBIGUOUS' });
});
test('complete-source verification rejects truncated, forged, drifted and mismatched evidence', () => {
  const h = fixture(), { token } = choose(h), good = receipt(h);
  assert.equal(h.selector.verifyCollectedSource(token, good), true);
  for (const mutate of [e => { e.planFingerprint = 'c'.repeat(64); }, e => { e.runtimeIdentity = 'c'.repeat(64); },
    e => { e.sourcePath += '.other'; }, e => { e.completeSource.video.properties.policy = 'short-sdr-range-flac-v1'; },
    e => { e.completeSource.video.properties.framesChecked--; }, e => { e.completeSource.video.maximumNominalPhaseErrorUs = 100; },
    e => { e.completeSource.audio[0].gaps = 1; }, e => { e.completeSource.audio[0].inputIndex = 2; },
    e => { e.completeSource.audio[0].sampleCount = '7200001'; }, e => { e.completeSource.video.frames = 4501; }]) {
    const e = structuredClone(good); mutate(e);
    assert.throws(() => h.selector.verifyCollectedSource(token, e), { code: 'OPERATION_SOURCE_FAMILY_MISMATCH' });
  }
  assert.throws(() => h.selector.verifyCollectedSource(token, receipt(h, 20)), { code: 'OPERATION_SOURCE_FAMILY_MISMATCH' });
});
test('only current branded matching encode selection routes derived limits; remux/HDR/ordinary remain separate', () => {
  const h = fixture(), { result } = choose(h);
  assert.deepEqual(operationCostLimits({ operationPlan: h.plan }, result), { ...result.resources, executionBudgetMs: result.executionBudgetMs });
  for (const patch of [{ remux: true }, { hdr: true }]) assert.throws(() => operationCostLimits({ operationPlan: h.plan, ...patch }, result), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  assert.throws(() => operationCostLimits({}, result), { code: 'OPERATION_PROPORTIONAL_BUDGET' });
  assert.equal(operationCostLimits({}, null).pipeBytes, 256 * 1024 * 1024);
  const remux = { remux: true, resources: { pipeBytes: 123 }, executionBudgetMs: 456 };
  assert.deepEqual(operationCostLimits({ remux: true }, remux), { pipeBytes: 123, executionBudgetMs: 456 });
  const source = fs.readFileSync(path.join(__dirname, '../src/encoder-service.cjs'), 'utf8');
  assertQualificationCostOrdering(source);
  assert.match(source, /maxBytes: costLimits\.telemetryBytes \?\? 4 \* 1024 \* 1024, maxRecords: costLimits\.telemetryRecords \?\? 20000/);
});
// Structural wiring check, supplementary to the genuine selector/cost behavior above.
// The ordinary guard deliberately executes between qualification and cost derivation.
function assertQualificationCostOrdering(source) {
  const start = source.indexOf('const qualified = requireQualification();');
  const end = source.indexOf('const costLimits = operationCostLimits(entry, qualified);', start);
  assert(start >= 0 && end > start && end - start < 1600, 'Current qualification must feed bounded downstream cost derivation');
  const between = source.slice(start, end);
  assert.match(between, /if \(this\.ordinaryJobGuard\) \{/);
  assert.match(between, /if \(qualified \|\| entry\.remux \|\| entry\.hdr \|\| entry\.vendor \|\| entry\.operationPlan\?\.compatibilityPath !== true\)/);
  assert.match(between, /ordinaryGuard = await this\.ordinaryJobGuard\(/);
  assert.match(between, /throw fail\('ORDINARY_GUARD_INVALID'/);
}
test('qualification/cost wiring check rejects removed qualification, wrong input and missing or misplaced ordinary guard', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/encoder-service.cjs'), 'utf8');
  assertQualificationCostOrdering(source);
  for (const [before, after] of [
    ['const qualified = requireQualification();', 'const qualified = null;'],
    ['operationCostLimits(entry, qualified)', 'operationCostLimits(entry, null)'],
    ['operationCostLimits(entry, qualified)', 'operationCostLimits(otherEntry, qualified)'],
    ['if (this.ordinaryJobGuard) {', 'if (false) {'],
    ['ordinaryGuard = await this.ordinaryJobGuard(', 'ordinaryGuard = fakeGuard('],
    ["throw fail('ORDINARY_GUARD_INVALID'", "throw fail('OTHER'"]
  ]) {
    const offset = source.indexOf('const qualified = requireQualification();');
    const tail = source.slice(offset);
    assert(tail.includes(before));
    assert.throws(() => assertQualificationCostOrdering(source.slice(0, offset) + tail.replace(before, after)), before);
  }
  const q = 'const qualified = requireQualification();';
  const c = 'const costLimits = operationCostLimits(entry, qualified);';
  assert.throws(() => assertQualificationCostOrdering(source.replace(q, q + '\n' + c).replace(c + '\n          let evidenceRemainingBytes', 'let evidenceRemainingBytes')));
});
test('unbranded proportional collector policy refuses before any runner call', async () => {
  const h = fixture(), { result } = choose(h); let calls = 0;
  await assert.rejects(collectOperationEvidence({ plan: h.plan, sourceProbe: h.source, outputProbe: {},
    sourcePath: h.bindings.sourceIdentity.canonicalPath, outputPath: path.resolve('/synthetic/output.mkv'), stageDirectory: path.resolve('/synthetic/evidence'),
    ffmpeg: path.resolve('/synthetic/ffmpeg'), ffprobe: path.resolve('/synthetic/ffprobe'), run: () => { calls++; assert.fail('No collector launch'); },
    signal: undefined, budget: result.budget, timingQualification: result.timingQualification, sourcePolicy: result.sourcePolicy }), /privately bound proportional FLAC policy/);
  assert.equal(calls, 0);
});

test('proportional collection preflight binds private selection, exact source and frozen evidence authority', () => {
  const { assertProportionalCollectionSelection } = require('../src/operation-family.cjs');
  const h = fixture(), { result } = choose(h);
  const request = { plan: h.plan, sourcePath: h.bindings.sourceIdentity.canonicalPath, sourceProbe: h.source,
    budget: result.budget, timingQualification: result.timingQualification, sourcePolicy: result.sourcePolicy };
  assert.deepEqual(assertProportionalCollectionSelection(result, request), h.bindings.sourceIdentity);
  const reject = (selection, changed = request) => assert.throws(() => assertProportionalCollectionSelection(selection, changed), { code: 'OPERATION_PROPORTIONAL_COLLECTION' });
  for (const forged of [{ ...result }, Object.create(result), {}, null]) reject(forged);
  reject(result, { ...request, plan: fixture().plan });
  reject(result, { ...request, sourcePath: request.sourcePath + '.other' });
  const changedProbe = structuredClone(h.source); changedProbe.format.duration = '149';
  reject(result, { ...request, sourceProbe: changedProbe });
  for (const key of ['budget', 'timingQualification', 'sourcePolicy']) reject(result, { ...request, [key]: { ...request[key] } });
  let getters = 0;
  for (const key of Object.keys(request)) { const hostile = { ...request }; Object.defineProperty(hostile, key, { enumerable: true, get() { getters++; return request[key]; } }); reject(result, hostile); }
  const hostileProbe = structuredClone(h.source); Object.defineProperty(hostileProbe.format, 'duration', { enumerable: true, get() { getters++; return '150'; } });
  reject(result, { ...request, sourceProbe: hostileProbe }); assert.equal(getters, 0);
  h.selector.invalidate('Synthetic collection revocation.'); reject(result);
});
