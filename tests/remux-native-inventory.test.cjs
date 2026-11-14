'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {INVENTORY,MATROSKA_SCHEMA,assertInventory}=require('../src/remux-native-inventory.cjs');
const {fixture,isoEdit,atom,element,uint}=require('./helpers/native-inventory-collector.cjs');
const digest=rows=>createHash('sha256').update(rows.map(r=>r.id).sort().join('\n')).digest('hex');
test('inventory row identities/treatments and generated human table cannot silently drift',async()=>{
  assertInventory();assert.equal(digest(INVENTORY),'b6621479b67a657ec3193b590bfaddf301a9fbdda1b06dc4d3dd925f105658cc');
  for(const r of INVENTORY)assert.throws(()=>assertInventory(INVENTORY.map(p=>p===r?{...p,treatment:null}:p)),/Incomplete/);
  assert.notEqual(digest(INVENTORY.slice(1)),digest(INVENTORY));
  assert.equal(await fs.readFile(path.join(__dirname,'../scripts/v07-remux-native-inventory.md'),'utf8'),require('../scripts/v07-remux-native-inventory.cjs').render());
});
function isoMutant(b,r){
  if(r.offset!==undefined){const body=r.atom==='vmhd'?Buffer.alloc(12):r.atom==='hdlr'?Buffer.alloc(24):null;
    const change=h=>{h[r.offset+r.width-1]=r.check==='vmhd-mode'?32:1;return h;};
    if(body){if(r.atom==='hdlr')body.write('vide',8);return isoEdit(b,r.atom==='vmhd'?'minf':'mdia',h=>Buffer.concat([h,atom(r.atom,change(body))]));}
    return isoEdit(b,r.atom,change);
  }
  if(r.check==='groups')return isoEdit(b,'tkhd',h=>{h.writeUInt16BE(0,34);return h;},1);
  if(r.check==='metadata-key'){
    const name=Buffer.from(r.key),head=Buffer.alloc(8);head.writeUInt32BE(1,4);const entry=Buffer.alloc(8);entry.writeUInt32BE(name.length+8);entry.write('mdta',4);
    const item=atom(String.fromCharCode(0,0,0,1),atom('data',Buffer.concat([Buffer.alloc(8),Buffer.from('changed functional value')])));
    return isoEdit(b,'trak',h=>Buffer.concat([h,atom('meta',Buffer.concat([Buffer.alloc(4),atom('keys',Buffer.concat([head,entry,name])),atom('ilst',item)]))]));
  }
  let data=Buffer.alloc(4);
  if(r.check==='handler'){data=Buffer.alloc(24);data.write('auxv',8);return isoEdit(b,'mdia',h=>Buffer.concat([h,atom('hdlr',data)]));}
  if(r.check==='iso-language'){data=Buffer.concat([Buffer.alloc(4),Buffer.from('fr\0')]);}
  if(r.check==='clean-aperture'){data=Buffer.alloc(32);[1,1,2,1,0,1,0,1].forEach((v,i)=>data.writeUInt32BE(v,i*4));}
  if(r.check==='pixel-aspect'){data=Buffer.from([0,0,0,2,0,0,0,1]);}
  if(r.check==='field-order'){data=Buffer.from([2,1]);}
  if(r.check==='colour-method'){data=Buffer.concat([Buffer.from('prof'),Buffer.alloc(128,1)]);}
  if(r.check==='aac-groups'){data=Buffer.alloc(18);data[0]=1;data.write('roll',4);data.writeUInt32BE(2,8);data.writeUInt32BE(1,12);data.writeInt16BE(-2,16);}
  if(r.check==='self-reference'){const h=Buffer.alloc(8);h.writeUInt32BE(1,4);data=Buffer.concat([h,atom('url ',Buffer.alloc(4))]);}
  if(r.check==='references')data=atom('cdsc',Buffer.from([0,0,0,2]));
  if(r.check==='absent')data=Buffer.alloc(0);
  if(r.atom==='uuid')data=Buffer.alloc(17,3);
  const payload=atom(r.atom,data);return isoEdit(b,'trak',h=>Buffer.concat([h,payload]));
}
function mkvMutant(b,r,trackOrdinal=0,payloadOverride=null){
  const schema=MATROSKA_SCHEMA.find(e=>e.id===r.element),names=(schema?.path||'\\Segment\\Tracks\\TrackEntry\\'+r.field).split('\\').filter(Boolean).map(s=>s.replace(/^\+/,''));
  const parents=names.slice(0,-1),ids=parents.map(n=>MATROSKA_SCHEMA.find(e=>e.name===n)?.id);assert.ok(ids.every(Boolean),r.field);
  let payload;
  if(r.check==='language')payload=Buffer.from('fr');
  else if(r.type==='master')payload=Buffer.alloc(0);
  else if(r.type==='float'){payload=Buffer.alloc(8);payload.writeDoubleBE(2);}
  else if(r.type==='uinteger'||r.type==='integer')payload=uint(r.nativeDefault===1||r.check==='disposition-default'?0:1);
  else payload=Buffer.from('changed');
  if(payloadOverride)payload=payloadOverride;
  const target=Number.parseInt(r.element,16),leaf=element(target,payload);let changed=false;
  function parse(bytes){const out=[];for(let at=0;at<bytes.length;){let mask=128,width=1;while(!(bytes[at]&mask)){mask>>=1;width++;}const id=Number.parseInt(bytes.subarray(at,at+width).toString('hex'),16);let p=at+width,m=128,w=1;while(!(bytes[p]&m)){m>>=1;w++;}let n=BigInt(bytes[p]&(m-1));for(let i=1;i<w;i++)n=n*256n+BigInt(bytes[p+i]);const start=p+w,end=start+Number(n);out.push({id,body:bytes.subarray(start,end)});at=end;}return out;}
  function visit(bytes,depth){const nodes=parse(bytes),id=Number.parseInt(ids[depth],16);let found=false;const out=nodes.map(n=>{
    if(!changed&&!found&&n.id===id){if(n.id===0xae&&trackOrdinal-->0)return element(n.id,n.body);found=true;let body;if(depth===ids.length-1){const children=parse(n.body).filter(x=>x.id!==target).map(x=>element(x.id,x.body));body=Buffer.concat([...children,leaf]);changed=true;}else body=visit(n.body,depth+1);return element(n.id,body);}return element(n.id,n.body);});
    if(!found){let body=leaf;for(let j=ids.length-1;j>=depth;j--)body=element(Number.parseInt(ids[j],16),body);out.push(body);changed=true;}return Buffer.concat(out);}
  const result=visit(b,0);
  if(['single-edition','editions'].includes(r.check)){
    const extend=bytes=>Buffer.concat(parse(bytes).map(n=>element(n.id,n.id===0x18538067?extend(n.body):n.id===0x1043a770?Buffer.concat([n.body,element(0x45b9,element(0x45db,uint(0)))]):n.body)));
    return extend(result);
  }
  return result;
}
for(const family of ['isobmff','matroska'])test(family+' neutral collector fixture',async t=>{const f=await fixture(t,family),r=await f.collect();assert.equal(r.status,'completed',JSON.stringify(r.failure));assert.ok(r.nativeInventory.complete);
  assert.deepEqual(r.readAccounting.partialOperations.filter(o=>o.operation==='native-inventory-metadata').map(o=>[o.side,o.bytesRead]),
    ['source','output'].map(side=>[side,r.nativeInventory[side].metadataBytesRead]));
});
for(const row of INVENTORY)test('native inventory row: '+row.id,async t=>{
  assert.ok(row.treatment&&row.check&&row.reason);
  if(!['compare','require-default'].includes(row.treatment)||row.container==='mpegts')return;
  const f=await fixture(t,row.container,{groups:row.check==='groups'}),neutral=await f.collect();assert.equal(neutral.status,'completed',JSON.stringify(neutral.failure));
  const mutant=row.container==='isobmff'?isoMutant(f.original,row):mkvMutant(f.original,row);
  for(const file of [f.sourcePath,f.outputPath]){
    await fs.writeFile(file,mutant);const r=await f.collect();assert.equal(r.status,'failed',row.id+': '+file);assert.match(r.failure.code,/^REMUX_(?:NATIVE|SOURCE)/,JSON.stringify(r.failure));await fs.writeFile(file,f.original);
  }
});

test('native BCP47 is read on each audio track, including when the legacy probe tag is unchanged',async t=>{
  const r=INVENTORY.find(r=>r.id==='matroska:LanguageBCP47'),f=await fixture(t,'matroska',{groups:true});
  assert.equal((await f.collect()).status,'completed');
  const mutant=mkvMutant(f.original,r,1);
  for(const file of [f.sourcePath,f.outputPath]){
    await fs.writeFile(file,mutant);const evidence=await f.collect();
    assert.equal(evidence.status,'failed');assert.equal(evidence.failure.code,r.code);
    await fs.writeFile(file,f.original);
  }
});

test('native BCP47 canonical legacy aliases are equivalent',async t=>{
  const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),r=INVENTORY.find(r=>r.id==='matroska:LanguageBCP47'),
    f=await fixture(t,'matroska',{languageTag:'fra'}),mutant=mkvMutant(f.original,r,1);
  await fs.writeFile(f.sourcePath,mutant);
  const native=await observeNativeInventory({file:f.sourcePath,probe:f.source,family:'matroska',target:'matroska'});
  assert.deepEqual(native.fields.find(p=>p.id===r.id).values,[{index:1,value:'fr'}]);
});

test('native enumerated colour, field and pixel-aspect declarations cannot hide behind unchanged probe values',async t=>{
  const f=await fixture(t,'isobmff'),colour=Buffer.from([110,99,108,120,0,1,0,1,0,1,0]);
  const withBox=(type,data)=>isoEdit(f.original,'trak',h=>Buffer.concat([h,atom(type,data)]));
  for(const [type,data]of [['colr',colour],['pasp',Buffer.from([0,0,0,1,0,0,0,1])],['fiel',Buffer.from([1,0])]]){
    for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,withBox(type,data));
    assert.equal((await f.collect()).status,'completed',type+' neutral');
    for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,f.original);
  }
  const changes=[...([5,7,9,10].map(at=>['colr',()=>{const b=Buffer.from(colour);b[at]=at===10?128:6;return b;},'REMUX_NATIVE_COLR_PROFILE'])),
    ['pasp',()=>Buffer.alloc(8),'REMUX_NATIVE_PASP'],['fiel',()=>Buffer.from([1,1]),'REMUX_NATIVE_FIEL']];
  for(const [type,make,code]of changes)for(const file of [f.sourcePath,f.outputPath]){
    await fs.writeFile(file,withBox(type,make()));const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,code);
    await fs.writeFile(file,f.original);
  }
});

test('source admission refuses disabled Matroska tracks and unrepresentable BCP47 before Ready',async t=>{
  const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),f=await fixture(t,'matroska');
  for(const id of ['matroska:FlagEnabled','matroska:LanguageBCP47']){
    const r=INVENTORY.find(r=>r.id===id);await fs.writeFile(f.sourcePath,mkvMutant(f.original,r));
    await assert.rejects(observeNativeInventory({file:f.sourcePath,probe:f.source,family:'matroska',target:'mp4'}),{code:r.code});
  }
});

test('Matroska track mapping excludes attachments from ordinals and refuses duplicate native TrackNumbers',async t=>{
  const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),f=await fixture(t,'matroska'),probe=structuredClone(f.source);
  for(const s of probe.streams)delete s.id;probe.streams.unshift({index:99,codec_type:'attachment',codec_name:'ttf'});
  const native=await observeNativeInventory({file:f.sourcePath,probe,family:'matroska',target:'matroska'});assert.ok(native.fields.length);
  const row=INVENTORY.find(r=>r.id==='matroska:TrackNumber'),mutant=mkvMutant(f.original,row,1);
  for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,mutant);const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,'REMUX_NATIVE_TRACK_MAP');await fs.writeFile(file,f.original);}
});

test('native 64-bit Matroska display ratios compare without floating-point rounding',async t=>{
  const f=await fixture(t,'matroska'),width=INVENTORY.find(r=>r.id==='matroska:DisplayWidth'),height=INVENTORY.find(r=>r.id==='matroska:DisplayHeight');
  const mutant=mkvMutant(mkvMutant(f.original,width,0,uint(9007199254740993n)),height,0,uint(9007199254740992n));
  for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,mutant);const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,width.code);await fs.writeFile(file,f.original);}
});

test('native parser bounds, cancellation, identity and unknown types fail closed without reading media payload',async t=>{
  const {readNativeMetadata}=require('../src/remux-native-reader.cjs'),{observeNativeInventory}=require('../src/remux-native-checks.cjs'),
    f=await fixture(t,'isobmff');
  const options={file:f.sourcePath,family:'isobmff',withMetadata:async m=>({types:[...m.seenTypes],bytes:m.bytesRead()})};
  const payload=Buffer.alloc(1024*1024,0xff);await fs.writeFile(f.sourcePath,Buffer.concat([f.original,atom('mdat',payload)]));
  assert.ok((await readNativeMetadata(options)).bytes<8192,'mdat payload is skipped');
  const controller=new AbortController();controller.abort();
  await assert.rejects(readNativeMetadata({...options,signal:controller.signal}),{code:'CANCELLED'});
  for(const value of [0,-1,Number.MAX_SAFE_INTEGER])await assert.rejects(readNativeMetadata({...options,maxRecords:value}),{code:'REMUX_NATIVE_STRUCTURE'});
  await assert.rejects(readNativeMetadata({...options,timeoutMs:0}),{code:'REMUX_NATIVE_STRUCTURE'});
  await assert.rejects(readNativeMetadata({...options,identity:{}}),{code:'REMUX_NATIVE_STRUCTURE'});
  await fs.writeFile(f.sourcePath,atom('moov',Buffer.alloc(7)));
  await assert.rejects(readNativeMetadata(options),{code:'REMUX_NATIVE_STRUCTURE'});
  let deep=atom('free',Buffer.alloc(0));for(let i=0;i<14;i++)deep=atom('moov',deep);
  await fs.writeFile(f.sourcePath,deep);await assert.rejects(readNativeMetadata(options),{code:'REMUX_NATIVE_STRUCTURE'});
  await fs.writeFile(f.sourcePath,Buffer.concat([f.original,atom('zzzz',Buffer.alloc(0))]));
  await assert.rejects(observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4'}),{code:'REMUX_NATIVE_UNCLASSIFIED'});
  await fs.writeFile(f.sourcePath,f.original);
  await assert.rejects(readNativeMetadata({...options,withMetadata:async m=>{await fs.appendFile(f.sourcePath,atom('free',Buffer.alloc(0)));m.stop();}}),{code:'REMUX_NATIVE_STRUCTURE'});
});

test('TS descriptor inventory drives bounded language and unsupported selection guards',()=>{
  const {inspectTransportDescriptors}=require('../src/remux-transport.cjs'),streams=[{id:'0x101',codec_type:'audio',codec_name:'aac',channels:2,tags:{language:'eng'}}];
  const pmt=descriptor=>{const h=Buffer.from([2,176,0,0,1,193,0,0,225,0,240,0,15,225,1,240,descriptor.length]);
    const b=Buffer.concat([h,descriptor,Buffer.alloc(4)]);b[2]=b.length-3;return b;};
  inspectTransportDescriptors(pmt(Buffer.alloc(0)),streams);
  inspectTransportDescriptors(pmt(Buffer.from([10,4,101,110,103,0])),streams);
  for(const descriptor of [Buffer.from([124,1,15]),Buffer.from([124,2,15,0]),Buffer.from([124,3,15,128,3])])inspectTransportDescriptors(pmt(descriptor),streams);
  for(const descriptor of [Buffer.from([124,3,15,128,64]),Buffer.from([124,3,15,128,1]),Buffer.from([124,2,15,64]),Buffer.from([124,3,15,0,1])])
    assert.throws(()=>inspectTransportDescriptors(pmt(descriptor),streams),{code:INVENTORY.find(r=>r.tag===124).code});
  for(const r of INVENTORY.filter(r=>r.container==='mpegts'&&r.enforcement==='transport-inventory')){
    const descriptor=r.tag===10?Buffer.from([10,4,101,110,103,2]):Buffer.from([r.tag,0]);
    assert.throws(()=>inspectTransportDescriptors(pmt(descriptor),streams),{code:r.code},r.id);
  }
  for(const descriptor of [Buffer.from([10]),Buffer.from([10,5,101,110,103,0])])
    assert.throws(()=>inspectTransportDescriptors(pmt(descriptor),streams),{code:'REMUX_TS_DESCRIPTOR_STRUCTURE'});
  for(const descriptor of [Buffer.from([10,0]),Buffer.from([10,4,102,114,97,0]),Buffer.from([10,4,69,78,71,0]),Buffer.from([10,4,229,110,103,0]),Buffer.from([10,4,101,110,103,0,10,4,101,110,103,0])])
    assert.throws(()=>inspectTransportDescriptors(pmt(descriptor),streams),{code:INVENTORY.find(r=>r.tag===10).code});
  const truncated=pmt(Buffer.alloc(0));truncated[11]=255;
  assert.throws(()=>inspectTransportDescriptors(truncated,streams),{code:'REMUX_TS_DESCRIPTOR_STRUCTURE'});
  const streamHeader=pmt(Buffer.alloc(0)).subarray(0,20);
  assert.throws(()=>inspectTransportDescriptors(streamHeader,streams),{code:'REMUX_TS_DESCRIPTOR_STRUCTURE'});
  assert.throws(()=>inspectTransportDescriptors(Buffer.alloc(1025),streams),{code:'REMUX_TS_DESCRIPTOR_STRUCTURE'});
});

test('native metadata count, byte, deadline and mid-inspection cancellation budgets are enforced',async t=>{
  const {readNativeMetadata}=require('../src/remux-native-reader.cjs'),{observeNativeInventory}=require('../src/remux-native-checks.cjs'),f=await fixture(t,'isobmff');
  const options={file:f.sourcePath,family:'isobmff',withMetadata:async()=>null};
  await fs.writeFile(f.sourcePath,Buffer.concat(Array.from({length:8210},()=>atom('free',Buffer.alloc(0)))));
  await assert.rejects(readNativeMetadata({...options,maxRecords:1}),{code:'REMUX_NATIVE_STRUCTURE'});
  await fs.writeFile(f.sourcePath,Buffer.concat([f.original,atom('uuid',Buffer.alloc(9*1024*1024))]));
  await assert.rejects(observeNativeInventory({file:f.sourcePath,probe:f.source,family:'isobmff',target:'mp4',maxRecords:1}),{code:'REMUX_NATIVE_STRUCTURE'});
  await fs.writeFile(f.sourcePath,f.original);
  const controller=new AbortController();await assert.rejects(readNativeMetadata({...options,signal:controller.signal,withMetadata:async()=>controller.abort()}),{code:'CANCELLED'});
  let clock=0;const mock=t.mock.method(Date,'now',()=>clock);
  try{await assert.rejects(readNativeMetadata({...options,timeoutMs:2,withMetadata:async()=>{clock=3;}}),{code:'REMUX_NATIVE_TIMEOUT'});}finally{mock.mock.restore();}
});

test('unknown-length Matroska Cluster is admitted without reading block data',async t=>{
  const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),f=await fixture(t,'matroska'),start=f.original.indexOf(Buffer.from('18538067','hex'));
  assert.ok(start>=0);let width=1,mask=128;while(!(f.original[start+4]&mask)){width++;mask>>=1;}
  const bytes=Buffer.concat([f.original.subarray(0,start),element(0x18538067,Buffer.concat([f.original.subarray(start+4+width),Buffer.from([31,67,182,117,255])]))]);
  await fs.writeFile(f.sourcePath,bytes);
  const native=await observeNativeInventory({file:f.sourcePath,probe:f.source,family:'matroska',target:'matroska'});
  assert.equal(native.headerWalk.unknownClusters,1);
});
