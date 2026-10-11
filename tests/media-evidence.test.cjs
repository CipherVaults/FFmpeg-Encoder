'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProbe, inspectMetadata, finishInspection, reconstructInspection, INSPECTION_POLICY } = require('../src/inspection.cjs');
const { rationalEvidence, integerEvidence, EVIDENCE_LIMITS, normalizeSideData } = require('../src/media-evidence.cjs');
const { classifyColor, buildEncodeArgs } = require('../src/media.cjs');

function source(overrides = {}) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', avg_frame_rate: '60/1', r_frame_rate: '60/1', ...overrides }], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '21.658333' }, chapters: [] };
}
const first = probe => normalizeProbe(probe).mediaEvidence.streams[0];
const rational = (numerator, denominator) => ({ state: 'known', value: { numerator, denominator } });

test('SAR, DAR and timestamp evidence keep exact reduced rationals without guessing missing geometry', () => {
  const result = first(source({ width: 852, height: 480, sample_aspect_ratio: '640:639', display_aspect_ratio: '16:9', time_base: '1/90000', start_pts: '-9007199254740993', duration_ts: '9007199254740995' }));
  assert.deepEqual(result.geometry.sampleAspectRatio, rational('640', '639'));
  assert.deepEqual(result.geometry.displayAspectRatio, rational('16', '9'));
  assert.deepEqual(result.timeline.timeBase, rational('1', '90000'));
  assert.equal(result.timeline.startPts.value, '-9007199254740993');
  assert.equal(result.timeline.durationTicks.value, '9007199254740995');
  assert.equal(first(source()).geometry.sampleAspectRatio.state, 'unknown');
  assert.equal(first(source()).geometry.rotationDegrees.state, 'unknown');
});

test('missing, ffprobe unknown sentinels and malformed rational evidence remain distinguishable', () => {
  assert.deepEqual(rationalEvidence(undefined), { state: 'unknown', reason: 'not-reported' });
  assert.deepEqual(rationalEvidence('N/A'), { state: 'unknown', reason: 'unspecified' });
  assert.equal(rationalEvidence('0/0').state, 'unknown');
  assert.equal(rationalEvidence('0:1', { separator: ':' }).state, 'unknown');
  for (const value of ['1/0', '1/-1', '12/3junk', true, {}, '1e30/1', `${'1'.repeat(41)}/1`]) assert.equal(rationalEvidence(value).state, 'malformed', String(value));
  assert.equal(rationalEvidence('-1/2', { positive: true }).state, 'malformed');
  assert.deepEqual(rationalEvidence('-1.250000', { decimal: true }), rational('-5', '4'));
  assert.deepEqual(rationalEvidence('0.000000', { decimal: true }), rational('0', '1'));
  assert.equal(integerEvidence(9007199254740992).state, 'malformed');
});

test('display matrix and its declared rotation survive without inventing square pixels or orthogonality', () => {
  const matrix = '\n00000000:            0      -65536           0\n00000001:        65536           0           0\n00000002:            0           0  1073741824\n';
  const probe = normalizeProbe(source({ side_data_list: [{ side_data_type: 'Display Matrix', displaymatrix: matrix, rotation: 90 }] }));
  assert.equal(probe.streams[0].side_data_list[0].displaymatrix, matrix);
  assert.deepEqual(probe.mediaEvidence.streams[0].geometry.rotationDegrees, rational('90', '1'));
  assert.deepEqual(probe.mediaEvidence.streams[0].geometry.displayMatrix.value, ['0', '-65536', '0', '65536', '0', '0', '0', '0', '1073741824']);
  assert.equal(first(source({ side_data_list: [{ side_data_type: 'Display Matrix', displaymatrix: 'not a matrix', rotation: 'bad' }] })).geometry.displayMatrix.state, 'malformed');
  assert.equal(first(source({ tags: { rotate: '-90' } })).geometry.legacyRotationDegrees.value.numerator, '-90');
});

test('Dolby Vision compatibility flags and ambient metadata survive normalization and repeated reconstruction', () => {
  const sideData = [{ side_data_type: 'DOVI configuration record', dv_version_major: 1, dv_version_minor: 0, dv_profile: 8, dv_level: 10, rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 4, dv_md_compression: 'none' }, { side_data_type: 'Ambient viewing environment', ambient_illuminance: '3140000/10000', ambient_light_x: '15635/50000', ambient_light_y: '16450/50000' }];
  const probe = normalizeProbe(source({ codec_name: 'hevc', profile: 'Main 10', pix_fmt: 'yuv420p10le', color_transfer: 'arib-std-b67', color_primaries: 'bt2020', color_space: 'bt2020nc', side_data_list: sideData }));
  assert.deepEqual(probe.streams[0].side_data_list, sideData);
  const hdr = probe.mediaEvidence.streams[0].hdr;
  assert.equal(hdr.coverage, 'stream-metadata-only');
  assert.equal(hdr.entries[0].fields.dv_profile.value, '8');
  assert.equal(hdr.entries[0].fields.dv_bl_signal_compatibility_id.value, '4');
  assert.equal(hdr.entries[0].fields.rpu_present_flag.value, '1');
  assert.deepEqual(hdr.entries[1].fields.ambient_illuminance, rational('314', '1'));
  assert.deepEqual(normalizeProbe(probe), probe);
  assert.equal(classifyColor(probe).classification, 'hdr');
});

test('PQ mastering and content-light numeric fields survive; malformed values are never silently defaults', () => {
  const probe = source({ color_transfer: 'smpte2084', side_data_list: [
    { side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '50/10000', max_luminance: '10000000/10000' },
    { side_data_type: 'Content light level metadata', max_content: 1000, max_average: 'N/A' },
  ] });
  const entries = first(probe).hdr.entries;
  assert.deepEqual(entries[0].fields.max_luminance, rational('1000', '1'));
  assert.deepEqual(entries[0].fields.min_luminance, rational('1', '200'));
  assert.equal(entries[1].fields.max_content.value, '1000');
  assert.equal(entries[1].fields.max_average.state, 'unknown');
  probe.streams[0].side_data_list[0].max_luminance = '1000/0';
  probe.streams[0].side_data_list[1].max_content = -1;
  assert.equal(first(probe).hdr.entries[0].fields.max_luminance.state, 'malformed');
  assert.equal(first(probe).hdr.entries[1].fields.max_content.state, 'malformed');
});

test('future dynamic side-data remains bounded evidence, not an implied implemented interpretation', () => {
  const dynamic = { side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)', windows: [{ application_version: 1, knee_point_x: '1/4', anchors: [1, 2, 3] }] };
  const probe = normalizeProbe(source({ side_data_list: [dynamic] }));
  assert.deepEqual(probe.streams[0].side_data_list[0], dynamic);
  assert.equal(probe.mediaEvidence.streams[0].hdr.entries[0].interpretation, 'unqualified-side-data');
  dynamic.windows[0].anchors[0] = 999;
  assert.equal(probe.streams[0].side_data_list[0].windows[0].anchors[0], 1);
});

test('contradictory static HDR values remain visible and zero light level stays unknown', () => {
  const entries = first(source({ side_data_list: [
    { side_data_type: 'Mastering display metadata', red_x: '2/1', min_luminance: '20/1', max_luminance: '10/1' },
    { side_data_type: 'Content light level metadata', max_content: 100, max_average: 200 },
    { side_data_type: 'Content light level metadata', max_content: 0, max_average: 0 },
  ] })).hdr.entries;
  assert.equal(entries[0].fields.red_x.state, 'malformed');
  assert.deepEqual(entries[0].issues, ['mastering-minimum-exceeds-maximum']);
  assert.deepEqual(entries[1].issues, ['average-light-exceeds-content-maximum']);
  assert.equal(entries[2].fields.max_content.state, 'unknown');
});

test('audio evidence distinguishes stream bitrate from container bitrate and retains channels and delay fields', () => {
  const probe = source();
  probe.streams.push({ index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', codec_tag_string: 'mp4a', codec_tag: '0x6134706d', sample_fmt: 'fltp', sample_rate: '44100', channels: 6, channel_layout: '5.1', bit_rate: '382103', bits_per_sample: 0, initial_padding: 1024, trailing_padding: 512, time_base: '1/44100' });
  probe.format.bit_rate = '5392103';
  const result = normalizeProbe(probe).mediaEvidence;
  assert.equal(result.streams[1].codec.bitrate.value, '382103');
  assert.equal(result.container.bitrate.value, '5392103');
  assert.equal(result.streams[1].audio.sampleRate.value, '44100');
  assert.equal(result.streams[1].audio.channels.value, '6');
  assert.equal(result.streams[1].audio.channelLayout.value, '5.1');
  assert.equal(result.streams[1].audio.initialPadding.value, '1024');
  assert.equal(result.streams[1].audio.trailingPadding.value, '512');
});

test('MOV timed-track relationship is retained as a link, never flattened into a string or duplicate stream', () => {
  const probe = source();
  probe.streams.push({ index: 2, id: '0x3', codec_type: 'data', codec_tag_string: 'tmcd', time_base: '1/15360', tags: { timecode: '01:00:00:00' } });
  probe.stream_groups = [{ index: 0, id: '0x3', type: 'Track Reference', nb_streams: 2, components: [], streams: [{ ...probe.streams[0], private_unrecognized: 'not copied' }, probe.streams[1]] }];
  const normalized = normalizeProbe(probe);
  assert.deepEqual(normalized.stream_groups[0].streams, [
    { index: 0, codec_type: 'video', codec_name: 'h264' },
    { index: 2, id: '0x3', codec_type: 'data' },
  ]);
  assert.equal(normalized.streams[1].codec_tag_string, 'tmcd');
  assert.equal(normalized.mediaEvidence.container.streamGroups.state, 'known');
  assert.deepEqual(normalized.mediaEvidence.container.streamGroups.value[0].streamIndexes, [0, 2]);
  assert.deepEqual(normalizeProbe(normalized), normalized);
});

test('TS programs keep PID/service metadata, nonzero timelines and explicit membership', () => {
  const probe = source({ id: '0x100', time_base: '1/90000', start_pts: 126000, start_time: '1.400000' });
  probe.programs = [{ program_id: 100, program_num: 100, nb_streams: 1, pmt_pid: 4096, pcr_pid: 256, tags: { service_name: 'Fixture service', service_provider: 'Fixture' }, streams: [probe.streams[0]] }];
  probe.format.format_name = 'mpegts';
  const normalized = normalizeProbe(probe);
  assert.equal(normalized.programs[0].pmt_pid, 4096);
  assert.equal(normalized.programs[0].tags.service_name, 'Fixture service');
  assert.deepEqual(normalized.mediaEvidence.streams[0].timeline.startSeconds, rational('7', '5'));
  assert.equal(normalized.mediaEvidence.container.programs.state, 'known');
  assert.equal(normalized.mediaEvidence.container.streamGroups.state, 'unknown');
});

test('broken, repeated and unresolved relationships cannot be labelled known', () => {
  for (const group of [
    { index: 0, streams: [{ index: 999 }] },
    { index: 0, streams: [{ index: 0 }, { index: 0 }] },
    { index: 0, nb_streams: 2, streams: [{ index: 0 }] },
    { streams: [{ index: 0 }] },
    { index: 0 },
  ]) {
    const probe = source(); probe.stream_groups = [group];
    assert.equal(normalizeProbe(probe).mediaEvidence.container.streamGroups.state, 'malformed');
  }
  const probe = source(); probe.stream_groups = [{ index: 0, streams: [{ index: 0 }] }, { index: 0, streams: [{ index: 0 }] }];
  assert.equal(normalizeProbe(probe).mediaEvidence.container.streamGroups.state, 'malformed');
  probe.stream_groups = [];
  assert.equal(normalizeProbe(probe).mediaEvidence.container.streamGroups.state, 'known');
  assert.deepEqual(normalizeProbe(probe).mediaEvidence.container.streamGroups.value, []);
});

test('unknown HDR flags and unsafe integer representations never imply compatible Dolby Vision', () => {
  const result = first(source({ side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: '8evil', rpu_present_flag: 3, el_present_flag: 'N/A' }] })).hdr.entries[0];
  assert.equal(result.fields.dv_profile.state, 'malformed');
  assert.equal(result.fields.rpu_present_flag.state, 'malformed');
  assert.equal(result.fields.el_present_flag.state, 'unknown');
  assert.equal(result.fields.dv_bl_signal_compatibility_id.state, 'unknown');
});

test('bounded metadata command obtains groups/programs with fixed protocols and no frame scan', async () => {
  let count = 0;
  const result = await inspectMetadata('F:\\fixtures\\video.ts', { ffprobe: 'D:\\app\\ffprobe.exe', run: async (executable, argv, options) => {
    count++;
    assert.equal(executable, 'D:\\app\\ffprobe.exe');
    assert.ok(argv.includes('-show_programs')); assert.ok(argv.includes('-show_stream_groups'));
    assert.ok(!argv.includes('-show_frames'));
    assert.equal(argv[argv.indexOf('-protocol_whitelist') + 1], 'file,pipe');
    assert.equal(argv[argv.indexOf('-format_whitelist') + 1], 'mov,matroska,webm,avi,mpegts');
    assert.equal(options.timeoutMs, 30000); assert.equal(options.stdoutLimit, 16 * 1024 * 1024);
    return { stdout: JSON.stringify(source()), stderr: '' };
  } });
  assert.equal(count, 1); assert.equal(result.mediaEvidence.version, 2);
});

test('normalization ignores forged derived claims and old policy cannot share the new cache identity', () => {
  const probe = source();
  probe.mediaEvidence = { version: 1, streams: [{ geometry: { sampleAspectRatio: rational('1', '1') }, hdr: { supported: true } }] };
  const normalized = normalizeProbe(probe);
  assert.equal(normalized.mediaEvidence.streams[0].geometry.sampleAspectRatio.state, 'unknown');
  assert.equal(normalized.mediaEvidence.streams[0].hdr.supported, undefined);
  assert.equal(INSPECTION_POLICY.normalization, 4);
});

test('source and output objects never share side-data mutation or relationship references', () => {
  const probe = source({ side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }] });
  const normalized = normalizeProbe(probe);
  normalized.streams[0].side_data_list[0].dv_profile = 5;
  assert.equal(probe.streams[0].side_data_list[0].dv_profile, 8);
});

test('hostile structure, cycles and excessive collection limits fail closed before downstream use', () => {
  assert.throws(() => normalizeSideData(JSON.parse('[{"side_data_type":"DOVI configuration record","__proto__":{"polluted":true}}]')), { code: 'INVALID_PROBE' });
  assert.equal({}.polluted, undefined);
  const cycle = { side_data_type: 'unknown' }; cycle.cycle = cycle;
  assert.throws(() => normalizeSideData([cycle]), { code: 'INVALID_PROBE' });
  assert.throws(() => normalizeSideData(Array.from({ length: EVIDENCE_LIMITS.sideData + 1 }, () => ({}))), { code: 'INVALID_PROBE' });
  assert.throws(() => normalizeSideData([{ side_data_type: 'unknown', text: 'x'.repeat(EVIDENCE_LIMITS.string + 1) }]), { code: 'INVALID_PROBE' });
  const probe = source(); probe.programs = Array(EVIDENCE_LIMITS.relationships + 1).fill({});
  assert.throws(() => normalizeProbe(probe), { code: 'INVALID_PROBE' });
});

test('SDR recipe arguments remain identical when additive evidence is present', () => {
  const raw = source({ profile: 'High', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/15360', start_pts: 0, bit_rate: '30000000' });
  const normalized = normalizeProbe(raw);
  const common = { input: 'F:\\fixtures\\source.mp4', output: 'F:\\owned\\stage.mkv', settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 } };
  assert.deepEqual(buildEncodeArgs({ ...common, probe: normalized, color: classifyColor(normalized) }), buildEncodeArgs({ ...common, probe: raw, color: classifyColor(raw) }));
});

test('decoded-frame detailed side data survives sampling and cached reconstruction', async () => {
  const probe = source();
  const sideData = [{ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 200 }];
  const result = await finishInspection('F:\\fixtures\\source.mp4', probe, { ffprobe: 'D:\\app\\ffprobe.exe', run: async (_, argv) => ({ stdout: JSON.stringify({ frames: [{ media_type: 'video', stream_index: 0, best_effort_timestamp_time: argv[argv.indexOf('-read_intervals') + 1].split('%')[0], color_transfer: 'bt709', side_data_list: sideData }] }), stderr: '' }) });
  assert.deepEqual(result.evidence.windows[0].frames[0].side_data_list, sideData);
  assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
});

function groupedSource() {
  const probe = source({ id: '0x1' });
  probe.streams.push({ index: 2, id: '0x3', codec_type: 'data', codec_tag_string: 'tmcd' });
  probe.programs = [];
  probe.stream_groups = [{ index: 0, id: '0x3', type: 'Track Reference', nb_streams: 2, streams: structuredClone(probe.streams) }];
  Object.assign(probe.format, { nb_streams: 2, nb_programs: 0, nb_stream_groups: 1 });
  return probe;
}

test('container graph confidence rejects contradictory counts including an empty collection', () => {
  assert.equal(normalizeProbe(groupedSource()).mediaEvidence.container.relationships.state, 'known');
  for (const mutate of [
    probe => { probe.format.nb_streams = 9; },
    probe => { probe.format.nb_programs = 1; },
    probe => { probe.format.nb_stream_groups = 0; },
    probe => { probe.format.nb_stream_groups = 'not an integer'; },
    probe => { delete probe.stream_groups; probe.format.nb_stream_groups = -1; },
  ]) {
    const probe = groupedSource(); mutate(probe);
    const result = normalizeProbe(probe);
    assert.equal(result.mediaEvidence.container.relationships.state, 'malformed');
    assert.deepEqual(normalizeProbe(result), result);
  }
  const omitted = groupedSource(); delete omitted.stream_groups;
  assert.equal(normalizeProbe(omitted).mediaEvidence.container.relationships.state, 'unknown');
  assert.equal(normalizeProbe(omitted).mediaEvidence.container.streamGroups.reportedCount.value, '1');
});

test('group type and nested stream identity contradictions survive normalization and reconstruction', () => {
  for (const [mutate, issue] of [
    [probe => { probe.stream_groups[0].type = { misleading: 'Track Reference' }; }, 'invalid-relationship-type'],
    [probe => { probe.stream_groups[0].streams[0].codec_type = 'audio'; }, 'contradictory-member-codec_type'],
    [probe => { probe.stream_groups[0].streams[0].codec_name = 'av1'; }, 'contradictory-member-codec_name'],
    [probe => { probe.stream_groups[0].streams[0].id = '0x9'; }, 'contradictory-member-id'],
    [probe => { probe.stream_groups[0].id = 'bogus'; }, 'invalid-container-group-id'],
  ]) {
    const probe = groupedSource(); mutate(probe);
    const normalized = normalizeProbe(probe), group = normalized.mediaEvidence.container.streamGroups;
    assert.equal(group.state, 'malformed'); assert.ok(group.value[0].issues.includes(issue));
    assert.deepEqual(normalizeProbe(normalized), normalized);
  }
  for (const field of ['type', 'nb_streams']) {
    const probe = groupedSource(); delete probe.stream_groups[0][field];
    assert.equal(normalizeProbe(probe).mediaEvidence.container.streamGroups.state, 'unknown');
  }
  const sameId = groupedSource(); sameId.stream_groups[0].streams[0].id = '1';
  assert.equal(normalizeProbe(sameId).mediaEvidence.container.streamGroups.state, 'known');
});

function transportSource() {
  const probe = source({ id: '0x100' });
  probe.format = { format_name: 'mpegts', nb_streams: 1, nb_programs: 1, nb_stream_groups: 0 };
  probe.programs = [{ program_id: 1, program_num: 1, nb_streams: 1, pmt_pid: 4096, pcr_pid: 256, streams: structuredClone(probe.streams) }];
  probe.stream_groups = [];
  return probe;
}

test('transport PID ranges, conflicting assertions and duplicate canonical PIDs cannot appear complete', () => {
  for (const [mutate, issue] of [
    [probe => { probe.programs[0].pmt_pid = 9000; }, 'invalid-pmtPid'],
    [probe => { probe.programs[0].pcr_pid = 'bad'; }, 'invalid-pcrPid'],
    [probe => { probe.programs[0].pmt_pid = 256; }, 'pmt-pid-conflicts-with-stream'],
    [probe => { probe.programs[0].pcr_pid = 4096; }, 'pmt-pid-conflicts-with-pcr'],
    [probe => { probe.programs[0].streams[0].id = '0x101'; }, 'contradictory-member-id'],
    [probe => { probe.streams[0].id = '0x1fff'; probe.programs[0].streams[0].id = '0x1fff'; }, 'invalid-stream-pid'],
  ]) {
    const probe = transportSource(); mutate(probe);
    const programs = normalizeProbe(probe).mediaEvidence.container.programs;
    assert.equal(programs.state, 'malformed'); assert.ok(programs.value[0].issues.includes(issue));
  }
  const duplicate = transportSource();
  duplicate.streams.push({ index: 1, codec_type: 'audio', id: '0x100' });
  duplicate.programs[0].streams.push({ index: 1 }); duplicate.programs[0].nb_streams = 2; duplicate.format.nb_streams = 2;
  const programs = normalizeProbe(duplicate).mediaEvidence.container.programs;
  assert.equal(programs.state, 'malformed');
  assert.ok(programs.issues.includes('duplicate-canonical-stream-pid'));
  assert.ok(programs.value[0].issues.includes('duplicate-stream-pid'));
});

test('transport evidence permits a separate PCR PID and null sentinel, but missing PID remains unknown', () => {
  for (const pcrPid of [256, 300, 8191]) {
    const probe = transportSource(); probe.programs[0].pcr_pid = pcrPid;
    const result = normalizeProbe(probe).mediaEvidence.container;
    assert.equal(result.programs.state, 'known'); assert.equal(result.relationships.state, 'known');
    assert.equal(result.programs.value[0].fields.pcrPid.value, String(pcrPid));
  }
  const probe = transportSource(); delete probe.programs[0].pmt_pid;
  assert.equal(normalizeProbe(probe).mediaEvidence.container.programs.state, 'unknown');
  delete probe.streams[0].id;
  assert.equal(normalizeProbe(probe).mediaEvidence.container.programs.state, 'unknown');
});

test('conflicting DAR and invalid ambient chromaticity remain explicit evidence problems', () => {
  const stream = first(source({ sample_aspect_ratio: '1:1', display_aspect_ratio: '4:3', side_data_list: [
    { side_data_type: 'Ambient viewing environment', ambient_illuminance: '1000/1', ambient_light_x: '2/1', ambient_light_y: '1/2' },
  ] }));
  assert.deepEqual(stream.geometry.issues, ['display-aspect-ratio-mismatch']);
  assert.equal(stream.hdr.entries[0].fields.ambient_light_x.state, 'malformed');
  assert.equal(stream.hdr.entries[0].fields.ambient_light_y.state, 'known');
  const coherent = first(source({ width: 852, height: 480, sample_aspect_ratio: '640:639', display_aspect_ratio: '16:9' }));
  assert.equal(coherent.geometry.issues, undefined);
});
