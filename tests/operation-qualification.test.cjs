'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationQualificationSelector } = require('../src/operation-qualification.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');

// Synthetic in-memory applicability fixtures only. These are not retained media,
// hardware observations, executable qualification or production catalog entries.
// No input/output/evidence files, application or child process are opened.
const clone = value => structuredClone(value);
const RUNTIME = 'a'.repeat(64);
const POLICY = 'synthetic-selector-policy-v1';
const DEVICE = { adapterIdentity: 'synthetic:nvidia:luid:1', driverVersion: 'synthetic-driver-1', runtimeVersion: 'synthetic-runtime-1' };
const SOURCE_IDENTITY = { canonicalPath: 'F:\\synthetic-fixture\\source.mov', dev: '1', ino: '2', size: '1000000',
  mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
const BUDGET = { sourceDecode: 'complete', timeoutMs: 1000, maxFrameBytes: 16384, maxPcmBytes: 1048576, maxRecords: 500, maxSpoolBytes: 65536 };
const DEFAULT_SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
function probe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '25/1', r_frame_rate: '25/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
    time_base: '1/1000', start_pts: 0, start_time: '0', duration_ts: 4000, duration: '4', tags: { rotate: '0' }, disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: '16',
    sample_rate: '48000', channels: 2, channel_layout: 'stereo', time_base: '1/48000', start_pts: 0, start_time: '0',
    duration_ts: 192000, duration: '4', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '4', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 },
  programs: [], stream_groups: [], chapters: [] };
}
function fixture({ config = DEFAULT_SETTINGS, overrides = {}, ordinary = false, fileId = 'synthetic-file', draftRevision = 1, inputPath } = {}) {
  const source = probe(), request = resolveFileRequest({ fileId, identityRevision: 1, draftRevision, operation: 'encode',
    overrides: ordinary ? overrides : { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-aac', ...overrides } });
  const plan = buildEncodeOperation({ input: inputPath ?? SOURCE_IDENTITY.canonicalPath, output: 'F:\\synthetic-owned\\output.mkv',
    settings: config, inspection: { probe: source, color: classifyColor(source), duration: 4 }, request, runtimeIdentity: RUNTIME });
  const environment = config.profileId.endsWith('-nvidia') ? clone(DEVICE) : null;
  const scope = Object.fromEntries(['range', 'resolution', 'target', 'hdrPolicy', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'].map(key => [key, clone(request[key])]));
  const cell = { evidenceIds: ['synthetic-endpoint', 'synthetic-interior'], runtimeIdentity: RUNTIME,
    sourceIdentity: clone(SOURCE_IDENTITY), sourceProbeFingerprint: fingerprintEncodeSource(source), settings: clone(config), request: scope,
    qualification: { evidenceId: 'synthetic-endpoint', runtimeIdentity: RUNTIME, containerDuration: 'end-timestamp',
      tolerances: { videoTimestampUs: 1000, audioTimestampUs: 1000, avSyncUs: 2000, durationUs: 1000, sampleCount: 1024 } },
    timingQualification: { evidenceId: 'synthetic-interior', runtimeIdentity: RUNTIME, videoDurationUs: 1000, audioTimelineUs: 1000,
      aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } }, budget: clone(BUDGET), environment };
  const bindings = { plan, settings: clone(config), sourceIdentity: clone(SOURCE_IDENTITY), sourceProbeFingerprint: fingerprintEncodeSource(source),
    runtimeIdentity: RUNTIME, environment: clone(environment), budget: clone(BUDGET), executionBudgetMs: 60000 };
  return { plan, cell, bindings, selector: new OperationQualificationSelector({ cells: [cell], policyIdentity: POLICY }) };
}
const rejects = (action, code) => assert.throws(action, error => error.code === code);
const required = action => rejects(action, 'OPERATION_QUALIFICATION_REQUIRED');
const stale = action => rejects(action, 'OPERATION_QUALIFICATION_STALE');
const invalid = action => rejects(action, 'INVALID_OPERATION_QUALIFICATION');

test('genuine ordinary compatibility needs no new evidence, source reads or execution budget', () => {
  const { plan } = fixture({ ordinary: true });
  const selector = new OperationQualificationSelector({ policyIdentity: POLICY });
  assert.equal(plan.compatibilityPath, true);
  assert.equal(selector.select({ plan }), null);
  rejects(() => selector.select({ plan: clone(plan) }), 'INVALID_ENCODE_OPERATION');
});

test('an empty default catalog refuses changed operations', () => {
  const { bindings } = fixture();
  const selector = new OperationQualificationSelector({ policyIdentity: POLICY });
  required(() => selector.select(bindings));
});

test('an exact synthetic cell selects immutable private collection and validation policy', () => {
  const { selector, bindings, cell } = fixture(), selection = selector.select(bindings);
  assert.ok(Object.isFrozen(selection));
  assert.deepEqual(Object.keys(selection), []);
  const result = selector.requireCurrent(selection, bindings);
  assert.deepEqual(result, { qualification: cell.qualification, timingQualification: cell.timingQualification, budget: cell.budget,
    evidenceIds: cell.evidenceIds, executionBudgetMs: bindings.executionBudgetMs, policyIdentity: POLICY });
  for (const value of [result, result.qualification, result.qualification.tolerances, result.timingQualification, result.timingQualification.aac, result.budget, result.evidenceIds]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { result.qualification.tolerances.sampleCount++; }, TypeError);
  stale(() => selector.requireCurrent(clone(selection), bindings));
  stale(() => new OperationQualificationSelector({ cells: [cell], policyIdentity: POLICY }).requireCurrent(selection, bindings));
});

test('catalog inputs are independently copied and cannot widen issued policy', () => {
  const { selector, bindings, cell } = fixture();
  cell.settings.quality++; cell.request.range.endUs++; cell.sourceIdentity.ctimeNs = '999'; cell.budget.maxRecords++;
  cell.qualification.tolerances.sampleCount++; cell.evidenceIds.push('synthetic-later');
  const result = selector.requireCurrent(selector.select(bindings), bindings);
  assert.equal(result.budget.maxRecords, BUDGET.maxRecords);
  assert.equal(result.qualification.tolerances.sampleCount, 1024);
  assert.deepEqual(result.evidenceIds, ['synthetic-endpoint', 'synthetic-interior']);
});

test('source scope requires every strict stamp field and exact sparse digest, not media dimensions', () => {
  const { selector, bindings } = fixture();
  for (const [field, value] of Object.entries({ dev: '3', ino: '3', size: '1000001',
    mtimeNs: '1002', ctimeNs: '1002', birthtimeNs: '901', sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` })) {
    required(() => selector.select({ ...bindings, sourceIdentity: { ...bindings.sourceIdentity, [field]: value } }));
  }
  const incomplete = clone(bindings.sourceIdentity); delete incomplete.sparseDigest;
  required(() => selector.select({ ...bindings, sourceIdentity: incomplete }));
  rejects(() => selector.select({ ...bindings, sourceIdentity: { ...bindings.sourceIdentity, canonicalPath: 'F:\\other\\source.mov' } }), 'INVALID_ENCODE_OPERATION');
});

test('builder-private settings and normalized probe evidence must describe the supplied plan', () => {
  const { selector, bindings } = fixture();
  rejects(() => selector.select({ ...bindings, settings: { ...bindings.settings, quality: 24 } }), 'INVALID_ENCODE_OPERATION');
  rejects(() => selector.select({ ...bindings, sourceProbeFingerprint: 'd'.repeat(64) }), 'INVALID_ENCODE_OPERATION');
  const reordered = { quality: 25, preset: 'slow', profileId: 'h265-cpu' };
  assert.ok(selector.select({ ...bindings, settings: reordered }));
  rejects(() => selector.select({ ...bindings, plan: clone(bindings.plan) }), 'INVALID_ENCODE_OPERATION');
});

test('the exact source identity must name the builder-private input even when probe and settings match', () => {
  const first = fixture(), otherInput = fixture({ inputPath: 'F:\\synthetic-other\\same-probe.mov' });
  assert.equal(otherInput.bindings.sourceProbeFingerprint, first.bindings.sourceProbeFingerprint);
  assert.deepEqual(otherInput.bindings.settings, first.bindings.settings);
  rejects(() => first.selector.select(otherInput.bindings), 'INVALID_ENCODE_OPERATION');
  const selection = first.selector.select(first.bindings);
  rejects(() => first.selector.requireCurrent(selection, otherInput.bindings), 'INVALID_ENCODE_OPERATION');
});

test('exact meaningful scope excludes other ranges, geometry, audio modes and bitrate overrides', () => {
  const base = fixture();
  for (const overrides of [{ range: { startUs: 0, endUs: 2000000 } }, { range: { startUs: 1000000 } },
    { range: null }, { resolution: '720' }, { hdrPolicy: 'sdr' }, { audioPolicy: 'precision-flac' }, { aacBitrateKbps: 192 }]) {
    const other = fixture({ overrides });
    required(() => base.selector.select(other.bindings));
  }
});

test('transient file and draft labels do not widen scope or allow selection reuse for another plan', () => {
  const first = fixture(), other = fixture({ fileId: 'synthetic-other-file', draftRevision: 4 });
  assert.ok(first.selector.select(other.bindings));
  const selection = first.selector.select(first.bindings);
  stale(() => first.selector.requireCurrent(selection, other.bindings));
  const rebuilt = fixture();
  assert.equal(rebuilt.plan.planFingerprint, first.plan.planFingerprint);
  stale(() => first.selector.requireCurrent(selection, rebuilt.bindings));
});

test('complete bounded budgets must match exactly at selection and cannot grow after admission', () => {
  const { selector, bindings } = fixture(), selection = selector.select(bindings);
  for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']) {
    required(() => selector.select({ ...bindings, budget: { ...bindings.budget, [key]: bindings.budget[key] + 1 } }));
    required(() => selector.select({ ...bindings, budget: { ...bindings.budget, [key]: bindings.budget[key] - 1 } }));
    stale(() => selector.requireCurrent(selection, { ...bindings, budget: { ...bindings.budget, [key]: bindings.budget[key] + 1 } }));
  }
  for (const budget of [undefined, null, { ...BUDGET, sourceDecode: 'sampled' }, { ...BUDGET, timeoutMs: 0 },
    { ...BUDGET, timeoutMs: 2147483648 }, { ...BUDGET, maxRecords: Infinity }, { ...BUDGET, maxPcmBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...BUDGET, extra: 1 }]) {
    required(() => selector.select({ ...bindings, budget }));
  }
  const incomplete = clone(BUDGET); delete incomplete.maxSpoolBytes;
  required(() => selector.select({ ...bindings, budget: incomplete }));
});

test('execution duration is bounded and immutable while preview and queue time consume none of it', t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const { selector, bindings } = fixture(); bindings.executionBudgetMs = 1100;
  const selection = selector.select(bindings);
  for (const executionBudgetMs of [undefined, null, Infinity, NaN, 1099.5, Number.MAX_SAFE_INTEGER + 1, 1800001, 0, -1]) required(() => selector.select({ ...bindings, executionBudgetMs }));
  for (const executionBudgetMs of [1099, 1101]) stale(() => selector.requireCurrent(selection, { ...bindings, executionBudgetMs }));
  required(() => selector.select({ ...bindings, deadline: 1200 }));
  now = 86400000;
  assert.equal(selector.requireCurrent(selection, bindings).executionBudgetMs, 1100);
  assert.ok(selector.select(bindings));
});

test('runtime mismatches and selector invalidation revoke existing selections', () => {
  const { selector, bindings } = fixture(), selection = selector.select(bindings);
  required(() => selector.select({ ...bindings, runtimeIdentity: 'e'.repeat(64) }));
  stale(() => selector.requireCurrent(selection, { ...bindings, runtimeIdentity: 'e'.repeat(64) }));
  selector.invalidate('synthetic evidence policy changed');
  stale(() => selector.requireCurrent(selection, bindings));
  assert.ok(selector.requireCurrent(selector.select(bindings), bindings));
  invalid(() => selector.invalidate(''));
});

test('GPU cells require exact observed adapter, driver and runtime identities', () => {
  const gpu = fixture({ config: { profileId: 'h264-nvidia', preset: 'p5', quality: 28 } });
  for (const environment of [null, undefined, { ...DEVICE, driverVersion: 'unknown' }, { ...DEVICE, adapterIdentity: '' }]) {
    invalid(() => new OperationQualificationSelector({ cells: [{ ...gpu.cell, environment }], policyIdentity: POLICY }));
  }
  const selection = gpu.selector.select(gpu.bindings);
  for (const field of ['adapterIdentity', 'driverVersion', 'runtimeVersion']) {
    const environment = { ...DEVICE, [field]: `${DEVICE[field]}-changed` };
    required(() => gpu.selector.select({ ...gpu.bindings, environment }));
    stale(() => gpu.selector.requireCurrent(selection, { ...gpu.bindings, environment }));
  }
  required(() => gpu.selector.select({ ...gpu.bindings, environment: null }));
});

test('a retained-shaped synthetic five-profile catalog refuses SVT and every unmeasured settings tuple', () => {
  const profiles = [{ profileId: 'h264-cpu', preset: 'slower', quality: 24 }, DEFAULT_SETTINGS,
    { profileId: 'h264-nvidia', preset: 'p5', quality: 28 }, { profileId: 'h265-nvidia', preset: 'p5', quality: 25 },
    { profileId: 'av1-nvidia', preset: 'p5', quality: 30 }];
  const fixtures = profiles.flatMap(config => ['precision-aac', 'precision-flac'].map(audioPolicy => fixture({ config, overrides: { audioPolicy } })));
  const selector = new OperationQualificationSelector({ cells: fixtures.map(item => item.cell), policyIdentity: POLICY });
  for (const item of fixtures) assert.ok(selector.select(item.bindings));
  required(() => selector.select(fixture({ config: { profileId: 'av1-cpu', preset: '6', quality: 32 } }).bindings));
  required(() => selector.select(fixture({ config: { ...DEFAULT_SETTINGS, quality: 24 } }).bindings));
  required(() => selector.select(fixture({ config: { ...DEFAULT_SETTINGS, preset: 'medium' } }).bindings));
});

test('catalog schema rejects incomplete evidence, wildcard source/settings, omissions and ambiguous cells', () => {
  const { cell } = fixture();
  const construct = change => new OperationQualificationSelector({ cells: [{ ...clone(cell), ...change }], policyIdentity: POLICY });
  for (const change of [{ evidenceIds: [] }, { evidenceIds: ['synthetic-endpoint'] }, { evidenceIds: ['synthetic-endpoint', 'synthetic-endpoint'] },
    { runtimeIdentity: 'version-label-only' }, { sourceIdentity: { canonicalPath: SOURCE_IDENTITY.canonicalPath } },
    { sourceProbeFingerprint: '*' }, { settings: { ...DEFAULT_SETTINGS, recipeId: 'archive-quality-hevc-v1' } },
    { request: { ...cell.request, omissionRequestIds: ['synthetic-omission'] } }, { request: { ...cell.request, target: 'mp4' } },
    { budget: { ...BUDGET, sourceDecode: 'partial' } }, { qualification: { ...cell.qualification, runtimeIdentity: 'f'.repeat(64) } },
    { timingQualification: { ...cell.timingQualification, aac: null } }, { qualification: { ...cell.qualification, tolerances: { ...cell.qualification.tolerances, durationUs: 1000001 } } },
    { argv: ['-y'] }]) invalid(() => construct(change));
  invalid(() => new OperationQualificationSelector({ cells: [cell, clone(cell)], policyIdentity: POLICY }));
  invalid(() => new OperationQualificationSelector({ cells: new Array(1), policyIdentity: POLICY }));
  invalid(() => new OperationQualificationSelector({ cells: [cell], policyIdentity: '' }));
});

test('unsupported records and accessors cannot introduce authority or run during validation', () => {
  const { selector, bindings, cell } = fixture();
  let reads = 0;
  const badSettings = { ...DEFAULT_SETTINGS };
  Object.defineProperty(badSettings, 'quality', { enumerable: true, get() { reads++; return 25; } });
  required(() => selector.select({ ...bindings, settings: badSettings }));
  required(() => selector.select({ ...bindings, qualification: cell.qualification }));
  const sparseIds = new Array(1);
  invalid(() => new OperationQualificationSelector({ cells: [{ ...cell, evidenceIds: sparseIds }], policyIdentity: POLICY }));
  assert.equal(reads, 0);
});

test('all immutable admission bindings are rechecked before consuming evidence', () => {
  const { selector, bindings } = fixture(), selection = selector.select(bindings);
  stale(() => selector.requireCurrent(selection, { ...bindings, sourceIdentity: { ...bindings.sourceIdentity, ctimeNs: '1002' } }));
  stale(() => selector.requireCurrent(selection, { ...bindings, sourceIdentity: { ...bindings.sourceIdentity, sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` } }));
  rejects(() => selector.requireCurrent(selection, { ...bindings, settings: { ...bindings.settings, quality: 24 } }), 'INVALID_ENCODE_OPERATION');
  rejects(() => selector.requireCurrent(selection, { ...bindings, sourceProbeFingerprint: 'f'.repeat(64) }), 'INVALID_ENCODE_OPERATION');
  const incomplete = { ...bindings }; delete incomplete.sourceIdentity;
  stale(() => selector.requireCurrent(selection, incomplete));
  assert.ok(selector.requireCurrent(selection, bindings));
});
