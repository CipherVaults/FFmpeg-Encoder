'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { HEVC_CONTENT_LIMITS, canonicalHevcNal, classifyHevcPackets, classifyAnnexB } = require('../src/hevc-content.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const b64 = bytes => bytes.toString('base64');
const hashField = bytes => 'SHA256:' + sha(bytes);
function escape(raw) {
  const result = [...raw.subarray(0, 2)]; let zeros = 0;
  for (const byte of raw.subarray(2)) { if (zeros >= 2 && byte <= 3) { result.push(3); zeros = 0; } result.push(byte); zeros = byte === 0 ? zeros + 1 : 0; }
  return Buffer.from(result);
}
function nal(type, body = [128], extra = 0) { return escape(Buffer.from([(type << 1) | extra, 1, ...body])); }
const ps = () => [nal(32, [1, 128]), nal(33, [2, 128]), nal(34, [192])];
function header() { const bytes = Buffer.alloc(22); bytes[0] = 1; bytes[1] = 2; bytes[13] = 0xf0; bytes[15] = 0xfc; bytes[16] = 0xfd; bytes[17] = bytes[18] = 0xfa; bytes[21] = 15; return bytes; }
function profile(transfer = 'smpte2084', id = 'reviewed-720p30-' + transfer) {
  const [vps, sps, pps] = ps(); return { id, width: 1280, height: 720, frameRate: '30/1', transfer,
    sampleAspectRatio: '1:1', hvccHeader: b64(header()), parameterSets: { vps: b64(canonicalHevcNal(vps)), sps: b64(canonicalHevcNal(sps)), pps: b64(canonicalHevcNal(pps)) } };
}
function hvcc(nals = ps()) {
  const groups = new Map(); for (const bytes of nals) { const type = bytes[0] >> 1 & 63; if (!groups.has(type)) groups.set(type, []); groups.get(type).push(bytes); }
  const chunks = [header(), Buffer.from([groups.size])];
  for (const [type, values] of groups) { const group = Buffer.alloc(3); group[0] = type; group.writeUInt16BE(values.length, 1); chunks.push(group);
    for (const bytes of values) { const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length); chunks.push(length, bytes); } }
  return Buffer.concat(chunks);
}
function packet(nals = [nal(20, [160, 128])]) { const chunks = []; for (const bytes of nals) { const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); chunks.push(length, bytes); } return Buffer.concat(chunks); }
function observation(extra = hvcc(), packets = [packet()]) { return { streams: [{ index: 0, extradata: b64(extra), extradata_size: extra.length, extradata_hash: hashField(extra) }],
  packets: packets.map(bytes => ({ stream_index: 0, size: bytes.length, data: b64(bytes), data_hash: hashField(bytes) })) }; }
const opts = (transfer = 'smpte2084') => ({ profiles: [profile(transfer)], transfer });
function variable(value) { const bytes = []; while (value >= 255) { bytes.push(255); value -= 255; } bytes.push(value); return bytes; }
function sei(messages) { return nal(39, [...messages.flatMap(([type, bytes]) => [...variable(type), ...variable(bytes.length), ...bytes]), 128]); }
function mastering(maximum = 10000000) { const bytes = Buffer.alloc(24); [13250, 34500, 7500, 3000, 34000, 16000, 15635, 16450].forEach((value, index) => bytes.writeUInt16BE(value, index * 2)); bytes.writeUInt32BE(maximum, 16); bytes.writeUInt32BE(1, 20); return bytes; }
function light(maximum = 1000, average = 400) { const bytes = Buffer.alloc(4); bytes.writeUInt16BE(maximum); bytes.writeUInt16BE(average, 2); return bytes; }
function withMessages(messages) { return observation(hvcc([...ps(), sei(messages)])); }
function annex(nals = [...ps(), nal(20, [160, 128])], start = [0, 0, 0, 1]) { return Buffer.concat(nals.flatMap(bytes => [Buffer.from(start), bytes])); }
function refused(run, code) { assert.throws(run, error => error.code === 'HEVC_CONTENT_' + code, 'Expected exact refusal ' + code); }
function desc(options = '') {
  const text = 'x265 (build 217) - 4.3+45-116b875:[Windows][GCC 16.2.0][64 bit] 10bit - H.265/HEVC codec - Copyright 2013-2018 (c) Multicoreware, Inc - http://x265.org - options: '
    + 'cpuid=1111039 frame-threads=3 numa-pools=12 wpp no-pmode log-level=1 bitdepth=10 input-csp=1 fps=30/1 input-res=1280x720 interlace=0 '
    + 'sar=1 overscan=0 range=0 colorprim=9 transfer=16 colormatrix=9 chromaloc=1 chromaloc-top=0 chromaloc-bottom=0 display-window=0 '
    + 'scenecut-aware-qp=0conformance-window-offsets right=0 bottom=0' + options;
  return Buffer.concat([Buffer.from('2ca2de09b51747dbbb55a4fe7fc2fc4e', 'hex'), Buffer.from(text, 'ascii')]);
}

test('clean arbitrary coded bytes use configuration content instead of whole-source membership', () => {
  const first = classifyHevcPackets(observation(), opts());
  const second = classifyHevcPackets(observation(hvcc(), [packet([nal(20, [161, 37, 128])]), packet([nal(1, [192, 29, 128])])]), opts());
  assert.equal(first.configuration.id, second.configuration.id); assert.equal(first.pictureCount, 1); assert.equal(second.pictureCount, 2);
  assert.notEqual(first.fingerprint, second.fingerprint); assert.equal(first.configuration.digest, second.configuration.digest);
  assert.deepEqual(first.metadata, { mastering: null, contentLight: null }); assert.equal(first.alternativeTransfer, null);
  assert.equal(first.nalCount, 4); assert.equal(first.packetCount, 1); assert.equal(first.nalInventory[0].origin.kind, 'extradata');
  assert.equal(first.packetInventory[0].sha256, sha(packet())); assert.ok(Object.isFrozen(first.nalInventory[0].origin));
  assert.equal(first.publicationAuthorized, undefined); assert.equal(first.sourceSha256, undefined);
});

test('all static integer values map correctly and independent absence/unspecified CLL is preserved', () => {
  const result = classifyHevcPackets(withMessages([[137, mastering()], [144, light()]]), opts());
  assert.deepEqual(result.metadata.mastering, { red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '10000000/10000' });
  assert.deepEqual(result.metadata.contentLight, { max_content: 1000, max_average: 400 });
  assert.equal(classifyHevcPackets(withMessages([[144, light(0, 0)]]), opts()).metadata.mastering, null);
  assert.deepEqual(classifyHevcPackets(withMessages([[144, light(0, 0)]]), opts()).metadata.contentLight, { max_content: 0, max_average: 0 });
  assert.equal(classifyHevcPackets(withMessages([[137, mastering(40000000)]]), opts()).metadata.contentLight, null);
});

test('exact repeated metadata is accepted; changes and first late appearance refuse', () => {
  const extra = hvcc([...ps(), sei([[137, mastering()], [144, light()]])]);
  const repeated = observation(extra, [packet(), packet([sei([[137, mastering()], [144, light()]]), nal(1, [192, 128])])]);
  assert.equal(classifyHevcPackets(repeated, opts()).pictureCount, 2);
  refused(() => classifyHevcPackets(observation(extra, [packet(), packet([sei([[144, light(2000, 500)]]), nal(1, [192, 128])])]), opts()), 'METADATA_CHANGE');
  refused(() => classifyHevcPackets(observation(hvcc(), [packet(), packet([sei([[144, light()]]), nal(1, [192, 128])])]), opts()), 'LATE_METADATA');
});

test('HLG147 is assessed only when its exact single byte repeats SPS transfer', () => {
  const result = classifyHevcPackets(withMessages([[147, Buffer.from([18])]]), opts('arib-std-b67'));
  assert.equal(result.alternativeTransfer, 18); assert.equal(result.warnings[0].code, 'HEVC_REDUNDANT_TRANSFER_SIGNAL');
  refused(() => classifyHevcPackets(withMessages([[147, Buffer.from([16])]]), opts('arib-std-b67')), 'TRANSFER');
  refused(() => classifyHevcPackets(withMessages([[147, Buffer.from([18, 0])]]), opts('arib-std-b67')), 'TRANSFER');
});

test('the entire x265 description is classified including the known fused conformance spelling', () => {
  const value = classifyHevcPackets(withMessages([[5, desc(' rc=crf crf=25.0 cll=0,0')]]), opts());
  assert.equal(value.warnings[0].code, 'HEVC_ENCODER_DESCRIPTION_REPLACED'); assert.equal(value.seiCount, 1);
  const metadata = ' master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1) cll=1000,400';
  assert.equal(classifyHevcPackets(withMessages([[5, desc(metadata)], [137, mastering()], [144, light()]]), opts()).metadata.contentLight.max_content, 1000);
  for (const change of [bytes => Buffer.concat([bytes, Buffer.from(' arbitrary-prose')]), bytes => Buffer.concat([bytes, Buffer.from([0])]),
    bytes => { bytes[0] ^= 1; return bytes; }, bytes => Buffer.from(bytes.toString('latin1').replace('transfer=16', 'transfer=18'), 'latin1'),
    bytes => Buffer.concat([bytes, Buffer.from(' unknown-field=0')]), bytes => Buffer.concat([bytes, Buffer.from(' bitdepth=10')])])
    refused(() => classifyHevcPackets(withMessages([[5, change(desc())]]), opts()), 'USER_DATA');
  refused(() => classifyHevcPackets(withMessages([[5, desc(' cll=1000,400')]]), opts()), 'USER_DATA');
});

test('unknown functional prefix and every suffix/Dolby/reserved NAL refuse even when decoder labels might omit them', () => {
  for (const type of [0, 1, 4, 6, 19, 47, 129, 132, 133, 148, 255, 256])
    refused(() => classifyHevcPackets(withMessages([[type, Buffer.from([1])]]), opts()), 'SEI_UNSUPPORTED');
  for (const type of [22, 31, 35, 40, 41, 48, 62, 63])
    refused(() => classifyHevcPackets(observation(hvcc(), [packet([nal(type), nal(20, [160, 128])])]), opts()), 'NAL_UNSUPPORTED');
});

test('hvcC header, complete arrays, every parameter-set occurrence and all leftover bytes are strict', () => {
  const changedHeader = hvcc(); changedHeader[2] ^= 1;
  refused(() => classifyHevcPackets(observation(changedHeader), opts()), 'CONFIGURATION');
  for (const extra of [hvcc().subarray(0, 22), Buffer.concat([hvcc(), Buffer.from([0])]), hvcc([...ps(), nal(40)]), hvcc(ps().slice(1))])
    assert.throws(() => classifyHevcPackets(observation(extra), opts()));
  const changedPs = nal(33, [7, 128]);
  refused(() => classifyHevcPackets(observation(hvcc(), [packet([changedPs, nal(20, [160, 128])])]), opts()), 'CONFIGURATION');
  const duplicateProfile = profile(); duplicateProfile.id = 'same-bytes-second-name';
  refused(() => classifyHevcPackets(observation(), { profiles: [profile(), duplicateProfile], transfer: 'smpte2084' }), 'CONFIGURATION');
});

test('packet data canonical sizes and every SHA are independently required', () => {
  for (const edit of [value => value.packets[0].size++, value => value.streams[0].extradata_size++,
    value => value.packets[0].data_hash = 'SHA256:' + '0'.repeat(64), value => value.streams[0].extradata_hash = 'SHA256:' + '0'.repeat(64),
    value => value.packets[0].data += ' ', value => value.streams[0].extradata = value.streams[0].extradata.slice(1),
    value => value.packets[0].side_data_list = [{ side_data_type: 'New Extradata' }], value => value.packets[0].stream_index = 1,
    value => value.packets[0].flags = '_DC', value => value.packets[0].codec_type = 'audio', value => value.programs = [{ id: 1 }]]) {
    const value = observation(); edit(value); assert.throws(() => classifyHevcPackets(value, opts()));
  }
  const value = observation(); value.packets[0].data_hash = 'sha256:' + sha(packet()); refused(() => classifyHevcPackets(value, opts()), 'DATA_HASH');
});

test('only the exact pinned FFprobe LF/80-column base64 wrapper is accepted', () => {
  const wrap = text => '\n' + text.match(/.{1,80}/g).join('\n') + '\n';
  const value = observation(); value.streams[0].extradata = wrap(value.streams[0].extradata); value.packets[0].data = wrap(value.packets[0].data);
  assert.equal(classifyHevcPackets(value, opts()).pictureCount, 1);
  for (const edit of [text => text.replace(/\n/g, '\r\n'), text => text + '\n', text => text.slice(0, -1), text => text.replace('\n', '\n ')]) {
    const bad = structuredClone(value); bad.packets[0].data = edit(bad.packets[0].data); refused(() => classifyHevcPackets(bad, opts()), 'BASE64');
  }
});

test('four-byte packet framing, one first slice per packet and independent initial IDR are required', () => {
  for (const bytes of [Buffer.from([0, 0, 0]), Buffer.from([0, 0, 0, 0]), Buffer.concat([packet(), Buffer.from([1])]),
    packet([nal(1, [192, 128])]), packet([nal(20, [32, 128])]), packet([nal(20, [144, 128])]), packet([nal(20, [160, 128]), nal(1, [192, 128])])])
    assert.throws(() => classifyHevcPackets(observation(hvcc(), [bytes]), opts()));
});

test('EBSP validates every escape and preserves canonical unescaped bytes', () => {
  const original = Buffer.from([78, 1, 5, 4, 0, 0, 1, 3, 128]);
  assert.deepEqual(canonicalHevcNal(escape(original)), original);
  for (const body of [[0, 0, 1], [0, 0, 2], [0, 0, 0], [0, 0, 3], [0, 0, 3, 4]])
    refused(() => canonicalHevcNal(Buffer.from([78, 1, ...body])), 'EMULATION_PREVENTION');
  for (const first of [128 | 78, 79]) refused(() => canonicalHevcNal(Buffer.from([first, 1, 128])), 'NAL_HEADER');
  for (const second of [0, 2, 9]) refused(() => canonicalHevcNal(Buffer.from([78, second, 128])), 'NAL_HEADER');
});

test('SEI extended sizes, exact payload lengths and trailing bits never permit hidden tails', () => {
  for (const body of [[255, 128], [5, 255, 128], [144, 4, 3, 232, 1, 128], [144, 0, 128], [144, 4, 3, 232, 1, 144, 128, 128],
    [144, 4, 3, 232, 1, 144, 64], [137, 23, ...mastering().subarray(0, 23), 128]])
    assert.throws(() => classifyHevcPackets(observation(hvcc([...ps(), nal(39, body)])), opts()));
  refused(() => classifyHevcPackets(withMessages([[144, light(100, 101)]]), opts()), 'STATIC_METADATA');
  refused(() => classifyHevcPackets(withMessages([[137, mastering(0)]]), opts()), 'STATIC_METADATA');
});

test('Annex-B independently selects complete templates and classifies all NALs/SEI', () => {
  const result = classifyAnnexB(annex([...ps(), sei([[144, light()]]), nal(20, [160, 128]), nal(1, [192, 128])]), opts());
  assert.equal(result.framing, 'annex-b'); assert.equal(result.pictureCount, 2); assert.deepEqual(result.metadata.contentLight, { max_content: 1000, max_average: 400 });
  assert.equal(classifyAnnexB(annex(undefined, [0, 0, 1]), opts()).pictureCount, 1);
  assert.equal(classifyAnnexB(Buffer.concat([annex(), Buffer.from([0, 0])]), opts()).nalInventory.at(-1).origin.trailingZeroBytes, 2);
  for (const bytes of [Buffer.concat([Buffer.from([9]), annex()]), Buffer.concat([annex(), Buffer.from([0, 0, 1])]), annex([nal(20, [160, 128])])])
    assert.throws(() => classifyAnnexB(bytes, opts()));
  refused(() => classifyAnnexB(annex([...ps(), nal(40), nal(20, [160, 128])]), opts()), 'NAL_UNSUPPORTED');
});

test('finite captures, inert records and constrained profile/limit schemas cannot be widened by callers', () => {
  const options = opts(); options.limits = { maxCompressedBytes: 1 }; refused(() => classifyHevcPackets(observation(), options), 'BASE64');
  refused(() => classifyHevcPackets(observation(), { ...opts(), limits: { maxPackets: HEVC_CONTENT_LIMITS.maxPackets + 1 } }), 'SIZE');
  refused(() => classifyHevcPackets(observation(), { ...opts(), limits: { invented: 1 } }), 'SHAPE');
  const getter = observation(); Object.defineProperty(getter.packets[0], 'data', { enumerable: true, get() { throw Error('must not execute'); } });
  refused(() => classifyHevcPackets(getter, opts()), 'SHAPE');
  const sparse = observation(); sparse.packets.length = 2; refused(() => classifyHevcPackets(sparse, opts()), 'SHAPE');
  const wrong = profile(); wrong.width = 640; refused(() => classifyHevcPackets(observation(), { profiles: [wrong], transfer: 'smpte2084' }), 'PROFILE');
  refused(() => classifyHevcPackets(observation(), { profiles: [profile()], transfer: 'bt709' }), 'TRANSFER');
});

test('reported stream interpretation, views, relationships and side data cannot contradict raw content', () => {
  for (const fields of [{ width: 1920 }, { color_transfer: 'arib-std-b67' }, { view_ids_available: '0,1' }, { view_pos_available: 'left' },
    { sample_aspect_ratio: '4:3' }, { display_aspect_ratio: '4:3' }, { coded_height: 2000 }, { r_frame_rate: '24/1' }, { nb_read_packets: '2' },
    { disposition: { default: 1 } }, { tags: { ROTATE: '90' } }, { side_data_list: [{ side_data_type: 'DOVI configuration record' }] }]) {
    const value = observation(); Object.assign(value.streams[0], fields); assert.throws(() => classifyHevcPackets(value, opts()));
  }
  const valid = withMessages([[144, light()]]); Object.assign(valid.streams[0], { width: 1280, height: 720, view_ids_available: '', view_pos_available: '', nb_read_packets: '1',
    side_data_list: [{ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 }] });
  assert.equal(classifyHevcPackets(valid, opts()).metadata.contentLight.max_content, 1000);
  valid.streams[0].side_data_list[0].max_average = 401; refused(() => classifyHevcPackets(valid, opts()), 'STREAM_SIDE_DATA');
  const options = {}; Object.defineProperty(options, 'profiles', { enumerable: true, get() { throw Error('must not execute'); } });
  refused(() => classifyHevcPackets(observation(), options), 'SHAPE');
  const limitsGetter = opts(); Object.defineProperty(limitsGetter, 'limits', { enumerable: true, get() { throw Error('must not execute'); } });
  refused(() => classifyHevcPackets(observation(), limitsGetter), 'SHAPE');
  const square = observation(); Object.assign(square.streams[0], { sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9' });
  assert.equal(classifyHevcPackets(square, opts()).configuration.sampleAspectRatio, '1:1');
});


function sdrOptions() {
  return {transfer:'bt709',outputMode:'sdr-bt709-main10',profiles:[{
    ...profile('bt709','synthetic-sdr-output-only'),outputMode:'sdr-bt709-main10',primaries:'bt709',matrix:'bt709'
  }]};
}
test('synthetic BT.709 output profiles require explicit output purpose; HDR source parsing is unchanged',()=>{
  const options=sdrOptions(), facts=classifyAnnexB(annex(),options);
  assert.equal(facts.outputMode,'sdr-bt709-main10');assert.equal(facts.configuration.transfer,'bt709');
  assert.equal(facts.configuration.primaries,'bt709');assert.equal(facts.configuration.matrix,'bt709');
  assert.deepEqual(facts.metadata,{mastering:null,contentLight:null});assert.equal(facts.alternativeTransfer,null);
  const missingMode={...options};delete missingMode.outputMode;
  refused(()=>classifyAnnexB(annex(),missingMode),'TRANSFER');
  for(const [change,code] of [[p=>{p.primaries='bt2020';},'PROFILE'],[p=>{p.matrix='bt2020nc';},'PROFILE'],[p=>{delete p.outputMode;},'SHAPE']]) {
    const altered=structuredClone(options);change(altered.profiles[0]);refused(()=>classifyAnnexB(annex(),altered),code);
  }
});
for(const messages of [[[137,mastering()]],[[144,light()]],[[147,Buffer.from([1])]]])
  test('explicit SDR compressed output refuses obsolete HDR/static/alternative SEI',()=>{
    refused(()=>classifyAnnexB(annex([...ps(),sei(messages),nal(20,[160,128])]),sdrOptions()),'SDR_METADATA');
  });
test('SDR x265 description must independently declare BT.709 primaries, matrix and transfer',()=>{
  const sdrDesc=Buffer.from(desc().toString('latin1').replace('colorprim=9 transfer=16 colormatrix=9','colorprim=1 transfer=1 colormatrix=1'),'latin1');
  const facts=classifyAnnexB(annex([...ps(),sei([[5,sdrDesc]]),nal(20,[160,128])]),sdrOptions());
  assert.equal(facts.configuration.transfer,'bt709');
  refused(()=>classifyAnnexB(annex([...ps(),sei([[5,desc()]]),nal(20,[160,128])]),sdrOptions()),'USER_DATA');
});
