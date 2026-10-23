'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HdrOperations } = require('../src/hdr-operation.cjs');
const { HDR_TRANSFORM_VERSION } = require('../src/hdr-contract.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { prepareHdrItem, describeHdrSdrTransform } = require('../src/hdr-workspace.cjs');
const { contentFixture, RUNTIME, clone } = require('./hdr-content-fixture.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');

async function sdrFixture(t, changes = {}) {
  const transfer = changes.transfer ?? 'smpte2084', rate = transfer === 'smpte2084' ? 30 : 25;
  const h = await contentFixture(t, { transfer, rate, metadata: 'both', lightLevels: [4000, 500], ...changes });
  // Structural unit templates only; no claim that these synthetic PS carry VUI.
  const output = { ...clone(h.profile), id: 'synthetic-sdr-output', transfer: 'bt709',
    outputMode: 'sdr-bt709-main10', primaries: 'bt709', matrix: 'bt709' };
  const policy = { ...h.policy, id: 'synthetic-sdr-' + transfer, hdrPolicy: 'sdr',
    transformVersion: HDR_TRANSFORM_VERSION, outputProfiles: [output] };
  const owner = new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-sdr-owner', policies: [h.policy,policy] });
  const request = resolveFileRequest({ fileId: h.request.fileId, identityRevision: 1, draftRevision: 1,
    operation: 'encode', overrides: { hdrPolicy: 'sdr' } });
  h.context.hdrOperations = owner;
  return { ...h, owner, request, sdrPolicy: policy };
}

for (const transfer of ['smpte2084','arib-std-b67']) test(`genuine complete ${transfer} source selects a separate explicit SDR cell`, async t => {
  const h = await sdrFixture(t,{transfer}); await h.observe();
  const plan = h.owner.prepare(h.prepared({request:h.request}));
  const bindings = h.selectBindings(plan), token = h.owner.select(bindings), selected = h.owner.requireCurrent(token,bindings);
  assert.equal(selected.hdrPolicy,'sdr'); assert.equal(plan.expectedOutput.hdr.signal.transfer,'bt709');
  assert.equal(plan.expectedOutput.hdrContract.executable,false);
  assert.equal(plan.expectedOutput.hdrTransform.version,HDR_TRANSFORM_VERSION);
  assert.match(plan.expectedOutput.hdrTransform.filterGraphSha256,/^[a-f0-9]{64}$/);
  assert.notEqual(plan.expectedOutput.hdrTransform.sourceProfilesSha256,plan.expectedOutput.hdrTransform.outputProfilesSha256);
  assert.deepEqual(plan.expectedOutput.hdr.metadata,{mastering:null,contentLight:null,ambient:null});
  const graph=plan.args[plan.args.indexOf('-filter:v:0')+1];
  assert.match(graph,/format=gbrpf32le/); assert.match(graph,/tonemap=tonemap=hable/);
  assert.match(graph,/p=bt709:t=bt709:m=bt709:r=limited/);
  const params=plan.args[plan.args.indexOf('-x265-params')+1];
  assert.match(params,/(^|:)cll=0(:|$)/); assert.doesNotMatch(params,/master-display=|max-cll=/);
  assert.equal(h.owner.inputProfiles(h.probe,'sdr')[0].transfer,transfer);
  h.owner.invalidate(); assert.throws(()=>h.owner.requireCurrent(token,bindings),{code:'HDR_OPERATION_STALE'});
});

test('preservation never falls back into SDR and an absent SDR cell never falls back into preservation', async t => {
  const h=await sdrFixture(t); await h.observe();
  const preserveOnly=new HdrOperations({runtimeIdentity:RUNTIME,policyIdentity:'preserve-only',policies:[h.policy]});
  assert.equal(preserveOnly.inputProfiles(h.probe,'sdr'),null);
  assert.throws(()=>preserveOnly.prepare(h.prepared({request:h.request})),{code:'HDR_QUALIFICATION_REQUIRED'});
  const sdrOnly=new HdrOperations({runtimeIdentity:RUNTIME,policyIdentity:'sdr-only',policies:[h.sdrPolicy]});
  assert.equal(sdrOnly.inputProfiles(h.probe),null);
  assert.throws(()=>sdrOnly.prepare(h.prepared()),{code:'HDR_QUALIFICATION_REQUIRED'});
});

test('missing genuine input receipt cannot be replaced by descriptive frames or a copied receipt', async t=>{
  const h=await sdrFixture(t); await h.observe();
  for(const inputReceipt of [undefined,{},clone(await h.observe())])
    assert.throws(()=>h.owner.prepare(h.prepared({request:h.request,inputReceipt})),{code:'HDR_INPUT_RECEIPT_REQUIRED'});
});

for(const change of [
  p=>{delete p.transformVersion;}, p=>{p.transformVersion='unreviewed';},
  p=>{p.outputProfiles[0].transfer='smpte2084';},p=>{p.outputProfiles[0].primaries='bt2020';},
  p=>{delete p.outputProfiles[0].outputMode;}, p=>{p.profiles[0].width=1920;},
]) test('conversion policy cannot acquire a neighboring unqualified transform/source/output class',async t=>{
  const h=await sdrFixture(t), policy=clone(h.sdrPolicy); change(policy);
  assert.throws(()=>new HdrOperations({runtimeIdentity:RUNTIME,policyIdentity:'wrong',policies:[policy]}));
});

test('workspace discloses the selected target, peak basis and HLG gamma without changing source classification',async t=>{
  const h=await sdrFixture(t,{transfer:'arib-std-b67'}),item={id:h.request.fileId,operationRequest:h.request};
  const transformDescriptor=describeHdrSdrTransform({probe:h.probe,settings:h.workspaceOptions.settings,request:h.request,
    frameEvidence:h.prepared().frameEvidence});
  await prepareHdrItem.call(h.context,item,{...h.workspaceOptions,transformDescriptor});
  assert.equal(item.status,'ready'); assert.equal(item.hdr.policy,'sdr'); assert.equal(item.hdr.transfer,'arib-std-b67');
  assert.equal(item.hdr.targetTransfer,'bt709'); assert.equal(item.hdr.interpretation.hlgSystemGamma,1.2);
  assert.match(item.hdr.notice,/nominal 100-nit/); assert.match(item.hdr.notice,/assumed-1000nit-hlg-reference-display/);
  assert.match(item.hdr.notice,/HLG system gamma 1.2/); assert.equal(h.calls.length,2);
});

test('pure descriptor contains stable transform semantics without source paths or revisions',async t=>{
  const h=await sdrFixture(t),input={probe:h.probe,settings:h.workspaceOptions.settings,request:h.request};
  const first=describeHdrSdrTransform(input),second=describeHdrSdrTransform({...input,request:{...h.request,draftRevision:99}});
  assert.equal(first.transformId,second.transformId);assert.match(first.transformId,/^[a-f0-9]{12}$/);
  assert.equal(first.transformVersion,HDR_TRANSFORM_VERSION);assert.equal(first.expectedSignal.transfer,'bt709');
  assert.equal(first.depth,10);assert.ok(Object.isFrozen(first.interpretation));
  assert.equal(JSON.stringify(first).includes(h.sourcePath),false);
  assert.equal(describeHdrSdrTransform({...input,request:{...h.request,hdrPolicy:'preserve'}}),null);
  const sdrProbe=clone(h.probe);Object.assign(sdrProbe.streams[0],{color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709'});
  assert.equal(describeHdrSdrTransform({...input,probe:sdrProbe}),null);
});

for (const changes of [
  { metadata: 'both', lightLevels: [1000, 500] },
  { metadata: 'both', lightLevels: [2000, 500] },
  { metadata: 'master' }, { metadata: 'none' },
]) test(`same source parameter sets cannot qualify an untested PQ peak: ${JSON.stringify(changes)}`, async t => {
  const h = await sdrFixture(t, changes); await h.observe();
  assert.ok(h.owner.inputProfiles(h.probe, 'sdr'), 'Parameter-set eligibility alone still matches this source.');
  assert.throws(() => h.owner.prepare(h.prepared({ request: h.request })), error =>
    error.code === 'HDR_QUALIFICATION_REQUIRED' && /reported MaxCLL4000/.test(error.message));
  assert.equal(h.context.plan.entries.size, 0); assert.equal(h.live(), 0);
});

test('metadata-only peak/name cannot survive a different complete decoded source peak',async t=>{
  const h=await sdrFixture(t),item={id:h.request.fileId,operationRequest:h.request};
  // The stream has no CLL; complete decoded input has the qualified reported4000nit CLL.
  const transformDescriptor=describeHdrSdrTransform({probe:h.probe,settings:h.workspaceOptions.settings,request:h.request});
  assert.equal(transformDescriptor.interpretation.sourcePeakBasis,'assumed-1000nit-pq-source-peak');
  await assert.rejects(prepareHdrItem.call(h.context,item,{...h.workspaceOptions,transformDescriptor}),{code:'HDR_TRANSFORM_NAME_STALE'});
  assert.equal(h.context.plan.entries.size,0);assert.notEqual(item.status,'ready');assert.equal(h.live(),0);
});

test('main resolves frame-only MaxCLL into its final destination during the same preparation', async t => {
  const h = await sdrFixture(t), item = { id: h.request.fileId, operationRequest: h.request };
  const metadata = describeHdrSdrTransform({ probe: h.probe, settings: h.workspaceOptions.settings, request: h.request });
  const plans = [], prepare = h.owner.prepare.bind(h.owner);
  h.owner.prepare = options => { const plan = prepare(options); plans.push(plan); return plan; };
  let full;
  const final = path.join(h.outputDirectory, 'source_SDR-resolved_H265-CPU.mkv');
  await prepareHdrItem.call(h.context, item, { ...h.workspaceOptions, resolveTransformDestination: async descriptor => {
    full = descriptor; assert.equal(descriptor.interpretation.sourcePeakBasis, 'reported-maxcll');
    assert.equal(descriptor.interpretation.sourcePeakNits, 4000);
    assert.notEqual(descriptor.transformId, metadata.transformId);
    return final;
  } });
  assert.equal(item.status, 'ready'); assert.equal(plans.length, 2);
  assert.notEqual(plans[0].expectedOutput.outputId, plans[1].expectedOutput.outputId);
  const entry = h.context.plan.entries.get(item.id);
  assert.equal(entry.destination, final); assert.equal(entry.operationPlan.args.at(-1), final);
  assert.equal(entry.operationPlan.expectedOutput.hdrTransform.interpretation.sourcePeakNits, full.interpretation.sourcePeakNits);
  assert.throws(() => h.owner.select(h.selectBindings(plans[0])), { code: 'HDR_QUALIFICATION_REQUIRED' });
  assert.equal(h.owner.requireCurrent(entry.qualificationSelection, entry.qualificationBindings).hdrPolicy, 'sdr');
  assert.equal(h.calls.length, 2, 'Rebuilding the unselected plan must not reacquire media');
});

test('a protected transformed destination discards only its provisional plan and leaves another file current', async t => {
  const h = await sdrFixture(t); await h.observe();
  const otherRequest = resolveFileRequest({ fileId: 'another-finite-file', identityRevision: 1, draftRevision: 1,
    operation: 'encode', overrides: { hdrPolicy: 'sdr' } });
  const other = h.owner.prepare(h.prepared({ request: otherRequest, output: path.join(h.outputDirectory, 'other.mkv') }));
  const bindings = h.selectBindings(other), token = h.owner.select(bindings);
  const item = { id: h.request.fileId, operationRequest: h.request };
  await prepareHdrItem.call(h.context, item, { ...h.workspaceOptions, resolveTransformDestination: async () => {
    item.status = 'skipped'; item.reason = 'Output already exists.'; return null;
  } });
  assert.equal(item.status, 'skipped'); assert.equal(h.context.plan.entries.size, 0);
  assert.equal(h.owner.requireCurrent(token, bindings).hdrPolicy, 'sdr'); assert.equal(h.live(), 0);
});

test('cancellation during destination reconciliation leaves no selected conversion or live child', async t => {
  const h = await sdrFixture(t), item = { id: h.request.fileId, operationRequest: h.request }, controller = new AbortController();
  let provisional; const prepare = h.owner.prepare.bind(h.owner);
  h.owner.prepare = options => (provisional = prepare(options));
  await assert.rejects(prepareHdrItem.call(h.context, item, { ...h.workspaceOptions, signal: controller.signal,
    resolveTransformDestination: async () => { h.owner.invalidate(); controller.abort(); return path.join(h.outputDirectory, 'cancelled.mkv'); } }), { code: 'CANCELLED' });
  assert.equal(h.context.plan.entries.size, 0); assert.notEqual(item.status, 'ready'); assert.equal(h.live(), 0);
  assert.throws(() => h.owner.select(h.selectBindings(provisional)), { code: 'HDR_QUALIFICATION_REQUIRED' });
});

test('discarding a stale provisional plan is idempotent and cannot revoke a newer plan for the same file', async t => {
  const h = await sdrFixture(t); await h.observe();
  const stale = h.owner.prepare(h.prepared({ request: h.request }));
  const current = h.owner.prepare(h.prepared({ request: h.request }));
  const bindings = h.selectBindings(current), token = h.owner.select(bindings);
  assert.equal(h.owner.discard(stale), true); assert.equal(h.owner.discard(stale), false);
  assert.equal(h.owner.requireCurrent(token, bindings).hdrPolicy, 'sdr');
  assert.equal(h.owner.discard({}), false);
});

test('normal service distinguishes an existing ordinary output from the resolved SDR name and resets names on edits', async t => {
  const h = await sdrFixture(t, { count: 30 });
  const ordinary = path.join(h.outputDirectory, 'source_H265-CPU.mkv');
  await fs.writeFile(ordinary, 'preserved ordinary destination');
  const service = new EncoderService({ ffmpeg: path.join(h.directory, 'fixed-ffmpeg.exe'), ffprobe: h.options.ffprobe,
    stateDir: path.join(h.directory, 'state'), runtimeIdentity: RUNTIME, run: h.options.run, inspectionWorkers: 1,
    inspectionCache: null, hdrOperations: h.owner, operationEvidenceBudget: h.context.operationEvidenceBudget,
    operationDeadlineMs: 600000, operationTelemetry: true,
    operationRuntime: { ...h.context.operationRuntime, async close() {} },
    operationStorage: async () => { throw Error('Preparation cannot allocate a media stage'); },
    storageEligibility: { async check() { return { eligible: true, reason: 'Synthetic test only' }; } },
    capabilities: async () => ({ profiles: PROFILES.map(value => ({ ...value, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'mocked pinned runtime' } }), inspect: async () => clone(h.inspection) });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const input = await service.registerFolder(h.inputDirectory, 'input'), output = await service.registerFolder(h.outputDirectory, 'output');
  await service.prepareBatch({ inputFolderId: input.id, outputFolderId: output.id, settings: h.workspaceOptions.settings });
  await service.taskPromise; let state = service.snapshot();
  assert.equal(state.items[0].status, 'skipped'); assert.equal(h.calls.length, 0);
  const edit = async hdrPolicy => {
    state = await service.updateFileOperations({ planId: state.planId, draftId: state.operationDraft.id,
      revision: state.operationDraft.revision, fileIds: [state.items[0].id], overrides: { hdrPolicy } });
  };
  await edit('sdr'); assert.equal(state.items[0].status, 'ready', state.items[0].reason);
  assert.match(state.items[0].outputName, /^source_SDR-[a-f0-9]{12}_H265-CPU\.mkv$/);
  const first = state, transformed = path.join(h.outputDirectory, state.items[0].outputName);
  assert.equal(service.plan.entries.get(state.items[0].id).destination, transformed);
  await fs.writeFile(transformed, 'preserved SDR destination');
  await edit('preserve'); assert.equal(state.items[0].outputName, 'source_H265-CPU.mkv'); assert.equal(state.items[0].status, 'skipped');
  assert.throws(() => service.startBatch({ planId: first.planId, fileIds: [first.items[0].id] }), { code: 'STALE_PLAN' });
  await edit('sdr'); assert.equal(path.join(h.outputDirectory, state.items[0].outputName), transformed); assert.equal(state.items[0].status, 'skipped');
  assert.equal(await fs.readFile(ordinary, 'utf8'), 'preserved ordinary destination');
  assert.equal(await fs.readFile(transformed, 'utf8'), 'preserved SDR destination'); assert.equal(h.live(), 0);
});
