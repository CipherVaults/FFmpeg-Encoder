'use strict';
// FFmpeg 9.1 movenc (b1327568b6) keeps the last AAC frame at 1024 samples in
// STTS and trims its Skip Samples end padding with the media edit alone; 9.0.2
// shortened the last STTS delta instead. Synthetic native atoms only.
const test = require('node:test'), assert = require('node:assert/strict');
const { observeRemuxEditLists, observeRemuxSourcePlayback, remuxEditInterval, bindRemuxSourceTail } = require('../src/remux-edit-lists.cjs');
const evidence = require('../src/remux-evidence.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { atom, timedFixture, writeFixture } = require('./helpers/mov-fixture.cjs');
const q = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
const ceil = (n, d) => (n + d - 1n) / d;
const FRAMES = 48, FRAME = 1024, RATE = 48000, LEAD = 1024, PAD = 128, CLOCKS = [1000, 1001, 48000, 1000003];
const aac = { index: 0, id: '2', codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_rate: '48000', time_base: '1/48000', start_pts: 0 };
function transform(bytes, type, occurrence, change) {
  let seen = 0;
  function visit(b) { const out = []; for (let at = 0; at < b.length;) {
    const size = b.readUInt32BE(at), name = b.toString('ascii', at + 4, at + 8); let body = Buffer.from(b.subarray(at + 8, at + size));
    if (name === type && seen++ === occurrence) body = change(body);
    else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(name)) body = visit(body);
    out.push(atom(name, body)); at += size;
  } return Buffer.concat(out); } return visit(bytes);
}
// movenc's source media edit: ceil(visible end) - ceil(media_time), each on the movie clock.
const sourceEdit = (movieScale, tail = PAD, scale = RATE, frames = FRAMES, frame = FRAME, lead = LEAD) =>
  ceil(BigInt(frames * frame - tail) * BigInt(movieScale), BigInt(scale)) - ceil(BigInt(lead) * BigInt(movieScale), BigInt(scale));
// layout '9.1': full last frame + edit-only trim. layout '9.0.2': short last STTS delta.
function track({ movieScale, layout = '9.1', edit, tkhd = edit, id = 2, kind = 'audio', scale = RATE, frame = FRAME, frames = FRAMES, lead = LEAD, entries = null }) {
  const durations = Array.from({ length: frames }, (_, i) => i === frames - 1 && layout === '9.0.2' ? frame - PAD : frame);
  let bytes = timedFixture([{ id, kind, scale, pts: durations.map((_, i) => i * frame), durations, mediaTime: lead }], { movieScale });
  bytes = transform(bytes, 'elst', 0, b => {
    const list = entries || [{ duration: edit, mediaTime: lead }], r = Buffer.alloc(8 + list.length * 12); r.writeUInt32BE(list.length, 4);
    list.forEach((e, i) => { r.writeUInt32BE(Number(e.duration), 8 + i * 12); r.writeInt32BE(e.mediaTime, 12 + i * 12); r.writeInt16BE(1, 16 + i * 12); }); return r; });
  bytes = transform(bytes, 'tkhd', 0, b => { b.writeUInt32BE(Number(tkhd), 20); return b; });
  return transform(bytes, 'mvhd', 0, b => { b.writeUInt32BE(Number(tkhd), 16); return b; });
}
async function source(t, bytes, stream = aac) {
  const receipt = await writeFixture(t, bytes);
  return observeRemuxSourcePlayback({ file: receipt.path, probe: { streams: [stream] }, identity: await readSourceIdentity(receipt.path), maxRecords: 100 });
}
const sourceTail = async (t, bytes, stream) => (await source(t, bytes, stream)).tracks[0].aacTail;
// Independent oracle: every trailing count whose own edit rounds to the stored edit.
function admissible(movieScale, edit) {
  const out = []; for (let s = 1; s < FRAME; s++) if (sourceEdit(movieScale, s) === edit) out.push(s); return out;
}

test('9.1 full-frame AAC tail edits are admitted with their exact admissible trailing interval at movie clocks 1000/1001/48000/1000003', async t => {
  const literal = { 1000: ['96', '143'], 1001: ['98', '145'], 48000: ['128', '128'] };
  for (const movieScale of CLOCKS) {
    const edit = sourceEdit(movieScale), tail = await sourceTail(t, track({ movieScale, edit }));
    const oracle = admissible(movieScale, edit);
    assert.ok(oracle.includes(PAD) && oracle.at(-1) - oracle[0] === oracle.length - 1, String(movieScale));
    assert.deepEqual(tail, { version: 1, samplesPerPacket: 1024, sampleRate: '48000', lastPacketSamples: '1024', leadingSamples: '1024',
      minimumTrailingSamples: String(oracle[0]), maximumTrailingSamples: String(oracle.at(-1)) }, String(movieScale));
    if (literal[movieScale]) assert.deepEqual([tail.minimumTrailingSamples, tail.maximumTrailingSamples], literal[movieScale]);
    // The 9.0.2 layout of the same presentation still meets the original exact equality.
    const old = await source(t, track({ movieScale, layout: '9.0.2', edit }));
    assert.equal(old.tracks[0].aacTail, undefined); assert.equal(old.tracks[0].entries[0].duration, String(edit));
  }
  // One leading empty edit before the single media edit is the same form.
  const edit = sourceEdit(48000), withDelay = track({ movieScale: 48000, edit, tkhd: edit + 480n, entries: [{ duration: 480n, mediaTime: -1 }, { duration: edit, mediaTime: LEAD }] });
  assert.deepEqual([(await sourceTail(t, withDelay)).minimumTrailingSamples, (await sourceTail(t, withDelay)).maximumTrailingSamples], ['128', '128']);
});

test('the AAC tail form refuses tail 0, one or more frames, extensions, video/non-AAC/off-grid tracks and extra edits with the same codes', async t => {
  const edit = sourceEdit(48000), code = { code: 'REMUX_SOURCE_EDIT_UNSUPPORTED', message: /shortened or extended/ };
  // Tail 0 is the original full edit (no tail receipt); one tick extended is refused in both layouts.
  assert.equal((await source(t, track({ movieScale: 48000, edit: sourceEdit(48000, 0) }))).tracks[0].aacTail, undefined);
  await assert.rejects(source(t, track({ movieScale: 48000, edit: sourceEdit(48000, 0) + 1n })), code);
  await assert.rejects(source(t, track({ movieScale: 48000, layout: '9.0.2', edit: edit + 1n })), code);
  await assert.rejects(source(t, track({ movieScale: 1000, edit: sourceEdit(1000, 0) + 1n })), code);
  for (const tail of [1024, 1025, 1100, 2048]) await assert.rejects(source(t, track({ movieScale: 48000, edit: sourceEdit(48000, tail) })), code, String(tail));
  // At a coarse clock, an edit only one frame or more short has no admissible tail.
  await assert.rejects(source(t, track({ movieScale: 1000, edit: sourceEdit(1000, 1024) - 1n })), code);
  // A shortened 9.0.2-layout edit (last delta 896) is not a full-frame tail.
  await assert.rejects(source(t, track({ movieScale: 48000, layout: '9.0.2', edit: edit - 1n })), code);
  // Non-AAC audio gets no head trim, so isolate its tail with media_time 0.
  for (const codec_name of ['mp3', 'alac']) {
    const untrimmed = { movieScale: 48000, lead: 0 }, stream = { ...aac, codec_name };
    await source(t, track({ ...untrimmed, edit: sourceEdit(48000, 0, RATE, FRAMES, FRAME, 0) }), stream);
    await assert.rejects(source(t, track({ ...untrimmed, edit: sourceEdit(48000, PAD, RATE, FRAMES, FRAME, 0) }), stream), code, codec_name);
  }
  for (const stream of [{ ...aac, sample_rate: '44100' }, { ...aac, sample_rate: undefined }, { ...aac, sample_rate: '48000.5' }])
    await assert.rejects(source(t, track({ movieScale: 48000, edit }), stream), code, JSON.stringify(stream));
  // Last delta must be exactly one 1024-sample frame on the media clock.
  await assert.rejects(source(t, track({ movieScale: 48000, frame: 1000, edit: sourceEdit(48000, PAD, RATE, FRAMES, 1000) })), code);
  await assert.rejects(source(t, track({ movieScale: 48000, scale: 44100, edit: sourceEdit(48000, PAD, 44100) })), code);
  // Video tails stay refused (a video edit cannot trim the head either).
  const video = { index: 0, id: '1', codec_type: 'video', codec_name: 'h264', width: 2, height: 2 };
  await source(t, track({ movieScale: 48000, id: 1, kind: 'video', lead: 0, edit: sourceEdit(48000, 0, RATE, FRAMES, FRAME, 0) }), video);
  await assert.rejects(source(t, track({ movieScale: 48000, id: 1, kind: 'video', lead: 0, edit: sourceEdit(48000, PAD, RATE, FRAMES, FRAME, 0) }), video), code);
  // Consecutive or extra media edits keep their exact preroll refusal; an interior media start too.
  for (const entries of [[{ duration: edit, mediaTime: LEAD }, { duration: 1n, mediaTime: LEAD }],
    [{ duration: 1n, mediaTime: -1 }, { duration: 1n, mediaTime: -1 }, { duration: edit, mediaTime: LEAD }]])
    await assert.rejects(source(t, track({ movieScale: 48000, edit, entries })), { code: 'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED' });
  await assert.rejects(source(t, track({ movieScale: 48000, edit, entries: [{ duration: edit, mediaTime: FRAMES * FRAME }] })), { code: 'REMUX_SOURCE_EDIT_UNSUPPORTED', message: /interior/ });
  // The tkhd declaration is reconciled exactly against the admissible tails.
  await assert.rejects(source(t, track({ movieScale: 48000, edit, tkhd: edit + 1n })), { code: 'REMUX_SOURCE_DURATION_UNVERIFIED' });
});

test('the admitted tail interval must contain the complete AAC trim or decoded PCM trailing padding', async t => {
  const fine = { aacTail: await sourceTail(t, track({ movieScale: 48000, edit: sourceEdit(48000) })) };
  const coarse = { aacTail: await sourceTail(t, track({ movieScale: 1000, edit: sourceEdit(1000) })) };
  const trim = (trailing, extra = {}) => ({ audioTrim: { version: 1, samplesPerPacket: 1024, codedSamples: '49152', leadingSamples: '1024', trailingSamples: String(trailing), ...extra } });
  const pcm = samples => ({ unitCount: '48', pcm: { bytes: samples * 8, samples: String(samples), sha256: '0'.repeat(64) } });
  const bound = { samplesPerPacket: 1024, sampleRate: '48000', lastPacketSamples: '1024', trailingSamples: '128' };
  assert.deepEqual(bindRemuxSourceTail(fine, trim(128)), bound);
  assert.deepEqual(bindRemuxSourceTail(fine, pcm(48000)), bound); // 48*1024 - 1024 - 48000
  for (const s of [96, 128, 143]) assert.equal(bindRemuxSourceTail(coarse, trim(s)).trailingSamples, String(s));
  assert.equal(bindRemuxSourceTail({ aacTail: undefined }, trim(128)), null); assert.equal(bindRemuxSourceTail(undefined, trim(128)), null);
  const refused = { code: 'REMUX_SOURCE_EDIT_UNSUPPORTED' };
  // Elst/discard_padding mismatch, including full-frame STTS without any Skip Samples (0 trailing).
  for (const s of [0, 127, 129, 1024, -1, '1e3', '']) assert.throws(() => bindRemuxSourceTail(fine, trim(s)), refused, String(s));
  for (const s of [95, 144]) assert.throws(() => bindRemuxSourceTail(coarse, trim(s)), refused, String(s));
  for (const samples of [48001, 47999, 48128]) assert.throws(() => bindRemuxSourceTail(fine, pcm(samples)), refused, String(samples));
  assert.throws(() => bindRemuxSourceTail(fine, trim(128, { samplesPerPacket: 960 })), refused);
  assert.throws(() => bindRemuxSourceTail(fine, trim(128, { leadingSamples: '1023' })), refused);
  assert.throws(() => bindRemuxSourceTail(fine, { unitCount: '48' }), refused);
  assert.throws(() => bindRemuxSourceTail(fine, null), refused);
  assert.throws(() => bindRemuxSourceTail({ aacTail: { ...fine.aacTail, leadingSamples: undefined } }, pcm(48000)), refused);
  assert.throws(() => bindRemuxSourceTail({ aacTail: { ...fine.aacTail, version: 2 } }, trim(128)), refused);
});

test('output edits end at lastPts + max(frame, lastPacketDuration) - trailing for both layouts, exactly', async t => {
  const record = layout => ({ representation: 'packet-identity-v1', unitCount: String(FRAMES), firstPts: q(-LEAD, RATE),
    endPts: q((FRAMES - 1) * FRAME - LEAD + (layout === '9.1' ? FRAME : FRAME - PAD), RATE) });
  const bound = last => ({ samplesPerPacket: 1024, sampleRate: '48000', lastPacketSamples: String(last), trailingSamples: String(PAD) });
  const full = remuxEditInterval(record('9.1'), aac, bound(1024)), short = remuxEditInterval(record('9.0.2'), aac, bound(1024 - PAD));
  const end = e => BigInt(e.endPts.numerator) * BigInt(RATE) / BigInt(e.endPts.denominator);
  assert.equal(end(full), 48000n); assert.equal(end(short), 48000n);
  assert.equal(end(remuxEditInterval(record('9.0.2'), aac)), 48000n); // unbound 9.0.2 layout: unchanged
  assert.equal(end(remuxEditInterval(record('9.1'), aac)), 48128n);
  assert.throws(() => remuxEditInterval(record('9.1'), { ...aac, codec_name: 'mp3' }, bound(1024)), { code: 'REMUX_EDIT_LIST_UNEXPECTED' });
  assert.throws(() => remuxEditInterval(record('9.1'), { ...aac, sample_rate: '44100' }, bound(1024)), { code: 'REMUX_EDIT_LIST_UNEXPECTED' });
  for (const movieScale of CLOCKS) {
    // The output writer rounds the visible span up on its movie clock.
    const edit = ceil(BigInt(movieScale) * 48000n, 48000n);
    for (const [layout, interval] of [['9.1', full], ['9.0.2', short]]) {
      const inspect = async (bytes, i = interval) => observeRemuxEditLists({ fileReceipt: await writeFixture(t, bytes), outputProbe: { streams: [aac] },
        intervals: [{ outputIndex: 0, ...i }], maxRecords: 100 });
      const result = await inspect(track({ movieScale, layout, edit }));
      assert.deepEqual(result.tracks[0].entries.map(e => [e.duration, e.mediaTime]), [[String(edit), '1024']], movieScale + '/' + layout);
      for (const delta of [1n, -1n]) await assert.rejects(inspect(track({ movieScale, layout, edit: edit + delta, tkhd: edit })),
        { code: 'REMUX_EDIT_LIST_UNEXPECTED' }, movieScale + '/' + layout + '/' + delta);
    }
    // Without the bound tail the full-frame layout's sample-table end is expected, and refused.
    await assert.rejects((async () => observeRemuxEditLists({ fileReceipt: await writeFixture(t, track({ movieScale, edit })), outputProbe: { streams: [aac] },
      intervals: [{ outputIndex: 0, ...remuxEditInterval(record('9.1'), aac) }], maxRecords: 100 }))(), { code: 'REMUX_EDIT_LIST_UNEXPECTED' });
  }
});

test('output trailing padding that differs from the source still refuses at the complete trim identity', async () => {
  const sha = n => require('node:crypto').createHash('sha256').update(String(n)).digest('hex');
  const skip = (n, padding = 0) => ({ side_data_type: 'Skip Samples', skip_samples: n, discard_padding: padding, skip_reason: 0, discard_reason: 0 });
  const output = { ...aac, time_base: '1/1000' };
  const packets = (tail, iso) => iso
    ? [{ pts: -1024, dts: -1024, duration: 1024, size: '377', flags: 'KD_', side_data_list: [skip(1024)] }, { pts: 0, dts: 0, duration: 1024, size: '445', flags: 'K__' },
      { pts: 1024, dts: 1024, duration: 1024, size: '378', flags: 'K__', side_data_list: [skip(0, tail)] }]
    : [{ pts: -21, dts: -21, duration: 21, size: '377', flags: 'K__', side_data_list: [skip(1024)] }, { pts: 0, dts: 0, duration: 21, size: '445', flags: 'K__' },
      { pts: 21, dts: 21, duration: 21, size: '378', flags: 'K__', side_data_list: [skip(0, tail)] }];
  const rows = (list, stream, family) => { const a = evidence.createRemuxPacketAccumulator(stream, { maxRecords: 100, maxSourceBytes: 10000, maxDurationSeconds: 2, family, semanticAudio: true });
    const r = list.map((p, i) => a.push({ codec_type: 'audio', stream_index: 0, data_hash: 'SHA256:' + sha(i), ...p })); a.finish(); return r; };
  async function* list(values) { yield* values; }
  const compare = (sourceTail, outputTail) => { const a = rows(packets(sourceTail, true), aac, 'isobmff'), b = rows(packets(outputTail, false), output, 'matroska');
    return evidence.compareRemuxPackets(3, 3, list(a), list(b), { audioTrim: { source: aac, output, sourceSamples: 1024, outputSamples: 1024, sourceFamily: 'isobmff', outputFamily: 'matroska' } }); };
  assert.equal((await compare(128, 128)).audioTrim.source.trailingSamples, '128');
  for (const outputTail of [0, 127, 129]) await assert.rejects(compare(128, outputTail), { code: 'REMUX_AUDIO_TRIM' }, String(outputTail));
});
