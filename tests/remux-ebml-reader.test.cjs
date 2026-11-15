'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks');
const {readNativeMetadata}=require('../src/remux-native-reader.cjs'),{ebmlLimits}=require('../src/remux-ebml-reader.cjs');
const {fixture}=require('./helpers/native-inventory-collector.cjs');
const {element,uint,idBytes,segmentParts,unknownElement,streamingFile,cluster}=require('./helpers/ebml-fixture.cjs');
const block=element(0xa3,Buffer.from([0x81,0,0,0x80,255]));
async function owned(t,bytes){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'remux-ebml-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^remux-ebml-/);await fs.rm(dir,{recursive:true});});
  const file=path.join(dir,'owned.mkv');await fs.writeFile(file,bytes,{flag:'wx'});return file;
}
const inspect=(file,extra={})=>readNativeMetadata({file,family:'matroska',...extra,withMetadata:async m=>({stats:m.ebmlWalk,nodes:m.nodes.map(n=>({name:n.name,body:n.body,end:n.end})),seen:[...m.seenTypes]})});

test('unknown Cluster boundaries use schema levels and find metadata before, between and after Clusters',async t=>{
  const display=element(0x80,element(0x85,Buffer.from('Owned chapter'))),
    chapter=element(0x1043a770,element(0x45b9,element(0xb6,Buffer.concat([element(0x73c4,uint(1)),element(0x91,uint(0)),display]))));
  const parts=[element(0x1549a966,Buffer.alloc(0)),cluster([block]),element(0x1654ae6b,Buffer.alloc(0)),element(0x114d9b74,Buffer.alloc(0)),
    cluster([element(0xec,Buffer.alloc(2)),element(0xbf,Buffer.alloc(4)),element(0xa0,element(0xa1,Buffer.from([0x81,0,0,0,255])))]),
    chapter,
    element(0x1941a469,Buffer.alloc(0)),
    element(0x1254c367,element(0x7373,element(0x67c8,Buffer.concat([element(0x45a3,Buffer.from('TITLE')),element(0x4487,Buffer.from('Owned'))])))),
    element(0x1c53bb6b,Buffer.alloc(0)),element(0x114d9b74,Buffer.alloc(0))];
  for(const unknown of [false,true]){
    const r=await inspect(await owned(t,streamingFile(parts,unknown)));
    assert.deepEqual(r.nodes.map(n=>n.name),['EBML','DocType','Segment','Info','Cluster','Tracks','SeekHead','Cluster','Chapters','EditionEntry','ChapterAtom','ChapterUID','ChapterTimeStart','ChapterDisplay','ChapString','Attachments','Tags','Tag','SimpleTag','TagName','TagString','Cues','SeekHead']);
    assert.equal(r.stats.unknownClusters,2);assert.equal(r.stats.blockBytesSkipped,2);assert.equal(r.stats.blockHeaderBytesRead,8);assert.equal(r.stats.clusterChildren,7);
    const c=r.nodes.filter(n=>n.name==='Cluster');assert.equal(c[0].end,r.nodes.find(n=>n.name==='Tracks').body-5);
  }
});

test('block payloads are never read or scanned for fake boundaries',async t=>{
  const fake=Buffer.concat([element(0x1654ae6b,Buffer.alloc(0)),Buffer.from([0,255,0,255])]);
  const bytes=streamingFile([cluster([element(0xa3,Buffer.concat([Buffer.from([0x81,0,0,0x80]),fake])),element(0xa0,element(0xa1,Buffer.concat([Buffer.from([0x81,0,0,0]),fake])))]),element(0x1254c367,Buffer.alloc(0))]);
  const file=await owned(t,bytes),reads=[],open=fs.open;
  const mock=t.mock.method(fs,'open',async(...args)=>{const h=await open(...args),read=h.read.bind(h);h.read=async(b,o,n,p)=>{reads.push([p,p+n]);return read(b,o,n,p);};return h;});
  let r;try{r=await inspect(file);}finally{mock.mock.restore();}
  let at=-1,found=0;while((at=bytes.indexOf(fake,at+1))!==-1){found++;assert.ok(reads.every(([a,b])=>b<=at||a>=at+fake.length),JSON.stringify({at,reads}));}
  assert.equal(found,2);assert.equal(r.stats.blockBytesSkipped,2*fake.length);assert.equal(r.nodes.filter(n=>n.name==='Tracks').length,0);
  assert.equal(r.nodes.at(-1).name,'Tags');
});

test('finite and unknown Clusters refuse unlisted IDs and unsupported block interpretations, with ordinary neighbours admitted',async t=>{
  const unknownElement=require('./helpers/ebml-fixture.cjs').unknownElement;
  for(const unknown of [false,true]){
    const wrap=payload=>streamingFile([unknown?unknownElement(0x1f43b675,payload):element(0x1f43b675,payload)]);
    await inspect(await owned(t,wrap(block)));
    for(const [payload,code]of [[element(0x4abc,Buffer.alloc(0)),'REMUX_NATIVE_UNCLASSIFIED'],[element(0xaf,Buffer.alloc(0)),'REMUX_NATIVE_ENCRYPTEDBLOCK'],
      [element(0xa0,element(0x75a1,Buffer.alloc(0))),'REMUX_NATIVE_BLOCKADDITIONS']])
      await assert.rejects(inspect(await owned(t,wrap(payload))),{code});
  }
});
test('native block framing and track-count guards have accepted neighbours without reading coded bytes',async t=>{
  const blocks=n=>Array.from({length:n},(_,i)=>element(0xa3,Buffer.from([128+i+1,0,0,128,255])));
  await inspect(await owned(t,streamingFile([cluster(blocks(32))])));
  await assert.rejects(inspect(await owned(t,streamingFile([cluster(blocks(33))]))),{code:'REMUX_NATIVE_TRACK_MAP'});
  for(const body of [Buffer.from([0,0,0,0,255]),Buffer.from([128,0,0,128,255]),Buffer.from([129,0,0])])
    await assert.rejects(inspect(await owned(t,streamingFile([cluster([element(0xa3,body)])]))),{code:'REMUX_NATIVE_BLOCK'});
});

test('each EBML shape/cap refusal has a specific code',async t=>{
  const bad=[
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([0xa3]))])],
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([0xa3,0x40]))])],
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([0x10,0x01]))])],
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([0,0x80]))])],
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([255,0x80]))])],
    ['HEADER',streamingFile([unknownElement(0x1f43b675,Buffer.from([0x40,0,0x80]))])],
    ['EXTENT',streamingFile([unknownElement(0x1f43b675,Buffer.from([0xa3,0x8a,0]))])],
    ['LEVEL',streamingFile([cluster([element(0xae,Buffer.alloc(0))])])],
    ['LEVEL',streamingFile([cluster([element(0x80,Buffer.alloc(0))])])],
    ['LEVEL',streamingFile([cluster([element(0x45a3,Buffer.from('wrong level'))])])],
    ['LEVEL',streamingFile([cluster([element(0xa0,element(0x1654ae6b,Buffer.alloc(0)))])])],
    ['LEVEL',streamingFile([element(0xa3,Buffer.alloc(0))])],
    ['LEVEL',Buffer.concat([element(0x1a45dfa3,element(0x1a45dfa3,Buffer.alloc(0))),unknownElement(0x18538067,Buffer.alloc(0))])],
    ['UNKNOWN_SIZE',streamingFile([unknownElement(0x1654ae6b,Buffer.alloc(0))])],
    ['UNKNOWN_SIZE',streamingFile([cluster([unknownElement(0xa0,Buffer.alloc(0))])])],
    ['UNKNOWN_SIZE',streamingFile([cluster([unknownElement(0xa3,Buffer.alloc(0))])])],
    ['UNKNOWN_SIZE',streamingFile([cluster([element(0xa0,unknownElement(0x75a1,Buffer.alloc(0)))])])],
  ];
  let deep=element(0x4487,Buffer.from('x'));for(let i=0;i<12;i++)deep=element(0x67c8,deep);
  bad.push(['DEPTH',streamingFile([element(0x1254c367,element(0x7373,deep))])]);
  const limit=ebmlLimits(1);bad.push(['ELEMENTS',streamingFile([cluster(Array.from({length:limit.elements},()=>block))])]);
  const wideVoid=Buffer.concat([idBytes(0xec),Buffer.from([1,0,0,0,0,0,0,0])]);
  bad.push(['HEADER_BYTES',streamingFile([unknownElement(0x1f43b675,Buffer.concat(Array(Math.ceil(limit.headerBytes/9)).fill(wideVoid)))])]);
  for(const [code,bytes]of bad)await assert.rejects(inspect(await owned(t,bytes),{maxRecords:1}),{code:'REMUX_NATIVE_EBML_'+code},code);
  for(const n of [0,-1,Number.MAX_SAFE_INTEGER])assert.throws(()=>ebmlLimits(n),{code:'REMUX_NATIVE_EBML_BUDGET'});
});

test('cancellation and deadline are observed during the header walk, with the handle closed',async t=>{
  const file=await owned(t,streamingFile([cluster(Array.from({length:100},()=>block))]));
  for(const cancellation of [true,false]){
    const controller=new AbortController(),open=fs.open;let reads=0,closed=false,clock=0,consumed=false;
    const time=t.mock.method(Date,'now',()=>clock),mock=t.mock.method(fs,'open',async(...args)=>{const h=await open(...args),read=h.read.bind(h),close=h.close.bind(h);
      h.read=async(...a)=>{if(++reads===25){if(cancellation)controller.abort();else clock=100;}return read(...a);};h.close=async()=>{closed=true;return close();};return h;});
    try{await assert.rejects(readNativeMetadata({file,family:'matroska',signal:controller.signal,timeoutMs:50,withMetadata:async()=>{consumed=true;}}),{code:cancellation?'CANCELLED':'REMUX_NATIVE_TIMEOUT'});}
    finally{time.mock.restore();mock.mock.restore();}
    assert.equal(closed,true);assert.equal(consumed,false);assert.equal(reads,25);
  }
});

test('a near-cap long synthetic walk retains metadata only, with measured cost',async t=>{
  const maxRecords=20000,limit=ebmlLimits(maxRecords),count=limit.elements-5,
    file=await owned(t,streamingFile([cluster(Array(count).fill(block))]));
  // This case isolates the element/header-count boundary. Use the separately
  // tested read-only census backend so thread-pool scheduling of hundreds of
  // thousands of tiny reads cannot substitute a deadline failure. The deadline
  // and cancellation cases below retain their own ordinary-I/O checks.
  const start=performance.now(),r=await require('../scripts/v07-remux-admission-io.cjs').metadataIo(file,()=>inspect(file,{maxRecords})),elapsedMs=performance.now()-start;
  assert.equal(r.stats.elements,limit.elements);assert.equal(r.stats.unknownClusters,1);assert.equal(r.nodes.length,4);
  assert.ok(r.stats.headerBytes<=limit.headerBytes);assert.equal(r.stats.blockBytesSkipped,count);assert.equal(r.stats.blockHeaderBytesRead,count*4);
  t.diagnostic(JSON.stringify({synthetic:true,blocks:count,...r.stats,elapsedMs}));
});

test('full collector finds and compares a playback control after an unknown Cluster on either side',async t=>{
  const f=await fixture(t,'matroska'),{parts}=segmentParts(f.original),tracks=parts.find(p=>p.id===0x1654ae6b),info=parts.find(p=>p.id===0x1549a966);
  const {children}=require('./helpers/ebml-fixture.cjs');
  const changedTracks=element(0x1654ae6b,Buffer.concat(children(tracks.body).map(h=>{
    const entry=tracks.body.subarray(h.body,h.end),video=children(entry).find(e=>e.id===0xe0);
    if(!video)return tracks.body.subarray(h.at,h.end);
    return element(0xae,Buffer.concat([entry.subarray(0,video.at),element(0xe0,Buffer.concat([entry.subarray(video.body,video.end),element(0x54cc,uint(1))])),entry.subarray(video.end)]));
  })));
  const validBlock=element(0xa3,Buffer.from([0x81,0,0,0x80,0,0,0,1,0x65]));
  const make=track=>Buffer.concat([segmentParts(f.original).prefix,unknownElement(0x18538067,Buffer.concat([info.bytes,cluster([validBlock]),track]),8)]);
  const neutral=make(tracks.bytes),mutant=make(changedTracks);
  await fs.writeFile(f.sourcePath,neutral);await fs.writeFile(f.outputPath,neutral);assert.equal((await f.collect()).status,'completed');
  for(const file of [f.sourcePath,f.outputPath]){
    await fs.writeFile(file,mutant);const r=await f.collect();assert.equal(r.status,'failed');assert.equal(r.failure.code,'REMUX_NATIVE_PIXELCROPLEFT');await fs.writeFile(file,neutral);
  }
});
