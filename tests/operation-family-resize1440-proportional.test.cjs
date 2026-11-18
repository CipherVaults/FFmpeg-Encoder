'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { RESIZE_1440_FAMILY_ID: FAMILY_ID, RESIZE_1440_RESOURCE_POLICY: RESOURCE_POLICY, deriveCfrResize1440FlacResources } = require('../src/operation-resource-budget.cjs');
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
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 2560, height: 1440,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 }, side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0, displaymatrix: '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824' }] },
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
function fixture({ duration = 150, range = { startUs: 121000000, endUs: 141000000 }, mutate = () => {}, resolution = '720', families = [descriptor()], legacyMode = false } = {}) {
  const source = probe(duration); mutate(source);
  const identity = { canonicalPath: path.resolve('/synthetic-proportional/input.mov'), dev: '1', ino: '2', size: source.format.size,
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range, resolution, audioPolicy: 'precision-flac' } });
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
test('resize genuine late/nonaligned/open-end ranges use distinct complete-source resource formula', () => {
  for (const [duration, range] of [[150, { startUs: 100000000, endUs: 140000000 }], [150, { startUs: 130000000 }], [11, { startUs: 413000, endUs: 8621000 }]]) {
    const h = fixture({ duration, range }), { result, token } = choose(h);
    const span = h.plan.contract.range.resolved.endUs - h.plan.contract.range.resolved.startUs;
    const expected = deriveCfrResize1440FlacResources({ sourceExtentUs: duration * 1000000, selectedExtentUs: span, sourceBytes: h.bindings.sourceIdentity.size });
    assert.deepEqual(result.budget, expected.budget); assert.deepEqual(result.resources, expected.resources);
    assert.equal(result.executionBudgetMs, expected.executionBudgetMs); assert.equal(result.resourcePolicy, RESOURCE_POLICY);
    assert.equal(isProportionalFamilySelection(result, h.plan), true);
    assert.deepEqual(operationCostLimits({ operationPlan: h.plan }, result), { ...expected.resources, executionBudgetMs: expected.executionBudgetMs });
    assert.equal(h.selector.verifyCollectedSource(token, receipt(h, duration)), true);
    assert.equal(h.plan.contract.geometry.output.width, 1280); assert.equal(h.plan.contract.geometry.output.height, 720);
    const args = h.plan.args.join(' ');
    assert.match(args, /trim=start_pts=.*setpts=.*scale=w=1280:h=720:flags=lanczos\+accurate_rnd/);
    assert.match(args, /in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv/);
    assert.match(args, /setsar=sar=\(1\/1\)/); assert.doesNotMatch(args, /STARTPTS|crop=|fps=|yadif/);
  }
});
test('resize rejects unsupported envelope and resource capacity instead of borrowing Keep720', () => {
  for (const patch of [{ resolution: 'source' }, { range: null },
    { mutate: p => { p.streams[0].width = 1280; p.streams[0].height = 720; } },
    { mutate: p => { p.streams[0].width = 1920; p.streams[0].height = 1080; } },
    { mutate: p => { p.streams[0].avg_frame_rate = p.streams[0].r_frame_rate = '60/1'; } },
    { mutate: p => { p.streams[0].time_base = '1/30000'; p.streams[0].duration_ts = 4500000; } },
    { mutate: p => { p.streams[0].sample_aspect_ratio = '4:3'; } },
    { mutate: p => { p.streams[0].field_order = 'tt'; } },
    { mutate: p => { p.streams[0].side_data_list[0].rotation = 90; } },
    { mutate: p => { p.streams[1].codec_name = 'aac'; p.streams[1].sample_fmt = 'fltp'; } },
    { mutate: p => { p.streams[0].color_transfer = 'smpte2084'; } },
    { duration: 200000, range: { startUs: 0, endUs: 500000 } }]) assert.throws(() => choose(fixture(patch)));
  const f = descriptor(); f.resourcePolicy = 'cfr720p30-flac-resources-v1';
  assert.throws(() => fixture({ families: [f] }));
});
test('resize result cannot be forged, borrowed or kept current after epoch revocation', () => {
  const h = fixture(), other = fixture(), { result, token } = choose(h);
  assert.equal(isProportionalFamilySelection({ ...result }, h.plan), false);
  assert.throws(() => operationCostLimits({ operationPlan: other.plan }, result));
  const wrong = receipt(h); wrong.completeSource.video.properties.policy = 'cfr-sdr-range-flac-v2';
  assert.throws(() => h.selector.verifyCollectedSource(token, wrong));
  const truncated = receipt(h, 140); assert.throws(() => h.selector.verifyCollectedSource(token, truncated));
  h.selector.invalidate('Synthetic resize revocation'); assert.equal(isProportionalFamilySelection(result), false);
});
test('resize descriptor accessors do not execute and descriptor mutation does not change grants', () => {
  let reads = 0; const f = descriptor(); Object.defineProperty(f, 'id', { enumerable: true, get() { reads++; return FAMILY_ID; } });
  assert.throws(() => fixture({ families: [f] })); assert.equal(reads, 0);
  const retained = descriptor(), h = fixture({ families: [retained] }); retained.resourcePolicy = 'changed';
  assert.equal(choose(h).result.resourcePolicy, RESOURCE_POLICY);
});

test('absent orientation is qualified only by exact main-owned resize tuple, including long sources', () => {
  const source = probe(); delete source.streams[0].side_data_list;
  const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: { startUs: 130000000 }, resolution: '720', audioPolicy: 'precision-flac' } });
  const selector = new OperationFamilySelector({ families: [descriptor()], policyIdentity: 'synthetic-resize-only' });
  const options = { inspection: { probe: source, color: classifyColor(source), duration: 150 }, request, runtimeIdentity: RUNTIME, settings };
  const grant = selector.orientationQualification(options); assert.ok(grant.identityOrientationQualification);
  assert.deepEqual(selector.orientationQualification({ ...options, runtimeIdentity: 'c'.repeat(64) }), {});
  const other = structuredClone(request); other.resolution = 'source';
  assert.deepEqual(selector.orientationQualification({ ...options, request: other }), {});
  const malformed = structuredClone(source); malformed.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', rotation: 90, displaymatrix: 'bad' }];
  assert.deepEqual(selector.orientationQualification({ ...options, inspection: { ...options.inspection, probe: malformed } }), {});
  const plan = buildEncodeOperation({ ...options, ...grant, input: '/synthetic-proportional/input.mov', output: '/synthetic-proportional/out.mkv' });
  assert.equal(plan.contract.geometry.output.width, 1280);
});

test('1440 range authority never borrows 1080, Full1440 or caller-selected coefficients', () => {
  const budgets = require('../src/operation-resource-budget.cjs');
  const options = {sourceExtentUs:150000000,selectedExtentUs:40000000,sourceBytes:'100000000'};
  const high = deriveCfrResize1440FlacResources(options), low = budgets.deriveCfrResizeFlacResources(options);
  assert.equal(high.budget.timeoutMs-low.budget.timeoutMs, (150+40)*(6000-3375));
  assert.equal(high.executionBudgetMs-low.executionBudgetMs, 2*(150+40)*(6000-3375));
  assert.equal(high.budget.maxPcmBytes,low.budget.maxPcmBytes);
  for (const id of [budgets.RESIZE_FAMILY_ID,budgets.FULL_1440_RESIZE_FAMILY_ID]) {
    const f=descriptor();f.id=id;f.resourcePolicy=id===budgets.RESIZE_FAMILY_ID?budgets.RESIZE_RESOURCE_POLICY:budgets.FULL_1440_RESIZE_RESOURCE_POLICY;
    assert.throws(()=>choose(fixture({families:[f]})));
  }
  for (const change of [p=>{p.streams[0].width=3840;p.streams[0].height=2160;},
    p=>{p.streams[0].pix_fmt='yuv420p10le';},p=>{p.streams[0].color_primaries='bt2020';},
    p=>{p.streams[1].sample_rate='44100';},p=>{p.streams[1].channels=1;p.streams[1].channel_layout='mono';}]) assert.throws(()=>choose(fixture({mutate:change})));
  assert.throws(()=>choose(fixture({resolution:'2160'})));
  const h=fixture(), {token}=choose(h);
  assert.throws(()=>h.selector.requireCurrent(token,{...h.bindings,sourceIdentity:{...h.bindings.sourceIdentity,ino:'999'}}));
  assert.throws(()=>h.selector.requireCurrent(token,{...h.bindings,runtimeIdentity:'f'.repeat(64)}));
});
