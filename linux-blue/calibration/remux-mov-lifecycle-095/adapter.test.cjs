'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admit,createAcquisition}=require('./acquisition.cjs');
const {assessRemux}=require('../ffmpeg-integration094/src/remux-contract.cjs');
function assessment(change=()=>{},target='mov'){
 const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',profile:'High',level:40,width:1920,height:1080,pix_fmt:'yuv420p',field_order:'progressive',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/30000',sample_aspect_ratio:'1:1',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',duration:'8',disposition:{default:1}},{index:1,codec_type:'audio',codec_name:'aac',profile:'LC',sample_fmt:'fltp',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:'1/48000',duration:'8',disposition:{default:1}}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',size:'5578679',duration:'8',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{}},chapters:[],programs:[],stream_groups:[]};change(probe);
 return assessRemux({request:{fileId:'inert',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]},probe,sourceFingerprint:'a'.repeat(64)});
}
test('genuine assessment admits source without execution readiness',()=>{const a=assessment();admit(a,'/owned/source.mp4');assert.equal(a.executionReady,false);});
test('serialized assessment cannot carry authority',()=>assert.throws(()=>admit(structuredClone(assessment()),'/owned/source.mp4')));
for(const [label,change] of [['audio-rate',p=>p.streams[1].sample_rate='44100'],['geometry',p=>p.streams[0].width=3840],['duration',p=>p.format.duration='61'],['size',p=>p.format.size=String(129*1024*1024)],['interlace',p=>p.streams[0].field_order='tt']])test('refuses '+label,()=>assert.throws(()=>admit(assessment(change),'/owned/source.mp4')));
test('Matroska cannot borrow MOV acquisition',()=>assert.throws(()=>admit(assessment(()=>{},'matroska'),'/owned/source.mp4')));
test('fake runtime cannot open service',async()=>await assert.rejects(createAcquisition({verifiedRuntime:{},stateDir:'/owned/state'})));

// Execute the actual factory with module-local dependency doubles. No public
// test seam, subprocess or file-based runtime authority is introduced.
function factoryHarness({currentFailure=false,serviceFailure=false,observerCloseFailure=false,candidateCloseFailure=false,realService=false,stateDir='/owned/state',transform=x=>x,currentHook=null,clock=null}={}){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const filename=require.resolve('./acquisition.cjs');
 const source=(clock?"const performance = require('__inert_clock__');\n":'')+transform(fs.readFileSync(filename,'utf8'));
 const shell=fs.readFileSync(path.join(__dirname,'../ffmpeg-integration094/linux-blue/product-linux-shell.cjs'),'utf8');
 const dependencies=JSON.parse(shell.match(/const DEPENDENCIES = (\[[\s\S]*?\]);/)[1]);
 const calls={execute:0,candidateClose:0,observerClose:0,current:0,options:[]};let serviceOptions;
 const candidate={runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13',dependencies,pins:{ffmpeg:{path:'/owned/ffmpeg',size:1,sha256:'a'.repeat(64)},ffprobe:{path:'/owned/ffprobe',size:1,sha256:'b'.repeat(64)}},requireCurrent:async()=>{calls.current++;if(currentHook)await currentHook(calls.current);if(currentFailure)throw Error('primary-current');},close:async()=>{calls.candidateClose++;if(candidateCloseFailure)throw Error('candidate-close');}};
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
 m.require=raw=>{const base=path.resolve(__dirname,'../ffmpeg-integration094');const id=raw.startsWith(base+'/src/')?'../src/'+path.basename(raw):raw===base+'/linux-blue/candidate-calibration-runtime.cjs'?'./candidate-calibration-runtime.cjs':raw;return id==='__inert_clock__'?clock:id==='./candidate-calibration-runtime.cjs'?{requireCandidateCalibrationRuntime:()=>candidate}:id==='../src/operation-runtime.cjs'?{OperationRuntimeObserver:class{async observe(){return Object.freeze({});}snapshot(){return {runtimeIdentity:candidate.runtimeIdentity,environment:null};}async close(){calls.observerClose++;if(observerCloseFailure)throw Error('observer-close');}}}:id==='../src/process-runner.cjs'?{runTool:async(_exe,_args,options)=>{calls.execute++;calls.options.push(options);return {exitCode:0};}}:id==='../src/encoder-service.cjs'&&!realService?{EncoderService:class{constructor(o){if(serviceFailure)throw Error('primary-service');serviceOptions=o;}async closeOperationResources(){await serviceOptions.operationRuntime.close();}async closeDiagnostics(){}}}:original(raw);};
 m._compile(source,filename);return {create:()=>m.exports.createAcquisition({verifiedRuntime:{},stateDir}),calls,run:(...args)=>serviceOptions.run(...args)};
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
 const {playbackFixture}=require('../ffmpeg-integration094/tests/helpers/mov-fixture.cjs');
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
   await owner.service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mov'});
   const item=owner.service.snapshot().items[0];assert.equal(h.calls.execute,0);
   if(mode==='correct')assert.equal(item.status,'ready',item.reason);
   else {assert.equal(item.status,'unsupported');assert.match(item.reason,mode==='missing-budget'?/Remux operation record is incomplete/:/exact complete Remux evidence and active execution budgets/);}
  }finally{await owner.close();await fs.rm(root,{recursive:true,force:true});}
 }
});

test('MP4 cannot borrow private MOV acquisition',()=>assert.throws(()=>admit(assessment(()=>{},'mp4'),'/owned/source.mp4')));
test('non-CFR30 cannot borrow private MOV acquisition',()=>assert.throws(()=>admit(assessment(p=>p.streams[0].avg_frame_rate='60/1'),'/owned/source.mp4')));

for(const mode of ['owner-close','caller-abort','deadline-expiry','positive'])test('deferred runtime currentness '+mode+' rechecks before executor',async()=>{
 let release,entered;const waiting=new Promise(r=>entered=r),block=new Promise(r=>release=r);let now=100;
 const h=factoryHarness({clock:{now:()=>now},currentHook:async n=>{if(n===2){entered();await block;}}});const owner=await h.create(),controller=new AbortController();
 const attempt=h.run('/owned/ffprobe',['-version'],{timeoutMs:120000,signal:controller.signal});
 await waiting;
 if(mode==='owner-close')await owner.close();
 if(mode==='caller-abort')controller.abort();
 now=mode==='deadline-expiry'?600100:599850;
 release();
 if(mode==='positive'){await attempt;assert.equal(h.calls.execute,1);assert.equal(h.calls.options[0].timeoutMs,250);}
 else {await assert.rejects(attempt,/retired|expired/);assert.equal(h.calls.execute,0);}
 if(mode!=='owner-close')await owner.close();
});

test('MOV metadata-family requirement remains explicit; provisional lifecycle is not accepted product evidence',()=>{
 const a=assessment();assert(a.qualifications.some(q=>q.id==='mov-family-metadata-mode'));assert.equal(a.executionReady,false);
 const {buildRemuxQualificationArgs}=require('../ffmpeg-integration094/src/remux-contract.cjs');
 const args=buildRemuxQualificationArgs({assessment:a,input:'/owned/source.mp4',output:'/owned/output.mov',outputId:'11111111-1111-4111-8111-111111111111'});
 assert(args.includes('use_metadata_tags'));assert.equal(args[args.indexOf('-write_tmcd')+1],'0');assert.equal(args[args.indexOf('-f')+1],'mov');
 const {getCollectedMovRepresentation}=require('../ffmpeg-integration094/src/remux-evidence.cjs');assert.throws(()=>getCollectedMovRepresentation({},{}));
});
test('private MOV cell cannot imply chapters or extra ancillary coverage',()=>{
 assert.throws(()=>admit(assessment(p=>p.chapters=[{id:0,time_base:'1/1000',start:0,end:1000,tags:{title:'chapter'}}]),'/owned/source.mp4'));
 assert.throws(()=>admit(assessment(p=>p.streams.push({index:2,codec_type:'subtitle',codec_name:'mov_text'})),'/owned/source.mp4'));
});
