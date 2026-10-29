'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const { describeNativeFileSource, buildNativeFileContract, readNativeFileContract } = require('../src/native-file-contract.cjs');
const { buildNativeFileCommand } = require('../src/native-file-command.cjs');
const { nativeEncoderContribution } = require('../src/backend-adapters.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY, classifyMarker } = require('../src/provenance.cjs');
const DEVICE = '33333333-3333-4333-8333-333333333333', OUTPUT = '44444444-4444-4444-8444-444444444444', OLD = '55555555-5555-4555-8555-555555555555';
function fixture(backend = 'qsv', mode = 'cqp', quality = { i: 22, p: 25, b: 28 }, customize = () => {}) {
  const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: '11111111-1111-4111-8111-111111111111', identityRevision: 0,
    draftId: '22222222-2222-4222-8222-222222222222', draftRevision: 0, profileId: 'h264-' + backend,
    settings: { preset: backend === 'amf' ? 'balanced' : 'medium', mode, quality, deviceId: DEVICE }, bitDepth: 8, target: 'matroska',
    resolution: 'source', range: null, signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] };
  const probe = { streams: [{ index: 7, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360', start_pts: 0, start_time: '0.000000', duration_ts: 15360, duration: '1.000000', nb_frames: '30', disposition: { default: 1 }, tags: {} }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: '4096', start_time: '0.000000', duration: '1.000000', tags: {} }, chapters: [], programs: [], stream_groups: [] };
  customize(probe);
  const applicability = describeNativeFileSource({ probe, sourceBytes: '4096', request }), contract = buildNativeFileContract({ request, applicability });
  const fragment = nativeEncoderContribution(request.profileId, { preset: request.settings.preset, mode, quality }, { bitDepth: 8 });
  const generationDescription = { version: 2, kind: 'native-encoder', adapterPolicyVersion: 1, profileId: request.profileId, codec: 'H264', backend,
    encoder: 'h264_' + backend, preset: request.settings.preset, qualityMode: mode.toUpperCase(), quality: structuredClone(fragment.settings.quality), bitDepth: 8,
    pipelineId: fragment.pipelineId, encoderArgs: [...fragment.args], settingsRole: 'requested', scope: 'native-encoder-contribution-only', appVersion: '0.7.0-alpha.1', createdAt: '2026-10-26T12:00:00.000Z' };
  const device = { id: DEVICE, backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086', adapterIndex: 3, adapterIdentity: 'adapter-3', driverVersion: 'driver-1', runtimeVersion: 'runtime-1' };
  return { probe, request, contract, fragment, options: { contract, input: 'D:\\sources\\native source.mp4', output: 'F:\\owned\\candidate.mkv', device, outputId: OUTPUT, generationDescription } };
}
const value = (argv, key) => argv[argv.indexOf(key) + 1];

test('only the original branded contract exposes its frozen isolated normalized source metadata', () => {
  const f = fixture('qsv', 'cqp', 25, p => { p.streams[0].tags.title = 'original'; });
  const context = readNativeFileContract(f.contract);
  assert.equal(context.contract, f.contract); assert.equal(context.probe.streams[0].tags.title, 'original');
  assert.ok(Object.isFrozen(context)); assert.ok(Object.isFrozen(context.probe.streams[0].tags));
  f.probe.streams[0].tags.title = 'changed after contract'; assert.equal(context.probe.streams[0].tags.title, 'original');
  for (const forged of [{ ...f.contract }, structuredClone(f.contract), Object.create(f.contract), null]) {
    assert.throws(() => readNativeFileContract(forged), { code: 'NATIVE_FILE_CONTRACT_UNOWNED' });
    assert.throws(() => buildNativeFileCommand({ ...f.options, contract: forged }), { code: 'NATIVE_FILE_CONTRACT_UNOWNED' });
  }
});

for (const [backend, mode, quality] of [['qsv', 'cqp', { i: 22, p: 25, b: 28 }], ['qsv', 'icq', 29], ['amf', 'cqp', { i: 20, p: 27, b: 31 }], ['amf', 'qvbr', 37]]) {
  test(`${backend} ${mode} builds the exact canonical file contribution without fallback or execution authority`, () => {
    const f = fixture(backend, mode, quality), result = buildNativeFileCommand(f.options), a = result.argv;
    assert.equal(result.status, 'unqualified'); assert.equal(result.executionAuthority, 'none'); assert.equal(result.fileExecutionReady, false);
    assert.equal(result.outputRole, 'expected-owned-stage'); assert.match(result.bindingAssurance, /no live selection/);
    assert.deepEqual(result.generationDescription.encoderArgs, f.fragment.args);
    assert.deepEqual(a.slice(a.indexOf('-c:v:0'), a.indexOf('-c:v:0') + f.fragment.args.length), f.fragment.args);
    assert.equal(value(a, '-vf'), 'format=nv12,hwupload=extra_hw_frames=16');
    assert.equal(value(a, '-init_hw_device'), 'd3d11va=ffenc_d3d:3'); assert.ok(a.indexOf('-init_hw_device') < a.indexOf('-i'));
    assert.equal(value(a, '-filter_hw_device'), backend === 'qsv' ? 'ffenc_qsv' : 'ffenc_d3d');
    assert.equal(a.includes('qsv=ffenc_qsv@ffenc_d3d'), backend === 'qsv');
    assert.equal(value(a, '-loglevel'), 'level+verbose'); assert.equal(value(a, '-progress'), 'pipe:1');
    assert.equal(value(a, '-profile:v:0'), 'high'); assert.equal(value(a, '-pix_fmt:v:0'), backend === 'qsv' ? 'qsv' : 'd3d11');
    assert.equal(value(a, '-b:v:0'), '0');
    assert.equal(result.argvSha256, createHash('sha256').update(JSON.stringify(a)).digest('hex'));
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(result.device));
    for (const key of ['executable', 'receipt', 'publication', 'lease', 'runtime', 'grant']) assert.equal(Object.hasOwn(result, key), false);
    if (mode === 'cqp' && backend === 'qsv') { assert.equal(value(a, '-q:v:0'), '25'); assert.equal(value(a, '-i_qoffset:v:0'), '-3'); assert.equal(value(a, '-b_qoffset:v:0'), '3'); }
    if (mode === 'icq') { assert.equal(value(a, '-global_quality:v:0'), '29'); assert.equal(a.includes('-q:v:0'), false); }
    if (mode === 'qvbr') assert.equal(value(a, '-qvbr_quality_level:v:0'), '37');
  });
}

test('Full KeepSource maps the actual source index and keeps exact timeline intent without frame or rate truncation', () => {
  const f = fixture(), a = buildNativeFileCommand(f.options).argv;
  assert.equal(value(a, '-i'), f.options.input); assert.equal(value(a, '-map'), '0:7'); assert.equal(a.filter(x => x === '-i').length, 1); assert.equal(a.filter(x => x === '-map').length, 1);
  assert.ok(a.indexOf('-copyts') < a.indexOf('-i')); assert.ok(a.indexOf('-noautorotate') < a.indexOf('-i'));
  assert.equal(value(a, '-fps_mode:v:0'), 'passthrough'); assert.equal(value(a, '-avoid_negative_ts'), 'disabled');
  assert.equal(value(a, '-default_mode'), 'passthrough'); assert.deepEqual(a.slice(-3), ['-f', 'matroska', f.options.output]);
  assert.equal(value(a, '-fflags'), '+bitexact'); assert.ok(a.indexOf('-fflags')>a.indexOf('-i'));
  for (const key of ['-r', '-framerate', '-ss', '-t', '-to', '-frames:v', '-frames:v:0', '-s', '-s:v', '-shortest', '-y', '-hwaccel']) assert.equal(a.includes(key), false, key);
  assert.ok(a.includes('-n')); assert.ok(a.includes('-an') && a.includes('-sn') && a.includes('-dn'));
  assert.equal(value(a, '-protocol_whitelist'), 'file,pipe'); assert.equal(value(a, '-format_whitelist'), 'mov,matroska,webm');
  for (const key of ['-color_primaries:v:0', '-color_trc:v:0', '-colorspace:v:0']) assert.equal(value(a, key), 'bt709');
  assert.equal(value(a, '-color_range:v:0'), 'tv'); assert.equal(value(a, '-chroma_sample_location:v:0'), 'left');
});

test('source metadata maps from the private probe with creation-time alias and explicit default0 or1', () => {
  for (const disposition of [0, 1]) {
    const f = fixture('qsv', 'cqp', 25, p => { p.streams[0].disposition.default = disposition; p.streams[0].tags = { title: 'Track', creation_time: '2026-01-01T00:00:00.000Z' }; p.format.tags.title = 'Source'; });
    const a = buildNativeFileCommand(f.options).argv;
    assert.equal(value(a, '-map_metadata'), '0'); assert.equal(value(a, '-map_metadata:s:0'), '0:s:7'); assert.equal(value(a, '-map_chapters'), '0');
    assert.equal(value(a, '-disposition:0'), disposition ? 'default' : '0'); assert.ok(a.includes('SOURCE_CREATION_TIME=2026-01-01T00:00:00.000Z'));
  }
  const conflict = fixture('qsv', 'cqp', 25, p => { p.streams[0].tags = { creation_time: 'first', SOURCE_CREATION_TIME: 'different' }; });
  assert.throws(() => buildNativeFileCommand(conflict.options), { code: 'UNSUPPORTED_METADATA' });
});

test('new provenance cross-binds requested recipe and clears the original casing of old application tags', () => {
  const f = fixture('qsv', 'cqp', 25, p => { p.format.tags = { ffmpeg_encoder_provenance: '1', Ffmpeg_Encoder_Output_Id: OLD, FfMpEg_EnCoDeR_GeNeRaTiOn: 'malformed old description' }; });
  const result = buildNativeFileCommand(f.options), a = result.argv;
  assert.equal(result.sourceAdmission, 'current-per-file-generated-source-permission-required');
  for (const key of Object.keys(f.probe.format.tags)) assert.ok(a.includes(key + '='));
  assert.ok(a.indexOf('ffmpeg_encoder_provenance=') < a.indexOf(MARKER_KEY + '=1'));
  const tags = Object.fromEntries(a.flatMap((x, i) => x === '-metadata' ? [a[i + 1]] : []).filter(x => !x.endsWith('=')).map(x => { const n = x.indexOf('='); return [x.slice(0, n), x.slice(n + 1)]; }));
  const marker = classifyMarker({ format: { tags } }); assert.equal(marker.kind, 'generated'); assert.equal(marker.outputId, OUTPUT);
  assert.deepEqual(marker.previousGeneration, result.generationDescription); assert.ok(tags[GENERATION_KEY]);
  assert.throws(() => buildNativeFileCommand({ ...f.options, outputId: OLD.toUpperCase() }), { code: 'NATIVE_FILE_PROVENANCE_UNSUPPORTED' });
});

test('suspicious, unknown, partial or misplaced reserved provenance is never copied into a candidate', () => {
  for (const change of [p => { p.format.tags[MARKER_KEY] = '1'; }, p => { p.format.tags.FFMPEG_ENCODER_UNKNOWN = 'anything'; },
    p => { p.streams[0].tags[OUTPUT_ID_KEY] = OLD; }, p => { p.format.tags = { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: OLD, [MARKER_KEY.toLowerCase()]: '1' }; }]) {
    assert.throws(() => buildNativeFileCommand(fixture('qsv', 'cqp', 25, change).options), { code: 'NATIVE_FILE_PROVENANCE_UNSUPPORTED' });
  }
});

test('a valid description for another mode, quality, preset, profile or bit depth cannot describe this command', () => {
  const f = fixture(), other = [fixture('qsv', 'icq', 29), fixture('qsv', 'cqp', { i: 22, p: 26, b: 28 }), fixture('amf', 'cqp', { i: 22, p: 25, b: 28 })];
  for (const description of [...other.map(x => x.options.generationDescription), undefined, null, { ...f.options.generationDescription, version: 1 },
    { ...f.options.generationDescription, preset: 'slow' }, { ...f.options.generationDescription, bitDepth: 10 }, { ...f.options.generationDescription, encoderArgs: ['-c:v:0', 'libx264'] }]) {
    assert.throws(() => buildNativeFileCommand({ ...f.options, generationDescription: description }), { code: 'NATIVE_FILE_DESCRIPTION_MISMATCH' });
  }
});

test('device mismatch, unsupported descriptor and wrong backend refuse without fallback', () => {
  const f = fixture();
  for (const device of [{ ...f.options.device, id: OLD }, { ...f.options.device, adapterIndex: -1 }, { ...f.options.device, adapterIndex: 64 },
    { ...f.options.device, backend: 'amf', vendorId: '0x1002' }, { ...f.options.device, vendorId: '0x1002' }, { ...f.options.device, extra: 'argv' }, null]) assert.throws(() => buildNativeFileCommand({ ...f.options, device }));
  const command = buildNativeFileCommand({ ...f.options, device: { ...f.options.device, adapterIndex: 2, adapterIdentity: 'adapter-2' } });
  assert.equal(value(command.argv, '-init_hw_device'), 'd3d11va=ffenc_d3d:2'); assert.match(command.bindingAssurance, /descriptor only/);
});

test('path assertions are local, bounded and distinct and cannot add another argv element', () => {
  const f = fixture();
  for (const file of ['', 'relative.mp4', 'https://example.invalid/input', 'file:D:/source.mp4', 'D:\\source\n.mp4', 'x'.repeat(32768), null,
    '\\\\server\\share\\input.mkv', '\\\\?\\D:\\source.mkv', '\\\\.\\pipe\\input.mkv', 'D:\\source.mkv:alternate', 'D:\\', 'D:\\folder\\',
    '/posix/source.mkv', 'D:relative.mkv', 'D:\\NUL.mkv', 'D:\\COM1.mkv', 'D:\\folder.\\file.mkv', 'D:\\file?.mkv', 'D:\\file.mkv ']) {
    for (const field of ['input', 'output']) assert.throws(() => buildNativeFileCommand({ ...f.options, [field]: file }), { code: 'INVALID_NATIVE_FILE_PATH' });
  }
  assert.throws(() => buildNativeFileCommand({ ...f.options, output: 'd:/sources/NATIVE SOURCE.mp4' }), { code: 'INVALID_NATIVE_FILE_PATH' });
  assert.throws(() => buildNativeFileCommand({ ...f.options, input: 'F:/owned/../owned/CANDIDATE.MKV' }), { code: 'INVALID_NATIVE_FILE_PATH' });
  for (const output of ['F:\\owned\\candidate.stage', 'F:\\owned\\candidate.mp4', 'F:\\owned\\candidate']) assert.throws(() => buildNativeFileCommand({ ...f.options, output }), { code: 'INVALID_NATIVE_FILE_PATH' });
  const input = 'D:\\source\\a & name $(literal).mp4', result = buildNativeFileCommand({ ...f.options, input });
  assert.equal(value(result.argv, '-i'), input); assert.equal(result.argv.filter(x => x === '-i').length, 1);
});

test('unknown, accessor, hidden, cyclic and callback fields cannot extend a command request or execute getters', () => {
  const f = fixture(); let calls = 0;
  const getter = { ...f.options }; Object.defineProperty(getter, 'input', { enumerable: true, get() { calls++; return f.options.input; } });
  const deviceGetter = { ...f.options.device }; Object.defineProperty(deviceGetter, 'adapterIndex', { enumerable: true, get() { calls++; return 3; } });
  const hidden = { ...f.options }; Object.defineProperty(hidden, 'input', { enumerable: false, value: f.options.input });
  const descriptionGetter = { ...f.options.generationDescription }; Object.defineProperty(descriptionGetter, 'encoderArgs', { enumerable: true, get() { calls++; return []; } });
  const cycle = {}; cycle.self = cycle;
  for (const options of [getter, hidden, { ...f.options, device: deviceGetter }, { ...f.options, generationDescription: descriptionGetter },
    { ...f.options, generationDescription: cycle }, { ...f.options, argv: [] }, { ...f.options, filter: 'scale=1:1' }, { ...f.options, run() { calls++; } },
    { ...f.options, [Symbol('extra')]: true }]) assert.throws(() => buildNativeFileCommand(options));
  assert.equal(calls, 0);
});

test('constructed commands retain private immutable bindings without modifying caller device or description', () => {
  const f = fixture(), before = structuredClone(f.options.device), generation = structuredClone(f.options.generationDescription), result = buildNativeFileCommand(f.options);
  assert.deepEqual(f.options.device, before); assert.deepEqual(f.options.generationDescription, generation);
  assert.equal(Object.isFrozen(f.options.device), false); assert.equal(Object.isFrozen(f.options.generationDescription), false);
  f.options.device.adapterIndex = 1; f.options.generationDescription.quality.p = 1;
  assert.equal(result.device.adapterIndex, 3); assert.equal(result.generationDescription.quality.p, 25);
});
