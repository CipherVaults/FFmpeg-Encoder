'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {atom,timedFixture,writeFixture}=require('./helpers/mov-fixture.cjs');
const {observeRemuxSourcePlayback,preserveRemuxSourceControls}=require('../src/remux-edit-lists.cjs');
const {readSourceIdentity}=require('../src/source-identity.cjs');
const {createStage,sealStage,updateStagePlayback,cleanupStage}=require('../src/outputs.cjs');
function rewrite(bytes,type,change,ordinal=0){let seen=0;function visit(b){const out=[];for(let at=0;at<b.length;){const n=b.readUInt32BE(at),name=b.toString('ascii',at+4,at+8);let body=Buffer.from(b.subarray(at+8,at+n)),tag=name;
  if(name===type&&seen++===ordinal){const r=change(body);body=r.body||r;tag=r.type||tag;}else if(['moov','trak','mdia','minf','stbl','edts','mvex','moof','traf'].includes(name))body=visit(body);
  out.push(atom(tag,body));at+=n;}return Buffer.concat(out);}return visit(bytes);}
const raw={streams:[{index:0,id:'1',codec_type:'video',codec_name:'h264',width:2,height:2,disposition:{default:1}},
  {index:1,id:'2',codec_type:'audio',codec_name:'aac',disposition:{default:1}}]};
const bytes=()=>timedFixture([{id:1,scale:90000,pts:[0,3000],durations:[3000,3000]},{id:2,scale:48000,pts:[0],durations:[1024]}]);
async function inspect(t,b,extra={}){const f=await writeFixture(t,b);return observeRemuxSourcePlayback({file:f.path,probe:raw,identity:await readSourceIdentity(f.path),maxRecords:100,...extra});}
function widen(type,b){const r=Buffer.alloc(b.length+12);b.copy(r,1,1,4);r[0]=1;if(type==='tkhd'){b.copy(r,20,12,20);r.writeBigUInt64BE(BigInt(b.readUInt32BE(20)),28);b.copy(r,36,24);}else{b.copy(r,20,12,16);r.writeBigUInt64BE(BigInt(b.readUInt32BE(16)),24);b.copy(r,32,20);}return r;}
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
test('enabled flag variants, alternate audio and explicit omissions follow admitted source semantics',async t=>{
  for(const flag of [1,7,15])assert.equal((await inspect(t,rewrite(bytes(),'tkhd',b=>{b.writeUIntBE(flag,1,3);return b;}))).tracks[0].controls.flags,flag);
  const alternate=rewrite(bytes(),'tkhd',b=>{b.writeUIntBE(2,1,3);return b;},1),p=structuredClone(raw);p.streams[1].disposition.default=0;
  await inspect(t,alternate,{probe:p});await assert.rejects(inspect(t,alternate),e=>e.code==='REMUX_SOURCE_PLAYBACK_UNSUPPORTED'&&e.message.includes('tkhd.flags=2'));
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
test('playback writes require a genuine unsealed stage and unchanged identity',async t=>{
  const f=await writeFixture(t,bytes()),folder=require('node:path').dirname(f.path),stage=await createStage(folder);await fs.writeFile(stage.file,bytes());
  try{
    const s=await fs.stat(stage.file,{bigint:true}),expected=Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));
    await assert.rejects(updateStagePlayback({...stage},expected,()=>{}),{code:'INVALID_STAGE'});
    await assert.rejects(updateStagePlayback(stage,{...expected,ino:'0'},()=>{}),{code:'STAGE_CHANGED'});
    await sealStage(stage);await assert.rejects(updateStagePlayback(stage,expected,()=>{}),{code:'STAGE_ALREADY_SEALED'});
  }finally{await cleanupStage(stage);}
  await assert.rejects(preserveRemuxSourceControls({file:f.path,probe:raw,identity:await readSourceIdentity(f.path),output:f.path,
    mappings:[{inputIndex:0,outputIndex:0},{inputIndex:1,outputIndex:1}],maxRecords:100}),{code:'REMUX_PLAYBACK_WRITE_UNVERIFIED'});
  const changed=await writeFixture(t,rewrite(bytes(),'tkhd',b=>{b.writeUIntBE(7,1,3);return b;})),owned=await createStage(folder);await fs.writeFile(owned.file,bytes());
  const options={file:changed.path,probe:raw,identity:await readSourceIdentity(changed.path),output:owned.file,mappings:[{inputIndex:0,outputIndex:0},{inputIndex:1,outputIndex:1}],maxRecords:100};
  try{await assert.rejects(preserveRemuxSourceControls(options),{code:'REMUX_PLAYBACK_WRITE_UNVERIFIED'});
    await assert.rejects(preserveRemuxSourceControls({...options,stage:{...owned}}),{code:'INVALID_STAGE'});
  }finally{await sealStage(owned);await cleanupStage(owned);}
});
