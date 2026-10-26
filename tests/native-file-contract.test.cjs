'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { NATIVE_FILE_CANDIDATE, validateNativeFileRequest, fingerprintNativeFileSource, describeNativeFileSource, buildNativeFileContract } = require('../src/native-file-contract.cjs');
const request = (backend = 'qsv') => ({ schema: 1, kind: 'native-file', operation: 'encode', fileId: '11111111-1111-4111-8111-111111111111', identityRevision: 0,
  draftId: '22222222-2222-4222-8222-222222222222', draftRevision: 0, profileId: 'h264-' + backend,
  settings: { preset: backend === 'amf' ? 'balanced' : 'medium', mode: 'cqp', quality: { i: 22, p: 25, b: 28 }, deviceId: '33333333-3333-4333-8333-333333333333' },
  bitDepth: 8, target: 'matroska', resolution: 'source', range: null, signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] });
function probe({ frames = 30, index = 7 } = {}) {
  const duration = (frames / 30).toFixed(6);
  return { streams: [{ index, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360', start_pts: 0, start_time: '0.000000', duration_ts: frames * 512, duration, nb_frames: String(frames), disposition: { default: 1 }, tags: {} }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: '4096', start_time: '0.000000', duration }, chapters: [], programs: [], stream_groups: [] };
}
const describe = (source, chosen = request(), sourceBytes = '4096') => describeNativeFileSource({ probe: source, sourceBytes, request: chosen });
test('the engineering proposal is separate from the tiny probe and grants no qualified source or file execution', () => {
  assert.equal(NATIVE_FILE_CANDIDATE.kind, 'engineering-proposal'); assert.equal(NATIVE_FILE_CANDIDATE.qualificationStatus, 'unqualified');
  assert.equal(NATIVE_FILE_CANDIDATE.width, 1280); assert.equal(NATIVE_FILE_CANDIDATE.height, 720);
  for (const backend of ['amf', 'qsv']) {
    const chosen = request(backend), applicability = describe(probe(), chosen), contract = buildNativeFileContract({ request: chosen, applicability });
    assert.equal(applicability.status, 'structurally-eligible-unqualified'); assert.equal(applicability.executionAuthority, 'none');
    assert.equal(contract.status, 'unqualified'); assert.equal(contract.fileExecutionReady, false); assert.equal(contract.executionAuthority, 'none');
    assert.equal(contract.expectedOutput.sourceVideoIndex, 7); assert.equal(contract.expectedOutput.videoIndex, 0);
    assert.equal(contract.sourceFacts.geometry.rotationDegrees.state, 'unknown'); assert.equal(contract.sourceFacts.orientationAbsence, 'unverified');
    assert.equal(contract.sourceFacts.hdr.coverage, 'stream-metadata-only'); assert.equal(contract.sourceFacts.decodedFrameProof, 'not-collected');
    assert.equal(contract.sourceFacts.container.programs.reportedCount.state, 'unknown');
    assert.ok(contract.qualificationRequirements.includes('independent-native-file-policy')); assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.request.settings.quality));
    for (const key of ['argv', 'input', 'output', 'receipt', 'grant', 'publication']) assert.equal(Object.hasOwn(contract, key), false);
  }
});
test('a saved or edited description cannot become a genuine source contract for a different request', () => {
  const chosen = request(), applicability = describe(probe(), chosen), saved = JSON.parse(JSON.stringify(applicability));
  assert.throws(() => buildNativeFileContract({ request: chosen, applicability: saved }), { code: 'NATIVE_FILE_APPLICABILITY_STALE' });
  const changed = structuredClone(chosen); changed.draftRevision++;
  assert.throws(() => buildNativeFileContract({ request: changed, applicability }), { code: 'NATIVE_FILE_APPLICABILITY_STALE' });
  const outside = describe({ ...probe(), chapters: [{ id: 1, time_base: '1/1000', start: 0, end: 1000 }] });
  assert.throws(() => buildNativeFileContract({ request: chosen, applicability: outside }), { code: 'NATIVE_FILE_SOURCE_UNSUPPORTED' });
});
test('source tags, geometry, clocks, color, stream layout and incomplete relationship observations refuse precisely', () => {
  const cases = [
    [p => { p.streams[0].codec_name = 'hevc'; }, 'NATIVE_FILE_SOURCE_CODEC'],
    [p => { p.streams[0].width = 640; }, 'NATIVE_FILE_SOURCE_GEOMETRY'],
    [p => { p.streams[0].sample_aspect_ratio = '2:1'; }, 'NATIVE_FILE_SOURCE_GEOMETRY'],
    [p => { delete p.streams[0].field_order; }, 'NATIVE_FILE_SOURCE_GEOMETRY'],
    [p => { p.streams[0].tags.rotate = '0'; }, 'NATIVE_FILE_SOURCE_ORIENTATION_OR_SIDE_DATA'],
    [p => { p.streams[0].color_transfer = 'smpte2084'; }, 'NATIVE_FILE_SOURCE_COLOR'],
    [p => { delete p.streams[0].color_primaries; }, 'NATIVE_FILE_SOURCE_COLOR'],
    [p => { p.streams[0].avg_frame_rate = '60/1'; }, 'NATIVE_FILE_SOURCE_TIMELINE'],
    [p => { p.streams[0].duration_ts++; }, 'NATIVE_FILE_SOURCE_TIMELINE'],
    [p => { p.streams[0].start_pts = 1; }, 'NATIVE_FILE_SOURCE_TIMELINE'],
    [p => { delete p.streams[0].nb_frames; }, 'NATIVE_FILE_SOURCE_TIMELINE'],
    [p => { p.format.size = '4097'; }, 'NATIVE_FILE_SOURCE_CONTAINER'],
    [p => { p.streams.push({ index: 9, codec_type: 'audio', codec_name: 'aac' }); p.format.nb_streams = 2; }, 'NATIVE_FILE_SINGLE_VIDEO_REQUIRED'],
    [p => { delete p.programs; }, 'NATIVE_FILE_SOURCE_RELATIONSHIPS'],
    [p => { delete p.stream_groups; }, 'NATIVE_FILE_SOURCE_RELATIONSHIPS'],
    [p => { delete p.chapters; }, 'NATIVE_FILE_SOURCE_RELATIONSHIPS'],
    [p => { p.format.nb_streams = 2; }, 'NATIVE_FILE_SOURCE_RELATIONSHIPS'],
    [p => { p.streams[0].disposition.comment = 1; }, 'NATIVE_FILE_SOURCE_DISPOSITION']
  ];
  for (const [mutate, reason] of cases) { const value = probe(); mutate(value); const result = describe(value); assert.equal(result.status, 'outside-contract'); assert.ok(result.reasonCodes.includes(reason), reason); }
});
test('declared frame/time/byte limits remain finite and exact reporting quantization does not widen on mismatch', () => {
  for (const frames of [15, 16, 900]) assert.equal(describe(probe({ frames })).status, 'structurally-eligible-unqualified');
  for (const frames of [14, 901]) assert.ok(describe(probe({ frames })).reasonCodes.includes('NATIVE_FILE_SOURCE_TIMELINE'));
  const changed = probe({ frames: 16 }); changed.streams[0].duration = '0.533334'; assert.ok(describe(changed).reasonCodes.includes('NATIVE_FILE_SOURCE_TIMELINE'));
  for (const bytes of [0, '0', '004096', '134217729', 'not-a-size']) assert.ok(describe(probe(), request(), bytes).reasonCodes.includes('NATIVE_FILE_SOURCE_SIZE'));
});
test('serialized typed evidence never overrides raw source facts or the versioned fingerprint', () => {
  const value = probe(), first = fingerprintNativeFileSource(value); value.mediaEvidence = { version: 999, streams: [{ geometry: { width: { state: 'known', value: '1' } } }] };
  assert.equal(fingerprintNativeFileSource(value), first); assert.equal(describe(value).facts.geometry.width.value, '1280');
  value.streams[0].width = 640; const result = describe(value); assert.equal(result.status, 'outside-contract'); assert.notEqual(result.sourceProbeFingerprint, first);
});

test('invalid source sizes never retain accessor or cyclic objects in frozen facts', () => {
  let calls = 0;
  const getter = { nested: {} }, cyclic = {};
  Object.defineProperty(getter.nested, 'value', { enumerable: true, get() { calls++; return '4096'; } });
  cyclic.self = cyclic;
  for (const sourceBytes of [getter, cyclic]) {
    const result = describe(probe(), request(), sourceBytes);
    assert.equal(result.status, 'outside-contract');
    assert.ok(result.reasonCodes.includes('NATIVE_FILE_SOURCE_SIZE'));
    assert.equal(result.facts.sourceBytes, null);
  }
  assert.equal(calls, 0);
});
test('requests reject generic paths, serialized authority, unsupported modes and accessor coercion before source work', () => {
  let calls = 0; const objectId = { toString() { calls++; return '11111111-1111-4111-8111-111111111111'; } };
  for (const mutate of [r => { r.fileId = objectId; }, r => { r.input = 'D:\\private.mkv'; }, r => { r.profileId = 'h265-qsv'; }, r => { r.range = { kind: 'Full' }; },
    r => { r.bitDepth = 10; }, r => { r.resolution = '720'; }, r => { r.omissionRequestIds = ['drop-track']; }, r => { r.receipt = {}; },
    r => { r.settings.mode = 'qvbr'; }, r => { r.draftRevision = -1; }]) { const value = request(); mutate(value); assert.throws(() => validateNativeFileRequest(value)); }
  const getter = request(); Object.defineProperty(getter, 'settings', { enumerable: true, get() { calls++; return {}; } }); assert.throws(() => validateNativeFileRequest(getter));
  assert.equal(calls, 0);
});
test('malformed, accessor, sparse and excessive probes refuse without executing getters or using invented evidence', () => {
  let calls = 0; const getter = probe(); Object.defineProperty(getter.streams[0], 'width', { enumerable: true, get() { calls++; return 1280; } });
  const sparse = probe(); delete sparse.streams[0]; const huge = probe(); huge.format.tags = { oversized: 'x'.repeat(16385) };
  for (const value of [getter, sparse, huge, null, { streams: [] }]) assert.ok(describe(value).reasonCodes.includes('NATIVE_FILE_PROBE_INVALID'));
  assert.equal(calls, 0);
});
