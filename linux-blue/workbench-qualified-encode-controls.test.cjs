'use strict';
const specimens = require('./test-fixtures/proportional-reports.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { createQualifiedEncodeControls, assertServiceProof, SERVICE_PROOFS } = require('./workbench-qualified-encode-controls.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(kind) {const c=specimens.calibration(kind);return {bytes:specimens.bytes(specimens.serviceProof(kind)),evidenceIds:c.sources.flatMap(s=>[s.frozen.qualification.evidenceId,s.frozen.timingQualification.evidenceId])};}
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
test('portable Keep Source, resize and Full service schemas bind their own synthetic calibrations', async () => {
  assert.equal(SERVICE_PROOFS.keep720.sha256,'6d0d49b83ec5bf01a5c5aca977f412e83a8205dd6ad1e43ee558e5a5701e8039');
  for (const kind of ['keep720','resize1080to720','fullResize1080to720','fullResize1440to720']) {
    const {bytes,evidenceIds}=await fixture(kind);
    assert.notEqual(sha(bytes),SERVICE_PROOFS[kind].sha256);assert.throws(()=>assertServiceProof(bytes,kind,SERVICE_PROOFS[kind].sha256,evidenceIds),/Exact accepted/);
    assert.equal(assertServiceProof(bytes,kind,sha(bytes),evidenceIds).cases.length,8);
    assert.throws(()=>assertServiceProof(bytes,kind,'0'.repeat(64),evidenceIds),/Exact accepted/);
    assert.throws(()=>assertServiceProof(bytes,kind,sha(bytes),evidenceIds.map(x=>x+'other')),/correlated/);
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
  assert.ok(!main.includes('workbench-qualified-encode-controls')); assert.ok(main.includes('create1440QualifiedAv1WorkbenchService'));
  assert.match(main,/runtimeChoice === 'baseline' \? createWorkbenchService/);
  const factory=await fs.readFile(path.join(__dirname,'workbench-av1-service.cjs'),'utf8');
  assert.match(factory,/async function createQualifiedAv1WorkbenchService/);
  assert.match(factory,/require\('\.\/workbench-qualified-encode-controls\.cjs'\)/);
});

test('real three-family builder validates synthetic receipts then refuses unsupported Full-FLAC without issuing controls',async()=>{
  const h=await specimens.controlsFixture();
  await assert.rejects(h.api.createQualifiedEncodeControls({stateDir:'/not-created',onChild(){assert.fail('child');}}),{code:'INVALID_OPERATION_QUALIFICATION'});
  assert.deepEqual(h.counts.validated,['keep720','resize1080to720','fullResize1080to720']);
  assert.deepEqual(h.counts.tools,['ffmpeg','ffprobe']);assert.equal(h.counts.runner,0);assert.equal(h.counts.fourthLoads,0);
  const bad=await specimens.controlsFixture({mutateProof(r,kind){if(kind==='resize1080to720')r.cases[0].accounting.evidenceIds=[];}});
  await assert.rejects(bad.api.createQualifiedEncodeControls({stateDir:'/not-created'}),{code:'LINUX_QUALIFIED_CONTROLS'});
  assert.deepEqual(bad.counts.tools,[]);assert.equal(bad.counts.runner,0);
});

test('inactive fourth builder pending fixture refuses before all reads even after future pins',async()=>{
  const file=path.join(__dirname,'workbench-qualified-encode-controls.cjs'),source=await fs.readFile(file,'utf8');
  const module={exports:{}},real=createRequire(file);
  vm.runInThisContext(`(function(require,module,exports,__dirname){${source}\n})`,{filename:file})(
    name=>name==='./workbench-full-1440-service.cjs'?{REPORT_SHA:null}:real(name),module,module.exports,__dirname);
  const original=fs.readFile;let reads=0;fs.readFile=async()=>{reads++;assert.fail('No read');};
  try {await assert.rejects(module.exports.create1440QualifiedEncodeControls({stateDir:'/never-created'}),/1440.*pending/);}
  finally {fs.readFile=original;}assert.equal(reads,0);
});
test('1440 service validator has distinct status, geometry, lifecycle and complete tail counts',async()=>{
  const {bytes,evidenceIds}=await fixture('fullResize1080to720');
  assert.throws(()=>assertServiceProof(bytes,'fullResize1440to720',sha(bytes),evidenceIds),/settled/);
  // Pure synthetic schema fixture only; fixed builder cannot use this digest.
  const r=JSON.parse(bytes);r.status='passed-developer-full-1440-service-proof';r.geometry.sourceWidth=2560;r.geometry.sourceHeight=1440;
  ['full-1440','full-1440-calibrated-audio-tail','fresh-independent-full-1440-audio-tail'].forEach((name,i)=>r.cases[i].case=name);
  for(const i of [0,1,2,4,6]) {const row=r.cases[i];row.frames=i===0?360:i===1?213:120;row.samples=i===0?576000:i===1?346416:197616;
    row.pcmIdentity.sourceBytes=row.samples*4;row.pcmIdentity.outputBytes=row.samples*4;}
  const check=v=>{const b=Buffer.from(JSON.stringify(v));return assertServiceProof(b,'fullResize1440to720',sha(b),evidenceIds);};
  assert.deepEqual(check(r),r);
  for(const mutate of [v=>v.geometry.sourceWidth=1920,v=>v.cases[0].case='full-long',v=>v.cases[2].frames=300,
    v=>v.cases[1].samples=340800,v=>v.cases[4].item.operationRequest.range={startUs:0},v=>v.cases[5].item.outputDisposition.validationCurrent=true]) {
    const bad=structuredClone(r);mutate(bad);assert.throws(()=>check(bad),{code:'LINUX_QUALIFIED_CONTROLS'});
  }
});

test('real fourth builder validates its distinct synthetic proofs but cannot invent missing Full-FLAC authority',async()=>{
  const h=await specimens.controlsFixture();
  await assert.rejects(h.api.create1440QualifiedEncodeControls({stateDir:'/not-created',onChild(){assert.fail('child');}}),{code:'INVALID_OPERATION_QUALIFICATION'});
  assert.deepEqual(h.counts.validated,['keep720','resize1080to720','fullResize1080to720','fullResize1440to720']);
  assert.equal(h.counts.fourthLoads,1);assert.deepEqual(h.counts.tools,['ffmpeg','ffprobe']);assert.equal(h.counts.runner,0);
});

test('three-family validation never loads unavailable fourth composition, even though current Full-FLAC remains unavailable',async()=>{
  const h=await specimens.controlsFixture({rejectFourth:true});assert.equal(h.counts.fourthLoads,0);
  await assert.rejects(h.api.createQualifiedEncodeControls({stateDir:'/not-created'}),{code:'INVALID_OPERATION_QUALIFICATION'});
  assert.equal(h.counts.validated.length,3);assert.equal(h.counts.fourthLoads,0);
  await assert.rejects(h.api.create1440QualifiedEncodeControls({stateDir:'/not-created'}),{code:'TEST_1440_UNAVAILABLE'});assert.equal(h.counts.fourthLoads,1);
});
