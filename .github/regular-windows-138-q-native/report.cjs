'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {SUITES,summary}=require('./suite-child.cjs');
const hex=(x,n)=>typeof x==='string'&&x.length===n&&/^[a-f0-9]+$/.test(x);
const readbackKinds=['verified','failed','not-run'];
const phases=['capacity','archive','provision','runtime','suites','readback'];
const runCodes=['TIMEOUT','CLOSURE_UNCONFIRMED','TEST_FAILED','BOUNDARY_REFUSED'];
const itemCodes=['OWNERSHIP','TIMEOUT','OUTPUT_LIMIT','CHILD_PROTOCOL','UNEXPECTED_CHILD','TEST_FAILED','CLOSURE_UNCONFIRMED'];
function pin(v){assert(hex(v?.sha256,64)&&Number.isSafeInteger(v?.sizeBytes)&&v.sizeBytes>0&&v.sizeBytes<2**31);return {sha256:v.sha256,sizeBytes:v.sizeBytes};}
function project({id,harnessTree,policy,result}){
  for(const x of [id.head,id.seed,harnessTree,policy.source,policy.tree])assert(hex(x,40));
  assert(/^[1-9]\d{0,18}$/.test(id.runId)&&id.attempt===1&&result);
  const readback={};
  for(const k of ['harness','product','runtime']){
    assert(readbackKinds.includes(result.readback[k]));readback[k]=result.readback[k];
  }
  const report={schema:'windows-regular-q-native-remux-suites/v2',runId:id.runId,attempt:1,
    activation:id.head,seed:id.seed,harnessTree,product:policy.source,productTree:policy.tree,
    requiredFreeBytes:String(policy.floor),state:'FAILED_OR_INCOMPLETE',failure:null,
    readback,suites:{},scope:'native-cli-and-node-tests-only',fixtureInputs:'checked-in-bounded-synthetic-only',
    app:'not-run',installer:'not-run',gpu:'not-run',distribution:'sanitized-job-log-only'};
  if(result.failure){
    assert(phases.includes(result.failure.phase)&&runCodes.includes(result.failure.code));
    report.failure={phase:result.failure.phase,code:result.failure.code};
  }
  if(result.runtime){
    const r=result.runtime;
    assert(r.notices?.length===2&&r.versions?.length===2&&hex(r.extractorSha256,64)&&hex(r.listingSha256,64));
    report.runtime={archive:pin(r.archive),extractorSha256:r.extractorSha256,listingSha256:r.listingSha256,notices:r.notices.map(pin),
      versions:r.versions.map((v,i)=>{assert(v.name===['ffmpeg.exe','ffprobe.exe'][i]&&v.version==='9.0.2-full_build-www.gyan.dev');
        return {name:v.name,version:v.version,...pin(v)};})};
  }
  for(const [key,expected] of Object.entries(SUITES)){
    const v=result.suites[key];
    if(!v){report.suites[key]={state:'not-run',expected};continue;}
    assert(['passed','failed'].includes(v.state)&&['normal','forced-owned','unconfirmed','not-started'].includes(v.close));
    const counts=v.counts===null?null:summary(key,{success:v.state==='passed',counts:v.counts}).counts;
    assert(Number.isSafeInteger(v.samples)&&v.samples>=0&&v.samples<=1800);
    assert(Number.isSafeInteger(v.observedChildren)&&v.observedChildren>=0&&v.observedChildren<=2048);
    assert(v.remaining===null||Number.isSafeInteger(v.remaining)&&v.remaining>=0&&v.remaining<=2049);
    if(v.close==='not-started')assert(v.code==='TIMEOUT'&&counts===null&&v.samples===0&&v.observedChildren===0&&v.remaining===null);
    const complete=counts?.tests===expected&&counts.passed===expected&&v.close==='normal'&&v.remaining===0;
    if(v.state==='passed')assert(complete&&v.samples>=3&&v.code===null);
    else assert(itemCodes.includes(v.code));
    report.suites[key]={state:v.state,expected,counts,code:v.code,close:v.close,custody:{
      kind:'sampled-direct-pinned-children',samples:v.samples,observedChildren:v.observedChildren,remaining:v.remaining}};
  }
  if(!report.failure){
    assert(report.runtime&&Object.values(readback).every(v=>v==='verified'));
    assert(Object.values(report.suites).every(v=>v.state==='passed'));
    assert(Object.values(report.suites).some(v=>v.custody.observedChildren>0));
    report.state='PASSED';
  }
  return report;
}
function publish(input,write=console.log){
  const report=project(input),bytes=Buffer.from(JSON.stringify(report),'utf8');
  assert(bytes.length<12288);
  const sha=createHash('sha256').update(bytes).digest('hex');
  // Actions log is the sole reporting output. The line contains only the
  // explicit validated projection; no test text, provider paths or media.
  write('WIN_Q_REPORT_SHA256 '+sha);
  write('WIN_Q_REPORT_JSON '+bytes.toString('utf8'));
  return report.state==='PASSED';
}
module.exports={project,publish};
