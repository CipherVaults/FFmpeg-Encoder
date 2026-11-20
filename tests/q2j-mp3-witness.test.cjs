'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeLayer3 } = require('../scripts/fixtures/q2j-layer3.cjs');
const { inspectFrames, compareCopy, COPY_NOTICE } = require('../linux-blue/qualification-tests/q2j-mp3-witness.cjs');
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code);
for (const [rate, channels, variable] of [[48000, 2, false], [44100, 1, true], [32000, 2, true]]) {
  test('generated frame walk: ' + [rate, channels, variable].join('/'), () => {
    const raw = makeLayer3({rate, channels, variable});
    const parsed = inspectFrames(raw);
    assert.equal(parsed.frames.length, 40); assert.equal(parsed.rate, rate); assert.equal(parsed.channels, channels);
    assert.equal(parsed.frames.reduce((v,f) => v + f.size, 0), raw.length);
    assert.equal(new Set(parsed.frames.map(f => f.sha256)).size, 40);
  });
}
test('do not hide trailing, leading, malformed or unsupported MPEG data', () => {
  const b = makeLayer3();
  for (const raw of [b.subarray(1), b.subarray(0,-1), Buffer.concat([b, Buffer.from([0])]),
    Buffer.concat([Buffer.from('ID3'), b]), Buffer.from('not audio')])
    expectCode(() => inspectFrames(raw), 'MP3_FRAME_UNPROVED');
  for (const [byte, value] of [[1,0xfd], [2,0x04], [2,0xf4], [2,0x9c], [3,0x02]]) {
    const raw = Buffer.from(b); raw[byte] = value;
    expectCode(() => inspectFrames(raw), 'MP3_FRAME_UNPROVED');
  }
});
test('mixed rate/channel shape, Xing/Info/VBRI and evidence limit refuse', () => {
  for (const bytes of [makeLayer3({rate:32000}),makeLayer3({channels:1})])
    expectCode(() => inspectFrames(Buffer.concat([makeLayer3(), bytes])), 'MP3_FRAME_UNPROVED');
  for (const tag of ['Xing','Info','VBRI']) {
    const raw=makeLayer3();raw.write(tag,36);expectCode(() => inspectFrames(raw), 'MP3_FRAME_UNPROVED');
  }
  expectCode(() => inspectFrames(Buffer.alloc(4*1024*1024+1)), 'MP3_WITNESS_LIMIT');
});
test('lab result is not a Ready grant and contains an honest compatibility caution', () => {
  assert.match(COPY_NOTICE,/Apple/); assert.match(COPY_NOTICE,/not play/);
  expectCode(() => compareCopy({}), 'MP3_WITNESS_LIMIT');
  const {normalizeProbe}=require('../src/inspection.cjs');
  expectCode(() => normalizeProbe({streams:[{index:0,codec_type:'audio',codec_name:'mp3'}]}), 'NO_VIDEO');
  const {remuxPolicies}=require('../linux-blue/product-linux-remux-service.cjs');
  assert.ok(remuxPolicies({evidenceId:'not-a-grant',matroska:null,mov:null}).every(p=>p.inputFamily==='isobmff'));
});
