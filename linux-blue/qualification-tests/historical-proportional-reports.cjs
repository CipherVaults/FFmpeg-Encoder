'use strict';
// Explicit historical positive report/hash/factory contracts. No default discovery.
// node --test linux-blue/qualification-tests/historical-proportional-reports.cjs
// Requires exact original four calibration and four service reports plus original
// runtime/observer/family implementation. Missing evidence FAILS; never substitute.
const test=require('node:test'),path=require('node:path'),fs=require('node:fs/promises'),{createHash}=require('node:crypto');
test.before(async()=>{
 const modules=['workbench-long-range-service.cjs','workbench-resize-service.cjs','workbench-full-resize-service.cjs','workbench-full-1440-service.cjs'].map(n=>require('../'+n));
 const proofs=Object.values(require('../workbench-qualified-encode-controls.cjs').SERVICE_PROOFS);
 for(const row of [...modules.map(m=>({report:m.REPORT,sha256:m.REPORT_SHA})),...proofs]) {
  const bytes=await fs.readFile(row.report);require('node:assert/strict').equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,'Exact original historical report prerequisite');
 }
});

test.describe('workbench-full-1440-service.test.cjs',()=>{
(function(require,__dirname){
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

test('1440 composition pins the independently accepted complete calibration bytes', async () => {
  const bytes = await fs.readFile(REPORT);
  assert.equal(REPORT_SHA, '7f31a166bb875695abaf0ea6f9917b969b07b2ac544db2624bf4c7cfd448dd65');
  assert.equal(sha(bytes), REPORT_SHA);
  const report = assertFull1440Receipt(bytes);
  assert.deepEqual(report.cases.map(row => [row.frames, row.samples]), [[360, 576000], [213, 346416]]);
  assert.equal(report.geometry.sourceWidth, 2560); assert.equal(report.geometry.sourceHeight, 1440);
});

})(require('node:module').createRequire(path.join(__dirname,'../workbench-full-1440-service.test.cjs')),path.resolve(__dirname,'..'));
});

test.describe('workbench-full-resize-service.test.cjs',()=>{
(function(require,__dirname){
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createFullResizeService, assertFullResizeReceipt, REPORT, REPORT_SHA } = require('./workbench-full-resize-service.cjs');
const range = require('./workbench-resize-service.cjs');
const { FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const check = value => { const bytes = Buffer.from(JSON.stringify(value)); return assertFullResizeReceipt(bytes, sha(bytes)); };
async function synthetic() {
  // Mutated synthetic schema fixture, never evidence or live-service authority.
  const r = JSON.parse(await fs.readFile(range.REPORT)); r.resourcePolicy = FULL_RESIZE_RESOURCE_POLICY;
  r.cases = [r.cases[0], r.cases[2]];
  for (let i = 0; i < 2; i++) {
    const s = r.sources[i], row = r.cases[i], videoUs = i ? 43100000 : 150000000, audioUs = i ? 43217000 : 150000000;
    s.id = i ? 'full-heldout-tail' : 'full-long-pattern'; s.sourceExtentUs = audioUs;
    Object.assign(s.probe.streams[0], { duration: String(videoUs / 1e6), duration_ts: videoUs * 15360 / 1e6 });
    Object.assign(s.probe.streams[1], { duration: String(audioUs / 1e6), duration_ts: audioUs * 48000 / 1e6 });
    s.probe.format.duration = String(audioUs / 1e6);
    s.frozen = frozenQualifications(`${path.basename(path.dirname(REPORT))}:${s.id}`, RUNTIME_ID, s.probe);
    Object.assign(row, { id: i ? 'full-heldout-audio-tail' : 'full-long', sourceId: s.id, range: null,
      frames: videoUs * 30 / 1e6, samples: audioUs * 48000 / 1e6,
      resources: deriveCfrFullResizeFlacResources({ sourceExtentUs: s.sourceExtentUs, sourceBytes: s.identity.size }) });
    row.validation.timing = { timeline: 'source-timestamps', requested: null, resolved: null };
    row.completeSource.video.frames = row.frames; row.completeSource.video.properties.policy = FULL_RESIZE_FAMILY_ID;
    row.completeSource.audio[0].sampleCount = String(row.samples);
  }
  return r;
}
test('pending Full service refuses before files, runtime, storage or children', async () => {
  const pending = require('./workbench-long-range-service.cjs').createProportionalServiceFactory({
    kind: 'fullResize1080to720', report: path.resolve('/never-created/report.json'), reportSha: null });
  await assert.rejects(pending.createService({ stateDir: '/never-created', onChild() { assert.fail('child'); } }), /pending/);
  assert.throws(() => pending.assertReceipt(Buffer.from('{}')), /pending/);
});
test('Full composition pins the independently reviewed completed calibration', async () => {
  const bytes = await fs.readFile(REPORT);
  assert.equal(REPORT_SHA, '197c1fc42a4108a9e5b2e4997588a828acd7c4c2aa8a7fe23772376e1535e871');
  assert.equal(sha(bytes), REPORT_SHA); assert.equal(assertFullResizeReceipt(bytes).cases.length, 2);
});
test('Full receipt requires complete distinct source extents, family and null interval', async () => {
  const r = await synthetic(); assert.deepEqual(check(r), r);
  for (const mutate of [v => { v.cases[0].range = { startUs: 0 }; }, v => { v.cases[0].validation.timing.resolved = { startUs: 0, endUs: 150000000 }; },
    v => { v.cases[1].validation.timing.timeline = 'request-relative'; }, v => { v.cases[1].samples = 2068800; },
    v => { v.cases[1].completeSource.audio[0].sampleCount = '2068800'; }, v => { v.cases[1].frames++; },
    v => { v.sources[1].probe.streams[1].duration = '43.1'; }, v => { v.sources[1].sourceExtentUs = 43100000; },
    v => { v.cases[1].completeSource.video.properties.policy = 'cfr-sdr-range-resize-flac-v1'; },
    v => { v.resourcePolicy = 'cfr1080p30-to720p-flac-resources-v1'; }, v => { v.geometry.resolution = 'source'; },
    v => { v.cases[0].resources.budget.timeoutMs--; }, v => { v.sources[0].frozen.qualification.tolerances.durationUs++; },
    v => { v.cases[0].pcmIdentity.outputHash = '0'.repeat(64); }, v => { v.cases.pop(); }]) {
    const bad = structuredClone(r); mutate(bad); assert.throws(() => check(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
  const old = await fs.readFile(range.REPORT);
  assert.throws(() => assertFullResizeReceipt(old, sha(old)), /pre-catalog/);
  assert.equal(range.assertResizeReceipt(old).status, 'passed-pre-catalog-calibration');
});
test('Full composition is a fixed main-only third variant and does not activate an app', async () => {
  const text = await fs.readFile(path.join(__dirname, 'workbench-full-resize-service.cjs'), 'utf8');
  assert.match(text, /kind: 'fullResize1080to720'/); assert.doesNotMatch(text, /process\.argv|process\.env|ipcMain/);
  for (const filename of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, filename), 'utf8')).includes('workbench-full-resize-service'));
});

})(require('node:module').createRequire(path.join(__dirname,'../workbench-full-resize-service.test.cjs')),path.resolve(__dirname,'..'));
});

test.describe('workbench-long-range-service.test.cjs',()=>{
(function(require,__dirname){
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLongRangeService, assertLongRangeReceipt, assertQualifiedClocks, ClockQualifiedFamilySelector, REPORT, REPORT_SHA } = require('./workbench-long-range-service.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { deriveCfrFlacResources, FAMILY_ID, RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}
// Synthetic structure exercises refusal logic, never a media qualification.
function report() {
  const sources = ['long-pattern', 'heldout-flipped'].map((id, i) => ({ id, sourceExtentUs: (i ? 11 : 150) * 1000000,
    sha256: (i ? 'b' : 'a').repeat(64), identity: { size: '100000000' }, probe: probe(i ? 11 : 150),
    frozen: frozenQualifications(`${path.basename(path.dirname(REPORT))}:${id}`, RUNTIME_ID, probe(i ? 11 : 150)) }));
  const cases = [ ['late-forty-seconds', 0, { startUs: 100000000, endUs: 140000000 }],
    ['late-open-end', 0, { startUs: 130000000 }], ['heldout-nonaligned', 1, { startUs: 413000, endUs: 8621000 }] ].map(([id, index, range]) => {
    const source = sources[index], end = range.endUs ?? source.sourceExtentUs;
    return { id, sourceId: source.id, range, status: 'passed', validation: { valid: true },
      resources: deriveCfrFlacResources({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - range.startUs, sourceBytes: source.identity.size }),
      pipeBytes: 1, elapsedMs: 1, frames: Math.ceil(end * 30 / 1e6) - Math.ceil(range.startUs * 30 / 1e6),
      samples: Math.ceil(end * 48000 / 1e6) - Math.ceil(range.startUs * 48000 / 1e6),
      pcmIdentity: { sourceHash: 'c'.repeat(64), outputHash: 'c'.repeat(64) }, completeSource: { video: { frames: source.sourceExtentUs * 30 / 1e6 },
        audio: [{ sampleCount: String(source.sourceExtentUs * 48000 / 1e6) }] } };
  });
  return { status: 'passed-pre-catalog-calibration', runtimeIdentity: RUNTIME_ID, resourcePolicy: RESOURCE_POLICY,
    publicationAuthorized: false, catalogActivated: false, settings, census: { spawned: 34, closed: 34, live: 0, maximum: 1 }, sources, cases };
}
const validate = r => { const bytes = Buffer.from(JSON.stringify(r)); return assertLongRangeReceipt(bytes, sha(bytes)); };
test('pending, missing or changed digests cannot authorize a receipt', async () => {
  assert.equal(REPORT_SHA, 'dc5af4b1c949e0ac8e6261493f67de5230ec4173d21b73a705287d183add2a33');
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}'), null), /pending/);
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}'), ''), /pending/);
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}')), /exact reviewed/);
  const bad = Buffer.from('{'); assert.throws(() => assertLongRangeReceipt(bad, sha(bad)), /JSON/);
  assert.equal(assertLongRangeReceipt(await fs.readFile(REPORT)).status, 'passed-pre-catalog-calibration');
});
test('exact-digest receipt validates complete frozen structure without granting service authority', () => {
  const value = report(); assert.deepEqual(validate(value), value);
  for (const mutate of [r => { r.status = 'preparing'; }, r => { r.runtimeIdentity = 'f'.repeat(64); },
    r => { r.resourcePolicy = 'other'; }, r => { r.census.live = 1; }, r => { r.sources.pop(); }, r => { r.cases.pop(); },
    r => { r.sources[1].sha256 = r.sources[0].sha256; }, r => { r.sources[0].frozen.qualification.tolerances.videoTimestampUs++; },
    r => { r.sources[0].probe.streams[0].time_base = '1/30'; }, r => { r.cases[1].range.startUs--; },
    r => { r.cases[0].resources.budget.timeoutMs++; }, r => { r.cases[0].validation.valid = false; },
    r => { r.cases[2].pcmIdentity.outputHash = 'd'.repeat(64); }, r => { r.cases[0].completeSource.video.frames--; }]) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => validate(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
});
function binding(tick = 15360) {
  const source = probe(150, tick), sourceIdentity = { canonicalPath: path.resolve('/synthetic-long/input.mov'), dev: '1', ino: '2', size: '100000000',
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'independent', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: { startUs: 121000000, endUs: 141000000 }, resolution: 'source', audioPolicy: 'precision-flac' } });
  const plan = buildEncodeOperation({ input: sourceIdentity.canonicalPath, output: path.resolve('/synthetic-long/output.mkv'), settings,
    inspection: { probe: source, color: classifyColor(source), duration: 150 }, request, runtimeIdentity: RUNTIME_ID });
  return { plan, settings, sourceIdentity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME_ID,
    environment: null, budget: null, executionBudgetMs: 120000 };
}
test('clock selector binds genuine plan source, not external claims or an exact fixture/range', () => {
  const frozen = report().sources[0].frozen;
  const selector = new ClockQualifiedFamilySelector({ policyIdentity: 'synthetic-clock-policy', families: [{ id: FAMILY_ID,
    runtimeIdentity: RUNTIME_ID, environment: null, settings, resourcePolicy: RESOURCE_POLICY, qualification: frozen.qualification,
    timingQualification: frozen.timingQualification, evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] }] });
  assert.ok(selector instanceof OperationFamilySelector);
  const valid = binding(), token = selector.select(valid);
  assert.equal(selector.requireCurrent(token, valid).proportional, true);
  const wrong = binding(30000);
  assert.throws(() => selector.select(wrong), /clocks/);
  assert.throws(() => selector.requireCurrent(token, wrong), /clocks/);
  assert.throws(() => selector.select({ ...wrong, sourceProbe: probe() }), /clocks/);
  assert.throws(() => selector.select({ ...valid, plan: structuredClone(valid.plan) }), { code: 'INVALID_ENCODE_OPERATION' });
  assert.throws(() => selector.requireCurrent(token, binding()), { code: 'OPERATION_QUALIFICATION_STALE' });
  assertQualifiedClocks(probe());
});
test('composition is not activated and has no caller receipt/runtime or fixture binding route', async () => {
  const source = await fs.readFile(path.join(__dirname, 'workbench-long-range-service.cjs'), 'utf8');
  assert.doesNotMatch(source, /CalibratedSourceSelector|process\.env|process\.argv|ipcMain/);
  for (const filename of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, filename), 'utf8')).includes('workbench-long-range-service'));
});
test('output metadata clocks are checked without replacing shared parser or child result', async () => {
  const { clockGuardedRunner } = require('./workbench-long-range-service.cjs');
  const { PINS } = require('./runtime-av1.cjs');
  const args = ['-show_streams', '-show_format'];
  const result = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ time_base: '1/1000' }, { time_base: '1/1000' }] }) };
  assert.equal(await clockGuardedRunner(async () => result)(PINS.ffprobe.path, args), result);
  const capability = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ codec_type: 'video', time_base: '1/1000' }] }) };
  assert.equal(await clockGuardedRunner(async () => capability)(PINS.ffprobe.path, args), capability);
  const empty = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [] }) };
  await assert.rejects(clockGuardedRunner(async () => empty)(PINS.ffprobe.path, args), /output requires/);
  const wrong = { ...result, stdout: result.stdout.replace('1/1000', '1/90000') };
  await assert.rejects(clockGuardedRunner(async () => wrong)(PINS.ffprobe.path, args), /output requires/);
  const absent = { ...result, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ time_base: '1/1000' }, {}] }) };
  await assert.rejects(clockGuardedRunner(async () => absent)(PINS.ffprobe.path, args), /output requires/);
  const options = { onOutputBytes() {}, signal: new AbortController().signal };
  await clockGuardedRunner(async (exe, argv, supplied) => { assert.equal(exe, PINS.ffprobe.path); assert.equal(argv, args); assert.equal(supplied, options); return result; })(PINS.ffprobe.path, args, options);
  const streamed = { exitCode: 0, stdout: '' };
  assert.equal(await clockGuardedRunner(async () => streamed)(PINS.ffprobe.path, args, { onStdoutChunk() {} }), streamed);
  const failed = { exitCode: 1, stdout: '' };
  assert.equal(await clockGuardedRunner(async () => failed)(PINS.ffprobe.path, args), failed);
  const input = { exitCode: 0, stdout: JSON.stringify(probe()) };
  assert.equal(await clockGuardedRunner(async () => input)(PINS.ffprobe.path, args), input);
});

})(require('node:module').createRequire(path.join(__dirname,'../workbench-long-range-service.test.cjs')),path.resolve(__dirname,'..'));
});

test.describe('workbench-qualified-encode-controls.test.cjs',()=>{
(function(require,__dirname){
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
  const module = require(kind === 'fullResize1440to720' ? './workbench-full-1440-service.cjs' : kind === 'keep720' ? './workbench-long-range-service.cjs' : kind === 'fullResize1080to720' ? './workbench-full-resize-service.cjs' : './workbench-resize-service.cjs');
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
  for (const kind of ['keep720','resize1080to720','fullResize1080to720','fullResize1440to720']) {
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
  assert.ok(!main.includes('workbench-qualified-encode-controls')); assert.ok(main.includes('create1440QualifiedAv1WorkbenchService'));
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

test('accepted exact fourth proof constructs four-family factory without children and keeps three-family app separate',async()=>{
  const {create1440QualifiedAv1WorkbenchService,createQualifiedAv1WorkbenchService}=require('./workbench-av1-service.cjs');
  const {FULL_1440_RESIZE_FAMILY_ID}=require('../src/operation-resource-budget.cjs');
  const bytes=await fs.readFile(SERVICE_PROOFS.fullResize1440to720.report);
  assert.equal(sha(bytes),'44b2dda7486b274e5afd94b4bdb69c757667b4ba02261e131e5a97152d816be5');
  for(const [factory,size] of [[create1440QualifiedAv1WorkbenchService,4],[createQualifiedAv1WorkbenchService,3]]) {
    const outputAccess={marker:'four-family-no-media'},stateDir=path.join(__dirname,'artifacts','four-family-construction-no-media');
    const service=await factory({stateDir,outputAccess,onChild(){assert.fail('No children');}});
    try {assert.equal(service.linuxQualifiedEncodeStatus.familyIds.length,size);
      assert.equal(service.linuxQualifiedEncodeStatus.familyIds.includes(FULL_1440_RESIZE_FAMILY_ID),size===4);
      assert.equal(service.outputAccess,outputAccess);assert.equal(service.stateDir,stateDir);
      assert.equal(service.linuxRemuxStatus.available,false);assert.equal(service.operationEvidenceBudget,null);
    }finally{service.closeAdmission();await service.closeOperationResources();}
  }
});

test('three-family controls import and real construction do not load unavailable inactive 1440 composition',async()=>{
  const file=path.join(__dirname,'workbench-qualified-encode-controls.cjs'),source=await fs.readFile(file,'utf8');
  const module={exports:{}},real=createRequire(file);let fourthLoads=0;
  vm.runInThisContext(`(function(require,module,exports,__dirname){${source}\n})`,{filename:file})(name=>{
    if(name==='./workbench-full-1440-service.cjs'){fourthLoads++;throw Object.assign(new Error('inactive 1440 dependency unavailable'),{code:'TEST_1440_UNAVAILABLE'});}
    return real(name);
  },module,module.exports,__dirname);
  assert.equal(fourthLoads,0);
  const result=await module.exports.createQualifiedEncodeControls({stateDir:path.join(__dirname,'artifacts','three-family-no-fourth-dependency'),onChild(){assert.fail('No children');}});
  try {assert.equal(result.status.familyIds.length,3);assert.equal(fourthLoads,0);}
  finally {await result.controls.operationRuntime.close();}
  await assert.rejects(module.exports.create1440QualifiedEncodeControls({stateDir:'/not-created'}),{code:'TEST_1440_UNAVAILABLE'});
  assert.equal(fourthLoads,1);
});

})(require('node:module').createRequire(path.join(__dirname,'../workbench-qualified-encode-controls.test.cjs')),path.resolve(__dirname,'..'));
});

test.describe('workbench-resize-service.test.cjs',()=>{
(function(require,__dirname){
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createResizeService, assertResizeReceipt, REPORT, REPORT_SHA } = require('./workbench-resize-service.cjs');
const previous = require('./workbench-long-range-service.cjs');
const { RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, deriveCfrResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = value => { const bytes = Buffer.from(JSON.stringify(value)); return assertResizeReceipt(bytes, sha(bytes)); };
async function syntheticReport() {
  // Deliberately synthetic mutation for schema tests only, never service authority.
  const value = JSON.parse(await fs.readFile(previous.REPORT));
  value.resourcePolicy = RESIZE_RESOURCE_POLICY;
  value.geometry = { sourceWidth: 1920, sourceHeight: 1080, resolution: '720', outputWidth: 1280, outputHeight: 720 };
  for (const source of value.sources) {
    const video = source.probe.streams.find(s => s.codec_type === 'video'); video.width = 1920; video.height = 1080;
    source.frozen = frozenQualifications(`${path.basename(path.dirname(REPORT))}:${source.id}`, RUNTIME_ID, source.probe);
  }
  for (const row of value.cases) {
    const source = value.sources.find(s => s.id === row.sourceId);
    row.resources = deriveCfrResizeFlacResources({ sourceExtentUs: source.sourceExtentUs,
      selectedExtentUs: (row.range.endUs ?? source.sourceExtentUs) - row.range.startUs, sourceBytes: source.identity.size });
    row.completeSource.video.properties.policy = RESIZE_FAMILY_ID;
  }
  return value;
}
test('resize receipt binds independently verified bytes while explicit pending factories stay closed', async () => {
  assert.equal(REPORT_SHA, 'dd0637354ea1ca27e57c75958074423aff98f37ab6da00a3459a6dac2b206c32');
  const pending = previous.createProportionalServiceFactory({ kind: 'resize1080to720', report: REPORT, reportSha: null });
  await assert.rejects(pending.createService({ stateDir: '/must-not-exist', onChild() { assert.fail('child'); } }), /pending/);
  assert.throws(() => pending.assertReceipt(Buffer.from('{}')), /pending/);
  assert.throws(() => assertResizeReceipt(Buffer.from('{}')), /exact reviewed/);
  assert.equal(assertResizeReceipt(await fs.readFile(REPORT)).status, 'passed-pre-catalog-calibration');
});
test('resize receipt independently binds geometry, policy, clocks, resources and all evidence', async () => {
  const value = await syntheticReport(); assert.deepEqual(check(value), value);
  for (const mutate of [r => { delete r.geometry; }, r => { r.geometry.resolution = 'source'; },
    r => { r.geometry.outputWidth = 1920; }, r => { r.sources[0].probe.streams[0].width = 1280; },
    r => { r.resourcePolicy = 'cfr720p30-flac-resources-v1'; }, r => { r.cases[0].completeSource.video.properties.policy = 'cfr-sdr-range-flac-v2'; },
    r => { r.sources[0].probe.streams[0].time_base = '1/30000'; }, r => { r.sources[0].frozen.qualification.tolerances.videoTimestampUs++; },
    r => { r.cases[0].resources.budget.timeoutMs--; }, r => { r.cases[1].status = 'encoding'; }, r => { r.cases.pop(); },
    r => { r.cases[0].completeSource.video.frames--; }, r => { r.cases[0].pcmIdentity.outputHash = '0'.repeat(64); }]) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => check(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
  const original = await fs.readFile(previous.REPORT);
  assert.throws(() => assertResizeReceipt(original, sha(original)), /pre-catalog/);
  assert.equal(previous.assertLongRangeReceipt(original).status, 'passed-pre-catalog-calibration');
});
test('trusted factory rejects hidden or arbitrary configuration and snapshots pending state', async () => {
  const { createProportionalServiceFactory } = previous;
  for (const config of [{}, { kind: 'other', report: REPORT, reportSha: null },
    { kind: 'resize1080to720', report: REPORT, reportSha: null, runtime: 'other' },
    { kind: 'resize1080to720', report: 'relative', reportSha: null }])
    assert.throws(() => createProportionalServiceFactory(config), { code: 'LINUX_LONG_RANGE_SCOPE' });
  const hidden = { kind: 'resize1080to720', report: REPORT, get reportSha() { assert.fail('getter'); } };
  assert.throws(() => createProportionalServiceFactory(hidden), /inert/);
  const config = { kind: 'resize1080to720', report: REPORT, reportSha: null };
  const factory = createProportionalServiceFactory(config); config.reportSha = 'a'.repeat(64);
  await assert.rejects(factory.createService(), /pending/);
});
test('resize composition is separate, fixed, and absent from application entry points', async () => {
  for (const name of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, name), 'utf8')).includes('workbench-resize-service'));
  const source = await fs.readFile(path.join(__dirname, 'workbench-resize-service.cjs'), 'utf8');
  assert.doesNotMatch(source, /process\.argv|process\.env|ipcMain|CalibratedSourceSelector/);
  assert.match(source, /kind: 'resize1080to720'/);
});

})(require('node:module').createRequire(path.join(__dirname,'../workbench-resize-service.test.cjs')),path.resolve(__dirname,'..'));
});
