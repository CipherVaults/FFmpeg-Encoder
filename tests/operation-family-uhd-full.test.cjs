'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { UHD_FULL_FAMILY_ID: FAMILY_ID, UHD_FULL_RESOURCE_POLICY: RESOURCE_POLICY, deriveCfrUhdFullFlacResources } = require('../src/operation-resource-budget.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { EncoderService, operationCostLimits } = require('../src/encoder-service.cjs');
const { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
// In-memory fixtures only: not measured qualification, process or media execution.
const RUNTIME = 'a'.repeat(64), settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const LEGACY_BUDGET = { sourceDecode: 'complete', timeoutMs: 1000, maxFrameBytes: 16384, maxPcmBytes: 1048576, maxRecords: 500, maxSpoolBytes: 65536 };
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 3840, height: 2160,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 }, side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0, displaymatrix: '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824' }] },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
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
  return { ...f, id: 'short-sdr-range-flac-v1', budget: { ...LEGACY_BUDGET }, executionBudgetMs: 60000 };
}
function fixture({ duration = 8, range = null, mutate = () => {}, resolution = '720', families = [descriptor()], legacyMode = false, runtime = RUNTIME } = {}) {
  const source = probe(duration); mutate(source);
  const identity = { canonicalPath: path.resolve('/synthetic-proportional/input.mov'), dev: '1', ino: '2', size: source.format.size,
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range, resolution, audioPolicy: 'precision-flac' } });
  const plan = buildEncodeOperation({ input: identity.canonicalPath, output: path.resolve('/synthetic-proportional/output.mkv'), settings,
    inspection: { probe: source, color: classifyColor(source), duration }, request, runtimeIdentity: runtime });
  const bindings = { plan, settings, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: runtime,
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

test('UHD Full matrix uses genuine plans, complete-source receipts and output-sized budgets', () => {
 for (const [resolution,width,height] of [['1440',2560,1440],['1080',1920,1080],['720',1280,720]]) {
  const h=fixture({resolution}), {token,result}=choose(h);
  const expected=deriveCfrUhdFullFlacResources({sourceExtentUs:8000000,sourceBytes:h.bindings.sourceIdentity.size,resolution});
  assert.deepEqual(result.budget,expected.budget);assert.equal(result.executionBudgetMs,expected.executionBudgetMs);
  assert.equal(h.plan.contract.geometry.output.width,width);assert.equal(h.plan.contract.geometry.output.height,height);
  assert.equal(h.plan.contract.range.kind,'full');assert.match(h.plan.args.join(' '),new RegExp(`scale=w=${width}:h=${height}:flags=lanczos`));
  assert.equal(h.selector.verifyCollectedSource(token,receipt(h,8)),true);
  assert.deepEqual(operationCostLimits({operationPlan:h.plan},result),{...expected.resources,executionBudgetMs:expected.executionBudgetMs});
  assert.throws(()=>h.selector.requireCurrent(token,{...h.bindings,runtimeIdentity:'f'.repeat(64)}));
 }
});
test('UHD family refuses unsupported scope and does not borrow existing family',()=>{
 for(const patch of [{range:{startUs:0,endUs:1000000}},{resolution:'source'},{resolution:'2160'},
 {mutate:p=>{p.streams[0].width=4096;}},{mutate:p=>{p.streams[0].width=2560;p.streams[0].height=1440;}},
 {mutate:p=>{p.streams[0].avg_frame_rate='60/1';p.streams[0].r_frame_rate='60/1';}},
 {mutate:p=>{p.streams[0].r_frame_rate='29/1';}}, {mutate:p=>{p.streams[0].color_transfer='smpte2084';}},
 {mutate:p=>{p.streams[1].codec_name='aac';p.streams[1].sample_fmt='fltp';p.streams[1].profile='LC';}},
 {mutate:p=>{p.streams[0].sample_aspect_ratio='4:3';}}, {mutate:p=>{p.streams[0].side_data_list[0].rotation=90;}}]) assert.throws(()=>choose(fixture(patch)));
 const f=descriptor();f.id=require('../src/operation-resource-budget.cjs').RESIZE_1440_FAMILY_ID;f.resourcePolicy=require('../src/operation-resource-budget.cjs').RESIZE_1440_RESOURCE_POLICY;
 assert.throws(()=>choose(fixture({families:[f]})));
});
test('UHD resource policy scales input and output separately without truncation',()=>{
 const o={sourceExtentUs:8000000,sourceBytes:'100000000'};
 const low=deriveCfrUhdFullFlacResources({...o,resolution:'720'}),high=deriveCfrUhdFullFlacResources({...o,resolution:'1440'});
 assert.equal(high.budget.timeoutMs-low.budget.timeoutMs,8*(60000-15000));
 assert.equal(high.executionBudgetMs-low.executionBudgetMs,16*(60000-15000));
 assert.throws(()=>deriveCfrUhdFullFlacResources({...o,resolution:'2160'}));
 assert.throws(()=>deriveCfrUhdFullFlacResources({...o,resolution:'720',sourceExtentUs:Number.MAX_SAFE_INTEGER}));
});

test('non-UHD selectors preserve early no-precondition orientation return for1080 and1440',()=>{
 const selector=new OperationFamilySelector({families:[],policyIdentity:'no-uhd-family'});
 for(const resolution of ['1080','1440']) {
  const request=resolveFileRequest({fileId:'ordinary',identityRevision:1,draftRevision:1,operation:'encode',overrides:{resolution}});
  assert.deepEqual(selector.orientationQualification({inspection:null,request,runtimeIdentity:null,settings:null}),{});
 }
});

test('default Windows factory derives only the measured resize budgets on the exact pair', () => {
  const manifest = require('../resources/regular-windows-engine-manifest.json');
  const stateDir = path.resolve('inert-state');
  const runtime = { verified: manifest.binaries, ffmpeg: path.resolve('inert-ffmpeg.exe'), ffprobe: path.resolve('inert-ffprobe.exe') };
  const selected = createOperationControls({ runtime, stateDir });
  const service = Object.assign(Object.create(EncoderService.prototype), selected);
  for (const entry of [
    { source: [3840, 2160], resolution: '1080', range: null },
    { source: [2560, 1440], resolution: '720', range: { startUs: 110000000 } },
  ]) {
    const h = fixture({ duration: 150, runtime: manifest.enginePair, resolution: entry.resolution, range: entry.range,
      mutate(source) { [source.streams[0].width, source.streams[0].height] = entry.source; } });
    const controls = service.resolveEncodeControls(h.plan, settings);
    assert.deepEqual(controls, { budget: null, executionBudgetMs: EXECUTION_BUDGET_MS });
    const bindings = { ...h.bindings, ...controls };
    const token = selected.operationQualifications.select(bindings);
    const observed = selected.operationQualifications.requireCurrent(token, bindings);
    assert.equal(observed.proportional, true);
    assert.match(observed.policyIdentity, /^encode-windows-9\.1-v1:/);
    assert.equal(observed.qualification.tolerances.sampleCount, 0);
    assert.equal(observed.budget.sourceDecode, 'complete');
    assert.deepEqual(service.resolveEncodeControls(h.plan, { ...settings, quality: 26 }),
      { budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS });
  }
  const unsupported = fixture({ duration: 150, runtime: manifest.enginePair, range: { startUs: 0, endUs: 1000000 } });
  assert.deepEqual(service.resolveEncodeControls(unsupported.plan, settings),
    { budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS });
  assert.equal(selected.operationEvidenceBudget, EVIDENCE_BUDGET);
  assert.equal(selected.operationDeadlineMs, EXECUTION_BUDGET_MS);

  const explicitLab = createOperationControls({ runtime, stateDir, families: [], policyIdentity: 'explicit-laboratory' });
  assert.equal(explicitLab.usesProportionalEncodeBudget, undefined);
  const differentPair = { ...runtime,
    verified: [{ ...runtime.verified[0], sha256: 'e'.repeat(64) }, runtime.verified[1]] };
  const legacy = createOperationControls({ runtime: differentPair, stateDir });
  assert.equal(legacy.usesProportionalEncodeBudget, undefined);
  assert.equal(legacy.operationEvidenceBudget, EVIDENCE_BUDGET);
});
