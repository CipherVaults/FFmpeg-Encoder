'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {partition}=require('../scripts/v07-remux-admission-batch.cjs');
test('focused admission refuses empty, oversized, duplicate and relative selections before loading implementations',()=>{
  const {selected}=require('../scripts/v07-remux-admission-batch.cjs'),one=require('node:path').resolve('source.mp4');assert.deepEqual(selected([one]),[one]);
  for(const values of [[],Array(31).fill(one),[one,one],['relative.mp4'],null])assert.throws(()=>selected(values),/1\.\.30 distinct absolute/);
});
test('read-only census shards are disjoint, complete, balanced and preserve each source exactly once',()=>{
  const files=Array.from({length:1703},(_,i)=>i);assert.equal(partition(files),files);
  for(let count=1;count<=4;count++){
    const batches=Array.from({length:count},(_,i)=>partition(files,i+'/'+count)),all=batches.flat();
    assert.equal(new Set(all).size,files.length);assert.deepEqual(all.sort((a,b)=>a-b),files);
    assert.ok(Math.max(...batches.map(b=>b.length))-Math.min(...batches.map(b=>b.length))<=1);
  }
});
test('invalid census shard selection fails closed before scheduling any source',()=>{
  for(const value of ['',null,'4/4','1/1','0/0','0/5','-1/4','0/4/extra','../outside'])assert.throws(()=>partition([1],value),/Admission shard/);
});
