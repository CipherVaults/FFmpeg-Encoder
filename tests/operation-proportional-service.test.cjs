'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { EncoderService } = require('../src/encoder-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { FAMILY_ID, RESOURCE_POLICY, deriveCfrFlacResources } = require('../src/operation-resource-budget.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { classifyColor, PROFILES } = require('../src/media.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
// Synthetic contracts, non-executable tool files and EventEmitter children only.
// No production factory, retained calibration report, real child or media is used.
// A successful telemetry check deliberately ends at the unchanged closed collector.
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function probe(size) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360',
    start_pts: 0, start_time: '0', duration_ts: 150 * 15360, duration: '150', disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 7200000, duration: '150', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '150', size: String(size), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, chapters: [], programs: [], stream_groups: [] };
}
function rows(kind, count) {
  // Parser stress rows, not claimed correspondence to source pixels or samples.
  return Array.from({ length: count }, (_, n) => kind === 'video'
    ? ['ffet1', 'v', 0, 0, n, n, '1/15360', n * 512, '1/15360', n * 512].join('\t') + '\n'
    : ['ffet1', 'a', 0, 1, n, n, '1/48000', n * 1024, '1/48000', n * 1024, n * 1024, 1024].join('\t') + '\n').join('');
}
async function harness(t, { seconds = .5, mode = 'exact' } = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'ffmpeg-proportional-service-'));
  let service, runtime, store;
  t.after(async () => {
    // Drain ownership before removing only this harness's original namespace.
    if (service?.busy) await service.cancelCurrent();
    if (service) await service.closeOperationResources();
    if (store) await store.close();
    if (runtime) await runtime.close();
    const actual = await fs.realpath(root);
    assert.equal(actual, root); assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith('ffmpeg-proportional-service-'));
    await fs.rm(actual, { recursive: true });
  });
  const input = path.join(root, 'input'), output = path.join(root, 'output'), state = path.join(root, 'state');
  await Promise.all([input, output, state].map(p => fs.mkdir(p)));
  const storageRoot = path.join(state, 'operation-evidence'); await fs.mkdir(storageRoot);
  const source = path.join(input, 'synthetic.mov'), bytes = Buffer.from('synthetic non-media source'); await fs.writeFile(source, bytes);
  const paths = { ffmpeg: path.join(root, 'encoder.fixture'), ffprobe: path.join(root, 'probe.fixture') }, pins = {};
  for (const [tool, file] of Object.entries(paths)) { const data = Buffer.from('non-executable ' + tool); await fs.writeFile(file, data); pins[tool] = { sizeBytes: data.length, sha256: sha(data) }; }
  const runtimeIdentity = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => pins[name])));
  const expected = deriveCfrFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: seconds * 1000000, sourceBytes: String(bytes.length) });
  const original = probe(bytes.length), frozen = frozenQualifications('synthetic-service-only', runtimeIdentity, original);
  const selector = new OperationFamilySelector({ policyIdentity: 'synthetic-service-only', families: [{
    id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity, environment: null, settings,
    qualification: frozen.qualification, timingQualification: frozen.timingQualification,
    evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] }] });
  const calls = [], admission = []; let active = 0, jobDirectory;
  const run = async (executable, args, options) => {
    const child = new EventEmitter(); child.kill = () => {}; options.onChild(child); active++;
    const call = { executable, args, options }; calls.push(call); let exitCode = 0;
    try {
      assert.equal(options.onStdoutChunk, undefined, 'Closed collector must not invoke decoded-evidence runner.');
      if (executable === paths.ffmpeg) {
        if (mode === 'pipe') {
          options.onOutputBytes({ stream: 'stdout', bytes: expected.resources.pipeBytes });
          options.onOutputBytes({ stream: 'stderr', bytes: 1 });
          assert.fail('Aggregate pipe overrun must refuse.');
        }
        for (let i = 0; i < args.length; i++) if (/^-stats_enc_pre:\d+$/.test(args[i])) {
          const index = Number(args[i].split(':')[1]), file = args[i + 1]; jobDirectory = path.dirname(path.dirname(file));
          await fs.writeFile(file, rows(index === 0 ? 'video' : 'audio', index === 0 ? expected.resources.telemetryRecords + (mode === 'records' ? 1 : 0) : 1), { flag: 'r+' });
          if (mode === 'bytes' && index === 0) await fs.truncate(file, expected.resources.telemetryBytes + 1);
        }
        await fs.writeFile(args.at(-1), 'synthetic output, not media', { flag: 'wx' });
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const outputProbe = structuredClone(original); outputProbe.format.format_name = 'matroska,webm';
      for (let i = 0; i < calls[0].args.length; i++) if (calls[0].args[i] === '-metadata') {
        const value = calls[0].args[i + 1], split = value.indexOf('='); outputProbe.format.tags[value.slice(0, split)] = value.slice(split + 1);
      }
      return { stdout: JSON.stringify(outputProbe), stderr: '', exitCode: 0 };
    } catch (error) { exitCode = 1; throw error; } finally { child.emit('close', exitCode, null); active--; }
  };
  if (mode === 'storage') { const prior = path.join(storageRoot, 'prior-retained.bin'); await fs.writeFile(prior, ''); await fs.truncate(prior, 16 * 1024 * 1024); }
  runtime = new OperationRuntimeObserver({ runtime: paths, pins, run });
  store = await openEvidenceStorage({ root: storageRoot, capBytes: (mode === 'storage' ? 64 : 128) * 1024 * 1024, minFreeBytes: 0,
    io: { ...fs, statfs: async () => ({ bavail: 1024n * 1024n, bsize: 4096n }) } });
  service = new EncoderService({ ...paths, stateDir: state, runtimeIdentity, run, operationQualifications: selector,
    operationRuntime: runtime, operationStorage: { ...store, admit: request => { admission.push(request); return store.admit(request); } },
    operationTelemetry: true, operationEvidenceBudget: null, operationDeadlineMs: 120000,
    inspectionCache: null, inspectionWorkers: 1, storageEligibility: { check: async () => ({ eligible: true, reason: 'Synthetic fixture.' }) },
    capabilities: async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })), versions: { ffmpeg: 'synthetic', ffprobe: 'synthetic' } }),
    inspect: async () => ({ probe: structuredClone(original), color: classifyColor(original), duration: 150,
      summary: { selectedVideoIndex: 0, codec: 'h264', width: 1280, height: 720, bitDepth: 8 } }),
    verify: () => { throw new Error('No legacy validation fallback permitted.'); } });

  const inf = await service.registerFolder(input, 'input'), outf = await service.registerFolder(output, 'output');
  const first = await service.prepareBatch({ inputFolderId: inf.id, outputFolderId: outf.id, settings });
  assert.equal(first.phase, 'ready', first.error);
  const plan = await service.updateFileOperations({ planId: first.planId, draftId: first.operationDraft.id, revision: first.operationDraft.revision,
    fileIds: [first.items[0].id], overrides: { range: { startUs: 1000000, endUs: 1000000 + seconds * 1000000 }, audioPolicy: 'precision-flac' } });
  assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0]));
  if (mode === 'stale') selector.invalidate('Synthetic test invalidation before Start.');
  service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }); await service.taskPromise;
  const item = service.snapshot().items[0]; assert.equal(item.status, 'failed'); assert.equal(active, 0);
  assert.deepEqual(await fs.readFile(source), bytes); assert.equal((await fs.readdir(output)).filter(p => p.endsWith('.mkv')).length, 0);
  assert.equal(admission.length, mode === 'stale' ? 0 : 1);
  if (admission.length) assert.deepEqual(admission[0], { forecastBytes: expected.resources.evidenceReserveBytes });
  if (calls.length) { assert.ok(calls[0].options.timeoutMs > 120000); assert.ok(calls[0].options.timeoutMs <= expected.executionBudgetMs); }
  if (jobDirectory) { const reservation = JSON.parse(await fs.readFile(path.join(jobDirectory, 'storage-reservation.json'), 'utf8')); assert.equal(reservation.forecastBytes, expected.resources.evidenceReserveBytes); }
  return { item, calls, expected, jobDirectory };
}
for (const seconds of [.5, 75]) test(`real service collects exactly derived telemetry records (${seconds}s) before closed collector refusal`, { timeout: 15000 }, async t => {
  const h = await harness(t, { seconds });
  assert.equal(h.calls.length, 2); // encode then output probe, no decoded collector calls
  const receipt = JSON.parse(await fs.readFile(path.join(h.jobDirectory, 'encoder-input-receipt.json'), 'utf8'));
  assert.equal(receipt.streams[0].summary.records, String(h.expected.resources.telemetryRecords));
  assert.equal(receipt.publicationAuthorized, false);
  assert.equal(h.item.reasonCode, 'OPERATION_EVIDENCE_INVALID');
});
for (const [mode, code] of [['records', 'TELEMETRY_LIMIT'], ['bytes', 'TELEMETRY_PATH'], ['pipe', 'OPERATION_PIPE_LIMIT']])
  test(`real service refuses derived ${mode} exhaustion without publication`, { timeout: 15000 }, async t => {
    const h = await harness(t, { mode }); assert.equal(h.calls.length, 1); assert.equal(h.item.reasonCode, code);
    if (h.jobDirectory) await assert.rejects(fs.stat(path.join(h.jobDirectory, 'encoder-input-receipt.json')), { code: 'ENOENT' });
  });

test('expanded telemetry record ceiling also refuses its first excess row', { timeout: 15000 }, async t => {
  const h = await harness(t, { seconds: 75, mode: 'records' });
  assert.ok(h.expected.resources.telemetryRecords > 20000); assert.equal(h.calls.length, 1); assert.equal(h.item.reasonCode, 'TELEMETRY_LIMIT');
});
test('derived reservation refuses retained-storage pressure before encode', { timeout: 15000 }, async t => {
  const h = await harness(t, { seconds: 75, mode: 'storage' });
  assert.ok(h.expected.resources.evidenceReserveBytes + 16 * 1024 * 1024 > 64 * 1024 * 1024);
  assert.equal(h.calls.length, 0); assert.equal(h.item.reasonCode, 'OPERATION_STORAGE_ADMISSION');
});
test('invalidated real selector refuses before reservation or encode', { timeout: 15000 }, async t => {
  const h = await harness(t, { mode: 'stale' }); assert.equal(h.calls.length, 0); assert.equal(h.item.reasonCode, 'OPERATION_QUALIFICATION_STALE');
});
