'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const { clipMatroskaProbeChapters }=require('../src/operation-chapter-probe.cjs');
const interval={absoluteStart:{numerator:'1',denominator:'1'},absoluteEnd:{numerator:'3',denominator:'1'}};
const clip=s=>clipMatroskaProbeChapters(s,interval,'1/1000');
const raw=(id,other='9007199254740993')=>'{"format":{"format_name":"matroska,webm"},"chapters":[{"id":'+id+',"time_base":"1/1000","start":0,"end":1800,"tags":{"title":"start"}},{"id":'+other+',"time_base":"1/1000","start":1800,"end":4000}]}';
test('adjacent legitimate ChapterUID digits do not merge; both edges and attribution survive',()=>{
  const r=clip(raw('9007199254740992'));
  assert.deepEqual(r.chapters.map(c=>[c.id,c.start,c.end]),[['9007199254740992','0','800'],['9007199254740993','800','2000']]);
  assert.deepEqual(r.clipped,[{sourceIndex:0,start:true,end:false},{sourceIndex:1,start:false,end:true}]);
  assert.equal(r.chapters[0].tags.title,'start');
});
test('exact signed-64 positive limit and genuine duplicates remain distinguishable',()=>{
  assert.equal(clip(raw('9223372036854775807')).chapters[0].id,'9223372036854775807');
  assert.throws(()=>clip(raw('9007199254740993')),e=>e.code==='CHAPTER_ID_DUPLICATE');
});
test('do not normalize ambiguous ids, fractional/exponent digits, wrong family or missing raw evidence',()=>{
  for(const x of ['1e3','1.0','9223372036854775808','-1','0','"9"','null','{}'])assert.throws(()=>clip(raw(x)),e=>e.code==='CHAPTER_PROBE_INTEGER');
  assert.throws(()=>clip(raw('2').replace('matroska,webm','mov,mp4,m4a,3gp,3g2,mj2')),e=>e.code==='CHAPTER_PROBE_FAMILY');
  assert.throws(()=>clip(JSON.parse(raw('2'))),e=>e.code==='CHAPTER_PROBE_LIMIT');
  assert.throws(()=>clip(raw('2').replace('"id":2','"id":2,"id":3')),e=>e.code==='INVALID_PROBE');
});
test('exact large chapter ticks survive without touching similarly named dictionary metadata',()=>{
  const j='{"chapters":[{"id":2,"start":9007199254740992,"end":9007199254740993,"time_base":"1/1000","tags":{"id":"0007","title":"id: 123"}}],"format":{"format_name":"matroska,webm"}}';
  const r=clipMatroskaProbeChapters(j,{absoluteStart:{numerator:'9007199254740992',denominator:'1000'},absoluteEnd:{numerator:'9007199254740993',denominator:'1000'}},'1/1000');
  assert.deepEqual(r.chapters[0],{sourceIndex:0,id:'2',start:'0',end:'1',tags:{id:'0007',title:'id: 123'}});
});
