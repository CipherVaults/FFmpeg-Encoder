'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRemux, validateRemuxRequest, buildRemuxQualificationArgs, REMUX_TARGETS, getRemuxAssessmentSource } = require('../src/remux-contract.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../src/provenance.cjs');

const SOURCE = 'a'.repeat(64);
const OUTPUT_ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
const PRIOR_ID = '9690cc4c-fd65-4b75-a0a2-c4b81e4f24e3';
const clone = value => structuredClone(value);

test('validation source access requires the live unblocked assessment and returns detached immutable evidence', () => {
  const assessment = assess(); const first = getRemuxAssessmentSource(assessment), second = getRemuxAssessmentSource(assessment);
  assert.notEqual(first, second); assert.deepEqual(first, second); assert.ok(Object.isFrozen(first.streams[0]));
  assert.throws(() => { first.streams[0].codec_name = 'changed'; }, TypeError);
  assert.throws(() => getRemuxAssessmentSource(clone(assessment)), { code: 'REMUX_NOT_PLANNABLE' });
  const blocked = assess(add(source(), { index: 4, codec_type: 'data', codec_name: 'bin_data' }));
  assert.equal(blocked.status, 'blocked');
  assert.throws(() => getRemuxAssessmentSource(blocked), { code: 'REMUX_NOT_PLANNABLE' });
});
const request = (target = 'matroska', overrides = {}) => ({ fileId: 'file-1', identityRevision: 3, draftRevision: 8,
  operation: 'remux', target, range: null, omissionRequestIds: [], ...overrides });
function source() {
  return { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', codec_tag_string: 'avc1', width: 1920, height: 1080, pix_fmt: 'yuv420p',
      color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
      sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/90000', start_pts: 900000, start_time: '10',
      duration_ts: 180000, duration: '2', avg_frame_rate: '60/1', r_frame_rate: '60/1', disposition: { default: 1, attached_pic: 0 }, tags: { language: 'eng' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
      time_base: '1/48000', start_pts: 480000, start_time: '10', duration_ts: 96000, duration: '2', disposition: { default: 1 }, tags: { language: 'eng', title: 'Original audio' } },
  ], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0,
    start_time: '10', duration: '2', tags: { title: 'A real source title', creation_time: '2026-10-01T12:00:00.000000Z', major_brand: 'isom' } },
  chapters: [], programs: [], stream_groups: [] };
}
function add(probe, stream) { probe.streams.push(stream); probe.format.nb_streams = probe.streams.length; return probe; }
function assess(probe = source(), target = 'matroska', extra = {}) {
  return assessRemux({ request: request(target), probe, sourceFingerprint: SOURCE, ...extra });
}
function argv(assessment, changes = {}) {
  return buildRemuxQualificationArgs({ assessment, input: 'F:\\sources\\input.mp4', output: 'F:\\owned\\output.stage', outputId: OUTPUT_ID, ...changes });
}
function option(args, key) { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; }
function allOptions(args, key) { return args.flatMap((item, index) => item === key ? [args[index + 1]] : []); }
function issue(result, code) { return result.blockers.some(item => item.code === code); }
function grant(result, streamIndex, changes = {}) {
  const stream = result.expectedOutput.streams.find(item => item.inputIndex === streamIndex);
  return { id: 'omit-one', fileId: 'file-1', identityRevision: 3, draftRevision: 8, sourceFingerprint: SOURCE,
    target: result.target, operation: 'remux', streamIndex, streamFingerprint: stream.streamFingerprint, action: 'omit-stream', ...changes };
}

test('MOV and MP4 track names declare a canonical title write; conflicting name/title blocks before muxing', () => {
  for (const target of ['mov', 'mp4']) {
    const probe = source(); probe.streams[1].tags = { name: 'Measured track name' };
    const result = assess(probe, target), track = result.expectedOutput.streams[1];
    assert.equal(result.status, 'qualification-required');
    assert.deepEqual(track.metadata.representations, [{ key: 'name', equivalence: 'native-isobmff-track-name', outputKey: 'name', writeKey: 'title' }]);
    assert.ok(allOptions(argv(result), '-metadata:s:1').includes('title=Measured track name'));
    for (const tags of [{ name: 'A', title: 'B' }, { NAME: 'A', Title: 'B' }]) {
      probe.streams[1].tags = tags; const blocked = assess(probe, target);
      assert.equal(blocked.status, 'blocked'); assert.equal(issue(blocked, 'REMUX_METADATA_AMBIGUOUS'), true);
      assert.throws(() => argv(blocked), { code: 'REMUX_NOT_PLANNABLE' });
    }
    probe.streams[1].tags = { name: 'Same', title: 'Same' };
    assert.equal(allOptions(argv(assess(probe, target)), '-metadata:s:1').filter(value => value === 'title=Same').length, 1);
  }
  const probe = source(); probe.streams[1].tags = { name: 'A', title: 'B' };
  assert.equal(assess(probe).status, 'qualification-required', 'Matroska has independent track tags; no MOV naming restriction is inherited');
});

test('only explicit source und and MOV target declare the observed unspecified-mdhd representation', () => {
  const probe = source(); probe.streams[0].tags.language = 'und';
  const expected = assess(probe, 'mov').expectedOutput.streams[0].metadata;
  assert.equal(expected.representations.find(item => item.key === 'language').equivalence, 'owned-mov-mdhd-unspecified-language');
  for (const target of ['matroska', 'mp4']) assert.equal(assess(probe, target).expectedOutput.streams[0].metadata.representations.some(item => item.equivalence === 'owned-mov-mdhd-unspecified-language'), false);
  probe.streams[0].tags.language = 'eng';
  assert.equal(assess(probe, 'mov').expectedOutput.streams[0].metadata.representations.some(item => item.equivalence === 'owned-mov-mdhd-unspecified-language'), false);
});

test('Matroska-to-MP4 declares existing native track fields without allowing arbitrary required keys or changing argv', () => {
  const probe = source();
  Object.assign(probe.streams[0].tags, { HANDLER_NAME: 'VideoHandler', BPS: '123', _STATISTICS_WRITING_APP: 'mkvmerge', VENDOR_ID: 'FFMP' });
  const original = assess(probe, 'mp4'); probe.format.format_name = 'matroska,webm';
  const result = assess(probe, 'mp4'), metadata = result.expectedOutput.streams[0].metadata;
  for (const key of ['language', 'HANDLER_NAME']) assert.ok(metadata.representations.some(item => item.key === key
    && item.equivalence === 'native-isobmff-track-field' && item.outputKey === key.toLowerCase()));
  for (const key of ['BPS', '_STATISTICS_WRITING_APP', 'VENDOR_ID']) assert.equal(metadata.representations.some(item => item.key === key), false);
  for (const key of ['BPS', '_STATISTICS_WRITING_APP']) assert.equal(metadata.classifications.find(item => item.key === key).mismatch, 'error');
  assert.equal(metadata.classifications.find(item => item.key === 'VENDOR_ID').mismatch, 'warning');
  assert.deepEqual(metadata.allowedAdditions, original.expectedOutput.streams[0].metadata.allowedAdditions);
  assert.deepEqual(argv(result), argv(original));
  for (const target of ['matroska', 'mov']) assert.equal(assess(probe, target).expectedOutput.streams[0].metadata.representations
    .some(item => item.equivalence === 'native-isobmff-track-field'), false);
  assert.equal(original.expectedOutput.streams[0].metadata.representations.some(item => item.equivalence === 'native-isobmff-track-field'), false);
});
test('Matroska-to-MP4 native language and handler declarations require representable values', () => {
  for (const [key, value] of [['language', 'en'], ['language', 'EN'], ['language', 'en-US'], ['language', 'English'], ['language', 'ENG'],
    ['language', ''], ['HANDLER_NAME', '']]) {
    const probe = source(); probe.format.format_name = 'matroska,webm'; probe.streams[0].tags = { [key]: value };
    const metadata = assess(probe, 'mp4').expectedOutput.streams[0].metadata;
    assert.equal(metadata.representations.some(item => item.key === key), false, `${key}=${value}`);
    assert.equal(metadata.preserved[key], value); assert.equal(metadata.classifications[0].mismatch, 'error');
  }
  const probe = source(); probe.format.format_name = 'matroska,webm';
  probe.streams[0].tags = { language: 'eng', HANDLER_NAME: 'VideoHandler' };
  assert.deepEqual(assess(probe, 'mp4').expectedOutput.streams[0].metadata.representations.map(item => item.key), ['language', 'HANDLER_NAME']);
});

test('strict typed Full request excludes TS output, transforms, raw argv, paths and authority claims', () => {
  assert.deepEqual(REMUX_TARGETS, ['matroska', 'mp4', 'mov']);
  for (const changes of [{ target: 'mpegts' }, { target: 'mkv' }, { range: { startUs: 0, endUs: 1 } }, { range: undefined },
    { operation: 'encode' }, { codec: 'copy' }, { argv: ['-c', 'copy'] }, { path: 'F:\\input.mkv' }, { qualified: true },
    { allowAllOmissions: true }, { identityRevision: -1 }, { draftRevision: Infinity }, { fileId: 'F:\\input.mp4' },
    { omissionRequestIds: ['same', 'same'] }, { omissionRequestIds: [true] }, { omissionRequestIds: new Array(1025).fill('id') }]) {
    assert.throws(() => validateRemuxRequest(request('matroska', changes)), { code: 'INVALID_REMUX_REQUEST' });
  }
  let read = false;
  const getters = request(); Object.defineProperty(getters, 'target', { enumerable: true, get() { read = true; return 'mp4'; } });
  assert.throws(() => validateRemuxRequest(getters), { code: 'INVALID_REMUX_REQUEST' });
  assert.equal(read, false);
});

test('candidate support never becomes execution evidence and all targets need marker round-trip', () => {
  for (const target of REMUX_TARGETS) {
    const result = assess(source(), target);
    assert.equal(result.status, 'qualification-required'); assert.equal(result.executionReady, false);
    assert.equal(result.expectedOutput.full, true);
    assert.ok(result.qualifications.every(item => item.status === 'unverified'));
    assert.ok(result.qualifications.some(item => item.id === `provenance:${target}`));
    assert.equal(result.expectedOutput.streams[1].evidence.audio.channelLayout.value, 'stereo');
    assert.equal(result.expectedOutput.contentClaim.includes('never identical whole-container bytes'), true);
    const args = argv(result);
    assert.equal(option(args, '-f'), target); assert.equal(option(args, '-c'), 'copy');
    assert.deepEqual(allOptions(args, '-map'), ['0:0', '0:2']);
    assert.equal(option(args, '-map_chapters'), '0'); assert.equal(option(args, '-avoid_negative_ts'), 'disabled');
    assert.equal(args.includes('-copyts'), true); assert.equal(args.includes('-n'), true);
    for (const forbidden of ['-vf', '-af', '-filter_complex', '-crf', '-cq', '-preset', '-ss', '-to', '-t', '-r', '-ar', '-ac', '-y']) assert.equal(args.includes(forbidden), false, forbidden);
    assert.equal(option(args, '-movflags'), target === 'matroska' ? undefined : 'use_metadata_tags');
    assert.equal(option(args, '-write_tmcd'), target === 'matroska' ? undefined : '0');
    assert.equal(option(args, '-default_mode'), target === 'matroska' ? 'passthrough' : undefined);
  }
});

test('stream mapping preserves alternate video, multiple audio, subtitle, attachment and sparse indexes in explicit order', () => {
  const probe = source();
  add(probe, { index: 6, codec_type: 'video', codec_name: 'hevc', disposition: { default: 0 }, width: 1280, height: 720 });
  add(probe, { index: 9, codec_type: 'audio', codec_name: 'flac', sample_rate: '44100', channels: 1, channel_layout: 'mono', disposition: {} });
  add(probe, { index: 4, codec_type: 'subtitle', codec_name: 'ass', disposition: { forced: 1 }, tags: { title: 'Signs' } });
  add(probe, { index: 14, codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'myfont.ttf', mimetype: 'application/x-truetype-font' }, extradata_hash: `SHA256:${'f'.repeat(64)}`, extradata_size: 100 });
  const result = assess(probe), args = argv(result);
  assert.equal(result.status, 'qualification-required');
  assert.equal(result.expectedOutput.selectedVideoInputIndex, 0);
  assert.deepEqual(result.expectedOutput.streams.map(item => [item.inputIndex, item.outputIndex]), [[0, 0], [2, 1], [4, 2], [6, 3], [9, 4], [14, 5]]);
  assert.deepEqual(allOptions(args, '-map'), ['0:0', '0:2', '0:4', '0:6', '0:9', '0:14']);
  assert.equal(option(args, '-map_metadata:s:2'), '0:s:4');
  assert.equal(option(args, '-disposition:2'), 'forced'); assert.equal(option(args, '-disposition:5'), '0');
  assert.equal(result.expectedOutput.streams[5].attachment.extradataHash, `SHA256:${'f'.repeat(64)}`);
});

test('ambiguous video selection blocks rather than silently choosing the first stream', () => {
  const probe = source(); add(probe, { index: 3, codec_type: 'video', codec_name: 'h264', disposition: { default: 1 } });
  assert.ok(issue(assess(probe), 'REMUX_SELECTED_VIDEO_AMBIGUOUS'));
  probe.streams[0].disposition.default = 0; probe.streams[2].disposition.default = 0;
  assert.ok(issue(assess(probe), 'REMUX_SELECTED_VIDEO_AMBIGUOUS'));
  probe.streams[2].disposition.default = 1;
  assert.equal(assess(probe).expectedOutput.selectedVideoInputIndex, 3);
});

test('unqualified stream yields a named decision without silently dropping it', () => {
  const probe = source(); add(probe, { index: 4, codec_type: 'subtitle', codec_name: 'ass', tags: { title: 'Needed subtitles' } });
  const result = assess(probe, 'mp4');
  assert.ok(issue(result, 'REMUX_STREAM_UNSUPPORTED'));
  assert.equal(result.expectedOutput.streams.length, 3);
  assert.equal(result.decisionsNeeded[0].label, 'Stream 4: subtitle / ass');
  assert.deepEqual(result.decisionsNeeded[0].choices, ['choose-qualified-alternate-target', 'explicitly-omit-this-stream']);
  assert.throws(() => argv(result), { code: 'REMUX_NOT_PLANNABLE' });
});

test('request IDs do not authorize omissions; exact main-bound single-stream approval is required', () => {
  const probe = source(); add(probe, { index: 4, codec_type: 'subtitle', codec_name: 'ass' });
  add(probe, { index: 5, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'mebx' });
  const initial = assess(probe, 'mp4');
  const requested = request('mp4', { omissionRequestIds: ['omit-one'] });
  const noAuthority = assess(probe, 'mp4', { request: requested });
  assert.ok(issue(noAuthority, 'REMUX_OMISSION_UNAUTHORIZED'));
  assert.equal(noAuthority.expectedOutput.omittedStreams.length, 0);
  const decision = grant(initial, 4);
  const granted = assess(probe, 'mp4', { request: requested, resolveOmission: id => id === decision.id ? decision : null });
  assert.deepEqual(granted.expectedOutput.omittedStreams.map(item => item.inputIndex), [4]);
  assert.equal(granted.expectedOutput.streams.some(item => item.inputIndex === 5), true);
  assert.ok(issue(granted, 'REMUX_STREAM_UNSUPPORTED'));
  assert.equal(granted.decisionsNeeded.length, 1);
});

test('every binding dimension invalidates an omission, including source evidence and target changes', () => {
  const probe = source(); add(probe, { index: 4, codec_type: 'subtitle', codec_name: 'ass' });
  const initial = assess(probe, 'mp4'), decision = grant(initial, 4);
  for (const changes of [{ id: 'different' }, { fileId: 'other' }, { identityRevision: 4 }, { draftRevision: 9 },
    { sourceFingerprint: 'b'.repeat(64) }, { target: 'mov' }, { operation: 'encode' }, { streamIndex: 2 },
    { streamFingerprint: 'c'.repeat(64) }, { action: 'omit-all-streams' }]) {
    const result = assess(probe, 'mp4', { request: request('mp4', { omissionRequestIds: ['omit-one'] }), resolveOmission: () => ({ ...decision, ...changes }) });
    assert.ok(issue(result, 'REMUX_OMISSION_STALE'), JSON.stringify(changes));
    assert.equal(result.expectedOutput.omittedStreams.length, 0);
  }
  probe.streams[2].tags = { title: 'Replacement subtitle' };
  assert.ok(issue(assess(probe, 'mp4', { request: request('mp4', { omissionRequestIds: ['omit-one'] }), resolveOmission: () => decision }), 'REMUX_OMISSION_STALE'));
});

test('an exact omission allows a qualification plan and reprepare without its grant restores the blocker', () => {
  const probe = source(); add(probe, { index: 4, codec_type: 'subtitle', codec_name: 'ass' });
  const decision = grant(assess(probe, 'mp4'), 4);
  const options = { request: request('mp4', { omissionRequestIds: ['omit-one'] }), resolveOmission: () => decision };
  const result = assess(probe, 'mp4', options);
  assert.equal(result.status, 'qualification-required');
  assert.deepEqual(allOptions(argv(result), '-map'), ['0:0', '0:2']);
  assert.equal(result.expectedOutput.omittedStreams[0].action, 'explicitly-omitted');
  assert.ok(issue(assess(probe, 'mp4'), 'REMUX_STREAM_UNSUPPORTED'));
  assert.ok(issue(assess(probe, 'mp4', { request: options.request }), 'REMUX_OMISSION_UNAUTHORIZED'));
});

test('unknown, contradictory or missing relationship evidence never flattens into a supported plan', () => {
  for (const change of [probe => { delete probe.programs; }, probe => { delete probe.stream_groups; },
    probe => { delete probe.format.nb_streams; }, probe => { probe.format.nb_streams = 9; },
    probe => { probe.format.nb_programs = 1; }]) {
    const probe = source(); change(probe);
    assert.ok(issue(assess(probe), 'REMUX_RELATIONSHIPS_UNKNOWN'));
  }
});

test('known track reference cannot be dissolved by approving omission of its related track', () => {
  const probe = source(); add(probe, { index: 5, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'tmcd' });
  probe.stream_groups = [{ index: 0, id: '0x3', type: 'Track Reference', nb_streams: 2, streams: [{ index: 0 }, { index: 5 }] }];
  probe.format.nb_stream_groups = 1;
  const initial = assess(probe, 'mp4');
  assert.ok(issue(initial, 'REMUX_STREAM_GROUP_UNQUALIFIED'));
  const decision = grant(initial, 5);
  const result = assess(probe, 'mp4', { request: request('mp4', { omissionRequestIds: ['omit-one'] }), resolveOmission: () => decision });
  assert.ok(issue(result, 'REMUX_STREAM_GROUP_UNQUALIFIED'));
  assert.throws(() => argv(result), { code: 'REMUX_NOT_PLANNABLE' });
});

function transport() {
  const probe = source();
  probe.format.format_name = 'mpegts'; probe.format.tags = {};
  probe.format.nb_programs = 1; probe.streams[0].id = '0x100'; probe.streams[1].id = '0x101';
  probe.programs = [{ program_id: 1, program_num: 1, nb_streams: 2, pmt_pid: 4096, pcr_pid: 256, streams: [{ index: 0 }, { index: 2 }] }];
  return probe;
}
test('simple known TS is a bounded candidate with named AAC framing change and no TS output', () => {
  const probe = transport(), result = assess(probe, 'mp4'), args = argv(result);
  assert.equal(result.status, 'qualification-required');
  assert.equal(result.expectedOutput.relationships.disposition, 'operation-required-transformation');
  assert.equal(result.expectedOutput.bitstream[0].filter, 'aac_adtstoasc');
  assert.equal(option(args, '-bsf:1'), 'aac_adtstoasc');
  assert.ok(result.qualifications.some(item => item.id === 'transport-timestamps-and-framing'));
  assert.equal(result.executionReady, false);
});

test('TS unknown program, multiple programs, unresolved membership and service metadata remain specific blockers', () => {
  for (const [change, code] of [[probe => { probe.programs = []; probe.format.nb_programs = 0; }, 'REMUX_PROGRAM_UNKNOWN'],
    [probe => { probe.programs[0].streams.pop(); probe.programs[0].nb_streams = 1; }, 'REMUX_PROGRAM_UNKNOWN'],
    [probe => { probe.programs.push({ ...clone(probe.programs[0]), program_id: 2 }); probe.format.nb_programs = 2; }, 'REMUX_PROGRAM_UNQUALIFIED'],
    [probe => { probe.programs[0].tags = { service_name: 'Do not lose this', service_provider: 'Provider' }; }, 'REMUX_PROGRAM_METADATA_UNREPRESENTABLE']]) {
    const probe = transport(); change(probe); assert.ok(issue(assess(probe), code), code);
  }
});

// October23 owner amendment: descriptive dates/container labels are copy
// attempts; functional track/chapter labels and unknown tags remain required.
test('metadata separates descriptive copy attempts from functional preservation without losing existing mapping', () => {
  const probe = source();
  probe.streams[0].tags.creation_time = '2026-09-01T00:00:00.123456Z';
  probe.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000, start_time: '0', end_time: '1', tags: { title: 'Chapter', creation_time: '2026-09-01T00:00:00Z' } }];
  const result = assess(probe), args = argv(result), metadata = result.expectedOutput.streams[0].metadata;
  assert.equal(metadata.attempted.creation_time, probe.streams[0].tags.creation_time);
  assert.equal(Object.hasOwn(metadata.preserved, 'creation_time'), false);
  assert.equal(metadata.classifications.find(item => item.key === 'creation_time').mismatch, 'warning');
  assert.equal(metadata.representations[0].outputKey, 'SOURCE_CREATION_TIME');
  assert.equal(option(args, '-metadata:s:0'), `SOURCE_CREATION_TIME=${probe.streams[0].tags.creation_time}`);
  assert.equal(result.expectedOutput.metadata.attempted.title, 'A real source title');
  assert.equal(result.expectedOutput.metadata.replacements[0].key, 'major_brand');
  assert.equal(result.expectedOutput.chapters[0].metadata.preserved.title, 'Chapter');
  assert.equal(result.expectedOutput.chapters[0].metadata.representations[0].outputKey, undefined);
  assert.equal(result.expectedOutput.metadataPolicy.id, 'remux-functional-consequence');
  assert.equal(option(args, '-map_metadata'), '0');
  assert.equal(option(args, '-map_metadata:s:0'), '0:s:0');
  assert.equal(option(args, '-map_chapters'), '0');
});

test('vendor/tool descriptions are attempted while derived counters, brands and provenance retain their transformations', () => {
  const probe = source();
  Object.assign(probe.streams[0].tags, { vendor_id: 'FFMP', encoder: 'Source tool', generator: 'Generator', duration: '00:00:02', number_of_frames: '120', number_of_bytes: '100' });
  const result = assess(probe), metadata = result.expectedOutput.streams[0].metadata;
  assert.deepEqual(metadata.attempted, { vendor_id: 'FFMP', encoder: 'Source tool', generator: 'Generator' });
  assert.deepEqual(metadata.preserved, { language: 'eng' });
  assert.deepEqual(metadata.replacements.map(item => item.key), ['duration', 'number_of_frames', 'number_of_bytes']);
  assert.ok(metadata.classifications.every(item => item.key === 'language' ? item.mismatch === 'error' : item.mismatch === 'warning'));
  assert.equal(Object.isFrozen(metadata.attempted), true);
  assert.equal(Object.isFrozen(metadata.classifications), true);
  assert.equal(Object.isFrozen(metadata.policy.descriptiveTagKeys), true);
});

test('output-only neutral defaults and track-name aliases are explicitly bounded in the main metadata contract', () => {
  const probe = source(); delete probe.streams[0].tags.language;
  for (const target of ['matroska', 'mp4', 'mov']) {
    const expected = assess(probe, target).expectedOutput;
    const video = expected.streams[0].metadata, audio = expected.streams[1].metadata;
    assert.equal(video.allowedAdditions.find(item => item.key === 'language').value, 'und');
    assert.equal(audio.allowedAdditions.some(item => item.key === 'language'), false, 'an existing language has no neutral overwrite permission');
    if (target === 'matroska') assert.equal(video.allowedAdditions.some(item => item.key === 'handler_name'), false);
    else {
      assert.equal(video.allowedAdditions.find(item => item.key === 'handler_name').value, 'VideoHandler');
      assert.equal(audio.allowedAdditions.find(item => item.key === 'handler_name').value, 'SoundHandler');
      assert.equal(audio.allowedAdditions.find(item => item.key === 'name').value, 'Original audio');
    }
    assert.equal(expected.metadata.allowedAdditions.find(item => item.key === MARKER_KEY).value, '1');
    assert.equal(expected.metadata.allowedAdditions.find(item => item.key === OUTPUT_ID_KEY).match, 'fresh-output-id');
    assert.equal(expected.metadata.allowedAdditions.some(item => item.key === GENERATION_KEY), false);
    assert.equal(Object.isFrozen(video.allowedAdditions), true);
    assert.ok(video.allowedAdditions.every(Object.isFrozen));
  }
  const existing = source(); existing.streams[0].tags.handler_name = 'Custom source label';
  assert.equal(assess(existing, 'mp4').expectedOutput.streams[0].metadata.allowedAdditions.some(item => item.key === 'handler_name'), false);
});

test('prototype-looking metadata remains explicit preservation evidence rather than disappearing', () => {
  const probe = source();
  probe.format.tags = JSON.parse('{"__proto__":"original text","constructor":"another original value"}');
  const metadata = assess(probe).expectedOutput.metadata.preserved;
  assert.equal(Object.hasOwn(metadata, '__proto__'), true);
  assert.equal(metadata.__proto__, 'original text');
  assert.equal(metadata.constructor, 'another original value');
  assert.equal(Object.getPrototypeOf(metadata), Object.prototype);
});

test('alias conflict and case-ambiguous user metadata block rather than overwrite a value', () => {
  const probe = source(); probe.streams[0].tags.creation_time = '2026-01-01T00:00:00Z'; probe.streams[0].tags.SOURCE_CREATION_TIME = 'Another original value';
  assert.ok(issue(assess(probe), 'UNSUPPORTED_METADATA'));
  const duplicate = source(); duplicate.format.tags.TITLE = 'Contradictory title';
  assert.ok(issue(assess(duplicate), 'REMUX_METADATA_AMBIGUOUS'));
  const equals = source(); equals.streams[1].tags['key=value'] = 'Cannot represent safely';
  assert.ok(issue(assess(equals), 'REMUX_METADATA_AMBIGUOUS'));
});

test('invalid chapter boundaries block; MOV chapter-carrier streams need distinct native qualification', () => {
  for (const chapter of [{ id: 0, start: 0, end: 100 }, { id: 0, start: 100, end: 100, time_base: '1/1000' },
    { id: 0, start: 'not-time', end: 100, time_base: '1/1000' }]) {
    const probe = source(); probe.chapters = [chapter];
    assert.ok(issue(assess(probe), 'REMUX_CHAPTER_TIMELINE_UNKNOWN'));
  }
  const probe = source(); probe.chapters = [{ id: 0, start: 0, end: 1000, time_base: '1/1000', tags: { title: 'A chapter' } }];
  const result = assess(probe, 'mp4');
  assert.equal(result.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired, true);
  assert.equal(result.expectedOutput.auxiliaryStreams.qualifiedCarriers, null);
  assert.ok(result.qualifications.some(item => item.id === 'mov-chapter-carrier'));
  assert.equal(result.executionReady, false);
});

test('generated input requires separate main admission and fresh marker; old encode description is explicitly cleared', () => {
  const probe = source(); Object.assign(probe.format.tags, { [MARKER_KEY.toLowerCase()]: '1', [OUTPUT_ID_KEY]: PRIOR_ID, [GENERATION_KEY]: 'unavailable legacy description' });
  const result = assess(probe, 'mp4'), args = argv(result);
  assert.equal(result.sourceAdmission.required, 'main-bound-generated-source-authorization');
  assert.equal(result.sourceAdmission.marker.kind, 'generated');
  assert.equal(result.expectedOutput.provenance.descriptiveGeneration, 'absent-until-remux-description-schema');
  for (const key of [MARKER_KEY.toLowerCase(), OUTPUT_ID_KEY, GENERATION_KEY]) assert.ok(allOptions(args, '-metadata').includes(`${key}=`));
  assert.ok(allOptions(args, '-metadata').includes(`${OUTPUT_ID_KEY}=${OUTPUT_ID}`));
  assert.throws(() => argv(result, { outputId: PRIOR_ID }), { code: 'INVALID_REMUX_PROVENANCE' });
  assert.throws(() => argv(result, { outputId: 'not-a-uuid' }), { code: 'PROVENANCE_UNAVAILABLE' });
});

test('suspicious or misplaced provenance cannot become plausible new marked output', () => {
  const malformed = source(); malformed.format.tags[MARKER_KEY] = '1';
  assert.ok(issue(assess(malformed), 'REMUX_PROVENANCE_AMBIGUOUS'));
  const misplaced = source(); misplaced.streams[0].tags[MARKER_KEY] = '1';
  assert.ok(issue(assess(misplaced), 'REMUX_PROVENANCE_AMBIGUOUS'));
});

test('source color and side data are expectations for stream copy, never a hidden HDR-to-SDR decision', () => {
  const probe = source(); Object.assign(probe.streams[0], { codec_name: 'hevc', pix_fmt: 'yuv420p10le', color_transfer: 'arib-std-b67', color_primaries: 'bt2020', color_space: 'bt2020nc',
    side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8, dv_bl_signal_compatibility_id: 4, rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1 }] });
  const result = assess(probe), args = argv(result);
  assert.equal(result.expectedOutput.streams[0].evidence.color.transfer.value, 'arib-std-b67');
  assert.equal(result.expectedOutput.streams[0].sideData[0].dv_profile, 8);
  assert.ok(result.qualifications.some(item => item.id === 'side-data:0'));
  assert.equal(args.some(value => /tonemap|dovi_rpu|libplacebo|zscale/.test(value)), false);
  assert.equal(result.executionReady, false);
});

test('attachment and disposition incompatibilities are named rather than converted or ignored', () => {
  const probe = source(); add(probe, { index: 3, codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'myfont.ttf', mimetype: 'application/x-truetype-font' } });
  assert.ok(issue(assess(probe), 'REMUX_STREAM_UNSUPPORTED'));
  const flags = source(); flags.streams[0].disposition.multilayer = 1;
  assert.ok(issue(assess(flags), 'REMUX_STREAM_UNSUPPORTED'));
  flags.streams[0].disposition.multilayer = 0; flags.streams[0].disposition.default = 'bad';
  assert.ok(issue(assess(flags), 'REMUX_STREAM_UNSUPPORTED'));
  const both = source(); both.streams[1].disposition = { original: 1, dub: 1 };
  assert.ok(issue(assess(both), 'REMUX_STREAM_UNSUPPORTED'));
});

test('unknown codec/type, container and ordinary MOV codec limits are not advertised as verified support', () => {
  for (const stream of [{ index: 4, codec_type: 'data', codec_name: 'bin_data', codec_tag_string: 'mebx' },
    { index: 4, codec_type: 'subtitle', codec_name: 'new-codec' }, { index: 4, codec_type: 'unknown', codec_name: 'aac' }]) {
    assert.ok(issue(assess(add(source(), stream)), 'REMUX_STREAM_UNSUPPORTED'));
  }
  const unknown = source(); unknown.format.format_name = 'playlist';
  assert.ok(issue(assess(unknown), 'REMUX_CONTAINER_UNKNOWN'));
  const av1 = source(); av1.streams[0].codec_name = 'av1';
  assert.ok(issue(assess(av1, 'mov'), 'REMUX_STREAM_UNSUPPORTED'));
  assert.equal(assess(av1, 'mp4').status, 'qualification-required');
});

test('source and output path validation preserves argv literals and refuses aliases without shell execution', () => {
  const result = assess();
  for (const input of ['https://example.test/input.mp4', 'relative.mp4', 'F:\\source\0bad', 'F:\\source\nname']) assert.throws(() => argv(result, { input }), { code: 'INVALID_REMUX_PATH' });
  assert.throws(() => argv(result, { input: 'F:\\sources\\..\\input.mp4', output: 'f:/input.mp4' }), { code: 'INVALID_REMUX_PATH' });
  const hostile = 'F:\\sources\\$(do nothing) & name \' quoted.mp4';
  const args = argv(result, { input: hostile });
  assert.equal(option(args, '-i'), hostile);
  assert.equal(args.at(-1), 'F:\\owned\\output.stage');
});

test('immutable assessment detaches source/request data and cannot be forged or extended with raw args', () => {
  const probe = source(), req = request();
  const result = assess(probe, 'matroska', { request: req });
  probe.streams[0].codec_name = 'av1'; req.target = 'mp4';
  assert.equal(result.target, 'matroska'); assert.equal(result.expectedOutput.streams[0].codecName, 'h264');
  assert.throws(() => { result.executionReady = true; }, TypeError);
  assert.throws(() => { result.expectedOutput.streams[0].metadata.preserved.language = 'fra'; }, TypeError);
  assert.throws(() => argv(clone(result)), { code: 'REMUX_NOT_PLANNABLE' });
  assert.throws(() => argv(result, { args: ['-y'] }), { code: 'INVALID_REMUX_REQUEST' });
});

test('bounded normalization rejects malicious evidence without reading an accessor or allocating unbounded data', () => {
  let read = false;
  const accessor = source(); Object.defineProperty(accessor.streams[0], 'evil', { enumerable: true, get() { read = true; return 'x'; } });
  assert.throws(() => assess(accessor), { code: 'INVALID_REMUX_EVIDENCE' }); assert.equal(read, false);
  const cyclic = source(); cyclic.self = cyclic;
  assert.throws(() => assess(cyclic), { code: 'INVALID_REMUX_EVIDENCE' });
  const huge = source(); huge.format.tags.comment = 'x'.repeat(16385);
  assert.throws(() => assess(huge), { code: 'INVALID_REMUX_EVIDENCE' });
  const nul = source(); nul.format.tags.comment = 'broken\0text';
  assert.throws(() => assess(nul), { code: 'INVALID_REMUX_EVIDENCE' });
  assert.throws(() => assess(source(), 'matroska', { sourceFingerprint: 'not-an-identity' }), { code: 'INVALID_REMUX_REQUEST' });
  assert.throws(() => assess(source(), 'matroska', { resolveOmission: { approved: true } }), { code: 'INVALID_REMUX_REQUEST' });
});
