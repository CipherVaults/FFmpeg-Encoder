'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {plan}=require('../scripts/v07-remux-test-evidence.cjs');
test('bounded evidence plan selects every suite file and records concurrency without modifying toolkit or test limits',()=>{
  const full=plan('unit-full','full'),remux=plan('unit-remux','remux'),all=fs.readdirSync(__dirname).filter(n=>n.endsWith('.test.cjs')).sort().map(n=>'tests/'+n);
  assert.deepEqual(full.tests,all);assert.deepEqual(remux.tests,all.filter(n=>path.basename(n).startsWith('remux-')));assert.deepEqual(full.args,['--test','--test-concurrency=4',...all]);assert.ok(full.covers.includes('src/remux-native-checks.cjs'));
  assert.ok(full.covers.includes('scripts/v07-remux-native-inventory.md'));
});
test('invalid evidence label or suite fails before any output or test process can be created',()=>{
  for(const label of ['../outside','bad/name','',null])assert.throws(()=>plan(label,'full'),/Invalid evidence label/);
  assert.throws(()=>plan('valid','empty'),/suite must be/);assert.doesNotThrow(()=>plan('valid','remux'));
});
