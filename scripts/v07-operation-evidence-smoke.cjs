'use strict';

// Parent-run only. Decode already-owned retained outputs; never encode, remux,
// alter old receipts, touch personal media, or acquire the benchmark's budget.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');
const { buildEncodeOperation, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { collectOperationEvidence, compareAudioTimelines, evidenceFailure } = require('../src/operation-evidence.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const ORIGINAL_ID = '01349687-ff85-4606-b3be-b2baec87d06b';
const TELEMETRY_ID = '62351ecc-934b-4a3d-8c43-713e87720c31';
const ORIGINAL = path.join(ROOT, 'artifacts/v0.7/encode-operation', ORIGINAL_ID, 'report.json');
const TELEMETRY = path.join(ROOT, 'artifacts/v0.7/telemetry', TELEMETRY_ID, 'report.json');
const AAC = path.join(ROOT, 'artifacts/v0.7/encode-operation/rechecks/2026-10-11T06-19-06-102Z-b3a0c54e-e591-432f-972a-6f532e897b4b-aac.json');
const FLAC = path.join(ROOT, 'artifacts/v0.7/encode-operation/rechecks/2026-10-11T06-14-47-857Z-ba92148d-bfbe-49c3-8a53-efc53d50458a.json');
const SOURCE = path.join(OWNED, 'fixtures', `encode-operation-${ORIGINAL_ID}`, 'vfr-offset-multitrack.mov');
const BIN = path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin');
const TOOLS = { ffmpeg: path.join(BIN, 'ffmpeg.exe'), ffprobe: path.join(BIN, 'ffprobe.exe') };
const PINS = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0', ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const MODULES = ['src/operation-evidence.cjs', 'src/encode-operation.cjs', 'src/operation-contract.cjs', 'src/inspection.cjs',
  'src/media.cjs', 'src/process-runner.cjs', 'scripts/v07-operation-evidence-smoke.cjs'];
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 16 * 1024 * 1024,
  maxPcmBytes: 32 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 8 * 1024 * 1024 });
const allowed = new Set([ORIGINAL, TELEMETRY, AAC, FLAC, SOURCE, ...Object.values(TOOLS), ...MODULES.map(file => path.join(ROOT, file))]);
const media = new Set([SOURCE]), controller = new AbortController(), children = new Set();
let report, reportFile, stage, lease, leaseIdentity;
const stamp = stat => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].map(key => [key, String(stat[key])]));
const same = (a, b) => a.dev !== 0n && a.ino !== 0n && ['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].every(key => a[key] === b[key]);
const inside = (root, file) => { const rel = path.relative(root, file); return Boolean(rel) && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };
const failure = error => ({ ...evidenceFailure(error),
  ...(error.stderr ? { stderr: error.stderr, stderrCapture: error.stderrCapture } : {}), ...(error.evidenceDirectory ? { evidenceDirectory: error.evidenceDirectory } : {}) });
async function save() {
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 32 * 1024 * 1024, 'Bounded report');
  const temporary = reportFile + '.' + randomUUID() + '.tmp'; const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, reportFile);
}
async function receipt(file) {
  assert.ok(allowed.has(file), 'Explicit evidence read scope'); const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 256n * 1024n ** 2n);
  const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })), 'Retained evidence handle binding');
    for (let position = 0; position < Number(before.size);) {
      if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      const read = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - position), position);
      assert.ok(read.bytesRead); hash.update(buffer.subarray(0, read.bytesRead)); position += read.bytesRead;
    }
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await fs.lstat(file, { bigint: true })), 'Retained evidence changed during read');
    return { path: file, bytes: Number(before.size), sha256: hash.digest('hex'), identity: stamp(before) };
  } finally { await handle.close(); }
}
async function acquire() {
  lease = await fs.open(LEASE, 'wx+');
  await lease.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid, purpose: 'operation-evidence-smoke-no-encodes', startedAt: report.startedAt }));
  await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
}
async function release() {
  if (!lease) return;
  try {
    assert.equal(children.size, 0, 'Every owned child must close before lease release');
    const named = await fs.lstat(LEASE, { bigint: true }), held = await lease.stat({ bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size < 8192n && same(named, held) && same(named, leaseIdentity));
    const bytes = Buffer.alloc(Number(named.size)); const read = await lease.read(bytes, 0, bytes.length, 0), record = JSON.parse(bytes);
    assert.equal(read.bytesRead, bytes.length); assert.equal(record.token, report.id); assert.equal(record.pid, process.pid);
    await lease.close(); lease = null;
    assert.ok(same(named, await fs.lstat(LEASE, { bigint: true })), 'Lease changed after handle close'); await fs.unlink(LEASE); report.leaseReleased = true;
  } catch (error) { report.leaseRetained = error.message; }
  finally { await lease?.close().catch(() => {}); lease = null; }
}
async function run(executable, argv, requested = {}) {
  assert.ok(Object.values(TOOLS).includes(executable)); assert.equal(children.size, 0, 'Sequential media evidence only');
  assert.ok(report.invocations.length < report.bounds.maxChildren && !argv.includes('-y'), 'Child count/no-overwrite bound');
  const version = argv.length === 1 && argv[0] === '-version';
  if (!version) {
    assert.ok(argv.includes('-i') && media.has(argv[argv.indexOf('-i') + 1]), 'Only known owned source/output input');
    if (executable === TOOLS.ffmpeg) {
      assert.equal(argv.at(-1), 'pipe:1'); assert.ok(['s16le', 's32le'].includes(argv[argv.indexOf('-f') + 1]));
      assert.ok(['pcm_s16le', 'pcm_s32le'].includes(argv[argv.indexOf('-c:a') + 1]));
      assert.ok(!argv.includes('-c:v') && !argv.includes('-filter:v') && !argv.includes('-filter:a'), 'Decode PCM only; no media output or transformation');
    }
  }
  const item = { executable, argv, status: 'running', startedAt: new Date().toISOString() }; report.invocations.push(item); await save();
  const started = process.hrtime.bigint();
  try {
    const result = await runTool(executable, argv, { ...requested, signal: controller.signal,
      timeoutMs: Math.min(requested.timeoutMs || 30000, 120000), stdoutLimit: Math.min(requested.stdoutLimit || 1048576, 32 * 1024 * 1024),
      stderrLimit: 256 * 1024, onChild: child => { children.add(child); item.pid = child.pid;
        report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size); child.once('close', (code, signal) => { children.delete(child); item.closed = { code, signal }; }); } });
    Object.assign(item, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture,
      ...(result.stdoutCapture ? { stdoutCapture: result.stdoutCapture } : {}), ...(requested.onStdoutChunk ? {} : { stdout: result.stdout }) }); return result;
  } catch (error) { item.status = 'failed'; item.failure = failure(error); throw error; }
  finally { item.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6; item.finishedAt = new Date().toISOString(); await save(); }
}
function retainedContract({ original, saved, aac, flac, originalSha256 }) {
  assert.equal(saved.schema, 1); assert.equal(saved.status, 'passed'); assert.equal(saved.id, TELEMETRY_ID);
  assert.equal(aac.schema, 1); assert.equal(aac.id, 'b3a0c54e-e591-432f-972a-6f532e897b4b');
  assert.equal(aac.kind, 'read-only-retained-AAC-calibration-and-held-out-recheck');
  assert.equal(aac.status, 'passed-retained-AAC-evidence-recheck'); assert.equal(aac.runtimeIdentity, RUNTIME);
  assert.equal(flac.schema, 1); assert.equal(flac.id, 'ba92148d-bfbe-49c3-8a53-efc53d50458a');
  assert.equal(flac.kind, 'read-only-retained-FLAC-evidence-recheck');
  assert.equal(flac.status, 'passed-retained-evidence-recheck'); assert.equal(flac.runtimeIdentity, RUNTIME);
  assert.equal(flac.validation.valid, true);
  for (const report of [saved, aac, flac]) {
    assert.equal(report.originalReport.path, ORIGINAL); assert.equal(report.originalReport.sha256, originalSha256);
  }
  assert.deepEqual(aac.cases.map(item => item.id), ['aac-calibration-delayed', 'aac-held-out-late-vfr']);
  assert.ok(aac.cases.every(item => item.status === 'passed' && item.validation.valid === true));
  assert.deepEqual(aac.cases[0].correctedMeasurement.qualification.tolerances, aac.cases[1].correctedMeasurement.qualification.tolerances,
    'Held-out AAC must reuse the unchanged calibration envelope');
  assert.deepEqual(saved.cases.map(item => item.id), ['aac-held-out-late-vfr', 'flac-held-out-late-vfr']);
  assert.equal(saved.invocations.length, 6); assert.ok(saved.invocations.every(call => call.status === 'completed' && call.exitCode === 0));
  assert.equal(original.artifacts[SOURCE].sha256, saved.sourceBefore.sha256); assert.equal(saved.sourceBefore.path, SOURCE);
  const plans = [];
  for (const retained of saved.cases) {
    assert.equal(retained.status, 'passed');
    const outputPath = retained.output.path; assert.equal(outputPath, retained.stage.file);
    assert.ok(inside(path.join(OWNED, 'outputs', `telemetry-${TELEMETRY_ID}`), outputPath));
    assert.match(retained.output.sha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(retained.output.bytes) && retained.output.bytes > 0);
    const previous = original.cases.find(entry => entry.id === retained.id); assert.ok(previous);
    const markers = retained.plan.args.filter(value => value.startsWith('FFMPEG_ENCODER_OUTPUT_ID=')); assert.equal(markers.length, 1);
    const outputId = markers[0].split('=')[1]; assert.match(outputId, /^[a-f0-9-]{36}$/);
    const plan = buildEncodeOperation({ input: SOURCE, output: outputPath, settings: previous.settings,
      inspection: original.sourceEvidence.timeline.inspection, request: retained.plan.contract.request, outputId, runtimeIdentity: RUNTIME });
    assert.deepEqual(plan.args, retained.plan.args); assert.equal(plan.planFingerprint, retained.plan.planFingerprint);
    const encoded = saved.invocations.find(call => call.executable === TOOLS.ffmpeg && call.argv.at(-1) === outputPath); assert.ok(encoded);
    const executedArgs = [...plan.args.slice(0, -1), ...retained.telemetry.ffmpegArgs, plan.args.at(-1)];
    assert.deepEqual(encoded.argv, executedArgs); assert.deepEqual(retained.executedArgs, executedArgs);
    const decode = saved.invocations.find(call => call.executable === TOOLS.ffprobe && call.argv.at(-1) === outputPath); assert.ok(decode);
    assert.deepEqual(JSON.parse(decode.stdout), retained.outputDecodedProbe);
    const qualification = retained.id.startsWith('aac') ? aac.cases.find(item => item.id === retained.id).correctedMeasurement.qualification : flac.unchangedQualification;
    assert.equal(qualification.runtimeIdentity, RUNTIME); assert.equal(qualification.containerDuration, 'end-timestamp');
    assert.deepEqual(Object.keys(qualification.tolerances).sort(), ['audioTimestampUs', 'avSyncUs', 'durationUs', 'sampleCount', 'videoTimestampUs']);
    assert.ok(Object.values(qualification.tolerances).every(value => Number.isSafeInteger(value) && value >= 0));
    plans.push({ id: retained.id, plan, qualification: structuredClone(qualification) });
  }
  return plans;
}

// Retained JSON only. Freeze the interior clock contract using calibration;
// never derive it from the held-out results or the much larger AAC end padding
// allowance. Exact integer PTS survives the old oracle's rounded-PTS mistake.
const rat = value => { const [n, d] = value.split('/').map(BigInt); assert.ok(d > 0n); return { n, d }; };
const rational = value => ({ n: BigInt(value.numerator), d: BigInt(value.denominator) });
const plus = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const minus = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const scaled = (a, n) => ({ n: a.n * n, d: a.d });
const ceil = (n, d) => n / d + (n % d > 0n ? 1n : 0n);
const compare = (a, b) => a.n * b.d - b.n * a.d;
const absUs = a => Number(ceil((a.n < 0n ? -a.n : a.n) * 1000000n, a.d));
const packed = a => ({ n: String(a.n), d: String(a.d) });
function exactPts(frame, stream) {
  assert.ok(Number.isSafeInteger(frame.pts), 'Retained integer PTS is required; never use rounded pts_time');
  return scaled(rat(stream.time_base), BigInt(frame.pts));
}
function frameDuration(frame, stream) {
  if (Number.isSafeInteger(frame.duration) && frame.duration > 0) return scaled(rat(stream.time_base), BigInt(frame.duration));
  assert.match(frame.duration_time, /^\d+\.\d{6}$/);
  return { n: BigInt(frame.duration_time.replace('.', '')), d: 1000000n };
}
function audioRows(frames, stream, range) {
  const rows = [], rate = BigInt(stream.sample_rate); let offset = 0n, lastEnd, gaps = 0;
  for (const frame of frames) {
    assert.ok(Number.isSafeInteger(frame.nb_samples) && frame.nb_samples > 0);
    const count = BigInt(frame.nb_samples), time = exactPts(frame, stream);
    const clamp = x => x < 0n ? 0n : x > count ? count : x;
    const a = range ? minus(range.start, time) : null, b = range ? minus(range.end, time) : null;
    const first = a ? clamp(ceil(a.n * rate, a.d)) : 0n, end = b ? clamp(ceil(b.n * rate, b.d)) : count;
    if (end <= first) continue;
    const selectedTime = plus(time, { n: first, d: rate });
    if (lastEnd && compare(minus(selectedTime, lastEnd), rat(stream.time_base)) > 0n) gaps++;
    rows.push({ offset: String(offset), samples: String(end - first), time: packed(selectedTime) });
    offset += end - first; lastEnd = plus(time, { n: end, d: rate });
  }
  assert.ok(rows.length && offset > 0n); return { rows, samples: Number(offset), gaps };
}
async function* rowIterator(rows) { yield* rows; }
async function retainedTimelines(original, frames, outputProbe, rangeContract, qualification) {
  const sourceProbe = original.sourceEvidence.timeline.inspection.probe;
  const range = { start: rational(rangeContract.absoluteStart), end: rational(rangeContract.absoluteEnd) };
  const sv = sourceProbe.streams.find(stream => stream.codec_type === 'video'), ov = outputProbe.streams.find(stream => stream.codec_type === 'video');
  const sourceVideo = original.sourceEvidence.timeline.videos.filter(frame => compare(exactPts(frame, sv), range.start) >= 0n && compare(exactPts(frame, sv), range.end) < 0n);
  const outputVideo = frames.filter(frame => frame.media_type === 'video' && frame.stream_index === ov.index);
  assert.equal(outputVideo.length, sourceVideo.length);
  let maximumDurationErrorUs = 0;
  for (let i = 0; i < sourceVideo.length; i++) maximumDurationErrorUs = Math.max(maximumDurationErrorUs,
    absUs(minus(frameDuration(outputVideo[i], ov), frameDuration(sourceVideo[i], sv))));
  assert.ok(maximumDurationErrorUs <= qualification.videoDurationUs, 'Every retained video duration must satisfy the frozen representation bound');
  const audio = [];
  for (const source of original.sourceEvidence.timeline.audio) {
    const os = outputProbe.streams.find(stream => stream.index === source.stream.index); assert.equal(os.sample_rate, source.stream.sample_rate);
    const selected = audioRows(source.frames, source.stream, range);
    const decoded = audioRows(frames.filter(frame => frame.media_type === 'audio' && frame.stream_index === os.index), os);
    if (os.codec_name === 'aac') assert.equal(selected.gaps, 0, 'Only continuous selected AAC input is qualified');
    const compared = await compareAudioTimelines({ sourceRows: rowIterator(selected.rows), outputRows: rowIterator(decoded.rows),
      sampleRate: Number(os.sample_rate), sourceOrigin: range.start, toleranceUs: qualification.audioTimelineUs });
    assert.equal(compared.comparedSamples, Math.min(selected.samples, decoded.samples));
    audio.push({ inputIndex: source.stream.index, sourceSamples: selected.samples, outputSamples: decoded.samples, ...compared });
  }
  return { video: { comparedFrames: sourceVideo.length, maximumDurationErrorUs }, audio };
}
async function calibrateInteriorClock(original, aac) {
  const calibration = original.cases.find(item => item.id === 'aac-calibration-delayed');
  const corrected = aac.cases.find(item => item.id === calibration.id); assert.equal(corrected.status, 'passed');
  const sourceProbe = original.sourceEvidence.timeline.inspection.probe, outputProbe = calibration.observations.outputProbe;
  const sv = sourceProbe.streams.find(stream => stream.codec_type === 'video'), ov = outputProbe.streams.find(stream => stream.codec_type === 'video');
  // A duration is recorded at both time bases. The old report exposes decimal
  // durations to microsecond precision, so retain one additional microsecond.
  const videoDurationUs = absUs(plus(plus(rat(sv.time_base), rat(ov.time_base)), { n: 1n, d: 1000000n }));
  const quantization = sourceProbe.streams.filter(stream => stream.codec_type === 'audio').map(stream => {
    const out = outputProbe.streams.find(item => item.index === stream.index);
    // A conservative source clock tick + one audio sample (asettb and common
    // origin quantization combined) + one container tick. This is not an AAC
    // frame/padding allowance and cannot expand using held-out observations.
    const boundUs = absUs(plus(plus(rat(stream.time_base), { n: 1n, d: BigInt(stream.sample_rate) }), rat(out.time_base)));
    const signal = corrected.correctedAudio.find(item => item.inputIndex === stream.index).signal;
    assert.equal(signal.valid, true); assert.ok(signal.channels.length === stream.channels && signal.channels.every(channel => channel.lagSamples === 0));
    assert.equal(out.initial_padding, 1024); assert.equal(Number(out.trailing_padding || 0), 0);
    const packets = calibration.observations.packets.filter(packet => packet.stream_index === out.index)
      .flatMap(packet => packet.side_data_list || []).filter(side => side.side_data_type === 'Skip Samples');
    assert.equal(packets.reduce((total, side) => total + side.skip_samples, 0), 1024);
    assert.equal(packets.reduce((total, side) => total + side.discard_padding, 0), 0);
    return { inputIndex: stream.index, sampleRate: Number(stream.sample_rate), sourceTimeBase: stream.time_base, outputTimeBase: out.time_base, boundUs,
      decodedSignalLagSamples: signal.channels.map(channel => channel.lagSamples), signalledSkip: 1024 };
  });
  const qualification = { evidenceId: '01349687:b3a0c54e:calibrated-interior-clock-v1', runtimeIdentity: RUNTIME,
    videoDurationUs, audioTimelineUs: Math.max(...quantization.map(item => item.boundUs)),
    aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } };
  const measurements = await retainedTimelines(original, calibration.observations.rawDecodedFrames, outputProbe, calibration.plan.contract.range, qualification);
  return { qualification, calibrationId: calibration.id, quantization, measurements,
    rationale: 'Exact rational sample ordinals use the common requested origin, with no fitted offset. Continuous AAC decoder alignment is supported by signalled 1024-sample skip plus retained independent zero-lag signal checks; sample-count excess is not used to infer padding. Video compares every selected duration. Bounds derive only from calibration time bases, origin quantization and saved decimal resolution.',
    limitations: ['Only the paired runtime and these SDR Matroska 48k stereo/44.1k mono cells are investigated.',
      'Discontinuous AAC is refused until separately qualified. FLAC requires identical selected PCM in addition to timing.',
      'Interior timing does not prove lossy waveform identity; retained signal checks only qualify initial decoder alignment.',
      'Existing endpoint/count tolerances remain unchanged. No global quality or arbitrary-input capability is granted.'] };
}

async function main() {
  if (process.argv.length === 3 && ['--check-retained-contract', '--recheck-retained-timelines'].includes(process.argv[2])) {
    // Read only the four known small JSON reports. No source/output/runtime
    // media IO, filesystem writes, lease, or child process is involved.
    const buffers = await Promise.all([ORIGINAL, TELEMETRY, AAC, FLAC].map(async file => {
      const stat = await fs.stat(file); assert.ok(stat.isFile() && stat.size < 16 * 1024 * 1024); return fs.readFile(file);
    }));
    const [original, saved, aac, flac] = buffers.map(bytes => JSON.parse(bytes));
    const plans = retainedContract({ original, saved, aac, flac, originalSha256: createHash('sha256').update(buffers[0]).digest('hex') });
    const calibration = await calibrateInteriorClock(original, aac);
    const heldOut = [];
    for (const item of saved.cases) heldOut.push({ id: item.id,
      comparisons: await retainedTimelines(original, item.outputDecodedProbe.frames, item.outputDecodedProbe, item.plan.contract.range, calibration.qualification) });
    const result = { schema: 1, status: 'retained-contract-and-interior-timelines-checked', writes: 0, children: 0,
      retainedReports: [ORIGINAL, TELEMETRY, AAC, FLAC].map((file, i) => ({ path: file, sha256: createHash('sha256').update(buffers[i]).digest('hex') })),
      calibration, heldOut, cases: plans.map(item => ({ id: item.id, planFingerprint: item.plan.planFingerprint, qualification: item.qualification })) };
    if (process.argv[2] === '--recheck-retained-timelines') {
      const directory = path.join(ROOT, 'artifacts/v0.7/operation-evidence/rechecks'); await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.json');
      result.modules = await Promise.all(['src/operation-evidence.cjs', 'scripts/v07-operation-evidence-smoke.cjs'].map(async module => ({ path: path.join(ROOT, module), sha256: createHash('sha256').update(await fs.readFile(path.join(ROOT, module))).digest('hex') })));
      result.writes = 1; result.savedAt = new Date().toISOString(); await fs.writeFile(file, JSON.stringify(result, null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ status: result.status, report: file, children: 0, calibration: calibration.measurements, heldOut }));
    } else console.log(JSON.stringify(result)); return;
  }
  const args = process.argv.slice(2);
  const caseId = args.length === 3 && args[1] === '--case' ? args[2] : null;
  if (caseId !== null) assert.ok(['aac-held-out-late-vfr', 'flac-held-out-late-vfr'].includes(caseId), 'Only the two retained cases are in scope');
  assert.deepEqual(args, caseId === null ? ['--parent-granted-media-slot'] : ['--parent-granted-media-slot', '--case', caseId], 'Parent slot required; no work is authorized without it.');
  const id = randomUUID(), reportDirectory = path.join(ROOT, 'artifacts/v0.7/operation-evidence', id);
  report = { schema: 1, id, startedAt: new Date().toISOString(), status: 'running', purpose: 'Streaming output collector qualification on retained two-second AAC/FLAC outputs',
    selectedCase: caseId,
    bounds: { cases: caseId ? 1 : 2, maxChildren: caseId ? (caseId.startsWith('aac') ? 11 : 15) : 26, maxConcurrentChildren: 1, maxWallSeconds: 600, forecastNewFBytes: 32 * 1024 * 1024,
      marginFBytes: 128 * 1024 * 1024, budget: BUDGET }, invocations: [], cases: [], maxConcurrentChildren: 0,
    limitations: ['No encoding, remuxing, benchmark, personal media or application launch.', 'Retained source is22seconds; retained outputs are2.074second SDR AAC/FLAC cases only.',
      'Collector uses full source/output decoding; this run does not qualify a telemetry optimization or arbitrary multi-hour responsiveness.',
      'Previously measured tolerances are reused verbatim; failures never widen them.', 'No service admission, capability or publication authority is granted.'] };
  await fs.mkdir(reportDirectory, { recursive: true }); reportFile = path.join(reportDirectory, 'report.json'); await save();
  const timer = setTimeout(() => controller.abort(), 600000); timer.unref();
  const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acquire(); report.freeSpace = {};
    for (const [label, directory] of [['D', ROOT], ['F', OWNED]]) { const stat = await fs.statfs(directory, { bigint: true }); report.freeSpace[label] = String(stat.bavail * stat.bsize); }
    assert.ok(BigInt(report.freeSpace.D) >= 25n * 1024n ** 3n && BigInt(report.freeSpace.F) >= 160n * 1024n ** 2n, 'Resource reserve plus forecast margin');
    stage = path.join(OWNED, 'staging', `operation-evidence-${id}`); await fs.mkdir(stage); report.stage = stage;
    report.modules = []; for (const file of MODULES) report.modules.push(await receipt(path.join(ROOT, file)));
    report.retainedReports = []; for (const file of [ORIGINAL, TELEMETRY, AAC, FLAC]) report.retainedReports.push(await receipt(file));
    const original = JSON.parse(await fs.readFile(ORIGINAL, 'utf8')), saved = JSON.parse(await fs.readFile(TELEMETRY, 'utf8')),
      aac = JSON.parse(await fs.readFile(AAC, 'utf8')), flac = JSON.parse(await fs.readFile(FLAC, 'utf8'));
    const retainedPlans = retainedContract({ original, saved, aac, flac, originalSha256: report.retainedReports[0].sha256 });
    report.interiorClockCalibration = await calibrateInteriorClock(original, aac);
    report.sourceBefore = await receipt(SOURCE); assert.equal(report.sourceBefore.sha256, original.artifacts[SOURCE].sha256);
    assert.equal(report.sourceBefore.sha256, saved.sourceBefore.sha256);
    report.runtime = {};
    for (const name of ['ffmpeg', 'ffprobe']) { const pinned = await receipt(TOOLS[name]); assert.equal(pinned.sha256, PINS[name]);
      const observed = await run(TOOLS[name], ['-version']); assert.match(observed.stdout, new RegExp(`${name} version 9\\.0\\.2`)); report.runtime[name] = { ...pinned, version: observed.stdout }; }
    assert.equal(createHash('sha256').update(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => ({ sizeBytes: report.runtime[name].bytes, sha256: report.runtime[name].sha256 })))).digest('hex'), RUNTIME);
    for (const retained of saved.cases.filter(item => caseId === null || item.id === caseId)) {
      assert.ok(['aac-held-out-late-vfr', 'flac-held-out-late-vfr'].includes(retained.id)); assert.equal(retained.status, 'passed');
      const expectedRoot = path.join(OWNED, 'outputs', `telemetry-${TELEMETRY_ID}`), outputPath = retained.output.path;
      assert.ok(inside(expectedRoot, outputPath) && outputPath === retained.stage.file); allowed.add(outputPath); media.add(outputPath);
      const item = { id: retained.id, status: 'running', outputBefore: await receipt(outputPath) }; report.cases.push(item);
      try {
        assert.equal(item.outputBefore.sha256, retained.output.sha256); assert.equal(item.outputBefore.bytes, retained.output.bytes);
        const previous = original.cases.find(entry => entry.id === retained.id); assert.ok(previous);
        const outputId = retained.plan.args.find(value => value.startsWith('FFMPEG_ENCODER_OUTPUT_ID=')).split('=')[1];
        const plan = buildEncodeOperation({ input: SOURCE, output: outputPath, settings: previous.settings,
          inspection: original.sourceEvidence.timeline.inspection, request: retained.plan.contract.request, outputId, runtimeIdentity: RUNTIME });
        assert.deepEqual(plan.args, retained.plan.args); assert.equal(plan.planFingerprint, retained.plan.planFingerprint);
        const encoded = saved.invocations.find(call => call.executable === TOOLS.ffmpeg && call.argv.at(-1) === outputPath);
        assert.equal(encoded.exitCode, 0); assert.equal(encoded.status, 'completed');
        assert.deepEqual(encoded.argv, [...plan.args.slice(0, -1), ...retained.telemetry.ffmpegArgs, plan.args.at(-1)]);
        const decode = saved.invocations.find(call => call.executable === TOOLS.ffprobe && call.argv.at(-1) === outputPath);
        assert.deepEqual(JSON.parse(decode.stdout), retained.outputDecodedProbe, 'Saved output observation belongs to its original invocation');
        item.plan = plan;
        item.qualification = retainedPlans.find(entry => entry.id === retained.id).qualification;
        assert.equal(item.qualification.runtimeIdentity, RUNTIME);
        item.outputProbe = await inspectMetadata(outputPath, { ffprobe: TOOLS.ffprobe, signal: controller.signal, run });
        item.collection = await collectOperationEvidence({ plan, sourceProbe: original.sourceEvidence.timeline.inspection.probe, outputProbe: item.outputProbe,
          sourcePath: SOURCE, outputPath, stageDirectory: stage, ffmpeg: TOOLS.ffmpeg, ffprobe: TOOLS.ffprobe, run, signal: controller.signal, budget: BUDGET,
          timingQualification: report.interiorClockCalibration.qualification });
        item.validation = validateEncodeOperationOutput(plan, item.outputProbe, { qualification: item.qualification, decodedEvidence: item.collection.decodedEvidence });
        assert.equal(item.validation.valid, true, item.validation.errors.join('; '));
        item.outputAfter = await receipt(outputPath); assert.deepEqual(item.outputAfter, item.outputBefore); item.status = 'passed';
      } catch (error) { item.status = 'failed'; item.failure = failure(error); if (error.evidenceReceipt) item.collection = error.evidenceReceipt; }
      finally { item.finishedAt = new Date().toISOString(); await save(); }
      if (controller.signal.aborted) break;
    }
    report.sourceAfter = await receipt(SOURCE); assert.deepEqual(report.sourceAfter, report.sourceBefore);
    for (const before of report.retainedReports) assert.deepEqual(await receipt(before.path), before, 'Historical reports remain unchanged');
    report.status = report.cases.length === report.bounds.cases && report.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { report.status = 'failed'; report.failure = failure(error); }
  finally { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await release(); report.finishedAt = new Date().toISOString(); await save(); }
  console.log(JSON.stringify({ report: reportFile, status: report.status, encodes: 0, children: report.invocations.length,
    cases: report.cases.map(({ id, status, failure, validation }) => ({ id, status, failure, validation })) }));
  if (report.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
