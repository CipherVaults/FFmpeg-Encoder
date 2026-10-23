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

async function harness({ runtimePending = false, diagnosticsPending = false, resourcesPending = false,
  appearancePending = false, appearanceFlushPending = false, initialTheme = 'dark', initialPersistence = 'saved' } = {}) {
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
  const calls = []; let window, service, controlOptions, ipcOptions, appearanceOptions, appearanceClosed = false;
  const families = [{ id: 'main-private-family-fixture' }], qualification = Object.freeze({});
  const app = new EventEmitter();
  Object.assign(app, { isReady: () => true, getAppPath: () => 'test-root', setPath() {}, requestSingleInstanceLock: () => true,
    commandLine: { hasSwitch: () => false }, whenReady: () => Promise.resolve(),
    quit: () => calls.push('quit'), exit: code => calls.push(['exit', code]) });
  class Service extends EventEmitter {
    constructor(options) { super(); service = this; this.busy = false; this.options = options; }
    initializeDiagnostics() { return initialized.promise; }
    cancelCurrent() { calls.push('cancel'); return drained.promise; }
    closeOperationResources() { calls.push('close-operation-resources'); return resources.promise; }
    async recordIncident(event) { calls.push(event.reason); }
    async closeDiagnostics(outcome) { calls.push(['closed', outcome]); }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); appearanceOrder.push('window'); window = this; this.options = options; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, isDestroyed: () => false }); }
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
  vm.runInNewContext(source, { console, process: { resourcesPath: 'resources' }, require(id) {
    if (id === 'electron') return { app, BrowserWindow: Window, nativeTheme, ipcMain: {}, session: { fromPartition: () => appSession }, protocol: { registerSchemesAsPrivileged() {} },
      dialog: { showErrorBox() { calls.push('blocking-dialog'); }, showMessageBox(...args) {
        const options = args.at(-1);
        if (options.buttons?.[0] === 'Keep application open') { calls.push('busy-dialog'); return closeChoice.promise; }
        calls.push('async-dialog'); return dialogClosed.promise;
      } } };
    if (id === 'node:fs') return { mkdirSync() {} };
    if (id === 'node:path') return path;
    if (id === 'node:crypto') return require('node:crypto');
    if (id === './src/candidate-runtime.cjs') return { verifyCandidateRuntime: () => runtime.promise };
    if (id === './src/operation-catalog.cjs') return { FAMILIES: families, POLICY_ID: 'fixed-main-policy' };
    if (id === './src/operation-controls.cjs') return { createOperationControls: options => {
      controlOptions = options; return { operationQualifications: qualification, operationTelemetry: true };
    } };
    if (id === './src/backend-discovery.cjs') return { discoverNativeBackends: async options => options };
    if (id === './src/backend-capabilities.cjs') return require('../src/backend-capabilities.cjs');
    if (id === './src/encoder-service.cjs') return { EncoderService: Service };
    if (id === './src/output-access.cjs') return require('../src/output-access.cjs');
    if (id === './src/appearance.cjs') return { AppearanceSettings: Appearance };
    if (id === './src/ipc.cjs') return { registerIpc: options => { ipcOptions = options; return () => calls.push('remove-ipc'); } };
    if (id === './src/local-protocol.cjs') return { ENTRY_URL: 'app://encoder/index.html', resolveAsset() {}, registerLocalProtocol() {} };
    throw new Error('Unexpected dependency: ' + id);
  } }, { filename: 'main.js' });
  await tick();
  return { app, load, drained, dialogClosed, closeChoice, calls, window, service, runtime, verified, initialized, resources,
    appearanceReady, appearanceFlushed, appearanceWrites, appearanceSnapshot, nativeChanges, backgroundChanges, appearanceOrder,
    getWindow: () => window, getService: () => service, getControlOptions: () => controlOptions,
    getIpcOptions: () => ipcOptions, getAppearanceOptions: () => appearanceOptions, isAppearanceClosed: () => appearanceClosed, families, qualification };
}

test('main reuses one private native registry across discovery observations', async () => {
  const h = await harness(), options = { signal: new AbortController().signal, run() {}, versions: { ffmpeg: 'fixture', ffprobe: 'fixture' } };
  const first = await h.service.options.discoverBackends(options), second = await h.service.options.discoverBackends(options);
  assert.ok(first.registry instanceof require('../src/backend-capabilities.cjs').NativeCapabilityRegistry);
  assert.equal(first.registry, second.registry);
  assert.equal(first.ffmpeg, h.verified.ffmpeg);
});

test('shutdown drains children then operation handles/lease before diagnostic closure and exit', async () => {
  const h = await harness({ resourcesPending: true }); h.window.destroy(); await tick();
  assert.ok(h.calls.includes('cancel')); assert.ok(!h.calls.includes('close-operation-resources'));
  h.drained.resolve(); await tick(); assert.ok(h.calls.includes('close-operation-resources'));
  assert.ok(!h.calls.some(value => Array.isArray(value) && value[0] === 'closed')); assert.ok(!h.calls.includes('quit'));
  h.resources.resolve(); await tick(); await tick();
  assert.ok(h.calls.some(value => Array.isArray(value) && value[0] === 'closed')); assert.equal(h.calls.at(-1), 'quit');
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
  assert.equal(h.getControlOptions().runtime, h.verified); assert.equal(h.getControlOptions().families, h.families);
  assert.equal(h.getControlOptions().policyIdentity, 'fixed-main-policy');
  assert.equal(h.getService().options.operationQualifications, h.qualification); assert.equal(h.getService().options.operationTelemetry, true);
  const discovery = await h.getService().options.discoverBackends({ versions: { ffmpeg: 'ffmpeg version test', ffprobe: 'ffprobe version test' } });
  assert.equal(discovery.ffmpeg, h.verified.ffmpeg);
  assert.equal(discovery.runtime.ffmpeg.sha256, h.verified.verified[0].sha256);
  assert.equal(discovery.runtime.ffprobe.version, 'ffprobe version test');
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
