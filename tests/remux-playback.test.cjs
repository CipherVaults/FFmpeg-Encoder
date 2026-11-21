'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { ffmpeg, ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
const { observeRemuxEditLists, observeRemuxSourcePlayback } = require('../src/remux-edit-lists.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { RemuxOperations, fingerprintRemuxSourceIdentity, deriveRemuxAssessmentBudget } = require('../src/remux-operation.cjs');
const { collectRemuxEvidence } = require('../src/remux-evidence.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { atom, timedFixture, writeFixture } = require('./helpers/mov-fixture.cjs');
const runtimeIdentity = REMUX_POLICIES[0].runtimeIdentity;
function transform(bytes, type, occurrence, change) {
  let seen = 0;
  function visit(b) { const out = []; for (let at = 0; at < b.length;) {
    const size = b.readUInt32BE(at), name = b.toString('ascii', at + 4, at + 8); let body = Buffer.from(b.subarray(at + 8, at + size));
    if (name === type && seen++ === occurrence) body = change(body);
    else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(name)) body = visit(body);
    out.push(atom(name, body)); at += size;
  } return Buffer.concat(out); } return visit(bytes);
}
function wide(type, b) {
  if (type === 'elst') { const r = Buffer.alloc(8 + 20 * b.readUInt32BE(4)); b.copy(r, 0, 0, 8); r[0] = 1;
    for (let i = 0; i < b.readUInt32BE(4); i++) { r.writeBigUInt64BE(BigInt(b.readUInt32BE(8 + i * 12)), 8 + i * 20);
      r.writeBigInt64BE(BigInt(b.readInt32BE(12 + i * 12)), 16 + i * 20); b.copy(r, 24 + i * 20, 16 + i * 12, 20 + i * 12); } return r; }
  const r = Buffer.alloc(b.length + 12); b.copy(r, 1, 1, 4); r[0] = 1;
  if (type === 'tkhd') { b.copy(r, 20, 12, 20); r.writeBigUInt64BE(BigInt(b.readUInt32BE(20)), 28); b.copy(r, 36, 24); }
  else { b.copy(r, 20, 12, 16); r.writeBigUInt64BE(BigInt(b.readUInt32BE(16)), 24); b.copy(r, 32, 20); }
  return r;
}
const q = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
const raw = { streams: [{ index: 0, id: '1', codec_type: 'video', codec_name: 'h264', width: 2, height: 2 }, { index: 1, id: '2', codec_type: 'audio', codec_name: 'aac' }] };
const nativeTracks = [{ id: 1, scale: 90000, pts: [6000, 9000], durations: [3000, 3000] }, { id: 2, scale: 48000, pts: [0], durations: [1024] }];
const intervals = nativeTracks.map((t, i) => ({ outputIndex: i, firstPts: q(t.pts[0], t.scale), visibleStart: q(t.pts[0], t.scale),
  endPts: q(t.pts.at(-1) + t.durations.at(-1), t.scale), packetCount: String(t.pts.length) }));
async function inspect(t, bytes, extra = {}) { return observeRemuxEditLists({ fileReceipt: await writeFixture(t, bytes), outputProbe: raw, intervals, maxRecords: 100, ...extra }); }
async function source(t, bytes, extra = {}) { const receipt = await writeFixture(t, bytes); return observeRemuxSourcePlayback({ file: receipt.path,
  probe: raw, identity: await readSourceIdentity(receipt.path), maxRecords: 100, ...extra }); }

test('native v0/v1 durations and controls reconcile exactly, including B-frame CTTS', async t => {
  const b = timedFixture(nativeTracks, { movieScale: 1001 }); let version1 = b;
  for (const type of ['mvhd', 'tkhd', 'mdhd', 'elst']) for (let i = 0; i < (type === 'mvhd' ? 1 : 2); i++) version1 = transform(version1, type, i, b => wide(type, b));
  const result = await inspect(t, b); assert.equal(result.tracks[0].trackDuration, '134');
  assert.equal(result.tracks[0].entries.reduce((n, e) => n + BigInt(e.duration), 0n), 133n);
  assert.deepEqual((await inspect(t, version1)).tracks, result.tracks);
  // Source semantics use the edit-defined duration; the output-only absolute
  // end rule above is deliberately a separate assertion.
  const nativeSource = transform(transform(version1, 'tkhd', 0, b => { b.writeBigUInt64BE(133n, 28); return b; }),
    'mvhd', 0, b => { b.writeBigUInt64BE(133n, 24); return b; });
  await source(t, nativeSource);
  for (const [type, offset, code] of [['tkhd', 28, 'REMUX_TRACK_DURATION_UNEXPECTED'], ['mvhd', 24, 'REMUX_MOVIE_DURATION_UNEXPECTED'], ['mdhd', 24, 'REMUX_MEDIA_DURATION_UNEXPECTED']])
    await assert.rejects(inspect(t, transform(version1, type, 0, b => { b.writeBigUInt64BE(b.readBigUInt64BE(offset) + 1n, offset); return b; })), { code });
  // Same decode duration with reordered presentation timestamps: mdhd follows
  // STTS, never an enlarged CTTS endpoint.
  const reordered = [{ id: 1, scale: 90000, pts: [6000, 12000, 9000], durations: [3000, 3000, 3000] }];
  await inspect(t, timedFixture(reordered), { outputProbe: { streams: [raw.streams[0]] }, intervals: [{ outputIndex: 0,
    firstPts: q(6000, 90000), visibleStart: q(6000, 90000), endPts: q(15000, 90000), packetCount: '3' }] });
});

test('source v0/v1 rate, fractional, dwell and non-reproducible edit shapes fail closed', async t => {
  const b = timedFixture(nativeTracks);
  for (const version of [0, 1]) for (const rate of [0, 0x20000, 0x10001]) {
    const changed = transform(b, 'elst', 0, body => { if (version) body = wide('elst', body);
      body.writeUInt32BE(rate, 8 + (body.readUInt32BE(4) - 1) * (version ? 20 : 12) + (version ? 16 : 8)); return body; });
    await assert.rejects(source(t, changed), { code: 'REMUX_SOURCE_EDIT_UNSUPPORTED' });
  }
  for (const [change,code] of [[b => { b.writeUInt32BE(3, 4); return Buffer.concat([b, b.subarray(20)]); },'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED'],
    [b => Buffer.concat([b.subarray(0, 8), b.subarray(20), b.subarray(8, 20)]),'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED'],
    [b => { b.writeUInt32BE(b.readUInt32BE(20) - 1, 20); return b; },'REMUX_SOURCE_EDIT_UNSUPPORTED'],
    [b => { b.writeInt32BE(1, 24); return b; },'REMUX_SOURCE_EDIT_UNSUPPORTED']])
    await assert.rejects(source(t, transform(b, 'elst', 0, change)), { code });
});

test('source playback and native timeout/type guards have individual negatives', async t => {
  const original = timedFixture(nativeTracks);
  for (const [type, track, offset, width, value] of [['mvhd', 0, 20, 4, 131072], ['mvhd', 0, 24, 2, 0], ['mvhd', 0, 36, 4, 131072],
    ['tkhd', 1, 36, 2, 0], ['tkhd', 0, 36, 2, 256], ['tkhd', 0, 1, 3, 2], ['tkhd', 0, 40, 4, 131072]]) {
    await assert.rejects(source(t, transform(original, type, track, b => { b.writeUIntBE(value, offset, width); return b; })), { code: 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED' });
  }
  await assert.rejects(source(t, original, { identity: {} }), { code: 'REMUX_SOURCE_PLAYBACK_UNVERIFIED' });
  const omitted = transform(original, 'tkhd', 1, b => { b.writeUIntBE(2, 1, 3); b.writeUInt16BE(0, 36); return b; });
  await assert.rejects(source(t, omitted), { code: 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED' });
  assert.equal((await source(t, omitted, { selectedIndexes: [0] })).tracks[1].selected, false);
  await assert.rejects(inspect(t, original, { outputProbe: { streams: [{ ...raw.streams[0], codec_type: 'data' }, raw.streams[1]] } }), { code: 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED' });
  await assert.rejects(inspect(t, original, { timeoutMs: 0 }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  await assert.rejects(inspect(t, original, { timeoutMs: Number.MAX_SAFE_INTEGER }), { code: 'REMUX_EDIT_LIST_UNVERIFIED' });
  await inspect(t, original, { timeoutMs: 25 * 60 * 60000 });
  const now = Date.now; let clock = now(); t.mock.method(Date, 'now', () => { clock += 1000; return clock; });
  await assert.rejects(inspect(t, original, { timeoutMs: 1 }), { code: 'REMUX_NATIVE_TIMEOUT' }); t.mock.restoreAll();
});

async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-iso-controls-'));
  t.after(async () => { assert.equal(path.dirname(dir), os.tmpdir()); assert.match(path.basename(dir), /^remux-iso-controls-/); await fs.rm(dir, { recursive: true }); }); return dir; }
async function probe(file) { return JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_programs', '-show_stream_groups', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', file])).stdout); }
async function generated(t, audioSeconds = '3') {
  const dir = await directory(t), file = path.join(dir, 'input.mp4');
  await runTool(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=30:d=3', '-f', 'lavfi', '-i', 'sine=r=48000:d=' + audioSeconds,
    '-map', '0:v', '-map', '1:a', '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-bf', '0', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-ac', '2',
    '-video_track_timescale', '1000003', '-movie_timescale', '1000003', '-output_ts_offset', '0.0015', file]);
  return { dir, file, raw: await probe(file) };
}
async function lastAudioPadding(file) {
  const packets = JSON.parse((await runTool(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet_side_data=discard_padding', '-of', 'json', file])).stdout).packets;
  return packets.at(-1).side_data_list?.[0]?.discard_padding ?? 0;
}
// Remux the generated source to MP4 and MOV on forced movie clocks 1000/1001.
// Controlled muxer clock variation tests the observer, not a new route argv.
async function forcedMovieClocks(t, f, check) {
  const identity = await readSourceIdentity(f.file);
  await observeRemuxSourcePlayback({ file: f.file, probe: f.raw, identity, maxRecords: 10000 });
  for (const target of ['mp4', 'mov']) for (const movieScale of [1000, 1001]) {
    const request = { fileId: 'iso', identityRevision: 0, draftRevision: 0, operation: 'remux', target, range: null, omissionRequestIds: [] };
    const assessment = assessRemux({ request, probe: f.raw, sourceFingerprint: fingerprintRemuxSourceIdentity(identity) });
    const api = new RemuxOperations({ runtimeIdentity, policyIdentity: REMUX_POLICY_ID, policies: REMUX_POLICIES }), outputId = randomUUID(), output = path.join(f.dir, movieScale + '.' + target);
    const plan = api.prepare({ assessment, request, input: f.file, output, outputId, sourceIdentity: identity });
    api.select({ plan, settings: null, sourceIdentity: identity, sourceProbeFingerprint: plan.sourceProbeFingerprint, runtimeIdentity, environment: null, budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS });
    const args = [...api.resolveInvocation(plan, { output })]; args.splice(-1, 0, '-movie_timescale', String(movieScale)); await runTool(ffmpeg, args);
    const outputProbe = await probe(output), evidence = await collectRemuxEvidence({ assessment, runtimeIdentity, outputId, sourceProbe: f.raw, outputProbe,
      sourcePath: f.file, outputPath: output, stageDirectory: f.dir, ffmpeg, ffprobe, run: runTool, budget: EVIDENCE_BUDGET, verificationMethod: 'packet-identity-v1', maxConcurrentChildren: 2 });
    await check({ movieScale, output, evidence, validate: () => api.validate(plan, outputProbe, evidence) });
  }
}

// 3.008 s of audio after the 72-sample offset fills the last AAC frame exactly,
// so the source has a full-media audio edit and no trailing padding to trim.
test('pinned noncommensurate media clock 1000003 and movie clocks 1000/1001 pass complete MP4/MOV verification', async t => {
  const f = await generated(t, '3.008');
  assert.equal(await lastAudioPadding(f.file), 0);
  await forcedMovieClocks(t, f, async ({ movieScale, output, evidence, validate }) => {
    assert.equal(await lastAudioPadding(output), 0);
    assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure)); assert.equal(validate().valid, true);
    assert.equal(evidence.nativeEditLists.tracks[0].trackDuration, movieScale === 1000 ? '3002' : '3005');
  });
});

// FFmpeg 9.1 movenc (b1327568b6) keeps the last AAC frame whole and trims its
// padding with the audio edit end, rounded UP into the movie clock. The
// source's 1000003 movie clock holds that end at 144072 samples (last packet
// discard_padding 384). A 1000 or 1001 movie clock cannot: the end becomes
// 3002 ms (3005/1001 s), the 9.1 mov demuxer derives discard_padding 360 from
// it, and the output decodes 24 more trailing samples of codec padding than
// the source. That is different presented audio, not another representation
// of the same audio, so packet side-data identity refuses it.
test('FFmpeg 9.1 AAC tail edit on movie clock 1000003 is refused when forced movie clocks 1000/1001 lengthen the decoded tail', async t => {
  const f = await generated(t);
  assert.equal(await lastAudioPadding(f.file), 384);
  await forcedMovieClocks(t, f, async ({ output, evidence, validate }) => {
    assert.equal(await lastAudioPadding(output), 360);
    assert.equal(evidence.status, 'failed'); assert.equal(evidence.failure.code, 'REMUX_PACKET_SIDE_DATA');
    assert.match(evidence.failure.message, /at packet 141$/); assert.throws(validate, { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' });
  });
});

test('real service refuses native ISO playback mutants before Ready with a window reason', async t => {
  const f = await generated(t), original = await fs.readFile(f.file), { EncoderService } = require('../src/encoder-service.cjs');
  for (const [name, type, index, mutate, code] of [
    ['rate-v0', 'elst', 0, b => { b.writeUInt32BE(131072, 28); return b; }, 'REMUX_SOURCE_EDIT_UNSUPPORTED'],
    ['rate-v1', 'elst', 0, b => { b = wide('elst', b); b.writeUInt32BE(65537, 44); return b; }, 'REMUX_SOURCE_EDIT_UNSUPPORTED'],
    ['dwell', 'elst', 0, b => { b.writeUInt32BE(0, 28); return b; }, 'REMUX_SOURCE_EDIT_UNSUPPORTED'],
    ['disabled', 'tkhd', 0, b => { b.writeUIntBE(2, 1, 3); return b; }, 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED'],
    ['movie-rate', 'mvhd', 0, b => { b.writeUInt32BE(131072, 20); return b; }, 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED'],
    ['muted', 'tkhd', 1, b => { b.writeUInt16BE(0, 36); return b; }, 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED'],
    ['width', 'tkhd', 0, b => { b.writeUInt32BE(32 * 65536, 76); return b; }, 'REMUX_TRACK_GEOMETRY_UNSUPPORTED'],
    ['height', 'tkhd', 0, b => { b.writeUInt32BE(32 * 65536, 80); return b; }, 'REMUX_TRACK_GEOMETRY_UNSUPPORTED'],
    ['balance', 'smhd', 0, b => { b.writeInt16BE(256, 4); return b; }, 'REMUX_SOUND_BALANCE_UNSUPPORTED'],
    ['aperture', 'trak', 0, b => { const a=Buffer.alloc(12);a.writeUInt32BE(64*65536,4);a.writeUInt32BE(72*65536,8);return Buffer.concat([b,atom('tapt',atom('clef',a))]); }, 'REMUX_TRACK_APERTURE_UNSUPPORTED'],
  ]) {
    const input = path.join(f.dir, name), output = path.join(f.dir, name + '-out'); await fs.mkdir(input); await fs.mkdir(output);
    await fs.writeFile(path.join(input, 'input.mp4'), transform(original, type, index, mutate));
    const service = new EncoderService({ ffmpeg, ffprobe, stateDir: path.join(f.dir, name + '-state'), runtimeIdentity, inspectionCache: null,
      inspect: async file => ({ probe: { ...structuredClone(f.raw), format: { ...f.raw.format, size: String((await fs.stat(file)).size) } }, duration: 3, summary: {} }),
      storageEligibility: { check: async () => ({ eligible: false, reason: 'unit' }) }, capabilities: async () => { throw Error('No encoder'); },
      operationRuntime: { observe: async () => ({}), snapshot: () => ({ runtimeIdentity, environment: null }), close: async () => {} },
      operationStorage: () => { throw Error('No storage before Start'); }, operationEvidenceBudget: EVIDENCE_BUDGET, operationDeadlineMs: EXECUTION_BUDGET_MS,
      remuxOperations: new RemuxOperations({ runtimeIdentity, policyIdentity: REMUX_POLICY_ID, policies: REMUX_POLICIES }) });
    try { const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'mp4' }); await service.taskPromise;
      const s = service.snapshot(), item = s.items[0]; assert.equal(item.status, 'unsupported', name + ': ' + item.reason);
      assert.equal(item.reasonCode, code, name); assert.ok(item.reason.length > 20); assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [item.id] }), { code: 'INVALID_SELECTION' });
      assert.deepEqual(await fs.readdir(output), []);
    } finally { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); }
  }
});
