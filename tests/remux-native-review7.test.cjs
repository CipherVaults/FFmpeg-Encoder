'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {fixture,isoEdit,atom,element,uint}=require('./helpers/native-inventory-collector.cjs');
const {observeNativeInventory}=require('../src/remux-native-checks.cjs');
const {INVENTORY,assertInventory}=require('../src/remux-native-inventory.cjs');
const native=f=>observeNativeInventory({file:f.sourcePath,probe:f.source,family:'matroska',target:'mp4'});
const {children,segmentParts}=require('./helpers/ebml-fixture.cjs');
function addVideo(bytes,payload){const {prefix,parts}=segmentParts(bytes);
  return Buffer.concat([prefix,element(0x18538067,Buffer.concat(parts.map(p=>p.id!==0x1654ae6b?p.bytes:element(p.id,Buffer.concat(children(p.body).map(t=>{
    const body=p.body.subarray(t.body,t.end);return element(t.id,Buffer.concat(children(body).map(n=>element(n.id,n.id===0xe0?Buffer.concat([body.subarray(n.body,n.end),payload]):body.subarray(n.body,n.end)))));
  }))))))]);
}
test('copy and dither-copy ignore operand colours; blend remains refused',async t=>{
  const f=await fixture(t,'isobmff');
  for(const mode of [0,64,32]){
    const h=Buffer.alloc(12);h.writeUInt16BE(mode,4);h.fill(17,6);
    for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,isoEdit(f.original,'minf',b=>Buffer.concat([b,atom('vmhd',h)])));
    const r=await f.collect();assert.equal(r.status,mode===32?'failed':'completed',JSON.stringify(r.failure));
    if(mode===32)assert.equal(r.failure.code,'REMUX_NATIVE_VMHD_GRAPHICS_MODE');
  }
});
test('zero dependencies equal absence; any dependency bit is still enforced',async t=>{
  const f=await fixture(t,'isobmff');
  for(const bit of [0,0x20,1]){
    const b=Buffer.from([0,0,0,0,bit,0]);await fs.writeFile(f.sourcePath,isoEdit(f.original,'stbl',h=>Buffer.concat([h,atom('sdtp',b)])));
    const r=await f.collect();assert.equal(r.status,bit?'failed':'completed',JSON.stringify(r.failure));
    if(bit)assert.equal(r.failure.code,'REMUX_NATIVE_SDTP');
  }
  for(const malformed of [Buffer.from([1,0,0,0,0,0]),Buffer.alloc(5),Buffer.alloc(7)]){
    await fs.writeFile(f.sourcePath,isoEdit(f.original,'stbl',h=>Buffer.concat([h,atom('sdtp',malformed)])));
    const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,'REMUX_NATIVE_SDTP');
  }
});
test('empty EBML integers/floats use declared defaults; non-neutral neighbours refuse',async t=>{
  const f=await fixture(t,'matroska');
  for(const [id,good,bad]of [[0x54cc,Buffer.alloc(0),uint(1)],[0x54b2,Buffer.alloc(0),uint(2)]]){
    await fs.writeFile(f.sourcePath,addVideo(f.original,element(id,good)));assert.equal((await f.collect()).status,'completed');
    await fs.writeFile(f.sourcePath,addVideo(f.original,element(id,bad)));assert.equal((await f.collect()).status,'failed');
  }
  const gamma=INVENTORY.find(r=>r.container==='matroska'&&r.field==='GammaValue');
  await fs.writeFile(f.sourcePath,addVideo(f.original,element(Number(gamma.element),Buffer.alloc(0))));assert.equal((await f.collect()).status,'completed');
  const bad=Buffer.alloc(8);bad.writeDoubleBE(1);
  await fs.writeFile(f.sourcePath,addVideo(f.original,element(Number(gamma.element),bad)));assert.equal((await f.collect()).status,'failed');
});
test('chapter languages and hierarchy refuse only forms the pinned muxer cannot carry',async t=>{
  const f=await fixture(t,'matroska'),{prefix,parts}=segmentParts(f.original),base=Buffer.concat(parts.map(p=>p.bytes));
  f.source.chapters=[{id:1,time_base:'1/1000000000',start:0,end:2000000000,tags:{title:'Chapter'}}];
  const withChapter=(language,nested=false)=>Buffer.concat([prefix,element(0x18538067,Buffer.concat([base,element(0x1043a770,element(0x45b9,
    element(0xb6,Buffer.concat([element(0x91,uint(0)),element(0x80,Buffer.concat([element(0x85,Buffer.from('Chapter')),element(0x437c,Buffer.from(language))])),...(nested?[element(0xb6,element(0x91,uint(1)))]:[])]))))]))]);
  await fs.writeFile(f.sourcePath,withChapter('eng'));await native(f);
  await fs.writeFile(f.sourcePath,withChapter('fra'));await assert.rejects(native(f),{code:'REMUX_NATIVE_CHAPLANGUAGE'});
  await fs.writeFile(f.sourcePath,withChapter('eng',true));await assert.rejects(native(f),{code:'REMUX_NATIVE_CHAPTERATOM'});
});
test('native chapter labels honour BCP47 precedence and refuse uncarried alternatives/countries',async t=>{
  const f=await fixture(t,'matroska'),{prefix,parts}=segmentParts(f.original),base=Buffer.concat(parts.map(p=>p.bytes));
  f.source.chapters=[{id:1,time_base:'1/1000000000',start:0,end:2000000000,tags:{title:'Same'}}];
  const display=(title,legacy='eng',bcp=null,country=null)=>element(0x80,Buffer.concat([element(0x85,Buffer.from(title)),element(0x437c,Buffer.from(legacy)),
    ...(bcp===null?[]:[element(0x437d,Buffer.from(bcp))]),...(country===null?[]:[element(0x437e,Buffer.from(country))])]));
  const withDisplays=labels=>Buffer.concat([prefix,element(0x18538067,Buffer.concat([base,element(0x1043a770,element(0x45b9,element(0xb6,Buffer.concat([element(0x91,uint(0)),...labels]))))]))]);
  for(const labels of [[display('Same','fra','en')],[display('Same'),display('Same')]]){
    await fs.writeFile(f.sourcePath,withDisplays(labels));await native(f);
  }
  for(const [labels,code]of [[[display('Same','eng','')],'REMUX_NATIVE_CHAPLANGUAGEBCP47'],[[display('Same','eng','en-US')],'REMUX_NATIVE_CHAPLANGUAGEBCP47'],
    [[display('Same','eng',null,'us')],'REMUX_NATIVE_CHAPCOUNTRY'],[[display('One'),display('Two')],'REMUX_NATIVE_CHAPTERDISPLAY']]){
    await fs.writeFile(f.sourcePath,withDisplays(labels));await assert.rejects(native(f),{code});
  }
});
test('native media language handles packed/QuickTime aliases and authoritative extended language',async t=>{
  const f=await fixture(t,'isobmff');f.source.streams[0].tags.language='fra';
  const inspect=()=>observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4'});
  for(const code of [1,6721]){
    await fs.writeFile(f.sourcePath,isoEdit(f.original,'mdhd',h=>{h.writeUInt16BE(code,20);return h;}));await inspect();
  }
  for(const code of [5575,65535]){
    await fs.writeFile(f.sourcePath,isoEdit(f.original,'mdhd',h=>{h.writeUInt16BE(code,20);return h;}));await assert.rejects(inspect(),{code:'REMUX_NATIVE_MDHD_LANGUAGE'});
  }
  const legacy=isoEdit(f.original,'mdhd',h=>{h.writeUInt16BE(5575,20);return h;});
  await fs.writeFile(f.sourcePath,isoEdit(legacy,'mdia',h=>Buffer.concat([h,atom('elng',Buffer.concat([Buffer.alloc(4),Buffer.from('fr\0')]))])));await inspect();
});
test('native chroma coordinates require an exact carried location, including partial declarations',async t=>{
  const f=await fixture(t,'matroska');f.source.streams[0].chroma_location='left';
  for(const [h,v,ok]of [[0,0,true],[1,2,true],[1,0,false],[2,0,false],[2,2,false],[3,2,false]]){
    await fs.writeFile(f.sourcePath,addVideo(f.original,element(0x55b0,Buffer.concat([element(0x55b7,uint(h)),element(0x55b8,uint(v))]))));
    if(ok)await native(f);else await assert.rejects(native(f),e=>/^REMUX_NATIVE_CHROMASITING/.test(e.code));
  }
});
test('independent decoded-field cadence refuses before Ready; absence remains admissible',async t=>{
  const f=await fixture(t,'matroska'),{prefix,parts}=segmentParts(f.original);
  await native(f);
  for(const duration of [20000000,40000000]){
    const bytes=Buffer.concat([prefix,element(0x18538067,Buffer.concat(parts.map(p=>p.id!==0x1654ae6b?p.bytes:element(p.id,Buffer.concat(children(p.body).map(e=>element(e.id,Buffer.concat([p.body.subarray(e.body,e.end),element(0x234e7a,uint(duration))]))))))))]);
    await fs.writeFile(f.sourcePath,bytes);await assert.rejects(native(f),{code:'REMUX_NATIVE_DEFAULTDECODEDFIELDDURATION'});
  }
});
test('independent pinned-demuxer registry detects omitted ISO, Matroska and TS inventory items',()=>{
  const registry=require('./helpers/remux-pinned-registry.json');
  assertInventory(INVENTORY,registry);
  for(const [key,selector]of [['boxes','atom'],['elements','element'],['descriptors','tag']])for(const item of registry[key]){
    assert.throws(()=>assertInventory(INVENTORY.filter(r=>r[selector]!==item),registry),/Unlisted/,key+':'+item);
  }
});
test('native keyed metadata is compared by key and includes value type/locale; unbound indices and unlisted children refuse',async t=>{
  const f=await fixture(t,'isobmff'),{withMetadata}=require('./helpers/native-metadata-fixture.cjs');
  const entries=[{key:'com.example.playback-control',value:'one'},{key:'com.example.second-control',value:'two'}];
  for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,withMetadata(f.original,entries));
  assert.equal((await f.collect()).status,'completed');
  await fs.writeFile(f.outputPath,withMetadata(f.original,[entries[1],entries[0]]));assert.equal((await f.collect()).status,'completed','Key-index/order labels do not change values');
  await fs.writeFile(f.outputPath,withMetadata(f.original,entries.map(e=>({...e,dataType:2,value:Buffer.from(e.value,'utf16le').swap16()}))));
  assert.equal((await f.collect()).status,'completed','UTF-8 and UTF-16 encode the same metadata text');
  for(const changed of [[{...entries[0],value:'different'},entries[1]],[{...entries[0],dataType:21},entries[1]]]){
    await fs.writeFile(f.outputPath,withMetadata(f.original,changed));const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,'REMUX_NATIVE_META_VALUES');
  }
  const inspect=()=>observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4'});
  for(const [options,code]of [[{index:3},'REMUX_NATIVE_META_INDEX'],[{index:0},'REMUX_NATIVE_META_INDEX'],[{namespace:'nope'},'REMUX_NATIVE_META_INDEX'],
    [{dataVersion:1},'REMUX_NATIVE_META_VALUES'],[{extra:atom('zzzz',Buffer.alloc(0))},'REMUX_NATIVE_UNCLASSIFIED']]){
    await fs.writeFile(f.sourcePath,withMetadata(f.original,entries,options));await assert.rejects(inspect(),{code});
  }
  await fs.writeFile(f.sourcePath,withMetadata(f.original,entries,{extra:atom('free',Buffer.alloc(5))}));await inspect();
  const key=entries[0].key;f.source.streams[0].tags[key]='one';
  await fs.writeFile(f.sourcePath,withMetadata(f.original,[entries[0]]));
  await observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'matroska'});
  for(const value of [{...entries[0],dataType:21},{...entries[0],locale:1}]){
    await fs.writeFile(f.sourcePath,withMetadata(f.original,[value]));
    await assert.rejects(observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'matroska'}),{code:'REMUX_NATIVE_META_TARGET'});
  }
});
test('native projection containers classify their children instead of hiding unlisted boxes in a fingerprint',async t=>{
  const f=await fixture(t,'isobmff'),withChild=type=>isoEdit(f.original,'trak',h=>Buffer.concat([h,atom('sv3d',Buffer.concat([atom(type,Buffer.alloc(4)),atom('proj',Buffer.concat([atom('prhd',Buffer.alloc(16)),atom('equi',Buffer.alloc(20))]))]))]));
  for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,withChild('svhd'));
  assert.equal((await f.collect()).status,'completed');
  await fs.writeFile(f.sourcePath,withChild('zzzz'));
  await assert.rejects(observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4'}),{code:'REMUX_NATIVE_UNCLASSIFIED'});
});

for(const row of INVENTORY.filter(r=>r.container==='mpegts'&&r.tag!==undefined))test('PMT enforcement: '+row.id,()=>{
  const {inspectTransportDescriptors}=require('../src/remux-transport.cjs');
  const streams=[{id:'0x101',codec_type:'audio',codec_name:'aac',channels:2,tags:{language:'eng'}}];
  function pmt(descriptor,program){
    const header=Buffer.from([2,176,0,0,1,193,0,0,225,1,240,program?descriptor.length:0]);
    const es=Buffer.from([15,225,1,240,program?0:descriptor.length]);
    const b=Buffer.concat([header,...(program?[descriptor]:[]),es,...(program?[]:[descriptor]),Buffer.alloc(4)]);b[2]=b.length-3;return b;
  }
  for(const program of [false,true]){
    inspectTransportDescriptors(pmt(Buffer.alloc(0),program),streams);
    assert.throws(()=>inspectTransportDescriptors(pmt(Buffer.from([row.tag,0]),program),streams),{code:row.code});
  }
});
test('unlisted PMT descriptors refuse in both program and elementary-stream loops',()=>{
  const {inspectTransportDescriptors}=require('../src/remux-transport.cjs');
  for(const program of [false,true]){
    const h=Buffer.from([2,176,0,0,1,193,0,0,225,0,240,program?3:0]),es=Buffer.from([27,225,0,240,program?0:3]),descriptor=Buffer.from([0xfe,1,0]);
    const b=Buffer.concat([h,...(program?[descriptor]:[]),es,...(program?[]:[descriptor]),Buffer.alloc(4)]);b[2]=b.length-3;
    const neutral=Buffer.concat([Buffer.from([2,176,18,0,1,193,0,0,225,0,240,0]),Buffer.from([27,225,0,240,0]),Buffer.alloc(4)]);
    inspectTransportDescriptors(neutral,[]);
    assert.throws(()=>inspectTransportDescriptors(b,[]),{code:'REMUX_TS_DESCRIPTOR_UNCLASSIFIED'});
  }
});
