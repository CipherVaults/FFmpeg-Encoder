'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { createQualifiedEncodeControls, assertServiceProof, SERVICE_PROOFS } = require('./workbench-qualified-encode-controls.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(kind) {
  const module = require(kind === 'keep720' ? './workbench-long-range-service.cjs' : kind === 'fullResize1080to720' ? './workbench-full-resize-service.cjs' : './workbench-resize-service.cjs');
  const calibration = JSON.parse(await fs.readFile(module.REPORT));
  return { bytes: await fs.readFile(SERVICE_PROOFS[kind].report), evidenceIds: calibration.sources.flatMap(s => [s.frozen.qualification.evidenceId,s.frozen.timingQualification.evidenceId]) };
}
test('pending Full proof refuses before any receipt read, runtime verification or storage construction', async () => {
  const file=path.join(__dirname,'workbench-qualified-encode-controls.cjs'),source=await fs.readFile(file,'utf8');
  const module={exports:{}},real=createRequire(file);
  const wrapper=vm.runInThisContext(`(function(require,module,exports,__dirname){${source}\n})`,{filename:file});
  wrapper(name=>name==='./workbench-full-resize-service.cjs'?{REPORT_SHA:null}:real(name),module,module.exports,__dirname);
  const pending=module.exports.createQualifiedEncodeControls;
  const original = fs.readFile; let reads=0;
  fs.readFile = async () => { reads++; assert.fail('No read before pending gate'); };
  try { await assert.rejects(pending({stateDir:'/never-created',onChild(){assert.fail('child');}}),/pending/); }
  finally { fs.readFile=original; }
  assert.equal(reads,0);
});
test('exact successful Keep Source, resize and Full service proofs match their own calibrations', async () => {
  assert.equal(SERVICE_PROOFS.keep720.sha256,'6d0d49b83ec5bf01a5c5aca977f412e83a8205dd6ad1e43ee558e5a5701e8039');
  for (const kind of ['keep720','resize1080to720','fullResize1080to720']) {
    const {bytes,evidenceIds}=await fixture(kind);
    assert.equal(sha(bytes),SERVICE_PROOFS[kind].sha256);
    assert.equal(assertServiceProof(bytes,kind,SERVICE_PROOFS[kind].sha256,evidenceIds).cases.length,8);
    assert.throws(()=>assertServiceProof(bytes,kind,'0'.repeat(64),evidenceIds),/Exact accepted/);
    assert.throws(()=>assertServiceProof(bytes,kind,SERVICE_PROOFS[kind].sha256,evidenceIds.map(x=>x+'other')),/correlated/);
  }
});
test('forged successful labels cannot replace lifecycle, source, accounting or geometry evidence', async () => {
  const {bytes,evidenceIds}=await fixture('resize1080to720'),original=JSON.parse(bytes);
  for (const mutate of [r=>{r.status='passed-developer-full-resize-service-proof';},r=>{r.appActivated=true;},r=>{r.census.live=1;},
    r=>{r.cases.pop();},r=>{r.cases[0].item.sourceAssessment.kind='changed';},r=>{r.cases[0].pcmIdentity.outputHash='0'.repeat(64);},
    r=>{r.cases[0].accounting.evidenceIds=[];},r=>{r.cases[0].accounting.children=1000;},r=>{r.cases[0].accounting.streamedBytes=Number.MAX_SAFE_INTEGER;},
    r=>{r.cases[0].item.evidenceStorage.final.violations=['over-cap'];},r=>{r.cases[0].geometry.output.width=1920;},
    r=>{r.cases[3].observed.childLive=false;},r=>{r.cases[5].item.outputDisposition.validationCurrent=true;},r=>{r.cases[7].item.status='success';}]) {
    const r=structuredClone(original);mutate(r);const b=Buffer.from(JSON.stringify(r));
    assert.throws(()=>assertServiceProof(b,'resize1080to720',sha(b),evidenceIds),{code:'LINUX_QUALIFIED_CONTROLS'});
  }
  assert.throws(()=>assertServiceProof(bytes,'fullResize1080to720',sha(bytes),evidenceIds),/settled/);
  assert.throws(()=>assertServiceProof(bytes,'unrecognized',sha(bytes),evidenceIds),/unknown/);
});
test('builder remains main-only and returns no ordinary runner or fallback authority', async () => {
  const source=await fs.readFile(path.join(__dirname,'workbench-qualified-encode-controls.cjs'),'utf8');
  assert.doesNotMatch(source,/process\.argv|process\.env|ipcMain|createAv1Runner/);
  assert.match(source,/run: keep\.clockGuardedRunner\(createAv1ProportionalRunner/);
  const main=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
  assert.ok(!main.includes('workbench-qualified-encode-controls')); assert.ok(main.includes('createQualifiedAv1WorkbenchService'));
  assert.match(main,/runtimeChoice === 'baseline' \? createWorkbenchService/);
  const factory=await fs.readFile(path.join(__dirname,'workbench-av1-service.cjs'),'utf8');
  assert.match(factory,/async function createQualifiedAv1WorkbenchService/);
  assert.match(factory,/require\('\.\/workbench-qualified-encode-controls\.cjs'\)/);
});

test('accepted exact proofs construct real qualified factory without capabilities or child execution', async () => {
  const { createQualifiedAv1WorkbenchService } = require('./workbench-av1-service.cjs');
  const { Av1WorkbenchAdmissionService } = require('./workbench-av1-admission.cjs');
  const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
  const { ClockQualifiedFamilySelector } = require('./workbench-long-range-service.cjs');
  const stateDir=path.join(__dirname,'artifacts','qualified-construction-no-media'),outputAccess={test:'main-owned-output-access'};
  const service=await createQualifiedAv1WorkbenchService({stateDir,outputAccess,onChild(){assert.fail('No children during construction');}});
  try {
    assert.ok(service instanceof Av1WorkbenchAdmissionService);
    assert.ok(service.operationRuntime instanceof OperationRuntimeObserver);
    assert.ok(service.operationQualifications instanceof ClockQualifiedFamilySelector);
    assert.equal(service.stateDir,stateDir); assert.equal(service.outputAccess,outputAccess);
    assert.equal(service.linuxQualifiedEncodeStatus.available,true);assert.equal(service.linuxQualifiedEncodeStatus.familyIds.length,3);
    assert.equal(service.linuxRemuxStatus.available,false);assert.equal(service.remuxOperations,null);
    assert.equal(service.operationEvidenceBudget,null);assert.equal(service.operationDeadlineMs,120000);
    assert.equal(typeof service.run,'function');
  } finally { service.closeAdmission(); await service.closeOperationResources(); }
});
