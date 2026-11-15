'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runTool}=require('../../src/process-runner.cjs');
const {ffmpeg,ffprobe}=require('../../src/candidate-runtime.cjs').resolveCandidateRuntime({root:path.resolve(__dirname,'../..')});
const {assessRemux}=require('../../src/remux-contract.cjs'),{collectRemuxEvidence,getCollectedRemuxEvidence}=require('../../src/remux-evidence.cjs');
const {createRemuxValidator}=require('../../src/remux-validation.cjs');
const {MARKER_KEY,OUTPUT_ID_KEY}=require('../../src/provenance.cjs');
async function realWitness(t,family,{audio=family==='matroska',transform,movflags,durationSeconds,frames}={}){
  require('./remux-witness-execution.cjs').mark(t,'fixture');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'remux-real-witness-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^remux-real-witness-/);await fs.rm(dir,{recursive:true});});
  const ext=family==='isobmff'?'mp4':'mkv',sourcePath=path.join(dir,'source.'+ext),outputPath=path.join(dir,'output.'+ext),outputId='715e278f-1b7e-4d19-948d-a952b68c328e';
  const duration=durationSeconds??(audio?'1.024':'1');
  await runTool(ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=s=64x48:r=25:d='+duration,...(audio?['-f','lavfi','-i','sine=r=48000:d='+duration]:[]),'-map','0:v',...(audio?['-map','1:a']:[]),
    '-vf','setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','libx264','-preset','ultrafast','-threads','1','-bf','2','-g','10','-pix_fmt','yuv420p',
    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-c:a','aac','-ac','2',...(frames?['-frames:v',String(frames)]:[]),...(movflags?['-movflags',movflags]:[]),sourcePath]);
  if(transform)await fs.writeFile(sourcePath,transform(await fs.readFile(sourcePath)));
  const probe=async file=>JSON.parse((await runTool(ffprobe,['-v','error','-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json',file])).stdout);
  const source=await probe(sourcePath),target=family==='isobmff'?'mp4':'matroska';
  // An exact owned copy is the neutral pair. Provenance is supplied as the
  // collector's observed output metadata; media/probe/frame children are real.
  await fs.copyFile(sourcePath,outputPath);const output=await probe(outputPath);output.format.tags[MARKER_KEY]='1';output.format.tags[OUTPUT_ID_KEY]=outputId;
  const request={fileId:'real-witness',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]};
  const assessment=assessRemux({request,probe:source,sourceFingerprint:'a'.repeat(64)});assert.equal(assessment.status,'qualification-required',JSON.stringify(assessment.blockers));
  const validator=createRemuxValidator({requireQualification:p=>({status:'verified',...Object.fromEntries(['runtimeIdentity','operation','inputFamily','target','cellId','requirementIds'].map(k=>[k,p[k]])),
    evidenceId:'injected-witness-only',maxTimestampError:{numerator:'1',denominator:'500'},maxChapterError:{numerator:'1',denominator:'500'}})});
  const plan=validator.prepare({assessment,runtimeIdentity:'b'.repeat(64),outputId,cellId:'injected-witness-only'});
  return {sourcePath,outputPath,source,output,original:await fs.readFile(sourcePath),probe,
    validate:receipt=>validator.validate({plan,outputProbe:output,essenceEvidence:getCollectedRemuxEvidence(receipt,{assessment,runtimeIdentity:'b'.repeat(64),outputId})}),
    collect:()=>collectRemuxEvidence({assessment,runtimeIdentity:'b'.repeat(64),outputId,sourceProbe:source,outputProbe:output,sourcePath,outputPath,stageDirectory:dir,ffmpeg,ffprobe,run:runTool,verificationMethod:'packet-identity-v1',maxConcurrentChildren:2,
      budget:{sourceDecode:'complete',timeoutMs:120000,maxFrameBytes:8388608,maxPcmBytes:134217728,maxRecords:20000,maxSpoolBytes:33554432}})};
}
module.exports={realWitness};
