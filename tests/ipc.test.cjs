const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc } = require('../src/ipc.cjs');
function harness() {
  const handlers = new Map();
  const frame = { url: 'file:///app/ui/index.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  let starts = 0;
  registerIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) }, window,
    service: { snapshot: () => ({ phase: 'idle' }), startBatch: () => { starts++; return {}; } }, dialog: {}, entryUrl: frame.url });
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
