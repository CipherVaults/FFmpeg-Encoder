'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoController } = require('./demo-controller.cjs');
const settings = { profileId: 'h264-cpu', preset: 'slower', quality: 24 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function setup() {
  const picker = deferred(), probe = deferred(), job = deferred();
  const calls = { selected: 0, inspected: 0, encoded: 0, closed: 0 }; let probeOptions, serviceOptions;
  const controller = await createDemoController({ source: '/known-synthetic-only', parent: '/private-output',
    createService: async options => { serviceOptions = options; return { start: () => { calls.encoded++; return job.promise; }, cancel: async () => {}, close: async () => { calls.closed++; } }; },
    selectSource: async () => { calls.selected++; return picker.promise; },
    inspectSource: async (source, options) => { assert.equal(source, '/selected-observation.mkv'); probeOptions = options; calls.inspected++; return probe.promise; } });
  return { controller, picker, probe, job, calls, probeOptions: () => probeOptions, serviceOptions: () => serviceOptions };
}
test('picker admission locks before awaiting; selected source never changes the synthetic encoder input', async () => {
  const f = await setup(); assert.equal(f.controller.inspect().inspection.phase, 'choosing');
  assert.throws(() => f.controller.inspect(), { code: 'DEMO_BUSY' }); assert.throws(() => f.controller.start(settings), { code: 'DEMO_BUSY' });
  assert.equal(f.calls.selected, 1); f.picker.resolve('/selected-observation.mkv'); await tick();
  assert.equal(f.controller.snapshot().inspection.phase, 'inspecting'); assert.throws(() => f.controller.start(settings), { code: 'DEMO_BUSY' });
  f.probe.resolve(Object.freeze({ encodeAllowed: false, bytes: 12, streams: Object.freeze([]) })); await tick();
  assert.equal(f.controller.snapshot().inspection.phase, 'ready'); assert.equal(f.controller.snapshot().inspection.busy, false);
  f.controller.start(settings); assert.equal(f.serviceOptions().source, '/known-synthetic-only'); assert.equal(f.calls.encoded, 1);
  f.job.resolve({ published: true }); await tick(); await f.controller.close();
});
test('active encode refuses inspection and never opens picker', async () => {
  const f = await setup(); f.controller.start(settings); assert.throws(() => f.controller.inspect(), { code: 'DEMO_BUSY' });
  assert.equal(f.calls.selected, 0); f.job.resolve({ published: true }); await tick(); await f.controller.close();
});
test('native picker cancellation clears stale observations and leaves no child', async () => {
  const f = await setup(); f.controller.inspect(); f.picker.resolve(null); await tick();
  assert.deepEqual(f.controller.snapshot().inspection, { phase: 'cancelled', report: null, errorCode: null, busy: false }); assert.equal(f.calls.inspected, 0);
  await f.controller.close();
});
test('cancel during picker keeps admission locked and ignores later selection', async () => {
  const f = await setup(); f.controller.inspect(); await f.controller.cancel(); assert.throws(() => f.controller.start(settings), { code: 'DEMO_BUSY' });
  f.picker.resolve('/selected-observation.mkv'); await tick(); assert.equal(f.calls.inspected, 0); assert.equal(f.controller.snapshot().inspection.phase, 'cancelled');
  await f.controller.close();
});
test('close does not wait on native picker and ignores its late selection', async () => {
  const f = await setup(); f.controller.inspect(); await f.controller.close(); assert.equal(f.controller.snapshot().phase, 'closed');
  assert.throws(() => f.controller.inspect(), { code: 'DEMO_CLOSED' }); f.picker.resolve('/selected-observation.mkv'); await tick();
  assert.equal(f.calls.inspected, 0); assert.equal(f.controller.snapshot().phase, 'closed');
});
test('cancel drains a launched probe before restart and discards even a late successful report', async () => {
  const f = await setup(); f.controller.inspect(); f.picker.resolve('/selected-observation.mkv'); await tick();
  let done = false; const cancellation = f.controller.cancel().then(() => { done = true; }); await tick();
  assert.equal(f.probeOptions().signal.aborted, true); assert.equal(done, false); assert.throws(() => f.controller.start(settings), { code: 'DEMO_BUSY' });
  f.probe.resolve({ encodeAllowed: false }); await cancellation; assert.equal(f.controller.snapshot().inspection.phase, 'cancelled');
  assert.equal(f.controller.snapshot().inspection.report, null); await f.controller.close();
});
test('close drains a launched probe once and raw errors are not rendered', async () => {
  const f = await setup(); f.controller.inspect(); f.picker.resolve('/selected-observation.mkv'); await tick();
  let done = false; const closing = f.controller.close(); closing.then(() => { done = true; }); assert.equal(f.controller.close(), closing); await tick();
  assert.equal(done, false); assert.equal(f.probeOptions().signal.aborted, true);
  f.probe.reject(new Error('/private/path')); await closing; assert.equal(f.calls.closed, 1); assert.equal(f.controller.snapshot().phase, 'closed');
  assert(!JSON.stringify(f.controller.snapshot()).includes('/private'));
});
test('inspection failure is bounded and later attempts can be made', async () => {
  const f = await setup(); f.controller.inspect(); f.picker.resolve('/selected-observation.mkv'); await tick();
  f.probe.reject(Object.assign(new Error('/private/path'), { code: '/private/error' })); await tick();
  assert.equal(f.controller.snapshot().inspection.errorCode, 'INSPECTION_FAILED'); assert.equal(f.controller.snapshot().inspection.busy, false);
  assert(!JSON.stringify(f.controller.snapshot()).includes('/private')); f.controller.inspect(); await tick(); await f.controller.close();
});
test('an aborted probe rejection has cancelled status without a spurious failure code', async () => {
  const f = await setup(); f.controller.inspect(); f.picker.resolve('/selected-observation.mkv'); await tick();
  const cancel = f.controller.cancel(); f.probe.reject(Object.assign(new Error('/private/path'), { code: 'CANCELLED' })); await cancel;
  assert.deepEqual(f.controller.snapshot().inspection, { phase: 'cancelled', report: null, errorCode: null, busy: false }); await f.controller.close();
});
