'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
function harness({holdOpen=false,failClose=false,genuineSelector=false,matroska=false,mov=false,movV2=false}={}){
 const filename=require.resolve('../linux-blue/product-linux-unified-service.cjs');const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);const generations=[];let releaseOpen,entered;const opened=new Promise(r=>entered=r);
 const open=async(_root,_state,_onChild,selector)=>{if(holdOpen&&generations.length){entered();await new Promise(r=>releaseOpen=r);}let phase=null;const gen={closed:false,runCalls:0,observeCalls:0,run:async()=>{gen.runCalls++;throw Error('No media execution in fixture');},observer:{observe:async()=>{gen.observeCalls++;return Object.freeze({});},close:async()=>{},snapshot:()=>({...(genuineSelector?{environment:null}:{}),runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13'})},current:async()=>assert(!gen.closed),bindMeasured(selection,bindings){const q=selector.requireCurrent(selection,bindings());return Object.freeze({q,bindings});},bindRemux(owner,selection,bindings){const q=require('../src/remux-operation.cjs').RemuxOperations.prototype.requireCurrent.call(owner,selection,bindings());return Object.freeze({q,bindings});},begin(route,kind,controller,control){assert(!phase);phase={route,kind,controller,control};gen.lastControl=control;},settle(){phase=null;},abort(){phase?.controller.abort();},assertCurrent(){assert(phase&&!phase.controller.signal.aborted);},get signal(){return phase.controller.signal;},snapshot(){return {closed:gen.closed,phase:phase?.kind||null,live:0};},close:async()=>{gen.closed=true;if(failClose)throw Error('close-failure');}};generations.push(gen);return gen;};
 const replacements={'./product-linux-qualification.cjs':{loadQualification:()=>genuineSelector?original('./product-linux-qualification.json'):({})},'./product-linux-remux-qualification.cjs':{loadRemuxQualification:()=>({policyIdentity:'fixture-internal',evidenceId:'fixture-audit',matroska:matroska?{evidenceId:'fixture-mkv'}:null,mov:mov?{evidenceId:'fixture-mov',sourceEnvelope:movV2?'h264-aac-lc-48k-stereo-v2':'h264-aac-lc-48k-stereo-v1'}:null})},'./product-linux-service.cjs':{createProductSelector:()=>({invalidate(){},orientationQualification(){return {};},select(){throw Error('No measured authority from fixture');}})},'./product-linux-unified-runtime.cjs':{openUnifiedGeneration:open}};
 if(genuineSelector)delete replacements['./product-linux-service.cjs'];
 m.require=id=>replacements[id]||original(id);m._compile(fs.readFileSync(filename,'utf8'),filename);return {...m.exports,generations,opened,release:()=>releaseOpen()};
}
async function setup(t,options={}){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'unified-'));const h=harness(options);const service=await h.createUnifiedService({runtimeRoot:path.join(root,'runtime'),stateDir:path.join(root,'state'),outputAccess:options.outputAccess});t.after(async()=>{await service.closeOperationResources().catch(()=>{});await service.closeDiagnostics().catch(()=>{});await fsp.rm(root,{recursive:true,force:true});});return {h,service,root};}
test('one real EncoderService preserves identity while cancelling READY encode authority and preparing a new generation',async t=>{
 const {h,service}=await setup(t);const {EncoderService}=require('../src/encoder-service.cjs');assert(service instanceof EncoderService);assert.equal(service.snapshot().developerProduct.composition,'unified-linux-operations-v1');
 service.state.phase='ready';service.state.items=[{id:'old',status:'ready'}];service.state.planId='old-plan';service.plan={operation:'encode',id:'old-plan',entries:new Map()};
 await service.cancelCurrent();assert.equal(service.plan,null);assert.equal(service.state.planId,null);assert.equal(service.state.items[0].status,'cancelled');assert(h.generations[0].closed);assert.equal(service.admissionClosed,false);
 await assert.rejects(service.startBatch({planId:'old-plan',fileIds:['old']}));
 await service.mutate('renew',['remux']);assert.equal(h.generations.length,2);assert.equal(service.route,'remux');assert.equal(service.ordinaryJobGuard,null);
 await service.mutate('renew',['ordinary']);assert.equal(h.generations.length,3);assert.equal(typeof service.ordinaryJobGuard,'function');assert.equal(service.operationEvidenceBudget,null);
});
test('cancel during deferred acquisition retires stale continuation and permits fresh explicit ownership',async t=>{
 const {h,service}=await setup(t,{holdOpen:true});const pending=service.mutate('renew',['remux']);await h.opened;
 const cancellation=service.cancelCurrent();await assert.rejects(service.startBatch({planId:'x',fileIds:['x']}),/fenced/);h.release();await assert.rejects(pending,/retired/);await cancellation;
 assert.equal(service.generation,null);assert(h.generations.every(g=>g.closed));assert.equal(service.plan,null);
});
test('failed generation retirement blocks new authority rather than swallowing uncertain cleanup',async t=>{
 const {h,service}=await setup(t,{failClose:true});await assert.rejects(service.mutate('renew',['remux']),e=>e instanceof AggregateError&&e.errors.some(x=>x.message==='close-failure'));assert.equal(h.generations.length,1);assert.equal(service.route,'ordinary');
});
test('fixed tuples reject fallback and preserve existing strict shared ordinary guard implementation',()=>{
 const h=harness();assert.equal(h.fixedSettings({profileId:'h264-cpu',preset:'veryfast',quality:23}),'ordinary');assert.equal(h.fixedSettings({profileId:'h265-cpu',preset:'slow',quality:25}),'h265');assert.equal(h.fixedSettings({profileId:'h265-cpu',preset:'fast',quality:23}),'h265');
});

function sourceProbe() {
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

test('actual shared ordinary and remux preparation cross routes without retaining stale Start or ordinary guard',async t=>{
 const {h,service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>s.id=String(i+1));
 const file=path.join(input,'source.mp4');await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(file)).size);
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});
 service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id};
 const ordinary=await service.prepareBatch({...folders,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}});assert.equal(ordinary.items[0].status,'ready',ordinary.items[0].reason);assert.equal(typeof service.ordinaryJobGuard,'function');
 const remux=await service.prepareRemuxBatch({...folders,target:'mp4'});assert.equal(remux.items[0].status,'ready',remux.items[0].reason);assert.equal(service.ordinaryJobGuard,null);assert.equal(service.operationDeadlineMs,600000);
 await assert.rejects(service.startBatch({planId:ordinary.planId,fileIds:[ordinary.items[0].id]}));
 await service.cancelCurrent();assert.equal(service.plan,null);const repeated=await service.prepareBatch({...folders,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}});assert.equal(repeated.items[0].status,'ready',repeated.items[0].reason);assert.equal(service.operationDeadlineMs,120000);assert.equal(typeof service.ordinaryJobGuard,'function');assert(h.generations.length>=4);
});

test('Linux legacy MP4 ticket explains a two-AAC refusal without publishing, selecting or dropping either track',async t=>{
  const {service,h,root}=await setup(t);const i=path.join(root,'input'),o=path.join(root,'output');await fsp.mkdir(i);await fsp.mkdir(o);
  const src=path.join(i,'two.mp4'),probe=sourceProbe(),extra=structuredClone(probe.streams[1]);
  extra.index=2;extra.id='0x3';extra.disposition={...extra.disposition,default:0};extra.tags={...extra.tags,language:'ara'};
  probe.streams.push(extra);probe.format.nb_streams=3;probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>s.id=String(i+1));
  await fsp.writeFile(src,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(src)).size);const before=structuredClone(probe);
  service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};
  const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
  await service.prepareRemuxBatch({inputFolderId:input.id,outputFolderId:output.id,target:'mp4'});await service.taskPromise;
  const snap=service.snapshot(),item=snap.items[0];assert.equal(item.status,'unsupported');assert.equal(item.reasonCode,'REMUX_MULTI_AUDIO_NOT_QUALIFIED');
  assert.match(item.reason,/two AAC audio tracks/i);assert.match(item.reason,/no track was omitted/i);assert(!item.reason.includes('assert('));
  assert.equal(service.plan?.entries?.has(item.id)??false,false);assert(h.generations.every(g=>g.runCalls===0));assert.deepEqual(probe,before);assert.deepEqual(await fsp.readdir(o),[]);
});

for (const scenario of ['valid TS','malformed TS','qualified MP4']) {
 test('Linux Remux Prepare: '+scenario,async t=>{
  const {service,h,root}=await setup(t);
  const input=path.join(root,'input'),output=path.join(root,'output');
  await fsp.mkdir(input);await fsp.mkdir(output);
  const isTs=scenario!=='qualified MP4',name=isTs?'source.ts':'source.mp4',file=path.join(input,name);
  const probe=sourceProbe();
  if (isTs) {
   Object.assign(probe.format,{format_name:'mpegts',start_time:'1.4',nb_programs:1,tags:{}});
   probe.streams.forEach((s,i)=>Object.assign(s,{id:'0x10'+i,time_base:'1/90000',start_pts:126000,start_time:'1.4',duration_ts:180000,tags:{}}));
   probe.streams[1].codec_tag_string='[15][0][0][0]';
   probe.programs=[{program_id:1,program_num:1,pmt_pid:4096,pcr_pid:256,nb_streams:2,streams:[{index:0},{index:1}]}];
   if (scenario==='malformed TS') {probe.programs=[];probe.format.nb_programs=0;}
   // The real discovery and Prepare own this file, but its media probe is inert.
   await fsp.writeFile(file,'Not transport bytes: inert metadata-gate fixture.');
  } else {
   probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>s.id=String(i+1));
   await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));
  }
  probe.format.size=String((await fsp.stat(file)).size);
  const probeBefore=structuredClone(probe);
  const {assessRemux}=require('../src/remux-contract.cjs');
  const assessment=assessRemux({probe,sourceFingerprint:'a'.repeat(64),
    request:{fileId:'fixture',identityRevision:0,draftRevision:0,operation:'remux',target:'mp4',range:null,omissionRequestIds:[]}});
  if (scenario!=='malformed TS') {
   assert.equal(assessment.inputFamily,isTs?'mpegts':'isobmff');
   assert.equal(assessment.status,'qualification-required');assert.deepEqual(assessment.blockers,[]);
  } else assert.equal(assessment.blockers[0].code,'REMUX_TS_PROGRAM');
  const inspections=[];
  service.inspect=async source=>{inspections.push(source);return {probe:structuredClone(probe),duration:2,summary:{}};};
  service.storageEligibility={check:async()=>({eligible:true})};
  const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
  await service.prepareRemuxBatch({inputFolderId:i.id,outputFolderId:o.id,target:'mp4'});
  await service.taskPromise;
  const prepared=service.snapshot(),item=prepared.items[0];
  assert.deepEqual(inspections,[file]);assert.deepEqual(probe,probeBefore);
  assert.deepEqual(prepared.remuxSupport.targets,['mp4']);assert.equal(prepared.items.length,1);assert.equal(item.name,name);
  assert.equal(service.executionBinding,null);assert(h.generations.every(g=>g.runCalls===0));
  assert.deepEqual(await fsp.readdir(output),[]);
  if (!isTs) {
   assert.equal(prepared.phase,'ready');assert.equal(item.status,'ready',item.reason);assert.equal(item.remux.status,'qualified');
   const entry=service.plan.entries.get(item.id);
   assert.equal(service.plan.entries.size,1);assert(entry.operationRuntimeToken);assert.equal(entry.transportPreparation,null);
   assert.equal(service.generation.observeCalls,1);
   const selected=service.remuxOperations.requireCurrent(entry.qualificationSelection,entry.qualificationBindings);
   assert.equal(selected.qualification.inputFamily,'isobmff');assert.equal(selected.qualification.cellId,'internal-isobmff-mp4-081');
   assert(entry.preparedArgs.includes('copy'));return;
  }
  assert.equal(item.status,'unsupported',item.reason);assert.equal(item.remux.status,'blocked');
  assert.equal(service.plan.entries.size,0);assert.equal(service.generation.observeCalls,0);
  const plan=service.plan,generation=service.generation,task=service.taskPromise;
  await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[item.id]}));
  assert.equal(service.plan,plan);assert.equal(service.taskPromise,task);assert.equal(service.generation,generation);
  assert.equal(generation.snapshot().phase,null);assert.equal(service.executionBinding,null);assert(h.generations.every(g=>g.runCalls===0));
  assert.deepEqual(await fsp.readdir(output),[]);
  if (scenario==='malformed TS') {
   assert.equal(item.reasonCode,'REMUX_TS_PROGRAM',item.reason);
   assert.match(item.reason,/exactly one known program/);
   assert.deepEqual(item.remux.blockers,assessment.blockers);
  } else {
   const message='MPEG-TS to MP4 is not yet qualified in this Linux build. No copy was started.';
   assert.equal(item.reasonCode,'REMUX_QUALIFICATION_REQUIRED',item.reason);
   assert.equal(item.reason,message);
   assert.deepEqual(item.remux.blockers,[{code:item.reasonCode,message,streamIndex:null}]);
  }
 });
}

test('generation begin refusal cannot publish false running state or replace controller/task',async t=>{
 const {service}=await setup(t);service.state.phase='ready';const before=service.snapshot(),controller=service.controller,task=service.taskPromise;let emissions=0;service.on('update',()=>emissions++);
 service.generation.begin=()=>{throw Error('retired generation');};assert.throws(()=>service.begin('running'),/retired generation/);
 assert.deepEqual(service.snapshot(),before);assert.equal(service.controller,controller);assert.equal(service.taskPromise,task);assert.equal(emissions,0);
});

function measuredProbe(size) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 2560, height: 1440,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360',
    start_pts: 0, start_time: '0', duration_ts: 150 * 15360, duration: '150', disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 7200000, duration: '150', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '150', size: String(size), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, chapters: [], programs: [], stream_groups: [] };
}

test('genuine measured selector admits exact1440 range then route returns to ordinary without fallback',async t=>{
 const {service,root}=await setup(t,{genuineSelector:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);const file=path.join(input,'source.mov');await fsp.writeFile(file,'Inert inspected source; no media.');
 let probe=measuredProbe((await fsp.stat(file)).size);
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:150,summary:{selectedVideoIndex:0,codec:'h264',width:2560,height:1440,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id};
 const first=await service.prepareBatch({...folders,settings:{profileId:'h265-cpu',preset:'slow',quality:25}});
 const result=await service.updateFileOperations({planId:first.planId,draftId:first.operationDraft.id,revision:first.operationDraft.revision,fileIds:[first.items[0].id],overrides:{resolution:'720',range:{startUs:1000000,endUs:1500000},audioPolicy:'precision-flac'}});
 assert.equal(result.items[0].status,'ready',result.items[0].reason);const entry=service.plan.entries.get(result.items[0].id);assert(entry.qualificationSelection);assert(entry.operationRuntimeToken);assert.equal(entry.operationPlan.compatibilityPath,false);assert.equal(service.ordinaryJobGuard,null);
 let measuredKind;service.generation.begin=(route,phase,_controller,control)=>{
  measuredKind=route;assert.equal(phase,'running');assert.equal(service.ordinaryJobGuard,null);assert.equal(service.executionBinding.entry,entry);
  assert(control&&control.q.executionBudgetMs>600000);assert.equal(control.bindings().plan,entry.operationPlan);
  const generation=service.generation,oldAssert=generation.assertCurrent,binding=service.executionBinding;
  const guard=service.publicationCurrentness(entry,control.q);
  let checked=0;generation.assertCurrent=token=>{assert.equal(token,control);checked++;};
  try{guard();assert.equal(checked,1);service.executionBinding=null;assert.throws(guard,/owner is retired/);}
  finally{generation.assertCurrent=oldAssert;service.executionBinding=binding;}
  const fingerprint=entry.fingerprint;entry.fingerprint={...fingerprint,ctimeNs:'1'};
  try{assert.throws(()=>service.operationQualifications.requireCurrent(entry.qualificationSelection,control.bindings()));}
  finally{entry.fingerprint=fingerprint;}
  throw Error('measured inert stop');
 };
 await assert.rejects(service.startBatch({planId:result.planId,fileIds:[result.items[0].id]}),/Prepare a fresh batch/);assert.equal(measuredKind,'measured');assert.equal(service.executionBinding,null);assert.equal(service.plan,null);assert.equal(service.state.phase,'failed');
 await service.cancelCurrent();assert.equal(service.plan,null);
 const nondefault=await service.prepareBatch({...folders,settings:{profileId:'h265-cpu',preset:'fast',quality:28}});
 const refused=await service.updateFileOperations({planId:nondefault.planId,draftId:nondefault.operationDraft.id,revision:nondefault.operationDraft.revision,fileIds:[nondefault.items[0].id],overrides:{resolution:'720',range:{startUs:1000000,endUs:1500000},audioPolicy:'precision-flac'}});
 assert.equal(refused.items[0].status,'unsupported');assert.equal(service.plan.entries.size,0);await service.cancelCurrent();
 probe=sourceProbe();probe.format.size=String((await fsp.stat(file)).size);
 const ordinary=await service.prepareBatch({...folders,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}});assert.equal(ordinary.items[0].status,'ready',ordinary.items[0].reason);assert.equal(typeof service.ordinaryJobGuard,'function');
});

test('genuine completed OutputAccess survives renew and Cancel, rejects changed file and owner close',async t=>{
 const {OutputAccess}=require('../src/output-access.cjs'),{readSourceIdentity}=require('../src/source-identity.cjs');let actions=0;
 const access=new OutputAccess({openPath:async()=>{actions++;return '';},showItemInFolder:()=>{actions++;}});
 const {service,root}=await setup(t,{outputAccess:access});const file=path.join(root,'completed.mp4');await fsp.writeFile(file,'Owned completed identity test, not actual media proof.');
 const grant=await access.issue({file,identity:await readSourceIdentity(file)});
 await service.mutate('renew',['remux']);await service.openCompletedOutput({...grant,action:'reveal'});await service.cancelCurrent();await service.openCompletedOutput({...grant,action:'open'});assert.equal(actions,2);
 await fsp.appendFile(file,'changed');await assert.rejects(service.openCompletedOutput({...grant,action:'open'}));assert.equal(actions,2);
 const renewed=await access.issue({file,identity:await readSourceIdentity(file)});await service.closeOperationResources();await assert.rejects(service.openCompletedOutput({...renewed,action:'open'}));assert.equal(actions,2);
});
test('running cancellation keeps explicit Prepare fenced until owned task and observer settle',async t=>{
 const {service,h}=await setup(t);service.begin('running');let release;const task=new Promise(r=>release=r);service.taskPromise=task.then(()=>service.generation.settle());
 let closed=false;const original=service.generation.close;service.generation.close=async()=>{closed=true;return original();};
 const cancellation=service.cancelCurrent();await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert.equal(service.state.phase,'cancelling');
 await assert.rejects(service.prepareRemuxBatch({inputFolderId:'x',outputFolderId:'y',target:'mp4'}),/fenced/);assert.equal(h.generations.length,1);
 release();await cancellation;assert.equal(closed,true);assert.equal(service.state.phase,'cancelled');await service.mutate('renew',['remux']);assert.equal(h.generations.length,2);
});
test('actual AV1 Prepare keeps compatibility guard, native capability and fresh-route ownership',async t=>{
 const {service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);const probe=sourceProbe();await fsp.writeFile(path.join(input,'source.mkv'),'inert fixture');
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id},settings={profileId:'av1-cpu',preset:'6',quality:32};
 const prepared=await service.prepareBatch({...folders,settings});assert.equal(prepared.items[0].status,'ready',prepared.items[0].reason);assert.equal(service.route,'av1-ordinary');assert.equal(typeof service.ordinaryJobGuard,'function');
 const caps=await service.getCapabilities(),av1=caps.profiles.find(p=>p.id==='av1-cpu');assert.deepEqual(av1.presets,Array.from({length:10},(_,i)=>String(i)));assert.equal(av1.candidateFixedSettings,false);assert.deepEqual(av1.supportedBitDepths,[8]);assert.equal(av1.quality.min,1);
 assert.deepEqual(service.getRecipe(settings).args,['-c:v:0','libsvtav1','-preset:v:0','6','-crf:v:0','32']);
 await assert.rejects(service.reprepareEncodingSettings({settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}}),/fresh explicit Prepare/);
 await service.cancelCurrent();assert.equal(service.plan,null);await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]}));
 const next=await service.prepareBatch({...folders,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}});assert.equal(next.items[0].status,'ready',next.items[0].reason);assert.equal(service.route,'ordinary');
});
test('H265 Start refusal retires mutated plans and permits only fresh explicit preparation',async t=>{
 const {service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);await fsp.writeFile(path.join(input,'source.mp4'),'inert source');const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach(s=>s.time_base='1/48000');
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id};
 for(const settings of [{profileId:'h265-cpu',preset:'slow',quality:25},{profileId:'h265-cpu',preset:'fast',quality:28}]){
 const prepared=await service.prepareBatch({...folders,settings});assert.equal(prepared.items[0].status,'ready',prepared.items[0].reason);const entry=service.plan.entries.get(prepared.items[0].id);assert.equal(entry.operationPlan.compatibilityPath,true);assert.equal(service.route,'h265');assert.equal(service.ordinaryJobGuard,null);
 assert.deepEqual(service.getRecipe(settings).testedDefault.settings,{profileId:'h265-cpu',preset:'slow',quality:25});
 const caps=(await service.getCapabilities()).profiles.find(p=>p.id==='h265-cpu');assert(caps.presets.includes('veryslow'));assert.equal(caps.quality.max,51);assert.equal(caps.defaultPreset,'slow');assert.equal(caps.candidateFixedSettings,false);
 assert.deepEqual(service.getRecipe(settings).args,['-c:v:0','libx265','-preset:v:0',settings.preset,'-crf:v:0',String(settings.quality),'-x265-params','aq-mode=3:psy-rd=2']);
 await assert.rejects(service.startBatch({planId:'stale',fileIds:[prepared.items[0].id]}));assert.equal(service.executionBinding,null);
 await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id],extra:true}));assert.equal(service.executionBinding,null);assert.equal(service.ordinaryJobGuard,null);assert.equal(service.state.phase,'ready');
 await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id,prepared.items[0].id]}));assert.equal(service.executionBinding,null);
 const original=service.generation.begin;let observed;
 const terminal=[];const record=snapshot=>{if(snapshot.phase==='failed')terminal.push({snapshot,generation:service.generation,binding:service.executionBinding,guard:service.ordinaryJobGuard});};service.on('update',record);
 const failAfterAdmission=settings.preset==='fast';const listener=()=>{if(service.state.phase==='running')throw Error('inert begin refusal');};if(failAfterAdmission)service.on('update',listener);const brokenTerminal=()=>{if(service.state.phase==='failed')throw Error('terminal listener failure');};if(!failAfterAdmission)service.on('update',brokenTerminal);
 service.generation.begin=(route,kind,controller)=>{observed={route,kind,binding:service.executionBinding,guard:service.ordinaryJobGuard};if(failAfterAdmission)return original(route,kind,controller);throw Error('inert begin refusal');};
 await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]}),error=>{assert.match(error.message,/Prepare a fresh batch/);assert.match(error.cause.message,/inert begin refusal/);return true;});
 assert.equal(terminal.length,1);assert.equal(terminal[0].generation,null);assert.equal(terminal[0].binding,null);assert.equal(terminal[0].guard,null);assert.equal(terminal[0].snapshot.planId,null);service.off('update',record);
 service.off('update',listener);service.off('update',brokenTerminal);assert.equal(observed.route,'h265-ordinary');assert.equal(observed.kind,'running');assert.equal(observed.binding.entry,entry);assert(Object.isFrozen(observed.binding));assert.equal(typeof observed.guard,'function');assert.equal(service.executionBinding,null);assert.equal(service.ordinaryJobGuard,null);assert.equal(service.state.phase,'failed');assert.equal(service.plan,null);assert.equal(service.generation,null);await assert.rejects(service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]}));
 }
 await service.cancelCurrent();assert.equal(service.plan,null);
});

test('H265 ordinary binding and mandatory guard survive deferred execution then clear on settlement',async t=>{
 const {service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);await fsp.writeFile(path.join(input,'source.mp4'),'inert source');const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');const prepared=await service.prepareBatch({inputFolderId:i.id,outputFolderId:o.id,settings:{profileId:'h265-cpu',preset:'slow',quality:25}});
 const originalExecute=service.execute;let release;const barrier=new Promise(r=>release=r);service.execute=async(...args)=>{await barrier;return originalExecute(...args);};
 try{await service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]});const binding=service.executionBinding,guard=service.ordinaryJobGuard;assert(binding&&typeof guard==='function');await new Promise(r=>setImmediate(r));assert.equal(service.executionBinding,binding);assert.equal(typeof service.ordinaryJobGuard,'function');}finally{release();}
 await service.taskPromise;assert.equal(service.executionBinding,null);assert.equal(service.ordinaryJobGuard,null);assert.equal(service.generation.snapshot().phase,null);
 // Fake runtime deliberately refuses any media execution; this tests ownership, not an encode.
});

test('actual AAC Prepare and Start bind frozen per-entry controls without widening service defaults',async t=>{
 const {service,root}=await setup(t,{genuineSelector:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const file=path.join(input,'source.mp4');await fsp.writeFile(file,'Independent inert prepared input, not acquired media.');
 const probe=measuredProbe((await fsp.stat(file)).size);Object.assign(probe.streams[0],{width:1280,height:720,duration:'8',duration_ts:122880});Object.assign(probe.streams[1],{codec_name:'aac',profile:'LC',sample_fmt:'fltp',duration:'8',duration_ts:384000});probe.format.duration='8';
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:8,summary:{selectedVideoIndex:0,codec:'h264',width:1280,height:720,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
 const mutableBudget=structuredClone(require('../src/operation-controls.cjs').EVIDENCE_BUDGET),resolve=service.resolveEncodeControls.bind(service);
 service.resolveEncodeControls=(plan,settings)=>{const controls=resolve(plan,settings);return controls.budget?{...controls,budget:mutableBudget}:controls;};
 const first=await service.prepareBatch({inputFolderId:i.id,outputFolderId:o.id,settings:{profileId:'h265-cpu',preset:'slow',quality:25}});
 const ready=await service.updateFileOperations({planId:first.planId,draftId:first.operationDraft.id,revision:first.operationDraft.revision,fileIds:[first.items[0].id],overrides:{resolution:'source',range:{startUs:613000,endUs:2721000},audioPolicy:'precision-aac'}});
 assert.equal(ready.items[0].status,'ready',ready.items[0].reason);const entry=service.plan.entries.get(ready.items[0].id);
 assert.equal(entry.encodeControls.executionBudgetMs,600000);assert(Object.isFrozen(entry.encodeControls));assert(Object.isFrozen(entry.encodeControls.budget));assert(Object.isFrozen(entry.encodeControlsSettings));
 assert.equal(service.operationDeadlineMs,120000);assert.equal(service.operationEvidenceBudget,null);assert.equal(service.ordinaryJobGuard,null);
 assert.notEqual(entry.encodeControls.budget,mutableBudget);const max=mutableBudget.maxRecords;mutableBudget.maxRecords=1;assert.equal(entry.encodeControls.budget.maxRecords,max);assert.throws(()=>service.requirePreparedEncodeControls(entry),{code:'OPERATION_CONTROLS_STALE'});const beforePlan=service.plan,beforeTask=service.taskPromise,beforeGeneration=service.generation,beforeDraft=service.plan.draft.snapshot(),beforeItems=structuredClone(service.state.items);
 await assert.rejects(service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]}),{code:'OPERATION_CONTROLS_STALE'});
 assert.equal(service.plan,beforePlan);assert.equal(service.taskPromise,beforeTask);assert.equal(service.generation,beforeGeneration);assert.equal(service.executionBinding,null);assert.equal(service.ordinaryJobGuard,null);assert.deepEqual(service.plan.draft.snapshot(),beforeDraft);assert.deepEqual(service.state.items,beforeItems);assert.equal(service.state.phase,'ready');mutableBudget.maxRecords=max;
 let release,entered;const began=new Promise(r=>entered=r);const originalExecute=service.execute;
 service.execute=async()=>{assert.equal(service.executionBinding.kind,'measured');assert.equal(service.ordinaryJobGuard,null);entered();await new Promise(r=>release=r);assert.equal(service.requirePreparedEncodeControls(entry).executionBudgetMs,600000);service.generation.settle();service.state.phase='completed';};
 await service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]});await began;assert.equal(service.executionBinding.entry,entry);assert.equal(service.generation.lastControl,null);release();await service.taskPromise;service.execute=originalExecute;
 await service.cancelCurrent();assert.equal(service.plan,null);
});

test('real target Prepare renews ownership and refuses stale MP4 Start after MKV selection',async t=>{
 const {service,root,h}=await setup(t,{matroska:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>s.id=String(i+1));const file=path.join(input,'source.mp4');await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(file)).size);
 service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id};
 assert.deepEqual(service.snapshot().remuxSupport.targets,['mp4','matroska']);
 const first=await service.prepareRemuxBatch({...folders,target:'mp4'});assert.equal(first.items[0].status,'ready',first.items[0].reason);const priorGeneration=service.generation,priorPlan=service.plan;
 const second=await service.prepareRemuxBatch({...folders,target:'matroska'});assert.equal(second.items[0].status,'ready',second.items[0].reason);assert(priorGeneration.closed);assert.notEqual(first.planId,second.planId);assert.notEqual(service.plan,priorPlan);
 const current=service.snapshot();await assert.rejects(service.startBatch({planId:first.planId,fileIds:[first.items[0].id]}));assert.equal(service.snapshot().phase,current.phase);assert.equal(service.plan.id,second.planId);
 await service.cancelCurrent();assert.equal(service.plan,null);const third=await service.prepareRemuxBatch({...folders,target:'matroska'});assert.equal(third.items[0].status,'ready',third.items[0].reason);assert.notEqual(third.planId,second.planId);assert(h.generations.length>=4);
});
test('unsupported target refuses before renewing ownership or changing pending plan',async t=>{const {service,h}=await setup(t);const count=h.generations.length;await assert.rejects(service.prepareRemuxBatch({inputFolderId:'x',outputFolderId:'y',target:'matroska'}),/reviewed current/);assert.equal(h.generations.length,count);});
test('real target Prepare renews ownership and refuses stale MP4 Start after MOV selection',async t=>{
 const {service,root,h}=await setup(t,{matroska:true,mov:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>{s.id=String(i+1);s.tags={language:'und',handler_name:i?'SoundHandler':'VideoHandler'};});const file=path.join(input,'source.mp4');await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(file)).size);
 service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output'),folders={inputFolderId:i.id,outputFolderId:o.id};
 assert.deepEqual(service.snapshot().remuxSupport.targets,['mp4','matroska','mov']);
 const first=await service.prepareRemuxBatch({...folders,target:'mp4'});assert.equal(first.items[0].status,'ready',first.items[0].reason);const priorGeneration=service.generation,priorPlan=service.plan;
 const second=await service.prepareRemuxBatch({...folders,target:'mov'});assert.equal(second.items[0].status,'ready',second.items[0].reason);assert(priorGeneration.closed);assert.notEqual(first.planId,second.planId);assert.notEqual(service.plan,priorPlan);
 assert.equal(service.plan.entries.get(second.items[0].id).operationPlan.contract.target,'mov');const currentGeneration=service.generation;assert.equal(currentGeneration.runCalls,0);
 const current=service.snapshot();await assert.rejects(service.startBatch({planId:first.planId,fileIds:[first.items[0].id]}));assert.equal(service.snapshot().phase,current.phase);assert.equal(service.plan.id,second.planId);assert.equal(service.generation,currentGeneration);assert.equal(currentGeneration.runCalls,0);assert.equal(service.snapshot().items[0].status,'ready');
 await service.cancelCurrent();assert.equal(service.plan,null);const third=await service.prepareRemuxBatch({...folders,target:'mov'});assert.equal(third.items[0].status,'ready',third.items[0].reason);assert.notEqual(third.planId,second.planId);assert(h.generations.length>=4);
 assert.equal(service.plan.entries.get(third.items[0].id).operationPlan.contract.target,'mov');
 await service.startBatch({planId:third.planId,fileIds:[third.items[0].id]});await service.taskPromise;assert.equal(service.snapshot().items[0].status,'failed');assert.match(service.snapshot().items[0].reason,/must remain current/);assert.equal(service.generation.snapshot().phase,null);assert.equal(service.generation.runCalls,0);
});

async function preparedLongMp4(t,target='mp4'){
 const {service,root,h}=await setup(t,{matroska:true,mov:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.format.duration='180';probe.streams.forEach((s,i)=>{s.id=String(i+1);s.duration='180';if(target==='mov')s.tags={language:'und',handler_name:i?'SoundHandler':'VideoHandler'};});
 const file=path.join(input,'source.mp4');await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(file)).size);
 service.inspect=async()=>({probe:structuredClone(probe),duration:180,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');const ready=await service.prepareRemuxBatch({inputFolderId:i.id,outputFolderId:o.id,target});assert.equal(ready.items[0].status,'ready',ready.items[0].reason);return {service,h,request:{planId:ready.planId,fileIds:[ready.items[0].id]}};
}
test('real long MP4 Prepare binds genuine selected costs only after valid Start and holds through awaited execution',async t=>{
 const {service,request}=await preparedLongMp4(t);const oldPlan=service.plan,oldTask=service.taskPromise,oldItems=structuredClone(service.state.items),oldDraft=service.plan.draft.snapshot();
 await assert.rejects(service.startBatch({...request,planId:'stale'}));assert.equal(service.plan,oldPlan);assert.equal(service.taskPromise,oldTask);assert.equal(service.executionBinding,null);assert.deepEqual(service.state.items,oldItems);assert.deepEqual(service.plan.draft.snapshot(),oldDraft);
 const entry=service.plan.entries.get(request.fileIds[0]),stamp=entry.qualificationBindings;entry.qualificationBindings={...stamp,sourceProbeFingerprint:'wrong'};
 // Current binding is rederived from live immutable inputs, not trusted saved probe text.
 const identity=entry.fingerprint;entry.fingerprint={...identity,size:String(Number(identity.size)+1)};
 await assert.rejects(service.startBatch(request),/must remain current/);assert.equal(service.executionBinding,null);assert.equal(service.plan,oldPlan);assert.deepEqual(service.state.items,oldItems);entry.fingerprint=identity;entry.qualificationBindings=stamp;
 const {EncoderService}=require('../src/encoder-service.cjs');const original=EncoderService.prototype.execute;let release,entered;const began=new Promise(r=>entered=r);
 EncoderService.prototype.execute=async function(){assert(this.executionBinding?.kind==='remux-isobmff');assert(this.executionBinding.selected.executionBudgetMs>600000);assert(this.executionBinding.selected.budget.timeoutMs>120000);entered();await new Promise(r=>release=r);assert(this.executionBinding.requireCurrent()===this.executionBinding.selected);this.state.phase='completed';};
 try{await service.startBatch(request);await began;assert(service.generation.lastControl);assert.equal(service.operationDeadlineMs,600000);assert.equal(service.operationEvidenceBudget,require('../src/operation-controls.cjs').EVIDENCE_BUDGET);release();await service.taskPromise;assert.equal(service.executionBinding,null);assert.equal(service.generation.snapshot().phase,null);}finally{EncoderService.prototype.execute=original;release?.();}
});
test('remux begin and running-listener failures settle authority and require fresh Prepare',async t=>{
 for(const mode of ['begin','listener']){const {service,request}=await preparedLongMp4(t);const generation=service.generation;if(mode==='begin')generation.begin=()=>{throw Error('begin-refusal');};else{const emit=service.emitState.bind(service);service.emitState=()=>{if(service.state.phase==='running')throw Error('running-listener');return emit();};}
 await assert.rejects(service.startBatch(request),/Prepare a fresh batch/);assert.equal(service.plan,null);assert.equal(service.executionBinding,null);assert.equal(service.state.phase,'failed');assert(generation.closed);assert.equal(generation.runCalls,0);await assert.rejects(service.startBatch(request));}
});
test('real long MKV Prepare binds genuine selected costs only after valid Start and holds through awaited execution',async t=>{
 const {service,request}=await preparedLongMp4(t,'matroska');const oldPlan=service.plan,oldTask=service.taskPromise,oldItems=structuredClone(service.state.items),oldDraft=service.plan.draft.snapshot();
 await assert.rejects(service.startBatch({...request,planId:'stale'}));assert.equal(service.plan,oldPlan);assert.equal(service.taskPromise,oldTask);assert.equal(service.executionBinding,null);assert.deepEqual(service.state.items,oldItems);assert.deepEqual(service.plan.draft.snapshot(),oldDraft);
 const entry=service.plan.entries.get(request.fileIds[0]),stamp=entry.qualificationBindings;entry.qualificationBindings={...stamp,sourceProbeFingerprint:'wrong'};
 // Current binding is rederived from live immutable inputs, not trusted saved probe text.
 const identity=entry.fingerprint;entry.fingerprint={...identity,size:String(Number(identity.size)+1)};
 await assert.rejects(service.startBatch(request),/must remain current/);assert.equal(service.executionBinding,null);assert.equal(service.plan,oldPlan);assert.deepEqual(service.state.items,oldItems);entry.fingerprint=identity;entry.qualificationBindings=stamp;
 const {EncoderService}=require('../src/encoder-service.cjs');const original=EncoderService.prototype.execute;let release,entered;const began=new Promise(r=>entered=r);
 EncoderService.prototype.execute=async function(){assert.equal(this.executionBinding.selected.qualification.target,'matroska');assert(this.executionBinding?.kind==='remux-isobmff');assert(this.executionBinding.selected.executionBudgetMs>600000);assert(this.executionBinding.selected.budget.timeoutMs>120000);entered();await new Promise(r=>release=r);assert(this.executionBinding.requireCurrent()===this.executionBinding.selected);this.state.phase='completed';};
 try{await service.startBatch(request);await began;assert(service.generation.lastControl);assert.equal(service.operationDeadlineMs,600000);assert.equal(service.operationEvidenceBudget,require('../src/operation-controls.cjs').EVIDENCE_BUDGET);release();await service.taskPromise;assert.equal(service.executionBinding,null);assert.equal(service.generation.snapshot().phase,null);}finally{EncoderService.prototype.execute=original;release?.();}
});
test('MKV begin and running-listener failures settle authority and require fresh Prepare',async t=>{
 for(const mode of ['begin','listener']){const {service,request}=await preparedLongMp4(t,'matroska');const generation=service.generation;if(mode==='begin')generation.begin=()=>{throw Error('begin-refusal');};else{const emit=service.emitState.bind(service);service.emitState=()=>{if(service.state.phase==='running')throw Error('running-listener');return emit();};}
 await assert.rejects(service.startBatch(request),/Prepare a fresh batch/);assert.equal(service.plan,null);assert.equal(service.executionBinding,null);assert.equal(service.state.phase,'failed');assert(generation.closed);assert.equal(generation.runCalls,0);await assert.rejects(service.startBatch(request));}
});
test('real long MOV Prepare binds genuine selected costs only after valid Start and holds through awaited execution',async t=>{
 const {service,request}=await preparedLongMp4(t,'mov');const oldPlan=service.plan,oldTask=service.taskPromise,oldItems=structuredClone(service.state.items),oldDraft=service.plan.draft.snapshot();
 await assert.rejects(service.startBatch({...request,planId:'stale'}));assert.equal(service.plan,oldPlan);assert.equal(service.taskPromise,oldTask);assert.equal(service.executionBinding,null);assert.deepEqual(service.state.items,oldItems);assert.deepEqual(service.plan.draft.snapshot(),oldDraft);
 const entry=service.plan.entries.get(request.fileIds[0]),stamp=entry.qualificationBindings;entry.qualificationBindings={...stamp,sourceProbeFingerprint:'wrong'};
 // Current binding is rederived from live immutable inputs, not trusted saved probe text.
 const identity=entry.fingerprint;entry.fingerprint={...identity,size:String(Number(identity.size)+1)};
 await assert.rejects(service.startBatch(request),/must remain current/);assert.equal(service.executionBinding,null);assert.equal(service.plan,oldPlan);assert.deepEqual(service.state.items,oldItems);entry.fingerprint=identity;entry.qualificationBindings=stamp;
 const {EncoderService}=require('../src/encoder-service.cjs');const original=EncoderService.prototype.execute;let release,entered;const began=new Promise(r=>entered=r);
 EncoderService.prototype.execute=async function(){assert.equal(this.executionBinding.selected.qualification.target,'mov');assert(this.executionBinding?.kind==='remux-isobmff');assert(this.executionBinding.selected.executionBudgetMs>600000);assert(this.executionBinding.selected.budget.timeoutMs>120000);entered();await new Promise(r=>release=r);assert(this.executionBinding.requireCurrent()===this.executionBinding.selected);this.state.phase='completed';};
 try{await service.startBatch(request);await began;assert(service.generation.lastControl);assert.equal(service.operationDeadlineMs,600000);assert.equal(service.operationEvidenceBudget,require('../src/operation-controls.cjs').EVIDENCE_BUDGET);release();await service.taskPromise;assert.equal(service.executionBinding,null);assert.equal(service.generation.snapshot().phase,null);}finally{EncoderService.prototype.execute=original;release?.();}
});
test('MOV begin and running-listener failures settle authority and require fresh Prepare',async t=>{
 for(const mode of ['begin','listener']){const {service,request}=await preparedLongMp4(t,'mov');const generation=service.generation;if(mode==='begin')generation.begin=()=>{throw Error('begin-refusal');};else{const emit=service.emitState.bind(service);service.emitState=()=>{if(service.state.phase==='running')throw Error('running-listener');return emit();};}
 await assert.rejects(service.startBatch(request),/Prepare a fresh batch/);assert.equal(service.plan,null);assert.equal(service.executionBinding,null);assert.equal(service.state.phase,'failed');assert(generation.closed);assert.equal(generation.runCalls,0);await assert.rejects(service.startBatch(request));}
});

test('candidate notice names qualified targets without broad release claims',async t=>{
 const {service}=await setup(t);const notice=service.snapshot().developerProduct.notice;
 assert.match(notice,/qualified MP4, MOV and Matroska Full stream-copy routes/);
 assert.match(notice,/Unsupported requests do not fall back/);
 assert.match(notice,/Fresh explicit Prepare is required after settled Cancel/);
 assert.match(notice,/Native evidence is artifact\/route-specific/);
 assert.match(notice,/exact-host internal candidate is not a portable release/);
 assert.doesNotMatch(notice,/narrow MP4 full stream copy/);
});

for(const rates of [['60/1','60/1'],['40/1','60/1']])test('actual unified MOV v2 Prepare binds main-owned envelope '+rates.join('/'),async t=>{
 const {service,root}=await setup(t,{mov:true,movV2:true});const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
 const probe=sourceProbe();probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';probe.streams.forEach((s,i)=>{s.id=String(i+1);s.tags={language:'und',handler_name:i?'SoundHandler':'VideoHandler'};});probe.streams[0].avg_frame_rate=rates[0];probe.streams[0].r_frame_rate=rates[1];
 const file=path.join(input,'source.mp4');await fsp.writeFile(file,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(file)).size);service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');const ready=await service.prepareRemuxBatch({inputFolderId:i.id,outputFolderId:o.id,target:'mov'});assert.equal(ready.items[0].status,'ready',ready.items[0].reason);
 const entry=service.plan.entries.get(ready.items[0].id);assert.equal(entry.operationPlan.contract.target,'mov');assert.equal(service.generation.runCalls,0);
 const {EncoderService}=require('../src/encoder-service.cjs');const originalExecute=EncoderService.prototype.execute;let routed=false;
 EncoderService.prototype.execute=async function(){assert.equal(require('../linux-blue/product-linux-remux-service.cjs').remuxPolicies(this.configuration.remux).find(p=>p.target==='mov').sourceEnvelope,'h264-aac-lc-48k-stereo-v2');assert.equal(this.executionBinding.selected.qualification.target,'mov');assert.equal(this.executionBinding.requireCurrent(),this.executionBinding.selected);routed=true;this.state.phase='completed';};
 try{await service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]});await service.taskPromise;assert(routed);assert.equal(service.generation.runCalls,0);}finally{EncoderService.prototype.execute=originalExecute;}
 await service.cancelCurrent();assert.equal(service.plan,null);await assert.rejects(service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]}));assert.equal(service.generation,null);
});

test('ordinary H264 uses shared native preset/CRF bounds without expanding recipes or other profiles',()=>{
 const {fixedSettings}=harness(),a={profileId:'h264-cpu',preset:'slower',quality:24};
 for(const v of [a,{...a,preset:'ultrafast',quality:0},{...a,preset:'veryslow',quality:51}])assert.equal(fixedSettings(v),'ordinary');
 for(const v of [{...a,quality:-1},{...a,quality:52},{...a,quality:24.5},{...a,quality:'24'},{...a,preset:'p7'},{...a,recipeId:'archive'},{...a,anything:true}])assert.throws(()=>fixedSettings(v));
 assert.equal(fixedSettings({profileId:'h265-cpu',preset:'fast',quality:27}),'h265');
 assert.equal(fixedSettings({profileId:'av1-cpu',preset:'6',quality:32}),'av1-ordinary');
 assert.equal(fixedSettings({profileId:'av1-cpu',preset:'7',quality:32}),'av1-ordinary');
});
for(const codec of ['h264','av1'])test(`ordinary ${codec} tested default, persistence, two-file reprepare and Start remain main-owned`,async t=>{
 const {h,service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');
 await fsp.mkdir(input);await fsp.mkdir(output);for(const name of ['first.mkv','second.mkv'])await fsp.writeFile(path.join(input,name),'inert fixture');
 const probe=sourceProbe();
 service.inspect=async()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8,10]})),versions:{}});
 service.storageEligibility={check:async()=>({eligible:true})};
 const initial=codec==='h264'?{profileId:'h264-cpu',preset:'slower',quality:24}:{profileId:'av1-cpu',preset:'6',quality:32}, changed=codec==='h264'?{profileId:'h264-cpu',preset:'fast',quality:19}:{profileId:'av1-cpu',preset:'7',quality:33};
 const storedValues=v=>({preset:v.preset,quality:v.quality});
 const prefs=await service.getPreferences();assert.deepEqual(prefs.settingsByProfile[initial.profileId],storedValues(initial));
 const caps=await service.getCapabilities(), h264=caps.profiles.find(p=>p.id===initial.profileId),av1=caps.profiles.find(p=>p.id==='av1-cpu'),h265=caps.profiles.find(p=>p.id==='h265-cpu');
 assert.equal(h264.candidateFixedSettings,false);assert.deepEqual(h264.supportedBitDepths,[8]);assert.equal(h264.defaultPreset,initial.preset);assert(h264.presets.includes(changed.preset));assert.equal(h264.quality.min,codec==='h264'?0:1);assert.equal(h264.quality.max,codec==='h264'?51:63);
 assert.deepEqual(av1.presets,Array.from({length:10},(_,i)=>String(i)));assert.equal(av1.candidateFixedSettings,false);assert.equal(av1.quality.default,32);assert.equal(h265.defaultPreset,'slow');assert.equal(h265.candidateFixedSettings,false);assert.deepEqual(caps.recipes,[]);
 assert.deepEqual(service.getRecipe(changed).testedDefault.settings,initial);
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
 const first=await service.prepareBatch({inputFolderId:i.id,outputFolderId:o.id,settings:initial});assert.equal(first.items.length,2);for(const item of first.items)assert.equal(item.status,'ready',item.reason);
 const req=(snap)=>({planId:snap.planId,fileIds:snap.items.map(i=>i.id)});
 const stored=await service.saveSettings(changed);assert.deepEqual(stored.settingsByProfile[initial.profileId],storedValues(changed));
 const stale=service.snapshot();assert.equal(stale.encodingSettingsStale,true);await assert.rejects(service.startBatch(req(first)));await assert.rejects(service.startBatch(req(stale)));
 const edit={planId:stale.planId,draftId:stale.operationDraft.id,revision:stale.operationDraft.revision,settings:changed};
 await assert.rejects(service.reprepareEncodingSettings({...edit,settings:{profileId:'h265-cpu',preset:'fast',quality:19}}),/fresh explicit Prepare/);
 const ready=await service.reprepareEncodingSettings(edit);assert.notEqual(ready.planId,stale.planId);assert.deepEqual(ready.settings,changed);for(const item of ready.items)assert.equal(item.status,'ready',item.reason);
 const plan=service.plan;
 for(const entry of plan.entries.values()){const a=entry.preparedArgs;assert.equal(a[a.indexOf('-c:v:0')+1],codec==='av1'?'libsvtav1':'libx264');assert.equal(a[a.indexOf('-preset:v:0')+1],changed.preset);assert.equal(a[a.indexOf('-crf:v:0')+1],String(changed.quality));}
 plan.settings={...changed,quality:20};await assert.rejects(service.startBatch(req(ready)),/settings changed after preparation/);plan.settings={...changed};
 const e=plan.entries.get(ready.items[0].id),argv=e.preparedArgs;e.preparedArgs=Object.freeze([...argv]);await assert.rejects(service.startBatch(req(ready)),/binding is stale/);e.preparedArgs=argv;
 assert.equal(h.generations.reduce((n,g)=>n+g.runCalls,0),0);
 let selection;const gen=service.generation;
 service.execute=async ids=>{selection=[...ids];gen.settle();};
 const started=await service.startBatch(req(ready));await service.taskPromise;
 assert.equal(started.phase,'running');assert.deepEqual(selection,req(ready).fileIds);assert.equal(h.generations.reduce((n,g)=>n+g.runCalls,0),0);
 const reopened=await h.createUnifiedService({runtimeRoot:path.join(root,'runtime'),stateDir:path.join(root,'state')});
 try{
  const restored=await reopened.getPreferences();assert.deepEqual(restored.settingsByProfile[initial.profileId],storedValues(changed));
  const reset=await reopened.resetProfile({profileId:initial.profileId});assert.deepEqual(reset.settingsByProfile[initial.profileId],storedValues(initial));
 }finally{await reopened.closeOperationResources();await reopened.closeDiagnostics();}
});
test('unified AV1 native bounds do not relax legacy fixed admission or named recipes',()=>{
 const {fixedSettings}=harness(),base={profileId:'av1-cpu',preset:'6',quality:32};
 for(const preset of Array.from({length:10},(_,i)=>String(i)))for(const quality of [1,32,63])assert.equal(fixedSettings({...base,preset,quality}),'av1-ordinary');
 for(const v of [{...base,quality:0},{...base,quality:64},{...base,quality:1.5},{...base,quality:'32'},{...base,preset:'10'},{...base,preset:6},{...base,preset:'p7'},{...base,recipeId:'archive'},{...base,extra:true},{...base,profileId:'av1-nvenc'}])assert.throws(()=>fixedSettings(v));
 const legacy=require('../linux-blue/av1-cpu-policy.cjs');assert.deepEqual(legacy.SETTINGS,base);assert.throws(()=>legacy.admit({settings:{...base,preset:'7'}}));
});
test('AV1 awaited preparation rejects changed settings and fresh Prepare recovers without execution',async t=>{
 const {h,service,root}=await setup(t);const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);await fsp.writeFile(path.join(input,'fixture.mkv'),'inert fixture');
 const probe=sourceProbe(),inspection=()=>({probe:structuredClone(probe),color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
 let entered,release;const waiting=new Promise(r=>entered=r);service.inspect=async()=>{entered();await new Promise(r=>release=r);return inspection();};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');const request={inputFolderId:i.id,outputFolderId:o.id,settings:{profileId:'av1-cpu',preset:'7',quality:33}};
 const pending=service.prepareBatch(request);await waiting;service.plan.settings={...request.settings,quality:34};release();const rejected=await pending;assert.equal(rejected.items[0].status,'unsupported');assert.equal(service.plan.entries.size,0);
 service.inspect=async()=>inspection();const ready=await service.prepareBatch(request);assert.equal(ready.items[0].status,'ready',ready.items[0].reason);
 const plan=service.plan,item=service.state.items[0],entry=plan.entries.get(item.id),start={planId:ready.planId,fileIds:[item.id]};
 const before={phase:service.state.phase,task:service.taskPromise,guard:typeof service.ordinaryJobGuard,generation:service.generation,draft:service.state.operationDraft,binding:service.executionBinding};
 for(const [object,key,replace] of [[entry,'operationPlan',()=>({...entry.operationPlan})],[entry,'preparedArgs',()=>[...entry.preparedArgs]],[item,'operationRequest',()=>({...item.operationRequest})],[service,'generation',()=>Object.create(service.generation)],[plan,'id',()=>plan.id+'-stale']]){
  const old=object[key];object[key]=replace();await assert.rejects(service.startBatch(start));object[key]=old;
  assert.equal(service.state.phase,before.phase);assert.equal(service.taskPromise,before.task);assert.equal(typeof service.ordinaryJobGuard,before.guard);assert.equal(service.state.operationDraft,before.draft);assert.equal(service.executionBinding,before.binding);
 }
 assert.equal(service.generation,before.generation);assert.equal(h.generations.reduce((n,g)=>n+g.runCalls,0),0);
});

for(const scenario of ['clock-only','unsupported-geometry','clock-and-container','clock-qualified']){
  test('measured Linux 1080p resize diagnostics: '+scenario,async t=>{
    const {service,h,root}=await setup(t,{genuineSelector:true});
    const input=path.join(root,'input'),output=path.join(root,'output');await fsp.mkdir(input);await fsp.mkdir(output);
    const file=path.join(input,'source.mov');await fsp.writeFile(file,'Inert exact-clock inspection shape; not media.');
    const probe=measuredProbe((await fsp.stat(file)).size);
    const video=probe.streams[0],audio=probe.streams[1];
    const width=scenario==='unsupported-geometry'?2048:1920,height=scenario==='unsupported-geometry'?1152:1080;
    const denominator=scenario==='clock-qualified'?15360:30000;
    Object.assign(video,{width,height,time_base:'1/'+denominator,duration_ts:125*denominator,duration:'125'});
    Object.assign(audio,{duration_ts:6000000,duration:'125'});
    probe.format.duration='125';
    if(scenario==='clock-and-container')probe.format.tags.major_brand='isom';
    // The real inspection path supplies normalized typed evidence, not a
    // user-supplied projection. Keep the original observation unchanged.
    const upstream=require('../src/inspection.cjs').normalizeProbe(probe);
    const snapshot=structuredClone(upstream);
    service.inspect=async()=>({probe:upstream,color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:125,summary:{selectedVideoIndex:0,codec:'h264',width,height,bitDepth:8}});
    service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});service.storageEligibility={check:async()=>({eligible:true})};
    const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
    const before=await service.prepareBatch({inputFolderId:i.id,outputFolderId:o.id,settings:{profileId:'h265-cpu',preset:'slow',quality:25}});
    const result=await service.updateFileOperations({planId:before.planId,draftId:before.operationDraft.id,revision:before.operationDraft.revision,fileIds:[before.items[0].id],
      overrides:{resolution:'720',range:{startUs:91000000,endUs:123000000},audioPolicy:'precision-flac'}});
    const item=result.items[0],entry=service.plan.entries.get(item.id);
    assert.deepEqual(upstream,snapshot);
    if(scenario==='clock-qualified'){
      assert.equal(item.status,'ready',item.reason);assert.equal(item.reason,'');assert(entry);
      assert.equal(entry.operationPlan.compatibilityPath,false);
      const selected=service.operationQualifications.requireCurrent(entry.qualificationSelection,entry.qualificationBindings);
      assert.equal(selected.sourcePolicy.id,'cfr-sdr-range-resize-flac-v1');
      assert.equal(selected.proportional,true);
    }else{
      assert.equal(item.status,'unsupported');assert.equal(item.reasonCode,'OPERATION_RESIZE_UNQUALIFIED');assert.equal(entry,undefined);
      await assert.rejects(service.startBatch({planId:result.planId,fileIds:[item.id]}));
      const prefix='This resize has no measured qualification, so no plan was created. ';
      assert.equal(item.reason,prefix+(scenario==='clock-only'
        ? 'This measured 1080p-to-720p precision-FLAC resize requires a 1/15360 video time base; this file reports 1/30000.'
        : 'Only the fixed progressive 8-bit H264 High geometry belongs to this family.'));
    }
    assert(h.generations.every(g=>g.runCalls===0));assert.deepEqual(await fsp.readdir(output),[]);
  });
}
