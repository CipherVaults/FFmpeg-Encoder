'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const api = require('../src/remux-evidence.cjs'), f = require('./helpers/remux-admission-fixture.cjs');
const video = { codec_type: 'video', profile: 'High', level: 40, width: 2, height: 2, pix_fmt: 'yuv420p',
  sample_aspect_ratio: '1:1', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv' };
// Copied from the independent reproductions, never read from TEMP/artifacts.
// SPS0 has1 macroblock; SPS1 has4, cropped to the SAME admitted2x2 picture.
const small = Buffer.from('67640028acedf8888ffc00040005a808080810', 'hex');
const large = Buffer.from('676400284b3b25e10843ff000100016a02020204', 'hex');
const frame8 = Buffer.from('67640028ac2edf8888ffc00040005a80808081', 'hex');
const pps0 = Buffer.from('68ce3880', 'hex'), pps1 = Buffer.from('6848e388', 'hex');
const badEscape = Buffer.from('65b80000030400000d54', 'hex'), goodEscape = Buffer.from('65b800000400000d54', 'hex');
const slice = (mb, pps) => Buffer.concat([Buffer.from([65]), new f.Bits().ue(mb).ue(2).ue(pps).put(1,4).put(1,4).put(0,1).ue(0).put(0xaa,8).end()]);
function variant(before, after) {
  const file = require.resolve('../src/remux-evidence.cjs'), text = fs.readFileSync(file, 'utf8'); assert.equal(text.split(before).length, 2);
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(text.replace(before, after), file); return m.exports;
}
async function scan(target, config, nal, width = 1) {
  const sink = target.createRemuxHeaderSink(target.parseRemuxAvcc(config, video), video, { maxBytes: 8192, maxUnits: 32 }, 'avcc');
  const bytes = f.avcNals([nal]); for (let at = 0; at < bytes.length; at += width) await sink.push(bytes.subarray(at, at + width)); return sink.finish();
}
test('slice picture bound follows PPS->SPS, including an unused larger SPS with identical visible dimensions (mutants killed)', async () => {
  const config = f.avcc({ sps: [small, large], pps: [pps0, pps1] });
  for (const width of [1, 2, 3, 7, 64]) {
    for (const [mb, pps] of [[0, 0], [0, 1], [1, 1], [3, 1]]) assert.equal((await scan(api, config, slice(mb, pps), width)).headerSyntax.sliceHeaders, 1);
    for (const [mb, pps] of [[1, 0], [3, 0], [4, 1]]) await assert.rejects(scan(api, config, slice(mb, pps), width), { code: 'REMUX_H264_HEADER_SYNTAX' });
  }
  // PPS identifiers need not equal their referenced SPS identifiers.
  const crossed = f.avcc({ sps: [small,large], pps: [f.pps(7,0), f.pps(3,1)] });
  await assert.rejects(scan(api, crossed, slice(1,7)), { code: 'REMUX_H264_HEADER_SYNTAX' });
  assert.equal((await scan(api, crossed, slice(3,3))).headerSyntax.sliceHeaders, 1);
  const negative = target => assert.rejects(scan(target, config, slice(1, 0)), { code: 'REMUX_H264_HEADER_SYNTAX' });
  for (const [guard, replacement] of [['firstMb < picture', 'true'],
    ['pictures.get(reader.ue(31))', '(reader.ue(31), Math.max(...pictures.values()))']])
    await assert.rejects(negative(variant(guard, replacement)), assert.AssertionError);
});
test('original slice-header escape 00000304 and incomplete escapes refuse before unescaping across every split (mutants killed)', async () => {
  const config = f.avcc({ sps: [frame8], pps: [pps0] });
  for (const width of [1, 2, 3, 4, 5, 7, 64]) {
    assert.equal((await scan(api, config, goodEscape, width)).headerSyntax.sliceHeaders, 1);
    await assert.rejects(scan(api, config, badEscape, width), { code: 'REMUX_H264_SLICE_ESCAPE' });
    await assert.rejects(scan(api, config, Buffer.from('65bc000003', 'hex'), width), { code: 'REMUX_H264_SLICE_ESCAPE' });
  }
  const guard = 'i + 1 < used && prefix[i + 1] <= 3';
  const negative = target => assert.rejects(scan(target, config, badEscape), { code: 'REMUX_H264_SLICE_ESCAPE' });
  await assert.rejects(negative(variant(guard, 'true')), assert.AssertionError);
  const edge = Buffer.concat([Buffer.from([101,188]), Buffer.alloc(59,85), Buffer.from([0,0,3,2])]);
  for (const width of [1, 4, 63, 64, 65]) assert.equal((await scan(api, config, edge, width)).headerSyntax.sliceHeaders, 1);
  const broken = Buffer.from(edge); broken[64] = 4;
  await assert.rejects(scan(api, config, broken), { code: 'REMUX_H264_SLICE_ESCAPE' });
  await assert.rejects(scan(api, config, edge.subarray(0,64)), { code: 'REMUX_H264_SLICE_ESCAPE' });
  await assert.rejects(scan(variant('prefix = Buffer.alloc(65)', 'prefix = Buffer.alloc(64)'), config, edge), { code: 'REMUX_H264_SLICE_ESCAPE' });
});
// Reuse the injected collector fixture, not its registered tests or any media.
function packetFixture() {
  const file = require.resolve('./remux-packet.test.cjs'), m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8').split('\ntest(')[0] + '\nmodule.exports={setup};', file); return m.exports.setup;
}
test('clean-CBS injected real collector still refuses both review headers on source/output/both with no validation authority', async t => {
  const setup = packetFixture(), originalExtra = f.extra, originalPacket = f.packet;
  try {
    for (const [config, bad, code] of [[f.avcc({ sps: [small,large], pps: [pps0,pps1] }), slice(1,0), 'REMUX_H264_HEADER_SYNTAX'],
      [f.avcc({ sps: [frame8], pps: [pps0] }), badEscape, 'REMUX_H264_SLICE_ESCAPE']]) {
      f.extra = stream => stream.codec_type === 'video' ? config : originalExtra(stream);
      const good = code === 'REMUX_H264_SLICE_ESCAPE' ? goodEscape : slice(0,0), size = Math.max(good.length, bad.length);
      // Equal payload lengths reach the contextual/header guard before the
      // independent cross-file size check; only the header differs.
      const padded = bytes => Buffer.concat([bytes, Buffer.alloc(size - bytes.length, 85)]);
      const goodPacket = f.avcNals([padded(good)]), badPacket = f.avcNals([padded(bad)]);
      f.packet = (i, key) => i === 2 ? goodPacket : originalPacket(i, key);
      for (const side of ['source', 'output', 'both']) {
        const h = await setup(t, {
          mutatePackets: (rows, actual) => { let index = 0; for (const row of rows) if (row.codec_type === 'video' && index++ === 2 && (side === 'both' || actual === side)) {
            row.size = String(badPacket.length); row.data_hash = 'SHA256:' + f.hash(badPacket);
          } },
          mutateRawPackets: (packets, call) => { if (side === 'both' || call.side === side) packets[2] = badPacket; },
        });
        const receipt = await h.collect(); assert.equal(receipt.status, 'failed'); assert.equal(receipt.failure.code, code);
        assert.throws(() => h.validate(receipt), { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' });
      }
    }
  } finally { f.extra = originalExtra; f.packet = originalPacket; }
});
