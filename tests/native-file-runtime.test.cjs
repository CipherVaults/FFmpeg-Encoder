'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter,once}=require('node:events'),{PassThrough}=require('node:stream'),{createHash,randomUUID}=require('node:crypto');
const {NativeFileRuntimeOwner}=require('../src/native-file-runtime.cjs'),{NativeFileRuntimePair}=require('../src/native-file-runtime-pair.cjs');
const {NativeBackendService}=require('../src/native-backend-service.cjs'),{NativeCapabilityRegistry}=require('../src/backend-capabilities.cjs');
const {NATIVE_PROFILES,getNativeProfile,capabilityKey,nativeEncoderContribution}=require('../src/backend-adapters.cjs');
const {bindDiscoveryInventory}=require('../src/backend-observation.cjs'),{runTool}=require('../src/process-runner.cjs');
const {describeNativeFileSource,buildNativeFileContract}=require('../src/native-file-contract.cjs');
const {MARKER_KEY,OUTPUT_ID_KEY,GENERATION_KEY}=require('../src/provenance.cjs');
const {matroska,probeText}=require('./fixtures/native-file-fixtures.cjs');
const {buildNativeFileCommand}=require('../src/native-file-command.cjs');
const {inspectNativeFileTemplate}=require('../src/native-file-template.cjs');
const {nativeProbeRecord}=require('../src/native-file-oracle.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};},tick=()=>new Promise(r=>setImmediate(r));
// Synthetic bytes, native inventory and process children only. No media tool,
// DXGI/device or native encode runs; exact policy rows are injected test data.
async function fixture(t,changes={}){
  let owner;const root=await fs.mkdtemp(path.join(os.tmpdir(),'ffenc-native-runtime-'));t.after(async()=>{if(owner)await owner.close().catch(()=>{});assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('ffenc-native-runtime-'));await fs.rm(root,{recursive:true,force:true});});const ownedRoot=path.join(root,'out');await fs.mkdir(ownedRoot);
  const runtime={};for(const name of ['ffmpeg','ffprobe']){const file=path.join(root,name+'.exe'),data=Buffer.from('synthetic '+name+' bytes');await fs.writeFile(file,data);runtime[name]={file,sizeBytes:data.length,sha256:sha(data)};}
  const source=path.join(root,'source.mp4'),sourceBytes=Buffer.alloc(4096,37);await fs.writeFile(source,sourceBytes);
  const registry=new NativeCapabilityRegistry(),deviceId=randomUUID(),frames=15;let initialized=false,observations=0,slotReleases=0,slotAcquires=0;
  const device=()=>({id:deviceId,backend:'qsv',vendorId:'0x8086',adapterIndex:0,adapterIdentity:'dxgi:00000000:00000001',driverVersion:'32.0.1.2',runtimeVersion:initialized?'mfx-api:2.12':'unresolved'});
  const environment=()=>{
    const d=device(),environment={schema:1,evidenceId:randomUUID(),observedAt:Date.now(),runtime:Object.fromEntries(['ffmpeg','ffprobe'].map(name=>[name,{sha256:runtime[name].sha256,version:name+' version 9.0.2-test'}])),wrappers:Object.fromEntries(NATIVE_PROFILES.map(p=>[p.encoder,'present'])),inventory:{status:'complete',devices:[d]}};
    registry.observeDiscovery(environment);bindDiscoveryInventory(environment,{status:'complete',adapters:[{adapterIndex:0,description:'Test Intel',vendorId:0x8086,deviceId:0x1234,luid:'00000000:00000001',umdVersion:d.driverVersion,software:false,backendCandidate:'qsv'}]},registry);return environment;
  };
  const native=new NativeBackendService({registry,discover:async({run,signal})=>{observations++;if(run){try{await run(runtime.ffmpeg.file,changes.discoveryArgv||['-hide_banner','-encoders'],{signal,timeoutMs:20000,stdoutLimit:1024**2,stderrLimit:8192});}catch(error){if(!changes.swallowDiscovery||error.code==='CANCELLED'||signal?.aborted)throw error;}}return{registry,environment:environment()};},createProbe:()=>({initialize:async()=>{initialized=true;return{status:'observed',initialization:Object.freeze({testOnly:true}),invocations:[]};},probe:async({cellId})=>{
    const ticket=registry.beginProbe({cellId}),p=ticket.plan,profile=getNativeProfile(p.policy.profileId),observed=environment();
    const receipt=ticket.issueReceipt({outcome:'verified',reason:'VERIFIED',evidenceId:randomUUID(),environment:observed,lifecycle:{encode:'closed',decode:'closed'},validation:{invocationId:p.invocationId,contributionHash:p.contributionHash,argvSha256:'c'.repeat(64),fixtureSha256:'d'.repeat(64),warningCaptureComplete:true,unexpectedWarnings:0,modeSource:'runtime-log',actualMode:p.settings.mode,actualEncoder:profile.encoder,actualAdapterIdentity:p.policy.device.adapterIdentity,output:{codec:profile.encodedCodec,bitDepth:8,width:320,height:180,frames:96,decodedFrames:96,chroma:'4:2:0',signal:'sdr',primaries:'bt709',transfer:'bt709',matrix:'bt709',range:'tv',valid:true}}});
    const cell=registry.completeProbe({probeId:p.probeId,receipt});return{status:'verified',cell,cellId:cell.cellId,evidenceId:cell.evidenceId};
  }})});
  await native.refresh();native.select({revision:native.snapshot().revision,profileId:'h264-qsv',settings:{preset:'medium',mode:changes.mode||'icq',quality:changes.mode==='cqp'?{i:22,p:25,b:28}:25,deviceId},bitDepth:8});await native.qualify({selectionId:native.snapshot().selection.selectionId,revision:native.snapshot().revision});
  const selection=native.captureFileSelection({selectionId:native.snapshot().selection.selectionId,revision:native.snapshot().revision});
  const request={schema:1,kind:'native-file',operation:'encode',fileId:randomUUID(),identityRevision:0,draftId:randomUUID(),draftRevision:0,profileId:'h264-qsv',settings:selection.request.settings,bitDepth:8,target:'matroska',resolution:'source',range:null,signal:'sdr',hdrPolicy:'sdr',audioPolicy:'copy',omissionRequestIds:[]};
  const probe={streams:[{index:7,codec_type:'video',codec_name:'h264',profile:'High',width:1280,height:720,pix_fmt:'yuv420p',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',field_order:'progressive',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',color_range:'tv',chroma_location:'left',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/15360',start_pts:0,start_time:'0.000000',duration_ts:frames*512,duration:'0.500000',nb_frames:String(frames),disposition:{default:1},tags:{}}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',nb_streams:1,size:'4096',start_time:'0.000000',duration:'0.500000'},chapters:[],programs:[],stream_groups:[]};
  if(changes.generated)probe.format.tags={[MARKER_KEY]:'1',[OUTPUT_ID_KEY]:randomUUID()};
  const applicability=describeNativeFileSource({probe,sourceBytes:'4096',request}),contract=buildNativeFileContract({request,applicability}),f=nativeEncoderContribution('h264-qsv',{preset:'medium',mode:request.settings.mode,quality:request.settings.quality},{bitDepth:8});
  const generationDescription={version:2,kind:'native-encoder',adapterPolicyVersion:1,profileId:'h264-qsv',codec:'H264',backend:'qsv',encoder:'h264_qsv',preset:'medium',qualityMode:request.settings.mode.toUpperCase(),quality:structuredClone(f.settings.quality),bitDepth:8,pipelineId:f.pipelineId,encoderArgs:[...f.args],settingsRole:'requested',scope:'native-encoder-contribution-only',appVersion:'0.7.0-alpha.1',createdAt:'2026-10-26T12:00:00.000Z'};
  const pair=new NativeFileRuntimePair(runtime),policy={id:'synthetic-test-only',contractId:contract.id,runtimeIdentity:pair.identity(),sourceSha256:sha(sourceBytes),sourceProbeFingerprint:contract.sourceProbeFingerprint,nativeCellKey:capabilityKey(selection.policy),profileId:'h264-qsv',settings:request.settings,budget:{maximumChildren:32,maximumPipeBytes:128*1024**2,deadlineMs:30000,maximumStageBytes:changes.maximumStageBytes||1024**2,metadataBytes:1024**2,nativeStderrBytes:262144},evidenceIds:['synthetic-fixture-not-hardware-proof']};
  const calls=[],encodeEntered=deferred(),releaseEncode=deferred(),encoded={};let encodeChild;
  const spawn=(executable,argv,spawnOptions)=>{
    assert.equal(spawnOptions.shell,false);assert.equal(spawnOptions.windowsHide,true);calls.push({executable,argv:argv.slice()});
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.kills=(child.kills||0)+1;return true;};
    setImmediate(async()=>{try{
      if(argv.includes('-encoders'))child.stdout.write('Encoders:\n V..... h264_qsv\n');
      else if(argv.includes('-c:v:0')){
        encodeChild=child;encodeEntered.resolve();if(changes.holdEncode)await releaseEncode.promise;
        if(changes.matroska){const meta=key=>argv[argv.findIndex((a,i)=>argv[i-1]==='-metadata'&&a.startsWith(key+'='))].slice(key.length+1);
          encoded.outputId=meta(OUTPUT_ID_KEY);encoded.generationDescription=JSON.parse(meta(GENERATION_KEY));encoded.bytes=matroska(encoded,changes.matroskaEdits);await fs.writeFile(argv.at(-1),encoded.bytes);}
        else await fs.writeFile(argv.at(-1),Buffer.alloc(changes.stageBytes||64,51));
        const mode=request.settings.mode==='cqp'?'CQP':'ICQ';let log='[AVHWDeviceContext @ aaaa] [verbose] Selecting d3d11va adapter 0\n[AVHWDeviceContext @ aaaa] [info] Using device 8086:1234 (Test Intel).\n[AVHWDeviceContext @ bbbb] [verbose] Initialize MFX session: implementation version is 2.12\n[h264_qsv @ cccc] [verbose] TargetUsage: 4; RateControlMethod: '+mode+'\n';
        log+=mode==='CQP'?'[h264_qsv @ cccc] [verbose] QPI: 22; QPP: 25; QPB: 28\n':'[h264_qsv @ cccc] [verbose] ICQQuality: 25\n';
        child.stderr.write(changes.log||log);child.stdout.write('frame=15\nout_time_us=500000\nprogress=end\n');
      }else if(executable===runtime.ffprobe.file){if(changes.matroska){const output=argv.at(-1)!==source;child.stdout.write(probeText(output?{role:'output',command:encoded,frames,bytes:encoded.bytes.length,filename:argv.at(-1)}:{role:'source',command:encoded,frames,index:7,filename:argv.at(-1)}));}else child.stdout.write(JSON.stringify({streams:[],frames:[],format:{}}));}
      else if(argv.includes('rawvideo')){const frame=Buffer.alloc(1280*720*3/2,argv[argv.indexOf('-i')+1]===source?37:51);for(let i=0;i<(changes.rawFrames??frames);i++)if(!child.stdout.write(frame))await once(child.stdout,'drain');}
      const ended=Promise.all([once(child.stdout,'end'),once(child.stderr,'end')]);child.stdout.end();child.stderr.end();await ended;child.emit('close',0,null);
    }catch(error){child.emit('error',error);child.stdout.destroy();child.stderr.destroy();child.emit('close',1,null);}});
    return child;
  };
  const run=(executable,argv,options)=>runTool(executable,argv,{...options,spawnImpl:spawn});
  const leaseEntered=deferred(),releaseLease=deferred(),releaseStates=[];let releaseFailed=false;
  const config={runtime,nativeSelections:native,ownedRoot,acquireMediaSlot:async()=>{slotAcquires++;leaseEntered.resolve();if(changes.holdLease)await releaseLease.promise;return changes.invalidLease?{}:{release:async()=>{if(changes.releaseFailOnce&&!releaseFailed){releaseFailed=true;throw Object.assign(new Error('Synthetic transient release failure.'),{code:'EBUSY'});}slotReleases++;releaseStates.push(owner.snapshot());}};},run};
  owner=new NativeFileRuntimeOwner({...config,...(changes.defaultPolicies?{}:{policies:[policy]})});
  return{root,ownedRoot,runtime,native,selection,contract,source,policy,config,owner,calls,encodeEntered,releaseEncode,leaseEntered,releaseLease,get encodeChild(){return encodeChild;},get slotAcquires(){return slotAcquires;},get slotReleases(){return slotReleases;},get observations(){return observations;},releaseStates,registry,generationDescription,frames,encoded,prepare:()=>owner.prepare({contract,input:source,selection,outputId:randomUUID(),generationDescription})};
}
test('production policy catalog is empty and refuses before any lease, file, discovery or child work',async t=>{
  const h=await fixture(t,{defaultPolicies:true}),before=h.observations;await assert.rejects(h.prepare(),{code:'NATIVE_FILE_POLICY_REQUIRED'});assert.equal(h.slotAcquires,0);assert.equal(h.observations,before);assert.equal(h.calls.length,0);await h.owner.close();assert.equal(h.owner.snapshot().runtime.heldTools,0);
});
test('real builder/source/tool lifecycle and actual emitted ICQ log yield only an owned unqualified effective receipt',async t=>{
  const h=await fixture(t),token=await h.prepare();assert.equal(h.owner.describe(token).command.input,h.source);assert.equal(h.owner.snapshot().leaseHeld,true);const result=await h.owner.encode(token);assert.equal(h.owner.requireEffective(token,result),result);assert.equal(result.observation.actualMode,'icq');assert.equal(result.executionAuthority,'none');assert.equal(h.owner.snapshot().phase,'evidence');assert.throws(()=>h.owner.requireEffective(token,{...result}),{code:'NATIVE_FILE_EVIDENCE_UNOWNED'});await assert.rejects(h.owner.encode(token),{code:'NATIVE_FILE_PHASE'});await h.owner.close();assert.equal(h.slotReleases,1);assert.equal(h.owner.snapshot().runtime.heldTools,0);assert.equal(h.owner.snapshot().sourceHeld,false);assert.equal(h.owner.snapshot().stageRetained,true);assert.equal(h.calls.filter(c=>c.argv.includes('-c:v:0')).length,1);
});
test('complete CQP source/output raw streaming joins real sink/EOF and retains metadata separately from validation',async t=>{
  const h=await fixture(t,{mode:'cqp'}),token=await h.prepare();let sourceBytes=0,outputBytes=0;
  const src=await h.owner.collect(token,'source-raw',{onStdoutChunk:async b=>{sourceBytes+=b.length;}});assert.equal(src.bytes,15*1280*720*3/2);assert.equal(src.validation,'not-performed');assert.equal(h.owner.requireEvidence(token,'source-raw',src),src);assert.throws(()=>h.owner.requireEvidence(token,'source-raw',{...src}),{code:'NATIVE_FILE_EVIDENCE_UNOWNED'});
  await h.owner.collect(token,'source-metadata');await h.owner.encode(token);await h.owner.collect(token,'output-metadata');const out=await h.owner.collect(token,'output-raw',{onStdoutChunk:async b=>{outputBytes+=b.length;}});assert.equal(outputBytes,sourceBytes);assert.notEqual(src.sha256,out.sha256);assert.equal(src.sha256,sha(Buffer.alloc(sourceBytes,37)));assert.equal(out.sha256,sha(Buffer.alloc(outputBytes,51)));assert.throws(()=>h.owner.requireEvidence(token,'output-raw',src),{code:'NATIVE_FILE_EVIDENCE_UNOWNED'});await assert.rejects(h.owner.collect(token,'output-metadata'),{code:'NATIVE_FILE_EVIDENCE_REQUEST'});await h.owner.close();assert.equal(h.slotReleases,1);
});
test('active cancellation retains lease/source/tool handles until actual child close and sink drainage',async t=>{
  const h=await fixture(t,{holdEncode:true}),token=await h.prepare(),work=h.owner.encode(token),rejected=assert.rejects(work,{code:'CANCELLED'});await h.encodeEntered.promise;
  const closing=h.owner.close();await tick();assert.equal(h.slotReleases,0);assert.equal(h.owner.snapshot().sourceHeld,true);assert.equal(h.owner.snapshot().runtime.heldTools,2);assert.ok(h.encodeChild.kills>0);h.releaseEncode.resolve();await rejected;await closing;assert.equal(h.slotReleases,1);assert.equal(h.owner.snapshot().runtime.heldTools,0);
});
test('oversized closed output remains retained after refusal and cleanup',async t=>{
  const h=await fixture(t,{maximumStageBytes:8,stageBytes:64}),token=await h.prepare(),stage=h.owner.describe(token).command.output;await assert.rejects(h.owner.encode(token),{code:'NATIVE_FILE_STAGE_LIMIT'});await h.owner.close();assert.equal((await fs.stat(stage)).size,64);assert.equal(h.slotReleases,1);assert.equal(h.owner.snapshot().stageRetained,true);
});
test('source change and stale native selection refuse encoder admission without fallback',async t=>{
  const h=await fixture(t),token=await h.prepare();await fs.writeFile(h.source,Buffer.alloc(4096,44));await assert.rejects(h.owner.encode(token),{code:'NATIVE_SOURCE_CHANGED'});assert.equal(h.calls.filter(c=>c.argv.includes('-c:v:0')).length,0);await h.owner.close();assert.equal(h.slotReleases,1);
  const other=await fixture(t),otherToken=await other.prepare();await other.native.invalidate();await assert.rejects(other.owner.encode(otherToken),{code:'NATIVE_FILE_SELECTION_STALE'});assert.equal(other.calls.filter(c=>c.argv.includes('-c:v:0')).length,0);
});
test('mismatched held binary pins and native selection refuse before lease/children',async t=>{
  const h=await fixture(t),other=Buffer.from('different ffmpeg');await fs.writeFile(h.runtime.ffmpeg.file,other);const runtime={...h.runtime,ffmpeg:{file:h.runtime.ffmpeg.file,sizeBytes:other.length,sha256:sha(other)}};
  const owner=new NativeFileRuntimeOwner({...h.config,runtime,policies:[{...h.policy,runtimeIdentity:new NativeFileRuntimePair(runtime).identity()}]});await assert.rejects(owner.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:{}}),{code:'NATIVE_FILE_SELECTION_STALE'});assert.equal(h.slotAcquires,0);assert.equal(h.calls.length,0);await owner.close();
});
test('incomplete decoded frame volume refuses evidence and source stays completion-only',async t=>{
  const h=await fixture(t,{rawFrames:14}),token=await h.prepare();await h.owner.encode(token);await assert.rejects(h.owner.collect(token,'output-raw',{onStdoutChunk:()=>{}}),{code:'NATIVE_FILE_FRAME_BYTES'});await h.owner.close();assert.equal(h.slotReleases,1);
});
test('runtime pair full hashes match and ordinary handle/path replacement refuses',async t=>{
  const h=await fixture(t),pair=new NativeFileRuntimePair(h.runtime);await pair.open();assert.equal(pair.snapshot().heldTools,2);await pair.requireCurrent({invocation:true});await fs.writeFile(h.runtime.ffprobe.file,Buffer.from('modified exact-size pin'));await assert.rejects(pair.requireCurrent(),{code:'NATIVE_RUNTIME_STALE'});await pair.close();assert.equal(pair.snapshot().heldTools,0);
});
test('generated source consent cannot be supplied by an exact source policy',async t=>{
  const h=await fixture(t,{generated:true});await assert.rejects(h.prepare(),{code:'NATIVE_FILE_SOURCE_PERMISSION_REQUIRED'});assert.equal(h.slotAcquires,0);assert.equal(h.calls.length,0);
});
test('partial pair-open failure closes every known source/tool handle before releasing the lease',async t=>{
  const h=await fixture(t);await fs.writeFile(h.runtime.ffprobe.file,Buffer.from('changed second pin'));await assert.rejects(h.prepare(),{code:'NATIVE_RUNTIME_STALE'});assert.equal(h.owner.snapshot().runtime.heldTools,0);assert.equal(h.owner.snapshot().sourceHeld,false);assert.equal(h.slotReleases,1);assert.equal(h.calls.length,0);
});
test('preparation cancellation waits an admitted lease provider and releases once without source/child work',async t=>{
  const h=await fixture(t,{holdLease:true}),work=h.prepare(),rejected=assert.rejects(work,{code:'CANCELLED'});await h.leaseEntered.promise;const closing=h.owner.close();await tick();assert.equal(h.slotReleases,0);assert.equal(h.owner.snapshot().sourceHeld,false);h.releaseLease.resolve();await rejected;await closing;assert.equal(h.slotReleases,1);assert.equal(h.calls.length,0);
});
test('an invalid lease provider return never becomes a false released-owner claim',async t=>{
  const h=await fixture(t,{invalidLease:true});await assert.rejects(h.prepare(),{code:'NATIVE_FILE_LEASE_REQUIRED'});assert.equal(h.owner.snapshot().leaseOwnershipUnknown,true);assert.equal(h.slotReleases,0);await assert.rejects(h.owner.close(),/lease remains|ownership is unconfirmed/);
});

test('same-size tampered ffprobe bytes refuse by complete SHA-256 before any child, releasing the lease after handles close',async t=>{
  const h=await fixture(t),original=await fs.readFile(h.runtime.ffprobe.file),tampered=Buffer.from(original);tampered[0]^=0xff;await fs.writeFile(h.runtime.ffprobe.file,tampered);
  await assert.rejects(h.prepare(),{code:'NATIVE_RUNTIME_STALE'});assert.equal(h.calls.length,0);assert.equal(h.owner.snapshot().sourceHeld,false);assert.equal(h.owner.snapshot().runtime.heldTools,0);
  assert.equal(h.slotReleases,1);assert.equal(h.releaseStates[0].sourceHeld,false);assert.equal(h.releaseStates[0].runtime.heldTools,0);
});

test('every policy binding field is authoritative: one mismatch refuses before the lease or before any child',async t=>{
  const base=await fixture(t);
  const mismatches={runtimeIdentity:'e'.repeat(64),sourceProbeFingerprint:'f'.repeat(64),nativeCellKey:'native-v1:'+'a'.repeat(64),profileId:'h264-amf',settings:{...base.policy.settings,quality:30}};
  for(const [key,value] of Object.entries(mismatches)){
    const before=base.slotAcquires;let owner;
    try{owner=new NativeFileRuntimeOwner({...base.config,policies:[{...base.policy,[key]:value}]});}catch(error){assert.match(error.code,/^INVALID_NATIVE_(FILE_RUNTIME|SETTINGS)$/,key);assert.equal(base.slotAcquires,before,key);continue;}
    await assert.rejects(owner.prepare({contract:base.contract,input:base.source,selection:base.selection,outputId:randomUUID(),generationDescription:{}}),error=>['NATIVE_FILE_POLICY_REQUIRED','INVALID_NATIVE_FILE_RUNTIME'].includes(error.code),key);
    assert.equal(base.slotAcquires,before,key);await owner.close();
  }
  const duplicate=new NativeFileRuntimeOwner({...base.config,policies:[base.policy,{...base.policy,id:'synthetic-duplicate'}]});
  await assert.rejects(duplicate.prepare({contract:base.contract,input:base.source,selection:base.selection,outputId:randomUUID(),generationDescription:{}}),{code:'NATIVE_FILE_POLICY_REQUIRED'});await duplicate.close();
  const h=await fixture(t,{}),wrongSource=new NativeFileRuntimeOwner({...h.config,policies:[{...h.policy,sourceSha256:'0'.repeat(64)}]});
  await assert.rejects(wrongSource.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:{}}),{code:'NATIVE_FILE_SOURCE_UNQUALIFIED'});
  assert.equal(h.calls.length,0);assert.equal(h.slotReleases,1);assert.equal(h.releaseStates[0].sourceHeld,false);await wrongSource.close();
});

test('a failed session makes the owner single-use instead of silently busy',async t=>{
  const h=await fixture(t,{invalidLease:false});await fs.writeFile(h.runtime.ffprobe.file,Buffer.from('changed second pin'));
  await assert.rejects(h.prepare(),{code:'NATIVE_RUNTIME_STALE'});assert.equal(h.owner.snapshot().admissionClosed,true);
  await assert.rejects(h.prepare(),{code:'NATIVE_FILE_RUNTIME_CLOSED'});
});

test('owner-side discovery refusals never reach the shared registry as an incomplete environment',async t=>{
  const h=await fixture(t,{discoveryArgv:['-hide_banner','-version'],swallowDiscovery:true}),registryBefore=JSON.stringify(h.registry.snapshot()),observations=h.observations;
  await assert.rejects(h.prepare(),{code:'NATIVE_FILE_DISCOVERY_COMMAND'});
  // The service conservatively drops its selection on any failed file discovery; the shared
  // capability registry (epoch, cells, devices) must stay exactly as it was.
  assert.equal(JSON.stringify(h.registry.snapshot()),registryBefore);assert.ok(h.observations>observations);assert.equal(h.calls.length,0);assert.equal(h.slotReleases,1);
});

test('suspicious source provenance also requires a separate source-admission owner',async t=>{
  const h=await fixture(t,{generated:true});
  await assert.rejects(h.prepare(),{code:'NATIVE_FILE_SOURCE_PERMISSION_REQUIRED'});assert.equal(h.slotAcquires,0);assert.equal(h.calls.length,0);
});

// Independent "qualification" of the exact reference: a genuine command with the
// same requested settings but its own UUID/createdAt, the same synthetic encoder
// output, the complete probe records and decoded-frame hashes.
function referenceFor(h,overrides={}){
  const command=buildNativeFileCommand({contract:h.contract,input:'D:\\qualification\\source.mp4',output:'F:\\qualification\\stage.mkv',device:h.selection.policy.device,
    outputId:randomUUID(),generationDescription:{...h.generationDescription,createdAt:'2026-10-01T00:00:00.000Z'}});
  const bytes=matroska(command),template=inspectNativeFileTemplate(bytes,command),frameBytes=1280*720*3/2;
  const raw=fill=>{const hash=createHash('sha256'),frame=Buffer.alloc(frameBytes,fill);for(let i=0;i<h.frames;i++)hash.update(frame);return hash.digest('hex');};
  const s=nativeProbeRecord(probeText({role:'source',command,frames:h.frames,index:7}),{role:'source-metadata',contract:h.contract,command});
  const o=nativeProbeRecord(probeText({role:'output',command,frames:h.frames,bytes:bytes.length}),{role:'output-metadata',contract:h.contract,command});
  return {version:1,id:'synthetic-qualified-reference',contractId:h.contract.id,frames:h.frames,
    source:{fileSha256:h.policy.sourceSha256,rawSha256:raw(37),metadataSha256:s.metadataSha256,timelineSha256:s.timelineSha256},
    output:{rawSha256:raw(51),metadataSha256:o.metadataSha256,timelineSha256:o.timelineSha256,templateSha256:template.templateSha256,templateManifestSha256:template.manifestSha256,templateBytes:template.bytes},
    proof:{evidenceIds:['synthetic-qualification'],reportSha256:sha('synthetic qualification report')},...overrides};
}
async function lifecycle(t,{reference=true,edit}={}){
  const h=await fixture(t,{matroska:true});await h.owner.close();
  const owner=new NativeFileRuntimeOwner({...h.config,policies:[{...h.policy,...(reference?{reference:edit?edit(referenceFor(h)):referenceFor(h)}:{})}]});
  t.after(()=>owner.close().catch(()=>{}));
  const token=await owner.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:h.generationDescription});
  for(const kind of ['source-metadata','source-raw'])await owner.collect(token,kind,kind.endsWith('raw')?{onStdoutChunk:()=>{}}:{});
  await owner.encode(token);
  for(const kind of ['output-metadata','output-raw'])await owner.collect(token,kind,kind.endsWith('raw')?{onStdoutChunk:()=>{}}:{});
  return {h,owner,token};
}

test('exact-reference validation then publication publishes the validated bytes once, without overwrite',async t=>{
  const {h,owner,token}=await lifecycle(t);
  const checked=await owner.validate(token);
  assert.equal(checked.kind,'native-file-output-checked');assert.equal(checked.executionAuthority,'none');assert.equal(checked.checks.length,7);
  await assert.rejects(owner.publish(token,{...checked},{destination:path.join(h.root,'published.mkv')}),{code:'NATIVE_FILE_EVIDENCE_UNOWNED'});
  for(const destination of ['relative.mkv','\\\\server\\share\\x.mkv',path.join(h.root,'x.mp4'),path.join(h.root,'missing-dir','x.mkv'),path.join(h.ownedRoot,'inside.mkv'),path.join(h.root,'x.mkv:ads')])
    await assert.rejects(owner.publish(token,checked,{destination}),{code:'NATIVE_FILE_DESTINATION'},destination);
  const destination=path.join(h.root,'published.mkv'),result=await owner.publish(token,checked,{destination});
  assert.equal(result.published,true);assert.equal(result.sha256,checked.outputSha256);assert.equal(result.sourceDisposition,'unchanged');
  assert.equal(sha(await fs.readFile(destination)),checked.outputSha256);
  await assert.rejects(owner.publish(token,checked,{destination}),{code:'NATIVE_FILE_EVIDENCE_UNOWNED'});
  await owner.close();assert.equal(sha(await fs.readFile(destination)),checked.outputSha256);
});

test('no qualified reference: validation refuses and the sealed output stays retained, unpublished',async t=>{
  const {owner,token}=await lifecycle(t,{reference:false});
  await assert.rejects(owner.validate(token),{code:'NATIVE_FILE_REFERENCE_REQUIRED'});
  const closed=await owner.close();assert.equal(closed.leaseHeld,false);
});

test('a reference mismatch fails the session; nothing can be published from it',async t=>{
  const {h,owner,token}=await lifecycle(t,{edit:r=>({...r,output:{...r.output,rawSha256:'0'.repeat(64)}})});
  await assert.rejects(owner.validate(token),{code:'NATIVE_ORACLE_RAW'});
  await assert.rejects(owner.publish(token,{},{destination:path.join(h.root,'never.mkv')}),{code:'NATIVE_FILE_SESSION_STALE'});
  await assert.rejects(fs.access(path.join(h.root,'never.mkv')));
});

test('an existing destination is never overwritten and the validated output stays retained',async t=>{
  const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'taken.mkv');
  await fs.writeFile(destination,'owner file');
  const result=await owner.publish(token,checked,{destination});assert.equal(result.published,false);assert.equal(result.outputRetained,true);
  assert.equal(await fs.readFile(destination,'utf8'),'owner file');
});

test('a source change after validation blocks publication',async t=>{
  const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'blocked.mkv');
  await fs.writeFile(h.source,Buffer.alloc(4096,99));
  await assert.rejects(owner.publish(token,checked,{destination}),error=>/^NATIVE_SOURCE_(CHANGED|STALE)$/.test(error.code));
  await assert.rejects(fs.access(destination));
});

// Test-only fault injection: handles opened while active reject their close()
// after really closing (FileHandle.close is an own property, so wrap at open).
function failingCloses(t,{armed=true}={}){const original=fs.open;let active=armed;
  fs.open=async(...args)=>{const handle=await original(...args),close=handle.close.bind(handle);handle.close=async()=>{await close();if(active)throw Object.assign(new Error('Synthetic close failure.'),{code:'EIO'});};return handle;};
  t.after(()=>{fs.open=original;});return{arm(){active=true;},stop(){active=false;}};}

test('a transient post-barrier release failure can be retried by a later close, releasing exactly once',async t=>{
  const h=await fixture(t,{releaseFailOnce:true}),token=await h.prepare();assert.ok(token);
  await assert.rejects(h.owner.close(),/lease remains retained|closure is incomplete/);assert.equal(h.slotReleases,0);
  const closed=await h.owner.close();assert.equal(h.slotReleases,1);assert.equal(closed.leaseHeld,false);assert.equal(closed.sourceHeld,false);
  await h.owner.close();assert.equal(h.slotReleases,1);
});

test('a source handle whose release failed stays held and keeps the lease across close retries',async t=>{
  const h=await fixture(t),faults=failingCloses(t,{armed:false}),token=await h.prepare();assert.ok(token);faults.arm();
  await assert.rejects(h.owner.close());faults.stop();
  await assert.rejects(h.owner.close());await assert.rejects(h.owner.close());
  assert.equal(h.slotReleases,0);assert.equal(h.owner.snapshot().leaseHeld,true);
});

test('a failed seal whose handle close also fails keeps the media lease',async t=>{
  const h=await fixture(t);failingCloses(t);
  await assert.rejects(h.prepare(),error=>error.sourceCloseFailure?.code==='EIO');
  assert.equal(h.slotReleases,0);assert.equal(h.owner.snapshot().leaseHeld,true);await assert.rejects(h.owner.close());assert.equal(h.slotReleases,0);
});

test('a runtime pair handle whose close failed is never reported closed',async t=>{
  const h=await fixture(t),faults=failingCloses(t),pair=new NativeFileRuntimePair(h.runtime);await pair.open();
  await assert.rejects(pair.close());faults.stop();await assert.rejects(pair.close());assert.equal(pair.snapshot().heldTools,2);
});

test('NF-C2: the pure admission check names exactly the first code prepare throws, without lease or child work',async t=>{
  const {assessNativeFileAdmission}=require('../src/native-file-runtime.cjs');
  const check=async(h,policies,expected)=>{
    const assessed=assessNativeFileAdmission({policies,runtime:h.runtime,contract:h.contract,selection:h.native.requireFileSelection(h.selection)});
    assert.equal(assessed.reasonCodes[0],expected);assert.equal(assessed.admissible,false);assert.equal(assessed.executionAuthority,'none');
    const owner=new NativeFileRuntimeOwner({...h.config,policies});
    await assert.rejects(owner.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:h.generationDescription}),{code:expected});await owner.close();
  };
  const h=await fixture(t);
  await check(h,[],'NATIVE_FILE_POLICY_REQUIRED');
  await check(h,[{...h.policy,settings:{...h.policy.settings,quality:24}}],'NATIVE_FILE_POLICY_REQUIRED');
  const generated=await fixture(t,{generated:true});await check(generated,[generated.policy],'NATIVE_FILE_SOURCE_PERMISSION_REQUIRED');
  assert.equal(h.slotAcquires,0);assert.equal(generated.slotAcquires,0);assert.equal(h.calls.length,0);
  const ok=assessNativeFileAdmission({policies:[h.policy],runtime:h.runtime,contract:h.contract,selection:h.native.requireFileSelection(h.selection)});
  assert.deepEqual([ok.admissible,ok.policyId,ok.referencePresent],[true,h.policy.id,false]);
  assert.deepEqual(assessNativeFileAdmission({policies:[h.policy],runtime:h.runtime,contract:h.contract}).reasonCodes,['NATIVE_SELECTION_REQUIRED']);
  assert.throws(()=>assessNativeFileAdmission({policies:[h.policy],runtime:h.runtime,contract:h.contract,run(){}}),{code:'INVALID_NATIVE_FILE_RUNTIME'});
});

test('NF-C5: the publication receipt carries the checked published identity (R2)',async t=>{
  const {readSourceIdentity}=require('../src/source-identity.cjs');
  const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'identity.mkv');
  const result=await owner.publish(token,checked,{destination});
  const now=await readSourceIdentity(destination);
  for(const key of ['canonicalPath','dev','ino','size'])assert.equal(result.identity[key],now[key],key);
});

test('R4: the owned root stamped at lease time cannot be swapped before the encoder starts',async t=>{
  const h=await fixture(t),token=await h.prepare();
  await fs.rm(h.ownedRoot,{recursive:true,force:true});await fs.mkdir(h.ownedRoot);
  await assert.rejects(h.owner.encode(token),{code:'NATIVE_FILE_STAGE_CHANGED'});assert.equal(h.calls.filter(c=>c.argv.includes('-c:v:0')).length,0);
});

// Test-only spy: counts complete source seals (the first full-source hash).
function spySeal(t){const {NativeFileSourceOwner}=require('../src/native-file-source.cjs'),original=NativeFileSourceOwner.prototype.seal;let calls=0;
  NativeFileSourceOwner.prototype.seal=function(...args){calls++;return original.apply(this,args);};t.after(()=>{NativeFileSourceOwner.prototype.seal=original;});return{get calls(){return calls;}};}

test('NF-C6: R3 runs the callback after publication currentness and before the link, and records publication and stage facts',async t=>{
  const {NativeFileSourceOwner}=require('../src/native-file-source.cjs');
  const h=await fixture(t);assert.deepEqual([h.owner.snapshot().stageState,h.owner.snapshot().publication],['none','not-attempted']);
  await h.prepare();assert.equal(h.owner.snapshot().stageState,'unsealed');await h.owner.close();
  const {owner,token,h:l}=await lifecycle(t);assert.deepEqual([owner.snapshot().stageState,owner.snapshot().publication],['sealed','not-attempted']);
  const checked=await owner.validate(token);assert.equal(owner.snapshot().stageState,'validated');
  const destination=path.join(l.root,'r3.mkv'),order=[],current=NativeFileSourceOwner.prototype.requirePublicationCurrent,link=fs.link;
  await assert.rejects(owner.publish(token,checked,{destination,requireDestinationCurrent:'not a function'}),{code:'INVALID_NATIVE_FILE_RUNTIME'});
  NativeFileSourceOwner.prototype.requirePublicationCurrent=async function(...args){order.push('publication-current');return current.apply(this,args);};
  fs.link=async(...args)=>{order.push('link');return link(...args);};
  let result;
  try{result=await owner.publish(token,checked,{destination,requireDestinationCurrent:async(...args)=>{const s=owner.snapshot();order.push(['callback',args.length,s.phase,s.publication]);await assert.rejects(fs.access(destination));}});}
  finally{NativeFileSourceOwner.prototype.requirePublicationCurrent=current;fs.link=link;}
  assert.deepEqual(order,['publication-current',['callback',0,'source-assessed','not-attempted'],'link']);
  assert.equal(result.published,true);assert.equal(owner.snapshot().publication,'verified');
});

test('NF-C6: a failed recheck, a cancel, a removed or swapped folder refuses before the link; a link error and a collision are recorded',async t=>{
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'refused.mkv');
    await assert.rejects(owner.publish(token,checked,{destination,requireDestinationCurrent:async()=>{throw Object.assign(new Error('Synthetic folder change.'),{code:'OUTPUT_FOLDER_CHANGED'});}}),{code:'OUTPUT_FOLDER_CHANGED'});
    await assert.rejects(fs.access(destination));assert.deepEqual([owner.snapshot().publication,owner.snapshot().stageState,owner.snapshot().stageRetained],['not-attempted','validated',true]);}
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'cancelled.mkv'),controller=new AbortController();
    await assert.rejects(owner.publish(token,checked,{destination,signal:controller.signal,requireDestinationCurrent:async()=>{controller.abort();}}),{code:'CANCELLED'});
    await assert.rejects(fs.access(destination));assert.equal(owner.snapshot().publication,'not-attempted');}
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),folder=path.join(h.root,'outdir');await fs.mkdir(folder);
    await assert.rejects(owner.publish(token,checked,{destination:path.join(folder,'gone.mkv'),requireDestinationCurrent:async()=>{await fs.rm(folder,{recursive:true});}}),{code:'NATIVE_FILE_DESTINATION'});
    assert.equal(owner.snapshot().publication,'not-attempted');}
  // An ordinary folder renamed into place after main's check (no junction involved).
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),folder=path.join(h.root,'ordinary'),substitute=path.join(h.root,'substitute');await fs.mkdir(folder);await fs.mkdir(substitute);
    await assert.rejects(owner.publish(token,checked,{destination:path.join(folder,'swap.mkv'),requireDestinationCurrent:async()=>{await fs.rename(folder,folder+'-moved');await fs.rename(substitute,folder);}}),{code:'NATIVE_FILE_DESTINATION'});
    assert.equal(owner.snapshot().publication,'not-attempted');assert.deepEqual(await fs.readdir(folder),[]);}
  if(process.platform==='win32'){const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),folder=path.join(h.root,'swapped');await fs.mkdir(folder);
    await assert.rejects(owner.publish(token,checked,{destination:path.join(folder,'junction.mkv'),requireDestinationCurrent:async()=>{await fs.rename(folder,folder+'-moved');await fs.symlink(h.ownedRoot,folder,'junction');}}),{code:'NATIVE_FILE_DESTINATION'});
    assert.equal(owner.snapshot().publication,'not-attempted');await assert.rejects(fs.access(path.join(h.ownedRoot,'junction.mkv')));await fs.unlink(folder);}
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'eio.mkv'),link=fs.link;
    fs.link=async()=>{throw Object.assign(new Error('Synthetic link failure.'),{code:'EIO'});};
    try{await assert.rejects(owner.publish(token,checked,{destination,requireDestinationCurrent:async()=>{}}),{code:'EIO'});}finally{fs.link=link;}
    assert.equal(owner.snapshot().publication,'attempted');await assert.rejects(fs.access(destination));}
  {const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'taken-r3.mkv');await fs.writeFile(destination,'owner file');
    const result=await owner.publish(token,checked,{destination,requireDestinationCurrent:async()=>{}});assert.equal(result.published,false);
    assert.equal(owner.snapshot().publication,'collision');assert.equal(await fs.readFile(destination,'utf8'),'owner file');}
});

test('NF-C6: a readback mismatch after the link leaves publication committed and the destination in place',async t=>{
  const fsSync=require('node:fs'),{Readable}=require('node:stream');
  const {h,owner,token}=await lifecycle(t),checked=await owner.validate(token),destination=path.join(h.root,'committed.mkv'),original=fsSync.createReadStream;
  fsSync.createReadStream=(file,options)=>file===destination?Readable.from([Buffer.from('different bytes')]):original(file,options);
  try{await assert.rejects(owner.publish(token,checked,{destination,requireDestinationCurrent:async()=>{}}),{code:'NATIVE_FILE_PUBLISHED_CHANGED'});}finally{fsSync.createReadStream=original;}
  assert.equal(owner.snapshot().publication,'committed');assert.equal(sha(await fs.readFile(destination)),checked.outputSha256);
});

test('R4: a production job runs main\'s lease checks while holding the slot, then compares its first root stamp with the lease pin',async t=>{
  const {createNativeFileRuntimeJob}=require('../src/native-file-runtime.cjs'),seal=spySeal(t);
  const h=await fixture(t);await h.owner.close();const config={...h.config,policies:[h.policy]},admitLease=async()=>{};
  const request=()=>({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:h.generationDescription});
  const stamp=async()=>{const s=await fs.lstat(h.ownedRoot,{bigint:true});return{dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)};};
  for(const binding of [undefined,{},{ownedRootPin:()=>null},{ownedRootPin:'pin',admitLease},{ownedRootPin:()=>null,admitLease:'checks'},{ownedRootPin:()=>null,admitLease,extra:1}])
    assert.throws(()=>createNativeFileRuntimeJob(config,binding),{code:'INVALID_NATIVE_FILE_RUNTIME'});
  // Stale and missing pins refuse at R4, before any source hash, releasing the slot once.
  for(const pin of [()=>({dev:'1',ino:'2',birthtimeNs:'3'}),()=>null]){const job=createNativeFileRuntimeJob(config,{ownedRootPin:pin,admitLease}),released=h.slotReleases;
    await assert.rejects(job.prepare(request()),{code:'NATIVE_FILE_STAGE_CHANGED'});assert.equal(h.slotReleases,released+1);assert.equal(job.snapshot().sourceHeld,false);await job.close();assert.equal(h.slotReleases,released+1);
    await assert.rejects(job.publish(undefined,undefined,{destination:path.join(h.root,'x.mkv')}),{code:'INVALID_NATIVE_FILE_RUNTIME'});}
  // A swap right after main's lease checks: the window between the adapter and R4.
  {const pinned=await stamp(),job=createNativeFileRuntimeJob(config,{ownedRootPin:()=>pinned,admitLease:async()=>{await fs.rm(h.ownedRoot,{recursive:true,force:true});await fs.mkdir(h.ownedRoot);}}),released=h.slotReleases;
    await assert.rejects(job.prepare(request()),{code:'NATIVE_FILE_STAGE_CHANGED'});assert.equal(h.slotReleases,released+1);await job.close();}
  assert.equal(seal.calls,0);assert.equal(h.calls.length,0);
  const pinned=await stamp(),seen=[];let good=null;
  good=createNativeFileRuntimeJob(config,{ownedRootPin:()=>pinned,admitLease:async({signal})=>{seen.push([signal instanceof AbortSignal,good.snapshot().leaseHeld,seal.calls]);}});t.after(()=>good.close().catch(()=>{}));
  assert.ok(await good.prepare(request()));assert.deepEqual(seen,[[true,true,0]]);assert.equal(seal.calls,1);await good.close();
});

test('R4: a lease-check refusal whose slot release fails keeps the lease held until a later close releases it once',async t=>{
  const {createNativeFileRuntimeJob}=require('../src/native-file-runtime.cjs');
  const h=await fixture(t,{releaseFailOnce:true});await h.owner.close();
  const job=createNativeFileRuntimeJob({...h.config,policies:[h.policy]},{ownedRootPin:()=>null,admitLease:async()=>{throw Object.assign(new Error('Synthetic quota.'),{code:'NATIVE_FILE_STAGE_QUOTA'});}});
  await assert.rejects(job.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:h.generationDescription}),error=>error.code==='NATIVE_FILE_STAGE_QUOTA'&&Boolean(error.nativeCloseFailure));
  assert.equal(h.slotReleases,0);assert.equal(job.snapshot().leaseHeld,true);
  const closed=await job.close();assert.equal(h.slotReleases,1);assert.equal(closed.leaseHeld,false);await job.close();assert.equal(h.slotReleases,1);
});

async function controlled(t,h,name='state',acquireMediaSlot=h.config.acquireMediaSlot){
  const {createTestNativeFileControls}=require('../src/native-file-controls.cjs'),stateDir=path.join(h.root,name);await fs.mkdir(stateDir);
  const controls=createTestNativeFileControls({runtime:h.runtime,stateDir,nativeBackends:h.native,policies:[h.policy],run:h.config.run});
  const job=()=>{const j=controls.createJob({acquireMediaSlot});t.after(()=>j.close().catch(()=>{}));return j;};
  const prepare=(j,options)=>j.prepare({contract:h.contract,input:h.source,selection:h.selection,outputId:randomUUID(),generationDescription:h.generationDescription},options);
  return {controls,stateDir,ownedRoot:path.join(stateDir,'native-files'),job,prepare};
}

test('NF-C4: lease checks pin the state and work folders; a replaced folder is refused and the slot is released once',async t=>{
  const h=await fixture(t);await h.owner.close();const seal=spySeal(t);
  const refused=async(work,expected)=>{const released=h.slotReleases,seals=seal.calls;await assert.rejects(work,expected);assert.equal(h.slotReleases,released+1);assert.equal(seal.calls,seals);};
  const a=await controlled(t,h,'state-a');assert.equal(a.controls.keptStages(),null);await assert.rejects(fs.access(a.ownedRoot));
  const first=a.job();assert.ok(await a.prepare(first));assert.equal(a.controls.keptStages(),1);await first.close();
  // A replaced work folder is refused by the lease checks (their own text); R4's pin comparison is the second layer.
  await fs.rm(a.ownedRoot,{recursive:true,force:true});await fs.mkdir(a.ownedRoot);
  await refused(a.prepare(a.job()),{code:'NATIVE_FILE_STAGE_CHANGED',message:'The native work folder changed.'});
  const b=await controlled(t,h,'state-b');await fs.rename(b.stateDir,b.stateDir+'-moved');await fs.mkdir(b.stateDir);
  await refused(b.prepare(b.job()),{code:'NATIVE_FILE_STAGE_CHANGED',message:'The app\'s state folder changed.'});await assert.rejects(fs.access(b.ownedRoot));
  const c=await controlled(t,h,'state-c'),later=c.job(),token=await c.prepare(later);
  await fs.rm(c.ownedRoot,{recursive:true,force:true});await fs.mkdir(c.ownedRoot);
  let released=h.slotReleases;await assert.rejects(later.encode(token),{code:'NATIVE_FILE_STAGE_CHANGED'});assert.equal(h.calls.filter(x=>x.argv.includes('-c:v:0')).length,0);
  await later.close().catch(()=>{});assert.equal(h.slotReleases,released+1);
  // A work folder the user removed holds no kept stage: it is recreated and pinned afresh.
  const d=await controlled(t,h,'state-d'),one=d.job();assert.ok(await d.prepare(one));await one.close();await fs.rm(d.ownedRoot,{recursive:true,force:true});
  const two=d.job();assert.ok(await d.prepare(two));await two.close();
  // A cancel while the slot is being granted releases it once, before any source work.
  const controller=new AbortController(),e=await controlled(t,h,'state-e',async request=>{controller.abort();return h.config.acquireMediaSlot(request);});
  await refused(e.prepare(e.job(),{signal:controller.signal}),{code:'CANCELLED'});
});

test('NF-C4: a stage kept by a job is counted at once and again by the next lease scan',async t=>{
  const h=await fixture(t);await h.owner.close();const k=await controlled(t,h,'state-kept');
  const job=k.job(),token=await k.prepare(job);await job.encode(token);await job.close();
  assert.equal(job.snapshot().stageRetained,true);assert.equal(k.controls.keptStages(),1);assert.equal(k.controls.readiness(h.native.snapshot()).keptStages,1);
  const next=k.job();assert.ok(await k.prepare(next));assert.equal(k.controls.keptStages(),2);await next.close();
  assert.equal(k.controls.keptStages(),(await fs.readdir(k.ownedRoot)).length);
});

test('NF-C4: kept work folders are bounded and unexpected entries refuse before any source work',async t=>{
  const h=await fixture(t);await h.owner.close();const seal=spySeal(t);
  const refused=async(name,setup,code)=>{const s=await controlled(t,h,name);await fs.mkdir(s.ownedRoot);await setup(s.ownedRoot);const released=h.slotReleases;
    await assert.rejects(s.prepare(s.job()),{code});assert.equal(h.slotReleases,released+1);return s;};
  const full=await refused('state-full',async root=>{for(let i=0;i<8;i++)await fs.mkdir(path.join(root,'.ffmpeg-encoder-kept0'+i));},'NATIVE_FILE_STAGE_QUOTA');assert.equal(full.controls.keptStages(),8);
  await refused('state-odd',root=>fs.writeFile(path.join(root,'unexpected.txt'),'x'),'NATIVE_FILE_STAGE_CHANGED');
  await refused('state-name',root=>fs.mkdir(path.join(root,'not-a-stage')),'NATIVE_FILE_STAGE_CHANGED');
  await refused('state-many',async root=>{for(let i=0;i<65;i++)await fs.mkdir(path.join(root,'.ffmpeg-encoder-many'+String(i).padStart(2,'0')));},'NATIVE_FILE_STAGE_CHANGED');
  if(process.platform==='win32'){const target=path.join(h.root,'junction-target');await fs.mkdir(target);await refused('state-junction',root=>fs.symlink(target,path.join(root,'.ffmpeg-encoder-abcdef'),'junction'),'NATIVE_FILE_STAGE_CHANGED');}
  assert.equal(seal.calls,0);assert.equal(h.calls.length,0);
});

test('NF-C3: with a genuine verified selection, readiness and assess ask for a reference, or are available with one',async t=>{
  const {createNativeFileControls,createTestNativeFileControls}=require('../src/native-file-controls.cjs');
  const h=await fixture(t);await h.owner.close();const c=await controlled(t,h),view=h.native.snapshot(),file={contract:h.contract,selection:h.selection};
  const controls=policies=>createTestNativeFileControls({runtime:h.runtime,stateDir:c.stateDir,nativeBackends:h.native,policies});
  assert.deepEqual(c.controls.readiness(view).reasons.map(r=>r.code),['NATIVE_FILE_REFERENCE_REQUIRED']);
  assert.deepEqual([c.controls.assess(file).admissible,c.controls.assess(file).reasonCodes],[false,['NATIVE_FILE_REFERENCE_REQUIRED']]);
  const withReference=controls([{...h.policy,reference:referenceFor(h)}]);
  assert.deepEqual([withReference.readiness(view).available,withReference.readiness(view).reasons],[true,[]]);
  assert.deepEqual([withReference.assess(file).admissible,withReference.assess(file).reasonCodes],[true,[]]);
  // A cell-level row with a reference makes readiness available, but this file's own row has none.
  const mixed=controls([h.policy,{...h.policy,id:'other-source',sourceProbeFingerprint:'f'.repeat(64),reference:referenceFor(h)}]);
  assert.equal(mixed.readiness(view).available,true);assert.deepEqual(mixed.assess(file).reasonCodes,['NATIVE_FILE_REFERENCE_REQUIRED']);
  const production=createNativeFileControls({runtime:h.runtime,stateDir:c.stateDir,nativeBackends:h.native});
  assert.deepEqual(production.readiness(view).reasons.map(r=>r.code),['NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(production.assess(file).reasonCodes,['NATIVE_FILE_POLICY_REQUIRED']);assert.equal(h.slotAcquires,0);assert.equal(h.calls.length,0);
});

test('NF-C4: the byte limb of the kept-stage bound and the post-scan recheck each refuse',async t=>{
  const h=await fixture(t);await h.owner.close();
  // One kept stage whose encoded.mkv reports more than 3 GiB (test-only size fake; no large file is written).
  const big=await controlled(t,h,'state-bytes'),stage=path.join(big.ownedRoot,'.ffmpeg-encoder-bytes0'),file=path.join(stage,'encoded.mkv');
  await fs.mkdir(stage,{recursive:true});await fs.writeFile(file,'x');const lstat=fs.lstat;
  fs.lstat=async(target,options)=>{const s=await lstat(target,options);return target===file?Object.assign(Object.create(Object.getPrototypeOf(s)),s,{size:3n*1024n**3n+1n}):s;};
  let released=h.slotReleases;try{await assert.rejects(big.prepare(big.job()),{code:'NATIVE_FILE_STAGE_QUOTA'});}finally{fs.lstat=lstat;}assert.equal(h.slotReleases,released+1);
  // The work folder is swapped as the scan opens it: the post-scan recheck refuses with its own text.
  const swap=await controlled(t,h,'state-swap'),first=swap.job();assert.ok(await swap.prepare(first));await first.close();
  const opendir=fs.opendir;let armed=true;
  fs.opendir=async(dir,...rest)=>{if(armed&&dir===swap.ownedRoot){armed=false;await fs.rename(dir,dir+'-moved');await fs.mkdir(dir);}return opendir(dir,...rest);};
  released=h.slotReleases;try{await assert.rejects(swap.prepare(swap.job()),{code:'NATIVE_FILE_STAGE_CHANGED',message:'The native work folder changed.'});}finally{fs.opendir=opendir;}
  assert.equal(armed,false);assert.equal(h.slotReleases,released+1);
});
