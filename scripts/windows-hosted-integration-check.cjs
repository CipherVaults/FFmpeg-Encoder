'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const {createHash}=require('node:crypto');const {execFileSync}=require('node:child_process');
const {execute,readHostedEvent}=require('./windows-hosted-package-check.cjs');
const {authority,diagnostic,assertSecurity,journey}=require('./windows-packaged-integration.cjs');
const {retainDirectory}=require('./acquire-candidate-archives.cjs');
const {verifyPinnedFile}=require('../src/candidate-runtime.cjs');
function primaryFailure(phase,error,result){
  if(result?.failure){assert.deepEqual(result.failure,diagnostic(result.failure.phase,{code:result.failure.code}));return {...result.failure};}
  return diagnostic(phase,error);
}
function sanitized(identity,result,failure=null,build=null){
  assert(identity&&Object.keys(identity).sort().join(',')==='attempt,head,runId'&&/^[a-f0-9]{40}$/.test(identity.head)&&/^\d+$/.test(identity.runId)&&identity.attempt===1);
  if(failure)assert.deepEqual(failure,diagnostic(failure.phase,{code:failure.code}));
  const report={schema:'windows-packaged-cpu-integration/v1',...identity,state:failure?'INTEGRATION_FAILED':'INTEGRATION_PASSED',picker:'substituted-dialog-return',gpu:'not-qualified',nativeDesktop:'not-qualified',distribution:'report-only',failure};
  if(result){
    for(const key of ['fixtureGenerationCalls','requestedEncodes','extraDecodeCalls','probeReadbackCalls']){assert(Number.isSafeInteger(result[key])&&result[key]>=0&&result[key]<=1);report[key]=result[key];}
    assert(['pending','normal','unconfirmed','forced-owned-tree'].includes(result.close));report.close=result.close;
    report.sourceUnchanged=result.sourceUnchanged===true;report.packageUnchanged=result.packageUnchanged===true;report.collisionRefused=result.collisionRefused===true;
    if(result.output){assert(/^[a-f0-9]{64}$/.test(result.output.sha256)&&Number.isSafeInteger(result.output.sizeBytes)&&result.output.sizeBytes>0&&result.output.sizeBytes<=16*1024*1024);report.output={sha256:result.output.sha256,sizeBytes:result.output.sizeBytes};}
    if(result.processObservation){const o=result.processObservation;assert(['sampled-not-exhaustive','unobserved-launch'].includes(o.kind));report.processObservation={kind:o.kind};for(const key of ['samples','observedDescendants','observedStartupMedia','observedLiveAfterClose']){if(o.kind==='unobserved-launch'&&key==='observedLiveAfterClose')assert(o[key]===null);else assert(Number.isSafeInteger(o[key])&&o[key]>=0&&o[key]<=1200);report.processObservation[key]=o[key];}}
    if(result.cleanupFailure){assert.deepEqual(result.cleanupFailure,diagnostic(result.cleanupFailure.phase,{code:result.cleanupFailure.code}));report.cleanupFailure={...result.cleanupFailure};}
    report.startupDiscovery='unchanged-production-including-GPU-capability-attempts';
    if(result.launchOwnership){assert(result.launchOwnership==='verified-shell-launcher-and-pinned-main');report.launchOwnership=result.launchOwnership;}
    if(result.security){report.security=Object.fromEntries(['packaged','sandbox','contextIsolation','nodeIntegration'].map(k=>{assert(typeof result.security[k]==='boolean');return [k,result.security[k]];}));}
  }
  if(build){report.build={};for(const key of ['asar','executable','zip']){const pin=build[key];assert(pin&&/^[a-f0-9]{64}$/.test(pin.sha256)&&Number.isSafeInteger(pin.sizeBytes)&&pin.sizeBytes>0);report.build[key]={sha256:pin.sha256,sizeBytes:pin.sizeBytes};}}
  if(!failure){assertSecurity(result.security);assert(report.launchOwnership==='verified-shell-launcher-and-pinned-main');assert(report.build&&report.collisionRefused);assert(!result.failure&&!result.cleanupFailure);assert(report.processObservation?.kind==='sampled-not-exhaustive'&&report.processObservation.samples>0&&report.processObservation.observedLiveAfterClose===0);}
  if(!failure)assert(report.requestedEncodes===1&&report.fixtureGenerationCalls===1&&report.probeReadbackCalls===1&&report.extraDecodeCalls===0&&report.close==='normal'&&report.sourceUnchanged&&report.packageUnchanged&&report.output);
  return report;
}
async function publish(parent,report,output){
  const owner=await retainDirectory(parent),dir=await fs.mkdtemp(path.join(parent,'integration-report-'));await owner();const file=path.join(dir,'report.json');
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');assert(bytes.length<16384);await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});const pin={sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};await verifyPinnedFile(file,pin);assert(!/[\r\n]/.test(file));await fs.appendFile(output,`report_path=${file}\nreport_sha256=${pin.sha256}\nreport_ready=true\n`);return pin.sha256;
}
async function main(){
  const root=path.resolve(__dirname,'..'),parent=process.env.RUNNER_TEMP;
  let phase='authority',identity,result,buildIdentity,failure=null;
  try{
    assert(process.argv.length===2);identity=authority(process.env,await readHostedEvent(process.env.GITHUB_EVENT_PATH));
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024}).trim(),identity.head);
    execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:root,timeout:10000,maxBuffer:1024});
    phase='build';let calls=0;
    await execute({root,parent,identity:{...identity,attempt:'1'}},{onVerifiedBuild:async built=>{assert(++calls===1);buildIdentity=built;result=await journey({built,parent,onPhase:p=>{phase=p;}},{electron:require('playwright')._electron});}});
    assert.equal(calls,1);
  }catch(error){result=error.integrationResult||result;failure=primaryFailure(phase,error,result);process.exitCode=1;}
  // An invalid authority never yields a publishable success or arbitrary output path.
  if(!identity){console.error(JSON.stringify({state:'INTEGRATION_NOT_ADMITTED',failure}));return;}
  const report=sanitized(identity,result,failure,buildIdentity);console.log('Packaged integration report SHA256 '+await publish(parent,report,process.env.GITHUB_OUTPUT));
}
module.exports={primaryFailure,sanitized,publish};
if(require.main===module)main().catch(()=>{console.error('Integration report unavailable.');process.exitCode=1;});
