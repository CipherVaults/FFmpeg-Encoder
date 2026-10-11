const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc } = require('../src/ipc.cjs');
function harness(serviceOverrides = {}) {
  const handlers = new Map();
  const frame = { url: 'file:///app/ui/index.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  let starts = 0;
  registerIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) }, window,
    service: { snapshot: () => ({ phase: 'idle' }), startBatch: () => { starts++; return {}; }, ...serviceOverrides }, dialog: {}, entryUrl: frame.url });
  return { handlers, event, starts: () => starts };
}
test('foreign window, subframe and changed URL cannot invoke a privileged method', async () => {
  const { handlers, event, starts } = harness();
  for (const altered of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
    assert.equal((await handlers.get('encoder:start')(altered, {})).error.code, 'UNTRUSTED_SENDER');
  }
  event.senderFrame.url = 'https://example.invalid/';
  assert.equal((await handlers.get('encoder:start')(event, {})).error.code, 'UNTRUSTED_SENDER');
  assert.equal(starts(), 0);
});

test('draft processing methods retain sender and arity guards and forward only their one typed request', async () => {
  for (const [channel, method] of [['encoder:update-file-operations', 'updateFileOperations'],
    ['encoder:update-batch-operation-defaults', 'updateBatchOperationDefaults'], ['encoder:apply-app-defaults-to-batch', 'applyAppDefaultsToBatch'],
    ['encoder:reprepare-encoding-settings', 'reprepareEncodingSettings']]) {
    const calls = [];
    const { handlers, event } = harness({ [method]: async request => { calls.push(request); return { phase: 'ready', revision: 12 }; } });
    const handler = handlers.get(channel), request = { planId: 'main-plan', draftId: 'main-draft', revision: 2,
      ...(method === 'updateFileOperations' ? { fileIds: ['main-file'], overrides: { range: { startUs: 1234567 } } }
        : method === 'updateBatchOperationDefaults' ? { overrides: { resolution: '720' } }
          : method === 'reprepareEncodingSettings' ? { settings: { profileId: 'h265-cpu', preset: 'slow', quality: 26 } } : { resetFileOverrides: false }) };
    assert.equal((await handler({ ...event, sender: {} }, request)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await handler({ ...event, senderFrame: { url: event.senderFrame.url } }, request)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await handler(event)).error.code, 'INVALID_REQUEST');
    assert.equal((await handler(event, request, { args: ['-y'] })).error.code, 'INVALID_REQUEST');
    assert.deepEqual(calls, []);
    assert.deepEqual(await handler(event, request), { ok: true, value: { phase: 'ready', revision: 12 } });
    assert.deepEqual(calls, [request]);
  }
});

test('preload exposes named draft methods without generic IPC and preserves rejection codes', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(label, value) { assert.equal(label, 'encoder'); api = value; } },
      ipcRenderer: { invoke: async (channel, request) => { calls.push({ channel, request }); return request.revision === -1
        ? { ok: false, error: { code: 'STALE_DRAFT', message: 'Review the current draft.' } } : { ok: true, value: { revision: 4 } }; } }
    };
  } });
  assert.equal(Object.isFrozen(api), true); assert.equal(api.invoke, undefined); assert.equal(api.send, undefined);
  for (const [method, channel] of [['updateFileOperations', 'encoder:update-file-operations'],
    ['updateBatchOperationDefaults', 'encoder:update-batch-operation-defaults'], ['applyAppDefaultsToBatch', 'encoder:apply-app-defaults-to-batch'],
    ['reprepareEncodingSettings', 'encoder:reprepare-encoding-settings']]) {
    const request = { revision: 3 };
    assert.deepEqual(await api[method](request), { revision: 4 });
    assert.deepEqual(calls.at(-1), { channel, request });
    await assert.rejects(api[method]({ revision: -1 }), error => error.code === 'STALE_DRAFT' && /current draft/.test(error.message));
  }
});
test('snapshot rejects extra arguments and returns only explicit envelope', async () => {
  const { handlers, event } = harness();
  assert.equal((await handlers.get('encoder:snapshot')(event, 'injected')).error.code, 'INVALID_REQUEST');
  assert.deepEqual(await handlers.get('encoder:snapshot')(event), { ok: true, value: { phase: 'idle' } });
  assert.equal(handlers.has('encode-video'), false);
});

test('settings and runtime information keep exact argument counts and trusted-frame admission', async () => {
  const { handlers, event } = harness();
  for (const channel of ['encoder:app-settings', 'encoder:runtime-information']) {
    assert.equal((await handlers.get(channel)(event, { path: 'injected' })).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)({ ...event, senderFrame: { url: event.senderFrame.url } })).error.code, 'UNTRUSTED_SENDER');
  }
  for (const channel of ['encoder:save-app-settings', 'encoder:reset-app-settings', 'encoder:open-completed-output']) {
    assert.equal((await handlers.get(channel)(event)).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)(event, {}, {})).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)({ ...event, sender: {} }, {})).error.code, 'UNTRUSTED_SENDER');
  }
});
