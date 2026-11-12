'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPacketRange } = require('../src/operation-packet-range.cjs');

const r = (numerator, denominator = '1') => ({ numerator: String(numerator), denominator: String(denominator) });
// AAC-style packets: 1024 samples at 48 kHz, so each lasts 21.333... ms.
function aac(count, first = 0) { return Array.from({ length: count }, (_, index) => ({ pts: first + index * 1024, duration: 1024, flags: 'K__' })); }
const select = (options = {}) => selectPacketRange({ packets: aac(200), timeBase: '1/48000', interval: { absoluteStart: r(1), absoluteEnd: r(2) },
  edge: 'inside', everyPacketKey: true, ...options });
const rejects = (action, code) => assert.throws(action, error => error.code === code, code);

test('"inside" keeps only whole packets within the interval and reports the exact late start and early end', () => {
  const result = select();
  // 48000 / 1024 = 46.875: packet 47 starts at 48128 (late), packet 92 ends at 95232 (early).
  assert.equal(result.firstPacket, 47); assert.equal(result.lastPacket, 92); assert.equal(result.packetCount, 46);
  assert.deepEqual(result.kept, { startTicks: '48128', endTicks: '95232' });
  assert.deepEqual(result.startDifference, r(1, 375)); assert.equal(result.startDifferenceUs, 2667);
  assert.deepEqual(result.endDifference, r(-2, 125)); assert.equal(result.endDifferenceUs, -16000);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.kept));
});

test('"cover" keeps every overlapping packet and reports the exact early start and late end', () => {
  const result = select({ edge: 'cover' });
  assert.equal(result.firstPacket, 46); assert.equal(result.lastPacket, 93); assert.equal(result.packetCount, 48);
  assert.deepEqual(result.kept, { startTicks: '47104', endTicks: '96256' });
  assert.equal(result.startDifferenceUs, -18667); assert.equal(result.endDifferenceUs, 5333);
  assert.ok(result.startDifferenceUs <= 0 && result.endDifferenceUs >= 0);
});

test('packet-aligned edges give zero differences under both rules, and the end stays exclusive', () => {
  const interval = { absoluteStart: r(1024, 48000), absoluteEnd: r(3072, 48000) };
  for (const edge of ['inside', 'cover']) {
    const result = select({ edge, interval });
    assert.deepEqual([result.firstPacket, result.lastPacket], [1, 2], edge);
    assert.deepEqual([result.startDifferenceUs, result.endDifferenceUs], [0, 0]);
    assert.deepEqual(result.startDifference, r(0));
  }
});

test('nonzero and negative stream timelines compare exactly with the absolute interval', () => {
  const result = select({ packets: aac(10, -2048), interval: { absoluteStart: r(-2048, 48000), absoluteEnd: r(0) } });
  assert.deepEqual([result.firstPacket, result.lastPacket, result.startDifferenceUs, result.endDifferenceUs], [0, 1, 0, 0]);
});

test('unsafe selections refuse with specific codes instead of copying a broken range', () => {
  rejects(() => select({ interval: { absoluteStart: r(1, 1000), absoluteEnd: r(2, 1000) } }), 'PACKET_RANGE_EMPTY');
  const gap = aac(200); gap.splice(60, 1);
  rejects(() => select({ packets: gap }), 'PACKET_RANGE_GAP');
  const overlap = aac(200); overlap[60].duration = 1100;
  rejects(() => select({ packets: overlap }), 'PACKET_RANGE_GAP');
  const nonkey = aac(200); nonkey[60].flags = '___';
  rejects(() => select({ packets: nonkey }), 'PACKET_RANGE_NONKEY');
  // Video-style streams are refused outright: presentation order cannot show
  // which reference frame a B-frame needs (I0 B1 B2 P3 would keep B1/B2 without P3).
  const reordered = [{ pts: 0, duration: 1, flags: 'K__' }, { pts: 1, duration: 1, flags: '___' }, { pts: 2, duration: 1, flags: '___' }, { pts: 3, duration: 1, flags: '___' }];
  rejects(() => select({ packets: reordered, timeBase: '1/30', interval: { absoluteStart: r(0), absoluteEnd: r(3, 30) }, everyPacketKey: false }), 'PACKET_RANGE_REORDER_UNVERIFIED');
  rejects(() => select({ everyPacketKey: false }), 'PACKET_RANGE_REORDER_UNVERIFIED');
  const corrupt = aac(200); corrupt[50].flags = 'K_C';
  rejects(() => select({ packets: corrupt }), 'PACKET_RANGE_CORRUPT');
  for (const flags of ['xxKxx', 'K', 'KDCX', 'k__', '']) { const odd = aac(200); odd[50].flags = flags; rejects(() => select({ packets: odd }), 'PACKET_RANGE_INVALID'); }
  assert.equal(select({ packets: aac(200).map(packet => ({ ...packet, flags: 'K_' })) }).packetCount, 46);
  rejects(() => select({ packets: new Array(1048577) }), 'PACKET_RANGE_LIMIT_EXCEEDED');
  const discard = aac(200); discard[50].flags = 'KD_';
  rejects(() => select({ packets: discard }), 'PACKET_RANGE_DISCARD');
  const order = aac(200); [order[10], order[11]] = [order[11], order[10]];
  rejects(() => select({ packets: order }), 'PACKET_RANGE_ORDER');
  const zero = aac(200); zero[5].duration = 0;
  rejects(() => select({ packets: zero }), 'PACKET_RANGE_DURATION_UNKNOWN');
  rejects(() => select({ edge: 'nearest' }), 'PACKET_RANGE_EDGE_INVALID');
  rejects(() => select({ timeBase: '0/48000' }), 'PACKET_RANGE_TIME_BASE_INVALID');
  rejects(() => select({ interval: { absoluteStart: r(2), absoluteEnd: r(1) } }), 'PACKET_RANGE_INVALID');
  rejects(() => select({ everyPacketKey: 'yes' }), 'PACKET_RANGE_INVALID');
  rejects(() => select({ packets: [{ pts: 1.5, duration: 1024, flags: 'K' }] }), 'PACKET_RANGE_INVALID');
  rejects(() => select({ packets: { length: 0 } }), 'PACKET_RANGE_INVALID');
});

test('accessors, inherited fields and sparse lists are refused before any getter runs', () => {
  let read = false;
  const getter = aac(200); Object.defineProperty(getter[3], 'pts', { enumerable: true, get() { read = true; return 3072; } });
  rejects(() => select({ packets: getter }), 'PACKET_RANGE_INVALID');
  const list = aac(200); Object.defineProperty(list, '3', { enumerable: true, get() { read = true; return { pts: 3072, duration: 1024, flags: 'K' }; } });
  rejects(() => select({ packets: list }), 'PACKET_RANGE_INVALID');
  const sparse = aac(3); sparse.length = 4;
  rejects(() => select({ packets: sparse }), 'PACKET_RANGE_INVALID');
  rejects(() => select({ packets: [Object.create({ pts: 0, duration: 1024, flags: 'K' })] }), 'PACKET_RANGE_INVALID');
  let trapped = false; const trap = { get() { trapped = true; } };
  rejects(() => select({ packets: new Proxy(aac(200), trap) }), 'PACKET_RANGE_INVALID');
  rejects(() => select({ packets: [new Proxy(aac(1)[0], trap)] }), 'PACKET_RANGE_INVALID');
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  rejects(() => selectPacketRange(revoked.proxy), 'PACKET_RANGE_INVALID');
  const symbol = aac(200); symbol[1][Symbol('x')] = 1;
  rejects(() => select({ packets: symbol }), 'PACKET_RANGE_INVALID');
  assert.equal(read, false); assert.equal(trapped, false);
});
