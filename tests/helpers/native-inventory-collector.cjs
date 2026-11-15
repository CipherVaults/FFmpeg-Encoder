'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {assessRemux}=require('../../src/remux-contract.cjs'),{collectRemuxEvidence}=require('../../src/remux-evidence.cjs');
const {timedFixture,atom}=require('./mov-fixture.cjs'),{matroskaFixture,element,uint}=require('./matroska-fixture.cjs');
const {MARKER_KEY,OUTPUT_ID_KEY}=require('../../src/provenance.cjs');
const ID='715e278f-1b7e-4d19-948d-a952b68c328e';
function raw(family,groups=false){return{streams:[{index:0,id:'1',codec_type:'video',codec_name:'h264',profile:'High',level:40,width:2,height:2,pix_fmt:'yuv420p',sample_aspect_ratio:'1:1',field_order:'progressive',
  color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',time_base:'1/1000',start_pts:0,disposition:{default:1},tags:{}},
  ...Array.from({length:groups?2:1},(_,i)=>({index:i+1,id:String(i+2),codec_type:'audio',codec_name:'aac',profile:'LC',sample_fmt:'fltp',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:family==='matroska'?'1/1000':'1/48000',start_pts:0,disposition:{default:1},tags:{}}))],
  format:{format_name:family==='isobmff'?'mov,mp4,m4a,3gp,3g2,mj2':'matroska,webm',duration:'2',nb_streams:groups?3:2,nb_programs:0,nb_stream_groups:0,tags:{}},chapters:[],programs:[],stream_groups:[]};}
function isoFixture(p){return timedFixture(p.streams.map(s=>({id:Number(s.id),kind:s.codec_type,width:2,height:2,language:require('./mov-fixture.cjs').isoLanguageCode(s.tags?.language),scale:s.codec_type==='video'?1000:48000,
  pts:s.codec_type==='video'?[0,1000]:[0],durations:s.codec_type==='video'?[1000,1000]:[4]})));}
function isoEdit(bytes,type,change,occurrence=0){let seen=0,found=false;const walk=b=>{const out=[];for(let at=0;at<b.length;){const n=b.readUInt32BE(at),name=b.toString('latin1',at+4,at+8);let h=b.subarray(at+8,at+n);
  if(name===type&&seen++===occurrence){found=true;h=change(Buffer.from(h));}else if(['moov','trak','mdia','minf','stbl','edts'].includes(name))h=walk(h);out.push(atom(name,h));at+=n;}return Buffer.concat(out);};const b=walk(bytes);assert.ok(found,type);return b;}
async function fixture(t,family,{groups=false,languageTag}={}){
  require('./remux-witness-execution.cjs').mark(t,'fixture');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-inventory-test-'));t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());assert.match(path.basename(directory),/^native-inventory-test-/);await fs.rm(directory,{recursive:true});});
  const source=raw(family,groups);if(languageTag)for(const s of source.streams)s.tags.language=languageTag;
  if(family==='matroska')source.streams[0].extradata_hash='SHA256:'+require('node:crypto').createHash('sha256').update(require('./matroska-fixture.cjs').TEST_AVCC).digest('hex');
  const output=structuredClone(source),target=family==='isobmff'?'mp4':'matroska';output.format.tags={[MARKER_KEY]:'1',[OUTPUT_ID_KEY]:ID};
  const sourcePath=path.join(directory,'source.inert'),outputPath=path.join(directory,'output.inert'),stageDirectory=path.join(directory,'evidence');await fs.mkdir(stageDirectory);
  const original=family==='isobmff'?isoFixture(source):matroskaFixture(source);await fs.writeFile(sourcePath,original);await fs.writeFile(outputPath,original);
  const assessment=assessRemux({request:{fileId:'inventory',identityRevision:0,draftRevision:0,operation:'remux',target,range:null,omissionRequestIds:[]},probe:source,sourceFingerprint:'a'.repeat(64)});
  assert.equal(assessment.status,'qualification-required',JSON.stringify(assessment.blockers));
  const run=async(binary,args,options)=>{const p=args[args.indexOf('-i')+1]===sourcePath?source:output,index=Number(args[args.indexOf(args.includes('-select_streams')?'-select_streams':'-map')+1].replace(/^0:/,'')),s=p.streams.find(s=>s.index===index);let b;
    if(args.includes('-show_frames'))b=Buffer.from(JSON.stringify({frames:s.codec_type==='video'?[0,1000].map(pts=>({media_type:'video',stream_index:index,pts,duration:1000,key_frame:1,width:2,height:2,pix_fmt:'yuv420p'})):[{media_type:'audio',stream_index:index,pts:0,nb_samples:4,sample_fmt:'fltp',sample_rate:'48000',channels:2,channel_layout:'stereo'}]}));
    else if(args.includes('-show_packets'))b=Buffer.from(JSON.stringify({packets:[0,1000].map(pts=>({stream_index:index,pts,duration:1000,size:'9',data_hash:'SHA256:'+'8'.repeat(64)}))}));
    else if(args.includes('-show_streams'))b=Buffer.from(JSON.stringify({programs:[],stream_groups:[],streams:[{index,codec_type:s.codec_type,codec_name:s.codec_name,tags:s.tags||{}}]}));
    else if(args.includes('framehash'))b=Buffer.from('#hash: SHA256\n0, 0, 0, 1, 6, '+ 'c'.repeat(64)+'\n0, 1, 1, 1, 6, '+'d'.repeat(64)+'\n');
    else b=Buffer.alloc(32,5);
    await options.onStdoutChunk(b);return{exitCode:0,stdout:'',stderr:'',stderrCapture:{totalBytes:0,truncated:false},stdoutCapture:{totalBytes:b.length,truncated:false,streamed:true}};
  };
  return{source,output,sourcePath,outputPath,original,collect:()=>collectRemuxEvidence({assessment,runtimeIdentity:'b'.repeat(64),outputId:ID,sourceProbe:source,outputProbe:output,sourcePath,outputPath,stageDirectory,
    ffmpeg:path.join(directory,'fake-ffmpeg.exe'),ffprobe:path.join(directory,'fake-ffprobe.exe'),run,budget:{sourceDecode:'complete',timeoutMs:120000,maxFrameBytes:8388608,maxPcmBytes:134217728,maxRecords:20000,maxSpoolBytes:33554432}})};
}
module.exports={fixture,raw,isoFixture,isoEdit,atom,element,uint};
