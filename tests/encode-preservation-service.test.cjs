'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { EncodePreservationOperations, SOURCE_CLASS } = require('../src/encode-preservation.cjs');
const { classifyColor } = require('../src/media.cjs');
const { source: sourceProbe } = require('./fixtures/encode-preservation-source.cjs');
const RUNTIME = 'a'.repeat(64), SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const parent = path.resolve(__dirname, '../artifacts/v0.7/o-acceptance-2026-10-23/service-unit');

// All media facts/tools/runtime observations are injected. The production
// workspace, builder, validator, source checks, journal and publisher execute;
// these inert files do not qualify FFmpeg, physical media or a source class.
async function harness(t, { empty = false, count = 1, onEncode, fault, duration = 6, legacy = false } = {}) {
  await fs.mkdir(parent, { recursive: true }); const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'); await fs.mkdir(input); await fs.mkdir(output);
  for (let i = 0; i < count; i++) await fs.writeFile(path.join(input, `source-${i}${legacy ? '_H265-CPU' : ''}.mov`), 'Owned inert source ' + randomUUID());
  const probe = sourceProbe(); probe.format.duration = String(duration);
  const data = { inspections: 0, encodes: 0, helpers: [], observed: 0, runtimeChecks: 0, currentProbe: probe, fault };
  let service;
  const inspect = async () => { data.inspections++; const p = structuredClone(data.currentProbe);
    return { probe: p, color: classifyColor(p), duration, summary: { durationSeconds: duration }, evidence: {} }; };
  const ffmpeg = path.join(root, 'inert-ffmpeg'), ffprobe = path.join(root, 'inert-ffprobe');
  const invoke = async (_token, tool, args, options) => {
    data.helpers.push({ tool, args: [...args], timeoutMs: options.timeoutMs });
    if (tool === 'ffmpeg') {
      data.encodes++;
      if (onEncode) await onEncode({ service, args, options, data });
      if (options.signal?.aborted) throw Object.assign(new Error('Injected cancelled child has closed.'), { code: 'CANCELLED' });
      await fs.writeFile(args.at(-1), 'Owned inert encoded bytes', { flag: 'wx' });
      data.args = [...args]; return { exitCode: 0, stdout: '', stderr: '' };
    }
    assert.ok(args.includes('-show_programs') && args.includes('-show_stream_groups'));
    const p = structuredClone(probe); p.streams = p.streams.slice(0, 2); p.streams[0].codec_name = 'hevc'; p.stream_groups = [];
    Object.assign(p.format, { format_name: 'matroska,webm', nb_streams: 2, nb_stream_groups: 0, tags: {} });
    for (let index = 0; index < data.args.length; index++) if (data.args[index] === '-metadata') {
      const value = data.args[index + 1], split = value.indexOf('='); p.format.tags[value.slice(0, split)] = value.slice(split + 1);
    }
    if (data.fault === 'output-sar') p.streams[0].sample_aspect_ratio = '2:1';
    return { exitCode: 0, stdout: JSON.stringify(p), stderr: '' };
  };
  const owner = new EncodePreservationOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-service-only',
    policies: empty ? [] : [{ id: 'synthetic-full-tmcd', sourceClass: SOURCE_CLASS, runtimeIdentity: RUNTIME, evidenceIds: ['synthetic-only'] }] });
  service = new EncoderService({ ffmpeg, ffprobe, stateDir: path.join(root, 'state'), runtimeIdentity: RUNTIME, inspect,
    run: async () => { throw new Error('The selected route must invoke the observed fixed runtime.'); },
    verify: () => { throw new Error('The selected route must use its independent selected-map validator.'); },
    capabilities: async () => ({ profiles: [{ id: 'h265-cpu', available: true, supportedBitDepths: [8] }] }),
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false }) },
    encodePreservationOperations: owner, operationDeadlineMs: 1,
    operationQualifications: { select: () => { throw new Error('Full mapping consent is not a range qualification.'); } },
    operationStorage: () => { throw new Error('No complete decoded-evidence storage belongs to this Full route.'); }, operationTelemetry: true,
    operationRuntime: { observe: async () => { data.observed++; return Object.freeze({}); }, snapshot: () => ({ runtimeIdentity: RUNTIME, environment: null }),
      invoke, requireCurrent: async () => { data.runtimeChecks++; }, close: async () => {} } });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); if (!data.diagnosticsClosed) await service.closeDiagnostics(); });
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
  return { service, owner, data, input, output, a, b, root };
}
function decisionRequest(service, decisionIds) {
  const s = service.snapshot(); return { planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision,
    decisionIds: decisionIds ?? s.items.flatMap(item => item.encodePreservation.omissionCandidates.map(value => value.id)) };
}
async function admit(service) { await service.setEncodePreservationDecisions(decisionRequest(service)); return service.snapshot(); }

test('the named functional loss is refused until an exact-set decision; empty runtime catalog stays refused', async t => {
  const { service, data } = await harness(t, { empty: true }); const s = service.snapshot(), item = s.items[0];
  assert.equal(item.status, 'unsupported'); assert.equal(item.reasonCode, 'ENCODE_PRESERVATION_DECISION_REQUIRED');
  assert.match(item.encodePreservation.omissionCandidates[0].reasons[0], /editing\/synchronization.*original is preserved/i);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [item.id] }), { code: 'INVALID_SELECTION' });
  await admit(service);
  assert.equal(service.snapshot().items[0].reasonCode, 'ENCODE_PRESERVATION_QUALIFICATION_REQUIRED');
  assert.equal(data.encodes, 0); assert.equal(data.observed, 0);
});

test('Full selected workflow uses observed tools and durable warnings without a range deadline, telemetry or full collector', async t => {
  const { service, data, output } = await harness(t, { duration: 3355.285333,
    onEncode: async () => { await new Promise(resolve => setTimeout(resolve, 20)); } });
  const s = await admit(service), item = s.items[0]; assert.equal(item.status, 'ready', item.reason);
  const detail = service.getEncodingDetails({ planId: s.planId, fileId: item.id });
  assert.equal(detail.operation.validationMode, 'full-preservation-selection'); assert.equal(detail.operation.compatibilityPath, false);
  assert.equal(detail.operation.instrumentation, null); assert.match(item.warnings[0].message, /not equivalent/);
  service.startBatch({ planId: s.planId, fileIds: [item.id] }); await service.taskPromise;
  const result = service.snapshot().items[0]; assert.equal(result.status, 'success', result.reason);
  assert.equal(result.outcome, 'saved-with-warning'); assert.match(result.reason, /timed timecode/);
  assert.equal(data.encodes, 1); assert.deepEqual(data.helpers.map(value => value.tool), ['ffmpeg', 'ffprobe']);
  assert.equal(data.helpers[0].timeoutMs, 0); assert.ok(data.runtimeChecks > 0);
  assert.equal((await fs.readdir(output)).filter(name => name.endsWith('.mkv')).length, 1);
  assert.equal(service.plan.encodePreservationGrants.size, 0);
  const { DiagnosticJournal } = require('../src/diagnostics.cjs');
  await service.closeDiagnostics();
  data.diagnosticsClosed = true;
  const journal = new DiagnosticJournal({ directory: service.stateDir });
  t.after(() => journal.flush());
  const history = await journal.list({ limit: 100 });
  const invocation = history.events.find(event => event.reason === 'ENCODE_STARTED'); assert.ok(invocation);
  const invoked = (await journal.read(invocation.id)).event; assert.ok(invoked);
  assert.equal(invoked.context.operation.resolved.preservation.warning.code, 'TIMED_TIMECODE_TRACK_OMITTED');
  const checked = history.events.find(event => event.reason === 'OUTPUT_CHECKED'); assert.ok(checked);
  assert.ok((await journal.read(checked.id)).event.context.validation.warnings.some(warning => warning.code === 'TIMED_TIMECODE_TRACK_OMITTED'));
});

test('exact sets preserve other chosen files, while ordinary edits, encoder changes and Ready cancellation revoke consent', async t => {
  const { service } = await harness(t, { count: 2 }); let s = service.snapshot();
  const ids = s.items.map(item => item.encodePreservation.omissionCandidates[0].id);
  await service.setEncodePreservationDecisions(decisionRequest(service, [ids[0]])); s = service.snapshot();
  assert.equal(s.items[0].status, 'ready'); assert.equal(s.items[1].status, 'unsupported');
  await service.setEncodePreservationDecisions(decisionRequest(service)); s = service.snapshot();
  assert.ok(s.items.every(item => item.status === 'ready'));
  await service.updateBatchOperationDefaults({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, overrides: { hdrPolicy: 'sdr' } });
  s = service.snapshot(); assert.ok(s.items.every(item => item.encodePreservation.omissionDecisionIds.length === 0 && item.status === 'unsupported'));
  s = await admit(service); service.invalidatePreparedEncoding();
  assert.equal(service.plan.entries.size, 0); assert.equal(service.plan.encodePreservationGrants.size, 0);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }));
  await service.reprepareEncodingSettings({ planId: service.snapshot().planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, settings: SETTINGS });
  s = await admit(service); await service.cancelCurrent();
  assert.equal(service.plan, null); assert.equal(service.snapshot().phase, 'cancelled');
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'STALE_PLAN' });
});

test('foreign, duplicate, stale and extra-field IPC decisions cannot create authority', async t => {
  const { service } = await harness(t), request = decisionRequest(service), id = request.decisionIds[0];
  for (const decisionIds of [[randomUUID()], [id, id], [{ id }]]) {
    assert.throws(() => service.setEncodePreservationDecisions({ ...request, decisionIds }), { code: 'ENCODE_PRESERVATION_STALE' });
  }
  assert.throws(() => service.setEncodePreservationDecisions({ ...request, streamIndex: 2 }), { code: 'INVALID_REQUEST' });
  await admit(service);
  assert.throws(() => service.setEncodePreservationDecisions(request), { code: 'STALE_PLAN' });
});

test('changed current metadata refuses before encode; invalid output geometry is retained without publication', async t => {
  const a = await harness(t), s = await admit(a.service);
  a.data.currentProbe = structuredClone(a.data.currentProbe); a.data.currentProbe.streams[2].tags.timecode = '03:00:00:00';
  a.service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }); await a.service.taskPromise;
  assert.equal(a.data.encodes, 0); assert.equal(a.service.snapshot().items[0].reasonCode, 'ENCODE_PRESERVATION_STALE');
  const b = await harness(t, { fault: 'output-sar' }), ready = await admit(b.service);
  b.service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }); await b.service.taskPromise;
  assert.equal(b.service.snapshot().items[0].reasonCode, 'INVALID_OUTPUT');
  assert.equal(b.service.snapshot().items[0].outputDisposition.published, false);
  assert.equal((await fs.readdir(b.output)).filter(name => name.endsWith('.mkv')).length, 0);
});

test('missing durable consent receipt and actual cancellation publish nothing and revoke prepared consent', async t => {
  const a = await harness(t), ready = await admit(a.service), original = a.service.recordIncident.bind(a.service);
  a.service.recordIncident = async event => event.reason === 'ENCODE_STARTED' ? { persisted: false } : original(event);
  a.service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }); await a.service.taskPromise;
  assert.equal(a.data.encodes, 0); assert.equal(a.service.snapshot().items[0].reasonCode, 'OPERATION_DIAGNOSTICS_INCOMPLETE');
  let started; const entered = new Promise(resolve => { started = resolve; });
  const b = await harness(t, { onEncode: async ({ options }) => { started();
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); } });
  const s = await admit(b.service); b.service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }); await entered;
  await b.service.cancelCurrent(); assert.equal(b.service.snapshot().items[0].status, 'cancelled');
  assert.equal(b.service.plan.encodePreservationGrants.size, 0);
  assert.equal((await fs.readdir(b.output)).filter(name => name.endsWith('.mkv')).length, 0);
});

test('legacy original admission composes with explicit loss, while ordinary reprepare revokes both decisions', async t => {
  const { service } = await harness(t, { legacy: true }); let s = service.snapshot();
  assert.equal(s.items[0].status, 'ambiguous');
  await service.treatAsOriginal({ planId: s.planId, fileId: s.items[0].id }); s = service.snapshot();
  assert.equal(s.items[0].reasonCode, 'ENCODE_PRESERVATION_DECISION_REQUIRED');
  s = await admit(service); assert.equal(s.items[0].status, 'ready', s.items[0].reason);
  await service.updateBatchOperationDefaults({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, overrides: { hdrPolicy: 'sdr' } });
  assert.equal(service.snapshot().items[0].status, 'ambiguous'); assert.equal(service.plan.overrides.size, 0);
});

test('changed source refuses decision installation and a new service restores no prepared loss authority', async t => {
  const a = await harness(t), request = decisionRequest(a.service), item = a.service.snapshot().items[0];
  await fs.appendFile(path.join(a.input, item.name), 'changed');
  await a.service.setEncodePreservationDecisions(request);
  assert.equal(a.service.snapshot().phase, 'failed'); assert.equal(a.service.plan, null);
  const b = await harness(t), ready = await admit(b.service);
  const restarted = new EncoderService({ ffmpeg: b.service.ffmpeg, ffprobe: b.service.ffprobe, stateDir: b.service.stateDir });
  t.after(() => restarted.closeDiagnostics());
  assert.equal(restarted.snapshot().phase, 'idle'); assert.equal(restarted.plan, null);
  assert.throws(() => restarted.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }), { code: 'STALE_PLAN' });
});
