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

// Execute the actual package preflight body with inert Windows dependencies.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function packagePreflight(output='3\r\n',error=null,available=100n*1024n**3n){
 const source=fs.readFileSync(path.join(__dirname,'../scripts/windows-hosted-package-check.cjs'),'utf8');
 const start=source.indexOf('async function preflight('),end=source.indexOf('\nasync function treeBound',start);
 const calls=[];let stats=0;
 const sandbox={assert,path:path.win32,process:{platform:'win32',arch:'x64',env:{SystemRoot:'C:\\Windows'}},localDrivePath:p=>assert(/^[A-Z]:\\/.test(p)),assertOrdinaryPath:async()=>{},requiredFree:()=>27n*1024n**3n,fs:{statfs:async()=>{stats++;return {bavail:available,bsize:1n}}},execFileSync:(...args)=>{calls.push(args);if(error)throw error;return output;}};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+';this.run=preflight',sandbox);
 const d=require('../scripts/windows-hosted-package-check.cjs').createPreflightDiagnostic();
 return {run:()=>sandbox.run('C:\\source','C:\\stage',{archive:{},electron:{archive:{}}},d),calls,stats:()=>stats,d};
}
test('package drive check uses one direct DriveInfo query, unchanged ten-second bound and capacity gate',async()=>{
 const x=packagePreflight();await x.run();assert.equal(x.calls.length,1);assert.equal(x.stats(),1);
 const [exe,args,opts]=x.calls[0];assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.equal(args.join('|'),"-NoProfile|-NonInteractive|-Command|$ErrorActionPreference='Stop'; $d=[System.IO.DriveInfo]::new('C:\\'); Write-Output ([int]$d.DriveType)");
 assert.equal(opts.timeout,10000);assert.equal(opts.maxBuffer,1024);assert.equal(opts.windowsHide,true);
});
test('nonfixed unknown malformed and empty drive responses refuse before capacity',async()=>{
 for(const output of ['0','1','2','4','5','6','','Fixed','3\n4','3 SECRET']){const x=packagePreflight(output);await assert.rejects(x.run());assert.equal(x.calls.length,1);assert.equal(x.stats(),0);assert.equal(x.d.failure({}).phase,'fixed-drive-type');}
});
test('drive timeout fails closed with no retry, capacity query or raw diagnostic disclosure',async()=>{
 const error=Object.assign(new Error('SECRET'),{code:'ETIMEDOUT',stdout:'SECRET'}),x=packagePreflight('',error);
 await assert.rejects(x.run(),e=>e===error);assert.equal(x.calls.length,1);assert.equal(x.stats(),0);
 assert.deepEqual(x.d.failure(error),{schema:1,state:'PREFLIGHT_OR_REPORT_UNAVAILABLE',phase:'fixed-drive-process',code:'ETIMEDOUT',capacity:null});
});
test('fixed disk with insufficient capacity still refuses original floor',async()=>{
 const x=packagePreflight('3',null,1n);await assert.rejects(x.run());assert.equal(x.d.failure({}).phase,'capacity-floor');assert.equal(x.d.failure({}).capacity.meetsFloor,false);
});
