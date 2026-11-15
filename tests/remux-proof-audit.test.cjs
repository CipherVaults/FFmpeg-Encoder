'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {audit,reports,EXPECTED_CASES}=require('../scripts/v07-remux-edit-proof-audit.cjs');
test('saved-proof audit refuses empty, missing and duplicate expected selections',async()=>{
  for(const shape of ['empty','missing','duplicate']){
    const result=await audit({read:async file=>{
      const relative=reports.find(p=>file.replaceAll('\\','/').endsWith(p+'/report.json'));
      const cases=EXPECTED_CASES[relative].map(c=>({...c,output:{file:'absent'},evidence:{status:'completed'}}));
      return JSON.stringify({cases:shape==='empty'?[]:shape==='missing'?cases.slice(1):[...cases,cases[0]]});
    },stat:async()=>{const e=Error('Absent expected output');e.code='ENOENT';throw e;}});
    assert.equal(result.status,'failed');assert.ok(result.failures.length);assert.equal(result.checked.length,0);
  }
});
test('a missing expected output cannot disappear from a passing audit',async()=>{
  const result=await audit({stat:async()=>{const e=Error('Absent expected output');e.code='ENOENT';throw e;}});
  assert.equal(result.status,'failed');assert.ok(result.unavailable.length>0);assert.ok(result.failures.some(s=>s.includes('Expected output files are absent')));
});
test('a missing expected report returns failed status',async()=>{
  const result=await audit({read:async()=>{const e=Error('Expected report absent');e.code='ENOENT';throw e;}});
  assert.equal(result.status,'failed');assert.ok(result.failures.some(s=>s.includes('Missing or unreadable expected report')));
});
test('empty selection returns failed status and a nonzero process exit',()=>{
  const run=spawnSync(process.execPath,['-e',"require('./scripts/v07-remux-edit-proof-audit.cjs').cli({read:async()=>JSON.stringify({cases:[]})})"],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).status,'failed');
});
test('a per-case integrity failure is reported with its case name and cannot pass or erase the selection',async()=>{
  const result=await audit({stat:async()=>({size:0n}),hashFile:async()=>''});
  assert.equal(result.status,'failed');assert.equal(result.checked.length,0);
  assert.ok(result.failures.some(s=>s.includes('Saved output changed:')));assert.ok(result.failures.some(s=>s.includes(reports[0]+':')));
});
