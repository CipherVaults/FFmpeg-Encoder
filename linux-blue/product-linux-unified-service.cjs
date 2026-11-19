'use strict';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {EncoderService}=require('../src/encoder-service.cjs');
const {OutputAccess}=require('../src/output-access.cjs');
const {RemuxOperations}=require('../src/remux-operation.cjs');
const {EVIDENCE_BUDGET,EXECUTION_BUDGET_MS}=require('../src/operation-controls.cjs');
const {openEvidenceStorage}=require('../src/operation-storage.cjs');
const {createProductSelector}=require('./product-linux-service.cjs');
const {loadQualification}=require('./product-linux-qualification.cjs');
const {loadRemuxQualification}=require('./product-linux-remux-qualification.cjs');
const {admit:admitRemux}=require('./product-linux-remux-service.cjs');
const {requireOrdinaryEntry}=require('./ordinary-cpu-service.cjs');
const {SETTINGS:ORDINARY,admit,admitBatch}=require('./ordinary-cpu-policy.cjs');
const {openOrdinaryStageGuard}=require('./ordinary-cpu-stage-guard.cjs');
const {openUnifiedGeneration}=require('./product-linux-unified-runtime.cjs');
const MEASURED=Object.freeze({profileId:'h265-cpu',preset:'slow',quality:25});
const RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
function fixedSettings(value){if(value?.profileId===ORDINARY.profileId){assert.deepEqual(value,ORDINARY);return 'ordinary';}assert.deepEqual(value,MEASURED);return 'measured';}
class NarrowRemux extends RemuxOperations{prepare(options){admitRemux(options.assessment,options.input);return super.prepare(options);}}
class UnifiedService extends EncoderService{
  constructor(options,configuration){super(options);this.configuration=configuration;this.generation=null;this.route=null;this.epoch=0;this.mutationOwner=null;this.cancellation=null;this.shuttingDown=false;}
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
    const fresh=await openUnifiedGeneration(this.configuration.runtimeRoot,this.stateDir,this.configuration.onChild);
    try{this.currentEpoch(epoch);await fresh.current();this.currentEpoch(epoch);}catch(e){await fresh.close();throw e;}
    this.generation=fresh;this.route=route;
    this.operationRuntime=fresh.observer;
    this.operationQualifications=createProductSelector(this.configuration.measured);
    const q=this.configuration.remux;
    this.remuxOperations=new NarrowRemux({runtimeIdentity:RUNTIME,policyIdentity:q.policyIdentity,policies:[{id:'internal-isobmff-mp4-081',inputFamily:'isobmff',target:'mp4',runtimeIdentity:RUNTIME,evidenceIds:[q.evidenceId],allowAncillary:false,allowRotation90:false,verificationMethod:'packet-identity-v1'}]});
    this.operationEvidenceBudget=route==='remux'?EVIDENCE_BUDGET:null;
    this.operationDeadlineMs=route==='remux'?EXECUTION_BUDGET_MS:120000;
    this.ordinaryJobGuard=route==='ordinary'?facts=>this.ordinaryGuard(facts,fresh):null;
  }
  begin(phase){
    assert(this.generation);const controller=new AbortController();
    // Admit the private owner first: refusal must not emit a false busy state.
    this.generation.begin(phase==='checking'?'discovery':this.route,phase,controller);
    // Same shared begin state transition, with the already admitted controller.
    this.controller=controller;this.preparationFailure=null;this.startedAt=Date.now();this.finishedAt=0;
    this.state={...this.state,phase,batchId:randomUUID(),progress:null,preparation:null,error:null};
    this.emitState();return controller.signal;
  }
  async finishPreparationReceipt(options){try{return await super.finishPreparationReceipt(options);}finally{this.generation?.settle();}}
  async execute(selected,signal){try{return await super.execute(selected,signal);}finally{this.generation?.settle();}}
  async ordinaryGuard(facts,generation){
    try {
      assert(this.route==='ordinary'&&this.generation===generation);admit({probe:facts.inspection.probe,settings:facts.settings,request:facts.request,bytes:Number(facts.sourceIdentity.size)});
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
    const caps=this.capabilityResult;return {...caps,profiles:caps.profiles.filter(p=>[ORDINARY.profileId,MEASURED.profileId].includes(p.id)).map(p=>{const s=p.id===ORDINARY.profileId?ORDINARY:MEASURED;return {...p,candidateFixedSettings:true,bitDepths:[8],supportedBitDepths:(p.supportedBitDepths||[]).filter(x=>x===8),presets:[s.preset],defaultPreset:s.preset,quality:{...p.quality,min:s.quality,max:s.quality,default:s.quality}};}),recipes:[],vendorProfiles:[]};
  }
  async prepareSourceBatch(request,operation,native=null){
    assert(native===null&&['encode','remux'].includes(operation));const route=operation==='remux'?'remux':fixedSettings(request.settings);if(route==='remux')assert.equal(request.target,'mp4');
    super.requireIdle();await this.renew(route);this.currentEpoch(this.mutationOwner?.epoch??this.epoch);
    return super.prepareSourceBatch(request,operation,native);
  }
  async reprepareEncodingSettings(request){assert.equal(fixedSettings(request.settings),this.route,'Use a fresh explicit Prepare to change CPU route');return super.reprepareEncodingSettings(request);}
  async reprepareDraft(options){assert(this.plan);assert.equal(this.plan.operation,this.route==='remux'?'remux':'encode');if(this.route!=='remux')assert.equal(fixedSettings(this.plan.settings),this.route);return super.reprepareDraft(options);}
  async prepareWithWorkers(context){assert(this.state.items.length>=1&&this.state.items.length<=(this.route==='ordinary'?2:1));return super.prepareWithWorkers(context);}
  async prepareItem(item,context){await super.prepareItem(item,context);if(this.route==='ordinary'&&this.plan?.entries.has(item.id)){try{requireOrdinaryEntry(this,item);}catch(error){this.plan.entries.delete(item.id);item.status='unsupported';item.reasonCode='ORDINARY_ADMISSION';item.reason='Outside the fixed ordinary CPU route.';}}}
  startBatch(request){
    super.requireIdle();assert(this.generation&&this.plan);
    assert.equal(this.plan.operation,this.route==='remux'?'remux':'encode');
    assert(Array.isArray(request.fileIds)&&request.fileIds.length>=1&&request.fileIds.length<=(this.route==='ordinary'?2:1));
    if(this.route==='ordinary'){assert.deepEqual(this.plan.settings,ORDINARY);admitBatch(request.fileIds.map(id=>{const item=this.state.items.find(x=>x.id===id);assert(item);requireOrdinaryEntry(this,item);const e=this.plan.entries.get(id);return {probe:e.inspection.probe,settings:this.plan.settings,request:item.operationRequest,bytes:Number(e.fingerprint.size)};}));}
    else if(this.route==='measured'){assert.deepEqual(this.plan.settings,MEASURED);assert(!this.plan.sameFolder);for(const id of request.fileIds){const e=this.plan.entries.get(id);assert(e?.qualificationSelection&&e.operationRuntimeToken&&e.operationPlan?.instrumentation&&!e.operationPlan.compatibilityPath&&!['native','vendor','hdr','remux','encodePreservation'].some(k=>e[k]));}}
    else for(const id of request.fileIds)assert(this.plan.entries.get(id)?.remux);
    return super.startBatch(request);
  }
  snapshot(){return {...super.snapshot(),developerProduct:{enabled:true,relaunchRequired:false,notice:'Internal unified Linux candidate: fixed H264 ordinary Full/source, four measured H265 families, and narrow MP4 full stream copy. Unsupported requests do not fall back. Fresh explicit Prepare is required after settled Cancel. Exact host/runtime only; unified native acceptance and portability remain unqualified.'}};}
  async saveSettings(value){fixedSettings(value);return super.saveSettings(value);}
  getRecipe(value){fixedSettings(value);const recipe=super.getRecipe(value);return {...recipe,testedDefault:{...recipe},mediaNote:'Fixed internal candidate settings; not a new production default. '+recipe.mediaNote};}
  async resetProfile(request){assert.deepEqual(request,{profileId:request.profileId});const settings=request.profileId===ORDINARY.profileId?ORDINARY:MEASURED;assert.equal(request.profileId,settings.profileId);await this.saveSettings(settings);return this.getPreferences();}
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
  const measured=loadQualification(),remux=loadRemuxQualification();let service;
  service=new UnifiedService({ffmpeg:path.join(runtimeRoot,'ffmpeg'),ffprobe:path.join(runtimeRoot,'ffprobe'),stateDir,outputAccess,inspectionWorkers:1,runtimeIdentity:RUNTIME,operationTelemetry:true,
    run:(...args)=>{assert(service.generation);return service.generation.run(...args);},operationStorage:()=>openEvidenceStorage({root:path.join(stateDir,'operation-evidence')})},{runtimeRoot,onChild,measured,remux});
  service.state.remuxSupport={targets:['mp4'],notice:'Internal MP4 full stream copy only. A saved unsupported target must be changed explicitly; no automatic conversion.'};
  try{await service.renew('ordinary');return new Proxy(service,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return MUTATIONS.has(key)?(...args)=>target.mutate(key,args):value.bind(target);}});}catch(error){try{await service.closeOperationResources();}catch(cleanup){throw new AggregateError([error,cleanup],'Unified construction and closure failed');}throw error;}
}
module.exports={createUnifiedService,fixedSettings};
