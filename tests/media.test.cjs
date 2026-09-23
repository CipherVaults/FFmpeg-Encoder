'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES, validateSettings, selectVideo, classifyColor, buildEncodeArgs } = require('../src/media.cjs');

// Structured probe fixtures keep metadata policy independent of FFmpeg process
// mechanics. Real mux/encoder tests separately prove shipped-binary behavior.
function video(overrides = {}) {
  return {
    index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
    width: 1920, height: 1080, color_transfer: 'bt709', color_primaries: 'bt709',
    color_space: 'bt709', color_range: 'tv', disposition: { default: 1 }, ...overrides,
  };
}

function probe(stream = video(), others = []) {
  return { streams: [stream, ...others], format: { duration: '10.0', tags: { title: 'Fixture' } } };
}

function settings(profileId = 'h265-cpu') {
  const profile = PROFILES.find((item) => item.id === profileId);
  return { profileId, preset: profile.defaultPreset, quality: profile.quality.default };
}

function argsFor(probeData = probe(), options = {}) {
  return buildEncodeArgs({
    input: 'C:\\media\\source.mkv', output: 'D:\\output\\owned.partial',
    settings: settings(), probe: probeData, ...options,
  });
}

function values(args, option) {
  return args.flatMap((value, index) => value === option ? [args[index + 1]] : []);
}

function errorCode(code) {
  return (error) => error.code === code;
}

test('phone timestamps use exact stream aliases after reordered metadata mapping, without changing global metadata', () => {
  const input = probe(video({ index: 1, tags: { creation_time: '2026-05-01T22:45:38.000000Z' } }), [
    { index: 0, codec_type: 'audio', codec_name: 'aac', tags: { creation_time: '2026-05-01T22:45:39.000000Z' } },
  ]);
  input.streams.reverse();
  const args = argsFor(input);
  assert.deepEqual(values(args, '-map'), ['0:1', '0:0']);
  assert.deepEqual(values(args, '-metadata:s:0'), ['SOURCE_CREATION_TIME=2026-05-01T22:45:38.000000Z']);
  assert.deepEqual(values(args, '-metadata:s:1'), ['SOURCE_CREATION_TIME=2026-05-01T22:45:39.000000Z']);
  assert.ok(args.indexOf('-metadata:s:0') > args.indexOf('-map_metadata:s:0'));
  assert.deepEqual(values(args, '-map_metadata'), ['0']);
  assert.deepEqual(values(args, '-metadata'), []);
});

test('creation timestamp aliases refuse case-insensitive collisions and preserve existing alias-only inputs', () => {
  const input = probe(video({ tags: { creation_time: 'exact source text', source_creation_time: 'different user value' } }));
  assert.throws(() => argsFor(input), errorCode('UNSUPPORTED_METADATA'));
  input.streams[0].tags.source_creation_time = 'exact source text';
  assert.deepEqual(values(argsFor(input), '-metadata:s:0'), ['SOURCE_CREATION_TIME=exact source text']);
  input.streams[0].tags.SOURCE_CREATION_TIME = 'conflicting duplicate alias';
  assert.throws(() => argsFor(input), errorCode('UNSUPPORTED_METADATA'));
  delete input.streams[0].tags.SOURCE_CREATION_TIME;
  input.streams[0].tags.CREATION_TIME = 'conflicting duplicate timestamp';
  assert.throws(() => argsFor(input), errorCode('UNSUPPORTED_METADATA'));
  input.streams[0].tags = { SOURCE_CREATION_TIME: 'already represented; copy unchanged' };
  assert.deepEqual(values(argsFor(input), '-metadata:s:0'), []);
  assert.deepEqual(values(argsFor(input), '-map_metadata:s:0'), ['0:s:0']);
});

test('profiles expose the six independently validated defaults and are deeply immutable', () => {
  assert.deepEqual(PROFILES.map((profile) => [profile.id, profile.encoder, profile.defaultPreset, profile.quality.default]), [
    ['h264-cpu', 'libx264', 'slower', 24], ['h265-cpu', 'libx265', 'slow', 25],
    ['av1-cpu', 'libsvtav1', '6', 32], ['h264-nvidia', 'h264_nvenc', 'p5', 28],
    ['h265-nvidia', 'hevc_nvenc', 'p5', 25], ['av1-nvidia', 'av1_nvenc', 'p5', 30],
  ]);
  for (const profile of PROFILES) {
    assert.equal(profile.provisional, false);
    assert.deepEqual(profile.bitDepths, [8, 10]);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.presets), true);
    assert.equal(Object.isFrozen(profile.quality), true);
    assert.deepEqual(validateSettings(settings(profile.id)), settings(profile.id));
  }
  assert.throws(() => PROFILES[0].presets.push('injected'), TypeError);
});

test('settings validation refuses arbitrary keys, prototypes, shell-shaped options, and coercion', () => {
  const invalid = [
    null, [], 'h265-cpu', {}, { ...settings(), executable: 'cmd.exe' },
    { ...settings(), quality: '25' }, { ...settings(), quality: NaN },
    { ...settings(), quality: Infinity }, { ...settings(), quality: 25.5 },
    { ...settings(), preset: 'slow; calc.exe' }, { ...settings(), preset: '--help' },
    { ...settings(), profileId: '__proto__' }, { ...settings(), profileId: 'libx265' },
    Object.assign(Object.create({ unsafe: true }), settings()),
    { ...settings(), [Symbol('extra')]: true },
  ];
  for (const value of invalid) assert.throws(() => validateSettings(value), errorCode('INVALID_SETTINGS'));
});

test('settings use encoder-specific quality ranges and presets', () => {
  for (const profile of PROFILES) {
    for (const quality of [profile.quality.min, profile.quality.max]) {
      assert.equal(validateSettings({ ...settings(profile.id), quality }).quality, quality);
    }
    for (const quality of [profile.quality.min - 1, profile.quality.max + 1]) {
      assert.throws(() => validateSettings({ ...settings(profile.id), quality }), errorCode('INVALID_SETTINGS'));
    }
  }
  assert.throws(() => validateSettings({ ...settings('h265-cpu'), preset: 'p5' }), errorCode('INVALID_SETTINGS'));
  assert.throws(() => validateSettings({ ...settings('av1-cpu'), preset: 6 }), errorCode('INVALID_SETTINGS'));
  // Shipped libsvtav1 resolves CRF zero to its own default (35), so zero is not
  // an explicit quality level even though FFmpeg's option parser accepts it.
  assert.throws(() => validateSettings({ ...settings('av1-cpu'), quality: 0 }), errorCode('INVALID_SETTINGS'));
  for (const preset of ['10', '11', '12', '13']) {
    assert.throws(() => validateSettings({ ...settings('av1-cpu'), preset }), errorCode('INVALID_SETTINGS'));
  }
  assert.throws(() => validateSettings({ ...settings('av1-nvidia'), quality: 0 }), errorCode('INVALID_SETTINGS'));
});

test('primary video selection excludes covers and prefers the first default stream', () => {
  const cover = video({ index: 0, disposition: { attached_pic: 1, default: 1 } });
  const first = video({ index: 3, disposition: { default: 0 } });
  const preferred = video({ index: 5, disposition: { default: 1 } });
  assert.equal(selectVideo({ streams: [cover, first, preferred] }).index, 5);
  assert.equal(selectVideo({ streams: [cover, first] }).index, 3);
  assert.throws(() => selectVideo({ streams: [cover] }), errorCode('NO_VIDEO'));
  assert.throws(() => selectVideo({ streams: [first, first] }), errorCode('INVALID_PROBE'));
  assert.throws(() => selectVideo({ streams: [video({ index: '0' })] }), errorCode('INVALID_PROBE'));
});

test('10-bit pixels, Main 10 codec profile, and BT.2020 primaries alone do not mean HDR', () => {
  const result = classifyColor(probe(video({
    pix_fmt: 'yuv420p10le', profile: 'Main 10', color_primaries: 'bt2020', color_transfer: 'bt2020-10',
  })));
  assert.equal(result.classification, 'sdr');
  assert.equal(result.supported, true);
});

test('all supported SDR transfer characteristics are accepted when coherent', () => {
  for (const transfer of ['bt709', 'gamma22', 'gamma28', 'smpte170m', 'smpte240m', 'iec61966-2-1', 'bt2020-10', 'bt2020-12']) {
    const result = classifyColor(probe(video({ color_transfer: transfer })), [
      { stream_index: 0, media_type: 'video', color_transfer: transfer },
    ]);
    assert.equal(result.classification, 'sdr', transfer);
    assert.equal(result.transfer, transfer);
  }
});

test('PQ and HLG signal unsupported HDR even with contradictory SDR frame metadata', () => {
  for (const color_transfer of ['smpte2084', 'arib-std-b67']) {
    const result = classifyColor(probe(video({ color_transfer })), [{ stream_index: 0, color_transfer: 'bt709' }]);
    assert.equal(result.classification, 'hdr');
    assert.equal(result.supported, false);
  }
  assert.equal(classifyColor(probe(), [{ stream_index: 0, color_transfer: 'smpte2084' }]).classification, 'hdr');
});

test('Dolby Vision and both HDR10+ packet/frame names classify HDR independently of transfer tags', () => {
  for (const side_data_type of [
    'DOVI configuration record', 'Dolby Vision RPU Data', 'Dolby Vision Metadata',
    'HDR10+ Dynamic Metadata (SMPTE 2094-40)', 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)',
    'HDR Dynamic Metadata SMPTE2094-10',
  ]) {
    assert.equal(classifyColor(probe(video({ side_data_list: [{ side_data_type }] }))).classification, 'hdr', side_data_type);
    assert.equal(classifyColor(probe(), [{ stream_index: 0, side_data_list: [{ side_data_type }] }]).classification, 'hdr', side_data_type);
  }
});

test('HDR classification ignores filenames, titles, audio, cover art, and alternate video metadata', () => {
  const data = probe(video({ tags: { title: 'Dolby Vision HDR10+' } }), [
    video({ index: 1, color_transfer: 'smpte2084', disposition: { attached_pic: 1 } }),
    video({ index: 2, color_transfer: 'arib-std-b67', disposition: { default: 0 } }),
    { index: 3, codec_type: 'audio', side_data_list: [{ side_data_type: 'DOVI configuration record' }] },
  ]);
  data.format.filename = 'HDR10+ Dolby Vision.mkv';
  const result = classifyColor(data, [
    { stream_index: 1, color_transfer: 'smpte2084' },
    { stream_index: 2, color_transfer: 'arib-std-b67' },
    { stream_index: 3, media_type: 'audio', color_transfer: 'smpte2084' },
  ]);
  assert.equal(result.classification, 'sdr');
});

test('missing, unsupported, contradictory and static-only color evidence is ambiguous', () => {
  const inputs = [
    probe(video({ color_transfer: undefined })),
    probe(video({ color_transfer: 'unknown', pix_fmt: 'yuv420p10le', color_primaries: 'bt2020' })),
    probe(video({ color_transfer: 'linear' })),
    probe(video({ side_data_list: [{ side_data_type: 'Mastering display metadata', max_luminance: '1000/1' }] })),
    probe(video({ side_data_list: [{ side_data_type: 'Content light level metadata', max_content: 50 }] })),
  ];
  for (const input of inputs) {
    const result = classifyColor(input);
    assert.equal(result.classification, 'ambiguous');
    assert.equal(result.supported, false);
    assert.ok(result.reasons.length);
  }
  assert.equal(classifyColor(probe(), [{ stream_index: 0, color_transfer: 'gamma22' }]).classification, 'ambiguous');
});

test('bounded decoded-frame evidence can supply a missing stream transfer, while failed sampling stays ambiguous', () => {
  const data = probe(video({ color_transfer: undefined }));
  const result = classifyColor(data, [{ frames: [{ stream_index: 0, color_transfer: 'bt709' }] }]);
  assert.equal(result.classification, 'sdr');
  assert.equal(result.videoIndex, 0);
  assert.equal(classifyColor(probe(), [{ error: 'timeout' }]).classification, 'ambiguous');
  assert.equal(classifyColor(probe(), null).classification, 'ambiguous');
  // A failed sample does not erase positive HDR evidence elsewhere.
  assert.equal(classifyColor(probe(video({ color_transfer: 'smpte2084' })), [{ error: 'timeout' }]).classification, 'hdr');
});

test('stream mapping preserves every supported audio/subtitle/attachment and each disposition', () => {
  const data = probe(video({ index: 2, disposition: { default: 0 } }), [
    { index: 0, codec_type: 'audio', codec_name: 'aac', disposition: { default: 1, original: 1 } },
    { index: 3, codec_type: 'audio', codec_name: 'flac', disposition: { default: 0, comment: 1 } },
    { index: 4, codec_type: 'subtitle', codec_name: 'ass', disposition: { forced: 1, hearing_impaired: 1 } },
    { index: 6, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', disposition: {} },
    { index: 7, codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'font.ttf', mimetype: 'application/x-truetype-font' } },
  ]);
  const args = argsFor(data);
  assert.deepEqual(values(args, '-map'), ['0:2', '0:0', '0:3', '0:4', '0:6', '0:7']);
  assert.deepEqual(values(args, '-map_metadata'), ['0']);
  assert.deepEqual(values(args, '-map_chapters'), ['0']);
  assert.deepEqual(values(args, '-c'), ['copy']);
  assert.deepEqual(values(args, '-disposition:0'), ['0']);
  assert.deepEqual(values(args, '-disposition:1'), ['default+original']);
  assert.deepEqual(values(args, '-disposition:2'), ['comment']);
  assert.deepEqual(values(args, '-disposition:3'), ['forced+hearing_impaired']);
  assert.deepEqual(values(args, '-map_metadata:s:5'), ['0:s:7']);
  assert.deepEqual(values(args, '-default_mode'), ['passthrough']);
});

test('builder refuses unsupported content rather than dropping tracks or transcoding copies', () => {
  for (const stream of [
    { index: 1, codec_type: 'audio', codec_name: 'unknown_codec' },
    { index: 1, codec_type: 'subtitle', codec_name: 'mov_text' },
    { index: 1, codec_type: 'data', codec_name: 'bin_data' },
    { index: 1, codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'font.ttf' } },
    video({ index: 1, disposition: { attached_pic: 1 } }),
    { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { lyrics: 1 } },
    { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { original: 1, dub: 1 } },
    { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { 'default;calc.exe': 1 } },
  ]) {
    assert.throws(() => argsFor(probe(video(), [stream])), errorCode('UNSUPPORTED_STREAM'));
  }
});

test('builder maps only the approved primary video when alternate non-attached video exists', () => {
  const args = argsFor(probe(video(), [video({ index: 2, disposition: { default: 0 } })]));
  assert.deepEqual(values(args, '-map'), ['0:0']);
});

test('argv is explicit Matroska, noninteractive, non-overwriting and protocol constrained', () => {
  const args = argsFor(probe(), { input: 'C:\\media\\a & b; $(name).mkv', output: 'D:\\output\\my file.partial' });
  assert.ok(args.includes('-n'));
  assert.ok(args.includes('-nostdin'));
  assert.ok(!args.includes('-y'));
  assert.deepEqual(values(args, '-protocol_whitelist'), ['file,pipe']);
  assert.deepEqual(values(args, '-progress'), ['pipe:1']);
  assert.deepEqual(values(args, '-i'), ['C:\\media\\a & b; $(name).mkv']);
  assert.deepEqual(values(args, '-f'), ['matroska']);
  assert.equal(args.at(-1), 'D:\\output\\my file.partial');
  assert.deepEqual(values(args, '-fps_mode:v:0'), ['passthrough']);
});

test('builder rejects remote URLs, relative paths, NUL/newlines and identical paths', () => {
  for (const input of ['https://example.test/file.mp4', 'pipe:0', 'relative.mp4', 'C:\\bad\0name.mp4', 'C:\\bad\nname.mp4']) {
    assert.throws(() => argsFor(probe(), { input }), errorCode('INVALID_PATH'));
  }
  assert.throws(() => argsFor(probe(), { input: 'D:\\output\\OWNED.partial' }), errorCode('INVALID_PATH'));
});

test('profiles build independent encoder arguments without cross-encoder tuning', () => {
  for (const profile of PROFILES) {
    const args = argsFor(probe(), { settings: settings(profile.id) });
    assert.deepEqual(values(args, '-c:v:0'), [profile.encoder]);
    assert.deepEqual(values(args, '-preset:v:0'), [profile.defaultPreset]);
    if (profile.hardware === 'NVIDIA') {
      assert.deepEqual(values(args, '-cq:v:0'), [String(profile.quality.default)]);
      assert.deepEqual(values(args, '-rc:v:0'), ['vbr']);
      assert.deepEqual(values(args, '-b:v:0'), ['0']);
      assert.deepEqual(values(args, '-crf:v:0'), []);
    } else {
      assert.deepEqual(values(args, '-crf:v:0'), [String(profile.quality.default)]);
      assert.deepEqual(values(args, '-cq:v:0'), []);
    }
    assert.deepEqual(values(args, '-x265-params'), profile.encoder === 'libx265' ? ['aq-mode=3:psy-rd=2'] : []);
  }
});

test('SDR bit depth and color signaling are preserved rather than forced to eight-bit', () => {
  const data = probe(video({ pix_fmt: 'yuv420p10le', color_primaries: 'bt2020', color_space: 'bt2020nc', color_transfer: 'bt2020-10' }));
  for (const id of ['h264-cpu', 'h265-cpu', 'av1-cpu']) {
    const args = argsFor(data, { settings: settings(id) });
    assert.deepEqual(values(args, '-pix_fmt:v:0'), ['+yuv420p10le']);
    assert.deepEqual(values(args, '-color_trc:v:0'), ['bt2020-10']);
    assert.deepEqual(values(args, '-color_primaries:v:0'), ['bt2020']);
    assert.deepEqual(values(args, '-colorspace:v:0'), ['bt2020nc']);
  }
  for (const id of ['h264-nvidia', 'h265-nvidia', 'av1-nvidia']) {
    const args = argsFor(data, { settings: settings(id) });
    assert.deepEqual(values(args, '-pix_fmt:v:0'), ['p010le']);
    if (id === 'h264-nvidia') assert.deepEqual(values(args, '-profile:v:0'), ['high10']);
    if (id === 'h265-nvidia') assert.deepEqual(values(args, '-profile:v:0'), ['main10']);
  }
  assert.throws(() => argsFor(probe(video({ pix_fmt: 'yuva420p' }))), errorCode('UNSUPPORTED_PIXEL_FORMAT'));
  assert.throws(() => argsFor(probe(video({ pix_fmt: 'yuv444p' })), { settings: settings('av1-cpu') }), errorCode('UNSUPPORTED_PIXEL_FORMAT'));
  assert.throws(() => argsFor(probe(video({ pix_fmt: 'yuv420p12le' })), { settings: settings('h264-cpu') }), errorCode('UNSUPPORTED_PIXEL_FORMAT'));
  assert.throws(() => argsFor(probe(video({ pix_fmt: 'yuv420p12le' }))), errorCode('UNSUPPORTED_PIXEL_FORMAT'));
});

test('sample-derived SDR evidence permits a missing stream transfer but cannot override HDR or another stream', () => {
  const data = probe(video({ color_transfer: undefined }));
  const colorEvidence = classifyColor(data, [{ stream_index: 0, color_transfer: 'bt709' }]);
  assert.throws(() => argsFor(data), errorCode('AMBIGUOUS_COLOR'));
  assert.deepEqual(values(argsFor(data, { colorEvidence }), '-color_trc:v:0'), ['bt709']);
  assert.throws(() => argsFor(data, { colorEvidence: { ...colorEvidence, videoIndex: 4 } }), errorCode('AMBIGUOUS_COLOR'));
  assert.throws(() => argsFor(probe(video({ color_transfer: 'smpte2084' })), { colorEvidence }), errorCode('UNSUPPORTED_HDR'));
  assert.throws(() => argsFor(probe(video({ color_transfer: 'gamma22' })), { colorEvidence }), errorCode('AMBIGUOUS_COLOR'));
});
