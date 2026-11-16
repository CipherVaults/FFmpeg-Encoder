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
