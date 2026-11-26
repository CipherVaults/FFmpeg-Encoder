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
 assert.ok(s.includes('else {\n  // Only the reviewed regular Windows engine'));
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
test('Windows construction binds the reviewed regular engine entry point',()=>{
 const current=fs.readFileSync(path.join(root,'main.js'),'utf8');
 const begin=current.indexOf('  // Only the reviewed regular Windows engine'),end=current.indexOf('  await service.initializeDiagnostics();');
 assert(begin>=0&&end>begin);
 const branch=current.slice(begin,end).replace(/\n  }\s*$/,'').trim();
 assert.equal(require('node:crypto').createHash('sha256').update(branch).digest('hex'),'1301e639ce7caffe294d3c54ca45b4c1cb453f51683156cec51dd1fb32c394f3');
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

test('historical 97 pins remain intact with explicitly reviewed current source deltas',()=>{
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
 // At 122 the diagnostic-only MP3 encoder-service source was {bytes:166659,sha256:'28730ffa6adc0f7026380ccab681e6e1abc893bab76fb30726fa40ba4a26817a'}.
 // Moving Linux readiness binding earlier does not requalify either historical native witness.
 // 123 issued Ready before its inspection journal awaited: {bytes:167146,sha256:'742e8f411148557ef924fde0ba38a4a504c3b8046fbfda9091a976400a7eb4ae'}.
 // Deferring one host's Ready through that await is a source-only change.
 // Checkpoint 137 retained the 168722-byte d7e0218e shared service. The
 // reviewed Linux Remux diagnostic handles actual Cancel during receipt
 // settlement; this current identity does not requalify historical evidence.
 // Current per-file Remux journal settlement does not requalify the old source.
 // Windows integration changes current shared bytes without replacing the old Linux proof.
 const regularWindowsSourceDeltas={
   'src/container-clock.cjs': ['b823f1e41c4cca19a0b06d82dadf1941f4e0a0326b6d16bd910691c702763857',14696,'b945f2c3c9c5082705f16b573fece0890e9b339a80a9458ad512dde0e2c01690'],
   'src/operation-evidence.cjs': ['5ec5452881d01789f7f181e4540cfcca268371f13f6abdd7f59fa9ad57e8b8d4',57827,'b9bc49742b011929e4015d8441bea3101d12331f076717661c734568665971bc'],
   'src/operation-family.cjs': ['3e27335e4228969d670545b0fb6aeb77a6fd9303529c248ae7560d0c9e4fade3',59500,'e342056e7b896a1cd61cf4da3c84c33d16ab792186d4a1ae4c30e5ddadbaf591'],
   'src/candidate-runtime.cjs': ['9566a7691feab7cb65f5c739a723f99c48833064aea2edfe8cf410cc5dc0d712',11835,'92b8b5169302bfe0225ea5d5ca4802cec62c239b367605ce6f400f19eb0b50a9'],
   'src/encode-operation.cjs': ['aae37c5479897a13f9ee66b1ea1a8a9a6a46d2c57f76d36bdebdedf21569a5de',58155,'84b6e759f07794f452ea59d3c4a6852f8e9dafbede805c0f50541dec68d3527c'],
   'src/encoder-service.cjs': ['5f1d0ed985bb82166f52b8498f69e72e30e018973f7c1ee361f745a26e643dc7',174082,'f6468d2c362dcbd3e1dbae5f6a95ec8c968b33d2ad69bfd096dedf961a786c48'],
   'src/inspection.cjs': ['948559c31919629326f02ebabe30a3a6918677c91cf9bba338bf382b3401c491',34123,'441551923f7b6dde45e08e57ae53e52876ddd1f712d6662dd967ec0a1389e089'],
   'src/media.cjs': ['79f040a7e136b2b06235090675360996e12d7ff815ea776eb800fd479ce9a7e7',25811,'2f3bc260e1969684e9374c9d60dc41cb326c0f6d5b09066649abfc8889b7f5c0'],
   'src/operation-controls.cjs': ['bd0977641d5fe62b182a70e58d9f89a69f4af4564daeea0c616dcb066238f59f',8292,'551246574d74d010d9179094dea47a9c12d5da7c9e5d1ce34fef6175a03b8c4e'],
   'src/operation-runtime.cjs': ['95285842847006e2fbcad43d46bbca7bc3823c3378fdc33a755ee82398681b79',24869,'a831147f2917a938e21083f2a56cc98597c834a464e1bcf1cdaebb937c62d294'],
   'src/process-runner.cjs': ['257ae0ce717d086635a133535df9a73afd2609b83ad231ea8ed0798b3596395c',18389,'8c2395eb2e2d7d32d8c11e756e3762d3ce04c926185b4b66d6b89df2f587af1f'],
   'src/remux-catalog.cjs': ['ba299093370dd87e7e154cbeba22cd9f9fe8bc5246eb64266dff193ad21093ec',8272,'8acbdae5685ef158c70f4f3a10ef0fd0d01417e1647167c5e080ade9f05420a3'],
   'src/remux-contract.cjs': ['f420e73a9a95b310459c4dd7adb5b4e5657ea819d1b6f61a405ef72531c284da',38772,'c8db0e1df72356716f4f2c888a0b324fd2cb467dd4e245f3498d1b1d9b441300'],
   'src/remux-evidence.cjs': ['76ed8963119b7217b3d94cf6058bcf9afca081cadf0d51f6166be5fbdd408a75',163445,'57daf645eb11ac7e3fe41f172684c5c3805cb84fd49c5c22b0e655e21f80389b'],
   'src/remux-native-checks.cjs': ['70764d731e52a6b648b902147cdd2492bc153b22d877d56510902120a97ff3c7',34435,'41c92ef17de659504bf9b5bac8a80ce4e33af63f863916213d73bbefd28cda73'],
   // Before timed SubRip, the Windows Remux current cue reader was 6456 bytes, 93c30683ba9cb5efa6b1537f86b759ddaf84a9562d98d67a964ff5bb110a06cd.
   'src/remux-native-cues.cjs': ['fe894c5ab1f7f413dd62e824a89398fed5c6ff3d487c3c4590b736de4ef279dd',6980,'38ecafa1539434f95d74f9db994bbfd1672f729432e80efb4f4e7858c6dad072'],
   'src/remux-operation.cjs': ['62715bdbb137e3f0938d26d7394172b6818e4f950f0bc5b7331f18769f51dcac',48827,'f98c9c35c119e56fc8b64d65f7364773784fedbbfd9cfbf700e8eb18919749c5'],
   'src/remux-transport-evidence.cjs': ['529e67c24200cc216c7f3578f9984d383714de6990c249bf6f3a8453a724b62a',20482,'7d718265d8d41998e8da65c21f7c43833ebd010971e06d90e9f1161568eff20c'],
   'src/remux-validation.cjs': ['6166b0e226b5755a0dfa1ca8b9333a1401c3186e21f6f31ad30cdf1266a6f810',43525,'e554ab2e020baff103d726d2591feb1f18bbe72dac13fd17a92b135c0bf6fe47'],
   'src/remux-workspace.cjs': ['7430f312bfcbabce39ae942ceeac7c0231ebaf7c387d21b7bc8d64d9de7f5260',23115,'00812f435092efae682d4a3add4dbde08a122142043b78deb3c6575e4fd26faa'],
   'src/vendor-encode.cjs': ['4ace2e31776981382f86fa742f5caca2a8874314c61bf9d6ea1cde069980dd74',11018,'71a10e6d08c293ed681bb5e1f7bbc176361204bd8d98cce14ddc18577827f71f'],
 };
 let changed=0, historicalOnly=0;
 for(const [name,hash] of Object.entries(original)){
  const bytes=fs.readFileSync(path.join(root,name));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(name==='scripts/v07-sdr-flac-range-calibration.cjs'){
   // The owned Windows calibration CLI stays exact historical source, not
   // part of the current Linux application or its active source gate.
   assert.equal(hash,'623973624f0ff72a92d8d684ba4d19a31d2fb4abc017d3f5cc0e078b2146ec28');
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:44169,sha256:hash});
   assert.equal(Object.hasOwn(pins,name),false);
   historicalOnly++;
   continue;
  }else if(name==='linux-blue/workbench-long-range-calibration.cjs'){
   // Only the import changed to a pathless copy of the same arithmetic.
   // Do not re-seal the historical producer map or requalify its results.
   assert.equal(hash,'ee8d48e294f098ed9f47e7b6e1e75edd5a4661d460ee6b00bb2a375010692afc');
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:33448,sha256:'63914e348d426d40566086a6a58aea87209d0e420197b7fab53de9306e1ac903'});
   changed++;
  }else if(name==='src/vendor-capabilities.cjs'){
   // Preserve the frozen producer identity; the explicit copy overlay is not historical hardware evidence.
   assert.equal(hash,'a48712b3b93c792c1aab7298b37f576a5eb8859504ffe95aec9ccd3bbfa20fea');
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:13443,sha256:'ccfdbd2e35825a77919f25af06553f0bd7b744a1f219860854630600cdb5ac62'});
   changed++;
  }else if(name==='src/outputs.cjs'){
   // The H.265 publication helper at 115 was {bytes:23755,sha256:'37953bf5b9f2faa62cf3bbf88414854a6019b864805a6c19cb8d40b5c42527b1'}.
   // This later observational change introduces no publication or cleanup grant.
   assert.equal(hash,'0871e35adb50b7fca7c177b6beb34c5533df8bac98751b55c8af31b8e422ca96');
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:24548,sha256:'d61c0185f0af9104831cee015774bb8bd4656376e4b6f52b981e2aa7c011aff6'});
   changed++;
  }else if(regularWindowsSourceDeltas[name]){
   const [historicalHash,currentBytes,currentHash]=regularWindowsSourceDeltas[name];
   assert.equal(hash,historicalHash);
   assert.deepEqual({bytes:bytes.length,sha256:actual},{bytes:currentBytes,sha256:currentHash});
   changed++;
  }else if(successor.uhdSourceDeltas[name]){
   assert.equal(hash,successor.uhdSourceDeltas[name].historicalSha256);
   assert.equal(actual,successor.uhdSourceDeltas[name].currentSha256);
   changed++;
  }else assert.equal(actual,hash,name);
  assert.deepEqual(pins[name],{bytes:bytes.length,sha256:actual},name);
 }
 assert.equal(changed,25);
 assert.equal(historicalOnly,1);
});

test('successor activation remains gated by current evidence rather than historical runtime authority',async()=>{
 const q=require('../linux-blue/product-linux-qualification.cjs').loadQualification();
 assert.equal(q.runtimeSuccessor.measuredActivation,true);assert.equal(q.runtimeSuccessor.lateRangeEvidence.selectedFrames,1200);
 const f=serviceFixture({activation:false});await assert.rejects(f.api.createLinuxProductService({verifiedRuntime:f.candidate,stateDir:'/inert'}),/requires the reviewed current evidence/);
 assert.equal(f.events.at(-1),'candidate-close');
 const old=JSON.parse(fs.readFileSync(path.join(root,q.runtimeSuccessor.historicalRecord.path)));assert.notEqual(old.runtimeIdentity,q.runtimeIdentity);
});
