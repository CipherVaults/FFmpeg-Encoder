'use strict';

// Q2c parameterised PCM copy of v07-sdr-envelope-fixtures.cjs, left unchanged.
// Parent-run synthetic fixture preparation only. Importing this module does not
// create files or launch children. No fixture pass grants application support.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { runTool, boundedToolStderr } = require('../src/process-runner.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { compactRow } = require('../src/operation-evidence.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const LEASE = path.join(ROOT, 'artifacts', 'v0.7', 'media-job.lock');
const RUN_FLAG = '--run-owned-fixtures';
const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ generationMs: 180000, probeMs: 30000, totalMs: 15 * 60000,
  stdoutBytes: 32 * MiB, stderrBytes: 32 * MiB, reportBytes: 32 * MiB,
  forecastBytes: GiB, maximumFileBytes: 256 * MiB, minimumDFreeBytes: 25 * GiB,
  minimumFFreeBytes: 512 * MiB, maximumChildren: 14, monitorMs: 1000 });
const FIXTURES = Object.freeze([
  // Four sources: one for each admitted geometry/rate. A is reused for the
  // off-frame 1080p30 resize cell; D is reused for 1080p60 Keep Source.
  Object.freeze({ id: 'A', width: 1920, height: 1080, fps: 30, seconds: 10, container: 'mov', range: { startUs: 0, endUs: 500000 }, resolution: 'source' }),
  Object.freeze({ id: 'B', width: 1280, height: 720, fps: 30, seconds: 8, container: 'mov', range: { endUs: 7987000 }, resolution: 'source' }),
  Object.freeze({ id: 'C', width: 1280, height: 720, fps: 60, seconds: 32, container: 'mov', range: { startUs: 2000000 }, resolution: 'source' }),
  Object.freeze({ id: 'D', width: 1920, height: 1080, fps: 60, seconds: 120, container: 'mov', range: { startUs: 90013000, endUs: 120000000 }, resolution: '720' }),
]);
const sameObject = (a, b) => a && b && a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const ordinaryFile = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n;
const stamp = stat => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])]));
const failure = error => ({ code: String(error?.code || 'ERROR').slice(0, 128), message: String(error?.message || error).slice(0, 2000),
  ...(typeof error?.stderr === 'string' ? boundedToolStderr(error, 256 * 1024) : {}) });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function audioSource(seconds) {
  // Different deterministic chirps identify channels and provide changing phase
  // across time; this is a generated PCM source, never a perceptual-quality claim.
  return `aevalsrc=0.18*sin(2*PI*(440*t+5.5*t*t))|0.18*sin(2*PI*(659*t+6.5*t*t)):s=48000:c=stereo:d=${seconds}`;
}

function generationArgs(spec, output, byteLimit) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-n',
    '-f', 'lavfi', '-i', `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}/1:duration=${spec.seconds}`,
    '-f', 'lavfi', '-i', audioSource(spec.seconds), '-map', '0:v:0', '-map', '1:a:0',
    // testsrc2 supplies synthetic YUV values without complete color properties.
    // Declare their chosen interpretation before strict +yuv420p negotiation;
    // this is fixture construction, never a conversion of existing footage.
    '-map_metadata', '-1', '-map_chapters', '-1', '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
    '-x264-params', `keyint=${spec.fps * 2}:min-keyint=${spec.fps * 2}:scenecut=0:bframes=3:b-adapt=0:open-gop=0`,
    '-maxrate:v:0', '12M', '-bufsize:v:0', '24M', '-fps_mode:v:0', 'passthrough',
    '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv',
    '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16', '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo',
    '-t', String(spec.seconds), '-metadata', `title=Q2c generated PCM fixture ${spec.id}`,
    '-metadata', 'comment=Deterministic lavfi testsrc2 and channel-distinct chirps; fixture preparation only',
    '-movflags', '+faststart', '-fs', String(byteLimit), '-f', spec.container, output];
}

function positiveRational(value, label) {
  const match = /^(0|[1-9]\d*)\/([1-9]\d*)$/.exec(String(value));
  assert.ok(match && BigInt(match[1]) > 0n, `${label} requires an exact positive rational`);
  return { n: BigInt(match[1]), d: BigInt(match[2]) };
}

function assessMetadata(spec, probe) {
  assert.equal(probe.streams.length, 2, 'Only generated video and stereo audio are permitted');
  assert.deepEqual(probe.streams.map(stream => stream.codec_type), ['video', 'audio']);
  assert.equal(probe.programs.length, 0); assert.equal(probe.stream_groups.length, 0); assert.equal(probe.chapters.length, 0);
  const [video, audio] = probe.streams;
  for (const [field, expected] of Object.entries({ codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: spec.width,
    height: spec.height, field_order: 'progressive', sample_aspect_ratio: '1:1', color_transfer: 'bt709',
    color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv' })) assert.equal(video[field], expected, `Video ${field}`);
  for (const field of ['avg_frame_rate', 'r_frame_rate']) {
    const rate = positiveRational(video[field], field); assert.equal(rate.n, BigInt(spec.fps) * rate.d);
  }
  for (const [field, expected] of Object.entries({ codec_name: 'pcm_s16le', bits_per_sample: 16, sample_fmt: 's16', sample_rate: '48000', channels: 2,
    channel_layout: 'stereo' })) assert.equal(audio[field], expected, `Audio ${field}`);
  for (const stream of [video, audio]) {
    const tb = positiveRational(stream.time_base, 'Source time base');
    assert.equal(BigInt(stream.start_pts), 0n, 'Generated presentation origin must be observed as zero');
    assert.equal(BigInt(stream.duration_ts) * tb.n, BigInt(spec.seconds) * tb.d, 'Generated stream duration must match its specification');
  }
  assert.equal(Number(probe.format.start_time), 0); assert.equal(Number(probe.format.duration), spec.seconds);
  const orientation = probe.mediaEvidence.streams.find(stream => stream.index === video.index).geometry;
  let orientationInterpretation = 'Absence recorded only; no identity-orientation qualification issued.';
  if (orientation.rotationSource !== 'not-reported') {
    assert.equal(orientation.rotationDegrees.state, 'known', 'Reported orientation must be complete');
    assert.equal(BigInt(orientation.rotationDegrees.value.numerator), 0n, 'A nonzero orientation was not requested');
    assert.ok(BigInt(orientation.rotationDegrees.value.denominator) > 0n);
    if (orientation.rotationSource === 'display-matrix') {
      assert.equal(orientation.displayMatrix.state, 'known');
      assert.deepEqual(orientation.displayMatrix.value, ['65536', '0', '0', '0', '65536', '0', '0', '0', '1073741824']);
      assert.notEqual(orientation.legacyRotationDegrees.state, 'known', 'Conflicting orientation forms were not requested');
    } else assert.equal(orientation.rotationSource, 'legacy-rotate-tag');
    orientationInterpretation = 'Explicit zero orientation observed in the actual probe; no family qualification issued.';
  }
  return { video: { index: video.index, codec: video.codec_name, profile: video.profile, width: video.width, height: video.height,
    pixelFormat: video.pix_fmt, fieldOrder: video.field_order, sar: video.sample_aspect_ratio,
    nominalRate: video.r_frame_rate, averageRate: video.avg_frame_rate, timeBase: video.time_base, durationTicks: video.duration_ts,
    color: { primaries: video.color_primaries, transfer: video.color_transfer, matrix: video.color_space, range: video.color_range },
    orientation: { rotationSource: orientation.rotationSource, rotationDegrees: orientation.rotationDegrees,
      displayMatrix: orientation.displayMatrix, legacyRotationDegrees: orientation.legacyRotationDegrees },
    orientationInterpretation },
  audio: { index: audio.index, codec: audio.codec_name, profile: audio.profile, sampleFormat: audio.sample_fmt, sampleRate: audio.sample_rate,
    channels: audio.channels, layout: audio.channel_layout, timeBase: audio.time_base, durationTicks: audio.duration_ts },
  container: { format: probe.format.format_name, majorBrand: probe.format.tags?.major_brand ?? null, duration: probe.format.duration } };
}

function assessVideoFrames(spec, probe, text) {
  const tb = positiveRational(probe.streams[0].time_base, 'Decoded video time base');
  const lines = text.split(/\r?\n/).filter(Boolean), types = { I: 0, P: 0, B: 0 }, keyframes = [];
  assert.equal(lines.length, spec.seconds * spec.fps, 'Complete decoded frame count');
  for (const [index, line] of lines.entries()) {
    // Reuse the strict compact grammar, including FFprobe's empty side_data
    // section marker. Unknown, duplicate or escaped fields still fail closed.
    const row = compactRow(line, 'frame', ['pts', 'duration', 'key_frame', 'pict_type']);
    assert.match(row.pts, /^(0|[1-9]\d*)$/); assert.match(row.duration, /^[1-9]\d*$/);
    assert.equal(BigInt(row.pts) * tb.n * BigInt(spec.fps), BigInt(index) * tb.d, 'Every decoded source PTS must match the fixed CFR clock');
    assert.equal(BigInt(row.duration) * tb.n * BigInt(spec.fps), tb.d, 'Every decoded frame duration must match the CFR period');
    assert.ok(Object.hasOwn(types, row.pict_type)); types[row.pict_type]++;
    assert.ok(['0', '1'].includes(row.key_frame));
    if (row.key_frame === '1') { assert.equal(index % (spec.fps * 2), 0, 'Unexpected keyframe outside the fixed two-second GOP'); keyframes.push(index); }
  }
  assert.ok(types.B > 0); assert.equal(keyframes.length, Math.ceil(spec.seconds / 2));
  return { scope: 'complete-generated-source-video-timing-and-picture-types', frames: lines.length, pictureTypes: types, keyframeOrdinals: keyframes,
    constantFrameRateVerified: true, exactFramePeriod: `1/${spec.fps}`, lastFrameDurationVerified: true,
    doesNotEstablish: ['application-operation-support', 'FLAC-PCM-identity', 'output-quality', 'display-acceptance'] };
}

async function main(argv = process.argv.slice(2)) {
  assert.deepEqual(argv, [RUN_FLAG], `Explicit ${RUN_FLAG} is required; no implicit or additional arguments are accepted`);
  assert.equal(process.platform, 'win32', 'This owned fixture harness is Windows-only');
  const id = randomUUID(), started = Date.now(), controller = new AbortController();
  const directory = path.join(ROOT, 'artifacts', 'v0.7', 'slice2', 'pcm-envelope-fixtures', id);
  const fixtureRoot = path.join(OWNED, 'fixtures', `sdr-pcm-envelope-${id}`), reportFile = path.join(directory, 'report.json');
  const children = new Set(), tracked = [], boundDirectories = [], outputs = new Set();
  let runtime, pinnedToolIdentities, leaseHandle, leaseIdentity, leaseBytes, reportHandle, reportIdentity, monitor, monitorTask, monitoringFailure;
  const report = { schema: 1, id, purpose: 'Prepare four bounded owned synthetic SDR PCM fixtures; no family or application qualification',
    status: 'preparing', startedAt: new Date(started).toISOString(), directory, fixtureRoot, limits: LIMITS,
    provenance: { kind: 'locally-generated-synthetic', userOrExistingMediaReads: 0, downloadedBytes: 0,
      video: 'Fixed lavfi testsrc2 with moving spatial markers, explicitly interpreted as BT709/limited with square SAR; no font-dependent filter',
      audio: 'Stereo deterministic chirps: left phase 2*pi*(440*t+5.5*t*t), right phase 2*pi*(659*t+6.5*t*t)',
      videoEncoder: 'libx264 High/yuv420p, veryfast CRF23, 12M maxrate/24M buffer, fixed closed two-second GOP with three B-frames',
      audioEncoder: 'pcm_s16le/s16, 48000Hz stereo', previousReleasesOrDefaultsChanged: false },
    invocations: [], cases: [], maximumConcurrentChildren: 0, leaseReleased: false, familyQualificationGranted: false,
    limitations: ['Fixtures alone do not qualify transformed application operations, FLAC identity, quality, portability or native UI.',
      'Generated source file hashes attest these owned files only; no original or user media is read.',
      'Disk polling observes and aborts growth; neither polling nor FFmpeg -fs is a byte-exact filesystem quota.',
      'Runtime hashes are verified at entry and exit; file identities are checked around every child. CreateProcess still opens executables by path.',
      'Node cannot atomically unlink a file conditional on identity; the exclusive lease is checked immediately before its fixed-name removal.'] };
  const expired = () => { if (controller.signal.aborted || Date.now() - started >= LIMITS.totalMs) fail('FIXTURE_CANCELLED_OR_DEADLINE', 'Fixture preparation cancelled or its fifteen-minute total budget expired'); };
  const abort = () => controller.abort();
  const totalTimer = setTimeout(abort, LIMITS.totalMs); totalTimer.unref();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);

  async function bindDirectory(file) {
    await assertOrdinaryPath(file, 'directory'); const stat = await fs.lstat(file, { bigint: true });
    boundDirectories.push({ file, stat });
  }
  async function guardDirectories() {
    for (const entry of boundDirectories) {
      await assertOrdinaryPath(entry.file, 'directory'); assert.ok(sameObject(entry.stat, await fs.lstat(entry.file, { bigint: true })), 'Owned namespace identity changed');
    }
  }
  async function ensureReportParents() {
    let current = ROOT; await bindDirectory(current);
    for (const part of ['artifacts', 'v0.7', 'slice2', 'pcm-envelope-fixtures']) {
      current = path.join(current, part); try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await bindDirectory(current);
    }
    await fs.mkdir(directory); await bindDirectory(directory);
  }
  async function save() {
    if (!reportHandle) return;
    await guardDirectories();
    assert.ok(sameFile(reportIdentity, await reportHandle.stat({ bigint: true })) && sameFile(reportIdentity, await fs.lstat(reportFile, { bigint: true })), 'Owned report identity changed');
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n'); assert.ok(bytes.length <= LIMITS.reportBytes, 'Report exceeds its bounded size');
    let offset = 0;
    while (offset < bytes.length) { const result = await reportHandle.write(bytes, offset, bytes.length - offset, offset); assert.ok(result.bytesWritten > 0); offset += result.bytesWritten; }
    await reportHandle.truncate(bytes.length); await reportHandle.sync(); reportIdentity = await reportHandle.stat({ bigint: true });
    assert.ok(ordinaryFile(reportIdentity) && sameFile(reportIdentity, await fs.lstat(reportFile, { bigint: true })), 'Report publication became ambiguous');
  }
  async function guardLease() {
    assert.ok(leaseHandle && leaseIdentity, 'No owned media lease');
    const named = await fs.lstat(LEASE, { bigint: true }), opened = await leaseHandle.stat({ bigint: true });
    assert.ok(ordinaryFile(named) && sameFile(leaseIdentity, named) && sameFile(named, opened), 'Media lease ownership changed; preserve it');
  }
  async function acquireLease() {
    leaseHandle = await fs.open(LEASE, 'wx+');
    const empty = await leaseHandle.stat({ bigint: true });
    assert.ok(ordinaryFile(empty) && empty.size === 0n && sameFile(empty, await fs.lstat(LEASE, { bigint: true })), 'Exclusive media lease could not be bound');
    leaseBytes = Buffer.from(JSON.stringify({ schema: 1, token: id, pid: process.pid, purpose: 'Slice2 owned SDR envelope fixture preparation', startedAt: report.startedAt }) + '\n');
    await leaseHandle.writeFile(leaseBytes); await leaseHandle.sync(); leaseIdentity = await leaseHandle.stat({ bigint: true });
    await guardLease(); report.lease = { path: LEASE, token: id, pid: process.pid, identity: stamp(leaseIdentity) };
  }
  async function ownedBytes() {
    let bytes = 0, files = 0; const entries = [];
    for (const root of [fixtureRoot, directory]) {
      let listing; try { listing = await fs.readdir(root); } catch (error) { if (error.code === 'ENOENT' && root === fixtureRoot) continue; throw error; }
      assert.ok(listing.length <= 8, 'Unexpected owned entry count');
      for (const name of listing) {
        const file = path.join(root, name); assert.ok(root === directory ? file === reportFile : outputs.has(file), 'Unexpected owned entry; preserved');
        const stat = await fs.lstat(file, { bigint: true }); assert.ok(ordinaryFile(stat) && await fs.realpath(file) === path.resolve(file), 'Unsafe owned file; preserved');
        const count = Number(stat.size); assert.ok(Number.isSafeInteger(count)); bytes += count; files++;
        if (root === fixtureRoot) assert.ok(count <= LIMITS.maximumFileBytes, 'Generated fixture exceeds its file budget');
        entries.push({ file, bytes: count });
      }
    }
    return { bytes, files, entries, accounting: 'Current logical named-file sizes; not peak allocated bytes or memory' };
  }
  async function resources(initial = false) {
    await guardDirectories();
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]), owned = await ownedBytes();
    const observed = { observedAt: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize,
      forecastAdditionalBytes: LIMITS.forecastBytes, owned };
    assert.ok(observed.DFreeBytes >= LIMITS.minimumDFreeBytes + (initial ? LIMITS.reportBytes : 0), 'D free-space floor/initial report reserve unavailable');
    assert.ok(observed.FFreeBytes >= LIMITS.minimumFFreeBytes + (initial ? LIMITS.forecastBytes : 0), 'F operational margin/initial one-GiB forecast unavailable');
    assert.ok(owned.bytes <= LIMITS.forecastBytes, 'Owned fixture/report forecast was exhausted');
    report.maximumObservedOwnedBytes = Math.max(report.maximumObservedOwnedBytes || 0, owned.bytes);
    return observed;
  }
  async function toolIdentities() {
    const identities = [];
    for (const tool of ['ffmpeg', 'ffprobe']) { await assertOrdinaryPath(runtime[tool]); identities.push(stamp(await fs.lstat(runtime[tool], { bigint: true }))); }
    return identities;
  }
  async function run(executable, args, options = {}, kind = 'metadata') {
    expired(); await guardDirectories(); await guardLease();
    assert.ok(executable === runtime.ffmpeg || executable === runtime.ffprobe, 'Exact pinned tools only');
    assert.ok(args.every(arg => typeof arg === 'string') && !args.includes('-y'));
    assert.equal(children.size, 0, 'Only one media child may run');
    assert.ok(report.invocations.length < LIMITS.maximumChildren, 'Child budget exhausted');
    for (let i = 0; i < args.length; i++) if (args[i] === '-i') {
      const input = args[i + 1];
      assert.ok(outputs.has(input) || kind === 'generation' && FIXTURES.some(spec => input === audioSource(spec.seconds)
        || input === `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}/1:duration=${spec.seconds}`), 'Only fixed lavfi or this run\'s generated files may be read');
    }
    if (kind === 'generation') assert.ok(executable === runtime.ffmpeg && args.includes('-n') && outputs.has(args.at(-1)));
    const before = await toolIdentities(); assert.deepEqual(before, pinnedToolIdentities, 'Runtime identity changed since its full pin verification');
    const entry = { kind, executable, argv: [...args], status: 'running', startedAt: new Date().toISOString(), runtimeBefore: before };
    report.invocations.push(entry); await save();
    let child;
    try {
      expired();
      const result = await runTool(executable, args, { signal: controller.signal,
        timeoutMs: Math.min(options.timeoutMs || (kind === 'generation' ? LIMITS.generationMs : LIMITS.probeMs), LIMITS.totalMs - (Date.now() - started)),
        stdoutLimit: Math.min(options.stdoutLimit ?? LIMITS.stdoutBytes, LIMITS.stdoutBytes),
        stderrLimit: Math.min(options.stderrLimit ?? LIMITS.stderrBytes, LIMITS.stderrBytes),
        onChild(value) { child = value; children.add(value); tracked.push({ child: value, closed: false });
          const observed = tracked.at(-1); value.once('close', () => { observed.closed = true; children.delete(value); });
          report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size); } });
      assert.equal(children.size, 0, 'Runner must drain child close');
      assert.equal(result.exitCode, 0); assert.ok(!result.stderrCapture.truncated, 'Truncated diagnostics cannot qualify a generated fixture');
      assert.ok(!result.stdoutCapture?.truncated, 'Truncated stdout cannot qualify a generated fixture');
      Object.assign(entry, { status: 'completed', exitCode: result.exitCode, stdout: result.stdout, stdoutCapture: result.stdoutCapture,
        ...boundedToolStderr(result, 256 * 1024) });
      return result;
    } catch (error) { Object.assign(entry, { status: 'failed', failure: failure(error) }); throw error; }
    finally {
      if (child) assert.ok(tracked.find(item => item.child === child)?.closed, 'Child closure is unknown; retain the lease');
      entry.finishedAt = new Date().toISOString();
      entry.runtimeAfter = await toolIdentities(); assert.deepEqual(entry.runtimeAfter, before, 'Pinned runtime files changed during child execution');
      await guardLease(); await save();
    }
  }
  async function hashOwned(file) {
    await guardDirectories(); assert.ok(outputs.has(file));
    const before = await fs.lstat(file, { bigint: true }); assert.ok(ordinaryFile(before) && before.size > 0n && before.size <= BigInt(LIMITS.maximumFileBytes));
    const handle = await fs.open(file, 'r');
    try {
      assert.ok(sameFile(before, await handle.stat({ bigint: true }))); const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: MiB })) { expired(); hash.update(chunk); }
      assert.ok(sameFile(before, await handle.stat({ bigint: true })) && sameFile(before, await fs.lstat(file, { bigint: true })), 'Generated fixture changed while hashing');
      return { file, bytes: Number(before.size), sha256: hash.digest('hex'), identity: stamp(before) };
    } finally { await handle.close(); }
  }
  async function releaseLease() {
    if (!leaseHandle) return;
    try {
      assert.ok(leaseIdentity && tracked.every(item => item.closed) && children.size === 0, 'Lease or child ownership is unknown; preserve lease');
      await guardDirectories(); await guardLease();
      const bytes = Buffer.alloc(leaseBytes.length + 1), read = await leaseHandle.read(bytes, 0, bytes.length, 0);
      assert.equal(read.bytesRead, leaseBytes.length); assert.ok(bytes.subarray(0, read.bytesRead).equals(leaseBytes));
      const owner = JSON.parse(bytes.subarray(0, read.bytesRead)); assert.equal(owner.token, id); assert.equal(owner.pid, process.pid);
      await guardLease(); await leaseHandle.close(); leaseHandle = null;
      assert.ok(sameFile(leaseIdentity, await fs.lstat(LEASE, { bigint: true })), 'Lease changed after handle close; preserved');
      await fs.unlink(LEASE); report.leaseReleased = true;
    } catch (error) {
      report.leaseRetention = failure(error);
      if (leaseHandle) { await leaseHandle.close().catch(() => {}); leaseHandle = null; }
      throw error;
    }
  }

  try {
    await ensureReportParents();
    reportHandle = await fs.open(reportFile, 'wx+'); reportIdentity = await reportHandle.stat({ bigint: true });
    await bindDirectory(OWNED); await bindDirectory(path.join(OWNED, 'fixtures')); await save();
    report.resourcesBefore = await resources(true); await acquireLease();
    await fs.mkdir(fixtureRoot); await bindDirectory(fixtureRoot); await save();
    runtime = await verifyCandidateRuntime({ root: ROOT }); expired(); pinnedToolIdentities = await toolIdentities();
    report.runtime = { manifestPath: runtime.manifestPath, manifest: runtime.manifest, verifiedBefore: runtime.verified, pinnedToolIdentities,
      runtimeIdentity: createHash('sha256').update(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex') };
    await save();
    monitor = setInterval(() => {
      if (monitorTask) return;
      monitorTask = resources().then(observed => { report.resourcesLatest = observed; }).catch(error => { monitoringFailure ||= error; controller.abort(); }).finally(() => { monitorTask = null; });
    }, LIMITS.monitorMs); monitor.unref();
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const observed = await run(runtime[tool], ['-version'], { stdoutLimit: MiB, stderrLimit: MiB }, 'runtime-version');
      report.runtime[`${tool}Version`] = observed.stdout.split(/\r?\n/, 1)[0];
      assert.ok(report.runtime[`${tool}Version`].includes('9.0.2-full_build-www.gyan.dev'));
    }
    for (const spec of FIXTURES) {
      expired(); if (monitoringFailure) throw monitoringFailure;
      report.resourcesLatest = await resources();
      const output = path.join(fixtureRoot, `${spec.id}-${spec.width}x${spec.height}-${spec.fps}fps.${spec.container}`);
      outputs.add(output);
      const entry = { ...spec, output, status: 'planned', proposedQualificationRequest: { range: spec.range, resolution: spec.resolution,
        audioPolicy: 'precision-flac', aacBitrateKbps: null, target: 'matroska' }, qualificationGranted: false };
      report.cases.push(entry); await save();
      try {
        const remaining = LIMITS.forecastBytes - report.resourcesLatest.owned.bytes - LIMITS.reportBytes;
        const byteLimit = Math.min(LIMITS.maximumFileBytes, remaining); assert.ok(byteLimit > MiB, 'No sensible fixture reserve remains');
        entry.generationByteLimit = byteLimit; entry.status = 'generating';
        await run(runtime.ffmpeg, generationArgs(spec, output, byteLimit), { timeoutMs: LIMITS.generationMs }, 'generation');
        const generated = await hashOwned(output);
        entry.status = 'inspecting'; await save();
        const probe = await inspectMetadata(output, { ffprobe: runtime.ffprobe, signal: controller.signal, run });
        entry.probe = probe; entry.properties = assessMetadata(spec, probe);
        const decoded = await run(runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov',
          '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=key_frame,pts,duration,pict_type:frame_tags=:frame_side_data=',
          '-of', 'compact=p=1:nk=0:escape=c', '-i', output], { stdoutLimit: 8 * MiB }, 'source-video-timing');
        assert.equal(decoded.stderr.trim(), '', 'Decoded fixture video reported errors');
        entry.videoTiming = assessVideoFrames(spec, probe, decoded.stdout);
        entry.file = await hashOwned(output); assert.deepEqual(entry.file, generated, 'Generated source changed during its probe/timing observations');
        entry.sourceProbeFingerprint = fingerprintEncodeSource(probe);
        entry.status = 'generated-and-inspected'; entry.finishedAt = new Date().toISOString();
        report.resourcesLatest = await resources(); await save();
      } catch (error) { entry.status = 'failed-retained'; entry.failure = failure(error); throw error; }
    }
    report.runtime.verifiedAfter = (await verifyCandidateRuntime({ root: ROOT })).verified;
    assert.deepEqual(report.runtime.verifiedAfter, report.runtime.verifiedBefore); expired();
    report.resourcesAfter = await resources(); expired(); report.status = 'generated-and-inspected-owned-fixtures';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = failure(monitoringFailure || error);
  } finally {
    clearInterval(monitor); if (monitorTask) await monitorTask;
    if (monitoringFailure || controller.signal.aborted || Date.now() - started >= LIMITS.totalMs) {
      report.status = 'failed-retained'; report.failure ||= failure(monitoringFailure || Object.assign(new Error('Fixture preparation cancelled or exceeded its total budget'), { code: 'FIXTURE_CANCELLED_OR_DEADLINE' }));
    }
    clearTimeout(totalTimer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    report.finishedAt = new Date().toISOString(); report.elapsedMs = Date.now() - started; report.liveChildren = children.size;
    report.allTrackedChildrenClosed = tracked.every(item => item.closed);
    try { report.finalOwned = await ownedBytes(); } catch (error) { report.finalAccountingFailure = failure(error); }
    try { await releaseLease(); } catch (error) { report.status = 'failed-retained'; report.failure ||= failure(error); }
    try { await save(); } catch (error) { report.status = 'failed-retained'; report.reportWriteFailure = failure(error); }
    if (reportHandle) await reportHandle.close();
  }
  return { id, status: report.status, report: reportFile, fixtureRoot, cases: report.cases.map(item => ({ id: item.id, status: item.status })),
    leaseReleased: report.leaseReleased, failure: report.failure, reportWriteFailure: report.reportWriteFailure };
}

if (require.main === module) {
  main().then(result => { process.stdout.write(JSON.stringify(result) + '\n'); if (result.status !== 'generated-and-inspected-owned-fixtures') process.exitCode = 1; })
    .catch(error => { process.stderr.write(JSON.stringify(failure(error)) + '\n'); process.exitCode = 1; });
}

module.exports = { main, FIXTURES, generationArgs, assessMetadata };
