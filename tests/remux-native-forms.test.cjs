'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {atom,timedFixture,writeFixture}=require('./helpers/mov-fixture.cjs');
const {observeRemuxSourcePlayback}=require('../src/remux-edit-lists.cjs');
const {readSourceIdentity}=require('../src/source-identity.cjs');
function rewrite(bytes,type,change,ordinal=0){let seen=0;function visit(b){const out=[];for(let at=0;at<b.length;){const n=b.readUInt32BE(at),name=b.toString('ascii',at+4,at+8);let body=Buffer.from(b.subarray(at+8,at+n)),tag=name;
  if(name===type&&seen++===ordinal){const r=change(body);body=r.body||r;tag=r.type||tag;}else if(['moov','trak','mdia','minf','stbl','edts','mvex','moof','traf'].includes(name))body=visit(body);
  out.push(atom(tag,body));at+=n;}return Buffer.concat(out);}return visit(bytes);}
const raw={streams:[{index:0,id:'1',codec_type:'video',codec_name:'h264',width:2,height:2,disposition:{default:1}},
  {index:1,id:'2',codec_type:'audio',codec_name:'aac',disposition:{default:1}}]};
const bytes=()=>timedFixture([{id:1,scale:90000,pts:[0,3000],durations:[3000,3000]},{id:2,scale:48000,pts:[0],durations:[1024]}]);
async function inspect(t,b,extra={}){const f=await writeFixture(t,b);return observeRemuxSourcePlayback({file:f.path,probe:raw,identity:await readSourceIdentity(f.path),maxRecords:100,...extra});}
function widen(type,b){const r=Buffer.alloc(b.length+12);b.copy(r,1,1,4);r[0]=1;if(type==='tkhd'){b.copy(r,20,12,20);r.writeBigUInt64BE(BigInt(b.readUInt32BE(20)),28);b.copy(r,36,24);}else{b.copy(r,20,12,16);r.writeBigUInt64BE(BigInt(b.readUInt32BE(16)),24);b.copy(r,32,20);}return r;}
test('every capped fixed playback header proves its full v0/v1 extent, refusing an otherwise unseen suffix',async t=>{
  for(const version of [0,1]){let good=bytes();if(version)for(const type of ['mvhd','tkhd','mdhd'])good=rewrite(good,type,b=>widen(type,b));await inspect(t,good);
    for(const type of ['mvhd','tkhd','mdhd'])await assert.rejects(inspect(t,rewrite(good,type,b=>Buffer.concat([b,Buffer.from([1])]))),{code:'REMUX_NATIVE_'+type.toUpperCase()+'_HEADER'});
  }
});
test('source tkhd/mvhd duration contradictions are rejected in versions 0 and 1',async t=>{
  for(const type of ['tkhd','mvhd'])for(const version of [0,1]){
    const bad=rewrite(bytes(),type,b=>{if(version)b=widen(type,b);if(version)b.writeBigUInt64BE(1n,type==='tkhd'?28:24);else b.writeUInt32BE(1,type==='tkhd'?20:16);return b;});
    await assert.rejects(inspect(t,bad),{code:'REMUX_SOURCE_DURATION_UNVERIFIED'});
  }
});

test('source delay quantisation reconciles exact writer declarations, with impossible ends refused',async t=>{
  const original=timedFixture([{id:1,scale:90000,pts:[6000,9000],durations:[3000,3000]}],{movieScale:1001});
  const probe={streams:[raw.streams[0]]};
  for(const version of [0,1]){
    let b=original;if(version)for(const type of ['tkhd','mvhd','mdhd'])b=rewrite(b,type,h=>widen(type,h));
    // floor(6000*1001/90000)=66; ceil(6000*1001/90000)=67;
    // ceil(12000*1001/90000)=134. The edit sum is only 133.
    await inspect(t,b,{probe});
    const bad=rewrite(b,'tkhd',h=>{if(version)h.writeBigUInt64BE(135n,28);else h.writeUInt32BE(135,20);return h;});
    await assert.rejects(inspect(t,bad,{probe}),{code:'REMUX_SOURCE_DURATION_UNVERIFIED'});
  }
});
test('source v0/v1 display geometry and sound balance cannot be rewritten silently',async t=>{
  for(const version of [0,1])for(const offset of [76,80])await assert.rejects(inspect(t,rewrite(bytes(),'tkhd',b=>{if(version)b=widen('tkhd',b);b.writeUInt32BE(65536,offset+(version?12:0));return b;})),{code:'REMUX_TRACK_GEOMETRY_UNSUPPORTED'});
  await assert.rejects(inspect(t,rewrite(bytes(),'smhd',b=>{b.writeInt16BE(256,4);return b;})),{code:'REMUX_SOUND_BALANCE_UNSUPPORTED'});
});
test('non-reproducible controls refuse per target, while default/alternative dispositions and omissions map explicitly',async t=>{
  for(const target of ['mp4','mov','matroska'])for(const flag of [1,7,15])await assert.rejects(inspect(t,rewrite(bytes(),'tkhd',b=>{b.writeUIntBE(flag,1,3);return b;}),{target}),{code:'REMUX_SOURCE_CONTROL_UNREPRESENTABLE'});
  const alternate=rewrite(bytes(),'tkhd',b=>{b.writeUIntBE(2,1,3);return b;},1),p=structuredClone(raw);p.streams[1].disposition.default=0;
  await inspect(t,alternate,{probe:p,target:'matroska'});
  await assert.rejects(inspect(t,alternate,{probe:p,target:'mp4'}),{code:'REMUX_SOURCE_CONTROL_UNREPRESENTABLE'});
  await assert.rejects(inspect(t,alternate),e=>e.code==='REMUX_SOURCE_PLAYBACK_UNSUPPORTED'&&e.message.includes('tkhd.flags=2'));
  for(const target of ['mp4','mov','matroska']){
    await assert.rejects(inspect(t,rewrite(bytes(),'tkhd',b=>{b.writeUInt16BE(2,32);return b;},1),{target}),{code:'REMUX_SOURCE_CONTROL_UNREPRESENTABLE'});
    await inspect(t,rewrite(bytes(),'tkhd',b=>{b.writeUInt16BE(0,34);return b;},1),{target});
  }
  await assert.rejects(inspect(t,bytes(),{target:'unknown'}),{code:'REMUX_SOURCE_CONTROL_UNREPRESENTABLE'});
  const omitted=structuredClone(raw);omitted.streams[1].codec_type='subtitle';omitted.streams[1].codec_name='mov_text';
  await inspect(t,bytes(),{probe:omitted,selectedIndexes:[0]});
  await assert.rejects(inspect(t,bytes(),{probe:omitted,selectedIndexes:[0,1]}),{code:'REMUX_SOURCE_PLAYBACK_UNSUPPORTED'});
});
test('compact stz2 widths 4/8/16 and exact extents; duplicates and malformed tables refuse',async t=>{
  const compact=width=>{let b=bytes();for(let i=0;i<2;i++)b=rewrite(b,'stsz',s=>{const count=s.readUInt32BE(8),r=Buffer.alloc(12+Math.ceil(count*width/8));r[7]=width;r.writeUInt32BE(count,8);return{type:'stz2',body:r};});return b;};
  for(const width of [4,8,16])await inspect(t,compact(width));
  for(const edit of [b=>{b[7]=12;return b;},b=>b.subarray(0,b.length-1),b=>{b.writeUInt32BE(101,8);return b;}])await assert.rejects(inspect(t,rewrite(compact(16),'stz2',edit)),{code:'REMUX_SAMPLE_TABLE_UNVERIFIED'});
  await assert.rejects(inspect(t,rewrite(compact(16),'stbl',b=>Buffer.concat([b,atom('stsz',Buffer.alloc(12))]))),{code:'REMUX_SAMPLE_TABLE_UNVERIFIED'});
});
function fragmented(){let b=timedFixture([{id:1,scale:90000,pts:[0],durations:[3000]}]);
  for(const type of ['mvhd','tkhd','mdhd'])b=rewrite(b,type,h=>{h.writeUInt32BE(0,type==='tkhd'?20:16);return h;});
  b=rewrite(b,'edts',h=>({type:'free',body:h}));b=rewrite(b,'stsz',h=>{h.writeUInt32BE(0,8);return h;});for(const type of ['stts','ctts'])b=rewrite(b,type,()=>Buffer.alloc(8));
  const trex=Buffer.alloc(24);trex.writeUInt32BE(1,4);trex.writeUInt32BE(1,8);trex.writeUInt32BE(3000,12);trex.writeUInt32BE(1,16);
  b=rewrite(b,'moov',h=>Buffer.concat([h,atom('mvex',atom('trex',trex))]));
  const tfhd=Buffer.alloc(8);tfhd.writeUIntBE(0x20000,1,3);tfhd.writeUInt32BE(1,4);const trun=Buffer.alloc(8);trun.writeUInt32BE(2,4);
  return Buffer.concat([b,atom('moof',atom('traf',Buffer.concat([atom('tfhd',tfhd),atom('tfdt',Buffer.alloc(8)),atom('trun',trun)]))),atom('mdat',Buffer.alloc(2))]);
}
test('bounded fragment timing admits empty moov and rejects unverifiable fragment coverage by name',async t=>{
  const probe={streams:[raw.streams[0]]},b=fragmented();await inspect(t,b,{probe});
  for(const [type,change]of [
    ['tfhd',h=>{h.writeUInt32BE(2,4);return h;}],['tfhd',h=>{h.writeUIntBE(0x30000,1,3);return h;}],['tfdt',h=>{h[0]=2;return h;}],['trun',h=>{h.writeUInt32BE(101,4);return h;}],
    ['trex',h=>{h.writeUInt32BE(0,12);return h;}],['mvex',h=>({type:'free',body:h})],
    ['stsz',h=>{h.writeUInt32BE(1,8);return h;}],['traf',h=>Buffer.concat([h,atom('tfhd',Buffer.alloc(8))])]
  ])await assert.rejects(inspect(t,rewrite(b,type,change),{probe}),{code:'REMUX_SOURCE_FRAGMENT_UNVERIFIED'});
});
test('playback inspection cannot open a writable handle or expose a stage writer',async t=>{
  assert.equal(require('../src/outputs.cjs').updateStagePlayback,undefined);
  assert.equal(require('../src/remux-edit-lists.cjs').preserveRemuxSourceControls,undefined);
  const f=await writeFixture(t,bytes()),identity=await readSourceIdentity(f.path),open=fs.open;
  t.mock.method(fs,'open',async(file,flags,...rest)=>{assert.equal(flags,'r');return open(file,flags,...rest);});
  await observeRemuxSourcePlayback({file:f.path,probe:raw,identity,maxRecords:100});
  assert.deepEqual(await fs.readFile(f.path),bytes());
});

test('substituted registered input, hard link and foreign inode can never become writable playback targets',async t=>{
  const a=await writeFixture(t,bytes()),b=await writeFixture(t,bytes()),before=await fs.readFile(b.path),old=await readSourceIdentity(a.path);
  for(const hardLink of [false,true]){
    await fs.unlink(a.path);if(hardLink)await fs.link(b.path,a.path);else await fs.copyFile(b.path,a.path);
    await assert.rejects(observeRemuxSourcePlayback({file:a.path,probe:raw,identity:old,maxRecords:100}),{code:'REMUX_SOURCE_PLAYBACK_UNVERIFIED'});
    assert.deepEqual(await fs.readFile(b.path),before);assert.deepEqual(await fs.readFile(a.path),before);
  }
  assert.equal(require('../src/outputs.cjs').updateStagePlayback,undefined);
});

test('aperture modes must each equal plain track geometry, including malformed and duplicate modes',async t=>{
  const mode=(name,width=2*65536)=>{const h=Buffer.alloc(12);h.writeUInt32BE(width,4);h.writeUInt32BE(2*65536,8);return atom(name,h);};
  const withModes=modes=>rewrite(bytes(),'trak',h=>Buffer.concat([h,atom('tapt',Buffer.concat(modes))]));
  await inspect(t,withModes(['clef','prof','enof'].map(n=>mode(n))));
  for(const name of ['clef','prof','enof'])await assert.rejects(inspect(t,withModes([mode(name,65536)])),{code:'REMUX_TRACK_APERTURE_UNSUPPORTED'});
  for(const modes of [[],[mode('clef'),mode('clef')],[mode('nope')],[atom('clef',Buffer.alloc(8))]])
    await assert.rejects(inspect(t,withModes(modes)),{code:'REMUX_TRACK_APERTURE_UNSUPPORTED'});
  await assert.rejects(inspect(t,rewrite(withModes([mode('clef')]),'trak',h=>Buffer.concat([h,atom('tapt',mode('clef'))]))),{code:'REMUX_TRACK_APERTURE_UNSUPPORTED'});
});

test('contiguous unity media edits name unverified repeated preroll rather than inventing an empty edit',async t=>{
  const b=timedFixture([{id:1,scale:90000,pts:[0,3000],durations:[3000,3000]}],{movieScale:90000});
  const split=rewrite(b,'elst',()=>{const h=Buffer.alloc(32);h.writeUInt32BE(2,4);for(let i=0;i<2;i++){h.writeUInt32BE(3000,8+i*12);h.writeInt32BE(i*3000,12+i*12);h.writeInt16BE(1,16+i*12);}return h;});
  await assert.rejects(inspect(t,split,{probe:{streams:[raw.streams[0]]}}),e=>e.code==='REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED'&&e.message.includes('preroll'));
});

test('missing fragment clocks infer continuous ends and hybrid sample counts remain cumulative',async t=>{
  const probe={streams:[raw.streams[0]]};let b=fragmented();
  assert.equal((await inspect(t,rewrite(b,'tfdt',h=>({type:'free',body:h})),{probe})).tracks[0].fragmentCoverage.samples,'2');
  b=rewrite(b,'stsz',h=>{h.writeUInt32BE(1,8);return h;});
  for(const type of ['stts','ctts'])b=rewrite(b,type,()=>{const h=Buffer.alloc(16);h.writeUInt32BE(1,4);h.writeUInt32BE(1,8);h.writeUInt32BE(type==='stts'?3000:0,12);return h;});
  for(const type of ['mvhd','tkhd','mdhd'])b=rewrite(b,type,h=>{h.writeUInt32BE(type==='mdhd'?3000:8000,type==='tkhd'?20:16);return h;});
  await assert.rejects(inspect(t,b,{probe}),{code:'REMUX_SOURCE_FRAGMENT_UNVERIFIED'});
  b=rewrite(b,'tfdt',h=>{h.writeUInt32BE(3000,4);return h;});
  for(const v of [b,rewrite(b,'tfdt',h=>({type:'free',body:h}))]){
    const r=await inspect(t,v,{probe});assert.equal(r.tracks[0].fragmentCoverage.samples,'3');assert.equal(r.tracks[0].fragmentCoverage.decodeDuration,'9000');
    await assert.rejects(inspect(t,v,{probe,maxRecords:2}),{code:'REMUX_SOURCE_FRAGMENT_UNVERIFIED'});
  }
  await assert.rejects(inspect(t,rewrite(b,'tfdt',h=>{h.writeUInt32BE(3001,4);return h;}),{probe}),{code:'REMUX_SOURCE_FRAGMENT_UNVERIFIED'});
});

test('constant trun counts aggregate in bounded work and poll real cancellation/deadlines',async t=>{
  const {fragmentCoverage}=require('../src/remux-fragments.cjs'),{ToolError}=require('../src/process-runner.cjs');
  const b=rewrite(fragmented(),'trun',h=>{h.writeUInt32BE(5000000,4);return h;}),trun=b.indexOf(Buffer.from('trun'))+4;
  const boxes=async(start,end)=>{const out=[];for(let at=start;at<end;){const n=b.readUInt32BE(at);out.push({type:b.toString('ascii',at+4,at+8),body:at+8,end:at+n});at+=n;}return out;};
  const top=await boxes(0,b.length),moov=top.find(x=>x.type==='moov'),movieBoxes=await boxes(moov.body,moov.end);
  for(const code of [null,'CANCELLED','REMUX_NATIVE_TIMEOUT']){
    let pending=false,reads=0;
    const read=async(at,n)=>{reads++;if(pending)throw new ToolError(code,'Synthetic deadline/cancellation at a fragment yield.');
      if(code&&at===trun&&n===8)setImmediate(()=>{pending=true;});return b.subarray(at,at+n);};
    const run=()=>fragmentCoverage({top,movieBoxes,boxes,read,maxRecords:5000000,trackIds:new Set([1])});
    if(code)await assert.rejects(run(),{code});else{let conversions=0;const bigint=BigInt,guard=t.mock.method(global,'BigInt',v=>{assert.ok(++conversions<30,'Default samples must aggregate without per-sample arithmetic.');return bigint(v);});
      try{const r=await run();assert.equal(r.get(1).count,5000000);assert.equal(r.get(1).clock,15000000000n);}finally{guard.mock.restore();}}
    assert.ok(reads<25,'A default-only run must not iterate per sample.');
  }
  const huge=0xffffffffffffffffn,wide=rewrite(b,'tfdt',()=>{const h=Buffer.alloc(12);h[0]=1;h.writeBigUInt64BE(huge,4);return h;});
  const wideBoxes=async(start,end)=>{const out=[];for(let at=start;at<end;){const n=wide.readUInt32BE(at);out.push({type:wide.toString('ascii',at+4,at+8),body:at+8,end:at+n});at+=n;}return out;};
  const wideTop=await wideBoxes(0,wide.length),movie=wideTop.find(b=>b.type==='moov');
  await assert.rejects(fragmentCoverage({top:wideTop,movieBoxes:await wideBoxes(movie.body,movie.end),boxes:wideBoxes,read:async(at,n)=>wide.subarray(at,at+n),maxRecords:5000001,
    initial:new Map([[1,{count:1,clock:huge,minimum:0n,maximum:huge,endDts:huge}]])}),e=>e.code==='REMUX_SOURCE_FRAGMENT_UNVERIFIED'&&/overflows/.test(e.message));
});
