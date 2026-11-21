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
const { registerIpc } = require('../src/ipc.cjs');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function harness({ runtimePending = false, diagnosticsPending = false, resourcesPending = false,
  appearancePending = false, appearanceFlushPending = false, initialTheme = 'dark', initialPersistence = 'saved', diagnosticCloseResult = { persisted: true }, diagnosticCloseError = null,
  nativeFileComposition = 'production' } = {}) {
  const load = deferred(), drained = deferred(), dialogClosed = deferred();
  const closeChoice = deferred();
  const initialized = deferred(); if (!diagnosticsPending) initialized.resolve();
  const resources = deferred(); if (!resourcesPending) resources.resolve();
  const runtime = deferred();
  const appearanceReady = deferred(), appearanceFlushed = deferred(), appearanceWrites = [], nativeChanges = [], backgroundChanges = [], appearanceOrder = [];
  const appearanceSnapshot = theme => ({ schema: 1, theme, persistence: { state: initialPersistence, persisted: initialPersistence === 'saved' }, notices: [] });
  if (!appearancePending) appearanceReady.resolve(appearanceSnapshot(initialTheme));
  if (!appearanceFlushPending) appearanceFlushed.resolve();
  const verified = { ffmpeg: 'verified/ffmpeg.exe', ffprobe: 'verified/ffprobe.exe',
    verified: [{ sizeBytes: 1, sha256: 'a'.repeat(64) }, { sizeBytes: 2, sha256: 'b'.repeat(64) }] };
  if (!runtimePending) runtime.resolve(verified);
  const ipcHandlers = new Map();
  const ipcMain = { handle: (name, fn) => ipcHandlers.set(name, fn), removeHandler: name => ipcHandlers.delete(name) };
  const calls = []; let window, service, controlOptions, nativeControlOptions, ipcOptions, appearanceOptions, appearanceClosed = false;
  const nativeFileControls = Object.freeze({ policyCount: 0 }), nativeFileCalls = [], incidents = []; let nativeFileOptions;
  const qualification = Object.freeze({});
  const app = new EventEmitter();
  Object.assign(app, { isReady: () => true, getAppPath: () => 'test-root', setPath() {}, requestSingleInstanceLock: () => true,
    commandLine: { hasSwitch: () => false }, whenReady: () => Promise.resolve(),
    quit: () => calls.push('quit'), exit: code => calls.push(['exit', code]) });
  class Service extends EventEmitter {
    constructor(options) { super(); service = this; this.busy = false; this.options = options; }
    initializeDiagnostics() { return initialized.promise; }
    closeAdmission() { this.admissionClosed = true; calls.push('close-admission'); }
    requireIdle() { if (this.admissionClosed) throw Object.assign(new Error('Application is closing'), { code: 'SHUTTING_DOWN' }); }
    cancelCurrent() { calls.push('cancel'); return drained.promise; }
    closeOperationResources() { calls.push('close-operation-resources'); return resources.promise; }
    async recordIncident(event) { calls.push(event.reason); incidents.push(event); }
    async closeDiagnostics(outcome) { calls.push(['closed', outcome]); if (diagnosticCloseError) throw diagnosticCloseError; return diagnosticCloseResult; }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); appearanceOrder.push('window'); window = this; this.options = options; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: 'app://encoder/index.html' }, setWindowOpenHandler() {}, isDestroyed: () => false }); }
    isDestroyed() { return this.destroyed; }
    loadURL() { appearanceOrder.push('navigation'); return load.promise; }
    destroy() { this.destroyed = true; dialogClosed.resolve(); this.emit('closed'); }
    close() { let prevented = false; this.emit('close', { preventDefault() { prevented = true; } }); if (!prevented) this.destroy(); }
    setBackgroundColor(color) { assert.equal(this.destroyed, false); backgroundChanges.push(color); }
  }
  class Appearance {
    constructor(options) { appearanceOptions = options; }
    load() { return appearanceReady.promise; }
    set(request) {
      if (appearanceClosed) throw Object.assign(new Error('Appearance admission closed'), { code: 'APPEARANCE_CLOSED' });
      if (!request || Object.keys(request).length !== 1 || !['light', 'dark'].includes(request.theme)) {
        throw Object.assign(new Error('Invalid theme'), { code: 'INVALID_APPEARANCE' });
      }
      const write = deferred(); appearanceWrites.push({ request, ...write }); return write.promise;
    }
    closeAdmission() { if (!appearanceClosed) appearanceOrder.push('close-admission'); appearanceClosed = true; }
    async flush() { calls.push('flush-appearance'); await Promise.allSettled(appearanceWrites.map(write => write.promise)); await appearanceFlushed.promise; }
  }
  const nativeTheme = { set themeSource(theme) { nativeChanges.push(theme); appearanceOrder.push('native:' + theme); } };
  const appSession = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, protocol: {}, webRequest: { onBeforeRequest() {} } };
  vm.runInNewContext(source, { console, process: { platform: 'win32', arch: 'x64', resourcesPath: 'resources' }, require(id) {
    if (id === 'electron') return { app, BrowserWindow: Window, nativeTheme, ipcMain, session: { fromPartition: () => appSession }, protocol: { registerSchemesAsPrivileged() {} },
      dialog: { showErrorBox() { calls.push('blocking-dialog'); }, showMessageBox(...args) {
        const options = args.at(-1);
        if (options.buttons?.[0] === 'Keep application open') { calls.push('busy-dialog'); return closeChoice.promise; }
        calls.push('async-dialog'); return dialogClosed.promise;
      } } };
    if (id === 'node:fs') return { mkdirSync() {} };
    if (id === 'node:path') return path;
    if (id === 'node:crypto') return require('node:crypto');
    if (id === './src/regular-windows-runtime.cjs') return { verifyRegularWindowsRuntime: () => runtime.promise };
    if (id === './src/operation-controls.cjs') return { createOperationControls: options => {
      controlOptions = options; return { operationQualifications: qualification, operationTelemetry: true };
    } };
    if (id === './src/native-backend-controls.cjs') return { createNativeBackendControls: options => {
      nativeControlOptions = options;
      const registry = new (require('../src/backend-capabilities.cjs').NativeCapabilityRegistry)();
      return { nativeBackends: { fixture: true }, discoverBackends: async request => ({ ...request, registry, ffmpeg: options.runtime.ffmpeg }) };
    } };
    if (id === './src/native-file-controls.cjs') return { nativeRefusal: require('../src/native-file-controls.cjs').nativeRefusal,
      createNativeFileControls: options => {
        nativeFileOptions = options; nativeFileCalls.push('compose');
        if (nativeFileComposition === 'fails') throw Object.assign(new Error('zq-private C:\\state is not ordinary'), { code: 'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE', cause: { code: 'EPERM' } });
        if (nativeFileComposition === 'defect') throw Object.assign(new Error('Native file controls accept only their fixed main-owned fields.'), { code: 'INVALID_NATIVE_FILE_COMPOSITION' });
        return nativeFileControls;
      },
      assertProductionNativeFileControls: value => {
        nativeFileCalls.push(['assert', value]);
        if (nativeFileComposition === 'injected') throw Object.assign(new Error('Only the production native file controls with an empty catalog may start.'), { code: 'INVALID_NATIVE_FILE_COMPOSITION' });
        return value;
      } };
    if (id === './src/vendor-capabilities.cjs') return { checkVendorCapabilities: require('../src/vendor-capabilities.cjs').checkVendorCapabilities };
    if (id === './src/encoder-service.cjs') return { EncoderService: Service };
    if (id === './src/output-access.cjs') return require('../src/output-access.cjs');
    if (id === './src/appearance.cjs') return { AppearanceSettings: Appearance };
    if (id === './src/ipc.cjs') return { registerIpc: options => { ipcOptions = options; return registerIpc(options); } };
    if (id === './src/local-protocol.cjs') return { ENTRY_URL: 'app://encoder/index.html', resolveAsset() {}, registerLocalProtocol() {} };
    throw new Error('Unexpected dependency: ' + id);
  } }, { filename: 'main.js' });
  await tick();
  // Capture the genuine registered handler and its trusted sender before close.
  const channel = name => {
    const invoke = ipcHandlers.get('encoder:' + name);
    assert.equal(typeof invoke, 'function');
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    return (...args) => invoke(event, ...args);
  };
  return { app, channel, load, drained, dialogClosed, closeChoice, calls, window, service, runtime, verified, initialized, resources,
    appearanceReady, appearanceFlushed, appearanceWrites, appearanceSnapshot, nativeChanges, backgroundChanges, appearanceOrder,
    getWindow: () => window, getService: () => service, getControlOptions: () => controlOptions,
    getIpcOptions: () => ipcOptions, getNativeControlOptions: () => nativeControlOptions,
    getAppearanceOptions: () => appearanceOptions, isAppearanceClosed: () => appearanceClosed, qualification,
    nativeFileControls, nativeFileCalls, incidents, getNativeFileOptions: () => nativeFileOptions };
}

test('main reuses one private native registry across discovery observations', async () => {
  const h = await harness(), options = { signal: new AbortController().signal, run() {}, versions: { ffmpeg: 'fixture', ffprobe: 'fixture' } };
  const first = await h.service.options.discoverBackends(options), second = await h.service.options.discoverBackends(options);
  assert.ok(first.registry instanceof require('../src/backend-capabilities.cjs').NativeCapabilityRegistry);
  assert.equal(first.registry, second.registry);
  assert.equal(first.ffmpeg, h.verified.ffmpeg);
  assert.equal(h.service.options.vendorCapabilities, require('../src/vendor-capabilities.cjs').checkVendorCapabilities);
});

test('shutdown drains children then operation handles/lease before diagnostic closure and exit', async () => {
  const h = await harness({ resourcesPending: true }); h.window.destroy(); await tick();
  assert.ok(h.calls.indexOf('close-admission') < h.calls.indexOf('cancel'));
  assert.ok(h.calls.includes('cancel')); assert.ok(!h.calls.includes('close-operation-resources'));
  h.drained.resolve(); await tick(); assert.ok(h.calls.includes('close-operation-resources'));
  assert.ok(!h.calls.some(value => Array.isArray(value) && value[0] === 'closed')); assert.ok(!h.calls.includes('quit'));
  h.resources.resolve(); await tick(); await tick();
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed')); assert.equal(h.calls.at(-1), 'quit');
});

test('unconfirmed terminal journal write drains resources and exits with an incomplete-history status', async () => {
  const h = await harness({ diagnosticCloseResult: { persisted: false } });
  h.window.destroy(); h.drained.resolve(); await tick(); await tick();
  assert.ok(h.calls.indexOf('close-operation-resources') < h.calls.findIndex(value => Array.isArray(value) && value[0] === 'closed'));
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
  assert.equal(h.calls.includes('quit'), false);
  assert.equal(h.calls.filter(value => Array.isArray(value) && value[0] === 'closed').length, 1);
});

test('rejected terminal journal initialization or write also signals incomplete shutdown after drainage', async () => {
  const h = await harness({ diagnosticCloseError: new Error('Owned journal storage unavailable') });
  h.window.destroy(); h.drained.resolve(); await tick(); await tick();
  assert.ok(h.calls.includes('close-operation-resources'));
  assert.deepEqual(h.calls.at(-1), ['exit', 1]); assert.equal(h.calls.includes('quit'), false);
});

test('resource closure failure still flushes failed diagnostics before shutdown completes', async () => {
  const h = await harness({ resourcesPending: true }); h.window.destroy(); h.drained.resolve(); await tick();
  h.resources.reject(new Error('Owned evidence lease close failed')); await tick(); await tick();
  assert.ok(h.calls.includes('OPERATION_RESOURCES_CLOSE_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'failed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('rejected drainage still attempts operation closure and failed diagnostic flush', async () => {
  const h = await harness({ resourcesPending: true }); h.window.destroy(); await tick();
  h.drained.reject(new Error('Queue drainage failed')); await tick();
  assert.ok(h.calls.includes('close-operation-resources'));
  assert.ok(!h.calls.some(value => Array.isArray(value) && value[0] === 'closed'));
  h.resources.reject(new Error('Lease closure also failed')); await tick(); await tick();
  assert.ok(h.calls.includes('OPERATION_DRAIN_FAILED'));
  assert.ok(h.calls.includes('OPERATION_RESOURCES_CLOSE_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'failed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('candidate runtime verification precedes any window, service or process authority', async () => {
  const h = await harness({ runtimePending: true });
  assert.equal(h.getWindow(), undefined); assert.equal(h.getService(), undefined);
  h.runtime.resolve(h.verified); await tick();
  assert.equal(h.getService().options.ffmpeg, h.verified.ffmpeg);
  assert.equal(h.getService().options.ffprobe, h.verified.ffprobe);
  assert.match(h.getService().options.runtimeIdentity, /^[a-f0-9]{64}$/);
  assert.equal(h.getControlOptions().runtime, h.verified);
  assert.deepEqual(Object.keys(h.getControlOptions()).sort(), ['runtime', 'stateDir']);
  assert.equal(h.getService().options.operationQualifications, h.qualification); assert.equal(h.getService().options.operationTelemetry, true);
  const discovery = await h.getService().options.discoverBackends({ versions: { ffmpeg: 'ffmpeg version test', ffprobe: 'ffprobe version test' } });
  assert.equal(discovery.ffmpeg, h.verified.ffmpeg);
  assert.equal(h.getNativeControlOptions().runtime, h.verified);
  assert.equal(typeof h.getNativeControlOptions().acquireMediaSlot, 'function');
  assert.equal(typeof h.getNativeControlOptions().retainInitialization, 'function');
  assert.ok(h.getWindow());
});

test('quit while runtime verification is pending never creates a late window or service', async () => {
  const h = await harness({ runtimePending: true }); h.app.emit('before-quit', {});
  h.runtime.resolve(h.verified); await tick();
  assert.equal(h.getWindow(), undefined); assert.equal(h.getService(), undefined);
  assert.ok(!h.calls.includes('async-dialog'));
});

test('runtime verification failure cannot reach IPC or children and remains an explicit startup error', async () => {
  const h = await harness({ runtimePending: true }); h.runtime.reject(new Error('Runtime SHA-256 mismatch'));
  await tick(); assert.equal(h.getWindow(), undefined); assert.equal(h.getService(), undefined);
  assert.ok(h.calls.includes('async-dialog'));
  h.dialogClosed.resolve(); await tick(); await tick();
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
});

test('quit after service construction but before diagnostics readiness drains without creating a late window', async () => {
  const h = await harness({ diagnosticsPending: true });
  assert.ok(h.getService()); assert.equal(h.getWindow(), undefined);
  let prevented = false; h.app.emit('before-quit', { preventDefault() { prevented = true; } }); await tick();
  assert.equal(prevented, true); assert.ok(h.calls.includes('cancel'));
  h.initialized.resolve(); await tick(); assert.equal(h.getWindow(), undefined);
  h.drained.resolve(); await tick(); await tick();
  assert.equal(h.calls.at(-1), 'quit');
  assert.equal(h.calls.filter(x => Array.isArray(x) && x[0] === 'closed').length, 1);
});

test('load rejection followed by renderer loss drains before failed exit without a blocking dialog', async () => {
  const h = await harness();
  h.load.reject(new Error("ERR_FAILED (-2) loading 'app://encoder/index.html'")); await tick();
  assert.deepEqual(h.calls, ['close-admission', 'cancel']);
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
  const h = await harness(), read = h.channel('snapshot'); h.service.snapshot = () => 'open';
  h.load.reject(new Error('asset unavailable')); await tick();
  assert.deepEqual(h.calls, ['close-admission', 'cancel']);
  assert.equal((await read()).error?.code, 'SHUTTING_DOWN');
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

for (const [theme, background] of [['dark', '#101318'], ['light', '#f7f7f4']]) {
  test(`saved ${theme} appearance sets native chrome and first-window background before navigation`, async () => {
    const h = await harness({ initialTheme: theme });
    assert.deepEqual(h.nativeChanges, [theme]);
    assert.deepEqual(h.appearanceOrder, ['native:' + theme, 'window', 'navigation']);
    assert.equal(h.window.options.backgroundColor, background);
    assert.equal(h.window.options.icon, path.join('test-root', 'assets', 'app-icon', 'app-icon.ico'));
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'assets', 'app-icon', 'app-icon.ico')), true);
    assert.equal(h.getAppearanceOptions().directory, path.join('test-root', 'data-next-0.7'));
    assert.equal(h.window.options.webPreferences.session !== undefined, true);
    assert.equal(h.window.options.webPreferences.nodeIntegration, false);
    assert.equal(h.window.options.webPreferences.contextIsolation, true);
    assert.equal(h.window.options.webPreferences.sandbox, true);
  });
}

test('appearance loading delays the first window and quit prevents late appearance or IPC authority', async () => {
  const h = await harness({ appearancePending: true });
  assert.ok(h.getService()); assert.equal(h.getWindow(), undefined); assert.equal(h.getIpcOptions(), undefined);
  assert.deepEqual(h.nativeChanges, []);
  let prevented = false; h.app.emit('before-quit', { preventDefault() { prevented = true; } });
  h.appearanceReady.resolve(h.appearanceSnapshot('light')); await tick();
  assert.equal(prevented, true); assert.equal(h.getWindow(), undefined); assert.equal(h.getIpcOptions(), undefined);
  assert.deepEqual(h.nativeChanges, []);
  h.drained.resolve(); await tick(); await tick();
  assert.equal(h.calls.at(-1), 'quit');
});

test('appearance is applied only after confirmed storage and does not change media/control options', async () => {
  const h = await harness(), originalService = h.service, originalControls = h.getControlOptions();
  const saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  assert.equal(h.appearanceWrites.length, 1); assert.deepEqual(h.nativeChanges, ['dark']);
  const result = h.appearanceSnapshot('light'); h.appearanceWrites[0].resolve(result);
  assert.equal(await saved, result);
  assert.deepEqual(h.nativeChanges, ['dark', 'light']); assert.deepEqual(h.backgroundChanges, ['#f7f7f4']);
  assert.equal(h.service, originalService); assert.equal(h.getControlOptions(), originalControls);
  assert.deepEqual(h.calls, []);
});

test('pending accepted appearance save delays diagnostics and quit after media resources drain', async () => {
  const h = await harness({ resourcesPending: true });
  const saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  h.window.destroy();
  assert.equal(h.isAppearanceClosed(), true);
  await assert.rejects(h.getIpcOptions().appearance.set({ theme: 'dark' }), { code: 'APPEARANCE_CLOSED' });
  h.drained.resolve(); await tick();
  assert.ok(h.calls.includes('close-operation-resources')); assert.ok(!h.calls.includes('flush-appearance'));
  h.resources.resolve(); await tick();
  assert.ok(h.calls.includes('flush-appearance')); assert.ok(!h.calls.includes('quit'));
  assert.ok(!h.calls.some(value => Array.isArray(value) && value[0] === 'closed'));
  h.appearanceWrites[0].resolve(h.appearanceSnapshot('light')); await saved; await tick(); await tick();
  assert.deepEqual(h.backgroundChanges, []); // A saved result cannot touch a destroyed window.
  assert.equal(h.calls.at(-1), 'quit');
  assert.ok(h.calls.indexOf('close-operation-resources') < h.calls.indexOf('flush-appearance'));
});

test('rejected appearance save retains native presentation and reports failed shutdown after draining', async () => {
  const h = await harness(), saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  const rejected = assert.rejects(saved, /disk unavailable/);
  h.window.destroy(); h.drained.resolve(); await tick();
  assert.ok(h.calls.includes('flush-appearance')); assert.ok(!h.calls.includes('quit'));
  h.appearanceWrites[0].reject(new Error('disk unavailable')); await rejected;
  assert.deepEqual(h.nativeChanges, ['dark']); assert.deepEqual(h.backgroundChanges, []);
  await tick(); await tick();
  assert.ok(h.calls.includes('APPEARANCE_FLUSH_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'failed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('renderer loss cancels media immediately while appearance persistence drains before final close', async () => {
  const h = await harness(), saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(h.isAppearanceClosed(), true);
  await assert.rejects(h.getIpcOptions().appearance.set({ theme: 'dark' }), { code: 'APPEARANCE_CLOSED' });
  await tick();
  assert.ok(h.calls.includes('cancel')); assert.ok(h.calls.includes('RENDERER_GONE'));
  assert.ok(!h.calls.includes('flush-appearance'));
  h.drained.resolve(); await tick();
  assert.equal(h.window.isDestroyed(), true); assert.ok(h.calls.includes('flush-appearance')); assert.ok(!h.calls.includes('quit'));
  h.appearanceWrites[0].resolve(h.appearanceSnapshot('light')); await saved; await tick(); await tick();
  assert.deepEqual(h.backgroundChanges, []);
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'failed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('Keep application open preserves appearance admission and does not begin shutdown', async () => {
  const h = await harness(); h.service.busy = true; h.window.close();
  assert.equal(h.isAppearanceClosed(), false); assert.equal(h.window.isDestroyed(), false);
  h.closeChoice.resolve({ response: 0 }); await tick();
  assert.equal(h.isAppearanceClosed(), false); assert.ok(!h.calls.includes('cancel'));
  const saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  h.appearanceWrites[0].resolve(h.appearanceSnapshot('light')); await saved;
  assert.deepEqual(h.nativeChanges, ['dark', 'light']); assert.equal(h.window.isDestroyed(), false);
});

test('Cancel encoding and exit closes appearance admission before awaiting the media child', async () => {
  const h = await harness(); h.service.busy = true; h.window.close();
  h.closeChoice.resolve({ response: 1 }); await tick();
  assert.ok(h.calls.includes('cancel')); assert.equal(h.window.isDestroyed(), false);
  assert.equal(h.isAppearanceClosed(), true);
  await assert.rejects(h.getIpcOptions().appearance.set({ theme: 'light' }), { code: 'APPEARANCE_CLOSED' });
  assert.equal(h.appearanceWrites.length, 0);
  h.drained.resolve(); await tick(); await tick();
  assert.equal(h.window.isDestroyed(), true); assert.equal(h.calls.at(-1), 'quit');
});

test('idle before-quit closes admission synchronously while preserving accepted writes', async () => {
  const h = await harness(), saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  let prevented = false; h.app.emit('before-quit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.isAppearanceClosed(), true);
  await assert.rejects(h.getIpcOptions().appearance.set({ theme: 'dark' }), { code: 'APPEARANCE_CLOSED' });
  h.drained.resolve(); await tick(); assert.ok(!h.calls.includes('quit'));
  h.appearanceWrites[0].resolve(h.appearanceSnapshot('light')); await saved; await tick(); await tick();
  assert.equal(h.calls.at(-1), 'quit');
});

test('unconfirmed fulfilled appearance result cannot apply a theme or claim successful shutdown', async () => {
  const h = await harness(), saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  const rejected = assert.rejects(saved, { code: 'APPEARANCE_SAVE_UNCONFIRMED' });
  h.appearanceWrites[0].resolve({ schema: 1, theme: 'light', persistence: { state: 'unavailable', persisted: false }, notices: [] });
  await rejected; assert.deepEqual(h.nativeChanges, ['dark']);
  h.window.destroy(); h.drained.resolve(); await tick(); await tick();
  assert.ok(h.calls.includes('APPEARANCE_FLUSH_FAILED')); assert.equal(h.calls.at(-1), 'quit');
});

test('later confirmed save clears an earlier save failure without changing media state', async () => {
  const h = await harness({ initialPersistence: 'unavailable' });
  const failed = h.getIpcOptions().appearance.set({ theme: 'light' });
  const rejected = assert.rejects(failed, /unavailable/); h.appearanceWrites[0].reject(new Error('unavailable')); await rejected;
  const saved = h.getIpcOptions().appearance.set({ theme: 'light' });
  h.appearanceWrites[1].resolve({ schema: 1, theme: 'light', persistence: { state: 'saved', persisted: true }, notices: [] }); await saved;
  h.window.destroy(); h.drained.resolve(); await tick(); await tick();
  assert.ok(!h.calls.includes('APPEARANCE_FLUSH_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'completed'));
});

test('untouched unavailable-load fallback and rejected DTO do not invent a failed accepted save', async () => {
  const h = await harness({ initialPersistence: 'unavailable' });
  await assert.rejects(h.getIpcOptions().appearance.set({ theme: 'system' }), { code: 'INVALID_APPEARANCE' });
  assert.equal(h.appearanceWrites.length, 0);
  h.window.destroy(); h.drained.resolve(); await tick(); await tick();
  assert.ok(!h.calls.includes('APPEARANCE_FLUSH_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'completed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('unexpected appearance flush failure still closes diagnostics and exits after media drainage', async () => {
  const h = await harness({ appearanceFlushPending: true });
  h.window.destroy(); h.drained.resolve(); await tick();
  assert.ok(!h.calls.includes('quit')); h.appearanceFlushed.reject(new Error('appearance drain failed')); await tick(); await tick();
  assert.ok(h.calls.includes('APPEARANCE_FLUSH_FAILED'));
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed' && value[1] === 'failed'));
  assert.equal(h.calls.at(-1), 'quit');
});

test('NS-20: main composes native file controls once from the verified pins and passes only the asserted production object', async () => {
  const h = await harness(); await tick();
  const options = h.getNativeFileOptions();
  assert.deepEqual(Object.keys(options).sort(), ['nativeBackends', 'runtime', 'stateDir']);
  // Built inside main.js's realm: compare data, not prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(options.runtime)), { ffmpeg: { file: h.verified.ffmpeg, sizeBytes: 1, sha256: 'a'.repeat(64) },
    ffprobe: { file: h.verified.ffprobe, sizeBytes: 2, sha256: 'b'.repeat(64) } });
  assert.equal(options.stateDir, h.getService().options.stateDir);
  assert.equal(options.nativeBackends, h.getService().options.nativeBackends);
  assert.deepEqual(h.nativeFileCalls, ['compose', ['assert', h.nativeFileControls]]);
  assert.equal(h.getService().options.nativeFiles, h.nativeFileControls);
  assert.equal(Object.hasOwn(h.getService().options, 'allowInjectedNativeFiles'), false);
  assert.ok(!h.calls.includes('NATIVE_FILE_COMPOSITION_FAILED')); assert.ok(h.getWindow());
});

test('NS-20: a native file composition failure leaves native files unavailable and keeps its detail main-private', async () => {
  const h = await harness({ nativeFileComposition: 'fails' }); await tick(); await tick();
  assert.deepEqual(h.nativeFileCalls, ['compose']);
  assert.equal(h.getService().options.nativeFiles, null);
  const incident = h.incidents.find(event => event.reason === 'NATIVE_FILE_COMPOSITION_FAILED');
  assert.equal(incident.stage, 'startup'); assert.equal(incident.severity, 'warning'); assert.equal(Object.hasOwn(incident, 'message'), false);
  assert.deepEqual(Object.keys(incident.context), ['nativePrivate']);
  assert.equal(incident.context.nativePrivate.code, 'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE'); assert.equal(incident.context.nativePrivate.causeCode, 'EPERM');
  assert.ok(h.getWindow()); assert.ok(!h.calls.includes('async-dialog'));
});

test('NS-20: a non-production native file brand stops startup before any service or window exists', async () => {
  const h = await harness({ nativeFileComposition: 'injected' }); await tick();
  assert.deepEqual(h.nativeFileCalls, ['compose', ['assert', h.nativeFileControls]]);
  assert.equal(h.getService(), undefined); assert.equal(h.getWindow(), undefined);
  assert.ok(h.calls.includes('async-dialog'));
  h.dialogClosed.resolve(); await tick(); await tick();
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
});

test('NS-20: a native file composition defect (for example an extra policies key) stops startup instead of failing soft', async () => {
  const h = await harness({ nativeFileComposition: 'defect' }); await tick();
  assert.deepEqual(h.nativeFileCalls, ['compose']);
  assert.equal(h.getService(), undefined); assert.equal(h.getWindow(), undefined);
  assert.ok(!h.calls.includes('NATIVE_FILE_COMPOSITION_FAILED')); assert.ok(h.calls.includes('async-dialog'));
  h.dialogClosed.resolve(); await tick(); await tick();
  assert.deepEqual(h.calls.at(-1), ['exit', 1]);
});

test('committed busy close fences new IPC before media drains; Keep leaves the registration usable', async () => {
  for (const response of [0, 1]) {
    const h = await harness(), read = h.channel('snapshot');
    h.service.snapshot = () => 'open'; h.service.busy = true;
    h.window.close(); h.closeChoice.resolve({ response }); await tick();
    const reply = await read();
    if (response === 0) {
      assert.equal(reply.value, 'open'); assert.ok(!h.service.admissionClosed);
      assert.ok(!h.calls.includes('cancel'));
    } else {
      assert.equal(reply.error?.code, 'SHUTTING_DOWN'); assert.ok(h.calls.includes('cancel'));
      assert.equal(h.window.isDestroyed(), false); h.drained.resolve(); await tick();
      assert.equal(h.calls.at(-1), 'quit');
    }
  }
});

test('idle quit waits for an admitted output action before closing resources or history', async () => {
  const h = await harness(), action = deferred();
  h.service.openCompletedOutput = async () => { await action.promise; h.calls.push('output-done'); return true; };
  const open = h.channel('open-completed-output'), payload = { outputId: 'bf509721-05ab-4d26-80da-7fb541d42c59', action: 'open' };
  const admitted = open(payload);
  h.app.emit('before-quit', { preventDefault() {} }); h.drained.resolve(); await tick();
  assert.ok(h.calls.includes('cancel')); assert.equal((await open(payload)).error.code, 'SESSION_RETIRED');
  assert.ok(!h.calls.includes('close-operation-resources')); assert.ok(!h.calls.includes('quit'));
  action.resolve(); assert.equal((await admitted).value, true); await tick();
  assert.ok(h.calls.indexOf('output-done') < h.calls.indexOf('close-operation-resources'));
  assert.equal(h.calls.filter(item => Array.isArray(item) && item[0] === 'closed').length, 1);
  assert.equal(h.calls.at(-1), 'quit');
});

test('renderer loss cancels promptly but still waits for a held folder picker to refuse a late selection', async () => {
  const h = await harness(), picker = deferred();
  h.getIpcOptions().dialog.showOpenDialog = () => { h.calls.push('picker-shown'); return picker.promise; };
  h.service.registerFolder = () => { h.service.requireIdle(); h.calls.push('grant'); };
  const read = h.channel('snapshot'); h.service.snapshot = () => 'open';
  const request = h.channel('input-folder')(); await tick(); assert.ok(h.calls.includes('picker-shown'));
  h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.ok(h.calls.includes('cancel')); assert.equal((await read()).error?.code, 'SHUTTING_DOWN');
  h.drained.resolve(); await tick();
  assert.ok(!h.calls.includes('close-operation-resources')); assert.ok(!h.calls.includes('quit'));
  picker.resolve({ canceled: false, filePaths: ['fixture-folder'] });
  assert.equal((await request).error.code, 'SHUTTING_DOWN'); await tick();
  assert.ok(!h.calls.includes('grant')); assert.ok(h.calls.includes('FOLDER_PICKER_REJECTED'));
  assert.ok(h.calls.indexOf('FOLDER_PICKER_REJECTED') < h.calls.indexOf('close-operation-resources'));
  assert.ok(h.calls.some(item => Array.isArray(item) && item[1] === 'failed'));
});

test('a trusted rejection diagnostic settling after close is observed before the terminal journal', async () => {
  for (const failure of [false, true]) {
    const h = await harness(), held = deferred(), record = h.service.recordIncident.bind(h.service);
    h.service.recordIncident = async event => {
      if (event.reason === 'REQUEST_REJECTED') { h.calls.push('held'); await held.promise; }
      return record(event);
    };
    const request = h.channel('snapshot')('unexpected');
    const result = failure ? assert.rejects(request, /unavailable/) : request;
    await tick(); assert.ok(h.calls.includes('held')); h.window.destroy(); h.drained.resolve(); await tick();
    assert.ok(!h.calls.includes('close-operation-resources')); assert.ok(!h.calls.includes('quit'));
    if (failure) held.reject(new Error('unavailable')); else held.resolve();
    await result; await tick();
    assert.ok(h.calls.includes('close-operation-resources'));
    assert.equal(h.calls.filter(item => Array.isArray(item) && item[0] === 'closed').length, 1);
    assert.ok(h.calls.some(item => Array.isArray(item) && item[1] === (failure ? 'failed' : 'completed')));
    assert.equal(h.calls.includes('IPC_DRAIN_FAILED'), failure);
  }
});

test('failed busy Cancel cannot strand a fenced window or become a successful session after a later drain', async () => {
  for (const retryFails of [false, true]) {
    const h = await harness(), action = deferred(), retry = deferred(); let attempts = 0;
    h.service.busy = true; h.service.snapshot = () => action.promise;
    h.service.cancelCurrent = () => (++attempts === 1 ? h.drained : retry).promise;
    h.service.getRuntimeInformation = () => 'open';
    const lateRead = h.channel('runtime-information'), admitted = h.channel('snapshot')();
    // EventEmitter itself does not await a close listener. Observe its result
    // explicitly so a rejected listener cannot silently skip its cleanup.
    const closing = h.window.listeners('close')[0]({ preventDefault() {} });
    const outcome = closing.then(() => 'handled', () => 'unhandled');
    h.closeChoice.resolve({ response: 1 }); await tick();
    assert.equal(attempts, 1); assert.equal((await lateRead()).error?.code, 'SHUTTING_DOWN');
    h.drained.reject(new Error('first cancellation failed')); await tick();
    assert.equal(await outcome, 'handled'); assert.ok(h.window.isDestroyed()); assert.equal(attempts, 2);
    if (retryFails) retry.reject(new Error('terminal cancellation failed')); else retry.resolve();
    await tick(); assert.ok(!h.calls.includes('close-operation-resources')); assert.ok(!h.calls.includes('quit'));
    action.resolve('done'); assert.equal((await admitted).value, 'done'); await tick();
    assert.ok(h.calls.includes('CLOSE_CANCELLATION_FAILED'));
    assert.equal(h.calls.includes('OPERATION_DRAIN_FAILED'), retryFails);
    assert.ok(h.calls.includes('close-operation-resources')); assert.ok(h.calls.includes('flush-appearance'));
    assert.deepEqual(h.calls.filter(item => Array.isArray(item) && item[0] === 'closed'), [['closed', 'failed']]);
  }
});
