'use strict';

// Parent-run qualification, not a benchmark: unchanged ordinary Tested Default
// settings, one known owned fixture, and actual per-profile output validation.
// No app/service capability is enabled by this script. Failed evidence stays.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { PROFILES, describeRecipe, outputPixelFormat, selectVideo } = require('../src/media.cjs');
const { createStage, sealStage } = require('../src/outputs.cjs');
const { generationDescriptionOf, classifyMarker } = require('../src/provenance.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { collectOperationEvidence, evidenceFailure } = require('../src/operation-evidence.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const ORIGINAL = path.join(ROOT, 'artifacts/v0.7/encode-operation/01349687-ff85-4606-b3be-b2baec87d06b/report.json');
const CALIBRATION = path.join(ROOT, 'artifacts/v0.7/operation-evidence/rechecks/2026-10-11T07-21-37.056Z-5253e225-7644-46ce-b27f-471109c5c23c.json');
const AAC = path.join(ROOT, 'artifacts/v0.7/operation-evidence/4df34e92-9905-491a-95cd-0263a9e3018c/report.json');
const FLAC = path.join(ROOT, 'artifacts/v0.7/operation-evidence/7583094b-67b9-4e11-b85c-a5b4e011060b/report.json');
const SOURCE = path.join(OWNED, 'fixtures/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/vfr-offset-multitrack.mov');
const BIN = path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin');
const TOOLS = { ffmpeg: path.join(BIN, 'ffmpeg.exe'), ffprobe: path.join(BIN, 'ffprobe.exe') };
const PINS = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0', ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const SOURCE_SHA = 'db3532f3977964d37cc4edcff21db0f1040b23465e514daf2d6542dcb08c4dc8';
const ORIGINAL_SHA = '4942eaaf410e73ab31a96a534fd91f20d3b704d1ad449bd1184d6e0400f2c3b0';
const RETAINED_PROFILE_ID = '9c10a4a8-5c79-4841-abd1-647dc69c2d84';
const RETAINED_PROFILE_REPORT = path.join(ROOT, 'artifacts/v0.7/operation-profiles', RETAINED_PROFILE_ID, 'report.json');
const RETAINED_PROFILE_SHA = 'd72ed2a80b928e1903a55411dd3d67ab0cf36e2775512ba835c334c59befd169';
const RETAINED_OUTPUT = path.join(OWNED, 'outputs', `operation-profiles-${RETAINED_PROFILE_ID}`, '.ffmpeg-encoder-C6538F/encoded.mkv');
const RETAINED_VIDEO_SPOOL = path.join(OWNED, 'staging', `operation-profiles-${RETAINED_PROFILE_ID}`, 'operation-evidence-gc3O4o/selected-video.jsonl');
const RETAINED_DIAGNOSTIC = path.join(ROOT, 'artifacts/v0.7/operation-profiles/diagnostics/829cdb63-23f2-46f9-981a-f7434d2f4107/report.json');
const RETAINED_DIAGNOSTIC_SHA = 'cbf2ec2fabf1d32d504e1cc551b39f7d9d0dafb158eb010da65fa2e3fa6584b1';
const MODULES = ['scripts/v07-operation-profile-smoke.cjs', 'src/encode-operation.cjs', 'src/operation-evidence.cjs',
  'src/operation-contract.cjs', 'src/inspection.cjs', 'src/media.cjs', 'src/provenance.cjs', 'src/outputs.cjs', 'src/process-runner.cjs', 'package.json'];
const REPORTS = [ORIGINAL, CALIBRATION, AAC, FLAC];
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 16 * 1024 * 1024,
  maxPcmBytes: 32 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 8 * 1024 * 1024 });
const matrix = PROFILES.flatMap(profile => ['precision-aac', 'precision-flac'].map(audio => ({
  id: `${profile.id}:${audio}`, profile, audio, settings: { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default },
})));
assert.deepEqual(PROFILES.map(profile => profile.id), ['h264-cpu', 'h265-cpu', 'av1-cpu', 'h264-nvidia', 'h265-nvidia', 'av1-nvidia']);
const controller = new AbortController(), children = new Set(), mediaInputs = new Set([SOURCE]), pendingEncodes = new Map();
const allowed = new Set([...REPORTS, SOURCE, ...Object.values(TOOLS), ...MODULES.map(file => path.join(ROOT, file))]);
let report, reportFile, outputRoot, evidenceRoot, lease, leaseIdentity;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].map(key => [key, String(stat[key])]));
const same = (a, b) => a.dev !== 0n && a.ino !== 0n && ['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].every(key => a[key] === b[key]);
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
async function save() {
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 32 * 1024 * 1024);
  const temporary = reportFile + '.' + randomUUID() + '.tmp', handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, reportFile);
}
async function receipt(file) {
  assert.ok(allowed.has(file) || outputRoot && inside(outputRoot, file), 'Exact known or newly owned read scope');
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 256n * 1024n ** 2n);
  assert.equal(await fs.realpath(file), path.resolve(file));
  const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })));
    for (let at = 0; at < Number(before.size);) {
      if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      const chunk = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - at), at);
      assert.ok(chunk.bytesRead > 0); hash.update(buffer.subarray(0, chunk.bytesRead)); at += chunk.bytesRead;
    }
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await fs.lstat(file, { bigint: true })));
    return { path: file, sha256: hash.digest('hex'), bytes: Number(before.size), identity: identity(before) };
  } finally { await handle.close(); }
}
async function acquire() {
  lease = await fs.open(LEASE, 'wx+'); await lease.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid,
    purpose: 'operation-profile-qualification', startedAt: report.startedAt }));
  await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
}
async function release() {
  if (!lease) return;
  try {
    assert.equal(children.size, 0, 'Drain every child before releasing the media slot');
    const named = await fs.lstat(LEASE, { bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size < 8192n && same(named, leaseIdentity) && same(named, await lease.stat({ bigint: true })));
    const bytes = Buffer.alloc(Number(named.size)), read = await lease.read(bytes, 0, bytes.length, 0), value = JSON.parse(bytes);
    assert.equal(read.bytesRead, bytes.length); assert.equal(value.token, report.id); assert.equal(value.pid, process.pid);
    await lease.close(); lease = null; assert.ok(same(named, await fs.lstat(LEASE, { bigint: true }))); await fs.unlink(LEASE); report.leaseReleased = true;
  } catch (error) { report.leaseRetained = evidenceFailure(error); }
  finally { await lease?.close().catch(() => {}); lease = null; }
}
async function run(executable, argv, options = {}) {
  assert.ok(Object.values(TOOLS).includes(executable)); assert.equal(children.size, 0); assert.ok(report.invocations.length < report.bounds.maxChildren);
  assert.ok(!argv.includes('-y'), 'Never overwrite evidence');
  const version = argv.length === 1 && argv[0] === '-version';
  const encode = !version && executable === TOOLS.ffmpeg && argv.at(-1) !== 'pipe:1';
  if (!version) assert.ok(argv.includes('-i') && mediaInputs.has(argv[argv.indexOf('-i') + 1]), 'Only exact owned inputs');
  if (encode) {
    assert.deepEqual(argv, pendingEncodes.get(argv.at(-1)), 'Only the exact genuine prepared encode argv may run');
    assert.ok(inside(outputRoot, argv.at(-1)) && argv.includes('-n'));
    await fs.access(argv.at(-1)).then(() => { throw new Error('Output exists; refusing replay over evidence.'); }, error => { if (error.code !== 'ENOENT') throw error; });
    pendingEncodes.delete(argv.at(-1));
  } else if (!version && executable === TOOLS.ffmpeg) {
    assert.equal(argv.at(-1), 'pipe:1'); assert.ok(['pcm_s16le', 'pcm_s32le'].includes(argv[argv.indexOf('-c:a') + 1]));
    assert.ok(['s16le', 's32le'].includes(argv[argv.indexOf('-f') + 1]) && !argv.includes('-c:v') && !argv.includes('-filter:a'), 'PCM decode only');
  }
  const item = { executable, argv, purpose: version ? 'version' : encode ? 'encode' : 'output-evidence', status: 'running', startedAt: new Date().toISOString() };
  report.invocations.push(item); await save(); const started = process.hrtime.bigint();
  try {
    const result = await runTool(executable, argv, { ...options, signal: controller.signal,
      timeoutMs: Math.min(options.timeoutMs || 120000, 120000), stdoutLimit: Math.min(options.stdoutLimit || 1024 * 1024, 32 * 1024 * 1024), stderrLimit: 256 * 1024,
      onChild: child => { children.add(child); item.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
        child.once('close', (code, signal) => { children.delete(child); item.closed = { code, signal }; }); } });
    Object.assign(item, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture,
      stdoutCapture: result.stdoutCapture, ...(options.onStdoutChunk ? {} : { stdout: result.stdout }) });
    assert.equal(result.exitCode, 0); assert.equal(result.stderrCapture.truncated, false);
    if (encode) report.completedEncodes++;
    return result;
  } catch (error) { item.status = 'failed'; item.failure = evidenceFailure(error); throw error; }
  finally { item.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6; item.finishedAt = new Date().toISOString(); await save(); }
}
async function context() {
  const buffers = await Promise.all(REPORTS.map(async file => { const stat = await fs.lstat(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 16 * 1024 * 1024); return fs.readFile(file); }));
  assert.equal(sha(buffers[0]), ORIGINAL_SHA);
  const [original, calibrated, aac, flac] = buffers.map(bytes => JSON.parse(bytes));
  assert.equal(calibrated.status, 'retained-contract-and-interior-timelines-checked');
  assert.equal(calibrated.retainedReports.find(item => item.path === ORIGINAL).sha256, ORIGINAL_SHA);
  assert.equal(aac.status, 'passed');
  const passedAac = aac.cases.find(item => item.id === 'aac-held-out-late-vfr'), passedFlac = flac.cases.find(item => item.id === 'flac-held-out-late-vfr');
  for (const item of [passedAac, passedFlac]) { assert.equal(item.status, 'passed'); assert.equal(item.validation.valid, true); assert.equal(item.collection.status, 'completed'); }
  assert.equal(flac.status, 'failed', 'The earlier AAC failure remains historical, even though its separate FLAC cell passed');
  for (const record of [aac, flac]) {
    assert.equal(record.sourceBefore.sha256, SOURCE_SHA);
    assert.equal(record.retainedReports.find(item => item.path === ORIGINAL).sha256, ORIGINAL_SHA);
    assert.deepEqual(record.interiorClockCalibration.qualification, calibrated.calibration.qualification);
  }
  const inspection = original.sourceEvidence.timeline.inspection;
  assert.equal(original.artifacts[SOURCE].sha256, SOURCE_SHA); assert.equal(selectVideo(inspection.probe).pix_fmt, 'yuv420p');
  assert.equal(inspection.color.classification, 'sdr');
  return { inspection, interior: calibrated.calibration.qualification, qualifications: {
    'precision-aac': passedAac.qualification, 'precision-flac': passedFlac.qualification },
  reports: REPORTS.map((file, i) => ({ path: file, sha256: sha(buffers[i]) })) };
}
function makePlan(cell, output, id, ctx, time) {
  const recipe = describeRecipe(cell.settings), pixelFormat = outputPixelFormat(cell.profile, selectVideo(ctx.inspection.probe));
  assert.equal(pixelFormat, 'yuv420p', 'This matrix is 8-bit only; no implicit depth conversion');
  const description = generationDescriptionOf({ version: 1, profileId: cell.profile.id, codec: cell.profile.codec, backend: cell.profile.hardware,
    encoder: cell.profile.encoder, preset: cell.settings.preset, qualityMode: recipe.qualityMode, quality: cell.settings.quality, bitDepth: 8,
    encoderArgs: recipe.args, appVersion: require('../package.json').version, runtimeVersion: 'FFmpeg 9.0.2', createdAt: time });
  assert.ok(description);
  const request = resolveFileRequest({ fileId: cell.id, identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: cell.audio } });
  const plan = buildEncodeOperation({ input: SOURCE, output, settings: cell.settings, inspection: ctx.inspection, request,
    outputId: id, generationDescription: description, runtimeIdentity: RUNTIME });
  assert.equal(plan.compatibilityPath, false); assert.equal(plan.contract.geometry.filterRequired, false);
  assert.ok(plan.expectedOutput.timestampOrigins && plan.args.includes('-copyts'));
  return { plan, description };
}
// This diagnostic is intentionally pinned to one failed owned output. It never
// re-encodes or reruns the source decode, and does not reinterpret a timing
// discrepancy as accepted capability. All original receipts remain immutable.
async function retainedVideoContext() {
  for (const file of [RETAINED_PROFILE_REPORT, RETAINED_OUTPUT, RETAINED_VIDEO_SPOOL]) allowed.add(file);
  const originalReceipt = await receipt(RETAINED_PROFILE_REPORT);
  assert.equal(originalReceipt.sha256, RETAINED_PROFILE_SHA);
  assert.ok(originalReceipt.bytes < 16 * 1024 * 1024);
  const originalBytes = await fs.readFile(RETAINED_PROFILE_REPORT);
  assert.equal(sha(originalBytes), RETAINED_PROFILE_SHA);
  assert.deepEqual(await receipt(RETAINED_PROFILE_REPORT), originalReceipt);
  const original = JSON.parse(originalBytes);
  assert.equal(original.id, RETAINED_PROFILE_ID); assert.equal(original.status, 'failed');
  assert.equal(original.runtimeIdentity, RUNTIME); assert.equal(original.leaseReleased, true);
  const item = original.cases.find(value => value.id === 'av1-cpu:precision-aac');
  assert.ok(item); assert.equal(item.status, 'failed');
  assert.equal(item.failure.code, 'STDOUT_SINK_FAILED');
  assert.equal(item.failure.cause.code, 'OPERATION_EVIDENCE_VIDEO_DURATION');
  assert.equal(item.stage.file, RETAINED_OUTPUT); assert.equal(item.collection.outputPath, RETAINED_OUTPUT);
  assert.equal(item.collection.sourcePath, SOURCE); assert.equal(item.plan.args.at(-1), RETAINED_OUTPUT);
  assert.equal(item.plan.args[item.plan.args.indexOf('-i') + 1], SOURCE);
  assert.equal(item.plan.args[item.plan.args.indexOf('-c:v:0') + 1], 'libsvtav1');
  assert.deepEqual(item.settings, { profileId: 'av1-cpu', preset: '6', quality: 32 });
  const encode = original.invocations.filter(value => value.purpose === 'encode' && value.argv.at(-1) === RETAINED_OUTPUT);
  assert.equal(encode.length, 1); assert.equal(encode[0].status, 'completed'); assert.equal(encode[0].exitCode, 0);
  assert.deepEqual(encode[0].argv, item.plan.args);
  assert.equal(classifyMarker(item.probe).outputId, item.outputId);
  const sourceDecode = item.collection.invocations.find(value => value.label === 'source-video-frames');
  assert.equal(sourceDecode.status, 'completed'); assert.equal(sourceDecode.capture.records, 440);
  assert.equal(sourceDecode.stderrCapture.truncated, false); assert.equal(sourceDecode.stderrCapture.totalBytes, 0);
  const spool = item.collection.spools.find(value => value.path === RETAINED_VIDEO_SPOOL);
  assert.equal(spool.status, 'sealed'); assert.equal(spool.bytes, 2922);
  const spoolReceipt = await receipt(RETAINED_VIDEO_SPOOL);
  assert.deepEqual(spoolReceipt, { path: spool.path, sha256: spool.sha256, bytes: spool.bytes, identity: spool.identity });
  const spoolBytes = await fs.readFile(RETAINED_VIDEO_SPOOL); assert.equal(sha(spoolBytes), spool.sha256);
  const lines = spoolBytes.toString('utf8').split('\n'); assert.equal(lines.pop(), ''); assert.equal(lines.length, 41);
  const selected = lines.map(line => {
    const row = JSON.parse(line); assert.deepEqual(Object.keys(row).sort(), ['duration', 'time']);
    for (const value of [row.time, row.duration]) {
      assert.deepEqual(Object.keys(value).sort(), ['d', 'n']); assert.match(value.n, /^-?\d{1,18}$/); assert.match(value.d, /^[1-9]\d{0,18}$/);
    }
    assert.ok(BigInt(row.duration.n) > 0n); return row;
  });
  assert.deepEqual(await receipt(RETAINED_VIDEO_SPOOL), spoolReceipt);
  const sourceReceipt = await receipt(SOURCE); assert.equal(sourceReceipt.sha256, SOURCE_SHA);
  assert.deepEqual(sourceReceipt, original.sourceBefore);
  const outputReceipt = await receipt(RETAINED_OUTPUT); assert.deepEqual(outputReceipt, item.outputBefore);
  return { originalReceipt, original, item, selected, spoolReceipt, sourceReceipt, outputReceipt, sourceDecode };
}
function retainedVideoComparison(probe, selected, item) {
  assert.ok(Array.isArray(probe.streams) && probe.streams.length === 1);
  const stream = probe.streams[0]; assert.equal(stream.index, 0); assert.equal(stream.codec_type, 'video'); assert.equal(stream.codec_name, 'av1');
  assert.match(stream.time_base, /^[1-9]\d{0,12}\/[1-9]\d{0,12}$/);
  const [tn, td] = stream.time_base.split('/').map(BigInt);
  const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
  const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
  const read = a => ({ n: BigInt(a.n), d: BigInt(a.d) });
  const pack = a => a === null ? null : ({ numerator: String(a.n), denominator: String(a.d), microseconds: Number(a.n) / Number(a.d) * 1e6 });
  const ticks = value => { assert.ok(Number.isSafeInteger(value)); return { n: BigInt(value) * tn, d: td }; };
  const absoluteStart = item.plan.contract.range.absoluteStart;
  const origin = { n: BigInt(absoluteStart.numerator), d: BigInt(absoluteStart.denominator) };
  assert.ok(Array.isArray(probe.frames) && probe.frames.length > 0 && probe.frames.length <= 128);
  const frames = probe.frames.map(frame => {
    assert.equal(frame.media_type, 'video'); assert.equal(frame.stream_index, 0);
    const time = ticks(frame.pts);
    const duration = frame.duration === undefined ? null : ticks(frame.duration);
    const packetDuration = frame.pkt_duration === undefined ? null : ticks(frame.pkt_duration);
    return { raw: frame, time, duration, packetDuration };
  });
  const rows = frames.map((frame, index) => {
    const source = selected[index], next = frames[index + 1], sourceNext = selected[index + 1];
    const sourceDuration = source ? read(source.duration) : null;
    const outputGap = next ? sub(next.time, frame.time) : null;
    const sourceGap = sourceNext && source ? sub(read(sourceNext.time), read(source.time)) : null;
    return { index, source: source || null, output: frame.raw,
      rebasedPtsError: source ? pack(sub(frame.time, sub(read(source.time), origin))) : null,
      reportedDurationError: sourceDuration && frame.duration ? pack(sub(frame.duration, sourceDuration)) : null,
      packetDurationError: sourceDuration && frame.packetDuration ? pack(sub(frame.packetDuration, sourceDuration)) : null,
      outputPresentationGap: pack(outputGap), sourcePresentationGap: pack(sourceGap),
      presentationGapError: sourceGap && outputGap ? pack(sub(outputGap, sourceGap)) : null,
      reportedDurationMinusNextPtsGap: outputGap && frame.duration ? pack(sub(frame.duration, outputGap)) : null };
  });
  const errors = key => rows.map(row => row[key]?.microseconds).filter(value => value !== undefined).map(Math.abs);
  const durationErrors = errors('reportedDurationError'), ptsErrors = errors('rebasedPtsError'), gapErrors = errors('presentationGapError');
  const finalSource = selected.at(-1), finalOutput = frames.at(-1);
  const sourceEnd = sub(add(read(finalSource.time), read(finalSource.duration)), origin);
  const outputEnd = finalOutput.duration ? add(finalOutput.time, finalOutput.duration) : null;
  return { status: 'observations-only-no-qualification', expectedFrameCount: selected.length, outputFrameCount: frames.length,
    frameCountMatches: selected.length === frames.length,
    outputPtsStrictlyIncreasing: frames.every((frame, index) => index === 0 || sub(frame.time, frames[index - 1].time).n > 0n),
    frozenVideoDurationToleranceUs: item.collection.timingQualification.videoDurationUs,
    frozenVideoTimestampToleranceUs: item.qualification.tolerances.videoTimestampUs,
    maximumAbsolutePtsErrorUs: ptsErrors.length ? Math.max(...ptsErrors) : null,
    maximumAbsoluteReportedDurationErrorUs: durationErrors.length ? Math.max(...durationErrors) : null,
    maximumAbsolutePresentationGapErrorUs: gapErrors.length ? Math.max(...gapErrors) : null,
    reportedDurationMismatchIndices: rows.filter(row => row.reportedDurationError && Math.abs(row.reportedDurationError.microseconds) > item.collection.timingQualification.videoDurationUs).map(row => row.index),
    sourceRebasedEnd: pack(sourceEnd), outputReportedEnd: pack(outputEnd), finalReportedEndError: outputEnd ? pack(sub(outputEnd, sourceEnd)) : null,
    missingOutputDurationIndices: frames.flatMap((frame, index) => frame.duration === null ? [index] : []),
    stream, rows,
    interpretationBoundary: 'PTS spacing and decoded duration are separately observed. Matching PTS does not alone establish the last-frame presentation end or authorize ignoring duration mismatches. This report changes no validator, qualification, or tolerance.' };
}
function retainedVideoArgv() {
  return ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm',
    '-select_streams', '0', '-show_frames', '-show_streams', '-show_entries',
    'frame=media_type,stream_index,pts,duration,pkt_duration,repeat_pict,pict_type:frame_tags=:frame_side_data=:stream=index,codec_type,codec_name,time_base,start_pts,avg_frame_rate,r_frame_rate,duration_ts,nb_frames:stream_tags=:stream_disposition=',
    '-of', 'json', '-i', RETAINED_OUTPUT];
}
function completeTextProbe(result) {
  // runTool's bounded text mode rejects OUTPUT_LIMIT rather than returning a
  // truncated string. stdoutCapture belongs to its streaming API only.
  assert.equal(result.exitCode, 0); assert.equal(typeof result.stdout, 'string');
  assert.ok(Buffer.byteLength(result.stdout) > 0 && Buffer.byteLength(result.stdout) <= 1024 * 1024);
  if (result.stdoutCapture !== undefined) {
    assert.equal(result.stdoutCapture.truncated, false); assert.equal(result.stdoutCapture.totalBytes, Buffer.byteLength(result.stdout));
  }
  assert.equal(result.stderrCapture.truncated, false); assert.equal(result.stderrCapture.totalBytes, 0); assert.equal(result.stderr, '');
  return { bytes: Buffer.byteLength(result.stdout), sha256: sha(result.stdout), json: JSON.parse(result.stdout),
    captureMode: 'bounded-text; runner rejects OUTPUT_LIMIT, no streaming receipt required' };
}
async function recheckRetainedVideo() {
  const ctx = await retainedVideoContext(); allowed.add(RETAINED_DIAGNOSTIC);
  const priorReceipt = await receipt(RETAINED_DIAGNOSTIC); assert.equal(priorReceipt.sha256, RETAINED_DIAGNOSTIC_SHA);
  assert.ok(priorReceipt.bytes < 2 * 1024 * 1024);
  const priorBytes = await fs.readFile(RETAINED_DIAGNOSTIC); assert.equal(sha(priorBytes), RETAINED_DIAGNOSTIC_SHA);
  assert.deepEqual(await receipt(RETAINED_DIAGNOSTIC), priorReceipt);
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.id, '829cdb63-23f2-46f9-981a-f7434d2f4107'); assert.equal(prior.status, 'failed');
  assert.equal(prior.failure.message, "Cannot read properties of undefined (reading 'truncated')");
  assert.equal(prior.leaseReleased, true); assert.equal(prior.runtimeIdentity, RUNTIME); assert.equal(prior.completedEncodes, 0);
  assert.equal(prior.invocations.length, 1); assert.deepEqual(prior.originalReport, ctx.originalReceipt);
  assert.deepEqual(prior.retainedOutputBefore, ctx.outputReceipt); assert.deepEqual(prior.retainedSourceBefore, ctx.sourceReceipt);
  assert.deepEqual(prior.selectedSourceSpoolBefore, ctx.spoolReceipt); assert.deepEqual(prior.selectedSourceFrames, ctx.selected);
  assert.deepEqual(prior.originalResolvedArgv, ctx.item.plan.args); assert.equal(prior.originalPlanFingerprint, ctx.item.plan.planFingerprint);
  const invocation = prior.invocations[0]; assert.equal(invocation.status, 'completed'); assert.equal(invocation.executable, TOOLS.ffprobe);
  assert.deepEqual(invocation.argv, retainedVideoArgv()); assert.deepEqual(invocation.closed, { code: 0, signal: null });
  const capture = completeTextProbe(invocation); assert.equal(capture.bytes, 8842); assert.equal(capture.json.frames.length, 41);
  for (const name of ['ffmpeg', 'ffprobe']) assert.equal(prior.runtime[name].sha256, PINS[name]);
  assert.equal(sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => ({ sizeBytes: prior.runtime[name].bytes, sha256: prior.runtime[name].sha256 })))), RUNTIME);
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/operation-profiles/diagnostics', id);
  report = { schema: 1, id, status: 'retained-video-recheck-running', startedAt: new Date().toISOString(),
    purpose: 'Zero-child correction of a text-mode capture receipt assumption; existing AV1 frames only',
    priorDiagnostic: priorReceipt, originalReport: ctx.originalReceipt, originalFailure: ctx.item.failure,
    originalCase: ctx.item.id, runtimeIdentity: RUNTIME, retainedRuntimeReceipts: prior.runtime,
    sourceBefore: ctx.sourceReceipt, outputBefore: ctx.outputReceipt, selectedSourceSpoolBefore: ctx.spoolReceipt,
    originalResolvedArgv: ctx.item.plan.args, originalPlanFingerprint: ctx.item.plan.planFingerprint,
    retainedInvocation: invocation, decodedCapture: capture,
    comparison: retainedVideoComparison(capture.json, ctx.selected, ctx.item),
    invocations: [], children: 0, completedEncodes: 0, maxConcurrentChildren: 0,
    limitations: ['No child was launched. The source video spool and complete existing output capture are reused with exact receipts.',
      'Paired runtime hashes are the retained native-run receipts; no new executable capability is claimed.',
      'The failed profile remains unqualified. This recheck changes no validator, tolerance, or original report.'] };
  const disk = await fs.statfs(ROOT, { bigint: true }); assert.ok(disk.bavail * disk.bsize >= 25n * 1024n ** 3n);
  await fs.mkdir(directory, { recursive: true }); reportFile = path.join(directory, 'report.json'); await save();
  try {
    report.modules = [];
    for (const name of ['scripts/v07-operation-profile-smoke.cjs', 'src/operation-evidence.cjs', 'src/process-runner.cjs']) report.modules.push(await receipt(path.join(ROOT, name)));
    report.outputAfter = await receipt(RETAINED_OUTPUT); assert.deepEqual(report.outputAfter, ctx.outputReceipt);
    report.sourceAfter = await receipt(SOURCE); assert.deepEqual(report.sourceAfter, ctx.sourceReceipt);
    report.selectedSourceSpoolAfter = await receipt(RETAINED_VIDEO_SPOOL); assert.deepEqual(report.selectedSourceSpoolAfter, ctx.spoolReceipt);
    report.priorDiagnosticAfter = await receipt(RETAINED_DIAGNOSTIC); assert.deepEqual(report.priorDiagnosticAfter, priorReceipt);
    report.originalReportAfter = await receipt(RETAINED_PROFILE_REPORT); assert.deepEqual(report.originalReportAfter, ctx.originalReceipt);
    report.status = 'retained-video-timing-rechecked-no-qualification';
  } catch (error) { report.status = 'failed'; report.failure = evidenceFailure(error); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ report: reportFile, status: report.status,
    children: 0, encodes: 0, frames: report.comparison.outputFrameCount, ptsErrorUs: report.comparison.maximumAbsolutePtsErrorUs,
    durationErrorUs: report.comparison.maximumAbsoluteReportedDurationErrorUs, durationMismatchFrames: report.comparison.reportedDurationMismatchIndices,
    finalReportedEndError: report.comparison.finalReportedEndError })); }
}
async function inspectRetainedVideo(planOnly) {
  const ctx = await retainedVideoContext(), argv = retainedVideoArgv();
  if (planOnly) {
    console.log(JSON.stringify({ status: 'retained-video-inspection-planned', writes: 0, children: 0, encodes: 0,
      original: ctx.originalReceipt, output: ctx.outputReceipt, selectedSourceSpool: ctx.spoolReceipt, selectedFrames: ctx.selected.length,
      intendedChild: { executable: TOOLS.ffprobe, argv, timeoutMs: 15000, stdoutLimit: 1024 * 1024 } })); return;
  }
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/operation-profiles/diagnostics', id);
  report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), purpose: 'One retained AV1 output decoded-video timing diagnostic; no encoding or qualification',
    runtimeIdentity: RUNTIME, originalReport: ctx.originalReceipt, originalFailure: ctx.item.failure, originalCase: ctx.item.id,
    retainedSourceBefore: ctx.sourceReceipt, retainedOutputBefore: ctx.outputReceipt, selectedSourceSpoolBefore: ctx.spoolReceipt,
    sourceDecodeReceipt: ctx.sourceDecode, selectedSourceFrames: ctx.selected, originalResolvedArgv: ctx.item.plan.args,
    originalPlanFingerprint: ctx.item.plan.planFingerprint, originalOutputId: ctx.item.outputId,
    bounds: { maxChildren: 1, maxConcurrentChildren: 1, maxWallSeconds: 90, stdoutBytes: 1024 * 1024, decodedOutputFrames: 128,
      sourceDecodeChildren: 0, encodes: 0, forecastNewDBytes: 2 * 1024 * 1024, forecastNewFBytes: 0 },
    completedEncodes: 0, maxConcurrentChildren: 0, invocations: [], cases: [],
    limitations: ['The original failure report is preserved; this separate diagnostic never accepts the failed profile.',
      'Only this 179935-byte existing owned output is decoded. Existing 41-row source timing spool is reused after receipt verification.',
      'No source decode, encode, audio decode, media publication, tolerance widening, or app/service capability change.'] };
  await fs.mkdir(directory, { recursive: true }); reportFile = path.join(directory, 'report.json'); await save();
  const deadline = setTimeout(() => controller.abort(), 90000); deadline.unref(); const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acquire();
    const disk = await fs.statfs(ROOT, { bigint: true }); assert.ok(disk.bavail * disk.bsize >= 25n * 1024n ** 3n);
    report.runtime = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const binary = await receipt(TOOLS[name]); assert.equal(binary.sha256, PINS[name]);
      assert.equal(ctx.original.runtime[name].sha256, PINS[name]);
      report.runtime[name] = { ...binary, retainedVersionReceipt: ctx.original.runtime[name].version };
    }
    assert.equal(sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => ({ sizeBytes: report.runtime[name].bytes, sha256: report.runtime[name].sha256 })))), RUNTIME);
    report.modules = [];
    for (const name of ['scripts/v07-operation-profile-smoke.cjs', 'src/operation-evidence.cjs', 'src/process-runner.cjs']) report.modules.push(await receipt(path.join(ROOT, name)));
    assert.deepEqual(await receipt(RETAINED_OUTPUT), ctx.outputReceipt); mediaInputs.add(RETAINED_OUTPUT);
    const result = await run(TOOLS.ffprobe, argv, { timeoutMs: 15000, stdoutLimit: 1024 * 1024 });
    report.decodedCapture = completeTextProbe(result);
    report.comparison = retainedVideoComparison(report.decodedCapture.json, ctx.selected, ctx.item);
    report.retainedOutputAfter = await receipt(RETAINED_OUTPUT); assert.deepEqual(report.retainedOutputAfter, ctx.outputReceipt);
    report.retainedSourceAfter = await receipt(SOURCE); assert.deepEqual(report.retainedSourceAfter, ctx.sourceReceipt);
    report.selectedSourceSpoolAfter = await receipt(RETAINED_VIDEO_SPOOL); assert.deepEqual(report.selectedSourceSpoolAfter, ctx.spoolReceipt);
    report.originalReportAfter = await receipt(RETAINED_PROFILE_REPORT); assert.deepEqual(report.originalReportAfter, ctx.originalReceipt);
    report.status = 'retained-video-timing-captured-no-qualification';
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = evidenceFailure(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    report.finishedAt = new Date().toISOString(); await release(); await save();
    console.log(JSON.stringify({ report: reportFile, status: report.status, encodes: report.completedEncodes, children: report.invocations.length,
      comparison: report.comparison ? { frames: report.comparison.outputFrameCount, maximumPtsErrorUs: report.comparison.maximumAbsolutePtsErrorUs,
        maximumDurationErrorUs: report.comparison.maximumAbsoluteReportedDurationErrorUs, durationMismatchFrames: report.comparison.reportedDurationMismatchIndices,
        finalReportedEndError: report.comparison.finalReportedEndError } : null, failure: report.failure }));
  }
}
async function main() {
  const args = process.argv.slice(2), planOnly = args.length === 1 && args[0] === '--plan-only';
  if (args.length === 1 && args[0] === '--recheck-retained-video') return recheckRetainedVideo();
  if (args.length === 1 && args[0] === '--retained-video-plan-only') return inspectRetainedVideo(true);
  if (args.length === 2 && args[0] === '--parent-granted-media-slot' && args[1] === '--inspect-retained-video') return inspectRetainedVideo(false);
  const single = args.length === 3 && args[1] === '--case' ? args[2] : null;
  if (!planOnly) assert.deepEqual(args, single ? ['--parent-granted-media-slot', '--case', single] : ['--parent-granted-media-slot']);
  const cells = single ? matrix.filter(cell => cell.id === single) : matrix; assert.ok(cells.length > 0);
  const ctx = await context();
  if (planOnly) {
    const plans = cells.map(cell => ({ id: cell.id, settings: cell.settings,
      plan: makePlan(cell, path.join(OWNED, 'staging/not-executed-profile-plan/encoded.mkv'), '00000000-0000-4000-8000-000000000001', ctx, '2026-10-11T00:00:00.000Z').plan }));
    console.log(JSON.stringify({ status: 'planned-only', writes: 0, children: 0, cases: plans.map(item => ({ id: item.id, settings: item.settings,
      fingerprint: item.plan.planFingerprint, encoder: item.plan.args[item.plan.args.indexOf('-c:v:0') + 1], requirements: item.plan.qualificationRequirements })) })); return;
  }
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/operation-profiles', id);
  outputRoot = path.join(OWNED, 'outputs', `operation-profiles-${id}`); evidenceRoot = path.join(OWNED, 'staging', `operation-profiles-${id}`);
  report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), purpose: 'Six ordinary Tested Default profiles, exact late SDR range, actual AAC/FLAC output contracts',
    runtimeIdentity: RUNTIME, outputRoot, evidenceRoot, source: SOURCE, bounds: { cases: cells.length, encodes: cells.length,
      maxChildren: 2 + cells.reduce((sum, cell) => sum + (cell.audio === 'precision-aac' ? 10 : 14), 0), maxConcurrentChildren: 1,
      maxWallSeconds: 1200, forecastNewFBytes: 128 * 1024 * 1024, marginFBytes: 128 * 1024 * 1024, budget: BUDGET },
    completedEncodes: 0, maxConcurrentChildren: 0, invocations: [], cases: [],
    limitations: ['Qualification only; elapsed time and output bytes are diagnostic, never performance or perceptual benchmark evidence.',
      'Only owned 320x180 progressive 8-bit SDR VFR source, 15.013..17.087 s range, Matroska, 48k stereo/44.1k mono are covered.',
      'No resize, 10-bit, HDR, arbitrary AAC gaps, audio-copy ranges, subtitle/chapter transformation, Archive recipe, hardware fallback or service admission.',
      'Full source/output decoding is explicitly budgeted. No telemetry shortcut or large-archive responsiveness claim.',
      'Calibration fixes tolerances before candidates. Each encoder must pass actual decoded timing/provenance; a coded cadence difference is a failure to investigate, never an automatic widening.',
      'No output publication or cleanup. First meaningful failure stops this run and retains all completed/partial evidence.'] };
  await fs.mkdir(directory, { recursive: true }); reportFile = path.join(directory, 'report.json'); await save();
  const deadline = setTimeout(() => controller.abort(), 1200000); deadline.unref(); const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acquire();
    const d = await fs.statfs(ROOT, { bigint: true }), f = await fs.statfs(OWNED, { bigint: true });
    report.freeSpace = { D: String(d.bavail * d.bsize), F: String(f.bavail * f.bsize) };
    assert.ok(d.bavail * d.bsize >= 25n * 1024n ** 3n && f.bavail * f.bsize >= 256n * 1024n ** 2n);
    await fs.mkdir(outputRoot); await fs.mkdir(evidenceRoot);
    report.modules = []; for (const file of MODULES) report.modules.push(await receipt(path.join(ROOT, file)));
    report.retainedReports = []; for (const file of REPORTS) { const value = await receipt(file); assert.equal(value.sha256, ctx.reports.find(item => item.path === file).sha256); report.retainedReports.push(value); }
    report.sourceBefore = await receipt(SOURCE); assert.equal(report.sourceBefore.sha256, SOURCE_SHA);
    report.runtime = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const binary = await receipt(TOOLS[name]); assert.equal(binary.sha256, PINS[name]); const version = await run(TOOLS[name], ['-version']);
      assert.match(version.stdout, new RegExp(`${name} version 9\\.0\\.2`)); report.runtime[name] = { ...binary, version: version.stdout };
    }
    assert.equal(sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => ({ sizeBytes: report.runtime[name].bytes, sha256: report.runtime[name].sha256 })))), RUNTIME);
    report.frozenInteriorQualification = ctx.interior; report.frozenEndpointQualifications = ctx.qualifications;
    for (const cell of cells) {
      const item = { id: cell.id, settings: cell.settings, status: 'running', outputId: randomUUID() }; report.cases.push(item); await save();
      try {
        item.stage = await createStage(outputRoot);
        const built = makePlan(cell, item.stage.file, item.outputId, ctx, new Date().toISOString()); item.plan = built.plan; item.generationDescription = built.description;
        pendingEncodes.set(item.stage.file, item.plan.args);
        await run(TOOLS.ffmpeg, item.plan.args); await sealStage(item.stage); mediaInputs.add(item.stage.file);
        item.outputBefore = await receipt(item.stage.file); item.probe = await inspectMetadata(item.stage.file, { ffprobe: TOOLS.ffprobe, run, signal: controller.signal });
        item.marker = classifyMarker(item.probe); assert.equal(item.marker.kind, 'generated'); assert.equal(item.marker.outputId, item.outputId);
        assert.deepEqual(item.marker.previousGeneration, built.description);
        item.qualification = { ...structuredClone(ctx.qualifications[cell.audio]), evidenceId: `${id}:${cell.id}` };
        item.qualificationRationale = 'Applying the previously calibrated clock/container/audio bounds to this independently observed encoder output; not deriving a pass tolerance from the candidate.';
        item.collection = await collectOperationEvidence({ plan: item.plan, sourceProbe: ctx.inspection.probe, outputProbe: item.probe,
          sourcePath: SOURCE, outputPath: item.stage.file, stageDirectory: evidenceRoot, ffmpeg: TOOLS.ffmpeg, ffprobe: TOOLS.ffprobe,
          run, signal: controller.signal, budget: BUDGET, timingQualification: ctx.interior });
        item.validation = validateEncodeOperationOutput(item.plan, item.probe, { qualification: item.qualification, decodedEvidence: item.collection.decodedEvidence });
        assert.equal(item.validation.valid, true, item.validation.errors.join('; '));
        item.outputAfter = await receipt(item.stage.file); assert.deepEqual(item.outputAfter, item.outputBefore); await sealStage(item.stage);
        item.status = 'passed';
      } catch (error) {
        item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.failure = evidenceFailure(error);
        if (error.evidenceReceipt) item.collection = error.evidenceReceipt;
        throw error;
      } finally { item.finishedAt = new Date().toISOString(); await save(); }
    }
    report.sourceAfter = await receipt(SOURCE); assert.deepEqual(report.sourceAfter, report.sourceBefore);
    for (const before of report.retainedReports) assert.deepEqual(await receipt(before.path), before);
    report.status = 'passed-bounded-profile-cells';
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = evidenceFailure(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (report.sourceBefore && !report.sourceAfter) {
      // After cancellation, do not begin another full read. Persist a bounded
      // identity observation and say explicitly that no post-run hash exists.
      try {
        const stat = await fs.lstat(SOURCE, { bigint: true });
        report.sourceAfterFailure = { identity: identity(stat), ordinaryFile: stat.isFile() && !stat.isSymbolicLink(),
          unchangedMetadata: JSON.stringify(identity(stat)) === JSON.stringify(report.sourceBefore.identity),
          fullPostRunHashPerformed: false };
      } catch (error) { report.sourceAfterFailure = { failure: evidenceFailure(error), fullPostRunHashPerformed: false }; }
    }
    report.finishedAt = new Date().toISOString(); await release(); await save();
    console.log(JSON.stringify({ report: reportFile, status: report.status, encodes: report.completedEncodes, children: report.invocations.length,
      cases: report.cases.map(({ id, status, failure }) => ({ id, status, failure })) }));
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
