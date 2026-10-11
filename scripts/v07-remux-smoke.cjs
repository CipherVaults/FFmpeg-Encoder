'use strict';

// Parent-run, bounded native media qualification. This script creates neither
// a production registry receipt nor a prepared application execution plan. It
// reuses sealed, small owned fixtures; it never generates replacement fixtures,
// encodes video/audio, publishes outputs, removes evidence or touches masters.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { runTool } = require('../src/process-runner.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { assessRemux, buildRemuxQualificationArgs } = require('../src/remux-contract.cjs');
const { createRemuxValidator, validateRemuxMediaQualification, remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const { observeMovRepresentation } = require('../src/mov-representation.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SOURCE_RUN = '01349687-ff85-4606-b3be-b2baec87d06b';
const SOURCE_REPORT = path.join(ROOT, 'artifacts/v0.7/encode-operation', SOURCE_RUN, 'report.json');
const FIXTURES = path.join(OWNED, 'fixtures', `encode-operation-${SOURCE_RUN}`);
const SOURCE_OUTPUTS = path.join(OWNED, 'outputs', `encode-operation-${SOURCE_RUN}`);
const SOURCES = [
  { id: 'landscape', path: path.join(FIXTURES, 'landscape.mp4'), targets: ['matroska', 'mp4', 'mov'] },
  { id: 'rotated', path: path.join(FIXTURES, 'rotated-ccw90.mp4'), targets: ['matroska', 'mp4', 'mov'] },
  { id: 'timeline-pcm', path: path.join(FIXTURES, 'vfr-offset-multitrack.mov'), targets: ['matroska', 'mp4', 'mov'] },
  // This previously generated file is explicitly selected only for laboratory
  // qualification. No reusable generated-source authorization is issued.
  { id: 'timeline-aac', path: path.join(SOURCE_OUTPUTS, 'aac-calibration-delayed.mkv'), targets: ['matroska', 'mp4', 'mov'] },
];
const REPORT_BASE = path.join(ROOT, 'artifacts/v0.7/remux');
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const MODULES = ['scripts/v07-remux-smoke.cjs', 'src/remux-contract.cjs', 'src/remux-validation.cjs', 'src/mov-representation.cjs',
  'src/inspection.cjs', 'src/media-evidence.cjs', 'src/media.cjs', 'src/provenance.cjs',
  'src/process-runner.cjs', 'src/candidate-runtime.cjs', 'resources/candidate-binary-manifest.json'];
const LIMITS = { sourceBytes: 32 * 1024 * 1024, ownedBytes: 1024 * 1024 * 1024,
  reportBytes: 16 * 1024 * 1024, stdoutBytes: 16 * 1024 * 1024, stderrBytes: 256 * 1024,
  frames: 10000, samples: 2000000, invocations: 140, childMs: 180000, overallMs: 30 * 60 * 1000 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, filename) => { const rel = path.relative(base, filename); return Boolean(rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
const objectSame = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const stampSame = (a, b) => objectSame(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const stamp = s => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(s[key])]));
const errorData = error => ({ code: error.code || 'REMUX_QUALIFICATION_FAILED', message: error.message,
  ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
  ...(error.stderr !== undefined ? { stderr: error.stderr, stderrCapture: error.stderrCapture || null } : {}) });

// Exact rational arithmetic avoids microsecond rounding, particularly for
// 44.1-kHz samples and comparisons across differently quantized time bases.
function gcd(a, b) { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n, d = 1n) { n = BigInt(n); d = BigInt(d); assert.ok(d > 0n); const factor = gcd(n, d); return { n: n / factor, d: d / factor }; }
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const abs = a => rational(a.n < 0n ? -a.n : a.n, a.d);
const greater = (a, b) => a.n * b.d > b.n * a.d;
const encoded = a => ({ numerator: String(a.n), denominator: String(a.d) });
function timeBase(value) { const match = /^([1-9]\d{0,15})\/([1-9]\d{0,15})$/.exec(String(value)); assert.ok(match, 'Known positive native time base required'); return rational(match[1], match[2]); }
function exactInteger(value, label) { assert.match(String(value), /^-?\d{1,20}$/, label); if (typeof value === 'number') assert.ok(Number.isSafeInteger(value), label); return BigInt(value); }
function decimal(value) { const match = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(String(value)); assert.ok(match, 'Exact native decimal time required'); const digits = match[3] || ''; return rational((BigInt(match[2]) * 10n ** BigInt(digits.length) + BigInt(digits || '0')) * (match[1] ? -1n : 1n), 10n ** BigInt(digits.length)); }
function framePts(frame, stream) { const value = frame.pts ?? frame.best_effort_timestamp; assert.notEqual(value, undefined, 'Decoded unit needs native integer PTS'); const base = timeBase(stream.time_base); return rational(exactInteger(value, 'Exact PTS') * base.n, base.d); }
function frameDuration(frame, stream) {
  if (stream.codec_type === 'audio') return rational(exactInteger(frame.nb_samples, 'Audio frame sample count'), exactInteger(stream.sample_rate, 'Native sample rate'));
  const result = packetPresentationDuration(frame, stream);
  assert.ok(result && result.n > 0n, 'Observed positive video duration required; never infer it from nominal FPS'); return result;
}
function packetPresentationDuration(frame, stream) {
  const ticks = frame.duration ?? frame.pkt_duration;
  if (ticks !== undefined) return rational(exactInteger(ticks, 'Packet presentation duration') * timeBase(stream.time_base).n, timeBase(stream.time_base).d);
  const text = frame.duration_time ?? frame.pkt_duration_time;
  return text === undefined ? null : decimal(text);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function nativeMetadata(frame, type) {
  // Packet positions/sizes and timestamp rounding are container properties,
  // compared separately. Retain every exposed frame side-data field, including
  // uninterpreted descriptors; the native stream checks cover stream metadata.
  const fields = type === 'video' ? ['width', 'height', 'pix_fmt', 'sample_aspect_ratio', 'color_range', 'color_space',
    'color_primaries', 'color_transfer', 'chroma_location', 'interlaced_frame', 'top_field_first', 'repeat_pict',
    'crop_top', 'crop_bottom', 'crop_left', 'crop_right', 'key_frame', 'pict_type']
    : ['sample_fmt', 'sample_rate', 'channels', 'channel_layout'];
  return canonical({ ...Object.fromEntries(fields.filter(key => Object.hasOwn(frame, key)).map(key => [key, frame[key]])),
    side_data_list: frame.side_data_list || [] });
}
function frameHashRows(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) {
    const fields = line.split(',').map(value => value.trim());
    assert.equal(fields.length, 6, 'Complete native framehash record'); assert.equal(fields[0], '0', 'One selected decoded video');
    assert.match(fields[4], /^[1-9]\d*$/); assert.match(fields[5], /^[a-f0-9]{64}$/);
    result.push({ bytes: Number(fields[4]), sha256: fields[5] });
  }
  assert.ok(result.length > 0 && result.length <= LIMITS.frames); return result;
}
function collectTimeline(frames, stream, contentSha256, decodeReceipts) {
  assert.ok(frames.length > 0 && frames.length <= LIMITS.frames);
  const metadata = createHash('sha256'), chunks = []; let count = 0;
  for (const frame of frames) {
    assert.equal(frame.media_type, stream.codec_type); assert.equal(frame.stream_index, stream.index);
    const pts = framePts(frame, stream), duration = frameDuration(frame, stream);
    const units = stream.codec_type === 'audio' ? Number(exactInteger(frame.nb_samples, 'Audio samples')) : 1;
    assert.ok(Number.isSafeInteger(units) && units > 0 && count + units <= (stream.codec_type === 'audio' ? LIMITS.samples : LIMITS.frames));
    const step = stream.codec_type === 'audio' ? rational(1, stream.sample_rate) : duration;
    const native = JSON.stringify(nativeMetadata(frame, stream.codec_type)) + '\n';
    // Hash metadata per decoded sample, not per demuxed PCM packet. A valid
    // remux can change audio packet/frame segmentation without changing samples.
    for (let unit = 0; unit < units; unit += 1) metadata.update(native);
    chunks.push({ pts, duration, presentationDuration: packetPresentationDuration(frame, stream), step, units }); count += units;
  }
  const end = add(chunks.at(-1).pts, chunks.at(-1).duration);
  const presentation = chunks.at(-1).presentationDuration;
  // A shortened AAC packet duration does not prove that its decoder discarded
  // tail samples. Preserve that container observation separately from the full
  // decoded interval; exact decoded sample count remains mandatory.
  return { chunks, count, packetPresentation: { firstPts: encoded(chunks[0].pts),
    endPts: presentation ? encoded(add(chunks.at(-1).pts, presentation)) : null,
    lastDuration: presentation ? encoded(presentation) : null }, record: { complete: true, exitCode: 0, stderrComplete: true, errors: [],
    representation: stream.codec_type === 'video' ? 'native-video-v1' : 'native-audio-v1',
    contentSha256, metadataSha256: metadata.digest('hex'), unitCount: String(count),
    firstPts: encoded(chunks[0].pts), endPts: encoded(end) }, decodeReceipts };
}
function compareTimelines(before, after) {
  assert.equal(before.count, after.count, 'Every decoded unit must remain present');
  let ai = 0, bi = 0, ao = 0, bo = 0, compared = 0, ptsError = rational(0), durationError = rational(0);
  while (ai < before.chunks.length && bi < after.chunks.length) {
    const a = before.chunks[ai], b = after.chunks[bi], units = Math.min(a.units - ao, b.units - bo);
    // PTS difference varies linearly within a pair of constant-rate chunks;
    // checking both endpoints proves the maximum across every covered sample.
    for (const offset of [0, units - 1]) {
      const ap = add(a.pts, rational(a.step.n * BigInt(ao + offset), a.step.d));
      const bp = add(b.pts, rational(b.step.n * BigInt(bo + offset), b.step.d));
      const error = abs(subtract(ap, bp)); if (greater(error, ptsError)) ptsError = error;
    }
    const error = abs(subtract(a.step, b.step)); if (greater(error, durationError)) durationError = error;
    compared += units; ao += units; bo += units;
    if (ao === a.units) { ai += 1; ao = 0; } if (bo === b.units) { bi += 1; bo = 0; }
  }
  assert.equal(compared, before.count); assert.equal(ai, before.chunks.length); assert.equal(bi, after.chunks.length);
  return { complete: true, comparedUnits: String(compared), maxPtsError: encoded(ptsError), maxDurationError: encoded(durationError) };
}
function timestampCeiling(source, output) {
  const ticks = add(timeBase(source.time_base), timeBase(output.time_base));
  // A predeclared local ceiling, not a tolerance fitted to a failed result.
  // More than 2 ms remains outside this small fixture qualification campaign.
  assert.ok(!greater(ticks, rational(1, 500)), 'Time-base quantization exceeds this bounded cell policy'); return ticks;
}
function requireComplete(result) {
  assert.equal(result.exitCode, 0); assert.ok(result.stderrCapture && !result.stderrCapture.truncated);
  assert.equal(result.stderr.trim(), '', 'A complete decoder/probe must report no error diagnostics');
}

async function main(cli = process.argv.slice(2)) {
  if (cli.length === 1 && cli[0] === '--pure-tests') return pureTests();
  const targetedMov = cli.length === 2 && cli[1] === '--targeted-mov-retention';
  assert.deepEqual(cli, ['--parent-approved-remux-qualification', ...(targetedMov ? ['--targeted-mov-retention'] : [])],
    'Only an explicitly coordinated parent may start native media qualification');
  const selectedSources = targetedMov ? SOURCES.filter(source => ['landscape', 'rotated', 'timeline-pcm'].includes(source.id))
    .map(source => ({ ...source, targets: ['mov'] })) : SOURCES;
  const expectedCases = selectedSources.reduce((count, source) => count + source.targets.length, 0);
  assert.equal(process.platform, 'win32', 'This local qualification requires Windows');
  const id = randomUUID(), controller = new AbortController(), children = new Set();
  const outputs = path.join(OWNED, 'outputs', `remux-${id}`), staging = path.join(OWNED, 'staging', `remux-${id}`);
  const reportDirectory = path.join(REPORT_BASE, id), reportFile = path.join(reportDirectory, 'report.json');
  const report = { schema: 1, id, status: 'initializing', startedAt: new Date().toISOString(),
    purpose: 'Native Remux media qualification only; no application/package or production-registry acceptance.',
    executionReady: false, sourceRun: SOURCE_RUN, ownedPaths: { outputs, staging, reportDirectory }, limits: LIMITS,
    selection: selectedSources.map(source => ({ sourceId: source.id, targets: [...source.targets] })),
    scope: [targetedMov ? 'Targeted MOV metadata retention only: Full H.264 SDR, observed display rotation and PCM multi-track/VFR on three fixed owned fixtures; no AAC rerun.'
      : 'Full H.264 8-bit SDR video, one observed display rotation, PCM/AAC and measured A/V/VFR timestamps on fixed owned fixtures.',
      'Every candidate output uses production qualification argv, fresh provenance and no overwrite.',
      'No TS, Dolby Vision, HDR, subtitles, attachments, chapters, timed-data, alternate-video or arbitrary-source qualification.',
      'No publication/cancellation/rescan/application lifecycle claim; outputs are retained unpublished qualification artifacts.',
      'All decoded units and ffprobe-exposed frame metadata are compared. Unexposed side payload requires matching coded-packet evidence, otherwise that cell remains unqualified.',
      'No lossy audio/video encoder is invoked; native decoding uses the observed pixel/sample representation without scaling or resampling.',
      'Interrupted leases/writers are retained. There is no automatic stale-lease recovery or overwrite-based resume.'],
    invocations: [], artifacts: {}, sources: [], cases: [], maxConcurrentChildren: 0 };
  let tools, runtimeId, reportHandle, reportIdentity, leaseHandle, leaseIdentity, deadline, saveChain = Promise.resolve();
  const stop = () => controller.abort(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const ownedOutput = file => inside(outputs, file) || inside(staging, file);
  const sourcePaths = new Set(SOURCES.map(source => source.path));
  const hashAllowed = file => sourcePaths.has(file) || ownedOutput(file) || file === SOURCE_REPORT
    || MODULES.some(name => file === path.join(ROOT, name)) || tools && Object.values(tools).includes(file);
  async function hashFile(file, maximum = LIMITS.sourceBytes) {
    assert.ok(hashAllowed(file), 'Hash operation is confined to exact known sources, runtime, modules and this run');
    await assertOrdinaryPath(file);
    const before = await fs.lstat(file, { bigint: true }); assert.ok(before.nlink === 1n && before.size <= BigInt(maximum));
    const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    try {
      assert.ok(stampSame(before, await handle.stat({ bigint: true })));
      for (let offset = 0; offset < Number(before.size);) {
        assert.ok(!controller.signal.aborted, 'Cancelled');
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
        assert.ok(bytesRead > 0, 'Complete bounded file read'); hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      assert.ok(stampSame(before, await handle.stat({ bigint: true })) && stampSame(before, await fs.lstat(file, { bigint: true })), 'File identity/content changed during receipt');
      return { path: file, sha256: hash.digest('hex'), bytes: Number(before.size), identity: stamp(before) };
    } finally { await handle.close(); }
  }
  async function save() {
    if (!reportHandle) return;
    const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= LIMITS.reportBytes);
    const operation = saveChain.then(async () => {
      await assertOrdinaryPath(reportFile);
      assert.ok(stampSame(reportIdentity, await fs.lstat(reportFile, { bigint: true }))
        && stampSame(reportIdentity, await reportHandle.stat({ bigint: true })), 'Owned report changed; preserve it instead of replacing unknown data');
      for (let offset = 0; offset < bytes.length;) {
        const { bytesWritten } = await reportHandle.write(bytes, offset, bytes.length - offset, offset);
        assert.ok(bytesWritten > 0, 'Complete report write required'); offset += bytesWritten;
      }
      await reportHandle.truncate(bytes.length); await reportHandle.sync();
      const named = await fs.lstat(reportFile, { bigint: true }), opened = await reportHandle.stat({ bigint: true });
      assert.ok(stampSame(named, opened) && objectSame(named, reportIdentity) && named.nlink === 1n);
      reportIdentity = opened;
    });
    saveChain = operation; return operation;
  }
  async function reserveDirectory(parent, name) {
    await assertOrdinaryPath(parent, 'directory'); const location = path.join(parent, name);
    await fs.mkdir(location); await assertOrdinaryPath(location, 'directory'); return location;
  }
  async function space() {
    const result = {};
    for (const [label, location] of [['D', ROOT], ['F', OWNED]]) {
      const stat = await fs.statfs(location, { bigint: true }); result[label] = { availableBytes: String(stat.bavail * stat.bsize), at: new Date().toISOString() };
    }
    assert.ok(BigInt(result.D.availableBytes) >= 25n * 1024n ** 3n + BigInt(LIMITS.reportBytes), 'D: must retain 25 GiB after report forecast');
    assert.ok(BigInt(result.F.availableBytes) >= BigInt(LIMITS.ownedBytes) + 512n * 1024n ** 2n, 'F: needs bounded output forecast plus 512 MiB margin'); return result;
  }
  async function receipt(file) {
    const result = await hashFile(file, LIMITS.stdoutBytes * 2); report.artifacts[file] = result;
    assert.ok(Object.values(report.artifacts).reduce((sum, item) => sum + item.bytes, 0) <= LIMITS.ownedBytes, 'Owned output budget'); return result;
  }
  async function writeEvidence(name, bytes) {
    const filename = path.join(staging, name); assert.ok(ownedOutput(filename));
    await assertOrdinaryPath(staging, 'directory'); const handle = await fs.open(filename, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return receipt(filename);
  }
  async function run(executable, argv, requested = {}) {
    assert.ok(Object.values(tools).includes(executable)); assert.equal(children.size, 0, 'One exclusive native media child');
    assert.ok(report.invocations.length < LIMITS.invocations && !controller.signal.aborted); assert.ok(!argv.includes('-y'));
    const version = argv.length === 1 && argv[0] === '-version';
    if (!version) {
      const inputs = argv.flatMap((arg, index) => arg === '-i' ? [argv[index + 1]] : []);
      assert.equal(inputs.length, 1); assert.ok(sourcePaths.has(inputs[0]) || ownedOutput(inputs[0]));
      await assertOrdinaryPath(inputs[0]);
    }
    const destination = !version && executable === tools.ffmpeg && argv.at(-1) !== '-' ? argv.at(-1) : null;
    if (destination) {
      assert.ok(ownedOutput(destination)); await assertOrdinaryPath(path.dirname(destination), 'directory');
      await fs.lstat(destination).then(() => { throw new Error('Existing output is retained, never overwritten'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
    const invocation = { sequence: report.invocations.length + 1, executable, argv: [...argv], startedAt: new Date().toISOString(), status: 'running' };
    report.invocations.push(invocation); await save();
    const start = process.hrtime.bigint();
    try {
      const result = await runTool(executable, argv, { ...requested, signal: controller.signal, timeoutMs: LIMITS.childMs,
        stdoutLimit: LIMITS.stdoutBytes, stderrLimit: LIMITS.stderrBytes,
        onChild: child => { children.add(child); invocation.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
          child.once('close', (code, signal) => { invocation.observedClose = { code, signal }; children.delete(child); }); } });
      invocation.stdout = await writeEvidence(`${invocation.sequence}.stdout.txt`, result.stdout);
      invocation.stderr = await writeEvidence(`${invocation.sequence}.stderr.txt`, result.stderr);
      invocation.stderrCapture = result.stderrCapture; invocation.exitCode = result.exitCode; invocation.status = 'completed';
      if (destination) invocation.output = await receipt(destination);
      return { ...result, invocation };
    } catch (error) { invocation.status = 'failed'; invocation.failure = errorData(error); throw error; }
    finally { invocation.elapsedMs = Number(process.hrtime.bigint() - start) / 1e6; invocation.finishedAt = new Date().toISOString(); await save(); }
  }
  async function probe(file) {
    return inspectMetadata(file, { ffprobe: tools.ffprobe, run, signal: controller.signal });
  }
  async function collect(file, media, label) {
    assert.ok(media.streams.every(stream => ['video', 'audio'].includes(stream.codec_type)), 'Only the fixed video/audio subset is qualified');
    assert.equal(media.chapters.length, 0); const result = new Map();
    const packets = await run(tools.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', '-i', file]);
    requireComplete(packets); const packetRecords = JSON.parse(packets.stdout).packets;
    assert.ok(Array.isArray(packetRecords) && packetRecords.length > 0 && packetRecords.length <= LIMITS.frames * 4);
    for (const stream of media.streams) {
      const decoded = await run(tools.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', String(stream.index),
        '-show_frames', '-of', 'json', '-i', file]);
      requireComplete(decoded); const frames = JSON.parse(decoded.stdout).frames;
      assert.ok(Array.isArray(frames)); const receipts = [decoded.invocation.sequence]; let content, payload;
      if (stream.codec_type === 'video') {
        assert.equal(stream.pix_fmt, 'yuv420p', 'This campaign does not qualify arbitrary depths/chroma');
        const hashes = await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-xerror',
          '-protocol_whitelist', 'file,pipe', '-copyts', '-noautorotate', '-i', file, '-map', `0:${stream.index}`, '-an', '-sn', '-dn',
          '-c:v', 'rawvideo', '-pix_fmt', stream.pix_fmt, '-enc_time_base', 'demux', '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', '-']);
        requireComplete(hashes); payload = frameHashRows(hashes.stdout); assert.equal(payload.length, frames.length, 'Hash every decoded video frame');
        assert.ok(payload.every(row => row.bytes === stream.width * stream.height * 3 / 2), 'Native 8-bit 4:2:0 frame size');
        content = sha(JSON.stringify(payload)); receipts.push(hashes.invocation.sequence);
      } else {
        const formats = { s16: ['pcm_s16le', 's16le', 2], fltp: ['pcm_f32le', 'f32le', 4] };
        assert.ok(Object.hasOwn(formats, stream.sample_fmt), 'Unmeasured native sample representation remains outside this campaign');
        const [codec, format, bytesPerSample] = formats[stream.sample_fmt];
        const raw = path.join(staging, `${label}-stream-${stream.index}.${format}`);
        const audio = await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-xerror',
          '-protocol_whitelist', 'file,pipe', '-copyts', '-i', file, '-map', `0:${stream.index}`, '-vn', '-sn', '-dn',
          '-c:a', codec, '-f', format, raw]);
        requireComplete(audio); const rawReceipt = report.artifacts[raw];
        const sampleCount = frames.reduce((sum, frame) => sum + Number(exactInteger(frame.nb_samples, 'Native samples')), 0);
        assert.equal(rawReceipt.bytes, sampleCount * stream.channels * bytesPerSample, 'Decode complete native samples without hidden padding/resampling');
        content = rawReceipt.sha256; payload = { format, bytesPerSample, channels: stream.channels, sampleRate: stream.sample_rate, rawReceipt };
        receipts.push(audio.invocation.sequence);
      }
      const timeline = collectTimeline(frames, stream, content, receipts);
      const streamPackets = packetRecords.filter(packet => packet.stream_index === stream.index);
      assert.ok(streamPackets.length > 0 && streamPackets.every(packet => /^SHA256:[a-f0-9]{64}$/i.test(packet.data_hash || '')));
      const packetSeal = sha(JSON.stringify(streamPackets.map(packet => ({ bytes: String(packet.size), dataHash: packet.data_hash.toLowerCase() }))));
      result.set(stream.index, { ...timeline, payload, frameReceipt: decoded.invocation.stdout, packetReceipt: packets.invocation.stdout,
        packetSeal, packetCount: streamPackets.length, opaqueSideData: frames.some(frame => (frame.side_data_list || []).some(side => Object.keys(side).every(key => key === 'side_data_type'))) });
    }
    return result;
  }
  function publicCollection(collection) {
    return [...collection].map(([index, value]) => ({ index, ...value.record, decodeReceipts: value.decodeReceipts,
      packetPresentation: value.packetPresentation,
      frameReceipt: value.frameReceipt, packetReceipt: value.packetReceipt, packetSeal: value.packetSeal, packetCount: value.packetCount,
      opaqueSideData: value.opaqueSideData, payload: value.payload }));
  }
  async function caseRun(source, target) {
    const item = { id: `${source.id}-to-${target}`, source: source.id, target, status: 'assessing', outputId: randomUUID() };
    report.cases.push(item); await save();
    try {
      item.sourceBefore = await hashFile(source.path); assert.deepEqual(item.sourceBefore, source.receipt, 'Source remains bound to initial full receipt');
      const assessment = assessRemux({ request: { fileId: source.id, identityRevision: 0, draftRevision: 0, operation: 'remux', target, range: null, omissionRequestIds: [] },
        probe: source.probe, sourceFingerprint: sha(JSON.stringify(item.sourceBefore)) });
      item.assessment = assessment;
      if (assessment.status === 'blocked') { item.status = 'assessment-blocked'; item.blockers = assessment.blockers; return; }
      item.output = path.join(outputs, `${item.id}-${item.outputId}.${target === 'matroska' ? 'mkv' : target}`);
      item.argv = buildRemuxQualificationArgs({ assessment, input: source.path, output: item.output, outputId: item.outputId });
      assert.ok(item.argv.includes('copy') && !item.argv.includes('-vf') && !item.argv.includes('-af'), 'Canonical stream-copy-only builder');
      const mux = await run(tools.ffmpeg, item.argv); item.mux = { invocation: mux.invocation.sequence, warnings: mux.stderr, stderrCapture: mux.stderrCapture };
      assert.ok(!mux.stderrCapture.truncated, 'Complete mux diagnostics required');
      item.outputReceipt = report.artifacts[item.output]; const outputProbe = await probe(item.output); item.outputProbe = outputProbe;
      if (target === 'mov') item.movRepresentationReceipt = await observeMovRepresentation({ outputId: item.outputId,
        outputProbe, fileReceipt: item.outputReceipt, signal: controller.signal });
      const outputCollection = await collect(item.output, outputProbe, item.id); item.outputCollection = publicCollection(outputCollection);
      let ceiling = rational(0); const essence = { version: 1, runtimeIdentity: runtimeId, sourceFingerprint: assessment.sourceFingerprint,
        sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint, outputId: item.outputId,
        outputEvidenceFingerprint: remuxProbeFingerprint(outputProbe), outputFileSha256: item.outputReceipt.sha256, complete: true, streams: [] };
      item.codedPacketComparisons = [];
      for (const stream of assessment.expectedOutput.streams) {
        const before = source.collection.get(stream.inputIndex), after = outputCollection.get(stream.outputIndex);
        assert.ok(before && after, 'Exact admitted stream collection');
        const sourceStream = source.probe.streams.find(value => value.index === stream.inputIndex), targetStream = outputProbe.streams.find(value => value.index === stream.outputIndex);
        const bound = timestampCeiling(sourceStream, targetStream); if (greater(bound, ceiling)) ceiling = bound;
        essence.streams.push({ inputIndex: stream.inputIndex, outputIndex: stream.outputIndex, codecType: stream.codecType,
          source: before.record, output: after.record, timestamps: compareTimelines(before, after) });
        item.codedPacketComparisons.push({ inputIndex: stream.inputIndex, outputIndex: stream.outputIndex,
          samePacketPayloadSequence: before.packetSeal === after.packetSeal, sourcePackets: before.packetCount, outputPackets: after.packetCount,
          opaqueSideDataRequiresCodedProof: before.opaqueSideData || after.opaqueSideData });
      }
      item.essenceEvidence = essence; item.timestampCeiling = { value: encoded(ceiling), policy: 'One exact source tick plus one output tick, bounded to 2 ms; not fitted after observing errors.' };
      item.mediaValidation = validateRemuxMediaQualification({ assessment, runtimeIdentity: runtimeId, cellId: item.id,
        outputId: item.outputId, outputProbe, essenceEvidence: essence, maxTimestampError: encoded(ceiling), maxChapterError: encoded(rational(0)),
        ...(item.movRepresentationReceipt ? { movRepresentationReceipt: item.movRepresentationReceipt } : {}) });
      item.opaquePayloadGap = item.codedPacketComparisons.some(value => value.opaqueSideDataRequiresCodedProof && !value.samePacketPayloadSequence);
      if (item.opaquePayloadGap) item.unresolvedEvidence = [
        'Decoded pixels/samples and exposed metadata are independently validated. A changed packet representation is not itself content loss.',
        'The exposed opaque side-data descriptor is not its payload. A normalized coded-payload proof is still needed before this fixture cell can be qualified.',
      ];
      // Framing differences are not labelled corruption. Native decoded proof
      // remains useful, but opaque SEI payload cannot be invented from its label.
      // That cell remains unqualified until a normalized coded-payload collector
      // establishes the otherwise unexposed semantic bytes.
      item.productionQualification = { status: 'refused', executionReady: false,
        missingQualificationIds: item.mediaValidation.missingQualificationIds,
        reason: 'No production application lifecycle/publication/rescan evidence in this harness.' };
      const production = createRemuxValidator({ requireQualification: () => item.mediaValidation });
      assert.throws(() => production.prepare({ assessment, runtimeIdentity: runtimeId, cellId: item.id, outputId: item.outputId }),
        'Media-only result must never be reusable as production qualification authority');
      item.status = item.mediaValidation.valid && !item.opaquePayloadGap
        ? mux.stderr.trim() ? 'media-passed-with-warnings' : 'media-passed' : 'media-unqualified';
    } catch (error) { item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.failure = errorData(error); }
    finally {
      try { item.sourceAfter = await hashFile(source.path); assert.deepEqual(item.sourceAfter, source.receipt, 'Source preserved throughout qualification'); }
      catch (error) { item.sourcePreservationFailure = errorData(error); item.status = 'unsafe-source-change'; controller.abort(); }
      if (item.outputReceipt) try { item.outputAfter = await hashFile(item.output); assert.deepEqual(item.outputAfter, item.outputReceipt, 'Qualified output remained bound to its receipt'); }
      catch (error) { item.outputPreservationFailure = errorData(error); item.status = 'unsafe-output-change'; controller.abort(); }
      item.finishedAt = new Date().toISOString(); await save();
    }
  }
  try {
    await assertOrdinaryPath(path.dirname(LEASE), 'directory');
    // Existing/unknown leases are never interpreted as stale or removed here.
    leaseHandle = await fs.open(LEASE, 'wx+'); await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: id,
      pid: process.pid, purpose: 'remux-native-media-qualification', startedAt: report.startedAt })); await leaseHandle.sync(); leaseIdentity = await leaseHandle.stat({ bigint: true });
    deadline = setTimeout(stop, LIMITS.overallMs); report.resourceBefore = await space();
    await assertOrdinaryPath(path.dirname(REPORT_BASE), 'directory');
    await fs.mkdir(REPORT_BASE).catch(error => { if (error.code !== 'EEXIST') throw error; }); await assertOrdinaryPath(REPORT_BASE, 'directory');
    await reserveDirectory(REPORT_BASE, id); await reserveDirectory(path.join(OWNED, 'outputs'), `remux-${id}`);
    await reserveDirectory(path.join(OWNED, 'staging'), `remux-${id}`);
    reportHandle = await fs.open(reportFile, 'wx+'); reportIdentity = await reportHandle.stat({ bigint: true }); await save();
    report.modules = {};
    for (const module of MODULES) report.modules[module] = await hashFile(path.join(ROOT, module), 2 * 1024 * 1024);
    const runtime = await verifyCandidateRuntime({ root: ROOT }); tools = { ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe };
    assert.equal(runtime.manifest.release, '9.0.2'); runtimeId = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    report.runtimeIdentity = runtimeId; report.runtime = {};
    for (const [tool, file] of Object.entries(tools)) {
      report.runtime[tool] = await hashFile(file, 256 * 1024 * 1024);
      const version = await run(file, ['-version']); assert.match(version.stdout.split(/\r?\n/)[0], new RegExp(`^${tool} version 9\\.0\\.2(?:[-\\s]|$)`));
      report.runtime[tool].version = version.stdout.split(/\r?\n/)[0];
    }
    const originalReport = await hashFile(SOURCE_REPORT, 64 * 1024 * 1024);
    // Runtime manifests deliberately have a much smaller JSON bound. Historical
    // decoded fixture evidence is larger; read its known receipt without relaxing
    // the production manifest parser or permitting an unbounded readFile.
    const evidenceHandle = await fs.open(SOURCE_REPORT, 'r');
    let prior;
    try {
      const bytes = Buffer.alloc(originalReport.bytes + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const part = await evidenceHandle.read(bytes, offset, bytes.length - offset, offset);
        if (!part.bytesRead) break;
        offset += part.bytesRead;
      }
      assert.equal(offset, originalReport.bytes, 'Known report length remains stable');
      assert.equal(sha(bytes.subarray(0, offset)), originalReport.sha256, 'Exact report receipt');
      prior = JSON.parse(bytes.subarray(0, offset).toString('utf8'));
    } finally { await evidenceHandle.close(); }
    assert.deepEqual(await hashFile(SOURCE_REPORT, 64 * 1024 * 1024), originalReport, 'Read original evidence through the same stable receipt');
    assert.equal(prior.id, SOURCE_RUN); assert.equal(prior.expectedRuntime, runtimeId);
    assert.equal(prior.ownedPaths.fixtures, FIXTURES); assert.equal(prior.ownedPaths.outputs, SOURCE_OUTPUTS);
    report.sourceReport = originalReport; report.status = 'running';
    for (const spec of selectedSources) {
      const saved = prior.artifacts[spec.path]; assert.ok(saved && saved.sha256 && saved.bytes <= LIMITS.sourceBytes, 'Exact prior owned fixture receipt required');
      const source = { ...spec, receipt: await hashFile(spec.path) };
      assert.equal(source.receipt.sha256, saved.sha256); assert.equal(source.receipt.bytes, saved.bytes);
      source.probe = await probe(source.path);
      assert.ok(source.probe.streams.every(stream => stream.codec_type === 'audio' || stream.codec_type === 'video'
        && stream.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && stream.color_transfer === 'bt709'), 'Only the measured SDR H.264 fixture subset');
      source.collection = await collect(source.path, source.probe, `source-${source.id}`);
      assert.deepEqual(await hashFile(source.path), source.receipt, 'Source stable across complete decode collection');
      report.sources.push({ id: source.id, sourceBefore: source.receipt, previousReceipt: saved, probe: source.probe, collection: publicCollection(source.collection) });
      await save(); for (const target of source.targets) { assert.ok(!controller.signal.aborted); await caseRun(source, target); }
    }
    assert.deepEqual(await hashFile(SOURCE_REPORT, 64 * 1024 * 1024), originalReport, 'Prior evidence remains untouched');
    for (const [tool, file] of Object.entries(tools)) {
      report.runtime[tool].after = await hashFile(file, 256 * 1024 * 1024);
      assert.deepEqual(report.runtime[tool].after, Object.fromEntries(Object.entries(report.runtime[tool]).filter(([key]) => !['after', 'version'].includes(key))), 'Runtime pair preserved');
    }
    for (const module of MODULES) assert.deepEqual(await hashFile(path.join(ROOT, module), 2 * 1024 * 1024), report.modules[module], 'Code changed during qualification; start new evidence after reconciliation');
    report.resourceAfter = await space();
    report.summary = Object.fromEntries([...new Set(report.cases.map(item => item.status))].map(status => [status, report.cases.filter(item => item.status === status).length]));
    report.status = report.cases.length === expectedCases && report.cases.some(item => item.status === 'media-passed')
      && report.cases.every(item => item.status === 'media-passed' || item.id === 'timeline-pcm-to-mp4' && item.status === 'assessment-blocked')
      ? 'completed-bounded-media-subset' : 'completed-with-qualification-gaps';
    if (report.status !== 'completed-bounded-media-subset') process.exitCode = 1;
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = errorData(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); report.finishedAt = new Date().toISOString();
    if (leaseHandle) try {
      assert.equal(children.size, 0, 'Observed child closure required before lease release');
      const named = await fs.lstat(LEASE, { bigint: true }), opened = await leaseHandle.stat({ bigint: true });
      assert.ok(named.nlink === 1n && named.size <= 8192n && stampSame(named, opened) && stampSame(named, leaseIdentity));
      const bytes = Buffer.alloc(Number(named.size)); const read = await leaseHandle.read(bytes, 0, bytes.length, 0); assert.equal(read.bytesRead, bytes.length);
      const record = JSON.parse(bytes); assert.equal(record.token, id); assert.equal(record.pid, process.pid);
      await leaseHandle.close(); leaseHandle = null;
      const after = await fs.lstat(LEASE, { bigint: true }); assert.ok(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n
        && after.size === named.size && objectSame(after, named)); await fs.unlink(LEASE); report.leaseReleased = true;
    } catch (error) { report.leaseRetained = error.message; }
    await leaseHandle?.close().catch(() => {}); await save().catch(error => { console.error('Report retained with a persistence failure:', error.message); process.exitCode = 1; });
    await reportHandle?.close().catch(() => {}); console.log(`Remux media qualification: ${reportHandle ? reportFile : 'no report/media started'}`);
  }
}

function pureTests() {
  const video = { codec_type: 'video', index: 0, time_base: '1/12800' };
  const frames = [{ media_type: 'video', stream_index: 0, pts: 128000, duration: 512, width: 320, height: 180, pix_fmt: 'yuv420p' },
    { media_type: 'video', stream_index: 0, pts: 129024, duration: 512, width: 320, height: 180, pix_fmt: 'yuv420p' }];
  const before = collectTimeline(frames, video, 'a'.repeat(64), []);
  assert.deepEqual(before.record.firstPts, { numerator: '10', denominator: '1' });
  assert.deepEqual(compareTimelines(before, before).maxPtsError, { numerator: '0', denominator: '1' });
  const shifted = collectTimeline(frames.map(frame => ({ ...frame, pts: frame.pts + 128 })), video, 'a'.repeat(64), []);
  assert.deepEqual(compareTimelines(before, shifted).maxPtsError, { numerator: '1', denominator: '100' });
  const audio = { codec_type: 'audio', index: 1, sample_rate: '44100', time_base: '1/44100' };
  const frame = (pts, nb_samples) => ({ media_type: 'audio', stream_index: 1, pts, nb_samples, sample_fmt: 's16' });
  const a = collectTimeline([frame(441000, 4)], audio, 'b'.repeat(64), []);
  const b = collectTimeline([frame(441000, 1), frame(441001, 3)], audio, 'b'.repeat(64), []);
  assert.equal(a.record.metadataSha256, b.record.metadataSha256, 'Native per-sample metadata is segmentation-independent');
  assert.deepEqual(compareTimelines(a, b).maxPtsError, { numerator: '0', denominator: '1' });
  const altered = collectTimeline([frame(441000, 1), frame(441002, 3)], audio, 'b'.repeat(64), []);
  assert.deepEqual(compareTimelines(a, altered).maxPtsError, { numerator: '1', denominator: '44100' });
  const shortPacket = collectTimeline([{ ...frame(2005, 1024), duration: 8 }],
    { ...audio, sample_rate: '48000', time_base: '1/1000' }, 'b'.repeat(64), []);
  assert.deepEqual(shortPacket.record.endPts, { numerator: '6079', denominator: '3000' });
  assert.deepEqual(shortPacket.packetPresentation.endPts, { numerator: '2013', denominator: '1000' });
  assert.deepEqual(shortPacket.packetPresentation.lastDuration, { numerator: '1', denominator: '125' });
  assert.throws(() => collectTimeline([{ ...frames[0], duration: 0 }], video, 'a'.repeat(64), []));
  assert.throws(() => framePts({ pts: 9007199254740992 }, video));
  assert.throws(() => timestampCeiling(video, { time_base: '1/25' }));
  assert.equal(frameHashRows('#hash: SHA256\n0, 0, 0, 1, 6, ' + 'c'.repeat(64)).length, 1);
  assert.throws(() => frameHashRows('1, 0, 0, 1, 6, ' + 'c'.repeat(64)));
  assert.ok(!isDeepStrictEqual(nativeMetadata({ width: 320, side_data_list: [{ side_data_type: 'x', value: 1 }] }, 'video'),
    nativeMetadata({ width: 320, side_data_list: [{ side_data_type: 'x', value: 2 }] }, 'video')));
  console.log('Remux pure collector checks passed; no files, lease, process or media work performed.');
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { framePts, frameDuration, frameHashRows, collectTimeline, compareTimelines, timestampCeiling, nativeMetadata, pureTests };
