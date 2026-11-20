'use strict';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {EncoderService}=require('../src/encoder-service.cjs');
const {ToolError}=require('../src/process-runner.cjs');
const {discoverMp3Diagnostic, inspectMp3Diagnostic, MP3_NOTICE}=require('./product-mp3-prepare.cjs');
const {installProductTwoAac,composed}=require('./product-two-aac-owner.cjs');
const {isProportionalFamilySelection}=require('../src/operation-family.cjs');
const {fingerprintEncodeSource}=require('../src/encode-operation.cjs');
const {OutputAccess}=require('../src/output-access.cjs');
const {RemuxOperations}=require('../src/remux-operation.cjs');
const {getRemuxAssessmentSource}=require('../src/remux-contract.cjs');
const {remuxProbeFingerprint}=require('../src/remux-validation.cjs');
const {EVIDENCE_BUDGET,EXECUTION_BUDGET_MS}=require('../src/operation-controls.cjs');
const {openEvidenceStorage}=require('../src/operation-storage.cjs');
const {createProductSelector}=require('./product-linux-service.cjs');
const {loadQualification}=require('./product-linux-qualification.cjs');
const {loadRemuxQualification}=require('./product-linux-remux-qualification.cjs');
const {admit:admitRemux,remuxPolicies,remuxSupport}=require('./product-linux-remux-service.cjs');
const {PROFILES,validateSettings}=require('../src/media.cjs');
const {POLICY,admitInput}=require('./ordinary-cpu-policy.cjs');
const AV1=require('./av1-cpu-policy.cjs');
const ordinaryRoute=route=>route==='ordinary'||route==='av1-ordinary';
const av1Profile=PROFILES.find(p=>p.id==='av1-cpu');
const AV1_DEFAULT=Object.freeze({profileId:av1Profile.id,preset:av1Profile.defaultPreset,quality:av1Profile.quality.default});
function av1Settings(value){const settings=validateSettings(value);assert(settings.profileId===AV1_DEFAULT.profileId&&!Object.hasOwn(settings,'recipeId'),'Unified AV1 requires native preset and CRF, not a named recipe');return settings;}
const ordinarySettings=value=>value?.profileId===AV1_DEFAULT.profileId?av1Settings(value):h264Settings(value);
const h264Profile=PROFILES.find(p=>p.id==='h264-cpu');
const H264_DEFAULT=Object.freeze({profileId:h264Profile.id,preset:h264Profile.defaultPreset,quality:h264Profile.quality.default});
function h264Settings(value){
 const settings=validateSettings(value);
 assert(settings.profileId===H264_DEFAULT.profileId&&!Object.hasOwn(settings,'recipeId'),'Unified H264 requires native preset and CRF, not a named recipe');
 return settings;
}
function h264Admit(facts){h264Settings(facts.settings);return admitInput(facts);}
function ordinaryAdmitBatch(entries){
 assert(entries.length>=1&&entries.length<=POLICY.maxBatchInputs);
 const admitted=entries.map(facts=>{ordinarySettings(facts.settings);return admitInput(facts);});
 const bytes=admitted.reduce((n,r)=>n+r.bytes,0),duration=admitted.reduce((n,r)=>n+r.duration,0);
 assert(Number.isSafeInteger(bytes)&&bytes<=POLICY.maxBatchBytes&&Number.isFinite(duration)&&duration<=POLICY.maxBatchDurationSeconds);
}
// Unified settings only; the legacy fixed AV1 policy remains unchanged.
const routePolicy=route=>({admit:route==='av1-ordinary'?facts=>{av1Settings(facts.settings);return admitInput(facts);}:h264Admit,admitBatch:ordinaryAdmitBatch});
const {openOrdinaryStageGuard}=require('./ordinary-cpu-stage-guard.cjs');
const {openUnifiedGeneration}=require('./product-linux-unified-runtime.cjs');
const H265=require('./h265-ordinary-policy.cjs');
const MEASURED=Object.freeze({profileId:'h265-cpu',preset:'slow',quality:25});
const RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
function fixedSettings(value){if(value?.profileId===AV1.SETTINGS.profileId){av1Settings(value);return 'av1-ordinary';}if(value?.profileId===H264_DEFAULT.profileId){h264Settings(value);return 'ordinary';}H265.settings(value);return 'h265';}
const MKV_INPUT_REFUSED='REMUX_MKV_INPUT_NOT_QUALIFIED';
const REMUX_TARGET_LABELS=Object.freeze({mp4:'MP4',matroska:'MKV',mov:'MOV'});
class NarrowRemux extends RemuxOperations{
  #movEnvelope; #onRefused; #targets;
  constructor(options,movEnvelope,onRefused){
    super(options);this.#movEnvelope=movEnvelope;this.#onRefused=onRefused;this.#targets=new Set(options.policies.map(p=>p.target));
  }
  prepare(options){
    const {assessment,input,request}=options;
    try{
      if(assessment.inputFamily==='matroska'&&path.extname(input).toLowerCase()==='.mkv'
          &&assessment.target===request.target&&this.#targets.has(request.target)&&Object.hasOwn(REMUX_TARGET_LABELS,request.target)
          &&request.omissionRequestIds.length===0){
        // Only the original unblocked main assessment can reach this
        // explanation. A file name does not establish MKV inspection.
        const source=getRemuxAssessmentSource(assessment);
        if(source.format.format_name==='matroska,webm')
          throw new ToolError(MKV_INPUT_REFUSED,`MKV is not qualified as an input for verified copy to ${REMUX_TARGET_LABELS[request.target]} in this Linux build. Use a qualified MP4 as input. No copy was started and no track was omitted.`);
      }
      admitRemux(assessment,input,{proportionalIsobmff:true,movSourceEnvelope:this.#movEnvelope});
    }catch(error){
      if([MKV_INPUT_REFUSED,'REMUX_MULTI_AUDIO_NOT_QUALIFIED','REMUX_AUDIO_TRACK_COUNT_UNSUPPORTED'].includes(error.code))
        this.#onRefused(request,assessment,error.code);
      throw error;
    }
    return super.prepare(options);
  }
}
class UnifiedService extends EncoderService{
  #ordinaryPrepared=new WeakMap();
  #encodePreparing=new WeakMap();
  // No current unified Linux verified copy cell can honor a stream omission.
  get remuxOmissionDecisionsSupported(){return false;}
  constructor(options,configuration){super(options);this.configuration=configuration;this.generation=null;this.route=null;this.epoch=0;this.mutationOwner=null;this.cancellation=null;this.shuttingDown=false;this.executionBinding=null;}
  resolveEncodeControls(plan,settings){
    if(plan?.contract?.range?.kind==='range'&&plan?.contract?.audio?.policy==='precision-aac'
        &&settings?.profileId==='h265-cpu'&&settings.preset==='slow'&&settings.quality===25)
      return {budget:EVIDENCE_BUDGET,executionBudgetMs:EXECUTION_BUDGET_MS};
    return super.resolveEncodeControls(plan,settings);
  }
  async mutate(name,args){
    assert(!this.shuttingDown&&!this.cancellation&&!this.mutationOwner,'Operation admission is fenced');
    const owner={epoch:this.epoch};this.mutationOwner=owner;
    owner.done=Promise.resolve().then(async()=>{try{this.currentEpoch(owner.epoch);return await this[name](...args);}finally{if(this.mutationOwner===owner)this.mutationOwner=null;}});
    return owner.done;
  }
  currentEpoch(epoch){assert(!this.shuttingDown&&!this.cancellation&&this.epoch===epoch,'Preparation owner retired');}
  async retireGeneration(){
    const failures=[];
    if(composed(this.remuxOperations)){try{this.remuxOperations.invalidate();}catch(e){failures.push(e);}}
    try{if(this.operationStoragePromise)await (await this.operationStoragePromise).close();}catch(e){failures.push(e);}
    try{await this.generation?.close();}catch(e){failures.push(e);}
    if(failures.length)throw new AggregateError(failures,'Previous operation ownership is not confirmed settled');
    this.operationStoragePromise=null;this.generation=null;
  }
  async renew(route){
    const epoch=this.epoch;this.currentEpoch(epoch);super.requireIdle();
    await this.taskPromise;this.currentEpoch(epoch);
    if(this.generation||this.operationStoragePromise){await this.retireGeneration();this.currentEpoch(epoch);}
    const selector=createProductSelector(this.configuration.measured);
    const fresh=await openUnifiedGeneration(this.configuration.runtimeRoot,this.stateDir,this.configuration.onChild,selector);
    try{this.currentEpoch(epoch);await fresh.current();this.currentEpoch(epoch);}catch(e){await fresh.close();throw e;}
    this.generation=fresh;this.route=route;this.executionBinding=null;
    this.operationRuntime=fresh.observer;
    this.operationQualifications=selector;
    const q=this.configuration.remux;
    const legacy=new NarrowRemux({runtimeIdentity:RUNTIME,policyIdentity:q.policyIdentity,policies:remuxPolicies(q)},q.mov?.sourceEnvelope,(request,assessment,code)=>{
      // These explicit Linux refusals cannot be repaired by omitting a track.
      // Retire just this inspected file's offers before the first update.
      const fileId=request.fileId,plan=this.plan,item=this.state.items.find(value=>value.id===fileId);
      const facts=plan?.remuxFacts.get(fileId),mkvInput=code===MKV_INPUT_REFUSED;
      if(this.generation!==fresh||this.route!=='remux'||plan?.operation!=='remux'||!item?.remux
          ||facts?.request!==request||facts.assessment!==assessment||item.remux.target!==request.target
          ||(!mkvInput&&request.target!=='mp4')||item.remux.omissionDecisionIds.length!==0)return;
      for(const [id,choice]of plan.remuxCandidates)if(choice.fileId===fileId&&choice.planId===plan.id)plan.remuxCandidates.delete(id);
      item.remux.omissionCandidates=[];
      if(mkvInput)for(const stream of item.remux.streams){
        stream.action='blocked';stream.reasons=['This input is unavailable for verified copy. No stream will be copied.'];
      }
    });
    this.remuxOperations=route==='remux'?installProductTwoAac(legacy,fresh,this):legacy;
    this.operationEvidenceBudget=route==='remux'?EVIDENCE_BUDGET:null;
    this.operationDeadlineMs=route==='remux'?EXECUTION_BUDGET_MS:120000;
    this.ordinaryJobGuard=ordinaryRoute(route)?facts=>this.ordinaryGuard(facts,fresh):null;
  }
  begin(phase){
    assert(this.generation);const controller=new AbortController();
    // Admit the private owner first: refusal must not emit a false busy state.
    let phaseRoute=phase==='checking'?'discovery':this.route,control=null;
    if(this.route==='h265'){if(phase==='running'){const b=this.executionBinding;assert(b&&b.planId===this.plan?.id&&b.generation===this.generation&&this.plan.entries.get(b.fileId)===b.entry,'Execution binding is stale');phaseRoute=b.kind;control=b.control;}else if(phase==='preparing')phaseRoute='measured';}
    if(this.route==='remux'&&phase==='running'&&this.executionBinding){const b=this.executionBinding;assert(b.kind==='remux-isobmff');b.requireCurrent();control=b.control;}
    this.generation.begin(phaseRoute,phase,controller,control);
    // Same shared begin state transition, with the already admitted controller.
    this.controller=controller;this.preparationFailure=null;this.startedAt=Date.now();this.finishedAt=0;
    this.state={...this.state,phase,batchId:randomUUID(),progress:null,preparation:null,error:null};
    this.emitState();return controller.signal;
  }
  bindCreatedRemuxStage(entry,qualified,stage){
    const b=this.executionBinding;
    if(b?.two===true){assert(composed(this.remuxOperations)&&b.entry===entry&&b.selected===qualified);
      this.remuxOperations.stageCreated(entry,qualified,stage);}
  }
  publicationCurrentness(entry,qualified){
    if(this.route==='remux'&&this.executionBinding?.two===true){
      const b=this.executionBinding,owner=this.remuxOperations;assert(composed(owner)&&b.entry===entry&&b.selected===qualified);
      return ()=>{assert(this.executionBinding===b&&this.generation===b.generation&&this.remuxOperations===owner);
        b.generation.assertCurrentTwoAac(b.control);owner.beforePublish(entry,qualified);};
    }
    if(this.route!=='h265'||qualified?.proportional!==true)return undefined;
    assert(isProportionalFamilySelection(qualified,entry.operationPlan),'Measured publication selection is no longer current');
    const binding=this.executionBinding;
    assert(binding?.kind==='measured'&&binding.entry===entry&&binding.control,'Measured publication owner is missing or changed');
    return ()=>{
      assert(this.executionBinding===binding&&this.generation===binding.generation,'Measured publication owner is retired');
      binding.generation.assertCurrent(binding.control);
    };
  }
  async finishPreparationReceipt(options){try{return await super.finishPreparationReceipt(options);}finally{this.generation?.settle();}}
  async execute(selected,signal){
    try{return await super.execute(selected,signal);}
    finally{try{this.generation?.settle();}finally{
      try{if(this.executionBinding?.two===true&&composed(this.remuxOperations))this.remuxOperations.invalidate();}
      finally{if(['h265','remux'].includes(this.route)){this.executionBinding=null;this.ordinaryJobGuard=null;}}
    }}
  }
  async ordinaryGuard(facts,generation){
    try {
      assert((ordinaryRoute(this.route)||this.route==='h265'&&this.executionBinding?.kind==='h265-ordinary')&&this.generation===generation);if(this.route==='h265'){const b=this.executionBinding;assert(b.generation===generation&&b.planId===this.plan?.id&&this.plan.entries.get(b.fileId)===b.entry,'Ordinary execution owner changed');}(this.route==='h265'?H265:routePolicy(this.route)).admit({probe:facts.inspection.probe,settings:facts.settings,request:facts.request,bytes:Number(facts.sourceIdentity.size)});
      await generation.current(facts.signal);generation.assertCurrent();const source=await fs.lstat(facts.sourceIdentity.canonicalPath);assert(source.isFile()&&!source.isSymbolicLink()&&source.nlink===1);
      const guard=await openOrdinaryStageGuard({...facts,signal:AbortSignal.any([facts.signal,generation.signal])});
      return Object.freeze({...guard,signal:AbortSignal.any([guard.signal,generation.signal]),
        async onStage(stage){try{await guard.onStage(stage);}catch(e){generation.abort();throw e;}},
        async beforePublish(stage){try{generation.assertCurrent();await guard.beforePublish(stage);await generation.current();generation.assertCurrent();}catch(e){generation.abort();throw e;}},
        async close(){try{await guard.close();}catch(e){generation.abort();throw e;}}});
    } catch(error){generation.abort();throw error;}
  }
  async getCapabilities(){
    if(!this.capabilityResult){assert(this.generation);try{await super.getCapabilities();}finally{this.generation.settle();}}
    const caps=this.capabilityResult;
    return {...caps,profiles:caps.profiles.filter(p=>[H264_DEFAULT.profileId,MEASURED.profileId,AV1.SETTINGS.profileId].includes(p.id)).map(p=>{
      const limited={...p,bitDepths:[8],supportedBitDepths:(p.supportedBitDepths||[]).filter(x=>x===8)};
      return {...limited,candidateFixedSettings:false};
    }),recipes:[],vendorProfiles:[]};
  }
  async prepareSourceBatch(request,operation,native=null){
    assert(native===null&&['encode','remux'].includes(operation));const route=operation==='remux'?'remux':fixedSettings(request.settings);if(route==='remux')assert(remuxSupport(this.configuration.remux).targets.includes(request.target),'Target lacks reviewed current remux evidence');
    super.requireIdle();await this.renew(route);this.currentEpoch(this.mutationOwner?.epoch??this.epoch);
    return super.prepareSourceBatch(request,operation,native);
  }
  async reprepareEncodingSettings(request){assert.equal(fixedSettings(request.settings),this.route,'Use a fresh explicit Prepare to change CPU route');return super.reprepareEncodingSettings(request);}
  additionalAncillaryRefusal({assessment,source,request,file}){
    // Explain only a recognized local MP4 governed by this active Full-copy
    // service. A probe's MOV aliases do not identify an MP4 on their own.
    if(this.route!=='remux'||this.plan?.operation!=='remux'||request.range!==null||request.omissionRequestIds.length
        ||assessment.inputFamily!=='isobmff'||path.extname(file).toLowerCase()!=='.mp4'
        ||!['isom','iso2','mp41','mp42','avc1'].includes(source.format.tags?.major_brand)
        ||!this.state.remuxSupport?.targets.includes(request.target)
        ||source.mediaEvidence.container.relationships.state!=='known'||source.programs.length||source.stream_groups.length)return null;
    const targets={mp4:'MP4',mov:'MOV',matroska:'MKV'};
    const video=source.streams.filter(s=>s.codec_type==='video'),audio=source.streams.filter(s=>s.codec_type==='audio');
    const subs=source.streams.filter(s=>s.codec_type==='subtitle'),data=source.streams.filter(s=>s.codec_type==='data');
    const chapters=source.chapters.length>0;
    if(!Object.hasOwn(targets,request.target)||video.length!==1||audio.length!==1||(!chapters&&!subs.length)
        ||source.streams.length!==2+subs.length+data.length||subs.length>2||data.length>1
        ||video[0].codec_name!=='h264'||video[0].pix_fmt!=='yuv420p'||video[0].field_order!=='progressive'
        ||video[0].color_space!=='bt709'||video[0].color_transfer!=='bt709'||video[0].color_primaries!=='bt709'
        ||video[0].avg_frame_rate!=='30/1'||video[0].r_frame_rate!=='30/1'
        ||!Number.isSafeInteger(video[0].width)||video[0].width<1||video[0].width>1920
        ||!Number.isSafeInteger(video[0].height)||video[0].height<1||video[0].height>1080
        ||video[0].side_data_list?.length||Number(video[0].disposition?.attached_pic||0)!==0
        ||assessment.expectedOutput.selectedVideoInputIndex!==video[0].index
        ||audio[0].codec_name!=='aac'||audio[0].profile!=='LC'||audio[0].sample_fmt!=='fltp'||audio[0].sample_rate!=='48000'
        ||audio[0].channels!==2||audio[0].channel_layout!=='stereo'
        ||subs.some(s=>s.codec_name!=='mov_text'||s.codec_tag_string!=='tx3g')
        ||data.some(s=>!chapters||s.codec_name!=='bin_data'||s.codec_tag_string!=='text'))return null;
    // The native data track is not assumed to be a chapter carrier. Preserve
    // any existing unsupported-stream reason as primary; don't explain unsafe
    // relationships, unknown timings or metadata failures as an ancillary case.
    const ids=new Set();
    for(const [n,e] of source.mediaEvidence.streams.entries()){
      const s=source.streams[n],id=e.identity.containerStreamId,t=e.timeline,flags=s.disposition;
      if(e.index!==s.index||id.state!=='known'||id.value==='0'||ids.has(id.value)
          ||t.timeBase.state!=='known'||t.startPts.state!=='known'||t.durationTicks.state!=='known'||t.durationTicks.value==='0'
          ||!flags||!Object.hasOwn(flags,'default')||s.side_data_list?.length
          ||Object.entries(flags).some(([key,v])=>![0,1,'0','1'].includes(v)||key!=='default'&&Number(v)!==0))return null;
      ids.add(id.value);
    }
    const unavailableMappings=new Set([...data,...(request.target==='matroska'?subs:[])].map(s=>s.index));
    if(assessment.blockers.some(b=>b.code!=='REMUX_STREAM_UNSUPPORTED'||!unavailableMappings.has(b.streamIndex)))return null;
    const captions=subs.length===1?'the timed-text subtitle track':'both timed-text subtitle tracks';
    const what=subs.length&&chapters?`${captions} and chapters`:subs.length?captions:'the chapters';
    return `Copy to ${targets[request.target]} is unavailable for this MP4: this Linux build cannot yet verify preservation of ${what}. No copy was started and nothing was omitted.`;
  }
  async reprepareDraft(options){
    assert(this.plan);assert.equal(this.plan.operation,this.route==='remux'?'remux':'encode');
    if(this.route!=='remux')assert.equal(fixedSettings(this.plan.settings),this.route);
    else for(const item of this.state.items){
      // The accepted edit retires the old target's decisions. The first busy
      // update (and a fresh refusal before inspection) must not show them.
      delete item.remux;delete item.verificationMethod;delete item.verificationClaim;
    }
    return super.reprepareDraft(options);
  }
  discoverInspectionOnly(entries,target){return discoverMp3Diagnostic(entries,target);}
  async inspectUnlistedSource(item,{baseline,preparedPlan,owner,signal,onStage}){
    const generation=this.generation, planId=preparedPlan.id, request=item.operationRequest;
    const current=()=>{
      if(signal.aborted||this.cancellation||this.shuttingDown||this.plan!==preparedPlan||this.plan.id!==planId
          ||this.route!=='remux'||this.generation!==generation||this.state.batchId!==owner||this.state.phase!=='preparing'
          ||!this.state.items.includes(item)||item.operationRequest!==request||!preparedPlan.inspectionOnly?.has(item.name))
        throw new ToolError('CANCELLED','The MP3 inspection is no longer current.');
      generation.assertCurrent();
    };
    current();
    return inspectMp3Diagnostic({baseline,selectedPath:path.join(preparedPlan.input,item.name),request,signal,current,onStage,ffprobe:this.ffprobe,run:this.run});
  }
  async prepareWithWorkers(context){assert(this.state.items.length>=1&&this.state.items.length<=(ordinaryRoute(this.route)?2:1));return super.prepareWithWorkers(context);}
  ordinaryEntry(item,entry=this.plan?.entries.get(item.id)){
    assert(entry&&entry.operationPlan?.compatibilityPath===true&&!entry.qualificationSelection&&!entry.operationRuntimeToken&&!['vendor','remux','hdr','encodePreservation','native'].some(k=>entry[k])&&this.plan.operation==='encode');
    return entry;
  }
  async prepareItem(item,context){
    const route=this.route,ordinary=ordinaryRoute(route);
    if(!ordinary&&route!=='h265')return super.prepareItem(item,context);
    const owner=Object.freeze({plan:this.plan,planId:this.plan.id,generation:this.generation,epoch:this.epoch,route,signal:context.signal,
      settings:Object.freeze(ordinary?ordinarySettings(context.settings):{...context.settings})});
    assert(!this.#encodePreparing.has(item),'File already has a preparation owner');
    this.#encodePreparing.set(item,owner);
    try{return await super.prepareItem(item,context);}
    finally{this.#encodePreparing.delete(item);}
  }
  bindPreparedEncodeEntry(item,entry){
    const owner=this.#encodePreparing.get(item),ordinary=ordinaryRoute(owner?.route);
    if(owner?.signal.aborted)throw new ToolError('CANCELLED','Encode preparation was cancelled.');
    try{
      assert(owner&&this.plan===owner.plan&&this.plan.id===owner.planId&&this.generation===owner.generation
        &&this.route===owner.route&&this.epoch===owner.epoch&&this.state.phase==='preparing','Encode preparation owner changed');
      assert.deepEqual(ordinary?ordinarySettings(this.plan.settings):this.plan.settings,owner.settings,'Encode settings changed during preparation');
      if(ordinary||entry.operationPlan?.compatibilityPath){
        this.ordinaryEntry(item,entry);
        const facts={probe:entry.inspection.probe,settings:owner.settings,request:item.operationRequest,bytes:Number(entry.fingerprint.size)};
        if(ordinary){
          routePolicy(owner.route).admit(facts);
          this.#ordinaryPrepared.set(entry,Object.freeze({plan:owner.plan,planId:owner.planId,generation:owner.generation,route:owner.route,
            settings:owner.settings,operationPlan:entry.operationPlan,preparedArgs:entry.preparedArgs,request:item.operationRequest}));
        }else H265.admit(facts);
      }else this.requireMeasuredEntry(entry);
    }catch{
      const reason=owner?.route==='h265'?'Outside the supported H265 operation; ordinary Matroska requires 1/1000 stream clocks.'
        :ordinary?'Outside the supported ordinary CPU Full / Keep source route.':'Outside the fixed ordinary CPU route.';
      throw new ToolError('ORDINARY_ADMISSION',reason);
    }
  }
  requireMeasuredEntry(e){assert.deepEqual(this.plan.settings,MEASURED);assert(!this.plan.sameFolder);assert(e?.qualificationSelection&&e.operationRuntimeToken&&e.operationPlan?.instrumentation&&!e.operationPlan.compatibilityPath&&!['native','vendor','hdr','remux','encodePreservation'].some(k=>e[k]));}
  async startBatch(request){
    if(['h265','remux'].includes(this.route))assert(request&&Object.keys(request).length===2&&Object.hasOwn(request,'planId')&&Object.hasOwn(request,'fileIds'),'Exact Start request required');
    super.requireIdle();assert(this.generation&&this.plan);
    assert.equal(this.plan.operation,this.route==='remux'?'remux':'encode');
    assert(Array.isArray(request.fileIds)&&request.fileIds.length>=1&&request.fileIds.length<=(ordinaryRoute(this.route)?2:1));
    if(ordinaryRoute(this.route)){
      const policy=routePolicy(this.route);
      assert(this.state.phase==='ready'&&this.plan.id===request.planId&&!this.plan.encodingSettingsStale,'Prepare the current ordinary settings before Start');
      assert.equal(fixedSettings(this.plan.settings),this.route);
      policy.admitBatch(request.fileIds.map(id=>{
        const item=this.state.items.find(x=>x.id===id);assert(item);
        const e=this.ordinaryEntry(item);
        const b=this.#ordinaryPrepared.get(e);
        assert(b&&b.plan===this.plan&&b.planId===this.plan.id&&b.generation===this.generation&&b.route===this.route&&b.operationPlan===e.operationPlan&&b.preparedArgs===e.preparedArgs&&b.request===item.operationRequest,'Ordinary preparation binding is stale');
        assert.deepEqual(ordinarySettings(this.plan.settings),b.settings,'Ordinary settings changed after preparation');
        return {probe:e.inspection.probe,settings:this.plan.settings,request:item.operationRequest,bytes:Number(e.fingerprint.size)};
      }));
    }
    else if(this.route==='h265'){
      assert.equal(this.state.phase,'ready');assert.equal(request.planId,this.plan.id);assert.equal(request.fileIds.length,1);
      const fileId=request.fileIds[0],item=this.state.items.find(x=>x.id===fileId),entry=this.plan.entries.get(fileId);assert(item&&['ready','conflict'].includes(item.status)&&entry);
      let kind;if(entry.operationPlan?.compatibilityPath){H265.requireEntry(this,item);kind='h265-ordinary';}else{this.requireMeasuredEntry(entry);kind='measured';}
      this.requirePreparedEncodeControls(entry);
      const plan=this.plan,generation=this.generation;
      let control=null;
      assert(!this.executionBinding);
      if(kind==='measured'){
        const selector=this.operationQualifications,operationPlan=entry.operationPlan,selection=entry.qualificationSelection;
        const observed=entry.operationRuntimeToken;
        const bindings=()=>{
          assert(this.plan===plan&&this.generation===generation&&this.operationQualifications===selector&&this.operationRuntime===generation.observer
            &&plan.entries.get(fileId)===entry&&entry.operationPlan===operationPlan&&entry.qualificationSelection===selection
            &&entry.operationRuntimeToken===observed&&!this.cancellation&&!this.shuttingDown,'Measured execution binding retired');
          const observation=generation.observer.snapshot(observed);assert.equal(observation.runtimeIdentity,this.runtimeIdentity);
          return {...entry.qualificationBindings,plan:operationPlan,settings:plan.settings,sourceIdentity:entry.fingerprint,
            sourceProbeFingerprint:fingerprintEncodeSource(entry.inspection.probe),runtimeIdentity:this.runtimeIdentity,
            ...this.requirePreparedEncodeControls(entry),environment:observation.environment};
        };
        const selected=selector.requireCurrent(selection,bindings());
        if(isProportionalFamilySelection(selected,operationPlan))control=generation.bindMeasured(selection,bindings);
      }
      this.executionBinding=Object.freeze({planId:plan.id,generation,fileId,entry,kind,control});
      this.ordinaryJobGuard=kind==='h265-ordinary'?facts=>this.ordinaryGuard(facts,generation):null;
    }
    else {
      assert.equal(this.state.phase,'ready');assert.equal(request.planId,this.plan.id);
      const fileId=request.fileIds[0],item=this.state.items.find(x=>x.id===fileId),entry=this.plan.entries.get(fileId);
      assert(item&&['ready','conflict'].includes(item.status)&&entry?.remux);
      if(['mp4','matroska','mov'].includes(entry.operationPlan.contract.target)){
        const plan=this.plan,generation=this.generation;
        const bindings=()=>{
          assert(this.plan===plan&&this.generation===generation&&plan.entries.get(fileId)===entry&&!this.cancellation&&!this.shuttingDown,'Remux execution binding retired');
          return {...entry.qualificationBindings,plan:entry.operationPlan,settings:plan.settings,sourceIdentity:entry.fingerprint,sourceProbeFingerprint:remuxProbeFingerprint(entry.inspection.probe),runtimeIdentity:this.runtimeIdentity,budget:this.operationEvidenceBudget,executionBudgetMs:this.operationDeadlineMs,environment:null};
        };
        const owner=this.remuxOperations;
        if(composed(owner)){
          let bound;
          try{assert(!this.executionBinding);bound=owner.bindForStart(entry.qualificationSelection,bindings);}
          catch(error){
            if(!owner.isTwoPlan(entry.operationPlan)||error.code!=='REMUX_OPERATION_STALE')throw error;
            // A synchronous pre-Start refusal must not leave a misleading Ready
            // item, a stale action, or an apparently reusable preparation.
            const failures=[];
            this.plan=null;this.state.planId=null;this.state.operationDraft=null;this.executionBinding=null;
            this.state.phase='failed';this.state.error='The prepared two-track copy changed. Prepare again.';
            item.status='failed';item.reasonCode=error.code;item.reason=this.state.error;this.finishedAt=Date.now();
            try{await this.retireGeneration();}catch(e){failures.push(e);this.closeAdmission();}
            try{this.emitState();}catch(e){failures.push(e);}
            if(failures.length)throw new AggregateError([error,...failures],this.state.error,{cause:error});throw error;
          }
          this.executionBinding=Object.freeze({kind:'remux-isobmff',planId:plan.id,fileId,entry,generation,...bound});
        }else{
          const requireCurrent=()=>RemuxOperations.prototype.requireCurrent.call(owner,entry.qualificationSelection,bindings());
          const selected=requireCurrent();assert(selected.remux&&selected.qualification.inputFamily==='isobmff'&&selected.qualification.target===entry.operationPlan.contract.target);
          assert(!this.executionBinding);const control=generation.bindRemux(owner,entry.qualificationSelection,bindings);
          this.executionBinding=Object.freeze({kind:'remux-isobmff',planId:plan.id,fileId,entry,generation,selected,requireCurrent,control});
        }
      }
    }
    const previousTask=this.taskPromise;
    try{return super.startBatch(request);}catch(error){
      if(!['h265','remux'].includes(this.route))throw error;
      // Shared Start can mutate the queue/draft before begin or throw after it.
      // Retire this authority honestly; do not pretend the same plan is retryable.
      const failures=[error];this.controller?.abort();this.generation?.abort();
      if(this.taskPromise!==previousTask)try{await this.taskPromise;}catch(e){failures.push(e);}
      try{this.generation?.settle();}catch(e){failures.push(e);}
      this.operationQualifications?.invalidate('Start failed');this.remuxOperations?.invalidate();
      this.plan=null;this.state.planId=null;this.state.operationDraft=null;
      this.state.phase='failed';this.state.error='Start failed. Prepare a fresh batch before trying again.';this.finishedAt=Date.now();
      for(const item of this.state.items)if(['ready','pending','conflict','unprocessed'].includes(item.status)){item.status='failed';item.reason=this.state.error;}
      try{await this.retireGeneration();}catch(e){failures.push(e);this.closeAdmission();this.state.error='Start failed and ownership cleanup is unconfirmed. Close the app; no new operation is admitted.';}
      this.executionBinding=null;this.ordinaryJobGuard=null;
      // Notify the renderer only after authority is retired or admission closed.
      // Broken listeners cannot undo settlement; the command still explains recovery.
      try{this.emitState();}catch(e){failures.push(e);}
      throw new AggregateError(failures,this.state.error,{cause:error});
    }
  }
  snapshot(){return {...super.snapshot(),developerProduct:{enabled:true,composition:'unified-linux-operations-v1',relaunchRequired:false,notice:'Internal unified Linux candidate: configurable ordinary H264 and AV1 Full/source, and configurable H265 ordinary Full/source (one H265 file; Matroska source clocks must be 1/1000), five measured H265 slow25 families, including short CFR30 H264/AAC stereo48k precision ranges, and qualified MP4, MOV and Matroska Full stream-copy routes. Unsupported requests do not fall back. Fresh explicit Prepare is required after settled Cancel. Native evidence is artifact/route-specific; this exact-host internal candidate is not a portable release.'}};}
  async saveSettings(value){fixedSettings(value);return super.saveSettings(value);}
  getRecipe(value){fixedSettings(value);const recipe=super.getRecipe(value);return {...recipe,mediaNote:(value.profileId===MEASURED.profileId?'Existing H265 settings/defaults; transformed measured operations still require slow/25. ':[H264_DEFAULT.profileId,AV1_DEFAULT.profileId].includes(value.profileId)?'Existing CPU settings/defaults within the supported ordinary Full / Keep source route. ':'Fixed internal candidate settings; ')+ 'Not a new production default. '+recipe.mediaNote};}
  async resetProfile(request){assert.deepEqual(request,{profileId:request.profileId});const settings=request.profileId===AV1_DEFAULT.profileId?AV1_DEFAULT:request.profileId===H264_DEFAULT.profileId?H264_DEFAULT:MEASURED;assert.equal(request.profileId,settings.profileId);await this.saveSettings(settings);return this.getPreferences();}
  cancelCurrent(){
    if(this.cancellation)return this.cancellation;
    this.epoch++;const pending=this.mutationOwner?.done;this.controller?.abort();
    this.cancellation=(async()=>{
      if(pending)await pending.catch(()=>{});
      await super.cancelCurrent();await this.taskPromise.catch(()=>{});
      this.operationQualifications?.invalidate('Cancelled operation');this.remuxOperations?.invalidate();
      this.plan=null;this.state.planId=null;this.state.operationDraft=null;
      for(const item of this.state.items)if(['ready','pending','conflict'].includes(item.status)){item.status='cancelled';item.reason='Cancelled. Prepare explicitly to create new authority.';}
      this.state.phase='cancelled';this.finishedAt=Date.now();
      if(this.generation||this.operationStoragePromise)await this.retireGeneration();
      this.emitState();return this.snapshot();
    })();
    return this.cancellation.finally(()=>{this.cancellation=null;});
  }
  closeOperationResources(){
    this.shuttingDown=true;this.epoch++;this.closeAdmission();this.controller?.abort();
    return this.unifiedClose ||= (async()=>{const failures=[];if(this.mutationOwner)await this.mutationOwner.done.catch(()=>{});if(this.cancellation)await this.cancellation.catch(e=>failures.push(e));
      try{await super.closeOperationResources();}catch(e){failures.push(e);}
      if(composed(this.remuxOperations)){try{this.remuxOperations.invalidate();}catch(e){failures.push(e);}}
      try{await this.generation?.close();}catch(e){failures.push(e);}this.outputAccess?.clear();
      if(failures.length)throw new AggregateError(failures,'Unified owner closure incomplete');})();
  }
}
// Only public mutation entrypoints are fenced. Internal shared-method calls use
// the same actual service directly, avoiding recursive locks and split queues.
const MUTATIONS=new Set(['getCapabilities','registerFolder','saveAppSettings','resetAppSettings','saveSettings','resetProfile','forgetPreferences','clearInspectionCache','prepareBatch','prepareRemuxBatch','setRemuxOmissions','setEncodePreservationDecisions','updateFileOperations','updateBatchOperationDefaults','applyAppDefaultsToBatch','reprepareEncodingSettings','treatAsOriginal','reencodeOutputs','startBatch']);
async function createUnifiedService(options){
  assert(options&&Object.getPrototypeOf(options)===Object.prototype);
  for(const key of Reflect.ownKeys(options))assert(['runtimeRoot','stateDir','outputAccess','onChild'].includes(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value'));
  const {runtimeRoot,stateDir,outputAccess,onChild}=options;assert(onChild===undefined||typeof onChild==='function');
  assert(path.isAbsolute(runtimeRoot)&&path.resolve(runtimeRoot)===runtimeRoot&&path.isAbsolute(stateDir)&&path.resolve(stateDir)===stateDir);assert(outputAccess===undefined||outputAccess instanceof OutputAccess);
  const measured=loadQualification(),remux=loadRemuxQualification({unifiedMovCadence:true});let service;
  service=new UnifiedService({ffmpeg:path.join(runtimeRoot,'ffmpeg'),ffprobe:path.join(runtimeRoot,'ffprobe'),stateDir,outputAccess,inspectionWorkers:1,runtimeIdentity:RUNTIME,operationTelemetry:true,
    run:(...args)=>{assert(service.generation);return service.generation.run(...args);},operationStorage:()=>openEvidenceStorage({root:path.join(stateDir,'operation-evidence')})},{runtimeRoot,onChild,measured,remux});
  service.state.remuxSupport=remuxSupport(remux);
  service.state.remuxSupport.notice+=' '+MP3_NOTICE;
  try{await service.renew('ordinary');return new Proxy(service,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return MUTATIONS.has(key)?(...args)=>target.mutate(key,args):value.bind(target);}});}catch(error){try{await service.closeOperationResources();}catch(cleanup){throw new AggregateError([error,cleanup],'Unified construction and closure failed');}throw error;}
}
module.exports={createUnifiedService,fixedSettings};
