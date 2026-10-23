'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { HdrOperations, getHdrOperationCollectionBinding } = require('../src/hdr-operation.cjs');
const { prepareHdrItem } = require('../src/hdr-workspace.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { PROFILES } = require('../src/media.cjs');
const { inspectHdrContainer } = require('../src/hdr-container.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { contentFixture, RUNTIME, SETTINGS, BUDGET, clone, sha } = require('./hdr-content-fixture.cjs');

for (const spec of [{ width: 1280, height: 720, count: 900, rate: 30 }, { width: 1920, height: 1080, count: 400, rate: 24 }, { width: 320, height: 180, count: 1800, rate: 30 }])
  test(`real parser/observer receipt reaches owner at ${spec.width}x${spec.height}/${spec.count} complete frames`, async t => {
    const h = await contentFixture(t, spec), receipt = await h.observe(), complete = h.get(receipt), plan = h.owner.prepare(h.prepared());
    assert.equal(complete.frameCount, spec.count); assert.equal(h.calls.length, 2); assert.equal(h.live(), 0);
    assert.equal(plan.expectedOutput.frameCount, spec.count); assert.equal(plan.expectedOutput.inputContentFingerprint, complete.compressedFingerprint);
    assert.equal(plan.expectedOutput.inputTimelineHash, complete.timelineHash); assert.equal(plan.expectedOutput.sourceFileSha256, sha(h.bytes));
    const bindings = h.selectBindings(plan), selection = h.owner.select(bindings); assert.equal(h.owner.requireCurrent(selection, bindings).hdr, true);
    h.owner.invalidate(); assert.throws(() => h.owner.requireCurrent(selection, bindings), { code: 'HDR_OPERATION_STALE' });
  });

for (const declaredDurationTicks of ['16666', '16667']) test(`24fps ${declaredDurationTicks} raw header reaches Ready with a separately frozen native end16666`, async t => {
  const h = await contentFixture(t, { width: 1920, height: 1080, count: 400, rate: 24, declaredDurationTicks });
  const item = { id: h.request.fileId, operationRequest: h.request }; await prepareHdrItem.call(h.context, item, h.workspaceOptions);
  const entry = h.context.plan.entries.get(item.id), output = entry.operationPlan.expectedOutput;
  assert.equal(item.status, 'ready'); assert.equal(output.frameCount, 400); assert.equal(output.sourceContainerTiming.declaredDurationTicks, declaredDurationTicks);
  assert.equal(output.sourceContainerTiming.nativeEndTicks, '16666'); assert.equal(output.sourceContainerTiming.defaultDurationNs, '41666666');
  assert.equal(output.sourceContainerTiming.sourceOutputToleranceTicks, '0'); assert.equal(output.sourceFileSha256, sha(h.bytes));
  const bsf = entry.operationPlan.args[entry.operationPlan.args.indexOf('-bsf:v:0')+1];
  assert.equal(bsf,`setts=pts=PTS:dts=DTS:duration=DURATION+not(PTS-16625)*(${declaredDurationTicks==='16667'?42:41}-DURATION):time_base=1/1000:prescale=1`,
    'The final-packet header writer must preserve distinct PTS/DTS explicitly and select the exact frozen low/high state.');
  assert.equal(output.containerDurationWriter,bsf);
  assert.equal(h.calls.length, 2); assert.equal(h.owner.requireCurrent(entry.qualificationSelection, entry.qualificationBindings).hdr, true);
});

for (const [name, changes, code, children] of [
  ['header below the exact low end', { declaredDurationTicks: '16665' }, 'HDR_INPUT_DURATION', 2],
  ['header above the exact high end', { declaredDurationTicks: '16668' }, 'HDR_INPUT_DURATION', 2],
  ['raw/report header contradiction', { declaredDurationTicks: '16666', rawDeclaredDurationTicks: '16667' }, 'HDR_INPUT_DURATION', 2],
  ['one-nanosecond DefaultDuration change', { container: { defaultDurationNs: '41666667' } }, 'HDR_CONTAINER_TIMING', 0],
  ['one-nanosecond TimestampScale change', { container: { timestampScaleNs: '1000001' } }, 'HDR_CONTAINER_TIMING', 0],
  ['explicit disabled video track', { container: { trackEnabled: '0' } }, 'HDR_CONTAINER_TRACK_DISABLED', 0],
  ['nonintegral raw Segment duration', { containerBytes(bytes) {
    const { offset, bytes: width } = inspectHdrContainer(bytes, { frameRate: '24/1' }).origins.declaredDurationTicks;
    assert.equal(width, 8); bytes.writeDoubleBE(16666.5, offset); return bytes;
  } }, 'HDR_CONTAINER_TIMING', 0],
]) test(`${name} cannot make a content item Ready`, async t => {
  const h = await contentFixture(t, { width: 1920, height: 1080, count: 400, rate: 24, ...changes }), item = { id: h.request.fileId, operationRequest: h.request };
  await assert.rejects(prepareHdrItem.call(h.context, item, h.workspaceOptions), { code });
  assert.notEqual(item.status, 'ready'); assert.equal(item.hdr, undefined); assert.equal(h.context.plan.entries.size, 0);
  assert.equal(h.calls.length, children); assert.equal(h.live(), 0);
});

test('neighboring valid header replacement cannot reuse its receipt, selection or old workspace identity', async t => {
  const h = await contentFixture(t, { width: 1920, height: 1080, count: 400, rate: 24 }); await h.observe();
  const plan = h.owner.prepare(h.prepared()), binding = h.selectBindings(plan), token = h.owner.select(binding), replacement = Buffer.from(h.bytes);
  const { offset } = inspectHdrContainer(replacement, { frameRate: '24/1' }).origins.declaredDurationTicks;
  replacement.writeDoubleBE(16667, offset); await fs.writeFile(h.sourcePath, replacement);
  const changedIdentity = await readSourceIdentity(h.sourcePath), inspection = clone(h.inspection);
  inspection.probe.format.duration = '16.667000'; inspection.duration = inspection.summary.durationSeconds = 16.667;
  assert.equal(inspectHdrContainer(replacement, { frameRate: '24/1' }).declaredDurationTicks, '16667');
  assert.notEqual(sha(replacement), sha(h.bytes)); assert.equal(replacement.length, h.bytes.length);
  assert.throws(() => h.owner.prepare(h.prepared({ sourceIdentity: changedIdentity, sourceFileSha256: sha(replacement), inspection })), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  assert.throws(() => h.owner.requireCurrent(token, binding), { code: 'HDR_OPERATION_STALE' });
  assert.equal(plan.expectedOutput.sourceContainerTiming.declaredDurationTicks, '16666');
  const item = { id: h.request.fileId, operationRequest: h.request };
  await assert.rejects(prepareHdrItem.call(h.context, item, h.workspaceOptions), { code: 'INPUT_CHANGED' });
  assert.equal(h.calls.length, 2); assert.notEqual(item.status, 'ready'); assert.equal(h.context.plan.entries.size, 0); assert.equal(h.live(), 0);
});

for (const transfer of ['smpte2084', 'arib-std-b67']) for (const metadata of ['none', 'master', 'light', 'both'])
  test(`${transfer} ${metadata} metadata uses exact complete observed values and absence across writer chunks`, async t => {
    const h = await contentFixture(t, { count: 300, transfer, metadata }); await h.observe(); const plan = h.owner.prepare(h.prepared());
    const values = plan.expectedOutput.hdr.metadata;
    assert.equal(values.mastering !== null, ['master', 'both'].includes(metadata));
    assert.equal(values.contentLight !== null, ['light', 'both'].includes(metadata)); assert.equal(values.ambient, null);
    if (values.mastering) assert.equal(Number(values.mastering.max_luminance.numerator) / Number(values.mastering.max_luminance.denominator), 4000);
    if (values.contentLight) assert.equal(values.contentLight.max_content.value, 2000);
    const params = plan.args[plan.args.indexOf('-x265-params') + 1];
    assert.equal(params.includes('master-display='), values.mastering !== null); assert.ok(params.includes('cll=' + (values.contentLight ? '1' : '0')));
    if (values.contentLight) assert.ok(params.includes('max-cll=2000,500'));
    assert.equal(plan.expectedOutput.hdr.signal.transfer, transfer); assert.equal(h.live(), 0);
  });

for (const metadata of ['light', 'both'])
  test(`genuine complete ${metadata} receipt with explicit unspecified0/0CLL cannot qualify the unproven writer`, async t => {
    const h = await contentFixture(t, { metadata, lightLevels: [0, 0], count: 300 }); const receipt = await h.observe(), complete = h.get(receipt);
    assert.deepEqual(complete.configurationMetadata.metadata.contentLight, { max_content: 0, max_average: 0 });
    assert.equal(complete.configurationMetadata.metadata.mastering !== null, metadata === 'both');
    assert.throws(() => h.owner.prepare(h.prepared()), { code: 'HDR_ZERO_CLL_WRITER_UNQUALIFIED' });
    assert.equal(h.calls.length, 2); assert.equal(h.live(), 0);
  });

test('arbitrary source hashes sharing a reviewed configuration are bound individually without hash membership', async t => {
  const first = await contentFixture(t, { content: 17 }), second = await contentFixture(t, { content: 91 });
  await first.observe(); await second.observe();
  assert.notEqual(sha(first.bytes), sha(second.bytes)); assert.equal(ownHashMembership(first.policy), false);
  const firstPlan = first.owner.prepare(first.prepared()), secondPlan = first.owner.prepare(second.prepared({ request: { ...second.request, fileId: 'different-source-id' } }));
  assert.equal(firstPlan.expectedOutput.configuration.id, secondPlan.expectedOutput.configuration.id);
  assert.notEqual(firstPlan.expectedOutput.sourceFileSha256, secondPlan.expectedOutput.sourceFileSha256);
  assert.notEqual(firstPlan.expectedOutput.inputContentFingerprint, secondPlan.expectedOutput.inputContentFingerprint);
});
function ownHashMembership(value) { return Object.hasOwn(value, 'sourceSha256'); }

test('missing/copied/foreign receipt cannot create owner authority and a failed reprepare revokes the old selection', async t => {
  const h = await contentFixture(t), receipt = await h.observe(), plan = h.owner.prepare(h.prepared()), bindings = h.selectBindings(plan), selection = h.owner.select(bindings);
  assert.throws(() => h.owner.prepare(h.prepared({ inputReceipt: undefined })), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  assert.throws(() => h.owner.requireCurrent(selection, bindings), { code: 'HDR_OPERATION_STALE' });
  assert.throws(() => h.owner.prepare(h.prepared({ inputReceipt: clone(receipt) })), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  const other = await contentFixture(t); const otherReceipt = await other.observe();
  assert.throws(() => h.owner.prepare(h.prepared({ inputReceipt: otherReceipt })), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  assert.equal(h.live(), 0); assert.equal(other.live(), 0);
});

test('wrong path/runtime/configuration/probe/source identity bindings cannot reuse a genuine receipt', async t => {
  const h = await contentFixture(t); await h.observe();
  const changedProbe = clone(h.inspection); changedProbe.probe.format.tags.title = 'changed binding';
  const changedIdentity = { ...h.identity, mtimeNs: String(BigInt(h.identity.mtimeNs) + 1n) };
  for (const overrides of [{ inspection: changedProbe }, { sourceIdentity: changedIdentity },
    { input: path.join(h.inputDirectory, 'other.mkv'), sourceIdentity: { ...h.identity, canonicalPath: path.join(h.inputDirectory, 'other.mkv') } }])
    assert.throws(() => h.owner.prepare(h.prepared(overrides)), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  const otherRuntime = new HdrOperations({ runtimeIdentity: 'b'.repeat(64), policyIdentity: 'foreign-runtime', policies: [{ ...h.policy, runtimeIdentity: 'b'.repeat(64) }] });
  assert.throws(() => otherRuntime.prepare(h.prepared()), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  const changedProfiles = [{ ...h.profile, id: 'different-reviewed-configuration' }];
  const otherProfiles = new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'foreign-profiles', policies: [{ ...h.policy, profiles: changedProfiles }] });
  assert.throws(() => otherProfiles.prepare(h.prepared()), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
});

test('source SHA mismatch, unqualified settings and options fail after revoking older authority', async t => {
  const h = await contentFixture(t); await h.observe();
  for (const overrides of [{ sourceFileSha256: 'f'.repeat(64) }, { sourceFileSha256: undefined }, { settings: { ...SETTINGS, quality: 24 } },
    { request: { ...h.request, range: { start: 0, end: 1 } } }, { request: { ...h.request, audioPolicy: 'precision-flac' } },
    { request: { ...h.request, resolution: '1080p' } }]) {
    const plan = h.owner.prepare(h.prepared()), bindings = h.selectBindings(plan), selection = h.owner.select(bindings);
    assert.throws(() => h.owner.prepare(h.prepared(overrides)));
    assert.throws(() => h.owner.requireCurrent(selection, bindings), { code: 'HDR_OPERATION_STALE' });
  }
});

test('selection is immutable-plan/owner/settings/source/probe/runtime/budget bound', async t => {
  const h = await contentFixture(t); await h.observe(); const plan = h.owner.prepare(h.prepared()), bindings = h.selectBindings(plan), selection = h.owner.select(bindings);
  for (const overrides of [{ plan: clone(plan) }, { settings: { ...SETTINGS, preset: 'medium' } }, { runtimeIdentity: 'b'.repeat(64) },
    { sourceProbeFingerprint: 'c'.repeat(64) }, { sourceIdentity: { ...h.identity, sparseDigest: 'sha256-sparse-v1:' + 'f'.repeat(64) } },
    { budget: { ...BUDGET, maxFrameBytes: BUDGET.maxFrameBytes + 1 } }, { executionBudgetMs: 600001 }, { environment: {} }])
    assert.throws(() => h.owner.requireCurrent(selection, { ...bindings, ...overrides }), { code: 'HDR_OPERATION_STALE' });
  assert.throws(() => h.owner.requireCurrent({}, bindings), { code: 'HDR_OPERATION_STALE' });
  const other = new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'different-owner', policies: [h.policy] });
  assert.throws(() => other.requireCurrent(selection, bindings), { code: 'HDR_OPERATION_STALE' });
  assert.equal(h.owner.requireCurrent(selection, bindings).hdr, true);
});

for (const index of [0, 255, 256, 511, 512, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536, 1799])
  test(`unknown or conflicting source facts at frame ${index} cannot acquire a receipt or prepared plan`, async t => {
    let stimulus = false;
    const h = await contentFixture(t, { width: 320, height: 180, count: 1800, metadata: 'both', capture(payload, call) { if (call.kind === 'frames') { payload.frames[index].side_data_list[0].max_luminance = '3999/1'; stimulus = true; } } });
    await assert.rejects(h.observe(), error => error.code === 'HDR_INPUT_INVALID' && /Decoded mastering values differ/.test(error.message));
    assert.equal(stimulus, true); assert.equal(h.calls.length, 2); assert.equal(h.live(), 0);
    assert.throws(() => h.owner.prepare(h.prepared()), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  });

test('unknown late side data, compressed-vs-decoded count mismatch and source mutation refuse before owner preparation', async t => {
  for (const kind of ['unknown', 'count', 'mutated']) {
    let stimulus = false;
    const h = await contentFixture(t, { count: 300, capture(payload, call) {
      if (call.kind !== 'frames') return;
      if (kind === 'unknown') { payload.frames.at(-1).side_data_list.push({ side_data_type: 'Unknown late functional payload' }); stimulus = true; }
      if (kind === 'count') { payload.frames.pop(); stimulus = true; }
    }, async during(call, { sourcePath }) { if (kind === 'mutated' && call.kind === 'packets') { await fs.appendFile(sourcePath, 'changed-owned-source'); stimulus = true; } } });
    await assert.rejects(h.observe(), { code: { unknown: 'HDR_INPUT_FUNCTIONAL_DATA', count: 'HDR_INPUT_COUNT', mutated: 'INPUT_CHANGED' }[kind] });
    assert.equal(stimulus, true); assert.equal(h.calls.length, kind === 'mutated' ? 1 : 2); assert.equal(h.live(), 0);
  }
});

test('compressed picture count refuses excessive pixel work before starting full source decode', async t => {
  const h = await contentFixture(t, { width: 1920, height: 1080, count: 401 });
  await assert.rejects(h.observe(), { code: 'HDR_INPUT_LIMIT' });
  assert.equal(h.calls.length, 1, 'Over-budget compressed membership must refuse before the frame decode child.');
  assert.equal(h.calls[0].kind, 'packets'); assert.equal(h.live(), 0);
});

test('a fabricated small frame contribution cannot replace or enlarge the genuine complete receipt', async t => {
  const h = await contentFixture(t); await h.observe();
  const plan = h.owner.prepare(h.prepared({ frameEvidence: { videoIndex: 99, coverage: 'full', decodedFrameCount: 9999, decodeExitCode: 0, frames: [{ color_transfer: 'arib-std-b67' }] } }));
  assert.equal(plan.expectedOutput.frameCount, 12); assert.equal(plan.expectedOutput.hdr.signal.transfer, 'smpte2084');
  assert.equal(plan.expectedOutput.sourceFileSha256, sha(h.bytes));
});

test('reused output IDs and source/destination aliasing cannot retain prior authority', async t => {
  const h = await contentFixture(t); await h.observe();
  const prepared = h.prepared(), plan = h.owner.prepare(prepared), binding = h.selectBindings(plan), token = h.owner.select(binding);
  assert.throws(() => h.owner.prepare({ ...prepared }), /cannot be reused/);
  assert.throws(() => h.owner.requireCurrent(token, binding), { code: 'HDR_OPERATION_STALE' });
  assert.throws(() => h.owner.prepare(h.prepared({ output: h.sourcePath })), /distinct destination/);
});

test('content collection binding exposes the genuine complete input, correct profiles and explicit eligibility mode', async t => {
  const h = await contentFixture(t); await h.observe(); const plan = h.owner.prepare(h.prepared()); h.owner.select(h.selectBindings(plan));
  const stageDirectory = path.join(h.directory, 'telemetry'); await fs.mkdir(stageDirectory);
  const telemetry = await createOperationTelemetry({ stageDirectory, runtimeIdentity: RUNTIME, planFingerprint: plan.planFingerprint, streams: plan.instrumentation.streams });
  const output = path.join(h.outputDirectory, 'stage.mkv'); h.owner.resolveInvocation(plan, { output, telemetry });
  const binding = getHdrOperationCollectionBinding(plan, { sourcePath: h.sourcePath, outputPath: output, sourceProbe: h.probe, outputProbe: h.probe, runtimeIdentity: RUNTIME, outputId: plan.expectedOutput.outputId });
  assert.equal(binding.eligibilityMode, 'content'); assert.equal(binding.inputObservation.sourceFileSha256, sha(h.bytes));
  assert.deepEqual(binding.sourceProfiles, h.profiles); assert.deepEqual(binding.outputProfiles, h.profiles); assert.equal(binding.inputObservation.complete, true);
  h.owner.invalidate(); assert.throws(() => getHdrOperationCollectionBinding(plan, { sourcePath: h.sourcePath, outputPath: output, sourceProbe: h.probe, outputProbe: h.probe, runtimeIdentity: RUNTIME, outputId: plan.expectedOutput.outputId }), { code: 'HDR_OPERATION_PLAN_REQUIRED' });
});

test('workspace uses the real observer and owner before Ready, with no sampled-inspection shortcut', async t => {
  const h = await contentFixture(t, { count: 300, metadata: 'both' }), item = { id: h.request.fileId, operationRequest: h.request };
  await prepareHdrItem.call(h.context, item, h.workspaceOptions);
  const entry = h.context.plan.entries.get(item.id); assert.equal(item.status, 'ready'); assert.equal(item.hdr.scope, 'content-cpu-hdr-preserve-v1');
  assert.equal(entry.operationPlan.expectedOutput.frameCount, 300); assert.equal(entry.operationPlan.expectedOutput.sourceFileSha256, sha(h.bytes));
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => !call.args.includes('-read_intervals')));
  assert.equal(h.owner.requireCurrent(entry.qualificationSelection, entry.qualificationBindings).hdr, true);
});

test('workspace refuses a stale source identity before allocating any new observation child', async t => {
  const h = await contentFixture(t); await h.observe(); const before = h.calls.length;
  await fs.appendFile(h.sourcePath, 'owned-current-source-change');
  const item = { id: h.request.fileId, operationRequest: h.request };
  await assert.rejects(prepareHdrItem.call(h.context, item, h.workspaceOptions), { code: 'INPUT_CHANGED' });
  assert.equal(h.calls.length, before); assert.equal(h.context.plan.entries.size, 0); assert.equal(item.status, undefined);
});

test('actual service failed early draft reprepare revokes the content selection and clears its notice', async t => {
  const h = await contentFixture(t, { count: 300 });
  const service = new EncoderService({ ffmpeg: path.join(h.directory, 'fixed-ffmpeg.exe'), ffprobe: h.options.ffprobe, stateDir: path.join(h.directory, 'state'),
    runtimeIdentity: RUNTIME, run: h.options.run, inspectionWorkers: 1, inspectionCache: null, hdrOperations: h.owner,
    operationEvidenceBudget: BUDGET, operationDeadlineMs: 600000, operationTelemetry: true, operationRuntime: { ...h.context.operationRuntime, async close() {} },
    operationStorage: async () => { throw Error('Preparation must not allocate a publication stage.'); }, storageEligibility: { async check() { return { eligible: true, reason: 'Synthetic local test only' }; } },
    capabilities: async () => ({ profiles: PROFILES.map(value => ({ ...value, available: true, supportedBitDepths: [8, 10] })), versions: { ffmpeg: 'mocked pinned runtime' } }),
    inspect: async () => clone(h.inspection) });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const input = await service.registerFolder(h.inputDirectory, 'input'), output = await service.registerFolder(h.outputDirectory, 'output');
  await service.prepareBatch({ inputFolderId: input.id, outputFolderId: output.id, settings: SETTINGS }); await service.taskPromise;
  const ready = service.snapshot(); assert.equal(ready.items[0].status, 'ready', ready.items[0].reason); const entry = service.plan.entries.get(ready.items[0].id);
  const before = h.calls.length;
  const next = await service.updateFileOperations({ planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision,
    fileIds: [ready.items[0].id], overrides: { audioPolicy: 'precision-flac' } });
  assert.equal(next.items[0].reasonCode, 'HDR_QUALIFICATION_REQUIRED'); assert.equal(next.items[0].hdr, undefined); assert.equal(h.calls.length, before);
  assert.throws(() => h.owner.requireCurrent(entry.qualificationSelection, entry.qualificationBindings), { code: 'HDR_OPERATION_STALE' });
  assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }), { code: 'STALE_PLAN' });
});
