'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EncoderService}=require('../src/encoder-service.cjs');
function service(){const s=Object.create(EncoderService.prototype);s.operationEvidenceBudget=null;s.operationDeadlineMs=120000;s.plan={settings:{profileId:'h265-cpu',preset:'slow',quality:25}};return s;}
test('base control resolver retains configurable Windows and null Linux defaults',()=>{
 const s=service();assert.deepEqual(s.resolveEncodeControls({},s.plan.settings),{budget:null,executionBudgetMs:120000});
 const budget={sourceDecode:'complete',timeoutMs:120000};s.operationEvidenceBudget=budget;s.operationDeadlineMs=600000;
 assert.deepEqual(s.resolveEncodeControls({},s.plan.settings),{budget,executionBudgetMs:600000});assert.equal(s.operationEvidenceBudget,budget);
});
test('prepared Encode currentness compares settings and budgets',()=>{
 const s=service(),e={operationPlan:{compatibilityPath:false},encodeControlsOwner:s.plan,encodeControlsSettings:structuredClone(s.plan.settings),encodeControls:Object.freeze({budget:null,executionBudgetMs:120000})};
 assert.equal(s.requirePreparedEncodeControls(e),e.encodeControls);s.operationDeadlineMs=600000;
 assert.throws(()=>s.requirePreparedEncodeControls(e),{code:'OPERATION_CONTROLS_STALE'});s.operationDeadlineMs=120000;
 s.plan.settings.quality=24;assert.throws(()=>s.requirePreparedEncodeControls(e),{code:'OPERATION_CONTROLS_STALE'});
});
test('ordinary Remux HDR and preservation entries bypass Encode override',()=>{
 const s=service();s.resolveEncodeControls=()=>{throw Error('wrong seam');};
 for(const e of [{operationPlan:{compatibilityPath:true}},{remux:true},{hdr:true},{encodePreservation:true},{native:true},{vendor:true}])assert.equal(s.requirePreparedEncodeControls(e),null);
});
test('Start contract refusal precedes queue or draft mutation',()=>{
 const s=service();s.requireIdle=()=>{};s.state={phase:'ready',items:[{id:'11111111-1111-4111-8111-111111111111',status:'ready',outputName:'x.mkv'}]};s.plan.id='22222222-2222-4222-8222-222222222222';s.plan.entries=new Map([['11111111-1111-4111-8111-111111111111',{operationPlan:{compatibilityPath:false}}]]);let frozen=false;s.plan.draft={freezeForQueue(){frozen=true;}};
 assert.throws(()=>s.startBatch({planId:'22222222-2222-4222-8222-222222222222',fileIds:['11111111-1111-4111-8111-111111111111']}),{code:'OPERATION_CONTROLS_STALE'});assert.equal(s.state.items[0].status,'ready');assert.equal(frozen,false);
});
test('override accessor and nonfinite control data are refused without invoking getters',()=>{
 const s=service(),e={operationPlan:{compatibilityPath:false}};let invoked=0;
 s.resolveEncodeControls=()=>Object.defineProperty({executionBudgetMs:600000},'budget',{enumerable:true,get(){invoked++;return null;}});
 assert.throws(()=>s.requirePreparedEncodeControls(e),{code:'OPERATION_CONTROLS_INVALID'});assert.equal(invoked,0);
 for(const ms of [0,-1,Infinity,1800001]){s.resolveEncodeControls=()=>({budget:null,executionBudgetMs:ms});assert.throws(()=>s.requirePreparedEncodeControls(e),{code:'OPERATION_CONTROLS_INVALID'});}
});
