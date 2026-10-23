'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { mutateHdrAdversarialFixture, matroskaCrc32, ADVERSARIAL_FIXTURE_LIMITS } = require('../scripts/v07-hdr-content-adversarial-fixtures.cjs');
const { canonicalHevcNal, classifyHevcPackets } = require('../src/hevc-content.cjs');
const { inspectHdrContainer } = require('../src/hdr-container.cjs');
const { observeHdrInput } = require('../src/hdr-input.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { HdrOperations } = require('../src/hdr-operation.cjs');
const { contentFixture, RUNTIME } = require('./hdr-content-fixture.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function size(value) { value = BigInt(value); let width = 1; while (value >= (1n << BigInt(width * 7)) - 1n) width++;
  const bytes = Buffer.alloc(width); let encoded = value | 1n << BigInt(width * 7); for (let index = width - 1; index >= 0; index--) { bytes[index] = Number(encoded & 255n); encoded >>= 8n; } return bytes; }
function element(id, bytes) { return Buffer.concat([Buffer.from(id, 'hex'), size(bytes.length), bytes]); }
function uint(value) { value = BigInt(value); const bytes = []; do { bytes.unshift(Number(value & 255n)); value >>= 8n; } while (value); return Buffer.from(bytes); }
function master(id, bytes, crc = true) { const value = Buffer.alloc(4); value.writeUInt32LE(matroskaCrc32(bytes)); return element(id, crc ? Buffer.concat([element('bf', value), bytes]) : bytes); }
function escape(raw) { const bytes = [...raw.subarray(0, 2)]; let zeros = 0; for (const byte of raw.subarray(2)) { if (zeros >= 2 && byte <= 3) { bytes.push(3); zeros = 0; } bytes.push(byte); zeros = byte === 0 ? zeros + 1 : 0; } return Buffer.from(bytes); }
function nal(type, body) { return escape(Buffer.from([type << 1, 1, ...body])); }
function variable(value) { const bytes = []; while (value >= 255) { bytes.push(255); value -= 255; } bytes.push(value); return bytes; }
function sei(messages) { return nal(39, [...messages.flatMap(([type, bytes]) => [...variable(type), ...variable(bytes.length), ...bytes]), 128]); }
function packet(nals) { return Buffer.concat(nals.flatMap(bytes => { const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); return [length, bytes]; })); }
function sourceFixture(changes = {}) {
  const transfer = changes.transfer ?? 'smpte2084', trc = transfer === 'smpte2084' ? 16 : 18;
  const rawSps = Buffer.alloc(18, 85); rawSps[0] = 66; rawSps[1] = 1; rawSps[14] = changes.noSarPresence ? 92 : 93; rawSps[15] = 1; rawSps[17] = 128;
  // Structural canonical templates exercise precise byte provenance only.
  // No synthetic VPS/SPS/VCL here is real codec qualification media.
  const sets = [nal(32, [1, 128]), escape(rawSps), nal(34, [192])];
  const header = Buffer.alloc(22); header[0] = 1; header[1] = 2; header[12] = 93; header[13] = 240; header[15] = 252; header[16] = 253; header[17] = header[18] = 250; header[21] = 15;
  const profile = { id: 'synthetic-adversarial-' + transfer, width: 1280, height: 720, frameRate: '30/1', transfer, sampleAspectRatio: '1:1',
    hvccHeader: header.toString('base64'), parameterSets: Object.fromEntries(['vps', 'sps', 'pps'].map((name, index) => [name, canonicalHevcNal(sets[index]).toString('base64')])) };
  const optionsText = `cpuid=1111039 bitdepth=10 input-csp=1 fps=30/1 input-res=1280x720 interlace=0 sar=1 overscan=0 range=0 colorprim=9 transfer=${trc} colormatrix=9 chromaloc=1 chromaloc-top=0 chromaloc-bottom=0 display-window=0 right=0 bottom=0 cll=1200,300` + (changes.descriptionSuffix ?? '');
  const description = Buffer.concat([Buffer.from('2ca2de09b51747dbbb55a4fe7fc2fc4e', 'hex'), Buffer.from('x265 (build 217) - 4.3+45-116b875:[Windows][GCC 16.2.0][64 bit] 10bit - H.265/HEVC codec - Copyright 2013-2018 (c) Multicoreware, Inc - http://x265.org - options: ' + optionsText)]);
  const cll = Buffer.alloc(4); cll.writeUInt16BE(1200); cll.writeUInt16BE(300, 2);
  const metadata = [sei([[144, cll]]), sei([[5, description]]), ...trc === 18 ? [sei([[147, Buffer.from([18])]])] : []];
  const nals = [...sets, ...metadata], groups = new Map(); for (const bytes of nals) { const type = bytes[0] >> 1 & 63; if (!groups.has(type)) groups.set(type, []); groups.get(type).push(bytes); }
  const hvc = [header, Buffer.from([groups.size])]; for (const [type, values] of groups) { const array = Buffer.alloc(3); array[0] = type; array.writeUInt16BE(values.length, 1); hvc.push(array);
    for (const bytes of values) { const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); hvc.push(length, bytes); } }
  const extra = Buffer.concat(hvc), packets = [packet([...nals, nal(20, [160, 17, 128])]), packet([nal(1, [192, 29, 128])]), packet([...changes.earlyOnly ? [] : nals, nal(1, [192, 47, 128])])];
  const duration = Buffer.alloc(8); duration.writeDoubleBE(100);
  const info = master('1549a966', Buffer.concat([element('2ad7b1', uint(1000000)), element('4489', duration)]));
  const entry = master('ae', Buffer.concat([element('d7', uint(1)), element('73c5', uint(1)), element('83', uint(1)), element('86', Buffer.from('V_MPEGH/ISO/HEVC')),
    element('23e383', uint(33333333)), element('88', uint(0)), element('9c', uint(0)), element('63a2', extra)]));
  const cluster = master('1f43b675', Buffer.concat([element('e7', uint(0)), ...packets.map((bytes, index) => {
    const blockHeader = Buffer.from([129, 0, [0, 33, 67][index], (index ? 0 : 128) | (changes.lacing ? 2 : 0)]); return element('a3', Buffer.concat([blockHeader, bytes])); })]));
  const headerBytes = element('1a45dfa3', Buffer.concat([element('4286', uint(1)), element('42f7', uint(1)), element('42f2', uint(4)), element('42f3', uint(8)),
    element('4282', Buffer.from('matroska')), element('4287', uint(4)), element('4285', uint(2))]));
  const bytes = Buffer.concat([headerBytes, master('18538067', Buffer.concat([info, master('1654ae6b', entry), changes.nestedCluster ? master('1254c367', cluster) : cluster]))]);
  const capture = { streams: [{ index: 0, extradata: extra.toString('base64'), extradata_size: extra.length, extradata_hash: 'SHA256:' + sha(extra),
    side_data_list: [{ side_data_type: 'Content light level metadata', max_content: 1200, max_average: 300 }] }],
    packets: packets.map(data => ({ stream_index: 0, size: data.length, data: data.toString('base64'), data_hash: 'SHA256:' + sha(data) })) };
  return { bytes, capture, options: { profiles: [profile], transfer }, profile, packets, descriptionLength: description.length };
}

test('IEEE CRC32 matches the standard check vector and little-endian stored representation', () => {
  assert.equal(matroskaCrc32(Buffer.from('123456789')), 0xcbf43926); const bytes = Buffer.alloc(4); bytes.writeUInt32LE(matroskaCrc32(Buffer.from('123456789')));
  assert.equal(bytes.toString('hex'), '2639f4cb');
});

for (const [variant, transfer, expected] of [['A1', 'smpte2084', 'HEVC_CONTENT_USER_DATA'], ['A2', 'smpte2084', 'HEVC_CONTENT_USER_DATA'],
  ['A3', 'smpte2084', 'HEVC_CONTENT_NAL_UNSUPPORTED'], ['A4', 'arib-std-b67', 'HEVC_CONTENT_TRANSFER'], ['A5', 'smpte2084', 'HEVC_CONTENT_CONFIGURATION'],
  ['A6', 'smpte2084', 'HEVC_CONTENT_CONFIGURATION'], ['A7', 'smpte2084', null], ['A8', 'smpte2084', null]])
  test(`${variant} preserves complete VCL bytes/order, lengths and valid nested CRCs with its exact expected boundary`, () => {
    const s = sourceFixture({ transfer }), original = Buffer.from(s.bytes), capture = structuredClone(s.capture);
    const result = mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant, spsAspectRatioBitOffset: 120 });
    assert.deepEqual(s.bytes, original); assert.deepEqual(s.capture, capture); assert.equal(result.bytes.length, s.bytes.length); assert.notEqual(sha(result.bytes), sha(s.bytes));
    assert.equal(result.report.vcl.count, 3); assert.equal(result.report.vcl.preservedEveryByteAndOrder, true); assert.equal(result.report.packetCount, 3);
    assert.equal(result.report.crc.verifiedOriginal, 5); assert.equal(result.report.crc.verifiedOutput, 5); assert.ok(result.report.crc.repairs.length >= 2);
    assert.equal(result.report.observed.parserCode, expected); assert.equal(result.report.publicationAuthorized, false); assert.equal(result.report.qualificationGranted, false);
    assert.equal(Object.isFrozen(result.report.targets[0]), true); assert.equal(result.capture.streams[0].extradata_size, s.capture.streams[0].extradata_size);
    assert.deepEqual(result.capture.packets.map(row => row.size), s.capture.packets.map(row => row.size));
    if (['A1', 'A2', 'A3', 'A4', 'A5'].includes(variant)) assert.equal(result.report.targets[0].precedingVclCount, 2);
    if (variant === 'A5') { assert.equal(result.report.targets[0].canonicalBitOffset, 112); assert.equal(result.report.targets[0].oldValue, 93); assert.equal(result.report.targets[0].newValue, 120); }
    if (variant === 'A6') assert.equal(result.report.targets.length, 3, 'Every hvcC/packet SPS occurrence changes without touching coded pictures.');
    if (variant === 'A7') { const parsed = classifyHevcPackets(result.capture, s.options); assert.deepEqual(parsed.metadata.contentLight, { max_content: 0, max_average: 0 }); assert.deepEqual(result.report.expected.ownerCodes, ['HDR_ZERO_CLL_WRITER_UNQUALIFIED']); }
    if (variant === 'A8') { assert.equal(result.report.observed.containerCode, 'HDR_CONTAINER_TRACK_DISABLED'); assert.throws(() => inspectHdrContainer(result.bytes, { frameRate: '30/1' }), { code: 'HDR_CONTAINER_TRACK_DISABLED' }); }
    else assert.deepEqual(result.report.beforeTiming, result.report.afterTiming);
  });

test('early-only source cannot substantiate a late variant; explicitly bounded early mode is labelled with zero preceding VCL', () => {
  const s = sourceFixture({ earlyOnly: true });
  for (const variant of ['A1', 'A2', 'A3', 'A5']) {
    assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant }), { code: 'HDR_ADVERSARIAL_NOT_LATE' });
    const result = mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant, requireLate: false }); assert.equal(result.report.targets[0].precedingVclCount, 0);
  }
});

test('binding requires exact CodecPrivate and every block packet in captured order, even for equivalent hashes/counts', () => {
  const s = sourceFixture();
  for (const change of [capture => { [capture.packets[1], capture.packets[2]] = [capture.packets[2], capture.packets[1]]; },
    capture => { const bytes = Buffer.from(capture.packets[1].data, 'base64'); bytes[bytes.length - 2] ^= 1; capture.packets[1].data = bytes.toString('base64'); capture.packets[1].data_hash = 'SHA256:' + sha(bytes); },
    capture => { capture.packets.pop(); }, capture => { const bytes = Buffer.from(capture.streams[0].extradata, 'base64'), at = bytes.indexOf(Buffer.from('cpuid=1111039'));
      assert.ok(at > 0); bytes[at + 12] = 56; Object.assign(capture.streams[0], { extradata: bytes.toString('base64'), extradata_hash: 'SHA256:' + sha(bytes) }); }]) {
    const capture = structuredClone(s.capture); change(capture);
    assert.throws(() => mutateHdrAdversarialFixture(s.bytes, capture, { ...s.options, variant: 'A1' }), { code: 'HDR_ADVERSARIAL_BINDING' });
  }
});

test('preexisting CRC damage, lacing, malformed lengths and unsupported SPS offsets refuse without mutation', () => {
  const s = sourceFixture(), damaged = Buffer.from(s.bytes); damaged[damaged.length - 3] ^= 1;
  assert.throws(() => mutateHdrAdversarialFixture(damaged, s.capture, { ...s.options, variant: 'A1' }), { code: 'HDR_ADVERSARIAL_CRC' });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes.subarray(0, -1), s.capture, { ...s.options, variant: 'A1' }), { code: 'HDR_CONTAINER_TRUNCATED' });
  const laced = sourceFixture({ lacing: true }); assert.throws(() => mutateHdrAdversarialFixture(laced.bytes, laced.capture, { ...laced.options, variant: 'A1' }), { code: 'HDR_ADVERSARIAL_LACING' });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A6' }), { code: 'HDR_ADVERSARIAL_UNSUPPORTED' });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A6', spsAspectRatioBitOffset: 121 }), { code: 'HDR_ADVERSARIAL_UNSUPPORTED' });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A5', newLevelIdc: 119 }), { code: 'HDR_ADVERSARIAL_UNSUPPORTED' });
});

test('A7 refuses a payload-size255 boundary when compensation would alter complete hvcC/packet lengths', () => {
  let s;
  for (const extra of ['', ' log-level=1', ' log-level=10']) for (let pools = 1; pools <= 64; pools++) {
    const candidate = sourceFixture({ descriptionSuffix: extra + ' numa-pools=' + Array(pools).fill('1').join(',') });
    if (candidate.descriptionLength % 255 === 0) { s = candidate; break; }
  }
  assert.ok(s, 'A meaningful recognized description exactly reaches a255-byte size-field boundary.');
  assert.equal(classifyHevcPackets(s.capture, s.options).packetCount, 3);
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A7' }), { code: 'HDR_ADVERSARIAL_LENGTH' });
});

test('known master recursion cannot treat a Cluster nested under Tags as source packet membership', () => {
  const s = sourceFixture({ nestedCluster: true }); assert.equal(classifyHevcPackets(s.capture, s.options).packetCount, 3);
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A1' }), { code: 'HDR_ADVERSARIAL_PACKET' });
});

test('the parent-supplied A6 trace offset must also establish its preceding presence bit', () => {
  const s = sourceFixture({ noSarPresence: true }); assert.equal(classifyHevcPackets(s.capture, s.options).configuration.sampleAspectRatio, '1:1');
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A6', spsAspectRatioBitOffset: 120 }), { code: 'HDR_ADVERSARIAL_UNSUPPORTED' });
});

test('bounded source and inert option schemas cannot invoke accessors or expand the family', () => {
  const s = sourceFixture(); let invoked = false; const options = { ...s.options, variant: 'A1' }; Object.defineProperty(options, 'profiles', { enumerable: true, get() { invoked = true; return s.options.profiles; } });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, options), { code: 'HDR_ADVERSARIAL_OPTIONS' }); assert.equal(invoked, false);
  assert.throws(() => mutateHdrAdversarialFixture(Buffer.alloc(ADVERSARIAL_FIXTURE_LIMITS.sourceBytes + 1), s.capture, { ...s.options, variant: 'A1' }), { code: 'HDR_ADVERSARIAL_LIMIT' });
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A9' }), { code: 'HDR_ADVERSARIAL_OPTIONS' });
});

test('a data-valued variant object cannot execute its string coercion hook during option validation', () => {
  const s = sourceFixture(); let coerced = false;
  const variant = { toString() { coerced = true; s.bytes.fill(0); throw new Error('Variant coercion must never run.'); } }, before = sha(s.bytes);
  assert.throws(() => mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant }), { code: 'HDR_ADVERSARIAL_OPTIONS' });
  assert.equal(coerced, false); assert.equal(sha(s.bytes), before);
});

test('A7 retained zero type144 and recognized modified description reach the real owner guard through a genuine observation receipt', async t => {
  const s = sourceFixture(), result = mutateHdrAdversarialFixture(s.bytes, s.capture, { ...s.options, variant: 'A7', requireLate: false });
  const h = await contentFixture(t, { count: 3, metadata: 'light', lightLevels: [0, 0] }); await fs.writeFile(h.sourcePath, result.bytes);
  const identity = await readSourceIdentity(h.sourcePath), probe = structuredClone(h.probe), video = probe.streams[0];
  Object.assign(video, { extradata_size: result.capture.streams[0].extradata_size, extradata_hash: result.capture.streams[0].extradata_hash }); probe.format.size = String(result.bytes.length);
  video.side_data_list = structuredClone(result.capture.streams[0].side_data_list);
  const capture = structuredClone(result.capture); capture.streams = [{ ...structuredClone(video), ...capture.streams[0] }]; let children = 0;
  async function run(_executable, args, options) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); options.onChild(child); children++;
    const payload = args.includes('-show_packets') ? capture : { frames: structuredClone(h.frames) }, bytes = Buffer.from(JSON.stringify(payload));
    await options.onStdoutChunk(bytes); child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', 0, null);
    return { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { streamed: true, totalBytes: bytes.length, truncated: false }, stderrCapture: { totalBytes: 0, truncated: false } };
  }
  const receipt = await observeHdrInput({ sourcePath: h.sourcePath, sourceIdentity: identity, probe, runtimeIdentity: RUNTIME, profiles: s.options.profiles,
    ffprobe: path.join(h.directory, 'mock-only-ffprobe.exe'), run });
  const owner = new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-adversarial-owner', policies: [{ ...h.policy, profiles: s.options.profiles, outputProfiles: s.options.profiles }] });
  const inspection = structuredClone(h.inspection); inspection.probe = probe;
  assert.equal(children, 2); assert.deepEqual(receipt.metadata.contentLight, { max_content: 0, max_average: 0 });
  assert.throws(() => owner.prepare(h.prepared({ sourceIdentity: identity, sourceFileSha256: sha(result.bytes), inspection, inputReceipt: receipt })), { code: 'HDR_ZERO_CLL_WRITER_UNQUALIFIED' });
});
