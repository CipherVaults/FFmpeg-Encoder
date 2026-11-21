'use strict';
// Root-only owned media prospectus. Importing is inert. No defaults, hardware
// encoder, personal media or application qualification is touched by generation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { verifyRegularWindowsRuntime } = require('../src/regular-windows-runtime.cjs');
const { normalizeProbe, parseProbeJson } = require('../src/inspection.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 15 * 60000, childMs: 6 * 60000, forecastBytes: 6 * GiB,
  maxChildren: 6, maxStarts: 0, minimumDFreeBytes: 25 * GiB, marginBytes: 512 * MiB, reportBytes: 32 * MiB });
const FIXTURES = Object.freeze([
  Object.freeze({ id: 'LONG_MP4', name: 'long-1080p30-aac.mp4', seconds: 1200, target: 'mp4', audio: true, maxBytes: 256 * MiB }),
  Object.freeze({ id: 'LONG_MKV', name: 'long-1080p30-video.mkv', seconds: 1200, target: 'matroska', audio: false, maxBytes: 256 * MiB }),
  Object.freeze({ id: 'LARGE_MP4', name: 'large-1080p30-aac.mp4', seconds: 180, target: 'mp4', audio: true, minBytes: 600 * MiB, maxBytes: 800 * MiB }),
]);
// Separate manifest: existing pinned Q2i fixtures and reports stay unchanged.
// Root explicitly generates a fresh TS manifest and fills the smoke pins.
const TS_FIXTURES = Object.freeze([
  { id: 'TS_AV', name: 'ts-av.ts', seconds: 8, target: 'mpegts', audio: true, maxBytes: 16 * MiB },
  { id: 'TS_VIDEO', name: 'ts-video.ts', seconds: 8, target: 'mpegts', audio: false, maxBytes: 16 * MiB },
  { id: 'TS_OFFSET', name: 'ts-offset.ts', seconds: 8, target: 'mpegts', audio: true, offset: 4, maxBytes: 16 * MiB },
  { id: 'TS_LONG', name: 'ts-long.ts', seconds: 1200, target: 'mpegts', audio: true, maxBytes: 256 * MiB },
  { id: 'TS_TWO_AUDIO', name: 'ts-two-audio.ts', seconds: 8, target: 'mpegts', audio: true, twoAudio: true, maxBytes: 16 * MiB },
  { id: 'TS_CUT', name: 'ts-cut-mid-gop.ts', seconds: 8, target: 'mpegts', audio: true, cut: true, maxBytes: 16 * MiB },
].map(Object.freeze));
const TS_LIMITS = Object.freeze({ ...LIMITS, totalMs: 20 * 60000, maxChildren: 11 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])]));
const same = (a, b) => a.dev !== 0n && a.ino !== 0n && JSON.stringify(stamp(a)) === JSON.stringify(stamp(b));
const ordinary = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n;
const fault = error => ({ code: String(error.code || 'ERROR').slice(0, 128), message: String(error.message || error).slice(0, 2000) });
function requireSpace(d, f, limits, remaining = limits.forecastBytes) {
  for (const s of [d, f]) assert.ok(typeof s.bavail === 'bigint' && s.bavail >= 0n && typeof s.bsize === 'bigint' && s.bsize > 0n, 'Exact volume free space required.');
  assert.ok(d.bavail * d.bsize >= BigInt(limits.minimumDFreeBytes), 'D: 25GiB free-space floor.');
  assert.ok(f.bavail * f.bsize >= BigInt(remaining + limits.marginBytes), 'The owned fixture volume needs the forecast plus margin.');
}
function generationArgs(spec, output) {
  assert.ok(FIXTURES.includes(spec) || TS_FIXTURES.includes(spec) && !spec.cut, 'Only a frozen fixture specification may generate.');
  assert.ok(path.isAbsolute(output) && path.basename(output) === spec.name, 'Exact owned fixture output required.');
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-n', '-f', 'lavfi', '-i',
    `color=c=0x406080:size=1920x1080:rate=30:duration=${spec.seconds}`];
  if (spec.audio) args.push('-f', 'lavfi', '-i', `aevalsrc=0.18*sin(2*PI*(440*t+0.5*t*t))|0.18*sin(2*PI*(659*t+0.7*t*t)):s=48000:c=stereo:d=${spec.seconds}`);
  args.push('-map', '0:v:0'); if (spec.audio) args.push('-map', '1:a:0');
  if (spec.twoAudio) args.push('-map', '1:a:0');
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset:v', 'ultrafast', '-threads:v', '2', '-profile:v', 'high', '-pix_fmt:v', '+yuv420p',
    '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=2:8x8dct=1:cabac=1:open-gop=0' + (spec.minBytes ? ':nal-hrd=cbr:filler=1' : ''),
    '-color_range:v', 'tv', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-colorspace:v', 'bt709');
  if (spec.minBytes) args.push('-b:v', '30M', '-minrate:v', '30M', '-maxrate:v', '30M', '-bufsize:v', '60M');
  else args.push('-crf:v', '23');
  if (spec.audio) args.push('-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ar:a', '48000', '-channel_layout:a', 'stereo');
  else args.push('-an', '-metadata:s:v:0', 'vendor_id=FFMP');
  if (spec.target === 'mp4') args.push('-video_track_timescale', '30000', '-movflags', '+faststart');
  if (spec.offset) args.push('-output_ts_offset', String(spec.offset));
  args.push('-t', String(spec.seconds), '-fs', String(spec.maxBytes), '-f', spec.target, output); return Object.freeze(args);
}
function assessFixture(raw, spec, bytes) {
  if (TS_FIXTURES.includes(spec)) {
    const p = normalizeProbe(raw);
    assert.equal(p.format.format_name, 'mpegts'); assert.equal(p.programs.length, 1); assert.equal(p.stream_groups.length, 0);
    assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes < spec.maxBytes);
    assert.equal(p.streams.length, spec.twoAudio ? 3 : spec.audio ? 2 : 1);
    if (!spec.cut) {
      const reasons = require('../src/remux-transport.cjs').transportSourceReasons(p, 'mp4');
      assert.deepEqual(reasons.map(r => r.code), spec.twoAudio ? ['REMUX_TS_AUDIO_COUNT'] : []);
      assert.ok(Number(p.format.duration) >= spec.seconds && Number(p.format.duration) <= spec.seconds + 0.2);
      if (spec.offset) assert.ok(Number(p.format.start_time) >= spec.offset);
    }
    return { scope: 'generated-source-metadata-only', seconds: spec.seconds, bytes, completeDecodeProven: false,
      expectedRefusal: spec.cut ? 'REMUX_TS_HEAD_NOT_KEYFRAME' : spec.twoAudio ? 'REMUX_TS_AUDIO_COUNT' : null };
  }
  assert.ok(FIXTURES.includes(spec)); const p = normalizeProbe(raw), video = p.streams.filter(s => s.codec_type === 'video');
  assert.ok(Number.isSafeInteger(bytes) && bytes >= (spec.minBytes || 1) && bytes < spec.maxBytes, 'Fixture byte envelope, including >=600MiB, is required.');
  assert.equal(p.streams.length, spec.audio ? 2 : 1); assert.equal(video.length, 1);
  const v = video[0]; assert.equal(v.codec_name, 'h264'); assert.equal(v.width, 1920); assert.equal(v.height, 1080);
  assert.equal(v.pix_fmt, 'yuv420p'); assert.equal(v.field_order, 'progressive'); assert.equal(v.sample_aspect_ratio, '1:1');
  for (const key of ['color_space', 'color_transfer', 'color_primaries']) assert.equal(v[key], 'bt709'); assert.equal(v.color_range, 'tv');
  assert.equal(v.avg_frame_rate, '30/1'); assert.equal(v.r_frame_rate, '30/1');
  assert.ok(Number(p.format.duration) >= spec.seconds && Number(p.format.duration) <= spec.seconds + 0.1, 'Complete untruncated generated duration required.');
  if (spec.audio) {
    const a = p.streams.find(s => s.codec_type === 'audio'); assert.equal(a.codec_name, 'aac'); assert.equal(a.profile, 'LC');
    assert.equal(a.sample_fmt, 'fltp'); assert.equal(a.sample_rate, '48000'); assert.equal(a.channels, 2); assert.equal(a.channel_layout, 'stereo');
  }
  assert.equal(p.chapters.length, 0); assert.equal(p.programs.length, 0); assert.equal(p.stream_groups.length, 0);
  return { scope: 'generated-source-metadata-only', seconds: spec.seconds, bytes, completeDecodeProven: false };
}
// Shared root harness utilities use bounded fixed buffers and stable held/name
// checks. The CLI supplies no dependency objects, paths, argv or executable.
async function hashFile(file, { io = fs, signal } = {}) {
  const before = await io.lstat(file, { bigint: true }); assert.ok(ordinary(before));
  assert.ok(before.size > 0n && before.size <= BigInt(Number.MAX_SAFE_INTEGER));
  const handle = await io.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })));
    while (offset < Number(before.size)) {
      assert.ok(!signal?.aborted, 'Hash cancelled.'); const r = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      assert.ok(r.bytesRead > 0); hash.update(buffer.subarray(0, r.bytesRead)); offset += r.bytesRead;
    }
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await io.lstat(file, { bigint: true })));
    return { bytes: offset, sha256: hash.digest('hex'), identity: stamp(before) };
  } finally { await handle.close(); }
}
async function readBoundedFile(file, maximum, { io = fs, signal } = {}) {
  assert.ok(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 32 * MiB);
  const before = await io.lstat(file, { bigint: true }); assert.ok(ordinary(before) && before.size > 0n && before.size <= BigInt(maximum), 'Bounded ordinary file required.');
  const handle = await io.open(file, 'r'), buffer = Buffer.alloc(Number(before.size)); let offset = 0;
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })));
    while (offset < buffer.length) { assert.ok(!signal?.aborted); const r = await handle.read(buffer, offset, buffer.length - offset, offset); assert.ok(r.bytesRead > 0); offset += r.bytesRead; }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, offset); assert.equal(extra.bytesRead, 0, 'File grew during bounded reading.');
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await io.lstat(file, { bigint: true })), 'Bounded file changed.'); return buffer;
  } finally { await handle.close(); }
}
async function copyPinnedFile(source, target, expected, { io = fs, signal } = {}) {
  const before = await io.lstat(source, { bigint: true }); assert.ok(ordinary(before) && String(before.size) === String(expected.bytes));
  const input = await io.open(source, 'r'); let output;
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let offset = 0;
  try {
    assert.ok(same(before, await input.stat({ bigint: true }))); output = await io.open(target, 'wx+');
    const created = await output.stat({ bigint: true }); assert.ok(ordinary(created));
    while (offset < expected.bytes) {
      assert.ok(!signal?.aborted); const r = await input.read(buffer, 0, Math.min(buffer.length, expected.bytes - offset), offset); assert.ok(r.bytesRead > 0);
      hash.update(buffer.subarray(0, r.bytesRead)); let written = 0;
      while (written < r.bytesRead) { assert.ok(!signal?.aborted); const w = await output.write(buffer, written, r.bytesRead - written, offset + written); assert.ok(w.bytesWritten > 0); written += w.bytesWritten; }
      offset += r.bytesRead;
    }
    assert.equal(hash.digest('hex'), expected.sha256); assert.ok(same(before, await input.stat({ bigint: true })) && same(before, await io.lstat(source, { bigint: true })));
    await output.sync(); const after = await output.stat({ bigint: true });
    assert.ok(ordinary(after) && after.dev === created.dev && after.ino === created.ino && after.size === before.size && same(after, await io.lstat(target, { bigint: true })));
    const copied = await hashFile(target, { io, signal }); assert.equal(copied.sha256, expected.sha256); return copied;
  } finally { await input.close(); await output?.close(); }
}
const MAX_OWNED_SCAN_ATTEMPTS = 3;
async function ownedBytes(directory, io = fs) {
  const directories = new Map();
  const sameObject = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
  const safeObject = s => assert.ok(!s.isSymbolicLink() && (s.isFile() || s.isDirectory())
    && typeof s.dev === 'bigint' && s.dev !== 0n && typeof s.ino === 'bigint' && s.ino !== 0n
    && typeof s.birthtimeNs === 'bigint', 'Owned growth refuses links/special files or unknown identity.');
  const names = value => {
    assert.ok(Array.isArray(value) && value.length <= 8192 && new Set(value).size === value.length, 'Owned growth structural ceiling.');
    for (const name of value) assert.ok(typeof name === 'string' && name && !['.', '..'].includes(name) && !/[\\/]/.test(name));
    return [...value].sort();
  };
  for (let attempt = 1; attempt <= MAX_OWNED_SCAN_ATTEMPTS; attempt++) {
    let total = 0n, entries = 0, changed = false;
    async function stat(file, listed) {
      try { const value = await io.lstat(file, { bigint: true }); safeObject(value); return value; }
      catch (error) {
        // Only a name actually enumerated in this pass may disappear normally.
        // A missing root, permission failure or unsafe object is never retried.
        if (listed && error.code === 'ENOENT') { changed = true; return null; }
        throw error;
      }
    }
    async function listing(file, listed, before) {
      try { return names(await io.readdir(file)); }
      catch (error) {
        if (listed && error.code === 'ENOENT') {
          const current = await stat(file, true);
          if (!current) return null;
          assert.ok(current.isDirectory() && sameObject(before, current), 'Owned growth directory changed identity.');
        }
        throw error;
      }
    }
    async function visit(file, depth, listed = false) {
      assert.ok(depth <= 16 && ++entries <= 8192, 'Owned growth structural ceiling.');
      const before = await stat(file, listed); if (!before) return;
      if (before.isFile()) {
        const after = await stat(file, listed); if (!after) return;
        assert.ok(after.isFile() && sameObject(before, after), 'Owned growth file changed identity: ' + path.relative(directory, file));
        assert.ok(typeof before.size === 'bigint' && before.size >= 0n && typeof after.size === 'bigint' && after.size >= before.size, 'Owned growth file shrank or has unknown size.');
        total += after.size; assert.ok(total <= BigInt(Number.MAX_SAFE_INTEGER), 'Owned growth byte total exceeds exact representation.');
        return;
      }
      const prior = directories.get(file);
      assert.ok(!prior || sameObject(prior, before), 'Owned growth directory changed identity.'); directories.set(file, before);
      const first = await listing(file, listed, before); if (!first) return;
      // Finish inspecting this pass after churn. An unsafe later entry must not
      // be hidden by an earlier vanished stage or a restart of the whole walk.
      for (const name of first) await visit(path.join(file, name), depth + 1, true);
      const last = await listing(file, listed, before); if (!last) return;
      const after = await stat(file, listed); if (!after) return;
      assert.ok(after.isDirectory() && sameObject(before, after), 'Owned growth directory changed identity.');
      assert.ok(typeof before.mtimeNs === 'bigint' && typeof after.mtimeNs === 'bigint', 'Owned growth directory time is unknown.');
      if (before.mtimeNs !== after.mtimeNs || JSON.stringify(first) !== JSON.stringify(last)) changed = true;
    }
    await visit(directory, 0);
    if (!changed) return Number(total);
  }
  throw Object.assign(new Error('Owned growth namespace did not stabilize within three complete scans.'),
    { code: 'REMUX_OWNED_SCAN_UNSTABLE', attempts: MAX_OWNED_SCAN_ATTEMPTS });
}
async function moduleSeals(io, regularProof = false) {
  const entries = await io.readdir(path.join(ROOT, 'src'), { withFileTypes: true });
  assert.ok(entries.length <= 128 && entries.every(e => e.isFile() && !e.isSymbolicLink() && e.name.endsWith('.cjs')));
  const names = ['main.js', 'preload.js', 'scripts/v07-remux-long-fixtures.cjs', 'scripts/v07-remux-long-smoke.cjs',
    'scripts/v07-remux-mov-vfr-smoke.cjs', 'scripts/v07-mov-vfr-fixtures.cjs', 'scripts/v07-remux-mkv-mp4-smoke.cjs', ...entries.map(e => 'src/' + e.name)];
  if (regularProof) names.push('resources/regular-windows-engine-manifest.json');
  if (regularProof === 'mp3') names.push('scripts/v07-regular-mp3-proof.cjs', 'scripts/q2j-mp3-laboratory.cjs',
    'scripts/fixtures/q2j-layer3.cjs', 'linux-blue/qualification-tests/q2j-mp3-witness.cjs');
  else if (regularProof === 'mp3-service') names.push('scripts/v07-regular-mp3-service.cjs', 'scripts/fixtures/q2j-layer3.cjs');
  else if (regularProof === 'resize') names.push('scripts/v07-regular-resize-proof.cjs', 'scripts/v07-sdr-flac-range-calibration.cjs');
  else if (regularProof === 'precision-aac') names.push('scripts/v07-regular-precision-aac-proof.cjs',
    'scripts/v07-encode-operation-smoke.cjs', 'linux-blue/qualification-tests/q2f-precision-aac-clock.cjs');
  else if (regularProof === 'mkv-audio') names.push('scripts/v07-regular-mkv-audio-proof.cjs');
  else if (regularProof === 'multi-audio') names.push('scripts/v07-regular-multi-audio-proof.cjs', 'linux-blue/qualification-tests/q2l-multiaudio-copy.cjs');
  else if (regularProof === 'ancillary') names.push('scripts/v07-regular-ancillary-proof.cjs');
  else if (regularProof) names.push('scripts/v07-regular-ts-proof.cjs');
  names.sort();
  return Promise.all(names.map(async file => { const target = path.join(ROOT, file), stat = await io.lstat(target); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * MiB);
    return { file, sha256: sha(await readBoundedFile(target, 2 * MiB, { io })) }; }));
}
function createOwnedSession({ kind, limits, dependencies = {}, regularProof = false }) {
  const { fs: io = fs, runTool: execute = runTool,
    verifyCandidateRuntime: verify = regularProof ? verifyRegularWindowsRuntime : verifyCandidateRuntime,
    assertOrdinaryPath: checkPath = assertOrdinaryPath, randomUUID: uuid = randomUUID, platform = process.platform } = dependencies;
  assert.ok(['fixtures', 'smoke'].includes(kind));
  const id = uuid();
  const ownedRoot = regularProof ? path.join(ROOT, 'artifacts/v0.7') : OWNED;
  const campaign = regularProof === 'ancillary' ? 'q2m-regular-ancillary'
    : regularProof === 'multi-audio' ? 'q2l-regular-multi-audio'
    : regularProof === 'precision-aac' ? 'q2f-regular-precision-aac'
    : regularProof === 'mkv-audio' ? 'q2k-regular-audio'
    : regularProof === 'resize' ? 'q2n-regular-resize' : regularProof === 'mp3-service' ? 'q2j-regular-mp3-service'
    : regularProof === 'mp3' ? 'q2j-regular-mp3' : regularProof ? 'q2j-regular' : 'q2i';
  const directory = path.join(ROOT, 'artifacts/v0.7', campaign, kind, id);
  const owned = regularProof ? path.join(directory, 'owned') : path.join(OWNED, kind === 'fixtures' ? 'fixtures' : 'outputs', 'remux-long-' + id);
  const controller = new AbortController(), children = new Set(), report = { schema: 1, id, kind, status: 'running', directory, owned,
    startedAt: new Date().toISOString(), limits, cases: [], invocations: [], peakRssBytes: process.memoryUsage().rss, rssSamples: 1,
    maxConcurrentChildren: 0, pipeBytes: { stdout: 0, stderr: 0 }, childrenClosed: 0, acceptedStarts: 0,
    limitations: ['Root-only owned synthetic proof; not native UI, clean-machine, owner or release acceptance.',
      'No process census is run here; root budgets fresh pre/post censuses separately.', 'Main RSS is sampled; child RSS is not measured.',
      'Polling observes growth, not an atomic hard filesystem quota. No failed media/evidence is deleted.'] };
  let runtime, lease, leaseStamp, reportHandle, reportStamp, timer, monitor, monitorTask = Promise.resolve(), checking = false, opened = false;
  let inFlight = 0, admitted = 0, saveTail = Promise.resolve();
  const directories = [];
  const bindDirectory = async file => { await checkPath(file, 'directory'); const stat = await io.lstat(file, { bigint: true });
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev !== 0n && stat.ino !== 0n); directories.push({ file, stat }); };
  const guardDirectories = async () => { for (const held of directories) { await checkPath(held.file, 'directory'); const current = await io.lstat(held.file, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === held.stat.dev && current.ino === held.stat.ino && current.birthtimeNs === held.stat.birthtimeNs, 'Owned directory changed.'); } }; 
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock'), started = Date.now();
  // Use positioned writes for every update while retaining the exclusive handle.
  const persist = () => {
    const work = saveTail.then(async () => {
    if (!reportHandle) return; const data = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(data.length <= limits.reportBytes);
    const named = await io.lstat(path.join(directory, 'report.json'), { bigint: true }), held = await reportHandle.stat({ bigint: true });
    assert.ok(ordinary(named) && same(named, held) && held.dev === reportStamp.dev && held.ino === reportStamp.ino);
    await reportHandle.truncate(0); let offset = 0;
    while (offset < data.length) { const w = await reportHandle.write(data, offset, data.length - offset, offset); assert.ok(w.bytesWritten > 0); offset += w.bytesWritten; }
    await reportHandle.sync();
    });
    saveTail = work.catch(() => {}); return work;
  };
  async function persistInvocation(entry, phase) {
    // Durable prospective admission/closure without rewriting every earlier
    // case for each child. Full report snapshots still seal every case/close.
    const file = path.join(directory, 'invocation-' + entry.ordinal + '-' + phase + '.json'); let handle, primary;
    try {
      await guardDirectories(); const data = Buffer.from(JSON.stringify(entry)); assert.ok(data.length <= limits.reportBytes);
      handle = await io.open(file, 'wx+'); const created = await handle.stat({ bigint: true });
      assert.ok(ordinary(created) && created.size === 0n, 'Ordinary exclusive invocation receipt required.');
      await handle.writeFile(data); await handle.sync(); const after = await handle.stat({ bigint: true }), named = await io.lstat(file, { bigint: true });
      assert.ok(ordinary(after) && same(after, named) && after.size === BigInt(data.length)
        && after.dev === created.dev && after.ino === created.ino && after.birthtimeNs === created.birthtimeNs, 'Invocation receipt changed.');
    } catch (cause) { primary = cause; }
    finally { try { await handle?.close(); } catch (error) { primary ||= error; } }
    if (primary) {
      report.invocationPersistenceFailure = fault(primary); controller.abort();
      throw Object.assign(Error('The durable invocation receipt could not be sealed.'), { code: 'REMUX_PROOF_INVOCATION_RECEIPT', cause: primary });
    }
  }
  const observe = async () => {
    await guardDirectories();
    // Namespace churn must never suppress the independent free-space floor or
    // conservative remaining-growth reserve while awaiting a stable sample.
    const beforeD = await io.statfs(ROOT, { bigint: true }), beforeF = await io.statfs(ownedRoot, { bigint: true });
    requireSpace(beforeD, beforeF, limits, Math.max(0, limits.forecastBytes - (report.ownedBytes || 0)));
    const bytes = await ownedBytes(owned, io); assert.ok(bytes <= limits.forecastBytes, 'Actual owned growth exceeded the prospective forecast.'); report.ownedBytes = bytes;
    const d = await io.statfs(ROOT, { bigint: true }), f = await io.statfs(ownedRoot, { bigint: true }); requireSpace(d, f, limits, Math.max(0, limits.forecastBytes - bytes));
    report.freeBytes = { D: String(d.bavail * d.bsize), [regularProof ? 'ownedVolume' : 'F']: String(f.bavail * f.bsize) };
  };
  return { id, directory, owned, report, io, controller, children, get runtime() { return runtime; }, save: persist,
    async assertHealthy() {
      const requireSafe = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'REMUX_PROOF_UNSAFE_CONTINUATION' }); };
      requireSafe(opened && lease && !controller.signal.aborted && !report.monitorFailure && !report.deadlineExceeded,
        'The owned session is no longer live and healthy.');
      requireSafe(children.size === 0 && inFlight === 0, 'A previous case still owns a live child or invocation.');
      await guardDirectories();
      const named = await io.lstat(leasePath, { bigint: true }), held = await lease.stat({ bigint: true });
      requireSafe(ordinary(named) && same(named, held) && named.dev === leaseStamp.dev && named.ino === leaseStamp.ino
        && named.birthtimeNs === leaseStamp.birthtimeNs && named.nlink === 1n && named.size > 0n && named.size <= 4096n,
      'The held media lease changed or is unsafe.');
      const bytes = Buffer.alloc(Number(named.size)); let at = 0;
      while (at < bytes.length) { const read = await lease.read(bytes, at, bytes.length - at, at);
        requireSafe(read.bytesRead > 0, 'The held media lease was truncated.'); at += read.bytesRead; }
      requireSafe(JSON.parse(bytes.toString('utf8')).token === id && same(named, await lease.stat({ bigint: true }))
        && same(named, await io.lstat(leasePath, { bigint: true })), 'The media lease token or identity changed.');
      await observe(); await persist(); return { leaseIntact: true, liveChildren: 0 };
    },
    async open() {
      assert.equal(platform, 'win32'); await checkPath(ownedRoot, 'directory');
      requireSpace(await io.statfs(ROOT, { bigint: true }), await io.statfs(ownedRoot, { bigint: true }), limits);
      await io.mkdir(path.dirname(directory), { recursive: true }); await io.mkdir(directory);
      await io.mkdir(path.dirname(owned), { recursive: true }); await checkPath(path.dirname(owned), 'directory'); await io.mkdir(owned);
      await bindDirectory(ownedRoot); await bindDirectory(path.dirname(owned)); await bindDirectory(owned);
      if (!regularProof) await bindDirectory(directory);
      reportHandle = await io.open(path.join(directory, 'report.json'), 'wx+'); reportStamp = await reportHandle.stat({ bigint: true }); assert.ok(ordinary(reportStamp));
      lease = await io.open(leasePath, 'wx+'); leaseStamp = await lease.stat({ bigint: true }); assert.ok(ordinary(leaseStamp));
      await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: regularProof === 'ancillary' ? 'Windows Q2m owned ancillary proof'
        : regularProof === 'multi-audio' ? 'Windows Q2l owned MP4 multi-audio proof'
        : regularProof === 'precision-aac' ? 'Windows Q2f owned precision AAC proof'
        : regularProof === 'mkv-audio' ? 'Windows Q2k owned MKV audio measurement'
        : regularProof === 'resize' ? 'Windows Q2n owned CPU resize proof' : regularProof === 'mp3-service' ? 'Windows Q2j MP3 service proof'
        : regularProof === 'mp3' ? 'Windows Q2j MP3 laboratory'
        : regularProof ? 'Windows Q2j regular TS proof' : 'Q2i bounded owned long-remux ' + kind })); await lease.sync();
      runtime = await verify({ root: ROOT }); report.runtime = runtime.verified; report.modulesBefore = await moduleSeals(io, regularProof); opened = true;
      timer = setTimeout(() => { report.deadlineExceeded = true; controller.abort(); }, limits.totalMs); timer.unref();
      monitor = setInterval(() => {
        report.peakRssBytes = Math.max(report.peakRssBytes, process.memoryUsage().rss); report.rssSamples++;
        if (checking || report.rssSamples % 4 !== 0) return; checking = true;
        monitorTask = observe().then(() => { report.consecutiveUnstableScans = 0; }).catch(error => {
          if (error.code === 'REMUX_OWNED_SCAN_UNSTABLE') {
            report.unstableScanObservations = (report.unstableScanObservations || 0) + 1;
            report.consecutiveUnstableScans = (report.consecutiveUnstableScans || 0) + 1;
            // A source-based distinction: telemetry/evidence files are created
            // normally while a case runs. Defer a noisy sample, not unsafe I/O
            // or an identity change. Admission/closure scans remain strict.
            if (report.consecutiveUnstableScans <= 4) return;
          }
          report.monitorFailure = fault(error); controller.abort();
        }).finally(() => { checking = false; });
      }, 250); monitor.unref(); await persist();
    },
    async run(file, argv, options = {}, executor = execute) {
      assert.ok(opened && !controller.signal.aborted);
      assert.ok(inFlight < (kind === 'smoke' ? 2 : 1), 'Only a remux smoke session permits two owned invocations.');
      assert.ok(admitted < limits.maxChildren, 'Prospective child ceiling.');
      inFlight++; admitted++; report.activeInvocations = inFlight; report.invocationAttempts = admitted;
      const admissionOrdinal = admitted, admissionStartedAt = Date.now();
      let reachedLedger = false;
      try {
      const helper = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      if (file.toLowerCase() === helper.toLowerCase() && kind === 'smoke') { assert.deepEqual(argv.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
        assert.equal(argv.length, 5); assert.ok(argv[4].includes('[System.IO.DriveInfo]::new')); assert.deepEqual(JSON.parse(options.input), { root: path.parse(owned).root });
      } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(file), 'Only the verified paired media runtime.');
      assert.ok(!argv.includes('-y'));
      if (file === runtime.ffmpeg && argv.at(-1) === 'pipe:3') {
        const frames = argv.flatMap((value, index) => value === '-frames:v' ? [argv[index + 1]] : []);
        assert.ok(kind === 'smoke' && argv.includes('pipe:1') && frames.length === 2 && frames.every(value => value === '1')
          && argv.includes('rawvideo') && argv.includes('framehash') && argv.includes('sha256'), 'Only two bounded decoded hash pipes.');
      } else if (file === runtime.ffmpeg && !['pipe:1', '-'].includes(argv.at(-1))) {
        const versionOnly = regularProof === 'resize' && argv.length === 1 && argv[0] === '-version';
        assert.ok(versionOnly || path.resolve(argv.at(-1)).startsWith(owned + path.sep), 'Owned output only.');
      }
      for (let i = 0; i < argv.length; i++) if (argv[i] === '-i') {
        const lavfi = (kind === 'fixtures' || regularProof === true || regularProof === 'resize' || regularProof === 'mkv-audio' || regularProof === 'multi-audio' || regularProof === 'ancillary' || regularProof === 'precision-aac') && argv[i - 2] === '-f' && argv[i - 1] === 'lavfi';
        assert.ok(lavfi || path.resolve(argv[i + 1]).startsWith(owned + path.sep), 'Only owned or explicit synthetic inputs.');
      }
      assert.deepEqual(await moduleSeals(io, regularProof), report.modulesBefore, 'Producer modules changed before admission.'); await observe();
      const entry = { ordinal: report.invocations.length + 1, file, argv, admissionStartedAt, startedAt: new Date().toISOString(), status: 'running', stdoutBytes: 0, stderrBytes: 0 };
      report.invocations.push(entry); reachedLedger = true; if (kind === 'smoke') await persistInvocation(entry, 'admission'); else await persist();
      let child;
      try {
        entry.executorStartedAt = Date.now();
        const result = await executor(file, argv, { ...options, signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
          timeoutMs: Math.min(options.timeoutMs || limits.childMs, limits.childMs, Math.max(1, limits.totalMs - (Date.now() - started))),
          onChild(value) { child = value; entry.childStartedAt = Date.now(); children.add(value); report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
            value.once('close', (code, signal) => { entry.childClosedAt = Date.now(); entry.closed = { code, signal }; children.delete(value); report.childrenClosed++; }); options.onChild?.(value); },
          onOutputBytes(value) { assert.ok(['stdout', 'stderr'].includes(value.stream) && Number.isSafeInteger(value.bytes) && value.bytes >= 0);
            report.pipeBytes[value.stream] += value.bytes; entry[value.stream + 'Bytes'] += value.bytes; options.onOutputBytes?.(value); } });
        assert.ok(child && entry.closed, 'Observed child close is required.'); entry.exitCode = result.exitCode; entry.status = 'completed';
        entry.stderr = result.stderr?.slice(-8192); entry.stderrCapture = result.stderrCapture;
        if (argv.includes('-show_format')) { assert.ok(Buffer.byteLength(result.stdout) <= 2 * MiB); entry.metadataProbe = parseProbeJson(result.stdout, 'Long fixture metadata'); }
        return result;
      } catch (error) { entry.status = 'failed'; entry.failure = fault(error); throw error; }
      finally { entry.executorSettledAt = Date.now(); assert.ok(!child || entry.closed, 'Never release an unclosed child.'); entry.wallMs = Date.now() - Date.parse(entry.startedAt);
        if (kind === 'smoke') await persistInvocation(entry, 'close'); else await persist(); entry.proofDoneAt = Date.now(); }
      } catch (error) {
        if (regularProof && !reachedLedger) {
          (report.preAdmissionRefusals ||= []).push({ admissionOrdinal, file, failure: fault(error) });
        }
        throw error;
      } finally { inFlight--; report.activeInvocations = inFlight; }
    },
    async close() {
      clearTimeout(timer); clearInterval(monitor); await monitorTask;
      report.closureFailures = [];
      const attempt = async (label, fn) => { try { await fn(); } catch (error) { report.closureFailures.push({ label, ...fault(error) }); report.status = 'failed-retained'; } };
      await attempt('children', async () => { assert.equal(children.size, 0); assert.equal(inFlight, 0); });
      if (opened) { await attempt('growth', observe); await attempt('module-freeze', async () => { report.modulesAfter = await moduleSeals(io, regularProof); assert.deepEqual(report.modulesAfter, report.modulesBefore); }); }
      if (lease && children.size === 0 && inFlight === 0) await attempt('lease', async () => {
        const named = await io.lstat(leasePath, { bigint: true }), held = await lease.stat({ bigint: true });
        assert.ok(ordinary(named) && same(named, held) && named.dev === leaseStamp.dev && named.ino === leaseStamp.ino);
        assert.equal(JSON.parse(await io.readFile(leasePath, 'utf8')).token, id); await lease.close(); lease = null; await io.unlink(leasePath); report.leaseReleased = true;
      });
      report.liveChildren = children.size; report.wallMs = Date.now() - started; report.finishedAt = new Date().toISOString();
      if (report.monitorFailure || report.deadlineExceeded) report.status = 'failed-retained';
      try { await persist(); } finally { await reportHandle?.close(); }
    },
  };
}
function createFixtures(dependencies = {}) {
  return async argv => {
    const transport = argv.length === 1 && argv[0] === '--run-owned-ts-fixtures';
    if (!transport) assert.deepEqual(argv, ['--run-owned-fixtures'], 'Explicit root-only fixture flag; no extra arguments.');
    const sessionFactory = dependencies.createOwnedSession || createOwnedSession;
    const session = sessionFactory({ kind: 'fixtures', limits: transport ? TS_LIMITS : LIMITS, dependencies });
    try {
      await session.open();
      for (const spec of transport ? TS_FIXTURES : FIXTURES) {
        const output = path.join(session.owned, spec.name), entry = { id: spec.id, output, seconds: spec.seconds, status: 'generating' };
        session.report.cases.push(entry);
        if (spec.cut) {
          const source = session.report.cases.find(c => c.id === 'TS_AV'); assert.equal(source.status, 'passed-generated-metadata');
          entry.cut = await cutTransportFixture(source.output, output, source.file, { io: session.io, signal: session.controller.signal });
        } else await session.run(session.runtime.ffmpeg, generationArgs(spec, output), { stdoutLimit: MiB, stderrLimit: MiB });
        const result = await session.run(session.runtime.ffprobe, ['-v', 'warning', '-protocol_whitelist', 'file', '-show_format', '-show_streams',
          '-show_chapters', '-show_programs', '-show_stream_groups', '-show_data_hash', 'sha256', '-of', 'json', output], { stdoutLimit: 2 * MiB, stderrLimit: 256 * 1024 });
        if (!spec.cut) assert.equal(result.stderr, '');
        assert.equal(result.stderrCapture?.truncated, false);
        entry.file = await (dependencies.hashFile || hashFile)(output, { io: session.io, signal: session.controller.signal });
        entry.observation = assessFixture(parseProbeJson(result.stdout, 'Long generated fixture'), spec, entry.file.bytes);
        entry.status = 'passed-generated-metadata'; await session.save();
      }
      session.report.status = 'passed-owned-fixtures';
    } catch (error) { session.report.status = 'failed-retained'; session.report.failure = fault(error); }
    finally { await session.close(); }
    return session.report;
  };
}
async function cutTransportFixture(source, output, expected, { io = fs, signal } = {}) {
  // TS_AV is a small generated fixture. Keep its SDT/PAT/PMT prefix, then
  // begin at the second video PES (a non-IDR picture). Never alter the source.
  const pin = await hashFile(source, { io, signal }); assert.equal(pin.sha256, expected.sha256);
  const bytes = await readBoundedFile(source, 16 * MiB, { io, signal }); let first = -1, second = -1;
  for (let at = 0; at + 188 <= bytes.length; at += 188) {
    const b = bytes.subarray(at, at + 188); assert.equal(b[0], 71);
    if (((b[1] & 31) << 8 | b[2]) !== 256 || !(b[1] & 64)) continue;
    if (first < 0) first = at; else { second = at; break; }
  }
  assert.ok(first >= 376 && second > first); const cut = Buffer.concat([bytes.subarray(0, first), bytes.subarray(second)]);
  const handle = await io.open(output, 'wx'); try { await handle.writeFile(cut); await handle.sync(); } finally { await handle.close(); }
  assert.equal((await hashFile(source, { io, signal })).sha256, expected.sha256);
  return { removedTransportBytes: second - first, firstVideoPes: first, resumedVideoPes: second, operation: 'generated-cut-before-second-video-pes' };
}
module.exports = { createFixtures, createOwnedSession, generationArgs, assessFixture, requireSpace, hashFile, readBoundedFile, copyPinnedFile, ownedBytes,
  ROOT, OWNED, FIXTURES, TS_FIXTURES, TS_LIMITS, LIMITS, cutTransportFixture, sha, fault, MAX_OWNED_SCAN_ATTEMPTS };
if (require.main === module) createFixtures()(process.argv.slice(2)).then(report => {
  console.log(JSON.stringify({ id: report.id, status: report.status, report: path.join(report.directory, 'report.json'), failure: report.failure }));
  if (report.status !== 'passed-owned-fixtures') process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
