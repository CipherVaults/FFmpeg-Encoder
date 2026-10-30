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
