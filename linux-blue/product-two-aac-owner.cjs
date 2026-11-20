'use strict';
const path=require('node:path'),{RemuxOperations}=require('../src/remux-operation.cjs');
const {getRemuxAssessmentSource}=require('../src/remux-contract.cjs');
const {ToolError}=require('../src/process-runner.cjs');
const {qualifyTwoAacMp4Source,verifyTwoAacMp4Evidence}=require('./product-two-aac-evidence.cjs');
const {observePreparedCustody}=require('./product-two-aac-custody.cjs');
const {requireServiceEmittedRemuxStage}=require('../src/encoder-service.cjs');
const {loadTwoAacRecord}=require('./product-two-aac-record.cjs');
const {isDeepStrictEqual}=require('node:util');
const base=RemuxOperations.prototype,model=new WeakMap();
const CELL='internal-isobmff-mp4-q2l-two-aac-v1';
const STALE='REMUX_OPERATION_STALE',REQUIRED='REMUX_QUALIFICATION_REQUIRED';
function need(ok,msg,code=STALE){if(!ok)throw new ToolError(code,msg);}
function brand(){return Object.freeze({});}
function candidate(assessment,service,id){
  if(assessment.inputFamily!=='isobmff'||assessment.target!=='mp4')return false;
  const source=getRemuxAssessmentSource(assessment),audio=source.streams.filter(x=>x.codec_type==='audio');
  if(audio.length>=2&&assessment.request.omissionRequestIds.length===0){
    // Only the preserve-both cell is being considered. It never accepts an
    // omission; remove these choices before the shared item emits any state.
    const batch=service.plan,item=service.state.items.find(x=>x.id===id);
    if(batch?.operation==='remux'&&item?.remux?.target==='mp4'){
      for(const [key,choice]of batch.remuxCandidates)if(choice.fileId===id&&choice.planId===batch.id)batch.remuxCandidates.delete(key);
      item.remux.omissionCandidates=[];
    }
  }
  if(audio.length>2)throw new ToolError('REMUX_AUDIO_TRACK_COUNT_UNSUPPORTED','Verified MP4 copy supports at most two qualified AAC tracks. No track was omitted.');
  return audio.length===2;
}
// The only installer is the normal main-process unified service. Source,
// phase and route are never inferred from a filename or renderer decision.
function installProductTwoAac(legacy,generation,service){
  const record=loadTwoAacRecord();
  if(record===null)return legacy;
  need(legacy instanceof RemuxOperations&&generation===service.generation&&generation.candidate?.runtimeIdentity===record.runtimeIdentity
    &&record.cellId===CELL&&typeof generation.bindRemux==='function','No current paired two-track generation.',REQUIRED);
  const other=new RemuxOperations({runtimeIdentity:record.runtimeIdentity,policyIdentity:record.policyIdentity,policies:[
    {id:record.cellId,evidenceIds:[record.evidenceId],inputFamily:'isobmff',target:'mp4',runtimeIdentity:record.runtimeIdentity,
      verificationMethod:'packet-identity-v1',allowAncillary:false,allowRotation90:false}]});
  const active=new Map(),plans=new WeakMap(),tokens=new WeakMap(),used=new Set();
  let epoch=0;
  const dispose=s=>{if(s&&active.get(s.id)===s)active.delete(s.id);s?.custody?.close();};
  const checked=s=>{
    need(s&&s.epoch===epoch&&active.get(s.id)===s&&service.plan===s.batch&&service.generation===generation
      &&service.remuxOperations===api&&!service.cancellation&&!service.shuttingDown,'The prepared MP4 copy changed. Prepare the file again.');
  };
  const lookup=(token,b)=>{
    const s=tokens.get(token);checked(s);need(s.token===token&&s.plan===b.plan,'The prepared selection changed.');
    if(s.two){s.custody.current();const entry=s.batch.entries.get(s.id);need(entry?.qualificationSelection===s.token&&entry.operationPlan===s.plan
      &&entry.file===s.input&&entry.destination===s.output&&entry.outputId===s.outputId,'The current service entry no longer owns this selection.');}
    const q=base.requireCurrent.call(s.owner,s.inner,b);
    if(s.two)need(q.qualification.cellId===record.cellId&&q.qualification.evidenceId===record.evidenceId&&q.policyIdentity===record.policyIdentity
      &&q.verificationMethod==='packet-identity-v1'&&isDeepStrictEqual(q.sourcePolicy.audioInputIndexes,[1,2]),'The two-track evidence owner changed.');
    return {s,q};
  };
  const api=Object.freeze({
    prepare(o){
      const id=o.request.fileId;dispose(active.get(id));need(generation===service.generation&&service.plan?.operation==='remux','Prepare in the current service workspace.');
      const two=candidate(o.assessment,service,id),owner=two?other:legacy,batch=service.plan;
      if(two){qualifyTwoAacMp4Source(o.assessment);
        need(!batch.sameFolder&&path.dirname(o.input)===batch.input&&path.dirname(o.output)===batch.output&&o.input!==o.output
          &&path.extname(o.input).toLowerCase()==='.mp4'&&path.extname(o.output).toLowerCase()==='.mp4',
          'Choose separate registered source and output folders for this two-track MP4 copy.',REQUIRED);}
      need(!used.has(o.outputId),'A fresh output identity is required.');used.add(o.outputId);
      const plan=owner.prepare(o);
      const s={id,epoch,batch,plan,two,owner,assessment:o.assessment,sourceIdentity:o.sourceIdentity,input:o.input,output:o.output,outputId:o.outputId,
        inner:null,token:null,bound:false,stage:null,custody:null,validation:false};
      plans.set(plan,s);active.set(id,s);return plan;
    },
    select(b){
      const s=plans.get(b.plan);checked(s);need(!s.bound,'The current Start was already consumed.');
      if(s.custody){s.custody.close();s.custody=null;}
      const inner=base.select.call(s.owner,b),q=base.requireCurrent.call(s.owner,inner,b);
      if(s.two){
        need(q.qualification.cellId===record.cellId&&q.qualification.evidenceId===record.evidenceId&&isDeepStrictEqual(q.sourcePolicy.audioInputIndexes,[1,2]),'Missing actual selected audio streams.');
        s.custody=observePreparedCustody({source:s.input,sourceIdentity:s.sourceIdentity,input:s.batch.input,output:s.batch.output,
          destination:s.output,folderIdentities:s.batch.folderIdentities,maxOutputBytes:q.budget.maxOutputBytes,requireOwner:()=>checked(s)});
      }
      s.inner=inner;s.token=brand();tokens.set(s.token,s);return s.token;
    },
    requireCurrent(token,b){return lookup(token,b).q;},
    bindForStart(token,getBindings){
      const {s,q}=lookup(token,getBindings());need(!s.two||!s.bound,'This two-track Start already consumed its generation.');s.bound=true;
      const read=()=>{const b=getBindings();lookup(token,b);return b;};
      try{const control=generation.bindRemux(s.owner,s.inner,read);read();
        return Object.freeze({selected:q,control,two:s.two,requireCurrent:()=>lookup(token,getBindings()).q});
      }catch(e){if(s.two)dispose(s);throw e;}
    },
    isTwoPlan(plan){return plans.get(plan)?.two===true;},
    stageCreated(entry,q,stage){
      requireServiceEmittedRemuxStage(service,entry,stage);
      const s=plans.get(entry.operationPlan);checked(s);need(s.two&&s.bound&&!s.stage&&s.batch.entries.get(s.id)===entry
        &&service.executionBinding?.entry===entry&&service.executionBinding.selected===q&&service.executionBinding.generation===generation,
        'This entry and active generation must own the emitted stage.');s.custody.claim(stage);s.stage=stage;
    },
    resolveInvocation(plan,o){
      const s=plans.get(plan);checked(s);if(s.two){need(s.bound&&s.stage?.file===o.output,'Only the actual bound fresh service stage is available.');s.custody.invocation(o.output);}
      return base.resolveInvocation.call(s.owner,plan,o);
    },
    validate(plan,probe,receipt,optional){
      const s=plans.get(plan);checked(s);
      if(s.two){need(s.bound&&s.stage&&!s.validation,'Only a single actual stage validation is available.');s.custody.beforeValidation();
        need(receipt?.sourcePath===s.input&&receipt.outputPath===s.stage.file,'The observed source and actual emitted stage do not match.');
        verifyTwoAacMp4Evidence({assessment:s.assessment,receipt,runtimeIdentity:record.runtimeIdentity,outputId:s.outputId,outputProbe:probe});s.custody.matchReceipt(receipt);}
      const result=base.validate.call(s.owner,plan,probe,receipt,optional);
      if(s.two&&result.valid===true){s.custody.verified();s.validation=true;}
      return result;
    },
    beforePublish(entry,q){
      const s=plans.get(entry.operationPlan);checked(s);need(s.two&&s.validation&&s.stage&&service.executionBinding?.selected===q
        &&service.executionBinding.entry===entry&&s.batch.entries.get(s.id)===entry,'Only the verified current stage can be published.');
      s.custody.beforePublish();
    },
    invalidate(){epoch++;const errors=[];for(const s of [...active.values()]){try{dispose(s);}catch(e){errors.push(e);}}
      base.invalidate.call(legacy);base.invalidate.call(other);if(errors.length)throw new AggregateError(errors,'Two-track custody retirement was incomplete.');}
  });
  model.set(api,true);return api;
}
function composed(owner){return model.has(owner);}
module.exports=Object.freeze({installProductTwoAac,composed,CELL});
