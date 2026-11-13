'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');

// In-memory synthetic applicability and receipt records only. These deliberately
// small test policies are not production calibration, retained media, hardware
// observations, executable qualification or authorization to publish anything.
const clone = value => structuredClone(value);
const RUNTIME = 'a'.repeat(64), POLICY = 'synthetic-family-policy-v1';
const CPU = { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, NVIDIA = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 };
const DEVICE = { adapterIdentity: 'GPU-01234567-89ab-cdef-0123-456789abcdef', driverVersion: '581.80', runtimeVersion: `FFmpeg9.0.2:${RUNTIME}` };
const BUDGET = { sourceDecode: 'complete', timeoutMs: 1000, maxFrameBytes: 16384, maxPcmBytes: 1048576, maxRecords: 500, maxSpoolBytes: 65536 };
const SOURCE = { canonicalPath: 'F:\\synthetic-family\\input.mp4', dev: '1', ino: '2', size: '1000000',
  mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
function probe({ width = 1280, rate = 30, duration = 4, absent = false } = {}) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width, height: width === 1920 ? 1080 : 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: `${rate}/1`, r_frame_rate: `${rate}/1`,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/90000',
    start_pts: 0, start_time: '0', duration_ts: duration * 90000, duration: String(duration), disposition: { default: 1 }, ...(absent ? {} : { tags: { rotate: '0' } }) },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: duration * 48000, duration: String(duration), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration), start_time: '0', size: SOURCE.size,
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 }, programs: [], stream_groups: [], chapters: [] };
}
function family(config = CPU) {
  return { id: 'short-sdr-range-v1', evidenceIds: ['synthetic-family-endpoint', 'synthetic-family-interior'], runtimeIdentity: RUNTIME,
    environment: config.profileId === 'h265-nvidia' ? clone(DEVICE) : null, settings: clone(config),
    qualification: { evidenceId: 'synthetic-family-endpoint', runtimeIdentity: RUNTIME, containerDuration: 'end-timestamp',
      tolerances: { videoTimestampUs: 1000, audioTimestampUs: 1000, avSyncUs: 2000, durationUs: 1000, sampleCount: 1024 } },
    timingQualification: { evidenceId: 'synthetic-family-interior', runtimeIdentity: RUNTIME, videoDurationUs: 1000, audioTimelineUs: 1000,
      aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } }, budget: clone(BUDGET), executionBudgetMs: 60000 };
}
function fixture(options = {}) {
  const source = probe(options), config = options.config || CPU; options.mutate?.(source);
  const retained = options.families ? options.families[0] : family(config), selector = new OperationFamilySelector({ families: options.empty ? [] : options.families || [retained], policyIdentity: POLICY });
  const request = resolveFileRequest({ fileId: options.fileId || 'synthetic-file', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: options.ordinary ? {} : { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-aac', ...options.overrides } });
  const inspection = { probe: source, color: classifyColor(source), duration: Number(source.format.duration) };
  const orientation = selector.orientationQualification({ inspection, request, runtimeIdentity: RUNTIME, settings: config });
  const identity = { ...clone(SOURCE), ...options.identity };
  const plan = buildEncodeOperation({ input: identity.canonicalPath, output: 'F:\\synthetic-family-owned\\output.mkv', inspection, settings: config, request,
    runtimeIdentity: RUNTIME, ...orientation });
  const bindings = { plan, settings: clone(config), sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME,
    environment: config.profileId === 'h265-nvidia' ? clone(DEVICE) : null, budget: clone(BUDGET), executionBudgetMs: 60000 };
  return { source, inspection, request, plan, retained, selector, bindings, orientation };
}
function receipt(h, { rate = Number(h.source.streams[0].avg_frame_rate.split('/')[0]), duration = Number(h.source.format.duration) } = {}) {
  return { schema: 1, status: 'completed', runtimeIdentity: RUNTIME, planFingerprint: h.plan.planFingerprint,
    sourcePath: h.bindings.sourceIdentity.canonicalPath, completeSource: { video: { frames: duration * rate,
      firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, maximumNominalCadenceErrorUs: 0, maximumNominalDurationErrorUs: 0,
      maximumNominalPhaseErrorUs: 0, properties: { policy: h.policy || 'short-sdr-range-v1', sampleAspectRatio: '1:1', chromaLocation: 'left',
        sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: duration * rate } },
    audio: [{ inputIndex: 1, sampleCount: String(duration * 48000), firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, gaps: 0 }] } };
}
const rejects = (action, code) => assert.throws(action, error => error.code === code);
const required = action => rejects(action, 'OPERATION_QUALIFICATION_REQUIRED');
const stale = action => rejects(action, 'OPERATION_QUALIFICATION_STALE');
const invalid = action => rejects(action, 'INVALID_OPERATION_QUALIFICATION');
const badSource = action => rejects(action, 'OPERATION_SOURCE_FAMILY_MISMATCH');

test('empty catalogs refuse changed operations while genuine ordinary compatibility needs no new bindings', () => {
  const h = fixture({ empty: true }); required(() => h.selector.select(h.bindings));
  const ordinary = fixture({ ordinary: true, empty: true }); assert.equal(ordinary.selector.select({ plan: ordinary.plan }), null);
  rejects(() => ordinary.selector.select({ plan: clone(ordinary.plan) }), 'INVALID_ENCODE_OPERATION');
});

test('the finite720p/1080p30/60CPU/NVIDIA tuples admit collection with immutable retained policy', () => {
  for (const width of [1280, 1920]) for (const rate of [30, 60]) for (const config of [CPU, NVIDIA]) {
    for (const resolution of width === 1920 ? ['source', '720'] : ['source']) {
      const h = fixture({ width, rate, config, overrides: { resolution } }), selection = h.selector.select(h.bindings);
      const selected = h.selector.requireCurrent(selection, h.bindings);
      assert.deepEqual(selected, { qualification: h.retained.qualification, timingQualification: h.retained.timingQualification,
        budget: BUDGET, evidenceIds: h.retained.evidenceIds, executionBudgetMs: 60000, policyIdentity: POLICY,
        controlsRequired: true, sourcePolicy: { id: 'short-sdr-range-v1', rate, maximumExtentUs: 120000000 } });
      assert.ok(Object.isFrozen(selection)); assert.deepEqual(Object.keys(selection), []); assert.ok(Object.isFrozen(selected.sourcePolicy));
      assert.ok(Object.isFrozen(selected.qualification.tolerances)); assert.equal(h.selector.verifyCollectedSource(selection, receipt(h)), true);
    }
  }
});

test('a family covers a new matching source without manufacturing exact-source catalog records', () => {
  const first = fixture(), second = fixture({ identity: { canonicalPath: 'F:\\another-synthetic-family\\other.mp4', ino: '99', sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` }, fileId: 'other' });
  assert.ok(first.selector.select(second.bindings));
  const selection = first.selector.select(first.bindings);
  stale(() => first.selector.requireCurrent(selection, second.bindings));
  const sameSourceNewPlan = fixture(); stale(() => first.selector.requireCurrent(selection, sameSourceNewPlan.bindings));
  for (const token of [{}, clone(selection), null]) stale(() => first.selector.requireCurrent(token, first.bindings));
  stale(() => second.selector.requireCurrent(selection, first.bindings));
  invalid(() => new OperationFamilySelector({ families: [{ ...family(), sourceIdentity: SOURCE }], policyIdentity: POLICY }));
});

test('every current strict source stamp and sparse digest remain independently bound to the job', () => {
  const h = fixture(), selection = h.selector.select(h.bindings);
  for (const [key, value] of Object.entries({ dev: '3', ino: '4', mtimeNs: '1002', ctimeNs: '1003', birthtimeNs: '899', sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` })) {
    stale(() => h.selector.requireCurrent(selection, { ...h.bindings, sourceIdentity: { ...h.bindings.sourceIdentity, [key]: value } }));
  }
  required(() => h.selector.select({ ...h.bindings, sourceIdentity: { ...SOURCE, size: '1000001' } }));
  const missing = clone(SOURCE); delete missing.sparseDigest; required(() => h.selector.select({ ...h.bindings, sourceIdentity: missing }));
  rejects(() => h.selector.select({ ...h.bindings, sourceIdentity: { ...SOURCE, canonicalPath: 'F:\\wrong.mp4' } }), 'INVALID_ENCODE_OPERATION');
  rejects(() => h.selector.select({ ...h.bindings, sourceProbeFingerprint: 'c'.repeat(64) }), 'INVALID_ENCODE_OPERATION');
  rejects(() => h.selector.select({ ...h.bindings, plan: clone(h.plan) }), 'INVALID_ENCODE_OPERATION');
});

test('metadata predicates reject other codecs/profiles/rates/layouts/transports/starts/durations and byte extents', () => {
  const changes = [p => { p.streams[0].profile = 'Main'; }, p => { p.streams[0].codec_name = 'hevc'; p.streams[0].profile = 'Main'; },
    p => { p.streams[0].pix_fmt = 'yuv420p10le'; }, p => { p.streams[0].avg_frame_rate = '25/1'; p.streams[0].r_frame_rate = '25/1'; },
    p => { p.streams[0].avg_frame_rate = '30000/1001'; p.streams[0].r_frame_rate = '30000/1001'; }, p => { p.streams[0].r_frame_rate = '60/1'; },
    p => { p.streams[1].profile = 'HE-AAC'; }, p => { p.streams[1].sample_fmt = 's16p'; },
    p => { p.streams[1].sample_rate = '44100'; p.streams[1].time_base = '1/44100'; p.streams[1].duration_ts = 176400; },
    p => { p.format.format_name = 'matroska,webm'; }, p => { p.streams[0].start_pts = 90000; p.streams[0].start_time = '1'; },
    p => { p.streams[1].start_pts = 48000; p.streams[1].start_time = '1'; }, p => { p.format.start_time = '1'; },
    p => { delete p.format.size; }, p => { p.streams[0].field_order = 'tt'; }, p => { p.streams[0].width = 640; p.streams[0].height = 360; },
    p => { p.streams[0].chroma_location = 'center'; }, p => { delete p.streams[0].chroma_location; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Stereo 3D', type: 'side by side' }]; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Spherical Mapping', yaw: 0 }]; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Unknown future side data' }]; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }]; },
    p => { p.streams[1].side_data_list = [{ side_data_type: 'Replay Gain', track_gain: 0 }]; }];
  for (const mutate of changes) { const h = fixture({ mutate }); required(() => h.selector.select(h.bindings)); }
  const tooLong = fixture({ duration: 121 }); required(() => tooLong.selector.select(tooLong.bindings));
  const tooBig = fixture({ mutate: p => { p.format.size = String(512 * 1024 * 1024 + 1); }, identity: { size: String(512 * 1024 * 1024 + 1) } });
  required(() => tooBig.selector.select(tooBig.bindings));
  const exactByteLimit = fixture({ mutate: p => { p.format.size = String(512 * 1024 * 1024); }, identity: { size: String(512 * 1024 * 1024) } });
  assert.ok(exactByteLimit.selector.select(exactByteLimit.bindings));
});

test('source requests stay range-only,0.5–30s,Keep Source or1080→720 and layout-default precision AAC', () => {
  for (const overrides of [{ range: { startUs: 0, endUs: 499999 } }, { range: null }, { aacBitrateKbps: 320 }, { aacBitrateKbps: 192 }, { resolution: '1080' }]) {
    const h = fixture({ overrides }); required(() => h.selector.select(h.bindings));
  }
  const longRange = fixture({ duration: 40, overrides: { range: { startUs: 0, endUs: 30000001 } } }); required(() => longRange.selector.select(longRange.bindings));
  for (const range of [{ startUs: 0, endUs: 500000 }, { startUs: 1000000, endUs: 2000000 }]) {
    const h = fixture({ overrides: { range } }); assert.ok(h.selector.select(h.bindings));
  }
  const exact30 = fixture({ duration: 40, overrides: { range: { startUs: 0, endUs: 30000000 } } }); assert.ok(exact30.selector.select(exact30.bindings));
});

test('only exact measured HEVC settings, runtime, device and complete budgets apply', () => {
  const h = fixture(), selection = h.selector.select(h.bindings);
  for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']) {
    const changed = { ...h.bindings, budget: { ...BUDGET, [key]: BUDGET[key] + 1 } }; required(() => h.selector.select(changed)); stale(() => h.selector.requireCurrent(selection, changed));
  }
  for (const executionBudgetMs of [59999, 60001]) { required(() => h.selector.select({ ...h.bindings, executionBudgetMs })); stale(() => h.selector.requireCurrent(selection, { ...h.bindings, executionBudgetMs })); }
  required(() => h.selector.select({ ...h.bindings, environment: DEVICE }));
  required(() => h.selector.select({ ...h.bindings, runtimeIdentity: 'c'.repeat(64) }));
  for (const config of [{ ...CPU, quality: 24 }, { ...CPU, preset: 'medium' }, { profileId: 'h264-cpu', preset: 'slow', quality: 25 }]) {
    invalid(() => new OperationFamilySelector({ families: [family(config)], policyIdentity: POLICY }));
  }
  const gpu = fixture({ config: NVIDIA }), gpuSelection = gpu.selector.select(gpu.bindings);
  for (const environment of [null, { ...DEVICE, driverVersion: '582.10' }, { ...DEVICE, adapterIdentity: 'GPU-11234567-89ab-cdef-0123-456789abcdef' }]) {
    required(() => gpu.selector.select({ ...gpu.bindings, environment })); stale(() => gpu.selector.requireCurrent(gpuSelection, { ...gpu.bindings, environment }));
  }
});

test('family provenance and measured tolerances are immutable and duplicate/wildcard records fail closed', () => {
  const h = fixture(); h.retained.qualification.tolerances.durationUs = 999999; h.retained.budget.maxRecords++; h.retained.evidenceIds.push('later');
  const selected = h.selector.requireCurrent(h.selector.select(h.bindings), h.bindings);
  assert.equal(selected.qualification.tolerances.durationUs, 1000); assert.equal(selected.budget.maxRecords, 500); assert.equal(selected.evidenceIds.length, 2);
  invalid(() => new OperationFamilySelector({ families: [family(), family()], policyIdentity: POLICY }));
  for (const change of [{ id: '*' }, { evidenceIds: [] }, { evidenceIds: ['synthetic-family-endpoint'] }, { runtimeIdentity: '*' },
    { environment: DEVICE }, { environment: undefined }, { executionBudgetMs: 1800001 }, { timingQualification: { ...family().timingQualification, aac: null } },
    { budget: { ...BUDGET, sourceDecode: 'sampled' } }, { sourcePolicy: { id: '*' } }]) {
    invalid(() => new OperationFamilySelector({ families: [{ ...family(), ...change }], policyIdentity: POLICY }));
  }
  const selection = h.selector.select(h.bindings); h.selector.invalidate('Synthetic evidence policy changed.'); stale(() => h.selector.requireCurrent(selection, h.bindings));
  badSource(() => h.selector.verifyCollectedSource(selection, receipt(h))); invalid(() => h.selector.invalidate(''));
});

test('absent orientation gets source-bound interpretation only for matching1080→720 family resize', () => {
  const h = fixture({ width: 1920, absent: true, overrides: { resolution: '720' } });
  assert.deepEqual(h.orientation, { identityOrientationQualification: { evidenceId: 'synthetic-family-endpoint', runtimeIdentity: RUNTIME,
    sourceEvidenceFingerprint: fingerprintEncodeSource(h.source), videoIndex: 0 } });
  assert.ok(h.selector.select(h.bindings)); assert.equal(h.plan.expectedOutput.orientationQualification.sourceEvidenceFingerprint, fingerprintEncodeSource(h.source));
  const keep = fixture({ absent: true }); assert.deepEqual(keep.orientation, {}); assert.ok(keep.selector.select(keep.bindings));
  const reported = fixture({ width: 1920, overrides: { resolution: '720' } }); assert.deepEqual(reported.orientation, {});
  const request = h.request;
  for (const mutate of [p => { p.streams[0].tags = { rotate: '90' }; }, p => { p.streams[0].tags = { rotate: 'broken' }; },
    p => { p.streams[0].avg_frame_rate = '30000/1001'; }, p => { p.streams.push({ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }); },
    p => { p.chapters.push({ id: 0, time_base: '1/1000', start: 0, end: 1000 }); }, p => { p.format.nb_programs = 1; }]) {
    const source = probe({ width: 1920, absent: true }); mutate(source);
    assert.deepEqual(h.selector.orientationQualification({ inspection: { probe: source }, request, runtimeIdentity: RUNTIME, settings: CPU }), {});
  }
  assert.deepEqual(new OperationFamilySelector({ policyIdentity: POLICY }).orientationQualification({ inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU }), {});
});

test('resize diagnosis grants nothing and explains only a real downscale of absent orientation that no family admits', () => {
  const h = fixture({ width: 1920, absent: true, overrides: { resolution: '720' } });
  const explain = (request, { source = probe({ width: 1920, absent: true }), settings = CPU, selector = h.selector } = {}) =>
    selector.explainResize({ inspection: { probe: source }, request, runtimeIdentity: RUNTIME, settings });
  const ask = overrides => resolveFileRequest({ fileId: 'synthetic-file', identityRevision: 1, draftRevision: 1, operation: 'encode', overrides });
  const range = { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-aac' };
  // Nothing to explain: the admitted family route, Keep Source, a request that
  // already fits, and any file whose orientation is reported (even as zero).
  assert.equal(explain(h.request), null);
  assert.equal(explain(ask(range)), null);
  assert.equal(explain(ask({ resolution: '1080' })), null);
  assert.equal(explain(ask({ resolution: '2160', ...range })), null);
  assert.equal(explain(ask({ resolution: '720' }), { source: probe({ width: 1920 }) }), null);
  const matrix = probe({ width: 1920, absent: true }); matrix.streams[0].side_data_list = [{ side_data_type: 'Display Matrix' }];
  assert.equal(explain(ask({ resolution: '720' }), { source: matrix }), null);
  const cases = [
    [ask({ resolution: '720' }), {}, 'Only SDR Matroska range encoding with layout-default precision AAC and no omissions belongs to this family.'],
    [ask({ resolution: '720', audioPolicy: 'precision-aac' }), {}, 'A resolved bounded range is required.'],
    [h.request, { source: (() => { const p = probe({ width: 1920, absent: true }); p.streams[0].avg_frame_rate = '30000/1001'; return p; })() }, 'Only matching nominal and average 30/1 or 60/1 rates belong to this family.'],
    [h.request, { settings: NVIDIA }, 'No measured family exists for these encoder settings and this runtime.'],
    [h.request, { selector: new OperationFamilySelector({ policyIdentity: POLICY }) }, 'No measured family exists for these encoder settings and this runtime.'],
    [h.request, { settings: { profileId: 'h265-cpu', preset: 'not-a-preset', quality: 25 } }, 'The encoder settings are outside every measured family.'],
  ];
  for (const [request, options, reason] of cases) {
    const result = explain(request, options);
    assert.ok(Object.isFrozen(result)); assert.equal(result.code, 'OPERATION_RESIZE_UNQUALIFIED');
    assert.equal(result.message, `This resize has no measured qualification, so no plan was created. ${reason}`);
  }
  // The diagnosis is main-only plain data and refuses hidden or extra inputs without reading them.
  rejects(() => h.selector.explainResize({ inspection: h.inspection, request: h.request, runtimeIdentity: RUNTIME, settings: CPU, extra: 1 }), 'INVALID_OPERATION_QUALIFICATION');
  let read = false;
  const hidden = { probe: probe({ width: 1920, absent: true }) }; Object.defineProperty(hidden, 'trap', { get() { read = true; return 1; }, enumerable: true });
  rejects(() => h.selector.explainResize({ inspection: hidden, request: h.request, runtimeIdentity: RUNTIME, settings: CPU }), 'INVALID_OPERATION_QUALIFICATION');
  assert.equal(read, false);
});

test('orientation interpretation never walks the inspection of an unrelated ordinary request', () => {
  const h = fixture({ width: 1920, absent: true, overrides: { resolution: '720' } });
  let read = false;
  const hidden = { probe: probe({ width: 1920, absent: true }) }; Object.defineProperty(hidden, 'trap', { get() { read = true; return 1; }, enumerable: true });
  const keep = resolveFileRequest({ fileId: 'synthetic-file', identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: {} });
  assert.deepEqual(h.selector.orientationQualification({ inspection: hidden, request: keep, runtimeIdentity: RUNTIME, settings: CPU }), {});
  // A large but valid inspection no longer fails an ordinary request on the family's walk bound.
  const large = { probe: probe({ width: 1920, absent: true }), chapters: Array.from({ length: 40000 }, (_, id) => ({ id })) };
  assert.deepEqual(h.selector.orientationQualification({ inspection: large, request: keep, runtimeIdentity: RUNTIME, settings: CPU }), {});
  // The resize route still walks and refuses hidden data.
  rejects(() => h.selector.orientationQualification({ inspection: hidden, request: h.request, runtimeIdentity: RUNTIME, settings: CPU }), 'INVALID_OPERATION_QUALIFICATION');
  assert.equal(read, false);
  // A getter on the request's resolution itself is never called by either helper.
  let reads = 0;
  const request = { ...h.request }; Object.defineProperty(request, 'resolution', { enumerable: true, get() { reads++; return '720'; } });
  assert.deepEqual(h.selector.orientationQualification({ inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU }), {});
  assert.equal(h.selector.explainResize({ inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU }), null);
  assert.equal(reads, 0);
});

test('reported orientation must be explicit zero with an identity matrix and cannot conceal conflicting legacy data', () => {
  const displaymatrix = '00000000:        65536           0           0\n00000001:            0       65536           0\n00000002:            0           0  1073741824';
  const explicit = fixture({ mutate: p => { p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', displaymatrix, rotation: 0 }]; } });
  assert.ok(explicit.selector.select(explicit.bindings));
  for (const mutate of [p => { p.streams[0].tags.rotate = '90'; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', displaymatrix: displaymatrix.replace('65536', '-65536'), rotation: 0 }]; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', displaymatrix, rotation: 0, unqualified: true }]; },
    p => { p.streams[0].tags.rotate = '90'; p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', displaymatrix, rotation: 0 }]; }]) {
    const h = fixture({ mutate }); required(() => h.selector.select(h.bindings));
  }
  rejects(() => fixture({ mutate: p => { p.streams[0].tags.rotate = 'broken'; } }), 'ENCODE_ORIENTATION_UNQUALIFIED');
});

test('complete collected source verifies independently of metadata and refuses malformed or partial receipts', () => {
  const h = fixture(), selection = h.selector.select(h.bindings), full = receipt(h);
  assert.equal(h.selector.verifyCollectedSource(selection, full), true);
  for (const mutate of [r => { r.status = 'failed'; }, r => { r.runtimeIdentity = 'b'.repeat(64); }, r => { r.planFingerprint = 'b'.repeat(64); },
    r => { r.sourcePath = 'F:\\other.mp4'; }, r => { delete r.completeSource; }, r => { r.completeSource.video.frames = 0; },
    r => { r.completeSource.video.frames--; }, r => { r.completeSource.video.firstTime.n = '1'; },
    r => { r.completeSource.video.endTime = { n: '121', d: '1' }; }, r => { r.completeSource.video.endTime.d = '0'; },
    r => { r.completeSource.video.endTime.n = '1'.repeat(41); }, r => { r.completeSource.video.maximumNominalCadenceErrorUs = 12; },
    r => { r.completeSource.video.maximumNominalDurationErrorUs = 12; }, r => { r.completeSource.video.maximumNominalDurationErrorUs = 0.1; },
    r => { r.completeSource.video.maximumNominalPhaseErrorUs = 12; }, r => { delete r.completeSource.video.maximumNominalPhaseErrorUs; },
    r => { delete r.completeSource.video.properties; }, r => { r.completeSource.video.properties.sampleAspectRatio = '4:3'; },
    r => { r.completeSource.video.properties.chromaLocation = 'center'; }, r => { r.completeSource.video.properties.framesChecked--; },
    r => { r.completeSource.video.properties.sideDataPolicy = 'ignore-unknown'; }, r => { r.completeSource.video.properties.extra = true; },
    r => { r.completeSource.audio = []; }, r => { r.completeSource.audio.push(clone(r.completeSource.audio[0])); },
    r => { r.completeSource.audio[0].inputIndex = 9; }, r => { r.completeSource.audio[0].gaps = 1; },
    r => { r.completeSource.audio[0].firstTime.n = '-1'; }, r => { r.completeSource.audio[0].sampleCount = '191900'; },
    r => { r.completeSource.audio[0].sampleCount = '192000.0'; }, r => { r.completeSource.audio[0].endTime = { n: '121', d: '1' }; }]) {
    const changed = clone(full); mutate(changed); badSource(() => h.selector.verifyCollectedSource(selection, changed));
  }
  const oneTick = clone(full); oneTick.completeSource.video.endTime = { n: '360001', d: '90000' };
  oneTick.completeSource.video.maximumNominalCadenceErrorUs = 11; oneTick.completeSource.video.maximumNominalDurationErrorUs = 11;
  oneTick.completeSource.video.maximumNominalPhaseErrorUs = 11;
  assert.equal(h.selector.verifyCollectedSource(selection, oneTick), true);
  const endpoint = fixture({ duration: 120, rate: 60 }), endpointSelection = endpoint.selector.select(endpoint.bindings);
  assert.equal(endpoint.selector.verifyCollectedSource(endpointSelection, receipt(endpoint)), true);
});

test('accessors and hidden family authority are rejected before any getter runs', () => {
  let reads = 0; const retained = family(); Object.defineProperty(retained, 'runtimeIdentity', { enumerable: true, get() { reads++; return RUNTIME; } });
  invalid(() => new OperationFamilySelector({ families: [retained], policyIdentity: POLICY }));
  const h = fixture(), selection = h.selector.select(h.bindings), bound = { ...h.bindings };
  Object.defineProperty(bound, 'environment', { enumerable: true, get() { reads++; return null; } }); required(() => h.selector.select(bound));
  const source = receipt(h); Object.defineProperty(source.completeSource.video, 'frames', { enumerable: true, get() { reads++; return 120; } });
  badSource(() => h.selector.verifyCollectedSource(selection, source));
  const inspection = { get probe() { reads++; return h.source; } };
  // Q1a: an unrelated Keep Source request no longer walks the inspection at
  // all; the resize route still walks it and refuses the accessor unread.
  assert.deepEqual(h.selector.orientationQualification({ inspection, request: h.request, runtimeIdentity: RUNTIME, settings: CPU }), {});
  const resize = fixture({ width: 1920, absent: true, overrides: { resolution: '720' } });
  invalid(() => resize.selector.orientationQualification({ inspection, request: resize.request, runtimeIdentity: RUNTIME, settings: CPU }));
  assert.equal(reads, 0);
});

test('orientation provenance follows exact backend settings and never falls back to the first runtime family', () => {
  const h = fixture({ width: 1920, absent: true, overrides: { resolution: '720' } }), nv = family(NVIDIA);
  nv.evidenceIds = ['synthetic-nv-endpoint', 'synthetic-nv-interior']; nv.qualification.evidenceId = nv.evidenceIds[0]; nv.timingQualification.evidenceId = nv.evidenceIds[1];
  const selector = new OperationFamilySelector({ families: [family(CPU), nv], policyIdentity: POLICY });
  const options = { inspection: h.inspection, request: h.request, runtimeIdentity: RUNTIME, settings: NVIDIA };
  assert.equal(selector.orientationQualification(options).identityOrientationQualification.evidenceId, 'synthetic-nv-endpoint');
  assert.equal(selector.orientationQualification({ ...options, settings: CPU }).identityOrientationQualification.evidenceId, 'synthetic-family-endpoint');
  assert.deepEqual(h.selector.orientationQualification(options), {});
  assert.deepEqual(selector.orientationQualification({ ...options, settings: { profileId: 'h264-cpu', preset: 'slower', quality: 24 } }), {});
  assert.deepEqual(selector.orientationQualification({ ...options, settings: { profileId: 'h265-nvidia', preset: 'p7', quality: 29, recipeId: 'archive-quality-hevc-v1' } }), {});
  assert.deepEqual(selector.orientationQualification({ ...options, request: fixture({ ordinary: true }).request, runtimeIdentity: null,
    settings: { profileId: 'h264-cpu', preset: 'slower', quality: 24 } }), {});
  invalid(() => selector.orientationQualification({ inspection: h.inspection, request: h.request, runtimeIdentity: RUNTIME }));
});

test('CFR requires absolute ordinal phase throughout the full source, not just small local deltas and a returning final extent', () => {
  const h = fixture({ duration: 6, mutate: p => { p.streams[0].time_base = '1/1000'; p.streams[0].duration_ts = 6000; } });
  const selection = h.selector.select(h.bindings), drift = receipt(h);
  drift.completeSource.video.maximumNominalCadenceErrorUs = 667;
  drift.completeSource.video.maximumNominalDurationErrorUs = 667;
  drift.completeSource.video.maximumNominalPhaseErrorUs = 40000;
  badSource(() => h.selector.verifyCollectedSource(selection, drift));
  drift.completeSource.video.maximumNominalPhaseErrorUs = 1000;
  assert.equal(h.selector.verifyCollectedSource(selection, drift), true);
});

test('start-only, end-only and to-source-end ranges resolve against the file and keep the 0.5–30 s family limit', () => {
  for (const range of [{ startUs: 1000000 }, { endUs: 2000000 }, { startUs: 3000000, endUs: 4000000 }, { startUs: 3500000 }]) {
    const h = fixture({ overrides: { range } }); assert.ok(h.selector.select(h.bindings), JSON.stringify(range));
  }
  const resolved = fixture({ overrides: { range: { startUs: 1000000 } } }).plan.contract.range.resolved;
  assert.deepEqual({ ...resolved }, { startUs: 1000000, endUs: 4000000 });
  assert.deepEqual({ ...fixture({ overrides: { range: { endUs: 2000000 } } }).plan.contract.range.resolved }, { startUs: 0, endUs: 2000000 });
  // An open edge takes the file's own start or end, so the resolved span, not
  // the typed one, must stay inside the family: no silent clamping to 30 s.
  for (const range of [{ startUs: 5000000 }, { endUs: 31000000 }, { startUs: 3600000 }]) {
    const h = fixture({ duration: range.startUs === 3600000 ? 4 : 40, overrides: { range } });
    required(() => h.selector.select(h.bindings));
  }
});

// Record 47 Q2b: the whole-file 1080p30 -> 720p family with copied audio.
const FULL_ID = 'full-sdr-resize-copy-v1';
function fullFamily(config = CPU) {
  const value = family(config); value.id = FULL_ID; value.evidenceIds = ['synthetic-full-endpoint', 'synthetic-full-interior'];
  value.qualification = { ...value.qualification, evidenceId: 'synthetic-full-endpoint', containerDuration: 'matroska-copy-end-plus-codec-delay', tolerances: { ...value.qualification.tolerances, sampleCount: 0 } };
  value.timingQualification = { ...value.timingQualification, evidenceId: 'synthetic-full-interior', aac: null };
  return value;
}
const WHOLE = { range: null, audioPolicy: 'copy', resolution: '720' };
function full(options = {}) {
  const h = fixture({ width: 1920, rate: 30, duration: 10, families: [fullFamily(options.config)], ...options, overrides: { ...WHOLE, ...options.overrides } });
  h.policy = FULL_ID; return h;
}

// Q2c: inert policies only; real retained PCM/media evidence belongs to root.
const FLAC_ID = 'short-sdr-range-flac-v1';
function flacFamily(config = CPU) {
  const value = family(config); value.id = FLAC_ID;
  value.evidenceIds = ['synthetic-flac-endpoint', 'synthetic-flac-interior'];
  value.qualification.evidenceId = value.evidenceIds[0]; value.qualification.tolerances.sampleCount = 0;
  value.timingQualification.evidenceId = value.evidenceIds[1]; value.timingQualification.aac = null;
  return value;
}
function flac(options = {}) {
  const h = fixture({ ...options, families: options.families || [flacFamily(options.config)],
    mutate(source) {
      Object.assign(source.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_sample: 16 });
      source.format.tags = { ...source.format.tags, major_brand: 'qt  ' };
      delete source.streams[1].profile; options.mutate?.(source);
    }, overrides: { audioPolicy: 'precision-flac', ...options.overrides } });
  h.policy = FLAC_ID; return h;
}

test('FLAC ranges select their own family across both rates, geometries and backends with exact source coverage', () => {
  for (const config of [CPU, NVIDIA]) for (const rate of [30, 60]) for (const width of [1280, 1920]) {
    for (const resolution of width === 1920 ? ['source', '720'] : ['source']) {
      const h = flac({ config, rate, width, absent: true, overrides: { resolution }, families: [family(config), fullFamily(config), flacFamily(config)] });
      const token = h.selector.select(h.bindings), selected = h.selector.requireCurrent(token, h.bindings);
      assert.equal(selected.sourcePolicy.id, FLAC_ID); assert.equal(selected.timingQualification.aac, null);
      assert.equal(selected.qualification.containerDuration, 'end-timestamp'); assert.equal(selected.qualification.tolerances.sampleCount, 0);
      assert.equal(h.selector.verifyCollectedSource(token, receipt(h)), true);
      badSource(() => h.selector.verifyCollectedSource(token, receipt({ ...h, policy: 'short-sdr-range-v1' })));
      if (resolution === '720') {
        assert.equal(h.orientation.identityOrientationQualification.evidenceId, 'synthetic-flac-endpoint');
        assert.equal(h.selector.explainResize({ inspection: h.inspection, request: h.request, runtimeIdentity: RUNTIME, settings: config }), null);
      }
    }
  }
  const families = [flacFamily(), family(), fullFamily()];
  const aac = fixture({ families }), copy = full({ families });
  assert.equal(aac.selector.requireCurrent(aac.selector.select(aac.bindings), aac.bindings).sourcePolicy.id, 'short-sdr-range-v1');
  assert.equal(copy.selector.requireCurrent(copy.selector.select(copy.bindings), copy.bindings).sourcePolicy.id, FULL_ID);
});

test('FLAC source admission never admits AAC, non-s16 PCM, another rate or layout and never broadens AAC or copy', () => {
  assert.throws(() => fixture({ families: [flacFamily()], overrides: { audioPolicy: 'precision-flac' } }), { code: 'FLAC_SAMPLE_REPRESENTATION_UNQUALIFIED' });
  for (const mutate of [
    p => { Object.assign(p.streams[1], { sample_rate: '44100', time_base: '1/44100', duration_ts: 176400 }); },
    p => { Object.assign(p.streams[1], { channels: 1, channel_layout: 'mono' }); },
    p => { Object.assign(p.streams[1], { codec_name: 'pcm_s16be' }); },
    p => { Object.assign(p.streams[1], { codec_name: 'pcm_s24le', sample_fmt: 's32', bits_per_sample: 24, bits_per_raw_sample: 24 }); },
    p => { p.streams[1].sample_fmt = 's16p'; },
    p => { p.streams[1].bits_per_sample = 8; },
    p => { p.streams[1].bits_per_raw_sample = 8; },
  ]) {
    const h = flac({ mutate }); required(() => h.selector.select(h.bindings));
  }
  for (const bits of [undefined, 0, 16]) {
    const h = flac({ mutate: p => { if (bits !== undefined) p.streams[1].bits_per_raw_sample = bits; } });
    assert.ok(h.selector.select(h.bindings));
  }
  const pcmAac = flac({ families: [family(), flacFamily()], overrides: { audioPolicy: 'precision-aac' } });
  required(() => pcmAac.selector.select(pcmAac.bindings));
  const pcmCopy = flac({ width: 1920, duration: 10, families: [fullFamily(), flacFamily()], overrides: WHOLE });
  required(() => pcmCopy.selector.select(pcmCopy.bindings));
});

test('FLAC retains the range limits, refuses full-file jobs and reports the FLAC refusal in a mixed catalog', () => {
  for (const range of [{ startUs: 0, endUs: 500000 }, { startUs: 1000000 }, { endUs: 2000000 }, { startUs: 0, endUs: 30000000 }]) {
    const h = flac({ duration: range.endUs === 30000000 ? 40 : 4, overrides: { range } }); assert.ok(h.selector.select(h.bindings));
  }
  for (const overrides of [{ range: null }, { range: { startUs: 0, endUs: 499999 } },
    { range: { startUs: 0, endUs: 30000001 } }, { resolution: '1080' }]) {
    const h = flac({ duration: 40, overrides }); required(() => h.selector.select(h.bindings));
  }
  const h = flac({ width: 1920, absent: true, families: [family(), fullFamily(), flacFamily()], overrides: { range: null, resolution: 'source' } });
  // A range request at an unsupported PCM source shape must name FLAC, even
  // when the AAC record occurs first. These helpers do not grant authority.
  const request = resolveFileRequest({ fileId: 'refusal', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { audioPolicy: 'precision-flac', resolution: '720', range: { startUs: 0, endUs: 499999 } } });
  const ask = { inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU };
  assert.deepEqual(h.selector.orientationQualification(ask), {});
  const refusal = h.selector.explainResize(ask);
  assert.equal(refusal.code, 'OPERATION_RESIZE_UNQUALIFIED'); assert.match(refusal.message, /0\.5 to 30 seconds/);
  const bad = flac({ families: [family(), fullFamily(), flacFamily()], mutate: p => { p.streams[1].codec_name = 'pcm_s16be'; } });
  assert.throws(() => bad.selector.select(bad.bindings), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED' && /48 kHz stereo/.test(error.message));
  const edge = flac({ duration: 120, rate: 60 }), token = edge.selector.select(edge.bindings);
  assert.equal(edge.selector.verifyCollectedSource(token, receipt(edge)), true);
  const beyond = receipt(edge); beyond.completeSource.audio[0].sampleCount = String(120 * 48000 + 1);
  badSource(() => edge.selector.verifyCollectedSource(token, beyond));
});

test('a whole-file FLAC resize names the FLAC range refusal for selection and absent-orientation diagnosis', () => {
  const h = flac({ width: 1920, duration: 10, absent: true, families: [family(), fullFamily(), flacFamily()] });
  const request = resolveFileRequest({ fileId: 'whole-flac', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: null, resolution: '720', audioPolicy: 'precision-flac' } });
  const ask = { inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU };
  assert.deepEqual(h.selector.orientationQualification(ask), {});
  // Supply a synthetic source-bound orientation interpretation solely to build
  // the genuine plan that selection must refuse. No family grants the request.
  const plan = buildEncodeOperation({ input: SOURCE.canonicalPath, output: 'F:\\synthetic-family-owned\\whole-flac.mkv',
    inspection: h.inspection, request, settings: CPU, runtimeIdentity: RUNTIME,
    identityOrientationQualification: { evidenceId: 'synthetic-flac-endpoint', runtimeIdentity: RUNTIME,
      sourceEvidenceFingerprint: fingerprintEncodeSource(h.source), videoIndex: 0 } });
  assert.equal(plan.contract.range.kind, 'full'); assert.equal(plan.contract.audio.streams[0].mode, 'precision-flac');
  assert.throws(() => h.selector.select({ ...h.bindings, plan }), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED'
    && error.message === 'A resolved bounded range is required.');
  const refusal = h.selector.explainResize(ask);
  assert.equal(refusal.code, 'OPERATION_RESIZE_UNQUALIFIED'); assert.match(refusal.message, /A resolved bounded range is required\./);
});

test('FLAC requires the exact measured QuickTime brand while AAC and copy retain their container scope', () => {
  for (const brand of ['isom', 'mp42', undefined, 'qt', 'QT  ']) {
    const mutate = source => { if (brand === undefined) delete source.format.tags; else source.format.tags.major_brand = brand; };
    const h = flac({ width: 1920, absent: true, families: [family(), fullFamily(), flacFamily()], mutate });
    assert.throws(() => h.selector.select(h.bindings), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED' && /measured QuickTime major brand/.test(error.message));
    const request = resolveFileRequest({ fileId: 'brand-refusal', identityRevision: 1, draftRevision: 1, operation: 'encode',
      overrides: { range: { startUs: 1000000, endUs: 2000000 }, resolution: '720', audioPolicy: 'precision-flac' } });
    const ask = { inspection: h.inspection, request, runtimeIdentity: RUNTIME, settings: CPU };
    assert.deepEqual(h.selector.orientationQualification(ask), {});
    assert.match(h.selector.explainResize(ask).message, /measured QuickTime major brand/);
    for (const make of [fixture, full]) {
      const aac = make({ families: [family(), fullFamily(), flacFamily()], mutate(source) {
        if (brand !== undefined) source.format.tags = { major_brand: brand };
      } });
      assert.ok(aac.selector.select(aac.bindings));
    }
  }
  const measured = flac(); assert.ok(measured.selector.select(measured.bindings));
});

test('the common audio pre-check reports 44.1 kHz AAC before clock or side-data diagnostics', () => {
  for (const sideData of [false, true]) {
    const h = fixture({ families: [family(), fullFamily(), flacFamily()], mutate(source) {
      Object.assign(source.streams[1], { sample_rate: '44100', time_base: '1/44100', duration_ts: 176400 });
      if (sideData) source.streams[1].side_data_list = [{ side_data_type: 'Replay Gain', track_gain: 0 }];
    } });
    assert.throws(() => h.selector.select(h.bindings), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED'
      && error.message === 'Only 48 kHz stereo AAC LC/fltp or pcm_s16le/s16 source audio belongs to these families.');
  }
});

test('a three-family catalog keeps HE-AAC, s16p, mono, mp3 and PCM outside the older families', () => {
  const families = [family(), fullFamily(), flacFamily()];
  for (const mutate of [source => { source.streams[1].profile = 'HE-AAC'; },
    source => { source.streams[1].sample_fmt = 's16p'; },
    source => { Object.assign(source.streams[1], { channels: 1, channel_layout: 'mono' }); },
    source => { source.streams[1].codec_name = 'mp3'; }]) {
    const h = full({ families, mutate }); required(() => h.selector.select(h.bindings));
  }
  const mono = fixture({ families, mutate(source) { Object.assign(source.streams[1], { channels: 1, channel_layout: 'mono' }); } });
  required(() => mono.selector.select(mono.bindings));
  for (const overrides of [{ audioPolicy: 'precision-aac' }, WHOLE]) {
    const pcm = flac({ width: 1920, duration: 10, families, overrides });
    assert.throws(() => pcm.selector.select(pcm.bindings), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED'
      && /Only 48 kHz stereo AAC LC\/fltp source audio/.test(error.message));
  }
});

test('FLAC family qualification cannot exceed any frozen AAC endpoint or interior ceiling', () => {
  const ceilings = { videoTimestampUs: 1067, audioTimestampUs: 22355, avSyncUs: 23422, durationUs: 1088 };
  const value = flacFamily(); Object.assign(value.qualification.tolerances, ceilings);
  Object.assign(value.timingQualification, { videoDurationUs: 1067, audioTimelineUs: 1042 });
  assert.doesNotThrow(() => new OperationFamilySelector({ families: [value], policyIdentity: POLICY }));
  for (const [key, maximum] of Object.entries(ceilings)) {
    const wide = clone(value); wide.qualification.tolerances[key] = maximum + 1;
    assert.throws(() => new OperationFamilySelector({ families: [wide], policyIdentity: POLICY }), error => error.code === 'INVALID_OPERATION_QUALIFICATION'
      && error.message.includes(key) && /frozen AAC range ceiling/.test(error.message));
  }
  for (const [key, maximum] of Object.entries({ videoDurationUs: 1067, audioTimelineUs: 1042 })) {
    const wide = clone(value); wide.timingQualification[key] = maximum + 1;
    assert.throws(() => new OperationFamilySelector({ families: [wide], policyIdentity: POLICY }), error => error.code === 'INVALID_OPERATION_QUALIFICATION'
      && /interior timing tolerances exceed/.test(error.message));
  }
  // The stronger existing FLAC rule still requires zero, below AAC's 1023.
  const samples = clone(value); samples.qualification.tolerances.sampleCount = 1;
  invalid(() => new OperationFamilySelector({ families: [samples], policyIdentity: POLICY }));
  for (const other of [family(), fullFamily()]) {
    other.qualification.tolerances.videoTimestampUs = 1068; other.timingQualification.audioTimelineUs = 1043;
    assert.doesNotThrow(() => new OperationFamilySelector({ families: [other], policyIdentity: POLICY }));
  }
});

test('FLAC family records forbid AAC alignment, packet/copy clocks, span and any sample-count allowance', () => {
  for (const mutate of [value => { value.timingQualification.aac = family().timingQualification.aac; },
    ...['matroska-packet-end-plus-codec-delay', 'matroska-copy-end-plus-codec-delay', 'span'].map(clock => value => { value.qualification.containerDuration = clock; }),
    value => { value.qualification.tolerances.sampleCount = 1; }]) {
    const value = flacFamily(); mutate(value); invalid(() => new OperationFamilySelector({ families: [value], policyIdentity: POLICY }));
  }
  // The selected FLAC representation is the existing end-timestamp model,
  // still valid for AAC. No new FLAC-only clock string is accepted anywhere.
  assert.doesNotThrow(() => new OperationFamilySelector({ families: [family(), fullFamily(), flacFamily()], policyIdentity: POLICY }));
  for (const value of [family(), fullFamily(), flacFamily()]) {
    value.qualification.containerDuration = 'matroska-flac-end-timestamp';
    invalid(() => new OperationFamilySelector({ families: [value], policyIdentity: POLICY }));
  }
});

test('FLAC calibration freezes clock-only tighter bounds and refuses unbound fixture constants before work', async () => {
  const { frozenQualifications, validateFixtureBinding, main } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
  const { FIXTURES, generationArgs, assessMetadata } = require('../scripts/v07-sdr-pcm-envelope-fixtures.cjs');
  const source = probe(); Object.assign(source.streams[0], { time_base: '1/15360' });
  Object.assign(source.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16' });
  const frozen = frozenQualifications('synthetic-flac', RUNTIME, source);
  assert.deepEqual(frozen.qualification.tolerances,
    { videoTimestampUs: 1067, audioTimestampUs: 1042, avSyncUs: 2109, durationUs: 1088, sampleCount: 0 });
  assert.equal(frozen.timingQualification.aac, null); assert.equal(frozen.timingQualification.videoDurationUs, 1067);
  assert.equal(frozen.timingQualification.audioTimelineUs, 1042); assert.equal(frozen.qualification.containerDuration, 'end-timestamp');
  for (const mutate of [p => { p.streams[0].time_base = '1/1000'; }, p => { p.streams[1].time_base = '1/1000'; },
    p => { p.streams[0].time_base = '-1/15360'; }, p => { p.streams[1].sample_rate = '44100'; },
    p => { p.streams[1].channels = 1; }, p => { p.streams[1].channel_layout = 'mono'; },
    p => { p.streams[1].codec_name = 'aac'; }, p => { p.streams[1].sample_fmt = 'fltp'; }]) {
    const changed = clone(source); mutate(changed); assert.throws(() => frozenQualifications('synthetic-flac', RUNTIME, changed));
  }
  const id = '01234567-89ab-4cde-8123-456789abcdef';
  assert.doesNotThrow(() => validateFixtureBinding(id, RUNTIME));
  assert.throws(() => validateFixtureBinding('ROOT_FILL_PCM_FIXTURE_UUID', RUNTIME), /ROOT must bind/);
  assert.throws(() => validateFixtureBinding(id, 'ROOT_FILL_PCM_FIXTURE_REPORT_SHA256'), /ROOT must bind/);
  // Before and after root pins the report, a missing CLI cannot start work.
  await assert.rejects(main([]), /ROOT must bind|Require explicit fixture report/);
  assert.equal(FIXTURES.length, 4);
  assert.equal(new Set(FIXTURES.map(spec => `${spec.width}:${spec.fps}`)).size, 4);
  for (const spec of FIXTURES) {
    const args = generationArgs(spec, 'synthetic-owned.mov', 1000000);
    assert.equal(spec.container, 'mov'); assert.ok(args.includes('pcm_s16le')); assert.ok(args.includes('s16')); assert.ok(!args.includes('aac'));
  }
  const generated = probe({ width: 1920, duration: 10 });
  Object.assign(generated.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_sample: 16 });
  delete generated.streams[1].profile;
  const normalize = require('../src/inspection.cjs').normalizeProbe;
  assert.equal(assessMetadata(FIXTURES[0], normalize(generated)).audio.codec, 'pcm_s16le');
  for (const mutate of [p => { p.streams[1].codec_name = 'aac'; }, p => { p.streams[1].sample_fmt = 'fltp'; },
    p => { p.streams[1].bits_per_sample = 24; }]) {
    const changed = clone(generated); mutate(changed); assert.throws(() => assessMetadata(FIXTURES[0], normalize(changed)));
  }
});

test('a whole-file 1080p30 to 720p job with copied audio selects only the copied-audio family', () => {
  for (const config of [CPU, NVIDIA]) {
    const h = full({ config }), selection = h.selector.select(h.bindings), selected = h.selector.requireCurrent(selection, h.bindings);
    assert.equal(h.plan.compatibilityPath, false); assert.equal(h.plan.contract.range.kind, 'full'); assert.equal(h.plan.contract.audio.streams[0].mode, 'copy');
    assert.deepEqual(selected.sourcePolicy, { id: FULL_ID, rate: 30, maximumExtentUs: 120000000 });
    assert.equal(selected.timingQualification.aac, null); assert.equal(selected.qualification.tolerances.sampleCount, 0);
    assert.deepEqual(selected.evidenceIds, ['synthetic-full-endpoint', 'synthetic-full-interior']);
    assert.equal(h.selector.verifyCollectedSource(selection, receipt(h)), true);
    // A receipt collected under the range family's policy is not this family's evidence.
    badSource(() => h.selector.verifyCollectedSource(selection, receipt({ ...h, policy: 'short-sdr-range-v1' })));
    // With no reported rotation the plan is built only through this family's own orientation evidence.
    const absent = full({ config, absent: true });
    assert.equal(absent.orientation.identityOrientationQualification.evidenceId, 'synthetic-full-endpoint');
    assert.equal(absent.selector.requireCurrent(absent.selector.select(absent.bindings), absent.bindings).sourcePolicy.id, FULL_ID);
  }
});

test('with both families on one tuple each job selects its own family and the other stays unreachable to it', () => {
  const families = [family(), fullFamily()];
  const ranged = fixture({ width: 1920, rate: 30, duration: 10, absent: true, families, overrides: { resolution: '720' } });
  assert.equal(ranged.selector.requireCurrent(ranged.selector.select(ranged.bindings), ranged.bindings).sourcePolicy.id, 'short-sdr-range-v1');
  assert.equal(ranged.orientation.identityOrientationQualification.evidenceId, 'synthetic-family-endpoint');
  const whole = full({ absent: true, families: [family(), fullFamily()] });
  const selection = whole.selector.select(whole.bindings);
  assert.equal(whole.selector.requireCurrent(selection, whole.bindings).sourcePolicy.id, FULL_ID);
  assert.equal(whole.orientation.identityOrientationQualification.evidenceId, 'synthetic-full-endpoint');
  assert.equal(whole.selector.explainResize({ inspection: whole.inspection, request: whole.request, runtimeIdentity: RUNTIME, settings: CPU }), null);
  // Without the copied-audio family the same whole-file job gets no orientation help and an explained refusal.
  const rangeSelector = new OperationFamilySelector({ families: [family()], policyIdentity: POLICY });
  const ask = { inspection: whole.inspection, request: whole.request, runtimeIdentity: RUNTIME, settings: CPU };
  assert.deepEqual(rangeSelector.orientationQualification(ask), {});
  assert.equal(rangeSelector.explainResize(ask).code, 'OPERATION_RESIZE_UNQUALIFIED');
  // A whole-file job never reaches the range family, and a range job never reaches the whole-file family.
  const rangeOnly = fixture({ width: 1920, rate: 30, duration: 10, families: [fullFamily()], overrides: { resolution: '720' } });
  required(() => rangeOnly.selector.select(rangeOnly.bindings));
});

test('the copied-audio family refuses every job outside its measured whole-file 1080p30 scope', () => {
  const cases = [
    { name: '60 fps', options: { rate: 60 } },
    { name: 'longer than 31 s', options: { duration: 32 } },
    { name: 're-encoded AAC', options: { overrides: { audioPolicy: 'precision-aac' } } },
  ];
  for (const item of cases) {
    const h = full(item.options); assert.throws(() => h.selector.select(h.bindings), error => error.code === "OPERATION_QUALIFICATION_REQUIRED", item.name);
    // The same job with no reported rotation: no orientation help, and a resize is explained as unqualified.
    const source = probe({ width: 1920, rate: 30, duration: 10, ...item.options, absent: true });
    const ask = { inspection: { probe: source }, request: h.request, runtimeIdentity: RUNTIME, settings: CPU };
    assert.deepEqual(h.selector.orientationQualification(ask), {}, item.name);
    assert.equal(h.selector.explainResize(ask)?.code, 'OPERATION_RESIZE_UNQUALIFIED', item.name);
  }
  // Whole-file Keep Source with copied audio stays the ordinary path and needs no family.
  const ordinary = full({ overrides: { resolution: 'source' } });
  assert.equal(ordinary.plan.compatibilityPath, true); assert.equal(ordinary.selector.select({ plan: ordinary.plan }), null);
  // A 31 s file is still inside the scope.
  const edge = full({ duration: 31 }); assert.ok(edge.selector.select(edge.bindings));
});

test('a copied-audio family record cannot carry AAC alignment, the AAC packet clock or a sample allowance', () => {
  assert.doesNotThrow(() => new OperationFamilySelector({ families: [family(), fullFamily()], policyIdentity: POLICY }));
  const variants = [
    value => { value.timingQualification.aac = family().timingQualification.aac; },
    value => { value.qualification.containerDuration = 'matroska-packet-end-plus-codec-delay'; },
    value => { value.qualification.containerDuration = 'span'; },
    value => { value.qualification.containerDuration = 'end-timestamp'; },
    value => { value.qualification.tolerances.sampleCount = 1; },
    value => { value.id = 'full-sdr-resize-copy-v2'; },
  ];
  for (const change of variants) { const value = fullFamily(); change(value); invalid(() => new OperationFamilySelector({ families: [value], policyIdentity: POLICY })); }
  // The range family still requires its AAC alignment.
  const range = family(); range.timingQualification.aac = null; invalid(() => new OperationFamilySelector({ families: [range], policyIdentity: POLICY }));
  // The copy clock belongs to no other family.
  const clocked = family(); clocked.qualification.containerDuration = 'matroska-copy-end-plus-codec-delay';
  invalid(() => new OperationFamilySelector({ families: [clocked], policyIdentity: POLICY }));
  invalid(() => new OperationFamilySelector({ families: [fullFamily(), fullFamily()], policyIdentity: POLICY }));
});

// Review fix: every extent of a whole-file job, reported and decoded, keeps the measured 10-31 s shape.
test('the copied-audio family bounds audio, container and decoded extents, not only the video stream', () => {
  const audio = (source, seconds) => Object.assign(source.streams[1], { duration: String(seconds), duration_ts: Math.round(seconds * 48000) });
  const cases = {
    'audio of 100 s under 10 s of video': source => { audio(source, 100); source.format.duration = '100'; },
    'audio of 32 s under 31 s of video': source => { audio(source, 32); source.format.duration = '32'; },
    'container of 100 s over 10 s streams': source => { source.format.duration = '100'; },
    'container 30 ms past its streams': source => { source.format.duration = '10.03'; },
    'audio 30 ms longer than video': source => { audio(source, 10.03); source.format.duration = '10.03'; },
    'audio 30 ms shorter than video': source => { audio(source, 9.97); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const duration = name.includes('31 s') ? 31 : 10, h = full({ duration, mutate });
    assert.throws(() => h.selector.select(h.bindings), error => error.code === 'OPERATION_QUALIFICATION_REQUIRED', name);
  }
  // Inside one AAC frame (21.333 ms) the measured shape still admits the file.
  const near = full({ mutate: source => { audio(source, 10.021); source.format.duration = '10.021'; } }); assert.ok(near.selector.select(near.bindings));
  // Shorter than the shortest measured whole file (10 s).
  const short = full({ duration: 9 }); required(() => short.selector.select(short.bindings));
  // The decoded source must keep the same shape as the metadata that admitted it.
  const h = full(), selection = h.selector.select(h.bindings);
  assert.equal(h.selector.verifyCollectedSource(selection, receipt(h)), true);
  const decoded = [
    value => { value.completeSource.video.frames = 3000; value.completeSource.video.properties.framesChecked = 3000; value.completeSource.video.endTime = { n: '100', d: '1' }; },
    value => { Object.assign(value.completeSource.audio[0], { sampleCount: String(100 * 48000), endTime: { n: '100', d: '1' } }); },
    value => { Object.assign(value.completeSource.audio[0], { sampleCount: String(10 * 48000 + 1440), endTime: { n: String(10 * 48000 + 1440), d: '48000' } }); },
  ];
  for (const change of decoded) { const value = receipt(h); change(value); badSource(() => h.selector.verifyCollectedSource(selection, value)); }
  // The range family keeps its 120 s decoded bound and still accepts unequal stream ends within it.
  const ranged = fixture({ width: 1920, rate: 30, duration: 10, overrides: { resolution: '720' } }), token = ranged.selector.select(ranged.bindings);
  const long = receipt(ranged); Object.assign(long.completeSource.audio[0], { sampleCount: String(10 * 48000 + 1440), endTime: { n: String(10 * 48000 + 1440), d: '48000' } });
  assert.equal(ranged.selector.verifyCollectedSource(token, long), true);
});

test('a refused range job names the range family, and a refused whole-file job names the whole-file family', () => {
  const families = [family(), fullFamily()];
  const ranged = fixture({ width: 1920, rate: 60, duration: 10, families, overrides: { resolution: '720', range: { startUs: 1000000, endUs: 1200000 } } });
  assert.throws(() => ranged.selector.select(ranged.bindings), error => /range/i.test(error.message) && !/whole-file/i.test(error.message));
  const whole = full({ rate: 60, families });
  assert.throws(() => whole.selector.select(whole.bindings), error => /whole-file/i.test(error.message));
});
