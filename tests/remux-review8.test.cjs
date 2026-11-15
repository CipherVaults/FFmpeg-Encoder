'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./helpers/remux-real-witness.cjs');
const {isoRewrite}=require('./helpers/remux-packet-witnesses.cjs');
const {atom}=require('./helpers/mov-fixture.cjs');
const {observeNativeInventory}=require('../src/remux-native-checks.cjs');
const native=f=>observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4'});
function metaFraming(bytes,prefix){let found=0;const visit=b=>{const out=[];for(let at=0;at<b.length;){const size=b.readUInt32BE(at),type=b.toString('latin1',at+4,at+8);assert.ok(size>=8&&at+size<=b.length);let body=b.subarray(at+8,at+size);
  if(type==='meta'){assert.equal(body.readUInt32BE(0),0);assert.equal(body.toString('latin1',8,12),'hdlr');body=Buffer.concat([prefix,body.subarray(4)]);found++;}
  else if(['moov','trak','mdia','minf','stbl','udta'].includes(type))body=visit(body);out.push(atom(type,body));at+=size;}return Buffer.concat(out);};const result=visit(bytes);assert.ok(found);return result;}
test('review8 reproduction: esds tail beyond the old prefix cap must be inspected or refused',async t=>{
  const f=await realWitness(t,'isobmff',{audio:true});await native(f);
  const mutant=isoRewrite(f.original,'esds',body=>{const left=65536-body.length;let five=0;while((left-five*5)%3)five++;assert.ok(left-five*5>=0);return Buffer.concat([body,...Array.from({length:five},()=>Buffer.from([3,3,0,0,0])),...Array.from({length:(left-five*5)/3},()=>Buffer.from([6,1,2])),Buffer.from([127,0])]);});
  await fs.writeFile(f.sourcePath,mutant);
  await assert.rejects(native(f),{code:'REMUX_NATIVE_ESDS'});
});
test('review8 reproduction: QuickTime metadata without a FullBox prefix',async t=>{
  const f=await realWitness(t,'isobmff'),qt=isoRewrite(f.original,'ftyp',b=>{b.write('qt  ',0);return b;});
  await fs.writeFile(f.sourcePath,qt);await native(f);
  const noPrefix=metaFraming(qt,Buffer.alloc(0));await fs.writeFile(f.sourcePath,noPrefix);
  await native(f);
  await fs.writeFile(f.sourcePath,metaFraming(qt,Buffer.from([1,0,0,0])));await native(f);
});
test('compatible and major brands declare no decoding change, including Canon CAEP and an unknown declaration',async t=>{
  const f=await realWitness(t,'isobmff');for(const brand of ['CAEP','zzzz','qt  '])for(const offset of [0,12]){const good=isoRewrite(f.original,'ftyp',b=>{b.write(brand,offset);return b;});await fs.writeFile(f.sourcePath,good);await native(f);}
});
test('the exact ES descriptor budget is accepted, its over-budget and nested neighbours refuse their own code',async t=>{
  const f=await realWitness(t,'isobmff',{audio:true});const atLimit=isoRewrite(f.original,'esds',b=>{assert.equal((65536-b.length)%3,0);return Buffer.concat([b,Buffer.from(Array((65536-b.length)/3).fill([6,1,2]).flat())]);});await fs.writeFile(f.sourcePath,atLimit);await native(f);
  const over=isoRewrite(atLimit,'esds',b=>Buffer.concat([b,Buffer.from([6,1,2])]));await fs.writeFile(f.sourcePath,over);await assert.rejects(native(f),{code:'REMUX_NATIVE_ESDS'});
  const nested=depth=>isoRewrite(f.original,'esds',b=>{let tail=b.subarray(4);for(let i=0;i<depth;i++){const n=tail.length+3,len=[];let v=n;do{len.unshift(v&127);v>>>=7;}while(v);for(let j=0;j<len.length-1;j++)len[j]|=128;tail=Buffer.concat([Buffer.from([3,...len,0,0,0]),tail]);}return Buffer.concat([Buffer.alloc(4),tail]);});
  await fs.writeFile(f.sourcePath,nested(8));await native(f);await fs.writeFile(f.sourcePath,nested(13));await assert.rejects(native(f),{code:'REMUX_NATIVE_ESDS'});
});
module.exports={metaFraming};
