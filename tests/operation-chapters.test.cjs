'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clipChapters, CHAPTER_POLICY } = require('../src/operation-chapters.cjs');

const r = (numerator, denominator = '1') => ({ numerator: String(numerator), denominator: String(denominator) });
const chapter = (id, start, end, extra = {}) => ({ id, time_base: '1/1000', start, end, ...extra });
const NS = '1/1000000000';
const clip = (chapters, start = r(2), end = r(8), targetTimeBase = NS) => clipChapters({ chapters, interval: { absoluteStart: start, absoluteEnd: end }, targetTimeBase });
const rejects = (action, code) => assert.throws(action, error => error.code === code, code);

test('chapters inside, crossing and outside the interval are kept, clipped and rebased, or removed, and each change is listed', () => {
  const result = clip([chapter(1, 0, 1000), chapter(2, 1000, 3000, { tags: { title: 'Crosses start' } }), chapter(3, 3000, 5000),
    chapter(4, 5000, 9000), chapter(5, 9000, 10000), chapter(6, 1500, 8500)]);
  assert.equal(result.policy, CHAPTER_POLICY); assert.equal(result.timeBase, NS);
  assert.deepEqual(result.chapters.map(item => [item.sourceIndex, item.id, item.start, item.end]), [
    [1, '2', '0', '1000000000'], [2, '3', '1000000000', '3000000000'], [3, '4', '3000000000', '6000000000'], [5, '6', '0', '6000000000']]);
  assert.deepEqual(result.chapters[0].tags, { title: 'Crosses start' });
  assert.deepEqual(result.removed, [0, 4]);
  assert.deepEqual(result.clipped, [{ sourceIndex: 1, start: true, end: false }, { sourceIndex: 3, start: false, end: true }, { sourceIndex: 5, start: true, end: true }]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.chapters[0]) && Object.isFrozen(result.chapters[0].tags));
});

test('edges follow start-inclusive/end-exclusive: touching chapters are removed and point markers keep only [start, end)', () => {
  const result = clip([chapter(1, 0, 2000), chapter(2, 8000, 9000), chapter(3, 2000, 2000), chapter(4, 8000, 8000), chapter(5, 7999, 7999)]);
  assert.deepEqual(result.removed, [0, 1, 3]);
  assert.deepEqual(result.chapters.map(item => [item.id, item.start, item.end]), [['3', '0', '0'], ['5', '5999000000', '5999000000']]);
  assert.deepEqual(result.clipped, []);
});

test('rebasing is exact across time bases and nonzero origins, and refuses an edge it cannot represent rather than rounding', () => {
  const ninety = clip([{ id: 7, time_base: '1/90000', start: '900000', end: '1080000' }], r(9), r(13, 1), '1/1000');
  assert.deepEqual([ninety.chapters[0].start, ninety.chapters[0].end], ['1000', '3000']);
  // 1/3 s cannot be a whole millisecond.
  rejects(() => clip([chapter(1, 0, 5000)], r(1, 3), r(4), '1/1000'), 'CHAPTER_BOUNDARY_INEXACT');
  assert.equal(clip([chapter(1, 0, 5000)], r(1, 3), r(4), '1/3').chapters[0].end, '11');
  const big = clip([{ id: 1, time_base: '1/1000000000', start: '9007199254740993000', end: '9007199254740995000' }],
    r('9007199254740993', '1000000'), r('9007199254740995', '1000000'), NS);
  assert.deepEqual([big.chapters[0].start, big.chapters[0].end], ['0', '2000']);
});

test('malformed chapter evidence, ranges and time bases refuse with specific codes', () => {
  rejects(() => clip([chapter(1, 3000, 2000)]), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([chapter(1, 0, 1000), chapter(1, 3000, 4000)]), 'CHAPTER_ID_DUPLICATE');
  rejects(() => clip([chapter(1, 1.5, 3000)]), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([chapter(1, '1e3', 3000)]), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([{ ...chapter(1, 0, 3000), time_base: '0/1000' }]), 'CHAPTER_TIME_BASE_INVALID');
  rejects(() => clip([{ ...chapter(1, 0, 3000), time_base: '1/0' }]), 'CHAPTER_TIME_BASE_INVALID');
  rejects(() => clip([chapter(1, 0, 3000)], r(2), r(8), '1/-1'), 'CHAPTER_TIME_BASE_INVALID');
  rejects(() => clip([chapter(1, 0, 3000)], r(5), r(5)), 'CHAPTER_RANGE_INVALID');
  rejects(() => clip([chapter(1, 0, 3000)], { numerator: 2, denominator: '1' }, r(8)), 'CHAPTER_RANGE_INVALID');
  rejects(() => clip([{ ...chapter(1, 0, 3000), tags: { title: 7 } }]), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([{ ...chapter(1, 0, 3000), extra: true }]), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([chapter(1, 0, 3000)].concat(Array(16384).fill(null))), 'CHAPTER_LIMIT_EXCEEDED');
  const sparse = [chapter(1, 0, 3000)]; sparse.length = 2;
  rejects(() => clip(sparse), 'CHAPTER_EVIDENCE_INVALID');
});

test('accessors and inherited fields are refused before any getter runs', () => {
  let read = false;
  const getter = chapter(1, 0, 3000); Object.defineProperty(getter, 'end', { enumerable: true, get() { read = true; return 3000; } });
  rejects(() => clip([getter]), 'CHAPTER_EVIDENCE_INVALID');
  const list = [chapter(1, 0, 3000)]; Object.defineProperty(list, '0', { enumerable: true, get() { read = true; return chapter(1, 0, 3000); } });
  rejects(() => clip(list), 'CHAPTER_EVIDENCE_INVALID');
  const inherited = Object.create({ id: 1, time_base: '1/1000', start: 0, end: 3000 });
  rejects(() => clip([inherited]), 'CHAPTER_EVIDENCE_INVALID');
  const interval = { absoluteEnd: r(8) }; Object.defineProperty(interval, 'absoluteStart', { enumerable: true, get() { read = true; return r(2); } });
  rejects(() => clipChapters({ chapters: [], interval, targetTimeBase: NS }), 'CHAPTER_RANGE_INVALID');
  assert.equal(read, false);
  assert.deepEqual(clip([]).chapters, []);
});

test('64-bit chapter ids must arrive as digits, tags are bounded, and a "__proto__" tag stays an ordinary tag', () => {
  rejects(() => clip([chapter(8932489723489234897, 3000, 4000)]), 'CHAPTER_VALUE_INEXACT');
  assert.equal(clip([chapter('8932489723489234897', 3000, 4000)]).chapters[0].id, '8932489723489234897');
  rejects(() => clip([chapter('1', 3000, 4000), chapter('01', 5000, 6000)]), 'CHAPTER_ID_DUPLICATE');
  const tags = JSON.parse('{"__proto__":"kept","title":"T"}');
  const kept = clip([chapter(1, 3000, 4000, { tags })]).chapters[0].tags;
  assert.deepEqual(Object.keys(kept), ['__proto__', 'title']); assert.equal(Object.getPrototypeOf(kept), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(kept, '__proto__').value, 'kept');
  rejects(() => clip([chapter(1, 3000, 4000, { tags: JSON.parse('{"__proto__":{}}') })]), 'CHAPTER_EVIDENCE_INVALID');
  const many = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, 'v']));
  rejects(() => clip([chapter(1, 3000, 4000, { tags: many })]), 'CHAPTER_LIMIT_EXCEEDED');
  delete many.k256; assert.equal(Object.keys(clip([chapter(1, 3000, 4000, { tags: many })]).chapters[0].tags).length, 256);
  assert.equal(clip(Array.from({ length: 16384 }, (_, index) => chapter(index, 3000, 3000))).chapters.length, 16384);
});

test('proxies, including revoked ones, are refused with a specific code before any trap runs', () => {
  let trapped = false; const trap = { get() { trapped = true; }, ownKeys() { trapped = true; return []; } };
  rejects(() => clip(new Proxy([chapter(1, 3000, 4000)], trap)), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clip([new Proxy(chapter(1, 3000, 4000), trap)]), 'CHAPTER_EVIDENCE_INVALID');
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  rejects(() => clipChapters(revoked.proxy), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clipChapters({ chapters: [], interval: { absoluteStart: r(2), absoluteEnd: r(8) }, targetTimeBase: NS, extra: 1 }), 'CHAPTER_EVIDENCE_INVALID');
  rejects(() => clipChapters({ chapters: [], interval: { absoluteStart: r(2), absoluteEnd: r(8) } }), 'CHAPTER_EVIDENCE_INVALID');
  assert.equal(trapped, false);
});
