'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{createHash}=require('node:crypto');
const root=path.join(__dirname,'..'),file=path.join(root,'linux-blue/product-linux-ordinary-shell.cjs');
function fixture({failure=false,sourceFailure=false}={}){
 const events=[],runtime={close:async()=>events.push('close')},service={};const m={exports:{}};const original=createRequire(file);
 const replacements={
  './product-linux-qualification.cjs':{verifyProductSources:()=>{events.push('sources');if(sourceFailure)throw Error('source drift');}},
  './candidate-calibration-runtime.cjs':{openCandidateCalibrationRuntime:async(manifest)=>{events.push('runtime');assert.equal(manifest.pins.ffmpeg.path,'/inert-runtime/ffmpeg');assert.equal(manifest.pins.ffprobe.path,'/inert-runtime/ffprobe');assert.equal(manifest.dependencies.length,7);return runtime;}},
  './ordinary-cpu-service.cjs':{createOrdinaryCpuService:async options=>{events.push('ordinary');assert.equal(options.verifiedRuntime,runtime);assert.equal(options.stateDir,'/inert-state');assert.equal(options.workbenchMode,undefined);if(failure)throw Error('factory failed');return service;}}
 };
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})')(n=>Object.hasOwn(replacements,n)?replacements[n]:original(n),m,m.exports);
 return {...m.exports,events,service};
}
test('ordinary shell owns exact runtime and current source verification without measured qualification',async()=>{
 const f=fixture();const s=await f.createLinuxOrdinaryShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'});
 assert.equal(s,f.service);assert.deepEqual(f.events,['sources','runtime','sources','ordinary']);assert.equal(s.linuxRemuxStatus.available,false);assert.deepEqual(s.linuxQualifiedEncodeStatus.familyIds,[]);
 const text=fs.readFileSync(file,'utf8');assert(!text.includes('loadQualification'));assert(!text.includes('createLinuxProductService'));assert(!text.includes('workbenchMode'));
});
test('ordinary shell rejects untrusted options before private runtime; failed composition drains',async()=>{
 let f=fixture();await assert.rejects(f.createLinuxOrdinaryShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state',outputAccess:{}}));assert.deepEqual(f.events,[]);
 await assert.rejects(f.createLinuxOrdinaryShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state',ordinaryJobGuard:()=>{}}));assert.deepEqual(f.events,[]);
 f=fixture({sourceFailure:true});await assert.rejects(f.createLinuxOrdinaryShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'}),/source drift/);assert.deepEqual(f.events,['sources']);
 f=fixture({failure:true});await assert.rejects(f.createLinuxOrdinaryShell({runtimeRoot:'/inert-runtime',stateDir:'/inert-state'}),/factory failed/);assert.equal(f.events.at(-1),'close');
});
test('entrypoint explicit Linux switch has separate user-data and refuses ambiguous candidate choice',()=>{
 const text=fs.readFileSync(path.join(root,'main.js'),'utf8');assert(text.includes("process.platform === 'linux' && app.commandLine.hasSwitch('linux-ordinary-cpu-candidate')"));assert(text.includes("if ([linuxProductCandidate, linuxOrdinaryCandidate, linuxRemuxCandidate, linuxUnifiedCandidate].filter(Boolean).length > 1) throw new Error('Choose exactly one Linux candidate route.');"));assert(text.includes("path.join(app.getPath('appData'), 'FFmpegEncoder-Linux-Ordinary-Candidate')"));
 const begin='  // A separate verified namespace',end='  await service.initializeDiagnostics();';const branch=text.slice(text.indexOf(begin),text.indexOf(end)).replace(/\n  }\s*$/,'').trim();assert.equal(createHash('sha256').update(branch).digest('hex'),'a4cd1bd2e1f0def9572400ee3ae61a3c77e0738110ca8e70337ff111d57b27b8');
});
