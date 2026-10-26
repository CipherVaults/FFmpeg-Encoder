'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { retainNativeInitialization, MAX_BYTES } = require('../src/native-initialization-evidence.cjs');
const report = () => ({ status: 'observed', initialization: { opaque: 'live-only' }, invocations: [{ status: 'closed', stderr: 'bounded observation' }] });
async function harness(options = {}) {
  const directory = path.resolve('artifacts/native-initialization-tests', randomUUID()); await fs.mkdir(directory, { recursive: true });
  const calls = [], reservation = { directory, id: randomUUID() };
  const store = { admit: async () => { calls.push('admit'); return reservation; }, assertReservation: async value => { assert.equal(value, reservation); calls.push('assert'); },
    observeGrowth: async () => { calls.push('growth'); }, finish: async (_value, { status }) => { calls.push(status); if (options.failFinish) throw new Error('unconfirmed finalization'); } };
  return { directory, store, calls };
}
test('initializer capture is exclusive, synced and read back without serializing its live authority', async () => {
  const h = await harness(), receipt = await retainNativeInitialization({ store: h.store, report: report() });
  const bytes = await fs.readFile(path.join(h.directory, 'native-initialization.json'));
  assert.equal(receipt.persisted, true); assert.equal(receipt.bytes, bytes.length);
  assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex')); assert.ok(!bytes.includes(Buffer.from('live-only')));
  assert.deepEqual(h.calls, ['admit', 'assert', 'assert', 'growth', 'completed']);
});
test('oversized and incomplete initializer reports get no storage reservation', async () => {
  const h = await harness();
  for (const invalid of [{ ...report(), status: 'preparing' },
    { ...report(), invocations: [] }, { ...report(), invocations: [{ stderr: 'x'.repeat(MAX_BYTES) }] }]) {
    await assert.rejects(retainNativeInitialization({ store: h.store, report: invalid }), { code: 'NATIVE_INITIALIZATION_NOT_RETAINED' });
  }
  assert.deepEqual(h.calls, []);
});
test('failed or cancelled initializer captures retain their outcome without serializing a bootstrap', async () => {
  const h = await harness(), failed = { ...report(), status: 'untested', reason: 'CANCELLED', failure: { code: 'CANCELLED' }, initialization: null };
  const receipt = await retainNativeInitialization({ store: h.store, report: failed }); assert.equal(receipt.persisted, true);
  const saved = JSON.parse(await fs.readFile(path.join(h.directory, 'native-initialization.json'), 'utf8'));
  assert.equal(saved.report.reason, 'CANCELLED'); assert.equal(saved.report.status, 'untested'); assert.equal(saved.report.initialization, undefined);
  assert.equal(h.calls.at(-1), 'completed');
});
test('existing evidence is preserved and a collision never grants persistence', async () => {
  const h = await harness(), file = path.join(h.directory, 'native-initialization.json'); await fs.writeFile(file, 'retained');
  await assert.rejects(retainNativeInitialization({ store: h.store, report: report() }), { code: 'NATIVE_INITIALIZATION_NOT_RETAINED' });
  assert.equal(await fs.readFile(file, 'utf8'), 'retained'); assert.equal(h.calls.at(-1), 'failed');
});
test('unconfirmed completed accounting is a failure and never rewritten as a different terminal status', async () => {
  const h = await harness({ failFinish: true });
  await assert.rejects(retainNativeInitialization({ store: h.store, report: report() }), { code: 'NATIVE_INITIALIZATION_NOT_RETAINED' });
  assert.equal(h.calls.filter(value => value === 'completed').length, 1); assert.ok(!h.calls.includes('failed'));
  assert.ok((await fs.stat(path.join(h.directory, 'native-initialization.json'))).size > 0);
});
