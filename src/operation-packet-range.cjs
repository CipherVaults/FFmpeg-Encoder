'use strict';

// Main-only, pure and not yet wired (record 47, slice Q1d). Selects whole
// copied packets of one stream for a start-inclusive/end-exclusive interval
// and reports, exactly, how far the kept packets start and end from the asked
// edges. A copied packet cannot be cut, so the edge rule is explicit:
//   'inside' keeps only packets wholly inside the interval (may start late / end early);
//   'cover'  keeps every packet that overlaps it (may start early / end late).
// Which rule the product offers is owner decision QD1; this module grants no
// range-copy support. Inputs are inert plain data; refusals carry codes.
//
// Scope: copied audio-style streams only, where every packet is a key packet.
// Presentation order alone cannot show which reference frames a video B-frame
// needs, so video selection is refused until decode-order evidence (decode
// timestamps and anchor closure) is part of the input. Codecs with decoder
// pre-roll (AAC, Opus) may also need priming before the first kept packet; the
// reported differences describe packet edges, not decoded-sample edges.
const { types } = require('node:util');

const LIMIT = 1048576;
const DIGITS = /^-?\d{1,20}$/;
const EDGES = Object.freeze(['inside', 'cover']);

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function record(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail('PACKET_RANGE_INVALID', `${label} must be a plain record.`);
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail('PACKET_RANGE_INVALID', `${label} contains an unsupported field.`);
    out[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(out, key)) throw fail('PACKET_RANGE_INVALID', `${label} is missing ${key}.`);
  return out;
}
function denseArray(value, label) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw fail('PACKET_RANGE_INVALID', `${label} must be a plain list.`);
  const length = Object.getOwnPropertyDescriptor(value, 'length').value;
  if (length > LIMIT) throw fail('PACKET_RANGE_LIMIT_EXCEEDED', `At most ${LIMIT} packets are handled.`);
  if (Reflect.ownKeys(value).length !== length + 1) throw fail('PACKET_RANGE_INVALID', `${label} must be a dense list without extra fields.`);
  const items = [];
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !Object.hasOwn(item, 'value')) throw fail('PACKET_RANGE_INVALID', `${label} must contain data values only.`);
    items.push(item.value);
  }
  return items;
}
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
function rational(n, d) { const g = gcd(n, d); return { n: n / g, d: d / g }; }
const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const cmp = (a, b) => { const left = a.n * b.d, right = b.n * a.d; return left < right ? -1 : left > right ? 1 : 0; };
const packed = value => ({ numerator: value.n.toString(), denominator: value.d.toString() });
// Display only: nearest microsecond, ties away from zero. The packed value is exact.
function microseconds(value) {
  const scaled = value.n * 1000000n, q = scaled / value.d, r = scaled % value.d;
  const twice = (r < 0n ? -r : r) * 2n;
  return Number(twice >= value.d ? q + (scaled < 0n ? -1n : 1n) : q);
}
function integer(value, label) {
  if (Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && DIGITS.test(value)) return BigInt(value);
  throw fail('PACKET_RANGE_INVALID', `${label} must be an exact integer.`);
}
function timeBase(value) {
  const match = typeof value === 'string' && /^(\d{1,20})\/(\d{1,20})$/.exec(value);
  if (!match || BigInt(match[1]) <= 0n || BigInt(match[2]) <= 0n) throw fail('PACKET_RANGE_TIME_BASE_INVALID', 'A positive "numerator/denominator" time base is required.');
  return rational(BigInt(match[1]), BigInt(match[2]));
}
function packedRational(value, label) {
  const item = record(value, ['numerator', 'denominator'], ['numerator', 'denominator'], label);
  if (typeof item.numerator !== 'string' || typeof item.denominator !== 'string' || !/^-?\d{1,40}$/.test(item.numerator)
      || !/^\d{1,40}$/.test(item.denominator) || BigInt(item.denominator) <= 0n) throw fail('PACKET_RANGE_INVALID', `${label} must be an exact packed rational.`);
  return rational(BigInt(item.numerator), BigInt(item.denominator));
}

/**
 * selectPacketRange({ packets, timeBase, interval: { absoluteStart, absoluteEnd }, edge, everyPacketKey })
 * packets: presentation-ordered { pts, duration, flags } of one stream (ffprobe ticks/flags).
 * everyPacketKey: true for audio-style streams where each packet must be independently decodable.
 */
function selectPacketRange(options) {
  const input = record(options, ['packets', 'timeBase', 'interval', 'edge', 'everyPacketKey'], ['packets', 'timeBase', 'interval', 'edge', 'everyPacketKey'], 'Packet range request');
  if (!EDGES.includes(input.edge)) throw fail('PACKET_RANGE_EDGE_INVALID', 'The edge rule must be "inside" or "cover".');
  if (typeof input.everyPacketKey !== 'boolean') throw fail('PACKET_RANGE_INVALID', 'everyPacketKey must be true or false.');
  if (!input.everyPacketKey) throw fail('PACKET_RANGE_REORDER_UNVERIFIED', 'Video-style packet ranges need decode-order evidence this module does not take; only every-key-packet streams are handled.');
  const base = timeBase(input.timeBase);
  const interval = record(input.interval, ['absoluteStart', 'absoluteEnd'], ['absoluteStart', 'absoluteEnd'], 'Packet interval');
  const start = packedRational(interval.absoluteStart, 'Interval start'), end = packedRational(interval.absoluteEnd, 'Interval end');
  if (cmp(end, start) <= 0) throw fail('PACKET_RANGE_INVALID', 'The interval must be nonempty.');
  const raw = denseArray(input.packets, 'Packets');
  const packets = raw.map((value, index) => {
    const packet = record(value, ['pts', 'duration', 'flags'], ['pts', 'duration', 'flags'], `Packet ${index}`);
    const pts = integer(packet.pts, `Packet ${index} pts`), duration = integer(packet.duration, `Packet ${index} duration`);
    if (duration <= 0n) throw fail('PACKET_RANGE_DURATION_UNKNOWN', `Packet ${index} has no positive duration.`);
    // ffprobe's positional flags: K (key), D (discard), C (corrupt), '_' when clear.
    if (typeof packet.flags !== 'string' || !/^[K_][D_][C_]?$/.test(packet.flags)) throw fail('PACKET_RANGE_INVALID', `Packet ${index} flags are not ffprobe K/D/C flags.`);
    if (packet.flags[2] === 'C') throw fail('PACKET_RANGE_CORRUPT', `Packet ${index} is marked corrupt.`);
    return { index, pts, end: pts + duration, key: packet.flags[0] === 'K', discard: packet.flags[1] === 'D' };
  });
  for (let index = 1; index < packets.length; index++) {
    if (packets[index].pts <= packets[index - 1].pts) throw fail('PACKET_RANGE_ORDER', 'Packets must be in strictly increasing presentation order.');
  }
  const time = ticks => rational(ticks * base.n, base.d);
  // Scale both edges into stream ticks once; each packet then costs two
  // integer cross-multiplications, not fresh rational reductions.
  const startTicks = rational(start.n * base.d, start.d * base.n), endTicks = rational(end.n * base.d, end.d * base.n);
  const at = (ticks, edge) => { const left = ticks * edge.d; return left < edge.n ? -1 : left > edge.n ? 1 : 0; };
  const selected = packets.filter(packet => input.edge === 'inside'
    ? at(packet.pts, startTicks) >= 0 && at(packet.end, endTicks) <= 0
    : at(packet.end, startTicks) > 0 && at(packet.pts, endTicks) < 0);
  if (!selected.length) throw fail('PACKET_RANGE_EMPTY', 'No whole packet satisfies this interval with the chosen edge rule.');
  if (selected.some(packet => packet.discard)) throw fail('PACKET_RANGE_DISCARD', 'A selected packet is marked discard; a copied range cannot carry it.');
  if (!selected[0].key || input.everyPacketKey && selected.some(packet => !packet.key)) throw fail('PACKET_RANGE_NONKEY', 'Every copied range must start on, and where required consist of, independently decodable packets.');
  for (let index = 1; index < selected.length; index++) {
    if (selected[index].pts !== selected[index - 1].end) throw fail('PACKET_RANGE_GAP', 'The selected packets are not contiguous; a gap or overlap would be copied.');
  }
  const first = selected[0], last = selected.at(-1);
  const startDifference = sub(time(first.pts), start), endDifference = sub(time(last.end), end);
  return freeze({ edge: input.edge, timeBase: `${base.n}/${base.d}`,
    firstPacket: first.index, lastPacket: last.index, packetCount: selected.length,
    kept: { startTicks: first.pts.toString(), endTicks: last.end.toString() },
    // Negative: the kept audio starts/ends before the asked edge; positive: after it.
    startDifference: packed(startDifference), endDifference: packed(endDifference),
    startDifferenceUs: microseconds(startDifference), endDifferenceUs: microseconds(endDifference) });
}

module.exports = { selectPacketRange, PACKET_EDGES: EDGES, PACKET_LIMIT: LIMIT };
