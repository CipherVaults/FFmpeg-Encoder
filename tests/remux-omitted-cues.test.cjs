'use strict';
// Inert EBML bytes prove locators and selected-video coverage only. Audio
// samples, lacing, trimming and audio random access are not qualified here.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
const { observeNativeInventory, compareNativeInventories } = require('../src/remux-native-checks.cjs');
const { matroskaFixture, element, uint, TEST_AVCC } = require('./helpers/matroska-fixture.cjs');
const { children, segmentParts } = require('./helpers/ebml-fixture.cjs');
const { tmpdir } = require('node:os');
const u = (id, n) => element(id, uint(n));
function probe(kind = 'audio') {
  return { streams: [{ index: 0, id: '1', codec_type: 'video', codec_name: 'h264', width: 2, height: 2,
    sample_aspect_ratio: '1:1', time_base: '1/1000', disposition: { default: 1 }, tags: {},
    extradata_hash: 'SHA256:' + createHash('sha256').update(TEST_AVCC).digest('hex') },
  { index: 1, id: '2', codec_type: kind, codec_name: kind === 'audio' ? 'aac' : 'subrip',
    profile: 'LC', sample_rate: '48000', channels: 2, time_base: '1/1000', disposition: { default: 1 }, tags: {} }],
  format: { format_name: 'matroska,webm', duration: '2' }, chapters: [] };
}
function fixture({ kind = 'audio', types = [uint(2)], blocks = [{ track: 2, pts: 0 }], cues,
  points, videoFlags = 128 } = {}) {
  const p = probe(kind), { prefix, parts } = segmentParts(matroskaFixture(p));
  const native = parts.map(part => part.id !== 0x1654ae6b ? part.bytes : element(part.id, Buffer.concat(
    children(part.body).map((entry, i) => i !== 1 ? part.body.subarray(entry.at, entry.end) : element(entry.id, Buffer.concat([
      ...children(part.body, entry.body, entry.end).filter(n => n.id !== 0x83).map(n => part.body.subarray(n.at, n.end)),
      ...types.map(bytes => element(0x83, bytes)),
    ]))))));
  const before = Buffer.concat(native), clock = u(0xe7, 0), locators = []; let relative = clock.length;
  const bodies = blocks.map((block, i) => {
    const header = Buffer.alloc(4); header[0] = 128 | block.track; header.writeInt16BE(block.pts, 1);
    header[3] = block.group ? 0 : block.track === 1 ? videoFlags : 128;
    const payload = block.track === 1 ? Buffer.from([0, 0, 0, 1, 0x65]) : Buffer.from([1]);
    const raw = element(block.group ? 0xa1 : 0xa3, Buffer.concat([header, payload]));
    const bytes = block.group ? element(0xa0, Buffer.concat([raw, u(0x9b, block.duration)])) : raw;
    locators.push({ track: block.track, pts: block.pts, relative, number: i + 1, duration: block.duration });
    relative += bytes.length; return bytes;
  });
  const cluster = element(0x1f43b675, Buffer.concat([clock, ...bodies]));
  const position = (block, { relative = false, number = false, duration = false } = {}) => Buffer.concat([
    u(0xf7, block.track), u(0xf1, before.length), ...(relative ? [u(0xf0, block.relative)] : []),
    ...(number ? [u(0x5378, block.number)] : []), ...(duration ? [u(0xb2, block.duration)] : []),
  ]);
  const cuePoint = (time, positions) => element(0xbb, Buffer.concat([u(0xb3, time), ...positions.map(b => element(0xb7, b))]));
  const tables = points ? points({ locators, position, cuePoint, cluster: before.length })
    : (cues ? cues({ locators, position, cuePoint, cluster: before.length }) : cuePoint(0, [position(locators[0])]));
  const neutral = Buffer.concat([prefix, element(0x18538067, Buffer.concat([before, cluster]))]);
  const indexed = Buffer.concat([prefix, element(0x18538067, Buffer.concat([before, cluster, element(0x1c53bb6b, tables)]))]);
  return { probe: p, neutral, indexed, locators };
}
async function inspect(bytes, probe, selection = { selectedIndexes: [0] }) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'remux-cues-'));
  const file = path.join(directory, 'source.inert');
  try {
    await fs.writeFile(file, bytes, { flag: 'wx' });
    return await observeNativeInventory({ file, probe, family: 'matroska', target: 'mp4', ...selection });
  } finally {
    await fs.rm(file, { force: true });
    await fs.rmdir(directory);
  }
}
const accept = f => inspect(f.indexed, f.probe);
async function neighbourThenRefusal(good, bad, code) {
  await accept(good); await assert.rejects(accept(bad), { code: 'REMUX_NATIVE_' + code });
}
const mixed = [{ track: 1, pts: 0 }, { track: 2, pts: 0 }, { track: 1, pts: 40 }, { track: 2, pts: 40 }];
const mixedCues = ({ locators, position, cuePoint }) => Buffer.concat([0, 40].map(time =>
  cuePoint(time, locators.filter(b => b.pts === time).map(b => position(b, { relative: true, number: true })))));

test('the 176-byte neutral and 194-byte omitted AAC cue neighbours both return selected video only', async () => {
  const f = fixture(); assert.equal(f.neutral.length, 176); assert.equal(f.indexed.length, 194);
  const neutral = await inspect(f.neutral, f.probe), indexed = await accept(f);
  assert.deepEqual(neutral.randomAccess.streams, [{ index: 0, indexed: [] }]);
  assert.deepEqual(indexed.randomAccess, neutral.randomAccess);
});
test('mixed selected video and omitted audio cues retain per-video ordinals and all-track block numbers', async () => {
  const f = fixture({ blocks: mixed, cues: mixedCues });
  assert.deepEqual((await accept(f)).randomAccess.streams, [{ index: 0, indexed: [1, 2] }]);
});
test('omitted audio BlockGroup binds outer relative offset, all-track number and exact duration', async () => {
  const blocks = [{ track: 1, pts: 0 }, { track: 2, pts: 0, group: true, duration: 40 }];
  const good = fixture({ blocks, cues: ({ locators, position, cuePoint }) => cuePoint(0,
    [position(locators[1], { relative: true, number: true, duration: true })]) });
  await accept(good);
  for (const [id, value, code] of [[0xf0, good.locators[1].relative + 2, 'CUERELATIVEPOSITION'],
    [0x5378, 1, 'CUEBLOCKNUMBER'], [0xb2, 41, 'CUEDURATION']]) {
    const bad = fixture({ blocks, cues: ({ locators, position, cuePoint }) => {
      const options = { relative: id !== 0xf0, number: id !== 0x5378, duration: id !== 0xb2 };
      return cuePoint(0, [Buffer.concat([position(locators[1], options), u(id, value)])]);
    } });
    await neighbourThenRefusal(good, bad, code);
  }
});
test('selected and default-selected audio cues keep their refusal, as do omitted subtitle/data kinds', async () => {
  const good = fixture(); await accept(good);
  await assert.rejects(inspect(good.indexed, good.probe, { selectedIndexes: [0, 1] }), { code: 'REMUX_NATIVE_CUETRACK' });
  await assert.rejects(inspect(good.indexed, good.probe, {}), { code: 'REMUX_NATIVE_CUETRACK' });
  for (const kind of ['subtitle', 'data']) await neighbourThenRefusal(good, fixture({ kind }), 'CUETRACK');
});
test('omitted audio requires one actual native Type 2 scalar, accepting all widths 1 through 8', async () => {
  for (let width = 1; width <= 8; width++) {
    const bytes = Buffer.alloc(width); bytes[width - 1] = 2; await accept(fixture({ types: [bytes] }));
  }
  const good = fixture();
  for (const types of [[], [uint(2), uint(2)], [uint(17)], [uint(0)], [Buffer.alloc(0)]])
    await neighbourThenRefusal(good, fixture({ types }), 'CUETRACK');
  const wide = Buffer.alloc(9); wide[8] = 2;
  await neighbourThenRefusal(good, fixture({ types: [wide] }), 'STRUCTURE');
  await accept(good); // Restoring the only changed scalar restores admission.
});

const cases = [
  ['unknown cue track', 'CUETRACK', c => Buffer.concat([u(0xf7, 99), u(0xf1, c.cluster)])],
  ['wrong cluster', 'CUECLUSTERPOSITION', c => Buffer.concat([u(0xf7, 2), u(0xf1, c.cluster + 1)])],
  ['wrong relative offset', 'CUERELATIVEPOSITION', c => Buffer.concat([c.position(c.locators[0]), u(0xf0, c.locators[0].relative + 1)])],
  ['wrong all-track block number', 'CUEBLOCKNUMBER', c => Buffer.concat([c.position(c.locators[0]), u(0x5378, 2)])],
  ['duration without native duration', 'CUEDURATION', c => Buffer.concat([c.position(c.locators[0]), u(0xb2, 40)])],
  ['noninitial codec state', 'CUECODECSTATE', c => Buffer.concat([c.position(c.locators[0]), u(0xea, 1)])],
  ['cue reference', 'CUEREFERENCE', c => Buffer.concat([c.position(c.locators[0]), element(0xdb, Buffer.alloc(0))])],
  ['missing track', 'CUETRACKPOSITIONS', c => u(0xf1, c.cluster)],
  ['duplicate track', 'CUETRACKPOSITIONS', c => Buffer.concat([c.position(c.locators[0]), u(0xf7, 2)])],
  ['missing cluster', 'CUETRACKPOSITIONS', () => u(0xf7, 2)],
  ['duplicate cluster', 'CUETRACKPOSITIONS', c => Buffer.concat([c.position(c.locators[0]), u(0xf1, c.cluster)])],
  ['duplicate relative', 'CUERELATIVEPOSITION', c => Buffer.concat([c.position(c.locators[0]), u(0xf0, c.locators[0].relative), u(0xf0, c.locators[0].relative)])],
  ['duplicate block number', 'CUEBLOCKNUMBER', c => Buffer.concat([c.position(c.locators[0]), u(0x5378, 1), u(0x5378, 1)])],
  ['duplicate duration', 'CUEDURATION', c => Buffer.concat([c.position(c.locators[0]), u(0xb2, 40), u(0xb2, 40)])],
  ['duplicate codec state', 'CUECODECSTATE', c => Buffer.concat([c.position(c.locators[0]), u(0xea, 0), u(0xea, 0)])],
];
for (const [name, code, change] of cases) test('omitted audio still refuses ' + name + ' at its exact guard', async () => {
  const good = fixture(), bad = fixture({ cues: c => c.cuePoint(0, [change(c)]) });
  await neighbourThenRefusal(good, bad, code);
});
test('omitted cue time/position uniqueness and clock ordering remain strict', async () => {
  const good = fixture();
  const invalid = [
    ['CUETRACKPOSITIONS', fixture({ cues: c => c.cuePoint(0, [c.position(c.locators[0]), c.position(c.locators[0])]) })],
    ['CUEPOINT', fixture({ cues: c => element(0xbb, element(0xb7, c.position(c.locators[0]))) })],
    ['CUEPOINT', fixture({ cues: c => element(0xbb, Buffer.concat([u(0xb3, 0), u(0xb3, 0), element(0xb7, c.position(c.locators[0]))])) })],
    ['CUEPOINT', fixture({ cues: () => element(0xbb, u(0xb3, 0)) })],
    ['CUETIME', fixture({ cues: c => c.cuePoint(1, [c.position(c.locators[0])]) })],
    ['CUETIME', fixture({ blocks: [{ track: 2, pts: 0 }, { track: 2, pts: 0 }] })],
    ['CUETIME', fixture({ cues: c => Buffer.concat([c.cuePoint(0, [c.position(c.locators[0])]), c.cuePoint(0, [c.position(c.locators[0])])]) })],
    ['CUETIME', fixture({ blocks: [{ track: 2, pts: 0 }, { track: 2, pts: 40 }], cues: c => Buffer.concat([
      c.cuePoint(40, [c.position(c.locators[1])]), c.cuePoint(0, [c.position(c.locators[0])]),
    ]) })],
  ];
  for (const [code, bad] of invalid) await neighbourThenRefusal(good, bad, code);
});
test('selected-video lacing, coded key and discardable flags remain refused beside valid omitted cues', async () => {
  const good = fixture({ blocks: mixed, cues: mixedCues });
  for (const videoFlags of [130, 0, 129])
    await neighbourThenRefusal(good, fixture({ blocks: mixed, cues: mixedCues, videoFlags }), 'BLOCK_FLAGS');
});
test('omitted audio cues cannot substitute for mapped output video seek coverage', async () => {
  const whole = await accept(fixture({ blocks: mixed, cues: mixedCues }));
  const few = await accept(fixture({ blocks: mixed, cues: c => Buffer.concat([0, 40].map(time => c.cuePoint(time,
    c.locators.filter(b => b.pts === time && (b.track === 2 || time === 0)).map(b => c.position(b))))) }));
  const mappings = [{ inputIndex: 0, outputIndex: 0 }];
  assert.deepEqual(few.randomAccess.streams, [{ index: 0, indexed: [1] }]);
  compareNativeInventories(few, whole, mappings);
  assert.throws(() => compareNativeInventories(whole, few, mappings), { code: 'REMUX_NATIVE_SEEK_COVERAGE' });
});
