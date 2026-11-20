'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
test('internal qualification binds exact accepted evidence while native/release acceptance stays pending', () => {
 const q=require('../linux-blue/product-linux-qualification.cjs').loadQualification();
 assert.equal(q.scope,'internal-opt-in-four-family-candidate');assert.equal(q.nativeProof,null);assert.equal(q.productIntegrationReview,null);
 assert.equal(q.internalCandidateDecision.distributionReady,false);assert(q.supportingEvidence.precisionAudit.bytes>0);assert.match(q.supportingEvidence.precisionAudit.sha256,/^[a-f0-9]{64}$/);
});
test('compact calibration record carries measured values, not runtime approval flags', () => {
  const r = require('../linux-blue/product-linux-qualification.json');
  assert.equal(r.rawCalibration.sizeBytes,78526);
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
 fs.writeFileSync(dest,Buffer.from(bytes.toString().replace('internal-opt-in-four-family-candidate','changed')));assert.throws(()=>q.readCompactQualification());
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
function serviceFixture({badHandle=false,badDependencies=false,realSelector=false,activation=true}={}){
 const events=[],file=path.join(root,'linux-blue/product-linux-service.cjs'),source=fs.readFileSync(file,'utf8');
 const dependencies=JSON.parse(source.match(/const DEPENDENCIES = (\[[\s\S]*?\n\]);/)[1]);
 const candidate={runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13',dependencies:badDependencies?[]:dependencies,pins:{ffmpeg:{path:'/inert/ffmpeg'},ffprobe:{path:'/inert/ffprobe'}},requireCurrent:async()=>events.push('current'),createRunner:()=>()=>{throw Error('must not execute');},close:async()=>events.push('candidate-close')};
 class Base {constructor(o){this.options=o;this.state={items:[]};this.plan={entries:new Map()};} snapshot(){return {items:this.state.items};}closeAdmission(){events.push('admission-close');this.admissionClosed=true;}emitState(){}async cancelCurrent(){events.push('cancel-drain');}async closeOperationResources(){events.push('service-close');}}
 const api=injected(file,{
  './candidate-calibration-runtime.cjs':{requireCandidateCalibrationRuntime:h=>{if(badHandle||h!==candidate)throw Error('private handle');return candidate;}},
  './product-linux-qualification.cjs':{verifyProductSources:()=>events.push('sources'),loadQualification:()=>{events.push('qualification');const q=structuredClone(require('../linux-blue/product-linux-qualification.json'));q.runtimeSuccessor.measuredActivation=activation;return q;}},
  './workbench-trim-candidate.cjs':{CandidateTrimService:Base},
  './workbench-long-range-service.cjs':{clockGuardedRunner:x=>x,ClockQualifiedFamilySelector:realSelector ? require('../linux-blue/workbench-long-range-service.cjs').ClockQualifiedFamilySelector : class {constructor(o){this.options=o;}}},
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

test('five candidate families keep separate exact qualifiers without changing the range record', async()=>{
 const f=serviceFixture(),s=await f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'});
 const families=s.options.operationQualifications.options.families;
 assert.equal(families.length,5);assert.equal(families[4].id,'short-sdr-range-v1');
 assert.equal(families[0].id,'cfr-sdr-range-resize1440-flac-v1');
 assert.equal(families[1].id,'cfr-sdr-full-resize-copy-v1');
 assert.equal(families[2].id,'cfr-sdr-range-resize-flac-v1');
 assert.equal(families[2].resourcePolicy,'cfr1080p30-to720p-flac-resources-v1');
 assert.equal(families[1].qualification.containerDuration,'matroska-copy-end-plus-codec-delay');
 assert.equal(families[1].qualification.tolerances.sampleCount,0);
 assert.deepEqual(families[0].settings,families[1].settings);
 assert.equal(s.snapshot().developerProduct.enabled,true);
 assert.match(s.snapshot().developerProduct.notice,/has not undergone native publication testing/);
 await s.closeOperationResources();
});
test('compact Full-copy record rejects widened geometry, settings, clocks and false native approval',t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'full-copy-record-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const dest=path.join(temp,'product-linux-qualification.json'); const q=injected(qualificationFile,{},temp);
 const base=JSON.parse(fs.readFileSync(path.join(root,'linux-blue/product-linux-qualification.json'),'utf8'));
 for(const change of [v=>v.fullCopy.family.geometry.sourceWidth=2560,v=>v.fullCopy.family.settings.quality=24,
  v=>v.fullCopy.family.qualification.tolerances.sampleCount=1024,v=>v.fullCopy.nativeProof={passed:true},
  v=>v.fullCopy.family.timingQualification.audioTimelineUs=22000,v=>v.fullCopy.family.resourcePolicy='anything']){
  const value=structuredClone(base);change(value);fs.writeFileSync(dest,JSON.stringify(value,null,2)+'\n');
  assert.throws(()=>q.readCompactQualification(),{code:'LINUX_PRODUCT_QUALIFICATION_CHANGED'});
 }
});
test('new product metadata is presentation only and uses existing explicit per-file controls',()=>{
 const s=fs.readFileSync(path.join(root,'ui/renderer.js'),'utf8');
 assert(s.includes('next.developerProduct?.enabled ? next.developerProduct'));
 const service=fs.readFileSync(path.join(root,'linux-blue/product-linux-service.cjs'),'utf8');
 assert(service.includes("need(token !== null, 'Choose an explicitly qualified product family; compatibility fallback is unavailable.');"));
 assert(!service.includes('createCandidateFullCopyService'));assert(!service.includes('bkus3x'));
});

function productProbe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 }, side_data_list: [{ side_data_type: 'Display Matrix', rotation: 0, displaymatrix: '00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824' }] },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}

test('real combined selector admits only the four explicit families, with no cross-family fallback',async()=>{
 const f=serviceFixture({realSelector:true}),s=await f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'});
 const selector=s.options.operationQualifications;
 const {buildEncodeOperation,fingerprintEncodeSource}=require('../src/encode-operation.cjs');
 const {resolveFileRequest}=require('../src/operation-contract.cjs');
 const {classifyColor}=require('../src/media.cjs');
 const settings={profileId:'h265-cpu',preset:'slow',quality:25};
 function bindings({range=null,audioPolicy='copy',width=1920,resolution='720',quality=25,pcm=false,mutateSource=()=>{}}={}){
  const source=productProbe(11); source.streams[0].width=width;source.streams[0].height=width===3840?2160:width===2560?1440:1080;
  if(width===2560||width===3840||pcm){source.streams[1].codec_name='pcm_s16le';source.streams[1].sample_fmt='s16';delete source.streams[1].profile;}
  mutateSource(source);
  const identity={canonicalPath:'/synthetic-product/input.mov',dev:'1',ino:'2',size:source.format.size,mtimeNs:'1000',ctimeNs:'1001',birthtimeNs:'900',sparseDigest:`sha256-sparse-v1:${'b'.repeat(64)}`};
  const config={...settings,quality};
  const request=resolveFileRequest({fileId:'synthetic',identityRevision:1,draftRevision:1,operation:'encode',overrides:{range,resolution,audioPolicy}});
  const plan=buildEncodeOperation({input:identity.canonicalPath,output:'/synthetic-product/output.mkv',settings:config,inspection:{probe:source,color:classifyColor(source),duration:11},request,runtimeIdentity:f.candidate.runtimeIdentity});
  return {plan,settings:config,sourceIdentity:identity,sourceProbeFingerprint:fingerprintEncodeSource(source),runtimeIdentity:f.candidate.runtimeIdentity,environment:null,budget:null,executionBudgetMs:120000};
 }
 for(const args of [...['1440','1080','720'].map(resolution=>({width:3840,resolution,audioPolicy:'precision-flac'})),{},{pcm:true,range:{startUs:413000,endUs:8621000},audioPolicy:'precision-flac'},{width:2560,range:{startUs:413000,endUs:8621000},audioPolicy:'precision-flac'}]){
  const b=bindings(args),token=selector.select(b);assert(token);assert(selector.requireCurrent(token,b).controlsRequired);
 }
 for(const args of [{width:3840,audioPolicy:'copy'},{width:3840,audioPolicy:'precision-flac',range:{startUs:0,endUs:1000000}},{width:3840,audioPolicy:'precision-flac',resolution:'source'},{width:4096,audioPolicy:'precision-flac'},{width:2560},{range:{startUs:413000,endUs:8621000}},{audioPolicy:'precision-flac'},{range:{startUs:413000,endUs:8621000},audioPolicy:'precision-flac'},{pcm:true,range:{startUs:413000,endUs:8621000}},{resolution:'source'},{quality:24}])assert.throws(()=>selector.select(bindings(args)));
 for(const mutateSource of [p=>p.streams[0].avg_frame_rate='30000/1001',p=>p.streams[0].color_transfer='smpte2084',p=>p.streams[1].channels=1,p=>p.streams[1].sample_rate='44100',p=>p.streams[0].profile='Main']){
  assert.throws(()=>selector.select(bindings({pcm:true,range:{startUs:413000,endUs:8621000},audioPolicy:'precision-flac',mutateSource})));
 }
 await s.closeOperationResources();
});
test('altered Full-copy producer fails the same bounded source-closure gate',t=>{
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'fullcopy-source-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const pins=JSON.parse(fs.readFileSync(qualificationFile,'utf8').match(/const SOURCE_PINS = (\{[\s\S]*?\n\});/)[1]);
 for(const name of Object.keys(pins)){const to=path.join(temp,name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,name),to);}
 const q=injected(qualificationFile,{},path.join(temp,'linux-blue'));assert(q.verifyProductSources().files>100);
 const victim=path.join(temp,'linux-blue/candidate-full-copy-calibration.cjs');
 const bytes=fs.readFileSync(victim);bytes[0]^=1;fs.writeFileSync(victim,bytes);
 assert.throws(()=>q.verifyProductSources(),{code:'LINUX_PRODUCT_SOURCE_CHANGED'});
});

test('1080 range compact record preserves original clocks and refuses mutated scope',t=>{
 const q=require('../linux-blue/product-linux-qualification.cjs').loadQualification();
 assert.equal(q.range1080.rawCalibration.sha256,'a2f7a2d143f7b7f1063550da7443a7c96177a8894f2809ad0f8787f9847320fc');
 assert.equal(q.range1080.rawCalibration.sizeBytes,75744);assert.equal(q.range1080.nativeProof,null);
 assert.deepEqual(q.range1080.family.qualification.tolerances,q.family.qualification.tolerances);
 const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'range1080-record-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const loader=injected(qualificationFile,{},temp);
 for(const mutate of [x=>x.range1080.nativeProof={passed:true},x=>x.range1080.family.geometry.sourceWidth=2560,x=>x.range1080.family.qualification.tolerances.sampleCount=1,x=>x.range1080.family.timingQualification.aac={}]){
 const v=structuredClone(q);mutate(v);fs.writeFileSync(path.join(temp,'product-linux-qualification.json'),JSON.stringify(v,null,2)+'\n');assert.throws(()=>loader.readCompactQualification(),{code:'LINUX_PRODUCT_QUALIFICATION_CHANGED'});
 }
});

test('historical 97 pins remain intact; explicit service and UHD source deltas with historical identities intact',()=>{
 const crypto=require('node:crypto');
 const source=fs.readFileSync(path.join(root,'linux-blue/candidate-resize-service.cjs'),'utf8');
 const original=JSON.parse(source.match(/const PRODUCERS = Object.freeze\((\{[\s\S]*?\n\})\);/)[1]);
 const pins=JSON.parse(fs.readFileSync(qualificationFile,'utf8').match(/const SOURCE_PINS = (\{[\s\S]*?\n\});/)[1]);
 assert.equal(Object.keys(original).length,97);
 const {SERVICE_SUCCESSOR: successor, AAC_SERVICE_SUCCESSOR: aac}=require(qualificationFile);
 assert.equal(successor.nativeProof,null);
 assert.deepEqual(aac.priorCurrentSource,successor.currentEncoderService);
 assert.equal(aac.nativeProof,null);
 // Preserve the AAC-era tuple (396ee0a). The reviewed Jobs commit 3fe20d4
 // (encoder-service SHA-256 prefix c89a3288) and H.265 commit 6d00b6b changed
 // these source bytes without updating or requalifying the historical evidence.
 assert.deepEqual(aac.currentSource,{bytes:164039,sha256:'b5327f15fd378d11475239cc8c00a6875f04b4d01efbc94b28ae7827fa3788b2'});
 // Regular 115's H265-era 164340-byte/e11071880c11efd21f20e6f8175817db67bc09a505f201bce31d0709a3b8ea33 product is historical; the later shared stage handoff does not requalify its native receipt.
 // Checkpoint 118: 165421 bytes, 8180faf446c800832a2258b39f20e04e8cf816341f08a1bc303eb6dc65e8c7f7. A diagnostic-only discovery path is not a new native receipt.
 const currentEncoderService={bytes:166659,sha256:'28730ffa6adc0f7026380ccab681e6e1abc893bab76fb30726fa40ba4a26817a'};
 let changed=0;
 for(const [name,hash] of Object.entries(original)){
  const bytes=fs.readFileSync(path.join(root,name));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(name==='src/encoder-service.cjs'){
   assert.equal(hash,successor.historicalEncoderService.sha256);
   assert.deepEqual({bytes:bytes.length,sha256:actual},currentEncoderService);
   changed++;
  }else if(name==='src/outputs.cjs'){
   // The H.265 publication helper at 115 was {bytes:23755,sha256:'37953bf5b9f2faa62cf3bbf88414854a6019b864805a6c19cb8d40b5c42527b1'}.
   // This later observational change introduces no publication or cleanup grant.
   assert.equal(hash,'0871e35adb50b7fca7c177b6beb34c5533df8bac98751b55c8af31b8e422ca96');
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:24548,sha256:'d61c0185f0af9104831cee015774bb8bd4656376e4b6f52b981e2aa7c011aff6'});
   changed++;
  }else if(successor.uhdSourceDeltas[name]){
   assert.equal(hash,successor.uhdSourceDeltas[name].historicalSha256);
   assert.equal(actual,successor.uhdSourceDeltas[name].currentSha256);
   changed++;
  }else assert.equal(actual,hash,name);
  assert.deepEqual(pins[name],{bytes:bytes.length,sha256:actual},name);
 }
 assert.equal(changed,5);
});

test('successor activation remains gated by current evidence rather than historical runtime authority',async()=>{
 const q=require('../linux-blue/product-linux-qualification.cjs').loadQualification();
 assert.equal(q.runtimeSuccessor.measuredActivation,true);assert.equal(q.runtimeSuccessor.lateRangeEvidence.selectedFrames,1200);
 const f=serviceFixture({activation:false});await assert.rejects(f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'}),/requires the reviewed current evidence/);
 assert.equal(f.events.at(-1),'candidate-close');
 const old=JSON.parse(fs.readFileSync(path.join(root,q.runtimeSuccessor.historicalRecord.path)));assert.notEqual(old.runtimeIdentity,q.runtimeIdentity);
});
