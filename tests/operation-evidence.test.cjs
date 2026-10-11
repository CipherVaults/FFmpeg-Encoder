'use strict';

// Injected owned-runner streams and temporary non-media byte fixtures only.
// This proves collection/arithmetic/failure contracts, not FFprobe writer or
// native decode qualification. Native callers must measure the actual runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { buildEncodeOperation, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { collectOperationEvidence, lineSink, compactRow, sourceChange, compareAudioTimelines, evidenceFailure } = require('../src/operation-evidence.cjs');
const { ToolError } = require('../src/process-runner.cjs');

const color = { color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' };
function probe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', ...color,
    field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/1000', start_pts: 0, start_time: '0',
    duration_ts: 400, duration: '0.4', avg_frame_rate: '10/1', r_frame_rate: '10/1', tags: { title: 'Video' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: 16, channels: 2, channel_layout: 'stereo',
    sample_rate: '48000', time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 19200, duration: '0.4', tags: { language: 'eng' }, disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '0.4', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Fixture' } },
  chapters: [], programs: [], stream_groups: [] };
}
function line(section, row) { return section + '|' + Object.entries(row).map(([key, value]) => key + '=' + value).join('|') + '\n'; }
function frames(stream, pts, audio = false) {
  return pts.map(value => audio ? { media_type: 'audio', stream_index: stream.index, pts: value, nb_samples: 4800,
    sample_fmt: stream.sample_fmt, channels: stream.channels, channel_layout: stream.channel_layout }
    : { media_type: 'video', stream_index: stream.index, pts: value, duration: 100, width: stream.width, height: stream.height,
      pix_fmt: stream.pix_fmt, interlaced_frame: 0, ...color });
}
async function fixture(t, { mode = 'precision-flac', overrides = {}, mutateProbe } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffet-operation-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.bin'), outputPath = path.join(root, 'output.bin'), stageDirectory = path.join(root, 'stage');
  await fs.mkdir(stageDirectory); await fs.writeFile(sourcePath, 'untouched source'); await fs.writeFile(outputPath, 'completed output');
  const sourceProbe = probe(); mutateProbe?.(sourceProbe);
  const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
  const plan = buildEncodeOperation({ input: sourcePath, output: outputPath, settings,
    inspection: { probe: sourceProbe, color: classifyColor(sourceProbe), duration: .4, evidence: {}, summary: {} },
    request: resolveFileRequest({ fileId: 'fixture', identityRevision: 1, draftRevision: 1, operation: 'encode',
      overrides: { range: { startUs: 100000, endUs: 300000 }, audioPolicy: mode, ...overrides } }), runtimeIdentity: 'a'.repeat(64) });
  const outputProbe = structuredClone(sourceProbe); outputProbe.format.format_name = 'matroska,webm'; outputProbe.format.duration = '.2';
  outputProbe.streams[0].codec_name = 'hevc'; outputProbe.streams[0].duration = '.2'; outputProbe.streams[0].duration_ts = 200;
  outputProbe.streams[1].index = 1; outputProbe.streams[1].codec_name = mode === 'precision-flac' ? 'flac' : 'aac'; outputProbe.streams[1].time_base = '1/1000';
  outputProbe.streams[1].duration = '.2'; outputProbe.streams[1].duration_ts = 200;
  const sourceFrames = { 0: frames(sourceProbe.streams[0], [0, 100, 200, 300]), 2: frames(sourceProbe.streams[1], [0, 4800, 9600, 14400], true) };
  const outputFrames = { 0: frames(outputProbe.streams[0], [0, 100]), 1: frames(outputProbe.streams[1], [0, 100], true) };
  const sourcePcm = Buffer.alloc(19200 * 4); for (let i = 0; i < sourcePcm.length; i++) sourcePcm[i] = (i * 17 + Math.floor(i / 256)) % 256;
  const data = { sourceFrames, outputFrames, sourcePcm, outputPcm: Buffer.from(sourcePcm.subarray(4800 * 4, 14400 * 4)),
    packetRows: [line('packet', { stream_index: 1 })], transform: null, capture: null, stderr: '', calls: [] };
  const run = async (executable, args, options) => {
    data.calls.push({ executable, args, options }); let bytes;
    const source = args[args.indexOf('-i') + 1] === sourcePath;
    if (args.includes('-show_frames')) {
      const index = args[args.indexOf('-select_streams') + 1]; bytes = Buffer.from((source ? data.sourceFrames : data.outputFrames)[index].map(row => line('frame', row)).join(''));
    } else if (args.includes('-show_packets')) bytes = Buffer.from(data.packetRows.join(''));
    else bytes = source ? data.sourcePcm : data.outputPcm;
    if (data.transform) bytes = await data.transform({ bytes, args, source, options });
    for (let n = 0; n < bytes.length; n += 313) await options.onStdoutChunk(bytes.subarray(n, n + 313));
    return { stdout: '', exitCode: 0, stderr: data.stderr, stderrCapture: { totalBytes: Buffer.byteLength(data.stderr), truncated: false },
      stdoutCapture: data.capture || { totalBytes: bytes.length, truncated: false, streamed: true } };
  };
  const options = { plan, sourceProbe, outputProbe, sourcePath, outputPath, stageDirectory, ffmpeg: path.join(root, 'ffmpeg.exe'), ffprobe: path.join(root, 'ffprobe.exe'),
    run, signal: undefined, budget: { sourceDecode: 'complete', timeoutMs: 60000, maxFrameBytes: 1048576, maxPcmBytes: 1048576, maxRecords: 10000, maxSpoolBytes: 1048576 },
    timingQualification: { evidenceId: 'pure-fixture-only', runtimeIdentity: 'a'.repeat(64), videoDurationUs: 0, audioTimelineUs: 0,
      aac: mode === 'precision-aac' ? { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 0, discardPaddingSamples: 0 } : null } };
  return { options, data, root };
}
const qualification = { evidenceId: 'pure-fixture-only', runtimeIdentity: 'a'.repeat(64), containerDuration: 'end-timestamp',
  tolerances: { videoTimestampUs: 0, audioTimestampUs: 0, avSyncUs: 0, durationUs: 0, sampleCount: 0 } };

test('complete streaming collection feeds the real validator with exact selected FLAC PCM equality', async t => {
  const { options, data } = await fixture(t); const result = await collectOperationEvidence(options);
  assert.equal(result.status, 'completed'); assert.equal(result.publicationAuthorized, false); assert.equal(result.qualificationGranted, false);
  assert.equal(data.calls.length, 7); assert.ok(data.calls.every(call => !call.options.onChild && call.options.onStdoutChunk));
  assert.deepEqual(result.decodedEvidence.video, { sourceFrameCount: 2, outputFrameCount: 2, comparedFrames: 2,
    firstSourcePtsUs: 100000, lastSourcePtsUs: 200000, lastSourceDurationUs: 100000, firstOutputPtsUs: 0, lastOutputPtsUs: 100000,
    lastOutputDurationUs: 100000, maxRebasedTimestampErrorUs: 0 });
  const audio = result.decodedEvidence.audio[0]; assert.equal(audio.sourceSampleCount, 9600); assert.equal(audio.outputSampleCount, 9600);
  assert.equal(audio.pcmIdentity.sourceBytes, 38400); assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
  const validated = validateEncodeOperationOutput(options.plan, options.outputProbe, { qualification, decodedEvidence: result.decodedEvidence });
  assert.equal(validated.valid, true, validated.errors.join('; '));
  assert.equal(JSON.parse(await fs.readFile(path.join(result.directory, 'receipt.json'), 'utf8')).status, 'completed');
  assert.equal(await fs.readFile(options.sourcePath, 'utf8'), 'untouched source'); assert.equal(await fs.readFile(options.outputPath, 'utf8'), 'completed output');
  assert.ok(result.spools.every(spool => spool.status === 'sealed' && /^[0-9a-f]{64}$/.test(spool.sha256)));
});

test('same-count changed PCM produces actual unequal hashes and cannot validate', async t => {
  const { options, data } = await fixture(t); data.outputPcm[200] ^= 1;
  const result = await collectOperationEvidence(options);
  assert.notEqual(result.decodedEvidence.audio[0].pcmIdentity.sourceHash, result.decodedEvidence.audio[0].pcmIdentity.outputHash);
  assert.equal(validateEncodeOperationOutput(options.plan, options.outputProbe, { qualification, decodedEvidence: result.decodedEvidence }).valid, false);
});

test('every video timestamp is compared, so interior displacement is not hidden by count/boundaries', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac', overrides: { range: { startUs: 0, endUs: 400000 } } });
  data.outputFrames[0] = frames(options.outputProbe.streams[0], [0, 101, 200, 300]);
  data.outputFrames[1] = frames(options.outputProbe.streams[1], [0, 100, 200, 300], true);
  options.outputProbe.format.duration = '.4';
  const result = await collectOperationEvidence(options); assert.equal(result.decodedEvidence.video.maxRebasedTimestampErrorUs, 1000);
  assert.equal(result.decodedEvidence.video.firstOutputPtsUs, 0); assert.equal(result.decodedEvidence.video.lastOutputPtsUs, 300000);
  assert.equal(validateEncodeOperationOutput(options.plan, options.outputProbe, { qualification, decodedEvidence: result.decodedEvidence }).valid, false);
});

test('every video duration is compared even when frame count, timestamps and last duration agree', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac', overrides: { range: { startUs: 0, endUs: 400000 } } });
  data.outputFrames[0] = frames(options.outputProbe.streams[0], [0, 100, 200, 300]);
  data.outputFrames[0][2].duration = 1;
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_VIDEO_DURATION' });
});

async function gapFixture(t, mode = 'precision-flac') {
  const result = await fixture(t, { mode, overrides: { range: { startUs: 0, endUs: 500000 } }, mutateProbe(probe) {
    probe.format.duration = '0.5'; probe.streams[0].duration = '0.5'; probe.streams[0].duration_ts = 500;
    probe.streams[1].duration = '0.5'; probe.streams[1].duration_ts = 24000;
  } });
  const { options, data } = result;
  data.sourceFrames[0] = frames(options.sourceProbe.streams[0], [0, 100, 200, 300, 400]);
  data.outputFrames[0] = frames(options.outputProbe.streams[0], [0, 100, 200, 300, 400]);
  data.sourceFrames[2] = frames(options.sourceProbe.streams[1], [0, 9600, 19200], true);
  data.outputFrames[1] = frames(options.outputProbe.streams[1], [0, 200, 400], true);
  options.outputProbe.format.duration = '0.5';
  data.sourcePcm = Buffer.alloc(14400 * 4, 17); data.outputPcm = Buffer.from(data.sourcePcm);
  return result;
}

test('relocated interior FLAC gap fails despite identical ordered PCM, counts and endpoints', async t => {
  const { options, data } = await gapFixture(t);
  data.outputFrames[1][1].pts = 100;
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_AUDIO_TIMELINE' });
});

test('preserved FLAC gaps pass when the decoder splits frames differently', async t => {
  const { options, data } = await gapFixture(t);
  data.outputFrames[1] = frames(options.outputProbe.streams[1], [0, 50, 200, 250, 400, 450], true).map(row => ({ ...row, nb_samples: 2400 }));
  const result = await collectOperationEvidence(options);
  assert.equal(result.timelineComparisons.audio[0].maximumElapsedClockErrorUs, 0);
  assert.equal(result.timelineComparisons.audio[0].selectedSourceGaps, 2);
  assert.equal(result.decodedEvidence.audio[0].pcmIdentity.sourceHash, result.decodedEvidence.audio[0].pcmIdentity.outputHash);
  assert.equal(validateEncodeOperationOutput(options.plan, options.outputProbe, { qualification, decodedEvidence: result.decodedEvidence }).valid, true);
});

test('discontinuous AAC source is explicitly unqualified, not flattened or aligned by a guessed delay', async t => {
  const { options } = await gapFixture(t, 'precision-aac');
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_AAC_GAPS_UNQUALIFIED' });
});

test('audio uses common requested origin, never first-frame alignment that hides a shifted track', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  options.timingQualification.audioTimelineUs = 1000;
  data.outputFrames[1].forEach(frame => { frame.pts += 20; });
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_AUDIO_TIMELINE' });
});

test('interior clock qualification is explicit, runtime-bound and independent from endpoint tolerance', async t => {
  for (const change of [options => delete options.timingQualification, options => { options.timingQualification.runtimeIdentity = 'b'.repeat(64); },
    options => { options.timingQualification.audioTimelineUs = -1; }, options => { options.timingQualification.aac = null; }]) {
    const { options } = await fixture(t, { mode: 'precision-aac' }); change(options);
    await assert.rejects(collectOperationEvidence(options));
  }
});

test('AAC padding mismatch cannot be inferred away from similar decoded counts', async t => {
  const { options } = await fixture(t, { mode: 'precision-aac' }); options.outputProbe.streams[1].initial_padding = 1024;
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_AAC_ALIGNMENT' });
});

for (const kind of ['missing', 'extra']) test(`different video membership is rejected (${kind}) and evidence stays retained`, async t => {
  const { options, data } = await fixture(t);
  if (kind === 'missing') data.outputFrames[0].pop(); else data.outputFrames[0].push({ ...data.outputFrames[0][1], pts: 200 });
  let error; await assert.rejects(collectOperationEvidence(options), failure => { error = failure; return failure.code === 'OPERATION_EVIDENCE_MEMBERSHIP'; });
  const report = JSON.parse(await fs.readFile(path.join(error.evidenceDirectory, 'receipt.json'), 'utf8')); assert.equal(report.status, 'failed');
  assert.ok((await fs.readdir(error.evidenceDirectory)).includes('selected-video.jsonl'));
});

test('AAC derives packet/stream padding without inventing a lossless content claim', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  data.packetRows = ['packet|stream_index=1|side_data|side_data_type=Skip Samples|skip_samples=1024|discard_padding=12\n\n'];
  options.outputProbe.streams[1].initial_padding = 1024;
  options.timingQualification.aac.encoderDelaySamples = 1024; options.timingQualification.aac.discardPaddingSamples = 12;
  const result = await collectOperationEvidence(options), audio = result.decodedEvidence.audio[0];
  assert.equal(audio.encoderDelaySamples, 1024); assert.equal(audio.discardPaddingSamples, 12); assert.equal(own(audio, 'pcmIdentity'), false);
  assert.equal(data.calls.length, 5);
});

test('pinned FFprobe side_datum/skip_samples grammar derives exactly the qualified AAC padding', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  // Actual bounded parent capture packet-grammar-f7312400-b30e-4647-9293-2836acb55edd.json.
  data.packetRows = ['packet|stream_index=1|side_datum/skip_samples:side_data_type=Skip Samples|side_datum/skip_samples:skip_samples=1024|side_datum/skip_samples:discard_padding=0\n',
    'packet|stream_index=1\n'];
  options.outputProbe.streams[1].initial_padding = 1024; options.timingQualification.aac.encoderDelaySamples = 1024;
  const result = await collectOperationEvidence(options);
  assert.equal(result.decodedEvidence.audio[0].encoderDelaySamples, 1024); assert.equal(result.decodedEvidence.audio[0].discardPaddingSamples, 0);
});

test('compact packet canonicalization rejects unknown paths, mixed duplicate fields and unrelated structures', () => {
  const fields = ['stream_index', 'side_data_type', 'skip_samples', 'discard_padding'];
  for (const text of ['packet|stream_index=1|side_datum/other:skip_samples=1024',
    'packet|stream_index=1|side_datum/skip_samples:unknown=0',
    'packet|stream_index=1|skip_samples=0|side_datum/skip_samples:skip_samples=1024',
    'packet|stream_index=1|side_datum/skip_samples:side_data_type=Skip Samples|side_datum/skip_samples:side_data_type=Skip Samples',
    'packet|stream_index=1|other_structure']) assert.throws(() => compactRow(text, 'packet', fields));
  assert.throws(() => compactRow('frame|side_datum/skip_samples:skip_samples=1', 'frame', fields));
});

test('unknown packet side-data type cannot disappear into a zero-padding result', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  data.packetRows = ['packet|stream_index=1|side_data_type=Unknown\n'];
  await assert.rejects(collectOperationEvidence(options), /Incomplete\/unknown packet padding evidence/);
});

test('wrapped streaming-parser failure retains bounded cause and offending row in both receipts', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  data.packetRows = ['packet|stream_index=1|side_datum/other:skip_samples=1024\n'];
  const originalRun = options.run;
  options.run = async (...args) => { try { return await originalRun(...args); } catch (cause) {
    throw new ToolError('STDOUT_SINK_FAILED', 'Binary output consumer failed.', { cause, stderr: '', stderrCapture: { totalBytes: 0, truncated: false } });
  } };
  let error;
  await assert.rejects(collectOperationEvidence(options), caught => { error = caught; return caught.code === 'STDOUT_SINK_FAILED'; });
  const final = JSON.parse(await fs.readFile(path.join(error.evidenceDirectory, 'receipt.json'), 'utf8'));
  const child = JSON.parse(await fs.readFile(path.join(error.evidenceDirectory, 'child-5.json'), 'utf8'));
  assert.equal(final.failure.cause.code, 'OPERATION_EVIDENCE_INVALID');
  assert.match(final.failure.cause.message, /Unknown, escaped or repeated/);
  assert.equal(final.failure.cause.evidenceRow.prefix, data.packetRows[0].trim());
  assert.deepEqual(child.cause, final.failure.cause);
  const huge = new Error('z'.repeat(20000)); huge.cause = huge;
  const bounded = evidenceFailure(huge); assert.equal(bounded.message.length, 2000); assert.equal(bounded.cause.causeTruncated, true);
  assert.ok(JSON.stringify(bounded).length < 5000);
});
const own = (object, key) => Object.hasOwn(object, key);

test('conflicting padding cannot become an arbitrary maximum or zero', async t => {
  const { options, data } = await fixture(t, { mode: 'precision-aac' });
  data.packetRows = ['packet|stream_index=1|side_data|side_data_type=Skip Samples|skip_samples=1024|discard_padding=0\n'];
  options.outputProbe.streams[1].initial_padding = 2112;
  await assert.rejects(collectOperationEvidence(options), /padding disagree/);
});

test('missing duration, variable decoded color and unknown timestamps never become guessed evidence', async t => {
  for (const change of [row => delete row.duration, row => { row.color_transfer = 'unknown'; }, row => { row.pts = 'N/A'; }]) {
    const { options, data } = await fixture(t); change(data.sourceFrames[0][0]); await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_INVALID' });
  }
});

test('runner must prove drained exact binary streaming instead of silently ignoring sink options', async t => {
  for (const capture of [{ totalBytes: 1, streamed: true, truncated: false }, { totalBytes: 100, streamed: true, truncated: true }, { totalBytes: 100, truncated: false }]) {
    const { options, data } = await fixture(t); data.capture = capture; await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_RUNNER' });
  }
});

test('decode stderr and truncated line input cannot be accepted with exit zero', async t => {
  const first = await fixture(t); first.data.stderr = 'corrupt packet'; await assert.rejects(collectOperationEvidence(first.options), { code: 'OPERATION_EVIDENCE_DECODE' });
  const second = await fixture(t); second.data.transform = ({ bytes }) => bytes.subarray(0, bytes.length - 1);
  await assert.rejects(collectOperationEvidence(second.options), /truncated evidence/);
});

test('missing or contradictory stderr capture accounting is not complete diagnostics', async t => {
  for (const capture of [undefined, { totalBytes: 1, truncated: false }, { totalBytes: 0 }, { totalBytes: -1, truncated: false }]) {
    const { options } = await fixture(t), realMock = options.run;
    options.run = async (...args) => ({ ...await realMock(...args), stderrCapture: capture });
    await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_DECODE' });
  }
});

test('explicit cost budget, byte/record/spool limits and source/output distinction are mandatory', async t => {
  for (const [key, value] of [['sourceDecode', 'telemetry'], ['maxFrameBytes', 10], ['maxRecords', 1], ['maxSpoolBytes', 5], ['maxPcmBytes', 10]]) {
    const { options } = await fixture(t); options.budget[key] = value; await assert.rejects(collectOperationEvidence(options));
  }
  const { options } = await fixture(t); options.outputPath = options.sourcePath;
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_PATH' });
});

test('cancellation preserves the partial spool and never manufactures a completed receipt', async t => {
  const { options, data } = await fixture(t), controller = new AbortController(); options.signal = controller.signal;
  data.transform = ({ bytes }) => { controller.abort(); return bytes; };
  let error; await assert.rejects(collectOperationEvidence(options), failure => { error = failure; return failure.code === 'CANCELLED'; });
  const receipt = JSON.parse(await fs.readFile(path.join(error.evidenceDirectory, 'receipt.json'), 'utf8')); assert.equal(receipt.status, 'cancelled');
  assert.equal(data.calls.length, 1); assert.equal(await fs.readFile(options.outputPath, 'utf8'), 'completed output');
});

test('source/output mutation during collection is detected without deleting either file', async t => {
  const { options, data } = await fixture(t); let changed = false;
  data.transform = async ({ bytes }) => { if (!changed) { changed = true; await fs.appendFile(options.sourcePath, ' changed'); } return bytes; };
  await assert.rejects(collectOperationEvidence(options), { code: 'OPERATION_EVIDENCE_CHANGED' });
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), 'completed output');
});

test('selected PCM slicing stays exact when runner chunks split samples and stream blocks', async t => {
  const { options, data } = await fixture(t); const result = await collectOperationEvidence(options);
  assert.equal(result.decodedEvidence.audio[0].pcmIdentity.sourceHash, require('node:crypto').createHash('sha256').update(data.sourcePcm.subarray(19200, 57600)).digest('hex'));
});

test('44.1 kHz noninteger boundaries select samples by rational PTS rather than rounded microseconds', async t => {
  const { options, data } = await fixture(t, { overrides: { range: { startUs: 100001, endUs: 300001 } },
    mutateProbe(probe) { Object.assign(probe.streams[1], { sample_rate: '44100', time_base: '1/44100', duration_ts: 17640 }); } });
  data.sourceFrames[2] = frames(options.sourceProbe.streams[1], [0, 4410, 8820, 13230], true).map(row => ({ ...row, nb_samples: 4410 }));
  data.outputFrames[1] = frames(options.outputProbe.streams[1], [0, 100], true).map(row => ({ ...row, nb_samples: 4410 }));
  data.sourcePcm = Buffer.alloc(17640 * 4); for (let i = 0; i < data.sourcePcm.length; i++) data.sourcePcm[i] = (i * 17 + Math.floor(i / 256)) % 256;
  data.outputPcm = Buffer.from(data.sourcePcm.subarray(4411 * 4, 13231 * 4));
  options.timingQualification.audioTimelineUs = 23; // One44.1k sample; independent of the endpoint allowance.
  const result = await collectOperationEvidence(options), audio = result.decodedEvidence.audio[0];
  assert.equal(audio.sourceSampleCount, 8820); assert.equal(audio.firstSourcePtsUs, 100023); assert.equal(audio.lastSourceEndUs, 300023);
  assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
});

test('ctime-only collector observation defers to main policy, while stronger identity changes do not', () => {
  const before = { dev: 1n, ino: 2n, size: 100n, mtimeNs: 30n, ctimeNs: 40n, birthtimeNs: 10n, nlink: 1n };
  assert.equal(sourceChange(before, { ...before }), 'unchanged');
  assert.equal(sourceChange(before, { ...before, ctimeNs: 41n }), 'ctime-only');
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'birthtimeNs', 'nlink']) assert.equal(sourceChange(before, { ...before, [key]: before[key] + 1n, ctimeNs: 41n }), 'changed');
});

test('compact parser rejects duplicate/escaped/unrequested fields and bounds split streaming rows', async () => {
  for (const text of ['frame|pts=1|pts=2', 'frame|pts=1|filename=private', 'frame|pts=\\n', 'packet|pts=1']) {
    assert.throws(() => compactRow(text, 'frame', ['pts']));
  }
  const lines = [], sink = lineSink(async line => lines.push(line), { maxBytes: 100000, maxRecords: 1000 });
  for (let i = 0; i < 1000; i++) await sink.push(Buffer.from('frame|pts=' + i + '\n'));
  assert.equal(sink.finish().records, 1000); assert.equal(lines.length, 1000);
  const oversized = lineSink(async () => {}, { maxBytes: 100000, maxRecords: 2 });
  await assert.rejects(oversized.push(Buffer.from('x'.repeat(8193))), { code: 'OPERATION_EVIDENCE_LIMIT' });
});
