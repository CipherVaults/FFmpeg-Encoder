'use strict';
// Internal opt-in product composition. Shared preservation validators remain authoritative.
// Accepted private lifecycle evidence does not establish native picker/reveal qualification.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const { getRemuxAssessmentSource } = require('../src/remux-contract.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { runTool } = require('../src/process-runner.cjs');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { loadRemuxQualification } = require('./product-linux-remux-qualification.cjs');
const RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const DEPENDENCIES = 'c0fb3610bd2d66733c3fb0787d94877f0631d63d9fbe00ddb751eaa34741adbf';
function environment() {
  assert(process.platform === 'linux' && process.arch === 'x64' && !process.env.NODE_OPTIONS);
  assert(!Object.entries(process.env).some(([k,v])=>k.startsWith('LD_')&&v));
}
function record(value, allowed, required = allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || required.some(k => !Object.hasOwn(value, k)) || Reflect.ownKeys(value).some(k => !allowed.includes(k)
      || !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) assert.fail('Expected inert explicit candidate fields.');
}
function exactRawWindow(args, evidenceRoot) {
  const prefix = ['-hide_banner','-loglevel','warning','-nostdin','-n','-xerror','-protocol_whitelist','file,pipe'];
  let i = 0; for (const x of prefix) if (args[i++] !== x) return false;
  let count = 0;
  while (args[i] === '-threads') {
    for (const x of ['-threads','1','-noautorotate','-f','h264','-i']) if (args[i++] !== x) return false;
    const clip = args[i++];
    if (typeof clip !== 'string' || path.resolve(clip) !== clip || !clip.startsWith(evidenceRoot + path.sep) || !clip.includes('/remux-evidence-')) return false;
    if (++count > 2) return false;
  }
  if (!count) return false;
  for (let n = 0; n < count; n++) for (const x of ['-map',n + ':v:0','-an','-sn','-dn','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','framehash','-hash','sha256',n ? 'pipe:3' : 'pipe:1']) if (args[i++] !== x) return false;
  return i === args.length;
}
function invocation(pins, executable, args, options, evidenceRoot) {
  const kind = ['ffmpeg','ffprobe'].find(k => pins[k].path === executable);
  if (!kind || !Array.isArray(args) || args.length > 512 || Reflect.ownKeys(args).length !== args.length + 1) assert.fail('Fixed candidate tool and dense bounded arguments required.');
  for (let i = 0; i < args.length; i++) {
    const d = Object.getOwnPropertyDescriptor(args, String(i));
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string' || d.value.length > 16384 || d.value.includes('\0')) assert.fail('Inert bounded arguments required.');
  }
  record(options, ['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onChild', 'onProgress', 'onStdoutChunk', 'onOutputBytes'], ['timeoutMs']);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) assert.fail('Native cancellation signal required.');
  for (const [k, max] of [['timeoutMs', 2147483647], ['stdoutLimit', 1024 * 1024 * 1024], ['stderrLimit', 256 * 1024]])
    if (options[k] !== undefined && (!Number.isSafeInteger(options[k]) || options[k] < 1 || options[k] > max)) assert.fail('Positive bounded child budgets required.');
  for (const k of ['onChild', 'onProgress', 'onStdoutChunk', 'onOutputBytes']) if (options[k] !== undefined && typeof options[k] !== 'function') assert.fail('Observation callback required.');
  for (let i = 0; i < args.length; i++) if (/^-(?:hwaccel(?:_.*)?|init_hw_device|filter_hw_device)$/.test(args[i])
    || (/^-(?:c|codec)(?::v(?::\d+)?)?$/.test(args[i]) || args[i] === '-vcodec') && !(args[i + 1] === 'copy' || args[i + 1] === 'rawvideo' && exactRawWindow(args, evidenceRoot))) assert.fail('Candidate calibration is CPU-only.');
  return kind;
}

const { classifyRemuxMetadataTag } = require('../src/remux-metadata-policy.cjs');
function admitMovMetadata(source) {
  for(const stream of source.streams){
    assert.equal(Number(stream.disposition?.default || 0),1,'MOV requires the default disposition on each track');
    assert(Object.entries(stream.disposition || {}).every(([key,value])=>key==='default'||Number(value)===0),'MOV has an unqualified disposition');
    for(const [key,value] of Object.entries(stream.tags || {})){
      const c=classifyRemuxMetadataTag(key,{scope:'stream'});
      if(c.classification==='descriptive'||c.classification==='operation-derived')continue;
      assert(c.normalizedKey==='language'&&value==='und'||c.normalizedKey==='handler_name'&&value===(stream.codec_type==='video'?'VideoHandler':'SoundHandler'),'MOV track metadata is outside the reviewed subset');
    }
  }
  const brands=new Set(['major_brand','minor_version','compatible_brands']);
  for(const key of Object.keys(source.format.tags || {})){
    const c=classifyRemuxMetadataTag(key,{scope:'container'});
    assert(brands.has(c.normalizedKey)||c.classification==='descriptive'||c.classification==='operation-derived','MOV container metadata is outside the reviewed subset');
  }
}
function remuxPolicies(q){
  const base={inputFamily:'isobmff',runtimeIdentity:RUNTIME,allowAncillary:false,allowRotation90:false,verificationMethod:'packet-identity-v1'};
  return [{...base,id:'internal-isobmff-mp4-081',target:'mp4',evidenceIds:[q.evidenceId]},...(q.matroska?[{...base,id:'internal-isobmff-matroska-093',target:'matroska',evidenceIds:[q.matroska.evidenceId]}]:[]),...(q.mov?[{...base,id:'internal-isobmff-mov-096',target:'mov',sourceEnvelope:q.mov.sourceEnvelope,evidenceIds:[q.mov.evidenceId]}]:[])];
}
function remuxSupport(q){return {targets:remuxPolicies(q).map(p=>p.target),notice:'Internal MP4 source Full stream copy: H264 SDR and stereo48kHz AAC-LC, one input. MKV/MOV additionally require CFR30 and reviewed current target evidence. MOV requires default tracks and unspecified language/default handlers; other functional metadata remains unavailable. Descriptive tags use shared warning semantics. No automatic conversion; native evidence is artifact-specific.'};}
function admit(assessment,input,{proportionalMp4=false}={}) {
  const p=getRemuxAssessmentSource(assessment), v=p.streams.filter(s=>s.codec_type==='video'), a=p.streams.filter(s=>s.codec_type==='audio');
  assert(assessment.inputFamily==='isobmff' && ['mp4','matroska','mov'].includes(assessment.target) && path.extname(input).toLowerCase()==='.mp4');
  assert(assessment.request.omissionRequestIds.length===0 && p.chapters.length===0 && p.streams.length===2 && v.length===1 && a.length===1);
  assert(v[0].codec_name==='h264' && v[0].pix_fmt==='yuv420p' && v[0].field_order==='progressive');
  if(['matroska','mov'].includes(assessment.target))assert(v[0].avg_frame_rate==='30/1'&&v[0].r_frame_rate==='30/1','MKV/MOV copy requires CFR30 source metadata');
  assert(v[0].width<=1920 && v[0].height<=1080 && v[0].width>0 && v[0].height>0);
  assert(a[0].codec_name==='aac' && a[0].profile==='LC' && a[0].sample_fmt==='fltp' && a[0].sample_rate==='48000' && a[0].channels===2 && a[0].channel_layout==='stereo');
  assert(Number.isFinite(Number(p.format.duration)) && Number(p.format.duration)>0 && /^[1-9]\d*$/.test(String(p.format.size)) && Number.isSafeInteger(Number(p.format.size)));
  if(!proportionalMp4 || assessment.target!=='mp4')assert(Number(p.format.duration)<=60 && Number(p.format.size)<=128*1024*1024);
  if(assessment.target==='mov')admitMovMetadata(p);
  // Shared sourcePolicy still owns exact clocks, SDR, native metadata, codec
  // parsing and stream relationships; these additional limits do not replace it.
}
class ProductRemuxOperations extends RemuxOperations {
  prepare(options) { admit(options.assessment,options.input);return super.prepare(options); }
}
class ProductRemuxService extends EncoderService {
  begin(phase) {
    assert(['preparing','running'].includes(phase), 'Only remux preparation/execution is admitted');
    assert(!this.remuxPhase, 'Previous operation has not settled');
    const signal = super.begin(phase);
    const controller = this.controller;
    this.remuxPhase = { signal, started: 0, live: 0, expires: performance.now() + EXECUTION_BUDGET_MS,
      timer: setTimeout(() => controller.abort(), EXECUTION_BUDGET_MS) };
    this.remuxPhase.timer.unref?.();
    return signal;
  }
  settleRemuxPhase() {
    if (!this.remuxPhase) return;
    assert.equal(this.remuxPhase.live, 0, 'Child owner remains unsettled');
    clearTimeout(this.remuxPhase.timer); this.remuxPhase = null;
  }
  async getCapabilities() {
    await this.remuxRequireCurrent();
    return { profiles: [], recipes: [], vendorProfiles: [], versions: {}, backendDiscovery: { profiles: [],
      notices: ['Internal MP4 stream-copy candidate only. Encoder/GPU discovery is not run. Native packaged acceptance remains separate.'] } };
  }
  async prepareSourceBatch(request, operation, native = null) {
    assert(operation === 'remux' && this.state.remuxSupport?.targets.includes(request.target) && native === null);
    this.requireIdle(); assert(!this.remuxPreparing); this.remuxPreparing = true;
    try { return await super.prepareSourceBatch(request, operation, native); }
    finally { try { this.settleRemuxPhase(); } finally { this.remuxPreparing = false; } }
  }
  async finishPreparationReceipt(options) {
    try { return await super.finishPreparationReceipt(options); } finally { this.settleRemuxPhase(); }
  }
  async prepareWithWorkers(context) { assert.equal(this.state.items.length, 1); return super.prepareWithWorkers(context); }
  startBatch(request) { assert(!this.remuxPreparing); assert.equal(this.state.items.length, 1); assert.equal(request.fileIds.length, 1); assert.equal(this.plan.operation, 'remux'); return super.startBatch(request); }
  async execute(selected, signal) { try { return await super.execute(selected, signal); } finally { this.settleRemuxPhase(); } }
}
async function createLinuxRemuxService({verifiedRuntime,stateDir,outputAccess,onChild}) {
  const qualification = loadRemuxQualification();
  environment(); assert(path.isAbsolute(stateDir)&&path.resolve(stateDir)===stateDir);
  const candidate=requireCandidateCalibrationRuntime(verifiedRuntime);
  let observer,service;
  try {
  assert.equal(candidate.runtimeIdentity,RUNTIME);
  assert.equal(createHash('sha256').update(JSON.stringify(candidate.dependencies)).digest('hex'),DEPENDENCIES);
  await candidate.requireCurrent();
  // Trusted shared collector builds rawvideo boundary decoding arguments. Do
  // not broaden candidate-calibration-runtime's generic video-codec allowance.
  // This private observer owns those calls and the existing shared remux group.
  let started=0,closed=false;
  const run=async(executable,args,options={})=>{
    environment();invocation(candidate.pins,executable,args,options,path.join(stateDir,'operation-evidence'));
    args=[...args];options={...options};const phase = service?.remuxPhase;
    assert(!closed && phase && !phase.signal.aborted && ++phase.started <= 32, 'Remux operation child ceiling');
    let remaining=Math.floor(phase.expires-performance.now());assert(remaining>0);
    started++;
    assert([candidate.pins.ffmpeg.path,candidate.pins.ffprobe.path].includes(executable));
    const signal = options.signal ? AbortSignal.any([phase.signal, options.signal]) : phase.signal;
    assert(!signal.aborted);
    await candidate.requireCurrent(signal);
    // Currentness can await filesystem reads. Re-admit this exact owner after
    // that await, before giving any executable a cancellation/budget lease.
    assert(!closed && service.remuxPhase === phase && !signal.aborted, 'Remux phase no longer current');
    remaining = Math.floor(phase.expires - performance.now()); assert(remaining > 0, 'Remux phase expired');
    let result,failure;
    phase.live++;
    try {result=await runTool(executable,args,{...options,signal,timeoutMs:Math.min(options.timeoutMs||120000,120000,remaining),onChild(c){onChild?.(c);options.onChild?.(c);}});} catch(e){failure=e;} finally { phase.live--; }
    try {await candidate.requireCurrent();} catch(e){if(failure)throw new AggregateError([failure,e],'Invocation and final integrity failed');throw e;}
    if(failure)throw failure;return result;
  };
  observer=new OperationRuntimeObserver({runtime:Object.fromEntries(Object.entries(candidate.pins).map(([k,p])=>[k,p.path])),pins:Object.fromEntries(Object.entries(candidate.pins).map(([k,p])=>[k,{sizeBytes:p.size,sha256:p.sha256}])),run});
  service=new ProductRemuxService({ffmpeg:candidate.pins.ffmpeg.path,ffprobe:candidate.pins.ffprobe.path,stateDir,outputAccess,run,inspectionWorkers:1,runtimeIdentity:RUNTIME,operationRuntime:observer,
    operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,operationStorage:()=>openEvidenceStorage({root:path.join(stateDir,'operation-evidence')}),
    remuxOperations:new ProductRemuxOperations({runtimeIdentity:RUNTIME,policyIdentity:qualification.policyIdentity,policies:remuxPolicies(qualification)})});
  service.remuxRequireCurrent = () => candidate.requireCurrent();
  service.state.remuxSupport = remuxSupport(qualification);
  const closeResources = service.closeOperationResources.bind(service);
  let closePromise;
  service.closeOperationResources = () => closePromise ||= (async () => {
    closed = true; const failures = [];
    try { await closeResources(); } catch (e) { failures.push(e); }
    try { await candidate.close(); } catch (e) { failures.push(e); }
    if (failures.length) throw new AggregateError(failures, 'Remux resource closure incomplete');
  })();
  return Object.freeze({ service, scope: 'internal-product-remux-not-release', counts: () => ({ started }),
    async close() { const failures = []; try { await service.closeOperationResources(); } catch(e) { failures.push(e); }
      try { await service.closeDiagnostics(); } catch(e) { failures.push(e); }
      if (failures.length) throw new AggregateError(failures, 'Remux closure incomplete'); } });

  } catch(primary) {
    const failures=[primary];
    try {await observer?.close();} catch(e){failures.push(e);}
    try {await candidate.close();} catch(e){failures.push(e);}
    try {await service?.closeDiagnostics();} catch(e){failures.push(e);}
    if(failures.length>1)throw new AggregateError(failures,'Construction and cleanup failed');
    throw primary;
  }
}
module.exports={createLinuxRemuxService,admit,invocation,remuxPolicies,remuxSupport};
