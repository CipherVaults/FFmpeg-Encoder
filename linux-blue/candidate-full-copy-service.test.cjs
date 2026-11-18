'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const api=require('./candidate-full-copy-service.cjs');
const {FROZEN,SPECS}=require('./candidate-full-copy-calibration.cjs');
const {deriveCfrFullResizeCopyResources,FULL_COPY_FAMILY_ID,FULL_COPY_RESOURCE_POLICY}=require('../src/operation-resource-budget.cjs');
const {CandidateTrimService}=require('./workbench-trim-candidate.cjs');
const {OperationRuntimeObserver}=require('../src/operation-runtime.cjs');
const shared=require('./workbench-long-range-service.cjs');
const {OutputAccess}=require('../src/output-access.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),H='a'.repeat(64),settings={profileId:'h265-cpu',preset:'slow',quality:25};
const sourceText=require('node:fs').readFileSync(path.join(__dirname,'candidate-full-copy-service.cjs'),'utf8');
const deps=JSON.parse(sourceText.match(/const DEPENDENCIES = (\[[\s\S]*?\n\]);/)[1]);
const toolPins=JSON.parse(sourceText.match(/const TOOL_PINS = Object.freeze\(([^\n]+)\);/)[1]);
const rational=n=>({n:String(n),d:'1'});
// Wholly synthetic structure, no retained media/report dependency or qualification.
function report(){return {schema:1,status:'passed-preregistered-full-copy-calibration',runtimeIdentity:api.RUNTIME_ID,pins:toolPins,dependencies:deps,frozen:FROZEN,specs:SPECS,settings,publicationAuthorized:false,catalogActivated:false,postCloseIdentitiesVerified:true,diagnosticsComplete:true,census:{spawned:70,closed:70,live:0,maximum:1},children:Array.from({length:70},(_,i)=>({index:i+1,spawned:true,closed:true,exitCode:0,signal:null,stderr:{bytes:0,sha256:sha(Buffer.alloc(0)),capture:{totalBytes:0,truncated:false},completeAtSave:true}})),cases:SPECS.map((spec,i)=>{
 const seconds=spec.seconds,frames=seconds*30,samples=seconds*48000,source={path:'/synthetic/'+spec.id+'/source.'+spec.extension,bytes:1000000,sha256:H},output={path:'/synthetic/'+spec.id+'/output.mkv',bytes:500000,sha256:H};
 const packets={count:Math.ceil(samples/1024)+1,payloadSha256:H,paddingSha256:H,headerSha256:H};
 function diag(isSource){return {collectorAuthority:false,source:isSource,file:isSource?source.path:output.path,files:['video','audio','packets','header'].map(label=>({label,bytes:10,records:1,sha256:H})),video:{frames,samples:'0',first:rational(0),end:rational(seconds),gaps:0,cadence:true,metadata:{startPts:'0',durationTs:String(seconds*15360),timeBase:'1/15360'}},audio:{frames:Math.ceil(samples/1024),samples:String(samples),first:rational(0),end:rational(seconds),gaps:0,cadence:true,metadata:{startPts:'0',durationTs:String(samples),timeBase:'1/48000'}},packets:{...packets,timeBase:isSource?'1/48000':'1/1000'}};}
 const coded={packets:packets.count,payloadSha256:H,sideDataSha256:H,extradataSha256:H};coded.seal=sha(JSON.stringify(coded));
 const resources=deriveCfrFullResizeCopyResources({sourceExtentUs:seconds*1000000,sourceBytes:'1000000'});
 return {id:spec.id,status:'passed',sourceDiagnosticAccepted:true,source,output,sourceIdentity:{size:'1000000'},resources,sourceDiagnostic:diag(true),outputDiagnostic:diag(false),collection:{schema:1,status:'completed',runtimeIdentity:api.RUNTIME_ID,planFingerprint:H,publicationAuthorized:false,qualificationGranted:false,scope:'complete-decoded-timing-and-copied-packet-identity',sourceIdentityDisposition:'unchanged',sourceBefore:{ino:'1'},sourceAfter:{ino:'1'},outputBefore:{ino:'2'},outputAfter:{ino:'2'},sourcePath:source.path,outputPath:output.path,budget:resources.budget,invocations:['source-video-frames','output-video-frames','source-audio-1-frames','output-audio-1-frames','output-audio-1-padding','source-audio-1-packet-identity','source-audio-1-header','output-audio-1-packet-identity','output-audio-1-header'].map(label=>({label,status:'completed',stderr:'',stderrCapture:{truncated:false,totalBytes:0},capture:{sha256:H}})),timingQualification:{runtimeIdentity:api.RUNTIME_ID,videoDurationUs:FROZEN.videoDurationUs,audioTimelineUs:FROZEN.audioTimelineUs,aac:null},completeSource:{video:{frames,firstTime:rational(0),endTime:rational(seconds),maximumNominalCadenceErrorUs:0,maximumNominalDurationErrorUs:0,maximumNominalPhaseErrorUs:0,properties:{policy:FULL_COPY_FAMILY_ID,framesChecked:frames,sampleAspectRatio:'1:1',chromaLocation:'left',sideDataPolicy:'h26x-unregistered-sei-only'}},audio:[{inputIndex:1,sampleCount:String(samples),gaps:0,firstTime:rational(0),endTime:rational(seconds)}]},packetIdentity:[{inputIndex:1,outputIndex:1,source:{...coded},output:{...coded}}],decodedEvidence:{video:{sourceFrameCount:frames,outputFrameCount:frames,comparedFrames:frames,firstSourcePtsUs:0,firstOutputPtsUs:0,maxRebasedTimestampErrorUs:334},audio:[{inputIndex:1,sourceSampleCount:samples,outputSampleCount:samples,firstSourcePtsUs:0,firstOutputPtsUs:0,lastSourceEndUs:seconds*1000000,lastOutputEndUs:seconds*1000000+333,encoderDelaySamples:1024,discardPaddingSamples:[0,768,384][i],packetIdentity:{algorithm:'sha256',packets:packets.count,sourceSeal:coded.seal,outputSeal:coded.seal}}]},timelineComparisons:{video:{comparedFrames:frames,toleranceUs:FROZEN.videoDurationUs,maximumDurationErrorUs:334},audio:[{inputIndex:1,mode:'copy',selectedSourceGaps:0,unmatchedSourceTailSamples:0,unmatchedOutputTailSamples:0,comparedSamples:samples,contentIdentity:false,toleranceUs:FROZEN.audioTimelineUs,maximumElapsedClockErrorUs:334}]},encoderInputs:{video:{records:String(frames),orderedPts:H}}},telemetryValidation:{valid:true,scope:'encoder-input-count-and-timeline-only',streams:[{outputIndex:0,kind:'video',unknownInputRecords:'0',correspondence:'reported-input-and-independent-selected-source'}]},validation:{valid:true,errors:[],validation:'decoded-operation-contract',timing:{requested:null,resolved:null,video:{frames,startUs:0,endUs:seconds*1000000},audio:[{mode:'copy',sampleCountDifference:0}]}}};
 })};}
const validate=r=>{const b=Buffer.from(JSON.stringify(r));return api.assertCandidateServiceReceipt(b,sha(b));};
test('pure Full-copy validator accepts only complete copied-AAC structure, no live authority',()=>{assert.deepEqual(validate(report()),report());assert.throws(()=>api.assertCandidateServiceReceipt(Buffer.from(JSON.stringify(report()))));const b=Buffer.from('{');assert.throws(()=>api.assertCandidateServiceReceipt(b,sha(b)));});
test('malformed/forged/cross-family evidence and every authority boundary reject',()=>{
 const mutators=[r=>r.schema=2,r=>r.status='failed-retained',r=>r.runtimeIdentity=H,r=>r.cases.pop(),r=>r.cases.push(r.cases[0]),r=>r.publicationAuthorized=true,r=>r.frozen={...r.frozen,tolerances:{...r.frozen.tolerances,sampleCount:1}},r=>r.specs=[...r.specs].reverse(),r=>r.runtimeCloseFailure={},r=>r.children[0].exitCode=1,r=>r.children[0].stderr.capture.truncated=true,r=>r.children[0].stderr.completeAtSave=false,r=>r.census.live=1,r=>r.postCloseIdentitiesVerified=false,r=>r.dependencies=[],r=>r.pins={...r.pins,ffmpeg:{...r.pins.ffmpeg,sha256:H}},r=>r.cases[0].resources.budget.maxRecords++,r=>r.cases[0].sourceDiagnostic.audio.end=rational(9),r=>r.cases[0].sourceDiagnostic.audio.gaps=1,r=>r.cases[0].sourceDiagnostic.video.metadata.timeBase='1/30',r=>r.cases[0].sourceDiagnostic.collectorAuthority=true,r=>r.cases[0].outputDiagnostic.packets.headerSha256='b'.repeat(64),r=>r.cases[0].pcmIdentity={},r=>r.cases[0].collection.decodedEvidence.audio[0].pcmIdentity={},r=>r.cases[0].collection.packetIdentity[0].output.sideDataSha256='b'.repeat(64),r=>r.cases[0].collection.completeSource.video.properties.policy='other',r=>r.cases[0].collection.completeSource.audio[0].sampleCount='1',r=>r.cases[0].collection.invocations.pop(),r=>r.cases[0].collection.invocations[0].stderrCapture.truncated=true,r=>r.cases[0].collection.decodedEvidence.audio[0].discardPaddingSamples=1,r=>r.cases[0].telemetryValidation.streams[0].unknownInputRecords='1',r=>r.cases[0].validation.timing.requested={startUs:0},r=>r.cases[0].collection.timelineComparisons.audio[0].maximumElapsedClockErrorUs=999999];
 for(const mutate of mutators){const r=structuredClone(report());mutate(r);assert.throws(()=>validate(r));}
});
test('literal calibration producer closure matches immutable tested source',async()=>{await api.verifyCandidateServiceProducers();});
test('factory rejects copied handles, getter options and arbitrary factory authority',async()=>{await assert.rejects(api.createCandidateFullCopyService({verifiedRuntime:{},stateDir:'/tmp/no-full-copy-state'}));let reads=0;const x=Object.defineProperty({stateDir:'/tmp/no-full-copy-state'},'verifiedRuntime',{enumerable:true,get(){reads++;return {};}});await assert.rejects(api.createCandidateFullCopyService(x));assert.equal(reads,0);await assert.rejects(api.createCandidateFullCopyService({verifiedRuntime:{},stateDir:'/tmp/no-full-copy-state',reportSha:H}));});
// VM-only substitutions never become public factory inputs; no real executable/report.
async function injected({changedProducer=false,changedReport=false,wrongIdentity=false,changedDependencies=false,wrongPair=false,reportIssue=null,staleAfterChecks=false,cleanupFailure=false}={}){
 const file=path.join(__dirname,'candidate-full-copy-service.cjs'),syntheticBytes=Buffer.from(JSON.stringify(report()).padEnd(207464));
 const digest=changedReport?H:sha(syntheticBytes);
 const source=sourceText.replace(`const REPORT_SHA = '${api.REPORT_SHA}';`,`const REPORT_SHA = '${digest}';`);
 let closed=0,observed=0,invoked=0,reportClosed=0,reportStats=0,reportReadBytes=0,reportRealpaths=0;
 const fake={runtimeIdentity:wrongIdentity?H:api.RUNTIME_ID,dependencies:changedDependencies?[]:deps,pins:Object.fromEntries(Object.entries(toolPins).map(([k,v])=>[k,{...v,path:'/synthetic/'+k,sha256:wrongPair?H:v.sha256}])),async requireCurrent(){observed++;if(staleAfterChecks&&observed>1)throw Error('Injected stale runtime after awaited report');},async close(){closed++;if(cleanupFailure)throw Error('Injected owned cleanup failure');},createRunner(){return async()=>{invoked++;throw Error('No child authorized');};}};
 const originalRequire=createRequire(file),module={exports:{}};
 const stat=()=>({isFile:()=>reportIssue!=='nonregular',nlink:reportIssue==='hardlink'?2n:1n,size:reportIssue==='large'?207465n:207464n,dev:1n,ino:2n,mtimeNs:1n,ctimeNs:reportIssue==='mutation'?BigInt(++reportStats):1n,birthtimeNs:1n});
 const overrides={
 'node:fs/promises':{...fs,realpath:async name=>name===api.REPORT?(++reportRealpaths&&(reportIssue==='symlink'||reportIssue==='path-alias'&&reportReadBytes===207464)?api.REPORT+'.alias':api.REPORT):fs.realpath(name),
 lstat:async name=>name===api.REPORT?{...stat(),ino:reportIssue==='path-replacement'?3n:2n}:fs.lstat(name,{bigint:true}),
 open:async(name,flags)=>{assert.equal(name,api.REPORT);assert.ok(flags&require('node:fs').constants.O_NOFOLLOW);if(reportIssue==='missing')throw Object.assign(Error('missing'),{code:'ENOENT'});return {stat:async()=>stat(),read:async(target,offset,length,position)=>{const bytesRead=reportIssue==='truncated'?0:syntheticBytes.copy(target,offset,position,position+length);reportReadBytes+=bytesRead;return {bytesRead};},close:async()=>{reportClosed++;}};},
 readFile:async(name,...args)=>changedProducer&&String(name).endsWith('candidate-full-copy-calibration.cjs')?Buffer.from('changed'):fs.readFile(name,...args)},
 './candidate-calibration-runtime.cjs':{requireCandidateCalibrationRuntime:h=>{assert.equal(h,fake);return h;}}
 };
 vm.runInThisContext('(function(require,module,exports,__dirname){'+source+'\n})',{filename:file})(name=>Object.hasOwn(overrides,name)?overrides[name]:originalRequire(name),module,module.exports,__dirname);
 return {api:module.exports,fake,counts:()=>({closed,observed,invoked,reportClosed,reportReadBytes,reportRealpaths})};
}
test('injected normal-service composition preserves observer, storage, OutputAccess and no launch effects',async()=>{
 const h=await injected();const access=new OutputAccess({openPath:async()=>'',showItemInFolder:()=>{}});const service=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state',outputAccess:access});
 try{assert.ok(service instanceof CandidateTrimService);assert.ok(service.operationRuntime instanceof OperationRuntimeObserver);assert.ok(service.operationQualifications instanceof shared.ClockQualifiedFamilySelector);assert.equal(service.operationTelemetry,true);assert.equal(service.operationEvidenceBudget,null);assert.equal(service.inspectionWorkers,1);assert.equal(typeof service.operationStorage,'function');assert.equal(h.counts().invoked,0);}finally{await service.closeOperationResources();}
 assert.equal(h.counts().closed,1);
});
test('rejected construction and bounded report-read failures retain cleanup without child effects',async()=>{
 const scenarios=[{changedProducer:true},{changedReport:true},{wrongIdentity:true},{changedDependencies:true},{wrongPair:true},{staleAfterChecks:true},...['missing','symlink','nonregular','large','mutation','truncated','hardlink','path-replacement','path-alias'].map(reportIssue=>({reportIssue}))];
 for(const opt of scenarios){const h=await injected(opt);await assert.rejects(h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'}));assert.equal(h.counts().closed,1);assert.equal(h.counts().invoked,0);if(opt.reportIssue&&!['symlink','missing'].includes(opt.reportIssue))assert.equal(h.counts().reportClosed,1);}
 const h=await injected({changedReport:true,cleanupFailure:true});await assert.rejects(h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'}),e=>e instanceof AggregateError&&e.errors.length===2&&/Exact bounded/.test(e.errors[0].message)&&/cleanup/.test(e.errors[1].message));
});
test('genuine OutputAccess only, inert option snapshot and synchronous cancellation closure',async()=>{
 const bad=await injected();await assert.rejects(bad.api.createCandidateFullCopyService({verifiedRuntime:bad.fake,stateDir:'/tmp/no-full-copy-state',outputAccess:{}}));assert.equal(bad.counts().closed,1);
 const h=await injected(),service=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'});let release;service.preferenceMutation=new Promise(resolve=>release=resolve);const cancel=service.cancelCurrent();
 try{assert.equal(service.admissionClosed,true);assert.throws(()=>service.startBatch({planId:'old',fileIds:['old']}),{code:'SHUTTING_DOWN'});}finally{release();await cancel;await service.closeOperationResources();}
 const next=await injected(),fresh=await next.api.createCandidateFullCopyService({verifiedRuntime:next.fake,stateDir:'/tmp/no-full-copy-state'});assert.equal(fresh.admissionClosed,false);await fresh.closeOperationResources();
});
test('both service and candidate cleanup failures survive',async()=>{
 const h=await injected(),s=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'});const a=Error('observer'),b=Error('candidate');const oc=s.operationRuntime.close.bind(s.operationRuntime),cc=h.fake.close;s.operationRuntime.close=async()=>{throw a;};h.fake.close=async()=>{throw b;};
 try{await assert.rejects(s.closeOperationResources(),e=>e instanceof AggregateError&&e.errors.length===2&&e.errors[1]===b);}finally{s.operationRuntime.close=oc;h.fake.close=cc;await s.closeOperationResources();}
});

function probe(size) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360',
    start_pts: 0, start_time: '0', duration_ts: 150 * 15360, duration: '150', disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 7200000, duration: '150', disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '150', size: String(size), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, chapters: [], programs: [], stream_groups: [] };
}
test('composed selector issues genuine Full/null/copy-only tokens and recalculates whole-source budgets',async()=>{
 const h=await injected(),s=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'});
 const {buildEncodeOperation,withEncodeOperationTelemetry,fingerprintEncodeSource}=require('../src/encode-operation.cjs');const {resolveFileRequest}=require('../src/operation-contract.cjs');const {classifyColor}=require('../src/media.cjs');const {isProportionalFamilySelection}=require('../src/operation-family.cjs');
 const source=probe(100000000),inspection={probe:source,color:classifyColor(source),duration:150},identity={canonicalPath:'/synthetic/source.mov',dev:'1',ino:'2',size:'100000000',mtimeNs:'1',ctimeNs:'1',birthtimeNs:'1',sparseDigest:'sha256-sparse-v1:'+H};
 function make(overrides={},orientationRequest=null){const request=resolveFileRequest({fileId:'synthetic',identityRevision:1,draftRevision:1,operation:'encode',overrides:{range:null,resolution:'720',audioPolicy:'copy',...overrides}});const orientation=s.operationQualifications.orientationQualification({inspection,request:orientationRequest||request,runtimeIdentity:api.RUNTIME_ID,settings});const plan=withEncodeOperationTelemetry(buildEncodeOperation({input:identity.canonicalPath,output:'/synthetic/output.mkv',inspection,request,settings,runtimeIdentity:api.RUNTIME_ID,...orientation}));return {plan,sourceIdentity:identity,sourceProbeFingerprint:fingerprintEncodeSource(source),settings,runtimeIdentity:api.RUNTIME_ID,environment:null,budget:null,executionBudgetMs:120000};}
 try{
  const bindings=make(),token=s.operationQualifications.select(bindings),selection=s.operationQualifications.requireCurrent(token,bindings);assert.equal(isProportionalFamilySelection(selection),true);assert.equal(selection.resourcePolicy,FULL_COPY_RESOURCE_POLICY);assert.deepEqual(selection.resources,deriveCfrFullResizeCopyResources({sourceExtentUs:150000000,sourceBytes:identity.size}).resources);assert.equal(bindings.plan.contract.request.range,null);assert.equal(bindings.plan.instrumentation.streams.length,1);
  for(const overrides of [{range:{startUs:1000000,endUs:2000000}},{resolution:'source'},{resolution:'1440'},{audioPolicy:'precision-flac'},{audioPolicy:'precision-aac'}])assert.throws(()=>s.operationQualifications.select(make(overrides,bindings.plan.contract.request)),JSON.stringify(overrides));
  assert.throws(()=>s.operationQualifications.requireCurrent({...token},bindings));assert.throws(()=>s.operationQualifications.requireCurrent(token,{...bindings,sourceIdentity:{...identity,ino:'3'}}));
  s.operationQualifications.invalidate('done');assert.throws(()=>s.operationQualifications.requireCurrent(token,bindings));
  // Inherited service Start gate also refuses compatibility-plan bypass, even
  // if an unqualified ready row was supplied by a stale or reentrant callback.
  s.state.phase='ready';s.plan={id:'fake',operation:'encode',sameFolder:false,settings,entries:new Map([['x',{operationPlan:{compatibilityPath:true}}]])};
  assert.throws(()=>s.startBatch({planId:'fake',fileIds:['x']}),{code:'LINUX_TRIM_CANDIDATE_SCOPE'});
 }finally{await s.closeOperationResources();}
});
test('rejected real branded fixture runtime closes before touching missing raw-report/state',async t=>{
 const os=require('node:os'),{openCandidateCalibrationRuntime}=require('./candidate-calibration-runtime.cjs');const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'full-copy-refusal-'));let runtime;t.after(async()=>{await runtime?.close();assert.equal(await fs.realpath(root),root);await fs.rm(root,{recursive:true});});const pins={};for(const k of ['ffmpeg','ffprobe']){const b=Buffer.from('not executable '+k),p=path.join(root,k);await fs.writeFile(p,b);pins[k]={path:p,size:b.length,sha256:sha(b)};}const runtimeIdentity=sha(JSON.stringify(['ffmpeg','ffprobe'].map(k=>({sizeBytes:pins[k].size,sha256:pins[k].sha256}))));runtime=await openCandidateCalibrationRuntime({pins,runtimeIdentity,dependencies:[]},{execute:async()=>{assert.fail('No child');}});await assert.rejects(api.createCandidateFullCopyService({verifiedRuntime:runtime,stateDir:path.join(root,'state')}),/exact reviewed pair/);await assert.rejects(runtime.requireCurrent(),/closed/);await assert.rejects(fs.stat(path.join(root,'state')),{code:'ENOENT'});
});

test('actual composed prepare exposes compatibility-ready without authority; Start refuses before effects',async t=>{
 const os=require('node:os'),{PROFILES,classifyColor}=require('../src/media.cjs');
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'full-copy-prepare-only-'));
 let service;
 t.after(async()=>{if(service){await service.cancelCurrent();await service.taskPromise;await service.closeOperationResources();await service.closeDiagnostics('completed');}assert.equal(await fs.realpath(root),root);await fs.rm(root,{recursive:true});});
 const input=path.join(root,'input'),output=path.join(root,'output'),state=path.join(root,'state');
 await Promise.all([input,output,state].map(p=>fs.mkdir(p)));
 const bytes=Buffer.from('synthetic non-media preparation fixture');await fs.writeFile(path.join(input,'source.mov'),bytes);
 const h=await injected();service=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:state});
 // In addition to the synthetic factory/runtime/report fixture, the preparation seams below are injected.
 // Real composed service, folder registration, preparation, selector and Start.
 service.cacheInjected=true;service.inspectionCache=null;
 service.storageEligibility={check:async()=>({eligible:true,reason:'Synthetic owned local fixture.'})};
 service.capabilities=async()=>({profiles:PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8,10]})),versions:{ffmpeg:'synthetic',ffprobe:'synthetic'}});
 const metadata=probe(bytes.length);
 service.inspect=async()=>({probe:structuredClone(metadata),color:classifyColor(metadata),duration:150,summary:{selectedVideoIndex:0,codec:'h264',width:1920,height:1080,bitDepth:8}});
 const inf=await service.registerFolder(input,'input'),outf=await service.registerFolder(output,'output');
 const plan=await service.prepareBatch({inputFolderId:inf.id,outputFolderId:outf.id,settings});
 assert.equal(plan.items.length,1);assert.equal(plan.items[0].status,'ready');assert.equal(plan.items[0].operationRequest.range,null);
 assert.equal(plan.items[0].operationRequest.resolution,'source');assert.equal(plan.items[0].operationRequest.audioPolicy,'copy');
 const entry=service.plan.entries.get(plan.items[0].id);assert.equal(entry.operationPlan.compatibilityPath,true);assert.equal(entry.qualificationSelection,null);
 const before=service.snapshot(),task=service.taskPromise,counts=h.counts(),outputBefore=await fs.readdir(output);
 assert.throws(()=>service.startBatch({planId:plan.planId,fileIds:[plan.items[0].id]}),{code:'LINUX_TRIM_CANDIDATE_SCOPE'});
 assert.deepEqual(service.snapshot(),before);assert.equal(service.taskPromise,task);assert.equal(service.busy,false);
 assert.deepEqual(h.counts(),counts);assert.equal(h.counts().invoked,0);assert.deepEqual(await fs.readdir(output),outputBefore);
});


test('workbench mode is inert boolean only and synchronously exposes terminal relaunch', async () => {
 for (const value of [1, 'true', {}, null]) { const h=await injected(); await assert.rejects(h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state',workbenchMode:value}),/boolean workbench/); }
 let reads=0; const h=await injected(); const options={verifiedRuntime:h.fake,stateDir:'/tmp/no-full-copy-state'};
 Object.defineProperty(options,'workbenchMode',{get(){reads++;return true;}});await assert.rejects(h.api.createCandidateFullCopyService(options));assert.equal(reads,0);
 const k=await injected(),service=await k.api.createCandidateFullCopyService({verifiedRuntime:k.fake,stateDir:'/tmp/no-full-copy-state',workbenchMode:true});
 try { const values=[];service.on('update',v=>values.push(v));const cancelled=service.cancelCurrent();assert.equal(service.snapshot().developerFullCopy.relaunchRequired,true);assert.equal(values.at(-1).developerFullCopy.relaunchRequired,true);await cancelled; } finally {await service.closeOperationResources();}
});

test('actual workbench prepare and edit receipt awaits never expose compatibility authority or admit reentrant Start',async t=>{
 const os=require('node:os'),{PROFILES,classifyColor}=require('../src/media.cjs');
 const {buildEncodeOperation,withEncodeOperationTelemetry,fingerprintEncodeSource}=require('../src/encode-operation.cjs');
 const {isProportionalFamilySelection}=require('../src/operation-family.cjs');
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'full-copy-workbench-prepare-'));let service;
 t.after(async()=>{if(service){await service.cancelCurrent();await service.taskPromise;await service.closeOperationResources();await service.closeDiagnostics('completed');}await fs.rm(root,{recursive:true});});
 const input=path.join(root,'input'),output=path.join(root,'output'),state=path.join(root,'state');await Promise.all([input,output,state].map(p=>fs.mkdir(p)));
 const bytes=Buffer.from('synthetic non-media preparation fixture');await fs.writeFile(path.join(input,'source.mov'),bytes);
 const h=await injected();service=await h.api.createCandidateFullCopyService({verifiedRuntime:h.fake,stateDir:state,workbenchMode:true});
 // Actual shared prepare/edit and selector; factory/report/runtime/inspection,
 // storage eligibility and subsequent worker/runtime-token evidence are injected.
 service.cacheInjected=true;service.inspectionCache=null;service.storageEligibility={check:async()=>({eligible:true,reason:'Synthetic owned local fixture.'})};
 service.capabilities=async()=>({profiles:PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8,10]})),versions:{ffmpeg:'synthetic',ffprobe:'synthetic'}});
 const metadata=probe(bytes.length);service.inspect=async()=>({probe:structuredClone(metadata),color:classifyColor(metadata),duration:150,summary:{selectedVideoIndex:0,codec:'h264',width:1920,height:1080,bitDepth:8}});
 const inf=await service.registerFolder(input,'input'),outf=await service.registerFolder(output,'output');
 let release,arrived; const reached=new Promise(r=>arrived=r),pending=new Promise(r=>release=r);let hold='PREPARATION_FINISHED';
 service.recordIncident=async event=>{if(event.reason===hold){arrived();await pending;}};
 const updates=[];service.on('update',v=>{updates.push(v);for(const item of v.items)if(item.status==='ready')assert.equal(service.plan.entries.get(item.id)?.operationPlan?.compatibilityPath,false);});
 const preparing=service.prepareBatch({inputFolderId:inf.id,outputFolderId:outf.id,settings});await reached;
 assert.equal(service.busy,true);assert.throws(()=>service.startBatch({planId:service.plan.id,fileIds:[service.state.items[0].id]}));assert.equal(h.counts().invoked,0);release();
 const plan=await preparing;assert.equal(plan.items[0].status,'unsupported');assert.equal(plan.items[0].reasonCode,'CANDIDATE_FULL_COPY_REQUIRED');assert.equal(service.plan.entries.size,0);assert.equal(plan.operationDraft.files.length,1);assert.equal(plan.items[0].summary.width,1920);
 const fileId=plan.items[0].id;const draft=service.plan.draft;
 let releaseEdit,arriveEdit;const editReached=new Promise(r=>arriveEdit=r),editPending=new Promise(r=>releaseEdit=r);
 service.recordIncident=async event=>{if(event.reason==='DRAFT_REPREPARATION_FINISHED'){arriveEdit();await editPending;}};
 service.verifyFolders=async()=>{};
 service.prepareWithWorkers=async()=>{
  const source=probe(bytes.length),identity={canonicalPath:path.join(input,'source.mov'),dev:'1',ino:'2',size:String(bytes.length),mtimeNs:'1',ctimeNs:'1',birthtimeNs:'1',sparseDigest:'sha256-sparse-v1:'+H};
  const inspection={probe:source,color:classifyColor(source),duration:150},request=draft.fileRequest(fileId);
  const orientation=service.operationQualifications.orientationQualification({inspection,request,settings,runtimeIdentity:api.RUNTIME_ID});
  const op=withEncodeOperationTelemetry(buildEncodeOperation({...orientation,input:identity.canonicalPath,output:path.join(output,'out.mkv'),inspection,request,settings,runtimeIdentity:api.RUNTIME_ID}));
  const bindings={plan:op,sourceIdentity:identity,sourceProbeFingerprint:fingerprintEncodeSource(source),settings,runtimeIdentity:api.RUNTIME_ID,environment:null,budget:null,executionBudgetMs:120000};const token=service.operationQualifications.select(bindings);
  assert.equal(isProportionalFamilySelection(service.operationQualifications.requireCurrent(token,bindings)),true);
  service.plan.entries.set(fileId,{operationPlan:op,qualificationSelection:token,qualificationBindings:bindings,operationRuntimeToken:{}});service.state.items[0].status='ready';service.state.items[0].operationRequest=request;service.emitState();
 };
 const edit=service.updateFileOperations({planId:plan.planId,draftId:draft.id,revision:draft.snapshot().revision,fileIds:[fileId],overrides:{range:null,resolution:'720',audioPolicy:'copy'}});await editReached;
 assert.equal(service.busy,true);assert.throws(()=>service.startBatch({planId:service.plan.id,fileIds:[fileId]}));assert.equal(h.counts().invoked,0);releaseEdit();
 const next=await edit;assert.equal(next.items[0].status,'ready');assert.equal(next.items[0].operationRequest.range,null);assert.equal(next.items[0].operationRequest.resolution,'720');assert.equal(next.items[0].operationRequest.audioPolicy,'copy');
 const currentEntry=service.plan.entries.get(fileId);assert.ok(currentEntry.qualificationSelection);assert.notEqual(next.planId,plan.planId);assert.equal(service.snapshot().items[0].status,'ready');assert.equal(service.plan.entries.get(fileId),currentEntry);assert.equal(h.counts().invoked,0);
});
