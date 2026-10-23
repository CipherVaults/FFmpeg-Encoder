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
const { OperationQualificationSelector } = require('../src/operation-qualification.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { classifyColor, PROFILES } = require('../src/media.cjs');
const { ToolError } = require('../src/process-runner.cjs');

// Tiny pinned non-executable tool files, EventEmitter children and dummy output
// bytes exercise the actual main service/runtime/telemetry/storage/collector.
// No real process, media, application, GPU or network is opened. Sparse ordinary
// files provide deterministic logical-byte pressure without large allocations.
const MiB = 1024 * 1024, CAP = 64 * MiB;
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const RANGE = { startUs: 100000, endUs: 300000 };
const BUDGET = { sourceDecode: 'complete', timeoutMs: 10000, maxFrameBytes: MiB, maxPcmBytes: MiB, maxRecords: 10000, maxSpoolBytes: MiB };
const COLOR = { color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' };
const clone = value => structuredClone(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function absent(file) { await assert.rejects(fs.stat(file), { code: 'ENOENT' }); }
async function sized(file, bytes) { await fs.writeFile(file, ''); await fs.truncate(file, bytes); }
function probe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', ...COLOR,
    field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/1000', start_pts: 0, start_time: '0',
    duration_ts: 400, duration: '0.4', avg_frame_rate: '10/1', r_frame_rate: '10/1', tags: { title: 'Synthetic video', rotate: '0' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: 16, channels: 2, channel_layout: 'stereo',
    sample_rate: '48000', time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 19200, duration: '0.4',
    tags: { title: 'Synthetic stereo', language: 'eng' }, disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '0.4', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic source' } },
  chapters: [], programs: [], stream_groups: [] };
}
function line(section, row) { return section + '|' + Object.entries(row).map(([key, value]) => `${key}=${value}`).join('|') + '\n'; }
function frames(stream, timestamps, audio = false) {
  return timestamps.map(pts => audio ? { media_type: 'audio', stream_index: stream.index, pts, nb_samples: 4800,
    sample_fmt: stream.sample_fmt, channels: stream.channels, channel_layout: stream.channel_layout }
    : { media_type: 'video', stream_index: stream.index, pts, duration: 100, width: stream.width, height: stream.height,
      pix_fmt: stream.pix_fmt, interlaced_frame: 0, ...COLOR });
}
function metadata(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) if (args[index] === '-metadata') {
    const text = args[index + 1], split = text.indexOf('='); result[text.slice(0, split)] = text.slice(split + 1);
  }
  return result;
}
function telemetryRows(kind) {
  return [0, 1].map(n => kind === 'video'
    ? ['ffet1', 'v', 0, 0, n, n + 1, '1/1000', n * 100, '1/1000', 100 + n * 100].join('\t') + '\n'
    : ['ffet1', 'a', 0, 1, n, n + 1, '1/48000', n * 4800, '1/48000', 4800 + n * 4800, n * 4800, 4800].join('\t') + '\n').join('');
}

async function harness(t, { holdForStorage = false, priorRetainedBytes = 0, postSuccessGrowth = false, finalObservationUnavailable = false } = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'ffmpeg-storage-service-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'), state = path.join(root, 'state');
  const storageRoot = path.join(state, 'operation-evidence');
  await fs.mkdir(input); await fs.mkdir(output); await fs.mkdir(state); await fs.mkdir(storageRoot);
  const source = path.join(input, 'synthetic-source.mov'), sourceBytes = Buffer.from('synthetic immutable source bytes'); await fs.writeFile(source, sourceBytes);
  const prior = path.join(storageRoot, 'older-retained-evidence.bin'); if (priorRetainedBytes) await sized(prior, priorRetainedBytes);
  const paths = { ffmpeg: path.join(root, 'synthetic-ffmpeg.exe'), ffprobe: path.join(root, 'synthetic-ffprobe.exe') };
  const toolBytes = { ffmpeg: Buffer.from('pinned non-executable encoder fixture'), ffprobe: Buffer.from('pinned non-executable probe fixture') };
  for (const name of Object.keys(paths)) await fs.writeFile(paths[name], toolBytes[name], { flag: 'wx' });
  const pins = Object.fromEntries(Object.keys(paths).map(name => [name, { sizeBytes: toolBytes[name].length, sha256: sha(toolBytes[name]) }]));
  const runtimeIdentity = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => pins[name])));
  const entered = deferred(), aborted = deferred(), drain = deferred();
  const data = { calls: [], encodes: [], active: 0, maximumActive: 0, held: false, settled: false, entered, aborted, drain,
    jobDirectory: null, growthFile: null, heldChild: null, lastSignal: null, postSuccessGrown: false, failStorageObservation: false,
    stderr: 'discarded-prefix-proof ' + 'é'.repeat(150000) + ' SYNTHETIC CHILD END',
    stderrCapture: { totalBytes: 900000, truncated: true }, stopCause: new ToolError('SYNTHETIC_STORAGE_CHILD_STOP', 'Synthetic owned child terminated after the monitor requested cancellation.') };
  const originalProbe = probe(), outputProbe = clone(originalProbe);
  outputProbe.format.format_name = 'matroska,webm'; outputProbe.format.duration = '.2'; outputProbe.format.start_time = '0';
  Object.assign(outputProbe.streams[0], { codec_name: 'hevc', duration: '.2', duration_ts: 200 });
  Object.assign(outputProbe.streams[1], { index: 1, codec_name: 'flac', time_base: '1/1000', duration: '.2', duration_ts: 200 });
  const sourceFrames = { 0: frames(originalProbe.streams[0], [0, 100, 200, 300]), 2: frames(originalProbe.streams[1], [0, 4800, 9600, 14400], true) };
  const outputFrames = { 0: frames(outputProbe.streams[0], [0, 100]), 1: frames(outputProbe.streams[1], [0, 100], true) };
  const sourcePcm = Buffer.alloc(19200 * 4); for (let index = 0; index < sourcePcm.length; index++) sourcePcm[index] = (index * 17 + Math.floor(index / 256)) % 256;
  const run = async (executable, args, options) => {
    const child = new EventEmitter(); child.kills = 0; child.kill = () => { child.kills++; };
    const call = { executable, args: args.slice(), options, child }; data.calls.push(call); data.lastSignal = options.signal;
    options.onChild(child); data.active++; data.maximumActive = Math.max(data.maximumActive, data.active); let closed = false;
    const close = (code = 0, signal = null) => { if (!closed) { closed = true; call.close = { code, signal }; child.emit('close', code, signal); } };
    try {
      if (!options.onStdoutChunk && executable === paths.ffmpeg) {
        data.encodes.push(call);
        for (let index = 0; index < args.length; index++) if (/^-stats_enc_pre:\d+$/.test(args[index])) {
          const stream = Number(args[index].split(':')[1]), file = args[index + 1];
          await fs.writeFile(file, telemetryRows(stream === 0 ? 'video' : 'audio'), { flag: 'r+' });
          data.jobDirectory = path.dirname(path.dirname(file));
        }
        await fs.writeFile(args.at(-1), 'synthetic sealed encoded bytes', { flag: 'wx' });
        close(); return { stdout: '', stderr: '', exitCode: 0, stdoutCapture: { totalBytes: 0, truncated: false }, stderrCapture: { totalBytes: 0, truncated: false } };
      }
      if (!options.onStdoutChunk) {
        const actual = clone(outputProbe); Object.assign(actual.format.tags, metadata(data.encodes[0].args));
        const stdout = JSON.stringify(actual); close(); return { stdout, stderr: '', exitCode: 0,
          stdoutCapture: { totalBytes: Buffer.byteLength(stdout), truncated: false }, stderrCapture: { totalBytes: 0, truncated: false } };
      }
      const isSource = args[args.indexOf('-i') + 1] === source; let bytes;
      if (args.includes('-show_frames')) bytes = Buffer.from((isSource ? sourceFrames : outputFrames)[args[args.indexOf('-select_streams') + 1]].map(row => line('frame', row)).join(''));
      else if (args.includes('-show_packets')) bytes = Buffer.from(line('packet', { stream_index: 1 }));
      else bytes = isSource ? sourcePcm : sourcePcm.subarray(4800 * 4, 14400 * 4);
      for (let index = 0; index < bytes.length; index += 313) await options.onStdoutChunk(bytes.subarray(index, index + 313));
      if (holdForStorage && !data.held && isSource && args.includes('-show_frames')) {
        data.held = true; data.heldChild = child;
        data.growthFile = path.join(data.jobDirectory, 'synthetic-writer-growth.bin'); await sized(data.growthFile, 65 * MiB);
        const noteAbort = () => aborted.resolve(options.signal);
        options.signal.addEventListener('abort', noteAbort, { once: true }); if (options.signal.aborted) noteAbort();
        entered.resolve(options.signal); await drain.promise; data.settled = true; close(9, 'SIGTERM');
        throw new ToolError('CANCELLED', 'Synthetic child close and sink drainage settled after monitor cancellation.', {
          stderr: data.stderr, stderrCapture: data.stderrCapture, exitCode: 9, signal: 'SIGTERM', exitSignal: 'SIGTERM',
          stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true }, cause: data.stopCause });
      }
      if (postSuccessGrowth && !data.postSuccessGrown && isSource && args.includes('-show_frames')) {
        data.postSuccessGrown = true; data.growthFile = path.join(data.jobDirectory, 'successful-child-growth.bin'); await sized(data.growthFile, 65 * MiB);
        close(); return { stdout: '', stderr: data.stderr, exitCode: 0, stderrCapture: data.stderrCapture,
          stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true } };
      }
      close(); return { stdout: '', stderr: '', exitCode: 0, stderrCapture: { totalBytes: 0, truncated: false },
        stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true } };
    } finally { close(9, 'SIGTERM'); data.active--; }
  };
  const runtime = new OperationRuntimeObserver({ runtime: paths, pins, run });
  const store = await openEvidenceStorage({ root: storageRoot, capBytes: CAP, minFreeBytes: 0,
    io: { ...fs, statfs: async () => {
      if (data.failStorageObservation) throw Object.assign(new Error('Synthetic final statfs observation is unavailable.'), { code: 'EIO' });
      return { bavail: 1024n * 1024n * 1024n, bsize: 4096n };
    } } });
  const serviceStore = finalObservationUnavailable ? { ...store, finish: (...args) => {
    data.failStorageObservation = true; return store.finish(...args);
  } } : store;
  const sourceIdentity = await readSourceIdentity(source);
  const selector = new OperationQualificationSelector({ policyIdentity: 'synthetic-storage-service-policy', cells: [{
    evidenceIds: ['synthetic-storage-endpoint', 'synthetic-storage-interior'], runtimeIdentity, sourceIdentity,
    sourceProbeFingerprint: fingerprintEncodeSource(originalProbe), settings: SETTINGS,
    request: { range: RANGE, resolution: 'source', target: 'matroska', hdrPolicy: 'preserve', audioPolicy: 'precision-flac', aacBitrateKbps: null, omissionRequestIds: [] },
    qualification: { evidenceId: 'synthetic-storage-endpoint', runtimeIdentity, containerDuration: 'end-timestamp',
      tolerances: { videoTimestampUs: 0, audioTimestampUs: 0, avSyncUs: 0, durationUs: 1, sampleCount: 0 } },
    timingQualification: { evidenceId: 'synthetic-storage-interior', runtimeIdentity, videoDurationUs: 0, audioTimelineUs: 0, aac: null }, budget: BUDGET }] });
  const service = new EncoderService({ ...paths, stateDir: state, runtimeIdentity, run, operationQualifications: selector,
    operationRuntime: runtime, operationStorage: serviceStore, operationTelemetry: true, operationEvidenceBudget: BUDGET, operationDeadlineMs: 10000,
    inspectionCache: null, inspectionWorkers: 1, storageEligibility: { check: async () => ({ eligible: true, reason: 'Synthetic owned fixture only.' }) },
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'synthetic encoder', ffprobe: 'synthetic probe' } }),
    inspect: async () => ({ probe: clone(originalProbe), color: classifyColor(originalProbe), duration: .4,
      summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } }),
    verify: () => { throw new Error('Qualified storage tests must not use legacy validation.'); } });
  t.after(async () => {
    drain.resolve(); if (service.busy) await service.cancelCurrent(); await service.closeOperationResources();
    await store.close(); await runtime.close();
    const actual = await fs.realpath(root); assert.equal(path.dirname(actual), parent); assert.ok(path.basename(actual).startsWith('ffmpeg-storage-service-'));
    await fs.rm(actual, { recursive: true });
  });
  const inputFolder = await service.registerFolder(input, 'input'), outputFolder = await service.registerFolder(output, 'output');
  const request = { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: SETTINGS };
  return { root, output, state, storageRoot, source, sourceBytes, prior, store, service, data, runtime,
    destination: path.join(output, 'synthetic-source_H265-CPU.mkv'),
    async prepare() {
      const first = await service.prepareBatch(request); assert.equal(first.phase, 'ready', first.error);
      const result = await service.updateFileOperations({ planId: first.planId, draftId: first.operationDraft.id, revision: first.operationDraft.revision,
        fileIds: [first.items[0].id], overrides: { range: RANGE, audioPolicy: 'precision-flac' } });
      assert.equal(result.items[0].status, 'ready', JSON.stringify(result.items[0])); return result;
    },
    start(plan) { service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }); },
    async finish(plan) { this.start(plan); await service.taskPromise; return service.snapshot(); },
    async events() {
      const history = await service.getDiagnosticHistory({ limit: 200 });
      return Promise.all(history.events.map(async event => (await service.getDiagnosticRecord({ eventId: event.id })).event));
    } };
}

test('service admission counts prior retained bytes before starting any changed-operation child', { timeout: 15000 }, async t => {
  const h = await harness(t, { priorRetainedBytes: 33 * MiB }), plan = await h.prepare(), result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'OPERATION_STORAGE_ADMISSION'); assert.equal(h.data.calls.length, 0);
  assert.equal((await fs.stat(h.prior)).size, 33 * MiB); assert.ok((await h.store.snapshot()).usedBytes >= 33 * MiB);
  await absent(h.destination); assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  assert.deepEqual((await fs.readdir(h.storageRoot)).filter(name => name.startsWith('job-')), []);
});

test('actual monitor overrun drains the child, preserves diagnostics and sealed evidence, and cannot publish', { timeout: 15000 }, async t => {
  const h = await harness(t, { holdForStorage: true }), plan = await h.prepare(); h.start(plan);
  const signal = await h.data.entered.promise; await h.data.aborted.promise; await turn();
  assert.equal(signal.aborted, true); assert.equal(h.service.busy, true); assert.equal(h.data.active, 1); assert.equal(h.data.settled, false);
  assert.ok(h.data.heldChild.kills >= 1); assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }), { code: 'BUSY' });
  h.data.drain.resolve(); await h.service.taskPromise; const item = h.service.snapshot().items[0];
  assert.equal(item.status, 'failed', item.reason); assert.equal(item.reasonCode, 'OPERATION_STORAGE_LIMIT');
  assert.equal(h.data.active, 0); assert.equal(h.data.settled, true); assert.equal(h.data.maximumActive, 1);
  assert.equal(item.outputDisposition.published, false); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(item.outputDisposition.kind, 'retained-unverified'); assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic sealed encoded bytes');
  await absent(h.destination); assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  assert.equal((await fs.stat(h.data.growthFile)).size, 65 * MiB);
  assert.equal(item.evidenceStorage.final.status, 'failed'); assert.ok(item.evidenceStorage.final.violations.includes('cumulative-cap'));
  const final = JSON.parse(await fs.readFile(path.join(h.data.jobDirectory, 'storage-final.json'), 'utf8'));
  assert.equal(final.status, 'failed'); assert.ok(final.observedBeforeRecord.usedBytes >= 65 * MiB);
  const telemetry = JSON.parse(await fs.readFile(path.join(h.data.jobDirectory, 'encoder-input-receipt.json'), 'utf8'));
  assert.equal(telemetry.streams.length, 2); assert.ok(telemetry.streams.every(stream => stream.summary.records === '2'));
  const collectionName = (await fs.readdir(h.data.jobDirectory)).find(name => name.startsWith('operation-evidence-'));
  assert.ok(collectionName, 'The partial decoded collector has an independently retained namespace.');
  const collection = path.join(h.data.jobDirectory, collectionName), child = JSON.parse(await fs.readFile(path.join(collection, 'child-1.json'), 'utf8'));
  assert.equal(child.code, 'OPERATION_STORAGE_LIMIT'); assert.equal(child.cause.code, 'CANCELLED'); assert.equal(child.cause.cause.code, 'SYNTHETIC_STORAGE_CHILD_STOP');
  assert.ok(Buffer.byteLength(child.stderr) <= 256 * 1024); assert.ok(child.stderr.endsWith('SYNTHETIC CHILD END'));
  assert.deepEqual(child.stderrCapture, h.data.stderrCapture);
  const receipt = JSON.parse(await fs.readFile(path.join(collection, 'receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.failure.code, 'OPERATION_STORAGE_LIMIT');
  assert.ok((await fs.stat(path.join(collection, 'selected-video.jsonl'))).size > 0);
  const failure = (await h.events()).find(event => event.reason === 'JOB_FAILED');
  assert.equal(failure.context.code, 'OPERATION_STORAGE_LIMIT'); assert.equal(failure.context.exitCode, 9); assert.equal(failure.context.signal, 'SIGTERM');
  assert.equal(failure.stderr.totalBytes, h.data.stderrCapture.totalBytes); assert.equal(failure.stderr.truncated, true);
  assert.ok(failure.stderr.bytes <= 256 * 1024); assert.ok(failure.stderr.text.endsWith('SYNTHETIC CHILD END'));
  assert.equal(failure.context.evidenceFailure.cause.code, 'CANCELLED');
  await assert.rejects(h.store.admit({ forecastBytes: 1 }), { code: 'OPERATION_STORAGE_LIMIT' });
});

test('an explicit user cancellation keeps precedence when a storage monitor already aborted the held child', { timeout: 15000 }, async t => {
  const h = await harness(t, { holdForStorage: true }), plan = await h.prepare();
  // Production runner tails are already bounded; retain its upstream lost-prefix
  // metadata while exercising the independent global cancellation precedence.
  h.data.stderr = 'é'.repeat(120000) + ' SYNTHETIC CHILD END'; h.start(plan);
  await h.data.entered.promise; await h.data.aborted.promise;
  const cancelling = h.service.cancelBatch({ batchId: h.service.snapshot().batchId }); await turn();
  assert.equal(h.service.snapshot().phase, 'cancelling'); assert.equal(h.service.busy, true); assert.equal(h.data.active, 1);
  h.data.drain.resolve(); const result = await cancelling, item = result.items[0];
  assert.equal(result.phase, 'cancelled'); assert.equal(item.status, 'cancelled'); assert.equal(item.reasonCode, 'CANCELLED');
  assert.equal(h.data.active, 0); assert.equal(item.outputDisposition.published, false); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic sealed encoded bytes'); await absent(h.destination);
  assert.equal(item.evidenceStorage.final.status, 'cancelled'); assert.ok(item.evidenceStorage.final.violations.includes('cumulative-cap'));
  const failure = (await h.events()).find(event => event.reason === 'JOB_CANCELLED');
  assert.equal(failure.context.code, 'CANCELLED'); assert.equal(failure.stderr.totalBytes, 900000); assert.equal(failure.stderr.truncated, true);
});

test('a successful evidence child keeps bounded close diagnostics when the post-child disk observation rejects it', { timeout: 15000 }, async t => {
  // Isolate the mandatory sequential observation from the independently tested
  // periodic monitor: a closed child must retain diagnostics on this path too.
  let polls = 0; t.mock.method(global, 'setInterval', () => { polls++; return {}; });
  const h = await harness(t, { postSuccessGrowth: true }), plan = await h.prepare(), result = await h.finish(plan), item = result.items[0];
  assert.equal(polls, 1); assert.equal(h.data.postSuccessGrown, true); assert.equal(h.data.held, false); assert.equal(h.data.active, 0);
  assert.equal(h.data.lastSignal.aborted, false); assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'OPERATION_STORAGE_LIMIT');
  const successfulChild = h.data.calls.find(call => call.args.includes('-show_frames'));
  assert.deepEqual(successfulChild.close, { code: 0, signal: null });
  assert.equal(item.outputDisposition.published, false); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic sealed encoded bytes'); await absent(h.destination);
  const name = (await fs.readdir(h.data.jobDirectory)).find(entry => entry.startsWith('operation-evidence-'));
  const child = JSON.parse(await fs.readFile(path.join(h.data.jobDirectory, name, 'child-1.json'), 'utf8'));
  assert.equal(child.code, 'OPERATION_STORAGE_LIMIT'); assert.equal(child.cause.code, 'OWNED_CHILD_COMPLETED');
  assert.ok(Buffer.byteLength(child.stderr) <= 256 * 1024); assert.ok(child.stderr.endsWith('SYNTHETIC CHILD END'));
  assert.deepEqual(child.stderrCapture, h.data.stderrCapture);
  const failure = (await h.events()).find(event => event.reason === 'JOB_FAILED');
  assert.equal(failure.context.exitCode, 0); assert.equal(failure.stderr.totalBytes, 900000); assert.equal(failure.stderr.truncated, true);
  assert.ok(failure.stderr.bytes <= 256 * 1024); assert.ok(failure.stderr.text.endsWith('SYNTHETIC CHILD END'));
  assert.equal(failure.context.evidenceFailure.cause.code, 'OWNED_CHILD_COMPLETED');
  assert.equal(item.evidenceStorage.final.status, 'failed'); assert.ok(item.evidenceStorage.final.violations.includes('cumulative-cap'));
});

test('final observation failure reports current uncertainty beside last observed totals and retains its durable disposition', { timeout: 15000 }, async t => {
  const h = await harness(t, { finalObservationUnavailable: true }), plan = await h.prepare(), result = await h.finish(plan), item = result.items[0];
  assert.equal(h.data.failStorageObservation, true); assert.equal(h.data.active, 0);
  // Publication already committed before the injected final observation failure.
  // Report that ownership fact independently from incomplete storage accounting.
  assert.equal(item.status, 'success', item.reason); assert.equal(item.outputDisposition.published, true);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic sealed encoded bytes');
  assert.equal(item.evidenceStorage.observation, 'unavailable'); assert.equal(item.evidenceStorage.lastObserved.observation, 'complete');
  assert.ok(item.evidenceStorage.lastObserved.usedBytes > 0); assert.equal(item.evidenceStorage.accounting.observation, 'unavailable');
  assert.equal(item.evidenceStorage.accounting.recordPersisted, true); assert.equal(item.evidenceStorage.accounting.ledgerPersisted, true);
  assert.equal(item.evidenceStorage.failure.code, 'OPERATION_STORAGE_OBSERVATION'); assert.match(item.evidenceWarning, /accounting is incomplete/);
  const final = JSON.parse(await fs.readFile(path.join(h.data.jobDirectory, 'storage-final.json'), 'utf8'));
  assert.equal(final.observation, 'unavailable'); assert.ok(final.lastObserved.usedBytes > 0);
  const ledger = JSON.parse(await fs.readFile(path.join(h.storageRoot, '.storage-ledger.json'), 'utf8'));
  assert.equal(ledger.accounting.observation, 'unavailable'); assert.equal(ledger.accounting.accountingReset, false);
  const disposition = (await h.events()).find(event => event.reason === 'JOB_DISPOSITION');
  assert.equal(disposition.context.evidenceStorage.observation, 'unavailable');
  assert.equal(disposition.context.evidenceStorage.lastObserved.observation, 'complete');
  assert.equal(disposition.context.evidenceStorage.accounting.recordPersisted, true);
  assert.equal(disposition.context.evidenceStorage.accounting.ledgerPersisted, true); assert.equal(disposition.context.evidenceWarning, item.evidenceWarning);
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
});

test('publication uncertainty keeps precedence over a simultaneous actual cumulative-storage overrun', { timeout: 15000 }, async t => {
  const h = await harness(t), plan = await h.prepare();
  const originalLink = fs.link, originalLstat = fs.lstat; let committed = false, denied = false;
  fs.link = async (...args) => { const result = await originalLink(...args); if (args[1] === h.destination) committed = true; return result; };
  fs.lstat = async (...args) => {
    if (committed && !denied && args[0] === h.destination) {
      denied = true; h.data.growthFile = path.join(h.data.jobDirectory, 'publication-observation-growth.bin'); await sized(h.data.growthFile, 65 * MiB);
      const signal = h.data.lastSignal; if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('Synthetic exact-destination observation denied after commit and monitor abort.'), { code: 'EACCES' });
    }
    return originalLstat(...args);
  };
  let result;
  try { result = await h.finish(plan); } finally { fs.link = originalLink; fs.lstat = originalLstat; }
  const item = result.items[0]; assert.equal(committed, true); assert.equal(denied, true); assert.equal(h.data.active, 0);
  assert.equal(item.status, 'failed', item.reason); assert.equal(item.reasonCode, 'PUBLICATION_UNCERTAIN');
  assert.equal(item.outputDisposition.kind, 'publication-uncertain'); assert.equal(item.outputDisposition.published, null);
  assert.equal(item.outputDisposition.file, h.destination); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic sealed encoded bytes');
  assert.equal(await fs.readFile(h.data.encodes[0].args.at(-1), 'utf8'), 'synthetic sealed encoded bytes');
  assert.equal(item.evidenceStorage.final.status, 'failed'); assert.ok(item.evidenceStorage.final.violations.includes('cumulative-cap'));
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  assert.equal((await h.events()).find(event => event.reason === 'JOB_FAILED').context.code, 'PUBLICATION_UNCERTAIN');
});
