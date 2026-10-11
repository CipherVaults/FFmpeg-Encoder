'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMediaEvidence } = require('../src/media-evidence.cjs');
const { describeRecipe, ARCHIVE_RECIPE } = require('../src/media.cjs');
const { buildHdrEncoding, buildHdrIdentityPacking, validateHdrEncodingOutput, HELP_BASIS, MAX_FRAME_SAMPLES } = require('../src/hdr-encoding.cjs');

const cpu = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const gpu = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 };
const mastering = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000',
  green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000',
  white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const light = (maximum = 1000, average = 400) => ({ side_data_type: 'Content light level metadata', max_content: maximum, max_average: average });
const ambient = () => ({ side_data_type: 'Ambient viewing environment', ambient_illuminance: '314/1', ambient_light_x: '15635/50000', ambient_light_y: '16450/50000' });
const dolby = () => ({ side_data_type: 'DOVI configuration record', dv_version_major: 1, dv_version_minor: 0, dv_profile: 8, dv_level: 10,
  rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 4, dv_md_compression: 'none' });
function rawVideo(transfer = 'smpte2084', sideData = [mastering(), light()]) {
  return { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: 320, height: 180,
    pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: transfer, color_primaries: 'bt2020',
    color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left', side_data_list: sideData };
}
const video = (...args) => buildMediaEvidence({ format: {}, streams: [rawVideo(...args)] }).streams[0];
const request = (extra = {}) => ({ settings: cpu, policy: 'preserve', videoEvidence: video(), ...extra });
const build = extra => buildHdrEncoding(request(extra));
const option = (plan, key) => plan.videoEncoderArgs[plan.videoEncoderArgs.indexOf(key) + 1];
function plane(raw = rawVideo()) {
  return { video: structuredClone(raw), frames: [0, 1].map(() => ({ media_type: 'video', stream_index: 0, pix_fmt: raw.pix_fmt,
    color_transfer: raw.color_transfer, color_primaries: raw.color_primaries, color_space: raw.color_space, color_range: raw.color_range,
    chroma_location: raw.chroma_location, interlaced_frame: 0, side_data_list: structuredClone(raw.side_data_list) })),
  coverage: 'full', decodedFrameCount: 2, decodeExitCode: 0 };
}
const observed = raw => ({ container: plane(raw), bitstream: plane(raw) });
const codes = result => result.issues.map(issue => issue.code);

test('CPU writer merges exact HDR units into canonical x265 quality arguments without changing ordinary defaults', () => {
  const before = describeRecipe(cpu).args;
  const plan = build();
  assert.deepEqual(plan.ordinaryRecipeArgs, before);
  assert.equal(option(plan, '-x265-params'), 'aq-mode=3:psy-rd=2:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):cll=1:max-cll=1000,400');
  assert.equal(plan.videoEncoderArgs.filter(arg => arg === '-x265-params').length, 1);
  assert.equal(option(plan, '-preset:v:0'), 'slow'); assert.equal(option(plan, '-crf:v:0'), '25');
  assert.equal(option(plan, '-profile:v:0'), 'main10'); assert.equal(option(plan, '-pix_fmt:v:0'), '+yuv420p10le');
  assert.equal(option(plan, '-dolbyvision:v:0'), '0');
  assert.equal(plan.filterGraph, 'format=yuv420p10le');
  assert.equal(plan.executable, false); assert.equal(plan.status, 'native-qualification-required');
  assert.equal(plan.expectedOutput.hdr10Claim, false); assert.equal(plan.helpBasis, HELP_BASIS);
  assert.deepEqual(describeRecipe(cpu).args, before);
  assert.doesNotMatch(plan.videoEncoderArgs.join(' '), /hdr10-opt|lookahead|repeat-headers/);
});

test('rational serialization refuses precision loss instead of rounding metadata', () => {
  const values = mastering(); values.red_x = '1/3';
  assert.throws(() => build({ videoEvidence: video('smpte2084', [values]) }), { code: 'HDR_METADATA_PRECISION_UNSUPPORTED' });
  values.red_x = '680/1000';
  assert.match(option(build({ videoEvidence: video('smpte2084', [values]) }), '-x265-params'), /R\(34000,16000\)/);
});

test('absent CLL is suppressed while observed unspecified zeros remain explicitly distinct', () => {
  const absent = build({ videoEvidence: video('smpte2084', []) });
  assert.equal(option(absent, '-x265-params'), 'aq-mode=3:psy-rd=2:cll=0');
  assert.equal(absent.expectedOutput.metadata.contentLight, null);
  const unspecified = build({ videoEvidence: video('smpte2084', [light(0, 0)]) });
  assert.equal(option(unspecified, '-x265-params'), 'aq-mode=3:psy-rd=2:cll=1:max-cll=0,0');
  assert.equal(unspecified.expectedOutput.metadata.contentLight.max_content.value, null);
  assert.equal(unspecified.expectedOutput.metadata.contentLight.max_content.signalValue, 0);
  assert.equal(validateHdrEncodingOutput(unspecified, observed(rawVideo('smpte2084', [light(0, 0)]))).valid, true);
  assert.ok(codes(validateHdrEncodingOutput(absent, observed(rawVideo('smpte2084', [light(0, 0)])))).includes('HDR_OBSOLETE_OR_FABRICATED_METADATA'));
});

test('NVENC preserves canonical ordinary and Archive Quality tuples; native metadata path is explicitly conditional', () => {
  for (const settings of [gpu, { ...gpu, preset: 'p7', quality: 29, recipeId: ARCHIVE_RECIPE.id }]) {
    const plan = build({ settings }), baseline = describeRecipe(settings).args;
    assert.deepEqual(plan.videoEncoderArgs.slice(0, baseline.length), baseline);
    assert.match(plan.filterGraph, /^scale=w=iw:h=ih:flags=neighbor\+bitexact\+accurate_rnd:/);
    assert.match(plan.filterGraph, /in_color_matrix=bt2020nc:out_color_matrix=bt2020nc:in_range=tv:out_range=tv/);
    assert.match(plan.filterGraph, /in_chroma_loc=left:out_chroma_loc=left/);
    assert.match(plan.filterGraph, /,format=p010le$/); assert.equal(option(plan, '-pix_fmt:v:0'), '+p010le');
    assert.equal(plan.packingConversion.executable, false);
    assert.ok(plan.qualificationRequirements.includes('identity-packing-full-numeric-sample-and-signal-roundtrip'));
    assert.match(plan.metadataWriter.mastering, /native-qualification-required/);
    assert.ok(plan.qualificationRequirements.includes('nvenc-sdk13-static-metadata-through-actual-filter-and-device'));
    assert.ok(!plan.videoEncoderArgs.includes('-extra_sei')); assert.equal(plan.executable, false);
  }
});

function sourceFrames(raw = rawVideo(), coverage = 'full', count = 2) {
  return { videoIndex: raw.index, coverage, decodedFrameCount: coverage === 'full' ? count : 1000, decodeExitCode: 0,
    frames: Array.from({ length: count }, () => ({ media_type: 'video', stream_index: raw.index, width: raw.width, height: raw.height,
      pix_fmt: raw.pix_fmt, interlaced_frame: 0, color_transfer: raw.color_transfer, color_primaries: raw.color_primaries,
      color_space: raw.color_space, color_range: raw.color_range, chroma_location: raw.chroma_location,
      side_data_list: structuredClone(raw.side_data_list) })) };
}

test('decoded-only static metadata is retained with its actual origins, without inventing stream observations', () => {
  const input = video('smpte2084', []), frames = sourceFrames(rawVideo(), 'full', 96);
  input.geometry.fieldOrder = { state: 'unknown', reason: 'not-reported' };
  const plan = build({ videoEvidence: input, frameEvidence: frames });
  assert.equal(input.hdr.entries.length, 0);
  assert.equal(plan.contract.source.metadataEvidence.origins.mastering.streamObserved, false);
  assert.equal(plan.contract.source.metadataEvidence.origins.mastering.decodedFrameObservations, 96);
  assert.equal(plan.contract.source.scanOrigin, 'complete-decoded-frames');
  assert.equal(plan.contract.source.metadataEvidence.frames.coverage, 'full');
  assert.match(option(plan, '-x265-params'), /master-display=.*:max-cll=1000,400/);
  assert.equal(validateHdrEncodingOutput(plan, observed()).valid, true);
  assert.match(plan.contract.source.metadataEvidence.absenceMeaning, /not-observed/);
});

test('bounded source frames retain their limitation and cannot resolve unknown whole-source scan', () => {
  const input = video('smpte2084', []); input.geometry.fieldOrder = { state: 'unknown', reason: 'not-reported' };
  const plan = build({ videoEvidence: input, frameEvidence: sourceFrames(rawVideo(), 'sampled') });
  assert.equal(plan.contract.source.metadataEvidence.frames.fullSourceGuarantee, false);
  assert.equal(plan.contract.source.scanOrigin, 'unresolved');
  assert.ok(plan.qualificationRequirements.includes('source-progressive-scan-evidence-required'));
  assert.ok(plan.qualificationRequirements.includes('source-hdr-metadata-outside-inspected-evidence-unproven'));
});

test('source metadata reconciliation compares rational values and refuses stream/frame or frame/frame conflicts', () => {
  const frames = sourceFrames(); frames.frames[0].side_data_list[0].red_x = '68/100';
  assert.equal(build({ frameEvidence: frames }).contract.source.metadata.mastering.red_x.numerator, '17');
  frames.frames[1].side_data_list[0].red_x = '67/100';
  assert.throws(() => build({ frameEvidence: frames }), { code: 'HDR_METADATA_CONFLICT' });
  assert.throws(() => build({ videoEvidence: video('smpte2084', []), frameEvidence: frames }), { code: 'HDR_METADATA_CONFLICT' });
});

test('unknown dynamic frame evidence or repeated static payloads never become silent omission', () => {
  for (const extra of [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }, { side_data_type: 'Future opaque payload' }, mastering()]) {
    const frames = sourceFrames(); frames.frames[0].side_data_list.push(extra);
    assert.throws(() => build({ frameEvidence: frames }), error => ['HDR_DYNAMIC_METADATA_UNSUPPORTED', 'HDR_METADATA_AMBIGUOUS'].includes(error.code));
  }
  const frames = sourceFrames(); frames.frames[0].side_data_list.push({ side_data_type: 'H.26[45] User Data Unregistered SEI message' });
  assert.ok(build({ frameEvidence: frames }));
});

test('source frame geometry/color/scan and coverage failures refuse the HDR plan before writing', () => {
  for (const mutate of [e => { e.frames[0].width = 640; }, e => { e.frames[0].height = 181; },
    e => { e.frames[0].pix_fmt = 'yuv420p'; }, e => { e.frames[0].color_transfer = 'bt709'; },
    e => { delete e.frames[0].color_primaries; }, e => { e.frames[0].color_range = 'pc'; },
    e => { e.frames[0].chroma_location = 'center'; }, e => { e.frames[0].interlaced_frame = 1; },
    e => { e.frames[0].stream_index = 1; }, e => { e.videoIndex = 1; }, e => { e.decodeExitCode = 1; },
    e => { e.decodedFrameCount = 3; }, e => { e.frames = []; }, e => { delete e.frames[0]; }]) {
    const frames = sourceFrames(); mutate(frames); assert.throws(() => build({ frameEvidence: frames }));
  }
});

test('known progressive stream declarations cannot override contradictory decoded interlacing', () => {
  const frames = sourceFrames(); frames.frames[1].interlaced_frame = '1';
  assert.throws(() => build({ frameEvidence: frames }), { code: 'HDR_FRAME_GEOMETRY_OR_SCAN_CONFLICT' });
});

test('decoded aspect ratio and crop/cadence anomalies cannot be hidden by matching pixel dimensions', () => {
  const frames = sourceFrames(); frames.frames[0].sample_aspect_ratio = '1:1'; frames.frames[1].sample_aspect_ratio = '2:1';
  assert.throws(() => build({ frameEvidence: frames }), { code: 'HDR_FRAME_GEOMETRY_OR_SCAN_CONFLICT' });
  for (const field of ['crop_left', 'crop_bottom', 'repeat_pict']) {
    const input = sourceFrames(); input.frames[0][field] = 1;
    assert.throws(() => build({ frameEvidence: input }), { code: 'HDR_FRAME_GEOMETRY_OR_SCAN_CONFLICT' });
  }
});

test('native harness warning explanations are exact fixture-scoped evidence, never a generic ignore policy', () => {
  const { classifyWarnings } = require('../scripts/v07-hdr-smoke.cjs');
  const warning = 'x265 [warning]: Source height < 720p; disabling lookahead-slices';
  const qualified = classifyWarnings(warning + '\nunknown warning', 'production-contribution-encode', ['libx265']);
  assert.equal(qualified.explained.length, 1); assert.deepEqual(qualified.unexplained, ['unknown warning']);
  assert.deepEqual(classifyWarnings(warning, 'unrelated', ['libx265']).unexplained, [warning]);
  assert.deepEqual(classifyWarnings(warning, 'production-contribution-encode', ['hevc_nvenc']).unexplained, [warning]);
});

test('elementary extraction analysis detects picture timing before SPS and proves a header-only correction', () => {
  const { analyzeAnnexB } = require('../scripts/v07-hdr-smoke.cjs');
  const nal = (type, body) => Buffer.from([0, 0, 0, 1, type << 1, 1, ...body]);
  const parameterSets = Buffer.concat([nal(32, [128]), nal(33, [128]), nal(34, [128])]);
  const timing = nal(39, [1, 3, 0, 0, 10, 128]), picture = nal(19, [123, 128]);
  const old = Buffer.concat([timing, parameterSets, picture]);
  const corrected = Buffer.concat([parameterSets, old]);
  const before = analyzeAnnexB(old), after = analyzeAnnexB(corrected);
  assert.deepEqual(before.issues, [{ code: 'PICTURE_TIMING_BEFORE_SPS', nalIndex: 0 }]);
  assert.deepEqual(after.issues, []);
  assert.equal(before.nonParameterSetSequenceSha256, after.nonParameterSetSequenceSha256);
  assert.deepEqual(before.parameterSetHashes, after.parameterSetHashes);
  const removed = analyzeAnnexB(Buffer.concat([parameterSets, picture]));
  assert.notEqual(removed.nonParameterSetSequenceSha256, before.nonParameterSetSequenceSha256);
  const changed = analyzeAnnexB(Buffer.concat([parameterSets, nal(39, [1, 3, 0, 0, 11, 128]), picture]));
  assert.notEqual(changed.nonParameterSetSequenceSha256, before.nonParameterSetSequenceSha256);
  assert.throws(() => analyzeAnnexB(nal(39, [1, 8, 1, 128])), /Complete SEI/);
  assert.throws(() => analyzeAnnexB(Buffer.from([1, 2, 3])), /Annex B/);
});

test('colored raw fixture exercises distinct chroma ramps, grids, impulses and ten-bit boundary codes within its declared budget', () => {
  const { colorPackingSpec, colorPackingFrame, COLOR_LIMITS } = require('../scripts/v07-hdr-smoke.cjs');
  const spec = colorPackingSpec(), frames = Array.from({ length: spec.frames }, (_, index) => colorPackingFrame(index));
  assert.equal(spec.frames, 4); assert.equal(spec.rawBytes, 691200);
  assert.equal(spec.expectedRawArtifactBytes, 3456000); assert.ok(spec.expectedRawArtifactBytes < COLOR_LIMITS.ownedBytes);
  assert.equal(COLOR_LIMITS.ownedBytes, 4 * 1024 * 1024); assert.equal(COLOR_LIMITS.invocations, 6);
  const lumaBytes = 320 * 180 * 2, chromaBytes = 160 * 90 * 2;
  for (const [index, bytes] of frames.entries()) {
    assert.equal(bytes.length, spec.frameBytes); assert.deepEqual(bytes, colorPackingFrame(index));
    assert.notDeepEqual(bytes.subarray(lumaBytes, lumaBytes + chromaBytes), bytes.subarray(lumaBytes + chromaBytes));
    for (const start of [0, lumaBytes, lumaBytes + chromaBytes]) {
      const firstCodes = Array.from({ length: 16 }, (_, code) => bytes.readUInt16LE(start + code * 2));
      assert.deepEqual([...firstCodes].sort((a, b) => a - b), spec.boundaryCodes);
    }
  }
  const sample = (frame, plane, x, y) => frames[frame].readUInt16LE(lumaBytes + plane * chromaBytes + (y * 160 + x) * 2);
  assert.equal(sample(0, 0, 159, 10), 1023); assert.equal(sample(0, 1, 80, 89), 1023);
  assert.equal(sample(0, 0, 0, 10), 0); assert.equal(sample(0, 1, 80, 0), 0);
  assert.equal(sample(2, 0, 10, 14), 1023); assert.equal(sample(2, 1, 18, 8), 64);
  assert.equal(sample(3, 0, 23, 17), 0); assert.equal(sample(3, 1, 23, 17), 1023);
  assert.equal(sample(3, 0, 24, 17), 512); assert.equal(sample(3, 1, 24, 17), 512);
  assert.throws(() => colorPackingFrame(-1)); assert.throws(() => colorPackingFrame(4)); assert.throws(() => colorPackingFrame(1.1));
});

test('colored packing validates every packed word independently as well as every restored sample', () => {
  const { colorPackingFrame, expectedColorPacking, validateColorPacking } = require('../scripts/v07-hdr-smoke.cjs');
  const planar = Buffer.concat(Array.from({ length: 4 }, (_, index) => colorPackingFrame(index)));
  const packed = expectedColorPacking(planar), restored = Buffer.from(planar), lumaBytes = 320 * 180 * 2;
  // Literal specification spot checks: U[0]=511, V[0]=941 in frame zero;
  // P010 must interleave U then V with six zero low bits, unlike planar10.
  assert.equal(packed.readUInt16LE(lumaBytes), 511 * 64);
  assert.equal(packed.readUInt16LE(lumaBytes + 2), 941 * 64);
  assert.equal(packed.readUInt16LE(2), 64);
  const result = validateColorPacking(planar, packed, restored);
  assert.equal(result.totalSamplesComparedPerDirection, 345600);
  assert.equal(result.allPackedWordsMatchIndependentLayout, true); assert.equal(result.allRestoredSamplesMatch, true);
  assert.equal(result.sourceSha256, result.restoredSha256); assert.equal(result.expectedPackedSha256, result.actualPackedSha256);
  assert.equal(result.frames.length, 4);
  for (const frame of result.frames) {
    assert.equal(frame.sourceSha256, frame.restoredSha256);
    for (const plane of Object.values(frame.planes)) { assert.equal(plane.minimum, 0); assert.equal(plane.maximum, 1023); }
  }
  const swapped = Buffer.from(packed), firstU = swapped.readUInt16LE(lumaBytes);
  swapped.writeUInt16LE(swapped.readUInt16LE(lumaBytes + 2), lumaBytes); swapped.writeUInt16LE(firstU, lumaBytes + 2);
  assert.throws(() => validateColorPacking(planar, swapped, restored), /Packed word differs/);
  const lowBit = Buffer.from(packed); lowBit[0] ^= 1;
  assert.throws(() => validateColorPacking(planar, lowBit, restored), /Packed word differs/);
  const damaged = Buffer.from(restored); damaged[damaged.length - 2] ^= 1;
  assert.throws(() => validateColorPacking(planar, packed, damaged), /Restored sample differs/);
  assert.throws(() => validateColorPacking(planar, packed.subarray(0, packed.length - 2), restored), /Complete packed/);
  assert.throws(() => validateColorPacking(planar, packed, restored.subarray(0, restored.length - 2)), /Complete unpacked/);
  const overflow = Buffer.from(planar); overflow.writeUInt16LE(1024, 0);
  assert.throws(() => expectedColorPacking(overflow), /ten significant bits/);
});

test('frame evidence remains immutable and unknown native-layout chroma refuses a runnable contribution', () => {
  const frames = sourceFrames(), plan = build({ videoEvidence: video('smpte2084', []), frameEvidence: frames });
  frames.frames[0].side_data_list[1].max_content = 300;
  assert.equal(plan.expectedOutput.metadata.contentLight.max_content.value, 1000);
  const input = video(); input.color.chromaLocation = { state: 'unknown', reason: 'not-reported' };
  const blocked = build({ settings: gpu, videoEvidence: input });
  assert.equal(blocked.filterGraph, null); assert.equal(blocked.videoEncoderArgs, null);
  assert.ok(blocked.missingWriters.some(item => item.code === 'HDR_PACKING_CHROMA_UNRESOLVED'));
});

test('identity packing is bidirectional but cannot change depth, range, color or arbitrary geometry', () => {
  const input = { inputFormat: 'yuv420p10le', outputFormat: 'p010le', transfer: 'smpte2084', primaries: 'bt2020', matrix: 'bt2020nc', range: 'tv', chromaLocation: 'left' };
  const forward = buildHdrIdentityPacking(input), reverse = buildHdrIdentityPacking({ ...input, inputFormat: 'p010le', outputFormat: 'yuv420p10le' });
  assert.match(forward.filterGraph, /format=p010le$/); assert.match(reverse.filterGraph, /format=yuv420p10le$/);
  for (const extra of [{ outputFormat: 'yuv420p' }, { range: 'pc' }, { matrix: 'bt709' }, { chromaLocation: null }, { width: 640 }, { filter: 'movie=secret' }]) {
    assert.throws(() => buildHdrIdentityPacking({ ...input, ...extra }));
  }
  const evidence = video(); evidence.color.pixelFormat.value = 'p010le';
  const cpuPlan = build({ videoEvidence: evidence }); assert.match(cpuPlan.filterGraph, /^scale=/);
  assert.equal(cpuPlan.packingConversion.inputFormat, 'p010le');
});

test('ambient metadata remains descriptive but blocks a runnable contribution; no omission is invented', () => {
  for (const settings of [cpu, gpu]) {
    const plan = build({ settings, videoEvidence: video('arib-std-b67', [ambient()]) });
    assert.equal(plan.status, 'writer-unavailable'); assert.equal(plan.videoEncoderArgs, null); assert.equal(plan.filterGraph, null);
    assert.equal(plan.missingWriters[0].code, 'HDR_AMBIENT_WRITER_UNQUALIFIED');
    assert.deepEqual(plan.expectedOutput.metadata.ambient.ambient_illuminance, { numerator: '314', denominator: '1' });
    assert.deepEqual(codes(validateHdrEncodingOutput(plan, observed(rawVideo('arib-std-b67', [ambient()])))), ['HDR_WRITER_UNAVAILABLE']);
  }
});

test('HLG preservation remains HLG; SDR conversion uses actual filters and removes obsolete static metadata', () => {
  const hlg = build({ videoEvidence: video('arib-std-b67', []) });
  assert.equal(option(hlg, '-color_trc:v:0'), 'arib-std-b67'); assert.doesNotMatch(hlg.filterGraph, /tonemap/);
  const sdr = build({ policy: 'sdr', outputBitDepth: 8 });
  assert.match(sdr.filterGraph, /format=gbrpf32le/); assert.match(sdr.filterGraph, /tonemap=tonemap=hable:desat=2:peak=10/);
  assert.match(sdr.filterGraph, /sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA/);
  assert.equal(option(sdr, '-profile:v:0'), 'main'); assert.equal(option(sdr, '-color_trc:v:0'), 'bt709');
  assert.equal(option(sdr, '-x265-params'), 'aq-mode=3:psy-rd=2:cll=0');
  assert.deepEqual(sdr.expectedOutput.metadata, { mastering: null, contentLight: null, ambient: null });
  const raw = { ...rawVideo('bt709', []), profile: 'Main', pix_fmt: 'yuv420p', color_primaries: 'bt709', color_space: 'bt709' };
  assert.equal(validateHdrEncodingOutput(sdr, observed(raw)).valid, true);
  raw.side_data_list = [mastering()];
  assert.equal(validateHdrEncodingOutput(sdr, observed(raw)).valid, false);
});

test('Dolby choices remain unbound decisions, never falsely retained Dolby or automatic HDR10', () => {
  const phone = video('arib-std-b67', [dolby(), ambient()]);
  assert.throws(() => build({ videoEvidence: phone }), { code: 'HDR_DOLBY_CHOICE_REQUIRED' });
  const base = build({ policy: 'hlg-base', videoEvidence: phone });
  assert.equal(base.status, 'writer-unavailable'); assert.equal(base.decisionRequirements[0].authority, 'unbound');
  const sdr = build({ policy: 'sdr', videoEvidence: phone });
  assert.match(sdr.filterGraph, /DOVI_RPU_BUFFER/); assert.equal(sdr.decisionRequirements[0].scope, 'exact-source-and-draft');
  const pq = build({ policy: 'dolby-pq', videoEvidence: phone });
  assert.match(pq.filterGraph, /apply_dolbyvision=1/); assert.equal(pq.expectedOutput.dolbyVision, false);
  assert.equal(pq.expectedOutput.hdr10Claim, false); assert.equal(pq.expectedOutput.metadata.mastering, null);
  assert.ok(pq.qualificationRequirements.includes('dolby-on-off-controlled-comparison'));
});

test('unknown source scan and chroma evidence remain explicit qualification requirements', () => {
  const evidence = video(); evidence.geometry.fieldOrder = { state: 'unknown', reason: 'not-reported' };
  evidence.color.chromaLocation = { state: 'unknown', reason: 'not-reported' };
  const plan = build({ videoEvidence: evidence });
  assert.ok(plan.qualificationRequirements.includes('source-progressive-scan-evidence-required'));
  assert.ok(plan.qualificationRequirements.includes('source-and-output-chroma-siting-qualification'));
  assert.ok(!plan.videoEncoderArgs.includes('-chroma_sample_location:v:0'));
});

test('builder refuses unrelated paths, argv, SDR bypass, unqualified encoders/containers and hostile structured input', () => {
  assert.throws(() => build({ argv: ['-y'] }), { code: 'INVALID_HDR_ENCODING' });
  assert.throws(() => build({ target: 'mp4' }), { code: 'HDR_CONTAINER_UNQUALIFIED' });
  assert.throws(() => build({ settings: { profileId: 'av1-cpu', preset: '6', quality: 32 } }), { code: 'HDR_ENCODER_UNQUALIFIED' });
  assert.throws(() => build({ videoEvidence: video('bt709', []) }), { code: 'HDR_EXISTING_SDR_PATH' });
  const accessor = request(); Object.defineProperty(accessor, 'settings', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => buildHdrEncoding(accessor), { code: 'INVALID_HDR_ENCODING' });
  const cycle = request(); cycle.videoEvidence.self = cycle;
  assert.throws(() => buildHdrEncoding(cycle), { code: 'INVALID_HDR_ENCODING' });
  const hostile = request(); Object.defineProperty(hostile.videoEvidence, '__proto__', { enumerable: true, value: {} });
  assert.throws(() => buildHdrEncoding(hostile), { code: 'INVALID_HDR_ENCODING' });
});

test('plan is an immutable snapshot; serialization cannot restore validation authority', () => {
  const input = request(), plan = buildHdrEncoding(input);
  input.videoEvidence.color.transfer.value = 'bt709'; input.settings = gpu;
  assert.equal(plan.expectedOutput.signal.transfer, 'smpte2084');
  assert.throws(() => { plan.videoEncoderArgs[0] = '-y'; }, TypeError);
  assert.equal(plan.sourceHdrEvidenceSha256.length, 64);
  assert.deepEqual(codes(validateHdrEncodingOutput(structuredClone(plan), observed())), ['HDR_PLAN_NOT_OWNED']);
});

test('independent output evidence checks both container and elementary stream with bounded decoded frames', () => {
  const plan = build(), evidence = observed();
  evidence.bitstream.video.side_data_list[0].red_x = '68/100';
  const result = validateHdrEncodingOutput(plan, evidence);
  assert.equal(result.valid, true); assert.equal(result.publicationAuthorized, false); assert.equal(result.capabilityGranted, false);
  assert.equal(result.perceptualAcceptance, 'not-assessed');
  evidence.bitstream.video.color_transfer = 'bt709';
  assert.equal(validateHdrEncodingOutput(plan, evidence).valid, false);
});

test('per-frame inconsistent color and bit depth fail even when container metadata looks correct', () => {
  for (const [field, changed] of [['color_transfer', 'bt709'], ['color_primaries', 'bt709'], ['color_range', 'pc'], ['pix_fmt', 'yuv420p'], ['chroma_location', 'center']]) {
    const evidence = observed(); evidence.bitstream.frames[1][field] = changed;
    const result = validateHdrEncodingOutput(build(), evidence);
    assert.ok(result.issues.some(issue => issue.code === 'HDR_OUTPUT_SIGNAL_MISMATCH' && issue.frame === 1 && issue.field === field));
  }
});

test('all present metadata copies must agree; a matching stream entry cannot hide contradictory frames', () => {
  const plan = build(), evidence = observed();
  evidence.bitstream.frames[1].side_data_list[0].max_luminance = '999/1';
  assert.ok(codes(validateHdrEncodingOutput(plan, evidence)).includes('HDR_OUTPUT_METADATA_MISMATCH'));
  evidence.bitstream.frames[1].side_data_list = [mastering(), light(1000, 401)];
  assert.ok(codes(validateHdrEncodingOutput(plan, evidence)).includes('HDR_OUTPUT_METADATA_MISMATCH'));
  evidence.bitstream.frames[1].side_data_list = [mastering(), mastering(), light()];
  assert.ok(codes(validateHdrEncodingOutput(plan, evidence)).includes('HDR_OUTPUT_METADATA_DUPLICATE'));
});

test('required metadata may appear on decoded frames but cannot disappear from one whole observation plane', () => {
  const plan = build(), evidence = observed(); evidence.bitstream.video.side_data_list = [];
  assert.equal(validateHdrEncodingOutput(plan, evidence).valid, true);
  evidence.bitstream.frames.forEach(frame => { frame.side_data_list = []; });
  assert.ok(codes(validateHdrEncodingOutput(plan, evidence)).includes('HDR_REQUIRED_METADATA_MISSING'));
});

test('unexpected Dolby/dynamic/ambient payloads fail; unrelated user-data SEI does not manufacture HDR authority', () => {
  const plan = build();
  for (const type of ['DOVI configuration record', 'Dolby Vision RPU Data', 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)', 'Ambient viewing environment', 'unrecognized future HDR payload']) {
    const evidence = observed(); evidence.container.frames[1].side_data_list.push({ side_data_type: type });
    assert.equal(validateHdrEncodingOutput(plan, evidence).valid, false);
  }
  const evidence = observed(); evidence.container.frames[0].side_data_list.push({ side_data_type: 'H.26[45] User Data Unregistered SEI message' });
  assert.equal(validateHdrEncodingOutput(plan, evidence).valid, true);
});

test('incomplete failed sparse or excessive decode evidence cannot pass validation', () => {
  const plan = build();
  for (const mutate of [item => { item.frames = []; }, item => { item.decodeExitCode = 1; },
    item => { item.decodedFrameCount = 3; }, item => { item.coverage = 'assumed'; },
    item => { item.frames = Array(MAX_FRAME_SAMPLES + 1).fill(item.frames[0]); }]) {
    const evidence = observed(); mutate(evidence.bitstream);
    assert.equal(validateHdrEncodingOutput(plan, evidence).valid, false);
  }
  const sampled = observed(); sampled.container.coverage = 'sampled'; sampled.container.decodedFrameCount = 1000;
  const sampledResult = validateHdrEncodingOutput(plan, sampled);
  assert.equal(sampledResult.valid, true);
  assert.deepEqual(sampledResult.coverage.container, { kind: 'sampled', observedFrames: 2, decodedFrameCount: 1000 });
  const sparse = observed(); delete sparse.container.frames[0];
  assert.equal(validateHdrEncodingOutput(plan, sparse).valid, false);
});

test('wrong stream identity and unresolved/proven interlacing fail independently of expected color', () => {
  for (const change of [item => { item.video.profile = 'Main'; }, item => { item.video.field_order = 'tt'; },
    item => { item.frames[0].stream_index = 1; }, item => { item.frames[0].interlaced_frame = 1; },
    item => { delete item.frames[0].interlaced_frame; }]) {
    const evidence = observed(); change(evidence.container);
    assert.equal(validateHdrEncodingOutput(build(), evidence).valid, false);
  }
});

test('complete progressive decoded frames resolve only absent or unknown stream scan declarations', () => {
  for (const missing of [true, false]) {
    const evidence = observed();
    for (const planeName of ['container', 'bitstream']) {
      const item = evidence[planeName];
      if (missing) delete item.video.field_order; else item.video.field_order = 'unknown';
      item.frames = Array.from({ length: 96 }, (_, index) => ({ ...item.frames[0], interlaced_frame: index % 2 ? '0' : 0 }));
      item.decodedFrameCount = 96;
    }
    const result = validateHdrEncodingOutput(build(), evidence);
    assert.equal(result.valid, true);
    for (const planeName of ['container', 'bitstream']) assert.deepEqual(result.coverage[planeName], {
      kind: 'full', observedFrames: 96, decodedFrameCount: 96, scanModeEvidence: 'complete-progressive-decoded-frames'
    });
    assert.equal(result.publicationAuthorized, false); assert.equal(result.capabilityGranted, false);
  }
});

test('unknown stream scan cannot be resolved by sampled, failed or count-inconsistent evidence', () => {
  for (const mutate of [item => { item.coverage = 'sampled'; },
    item => { item.coverage = 'sampled'; item.decodedFrameCount = 1000; },
    item => { item.decodedFrameCount = 3; }, item => { item.decodedFrameCount = 1; },
    item => { item.decodeExitCode = 1; }, item => { item.frames = []; }]) {
    const evidence = observed(); evidence.bitstream.video.field_order = 'unknown'; mutate(evidence.bitstream);
    const result = validateHdrEncodingOutput(build(), evidence);
    assert.equal(result.valid, false); assert.equal(result.coverage.bitstream?.scanModeEvidence, undefined);
  }
});

test('explicit interlaced, malformed or conflicting stream scan always fails despite full progressive frames', () => {
  for (const declaration of ['tt', 'bb', 'tb', 'bt', 'interlaced', '', null, 0, 'Progressive']) {
    const evidence = observed(); evidence.bitstream.video.field_order = declaration;
    const result = validateHdrEncodingOutput(build(), evidence);
    assert.equal(result.valid, false); assert.ok(codes(result).includes('HDR_OUTPUT_SCAN_UNRESOLVED'));
    assert.equal(result.coverage.bitstream.scanModeEvidence, undefined);
  }
});

test('absent stream scan does not override interlaced, missing or wrong-identity decoded frames', () => {
  for (const mutate of [frame => { frame.interlaced_frame = 1; }, frame => { frame.interlaced_frame = '1'; },
    frame => { delete frame.interlaced_frame; }, frame => { frame.interlaced_frame = 'unknown'; },
    frame => { frame.interlaced_frame = false; }, frame => { frame.stream_index = 1; },
    frame => { frame.media_type = 'audio'; }]) {
    const evidence = observed(); delete evidence.container.video.field_order; mutate(evidence.container.frames[1]);
    const result = validateHdrEncodingOutput(build(), evidence);
    assert.equal(result.valid, false); assert.ok(codes(result).includes('HDR_OUTPUT_SCAN_UNRESOLVED'));
    assert.equal(result.coverage.container.scanModeEvidence, undefined);
  }
});

test('validation refuses getters without executing them and reports excess issues truthfully', () => {
  const evidence = observed(); Object.defineProperty(evidence.container.video, 'color_transfer', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.deepEqual(codes(validateHdrEncodingOutput(build(), evidence)), ['INVALID_HDR_ENCODING']);
  const many = observed(); many.container.frames = Array.from({ length: 200 }, () => ({ ...many.container.frames[0], color_transfer: 'bt709', color_range: 'pc' }));
  many.container.decodedFrameCount = 200;
  const result = validateHdrEncodingOutput(build(), many);
  assert.equal(result.valid, false); assert.equal(result.issues.length, 128); assert.equal(result.issueCount, 400); assert.equal(result.issuesTruncated, true);
});
