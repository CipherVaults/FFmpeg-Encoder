'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEncodeOperation, validateEncodeOperationOutput, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { buildEncodeArgs, PROFILES, ARCHIVE_RECIPE, classifyColor } = require('../src/media.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');
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
  assert.equal(option(plan.args, '-filter:v:0'), 'trim=start_pts=11000:end_pts=12000,setpts=PTS-(11/1)/TB');
  assert.equal(option(plan.args, '-filter:a:0'), 'atrim=start_pts=528000:end_pts=576000,asetpts=PTS-(11/1)/TB');
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
  assert.equal(option(start.args, '-filter:v:0'), 'trim=start_pts=0:end_pts=3000,setpts=PTS-(0/1)/TB');
  const end = build(probe, { range: { endUs: 1500000 } });
  assert.equal(option(end.args, '-filter:v:0'), 'trim=start_pts=-1000:end_pts=500,setpts=PTS-(-1/1)/TB');
  assert.equal(option(end.args, '-ss'), undefined);
});

test('late seeking retains source PTS and preroll; filters still select the exact final interval', () => {
  const probe = source({ origin: 10, duration: 1000 });
  const plan = build(probe, { range: { startUs: 500000000, endUs: 501000000 } });
  assert.equal(option(plan.args, '-ss'), '505.000000'); assert.equal(option(plan.args, '-seek_timestamp'), '1');
  assert.ok(plan.args.indexOf('-ss') < plan.args.indexOf('-i')); assert.ok(plan.args.includes('-noaccurate_seek'));
  assert.equal(option(plan.args, '-filter:v:0'), 'trim=start_pts=510000:end_pts=511000,setpts=PTS-(510/1)/TB');
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
  assert.equal(option(plan.args, '-filter:a:1'), 'atrim=start_pts=44100:end_pts=88200,asetpts=PTS-(1/1)/TB');
  assert.deepEqual(plan.expectedOutput.streams.map(item => [item.inputIndex, item.outputIndex]), [[0, 0], [2, 1], [7, 2]]);
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

test('resized output validates dimensions, SAR, color and normalized orientation rather than codec alone', () => {
  const probe = source({ width: 3840, height: 2160 }), plan = build(probe, { resolution: '1080' }), actual = output(probe, plan, 4);
  const evidence = decoded({ origin: 0, seconds: 4 });
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
