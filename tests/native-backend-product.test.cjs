'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function harness(native = {}) {
  const calls = [];
  const owner = { snapshot: () => ({ fileExecutionReady: false }), invalidate: async () => { calls.push('invalidated'); }, ...native };
  const service = new EncoderService({ ffmpeg: 'injected', ffprobe: 'injected', stateDir: path.resolve('artifacts/native-product-tests/inert'), nativeBackends: owner });
  service.recordIncident = async event => { calls.push(event.reason); };
  return { service, calls, owner };
}
test('native discovery reserves the ordinary operation scheduler and does not masquerade as capability initialization', async () => {
  const held = deferred(), { service } = harness({ refresh: () => held.promise });
  const pending = service.refreshNativeBackends(); await tick();
  assert.equal(service.state.phase, 'native-checking'); assert.equal(service.busy, true);
  await assert.rejects(service.getCapabilities(), { code: 'BUSY' });
  await assert.rejects(service.refreshNativeBackends(), { code: 'BUSY' });
  assert.throws(() => service.selectNativeBackend({}), { code: 'BUSY' });
  held.resolve({ fileExecutionReady: false }); assert.equal((await pending).fileExecutionReady, false);
  assert.equal(service.state.phase, 'idle'); assert.equal(service.busy, false);
});
test('cancel and shutdown drain the same native owner before restoring the prior workflow', async () => {
  const held = deferred(); let observedSignal, slot;
  const { service, calls } = harness({ qualify: async (_request, { signal }) => {
    observedSignal = signal; slot = service.acquireNativeMediaSlot({ signal, purpose: 'native-backend-capability' });
    await held.promise; await slot.release(); return { fileExecutionReady: false };
  } });
  service.state.phase = 'completed'; service.state.items = [{ id: 'saved', status: 'success' }]; service.finishedAt = 77;
  const pending = service.qualifyNativeBackend({}); await tick();
  service.closeAdmission(); let drained = false; const cancel = service.cancelCurrent().then(() => { drained = true; });
  await tick(); assert.equal(observedSignal.aborted, true); assert.equal(drained, false); assert.equal(service.busy, true);
  assert.throws(() => service.requireIdle(), { code: 'SHUTTING_DOWN' });
  held.resolve(); await assert.rejects(pending, { code: 'CANCELLED' }); await cancel;
  assert.equal(service.nativeMediaSlot, null); assert.equal(service.state.phase, 'completed'); assert.equal(service.finishedAt, 77);
  assert.equal(service.state.items[0].id, 'saved'); assert.ok(calls.includes('invalidated'));
});
test('native slots refuse absent ownership, concurrency and acquisition after cancellation', async () => {
  const { service } = harness();
  const request = { signal: new AbortController().signal, purpose: 'native-backend-capability' };
  assert.throws(() => service.acquireNativeMediaSlot(request), { code: 'NATIVE_MEDIA_ADMISSION_REFUSED' });
  service.begin('native-checking'); const slot = service.acquireNativeMediaSlot(request);
  assert.throws(() => service.acquireNativeMediaSlot(request), { code: 'NATIVE_MEDIA_ADMISSION_REFUSED' });
  await slot.release(); await slot.release(); service.controller.abort();
  assert.throws(() => service.acquireNativeMediaSlot(request), { code: 'NATIVE_MEDIA_ADMISSION_REFUSED' });
});
test('an unconfirmed slot stays visibly busy and blocks ordinary work rather than reopening admission', async () => {
  const { service } = harness({ qualify: async () => {
    service.acquireNativeMediaSlot({ purpose: 'native-backend-capability' }); return {};
  } });
  await assert.rejects(service.qualifyNativeBackend({}), { code: 'NATIVE_OWNER_UNSETTLED' });
  assert.equal(service.busy, true); assert.equal(service.state.phase, 'native-checking');
  assert.throws(() => service.requireIdle(), { code: 'BUSY' });
});
test('native selection and snapshots never grant file execution or overwrite a prepared CPU plan', () => {
  let selections = 0; const { service } = harness({ select: () => { selections++; return { fileExecutionReady: false }; } });
  service.plan = { id: 'ordinary-plan' }; service.state.planId = 'ordinary-plan'; service.state.phase = 'ready';
  assert.equal(service.selectNativeBackend({}).fileExecutionReady, false); assert.equal(selections, 1);
  assert.equal(service.plan.id, 'ordinary-plan'); assert.equal(service.state.phase, 'ready');
});
