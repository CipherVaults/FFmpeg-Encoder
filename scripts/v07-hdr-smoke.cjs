'use strict';

// Parent-only native qualification, not a benchmark, production capability
// receipt or HDR-display judgment. Nothing launches when imported or invoked
// without --parent-authorized-native. Existing/personal media are never inputs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { buildMediaEvidence } = require('../src/media-evidence.cjs');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { buildHdrEncoding, buildHdrIdentityPacking, validateHdrEncodingOutput, HELP_BASIS } = require('../src/hdr-encoding.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const REPORT_BASE = path.join(ROOT, 'artifacts/v0.7/hdr-preserve');
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const WIDTH = 320, HEIGHT = 180, FRAMES = 96, FPS = 30, FRAME_BYTES = WIDTH * HEIGHT * 3;
const LIMITS = Object.freeze({ ownedBytes: 256 * 1024 * 1024, marginBytes: 512 * 1024 * 1024,
  encodedBytes: 4 * 1024 * 1024, rawBytes: FRAME_BYTES * (FRAMES + 1), reportBytes: 8 * 1024 * 1024,
  stdoutBytes: 4 * 1024 * 1024, stderrBytes: 256 * 1024, invocations: 64,
  childMs: 180000, totalMs: 20 * 60 * 1000 });
const COLOR_FRAMES = 4;
const COLOR_LIMITS = Object.freeze({ ...LIMITS, ownedBytes: 4 * 1024 * 1024, rawBytes: FRAME_BYTES * COLOR_FRAMES,
  stdoutBytes: 128 * 1024, stderrBytes: 32 * 1024, invocations: 6, childMs: 60000, totalMs: 5 * 60 * 1000 });
const MODULES = ['scripts/v07-hdr-smoke.cjs', 'src/hdr-encoding.cjs', 'src/hdr-contract.cjs', 'src/media.cjs',
  'src/media-evidence.cjs', 'src/process-runner.cjs', 'src/candidate-runtime.cjs', 'resources/candidate-binary-manifest.json'];
const SETTINGS = Object.freeze([{ profileId: 'h265-cpu', preset: 'slow', quality: 25 }, { profileId: 'h265-nvidia', preset: 'p5', quality: 25 }]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, file) => { const relative = path.relative(base, file); return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameStamp = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(field => a[field] === b[field]);
const stamp = value => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(field => [field, String(value[field])]));
const errorData = error => ({ code: error.code || 'HDR_NATIVE_QUALIFICATION_FAILED', message: error.message,
  ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
  ...(error.stderr !== undefined ? { stderr: error.stderr, stderrCapture: error.stderrCapture || null } : {}) });

// Synthetic code values have declared mathematical origins. They are not
// retagged SDR imagery, measured mastering displays, or perceptual references.
function pqSignal(nits) {
  const m1 = 2610 / 16384, m2 = 2523 / 32, c1 = 3424 / 4096, c2 = 2413 / 128, c3 = 2392 / 128;
  const p = (nits / 10000) ** m1;
  return ((c1 + c2 * p) / (1 + c3 * p)) ** m2;
}
function hlgSignal(sceneLinear) {
  const a = 0.17883277, b = 1 - 4 * a, c = 0.5 - a * Math.log(4 * a);
  return sceneLinear <= 1 / 12 ? Math.sqrt(3 * sceneLinear) : a * Math.log(12 * sceneLinear - b) + c;
}
function fixtureSpec(kind) {
  assert.ok(['pq', 'hlg'].includes(kind));
  const levels = kind === 'pq' ? [0, 0.1, 1, 10, 50, 100, 203, 400, 700, 1000] : [0, 0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1];
  return { id: kind, transfer: kind === 'pq' ? 'smpte2084' : 'arib-std-b67', levels,
    levelUnits: kind === 'pq' ? 'absolute-luminance-cd-per-m2' : 'relative-scene-linear-input-to-HLG-OETF',
    codes: levels.map(level => Math.round(64 + 876 * (kind === 'pq' ? pqSignal(level) : hlgSignal(level)))),
    generator: 'numeric-gray-patches-and-binary-presentation-frame-id-v1', width: WIDTH, height: HEIGHT,
    frames: FRAMES, fps: FPS, pixelFormat: 'yuv420p10le', range: 'tv', neutralChroma: 512,
    mastering: { red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
      blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000',
      min_luminance: '1/10000', max_luminance: '1000/1' }, contentLight: { max_content: 1000, max_average: 400 },
    metadataBasis: 'Engineering seed values for exact serialization tests; not a measured source or display.',
    limits: ['Neutral chroma only; no wide-gamut color accuracy claim', 'No ambient or dynamic HDR', 'No HDR display, tone-map, recipe comparison or benchmark acceptance'] };
}
function numericFrame(spec, frameIndex) {
  assert.ok(Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex < FRAMES);
  const bytes = Buffer.alloc(FRAME_BYTES);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const column = Math.floor(x / 32);
    // Bottom seven 32-pixel blocks encode presentation index bits. The two
    // extreme code values survive ordinary lossy compression with wide margins.
    const code = y < 112 ? spec.codes[column] : column < 7 ? ((frameIndex >>> column) & 1 ? 850 : 120)
      : column === 7 ? (frameIndex % 2 ? 120 : 850) : column === 8 ? 64 : 940;
    bytes.writeUInt16LE(code, 2 * (y * WIDTH + x));
  }
  for (let offset = WIDTH * HEIGHT * 2; offset < bytes.length; offset += 2) bytes.writeUInt16LE(512, offset);
  return bytes;
}

function colorPackingSpec() {
  return { generator: 'numeric-planar10-independent-chroma-layout-stress-v1', width: WIDTH, height: HEIGHT,
    frames: COLOR_FRAMES, fps: FPS, pixelFormat: 'yuv420p10le', frameBytes: FRAME_BYTES,
    rawBytes: FRAME_BYTES * COLOR_FRAMES, expectedRawArtifactBytes: FRAME_BYTES * COLOR_FRAMES * 5,
    framesDescription: ['Independent horizontal U and vertical V full-code ramps',
      'Different two-dimensional U/V ramps with moving luma grid',
      'Asymmetric U/V grids with full-range and limited-range boundary values',
      'Distinct isolated impulses in otherwise neutral U/V planes'],
    boundaryCodes: [0, 1, 63, 64, 65, 511, 512, 513, 939, 940, 941, 959, 960, 961, 1022, 1023],
    expectedPacking: 'P010 little endian: each Y value shifted left six bits; then interleaved U,V values each shifted left six bits.',
    signalTrials: ['smpte2084', 'arib-std-b67'],
    limits: ['The same numeric stress bytes are interpreted under two declared transfer functions only to test an identity layout operation.',
      'Includes excursions outside nominal limited range intentionally; no photometric, gamut, HDR metadata, display, codec or perceptual claim.',
      'Raw files have no embedded signaling; declared filter options are recorded, not claimed as independently observed VUI.'] };
}

function colorPackingFrame(frameIndex) {
  assert.ok(Number.isSafeInteger(frameIndex) && frameIndex >= 0 && frameIndex < COLOR_FRAMES);
  const bytes = Buffer.alloc(FRAME_BYTES), boundary = colorPackingSpec().boundaryCodes;
  const planes = [{ name: 'Y', width: WIDTH, height: HEIGHT, offset: 0 },
    { name: 'U', width: WIDTH / 2, height: HEIGHT / 2, offset: WIDTH * HEIGHT * 2 },
    { name: 'V', width: WIDTH / 2, height: HEIGHT / 2, offset: WIDTH * HEIGHT * 5 / 2 }];
  for (const [planeIndex, plane] of planes.entries()) {
    for (let y = 0; y < plane.height; y++) for (let x = 0; x < plane.width; x++) {
      const index = y * plane.width + x;
      let code;
      if (plane.name === 'Y') code = (x * 13 + y * 31 + frameIndex * 97 + (Math.floor(x / 8) % 2 ? 257 : 0)) % 1024;
      else if (frameIndex === 0) code = plane.name === 'U' ? Math.round(x * 1023 / (plane.width - 1)) : Math.round(y * 1023 / (plane.height - 1));
      else if (frameIndex === 1) code = plane.name === 'U' ? (x * 17 + y * 43) % 1024 : (1023 - (x * 37 + y * 11) % 1024);
      else if (frameIndex === 2) code = plane.name === 'U' ? ((Math.floor(x / 5) + Math.floor(y / 7)) % 2 ? 0 : 1023)
        : [64, 960, 1, 1022][(Math.floor(x / 9) + 3 * Math.floor(y / 4)) % 4];
      else code = index === plane.width * 17 + 23 ? (plane.name === 'U' ? 0 : 1023)
        : index === plane.width * 51 + 103 ? (plane.name === 'U' ? 960 : 64)
          : index === plane.width * plane.height - 1 ? (plane.name === 'U' ? 1 : 1022) : 512;
      // Every plane/frame exercises precise endpoints and near-boundary values;
      // the offset rotates them so a plane swap cannot pass these cells either.
      if (index < boundary.length) code = boundary[(index + planeIndex * 5 + frameIndex * 3) % boundary.length];
      bytes.writeUInt16LE(code, plane.offset + index * 2);
    }
  }
  return bytes;
}

function expectedColorPacking(planar) {
  assert.ok(Buffer.isBuffer(planar) && planar.length === FRAME_BYTES * COLOR_FRAMES, 'Exactly four bounded planar10 frames required');
  const packed = Buffer.alloc(planar.length), lumaSamples = WIDTH * HEIGHT, chromaSamples = lumaSamples / 4;
  for (let frame = 0; frame < COLOR_FRAMES; frame++) {
    const base = frame * FRAME_BYTES;
    const sample = offset => { const value = planar.readUInt16LE(base + offset); assert.ok(value <= 1023, 'Source contains more than ten significant bits'); return value; };
    for (let index = 0; index < lumaSamples; index++) packed.writeUInt16LE(sample(index * 2) << 6, base + index * 2);
    for (let index = 0; index < chromaSamples; index++) {
      packed.writeUInt16LE(sample(lumaSamples * 2 + index * 2) << 6, base + lumaSamples * 2 + index * 4);
      packed.writeUInt16LE(sample(lumaSamples * 5 / 2 + index * 2) << 6, base + lumaSamples * 2 + index * 4 + 2);
    }
  }
  return packed;
}

function validateColorPacking(planar, packed, unpacked) {
  const expected = expectedColorPacking(planar);
  assert.ok(Buffer.isBuffer(packed) && packed.length === expected.length, 'Complete packed four-frame byte count required');
  assert.ok(Buffer.isBuffer(unpacked) && unpacked.length === planar.length, 'Complete unpacked four-frame byte count required');
  // Check the packed layout independently, not only a round trip which could
  // hide symmetrical forward/reverse errors. All samples (including low bits)
  // are compared; SHA receipts and per-plane summaries make the proof reusable.
  for (let offset = 0; offset < expected.length; offset += 2) {
    assert.equal(packed.readUInt16LE(offset), expected.readUInt16LE(offset), `Packed word differs at byte ${offset}`);
    assert.equal(unpacked.readUInt16LE(offset), planar.readUInt16LE(offset), `Restored sample differs at byte ${offset}`);
  }
  const frames = [];
  for (let frame = 0; frame < COLOR_FRAMES; frame++) {
    const base = frame * FRAME_BYTES, planes = {};
    for (const [name, start, size] of [['Y', 0, WIDTH * HEIGHT * 2], ['U', WIDTH * HEIGHT * 2, WIDTH * HEIGHT / 2], ['V', WIDTH * HEIGHT * 5 / 2, WIDTH * HEIGHT / 2]]) {
      const bytes = planar.subarray(base + start, base + start + size), values = new Set();
      for (let offset = 0; offset < bytes.length; offset += 2) values.add(bytes.readUInt16LE(offset));
      planes[name] = { samples: size / 2, sha256: sha(bytes), minimum: Math.min(...values), maximum: Math.max(...values), uniqueCodes: values.size };
    }
    frames.push({ index: frame, sourceSha256: sha(planar.subarray(base, base + FRAME_BYTES)),
      packedSha256: sha(packed.subarray(base, base + FRAME_BYTES)), restoredSha256: sha(unpacked.subarray(base, base + FRAME_BYTES)), planes });
  }
  return { frames, totalSamplesComparedPerDirection: planar.length / 2, allPackedWordsMatchIndependentLayout: true,
    allRestoredSamplesMatch: true, sourceSha256: sha(planar), expectedPackedSha256: sha(expected),
    actualPackedSha256: sha(packed), restoredSha256: sha(unpacked), frameCount: COLOR_FRAMES };
}
function blockMean(bytes, column, y0) {
  let sum = 0;
  for (let y = y0; y < y0 + 16; y++) for (let x = column * 32 + 8; x < column * 32 + 24; x++) sum += bytes.readUInt16LE(2 * (y * WIDTH + x));
  return sum / 256;
}
function frameIdentity(bytes) {
  assert.equal(bytes.length, FRAME_BYTES);
  let id = 0;
  for (let bit = 0; bit < 7; bit++) {
    const mean = blockMean(bytes, bit, 144);
    assert.ok(mean <= 350 || mean >= 650, 'Decoded frame-id cell is ambiguous');
    if (mean >= 650) id |= 1 << bit;
  }
  return id;
}
function validateFrameTimeline(plane, requireTimestamps) {
  assert.equal(plane.frames.length, FRAMES, 'All 96 decoded presentation frames are required');
  assert.equal(plane.video.width, WIDTH); assert.equal(plane.video.height, HEIGHT);
  for (const [index, frame] of plane.frames.entries()) {
    assert.equal(frame.width, WIDTH); assert.equal(frame.height, HEIGHT); assert.equal(frame.pix_fmt, 'yuv420p10le');
    assert.equal(frame.interlaced_frame, 0, 'Decoded progressive evidence is required');
    if (requireTimestamps) {
      const actual = Number(frame.best_effort_timestamp_time ?? frame.pts_time);
      assert.ok(Number.isFinite(actual) && Math.abs(actual - index / FPS) <= 0.00051, 'Presentation timestamp/cadence differs from the seeded 30 fps grid');
    }
  }
}

function classifyWarnings(stderr, kind, argv) {
  const explained = [], unexplained = [];
  const x265 = argv.includes('libx265') && ['fixture-seed-encode', 'production-contribution-encode'].includes(kind);
  const raw = ['fixture-seed-encode', 'identity-packing-raw'].includes(kind) && argv.includes('rawvideo') && argv.includes('-framerate');
  for (const line of stderr.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    if (x265 && line === 'x265 [warning]: Turning on repeat-headers for HDR compatibility') {
      explained.push({ line, reason: 'Pinned x265 reports repeated headers for HDR compatibility; expected static metadata and both bitstream/container planes must still validate.' });
    } else if (x265 && HEIGHT < 720 && line === 'x265 [warning]: Source height < 720p; disabling lookahead-slices') {
      explained.push({ line, reason: 'The declared 180-pixel synthetic fixture triggers x265 small-picture lookahead behavior. This evidence makes no speed/quality claim for real-resolution recipes.' });
    } else if (raw && /^\[in#0\/rawvideo @ [0-9a-f]+\] Estimating duration from bitrate, this may be inaccurate$/i.test(line)) {
      explained.push({ line, reason: 'Owned raw bytes have exact dimensions, sample packing, declared 30 fps and a fixed complete frame count. Exact byte/frame equality validates duration separately from this demuxer estimate.' });
    } else unexplained.push(line);
  }
  return { scope: 'this fixed numeric fixture only; not a production warning allowlist', explained, unexplained };
}

function analyzeAnnexB(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMITS.encodedBytes, 'Bounded elementary stream required');
  const starts = [];
  for (let i = 0; i < bytes.length - 2; i++) {
    let length = 0;
    if (bytes[i] === 0 && bytes[i + 1] === 0) {
      if (bytes[i + 2] === 0 && bytes[i + 3] === 1) length = 4;
      else if (bytes[i + 2] === 1) length = 3;
    }
    if (length) { starts.push({ offset: i, length }); assert.ok(starts.length <= 8192, 'Bounded NAL count'); i += length - 1; }
  }
  assert.ok(starts.length && starts[0].offset === 0, 'Elementary stream starts with Annex B framing');
  const sequence = [], issues = [], seen = new Set(), counts = {};
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index], nal = bytes.subarray(start.offset + start.length, starts[index + 1]?.offset ?? bytes.length);
    assert.ok(nal.length >= 2 && !(nal[0] & 128) && (nal[1] & 7) !== 0, 'Valid HEVC NAL header');
    const type = (nal[0] >>> 1) & 63;
    const entry = { index, type, bytes: nal.length, sha256: sha(nal), seiTypes: [] };
    if (type === 39 || type === 40) {
      const rbsp = []; let zeroes = 0;
      for (let cursor = 2; cursor < nal.length; cursor++) {
        const value = nal[cursor];
        if (zeroes >= 2 && value === 3) { assert.ok(cursor + 1 < nal.length && nal[cursor + 1] <= 3, 'Valid emulation prevention'); zeroes = 0; continue; }
        rbsp.push(value); zeroes = value === 0 ? zeroes + 1 : 0;
      }
      let position = 0;
      while (position < rbsp.length && !(position === rbsp.length - 1 && rbsp[position] === 128)) {
        let payloadType = 0, payloadSize = 0;
        while (rbsp[position] === 255) { payloadType += 255; position++; }
        assert.ok(position < rbsp.length); payloadType += rbsp[position++];
        while (rbsp[position] === 255) { payloadSize += 255; position++; }
        assert.ok(position < rbsp.length); payloadSize += rbsp[position++];
        assert.ok(position + payloadSize < rbsp.length, 'Complete SEI payload plus rbsp trailing bits');
        entry.seiTypes.push(payloadType); assert.ok(entry.seiTypes.length <= 256, 'Bounded SEI messages');
        if (payloadType === 1 && !seen.has(33)) issues.push({ code: 'PICTURE_TIMING_BEFORE_SPS', nalIndex: index });
        position += payloadSize;
      }
      assert.equal(rbsp[position], 128, 'SEI rbsp trailing bits'); assert.equal(position, rbsp.length - 1);
    }
    if (type <= 31 && ![32, 33, 34].every(value => seen.has(value))) issues.push({ code: 'VCL_BEFORE_PARAMETER_SETS', nalIndex: index });
    seen.add(type); counts[type] = (counts[type] || 0) + 1; sequence.push(entry);
  }
  const payloads = sequence.filter(entry => ![32, 33, 34].includes(entry.type)).map(({ type, bytes: size, sha256 }) => ({ type, bytes: size, sha256 }));
  const parameterSetHashes = [...new Set(sequence.filter(entry => [32, 33, 34].includes(entry.type)).map(entry => `${entry.type}:${entry.sha256}`))].sort();
  assert.ok(parameterSetHashes.length <= 64, 'Bounded unique parameter sets');
  return { bytes: bytes.length, sha256: sha(bytes), nalCount: sequence.length, counts, firstNalTypes: sequence.slice(0, 12).map(entry => entry.type),
    prefixSeiTypes: sequence.filter(entry => entry.type === 39).slice(0, 8).map(entry => entry.seiTypes),
    parameterSetHashes, nonParameterSetNalCount: payloads.length, nonParameterSetSequenceSha256: sha(JSON.stringify(payloads)), issues };
}

async function main() {
  const args = process.argv.slice(2);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (args[0] !== '--parent-authorized-native' || ![1, 2, 3].includes(args.length)
      || (args.length === 2 && args[1] !== '--packing-colors')
      || (args.length === 3 && (!['--reuse-fixtures', '--recheck-extraction'].includes(args[1]) || !uuid.test(args[2])))) {
    console.log('No media work started. Parent review/exclusive media slot required: node scripts/v07-hdr-smoke.cjs --parent-authorized-native [--reuse-fixtures PRIOR_RUN_UUID | --recheck-extraction PRIOR_RUN_UUID | --packing-colors]'); return;
  }
  const reuseId = args[1] === '--reuse-fixtures' ? args[2] : null;
  const extractionRecheckId = args[1] === '--recheck-extraction' ? args[2] : null;
  const packingColors = args[1] === '--packing-colors';
  const limits = packingColors ? COLOR_LIMITS : LIMITS;
  const id = randomUUID(), controller = new AbortController(), children = new Set();
  const reportDirectory = path.join(REPORT_BASE, id), reportFile = path.join(reportDirectory, 'report.json');
  const directories = { fixtures: path.join(OWNED, 'fixtures', `hdr-preserve-${id}`), outputs: path.join(OWNED, 'outputs', `hdr-preserve-${id}`),
    staging: path.join(OWNED, 'staging', `hdr-preserve-${id}`) };
  const report = { schema: 1, id, startedAt: new Date().toISOString(), status: 'initializing',
    purpose: packingColors ? 'bounded-colored-raw-layout-qualification' : 'bounded-HDR-preservation-media-qualification',
    limits, ownedPaths: directories, reportFile, invocations: [], artifacts: {}, fixtures: [], cases: [], maxConcurrentChildren: 0, reusedFixtureRun: reuseId,
    extractionRecheckRun: extractionRecheckId,
    packingColorsOnly: packingColors,
    capabilityGranted: false, publicationAuthorized: false, hdrDisplayVerified: false,
    excluded: ['Ambient/Dolby metadata preservation', 'HDR-to-SDR tone mapping', 'Dolby-aware PQ', 'Full application lifecycle/ancillary preservation', 'Benchmark or perceptual recommendations'] };
  let tools, leaseHandle, leaseIdentity, reportHandle, reportIdentity, deadline, saveChain = Promise.resolve();
  const reusedFiles = new Set();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const owned = file => Object.values(directories).some(base => inside(base, file));
  async function save() {
    if (!reportHandle) return;
    const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= LIMITS.reportBytes, 'Bounded report size');
    const operation = saveChain.then(async () => {
      await assertOrdinaryPath(reportFile);
      const before = await fs.lstat(reportFile, { bigint: true }), opened = await reportHandle.stat({ bigint: true });
      assert.ok(sameStamp(before, opened) && sameObject(before, reportIdentity) && before.nlink === 1n, 'Report path/handle identity');
      let offset = 0;
      while (offset < bytes.length) { const part = await reportHandle.write(bytes, offset, bytes.length - offset, offset); assert.ok(part.bytesWritten > 0); offset += part.bytesWritten; }
      await reportHandle.truncate(bytes.length); await reportHandle.sync(); reportIdentity = await reportHandle.stat({ bigint: true });
      assert.ok(sameStamp(reportIdentity, await fs.lstat(reportFile, { bigint: true })), 'Report publication identity');
    });
    saveChain = operation; return operation;
  }
  async function reserve(parent, name) {
    await assertOrdinaryPath(parent, 'directory'); const directory = path.join(parent, name);
    await fs.mkdir(directory); await assertOrdinaryPath(directory, 'directory'); return directory;
  }
  async function resources() {
    const output = {};
    for (const [name, directory] of [['D', ROOT], ['F', OWNED]]) {
      const stat = await fs.statfs(directory, { bigint: true }); output[name] = { availableBytes: String(stat.bavail * stat.bsize), at: new Date().toISOString() };
    }
    assert.ok(BigInt(output.D.availableBytes) >= 25n * 1024n ** 3n + BigInt(LIMITS.reportBytes), 'D: requires 25 GiB plus bounded report forecast');
    const remainingForecast = Math.max(0, limits.ownedBytes - (report.ownedBytes || 0));
    assert.ok(BigInt(output.F.availableBytes) >= BigInt(remainingForecast + limits.marginBytes), 'F: requires the remaining bounded run forecast plus 512 MiB margin');
    return output;
  }
  async function measureOwned() {
    let bytes = 0;
    for (const directory of Object.values(directories)) {
      await assertOrdinaryPath(directory, 'directory');
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        assert.ok(entry.isFile() && !entry.isSymbolicLink(), 'Unexpected entry in exclusive owned directory');
        const file = path.join(directory, entry.name), stat = await fs.lstat(file, { bigint: true });
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n, 'Owned artifact must be an ordinary unlinked file'); bytes += Number(stat.size);
      }
    }
    report.ownedBytes = bytes; assert.ok(bytes <= limits.ownedBytes, 'Native run exceeded its declared ownership budget');
    return bytes;
  }
  async function hashFile(file, maximum = 32 * 1024 * 1024) {
    assert.ok(owned(file) || reusedFiles.has(file) || MODULES.some(name => file === path.join(ROOT, name)), 'Hash scope is fixed to owned evidence/source modules');
    await assertOrdinaryPath(file); const before = await fs.lstat(file, { bigint: true });
    assert.ok(before.nlink === 1n && before.size <= BigInt(maximum), 'Bounded ordinary artifact required');
    const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    try {
      assert.ok(sameStamp(before, await handle.stat({ bigint: true })), 'Artifact handle identity');
      for (let offset = 0; offset < Number(before.size);) {
        assert.ok(!controller.signal.aborted, 'Run cancelled');
        const part = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
        assert.ok(part.bytesRead > 0, 'Complete artifact hash'); hash.update(buffer.subarray(0, part.bytesRead)); offset += part.bytesRead;
      }
      assert.ok(sameStamp(before, await handle.stat({ bigint: true })) && sameStamp(before, await fs.lstat(file, { bigint: true })), 'Artifact changed during hashing');
      return { file, bytes: Number(before.size), sha256: hash.digest('hex'), identity: stamp(before) };
    } finally { await handle.close(); }
  }
  async function receipt(file) { const value = await hashFile(file); report.artifacts[file] = value; await measureOwned(); return value; }
  async function writeEvidence(name, content) {
    const file = path.join(directories.staging, name); assert.ok(owned(file)); await assertOrdinaryPath(directories.staging, 'directory');
    const handle = await fs.open(file, 'wx');
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    return receipt(file);
  }
  async function stableInput(file) {
    assert.ok((owned(file) || reusedFiles.has(file)) && report.artifacts[file], 'Only sealed owned artifacts may be media inputs');
    await assertOrdinaryPath(file);
    assert.deepEqual(stamp(await fs.lstat(file, { bigint: true })), report.artifacts[file].identity, 'Input identity changed since its receipt');
  }
  async function run(executable, argv, kind) {
    assert.ok(Object.values(tools).includes(executable)); assert.equal(children.size, 0, 'Exclusive media child');
    assert.ok(!controller.signal.aborted && report.invocations.length < limits.invocations); assert.ok(!argv.includes('-y'));
    const version = argv.length === 1 && argv[0] === '-version';
    const inputs = argv.flatMap((arg, index) => arg === '-i' ? [argv[index + 1]] : []);
    assert.equal(inputs.length, version ? 0 : 1); for (const input of inputs) await stableInput(input);
    const destination = !version && executable === tools.ffmpeg ? argv.at(-1) : null;
    if (destination) {
      assert.ok(owned(destination) && argv.includes('-n'), 'Only no-overwrite owned outputs');
      await assertOrdinaryPath(path.dirname(destination), 'directory');
      await fs.lstat(destination).then(() => { throw new Error('Existing native output is preserved'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
    await resources(); await measureOwned();
    const invocation = { sequence: report.invocations.length + 1, kind, executable, argv: [...argv], startedAt: new Date().toISOString(), status: 'running' };
    report.invocations.push(invocation); await save(); const start = process.hrtime.bigint();
    try {
      const result = await runTool(executable, argv, { signal: controller.signal, timeoutMs: limits.childMs,
        stdoutLimit: limits.stdoutBytes, stderrLimit: limits.stderrBytes,
        onChild: child => { children.add(child); invocation.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
          child.once('close', (code, signal) => { invocation.observedClose = { code, signal }; children.delete(child); }); } });
      invocation.stdout = await writeEvidence(`${invocation.sequence}.stdout.txt`, result.stdout);
      invocation.stderr = await writeEvidence(`${invocation.sequence}.stderr.txt`, result.stderr);
      invocation.stderrCapture = result.stderrCapture; invocation.exitCode = result.exitCode;
      assert.ok(result.stderrCapture && !result.stderrCapture.truncated && result.stderrCapture.totalBytes === Buffer.byteLength(result.stderr), 'Complete warning evidence required');
      invocation.warningBytes = Buffer.byteLength(result.stderr.trim());
      invocation.warningAssessment = classifyWarnings(result.stderr, kind, argv);
      if (destination) invocation.output = await receipt(destination);
      invocation.status = 'completed'; return { ...result, invocation };
    } catch (error) { invocation.status = 'failed'; invocation.failure = errorData(error); throw error; }
    finally {
      invocation.elapsedMs = Number(process.hrtime.bigint() - start) / 1e6; invocation.finishedAt = new Date().toISOString();
      await measureOwned(); await save();
    }
  }
  const prefix = () => ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-xerror', '-protocol_whitelist', 'file,pipe'];
  async function observePlane(file, timestamps) {
    const result = await run(tools.ffprobe, ['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_streams', '-show_frames', '-show_format', '-of', 'json', '-i', file], 'complete-probe');
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.streams) && parsed.streams.length === 1 && Array.isArray(parsed.frames), 'One complete observed video stream');
    const plane = { video: parsed.streams[0], frames: parsed.frames, coverage: 'full', decodedFrameCount: parsed.frames.length, decodeExitCode: result.exitCode };
    validateFrameTimeline(plane, timestamps);
    if (timestamps) assert.ok(Math.abs(Number(parsed.format.duration) - FRAMES / FPS) <= 0.002, 'Container duration matches complete 96-frame fixture');
    return { plane, invocation: result.invocation.sequence, probeReceipt: result.invocation.stdout };
  }
  async function decodedPixels(file, label, rawSourceReceipt = null) {
    const decoded = path.join(directories.staging, `${label}-decoded.yuv`);
    const call = await run(tools.ffmpeg, [...prefix(), '-noautorotate', '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn',
      '-c:v', 'rawvideo', '-pix_fmt', '+yuv420p10le', '-fps_mode', 'passthrough', '-fs', String(LIMITS.rawBytes), '-f', 'rawvideo', decoded], 'complete-pixel-decode');
    const seal = call.invocation.output; assert.equal(seal.bytes, FRAME_BYTES * FRAMES, 'Full native 10-bit decoded frame count');
    if (rawSourceReceipt) assert.equal(seal.sha256, rawSourceReceipt.sha256, 'Seed encode must preserve every generated numeric sample losslessly');
    const handle = await fs.open(decoded, 'r'), frame = Buffer.alloc(FRAME_BYTES), patches = Array(10).fill(0), identities = [];
    try {
      assert.deepEqual(stamp(await handle.stat({ bigint: true })), seal.identity);
      for (let index = 0; index < FRAMES; index++) {
        let offset = 0;
        while (offset < frame.length) { const part = await handle.read(frame, offset, frame.length - offset, index * FRAME_BYTES + offset); assert.ok(part.bytesRead > 0); offset += part.bytesRead; }
        const observedId = frameIdentity(frame); assert.equal(observedId, index, 'Decoded content preserves presentation frame order without drops/duplicates'); identities.push(observedId);
        for (let column = 0; column < 10; column++) patches[column] += blockMean(frame, column, 40) / FRAMES;
      }
      assert.deepEqual(stamp(await handle.stat({ bigint: true })), seal.identity);
    } finally { await handle.close(); }
    await stableInput(decoded);
    return { invocation: call.invocation.sequence, receipt: seal, frameCount: identities.length, frameIdsSha256: sha(JSON.stringify(identities)),
      everyPresentationIdMatched: true, patchMeanCodes: patches, pixelQualityClaim: 'none; frame IDs and descriptive numeric patch observations only' };
  }
  async function extractElementary(file, label) {
    const elementary = path.join(directories.staging, `${label}.h265`);
    // hevc_mp4toannexb alone inserts codec extradata immediately before the
    // IRAP NAL, which can leave preceding picture-timing SEI without an SPS in
    // a standalone stream. dump_extra prepends the existing parameter sets to
    // the key packet. It does not filter/rewrite SEI or alter encoded pictures.
    // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/bsf/hevc_mp4toannexb.c#L174
    // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/bsf/dump_extradata.c#L46
    const extraction = await run(tools.ffmpeg, [...prefix(), '-i', file, '-map', '0:v:0', '-c:v', 'copy', '-an', '-sn', '-dn',
      '-bsf:v', 'hevc_mp4toannexb,dump_extra=freq=keyframe', '-fs', String(LIMITS.encodedBytes), '-f', 'hevc', elementary], 'independent-elementary-extraction');
    await stableInput(elementary); const bytes = await fs.readFile(elementary); await stableInput(elementary);
    assert.equal(sha(bytes), extraction.invocation.output.sha256);
    const analysis = analyzeAnnexB(bytes); assert.deepEqual(analysis.issues, [], 'Standalone elementary parameter sets must precede dependent NALs');
    return { elementary, extraction, analysis };
  }
  async function collect(file, label, plan, rawSourceReceipt = null) {
    const container = await observePlane(file, true);
    const { elementary, extraction, analysis } = await extractElementary(file, label);
    const bitstream = await observePlane(elementary, false);
    // These observations really come from different inputs. Never fill the
    // bitstream plane by copying container metadata into a plausible structure.
    const validation = validateHdrEncodingOutput(plan, { container: container.plane, bitstream: bitstream.plane });
    const pixels = await decodedPixels(file, label, rawSourceReceipt);
    return { validation, container, bitstream, extractionInvocation: extraction.invocation.sequence, elementaryReceipt: extraction.invocation.output, elementaryAnalysis: analysis, pixels };
  }
  async function createFixture(spec) {
    const raw = path.join(directories.fixtures, `${spec.id}-numeric.yuv`), file = path.join(directories.fixtures, `${spec.id}-seed.mkv`);
    await assertOrdinaryPath(directories.fixtures, 'directory'); const handle = await fs.open(raw, 'wx');
    try {
      for (let index = 0; index < FRAMES; index++) {
        assert.ok(!controller.signal.aborted); const frame = numericFrame(spec, index); let offset = 0;
        while (offset < frame.length) { const part = await handle.write(frame, offset, frame.length - offset, index * FRAME_BYTES + offset); assert.ok(part.bytesWritten > 0); offset += part.bytesWritten; }
      }
      await handle.sync();
    } finally { await handle.close(); }
    const rawReceipt = await receipt(raw);
    // Fixture seeding intentionally uses an independent explicit literal, not
    // the production writer's serialized output, to catch channel/order errors.
    const params = 'lossless=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):cll=1:max-cll=1000,400';
    const seed = await run(tools.ffmpeg, [...prefix(), '-f', 'rawvideo', '-pixel_format', 'yuv420p10le', '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', raw,
      '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
      // Raw YUV has no color headers. Declare the known numeric generator's
      // interpretation on frames as well as the encoder; do not allow FFmpeg
      // to invent a color conversion to satisfy output signaling.
      '-vf', `setparams=range=limited:color_primaries=bt2020:color_trc=${spec.transfer}:colorspace=bt2020nc`,
      '-c:v', 'libx265', '-preset', 'ultrafast',
      '-x265-params', params, '-dolbyvision', '0', '-profile:v', 'main10', '-pix_fmt', '+yuv420p10le', '-field_order', 'progressive', '-fps_mode', 'passthrough',
      '-color_primaries', 'bt2020', '-color_trc', spec.transfer, '-colorspace', 'bt2020nc', '-color_range', 'tv', '-chroma_sample_location', 'left',
      '-fs', String(LIMITS.encodedBytes), '-f', 'matroska', file], 'fixture-seed-encode');
    const expectedRaw = { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: WIDTH, height: HEIGHT,
      pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: spec.transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv',
      chroma_location: 'left', side_data_list: [{ side_data_type: 'Mastering display metadata', ...spec.mastering }, { side_data_type: 'Content light level metadata', ...spec.contentLight }] };
    const expectedPlan = buildHdrEncoding({ settings: SETTINGS[0], policy: 'preserve', videoEvidence: buildMediaEvidence({ format: {}, streams: [expectedRaw] }).streams[0] });
    const observations = await collect(file, `source-${spec.id}`, expectedPlan, rawReceipt);
    assert.equal(observations.validation.valid, true, JSON.stringify(observations.validation.issues));
    const value = { ...spec, file, rawReceipt, seedInvocation: seed.invocation.sequence, seedReceipt: seed.invocation.output, observations };
    report.fixtures.push(value); await save(); return value;
  }
  const frameEvidence = plane => ({ videoIndex: plane.video.index, coverage: plane.coverage,
    decodedFrameCount: plane.decodedFrameCount, decodeExitCode: plane.decodeExitCode, frames: plane.frames });
  async function reuseFixtures() {
    // The only input selector is a UUID under this harness's fixed report root;
    // no arbitrary media/report path is accepted by a UI or CLI argument.
    const previousReport = path.join(REPORT_BASE, reuseId, 'report.json'); reusedFiles.add(previousReport);
    const reportSeal = await hashFile(previousReport, LIMITS.reportBytes);
    async function readJson(seal) {
      await assertOrdinaryPath(seal.file);
      assert.deepEqual(stamp(await fs.lstat(seal.file, { bigint: true })), seal.identity);
      const bytes = await fs.readFile(seal.file);
      assert.equal(bytes.length, seal.bytes); assert.equal(sha(bytes), seal.sha256);
      assert.deepEqual(stamp(await fs.lstat(seal.file, { bigint: true })), seal.identity);
      return JSON.parse(bytes.toString('utf8'));
    }
    const previous = await readJson(reportSeal);
    assert.equal(previous.schema, 1); assert.equal(previous.id, reuseId);
    assert.ok(['completed-with-qualification-gaps', 'completed-bounded-preserve-media-subset'].includes(previous.status));
    assert.equal(previous.leaseReleased, true); assert.equal(previous.fixtures.length, 2);
    assert.equal(previous.runtime.helpBasis.ffmpegSha256, HELP_BASIS.ffmpegSha256);
    assert.equal(previous.runtime.helpBasis.ffprobeSha256, HELP_BASIS.ffprobeSha256);
    report.artifacts[previousReport] = reportSeal;
    const sealed = new Map();
    async function verifyReceipt(seal) {
      assert.ok(seal && typeof seal.file === 'string');
      assert.ok(['fixtures', 'staging'].some(kind => inside(path.join(OWNED, kind, `hdr-preserve-${reuseId}`), seal.file)), 'Reuse is limited to this prior fixture evidence');
      assert.deepEqual(previous.artifacts[seal.file], seal, 'The prior run sealed this exact artifact');
      reusedFiles.add(seal.file);
      if (!sealed.has(seal.file)) {
        assert.deepEqual(await hashFile(seal.file), seal, 'Prior fixture/evidence changed; do not silently reuse it');
        sealed.set(seal.file, seal); report.artifacts[seal.file] = seal;
      }
    }
    for (const kind of ['pq', 'hlg']) {
      const fixture = previous.fixtures.find(item => item.id === kind); assert.ok(fixture);
      for (const [key, value] of Object.entries(fixtureSpec(kind))) assert.deepEqual(fixture[key], value, `Fixture specification ${key}`);
      assert.equal(fixture.file, path.join(OWNED, 'fixtures', `hdr-preserve-${reuseId}`, `${kind}-seed.mkv`));
      assert.equal(fixture.rawReceipt.file, path.join(OWNED, 'fixtures', `hdr-preserve-${reuseId}`, `${kind}-numeric.yuv`));
      assert.equal(fixture.seedReceipt.file, fixture.file);
      assert.equal(fixture.observations.validation.valid, true, 'Only previously validated seed fixtures may be reused');
      for (const seal of [fixture.rawReceipt, fixture.seedReceipt, fixture.observations.elementaryReceipt, fixture.observations.pixels.receipt]) await verifyReceipt(seal);
      assert.equal(fixture.observations.pixels.receipt.sha256, fixture.rawReceipt.sha256, 'Prior seed is numerically lossless');
      assert.equal(fixture.observations.pixels.frameCount, FRAMES); assert.equal(fixture.observations.pixels.everyPresentationIdMatched, true);
      for (const name of ['container', 'bitstream']) {
        const observation = fixture.observations[name]; await verifyReceipt(observation.probeReceipt);
        const captured = await readJson(observation.probeReceipt);
        assert.equal(captured.streams.length, 1); assert.deepEqual(observation.plane.video, captured.streams[0]);
        assert.deepEqual(observation.plane.frames, captured.frames); validateFrameTimeline(observation.plane, name === 'container');
        const invocation = previous.invocations.find(item => item.sequence === observation.invocation);
        assert.ok(invocation && invocation.kind === 'complete-probe' && invocation.exitCode === 0 && invocation.status === 'completed');
        assert.deepEqual(invocation.stdout, observation.probeReceipt);
        assert.equal(invocation.argv[invocation.argv.indexOf('-i') + 1], name === 'container' ? fixture.file : fixture.observations.elementaryReceipt.file);
      }
      const source = fixture.observations.container.plane;
      const plan = buildHdrEncoding({ settings: SETTINGS[0], policy: 'preserve', videoEvidence: buildMediaEvidence({ format: {}, streams: [source.video] }).streams[0], frameEvidence: frameEvidence(source) });
      const validation = validateHdrEncodingOutput(plan, { container: source, bitstream: fixture.observations.bitstream.plane });
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
      assert.equal(plan.expectedOutput.metadata.contentLight.max_content.value, fixture.contentLight.max_content);
      assert.equal(plan.expectedOutput.metadata.contentLight.max_average.value, fixture.contentLight.max_average);
      for (const [key, raw] of Object.entries(fixture.mastering)) {
        const [n, d] = raw.split('/').map(BigInt), value = plan.expectedOutput.metadata.mastering[key];
        assert.equal(n * BigInt(value.denominator), BigInt(value.numerator) * d, `Seed mastering ${key} matches generator specification`);
      }
      fixture.reuseValidation = validation; fixture.reusedFrom = reuseId; report.fixtures.push(fixture);
    }
    report.fixtureReuse = { sourceReport: reportSeal, verifiedFiles: sealed.size, seedEncodes: 0,
      basis: 'Exact prior owned fixture, raw identity, independently captured container/bitstream JSON and decoded sample receipts; no benchmark/personal input.' };
    await save(); return report.fixtures;
  }
  async function recheckExistingExtractions() {
    const previousReport = path.join(REPORT_BASE, extractionRecheckId, 'report.json'); reusedFiles.add(previousReport);
    const sourceReport = await hashFile(previousReport, LIMITS.reportBytes); report.artifacts[previousReport] = sourceReport;
    async function sealedJson(seal) {
      await stableInput(seal.file); const bytes = await fs.readFile(seal.file); await stableInput(seal.file);
      assert.equal(bytes.length, seal.bytes); assert.equal(sha(bytes), seal.sha256); return JSON.parse(bytes.toString('utf8'));
    }
    const previous = await sealedJson(sourceReport);
    assert.equal(previous.id, extractionRecheckId); assert.equal(previous.schema, 1); assert.equal(previous.leaseReleased, true);
    assert.equal(previous.status, 'completed-with-qualification-gaps');
    assert.equal(previous.runtime.helpBasis.ffmpegSha256, HELP_BASIS.ffmpegSha256);
    assert.equal(previous.runtime.helpBasis.ffprobeSha256, HELP_BASIS.ffprobeSha256);
    const seedRun = previous.reusedFixtureRun || previous.id; assert.ok(uuid.test(seedRun));
    async function register(seal, expectedFile) {
      assert.ok(seal && typeof seal.file === 'string');
      if (expectedFile) assert.equal(seal.file, expectedFile);
      else assert.ok([seedRun, previous.id].some(runId => inside(path.join(OWNED, 'staging', `hdr-preserve-${runId}`), seal.file))
        && /^\d+\.stdout\.txt$/.test(path.basename(seal.file)), 'Only sealed captured probe JSON may be reused');
      assert.deepEqual(previous.artifacts[seal.file], seal, 'Prior report sealed the exact source artifact');
      reusedFiles.add(seal.file); assert.deepEqual(await hashFile(seal.file), seal); report.artifacts[seal.file] = seal;
    }
    report.extractionInvestigation = { sourceReport, hypothesis: 'hevc_mp4toannexb placed existing VPS/SPS/PPS after the first picture-timing SEI; standalone decode had no SPS yet.',
      correction: 'hevc_mp4toannexb,dump_extra=freq=keyframe prepends existing parameter sets; no suppression, metadata removal or picture re-encoding.',
      scope: 'two retained NVENC outputs only; zero seed, encode, raw-packing or pixel-decode reruns',
      productionRecipeChanged: false, previousReportsRewritten: false,
      sourceBasis: ['https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/hevc/sei.c#L48',
        'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/bsf/hevc_mp4toannexb.c#L174',
        'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/bsf/dump_extradata.c#L46'] };
    for (const kind of ['pq', 'hlg']) {
      const previousCase = previous.cases.find(item => item.id === `${kind}-h265-nvidia`), fixture = previous.fixtures.find(item => item.id === kind);
      assert.ok(previousCase && fixture && previousCase.settings.profileId === 'h265-nvidia');
      assert.equal(previousCase.observations.validation.valid, true); assert.equal(previousCase.observations.pixels.everyPresentationIdMatched, true);
      assert.equal(previousCase.observations.pixels.frameCount, FRAMES);
      const output = path.join(OWNED, 'outputs', `hdr-preserve-${previous.id}`, `${previousCase.id}.mkv`);
      await register(previousCase.outputReceipt, output);
      await register(previousCase.observations.elementaryReceipt, path.join(OWNED, 'staging', `hdr-preserve-${previous.id}`, `${previousCase.id}.h265`));
      await register(fixture.seedReceipt, path.join(OWNED, 'fixtures', `hdr-preserve-${seedRun}`, `${kind}-seed.mkv`));
      await register(fixture.observations.container.probeReceipt);
      await register(previousCase.observations.container.probeReceipt);
      const seedCapture = await sealedJson(fixture.observations.container.probeReceipt);
      const containerCapture = await sealedJson(previousCase.observations.container.probeReceipt);
      for (const [capture, plane] of [[seedCapture, fixture.observations.container.plane], [containerCapture, previousCase.observations.container.plane]]) {
        assert.equal(capture.streams.length, 1); assert.deepEqual(capture.streams[0], plane.video); assert.deepEqual(capture.frames, plane.frames);
        validateFrameTimeline(plane, true);
      }
      const containerInvocation = previous.invocations.find(call => call.sequence === previousCase.observations.container.invocation);
      assert.equal(containerInvocation.exitCode, 0); assert.equal(containerInvocation.warningBytes, 0);
      assert.deepEqual(containerInvocation.stdout, previousCase.observations.container.probeReceipt);
      assert.equal(containerInvocation.argv[containerInvocation.argv.indexOf('-i') + 1], output);
      const source = fixture.observations.container.plane;
      const plan = buildHdrEncoding({ settings: previousCase.settings, policy: 'preserve', videoEvidence: buildMediaEvidence({ format: {}, streams: [source.video] }).streams[0], frameEvidence: frameEvidence(source) });
      const oldBytes = await fs.readFile(previousCase.observations.elementaryReceipt.file);
      assert.equal(sha(oldBytes), previousCase.observations.elementaryReceipt.sha256);
      const oldAnalysis = analyzeAnnexB(oldBytes);
      assert.deepEqual(oldAnalysis.issues, [{ code: 'PICTURE_TIMING_BEFORE_SPS', nalIndex: 0 }], 'Retained defect must match the investigated ordering case exactly');
      const startSequence = report.invocations.length;
      const corrected = await extractElementary(output, `${previousCase.id}-corrected-extraction`);
      assert.equal(corrected.analysis.nonParameterSetNalCount, oldAnalysis.nonParameterSetNalCount);
      assert.equal(corrected.analysis.nonParameterSetSequenceSha256, oldAnalysis.nonParameterSetSequenceSha256,
        'Every non-parameter-set NAL (including all SEI and pictures) remains byte-identical and in the same order');
      assert.deepEqual(corrected.analysis.parameterSetHashes, oldAnalysis.parameterSetHashes, 'No invented or altered parameter sets');
      const bitstream = await observePlane(corrected.elementary, false);
      const validation = validateHdrEncodingOutput(plan, { container: previousCase.observations.container.plane, bitstream: bitstream.plane });
      const warningInvocations = report.invocations.slice(startSequence).filter(call => call.warningBytes > 0).map(call => call.sequence);
      report.cases.push({ id: previousCase.id, status: validation.valid && !warningInvocations.length ? 'extraction-recheck-passed' : 'extraction-recheck-unqualified',
        reference: { report: sourceReport, caseId: previousCase.id, sourceFixture: fixture.seedReceipt, output: previousCase.outputReceipt,
          containerProbe: previousCase.observations.container.probeReceipt, previousElementary: previousCase.observations.elementaryReceipt,
          previousPixelEvidence: previousCase.observations.pixels, pixelEvidenceReexecuted: false }, plan,
        oldAnalysis, correctedAnalysis: corrected.analysis, everyEncodedPayloadPreserved: true, sameParameterSets: true,
        extractionInvocation: corrected.extraction.invocation.sequence, elementaryReceipt: corrected.extraction.invocation.output,
        bitstream, validation, warningInvocations });
      await save();
    }
  }
  async function qualifyColorPacking() {
    const spec = colorPackingSpec(); report.colorPackingFixture = spec;
    const planar = Buffer.concat(Array.from({ length: COLOR_FRAMES }, (_, frame) => colorPackingFrame(frame)));
    assert.equal(planar.length, spec.rawBytes);
    const sourceReceipt = await writeEvidence('colored-numeric-planar10.yuv', planar);
    report.colorPackingSource = sourceReceipt;
    for (const [kind, transfer] of [['pq', 'smpte2084'], ['hlg', 'arib-std-b67']]) {
      const signal = { transfer, primaries: 'bt2020', matrix: 'bt2020nc', range: 'tv', chromaLocation: 'left' };
      const forward = buildHdrIdentityPacking({ ...signal, inputFormat: 'yuv420p10le', outputFormat: 'p010le' });
      const reverse = buildHdrIdentityPacking({ ...signal, inputFormat: 'p010le', outputFormat: 'yuv420p10le' });
      const packedFile = path.join(directories.staging, `${kind}-colored.p010`);
      const restoredFile = path.join(directories.staging, `${kind}-colored-restored.yuv`);
      const declare = `setparams=range=limited:color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc`;
      const convert = (source, contribution, destination) => run(tools.ffmpeg,
        [...prefix(), '-f', 'rawvideo', '-pixel_format', contribution.inputFormat, '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', source,
          '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `${declare},${contribution.filterGraph}`,
          '-c:v', 'rawvideo', '-pix_fmt', `+${contribution.outputFormat}`, '-fps_mode', 'passthrough', '-frames:v', String(COLOR_FRAMES),
          '-fs', String(limits.rawBytes), '-f', 'rawvideo', destination], 'identity-packing-raw');
      const startSequence = report.invocations.length;
      const packedCall = await convert(sourceReceipt.file, forward, packedFile);
      const restoredCall = await convert(packedFile, reverse, restoredFile);
      const readSealedRaw = async seal => {
        assert.equal(seal.bytes, spec.rawBytes, 'Exactly four complete raw frames');
        await stableInput(seal.file); const bytes = await fs.readFile(seal.file); await stableInput(seal.file);
        assert.equal(bytes.length, seal.bytes); assert.equal(sha(bytes), seal.sha256); return bytes;
      };
      const packed = await readSealedRaw(packedCall.invocation.output), restored = await readSealedRaw(restoredCall.invocation.output);
      const samples = validateColorPacking(planar, packed, restored);
      const unexplained = report.invocations.slice(startSequence).filter(call => call.warningAssessment?.unexplained.length).map(call => call.sequence);
      report.cases.push({ id: `${kind}-colored-identity-layout`, status: unexplained.length ? 'packing-passed-with-unexplained-warnings' : 'packing-passed',
        signalDeclared: signal, forward, reverse, source: sourceReceipt, packed: packedCall.invocation.output, restored: restoredCall.invocation.output,
        forwardInvocation: packedCall.invocation.sequence, reverseInvocation: restoredCall.invocation.sequence, samples,
        unexplainedWarningInvocations: unexplained, qualificationScope: 'Four complete numeric frames only, independently checked packed layout and exact planar restoration; zero compressed encodes.' });
      await save();
    }
  }
  async function qualifyPacking(fixture) {
    const signal = { transfer: fixture.transfer, primaries: 'bt2020', matrix: 'bt2020nc', range: 'tv', chromaLocation: 'left' };
    const forward = buildHdrIdentityPacking({ ...signal, inputFormat: 'yuv420p10le', outputFormat: 'p010le' });
    const reverse = buildHdrIdentityPacking({ ...signal, inputFormat: 'p010le', outputFormat: 'yuv420p10le' });
    const packed = path.join(directories.staging, `${fixture.id}-packing.p010`), unpacked = path.join(directories.staging, `${fixture.id}-packing-roundtrip.yuv`);
    const common = [...prefix(), '-f', 'rawvideo'];
    const declare = `setparams=range=limited:color_primaries=bt2020:color_trc=${fixture.transfer}:colorspace=bt2020nc`;
    const encodeLayout = async (source, inputFormat, contribution, destination, outputFormat) => run(tools.ffmpeg,
      [...common, '-pixel_format', inputFormat, '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', source,
        '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `${declare},${contribution.filterGraph}`, '-c:v', 'rawvideo', '-pix_fmt', `+${outputFormat}`,
        '-fps_mode', 'passthrough', '-fs', String(LIMITS.rawBytes), '-f', 'rawvideo', destination], 'identity-packing-raw');
    const packedCall = await encodeLayout(fixture.rawReceipt.file, 'yuv420p10le', forward, packed, 'p010le');
    const unpackedCall = await encodeLayout(packed, 'p010le', reverse, unpacked, 'yuv420p10le');
    assert.equal(packedCall.invocation.output.bytes, fixture.rawReceipt.bytes);
    assert.equal(unpackedCall.invocation.output.bytes, fixture.rawReceipt.bytes);
    assert.equal(unpackedCall.invocation.output.sha256, fixture.rawReceipt.sha256, 'Explicit pack/unpack must preserve every original numeric sample');
    fixture.packingQualification = { forward, reverse, forwardInvocation: packedCall.invocation.sequence, reverseInvocation: unpackedCall.invocation.sequence,
      completeSampleRoundtrip: true, source: fixture.rawReceipt, packed: packedCall.invocation.output, unpacked: unpackedCall.invocation.output,
      signalingEvidence: 'The four production-container/bitstream validations remain separately required.',
      limits: ['This fixture has neutral chroma; non-neutral chroma stress qualification remains separate.', 'No resize, gamut, tone-map or perceptual acceptance.'] };
    await save();
  }
  async function qualify(fixture, settings) {
    const item = { id: `${fixture.id}-${settings.profileId}`, fixture: fixture.id, settings, status: 'preparing' };
    report.cases.push(item); await save();
    const startSequence = report.invocations.length;
    try {
      await stableInput(fixture.file);
      const sourceEvidence = buildMediaEvidence({ format: {}, streams: [fixture.observations.container.plane.video] }).streams[0];
      const plan = buildHdrEncoding({ settings, policy: 'preserve', videoEvidence: sourceEvidence, frameEvidence: frameEvidence(fixture.observations.container.plane) });
      assert.equal(plan.status, 'native-qualification-required'); assert.ok(plan.videoEncoderArgs && plan.filterGraph);
      item.plan = plan;
      const file = path.join(directories.outputs, `${item.id}.mkv`);
      const encode = await run(tools.ffmpeg, [...prefix(), '-copyts', '-noautorotate', '-i', fixture.file, '-map', '0:v:0', '-an', '-sn', '-dn',
        '-map_metadata', '0', '-map_chapters', '0', '-vf', plan.filterGraph, ...plan.videoEncoderArgs, '-fs', String(LIMITS.encodedBytes), '-f', 'matroska', file], 'production-contribution-encode');
      item.encodeInvocation = encode.invocation.sequence; item.outputReceipt = encode.invocation.output;
      item.observations = await collect(file, item.id, plan);
      item.warningInvocations = report.invocations.slice(startSequence).filter(call => call.warningBytes > 0).map(call => call.sequence);
      item.unexplainedWarningInvocations = report.invocations.slice(startSequence).filter(call => call.warningAssessment?.unexplained.length).map(call => call.sequence);
      item.status = !item.observations.validation.valid ? 'media-unqualified' : item.unexplainedWarningInvocations.length
        ? 'media-passed-with-unexplained-warnings' : item.warningInvocations.length ? 'media-passed-with-explained-warnings' : 'media-passed';
    } catch (error) { item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.failure = errorData(error); }
    finally {
      try { assert.deepEqual(await hashFile(fixture.file), fixture.seedReceipt, 'Fixture remains unchanged through qualification'); }
      catch (error) { item.sourcePreservationFailure = errorData(error); item.status = 'unsafe-source-change'; controller.abort(); }
      item.finishedAt = new Date().toISOString(); await save();
    }
  }
  try {
    await assertOrdinaryPath(path.dirname(LEASE), 'directory');
    leaseHandle = await fs.open(LEASE, 'wx+'); await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: id, pid: process.pid,
      purpose: 'hdr-preserve-native-qualification', startedAt: report.startedAt })); await leaseHandle.sync(); leaseIdentity = await leaseHandle.stat({ bigint: true });
    deadline = setTimeout(stop, limits.totalMs); report.resourceBefore = await resources();
    await assertOrdinaryPath(path.dirname(REPORT_BASE), 'directory');
    await fs.mkdir(REPORT_BASE).catch(error => { if (error.code !== 'EEXIST') throw error; }); await assertOrdinaryPath(REPORT_BASE, 'directory');
    await reserve(REPORT_BASE, id);
    for (const directory of Object.values(directories)) await reserve(path.dirname(directory), path.basename(directory));
    reportHandle = await fs.open(reportFile, 'wx+'); reportIdentity = await reportHandle.stat({ bigint: true }); await save();
    report.modules = {};
    for (const module of MODULES) report.modules[module] = await hashFile(path.join(ROOT, module), 2 * 1024 * 1024);
    const verified = await verifyCandidateRuntime({ root: ROOT }); tools = { ffmpeg: verified.ffmpeg, ffprobe: verified.ffprobe };
    assert.equal(verified.manifest.release, '9.0.2');
    assert.equal(verified.verified[0].sha256, HELP_BASIS.ffmpegSha256); assert.equal(verified.verified[1].sha256, HELP_BASIS.ffprobeSha256);
    report.runtime = { verified: verified.verified, helpBasis: HELP_BASIS, versions: {} };
    for (const [name, file] of Object.entries(tools)) {
      const version = await run(file, ['-version'], 'runtime-version');
      assert.match(version.stdout.split(/\r?\n/)[0], new RegExp(`^${name} version 9\\.0\\.2(?:[-\\s]|$)`)); report.runtime.versions[name] = version.stdout.split(/\r?\n/)[0];
    }
    report.status = 'running';
    if (packingColors) await qualifyColorPacking();
    else if (extractionRecheckId) await recheckExistingExtractions();
    else {
      const fixtures = reuseId ? await reuseFixtures() : [];
      if (!reuseId) for (const kind of ['pq', 'hlg']) fixtures.push(await createFixture(fixtureSpec(kind)));
      for (const fixture of fixtures) await qualifyPacking(fixture);
      for (const fixture of fixtures) for (const settings of SETTINGS) {
        if (controller.signal.aborted) throw new Error('Run cancelled'); await qualify(fixture, settings);
      }
    }
    for (const [file, original] of Object.entries(report.artifacts)) assert.deepEqual(await hashFile(file), original, 'Owned evidence changed after its receipt');
    for (const module of MODULES) assert.deepEqual(await hashFile(path.join(ROOT, module), 2 * 1024 * 1024), report.modules[module], 'Source code changed during qualification');
    report.runtime.after = (await verifyCandidateRuntime({ root: ROOT })).verified;
    assert.deepEqual(report.runtime.after, report.runtime.verified, 'Pinned runtime remained unchanged');
    report.resourceAfter = await resources(); await measureOwned();
    assert.equal(report.invocations.filter(call => call.kind === 'fixture-seed-encode').length, reuseId || extractionRecheckId || packingColors ? 0 : 2);
    assert.equal(report.invocations.filter(call => call.kind === 'identity-packing-raw').length, extractionRecheckId ? 0 : 4);
    assert.equal(report.invocations.filter(call => call.kind === 'production-contribution-encode').length, extractionRecheckId || packingColors ? 0 : 4);
    if (packingColors) {
      assert.equal(report.invocations.length, 6, 'Two observed runtime versions and four raw conversions only');
      assert.equal(report.fixtures.length, 0, 'No compressed seed fixtures created');
      assert.ok(report.ownedBytes < 4 * 1024 * 1024, 'Colored raw evidence and process logs stay below 4 MiB');
    }
    report.warningInvocations = report.invocations.filter(call => call.warningBytes > 0).map(call => call.sequence);
    report.unexplainedWarningInvocations = report.invocations.filter(call => call.warningAssessment?.unexplained.length).map(call => call.sequence);
    report.status = packingColors ? report.cases.length === 2 && report.cases.every(item => item.status === 'packing-passed') && report.unexplainedWarningInvocations.length === 0
      ? 'completed-bounded-colored-raw-packing' : 'completed-with-qualification-gaps'
      : extractionRecheckId ? report.cases.length === 2 && report.cases.every(item => item.status === 'extraction-recheck-passed')
      ? 'completed-bounded-extraction-recheck' : 'completed-with-qualification-gaps'
      : report.cases.length === 4 && report.cases.every(item => ['media-passed', 'media-passed-with-explained-warnings'].includes(item.status)) && report.unexplainedWarningInvocations.length === 0
      ? 'completed-bounded-preserve-media-subset' : 'completed-with-qualification-gaps';
    if (!['completed-bounded-preserve-media-subset', 'completed-bounded-extraction-recheck', 'completed-bounded-colored-raw-packing'].includes(report.status)) process.exitCode = 1;
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = errorData(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop); report.finishedAt = new Date().toISOString();
    if (leaseHandle) try {
      assert.equal(children.size, 0, 'Child closure is required before releasing the media lease');
      const named = await fs.lstat(LEASE, { bigint: true }), opened = await leaseHandle.stat({ bigint: true });
      assert.ok(named.nlink === 1n && named.size <= 8192n && sameStamp(named, opened) && sameStamp(named, leaseIdentity), 'Lease identity remains owned');
      const bytes = Buffer.alloc(Number(named.size)); const read = await leaseHandle.read(bytes, 0, bytes.length, 0); assert.equal(read.bytesRead, bytes.length);
      const entry = JSON.parse(bytes); assert.equal(entry.token, id); assert.equal(entry.pid, process.pid);
      await leaseHandle.close(); leaseHandle = null;
      const after = await fs.lstat(LEASE, { bigint: true }); assert.ok(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && after.size === named.size && sameObject(after, named));
      await fs.unlink(LEASE); report.leaseReleased = true;
    } catch (error) { report.leaseRetained = error.message; report.status = 'safety-boundary-lease-retained'; process.exitCode = 1; }
    await leaseHandle?.close().catch(() => {});
    await save().catch(error => { console.error('HDR report persistence failed:', error.message); process.exitCode = 1; });
    await reportHandle?.close().catch(() => {});
    console.log(`HDR preservation qualification: ${reportHandle ? reportFile : 'no report/media started'}`);
  }
}

function pureTests() {
  for (const kind of ['pq', 'hlg']) {
    const spec = fixtureSpec(kind); assert.equal(spec.codes.length, 10);
    assert.ok(spec.codes.every((code, index) => code >= 64 && code <= 940 && (index === 0 || code >= spec.codes[index - 1])));
    for (const frame of [0, 1, 7, 31, 63, 64, 95]) {
      const bytes = numericFrame(spec, frame); assert.equal(bytes.length, FRAME_BYTES); assert.equal(frameIdentity(bytes), frame);
      assert.equal(bytes.readUInt16LE(WIDTH * HEIGHT * 2), 512);
      spec.codes.forEach((code, column) => assert.equal(blockMean(bytes, column, 40), code));
    }
  }
  assert.equal(fixtureSpec('hlg').codes.at(-1), 940);
  assert.ok(fixtureSpec('pq').codes.at(-1) < 940, 'PQ 1000 is below its 10000-nit endpoint');
  assert.throws(() => numericFrame(fixtureSpec('pq'), 96));
  console.log('HDR fixture pure checks passed; no files, media children or lease created.');
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { fixtureSpec, numericFrame, frameIdentity, validateFrameTimeline, classifyWarnings, analyzeAnnexB, pureTests, LIMITS,
  colorPackingSpec, colorPackingFrame, expectedColorPacking, validateColorPacking, COLOR_LIMITS };
