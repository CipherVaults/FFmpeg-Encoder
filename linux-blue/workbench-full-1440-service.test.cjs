'use strict';
const specimens = require('./test-fixtures/proportional-reports.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createFull1440Service, assertFull1440Receipt, REPORT, REPORT_SHA } = require('./workbench-full-1440-service.cjs');
const old = require('./workbench-full-resize-service.cjs');
const { createProportionalServiceFactory } = require('./workbench-long-range-service.cjs');
const { FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY, deriveCfrFull1440ResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const check = value => { const b=Buffer.from(JSON.stringify(value));return assertFull1440Receipt(b,sha(b)); };
async function synthetic() { return specimens.calibration('fullResize1440to720'); }
test('1440 enduring null factory refuses before reads, runtime, storage or children',async()=>{
  const pending=createProportionalServiceFactory({kind:'fullResize1440to720',report:path.resolve('/never-created/report.json'),reportSha:null});
  const original=fs.readFile;let reads=0;fs.readFile=async()=>{reads++;assert.fail('No read before pending gate');};
  try { for(const create of [pending.createService]) await assert.rejects(create({stateDir:'/never-created',onChild(){assert.fail('child');}}),/pending/); }
  finally {fs.readFile=original;}
  assert.equal(reads,0);assert.throws(()=>pending.assertReceipt(Buffer.from('{}')),/pending/);
});
test('1440 pure receipt schema retains full extents, independent source and exact family resources',async()=>{
  const r=await synthetic();assert.deepEqual(check(r),r);
  assert.deepEqual(r.cases.map(x=>[x.frames,x.samples]),[[360,576000],[213,346416]]);
  for(const mutate of [
    v=>{v.geometry.sourceWidth=1920;},v=>{v.sources[0].probe.streams[0].height=1080;},
    v=>{v.sources[0].id='full-long-pattern';},v=>{v.cases[0].id='full-long';},v=>{v.cases[0].range={startUs:0};},
    v=>{v.cases[1].validation.timing.resolved={startUs:0,endUs:7217000};},v=>{v.cases[1].validation.timing.timeline='request-relative';},
    v=>{v.sources[1].sourceExtentUs=7100000;},v=>{v.sources[1].probe.streams[1].duration='7.1';},
    v=>{v.cases[1].samples=340800;},v=>{v.cases[1].completeSource.audio[0].sampleCount='340800';},v=>{v.cases[1].frames++;},
    v=>{v.cases[0].completeSource.video.properties.policy='cfr-sdr-full-resize-flac-v1';},v=>{v.resourcePolicy='cfr1080p30-full-to720p-flac-resources-v1';},
    v=>{v.cases[0].resources.budget.timeoutMs--;},v=>{v.sources[0].frozen.qualification.tolerances.durationUs++;},
    v=>{v.sources[0].probe.streams[0].time_base='1/1000';},v=>{v.runtimeIdentity='0'.repeat(64);},
    v=>{v.cases[0].pcmIdentity.outputHash='0'.repeat(64);},v=>{v.sources[1].sha256=v.sources[0].sha256;},v=>{v.cases.pop();}
  ]) {const bad=structuredClone(r);mutate(bad);assert.throws(()=>check(bad),{code:'LINUX_LONG_RANGE_SCOPE'});}
  const bytes=specimens.bytes(specimens.calibration('fullResize1080to720'));assert.throws(()=>assertFull1440Receipt(bytes,sha(bytes)),/pre-catalog/);
  assert.equal(old.assertFullResizeReceipt(bytes,sha(bytes)).status,'passed-pre-catalog-calibration');
});
test('1440 stays a lazy explicit fourth route, not an ordinary default or geometry override',async()=>{
  const vm=require('node:vm'),{createRequire}=require('node:module');
  const main=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
  const begin=main.indexOf('const createService = '),end=main.indexOf(';',begin),expression=main.slice(begin,end+1)+'\ncreateService;';
  const ordinary=()=>{},fourth=()=>{};let loads=0;
  assert.equal(vm.runInNewContext(expression,{runtimeChoice:'baseline',createWorkbenchService:ordinary,require(){assert.fail('No AV1 import for default');}}),ordinary);
  assert.equal(vm.runInNewContext(expression,{runtimeChoice:'9.0.2-av1',createWorkbenchService:ordinary,require(n){assert.equal(n,'./workbench-av1-service.cjs');loads++;return {create1440QualifiedAv1WorkbenchService:fourth};}}),fourth);assert.equal(loads,1);
  const file=path.join(__dirname,'workbench-qualified-encode-controls.cjs'),source=await fs.readFile(file,'utf8'),real=createRequire(file),module={exports:{}};
  let fourthLoads=0;
  vm.runInThisContext(`(function(require,module,exports,__dirname){${source}\n})`,{filename:file})(n=>{
    if(n==='./workbench-full-1440-service.cjs'){fourthLoads++;return {REPORT_SHA:null};}
    if(n==='./workbench-full-resize-service.cjs')return {REPORT_SHA:null};
    return real(n);
  },module,module.exports,__dirname);
  assert.equal(fourthLoads,0);
  await assert.rejects(module.exports.createQualifiedEncodeControls({stateDir:'/not-created'}),/pending/);assert.equal(fourthLoads,0);
  await assert.rejects(module.exports.create1440QualifiedEncodeControls({stateDir:'/not-created'}),/1440.*pending/);assert.equal(fourthLoads,1);
  const text=await fs.readFile(path.join(__dirname,'workbench-full-1440-service.cjs'),'utf8');
  assert.match(text,/kind: 'fullResize1440to720'/);assert.doesNotMatch(text,/process\.argv|process\.env|ipcMain/);
  assert.throws(()=>createProportionalServiceFactory({kind:'fullResize1440to720',report:REPORT,reportSha:null,sourceWidth:1920}),/inert/);
});

test('portable1440 schema retains counts without impersonating accepted calibration bytes', async () => {
  const bytes = specimens.bytes(await synthetic());
  assert.equal(REPORT_SHA, '7f31a166bb875695abaf0ea6f9917b969b07b2ac544db2624bf4c7cfd448dd65');
  assert.notEqual(sha(bytes),REPORT_SHA);assert.throws(()=>assertFull1440Receipt(bytes),/exact reviewed/);
  const report = assertFull1440Receipt(bytes,sha(bytes));
  assert.deepEqual(report.cases.map(row => [row.frames, row.samples]), [[360, 576000], [213, 346416]]);
  assert.equal(report.geometry.sourceWidth, 2560); assert.equal(report.geometry.sourceHeight, 1440);
});
