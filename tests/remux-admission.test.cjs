'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const evidence = require('../src/remux-evidence.cjs');
const f = require('./helpers/remux-admission-fixture.cjs');
const video = { codec_type: 'video', profile: 'High', level: 40, width: 2, height: 2, pix_fmt: 'yuv420p',
  sample_aspect_ratio: '1:1', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv' };
const audio = { codec_type: 'audio', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo' };
function variant(before, after) {
  const file = path.resolve(__dirname, '../src/remux-evidence.cjs'), source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split(before).length, 2, 'One exact admission mutant site: ' + before);
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source.replace(before, after), file); return compiled.exports;
}
async function scan(api, nals, budget = {}, data = f.avcc()) {
  const sink = api.createRemuxParameterSink(api.parseRemuxAvcc(data, video), video, { maxBytes: 100000, maxUnits: 100, ...budget });
  const bytes = f.annex(nals); for (let i = 0; i < bytes.length; i++) await sink.push(bytes.subarray(i, i + 1));
  return sink.finish();
}
test('complete parameter scan handles every byte boundary, repeated admitted sets and escaped SEI bodies in constant space', async () => {
  const report = await scan(evidence, [f.sps(), f.pps(), f.sei(5, Buffer.from([0, 0, 0, 0, 1, 2, 3])), f.sps(), f.pps()]);
  assert.equal(report.complete, true); assert.equal(report.parameterSets, 4); assert.equal(report.seiUnits, 1);
  assert.equal(report.configurationSha256, f.hash(f.avcc()));
  for (const lengthBytes of [1, 2, 3, 4]) assert.equal(evidence.parseRemuxAvcc(f.avcc({ lengthBytes }), video).lengthBytes, lengthBytes);
  for (const [channels, rate, samples] of [[1, 44100, 960], [2, 48000, 1024]]) {
    const s = { ...audio, channels, channel_layout: channels === 1 ? 'mono' : 'stereo', sample_rate: String(rate) };
    assert.equal(evidence.parseRemuxAsc(f.asc({ channels, rate, samples }), s).samples, samples);
  }
});
test('each SPS envelope guard kills its exact removal (profile/level/crop/precision/chroma/fields/SAR/colour)', () => {
  for (const [options, guard, code] of [
    [{ profile: 77 }, "profiles[profile]?.includes(stream.profile) && (constraints & 3) === 0", 'REMUX_H264_PROFILE'],
    [{ level: 41 }, 'level === Number(stream.level)', 'REMUX_H264_LEVEL'],
    [{ width: 4 }, 'widthMbs * 16 - 2 * (left + right) === stream.width && heightMap * 16 - 2 * (top + bottom) === stream.height', 'REMUX_H264_GEOMETRY'],
    [{ chroma: 2 }, 'chroma === 1', 'REMUX_H264_CHROMA'],
    [{ depth: 2 }, 'r.ue(6) === 0 && r.ue(6) === 0', 'REMUX_H264_BIT_DEPTH'],
    [{ frameOnly: 0 }, 'frameOnly === 1', 'REMUX_H264_FIELD_CODING'],
    [{ sar: [2, 1] }, 'BigInt(sar[0]) * BigInt(expected[2]) === BigInt(sar[1]) * BigInt(expected[1])', 'REMUX_H264_SAR'],
    [{ fullRange: 1 }, "full === 0 && stream.color_range === 'tv'", 'REMUX_H264_COLOUR_RANGE'],
    [{ colour: [9, 1, 1] }, "r.bits(8) === 1, 'SPS VUI leaves admitted BT709 primaries.'", 'REMUX_H264_COLOUR_PRIMARIES'],
    [{ colour: [1, 16, 1] }, "r.bits(8) === 1, 'SPS VUI leaves admitted BT709 transfer.'", 'REMUX_H264_COLOUR_TRANSFER'],
    [{ colour: [1, 1, 9] }, "r.bits(8) === 1, 'SPS VUI leaves admitted BT709 matrix.'", 'REMUX_H264_COLOUR_MATRIX'],
  ]) {
    const negative = api => assert.throws(() => api.inspectRemuxSps(f.sps(options), video), { code });
    negative(evidence); assert.throws(() => negative(variant(guard, guard.includes('SPS VUI leaves') ? guard.replace('r.bits(8) === 1', 'r.bits(8) !== -1') : 'true')), { code: 'ERR_ASSERTION' });
  }
  const bad = { ...video, color_primaries: 'bt2020' }, guard = "['color_primaries', 'color_transfer', 'color_space'].every(k => stream[k] === 'bt709')";
  const negative = api => assert.throws(() => api.inspectRemuxSps(f.sps(), bad), { code: 'REMUX_H264_COLOUR' });
  negative(evidence); assert.throws(() => negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
});
test('byte identity, HDR/colour SEI and proportional scan guards each kill their exact removal', async () => {
  for (const [nals, budget, guard, code] of [
    [[f.sps({ refs: 3 })], {}, 'admitted.sps.has(sha(nal))', 'REMUX_H264_SPS_CHANGED'],
    [[f.pps(1)], {}, 'admitted.pps.has(sha(nal))', 'REMUX_H264_PPS_CHANGED'],
    [[f.sei(137)], {}, '![4, 23, 137, 142, 144, 147, 148, 149].includes(seiType)', 'REMUX_H264_HDR_SEI'],
    [[f.sei(30)], {}, '[0, 1, 3, 5, 6].includes(seiType)', 'REMUX_H264_SEI_UNSUPPORTED'],
    [[f.sps()], { maxBytes: 1 }, "Number.isSafeInteger(bytes) && bytes <= maxBytes, 'Parameter scan exceeds source-derived bytes.'", 'REMUX_PROPORTIONAL_BUDGET'],
    [[f.sps(), f.sps()], { maxUnits: 1 }, '++units <= maxUnits', 'REMUX_PROPORTIONAL_BUDGET'],
  ]) {
    const negative = api => assert.rejects(scan(api, nals, budget), { code }); await negative(evidence);
    await assert.rejects(negative(variant(guard, guard.includes('Parameter scan') ? "true, 'Parameter scan exceeds source-derived bytes.'" : 'true')), { code: 'ERR_ASSERTION' });
  }
  for (const type of [4, 23, 137, 142, 144, 147, 148, 149]) await assert.rejects(scan(evidence, [f.sei(type)]), { code: 'REMUX_H264_HDR_SEI' });
  for (const type of [2, 19, 30, 37, 48, 133, 141, 255]) await assert.rejects(scan(evidence, [f.sei(type)]), { code: 'REMUX_H264_SEI_UNSUPPORTED' });
  for (const type of [13, 14, 15, 16, 19, 20, 21, 30, 31]) await assert.rejects(scan(evidence, [Buffer.from([type, 128])]), { code: 'REMUX_H264_PARAMETER_EXTENSION' });
  for (const nal of [Buffer.from([6, 5, 9, 1, 128]), Buffer.from([103, 0]), Buffer.from([104, 1]), Buffer.from([9, 128]), Buffer.from([134, 128])])
    await assert.rejects(scan(evidence, [nal]));
  const sink = evidence.createRemuxParameterSink(evidence.parseRemuxAvcc(f.avcc(), video), video, { maxBytes: 100, maxUnits: 2 });
  await assert.rejects(sink.push(Buffer.from([2, 3])), { code: 'REMUX_H264_BITSTREAM' });
});
test('bounded initialization refuses malformed/missing/extra AVC and AAC configuration, including PCE and SBR', () => {
  for (const data of [Buffer.alloc(0), f.avcc().subarray(0, 12), Buffer.concat([f.avcc(), Buffer.from([1])]),
    f.avcc({ sps: [f.sps(), f.sps()] }), f.avcc({ pps: [f.pps(0, 1)] }), f.avcc({ pps: [] }), f.avcc({ sps: [f.sps({ depth: 2 })] })])
    assert.throws(() => evidence.parseRemuxAvcc(data, video));
  for (const [data, code] of [[f.asc({ object: 5 }), 'REMUX_AAC_PROFILE'], [f.asc({ rate: 44100 }), 'REMUX_AAC_RATE'],
    [f.asc({ channels: 0 }), 'REMUX_AAC_LAYOUT'], [f.asc({ channels: 1 }), 'REMUX_AAC_LAYOUT'], [Buffer.from([0x11, 0x92]), 'REMUX_AAC_CONFIG']])
    assert.throws(() => evidence.parseRemuxAsc(data, audio), { code });
  const sbr = new f.Bits().put(2, 5).put(3, 4).put(2, 4).put(0, 3).put(695, 11).put(5, 5).put(1, 1).end(false);
  assert.throws(() => evidence.parseRemuxAsc(sbr, audio), { code: 'REMUX_AAC_PROFILE' });
  const lc = Buffer.from([0x11, 0x90, 0x56, 0xe5, 0x00]); assert.equal(evidence.parseRemuxAsc(lc, audio).samples, 1024);
  for (const [data, guard, code] of [
    [f.asc({ object: 1 }), "bits(5) === 2 && stream.profile === 'LC'", 'REMUX_AAC_PROFILE'],
    [f.asc({ rate: 44100 }), "rate === Number(stream.sample_rate) && [44100, 48000].includes(rate)", 'REMUX_AAC_RATE'],
    [f.asc({ channels: 1 }), "[1, 2].includes(channels) && channels === stream.channels && stream.channel_layout === (channels === 1 ? 'mono' : 'stereo')", 'REMUX_AAC_LAYOUT'],
  ]) {
    const negative = api => assert.throws(() => api.parseRemuxAsc(data, audio), { code }); negative(evidence);
    assert.throws(() => negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
});
test('streamed hex dumps bind every byte, offset, count and digest (including removal mutants)', async () => {
  const data = f.avcc();
  async function read(api, text, expectedHash = f.hash(data), expectedSize = data.length) {
    const sink = api.createRemuxHexSink(expectedSize, 'SHA256:' + expectedHash);
    for (let i = 0; i < text.length; i++) await sink.push(Buffer.from(text.slice(i, i + 1)));
    return sink.finish();
  }
  assert.deepEqual(await read(evidence, f.hexDump(data)), data);
  for (const [text, hash] of [[f.hexDump(data).replace('00000010', '00000011'), f.hash(data)], [f.hexDump(data.subarray(0, 8)), f.hash(data)],
    [f.hexDump(data), 'a'.repeat(64)], ['malformed\n', f.hash(data)]]) await assert.rejects(read(evidence, text, hash), { code: 'REMUX_CODEC_PARAMETERS' });
  for (const [text, hash, guard] of [[f.hexDump(data), 'a'.repeat(64), "at === data.length && sha(data) === expectedHash.slice(7).toLowerCase()"],
    [f.hexDump(data).replace('00000010', '00000011'), f.hash(data), 'parseInt(line.slice(0, 8), 16) === at']]) {
    const negative = api => assert.rejects(read(api, text, hash), { code: 'REMUX_CODEC_PARAMETERS' }); await negative(evidence);
    await assert.rejects(negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
  for (const size of [0, -1, 8 * 1024 ** 2 + 1, Infinity]) assert.throws(() => evidence.createRemuxHexSink(size, 'SHA256:' + f.hash(data)), { code: 'REMUX_CODEC_PARAMETERS' });
});
test('closed key clips stream AVCC lengths and refuse zero/truncated/oversized NALs and excessive counts (mutants killed)', async () => {
  async function clip(api, data) {
    const chunks = [], sink = api.createRemuxAvccClipSink({ lengthBytes: 4 }, { write: async b => chunks.push(Buffer.from(b)) });
    for (const b of data) await sink.push(Buffer.from([b])); await sink.finish(); return Buffer.concat(chunks);
  }
  assert.deepEqual(await clip(evidence, f.packet(0)), f.annex([Buffer.from([101, 188])]));
  for (const data of [Buffer.from([0, 0, 0, 0]), Buffer.from([4, 0, 0, 1]), Buffer.from([0, 0, 0]), f.packet(0).subarray(0, 5),
    Buffer.concat(Array.from({ length: 1025 }, () => f.packet(0)))]) await assert.rejects(clip(evidence, data), { code: 'REMUX_PACKET_WINDOW_ANCHOR' });
  const negative = api => assert.rejects(clip(api, f.packet(0).subarray(0, 5)), { code: 'REMUX_PACKET_WINDOW_ANCHOR' }); await negative(evidence);
  await assert.rejects(negative(variant('units > 0 && left === 0 && lengthBytes === 0', 'true')), { code: 'ERR_ASSERTION' });
});
