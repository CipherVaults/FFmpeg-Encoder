'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const api = require('../src/remux-evidence.cjs');
const sha = n => require('node:crypto').createHash('sha256').update(String(n)).digest('hex');
const source = { index: 0, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', time_base: '1/48000', start_pts: 0 };
const output = { ...source, time_base: '1/1000' };
const skip = (n = 1024, padding = 0) => ({ side_data_type: 'Skip Samples', skip_samples: n, discard_padding: padding, skip_reason: 0, discard_reason: 0 });
// Values copied from root's two first-three-packet observations, not loaded
// from ignored artifacts. Payload hashes are synthetic and identical by index.
const observed = [
  [{ pts: -1024, dts: -1024, duration: 1024, size: '377', flags: 'KD_', side_data_list: [skip()] },
    { pts: 0, dts: 0, duration: 1024, size: '445', flags: 'K__' }, { pts: 1024, dts: 1024, duration: 1024, size: '378', flags: 'K__' }],
  [{ pts: -21, dts: -21, duration: 21, size: '377', flags: 'K__', side_data_list: [skip()] },
    { pts: 0, dts: 0, duration: 21, size: '445', flags: 'K__' }, { pts: 21, dts: 21, duration: 21, size: '378', flags: 'K__' }],
];
function rows(packets, stream, family, main = api) {
  const a = main.createRemuxPacketAccumulator(stream, { maxRecords: 100, maxSourceBytes: 10000, maxDurationSeconds: 2, family, semanticAudio: true });
  const result = packets.map((p, i) => a.push({ codec_type: 'audio', stream_index: 0, data_hash: 'SHA256:' + sha(i), ...p })); a.finish(); return result;
}
async function* list(values) { yield* values; }
async function compare(main = api, change = () => {}, hints = {}) {
  const p = structuredClone(observed), streams = [{ ...source, ...hints.source }, { ...output, ...hints.output }]; change(p, streams);
  const a = rows(p[0], streams[0], 'isobmff', main), b = rows(p[1], streams[1], 'matroska', main);
  return main.compareRemuxPackets(a.length, b.length, list(a), list(b), { audioTrim: { source: streams[0], output: streams[1],
    sourceSamples: 1024, outputSamples: 1024, sourceFamily: 'isobmff', outputFamily: 'matroska' } });
}
function variant(before, after) {
  const file = path.resolve(__dirname, '../src/remux-evidence.cjs'), code = fs.readFileSync(file, 'utf8');
  assert.equal(code.split(before).length, 2, before); const compiled = new Module(file, module);
  compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file)); compiled._compile(code.replace(before, after), file); return compiled.exports;
}
test('root MP4 edit-list discard and Matroska CodecDelay skip prove identical1024-sample leading trim with unchanged1/500s clocks', async () => {
  const r = await compare(); assert.equal(r.complete, true); assert.equal(r.comparedUnits, '3');
  assert.deepEqual(r.audioTrim.source, { version: 1, samplesPerPacket: 1024, codedSamples: '3072', leadingSamples: '1024', trailingSamples: '0' });
  assert.deepEqual(r.audioTrim.source, r.audioTrim.output);
  for (const hints of [{ output: { initial_padding: 1024 } }, { output: { codec_delay: '21333333' } }])
    assert.deepEqual((await compare(api, () => {}, hints)).audioTrim, r.audioTrim);
  // Equivalent codec delay without redundant packet skip is still meaningful.
  assert.deepEqual((await compare(api, p => { delete p[1][0].side_data_list; }, { output: { codec_delay: '21333333' } })).audioTrim, r.audioTrim);
  assert.deepEqual((await compare(api, p => { delete p[0][0].side_data_list; })).audioTrim, r.audioTrim); // D flag alone covers that whole frame.
});
test('one-sample leading changes, missing effective priming and extra tail padding refuse independently on either side', async () => {
  for (const side of [0, 1]) for (const change of [p => { p[side][0].side_data_list[0].skip_samples--; }, p => { p[side][0].side_data_list[0].skip_samples++; },
    (p, streams) => { delete p[side][0].side_data_list; p[side][0].flags = 'K__'; streams[side].start_pts = p[side][0].pts; }, p => { p[side][2].side_data_list = [skip(0, 1)]; }])
    await assert.rejects(compare(api, change), { code: 'REMUX_AUDIO_TRIM' });
  await assert.rejects(compare(api, p => { p[1][0].pts += 3; p[1][0].dts += 3; }), { code: 'REMUX_PACKET_TIMING' });
});
test('same-family MP4/MP4, MP4/MOV and MKV/MKV still compare discard and all trim representation bits exactly', async () => {
  for (const route of ['MP4/MP4', 'MP4/MOV', 'MKV/MKV']) {
    const a = rows(observed[0], source, 'isobmff'), b = structuredClone(a); b[0].discard = false;
    await assert.rejects(api.compareRemuxPackets(3, 3, list(a), list(b)), { code: 'REMUX_PACKET_SIDE_DATA' }, route);
    b[0] = { ...a[0], sideSha256: sha('different skip reason/representation') };
    await assert.rejects(api.compareRemuxPackets(3, 3, list(a), list(b)), { code: 'REMUX_PACKET_SIDE_DATA' }, route);
  }
});
test('trim shape, duplicate data, contradictory hints, unknown units, interior edits and fractional clocks fail closed', async () => {
  await assert.rejects(compare(api, p => { p[1][0].side_data_list.push(skip()); }), { code: 'REMUX_PACKET_SIDE_DATA' });
  for (const change of [p => { p[1][1].side_data_list = [skip(1)]; }, p => { p[1][1].side_data_list = [skip(0, 1)]; },
    p => { p[1][2].flags = 'KD_'; p[1][2].side_data_list = [skip(0, 1)]; },
    p => { p[1][2].side_data_list = [skip(0, 1025)]; }]) await assert.rejects(compare(api, change), { code: 'REMUX_AUDIO_TRIM' });
  for (const hints of [{ output: { initial_padding: 1023 } }, { output: { initial_padding: 4096 } }, { source: { codec_delay: '21333333' } },
    { output: { codec_delay: '21333300' } }, { output: { initial_padding: 1024, codec_delay: '21354167' } }, { output: { trailing_padding: 4096 } },
    { output: { start_pts: 100 } }]) await assert.rejects(compare(api, () => {}, hints), { code: 'REMUX_AUDIO_TRIM' });
  assert.throws(() => api.createRemuxAudioTrim({ ...source, codec_name: 'mp3' }, 1024, 3, 'isobmff'), { code: 'REMUX_AUDIO_TRIM' });
  const fractional = api.createRemuxAudioTrim({ ...output, sample_rate: '44100' }, 1024, 3, 'matroska');
  assert.throws(() => fractional.push({ pts: { numerator: '-1', denominator: '1000' }, discard: false, trim: { skip: '0', padding: '0' } }), { code: 'REMUX_AUDIO_TRIM' });
  const a = api.createRemuxAudioTrim(source, 1024, 3, 'isobmff'); assert.throws(() => a.push({}), { code: 'REMUX_AUDIO_TRIM' });
});
test('exact leading/trailing and representation-conflict guard-removal mutants are killed by their own negatives', async () => {
  for (const [guard, replacement, change, hints] of [
    ['effective.source.leadingSamples === effective.output.leadingSamples && effective.source.trailingSamples === effective.output.trailingSamples', 'true', p => { p[1][0].side_data_list[0].skip_samples++; }],
    ['!explicitLead || base + unit <= leadLimit', 'true', p => { p[0][0].side_data_list[0].skip_samples--; }],
    ['!tailStarted || audible === 0n', 'true', p => { p[0][1].side_data_list = [skip(0, 1)]; p[1][1].side_data_list = [skip(0, 1)]; }],
    ['!declaredLead || !samples || declaredLead === samples', 'true', () => {}, { output: { initial_padding: 1024, codec_delay: '21354167' } }],
  ]) {
    const negative = main => assert.rejects(compare(main, change, hints), { code: 'REMUX_AUDIO_TRIM' }); await negative(api);
    await assert.rejects(negative(variant(guard, replacement)), { code: 'ERR_ASSERTION' });
  }
});
