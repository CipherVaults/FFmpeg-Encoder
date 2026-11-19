'use strict';
// Off-main acquisition composition ONLY. Not a product catalog or entrypoint.
// A provisional route permits measuring the missing lifecycle. Its identifier
// must never be represented as accepted evidence or shipped qualification.
const assert = require('node:assert/strict');
const path = require('node:path');
const SOURCE_ROOT = require('./BINDING.json').sourceRoot;
assert(typeof SOURCE_ROOT === 'string' && path.isAbsolute(SOURCE_ROOT), 'Unbound private source');
const { createHash } = require('node:crypto');
const { EncoderService } = require(path.join(SOURCE_ROOT,'src/encoder-service.cjs'));
const { RemuxOperations } = require(path.join(SOURCE_ROOT,'src/remux-operation.cjs'));
const { getRemuxAssessmentSource } = require(path.join(SOURCE_ROOT,'src/remux-contract.cjs'));
const { OperationRuntimeObserver } = require(path.join(SOURCE_ROOT,'src/operation-runtime.cjs'));
const { openEvidenceStorage } = require(path.join(SOURCE_ROOT,'src/operation-storage.cjs'));
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require(path.join(SOURCE_ROOT,'src/operation-controls.cjs'));
const { runTool } = require(path.join(SOURCE_ROOT,'src/process-runner.cjs'));
const { requireCandidateCalibrationRuntime } = require(path.join(SOURCE_ROOT,'linux-blue/candidate-calibration-runtime.cjs'));
// One private driver process owns at most three services/four Prepare calls.
let totalRequested = 0;
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

function admit(assessment,input) {
  const p=getRemuxAssessmentSource(assessment), v=p.streams.filter(s=>s.codec_type==='video'), a=p.streams.filter(s=>s.codec_type==='audio');
  assert(assessment.inputFamily==='isobmff' && assessment.target==='matroska' && path.extname(input).toLowerCase()==='.mp4');
  assert(assessment.request.omissionRequestIds.length===0 && p.chapters.length===0 && p.streams.length===2 && v.length===1 && a.length===1);
  assert(v[0].codec_name==='h264' && v[0].pix_fmt==='yuv420p' && v[0].field_order==='progressive');
  assert(v[0].avg_frame_rate==='30/1' && v[0].r_frame_rate==='30/1', 'Private Matroska acquisition requires CFR30 metadata');
  assert(v[0].width<=1920 && v[0].height<=1080 && v[0].width>0 && v[0].height>0);
  assert(a[0].codec_name==='aac' && a[0].profile==='LC' && a[0].sample_fmt==='fltp' && a[0].sample_rate==='48000' && a[0].channels===2 && a[0].channel_layout==='stereo');
  assert(Number(p.format.duration)>0 && Number(p.format.duration)<=60 && Number(p.format.size)>0 && Number(p.format.size)<=128*1024*1024);
  // Shared sourcePolicy still owns exact clocks, SDR, native metadata, codec
  // parsing and stream relationships; these additional limits do not replace it.
}
class AcquisitionOperations extends RemuxOperations {
  prepare(options) { admit(options.assessment,options.input);return super.prepare(options); }
}
class AcquisitionService extends EncoderService {
  async prepareSourceBatch(request,operation,native=null) { assert(operation==='remux' && request.target==='matroska' && native===null);return super.prepareSourceBatch(request,operation,native); }
  async prepareWithWorkers(context) { assert.equal(this.state.items.length,1);return super.prepareWithWorkers(context); }
  startBatch(request) { assert.equal(this.state.items.length,1);assert.equal(request.fileIds.length,1);assert.equal(this.plan.operation,'remux');return super.startBatch(request); }
}
async function createAcquisition({verifiedRuntime,stateDir,outputAccess,onChild}) {
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
  let started=0,closed=false; const expires=performance.now()+600000;
  const run=async(executable,args,options={})=>{
    environment();invocation(candidate.pins,executable,args,options,path.join(stateDir,'operation-evidence'));
    args=[...args];options={...options};assert(!closed && ++started<=32 && ++totalRequested<=36,'Acquisition child ceiling');
    let remaining=Math.floor(expires-performance.now());assert(remaining>0);
    assert([candidate.pins.ffmpeg.path,candidate.pins.ffprobe.path].includes(executable));
    await candidate.requireCurrent(options.signal);
    assert(!closed && !options.signal?.aborted, 'Acquisition owner retired');
    remaining=Math.floor(expires-performance.now());assert(remaining>0, 'Acquisition deadline expired');
    let result,failure;
    try {result=await runTool(executable,args,{...options,timeoutMs:Math.min(options.timeoutMs||120000,120000,remaining),onChild(c){onChild?.(c);options.onChild?.(c);}});} catch(e){failure=e;}
    try {await candidate.requireCurrent();} catch(e){if(failure)throw new AggregateError([failure,e],'Invocation and final integrity failed');throw e;}
    if(failure)throw failure;return result;
  };
  observer=new OperationRuntimeObserver({runtime:Object.fromEntries(Object.entries(candidate.pins).map(([k,p])=>[k,p.path])),pins:Object.fromEntries(Object.entries(candidate.pins).map(([k,p])=>[k,{sizeBytes:p.size,sha256:p.sha256}])),run});
  service=new AcquisitionService({ffmpeg:candidate.pins.ffmpeg.path,ffprobe:candidate.pins.ffprobe.path,stateDir,outputAccess,run,inspectionWorkers:1,runtimeIdentity:RUNTIME,operationRuntime:observer,
    operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,operationStorage:()=>openEvidenceStorage({root:path.join(stateDir,'operation-evidence')}),
    remuxOperations:new AcquisitionOperations({runtimeIdentity:RUNTIME,policyIdentity:'unqualified-linux-matroska-lifecycle-acquisition',policies:[{id:'unqualified-isobmff-matroska-acquisition',inputFamily:'isobmff',target:'matroska',runtimeIdentity:RUNTIME,evidenceIds:['ACQUISITION-NOT-ACCEPTED-QUALIFICATION'],allowAncillary:false,allowRotation90:false,verificationMethod:'packet-identity-v1'}]})});
  return Object.freeze({service,scope:'acquisition-only-not-product-authority',async close(){closed=true;const failures=[];try{await service.closeOperationResources();}catch(e){failures.push(e);}try{await candidate.close();}catch(e){failures.push(e);}try{await service.closeDiagnostics();}catch(e){failures.push(e);}if(failures.length)throw new AggregateError(failures,'Acquisition closure incomplete');},counts:()=>({started})});
  } catch(primary) {
    const failures=[primary];
    try {await observer?.close();} catch(e){failures.push(e);}
    try {await candidate.close();} catch(e){failures.push(e);}
    try {await service?.closeDiagnostics();} catch(e){failures.push(e);}
    if(failures.length>1)throw new AggregateError(failures,'Construction and cleanup failed');
    throw primary;
  }
}
module.exports={createAcquisition,admit};
