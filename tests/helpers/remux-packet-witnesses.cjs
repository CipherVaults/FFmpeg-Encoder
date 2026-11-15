'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./remux-real-witness.cjs'),{mark}=require('./remux-witness-execution.cjs');
const {atom,fixture}=require('./native-inventory-collector.cjs');
const {element,children}=require('./ebml-fixture.cjs');
const {MATROSKA_SCHEMA}=require('../../src/remux-native-inventory.cjs');
const masters=new Set(MATROSKA_SCHEMA.filter(e=>e.type==='master').map(e=>Number(e.id)));
const packetFailures={stts:'REMUX_PACKET_TIMING',ctts:'REMUX_PACKET_REORDER',stsz:'REMUX_EVIDENCE_DECODE',stz2:'REMUX_EVIDENCE_DECODE',stsc:'REMUX_EVIDENCE_DECODE',stco:'REMUX_CODEC_PARAMETERS',co64:'REMUX_CODEC_PARAMETERS',stss:'REMUX_EVIDENCE_DECODE',mdat:'REMUX_PACKET_PAYLOAD',Timestamp:'REMUX_NATIVE_CUETIME',SimpleBlock:'REMUX_PACKET_PAYLOAD',Block:'REMUX_PACKET_PAYLOAD',BlockDuration:'REMUX_PACKET_TIMING'};
function isoRewrite(bytes,type,change){let found=false;const walk=b=>{const out=[];for(let at=0;at<b.length;){const size=b.readUInt32BE(at),name=b.toString('latin1',at+4,at+8);let body=Buffer.from(b.subarray(at+8,at+size)),tag=name;
  if(name===type&&!found){found=true;const r=change(body);body=r.body||r;tag=r.type||name;}else if(['moov','trak','mdia','minf','stbl','edts','mvex','moof','traf','dinf','mfra','sv3d','proj'].includes(name))body=walk(body);
  else if(['dref','stsd'].includes(name))body=Buffer.concat([body.subarray(0,8),walk(body.subarray(8))]);
  else if(['avc1','avc3','hvc1','hev1'].includes(name))body=Buffer.concat([body.subarray(0,78),walk(body.subarray(78))]);
  else if(name==='mp4a'&&body.length>=28){const version=body.readUInt16BE(8),head=version===1?44:version===2?64:28;body=Buffer.concat([body.subarray(0,head),walk(body.subarray(head))]);}
  out.push(atom(tag,body));at+=size;}return Buffer.concat(out);};const out=walk(bytes);assert.ok(found,'missing ISO witness field '+type);return out;}
function ebmlRewrite(bytes,id,change,predicate=()=>true){let found=false;const walk=b=>Buffer.concat(children(b).map(n=>{let body=Buffer.from(b.subarray(n.body,n.end)),tag=n.id;if(n.id===id&&!found&&predicate(body,n)){found=true;const result=change(body,n);if(result===null)return Buffer.alloc(0);body=result.body||result;tag=result.id||tag;}else if(masters.has(n.id))body=walk(body);return element(tag,body);}));const result=walk(bytes);assert.ok(found,'missing Matroska witness field 0x'+id.toString(16));return result;}
function compact(bytes){return isoRewrite(bytes,'stsz',b=>{const count=b.readUInt32BE(8),size=b.readUInt32BE(4),out=Buffer.alloc(12+count*2);out[7]=16;out.writeUInt32BE(count,8);for(let i=0;i<count;i++)out.writeUInt16BE(size||b.readUInt32BE(12+i*4),12+i*2);return{type:'stz2',body:out};});}
function wideOffsets(bytes){return isoRewrite(bytes,'stco',b=>{const count=b.readUInt32BE(4),out=Buffer.alloc(8+count*8);out.writeUInt32BE(count,4);for(let i=0;i<count;i++)out.writeBigUInt64BE(BigInt(b.readUInt32BE(8+i*4)),8+i*8);return{type:'co64',body:out};});}
function blockForm(field,padding=0n){return bytes=>{
  let firstVideo,lastAudio;
  if(field==='DiscardPadding'){const scan=b=>{for(const n of children(b)){const body=b.subarray(n.body,n.end);if(n.id===0xa3&&body[0]===0x82)lastAudio=body.readInt16BE(1);else if(masters.has(n.id))scan(body);}};scan(bytes);assert.notEqual(lastAudio,undefined);}
  if(field==='ReferenceBlock')ebmlRewrite(bytes,0xa3,b=>{firstVideo=b.readInt16BE(1);return b;},b=>b[0]===0x81);
  const changed=ebmlRewrite(bytes,0xa3,b=>{
    const original=Buffer.from(b);original[3]&=0x0e;const extra=[];
    if(field==='BlockDuration'||field==='Block')extra.push(element(0x9b,Buffer.from([40])));
    if(field==='ReferenceBlock'){const ref=Buffer.alloc(2);ref.writeInt16BE(firstVideo-b.readInt16BE(1));extra.push(element(0xfb,ref));}
    if(field==='DiscardPadding'){const pad=Buffer.alloc(8);pad.writeBigInt64BE(padding);extra.push(element(0x75a2,pad));}
    return{id:0xa0,body:Buffer.concat([element(0xa1,original),...extra])};
  },b=>field==='ReferenceBlock'?b[0]===0x81&&!(b[3]&0x80):field==='DiscardPadding'?b[0]===0x82&&b.readInt16BE(1)===lastAudio:b[0]===0x81);
  return require('./remux-matroska-relocate.cjs').relocateMatroska(bytes,changed);
};}
function registerPackets(registry,rows){for(const row of rows.filter(r=>r.witness==='packet:'+r.id))registry[row.witness]=async(t,r)=>{
  const family=r.container,f=await realWitness(t,family,{audio:family==='matroska',transform:r.field==='stz2'?compact:r.field==='co64'?wideOffsets:['Block','BlockDuration','ReferenceBlock','DiscardPadding'].includes(r.field)?blockForm(r.field):undefined}),good=await f.collect();
  assert.equal(good.status,'completed',JSON.stringify(good.failure));assert.equal(f.validate(good).valid,true,JSON.stringify(f.validate(good)));mark(t,'neutral');
  let mutant;
  if(family==='isobmff')mutant=isoRewrite(f.original,r.atom,b=>{
    if(['stts','ctts'].includes(r.field))b.writeUInt32BE(b.readUInt32BE(12)+512,12);
    else if(r.field==='stsz'){const at=b.readUInt32BE(4)?4:12;b.writeUInt32BE(b.readUInt32BE(at)+1,at);}
    else if(r.field==='stz2')b.writeUInt16BE(b.readUInt16BE(12)+1,12);
    else if(r.field==='stsc')b.writeUInt32BE(b.readUInt32BE(12)+1,12);
    else if(r.field==='stco')b.writeUInt32BE(b.readUInt32BE(8)+1,8);
    else if(r.field==='co64')b.writeBigUInt64BE(b.readBigUInt64BE(8)+1n,8);
    else if(r.field==='stss')b.writeUInt32BE(2,8);
    else if(r.field==='mdat')b[b.length-1]^=1;
    else assert.fail('missing ISO packet mutant');return b;
  });
  else mutant=ebmlRewrite(f.original,Number(r.element),b=>{
    if(r.field==='Timestamp'){b.fill(250);return b;}
    if(['SimpleBlock','Block'].includes(r.field)){b[b.length-1]^=1;return b;}
    if(r.field==='ReferenceBlock')return null;
    if(r.field==='DiscardPadding'){b.writeBigInt64BE(21333333n);return b;}
    if(r.field==='BlockDuration'){b.fill(1);return b;}
    assert.fail('missing Matroska packet mutant');
  });
  if(family==='matroska')mutant=require('./remux-matroska-relocate.cjs').relocateMatroska(f.original,mutant);
  await fs.writeFile(f.outputPath,mutant);const bad=await f.collect();
  assert.equal(bad.status,'failed','Named covering check did not refuse '+r.id);assert.equal(bad.failure.code,packetFailures[r.field],JSON.stringify(bad.failure));assert.ok(r.check.includes(packetFailures[r.field]),'Inventory does not name the witnessed covering check.');
  mark(t,'refusal');
};}
function fragmentFixture(){const {timedFixture}=require('./mov-fixture.cjs');let b=timedFixture([{id:1,scale:90000,pts:[0],durations:[3000]}]);
  for(const type of ['mvhd','tkhd','mdhd'])b=isoRewrite(b,type,h=>{h.writeUInt32BE(0,type==='tkhd'?20:16);return h;});
  b=isoRewrite(b,'edts',h=>({type:'free',body:h}));b=isoRewrite(b,'stsz',h=>{h.writeUInt32BE(0,8);return h;});for(const type of ['stts','ctts'])b=isoRewrite(b,type,()=>Buffer.alloc(8));
  const trex=Buffer.alloc(24);trex.writeUInt32BE(1,4);trex.writeUInt32BE(1,8);trex.writeUInt32BE(3000,12);trex.writeUInt32BE(1,16);b=isoRewrite(b,'moov',h=>Buffer.concat([h,atom('mvex',atom('trex',trex))]));
  const tfhd=Buffer.alloc(8);tfhd.writeUIntBE(0x20000,1,3);tfhd.writeUInt32BE(1,4);const trun=Buffer.alloc(8);trun.writeUInt32BE(2,4);
  return Buffer.concat([b,atom('moof',atom('traf',Buffer.concat([atom('tfhd',tfhd),atom('tfdt',Buffer.alloc(8)),atom('trun',trun)]))),atom('mdat',Buffer.alloc(2))]);
}
function registerFragments(registry,rows){for(const row of rows.filter(r=>r.witness==='fragment:'+r.id))registry[row.witness]=async(t,r)=>{
  const f=await fixture(t,'isobmff'),good=fragmentFixture(),probe={streams:[f.source.streams[0]]},read=async file=>require('../../src/remux-edit-lists.cjs').observeRemuxSourcePlayback({file,probe,target:'mp4',maxRecords:100,identity:await require('../../src/source-identity.cjs').readSourceIdentity(file)});
  for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,good);assert.equal((await read(file)).tracks[0].fragmentCoverage.samples,'2');}mark(t,'neutral');
  const bad=isoRewrite(good,r.atom,b=>{if(r.atom==='trex')b.writeUInt32BE(0,12);if(r.atom==='tfhd')b.writeUInt32BE(2,4);if(r.atom==='tfdt')b[0]=2;if(r.atom==='trun')b.writeUInt32BE(101,4);return b;});
  for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,bad);await assert.rejects(read(file),{code:'REMUX_SOURCE_FRAGMENT_UNVERIFIED'});mark(t,'refusal');}
};}
module.exports={registerPackets,registerFragments,isoRewrite,ebmlRewrite,compact,wideOffsets,fragmentFixture,blockForm};
