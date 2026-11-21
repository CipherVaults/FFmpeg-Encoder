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

// Execute the unchanged batch module against an inert discovery/tool adapter.
// No real sources, implementation trees or FFmpeg processes are opened here.
async function harness(files) {
  const fs = require('node:fs/promises'), path = require('node:path'), Module = require('node:module');
  const filename = require.resolve('../scripts/v07-remux-admission-batch.cjs'), code = await fs.readFile(filename, 'utf8');
  const calls = { sources: 0, stat: 0, tools: 0, writes: [] };
  const binding = { digest: 'inert-binding' }, implementation = { digest: binding.digest, api: {},
    matches: async () => false, refresh: async () => binding };
  const fakeFs = { readFile: async () => '', appendFile: async (file, text) => { calls.writes.push(text); },
    stat: async () => { calls.stat++; return Object.fromEntries(['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,1n])); } };
  const dependencies = {
    'node:fs/promises': fakeFs,
    './v07-remux-admission-audit.cjs': { sources: async () => { calls.sources++; return files; }, admission: async () => ({ status: 'accepted' }) },
    '../src/process-runner.cjs': { runTool: async () => { calls.tools++; return { stdout: '{}' }; } },
    '../src/candidate-runtime.cjs': { resolveCandidateRuntime: () => ({ ffprobe: 'inert-ffprobe' }) },
    './v07-remux-admission-io.cjs': { metadataIo: async (file, fn) => fn() },
    './v07-remux-implementation.cjs': { implementation: async () => implementation },
  };
  const unit = new Module(filename, module); unit.filename = filename; unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = unit.require.bind(unit); unit.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : originalRequire(name);
  unit._compile(code, filename); return { api: unit.exports, calls };
}
test('empty full discovery refuses before a success result, source stat, probe or admission row is written', async () => {
  for (const shard of [undefined, '0/2', '1/2']) {
    const { api, calls } = await harness([]);
    await assert.rejects(api.batch('inert-log', 'inert-before', 'inert-after', shard), /Full admission discovery found no source files/);
    assert.equal(calls.sources, 1); assert.equal(calls.stat, 0); assert.equal(calls.tools, 0); assert.deepEqual(calls.writes, []);
  }
});
test('a discovered source produces a complete valid result and a legitimate empty partition still succeeds', async () => {
  const file = require('node:path').resolve('inert-source.mkv');
  const full = await harness([file]), result = await full.api.batch('inert-log', 'inert-before', 'inert-after');
  assert.equal(result.files, 1); assert.deepEqual(result.changes, []); assert.deepEqual(result.inconclusive, []);
  assert.equal(full.calls.tools, 1); assert.equal(full.calls.writes.filter(s=>s.startsWith('ADMISSION_BATCH_ROW ')).length, 1);
  assert.equal(full.calls.writes.filter(s=>s.startsWith('ADMISSION_BATCH_RESULT ')).length, 1);
  const empty = await harness([file]), shard = await empty.api.batch('inert-log', 'inert-before', 'inert-after', '1/2');
  assert.equal(shard.files, 0); assert.equal(shard.shard, '1/2'); assert.deepEqual(shard.inconclusive, []);
  assert.equal(empty.calls.tools, 0); assert.equal(empty.calls.writes.length, 1);
  assert.ok(empty.calls.writes[0].startsWith('ADMISSION_BATCH_RESULT '));
  assert.deepEqual(partition([], '1/2'), []);
});
