'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {fixture,isoEdit,atom}=require('./helpers/native-inventory-collector.cjs'),{INVENTORY}=require('../src/remux-native-inventory.cjs');
async function pair(f,good,bad,codes){for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,good);assert.equal((await f.collect()).status,'completed');
  for(const [i,file]of [f.sourcePath,f.outputPath].entries()){await fs.writeFile(file,bad);const result=await f.collect();assert.equal(result.status,'failed');assert.equal(result.failure.code,codes[i]||codes[0],JSON.stringify(result.failure));await fs.writeFile(file,good);}}
for(const type of ['mvhd','tkhd'])test(type+' matrix: every independent coefficient is exercised',async t=>{
  const f=await fixture(t,'isobmff'),row=INVENTORY.find(r=>r.id==='isobmff:'+type+'.matrix');for(let i=0;i<9;i++)await pair(f,f.original,isoEdit(f.original,type,b=>{const at=(type==='mvhd'?36:40)+i*4;b.writeInt32BE(b.readInt32BE(at)+1,at);return b;}),[row.witnessCodes.source,row.witnessCodes.output]);
});
test('each aperture mode tests width and height separately; each enumerated colour component is isolated',async t=>{
  const f=await fixture(t,'isobmff');for(const type of ['clef','prof','enof'])for(const dimension of [4,8]){const good=Buffer.alloc(12);good.writeUInt32BE(2*65536,4);good.writeUInt32BE(2*65536,8);const bad=Buffer.from(good);bad.writeUInt32BE(65536,dimension);const add=b=>isoEdit(f.original,'trak',p=>Buffer.concat([p,atom('tapt',atom(type,b))]));await pair(f,add(good),add(bad),['REMUX_TRACK_APERTURE_UNSUPPORTED']);}
  const colour=Buffer.from('6e636c7800010001000100','hex'),add=b=>isoEdit(f.original,'trak',p=>Buffer.concat([p,atom('colr',b)]));for(const offset of [5,7,9,10]){const bad=Buffer.from(colour);bad[offset]=offset===10?128:6;await pair(f,add(colour),add(bad),['REMUX_NATIVE_COLR_PROFILE']);}
});
test('elst flags, entry count, media start, segment duration and both rate components each have a separate witness',async t=>{
  const f=await fixture(t,'isobmff'),cases=[
    ['flags',b=>{b[3]=1;return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_LIST_UNEXPECTED'],
    ['count',b=>{b.writeUInt32BE(0,4);return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_LIST_UNEXPECTED'],
    ['segment_duration',b=>{b.writeUInt32BE(1,8);return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_LIST_UNEXPECTED'],
    ['media_time',b=>{b.writeInt32BE(1,12);return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_LIST_UNEXPECTED'],
    ['rate_integer',b=>{b.writeInt16BE(2,16);return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_RATE_UNSUPPORTED'],
    ['rate_fraction',b=>{b.writeInt16BE(1,18);return b;},'REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_RATE_UNSUPPORTED']
  ];for(const [name,change,...codes]of cases){await pair(f,f.original,isoEdit(f.original,'elst',change),codes);t.diagnostic('enforced elst.'+name);}
});
