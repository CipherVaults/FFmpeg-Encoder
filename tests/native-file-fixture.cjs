'use strict';
// Shared synthetic native file fixture for the service tests (record 37 C3;
// C4 extends it). Injected registry receipts, policy rows and references only:
// no device, child process or media tool runs, and nothing here is hardware,
// source or qualification evidence.
const fsp = require('node:fs/promises'), path = require('node:path'), { createHash, randomUUID } = require('node:crypto');
const { NativeBackendService } = require('../src/native-backend-service.cjs');
const { NativeCapabilityRegistry } = require('../src/backend-capabilities.cjs');
const { NATIVE_PROFILES, getNativeProfile, capabilityKey } = require('../src/backend-adapters.cjs');
const { NativeFileRuntimePair } = require('../src/native-file-runtime-pair.cjs');
const { describeNativeFileSource } = require('../src/native-file-contract.cjs');

const sha = value => createHash('sha256').update(value).digest('hex');

// Synthetic pinned executables: their bytes only feed the full-SHA pins.
async function nativeRuntime(dir) {
  const runtime = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = path.join(dir, name + '.exe'), data = Buffer.from('synthetic ' + name + ' bytes');
    await fsp.writeFile(file, data); runtime[name] = { file, sizeBytes: data.length, sha256: sha(data) };
  }
  return runtime;
}

// A genuine NativeBackendService over a fresh registry. Discovery reports the
// listed devices; the probe mints a verified receipt for the selected cell.
// AMF selections never reach the probe (the service refuses them first).
function nativeBackends(runtime, { devices = ['amf', 'qsv'] } = {}) {
  let now = 1000, initialized = false;
  const ids = { amf: randomUUID(), qsv: randomUUID() }, registry = new NativeCapabilityRegistry({ now: () => now }), calls = { discovery: 0, probe: 0, capture: 0 };
  const device = backend => ({ id: ids[backend], backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086', adapterIndex: backend === 'amf' ? 1 : 2,
    adapterIdentity: `${backend}:luid:00000000:00001234`, driverVersion: '32.0.1.2', runtimeVersion: initialized ? '1.35.0' : 'unresolved' });
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: ++now,
    runtime: Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, { sha256: runtime[name].sha256, version: name + ' version 9.0.2-test' }])),
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(p => [p.encoder, 'present'])), inventory: { status: 'complete', devices: devices.map(device) } });
  const native = new NativeBackendService({ registry,
    discover: async request => { calls.discovery++; if (request.initialization !== undefined) initialized = true; return { registry, environment: environment() }; },
    createProbe: () => ({
      initialize: async () => ({ status: 'observed', initialization: Object.freeze({ testOnly: true }), invocations: [] }),
      probe: async ({ cellId }) => {
        calls.probe++;
        const ticket = registry.beginProbe({ cellId }), p = ticket.plan, profile = getNativeProfile(p.policy.profileId), observed = environment();
        registry.observeDiscovery(observed);
        const receipt = ticket.issueReceipt({ outcome: 'verified', reason: 'VERIFIED', evidenceId: randomUUID(), environment: observed,
          lifecycle: { encode: 'closed', decode: 'closed' }, validation: { invocationId: p.invocationId, contributionHash: p.contributionHash,
            argvSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), warningCaptureComplete: true, unexpectedWarnings: 0, modeSource: 'runtime-log',
            actualMode: p.settings.mode, actualEncoder: profile.encoder, actualAdapterIdentity: p.policy.device.adapterIdentity,
            output: { codec: profile.encodedCodec, bitDepth: p.policy.bitDepth, width: 320, height: 180, frames: 96, decodedFrames: 96,
              chroma: '4:2:0', signal: 'sdr', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv', valid: true } } });
        const cell = registry.completeProbe({ probeId: p.probeId, receipt });
        return { status: 'verified', cell, cellId: cell.cellId, evidenceId: cell.evidenceId };
      } }) });
  const capture = native.captureFileSelection.bind(native);
  native.captureFileSelection = request => { calls.capture++; return capture(request); };
  const selected = () => ({ selectionId: native.snapshot().selection.selectionId, revision: native.snapshot().revision });
  // Select and check exact settings, as "Check these settings" would.
  const choose = async (profileId = 'h264-qsv', bitDepth = 8) => {
    const p = getNativeProfile(profileId);
    native.select({ revision: native.snapshot().revision, profileId, settings: { ...p.operationalSeed, deviceId: ids[p.backend] }, bitDepth });
    await native.qualify(selected());
    return selected();
  };
  return { native, registry, ids, calls, choose, selected };
}

// A 1280x720 H.264 High source inside the native contract (record 37 §3.3).
// `index` changes the probe fingerprint without leaving the contract.
function nativeProbe({ index = 7, frames = 15, size = 4096, edit } = {}) {
  const probe = { streams: [{ index, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709',
    color_space: 'bt709', color_range: 'tv', chroma_location: 'left', avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360',
    start_pts: 0, start_time: '0.000000', duration_ts: frames * 512, duration: (frames / 30).toFixed(6), nb_frames: String(frames),
    disposition: { default: 1 }, tags: {} }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: String(size), start_time: '0.000000', duration: (frames / 30).toFixed(6) },
  chapters: [], programs: [], stream_groups: [] };
  edit?.(probe);
  return probe;
}
// What an injected inspector returns for that probe.
const nativeInspection = probe => ({ probe, duration: Number(probe.format.duration),
  color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: probe.streams[0]?.index ?? 0, reasons: [] },
  summary: { selectedVideoIndex: probe.streams[0]?.index ?? 0, codec: probe.streams[0]?.codec_name || null, width: probe.streams[0]?.width || null,
    height: probe.streams[0]?.height || null, bitDepth: 8 } });

// A structurally valid reference: enough for plan-time admission, never validated here.
const syntheticReference = (sourceSha256, id) => ({ version: 1, id: 'synthetic-reference-' + id, contractId: 'native-file-h264-bt709-full-v1', frames: 15,
  source: { fileSha256: sourceSha256, rawSha256: sha('raw ' + id), metadataSha256: sha('meta ' + id), timelineSha256: sha('time ' + id) },
  output: { rawSha256: sha('out raw ' + id), metadataSha256: sha('out meta ' + id), timelineSha256: sha('out time ' + id), templateSha256: sha('tpl ' + id),
    templateManifestSha256: sha('manifest ' + id), templateBytes: 4096 }, proof: { evidenceIds: ['synthetic-reference-proof'], reportSha256: sha('report ' + id) } });

// One exact policy row for the current verified selection and this probe.
function nativePolicy({ runtime, native, probe, id = 'synthetic-test-only', reference = true }) {
  const selection = native.snapshot().selection, sourceBytes = probe.format.size;
  const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: randomUUID(), identityRevision: 0, draftId: randomUUID(), draftRevision: 0,
    profileId: selection.request.profileId, settings: selection.request.settings, bitDepth: 8, target: 'matroska', resolution: 'source', range: null,
    signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] };
  const applicability = describeNativeFileSource({ probe, sourceBytes, request }), sourceSha256 = sha('source ' + id);
  if (applicability.status !== 'structurally-eligible-unqualified') throw new Error('The fixture probe is outside the native contract.');
  return { id, contractId: applicability.contractId, runtimeIdentity: new NativeFileRuntimePair(runtime).identity(), sourceSha256,
    sourceProbeFingerprint: applicability.sourceProbeFingerprint, nativeCellKey: capabilityKey(selection.cell.policy),
    profileId: selection.request.profileId, settings: selection.request.settings,
    budget: { maximumChildren: 32, maximumPipeBytes: 128 * 1024 ** 2, deadlineMs: 30000, maximumStageBytes: 1024 ** 2, metadataBytes: 1024 ** 2, nativeStderrBytes: 262144 },
    evidenceIds: ['synthetic-fixture-not-hardware-proof'], ...(reference ? { reference: syntheticReference(sourceSha256, id) } : {}) };
}

module.exports = { sha, nativeRuntime, nativeBackends, nativeProbe, nativeInspection, nativePolicy, syntheticReference };

// Runtime lifecycle fixtures moved verbatim from native-file-runtime.test.cjs.
const runtimeHelpers = (() => {
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{EventEmitter,once}=require('node:events'),{PassThrough}=require('node:stream'),{createHash,randomUUID}=require('node:crypto');
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

return { fixture, referenceFor, deferred, tick };
})();
Object.assign(module.exports, runtimeHelpers);
