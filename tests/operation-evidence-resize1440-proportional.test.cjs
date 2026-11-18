'use strict';
// Injected byte streams only. Synthetic qualification is not measured media proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildEncodeOperation, fingerprintEncodeSource, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { RESIZE_1440_FAMILY_ID: FAMILY_ID, RESIZE_1440_RESOURCE_POLICY: RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, runtimeIdentity = 'a'.repeat(64);
function probe(size) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 2560, height: 1440,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360',
    start_pts: 0, start_time: '0', duration_ts: 15360, duration: '1', disposition: { default: 1 }, side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0, displaymatrix: '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824' }] },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 48000, duration: '1', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '1', size: String(size), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, chapters: [], programs: [], stream_groups: [] };
}

async function fixture(t, { seconds = 1 } = {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'ffmpeg-resize-evidence-'));
  t.after(async () => { assert.equal(await fs.realpath(root), root); await fs.rm(root, { recursive: true }); });
  const sourcePath = path.join(root, 'source.bin'), outputPath = path.join(root, 'output.bin'), stageDirectory = path.join(root, 'stage');
  await fs.mkdir(stageDirectory); await fs.writeFile(sourcePath, 'synthetic source'); await fs.writeFile(outputPath, 'synthetic output');
  const identity = await readSourceIdentity(sourcePath), sourceProbe = probe(Number(identity.size));
  sourceProbe.format.duration = String(seconds);
  for (const stream of sourceProbe.streams) { stream.duration = String(seconds); stream.duration_ts *= seconds; }
  const plan = buildEncodeOperation({ input: sourcePath, output: outputPath, settings, runtimeIdentity,
    inspection: { probe: sourceProbe, color: classifyColor(sourceProbe), duration: seconds },
    request: resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
      overrides: { resolution: '720', range: { startUs: 0, endUs: 500000 }, audioPolicy: 'precision-flac' } }) });
  const frozen = frozenQualifications('synthetic-collector-only', runtimeIdentity, sourceProbe);
  const selector = new OperationFamilySelector({ policyIdentity: 'synthetic-collector-only', families: [{ id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY,
    settings, runtimeIdentity, environment: null, qualification: frozen.qualification, timingQualification: frozen.timingQualification,
    evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] }] });
  const bindings = { plan, settings, runtimeIdentity, environment: null, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(sourceProbe), budget: null, executionBudgetMs: 120000 };
  const token = selector.select(bindings), selection = selector.requireCurrent(token, bindings);
  const outputProbe = structuredClone(sourceProbe); outputProbe.format.format_name = 'matroska,webm'; outputProbe.format.duration = '.5';
  Object.assign(outputProbe.streams[0], { width: 1280, height: 720, side_data_list: [], codec_name: 'hevc', duration: '.5', duration_ts: 7680 });
  Object.assign(outputProbe.streams[1], { codec_name: 'flac', duration: '.5', duration_ts: 24000 });
  const data = { calls: [], mutate: null };
  const run = async (exe, args, options) => {
    data.calls.push(args); if (data.beforeRun) await data.beforeRun(); const source = args[args.indexOf('-i') + 1] === sourcePath;
    let bytes;
    if (args.includes('-show_frames')) {
      const video = args[args.indexOf('-select_streams') + 1] === '0', count = video ? (source ? 30 : 15) : (source ? 10 : 5);
      const stream = (source ? sourceProbe : outputProbe).streams[video ? 0 : 1];
      const rows = Array.from({ length: count }, (_, n) => video
        ? { media_type: 'video', stream_index: 0, pts: n * 512, duration: 512, width: source ? 2560 : 1280, height: source ? 1440 : 720, pix_fmt: 'yuv420p', interlaced_frame: 0,
          color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709', ...(source ? { sample_aspect_ratio: '1:1', chroma_location: 'left' } : {}) }
        : { media_type: 'audio', stream_index: 1, pts: n * 4800, nb_samples: 4800, sample_fmt: stream.sample_fmt, channels: 2, channel_layout: 'stereo' });
      data.mutate?.({ rows, source, video });
      bytes = Buffer.from(rows.map(row => 'frame|' + Object.entries(row).map(([k, v]) => `${k}=${v}`).join('|') + '\n').join(''));
    } else if (args.includes('-show_packets')) bytes = Buffer.from('packet|stream_index=1\n');
    else bytes = Buffer.alloc((source ? 48000 : 24000) * 4, !source && data.changedPcm ? 2 : 1);
    for (let i = 0; i < bytes.length; i += 4096) await options.onStdoutChunk(bytes.subarray(i, i + 4096));
    return { stdout: '', stderr: '', exitCode: 0, stderrCapture: { totalBytes: 0, truncated: false }, stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true } };
  };
  const options = { plan, sourceProbe, outputProbe, sourcePath, outputPath, stageDirectory, ffmpeg: path.join(root, 'ffmpeg'), ffprobe: path.join(root, 'ffprobe'), run,
    signal: undefined, familySelection: selection, budget: selection.budget, timingQualification: selection.timingQualification, sourcePolicy: selection.sourcePolicy };
  return { options, data, selector, token, selection, identity };
}
test('genuine proportional selection collects complete source and exact selected FLAC PCM', async t => {
  const h = await fixture(t), receipt = await collectOperationEvidence(h.options);
  assert.equal(receipt.status, 'completed'); assert.equal(h.selector.verifyCollectedSource(h.token, receipt), true);
  assert.equal(receipt.completeSource.video.frames, 30); assert.equal(receipt.completeSource.audio[0].sampleCount, '48000');
  assert.equal(receipt.publicationAuthorized, false); assert.ok(h.data.calls.length > 0);
});
test('forged, borrowed, stale and altered bindings refuse before any evidence directory or child', async t => {
  const h = await fixture(t), other = await fixture(t);
  const attempts = [ { familySelection: { ...h.selection } }, { familySelection: other.selection },
    { sourcePath: h.options.outputPath }, { budget: { ...h.selection.budget, maxRecords: h.selection.budget.maxRecords + 1 } },
    { sourcePolicy: { ...h.selection.sourcePolicy, maximumExtentUs: 2000000 } }, { timingQualification: { ...h.selection.timingQualification } },
    { sourcePolicy: { id: 'short-sdr-range-flac-v1', rate: 30, maximumExtentUs: 120000000 } } ];
  for (const change of attempts) {
    await assert.rejects(collectOperationEvidence({ ...h.options, ...change }), { code: 'OPERATION_PROPORTIONAL_COLLECTION' });
    assert.deepEqual(await fs.readdir(h.options.stageDirectory), []); assert.equal(h.data.calls.length, 0);
  }
  h.selector.invalidate('Synthetic revocation.');
  await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_PROPORTIONAL_COLLECTION' });
});
test('actual changed source stamp refuses before evidence write or runner', async t => {
  const h = await fixture(t); await fs.appendFile(h.options.sourcePath, 'changed');
  await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_EVIDENCE_CHANGED' });
  assert.deepEqual(await fs.readdir(h.options.stageDirectory), []); assert.equal(h.data.calls.length, 0);
});
test('proportional source-property checks cover frames beyond the selected range', async t => {
  const h = await fixture(t); h.data.mutate = ({ rows, source, video }) => { if (source && video) rows.at(-1).chroma_location = 'center'; };
  await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_SOURCE_FAMILY_MISMATCH' });
});
test('truncated complete source cannot complete proportional evidence', async t => {
  const h = await fixture(t); h.data.mutate = ({ rows, source, video }) => { if (source && video) rows.splice(15); };
  await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_SOURCE_FAMILY_MISMATCH' });
});

test('selection revoked during awaited directory check cannot launch collector child', async t => {
  const h = await fixture(t), original = fs.lstat; let revoked = false;
  t.mock.method(fs, 'lstat', async function(file, ...args) {
    const result = await original.call(this, file, ...args);
    if (!revoked && file === h.options.stageDirectory) {
      const dirs = await fs.readdir(file);
      if (dirs.length && await fs.stat(path.join(file, dirs[0], 'start.json')).then(() => true, () => false)) {
        revoked = true; h.selector.invalidate('Revoked while directory observation awaited.');
      }
    }
    return result;
  });
  await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_PROPORTIONAL_COLLECTION' });
  assert.equal(revoked, true); assert.equal(h.data.calls.length, 0);
});
test('ctime mismatch before collection refuses but ctime-only drift during collection stays a warning', async t => {
  for (const before of [true, false]) {
    const h = await fixture(t); const old = await fs.stat(h.options.sourcePath);
    const change = async () => { await fs.chmod(h.options.sourcePath, old.mode & 0o777 ^ 0o100); };
    if (before) {
      await change();
      await assert.rejects(collectOperationEvidence(h.options), { code: 'OPERATION_EVIDENCE_CHANGED' });
      assert.deepEqual(await fs.readdir(h.options.stageDirectory), []); assert.equal(h.data.calls.length, 0);
    } else {
      let changed = false; h.data.beforeRun = async () => { if (!changed) { changed = true; await change(); } };
      const receipt = await collectOperationEvidence(h.options);
      assert.equal(receipt.sourceIdentityDisposition, 'ctime-only'); assert.match(receipt.sourceIdentityWarning, /not proof of unchanged bytes/);
    }
  }
});

test('source beyond legacy120seconds reaches collection only with its genuine derived extent', async t => {
  const h = await fixture(t, { seconds: 150 }); let calls = 0;
  assert.equal(h.selection.sourcePolicy.maximumExtentUs, 150000000);
  h.options.run = async () => { calls++; throw Object.assign(new Error('Explicit synthetic stop before long decoded stream.'), { code: 'SYNTHETIC_LONG_STOP' }); };
  await assert.rejects(collectOperationEvidence(h.options), { code: 'SYNTHETIC_LONG_STOP' });
  assert.equal(calls, 1);
});

test('hostile collection accessors are rejected without execution or filesystem effects', async t => {
  const h = await fixture(t); let reads = 0;
  for (const key of ['familySelection', 'sourceProbe', 'budget', 'sourcePolicy', 'timingQualification']) {
    const request = { ...h.options };
    Object.defineProperty(request, key, { enumerable: true, get() { reads++; return h.options[key]; } });
    await assert.rejects(collectOperationEvidence(request), { code: 'OPERATION_EVIDENCE_INVALID' });
  }
  const changed = structuredClone(h.options.sourceProbe);
  Object.defineProperty(changed.streams[0], 'width', { enumerable: true, get() { reads++; return 1280; } });
  await assert.rejects(collectOperationEvidence({ ...h.options, sourceProbe: changed }), { code: 'OPERATION_PROPORTIONAL_COLLECTION' });
  assert.equal(reads, 0); assert.equal(h.data.calls.length, 0); assert.deepEqual(await fs.readdir(h.options.stageDirectory), []);
});

test('revocation during awaited spool close cannot resolve a completed collector promise', async t => {
  const h = await fixture(t), original = fs.open; let revoked = false;
  t.mock.method(fs, 'open', async function(file, ...args) {
    const handle = await original.call(this, file, ...args);
    if (typeof file === 'string' && file.startsWith(h.options.stageDirectory + path.sep) && file.endsWith('.jsonl')) {
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        if (!revoked) { revoked = true; h.selector.invalidate('Revoked during awaited spool close.'); }
      };
    }
    return handle;
  });
  let failure;
  await assert.rejects(collectOperationEvidence(h.options), error => {
    failure = error; return error.code === 'OPERATION_PROPORTIONAL_COLLECTION';
  });
  assert.equal(revoked, true);
  assert.equal(failure.evidenceReceipt.status, 'completed');
  assert.equal(failure.evidenceReceipt.publicationAuthorized, false);
  assert.equal(failure.evidenceReceipt.qualificationGranted, false);
  assert.match(failure.evidenceAuthorityWarning, /historical.*not current authority/);
  const saved = JSON.parse(await fs.readFile(path.join(failure.evidenceDirectory, 'receipt.json'), 'utf8'));
  assert.equal(saved.status, 'completed'); assert.equal(saved.publicationAuthorized, false); assert.equal(saved.qualificationGranted, false);
});

test('resize frame dimensions must match each respective source and output stream', async t => {
  for (const target of [true, false]) {
    const h = await fixture(t); h.data.mutate = ({ rows, source, video }) => { if (video && source === target) rows.at(-1).width = 640; };
    await assert.rejects(collectOperationEvidence(h.options), /width disagrees/);
  }
});

test('resize collection records changed PCM and canonical output validator refuses it', async t => {
  const h = await fixture(t); h.data.changedPcm = true;
  const receipt = await collectOperationEvidence(h.options);
  // Collection acquires evidence, not publication authority. Output validation is separate.
  const validation = validateEncodeOperationOutput(h.options.plan, h.options.outputProbe,
    { qualification: h.selection.qualification, decodedEvidence: receipt.decodedEvidence });
  assert.equal(validation.valid, false); assert.match(validation.errors.join(' '), /PCM|lossless/i);
  assert.equal(receipt.publicationAuthorized, false);
});
