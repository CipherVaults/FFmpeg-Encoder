'use strict';
// Field-isolation witnesses run the real native readers and complete collector.
// The media/decoder side is injected only for these metadata guards. A witness
// must build both fixtures, pass its neutral pair and hit its named refusal on
// each changed side. No declaration-only fallback is registered here.
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {mark}=require('./remux-witness-execution.cjs');
const {fixture,isoEdit,atom,element,uint}=require('./native-inventory-collector.cjs');
const {MATROSKA_SCHEMA}=require('../../src/remux-native-inventory.cjs');
const {children,segmentParts}=require('./ebml-fixture.cjs');
const controls={
  'mvhd.rate':['mvhd',20,4,131072], 'mvhd.volume':['mvhd',24,2,0], 'mvhd.matrix':['mvhd',36,4,131072],
  'mvhd.timescale':['mvhd',12,4,120000], 'mvhd.duration':['mvhd',16,4,1],
  'tkhd.flags':['tkhd',1,3,0], 'tkhd.layer':['tkhd',32,2,1], 'tkhd.volume':['tkhd',36,2,256],
  'tkhd.matrix':['tkhd',40,4,131072], 'tkhd.width':['tkhd',76,4,65536], 'tkhd.height':['tkhd',80,4,65536],
  'tkhd.duration':['tkhd',20,4,1], 'mdhd.duration':['mdhd',16,4,1],
  'smhd.balance':['smhd',4,2,256], 'edts':['elst',16,2,2], 'elst':['elst',16,2,2],
};
async function refusePair(t,f,neutral,mutant,codes){
  for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,neutral);
  const good=await f.collect();assert.equal(good.status,'completed',JSON.stringify(good.failure));
  mark(t,'neutral');
  for(const file of [f.sourcePath,f.outputPath]){
    await fs.writeFile(file,mutant);const bad=await f.collect();assert.equal(bad.status,'failed','Field mutant was accepted: '+file);
    const side=file===f.sourcePath?'source':'output';if(Array.isArray(codes))assert.equal(codes.length,1,'A guard must have one intended failure per side.');assert.equal(bad.failure.code,Array.isArray(codes)?codes[0]:codes[side],JSON.stringify(bad.failure));await fs.writeFile(file,neutral);
    mark(t,'refusal');
  }
}
function insertMkv(bytes,row,payload){
  const e=MATROSKA_SCHEMA.find(e=>e.id===row.element),names=e.path.split('\\').filter(Boolean).map(s=>s.replace(/^\+/,''));
  const ids=names.map(name=>Number(MATROSKA_SCHEMA.find(e=>e.name===name).id));
  const visit=(bytes,depth)=>{let found=false;const out=children(bytes).map(n=>{
    const body=bytes.subarray(n.body,n.end);if(!found&&n.id===ids[depth]){found=true;return element(n.id,depth===ids.length-1?payload:visit(body,depth+1));}return element(n.id,body);
  });if(!found){let child=payload;for(let i=ids.length-1;i>=depth;i--)child=element(ids[i],child);out.push(child);}return Buffer.concat(out);};
  return visit(bytes,0);
}
const registry=Object.create(null);
for(const [field,[type,offset,width,value]]of Object.entries(controls))registry['isobmff:'+field]=async(t,row)=>{
  const f=await fixture(t,'isobmff'),mutant=isoEdit(f.original,type,h=>{h.writeUIntBE(value,offset,width);return h;});
  const codes=row.witnessCodes;
  await refusePair(t,f,f.original,mutant,codes);
};
registry['isobmff:mdhd.timescale']=async(t,row)=>{
  const {realWitness}=require('./remux-real-witness.cjs'),f=await realWitness(t,'isobmff'),good=await f.collect();
  assert.equal(good.status,'completed');assert.equal(f.validate(good).valid,true,JSON.stringify(f.validate(good)));
  mark(t,'neutral');
  await fs.writeFile(f.outputPath,isoEdit(f.original,'mdhd',h=>{h.writeUInt32BE(h.readUInt32BE(12)*2,12);return h;}));
  f.output.streams[0].time_base=(await f.probe(f.outputPath)).streams[0].time_base;
  const result=await f.collect();assert.equal(result.status,'failed');assert.equal(result.failure.code,row.witnessCodes.output);
  mark(t,'refusal');
};
for(const field of ['tapt','clef','prof','enof'])registry['isobmff:'+field]=async(t,row)=>{
  const f=await fixture(t,'isobmff'),mode=field==='tapt'?'clef':field;
  const make=width=>{const h=Buffer.alloc(12);h.writeUInt32BE(width*65536,4);h.writeUInt32BE(2*65536,8);
    return isoEdit(f.original,'trak',b=>Buffer.concat([b,atom('tapt',atom(mode,h))]));};
  await refusePair(t,f,make(2),make(1),['REMUX_TRACK_APERTURE_UNSUPPORTED']);
};
registry['isobmff:colr']=async(t,row)=>{
  const f=await fixture(t,'isobmff'),withColour=code=>isoEdit(f.original,'trak',b=>Buffer.concat([b,atom('colr',Buffer.from([110,99,108,120,0,code,0,1,0,1,0]))]));
  await refusePair(t,f,withColour(1),withColour(6),['REMUX_NATIVE_COLR_PROFILE']);
};
function registerReferences(rows){for(const row of rows.filter(r=>r.container==='isobmff'&&r.field.startsWith('tref.')))registry[row.id]=async(t,r)=>{
  const f=await fixture(t,'isobmff'),mutant=isoEdit(f.original,'trak',b=>Buffer.concat([b,atom('tref',atom(r.atom,Buffer.from([0,0,0,2])))]));
  await refusePair(t,f,f.original,mutant,['REMUX_NATIVE_TREF']);
};}
function registerParents(rows){for(const row of rows.filter(r=>r.container==='matroska'&&r.check.startsWith('parent-presence:')))registry[row.id]=async(t,r)=>{
  const parent=rows.find(p=>p.id===r.check.slice(16));assert.ok(parent&&parent.check==='absent');
  const f=await fixture(t,'matroska'),payload=r.type==='master'?Buffer.alloc(0):r.type==='uinteger'||r.type==='integer'?uint(1):Buffer.from('witness');
  await refusePair(t,f,f.original,insertMkv(f.original,r,payload),[parent.code]);
};}
module.exports={registry,registerReferences,registerParents,refusePair,insertMkv};
