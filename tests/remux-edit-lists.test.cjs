'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runTool } = require('../src/process-runner.cjs');
const { ffmpeg } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
const { observeRemuxEditLists } = require('../src/remux-edit-lists.cjs');
const { atom, timedFixture, writeFixture } = require('./helpers/mov-fixture.cjs');
const q = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
const tracks = [{ id: 1, scale: 90000, pts: [132000, 135000], durations: [3000, 3000] },
  { id: 2, scale: 48000, pts: [69376, 70400], durations: [1024, 1024] }];
const intervals = tracks.map((t, i) => ({ outputIndex: i, firstPts: q(t.pts[0], t.scale), visibleStart: q(t.pts[0], t.scale),
  endPts: q(t.pts.at(-1) + t.durations.at(-1), t.scale), packetCount: String(t.pts.length) }));
const probe = { streams: [{ index: 0, id: '0x1', codec_type: 'video', codec_name: 'h264', width: 2, height: 2 }, { index: 1, id: '0x2', codec_type: 'audio', codec_name: 'aac' }] };
// Rebuild parent sizes as well: entry-count mutants remain valid native atoms.
function transform(bytes, type, occurrence, change) {
  let seen = 0;
  function visit(b) {
    const out = [];
    for (let at = 0; at < b.length;) {
      const size = b.readUInt32BE(at), name = b.toString('ascii', at + 4, at + 8); let body = Buffer.from(b.subarray(at + 8, at + size));
      if (name === type && seen++ === occurrence) body = change(body);
      else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(name)) body = visit(body);
      out.push(atom(name, body)); at += size;
    } return Buffer.concat(out);
  }
  return visit(bytes);
}
async function inspect(t, bytes = timedFixture(tracks, { movieScale: 90000 }), options = {}) {
  return observeRemuxEditLists({ fileReceipt: await writeFixture(t, bytes), outputProbe: probe, intervals, maxRecords: 100, exact: true, ...options });
}

test('native MP4/MOV edits preserve exact source offsets, media starts, unity rates and spans', async t => {
  const r = await inspect(t); assert.equal(r.complete, true);
  assert.deepEqual(r.tracks.map(t => t.entries.map(e => [e.duration, e.mediaTime])),
    [[['132000', '-1'], ['6000', '0']], [['130080', '-1'], ['3840', '0']]]);
  assert.ok(r.metadataBytesRead < 4096);
});

test('native-file edit mutants refuse video/audio rate2, fractions, added/removed/reordered edits and one movie tick', async t => {
  const original = timedFixture(tracks, { movieScale: 90000 });
  const cases = [
    ['video rate 0x00020000', 0, b => { b.writeUInt32BE(0x00020000, 28); return b; }, 'REMUX_EDIT_RATE_UNSUPPORTED'],
    ['audio rate 0x00020000', 1, b => { b.writeUInt32BE(0x00020000, 28); return b; }, 'REMUX_EDIT_RATE_UNSUPPORTED'],
    ['nonzero rate fraction', 0, b => { b.writeUInt16BE(1, 30); return b; }, 'REMUX_EDIT_RATE_UNSUPPORTED'],
    ['extra edit entry', 0, b => { b.writeUInt32BE(3, 4); return Buffer.concat([b, b.subarray(20, 32)]); }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['removed empty entry', 0, b => { b.writeUInt32BE(1, 4); return Buffer.concat([b.subarray(0, 8), b.subarray(20)]); }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['removed media entry', 0, b => { b.writeUInt32BE(1, 4); return b.subarray(0, 20); }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['reordered edit entries', 0, b => Buffer.concat([b.subarray(0, 8), b.subarray(20), b.subarray(8, 20)]), 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['span plus exactly one movie tick', 0, b => { b.writeUInt32BE(b.readUInt32BE(20) + 1, 20); return b; }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['span minus exactly one movie tick', 0, b => { b.writeUInt32BE(b.readUInt32BE(20) - 1, 20); return b; }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['empty offset plus one tick', 0, b => { b.writeUInt32BE(b.readUInt32BE(8) + 1, 8); return b; }, 'REMUX_EDIT_LIST_UNEXPECTED'],
    ['media time plus one tick', 0, b => { b.writeInt32BE(1, 24); return b; }, 'REMUX_EDIT_LIST_UNEXPECTED'],
  ];
  for (const [name, track, change, code] of cases) await t.test(name, async t => {
    await assert.rejects(inspect(t, transform(original, 'elst', track, change)), { code });
  });
});

test('native versions 0/1 describe the same exact edits', async t => {
  const b = timedFixture(tracks, { movieScale: 90000 });
  let wide = b;
  for (let i = 0; i < 2; i++) wide = transform(wide, 'elst', i, body => {
    const result = Buffer.alloc(8 + 20 * body.readUInt32BE(4)); body.copy(result, 0, 0, 8); result[0] = 1;
    for (let j = 0; j < body.readUInt32BE(4); j++) {
      result.writeBigUInt64BE(BigInt(body.readUInt32BE(8 + j * 12)), 8 + j * 20);
      result.writeBigInt64BE(BigInt(body.readInt32BE(12 + j * 12)), 16 + j * 20); body.copy(result, 24 + j * 20, 16 + j * 12, 20 + j * 12);
    } return result;
  });
  assert.deepEqual((await inspect(t, wide)).tracks, (await inspect(t, b)).tracks);
});

test('native metadata guards reject missing/malformed clocks, IDs, tables, sealed identity and cancellation', async t => {
  const original = timedFixture(tracks, { movieScale: 90000 });
  for (const [type, edit, code] of [
    ['mvhd', b => { b.writeUInt32BE(0, 12); return b; }],
    ['tkhd', b => { b[0] = 1; return b.subarray(0, 32); }, 'REMUX_NATIVE_TKHD_HEADER'],
    ['tkhd', b => { b.writeUInt32BE(3, 12); return b; }],
    ['mdhd', b => { b.writeUInt32BE(0, 12); return b; }],
    ['stsz', b => { b.writeUInt32BE(101, 8); return b; }],
    ['stts', b => { b.writeUInt32BE(0, 12); return b; }],
    ['stts', b => { b.writeUInt32BE(3, 8); return b; }],
    ['ctts', b => { b[0] = 2; return b; }],
    ['edts', () => Buffer.alloc(0)],
  ]) await assert.rejects(inspect(t, transform(original, type, 0, edit)), { code: code || (type === 'edts' ? 'REMUX_EDIT_LIST_UNEXPECTED' : type === 'stsz' ? 'REMUX_SAMPLE_TABLE_UNVERIFIED' : 'REMUX_EDIT_LIST_UNVERIFIED') });
  await assert.rejects(inspect(t, original, { outputProbe: { streams: [{ index: 0 }, { index: 1, id: '2' }] } }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  await assert.rejects(inspect(t, original, { outputProbe: { streams: [{ index: 0, id: '1' }, { index: 1, id: '1' }] } }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  await assert.rejects(inspect(t, original, { intervals: [] }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  await assert.rejects(inspect(t, original, { maxRecords: Number.MAX_SAFE_INTEGER }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  const fileReceipt = await writeFixture(t, original); await fs.appendFile(fileReceipt.path, 'changed');
  await assert.rejects(observeRemuxEditLists({ fileReceipt, outputProbe: probe, intervals, maxRecords: 100 }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspect(t, original, { signal: controller.signal }), { code: 'CANCELLED' });
  const changed = structuredClone(intervals); changed[0].visibleStart = q(132000 * 2 + 1, 180000);
  await assert.rejects(inspect(t, original, { intervals: changed }), { code: 'REMUX_EDIT_LIST_UNEXPECTED' });
});

test('pinned muxer rounding is ceil(span), floor(positive delay), with exact media time', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-edit-round-'));
  t.after(async () => { assert.equal(path.dirname(dir), os.tmpdir()); assert.match(path.basename(dir), /^remux-edit-round-/); await fs.rm(dir, { recursive: true }); });
  for (const [frames, start] of [[1, 0], [2, 0], [4, 0], [5, 0], [7, 0], [1, 3000], [1, 6000], [1, 135]]) {
    const file = path.join(dir, frames + '-' + start + '.mp4');
    await runTool(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=32x32:r=30',
      '-frames:v', String(frames), '-c:v', 'libx264', '-threads', '1', '-bf', '0', '-output_ts_offset', String(start / 90000),
      '-video_track_timescale', '90000', '-use_editlist', '1', '-f', 'mp4', file]);
    const bytes = await fs.readFile(file), fileReceipt = await writeFixture(t, bytes);
    const r = await observeRemuxEditLists({ fileReceipt, outputProbe: { streams: [{ ...probe.streams[0], width: 32, height: 32 }] }, maxRecords: 100,
      intervals: [{ outputIndex: 0, firstPts: q(start, 90000), visibleStart: q(start, 90000), endPts: q(start + frames * 3000, 90000), packetCount: String(frames) }] });
    const entries = r.tracks[0].entries; assert.equal(r.tracks[0].movieScale, '1000');
    assert.equal(entries.at(-1).duration, String(Math.ceil(frames * 1000 / 30)));
    if (start) assert.equal(entries[0].duration, String(Math.floor(start * 1000 / 90000)));
    // Off by one is refused even for a genuinely fractional expected span.
    const bad = transform(bytes, 'elst', 0, b => { const at = 8 + (b.readUInt32BE(4) - 1) * 12; b.writeUInt32BE(b.readUInt32BE(at) + 1, at); return b; });
    await assert.rejects(observeRemuxEditLists({ fileReceipt: await writeFixture(t, bad), outputProbe: { streams: [{ ...probe.streams[0], width: 32, height: 32 }] }, maxRecords: 100,
      intervals: [{ outputIndex: 0, firstPts: q(start, 90000), visibleStart: q(start, 90000), endPts: q(start + frames * 3000, 90000) }] }), { code: 'REMUX_EDIT_LIST_UNEXPECTED' });
  }
});
