'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { FULL_COPY_FAMILY_ID: FAMILY_ID, FULL_COPY_RESOURCE_POLICY: RESOURCE_POLICY, deriveCfrFullResizeCopyResources } = require('../src/operation-resource-budget.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
function frozenQualifications(label, runtimeIdentity) { return { qualification: { evidenceId: label + ':endpoint', runtimeIdentity, containerDuration: 'matroska-copy-end-plus-codec-delay', tolerances: { videoTimestampUs: 1067, audioTimestampUs: 1042, avSyncUs: 23422, durationUs: 1088, sampleCount: 0 } }, timingQualification: { evidenceId: label + ':interior', runtimeIdentity, videoDurationUs: 1067, audioTimelineUs: 1042, aac: null } }; }
const { operationCostLimits } = require('../src/encoder-service.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
// In-memory fixtures only: not measured qualification, process or media execution.
const RUNTIME = 'a'.repeat(64), settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const LEGACY_BUDGET = { sourceDecode: 'complete', timeoutMs: 1000, maxFrameBytes: 16384, maxPcmBytes: 1048576, maxRecords: 500, maxSpoolBytes: 65536 };
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 }, side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0, displaymatrix: '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824' }] },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}

function descriptor() {
  const frozen = frozenQualifications('synthetic-proportional', RUNTIME, probe());
  return { id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity: RUNTIME, environment: null, settings: { ...settings },
    qualification: frozen.qualification, timingQualification: frozen.timingQualification, evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] };
}
function legacy() {
  const f = descriptor(); delete f.resourcePolicy;
  return { ...f, id: 'full-sdr-resize-copy-v1', budget: { ...LEGACY_BUDGET }, executionBudgetMs: 60000 };
}
function fixture({ duration = 150, range = null, mutate = () => {}, resolution = '720', families = [descriptor()], legacyMode = false } = {}) {
  const source = probe(duration); mutate(source);
  const identity = { canonicalPath: path.resolve('/synthetic-proportional/input.mov'), dev: '1', ino: '2', size: source.format.size,
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range, resolution, audioPolicy: 'copy' } });
  const plan = buildEncodeOperation({ input: identity.canonicalPath, output: path.resolve('/synthetic-proportional/output.mkv'), settings,
    inspection: { probe: source, color: classifyColor(source), duration }, request, runtimeIdentity: RUNTIME });
  const bindings = { plan, settings, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME,
    environment: null, budget: legacyMode ? { ...LEGACY_BUDGET } : null, executionBudgetMs: legacyMode ? 60000 : 120000 };
  const selector = new OperationFamilySelector({ families, policyIdentity: 'synthetic-proportional-policy' });
  return { source, plan, bindings, selector };
}
const choose = h => { const token = h.selector.select(h.bindings); return { token, result: h.selector.requireCurrent(token, h.bindings) }; };
const required = action => assert.throws(action, { code: 'OPERATION_QUALIFICATION_REQUIRED' });
function receipt(h, duration = 150) {
  return { schema: 1, status: 'completed', runtimeIdentity: RUNTIME, planFingerprint: h.plan.planFingerprint,
    sourcePath: h.bindings.sourceIdentity.canonicalPath, completeSource: { video: { frames: duration * 30,
      firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, maximumNominalCadenceErrorUs: 0,
      maximumNominalDurationErrorUs: 0, maximumNominalPhaseErrorUs: 0,
      properties: { policy: FAMILY_ID, sampleAspectRatio: '1:1', chromaLocation: 'left', sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: duration * 30 } },
    audio: [{ inputIndex: 1, sampleCount: String(duration * 48000), firstTime: { n: '0', d: '1' }, endTime: { n: String(duration), d: '1' }, gaps: 0 }] } };
}

test('Full copy derives exact whole-source budgets for short, long and ordinary half-hour files', () => {
 for(const duration of [1,8,150,1800]) {
  const h=fixture({duration}),{token,result}=choose(h), expected=deriveCfrFullResizeCopyResources({sourceExtentUs:duration*1000000,sourceBytes:h.bindings.sourceIdentity.size});
  assert.deepEqual(result.resources,expected.resources);assert.deepEqual(result.budget,expected.budget);assert.equal(result.executionBudgetMs,expected.executionBudgetMs);
  assert.equal(result.sourcePolicy.maximumExtentUs,duration*1000000);assert.equal(result.resourcePolicy,RESOURCE_POLICY);assert.equal(isProportionalFamilySelection(result,h.plan),true);
  assert.equal(h.plan.contract.range.kind,'full');assert.equal(h.plan.contract.audio.streams[0].mode,'copy');assert.equal(h.plan.compatibilityPath,false);
  assert.deepEqual(operationCostLimits({operationPlan:h.plan},result),{...expected.resources,executionBudgetMs:expected.executionBudgetMs});
  assert.equal(h.selector.verifyCollectedSource(token,receipt(h,duration)),true);
  assert.doesNotMatch(h.plan.args.join(' '),/atrim|asetpts|pcm_s16le|codec:a:0 flac/);
 }
});
test('Full copy preserves exact synthetic metadata equality, not a borrowed FLAC one-tick allowance',()=>{
 const h=fixture(),{token}=choose(h);for(const stream of ['video','audio']) {const r=receipt(h);const item=stream==='video'?r.completeSource.video:r.completeSource.audio[0];item.endTime={n:stream==='video'?'2303999':'7199999',d:stream==='video'?'15360':'48000'};assert.throws(()=>h.selector.verifyCollectedSource(token,r),/exact synthetic metadata/);}
});
test('Full copy rejects cross-family clocks, FLAC policies, range requests and unsupported source shape',()=>{
 for(const change of [f=>f.resourcePolicy='cfr1080p30-to720p-flac-resources-v1',f=>f.qualification.containerDuration='end-timestamp',f=>f.qualification.tolerances.sampleCount=1,f=>f.timingQualification.aac={alignment:'source-origin',encoderDelaySamples:0,discardPaddingSamples:0}]) {const f=descriptor();change(f);assert.throws(()=>fixture({families:[f]}));}
 for(const patch of [{range:{startUs:0,endUs:1000000}},{resolution:'source'},{mutate:p=>{p.streams[0].width=1280;p.streams[0].height=720;}},{mutate:p=>{p.streams[0].avg_frame_rate=p.streams[0].r_frame_rate='60/1';}},{mutate:p=>{p.streams[1].codec_name='pcm_s16le';p.streams[1].sample_fmt='s16';}},{mutate:p=>{p.streams[1].sample_rate='44100';}},{mutate:p=>{p.streams[0].color_transfer='smpte2084';}},{mutate:p=>{p.streams[0].sample_aspect_ratio='4:3';}},{mutate:p=>{p.streams[0].side_data_list[0].rotation=90;}},{mutate:p=>{p.streams[1].duration='151';p.streams[1].duration_ts=7248000;}},{duration:200000}])assert.throws(()=>choose(fixture(patch)));
});
test('Full copy uses private exact-plan resource authority and inert descriptor validation',()=>{
 const h=fixture(),other=fixture(),{result,token}=choose(h);assert.equal(isProportionalFamilySelection({...result}),false);assert.throws(()=>operationCostLimits({operationPlan:other.plan},result));
 let reads=0;const f=descriptor();Object.defineProperty(f,'id',{enumerable:true,get(){reads++;return FAMILY_ID;}});assert.throws(()=>fixture({families:[f]}));assert.equal(reads,0);
 const changed=receipt(h);changed.completeSource.video.properties.policy='cfr-sdr-range-resize-flac-v1';assert.throws(()=>h.selector.verifyCollectedSource(token,changed));h.selector.invalidate('synthetic');assert.equal(isProportionalFamilySelection(result),false);
});
test('legacy Full copy keeps original10–31second bounds independently',()=>{
 for(const duration of [10,31])assert.doesNotThrow(()=>choose(fixture({duration,families:[legacy()],legacyMode:true})));
 for(const duration of [1,8,32,150])assert.throws(()=>choose(fixture({duration,families:[legacy()],legacyMode:true})));
});
test('absent orientation grants only the exact Full copy tuple, including long source',()=>{
 const source=probe();delete source.streams[0].side_data_list;const selector=new OperationFamilySelector({families:[descriptor()],policyIdentity:'synthetic-full-copy'});
 const request=resolveFileRequest({fileId:'synthetic',identityRevision:1,draftRevision:1,operation:'encode',overrides:{range:null,resolution:'720',audioPolicy:'copy'}});
 const opts={inspection:{probe:source,color:classifyColor(source),duration:150},request,runtimeIdentity:RUNTIME,settings};const grant=selector.orientationQualification(opts);assert.ok(grant.identityOrientationQualification);
 const wrong=structuredClone(request);wrong.audioPolicy='precision-flac';assert.deepEqual(selector.orientationQualification({...opts,request:wrong}),{});assert.deepEqual(selector.orientationQualification({...opts,runtimeIdentity:'c'.repeat(64)}),{});
});
