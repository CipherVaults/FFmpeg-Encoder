'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const api = require('../src/remux-evidence.cjs');
const f = require('./helpers/remux-admission-fixture.cjs');
const video = { codec_type: 'video', profile: 'High', level: 40, width: 2, height: 2, pix_fmt: 'yuv420p',
  sample_aspect_ratio: '1:1', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv' };
const slice = ({ type = 2, pps = 0, mb = 0, nal = 101 } = {}) => Buffer.concat([Buffer.from([nal]), new f.Bits().ue(mb).ue(type).ue(pps).end()]);
async function scan(target, nals, limits = {}, width = 1) {
  const sink = target.createRemuxHeaderSink(target.parseRemuxAvcc(f.avcc(), video), video, { maxBytes: 1024 * 1024, maxUnits: 100, ...limits });
  const bytes = f.annex([f.sps(), f.pps(), ...nals]);
  for (let at = 0; at < bytes.length; at += width) await sink.push(bytes.subarray(at, at + width));
  return sink.finish();
}
function variant(before, after) {
  const file = require.resolve('../src/remux-evidence.cjs'), text = fs.readFileSync(file, 'utf8');
  assert.equal(text.split(before).length, 2); const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(text.replace(before, after), file); return m.exports;
}
// Independent review bytes: log2_max_frame_num_minus4=12 makes frame_num16 bits.
// Keep these local; regressions must not depend on TEMP or ignored proof files.
const frame16 = Buffer.from('67640028ac1bb7e2223ff000100016a020202040', 'hex');
const fullPps = Buffer.from('68ce3880', 'hex');
async function scanSliceSplit(target, nal, split) {
  const config = f.avcc({ sps: [frame16], pps: [fullPps] }), bytes = f.avcNals([nal]);
  const sink = target.createRemuxHeaderSink(target.parseRemuxAvcc(config, video), video, { maxBytes: 8192, maxUnits: 32 }, 'avcc');
  await sink.push(bytes.subarray(0, split)); await sink.push(bytes.subarray(split)); return sink.finish();
}

test('original slice-prefix bytes reject unescaped000000/01/02 at every chunk split, preserving lawful escapes', async () => {
  const bad = Buffer.from('65b80000000400000d54', 'hex'), good = Buffer.from('65b8000003000400000d54', 'hex');
  for (let split = 0; split <= good.length + 4; split++)
    assert.equal((await scanSliceSplit(api, good, split)).headerSyntax.sliceHeaders, 1);
  for (const byte of [0, 1, 2]) {
    const nal = Buffer.from(bad); nal[4] = byte;
    for (let split = 0; split <= nal.length + 4; split++)
      await assert.rejects(scanSliceSplit(api, nal, split), { code: 'REMUX_H264_SLICE_ESCAPE' }, `byte=${byte}, split=${split}`);
  }
  // All four lawful escaped bytes also work at the end of the bounded prefix.
  // The last case uses the65th lookahead byte, outside the normalized64 bytes.
  for (const count of [0, 59]) for (const byte of [0, 1, 2, 3]) {
    const nal = Buffer.concat([Buffer.from([101, 188]), Buffer.alloc(count, 85), Buffer.from([0, 0, 3, byte])]);
    for (let split = 0; split <= nal.length + 4; split++)
      assert.equal((await scanSliceSplit(api, nal, split)).headerSyntax.sliceHeaders, 1);
    const truncated = nal.subarray(0, -1);
    for (let split = 0; split <= truncated.length + 4; split++)
      await assert.rejects(scanSliceSplit(api, truncated, split), { code: 'REMUX_H264_SLICE_ESCAPE' });
  }
  for (const byte of [0, 1, 2]) {
    const edge = Buffer.concat([Buffer.from([101, 188]), Buffer.alloc(59, 85), Buffer.from([0, 0, byte])]);
    for (let split = 0; split <= edge.length + 4; split++)
      await assert.rejects(scanSliceSplit(api, edge, split), { code: 'REMUX_H264_SLICE_ESCAPE' });
  }
});

test('original slice-prefix escape guards kill removal, omitted-byte and zero-history mutants', async () => {
  const guard = 'zeros !== 2 || byte > 2';
  for (const [before, after, byte] of [[guard, 'true', 0], [guard, 'zeros !== 2 || byte > 0', 1],
    [guard, 'zeros !== 2 || byte > 1', 2], ['zeros = byte === 0 ? zeros + 1 : 0;', 'zeros = 0;', 0]]) {
    const nal = Buffer.from('65b80000000400000d54', 'hex'); nal[4] = byte;
    const negative = target => assert.rejects(scanSliceSplit(target, nal, 8), { code: 'REMUX_H264_SLICE_ESCAPE' });
    await negative(api); await assert.rejects(negative(variant(before, after)), assert.AssertionError);
  }
});

test('every NAL delimiter/chunk boundary is checked and raw VCL bodies stay bounded', async () => {
  const nals = [slice(), f.sei(), slice({ nal: 65 })];
  for (const width of [1, 2, 3, 4, 7, 64, 65536]) {
    const r = await scan(api, nals, {}, width); assert.equal(r.headerSyntax.complete, true); assert.equal(r.headerSyntax.sliceHeaders, 2);
    assert.equal(r.headerSyntax.nalUnits, 5); assert.equal(r.headerSyntax.interiorDecoded, false); assert.equal(r.headerSyntax.method, 'ffmpeg-cbs-h264-v1');
  }
  const sink = api.createRemuxHeaderSink(api.parseRemuxAvcc(f.avcc(), video), video, { maxBytes: 32 * 1024 ** 2, maxUnits: 10 });
  await sink.push(f.annex([slice()])); const block = Buffer.alloc(65536, 85);
  for (let n = 0; n < 256; n++) await sink.push(block);
  assert.equal((await sink.finish()).headerSyntax.sliceHeaders, 1);
});
test('interior slice_type=12, reserved NALs, forbidden bits, PPS and first-MB violations fail specifically', async () => {
  for (const [bad, code] of [[slice({ type: 12 }), 'REMUX_H264_HEADER_SYNTAX'], [slice({ nal: 31 }), 'REMUX_H264_PARAMETER_EXTENSION'],
    [slice({ nal: 0 }), 'REMUX_H264_HEADER_SYNTAX'], [slice({ nal: 229 }), 'REMUX_H264_HEADER_SYNTAX'],
    [slice({ nal: 5 }), 'REMUX_H264_HEADER_SYNTAX'], [slice({ pps: 1 }), 'REMUX_H264_HEADER_SYNTAX'],
    [slice({ mb: 1 }), 'REMUX_H264_HEADER_SYNTAX'], [Buffer.from([101, 128]), 'REMUX_H264_HEADER_SYNTAX']])
    await assert.rejects(scan(api, [slice(), bad, slice()]), { code });
  await assert.rejects(scan(api, [], { maxUnits: 1 }), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  await assert.rejects(scan(api, [slice()], { maxBytes: 1 }), { code: 'REMUX_PROPORTIONAL_BUDGET' });
});
test('new whole-header guards kill removal mutants', async () => {
  for (const [guard, replacement, nals, limits, code] of [
    ['!(header & 128)', 'true', [slice({ nal: 229 })], {}, 'REMUX_H264_HEADER_SYNTAX'],
    ['[1, 5, 6, 7, 8, 9, 10, 11, 12].includes(type)', 'true', [slice({ nal: 31 })], {}, 'REMUX_H264_PARAMETER_EXTENSION'],
    ["[5, 7, 8].includes(type) ? (header & 96) !== 0 : ![6, 9, 10, 11, 12].includes(type) || (header & 96) === 0", 'true', [slice({ nal: 5 })], {}, 'REMUX_H264_HEADER_SYNTAX'],
    ['firstMb < picture', 'true', [slice({ mb: 1 })], {}, 'REMUX_H264_HEADER_SYNTAX'],
    ['reader.ue(9);', 'reader.ue();', [slice({ type: 12 })], {}, 'REMUX_H264_HEADER_SYNTAX'],
    ['picture !== undefined', 'true', [slice({ pps: 1 })], {}, 'REMUX_H264_HEADER_SYNTAX'],
    ['++units <= limits.maxUnits', '(++units, true)', [slice(), slice()], { maxUnits: 3 }, 'REMUX_PROPORTIONAL_BUDGET'],
    ['bytes <= limits.maxBytes', 'true', [Buffer.concat([slice(), Buffer.alloc(256, 85)])], { maxBytes: 128 }, 'REMUX_PROPORTIONAL_BUDGET'],
    ['slices > 0', 'true', [], {}, 'REMUX_H264_HEADER_SYNTAX'],
  ]) {
    const negative = target => assert.rejects(scan(target, nals, limits), error => {
      assert.equal(error.code, code);
      if (guard === 'picture !== undefined') assert.match(error.cause?.message || '', /unadmitted PPS/);
      return true;
    }); await negative(api);
    await assert.rejects(negative(variant(guard, replacement)), { code: 'ERR_ASSERTION' }, guard);
  }
});
test('filler skipped by CBS is validated completely with bounded bulk comparisons and exact trailing bits', async () => {
  const filler = Buffer.concat([Buffer.from([12]), Buffer.alloc(200000, 255), Buffer.from([128])]);
  const r = await scan(api, [slice(), filler], {}, 65536); assert.ok(r.headerSyntax.fillerBytes >= 200001);
  for (const mutate of [b => { b[120000] = 254; }, b => { b[b.length - 1] = 64; }, b => { b[b.length - 2] = 1; }]) {
    const bad = Buffer.from(filler); mutate(bad); await assert.rejects(scan(api, [slice(), bad], {}, 65536), { code: 'REMUX_H264_HEADER_SYNTAX' });
  }
  for (const [guard, mutate] of [
    ['joined.subarray(at, at + take).equals(fillerBlock.subarray(0, take))', b => { b[120000] = 254; }],
    ['end > 0 && fillerTail[end - 1] === 128 && fillerTail.subarray(0, end - 1).every(b => b === 255)', b => { b[b.length - 1] = 64; }],
  ]) {
    const bad = Buffer.from(filler); mutate(bad);
    const negative = target => assert.rejects(scan(target, [slice(), bad], {}, 65536), { code: 'REMUX_H264_HEADER_SYNTAX' });
    await negative(api); await assert.rejects(negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
});

test('original AVC lengths cannot hide empty or truncated NALs before CBS conversion', async () => {
  const run = async (target, bytes, width = 1) => {
    const sink = target.createRemuxHeaderSink(target.parseRemuxAvcc(f.avcc(), video), video,
      { maxBytes: 1024, maxUnits: 16 }, 'avcc');
    for (let at = 0; at < bytes.length; at += width) await sink.push(bytes.subarray(at, at + width));
    return sink.finish();
  };
  const good = f.avcNals([f.sps(), f.pps(), slice(), slice({ nal: 65 })]);
  for (const width of [1, 2, 3, 4, 7, 64]) assert.equal((await run(api, good, width)).headerSyntax.sliceHeaders, 2);
  const zero = Buffer.concat([good, Buffer.alloc(4), f.avcNals([slice()])]);
  const truncated = good.subarray(0, -1), prefix = Buffer.concat([good, Buffer.from([0, 0])]);
  for (const bad of [zero, truncated, prefix]) await assert.rejects(run(api, bad), { code: 'REMUX_H264_HEADER_SYNTAX' });
  for (const [guard, replacement, bytes] of [["need(length > 0 && length <= limits.maxBytes,", "if (!length) { lengthBytes = 0; continue; } need(length <= limits.maxBytes,", zero],
    ["if (framing === 'avcc') need(left === 0 && lengthBytes === 0,", "if (framing === 'avcc') need(true,", truncated]]) {
    const negative = target => assert.rejects(run(target, bytes), { code: 'REMUX_H264_HEADER_SYNTAX' });
    await negative(api); await assert.rejects(negative(variant(guard, replacement)), { code: 'ERR_ASSERTION' });
  }
});

test('raw header pass binds each packet SHA/size/order/EOF and never lets a NAL cross packets (mutants killed)', async () => {
  const packets = [f.packet(0), f.packet(1), f.packet(2)], expected = packets.map(p => ({ size: String(p.length), hash: f.hash(p) }));
  async function collect(target, payloads, rows = expected, count = rows.length) {
    const cursor = (async function* () { yield* rows; })(), captured = [];
    const sink = target.createRemuxPacketHeaderSink(target.parseRemuxAvcc(f.avcc(), video), video,
      { maxBytes: 4096, maxUnits: 32 }, cursor, count, async (index, data) => {
        assert.ok(index < count, 'No byte beyond the declared unit budget may be consumed.'); captured.push([index, data.length]);
      });
    const data = Buffer.concat(payloads); for (let at = 0; at < data.length; at += 3) await sink.push(data.subarray(at, at + 3));
    return { proof: await sink.finish(), captured };
  }
  assert.equal((await collect(api, packets)).proof.headerSyntax.sliceHeaders, 3);
  for (const payloads of [[...packets, packets[0]], packets.slice(0, -1), [packets[1], packets[0], packets[2]],
    [packets[0], packets[0], packets[2]], [packets[0], packets[1], packets[2].subarray(0, 5)]])
    await assert.rejects(collect(api, payloads), { code: 'REMUX_H264_SCAN_COVERAGE' });
  await assert.rejects(collect(api, packets, [{ size: '1.5', hash: expected[0].hash }]), { code: 'REMUX_H264_SCAN_COVERAGE' });
  for (const hash of [null, undefined, 'invalid'])
    await assert.rejects(collect(api, [packets[0]], [{ size: String(packets[0].length), hash }]), { code: 'REMUX_H264_SCAN_COVERAGE' });
  await assert.rejects(collect(api, packets, [{ size: '7', hash: expected[0].hash }, ...expected.slice(1)]), { code: 'REMUX_H264_HEADER_SYNTAX' });
  for (const [guard, replacement, payloads, rows, count, code] of [
    ["packet.hash === null || hash === packet.hash", 'true', [packets[1], packets[0], packets[2]], expected, 3, 'REMUX_H264_SCAN_COVERAGE'],
    ['!packet && count === expectedCount && (await cursor.next()).done', 'true', packets.slice(0, -1), expected, 3, 'REMUX_H264_SCAN_COVERAGE'],
    ['count < expectedCount', 'true', packets, expected, 2, 'REMUX_H264_SCAN_COVERAGE'],
    ["HASH.test(packet.hash) || limits.deferredPacketHashes === true && packet.hash === null", 'true', [packets[0]],
      [{ size: String(packets[0].length), hash: null }], 1, 'REMUX_H264_SCAN_COVERAGE'],
  ]) {
    const negative = target => assert.rejects(collect(target, payloads, rows, count), { code }); await negative(api);
    await assert.rejects(negative(variant(guard, replacement)), { code: 'ERR_ASSERTION' });
  }
});
