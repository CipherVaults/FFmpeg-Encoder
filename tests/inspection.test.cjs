'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectInput, inspectMetadata, finishInspection, reconstructInspection, cacheableInspection, validateOutput } = require('../src/inspection.cjs');
const { classifyColor } = require('../src/media.cjs');
const { ToolError } = require('../src/process-runner.cjs');

const file = 'D:\\selected media\\input.mkv';
const ffprobe = 'D:\\encoder\\ffmpeg\\ffprobe.exe';
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const copy = (value) => structuredClone(value);

function sourceProbe({ seconds = 2, bits = 8 } = {}) {
  return {
    streams: [{
      index: 4, codec_type: 'video', codec_name: 'h264', width: 320, height: 180,
      pix_fmt: bits === 8 ? 'yuv420p' : 'yuv420p10le',
      color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
      avg_frame_rate: '30/1', r_frame_rate: '30/1', disposition: { default: 1 }, tags: { title: 'Main video', ENCODER: 'old encoder' },
    }],
    format: { duration: String(seconds), tags: { title: 'Preserve this title', artist: 'Fixture author', ENCODER: 'Old muxer' } },
    chapters: [],
  };
}

function sample(index = 4, transfer = 'bt709', time = 0) {
  return { frames: [{ media_type: 'video', stream_index: index, best_effort_timestamp_time: String(time), color_transfer: transfer }] };
}

function mockRun(responses) {
  const calls = [];
  const run = async (executable, args, options) => {
    calls.push({ executable, args, options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { stdout: typeof response === 'string' ? response : JSON.stringify(response), stderr: '', exitCode: 0 };
  };
  return { run, calls };
}

function inspection(probe = sourceProbe()) {
  return { probe, color: classifyColor(probe, [sample()]), duration: Number(probe.format.duration), summary: {} };
}

function outputProbe(input = sourceProbe()) {
  const output = copy(input);
  output.streams.forEach((stream, index) => { stream.index = index; });
  output.streams[0].codec_name = 'hevc';
  output.streams[0].tags.ENCODER = 'new encoder';
  output.format.tags.ENCODER = 'New muxer';
  return output;
}

test('inspection bounds metadata and frames and selects the default non-attached video by absolute index', async () => {
  const input = sourceProbe();
  input.streams.unshift({ index: 0, codec_type: 'video', disposition: { attached_pic: 1 } });
  const mock = mockRun([input, sample()]);
  const result = await inspectInput(file, { ffprobe, run: mock.run });
  assert.equal(result.color.classification, 'sdr');
  assert.equal(result.summary.selectedVideoIndex, 4);
  assert.equal(result.duration, 2);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].options.timeoutMs, 30_000);
  assert.equal(mock.calls[0].options.stdoutLimit, 16 * 1024 * 1024);
  assert.equal(mock.calls[1].options.timeoutMs, 20_000);
  assert.equal(mock.calls[1].options.stdoutLimit, 8 * 1024 * 1024);
  assert.equal(mock.calls[1].args[mock.calls[1].args.indexOf('-select_streams') + 1], '4');
  assert.equal(mock.calls[1].args[mock.calls[1].args.indexOf('-read_intervals') + 1], '0.000000%2.000000');
  for (const call of mock.calls) {
    assert.equal(call.executable, ffprobe);
    assert.equal(call.args[call.args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
    assert.equal(call.args.at(-1), file);
  }
  assert.ok(mock.calls[0].args.includes('-show_chapters'));
  assert.ok(mock.calls[0].args.includes('-show_data_hash'));
});

test('long input receives middle and end windows and decoded-frame HDR overrides SDR stream tags', async () => {
  const mock = mockRun([sourceProbe({ seconds: 20 }), sample(), sample(4, 'smpte2084', 10), sample(4, 'bt709', 18)]);
  const result = await inspectInput(file, { ffprobe, run: mock.run });
  assert.equal(result.color.classification, 'hdr');
  assert.deepEqual(result.summary.sampling.map(({ interval }) => interval), ['0.000000%2.000000', '10.000000%11.000000', '18.000000%20.000000']);
  assert.equal(mock.calls.length, 4);
});

test('nonzero media timestamps shift sample windows and earlier keyframe frames cannot impersonate midpoint coverage', async () => {
  const offset = sourceProbe();
  offset.streams[0].start_time = '4';
  const first = await inspectInput(file, { ffprobe, run: mockRun([offset, sample(4, 'bt709', 4)]).run });
  assert.equal(first.summary.sampling[0].interval, '4.000000%6.000000');
  const missed = await inspectInput(file, { ffprobe, run: mockRun([sourceProbe({ seconds: 20 }), sample(), sample(), sample()]).run });
  assert.equal(missed.color.classification, 'ambiguous');
  assert.equal(missed.summary.sampling[1].code, 'FRAME_SAMPLE_COVERAGE');
  const reached = await inspectInput(file, { ffprobe, run: mockRun([
    sourceProbe({ seconds: 20 }), sample(),
    { frames: [...sample().frames, ...sample(4, 'bt709', 10).frames] }, sample(4, 'bt709', 18),
  ]).run });
  assert.equal(reached.color.classification, 'sdr');
  assert.equal(reached.summary.sampling[1].framesInWindow, 1);
});

test('ffprobe error diagnostics remain failures even if its process exits zero', async () => {
  const run = async (_, args) => ({ stdout: JSON.stringify(args.includes('-show_frames') ? sample() : sourceProbe()), stderr: args.includes('-show_frames') ? 'Error while decoding frame' : '', exitCode: 0 });
  const result = await inspectInput(file, { ffprobe, run });
  assert.equal(result.color.classification, 'ambiguous');
  assert.equal(result.summary.sampling[0].code, 'FRAME_DECODE_ERROR');
  await assert.rejects(inspectInput(file, { ffprobe, run: async () => ({ stdout: JSON.stringify(sourceProbe()), stderr: 'Invalid input data', exitCode: 0 }) }), { code: 'INVALID_PROBE' });
});

test('missing duration still requires a beginning sample and stays indeterminate', async () => {
  const input = sourceProbe();
  input.format.duration = 'N/A';
  const mock = mockRun([input, sample()]);
  const result = await inspectInput(file, { ffprobe, run: mock.run });
  assert.equal(result.duration, null);
  assert.equal(result.color.classification, 'sdr');
  assert.equal(mock.calls.length, 2);
});

for (const [label, response] of [
  ['empty decoded frames', { frames: [] }],
  ['frames from a different stream', sample(0)],
  ['malformed frame JSON', '{broken'],
  ['timed out decoded inspection', new ToolError('TIMEOUT', 'Frame timeout')],
]) {
  test(`${label} cannot silently become SDR`, async () => {
    const mock = mockRun([sourceProbe(), response]);
    const result = await inspectInput(file, { ffprobe, run: mock.run });
    assert.equal(result.color.classification, 'ambiguous');
    assert.equal(result.color.supported, false);
    assert.equal(result.summary.sampling[0].succeeded, false);
  });
}

test('definite stream HDR stops after metadata and remains cacheable as unsupported', async () => {
  const input = sourceProbe();
  input.streams[0].color_transfer = 'arib-std-b67';
  const mock = mockRun([input, new ToolError('TIMEOUT', 'Frame timeout')]);
  const result = await inspectInput(file, { ffprobe, run: mock.run });
  assert.equal(result.color.classification, 'hdr');
  assert.equal(mock.calls.length, 1);
  assert.equal(result.evidence.mode, 'metadata-hdr');
  assert.equal(cacheableInspection(result), true);
});

test('metadata and frame stages compose without probing metadata twice, with normalized preservation evidence', async () => {
  const probe = richSource();
  probe.format.filename = 'D:\\private\\input.mkv';
  probe.programs = [{ unused: true }];
  probe.streams[0].unused_decoder_field = 'unused';
  const stages = [];
  const mock = mockRun([probe, sample()]);
  const options = { ffprobe, run: mock.run, onStage: stage => stages.push(stage) };
  const metadata = await inspectMetadata(file, options);
  assert.equal(mock.calls.length, 1);
  assert.equal(metadata.format.filename, undefined);
  assert.deepEqual(metadata.programs, [{}]);
  assert.equal(metadata.mediaEvidence.container.programs.state, 'malformed');
  assert.equal(metadata.streams[0].unused_decoder_field, undefined);
  assert.deepEqual(metadata.chapters, probe.chapters);
  assert.deepEqual(metadata.streams[4], probe.streams[4]);
  const result = await finishInspection(file, metadata, options);
  assert.deepEqual(stages, [{ stage: 'metadata' }, { stage: 'frames', window: 'start' }]);
  assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
  assert.equal(mock.calls.length, 2);
});

test('reconstructed long-window decisions include preroll HDR and reject missing or fabricated coverage', async () => {
  const probe = sourceProbe({ seconds: 20 });
  const result = await inspectInput(file, { ffprobe, run: mockRun([
    probe, sample(), { frames: [...sample(4, 'smpte2084', 0).frames, ...sample(4, 'bt709', 10).frames] }, sample(4, 'bt709', 18),
  ]).run });
  assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
  assert.equal(result.color.classification, 'hdr');
  assert.equal(cacheableInspection(result), true);
  const missing = copy(result);
  missing.evidence.windows.pop();
  assert.throws(() => reconstructInspection(missing.probe, missing.evidence), /missing/);
  const falseCoverage = copy(result);
  falseCoverage.evidence.windows[1].frames = sample().frames;
  assert.equal(cacheableInspection(falseCoverage), false);
});

test('failed frame sampling retains observed HDR but is never cacheable', async () => {
  const run = async (_, args) => ({ stdout: JSON.stringify(args.includes('-show_frames') ? sample(4, 'smpte2084') : sourceProbe()), stderr: args.includes('-show_frames') ? 'decoder error' : '' });
  const result = await inspectInput(file, { ffprobe, run });
  assert.equal(result.color.classification, 'hdr');
  assert.equal(result.summary.sampling[0].succeeded, false);
  assert.equal(cacheableInspection(result), false);
  assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
});

test('ten-bit BT.2020 primaries with coherent SDR transfer remain SDR', async () => {
  const input = sourceProbe({ bits: 10 });
  input.streams[0].color_primaries = 'bt2020';
  const mock = mockRun([input, sample()]);
  const result = await inspectInput(file, { ffprobe, run: mock.run });
  assert.equal(result.summary.bitDepth, 10);
  assert.equal(result.color.classification, 'sdr');
});

test('invalid metadata rejects, and cancellation stops before later frame windows', async () => {
  await assert.rejects(inspectInput(file, { ffprobe, run: mockRun(['null']).run }), { code: 'INVALID_PROBE' });
  const mock = mockRun([sourceProbe({ seconds: 20 }), new ToolError('CANCELLED', 'Cancelled')]);
  await assert.rejects(inspectInput(file, { ffprobe, run: mock.run }), { code: 'CANCELLED' });
  assert.equal(mock.calls.length, 2);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(inspectInput(file, { ffprobe, signal: abort.signal, run: () => assert.fail('must not spawn') }), { code: 'CANCELLED' });
});

test('valid output tolerates generated encoder tags but preserves actual video and user metadata', () => {
  assert.deepEqual(validateOutput(inspection(), outputProbe(), settings), { valid: true, errors: [] });
});

test('re-encoding replaces only exact application container tags, never other user/track/chapter tags', () => {
  const input = sourceProbe();
  Object.assign(input.format.tags, { FFMPEG_ENCODER_PROVENANCE: '1', FFMPEG_ENCODER_OUTPUT_ID: 'previous-id', FFMPEG_ENCODER_GENERATION: 'previous-description', FFMPEG_ENCODER_NOTES: 'user notes' });
  const output = outputProbe(input);
  output.format.tags.FFMPEG_ENCODER_OUTPUT_ID = 'new-id';
  output.format.tags.FFMPEG_ENCODER_GENERATION = 'new-description';
  assert.equal(validateOutput(inspection(input), output, settings).valid, true);
  const changedNotes = copy(output); changedNotes.format.tags.FFMPEG_ENCODER_NOTES = 'different';
  assert.match(validateOutput(inspection(input), changedNotes, settings).errors.join('\n'), /ffmpeg_encoder_notes/);
  input.streams[0].tags.FFMPEG_ENCODER_GENERATION = 'track-owned-description';
  assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /Stream.*ffmpeg_encoder_generation/);
  output.streams[0].tags.FFMPEG_ENCODER_GENERATION = 'track-owned-description';
  input.chapters = [{ start_time: '0', end_time: '1', tags: { FFMPEG_ENCODER_OUTPUT_ID: 'chapter-owned-id' } }];
  output.chapters = [{ start_time: '0', end_time: '1', tags: { FFMPEG_ENCODER_OUTPUT_ID: 'different' } }];
  assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /Chapter.*ffmpeg_encoder_output_id/);
});

test('Matroska omitted track language equals und only, never a named language or container tag', () => {
  const input = sourceProbe();
  input.streams[0].tags.language = 'und';
  const output = outputProbe(input);
  output.format.format_name = 'matroska,webm';
  delete output.streams[0].tags.language;
  assert.equal(validateOutput(inspection(input), output, settings).valid, true);
  for (const language of ['eng', 'ara']) {
    input.streams[0].tags.language = language;
    assert.equal(validateOutput(inspection(input), output, settings).valid, false);
  }
  input.streams[0].tags.language = 'und';
  input.format.tags.language = 'und';
  assert.equal(validateOutput(inspection(input), output, settings).valid, false);
  delete input.format.tags.language;
  output.format.format_name = 'mov,mp4';
  assert.equal(validateOutput(inspection(input), output, settings).valid, false);
});

function phoneTimestampProbes() {
  const input = richSource();
  input.streams[0].tags.creation_time = '2026-05-01T22:45:38.000000Z';
  input.streams[1].tags.creation_time = '2026-05-01T22:45:39.000000Z';
  input.streams[3].tags.creation_time = '2026-05-01T22:45:40.000000Z';
  input.format.tags.creation_time = '2026-05-01T22:45:37.000000Z';
  const output = outputProbe(input); output.format.format_name = 'matroska,webm';
  for (const stream of output.streams) if (stream.tags?.creation_time) {
    stream.tags.SOURCE_CREATION_TIME = stream.tags.creation_time; delete stream.tags.creation_time;
  }
  return { input, output };
}

test('Matroska track creation timestamps accept only their own exact explicit representation', () => {
  const { input, output } = phoneTimestampProbes();
  assert.deepEqual(validateOutput(inspection(input), output, settings), { valid: true, errors: [] });
  // Input array ordering is independent of stream indexes and output map order.
  input.streams = [input.streams[1], input.streams[0], ...input.streams.slice(2)];
  assert.equal(validateOutput(inspection(input), output, settings).valid, true);
  for (const mutate of [
    out => { delete out.streams[0].tags.SOURCE_CREATION_TIME; },
    out => { out.streams[0].tags.SOURCE_CREATION_TIME = out.streams[1].tags.SOURCE_CREATION_TIME; },
    out => { out.streams[0].tags.SOURCE_CREATION_TIME = '2026-05-01T22:45:38Z'; },
    out => { out.streams[0].tags.source_creation_time = 'conflicting duplicate'; },
    out => { out.streams[0].tags.creation_time = '2026-05-01T22:45:41.000000Z'; },
    out => { out.format.format_name = 'mov,mp4'; },
  ]) {
    const changed = copy(output); mutate(changed);
    assert.match(validateOutput(inspection(input), changed, settings).errors.join('\n'), /Stream 4.*creation_time/);
  }
});

test('alias representation never excuses missing container, chapter, attachment or ordinary metadata', () => {
  for (const scope of ['container', 'chapter', 'attachment']) {
    const { input, output } = phoneTimestampProbes();
    const before = scope === 'container' ? input.format : scope === 'chapter' ? input.chapters[0] : input.streams[4];
    const after = scope === 'container' ? output.format : scope === 'chapter' ? output.chapters[0] : output.streams[4];
    before.tags.creation_time = 'exact date'; after.tags.SOURCE_CREATION_TIME = 'exact date'; delete after.tags.creation_time;
    assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /metadata 'creation_time'/);
  }
  const { input, output } = phoneTimestampProbes();
  delete output.streams[0].tags.title;
  assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /metadata 'title'/);
  input.streams[1].tags.source_creation_time = 'unrelated user value';
  assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /conflicts/);
});

test('aliased Matroska re-encode retains exact alias as ordinary metadata without inventing creation_time', () => {
  const { output: input } = phoneTimestampProbes();
  const output = outputProbe(input);
  assert.equal(validateOutput(inspection(input), output, settings).valid, true);
  delete output.streams[0].tags.SOURCE_CREATION_TIME;
  assert.match(validateOutput(inspection(input), output, settings).errors.join('\n'), /metadata 'source_creation_time'/);
});

test('fresh and cached inspection explain only planned timestamp aliases and refuse collisions', async () => {
  const input = sourceProbe(); input.streams[0].tags.creation_time = 'exact original timestamp';
  const result = await inspectInput(file, { ffprobe, run: mockRun([input, sample()]).run });
  assert.deepEqual(result.summary.metadataNotices, ['Stream 4: creation_time is preserved as SOURCE_CREATION_TIME on the same mapped Matroska track.']);
  assert.deepEqual(reconstructInspection(result.probe, result.evidence).summary.metadataNotices, result.summary.metadataNotices);
  input.streams[0].tags.SOURCE_CREATION_TIME = 'different';
  await assert.rejects(inspectInput(file, { ffprobe, run: mockRun([input, sample()]).run }), { code: 'UNSUPPORTED_METADATA' });
  delete input.streams[0].tags.creation_time;
  const reencode = await inspectInput(file, { ffprobe, run: mockRun([input, sample()]).run });
  assert.deepEqual(reencode.summary.metadataNotices, []);
});

for (const [label, mutate, expected] of [
  ['wrong codec', (out) => { out.streams[0].codec_name = 'vp9'; }, /codec differs/],
  ['resolution reduction', (out) => { out.streams[0].width = 160; }, /resolution/],
  ['wrong bit depth', (out) => { out.streams[0].pix_fmt = 'yuv420p10le'; }, /bit depth/],
  ['lost transfer', (out) => { delete out.streams[0].color_transfer; }, /transfer/],
  ['new HDR transfer', (out) => { out.streams[0].color_transfer = 'smpte2084'; }, /color metadata/],
  ['changed limited range', (out) => { out.streams[0].color_range = 'pc'; }, /color_range/],
  ['changed cadence', (out) => { out.streams[0].avg_frame_rate = '15/1'; }, /cadence/],
  ['truncated duration', (out) => { out.format.duration = '1'; }, /duration/],
  ['lost global title', (out) => { delete out.format.tags.title; }, /Container: metadata 'title'/],
  ['lost disposition', (out) => { out.streams[0].disposition.default = 0; }, /dispositions/],
]) {
  test(`validation rejects ${label}`, () => {
    const output = outputProbe();
    mutate(output);
    const result = validateOutput(inspection(), output, settings);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), expected);
  });
}

test('NVIDIA ten-bit planar/packed equivalence does not permit down-conversion', () => {
  const input = sourceProbe({ bits: 10 });
  input.streams[0].pix_fmt = 'p010le';
  const output = outputProbe(input);
  output.streams[0].pix_fmt = 'yuv420p10le';
  const chosen = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 };
  assert.equal(validateOutput(inspection(input), output, chosen).valid, true);
  output.streams[0].pix_fmt = 'yuv420p';
  assert.equal(validateOutput(inspection(input), output, chosen).valid, false);
});

function richSource() {
  const input = sourceProbe();
  input.streams.push(
    { index: 6, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, channel_layout: 'stereo', tags: { title: 'English audio', language: 'eng' }, disposition: { default: 1 } },
    { index: 7, codec_type: 'audio', codec_name: 'flac', sample_rate: '48000', channels: 1, channel_layout: 'mono', tags: { title: 'Commentary' }, disposition: { comment: 1, default: 0 } },
    { index: 8, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' }, disposition: { forced: 1 } },
    { index: 9, codec_type: 'attachment', codec_name: 'ttf', extradata_size: 80, extradata_hash: 'SHA256:fixture-hash', tags: { filename: 'caption.ttf', mimetype: 'application/x-truetype-font' }, disposition: {} },
  );
  input.chapters = [{ id: 3, time_base: '1/1000', start: 0, end: 1000, start_time: '0', end_time: '1', tags: { title: 'Chapter one' } }];
  return input;
}

test('preservation validates all tracks, attachment bytes, tags, dispositions and chapters', () => {
  const input = richSource();
  const output = outputProbe(input);
  output.streams[1].tags = { TITLE: 'English audio', LANGUAGE: 'eng' };
  output.chapters[0].time_base = '1/1000000000';
  output.chapters[0].end = 1000000000;
  assert.deepEqual(validateOutput(inspection(input), output, settings), { valid: true, errors: [] });
  const changed = outputProbe(input);
  changed.streams[1].codec_name = 'opus';
  changed.streams[1].sample_rate = '44100';
  changed.streams[2].tags.title = 'Lost commentary';
  changed.streams[3].disposition.forced = 0;
  changed.streams[4].extradata_hash = 'SHA256:changed';
  changed.chapters[0].end_time = '1.5';
  changed.chapters[0].tags.title = 'Changed chapter';
  const result = validateOutput(inspection(input), changed, settings);
  assert.equal(result.valid, false);
  for (const expected of [/copied codec/, /sample_rate/, /metadata 'title'/, /dispositions/, /attachment content hash/, /end timing/, /Chapter 0: metadata/]) assert.match(result.errors.join('\n'), expected);
});

test('missing copied streams and chapters, unexpected streams, and malformed probe never validate', () => {
  const input = richSource();
  const missing = outputProbe(input);
  missing.streams.pop();
  missing.chapters = [];
  assert.equal(validateOutput(inspection(input), missing, settings).valid, false);
  const extra = outputProbe(input);
  extra.streams.push({ index: 99, codec_type: 'audio', codec_name: 'aac' });
  assert.match(validateOutput(inspection(input), extra, settings).errors.join('\n'), /Stream count/);
  assert.equal(validateOutput(inspection(input), {}, settings).valid, false);
  assert.equal(validateOutput({}, extra, settings).valid, false);
});

test('input color ambiguity cannot be accepted by a plausible-looking SDR output', () => {
  const input = inspection();
  input.color = { classification: 'ambiguous', supported: false, transfer: 'bt709' };
  assert.match(validateOutput(input, outputProbe(), settings).errors.join('\n'), /accepted SDR/);
});

test('color evidence must belong to the selected stream and cannot override stream HDR', () => {
  const wrongStream = inspection();
  wrongStream.color.videoIndex = 0;
  assert.equal(validateOutput(wrongStream, outputProbe(), settings).valid, false);
  const contradictory = inspection();
  contradictory.probe.streams[0].color_transfer = 'smpte2084';
  assert.equal(validateOutput(contradictory, outputProbe(), settings).valid, false);
});

for (const code of ['SPAWN_FAILED', 'PIPE_FAILED', 'EACCES']) {
  test('decoded-frame infrastructure failure propagates immediately: ' + code, async () => {
    const mock = mockRun([sourceProbe({ seconds: 30 }), new ToolError(code, 'Injected infrastructure failure')]);
    await assert.rejects(inspectInput(file, { ffprobe, run: mock.run }), { code });
    assert.equal(mock.calls.length, 2, 'no later frame windows launch');
  });
}


test('raw JSON duplicate reserved provenance keys are rejected before JSON.parse can discard them', () => {
  const { parseProbeJson } = require('../src/inspection.cjs');
  for (const key of ['FFMPEG_ENCODER_PROVENANCE', 'ffmpeg_encoder_provenance']) {
    assert.throws(() => parseProbeJson('{"format":{"tags":{"FFMPEG_ENCODER_PROVENANCE":"99","' + key + '":"1"}}}', 'fixture'), { code: 'INVALID_PROBE' });
  }
  assert.deepEqual(parseProbeJson('{"streams":[],"format":{"tags":{"title":"FFMPEG_ENCODER_PROVENANCE"}}}', 'fixture').streams, []);
});


test('duplicate parent containers cannot erase reserved provenance before classification', () => {
  const { parseProbeJson } = require('../src/inspection.cjs');
  for (const text of [
    '{"format":{"tags":{"FFMPEG_ENCODER_PROVENANCE":"1"}},"format":{}}',
    '{"format":{"tags":{"FFMPEG_ENCODER_PROVENANCE":"1"},"tags":{}}}'
  ]) assert.throws(() => parseProbeJson(text, 'fixture'), { code: 'INVALID_PROBE' });
});

test('metadata failures retain the exact bounded child stderr including parse-failure whitespace', async () => {
  const stderr = '[mov] unknown data codec\r\noriginal diagnostic\n';
  await assert.rejects(inspectMetadata(file, { ffprobe, run: async () => ({ stdout: '{}', stderr }) }), error => {
    assert.equal(error.code, 'INVALID_PROBE'); assert.equal(error.stderr, stderr); return true;
  });
  await assert.rejects(inspectMetadata(file, { ffprobe, run: async () => ({ stdout: 'broken JSON', stderr: '\r\n' }) }), error => {
    assert.equal(error.code, 'INVALID_PROBE'); assert.equal(error.stderr, '\r\n'); return true;
  });
});

test('decoded-frame failures retain raw stderr through evidence reconstruction without becoming cacheable', async () => {
  const stderr = '[decoder] damaged data at offset 42\r\nnext line\n';
  for (const response of [
    { stdout: JSON.stringify(sample()), stderr },
    { stdout: 'broken JSON', stderr },
    new ToolError('TOOL_FAILED', 'Probe exited', { stderr, exitCode: 1 }),
  ]) {
    const result = await finishInspection(file, sourceProbe(), { ffprobe, run: async () => {
      if (response instanceof Error) throw response;
      return response;
    } });
    assert.equal(result.evidence.windows[0].error.stderr, stderr);
    assert.equal(result.evidence.windows[0].error.stderrTruncated, false);
    assert.equal(cacheableInspection(result), false);
    assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
  }
});

test('sampling diagnostic bounds are explicit and malformed reconstructed diagnostic fields fail closed', async () => {
  const stderr = 'x'.repeat(256 * 1024) + 'tail';
  const result = await finishInspection(file, sourceProbe(), { ffprobe, run: async () => ({ stdout: JSON.stringify(sample()), stderr }) });
  assert.equal(result.evidence.windows[0].error.stderr, stderr.slice(-256 * 1024));
  assert.equal(result.evidence.windows[0].error.stderrTruncated, true);
  for (const change of [
    error => { error.stderr = 'x'.repeat(256 * 1024 + 1); },
    error => { error.stderr = {}; },
    error => { error.stderrTruncated = 'false'; },
  ]) {
    const invalid = copy(result); change(invalid.evidence.windows[0].error);
    assert.throws(() => reconstructInspection(invalid.probe, invalid.evidence), { code: 'INVALID_PROBE' });
  }
});

test('metadata errors and post-child cancellation preserve upstream truncation rather than asserting a complete tail', async () => {
  const capture = { totalBytes: 400000, truncated: true };
  for (const response of [
    { stdout: JSON.stringify(sourceProbe()), stderr: 'tail diagnostic', stderrCapture: capture },
    { stdout: 'broken JSON', stderr: '\r\n', stderrCapture: { totalBytes: 2, truncated: false } },
    { stdout: JSON.stringify(sourceProbe()), stderr: '   ', stderrCapture: capture },
  ]) {
    await assert.rejects(inspectMetadata(file, { ffprobe, run: async () => response }), error => {
      assert.equal(error.code, 'INVALID_PROBE');
      assert.deepEqual(error.stderrCapture, response.stderrCapture);
      assert.equal(error.stderr, response.stderr);
      return true;
    });
  }
  const abort = new AbortController();
  await assert.rejects(inspectMetadata(file, { ffprobe, signal: abort.signal, run: async () => {
    abort.abort();
    return { stdout: JSON.stringify(sourceProbe()), stderr: 'cancel tail', stderrCapture: capture };
  } }), error => {
    assert.equal(error.code, 'CANCELLED');
    assert.deepEqual(error.stderrCapture, capture);
    return true;
  });
});

test('frame wrappers retain upstream capture for zero-exit errors, parse failures, tool errors and cancellation', async () => {
  const capture = { totalBytes: 600000, truncated: true };
  for (const response of [
    { stdout: JSON.stringify(sample()), stderr: 'tail diagnostic', stderrCapture: capture },
    { stdout: 'broken JSON', stderr: 'tail diagnostic', stderrCapture: capture },
    { stdout: JSON.stringify(sample()), stderr: '    ', stderrCapture: capture },
    new ToolError('TOOL_FAILED', 'Probe exited', { stderr: 'tail diagnostic', stderrCapture: capture }),
  ]) {
    const result = await finishInspection(file, sourceProbe(), { ffprobe, run: async () => {
      if (response instanceof Error) throw response;
      return response;
    } });
    const error = result.evidence.windows[0].error;
    assert.deepEqual(error.stderrCapture, capture);
    assert.equal(error.stderr, response.stderr);
    assert.equal(error.stderrTruncated, true);
    assert.equal(cacheableInspection(result), false);
    assert.deepEqual(reconstructInspection(result.probe, result.evidence), result);
  }
  for (const code of ['CANCELLED', 'PIPE_FAILED']) {
    await assert.rejects(finishInspection(file, sourceProbe(), { ffprobe, run: async () => {
      throw new ToolError(code, 'Interrupted child', { stderr: 'tail', stderrCapture: capture });
    } }), error => {
      assert.equal(error.code, code);
      assert.deepEqual(error.stderrCapture, capture);
      return true;
    });
  }
  const abort = new AbortController();
  await assert.rejects(finishInspection(file, sourceProbe(), { ffprobe, signal: abort.signal, run: async () => {
    abort.abort();
    return { stdout: JSON.stringify(sample()), stderr: 'tail', stderrCapture: capture };
  } }), error => {
    assert.equal(error.code, 'CANCELLED');
    assert.deepEqual(error.stderrCapture, capture);
    return true;
  });
});

test('frame evidence byte bounds and capture schema reject malformed or contradictory persisted diagnostics', async () => {
  const stderr = '😀'.repeat(70000);
  const result = await finishInspection(file, sourceProbe(), { ffprobe, run: async () => ({
    stdout: JSON.stringify(sample()), stderr, stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false },
  }) });
  const diagnostic = result.evidence.windows[0].error;
  assert.equal(Buffer.byteLength(diagnostic.stderr), 256 * 1024);
  assert.equal(diagnostic.stderr.includes('�'), false);
  assert.deepEqual(diagnostic.stderrCapture, { totalBytes: Buffer.byteLength(stderr), truncated: true });
  for (const change of [
    error => { error.stderr = '😀'.repeat(65537); },
    error => { error.stderrCapture.totalBytes = -1; },
    error => { error.stderrCapture.totalBytes = 4.5; },
    error => { error.stderrCapture.truncated = 'true'; },
    error => { error.stderrCapture.truncated = false; },
    error => { error.stderrCapture.unknown = true; },
    error => { delete error.stderr; },
  ]) {
    const invalid = copy(result); change(invalid.evidence.windows[0].error);
    assert.throws(() => reconstructInspection(invalid.probe, invalid.evidence), { code: 'INVALID_PROBE' });
  }
});
