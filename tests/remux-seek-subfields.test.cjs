'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./helpers/remux-real-witness.cjs'),{isoRewrite,ebmlRewrite,compact,wideOffsets}=require('./helpers/remux-packet-witnesses.cjs'),{children}=require('./helpers/ebml-fixture.cjs'),{atom}=require('./helpers/mov-fixture.cjs');
const {observeNativeInventory,compareNativeInventories}=require('../src/remux-native-checks.cjs'),{relocateMatroska}=require('./helpers/remux-matroska-relocate.cjs');
const {runTool}=require('../src/process-runner.cjs'),{ffmpeg}=require('../src/candidate-runtime.cjs').resolveCandidateRuntime({root:require('node:path').resolve(__dirname,'..')});
const inspect=(f,file=f.sourcePath,family='isobmff')=>observeNativeInventory({file,probe:f.source,family,target:family==='isobmff'?'mp4':'matroska'});
async function mutations(f,type,cases){await fs.writeFile(f.sourcePath,f.original);await inspect(f);for(const [name,change]of cases){await fs.writeFile(f.sourcePath,isoRewrite(f.original,type,change));await assert.rejects(inspect(f),{code:'REMUX_NATIVE_'+type.toUpperCase()},type+'.'+name);}await fs.writeFile(f.sourcePath,f.original);}
test('no alternate offset or size table can hide behind an inspected first table',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false});for(const transform of [b=>b,compact,wideOffsets]){await fs.writeFile(f.sourcePath,transform(f.original));await inspect(f);}
  for(const [transform,type,code]of [[compact,'stz2','REMUX_NATIVE_STZ2'],[wideOffsets,'co64','REMUX_NATIVE_CO64']]){let extra;isoRewrite(transform(f.original),type,b=>{extra=atom(type,b);return b;});assert.ok(extra);const bad=isoRewrite(f.original,'stbl',b=>Buffer.concat([b,extra]));await fs.writeFile(f.sourcePath,bad);await assert.rejects(inspect(f),{code});}
});
test('flat sync/chunk/clock table subfields each hit their own native guard',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false});
  await mutations(f,'stss',[
    ['version',b=>{b[0]=1;return b;}],['flags',b=>{b[3]=1;return b;}],['count',b=>{b.writeUInt32BE(0,4);return b;}],['sample_number',b=>{b.writeUInt32BE(2,8);return b;}],['order',b=>{b.writeUInt32BE(b.readUInt32BE(8),12);return b;}]
  ]);
  await mutations(f,'stsc',[[ 'first_chunk',b=>{b.writeUInt32BE(2,8);return b;}],['samples_per_chunk',b=>{b.writeUInt32BE(b.readUInt32BE(12)+1,12);return b;}],['sample_description',b=>{b.writeUInt32BE(2,16);return b;}] ]);
  for(const type of ['stts','ctts'])await mutations(f,type,[['version',b=>{b[0]=2;return b;}],['flags',b=>{b[3]=1;return b;}],['entry_count',b=>{b.writeUInt32BE(0,4);return b;}],['sample_count',b=>{b.writeUInt32BE(b.readUInt32BE(8)+1,8);return b;}] ]);
});
test('fragment default/override flags and decode/run header fields are independently exercised',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false,movflags:'frag_keyframe+empty_moov+default_base_moof'});
  await mutations(f,'trex',[[ 'version',b=>{b[0]=1;return b;}],['flags',b=>{b[3]=1;return b;}],['track',b=>{b.writeUInt32BE(99,4);return b;}],['description',b=>{b.writeUInt32BE(2,8);return b;}],['sample_flags',b=>{b.writeUInt32BE(0x80000000,20);return b;}] ]);
  await mutations(f,'tfhd',[[ 'version',b=>{b[0]=1;return b;}],['flags',b=>{b[1]|=128;return b;}],['track',b=>{b.writeUInt32BE(99,4);return b;}] ]);
  await mutations(f,'tfdt',[[ 'version',b=>{b[0]=2;return b;}],['flags',b=>{b[3]=1;return b;}] ]);
  await mutations(f,'trun',[[ 'version',b=>{b[0]=2;return b;}],['flags',b=>{b[1]|=128;return b;}],['count',b=>{b.writeUInt32BE(0,4);return b;}],['first_sample_flags',b=>{assert.ok(b.readUIntBE(1,3)&4);b.writeUInt32BE(0x1010000,12);return b;}] ]);
});
test('every tfra locator component and mfro footer component is bound to its own packets',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false,movflags:'frag_keyframe+empty_moov+default_base_moof'});
  await mutations(f,'tfra',[[ 'version',b=>{b[0]=2;return b;}],['flags',b=>{b[3]=1;return b;}],['track',b=>{b.writeUInt32BE(99,4);return b;}],['entry_widths',b=>{b[8]=1;return b;}],['count',b=>{b.writeUInt32BE(0,12);return b;}],
    ...['time','moof','traf','trun','sample'].map((name,i)=>[name,b=>{const width=b[0]?8:4,at=i<2?16+i*width:16+2*width+i-2;b[at+(i<2?width-1:0)]^=1;return b;}])]);
  await mutations(f,'mfro',[[ 'version',b=>{b[0]=1;return b;}],['flags',b=>{b[3]=1;return b;}],['locator',b=>{b.writeUInt32BE(1,4);return b;}] ]);
});
test('each sidx interpretation field is checked independently against its referenced native fragment',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false,movflags:'frag_keyframe+empty_moov+default_base_moof+dash'}),field=(name,offset,width,value)=>[name,b=>{const at=typeof offset==='function'?offset(b):offset;b.writeUIntBE(value,at,width);return b;}];
  await mutations(f,'sidx',[field('version',0,1,2),field('flags',3,1,1),field('reference_ID',4,4,99),field('timescale',8,4,1),['earliest_presentation_time',b=>{b[12+(b[0]?7:3)]^=1;return b;}],['first_offset',b=>{b[12+(b[0]?15:7)]^=1;return b;}],field('reserved',b=>(b[0]?32:24)-4,2,1),field('reference_count',b=>(b[0]?32:24)-2,2,0),
    ...[['reference_size',0,1],['reference_type',0,0x80000000],['subsegment_duration',4,1],['SAP_delta_time',8,1],['starts_with_SAP',8,0x80000000],['SAP_type',8,0x10000000]].map(([name,offset,mask])=>[name,b=>{const at=(b[0]?32:24)+offset;b.writeUInt32BE((b.readUInt32BE(at)^mask)>>>0,at);return b;}])]);
});

function tfraFraming(bytes,version,widths){
  bytes=isoRewrite(bytes,'tfra',b=>{
    const oldClock=b[0]?8:4,oldLengths=b.readUInt32BE(8),oldWidths=[(oldLengths>>4&3)+1,(oldLengths>>2&3)+1,(oldLengths&3)+1],count=b.readUInt32BE(12),clock=version?8:4;
    const head=Buffer.from(b.subarray(0,16)),rows=[];head[0]=version;head.writeUInt32BE((widths[0]-1)<<4|(widths[1]-1)<<2|widths[2]-1,8);let at=16;
    for(let i=0;i<count;i++){
      const row=Buffer.alloc(clock*2+widths.reduce((a,v)=>a+v,0));let to=0;
      for(let j=0;j<2;j++){const value=oldClock===8?b.readBigUInt64BE(at):BigInt(b.readUInt32BE(at));at+=oldClock;if(clock===8)row.writeBigUInt64BE(value,to);else{assert.ok(value<=0xffffffffn);row.writeUInt32BE(Number(value),to);}to+=clock;}
      for(let j=0;j<3;j++){row.writeUIntBE(b.readUIntBE(at,oldWidths[j]),to,widths[j]);at+=oldWidths[j];to+=widths[j];}rows.push(row);
    }assert.equal(at,b.length);return Buffer.concat([head,...rows]);
  });
  let mfraBytes;isoRewrite(bytes,'mfra',b=>{mfraBytes=b.length+8;return b;});assert.ok(mfraBytes);
  return isoRewrite(bytes,'mfro',b=>{b.writeUInt32BE(mfraBytes,4);return b;});
}
test('TFRA v0 and all three locator widths 2/3/4 have valid present neighbours and exact locator refusals',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false,movflags:'frag_keyframe+empty_moov+default_base_moof'});
  const seek=async()=>{const result=await runTool(ffmpeg,['-v','error','-nostdin','-ss','0.5','-noaccurate_seek','-i',f.sourcePath,'-map','0:v:0','-frames:v','1','-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','framehash','-']),rows=result.stdout.split(/\r?\n/).filter(s=>s&&!s.startsWith('#'));assert.equal(rows.length,1);return rows[0].split(',').at(-1).trim();},originalSeek=await seek();
  const forms=[{version:0,widths:[1,1,1]}];for(const version of [0,1])for(let field=0;field<3;field++)for(const width of [2,3,4]){const widths=[1,1,1];widths[field]=width;forms.push({version,widths,field});}
  for(const {version,widths,field=0}of forms){
    const original=tfraFraming(f.original,version,widths);await fs.writeFile(f.sourcePath,original);await inspect(f);
    const probe=await f.probe(f.sourcePath);assert.equal(probe.streams[0].codec_name,'h264');assert.equal(await seek(),originalSeek,'pinned reader seeks the accepted TFRA framing '+JSON.stringify({version,widths}));
    // Changing exactly one locator value preserves this framing and footer.
    const bad=isoRewrite(original,'tfra',b=>{const at=16+2*(version?8:4)+widths.slice(0,field).reduce((a,v)=>a+v,0);b.writeUIntBE(0,at,widths[field]);return b;});
    await fs.writeFile(f.sourcePath,bad);await assert.rejects(inspect(f),{code:'REMUX_NATIVE_TFRA'},JSON.stringify({version,widths,field}));
  }
});
test('an output may add correct cue entries; removing a source-indexed keyframe refuses even when its remaining cues are valid',async t=>{
  const f=await realWitness(t,'matroska',{audio:false}),partial=relocateMatroska(f.original,ebmlRewrite(f.original,0x1c53bb6b,b=>{const first=children(b).find(n=>n.id===0xbb);return b.subarray(first.at,first.end);}));
  await fs.writeFile(f.outputPath,partial);const whole=await inspect(f,f.sourcePath,'matroska'),few=await inspect(f,f.outputPath,'matroska'),map=[{inputIndex:0,outputIndex:0}];assert.ok(whole.randomAccess.streams[0].indexed.length>few.randomAccess.streams[0].indexed.length);compareNativeInventories(few,whole,map);assert.throws(()=>compareNativeInventories(whole,few,map),{code:'REMUX_NATIVE_SEEK_COVERAGE'});
});
test('native own-packet record budgets cover the complete selected file in both containers',async t=>{
  for(const family of ['matroska','isobmff']){const f=await realWitness(t,family,{audio:true});let total=0;
    if(family==='matroska'){const masters=new Set(require('../src/remux-native-inventory.cjs').MATROSKA_SCHEMA.filter(r=>r.type==='master').map(r=>Number(r.id)));function walk(b){for(const n of children(b)){if(n.id===0xa1||n.id===0xa3)total++;else if(masters.has(n.id))walk(b.subarray(n.body,n.end));}}walk(f.original);}
    else{isoRewrite(f.original,'moov',b=>{for(let at=0;(at=b.indexOf('stsz',at))>=0;at+=4)total+=b.readUInt32BE(at+12);return b;});}
    const options={file:f.sourcePath,probe:f.source,family,target:family==='isobmff'?'mp4':'matroska'};await observeNativeInventory({...options,maxRecords:total});await assert.rejects(observeNativeInventory({...options,maxRecords:total-1}),{code:'REMUX_NATIVE_SEEK_BUDGET'});
  }
});
function inherited(bytes,remove){let values={};bytes=isoRewrite(bytes,'tfhd',b=>{const flags=b.readUIntBE(1,3);assert.equal(flags&0x38,0x38);let at=8;const out=[Buffer.from(b.subarray(0,8))];for(const [bit,name]of [[8,'duration'],[16,'size'],[32,'flags']]){values[name]=b.readUInt32BE(at);if(!(remove&bit))out.push(b.subarray(at,at+4));at+=4;}const result=Buffer.concat(out);result.writeUIntBE(flags&~remove,1,3);return result;});
  bytes=isoRewrite(bytes,'trex',b=>{b.writeUInt32BE(values.duration,12);b.writeUInt32BE(values.size,16);b.writeUInt32BE(values.flags,20);return b;});return isoRewrite(bytes,'traf',b=>Buffer.concat([b,atom('free',Buffer.alloc(0))]));}
test('active TFHD and inherited TREX duration, size and flags have separate valid neighbours',async t=>{
  const options={audio:false,frames:1,movflags:'frag_keyframe+empty_moov+default_base_moof'},one=await realWitness(t,'isobmff',options);
  await mutations(one,'tfhd',[['default_duration',b=>{b.writeUInt32BE(0,8);return b;}],['default_size',b=>{b.writeUInt32BE(0,12);return b;}] ]);
  const defaults=await realWitness(t,'isobmff',{...options,transform:b=>inherited(b,24)});await mutations(defaults,'trex',[['default_duration',b=>{b.writeUInt32BE(0,12);return b;}],['default_size',b=>{b.writeUInt32BE(0,16);return b;}] ]);
  const reference=await realWitness(t,'isobmff',{...options,frames:2,transform:b=>inherited(b,40)});await mutations(reference,'trex',[['default_flags',b=>{b.writeUInt32BE(0x2000000,20);return b;}] ]);
  const explicitBase=await realWitness(t,'isobmff',{audio:false,frames:1,movflags:'frag_keyframe+empty_moov'});await mutations(explicitBase,'tfhd',[['base_data_offset',b=>{assert.ok(b.readUIntBE(1,3)&1);b.writeBigUInt64BE(0xffffffffffffn,8);return b;}] ]);
});
test('explicit sample-description and per-sample duration/size/flags are accepted and independently guarded',async t=>{
  const options={audio:false,frames:1,movflags:'frag_keyframe+empty_moov+default_base_moof'};
  const description=await realWitness(t,'isobmff',{...options,transform:bytes=>{
    bytes=isoRewrite(bytes,'tfhd',b=>{const flags=b.readUIntBE(1,3),head=Buffer.from(b.subarray(0,8)),index=Buffer.from([0,0,0,1]);head.writeUIntBE(flags|2,1,3);const tail=Buffer.from(b.subarray(8));tail.writeUInt32BE(0x2000000,8);return Buffer.concat([head,index,tail]);});
    return isoRewrite(bytes,'trun',b=>{assert.ok(b.readUIntBE(1,3)&4);const head=Buffer.from(b.subarray(0,12));head.writeUIntBE(b.readUIntBE(1,3)&~4,1,3);return Buffer.concat([head,b.subarray(16)]);});
  }});await mutations(description,'tfhd',[['sample_description',b=>{b.writeUInt32BE(2,8);return b;}] ]);
  const samples=await realWitness(t,'isobmff',{...options,transform:bytes=>{let duration,size;
    bytes=isoRewrite(bytes,'tfhd',b=>{duration=b.readUInt32BE(8);size=b.readUInt32BE(12);const head=Buffer.from(b.subarray(0,8));head.writeUIntBE(b.readUIntBE(1,3)&~24,1,3);return Buffer.concat([head,b.subarray(16)]);});
    return isoRewrite(bytes,'trun',b=>{assert.ok(b.readUIntBE(1,3)&4);assert.equal(b.readUInt32BE(4),1);const head=Buffer.from(b.subarray(0,12)),row=Buffer.alloc(12);head.writeUIntBE((b.readUIntBE(1,3)&~4)|0x700,1,3);row.writeUInt32BE(duration,0);row.writeUInt32BE(size,4);row.writeUInt32BE(b.readUInt32BE(12),8);return Buffer.concat([head,row,b.subarray(16)]);});
  }});await mutations(samples,'trun',[['data_offset',b=>{b.writeUInt32BE(0x7fffffff,8);return b;}],['duration',b=>{b.writeUInt32BE(0,12);return b;}],['size',b=>{b.writeUInt32BE(0,16);return b;}],['per_sample_flags',b=>{b.writeUInt32BE(0x1010000,20);return b;}] ]);
});
