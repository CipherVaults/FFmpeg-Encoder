'use strict';
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
async function synthetic() {
  // Schema fixture only. A digest override cannot authorize service construction.
  const r=JSON.parse(await fs.readFile(old.REPORT));r.resourcePolicy=FULL_1440_RESIZE_RESOURCE_POLICY;
  r.geometry={sourceWidth:2560,sourceHeight:1440,resolution:'720',outputWidth:1280,outputHeight:720};
  for(let i=0;i<2;i++) {
    const s=r.sources[i],row=r.cases[i],videoUs=i?7100000:12000000,audioUs=i?7217000:12000000;
    s.id=i?'full-1440-heldout-tail':'full-1440-pattern';s.sourceExtentUs=audioUs;
    Object.assign(s.probe.streams[0],{width:2560,height:1440,duration:String(videoUs/1e6),duration_ts:videoUs*15360/1e6});
    Object.assign(s.probe.streams[1],{duration:String(audioUs/1e6),duration_ts:audioUs*48000/1e6});
    s.probe.format.duration=String(audioUs/1e6);
    s.frozen=frozenQualifications(`${path.basename(path.dirname(REPORT))}:${s.id}`,RUNTIME_ID,s.probe);
    Object.assign(row,{id:i?'full-1440-heldout-audio-tail':'full-1440',sourceId:s.id,range:null,frames:videoUs*30/1e6,samples:audioUs*48000/1e6,
      elapsedMs:0,pipeBytes:1,resources:deriveCfrFull1440ResizeFlacResources({sourceExtentUs:audioUs,sourceBytes:s.identity.size})});
    row.validation.timing={timeline:'source-timestamps',requested:null,resolved:null};
    row.completeSource.video.frames=row.frames;row.completeSource.video.properties.policy=FULL_1440_RESIZE_FAMILY_ID;
    row.completeSource.audio[0].sampleCount=String(row.samples);
  }
  return r;
}
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
  const bytes=await fs.readFile(old.REPORT);assert.throws(()=>assertFull1440Receipt(bytes,sha(bytes)),/pre-catalog/);
  assert.equal(old.assertFullResizeReceipt(bytes).status,'passed-pre-catalog-calibration');
});
test('1440 is fixed main-only fourth variant without app activation or geometry override',async()=>{
  for(const filename of ['workbench-main.cjs','workbench-av1-service.cjs','workbench-qualified-encode-controls.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname,filename),'utf8')).includes('workbench-full-1440-service'));
  const text=await fs.readFile(path.join(__dirname,'workbench-full-1440-service.cjs'),'utf8');
  assert.match(text,/kind: 'fullResize1440to720'/);assert.doesNotMatch(text,/process\.argv|process\.env|ipcMain/);
  assert.throws(()=>createProportionalServiceFactory({kind:'fullResize1440to720',report:REPORT,reportSha:null,sourceWidth:1920}),/inert/);
});

test('1440 composition pins the independently accepted complete calibration bytes', async () => {
  const bytes = await fs.readFile(REPORT);
  assert.equal(REPORT_SHA, '7f31a166bb875695abaf0ea6f9917b969b07b2ac544db2624bf4c7cfd448dd65');
  assert.equal(sha(bytes), REPORT_SHA);
  const report = assertFull1440Receipt(bytes);
  assert.deepEqual(report.cases.map(row => [row.frames, row.samples]), [[360, 576000], [213, 346416]]);
  assert.equal(report.geometry.sourceWidth, 2560); assert.equal(report.geometry.sourceHeight, 1440);
});
