'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OPERATION_DEFAULTS, createBatchDefaults, resolveFileRequest, resolveGeometry, resolveTimeRange, resolveAudio, buildOperationContract } = require('../src/operation-contract.cjs');

const known = value => ({ state: 'known', value });
const integer = value => known(String(value));
const rational = (numerator, denominator = 1) => known({ numerator: String(numerator), denominator: String(denominator) });
const unknown = () => ({ state: 'unknown', reason: 'not-reported' });
const clone = value => structuredClone(value);
function video(width = 1920, height = 1080) {
  return { index: 0, geometry: { width: integer(width), height: integer(height), sampleAspectRatio: rational(1),
    displayAspectRatio: rational(width, height), rotationDegrees: rational(0), rotationSource: 'legacy-rotate-tag',
    legacyRotationDegrees: rational(0), displayMatrix: unknown(), fieldOrder: known('progressive') },
  timeline: { timeBase: rational(1, 90000), startPts: integer(126000), startSeconds: rational(7, 5), durationTicks: integer(900000), durationSeconds: rational(10) } };
}
function audio(index = 1, { rate = 48000, channels = 2, layout = 'stereo', format = 'fltp' } = {}) {
  return { index, codec: { type: known('audio'), name: known('aac') }, audio: { sampleRate: integer(rate), channels: integer(channels), channelLayout: known(layout), sampleFormat: known(format) } };
}
function request(overrides = {}, extras = {}) {
  return resolveFileRequest({ fileId: 'file-123', identityRevision: 2, draftRevision: 7, operation: 'encode', overrides, ...extras });
}
const full = () => ({ kind: 'full', timestampMapping: 'preserve-source' });
const selected = () => ({ kind: 'range', timestampMapping: 'subtract-one-common-absolute-start' });
const fraction = value => Number(value.numerator) / Number(value.denominator);

test('batch defaults merge factory/app/batch, strip cosmetic state and freeze an independent snapshot', () => {
  const app = { resolution: '1080', hdrPolicy: 'sdr', previewExpanded: true }, batch = { resolution: '720' };
  const snapshot = createBatchDefaults({ appDefaults: app, batchOverrides: batch, appDefaultsRevision: 4 });
  assert.equal(snapshot.values.resolution, '720'); assert.equal(snapshot.origins.resolution, 'batch');
  assert.equal(snapshot.values.hdrPolicy, 'sdr'); assert.equal(snapshot.origins.hdrPolicy, 'app');
  assert.equal(snapshot.values.fullAudioPolicy, 'copy'); assert.equal(snapshot.origins.fullAudioPolicy, 'factory');
  assert.equal(snapshot.values.previewExpanded, undefined);
  app.hdrPolicy = 'preserve'; batch.resolution = '2160';
  assert.equal(snapshot.values.resolution, '720'); assert.equal(snapshot.values.hdrPolicy, 'sdr');
  assert.throws(() => { snapshot.values.resolution = '2160'; }, TypeError);
  assert.equal(createBatchDefaults().values.rangeAudioPolicy, 'precision-aac');
});

test('defaults never inherit paths, raw graphs, ranges, authorization or per-file HDR alternatives', () => {
  for (const appDefaults of [
    { inputPath: 'F:\\source' }, { range: { startUs: 0 } }, { hdrPolicy: 'dolby-pq' }, { hdrPolicy: 'hlg-base' },
    { remuxTarget: 'ts' }, { resolution: 1080 }, { fullAudioPolicy: 'aac' }, { previewExpanded: 'true' },
    JSON.parse('{"__proto__":{"resolution":"720"}}'),
  ]) assert.throws(() => createBatchDefaults({ appDefaults }), { code: 'INVALID_OPERATION' });
  let read = false;
  assert.throws(() => createBatchDefaults({ appDefaults: { get resolution() { read = true; return '720'; } } }), { code: 'INVALID_OPERATION' });
  assert.equal(read, false);
});

test('file overrides retain exact scope/origins and ranges select the appropriate default audio policy', () => {
  const defaults = createBatchDefaults({ appDefaults: { fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-flac', resolution: '1080' } });
  assert.equal(request({}, { batchDefaults: defaults }).range, null);
  assert.equal(request({}, { batchDefaults: defaults }).audioPolicy, 'copy');
  const result = request({ range: { startUs: 250000 }, resolution: '720', hdrPolicy: 'hlg-base' }, { batchDefaults: defaults });
  assert.equal(result.audioPolicy, 'precision-flac'); assert.equal(result.origins.audioPolicy, 'app');
  assert.equal(result.origins.resolution, 'file'); assert.equal(result.origins.range, 'file');
  assert.equal(result.hdrPolicy, 'hlg-base'); assert.equal(defaults.values.resolution, '1080');
  assert.equal(result.identityRevision, 2); assert.equal(result.draftRevision, 7);
  assert.throws(() => { result.range.startUs = 0; }, TypeError);
});

test('remux uses its own target default and rejects any requested transform', () => {
  const batchDefaults = createBatchDefaults({ appDefaults: { resolution: '720', hdrPolicy: 'sdr', fullAudioPolicy: 'precision-aac', remuxTarget: 'mov' } });
  const result = request({}, { operation: 'remux', batchDefaults });
  assert.equal(result.target, 'mov'); assert.equal(result.origins.target, 'app');
  assert.equal(result.resolution, 'source'); assert.equal(result.hdrPolicy, 'preserve'); assert.equal(result.audioPolicy, 'copy');
  assert.equal(result.origins.resolution, 'not-applicable');
  for (const overrides of [{ range: { startUs: 0 } }, { resolution: '1080' }, { hdrPolicy: 'sdr' }, { audioPolicy: 'precision-aac' }]) {
    assert.throws(() => request(overrides, { operation: 'remux' }), { code: 'INVALID_REMUX_TRANSFORM' });
  }
  assert.throws(() => request({ target: 'mpegts' }), { code: 'INVALID_OPERATION' });
});

test('request validation rejects unsafe numeric values, unsupported fields and reusable omission authority', () => {
  for (const range of [{}, { startUs: -1 }, { startUs: 0.5 }, { endUs: NaN }, { endUs: Infinity }, { startUs: Number.MAX_SAFE_INTEGER + 1 }, { startUs: '1000' }, { startUs: null }, { startUs: 1, endUs: 1 }, { startUs: 0, command: 'ffmpeg' }]) {
    assert.throws(() => request({ range }));
  }
  for (const overrides of [{ arbitraryArguments: [] }, { omissionRequestIds: ['F:\\input.mp4'] }, { omissionRequestIds: ['same', 'same'] },
    { omissionRequestIds: [{ authorized: true }] }, { omissionAuthority: true }, { aacBitrateKbps: 25 }, { aacBitrateKbps: 320 }]) {
    assert.throws(() => request(overrides));
  }
  assert.throws(() => request({}, { draftRevision: -1 }), { code: 'INVALID_OPERATION' });
  const result = request({ omissionRequestIds: ['decision-1', 'decision-2'] });
  assert.equal(result.omissionAuthority, 'unbound-request-ids');
  assert.deepEqual(result.omissionRequestIds, ['decision-1', 'decision-2']);
});

test('Keep Source does not invent missing ancillary geometry or insert a filter', () => {
  const source = video(); source.geometry.sampleAspectRatio = unknown(); source.geometry.rotationDegrees = unknown();
  const result = resolveGeometry(source, 'source');
  assert.equal(result.mode, 'preserve-source'); assert.equal(result.filterRequired, false);
  assert.equal(result.output.sampleAspectRatio, null); assert.equal(result.output.orientation, 'preserve-source');
  source.geometry.width = unknown();
  assert.throws(() => resolveGeometry(source, 'source'), { code: 'GEOMETRY_UNKNOWN' });
});

test('ultrawide downscale fits the entire picture, with explicit bounded aspect rounding', () => {
  const result = resolveGeometry(video(3440, 1440), '1080');
  assert.deepEqual(result.box, { width: 1920, height: 1080 });
  assert.equal(result.output.width, 1920); assert.equal(result.output.height, 804);
  assert.equal(result.filterRequired, true); assert.equal(result.output.rotationDegrees, 0);
  assert.ok(fraction(result.aspectError) <= 0.001); assert.equal(fraction(result.output.sampleAspectRatio), 1);
});

test('already-fitting anamorphic footage is not enlarged or normalized unnecessarily', () => {
  const source = video(852, 480); source.geometry.sampleAspectRatio = rational(640, 639); source.geometry.displayAspectRatio = rational(16, 9);
  const result = resolveGeometry(source, '720');
  assert.equal(result.mode, 'already-fits'); assert.equal(result.filterRequired, false);
  assert.equal(result.output.width, 852); assert.equal(result.output.height, 480);
  assert.deepEqual(result.output.sampleAspectRatio, { numerator: '640', denominator: '639' });
});

test('orthogonal display matrices choose portrait bounds and are normalized only for a real resize', () => {
  const source = video(3840, 2160);
  Object.assign(source.geometry, { rotationDegrees: rational(90), rotationSource: 'display-matrix', legacyRotationDegrees: unknown(),
    displayMatrix: known(['0', '-65536', '0', '65536', '0', '0', '0', '0', '1073741824']) });
  const result = resolveGeometry(source, '1080');
  assert.deepEqual(result.box, { width: 1080, height: 1920 });
  assert.equal(result.output.width, 1080); assert.equal(result.output.height, 1920);
  assert.equal(result.display.rotationDegrees, 90); assert.equal(result.output.rotationDegrees, 0);
  const unchanged = resolveGeometry(source, '2160');
  assert.equal(unchanged.filterRequired, false); assert.equal(unchanged.output.orientation, 'preserve-source');
});

test('resize refuses unknown SAR/orientation, interlace and conflicting or non-orthogonal matrices', () => {
  for (const [change, code] of [
    [source => { source.geometry.sampleAspectRatio = unknown(); }, 'GEOMETRY_SAR_UNKNOWN'],
    [source => { source.geometry.rotationDegrees = unknown(); }, 'GEOMETRY_ORIENTATION_UNKNOWN'],
    [source => { source.geometry.rotationDegrees = rational(45); }, 'GEOMETRY_ORIENTATION_UNSUPPORTED'],
    [source => { source.geometry.fieldOrder = known('tt'); }, 'GEOMETRY_INTERLACE_UNQUALIFIED'],
    [source => { source.geometry.issues = ['display-aspect-ratio-mismatch']; }, 'GEOMETRY_CONFLICT'],
    [source => { source.geometry.rotationSource = 'display-matrix'; source.geometry.displayMatrix = known(['65536', '0', '0', '0', '-65536', '0', '0', '0', '1073741824']); }, 'GEOMETRY_ORIENTATION_UNSUPPORTED'],
  ]) { const source = video(3840, 2160); change(source); assert.throws(() => resolveGeometry(source, '1080'), { code }); }
});

test('bounded dimension grid never exceeds box, enlarges display, or outputs odd dimensions when resizing', () => {
  for (const [width, height] of [[3841, 2161], [4096, 2160], [1000, 3000], [3000, 1000], [8000, 5000], [720, 1920], [2000, 2000]]) {
    for (const choice of ['2160', '1440', '1080', '720']) {
      const result = resolveGeometry(video(width, height), choice);
      if (!result.filterRequired) { assert.equal(result.output.width, width); assert.equal(result.output.height, height); continue; }
      assert.equal(result.output.width % 2, 0); assert.equal(result.output.height % 2, 0);
      assert.ok(result.output.width <= result.box.width && result.output.height <= result.box.height);
      assert.ok(result.output.width <= width && result.output.height <= height);
      assert.ok(fraction(result.scaleFactor) < 1);
    }
  }
});

test('range resolves start-only/end-only against exact duration and retains a common nonzero origin', () => {
  const source = video();
  const startOnly = resolveTimeRange(source, { startUs: 250000 });
  assert.deepEqual(startOnly.resolved, { startUs: 250000, endUs: 10000000 });
  assert.deepEqual(startOnly.absoluteStart, { numerator: '33', denominator: '20' });
  assert.deepEqual(startOnly.absoluteEnd, { numerator: '57', denominator: '5' });
  assert.equal(startOnly.effectiveFrameBounds, 'requires-decoded-evidence');
  assert.deepEqual(resolveTimeRange(source, { endUs: 2000000 }).resolved, { startUs: 0, endUs: 2000000 });
  assert.equal(resolveTimeRange({}, null).timestampMapping, 'preserve-source');
});

test('negative origins and VFR rates do not alter exact presentation interval selection', () => {
  const source = video();
  source.timeline.startPts = integer(-45000); source.timeline.startSeconds = rational(-1, 2);
  source.timeline.averageFrameRate = rational(2997, 100); source.timeline.nominalFrameRate = rational(60);
  const result = resolveTimeRange(source, { startUs: 250000, endUs: 1500000 });
  assert.deepEqual(result.absoluteStart, { numerator: '-1', denominator: '4' });
  assert.deepEqual(result.absoluteEnd, { numerator: '1', denominator: '1' });
  assert.equal(result.boundaryRule, 'presentation-pts-start-inclusive-end-exclusive');
});

test('range rejects missing/conflicting timelines, overflow and too-long ends without clamping', () => {
  for (const [change, expected] of [
    [source => { source.timeline.startPts = unknown(); source.timeline.startSeconds = unknown(); }, 'RANGE_ORIGIN_UNKNOWN'],
    [source => { source.timeline.durationTicks = unknown(); source.timeline.durationSeconds = unknown(); }, 'RANGE_DURATION_UNKNOWN'],
    [source => { source.timeline.durationSeconds = rational(11); }, 'RANGE_TIMELINE_CONFLICT'],
    [source => { source.timeline.startSeconds = rational(3); }, 'RANGE_TIMELINE_CONFLICT'],
    [source => { source.timeline.timeBase = rational(1, 0); }, 'RANGE_TIME_BASE_UNKNOWN'],
    [source => { source.timeline.durationTicks = unknown(); source.timeline.durationSeconds = rational('9007199254740993'); }, 'RANGE_DURATION_UNSUPPORTED'],
  ]) { const source = video(); change(source); assert.throws(() => resolveTimeRange(source, { startUs: 0 }), { code: expected }); }
  assert.throws(() => resolveTimeRange(video(), { endUs: 10000001 }), { code: 'RANGE_EXCEEDS_DURATION' });
  assert.throws(() => resolveTimeRange(video(), { startUs: 10000000 }), { code: 'INVALID_RANGE' });
});

test('submicrosecond source duration is floored without pretending the requested and actual frame bounds match', () => {
  const source = video(); source.timeline.durationTicks = integer(900001); source.timeline.durationSeconds = rational(10000011, 1000000);
  const result = resolveTimeRange(source, { startUs: 0 });
  assert.equal(result.resolved.endUs, 10000011); assert.equal(result.effectiveFrameBounds, 'requires-decoded-evidence');
});

test('precision AAC preserves rate and exact supported layout with visible engineering bitrate policy', () => {
  const streams = [audio(1, { rate: 44100 }), audio(2, { channels: 1, layout: 'mono' }), audio(3, { channels: 6, layout: '5.1(side)' }), audio(4, { channels: 8, layout: '7.1' })];
  const result = resolveAudio(streams, { target: 'matroska', range: selected(), audioPolicy: 'precision-aac' });
  assert.deepEqual(result.streams.map(stream => stream.bitrateKbps), [320, 128, 512, 768]);
  assert.equal(result.streams[0].sampleRate, 44100); assert.equal(result.streams[2].channelLayout, '5.1(side)');
  assert.ok(result.streams.every(stream => stream.timestampMapping === 'subtract-one-common-absolute-start'));
  assert.ok(result.streams.every(stream => stream.losslessOriginalClaim === false));
  assert.equal(result.noResampling, true); assert.equal(result.noDownmix, true);
});

test('AAC overrides are explicit, layout-bounded and cannot silently change a conflicting layout or rate', () => {
  const options = { target: 'mp4', range: selected(), audioPolicy: 'precision-aac', aacBitrateKbps: 192 };
  const result = resolveAudio([audio()], options);
  assert.equal(result.streams[0].bitrateKbps, 192); assert.equal(result.streams[0].bitrateOrigin, 'explicit-file');
  assert.throws(() => resolveAudio([audio()], { ...options, aacBitrateKbps: 768 }), { code: 'INVALID_AUDIO_BITRATE' });
  assert.throws(() => resolveAudio([audio(1, { rate: 32000 })], options), { code: 'AUDIO_RATE_UNQUALIFIED' });
  assert.throws(() => resolveAudio([audio(1, { channels: 6, layout: 'stereo' })], options), { code: 'AUDIO_LAYOUT_UNQUALIFIED' });
  const missing = audio(); missing.audio.channelLayout = unknown();
  assert.throws(() => resolveAudio([missing], options), { code: 'AUDIO_LAYOUT_UNQUALIFIED' });
});

test('FLAC remains an explicit qualified integer-PCM Matroska path without a lossy-original losslessness claim', () => {
  const options = { target: 'matroska', range: selected(), audioPolicy: 'precision-flac' };
  const result = resolveAudio([audio(1, { format: 's32' })], options);
  assert.equal(result.streams[0].codec, 'flac'); assert.equal(result.streams[0].losslessOriginalClaim, false);
  assert.throws(() => resolveAudio([audio()], options), { code: 'FLAC_SAMPLE_REPRESENTATION_UNQUALIFIED' });
  assert.throws(() => resolveAudio([audio(1, { format: 's16' })], { ...options, target: 'mp4' }), { code: 'AUDIO_CONTAINER_UNSUPPORTED' });
  assert.throws(() => resolveAudio([audio(1, { format: 's16', channels: 6, layout: '5.1(side)' })], options), { code: 'AUDIO_LAYOUT_UNQUALIFIED' });
});

test('copy preserves the compatibility path and labels range copies as packet-limited requiring qualification', () => {
  const source = audio(); source.audio.sampleRate = unknown(); source.audio.channelLayout = unknown();
  const unchanged = resolveAudio([source], { target: 'matroska', range: full(), audioPolicy: 'copy' });
  assert.equal(unchanged.streams[0].timing, 'preserve-source');
  const trimmed = resolveAudio([source], { target: 'matroska', range: selected(), audioPolicy: 'copy' });
  assert.equal(trimmed.streams[0].timing, 'explicit-packet-boundaries');
  assert.equal(trimmed.streams[0].qualification, 'packet-range-container-required');
  assert.throws(() => resolveAudio([source], { target: 'matroska', range: full(), audioPolicy: 'copy', aacBitrateKbps: 192 }), { code: 'INVALID_AUDIO_BITRATE' });
});

test('complete contract is immutable descriptive data, not argv or reusable omission authority', () => {
  const requested = request({ range: { startUs: 1000000, endUs: 2000000 }, omissionRequestIds: ['request-7'] });
  const source = video(), audios = [audio()];
  const result = buildOperationContract({ request: requested, videoEvidence: source, audioEvidence: audios });
  assert.equal(result.status, 'descriptive-unqualified-contract'); assert.equal(result.argv, null);
  assert.equal(result.omissionRequests.authority, 'none'); assert.equal(result.omissionRequests.requiresMainIdentityAndRevisionBinding, true);
  assert.equal(result.request.origins.range, 'file'); assert.equal(result.request.origins.audioPolicy, 'factory');
  assert.equal(result.audio.streams[0].bitrateKbps, 320);
  source.geometry.width.value = '999'; audios[0].audio.sampleRate.value = '999';
  assert.equal(result.geometry.source.width, 1920); assert.equal(result.audio.streams[0].sampleRate, 48000);
  assert.throws(() => { result.request.origins.range = 'app'; }, TypeError);
  const forged = clone(requested); forged.omissionAuthority = 'approved';
  assert.throws(() => buildOperationContract({ request: forged, videoEvidence: video() }), { code: 'INVALID_OPERATION' });
});

test('top-level request APIs reject unknown fields rather than accepting hidden controls', () => {
  assert.throws(() => createBatchDefaults({ argv: [] }), { code: 'INVALID_OPERATION' });
  assert.throws(() => request({}, { arbitraryPath: 'F:\\input.mp4' }), { code: 'INVALID_OPERATION' });
  assert.throws(() => resolveAudio([], { target: 'matroska', range: full(), audioPolicy: 'copy', downmix: true }), { code: 'INVALID_OPERATION' });
  assert.throws(() => buildOperationContract({ request: request(), videoEvidence: video(), authorized: true }), { code: 'INVALID_OPERATION' });
});

test('already-fitting field-coded input stays unchanged while actual downscale still refuses deinterlacing', () => {
  const source = video(640, 480); source.geometry.fieldOrder = known('tt');
  assert.equal(resolveGeometry(source, '720').filterRequired, false);
  assert.deepEqual(resolveGeometry(source, 'source').output.sampleAspectRatio, { numerator: '1', denominator: '1' });
});

test('rational evidence rejects coerced numbers and absolute timestamp overflow stays explicit', () => {
  const source = video(); source.geometry.sampleAspectRatio.value.numerator = 1;
  assert.throws(() => resolveGeometry(source, '720'), { code: 'GEOMETRY_SAR_UNKNOWN' });
  const badTime = video(); badTime.timeline.startPts = unknown(); badTime.timeline.startSeconds = rational('9223372036855');
  assert.throws(() => resolveTimeRange(badTime, { endUs: 1000000 }), { code: 'RANGE_TIMELINE_OVERFLOW' });
  const noBase = video(); noBase.timeline.timeBase = unknown();
  assert.throws(() => resolveTimeRange(noBase, { endUs: 1000000 }), { code: 'RANGE_TIME_BASE_UNKNOWN' });
});
