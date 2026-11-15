'use strict';
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {fixture,atom,element}=require('./native-inventory-collector.cjs');
const {MATROSKA_SCHEMA}=require('../../src/remux-native-inventory.cjs');
const {readNativeMetadata}=require('../../src/remux-native-reader.cjs');
const {mark}=require('./remux-witness-execution.cjs');
// Master rows have no independent scalar interpretation: their fields are
// their children, each with its own enforced row. Change only the master's
// child list in a source/output pair; the actual reader must reject it on
// either side, including masters streamed rather than retained in Clusters.
function registerStructures(registry,rows){
  for(const row of rows.filter(r=>r.witness==='structure:'+r.id))registry[row.witness]=async(t,r)=>{
    const f=await fixture(t,r.container),payload=bad=>{
      if(r.container==='isobmff')return atom(r.atom,Buffer.concat([r.atom==='meta'?Buffer.alloc(4):Buffer.alloc(0),bad?atom('zzzz',Buffer.alloc(0)):Buffer.alloc(0)]));
      const e=MATROSKA_SCHEMA.find(e=>e.id===r.element),names=e.name==='EBML'?['EBML']:e.path.split('\\').filter(Boolean).map(s=>s.replace(/^\+/,''));
      let b=bad?element(0x4abc,Buffer.alloc(0)):Buffer.alloc(0);
      for(const name of names.reverse())b=element(Number(MATROSKA_SCHEMA.find(p=>p.name===name).id),b);return b;
    },good=payload(false),bad=payload(true),read=file=>readNativeMetadata({file,family:r.container,withMetadata:async m=>[...m.seenTypes]});
    for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,good);
    assert.ok((await read(f.sourcePath)).includes(r.atom||r.element));assert.ok((await read(f.outputPath)).includes(r.atom||r.element));
    mark(t,'neutral');
    for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,bad);await assert.rejects(read(file),{code:'REMUX_NATIVE_UNCLASSIFIED'});mark(t,'refusal');await fs.writeFile(file,good);}
  };
}
module.exports={registerStructures};
