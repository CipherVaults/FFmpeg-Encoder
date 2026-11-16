'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoController } = require('./demo-controller.cjs');
const { registerDemoIpc } = require('./demo-ipc.cjs');
const settings = () => ({ profileId: 'h264-cpu', preset: 'slower', quality: 24 });
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  let resolve, reject, observer, calls = 0, cancels = 0, closes = 0;
  const job = new Promise((a, b) => { resolve = a; reject = b; });
  const c = await createDemoController({ source: '/main-owned-fixture', parent: '/main-owned-output', createService: async options => {
    observer = options.onProgress;
    return { start() { calls++; return job; }, async cancel() { cancels++; }, async close() { closes++; await job.catch(() => {}); } };
  } });
  return { c, resolve, reject, progress: value => observer(value), counts: () => ({ calls, cancels, closes }) };
}
test('start is exclusive; progress never becomes publication and snapshot is detached', async () => {
  const f = await fixture();
  assert.equal(f.c.start(settings()).phase, 'running');
  assert.throws(() => f.c.start(settings()), { code: 'DEMO_BUSY' });
  f.progress({ frame: 900, ended: true, privatePath: '/never-expose' });
  assert.equal(f.c.snapshot().frame, 12); assert.equal(f.c.snapshot().phase, 'validating');
  assert.equal(f.c.snapshot().publication, 'none');
  const snapshot = f.c.snapshot(); snapshot.phase = 'forged';
  f.resolve({ published: true, destination: '/private-output', cleanup: { reason: '/private-path' } }); await turn();
  assert.equal(f.c.snapshot().phase, 'completed');
  assert.deepEqual(Object.keys(f.c.snapshot()).sort(), ['errorCode', 'frame', 'inspection', 'jobId', 'phase', 'profileId', 'publication']);
  assert(!JSON.stringify(f.c.snapshot()).includes('/private'));
});
test('bad renderer settings cannot start a service job', async () => {
  const f = await fixture();
  for (const input of [{ ...settings(), input: '/tmp/x' }, { ...settings(), profileId: 'h264-nvidia' }]) assert.throws(() => f.c.start(input), { code: 'LINUX_UI_SETTINGS' });
  assert.equal(f.counts().calls, 0); assert.equal(f.c.snapshot().phase, 'idle');
});
test('cancel drains the active promise; success wins a late cancellation race', async () => {
  const f = await fixture(); f.c.start(settings());
  let finished = false; const cancellation = f.c.cancel().then(() => { finished = true; });
  await turn(); assert(!finished); assert.equal(f.c.snapshot().phase, 'cancelling');
  assert.throws(() => f.c.start(settings()), { code: 'DEMO_BUSY' });
  f.resolve({ published: true }); await cancellation;
  assert.equal(f.c.snapshot().phase, 'completed'); assert.equal(f.counts().cancels, 1);
});
test('cancelled jobs and raw errors are mapped without leaking messages or paths', async () => {
  for (const [failure, phase, code, publication] of [
    [{ code: 'CANCELLED' }, 'cancelled', 'CANCELLED', 'none'],
    [{ code: '/private-error', message: '/private-message' }, 'failed', 'JOB_FAILED', 'none'],
    [{ code: 'CLEANUP_FAILED', receipt: { published: true, destination: '/private' } }, 'published-warning', 'JOB_FAILED', 'published'],
    [{ code: 'PUBLICATION_UNCERTAIN', receipt: { published: null } }, 'uncertain', 'PUBLICATION_UNCERTAIN', 'uncertain']
  ]) {
    const f = await fixture(); f.c.start(settings()); f.reject(failure); await turn();
    assert.equal(f.c.snapshot().phase, phase); assert.equal(f.c.snapshot().errorCode, code); assert.equal(f.c.snapshot().publication, publication);
    assert(!JSON.stringify(f.c.snapshot()).includes('/private'));
  }
});
test('close shuts admission synchronously, drains once and is idempotent', async () => {
  const f = await fixture(); f.c.start(settings());
  let finished = false; const closing = f.c.close(); closing.then(() => { finished = true; });
  assert.equal(f.c.close(), closing);
  assert.throws(() => f.c.start(settings()), { code: 'DEMO_CLOSED' });
  await assert.rejects(f.c.cancel(), { code: 'DEMO_CLOSED' });
  await turn(); assert(!finished);
  f.reject({ code: 'CANCELLED' }); await closing;
  assert.equal(f.c.snapshot().phase, 'closed'); assert.equal(f.counts().closes, 1);
});
test('collision and no-job cancellation are explicit without output paths', async () => {
  const f = await fixture(); assert.equal((await f.c.cancel()).phase, 'idle');
  assert.equal(f.counts().cancels, 0);
  f.c.start(settings()); f.resolve({ published: false, destination: '/private', cleanup: { retained: true } }); await turn();
  assert.equal(f.c.snapshot().phase, 'collision'); assert.equal(f.c.snapshot().publication, 'collision');
});
function ipcFixture() {
  const handlers = new Map(); let destroyed = false, calls = 0;
  const frame = { url: 'file:///owned/demo.html' }, contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => destroyed };
  const controller = Object.fromEntries(['choices', 'snapshot', 'start', 'cancel', 'inspect'].map(name => [name, async () => { calls++; if (name === 'cancel') throw Object.assign(new Error('/private/system/error'), { code: 'OS_ERROR' }); return name; }]));
  const unregister = registerDemoIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) }, window, entryUrl: frame.url, controller });
  return { handlers, frame, contents, calls: () => calls, destroy: () => { destroyed = true; }, unregister, event: () => ({ sender: contents, senderFrame: frame }) };
}
test('IPC exposes exactly five methods and accepts only its main frame', async () => {
  const f = ipcFixture(); assert.equal(f.handlers.size, 5);
  assert.deepEqual(await f.handlers.get('linux-demo:start')(f.event(), settings()), { ok: true, value: 'start' });
  assert.equal(f.calls(), 1); f.unregister(); assert.equal(f.handlers.size, 0);
});
test('foreign contents, subframes, navigated URL and destroyed window cannot invoke any method', async () => {
  for (const mode of ['foreign', 'subframe', 'url', 'destroyed']) {
    const f = ipcFixture(); const event = f.event();
    if (mode === 'foreign') event.sender = {};
    if (mode === 'subframe') event.senderFrame = { url: f.frame.url };
    if (mode === 'url') f.frame.url += '?changed';
    if (mode === 'destroyed') f.destroy();
    for (const fn of f.handlers.values()) assert.equal((await fn(event, settings())).error.code, 'UNTRUSTED_SENDER');
    assert.equal(f.calls(), 0);
  }
});
test('IPC rejects surplus and missing arguments; raw service errors are not transmitted', async () => {
  const f = ipcFixture();
  for (const [name, args] of [['start', []], ['start', [settings(), 'extra']], ['state', ['extra']], ['cancel', ['extra']], ['choices', ['extra']], ['inspect', ['/renderer-path']]]) {
    assert.equal((await f.handlers.get(`linux-demo:${name}`)(f.event(), ...args)).error.code, 'INVALID_REQUEST');
  }
  assert.equal(f.calls(), 0);
  const result = await f.handlers.get('linux-demo:cancel')(f.event());
  assert.equal(result.error.code, 'DEMO_FAILED'); assert(!JSON.stringify(result).includes('/private'));
});
