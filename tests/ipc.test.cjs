const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc } = require('../src/ipc.cjs');
function harness(serviceOverrides = {}, appearance = { load() {}, set() {} }) {
  const handlers = new Map();
  const frame = { url: 'file:///app/ui/index.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  let starts = 0;
  const unregister = registerIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) }, window,
    service: { snapshot: () => ({ phase: 'idle' }), startBatch: () => { starts++; return {}; }, ...serviceOverrides }, appearance, dialog: {}, entryUrl: frame.url });
  return { handlers, event, window, unregister, starts: () => starts };
}

test('native channels retain sender and arity checks, with no path or generic invocation bridge', async () => {
  const calls = [], h = harness({ getNativeBackendState: () => ({ fileExecutionReady: false }),
    refreshNativeBackends: () => { calls.push('refresh'); return {}; },
    selectNativeBackend: request => { calls.push(request); return {}; }, qualifyNativeBackend: request => { calls.push(request); return {}; } });
  for (const [channel, args] of [['encoder:native-state', []], ['encoder:native-refresh', []],
    ['encoder:native-select', [{ revision: 1 }]], ['encoder:native-qualify', [{ selectionId: 'opaque', revision: 2 }]]]) {
    const invoke = h.handlers.get(channel);
    assert.equal((await invoke({ ...h.event, sender: {} }, ...args)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await invoke(h.event, ...args, 'extra')).error.code, 'INVALID_REQUEST');
    assert.equal((await invoke(h.event, ...args)).ok, true);
  }
  assert.equal(calls.length, 3); assert.ok(!h.handlers.has('encoder:native-run'));
});
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
    ['encoder:reprepare-encoding-settings', 'reprepareEncodingSettings'], ['encoder:prepare-remux', 'prepareRemuxBatch'],
    ['encoder:remux-omissions', 'setRemuxOmissions'], ['encoder:encode-preservation-decisions', 'setEncodePreservationDecisions']]) {
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
    ['reprepareEncodingSettings', 'encoder:reprepare-encoding-settings'], ['setEncodePreservationDecisions', 'encoder:encode-preservation-decisions']]) {
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

test('appearance channels retain exact trusted-frame and argument guards without media service authority', async () => {
  const calls = [], incidents = [];
  const appearance = { load: async () => { calls.push('load'); return { theme: 'dark' }; },
    set: async request => { calls.push(request); return { theme: request.theme }; } };
  const { handlers, event, window, unregister, starts } = harness({ recordIncident: async incident => incidents.push(incident) }, appearance);
  for (const [channel, args] of [['encoder:appearance', []], ['encoder:save-appearance', [{ theme: 'light' }]]]) {
    const handle = handlers.get(channel);
    for (const altered of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
      assert.equal((await handle(altered, ...args)).error.code, 'UNTRUSTED_SENDER');
    }
    assert.equal((await handle(event, ...args, {})).error.code, 'INVALID_REQUEST');
  }
  assert.equal((await handlers.get('encoder:save-appearance')(event)).error.code, 'INVALID_REQUEST');
  assert.deepEqual(calls, []); assert.equal(starts(), 0);
  assert.equal(incidents.length, 3); assert.ok(incidents.every(incident => incident.context.code === 'INVALID_REQUEST'));
  assert.deepEqual(await handlers.get('encoder:appearance')(event), { ok: true, value: { theme: 'dark' } });
  const request = { theme: 'light' };
  assert.deepEqual(await handlers.get('encoder:save-appearance')(event, request), { ok: true, value: { theme: 'light' } });
  assert.deepEqual(calls, ['load', request]);
  event.senderFrame.url = 'https://example.invalid/';
  assert.equal((await handlers.get('encoder:appearance')(event)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('encoder:save-appearance')(event, request)).error.code, 'UNTRUSTED_SENDER');
  assert.deepEqual(calls, ['load', request]);
  event.senderFrame.url = 'file:///app/ui/index.html'; window.isDestroyed = () => true;
  assert.equal((await handlers.get('encoder:appearance')(event)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('encoder:save-appearance')(event, request)).error.code, 'UNTRUSTED_SENDER');
  assert.deepEqual(calls, ['load', request]); unregister(); assert.equal(handlers.size, 0);
});

test('actual appearance store rejects invalid IPC DTOs before writes and persists only the strict theme', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
  const { AppearanceSettings } = require('../src/appearance.cjs');
  const directory = path.resolve(__dirname, '../artifacts/v0.7/icon-themes/ipc-fixture-' + randomUUID());
  const appearance = new AppearanceSettings({ directory });
  const { handlers, event, starts } = harness({}, appearance), save = handlers.get('encoder:save-appearance');
  let getters = 0;
  for (const value of [null, [], {}, { theme: 'system' }, { theme: 'LIGHT' }, { theme: 1 },
    { theme: 'light', path: 'untrusted' }, { theme: 'light', profileId: 'h265-cpu' },
    Object.defineProperty({}, 'theme', { enumerable: true, get() { getters++; return 'light'; } })]) {
    assert.equal((await save(event, value)).error.code, 'INVALID_APPEARANCE');
  }
  assert.equal(getters, 0); assert.equal(starts(), 0);
  await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  const result = await save(event, { theme: 'light' });
  assert.equal(result.ok, true); assert.equal(result.value.theme, 'light'); assert.equal(result.value.persistence.persisted, true);
  const record = JSON.parse(await fs.readFile(appearance.filename, 'utf8'));
  assert.deepEqual(record, { namespace: 'appearance-v1', schema: 1, theme: 'light' });
  const restarted = new AppearanceSettings({ directory });
  assert.equal((await restarted.load()).theme, 'light');
  t.diagnostic('Retained isolated appearance IPC fixture: ' + directory);
});

test('preload exposes only named appearance capabilities and preserves store failure codes', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(label, value) { assert.equal(label, 'encoder'); api = value; } },
      ipcRenderer: { invoke: async (channel, ...args) => { calls.push({ channel, args });
        return channel === 'encoder:save-appearance'
          ? { ok: false, error: { code: 'APPEARANCE_WRITE_UNCERTAIN', message: 'Saved bytes could not be confirmed.' } }
          : { ok: true, value: { schema: 1, theme: 'dark' } }; } },
    };
  } });
  assert.equal(Object.isFrozen(api), true); assert.equal(api.invoke, undefined); assert.equal(api.send, undefined);
  assert.deepEqual(await api.getAppearance(), { schema: 1, theme: 'dark' });
  assert.equal(calls[0].channel, 'encoder:appearance'); assert.equal(calls[0].args.length, 0);
  const request = { theme: 'light' };
  await assert.rejects(api.saveAppearance(request), error => error.code === 'APPEARANCE_WRITE_UNCERTAIN' && /confirmed/.test(error.message));
  assert.equal(calls[1].channel, 'encoder:save-appearance'); assert.equal(calls[1].args.length, 1);
  assert.equal(calls[1].args[0], request);
});

test('actual appearance IPC overload and close refuse more writes while accepted saves drain durably', async t => {
  const path = require('node:path'), { randomUUID } = require('node:crypto');
  const { AppearanceSettings, MAX_PENDING_APPEARANCE_WRITES } = require('../src/appearance.cjs');
  const directory = path.resolve(__dirname, '../artifacts/v0.7/icon-themes/ipc-drain-' + randomUUID());
  const appearance = new AppearanceSettings({ directory });
  const { handlers, event, starts } = harness({}, appearance), save = handlers.get('encoder:save-appearance');
  assert.equal(MAX_PENDING_APPEARANCE_WRITES, 8);
  // Invoke without awaiting: these are simultaneously accepted IPC calls,
  // including the operation whose first filesystem step has not run yet.
  const accepted = Array.from({ length: MAX_PENDING_APPEARANCE_WRITES }, (_, index) => save(event, { theme: index % 2 ? 'light' : 'dark' }));
  const overloaded = save(event, { theme: 'dark' });
  appearance.closeAdmission(); appearance.closeAdmission();
  const closed = save(event, { theme: 'dark' });
  assert.equal((await overloaded).error.code, 'APPEARANCE_BUSY');
  assert.equal((await closed).error.code, 'APPEARANCE_CLOSED');
  const drained = appearance.flush();
  assert.ok((await Promise.all(accepted)).every(result => result.ok && result.value.persistence.persisted));
  assert.equal((await drained).theme, 'light');
  assert.equal((await new AppearanceSettings({ directory }).load()).theme, 'light');
  assert.equal(starts(), 0);
  t.diagnostic('Retained bounded appearance IPC drain fixture: ' + directory);
});
