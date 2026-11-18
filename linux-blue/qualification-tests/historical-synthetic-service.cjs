'use strict';
// Explicit live-media qualification, never part of default portable *.test suite.
// Run only with separate media authorization:
// LINUX_BLUE_SYNTHETIC_FIXTURE=/absolute/exact/pilot.mkv node --test linux-blue/qualification-tests/historical-synthetic-service.cjs
// Requires original pilot SHA145c63fa... and exact runtime.cjs pinned pair.
// Missing prerequisites fail (no skips); never substitute another fixture/runtime.
const path=require('node:path');
(function(require,__dirname){
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSyntheticService, FIXTURE_SHA } = require('./synthetic-service.cjs');
const { cpuChoices } = require('./ui-policy.cjs');
const { sha256 } = require('./runtime.cjs');
const source = process.env.LINUX_BLUE_SYNTHETIC_FIXTURE;
const settings = id => { const p = cpuChoices().find(item => item.id === id); return { profileId: id, preset: p.defaultPreset, quality: p.quality.default }; };
const parent = path.join(__dirname, 'artifacts');
test('synthetic staged service: codecs, exclusive publication, admission and child balance', async () => {
  assert(source, 'Set LINUX_BLUE_SYNTHETIC_FIXTURE to the known prior pilot fixture.');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  let live = 0, maximum = 0, spawned = 0, closed = 0;
  const service = await createSyntheticService({ source, parent, onChild(child) {
    spawned++; live++; maximum = Math.max(maximum, live);
    child.once('close', () => { live--; closed++; });
  } });
  await assert.rejects(service.start({ ...settings('h264-cpu'), profileId: 'h264-nvidia' }), { code: 'LINUX_UI_SETTINGS' });
  const pending = service.start(settings('h264-cpu'));
  await assert.rejects(service.start(settings('h265-cpu')), { code: 'SYNTHETIC_BUSY' });
  const results = [await pending];
  for (const id of ['h265-cpu', 'av1-cpu']) results.push(await service.start(settings(id)));
  assert(results.every(item => item.published && item.status === 'published' && !item.cleanup.retained));
  const before = sha256(await fs.readFile(results[0].destination));
  await assert.rejects(service.start(settings('h264-cpu')), { code: 'SYNTHETIC_OUTPUT_EXISTS' });
  assert.equal(sha256(await fs.readFile(results[0].destination)), before);
  assert.equal(sha256(await fs.readFile(source)), FIXTURE_SHA);
  await service.close();
  await assert.rejects(service.start(settings('h264-cpu')), { code: 'SYNTHETIC_CLOSED' });
  assert.equal(live, 0); assert.equal(maximum, 1); assert.equal(spawned, closed);
  await fs.writeFile(path.join(service.directory, 'receipt.json'), JSON.stringify({ results, spawned, closed, maximum, sourceUnchanged: true }, null, 2));
});
test('active cancellation drains before restart; progress-time collision never overwrites', async () => {
  let service, mode = 'cancel', live = 0, cancelledAtProgress = false, collisionPath;
  service = await createSyntheticService({ source, parent, onChild(child) { live++; child.once('close', () => live--); },
    onProgress(progress) {
      if (mode === 'cancel' && progress.frame > 0) { cancelledAtProgress = true; void service.cancel(); }
      if (mode === 'collision' && progress.frame > 0) {
        // Synchronous main-owned race injection before publication. No adapter
        // option can replace the production atomic-link primitive.
        require('node:fs').writeFileSync(collisionPath, 'existing output', { flag: 'wx' }); mode = 'done';
      }
    }
  });
  await assert.rejects(service.start(settings('h264-cpu')), { code: 'CANCELLED' });
  await service.cancel(); assert(cancelledAtProgress); assert.equal(live, 0);
  assert.deepEqual((await fs.readdir(service.directory)).filter(name => name.endsWith('.mkv')), []);
  mode = 'collision'; collisionPath = path.join(service.directory, 'h264-cpu.mkv');
  const result = await service.start(settings('h264-cpu'));
  assert.equal(result.status, 'collision'); assert.equal(result.published, false);
  assert(result.cleanup.retained); assert.equal(await fs.readFile(collisionPath, 'utf8'), 'existing output');
  await service.close(); assert.equal(live, 0);
  await fs.writeFile(path.join(service.directory, 'receipt.json'), JSON.stringify({ cancelledAtProgress, result, live }, null, 2));
});
test('nonfixture source refuses before any child, including HDR/personal files', async () => {
  const folder = await fs.mkdtemp(path.join(parent, 'invalid-fixture-'));
  const file = path.join(folder, 'input.mkv'); await fs.writeFile(file, 'not the qualified synthetic fixture');
  let spawned = false;
  await assert.rejects(createSyntheticService({ source: file, parent, onChild() { spawned = true; } }), { code: 'SYNTHETIC_FIXTURE' });
  assert.equal(spawned, false);
});
test('close drains an active child and permanently closes admission', async () => {
  let service, live = 0, sawChild = false, closing;
  service = await createSyntheticService({ source, parent, onChild(child) {
    live++; sawChild = true; child.once('close', () => live--);
    closing = service.close();
  } });
  await assert.rejects(service.start(settings('h264-cpu')), { code: 'CANCELLED' });
  await closing; assert(sawChild); assert.equal(live, 0);
  await assert.rejects(service.start(settings('h264-cpu')), { code: 'SYNTHETIC_CLOSED' });
  assert.deepEqual((await fs.readdir(service.directory)).filter(name => name.endsWith('.mkv')), []);
});
test('caller fixture swap after capture cannot redirect child reads', async () => {
  const folder = await fs.mkdtemp(path.join(parent, 'caller-fixture-'));
  const callerSource = path.join(folder, 'input.mkv'); await fs.copyFile(source, callerSource);
  const service = await createSyntheticService({ source: callerSource, parent });
  await fs.writeFile(callerSource, 'caller replaced the fixture after service capture');
  const result = await service.start(settings('h264-cpu'));
  assert.equal(result.published, true);
  assert.equal(await fs.readFile(callerSource, 'utf8'), 'caller replaced the fixture after service capture');
  await service.close();
});

})(require('node:module').createRequire(path.join(__dirname,'../synthetic-service.test.cjs')),path.resolve(__dirname,'..'));
