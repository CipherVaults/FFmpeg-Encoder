'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEncodeOperation, validateEncodeOperationOutput, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { buildEncodeArgs, PROFILES, ARCHIVE_RECIPE, classifyColor } = require('../src/media.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const clone = value => structuredClone(value);
const RUNTIME = 'ffmpeg9.0.2:qualified-pair-fixture';
const OUTPUT_ID = '3f4c3d1f-891e-497e-8daf-690151ae4dc7';
function source({ width = 1920, height = 1080, origin = 0, duration = 4 } = {}) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width, height,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', sample_aspect_ratio: '1:1',
    display_aspect_ratio: `${width}:${height}`, field_order: 'progressive', avg_frame_rate: '25/1', r_frame_rate: '25/1',
    time_base: '1/1000', start_pts: origin * 1000, start_time: String(origin), duration_ts: duration * 1000, duration: String(duration),
    tags: { rotate: '0', title: 'Source video' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', channels: 2, channel_layout: 'stereo', sample_rate: '48000',
    time_base: '1/48000', start_pts: origin * 48000, start_time: String(origin), duration_ts: duration * 48000, duration: String(duration),
    tags: { title: 'Keep my audio', language: 'eng' }, disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration), start_time: String(origin), nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Keep my source metadata' } },
  programs: [], stream_groups: [], chapters: [] };
}
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
function request(overrides = {}) { return resolveFileRequest({ fileId: 'file-1', identityRevision: 2, draftRevision: 3, operation: 'encode', overrides }); }
function options(probe = source(), overrides = {}, extra = {}) {
  return { input: 'F:\\source\\input.mp4', output: 'F:\\owned\\out.mkv', settings,
    inspection: { probe, color: classifyColor(probe), duration: Number(probe.format.duration), evidence: {}, summary: {} },
    request: request(overrides), runtimeIdentity: RUNTIME, ...extra };
}
function build(probe = source(), overrides = {}, extra = {}) { return buildEncodeOperation(options(probe, overrides, extra)); }
function option(args, flag) { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
function output(probe, plan, duration = 1) {
  const result = clone(probe);
  result.format.format_name = 'matroska,webm'; result.format.duration = String(duration); result.format.start_time = '0';
  result.streams = plan.expectedOutput.streams.map(mapping => {
    const stream = clone(probe.streams.find(item => item.index === mapping.inputIndex));
    stream.index = mapping.outputIndex; stream.codec_name = mapping.codecName; stream.start_time = '0'; stream.start_pts = 0;
    delete stream.duration; delete stream.duration_ts;
    if (mapping.outputIndex === 0) {
      stream.width = plan.contract.geometry.output.width; stream.height = plan.contract.geometry.output.height;
      const sar = plan.contract.geometry.output.sampleAspectRatio;
      if (sar) stream.sample_aspect_ratio = `${sar.numerator}:${sar.denominator}`;
      stream.display_aspect_ratio = `${stream.width}:${stream.height}`;
      if (plan.contract.geometry.filterRequired) { stream.tags.rotate = '0'; delete stream.side_data_list; }
    }
    const audio = plan.contract.audio.streams.find(item => item.index === mapping.inputIndex);
    if (audio?.mode === 'precision-flac') stream.sample_fmt = audio.sourceSampleFormat.startsWith('s16') ? 's16' : 's32';
    return stream;
  });
  if (plan.expectedOutput.outputId) Object.assign(result.format.tags, { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: plan.expectedOutput.outputId });
  return result;
}
function qualification(changes = {}) { return { evidenceId: 'synthetic-direct-fixture-only', runtimeIdentity: RUNTIME, containerDuration: 'end-timestamp',
  tolerances: { videoTimestampUs: 1000, audioTimestampUs: 1000, avSyncUs: 1000, durationUs: 2000, sampleCount: 0 }, ...changes }; }
function decoded({ origin = 1000000, outputOrigin = 0, seconds = 1 } = {}) {
  return { video: { sourceFrameCount: seconds * 25, outputFrameCount: seconds * 25, firstSourcePtsUs: origin, lastSourcePtsUs: origin + seconds * 1000000 - 40000,
    lastSourceDurationUs: 40000, firstOutputPtsUs: outputOrigin, lastOutputPtsUs: outputOrigin + seconds * 1000000 - 40000, lastOutputDurationUs: 40000,
    comparedFrames: seconds * 25, maxRebasedTimestampErrorUs: 0 },
  audio: [{ inputIndex: 2, sourceSampleCount: seconds * 48000, outputSampleCount: seconds * 48000, firstSourcePtsUs: origin, lastSourceEndUs: origin + seconds * 1000000,
    firstOutputPtsUs: outputOrigin, lastOutputEndUs: outputOrigin + seconds * 1000000, encoderDelaySamples: 0, discardPaddingSamples: 0 }] };
}

test('every ordinary profile and Archive CQ29 retain byte-for-byte accepted builder argv', () => {
  const probe = source();
  // The old path must not require the new schema, reported relationships or SAR.
  delete probe.programs; delete probe.stream_groups; delete probe.format.nb_streams;
  delete probe.streams[0].sample_aspect_ratio; delete probe.streams[0].time_base;
  for (const config of [...PROFILES.map(profile => ({ profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default })),
    { profileId: 'h265-nvidia', preset: 'p7', quality: 29, recipeId: ARCHIVE_RECIPE.id }]) {
    const opts = options(probe, {}, { settings: config, runtimeIdentity: null }), result = buildEncodeOperation(opts);
    assert.equal(result.compatibilityPath, true);
    assert.deepEqual(result.args, buildEncodeArgs({ input: opts.input, output: opts.output, settings: config, probe,
      colorEvidence: opts.inspection.color }));
    assert.deepEqual(result.qualificationRequirements, []);
    assert.equal(result.args.includes('-copyts'), false); assert.equal(result.args.includes('-filter:v:0'), false);
  }
});

test('pinned Windows Full MOV mono PCM copy refuses before building the incompatible output', () => {
  const probe = source({ width: 1280, height: 720 });
  Object.assign(probe.streams[1], { codec_name: 'pcm_s16le', codec_tag_string: 'sowt', sample_fmt: 's16', channels: 1, channel_layout: 'mono' });
  const runtime = { runtimeIdentity: REGULAR_WINDOWS_PAIR };
  assert.throws(() => build(probe, {}, runtime), {
    code: 'ENCODE_PCM_LAYOUT_COPY_UNAVAILABLE',
    message: /cannot preserve.*declared mono PCM layout/,
  });
  assert.throws(() => build(probe, { resolution: '1080' }, runtime), { code: 'ENCODE_PCM_LAYOUT_COPY_UNAVAILABLE' });
  assert.equal(build(probe).compatibilityPath, true);
  assert.equal(build(source(), {}, runtime).compatibilityPath, true);
  const matroska = clone(probe);
  matroska.format.format_name = 'matroska,webm';
  assert.equal(build(matroska, {}, runtime).compatibilityPath, true);
  const range = build(probe, { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-flac' }, runtime);
  assert.equal(range.compatibilityPath, false);
  assert.equal(option(range.args, '-c:a:0'), 'flac');
});

test('legacy validation remains available without synthetic new decoded evidence', () => {
  const probe = source(), plan = build(probe), actual = output(probe, plan, 4);
  const result = validateEncodeOperationOutput(plan, actual);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.validation, 'accepted-full-validator');
  actual.streams[1].tags.title = 'Lost the metadata';
  assert.equal(validateEncodeOperationOutput(plan, actual).valid, false);
});

test('precision AAC range encodes every selected audio segment and shares one clock with video', () => {
  const probe = source({ origin: 10 });
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } });
  assert.equal(plan.compatibilityPath, false);
  assert.equal(option(plan.args, '-filter:v:0'), 'settb=expr=1/1000,trim=start_pts=11000:end_pts=12000,setpts=PTS-(11000)');
  assert.equal(option(plan.args, '-filter:a:0'), 'asettb=expr=1/48000,atrim=start_pts=528000:end_pts=576000,asetpts=PTS-(528000)');
  assert.equal(option(plan.args, '-c:a:0'), 'aac'); assert.equal(option(plan.args, '-profile:a:0'), 'aac_low');
  assert.equal(option(plan.args, '-b:a:0'), '320k'); assert.equal(option(plan.args, '-ar:a:0'), '48000');
  assert.equal(option(plan.args, '-channel_layout:a:0'), 'stereo');
  assert.ok(plan.args.includes('-copyts')); assert.ok(plan.args.includes('-noautorotate'));
  assert.equal(option(plan.args, '-enc_time_base:v:0'), 'filter');
  assert.equal(plan.args.some(value => value.includes('STARTPTS')), false);
  for (const forbidden of ['-shortest', '-r', '-t', '-to', '-af', '-vf', '-y']) assert.equal(plan.args.includes(forbidden), false);
});

test('start-only/end-only/VFR/negative-origin requests use exact PTS bounds instead of guessed frame numbers', () => {
  const probe = source({ origin: -1 }); probe.streams[0].avg_frame_rate = '23987/1000';
  const start = build(probe, { range: { startUs: 1000000 } });
  assert.equal(option(start.args, '-filter:v:0'), 'settb=expr=1/1000,trim=start_pts=0:end_pts=3000,setpts=PTS-(0)');
  const end = build(probe, { range: { endUs: 1500000 } });
  assert.equal(option(end.args, '-filter:v:0'), 'settb=expr=1/1000,trim=start_pts=-1000:end_pts=500,setpts=PTS-(-1000)');
  assert.equal(option(end.args, '-ss'), undefined);
});

test('late seeking retains source PTS and preroll; filters still select the exact final interval', () => {
  const probe = source({ origin: 10, duration: 1000 });
  const plan = build(probe, { range: { startUs: 500000000, endUs: 501000000 } });
  assert.equal(option(plan.args, '-ss'), '505.000000'); assert.equal(option(plan.args, '-seek_timestamp'), '1');
  assert.ok(plan.args.indexOf('-ss') < plan.args.indexOf('-i')); assert.ok(plan.args.includes('-noaccurate_seek'));
  assert.equal(option(plan.args, '-filter:v:0'), 'settb=expr=1/1000,trim=start_pts=510000:end_pts=511000,setpts=PTS-(510000)');
  assert.equal(plan.expectedOutput.inputSeek.verifiedBound, false);
});

test('actual downscale uses only planned geometry and explicit color/SAR with no frame-rate or HDR transform', () => {
  const probe = source({ width: 3840, height: 2160 }), plan = build(probe, { resolution: '1080' });
  assert.equal(plan.contract.geometry.output.width, 1920); assert.equal(plan.contract.geometry.output.height, 1080);
  assert.match(option(plan.args, '-filter:v:0'), /scale=w=1920:h=1080:flags=lanczos\+accurate_rnd:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv/);
  assert.match(option(plan.args, '-filter:v:0'), /setsar=sar=\(1\/1\):max=2147483647/);
  assert.equal(option(plan.args, '-display_rotation:0'), '0');
  assert.equal(plan.args.some(value => /tonemap|yadif|bwdif|crop|pad=/.test(value)), false);
  const fitting = build(source({ width: 640, height: 360 }), { resolution: '720' });
  assert.equal(fitting.compatibilityPath, true); assert.equal(fitting.args.includes('-filter:v:0'), false);
});

test('orthogonal rotate is explicit once; portrait dimensions are not stretched into landscape', () => {
  const probe = source({ width: 3840, height: 2160 }); probe.streams[0].tags.rotate = '90';
  const plan = build(probe, { resolution: '1080' });
  assert.deepEqual([plan.contract.geometry.output.width, plan.contract.geometry.output.height], [1080, 1920]);
  assert.match(option(plan.args, '-filter:v:0'), /^transpose=cclock,scale=w=1080:h=1920/);
  assert.match(option(plan.args, '-filter:v:0'), /sidedata=mode=delete:type=DISPLAYMATRIX$/);
});

test('multiple audio tracks retain independent rate/layout and receive entire-segment filters', () => {
  const probe = source(); probe.streams.push({ ...clone(probe.streams[1]), index: 7, sample_rate: '44100', channels: 1, channel_layout: 'mono' }); probe.format.nb_streams = 3;
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } });
  assert.equal(option(plan.args, '-b:a:0'), '320k'); assert.equal(option(plan.args, '-b:a:1'), '128k');
  assert.equal(option(plan.args, '-ar:a:1'), '44100'); assert.equal(option(plan.args, '-channel_layout:a:1'), 'mono');
  assert.equal(option(plan.args, '-filter:a:1'), 'asettb=expr=1/44100,atrim=start_pts=44100:end_pts=88200,asetpts=PTS-(44100)');
  assert.deepEqual(plan.expectedOutput.streams.map(item => [item.inputIndex, item.outputIndex]), [[0, 0], [2, 1], [7, 2]]);
});

test('integer audio origin removes binary64 one-sample discontinuity and declares each track quantization', () => {
  const probe = source({ origin: 10, duration: 22 });
  probe.streams[0].time_base = '1/12800'; probe.streams[0].start_pts = 128000; probe.streams[0].duration_ts = 281600;
  probe.streams.push({ ...clone(probe.streams[1]), index: 7, sample_rate: '44100', time_base: '1/44100', start_pts: 441000, duration_ts: 970200, channels: 1, channel_layout: 'mono' }); probe.format.nb_streams = 3;
  const plan = build(probe, { range: { startUs: 15013000, endUs: 17087000 } }), origins = plan.expectedOutput.timestampOrigins;
  assert.equal(origins.video.originTicks, '320166'); assert.deepEqual(origins.video.originMinusRequestedStart, { numerator: '-1', denominator: '32000' });
  assert.equal(origins.audio[0].originTicks, '1200624'); assert.deepEqual(origins.audio[0].originMinusRequestedStart, { numerator: '0', denominator: '1' });
  assert.equal(origins.audio[1].originTicks, '1103073'); assert.deepEqual(origins.audio[1].originMinusRequestedStart, { numerator: '-1', denominator: '147000' });
  assert.equal(option(plan.args, '-filter:a:0'), 'asettb=expr=1/48000,atrim=start_pts=1200624:end_pts=1300176,asetpts=PTS-(1200624)');
  const offset = Number(origins.audio[0].originTicks);
  assert.equal(1200624 - offset, 0); assert.equal(1200896 - offset, 272);
  assert.equal(Math.trunc(1200896 - (25013 / 1000) / (1 / 48000)), 271, 'The formerly used double expression causes the observed defect');
  assert.ok(plan.qualificationRequirements.includes('integer-origin-quantization-and-filter-timebase'));
});

test('nearest-tick origin ties round away from zero and remain independently visible', () => {
  const positive = build(source(), { range: { startUs: 500, endUs: 1500000 } }).expectedOutput.timestampOrigins.video;
  const negative = build(source({ origin: -1 }), { range: { startUs: 999500, endUs: 1500000 } }).expectedOutput.timestampOrigins.video;
  assert.equal(positive.originTicks, '1'); assert.deepEqual(positive.originMinusRequestedStart, { numerator: '1', denominator: '2000' });
  assert.equal(negative.originTicks, '-1'); assert.deepEqual(negative.originMinusRequestedStart, { numerator: '-1', denominator: '2000' });
  assert.equal(positive.rounding, 'nearest-tick-ties-away-from-zero');
});

test('constant origin subtraction preserves source gaps and delayed first samples without flattening clocks', () => {
  const plan = build(source(), { range: { startUs: 1000000, endUs: 2000000 } });
  const origin = Number(plan.expectedOutput.timestampOrigins.audio[0].originTicks);
  const inputPts = [48096, 49120, 50644], outputPts = inputPts.map(pts => pts - origin);
  assert.deepEqual(outputPts, [96, 1120, 2644]); assert.equal(outputPts[2] - outputPts[1], 1524);
  assert.ok(!option(plan.args, '-filter:a:0').includes('STARTPTS') && !option(plan.args, '-filter:a:0').includes('N/'));
});

test('timestamp evaluator rejects an origin outside exact binary64 integer bounds', () => {
  const probe = source({ duration: 4 });
  Object.assign(probe.streams[0], { time_base: '1/1000000', start_pts: '9007199254740992', start_time: '9007199254.740992', duration_ts: '4000000' });
  assert.throws(() => build(probe, { range: { startUs: 0, endUs: 1000000 } }), { code: 'ENCODE_FILTER_INTEGER_UNSAFE' });
});

test('FLAC remains an explicit whole-selected-segment integer PCM path with no lossy-original identity claim', () => {
  const probe = source(); probe.streams[1].codec_name = 'pcm_s16le'; probe.streams[1].sample_fmt = 's16';
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-flac' });
  assert.equal(option(plan.args, '-c:a:0'), 'flac'); assert.equal(option(plan.args, '-sample_fmt:a:0'), 's16');
  assert.equal(plan.contract.audio.streams[0].losslessOriginalClaim, false);
  probe.streams[1].sample_fmt = 's32';
  assert.throws(() => build(probe, { audioPolicy: 'precision-flac' }), { code: 'ENCODE_FLAC_PRECISION_UNQUALIFIED' });
  probe.streams[1].bits_per_raw_sample = '24';
  assert.equal(option(build(probe, { audioPolicy: 'precision-flac' }).args, '-sample_fmt:a:0'), 's32');
});

test('unsupported subtitle/chapter/range-copy and unknown relationships fail before a lossy workaround', () => {
  const range = { range: { startUs: 1000000, endUs: 2000000 } };
  assert.throws(() => build(source(), { ...range, audioPolicy: 'copy' }), { code: 'ENCODE_PACKET_RANGE_UNQUALIFIED' });
  const subtitles = source(); subtitles.streams.push({ index: 4, codec_type: 'subtitle', codec_name: 'ass' }); subtitles.format.nb_streams = 3;
  assert.throws(() => build(subtitles, range), { code: 'ENCODE_SUBTITLE_TRANSFORM_UNQUALIFIED' });
  const chapters = source(); chapters.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000 }];
  assert.throws(() => build(chapters, range), { code: 'ENCODE_CHAPTER_RANGE_UNQUALIFIED' });
  const unknown = source(); delete unknown.programs;
  assert.throws(() => build(unknown, range), { code: 'ENCODE_RELATIONSHIPS_UNQUALIFIED' });
  assert.throws(() => build(source(), { omissionRequestIds: ['authorize-me'] }), { code: 'ENCODE_OMISSION_UNBOUND' });
});

test('new transforms cannot infer color conversions, usable geometry or runtime qualification', () => {
  const probe = source({ width: 3840, height: 2160 }); delete probe.streams[0].color_space;
  assert.throws(() => build(probe, { resolution: '1080' }), { code: 'ENCODE_SCALE_COLOR_UNQUALIFIED' });
  const unknown = source({ width: 3840, height: 2160 }); delete unknown.streams[0].tags.rotate;
  assert.throws(() => build(unknown, { resolution: '1080' }), { code: 'GEOMETRY_ORIENTATION_UNKNOWN' });
  assert.throws(() => build(source(), { range: { startUs: 0 } }, { runtimeIdentity: null }), { code: 'ENCODE_RUNTIME_UNBOUND' });
  assert.throws(() => build(source(), {}, { arbitraryFilters: 'scale=1:1' }), { code: 'INVALID_ENCODE_OPERATION' });
});

test('main-qualified absent orientation binds exact runtime and source without inventing media tags or overriding a real rotation', () => {
  const probe = source({ width: 3840, height: 2160 }); delete probe.streams[0].tags.rotate;
  const identityOrientationQualification = { evidenceId: 'identity-fixture-cell', runtimeIdentity: RUNTIME, sourceEvidenceFingerprint: fingerprintEncodeSource(probe), videoIndex: 0 };
  const plan = build(probe, { resolution: '1080' }, { identityOrientationQualification });
  assert.equal(plan.contract.geometry.display.rotationDegrees, 0);
  assert.equal(plan.expectedOutput.orientationQualification.evidenceId, 'identity-fixture-cell');
  assert.equal(probe.streams[0].tags.rotate, undefined);
  for (const changes of [{ runtimeIdentity: 'other' }, { videoIndex: 2 }, { sourceEvidenceFingerprint: 'a'.repeat(64) }]) {
    assert.throws(() => build(probe, { resolution: '1080' }, { identityOrientationQualification: { ...identityOrientationQualification, ...changes } }), { code: 'ENCODE_ORIENTATION_QUALIFICATION_MISMATCH' });
  }
  probe.streams[0].tags.rotate = '90';
  assert.throws(() => build(probe, { resolution: '1080' }, { identityOrientationQualification: { ...identityOrientationQualification, sourceEvidenceFingerprint: fingerprintEncodeSource(probe) } }), { code: 'ENCODE_ORIENTATION_QUALIFICATION_MISMATCH' });
});

test('range validation requires matching measured tolerances and actual decoded evidence', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), actual = output(probe, plan);
  assert.equal(validateEncodeOperationOutput(plan, actual).valid, false);
  assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualification() }).valid, false);
  assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualification({ runtimeIdentity: 'old-runtime' }), decodedEvidence: decoded() }).valid, false);
  const result = validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: decoded() });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.qualificationEvidenceId, 'synthetic-direct-fixture-only');
});

test('frame count/cadence/boundary failures cannot hide behind good average FPS or one duration number', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), actual = output(probe, plan);
  for (const change of [data => { data.video.outputFrameCount--; }, data => { data.video.comparedFrames--; },
    data => { data.video.maxRebasedTimestampErrorUs = 5000; }, data => { data.video.firstSourcePtsUs = 900000; },
    data => { data.video.lastSourcePtsUs = 2100000; }, data => { data.video.lastOutputPtsUs += 10000; }]) {
    const data = decoded(); change(data);
    assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: data }).valid, false);
  }
});

test('sample counts, AAC LC, channel layout/rate and A/V offsets remain independent checks', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), actual = output(probe, plan);
  for (const change of [data => { data.audio[0].outputSampleCount += 1024; }, data => { data.audio[0].firstOutputPtsUs = 100000; },
    data => { data.audio[0].lastSourceEndUs += 40000; }, data => { data.audio.push(clone(data.audio[0])); }]) {
    const data = decoded(); change(data); assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: data }).valid, false);
  }
  for (const change of [data => { data.streams[1].sample_rate = '44100'; }, data => { data.streams[1].channel_layout = 'mono'; },
    data => { data.streams[1].profile = 'HE-AAC'; }, data => { data.streams[1].tags.title = 'Missing preservation'; }]) {
    const data = clone(actual); change(data); assert.equal(validateEncodeOperationOutput(plan, data, { qualification: qualification(), decodedEvidence: decoded() }).valid, false);
  }
});

test('permitted measured padding differences remain visible, not relabelled sample-identical', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), actual = output(probe, plan), data = decoded();
  data.audio[0].outputSampleCount++;
  const measured = qualification(); measured.tolerances.sampleCount = 1;
  const result = validateEncodeOperationOutput(plan, actual, { qualification: measured, decodedEvidence: data });
  assert.equal(result.valid, true, result.errors.join('; ')); assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /not sample-identical/);
});

// Record 47 Q2b: copied audio carries the collector's packet identity seals.
const SEAL = 'a'.repeat(64);
function copied(evidence, identity = { algorithm: 'sha256', packets: 188, sourceSeal: SEAL, outputSeal: SEAL }) {
  for (const audio of evidence.audio) audio.packetIdentity = structuredClone(identity);
  return evidence;
}

test('copied audio must keep every source packet and decoded sample exactly, with no padding allowance', () => {
  const probe = source({ width: 3840, height: 2160 }), plan = build(probe, { resolution: '1080' }), actual = output(probe, plan, 4);
  assert.equal(plan.contract.audio.streams[0].mode, 'copy');
  const measured = qualification(); measured.tolerances.sampleCount = 1023;
  const check = evidence => validateEncodeOperationOutput(plan, actual, { qualification: measured, decodedEvidence: evidence });
  assert.equal(check(copied(decoded({ origin: 0, seconds: 4 }))).valid, true);
  // Without the identity the copy is not checked against the source at all.
  assert.equal(check(decoded({ origin: 0, seconds: 4 })).valid, false);
  // Different seals, a one-sample difference inside the AAC tolerance, malformed or extra identity fields.
  assert.equal(check(copied(decoded({ origin: 0, seconds: 4 }), { algorithm: 'sha256', packets: 188, sourceSeal: SEAL, outputSeal: 'b'.repeat(64) })).valid, false);
  const short = copied(decoded({ origin: 0, seconds: 4 })); short.audio[0].outputSampleCount -= 1;
  const result = check(short); assert.equal(result.valid, false); assert.match(result.errors.join(' '), /copied audio must keep every source packet/);
  for (const identity of [{ algorithm: 'md5', packets: 188, sourceSeal: SEAL, outputSeal: SEAL }, { algorithm: 'sha256', packets: 0, sourceSeal: SEAL, outputSeal: SEAL },
    { algorithm: 'sha256', packets: 188, sourceSeal: 'A'.repeat(64), outputSeal: 'A'.repeat(64) }, { algorithm: 'sha256', packets: 188, sourceSeal: SEAL, outputSeal: SEAL, extra: 1 },
    { algorithm: 'sha256', packets: 188, sourceSeal: SEAL }]) {
    assert.equal(check(copied(decoded({ origin: 0, seconds: 4 }), identity)).valid, false, JSON.stringify(identity));
  }
  // A re-encoded AAC stream cannot carry a packet identity claim.
  const ranged = build(source(), { range: { startUs: 1000000, endUs: 2000000 } });
  assert.equal(validateEncodeOperationOutput(ranged, output(source(), ranged), { qualification: qualification(), decodedEvidence: copied(decoded()) }).valid, false);
  assert.equal(validateEncodeOperationOutput(ranged, output(source(), ranged), { qualification: qualification(), decodedEvidence: decoded() }).valid, true);
});

test('resized output validates dimensions, SAR, color and normalized orientation rather than codec alone', () => {
  const probe = source({ width: 3840, height: 2160 }), plan = build(probe, { resolution: '1080' }), actual = output(probe, plan, 4);
  const evidence = copied(decoded({ origin: 0, seconds: 4 }));
  assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: evidence }).valid, true);
  for (const change of [data => { data.streams[0].width = 1280; }, data => { data.streams[0].sample_aspect_ratio = '2:1'; },
    data => { data.streams[0].color_range = 'pc'; }, data => { data.streams[0].tags.rotate = '90'; }, data => { data.format.duration = '3'; }]) {
    const changed = clone(actual); change(changed);
    assert.equal(validateEncodeOperationOutput(plan, changed, { qualification: qualification(), decodedEvidence: evidence }).valid, false);
  }
});

test('prepared provenance must round-trip and cloned plans cannot become validation authority', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }, { outputId: OUTPUT_ID }), actual = output(probe, plan);
  const evidence = { qualification: qualification(), decodedEvidence: decoded() };
  assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, true);
  delete actual.format.tags[OUTPUT_ID_KEY];
  assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, false);
  assert.equal(validateEncodeOperationOutput(clone(plan), output(probe, plan), evidence).valid, false);
  assert.throws(() => { plan.args.push('-y'); }, TypeError);
  assert.equal(validateEncodeOperationOutput(plan, output(probe, plan), { ...evidence, ignoreValidation: true }).valid, false);
});

const displayMatrix90 = { side_data_type: 'Display Matrix', rotation: 90,
  displaymatrix: '00000000: 0 -65536 0\n00000001: 65536 0 0\n00000002: 0 0 1073741824' };
function pcmIdentity(plan, evidence) {
  for (const audio of evidence.audio) {
    const precision = plan.expectedOutput.audioPrecision.find(item => item.inputIndex === audio.inputIndex);
    if (!precision) continue;
    const channels = plan.contract.audio.streams.find(item => item.index === audio.inputIndex).channels;
    audio.pcmIdentity = { algorithm: 'sha256', format: precision.pcmFormat, sourceHash: 'a'.repeat(64), outputHash: 'a'.repeat(64),
      sourceBytes: audio.sourceSampleCount * channels * (precision.storageBits / 8), outputBytes: audio.outputSampleCount * channels * (precision.storageBits / 8) };
  }
  return evidence;
}

test('Keep Source changed operations retain display matrices without silent rotation flattening', () => {
  const probe = source(); delete probe.streams[0].tags.rotate;
  probe.streams[0].side_data_list = [clone(displayMatrix90)];
  for (const overrides of [{ range: { startUs: 1000000, endUs: 2000000 } }, { audioPolicy: 'precision-aac' }]) {
    const ranged = Boolean(overrides.range), plan = build(probe, overrides), actual = output(probe, plan, ranged ? 1 : 4);
    const evidence = { qualification: qualification(), decodedEvidence: decoded(ranged ? {} : { origin: 0, seconds: 4 }) };
    assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, true);
    for (const change of [candidate => { delete candidate.streams[0].side_data_list; },
      candidate => { candidate.streams[0].side_data_list[0].rotation = 0; },
      candidate => { candidate.streams[0].side_data_list[0].displaymatrix = '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824'; }]) {
      const changed = clone(actual); change(changed);
      const result = validateEncodeOperationOutput(plan, changed, evidence);
      assert.equal(result.valid, false); assert.ok(result.errors.some(message => /orientation transform/.test(message)));
    }
  }
});

test('changed operations refuse malformed reported orientation but preserve genuine unknown absence', () => {
  const probe = source(); delete probe.streams[0].tags.rotate;
  const overrides = { range: { startUs: 1000000, endUs: 2000000 } };
  const plan = build(probe, overrides), actual = output(probe, plan);
  const evidence = { qualification: qualification(), decodedEvidence: decoded() };
  assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, true);
  actual.streams[0].side_data_list = [clone(displayMatrix90)];
  assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, false);
  for (const side_data_list of [[{ side_data_type: 'Display Matrix', rotation: 90 }], [clone(displayMatrix90), clone(displayMatrix90)]]) {
    const malformed = clone(probe); malformed.streams[0].side_data_list = side_data_list;
    assert.throws(() => build(malformed, overrides), { code: 'ENCODE_ORIENTATION_UNQUALIFIED' });
  }
  probe.streams[0].tags.rotate = 'malformed';
  assert.throws(() => build(probe, overrides), { code: 'ENCODE_ORIENTATION_UNQUALIFIED' });
});

test('FLAC requires complete canonical decoded PCM identity and rejects sample loss even within AAC tolerances', () => {
  const probe = source(); Object.assign(probe.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: '16' });
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-flac' }), actual = output(probe, plan);
  const evidence = pcmIdentity(plan, decoded()), qualified = qualification(); qualified.tolerances.sampleCount = 1024;
  assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualified, decodedEvidence: evidence }).valid, true);
  for (const change of [data => { delete data.audio[0].pcmIdentity; }, data => { data.audio[0].pcmIdentity.outputHash = 'b'.repeat(64); },
    data => { data.audio[0].pcmIdentity.outputBytes--; }, data => { data.audio[0].pcmIdentity.format = 's32le-interleaved'; },
    data => { data.audio[0].pcmIdentity.sourceBytes = 1; }, data => { data.audio[0].outputSampleCount--; },
    data => { data.audio[0].pcmIdentity.sourceHash = data.audio[0].pcmIdentity.outputHash = ['a'.repeat(64)]; },
    data => { data.audio[0].encoderDelaySamples = 1; }, data => { data.audio[0].discardPaddingSamples = 1; }]) {
    const changed = clone(evidence); change(changed);
    assert.equal(validateEncodeOperationOutput(plan, actual, { qualification: qualified, decodedEvidence: changed }).valid, false);
  }
});

test('FLAC range duration uses decoded end-timestamp without AAC priming and rejects packet/copy clocks', () => {
  const probe = source(); Object.assign(probe.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: 16 });
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-flac' });
  const actual = output(probe, plan), evidence = pcmIdentity(plan, decoded()), qualified = qualification();
  actual.streams.forEach(stream => { stream.time_base = '1/1000'; });
  assert.equal(option(plan.args, '-filter:a:0'), 'asettb=expr=1/48000,atrim=start_pts=48000:end_pts=96000,asetpts=PTS-(48000)');
  const valid = validateEncodeOperationOutput(plan, actual, { qualification: qualified, decodedEvidence: evidence });
  assert.equal(valid.valid, true, valid.errors.join('; '));
  const padded = clone(actual); padded.format.duration = '1.021';
  assert.equal(validateEncodeOperationOutput(plan, padded, { qualification: qualified, decodedEvidence: evidence }).valid, false);
  for (const clock of ['matroska-packet-end-plus-codec-delay', 'matroska-copy-end-plus-codec-delay']) {
    const result = validateEncodeOperationOutput(plan, actual, { qualification: qualification({ containerDuration: clock }), decodedEvidence: evidence });
    assert.equal(result.valid, false); assert.match(result.errors.join('; '), /packet clock|copy clock/i);
  }
  for (const mutate of [data => { data.audio[0].outputSampleCount++; data.audio[0].pcmIdentity.outputBytes += 4; },
    data => { data.audio[0].pcmIdentity.outputHash = 'c'.repeat(64); }]) {
    const changed = clone(evidence); mutate(changed);
    const result = validateEncodeOperationOutput(plan, actual, { qualification: qualified, decodedEvidence: changed });
    assert.equal(result.valid, false); assert.match(result.errors.join('; '), /FLAC must preserve/);
  }
  // No new FLAC-only duration representation was introduced. Unknown models
  // cannot be applied to FLAC, AAC or copy; existing AAC end-timestamp is kept.
  for (const changedPlan of [plan, build(source(), { range: { startUs: 1000000, endUs: 2000000 } }), build(source(), { resolution: '720' })]) {
    const result = validateEncodeOperationOutput(changedPlan, actual, { qualification: qualification({ containerDuration: 'matroska-flac-end-timestamp' }), decodedEvidence: evidence });
    assert.equal(result.valid, false); assert.match(result.errors.join('; '), /duration representation/);
  }
});

test('FLAC output must report enough significant precision independently of matching PCM evidence', () => {
  const probe = source(); Object.assign(probe.streams[1], { codec_name: 'pcm_s24le', sample_fmt: 's32', bits_per_raw_sample: '24' });
  const plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-flac' }), actual = output(probe, plan);
  const evidence = { qualification: qualification(), decodedEvidence: pcmIdentity(plan, decoded()) };
  assert.equal(validateEncodeOperationOutput(plan, actual, evidence).valid, true);
  for (const bits of [undefined, '0', '16', 'unknown', '64']) {
    const changed = clone(actual); if (bits === undefined) delete changed.streams[1].bits_per_raw_sample; else changed.streams[1].bits_per_raw_sample = bits;
    const result = validateEncodeOperationOutput(plan, changed, evidence);
    assert.equal(result.valid, false); assert.ok(result.errors.some(message => /significant-bit precision/.test(message)));
  }
  Object.assign(probe.streams[1], { sample_fmt: 's16', bits_per_raw_sample: '24' });
  assert.throws(() => build(probe, { audioPolicy: 'precision-flac' }), { code: 'ENCODE_FLAC_PRECISION_UNQUALIFIED' });
});

test('AAC cannot carry a misleading lossless PCM identity claim', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } });
  const data = decoded(); data.audio[0].pcmIdentity = {};
  assert.equal(validateEncodeOperationOutput(plan, output(probe, plan), { qualification: qualification(), decodedEvidence: data }).valid, false);
});

test('a Full request whose display already fits in either orientation keeps the accepted builder argv byte-for-byte', () => {
  for (const [width, height, resolution] of [[1920, 1080, '1080'], [1920, 1080, '2160'], [1280, 720, '720'], [720, 1280, '1440']]) {
    const probe = source({ width, height }); delete probe.streams[0].tags.rotate;
    const opts = options(probe, { resolution }), result = buildEncodeOperation(opts);
    assert.equal(result.compatibilityPath, true); assert.equal(result.contract.geometry.mode, 'already-fits');
    assert.equal(result.contract.geometry.display.rotationDegrees, null);
    assert.deepEqual(result.args, buildEncodeArgs({ input: opts.input, output: opts.output, settings, probe, colorEvidence: opts.inspection.color }));
    assert.equal(result.args.includes('-filter:v:0'), false); assert.equal(result.args.includes('-noautorotate'), false);
  }
  // A real downscale still needs orientation evidence.
  const wide = source(); delete wide.streams[0].tags.rotate;
  assert.throws(() => build(wide, { resolution: '720' }), { code: 'GEOMETRY_ORIENTATION_UNKNOWN' });
  // Reported but unreadable orientation is never treated as absent: an empty
  // Display Matrix entry and an empty rotate tag both still refuse.
  const matrix = source(); delete matrix.streams[0].tags.rotate; matrix.streams[0].side_data_list = [{ side_data_type: 'Display Matrix' }];
  assert.throws(() => build(matrix, { resolution: '1080' }), { code: 'GEOMETRY_ORIENTATION_UNKNOWN' });
  const tag = source(); tag.streams[0].tags.rotate = '';
  assert.throws(() => build(tag, { resolution: '1080' }), { code: 'GEOMETRY_ORIENTATION_UNKNOWN' });
});

test('changed-path results describe asked, resolved and kept timing for start-only, end-only and to-source-end ranges', () => {
  const cases = [
    { range: { startUs: 3000000 }, origin: 3000000, seconds: 1, requested: { startUs: 3000000, endUs: null }, resolved: { startUs: 3000000, endUs: 4000000 } },
    { range: { endUs: 1000000 }, origin: 0, seconds: 1, requested: { startUs: null, endUs: 1000000 }, resolved: { startUs: 0, endUs: 1000000 } },
    { range: { startUs: 2000000, endUs: 4000000 }, origin: 2000000, seconds: 2, requested: { startUs: 2000000, endUs: 4000000 }, resolved: { startUs: 2000000, endUs: 4000000 } }];
  for (const item of cases) {
    const probe = source(), plan = build(probe, { range: item.range }), actual = output(probe, plan, item.seconds);
    const result = validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: decoded({ origin: item.origin, seconds: item.seconds }) });
    assert.equal(result.valid, true, result.errors.join('; '));
    assert.ok(Object.isFrozen(result.timing));
    assert.equal(result.timing.timeline, 'request-relative');
    assert.deepEqual({ ...result.timing.requested }, item.requested);
    assert.deepEqual({ ...result.timing.resolved }, item.resolved);
    assert.deepEqual({ ...result.timing.video }, { startUs: item.resolved.startUs, endUs: item.resolved.endUs, frames: item.seconds * 25,
      outputStartUs: 0, outputEndUs: item.seconds * 1000000 });
    assert.deepEqual({ ...result.timing.audio[0] }, { inputIndex: 2, mode: 'precision-aac', startUs: item.resolved.startUs, endUs: item.resolved.endUs,
      outputStartUs: 0, outputEndUs: item.seconds * 1000000, encoderDelaySamples: 0, discardPaddingSamples: 0, sampleCountDifference: 0 });
  }
});

test('timing spans are relative to the source origin, so a nonzero start time still compares with the asked range', () => {
  const probe = source({ origin: 10 }), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), actual = output(probe, plan);
  const result = validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: decoded({ origin: 11000000 }) });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.timing.video.startUs, 1000000); assert.equal(result.timing.video.endUs, 2000000);
  assert.equal(result.timing.audio[0].startUs, 1000000);
});

test('full-length changed results carry the AAC start delay, end padding and sample difference; ordinary results keep their shape', () => {
  const probe = source(), plan = build(probe, { audioPolicy: 'precision-aac' }), actual = output(probe, plan, 4);
  const data = decoded({ origin: 0, seconds: 4 });
  Object.assign(data.audio[0], { encoderDelaySamples: 1024, discardPaddingSamples: 448, outputSampleCount: data.audio[0].sourceSampleCount + 1 });
  const measured = qualification(); measured.tolerances.sampleCount = 1;
  const result = validateEncodeOperationOutput(plan, actual, { qualification: measured, decodedEvidence: data });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.timing.timeline, 'source-timestamps');
  assert.equal(result.timing.requested, null); assert.equal(result.timing.resolved, null);
  assert.deepEqual({ ...result.timing.audio[0] }, { inputIndex: 2, mode: 'precision-aac', startUs: 0, endUs: 4000000, outputStartUs: 0, outputEndUs: 4000000,
    encoderDelaySamples: 1024, discardPaddingSamples: 448, sampleCountDifference: 1 });
  const ordinary = build(probe), ordinaryResult = validateEncodeOperationOutput(ordinary, output(probe, ordinary, 4));
  assert.equal(ordinary.compatibilityPath, true);
  assert.deepEqual(Object.keys(ordinaryResult).sort(), ['errors', 'qualificationEvidenceId', 'valid', 'validation', 'warnings']);
});

test('a half-microsecond negative origin rounds like the collector, so a frame at the asked start reads exactly 0', () => {
  const probe = source();
  Object.assign(probe.streams[0], { time_base: '1/2000000', start_pts: -1, start_time: '-0.0000005', duration_ts: 8000000 });
  const plan = build(probe, { range: { endUs: 1000000 } }), actual = output(probe, plan);
  const result = validateEncodeOperationOutput(plan, actual, { qualification: qualification(), decodedEvidence: decoded({ origin: -1 }) });
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(result.timing.video.startUs, 0); assert.equal(result.timing.audio[0].startUs, 0);
});

test('an invalid changed-path result carries no timing description', () => {
  const probe = source(), plan = build(probe, { range: { startUs: 1000000, endUs: 2000000 } }), data = decoded();
  data.video.outputFrameCount--;
  const result = validateEncodeOperationOutput(plan, output(probe, plan), { qualification: qualification(), decodedEvidence: data });
  assert.equal(result.valid, false); assert.equal(Object.hasOwn(result, 'timing'), false);
});

test('the copy clock adds the copied stream\'s own codec delay to its decoded end and applies only to whole-file copies', () => {
  const probe = source({ width: 3840, height: 2160 }), plan = build(probe, { resolution: '1080' });
  const clock = qualification({ containerDuration: 'matroska-copy-end-plus-codec-delay', tolerances: { videoTimestampUs: 1000, audioTimestampUs: 1000, avSyncUs: 2000, durationUs: 1088, sampleCount: 0 } });
  const evidence = () => { const value = copied(decoded({ origin: 0, seconds: 4 })); value.audio[0].encoderDelaySamples = 1024; return value; };
  const at = seconds => { const actual = output(probe, plan, seconds); for (const stream of actual.streams) stream.time_base = '1/1000'; return actual; };
  // 4 s of decoded audio plus 1024/48000 s of codec delay is 4.021333 s; Matroska stores milliseconds.
  assert.equal(validateEncodeOperationOutput(plan, at(4.021), { qualification: clock, decodedEvidence: evidence() }).valid, true);
  for (const seconds of [4, 4.023, 4.0]) assert.equal(validateEncodeOperationOutput(plan, at(seconds), { qualification: clock, decodedEvidence: evidence() }).valid, false, String(seconds));
  // A missing final AAC packet (21.333 ms) cannot hide inside the bound.
  const short = evidence(); short.audio[0].lastOutputEndUs -= 21333;
  assert.equal(validateEncodeOperationOutput(plan, at(4.021), { qualification: clock, decodedEvidence: short }).valid, false);
  // The copy clock needs 1/1000 Matroska output and never applies to a range or re-encoded audio.
  assert.equal(validateEncodeOperationOutput(plan, output(probe, plan, 4.021), { qualification: clock, decodedEvidence: evidence() }).valid, false);
  const ranged = build(source(), { range: { startUs: 1000000, endUs: 2000000 } }), rangedOutput = output(source(), ranged);
  for (const stream of rangedOutput.streams) stream.time_base = '1/1000';
  assert.equal(validateEncodeOperationOutput(ranged, rangedOutput, { qualification: clock, decodedEvidence: decoded() }).valid, false);
});

test('copied audio cannot validate with the precision-AAC packet clock', () => {
  const probe = source(), plan = build(probe, { resolution: '720' }), actual = output(probe, plan, 4);
  assert.equal(plan.compatibilityPath, false); assert.equal(plan.contract.audio.streams[0].mode, 'copy');
  for (const stream of actual.streams) stream.time_base = '1/1000';
  const result = validateEncodeOperationOutput(plan, actual, {
    qualification: qualification({ containerDuration: 'matroska-packet-end-plus-codec-delay' }),
    decodedEvidence: copied(decoded({ origin: 0, seconds: 4 })) });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['The packet clock belongs only to precision AAC, never FLAC or copied audio.']);
});

function codecChoices(args) {
  return args.flatMap((arg,index)=>arg === '-c' || /^-c:/.test(arg) ? [[arg,args[index+1]]] : []);
}
test('mapped ordinary streams receive one final codec decision without global overlap',()=>{
  const probe=source();
  probe.streams.push({...clone(probe.streams[1]),index:7},
    {index:8,codec_type:'subtitle',codec_name:'subrip',tags:{language:'eng'},disposition:{}},
    {index:9,codec_type:'attachment',codec_name:'ttf',tags:{filename:'font.ttf',mimetype:'application/x-truetype-font'},disposition:{}},
    {...clone(probe.streams[0]),index:10});
  // Probe order need not be stream-index order; the existing map order stays authoritative.
  probe.streams=[probe.streams[2],probe.streams[0],...probe.streams.slice(3),probe.streams[1]];
  for(const profileId of ['h264-cpu','h265-cpu','av1-cpu']){
    const profile=PROFILES.find(p=>p.id===profileId);
    const args=buildEncodeArgs({input:'/owned/source.mov',output:'/owned/result.mkv',settings:{profileId,preset:profile.defaultPreset,quality:profile.quality.default},probe});
    assert.deepEqual(codecChoices(args),[['-c:v:0',profile.encoder],['-c:a:0','copy'],['-c:s:0','copy'],['-c:t:0','copy'],['-c:a:1','copy']]);
    assert.deepEqual(args.flatMap((v,i)=>v==='-map'?[args[i+1]]:[]),['0:0','0:7','0:8','0:9','0:2']);
    assert.equal(option(args,'-map_metadata'),'0');assert.equal(option(args,'-map_chapters'),'0');assert.ok(args.includes('-n'));
  }
});
test('Full, trim and resize choose copy FLAC or AAC once per audio ordinal',()=>{
  for(const mode of ['copy','precision-flac','precision-aac']){
    const probe=source();for(const a of probe.streams.filter(s=>s.codec_type==='audio')){Object.assign(a,{codec_name:'pcm_s16le',sample_fmt:'s16'});delete a.profile;}
    probe.streams.push({...clone(probe.streams[1]),index:7});probe.format.nb_streams=3;
    for(const change of [{},...(mode==='copy'?[]:[{range:{startUs:1000000,endUs:2000000}}]),{resolution:'720'}]){
      const plan=build(probe,{audioPolicy:mode,...change});
      assert.deepEqual(codecChoices(plan.args),[['-c:v:0','libx265'],['-c:a:0',mode==='copy'?'copy':mode==='precision-flac'?'flac':'aac'],['-c:a:1',mode==='copy'?'copy':mode==='precision-flac'?'flac':'aac']]);
      assert.equal(plan.expectedOutput.audio.streams.length,2);
    }
  }
});
test('unsupported data and attached pictures remain refused, not silently codec-selected',()=>{
  for(const stream of [{index:9,codec_type:'data',codec_name:'bin_data'},{index:9,codec_type:'video',codec_name:'mjpeg',disposition:{attached_pic:1}}]){
    const probe=source();probe.streams.push(stream);
    assert.throws(()=>buildEncodeArgs({input:'/owned/input.mov',output:'/owned/output.mkv',settings,probe}),{code:'UNSUPPORTED_STREAM'});
  }
});
