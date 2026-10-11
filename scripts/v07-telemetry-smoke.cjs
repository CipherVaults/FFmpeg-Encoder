'use strict';

// Parent-run, two short owned-fixture encodes only. The saved 013 evidence is
// read-only, never regenerated. This qualifies stats semantics, not the full
// production output validator, a hardware cell or benchmark performance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { createStage } = require('../src/outputs.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry, summarizeTelemetry } = require('../src/operation-telemetry.cjs');
const { selectedPcm } = require('./v07-encode-operation-smoke.cjs');

const ROOT = path.resolve(__dirname, '..'), OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const ORIGINAL_ID = '01349687-ff85-4606-b3be-b2baec87d06b';
const ORIGINAL = path.join(ROOT, 'artifacts/v0.7/encode-operation', ORIGINAL_ID, 'report.json');
const SOURCE = path.join(OWNED, 'fixtures', `encode-operation-${ORIGINAL_ID}`, 'vfr-offset-multitrack.mov');
const OLD_STAGE = path.join(OWNED, 'staging', `encode-operation-${ORIGINAL_ID}`);
const BIN = path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin');
const TOOLS = { ffmpeg: path.join(BIN, 'ffmpeg.exe'), ffprobe: path.join(BIN, 'ffprobe.exe') };
const PIN = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0', ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
const RUNTIME_ID = createHash('sha256').update(JSON.stringify([{ sizeBytes: 227823104, sha256: PIN.ffmpeg }, { sizeBytes: 227621376, sha256: PIN.ffprobe }])).digest('hex');
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const HASHABLE_MODULES = ['scripts/v07-telemetry-smoke.cjs', 'src/operation-telemetry.cjs', 'src/encode-operation.cjs', 'src/operation-contract.cjs', 'src/media.cjs', 'scripts/v07-encode-operation-smoke.cjs'];
const allowed = new Set([ORIGINAL, SOURCE, ...Object.values(TOOLS), ...HASHABLE_MODULES.map(file => path.join(ROOT, file)),
  path.join(OLD_STAGE, 'timeline-source-a0.s16le'), path.join(OLD_STAGE, 'timeline-source-a1.s16le')]);
const controller = new AbortController(), children = new Set();
let report, reportFile, outputRoot, lease, leaseIdentity;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = value => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].map(key => [key, String(value[key])]));
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const same = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const inside = (base, file) => { const rel = path.relative(base, file); return Boolean(rel) && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };
const errorRecord = error => ({ code: error.code || 'TELEMETRY_QUALIFICATION_FAILED', message: error.message, ...(error.stderr ? { stderr: error.stderr, stderrCapture: error.stderrCapture } : {}) });
async function save() {
  if (!reportFile) return;
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 16 * 1024 * 1024, 'Bounded report');
  const temp = `${reportFile}.${randomUUID()}.tmp`, handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, reportFile);
}
async function receipt(file) {
  assert.ok(allowed.has(file) || outputRoot && inside(outputRoot, file), 'Read/hash scope');
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 256n * 1024n ** 2n, 'Bounded single-link ordinary evidence');
  const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })), 'Evidence handle binding');
    for (let position = 0; position < Number(before.size);) {
      if (controller.signal.aborted) throw new Error('Cancelled');
      const read = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - position), position);
      assert.ok(read.bytesRead > 0); hash.update(buffer.subarray(0, read.bytesRead)); position += read.bytesRead;
    }
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await fs.lstat(file, { bigint: true })), 'Evidence changed during read');
    return { path: file, sha256: hash.digest('hex'), bytes: Number(before.size), identity: identity(before) };
  } finally { await handle.close(); }
}
async function acquire() {
  lease = await fs.open(LEASE, 'wx+');
  await lease.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid, purpose: 'operation-telemetry-smoke', startedAt: report.startedAt }));
  await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
}
async function release() {
  if (!lease) return;
  try {
    assert.equal(children.size, 0, 'Drain every child before lease release');
    const named = await fs.lstat(LEASE, { bigint: true }), held = await lease.stat({ bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size < 8192n && same(named, held) && same(named, leaseIdentity), 'Owned lease binding');
    const data = Buffer.alloc(Number(named.size)), result = await lease.read(data, 0, data.length, 0), record = JSON.parse(data);
    assert.equal(result.bytesRead, data.length); assert.equal(record.token, report.id); assert.equal(record.pid, process.pid);
    await lease.close(); lease = null;
    const after = await fs.lstat(LEASE, { bigint: true }); assert.ok(sameObject(named, after) && after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && after.size === named.size, 'Closed lease identity');
    await fs.unlink(LEASE); report.leaseReleased = true;
  } catch (error) { report.leaseRetained = error.message; }
  finally { await lease?.close().catch(() => {}); lease = null; }
}
async function run(executable, argv) {
  assert.ok(Object.values(TOOLS).includes(executable)); assert.equal(children.size, 0, 'Only one media child');
  assert.ok(report.invocations.length < 8 && !argv.includes('-y'), 'Invocation/overwrite bound');
  for (let n = 0; n < argv.length; n++) if (argv[n] === '-i') assert.ok(argv[n + 1] === SOURCE || inside(outputRoot, argv[n + 1]), 'Owned media inputs only');
  const isVersion = argv.length === 1 && argv[0] === '-version';
  if (!isVersion && executable === TOOLS.ffmpeg) {
    assert.ok(inside(outputRoot, argv.at(-1)), 'New owned encode output');
    await fs.access(argv.at(-1)).then(() => { throw new Error('Output already exists; no replay over evidence.'); }, error => { if (error.code !== 'ENOENT') throw error; });
  }
  const item = { executable, argv, status: 'running', startedAt: new Date().toISOString() }; report.invocations.push(item); await save();
  const start = process.hrtime.bigint();
  try {
    const result = await runTool(executable, argv, { signal: controller.signal, timeoutMs: 90000, stdoutLimit: 4 * 1024 * 1024, stderrLimit: 256 * 1024,
      onChild: child => { children.add(child); item.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size); child.once('close', () => children.delete(child)); } });
    Object.assign(item, result, { status: 'completed' }); return result;
  } catch (error) { item.status = 'failed'; item.failure = errorRecord(error); throw error; }
  finally { item.elapsedMs = Number(process.hrtime.bigint() - start) / 1e6; await save(); }
}
function ratio(value) { return { n: BigInt(value.numerator), d: BigInt(value.denominator) }; }
function reduced(n, d) { let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b]; return `${n / (a || 1n)}/${d / (a || 1n)}`; }
function selectedVideo(source, plan, outputTimeBase) {
  const stream = source.inspection.probe.streams.find(s => s.codec_type === 'video'), [tn, td] = stream.time_base.split('/').map(BigInt);
  const start = ratio(plan.contract.range.absoluteStart), end = ratio(plan.contract.range.absoluteEnd), out = ratio(outputTimeBase);
  const shift = plan.expectedOutput.timestampOrigins ? ratio(plan.expectedOutput.timestampOrigins.video.effectiveOrigin) : start;
  const items = source.videos.filter(frame => { const pts = BigInt(frame.pts) * tn; return pts * start.d >= start.n * td && pts * end.d < end.n * td; });
  // setpts integer assignment truncates the rebased expression to output ticks.
  // Exact comparison makes any differing native rounding a reported finding.
  const times = items.map(frame => { const n = (BigInt(frame.pts) * tn * shift.d - shift.n * td) * out.d, d = td * shift.d * out.n; return reduced(n / d * out.n, out.d); });
  return { count: items.length, orderedPtsSha256: sha(times.map(value => `${value}\n`).join('')), times,
    originPolicy: plan.expectedOutput.timestampOrigins?.policy || 'historical-binary64-common-origin', sourceFirstFrame: items[0], sourceLastFrame: items.at(-1) };
}
function compareDecodedFrames(frames, oldFrames, kind, { changedOriginPolicy = false } = {}) {
  assert.equal(frames.length, oldFrames.length, 'Decoded frame counts agree');
  const required = kind === 'audio' ? ['pts', 'nb_samples'] : ['pts'];
  const common = [...required.filter(key => !changedOriginPolicy || key !== 'pts'), ...['duration', 'pkt_duration'].filter(key => frames.every(frame => Object.hasOwn(frame, key)) && oldFrames.every(frame => Object.hasOwn(frame, key)))];
  for (const key of required) assert.ok(frames.every(frame => Object.hasOwn(frame, key)) && oldFrames.every(frame => Object.hasOwn(frame, key)), `Required shared decoded ${key} evidence`);
  const shape = frame => Object.fromEntries(common.map(key => [key, frame[key]]));
  assert.deepEqual(frames.map(shape), oldFrames.map(shape), 'Shared recorded output frame/sample timeline agrees');
  return { comparedFields: common, frameCount: frames.length,
    ...(changedOriginPolicy ? { historicalTimestampComparison: 'observation-only; integer-origin policy changed. New timestamps require independent source/encoder/mux checks.',
      historicalPtsDifferences: frames.flatMap((frame, index) => frame.pts === oldFrames[index].pts ? [] : [{ index, old: oldFrames[index].pts, actual: frame.pts }]) } : {}),
    newOnlyDuration: !common.includes('duration') ? frames.map(frame => frame.duration ?? null) : null,
    note: 'Missing historical fields are unavailable observations, not zero/null duration claims.' };
}
function nearestInteger(n, d) { let q = n / d; const r = n % d; if ((r < 0n ? -r : r) * 2n >= d) q += n < 0n ? -1n : 1n; return q; }
function diagnoseAudioTiming(text, rate) {
  let previous = null;
  const discontinuities = [], offsets = new Map();
  for (const line of text.trimEnd().split(/\r?\n/)) {
    const cells = line.split('\t'); assert.equal(cells[1], 'a');
    const [tn, td] = cells[6].split('/').map(BigInt), pts = BigInt(cells[7]), sn = BigInt(cells[10]), samples = BigInt(cells[11]);
    const offset = reduced(pts * tn * BigInt(rate) - sn * td, td);
    offsets.set(offset, (offsets.get(offset) || 0) + 1);
    if (previous) {
      const gapN = pts * tn * previous.d * BigInt(rate) - (previous.pts * previous.n * BigInt(rate) + previous.samples * previous.d) * td;
      if (gapN !== 0n) {
        assert.ok(discontinuities.length < 32, 'Bounded timing diagnostics');
        discontinuities.push({ n: cells[4], pts: cells[7], sampleOffset: cells[10], previousN: previous.index,
          gapInSamples: reduced(gapN, td * previous.d), inputPts: cells[9], inputTimeBase: cells[8] });
      }
    }
    previous = { pts, n: tn, d: td, samples, index: cells[4] };
  }
  return { timestampMinusSampleOffset: Object.fromEntries(offsets), discontinuities,
    note: 'A timestamp discontinuity does not by itself prove missing PCM; sample count and content are separate evidence.' };
}
function floatingRebaseObservation(start, rate, samplePts) {
  const a = ratio(start), exactN = a.n * BigInt(rate), exactD = a.d;
  const floatingOrigin = (Number(a.n) / Number(a.d)) / (1 / rate);
  return { rate, exactOriginInSampleTicks: reduced(exactN, exactD), evaluatedBinary64Origin: floatingOrigin,
    examples: samplePts.map(pts => ({ inputPts: String(pts), binary64Expression: Number(pts) - floatingOrigin,
      truncatedBinary64Pts: Math.trunc(Number(pts) - floatingOrigin), exactTruncatedPts: String((BigInt(pts) * exactD - exactN) / exactD) })),
    interpretation: 'Binary64 expression followed by integer truncation can shift later frames even when the exact origin is an integer. This diagnosis concerns timestamps; it does not establish missing content.',
    upstream: ['https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavfilter/setpts.c#L176',
      'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavfilter/setpts.c#L185',
      'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavfilter/filters.h#L450'] };
}
async function compareCaseEvidence(item, original, source, previous, mode, plan) {
  item.comparisons = [];
  for (const record of item.receipt.streams) {
    const stats = record.summary, mapping = plan.expectedOutput.streams.find(s => s.outputIndex === stats.stream.outputIndex);
    const frames = item.outputDecodedProbe.frames.filter(frame => frame.stream_index === mapping.outputIndex);
    const oldFrames = previous.observations.rawDecodedFrames.filter(frame => frame.stream_index === mapping.outputIndex);
    const comparison = { outputIndex: mapping.outputIndex, kind: mapping.codecType, checks: [] }; item.comparisons.push(comparison);
    const check = (id, action) => { try { const value = action(); comparison.checks.push({ id, status: 'passed', ...(value !== undefined ? { observation: value } : {}) }); } catch (error) { comparison.checks.push({ id, status: 'failed', failure: errorRecord(error) }); } };
    check('monotonic-encoder-input-pts', () => { assert.equal(stats.backwardsPts, '0'); assert.equal(stats.repeatedPts, '0'); });
    check('shared-decoded-fields', () => compareDecodedFrames(frames, oldFrames, mapping.codecType, { changedOriginPolicy: Boolean(plan.expectedOutput.timestampOrigins) }));
    if (mapping.codecType === 'video') {
      comparison.expected = selectedVideo(source, plan, stats.first.timeBase);
      check('exact-rational-video-frame-membership', () => { assert.equal(stats.records, String(comparison.expected.count)); assert.equal(frames.length, comparison.expected.count); });
      check('exact-rational-video-rebased-pts', () => assert.equal(stats.hashes.orderedPts, comparison.expected.orderedPtsSha256));
      if (plan.expectedOutput.timestampOrigins) check('decoded-video-mux-timestamp-quantization', () => {
        const outputStream = item.outputDecodedProbe.streams.find(stream => stream.index === mapping.outputIndex), [n, d] = outputStream.time_base.split('/').map(BigInt);
        const predicted = comparison.expected.times.map(time => { const [a, b] = time.split('/').map(BigInt); return String(nearestInteger(a * d, b * n)); });
        assert.deepEqual(frames.map(frame => String(frame.pts)), predicted, 'Decoded frame PTS must equal the observed mux timebase nearest-tick mapping of independently expected encoder PTS');
        return { outputTimeBase: outputStream.time_base, mapping: 'nearest-tick-ties-away-from-zero', independentlyPredictedPts: predicted };
      });
    } else {
      const index = source.audio.findIndex(audio => audio.stream.index === mapping.inputIndex), saved = source.audio[index];
      const pcmFile = path.join(OLD_STAGE, `timeline-source-a${index}.s16le`), pcmReceipt = await receipt(pcmFile);
      assert.equal(pcmReceipt.sha256, original.artifacts[pcmFile].sha256, 'Retained source PCM receipt');
      const selected = selectedPcm({ stream: saved.stream, items: saved.frames, bytes: await fs.readFile(pcmFile) }, plan.contract.range.absoluteStart, plan.contract.range.absoluteEnd);
      const outputSamples = frames.reduce((sum, frame) => sum + Number(frame.nb_samples), 0);
      Object.assign(comparison, { sourcePcmReceipt: pcmReceipt, selectedSourceSamples: selected.samples, encoderInputSamples: stats.sampleCount,
        decodedOutputSamples: outputSamples, decodedMinusInputSamples: outputSamples - selected.samples, audioEncoderFrameCount: stats.records,
        firstEncoderPts: stats.first.time, lastEncoderEnd: stats.last.endTime });
      const log = await receipt(record.path); assert.equal(log.sha256, stats.hashes.raw, 'Timing diagnostic log receipt');
      comparison.timingDetails = diagnoseAudioTiming(await fs.readFile(record.path, 'ascii'), stats.stream.sampleRate);
      const boundary = ratio(plan.contract.range.absoluteStart), sampleRate = BigInt(stats.stream.sampleRate);
      const firstSample = (boundary.n * sampleRate + boundary.d - 1n) / boundary.d;
      // The retained fixture uses 1/sample_rate input ticks. Record the actual
      // next source-frame PTS rather than inventing a nominal frame length.
      if (saved.stream.time_base === `1/${stats.stream.sampleRate}`) {
        const next = saved.frames.find(frame => BigInt(frame.pts) > firstSample);
        comparison.rebaseArithmetic = floatingRebaseObservation(plan.contract.range.absoluteStart, stats.stream.sampleRate, [firstSample, BigInt(next.pts)]);
      }
      assert.equal((await receipt(record.path)).sha256, log.sha256, 'Timing log stayed unchanged');
      check('exact-selected-source-samples', () => assert.equal(stats.sampleCount, String(selected.samples)));
      check('continuous-encoder-input-audio-timestamps', () => assert.equal(stats.audioDiscontinuities, '0'));
      if (plan.expectedOutput.timestampOrigins) check('declared-integer-audio-origin-and-exclusive-end', () => {
        const origin = plan.expectedOutput.timestampOrigins.audio.find(item => item.inputIndex === mapping.inputIndex);
        const end = ratio(plan.contract.range.absoluteEnd), lastSample = (end.n * sampleRate + end.d - 1n) / end.d;
        assert.equal(saved.stream.time_base, `1/${stats.stream.sampleRate}`); assert.equal(selected.samples, Number(lastSample - firstSample), 'This retained fixture interval must be continuous');
        const firstExpected = reduced(firstSample - BigInt(origin.originTicks), sampleRate), lastExpected = reduced(lastSample - BigInt(origin.originTicks), sampleRate);
        assert.equal(`${stats.first.time.numerator}/${stats.first.time.denominator}`, firstExpected);
        assert.equal(`${stats.last.endTime.numerator}/${stats.last.endTime.denominator}`, lastExpected);
        return { firstExpected, exclusiveEndExpected: lastExpected, declaredOrigin: origin };
      });
      if (mode === 'flac') check('exact-flac-decoded-sample-count', () => assert.equal(outputSamples, selected.samples));
    }
  }
  item.status = item.comparisons.every(comparison => comparison.checks.every(check => check.status === 'passed')) ? 'passed' : 'failed';
}
async function executeCase(original, source, mode) {
  const id = `${mode}-held-out-late-vfr`, previous = original.cases.find(item => item.id === id); assert.ok(previous);
  const stage = await createStage(outputRoot), outputId = randomUUID();
  const request = resolveFileRequest({ fileId: `telemetry-${mode}`, identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: `precision-${mode}` } });
  const plan = buildEncodeOperation({ input: SOURCE, output: stage.file, settings: previous.settings, inspection: source.inspection, request, outputId, runtimeIdentity: RUNTIME_ID });
  const streams = plan.expectedOutput.streams.map(mapping => ({ outputIndex: mapping.outputIndex, kind: mapping.codecType,
    ...(mapping.codecType === 'audio' ? { sampleRate: Number(source.inspection.probe.streams.find(s => s.index === mapping.inputIndex).sample_rate) } : {}) }));
  const telemetry = await createOperationTelemetry({ stageDirectory: stage.directory, runtimeIdentity: RUNTIME_ID, planFingerprint: plan.planFingerprint, streams, maxBytes: 4 * 1024 * 1024, maxRecords: 10000 });
  const item = { id, status: 'running', stage, plan, telemetry, priorDecodedEvidenceCase: previous.id }; report.cases.push(item); await save();
  try {
    await assertTelemetryReady(telemetry);
    const argv = [...plan.args.slice(0, -1), ...telemetry.ffmpegArgs, plan.args.at(-1)]; item.executedArgs = argv;
    await run(TOOLS.ffmpeg, argv);
    item.receipt = await collectOperationTelemetry(telemetry, { completion: { childClosed: children.size === 0, exitCode: 0, cancelled: false }, signal: controller.signal });
    item.output = await receipt(stage.file);
    const result = await run(TOOLS.ffprobe, ['-v', 'error', '-show_streams', '-show_frames', '-show_format', '-of', 'json', '-i', stage.file]);
    const decoded = JSON.parse(result.stdout); item.outputDecodedProbe = decoded;
    await compareCaseEvidence(item, original, source, previous, mode, plan);
  } catch (error) { item.status = 'failed'; item.failure = errorRecord(error); }
  finally { assert.equal(children.size, 0); await closeOperationTelemetry(telemetry, { childClosed: true }); item.finishedAt = new Date().toISOString(); await save(); }
}
async function recheck(id) {
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const originalRun = path.join(ROOT, 'artifacts/v0.7/telemetry', id, 'report.json'); allowed.add(originalRun);
  const checked = { schema: 1, id: randomUUID(), startedAt: new Date().toISOString(), mode: 'retained-evidence-recheck', childProcessesLaunched: 0,
    originalRun: await receipt(originalRun), status: 'running', cases: [],
    correction: 'Compare required PTS/audio samples and only optional fields actually present in both saved probes. Record newly available duration without inventing an old value.',
    limits: ['No encode, probe, version query, source decode or benchmark execution.', 'Recorded native probe snapshots are reused, not independently decoded again.',
      'Statistics are not decoded-content hashes; FLAC content proof remains the separate retained-evidence recheck.', 'All timing assertions remain strict; additional discovered discontinuities are failures, not widened tolerances.'] };
  const native = JSON.parse(await fs.readFile(originalRun, 'utf8')); assert.equal(native.id, id); assert.equal(native.invocations.length, 6);
  assert.ok(native.invocations.every(call => call.status === 'completed' && call.exitCode === 0), 'Original six children completed');
  checked.originalDecodeReport = await receipt(ORIGINAL); assert.equal(checked.originalDecodeReport.sha256, native.originalReport.sha256);
  const original = JSON.parse(await fs.readFile(ORIGINAL, 'utf8')), source = original.sourceEvidence.timeline;
  checked.sourceReceipt = await receipt(SOURCE); assert.equal(checked.sourceReceipt.sha256, native.sourceBefore.sha256);
  checked.modules = []; for (const file of HASHABLE_MODULES) checked.modules.push(await receipt(path.join(ROOT, file)));
  // Only the harness changed. The same builder/source evidence and exact argv
  // must still describe each completed output; no rebranding unknown work.
  for (const module of checked.modules.filter(item => !item.path.endsWith('scripts\\v07-telemetry-smoke.cjs'))) {
    assert.equal(module.sha256, native.modules.find(item => item.path === module.path)?.sha256, `Unchanged supporting module: ${module.path}`);
  }
  outputRoot = path.join(OWNED, 'outputs', `telemetry-${id}`);
  for (const saved of native.cases) {
    const mode = saved.id.startsWith('aac-') ? 'aac' : 'flac', previous = original.cases.find(item => item.id === saved.id);
    const item = { id: saved.id, originalFailure: saved.failure, status: 'running', outputReceipt: await receipt(saved.output.path), receipt: structuredClone(saved.receipt), outputDecodedProbe: saved.outputDecodedProbe };
    assert.equal(item.outputReceipt.sha256, saved.output.sha256, 'Unchanged completed output'); assert.equal(item.outputReceipt.bytes, saved.output.bytes);
    const outputId = saved.plan.args.find(arg => arg.startsWith('FFMPEG_ENCODER_OUTPUT_ID=')).split('=')[1];
    const plan = buildEncodeOperation({ input: SOURCE, output: saved.stage.file, settings: previous.settings, inspection: source.inspection,
      request: resolveFileRequest({ fileId: `telemetry-${mode}`, identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: `precision-${mode}` } }), outputId, runtimeIdentity: RUNTIME_ID });
    assert.deepEqual(plan.args, saved.plan.args); assert.equal(plan.planFingerprint, saved.plan.planFingerprint);
    const invocation = native.invocations.find(call => call.executable === TOOLS.ffmpeg && call.argv.at(-1) === saved.stage.file);
    assert.deepEqual(invocation.argv, [...plan.args.slice(0, -1), ...saved.telemetry.ffmpegArgs, plan.args.at(-1)], 'Original executed command is canonical builder plus recorded stats options');
    const probe = native.invocations.find(call => call.executable === TOOLS.ffprobe && call.argv.at(-1) === saved.stage.file);
    assert.deepEqual(JSON.parse(probe.stdout), saved.outputDecodedProbe, 'Saved probe belongs to the recorded child output');
    item.verifiedStatsReceipts = [];
    for (const record of item.receipt.streams) {
      const before = await receipt(record.path); assert.equal(before.sha256, record.summary.hashes.raw); assert.equal(before.bytes, record.summary.bytes);
      const summary = await summarizeTelemetry(createReadStream(record.path, { highWaterMark: 65536 }), record.summary.stream, { maxBytes: 4 * 1024 * 1024, maxRecords: 10000 });
      assert.deepEqual(summary, record.summary, 'Reparsed retained stats agree with native receipt');
      assert.deepEqual(await receipt(record.path), before, 'Retained stats stayed stable while reading'); item.verifiedStatsReceipts.push(before);
    }
    await compareCaseEvidence(item, original, source, previous, mode, plan); checked.cases.push(item);
  }
  assert.equal((await receipt(originalRun)).sha256, checked.originalRun.sha256, 'Original failed report remains unchanged');
  assert.equal((await receipt(ORIGINAL)).sha256, checked.originalDecodeReport.sha256);
  checked.status = checked.cases.length === 2 && checked.cases.every(item => item.status === 'passed') ? 'passed' : 'failed'; checked.finishedAt = new Date().toISOString();
  const directory = path.join(ROOT, 'artifacts/v0.7/telemetry/rechecks'); await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${checked.finishedAt.replace(/[:.]/g, '-')}-${checked.id}.json`);
  const bytes = Buffer.from(JSON.stringify(checked, null, 2)); assert.ok(bytes.length < 16 * 1024 * 1024); await fs.writeFile(destination, bytes, { flag: 'wx' });
  console.log(JSON.stringify({ report: destination, status: checked.status, childProcessesLaunched: 0, failures: checked.cases.flatMap(item => item.comparisons.flatMap(c => c.checks.filter(check => check.status === 'failed').map(check => ({ case: item.id, stream: c.outputIndex, check: check.id, failure: check.failure })))) }));
  if (checked.status !== 'passed') process.exitCode = 1;
}
async function main() {
  if (process.argv[2] === '--recheck') { assert.equal(process.argv.length, 4); return recheck(process.argv[3]); }
  assert.deepEqual(process.argv.slice(2), ['--parent-granted-media-slot'], 'This harness requires the parent media slot; no media or writes otherwise.');
  const id = randomUUID(), base = path.join(ROOT, 'artifacts/v0.7/telemetry');
  report = { schema: 1, id, startedAt: new Date().toISOString(), purpose: 'Short owned-fixture encoder-input statistics qualification', status: 'running', maxConcurrentChildren: 0, invocations: [], cases: [],
    bounds: { cases: 2, encodedSecondsPerCase: 2.074, maxInvocations: 8, maxWallSeconds: 600, outputForecastBytes: 256 * 1024 * 1024 },
    limits: ['No personal media, benchmark work, publication or service enablement.', 'Encoder statistics are not decoded-content hashes or successful-output proof.',
      'Only libx264 lossless SDR, two PCM-source audio tracks at48k/44.1k, AAC/FLAC and MKV are exercised.', 'Stats log open has the normal same-user stage TOCTOU limit; persistent replacement is rejected.',
      'Existing failed013 and later corrected FLAC/AAC recheck evidence remain untouched.'] };
  await fs.mkdir(base, { recursive: true }); const reportDir = path.join(base, id); await fs.mkdir(reportDir); reportFile = path.join(reportDir, 'report.json'); await save();
  const timeout = setTimeout(() => controller.abort(), 600000); timeout.unref();
  const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acquire();
    report.freeSpace = {};
    for (const [label, folder] of [['D', ROOT], ['F', OWNED]]) { const s = await fs.statfs(folder, { bigint: true }); report.freeSpace[label] = String(s.bavail * s.bsize); }
    assert.ok(BigInt(report.freeSpace.D) >= 25n * 1024n ** 3n && BigInt(report.freeSpace.F) >= 768n * 1024n ** 2n, 'Reserve and bounded forecast');
    report.modules = []; for (const file of HASHABLE_MODULES) report.modules.push(await receipt(path.join(ROOT, file)));
    report.originalReport = await receipt(ORIGINAL); const original = JSON.parse(await fs.readFile(ORIGINAL, 'utf8'));
    report.sourceBefore = await receipt(SOURCE); assert.equal(report.sourceBefore.sha256, original.artifacts[SOURCE].sha256);
    report.runtime = {};
    for (const name of ['ffmpeg', 'ffprobe']) { const record = await receipt(TOOLS[name]); assert.equal(record.sha256, PIN[name]); const result = await run(TOOLS[name], ['-version']); assert.match(result.stdout, new RegExp(`${name} version 9\\.0\\.2`)); report.runtime[name] = { ...record, version: result.stdout }; }
    outputRoot = path.join(OWNED, 'outputs', `telemetry-${id}`); await fs.mkdir(outputRoot);
    for (const mode of ['aac', 'flac']) { await executeCase(original, original.sourceEvidence.timeline, mode); if (controller.signal.aborted) break; }
    report.sourceAfter = await receipt(SOURCE); assert.equal(report.sourceAfter.sha256, report.sourceBefore.sha256); assert.deepEqual(report.sourceAfter.identity, report.sourceBefore.identity);
    report.status = report.cases.length === 2 && report.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
  } catch (error) { report.status = 'failed'; report.failure = errorRecord(error); }
  finally { clearTimeout(timeout); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await release(); report.finishedAt = new Date().toISOString(); await save(); }
  console.log(JSON.stringify({ report: reportFile, status: report.status, cases: report.cases.map(({ id, status, failure }) => ({ id, status, failure })) }));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { selectedVideo, compareDecodedFrames, diagnoseAudioTiming, floatingRebaseObservation };
