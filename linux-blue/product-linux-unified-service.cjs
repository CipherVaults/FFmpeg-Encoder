'use strict';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {EncoderService}=require('../src/encoder-service.cjs');
const {isProportionalFamilySelection}=require('../src/operation-family.cjs');
const {fingerprintEncodeSource}=require('../src/encode-operation.cjs');
const {OutputAccess}=require('../src/output-access.cjs');
const {RemuxOperations}=require('../src/remux-operation.cjs');
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
const remuxEnvelopes=new WeakMap();
class NarrowRemux extends RemuxOperations{constructor(options,movSourceEnvelope){super(options);remuxEnvelopes.set(this,movSourceEnvelope);}prepare(options){admitRemux(options.assessment,options.input,{proportionalIsobmff:true,movSourceEnvelope:remuxEnvelopes.get(this)});return super.prepare(options);}}
class UnifiedService extends EncoderService{
  #ordinaryPrepared=new WeakMap();
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
    this.remuxOperations=new NarrowRemux({runtimeIdentity:RUNTIME,policyIdentity:q.policyIdentity,policies:remuxPolicies(q)},q.mov?.sourceEnvelope);
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
  publicationCurrentness(entry,qualified){
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
  async execute(selected,signal){try{return await super.execute(selected,signal);}finally{try{this.generation?.settle();}finally{if(['h265','remux'].includes(this.route)){this.executionBinding=null;this.ordinaryJobGuard=null;}}}}
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
  async reprepareDraft(options){assert(this.plan);assert.equal(this.plan.operation,this.route==='remux'?'remux':'encode');if(this.route!=='remux')assert.equal(fixedSettings(this.plan.settings),this.route);return super.reprepareDraft(options);}
  async prepareWithWorkers(context){assert(this.state.items.length>=1&&this.state.items.length<=(ordinaryRoute(this.route)?2:1));return super.prepareWithWorkers(context);}
  ordinaryEntry(item){
    const e=this.plan?.entries.get(item.id);
    assert(e&&e.operationPlan?.compatibilityPath===true&&!e.qualificationSelection&&!e.operationRuntimeToken&&!['vendor','remux','hdr','encodePreservation','native'].some(k=>e[k])&&this.plan.operation==='encode');
    return e;
  }
  async prepareItem(item,context){
    const ordinary=ordinaryRoute(this.route);
    const owner=ordinary?{plan:this.plan,planId:this.plan.id,generation:this.generation,route:this.route,settings:Object.freeze(ordinarySettings(context.settings))}:null;
    await super.prepareItem(item,context);
    if(this.plan?.entries.has(item.id)){
      try{
        if(ordinary){
          const e=this.ordinaryEntry(item);
          assert(this.plan===owner.plan&&this.plan.id===owner.planId&&this.generation===owner.generation&&this.route===owner.route,'Ordinary preparation owner changed');
          assert.deepEqual(ordinarySettings(this.plan.settings),owner.settings,'Ordinary settings changed during preparation');
          routePolicy(this.route).admit({probe:e.inspection.probe,settings:owner.settings,request:item.operationRequest,bytes:Number(e.fingerprint.size)});
          this.#ordinaryPrepared.set(e,Object.freeze({...owner,operationPlan:e.operationPlan,preparedArgs:e.preparedArgs,request:item.operationRequest}));
        }else if(this.route==='h265'){
          const e=this.plan.entries.get(item.id);
          if(e.operationPlan?.compatibilityPath)H265.requireEntry(this,item);else this.requireMeasuredEntry(e);
        }
      }catch(error){
        this.plan.entries.delete(item.id);item.status='unsupported';item.reasonCode='ORDINARY_ADMISSION';
        item.reason=this.route==='h265'?'Outside the supported H265 operation; ordinary Matroska requires 1/1000 stream clocks.':ordinary?'Outside the supported ordinary CPU Full / Keep source route.':'Outside the fixed ordinary CPU route.';
      }
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
        const requireCurrent=()=>RemuxOperations.prototype.requireCurrent.call(this.remuxOperations,entry.qualificationSelection,bindings());
        const selected=requireCurrent();assert(selected.remux&&selected.qualification.inputFamily==='isobmff'&&selected.qualification.target===entry.operationPlan.contract.target);
        assert(!this.executionBinding);const control=generation.bindRemux(this.remuxOperations,entry.qualificationSelection,bindings);this.executionBinding=Object.freeze({kind:'remux-isobmff',planId:plan.id,fileId,entry,generation,selected,requireCurrent,control});
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
      try{await super.closeOperationResources();}catch(e){failures.push(e);}try{await this.generation?.close();}catch(e){failures.push(e);}this.outputAccess?.clear();
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
  try{await service.renew('ordinary');return new Proxy(service,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return MUTATIONS.has(key)?(...args)=>target.mutate(key,args):value.bind(target);}});}catch(error){try{await service.closeOperationResources();}catch(cleanup){throw new AggregateError([error,cleanup],'Unified construction and closure failed');}throw error;}
}
module.exports={createUnifiedService,fixedSettings};
