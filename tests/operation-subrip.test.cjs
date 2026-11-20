'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { observeSubRip, clipSubRip, LIMITS } = require('../src/operation-subrip.cjs');
const { element: el, uint } = require('./helpers/matroska-fixture.cjs');
const u = (id,n) => el(id,uint(n)), s = (id,v) => el(id,Buffer.from(v));
const master = (id,children) => el(id,Buffer.concat(children));
const sha = b => createHash('sha256').update(b).digest('hex');
const UID = '18446744073709551614';
function track(num, opts={}) {
  return master(0xae,[u(0xd7,num),u(0x73c5,opts.uid ?? UID),u(0x83,opts.kind ?? 17),
    s(0x86,opts.codec ?? 'S_TEXT/UTF8'), ...(opts.lang===null?[]:[s(0x22b59c,opts.lang??'ara')]),
    s(0x536e,'Captions'),u(0x55aa,1),...(opts.extra??[])]);
}
function block(start,end,text,number=1,opts={}) {
  const h=Buffer.from([128+number,0,0,opts.flags??0]); h.writeInt16BE(start,1);
  const payload=el(opts.simple?0xa3:0xa1,Buffer.concat([h,Buffer.from(text)]));
  return opts.simple?payload:master(0xa0,[payload,...(end===null?[]:[u(0x9b,end-start)]),...(opts.extra??[])]);
}
function file(blocks,opts={}) {
  return Buffer.concat([master(0x1a45dfa3,[s(0x4282,opts.doc??'matroska')]),
    master(0x18538067,[master(0x1549a966,[...(opts.scale===null?[]:[u(0x2ad7b1,opts.scale??1000000)]),...(opts.info??[])]),
      master(0x1654ae6b,opts.tracks??[track(1)]),master(0x1f43b675,[...(opts.clock===null?[]:[u(0xe7,opts.clock??0)]),...blocks]),...(opts.extra??[])])]);
}
const observe = (b,n='1') => observeSubRip(b.toString('base64'),sha(b),n);
const clipped = (o,a,b) => clipSubRip(o,o.sourceSha256,a,b);
const refusals = c=>({code:c});
test('exact half-open range; changed, omitted and surviving source ordinals; text and track remain intact',async()=>{
  const bytes=file([[0,500,'gone'],[250,750,'يسار'],[500,1500,'A\nB'],[1250,1750,'right'],[1500,1700,'gone']].map(args=>block(...args)));
  const o=await observe(bytes); const r=clipped(o,'1/2','3/2');
  assert.deepEqual(r.cues.map(c=>[c.ordinal,c.startMs,c.endMs,c.text]),[[2,'0','250','يسار'],[3,'0','1000','A\nB'],[4,'750','1000','right']]);
  assert.deepEqual(r.omitted,[1,5]); assert.deepEqual(r.clipped,[{ordinal:2,start:true,end:false},{ordinal:4,start:false,end:true}]);
  assert.equal(r.track.uid,UID);assert.equal(r.track.number,'1');assert.equal(r.track.language,'ara');assert.equal(r.track.name,'Captions');assert.equal(r.track.forced,true);
  assert.ok(Object.isFrozen(r.cues[0]));assert.ok(Object.isFrozen(o.cues));assert.ok(Object.isFrozen(r.clipped[0]));assert.equal(o.sourceSha256,sha(bytes));
});
test('overlap, simultaneous start and both-edge clipping preserve original physical order',async()=>{
  const o=await observe(file([block(100,900,'one'),block(100,800,'two'),block(400,700,'three')]));
  assert.deepEqual(clipped(o,'1/5','1/2').clipped,[{ordinal:1,start:true,end:true},{ordinal:2,start:true,end:true},{ordinal:3,start:false,end:true}]);
  assert.deepEqual(clipped(o,'1/5','1/2').cues.map(c=>c.text),['one','two','three']);
});
test('native scale and cluster timestamp, nonzero origin, rational equivalent edges; no implicit source-zero assumption',async()=>{
  const o=await observe(file([block(-3,3,'test')],{scale:2000000,clock:500}));
  assert.deepEqual(clipped(o,'1990/2000','2004/2000').cues,[{ordinal:1,startMs:'0',endMs:'7',text:'test'}]);
  const hi=await observe(file([block(1,2,'big')],{clock:9007199254740993n}));
  assert.deepEqual(clipped(hi,'9007199254740994/1000','9007199254740995/1000').cues,[{ordinal:1,startMs:'0',endMs:'1',text:'big'}]);
});
test('no whole output millisecond: refuse rather than round; empty intersections explicit',async()=>{
  const o=await observe(file([block(0,1,'fine')],{scale:100000}));
  assert.throws(()=>clipped(o,'0/1','1/1'),refusals('SUBRIP_BOUNDARY_INEXACT'));
  assert.deepEqual(clipped(o,'2/1','3/1').omitted,[1]); assert.deepEqual(clipped(o,'2/1','3/1').cues,[]);
});
test('ordinary Unicode, number/comparison prose, multiline / CRLF and default Matroska language',async()=>{
  const txt='2 < 3 & 5 > 4\r\nCafé مرحباً 🎬';const o=await observe(file([block(1,2,txt)],{tracks:[track(1,{lang:null})],scale:null}));
  assert.equal(o.cues[0].text,txt);assert.equal(o.track.language,'eng');
});
test('selection ties exact native numbers and UIDs to the right text; other tracks explicitly not assessed',async()=>{
  const o=await observe(file([block(0,30,'one'),block(10,40,'deux',2),block(40,60,'three')],{tracks:[track(1),track(2,{uid:12,lang:'fra'})]}),'2');
  assert.equal(o.track.uid,'12');assert.equal(o.track.language,'fra');assert.deepEqual(o.cues.map(c=>c.text),['deux']);
});
test('reject stale or mutable bytes, noncanonical encoding, oversized input, copied observation and changing selection',async()=>{
  const b=file([block(1,5,'a')]), o=await observe(b);
  await assert.rejects(observeSubRip(b,sha(b),'1'),refusals('SUBRIP_SNAPSHOT_INVALID'));
  await assert.rejects(observeSubRip(b.toString('base64')+'\n',sha(b),'1'),refusals('SUBRIP_SNAPSHOT_INVALID'));
  await assert.rejects(observeSubRip(b.toString('base64'),'0'.repeat(64),'1'),refusals('SUBRIP_SOURCE_CHANGED'));
  await assert.rejects(observeSubRip('a'.repeat(Math.ceil(LIMITS.sourceBytes/3)*4+1),sha(b),'1'),refusals('SUBRIP_LIMIT'));
  assert.throws(()=>clipSubRip({...o},sha(b),'0/1','1/1'),refusals('SUBRIP_OBSERVATION_INVALID'));
  assert.throws(()=>clipSubRip(o,'0'.repeat(64),'0/1','1/1'),refusals('SUBRIP_SOURCE_CHANGED'));
  await assert.rejects(observe(b,'2'),refusals('SUBRIP_TRACK_INVALID'));
});
test('unsupported presentation is refused even on cues entirely outside the intended range',async()=>{
  for(const text of ['<i>x</i>','< b>x','{\\an8}x','{Y:i}x','x\\Ny','&#65;','&nbsp;','a\x00b','\ufeffx','a\n\nb','a\rb',Buffer.from([0xc3,0x28]),' '.repeat(8)]){
    await assert.rejects(observe(file([block(0,1,'plain'),block(100,200,text)])),refusals('SUBRIP_TEXT_UNSUPPORTED'));
  }
});
test('ASS/SSA, bitmap and non-subtitle tracks never become plain text; unsupported native track controls rejected',async()=>{
  for(const [codec,kind] of [['S_TEXT/ASS',17],['S_TEXT/SSA',17],['S_HDMV/PGS',17],['V_VP9',1]]){
    await assert.rejects(observe(file([block(0,1,'value')],{tracks:[track(1,{codec,kind})]})),refusals('SUBRIP_CODEC_UNSUPPORTED'));
  }
  for(const extra of [[el(0x63a2,Buffer.from('header'))],[u(0x56aa,100)],[u(0x55ee,1)],[u(0xb9,0)]]){
    await assert.rejects(observe(file([block(0,1,'value')],{tracks:[track(1,{extra})]})),refusals('SUBRIP_TRACK_CONTROL'));
  }
});
test('ambiguous native identities, clock, missing/zero duration, lacing and ordering refused',async()=>{
  for(const [b,code] of [
    [file([block(0,1,'x')],{tracks:[track(1),track(1,{uid:1})]}),'SUBRIP_TRACK_INVALID'],
    [file([block(0,1,'x')],{tracks:[track(1),track(2)]}),'SUBRIP_TRACK_INVALID'],
    [file([block(0,1,'x')],{doc:'webm'}),'SUBRIP_CONTAINER_UNSUPPORTED'],
    [file([block(0,1,'x')],{clock:null}),'SUBRIP_CLOCK_INVALID'],
    [file([block(0,1,'x')],{info:[u(0x2ad7b1,2)]}),'SUBRIP_CLOCK_INVALID'],
    [file([block(0,null,'x')]),'SUBRIP_PACKET_UNSUPPORTED'],[file([block(0,0,'x')]),'SUBRIP_PACKET_UNSUPPORTED'],
    [file([block(0,1,'x',1,{flags:2})]),'SUBRIP_PACKET_UNSUPPORTED'],
    [file([block(10,20,'x'),block(1,2,'y')]),'SUBRIP_ORDER_UNSUPPORTED'],
    [file([block(0,1,'x',2)]),'SUBRIP_TRACK_INVALID'],
  ])await assert.rejects(observe(b),refusals(code));
});
test('bounded source and target inputs; no coercing a rational object, float, enormous clock or cue',async()=>{
  const o=await observe(file([block(0,1,'one')]));
  for(const [a,b] of [[0.1,'1/1'],['0/1','0/1'],['3/1','1/1'],['1/0','1/1'],['0/1','1'.repeat(64)+'/1'],[{toString(){throw Error('read')}},'1/1']]){
    assert.throws(()=>clipped(o,a,b),refusals('SUBRIP_RANGE_INVALID'));
  }
  await assert.rejects(observe(file([block(1,5,'x'.repeat(LIMITS.cueBytes+1))])),refusals('SUBRIP_LIMIT'));
});
test('unclosed comparison signs are literal prose; actual markup is still refused',async()=>{
  assert.equal((await observe(file([block(0,1,'x<y; left < right')]))).cues[0].text,'x<y; left < right');
  for(const text of ['<FONT size=12>Title</FONT>','< b >v','{c:$0011}v'])await assert.rejects(observe(file([block(0,1,text)])),refusals('SUBRIP_TEXT_UNSUPPORTED'));
});
test('language precedence is explicit; malformed BCP47 cannot masquerade as a valid selection',async()=>{
  const good=await observe(file([block(0,1,'ok')],{tracks:[track(1,{extra:[s(0x22b59d,'ar-EG')]})]}));
  assert.equal(good.track.language,'ara');assert.equal(good.track.languageBCP47,'ar-EG');assert.equal(good.track.effectiveLanguage,'ar-EG');
  await assert.rejects(observe(file([block(0,1,'ok')],{tracks:[track(1,{extra:[s(0x22b59d,'en-a')]})]})),refusals('SUBRIP_TRACK_CONTROL'));
});
test('explicit per-track, cue-count and aggregate-text caps; no partial result',async()=>{
  const t=Array.from({length:33},(_,i)=>track(i+1,{uid:i+1}));await assert.rejects(observe(file([block(0,2,'one')],{tracks:t})),refusals('SUBRIP_LIMIT'));
  const cue=block(0,1,'x'),full=Array.from({length:LIMITS.cues},()=>cue);assert.equal((await observe(file(full))).cues.length,LIMITS.cues);
  await assert.rejects(observe(file([...full,cue])),refusals('SUBRIP_LIMIT'));
  const large=block(0,2,'x'.repeat(LIMITS.cueBytes)), max=Array(LIMITS.textBytes/LIMITS.cueBytes).fill(large);
  assert.equal((await observe(file(max))).cues.length,max.length);
  await assert.rejects(observe(file([...max,cue])),refusals('SUBRIP_LIMIT'));
});
test('no inferred duration from a following cue, no unbound BlockGroup, no foreign presentation timeline',async()=>{
  await assert.rejects(observe(file([block(0,null,'a'),block(2,4,'b')])),refusals('SUBRIP_PACKET_UNSUPPORTED'));
  await assert.rejects(observe(file([block(0,1,'x'),master(0xa0,[u(0x9b,2)])])),refusals('SUBRIP_PACKET_UNSUPPORTED'));
  await assert.rejects(observe(file([block(0,1,'x')],{extra:[master(0x1043a770,[])]})),refusals('SUBRIP_TIMELINE_UNSUPPORTED'));
});
test('independent discrete membership oracle across touching, disjoint, nested, overlapping and equal starts',async()=>{
  const range=[[-2,1],[-2,4],[1,3],[2,4],[3,5],[5,7]];
  const o=await observe(file(range.map(([a,b],i)=>block(a,b,String(i)))));
  for(let a=-3;a<8;a++)for(let b=a+1;b<=8;b++){
    const r=clipped(o,a+'/1000',b+'/1000');const active=[];
    range.forEach(([s,e],i)=>{const keep=[];for(let t=a;t<b;t++)if(t>=s&&t<e)keep.push(t-a);if(keep.length)active.push([i+1,keep[0],keep.at(-1)+1]);});
    assert.deepEqual(r.cues.map(c=>[c.ordinal,Number(c.startMs),Number(c.endMs)]),active);
  }
});
test('XML NameStart tags are formatted even for Unicode and colon; comparison prose stays plain',async()=>{
  for(const text of ['<色/>','<:label />','<𐐀/>','<色 属性="plain > still an attribute" />','<:label lang="ar">caption']){
    await assert.rejects(observe(file([block(0,1,text)])),refusals('SUBRIP_TEXT_UNSUPPORTED'));
  }
  for(const text of ['α < β and γ > δ','x<γ and δ > y','The city: القاهرة','2 < 3 & 5 > 4']){
    assert.equal((await observe(file([block(0,1,text)]))).cues[0].text,text);
  }
});
