'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {inspectStandaloneMp3Probe:inspect,parseStandaloneMp3Probe:parse}=require('../linux-blue/product-mp3-inspection.cjs');
const p=(rate=48000,ch=2)=>({
  streams:[{index:0,codec_name:'mp3',codec_type:'audio',sample_rate:String(rate),channels:ch,channel_layout:ch===1?'mono':'stereo',
    time_base:'1/14112000',start_pts:0,start_time:'0.000000',initial_padding:0,disposition:{default:0,attached_pic:0}}],
  chapters:[],programs:[],stream_groups:[],format:{filename:'/private/sample.mp3',format_name:'mp3',nb_streams:1,nb_programs:0,nb_stream_groups:0,size:'15360',start_time:'0.000000'}
});
const f=(rate=48000,channels=2)=>({method:'mp3-mpeg1-layer3-prefix-headers-v1',rate,channels,frames:8,contiguousPrefixBytes:3072,
  fileBytes:15360,reachesEof:false,completePayloadVerified:false,metadataAbsenceVerified:false});
for(const [rate,ch] of [[48000,2],[44100,1],[32000,2]])test('bounded path-free recognition '+rate,()=>{
  const result=inspect(parse(Buffer.from(JSON.stringify(p(rate,ch)))),f(rate,ch));
  a.equal(result.executionReady,false);a.equal(result.rate,rate);a.equal(result.channels,ch);a.equal(result.streamCount,1);
  a.equal(result.inspectedPrefixFrames,8);a.equal(result.completePayloadVerified,false);a.equal(result.metadataAbsenceVerified,false);
  a(Object.isFrozen(result));a(!JSON.stringify(result).includes('/private/'));a.match(result.reason,/not available here/);
});
test('even an EOF header walk is not complete metadata or payload verification',()=>{
  const result=inspect(p(),{...f(),contiguousPrefixBytes:15360,reachesEof:true});
  a.equal(result.reachesEof,true);a.equal(result.metadataAbsenceVerified,false);a.equal(result.completePayloadVerified,false);
});
for(const [name,edit,code] of [
  ['wrong container',v=>v.format.format_name='mov,mp4','REMUX_MP3_WRONG_FAMILY'],
  ['layer II',v=>v.streams[0].codec_name='mp2','REMUX_MP3_WRONG_FAMILY'],
  ['artwork',v=>v.streams.push({codec_type:'video',disposition:{attached_pic:1}}),'REMUX_MP3_COVER_UNQUALIFIED'],
  ['secondary track',v=>v.streams.push({codec_type:'audio'}),'REMUX_MP3_STRUCTURE_UNQUALIFIED'],
  ['program count missing',v=>delete v.format.nb_programs,'REMUX_MP3_STRUCTURE_UNQUALIFIED'],
  ['chapter',v=>v.chapters.push({id:1}),'REMUX_MP3_STRUCTURE_UNQUALIFIED'],
  ['reported ID3 language',v=>v.streams[0].tags={language:'eng',comment:'DO NOT LEAK'},'REMUX_MP3_TAGS_UNQUALIFIED'],
  ['generated',v=>v.format.tags={FFMPEG_ENCODER_PROVENANCE:'1',FFMPEG_ENCODER_OUTPUT_ID:'7046a1f4-ca1e-4309-b4d9-b8851b27dbf7'},'REMUX_MP3_GENERATED'],
  ['partial provenance marker',v=>v.format.tags={ffmpeg_encoder_provenance:'1'},'REMUX_MP3_PROVENANCE_UNPROVED'],
  ['misplaced marker',v=>v.streams[0].tags={ffmpeg_encoder_provenance:'1'},'REMUX_MP3_PROVENANCE_UNPROVED'],
  ['padding',v=>v.streams[0].initial_padding=1024,'REMUX_MP3_GAPLESS_UNQUALIFIED'],
  ['side data',v=>v.streams[0].side_data_list=[{side_data_type:'Skip Samples'}],'REMUX_MP3_GAPLESS_UNQUALIFIED'],
  ['shifted start',v=>v.streams[0].start_pts=1,'REMUX_MP3_CLOCK_UNQUALIFIED'],
  ['nonexact sample clock',v=>v.streams[0].time_base='1/1000','REMUX_MP3_CLOCK_UNQUALIFIED'],
  ['non-scalar sample rate',v=>v.streams[0].sample_rate={},'REMUX_MP3_CLOCK_UNQUALIFIED'],
  ['packet dump',v=>v.packets=[],'REMUX_MP3_METADATA_UNPROVED'],
  ['unpaired surrogate',v=>v.format.filename='\ud800','REMUX_MP3_METADATA_UNPROVED'],
  ['oversized string',v=>v.format.filename='x'.repeat(20000),'REMUX_MP3_METADATA_UNPROVED'],
])test('typed refusal: '+name,()=>{
  const input=p();edit(input);a.throws(()=>inspect(input,f()),e=>e.code===code&&!e.message.includes('DO NOT LEAK'));
});
test('metadata parse rejects malformed and ambiguous serialized JSON',()=>{
  a.throws(()=>parse('{"format":{},"format":{}}'),{code:'INVALID_PROBE'});
  a.throws(()=>parse(Buffer.from([0x22,0xff,0x22])),{code:'REMUX_MP3_METADATA_UNPROVED'});
});
test('do not read getters, and do not allow the caller to replace independent shape/size or elevate the claim',()=>{
  const v=p();Object.defineProperty(v.format,'filename',{enumerable:true,get(){throw Error('must not run');}});
  a.throws(()=>inspect(v,f()),{code:'REMUX_MP3_METADATA_UNPROVED'});
  for(const x of [null,{...f(),rate:44100},{...f(),fileBytes:1},{...f(),reachesEof:true},{...f(),metadataAbsenceVerified:true}])
    a.throws(()=>inspect(p(),x),{code:'REMUX_MP3_PREFIX_UNPROVED'});
});
test('retained native metadata projection (read only)',{skip:!process.env.Q2J_RETAINED_RAW_MP3_PROBE},()=>{
  const raw=fs.readFileSync(process.env.Q2J_RETAINED_RAW_MP3_PROBE);
  a.equal(crypto.createHash('sha256').update(raw).digest('hex'),'99669761e6af24e88cf39ad73a12f2cbaebb8900db5d45e17690fb069c70da3f');
  const {packets,...metadata}=JSON.parse(raw);
  a.equal(packets.length,40);
  // Original archived metadata and known prefix facts, not a new branded
  // acquisition, native job or authority. Raw packet dump itself is refused.
  a.equal(inspect(metadata,f()).rate,48000);
  a.throws(()=>inspect({...metadata,packets},f()),{code:'REMUX_MP3_METADATA_UNPROVED'});
});
