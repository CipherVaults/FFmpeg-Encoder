'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),{createHash}=require('node:crypto');
const {fixture,isoEdit,atom,element,uint}=require('./helpers/native-inventory-collector.cjs');
const {segmentParts}=require('./helpers/ebml-fixture.cjs');
const {observeNativeInventory,compareNativeInventories}=require('../src/remux-native-checks.cjs');
const {MATROSKA_SCHEMA}=require('../src/remux-native-inventory.cjs');
const native=(f,file=f.sourcePath)=>observeNativeInventory({file,probe:file===f.sourcePath?f.source:f.output,family:f.source.format.format_name.startsWith('mov')?'isobmff':'matroska',target:'mp4'});
const withSegment=(bytes,payload)=>{const {prefix,parts}=segmentParts(bytes);return Buffer.concat([prefix,element(0x18538067,Buffer.concat([...parts.map(p=>p.bytes),payload]))]);};
test('required Matroska string tags bind native values and target UIDs, with undecorated/default-language neighbours accepted',async t=>{
  const f=await fixture(t,'matroska');f.source.format.tags.custom_playback='same';
  const tag=(value,language='und',target=0)=>element(0x1254c367,element(0x7373,Buffer.concat([element(0x63c0,target?element(0x63c5,uint(target)):Buffer.alloc(0)),element(0x67c8,Buffer.concat([element(0x45a3,Buffer.from('CUSTOM_PLAYBACK')),element(0x447a,Buffer.from(language)),element(0x4487,Buffer.from(value))]))])));
  for(const language of ['und','']){await fs.writeFile(f.sourcePath,withSegment(f.original,tag('same',language)));await native(f);}
  for(const [value,lang,target]of [['changed','und',0],['same','fra',0],['same','und',99]]){await fs.writeFile(f.sourcePath,withSegment(f.original,tag(value,lang,target)));await assert.rejects(native(f),e=>/^REMUX_NATIVE_TAG/.test(e.code));}
});

test('wildcard and multiple native tag targets bind every carried target, with authoritative BCP47 selection',async t=>{
  const f=await fixture(t,'matroska');for(const stream of f.source.streams)stream.tags.custom_playback='same';
  const tag=(ids,lang='und')=>element(0x1254c367,element(0x7373,Buffer.concat([element(0x63c0,Buffer.concat(ids.map(id=>element(0x63c5,uint(id))))),element(0x67c8,Buffer.concat([element(0x45a3,Buffer.from('CUSTOM_PLAYBACK')),element(0x447a,Buffer.from('fra')),element(0x447b,Buffer.from(lang)),element(0x4487,Buffer.from('same'))]))])));
  for(const ids of [[0],[1,2]]){await fs.writeFile(f.sourcePath,withSegment(f.original,tag(ids)));await native(f);
    f.source.streams[0].tags.custom_playback='different';await assert.rejects(native(f),e=>/^REMUX_NATIVE_TAG/.test(e.code));f.source.streams[0].tags.custom_playback='same';}
  for(const language of ['fr','']){await fs.writeFile(f.sourcePath,withSegment(f.original,tag([0],language)));await assert.rejects(native(f),e=>/^REMUX_NATIVE_TAG/.test(e.code));}
  const {ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs');
  await fs.writeFile(f.sourcePath,withSegment(f.original,ebmlRewrite(tag([1]),0x63c0,b=>Buffer.concat([b,element(0xec,Buffer.from('inert'))]))));await native(f);
  await fs.writeFile(f.sourcePath,withSegment(f.original,ebmlRewrite(tag([1]),0x63c0,b=>Buffer.concat([b,element(0x63c4,uint(0))]))));
  await assert.rejects(native(f),e=>/^REMUX_NATIVE_TAG/.test(e.code)&&/mixed native tag target classes/.test(e.message));
});
test('native attachment data/name/type/UID bind the complete carried attachment; changed bytes and ambiguous UIDs refuse',async t=>{
  const f=await fixture(t,'matroska'),data=Buffer.from('owned font fixture'),hash='SHA256:'+createHash('sha256').update(data).digest('hex');
  f.source.streams.push({index:99,codec_type:'attachment',codec_name:'ttf',extradata_hash:hash,tags:{filename:'owned.ttf',mimetype:'application/x-truetype-font'}});
  const attachment=(bytes=data,uid=1)=>element(0x1941a469,element(0x61a7,Buffer.concat([element(0x466e,Buffer.from('owned.ttf')),element(0x4660,Buffer.from('application/x-truetype-font')),element(0x465c,bytes),element(0x46ae,uint(uid))])));
  await fs.writeFile(f.sourcePath,withSegment(f.original,attachment()));await native(f);
  await fs.writeFile(f.sourcePath,withSegment(f.original,attachment(Buffer.from('changed'))));await assert.rejects(native(f),{code:'REMUX_NATIVE_FILEDATA'});
  await fs.writeFile(f.sourcePath,withSegment(f.original,attachment(data,0)));await assert.rejects(native(f),{code:'REMUX_NATIVE_FILEUID'});
});
test('new streamed block guards refuse nonzero padding and reference controls, while absence/zero padding remain accepted',async t=>{
  const f=await fixture(t,'matroska'),cluster=payload=>withSegment(f.original,element(0x1f43b675,element(0xa0,payload)));
  for(const bytes of [f.original,cluster(element(0x75a2,Buffer.alloc(0))),cluster(element(0x75a2,uint(0)))]){await fs.writeFile(f.sourcePath,bytes);await native(f);}
  for(const [payload,code]of [[element(0x75a2,uint(1)),'REMUX_NATIVE_DISCARDPADDING'],[element(0xfb,uint(1)),'REMUX_NATIVE_REFERENCEBLOCK'],[element(0xfa,uint(1)),'REMUX_NATIVE_REFERENCEPRIORITY']]){
    await fs.writeFile(f.sourcePath,cluster(payload));await assert.rejects(native(f),{code});
  }
});
test('ordinary terminal AAC padding is read and compared; changed, negative or interior padding remains refused',async t=>{
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{blockForm,ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs'),f=await realWitness(t,'matroska',{transform:blockForm('DiscardPadding',10666667n)});
  const good=await f.collect();assert.equal(good.status,'completed',JSON.stringify(good.failure));assert.equal(f.validate(good).valid,true,JSON.stringify(f.validate(good)));
  for(const ns of [21333333n,-10666667n]){await fs.writeFile(f.outputPath,ebmlRewrite(f.original,0x75a2,b=>{b.writeBigInt64BE(ns);return b;}));const bad=await f.collect();assert.equal(bad.status,'failed');assert.equal(bad.failure.code,'REMUX_NATIVE_DISCARDPADDING');}
  const interior=ebmlRewrite(f.original,0xa3,b=>{const pad=Buffer.alloc(8);pad.writeBigInt64BE(10666667n);b[3]&=0x0e;return{id:0xa0,body:Buffer.concat([element(0xa1,b),element(0x75a2,pad)])};},b=>b[0]===0x82);
  await fs.writeFile(f.outputPath,interior);await assert.rejects(native(f,f.outputPath),{code:'REMUX_NATIVE_DISCARDPADDING'});
});
test('ordinary previous-block references are verified natively; changed reference values still refuse',async t=>{
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{blockForm,ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs'),f=await realWitness(t,'matroska',{transform:blockForm('ReferenceBlock')});
  const good=await f.collect();assert.equal(good.status,'completed',JSON.stringify(good.failure));assert.equal(f.validate(good).valid,true,JSON.stringify(f.validate(good)));
  for(const file of [f.sourcePath,f.outputPath]){await fs.writeFile(file,ebmlRewrite(f.original,0xfb,b=>{b.writeInt16BE(b.readInt16BE()+1);return b;}));const bad=await f.collect();assert.equal(bad.status,'failed');assert.equal(bad.failure.code,'REMUX_NATIVE_REFERENCEBLOCK');await fs.writeFile(file,f.original);}
});
test('block headers refuse undeclared tracks, hidden/reserved flags and ambiguous Cluster clocks',async t=>{
  const f=await fixture(t,'matroska'),block=(track=1,flags=128)=>element(0xa3,Buffer.from([128|track,0,0,flags,0,0,0,1,0x65])),wrap=b=>withSegment(f.original,element(0x1f43b675,b));
  await fs.writeFile(f.sourcePath,wrap(block()));await native(f);
  for(const [payload,code]of [[block(3),'REMUX_NATIVE_TRACK_MAP'],[block(1,136),'REMUX_NATIVE_BLOCK_FLAGS'],[block(1,144),'REMUX_NATIVE_BLOCK_FLAGS'],[Buffer.concat([block(),element(0xe7,uint(1))]),'REMUX_NATIVE_TIMESTAMP'],
    [Buffer.concat([element(0xe7,uint(0)),element(0xe7,uint(1)),block()]),'REMUX_NATIVE_TIMESTAMP'],[element(0xa3,Buffer.from([0x81,0,0])),'REMUX_NATIVE_BLOCK']]){
    await fs.writeFile(f.sourcePath,wrap(payload));await assert.rejects(native(f),{code});
  }
});
test('empty EBML version integers use specification defaults; unsupported versions still refuse',async t=>{
  const f=await fixture(t,'matroska'),{prefix,parts}=segmentParts(f.original),{ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs');
  for(const name of ['EBMLVersion','EBMLReadVersion','DocTypeVersion','DocTypeReadVersion']){
    const id=Number(MATROSKA_SCHEMA.find(e=>e.name===name).id);await fs.writeFile(f.sourcePath,ebmlRewrite(f.original,id,()=>Buffer.alloc(0)));await native(f);
    await fs.writeFile(f.sourcePath,ebmlRewrite(f.original,id,()=>uint(99)));await assert.rejects(native(f),e=>/^REMUX_NATIVE_(?:EBML|DOCTYPE)/.test(e.code));
  }
});
test('ordinary OBS 2112-sample delay is corroborated exactly; zero and changed delay still refuse a conflicting carried hint',async t=>{
  const f=await fixture(t,'matroska'),{ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs'),{children}=require('./helpers/ebml-fixture.cjs');f.source.streams[1].initial_padding=2112;
  const withDelay=ns=>ebmlRewrite(f.original,0xae,b=>Buffer.concat([b,element(0x56aa,uint(ns))]),b=>children(b).some(n=>n.id===0x83&&b[n.body]===2));
  await fs.writeFile(f.sourcePath,withDelay(44000000));const good=await native(f);assert.deepEqual(good.fields.find(r=>r.id==='matroska:CodecDelay').values,[{index:1,value:'2112'}]);
  for(const ns of [0,44000001,21333333]){await fs.writeFile(f.sourcePath,withDelay(ns));await assert.rejects(native(f),{code:'REMUX_NATIVE_CODECDELAY'});}
});
test('native phone DefaultDuration uses the exact pinned bounded-rational projection rather than inverting a rounded probe rate',async t=>{
  const {matroskaRate}=require('../src/remux-native-matroska.cjs'),{ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs'),f=await fixture(t,'matroska');
  assert.deepEqual(matroskaRate(55595134n),[29481n,1639n]);assert.deepEqual(matroskaRate(40000000n),[25n,1n]);for(const n of [0n,-1n,1n<<65n])assert.throws(()=>matroskaRate(n),{code:'REMUX_NATIVE_DEFAULTDURATION'});
  f.source.streams[0].avg_frame_rate='29481/1639';f.source.streams[0].r_frame_rate='29481/1639';
  const withDuration=body=>ebmlRewrite(f.original,0xae,b=>Buffer.concat([b,element(0x23e383,body)]));
  for(const body of [uint(55595134),Buffer.alloc(0)]){await fs.writeFile(f.sourcePath,withDuration(body));await native(f);}
  await fs.writeFile(f.sourcePath,withDuration(uint(40000000)));await assert.rejects(native(f),{code:'REMUX_NATIVE_DEFAULTDURATION'});
});

test('ordinary gamma transfer codes use pinned probe names in both containers; conflicting native transfer still refuses',async t=>{
  // libavutil/pixdesc.c names AVCOL_TRC_GAMMA22/GAMMA28 bt470m/bt470bg.
  // These are exact enum correspondences, not a widened colour tolerance.
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{ebmlRewrite,isoRewrite}=require('./helpers/remux-packet-witnesses.cjs');
  for(const family of ['isobmff','matroska']){
    const f=family==='isobmff'?await realWitness(t,family):await fixture(t,family);
    const withTransfer=code=>family==='isobmff'?isoRewrite(f.original,'colr',b=>{b.writeUInt16BE(code,6);return b;}):ebmlRewrite(f.original,0xe0,b=>Buffer.concat([b,element(0x55b0,element(0x55ba,uint(code)))]));
    for(const [code,name]of [[4,'bt470m'],[5,'bt470bg']]){
      f.source.streams[0].color_transfer=name;await fs.writeFile(f.sourcePath,withTransfer(code));await native(f);
      await fs.writeFile(f.sourcePath,withTransfer(1));await assert.rejects(native(f),{code:family==='isobmff'?'REMUX_NATIVE_COLR_PROFILE':'REMUX_NATIVE_TRANSFERCHARACTERISTICS'});
    }
  }
});
test('inert padding payloads cannot hide interpreted child boxes/elements; CRC extent remains checked',async t=>{
  for(const [family,type]of [['isobmff','free'],['isobmff','skip'],['isobmff','wide'],['matroska',0xec]]){const f=await fixture(t,family);
    const unknown=family==='isobmff'?atom('zzzz',Buffer.alloc(0)):element(0x4abc,Buffer.alloc(0)),padding=family==='isobmff'?atom(type,unknown):element(type,unknown);
    await fs.writeFile(f.sourcePath,Buffer.concat([f.original,padding]));const a=await native(f),b=await native(f,f.outputPath);compareNativeInventories(a,b,f.source.streams.map(s=>({inputIndex:s.index,outputIndex:s.index})));
    await fs.writeFile(f.sourcePath,Buffer.concat([f.original,padding,unknown]));await assert.rejects(native(f),{code:'REMUX_NATIVE_UNCLASSIFIED'});
  }
  const f=await fixture(t,'matroska');for(const n of [4,5]){await fs.writeFile(f.sourcePath,Buffer.concat([f.original,element(0xbf,Buffer.alloc(n))]));if(n===4)await native(f);else await assert.rejects(native(f),{code:'REMUX_NATIVE_CRC_32'});}
});
test('ordinary ISO file-type, sample description and self data-reference guards retain accepted neighbours',async t=>{
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoRewrite}=require('./helpers/remux-packet-witnesses.cjs'),f=await realWitness(t,'isobmff');
  await native(f);
  for(const [type,mutate,code]of [
    ['ftyp',b=>b.subarray(0,4),'REMUX_NATIVE_FTYP'],
    ['stsd',b=>{b.writeUInt32BE(2,4);return b;},'REMUX_NATIVE_STSD'],
    ['url ',b=>{b.fill(0);return b;},'REMUX_NATIVE_DREF_EXTERNAL'],
    ['avc1',b=>{b.writeUInt16BE(63,24);return b;},'REMUX_NATIVE_AVC1']]){
    await fs.writeFile(f.sourcePath,isoRewrite(f.original,type,mutate));await assert.rejects(native(f),{code});
  }
});
test('pinned ISO fragment indexes retain ordinary writer bytes and refuse changed locators or flags',async t=>{
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoRewrite}=require('./helpers/remux-packet-witnesses.cjs');
  for(const dash of [false,true]){
    const f=await realWitness(t,'isobmff',{movflags:'frag_keyframe+empty_moov+default_base_moof'+(dash?'+dash':'')});await native(f);
    for(const [type,change,code]of [
      ['mfhd',b=>{b[0]=1;return b;},'REMUX_NATIVE_MFHD'],
      ['tfra',b=>{b[1]=1;return b;},'REMUX_NATIVE_TFRA'],
      ['mfro',b=>{b.writeUInt32BE(1,4);return b;},'REMUX_NATIVE_MFRO']]){
      await fs.writeFile(f.sourcePath,isoRewrite(f.original,type,change));await assert.rejects(native(f),{code});
    }
    if(dash)for(const offset of [4,8]){await fs.writeFile(f.sourcePath,isoRewrite(f.original,'sidx',b=>{const head=b[0]===1?32:24;b.writeUInt32BE(b.readUInt32BE(head+offset)+1,head+offset);return b;}));await assert.rejects(native(f),{code:'REMUX_NATIVE_SIDX'});}
  }
});

test('ordinary AAC ES and sync-layer descriptors pass; dependency/URL, object type and sync-layer changes refuse',async t=>{
  const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoRewrite}=require('./helpers/remux-packet-witnesses.cjs'),f=await realWitness(t,'isobmff',{audio:true});await native(f);
  const bodyAt=(b,at)=>{at++;for(let i=0;i<4;i++)if(!(b[at++]&128))return at;throw Error('fixture descriptor length');};
  for(const mutation of ['selection','decoder','sync','unknown']){
    await fs.writeFile(f.sourcePath,isoRewrite(f.original,'esds',b=>{const es=bodyAt(b,4);if(mutation==='selection')b[es+2]=128;else if(mutation==='decoder')b[bodyAt(b,es+3)]=0x20;else if(mutation==='unknown')b[4]=127;else b[b.length-1]=3;return b;}));
    await assert.rejects(native(f),{code:'REMUX_NATIVE_ESDS'});
  }
});
