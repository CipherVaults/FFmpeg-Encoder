'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const syncFs = require('node:fs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { createRemuxValidator } = require('../src/remux-validation.cjs');
const { collectRemuxEvidence, getCollectedRemuxEvidence, remuxCodecParameters, createRemuxPacketAccumulator, compareRemuxPackets } = require('../src/remux-evidence.cjs');
const { EVIDENCE_BUDGET } = require('../src/operation-controls.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');
const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const admission = require('./helpers/remux-admission-fixture.cjs');
const HASH = 'a'.repeat(64), OUTPUT = '715e278f-1b7e-4d19-948d-a952b68c328e';
const clone = structuredClone, sha = n => createHash('sha256').update(String(n)).digest('hex');
function source() {
  return { streams: [{ index: 1, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 40, width: 2, height: 2,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '1:1', field_order: 'progressive',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left',
    time_base: '1/30000', avg_frame_rate: '30/1', r_frame_rate: '30/1', has_b_frames: 2,
    codec_tag_string: 'avc1', extradata_size: 49, extradata_hash: 'SHA256:' + sha('video'), disposition: { default: 1 }, tags: { title: 'Video' } },
  { index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2,
    channel_layout: 'stereo', time_base: '1/48000', codec_tag_string: 'mp4a', extradata_size: 5,
    extradata_hash: 'SHA256:' + sha('audio'), disposition: { default: 1 }, tags: { title: 'Audio' } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2', size: '16384', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0,
    tags: { title: 'Packet fixture' } }, chapters: [], programs: [], stream_groups: [] };
}
function packets(stream, side) {
  if (stream.codec_type === 'attachment') return [];
  if (stream.codec_type === 'subtitle') return [{ codec_type: 'subtitle', stream_index: stream.index, pts: 1000, dts: 1000,
    duration: 1000, size: '5', flags: 'K__', data_hash: 'SHA256:' + sha('subtitle') }];
  const video = stream.codec_type === 'video', grid = video ? [0, 3, 1, 2, 4, 5] : [0, 1, 2, 3];
  return grid.map((unit, i) => ({ codec_type: stream.codec_type, stream_index: stream.index,
    pts: video ? side === 'output' ? Math.round(unit * 1000 / 30) : unit * 1000 : unit * 1024,
    ...(video && side === 'output' && i < 2 ? {} : { dts: video ? side === 'output' ? Math.round((i - 2) * 1000 / 30) : (i - 2) * 1000 : unit * 1024 }),
    duration: video ? side === 'output' ? 33 : 1000 : 1024, size: String(video ? admission.packet(i).length : 8),
    flags: video && ![0, 4].includes(i) ? '___' : 'K__', data_hash: 'SHA256:' + (video ? admission.hash(admission.packet(i)) : sha(stream.codec_type + ':' + i)) }));
}
async function setup(t, { mutatePackets, mutateSource, mutateOutput, mutateHeaders, mutateNals, mutateAudioFrames, mutateRawPackets, mutateCodedHashes, extradata, window, pcm, abortAt, diagnostics, changeCapture, maxConcurrentChildren = 1, validatorApi = { createRemuxValidator }, api = { collectRemuxEvidence } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-packet-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('remux-packet-')); await fs.rm(root, { recursive: true, force: true }); });
  const sourcePath = path.join(root, 'source.inert'), outputPath = path.join(root, 'output.inert');
  await fs.writeFile(outputPath, Buffer.alloc(16384, 2));
  const probe = source();
  for (const stream of probe.streams) {
    const data = admission.extra(stream); stream.extradata_size = data.length; stream.extradata_hash = 'SHA256:' + admission.hash(data);
  }
  mutateSource?.(probe); probe.format.nb_streams = probe.streams.length;
  await fs.writeFile(sourcePath, require('./helpers/mov-fixture.cjs').playbackFixture(probe, 16384));
  const request = { fileId: 'packet', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'matroska', range: null, omissionRequestIds: [] };
  const assessment = assessRemux({ request, probe, sourceFingerprint: HASH }); assert.equal(assessment.status, 'qualification-required');
  const output = clone(probe); output.streams.forEach((s, i) => { s.index = i; s.codec_tag_string = '[0][0][0][0]'; if (s.codec_type === 'video') s.time_base = '1/1000'; });
  output.format.format_name = 'matroska,webm'; output.format.tags[MARKER_KEY] = '1'; output.format.tags[OUTPUT_ID_KEY] = OUTPUT; mutateOutput?.(output);
  const calls = [], controller = new AbortController(); let active = 0, peakChildren = 0;
  const scanPackets = (stream, call = null) => {
    const values = Array.from({ length: 6 }, (_, i) => admission.packet(i));
    if (mutateNals) {
      const nals = [admission.sps({ width: stream.width, height: stream.height, level: stream.level }), admission.pps(), admission.sei()];
      const data = admission.avcNals([...(call ? mutateNals(nals, call) || nals : nals), admission.packet(0).subarray(4)]);
      const filler = Buffer.concat([Buffer.from([12]), Buffer.alloc(2048 - data.length - 6, 255), Buffer.from([128])]);
      values[0] = Buffer.concat([data, admission.avcNals([filler])]);
    }
    return values;
  };
  const run = async (file, args, options) => {
    assert.ok(active < maxConcurrentChildren); active++; peakChildren = Math.max(peakChildren, active);
    if (maxConcurrentChildren === 2) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof options.onStdoutChunk, 'function');
    const input = args[args.indexOf('-i') + 1], side = input === sourcePath || path.basename(input).startsWith('source-') ? 'source' : 'output', media = side === 'source' ? probe : output;
    const call = { args, side, file }; calls.push(call); assert.ok(!args.includes('-show_frames') || args.includes('-read_intervals'));
    try {
      let bytes, auxBytes = 0;
      if (args.includes('-show_packets')) {
        assert.ok(!args.includes('-select_streams')); const records = media.streams.flatMap(s => {
          const rows = packets(s, side);
          if (s.codec_type === 'video') scanPackets(s).forEach((bytes, i) => { rows[i].size = String(bytes.length); rows[i].data_hash = 'SHA256:' + admission.hash(bytes); });
          return rows;
        });
        const headers = clone(media.streams); mutateHeaders?.(headers, side);
        bytes = Buffer.from(JSON.stringify({ packets: mutatePackets?.(records, side) || records, programs: [], stream_groups: [], streams: headers }));
      } else if (args.includes('-show_data')) {
        const index = Number(args[args.indexOf('-select_streams') + 1]), stream = media.streams.find(s => s.index === index);
        bytes = Buffer.from(admission.hexDump(extradata?.(call, stream) || admission.extra(stream)));
      } else if (args.includes('-show_frames')) {
        const index = Number(args[args.indexOf('-select_streams') + 1]), stream = media.streams.find(s => s.index === index);
        let frames = [{ media_type: 'audio', stream_index: index, pts: 0, nb_samples: 1024, sample_fmt: stream.sample_fmt,
          sample_rate: stream.sample_rate, channels: stream.channels, channel_layout: stream.channel_layout }];
        frames = mutateAudioFrames?.(frames, call) || frames; bytes = Buffer.from(JSON.stringify({ frames }));
      } else if (args.includes('-show_streams')) {
        const index = Number(args[args.indexOf('-select_streams') + 1]);
        bytes = Buffer.from(JSON.stringify({ programs: [], stream_groups: [], streams: [media.streams.find(s => s.index === index)] }));
      } else if (args.includes('-bsf:v')) {
        const stream = media.streams.find(s => s.codec_type === 'video');
        const values = scanPackets(stream, call); bytes = Buffer.concat(mutateRawPackets?.(values, call) || values);
        const selected = media.streams.filter(s => s.codec_type !== 'attachment');
        const records = selected.flatMap(s => { const result = packets(s, side);
          if (s.codec_type === 'video') scanPackets(s).forEach((bytes, i) => { result[i].size = String(bytes.length); result[i].data_hash = 'SHA256:' + admission.hash(bytes); });
          return result; });
        const codedRows = mutatePackets?.(records, side) || records;
        const text = '#hash: SHA256\n' + codedRows.map(p =>
          `${selected.findIndex(s => s.index === p.stream_index)}, 0, 0, 1, ${p.size}, ${String(p.data_hash).slice(7)}\n`).join('');
        const auxiliary = Buffer.from(mutateCodedHashes?.(text, call) ?? text);
        auxBytes = auxiliary.length; await options.onStdoutChunk(auxiliary, 3);
      } else if (args.includes('framehash')) {
        assert.equal(args[args.indexOf('-frames:v') + 1], '1'); assert.ok(input.endsWith('.h264') && !args.includes('-ss'));
        assert.ok(!args.includes('-vf') && !args.includes('-s'));
        const values = window?.(call) || [sha('frame0')];
        bytes = Buffer.from('#hash: SHA256\n' + values.map((hash, i) => `0, ${i}, ${i}, 1, 6, ${hash}\n`).join(''));
        if (args.includes('pipe:3')) {
          const tail = window?.({ ...call, windowPosition: 'end' }) || [sha('frame0')];
          const auxiliary = Buffer.from('#hash: SHA256\n' + tail.map((hash, i) => `0, ${i}, ${i}, 1, 6, ${hash}\n`).join(''));
          auxBytes = auxiliary.length; await options.onStdoutChunk(auxiliary, 3);
        }
      } else { assert.ok(args.includes('pcm_f32le')); bytes = pcm?.(call) || Buffer.alloc(4096 * 2 * 4, 7); }
      for (let offset = 0; offset < bytes.length; offset += 127) {
        await options.onStdoutChunk(bytes.subarray(offset, offset + 127));
        if (abortAt?.(call)) controller.abort();
      }
      const stderr = diagnostics?.(call, media) || '';
      const result = { exitCode: 0, stdout: '', stderr, stderrCapture: { truncated: false, totalBytes: Buffer.byteLength(stderr) },
        ...(args.includes('pipe:3') ? { auxCapture: { streamed: true, truncated: false, totalBytes: auxBytes } } : {}),
        stdoutCapture: { streamed: true, truncated: false, totalBytes: bytes.length } };
      return changeCapture?.(result, call) || result;
    } finally { active--; }
  };
  const options = { assessment, sourceProbe: probe, outputProbe: output, runtimeIdentity: HASH, outputId: OUTPUT,
    sourcePath, outputPath, stageDirectory: root, ffmpeg: path.join(root, 'fake-ffmpeg'), ffprobe: path.join(root, 'fake-ffprobe'),
    run, signal: controller.signal, budget: EVIDENCE_BUDGET, verificationMethod: 'packet-identity-v1', maxConcurrentChildren };
  const registry = validatorApi.createRemuxValidator({ requireQualification: p => ({ status: 'verified', ...Object.fromEntries(['runtimeIdentity', 'operation', 'inputFamily', 'target', 'cellId', 'requirementIds'].map(k => [k, p[k]])),
    evidenceId: 'injected-only', maxTimestampError: { numerator: '1', denominator: '500' }, maxChapterError: { numerator: '1', denominator: '500' } }) });
  const plan = registry.prepare({ assessment, runtimeIdentity: HASH, outputId: OUTPUT, cellId: 'injected-only' });
  return { calls, options, peakChildren: () => peakChildren, collect: more => api.collectRemuxEvidence({ ...options, ...more }), validate: (receipt, mutate) => {
    const essence = clone(getCollectedRemuxEvidence(receipt, { assessment, runtimeIdentity: HASH, outputId: OUTPUT })); mutate?.(essence);
    return registry.validate({ plan, outputProbe: output, essenceEvidence: essence });
  } };
}
test('packet identity: one combined hash/header child per file, bounded native windows, complete PCM and unchanged timing validation', async t => {
  const s = await setup(t), receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  assert.equal(receipt.verificationMethod, 'packet-identity-v1'); assert.equal(s.calls.length, 12); // 2 packets +2 bound headers +2 scans/key captures +2 paired window decodes +2 audio admission +2 PCM
  assert.equal(s.calls.filter(c => c.args.includes('-show_packets')).length, 2);
  for (const call of receipt.invocations.filter(c => c.args.includes('-show_packets'))) {
    assert.equal(call.artifact, undefined, 'Canonical private rows retain metadata without duplicating its entire JSON capture.');
    assert.match(call.sha256, /^[a-f0-9]{64}$/); assert.equal(call.bytes, call.stdoutCapture.totalBytes);
  }
  assert.ok(s.calls.filter(c => c.args.includes('pcm_f32le')).every(c => c.args[c.args.indexOf('-reinit_filter') + 1] === '0'));
  assert.equal(s.validate(receipt).valid, true, JSON.stringify(s.validate(receipt)));
  assert.equal(receipt.essenceEvidence.streams[0].source.cadence.classification, 'constant');
  assert.equal(receipt.essenceEvidence.streams[0].output.cadence.classification, 'variable');
  assert.equal(receipt.comparisons[0].outputInferredDts, 2); assert.equal(receipt.ioBytes.packetPayload, '136');
  assert.ok(receipt.comparisons[0].peakReorderRows <= 17);
  for (const mutate of [e => { delete e.streams[0].source.decodedWindows; }, e => { e.streams[0].output.decodedWindows.end.sha256 = HASH; },
    e => { delete e.streams[1].output.pcm; }, e => { e.streams[1].output.pcm.samples = '1'; }, e => { e.streams[0].output.decoderParametersSha256 = HASH; },
    e => { e.verificationMethod = 'renderer-choice'; }, e => { e.verificationMethod = 'complete-native-v1'; },
    e => { delete e.streams[0].source.admission; }, e => { e.streams[0].output.admission.complete = false; },
    e => { e.streams[0].output.admission.configurationSha256 = HASH; }, e => { e.streams[1].source.admission.nativeStartFrames = 257; },
    e => { e.streams[0].output.admission.seiUnits = -1; }, e => { e.streams[1].source.admission.nativeStartFrames = 0; },
    e => { e.streams[0].source.decodedWindows.end.frameCount = 2; }]) assert.equal(s.validate(receipt, mutate).valid, false);
});

test('main-owned paired acquisition overlaps at two children, drains both sides and deduplicates hash-bound initialization', async t => {
  const s = await setup(t, { maxConcurrentChildren: 2 }), receipt = await s.collect();
  assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure)); assert.equal(s.validate(receipt).valid, true);
  assert.equal(s.peakChildren(), 2); assert.equal(receipt.profile.peakChildren, 2);
  assert.equal(s.calls.filter(c => c.args.includes('-show_data')).length, 2);
  assert.ok(s.calls.filter(c => c.args.includes('-show_packets')).every(c => !c.args.includes('-show_data_hash')));
  assert.ok(s.calls.filter(c => c.args.includes('-bsf:v')).every(c => c.args.includes('framehash') && c.args.includes('pipe:3')));
});

test('collector rejects non-packet parallelism and every width outside the private one/two-child bound before acquisition', async () => {
  for (const options of [{ maxConcurrentChildren: 3 }, { maxConcurrentChildren: 0 }, { maxConcurrentChildren: '2' },
    { maxConcurrentChildren: 2, verificationMethod: 'complete-native-v1' }])
    await assert.rejects(collectRemuxEvidence(options), { code: 'REMUX_EVIDENCE_RUNNER' });
});

test('combined coded hash pipe requires exact stream/count/size/SHA coverage and its new guards kill mutants', async t => {
  const original = require('../src/remux-evidence.cjs');
  for (const [guard, replacement, mutate, code] of [
    ['hashHeader && /^\\d+$/.test(columns[0])', '/^\\d+$/.test(columns[0])', text => text.replace('#hash: SHA256', '#hash: MD5'), 'REMUX_PACKET_PAYLOAD'],
    ['Number.isSafeInteger(ordinal) && identities[ordinal]', 'Number.isSafeInteger(ordinal)', text => text.replace('\n0,', '\n31,'), 'REMUX_PACKET_PAYLOAD'],
    ['BigInt(columns[4]) === BigInt(row.size)', 'true', text => text.replace(', 6,', ', 7,'), 'REMUX_PACKET_PAYLOAD'],
    ['identity.count === identity.complete.count && (await identity.cursor.next()).done', 'true', text => text.slice(0, text.lastIndexOf('\n', text.length - 2) + 1), 'REMUX_PACKET_COUNT'],
    ['result.summary.packetPayloadSha256 === collected.record.contentSha256', 'true', text => text.replace(admission.hash(admission.packet(0)), sha('flipped-bit')), 'REMUX_PACKET_PAYLOAD'],
  ]) {
    const negative = async api => { const s = await setup(t, { api, mutateCodedHashes: (text, call) => call.side === 'output' ? mutate(text) : text });
      assert.equal((await s.collect()).failure?.code, code);
      assert.equal(s.calls.filter(c => c.side === 'output' && c.args.includes('-show_frames')).length, 0,
        'No output native child may run after incomplete or contradictory coded identity.'); };
    await negative(original);
    if (guard !== replacement) await assert.rejects(negative(variant(guard, replacement)), assert.AssertionError);
  }
  for (const [mutate, code] of [
    [text => text + text.split('\n')[1] + '\n', 'REMUX_PACKET_COUNT'],
    [text => text.replace(/, [a-f0-9]{64}\n/, ', invalid\n'), 'REMUX_PACKET_PAYLOAD'],
  ]) { const s = await setup(t, { mutateCodedHashes: mutate }); assert.equal((await s.collect()).failure?.code, code); }
  const guard = "maximumChildren === 1 || maximumChildren === 2 && verificationMethod === 'packet-identity-v1'";
  await assert.rejects(assert.rejects(variant(guard, 'true').collectRemuxEvidence({ maxConcurrentChildren: 3 }), { code: 'REMUX_EVIDENCE_RUNNER' }), assert.AssertionError);
});

async function durableBatch(t, api = require('../src/remux-evidence.cjs'), failure = null) {
  const s = await setup(t, { api }), open = fs.open.bind(fs); let live = 0, peak = 0, started = 0, closed = 0, syncs = 0;
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args);
    if (flags === 'r+') {
      started++; live++; peak = Math.max(peak, live);
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle), stat = handle.stat.bind(handle); let synced = false;
      handle.stat = async (...a) => { const actual = await stat(...a);
        if (failure === 'before' && !synced || failure === 'after' && synced) actual.ino += 1n;
        return actual; };
      handle.sync = async () => { syncs++; await new Promise(resolve => setImmediate(resolve));
        if (failure === 'sync') throw Object.assign(Error('injected disk error'), { code: 'EIO' }); await sync(); synced = true; };
      handle.close = async () => { closed++; live--; return close(); };
    }
    return handle;
  });
  const receipt = await s.collect();
  assert.ok(started >= 8); assert.ok(peak > 1 && peak <= 8); assert.equal(live, 0); assert.equal(started, closed);
  if (failure) { assert.equal(receipt.status, 'failed'); assert.equal(receipt.failure.code, failure === 'sync' ? 'EIO' : 'REMUX_EVIDENCE_CHANGED');
    assert.throws(() => s.validate(receipt), { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' }); }
  else { assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
    assert.equal(syncs, receipt.profile.deferredSyncs); assert.ok(receipt.profile.deferredSyncs >= 8); assert.equal(s.validate(receipt).valid, true); }
}
test('fast evidence batches every durability sync at width eight before completion and drains all handles', durableBatch);
for (const failure of ['before', 'after', 'sync']) test(`a deferred evidence ${failure} failure prevents validation authority and drains its whole batch`, t => durableBatch(t, undefined, failure));
test('deferred sync presence, width and opened/post-sync identity guards kill their removal mutants', async t => {
  for (const [guard, replacement, failure] of [
    ['await syncCompletedStreams();', '', null],
    ['pendingSyncs.slice(at, at + 8)', 'pendingSyncs.slice(at, at + 9)', null],
    ["need(same(held.stat, await handle.stat({ bigint: true })), 'Deferred evidence sync opened a different object.'", "need(true, 'Deferred evidence sync opened a different object.'", 'before'],
    ["need(same(held.stat, await handle.stat({ bigint: true })), 'Evidence changed during deferred sync.'", "need(true, 'Evidence changed during deferred sync.'", 'after'],
  ]) await t.test(guard, async sub => { await assert.rejects(durableBatch(sub, variant(guard, replacement), failure), assert.AssertionError); });
});

test('genuine collector/validator accepts root priming representations and rejects trim/PCM/proof mutations', async t => {
  const skip = n => ({ side_data_type: 'Skip Samples', skip_samples: n, discard_padding: 0, skip_reason: 0, discard_reason: 0 });
  const options = { mutateSource: p => { p.streams[1].start_pts = 0; }, mutateOutput: p => { p.streams[1].time_base = '1/1000'; },
    mutatePackets: (p, side) => { for (const [i, row] of p.filter(p => p.codec_type === 'audio').entries()) {
      row.pts = row.dts = side === 'source' ? (i - 1) * 1024 : [-21, 0, 21, 43][i]; row.duration = side === 'source' ? 1024 : 21;
      row.size = String([377, 445, 378, 123][i]); if (i === 0) { row.flags = side === 'source' ? 'KD_' : 'K__'; row.side_data_list = [skip(1024)]; }
    } }, pcm: () => Buffer.alloc(3072 * 8, 7) };
  const s = await setup(t, options), r = await s.collect(); assert.equal(r.status, 'completed', JSON.stringify(r.failure));
  assert.equal(s.validate(r).valid, true, JSON.stringify(s.validate(r)));
  assert.deepEqual(r.essenceEvidence.streams[1].source.audioTrim, r.essenceEvidence.streams[1].output.audioTrim);
  assert.equal(r.essenceEvidence.streams[1].source.audioTrim.leadingSamples, '1024');
  for (const change of [e => { delete e.streams[1].source.audioTrim; }, e => { e.streams[1].output.audioTrim.leadingSamples++; },
    e => { e.streams[1].source.audioTrim.codedSamples = '1'; }, e => { e.streams[1].source.audioTrim.samplesPerPacket = 512; }])
    assert.equal(s.validate(r, change).valid, false);
  const bad = await setup(t, { ...options, pcm: () => Buffer.alloc(4096 * 8, 7) });
  assert.equal((await bad.collect()).failure?.code, 'REMUX_AUDIO_TRIM', 'Equal but wrongly untrimmed PCM must not launder the semantic proof.');
});

const attacks = [
  ['single-bit payload', 'REMUX_PACKET_PAYLOAD', p => { p[2].data_hash = 'SHA256:' + sha('bit'); }],
  ['drop', 'REMUX_PACKET_COUNT', p => { p.splice(4, 1); }], // Complete metadata counts now refuse before the payload pass.
  ['duplicate', 'REMUX_PACKET_REORDER', p => { p.splice(3, 0, clone(p[3])); }],
  ['reorder', 'REMUX_PACKET_KEY_FLAG', p => { [p[4], p[5]] = [p[5], p[4]]; }], // This swaps a key/non-key pair; metadata now refuses before hashing.
  ['truncated tail', 'REMUX_PACKET_COUNT', p => { p.pop(); }],
  ['extra tail', 'REMUX_PACKET_COUNT', p => { const extra = clone(p.at(-1)); extra.pts += 1024; extra.dts += 1024; p.push(extra); }],
  ['size', 'REMUX_PACKET_SIZE', p => { p[2].size = '19'; }],
  ['key flag', 'REMUX_PACKET_KEY_FLAG', p => { p[2].flags = 'K__'; }],
  ['PTS one tick beyond tolerance', 'REMUX_PACKET_TIMING', p => { p[2].pts += 3; }],
  ['DTS one tick beyond tolerance', 'REMUX_PACKET_TIMING', p => { p[2].dts += 3; }],
  ['duration one tick beyond tolerance', 'REMUX_PACKET_TIMING', p => { p[2].duration += 3; }],
  ['interior DTS missing', 'REMUX_PACKET_DTS', p => { delete p[3].dts; }],
  ['priming side metadata', 'REMUX_AUDIO_TRIM', p => { p[6].side_data_list = [{ side_data_type: 'Skip Samples', skip_samples: 1, discard_padding: 0, skip_reason: 0, discard_reason: 0 }]; }],
  ['swapped streams', 'REMUX_PACKET_STREAM', p => { p[0].stream_index = 1; }],
  ['corrupt flag', 'REMUX_PACKET_FLAGS', p => { p[2].flags = '__C'; }],
  ['missing payload hash', 'REMUX_PACKET_PAYLOAD', p => { delete p[2].data_hash; }],
  ['zero packet duration', 'REMUX_PACKET_TIMING', p => { p[2].duration = 0; }],
  ['unknown packet fields', 'REMUX_PACKET_SCHEMA', p => { p[2].uninterpreted = 'functional metadata'; }],
  ['contradictory seconds', 'REMUX_PACKET_TIMING', p => { p[2].pts_time = '9.000000'; }],
];
for (const [label, code, attack] of attacks) test('packet identity refuses ' + label, async t => {
  const s = await setup(t, { mutatePackets: (p, side) => { if (side === 'output') attack(p); } });
  const r = await s.collect(); assert.equal(r.status, 'failed', label); assert.equal(r.failure.code, code, JSON.stringify(r.failure));
  assert.throws(() => getCollectedRemuxEvidence(r, { assessment: s.options.assessment, runtimeIdentity: HASH, outputId: OUTPUT }), { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' });
});
test('extradata and every codec interpretation field refuse independently of packet bytes', async t => {
  for (const mutate of [o => { o.streams[0].extradata_hash = 'SHA256:' + sha('changed'); }, o => { delete o.streams[0].extradata_hash; },
    o => { o.streams[0].sample_aspect_ratio = '2:1'; }, o => { o.streams[0].profile = 'Main'; }, o => { o.streams[0].codec_tag_string = 'avc3'; },
    o => { o.streams[1].sample_rate = '44100'; }, o => { o.streams[1].bits_per_raw_sample = 16; }]) {
    const s = await setup(t, { mutateOutput: mutate }), r = await s.collect(); assert.equal(r.status, 'failed'); assert.equal(r.failure.code, 'REMUX_CODEC_PARAMETERS');
  }
});
test('bounded windows refuse empty, excessive, mismatched and malformed native decode; complete PCM catches tail/delay', async t => {
  for (const window of [c => c.side === 'output' ? [] : null, c => c.side === 'output' ? [sha('bad')] : null,
    c => c.side === 'output' ? [sha('bad'), sha('bad')] : null, () => [HASH, HASH, HASH]]) {
    const s = await setup(t, { window }), r = await s.collect(); assert.equal(r.status, 'failed'); assert.equal(r.failure.code, 'REMUX_PACKET_WINDOW');
  }
  for (const pcm of [c => c.side === 'output' ? Buffer.alloc(32760, 7) : null, c => c.side === 'output' ? Buffer.alloc(32768, 8) : null]) {
    const s = await setup(t, { pcm }), r = await s.collect(); assert.equal(r.status, 'failed'); assert.equal(r.failure.code, 'REMUX_PACKET_PCM');
  }
});
test('packet verification cancellation drains no later child and never creates a validation receipt', async t => {
  const s = await setup(t, { abortAt: c => c.args.includes('-show_packets') }), r = await s.collect();
  assert.equal(r.status, 'cancelled'); assert.equal(s.calls.length, 1); assert.equal(r.essenceEvidence, null);
});
test('CBS whole-header errors on either side refuse even when packet identity matches; removing CBS is killed', async t => {
  const message = 'slice_type out of range: 12, but must be in [0,9].\n';
  for (const side of ['source', 'output', 'both']) for (const hardFailure of [false, true]) {
    const applies = c => c.args.includes('h264_mp4toannexb,filter_units=remove_types=12,h264_metadata') && (c.side === side || side === 'both');
    const options = hardFailure ? { changeCapture: (r, c) => {
      if (applies(c)) throw Object.assign(Error('CBS rejected header'), { code: 'TOOL_FAILED', exitCode: 1, stderr: message }); return r;
    } } : { diagnostics: c => applies(c) ? message : '' };
    const s = await setup(t, options), r = await s.collect(); assert.equal(r.failure?.code, 'REMUX_H264_HEADER_SYNTAX');
  }
  const negative = async api => { const s = await setup(t, { api, diagnostics: c => c.args.includes('h264_mp4toannexb,filter_units=remove_types=12,h264_metadata') ? message : '' });
    assert.equal((await s.collect()).failure?.code, 'REMUX_H264_HEADER_SYNTAX'); };
  await negative(require('../src/remux-evidence.cjs'));
  await assert.rejects(negative(variant("'h264_mp4toannexb,filter_units=remove_types=12,h264_metadata'", "'h264_mp4toannexb,filter_units=remove_types=12'")), { code: 'ERR_ASSERTION' });
});
test('fast claims explicitly exclude interior decoding; complete header-proof validation kills each removal', async t => {
  const s = await setup(t), r = await s.collect(); assert.equal(r.status, 'completed', JSON.stringify(r.failure));
  assert.equal(r.verificationClaim.interiorVideoDecoded, false); assert.equal(r.verificationClaim.completeAudioDecoded, true);
  assert.match(r.verificationClaim.statement, /every header validated; start and end decoded/);
  for (const [guard, edit] of [
    ['syntax.version === 1', v => { v.version = 2; }], ['syntax.complete === true', v => { v.complete = false; }],
    ["syntax.method === 'ffmpeg-cbs-h264-v1'", v => { v.method = 'unvalidated'; }],
    ['syntax.interiorDecoded === false', v => { v.interiorDecoded = true; }],
    ['Number.isSafeInteger(syntax.nalUnits)', v => { v.nalUnits = 100.5; }],
    ['Number.isSafeInteger(syntax.sliceHeaders)', v => { v.sliceHeaders = 1.5; }],
    ['syntax.sliceHeaders > 0', v => { v.sliceHeaders = 0; }],
    ['syntax.nalUnits >= syntax.sliceHeaders', v => { v.nalUnits = 0; }],
  ]) {
    const negative = async validatorApi => { const h = await setup(t, { validatorApi }), receipt = await h.collect();
      assert.equal(h.validate(receipt, e => edit(e.streams[0].output.admission.headerSyntax)).valid, false, guard); };
    await negative({ createRemuxValidator });
    await assert.rejects(negative(variant(guard, 'true', 'remux-validation.cjs')), { code: 'ERR_ASSERTION' });
  }
  assert.equal(s.validate(r, e => { delete e.verificationClaim; }).valid, false);
  assert.equal(s.validate(r, e => { e.verificationClaim.interiorVideoDecoded = true; }).valid, false);
});

const spsAttacks = [
  ['profile', { profile: 77 }, 'REMUX_H264_PROFILE'], ['level', { level: 41 }, 'REMUX_H264_LEVEL'],
  ['dimensions', { width: 4 }, 'REMUX_H264_GEOMETRY'], ['crop', { cropBottom: 6 }, 'REMUX_H264_GEOMETRY'],
  ['bit depth', { depth: 2 }, 'REMUX_H264_BIT_DEPTH'], ['chroma', { chroma: 2 }, 'REMUX_H264_CHROMA'],
  ['field coding', { frameOnly: 0 }, 'REMUX_H264_FIELD_CODING'], ['SAR', { sar: [2, 1] }, 'REMUX_H264_SAR'],
  ['colour primaries', { colour: [9, 1, 1] }, 'REMUX_H264_COLOUR_PRIMARIES'], ['PQ transfer', { colour: [1, 16, 1] }, 'REMUX_H264_COLOUR_TRANSFER'],
  ['matrix', { colour: [1, 1, 9] }, 'REMUX_H264_COLOUR_MATRIX'], ['range', { fullRange: 1 }, 'REMUX_H264_COLOUR_RANGE'],
  ['otherwise admissible changed SPS', { refs: 3 }, 'REMUX_H264_SPS_CHANGED'],
  ['second SPS dimensions', { id: 1, width: 4 }, 'REMUX_H264_GEOMETRY'],
  ['second SPS precision', { id: 1, depth: 2 }, 'REMUX_H264_BIT_DEPTH'],
];
for (const side of ['source', 'output', 'both']) test('complete admission refuses all mid-stream SPS/PPS/SEI changes on ' + side, async t => {
  for (const [label, fields, code] of spsAttacks) {
    const s = await setup(t, { mutateNals: (n, call) => call.side === side || side === 'both' ? [...n, admission.sps(fields)] : n });
    const r = await s.collect(); assert.equal(r.failure?.code, code, side + ': ' + label + ': ' + JSON.stringify(r.failure));
    assert.equal(r.essenceEvidence, null);
  }
  for (const [nal, code] of [[admission.pps(1), 'REMUX_H264_PPS_CHANGED'],
    ...[4, 23, 137, 142, 144, 147, 148, 149].map(type => [admission.sei(type), 'REMUX_H264_HDR_SEI']),
    [admission.sei(30), 'REMUX_H264_SEI_UNSUPPORTED'], [Buffer.from([15, 128]), 'REMUX_H264_PARAMETER_EXTENSION']]) {
    const s = await setup(t, { mutateNals: (n, call) => call.side === side || side === 'both' ? [...n, nal] : n });
    assert.equal((await s.collect()).failure?.code, code);
  }
});
for (const side of ['source', 'output', 'both']) test('complete audio admission refuses packet parameter changes on ' + side, async t => {
  for (const [data, code] of [
    [{ side_data_list: [{ side_data_type: 'New Extradata' }] }, 'REMUX_AUDIO_EXTRADATA_CHANGED'],
    [{ side_data_list: [{ side_data_type: 'Param Change' }] }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ...[{ sample_rate: '44100' }, { sample_fmt: 's16' }, { channels: 1 }, { channel_layout: 'mono' }, { profile: 'HE-AAC' }, { codec_name: 'ac3' }]
      .map(fields => [fields, 'REMUX_AUDIO_PARAMETERS_CHANGED'])]) {
    const s = await setup(t, { mutatePackets: (p, current) => { if (current === side || side === 'both') Object.assign(p[8], data); } });
    const r = await s.collect(); assert.equal(r.failure?.code, code, JSON.stringify(data)); assert.equal(r.essenceEvidence, null);
  }
  for (const mutate of [f => { f[0].sample_fmt = 's16'; }, f => { f[0].channels = 1; }, f => { f[0].sample_rate = '44100'; },
    f => { f[0].nb_samples = 2048; }, f => { delete f[0].channel_layout; }, f => { f.length = 0; }]) {
    const s = await setup(t, { mutateAudioFrames: (f, c) => { if (c.side === side || side === 'both') mutate(f); } });
    assert.equal((await s.collect()).failure?.code, 'REMUX_AUDIO_PARAMETERS_CHANGED');
  }
  const s = await setup(t, { diagnostics: c => (c.side === side || side === 'both') && c.args.includes('pcm_f32le')
    ? '[abuffer] Changing audio frame properties on the fly is not supported.\n' : '' });
  assert.equal((await s.collect()).failure?.code, 'REMUX_AUDIO_PARAMETERS_CHANGED');
});
test('hash-bound key capture isolates open-GOP/B-frame tail, short last GOP and audio-only tail without seeking', async t => {
  const s = await setup(t, { mutatePackets: (p, side) => {
    // The final video key is packet 4; packet 5 is the reordered tail. Audio
    // extends well beyond both, so container/audio end must not select a key.
    for (const packet of p.filter(p => p.codec_type === 'audio')) { packet.pts += 48000; packet.dts += 48000; }
    [p[4].pts, p[5].pts] = [p[5].pts, p[4].pts]; // final key precedes a reordered B tail
  } });
  const r = await s.collect(); assert.equal(r.status, 'completed', JSON.stringify(r.failure));
  assert.ok(s.calls.every(c => !c.args.includes('-ss')));
  assert.equal(r.essenceEvidence.streams[0].source.decodedWindows.end.keyPacketIndex, 4);
  for (const c of s.calls.filter(c => c.args.includes('rawvideo'))) {
    for (const input of c.args.flatMap((a, i) => a === '-i' ? [c.args[i + 1]] : [])) {
      const i = input.includes('-end.') ? 4 : 0;
      assert.deepEqual(await fs.readFile(input), admission.annex([admission.sps(), admission.pps(), admission.packet(i).subarray(4)]));
    }
  }
  const bad = await setup(t, { mutateRawPackets: p => { p[0] = admission.packet(1); } });
  assert.equal((await bad.collect()).failure?.code, 'REMUX_PACKET_PAYLOAD');
});
test('new packet-admission, native-start, frozen-audio and exact-key guards each kill their removal mutant', async t => {
  for (const [guard, replacement, options, code] of [
    ["!/new[ _]?extradata/i.test(entry.side_data_type)", 'true', { mutatePackets: p => { p[8].side_data_list = [{ side_data_type: 'New Extradata' }]; } }, 'REMUX_AUDIO_EXTRADATA_CHANGED'],
    ["!/param(?:eter)?[ _]?change/i.test(entry.side_data_type)", 'true', { mutatePackets: p => { p[8].side_data_list = [{ side_data_type: 'Param Change' }]; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ['!own(packet, field) || String(packet[field]) === String(stream[field])', 'true', { mutatePackets: p => { p[8].sample_rate = '44100'; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ['try { nativeFrames([frame], stream); }', 'try { void frame; }', { mutateAudioFrames: f => { f[0].sample_fmt = 's16'; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ["['sample_fmt', 'channels', 'channel_layout'].every(k => own(frame, k))", 'true', { mutateAudioFrames: f => { delete f[0].channel_layout; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ["integer(frame.nb_samples, 'Native AAC samples', 1n) <= BigInt(admitted.samples)", 'true', { mutateAudioFrames: f => { f[0].nb_samples = 2048; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ["frames > 0, 'No native audio admission window.'", "true, 'No native audio admission window.'", { mutateAudioFrames: f => { f.length = 0; } }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ["pcmArgs.splice(pcmArgs.indexOf('-i'), 0, '-reinit_filter', '0');", "pcmArgs.splice(pcmArgs.indexOf('-i'), 0, '-reinit_filter', '1');",
      { diagnostics: c => c.args.includes('pcm_f32le') && c.args[c.args.indexOf('-reinit_filter') + 1] === '0'
        ? 'Changing audio frame properties on the fly is not supported.\n' : '' }, 'REMUX_AUDIO_PARAMETERS_CHANGED'],
    ["result.summary.packetPayloadSha256 === collected.record.contentSha256", 'true', { mutateRawPackets: p => { p[0] = admission.packet(1); } }, 'REMUX_PACKET_PAYLOAD'],
  ]) {
    const negative = async api => { const s = await setup(t, { ...options, api }), r = await s.collect(); assert.equal(r.failure?.code, code, guard); };
    await negative(require('../src/remux-evidence.cjs')); await assert.rejects(negative(variant(guard, replacement)), { code: 'ERR_ASSERTION' });
  }
});

test('independent compressed admission validation guards kill forged-proof mutants', async t => {
  for (const [guard, mutation] of [
    ["admission.version === 1 && admission.complete === true && HASH.test(admission.configurationSha256)", e => { e.streams[0].source.admission.complete = false; }],
    ['admission.nativeStartFrames <= 256', e => { e.streams[1].source.admission.nativeStartFrames = 257; }],
    ["item.source.admission.configurationSha256 !== item.output.admission.configurationSha256", e => { e.streams[0].output.admission.configurationSha256 = HASH; }],
  ]) {
    const negative = async validatorApi => { const s = await setup(t, { validatorApi }), receipt = await s.collect();
      assert.equal(receipt.status, 'completed'); assert.equal(s.validate(receipt, mutation).valid, false, guard); };
    await negative({ createRemuxValidator });
    await assert.rejects(negative(variant(guard, guard.includes('!==') ? 'false' : 'true', 'remux-validation.cjs')), { code: 'ERR_ASSERTION' });
  }
});
test('Matroska end key at1198 is captured by exact packet index without ambiguous cue/DTS seeks', async t => {
  const options = {
    mutateSource: p => { p.format.duration = '1200'; },
    mutatePackets: (p, side) => { const v = p.filter(r => r.codec_type === 'video'); for (let i = 4; i < 6; i++) {
      v[i].pts = side === 'source' ? 35940000 + (i - 4) * 1000 : 1198000 + Math.round((i - 4) * 1000 / 30);
      v[i].dts = side === 'source' ? 35938000 + (i - 4) * 1000 : 1197933 + Math.round((i - 4) * 1000 / 30);
    } },
  };
  const s = await setup(t, options), r = await s.collect(); assert.equal(r.status, 'completed', JSON.stringify(r.failure));
  assert.equal(r.essenceEvidence.streams[0].output.decodedWindows.end.keyPacketIndex, 4);
  assert.ok(s.calls.every(c => !c.args.includes('-ss')));
});
test('a parameter-free long GOP still reports verified packet advancement; every lost/changed auxiliary scan record fails closed', async t => {
  const progress = [], s = await setup(t);
  const r = await s.collect({ onProgress: record => progress.push(record) }); assert.equal(r.status, 'completed', JSON.stringify(r.failure));
  assert.equal(r.essenceEvidence.streams[0].source.admission.scannedBytes, 0);
  assert.ok(progress.some(p => p.stage.endsWith('-complete-parameters') && p.completed > 0));
  for (const [mutate, code] of [[p => { p.pop(); }, 'REMUX_H264_SCAN_COVERAGE'], [p => { p.push(p[0]); }, 'REMUX_H264_SCAN_COVERAGE'],
    [p => { p[2] = admission.packet(1); }, 'REMUX_PACKET_PAYLOAD']]) {
    const s = await setup(t, { mutateRawPackets: p => { mutate(p); } }); assert.equal((await s.collect()).failure?.code, code);
  }
  for (const change of [r => { delete r.stdoutCapture; }, r => { r.stdoutCapture.truncated = true; }, r => { r.stdoutCapture.totalBytes++; }]) {
    const s = await setup(t, { changeCapture: (r, c) => { if (c.args.includes('-bsf:v')) change(r); } });
    assert.equal((await s.collect()).failure?.code, 'REMUX_EVIDENCE_RUNNER');
  }
  const s2 = await setup(t, { changeCapture: (r, c) => { if (c.args.includes('pcm_f32le')) throw Object.assign(Error('native failed'), {
    code: 'TOOL_FAILED', exitCode: 1, stderr: 'Changing audio frame properties on the fly is not supported.\n' }); } });
  assert.equal((await s2.collect()).failure?.code, 'REMUX_AUDIO_PARAMETERS_CHANGED');
});
function accumulator(stream, overrides = {}) { return createRemuxPacketAccumulator(stream, { maxRecords: 20000, maxSourceBytes: 16384, maxDurationSeconds: 2, family: 'isobmff', ...overrides }); }
test('packet unit/size/duration/reorder/DTS/side metadata guards fail closed', async () => {
  const stream = source().streams[0], packet = packets(stream, 'source')[0];
  for (const [mutate, options, code] of [
    [p => { p.size = '16385'; }, {}, 'REMUX_PROPORTIONAL_BUDGET'], [p => {}, { maxRecords: 0 }, 'REMUX_PROPORTIONAL_BUDGET'],
    [p => { p.pts = 90001; }, {}, null], [p => { p.side_data_list = [{ side_data_type: 'unknown' }]; }, {}, 'REMUX_PACKET_SIDE_DATA']]) {
    const a = accumulator(stream, options), p = clone(packet); mutate(p);
    if (code) assert.throws(() => a.push(p), { code });
    else { a.push(packet); assert.throws(() => a.push(p), { code: 'REMUX_PROPORTIONAL_BUDGET' }); }
  }
  assert.throws(() => accumulator({ ...stream, has_b_frames: 17 }), { code: 'REMUX_PACKET_REORDER' });
  const a = accumulator(stream); for (let i = 0; i < 20; i++) a.push({ ...packet, pts: 1000 + i });
  assert.throws(() => a.push({ ...packet, pts: 0 }), { code: 'REMUX_PACKET_REORDER' });
  const empty = accumulator(stream); assert.throws(() => empty.finish(), { code: 'REMUX_PACKET_COUNT' });
  const noKey = accumulator(stream); noKey.push({ ...packet, flags: '___' }); assert.throws(() => noKey.finish(), { code: 'REMUX_PACKET_WINDOW' });
});
test('lazy million-packet comparison remains bounded and finds an interior one-tick timing mutation', async () => {
  const total = 1000000; let live = 0, maxLive = 0;
  async function* rows(change = false) {
    try { for (let i = 0; i < total; i++) {
      const pts = String(i * 3 + (change && i === 555555 ? 3 : 0)); live++; maxLive = Math.max(maxLive, live);
      yield { size: '1', hash: HASH, key: false, discard: false, sideSha256: HASH,
        pts: { numerator: pts, denominator: '1000' }, dts: { numerator: String(i * 3), denominator: '1000' }, duration: { numerator: '3', denominator: '1000' } };
      live--;
    } } finally { live = Math.max(0, live - 1); }
  }
  // A real Node child with a fixed 64MiB heap makes array retention fail with
  // OOM, independent of V8's ordinary process-wide heap/RSS reservation policy.
  const script = `const {compareRemuxPackets}=require(${JSON.stringify(require.resolve('../src/remux-evidence.cjs'))});
    ${rows.toString()}
    const total=1000000,HASH='a'.repeat(64);let live=0,maxLive=0;
    compareRemuxPackets(total,total,rows(),rows()).then(r=>{if(r.comparedUnits!=='1000000'||maxLive>2)process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});`;
  execFileSync(process.execPath, ['--max-old-space-size=64', '-e', script], { windowsHide: true, timeout: 60000, maxBuffer: 65536 });
  await assert.rejects(compareRemuxPackets(total, total, rows(), rows(true)), e => e.code === 'REMUX_PACKET_TIMING' && /555555/.test(e.message));
  assert.ok(maxLive <= 2);
});

function variant(before, after, filename = 'remux-evidence.cjs') {
  const file = path.resolve(__dirname, '../src', filename), source = syncFs.readFileSync(file, 'utf8');
  assert.equal(source.split(before).length, 2, 'One exact packet guard mutation site.');
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source.replace(before, after), file); return compiled.exports;
}
const row = () => ({ size: '1', hash: HASH, key: false, discard: false, sideSha256: HASH,
  pts: { numerator: '0', denominator: '1' }, dts: { numerator: '0', denominator: '1' }, duration: { numerator: '1', denominator: '30' } });
async function* list(values) { yield* values; }
test('packet comparison guard-removal mutants are killed independently (payload/size/key/side/timing/count/DTS)', async () => {
  const original = require('../src/remux-evidence.cjs');
  for (const [before, after, mutate, code, counts = [1, 1], prefix = {}] of [
    ['ar.hash === br.hash', 'true', r => { r.hash = sha('bit'); }, 'REMUX_PACKET_PAYLOAD'],
    ['ar.size === br.size', 'true', r => { r.size = '2'; }, 'REMUX_PACKET_SIZE'],
    ['ar.key === br.key', 'true', r => { r.key = true; }, 'REMUX_PACKET_KEY_FLAG'],
    ['ar.discard === br.discard && ar.sideSha256 === br.sideSha256', 'true', r => { r.sideSha256 = sha('side'); }, 'REMUX_PACKET_SIDE_DATA'],
    ['!greater(error, PACKET_TOLERANCE)', 'true', r => { r.pts = { numerator: '181', denominator: '90000' }; }, 'REMUX_PACKET_TIMING'],
    ['count === beforeCount && count === afterCount', 'true', () => {}, 'REMUX_PACKET_COUNT', [2, 2]],
    ['prefix.length === 0', 'true', r => { r.dts = null; }, 'REMUX_PACKET_DTS', [1, 1], { outputPrefix: true }],
  ]) {
    const negative = async api => {
      const a = row(), b = row(); mutate(b);
      await assert.rejects(api.compareRemuxPackets(...counts, list([a]), list([b]), prefix), { code });
    };
    await negative(original); await assert.rejects(negative(variant(before, after)), { code: 'ERR_ASSERTION' });
  }
  const same = row(), boundary = row(); boundary.pts = { numerator: '1', denominator: '500' };
  await compareRemuxPackets(1, 1, list([same]), list([boundary]));
  const tooFar = row(); tooFar.pts = { numerator: '181', denominator: '90000' };
  await assert.rejects(compareRemuxPackets(1, 1, list([same]), list([tooFar])), { code: 'REMUX_PACKET_TIMING' });
  const relaxed = variant('PACKET_TOLERANCE = rational(1, 500)', 'PACKET_TOLERANCE = rational(1, 499)');
  // 181/90000 is above 1/499 too; use exactly one 1/900000 tick beyond 1/500.
  tooFar.pts = { numerator: '1801', denominator: '900000' };
  await assert.rejects(compareRemuxPackets(1, 1, list([same]), list([tooFar])), { code: 'REMUX_PACKET_TIMING' });
  await relaxed.compareRemuxPackets(1, 1, list([same]), list([tooFar]));
});
test('DTS prefix/interior/count limits and H264 reorder/unit budgets each kill their guard-removal mutant', async () => {
  const original = require('../src/remux-evidence.cjs');
  for (const [guard, values] of [
    ['!seenDts', [row(), { ...row(), dts: null }, row()]],
    ['prefix.length < MAX_REORDER', [...Array.from({ length: 17 }, () => ({ ...row(), dts: null })), row()]],
  ]) {
    const negative = api => assert.rejects(api.compareRemuxPackets(values.length, values.length, list(clone(values)), list(clone(values)), { sourcePrefix: true, outputPrefix: true }), { code: 'REMUX_PACKET_DTS' });
    await negative(original); await assert.rejects(negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
  for (const [before, after, action] of [
    ["++count <= maxRecords, 'Packet record budget exceeded.'", "++count <= Number.MAX_SAFE_INTEGER, 'Packet record budget exceeded.'", api => {
      const a = api.createRemuxPacketAccumulator(source().streams[0], { maxRecords: 1, maxSourceBytes: 100, maxDurationSeconds: 2, family: 'isobmff' });
      const p = packets(source().streams[0], 'source'); a.push(p[0]); a.push(p[1]);
    }],
    ['bytes <= BigInt(maxSourceBytes)', 'true', api => api.createRemuxPacketAccumulator(source().streams[0], { maxRecords: 10, maxSourceBytes: 1, maxDurationSeconds: 2, family: 'isobmff' }).push(packets(source().streams[0], 'source')[0])],
    ['delta.n > 0n', 'true', api => { const a = api.createRemuxPacketAccumulator(source().streams[0], { maxRecords: 10, maxSourceBytes: 100, maxDurationSeconds: 2, family: 'isobmff' });
      const p = packets(source().streams[0], 'source')[0]; a.push(p); a.push(p); a.finish(); }],
  ]) {
    const negative = api => assert.throws(() => action(api)); negative(original); assert.throws(() => negative(variant(before, after)), { code: 'ERR_ASSERTION' });
  }
});
test('collector codec/header/window/PCM guards kill their mutants before any validation/publication authority', async t => {
  for (const [before, after, options, code] of [
    ['before.record.decoderParametersSha256 === after.record.decoderParametersSha256', 'true', { mutateOutput: p => { p.streams[1].bits_per_raw_sample = 16; } }, 'REMUX_CODEC_PARAMETERS'],
    ["!own(header, 'extradata_hash') || header.extradata_hash === stream.extradata_hash", 'true', { mutateHeaders: (p, side) => { if (side === 'output') p[0].extradata_hash = 'SHA256:' + sha('bad'); } }, 'REMUX_CODEC_PARAMETERS'],
    ["JSON.stringify(remuxCodecParameters({ ...header, ...(own(stream, 'extradata_hash') ? { extradata_hash: stream.extradata_hash } : {}) })) === JSON.stringify(remuxCodecParameters(stream))", 'true', { mutateHeaders: (p, side) => { if (side === 'output') p[0].width = 4; } }, 'REMUX_CODEC_PARAMETERS'],
    ['headers.size === media.streams.length', 'true', { mutateHeaders: p => { p.pop(); } }, 'REMUX_CODEC_PARAMETERS'],
    ["need(count === 1, 'Bounded native decode was empty or truncated.'", "need(true, 'Bounded native decode was empty or truncated.'", { window: () => [] }, 'REMUX_PACKET_WINDOW'],
    ['a.keyPacketIndex === b.keyPacketIndex && a.frameCount === b.frameCount && a.sha256 === b.sha256', 'true', { window: c => c.side === 'output' ? [sha('bad')] : null }, 'REMUX_PACKET_WINDOW'],
    ['before.record.pcm.bytes === after.record.pcm.bytes && before.record.pcm.sha256 === after.record.pcm.sha256 && windows.firstMismatchByte === null', 'true', { pcm: c => c.side === 'output' ? Buffer.alloc(32768, 8) : null }, 'REMUX_PACKET_PCM'],
  ]) {
    const negative = async api => { const s = await setup(t, { ...options, api }), r = await s.collect(); assert.equal(r.failure?.code, code); };
    await negative(require('../src/remux-evidence.cjs'));
    await assert.rejects(negative(variant(before, after)), { code: 'ERR_ASSERTION' });
  }
});
test('codec-header schema, leading DTS depth, per-record byte budget and cancellation remain strict', async t => {
  for (const [options, code] of [
    [{ mutateHeaders: p => { p.push(clone(p[0])); } }, 'REMUX_CODEC_PARAMETERS'],
    [{ mutateHeaders: p => { p[0].index = 31; } }, 'REMUX_CODEC_PARAMETERS'],
    [{ mutateHeaders: p => { delete p[0].has_b_frames; } }, 'REMUX_PACKET_REORDER'],
    [{ mutateHeaders: p => { p[0].has_b_frames = 17; } }, 'REMUX_PACKET_REORDER'],
    [{ mutateHeaders: p => { p[0].has_b_frames = 0; } }, 'REMUX_PACKET_REORDER'],
    [{ mutatePackets: (p, side) => { if (side === 'output') delete p[2].dts; } }, 'REMUX_PACKET_DTS'],
    [{ mutatePackets: p => { p[0].pos = 'x'.repeat(65536); } }, 'REMUX_PROPORTIONAL_BUDGET'],
  ]) { const s = await setup(t, options), r = await s.collect(); assert.equal(r.failure?.code, code); }
  const s = await setup(t); await assert.rejects(s.collect({ verificationMethod: 'untrusted' }), { code: 'REMUX_VERIFICATION_METHOD' });
});

test('new proportional and native resource guards refuse oversized units, aggregate payloads and aggregate PCM (mutants killed)', async t => {
  const original = require('../src/remux-evidence.cjs'), stream = source().streams[0], p = packets(stream, 'source')[0];
  for (const [guard, bad] of [
    ['size <= 64n * 1024n * 1024n', { ...p, size: String(64 * 1024 ** 2 + 1) }],
    ['!greater(sub(end, first), rational(maxDurationSeconds))', { ...p, duration: 90001 }],
    ['Object.keys(packet).every(key => PACKET_FIELDS.has(key))', { ...p, unexpected: true }],
  ]) {
    const negative = api => assert.throws(() => api.createRemuxPacketAccumulator(stream, { maxRecords: 100, maxSourceBytes: 1024 ** 3, maxDurationSeconds: 2, family: 'isobmff' }).push(bad));
    negative(original); assert.throws(() => negative(variant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
  const mutatePackets = packets => {
    for (const [i, p] of packets.entries()) p.size = p.codec_type === 'audio' ? '1000' : i === 0 ? '14000' : '1';
  };
  const payloadNegative = async api => { const s = await setup(t, { api, mutatePackets }), r = await s.collect(); assert.equal(r.failure?.code, 'REMUX_PROPORTIONAL_BUDGET'); };
  await payloadNegative(original);
  await assert.rejects(payloadNegative(variant("payloadBytes <= (side === 'source' ? sourceBefore.size : outputBefore.size)", 'true')), { code: 'ERR_ASSERTION' });
  const pcmNegative = async api => {
    const s = await setup(t, { api, mutateSource: p => { p.streams.push({ ...clone(p.streams[1]), index: 3 }); } });
    const r = await s.collect({ budget: { ...EVIDENCE_BUDGET, maxPcmBytes: 65535 } }); assert.equal(r.failure?.code, 'REMUX_PROPORTIONAL_BUDGET');
  };
  await pcmNegative(original); await assert.rejects(pcmNegative(variant('packetPcmBytes[side] += pcm.bytes;', 'packetPcmBytes[side] += 0;')), { code: 'ERR_ASSERTION' });
});

test('presentation order stays identical even when changed packet PTS is inside the 1/500s tolerance (mutant killed)', async t => {
  const mutatePackets = (p, side) => {
    const order = [0, 3, 1, 2, 4, 5];
    for (const [i, packet] of p.filter(p => p.codec_type === 'video').entries()) {
      packet.pts = side === 'source' ? order[i] * 30 : i === 2 ? 2 : i === 3 ? 1 : order[i];
      packet.duration = side === 'source' ? 30 : 1;
      if (packet.dts !== undefined) packet.dts = (i - 2) * (side === 'source' ? 30 : 1);
    }
  };
  const negative = async api => { const s = await setup(t, { api, mutatePackets }), r = await s.collect(); assert.equal(r.failure?.code, 'REMUX_PACKET_REORDER'); };
  await negative(require('../src/remux-evidence.cjs'));
  await assert.rejects(negative(variant('before.presentationSha256 === after.presentationSha256', 'true')), { code: 'ERR_ASSERTION' });
});

test('packet/header JSON keeps strict companion sections, stream coverage and 32-header memory bound (mutants killed)', async () => {
  const api = require('../src/remux-evidence.cjs');
  const negative = async (api, text, message) => {
    const sink = api.createRemuxJsonSink('packets', { maxRecords: 2, onRecord() {}, onAuxRecord() {} });
    await assert.rejects(async () => { await sink.push(Buffer.from(text)); await sink.finish(); }, message);
  };
  for (const text of ['{"packets":[]}', '{"packets":[],"streams":[],"unexpected":[]}',
    '{"packets":[],"streams":[],"programs":[{}]}', '{"packets":[],"streams":[],"stream_groups":[{}]}', '{"packets":[],"streams":[],"streams":[]}']) await negative(api, text);
  const large = JSON.stringify({ packets: [], streams: Array.from({ length: 33 }, () => ({})) });
  await negative(api, large, { code: 'REMUX_PROPORTIONAL_BUDGET' });
  await assert.rejects(negative(variant('++auxCount <= 32', '++auxCount <= 33'), large), { code: 'ERR_ASSERTION' });
  await assert.rejects(negative(variant("(!onAuxRecord || seen.has('streams'))", 'true'), '{"packets":[]}'), { code: 'ERR_ASSERTION' });
});

const ancillary = p => {
  p.format.format_name = 'matroska,webm';
  p.streams.push({ index: 3, codec_type: 'attachment', codec_name: 'ttf', codec_tag_string: '[0][0][0][0]', extradata_size: 64,
    extradata_hash: 'SHA256:' + sha('ttf'), tags: { filename: 'owned.ttf', mimetype: 'application/x-truetype-font' } },
  { index: 4, codec_type: 'subtitle', codec_name: 'subrip', codec_tag_string: '[0][0][0][0]', time_base: '1/1000', tags: { language: 'eng' }, disposition: { default: 0 } });
};
test('packet path preserves subtitle events/headers and attachments while accepting only exact mapped TTF discovery diagnostics', async t => {
  const diagnostic = (call, media) => call.file.endsWith('fake-ffprobe')
    ? `Unsupported codec with id 98304 for input stream ${media.streams.find(s => s.codec_type === 'attachment').index}\n` : '';
  const s = await setup(t, { mutateSource: ancillary, diagnostics: diagnostic }), r = await s.collect();
  assert.equal(r.status, 'completed', JSON.stringify(r.failure)); assert.equal(s.validate(r).valid, true, JSON.stringify(s.validate(r)));
  assert.equal(r.essenceEvidence.streams.length, 4); assert.equal(r.invocations.filter(c => c.diagnosticAssessment?.probeQuery === 'all-packets').length, 2);
  for (const diagnostics of [(c, m) => diagnostic(c, m) + (c.file.endsWith('fake-ffprobe') ? 'extra\n' : ''),
    c => c.file.endsWith('fake-ffprobe') ? 'Unsupported codec with id 98304 for input stream 0\n' : '',
    (c, m) => diagnostic(c, m).replace('98304', '12345'), (c, m) => diagnostic(c, m).replace('stream ', 'stream 9')]) {
    const s = await setup(t, { mutateSource: ancillary, diagnostics }), r = await s.collect(); assert.equal(r.failure?.code, 'REMUX_EVIDENCE_DECODE');
  }
  const truncated = await setup(t, { mutateSource: ancillary, diagnostics: diagnostic, changeCapture: r => ({ ...r, stderrCapture: { ...r.stderrCapture, truncated: true } }) });
  assert.equal((await truncated.collect()).failure?.code, 'REMUX_EVIDENCE_DECODE');
});

test('main policy rejects even a genuine complete receipt from another verification method (mutant killed)', async t => {
  const s = await setup(t), identity = await readSourceIdentity(s.options.sourcePath);
  const assessment = assessRemux({ request: s.options.assessment.request, probe: s.options.sourceProbe,
    sourceFingerprint: fingerprintRemuxSourceIdentity(identity) });
  const receipt = await s.collect({ assessment }); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  const negative = Operations => {
    const owner = new Operations({ runtimeIdentity: HASH, policyIdentity: 'main-method-test', policies: [{ id: 'native-only', inputFamily: 'isobmff',
      target: 'matroska', runtimeIdentity: HASH, allowAncillary: false, evidenceIds: ['injected-only'], verificationMethod: 'complete-native-v1' }] });
    const plan = owner.prepare({ assessment, request: assessment.request, input: s.options.sourcePath,
      output: path.join(s.options.stageDirectory, 'published.mkv'), outputId: OUTPUT, sourceIdentity: identity });
    const bindings = { plan, settings: null, environment: null, sourceIdentity: identity, sourceProbeFingerprint: plan.sourceProbeFingerprint,
      runtimeIdentity: HASH, budget: EVIDENCE_BUDGET, executionBudgetMs: 600000 };
    owner.select(bindings); owner.resolveInvocation(plan, { output: s.options.outputPath });
    assert.throws(() => owner.validate(plan, s.options.outputProbe, receipt), { code: 'REMUX_VERIFICATION_METHOD' });
  };
  negative(RemuxOperations);
  assert.throws(() => negative(variant('essence.verificationMethod === state.route.verificationMethod', 'true', 'remux-operation.cjs').RemuxOperations), { code: 'ERR_ASSERTION' });
});
