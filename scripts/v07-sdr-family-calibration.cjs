'use strict';

// Explicit parent-run pre-catalog qualification. Owned generated fixtures only;
// every output remains a sealed, unvalidated stage. Nothing is published or
// registered with the application, and importing this module launches no job.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { runTool, boundedToolStderr } = require('../src/process-runner.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { buildEncodeOperation, fingerprintEncodeSource, withEncodeOperationTelemetry,
  resolveEncodeOperationInvocation, validateEncodeOperationTelemetry, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { collectOperationEvidence, evidenceFailure } = require('../src/operation-evidence.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { createStage, sealStage, retainSealedStage } = require('../src/outputs.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { PROFILES, describeRecipe } = require('../src/media.cjs');
const { generationDescriptionOf, classifyMarker } = require('../src/provenance.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');

const ROOT = path.resolve(__dirname, '..'), MiB = 1024 ** 2, GiB = 1024 ** 3;
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const FIXTURE_ID = '6b317682-605b-4d40-8ff3-b3f84678f0ae';
const FIXTURE_REPORT = path.join(ROOT, 'artifacts', 'v0.7', 'slice2', 'envelope-fixtures', FIXTURE_ID, 'report.json');
const FIXTURE_REPORT_SHA = '17f7e802480f092093f5dcaebc61f78c0710a5fc36b444f016933871c4e647a9';
const SOURCE_ROOT = path.join(OWNED, 'fixtures', `sdr-envelope-${FIXTURE_ID}`);
const LEASE = path.join(ROOT, 'artifacts', 'v0.7', 'media-job.lock');
const MODULES = ['scripts/v07-sdr-family-calibration.cjs', 'src/candidate-runtime.cjs', 'src/encode-operation.cjs',
  'src/operation-evidence.cjs', 'src/operation-telemetry.cjs', 'src/operation-contract.cjs', 'src/inspection.cjs',
  'src/media-evidence.cjs', 'src/media.cjs', 'src/outputs.cjs', 'src/process-runner.cjs', 'src/provenance.cjs',
  'src/source-identity.cjs', 'src/operation-controls.cjs', 'src/operation-family.cjs', 'src/container-clock.cjs', 'package.json'];
const SPECS = Object.freeze([
  { id: 'A', width: 1920, height: 1080, fps: 30, seconds: 10, container: 'mp4', range: { startUs: 0, endUs: 500000 }, resolution: 'source' },
  { id: 'B', width: 1280, height: 720, fps: 30, seconds: 8, container: 'mov', range: { endUs: 7987000 }, resolution: 'source' },
  { id: 'C', width: 1280, height: 720, fps: 60, seconds: 32, container: 'mp4', range: { startUs: 2000000 }, resolution: 'source' },
  { id: 'D', width: 1920, height: 1080, fps: 60, seconds: 120, container: 'mov', range: { startUs: 90013000, endUs: 120000000 }, resolution: '720' },
  { id: 'E', width: 1920, height: 1080, fps: 30, seconds: 31, container: 'mov', range: { startUs: 1013000, endUs: 3087000 }, resolution: '720' },
  // Same attested source as D, distinct output geometry/cost. This is the
  // otherwise unmeasured1080p60 Keep Source tuple, not a repeat of resized D.
  { id: 'D-keep', sourceId: 'D', width: 1920, height: 1080, fps: 60, seconds: 120, container: 'mov', range: { startUs: 90013000, endUs: 120000000 }, resolution: 'source' },
]);
const LIMITS = Object.freeze({ totalMs: 40 * 60000, perCaseMs: 600000, perChildMs: 120000, childrenPerCase: 32,
  forecastBytes: GiB, minimumDFreeBytes: 25 * GiB, minimumFFreeBytes: 512 * MiB, reportBytes: 32 * MiB,
  maximumSourceBytes: 512 * MiB, telemetryBytes: 8 * MiB, telemetryRecords: 20000, monitorMs: 1000 });
const SIGNAL = Object.freeze({ format: 'f32le-interleaved', channels: 2, sampleRate: 48000, windowSamples: 4096,
  lagRadiusSamples: 2048, coarseLagStep: 16, coarseSampleStride: 8, fractions: [0, 0.25, 0.5, 0.75, 1],
  minimumCorrelation: 0.90, maximumNormalizedRmsError: 0.45, maximumCrossChannelCorrelation: 0.80,
  minimumChannelSeparation: 0.10, maximumAcceptedLagSamples: 0, tieEpsilon: 1e-12 });
const sameObject = (a, b) => a && b && a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const ordinary = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n;
const stamp = stat => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => { const relative = path.relative(root, file); return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const fault = (code, message) => Object.assign(new Error(message), { code });
const errorRecord = error => ({ ...evidenceFailure(error), ...(typeof error?.stderr === 'string' ? boundedToolStderr(error, 256 * 1024) : {}),
  ...(error?.evidenceDirectory ? { evidenceDirectory: error.evidenceDirectory, evidenceReceipt: error.evidenceReceipt } : {}) });
const rational = value => {
  const match = /^(-?\d+)\/([1-9]\d*)$/.exec(String(value)); assert.ok(match, 'Exact rational required'); return { n: BigInt(match[1]), d: BigInt(match[2]) };
};
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const packed = value => ({ n: BigInt(value.n), d: BigInt(value.d) });
const compare = (a, b) => a.n * b.d - b.n * a.d;
const ceilUs = value => { assert.ok(value.n >= 0n && value.d > 0n); return Number((value.n * 1000000n + value.d - 1n) / value.d); };

function parseArgs(argv) {
  assert.ok(argv.length === 5 || argv.length === 7, 'Require explicit fixture/profile; optional --cases selects only the explicitly retained unfinished cells.');
  assert.equal(argv[0], '--run-owned-calibration'); assert.equal(argv[1], '--fixtures'); assert.equal(argv[3], '--profile');
  assert.ok(path.isAbsolute(argv[2]) && path.resolve(argv[2]) === FIXTURE_REPORT, 'Only the exact newly generated fixture report is allowed');
  assert.ok(['h265-cpu', 'h265-nvidia'].includes(argv[4]), 'Choose one explicit CPU or NVIDIA profile');
  if (argv.length === 7) assert.ok(argv[5] === '--cases' && (argv[4] === 'h265-cpu' && argv[6] === 'C,D,E'
    || argv[4] === 'h265-nvidia' && argv[6] === 'B,C,D' || argv[6] === 'D-keep'), 'Only exact unfinished cells or the distinct D-keep output tuple may be selected.');
  return { profileId: argv[4], preset: argv[4] === 'h265-cpu' ? 'slow' : 'p5', quality: 25 };
}

function frozenQualifications(id, runtimeIdentity, probe) {
  // These bounds are fixed BEFORE encoding. The expected Matroska tick and
  // native AAC terminal block allowance are hypotheses under test, never fitted
  // to observed candidate errors. Different output time bases fail this trial.
  const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const videoTick = rational(video.time_base), audioTick = rational(audio.time_base), outputTick = rational('1/1000'), sample = rational('1/48000');
  const videoUs = ceilUs(add(add(videoTick, outputTick), rational('1/1000000')));
  const audioClockUs = ceilUs(add(add(audioTick, sample), outputTick));
  const terminalSamples = 1023, audioUs = ceilUs(rational(`${terminalSamples}/48000`)) + audioClockUs;
  return { frozenBeforeEncode: true, expectedOutputTimeBase: '1/1000',
    derivation: { sourceVideoTimeBase: video.time_base, sourceAudioTimeBase: audio.time_base, outputTimeBaseHypothesis: '1/1000',
      video: 'source tick + fixed output tick + one microsecond representation allowance',
      audioInterior: 'source audio tick + one source sample + fixed output tick',
      audioEndpoint: 'at most1023 terminal AAC block samples + audio interior quantization; no source sample shortage permitted',
      countAllowanceIsNotSignalledPadding: true, noObservedCandidateErrorUsed: true },
    qualification: { evidenceId: `${id}:endpoints`, runtimeIdentity, containerDuration: 'matroska-packet-end-plus-codec-delay',
      tolerances: { videoTimestampUs: videoUs, audioTimestampUs: audioUs, avSyncUs: videoUs + audioUs,
        durationUs: videoUs + ceilUs(sample), sampleCount: terminalSamples } },
    timingQualification: { evidenceId: `${id}:interior`, runtimeIdentity, videoDurationUs: videoUs, audioTimelineUs: audioClockUs,
      aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } } };
}

function checkCompleteSource(entry, spec) {
  const complete = entry.collection.completeSource, video = complete.video, audio = complete.audio[0];
  assert.equal(complete.audio.length, 1); assert.equal(video.frames, spec.seconds * spec.fps);
  assert.deepEqual(video.properties, { policy: 'short-sdr-range-v1', sampleAspectRatio: '1:1', chromaLocation: 'left',
    sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: video.frames }, 'Every complete source frame must receive the frozen property checks');
  assert.equal(packed(video.firstTime).n, 0n); assert.ok(compare(packed(video.endTime), rational('120/1')) <= 0);
  const sourceVideo = entry.inspection.probe.streams.find(stream => stream.codec_type === 'video');
  const tick = ceilUs(rational(sourceVideo.time_base));
  assert.ok(video.maximumNominalCadenceErrorUs <= tick && video.maximumNominalDurationErrorUs <= tick
    && video.maximumNominalPhaseErrorUs <= tick);
  assert.equal(audio.inputIndex, entry.plan.expectedOutput.streams.find(stream => stream.codecType === 'audio').inputIndex);
  entry.sourceExtentAssessment = { maximumSeconds: 120, actualVideoEnd: video.endTime, actualAudioEnd: audio.endTime,
    actualAudioSamples: audio.sampleCount, actualAudioGaps: audio.gaps, audioExcessBeyond120Us: Math.max(0, ceilUs(packed(audio.endTime)) - 120000000),
    valid: packed(audio.firstTime).n === 0n && audio.gaps === 0 && BigInt(audio.sampleCount) <= 120n * 48000n
      && compare(packed(audio.endTime), rational('120/1')) <= 0 };
  assert.equal(entry.sourceExtentAssessment.valid, true, 'Complete decoded source audio exceeds the frozen120s/zero-origin/continuous family boundary');
}

function matchedSignal(source, output) {
  assert.equal(source.length % 8, 0); assert.equal(output.length % 8, 0);
  const count = Math.min(source.length, output.length) / 8, width = SIGNAL.windowSamples, radius = SIGNAL.lagRadiusSamples;
  assert.ok(count >= radius * 2 + width, 'Not enough independently decoded common PCM for fixed windows');
  const value = (bytes, index, channel) => { const sample = bytes.readFloatLE(index * 8 + channel * 4); assert.ok(Number.isFinite(sample)); return sample; };
  function score(start, channel, otherChannel, lag, stride = 1) {
    let dot = 0, a2 = 0, b2 = 0, squared = 0;
    for (let index = start; index < start + width; index += stride) {
      const a = value(source, index, channel), b = value(output, index + lag, otherChannel);
      dot += a * b; a2 += a * a; b2 += b * b; squared += (a - b) ** 2;
    }
    assert.ok(a2 > 1e-12 && b2 > 1e-12, 'Silent/degenerate signal is not alignment evidence');
    return { lagSamples: lag, correlation: dot / Math.sqrt(a2 * b2), normalizedRmsError: Math.sqrt(squared / a2) };
  }
  function lagDiagnostic(start, channel) {
    let best = null;
    const consider = candidate => { if (!best || candidate.correlation > best.correlation + SIGNAL.tieEpsilon
      || Math.abs(candidate.correlation - best.correlation) <= SIGNAL.tieEpsilon && Math.abs(candidate.lagSamples) < Math.abs(best.lagSamples)) best = candidate; };
    for (let lag = -radius; lag <= radius; lag += SIGNAL.coarseLagStep) consider(score(start, channel, channel, lag, SIGNAL.coarseSampleStride));
    const center = best.lagSamples; best = null;
    for (let lag = Math.max(-radius, center - SIGNAL.coarseLagStep + 1); lag <= Math.min(radius, center + SIGNAL.coarseLagStep - 1); lag++) consider(score(start, channel, channel, lag));
    // Zero is evaluated even if a distant coarse alias won. No shift is applied
    // to the acceptance comparison; a nonzero best lag remains a failure.
    consider(score(start, channel, channel, 0)); return best;
  }
  const span = count - width - radius * 2;
  const starts = [...new Set(SIGNAL.fractions.map(fraction => radius + Math.floor(span * fraction)))];
  const windows = [0, ...starts].map(start => ({ startSample: start, samples: width, channels: [0, 1].map(channel => {
    const zeroLag = score(start, channel, channel, 0), crossChannel = score(start, channel, 1 - channel, 0);
    const bestLag = start === 0 ? null : lagDiagnostic(start, channel);
    return { channel, zeroLag, crossChannelCorrelation: crossChannel.correlation, bestLag,
      valid: zeroLag.correlation >= SIGNAL.minimumCorrelation && zeroLag.normalizedRmsError <= SIGNAL.maximumNormalizedRmsError
        && Math.abs(crossChannel.correlation) <= SIGNAL.maximumCrossChannelCorrelation
        && zeroLag.correlation - Math.abs(crossChannel.correlation) >= SIGNAL.minimumChannelSeparation
        && (!bestLag || bestLag.lagSamples === SIGNAL.maximumAcceptedLagSamples) };
  }) }));
  return { scope: 'channel-specific-gross-signal-and-decoder-alignment-only', thresholdsFrozenBeforeEncode: SIGNAL,
    commonSamples: count, sourceSamples: source.length / 8, outputSamples: output.length / 8, windows,
    valid: windows.every(window => window.channels.every(channel => channel.valid)),
    limitations: ['No fitted shift or independent timestamp zeroing is applied.', 'First common window starts at sample0; lag searches use fixed2048-sample margins.',
      'AAC waveform identity, inaudibility, perceptual quality and unexamined signal content are not established.'] };
}

async function main(argv = process.argv.slice(2)) {
  const settings = parseArgs(argv); assert.equal(process.platform, 'win32');
  assert.deepEqual(EVIDENCE_BUDGET, { sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8 * MiB,
    maxPcmBytes: 128 * MiB, maxRecords: 20000, maxSpoolBytes: 32 * MiB });
  assert.equal(EXECUTION_BUDGET_MS, LIMITS.perCaseMs);
  const id = randomUUID(), started = Date.now(), whole = new AbortController(), children = new Set(), tracked = [], telemetryHandles = [];
  const directory = path.join(ROOT, 'artifacts', 'v0.7', 'slice2', 'family-calibration', id), reportFile = path.join(directory, 'report.json');
  const ownedRoot = path.join(OWNED, 'staging', `sdr-family-calibration-${id}`), mediaInputs = new Set(), pendingEncodes = new Map(), directories = [];
  const report = { schema: 1, id, status: 'preparing', purpose: 'Owned representative SDR range calibration for one exact profile; no catalog activation or publication',
    startedAt: new Date(started).toISOString(), settings, directory, ownedRoot, fixtureReport: FIXTURE_REPORT, fixtureReportSha256: FIXTURE_REPORT_SHA,
    limits: LIMITS, evidenceBudget: EVIDENCE_BUDGET, signalThresholds: SIGNAL, invocations: [], cases: [], maximumConcurrentChildren: 0,
    leaseReleased: false, publicationAuthorized: false, catalogActivationAuthorized: false, candidateFamily: null,
    limitations: ['Fresh production inspection/builder/telemetry/collector/validator paths are used; this is pre-catalog qualification, not normal application activation.',
      'All stages, PCM and failed evidence remain owned and retained; no publication, validation marking or cleanup is performed.',
      'Fixed windows are gross signal/alignment evidence, not lossless or perceptual audio acceptance.',
      'Resource polling detects observed growth and can overshoot between observations; it is not a hard filesystem quota.',
      'Runtime paths are fully hashed at entry/exit and stat-bound around children; CreateProcess still opens executable images by path.'] };
  let runtime, runtimeIdentity, pinnedTools, sourceReport, lease, leaseIdentity, leaseBytes, reportHandle, reportIdentity, currentCase,
    timer, monitor, monitorTask, monitoringFailure, fatalFailure, environment = null;
  const cancel = () => whole.abort(); process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  timer = setTimeout(cancel, LIMITS.totalMs); timer.unref();
  const activeSignal = () => currentCase ? AbortSignal.any([whole.signal, currentCase.controller.signal]) : whole.signal;
  function live() { if (whole.signal.aborted || Date.now() - started >= LIMITS.totalMs) throw fault('CALIBRATION_CANCELLED_OR_DEADLINE', 'Calibration cancelled or total40-minute budget expired'); }
  async function bind(file) { await assertOrdinaryPath(file, 'directory'); directories.push({ file, stat: await fs.lstat(file, { bigint: true }) }); }
  async function guard() { for (const entry of directories) { await assertOrdinaryPath(entry.file, 'directory'); assert.ok(sameObject(entry.stat, await fs.lstat(entry.file, { bigint: true }))); } }
  async function parents() {
    let here = ROOT; await bind(here);
    for (const name of ['artifacts', 'v0.7', 'slice2', 'family-calibration']) { here = path.join(here, name); try { await fs.mkdir(here); } catch (error) { if (error.code !== 'EEXIST') throw error; } await bind(here); }
    await fs.mkdir(directory); await bind(directory); await bind(OWNED); await bind(path.join(OWNED, 'staging')); await bind(SOURCE_ROOT);
  }
  async function save() {
    if (!reportHandle) return; await guard();
    assert.ok(sameFile(reportIdentity, await reportHandle.stat({ bigint: true })) && sameFile(reportIdentity, await fs.lstat(reportFile, { bigint: true })));
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n'); assert.ok(bytes.length <= LIMITS.reportBytes);
    for (let offset = 0; offset < bytes.length;) { const result = await reportHandle.write(bytes, offset, bytes.length - offset, offset); assert.ok(result.bytesWritten > 0); offset += result.bytesWritten; }
    await reportHandle.truncate(bytes.length); await reportHandle.sync(); reportIdentity = await reportHandle.stat({ bigint: true });
    assert.ok(ordinary(reportIdentity) && sameFile(reportIdentity, await fs.lstat(reportFile, { bigint: true })));
  }
  async function fileReceipt(file, maximum) {
    await assertOrdinaryPath(file); const before = await fs.lstat(file, { bigint: true }); assert.ok(ordinary(before) && before.size <= BigInt(maximum));
    const handle = await fs.open(file, 'r'), hash = createHash('sha256');
    try { assert.ok(sameFile(before, await handle.stat({ bigint: true })));
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: MiB })) { live(); hash.update(chunk); }
      assert.ok(sameFile(before, await handle.stat({ bigint: true })) && sameFile(before, await fs.lstat(file, { bigint: true })));
      return { path: file, bytes: Number(before.size), sha256: hash.digest('hex'), identity: stamp(before) };
    } finally { await handle.close(); }
  }
  async function moduleReceipts() { const result = {}; for (const name of MODULES) result[name] = await fileReceipt(path.join(ROOT, name), 2 * MiB); return result; }
  async function guardLease() { assert.ok(lease && leaseIdentity); const named = await fs.lstat(LEASE, { bigint: true }); assert.ok(ordinary(named) && sameFile(named, leaseIdentity) && sameFile(named, await lease.stat({ bigint: true }))); }
  async function acquire() {
    lease = await fs.open(LEASE, 'wx+'); const empty = await lease.stat({ bigint: true }); assert.ok(ordinary(empty) && empty.size === 0n && sameFile(empty, await fs.lstat(LEASE, { bigint: true })));
    leaseBytes = Buffer.from(JSON.stringify({ schema: 1, token: id, pid: process.pid, purpose: 'Slice2 SDR family pre-catalog calibration', startedAt: report.startedAt }) + '\n');
    await lease.writeFile(leaseBytes); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true }); await guardLease();
    report.lease = { path: LEASE, token: id, pid: process.pid, identity: stamp(leaseIdentity) };
  }
  async function release() {
    if (!lease) return;
    try { assert.ok(leaseIdentity && children.size === 0 && tracked.every(item => item.closed)); await guard(); await guardLease();
      const bytes = Buffer.alloc(leaseBytes.length + 1), read = await lease.read(bytes, 0, bytes.length, 0); assert.equal(read.bytesRead, leaseBytes.length); assert.ok(bytes.subarray(0, read.bytesRead).equals(leaseBytes));
      const owner = JSON.parse(bytes.subarray(0, read.bytesRead)); assert.equal(owner.token, id); assert.equal(owner.pid, process.pid);
      await guardLease(); await lease.close(); lease = null; assert.ok(sameFile(leaseIdentity, await fs.lstat(LEASE, { bigint: true }))); await fs.unlink(LEASE); report.leaseReleased = true;
    } catch (error) { report.leaseRetention = errorRecord(error); throw error; }
    finally { if (lease) { await lease.close().catch(() => {}); lease = null; } }
  }
  async function measure(initial = false) {
    await guard(); let bytes = 0, files = 0, entries = 0;
    async function walk(root, depth) {
      assert.ok(depth <= 6); let listing; try { listing = await fs.readdir(root); } catch (error) { if (error.code === 'ENOENT' && root === ownedRoot) return; throw error; }
      for (const name of listing) { assert.ok(++entries <= 512); const file = path.join(root, name), stat = await fs.lstat(file, { bigint: true });
        if (stat.isDirectory() && !stat.isSymbolicLink()) { await assertOrdinaryPath(file, 'directory'); await walk(file, depth + 1); }
        else { assert.ok(ordinary(stat) && await fs.realpath(file) === path.resolve(file)); bytes += Number(stat.size); files++; }
      }
    }
    await walk(ownedRoot, 0); const reportSize = reportHandle ? Number((await reportHandle.stat({ bigint: true })).size) : 0; bytes += reportSize; files += reportHandle ? 1 : 0;
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]), result = { observedAt: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize,
      FFreeBytes: f.bavail * f.bsize, ownedLogicalBytes: bytes, ownedFiles: files, observedEntries: entries, forecastAdditionalBytes: LIMITS.forecastBytes };
    assert.ok(result.DFreeBytes >= LIMITS.minimumDFreeBytes + (initial ? LIMITS.reportBytes : 0));
    assert.ok(result.FFreeBytes >= LIMITS.minimumFFreeBytes + (initial ? LIMITS.forecastBytes : 0)); assert.ok(bytes <= LIMITS.forecastBytes);
    report.maximumObservedOwnedLogicalBytes = Math.max(report.maximumObservedOwnedLogicalBytes || 0, bytes); return result;
  }
  async function tools() { const value = []; for (const name of ['ffmpeg', 'ffprobe']) { await assertOrdinaryPath(runtime[name]); value.push(stamp(await fs.lstat(runtime[name], { bigint: true }))); } return value; }
  const nvidiaExecutable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
  async function run(executable, args, options = {}, purpose = 'inspection-or-evidence') {
    live(); await guard(); await guardLease(); assert.equal(children.size, 0);
    assert.ok([runtime.ffmpeg, runtime.ffprobe, ...(settings.profileId === 'h265-nvidia' ? [nvidiaExecutable] : [])].includes(executable));
    assert.ok(args.every(value => typeof value === 'string') && !args.includes('-y'));
    if (currentCase) { assert.ok(++currentCase.children <= LIMITS.childrenPerCase); if (currentCase.controller.signal.aborted) throw fault('CALIBRATION_CASE_DEADLINE', 'Case budget expired'); }
    for (let i = 0; i < args.length; i++) if (args[i] === '-i') assert.ok(mediaInputs.has(args[i + 1]), 'Only exact attested generated sources or sealed owned outputs may be read');
    if (executable === runtime.ffmpeg && args.at(-1) !== 'pipe:1' && args[0] !== '-version') {
      assert.deepEqual(args, pendingEncodes.get(args.at(-1)), 'Only the exact canonical instrumented argv may encode');
      assert.ok(inside(ownedRoot, args.at(-1)) && args.includes('-n')); pendingEncodes.delete(args.at(-1));
      await fs.access(args.at(-1)).then(() => { throw fault('OUTPUT_EXISTS', 'Fresh owned stage unexpectedly exists'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
    const before = await tools(); assert.deepEqual(before, pinnedTools);
    const entry = { caseId: currentCase?.entry.id ?? null, purpose, executable, argv: [...args], status: 'running', startedAt: new Date().toISOString(), runtimeBefore: before };
    report.invocations.push(entry); await save(); const began = Date.now(); let child;
    try { live(); const remaining = Math.min(LIMITS.totalMs - (Date.now() - started), currentCase ? currentCase.deadline - Date.now() : LIMITS.perChildMs);
      assert.ok(remaining > 0); const result = await runTool(executable, args, { signal: activeSignal(),
        timeoutMs: Math.min(options.timeoutMs || LIMITS.perChildMs, LIMITS.perChildMs, remaining),
        stdoutLimit: Math.min(options.stdoutLimit ?? 8 * MiB, 128 * MiB), stderrLimit: Math.min(options.stderrLimit ?? 256 * 1024, 256 * 1024),
        ...(options.onStdoutChunk ? { onStdoutChunk: options.onStdoutChunk } : {}),
        onChild(value) { child = value; children.add(value); const observed = { child: value, closed: false }; tracked.push(observed);
          value.once('close', (code, signal) => { observed.closed = true; entry.close = { code, signal }; children.delete(value); });
          report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size); } });
      assert.equal(children.size, 0); assert.equal(result.exitCode, 0); assert.equal(result.stderrCapture.truncated, false);
      Object.assign(entry, { status: 'completed', exitCode: result.exitCode, ...boundedToolStderr(result, 256 * 1024), stdoutCapture: result.stdoutCapture,
        ...(options.onStdoutChunk ? {} : { stdout: result.stdout }) }); return result;
    } catch (error) { entry.status = 'failed'; entry.failure = errorRecord(error); throw error; }
    finally { if (child) assert.ok(tracked.find(item => item.child === child)?.closed, 'Unknown child close retains the lease');
      entry.elapsedMs = Date.now() - began; entry.finishedAt = new Date().toISOString(); entry.runtimeAfter = await tools();
      try { assert.deepEqual(entry.runtimeAfter, before); await guardLease(); } catch (error) { fatalFailure ||= error; whole.abort(); throw error; }
      await save(); }
  }
  async function gpu() {
    const argv = ['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder', '--format=csv,noheader,nounits'];
    const result = await run(nvidiaExecutable, argv, { timeoutMs: 10000, stdoutLimit: 65536 }, 'exact-nvidia-environment-and-idle');
    const lines = result.stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1); const values = lines[0].split(',').map(value => value.trim()); assert.equal(values.length, 4);
    const [adapterIdentity, driverVersion, encoder, decoder] = values;
    assert.match(adapterIdentity, /^GPU-[a-f0-9-]{36}$/i); assert.match(driverVersion, /^\d+\.\d+(?:\.\d+)*$/);
    assert.equal(Number(encoder), 0, 'Competing encoder work; do not control OBS'); assert.equal(Number(decoder), 0, 'Competing decoder work');
    return { observedAt: new Date().toISOString(), encoderPercent: Number(encoder), decoderPercent: Number(decoder),
      environment: { adapterIdentity, driverVersion, runtimeVersion: `FFmpeg9.0.2:${runtimeIdentity}` } };
  }
  async function pcm(file, streamIndex, destination, filter) {
    const handle = await fs.open(destination, 'wx+'), created = await handle.stat({ bigint: true }), hash = createHash('sha256'); let bytes = 0;
    try {
      const args = ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
        '-copyts', '-i', file, '-map', `0:${streamIndex}`, '-vn', '-sn', '-dn', ...(filter ? ['-filter:a:0', filter] : []), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
      const result = await run(runtime.ffmpeg, args, { stdoutLimit: EVIDENCE_BUDGET.maxPcmBytes, onStdoutChunk: async chunk => {
        assert.ok(Buffer.isBuffer(chunk)); bytes += chunk.length; assert.ok(bytes <= EVIDENCE_BUDGET.maxPcmBytes); hash.update(chunk);
        let written = 0; while (written < chunk.length) { const value = await handle.write(chunk, written, chunk.length - written, bytes - chunk.length + written); assert.ok(value.bytesWritten > 0); written += value.bytesWritten; }
      } }, filter ? 'complete-source-decode-with-canonical-selected-audio-filter-to-f32le' : 'complete-output-decode-after-signalled-skip-to-f32le');
      assert.equal(result.stderr.trim(), ''); assert.equal(result.stdout, ''); assert.equal(result.stdoutCapture.streamed, true);
      assert.equal(result.stdoutCapture.truncated, false); assert.equal(result.stdoutCapture.totalBytes, bytes); assert.ok(bytes > 0 && bytes % 8 === 0);
      await handle.sync(); const sealed = await handle.stat({ bigint: true }); assert.ok(sameObject(created, sealed) && ordinary(sealed) && sameFile(sealed, await fs.lstat(destination, { bigint: true })));
      const buffer = Buffer.alloc(bytes); let offset = 0; while (offset < bytes) { const value = await handle.read(buffer, offset, bytes - offset, offset); assert.ok(value.bytesRead > 0); offset += value.bytesRead; }
      const digest = hash.digest('hex'); assert.equal(sha(buffer), digest); assert.ok(sameFile(sealed, await handle.stat({ bigint: true })) && sameFile(sealed, await fs.lstat(destination, { bigint: true })));
      return { buffer, receipt: { path: destination, bytes, samplesPerChannel: bytes / 8, sha256: digest, format: SIGNAL.format, identity: stamp(sealed),
        sourceFile: file, sourceStreamIndex: streamIndex, canonicalAudioFilter: filter ?? null, noFittedShift: true } };
    } finally { await handle.close(); }
  }

  try {
    await parents(); reportHandle = await fs.open(reportFile, 'wx+'); reportIdentity = await reportHandle.stat({ bigint: true }); await save();
    report.resourcesBefore = await measure(true); await acquire(); await fs.mkdir(ownedRoot); await bind(ownedRoot);
    const inputReport = await fileReceipt(FIXTURE_REPORT, 32 * MiB); assert.equal(inputReport.sha256, FIXTURE_REPORT_SHA);
    sourceReport = JSON.parse(await fs.readFile(FIXTURE_REPORT, 'utf8')); assert.deepEqual(await fileReceipt(FIXTURE_REPORT, 32 * MiB), inputReport);
    assert.equal(sourceReport.id, FIXTURE_ID); assert.equal(sourceReport.status, 'generated-and-inspected-owned-fixtures'); assert.equal(sourceReport.leaseReleased, true);
    assert.equal(sourceReport.allTrackedChildrenClosed, true); assert.equal(sourceReport.fixtureRoot, SOURCE_ROOT); assert.equal(sourceReport.cases.length, 5);
    report.fixtureReportReceipt = inputReport; report.modulesBefore = await moduleReceipts();
    runtime = await verifyCandidateRuntime({ root: ROOT }); pinnedTools = await tools();
    runtimeIdentity = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    assert.equal(runtimeIdentity, sourceReport.runtime.runtimeIdentity);
    report.runtime = { runtimeIdentity, manifest: runtime.manifest, verifiedBefore: runtime.verified, pinnedTools };
    monitor = setInterval(() => { if (monitorTask) return; monitorTask = measure().then(value => { report.resourcesLatest = value; })
      .catch(error => { monitoringFailure ||= error; whole.abort(); }).finally(() => { monitorTask = null; }); }, LIMITS.monitorMs); monitor.unref();
    for (const name of ['ffmpeg', 'ffprobe']) { const result = await run(runtime[name], ['-version'], { stdoutLimit: MiB }, 'runtime-version'); report.runtime[`${name}Version`] = result.stdout.split(/\r?\n/, 1)[0]; }
    report.selectedCases = argv.length === 7 ? argv[6].split(',') : SPECS.map(spec => spec.id);
    for (const spec of SPECS.filter(spec => report.selectedCases.includes(spec.id))) {
      live(); if (fatalFailure || monitoringFailure) throw fatalFailure || monitoringFailure;
      const entry = { id: spec.id, settings, spec, status: 'preparing', publicationAuthorized: false, outputValidatedAuthorityGranted: false };
      report.cases.push(entry); const controller = new AbortController(); currentCase = { entry, controller, children: 0, deadline: Date.now() + LIMITS.perCaseMs };
      const caseTimer = setTimeout(() => controller.abort(), LIMITS.perCaseMs); caseTimer.unref(); let telemetry, stage, sealed = false;
      try {
        assert.deepEqual(await moduleReceipts(), report.modulesBefore, 'Production/harness modules changed');
        const sourceId = spec.sourceId || spec.id;
        const original = sourceReport.cases.find(value => value.id === sourceId), expectedPath = path.join(SOURCE_ROOT, `${sourceId}-${spec.width}x${spec.height}-${spec.fps}fps.${spec.container}`);
        assert.ok(original && original.status === 'generated-and-inspected'); assert.equal(original.output, expectedPath); assert.equal(original.file.file, expectedPath);
        for (const key of ['width', 'height', 'fps', 'seconds', 'container']) assert.equal(original[key], spec[key]);
        if (!spec.sourceId) assert.equal(original.resolution, spec.resolution); assert.deepEqual(original.range, spec.range);
        entry.sourceBefore = await fileReceipt(expectedPath, LIMITS.maximumSourceBytes); assert.equal(entry.sourceBefore.sha256, original.file.sha256);
        assert.equal(entry.sourceBefore.bytes, original.file.bytes); assert.deepEqual(entry.sourceBefore.identity, original.file.identity); mediaInputs.add(expectedPath);
        entry.sourceIdentityBefore = await readSourceIdentity(expectedPath);
        if (settings.profileId === 'h265-nvidia') { entry.gpuBefore = await gpu(); environment ||= entry.gpuBefore.environment; assert.deepEqual(entry.gpuBefore.environment, environment); }
        const inspection = await inspectInput(expectedPath, { ffprobe: runtime.ffprobe, signal: activeSignal(), run });
        entry.inspection = inspection; assert.equal(inspection.color.supported, true); assert.equal(inspection.color.classification, 'sdr');
        assert.equal(fingerprintEncodeSource(inspection.probe), original.sourceProbeFingerprint, 'Fresh source metadata must match the generated fixture receipt');
        const caseRoot = path.join(ownedRoot, spec.id); await fs.mkdir(caseRoot); await bind(caseRoot);
        stage = await createStage(caseRoot); entry.stage = stage; await bind(stage.directory);
        const request = resolveFileRequest({ fileId: `fixture-${spec.id}`, identityRevision: 1, draftRevision: 1, operation: 'encode',
          overrides: { range: spec.range, resolution: spec.resolution, audioPolicy: 'precision-aac' } });
        const profile = PROFILES.find(value => value.id === settings.profileId), recipe = describeRecipe(settings), outputId = randomUUID();
        const description = generationDescriptionOf({ version: 1, profileId: profile.id, codec: profile.codec, backend: profile.hardware,
          encoder: profile.encoder, preset: settings.preset, qualityMode: recipe.qualityMode, quality: 25, bitDepth: 8, encoderArgs: recipe.args,
          appVersion: require('../package.json').version, runtimeVersion: report.runtime.ffmpegVersion, createdAt: new Date().toISOString() }); assert.ok(description);
        const video = inspection.probe.streams.find(value => value.codec_type === 'video'), geometry = inspection.probe.mediaEvidence.streams.find(value => value.index === video.index).geometry;
        const orientation = spec.resolution === '720' && geometry.rotationSource === 'not-reported'
          ? { evidenceId: `${id}:${spec.id}:owned-test-signal-identity`, runtimeIdentity, sourceEvidenceFingerprint: fingerprintEncodeSource(inspection.probe), videoIndex: video.index } : null;
        entry.identityOrientationInterpretation = orientation ? { ...orientation, basis: 'Exact newly generated unrotated testsrc2 construction plus unchanged independently hashed source; absent metadata is not fabricated as a tag.' } : null;
        const raw = buildEncodeOperation({ input: expectedPath, output: path.join(caseRoot, 'prepared-output-slot.mkv'), settings, inspection, request,
          outputId, generationDescription: description, runtimeIdentity, ...(orientation ? { identityOrientationQualification: orientation } : {}) });
        const plan = withEncodeOperationTelemetry(raw); entry.plan = plan; entry.outputId = outputId; entry.generationDescription = description;
        assert.equal(plan.compatibilityPath, false); entry.frozen = frozenQualifications(`${id}:${spec.id}`, runtimeIdentity, inspection.probe); await save();
        telemetry = await createOperationTelemetry({ stageDirectory: caseRoot, runtimeIdentity, planFingerprint: plan.planFingerprint,
          streams: plan.instrumentation.streams, maxBytes: LIMITS.telemetryBytes, maxRecords: LIMITS.telemetryRecords }); telemetryHandles.push(telemetry);
        await assertTelemetryReady(telemetry); entry.actualArgv = resolveEncodeOperationInvocation(plan, { output: stage.file, telemetry });
        pendingEncodes.set(stage.file, entry.actualArgv); entry.status = 'encoding'; await run(runtime.ffmpeg, entry.actualArgv, {}, 'canonical-instrumented-encode');
        await sealStage(stage); sealed = true; entry.outputDisposition = { kind: 'sealed-unverified', published: false, validationCurrent: false };
        mediaInputs.add(stage.file); entry.outputBefore = await fileReceipt(stage.file, LIMITS.maximumSourceBytes);
        entry.telemetry = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false }, signal: activeSignal() });
        await closeOperationTelemetry(telemetry, { childClosed: true });
        const outputProbe = await inspectMetadata(stage.file, { ffprobe: runtime.ffprobe, signal: activeSignal(), run }); entry.outputProbe = outputProbe;
        for (const stream of outputProbe.streams) assert.equal(stream.time_base, entry.frozen.expectedOutputTimeBase, 'Unexpected output tick; do not fit bounds after encoding');
        assert.equal(classifyMarker(outputProbe).outputId, outputId);
        const audio = plan.expectedOutput.filters.audio[0], filter = audio.filters.join(','); assert.ok(filter.includes('atrim=') && filter.includes('asetpts='));
        assert.equal(plan.args[plan.args.indexOf('-filter:a:0') + 1], filter, 'PCM reference must reuse the exact canonical audio filter');
        const sourcePcm = await pcm(expectedPath, audio.inputIndex, path.join(caseRoot, 'source-selected.f32le'), filter);
        const outputPcm = await pcm(stage.file, audio.outputIndex, path.join(caseRoot, 'output-after-skip.f32le'));
        entry.pcm = { source: sourcePcm.receipt, output: outputPcm.receipt };
        entry.signal = matchedSignal(sourcePcm.buffer, outputPcm.buffer); assert.equal(entry.signal.valid, true, 'Independent fixed-window/channel zero-lag decoder alignment failed');
        entry.collection = await collectOperationEvidence({ plan, sourceProbe: inspection.probe, outputProbe, sourcePath: expectedPath,
          outputPath: stage.file, stageDirectory: caseRoot, ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, run, signal: activeSignal(),
          budget: EVIDENCE_BUDGET, timingQualification: entry.frozen.timingQualification,
          sourcePolicy: { id: 'short-sdr-range-v1', rate: spec.fps, maximumExtentUs: 120000000 },
          containerClockPolicy: entry.frozen.qualification.containerDuration });
        entry.telemetryValidation = validateEncodeOperationTelemetry(plan, entry.telemetry, entry.collection);
        const decodedAudio = entry.collection.decodedEvidence.audio[0];
        assert.equal(sourcePcm.receipt.samplesPerChannel, decodedAudio.sourceSampleCount); assert.equal(outputPcm.receipt.samplesPerChannel, decodedAudio.outputSampleCount);
        assert.ok(decodedAudio.outputSampleCount >= decodedAudio.sourceSampleCount && decodedAudio.outputSampleCount - decodedAudio.sourceSampleCount <= 1023, 'AAC must retain the whole selected interval; only the frozen terminal block excess is allowed');
        entry.validation = validateEncodeOperationOutput(plan, outputProbe, { qualification: entry.frozen.qualification, decodedEvidence: entry.collection.decodedEvidence });
        assert.equal(entry.validation.valid, true, entry.validation.errors.join('; ')); entry.warnings = entry.validation.warnings;
        checkCompleteSource(entry, spec);
        entry.sourceIdentityAfter = await readSourceIdentity(expectedPath); assert.deepEqual(entry.sourceIdentityAfter, entry.sourceIdentityBefore);
        entry.sourceAfter = await fileReceipt(expectedPath, LIMITS.maximumSourceBytes); assert.deepEqual(entry.sourceAfter, entry.sourceBefore);
        entry.outputAfter = await fileReceipt(stage.file, LIMITS.maximumSourceBytes); assert.deepEqual(entry.outputAfter, entry.outputBefore); await sealStage(stage);
        if (settings.profileId === 'h265-nvidia') { entry.gpuAfter = await gpu(); assert.deepEqual(entry.gpuAfter.environment, environment); }
        assert.deepEqual(await moduleReceipts(), report.modulesBefore);
        entry.status = 'passed-representative-case';
      } catch (error) {
        entry.status = 'failed-retained'; entry.failure = errorRecord(error); entry.collection ||= error.evidenceReceipt;
        if (sealed) try { await retainSealedStage(stage, 'Pre-catalog calibration output retained without validation/publication authority.'); } catch (retentionError) { entry.retentionFailure = errorRecord(retentionError); }
      } finally {
        clearTimeout(caseTimer); entry.children = currentCase.children; entry.finishedAt = new Date().toISOString(); entry.liveChildren = children.size;
        if (telemetry) try { assert.equal(children.size, 0); await closeOperationTelemetry(telemetry, { childClosed: true }); } catch (error) { entry.telemetryCloseFailure = errorRecord(error); fatalFailure ||= error; }
        currentCase = null; await save();
      }
      report.resourcesLatest = await measure(); if (fatalFailure || monitoringFailure || whole.signal.aborted) throw fatalFailure || monitoringFailure || fault('CALIBRATION_STOPPED', 'Global ownership/resource/deadline boundary stopped further cases');
    }
    report.modulesAfter = await moduleReceipts(); assert.deepEqual(report.modulesAfter, report.modulesBefore);
    report.runtime.verifiedAfter = (await verifyCandidateRuntime({ root: ROOT })).verified; assert.deepEqual(report.runtime.verifiedAfter, report.runtime.verifiedBefore);
    assert.deepEqual(await fileReceipt(FIXTURE_REPORT, 32 * MiB), report.fixtureReportReceipt); report.resourcesAfter = await measure(); live();
    const passed = report.cases.length === SPECS.length && report.cases.every(entry => entry.status === 'passed-representative-case');
    if (passed) {
      const endpointId = `${id}:representative-endpoints`, interiorId = `${id}:representative-interior`;
      const tolerances = Object.fromEntries(Object.keys(report.cases[0].frozen.qualification.tolerances).map(key => [key,
        Math.max(...report.cases.map(entry => entry.frozen.qualification.tolerances[key]))]));
      report.candidateFamily = { id: 'short-sdr-range-v1', evidenceIds: [endpointId, interiorId, ...report.cases.map(entry => `${id}:${entry.id}`)],
        runtimeIdentity, environment, settings, qualification: { evidenceId: endpointId, runtimeIdentity, containerDuration: 'matroska-packet-end-plus-codec-delay', tolerances },
        timingQualification: { evidenceId: interiorId, runtimeIdentity,
          videoDurationUs: Math.max(...report.cases.map(entry => entry.frozen.timingQualification.videoDurationUs)),
          audioTimelineUs: Math.max(...report.cases.map(entry => entry.frozen.timingQualification.audioTimelineUs)),
          aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } },
        budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS };
      report.candidateFamilyDerivation = 'Only maxima of independently frozen pre-encode clock/codec bounds; no observed candidate errors fit or widen the envelope. All five full evidence and signal checks passed. Parent review/normal-app service evidence remain separate.';
    }
    report.status = passed ? 'passed-representative-profile-calibration' : 'completed-with-gaps';
  } catch (error) { report.status = 'failed-retained'; report.failure = errorRecord(fatalFailure || monitoringFailure || error); report.candidateFamily = null; }
  finally {
    clearInterval(monitor); if (monitorTask) await monitorTask; clearTimeout(timer); process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    if (monitoringFailure || whole.signal.aborted || fatalFailure) { report.status = 'failed-retained'; report.failure ||= errorRecord(fatalFailure || monitoringFailure || fault('CALIBRATION_STOPPED', 'Global cancellation/deadline')); report.candidateFamily = null; }
    report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started; report.liveChildren = children.size; report.allTrackedChildrenClosed = tracked.every(item => item.closed);
    try { report.resourcesFinal = await measure(); } catch (error) { report.finalAccountingFailure = errorRecord(error); report.candidateFamily = null; report.status = 'failed-retained'; }
    try { await release(); } catch (error) { report.failure ||= errorRecord(error); report.candidateFamily = null; report.status = 'failed-retained'; }
    try { await save(); } catch (error) { report.reportWriteFailure = errorRecord(error); report.status = 'failed-retained'; report.candidateFamily = null; }
    if (reportHandle) await reportHandle.close();
  }
  return { id, status: report.status, profileId: settings.profileId, report: reportFile, ownedRoot,
    cases: report.cases.map(entry => ({ id: entry.id, status: entry.status })), candidateFamilyPrepared: Boolean(report.candidateFamily), leaseReleased: report.leaseReleased,
    failure: report.failure, reportWriteFailure: report.reportWriteFailure };
}

if (require.main === module) main().then(result => { process.stdout.write(JSON.stringify(result) + '\n'); if (result.status !== 'passed-representative-profile-calibration') process.exitCode = 1; })
  .catch(error => { process.stderr.write(JSON.stringify(errorRecord(error)) + '\n'); process.exitCode = 1; });
module.exports = { main };
