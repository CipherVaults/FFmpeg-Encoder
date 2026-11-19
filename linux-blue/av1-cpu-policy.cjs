'use strict';
// Separate internal AV1 admission; no historical H264 or measured authority.
const assert=require('node:assert/strict');
const {POLICY,admitInput}=require('./ordinary-cpu-policy.cjs');
const SETTINGS=Object.freeze({profileId:'av1-cpu',preset:'6',quality:32});
function admit(facts){assert.deepEqual(facts.settings,SETTINGS);return Object.freeze({...admitInput(facts),route:'av1-cpu-full-source-v1'});}
function admitBatch(entries){assert(Array.isArray(entries)&&entries.length>=1&&entries.length<=POLICY.maxBatchInputs);const rows=entries.map(admit);const bytes=rows.reduce((n,r)=>n+r.bytes,0),duration=rows.reduce((n,r)=>n+r.duration,0);assert(Number.isSafeInteger(bytes)&&bytes<=POLICY.maxBatchBytes&&Number.isFinite(duration)&&duration<=POLICY.maxBatchDurationSeconds);return Object.freeze({bytes,duration,count:rows.length});}
function requireEntry(service,item){const entry=service.plan?.entries.get(item.id);assert(entry&&entry.operationPlan?.compatibilityPath===true&&!entry.vendor&&!entry.remux&&!entry.hdr&&!entry.encodePreservation&&!entry.native&&service.plan.operation==='encode');return admit({probe:entry.inspection.probe,settings:service.plan.settings,request:item.operationRequest,bytes:Number(entry.fingerprint.size)});}
module.exports={SETTINGS,admit,admitBatch,requireEntry};
