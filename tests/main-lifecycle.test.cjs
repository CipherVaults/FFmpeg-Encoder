'use strict';

// Exercise production main.js event ordering with a pending navigation and
// explicit process-drain promises. Native Electron evidence complements these
// deterministic races; no media, native dialogs or filesystem writes occur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function harness() {
  const load = deferred(), drained = deferred(), dialogClosed = deferred();
  const calls = []; let window, service;
  const app = new EventEmitter();
  Object.assign(app, { isReady: () => true, getAppPath: () => 'test-root', setPath() {}, requestSingleInstanceLock: () => true,
    commandLine: { hasSwitch: () => false }, whenReady: () => Promise.resolve(),
    quit: () => calls.push('quit'), exit: code => calls.push(['exit', code]) });
  class Service extends EventEmitter {
    constructor() { super(); service = this; this.busy = false; }
    async initializeDiagnostics() {}
    cancelCurrent() { calls.push('cancel'); return drained.promise; }
    async recordIncident(event) { calls.push(event.reason); }
    async closeDiagnostics(outcome) { calls.push(['closed', outcome]); }
  }
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, isDestroyed: () => false }); }
    isDestroyed() { return this.destroyed; }
    loadURL() { return load.promise; }
    destroy() { this.destroyed = true; dialogClosed.resolve(); this.emit('closed'); }
    close() { this.destroy(); }
  }
  const appSession = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, protocol: {}, webRequest: { onBeforeRequest() {} } };
  vm.runInNewContext(source, { console, require(id) {
    if (id === 'electron') return { app, BrowserWindow: Window, ipcMain: {}, session: { fromPartition: () => appSession }, protocol: { registerSchemesAsPrivileged() {} },
      dialog: { showErrorBox() { calls.push('blocking-dialog'); }, showMessageBox() { calls.push('async-dialog'); return dialogClosed.promise; } } };
    if (id === 'node:fs') return { mkdirSync() {} };
    if (id === 'node:path') return path;
    if (id === './src/encoder-service.cjs') return { EncoderService: Service };
    if (id === './src/ipc.cjs') return { registerIpc: () => () => calls.push('remove-ipc') };
    if (id === './src/local-protocol.cjs') return { ENTRY_URL: 'app://encoder/index.html', resolveAsset() {}, registerLocalProtocol() {} };
    throw new Error('Unexpected dependency: ' + id);
  } }, { filename: 'main.js' });
  await tick();
  return { app, load, drained, dialogClosed, calls, window, service };
}

test('load rejection followed by renderer loss drains before failed exit without a blocking dialog', async () => {
  const h = await harness();
  h.load.reject(new Error("ERR_FAILED (-2) loading 'app://encoder/index.html'")); await tick();
  assert.deepEqual(h.calls, ['cancel']);
  h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }); await tick();
  assert.ok(h.calls.includes('RENDERER_GONE'));
  assert.ok(!h.calls.some(x => Array.isArray(x) && x[0] === 'exit'));
  h.drained.resolve(); await tick(); await tick();
  assert.ok(h.calls.includes('STARTUP_FAILED'));
  assert.ok(!h.calls.includes('blocking-dialog'));
  assert.ok(!h.calls.includes('async-dialog'));
  assert.equal(h.calls.filter(x => Array.isArray(x) && x[0] === 'closed').length, 1);
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
});

test('genuine startup failure remains visible asynchronously after owned work drains', async () => {
  const h = await harness(); h.load.reject(new Error('asset unavailable')); await tick();
  assert.deepEqual(h.calls, ['cancel']);
  h.drained.resolve(); await tick();
  assert.ok(h.calls.includes('async-dialog')); assert.ok(!h.calls.includes('blocking-dialog'));
  assert.ok(!h.calls.some(x => Array.isArray(x) && x[0] === 'exit'));
  h.dialogClosed.resolve(); await tick(); await tick();
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
  assert.ok(h.calls.some(x => Array.isArray(x) && x[0] === 'closed' && x[1] === 'failed'));
});

test('renderer loss closes an already-open startup error dialog through its parent', async () => {
  const h = await harness(); h.drained.resolve(); h.load.reject(new Error('navigation failed')); await tick();
  assert.ok(h.calls.includes('async-dialog'));
  h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }); await tick(); await tick();
  assert.equal(h.window.isDestroyed(), true);
  assert.equal(h.calls.filter(x => Array.isArray(x) && x[0] === 'closed').length, 1);
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
});
