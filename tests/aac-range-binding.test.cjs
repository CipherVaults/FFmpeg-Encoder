'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAacRangeBinding } = require('../linux-blue/aac-range-binding.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS }=require('../src/operation-controls.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');

// In-memory synthetic applicability and receipt records only. These deliberately
// small test policies are not production calibration, retained media, hardware
// observations, executable qualification or authorization to publish anything.
const clone = value => structuredClone(value);
const RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13', POLICY = 'synthetic-family-policy-v1';
const CPU = { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, NVIDIA = { profileId: 'h265-nvidia', preset: 'p5', quality: 25 };
const DEVICE = { adapterIdentity: 'GPU-01234567-89ab-cdef-0123-456789abcdef', driverVersion: '581.80', runtimeVersion: `FFmpeg9.0.2:${RUNTIME}` };
const BUDGET = EVIDENCE_BUDGET;
const SOURCE = { canonicalPath: '/synthetic-family/input.mp4', dev: '1', ino: '2', size: '1000000',
  mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
function probe({ width = 1280, rate = 30, duration = 4, absent = false } = {}) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width, height: width === 1920 ? 1080 : 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: `${rate}/1`, r_frame_rate: `${rate}/1`,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/90000',
    start_pts: 0, start_time: '0', duration_ts: duration * 90000, duration: String(duration), disposition: { default: 1 }, ...(absent ? {} : { tags: { rotate: '0' } }) },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: duration * 48000, duration: String(duration), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration), start_time: '0', size: SOURCE.size,
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 }, programs: [], stream_groups: [], chapters: [] };
}
function family(config = CPU) {
  return { id: 'short-sdr-range-v1', evidenceIds: ['synthetic-family-endpoint', 'synthetic-family-interior'], runtimeIdentity: RUNTIME,
    environment: config.profileId === 'h265-nvidia' ? clone(DEVICE) : null, settings: clone(config),
    qualification: { evidenceId: 'synthetic-family-endpoint', runtimeIdentity: RUNTIME, containerDuration: 'matroska-packet-end-plus-codec-delay',
      tolerances: { videoTimestampUs: 1000, audioTimestampUs: 1000, avSyncUs: 2000, durationUs: 1000, sampleCount: 1024 } },
    timingQualification: { evidenceId: 'synthetic-family-interior', runtimeIdentity: RUNTIME, videoDurationUs: 1000, audioTimelineUs: 1000,
      aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } }, budget: clone(BUDGET), executionBudgetMs: EXECUTION_BUDGET_MS };
}
function fixture(options = {}) {
  const source = probe(options), config = options.config || CPU; options.mutate?.(source);
  if(options.product){source.streams[0].time_base='1/15360';source.streams[0].duration_ts=Number(source.format.duration)*15360;}
  const retained = options.families ? options.families[0] : family(config), selector = options.product ? require('../linux-blue/product-linux-service.cjs').createProductSelector(require('../linux-blue/product-linux-qualification.json')) : createAacRangeBinding(retained);
  const request = resolveFileRequest({ fileId: options.fileId || 'synthetic-file', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: options.ordinary ? {} : { range: { startUs: 1000000, endUs: 2000000 }, audioPolicy: 'precision-aac', ...options.overrides } });
  const inspection = { probe: source, color: classifyColor(source), duration: Number(source.format.duration) };
  const orientation = selector.orientationQualification({ inspection, request, runtimeIdentity: RUNTIME, settings: config });
  const identity = { ...clone(SOURCE), ...options.identity };
  const plan = buildEncodeOperation({ input: identity.canonicalPath, output: '/synthetic-family-owned/output.mkv', inspection, settings: config, request,
    runtimeIdentity: RUNTIME, ...orientation });
  const bindings = { plan, settings: clone(config), sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME,
    environment: config.profileId === 'h265-nvidia' ? clone(DEVICE) : null, budget: clone(BUDGET), executionBudgetMs: EXECUTION_BUDGET_MS };
  return { source, inspection, request, plan, retained, selector, bindings, orientation };
}
test('main-owned binding delegates genuine AAC range selection with exact finite budgets',()=>{const h=fixture();const selected=h.selector.select(h.bindings);assert(selected);assert(Object.isFrozen(h.selector));assert.equal(h.selector.operationDeadlineMs,600000);assert.deepEqual(h.selector.operationEvidenceBudget,EVIDENCE_BUDGET);h.selector.invalidate('retired');assert.throws(()=>h.selector.requireCurrent(selected,h.bindings));});
test('binding refuses missing or widened budgets, wrong runtime and ordinary fallback',()=>{for(const change of [b=>b.budget=null,b=>b.budget={...BUDGET,maxRecords:BUDGET.maxRecords+1},b=>b.executionBudgetMs=120000,b=>b.runtimeIdentity='b'.repeat(64),b=>b.settings={...CPU,preset:'fast'}]){const h=fixture();change(h.bindings);assert.throws(()=>h.selector.select(h.bindings));}const h=fixture({ordinary:true});assert.throws(()=>h.selector.select(h.bindings));});
test('copy, unqualified clock/padding and wrong CPU contracts cannot be silently substituted',()=>{assert.throws(()=>fixture({overrides:{audioPolicy:'copy'}}).selector.select(fixture({overrides:{audioPolicy:'copy'}}).bindings));for(const change of [f=>f.runtimeIdentity='b'.repeat(64),f=>f.settings.preset='fast',f=>f.budget={...BUDGET,maxPcmBytes:1},f=>f.timingQualification.aac.discardPaddingSamples=1,f=>f.timingQualification.aac.encoderDelaySamples=0,f=>f.qualification.containerDuration='end-timestamp']){const f=family();change(f);assert.throws(()=>createAacRangeBinding(f));}});
test('existing family continues refusing unsupported media properties',()=>{for(const mutate of [p=>p.streams[1].sample_rate='44100',p=>p.streams[1].channels=1,p=>p.streams[0].pix_fmt='yuv420p10le'])assert.throws(()=>{const h=fixture({mutate});h.selector.select(h.bindings);});});

test('main-owned family rejects accessors without invoking them',()=>{const f=family();let calls=0;Object.defineProperty(f,'budget',{get(){calls++;return BUDGET;}});assert.throws(()=>createAacRangeBinding(f));assert.equal(calls,0);});

test('fixed active AAC selector admits property-matching files and refuses 60 fps and unmeasured geometry',()=>{
 for(const options of [{},{width:1920},{width:1920,overrides:{resolution:'720'}}]){const h=fixture({...options,product:true});const token=h.selector.select(h.bindings);assert(token);assert(h.selector.requireCurrent(token,h.bindings));
  for(const mutate of [b=>b.runtimeIdentity='a'.repeat(64),b=>b.executionBudgetMs=120000,b=>b.budget={...BUDGET,maxRecords:2}]){const b=clone(h.bindings);b.plan=h.plan;mutate(b);assert.throws(()=>h.selector.requireCurrent(token,b));}}
 for(const options of [{rate:60},{width:2560},{width:3840},{width:1920,rate:60,overrides:{resolution:'720'}}])assert.throws(()=>{const h=fixture({...options,product:true});h.selector.select(h.bindings);});
 const h=fixture({product:true}),token=h.selector.select(h.bindings),other=fixture({product:true,identity:{ino:'3'}});assert.throws(()=>h.selector.requireCurrent(token,other.bindings));
});
test('active currentness itself refuses sixty fps even when a generic preparation adapter built the plan',()=>{
 const active=fixture({product:true}),token=active.selector.select(active.bindings);
 const generic=fixture({rate:60,mutate:p=>{p.streams[0].time_base='1/15360';p.streams[0].duration_ts=Number(p.format.duration)*15360;}});
 assert.throws(()=>active.selector.requireCurrent(token,generic.bindings),/30 fps/);
});

test('mechanism-supported 1080 source keeps exact range and audio graph while removing only video resize',()=>{
 const source=fixture({product:true,width:1920}),resized=fixture({product:true,width:1920,overrides:{resolution:'720'}});
 for(const h of [source,resized]){const t=h.selector.select(h.bindings);assert(h.selector.requireCurrent(t,h.bindings));}
 assert.equal(source.plan.contract.geometry.output.width,1920);assert.equal(source.plan.contract.geometry.output.height,1080);
 assert.equal(resized.plan.contract.geometry.output.width,1280);assert.equal(resized.plan.contract.geometry.output.height,720);
 assert.deepEqual(source.plan.expectedOutput.filters.audio,resized.plan.expectedOutput.filters.audio);
 assert.deepEqual(source.plan.contract.range,resized.plan.contract.range);
 assert.deepEqual(source.plan.contract.audio,resized.plan.contract.audio);
 assert(source.plan.expectedOutput.filters.video.every(part=>!part.includes('scale=')));
 assert(resized.plan.expectedOutput.filters.video.some(part=>part.includes('scale=')));
 for(const part of source.plan.expectedOutput.filters.video)assert(resized.plan.expectedOutput.filters.video.includes(part));
});
