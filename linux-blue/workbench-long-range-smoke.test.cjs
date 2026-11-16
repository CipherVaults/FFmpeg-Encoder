'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSourceEvidence, selectCaseFolders } = require('./workbench-long-range-smoke.cjs');
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
