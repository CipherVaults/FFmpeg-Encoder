'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { ffmpeg, ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
const { observeRemuxSourcePlayback } = require('../src/remux-edit-lists.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { collectRemuxEvidence } = require('../src/remux-evidence.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const runtimeIdentity = REMUX_POLICIES[0].runtimeIdentity;
const { createStage } = require('../src/outputs.cjs');
const { atom } = require('./helpers/mov-fixture.cjs');
async function probe(file) { return JSON.parse((await runTool(ffprobe, ['-v','error','-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json',file])).stdout); }
const CORPUS = [
  { name:'cfr', bf:0 }, { name:'bframes', bf:2 }, { name:'vfr', bf:0, vfr:true },
  { name:'vfr-bframes', bf:2, vfr:true }, { name:'vfr-bframes-mov', bf:2, vfr:true, ext:'mov' },
  { name:'delayed-audio', delay:true }, { name:'two-audio', two:true }, { name:'subtitle', subtitle:true },
  { name:'faststart', fast:true }, { name:'compact-stz2', compact:true }, { name:'fragmented-video', fragment:true, video:true },
  // Fragmented AAC still trips the pre-existing packet discard/priming
  // comparison; this regression corpus covers the previously accepted video
  // fragment route without waiving that independent preservation check.
  { name:'movie600', scale:600, ext:'mov' },
  { name:'movie1000', scale:1000 }, { name:'movie90000', scale:90000 },
  { name:'fractional-delay1001', video:true, offset:2/30, scale:1001 },
  { name:'version1', video:true, offset:5000000, scale:90000 },
  { name:'fragment-no-tfdt', fragment:true, video:true, noTfdt:true },
  { name:'hybrid-fragment', hybrid:true, video:true },
  { name:'hybrid-no-tfdt', hybrid:true, video:true, noTfdt:true },
].map(spec=>({...spec,requiredTargets:spec.video||spec.two||spec.subtitle?['mp4','matroska']:['mp4','mov','matroska']}));
function assessmentFor(raw, identity, target) {
  const request = { fileId:'corpus',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[] },
    sourceFingerprint = fingerprintRemuxSourceIdentity(identity);
  let assessment = assessRemux({request,probe:raw,sourceFingerprint});
  const grants = raw.streams.filter(s=>s.codec_type==='subtitle').map(s=>({id:randomUUID(),fileId:request.fileId,identityRevision:0,draftRevision:0,
    sourceFingerprint,operation:'remux',target,streamIndex:s.index,streamFingerprint:assessment.expectedOutput.streams.find(m=>m.inputIndex===s.index).streamFingerprint,action:'omit-stream'}));
  if(grants.length){request.omissionRequestIds=grants.map(g=>g.id);assessment=assessRemux({request,probe:raw,sourceFingerprint,resolveOmission:id=>grants.find(g=>g.id===id)});}
  return { request, assessment };
}
async function generate(root, spec) {
  const file=path.join(root,spec.name+'.'+(spec.ext||'mp4')),args=['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=s=64x48:r=30:d=1'];
  if(!spec.video){if(spec.delay)args.push('-itsoffset','0.2');args.push('-f','lavfi','-i','sine=r=48000:d=1');}
  if(spec.subtitle){const srt=path.join(root,'owned.srt');await fs.writeFile(srt,'1\n00:00:00,000 --> 00:00:00,600\nOwned test\n',{flag:'wx'});args.push('-i',srt);}
  args.push('-map','0:v');if(!spec.video)args.push('-map','1:a');if(spec.two)args.push('-map','1:a');if(spec.subtitle)args.push('-map','2:s','-c:s','mov_text');
  const color='setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
  args.push('-vf',(spec.vfr?'select=not(mod(n\\,3))+not(mod(n\\,5)),':'')+color,'-fps_mode','vfr',
    '-c:v','libx264','-preset','ultrafast','-threads','1','-bf',String(spec.bf??2),'-g','10','-pix_fmt','yuv420p',
    '-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709');
  if(!spec.video)args.push('-c:a','aac','-ac','2');if(spec.two)args.push('-disposition:a:0','default','-disposition:a:1','0');
  if(spec.fast)args.push('-movflags','+faststart');if(spec.fragment)args.push('-movflags','+empty_moov+frag_keyframe+default_base_moof');
  if(spec.hybrid)args.push('-movflags','+frag_keyframe');
  if(spec.scale)args.push('-movie_timescale',String(spec.scale));if(spec.offset)args.push('-output_ts_offset',String(spec.offset));
  args.push(file);await runTool(ffmpeg,args);
  if(spec.noTfdt){const b=await fs.readFile(file);let at=-1,n=0;while((at=b.indexOf(Buffer.from('tfdt'),at+1))!==-1){b.write('free',at);n++;}assert.ok(n>0);await fs.writeFile(file,b);}
  if(spec.compact){const b=await fs.readFile(file);assert.ok(b.indexOf(Buffer.from('mdat'))<b.indexOf(Buffer.from('moov')));
    const rewrite=b=>{const out=[];for(let at=0;at<b.length;){const n=b.readUInt32BE(at),name=b.toString('ascii',at+4,at+8);let h=Buffer.from(b.subarray(at+8,at+n)),type=name;
      if(name==='stsz'){const count=h.readUInt32BE(8),r=Buffer.alloc(12+count*2);r[7]=16;r.writeUInt32BE(count,8);for(let i=0;i<count;i++)r.writeUInt16BE(h.readUInt32BE(4)||h.readUInt32BE(12+i*4),12+i*2);h=r;type='stz2';}
      else if(['moov','trak','mdia','minf','stbl'].includes(name))h=rewrite(h);
      const head=Buffer.alloc(8);head.writeUInt32BE(h.length+8);head.write(type,4);out.push(head,h);at+=n;}return Buffer.concat(out);};await fs.writeFile(file,rewrite(b));}
  if(spec.flags||spec.layer!==undefined){const b=await fs.readFile(file),at=b.indexOf(Buffer.from('tkhd'))+4;assert.ok(at>4);
    if(spec.flags)b.writeUIntBE(spec.flags,at+1,3);if(spec.layer!==undefined){b.writeInt16BE(spec.layer,at+32);const audio=b.indexOf(Buffer.from('tkhd'),at)+4;b.writeInt16BE(spec.group,audio+34);}await fs.writeFile(file,b);}
  return file;
}
test('pinned ordinary round-trip corpus admits source layouts and validates every policy-admitted route', {timeout:180000}, async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-roundtrip-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^remux-roundtrip-/);await fs.rm(root,{recursive:true});});
  for(const spec of CORPUS) await t.test(spec.name,async()=>{
    const file=await generate(root,spec),raw=await probe(file),identity=await readSourceIdentity(file);
    const successes=[];
    for(const target of ['mp4','mov','matroska']){
      const {request,assessment}=assessmentFor(raw,identity,target),api=new RemuxOperations({runtimeIdentity,policyIdentity:REMUX_POLICY_ID,policies:REMUX_POLICIES}),
        stage=await createStage(root),output=stage.file,outputId=randomUUID();let plan;
      try{plan=api.prepare({assessment,request,input:file,output,outputId,sourceIdentity:identity});}
      catch(e){assert.ok(!spec.requiredTargets.includes(target),spec.name+'/'+target+' must succeed: '+e.message);assert.equal(target,'mov');assert.equal(e.code,'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED');continue;}
      const admitted=await observeRemuxSourcePlayback({file,probe:raw,identity,target,selectedIndexes:assessment.expectedOutput.streams.map(s=>s.inputIndex),maxRecords:10000});assert.ok(admitted.complete);
      api.select({plan,settings:null,sourceIdentity:identity,sourceProbeFingerprint:plan.sourceProbeFingerprint,runtimeIdentity,environment:null,budget:EVIDENCE_BUDGET,executionBudgetMs:EXECUTION_BUDGET_MS});
      await runTool(ffmpeg,api.resolveInvocation(plan,{output}));
      const outputProbe=await probe(output),evidence=await collectRemuxEvidence({assessment,runtimeIdentity,outputId,sourceProbe:raw,outputProbe,sourcePath:file,outputPath:output,stageDirectory:root,
        ffmpeg,ffprobe,run:runTool,budget:EVIDENCE_BUDGET,verificationMethod:'packet-identity-v1',maxConcurrentChildren:2});
      assert.equal(evidence.status,'completed',spec.name+'/'+target+': '+JSON.stringify(evidence.failure));
      const valid=api.validate(plan,outputProbe,evidence);assert.equal(valid.valid,true,spec.name+'/'+target+': '+JSON.stringify(valid));successes.push(target);
    }assert.deepEqual(successes,spec.requiredTargets,spec.name);
  });
});
module.exports={CORPUS};

function nativeChange(bytes,type,change){let found=false;const walk=b=>{const out=[];for(let at=0;at<b.length;){const n=b.readUInt32BE(at),name=b.toString('ascii',at+4,at+8);let h=b.subarray(at+8,at+n);
  if(!found&&name===type){found=true;h=change(Buffer.from(h));}else if(['moov','trak','mdia','minf','stbl','edts'].includes(name))h=walk(h);
  out.push(atom(name,h));at+=n;}return Buffer.concat(out);};const result=walk(bytes);assert.ok(found,type);return result;}

test('full ISO collector refuses output v0/v1 width, balance and aperture mutants after the copy', {timeout:60000}, async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-output-controls-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^remux-output-controls-/);await fs.rm(root,{recursive:true});});
  const file=await generate(root,{name:'source',bf:0}),raw=await probe(file),identity=await readSourceIdentity(file),target='mp4',
    {request,assessment}=assessmentFor(raw,identity,target),api=new RemuxOperations({runtimeIdentity,policyIdentity:REMUX_POLICY_ID,policies:REMUX_POLICIES}),
    stage=await createStage(root),output=stage.file,outputId=randomUUID(),plan=api.prepare({assessment,request,input:file,output,outputId,sourceIdentity:identity});
  api.select({plan,settings:null,sourceIdentity:identity,sourceProbeFingerprint:plan.sourceProbeFingerprint,runtimeIdentity,environment:null,budget:EVIDENCE_BUDGET,executionBudgetMs:EXECUTION_BUDGET_MS});
  await runTool(ffmpeg,api.resolveInvocation(plan,{output}));const original=await fs.readFile(output);
  assert.ok(original.indexOf(Buffer.from('mdat'))<original.indexOf(Buffer.from('moov')),'Owned structural mutants keep media offsets valid.');
  const cases=[...([0,1].map(version=>['tkhd',h=>{assert.equal(h[0],0);if(version){const r=Buffer.alloc(h.length+12);h.copy(r,1,1,4);r[0]=1;h.copy(r,20,12,20);r.writeBigUInt64BE(BigInt(h.readUInt32BE(20)),28);h.copy(r,36,24);h=r;}h.writeUInt32BE(32*65536,76+(version?12:0));return h;},'REMUX_TRACK_GEOMETRY_UNSUPPORTED'])),
    ['smhd',h=>{h.writeInt16BE(256,4);return h;},'REMUX_SOUND_BALANCE_UNSUPPORTED'],
    ['trak',h=>{const a=Buffer.alloc(12);a.writeUInt32BE(32*65536,4);a.writeUInt32BE(48*65536,8);return Buffer.concat([h,atom('tapt',atom('clef',a))]);},'REMUX_TRACK_APERTURE_UNSUPPORTED']];
  for(const [type,change,code]of cases){await fs.writeFile(output,nativeChange(original,type,change));const outputProbe=await probe(output),evidence=await collectRemuxEvidence({assessment,runtimeIdentity,outputId,sourceProbe:raw,outputProbe,sourcePath:file,outputPath:output,stageDirectory:root,
      ffmpeg,ffprobe,run:runTool,budget:EVIDENCE_BUDGET,verificationMethod:'packet-identity-v1',maxConcurrentChildren:2});
    assert.equal(evidence.status,'failed',type);assert.equal(evidence.failure.code,code,JSON.stringify(evidence.failure));
    assert.throws(()=>api.validate(plan,outputProbe,evidence),{code:'REMUX_EVIDENCE_RECEIPT_REQUIRED'});
  }
});

test('normal service preserves alternative audio controls without a post-mux writer; substituted stages cannot change inputs', {timeout:120000},async t=>{
  const {EncoderService}=require('../src/encoder-service.cjs');
  for(const swap of [null,'second-input','hard-link','different-inode'])await t.test(swap||'preserved-dispositions',async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-control-service-'));
    t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^remux-control-service-/);await fs.rm(root,{recursive:true});});
    const input=path.join(root,'input'),output=path.join(root,'output'),evidenceRoot=path.join(root,'evidence');for(const dir of [input,output,evidenceRoot])await fs.mkdir(dir);
    const statfs=fs.statfs;t.mock.method(fs,'statfs',(file,...args)=>path.resolve(file)===output?Promise.resolve({bavail:1024n**4n,bsize:1n}):statfs(file,...args));
    const source=await generate(input,{name:'source',two:true,bf:0}),sourceBytes=await fs.readFile(source),other=path.join(input,'protected.mp4');
    const otherBytes=nativeChange(sourceBytes,'tkhd',h=>{h.writeUIntBE(7,1,3);return h;});await fs.writeFile(other,otherBytes,{flag:'wx'});
    let replacement=null;
    const run=async(binary,args,options)=>{const r=await runTool(binary,args,options);if(swap&&args.includes('-progress')&&args.includes('copy')){
      replacement=args.at(-1);await fs.unlink(replacement);
      if(swap==='hard-link')await fs.link(other,replacement);else if(swap==='second-input')await fs.rename(other,replacement);else await fs.copyFile(other,replacement,require('node:fs').constants.COPYFILE_EXCL);
    }return r;};
    const service=new EncoderService({ffmpeg,ffprobe,run,stateDir:path.join(root,'state'),runtimeIdentity,inspectionCache:null,
      inspect:async file=>{const p=await probe(file);return{probe:p,duration:Number(p.format.duration),summary:{}};},
      storageEligibility:{check:async()=>({eligible:false,reason:'Owned generated service regression'})},capabilities:async()=>{throw Error('No encoder discovery');},
      operationRuntime:{observe:async()=>({}),snapshot:()=>({runtimeIdentity,environment:null}),requireCurrent:async()=>({runtimeIdentity,environment:null}),
        invoke:(_token,tool,args,opts)=>run(tool==='ffmpeg'?ffmpeg:ffprobe,args,opts),close:async()=>{}},
      operationStorage:{admit:async()=>({directory:evidenceRoot}),assertReservation:async()=>{},observeGrowth:async()=>({}),finish:async()=>({final:{violations:[]}}),close:async()=>{}},
      operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,
      remuxOperations:new RemuxOperations({runtimeIdentity,policyIdentity:REMUX_POLICY_ID,policies:REMUX_POLICIES})});
    try{const a=await service.registerFolder(input,'input'),b=await service.registerFolder(output,'output');await service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mp4'});
      const ready=service.snapshot(),item=ready.items.find(i=>i.name==='source.mp4'),blocked=ready.items.find(i=>i.name==='protected.mp4');
      assert.equal(item.status,'ready',item.reason);assert.equal(blocked.reasonCode,'REMUX_SOURCE_CONTROL_UNREPRESENTABLE');
      const entry=service.plan.entries.get(item.id);service.startBatch({planId:ready.planId,fileIds:[item.id]});await service.taskPromise;
      const result=service.snapshot().items.find(i=>i.id===item.id);
      if(swap){assert.equal(result.status,'failed',result.reason);assert.notEqual(result.outputDisposition?.published,true);
        assert.ok(['STAGE_CHANGED','PROTECTED_SOURCE','INVALID_PROVENANCE','REMUX_STORAGE'].includes(result.reasonCode),result.reasonCode);
      }else{assert.equal(result.status,'success',result.reason);assert.equal(result.outputDisposition.published,true);
        assert.deepEqual(entry.operationEvidence.nativeEditLists.tracks.map(t=>t.controls.flags),[3,3,2]);
        assert.deepEqual(entry.operationEvidence.sourcePlayback.tracks.map(t=>t.controls.flags),[3,3,2]);}
      if(swap==='second-input'){await fs.rename(replacement,other);replacement=null;}
      assert.deepEqual(await fs.readFile(source),sourceBytes);assert.deepEqual(await fs.readFile(other),otherBytes);
    }finally{await service.cancelCurrent();await service.closeOperationResources();await service.closeDiagnostics();}
  });
});
