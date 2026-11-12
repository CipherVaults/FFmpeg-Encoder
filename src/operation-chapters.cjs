'use strict';

// Main-only, pure and not yet wired (record 47, slice Q1d). Clips container
// chapters to one start-inclusive/end-exclusive interval and rebases them to
// the interval start, in exact rational arithmetic. It grants nothing: a range
// encode still refuses chapters until a measured path wires this module in.
// Inputs are inert plain data; every refusal carries a specific code.

const { types } = require('node:util');

const LIMIT = 16384, TAG_LIMIT = 256;
const DIGITS = /^-?\d{1,40}$/;
const POLICY = 'clip-and-rebase-start-inclusive-end-exclusive';

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
// Own enumerable data properties only: no getters, proxies-by-accessor or
// inherited fields are ever read.
// Keys are defined, never assigned, so a "__proto__" field stays an ordinary
// key (refused or kept) rather than silently changing the prototype.
function define(target, key, value) { Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true }); }
function record(value, allowed, required, label, code, maximum = 64) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail(code, `${label} must be a plain record.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > maximum) throw fail(code === 'CHAPTER_EVIDENCE_INVALID' && allowed === null ? 'CHAPTER_LIMIT_EXCEEDED' : code, `${label} has too many fields.`);
  const out = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || allowed !== null && !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail(code, `${label} contains an unsupported field.`);
    define(out, key, descriptor.value);
  }
  for (const key of required) if (!Object.hasOwn(out, key)) throw fail(code, `${label} is missing ${key}.`);
  return out;
}
function denseArray(value, label, code) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw fail(code, `${label} must be a plain list.`);
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (descriptor.value > LIMIT) throw fail('CHAPTER_LIMIT_EXCEEDED', `At most ${LIMIT} chapters are handled.`);
  const items = [];
  for (let index = 0; index < descriptor.value; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !Object.hasOwn(item, 'value')) throw fail(code, `${label} must be a dense list of data values.`);
    items.push(item.value);
  }
  if (Reflect.ownKeys(value).length !== descriptor.value + 1) throw fail(code, `${label} contains extra fields.`);
  return items;
}

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
function rational(n, d) { if (d <= 0n) throw fail('CHAPTER_TIME_BASE_INVALID', 'A positive denominator is required.'); const g = gcd(n, d); return { n: n / g, d: d / g }; }
const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const cmp = (a, b) => { const left = a.n * b.d, right = b.n * a.d; return left < right ? -1 : left > right ? 1 : 0; };
const max = (a, b) => cmp(a, b) >= 0 ? a : b, min = (a, b) => cmp(a, b) <= 0 ? a : b;
function integer(value, label, code) {
  if (Number.isSafeInteger(value)) return BigInt(value);
  // An unsafe JSON number (typical 64-bit Matroska ChapterUIDs) has already
  // lost digits; the wiring must carry the raw digits as a string instead.
  if (typeof value === 'number' && Number.isInteger(value)) throw fail('CHAPTER_VALUE_INEXACT', `${label} is beyond exact number handling; supply its digits as text.`);
  if (typeof value === 'string' && DIGITS.test(value)) return BigInt(value);
  throw fail(code, `${label} must be an exact integer.`);
}
function timeBase(value, code = 'CHAPTER_TIME_BASE_INVALID') {
  const match = typeof value === 'string' && /^(\d{1,20})\/(\d{1,20})$/.exec(value);
  if (!match || BigInt(match[1]) <= 0n || BigInt(match[2]) <= 0n) throw fail(code, 'A positive "numerator/denominator" time base is required.');
  return rational(BigInt(match[1]), BigInt(match[2]));
}
function packedRational(value, label) {
  const item = record(value, ['numerator', 'denominator'], ['numerator', 'denominator'], label, 'CHAPTER_RANGE_INVALID');
  if (typeof item.numerator !== 'string' || typeof item.denominator !== 'string' || !DIGITS.test(item.numerator) || !/^\d{1,40}$/.test(item.denominator) || BigInt(item.denominator) <= 0n) {
    throw fail('CHAPTER_RANGE_INVALID', `${label} must be an exact packed rational.`);
  }
  return rational(BigInt(item.numerator), BigInt(item.denominator));
}
// A rebased time must be a whole number of target ticks; otherwise the module
// refuses rather than rounding a chapter edge it cannot represent.
function ticks(value, base, label) {
  const scaled = rational(value.n * base.d, value.d * base.n);
  if (scaled.d !== 1n) throw fail('CHAPTER_BOUNDARY_INEXACT', `${label} is not a whole number of output chapter ticks.`);
  return scaled.n.toString();
}
function tags(value) {
  if (value === undefined) return undefined;
  const item = record(value, null, [], 'Chapter tags', 'CHAPTER_EVIDENCE_INVALID', TAG_LIMIT);
  for (const [key, text] of Object.entries(item)) {
    if (typeof text !== 'string' || key.length > 256 || text.length > 16384) throw fail('CHAPTER_EVIDENCE_INVALID', 'Chapter tags must be bounded text.');
  }
  return item;
}

/**
 * clipChapters({ chapters, interval: { absoluteStart, absoluteEnd }, targetTimeBase })
 * chapters: normalized ffprobe chapters on the same absolute timeline as the
 * interval ({ id, time_base, start, end, tags? }; start/end in its ticks).
 */
function clipChapters(options) {
  const input = record(options, ['chapters', 'interval', 'targetTimeBase'], ['chapters', 'interval', 'targetTimeBase'], 'Chapter request', 'CHAPTER_EVIDENCE_INVALID');
  const interval = record(input.interval, ['absoluteStart', 'absoluteEnd'], ['absoluteStart', 'absoluteEnd'], 'Chapter interval', 'CHAPTER_RANGE_INVALID');
  const start = packedRational(interval.absoluteStart, 'Interval start'), end = packedRational(interval.absoluteEnd, 'Interval end');
  if (cmp(end, start) <= 0) throw fail('CHAPTER_RANGE_INVALID', 'The interval must be nonempty.');
  const target = timeBase(input.targetTimeBase);
  const seen = new Set(), kept = [], removed = [], clipped = [];
  denseArray(input.chapters, 'Chapters', 'CHAPTER_EVIDENCE_INVALID').forEach((raw, sourceIndex) => {
    const chapter = record(raw, ['id', 'time_base', 'start', 'end', 'start_time', 'end_time', 'tags'], ['id', 'time_base', 'start', 'end'], `Chapter ${sourceIndex}`, 'CHAPTER_EVIDENCE_INVALID');
    const id = integer(chapter.id, `Chapter ${sourceIndex} id`, 'CHAPTER_EVIDENCE_INVALID').toString();
    if (seen.has(id)) throw fail('CHAPTER_ID_DUPLICATE', `Chapter id ${id} appears more than once.`);
    seen.add(id);
    const base = timeBase(chapter.time_base);
    const s = rational(integer(chapter.start, `Chapter ${sourceIndex} start`, 'CHAPTER_EVIDENCE_INVALID') * base.n, base.d);
    const e = rational(integer(chapter.end, `Chapter ${sourceIndex} end`, 'CHAPTER_EVIDENCE_INVALID') * base.n, base.d);
    if (cmp(e, s) < 0) throw fail('CHAPTER_EVIDENCE_INVALID', `Chapter ${sourceIndex} ends before it starts.`);
    const text = tags(chapter.tags);
    // Zero-length chapters are point markers: kept only when the point lies in [start, end).
    const inside = cmp(e, s) === 0 ? cmp(s, start) >= 0 && cmp(s, end) < 0 : cmp(e, start) > 0 && cmp(s, end) < 0;
    if (!inside) { removed.push(sourceIndex); return; }
    const from = max(s, start), to = min(e, end);
    const startClipped = cmp(from, s) !== 0, endClipped = cmp(to, e) !== 0;
    if (startClipped || endClipped) clipped.push({ sourceIndex, start: startClipped, end: endClipped });
    kept.push({ sourceIndex, id, start: ticks(sub(from, start), target, `Chapter ${sourceIndex} start`),
      end: ticks(sub(to, start), target, `Chapter ${sourceIndex} end`), ...(text ? { tags: text } : {}) });
  });
  return freeze({ policy: POLICY, timeBase: `${target.n}/${target.d}`, chapters: kept, removed, clipped });
}

module.exports = { clipChapters, CHAPTER_POLICY: POLICY, CHAPTER_LIMIT: LIMIT, CHAPTER_TAG_LIMIT: TAG_LIMIT };
