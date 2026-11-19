'use strict';
// Main-only preparation adapter. Not imported by the active product composition.
// Caller must supply independently retained, current-runtime evidence; this
// validates applicability, not the truth of a report or permission to execute.
const assert=require('node:assert/strict');
const {OperationFamilySelector}=require('../src/operation-family.cjs');
const {EVIDENCE_BUDGET,EXECUTION_BUDGET_MS}=require('../src/operation-controls.cjs');
const RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const SETTINGS=Object.freeze({profileId:'h265-cpu',preset:'slow',quality:25});
function inert(value,depth=0){
  assert(depth<=12);if(value===null||typeof value!=='object'){assert(['string','number','boolean'].includes(typeof value)||value===null);return;}
  assert(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
  for(const key of Reflect.ownKeys(value)){assert(typeof key==='string');const d=Object.getOwnPropertyDescriptor(value,key);assert(Object.hasOwn(d,'value'));inert(d.value,depth+1);}
}
function createAacRangeBinding(family){
  inert(family);
  assert(family&&Object.getPrototypeOf(family)===Object.prototype);
  assert.equal(family.id,'short-sdr-range-v1');assert.equal(family.runtimeIdentity,RUNTIME);
  assert.deepEqual(family.settings,SETTINGS);assert.equal(family.environment,null);
  assert.deepEqual(family.budget,EVIDENCE_BUDGET);assert.equal(family.executionBudgetMs,EXECUTION_BUDGET_MS);
  assert.equal(family.qualification.containerDuration,'matroska-packet-end-plus-codec-delay');
  assert.deepEqual(family.timingQualification.aac,{alignment:'decoded-after-signalled-skip',encoderDelaySamples:1024,discardPaddingSamples:0});
  const selector=new OperationFamilySelector({policyIdentity:'linux-aac-range-preparation-v1',families:[structuredClone(family)]});
  return Object.freeze({
    operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,
    orientationQualification:facts=>selector.orientationQualification(facts),
    select(facts){
      // Do not repair the caller's null budget or silently raise its deadline.
      assert.deepEqual(facts.budget,EVIDENCE_BUDGET);assert.equal(facts.executionBudgetMs,EXECUTION_BUDGET_MS);
      assert.equal(facts.runtimeIdentity,RUNTIME);assert.deepEqual(facts.settings,SETTINGS);assert.equal(facts.environment,null);
      assert.equal(facts.plan?.compatibilityPath,false,'AAC binding never admits ordinary fallback');
      return selector.select(facts);
    },
    requireCurrent:(token,facts)=>selector.requireCurrent(token,facts),
    verifyCollectedSource:(token,evidence)=>selector.verifyCollectedSource(token,evidence),
    invalidate:reason=>selector.invalidate(reason)
  });
}
module.exports={createAacRangeBinding};
