'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { OperationQualificationSelector } = require('../src/operation-qualification.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { classifyColor, PROFILES } = require('../src/media.cjs');
const { ToolError } = require('../src/process-runner.cjs');

// Synthetic main-trusted applicability cells and injected streaming runner only.
// Temporary .mov/.mkv names contain dummy bytes, not media. No native binaries,
// children, applications, devices or network are opened. The actual production
// builder, selector, collector, validator, source assessment and publisher run.
const artifactParent = path.resolve(__dirname, '..', 'artifacts', 'v0.7', 'slice2', 'qualified-service-tests');
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const RUNTIME = 'a'.repeat(64);
const POLICY = 'synthetic-service-selector-policy-v1';
const RANGE = { startUs: 100000, endUs: 300000 };
const BUDGET = { sourceDecode: 'complete', timeoutMs: 10000, maxFrameBytes: 1048576, maxPcmBytes: 1048576, maxRecords: 10000, maxSpoolBytes: 1048576 };
const COLOR = { color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' };
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
function sourceProbe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', ...COLOR,
    field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/1000', start_pts: 0, start_time: '0',
    duration_ts: 400, duration: '0.4', avg_frame_rate: '10/1', r_frame_rate: '10/1', tags: { title: 'Synthetic video', rotate: '0' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', bits_per_raw_sample: 16, channels: 2, channel_layout: 'stereo',
    sample_rate: '48000', time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 19200, duration: '0.4',
    tags: { title: 'Synthetic stereo', language: 'eng' }, disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '0.4', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic source' } },
  chapters: [], programs: [], stream_groups: [] };
}
// A copy of the source whose video and audio end after 0.2 seconds.
function shortProbe(probe) {
  const result = clone(probe);
  Object.assign(result.streams[0], { duration_ts: 200, duration: '0.2' }); Object.assign(result.streams[1], { duration_ts: 9600, duration: '0.2' });
  result.format.duration = '0.2'; return result;
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
async function harness(t, { mode = 'precision-flac', sameFolder = false, missingBudget = false, onEncode, onStream, executionBudgetMs = 60000, probeChange, shortCopy = false } = {}) {
  await fs.mkdir(artifactParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifactParent, 'run-'));
  const input = path.join(root, 'input'), output = sameFolder ? input : path.join(root, 'output');
  await fs.mkdir(input); if (!sameFolder) await fs.mkdir(output);
  const source = path.join(input, 'synthetic-source.mov'), sourceBytes = Buffer.from('synthetic immutable original bytes');
  await fs.writeFile(source, sourceBytes);
  if (shortCopy) await fs.writeFile(path.join(input, 'synthetic-short.mov'), Buffer.from('synthetic short original bytes'));
  let service;
  t.after(async () => {
    if (service?.busy) await service.cancelCurrent();
    const actual = await fs.realpath(root), parent = await fs.realpath(artifactParent);
    assert.ok(actual.startsWith(parent + path.sep) && path.basename(actual).startsWith('run-'), 'Cleanup must remain inside this owned test tree.');
    await fs.rm(actual, { recursive: true });
  });
  const probe = sourceProbe(), sourceIdentity = await readSourceIdentity(source); probeChange?.(probe);
  const cell = { evidenceIds: ['synthetic-service-endpoint', 'synthetic-service-interior'], runtimeIdentity: RUNTIME,
    sourceIdentity, sourceProbeFingerprint: fingerprintEncodeSource(probe), settings: SETTINGS,
    request: { range: RANGE, resolution: 'source', target: 'matroska', hdrPolicy: 'preserve', audioPolicy: mode, aacBitrateKbps: null, omissionRequestIds: [] },
    qualification: { evidenceId: 'synthetic-service-endpoint', runtimeIdentity: RUNTIME, containerDuration: 'end-timestamp',
      tolerances: { videoTimestampUs: 0, audioTimestampUs: mode === 'precision-aac' ? 5000 : 0,
        avSyncUs: mode === 'precision-aac' ? 5000 : 0, durationUs: 1, sampleCount: mode === 'precision-aac' ? 256 : 0 } },
    timingQualification: { evidenceId: 'synthetic-service-interior', runtimeIdentity: RUNTIME, videoDurationUs: 0, audioTimelineUs: 0,
      aac: mode === 'precision-aac' ? { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 0, discardPaddingSamples: 0 } : null },
    budget: BUDGET };
  const selector = new OperationQualificationSelector({ cells: [cell], policyIdentity: POLICY });
  const outputProbe = clone(probe); outputProbe.format.format_name = 'matroska,webm'; outputProbe.format.duration = '.2'; outputProbe.format.start_time = '0';
  Object.assign(outputProbe.streams[0], { codec_name: 'hevc', duration: '.2', duration_ts: 200 });
  Object.assign(outputProbe.streams[1], { index: 1, codec_name: mode === 'precision-flac' ? 'flac' : 'aac', time_base: '1/1000', duration: '.2', duration_ts: 200 });
  if (mode === 'precision-aac') Object.assign(outputProbe.streams[1], { sample_fmt: 'fltp', profile: 'LC', bits_per_raw_sample: 0 });
  const sourcePcm = Buffer.alloc(19200 * 4);
  for (let index = 0; index < sourcePcm.length; index++) sourcePcm[index] = (index * 17 + Math.floor(index / 256)) % 256;
  const data = { calls: [], encodes: [], active: 0, maximumActive: 0, legacyValidations: 0, fault: null,
    sourceFrames: { 0: frames(probe.streams[0], [0, 100, 200, 300]), 2: frames(probe.streams[1], [0, 4800, 9600, 14400], true) },
    outputFrames: { 0: frames(outputProbe.streams[0], [0, 100]), 1: frames(outputProbe.streams[1], [0, 100], true) },
    sourcePcm, outputPcm: Buffer.from(sourcePcm.subarray(4800 * 4, 14400 * 4)), outputProbe, onStream, onEncode };
  const ffmpeg = path.join(root, 'synthetic-tools', 'ffmpeg.exe'), ffprobe = path.join(root, 'synthetic-tools', 'ffprobe.exe');
  const run = async (executable, args, options = {}) => {
    const call = { executable, args: [...args], options, streamed: Boolean(options.onStdoutChunk) };
    data.calls.push(call); data.active++; data.maximumActive = Math.max(data.maximumActive, data.active);
    try {
      if (options.signal?.aborted) throw new ToolError('CANCELLED', 'Synthetic runner closed after cancellation.');
      if (!options.onStdoutChunk && executable === ffmpeg) {
        data.encodes.push(call);
        await data.onEncode?.({ source, args, options, service, data, output });
        await fs.writeFile(args.at(-1), 'synthetic encoded output bytes', { flag: 'wx' });
        options.onProgress?.({ seconds: .1, speed: 1, fps: 10, bytes: 100, frame: 1, ended: false });
        return { stdout: '', stderr: '', exitCode: 0, stdoutCapture: { totalBytes: 0, truncated: false }, stderrCapture: { totalBytes: 0, truncated: false } };
      }
      if (!options.onStdoutChunk) {
        const actual = clone(data.outputProbe), encoded = data.encodes.find(item => item.args.at(-1) === args.at(-1));
        Object.assign(actual.format.tags, metadata(encoded.args));
        return { stdout: JSON.stringify(actual), stderr: '', exitCode: 0 };
      }
      const isSource = args[args.indexOf('-i') + 1] === source;
      let bytes;
      if (args.includes('-show_frames')) {
        const index = args[args.indexOf('-select_streams') + 1];
        bytes = Buffer.from((isSource ? data.sourceFrames : data.outputFrames)[index].map(row => line('frame', row)).join(''));
      } else if (args.includes('-show_packets')) bytes = Buffer.from(line('packet', { stream_index: 1 }));
      else bytes = isSource ? data.sourcePcm : data.outputPcm;
      await data.onStream?.({ call, isSource, args, options, data, service });
      if (options.signal?.aborted) throw new ToolError('CANCELLED', 'Synthetic streaming child and sinks have settled after cancellation.');
      if (data.fault === 'sink' && args.includes('-show_packets')) bytes = Buffer.from('packet|stream_index=1|unknown_field=0\n');
      try { for (let index = 0; index < bytes.length; index += 313) await options.onStdoutChunk(bytes.subarray(index, index + 313)); }
      catch (cause) { throw new ToolError('STDOUT_SINK_FAILED', 'Synthetic binary output consumer failed.', { cause, stderr: '', stderrCapture: { totalBytes: 0, truncated: false } }); }
      const truncated = data.fault === 'truncated';
      return { stdout: '', exitCode: 0, stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
        stdoutCapture: { totalBytes: bytes.length, truncated, streamed: data.fault !== 'unconfirmed' } };
    } finally { data.active--; }
  };
  service = new EncoderService({ ffmpeg, ffprobe, stateDir: path.join(root, 'state'), runtimeIdentity: RUNTIME, run,
    inspectionCache: null, inspectionWorkers: 1, operationQualifications: selector,
    storageEligibility: { check: async () => ({ eligible: true, reason: 'Synthetic local-storage fixture only.' }) },
    operationEvidenceBudget: missingBudget ? null : BUDGET, operationDeadlineMs: executionBudgetMs,
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'synthetic ffmpeg fixture', ffprobe: 'synthetic ffprobe fixture' } }),
    inspect: async file => ({ probe: path.basename(file) === 'synthetic-short.mov' ? shortProbe(probe) : clone(probe), color: classifyColor(probe), duration: .4,
      summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } }),
    verify: () => { data.legacyValidations++; return { valid: true, errors: [] }; } });
  const updates = []; service.on('update', state => { updates.push(state); });
  const inputFolder = await service.registerFolder(input, 'input'), outputFolder = await service.registerFolder(output, 'output');
  const request = { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: SETTINGS };
  const result = { root, input, output, source, sourceBytes, sourceIdentity, selector, service, request, data, updates,
    destination: path.join(output, 'synthetic-source_H265-CPU.mkv'),
    async prepare({ ordinary = false, overrides = { range: RANGE, audioPolicy: mode } } = {}) {
      const first = await service.prepareBatch(request);
      assert.equal(first.phase, 'ready', first.error);
      if (ordinary) return first;
      return service.updateFileOperations({ planId: first.planId, draftId: first.operationDraft.id, revision: first.operationDraft.revision,
        fileIds: [first.items[0].id], overrides });
    },
    start(plan) { return service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }); },
    async finish(plan) { this.start(plan); await service.taskPromise; return service.snapshot(); },
    async events() {
      const history = await service.getDiagnosticHistory({ limit: 200 });
      return Promise.all(history.events.map(async item => (await service.getDiagnosticRecord({ eventId: item.id })).event));
    } };
  return result;
}
async function absent(file) { await assert.rejects(fs.stat(file), { code: 'ENOENT' }); }
function requireReady(plan) { assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0])); }

test('qualified exact FLAC range executes the canonical plan, complete evidence and protected publication', async t => {
  const h = await harness(t, { sameFolder: true }), plan = await h.prepare(); requireReady(plan);
  const entry = h.service.plan.entries.get(plan.items[0].id), prepared = h.service.getEncodingDetails({ planId: plan.planId, fileId: plan.items[0].id });
  assert.equal(entry.operationPlan.compatibilityPath, false);
  assert.deepEqual(prepared.operation.expectedOutput, entry.operationPlan.expectedOutput);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'success', item.reason); assert.equal(item.outcome, 'saved');
  assert.equal(item.outputDisposition.published, true); assert.equal(h.data.encodes.length, 1); assert.equal(h.data.legacyValidations, 0);
  assert.equal(h.data.maximumActive, 1); assert.equal(h.data.active, 0);
  assert.deepEqual(h.data.encodes[0].args.slice(0, -1), entry.operationPlan.args.slice(0, -1));
  assert.notEqual(h.data.encodes[0].args.at(-1), entry.destination);
  assert.ok(h.data.encodes[0].args.at(-1).startsWith(h.output + path.sep + '.ffmpeg-encoder-'));
  assert.equal(entry.operationEvidence.status, 'completed'); assert.equal(entry.operationEvidence.invocations.length, 7);
  const audio = entry.operationEvidence.decodedEvidence.audio[0];
  assert.equal(audio.sourceSampleCount, 9600); assert.equal(audio.outputSampleCount, 9600);
  assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
  assert.equal(audio.pcmIdentity.sourceBytes, 38400);
  const diskReceipt = JSON.parse(await fs.readFile(path.join(entry.operationEvidence.directory, 'receipt.json'), 'utf8'));
  assert.equal(diskReceipt.status, 'completed'); assert.equal(diskReceipt.planFingerprint, entry.operationPlan.planFingerprint);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic encoded output bytes');
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  assert.ok(h.updates.some(state => state.progress?.stage === 'encoding' && state.progress.duration === .2 && state.progress.percent === 50));
  assert.ok(h.updates.some(state => state.progress?.stage === 'evidence-collection'));
  const events = await h.events(), invocation = events.find(event => event.reason === 'ENCODE_STARTED');
  const collected = events.find(event => event.reason === 'OPERATION_EVIDENCE_COLLECTED');
  const validated = events.find(event => event.reason === 'OUTPUT_CHECKED');
  assert.ok(invocation && collected && validated);
  assert.equal(collected.invocationId, invocation.invocationId); assert.equal(validated.invocationId, invocation.invocationId);
  assert.equal(collected.fileId, item.id); assert.equal(collected.batchId, invocation.batchId);
  assert.equal(collected.context.planFingerprint, entry.operationPlan.planFingerprint);
  assert.deepEqual(collected.context.evidenceIds, ['synthetic-service-endpoint', 'synthetic-service-interior']);
  assert.equal(validated.context.validation.validation, 'decoded-operation-contract');
  assert.equal(validated.context.validation.valid, true);
});

test('a published changed-path item carries the checked timing as inert data; ordinary and new preparations have none', async t => {
  const h = await harness(t), plan = await h.prepare(); requireReady(plan);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'success', item.reason);
  assert.equal(item.timing.timeline, 'request-relative');
  assert.deepEqual(item.timing.requested, RANGE); assert.deepEqual(item.timing.resolved, RANGE);
  assert.equal(item.timing.audio.length, 1); assert.equal(item.timing.audio[0].inputIndex, 2);
  assert.ok(Number.isSafeInteger(item.timing.video.startUs) && item.timing.video.startUs >= RANGE.startUs);
  assert.ok(item.timing.video.endUs <= RANGE.endUs);
  const validated = (await h.events()).find(event => event.reason === 'OUTPUT_CHECKED');
  assert.deepEqual(validated.context.validation.timing, item.timing);
  // A new preparation starts from fresh items; an ordinary job never gains timing.
  const again = await h.prepare({ ordinary: true });
  assert.equal(Object.hasOwn(again.items[0], 'timing'), false);
  const fresh = await harness(t), ordinaryPlan = await fresh.prepare({ ordinary: true }); requireReady(ordinaryPlan);
  const ordinary = await fresh.finish(ordinaryPlan);
  assert.equal(ordinary.items[0].status, 'success', ordinary.items[0].reason);
  assert.equal(Object.hasOwn(ordinary.items[0], 'timing'), false);
});

test('each prepared item carries main\'s exact range limit as inert data, or null when unknown', async t => {
  const h = await harness(t), first = await h.prepare({ ordinary: true });
  assert.equal(first.items[0].rangeLimitUs, 400000);
  const ranged = await h.prepare(); assert.equal(ranged.items[0].rangeLimitUs, 400000);
  // A re-preparation that leaves the item before inspection never keeps the previous limit.
  await fs.writeFile(h.destination, 'pre-existing output');
  const again = await h.service.updateFileOperations({ planId: ranged.planId, draftId: ranged.operationDraft.id, revision: ranged.operationDraft.revision,
    fileIds: [ranged.items[0].id], overrides: { range: { startUs: 100000, endUs: 200000 } } });
  assert.notEqual(again.items[0].status, 'ready'); assert.equal(Object.hasOwn(again.items[0], 'rangeLimitUs'), false);
  const unknown = await harness(t, { probeChange: probe => { delete probe.streams[0].duration; delete probe.streams[0].duration_ts; } });
  const plan = await unknown.prepare({ ordinary: true });
  assert.equal(plan.items[0].rangeLimitUs, null);
  assert.ok(Object.hasOwn(plan.items[0], 'rangeLimitUs'));
});

test('one range applied to files of different lengths is refused only for the file it exceeds, never clamped', async t => {
  const h = await harness(t, { shortCopy: true }), first = await h.service.prepareBatch(h.request);
  assert.equal(first.phase, 'ready', first.error); assert.equal(first.items.length, 2);
  const plan = await h.service.updateFileOperations({ planId: first.planId, draftId: first.operationDraft.id, revision: first.operationDraft.revision,
    fileIds: first.items.map(item => item.id), overrides: { range: RANGE, audioPolicy: 'precision-flac' } });
  const byName = name => plan.items.find(item => item.name === name);
  const long = byName('synthetic-source.mov'), short = byName('synthetic-short.mov');
  assert.equal(long.status, 'ready', JSON.stringify(long)); assert.equal(long.rangeLimitUs, 400000);
  assert.equal(short.status, 'unsupported'); assert.equal(short.reasonCode, 'RANGE_EXCEEDS_DURATION'); assert.equal(short.rangeLimitUs, 200000);
  // The exact request is kept for both files; nothing was shortened to fit.
  for (const file of plan.operationDraft.files) assert.deepEqual(file.request.range, RANGE);
  assert.equal(h.service.plan.entries.size, 1); assert.ok(h.service.plan.entries.has(long.id)); assert.equal(h.data.encodes.length, 0);
});

test('missing collection budget refuses changed preparation before an encode', async t => {
  const h = await harness(t, { missingBudget: true }), plan = await h.prepare();
  assert.equal(plan.items[0].status, 'unsupported'); assert.equal(plan.items[0].reasonCode, 'OPERATION_QUALIFICATION_REQUIRED');
  assert.equal(h.service.plan.entries.size, 0); assert.equal(h.data.encodes.length, 0); await absent(h.destination);
});

test('a resize refusal names the missing qualification only through the main-owned diagnosis', async t => {
  const large = probe => { Object.assign(probe.streams[0], { width: 1920, height: 1080 }); delete probe.streams[0].tags.rotate; };
  const counted = (h, explainResize) => {
    const calls = [];
    h.selector.explainResize = options => { calls.push(options); return explainResize(options); };
    return calls;
  };
  const refused = async ({ probeChange = large, overrides = { resolution: '720' }, explainResize, selector }, code) => {
    const h = await harness(t, { probeChange });
    if (selector) h.service.operationQualifications = selector;
    const calls = explainResize ? counted(h, explainResize) : null;
    const plan = await h.prepare({ overrides }), item = plan.items[0];
    assert.equal(item.status, 'unsupported'); assert.equal(item.reasonCode, code, JSON.stringify(item));
    assert.equal(h.service.plan.entries.size, 0); assert.equal(h.data.encodes.length, 0); await absent(h.destination);
    return { item, calls };
  };
  const reason = 'This resize has no measured qualification, so no plan was created. A resolved bounded range is required.';
  const refusal = () => ({ code: 'OPERATION_RESIZE_UNQUALIFIED', message: reason });
  // Without a diagnosis the geometry refusal stands unchanged.
  await refused({}, 'GEOMETRY_ORIENTATION_UNKNOWN');
  const named = await refused({ explainResize: refusal }, 'OPERATION_RESIZE_UNQUALIFIED');
  assert.equal(named.item.reason, reason); assert.equal(named.calls.length, 1);
  assert.deepEqual(Object.keys(named.calls[0]).sort(), ['inspection', 'request', 'runtimeIdentity', 'settings']);
  assert.equal(named.calls[0].request.resolution, '720');
  // The real production selector, wired into the service, names the gap.
  const real = await refused({ selector: new OperationFamilySelector({ policyIdentity: 'synthetic-service-family-policy-v1' }) }, 'OPERATION_RESIZE_UNQUALIFIED');
  assert.equal(real.item.reason, 'This resize has no measured qualification, so no plan was created. No measured family exists for these encoder settings and this runtime.');
  // A family that admits the request, a failing or malformed diagnosis keep the original refusal.
  for (const explainResize of [() => null, () => { throw new Error('diagnosis failed'); },
    () => ({ code: 'OPERATION_QUALIFICATION_GRANTED', message: 'not a refusal' }), () => ({ code: 'OPERATION_RESIZE_UNQUALIFIED', message: 42 })]) {
    await refused({ explainResize }, 'GEOMETRY_ORIENTATION_UNKNOWN');
  }
  // Faults in the file's own evidence, and non-geometry refusals, are never re-described.
  const contradictory = await refused({ probeChange: probe => { large(probe); probe.streams[0].display_aspect_ratio = '4:3'; }, explainResize: refusal }, 'GEOMETRY_CONFLICT');
  assert.equal(contradictory.calls.length, 0);
  const subtitled = await refused({ probeChange: probe => { Object.assign(probe.streams[0], { width: 1920, height: 1080 });
    probe.streams.push({ index: 3, codec_type: 'subtitle', codec_name: 'subrip', time_base: '1/1000', start_pts: 0, start_time: '0', duration_ts: 400, duration: '0.4', disposition: { default: 0 } });
    probe.format.nb_streams = 3; }, explainResize: refusal }, 'ENCODE_SUBTITLE_TRANSFORM_UNQUALIFIED');
  assert.equal(subtitled.calls.length, 0);
  // A changed request on a file that already fits still needs its measured family.
  const ranged = await refused({ probeChange: probe => { delete probe.streams[0].tags.rotate; }, overrides: { resolution: '720', range: RANGE, audioPolicy: 'precision-flac' },
    selector: new OperationFamilySelector({ policyIdentity: 'synthetic-service-family-policy-v1' }) }, 'OPERATION_QUALIFICATION_REQUIRED');
  assert.equal(ranged.calls, null);
  // Files that already fit prepare on the accepted ordinary path without any family or diagnosis.
  for (const [probeChange, resolution] of [[probe => { delete probe.streams[0].tags.rotate; }, '720'], [large, '1080']]) {
    const h = await harness(t, { probeChange }), calls = counted(h, refusal);
    const plan = await h.prepare({ overrides: { resolution } }); requireReady(plan);
    const entry = h.service.plan.entries.get(plan.items[0].id);
    assert.equal(entry.operationPlan.compatibilityPath, true); assert.equal(entry.operationPlan.contract.geometry.mode, 'already-fits');
    assert.equal(calls.length, 0);
  }
});

for (const change of ['catalog', 'runtime']) test(`stale ${change} refuses a previously prepared changed operation`, async t => {
  const h = await harness(t), plan = await h.prepare(); requireReady(plan);
  if (change === 'catalog') h.selector.invalidate('synthetic catalog replacement'); else h.service.runtimeIdentity = 'b'.repeat(64);
  const result = await h.finish(plan);
  assert.equal(result.items[0].status, 'failed'); assert.equal(result.items[0].reasonCode, 'OPERATION_QUALIFICATION_STALE');
  assert.equal(h.data.encodes.length, 0); assert.equal(h.data.legacyValidations, 0); await absent(h.destination);
});

for (const fault of ['truncated', 'unconfirmed', 'sink', 'missing-membership', 'wrong-pcm']) test(`incomplete evidence cannot fall back or publish (${fault})`, async t => {
  const h = await harness(t), plan = await h.prepare(); requireReady(plan);
  h.data.fault = fault;
  if (fault === 'missing-membership') h.data.outputFrames[0].pop();
  if (fault === 'wrong-pcm') h.data.outputPcm[200] ^= 1;
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'failed', item.reason);
  assert.equal(h.data.encodes.length, 1); assert.equal(h.data.legacyValidations, 0); assert.equal(h.data.active, 0);
  assert.equal(item.outputDisposition.published, false); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(item.outputDisposition.kind, 'retained-unverified');
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic encoded output bytes');
  await absent(h.destination); assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  const failure = (await h.events()).find(event => event.reason === 'JOB_FAILED');
  assert.ok(failure?.invocationId);
  if (fault === 'truncated' || fault === 'unconfirmed') assert.equal(item.reasonCode, 'OPERATION_EVIDENCE_RUNNER');
  if (fault === 'sink') {
    assert.equal(item.reasonCode, 'STDOUT_SINK_FAILED');
    assert.equal(failure.context.evidenceFailure.cause.code, 'OPERATION_EVIDENCE_INVALID');
  }
  if (fault === 'missing-membership') assert.equal(item.reasonCode, 'OPERATION_EVIDENCE_MEMBERSHIP');
  if (fault === 'wrong-pcm') assert.equal(item.reasonCode, 'INVALID_OUTPUT');
});

test('cancelled collector retains ownership until its injected child and stdout sink settle', async t => {
  const entered = deferred(), drained = deferred(); let held = false, settled = false;
  const h = await harness(t, { onStream: async ({ args, isSource, options }) => {
    if (!held && isSource && args.includes('-show_frames')) {
      held = true; entered.resolve(options.signal); await drained.promise; settled = true;
    }
  } });
  const plan = await h.prepare(); requireReady(plan); h.start(plan);
  const signal = await entered.promise;
  const cancelling = h.service.cancelBatch({ batchId: h.service.snapshot().batchId });
  await tick();
  assert.equal(signal.aborted, true); assert.equal(h.service.busy, true); assert.equal(h.service.snapshot().phase, 'cancelling');
  assert.equal(h.data.active, 1); assert.equal(settled, false);
  assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }), { code: 'BUSY' });
  await assert.rejects(h.service.prepareBatch(h.request), { code: 'BUSY' });
  drained.resolve();
  const result = await cancelling;
  assert.equal(settled, true); assert.equal(h.data.active, 0); assert.equal(h.service.busy, false);
  assert.equal(result.phase, 'cancelled'); assert.equal(result.items[0].status, 'cancelled');
  assert.equal(result.items[0].outputDisposition.published, false); assert.equal(result.items[0].outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(result.items[0].outputDisposition.file, 'utf8'), 'synthetic encoded output bytes');
  await absent(h.destination);
});

test('AAC padding warning and ctime-only source warning merge as readable published evidence', async t => {
  const h = await harness(t, { mode: 'precision-aac', onEncode: async ({ source }) => {
    try { await fs.chmod(source, 0o444); } finally { await fs.chmod(source, 0o666); }
  } });
  h.data.outputFrames[1].at(-1).nb_samples = 5000;
  h.data.outputProbe.format.duration = '.204167';
  const plan = await h.prepare(); requireReady(plan);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'success', item.reason); assert.equal(item.outcome, 'saved-with-warning');
  assert.equal(item.sourceAssessment.kind, 'ctime-only');
  assert.deepEqual(item.sourceIdentityDiagnostic.changedFields, ['ctimeNs']);
  assert.ok(item.warnings.some(warning => warning.code === 'OPERATION_VALIDATION_WARNING' && /difference 200; not sample-identical/.test(warning.message)));
  assert.ok(item.warnings.some(warning => warning.code === 'SOURCE_CTIME_ONLY'));
  assert.match(item.reason, /difference 200; not sample-identical/); assert.match(item.reason, /filesystem change time changed/);
  assert.ok(item.warnings.every(warning => typeof warning.message === 'string' && warning.message.length > 0));
  assert.equal(h.data.legacyValidations, 0); assert.equal(item.outputDisposition.published, true);
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  const disposition = (await h.events()).find(event => event.reason === 'JOB_DISPOSITION');
  assert.deepEqual(disposition.context.warnings, item.warnings);
  const exported = await h.service.getDiagnosticExport({ eventIds: [disposition.id] });
  const described = exported.data.events[0].context.operation;
  assert.equal(described.requested.audioPolicy, 'precision-aac');
  assert.deepEqual(described.requested.range, RANGE);
  assert.deepEqual(described.resolved.range.resolved, RANGE);
  assert.equal(described.resolved.audio.streams[0].index, 2);
  assert.equal(described.resolved.audio.streams[0].sampleRate, 48000);
  assert.equal(described.resolved.audio.streams[0].channelLayout, 'stereo');
  assert.equal(described.resolved.audio.streams[0].bitrateKbps, 320);
  assert.equal(described.resolved.geometry.output.width, 320);
  assert.equal(described.resolved.color.transfer, 'bt709');
  assert.equal(exported.json.includes(h.source), false);
});

test('no-overwrite publication retains validated staging when a destination appears during collection', async t => {
  let raced = false;
  const h = await harness(t, { onStream: async ({ data }) => {
    if (!raced) { raced = true; await fs.writeFile(h.destination, 'synthetic unrelated race winner', { flag: 'wx' }); }
    assert.equal(data.maximumActive, 1);
  } });
  const plan = await h.prepare(); requireReady(plan);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'skipped', item.reason); assert.equal(item.outcome, 'destination-collision');
  // Validated but not published: the timing summary belongs only to a published result.
  assert.equal(Object.hasOwn(item, 'timing'), false);
  assert.equal(item.outputDisposition.kind, 'retained-completed'); assert.equal(item.outputDisposition.validationCurrent, true);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic unrelated race winner');
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic encoded output bytes');
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
});

test('an existing destination after preview skips before any encoder or evidence invocation', async t => {
  const h = await harness(t), plan = await h.prepare(); requireReady(plan);
  await fs.writeFile(h.destination, 'synthetic existing destination', { flag: 'wx' });
  const result = await h.finish(plan);
  assert.equal(result.items[0].status, 'skipped'); assert.equal(h.data.calls.length, 0);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic existing destination');
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
});

test('failure to persist correlated collection evidence retains output without publication', async t => {
  const h = await harness(t), plan = await h.prepare(); requireReady(plan);
  const record = h.service.recordIncident.bind(h.service);
  h.service.recordIncident = event => event.reason === 'OPERATION_EVIDENCE_COLLECTED' ? Promise.resolve({ persisted: false }) : record(event);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'OPERATION_DIAGNOSTICS_INCOMPLETE');
  assert.equal(item.outputDisposition.kind, 'retained-unverified'); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic encoded output bytes');
  assert.equal(h.data.legacyValidations, 0); await absent(h.destination);
});

test('an active deadline before publication reports definite nonpublication after collector drainage', async t => {
  let held = false, collectionAborted = false;
  const h = await harness(t, { executionBudgetMs: 2000, onStream: async ({ args, isSource, options }) => {
    if (!held && isSource && args.includes('-show_frames')) {
      held = true;
      if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      collectionAborted = options.signal.aborted;
    }
  } });
  const plan = await h.prepare(); requireReady(plan);
  const result = await h.finish(plan), item = result.items[0];
  assert.equal(held, true); assert.equal(collectionAborted, true); assert.equal(h.data.active, 0);
  assert.equal(h.data.encodes.length, 1); assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'OPERATION_DEADLINE');
  assert.equal(item.outputDisposition.published, false); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'synthetic encoded output bytes');
  await absent(h.destination); assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
});

test('a committed destination remains publication-uncertain when its failed observation outlasts the active deadline', async t => {
  const executionBudgetMs = 2000;
  let encodingStartedAt, encodingSignal, encodedStage;
  const h = await harness(t, { executionBudgetMs, onEncode: async ({ args, options }) => {
    encodingStartedAt = Date.now(); encodingSignal = options.signal; encodedStage = args.at(-1);
  } });
  const plan = await h.prepare(); requireReady(plan);
  const originalLink = fs.link, originalLstat = fs.lstat;
  let committed = false, observationFailures = 0, failedObservationAt, abortedAtObservation;
  // Intercept only the exact owned test destination. The actual exclusive native
  // link commits first; its one observation is then denied after the real timer.
  fs.link = async (...args) => {
    const result = await originalLink(...args);
    if (args[1] === h.destination) {
      assert.equal(args[0], encodedStage); committed = true;
    }
    return result;
  };
  fs.lstat = async (...args) => {
    if (committed && args[0] === h.destination && observationFailures === 0) {
      observationFailures++;
      await new Promise(resolve => setTimeout(resolve, Math.max(1, encodingStartedAt + executionBudgetMs + 40 - Date.now())));
      failedObservationAt = Date.now(); abortedAtObservation = encodingSignal.aborted;
      throw Object.assign(new Error('Synthetic exact-destination observation denied after commit.'), { code: 'EACCES' });
    }
    return originalLstat(...args);
  };
  let result;
  try { result = await h.finish(plan); }
  finally { fs.link = originalLink; fs.lstat = originalLstat; }
  assert.equal(committed, true); assert.equal(observationFailures, 1);
  assert.ok(failedObservationAt >= encodingStartedAt + executionBudgetMs); assert.equal(abortedAtObservation, true);
  assert.equal(h.data.active, 0); assert.equal(h.data.encodes.length, 1);
  const item = result.items[0];
  assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'PUBLICATION_UNCERTAIN');
  assert.equal(item.outputDisposition.kind, 'publication-uncertain'); assert.equal(item.outputDisposition.published, null);
  assert.equal(item.outputDisposition.file, h.destination); assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(await fs.readFile(h.destination, 'utf8'), 'synthetic encoded output bytes');
  assert.equal(await fs.readFile(encodedStage, 'utf8'), 'synthetic encoded output bytes');
  assert.deepEqual(await fs.readFile(h.source), h.sourceBytes);
  const failure = (await h.events()).find(event => event.reason === 'JOB_FAILED');
  assert.equal(failure.context.code, 'PUBLICATION_UNCERTAIN');
});

test('shared publication validates a main-owned guard only after the last child; expiry retains the staged output',async t=>{
 const h=await harness(t),plan=await h.prepare();requireReady(plan);
 const entry=h.service.plan.entries.get(plan.items[0].id);
 let checked=0;
 h.service.publicationCurrentness=owned=>{
  assert.equal(owned,entry);
  return ()=>{
   checked++;assert.equal(h.data.active,0);
   throw new ToolError('OPERATION_DEADLINE','Synthetic owner expired immediately before the exclusive publication.');
  };
 };
 const result=await h.finish(plan),item=result.items[0];
 assert.equal(checked,1);assert.equal(item.status,'failed');assert.equal(item.reasonCode,'OPERATION_DEADLINE');
 assert.equal(item.outputDisposition.published,false);assert.equal(item.outputDisposition.validationCurrent,true);
 assert.equal(await fs.readFile(item.outputDisposition.file,'utf8'),'synthetic encoded output bytes');
 await absent(h.destination);assert.deepEqual(await fs.readFile(h.source),h.sourceBytes);
});
