'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { assessRemux } = require('../src/remux-contract.cjs');
const { qualifyTwoAacMp4Source, verifyTwoAacMp4Evidence } = require('../linux-blue/product-two-aac-evidence.cjs');

const SOURCE = 'REMUX_TWO_AAC_MP4_SOURCE_UNQUALIFIED', EVIDENCE = 'REMUX_TWO_AAC_MP4_EVIDENCE_UNQUALIFIED';
const RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
function fixture({lang='ara',mono=true,secondDefault=false,width=1280,height=720,fps='30/1'}={}) {
  const a=(index,language,rate,channels,active)=>({index,id:'0x'+(index+1),codec_type:'audio',codec_name:'aac',
    codec_tag_string:'mp4a',profile:'LC',sample_fmt:'fltp',sample_rate:String(rate),channels,
    channel_layout:channels===1?'mono':'stereo',time_base:'1/'+rate,start_pts:0,start_time:'0.000000',
    duration_ts:rate,duration:'1.000000',extradata_hash:'SHA256:'+'a'.repeat(64),
    tags:{language,handler_name:'SoundHandler'},disposition:{default:Number(active)}});
  return {format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:'1.000000',start_time:'0.000000',size:'700',
    nb_streams:3,nb_programs:0,nb_stream_groups:0,tags:{major_brand:'isom'}},chapters:[],programs:[],stream_groups:[],
    streams:[{index:0,id:'0x1',codec_type:'video',codec_name:'h264',codec_tag_string:'avc1',profile:'High',level:31,
      width,height,pix_fmt:'yuv420p',bits_per_raw_sample:'8',field_order:'progressive',color_space:'bt709',
      color_primaries:'bt709',color_transfer:'bt709',color_range:'tv',sample_aspect_ratio:'1:1',
      avg_frame_rate:fps,r_frame_rate:fps,time_base:'1/30000',start_pts:0,start_time:'0.000000',duration_ts:30000,
      duration:'1.000000',tags:{language:'und',handler_name:'VideoHandler'},disposition:{default:1}},
    a(1,'eng',48000,2,!secondDefault),a(2,lang,mono?44100:48000,mono?1:2,secondDefault)]};
}
function assessment(probe=fixture(),opts={}) {
  return assessRemux({probe,sourceFingerprint:'b'.repeat(64),request:{fileId:'portable-contract',identityRevision:0,
    draftRevision:0,operation:'remux',target:'mp4',range:null,omissionRequestIds:[],...opts}});
}
for (const [name,cfg] of [
  ['48 stereo ENG then 44.1 mono ARA 720p30',{mono:true}],
  ['same-shape 48 kHz twin with second default',{mono:false,secondDefault:true}],
  ['held-out shape ENG then DEU at 1080p25',{mono:false,lang:'deu',secondDefault:true,width:1920,height:1080,fps:'25/1'}],
]) test(name,()=>{
  const result=qualifyTwoAacMp4Source(assessment(fixture(cfg)));
  assert.equal(result.executionReady,false);assert.equal(result.videoTrackId,1);
  assert.deepEqual(result.audio.map(x=>[x.index,x.trackId]),[[1,2],[2,3]]);
  assert.equal(result.audio[1].default,Boolean(cfg.secondDefault));
  assert(result.audio.every(Object.isFrozen));assert(Object.isFrozen(result.audio));
});
for (const [name,mutate] of [
  ['HDR transfer',p=>p.streams[0].color_transfer='smpte2084'],
  ['landscape bound',p=>p.streams[0].height=1082],
  ['over 60 fps',p=>p.streams[0].avg_frame_rate='60001/1000'],
  ['non-square pixel',p=>p.streams[0].sample_aspect_ratio='4:3'],
  ['rotation',p=>p.streams[0].tags.rotate='90'],
  ['output-only merged metadata representation on source',p=>p.format.tags.major_brand='isom;isom'],
  ['MOV carrier under family alias',p=>p.format.tags.major_brand='qt  '],
  ['different rate',p=>p.streams[2].sample_rate='32000'],
  ['delayed audio track',p=>p.streams[2].start_pts=1024],
  ['wrong native AAC clock',p=>p.streams[2].time_base='1/1000'],
  ['DEU mono unreviewed',p=>p.streams[2].tags.language='deu'],
  ['two defaults',p=>p.streams[2].disposition.default=1],
  ['no default',p=>p.streams[1].disposition.default=0],
  ['dependent track',p=>p.streams[2].disposition.dependent=1],
  ['unknown AAC config',p=>delete p.streams[2].extradata_hash],
  ['duplicate track IDs',p=>p.streams[2].id=p.streams[1].id],
  ['auxiliary video',p=>{p.streams.push({...p.streams[0],id:'0x4',index:3});p.format.nb_streams=4;}],
]) test('ordinary typed refusal: '+name,()=>{
  const source=fixture();mutate(source);
  assert.throws(()=>qualifyTwoAacMp4Source(assessment(source)),{code:SOURCE});
});
test('other destination and deserialized assessment never acquire qualify-shape projection',()=>{
  assert.throws(()=>qualifyTwoAacMp4Source(assessment(fixture(),{target:'mov'})),{code:SOURCE});
  assert.throws(()=>qualifyTwoAacMp4Source(structuredClone(assessment())),{code:SOURCE});
});
test('plain payload, output freshness and runtime strings cannot turn structural evidence into a live collector receipt',()=>{
  const a=assessment(),fields={assessment:a,receipt:{status:'completed',runtimeIdentity:RUNTIME,essenceEvidence:{complete:true}},
    runtimeIdentity:RUNTIME,outputId:'7046a1f4-ca1e-4309-b4d9-b8851b27dbf7',outputProbe:fixture(),custody:null};
  assert.throws(()=>verifyTwoAacMp4Evidence(fields),{code:EVIDENCE,message:/live, matching current collector receipt/});
  assert.throws(()=>verifyTwoAacMp4Evidence({...fields,runtimeIdentity:'0'.repeat(64)}),{code:EVIDENCE,message:/exact paired/});
  const lazy={...fields,get receipt(){throw Error('must not invoke an accessor');}};
  assert.throws(()=>verifyTwoAacMp4Evidence(lazy),{code:EVIDENCE,message:/explicit main-owned/});
});
test('exact retained probes are admitted but a saved current-runtime collector is not live authority',
  {skip:!process.env.Q2L_ARCHIVED_MEDIA_PROBES||!process.env.Q2L_ARCHIVED_COLLECTOR},()=>{
    const bytes=fs.readFileSync(process.env.Q2L_ARCHIVED_MEDIA_PROBES);
    const sum=b=>crypto.createHash('sha256').update(b).digest('hex');
    assert.equal(sum(bytes),'e9709ae727204708f579416bbd3f22e56195e2b70950d9677917299a647916c1');
    const report=JSON.parse(bytes);
    for(const row of report.cases.filter(x=>!x.swap)){
      const shape=qualifyTwoAacMp4Source(assessment(row.sourceProbe));
      assert.deepEqual(shape.audio.map(x=>x.language),['eng','ara']);assert.equal(shape.audio[1].default,row.label==='twins');
    }
    const c=fs.readFileSync(process.env.Q2L_ARCHIVED_COLLECTOR);
    assert.equal(sum(c),'105a976b1755d6eccc573ea85b9b23152b30130c82000062d0a6ccf9dc473564');
    const receipt=JSON.parse(c), first=report.cases[0];
    assert.throws(()=>verifyTwoAacMp4Evidence({assessment:assessment(first.sourceProbe),receipt,runtimeIdentity:RUNTIME,
      outputId:receipt.outputId,outputProbe:first.outputProbe,custody:null}),{code:EVIDENCE,message:/persisted evidence/});
  });
test('separate pinned held-out 720p/1080p probes admit exact ordered combinations and refuse a real three-audio input',
  {skip:!process.env.Q2L_HELD_PROBE_ROOT},()=>{
    const read=(name,pin)=>{
      const b=fs.readFileSync(require('node:path').join(process.env.Q2L_HELD_PROBE_ROOT,name+'-probe.stdout'));
      assert.equal(crypto.createHash('sha256').update(b).digest('hex'),pin);return JSON.parse(b);
    };
    const mix=read('mixed-720','4d52693aee08969a4f7548359f3e41dc2d56ac149b4a4ffdda4660b236b4565d');
    const twin=read('twins-1080','425bc74f68fee7e9bcaa42dab9a99d2ac6ac40f768ade7b86fd599dc2ce433c2');
    const extra=read('three-aac-negative','fbd9a202f56be96e810857b13af1fb67f816e87b22d6d4bdee8ced317d087154');
    assert.deepEqual(qualifyTwoAacMp4Source(assessment(mix)).audio.map(t=>[t.language,t.rate,t.channels,t.default]),
      [['eng',48000,2,true],['ara',44100,1,false]]);
    assert.deepEqual(qualifyTwoAacMp4Source(assessment(twin)).audio.map(t=>[t.language,t.rate,t.channels,t.default]),
      [['eng',48000,2,false],['deu',48000,2,true]]);
    assert.throws(()=>qualifyTwoAacMp4Source(assessment(extra)),{code:SOURCE});
  });
