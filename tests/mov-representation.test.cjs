'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { observeMovRepresentation, getMovRepresentation } = require('../src/mov-representation.cjs');
const { remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const { atom, fixture, writeFixture } = require('./helpers/mov-fixture.cjs');
const OUTPUT = '715e278f-1b7e-4d19-948d-a952b68c328e';
const probe = () => ({ streams: [{ index: 0, id: '0x17', codec_type: 'video', codec_name: 'h264' },
  { index: 1, id: '0x2', codec_type: 'audio', codec_name: 'pcm_s16le' }],
format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 }, chapters: [], programs: [], stream_groups: [] });
const observe = (receipt, changes = {}) => observeMovRepresentation({ outputId: OUTPUT, outputProbe: probe(), fileReceipt: receipt, ...changes });
test('retained MOV atoms bind unique native IDs to stream indices, not atom order, and receipt cannot be serialized', async t => {
  const file = await writeFixture(t, fixture([{ id: 2, language: 0 }, { id: 23, language: 32767 }]));
  const receipt = await observe(file);
  assert.deepEqual(receipt.tracks.map(track => [track.outputIndex, track.trackId, track.languageCode]), [[0, 23, 32767], [1, 2, 0]]);
  assert.equal(receipt.outputSha256, file.sha256); assert.equal(receipt.tracks[0].mdhdSha256.length, 64);
  const binding = { outputId: OUTPUT, outputEvidenceFingerprint: remuxProbeFingerprint(probe()), outputSha256: file.sha256 };
  assert.equal(getMovRepresentation(receipt, binding), receipt);
  for (const changes of [{ outputSha256: 'a'.repeat(64) }, { outputId: '9690cc4c-fd65-4b75-a0a2-c4b81e4f24e3' }, { outputEvidenceFingerprint: 'b'.repeat(64) }]) {
    assert.throws(() => getMovRepresentation(receipt, { ...binding, ...changes }), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
  }
  assert.throws(() => getMovRepresentation(structuredClone(receipt), binding), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
  assert.ok(Object.isFrozen(receipt.tracks[0]));
});
test('extended sizes, version1 headers and parent-bounded zero sizes are observed exactly', async t => {
  const file = await writeFixture(t, fixture([{ id: 23, version: 1 }, { id: 2, version: 1 }], { extended: true, zero: true }));
  assert.ok((await observe(file)).tracks.every(track => track.languageCode === 32767));
});
test('malformed boxes, duplicate/missing IDs, wrong brand and excessive atom count remain unverified', async t => {
  const invalidSize = Buffer.alloc(16); invalidSize.writeUInt32BE(1); invalidSize.write('moov', 4); invalidSize.writeBigUInt64BE(2n ** 63n, 8);
  for (const bytes of [fixture([{ id: 23 }, { id: 23 }]), fixture([{ id: 23 }]), fixture([{ id: 23 }, { id: 2 }], { brand: 'isom' }),
    invalidSize, Buffer.concat([fixture([{ id: 23 }, { id: 2 }]), Buffer.alloc(1)]),
    Buffer.concat(Array.from({ length: 2049 }, () => atom('free', Buffer.alloc(0))))]) {
    const file = await writeFixture(t, bytes); await assert.rejects(observe(file), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
  }
  const file = await writeFixture(t, fixture([{ id: 23 }, { id: 2 }]));
  const duplicate = probe(); duplicate.streams[1].id = '0x17';
  await assert.rejects(observe(file, { outputProbe: duplicate }), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
});
test('old output identity/content receipts and cancellation cannot admit representation authority', async t => {
  const file = await writeFixture(t, fixture([{ id: 23 }, { id: 2 }]));
  await assert.rejects(observe({ ...file, sha256: 'a'.repeat(64) }), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
  await assert.rejects(observe({ ...file, identity: { ...file.identity, ino: '1' } }), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
  await assert.rejects(observe(file, { signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  await fs.writeFile(file.path, fixture([{ id: 23, language: 0 }, { id: 2 }]), { flag: 'r+' });
  await assert.rejects(observe(file), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
});
