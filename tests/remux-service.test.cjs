'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const { EVIDENCE_BUDGET } = require('../src/operation-controls.cjs');

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
async function harness(t, { target = 'matroska', count = 1 } = {}) {
  await fs.mkdir(parent, { recursive: true }); const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'); await fs.mkdir(input); await fs.mkdir(output);
  for (let i = 0; i < count; i++) await fs.writeFile(path.join(input, `source-${i}.mkv`), 'Owned inert source bytes ' + randomUUID());
  const service = new EncoderService({ ffmpeg: path.join(root, 'dummy-ffmpeg'), ffprobe: path.join(root, 'dummy-ffprobe'), stateDir: path.join(root, 'state'),
    inspect: async file => { const value = probe(); value.format.size = String((await fs.stat(file)).size); return { probe: value, duration: 2, summary: {} }; }, capabilities: async () => { throw new Error('Remux must not initialize encoders'); },
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false, reason: 'Synthetic storage observation' }) },
    runtimeIdentity: RUNTIME, operationRuntime: { observe: async () => Object.freeze({}), snapshot: () => ({ runtimeIdentity: RUNTIME, environment: null }), close: async () => {} },
    operationStorage: () => { throw new Error('No execution storage should open during preparation'); },
    operationEvidenceBudget: EVIDENCE_BUDGET, operationDeadlineMs: 600000,
    remuxOperations: new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-main-route-policy', policies: ['matroska', 'mp4'].map(target =>
      ({ id: 'synthetic-' + target, inputFamily: 'matroska', target, evidenceIds: ['synthetic-route'], allowAncillary: false, runtimeIdentity: RUNTIME })) }) });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target });
  return { service, input, output, a, b };
}
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
