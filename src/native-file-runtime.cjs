'use strict';
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), { createHash, randomUUID } = require('node:crypto');
const { NativeBackendService } = require('./native-backend-service.cjs');
const { NativeFileSourceOwner } = require('./native-file-source.cjs');
const { NativeFileRuntimePair } = require('./native-file-runtime-pair.cjs');
const { NativeFileToolOwner } = require('./native-file-tools.cjs');
const { readNativeFileContract } = require('./native-file-contract.cjs');
const { buildNativeFileCommand } = require('./native-file-command.cjs');
const { validateNativeSettings, capabilityKey } = require('./backend-adapters.cjs');
const { NativeObservationCollector } = require('./backend-observation.cjs');
const { WINDOWS_ADAPTER_QUERY } = require('./windows-adapters.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { createStage, sealStage, retainSealedStage, cleanupStage, markStageValidated, publishOutput, readPublishedOutputIdentity } = require('./outputs.cjs');
const { joinNativeFileOracle, validateNativeFileReference } = require('./native-file-oracle.cjs');
const { observeNativeFileTemplate, NATIVE_TEMPLATE_MAXIMUM_BYTES } = require('./native-file-template.cjs');
const { classifyMarker } = require('./provenance.cjs');
const DEFAULT_NATIVE_FILE_POLICIES = Object.freeze([]);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function record(v, keys, required=keys) { if (!v || typeof v!=='object' || ![Object.prototype,null].includes(Object.getPrototypeOf(v))) fail('INVALID_NATIVE_FILE_RUNTIME','Inert main-owned runtime record required.'); const d=Object.getOwnPropertyDescriptors(v); if (required.some(k=>!Object.hasOwn(d,k)) || Reflect.ownKeys(d).some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value'))) fail('INVALID_NATIVE_FILE_RUNTIME','Unknown, missing or accessor runtime fields.'); }
function integer(v,max) { if(!Number.isSafeInteger(v)||v<1||v>max)fail('INVALID_NATIVE_FILE_RUNTIME','Explicit finite native file budgets required.');return v; }
function policy(v) {
  record(v,['id','contractId','runtimeIdentity','sourceSha256','sourceProbeFingerprint','nativeCellKey','profileId','settings','budget','evidenceIds','reference'],['id','contractId','runtimeIdentity','sourceSha256','sourceProbeFingerprint','nativeCellKey','profileId','settings','budget','evidenceIds']);
  if(typeof v.id!=='string'||!/^[a-zA-Z0-9_.-]{1,128}$/.test(v.id)||v.contractId!=='native-file-h264-bt709-full-v1'
      || !['runtimeIdentity','sourceSha256','sourceProbeFingerprint'].every(k=>typeof v[k]==='string'&&/^[a-f0-9]{64}$/.test(v[k]))
      ||typeof v.nativeCellKey!=='string'||!/^native-v1:[a-f0-9]{64}$/.test(v.nativeCellKey)||!['h264-qsv','h264-amf'].includes(v.profileId)) fail('INVALID_NATIVE_FILE_RUNTIME','Exact finite file policy bindings required.');
  const settings=validateNativeSettings(v.profileId,v.settings), b=v.budget;record(b,['maximumChildren','maximumPipeBytes','deadlineMs','maximumStageBytes','metadataBytes','nativeStderrBytes']);
  const budget={maximumChildren:integer(b.maximumChildren,64),maximumPipeBytes:integer(b.maximumPipeBytes,3*1024**3),deadlineMs:integer(b.deadlineMs,1800000),maximumStageBytes:integer(b.maximumStageBytes,1024**3),metadataBytes:integer(b.metadataBytes,16*1024**2),nativeStderrBytes:integer(b.nativeStderrBytes,262144)};
  if(!Array.isArray(v.evidenceIds)||v.evidenceIds.length<1||v.evidenceIds.length>16||Reflect.ownKeys(v.evidenceIds).length!==v.evidenceIds.length+1)fail('INVALID_NATIVE_FILE_RUNTIME','Explicit trusted policy evidence references required.');
  for(let i=0;i<v.evidenceIds.length;i++){const d=Object.getOwnPropertyDescriptor(v.evidenceIds,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!/^[a-zA-Z0-9_.:-]{1,128}$/.test(d.value))fail('INVALID_NATIVE_FILE_RUNTIME','Invalid file policy evidence reference.');}
  const reference=v.reference===undefined?null:validateNativeFileReference(v.reference);
  if(reference&&(reference.contractId!==v.contractId||reference.source.fileSha256!==v.sourceSha256))fail('INVALID_NATIVE_FILE_RUNTIME','The policy reference must describe this exact contract and source.');
  return freeze({...v,settings,budget,evidenceIds:v.evidenceIds.slice(),reference});
}
const objectStamp = s => ({dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)});
// Dense bounded catalog of exact rows, shared by the owner and main's controls.
function readNativeFilePolicies(rows) {
  if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length>32||Reflect.ownKeys(rows).length!==rows.length+1)fail('INVALID_NATIVE_FILE_RUNTIME','Bounded dense main-owned policy catalog required.');
  const policies=[];for(let i=0;i<rows.length;i++){const d=Object.getOwnPropertyDescriptor(rows,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_NATIVE_FILE_RUNTIME','Policy catalog cannot contain accessors/holes.');policies.push(policy(d.value));}
  if(new Set(policies.map(p=>p.id)).size!==policies.length)fail('INVALID_NATIVE_FILE_RUNTIME','Duplicate native file policies.');
  return policies;
}
// Production jobs (record 37 R3/R4): main's destination recheck is mandatory
// for publication, and the first owned-root stamp must equal main's lease pin.
const PRODUCTION_JOBS = new WeakMap();

// R1 (record 37): ordered admission reasons shared by prepare and the service's
// pure readiness check. No I/O, lease or owner mutation. The first reason is
// exactly the code prepare throws; the split around the selection keeps the
// original order (requireFileSelection throws its own code in between).
function preSelectionReasons(policies,contract,probe){
  const reasons=[];
  if(!policies.length)reasons.push(['NATIVE_FILE_POLICY_REQUIRED','No native source-file policy is qualified; no source/runtime/discovery work was started.']);
  if(classifyMarker(probe).kind!=='unmarked')reasons.push(['NATIVE_FILE_SOURCE_PERMISSION_REQUIRED','Generated/suspicious native inputs require a separate genuine source-admission owner; none is wired here.']);
  if(contract.request.profileId==='h264-amf')reasons.push(['AMF_EFFECTIVE_PROPERTIES_UNOBSERVED','AMF cannot start a file while its same-component producer is absent.']);
  return reasons;
}
function postSelectionReasons(policies,pins,identity,contract,selection){
  const reasons=[],request=contract.request;
  if(['ffmpeg','ffprobe'].some(name=>pins[name].sha256!==selection.policy[name+'Sha256']))reasons.push(['NATIVE_FILE_SELECTION_STALE','The fixed binary pair differs from the native selection before any file child.']);
  if(selection.request.profileId!==request.profileId||selection.request.bitDepth!==request.bitDepth||!same(selection.request.settings,request.settings))reasons.push(['NATIVE_FILE_SELECTION_STALE','The original sample selection does not match this file request.']);
  const matching=policies.filter(p=>p.contractId===contract.id&&p.runtimeIdentity===identity&&p.sourceProbeFingerprint===contract.sourceProbeFingerprint&&p.nativeCellKey===capabilityKey(selection.policy)&&p.profileId===request.profileId&&same(p.settings,request.settings));
  if(matching.length!==1)reasons.push(['NATIVE_FILE_POLICY_REQUIRED','No unique exact trusted native file policy applies.']);
  return {reasons,matching};
}
const throwFirst=reasons=>{if(reasons.length)fail(reasons[0][0],reasons[0][1]);};
function assessNativeFileAdmission(options){
  record(options,['policies','runtime','contract','selection'],['runtime','contract']);
  const rows=(options.policies===undefined?DEFAULT_NATIVE_FILE_POLICIES:options.policies);
  if(!Array.isArray(rows)||rows.length>32)fail('INVALID_NATIVE_FILE_RUNTIME','Bounded main-owned policy catalog required.');
  const policies=rows.map(policy),pair=new NativeFileRuntimePair(options.runtime),{contract,probe}=readNativeFileContract(options.contract);
  const reasons=preSelectionReasons(policies,contract,probe);let matching=[];
  if(options.selection===undefined||options.selection===null)reasons.push(['NATIVE_SELECTION_REQUIRED','Choose and check a native device and exact settings first.']);
  else{const post=postSelectionReasons(policies,{ffmpeg:pair.pin('ffmpeg'),ffprobe:pair.pin('ffprobe')},pair.identity(),contract,options.selection);reasons.push(...post.reasons);matching=post.matching;}
  const reasonCodes=[...new Set(reasons.map(r=>r[0]))],chosen=matching.length===1?matching[0]:null;
  return freeze({schema:1,admissible:reasonCodes.length===0,reasonCodes,policyId:chosen?chosen.id:null,referencePresent:Boolean(chosen?.reference),executionAuthority:'none'});
}

// Native-only runtime/evidence owner. An empty production file policy catalog
// refuses before source/tool hashes, stage creation, discovery or child work.
// Injected main policy rows test plumbing; they do not qualify source/hardware.
class NativeFileRuntimeOwner {
  #native; #pair; #source = new NativeFileSourceOwner(); #policies; #root; #slotProvider; #run;
  #tokens = new WeakMap(); #session = null; #active = null; #closed = false; #closing = null;
  #collector = new NativeObservationCollector(); #effective = new WeakMap(); #checked = new WeakMap();
  constructor(options) {
    record(options,['runtime','nativeSelections','ownedRoot','acquireMediaSlot','policies','run'],['runtime','nativeSelections','ownedRoot','acquireMediaSlot']);
    if(!(options.nativeSelections instanceof NativeBackendService)||typeof options.acquireMediaSlot!=='function'||typeof options.ownedRoot!=='string'||!path.isAbsolute(options.ownedRoot)
      ||options.ownedRoot.length>32767||/[\x00-\x1f\x7f]/.test(options.ownedRoot)||options.run!==undefined&&typeof options.run!=='function')fail('INVALID_NATIVE_FILE_RUNTIME','Genuine native selection owner, fixed owned root and media lease provider required.');
    this.#policies=readNativeFilePolicies(options.policies===undefined?DEFAULT_NATIVE_FILE_POLICIES:options.policies);
    this.#pair=new NativeFileRuntimePair(options.runtime);this.#native=options.nativeSelections;this.#root=path.resolve(options.ownedRoot);this.#slotProvider=options.acquireMediaSlot;this.#run=options.run;
  }
  snapshot() { const s=this.#session;return freeze({schema:1,policyCount:this.#policies.length,busy:Boolean(this.#active),admissionClosed:this.#closed,phase:s?.phase||'idle',sessionId:s?.id||null,
    runtime:this.#pair.snapshot(),tools:s?.tools?.snapshot()||null,sourceHeld:Boolean(s?.source),leaseHeld:Boolean(s?.slot),leaseOwnershipUnknown:Boolean(s?.leaseUnknown),stageRetained:s?.cleanup?.retained??Boolean(s?.stage),publication:s?.publication||'not-attempted',stageState:s?.stageState||'none',fileExecutionReady:false,executionAuthority:'none',qualification:'unqualified-runtime-plumbing'}); }
  #entry(token) { const e=token&&typeof token==='object'&&this.#tokens.get(token);if(!e||e!==this.#session||e.failed||e.closed)fail('NATIVE_FILE_SESSION_STALE','Use this owner\'s original current file session.');return e; }
  async #work(signal,action) { if(signal!==undefined&&!(signal instanceof AbortSignal))fail('INVALID_NATIVE_FILE_RUNTIME','AbortSignal required.');if(signal?.aborted)fail('CANCELLED','Native file action cancelled before admission.');if(this.#closed)fail('NATIVE_FILE_RUNTIME_CLOSED','Native file admission is closed.');if(this.#active)fail('NATIVE_FILE_RUNTIME_BUSY','Wait for the previous native file action to drain.');const controller=new AbortController(),linked=signal?AbortSignal.any([signal,controller.signal]):controller.signal,active={controller,done:null};this.#active=active;active.done=Promise.resolve().then(()=>{if(linked.aborted)fail('CANCELLED','Native file action cancelled before work.');return action(linked);});try{return await active.done;}finally{if(this.#active===active)this.#active=null;} }
  async #rootCurrent(e) { let canonical,stat;try{canonical=await assertOrdinaryPath(this.#root,'directory');stat=await fsp.lstat(canonical,{bigint:true});}catch{fail('NATIVE_FILE_STAGE_CHANGED','The owned root changed.');}
    const current=objectStamp(stat),pin=!e.rootStamp&&PRODUCTION_JOBS.get(this)?.ownedRootPin,pinned=pin&&pin();
    if(canonical!==this.#root||!stat.isDirectory()||stat.isSymbolicLink()||e.rootStamp&&!same(e.rootStamp,current)||pin&&!(pinned&&['dev','ino','birthtimeNs'].every(k=>pinned[k]===current[k])))fail('NATIVE_FILE_STAGE_CHANGED','The owned root changed.');e.rootStamp||=current; }
  async #stageCurrent(e,empty=false) { await this.#rootCurrent(e);const canonical=await assertOrdinaryPath(e.stage.directory,'directory'),stat=await fsp.lstat(canonical,{bigint:true});if(canonical!==e.stage.directory||!same(e.stageStamp,objectStamp(stat)))fail('NATIVE_FILE_STAGE_CHANGED','The owned stage directory changed.');if(empty){try{await fsp.lstat(e.stage.file);fail('NATIVE_FILE_STAGE_CHANGED','The native stage is already occupied.');}catch(error){if(error.code!=='ENOENT')throw error;}}else{await sealStage(e.stage);if(e.stageState==='unsealed')e.stageState='sealed';await retainSealedStage(e.stage,'Native file output retained pending complete independent validation and file qualification.');const s=await fsp.lstat(e.stage.file,{bigint:true});if(s.size>BigInt(e.policy.budget.maximumStageBytes))fail('NATIVE_FILE_STAGE_LIMIT','The observed stage exceeds its admitted size; it is retained.');} }
  #selectionCurrent(e) { const selected=this.#native.requireFileSelection(e.selection);if(selected!==e.selection||['ffmpeg','ffprobe'].some(name=>this.#pair.pin(name).sha256!==selected.policy[name+'Sha256']))fail('NATIVE_FILE_SELECTION_STALE','Both held runtime pins must match the genuine current native selection.');return selected; }
  async #tool(e,executable,argv,options,signal) {
    await this.#pair.requireCurrent({signal,invocation:true});
    const receipt=await e.tools.invoke(executable,argv,{signal,timeoutMs:Math.min(options.timeoutMs||e.policy.budget.deadlineMs,e.policy.budget.deadlineMs),stdoutLimit:options.stdoutLimit||e.policy.budget.metadataBytes,stderrLimit:options.stderrLimit||e.policy.budget.nativeStderrBytes,
      ...(options.onStdoutChunk?{onStdoutChunk:options.onStdoutChunk}:{}),...(options.onProgress?{onProgress:options.onProgress}:{}),...(options.onOutputBytes?{onOutputBytes:options.onOutputBytes}:{})});
    await this.#pair.requireCurrent({signal});return {receipt,observed:e.tools.requireReceipt(receipt)};
  }
  // Shared discovery code records non-cancellation errors as an incomplete
  // environment and commits it to the shared registry. A refusal raised by this
  // owner (budget, stale pins, allowlist) is not an environment fact, so it is
  // surfaced to discovery as a cancellation and the real refusal is rethrown.
  async #observe(e,signal) {
    let refusal=null;
    const run=async(executable,argv,options={})=>{try{
      if(options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail('INVALID_NATIVE_FILE_RUNTIME','Discovery must pass an AbortSignal.');
      const combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
      const encoders=executable===this.#pair.file('ffmpeg')&&same(argv,['-hide_banner','-encoders']);
      const root=process.env.SystemRoot||process.env.WINDIR,helper=root&&path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
      const adapters=helper&&executable.toLowerCase()===helper.toLowerCase()&&same(argv,['-NoLogo','-NoProfile','-NonInteractive','-Command',WINDOWS_ADAPTER_QUERY]);
      if(!encoders&&!adapters)fail('NATIVE_FILE_DISCOVERY_COMMAND','Only the fixed native inventory commands are allowed.');
      const {observed}=await this.#tool(e,executable,argv,{timeoutMs:Math.min(options.timeoutMs||20000,20000),stdoutLimit:Math.min(options.stdoutLimit||e.policy.budget.metadataBytes,e.policy.budget.metadataBytes),stderrLimit:Math.min(options.stderrLimit||8192,8192)},combined);
      return {stdout:observed.stdout,stderr:observed.stderr,stderrCapture:observed.stderrCapture,exitCode:0};
    }catch(error){if(error.code==='CANCELLED'||signal.aborted||options.signal?.aborted)throw error;refusal??=error;throw Object.assign(new Error('Native file discovery stopped by its owner.'),{code:'CANCELLED',cause:error});}};
    let observed;
    try{observed=await this.#native.observeFileSelection(e.selection,{signal,run});}catch(error){throw refusal||error;}
    if(refusal)throw refusal;
    if(observed.selection!==e.selection)fail('NATIVE_FILE_SELECTION_STALE','Discovery did not preserve the original native selection.');
    return observed.environment;
  }
  async prepare(options,{signal}={}) {
    record(options,['contract','input','selection','outputId','generationDescription']);
    return this.#work(signal,async linked=>{
      if(this.#session)fail('NATIVE_FILE_RUNTIME_BUSY','Close the current native file session before replacing it.');
      const {contract,probe}=readNativeFileContract(options.contract);
      throwFirst(preSelectionReasons(this.#policies,contract,probe));
      const selection=this.#native.requireFileSelection(options.selection);
      const {reasons,matching}=postSelectionReasons(this.#policies,{ffmpeg:this.#pair.pin('ffmpeg'),ffprobe:this.#pair.pin('ffprobe')},this.#pair.identity(),contract,selection);
      throwFirst(reasons);
      const e={id:randomUUID(),policy:matching[0],selection,contract,phase:'preparing',source:null,slot:null,stage:null,stageState:'none',publication:'not-attempted',failed:false,closed:false,evidence:new Map()};this.#session=e;
      try {
        const slot=await this.#slotProvider({signal:linked,purpose:'native-file-runtime'});if(!slot||typeof slot.release!=='function'){e.leaseUnknown=true;fail('NATIVE_FILE_LEASE_REQUIRED','The main scheduler did not return its owned media lease.');}e.slot=slot;
        if(linked.aborted)fail('CANCELLED','Native preparation cancelled after lease admission.');
        // Production jobs: main's lease-time folder checks run while this owner
        // already holds the slot, so a refusal releases it under #dispose's rules.
        const admit=PRODUCTION_JOBS.get(this)?.admitLease;if(admit)await admit({signal:linked});
        // R4: stamp the owned root right after the lease, before long source/pair hashing.
        await this.#rootCurrent(e);
        e.source=await this.#source.seal(options.input,{signal:linked});
        if(e.source.content.digest!==e.policy.sourceSha256||e.source.content.bytes!==contract.sourceFacts.sourceBytes)fail('NATIVE_FILE_SOURCE_UNQUALIFIED','Complete held source does not match this exact file policy/contract.');
        await this.#pair.open({signal:linked});
        // Lease queueing and complete source/pair hashing must not consume the child deadline.
        e.tools=new NativeFileToolOwner({maximumChildren:e.policy.budget.maximumChildren,maximumBytes:e.policy.budget.maximumPipeBytes,deadlineMs:e.policy.budget.deadlineMs,...(this.#run?{run:this.#run}:{})});
        await this.#rootCurrent(e);e.before=await this.#observe(e,linked);await this.#source.requireCurrent(e.source,{signal:linked});
        e.stage=await createStage(this.#root);e.stageState='unsealed';e.stageStamp=objectStamp(await fsp.lstat(e.stage.directory,{bigint:true}));await this.#stageCurrent(e,true);
        e.command=buildNativeFileCommand({contract,input:e.source.file,output:e.stage.file,device:selection.policy.device,outputId:options.outputId,generationDescription:options.generationDescription});
        const token=Object.freeze({schema:1,sessionId:e.id});e.token=token;this.#tokens.set(token,e);e.phase='prepared-runtime';return token;
      } catch(error){e.failed=true;e.phase='failed';this.#closed=true;if(error.sourceCloseFailure)e.sourceUnsettled=true;try{await this.#dispose(e);}catch(closeError){error.nativeCloseFailure=closeError;}throw error;}
    });
  }
  describe(token){const e=this.#entry(token);return freeze({sessionId:e.id,phase:e.phase,command:e.command,qualification:'unqualified-runtime-plumbing',fileExecutionReady:false,executionAuthority:'none'});}
  async encode(token,{signal,onProgress}={}) {
    return this.#work(signal,async linked=>{const e=this.#entry(token);if(e.phase!=='prepared-runtime')fail('NATIVE_FILE_PHASE','A native session can execute its canonical encoder only once.');e.phase='encoding';
      try{this.#selectionCurrent(e);await this.#source.requireCurrent(e.source,{signal:linked});await this.#stageCurrent(e,true);e.before=await this.#observe(e,linked);await this.#source.requireCurrent(e.source,{signal:linked});
        const {receipt,observed}=await this.#tool(e,this.#pair.file('ffmpeg'),e.command.argv,{stdoutLimit:e.policy.budget.metadataBytes,stderrLimit:e.policy.budget.nativeStderrBytes,timeoutMs:e.policy.budget.deadlineMs,onProgress},linked);
        e.encodeReceipt=receipt;await this.#source.beginCompletion(e.source,{signal:linked});await this.#stageCurrent(e);await retainSealedStage(e.stage,'Native file output retained pending complete independent validation and file qualification.');
        const source=freeze({file:e.source.file,sha256:e.source.content.digest}),invocation=freeze({kind:'encode',invocationId:observed.invocationId,executableSha256:this.#pair.pin('ffmpeg').sha256,argv:observed.argv,argvSha256:observed.argvSha256,close:observed.close});
        const plan=freeze({invocationId:invocation.invocationId,policy:e.selection.policy,settings:e.command.settings,contribution:e.command.contribution,contributionHash:hash({contract:e.contract,contribution:e.command.contribution})});
        const capture=this.#collector.captureClosed({plan,before:e.before,invocation,source,stderr:observed.stderr,stderrCapture:observed.stderrCapture});
        const after=await this.#observe(e,linked);await this.#source.requireCompletionSource(e.source,{signal:linked});await this.#stageCurrent(e);
        const effective=this.#collector.complete(capture,{plan,invocation,source,after});
        const result=freeze({schema:1,kind:'native-file-effective-observation',sessionId:e.id,sourceSha256:source.sha256,outputId:e.command.outputId,observation:effective,qualification:'same-child-runtime-only; complete-file-validation-required',fileExecutionReady:false,executionAuthority:'none'});
        this.#effective.set(result,e);e.effective=result;e.phase='evidence';return result;
      }catch(error){e.failed=true;e.phase='failed';throw error;}
    });
  }
  requireEffective(token,receipt){const e=this.#entry(token);if(this.#effective.get(receipt)!==e||receipt!==e.effective)fail('NATIVE_FILE_EVIDENCE_UNOWNED','Use this session\'s original same-child native observation.');return receipt;}
  requireEvidence(token,kind,receipt){const e=this.#entry(token),owned=e.evidence.get(kind);if(!owned||owned!==receipt)fail('NATIVE_FILE_EVIDENCE_UNOWNED','Use this session\'s original evidence for this exact role.');e.tools.requireReceipt(owned.receipt);return owned;}
  async collect(token,kind,{signal,onStdoutChunk}={}) {
    return this.#work(signal,async linked=>{const e=this.#entry(token);if(!['source-metadata','output-metadata','source-raw','output-raw'].includes(kind)||e.evidence.has(kind))fail('NATIVE_FILE_EVIDENCE_REQUEST','Use each finite complete evidence role once.');
      if(e.phase!=='evidence'&&!(e.phase==='prepared-runtime'&&kind.startsWith('source-')))fail('NATIVE_FILE_PHASE','Evidence role does not match this native lifecycle phase.');
      const output=kind.startsWith('output-'),raw=kind.endsWith('-raw'),file=output?e.stage.file:e.source.file,index=output?0:e.contract.expectedOutput.sourceVideoIndex;
      if(raw&&typeof onStdoutChunk!=='function'||!raw&&onStdoutChunk!==undefined)fail('NATIVE_FILE_EVIDENCE_REQUEST','Raw evidence requires its bounded streaming sink only.');
      try{this.#selectionCurrent(e);if(e.phase==='prepared-runtime')await this.#source.requireCurrent(e.source,{signal:linked});else await this.#source.requireCompletionSource(e.source,{signal:linked});if(output)await this.#stageCurrent(e);
        const argv=raw?['-hide_banner','-nostdin','-loglevel','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-noautorotate','-i',file,'-map',`0:${index}`,'-an','-sn','-dn','-c:v','rawvideo','-pix_fmt','+yuv420p','-fps_mode','passthrough','-f','rawvideo','pipe:1']
          :['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm','-show_format','-show_streams','-show_programs','-show_stream_groups','-show_chapters','-show_frames','-of','json',file];
        const expectedBytes=Number(e.contract.expectedOutput.declaredFrames)*1280*720*3/2;
        const {receipt,observed}=await this.#tool(e,this.#pair.file(raw?'ffmpeg':'ffprobe'),argv,{timeoutMs:e.policy.budget.deadlineMs,stdoutLimit:raw?expectedBytes:e.policy.budget.metadataBytes,stderrLimit:e.policy.budget.nativeStderrBytes,...(raw?{onStdoutChunk}:{})},linked);
        if(raw&&observed.stdoutBytes!==expectedBytes)fail('NATIVE_FILE_FRAME_BYTES','The complete native decoded frame byte count differs.');
        if(e.phase==='prepared-runtime')await this.#source.requireCurrent(e.source,{signal:linked});else await this.#source.requireCompletionSource(e.source,{signal:linked});if(output)await this.#stageCurrent(e);
        const result=freeze({kind,receipt,bytes:observed.stdoutBytes,sha256:observed.stdoutSha256,text:raw?null:observed.stdout,evidenceComplete:true,validation:'not-performed'});e.evidence.set(kind,result);return result;
      }catch(error){e.failed=true;e.phase='failed';throw error;}
    });
  }
  // Exact-reference validation. Consumes only this session's original evidence
  // roles (re-checked through the tool owner) and a fresh complete template of
  // the sealed stage; any mismatch fails the session and the output stays retained.
  async validate(token,{signal}={}) {
    return this.#work(signal,async linked=>{const e=this.#entry(token);
      if(e.phase!=='evidence'||!e.effective)fail('NATIVE_FILE_PHASE','Validate only after the encoder and its same-child observation.');
      if(!e.policy.reference)fail('NATIVE_FILE_REFERENCE_REQUIRED','No independently qualified reference exists for this file policy; the output stays retained and unpublished.');
      const roles={};for(const kind of ['source-metadata','output-metadata','source-raw','output-raw']){const owned=e.evidence.get(kind);if(!owned)fail('NATIVE_FILE_EVIDENCE_REQUEST','All four complete evidence roles are required before validation.');e.tools.requireReceipt(owned.receipt);roles[kind]=owned;}
      try{this.#selectionCurrent(e);await this.#source.requireCompletionSource(e.source,{signal:linked});await this.#stageCurrent(e);
        const template=await observeNativeFileTemplate(e.stage.file,e.command,{signal:linked,maximumBytes:Math.min(e.policy.budget.maximumStageBytes,NATIVE_TEMPLATE_MAXIMUM_BYTES),deadlineAt:Date.now()+e.policy.budget.deadlineMs});
        await this.#stageCurrent(e);
        const checks=joinNativeFileOracle({reference:e.policy.reference,contract:e.contract,command:e.command,sourceSha256:e.source.content.digest,roles,template});
        await markStageValidated(e.stage);e.stageState='validated';
        const receipt=freeze({schema:1,kind:'native-file-output-checked',sessionId:e.id,referenceId:checks.referenceId,outputSha256:template.sha256,checks:checks.checks,
          qualification:'exact-reference-member; final source assessment and publication pending',fileExecutionReady:false,executionAuthority:'none'});
        this.#checked.set(receipt,e);e.checked=receipt;e.template=template;e.phase='output-checked';return receipt;
      }catch(error){e.failed=true;e.phase='failed';throw error;}
    });
  }
  // Main-supplied destination: an ordinary drive-qualified .mkv path in an
  // existing ordinary directory. No UNC/device/ADS/reserved names.
  async #destination(value) {
    if(typeof value!=='string'||value.length>32767||/[\x00-\x1f\x7f"<>|?*]/.test(value)||!/^[A-Za-z]:\\/.test(value)||value.slice(2).includes(':')||/[. ]$/.test(value)
      ||path.win32.extname(value).toLowerCase()!=='.mkv'||/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(path.win32.basename(value)))fail('NATIVE_FILE_DESTINATION','A local drive-qualified .mkv destination is required.');
    const resolved=path.win32.resolve(value);if(resolved.toLowerCase().startsWith(this.#root.toLowerCase()+path.sep))fail('NATIVE_FILE_DESTINATION','The destination cannot be inside the owned staging root.');
    try{const directory=await assertOrdinaryPath(path.win32.dirname(resolved),'directory'),stat=await fsp.lstat(directory,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('not an ordinary folder');
      return {file:path.win32.join(directory,path.win32.basename(resolved)),folder:objectStamp(stat)};}catch(error){fail('NATIVE_FILE_DESTINATION','The destination folder is not an ordinary existing directory.');}
  }
  // Publication after exact validation: final complete-source assessment, its
  // publication-time currentness, main's destination recheck (R3) and a fresh
  // canonical destination, no-overwrite publication, then a full SHA of the
  // published name joined to the validated template bytes.
  async publish(token,receipt,options={}) {
    record(options,['destination','signal','requireDestinationCurrent'],['destination']);
    const check=options.requireDestinationCurrent;
    if(check!==undefined&&typeof check!=='function'||check===undefined&&PRODUCTION_JOBS.has(this))fail('INVALID_NATIVE_FILE_RUNTIME','Main\'s destination recheck is required for publication.');
    return this.#work(options.signal,async linked=>{const e=this.#entry(token);
      if(e.phase!=='output-checked'||this.#checked.get(receipt)!==e||receipt!==e.checked)fail('NATIVE_FILE_EVIDENCE_UNOWNED','Use this session\'s original output-checked receipt.');
      const target=await this.#destination(options.destination),destination=target.file;
      try{this.#selectionCurrent(e);
        const assessment=await this.#source.assessCompleted(e.source,{signal:linked});e.phase='source-assessed';
        await this.#source.requirePublicationCurrent(assessment,{signal:linked});this.#selectionCurrent(e);
        // R3: the long source assessment is over; recheck the destination now,
        // including the folder object first seen, not only the path text.
        if(check){await check();if(linked.aborted)fail('CANCELLED','Native publication cancelled before the link.');}
        const again=await this.#destination(options.destination);
        if(again.file!==destination||!same(again.folder,target.folder))fail('NATIVE_FILE_DESTINATION','The destination folder changed before publication.');
        e.publication='attempted';
        const published=await publishOutput(e.stage,destination,{signal:linked});
        e.publication=published?'committed':'collision';
        if(!published){e.phase='collision';return freeze({schema:1,kind:'native-file-publication',published:false,reason:'DESTINATION_EXISTS',outputRetained:true,executionAuthority:'none'});}
        // R2: keep the checked publication identity so main can record provenance.
        const identity=await readPublishedOutputIdentity(e.stage);
        const hash=createHash('sha256');let bytes=0;
        for await(const chunk of fs.createReadStream(destination,{highWaterMark:1024**2,signal:linked})){bytes+=chunk.length;if(bytes>e.template.bytes)fail('NATIVE_FILE_PUBLISHED_CHANGED','The published output grew beyond its validated length.');hash.update(chunk);}
        const sha256=hash.digest('hex');if(bytes!==e.template.bytes||sha256!==e.template.sha256)fail('NATIVE_FILE_PUBLISHED_CHANGED','The published bytes differ from the validated output.');
        e.phase='published';e.publication='verified';
        return freeze({schema:1,kind:'native-file-publication',published:true,destination,sha256,bytes,identity,referenceId:receipt.referenceId,sourceDisposition:assessment.assessment.kind,
          warnings:assessment.assessment.kind==='ctime-only'?['SOURCE_CTIME_CHANGED_DURING_JOB']:[],executionAuthority:'none'});
      }catch(error){e.failed=true;e.phase='failed';throw error;}
    });
  }
  async #dispose(e) {
    const errors=[];const step=async fn=>{try{await fn();}catch(error){errors.push(error);}};
    await step(()=>e.tools?.close());
    if(e.leaseUnknown)errors.push(Object.assign(new Error('The media lease provider did not establish a releasable owner.'),{code:'NATIVE_FILE_LEASE_REQUIRED'}));
    if(e.tools?.snapshot().busy||e.tools?.snapshot().ownershipUnknown)errors.push(Object.assign(new Error('Native child ownership remains unknown.'),{code:'NATIVE_FILE_UNSETTLED'}));
    if(e.sourceUnsettled||this.#source.hasUnsettledHandles())errors.push(Object.assign(new Error('A source read handle did not close; it stays held.'),{code:'NATIVE_FILE_SOURCE_UNSETTLED'}));
    if(errors.length)throw new AggregateError(errors,'Native child ownership is unconfirmed; source/tool handles and lease remain retained.');
    await Promise.all([step(async()=>{if(e.source){await this.#source.release(e.source);e.source=null;}}),step(()=>this.#pair.close())]);
    if(!errors.length){await step(async()=>{if(e.stage)e.cleanup=await cleanupStage(e.stage);});}
    if(!errors.length&&e.slot)await step(async()=>{await e.slot.release();e.slot=null;});
    if(errors.length)throw new AggregateError(errors,'Native runtime closure is incomplete; its media lease remains retained.');
    e.closed=true;e.phase='closed';
  }
  async close() { if(this.#closing)return this.#closing;this.#closed=true;const closing=Promise.resolve().then(async()=>{const active=this.#active;if(active){active.controller.abort();await active.done.catch(()=>{});}if(this.#session&&!this.#session.closed)await this.#dispose(this.#session);await this.#source.close();await this.#pair.close();return this.snapshot();});
    // A transient failure after the child/EOF/sink barrier (for example stage
    // rmdir EBUSY or a slot release rejection) may be retried by a later close();
    // unknown child or lease ownership stays a permanent hard quarantine.
    this.#closing=closing.catch(error=>{const s=this.#session,tools=s?.tools?.snapshot();if(!s?.leaseUnknown&&!tools?.busy&&!tools?.ownershipUnknown&&!s?.sourceUnsettled&&!this.#source.hasUnsettledHandles())this.#closing=null;throw error;});return this.#closing; }
}
function createNativeFileRuntimeJob(options,binding){
  record(binding,['ownedRootPin','admitLease']);if(typeof binding.ownedRootPin!=='function'||typeof binding.admitLease!=='function')fail('INVALID_NATIVE_FILE_RUNTIME','Main\'s owned-root pin and lease-time checks are required for a production job.');
  const owner=new NativeFileRuntimeOwner(options);PRODUCTION_JOBS.set(owner,Object.freeze({ownedRootPin:binding.ownedRootPin,admitLease:binding.admitLease}));return owner;
}
module.exports={NativeFileRuntimeOwner,DEFAULT_NATIVE_FILE_POLICIES,assessNativeFileAdmission,readNativeFilePolicies,createNativeFileRuntimeJob};
