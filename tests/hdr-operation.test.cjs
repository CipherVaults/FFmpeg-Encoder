'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { HdrOperations, fingerprintHdrProbe, getHdrOperationCollectionBinding } = require('../src/hdr-operation.cjs');
const { HDR_POLICIES } = require('../src/hdr-catalog.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
const { collectHdrEvidence } = require('../src/hdr-evidence.cjs');
const { closeOperationTelemetry, createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry } = require('../src/operation-telemetry.cjs');
const fs = require('node:fs/promises');
const { RUNTIME, BUDGET, SOURCE_FILE_SHA256, fixture, acquired, clone } = require('./hdr-owner-fixture.cjs');

test('an empty catalog and a standalone writer cannot enable either HDR cell', () => {
  const h = fixture({ empty: true, noPrepare: true });
  assert.throws(() => h.owner.prepare(h.prepare), e => e.code === 'HDR_QUALIFICATION_REQUIRED');
});
test('production catalog admits only the two reviewed full-byte generated seeds under the measured runtime', () => {
  assert.equal(HDR_POLICIES.length, 2); assert.ok(Object.isFrozen(HDR_POLICIES));
  assert.deepEqual(HDR_POLICIES.map(value => [value.transfer, value.sourceSha256]), [
    ['smpte2084', '15cc2f166e4f8a3f61ac741129ce5a5243b44351849c09f6a494fb7abcbba095'],
    ['arib-std-b67', 'f7e48e0fd2eee885d1167b544fd4f1aca5cc64f47a471801ce9c6fdc2ffa28b7'],
  ]);
  for (const cell of HDR_POLICIES) {
    assert.ok(Object.isFrozen(cell) && Object.isFrozen(cell.evidenceIds));
    assert.equal(cell.runtimeIdentity, '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6');
    assert.equal(cell.evidenceIds.length, 1); assert.match(cell.evidenceIds[0], /^slice4a-service:e7daea52-aa68-4395-a099-adf258fa769f:/);
  }
});
for (const transfer of ['smpte2084', 'arib-std-b67']) test(`the finite ${transfer} owner binds the canonical recipe and full HDR writer separately`, () => {
  const h = fixture({ transfer }), token = h.owner.select(h.bindings), selected = h.owner.requireCurrent(token, h.bindings);
  assert.equal(selected.hdr, true); assert.equal(selected.controlsRequired, true); assert.deepEqual(selected.budget, BUDGET);
  assert.equal(h.plan.compatibilityPath, false); assert.equal(h.plan.expectedOutput.hdr.signal.transfer, transfer);
  assert.equal(h.plan.expectedOutput.sourceFileSha256, SOURCE_FILE_SHA256);
  assert.equal(h.plan.expectedOutput.geometry.output.sampleAspectRatio, null); assert.equal(h.plan.expectedOutput.hdr.hdr10Claim, false);
  assert.equal(h.plan.args.includes('format=yuv420p10le'), true); assert.equal(h.plan.args.includes('tonemap'), false);
  assert.equal(h.plan.args[h.plan.args.indexOf('-enc_time_base:v:0') + 1], 'filter');
  assert.equal(h.plan.args[h.plan.args.indexOf('-dolbyvision:v:0') + 1], '0');
  const params = h.plan.args[h.plan.args.indexOf('-x265-params') + 1]; assert.match(params, /master-display=/); assert.match(params, /max-cll=1000,400/);
  assert.deepEqual(generationDescriptionOf(h.generationDescription), h.generationDescription);
  assert.equal(generationDescriptionOf({ ...h.generationDescription, encoderArgs: h.plan.args }), null, 'v1 canonical equality is unchanged');
  assert.equal(Object.isFrozen(h.plan.expectedOutput.hdr.metadata), true);
});

const rejectedSourceChanges = [
  p => { p.streams[0].sample_aspect_ratio = '1:1'; }, p => { p.streams[0].display_aspect_ratio = '16:9'; },
  p => { p.streams[0].tags.rotate = '0'; }, p => { p.streams[0].width = 640; }, p => { p.streams[0].profile = 'Main'; },
  p => { p.streams[0].pix_fmt = 'p010le'; }, p => { p.streams[0].color_transfer = 'bt709'; }, p => { p.streams[0].chroma_location = 'center'; },
  p => { p.streams[0].color_range = 'pc'; }, p => { p.streams[0].field_order = 'unknown'; }, p => { p.streams[0].time_base = '1/90000'; },
  p => { p.streams[0].avg_frame_rate = '24/1'; }, p => { p.streams[0].start_pts = 1; }, p => { p.format.duration = '4'; },
  p => { p.streams[0].disposition.default = 1; }, p => { p.streams.push({ index: 1, codec_type: 'audio', codec_name: 'aac' }); },
  p => { p.chapters = [{ id: 1, time_base: '1/1000', start: 0, end: 1000 }]; }, p => { delete p.programs; },
  p => { p.programs = [{ program_id: 1, streams: [] }]; }, p => { p.stream_groups = [{ index: 0 }]; },
  p => { p.streams[0].coded_height = 180; }, p => { p.streams[0].coded_width = 384; },
  p => { p.streams[0].side_data_list = [{ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 }]; },
];
for (const [i, changeProbe] of rejectedSourceChanges.entries()) test(`the frozen source envelope rejects unsupported signature ${i}`, () => {
  assert.throws(() => fixture({ changeProbe }));
});
for (const change of [
  p => { p.request.range = { startUs: 0, endUs: 1000000 }; }, p => { p.request.resolution = '720'; },
  p => { p.request.hdrPolicy = 'sdr'; }, p => { p.request.audioPolicy = 'precision-aac'; }, p => { p.request.omissionRequestIds = ['fake']; },
  p => { p.settings.quality = 24; }, p => { p.settings.profileId = 'h265-nvidia'; },
  p => { p.frameEvidence.frames[40].side_data_list[0].max_luminance = '2000/1'; },
  p => { p.frameEvidence.frames[40].side_data_list.push({ side_data_type: 'DOVI metadata' }); },
  p => { p.frameEvidence.coverage = 'full'; }, p => { p.sourceIdentity = { ...p.sourceIdentity, size: '1048577' }; },
  p => { p.frameEvidence.frames[20].pts = p.frameEvidence.frames[19].pts; },
]) test(`unsupported operation/settings/source metadata cannot fall back (${change.toString().slice(0, 70)})`, () => {
  assert.throws(() => fixture({ changePrepare: change }));
});

test('current selection binds all exact inputs and cloned/foreign/stale authority is refused', () => {
  const h = fixture(), token = h.owner.select(h.bindings), foreign = fixture();
  for (const options of [
    { ...h.bindings, plan: clone(h.plan) }, { ...h.bindings, runtimeIdentity: 'b'.repeat(64) },
    { ...h.bindings, settings: { ...h.settings, quality: 24 } }, { ...h.bindings, environment: {} },
    { ...h.bindings, sourceIdentity: { ...h.identity, mtimeNs: '2000' } },
    { ...h.bindings, sourceProbeFingerprint: 'b'.repeat(64) }, { ...h.bindings, budget: { ...BUDGET, maxRecords: 20001 } },
    { ...h.bindings, executionBudgetMs: 600001 },
  ]) assert.throws(() => h.owner.requireCurrent(token, options), e => e.code === 'HDR_OPERATION_STALE');
  assert.throws(() => h.owner.requireCurrent({}, h.bindings)); assert.throws(() => foreign.owner.requireCurrent(token, foreign.bindings));
  h.owner.invalidate(); assert.throws(() => h.owner.requireCurrent(token, h.bindings));
});

test('reprepare and cancellation revoke original plans and cannot recycle output UUIDs', () => {
  const h = fixture(), token = h.owner.select(h.bindings); h.owner.prepare({ ...h.prepare, outputId: randomUUID() });
  assert.throws(() => h.owner.requireCurrent(token, h.bindings)); h.owner.invalidate();
  assert.throws(() => h.owner.prepare(h.prepare), /UUIDs cannot be reused/);
});

test('a failed same-file changed-settings reprepare also revokes its prior selection and actual-stage authority', async t => {
  const h = await acquired(t), token = h.owner.select(h.bindings);
  try {
    assert.throws(() => h.owner.prepare({ ...h.prepare, settings: { ...h.settings, quality: 24 }, outputId: randomUUID() }));
    assert.throws(() => h.owner.requireCurrent(token, h.bindings));
    assert.throws(() => h.owner.resolveInvocation(h.plan, { output: h.output, telemetry: h.telemetry }));
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});

test('getters and forged fields are refused without invoking their accessors', () => {
  const h = fixture({ noPrepare: true }); let touched = 0;
  const source = clone(h.prepare.inspection.probe); Object.defineProperty(source.streams[0], 'width', { enumerable: true, get() { touched++; return 320; } });
  assert.throws(() => h.owner.prepare({ ...h.prepare, inspection: { probe: source } })); assert.equal(touched, 0);
  const policy = clone(h.policies[0]); Object.defineProperty(policy, 'runtimeIdentity', { enumerable: true, get() { touched++; return RUNTIME; } });
  assert.throws(() => new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'test', policies: [policy] })); assert.equal(touched, 0);
});

for (const transfer of ['smpte2084', 'arib-std-b67']) test(`genuine ${transfer} telemetry and complete collector validate only the exact protected stage`, async t => {
  const h = await acquired(t, { fixture: { transfer } });
  try {
    const evidence = await collectHdrEvidence(h.collectionOptions); assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure));
    const binding = getHdrOperationCollectionBinding(h.plan, { sourcePath: h.input, outputPath: h.output, sourceProbe: h.probe, outputProbe: h.outputProbe, runtimeIdentity: RUNTIME, outputId: h.outputId });
    assert.equal(binding.sourceEvidenceFingerprint, fingerprintHdrProbe(h.probe));
    assert.equal(h.owner.validate(h.plan, h.outputProbe, evidence).valid, false, 'Complete output cannot omit encoder-input telemetry');
    assert.equal(h.owner.validateTelemetry(h.plan, h.telemetryReceipt, evidence).valid, true);
    assert.equal(h.owner.validate(h.plan, h.outputProbe, evidence).valid, true);
    assert.throws(() => h.owner.validateTelemetry(h.plan, clone(h.telemetryReceipt), evidence));
    assert.equal(h.owner.validate(h.plan, h.outputProbe, clone(evidence)).valid, false);
    const wrongOutput = clone(h.outputProbe); wrongOutput.format.tags.FFMPEG_ENCODER_OUTPUT_ID = randomUUID();
    assert.equal(h.owner.validate(h.plan, wrongOutput, evidence).valid, false);
    h.owner.invalidate(); assert.equal(h.owner.validate(h.plan, h.outputProbe, evidence).valid, false);
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});

test('actual invocation requires the bound original telemetry handle and a separate temporary output', async t => {
  const h = await acquired(t);
  try {
    assert.throws(() => h.owner.resolveInvocation(h.plan, { output: h.output, telemetry: clone(h.telemetry) }));
    assert.throws(() => h.owner.resolveInvocation(h.plan, { output: h.prepare.output, telemetry: h.telemetry }));
    assert.throws(() => h.owner.resolveInvocation(h.plan, { output: h.output + '.other', telemetry: h.telemetry }));
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});

test('a different genuine statistics reservation for the same plan cannot replace its invocation receipt', async t => {
  const h = await acquired(t); let other;
  try {
    const evidence = await collectHdrEvidence(h.collectionOptions); assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure));
    other = await createOperationTelemetry({ stageDirectory: h.stageDirectory, runtimeIdentity: RUNTIME, planFingerprint: h.plan.planFingerprint, streams: h.plan.instrumentation.streams });
    await assertTelemetryReady(other); await fs.writeFile(other.streams[0].path, await fs.readFile(h.telemetry.streams[0].path));
    const receipt = await collectOperationTelemetry(other, { completion: { childClosed: true, exitCode: 0, cancelled: false } });
    assert.throws(() => h.owner.validateTelemetry(h.plan, receipt, evidence), /exact source\/plan\/runtime clock/);
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); if (other) await closeOperationTelemetry(other, { childClosed: true }); }
});

test('an interior encoder-input timestamp displacement fails despite matching output and record count', async t => {
  const h = await acquired(t, { telemetry: rows => { rows[30] = rows[30].replace(/\t1000\t1\/1000\t1000\n$/, '\t1001\t1/1000\t1000\n'); } });
  try { const evidence = await collectHdrEvidence(h.collectionOptions); assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure));
    assert.throws(() => h.owner.validateTelemetry(h.plan, h.telemetryReceipt, evidence));
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});

for (const variant of [
  { name: 'track title loss', source: p => { p.streams[0].tags.title = 'Primary image'; }, output: p => { delete p.streams[0].tags.title; }, error: /metadata 'title'/ },
  { name: 'unknown source interpretation change', source: p => { p.streams[0].tags.CUSTOM_INTERPRETATION = 'preserve exactly'; }, output: p => { p.streams[0].tags.CUSTOM_INTERPRETATION = 'changed'; }, error: /custom_interpretation/ },
  { name: 'unknown output-only track metadata', output: p => { p.streams[0].tags.NEW_FUNCTIONAL_HINT = 'unassessed'; }, error: /output-only metadata/ },
  { name: 'unknown output-only container metadata', output: p => { p.format.tags.NEW_FUNCTIONAL_HINT = 'unassessed'; }, error: /output-only metadata/ },
  { name: 'wrong actual generated UUID', output: p => { p.format.tags.FFMPEG_ENCODER_OUTPUT_ID = randomUUID(); }, error: /provenance/ },
  { name: 'contradictory actual recipe description', output: p => { const d = JSON.parse(p.format.tags.FFMPEG_ENCODER_GENERATION); d.quality = 24; p.format.tags.FFMPEG_ENCODER_GENERATION = JSON.stringify(d); }, error: /provenance/ },
  { name: 'changed enabled track disposition', output: p => { p.streams[0].disposition.default = 1; }, error: /disposition/ },
]) test(`strict operation validation rejects ${variant.name} despite genuine complete HDR acquisition`, async t => {
  const h = await acquired(t, { fixture: { changeProbe: variant.source } });
  try {
    variant.output(h.outputProbe);
    const evidence = await collectHdrEvidence(h.collectionOptions); assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure));
    assert.equal(h.owner.validateTelemetry(h.plan, h.telemetryReceipt, evidence).valid, true);
    const checked = h.owner.validate(h.plan, h.outputProbe, evidence); assert.equal(checked.valid, false); assert.match(checked.errors.join(' '), variant.error);
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});

test('preparing a different file preserves the existing genuine queued file snapshot', () => {
  const h = fixture(), token = h.owner.select(h.bindings);
  fixture({ owner: h.owner, fileId: 'different-file' });
  assert.equal(h.owner.requireCurrent(token, h.bindings).hdr, true);
});

for (const value of [undefined, null, '', 'not-a-hash', 'A'.repeat(64), 'c'.repeat(64)]) {
  test(`missing, malformed or unreviewed full source hash never prepares (${String(value).slice(0, 20)})`, () => {
    const h = fixture({ noPrepare: true });
    const changed = { ...h.prepare, sourceFileSha256: value }; if (value === undefined) delete changed.sourceFileSha256;
    assert.throws(() => h.owner.prepare(changed));
  });
}

test('missing full hash during a same-file reprepare revokes previous selection rather than borrowing its seed identity', () => {
  const h = fixture(), selection = h.owner.select(h.bindings), changed = { ...h.prepare, outputId: randomUUID() };
  delete changed.sourceFileSha256;
  assert.throws(() => h.owner.prepare(changed), /full source bytes/);
  assert.throws(() => h.owner.requireCurrent(selection, h.bindings));
});

test('source hash is inert required policy data and cannot be supplied by a getter or omitted', () => {
  const h = fixture({ noPrepare: true }); let touched = 0;
  for (const missing of [true, false]) {
    const policy = clone(h.policies[0]);
    if (missing) delete policy.sourceSha256;
    else Object.defineProperty(policy, 'sourceSha256', { enumerable: true, get() { touched++; return SOURCE_FILE_SHA256; } });
    assert.throws(() => new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'hash-negative', policies: [policy] }));
  }
  const forged = { ...h.prepare };
  Object.defineProperty(forged, 'sourceFileSha256', { enumerable: true, get() { touched++; return SOURCE_FILE_SHA256; } });
  assert.throws(() => h.owner.prepare(forged)); assert.equal(touched, 0);
});

test('mutating caller hash data or a copied plan cannot rewrite the genuine reviewed seed binding', async t => {
  const h = await acquired(t);
  try {
    h.prepare.sourceFileSha256 = 'c'.repeat(64); h.policies[0].sourceSha256 = 'c'.repeat(64);
    const binding = getHdrOperationCollectionBinding(h.plan, { sourcePath: h.input, outputPath: h.output, sourceProbe: h.probe,
      outputProbe: h.outputProbe, runtimeIdentity: RUNTIME, outputId: h.outputId });
    assert.equal(binding.sourceFileSha256, SOURCE_FILE_SHA256);
    const copied = clone(h.plan); copied.expectedOutput.sourceFileSha256 = 'c'.repeat(64);
    assert.throws(() => getHdrOperationCollectionBinding(copied, { sourcePath: h.input, outputPath: h.output, sourceProbe: h.probe,
      outputProbe: h.outputProbe, runtimeIdentity: RUNTIME, outputId: h.outputId }));
    const evidence = await collectHdrEvidence(h.collectionOptions); assert.equal(evidence.status, 'completed');
    assert.equal(evidence.hdrEvidence.expectedSourceFileSha256, SOURCE_FILE_SHA256);
    assert.equal(evidence.hdrEvidence.sourceFileSha256, SOURCE_FILE_SHA256);
  } finally { await closeOperationTelemetry(h.telemetry, { childClosed: true }); }
});
