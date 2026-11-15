'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTransportIntegrity}=require('../src/remux-transport.cjs'),{table,pcr}=require('./helpers/remux-ts-witnesses.cjs');
const streams=[{id:'0x100',codec_type:'video',codec_name:'h264'}],programs=[{pmt_pid:4096,pcr_pid:256}];
function pes({random=true,nal=0x65,optional=0,scrambling=0}={}){const b=Buffer.alloc(188,255);b.set([71,65,0,48,1,random?64:0]);b.set([0,0,1,224,0,0,128|scrambling,128|optional,5,33,0,1,0,1,0,0,1,nal,0x88],6);return b;}
function bytes(options){return Buffer.concat([table(0,0),table(4096,2),pcr(90000),pes(options)]);}
function inspect(b,size=188){const c=createTransportIntegrity(streams,programs,{packetSize:size});for(let i=0;i<b.length;i+=37)c.push(b.subarray(i,i+37));return c.finish();}
test('asserted TS random access binds the complete own PES IDR, with an unasserted non-IDR neighbour admitted',()=>{
  assert.equal(inspect(bytes()).randomAccessCount,1);assert.equal(inspect(bytes({random:false,nal:0x41})).randomAccessCount,0);
  assert.throws(()=>inspect(bytes({nal:0x41})),{code:'REMUX_TS_RANDOM_ACCESS'});
  assert.throws(()=>inspect(bytes({nal:0x42})),{code:'REMUX_TS_RANDOM_ACCESS'});
  const b=bytes();b[3*188+1]&=~64;assert.throws(()=>inspect(b),{code:'REMUX_TS_RANDOM_ACCESS'});
});
test('every PES seeking control refuses its own field, beside the neutral timestamp-only header',()=>{
  inspect(bytes());for(const [options,code]of [[{scrambling:32},'REMUX_TS_PES_ENCRYPTED'],[{optional:8},'REMUX_TS_PES_TRICK_MODE'],...[32,16,4,2,1].map(optional=>[{optional},'REMUX_TS_PES_OPTIONAL'])])assert.throws(()=>inspect(bytes(options)),{code});
});
test('the whole declared random-access PES has an explicit budget, including its final byte',()=>{
  const limit=8*1024**2;
  function huge(length){const c=createTransportIntegrity(streams,programs,{packetSize:188});c.push(Buffer.concat([table(0,0),table(4096,2),pcr(90000)]));let used=0,counter=0;
    while(used<length){const first=used===0,header=first?Buffer.from([0,0,1,224,0,0,128,128,5,33,0,1,0,1]):Buffer.alloc(0),take=Math.min(length-used,first?168:184),payload=Buffer.alloc(take,255);if(first)payload.set([0,0,1,0x65,0x88]);
      const b=Buffer.alloc(188,255),body=Buffer.concat([header,payload]),extra=184-body.length,adapt=first||extra>0;assert.ok(!first||extra>=2);b.set([71,(first?64:0)|1,0,(adapt?48:16)|(counter++&15)]);let at=4;if(adapt){b[at++]=extra-1;if(extra>1)b[at]=first?64:0;at=4+extra;}body.copy(b,at);c.push(b);used+=take;
    }return c.finish();
  }
  assert.equal(huge(limit).randomAccessCount,1);assert.throws(()=>huge(limit+1),{code:'REMUX_TS_RANDOM_ACCESS'});
});
test('188-byte transport is accepted; unproved M2TS arrival controls and RS204 parity refuse with their own codes',()=>{
  const b=bytes(),wrap=size=>Buffer.concat(Array.from({length:b.length/188},(_,i)=>Buffer.concat([...(size===192?[Buffer.alloc(4,0x47)]:[]),b.subarray(i*188,(i+1)*188),...(size===204?[Buffer.alloc(16,0xa5)]:[])])));
  assert.equal(inspect(b,null).packetSize,188);assert.equal(inspect(b,188).randomAccessCount,1);
  for(const [size,code]of [[192,'REMUX_TS_M2TS_ARRIVAL_CONTROL'],[204,'REMUX_TS_RS204_PARITY']])for(const selected of [null,size])assert.throws(()=>inspect(wrap(size),selected),{code});
  assert.throws(()=>inspect(b.subarray(0,-1),null),{code:'REMUX_TS_FRAMING'});const bad=Buffer.from(b);bad[188]=0;assert.throws(()=>inspect(bad,null),{code:'REMUX_TS_FRAMING'});
  assert.throws(()=>inspect(b,200),{code:'REMUX_TS_FRAMING'});
});
