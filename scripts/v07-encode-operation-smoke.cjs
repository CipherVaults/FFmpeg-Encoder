'use strict';

// Parent-run functional qualification, never a benchmark or a support registry.
// All media are small deterministic fixtures created in this run's owned F:
// namespace. Failed files are retained. A lease plus an explicit parent flag is
// required; merely invoking this module without that flag starts no media work.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, fingerprintEncodeSource, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const BIN = path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin');
const TOOLS = { ffmpeg: path.join(BIN, 'ffmpeg.exe'), ffprobe: path.join(BIN, 'ffprobe.exe') };
const PIN = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0',
  ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
// Match main's pair identity: exact bytes/hashes, independent of installation
// pathname. Qualification can then bind this evidence to the deployed pair.
const RUNTIME_ID = createHash('sha256').update(JSON.stringify([
  { sizeBytes: 227823104, sha256: PIN.ffmpeg }, { sizeBytes: 227621376, sha256: PIN.ffprobe },
])).digest('hex');
const REPORT_BASE = path.join(ROOT, 'artifacts/v0.7/encode-operation');
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const SOURCE_MODULES = ['scripts/v07-encode-operation-smoke.cjs', 'src/encode-operation.cjs', 'src/operation-contract.cjs',
  'src/media.cjs', 'src/inspection.cjs', 'src/media-evidence.cjs'];
const MAX_REPORT = 64 * 1024 * 1024;
const MAX_OWNED_BYTES = 2 * 1024 * 1024 * 1024;
const SETTINGS = { profileId: 'h264-cpu', preset: 'ultrafast', quality: 0 };
const COLOR = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
const FRAME_COLOR = 'format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
const controller = new AbortController(), children = new Set();
let report, reportFile, fixtures, outputs, staging, leaseHandle, leaseIdentity;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, file) => { const rel = path.relative(base, file); return rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`); };
const objectSame = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const stampSame = (a, b) => objectSame(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const stamp = value => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(value[key])]));
const errorRecord = error => ({ code: error.code || 'QUALIFICATION_FAILED', message: error.message,
  ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}), ...(error.stderr ? { stderr: error.stderr } : {}) });
function ownedFile(file) { return [fixtures, outputs, staging].some(base => base && inside(base, file)); }
async function directory(file) {
  const s = await fs.lstat(file, { bigint: true });
  assert.ok(s.isDirectory() && !s.isSymbolicLink() && s.dev !== 0n && s.ino !== 0n, `Ordinary directory required: ${file}`);
}
async function save() {
  if (!reportFile) return;
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= MAX_REPORT, 'Report limit');
  // Atomic report replacement is confined to our report, never a media path.
  const temporary = `${reportFile}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, reportFile);
}
async function hashFile(file, maximum = 512 * 1024 * 1024) {
  assert.ok(ownedFile(file) || Object.values(TOOLS).includes(file) || SOURCE_MODULES.some(name => file === path.join(ROOT, name))
    || inside(REPORT_BASE, file) && path.basename(file) === 'report.json' && /^[a-f0-9-]{36}$/.test(path.basename(path.dirname(file))), 'Hash scope');
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(maximum), 'Bounded ordinary file required');
  const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    assert.ok(stampSame(before, await handle.stat({ bigint: true })), 'Hash handle binding');
    for (let offset = 0; offset < Number(before.size);) {
      if (controller.signal.aborted) throw new Error('Cancelled');
      const result = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      assert.ok(result.bytesRead > 0, 'Complete hash read'); hash.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead;
    }
    assert.ok(stampSame(before, await handle.stat({ bigint: true })) && stampSame(before, await fs.lstat(file, { bigint: true })), 'File changed while hashing');
    return { path: file, sha256: hash.digest('hex'), bytes: Number(before.size), identity: stamp(before) };
  } finally { await handle.close(); }
}
async function receipt(file) {
  const value = await hashFile(file); report.artifacts[file] = value;
  assert.ok(Object.values(report.artifacts).reduce((sum, item) => sum + item.bytes, 0) <= MAX_OWNED_BYTES, 'Owned media storage forecast exceeded');
  await save(); return value;
}
async function freeSpace() {
  const observed = {};
  for (const [label, location] of [['D', ROOT], ['F', OWNED]]) {
    const value = await fs.statfs(location, { bigint: true });
    observed[label] = { observedAt: new Date().toISOString(), availableBytes: String(value.bavail * value.bsize) };
  }
  assert.ok(BigInt(observed.D.availableBytes) >= 25n * 1024n ** 3n, 'D: must retain the established 25 GiB reserve');
  assert.ok(BigInt(observed.F.availableBytes) >= BigInt(MAX_OWNED_BYTES) + 512n * 1024n ** 2n, 'F: needs this bounded run forecast plus 512 MiB margin');
  return observed;
}
async function acquire() {
  await directory(path.dirname(LEASE)); leaseHandle = await fs.open(LEASE, 'wx+');
  await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid, purpose: 'encode-operation-smoke', startedAt: new Date().toISOString() }));
  await leaseHandle.sync(); leaseIdentity = await leaseHandle.stat({ bigint: true });
}
async function release() {
  if (!leaseHandle) return;
  try {
    assert.equal(children.size, 0, 'Child exits must be confirmed before lease release');
    const named = await fs.lstat(LEASE, { bigint: true }), opened = await leaseHandle.stat({ bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size < 8192n && stampSame(named, opened) && stampSame(named, leaseIdentity), 'Lease identity');
    const bytes = Buffer.alloc(Number(named.size)); const result = await leaseHandle.read(bytes, 0, bytes.length, 0);
    assert.equal(result.bytesRead, bytes.length); const data = JSON.parse(bytes);
    assert.ok(data.token === report.id && data.pid === process.pid && stampSame(named, await fs.lstat(LEASE, { bigint: true })), 'Lease ownership');
    await leaseHandle.close(); leaseHandle = null;
    const last = await fs.lstat(LEASE, { bigint: true });
    assert.ok(last.isFile() && !last.isSymbolicLink() && last.nlink === 1n && last.size === named.size && objectSame(last, named), 'Lease closed identity');
    await fs.unlink(LEASE); report.leaseReleased = true;
  } catch (error) { report.leaseRetained = error.message; }
  finally { await leaseHandle?.close().catch(() => {}); leaseHandle = null; }
}

// Only a completed exact command with intact owned file receipts may be reused.
// Interrupted/failed file writers are never overwritten. Start a new run after
// investigating them; all existing failed evidence remains in its old namespace.
async function run(executable, argv, requested = {}) {
  assert.ok(Object.values(TOOLS).includes(executable)); assert.equal(children.size, 0, 'Single media child');
  assert.ok(report.invocations.length < 180, 'Invocation ceiling');
  for (let i = 0; i < argv.length; i++) if (argv[i] === '-i') {
    assert.ok(ownedFile(argv[i + 1]) || report.lavfiInputs.includes(argv[i + 1]), 'Only owned input or fixed synthetic generator permitted');
  }
  assert.ok(!argv.includes('-y'), 'Overwriting is prohibited');
  const isVersion = argv.length === 1 && argv[0] === '-version';
  const isHelp = executable === TOOLS.ffmpeg && argv.length === 3 && argv[0] === '-hide_banner' && argv[1] === '-h'
    && ['full', 'filter=setparams'].includes(argv[2]);
  const destination = !isVersion && !isHelp && executable === TOOLS.ffmpeg && argv.at(-1) !== '-' ? argv.at(-1) : null;
  if (destination) assert.ok(ownedFile(destination), 'All media outputs must belong to this run');
  const key = sha(JSON.stringify([executable, argv]));
  const previous = report.invocations.find(item => item.key === key && item.status === 'completed');
  if (previous) {
    if (destination) assert.equal((await hashFile(destination)).sha256, report.artifacts[destination]?.sha256, 'Resume output receipt');
    previous.reused = (previous.reused || 0) + 1; await save();
    return { stdout: previous.stdout, stderr: previous.stderr, exitCode: previous.exitCode, stderrCapture: previous.stderrCapture };
  }
  if (destination) await fs.access(destination).then(() => { throw new Error(`Preserved incomplete output prevents replay: ${destination}`); }, error => { if (error.code !== 'ENOENT') throw error; });
  const item = { key, executable, argv: [...argv], startedAt: new Date().toISOString(), status: 'running' };
  report.invocations.push(item); await save();
  const started = process.hrtime.bigint();
  try {
    const result = await runTool(executable, argv, { ...requested, signal: controller.signal,
      timeoutMs: Math.min(requested.timeoutMs || 120000, 180000), stdoutLimit: Math.min(requested.stdoutLimit || 4 * 1024 * 1024, 16 * 1024 * 1024),
      stderrLimit: Math.min(requested.stderrLimit || 256 * 1024, 256 * 1024),
      onChild: child => { children.add(child); item.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
        child.once('close', (code, signal) => { item.observedExit = { code, signal }; children.delete(child); }); } });
    Object.assign(item, { stdout: result.stdout, stderr: result.stderr, stderrCapture: result.stderrCapture, exitCode: result.exitCode, status: 'completed' });
    if (destination) await receipt(destination);
    return result;
  } catch (error) { item.status = 'failed'; item.failure = errorRecord(error); throw error; }
  finally { item.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6; item.finishedAt = new Date().toISOString(); await save(); }
}
const ffmpeg = argv => run(TOOLS.ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', ...argv]);
const options = () => ({ ffprobe: TOOLS.ffprobe, run, signal: controller.signal });
const asUs = value => { const n = Number(value); assert.ok(Number.isFinite(n)); return Math.round(n * 1000000); };
const rationalUs = value => Number(value.numerator) * 1000000 / Number(value.denominator);
const tickUs = timeBase => { const [n, d] = String(timeBase).split('/').map(Number); assert.ok(n > 0 && d > 0); return Math.ceil(1000000 * n / d); };
function framePts(frame) { return asUs(frame.pts_time ?? frame.best_effort_timestamp_time); }
function frameDuration(frame) { const duration = asUs(frame.duration_time ?? frame.pkt_duration_time); assert.ok(duration > 0, 'Observed positive decoded frame duration required'); return duration; }
async function frames(file) {
  const result = await run(TOOLS.ffprobe, ['-v', 'error', '-show_frames', '-show_entries',
    'frame=media_type,stream_index,pts,pts_time,best_effort_timestamp_time,duration_time,pkt_duration_time,nb_samples,width,height,sample_aspect_ratio,color_range,color_space,color_primaries,color_transfer:frame_side_data=side_data_type,skip_samples,discard_padding', '-of', 'json', '-i', file]);
  const decoded = JSON.parse(result.stdout).frames;
  assert.ok(Array.isArray(decoded) && decoded.length > 0 && decoded.length <= 10000, 'Bounded decoded frames');
  return decoded;
}
async function videoHashes(file, filter = null) {
  const result = await ffmpeg(['-copyts', '-noautorotate', '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn',
    ...(filter ? ['-vf', filter] : []), '-c:v', 'rawvideo', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', '-']);
  const values = result.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const parts = line.split(',').map(value => value.trim()); assert.match(parts.at(-1), /^[0-9a-f]{64}$/); return parts.at(-1);
  });
  assert.ok(values.length > 0 && values.length <= 2000); return values;
}
async function pcm(file, ordinal, label) {
  const output = path.join(staging, `${label}-a${ordinal}.s16le`);
  await ffmpeg(['-copyts', '-i', file, '-map', `0:a:${ordinal}`, '-vn', '-sn', '-dn', '-c:a', 'pcm_s16le', '-f', 's16le', output]);
  const stat = await fs.stat(output); assert.ok(stat.size <= 32 * 1024 * 1024); return fs.readFile(output);
}

// The raw source is generated without FFmpeg, with independent channels and a
// deterministic, low-pass pseudo-random signal. Lossy checks detect wrong track,
// order, gross corruption or excessive lag, not subjective audio quality.
function rawAudio(rate, channels, seconds, seed) {
  const bytes = Buffer.alloc(rate * channels * seconds * 2), states = Array.from({ length: channels }, (_, n) => (seed + n * 65537) >>> 0), previous = states.map(() => 0);
  for (let n = 0; n < rate * seconds; n++) for (let c = 0; c < channels; c++) {
    states[c] = (Math.imul(states[c], 1664525) + 1013904223) >>> 0;
    previous[c] = 0.88 * previous[c] + 0.12 * ((states[c] / 4294967296) * 2 - 1);
    const sample = Math.round(previous[c] * 24000 + 2000 * Math.sin((n + c * 23) * 2 * Math.PI * (317 + c * 113) / rate));
    bytes.writeInt16LE(sample, (n * channels + c) * 2);
  }
  return bytes;
}
async function seedAudio(name, rate, channels, seed) {
  const file = path.join(fixtures, name), bytes = rawAudio(rate, channels, 22, seed);
  if (report.artifacts[file]) assert.equal((await hashFile(file)).sha256, sha(bytes), 'Deterministic raw fixture resumed');
  else { await fs.writeFile(file, bytes, { flag: 'wx' }); await receipt(file); }
  return file;
}
async function createFixtures() {
  // MOV supplies explicit video duration/time-base evidence. MKV commonly omits
  // stream duration; that is a separate admission gap, never fabricated here.
  const landscape = path.join(fixtures, 'landscape.mp4'), rotated = path.join(fixtures, 'rotated-ccw90.mp4'), timeline = path.join(fixtures, 'vfr-offset-multitrack.mov');
  // The pinned encoder consumes frame color, so output flags alone did not
  // create a qualified SDR fixture in the first run. Set actual frame evidence
  // before negotiation, following the already measured completion fixture.
  const generator = `testsrc2=size=1920x1080:rate=10:duration=2,${FRAME_COLOR}`;
  const timelineGenerator = `testsrc2=size=320x180:rate=25:duration=22,${FRAME_COLOR}`;
  report.lavfiInputs = [generator, timelineGenerator]; await save();
  await ffmpeg(['-f', 'lavfi', '-i', generator, '-vf', 'setsar=1,setfield=prog', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p', ...COLOR, landscape]);
  // FFmpeg 9.0.2 documents display_rotation as an input metadata override;
  // streamcopy passes the coded-side-data matrix to the MOV/MP4 muxer. A legacy
  // rotate tag did not create a matrix in the first recorded native trial.
  // Real ffprobe/decoded hashes below, never an injected probe field, verify it.
  await ffmpeg(['-noautorotate', '-display_rotation:v:0', '90', '-i', landscape, '-map', '0', '-c', 'copy', rotated]);
  const stereo = await seedAudio('stereo48k.s16le', 48000, 2, 1789), mono = await seedAudio('mono44100.s16le', 44100, 1, 7123);
  await ffmpeg(['-copyts', '-f', 'lavfi', '-i', timelineGenerator,
    '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', stereo, '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', mono,
    '-filter_complex', "[0:v]select='not(eq(mod(n,5),2))',setpts=PTS+10/TB,setfield=prog[v];[1:a]asetpts=PTS+10/TB[a0];[2:a]asetpts=PTS+10.125/TB[a1]",
    '-map', '[v]', '-map', '[a0]', '-map', '[a1]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p',
    '-fps_mode:v', 'passthrough', '-c:a', 'pcm_s16le', '-sample_fmt:a', 's16', '-metadata:s:a:0', 'title=Stereo 48k deterministic',
    '-metadata:s:a:1', 'title=Mono 44.1k delayed 125ms', '-disposition:a:0', 'default', '-disposition:a:1', '0',
    ...COLOR, '-avoid_negative_ts', 'disabled', '-use_editlist', '1', timeline]);
  return { landscape, rotated, timeline };
}

async function sourceEvidence(file, name) {
  const inspection = await inspectInput(file, options()), decoded = await frames(file), hashes = await videoHashes(file);
  const videos = decoded.filter(frame => frame.media_type === 'video'); assert.equal(videos.length, hashes.length);
  assert.equal(inspection.color.classification, 'sdr', `Synthetic ${name} must actually classify as SDR`);
  assert.ok(videos.every(frame => frame.color_transfer === 'bt709' && frame.color_primaries === 'bt709'
    && frame.color_space === 'bt709' && frame.color_range === 'tv'), `Synthetic ${name} decoded frames must carry the intended SDR color`);
  const audio = [];
  for (const [ordinal, stream] of inspection.probe.streams.filter(stream => stream.codec_type === 'audio').entries()) {
    const items = decoded.filter(frame => frame.stream_index === stream.index && frame.media_type === 'audio'), bytes = await pcm(file, ordinal, `${name}-source`);
    const count = items.reduce((sum, item) => sum + Number(item.nb_samples), 0);
    assert.ok(items.length && count * stream.channels * 2 === bytes.length, 'Decoded frame and packed PCM count must agree');
    audio.push({ stream, items, bytes });
  }
  return { inspection, videos, hashes, audio };
}

function boundaryRational(value) {
  if (value === null) return null;
  if (typeof value === 'number') { assert.ok(Number.isSafeInteger(value)); return { n: BigInt(value), d: 1000000n }; }
  assert.ok(value && /^-?\d+$/.test(value.numerator) && /^[1-9]\d*$/.test(value.denominator), 'Exact boundary rational required');
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
}
function ceiling(n, d) { const q = n / d; return q + (n % d > 0n ? 1n : 0n); }
function roundedUs(n, d) {
  n *= 1000000n; const q = n / d, remainder = n % d;
  const adjusted = q + (remainder * 2n >= d ? 1n : remainder * -2n > d ? -1n : 0n);
  const value = Number(adjusted); assert.ok(Number.isSafeInteger(value), 'Bounded diagnostic timestamp'); return value;
}
// Sample membership uses integer decoded PTS and its exact time base. Decimal
// pts_time is display text: e.g.1199872/48000 rounds down to24.997333 and then
// ceil((25.013-24.997333)*48000) falsely drops one sample. Never round before
// deciding inclusion; only the final diagnostic timestamp is rounded to us.
function selectedPcm(source, startBoundary, endBoundary) {
  const rate = Number(source.stream.sample_rate), width = source.stream.channels * 2, pieces = [];
  assert.ok(Number.isSafeInteger(rate) && rate > 0 && Number.isSafeInteger(width) && width > 0);
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(source.stream.time_base);
  assert.ok(match, 'Exact source audio time base required');
  const timeBase = { n: BigInt(match[1]), d: BigInt(match[2]) }, sampleRate = BigInt(rate);
  const start = boundaryRational(startBoundary), end = boundaryRational(endBoundary);
  let offset = 0, first = null, last = null, samples = 0;
  for (const frame of source.items) {
    const count = Number(frame.nb_samples);
    assert.ok(Number.isSafeInteger(count) && count > 0 && (typeof frame.pts === 'string' && /^-?\d+$/.test(frame.pts) || Number.isSafeInteger(frame.pts)), 'Exact decoded audio frame PTS/sample count required');
    const pts = { n: BigInt(frame.pts) * timeBase.n, d: timeBase.d };
    const position = boundary => ceiling((boundary.n * pts.d - pts.n * boundary.d) * sampleRate, boundary.d * pts.d);
    const clamp = value => Number(value < 0n ? 0n : value > BigInt(count) ? BigInt(count) : value);
    const from = start ? clamp(position(start)) : 0, to = Math.max(from, end ? clamp(position(end)) : count);
    if (to > from) {
      pieces.push(source.bytes.subarray((offset + from) * width, (offset + to) * width)); samples += to - from;
      if (first === null) first = roundedUs(pts.n * sampleRate + BigInt(from) * pts.d, pts.d * sampleRate);
      last = roundedUs(pts.n * sampleRate + BigInt(to) * pts.d, pts.d * sampleRate);
    }
    offset += count;
  }
  assert.equal(offset * width, source.bytes.length, 'Source decoded PCM must contain exactly the recorded frames');
  assert.ok(samples > 0); return { bytes: Buffer.concat(pieces), samples, first, last };
}
function lossySignal(source, output, channels, sampleRate) {
  const count = Math.min(source.length, output.length) / (channels * 2), analysis = Math.min(Math.floor(count) - 4096, sampleRate);
  assert.ok(analysis > 2048, 'Enough PCM for independent signal check');
  const results = [];
  for (let channel = 0; channel < channels; channel++) {
    const score = (lag, stride) => {
      let dot = 0, a2 = 0, b2 = 0, error = 0;
      for (let i = 2048; i < analysis; i += stride) {
        const a = source.readInt16LE((i * channels + channel) * 2), b = output.readInt16LE(((i + lag) * channels + channel) * 2);
        dot += a * b; a2 += a * a; b2 += b * b; error += (a - b) ** 2;
      }
      return { lagSamples: lag, correlation: dot / Math.sqrt(a2 * b2), normalizedRmsError: Math.sqrt(error / a2) };
    };
    let best = { correlation: -Infinity, lagSamples: 0 };
    for (let lag = -2048; lag <= 2048; lag += 16) { const value = score(lag, 16); if (value.correlation > best.correlation) best = value; }
    const center = best.lagSamples;
    for (let lag = Math.max(-2048, center - 15); lag <= Math.min(2048, center + 15); lag++) { const value = score(lag, 8); if (value.correlation > best.correlation) best = value; }
    results.push(score(best.lagSamples, 1));
  }
  return { method: 'Deterministic independent channels; bounded +/-2048 sample lag; first interior second; not perceptual audio acceptance.',
    channels: results, valid: results.every(item => item.correlation >= 0.85 && item.normalizedRmsError <= 0.55) };
}

async function collect(caseId, plan, source, output, outputProbe, oracleFilter) {
  const decoded = await frames(output), allOutputHashes = await videoHashes(output);
  const isRange = plan.contract.range.kind === 'range', start = isRange ? rationalUs(plan.contract.range.absoluteStart) : -Infinity,
    end = isRange ? rationalUs(plan.contract.range.absoluteEnd) : Infinity, origin = isRange ? start : 0;
  const positions = source.videos.map((frame, index) => ({ frame, index })).filter(item => framePts(item.frame) >= start && framePts(item.frame) < end);
  const expectedHashes = oracleFilter ? await videoHashes(plan.args[plan.args.indexOf('-i') + 1], oracleFilter) : positions.map(item => source.hashes[item.index]);
  const outputFrames = decoded.filter(frame => frame.media_type === 'video');
  assert.ok(positions.length && outputFrames.length); const sourceFrames = positions.map(item => item.frame);
  const video = { sourceFrameCount: sourceFrames.length, outputFrameCount: outputFrames.length,
    firstSourcePtsUs: framePts(sourceFrames[0]), lastSourcePtsUs: framePts(sourceFrames.at(-1)), lastSourceDurationUs: frameDuration(sourceFrames.at(-1)),
    firstOutputPtsUs: framePts(outputFrames[0]), lastOutputPtsUs: framePts(outputFrames.at(-1)), lastOutputDurationUs: frameDuration(outputFrames.at(-1)),
    comparedFrames: Math.min(sourceFrames.length, outputFrames.length),
    maxRebasedTimestampErrorUs: Math.ceil(Math.max(...sourceFrames.slice(0, outputFrames.length).map((frame, index) => Math.abs(framePts(outputFrames[index]) - framePts(frame) + origin)))) };
  const evidence = { video, audio: [] }, content = { video: { expectedHashes, actualHashes: allOutputHashes,
    oracle: oracleFilter ? 'Separate fixed synthetic geometry oracle; same pinned scaler implementation, not an independent scaler-quality assessment.' : 'Exact lossless input frame hashes selected by observed PTS membership.',
    valid: JSON.stringify(expectedHashes) === JSON.stringify(allOutputHashes) }, audio: [] };
  const packets = source.audio.length ? JSON.parse((await run(TOOLS.ffprobe, ['-v', 'error', '-show_packets', '-show_entries',
    'packet=stream_index,pts_time,duration_time:packet_side_data=side_data_type,skip_samples,discard_padding', '-of', 'json', '-i', output])).stdout).packets : [];
  for (const [ordinal, original] of source.audio.entries()) {
    const mapping = plan.expectedOutput.streams.find(stream => stream.inputIndex === original.stream.index), audioFrames = decoded.filter(frame => frame.media_type === 'audio' && frame.stream_index === mapping.outputIndex);
    const bytes = await pcm(output, ordinal, caseId), selected = selectedPcm(original, isRange ? plan.contract.range.absoluteStart : null,
      isRange ? plan.contract.range.absoluteEnd : null), rate = Number(original.stream.sample_rate);
    assert.ok(audioFrames.length && bytes.length === audioFrames.reduce((sum, item) => sum + Number(item.nb_samples), 0) * original.stream.channels * 2, 'Output decoded PCM and frame counts agree');
    const skip = packets.filter(item => item.stream_index === mapping.outputIndex).flatMap(item => item.side_data_list || []);
    const observed = { inputIndex: original.stream.index, sourceSampleCount: selected.samples, outputSampleCount: bytes.length / (original.stream.channels * 2),
      firstSourcePtsUs: selected.first, lastSourceEndUs: selected.last, firstOutputPtsUs: framePts(audioFrames[0]),
      lastOutputEndUs: Math.round(framePts(audioFrames.at(-1)) + Number(audioFrames.at(-1).nb_samples) * 1000000 / rate),
      encoderDelaySamples: skip.reduce((sum, item) => sum + Number(item.skip_samples || 0), 0),
      discardPaddingSamples: skip.reduce((sum, item) => sum + Number(item.discard_padding || 0), 0) };
    const mode = plan.contract.audio.streams.find(stream => stream.index === original.stream.index).mode;
    let check;
    if (mode === 'precision-flac') {
      observed.pcmIdentity = { algorithm: 'sha256', format: 's16le-interleaved', sourceHash: sha(selected.bytes), outputHash: sha(bytes), sourceBytes: selected.bytes.length, outputBytes: bytes.length };
      check = { inputIndex: original.stream.index, mode, valid: selected.bytes.equals(bytes), pcmIdentity: observed.pcmIdentity };
    } else check = { inputIndex: original.stream.index, mode, ...lossySignal(selected.bytes, bytes, original.stream.channels, rate) };
    content.audio.push(check); evidence.audio.push(observed);
  }
  return { evidence, content, packets, rawDecodedFrames: decoded, outputProbe };
}

function qualificationFor(plan, collected, source, calibration, calibrationCase, evidenceRunId = report.id) {
  const outputVideo = collected.outputProbe.streams.find(stream => stream.codec_type === 'video'), sourceVideo = source.inspection.probe.streams.find(stream => stream.codec_type === 'video');
  const quantization = tickUs(sourceVideo.time_base) + tickUs(outputVideo.time_base) + 1;
  const origin = plan.contract.range.kind === 'range' ? rationalUs(plan.contract.range.absoluteStart) : 0;
  const audio = collected.evidence.audio;
  const measures = { maximumAudioBoundaryErrorUs: Math.ceil(Math.max(0, ...audio.flatMap(item => [Math.abs(item.firstOutputPtsUs - item.firstSourcePtsUs + origin), Math.abs(item.lastOutputEndUs - item.lastSourceEndUs + origin)]))),
    maximumSampleCountDifference: Math.max(0, ...audio.map(item => Math.abs(item.sourceSampleCount - item.outputSampleCount))),
    maximumSignalLag: Math.max(0, ...collected.content.audio.flatMap(item => item.channels?.map(channel => Math.abs(channel.lagSamples)) || [0])),
    quantizationUs: quantization };
  const minimumRate = Math.min(...source.audio.map(item => Number(item.stream.sample_rate)), 48000);
  const codecFrameSamples = 1024, codecFrameUs = Math.ceil(codecFrameSamples * 1000000 / minimumRate);
  const isAac = plan.contract.audio.streams.some(item => item.mode === 'precision-aac');
  // Calibration is independently bounded by two native AAC frames, never by an
  // arbitrary generous wall-clock allowance. Held-out ranges use that frozen
  // calibration plus at most one frame for end-phase variation, still capped.
  if (calibrationCase) {
    assert.ok(measures.maximumSampleCountDifference <= 2 * codecFrameSamples && measures.maximumAudioBoundaryErrorUs <= 2 * codecFrameUs + quantization, 'AAC calibration exceeds the bounded codec-frame envelope');
    assert.ok(collected.content.audio.every(item => item.valid), 'AAC calibration decoded signal failed');
  }
  const prior = calibrationCase ? measures : calibration;
  if (isAac) assert.ok(prior, 'A separate passing AAC calibration is required for held-out timing');
  const sampleCount = isAac ? Math.min(2048, prior.maximumSampleCountDifference + codecFrameSamples) : 0;
  const audioTimestampUs = isAac ? Math.min(2 * codecFrameUs + quantization, prior.maximumAudioBoundaryErrorUs + codecFrameUs + quantization) : quantization;
  const video = collected.evidence.video, starts = [video.firstOutputPtsUs, ...audio.map(item => item.firstOutputPtsUs)], ends = [video.lastOutputPtsUs + video.lastOutputDurationUs, ...audio.map(item => item.lastOutputEndUs)];
  const duration = Number(collected.outputProbe.format.duration) * 1000000, span = Math.max(...ends) - Math.min(...starts), end = Math.max(...ends);
  const represented = Math.abs(duration - end) <= Math.abs(duration - span) ? 'end-timestamp' : 'span';
  // A nonzero-start fixture supplies the discriminating observation; ambiguous
  // zero-origin cases alone cannot establish container semantics generally.
  const durationErrorUs = Math.min(Math.abs(duration - end), Math.abs(duration - span));
  assert.ok(durationErrorUs <= quantization + Math.ceil(1000000 / minimumRate), 'Container extent does not match either measured representation');
  return { measures, durationObservation: { durationUs: duration, spanUs: span, endTimestampUs: end, selected: represented,
    ambiguityUs: Math.abs(span - end), errorUs: durationErrorUs },
  qualification: { evidenceId: `${evidenceRunId}:${calibrationCase ? 'aac-calibration' : isAac ? 'aac-held-out' : 'lossless-geometry'}`,
    runtimeIdentity: RUNTIME_ID, containerDuration: represented,
    tolerances: { videoTimestampUs: quantization, audioTimestampUs, avSyncUs: audioTimestampUs + quantization,
      durationUs: quantization + Math.ceil(1000000 / minimumRate), sampleCount } } };
}

async function executeCase(spec, source, calibration) {
  const previous = report.cases.find(item => item.id === spec.id);
  if (previous?.status === 'passed') return previous; // All artifact receipts were reconciled before resume.
  const item = previous || { id: spec.id, source: spec.file, output: path.join(outputs, `${spec.id}.mkv`), outputId: randomUUID(), status: 'pending' };
  if (!previous) report.cases.push(item); item.status = 'running'; await save();
  try {
    item.sourceBefore = await hashFile(spec.file);
    assert.equal(item.sourceBefore.sha256, report.artifacts[spec.file].sha256, 'Owned source fixture changed before the case');
    const request = resolveFileRequest({ fileId: spec.id, identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: spec.overrides });
    const identity = spec.identity ? { evidenceId: `${report.id}:owned-unrotated-generator`, runtimeIdentity: RUNTIME_ID,
      sourceEvidenceFingerprint: fingerprintEncodeSource(source.inspection.probe), videoIndex: source.inspection.probe.streams.find(stream => stream.codec_type === 'video').index } : undefined;
    const plan = buildEncodeOperation({ input: spec.file, output: item.output, settings: SETTINGS, inspection: source.inspection, request,
      outputId: item.outputId, runtimeIdentity: RUNTIME_ID, ...(identity ? { identityOrientationQualification: identity } : {}) });
    item.plan = plan; item.settings = SETTINGS; await save();
    await run(TOOLS.ffmpeg, plan.args);
    const outputProbe = await inspectMetadata(item.output, options());
    const collected = await collect(spec.id, plan, source, item.output, outputProbe, spec.oracle);
    item.observations = collected;
    if (plan.compatibilityPath) item.validation = validateEncodeOperationOutput(plan, outputProbe);
    else {
      item.measurement = qualificationFor(plan, collected, source, calibration, Boolean(spec.calibration));
      item.validation = validateEncodeOperationOutput(plan, outputProbe, { qualification: item.measurement.qualification, decodedEvidence: collected.evidence });
    }
    assert.ok(collected.content.video.valid && collected.content.audio.every(item => item.valid), 'Decoded content differs from the independent fixture expectation');
    assert.equal(item.validation.valid, true, JSON.stringify(item.validation));
    item.status = 'passed';
  } catch (error) { item.status = 'failed'; item.failure = errorRecord(error); }
  try {
    item.sourceAfter = await hashFile(spec.file);
    assert.equal(item.sourceAfter.sha256, item.sourceBefore?.sha256, 'Owned source fixture changed during the case');
    item.sourceContentUnchanged = true;
  } catch (error) { item.status = 'failed'; item.sourceReconciliationFailure = errorRecord(error); }
  item.finishedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ case: item.id, status: item.status, failure: item.failure?.message }));
  return item;
}

function pureCollectorTests() {
  const bytes = Buffer.alloc(1024 * 2);
  for (let n = 0; n < 1024; n++) bytes.writeInt16LE(n, n * 2);
  const source = { stream: { sample_rate: '48000', channels: 1, time_base: '1/48000' },
    items: [{ pts: 1199872, pts_time: '24.997333', nb_samples: 1024 }], bytes };
  const selected = selectedPcm(source, { numerator: '25013', denominator: '1000' }, { numerator: '12509', denominator: '500' });
  assert.equal(selected.samples, 240); assert.ok(selected.bytes.equals(bytes.subarray(752 * 2, 992 * 2)));
  assert.equal(selected.first, 25013000); assert.equal(selected.last, 25018000);
  const ending = selectedPcm(source, null, { numerator: '25013', denominator: '1000' });
  assert.equal(ending.samples, 752); assert.ok(ending.bytes.equals(bytes.subarray(0, 752 * 2)));
  const fractional = selectedPcm({ ...source, stream: { sample_rate: '44100', channels: 1, time_base: '1/44100' },
    items: [{ pts: 1102896, pts_time: '25.008980', nb_samples: 1024 }] }, { numerator: '25013', denominator: '1000' }, null);
  assert.equal(fractional.samples, 846); assert.equal(fractional.first, 25013016);
  assert.ok(fractional.bytes.equals(bytes.subarray(178 * 2)));
  assert.equal(selectedPcm(source, null, null).samples, 1024);
  assert.throws(() => selectedPcm({ ...source, items: [{ pts_time: '24.997333', nb_samples: 1024 }] }, null, null));
  assert.throws(() => selectedPcm({ ...source, bytes: bytes.subarray(2) }, null, null));
  assert.equal(ceiling(-5n, 2n), -2n); assert.equal(ceiling(5n, 2n), 3n);
  return { passed: 8, scope: 'Pure rational membership/start/end/fractional-44.1k/missing-evidence checks; no media or filesystem writes.' };
}

// Re-evaluate the one failed FLAC collector from preserved decoded evidence.
// This mode never calls run(), spawns a child, touches the media lease or alters
// the original report. It proves the retained output, not a fresh native run.
async function recheck(originalId) {
  assert.match(originalId, /^[a-f0-9-]{36}$/);
  const originalFile = path.join(REPORT_BASE, originalId, 'report.json');
  const stat = await fs.lstat(originalFile);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_REPORT);
  const originalBytes = await fs.readFile(originalFile), original = JSON.parse(originalBytes);
  assert.equal(original.id, originalId); assert.equal(original.schema, 1); assert.equal(original.expectedRuntime, RUNTIME_ID);
  fixtures = path.join(OWNED, 'fixtures', `encode-operation-${originalId}`);
  outputs = path.join(OWNED, 'outputs', `encode-operation-${originalId}`);
  staging = path.join(OWNED, 'staging', `encode-operation-${originalId}`);
  assert.deepEqual(original.ownedPaths, { fixtures, outputs, staging, reportDirectory: path.dirname(originalFile) });
  for (const location of [REPORT_BASE, path.dirname(originalFile), fixtures, outputs, staging]) await directory(location);
  const checked = { schema: 1, id: randomUUID(), kind: 'read-only-retained-FLAC-evidence-recheck', startedAt: new Date().toISOString(),
    originalReport: { path: originalFile, sha256: sha(originalBytes), status: original.status }, status: 'running',
    limits: ['No FFmpeg/ffprobe, encode, decode, app launch or media mutation occurs in this recheck.',
      'Reuses the original measured decoded-frame/probe snapshots, tied to unchanged encoded files and PCM receipts.',
      'Rechecks the FLAC late-range case only. Other five cases retain their original report outcomes.',
      'No production tolerance, support gate or FLAC equality rule is changed.'],
    runtimeIdentity: RUNTIME_ID, pureChecks: pureCollectorTests(), verifiedReceipts: [], moduleHashes: {}, comparedAudio: [] };
  let recheckFile;
  try {
    for (const file of SOURCE_MODULES) {
      checked.moduleHashes[file] = (await hashFile(path.join(ROOT, file), 2 * 1024 * 1024)).sha256;
      if (file !== 'scripts/v07-encode-operation-smoke.cjs') assert.equal(checked.moduleHashes[file], original.modules[file], 'Production module changed since the native run; cannot silently rebrand old evidence');
    }
    for (const tool of ['ffmpeg', 'ffprobe']) {
      assert.equal(original.runtime[tool].sha256, PIN[tool]); assert.equal(original.runtime[tool].after.sha256, PIN[tool]);
    }
    const previous = original.cases.find(item => item.id === 'flac-held-out-late-vfr');
    assert.ok(previous && previous.observations && previous.plan && previous.settings);
    const savedSource = original.sourceEvidence.timeline;
    assert.ok(savedSource.audio.length === 2 && savedSource.inspection);
    const sourceFile = path.join(fixtures, 'vfr-offset-multitrack.mov');
    assert.equal(previous.source, sourceFile); assert.equal(previous.output, path.join(outputs, 'flac-held-out-late-vfr.mkv'));
    const files = [sourceFile, previous.output, ...[0, 1].flatMap(ordinal => [path.join(staging, `timeline-source-a${ordinal}.s16le`),
      path.join(staging, `flac-held-out-late-vfr-a${ordinal}.s16le`)])];
    const originalIdentity = await hashFile(originalFile, MAX_REPORT);
    assert.equal(originalIdentity.sha256, checked.originalReport.sha256, 'Original report changed during bounded read');
    for (const file of files) {
      const actual = await hashFile(file, 64 * 1024 * 1024); assert.equal(actual.sha256, original.artifacts[file]?.sha256, 'Original retained evidence receipt mismatch');
      checked.verifiedReceipts.push(actual);
    }
    const plan = buildEncodeOperation({ input: sourceFile, output: previous.output, settings: previous.settings, inspection: savedSource.inspection,
      request: previous.plan.contract.request, outputId: previous.outputId, runtimeIdentity: RUNTIME_ID });
    assert.deepEqual(plan.args, previous.plan.args, 'Rebranded authoritative argv must equal the actual native invocation');
    assert.equal(plan.planFingerprint, previous.plan.planFingerprint, 'Same prepared recipe/media/request/runtime identity');
    const invocation = original.invocations.find(item => item.executable === TOOLS.ffmpeg && JSON.stringify(item.argv) === JSON.stringify(plan.args));
    assert.ok(invocation?.status === 'completed' && invocation.exitCode === 0 && invocation.observedExit?.code === 0, 'Original exact production invocation completed');
    checked.originalInvocationKey = invocation.key;
    const decodedEvidence = structuredClone(previous.observations.evidence), start = plan.contract.range.absoluteStart, end = plan.contract.range.absoluteEnd;
    const sourceVideo = savedSource.inspection.probe.streams.find(stream => stream.codec_type === 'video');
    const [tbN, tbD] = sourceVideo.time_base.split('/').map(BigInt), a = boundaryRational(start), b = boundaryRational(end);
    const frameIndexes = savedSource.videos.flatMap((frame, index) => {
      assert.ok(Number.isSafeInteger(frame.pts), 'Exact bounded source video PTS');
      const n = BigInt(frame.pts) * tbN;
      return n * a.d >= a.n * tbD && n * b.d < b.n * tbD ? [index] : [];
    });
    const expectedFrames = frameIndexes.map(index => savedSource.hashes[index]);
    assert.deepEqual(expectedFrames, previous.observations.content.video.actualHashes, 'Exact rational video membership and saved decoded output hashes');
    assert.equal(frameIndexes.length, decodedEvidence.video.sourceFrameCount);
    assert.equal(frameIndexes.length, decodedEvidence.video.outputFrameCount);
    checked.videoContent = { selectedFrames: frameIndexes.length, allFrameHashesEqual: true, membership: 'Exact integer PTS/time-base cross multiplication, start-inclusive/end-exclusive.' };
    for (const [ordinal, audio] of savedSource.audio.entries()) {
      const bytes = await fs.readFile(path.join(staging, `timeline-source-a${ordinal}.s16le`));
      const selected = selectedPcm({ stream: audio.stream, items: audio.frames, bytes }, start, end);
      const result = await fs.readFile(path.join(staging, `flac-held-out-late-vfr-a${ordinal}.s16le`));
      const evidence = decodedEvidence.audio.find(item => item.inputIndex === audio.stream.index);
      assert.ok(evidence); assert.equal(result.length, evidence.outputSampleCount * audio.stream.channels * 2, 'Saved output count and actual PCM bytes agree');
      checked.comparedAudio.push({ inputIndex: audio.stream.index, oldSourceSampleCount: evidence.sourceSampleCount,
        correctedSourceSampleCount: selected.samples, outputSampleCount: evidence.outputSampleCount,
        oldFirstSourcePtsUs: evidence.firstSourcePtsUs, correctedFirstSourcePtsUs: selected.first,
        sourceSha256: sha(selected.bytes), outputSha256: sha(result), exactBytesEqual: selected.bytes.equals(result) });
      Object.assign(evidence, { sourceSampleCount: selected.samples, firstSourcePtsUs: selected.first, lastSourceEndUs: selected.last,
        pcmIdentity: { algorithm: 'sha256', format: 's16le-interleaved', sourceHash: sha(selected.bytes), outputHash: sha(result),
          sourceBytes: selected.bytes.length, outputBytes: result.length } });
      assert.ok(selected.bytes.equals(result), 'Correct rational membership must preserve exact decoded PCM bytes');
    }
    assert.equal(previous.measurement.qualification.tolerances.sampleCount, 0, 'FLAC count tolerance remains zero');
    checked.unchangedQualification = previous.measurement.qualification;
    checked.correctedDecodedEvidence = decodedEvidence;
    checked.validation = validateEncodeOperationOutput(plan, previous.observations.outputProbe, {
      qualification: checked.unchangedQualification, decodedEvidence });
    assert.equal(checked.validation.valid, true, JSON.stringify(checked.validation));
    for (const receipt of checked.verifiedReceipts) assert.equal((await hashFile(receipt.path, 64 * 1024 * 1024)).sha256, receipt.sha256, 'Retained evidence changed during recheck');
    assert.equal((await hashFile(originalFile, MAX_REPORT)).sha256, checked.originalReport.sha256, 'Original report preserved');
    checked.status = 'passed-retained-evidence-recheck';
  } catch (error) { checked.status = 'failed'; checked.failure = errorRecord(error); process.exitCode = 1; }
  finally {
    checked.finishedAt = new Date().toISOString();
    const disk = await fs.statfs(ROOT, { bigint: true });
    assert.ok(disk.bavail * disk.bsize >= 25n * 1024n ** 3n, 'D: reserve is required before saving re-evaluation evidence');
    const outputDirectory = path.join(REPORT_BASE, 'rechecks'); await fs.mkdir(outputDirectory, { recursive: true }); await directory(outputDirectory);
    recheckFile = path.join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${checked.id}.json`);
    const bytes = Buffer.from(JSON.stringify(checked, null, 2)); assert.ok(bytes.length < 4 * 1024 * 1024);
    const handle = await fs.open(recheckFile, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    console.log(JSON.stringify({ status: checked.status, report: recheckFile, failure: checked.failure?.message, mediaChildrenStarted: 0 }));
  }
}

// The same rounded-PTS oracle also affected one AAC count and signal lag. Correct
// both calibration and held-out observations from already decoded PCM, freezing
// the newly measured calibration before looking at the held-out validation.
// Never widen any historical tolerance to turn a failure into a pass.
async function recheckAac(originalId) {
  assert.match(originalId, /^[a-f0-9-]{36}$/);
  const originalFile = path.join(REPORT_BASE, originalId, 'report.json');
  const stat = await fs.lstat(originalFile); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_REPORT);
  const originalBytes = await fs.readFile(originalFile), original = JSON.parse(originalBytes);
  assert.equal(original.schema, 1); assert.equal(original.id, originalId); assert.equal(original.expectedRuntime, RUNTIME_ID);
  fixtures = path.join(OWNED, 'fixtures', `encode-operation-${originalId}`);
  outputs = path.join(OWNED, 'outputs', `encode-operation-${originalId}`);
  staging = path.join(OWNED, 'staging', `encode-operation-${originalId}`);
  assert.deepEqual(original.ownedPaths, { fixtures, outputs, staging, reportDirectory: path.dirname(originalFile) });
  for (const location of [REPORT_BASE, path.dirname(originalFile), fixtures, outputs, staging]) await directory(location);
  const checked = { schema: 1, id: randomUUID(), kind: 'read-only-retained-AAC-calibration-and-held-out-recheck', startedAt: new Date().toISOString(),
    originalReport: { path: originalFile, sha256: sha(originalBytes), status: original.status }, status: 'running', runtimeIdentity: RUNTIME_ID,
    limits: ['No FFmpeg/ffprobe/encode/decode/app launch or media changes. Original report stays unchanged.',
      'Reuses recorded native decoded-frame/probe snapshots and verified encoded/PCM receipts.',
      'Calibration is recalculated before held-out validation; every recomputed tolerance must be no larger than its historical value.',
      'AAC remains lossy and padded, never sample-identical. These are two specific CPU x264/MOV-to-MKV audio cells, not a global support grant.'],
    pureChecks: pureCollectorTests(), moduleHashes: {}, verifiedReceipts: [], cases: [] };
  try {
    for (const file of SOURCE_MODULES) {
      checked.moduleHashes[file] = (await hashFile(path.join(ROOT, file), 2 * 1024 * 1024)).sha256;
      if (file !== 'scripts/v07-encode-operation-smoke.cjs') assert.equal(checked.moduleHashes[file], original.modules[file], 'Native production code changed; do not silently rebrand prior evidence');
    }
    for (const tool of ['ffmpeg', 'ffprobe']) {
      assert.equal(original.runtime[tool].sha256, PIN[tool]); assert.equal(original.runtime[tool].after.sha256, PIN[tool]);
    }
    assert.equal((await hashFile(originalFile, MAX_REPORT)).sha256, checked.originalReport.sha256);
    const sourceFile = path.join(fixtures, 'vfr-offset-multitrack.mov'), savedSource = original.sourceEvidence.timeline;
    assert.equal(savedSource.audio.length, 2);
    const ids = ['aac-calibration-delayed', 'aac-held-out-late-vfr'];
    const paths = [sourceFile, ...[0, 1].map(ordinal => path.join(staging, `timeline-source-a${ordinal}.s16le`)),
      ...ids.flatMap(id => [path.join(outputs, `${id}.mkv`), ...[0, 1].map(ordinal => path.join(staging, `${id}-a${ordinal}.s16le`))])];
    for (const file of paths) {
      const value = await hashFile(file, 64 * 1024 * 1024); assert.equal(value.sha256, original.artifacts[file]?.sha256, 'Retained native receipt mismatch'); checked.verifiedReceipts.push(value);
    }
    let calibration = null;
    for (const id of ids) {
      const previous = original.cases.find(item => item.id === id);
      assert.ok(previous?.observations && previous.plan && previous.settings && previous.measurement);
      assert.equal(previous.source, sourceFile); assert.equal(previous.output, path.join(outputs, `${id}.mkv`));
      const plan = buildEncodeOperation({ input: sourceFile, output: previous.output, settings: previous.settings,
        inspection: savedSource.inspection, request: previous.plan.contract.request, outputId: previous.outputId, runtimeIdentity: RUNTIME_ID });
      assert.deepEqual(plan.args, previous.plan.args); assert.equal(plan.planFingerprint, previous.plan.planFingerprint);
      const invocation = original.invocations.find(item => item.executable === TOOLS.ffmpeg && JSON.stringify(item.argv) === JSON.stringify(plan.args));
      assert.ok(invocation?.status === 'completed' && invocation.exitCode === 0 && invocation.observedExit?.code === 0);
      const item = { id, originalInvocationKey: invocation.key, originalMeasurement: previous.measurement,
        originalValidation: previous.validation, originalAudioEvidence: previous.observations.evidence.audio,
        originalSignalChecks: previous.observations.content.audio, correctedAudio: [] };
      checked.cases.push(item);
      const collected = structuredClone(previous.observations), start = plan.contract.range.absoluteStart, end = plan.contract.range.absoluteEnd;
      const video = savedSource.inspection.probe.streams.find(stream => stream.codec_type === 'video');
      const [tn, td] = video.time_base.split('/').map(BigInt), a = boundaryRational(start), b = boundaryRational(end);
      const indices = savedSource.videos.flatMap((frame, index) => {
        assert.ok(Number.isSafeInteger(frame.pts)); const n = BigInt(frame.pts) * tn;
        return n * a.d >= a.n * td && n * b.d < b.n * td ? [index] : [];
      });
      assert.deepEqual(indices.map(index => savedSource.hashes[index]), collected.content.video.actualHashes);
      assert.equal(indices.length, collected.evidence.video.sourceFrameCount); assert.equal(indices.length, collected.evidence.video.outputFrameCount);
      for (const [ordinal, audio] of savedSource.audio.entries()) {
        const sourceBytes = await fs.readFile(path.join(staging, `timeline-source-a${ordinal}.s16le`));
        const selected = selectedPcm({ stream: audio.stream, items: audio.frames, bytes: sourceBytes }, start, end);
        const outputBytes = await fs.readFile(path.join(staging, `${id}-a${ordinal}.s16le`));
        const evidence = collected.evidence.audio.find(entry => entry.inputIndex === audio.stream.index);
        assert.ok(evidence && !Object.hasOwn(evidence, 'pcmIdentity'));
        assert.equal(outputBytes.length, evidence.outputSampleCount * audio.stream.channels * 2);
        Object.assign(evidence, { sourceSampleCount: selected.samples, firstSourcePtsUs: selected.first, lastSourceEndUs: selected.last });
        const signal = lossySignal(selected.bytes, outputBytes, audio.stream.channels, Number(audio.stream.sample_rate));
        assert.ok(signal.valid, 'Corrected AAC signal must satisfy the same independent thresholds');
        collected.content.audio[ordinal] = { inputIndex: audio.stream.index, mode: 'precision-aac', ...signal };
        item.correctedAudio.push({ inputIndex: audio.stream.index, sourceSampleCount: selected.samples,
          outputSampleCount: evidence.outputSampleCount, countDifference: evidence.outputSampleCount - selected.samples,
          sourceFirstPtsUs: selected.first, sourceLastEndUs: selected.last, sourcePcmSha256: sha(selected.bytes),
          outputPcmSha256: sha(outputBytes), signal });
      }
      item.correctedMeasurement = qualificationFor(plan, collected, { inspection: savedSource.inspection, audio: savedSource.audio },
        calibration, id === ids[0], checked.id);
      for (const [name, value] of Object.entries(item.correctedMeasurement.qualification.tolerances)) {
        assert.ok(value <= previous.measurement.qualification.tolerances[name], 'A correction must not widen the historical tolerance envelope');
      }
      item.correctedDecodedEvidence = collected.evidence;
      item.validation = validateEncodeOperationOutput(plan, collected.outputProbe,
        { qualification: item.correctedMeasurement.qualification, decodedEvidence: collected.evidence });
      assert.equal(item.validation.valid, true, JSON.stringify(item.validation));
      item.status = 'passed';
      if (id === ids[0]) calibration = structuredClone(item.correctedMeasurement.measures);
    }
    for (const value of checked.verifiedReceipts) assert.equal((await hashFile(value.path, 64 * 1024 * 1024)).sha256, value.sha256);
    assert.equal((await hashFile(originalFile, MAX_REPORT)).sha256, checked.originalReport.sha256);
    checked.status = 'passed-retained-AAC-evidence-recheck';
  } catch (error) { checked.status = 'failed'; checked.failure = errorRecord(error); process.exitCode = 1; }
  finally {
    checked.finishedAt = new Date().toISOString();
    const disk = await fs.statfs(ROOT, { bigint: true }); assert.ok(disk.bavail * disk.bsize >= 25n * 1024n ** 3n);
    const outputDirectory = path.join(REPORT_BASE, 'rechecks'); await fs.mkdir(outputDirectory, { recursive: true }); await directory(outputDirectory);
    const output = path.join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${checked.id}-aac.json`);
    const bytes = Buffer.from(JSON.stringify(checked, null, 2)); assert.ok(bytes.length < 4 * 1024 * 1024);
    const handle = await fs.open(output, 'wx'); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    console.log(JSON.stringify({ status: checked.status, report: output, failure: checked.failure?.message, mediaChildrenStarted: 0 }));
  }
}

async function main() {
  const cli = process.argv.slice(2);
  if (cli.length === 1 && cli[0] === '--self-test') { console.log(JSON.stringify(pureCollectorTests())); return; }
  if (cli.length === 2 && cli[0] === '--recheck' && /^[a-f0-9-]{36}$/.test(cli[1])) { await recheck(cli[1]); return; }
  if (cli.length === 2 && cli[0] === '--recheck-aac' && /^[a-f0-9-]{36}$/.test(cli[1])) { await recheckAac(cli[1]); return; }
  assert.ok(cli[0] === '--parent-granted-media-slot' && (cli.length === 1 || cli.length === 3 && cli[1] === '--resume' && /^[a-f0-9-]{36}$/.test(cli[2])), 'Required --parent-granted-media-slot [--resume <existing-run-uuid>]; no arbitrary paths');
  const id = cli[2] || randomUUID(), reportDirectory = path.join(REPORT_BASE, id);
  fixtures = path.join(OWNED, 'fixtures', `encode-operation-${id}`); outputs = path.join(OWNED, 'outputs', `encode-operation-${id}`); staging = path.join(OWNED, 'staging', `encode-operation-${id}`);
  report = { schema: 1, id, startedAt: new Date().toISOString(), status: 'running', expectedRuntime: RUNTIME_ID,
    scope: 'Owned synthetic SDR functional Encode qualification only; no user sources, benchmark, support enablement or application/UI launch.',
    limitations: [
      'Initial CPU x264 ultrafast CRF0 lossless fixture cell only; no GPU, other profiles/depths, HDR, DV, range-copy, subtitles, chapters or application/package acceptance.',
      'Scaler oracle uses the same pinned FFmpeg scaler with independently fixed fixture geometry. This checks wiring/orientation/content, not independent scaler mathematics or ringing quality.',
      'AAC signal correlation is a gross-content/timing check; its measured padding is not sample identity or perceptual audio acceptance.',
      'Only s16 integer FLAC is covered. s32/20/24-bit FLAC remains unqualified.',
      'The two-AAC-frame calibration ceiling is a qualification rejection bound, not a production timing default. Held-out evidence must satisfy the frozen calibration.',
      'Tolerances are local observations bound to this runtime and fixture cell, never automatic grants or a global registry update.',
      'Interrupted writers are retained and never overwritten; resume reuses only completed commands with intact receipts and unchanged source modules.',
    ], bounds: { overallMinutes: 30, childSeconds: 180, invocationCount: 180, maximumOwnedReceiptBytes: MAX_OWNED_BYTES, maximumReportBytes: MAX_REPORT },
    artifacts: {}, invocations: [], cases: [], lavfiInputs: [], maxConcurrentChildren: 0, ownedPaths: { fixtures, outputs, staging, reportDirectory } };
  let deadline;
  const stop = () => controller.abort(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await acquire();
    deadline = setTimeout(stop, 30 * 60 * 1000);
    for (const directoryPath of [OWNED, ...['fixtures', 'outputs', 'staging'].map(name => path.join(OWNED, name))]) await directory(directoryPath);
    await fs.mkdir(REPORT_BASE, { recursive: true }); await directory(REPORT_BASE);
    if (cli[2]) {
      const savedFile = path.join(reportDirectory, 'report.json'), savedStat = await fs.lstat(savedFile);
      assert.ok(savedStat.isFile() && !savedStat.isSymbolicLink() && savedStat.size <= MAX_REPORT);
      const saved = JSON.parse(await fs.readFile(savedFile, 'utf8'));
      assert.equal(saved.schema, 1); assert.equal(saved.id, id); assert.equal(saved.expectedRuntime, RUNTIME_ID);
      assert.deepEqual(saved.ownedPaths, report.ownedPaths); report = saved;
      for (const location of [reportDirectory, fixtures, outputs, staging]) await directory(location);
      for (const [file, expected] of Object.entries(report.artifacts)) {
        assert.ok(ownedFile(file)); assert.equal((await hashFile(file)).sha256, expected.sha256, 'Resume artifact hash mismatch');
      }
      report.resumedAt = new Date().toISOString(); report.status = 'running';
    } else for (const location of [reportDirectory, fixtures, outputs, staging]) { await fs.mkdir(location); await directory(location); }
    reportFile = path.join(reportDirectory, 'report.json');
    report.resourceBefore = await freeSpace();
    const modules = {};
    for (const file of SOURCE_MODULES) modules[file] = (await hashFile(path.join(ROOT, file), 2 * 1024 * 1024)).sha256;
    if (report.modules) assert.deepEqual(modules, report.modules, 'Source changed: use a new run; previous evidence is retained'); else report.modules = modules;
    report.runtime = {};
    for (const [tool, file] of Object.entries(TOOLS)) {
      report.runtime[tool] = await hashFile(file); assert.equal(report.runtime[tool].sha256, PIN[tool], 'Exact previously verified 9.0.2 candidate required');
      const version = await run(file, ['-version']); assert.match(version.stdout.split(/\r?\n/)[0], new RegExp(`^${tool} version 9\\.0\\.2(?:[-\\s]|$)`)); report.runtime[tool].version = version.stdout.split(/\r?\n/)[0];
    }
    const fullHelp = await run(TOOLS.ffmpeg, ['-hide_banner', '-h', 'full'], { stdoutLimit: 16 * 1024 * 1024 });
    const frameHelp = await run(TOOLS.ffmpeg, ['-hide_banner', '-h', 'filter=setparams']);
    assert.match(fullHelp.stdout, /-display_rotation/); assert.match(frameHelp.stdout, /color_primaries/); assert.match(frameHelp.stdout, /color_trc/);
    report.fixtureConstruction = { generation: 2,
      previousFailure: path.join(REPORT_BASE, '7083741b-1681-433c-917e-395cdff45427/report.json'),
      color: 'Frame-level setparams plus declared encoder color; observed decoded frame color must match.',
      rotation: 'Input display_rotation metadata override with streamcopy; observed matrix and unrotated decoded hashes are mandatory.',
      references: ['https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/doc/ffmpeg.texi',
        'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavformat/movenc.c'],
      localReference: 'scripts/v07-completion-smoke.cjs',
      pinnedHelpVerified: true };
    const files = await createFixtures(), sources = {};
    for (const [name, file] of Object.entries(files)) sources[name] = await sourceEvidence(file, name);
    report.sourceEvidence = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, { inspection: value.inspection, videos: value.videos, hashes: value.hashes,
      audio: value.audio.map(item => ({ stream: item.stream, frames: item.items, rawPcmSha256: sha(item.bytes), rawPcmBytes: item.bytes.length })) }]));
    const rotation = sources.rotated.inspection.probe.streams.find(stream => stream.codec_type === 'video').side_data_list?.find(item => item.side_data_type === 'Display Matrix');
    assert.equal(Number(rotation?.rotation), 90, 'Fixture must actually contain a +90 degree display matrix');
    assert.deepEqual(sources.rotated.hashes, sources.landscape.hashes, 'Rotation fixture must preserve the exact unrotated coded pixels; only its display instruction changes');
    const timelinePts = sources.timeline.videos.map(framePts);
    assert.equal(timelinePts[0], 10000000, 'Observed nonzero video origin');
    assert.ok(new Set(timelinePts.slice(1).map((pts, index) => pts - timelinePts[index])).size > 1, 'Observed VFR gaps');
    const audioStarts = sources.timeline.audio.map(item => framePts(item.items[0]));
    assert.ok(audioStarts.length === 2 && Math.abs(audioStarts[1] - audioStarts[0] - 125000) <= 1000, 'Observed delayed second track');
    await save();
    const scale = (w, h) => `scale=${w}:${h}:flags=lanczos+accurate_rnd:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,setsar=1`;
    const specifications = [
      { id: 'full-compatibility', file: files.landscape, source: 'landscape', overrides: { resolution: 'source', audioPolicy: 'copy' } },
      { id: 'resize-identity-720', file: files.landscape, source: 'landscape', overrides: { resolution: '720', audioPolicy: 'copy' }, identity: true, oracle: scale(1280, 720) },
      { id: 'resize-rotation-720', file: files.rotated, source: 'rotated', overrides: { resolution: '720', audioPolicy: 'copy' }, oracle: `transpose=cclock,${scale(720, 1280)}` },
      { id: 'aac-calibration-delayed', file: files.timeline, source: 'timeline', calibration: true, overrides: { range: { startUs: 0, endUs: 2013000 }, audioPolicy: 'precision-aac' } },
      { id: 'aac-held-out-late-vfr', file: files.timeline, source: 'timeline', overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: 'precision-aac' } },
      { id: 'flac-held-out-late-vfr', file: files.timeline, source: 'timeline', overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: 'precision-flac' } },
    ];
    let calibration = report.cases.find(item => item.id === 'aac-calibration-delayed' && item.status === 'passed')?.measurement?.measures || null;
    for (const spec of specifications) {
      if (controller.signal.aborted) throw new Error('Cancelled');
      if (spec.id === 'aac-held-out-late-vfr' && !calibration) {
        if (!report.cases.some(item => item.id === spec.id)) report.cases.push({ id: spec.id, status: 'blocked', reason: 'Separate AAC calibration did not pass; no extrapolated tolerance or encode.' });
        await save(); continue;
      }
      const result = await executeCase(spec, sources[spec.source], calibration);
      if (spec.calibration && result.status === 'passed') calibration = result.measurement.measures;
    }
    for (const [tool, file] of Object.entries(TOOLS)) { report.runtime[tool].after = await hashFile(file); assert.equal(report.runtime[tool].after.sha256, PIN[tool]); }
    for (const file of SOURCE_MODULES) assert.equal((await hashFile(path.join(ROOT, file), 2 * 1024 * 1024)).sha256, report.modules[file], 'Production/harness code changed during the trial; evidence cannot qualify a different revision');
    report.resourceAfter = await freeSpace();
    report.status = report.cases.length === 6 && report.cases.every(item => item.status === 'passed') ? 'passed-initial-subset' : 'completed-with-gaps';
    if (report.status !== 'passed-initial-subset') process.exitCode = 1;
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = errorRecord(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); report.finishedAt = new Date().toISOString();
    report.childElapsedMs = report.invocations.reduce((sum, item) => sum + (item.elapsedMs || 0), 0);
    await release(); await save(); console.log(`Encode operation qualification report: ${reportFile || 'not created (no media started)'}`);
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { selectedPcm, lossySignal, rawAudio, framePts, frameDuration, pureCollectorTests };
