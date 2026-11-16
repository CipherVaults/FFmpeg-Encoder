'use strict';
// Admission-only tests: actual fixed executable bytes are read to issue genuine
// observer tokens, but no child/media execution occurs. execute is a test sink.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Av1WorkbenchAdmissionService } = require('./workbench-av1-admission.cjs');
const { isOrdinaryWorkbenchEntry } = require('./workbench-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { buildEncodeOperation, withEncodeOperationTelemetry, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { FAMILY_ID, RESOURCE_POLICY, RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { PINS, RUNTIME_ID } = require('./runtime-av1.cjs');
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
let observer, runtimeToken;
test.before(async () => {
  observer = new OperationRuntimeObserver({ runtime: Object.fromEntries(Object.entries(PINS).map(([k,p]) => [k,p.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([k,p]) => [k,{ sizeBytes:p.size, sha256:p.sha256 }])), run() { assert.fail('No child allowed'); } });
  runtimeToken = await observer.observe({ hardware: 'CPU' });
});
test.after(async () => observer?.close());
function probe(width = 1280) { return { streams: [
  { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width, height: width === 1280 ? 720 : 1080,
    pix_fmt: 'yuv420p', field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360', start_pts: 0, start_time: '0', duration: '150', duration_ts: 2304000,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', tags: { rotate: '0' } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration: '150', duration_ts: 7200000 } ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '150', start_time: '0', size: '100000000', tags: { major_brand: 'qt  ' }, nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 },
  chapters: [], programs: [], stream_groups: [] }; }
function selector() {
  const q = frozenQualifications('synthetic-admission-only', RUNTIME_ID, probe());
  return new OperationFamilySelector({ policyIdentity: 'synthetic-admission-only', families:
    [[FAMILY_ID,RESOURCE_POLICY],[RESIZE_FAMILY_ID,RESIZE_RESOURCE_POLICY],[FULL_RESIZE_FAMILY_ID,FULL_RESIZE_RESOURCE_POLICY]].map(([id,resourcePolicy]) => ({
      id,resourcePolicy, settings:SETTINGS,runtimeIdentity:RUNTIME_ID,environment:null,qualification:q.qualification,timingQualification:q.timingQualification,
      evidenceIds:[q.qualification.evidenceId,q.timingQualification.evidenceId] })) });
}
function ordinary() { return { inspection: { color: { classification:'sdr',supported:true } }, operationPlan: { compatibilityPath:true,
  qualificationRequirements:[], contract: { request: { operation:'encode',target:'matroska',range:null,resolution:'source',audioPolicy:'copy',hdrPolicy:'preserve',omissionRequestIds:[] }, omissionRequests:{ids:[]} } } }; }
function qualified(sel, kind=FAMILY_ID) {
  const source=probe(kind===FAMILY_ID?1280:1920), inspection={probe:source,color:classifyColor(source),duration:150};
  const identity={canonicalPath:path.resolve('/synthetic-admission/source.mov'),dev:'1',ino:'2',size:'100000000',mtimeNs:'1',ctimeNs:'2',birthtimeNs:'1',sparseDigest:`sha256-sparse-v1:${'b'.repeat(64)}`};
  const request=resolveFileRequest({fileId:randomUUID(),identityRevision:1,draftRevision:1,operation:'encode',overrides:{range:kind===FULL_RESIZE_FAMILY_ID?null:{startUs:100000000,endUs:140000000},resolution:kind===FAMILY_ID?'source':'720',audioPolicy:'precision-flac'}});
  const plan=withEncodeOperationTelemetry(buildEncodeOperation({input:identity.canonicalPath,output:path.resolve('/synthetic-admission/output.mkv'),settings:SETTINGS,inspection,request,runtimeIdentity:RUNTIME_ID}));
  const bindings={plan,settings:SETTINGS,sourceIdentity:identity,sourceProbeFingerprint:fingerprintEncodeSource(source),runtimeIdentity:RUNTIME_ID,environment:null,budget:null,executionBudgetMs:120000};
  return {inspection,fingerprint:identity,operationPlan:plan,qualificationBindings:bindings,qualificationSelection:sel.select(bindings),operationRuntimeToken:runtimeToken};
}
function service(entries, sel=selector(), settings=SETTINGS) {
  const s=new Av1WorkbenchAdmissionService({ffmpeg:PINS.ffmpeg.path,ffprobe:PINS.ffprobe.path,runtimeIdentity:RUNTIME_ID,
    stateDir:path.join(__dirname,'artifacts','admission-test-never-executed'),operationQualifications:sel,operationRuntime:observer,operationEvidenceBudget:null,operationDeadlineMs:120000});
  const ids=entries.map(()=>randomUUID());s.plan={id:randomUUID(),operation:'encode',sameFolder:false,settings,entries:new Map(ids.map((id,i)=>[id,entries[i]]))};
  s.state.phase='ready';s.state.items=ids.map((id,i)=>({id,status:'ready',outputName:`output-${i}.mkv`}));
  s.execute=async selected=>{s.started=[...selected];}; return {s,request:{planId:s.plan.id,fileIds:ids}};
}
test('ordinary three-codec paths retain baseline predicate and reach superclass admission', () => {
  for (const profileId of ['h264-cpu','h265-cpu','av1-cpu']) {
    const e=ordinary();assert.equal(isOrdinaryWorkbenchEntry(e),true);
    const {s,request}=service([e],selector(),{profileId,preset:profileId==='av1-cpu'?'6':'slow',quality:25});
    s.startBatch(request);assert.deepEqual(s.started,request.fileIds);
  }
});
test('genuine KeepSource, range resize and Full resize tokens coexist with ordinary H265 in one preflight', () => {
  const sel=selector(), entries=[ordinary(),... [FAMILY_ID,RESIZE_FAMILY_ID,FULL_RESIZE_FAMILY_ID].map(k=>qualified(sel,k))];
  const {s,request}=service(entries,sel);s.startBatch(request);assert.deepEqual(s.started,request.fileIds);
});
test('forged/stale family and runtime tokens refuse the whole batch without state mutation', () => {
  for (const mutate of [e=>{e.qualificationSelection={};},e=>{e.operationRuntimeToken={};},e=>{e.fingerprint={...e.fingerprint,ino:'999'};}]) {
    const sel=selector(),e=qualified(sel);mutate(e);const {s,request}=service([ordinary(),e],sel);
    assert.throws(()=>s.startBatch(request));assert.equal(s.started,undefined);assert.ok(s.state.items.every(i=>i.status==='ready'));
  }
  const sel=selector(),e=qualified(sel);sel.invalidate('synthetic expiry');const {s,request}=service([e],sel);
  assert.throws(()=>s.startBatch(request),{code:'OPERATION_QUALIFICATION_STALE'});assert.equal(s.started,undefined);
});
test('unsupported route, omissions, settings and separate-folder rules cannot partially start', () => {
  for (const mutate of [e=>{e.hdr={};},e=>{e.native={};},e=>{e.vendor={};},e=>{e.remux={};},e=>{e.encodePreservation={};},
    e=>{e.inspection.color.supported=false;}]) {
    const e=ordinary();mutate(e);assert.equal(isOrdinaryWorkbenchEntry(e),false);const {s,request}=service([ordinary(),e]);
    assert.throws(()=>s.startBatch(request),{code:'LINUX_AV1_ADMISSION'});assert.equal(s.started,undefined);
  }
  const bad=ordinary();bad.operationPlan.contract.request.omissionRequestIds=['x'];const x=service([bad]);assert.throws(()=>x.s.startBatch(x.request));
  for (const change of [s=>{s.plan.sameFolder=true;},s=>{s.plan.operation='remux';},s=>{s.plan.settings={profileId:'h265-nvidia'};}]) {
    const {s,request}=service([ordinary()]);change(s);assert.throws(()=>s.startBatch(request));assert.equal(s.started,undefined);
  }
});
test('stale plans and invalid selections retain superclass refusal before any start', () => {
  const {s,request}=service([ordinary()]);assert.throws(()=>s.startBatch({...request,planId:randomUUID()}),{code:'STALE_PLAN'});
  assert.throws(()=>s.startBatch({...request,fileIds:[randomUUID()]}),{code:'INVALID_SELECTION'});
  assert.throws(()=>s.startBatch({...request,fileIds:[]}),{code:'INVALID_SELECTION'});assert.equal(s.started,undefined);
});

test('a revoked genuine observer token refuses before superclass mutation', async () => {
  const staleToken = await observer.observe({ hardware: 'CPU' });
  const sel=selector(),e=qualified(sel);e.operationRuntimeToken=staleToken;
  observer.invalidate(staleToken,'synthetic stale observation');
  const {s,request}=service([ordinary(),e],sel);
  assert.throws(()=>s.startBatch(request),{code:'OPERATION_RUNTIME_STALE'});
  assert.equal(s.started,undefined);assert.ok(s.state.items.every(i=>i.status==='ready'));
});
