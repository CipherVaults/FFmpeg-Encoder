'use strict';
// Compile guard-removal variants in memory. Never rewrite a source, pin, cache
// entry or evidence receipt. Each negative must fail under its own mutant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { normalizeProbe } = require('../src/inspection.cjs');
function variant(file, before, after) {
  const target = path.resolve(__dirname, '../src', file), source = fs.readFileSync(target, 'utf8');
  assert.equal(source.split(before).length, 2, 'Mutant needs one exact guard location.');
  const compiled = new Module(target, module); compiled.filename = target; compiled.paths = Module._nodeModulePaths(path.dirname(target));
  compiled._compile(source.replace(before, after), target); return compiled.exports;
}
async function jsonNegative(api, text, maxRecords = 2, maxRecordBytes = 1024) {
  await assert.rejects(async () => { const sink = api.createRemuxJsonSink('frames', { maxRecords, maxRecordBytes, onRecord() {} });
    await sink.push(Buffer.from(text)); await sink.finish(); });
}
for (const [label, before, after, text, records, bytes] of [
  ['record-count', "++count <= maxRecords, 'Excessive native record count", "++count <= Number.MAX_SAFE_INTEGER, 'Excessive native record count", '{"frames":[{},{},{}]}', 2, 1024],
  ['record-bytes', 'tokenBytes <= maxRecordBytes', 'true', '{"frames":[{"pad":"' + 'x'.repeat(64) + '"}]}', 2, 32],
  ['record-depth', 'depth <= 64', 'true', '{"frames":[{"x":' + '['.repeat(70) + '0' + ']'.repeat(70) + '}]}', 2, 1024],
  ['duplicate-section', '!seen.has(field)', 'true', '{"frames":[],"frames":[]}', 2, 1024],
  ['complete-EOF', "syntax(state === 'end' && selected && (!onAuxRecord || seen.has('streams')))", 'syntax(true)', '{"frames":[{}]', 2, 1024],
]) test('guard-removal mutant is killed: ' + label, async () => {
  await jsonNegative(require('../src/remux-evidence.cjs'), text, records, bytes);
  const api = variant('remux-evidence.cjs', before, after);
  await assert.rejects(jsonNegative(api, text, records, bytes), { code: 'ERR_ASSERTION' });
});
test('guard-removal mutants are killed: terminated and unterminated line ceilings', async () => {
  for (const [guard, text] of [['Buffer.byteLength(line) <= maximum', 'abcdef\n'], ['Buffer.byteLength(pending) <= maximum', 'abcdef']]) {
    const negative = api => assert.rejects(api.createLineSink(() => {}, 5).push(Buffer.from(text)));
    await negative(require('../src/remux-evidence.cjs'));
    await assert.rejects(negative(variant('remux-evidence.cjs', guard, 'true')), { code: 'ERR_ASSERTION' });
  }
});
test('guard-removal mutants are killed: remux stall and absolute backstop', () => {
  const negative = (api, absolute) => {
    let now = 0; const clock = api.createRemuxProgressClock(100, 1000, () => now); clock.advance('copy', 1);
    now = absolute ? 1000 : 100; if (absolute) clock.advance('verification', 1);
    assert.equal(clock.check()?.code, absolute ? 'REMUX_PROPORTIONAL_BUDGET' : 'REMUX_STALLED');
  };
  for (const [guard, absolute] of [['now() - advancedAt >= stallMs', false], ['now() >= deadline', true]]) {
    negative(require('../src/encoder-service.cjs'), absolute);
    assert.throws(() => negative(variant('encoder-service.cjs', guard, 'false'), absolute), { code: 'ERR_ASSERTION' });
  }
});
test('guard-removal mutants are killed: output free-space and growth ceiling', () => {
  const value = { freeBytes: 25n * 1024n ** 3n + 299n, actualBytes: 100n, maxOutputBytes: 200, outputReserveBytes: 300, evidenceReserveBytes: 100 };
  const negative = (api, v) => assert.throws(() => api.requireRemuxOutputSpace(v), { code: 'REMUX_STORAGE' });
  negative(require('../src/encoder-service.cjs'), value);
  const free = variant('encoder-service.cjs', 'freeBytes < BigInt(outputReserveBytes) - actualBytes + BigInt(evidenceReserveBytes) + 25n * 1024n ** 3n', 'false');
  assert.throws(() => negative(free, value), { code: 'ERR_ASSERTION' });
  const grown = { ...value, freeBytes: 100n * 1024n ** 3n, actualBytes: 201n };
  negative(require('../src/encoder-service.cjs'), grown);
  assert.throws(() => negative(variant('encoder-service.cjs', 'actualBytes > BigInt(maxOutputBytes)', 'false'), grown), { code: 'ERR_ASSERTION' });
});
test('guard-removal mutants are killed: MOV safe addressing and proportional evidence sanity', () => {
  const movNegative = api => assert.throws(() => api.safeMovFileBytes(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  movNegative(require('../src/mov-representation.cjs'));
  assert.throws(() => movNegative(variant('mov-representation.cjs', 'value <= BigInt(Number.MAX_SAFE_INTEGER)', 'true')), { code: 'ERR_ASSERTION' });
  const probe = normalizeProbe({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', time_base: '1/1000', width: 2, height: 2, extradata_size: 50 }],
    format: { format_name: 'mov', duration: '1000000000', size: '1', nb_streams: 1, nb_programs: 0, nb_stream_groups: 0 }, programs: [], stream_groups: [], chapters: [] });
  const negative = api => assert.throws(() => api.deriveRemuxBudget(probe, '1'), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  negative(require('../src/remux-operation.cjs'));
  assert.throws(() => negative(variant('remux-operation.cjs', 'maxSpoolBytes + 1024 ** 3 <= EVIDENCE_SANITY_BYTES', 'true')), { code: 'ERR_ASSERTION' });
});

test('closed key evidence headroom and all-source proportional parameter pipes kill budget-regression mutants', () => {
  const source = normalizeProbe({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', extradata_size: 50 }],
    format: { format_name: 'mov', duration: '10800', size: String(40 * 1024 ** 3), nb_streams: 1, nb_programs: 0, nb_stream_groups: 0 }, programs: [], stream_groups: [], chapters: [] });
  const check = api => {
    const { budget: b, resources: r, executionBudgetMs } = api.deriveRemuxBudget(source, source.format.size), MiB = 1024 ** 2;
    const originalSpool = 32 * MiB + b.maxRecords * 2 * 3072 + Math.ceil(b.maxPcmBytes / MiB) * 320 + 8 * MiB;
    assert.equal(b.maxSpoolBytes, originalSpool + 384 * MiB);
    const originalPipe = b.maxSpoolBytes + b.maxPcmBytes * 2 + 16 * MiB + Math.ceil(executionBudgetMs / 100) * 2048;
    assert.equal(r.pipeBytes, originalPipe + 8 * b.maxOutputBytes + 2 * b.maxRecords * 66);
  };
  check(require('../src/remux-operation.cjs'));
  for (const [before, after] of [['32 * MiB + 384 * MiB', '32 * MiB'], ['8 * maxOutputBytes', '7 * maxOutputBytes'], ['2 * maxRecords * parameterHeaders', '1 * maxRecords * parameterHeaders']])
    assert.throws(() => check(variant('remux-operation.cjs', before, after)), { code: 'ERR_ASSERTION' });
});
test('private timeline records reject malformed counts, extents, rational data and executable accessors', () => {
  const api = require('../src/remux-evidence.cjs'), q = { numerator: '1', denominator: '1000' }, row = { units: 1, pts: q, duration: q, step: q };
  assert.equal(api.decodeRemuxTimelineRow(row).units, 1);
  for (const edit of [r => { r.units = 0; }, r => { r.units = -1; }, r => { r.units = NaN; }, r => { r.units = '1'; }, r => { r.extra = true; },
    r => { r.pts.denominator = '0'; }, r => { r.duration.numerator = '-1'; }, r => { r.step.numerator = '0'; }, r => { r.pts.numerator = '1'.repeat(41); }]) {
    const r = structuredClone(row); edit(r); assert.throws(() => api.decodeRemuxTimelineRow(r), { code: 'REMUX_EVIDENCE_CHANGED' });
  }
  let reads = 0; const hostile = { ...row }; Object.defineProperty(hostile, 'units', { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => api.decodeRemuxTimelineRow(hostile)); assert.equal(reads, 0);
  const mutant = variant('remux-evidence.cjs', 'row.units > 0', 'true'), bad = { ...row, units: 0 };
  const negative = target => assert.throws(() => target.decodeRemuxTimelineRow(bad)); negative(api);
  assert.throws(() => negative(mutant), { code: 'ERR_ASSERTION' });
});
