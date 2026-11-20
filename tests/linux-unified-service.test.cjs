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

for(const [count,reasonCode]of [[2,'REMUX_MULTI_AUDIO_NOT_QUALIFIED'],[3,'REMUX_AUDIO_TRACK_COUNT_UNSUPPORTED']]){
 test('Dormant Linux plain MP4 '+count+'-AAC Prepare refuses before emitting any omission action',async t=>{
  const {service,h,root}=await setup(t);const i=path.join(root,'input'),o=path.join(root,'output');await fsp.mkdir(i);await fsp.mkdir(o);
  const src=path.join(i,'multi.mp4'),probe=sourceProbe();
  for(let index=2;index<=count;index++){
    const audio=structuredClone(probe.streams[1]);audio.index=index;audio.disposition.default=0;
    audio.tags={...audio.tags,language:index===2?'ara':'deu'};
    probe.streams.push(audio);
  }
  probe.format.nb_streams=count+1;probe.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';
  probe.format.tags.major_brand='isom';probe.streams.forEach((s,i)=>s.id=String(i+1));
  await fsp.writeFile(src,require('./helpers/mov-fixture.cjs').playbackFixture(probe));probe.format.size=String((await fsp.stat(src)).size);const before=structuredClone(probe);
  service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};
  const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
  const outward=[];service.on('update',state=>{for(const item of state.items)if(item.remux)
    outward.push({status:item.status,code:item.reasonCode,visible:item.remux.omissionCandidates.map(x=>x.streamIndex),
      registered:[...service.plan.remuxCandidates.values()].filter(x=>x.fileId===item.id).map(x=>x.streamIndex)});});
  const returned=await service.prepareRemuxBatch({inputFolderId:input.id,outputFolderId:output.id,target:'mp4'});await service.taskPromise;
  const snap=service.snapshot(),item=snap.items[0];
  t.diagnostic('outward state: '+JSON.stringify(outward));
  assert(outward.length>0);for(const update of outward){assert.deepEqual(update.visible,[]);assert.deepEqual(update.registered,[]);}
  for(const p of [returned,snap]){assert.equal(p.items.length,1);assert.deepEqual(p.items[0].remux.omissionCandidates,[]);assert.equal(p.items[0].reasonCode,reasonCode);}
  assert.equal(item.status,'unsupported');assert.match(item.reason,count===2?/two AAC audio tracks/i:/3 AAC audio tracks/i);
  assert.match(item.reason,/requires one 48 kHz stereo AAC track/i);assert.match(item.reason,/no copy was started and no track was omitted/i);assert(!item.reason.includes('assert('));
  assert.deepEqual(item.remux.streams.map(s=>[s.streamIndex,s.action]),Array.from({length:count+1},(_,i)=>[i,'preserve-copy']));
  assert.deepEqual(item.remux.omissionDecisionIds,[]);
  assert.equal([...service.plan.remuxCandidates.values()].filter(c=>c.fileId===item.id).length,0);
  assert.equal(service.plan.remuxGrants.size,0);assert.equal(service.plan?.entries?.has(item.id)??false,false);
  assert.equal(service.generation.observeCalls,0);assert(h.generations.every(g=>g.runCalls===0));assert.deepEqual(probe,before);assert.deepEqual(await fsp.readdir(o),[]);
 });
}

test('new dormant count refusal is not authority over MOV, non-AAC or another video codec',()=>{
  const {assessRemux}=require('../src/remux-contract.cjs'),{admit}=require('../linux-blue/product-linux-remux-service.cjs');
  for(const [target,change]of [
    ['mov',()=>{}],['mp4',x=>{x.format.tags.major_brand='qt  ';}],['mp4',x=>{x.format.tags.major_brand=123;}],
    ...['qt;qt','3gp4','unknown;unknown','isom;isom',undefined].map(brand=>['mp4',x=>{if(brand===undefined)delete x.format.tags.major_brand;else x.format.tags.major_brand=brand;}]),
    ['mp4',x=>{x.streams[3].codec_name='ac3';}],['mp4',x=>{x.streams[0].codec_name='hevc';}]
  ]){
    const probe=sourceProbe();
    probe.streams.push(...[2,3].map(index=>({...structuredClone(probe.streams[1]),index,disposition:{default:0}})));
    Object.assign(probe.format,{format_name:'mov,mp4,m4a,3gp,3g2,mj2',nb_streams:4,size:'10000',tags:{major_brand:'isom'}});
    change(probe);
    const assessment=assessRemux({probe,sourceFingerprint:'a'.repeat(64),
      request:{fileId:'distinct-family',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]}});
    assert.throws(()=>admit(assessment,'/owned/example.mp4'),e=>e.code!=='REMUX_AUDIO_TRACK_COUNT_UNSUPPORTED');
  }
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
   assert(entry.preparedArgs.includes('copy'));assert.deepEqual(item.remux.omissionCandidates.map(x=>x.streamIndex),[1]);return;
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

async function mp3Folders(t){
 const {service,root,h}=await setup(t,{matroska:true,mov:true});const input=path.join(root,'input'),output=path.join(root,'output');
 await fsp.mkdir(input);await fsp.mkdir(output);const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
 const frame=Buffer.alloc(384);Buffer.from([255,251,148,0]).copy(frame);
 const bytes=Buffer.concat(Array.from({length:8},()=>frame)),name='song.MP3',file=path.join(input,name);
 await fsp.writeFile(file,bytes);
 const raw={streams:[{index:0,codec_type:'audio',codec_name:'mp3',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:'1/14112000',start_pts:0,start_time:'0.000000',disposition:{default:0}}],
   format:{format_name:'mp3',size:String(bytes.length),nb_streams:1,nb_programs:0,nb_stream_groups:0,start_time:'0.000000'},programs:[],stream_groups:[],chapters:[]};
 const args={inputFolderId:i.id,outputFolderId:o.id,target:'mp4'},updates=[],calls=[];
 service.on('update',u=>updates.push(u));service.run=async(...a)=>{calls.push(a);return {stdout:JSON.stringify(raw),stderr:''};};
 return {service,h,input,output,file,name,bytes,raw,args,updates,calls};
}
// Normal Linux acquisition needs Linux descriptor semantics. Pure metadata tests remain portable.
const linuxMp3 = (name, body) => test(name, {skip: process.platform !== 'linux' && 'Linux MP3 product only'}, body);
linuxMp3('normal remux discovers one upper-case MP3 only as a read-only diagnostic; all outward selections, output names and decisions stay empty',async t=>{
 const {service,output,file,bytes,args,updates,calls}=await mp3Folders(t);
 const s=await service.prepareRemuxBatch(args);assert.equal(s.phase,'ready',s.error);assert.equal(s.items.length,1);const item=s.items[0];
 assert.equal(item.reasonCode,'REMUX_MP3_QUALIFICATION_REQUIRED',item.reason);assert.match(item.reason,/48,?000 Hz.*stereo/);assert.match(item.reason,/Apple/);assert.match(item.reason,/AAC/);assert.equal(item.status,'unsupported');
 for(const u of updates)for(const x of u.items){assert.ok(['pending','unsupported'].includes(x.status));assert.equal(x.outputName,'');assert.equal(x.reencodeAuthorized,false);assert.equal(x.outputAccess,undefined);assert.equal(x.remuxDecision,undefined);}
 assert.equal(service.plan.entries.size,0);assert.equal(service.plan.remuxCandidates.size,0);assert.equal(service.plan.remuxGrants.size,0);assert.equal(service.plan.generated.size,0);
 assert.equal(calls.length,1);const [exe,a,o]=calls[0];assert.equal(exe,service.ffprobe);assert.equal(a.at(-1),file);assert.ok(!a.includes('-show_packets')&&!a.includes('-show_frames'));assert.equal(a[a.indexOf('-format_whitelist')+1],'mp3');assert.equal(a[a.indexOf('-protocol_whitelist')+1],'file');assert.ok(o.timeoutMs<=8000&&o.stdoutLimit<=131072&&o.stderrLimit<=65536);
 await assert.rejects(service.startBatch({planId:s.planId,fileIds:[item.id]}));assert.equal(calls.length,1);assert.deepEqual(await fsp.readdir(output),[]);assert.deepEqual(await fsp.readFile(file),bytes);
});
linuxMp3('MP3-only fallback does not change Matroska target or multi-song folder into a token/first-file guess',async t=>{
 const {service,input,args,calls}=await mp3Folders(t);
 const known=await service.prepareRemuxBatch({...args,target:'matroska'});assert.equal(known.phase,'failed');assert.match(known.error,/No supported top-level video/);
 await fsp.writeFile(path.join(input,'b.mp3'),'second');const more=await service.prepareRemuxBatch(args);assert.equal(more.phase,'failed');assert.match(more.error,/one MP3/i);assert.equal(more.planId,null);assert.equal(more.items.length,0);assert.equal(calls.length,0);
});
linuxMp3('ordinary 081 discovery takes precedence over an adjacent MP3, preserving old ready entry without any music probe',async t=>{
 const {service,input,args,calls}=await mp3Folders(t);const p=sourceProbe();p.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';p.streams.forEach((s,i)=>s.id=String(i+1));
 const selected=path.join(input,'source.mp4');await fsp.writeFile(selected,require('./helpers/mov-fixture.cjs').playbackFixture(p));p.format.size=String((await fsp.stat(selected)).size);
 service.inspect=async()=>({probe:structuredClone(p),duration:2,summary:{}});service.storageEligibility={check:async()=>({eligible:true})};
 const s=await service.prepareRemuxBatch(args);assert.equal(s.phase,'ready',s.error);assert.deepEqual(s.items.map(x=>x.name),['source.mp4']);assert.equal(s.items[0].status,'ready',s.items[0].reason);assert.equal(service.plan.entries.size,1);assert.equal(calls.length,0);
});
linuxMp3('renamed bytes, tagged source and untrusted probe diagnostics never become metadata or outputs',async t=>{
 const {service,file,bytes,args,calls}=await mp3Folders(t);
 for(const [data,code] of [[Buffer.from('not MP3 at all'),'MP3_FRAME_UNPROVED'],[Buffer.concat([Buffer.from('ID3secret-title'),bytes]),'MP3_ID3V2_UNSUPPORTED']]){
  await fsp.writeFile(file,data);const s=await service.prepareRemuxBatch(args);assert.equal(s.items[0]?.reasonCode,code,s.error);assert.doesNotMatch(s.items[0].reason,/secret-title/);assert.equal(s.items[0].outputName,'');}
 assert.equal(calls.length,0);
 await fsp.writeFile(file,bytes);service.run=async()=>({stdout:'{}',stderr:'secret-title '+file});const s=await service.prepareRemuxBatch(args);
 assert.equal(s.items[0]?.reasonCode,'REMUX_MP3_PROBE_UNAVAILABLE',s.error);assert.doesNotMatch(JSON.stringify(s.items),/secret-title|\/input\//);assert.equal(service.plan.entries.size,0);
});
linuxMp3('MP3 read-only Prepare detects ordinary same-bytes source replacement while reader runs',async t=>{
 const {service,file,bytes,raw,args}=await mp3Folders(t);service.run=async()=>{await fsp.rename(file,file+'.old');await fsp.writeFile(file,bytes);return {stdout:JSON.stringify(raw),stderr:''};};
 const s=await service.prepareRemuxBatch(args);assert.equal(s.items[0]?.reasonCode,'INPUT_CHANGED',s.error);assert.equal(s.items[0].sourceIdentityDiagnostic,undefined);assert.equal(s.items[0].outputName,'');assert.equal(service.plan.entries.size,0);
});
linuxMp3('cancel joins the in-flight metadata read and requires a fresh explicit MP3 Prepare, with no writer',async t=>{
 const {service,raw,args,updates}=await mp3Folders(t);let entered,release;const pending=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
 service.run=async()=>{entered();await resume;return {stdout:JSON.stringify(raw),stderr:''};};
 const prep=service.prepareRemuxBatch(args);await Promise.race([pending,prep.then(()=>{throw Error('MP3 observer was not reached');})]);
 const closing=service.cancelCurrent();release();await prep.catch(()=>{});await closing;assert.equal(service.plan,null);assert.equal(service.generation,null);
 service.run=async()=>({stdout:JSON.stringify(raw),stderr:''});const next=await service.prepareRemuxBatch(args);assert.equal(next.items[0].reasonCode,'REMUX_MP3_QUALIFICATION_REQUIRED');
 assert(updates.every(x=>x.items.every(y=>!['ready','success'].includes(y.status))));assert.equal(service.plan.entries.size,0);
});
linuxMp3('MP3 draft target edit on reserved audio stays diagnostic-only without a repeat probe or a projected output',async t=>{
 const {service,args,calls,updates}=await mp3Folders(t);
 const before=await service.prepareRemuxBatch(args);const d=before.operationDraft;
 const after=await service.updateFileOperations({planId:before.planId,draftId:d.id,revision:d.revision,fileIds:[before.items[0].id],overrides:{target:'matroska'}});
 assert.equal(after.phase,'ready',after.error);assert.notEqual(after.planId,before.planId);assert.equal(after.items[0].reasonCode,'REMUX_MP3_TARGET_UNQUALIFIED',after.items[0].reason);
 assert.equal(calls.length,1);assert.equal(service.plan.entries.size,0);assert(updates.every(s=>s.items.every(i=>i.outputName===''&&!['ready','conflict'].includes(i.status))));
 await assert.rejects(service.startBatch({planId:before.planId,fileIds:[before.items[0].id]}));
});
linuxMp3('an unresolved name on a symlink does not open the target, expose its path or create a media authority',async t=>{
 const {service,file,args,calls}=await mp3Folders(t);await fsp.rename(file,file+'.original');await fsp.symlink(file+'.original',file);
 const s=await service.prepareRemuxBatch(args);assert.equal(s.items[0]?.reasonCode,'UNSAFE_SOURCE',s.error);assert.doesNotMatch(s.items[0].reason,/\/|original/);
 assert.equal(calls.length,0);assert.equal(service.plan.entries.size,0);
});

const LINUX_ANCILLARY_REASON='REMUX_ANCILLARY_NOT_QUALIFIED';
function q2mCaption(index=2,codec_name='mov_text'){
 return {index,id:String(index+1),codec_type:'subtitle',codec_name,codec_tag_string:'tx3g',
   time_base:'1/1000',start_pts:0,duration_ts:2000,tags:{language:index===2?'eng':'ara'},disposition:{default:0}};
}
function q2mProbe({captions=[],chapters=false,data=false,brand='isom',family='mov,mp4,m4a,3gp,3g2,mj2',unknown=false,origin=false}={}){
 const probe=sourceProbe();
 probe.streams.push(...captions.map(([index,codec])=>q2mCaption(index,codec)));
 if(data)probe.streams.push({index:probe.streams.length,codec_type:'data',codec_name:'bin_data',codec_tag_string:'text',
   time_base:'1/1000',start_pts:0,duration_ts:2000,disposition:{default:0}});
 probe.streams.forEach((s,i)=>{s.id=String(i+1);s.duration_ts=2000;});
 if(chapters)probe.chapters=[{id:0,time_base:'1/1000',start:'0',end:'1000',tags:{title:'First chapter'}},
   {id:1,time_base:'1/1000',start:'1000',end:'2000',tags:{title:'Second chapter'}}];
 Object.assign(probe.format,{format_name:family,nb_streams:probe.streams.length,
   tags:{major_brand:brand,...(origin?{FFMPEG_ENCODER_PROVENANCE:'1',FFMPEG_ENCODER_OUTPUT_ID:'f711706b-d720-4a74-9712-d10567c85655'}:{})}});
 if(unknown)probe.format.nb_streams++;
 return probe;
}
async function q2mSetup(t,probe,{collision=false,matroska=false,name='source.mp4'}={}){
 const access=[];
 const {OutputAccess}=require('../src/output-access.cjs');
 const outputAccess=new OutputAccess({openPath:async(...args)=>{access.push(args);return '';},
   showItemInFolder:(...args)=>{access.push(args);}});
 const issue=outputAccess.issue.bind(outputAccess);
 outputAccess.issue=(...args)=>{access.push(args);return issue(...args);};
 const {service,h,root}=await setup(t,{matroska,outputAccess});
 const i=path.join(root,'in'),o=path.join(root,'out'),file=path.join(i,name);
 await fsp.mkdir(i);await fsp.mkdir(o);
 await fsp.writeFile(file,'Inert Q2m inspected-metadata fixture, not media.');
 probe.format.size=String((await fsp.stat(file)).size);
 if(collision)await fsp.writeFile(path.join(o,'source_Remux-MP4.mp4'),'preexisting');
 service.inspect=async()=>({probe:structuredClone(probe),duration:2,summary:{}});
 service.storageEligibility={check:async()=>({eligible:true})};
 const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
 const updates=[];
 service.on('update',value=>updates.push({value,registered:[...service.plan?.remuxCandidates?.values()||[]].map(c=>c.id),
   grants:service.plan?.remuxGrants?.size||0,entries:service.plan?.entries?.size||0}));
 const prepare=()=>service.prepareRemuxBatch({inputFolderId:input.id,outputFolderId:output.id,target:'mp4'});
 return {service,h,updates,prepare,access,output:o,file};
}
function q2mShared(probe,target){
 return require('../src/remux-contract.cjs').assessRemux({probe,sourceFingerprint:'a'.repeat(64),
   request:{fileId:'fixture',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]}});
}
function q2mNoActions(state){
 const [item]=state.items;
 if(!item)return;
 assert.equal(item.outputAccess,undefined);
 assert.equal(item.verificationMethod,undefined);
 if(!item.remux)return;
 assert.deepEqual(item.remux.omissionCandidates,[]);
 assert.deepEqual(item.remux.omissionDecisionIds,[]);
 assert(item.remux.streams.every(s=>s.action==='blocked'));
}
for(const [name,probeInput] of [
 ['single native text subtitle',{captions:[[2,'mov_text']]}],
 ['two native text subtitles',{captions:[[2,'mov_text'],[3,'mov_text']]}],
 ['observed chapter ticks',{chapters:true}],
 ['observed chapters plus native text carrier',{chapters:true,data:true}],
 ['observed chapters plus subtitle',{chapters:true,captions:[[2,'mov_text']]}],
 ]){
 test('Linux Q2m first-visible refusal: '+name,async t=>{
   const probe=q2mProbe(probeInput),{service,h,updates,prepare,access,output}=await q2mSetup(t,probe);
   const prior=q2mShared(probe,'mp4').blockers;
   const returned=await prepare(), snap=service.snapshot(), item=snap.items[0];
   t.diagnostic('first visible actions: '+JSON.stringify(updates.filter(x=>x.value.items[0]?.remux).map(x=>[
     x.value.items[0].reasonCode,x.value.items[0].remux.omissionCandidates.map(c=>c.streamIndex),x.registered.length])));
   assert(updates.some(u=>u.value.items[0]?.remux));
   for(const u of updates){q2mNoActions(u.value);assert.deepEqual(u.registered,[]);assert.equal(u.grants,0);assert.equal(u.entries,0);}
   for(const state of [returned,snap]){
     q2mNoActions(state);
     assert.equal(state.items[0].status,'unsupported');
     assert.equal(state.items[0].remux.status,'blocked');
     assert.equal(state.items[0].reasonCode,prior[0]?.code||LINUX_ANCILLARY_REASON);
     const reasons=state.items[0].remux.blockers;
     assert.deepEqual(reasons.slice(0,prior.length),prior);
     const typed=reasons.find(x=>x.code===LINUX_ANCILLARY_REASON);
     assert(typed);
     assert.match(typed.message,/copy to MP4/i);
     assert.match(typed.message,/no copy was started.*nothing was omitted/i);
     if(probeInput.captions?.length)assert.match(typed.message,probeInput.captions.length===2?/subtitle tracks/i:/subtitle track\b/i);
     else assert.doesNotMatch(typed.message,/subtitle tracks?/i);
     if(probeInput.chapters)assert.match(typed.message,/chapters/i);
     else assert.doesNotMatch(typed.message,/chapters/i);
     if(prior.length)assert(state.items[0].reason.startsWith(prior[0].message));
   }
   await assert.rejects(service.startBatch({planId:snap.planId,fileIds:[item.id]}));
   assert.equal(service.plan.remuxCandidates.size,0);assert.equal(service.plan.remuxGrants.size,0);
   assert.equal(service.plan.entries.size,0);assert.equal(service.executionBinding,null);
   assert.equal(service.generation.observeCalls,0);assert(h.generations.every(g=>!g.runCalls));
   assert.deepEqual(access,[]);assert.deepEqual(await fsp.readdir(output),[]);
 });
}
test('Linux Q2m does not use source aliases or unknown relationships as typed authority',async t=>{
 for(const [label,input] of [
   ['wrong native format',{family:'matroska,webm'}],['QuickTime brand',{brand:'qt  '}],
   ['ambiguous repeated brand',{brand:'isom;isom'}],['unrelated brand',{brand:'3gp4'}],
   ['unknown relationships',{unknown:true}],
   ['inconsistent subtitle codec and sample entry',{captions:[[2,'subrip']]}],
 ]){
   const {service,h,prepare}=await q2mSetup(t,q2mProbe({captions:[[2,'mov_text']],...input}));
   const item=(await prepare()).items[0];
   assert.equal(item.status,'unsupported',label);
   assert.notEqual(item.reasonCode,LINUX_ANCILLARY_REASON,label);
   assert(!item.remux?.blockers.some(x=>x.code===LINUX_ANCILLARY_REASON),label);
   if(input.unknown)assert.equal(item.reasonCode,'REMUX_RELATIONSHIPS_UNKNOWN');
   if(input.captions)assert.equal(item.reasonCode,'REMUX_STREAM_UNSUPPORTED');
   assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls));
 }
});
test('Linux Q2m never classifies origin or destination collision as typed ancillary',async t=>{
 for(const [input,options,expected] of [
   [{origin:true},{},'generated'],[{}, {collision:true},'skipped'],[{}, {name:'source_H264-CPU.mp4'},'ambiguous'],
 ]){
   const {service,h,updates,prepare,output}=await q2mSetup(t,q2mProbe({captions:[[2,'mov_text']],...input}),options);
   const result=await prepare(),item=result.items[0];
   assert.equal(item.status,expected,item.reason);assert.equal(item.remux,undefined);
   for(const u of updates){assert.equal(u.value.items[0]?.remux,undefined);assert.deepEqual(u.registered,[]);}
   assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls));
   if(options.collision)assert.equal(await fsp.readFile(path.join(output,'source_Remux-MP4.mp4'),'utf8'),'preexisting');
 }
});
test('Linux Q2m reprepare cannot show a prior target or offers before the new assessment',async t=>{
 const probe=q2mProbe({captions:[[2,'mov_text']]}),{service,updates,prepare}=await q2mSetup(t,probe,{matroska:true});
 const first=await prepare(),start=updates.length;
 assert.equal(first.items[0].remux.target,'mp4');
 const changed=await service.updateBatchOperationDefaults({planId:first.planId,draftId:first.operationDraft.id,
   revision:first.operationDraft.revision,overrides:{remuxTarget:'matroska'}});
 const firstUpdate=updates.slice(start).find(u=>u.value.phase==='preparing'&&u.value.items.length);
 assert(firstUpdate);
 assert.equal(firstUpdate.value.items[0].remux,undefined,'first reprepare event must not show retired MP4 details');
 assert.notEqual(first.planId,changed.planId);
 for(const u of updates.slice(start)){
   q2mNoActions(u.value);assert.deepEqual(u.registered,[]);
   if(u.value.items[0]?.remux)assert.equal(u.value.items[0].remux.target,'matroska');
 }
 q2mNoActions(changed);assert.equal(changed.items[0].remux.target,'matroska');
 const prior=q2mShared(probe,'matroska').blockers;
 assert.deepEqual(changed.items[0].remux.blockers.slice(0,prior.length),prior);
 assert.equal(changed.items[0].reasonCode,prior[0]?.code||LINUX_ANCILLARY_REASON);
 const typed=changed.items[0].remux.blockers.find(x=>x.code===LINUX_ANCILLARY_REASON);
 assert(typed);
 assert.match(typed.message,/copy to (?:MKV|Matroska)/i);
 assert.match(typed.message,/subtitle track.*no copy was started.*nothing was omitted/i);
 assert.equal(service.plan.entries.size,0);assert.equal(service.plan.remuxCandidates.size,0);
});
test('Linux Q2m reprepare leaves a fresh destination collision unclassified for every emission',async t=>{
 const probe=q2mProbe({captions:[[2,'mov_text']]}),{service,h,updates,prepare,output}=await q2mSetup(t,probe,{matroska:true});
 const first=await prepare(),start=updates.length,dest=path.join(output,'source_Remux-MKV.mkv');
 await fsp.writeFile(dest,'newly existing output', {flag:'wx'});
 const changed=await service.updateBatchOperationDefaults({planId:first.planId,draftId:first.operationDraft.id,
   revision:first.operationDraft.revision,overrides:{remuxTarget:'matroska'}});
 assert.equal(changed.items[0].status,'skipped');
 assert.match(changed.items[0].reason,/output already exists/i);
 assert(updates.slice(start).some(u=>u.value.phase==='preparing'&&u.value.items.length));
 for(const u of [...updates.slice(start),{value:changed,registered:[]}])
   for(const item of u.value.items){assert.equal(item.remux,undefined);assert.equal(item.verificationMethod,undefined);assert.deepEqual(u.registered,[]);}
 assert.equal(service.plan.entries.size,0);assert.equal(service.plan.remuxCandidates.size,0);
 assert(h.generations.every(g=>!g.runCalls));
 assert.equal(await fsp.readFile(dest,'utf8'),'newly existing output');
});
test('Linux Q2m does not diagnose a nonprogressive source as an ordinary ancillary copy',async t=>{
 const probe=q2mProbe({captions:[[2,'mov_text']]});
 probe.streams[0].field_order='tt';
 const {service,h,prepare}=await q2mSetup(t,probe);
 const item=(await prepare()).items[0];
 assert.equal(item.status,'unsupported');
 assert.notEqual(item.reasonCode,LINUX_ANCILLARY_REASON);
 assert(!item.remux?.blockers.some(x=>x.code===LINUX_ANCILLARY_REASON));
 assert.equal(service.plan.entries.size,0);
 assert(h.generations.every(g=>!g.runCalls));
});

test('Linux Q2m does not diagnose missing or invalid native track clocks and IDs',async t=>{
 for(const [field,replacements] of [
   ['time_base',[undefined,'0/1000','bogus']],['duration_ts',[undefined,0,-1]],['start_pts',[undefined,'bogus']],
   ['id',[undefined,'0','1']],
 ]){
   // Video, audio, and native timed text must each be independently in scope.
   for(const index of [0,1,2])for(const replacement of replacements){
     // Duplicate an actual other track ID, never accidentally retain track 0's own ID.
     const value=field==='id'&&replacement==='1'?String((index+1)%3+1):replacement;
     const label=field+' on track '+index+': '+value;
     await t.test(label,async sub=>{
       const probe=q2mProbe({captions:[[2,'mov_text']]});
       if(value===undefined)delete probe.streams[index][field];else probe.streams[index][field]=value;
       const {service,h,prepare}=await q2mSetup(sub,probe);
       const prior=q2mShared(probe,'mp4').blockers;
       const item=(await prepare()).items[0];
       assert.equal(item.status,'unsupported');
       assert.notEqual(item.reasonCode,LINUX_ANCILLARY_REASON);
       assert(!item.remux?.blockers.some(x=>x.code===LINUX_ANCILLARY_REASON));
       if(prior.length){assert.equal(item.reasonCode,prior[0].code);assert.deepEqual(item.remux.blockers,prior);}
       assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls));
     });
   }
 }
});
test('Linux Q2m keeps unsupported subtitle and chapter-data disposition reasons',async t=>{
 for(const [label,source] of [['subtitle',{captions:[[2,'mov_text']]}],['chapter data',{data:true,chapters:true}]]){
   for(const [description,disposition] of [['missing default',{}],['malformed default',{default:2}],
     ['non-default enabled flag',{default:0,forced:1}]]){
     await t.test(label+': '+description,async sub=>{
       const probe=q2mProbe(source);
       probe.streams[2].disposition=disposition;
       const {service,h,prepare}=await q2mSetup(sub,probe);
       const prior=q2mShared(probe,'mp4').blockers;
       const item=(await prepare()).items[0];
       assert.equal(item.status,'unsupported');
       assert.notEqual(item.reasonCode,LINUX_ANCILLARY_REASON);
       assert(!item.remux?.blockers.some(x=>x.code===LINUX_ANCILLARY_REASON));
       if(prior.length){assert.equal(item.reasonCode,prior[0].code);assert.deepEqual(item.remux.blockers,prior);}
       assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls));
     });
   }
 }
});

for(const scenario of [
 {name:'H264 existing ordinary duration bound',settings:{profileId:'h264-cpu',preset:'veryfast',quality:23},policy:'ORDINARY_DURATION',
   modify(probe){probe.format.duration='1801';probe.streams.forEach(s=>{s.duration='1801';s.duration_ts=1801000;});}},
 {name:'AV1 existing ordinary geometry bound',settings:{profileId:'av1-cpu',preset:'6',quality:32},policy:'ORDINARY_VIDEO',
   modify(probe){Object.assign(probe.streams[0],{width:2560,height:1440,coded_width:2560,coded_height:1440});}},
 {name:'H265 ordinary Matroska 1/1000 requirement',settings:{profileId:'h265-cpu',preset:'slow',quality:25},policy:'h265-clock',
   modify(probe){Object.assign(probe.streams[1],{time_base:'1/48000',duration_ts:96000});}},
 {name:'admitted ordinary H264 Full/Source',settings:{profileId:'h264-cpu',preset:'veryfast',quality:23},modify(){}},
]){
 test('Linux ordinary Prepare commits the policy verdict before inspection state: '+scenario.name,async t=>{
   const {service,h,root}=await setup(t);
   const input=path.join(root,'input'),output=path.join(root,'output'),source=path.join(input,'source.mkv');
   await fsp.mkdir(input);await fsp.mkdir(output);await fsp.writeFile(source,'Inert ordinary service policy fixture, not media.');
   const probe=sourceProbe();probe.format.size=String((await fsp.stat(source)).size);
   probe.streams.forEach(s=>{s.duration_ts=2000;});
   scenario.modify(probe);
   const duration=Number(probe.format.duration),{width,height}=probe.streams[0];
   const inspected=[];
   service.inspect=async file=>{inspected.push(file);return {probe:structuredClone(probe),duration,
     color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},
     summary:{selectedVideoIndex:0,codec:'h264',width,height,durationSeconds:duration,bitDepth:8}};};
   service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});
   service.storageEligibility={check:async()=>({eligible:true})};
   const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
   const snapshots=[],incidents=[];
   service.on('update',snapshot=>snapshots.push({snapshot,entries:service.plan?.entries?.size||0}));
   const record=service.recordIncident;
   service.recordIncident=async event=>{
     if(event.reason==='FILE_INSPECTED')incidents.push({event:structuredClone(event),entries:service.plan?.entries?.size||0});
     return record(event);
   };
   const result=await service.prepareBatch({inputFolderId:i.id,outputFolderId:o.id,settings:scenario.settings});
   await service.taskPromise;
   const item=result.items[0],current=service.snapshot();
   assert.deepEqual(inspected,[source]);assert.equal(current.items[0].id,item.id);
   assert.equal(incidents.length,1);assert.equal(incidents[0].event.fileId,item.id);
   assert(snapshots.some(({snapshot})=>snapshot.items.some(x=>x.id===item.id)));
   t.diagnostic('outward statuses / FILE_INSPECTED: '+JSON.stringify([snapshots.flatMap(({snapshot,entries})=>
     snapshot.items.filter(x=>x.id===item.id).map(x=>[snapshot.phase,x.status,entries])),incidents.map(x=>[x.event.context.status,x.entries])]));
   const facts={probe,settings:scenario.settings,request:item.operationRequest,bytes:Number(probe.format.size)};
   if(scenario.policy==='h265-clock')
     assert.throws(()=>require('../linux-blue/h265-ordinary-policy.cjs').admit(facts),/Matroska 1\/1000/);
   else if(scenario.policy)
     assert.throws(()=>require('../linux-blue/ordinary-cpu-policy.cjs').admitInput(facts),{code:scenario.policy});
   else assert.doesNotThrow(()=>require('../linux-blue/ordinary-cpu-policy.cjs').admitInput(facts));
   assert.equal(service.executionBinding,null);
   assert(h.generations.every(g=>g.runCalls===0&&g.observeCalls===0));
   assert.deepEqual(await fsp.readdir(output),[]);
   if(!scenario.policy){
     assert.equal(item.status,'ready',item.reason);assert.equal(current.items[0].status,'ready');
     assert(snapshots.some(({snapshot})=>snapshot.items.some(x=>x.id===item.id&&x.status==='ready')));
     assert.equal(incidents[0].event.context.status,'ready');assert.equal(incidents[0].entries,0);
     const entry=service.plan.entries.get(item.id);
     assert(entry?.operationPlan?.compatibilityPath);assert.equal(entry.operationPlan.contract.range.kind,'full');
     assert.equal(item.operationRequest.resolution,'source');assert.equal(item.operationRequest.audioPolicy,'copy');
     return;
   }
   assert.equal(item.status,'unsupported');assert.equal(current.items[0].status,'unsupported');assert(item.reason);
   for(const {snapshot,entries} of snapshots){
     const row=snapshot.items.find(x=>x.id===item.id);
     assert(!row||!['ready','conflict'].includes(row.status),'refused source was visible with a selectable status');
     assert.equal(entries,0,'refused source was temporarily installed as a runnable entry');
   }
   assert.equal(incidents[0].event.context.status,'unsupported');
   assert.equal(incidents[0].event.message,item.reason);assert.equal(incidents[0].entries,0);
   assert.equal(service.plan.entries.size,0);
   await assert.rejects(service.startBatch({planId:result.planId,fileIds:[item.id]}));
   assert.equal(service.executionBinding,null);assert(h.generations.every(g=>g.runCalls===0));
   assert.deepEqual(await fsp.readdir(output),[]);
 });
}

test('Linux ordinary Prepare cancellation never publishes old readiness and permits a fresh owner',async t=>{
 const {service,h,root}=await setup(t);
 const input=path.join(root,'input'),output=path.join(root,'output');
 await fsp.mkdir(input);await fsp.mkdir(output);await fsp.writeFile(path.join(input,'preview.mkv'),'Inert inspection fixture');
 const probe=sourceProbe(),settings={profileId:'h264-cpu',preset:'veryfast',quality:23};
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});
 service.storageEligibility={check:async()=>({eligible:true})};
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
 const args={inputFolderId:i.id,outputFolderId:o.id,settings};
 const inspection=()=>({probe:structuredClone(probe),duration:2,color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},
   summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
 let inspectEntered,inspectRelease;
 const entered=new Promise(r=>inspectEntered=r),release=new Promise(r=>inspectRelease=r);
 service.inspect=async()=>{inspectEntered();await release;return inspection();};
 const snapshots=[];service.on('update',state=>snapshots.push(state));
 const incidents=[],record=service.recordIncident.bind(service);
 service.recordIncident=async event=>{if(event.reason==='FILE_INSPECTED')incidents.push(structuredClone(event));return record(event);};
 const first=service.prepareBatch(args);
 await Promise.race([entered,first.then(()=>{throw Error('test preparation never entered inspection');})]);
 const retired=service.snapshot(),old=h.generations.at(-1);
 const cancellation=service.cancelCurrent();
 try {await assert.rejects(service.startBatch({planId:retired.planId,fileIds:[retired.items[0].id]}));}
 finally {inspectRelease();}
 await first.catch(()=>{});await cancellation;
 assert(old.closed);assert.equal(service.plan,null);
 assert(snapshots.filter(s=>s.planId===retired.planId).every(s=>s.items.every(item=>item.status!=='ready')));
 assert(incidents.every(e=>e.context.status!=='ready'));
 assert.deepEqual(await fsp.readdir(output),[]);
 service.inspect=async()=>inspection();
 const fresh=await service.prepareBatch(args);
 assert.notEqual(fresh.planId,retired.planId);assert.notEqual(h.generations.at(-1),old);
 assert.equal(fresh.items[0].status,'ready',fresh.items[0].reason);
 assert.equal(service.plan.entries.size,1);
 assert.equal(incidents.at(-1).context.status,'ready');
 await assert.rejects(service.startBatch({planId:retired.planId,fileIds:[retired.items[0].id]}));
 await service.cancelCurrent();assert.equal(service.executionBinding,null);
 assert(h.generations.every(g=>g.closed&&!g.runCalls));assert.deepEqual(await fsp.readdir(output),[]);
});

test('Linux late Prepare cancel never projects selectable state after the abort',async t=>{
 const {service,h,root}=await setup(t);
 const i=path.join(root,'input'),o=path.join(root,'output'),source=path.join(i,'source.mkv');
 await fsp.mkdir(i);await fsp.mkdir(o);await fsp.writeFile(source,'Inert ordinary Prepare/cancel fixture, not media.');
 const probe=sourceProbe();probe.format.size=String((await fsp.stat(source)).size);
 service.inspect=async()=>({probe:structuredClone(probe),duration:2,
   color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},
   summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,durationSeconds:2,bitDepth:8}});
 service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});
 service.storageEligibility={check:async()=>({eligible:true})};
 const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
 const request={inputFolderId:input.id,outputFolderId:output.id,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}};
 let resolveReached,release,held=false;
 const reached=new Promise(r=>resolveReached=r),gate=new Promise(r=>release=r);
 const updateTrace=[];
 service.on('update',state=>updateTrace.push({state,aborted:service.controller?.signal.aborted===true}));
 const journalAppend=service.diagnostics.append.bind(service.diagnostics);
 service.diagnostics.append=async event=>{
   if(event.reason==='FILE_INSPECTED'&&!held){
     held=true;resolveReached(structuredClone(event));await gate;
   }
   return journalAppend(event);
 };
 const prep=service.prepareBatch(request);
 const inspected=await Promise.race([reached,prep.then(()=>{throw Error('Prepare did not reach the held audit append');})]);
 const before=service.snapshot(),id=before.items[0].id;
 assert.equal(before.phase,'preparing');assert.equal(inspected.fileId,id);
 assert.equal(inspected.context.status,'ready');
 const whileSaving={status:before.items[0].status,entries:service.plan.entries.size};
 const startRequest={planId:before.planId,fileIds:[id]};
 const start=updateTrace.length;
 const cancel=service.cancelBatch({batchId:before.batchId});
 const direct=service.snapshot(),aborted=service.controller.signal.aborted;
 let returned,cancelled;
 try {
   assert.equal(aborted,true);
   await assert.rejects(service.startBatch(startRequest));
 } finally {
   release();
   [returned,cancelled]=await Promise.all([prep,cancel]);
 }
 const cancelledProjection=([where,state])=>[where,state.phase,state.items.find(x=>x.id===id)?.status||null];
 const post=[['direct snapshot',direct],...updateTrace.slice(start).map(({state,aborted})=>[aborted?'aborted update':'update',state]),
   ['Prepare response',returned],['Cancel response',cancelled]];
 t.diagnostic('after public Cancel: '+JSON.stringify(post.map(cancelledProjection)));
 assert.equal(cancelled.phase,'cancelled');assert.equal(cancelled.planId,null);assert.equal(service.plan,null);
 assert.equal(service.state.operationDraft,null);
 await assert.rejects(service.startBatch(startRequest));
 assert.equal(service.executionBinding,null);assert(h.generations.every(g=>!g.runCalls));
 assert.deepEqual(await fsp.readdir(o),[]);
 const fresh=await service.prepareBatch(request);
 assert.equal(fresh.items[0].status,'ready',fresh.items[0].reason);assert.notEqual(fresh.planId,before.planId);
 const revised=await service.reprepareEncodingSettings({planId:fresh.planId,draftId:fresh.operationDraft.id,
   revision:fresh.operationDraft.revision,settings:{...request.settings,quality:24}});
 assert.equal(revised.items[0].status,'ready',revised.items[0].reason);assert.notEqual(revised.planId,fresh.planId);
 assert.deepEqual(whileSaving,{status:'pending',entries:0});
 assert.equal(cancelled.items[0].status,'cancelled');
 assert.equal(cancelled.items[0].reason,'Preparation cancelled. Prepare again.');
 for(const [where,state] of post){
   const row=state.items.find(x=>x.id===id);
   assert(!row||!['ready','conflict'].includes(row.status),where+' showed the aborted row as selectable');
 }
});

for (const mode of ['journal-error','treat-as-original','reencode-output']) {
 test('Linux late Prepare settlement preserves '+mode,async t=>{
   const {service,h,root}=await setup(t);
   const i=path.join(root,'input'),o=path.join(root,'output');
   await fsp.mkdir(i);await fsp.mkdir(o);
   const name=mode==='treat-as-original'?'source_H264-CPU.mkv':'source.mkv';
   const pathToSource=path.join(i,name);
   await fsp.writeFile(pathToSource,'Inert permission/audit fixture, not media.');
   const probe=sourceProbe();probe.format.size=String((await fsp.stat(pathToSource)).size);
   if(mode==='reencode-output')Object.assign(probe.format.tags,{FFMPEG_ENCODER_PROVENANCE:'1',FFMPEG_ENCODER_OUTPUT_ID:'f711706b-d720-4a74-9712-d10567c85655'});
   service.inspect=async()=>({probe:structuredClone(probe),duration:2,
     color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},
     summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}});
   service.capabilities=async()=>({profiles:require('../src/media.cjs').PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{}});
   service.storageEligibility={check:async()=>({eligible:true})};
   const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
   const args={inputFolderId:input.id,outputFolderId:output.id,settings:{profileId:'h264-cpu',preset:'veryfast',quality:23}};
   let prior=null;
   if(mode!=='journal-error'){
     prior=await service.prepareBatch(args);
     assert.equal(prior.items[0].status,mode==='treat-as-original'?'ambiguous':'generated');
     assert.equal(service.plan.entries.size,0);
   }
   let enter,release;
   const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);
   const original=service.diagnostics.append.bind(service.diagnostics);
   service.diagnostics.append=async e=>{
     if(e.reason==='FILE_INSPECTED'){enter(structuredClone(e));await held;
       if(mode==='journal-error')throw Error('Test-only journal write failure.');
     }
     return original(e);
   };
   const emitted=[];
   service.on('update',snapshot=>emitted.push({snapshot,entries:service.plan?.entries.size||0}));
   const proceed=prior?(mode==='treat-as-original'?service.treatAsOriginal({planId:prior.planId,fileId:prior.items[0].id})
     :service.reencodeOutputs({planId:prior.planId,fileIds:[prior.items[0].id]})):service.prepareBatch(args);
   const event=await Promise.race([entered,proceed.then(()=>{throw Error('The permission or inspection record never reached its journal');})]);
   const during=service.snapshot(),whileEntries=service.plan.entries.size,before=emitted.slice();
   release();
   const after=await proceed;
   assert.equal(event.context.status,'ready','inspection verdict does not describe execution authority');
   assert.equal(after.items[0].status,'ready',after.items[0].reason);
   assert.equal(service.plan.entries.size,1);assert.equal(after.phase,'ready');
   assert.equal(during.items[0].status,'pending');assert.equal(whileEntries,0);
   assert(before.every(({snapshot,entries})=>entries===0&&snapshot.items.every(item=>item.status!=='ready')));
   assert(emitted.some(({snapshot,entries})=>entries===1&&snapshot.items.some(item=>item.status==='ready')));
   if(mode==='journal-error')assert.match(after.diagnosticWarning,/Diagnostic history is incomplete/);
   else if(mode==='treat-as-original')assert.match(after.items[0].reason,/Explicitly treated as original/);
   else assert(after.items[0].reencodeAuthorized&&service.plan.entries.get(after.items[0].id).sourceOutputId);
   assert(h.generations.every(g=>!g.runCalls));assert.deepEqual(await fsp.readdir(o),[]);
 });
}

async function qMkvInputFixture(t,{target='mp4',name='source.mkv',probe=sourceProbe(),retained=null}={}){
 const {service,h,root}=await setup(t,{matroska:true,mov:true,movV2:true});
 const i=path.join(root,'input'),o=path.join(root,'output'),file=path.join(i,name);
 await fsp.mkdir(i);await fsp.mkdir(o);
 if(retained)await fsp.copyFile(retained,file);else await fsp.writeFile(file,'Inert MKV source-policy control, not media');
 if(!retained)probe.format.size=String((await fsp.stat(file)).size);
 const inspections=[],pinned=structuredClone(probe);
 service.inspect=async chosen=>{inspections.push(chosen);return {probe:structuredClone(probe),duration:Number(probe.format.duration),summary:{}};};
 service.storageEligibility={check:async()=>({eligible:true})};
 const input=await service.registerFolder(i,'input'),output=await service.registerFolder(o,'output');
 const outbound=[];
 service.on('update',state=>outbound.push({state,offers:[...service.plan?.remuxCandidates?.values()||[]],entries:service.plan?.entries.size||0}));
 return {service,h,o,file,pinned,inspections,outbound,prepare:()=>service.prepareRemuxBatch({inputFolderId:input.id,outputFolderId:output.id,target})};
}

for(const [target,label] of [['mp4','MP4'],['mov','MOV'],['matroska','MKV']]){
 test('Linux verified MKV input refusal is explicit and has no omit actions for '+label,async t=>{
   const {service,h,o,file,inspections,outbound,prepare}=await qMkvInputFixture(t,{target});
   const final=await prepare(),row=final.items[0];
   t.diagnostic('file status / outward omit actions '+JSON.stringify([row.status,row.reasonCode,outbound.flatMap(x=>x.state.items
     .filter(i=>i.remux).map(i=>[i.reasonCode,i.remux.omissionCandidates.map(o=>o.streamIndex),x.offers.length,x.entries]))]));
   assert.equal(row.status,'unsupported');assert.equal(row.reasonCode,'REMUX_MKV_INPUT_NOT_QUALIFIED',row.reason);
   assert.match(row.reason,new RegExp('verified copy to '+label,'i'));assert.match(row.reason,/no copy was started.*no track was omitted/i);
   assert.deepEqual(inspections,[file]);assert.equal(row.remux.status,'blocked');
   assert(outbound.some(x=>x.state.items.some(i=>i.remux)));
   for(const x of outbound){
     assert.deepEqual(x.offers,[]);assert.equal(x.entries,0);
     for(const item of x.state.items.filter(i=>i.remux)){
       assert.deepEqual(item.remux.omissionCandidates,[]);assert.deepEqual(item.remux.omissionDecisionIds,[]);
       assert(item.remux.streams.every(s=>s.action==='blocked'));
     }
   }
   await assert.rejects(service.startBatch({planId:final.planId,fileIds:[row.id]}));
   assert.equal(service.plan.remuxGrants.size,0);assert.equal(service.executionBinding,null);assert(h.generations.every(g=>!g.runCalls&&!g.observeCalls));
   assert.deepEqual(await fsp.readdir(o),[]);
 });
}
test('Linux MKV source wording never replaces older relationship/format blockers',async t=>{
 for(const testCase of [
   {modify:p=>{p.format.nb_streams=3;},code:'REMUX_RELATIONSHIPS_UNKNOWN'},
   {modify:p=>{p.format.format_name='unidentified';},code:'REMUX_CONTAINER_UNKNOWN'},
   {modify:p=>{p.format.format_name='matroska,avi';}},
   {name:'source.webm',modify:()=>{}},
 ]){
   const probe=sourceProbe();testCase.modify(probe);
   const {service,h,prepare}=await qMkvInputFixture(t,{probe,name:testCase.name});
   const item=(await prepare()).items[0];
   assert.equal(item.status,'unsupported');assert.notEqual(item.reasonCode,'REMUX_MKV_INPUT_NOT_QUALIFIED');
   if(testCase.code)assert.equal(item.reasonCode,testCase.code);
   assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls&&!g.observeCalls));
 }
});
const qMkvNativeDir=process.env.Q2K_RETAINED_NATIVE_ROOT;
test('Linux MKV source preserves incomplete prior real 9.0.2 source probe',{skip:!qMkvNativeDir},async t=>{
 const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
 const retained=path.join(qMkvNativeDir,'media/aligned.mkv');
 const raw=await fsp.readFile(path.join(qMkvNativeDir,'logs/aligned-source-probe.stdout'));
 assert.equal(sha(await fsp.readFile(retained)),'912ee77258d8539be31386042972d940e634221335f8764c265d175380b1d3cb');
 assert.equal(sha(raw),'fe941fd6ef76e9e41b1f8856437af79b23afacb95ea15acb9c077c4a15ad7655');
 const probe=JSON.parse(raw);assert(!Object.hasOwn(probe,'programs')&&!Object.hasOwn(probe,'stream_groups'));
 const {service,h,file,inspections,outbound,prepare}=await qMkvInputFixture(t,{probe,retained});
 const result=await prepare(),item=result.items[0];
 assert.equal(item.reasonCode,'REMUX_RELATIONSHIPS_UNKNOWN');
 assert.deepEqual(inspections,[file]);assert.equal(sha(await fsp.readFile(file)),'912ee77258d8539be31386042972d940e634221335f8764c265d175380b1d3cb');
 assert(outbound.every(x=>x.entries===0&&x.offers.length===0));
 assert.equal(service.plan.entries.size,0);assert(h.generations.every(g=>!g.runCalls&&!g.observeCalls));
});

test('Linux MKV input refusal stays source-only on a fresh target choice',async t=>{
 const {service,h,o,outbound,prepare}=await qMkvInputFixture(t);
 const first=await prepare(),id=first.items[0].id,mark=outbound.length;
 assert.equal(first.items[0].remux.target,'mp4');
 const next=await service.updateBatchOperationDefaults({planId:first.planId,draftId:first.operationDraft.id,
   revision:first.operationDraft.revision,overrides:{remuxTarget:'matroska'}});
 assert.notEqual(next.planId,first.planId);
 const fresh=outbound.slice(mark);
 assert(fresh.some(x=>x.state.phase==='preparing'&&x.state.items.some(i=>!i.remux)));
 for(const x of fresh){
   assert.deepEqual(x.offers,[]);assert.equal(x.entries,0);
   assert(x.state.items.every(i=>!i.remux||i.remux.target==='matroska'));
 }
 assert.equal(next.items[0].reasonCode,'REMUX_MKV_INPUT_NOT_QUALIFIED');
 assert.match(next.items[0].reason,/verified copy to MKV/i);
 await assert.rejects(service.startBatch({planId:first.planId,fileIds:[id]}));
 await assert.rejects(service.startBatch({planId:next.planId,fileIds:[id]}));
 assert.deepEqual(await fsp.readdir(o),[]);assert(h.generations.every(g=>!g.runCalls&&!g.observeCalls));
});
