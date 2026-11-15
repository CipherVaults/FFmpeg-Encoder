'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admission}=require('../scripts/v07-remux-admission-audit.cjs');
test('legacy after mode never reuses a baseline without its actual dependency binding',async()=>{
  await assert.rejects(require('../scripts/v07-remux-admission-audit.cjs').after({counts:{},rows:[]}),/Unbound or changed legacy baseline/);
});
test('census passes the application-derived budget to native admission, without a fixed short-file deadline',async()=>{
  let captured,derived=false;
  const assessment={status:'qualification-required'},budget={maxRecords:193000,timeoutMs:7260000,maxSpoolBytes:123456789};
  const implementation={assessRemux:()=>assessment,deriveRemuxAssessmentBudget:(a,bytes,method)=>{
    assert.equal(a,assessment);assert.equal(bytes,'2500000000');assert.equal(method,'packet-identity-v1');derived=true;return{budget};
  },observeNativeInventory:async options=>{captured=options;}};
  const probe={streams:[],format:{format_name:'matroska,webm',size:'2500000000'}};
  assert.deepEqual(await admission('inert-not-opened.mkv',probe,implementation),{status:'accepted',family:'matroska'});
  assert.ok(derived);for(const [key,value]of Object.entries(budget))assert.equal(captured[key],value);
});
test('census keeps contract and derived-resource refusals and never labels an uninspected source accepted',async()=>{
  const probe={streams:[],format:{format_name:'matroska,webm',size:'10'}};
  const blocked={assessRemux:()=>({status:'blocked',blockers:[{code:'SOURCE_UNKNOWN'}]}),observeNativeInventory:()=>assert.fail('Blocked source reached native admission')};
  assert.equal((await admission('not-opened.mkv',probe,blocked)).stage,'contract');
  const limited={assessRemux:()=>({status:'qualification-required'}),deriveRemuxAssessmentBudget:()=>{const e=Error('Source resources cannot be bounded');e.code='REMUX_PROPORTIONAL_BUDGET';throw e;},observeNativeInventory:()=>assert.fail('Unbounded source reached native admission')};
  const r=await admission('not-opened.mkv',probe,limited);assert.equal(r.status,'refused');assert.equal(r.code,'REMUX_PROPORTIONAL_BUDGET');
});
