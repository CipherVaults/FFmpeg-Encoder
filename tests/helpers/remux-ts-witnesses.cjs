'use strict';
const assert=require('node:assert/strict'),{mark}=require('./remux-witness-execution.cjs');
const {createTransportIntegrity,transportClock,canonicalTransportAudio,canonicalTransportVideo}=require('../../src/remux-transport.cjs');
const {initialization}=require('../../src/remux-transport-evidence.cjs'),a=require('./remux-admission-fixture.cjs');
const streams=[{id:'0x100',codec_type:'video'}],programs=[{pmt_pid:4096,pcr_pid:256}];
function crc(bytes){let c=0xffffffff;for(const v of bytes){c^=v<<24;for(let i=0;i<8;i++)c=c&0x80000000?(c<<1)^0x04c11db7:c<<1;}return c>>>0;}
function table(pid,id,cc=0){const section=Buffer.from(id===2?[2,176,18,0,1,193,0,0,225,0,240,0,27,225,0,240,0,0,0,0,0]:[0,176,13,0,1,193,0,0,0,1,240,0,0,0,0,0]);section.writeUInt32BE(crc(section.subarray(0,-4)),section.length-4);const b=Buffer.alloc(188,255);b.set([71,64|(pid>>8),pid&255,16|cc,0]);section.copy(b,5);return b;}
function pcr(base,cc=0){const b=Buffer.alloc(188,255);b.set([71,1,0,32|cc,183,16]);const v=BigInt(base);b[6]=Number(v>>25n);b[7]=Number(v>>17n&255n);b[8]=Number(v>>9n&255n);b[9]=Number(v>>1n&255n);b[10]=Number(v&1n)*128+126;b[11]=0;return b;}
function registerTransport(registry,rows){for(const row of rows.filter(r=>r.witness==='transport:'+r.field))registry[row.witness]=async(t,r)=>{
  let neutral,mutant,check,code;
  if(['PAT','PMT'].includes(r.field)){
    const pid=r.field==='PAT'?0:4096,id=r.field==='PAT'?0:2,next=table(pid,id,1),pes=Buffer.alloc(188,255);pes.set([71,65,0,16,0,0,1,224,0,0,128,128,5,33,0,1,0,1]);
    neutral=Buffer.concat([table(0,0),table(4096,2),pcr(90000),pes,next]);mutant=Buffer.from(neutral);mutant[4*188+10]=195;const start=4*188+5,end=start+3+(mutant[start+1]&15)*256+mutant[start+2];mutant.writeUInt32BE(crc(mutant.subarray(start,end-4)),end-4);
    check=bytes=>{const c=createTransportIntegrity(streams,programs);c.push(bytes);return c.finish();};code='REMUX_TS_PROGRAM_CHANGED';
  }else if(r.field==='PCR'){
    const pes=Buffer.alloc(188,255);pes.set([71,65,0,16,0,0,1,224,0,0,128,128,5,33,0,1,0,1]);const first=Buffer.concat([table(0,0),table(4096,2),pcr(90000),pes]);neutral=Buffer.concat([first,pcr(90001)]);mutant=Buffer.concat([first,pcr(89999)]);
    check=bytes=>{const c=createTransportIntegrity(streams,programs);c.push(bytes);return c.finish();};code='REMUX_TS_PCR_BACKWARDS';
  }else if(r.field==='PTS_DTS'){
    neutral=[{pts:9000,dts:6000},{pts:12000,dts:9000}];mutant=[neutral[0],{pts:12000,dts:5999}];
    check=packets=>{const c=transportClock({codec_type:'video',time_base:'1/90000'});for(const p of packets)c(p);};code='REMUX_TS_DTS_BACKWARDS';
  }else if(['M2TS_arrival_control','RS204_parity'].includes(r.field)){
    const pes=Buffer.alloc(188,255);pes.set([71,65,0,16,0,0,1,224,0,0,128,128,5,33,0,1,0,1]);neutral=Buffer.concat([table(0,0),table(4096,2),pcr(90000),pes]);
    mutant=Buffer.concat(Array.from({length:4},(_,i)=>Buffer.concat([...(r.field==='M2TS_arrival_control'?[Buffer.alloc(4)]:[]),neutral.subarray(i*188,(i+1)*188),...(r.field==='RS204_parity'?[Buffer.alloc(16)]:[])])));
    check=bytes=>{const c=createTransportIntegrity(streams,programs);c.push(bytes);return c.finish();};code=r.code;
  }else if(['random_access_indicator','PES_optional_seek_controls','PES_trick_mode','PES_scrambling'].includes(r.field)){
    const pes=Buffer.alloc(188,255);pes.set([71,65,0,48,1,0],0);pes.set([0,0,1,224,0,0,128,128,21,33,0,1,0,1],6);pes.set([0,0,1,0x41,0x88],36);
    neutral=Buffer.concat([table(0,0),table(4096,2),pcr(90000),pes]);mutant=Buffer.from(neutral);const at=3*188;
    if(r.field==='random_access_indicator')mutant[at+5]=64;
    if(r.field==='PES_scrambling')mutant[at+12]|=32;
    if(r.field==='PES_trick_mode'){mutant[at+13]|=8;mutant[at+20]=0;}
    if(r.field==='PES_optional_seek_controls'){mutant[at+13]|=4;mutant[at+20]=128;}
    check=bytes=>{const c=createTransportIntegrity(streams,programs);c.push(bytes);return c.finish();};code=r.code;
  }else if(r.field==='ADTS'){
    const payload=Buffer.from([1,2,3]),n=payload.length+7;neutral=Buffer.concat([Buffer.from([255,241,76,64|(n>>11),(n>>3)&255,((n&7)<<5)|31,252]),payload]);mutant=Buffer.from(neutral);mutant[2]^=4;
    const config=Buffer.from([17,136]);
    check=bytes=>canonicalTransportAudio(bytes,'adts',config,{sample_rate:'48000',channels:1});code='REMUX_TS_ADTS_CONFIG';
  }else{
    const stream={codec_type:'video',codec_name:'h264',profile:'High',level:40,width:2,height:2,pix_fmt:'yuv420p',field_order:'progressive',sample_aspect_ratio:'1:1',color_range:'tv',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709'},
      nals=[a.sps({width:2,height:2,level:40}),a.pps(),a.sei(),a.packet(0).subarray(4)],admitted=initialization(nals,stream);
    const bytes=ns=>Buffer.concat(ns.flatMap(n=>[Buffer.from([0,0,0,1]),n]));neutral=bytes(nals);const changed=nals.map(n=>Buffer.from(n));changed[0]=a.sps({width:2,height:2,level:41});mutant=bytes(changed);
    check=b=>canonicalTransportVideo(b,'annexb',admitted,true);code='REMUX_TS_PARAMETER_CHANGE';
  }
  const pair=[neutral,Buffer.isBuffer(neutral)?Buffer.from(neutral):structuredClone(neutral)];mark(t,'fixture');for(const side of pair)check(side);mark(t,'neutral');
  for(let side=0;side<2;side++){const bad=[...pair];bad[side]=mutant;assert.throws(()=>check(bad[side]),e=>{assert.equal(e.code,code);return true;});mark(t,'refusal');}
};}
module.exports={registerTransport,table,pcr};
