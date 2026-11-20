'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readFileStamp, readSourceIdentity } = require('../src/source-identity.cjs');
const { openProductMp3Source, assertProductMp3Source } = require('../linux-blue/product-mp3-source.cjs');

const indexOfRate = { 44100: 0, 48000: 1, 32000: 2 };
const indexOfBitrate = { 64: 5, 96: 7, 128: 9, 320: 14 };
function frame(rate, channels, bitrate, padding = 0, crc = false) {
  const result = Buffer.alloc(Math.floor(144000 * bitrate / rate) + padding);
  result.set([255, crc ? 250 : 251,
    (indexOfBitrate[bitrate] << 4) | (indexOfRate[rate] << 2) | (padding << 1),
    channels === 1 ? 192 : 0]);
  return result;
}
const sequence = (rate = 48000, channels = 2, bitrates = [128, 128, 128, 128]) =>
  Buffer.concat(bitrates.map((rateKbps, index) => frame(rate, channels, rateKbps, index & 1)));

async function file(t, bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp3-source-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const selected = path.join(dir, 'source.mp3');
  await fs.writeFile(selected, bytes);
  return selected;
}

// This real descriptor contract intentionally requires Linux O_NOFOLLOW and O_NONBLOCK.
const linuxSource = (name, body) => test(name, {skip: process.platform !== 'linux' && 'Linux source descriptor required'}, body);

for (const [rate, channels, bitrates] of [[48000, 2, [128, 128, 128, 128]],
  [44100, 1, [64, 128, 96, 320]], [32000, 2, [96, 320, 64, 128]]]) {
  linuxSource(`observes bounded MPEG-1 Layer III shape at ${rate} Hz, ${channels} channels`, async t => {
    const bytes = sequence(rate, channels, bitrates);
    const selected = await file(t, bytes);
    const stamp = await readFileStamp(selected);
    const lease = await openProductMp3Source(stamp);
    try {
      assert.deepEqual(lease.identity, await readSourceIdentity(selected));
      assert.ok(Object.isFrozen(lease) && Object.isFrozen(lease.observation) && Object.isFrozen(lease.identity));
      assert.deepEqual(assertProductMp3Source(lease, { rate, channels }), {
        method: 'mp3-mpeg1-layer3-prefix-headers-v1', rate, channels, frames: 4,
        contiguousPrefixBytes: bytes.length, fileBytes: bytes.length, reachesEof: true,
        completePayloadVerified: false, metadataAbsenceVerified: false,
      });
      for (const wrong of [{ rate: 16000, channels }, { rate, channels: 3 }, { rate: String(rate), channels }]) {
        assert.throws(() => assertProductMp3Source(lease, wrong), { code: 'MP3_PROBE_MISMATCH' });
      }
      assert.throws(() => assertProductMp3Source({ ...lease }, { rate, channels }), { code: 'MP3_CUSTODY_UNAVAILABLE' });
      const controller = new AbortController();
      controller.abort();
      assert.throws(() => lease.assertCurrent({ signal: controller.signal }), { code: 'CANCELLED' });
      assert.equal(lease.close(), lease.close());
      assert.throws(() => lease.assertCurrent(), { code: 'INPUT_CHANGED' });
    } finally { await lease.close(); }
  });
}

linuxSource('post-close named currentness does not revive descriptor custody', async t => {
  const bytes = sequence();
  const selected = await file(t, bytes);
  const controller = new AbortController();
  const lease = await openProductMp3Source(await readFileStamp(selected), { signal: controller.signal });
  await lease.close();
  assert.doesNotThrow(() => lease.assertNamedCurrent());
  assert.throws(() => lease.assertCurrent(), { code: 'INPUT_CHANGED' });
  assert.throws(() => assertProductMp3Source(lease, { rate: 48000, channels: 2 }), { code: 'INPUT_CHANGED' });
  const aborted = new AbortController();
  aborted.abort();
  assert.throws(() => lease.assertNamedCurrent({ signal: aborted.signal }), { code: 'CANCELLED' });
  const replacement = selected + '.next';
  await fs.writeFile(replacement, bytes);
  await fs.rename(replacement, selected);
  assert.throws(() => lease.assertNamedCurrent(), { code: 'INPUT_CHANGED' });
  await fs.unlink(selected);
  assert.throws(() => lease.assertNamedCurrent(), { code: 'INPUT_CHANGED' });
  controller.abort();
  assert.throws(() => lease.assertNamedCurrent(), { code: 'CANCELLED' });
});

linuxSource('sampled large-file identity is exact but no complete media or metadata claim', async t => {
  const block = frame(32000, 2, 320);
  const bytes = Buffer.concat(Array(900).fill(block));
  // Deliberately leave an unobserved interior break in the physical frame grid.
  bytes.fill(0, block.length * 350, block.length * 351);
  const selected = await file(t, bytes);
  const identity = await readSourceIdentity(selected);
  const lease = await openProductMp3Source(identity);
  try {
    assert.deepEqual(lease.identity, identity);
    assert.equal(lease.observation.frames, Math.floor((256 * 1024) / block.length));
    assert.equal(lease.observation.fileBytes, bytes.length);
    assert.equal(lease.observation.reachesEof, false);
    assert.equal(lease.observation.completePayloadVerified, false);
  } finally { await lease.close(); }
});

linuxSource('refuses bounded wrong, interrupted or truncated headers and explicit metadata signatures', async t => {
  const ordinary = sequence();
  const id3 = Buffer.from('49443304000000000000', 'hex');
  const tag = Buffer.alloc(128);
  tag.write('TAG');
  const ape = Buffer.alloc(32);
  ape.write('APETAGEX');
  const xing = Buffer.from(ordinary);
  xing.write('Xing', 36);
  const vbri = Buffer.from(ordinary);
  vbri.write('VBRI', 36);
  const info = Buffer.concat([frame(44100, 1, 96, 0, true), sequence(44100, 1)]);
  info.write('Info', 23);
  const wrongVersion = Buffer.from(ordinary);
  wrongVersion[1] = 243;
  const broken = Buffer.from(ordinary);
  broken[384] = 0;
  for (const [bytes, code] of [
    [Buffer.concat([id3, ordinary]), 'MP3_ID3V2_UNSUPPORTED'],
    [Buffer.concat([ordinary, tag]), 'MP3_TRAILING_TAG_UNSUPPORTED'],
    [Buffer.concat([ordinary, ape, tag]), 'MP3_TRAILING_TAG_UNSUPPORTED'],
    [Buffer.concat([ordinary, ape]), 'MP3_TRAILING_TAG_UNSUPPORTED'],
    [xing, 'MP3_SEEK_HEADER_UNSUPPORTED'], [vbri, 'MP3_SEEK_HEADER_UNSUPPORTED'],
    [info, 'MP3_SEEK_HEADER_UNSUPPORTED'],
    [wrongVersion, 'MP3_FRAME_UNPROVED'], [broken, 'MP3_FRAME_UNPROVED'],
    [ordinary.subarray(0, ordinary.length - 1), 'MP3_FRAME_UNPROVED'],
    [ordinary.subarray(0, 384), 'MP3_FRAME_UNPROVED'],
    [Buffer.concat([ordinary, frame(44100, 2, 128)]), 'MP3_FRAME_UNPROVED'],
    [Buffer.concat([ordinary, frame(48000, 1, 128)]), 'MP3_FRAME_UNPROVED'],
  ]) {
    const selected = await file(t, bytes);
    await assert.rejects(openProductMp3Source(await readFileStamp(selected)), { code });
    assert.deepEqual(await fs.readFile(selected), bytes);
  }
});

linuxSource('rejects ordinary stale same-byte replacement, links, digest mismatch and cancellation', async t => {
  const bytes = sequence();
  const selected = await file(t, bytes);
  const identity = await readSourceIdentity(selected);
  const baseline = await readFileStamp(selected);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(openProductMp3Source(baseline, { signal: cancelled.signal }), { code: 'CANCELLED' });
  await assert.rejects(openProductMp3Source({ ...identity, sparseDigest: 'sha256-sparse-v1:' + '0'.repeat(64) }),
    { code: 'INPUT_CHANGED' });
  const lease = await openProductMp3Source(baseline);
  try {
    const next = selected + '.new';
    await fs.writeFile(next, bytes);
    await fs.rename(next, selected);
    assert.throws(() => assertProductMp3Source(lease, { rate: 48000, channels: 2 }), { code: 'INPUT_CHANGED' });
  } finally { await lease.close(); }
  await assert.rejects(openProductMp3Source(baseline), { code: 'INPUT_CHANGED' });
  const current = await readFileStamp(selected);
  const link = selected + '.hard';
  await fs.link(selected, link);
  await assert.rejects(openProductMp3Source(current), { code: 'INPUT_CHANGED' });
  await fs.unlink(link);
  const symlink = selected + '.symbolic';
  await fs.symlink(selected, symlink);
  const stamp = await readFileStamp(selected);
  await assert.rejects(openProductMp3Source({ ...stamp, canonicalPath: symlink }), { code: 'INPUT_CHANGED' });
});
