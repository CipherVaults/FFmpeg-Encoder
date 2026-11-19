'use strict';
// Main-owned explicit ordinary candidate composition; production defaults unchanged.
const fs=require('node:fs/promises');const assert=require('node:assert/strict');const path=require('node:path');const {createHash}=require('node:crypto');
const {EncoderService}=require('../src/encoder-service.cjs');const {OutputAccess}=require('../src/output-access.cjs');
const {requireCandidateCalibrationRuntime}=require('./candidate-calibration-runtime.cjs');
const {POLICY,SETTINGS,admit,admitBatch,createPhaseRunner}=require('./ordinary-cpu-policy.cjs');const {openOrdinaryStageGuard}=require('./ordinary-cpu-stage-guard.cjs');
const RUNTIME_ID='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const DEPENDENCY_ID='c0fb3610bd2d66733c3fb0787d94877f0631d63d9fbe00ddb751eaa34741adbf';
function guardEnvironment(){assert(process.platform==='linux'&&process.arch==='x64'&&!process.env.NODE_OPTIONS&&!Object.entries(process.env).some(([key,value])=>key.startsWith('LD_')&&value));}
function requireOrdinaryEntry(service,item){const entry=service.plan?.entries.get(item.id);assert(entry&&entry.operationPlan?.compatibilityPath===true&&!entry.vendor&&!entry.remux&&!entry.hdr&&!entry.encodePreservation&&!entry.native&&service.plan.operation!=='native-encode');return admit({probe:entry.inspection.probe,settings:service.plan.settings,request:item.operationRequest,bytes:Number(entry.fingerprint.size)});}
class OrdinaryCpuService extends EncoderService {
  #candidate;#budget;#closePromise;
  constructor(options,candidate,budget){super(options);this.#candidate=candidate;this.#budget=budget;}
  async getCapabilities(){if(!this.capabilityResult&&this.state.phase!=='checking'){this.requireIdle();this.#budget.begin('discovery');}const caps=await super.getCapabilities();if(this.#budget.state().phase==='discovery')this.#budget.settle('discovery');return {...caps,profiles:caps.profiles.filter(p=>p.id===SETTINGS.profileId).map(p=>({...p,candidateFixedSettings:true,bitDepths:[8],supportedBitDepths:(p.supportedBitDepths||[]).filter(depth=>depth===8),presets:[SETTINGS.preset],defaultPreset:SETTINGS.preset,quality:{...p.quality,min:SETTINGS.quality,max:SETTINGS.quality,default:SETTINGS.quality}})),recipes:[],vendorProfiles:[]};}
  async getPreferences(){return {...await super.getPreferences(),profileId:SETTINGS.profileId,settingsByProfile:{[SETTINGS.profileId]:{preset:SETTINGS.preset,quality:SETTINGS.quality}}};}
  getRecipe(request){assert.deepEqual(request,SETTINGS);const recipe=super.getRecipe(request);const {testedDefault,...current}=recipe;return {...recipe,testedDefault:{...current},mediaNote:'This explicit candidate admits only 8-bit H264 SDR input, Full / Keep source / compatible AAC copy. '+recipe.mediaNote};}
  async resetProfile(request){assert.deepEqual(request,{profileId:SETTINGS.profileId});await this.saveSettings({...SETTINGS});return this.getPreferences();}
  async saveSettings(value){assert.deepEqual(value,SETTINGS);return super.saveSettings(value);}
  async prepareSourceBatch(request,operation,native=null){assert(operation==='encode'&&!native);this.requireIdle();await this.getCapabilities();assert.deepEqual(request.settings,SETTINGS);this.#budget.begin('preparation');const result=await super.prepareSourceBatch(request,operation,native);if(this.state.phase==='ready')this.#budget.settle('preparation');else this.#budget.abort();return result;}
  async reprepareDraft(options){this.requireIdle();this.#budget.begin('preparation');const result=await super.reprepareDraft(options);if(this.state.phase==='ready')this.#budget.settle('preparation');else this.#budget.abort();return result;}
  async prepareWithWorkers(context){assert(this.state.items.length>=1&&this.state.items.length<=POLICY.maxBatchInputs,'Ordinary candidate accepts at most two inputs per batch.');return super.prepareWithWorkers(context);}
  async prepareItem(item,context){await super.prepareItem(item,context);if(this.plan?.entries.has(item.id)){try{requireOrdinaryEntry(this,item);}catch(error){this.plan.entries.delete(item.id);item.status='unsupported';item.reasonCode=error.code||'ORDINARY_ADMISSION';item.reason='Outside the explicitly scoped ordinary CPU candidate.';}}}
  startBatch(request){
    this.requireIdle();
    assert(this.state.items.length>=1&&this.state.items.length<=POLICY.maxBatchInputs);
    assert(Array.isArray(request?.fileIds)&&request.fileIds.length>=1&&request.fileIds.length<=POLICY.maxBatchInputs);
    assert.equal(new Set(request.fileIds).size,request.fileIds.length,'Duplicate selected inputs refused.');
    const entries=request.fileIds.map(fileId=>{
      const item=this.state.items.find(x=>x.id===fileId);assert(item);requireOrdinaryEntry(this,item);
      const entry=this.plan.entries.get(fileId);
      return {probe:entry.inspection.probe,settings:this.plan.settings,request:item.operationRequest,bytes:Number(entry.fingerprint.size)};
    });
    admitBatch(entries); // Main-owned selected entries, never renderer totals.
    this.#budget.begin('execution'); // One deadline for the entire shared serial loop.
    return super.startBatch(request);
  }
  snapshot(){return {...super.snapshot(),developerProduct:{enabled:true,relaunchRequired:this.admissionClosed,notice:'Explicit ordinary CPU candidate: H264 veryfast CRF23, Full / Keep source / AAC copy. One or two inspected SDR inputs, each up to 1080p; selected inputs together at most 1 GiB and 30 minutes. One ten-minute whole-batch execution safety deadline; not a speed guarantee or measured precision claim. Startup includes genuine capability attempts; CPU-only runtime refuses GPU commands. Host-pinned Linux runtime, not portable release.',relaunchNotice:'After cancellation close and reopen this separate candidate.'}};}
  async cancelCurrent(){this.closeAdmission();this.#budget.abort();return super.cancelCurrent();}
  closeOperationResources(){this.closeAdmission();return this.#closePromise ||= (async()=>{const errors=[];try{await super.closeOperationResources();}catch(e){errors.push(e);}try{this.#budget.close();}catch(e){errors.push(e);}try{await this.#candidate.close();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Ordinary candidate closure incomplete.');})();}
}
async function createOrdinaryCpuService(options){
  assert(options&&Object.getPrototypeOf(options)===Object.prototype&&Object.keys(options).every(k=>['verifiedRuntime','stateDir','outputAccess','onChild'].includes(k)));
  const {verifiedRuntime,stateDir,outputAccess,onChild}=options;assert(path.isAbsolute(stateDir)&&stateDir===path.resolve(stateDir)&&!/[\x00-\x1f\x7f]/.test(stateDir));assert(outputAccess===undefined||outputAccess instanceof OutputAccess);assert(onChild===undefined||typeof onChild==='function');
  const candidate=requireCandidateCalibrationRuntime(verifiedRuntime);let budget;
  try{guardEnvironment();assert.equal(candidate.runtimeIdentity,RUNTIME_ID);assert.equal(createHash('sha256').update(JSON.stringify(candidate.dependencies)).digest('hex'),DEPENDENCY_ID);await candidate.requireCurrent();
    const invoke=candidate.createRunner({onChild});budget=createPhaseRunner(async(...args)=>{guardEnvironment();await candidate.requireCurrent();return invoke(...args);});
    return new OrdinaryCpuService({ffmpeg:candidate.pins.ffmpeg.path,ffprobe:candidate.pins.ffprobe.path,stateDir,outputAccess,runtimeIdentity:RUNTIME_ID,run:budget.run,inspectionWorkers:1,
      ordinaryJobGuard:async facts=>{try{admit({probe:facts.inspection.probe,settings:facts.settings,request:facts.request,bytes:Number(facts.sourceIdentity.size)});await candidate.requireCurrent();const source=await fs.lstat(facts.sourceIdentity.canonicalPath);assert(source.isFile()&&!source.isSymbolicLink()&&source.nlink===1);budget.assertCurrent();const guard=await openOrdinaryStageGuard({...facts,signal:AbortSignal.any([facts.signal,budget.signal])});return Object.freeze({...guard,signal:AbortSignal.any([guard.signal,budget.signal]),async onStage(stage){try{await guard.onStage(stage);}catch(error){budget.abort();throw error;}},async beforePublish(stage){try{budget.assertCurrent();await guard.beforePublish(stage);await candidate.requireCurrent();budget.assertCurrent();}catch(error){budget.abort();throw error;}},async close(){try{await guard.close();}catch(error){budget.abort();throw error;}}});}catch(error){budget.abort();throw error;}}},candidate,budget);
  }catch(error){try{budget?.close();}catch{}try{await candidate.close();}catch(closeError){throw new AggregateError([error,closeError],'Ordinary construction and closure failed.');}throw error;}
}
module.exports={createOrdinaryCpuService,requireOrdinaryEntry};
