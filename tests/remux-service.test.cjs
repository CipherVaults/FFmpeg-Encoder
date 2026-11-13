'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const { EVIDENCE_BUDGET } = require('../src/operation-controls.cjs');
const { fixture: movFixture } = require('./helpers/mov-fixture.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');

// Preparation/authority tests use owned inert bytes and injected media facts.
// They do not invoke FFmpeg, qualify a physical file or establish native media.
const RUNTIME = 'a'.repeat(64);
const parent = path.resolve(__dirname, '../artifacts/v0.7/slice3/service-unit');
function probe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 31,
    width: 320, height: 180, coded_width: 320, coded_height: 180, pix_fmt: 'yuv420p', field_order: 'progressive',
    color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', chroma_location: 'left',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2', tags: { title: 'Native video' }, disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000',
    channels: 2, channel_layout: 'stereo', time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2',
    tags: { language: 'eng', title: 'Stereo' }, disposition: { default: 1 } }],
  format: { format_name: 'matroska,webm', duration: '2', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic preparation facts' } },
  chapters: [], programs: [], stream_groups: [] };
}
async function harness(t, { target = 'matroska', count = 1, explicitAudio = false, videoTags = {}, mov = false, change = () => {} } = {}) {
  await fs.mkdir(parent, { recursive: true }); const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'); await fs.mkdir(input); await fs.mkdir(output);
  for (let i = 0; i < count; i++) await fs.writeFile(path.join(input, `source-${i}.mkv`), 'Owned inert source bytes ' + randomUUID());
  const service = new EncoderService({ ffmpeg: path.join(root, 'dummy-ffmpeg'), ffprobe: path.join(root, 'dummy-ffprobe'), stateDir: path.join(root, 'state'),
    inspect: async file => { const value = probe(); if (mov) value.format.format_name = 'mov,mp4,m4a,3gp,3g2,mj2';
      Object.assign(value.streams[0].tags, videoTags); change(value); value.format.size = String((await fs.stat(file)).size); return { probe: value, duration: 2, summary: {} }; }, capabilities: async () => { throw new Error('Remux must not initialize encoders'); },
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false, reason: 'Synthetic storage observation' }) },
    runtimeIdentity: RUNTIME, operationRuntime: { observe: async () => Object.freeze({}), snapshot: () => ({ runtimeIdentity: RUNTIME, environment: null }), close: async () => {} },
    operationStorage: () => { throw new Error('No execution storage should open during preparation'); },
    operationEvidenceBudget: EVIDENCE_BUDGET, operationDeadlineMs: 600000,
    remuxOperations: new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-main-route-policy', policies: mov
      ? [{ id: 'synthetic-mov', inputFamily: 'isobmff', target: 'mov', evidenceIds: ['synthetic-route'], allowAncillary: false,
        runtimeIdentity: RUNTIME, sourceEnvelope: 'h264-aac-lc-48k-stereo-v1' }]
      : ['matroska', 'mp4'].map(target =>
        ({ id: 'synthetic-' + target, inputFamily: 'matroska', target, evidenceIds: ['synthetic-route'], allowAncillary: false, runtimeIdentity: RUNTIME,
          ...(explicitAudio && target === 'mp4' ? { audio: 'explicitly-omitted-only' } : {}) })) }) });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target });
  return { service, input, output, a, b };
}
test('MOV source-shape, AAC and required-track-tag guards reach service preparation before any Start', async t => {
  for (const [change, code] of [
    [p => { p.streams[1].sample_rate = '44100'; }, 'REMUX_MOV_AUDIO_UNQUALIFIED'],
    [p => { p.streams[0].avg_frame_rate = '299/10'; }, 'REMUX_MOV_RATE_UNQUALIFIED'],
    [p => { p.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: {} }]; }, 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED'],
    [p => { p.streams[0].tags.BPS = '1000'; }, 'REMUX_TRACK_TAG_UNREPRESENTABLE'],
  ]) {
    const { service } = await harness(t, { mov: true, target: 'mov', change }); const s = service.snapshot();
    assert.equal(s.items[0].status, 'unsupported'); assert.equal(s.items[0].reasonCode, code);
    assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'INVALID_SELECTION' });
  }
  const { service } = await harness(t, { mov: true, target: 'mov' });
  assert.equal(service.snapshot().items[0].status, 'ready', service.snapshot().items[0].reason);
});

async function cadenceJob(t, { sourceVariable = false, outputVariable = false, insufficient = false } = {}) {
  // Real service, owner, collector, validator and publication; only tool output,
  // runtime observation and storage accounting are injected. Atom fixtures are
  // inert bytes, not playable media, and no native process is created.
  const timestamps = variable => insufficient ? [0] : variable ? [0, 1000, 3000] : [0, 1000, 2000];
  const extent = variable => String((timestamps(variable).at(-1) + 1000) / 30000).slice(0, 14);
  const h = await harness(t, { target: 'mov', mov: true, change: p => {
    Object.assign(p.streams[0], { width: 2, height: 2, coded_width: 2, coded_height: 2, display_aspect_ratio: '1:1',
      time_base: '1/30000', duration_ts: timestamps(sourceVariable).at(-1) + 1000, duration: extent(sourceVariable) });
    p.streams[0].tags.language = 'und'; p.streams[1].tags.language = 'und';
    Object.assign(p.streams[1], { time_base: '1/48000', duration_ts: 4, duration: '0.000083333333' });
    p.format.duration = extent(sourceVariable);
  } });
  const service = h.service, ready = service.snapshot();
  assert.equal(ready.items[0].status, 'ready', ready.items[0].reason);
  const entry = service.plan.entries.get(ready.items[0].id), original = await fs.readFile(entry.file);
  const evidence = path.join(path.dirname(h.input), 'cadence-evidence'); await fs.mkdir(evidence);
  service.operationStorage = { admit: async () => ({ directory: evidence }), assertReservation: async () => {},
    observeGrowth: async () => ({}), finish: async () => ({ final: { violations: [] } }), close: async () => {} };
  let outputProbe;
  const run = async (executable, args, options = {}) => {
    let bytes = Buffer.alloc(0);
    if (args.includes('-c') && args[args.indexOf('-c') + 1] === 'copy') {
      await fs.writeFile(args.at(-1), movFixture([{ id: 1 }, { id: 2 }]));
    } else if (args.includes('-show_format')) {
      outputProbe = structuredClone(entry.inspection.probe);
      outputProbe.streams.forEach((stream, i) => {
        stream.id = '0x' + (i + 1); stream.tags.name = stream.tags.title; delete stream.tags.title;
        stream.tags.handler_name = i === 0 ? 'VideoHandler' : 'SoundHandler';
      });
      Object.assign(outputProbe.streams[0], { duration_ts: timestamps(outputVariable).at(-1) + 1000, duration: extent(outputVariable) });
      Object.assign(outputProbe.format, { size: String((await fs.stat(args.at(-1))).size), duration: extent(outputVariable),
        tags: { ...outputProbe.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: entry.outputId } });
      bytes = Buffer.from(JSON.stringify(outputProbe));
    } else {
      const file = args[args.indexOf('-i') + 1], isOutput = file !== entry.file;
      const index = Number(args[args.indexOf(args.includes('-select_streams') ? '-select_streams' : '-map') + 1].replace(/^0:/, ''));
      const pts = timestamps(isOutput ? outputVariable : sourceVariable);
      if (args.includes('-show_frames')) bytes = Buffer.from(JSON.stringify({ frames: index === 0
        ? pts.map(pts => ({ media_type: 'video', stream_index: 0, pts, duration: 1000, width: 2, height: 2, pix_fmt: 'yuv420p', key_frame: 1 }))
        : [{ media_type: 'audio', stream_index: 1, pts: 0, nb_samples: 4, sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }] }));
      else if (args.includes('-show_packets')) bytes = Buffer.from(JSON.stringify({ packets: pts.map(pts =>
        ({ stream_index: 0, pts, duration: 1000, size: '6', data_hash: `SHA256:${'c'.repeat(64)}` })) }));
      else if (args.includes('framehash')) bytes = Buffer.from('#hash: SHA256\n' + pts.map((pts, i) => `0, ${i}, ${pts}, 1000, 6, ${'c'.repeat(64)}\n`).join(''));
      else { assert.ok(args.includes('pcm_f32le')); bytes = Buffer.alloc(4 * 2 * 4, 5); }
    }
    await options.onStdoutChunk?.(bytes);
    return { exitCode: 0, stdout: options.onStdoutChunk ? '' : bytes.toString(), stderr: '',
      stderrCapture: { totalBytes: 0, truncated: false }, stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: Boolean(options.onStdoutChunk) } };
  };
  service.run = run;
  service.operationRuntime.requireCurrent = () => ({ runtimeIdentity: RUNTIME, environment: null });
  service.operationRuntime.invoke = (_token, tool, args, options) => run(tool === 'ffmpeg' ? service.ffmpeg : service.ffprobe, args, options);
  const validate = service.remuxOperations.validate.bind(service.remuxOperations);
  let refusedCopies = 0;
  service.remuxOperations.validate = (plan, probe, receipt) => {
    // Exercise the real private-receipt boundary while the plan is still live;
    // terminal service cleanup deliberately invalidates it afterwards.
    const forged = structuredClone(receipt), video = forged.essenceEvidence.streams.find(stream => stream.codecType === 'video');
    video.source.cadence.classification = video.output.cadence.classification = 'constant';
    assert.throws(() => validate(plan, probe, forged), { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' }); refusedCopies++;
    return validate(plan, probe, receipt);
  };
  service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }); await service.taskPromise;
  assert.deepEqual(await fs.readFile(entry.file), original);
  return { ...h, entry, outputProbe, refusedCopies, result: service.snapshot().items[0] };
}

test('MOV publishes only constant/constant bound cadence; variable or insufficient collection never publishes', async t => {
  for (const options of [{}, { sourceVariable: true }, { outputVariable: true },
    { sourceVariable: true, outputVariable: true }, { insufficient: true }]) {
    const h = await cadenceJob(t, options);
    assert.equal(h.entry.operationEvidence.status, 'completed', JSON.stringify(h.entry.operationEvidence.failure));
    assert.equal(h.refusedCopies, 1);
    if (Object.keys(options).length === 0) {
      assert.equal(h.result.status, 'success', h.result.reason); assert.equal(h.result.outputDisposition.published, true);
      assert.ok((await fs.stat(h.entry.destination)).size > 0);
    } else {
      assert.equal(h.result.status, 'failed', h.result.reason); assert.equal(h.result.reasonCode, 'REMUX_MOV_CADENCE_UNQUALIFIED');
      assert.equal(h.result.outputDisposition.published, false);
      await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
    }
  }
});

test('matching variable MOV timing is refused even when native preservation checks alone would pass', async t => {
  const h = await cadenceJob(t, { sourceVariable: true, outputVariable: true });
  const video = h.entry.operationEvidence.essenceEvidence.streams.find(stream => stream.codecType === 'video');
  assert.deepEqual(video.source, video.output);
  assert.equal(h.result.reasonCode, 'REMUX_MOV_CADENCE_UNQUALIFIED');
  assert.equal(h.result.outputDisposition.published, false);
  await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
});
test('Remux prepares a canonical Full copy without an encoder or quality settings', async t => {
  const { service } = await harness(t); const s = service.snapshot();
  assert.equal(s.operation, 'remux'); assert.equal(s.settings, null); assert.equal(s.phase, 'ready');
  assert.equal(s.items[0].status, 'ready', s.items[0].reason); assert.match(s.items[0].outputName, /_Remux-MKV\.mkv$/);
  const detail = service.getEncodingDetails({ planId: s.planId, fileId: s.items[0].id });
  assert.equal(detail.operation.contract.range.kind, 'full'); assert.ok(detail.args.includes('copy'));
  for (const option of ['-preset', '-crf', '-cq', '-vf', '-af', '-ss', '-t']) assert.ok(!detail.args.includes(option));
  const oldPlan = service.plan; service.invalidatePreparedEncoding(); assert.equal(service.plan, oldPlan);
});
test('known AAC conversion refuses; exact omission set enables only the remaining qualified video', async t => {
  const { service } = await harness(t, { target: 'mp4' }); let s = service.snapshot(), item = s.items[0];
  assert.equal(item.status, 'unsupported'); assert.match(item.reason, /AAC|priming|Matroska/i);
  const candidate = item.remux.omissionCandidates.find(value => value.streamIndex === 1); assert.ok(candidate);
  const oldPlan = s.planId;
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); item = s.items[0]; assert.notEqual(s.planId, oldPlan); assert.equal(item.status, 'ready', item.reason);
  assert.equal(item.remux.streams.find(value => value.streamIndex === 1).action, 'explicitly-omitted');
  assert.deepEqual(item.remux.omissionDecisionIds, [candidate.id]);
  const detail = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); assert.deepEqual(detail.operation.expectedOutput.streams.map(value => value.inputIndex), [0]);
  assert.throws(() => service.setRemuxOmissions({ planId: oldPlan, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] }), { code: 'STALE_PLAN' });
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [] });
  assert.equal(service.snapshot().items[0].status, 'unsupported');
});
test('explicit-audio MP4 route exposes the omission refusal and revokes Ready when the choice is cleared', async t => {
  const { service } = await harness(t, { target: 'mp4', explicitAudio: true });
  let s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.match(s.items[0].reason, /Matroska-to-MP4 requires a current explicit omission decision for every audio stream/);
  const candidate = s.items[0].remux.omissionCandidates.find(item => item.streamIndex === 1);
  assert.ok(candidate);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'ready', s.items[0].reason);
  const ready = s;
  assert.deepEqual(service.getEncodingDetails({ planId: s.planId, fileId: s.items[0].id }).operation.expectedOutput.streams.map(item => item.inputIndex), [0]);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.match(s.items[0].reason, /every audio stream/);
  assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }), { code: 'STALE_PLAN' });
});
test('an explicit audio omission cannot make an unrepresentable Matroska track tag Ready', async t => {
  const { service } = await harness(t, { target: 'mp4', explicitAudio: true, videoTags: { BPS: '12345' } });
  let s = service.snapshot(); assert.equal(s.items[0].reasonCode, 'REMUX_AUDIO_OMISSION_REQUIRED');
  const candidate = s.items[0].remux.omissionCandidates.find(item => item.streamIndex === 1);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.equal(s.items[0].reasonCode, 'REMUX_TRACK_TAG_UNREPRESENTABLE'); assert.match(s.items[0].reason, /'BPS'/);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'INVALID_SELECTION' });
});
test('arbitrary/duplicate/foreign decisions and transforms cannot manufacture Remux authority', async t => {
  const { service, a, b } = await harness(t); const s = service.snapshot(), candidate = s.items[0].remux.omissionCandidates[0];
  for (const decisionIds of [[randomUUID()], [candidate.id, candidate.id], ['../source'], [{ id: candidate.id }]]) {
    assert.throws(() => service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds }));
  }
  await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska', args: ['-y'] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => service.updateFileOperations({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision,
    fileIds: [s.items[0].id], overrides: { range: { startUs: 1 } } }));
});
test('changed source invalidates an omission before it can become prepared', async t => {
  const { service, input } = await harness(t); const s = service.snapshot(), candidate = s.items[0].remux.omissionCandidates[0];
  await fs.appendFile(path.join(input, s.items[0].name), 'changed');
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  assert.equal(service.snapshot().phase, 'failed'); assert.equal(service.plan, null);
});
test('ordinary reprepare and target changes revoke temporary omission decisions', async t => {
  const { service } = await harness(t); let s = service.snapshot(); const candidate = s.items[0].remux.omissionCandidates[0];
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); await service.updateBatchOperationDefaults({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, overrides: { remuxTarget: 'mp4' } });
  s = service.snapshot(); assert.deepEqual(s.items[0].remux.omissionDecisionIds, []); assert.equal(s.items[0].status, 'unsupported');
});

test('cancelling a ready Remux batch revokes its old Start and omission authority', async t => {
  const { service } = await harness(t); const s = service.snapshot();
  await service.cancelBatch({ batchId: s.batchId });
  assert.equal(service.snapshot().phase, 'cancelled'); assert.equal(service.plan, null);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'STALE_PLAN' });
  assert.throws(() => service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, decisionIds: [s.items[0].remux.omissionCandidates[0].id] }), { code: 'STALE_PLAN' });
});

test('ready Remux cancellation keeps admission closed until diagnostics and owned writes drain', async t => {
  const { service, a, b } = await harness(t), before = service.snapshot(), oldController = service.controller;
  let releaseIncident, releaseWrite, incidentEntered;
  const entered = new Promise(resolve => { incidentEntered = resolve; });
  const incident = new Promise(resolve => { releaseIncident = resolve; });
  const write = new Promise(resolve => { releaseWrite = resolve; });
  const record = service.recordIncident.bind(service);
  service.recordIncident = async event => {
    if (event.reason === 'PREPARED_REMUX_CANCELLED') { incidentEntered(); await incident; }
    return record(event);
  };
  service.appSettingsMutations.add(write);
  const cancelling = service.cancelBatch({ batchId: before.batchId }); await entered;
  const duplicate = service.cancelCurrent();
  try {
    assert.equal(service.snapshot().phase, 'cancelling');
    assert.equal(service.plan, null);
    await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' }), { code: 'BUSY' });
    assert.equal(service.controller, oldController);
    releaseIncident(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.snapshot().phase, 'cancelling', 'Saved writes must also drain before admission reopens.');
    await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' }), { code: 'BUSY' });
  } finally {
    releaseIncident(); releaseWrite(); await Promise.allSettled([cancelling, duplicate]);
    service.appSettingsMutations.delete(write);
  }
  assert.equal(service.snapshot().phase, 'cancelled');
  await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' });
  assert.notEqual(service.snapshot().batchId, before.batchId);
  assert.equal(service.snapshot().phase, 'ready');
  assert.equal(service.controller.signal.aborted, false, 'Completed old cancellation cannot abort the subsequent batch.');
});
