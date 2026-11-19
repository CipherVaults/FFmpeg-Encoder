'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),file=path.join(root,'linux-blue/product-linux-remux-shell.cjs');
function fixture({failure=false,sourceFailure=false}={}){
 const events=[],runtime={close:async()=>events.push('close')},service={};const m={exports:{}};const original=createRequire(file);
 const replacements={
  './product-linux-remux-qualification.cjs':{loadRemuxQualification:()=>{events.push('sources');if(sourceFailure)throw Error('source drift');}},
  './candidate-calibration-runtime.cjs':{openCandidateCalibrationRuntime:async manifest=>{events.push('runtime');assert.equal(manifest.pins.ffmpeg.path,'/inert-runtime/ffmpeg');assert.equal(manifest.pins.ffprobe.path,'/inert-runtime/ffprobe');assert.equal(manifest.dependencies.length,7);return runtime;}},
  './product-linux-remux-service.cjs':{createLinuxRemuxService:async options=>{events.push('remux');assert.equal(options.verifiedRuntime,runtime);assert.equal(options.stateDir,'/inert-state');if(failure)throw Error('factory failed');return {service};}}
 };
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})')(n=>Object.hasOwn(replacements,n)?replacements[n]:original(n),m,m.exports);
 return {...m.exports,events,service};
}
test('remux shell verifies source before fixed runtime and dedicated composition',async()=>{
 const f=fixture();assert.equal(await f.createLinuxRemuxShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'}),f.service);
 assert.deepEqual(f.events,['sources','runtime','remux']);
 const text=fs.readFileSync(file,'utf8');assert(!text.includes('Acquisition'));assert(!text.includes('createLinuxProductService'));
});
test('untrusted options and source drift refuse; composition failure closes runtime',async()=>{
 let f=fixture();await assert.rejects(f.createLinuxRemuxShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state',outputAccess:{}}));assert.deepEqual(f.events,[]);
 await assert.rejects(f.createLinuxRemuxShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state',policies:[]}));
 f=fixture({sourceFailure:true});await assert.rejects(f.createLinuxRemuxShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'}),/source drift/);assert.deepEqual(f.events,['sources']);
 f=fixture({failure:true});await assert.rejects(f.createLinuxRemuxShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'}),/factory failed/);assert.equal(f.events.at(-1),'close');
});
test('explicit remux switch is separate namespace and three-way exclusive',()=>{
 const text=fs.readFileSync(path.join(root,'main.js'),'utf8');assert(text.includes("process.platform === 'linux' && app.commandLine.hasSwitch('linux-remux-candidate')"));assert(text.includes('[linuxProductCandidate, linuxOrdinaryCandidate, linuxRemuxCandidate, linuxUnifiedCandidate].filter(Boolean).length > 1'));assert(text.includes('FFmpegEncoder-Linux-Remux-Candidate'));
});
