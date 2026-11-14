'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { ffmpeg, ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
const { observeRemuxSourcePlayback, preserveRemuxSourceControls } = require('../src/remux-edit-lists.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { collectRemuxEvidence } = require('../src/remux-evidence.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const runtimeIdentity = REMUX_POLICIES[0].runtimeIdentity;
const { createStage } = require('../src/outputs.cjs');
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
  ...[1,2,7,15].map(flags=>({name:'flags'+flags, flags})), { name:'layer-and-group', layer:2, group:0 },
];
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
  if(spec.scale)args.push('-movie_timescale',String(spec.scale));if(spec.offset)args.push('-output_ts_offset',String(spec.offset));
  args.push(file);await runTool(ffmpeg,args);
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
    const admitted=await observeRemuxSourcePlayback({file,probe:raw,identity,selectedIndexes:raw.streams.filter(s=>s.codec_type!=='subtitle').map(s=>s.index),maxRecords:10000});
    assert.ok(admitted.complete);let successes=0;
    for(const target of ['mp4','mov','matroska']){
      const {request,assessment}=assessmentFor(raw,identity,target),api=new RemuxOperations({runtimeIdentity,policyIdentity:REMUX_POLICY_ID,policies:REMUX_POLICIES}),
        stage=await createStage(root),output=stage.file,outputId=randomUUID();let plan;
      try{plan=api.prepare({assessment,request,input:file,output,outputId,sourceIdentity:identity});}
      catch(e){assert.equal(target,'mov',spec.name+': '+e.message);assert.ok(['REMUX_QUALIFICATION_REQUIRED','REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED','REMUX_MOV_AUDIO_UNQUALIFIED'].includes(e.code),e.code);continue;}
      api.select({plan,settings:null,sourceIdentity:identity,sourceProbeFingerprint:plan.sourceProbeFingerprint,runtimeIdentity,environment:null,budget:EVIDENCE_BUDGET,executionBudgetMs:EXECUTION_BUDGET_MS});
      await runTool(ffmpeg,api.resolveInvocation(plan,{output}));
      if(target!=='matroska')await preserveRemuxSourceControls({file,probe:raw,identity,output,stage,mappings:assessment.expectedOutput.streams,maxRecords:10000});
      const outputProbe=await probe(output),evidence=await collectRemuxEvidence({assessment,runtimeIdentity,outputId,sourceProbe:raw,outputProbe,sourcePath:file,outputPath:output,stageDirectory:root,
        ffmpeg,ffprobe,run:runTool,budget:EVIDENCE_BUDGET,verificationMethod:'packet-identity-v1',maxConcurrentChildren:2});
      assert.equal(evidence.status,'completed',spec.name+'/'+target+': '+JSON.stringify(evidence.failure));
      const valid=api.validate(plan,outputProbe,evidence);assert.equal(valid.valid,true,spec.name+'/'+target+': '+JSON.stringify(valid));successes++;
    }assert.ok(successes>=2,spec.name);
  });
});
module.exports={CORPUS};
