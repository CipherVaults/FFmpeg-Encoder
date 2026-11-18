const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { registerIpc } = require('../src/ipc.cjs');
function fixture(options = {}) {
  const handlers = new Map(), frame = { url: 'file:///app/ui/index.html' };
  const window = { webContents: { mainFrame: frame }, isDestroyed: () => false };
  const event = { sender: window.webContents, senderFrame: frame };
  const unregister = registerIpc({ ipcMain: { handle: (c, f) => handlers.set(c, f), removeHandler: c => handlers.delete(c) },
    window, entryUrl: frame.url, service: options.service || {}, appearance: {}, dialog: {}, workbenchSession: options.session });
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_, value) => { api = value; } },
      ipcRenderer: { invoke: async (c, ...args) => { assert.ok(handlers.has(c), `No handler registered for ${c}`); return handlers.get(c)(event, ...args); } } };
  }});
  return { handlers, frame, window, event, unregister, api };
}
test('actual preload default status resolves disabled without exposing selection', async () => {
  const h = fixture();
  assert.deepEqual(await h.api.getWorkbenchSession(), { enabled: false });
  assert.equal(h.handlers.has('encoder:select-workbench-session'), false);
  const state = await h.api.getWorkbenchSession(); state.enabled = true;
  assert.deepEqual(await h.api.getWorkbenchSession(), { enabled: false });
});
test('default status retains sender frame URL arity and retirement fences', async () => {
  const h = fixture(), invoke = h.handlers.get('encoder:workbench-session');
  assert.equal(typeof invoke, 'function');
  for (const event of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: h.frame.url } }])
    assert.equal((await invoke(event)).error.code, 'UNTRUSTED_SENDER');
  const original = h.frame.url; h.frame.url = 'https://example.invalid/';
  assert.equal((await invoke(h.event)).error.code, 'UNTRUSTED_SENDER'); h.frame.url = original;
  assert.equal((await invoke(h.event, 'extra')).error.code, 'INVALID_REQUEST');
  h.unregister.closeAdmission(); assert.equal((await invoke(h.event)).error.code, 'SHUTTING_DOWN');
  await h.unregister.whenIdle(); h.unregister();
  assert.equal(h.handlers.has('encoder:workbench-session'), false);
  assert.equal((await invoke(h.event)).error.code, 'SESSION_RETIRED');
});
test('default rejected status diagnostics drain before retirement with no late diagnostics', async () => {
  let release, entered, calls = 0;
  const started = new Promise(r => entered = r), held = new Promise(r => release = r);
  const h = fixture({ service: { recordIncident: async () => { calls++; entered(); await held; } } });
  const invoke = h.handlers.get('encoder:workbench-session'); assert.equal(typeof invoke, 'function');
  const request = invoke(h.event, 'extra'); await started;
  h.unregister.closeAdmission(); let drained = false;
  const drain = h.unregister.whenIdle().then(() => drained = true);
  await Promise.resolve(); assert.equal(drained, false);
  assert.equal((await invoke(h.event)).error.code, 'SHUTTING_DOWN'); assert.equal(calls, 1);
  release(); assert.equal((await request).error.code, 'INVALID_REQUEST'); await drain;
  assert.equal(drained, true); h.unregister();
});
test('opt-in status and selection retain original dispatch and blocked behavior', async () => {
  let blocked = false; const selections = [];
  const h = fixture({ session: { status: () => ({ enabled: true, selected: 'ordinary' }), blocked: () => blocked,
    select: kind => { selections.push(kind); return { selected: kind }; } } });
  assert.deepEqual(await h.api.getWorkbenchSession(), { enabled: true, selected: 'ordinary' });
  assert.deepEqual(await h.api.selectWorkbenchSession('full-copy'), { selected: 'full-copy' });
  assert.deepEqual(selections, ['full-copy']); blocked = true;
  assert.equal((await h.handlers.get('encoder:select-workbench-session')(h.event, 'ordinary')).error.code, 'BUSY');
  assert.equal((await h.api.getWorkbenchSession()).enabled, true);
});
