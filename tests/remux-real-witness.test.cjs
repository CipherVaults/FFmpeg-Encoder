'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoEdit}=require('./helpers/native-inventory-collector.cjs');
for(const family of ['isobmff','matroska'])test('real native witness neutral pair: '+family,async t=>{
  const f=await realWitness(t,family),r=await f.collect();assert.equal(r.status,'completed',JSON.stringify(r.failure));assert.equal(f.validate(r).valid,true,JSON.stringify(f.validate(r)));
});
test('real ISO audio witness neutral pair',async t=>{
  const f=await realWitness(t,'isobmff',{audio:true}),r=await f.collect();assert.equal(r.status,'completed',JSON.stringify(r.failure));assert.equal(f.validate(r).valid,true,JSON.stringify(f.validate(r)));
});
test('real mdhd timescale field is enforced by complete native timestamp evidence',async t=>{
  const f=await realWitness(t,'isobmff'),good=await f.collect();assert.equal(good.status,'completed');assert.equal(f.validate(good).valid,true,JSON.stringify(f.validate(good)));
  await fs.writeFile(f.outputPath,isoEdit(f.original,'mdhd',h=>{h.writeUInt32BE(h.readUInt32BE(12)*2,12);return h;}));
  f.output.streams[0].time_base=(await f.probe(f.outputPath)).streams[0].time_base;
  const r=await f.collect();if(r.status==='failed'){t.diagnostic(JSON.stringify(r.failure));assert.equal(r.failure.code,'REMUX_PACKET_TIMING');}
  else{const result=f.validate(r);assert.equal(result.valid,false);assert.ok(result.errors.some(s=>/maxPtsError|maxDurationError/.test(s)),JSON.stringify(result));}
});
