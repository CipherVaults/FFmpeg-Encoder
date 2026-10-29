'use strict';
// Complete-file Matroska template observer. Fixtures are synthetic EBML bytes
// built from RFC 8794/9559 rules plus a genuine native-file command from the
// real builder; no FFmpeg, device or media file is involved.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { describeNativeFileSource, buildNativeFileContract } = require('../src/native-file-contract.cjs');
const { buildNativeFileCommand } = require('../src/native-file-command.cjs');
const { nativeEncoderContribution } = require('../src/backend-adapters.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../src/provenance.cjs');
const { inspectNativeFileTemplate, observeNativeFileTemplate, isNativeFileTemplate, NATIVE_TEMPLATE_MAXIMUM_BYTES } = require('../src/native-file-template.cjs');

const DEVICE = '33333333-3333-4333-8333-333333333333';
function command(outputId = '44444444-4444-4444-8444-444444444444', createdAt = '2026-10-26T12:00:00.000Z', appVersion = '0.7.0-alpha.1') {
  const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: '11111111-1111-4111-8111-111111111111', identityRevision: 0,
    draftId: '22222222-2222-4222-8222-222222222222', draftRevision: 0, profileId: 'h264-qsv',
    settings: { preset: 'medium', mode: 'icq', quality: 25, deviceId: DEVICE }, bitDepth: 8, target: 'matroska',
    resolution: 'source', range: null, signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] };
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360', start_pts: 0, start_time: '0.000000', duration_ts: 15360, duration: '1.000000', nb_frames: '30', disposition: { default: 1 }, tags: {} }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: '4096', start_time: '0.000000', duration: '1.000000', tags: {} }, chapters: [], programs: [], stream_groups: [] };
  const applicability = describeNativeFileSource({ probe, sourceBytes: '4096', request }), contract = buildNativeFileContract({ request, applicability });
  const fragment = nativeEncoderContribution('h264-qsv', { preset: 'medium', mode: 'icq', quality: 25 }, { bitDepth: 8 });
  const generationDescription = { version: 2, kind: 'native-encoder', adapterPolicyVersion: 1, profileId: 'h264-qsv', codec: 'H264', backend: 'qsv',
    encoder: 'h264_qsv', preset: 'medium', qualityMode: 'ICQ', quality: structuredClone(fragment.settings.quality), bitDepth: 8,
    pipelineId: fragment.pipelineId, encoderArgs: [...fragment.args], settingsRole: 'requested', scope: 'native-encoder-contribution-only', appVersion, createdAt };
  const device = { id: DEVICE, backend: 'qsv', vendorId: '0x8086', adapterIndex: 0, adapterIdentity: 'adapter-0', driverVersion: 'driver-1', runtimeVersion: 'runtime-1' };
  return buildNativeFileCommand({ contract, input: 'D:\\sources\\native source.mp4', output: 'F:\\owned\\candidate.mkv', device, outputId, generationDescription });
}

// ---- Minimal EBML writer (RFC 8794) -------------------------------------------------
const table = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const x of bytes) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function size(n, width) {
  const w = width || (n < 0x7f ? 1 : n < 0x3fff ? 2 : n < 0x1fffff ? 3 : 4);
  const out = Buffer.alloc(w); let v = BigInt(n);
  for (let i = w - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  out[0] |= 1 << (8 - w); return out;
}
const UNKNOWN8 = Buffer.from('01ffffffffffffff', 'hex');
const uint = n => { const out = []; let v = BigInt(n); do { out.unshift(Number(v & 0xffn)); v >>= 8n; } while (v); return Buffer.from(out); };
const el = (id, data, opts = {}) => { data = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'); return Buffer.concat([Buffer.from(id, 'hex'), opts.unknown ? UNKNOWN8 : size(data.length, opts.width), data]); };
const DURATION = Buffer.from('4489' + '84' + '447a0000', 'hex');
const crcOf = parts => { const v = Buffer.alloc(4); v.writeUInt32LE(crc32(Buffer.concat(parts))); return el('bf', v); };
const master = (id, parts, { crc = true, ...opts } = {}) => el(id, Buffer.concat(crc ? [crcOf(parts), ...parts] : parts), opts);
const simple = (name, value, extra = []) => master('67c8', [el('45a3', name), el('4487', value), ...extra], { crc: false });

function file(cmd, overrides = {}) {
  const o = { docType: 'matroska', segmentUnknown: false, trackUid: 1, tracks: 1, frame: Buffer.from('opaque-coded-frame-bytes-0123456789'),
    reserved: null, extraTags: [], infoExtra: [], targets: [], clusterExtra: [], trailing: Buffer.alloc(0), duration: true, segmentWidth: undefined,
    trackUidBytes: null, headerExtra: [], entryExtra: [], maxIdLength: 4, entryCrc: false, ...overrides };
  const header = master('1a45dfa3', [el('4286', uint(1)), el('42f7', uint(1)), el('42f2', uint(o.maxIdLength)), el('42f3', uint(8)), el('4282', o.docType), el('4287', uint(4)), el('4285', uint(2)), ...o.headerExtra], { crc: false });
  const info = master('1549a966', [el('2ad7b1', uint(1000000)), el('4d80', 'Lavf'), el('5741', 'Lavf'), ...(o.duration ? [DURATION] : []), ...o.infoExtra]);
  const entry = n => master('ae', [el('d7', uint(n)), el('73c5', n === 1 && o.trackUidBytes ? o.trackUidBytes : uint(n === 1 ? o.trackUid : n)), el('83', uint(1)), el('86', 'V_MPEG4/ISO/AVC'), ...o.entryExtra], { crc: o.entryCrc });
  const tracks = master('1654ae6b', Array.from({ length: o.tracks }, (_, i) => entry(i + 1)));
  const reserved = o.reserved || [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, JSON.stringify(cmd.generationDescription))];
  const tags = master('1254c367', [master('7373', [master('63c0', o.targets, { crc: false }), ...reserved], { crc: false }),
    master('7373', [master('63c0', [], { crc: false }), simple('ENCODER', 'Lavf')], { crc: false }), ...o.extraTags]);
  const cluster = master('1f43b675', [el('e7', uint(0)), el('a3', o.frame), ...o.clusterExtra]);
  const segmentData = Buffer.concat([info, tracks, tags, cluster]);
  return Buffer.concat([header, o.segmentUnknown ? el('18538067', segmentData, { unknown: true }) : el('18538067', segmentData, { width: o.segmentWidth }), o.trailing]);
}
const code = expected => error => error.code === 'NATIVE_TEMPLATE_' + expected;

test('a complete bitexact native file yields an unqualified exact template with every CRC validated', () => {
  const cmd = command(), bytes = file(cmd), result = inspectNativeFileTemplate(bytes, cmd);
  assert.equal(result.kind, 'native-matroska-complete-template'); assert.equal(result.executionAuthority, 'none');
  assert.equal(result.bytes, bytes.length); assert.match(result.templateSha256, /^[a-f0-9]{64}$/); assert.notEqual(result.templateSha256, result.sha256);
  assert.equal(result.validatedCrcs, 4); assert.equal(result.masks, 6); assert.match(result.method, /native-matroska-complete-template\/v1$/);
  assert.ok(Object.isFrozen(result));
});

test('only the fresh output UUID, native-v2 createdAt and validated CRCs are normalized', () => {
  const a = command('44444444-4444-4444-8444-444444444444', '2026-10-26T12:00:00.000Z');
  const b = command('66666666-6666-4666-8666-666666666666', '2026-10-29T23:59:59.999Z');
  const ra = inspectNativeFileTemplate(file(a), a), rb = inspectNativeFileTemplate(file(b), b);
  assert.notEqual(ra.sha256, rb.sha256); assert.equal(ra.templateSha256, rb.templateSha256); assert.equal(ra.manifestSha256, rb.manifestSha256);
  // A different coded payload of identical length, with CRCs correctly recomputed, is different media.
  const rc = inspectNativeFileTemplate(file(a, { frame: Buffer.from('opaque-coded-frame-bytes-0123456788') }), a);
  assert.notEqual(rc.templateSha256, ra.templateSha256);
  // Changed user metadata, element width or layout also changes the template.
  assert.notEqual(inspectNativeFileTemplate(file(a, { extraTags: [master('7373', [master('63c0', [], { crc: false }), simple('TITLE', 'x')], { crc: false })] }), a).templateSha256, ra.templateSha256);
  assert.notEqual(inspectNativeFileTemplate(file(a, { infoExtra: [el('ec', Buffer.alloc(3))] }), a).templateSha256, ra.templateSha256);
});

test('every single-byte mutation either refuses or changes the template digest', () => {
  const cmd = command(), bytes = file(cmd), baseline = inspectNativeFileTemplate(bytes, cmd).templateSha256;
  let refused = 0, changed = 0;
  for (let i = 0; i < bytes.length; i++) for (const mask of [0x01, 0x80]) {
    const mutated = Buffer.from(bytes); mutated[i] ^= mask;
    let result; try { result = inspectNativeFileTemplate(mutated, cmd); } catch (error) { assert.match(error.code, /^NATIVE_TEMPLATE_/); refused++; continue; }
    assert.notEqual(result.templateSha256, baseline, `byte ${i} mask ${mask} produced the same template`); changed++;
  }
  assert.ok(refused > 0 && refused + changed === bytes.length * 2);
});

test('stale or forged provenance, wrong dialect and unsupported tag forms refuse', () => {
  const cmd = command(), other = command('77777777-7777-4777-8777-777777777777');
  assert.throws(() => inspectNativeFileTemplate(file(other), cmd), code('PROVENANCE'));
  const generation = JSON.stringify(cmd.generationDescription);
  const cases = [
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, generation), simple(OUTPUT_ID_KEY.toLowerCase(), cmd.outputId)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '2'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, generation)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, generation.replace('{', '{ '))] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId, [el('4485', 'x')]), simple(GENERATION_KEY, generation)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, generation, [simple('NESTED', 'x')])] }, 'PROVENANCE'],
    [{ targets: [el('63c5', uint(1))] }, 'PROVENANCE'],
    [{ extraTags: [master('7373', [master('63c0', [el('63c5', uint(9))], { crc: false }), simple('TITLE', 'x')], { crc: false })] }, 'BITEXACT'],
    [{ extraTags: [master('7373', [master('63c0', [], { crc: false }), simple('TITLE', 'x', [simple(OUTPUT_ID_KEY, cmd.outputId)])], { crc: false })] }, 'PROVENANCE'],
    [{ infoExtra: [el('73a4', Buffer.alloc(16, 7))] }, 'BITEXACT'],
    [{ trackUid: 2 }, 'BITEXACT'],
    [{ tracks: 2 }, 'STRUCTURE'],
    [{ docType: 'webm' }, 'STRUCTURE'],
    [{ trailing: Buffer.from([0xec, 0x80]) }, 'STRUCTURE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, Buffer.from([0xff, 0xfe])), simple(GENERATION_KEY, generation)] }, 'TEXT'],
  ];
  for (const [overrides, expected] of cases) assert.throws(() => inspectNativeFileTemplate(file(cmd, overrides), cmd), code(expected), JSON.stringify(Object.keys(overrides)));
  assert.throws(() => inspectNativeFileTemplate(file(cmd), { ...cmd, argv: cmd.argv.filter(a => a !== '+bitexact') }), code('COMMAND'));
  assert.throws(() => inspectNativeFileTemplate(file(cmd), { ...cmd, generationDescription: { ...cmd.generationDescription, version: 1 } }), code('COMMAND'));
});

test('CRC position, size, duplication and raw value are enforced before normalization', () => {
  const cmd = command(), good = file(cmd);
  const bad = Buffer.from(good), crcAt = bad.indexOf(Buffer.from('1549a966', 'hex')) + 4 + 1 + 2; // Info CRC payload
  bad[crcAt] ^= 0xff; assert.throws(() => inspectNativeFileTemplate(bad, cmd), code('CRC'));
  const clusterWithLateCrc = el('1f43b675', Buffer.concat([el('e7', uint(0)), crcOf([el('e7', uint(0))])]));
  const header = good.subarray(0, good.indexOf(Buffer.from('18538067', 'hex')));
  const late = Buffer.concat([header, el('18538067', Buffer.concat([master('1549a966', [el('2ad7b1', uint(1000000)), DURATION]),
    master('1654ae6b', [master('ae', [el('d7', uint(1)), el('73c5', uint(1))], { crc: false })]),
    master('1254c367', [master('7373', [master('63c0', [], { crc: false }), simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, JSON.stringify(cmd.generationDescription))], { crc: false })]),
    clusterWithLateCrc]))]);
  assert.throws(() => inspectNativeFileTemplate(late, cmd), code('CRC'));
  const doubled = file(cmd, { clusterExtra: [el('bf', Buffer.alloc(4))] });
  assert.throws(() => inspectNativeFileTemplate(doubled, cmd), code('CRC'));
});

test('unfinalized (unknown-size) output, truncation and bounds refuse', () => {
  const cmd = command();
  assert.throws(() => inspectNativeFileTemplate(file(cmd, { segmentUnknown: true }), cmd), code('UNKNOWN_SIZE'));
  assert.throws(() => inspectNativeFileTemplate(file(cmd, { duration: false }), cmd), code('STRUCTURE'));
  const good = file(cmd);
  assert.throws(() => inspectNativeFileTemplate(good.subarray(0, good.length - 3), cmd), error => /^NATIVE_TEMPLATE_(TRUNCATED|CRC|STRUCTURE)$/.test(error.code));
  const unknownCluster = file(cmd, { clusterExtra: [el('a0', Buffer.alloc(2), { unknown: true })] });
  assert.throws(() => inspectNativeFileTemplate(unknownCluster, cmd), error => /^NATIVE_TEMPLATE_(UNKNOWN_SIZE|TRUNCATED)$/.test(error.code));
  let nested = simple('DEEP', 'x'); for (let i = 0; i < 14; i++) nested = master('67c8', [el('45a3', 'D' + i), nested], { crc: false });
  assert.throws(() => inspectNativeFileTemplate(file(cmd, { extraTags: [master('7373', [master('63c0', [], { crc: false }), nested], { crc: false })] }), cmd), code('LIMIT'));
  for (const value of [Buffer.alloc(0), 'text', new Uint8Array(4)]) assert.throws(() => inspectNativeFileTemplate(value, cmd), code('LIMIT'));
  assert.equal(NATIVE_TEMPLATE_MAXIMUM_BYTES, 128 * 1024 ** 2);
});

test('cancellation and an expired deadline stop inspection', () => {
  const cmd = command(), bytes = file(cmd), controller = new AbortController(); controller.abort();
  assert.throws(() => inspectNativeFileTemplate(bytes, cmd, { signal: controller.signal }), code('CANCELLED'));
  assert.throws(() => inspectNativeFileTemplate(bytes, cmd, { deadlineAt: Date.now() - 1 }), code('DEADLINE'));
  assert.throws(() => inspectNativeFileTemplate(bytes, cmd, { signal: {} }), code('LIMIT'));
});

test('file observation binds one ordinary single-link stage within its explicit bound', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffenc-native-template-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cmd = command(), bytes = file(cmd), stage = path.join(root, 'stage.mkv'); await fs.writeFile(stage, bytes);
  const deadlineAt = Date.now() + 60000;
  const result = await observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length, deadlineAt });
  assert.equal(result.templateSha256, inspectNativeFileTemplate(bytes, cmd).templateSha256); assert.ok(isNativeFileTemplate(result));
  await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length - 1, deadlineAt }), code('FILE'));
  await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length }), code('LIMIT'));
  await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length, deadlineAt: Date.now() - 1 }), code('DEADLINE'));
  for (const maximumBytes of [undefined, 0, NATIVE_TEMPLATE_MAXIMUM_BYTES + 1, 1.5]) await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes }), code('LIMIT'));
  const link = path.join(root, 'second-name.mkv'); await fs.link(stage, link);
  await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length, deadlineAt }), code('FILE'));
  await fs.rm(link);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(observeNativeFileTemplate(stage, cmd, { maximumBytes: bytes.length, deadlineAt, signal: controller.signal }), code('CANCELLED'));
  await assert.rejects(observeNativeFileTemplate(root, cmd, { maximumBytes: bytes.length, deadlineAt }), code('FILE'));
  await assert.rejects(observeNativeFileTemplate(path.join(root, 'missing.mkv'), cmd, { maximumBytes: bytes.length, deadlineAt }), code('FILE'));
  // A stage larger than one 1 MiB read chunk, with masks after the boundary.
  const large = file(cmd, { frame: Buffer.alloc(1536 * 1024, 0x5a) }), largeStage = path.join(root, 'large.mkv'); await fs.writeFile(largeStage, large);
  assert.equal((await observeNativeFileTemplate(largeStage, cmd, { maximumBytes: large.length, deadlineAt })).templateSha256, inspectNativeFileTemplate(large, cmd).templateSha256);
});

test('the generation overlay normalizes only createdAt; every other description field stays bound', () => {
  const base = command(), changedApp = command(undefined, undefined, '0.7.0-alpha.2');
  assert.notEqual(inspectNativeFileTemplate(file(changedApp), changedApp).templateSha256, inspectNativeFileTemplate(file(base), base).templateSha256);
  // A user tag that happens to equal createdAt is never masked.
  const x = '2026-10-26T12:00:00.000Z', y = '2026-10-29T23:59:59.999Z', a = command(undefined, x), b = command(undefined, y);
  const titled = (cmd, title) => file(cmd, { extraTags: [master('7373', [master('63c0', [], { crc: false }), simple('TITLE', title)], { crc: false })] });
  assert.equal(inspectNativeFileTemplate(titled(a, x), a).templateSha256, inspectNativeFileTemplate(titled(b, x), b).templateSha256);
  assert.notEqual(inspectNativeFileTemplate(titled(a, x), a).templateSha256, inspectNativeFileTemplate(titled(b, y), b).templateSha256);
});

test('raw element widths are kept and integers are big-endian', () => {
  const cmd = command(), minimal = inspectNativeFileTemplate(file(cmd), cmd);
  const wide = inspectNativeFileTemplate(file(cmd, { segmentWidth: 8 }), cmd);
  assert.notEqual(wide.templateSha256, minimal.templateSha256);
  assert.equal(inspectNativeFileTemplate(file(cmd, { trackUidBytes: Buffer.from([0x00, 0x01]) }), cmd).kind, 'native-matroska-complete-template');
  assert.throws(() => inspectNativeFileTemplate(file(cmd, { trackUidBytes: Buffer.from([0x01, 0x00]) }), cmd), code('BITEXACT'));
});

test('header placement, declarations, nested CRCs and reserved-tag variants stay inside the dialect', () => {
  const cmd = command(), generation = JSON.stringify(cmd.generationDescription);
  const cases = [
    [{ infoExtra: [master('1a45dfa3', [el('4282', 'matroska')], { crc: false })] }, 'STRUCTURE'],
    [{ clusterExtra: [el('18538067', Buffer.alloc(2))] }, 'STRUCTURE'],
    // A single (not duplicated) unsupported declaration value.
    [{ maxIdLength: 8 }, 'STRUCTURE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId, [el('447a', 'eng')]), simple(GENERATION_KEY, generation)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId, [el('4484', uint(0))]), simple(GENERATION_KEY, generation)] }, 'PROVENANCE'],
    [{ reserved: [simple(MARKER_KEY.toLowerCase(), '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, generation)] }, 'PROVENANCE'],
    // A correctly placed, correctly valued CRC-32 in a level-2 element is outside the dialect.
    [{ entryCrc: true }, 'CRC'],
  ];
  for (const [overrides, expected] of cases) assert.throws(() => inspectNativeFileTemplate(file(cmd, overrides), cmd), code(expected), JSON.stringify(overrides).slice(0, 80));
});

test('template receipts are bound to the original command and cannot be forged by shape', () => {
  const cmd = command(), result = inspectNativeFileTemplate(file(cmd), cmd);
  assert.equal(result.outputId, cmd.outputId); assert.equal(result.argvSha256, cmd.argvSha256); assert.match(result.generationSha256, /^[a-f0-9]{64}$/);
  assert.ok(isNativeFileTemplate(result)); assert.equal(isNativeFileTemplate({ ...result }), false);
  assert.throws(() => inspectNativeFileTemplate(file(cmd), JSON.parse(JSON.stringify(cmd))), code('COMMAND'));
});
