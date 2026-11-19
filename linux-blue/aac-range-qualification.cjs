'use strict';
// Main-owned fixed evidence. Enclosing product source closure pins this loader/data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const EXPECTED_SHA='aa127a854c3faff7d928905da4ad605630154a5f8e96a845873f79ade7f27517', EXPECTED_BYTES=24514;
const RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const AUDITS=['3836647e82ff45969950149a01e7f62bcfa658dafe8beb1560b0bd4196e20127','0a6aedaf064f61d4c84e5379aa733637b273b8ff9a861d93261eda66354c8676'];
const digest=b=>createHash('sha256').update(b).digest('hex');
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
function identity(s){return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode];}
function loadAacRangeQualification(){
 assert.equal(arguments.length,0,'Caller data is not AAC evidence authority');
 const file=path.join(__dirname,'aac-range-qualification.json');
 assert.equal(fs.realpathSync(file),file,'AAC evidence must be canonical');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;
 try{
  const before=fs.fstatSync(fd,{bigint:true});assert(before.isFile());assert.equal(before.size,BigInt(EXPECTED_BYTES));
  bytes=Buffer.alloc(EXPECTED_BYTES);let offset=0;
  while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);assert(count>0,'Truncated AAC evidence');offset+=count;}
  assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),identity(before));assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),identity(before));
 }finally{fs.closeSync(fd);}
 assert.equal(digest(bytes),EXPECTED_SHA,'AAC evidence changed');
 const record=JSON.parse(bytes),{family,applicability}=record;
 assert.equal(record.schema,'linux-internal-aac-range-evidence/v1');
 assert.equal(family.id,'short-sdr-range-v1');
 for(const id of [family.runtimeIdentity,family.qualification.runtimeIdentity,family.timingQualification.runtimeIdentity])assert.equal(id,RUNTIME);
 assert.equal(family.environment,null);assert.deepEqual(family.settings,{profileId:'h265-cpu',preset:'slow',quality:25});assert.equal(family.executionBudgetMs,600000);assert.equal(applicability.fps,'30/1');
 const audits=record.evidence.map((row,i)=>{const b=Buffer.from(row.auditJson);assert.equal(b.length,row.bytes);assert.equal(row.sha256,AUDITS[i]);assert.equal(digest(b),row.sha256);return JSON.parse(row.auditJson);});
 assert.equal(audits.length,2);assert.equal(audits[0].status,'accepted-saved-evidence-A-passed-B-pre-encode-procedure-blocked');assert.equal(audits[0].A.status,'passed-one-bounded-cell');assert.equal(audits[0].outerExitCode,1);assert.equal(audits[1].status,'accepted-experimental-B-only-not-activation');assert.equal(audits[1].exitCode,0);
 assert.deepEqual(family.qualification.tolerances,audits[0].A.frozenEndpointBounds);
 // Composition must enforce applicability in select AND requireCurrent.
 // Provenance hashes never substitute for property-based source admission.
 return freeze({family,applicability});
}
module.exports={loadAacRangeQualification};
