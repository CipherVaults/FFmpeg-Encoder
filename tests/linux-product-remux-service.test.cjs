'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admit,createLinuxRemuxService}=require('../linux-blue/product-linux-remux-service.cjs');
const {assessRemux}=require('../src/remux-contract.cjs');
function assessment(change=()=>{},target='mp4'){
 const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',profile:'High',level:40,width:1920,height:1080,pix_fmt:'yuv420p',field_order:'progressive',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/30000',sample_aspect_ratio:'1:1',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',duration:'8',disposition:{default:1}},{index:1,codec_type:'audio',codec_name:'aac',profile:'LC',sample_fmt:'fltp',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:'1/48000',duration:'8',disposition:{default:1}}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',size:'5578679',duration:'8',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{}},chapters:[],programs:[],stream_groups:[]};change(probe);
 return assessRemux({request:{fileId:'inert',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]},probe,sourceFingerprint:'a'.repeat(64)});
}
test('genuine assessment admits source without execution readiness',()=>{const a=assessment();admit(a,'/owned/source.mp4');assert.equal(a.executionReady,false);});
test('serialized assessment cannot carry authority',()=>assert.throws(()=>admit(structuredClone(assessment()),'/owned/source.mp4')));
for(const [label,change] of [['audio-rate',p=>p.streams[1].sample_rate='44100'],['geometry',p=>p.streams[0].width=3840],['duration',p=>p.format.duration='61'],['size',p=>p.format.size=String(129*1024*1024)],['interlace',p=>p.streams[0].field_order='tt']])test('refuses '+label,()=>assert.throws(()=>admit(assessment(change),'/owned/source.mp4')));
test('MOV source properties are admitted without granting catalog execution authority',()=>admit(assessment(()=>{},'mov'),'/owned/source.mp4'));
test('fake runtime cannot open service',async()=>await assert.rejects(createLinuxRemuxService({verifiedRuntime:{},stateDir:'/owned/state'})));

// Execute the actual factory with module-local dependency doubles. No public
// test seam, subprocess or file-based runtime authority is introduced.
function factoryHarness({currentFailure=false,serviceFailure=false,observerCloseFailure=false,candidateCloseFailure=false,realService=false,stateDir='/owned/state',transform=x=>x,currentHook=null,executeHook=null}={}){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const filename=require.resolve('../linux-blue/product-linux-remux-service.cjs');
 const source=transform(fs.readFileSync(filename,'utf8'));
 const shell=fs.readFileSync(path.join(__dirname,'../linux-blue/product-linux-shell.cjs'),'utf8');
 const dependencies=JSON.parse(shell.match(/const DEPENDENCIES = (\[[\s\S]*?\]);/)[1]);
 const calls={execute:0,candidateClose:0,observerClose:0};let serviceOptions;
 const candidate={runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13',dependencies,pins:{ffmpeg:{path:'/owned/ffmpeg',size:1,sha256:'a'.repeat(64)},ffprobe:{path:'/owned/ffprobe',size:1,sha256:'b'.repeat(64)}},requireCurrent:async signal=>{if(currentFailure)throw Error('primary-current');if(currentHook)await currentHook(signal);},close:async()=>{calls.candidateClose++;if(candidateCloseFailure)throw Error('candidate-close');}};
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
 m.require=id=>id==='./product-linux-remux-qualification.cjs'?{loadRemuxQualification:()=>({policyIdentity:'internal-test-policy',evidenceId:'internal-test-evidence'})}:id==='./candidate-calibration-runtime.cjs'?{requireCandidateCalibrationRuntime:()=>candidate}:id==='../src/operation-runtime.cjs'?{OperationRuntimeObserver:class{async observe(){return Object.freeze({});}snapshot(){return {runtimeIdentity:candidate.runtimeIdentity,environment:null};}async close(){calls.observerClose++;if(observerCloseFailure)throw Error('observer-close');}}}:id==='../src/process-runner.cjs'?{runTool:async(...args)=>{calls.execute++;return executeHook?executeHook(...args):{exitCode:0};}}:id==='../src/encoder-service.cjs'&&!realService?{EncoderService:class{constructor(o){if(serviceFailure)throw Error('primary-service');serviceOptions=o;this.state={};}async closeOperationResources(){await serviceOptions.operationRuntime.close();}async closeDiagnostics(){}}}:original(id);
 m._compile(source,filename);return {create:()=>m.exports.createLinuxRemuxService({verifiedRuntime:{},stateDir}),calls,run:(...args)=>serviceOptions.run(...args)};
}
test('actual factory refuses arbitrary GPU/video arguments before executor',async()=>{
 const h=factoryHarness(),owner=await h.create();owner.service.remuxPhase={signal:new AbortController().signal,started:0,live:0,expires:performance.now()+600000};
 for(const args of [['-c:v','hevc_nvenc'],['-hwaccel','cuda'],['-c:v','rawvideo'],['-c:v','libx264'],['-c:v','unknown']])await assert.rejects(h.run('/owned/ffmpeg',args,{timeoutMs:1000}));
 const sparse=[];sparse.length=1;await assert.rejects(h.run('/owned/ffprobe',sparse,{timeoutMs:1000}));
 await assert.rejects(h.run('/owned/ffprobe',[],{timeoutMs:1000,env:{}}));
 await assert.rejects(h.run('/other/tool',[],{timeoutMs:1000}));assert.equal(h.calls.execute,0);
 await h.run('/owned/ffprobe',['-version'],{timeoutMs:1000});assert.equal(h.calls.execute,1);await owner.close();assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,1);
});
test('actual factory admits only exact owned collector rawvideo grammar',async()=>{
 const h=factoryHarness(),owner=await h.create();owner.service.remuxPhase={signal:new AbortController().signal,started:0,live:0,expires:performance.now()+600000};
 const args=['-hide_banner','-loglevel','warning','-nostdin','-n','-xerror','-protocol_whitelist','file,pipe','-threads','1','-noautorotate','-f','h264','-i','/owned/state/operation-evidence/job/remux-evidence-one/clip.h264','-map','0:v:0','-an','-sn','-dn','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','framehash','-hash','sha256','pipe:1'];
 await h.run('/owned/ffmpeg',args,{timeoutMs:1000});assert.equal(h.calls.execute,1);
 for(const [index,value] of [[14,'/other/remux-evidence-one/clip.h264'],[21,'2'],[28,'rgb24'],[args.length-1,'/owned/file']]){const altered=[...args];altered[index]=value;await assert.rejects(h.run('/owned/ffmpeg',altered,{timeoutMs:1000}));}
 assert.equal(h.calls.execute,1);await owner.close();
});
test('construction currentness failure closes candidate and preserves primary',async()=>{const h=factoryHarness({currentFailure:true});await assert.rejects(h.create(),/primary-current/);assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,0);});
test('construction failure attempts both owned closures even if cleanup fails',async()=>{const h=factoryHarness({serviceFailure:true,observerCloseFailure:true,candidateCloseFailure:true});await assert.rejects(h.create(),e=>e instanceof AggregateError&&e.errors.map(x=>x.message).join(',')==='primary-service,observer-close,candidate-close');assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,1);});

function composedProbe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 31,
    width: 320, height: 180, coded_width: 320, coded_height: 180, pix_fmt: 'yuv420p', field_order: 'progressive',
    color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', chroma_location: 'left',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2', tags: { title: 'Native video' }, disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000',
    channels: 2, channel_layout: 'stereo', time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2',
    tags: { language: 'eng', title: 'Stereo' }, disposition: { default: 1 } }],
  format: { format_name: 'matroska,webm', duration: '2', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic preparation facts' } },
  chapters: [], programs: [], stream_groups: [] };
}

test('actual acquisition factory and shared preparation preserve exact remux budget contract',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const {playbackFixture}=require('./helpers/mov-fixture.cjs');
 for(const mode of ['correct','missing-budget','wrong-execution-budget']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-composed-'));const input=path.join(root,'input'),output=path.join(root,'output');await fs.mkdir(input);await fs.mkdir(output);
  const probe=composedProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>s.id=String(i+1));
  const file=path.join(input,'source.mp4');await fs.writeFile(file,playbackFixture(probe));probe.format.size=String((await fs.stat(file)).size);
  const transform=source=>mode==='missing-budget'?source.replace('operationEvidenceBudget:EVIDENCE_BUDGET,',''):mode==='wrong-execution-budget'?source.replace('operationDeadlineMs:EXECUTION_BUDGET_MS','operationDeadlineMs:120000'):source;
  const h=factoryHarness({realService:true,stateDir:path.join(root,'state'),transform});const owner=await h.create();
  try{
   owner.service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});
   owner.service.capabilities=async()=>{throw Error('Remux must not initialize encoders');};
   const a=await owner.service.registerFolder(input,'input'),b=await owner.service.registerFolder(output,'output');
   const capabilities = await owner.service.getCapabilities();assert.deepEqual(capabilities.profiles,[]);assert.equal(h.calls.execute,0);
   await owner.service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mp4'});
   const item=owner.service.snapshot().items[0];assert.equal(h.calls.execute,0);assert.equal(owner.service.remuxPhase,null);
   await owner.service.getCapabilities();assert.equal(owner.service.remuxPhase,null);
   if(mode==='correct') {
    assert.equal(item.status,'ready',item.reason);
    const ready=owner.service.snapshot();owner.service.startBatch({planId:ready.planId,fileIds:[item.id]});
    assert(owner.service.remuxPhase);await owner.service.taskPromise;
    assert.equal(owner.service.remuxPhase,null);assert.equal(owner.service.snapshot().phase,'completed');assert.equal(owner.service.snapshot().items[0].status,'failed');
    assert.notEqual(owner.service.snapshot().items[0].status,'completed');
    await owner.service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mp4'});
    assert.equal(owner.service.snapshot().items[0].status,'ready');assert.equal(owner.service.remuxPhase,null);
   }
   else {assert.equal(item.status,'unsupported');assert.match(item.reason,mode==='missing-budget'?/Remux operation record is incomplete/:/exact complete Remux evidence and active execution budgets/);}
  }finally{await owner.close();await fs.rm(root,{recursive:true,force:true});}
 }
});

test('actual shared service phase ownership refuses idle tools, expiry, overlap and restores idle capability inspection',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const temp=await fs.mkdtemp(path.join(os.tmpdir(),'remux-phase-'));
 const h=factoryHarness({realService:true,stateDir:temp}),owner=await h.create();const service=owner.service;
 try{
  await assert.rejects(service.run('/owned/ffprobe',['-version'],{timeoutMs:1000}));
  assert.equal(service.remuxPhase,undefined);await service.getCapabilities();assert.equal(h.calls.execute,0);
  service.begin('preparing');const phase=service.remuxPhase;
  assert.throws(()=>service.begin('running'),/not settled/);assert.equal(service.remuxPhase,phase);
  await service.run('/owned/ffprobe',['-version'],{timeoutMs:1000});assert.equal(phase.started,1);assert.equal(phase.live,0);
  phase.expires=performance.now()-1;await assert.rejects(service.run('/owned/ffprobe',['-version'],{timeoutMs:1000}));
  service.settleRemuxPhase();assert.equal(service.remuxPhase,null);await service.getCapabilities();
  service.begin('running');assert.equal(service.remuxPhase.started,0);service.remuxPhase.started=32;
  await assert.rejects(service.run('/owned/ffprobe',['-version'],{timeoutMs:1000}));service.settleRemuxPhase();
  assert.equal(h.calls.execute,1);
 }finally{service.settleRemuxPhase();await owner.close();await fs.rm(temp,{recursive:true,force:true});}
});

for (const change of ['cancelled','caller-cancelled','expired','replaced','closed']) test('deferred currentness cannot execute after '+change,async()=>{
 let release,entered,hold=false;const inside=new Promise(resolve=>entered=resolve);
 const h=factoryHarness({currentHook:async()=>{if(hold){entered();await new Promise(resolve=>release=resolve);}}});
 const owner=await h.create(),controller=new AbortController(),caller=new AbortController();
 const phase={signal:controller.signal,started:0,live:0,expires:performance.now()+600000};owner.service.remuxPhase=phase;hold=true;
 const pending=h.run('/owned/ffprobe',['-version'],{timeoutMs:1000,signal:caller.signal});await inside;
 if(change==='cancelled')controller.abort();
 if(change==='caller-cancelled')caller.abort();
 if(change==='expired')phase.expires=performance.now()-1;
 if(change==='replaced')owner.service.remuxPhase={...phase};
 if(change==='closed')await owner.close();
 release();await assert.rejects(pending);assert.equal(h.calls.execute,0);assert.equal(phase.live,0);
 if(change!=='closed')await owner.close();
});
test('phase abort reaches an already executing tool despite distinct optional caller signal',async()=>{
 let entered;const inside=new Promise(resolve=>entered=resolve);let observed;
 const h=factoryHarness({executeHook:async(_exe,_args,options)=>{observed=options.signal;entered();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('observed cancellation')),{once:true}));}});
 const owner=await h.create(),controller=new AbortController(),caller=new AbortController();
 owner.service.remuxPhase={signal:controller.signal,started:0,live:0,expires:performance.now()+600000};
 const pending=h.run('/owned/ffprobe',['-version'],{timeoutMs:1000,signal:caller.signal});await inside;
 controller.abort();await assert.rejects(pending,/observed cancellation/);assert.equal(observed.aborted,true);assert.equal(caller.signal.aborted,false);assert.equal(owner.service.remuxPhase.live,0);await owner.close();
});

test('Matroska admission adds CFR30 only without changing original MP4 admission',()=>{admit(assessment(()=>{},'matroska'),'/owned/source.mp4');assert.throws(()=>admit(assessment(p=>p.streams[0].avg_frame_rate='60/1','matroska'),'/owned/source.mp4'));admit(assessment(p=>p.streams[0].avg_frame_rate='60/1','mp4'),'/owned/source.mp4');});
test('fixed target policies preserve original MP4 and require separate MKV evidence',()=>{const {remuxPolicies,remuxSupport}=require('../linux-blue/product-linux-remux-service.cjs');const old={evidenceId:'old',policyIdentity:'old'};assert.deepEqual(remuxSupport(old).targets,['mp4']);const q={...old,matroska:{evidenceId:'new'}};const policies=remuxPolicies(q);assert.equal(policies[0].id,'internal-isobmff-mp4-081');assert.deepEqual(policies[0].evidenceIds,['old']);assert.equal(policies[1].target,'matroska');assert.deepEqual(policies[1].evidenceIds,['new']);assert.deepEqual(remuxSupport(q).targets,['mp4','matroska']);});

for(const [label,change] of [
 ['non-und',p=>p.streams[1].tags={language:'eng'}],['custom-handler',p=>p.streams[0].tags={handler_name:'Custom'}],
 ['track-title',p=>p.streams[0].tags={title:'Label'}],['unknown-track',p=>p.streams[0].tags={unassessed:'x'}],
 ['gain',p=>p.streams[1].tags={replaygain_track_gain:'1'}],['unknown-container',p=>p.format.tags={unassessed:'x'}],
 ['fake-provenance',p=>p.format.tags={FFMPEG_ENCODER_PROVENANCE_EVIL:'1'}],['forced',p=>p.streams[1].disposition.forced=1],
 ['no-default',p=>delete p.streams[1].disposition.default],['unknown-disposition',p=>p.streams[1].disposition.custom=1],
 ['fps60',p=>p.streams[0].avg_frame_rate='60/1'],['case-duplicate',p=>p.streams[1].tags={language:'und',LANGUAGE:'und'}]
])test('MOV target-local refusal '+label,()=>assert.throws(()=>admit(assessment(change,'mov'),'/owned/source.mp4')));
test('MOV allows unspecified/native-neutral metadata and existing descriptive policy without weakening other targets',()=>{
 for(const tags of [{},{language:'und'},{LANGUAGE:'und',encoder:'tool',creation_time:'2020-01-01T00:00:00Z'}])admit(assessment(p=>{p.streams[0].tags={...tags,handler_name:'VideoHandler'};p.streams[1].tags={language:'und',handler_name:'SoundHandler'};p.format.tags={major_brand:'isom',title:'description',encoder:'tool'};},'mov'),'/owned/source.mp4');
 for(const target of ['mp4','matroska'])admit(assessment(p=>{p.streams[1].tags={language:'eng',title:'Stereo'};},target),'/owned/source.mp4');
});
test('MOV policy requires fixed evidence and existing constant-cadence envelope',()=>{
 const {remuxPolicies,remuxSupport}=require('../linux-blue/product-linux-remux-service.cjs');const old={evidenceId:'old',matroska:{evidenceId:'mkv'}};assert.deepEqual(remuxSupport(old).targets,['mp4','matroska']);
 const q={...old,mov:{evidenceId:'mov',sourceEnvelope:'h264-aac-lc-48k-stereo-v1'}};assert.deepEqual(remuxSupport(q).targets,['mp4','matroska','mov']);assert.deepEqual(remuxPolicies(q).slice(0,2),remuxPolicies(old));assert.equal(remuxPolicies(q)[2].sourceEnvelope,'h264-aac-lc-48k-stereo-v1');
});

test('proportional admission is explicit MP4/MKV/MOV-only; standalone retains caps',()=>{
 for(const target of ['mp4','matroska','mov']){const a=assessment(p=>{p.format.duration='180';p.format.size=String(700*1024*1024);},target);assert.throws(()=>admit(a,'/owned/source.mp4'));if(['mp4','matroska','mov'].includes(target))admit(a,'/owned/source.mp4',{proportionalIsobmff:true});else assert.throws(()=>admit(a,'/owned/source.mp4',{proportionalIsobmff:true}));}
 for(const value of ['Infinity','NaN','0','-1'])assert.throws(()=>admit(assessment(p=>p.format.duration=value),'/owned/source.mp4',{proportionalIsobmff:true}));
 for(const value of ['0','1.5','9007199254740992'])assert.throws(()=>admit(assessment(p=>p.format.size=value),'/owned/source.mp4',{proportionalIsobmff:true}));
});

test('long MKV proportional admission preserves cadence audio and stream envelope',()=>{
 for(const mutate of [p=>p.streams[0].avg_frame_rate='60/1',p=>p.streams[1].sample_rate='44100',p=>p.streams.push({...p.streams[1],index:2})]){
  assert.throws(()=>admit(assessment(p=>{p.format.duration='180';p.format.size=String(700*1024*1024);mutate(p);},'matroska'),'/owned/source.mp4',{proportionalIsobmff:true}));
 }
});

for(const [label,change] of [
 ['non-und',p=>p.streams[1].tags={language:'eng'}],['custom-handler',p=>p.streams[0].tags={handler_name:'Custom'}],
 ['track-title',p=>p.streams[0].tags={title:'Label'}],['unknown-track',p=>p.streams[0].tags={unassessed:'x'}],
 ['gain',p=>p.streams[1].tags={replaygain_track_gain:'1'}],['unknown-container',p=>p.format.tags={unassessed:'x'}],
 ['fake-provenance',p=>p.format.tags={FFMPEG_ENCODER_PROVENANCE_EVIL:'1'}],['forced',p=>p.streams[1].disposition.forced=1],
 ['no-default',p=>delete p.streams[1].disposition.default],['unknown-disposition',p=>p.streams[1].disposition.custom=1],
 ['fps60',p=>p.streams[0].avg_frame_rate='60/1'],['case-duplicate',p=>p.streams[1].tags={language:'und',LANGUAGE:'und'}]
])test('Long MOV target-local refusal '+label,()=>assert.throws(()=>admit(assessment(p=>{p.format.duration='180';p.format.size=String(700*1024*1024);change(p);},'mov'),'/owned/source.mp4',{proportionalIsobmff:true})));
