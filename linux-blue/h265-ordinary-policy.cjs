'use strict';
// Internal Full/source H265 admission. Shared settings remain authoritative.
const assert=require('node:assert/strict');
const {validateSettings}=require('../src/media.cjs');
const {admitInput}=require('./ordinary-cpu-policy.cjs');
function settings(value){const valid=validateSettings(value);assert.equal(valid.profileId,'h265-cpu');assert(!Object.hasOwn(valid,'recipeId'));return valid;}
function admit(facts){settings(facts.settings);const result=admitInput(facts);
 // Preparation retains the existing measured Matroska clock wrapper.
 if(facts.probe.format.format_name==='matroska,webm')assert(facts.probe.streams.every(s=>s.time_base==='1/1000'),'H265 preparation requires Matroska 1/1000 stream clocks');
 return Object.freeze({...result,route:'h265-cpu-full-source-v1'});}
function requireEntry(service,item){const e=service.plan?.entries.get(item.id);assert(e&&e.operationPlan?.compatibilityPath===true&&!e.qualificationSelection&&!e.operationRuntimeToken&&!['vendor','remux','hdr','encodePreservation','native'].some(k=>e[k])&&service.plan.operation==='encode');return admit({probe:e.inspection.probe,settings:service.plan.settings,request:item.operationRequest,bytes:Number(e.fingerprint.size)});}
module.exports={settings,admit,requireEntry};
