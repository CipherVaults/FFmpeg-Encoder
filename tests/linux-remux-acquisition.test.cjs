'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admit,createAcquisition}=require('../linux-blue/remux-lifecycle-acquisition.cjs');
const {assessRemux}=require('../src/remux-contract.cjs');
function assessment(change=()=>{},target='mp4'){
 const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',profile:'High',level:40,width:1920,height:1080,pix_fmt:'yuv420p',field_order:'progressive',time_base:'1/30000',sample_aspect_ratio:'1:1',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',duration:'8',disposition:{default:1}},{index:1,codec_type:'audio',codec_name:'aac',profile:'LC',sample_fmt:'fltp',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:'1/48000',duration:'8',disposition:{default:1}}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',size:'5578679',duration:'8',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{}},chapters:[],programs:[],stream_groups:[]};change(probe);
 return assessRemux({request:{fileId:'inert',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]},probe,sourceFingerprint:'a'.repeat(64)});
}
test('genuine assessment admits source without execution readiness',()=>{const a=assessment();admit(a,'/owned/source.mp4');assert.equal(a.executionReady,false);});
test('serialized assessment cannot carry authority',()=>assert.throws(()=>admit(structuredClone(assessment()),'/owned/source.mp4')));
for(const [label,change] of [['audio-rate',p=>p.streams[1].sample_rate='44100'],['geometry',p=>p.streams[0].width=3840],['duration',p=>p.format.duration='61'],['size',p=>p.format.size=String(129*1024*1024)],['interlace',p=>p.streams[0].field_order='tt']])test('refuses '+label,()=>assert.throws(()=>admit(assessment(change),'/owned/source.mp4')));
test('MOV cannot borrow MP4 acquisition',()=>assert.throws(()=>admit(assessment(()=>{},'mov'),'/owned/source.mp4')));
test('fake runtime cannot open service',async()=>await assert.rejects(createAcquisition({verifiedRuntime:{},stateDir:'/owned/state'})));

// Execute the actual factory with module-local dependency doubles. No public
// test seam, subprocess or file-based runtime authority is introduced.
function factoryHarness({currentFailure=false,serviceFailure=false,observerCloseFailure=false,candidateCloseFailure=false}={}){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const filename=require.resolve('../linux-blue/remux-lifecycle-acquisition.cjs');
 const source=fs.readFileSync(filename,'utf8');
 const shell=fs.readFileSync(path.join(__dirname,'../linux-blue/product-linux-shell.cjs'),'utf8');
 const dependencies=JSON.parse(shell.match(/const DEPENDENCIES = (\[[\s\S]*?\]);/)[1]);
 const calls={execute:0,candidateClose:0,observerClose:0};let serviceOptions;
 const candidate={runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13',dependencies,pins:{ffmpeg:{path:'/owned/ffmpeg',size:1,sha256:'a'.repeat(64)},ffprobe:{path:'/owned/ffprobe',size:1,sha256:'b'.repeat(64)}},requireCurrent:async()=>{if(currentFailure)throw Error('primary-current');},close:async()=>{calls.candidateClose++;if(candidateCloseFailure)throw Error('candidate-close');}};
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
 m.require=id=>id==='./candidate-calibration-runtime.cjs'?{requireCandidateCalibrationRuntime:()=>candidate}:id==='../src/operation-runtime.cjs'?{OperationRuntimeObserver:class{async close(){calls.observerClose++;if(observerCloseFailure)throw Error('observer-close');}}}:id==='../src/process-runner.cjs'?{runTool:async()=>{calls.execute++;return {exitCode:0};}}:id==='../src/encoder-service.cjs'?{EncoderService:class{constructor(o){if(serviceFailure)throw Error('primary-service');serviceOptions=o;}async closeOperationResources(){await serviceOptions.operationRuntime.close();}async closeDiagnostics(){}}}:original(id);
 m._compile(source,filename);return {create:()=>m.exports.createAcquisition({verifiedRuntime:{},stateDir:'/owned/state'}),calls,run:(...args)=>serviceOptions.run(...args)};
}
test('actual factory refuses arbitrary GPU/video arguments before executor',async()=>{
 const h=factoryHarness(),owner=await h.create();
 for(const args of [['-c:v','hevc_nvenc'],['-hwaccel','cuda'],['-c:v','rawvideo'],['-c:v','libx264'],['-c:v','unknown']])await assert.rejects(h.run('/owned/ffmpeg',args,{timeoutMs:1000}));
 const sparse=[];sparse.length=1;await assert.rejects(h.run('/owned/ffprobe',sparse,{timeoutMs:1000}));
 await assert.rejects(h.run('/owned/ffprobe',[],{timeoutMs:1000,env:{}}));
 await assert.rejects(h.run('/other/tool',[],{timeoutMs:1000}));assert.equal(h.calls.execute,0);
 await h.run('/owned/ffprobe',['-version'],{timeoutMs:1000});assert.equal(h.calls.execute,1);await owner.close();assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,1);
});
test('actual factory admits only exact owned collector rawvideo grammar',async()=>{
 const h=factoryHarness(),owner=await h.create();
 const args=['-hide_banner','-loglevel','warning','-nostdin','-n','-xerror','-protocol_whitelist','file,pipe','-threads','1','-noautorotate','-f','h264','-i','/owned/state/operation-evidence/job/remux-evidence-one/clip.h264','-map','0:v:0','-an','-sn','-dn','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','framehash','-hash','sha256','pipe:1'];
 await h.run('/owned/ffmpeg',args,{timeoutMs:1000});assert.equal(h.calls.execute,1);
 for(const [index,value] of [[14,'/other/remux-evidence-one/clip.h264'],[21,'2'],[28,'rgb24'],[args.length-1,'/owned/file']]){const altered=[...args];altered[index]=value;await assert.rejects(h.run('/owned/ffmpeg',altered,{timeoutMs:1000}));}
 assert.equal(h.calls.execute,1);await owner.close();
});
test('construction currentness failure closes candidate and preserves primary',async()=>{const h=factoryHarness({currentFailure:true});await assert.rejects(h.create(),/primary-current/);assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,0);});
test('construction failure attempts both owned closures even if cleanup fails',async()=>{const h=factoryHarness({serviceFailure:true,observerCloseFailure:true,candidateCloseFailure:true});await assert.rejects(h.create(),e=>e instanceof AggregateError&&e.errors.map(x=>x.message).join(',')==='primary-service,observer-close,candidate-close');assert.equal(h.calls.candidateClose,1);assert.equal(h.calls.observerClose,1);});
