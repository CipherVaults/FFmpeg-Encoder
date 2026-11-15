'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoRewrite,ebmlRewrite,blockForm}=require('./helpers/remux-packet-witnesses.cjs');
const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),{children,element,uint}=require('./helpers/ebml-fixture.cjs');
const {MATROSKA_SCHEMA}=require('../src/remux-native-inventory.cjs');
const masters=new Set(MATROSKA_SCHEMA.filter(r=>r.type==='master').map(r=>Number(r.id)));
const native=(f,family)=>observeNativeInventory({file:f.sourcePath,probe:f.source,family,target:family==='matroska'?'matroska':'mp4'});
function soundVersion(bytes,version,stream){return isoRewrite(bytes,'mp4a',b=>{const head=Buffer.from(b.subarray(0,28));head.writeUInt16BE(version,8);head.writeUInt16BE(version?65534:0,20);const extra=Buffer.alloc(version===1?16:version===2?36:0);
  if(version===1){extra.writeUInt32BE(1024,0);extra.writeUInt32BE(2,12);}if(version===2){extra.writeUInt32BE(72,0);extra.writeDoubleBE(Number(stream.sample_rate),4);extra.writeUInt32BE(stream.channels,12);extra.writeUInt32BE(0x7f000000,16);extra.writeUInt32BE(16,20);extra.writeUInt32BE(1024,32);}return Buffer.concat([head,extra,b.subarray(28)]);});}
test('QuickTime sound versions0/1/2 are native neighbours; each independent interpretation field has its own mutation',async t=>{
  const f=await realWitness(t,'isobmff',{audio:true}),stream=f.source.streams.find(s=>s.codec_type==='audio');
  for(const version of [0,1,2]){const good=soundVersion(f.original,version,stream);await fs.writeFile(f.sourcePath,good);await native(f,'isobmff');const actual=await f.probe(f.sourcePath);assert.equal(actual.streams[1].sample_rate,stream.sample_rate);assert.equal(actual.streams[1].channels,stream.channels);
    const fields=[[16,2,7],[18,2,24],[20,2,1],[22,2,1],...(version<2?[[24,4,44100*65536]]:[]),...(version===1?[[28,4,2048],[32,4,1],[36,4,1],[40,4,4]]:[]),...(version===2?[[28,4,71],[40,4,7],[44,4,0],[48,4,24],[52,4,1],[56,4,1],[60,4,2048]]:[])];
    for(const [offset,width,value]of fields){await fs.writeFile(f.sourcePath,isoRewrite(good,'mp4a',b=>{b.writeUIntBE(value,offset,width);return b;}));await assert.rejects(native(f,'isobmff'),{code:'REMUX_NATIVE_MP4A'},'version'+version+' field'+offset);}
    if(version===2){await fs.writeFile(f.sourcePath,isoRewrite(good,'mp4a',b=>{b.writeDoubleBE(44100,32);return b;}));await assert.rejects(native(f,'isobmff'),{code:'REMUX_NATIVE_MP4A'});}
  }
});
test('every SimpleBlock presentation flag and track/time header is enforced independently',async t=>{
  const f=await realWitness(t,'matroska'),mutate=change=>{const out=Buffer.from(f.original);let found=false;function walk(a,b){for(const n of children(out,a,b)){if(n.id===0xa3&&!found&&out[n.body]===0x81){change(out.subarray(n.body,n.end));found=true;}else if(masters.has(n.id))walk(n.body,n.end);}}walk(0,out.length);assert.ok(found);return out;};
  await native(f,'matroska');for(const bit of [1,2,4,8,16,32,64,128]){await fs.writeFile(f.sourcePath,mutate(b=>{b[3]^=bit;}));await assert.rejects(native(f,'matroska'),{code:'REMUX_NATIVE_BLOCK_FLAGS'},'flag'+bit);}
  await fs.writeFile(f.sourcePath,mutate(b=>{b[0]=0xff;}));await assert.rejects(native(f,'matroska'),{code:'REMUX_NATIVE_TRACK_MAP'});
  await fs.writeFile(f.sourcePath,mutate(b=>{b.writeInt16BE(b.readInt16BE(1)+1,1);}));await assert.rejects(native(f,'matroska'),{code:'REMUX_NATIVE_CUETIME'});
  const discardable=Buffer.from(f.original);let found=false;function mark(a,b){for(const n of children(discardable,a,b)){if(n.id===0xa3&&!found&&discardable[n.body]===0x81){let at=n.body+4;while(at+4<n.end){const length=discardable.readUInt32BE(at);at+=4;if((discardable[at]&31)===1&&!(discardable[at]&96)){discardable[n.body+3]|=1;found=true;break;}at+=length;}}else if(masters.has(n.id))mark(n.body,n.end);}}mark(0,discardable.length);assert.ok(found);await fs.writeFile(f.sourcePath,discardable);await native(f,'matroska');
});
test('a single native BlockDuration is accepted and a conflicting duplicate refuses its own guard',async t=>{
  const f=await realWitness(t,'matroska',{transform:blockForm('BlockDuration')});await native(f,'matroska');
  const bad=ebmlRewrite(f.original,0xa0,b=>Buffer.concat([b,element(0x9b,uint(41))]));await fs.writeFile(f.sourcePath,bad);await assert.rejects(native(f,'matroska'),{code:'REMUX_NATIVE_BLOCKDURATION'});
});
module.exports={soundVersion};
