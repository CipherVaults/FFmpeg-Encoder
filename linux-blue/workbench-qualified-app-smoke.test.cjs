'use strict';
// Planning/arithmetic/import checks only. Never run the media campaign here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { SOURCES, CHANGED, assertReady, generationArgs, ordinaryGenerationArgs, MIXED_INPUTS, count } = require('./workbench-qualified-app-smoke.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const { FAMILY_ID, RESIZE_FAMILY_ID, FULL_RESIZE_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
test('readiness fails closed unless actual factory exposes all qualified controls and no Remux/HDR', () => {
  const ready = {runtimeIdentity:RUNTIME_ID,linuxQualifiedEncodeStatus:{available:true,familyIds:[FAMILY_ID,RESIZE_FAMILY_ID,FULL_RESIZE_FAMILY_ID]},
    linuxRemuxStatus:{available:false},remuxOperations:null,hdrOperations:null};
  assertReady(ready);
  for (const patch of [{linuxQualifiedEncodeStatus:undefined},{runtimeIdentity:'0'.repeat(64)},
    {linuxQualifiedEncodeStatus:{available:true,familyIds:[FAMILY_ID]}},{remuxOperations:{}},{hdrOperations:{}}])
    assert.throws(()=>assertReady({...ready,...patch}));
});
test('short fixed fixture matrix covers both geometries and Full tail without repeating long proof', () => {
  assert.equal(SOURCES.length,2); assert.equal(CHANGED.length,3);
  assert.deepEqual(SOURCES.map(s=>[s.width,s.height]),[[1280,720],[1920,1080]]);
  assert.ok(SOURCES.every(s=>s.videoUs===6000000 && s.audioUs<=6117000));
  assert.equal(CHANGED[2].range,null);assert.equal(count(0,SOURCES[1].audioUs,48000),293616);
  assert.equal(count(613000,3721000,30),93);assert.equal(count(613000,3721000,48000),149184);
  for (const spec of SOURCES) {
    const args=generationArgs(spec,'/owned/example.mov'); assert.ok(args.includes('-n')); assert.equal(args.at(-1),'/owned/example.mov');
    assert.equal(args[args.indexOf('-profile:v:0')+1],'high');assert.equal(args[args.indexOf('-c:a:0')+1],'pcm_s16le');
    assert.ok(args.some(a=>a.includes(`rate=30:duration=${spec.videoUs/1e6}`)));
  }
  assert.throws(()=>generationArgs({...SOURCES[0]},'/owned/example.mov'),/fixed/);
});
test('campaign invokes actual existing app factory and preserves authority boundaries', async () => {
  const source=await fs.readFile(path.join(__dirname,'workbench-qualified-app-smoke.cjs'),'utf8');
  assert.match(source,/require\('\.\/workbench-av1-service\.cjs'\)/);
  assert.match(source,/await createQualifiedAv1WorkbenchService\(/);
  assert.ok(source.indexOf('assertReady(service);')<source.indexOf('report.capabilities = await service.getCapabilities()'));
  assert.doesNotMatch(source,/CandidateTrimService|createQualifiedEncodeControls|new OperationFamilySelector|new OperationRuntimeObserver|\.execute\s*=/);
  for (const name of ['mixed-ordinary-and-range','forged-family','forged-runtime','stale-family','unsupported-setting-per-file','collision']) assert.ok(source.includes(name));
  assert.match(source,/closeOperationResources\(\)/);assert.match(source,/closeDiagnostics\(/);
  assert.match(source,/if \(require\.main === module\) main\(\)/);
});

test('ordinary fixture matches previously accepted Matroska FFV1 PCM generation; mixed batch retains distinct MOV', async () => {
  const args = ordinaryGenerationArgs('/owned/ordinary.mkv');
  const prior = await fs.readFile(path.join(__dirname, 'workbench-execution-smoke.cjs'), 'utf8');
  const start = prior.indexOf("['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',");
  const end = prior.indexOf('source]);', start);
  assert.ok(start >= 0 && end > start);
  // Evaluate only the locally authored fixed literal, not external data.
  const priorArgs = require('node:vm').runInNewContext(prior.slice(start, end) + "'/owned/ordinary.mkv']");
  assert.deepEqual(args, Array.from(priorArgs));
  assert.deepEqual(MIXED_INPUTS, [{ name: 'ordinary.mkv', source: 'ordinary' }, { name: 'changed.mov', source: 'keep' }]);
  const source = await fs.readFile(path.join(__dirname, 'workbench-qualified-app-smoke.cjs'), 'utf8');
  assert.match(source, /publish\(`ordinary-\$\{profile.id\}`, 'ordinary'/);
  assert.match(source, /item.name === 'changed.mov'/);
  assert.match(source, /refusedItem.reasonCode, 'INVALID_OUTPUT'/);
  assert.match(source, /audio channel_layout changed/);
  assert.match(source, /fs.stat\(layoutLoss.destinations.get\(refusedItem.id\)\)/);
  assert.match(source, /refusedItem.outputDisposition\?\.published, true/);
});
