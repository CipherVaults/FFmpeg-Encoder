'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSourceEvidence, selectCaseFolders, smokeProfile } = require('./workbench-long-range-smoke.cjs');
test('service campaign geometry and publication status stay separate and main-owned', () => {
  const keep = smokeProfile(), resize = smokeProfile('resize1080to720');
  assert.equal(keep.width, 1280); assert.equal(keep.resolution, 'source');
  assert.equal(resize.width, 1920); assert.equal(resize.height, 1080); assert.equal(resize.resolution, '720');
  assert.notEqual(keep.label, resize.label); assert.notEqual(keep.passedStatus, resize.passedStatus);
  assert.ok(Object.isFrozen(keep) && Object.isFrozen(resize));
  assert.throws(() => smokeProfile('../other'));
});
test('evidence cancellation observes only the active source full-frame decode', () => {
  const source = '/owned/current.mov';
  const child = (...args) => ({ spawnargs: ['/fixed/ffprobe', ...args] });
  assert.equal(isSourceEvidence(child('-show_frames', '-i', source), source), true);
  assert.equal(isSourceEvidence(child('-show_frames', '-i', '/owned/output.mkv'), source), false);
  assert.equal(isSourceEvidence(child('-show_packets', '-i', source), source), false);
  assert.equal(isSourceEvidence(child('-show_streams', '-i', source), source), false);
  assert.equal(isSourceEvidence(child('-progress', 'pipe:1', '-i', source), source), false);
});
test('each case receives current single-role folder tokens rather than stale prior input authority', async () => {
  const roles = new Map(); let next = 0;
  const service = { async registerFolder(path, role) { const value = { path, id: ++next }; roles.set(role, value); return value; } };
  const first = await selectCaseFolders(service, '/owned/long', '/owned/out1');
  const second = await selectCaseFolders(service, '/owned/fresh', '/owned/out2');
  assert.notEqual(second.inputFolderId, first.inputFolderId);
  assert.equal(second.inputFolderId, roles.get('input').id);
  assert.equal(second.outputFolderId, roles.get('output').id);
  assert.equal(roles.get('input').path, '/owned/fresh');
});

test('Full resize has a separate fixed status and scope without changing range defaults', () => {
  const full = smokeProfile('fullResize1080to720'), range = smokeProfile('resize1080to720');
  assert.equal(full.full, true); assert.equal(range.full, false); assert.equal(smokeProfile().full, false);
  assert.equal(full.resolution, '720'); assert.equal(full.width, 1920);
  assert.equal(full.passedStatus, 'passed-developer-full-resize-service-proof');
  assert.notEqual(full.label, range.label); assert.match(full.scope, /complete audio tails/);
});

test('1440 Full has fixed short source extents, tail counts and bounded campaign limits', () => {
  const p=smokeProfile('fullResize1440to720');
  assert.equal(p.full,true);assert.equal(p.full1440,true);assert.deepEqual([p.width,p.height,p.resolution],[2560,1440,'720']);
  assert.equal(p.passedStatus,'passed-developer-full-1440-service-proof');assert.equal(p.label,'full-1440-service-');
  assert.deepEqual([p.longVideoUs,p.tailVideoUs,p.tailAudioUs,p.freshVideoUs,p.freshAudioUs],[12000000,7100000,7217000,4000000,4117000]);
  assert.deepEqual([p.longVideoUs*30/1e6,p.longVideoUs*48000/1e6,p.tailVideoUs*30/1e6,p.tailAudioUs*48000/1e6,p.freshVideoUs*30/1e6,p.freshAudioUs*48000/1e6],
    [360,576000,213,346416,120,197616]);
  assert.equal(p.deadlineMs,900000);assert.equal(p.maxChildren,220);assert.ok(Object.isFrozen(p));
  assert.equal(smokeProfile('fullResize1080to720').freshAudioUs,10117000);assert.equal(smokeProfile().longVideoUs,150000000);
});
test('1440 pending composition blocks campaign before file reads or media independent of later pins',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
  const filename=path.join(__dirname,'workbench-long-range-smoke.cjs'),source=await fs.readFile(filename,'utf8');
  const localRequire=require('node:module').createRequire(filename),module={exports:{}};
  const mockRequire=name=>name==='./workbench-full-1440-service.cjs'?{REPORT_SHA:null,createFull1440Service(){assert.fail('No service');}}:localRequire(name);
  vm.runInNewContext(source,{require:mockRequire,module,exports:module.exports,__dirname,console,process,Buffer,setTimeout,clearTimeout,AbortController,AbortSignal});
  const saved=fs.statfs;let reads=0;fs.statfs=async()=>{reads++;assert.fail('No storage read before pending gate');};
  try{await assert.rejects(module.exports.runServiceCampaign('fullResize1440to720'),/pending/);}finally{fs.statfs=saved;}
  assert.equal(reads,0);
});
test('1440 wrapper is inert and retains genuine selection, both live cancels, recovery and collision',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path');
  const text=await fs.readFile(path.join(__dirname,'workbench-long-range-smoke.cjs'),'utf8');
  const wrapper=await fs.readFile(path.join(__dirname,'workbench-full-1440-smoke.cjs'),'utf8');
  assert.match(wrapper,/runServiceCampaign\('fullResize1440to720'\)/);assert.match(wrapper,/if \(require.main === module\)/);
  assert.equal(typeof require('./workbench-full-1440-smoke.cjs').main,'function');
  for(const label of ['full-1440-calibrated-audio-tail','fresh-independent-full-1440-audio-tail','existing-output-preserved'])assert.ok(text.includes(label));
  assert.match(text,/composition.createFull1440Service/);assert.match(text,/qualificationSelection/);assert.match(text,/operationCostLimits\(entry, qualified\)/);
  assert.match(text,/for \(const mode of \['encode', 'evidence'\]\)/);assert.match(text,/p.frame > 0 && p.ended === false/);
  assert.match(text,/isSourceEvidence\(child, activeSource\)/);assert.match(text,/item.outputDisposition.validationCurrent, false/);
  assert.match(text,/fresh-success-after-\$\{mode\}-cancel/);
});
