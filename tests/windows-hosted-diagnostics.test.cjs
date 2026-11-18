'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {atStage,failureDiagnostic}=require('../scripts/windows-hosted-archive-check.cjs');
test('distinct timeout boundaries remain distinguishable without exception content',async()=>{
 for(const stage of ['git-head','fixed-drive']) {
  const error=Object.assign(new Error('SECRET path and command'),{code:'ETIMEDOUT',stdout:'SECRET',stderr:'SECRET'});
  await assert.rejects(atStage(stage,()=>{throw error;}), e=>e===error);
  const d=failureDiagnostic(error);assert.equal(d.stage,stage);assert.equal(d.code,'ETIMEDOUT');assert.equal(d.attestedReport,false);assert(!JSON.stringify(d).includes('SECRET'));
 }
});
test('unrecognized codes and names are not printed',async()=>{
 await atStage('event-read',()=>{});
 const d=failureDiagnostic({name:'PRIVATE',code:'PRIVATE',message:'PRIVATE',stack:'PRIVATE'});
 assert.equal(d.kind,'Error');assert.equal(d.code,'UNCLASSIFIED');assert(!JSON.stringify(d).includes('PRIVATE'));assert(JSON.stringify(d).length<256);
});
test('async error retains boundary and cannot manufacture a report',async()=>{
 const e=Object.assign(new Error('unavailable'),{code:'ENOENT'});
 await assert.rejects(atStage('report-publication',async()=>{throw e;}),x=>x===e);
 assert.deepEqual(failureDiagnostic(e),{schema:1,state:'PREFLIGHT_OR_REPORT_INCOMPLETE',stage:'report-publication',kind:'Error',code:'ENOENT',attestedReport:false});
});
test('unknown label rejected before action',async()=>{
 let called=false;await assert.rejects(atStage('PRIVATE',()=>{called=true}));assert.equal(called,false);assert.notEqual(failureDiagnostic(new Error()).stage,'PRIVATE');
});
