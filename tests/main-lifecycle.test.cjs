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

async function harness({ runtimePending = false, diagnosticsPending = false, resourcesPending = false } = {}) {
  const load = deferred(), drained = deferred(), dialogClosed = deferred();
  const initialized = deferred(); if (!diagnosticsPending) initialized.resolve();
  const resources = deferred(); if (!resourcesPending) resources.resolve();
  const runtime = deferred();
  const verified = { ffmpeg: 'verified/ffmpeg.exe', ffprobe: 'verified/ffprobe.exe',
    verified: [{ sizeBytes: 1, sha256: 'a'.repeat(64) }, { sizeBytes: 2, sha256: 'b'.repeat(64) }] };
  if (!runtimePending) runtime.resolve(verified);
  const calls = []; let window, service, controlOptions;
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
    constructor() { super(); window = this; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, isDestroyed: () => false }); }
    isDestroyed() { return this.destroyed; }
    loadURL() { return load.promise; }
    destroy() { this.destroyed = true; dialogClosed.resolve(); this.emit('closed'); }
    close() { this.destroy(); }
  }
  const appSession = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, protocol: {}, webRequest: { onBeforeRequest() {} } };
  vm.runInNewContext(source, { console, process: { resourcesPath: 'resources' }, require(id) {
    if (id === 'electron') return { app, BrowserWindow: Window, ipcMain: {}, session: { fromPartition: () => appSession }, protocol: { registerSchemesAsPrivileged() {} },
      dialog: { showErrorBox() { calls.push('blocking-dialog'); }, showMessageBox() { calls.push('async-dialog'); return dialogClosed.promise; } } };
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
    if (id === './src/ipc.cjs') return { registerIpc: () => () => calls.push('remove-ipc') };
    if (id === './src/local-protocol.cjs') return { ENTRY_URL: 'app://encoder/index.html', resolveAsset() {}, registerLocalProtocol() {} };
    throw new Error('Unexpected dependency: ' + id);
  } }, { filename: 'main.js' });
  await tick();
  return { app, load, drained, dialogClosed, calls, window, service, runtime, verified, initialized, resources,
    getWindow: () => window, getService: () => service, getControlOptions: () => controlOptions, families, qualification };
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
