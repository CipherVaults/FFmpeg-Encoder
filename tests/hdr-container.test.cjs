'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectHdrContainer, HDR_CONTAINER_LIMITS } = require('../src/hdr-container.cjs');
const { syntheticContainer } = require('./hdr-container-fixture.cjs');
const opts = { frameRate: '30/1' };
function size(value, width = 1) { value = BigInt(value); while (value >= (1n << BigInt(width * 7)) - 1n) width++; let raw = value | (1n << BigInt(width * 7)); const result = Buffer.alloc(width); for (let at = width - 1; at >= 0; at--) { result[at] = Number(raw & 255n); raw >>= 8n; } return result; }
function el(id, data) { if (typeof data === 'string') data = Buffer.from(data, 'hex'); return Buffer.concat([Buffer.from(id, 'hex'), size(data.length), data]); }
function number(value, length = 8) { const result = Buffer.alloc(length); length === 8 ? result.writeDoubleBE(value) : result.writeFloatBE(value); return result; }
function uint(value, length = 4) { const result = Buffer.alloc(length); let raw = BigInt(value); for (let at = length - 1; at >= 0; at--) { result[at] = Number(raw & 255n); raw >>= 8n; } return result; }
const timestamp = () => el('2ad7b1', uint(1000000));
const duration = value => el('4489', number(value ?? 3200));
const defaultDuration = () => el('23e383', uint(33333333));
function entry(children = []) { return el('ae', Buffer.concat([el('83', '01'), el('86', Buffer.from('V_MPEGH/ISO/HEVC')), defaultDuration(), ...children])); }
const header = () => el('1a45dfa3', el('4282', Buffer.from('matroska')));
function container({ info = [timestamp(), duration()], entries = [entry()], children = [], unknownSegment = false, head = header() } = {}) {
  const body = Buffer.concat([el('1549a966', Buffer.concat(info)), el('1654ae6b', Buffer.concat(entries)), ...children]);
  return Buffer.concat([head, Buffer.from('18538067', 'hex'), unknownSegment ? Buffer.from('01ffffffffffffff', 'hex') : size(body.length), body]);
}
function refused(bytes, suffix, options = opts) { assert.throws(() => inspectHdrContainer(bytes, options), error => error.code === 'HDR_CONTAINER_' + suffix); }

test('raw nanosecond periods are exact at all three reviewed rates; fixture payload is opaque', () => {
  for (const frameRate of ['24/1', '25/1', '30/1']) {
    const bytes = syntheticContainer({ frameRate, payload: Buffer.from('1549a966ff2ad7b18101', 'hex') }); const original = Buffer.from(bytes);
    const facts = inspectHdrContainer(bytes, { frameRate });
    assert.equal(facts.defaultDurationNs, String(1000000000n / BigInt(frameRate.slice(0, -2))));
    assert.equal(facts.timestampScaleNs, '1000000'); assert.equal(facts.declaredDurationTicks, '3200');
    assert.equal(facts.trackTimeScale, '1'); assert.equal(facts.codecDelayNs, '0'); assert.equal(facts.trackOffsetNs, '0'); assert.equal(facts.trackEnabled, '1');
    assert.equal(facts.origins.defaultDurationNs.present, true); assert.equal(facts.origins.trackTimeScale.present, false);
    assert.equal(facts.origins.timestampScaleNs.path, 'Segment/Info/TimestampScale'); assert.ok(Object.isFrozen(facts.origins.timestampScaleNs)); assert.ok(Object.isFrozen(facts));
    assert.deepEqual(bytes, original); assert.throws(() => { facts.declaredDurationTicks = '1'; }, TypeError);
  }
});
test('known and file-bound unknown outer Segment sizes yield identical timing facts', () => {
  const known = inspectHdrContainer(container(), opts), unknown = inspectHdrContainer(container({ unknownSegment: true }), opts);
  for (const field of ['timestampScaleNs', 'defaultDurationNs', 'declaredDurationTicks', 'trackTimeScale', 'codecDelayNs', 'trackOffsetNs']) assert.equal(known[field], unknown[field]);
});
test('float32 duration, explicit neutral timing fields and signed zero are observed with presence', () => {
  const facts = inspectHdrContainer(container({ info: [timestamp(), el('4489', number(60000, 4))], entries: [entry([el('23314f', number(1, 4)), el('56aa', '00'), el('537f', '0000')])] }), opts);
  assert.equal(facts.declaredDurationTicks, '60000'); for (const field of ['trackTimeScale', 'codecDelayNs', 'trackOffsetNs']) assert.equal(facts.origins[field].present, true);
});
test('one-nanosecond period alias is refused despite the same rounded nominal rate', () => {
  refused(syntheticContainer({ defaultDurationNs: '33333334' }), 'TIMING'); refused(syntheticContainer({ timestampScaleNs: '1000001' }), 'TIMING');
});
test('raw FlagEnabled default/explicit one agree; disabled, unknown, duplicate and malformed flags refuse', () => {
  const absent = inspectHdrContainer(syntheticContainer(), opts), explicit = inspectHdrContainer(syntheticContainer({ trackEnabled: '1' }), opts);
  assert.equal(absent.trackEnabled, '1'); assert.equal(absent.origins.trackEnabled.present, false); assert.equal(explicit.trackEnabled, '1'); assert.equal(explicit.origins.trackEnabled.present, true);
  refused(syntheticContainer({ trackEnabled: '0' }), 'TRACK_DISABLED'); refused(syntheticContainer({ trackEnabled: '2' }), 'TRACK');
  refused(container({ entries: [entry([el('b9', '01'), el('b9', '01')])] }), 'DUPLICATE');
  refused(container({ entries: [entry([el('b9', number(1))])] }), 'TRACK');
  refused(container({ entries: [entry([el('b9', Buffer.alloc(0))])] }), 'SCALAR');
});
test('nonneutral track scale, positive/negative offset and codec delay refuse', () => {
  for (const scalar of [el('23314f', number(1.0000001)), el('56aa', '01'), el('537f', '01'), el('537f', 'ff')]) refused(container({ entries: [entry([scalar])] }), 'TIMING');
});
test('nonpositive, fractional, nonfinite and out-of-envelope header duration refuse', () => {
  for (const value of [0, -1, 3200.5, 60001, NaN, Infinity, -Infinity]) refused(container({ info: [timestamp(), duration(value)] }), Number.isFinite(value) ? 'TIMING' : 'SCALAR');
  refused(container({ info: [timestamp(), el('4489', '0000')] }), 'SCALAR');
});
test('all required explicit timing and track identity fields are required', () => {
  for (const info of [[duration()], [timestamp()]]) refused(container({ info }), 'MISSING');
  refused(container({ entries: [] }), 'MISSING');
  refused(container({ entries: [el('ae', Buffer.concat([el('83', '01'), el('86', Buffer.from('V_MPEGH/ISO/HEVC'))]))] }), 'MISSING');
  refused(container({ entries: [el('ae', defaultDuration())] }), 'MISSING');
});
test('repeated Info, Tracks, TrackEntry and every named scalar refuse', () => {
  refused(container({ children: [el('1549a966', Buffer.alloc(0))] }), 'DUPLICATE');
  refused(container({ children: [el('1654ae6b', Buffer.alloc(0))] }), 'DUPLICATE');
  refused(container({ entries: [entry(), entry()] }), 'DUPLICATE');
  for (const scalar of [timestamp(), duration()]) refused(container({ info: [timestamp(), duration(), scalar] }), 'DUPLICATE');
  for (const scalar of [defaultDuration(), el('83', '01'), el('86', Buffer.from('V_MPEGH/ISO/HEVC'))]) refused(container({ entries: [entry([scalar])] }), 'DUPLICATE');
  for (const scalar of [el('23314f', number(1)), el('56aa', '00'), el('537f', '00')]) refused(container({ entries: [entry([scalar, scalar])] }), 'DUPLICATE');
});
test('audio, non-HEVC, alternate DocType and named scalar at wrong path refuse', () => {
  refused(container({ entries: [el('ae', Buffer.concat([el('83', '02'), el('86', Buffer.from('V_MPEGH/ISO/HEVC')), defaultDuration()]))] }), 'TRACK');
  refused(container({ entries: [el('ae', Buffer.concat([el('83', '01'), el('86', Buffer.from('V_MPEG4/ISO/AVC')), defaultDuration()]))] }), 'TRACK');
  refused(container({ head: el('1a45dfa3', el('4282', Buffer.from('webm'))) }), 'STRUCTURE');
  refused(container({ children: [defaultDuration()] }), 'PLACEMENT');
});
test('known-length unknown fields are skipped without treating embedded bytes as elements', () => {
  const facts = inspectHdrContainer(container({ info: [timestamp(), duration(), el('7ba9', Buffer.from('4489847fc00000', 'hex'))], children: [el('ec', Buffer.from('18538067ff', 'hex'))] }), opts);
  assert.equal(facts.declaredDurationTicks, '3200');
});
test('unknown child sizes and non-file-bound or repeated outer Segments refuse', () => {
  refused(container({ children: [Buffer.from('1f43b675ff', 'hex')] }), 'UNKNOWN_SIZE');
  refused(Buffer.concat([container(), el('ec', Buffer.alloc(0))]), 'STRUCTURE');
  refused(Buffer.concat([container(), container().subarray(header().length)]), 'STRUCTURE');
});
test('every truncated prefix of a valid container refuses, including split variable integers', () => {
  const bytes = syntheticContainer({ payload: 'finite payload' });
  for (let length = 0; length < bytes.length; length++) assert.throws(() => inspectHdrContainer(bytes.subarray(0, length), opts), error => /^HDR_CONTAINER_/.test(error.code));
});
test('oversized lengths, zero/reserved/noncanonical IDs and invalid VINT widths refuse', () => {
  refused(Buffer.from('1a45dfa301fffffffffffffe', 'hex'), 'TRUNCATED');
  for (const bytes of ['00', 'ff80', '400180', '080000000080', '1a45dfa300']) refused(Buffer.from(bytes, 'hex'), 'VINT');
});
test('integer length, EBML header constraints and duplicate DocType refuse', () => {
  refused(container({ info: [el('2ad7b1', Buffer.alloc(9)), duration()] }), 'SCALAR');
  refused(container({ head: el('1a45dfa3', Buffer.concat([el('4282', Buffer.from('matroska')), el('42f2', '05')])) }), 'STRUCTURE');
  refused(container({ head: el('1a45dfa3', Buffer.concat([el('4282', Buffer.from('matroska')), el('4282', Buffer.from('matroska'))])) }), 'STRUCTURE');
});
test('finite input byte and parsed element budgets refuse instead of scanning without bound', () => {
  refused(Buffer.alloc(HDR_CONTAINER_LIMITS.bytes + 1), 'LIMIT');
  refused(container({ children: Array.from({ length: HDR_CONTAINER_LIMITS.elements }, () => el('ec', Buffer.alloc(0))) }), 'LIMIT');
});
test('unsupported rates, non-Buffer/shared bytes and accessor options refuse before getter execution', () => {
  const bytes = syntheticContainer(); for (const frameRate of ['30000/1001', '60/1', 30, null]) refused(bytes, 'RATE', { frameRate });
  refused(new Uint8Array(bytes), 'LIMIT'); if (typeof SharedArrayBuffer !== 'undefined') refused(Buffer.from(new SharedArrayBuffer(bytes.length)), 'LIMIT');
  const options = {}; Object.defineProperty(options, 'frameRate', { enumerable: true, get() { throw new Error('getter ran'); } }); refused(bytes, 'SHAPE', options);
  refused(bytes, 'SHAPE', { frameRate: '30/1', extra: true });
});
