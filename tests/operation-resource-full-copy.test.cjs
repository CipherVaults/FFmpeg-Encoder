'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deriveCfrFullResizeCopyResources:derive,deriveCfrFullResizeFlacResources}=require('../src/operation-resource-budget.cjs');
test('Full-copy resource forecast charges nine complete-source collector passes, no PCM',()=>{
 for(const seconds of [1,8,150,1800]) {
 const r=derive({sourceExtentUs:seconds*1000000,sourceBytes:'100000000'});const records=20000+seconds*256,frame=records*1024;
 assert.equal(r.resources.evidenceBytes,9*frame);assert.equal(r.resources.pipeBytes,9*frame+16*1024**2);assert.equal(r.budget.maxRecords,records);assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.resources)&&Object.isFrozen(r.budget));
 assert.notEqual(r.resources.evidenceBytes,deriveCfrFullResizeFlacResources({sourceExtentUs:seconds*1000000,sourceBytes:'100000000'}).resources.evidenceBytes);
 }
});
test('Full-copy rounds source extent upward and accounts source bytes without short ceilings',()=>{
 const a=derive({sourceExtentUs:150000000,sourceBytes:'1'}),b=derive({sourceExtentUs:150000001,sourceBytes:'100000000'});assert.ok(b.executionBudgetMs>a.executionBudgetMs);assert.ok(b.budget.maxRecords>a.budget.maxRecords);
 for(const opts of [{sourceExtentUs:0,sourceBytes:'1'},{sourceExtentUs:1.5,sourceBytes:'1'},{sourceExtentUs:1,sourceBytes:'0'},{sourceExtentUs:1,sourceBytes:'9007199254740992'},{sourceExtentUs:Number.MAX_SAFE_INTEGER,sourceBytes:'1'}])assert.throws(()=>derive(opts),{code:'OPERATION_RESOURCE_CAPACITY'});
});

test("one-hour conservative reservation refuses structurally, without truncation",()=>assert.throws(()=>derive({sourceExtentUs:3600000000,sourceBytes:"100000000"}),{code:"OPERATION_RESOURCE_CAPACITY"}));
