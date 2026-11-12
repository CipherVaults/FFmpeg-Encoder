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
  const retained = family(config), selector = new OperationFamilySelector({ families: options.empty ? [] : [retained], policyIdentity: POLICY });
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
      maximumNominalPhaseErrorUs: 0, properties: { policy: 'short-sdr-range-v1', sampleAspectRatio: '1:1', chromaLocation: 'left',
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
