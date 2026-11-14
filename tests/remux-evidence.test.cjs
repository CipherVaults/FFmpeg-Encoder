'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assessRemux } = require('../src/remux-contract.cjs');
const { collectRemuxEvidence, getCollectedRemuxEvidence, REMUX_EVIDENCE_LIMITS } = require('../src/remux-evidence.cjs');
const { createRemuxValidator } = require('../src/remux-validation.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');
const savedVfr = require('./fixtures/remux-vfr-timeline-v1.json');
const { timedFixture } = require('./helpers/mov-fixture.cjs');
const nativeTracks = [{ id: 1, scale: 1000, pts: [10000, 11000], durations: [1000, 1000] },
  { id: 2, scale: 48000, pts: [480000], durations: [4] }];
const movFixture = (tracks, options) => timedFixture(tracks.map((track, i) => ({ ...nativeTracks[i], ...track })), options);
const { getCollectedMovRepresentation } = require('../src/remux-evidence.cjs');
const { getMovRepresentation } = require('../src/mov-representation.cjs');

// Every child is an async deterministic mock. Tiny inert files establish actual
// filesystem identity; no media is generated, decoded, probed or encoded here.
const RUNTIME = 'b'.repeat(64), SOURCE = 'a'.repeat(64), OUTPUT_ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const zero = () => ({ numerator: '0', denominator: '1' });
const clone = value => structuredClone(value);
const budget = () => ({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8 * 1024 * 1024,
  maxPcmBytes: 128 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
function source() {
  return { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 40, width: 2, height: 2, pix_fmt: 'yuv420p',
      time_base: '1/1000', sample_aspect_ratio: '1:1', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709',
      color_range: 'tv', duration: '2', disposition: { default: 1 }, tags: { title: 'Video' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2,
      channel_layout: 'stereo', time_base: '1/48000', duration: '2', disposition: { default: 1 }, tags: { title: 'Audio' } },
  ], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0,
    tags: { title: 'Source' } }, chapters: [], programs: [], stream_groups: [] };
}
async function setup(t, { probe = source(), target = 'matroska', omitAttachment = false, changeOutput, mutate, changeFrames, changePackets, changeHeader, changeCapture, bytesFor, extraChunk,
  outputBytes = target === 'mp4' || target === 'mov' ? movFixture(nativeTracks) : null } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-collector-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('remux-collector-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const sourcePath = path.join(root, 'source.inert'), outputPath = path.join(root, 'output.inert'), stageDirectory = path.join(root, 'stage');
  await fs.mkdir(stageDirectory); await fs.writeFile(sourcePath, require('./helpers/mov-fixture.cjs').playbackFixture(probe)); await fs.writeFile(outputPath, outputBytes||require('./helpers/matroska-fixture.cjs').matroskaFixture(probe));
  const request = { fileId: 'fixture', identityRevision: 0, draftRevision: 0, operation: 'remux', target, range: null, omissionRequestIds: [] };
  let assessment = assessRemux({ request, probe, sourceFingerprint: SOURCE });
  if (omitAttachment) {
    const attachment = assessment.expectedOutput.streams.find(stream => stream.codecType === 'attachment');
    assert.ok(attachment);
    const grant = { id: 'fixture-attachment-omission', fileId: 'fixture', identityRevision: 0, draftRevision: 0, operation: 'remux', target,
      sourceFingerprint: SOURCE, streamIndex: attachment.inputIndex, streamFingerprint: attachment.streamFingerprint, action: 'omit-stream' };
    assessment = assessRemux({ request: { ...request, omissionRequestIds: [grant.id] }, probe, sourceFingerprint: SOURCE,
      resolveOmission: id => id === grant.id ? grant : null });
  }
  assert.equal(assessment.status, 'qualification-required', JSON.stringify(assessment.blockers));
  const output = clone(probe); output.streams = assessment.expectedOutput.streams.map(mapping => {
    const stream = clone(probe.streams.find(value => value.index === mapping.inputIndex)); stream.index = mapping.outputIndex;
    if (target === 'mp4' || target === 'mov') stream.id = String(stream.index + 1); return stream;
  });
  output.format.nb_streams = output.streams.length;
  output.format.format_name = target === 'matroska' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2';
  output.format.tags = { ...output.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: OUTPUT_ID };
  changeOutput?.(output);
  if(!outputBytes)await fs.writeFile(outputPath,require('./helpers/matroska-fixture.cjs').matroskaFixture(output));
  const calls = []; let running = false;
  const ffmpeg = path.join(root, 'mock-ffmpeg.exe'), ffprobe = path.join(root, 'mock-ffprobe.exe');
  async function run(executable, args, options) {
    assert.equal(running, false, 'children are strictly sequential'); running = true;
    const file = args[args.indexOf('-i') + 1], side = file === sourcePath ? 'source' : 'output';
    assert.ok(file === sourcePath || file === outputPath); assert.ok(options.timeoutMs >= 120000);
    assert.equal(typeof options.onStdoutChunk, 'function'); assert.ok(!args.includes('-t') && !args.includes('-ss'));
    const index = Number(args[args.indexOf(executable === ffprobe ? '-select_streams' : '-map') + 1].replace(/^0:/, ''));
    const stream = (side === 'source' ? probe : output).streams.find(value => value.index === index);
    const call = { executable, args, options, side, stream, sequence: calls.length + 1 }; calls.push(call);
    try {
      let bytes;
      if (executable === ffprobe && args.includes('-show_frames')) {
        let frames = stream.codec_type === 'video' ? [10000, 11000].map(pts => ({ media_type: 'video', stream_index: index, pts,
          duration: 1000, width: 2, height: 2, pix_fmt: 'yuv420p', key_frame: 1 }))
          : [{ media_type: 'audio', stream_index: index, pts: 480000, nb_samples: 4, sample_fmt: stream.sample_fmt,
            sample_rate: stream.sample_rate, channels: stream.channels, channel_layout: stream.channel_layout }];
        frames = changeFrames?.(frames, call) ?? frames; bytes = Buffer.from(JSON.stringify({ frames }));
      } else if (executable === ffprobe && args.includes('-show_packets')) {
        let packets = stream.codec_type === 'subtitle'
          ? [{ stream_index: index, pts: 10000, duration: 1000, size: '5', data_hash: `SHA256:${'7'.repeat(64)}` }]
          : [10000, 11000].map(pts => ({ stream_index: index, pts, duration: 1000, size: '9', data_hash: `SHA256:${'8'.repeat(64)}` }));
        packets = changePackets?.(packets, call) ?? packets; bytes = Buffer.from(JSON.stringify({ packets }));
      } else if (executable === ffprobe && args.includes('-show_streams')) {
        let header = { index, codec_type: stream.codec_type, codec_name: stream.codec_name, ...stream.extradata_size !== undefined
          ? { extradata_size: stream.extradata_size, extradata_hash: stream.extradata_hash } : {}, tags: stream.tags || {} };
        header = changeHeader?.(header, call) ?? header;
        // Real FFprobe 9.0.2 selected-stream header output includes both empty
        // wrappers even without -show_programs / -show_stream_groups.
        bytes = Buffer.from(JSON.stringify({ programs: [], stream_groups: [], streams: [header] }));
      } else if (args.includes('framehash')) {
        assert.ok(args.includes('-noautorotate')); assert.ok(!args.includes('-vf') && !args.includes('-s'));
        bytes = Buffer.from(`#format: frame checksums\n#hash: SHA256\n0, 0, 0, 1, 6, ${'c'.repeat(64)}\n0, 1, 1, 1, 6, ${'d'.repeat(64)}\n`);
      } else {
        const format = args[args.indexOf('-f') + 1], sampleBytes = { s16le: 2, s32le: 4, f32le: 4, f64le: 8 }[format];
        assert.ok(sampleBytes); bytes = Buffer.alloc(4 * stream.channels * sampleBytes, 5);
        assert.ok(!args.includes('-ar') && !args.includes('-ac') && !args.includes('-af'));
      }
      bytes = bytesFor?.(bytes, call) ?? bytes;
      // Chunk boundaries deliberately cut JSON/UTF-8/hash records. The mock
      // awaits each sink so it exercises the real drained binary contract.
      const middle = Math.max(1, Math.floor(bytes.length / 3));
      await options.onStdoutChunk(bytes.subarray(0, middle)); await options.onStdoutChunk(bytes.subarray(middle));
      if (extraChunk) await extraChunk(call, options);
      await mutate?.(call);
      const result = { exitCode: 0, stdout: '', stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
        stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true } };
      return changeCapture?.(result, call) ?? result;
    } finally { running = false; }
  }
  const options = { assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID, sourceProbe: probe, outputProbe: output,
    sourcePath, outputPath, stageDirectory, ffmpeg, ffprobe, run, signal: new AbortController().signal, budget: budget() };
  return { options, assessment, output, probe, sourcePath, outputPath, stageDirectory, root, calls,
    collect: changed => collectRemuxEvidence({ ...options, ...changed }) };
}
function evidence(s, receipt) { return getCollectedRemuxEvidence(receipt, { assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }); }
function validator(s, maxTimestampError = zero(), changeEvidence) {
  const registry = createRemuxValidator({ requireQualification: policy => ({ status: 'verified', runtimeIdentity: policy.runtimeIdentity,
    operation: 'remux', inputFamily: policy.inputFamily, target: policy.target, cellId: policy.cellId, evidenceId: 'mock-only',
    requirementIds: policy.requirementIds, maxTimestampError, maxChapterError: zero() }) });
  const plan = registry.prepare({ assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID, cellId: 'mock-only' });
  return receipt => { const value = evidence(s, receipt);
    return registry.validate({ plan, outputProbe: s.output, essenceEvidence: changeEvidence ? changeEvidence(clone(value)) : value }); };
}
function failure(receipt, pattern) { assert.equal(receipt.status, 'failed'); assert.equal(receipt.essenceEvidence, null); assert.match(JSON.stringify(receipt.failure), pattern); }

async function vfrSetup(t, { changeFrames, changeAverage } = {}) {
  const probe = source(); probe.streams = [probe.streams[0]]; probe.format.nb_streams = 1; probe.format.duration = '2.040000';
  Object.assign(probe.streams[0], { time_base: savedVfr.timeBase, duration: '2.040000', avg_frame_rate: '25/1', r_frame_rate: '25/1' });
  return setup(t, { probe, target: 'mp4',
    outputBytes: timedFixture([{ id: 1, scale: 1000000, pts: savedVfr.frames.map(f => f.ptsUs), durations: savedVfr.frames.map(f => f.durationUs) }]),
    // The complete saved timeline is exact. This different positive rate tag
    // is a synthetic representation fixture, not an invented saved probe fact.
    changeOutput: output => {
      output.streams[0].avg_frame_rate = changeAverage || '1025/51';
      output.streams[0].tags.name = output.streams[0].tags.title; delete output.streams[0].tags.title;
    },
    changeFrames: (frames, call) => {
      const all = savedVfr.frames.map(frame => ({ ...frames[0], pts: frame.ptsUs, duration: frame.durationUs }));
      return changeFrames?.(all, call) ?? all;
    },
    bytesFor: (bytes, call) => call.args.includes('framehash') ? Buffer.from('#format: frame checksums\n#hash: SHA256\n'
      + savedVfr.frames.map((_, index) => `0, ${index}, ${index}, 1, 6, ${hash(Buffer.from(String(index)))}\n`).join('')) : bytes });
}

test('the retained 41-frame VFR timeline establishes complete variable witnesses despite equal source rate tags', async t => {
  const s = await vfrSetup(t), receipt = await s.collect(), value = evidence(s, receipt);
  assert.equal(receipt.status, 'completed'); assert.equal(value.streams[0].source.unitCount, '41');
  const expected = { version: 1, classification: 'variable', intervalCount: '40',
    firstStep: { numerator: '1', denominator: '25' }, differingStep: { numerator: '2', denominator: '25' } };
  assert.deepEqual(value.streams[0].source.cadence, expected); assert.deepEqual(value.streams[0].output.cadence, expected);
  assert.deepEqual(value.streams[0].source.endPts, { numerator: '51', denominator: '25' });
  assert.deepEqual(value.streams[0].timestamps.maxPtsError, zero()); assert.deepEqual(value.streams[0].timestamps.maxDurationError, zero());
  const valid = validator(s)(receipt); assert.equal(valid.valid, true, JSON.stringify(valid)); assert.match(valid.warnings.join('\n'), /average frame-rate summaries differ/);
  for (const side of ['source', 'output']) {
    const legacy = validator(s, zero(), e => { delete e.streams[0][side].cadence; return e; })(receipt);
    assert.equal(legacy.valid, false); assert.match(legacy.errors.join('\n'), /avg_frame_rate/);
  }
});

test('a complete VFR witness does not waive changed interior durations, PTS or final extent', async t => {
  for (const kind of ['duration', 'pts', 'end']) {
    const s = await vfrSetup(t, { changeFrames: (frames, call) => {
      if (call.side === 'output') {
        if (kind === 'duration') frames[20].duration += 1000;
        if (kind === 'pts') frames[20].pts += 1000;
        if (kind === 'end') frames.at(-1).duration += 1000;
      } return frames;
    } });
    const receipt = await s.collect(); assert.equal(receipt.status, 'completed'); assert.equal(validator(s)(receipt).valid, false, kind);
  }
});

test('missing, duplicated and reordered presentation frames cannot create complete positive VFR evidence', async t => {
  for (const kind of ['missing', 'duplicate', 'reordered']) {
    const s = await vfrSetup(t, { changeFrames: (frames, call) => {
      if (call.side === 'output') {
        if (kind === 'missing') frames.splice(20, 1);
        if (kind === 'duplicate') frames[20].pts = frames[19].pts;
        if (kind === 'reordered') [frames[19], frames[20]] = [frames[20], frames[19]];
      } return frames;
    } });
    const receipt = await s.collect(); failure(receipt, /complete native hash|Every decoded video|strictly increasing/i);
  }
});

const TWO_MS = Object.freeze({ numerator: '1', denominator: '500' });
async function quantizedAudio(t, { changeFrames, changePcm = false } = {}) {
  // A two-second deterministic window retains D's actual final source/output
  // PTS (5758976/48000 and 119979/1000) and final 1024-sample decoded tail.
  // Larger earlier mock frames avoid spending a full 120 seconds of PCM work.
  const rows = {
    source: [{ pts: 5664000, nb_samples: 46976 }, { pts: 5710976, nb_samples: 48000 }, { pts: 5758976, nb_samples: 1024 }],
    output: [{ pts: 118000, nb_samples: 46976 }, { pts: 118979, nb_samples: 48000 }, { pts: 119979, nb_samples: 1024 }],
  };
  return setup(t, { changeOutput: output => { output.streams.find(stream => stream.codec_type === 'audio').time_base = '1/1000'; },
    changeFrames: (frames, call) => {
      const native = call.stream.codec_type === 'audio' ? rows[call.side].map(row => ({ ...frames[0], ...row })) : frames;
      return changeFrames?.(native, call) ?? native;
    }, bytesFor: (bytes, call) => call.args.includes('-c:a') ? Buffer.alloc(96000 * 2 * 4, changePcm && call.side === 'output' ? 6 : 5) : bytes });
}

test('full H264/AAC collection covers every unit, seals output, brands and persists bounded evidence', async t => {
  const s = await setup(t), receipt = await s.collect(), value = evidence(s, receipt);
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.qualificationGranted, false); assert.equal(Object.isFrozen(value), true);
  assert.equal(value.streams.length, 2); assert.equal(value.streams[0].source.unitCount, '2'); assert.equal(value.streams[1].source.unitCount, '4');
  assert.equal(value.streams[1].source.contentSha256, hash(Buffer.alloc(32, 5)));
  assert.deepEqual(value.streams[0].timestamps.maxPtsError, zero()); assert.deepEqual(value.streams[1].timestamps.maxDurationError, zero());
  assert.equal(value.outputFileSha256, hash(await fs.readFile(s.outputPath))); assert.equal(validator(s)(receipt).valid, true);
  const sides = s.calls.map(call => call.side); assert.deepEqual(sides, [...sides].sort().reverse(), 'complete source precedes output');
  const artifacts = await fs.readdir(receipt.directory); assert.ok(artifacts.includes('essence.json') && artifacts.includes('receipt.json'));
  assert.equal(receipt.spoolBytes, (await Promise.all(artifacts.map(async name => (await fs.stat(path.join(receipt.directory, name))).size))).reduce((a, b) => a + b, 0));
  const persisted = JSON.parse(await fs.readFile(path.join(receipt.directory, 'essence.json'), 'utf8')); assert.deepEqual(persisted, value);
  assert.throws(() => getCollectedRemuxEvidence(clone(receipt), { assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), /genuine/);
  assert.throws(() => getCollectedRemuxEvidence(receipt, { assessment: clone(s.assessment), runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), /genuine/);
  assert.throws(() => getCollectedRemuxEvidence(receipt, { assessment: s.assessment, runtimeIdentity: 'f'.repeat(64), outputId: OUTPUT_ID }), /genuine/);
  assert.throws(() => getCollectedRemuxEvidence(receipt, { assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: '519e278f-1b7e-4d19-948d-a952b68c328e' }), /genuine/);
});

test('audio sample timeline and metadata are independent of lossless frame segmentation', async t => {
  const s = await setup(t, { changeFrames: (frames, call) => call.side === 'output' && call.stream.codec_type === 'audio'
    ? [{ ...frames[0], nb_samples: 1 }, { ...frames[0], pts: 480001, nb_samples: 3 }] : frames });
  const receipt = await s.collect(), audio = evidence(s, receipt).streams[1];
  assert.equal(audio.source.metadataSha256, audio.output.metadataSha256); assert.deepEqual(audio.timestamps.maxPtsError, zero());
  assert.equal(validator(s)(receipt).valid, true);
});

test('output audio quantization preserves exact resource duration and needs the qualified validator tolerance', async t => {
  const s = await quantizedAudio(t), receipt = await s.collect({ budget: { ...budget(), maxDurationSeconds: 2 } });
  assert.equal(receipt.status, 'completed'); const audio = evidence(s, receipt).streams[1];
  assert.equal(audio.source.unitCount, '96000'); assert.equal(audio.output.unitCount, '96000');
  assert.equal(audio.source.contentSha256, audio.output.contentSha256); assert.equal(audio.source.metadataSha256, audio.output.metadataSha256);
  assert.deepEqual(audio.source.firstPts, { numerator: '118', denominator: '1' });
  assert.deepEqual(audio.source.endPts, { numerator: '120', denominator: '1' });
  assert.deepEqual(audio.output.endPts, { numerator: '360001', denominator: '3000' });
  assert.deepEqual(audio.timestamps.maxPtsError, { numerator: '1', denominator: '3000' });
  assert.deepEqual(audio.timestamps.maxDurationError, zero());
  assert.equal(validator(s, TWO_MS)(receipt).valid, true);
  const exact = validator(s)(receipt); assert.equal(exact.valid, false); assert.match(exact.errors.join('\n'), /tolerance|interval/);
  // Even the full retained D count is exactly 120 seconds; its final timestamp
  // rounds upward by 1/3000 second, without adding decoded samples.
  assert.equal(5760000n, 120n * 48000n);
  assert.equal(119979n * 48000n + 1024n * 1000n - 120n * 48000n * 1000n, 16000n);
});

test('source audio and both video sides retain strict observed duration bounds', async t => {
  for (const [side, type] of [['source', 'audio'], ['source', 'video'], ['output', 'video']]) {
    const s = await quantizedAudio(t, { changeFrames: (frames, call) => call.side === side && call.stream.codec_type === type
      ? frames.map((frame, index) => index === frames.length - 1 ? { ...frame, pts: frame.pts + (type === 'audio' ? 16 : 1) } : frame) : frames });
    failure(await s.collect({ budget: { ...budget(), maxDurationSeconds: 2 } }), /Actual complete decoded extent/);
  }
});

test('source and output sample counts exceeding the resource duration fail before their PCM child', async t => {
  for (const side of ['source', 'output']) {
    const s = await quantizedAudio(t, { changeFrames: (frames, call) => call.side === side && call.stream.codec_type === 'audio'
      ? frames.map((frame, index) => index === frames.length - 1 ? { ...frame, nb_samples: frame.nb_samples + 1 } : frame) : frames });
    failure(await s.collect({ budget: { ...budget(), maxDurationSeconds: 2 } }), /Complete native sample count exceeds/);
    assert.equal(s.calls.filter(call => call.side === side && call.args.includes('-c:a')).length, 0);
  }
});

test('quantized output audio cannot hide gross PTS drift, compensating interior drift or changed PCM', async t => {
  for (const change of ['gross', 'interior', 'content']) {
    const s = await quantizedAudio(t, { changePcm: change === 'content', changeFrames: (frames, call) => call.side === 'output'
      && call.stream.codec_type === 'audio' && change !== 'content' ? frames.map((frame, index) => ({ ...frame,
        pts: frame.pts + (change === 'gross' ? 1000 : index === 1 ? 4 : 0) })) : frames });
    const receipt = await s.collect({ budget: { ...budget(), maxDurationSeconds: 2 } }); assert.equal(receipt.status, 'completed');
    const result = validator(s, TWO_MS)(receipt); assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), change === 'content' ? /native essence/ : /maxPtsError.*tolerance/);
    if (change === 'interior') assert.deepEqual(evidence(s, receipt).streams[1].output.endPts, { numerator: '360001', denominator: '3000' });
  }
});

test('qualified timing cannot override complete count or comparison coverage checks', async t => {
  const s = await quantizedAudio(t), receipt = await s.collect({ budget: { ...budget(), maxDurationSeconds: 2 } });
  assert.equal(receipt.status, 'completed');
  for (const field of ['unitCount', 'comparedUnits']) {
    const result = validator(s, TWO_MS, value => {
      if (field === 'unitCount') value.streams[1].output.unitCount = '95999';
      else value.streams[1].timestamps.comparedUnits = '95999';
      return value;
    })(receipt);
    assert.equal(result.valid, false); assert.match(result.errors.join('\n'), /unit count|comparison is incomplete/);
  }
});

test('decoded sample, meaningful metadata and per-unit timing mismatches reach strict validation', async t => {
  for (const change of ['samples', 'metadata', 'timing']) {
    const s = await setup(t, { bytesFor: (bytes, call) => change === 'samples'
      && call.side === 'output' && call.stream.codec_type === 'audio' && call.args.includes('-c:a') ? Buffer.alloc(bytes.length, 6) : bytes,
    changeFrames: (frames, call) => call.side === 'output' && (change === 'metadata' && call.stream.codec_type === 'video'
      || change === 'timing' && call.stream.codec_type === 'audio')
      ? frames.map(frame => change === 'metadata' ? { ...frame, color_range: 'pc' } : { ...frame, pts: frame.pts + 1 }) : frames });
    const receipt = await s.collect(); assert.equal(receipt.status, 'completed'); const result = validator(s)(receipt);
    assert.equal(result.valid, false); assert.match(result.errors.join('\n'), change === 'timing' ? /timestamp|Pts|interval/i : /native essence|metadata/i);
  }
});

test('unknown, missing, negative, extra or truncated records cannot become complete receipts', async t => {
  const cases = [
    { changeFrames: (rows, c) => c.stream.codec_type === 'audio' ? [{ ...rows[0], nb_samples: -1 }] : rows },
    { changeFrames: (rows, c) => c.stream.codec_type === 'audio' ? [{ ...rows[0], nb_samples: '9007199254740993' }] : rows },
    { changeFrames: (rows, c) => c.stream.codec_type === 'audio' ? [{ ...rows[0], nb_samples: undefined }] : rows },
    { changeFrames: (rows, c) => c.stream.codec_type === 'video' ? rows.map(row => ({ ...row, duration: 0 })) : rows },
    { changeFrames: rows => [] },
    { changeFrames: rows => [...rows, ...rows] },
    { bytesFor: (bytes, c) => c.args.includes('-show_frames') ? bytes.subarray(0, -1) : bytes },
    { bytesFor: (bytes, c) => c.args.includes('framehash') ? Buffer.concat([bytes, Buffer.from(`0, 2, 2, 1, 6, ${'e'.repeat(64)}\n`)]) : bytes },
    { bytesFor: (bytes, c) => c.args.includes('-c:a') ? bytes.subarray(0, -1) : bytes },
  ];
  for (const item of cases) { const s = await setup(t, item), receipt = await s.collect(); failure(receipt, /sample|frame|hash|JSON|probe|representation|PCM|duration/i);
    assert.throws(() => getCollectedRemuxEvidence(receipt, { assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), /genuine/);
    assert.ok((await fs.readdir(receipt.directory)).includes('failure.json'));
  }
});

test('complete sample count mismatch is rejected even when each PCM capture matches its own frames', async t => {
  const s = await setup(t, { changeFrames: (rows, call) => call.side === 'output' && call.stream.codec_type === 'audio'
    ? rows.map(row => ({ ...row, nb_samples: 3 })) : rows,
  bytesFor: (bytes, call) => call.side === 'output' && call.args.includes('-c:a') ? bytes.subarray(0, 24) : bytes });
  failure(await s.collect(), /Every complete decoded\/event unit/);
});

test('per-frame conversion, missing geometry and full-frame HDR changes are refused', async t => {
  for (const edit of [row => ({ ...row, pix_fmt: 'yuv420p10le' }), row => ({ ...row, width: undefined }),
    row => ({ ...row, color_transfer: 'smpte2084' })]) {
    const s = await setup(t, { changeFrames: (rows, call) => call.stream.codec_type === 'video' ? rows.map(edit) : rows });
    failure(await s.collect(), /conversion|geometry|SDR\/HDR/i);
  }
});

test('raw JSON and frame rows stay below hard byte and record caps', async t => {
  const rows = await setup(t, { changeFrames: (frames, call) => call.stream.codec_type === 'video' ? Array.from({ length: 20001 }, (_, i) => ({ ...frames[0], pts: i, duration: 1 })) : frames });
  failure(await rows.collect(), /excessive/i);
  const bytes = await setup(t, { bytesFor: (value, call) => call.args.includes('-show_frames') ? Buffer.from('{"frames":[{"pad":"' + 'x'.repeat(8 * 1024 * 1024 + 1) + '"}]}') : value });
  failure(await bytes.collect(), /byte ceiling/i);
});

test('nonzero warnings, incomplete diagnostics, capture lies and binary overrun fail closed', async t => {
  const captures = [r => ({ ...r, stderr: 'warning\n', stderrCapture: { totalBytes: 8, truncated: false } }),
    r => ({ ...r, stderrCapture: { totalBytes: 0, truncated: true } }), r => ({ ...r, stdoutCapture: { ...r.stdoutCapture, truncated: true } }),
    r => ({ ...r, stdoutCapture: { ...r.stdoutCapture, totalBytes: r.stdoutCapture.totalBytes + 1 } }), r => ({ ...r, exitCode: 1 })];
  for (const changeCapture of captures) { const s = await setup(t, { changeCapture }); failure(await s.collect(), /diagnostics|capture/i); }
  const s = await setup(t, { bytesFor: (bytes, call) => call.args.includes('-c:a') ? Buffer.concat([bytes, Buffer.alloc(1)]) : bytes });
  failure(await s.collect(), /ceiling/i);
});

function richAttachmentProbe(codec = 'ttf') {
  const probe = source(); probe.format.format_name = 'matroska,webm'; probe.streams[1].index = 1;
  probe.streams.push({ index: 2, codec_type: 'subtitle', codec_name: 'subrip', time_base: '1/1000', tags: {}, disposition: {} },
    { index: 3, codec_type: 'subtitle', codec_name: 'ass', time_base: '1/1000', extradata_size: 12,
      extradata_hash: `SHA256:${'8'.repeat(64)}`, tags: {}, disposition: {} },
    { index: 4, codec_type: 'attachment', codec_name: codec, extradata_size: 69,
      extradata_hash: `SHA256:${'9'.repeat(64)}`, tags: { filename: 'opaque-fixture.ttf', mimetype: 'application/x-truetype-font' }, disposition: {} });
  probe.format.nb_streams = probe.streams.length; return probe;
}
const attachmentDiagnostic = 'Unsupported codec with id 98304 for input stream 4\r\n';
function withDiagnostic(result, stderr = attachmentDiagnostic) {
  return { ...result, stderr, stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false } };
}

test('selected A/V show_frames classifies only the exact mapped TTF diagnostic and still completes all attachment evidence', async t => {
  const s = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => call.args.includes('-show_frames') ? withDiagnostic(result) : result });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed');
  const classified = receipt.invocations.filter(item => item.diagnosticAssessment);
  assert.equal(classified.length, 4, 'source and output video/audio frame queries have independently bound diagnostics');
  for (const invocation of classified) {
    assert.ok(invocation.args.includes('-show_frames')); assert.equal(invocation.stderr, attachmentDiagnostic);
    assert.equal(invocation.stderrCapture.totalBytes, 52); assert.equal(invocation.stderrCapture.truncated, false);
    assert.equal(invocation.diagnosticAssessment.codecName, 'ttf');
    assert.equal(invocation.diagnosticAssessment.diagnosticStreamIndex, 4);
    assert.notEqual(invocation.diagnosticAssessment.selectedStreamIndex, 4);
    assert.equal(invocation.diagnosticAssessment.attachmentEvidenceRequired, true);
    const captured = JSON.parse(await fs.readFile(invocation.artifact.path, 'utf8'));
    assert.ok(captured.frames.length > 0); assert.ok(captured.frames.every(frame => frame.stream_index === invocation.diagnosticAssessment.selectedStreamIndex));
  }
  assert.equal(evidence(s, receipt).streams.length, 5);
  const attachment = evidence(s, receipt).streams.find(item => item.codecType === 'attachment');
  assert.equal(attachment.source.unitCount, '1'); assert.equal(attachment.source.contentSha256, '9'.repeat(64));
  assert.equal(attachment.source.contentSha256, attachment.output.contentSha256);
  assert.equal(validator(s)(receipt).valid, true);
});

test('TTF diagnostic classification never admits selected/nonattachment, unknown, unmapped or different-codec streams', async t => {
  for (const index of [0, 1, 2, 9]) {
    const s = await setup(t, { probe: richAttachmentProbe(), changeCapture: result => withDiagnostic(result,
      `Unsupported codec with id 98304 for input stream ${index}\r\n`) });
    failure(await s.collect(), /diagnostics/);
  }
  for (const options of [{ probe: richAttachmentProbe('otf') }, { probe: richAttachmentProbe(), omitAttachment: true }]) {
    const s = await setup(t, { ...options, changeCapture: result => withDiagnostic(result) });
    failure(await s.collect(), /diagnostics/);
  }
});

test('TTF classification requires the exact complete diagnostic and zero-exit fully accounted captures', async t => {
  const edits = [
    result => withDiagnostic(result, attachmentDiagnostic + 'Error while decoding selected stream\r\n'),
    result => withDiagnostic(result, attachmentDiagnostic + attachmentDiagnostic),
    result => withDiagnostic(result, attachmentDiagnostic + '\r\n'),
    result => withDiagnostic(result, attachmentDiagnostic.trimEnd()),
    result => withDiagnostic(result, attachmentDiagnostic.replace('98304', '98305')),
    result => ({ ...withDiagnostic(result), stderrCapture: { totalBytes: 52, truncated: true } }),
    result => ({ ...withDiagnostic(result), stderrCapture: { totalBytes: 51, truncated: false } }),
    result => ({ ...withDiagnostic(result), exitCode: 1 }),
  ];
  for (const changeCapture of edits) {
    const s = await setup(t, { probe: richAttachmentProbe(), changeCapture }); failure(await s.collect(), /diagnostics|capture/);
  }
  const changedSelection = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => {
    if (call.args.includes('-show_frames')) call.args[call.args.indexOf('-select_streams') + 1] = '4';
    return withDiagnostic(result);
  } });
  failure(await changedSelection.collect(), /diagnostics/);
});

// October23's seven retained selected-stream queries establish the same native
// discovery diagnostic for packets and headers; FFmpeg decode remains strict.
test('the same TTF diagnostic is still refused from every FFmpeg native decode command', async t => {
  for (const command of ['framehash', '-c:a']) {
    const s = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => call.args.includes(command) ? withDiagnostic(result) : result });
    const receipt = await s.collect(); failure(receipt, /diagnostics/);
    assert.equal(receipt.invocations.find(item => item.status === 'failed').diagnosticAssessment, undefined);
  }
});

test('measured canonical packet/header queries classify TTF discovery and still prove complete validator evidence', async t => {
  const probe = richAttachmentProbe();
  Object.assign(probe.streams[0], { extradata_size: 47, extradata_hash: `SHA256:${'7'.repeat(64)}` });
  const s = await setup(t, { probe,
    changeFrames: (frames, call) => call.stream.codec_type === 'video' ? frames.map(frame => ({ ...frame,
      side_data_list: [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }] })) : frames,
    changeCapture: (result, call) => call.args.includes('-select_streams') ? withDiagnostic(result) : result });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed');
  const classified = receipt.invocations.filter(item => item.diagnosticAssessment);
  assert.equal(classified.length, 18, 'both sides retain all A/V frames, video/subtitle packets and video/subtitle/attachment headers');
  assert.deepEqual([...new Set(classified.map(item => item.diagnosticAssessment.probeQuery))].sort(), ['frames', 'header', 'packets']);
  for (const invocation of classified) {
    assert.equal(invocation.stderr, attachmentDiagnostic); assert.equal(invocation.stderrCapture.totalBytes, 52);
    assert.equal(invocation.diagnosticAssessment.code, 'FFPROBE_TTF_ATTACHMENT_DECODER_DISCOVERY');
    if (invocation.diagnosticAssessment.selectedCodecType === 'attachment') {
      assert.equal(invocation.diagnosticAssessment.probeQuery, 'header');
      assert.equal(invocation.diagnosticAssessment.selectedStreamIndex, 4);
      const header = JSON.parse(await fs.readFile(invocation.artifact.path, 'utf8')).streams[0];
      assert.equal(header.extradata_size, 69); assert.equal(header.extradata_hash, `SHA256:${'9'.repeat(64)}`);
    }
  }
  assert.equal(evidence(s, receipt).streams.length, 5);
  assert.equal(validator(s)(receipt).valid, true);
});

test('packet/header TTF discovery never permits altered canonical commands or incomplete/extra diagnostics', async t => {
  for (const command of ['-show_packets', '-show_streams']) {
    const changes = [
      result => withDiagnostic(result, attachmentDiagnostic + 'Another warning\r\n'),
      result => ({ ...withDiagnostic(result), stderrCapture: { totalBytes: 52, truncated: true } }),
      result => ({ ...withDiagnostic(result), exitCode: 1 }),
      (result, call) => { call.args.push('-show_format'); return withDiagnostic(result); },
    ];
    for (const change of changes) {
      const s = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => call.args.includes(command) ? change(result, call) : result });
      failure(await s.collect(), /diagnostics|capture/);
    }
  }
  for (const replacement of ['-show_frames', '-show_packets']) {
    const s = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => {
      if (call.stream.codec_type !== 'attachment') return result;
      call.args[call.args.indexOf('-show_streams')] = replacement; return withDiagnostic(result);
    } });
    failure(await s.collect(), /diagnostics/);
  }
});

test('a classified unselected TTF warning cannot bypass frame JSON or subsequent attachment payload verification', async t => {
  const malformed = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => call.args.includes('-show_frames') ? withDiagnostic(result) : result,
    bytesFor: (bytes, call) => call.args.includes('-show_frames') ? bytes.subarray(0, -1) : bytes });
  failure(await malformed.collect(), /JSON/);
  const attachment = await setup(t, { probe: richAttachmentProbe(), changeCapture: (result, call) => call.args.includes('-select_streams') ? withDiagnostic(result) : result,
    changeHeader: (header, call) => call.stream.codec_type === 'attachment' ? { ...header, extradata_hash: undefined } : header });
  const receipt = await attachment.collect(); failure(receipt, /extradata/);
  assert.ok(receipt.invocations.some(item => item.diagnosticAssessment));
  assert.ok(receipt.invocations.some(item => item.args.includes('-show_streams') && item.args.includes('4')));
  assert.ok(receipt.invocations.some(item => item.diagnosticAssessment?.selectedCodecType === 'attachment'
    && item.diagnosticAssessment.probeQuery === 'header'), 'the selected TTF header diagnostic itself cannot replace payload proof');
  assert.equal(receipt.qualificationGranted, false); assert.equal(receipt.publicationAuthorized, false);
  assert.throws(() => evidence(attachment, receipt), /genuine/);
});

test('source/output replacement or change during a mocked child refuses completion and retains evidence', async t => {
  for (const side of ['source', 'output']) {
    let changed = false;
    const s = await setup(t, { mutate: async call => { if (!changed) { changed = true;
      const input = call.args[call.args.indexOf('-i') + 1], target = path.join(path.dirname(input), `${side}.inert`); await fs.appendFile(target, 'changed'); } } });
    failure(await s.collect(), /changed/i);
  }
  let changed = false;
  const s = await setup(t, { mutate: async call => { if (!changed) { changed = true; const file = call.args[call.args.indexOf('-i') + 1]; await fs.rename(file, `${file}.retained`); await fs.writeFile(file, 'source fixture bytes'); } } });
  failure(await s.collect(), /changed/i);
});

test('hardlinks and unbranded/source-probe/output map mismatches refuse before children', async t => {
  const s = await setup(t); await fs.link(s.sourcePath, path.join(s.root, 'source-link'));
  await assert.rejects(s.collect(), /linked/); assert.equal(s.calls.length, 0);
  const other = await setup(t); await assert.rejects(other.collect({ assessment: clone(other.assessment) }), /genuine/);
  const altered = clone(other.probe); altered.streams[0].width = 4;
  await assert.rejects(other.collect({ sourceProbe: altered }), /Source probe/);
  const missing = clone(other.output); missing.streams.pop(); await assert.rejects(other.collect({ outputProbe: missing }), /map/);
});

test('changed owned evidence and redirected stage ancestors refuse completion', async t => {
  let changed = false, staged;
  const s = await setup(t, { mutate: async call => {
    if (call.sequence === 2 && !changed) { changed = true; const dir = path.join(staged, (await fs.readdir(staged))[0]);
      await fs.appendFile(path.join(dir, 'child-1.stdout'), 'changed'); }
  } }); staged = s.stageDirectory;
  failure(await s.collect(), /changed/i);
  const j = await setup(t), redirected = path.join(j.root, 'redirected');
  await fs.symlink(j.stageDirectory, redirected, 'junction');
  await assert.rejects(j.collect({ stageDirectory: redirected }), /link|reparse|redirect/i); assert.equal(j.calls.length, 0);
});

test('complete cost/byte/record/time/spool ceilings cannot be raised or sampled', async t => {
  const s = await setup(t);
  assert.deepEqual(REMUX_EVIDENCE_LIMITS.maxSourceBytes, 512 * 1024 * 1024);
  for (const [key, value] of Object.entries(REMUX_EVIDENCE_LIMITS)) await assert.rejects(s.collect({ budget: { ...budget(), [key]: value + 1 } }), /ceiling/);
  await assert.rejects(s.collect({ budget: { ...budget(), sourceDecode: 'sample' } }), /complete source/);
  await assert.rejects(s.collect({ budget: { ...budget(), maxRecords: undefined } }), /ceiling/);
  const small = await setup(t); failure(await small.collect({ budget: { ...budget(), maxRecords: 1 } }), /excessive|limit/i);
  const spool = await setup(t); failure(await spool.collect({ budget: { ...budget(), maxSpoolBytes: 100 } }), /spool/i);
  const duration = source(); duration.format.duration = '120.000000001'; const long = await setup(t, { probe: duration });
  assert.equal((await long.collect()).status, 'completed');
});

test('native PCM16/24/32 and float64 retain complete precision without resampling', async t => {
  for (const [codec_name, sample_fmt, format] of [['pcm_s16le', 's16', 's16le'], ['pcm_s24le', 's32', 's32le'],
    ['pcm_s32le', 's32', 's32le'], ['pcm_f64le', 'dbl', 'f64le']]) {
    const probe = source(); Object.assign(probe.streams[1], { codec_name, sample_fmt }); delete probe.streams[1].profile;
    const s = await setup(t, { probe }), receipt = await s.collect(); assert.equal(receipt.status, 'completed');
    assert.ok(s.calls.filter(c => c.args.includes('-c:a')).every(c => c.args.includes(`pcm_${format}`)));
  }
  const unknown = source(); unknown.streams[1].sample_fmt = 's64'; const s = await setup(t, { probe: unknown }); await assert.rejects(s.collect(), /precision/);
  const layout = await setup(t, { changeOutput: output => { delete output.streams[1].channel_layout; } }); await assert.rejects(layout.collect(), /layout/);
});

test('PCM bytes are budgeted across all audio streams in each complete file', async t => {
  const probe = source(); probe.streams.push({ ...clone(probe.streams[1]), index: 4, disposition: {}, tags: { title: 'Second audio' } });
  probe.format.nb_streams = 3; const s = await setup(t, { probe });
  const receipt = await s.collect({ budget: { ...budget(), maxPcmBytes: 32 } });
  failure(receipt, /per-file byte ceiling/);
  assert.equal(s.calls.filter(call => call.args.includes('-c:a')).length, 1, 'second audio cannot spend a fresh per-stream allowance');
});

test('complete PCM window digests locate an interior mismatch beyond the first MiB', async t => {
  const samples = 262145, probe = source(); probe.format.duration = '60';
  const s = await setup(t, { probe, changeFrames: (frames, call) => call.stream.codec_type === 'audio'
    ? frames.map(frame => ({ ...frame, nb_samples: samples })) : frames,
  bytesFor: (bytes, call) => {
    if (!call.args.includes('-c:a')) return bytes;
    const pcm = Buffer.alloc(samples * 8, 5); if (call.side === 'output') pcm[1024 * 1024 + 7] = 6; return pcm;
  } });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  const compared = receipt.comparisons[1].pcmWindows; assert.equal(compared.comparedWindows, 3);
  assert.equal(compared.firstMismatchByte, 1024 * 1024); assert.equal(validator(s)(receipt).valid, false);
  await assert.rejects(s.collect({ onProgress: 1 }), /main-owned callback/);
});

test('opaque native side-data descriptors require full coded payload identity', async t => {
  const descriptor = (rows, call) => call.stream.codec_type === 'video' ? rows.map(row => ({ ...row,
    side_data_list: [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }] })) : rows;
  const same = await setup(t, { changeFrames: descriptor }); assert.equal((await same.collect()).status, 'completed');
  const different = await setup(t, { changeFrames: descriptor, changePackets: (rows, call) => call.side === 'output'
    ? rows.map(row => ({ ...row, data_hash: `SHA256:${'6'.repeat(64)}` })) : rows }); failure(await different.collect(), /Opaque/);
});

test('real header wrappers preserve exact stream, codec and inspected extradata checks', async t => {
  const probe = source(); Object.assign(probe.streams[0], { extradata_size: 49, extradata_hash: `SHA256:${'9'.repeat(64)}` });
  const descriptor = (rows, call) => call.stream.codec_type === 'video' ? rows.map(row => ({ ...row,
    side_data_list: [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }] })) : rows;
  const s = await setup(t, { probe, changeFrames: descriptor }), receipt = await s.collect();
  assert.equal(receipt.status, 'completed'); assert.equal(validator(s)(receipt).valid, true);
  assert.equal(s.calls.filter(call => call.args.includes('-show_streams')).length, 2);
  for (const edit of [header => ({ ...header, index: header.index + 1 }), header => ({ ...header, codec_type: 'audio' }),
    header => ({ ...header, codec_name: 'hevc' }), header => ({ ...header, extradata_size: 48 }),
    header => ({ ...header, extradata_hash: `SHA256:${'8'.repeat(64)}` })]) {
    const changed = await setup(t, { probe, changeFrames: descriptor, changeHeader: edit });
    failure(await changed.collect(), /Native header|Codec header/);
  }
});

test('header companion arrays must be empty and unknown top-level sections are refused', async t => {
  const descriptor = (rows, call) => call.stream.codec_type === 'video' ? rows.map(row => ({ ...row,
    side_data_list: [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }] })) : rows;
  for (const extra of [{ programs: [{ program_id: 1 }] }, { stream_groups: [{ index: 0 }] },
    { programs: {} }, { stream_groups: null }, { chapters: [] }, { unexpected: [] }]) {
    const s = await setup(t, { changeFrames: descriptor, bytesFor: (bytes, call) => call.args.includes('-show_streams')
      ? Buffer.from(JSON.stringify({ ...JSON.parse(bytes), ...extra })) : bytes });
    const receipt = await s.collect(); failure(receipt, /Missing, unexpected or excessive complete probe records/);
    assert.equal(receipt.qualificationGranted, false); assert.equal(receipt.publicationAuthorized, false);
    assert.throws(() => evidence(s, receipt), /genuine/);
  }
});

test('frame and packet queries still refuse even empty header companion sections', async t => {
  for (const query of ['-show_frames', '-show_packets']) for (const section of ['programs', 'stream_groups']) {
    const s = await setup(t, { bytesFor: (bytes, call) => call.args.includes(query)
      ? Buffer.from(JSON.stringify({ ...JSON.parse(bytes), [section]: [] })) : bytes });
    failure(await s.collect(), /Missing, unexpected or excessive complete probe records/);
  }
});

test('attachment extradata and exact tag identity have one complete payload and no invented timeline', async t => {
  const probe = source(); probe.format.format_name = 'matroska,webm';
  probe.streams.push({ index: 5, codec_type: 'attachment', codec_name: 'ttf', extradata_size: 24,
    extradata_hash: `SHA256:${'9'.repeat(64)}`, tags: { filename: 'font.ttf', mimetype: 'application/x-truetype-font' }, disposition: {} });
  probe.format.nb_streams = 3;
  const s = await setup(t, { probe }), receipt = await s.collect(), attachment = evidence(s, receipt).streams[2];
  assert.equal(attachment.source.representation, 'attachment-extradata-v1'); assert.equal(attachment.source.contentSha256, '9'.repeat(64));
  assert.equal(attachment.source.unitCount, '1'); assert.equal(attachment.source.firstPts, null); assert.equal(attachment.timestamps, null);
  assert.equal(validator(s)(receipt).valid, true);
  const lost = await setup(t, { probe, changeHeader: header => ({ ...header, extradata_hash: undefined }) }); failure(await lost.collect(), /extradata/);
  const metadata = await setup(t, { probe, changeHeader: (header, call) => call.side === 'output' ? { ...header, tags: { ...header.tags, filename: 'changed.ttf' } } : header });
  const changed = await metadata.collect(); assert.equal(changed.status, 'completed'); assert.equal(validator(metadata)(changed).valid, false);
});

test('same-codec Matroska subrip/ASS prove coded full event/header identity with exact timestamps', async t => {
  for (const codec_name of ['subrip', 'ass']) {
    const probe = source(); probe.format.format_name = 'matroska,webm';
    probe.streams.push({ index: 5, codec_type: 'subtitle', codec_name, time_base: '1/1000', tags: { language: 'eng' }, disposition: {},
      ...(codec_name === 'ass' ? { extradata_size: 12, extradata_hash: `SHA256:${'9'.repeat(64)}` } : {}) }); probe.format.nb_streams = 3;
    const s = await setup(t, { probe }), receipt = await s.collect(), sub = evidence(s, receipt).streams[2];
    assert.equal(sub.source.unitCount, '1'); assert.equal(sub.source.representation, 'subtitle-events-v1');
    assert.equal(sub.source.firstPts.numerator, '10'); assert.deepEqual(sub.timestamps.maxPtsError, zero()); assert.equal(validator(s)(receipt).valid, true);
    assert.ok(receipt.comparisons.some(row => row.evidenceKind === 'complete-coded-subtitle-event-and-header-identity'));
    const shifted = await setup(t, { probe, changePackets: (rows, call) => call.stream.codec_type === 'subtitle' && call.side === 'output'
      ? rows.map(row => ({ ...row, pts: row.pts + 1 })) : rows }); const shiftedReceipt = await shifted.collect(); assert.equal(validator(shifted)(shiftedReceipt).valid, false);
  }
});

test('canonical descriptive-tag warnings do not become false subtitle or attachment essence failures', async t => {
  for (const type of ['subtitle', 'attachment']) {
    const probe = source(); probe.format.format_name = 'matroska,webm'; probe.format.nb_streams = 3;
    probe.streams.push(type === 'subtitle'
      ? { index: 5, codec_type: type, codec_name: 'subrip', time_base: '1/1000', disposition: {},
        tags: { title: 'Required caption label', comment: 'Descriptive source note', DURATION: 'derived source counter' } }
      : { index: 5, codec_type: type, codec_name: 'ttf', disposition: {}, extradata_size: 24, extradata_hash: `SHA256:${'9'.repeat(64)}`,
        tags: { filename: 'required.ttf', mimetype: 'application/x-truetype-font', comment: 'Descriptive source note' } });
    const s = await setup(t, { probe, changeOutput: output => {
      const stream = output.streams.find(value => value.codec_type === type);
      stream.tags.comment = 'Different descriptive output note';
      if (type === 'subtitle') stream.tags.DURATION = 'recomputed counter';
    } });
    const receipt = await s.collect(); assert.equal(receipt.status, 'completed');
    const result = validator(s)(receipt), semantic = evidence(s, receipt).streams[2];
    assert.equal(result.valid, true, result.errors.join(' '));
    assert.equal(result.warnings.filter(value => value.key === 'comment').length, 1);
    assert.equal(semantic.source.metadataSha256, semantic.output.metadataSha256);
    assert.equal(semantic.source.contentSha256, semantic.output.contentSha256);
    const required = await setup(t, { probe, changeOutput: output => {
      output.streams.find(value => value.codec_type === type).tags[type === 'subtitle' ? 'title' : 'filename'] = 'Changed required identity';
    } });
    const changed = await required.collect(); assert.equal(changed.status, 'completed');
    assert.equal(validator(required)(changed).valid, false, 'Useful labels and attachment identity remain required.');
  }
});

test('cancellation retains an unbranded failure receipt without accepting partial capture', async t => {
  const controller = new AbortController(); const s = await setup(t, { mutate: () => controller.abort() });
  const receipt = await s.collect({ signal: controller.signal }); assert.equal(receipt.status, 'cancelled'); assert.equal(receipt.essenceEvidence, null);
  assert.ok((await fs.readdir(receipt.directory)).includes('failure.json'));
});

test('a MOV target collection reads track languages from the sealed owned output and keeps the branded receipt private', async t => {
  const ids = changed => { changed.streams[0].id = '0x1'; changed.streams[1].id = '0x2'; };
  const s = await setup(t, { target: 'mov', changeOutput: ids, outputBytes: movFixture([{ id: 1 }, { id: 2, language: 0 }]) });
  const receipt = await s.collect();
  assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  const bindings = { assessment: s.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID };
  const mov = getCollectedMovRepresentation(receipt, bindings), value = evidence(s, receipt);
  assert.deepEqual(mov.tracks.map(track => [track.outputIndex, track.trackId, track.languageCode]), [[0, 1, 32767], [1, 2, 0]]);
  assert.equal(mov.outputSha256, value.outputFileSha256);
  assert.equal(getMovRepresentation(mov, { outputId: OUTPUT_ID, outputEvidenceFingerprint: value.outputEvidenceFingerprint, outputSha256: value.outputFileSha256 }), mov);
  // The persisted and returned receipt carries a bounded description, not the branded object.
  assert.notEqual(receipt.movRepresentation, mov);
  assert.deepEqual(receipt.movRepresentation, { kind: 'owned-mov-mdhd-language', tracks: [{ outputIndex: 0, trackId: 1, languageCode: 32767 }, { outputIndex: 1, trackId: 2, languageCode: 0 }] });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(receipt.directory, 'receipt.json'), 'utf8')).movRepresentation, receipt.movRepresentation);
  assert.throws(() => getCollectedMovRepresentation(clone(receipt), bindings), /genuine/);
  assert.throws(() => getCollectedMovRepresentation(receipt, { ...bindings, runtimeIdentity: 'f'.repeat(64) }), /genuine/);
});

test('unreadable MOV output fails native collection; other targets obtain no MOV language receipt', async t => {
  const ids = changed => { changed.streams[0].id = '0x1'; changed.streams[1].id = '0x2'; };
  for (const [outputBytes, code] of [['output fixture bytes', /REMUX_NATIVE_STRUCTURE/],
    [movFixture([{ id: 1 }, { id: 2 }], { brand: 'isom' }), /MOV_REPRESENTATION_UNVERIFIED/],
    [movFixture([{ id: 1 }, { id: 3 }]), /REMUX_NATIVE_STRUCTURE/]]) {
    const s = await setup(t, { target: 'mov', changeOutput: ids, outputBytes });
    failure(await s.collect(), code);
  }
  const failed = await setup(t, { target: 'mov', changeOutput: ids, outputBytes: 'invalid native output' }), failedReceipt = await failed.collect();
  assert.throws(() => getCollectedMovRepresentation(failedReceipt, { assessment: failed.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), /genuine/);
  const mp4 = await setup(t, { target: 'mp4' }), mp4Receipt = await mp4.collect();
  assert.equal(mp4Receipt.status, 'completed', JSON.stringify(mp4Receipt.failure)); assert.equal(Object.hasOwn(mp4Receipt, 'movRepresentation'), false);
  assert.equal(getCollectedMovRepresentation(mp4Receipt, { assessment: mp4.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), null);
  const mkv = await setup(t), receipt = await mkv.collect();
  assert.equal(receipt.status, 'completed'); assert.equal(Object.hasOwn(receipt, 'movRepresentation'), false);
  assert.equal(getCollectedMovRepresentation(receipt, { assessment: mkv.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), null);
});
