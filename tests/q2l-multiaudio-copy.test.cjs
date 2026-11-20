'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const { compareTracks, auditPaths, checkAacTiming, movieTicks }=require('../linux-blue/qualification-tests/q2l-multiaudio-copy.cjs');
const sha=n=>String(n).repeat(64);
const track=(i)=>({index:i,trackId:i+1,kind:i?'audio':'video',rate:i?48000:null,channels:i?2:null,layout:i?'stereo':null,
 language:i===0?'und':i===1?'eng':'ara',isDefault:i!==1,packets:i?88:56,units:i?88176:56,
 packetSha256:sha(i+1),decodedSha256:sha(i+3),decodeBytes:i?705408:1548288,configSha256:sha(i?6:7),
 nativeEditSha256:sha(i+5),streamInfoSha256:sha(i+3),rawChannelHeader:i?2:null});
const tracks=()=>[0,1,2].map(track);
test('finite helper compares each ordered track, including distinct same-shape audio',()=>{
  assert.equal(compareTracks(tracks(),tracks()),true);
});
for(const [k,update] of [
  ['missing',a=>a.pop()],['swapped names',a=>[a[1],a[2]]=[a[2],a[1]]],
  ['same total but exchanged track content',a=>[a[1].decodedSha256,a[2].decodedSha256]=[a[2].decodedSha256,a[1].decodedSha256]],
  ['packet stream',a=>a[2].packetSha256=sha(9)],['one audio sample',a=>a[2].units--],
  ['decoder config',a=>a[1].configSha256=sha(0)],['native edits',a=>a[2].nativeEditSha256=sha(0)],
  ['language',a=>a[2].language='deu'],['default',a=>{a[1].isDefault=true;a[2].isDefault=false;}],
  ['native sample-entry header',a=>a[2].rawChannelHeader=1],['unreported metadata',a=>a[0].streamInfoSha256=sha(0)],
]) test('refuses '+k,()=>{const a=tracks();update(a);assert.throws(()=>compareTracks(tracks(),a),{code:'Q2L_MULTI_AUDIO'});});
test('an equal but incomplete or ambiguous pair does not pass',()=>{
  for(const f of [v=>v.pop(),v=>v[1].index=2,v=>v[2].trackId=2,v=>v[1].isDefault=true,v=>v[2].isDefault=false,v=>v[1].units=0,
    v=>v[1].decodedSha256='incomplete',v=>v[1].decodeBytes++,v=>delete v[1].configSha256,v=>v[1].grant=true]){
    const v=tracks();f(v);assert.throws(()=>compareTracks(v,structuredClone(v)),{code:'Q2L_MULTI_AUDIO'});
  }
});
test('ambiguous physical AAC channel count and a non-inert skip report are refused',()=>{
  const v=tracks();v[1].rawChannelHeader=1;assert.throws(()=>compareTracks(v,structuredClone(v)),{code:'Q2L_MULTI_AUDIO'});
  let invoked=false;const side=new Proxy([],{ownKeys(){invoked=true;return [];}});
  assert.throws(()=>checkAacTiming(1,4,0,0,1024,2304,side),{code:'Q2L_MULTI_AUDIO'});assert.equal(invoked,false);
});
test('physical movie clocks can differ exactly; not a one-tick timing allowance',()=>{
  assert.equal(movieTicks('10348800','7056000'),movieTicks('51744000','35280000'));
  assert.notEqual(movieTicks('10348800','7056000'),movieTicks('51744001','35280000'));
  assert.equal(movieTicks('0','48000'),'0/1');for(const t of ['-1','3.1','2e3','1234567890123456789'])assert.throws(()=>movieTicks(t,'48000'));
});
test('AAC priming, interior packets and a real shortened terminal packet are three distinct observations',()=>{
  const side=(lead,tail)=>[{side_data_type:'Skip Samples',skip_samples:lead,discard_padding:tail,skip_reason:0,discard_reason:0}];
  checkAacTiming(0,4,-1024,-1024,1024,2304,side(1024,0));
  checkAacTiming(1,4,0,0,1024,2304,[]);
  checkAacTiming(3,4,2048,2048,256,2304,side(0,768));
  checkAacTiming(3,4,2048,2048,1024,3072,[]);
  for(const wrong of [[],side(768,0),side(0,767),side(0,769),side(0,0)])assert.throws(()=>checkAacTiming(3,4,2048,2048,256,2304,wrong),{code:'Q2L_MULTI_AUDIO'});
  assert.throws(()=>checkAacTiming(1,4,1,1,1024,2304,[]),{code:'Q2L_MULTI_AUDIO'});
  assert.throws(()=>checkAacTiming(1,4,0,0,1024,2304,side(0,768)),{code:'Q2L_MULTI_AUDIO'});
});
test('the native audit does not accept a runtime/receipt substitute or relative inputs',async()=>{
  for(const args of [[{},'/a','/b'],['/r','a','/b'],['/r','/a','/a']])await assert.rejects(auditPaths(...args),{code:'Q2L_MULTI_AUDIO'});
});
