'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
test('internal qualification binds exact accepted evidence while native/release acceptance stays pending', () => {
 const q=require('../linux-blue/product-linux-qualification.cjs').loadQualification();
 assert.equal(q.scope,'internal-opt-in-single-family-candidate');assert.equal(q.nativeProof,null);assert.equal(q.productIntegrationReview,null);
 assert.equal(q.internalCandidateDecision.distributionReady,false);assert(q.supportingEvidence.serviceRelease.bytes>0);assert.match(q.supportingEvidence.serviceRelease.sha256,/^[a-f0-9]{64}$/);
});
test('compact calibration record carries measured values, not runtime approval flags', () => {
  const r = require('../linux-blue/product-linux-qualification.json');
  assert.equal(r.rawCalibration.sizeBytes,125817);
  assert.equal(r.family.qualification.tolerances.sampleCount,0);
  assert.equal(r.nativeProof,null); assert.equal(r.productIntegrationReview,null);
  assert.equal(Object.hasOwn(r, 'approved'),false);
});
test('product factory uses relative runtime root and no raw report path', () => {
 const s = fs.readFileSync(path.join(root,'linux-blue/product-linux-shell.cjs'),'utf8');
 assert.ok(s.includes("path.join(runtimeRoot, 'ffmpeg')"));
 assert.ok(!s.includes('REPORT')); assert.ok(!s.includes('artifacts'));
});
test('main opt-in is Linux only and uses app-data state by default', () => {
 const s=fs.readFileSync(path.join(root,'main.js'),'utf8');
 assert.ok(s.includes("process.platform === 'linux' && app.commandLine.hasSwitch('linux-product-candidate')"));
 assert.ok(s.includes("path.join(app.getPath('appData'), 'FFmpegEncoder-Linux-Candidate')"));
 assert.ok(s.includes('else {\n  // A separate verified namespace'));
});

const vm = require('node:vm'), os = require('node:os'), {createRequire}=require('node:module');
function injected(file, substitutions={}, dirname=path.dirname(file)) {
 const m={exports:{}}, original=createRequire(file);
 vm.runInThisContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})')(
  n=>Object.hasOwn(substitutions,n)?substitutions[n]:original(n),m,m.exports,dirname);
 return m.exports;
}
const qualificationFile=path.join(root,'linux-blue/product-linux-qualification.cjs');
test('bounded compact record is recursively immutable and has a real source closure',()=>{
 const q=require(qualificationFile),v=q.readCompactQualification();assert(Object.isFrozen(v.family.qualification.tolerances));
 assert(q.verifyProductSources().files>100);assert.equal(q.verifyProductSources().usableForEncoding,false);
});
test('ordinary compact reader refuses oversized, modified, linked and nonregular files before approval',t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'product-record-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const dest=path.join(temp,'product-linux-qualification.json'),bytes=fs.readFileSync(path.join(root,'linux-blue/product-linux-qualification.json'));
 const q=injected(qualificationFile,{},temp);
 fs.writeFileSync(dest,bytes);assert.equal(q.readCompactQualification().nativeProof,null);
 fs.writeFileSync(dest,Buffer.alloc(16385));assert.throws(()=>q.readCompactQualification(),{code:'LINUX_PRODUCT_QUALIFICATION_CHANGED'});
 fs.writeFileSync(dest,Buffer.from(bytes.toString().replace('125817','125818')));assert.throws(()=>q.readCompactQualification());
 fs.unlinkSync(dest);fs.symlinkSync(path.join(root,'linux-blue/product-linux-qualification.json'),dest);assert.throws(()=>q.readCompactQualification());
 fs.unlinkSync(dest);fs.mkdirSync(dest);assert.throws(()=>q.readCompactQualification());
});
test('changed product source is refused instead of an unchecked provenance flag',t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'product-source-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 fs.mkdirSync(path.join(temp,'linux-blue'));fs.writeFileSync(path.join(temp,'main.js'),'changed');
 const q=injected(qualificationFile,{},path.join(temp,'linux-blue'));
 assert.throws(()=>q.verifyProductSources(),{code:'LINUX_PRODUCT_SOURCE_CHANGED'});
});
function shellFixture({fail=false}={}) {
 const events=[],runtime={close:async()=>events.push('runtime-close')};
 const service={getCapabilities:async()=>({profiles:[{id:'h265-cpu',quality:{}},{id:'nvenc'}],recipes:['x'],vendorProfiles:['x']}),getPreferences:async()=>({}),closeOperationResources:async()=>runtime.close()};
 const shell=injected(path.join(root,'linux-blue/product-linux-shell.cjs'),{
  './product-linux-qualification.cjs':{loadQualification:()=>{events.push('qualification');return {}; }},
  './candidate-calibration-runtime.cjs':{openCandidateCalibrationRuntime:async()=>{events.push('runtime-open');return runtime;}},
  './product-linux-service.cjs':{createLinuxProductService:async o=>{assert.equal(o.verifiedRuntime,runtime);events.push('service');if(fail)throw new Error('service failed');return service;}}
 });return {shell,events,service};
}
test('injected positive shell composes only one CPU profile and drains owned runtime',async()=>{
 const f=shellFixture(),s=await f.shell.createLinuxProductShell({stateDir:'/inert-state',runtimeRoot:'/inert-runtime'});
 assert.deepEqual(f.events,['qualification','runtime-open','service']);
 const c=await s.getCapabilities();assert.deepEqual(c.profiles.map(x=>x.id),['h265-cpu']);assert.deepEqual(c.recipes,[]);assert.equal(c.profiles[0].quality.min,25);
 assert.equal(s.linuxRemuxStatus.available,false);await s.closeOperationResources();assert.equal(f.events.at(-1),'runtime-close');
});
test('injected shell construction failure closes runtime; fake OutputAccess refuses',async()=>{
 const f=shellFixture({fail:true});await assert.rejects(f.shell.createLinuxProductShell({stateDir:'/inert-state',runtimeRoot:'/inert-runtime'}),/service failed/);assert.equal(f.events.at(-1),'runtime-close');
 await assert.rejects(f.shell.createLinuxProductShell({stateDir:'/inert-state',runtimeRoot:'/inert-runtime',outputAccess:{openPath(){}}}),{code:'CANDIDATE_WORKBENCH_OPTIONS'});
});
function serviceFixture({badHandle=false,badDependencies=false}={}){
 const events=[],file=path.join(root,'linux-blue/product-linux-service.cjs'),source=fs.readFileSync(file,'utf8');
 const dependencies=JSON.parse(source.match(/const DEPENDENCIES = (\[[\s\S]*?\n\]);/)[1]);
 const candidate={runtimeIdentity:'1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9',dependencies:badDependencies?[]:dependencies,pins:{ffmpeg:{path:'/inert/ffmpeg'},ffprobe:{path:'/inert/ffprobe'}},requireCurrent:async()=>events.push('current'),createRunner:()=>()=>{throw Error('must not execute');},close:async()=>events.push('candidate-close')};
 class Base {constructor(o){this.options=o;this.state={items:[]};this.plan={entries:new Map()};} snapshot(){return {items:this.state.items};}closeAdmission(){events.push('admission-close');this.admissionClosed=true;}emitState(){}async cancelCurrent(){events.push('cancel-drain');}async closeOperationResources(){events.push('service-close');}}
 const api=injected(file,{
  './candidate-calibration-runtime.cjs':{requireCandidateCalibrationRuntime:h=>{if(badHandle||h!==candidate)throw Error('private handle');return candidate;}},
  './product-linux-qualification.cjs':{verifyProductSources:()=>events.push('sources'),loadQualification:()=>{events.push('qualification');return require('../linux-blue/product-linux-qualification.json');}},
  './workbench-trim-candidate.cjs':{CandidateTrimService:Base},
  './workbench-long-range-service.cjs':{clockGuardedRunner:x=>x,ClockQualifiedFamilySelector:class {constructor(o){this.options=o;}}},
  '../src/operation-runtime.cjs':{OperationRuntimeObserver:class {async close(){events.push('observer-close');}}}
 });return {api,candidate,events};
}
test('injected positive service verifies source twice, restricts admission, cancels then drains',async()=>{
 const f=serviceFixture(),s=await f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'});
 assert.equal(f.events.filter(x=>x==='sources').length,2);assert.equal(s.options.inspectionWorkers,1);
 s.state.items=[{id:'unsupported',status:'ready'}];assert.equal(s.snapshot().items[0].status,'unsupported');
 await s.cancelCurrent();assert.deepEqual(f.events.slice(-2),['admission-close','cancel-drain']);
 await s.closeOperationResources();assert.deepEqual(f.events.slice(-2),['service-close','candidate-close']);
});
test('private handle and dependency mismatch cannot compose a product service',async()=>{
 let f=serviceFixture({badHandle:true});await assert.rejects(f.api.createLinuxProductService({verifiedRuntime:{},stateDir:'/inert'}),/private handle/);
 f=serviceFixture({badDependencies:true});await assert.rejects(f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'}),{code:'LINUX_PRODUCT_SCOPE'});assert.equal(f.events.at(-1),'candidate-close');
});
test('Windows construction matches frozen reviewed baseline except declaration scope',()=>{
 const current=fs.readFileSync(path.join(root,'main.js'),'utf8');
 const begin='  // A separate verified namespace',end='  await service.initializeDiagnostics();';
 const branch=current.slice(current.indexOf(begin),current.indexOf(end)).replace(/\n  }\s*$/,'').trim();
 assert.equal(require('node:crypto').createHash('sha256').update(branch).digest('hex'),'a4cd1bd2e1f0def9572400ee3ae61a3c77e0738110ca8e70337ff111d57b27b8');
 assert(current.includes('let nativeFilesFailure = null;'));
});
