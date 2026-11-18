'use strict';
// Actual main/session/IPC/service/OutputAccess integration over inert owned files.
// Factories, Electron and diagnostic persistence are seams. Nonempty plan state is
// seeded, not produced by a real prepare/encode. Shell callbacks never invoke OS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { WorkbenchSession } = require('./workbench-session.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'session-output-contract-'));
  let closeFixture;
  // Register owned-root cleanup before any setup can throw. Closing an initialized
  // main still precedes removal; a partial setup has no exit promise to await.
  t.after(async () => { try { await closeFixture?.(); } finally { await fs.rm(root, { recursive: true }); } });
  const handlers = new Map(), services = [], windows = [], shellCalls = [], exits = [], incidents = [], errors = [];
  const shellEntered = deferred(), shellRelease = deferred(); let holdShell = false;
  const exited = deferred();
  const app = Object.assign(new EventEmitter(), { enableSandbox() {}, disableHardwareAcceleration() {}, setPath() {},
    whenReady: async () => {}, requestSingleInstanceLock: () => true, isReady: () => true,
    exit(code) { exits.push(code); exited.resolve(); }, quit() {} });
  const local = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    setDevicePermissionHandler() {}, protocol: {}, webRequest: { onBeforeRequest() {} } });
  class Window extends EventEmitter {
    constructor() {
      super(); this.destroyed = false; this.updates = []; windows.push(this);
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'app://local/index.html' },
        setWindowOpenHandler() {}, isDestroyed: () => this.destroyed,
        send: (channel, snapshot) => { assert.equal(channel, 'encoder:update'); this.updates.push(snapshot); },
        getLastWebPreferences: () => ({ sandbox: true }) });
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; app.emit('window-all-closed'); }
    setBackgroundColor() {} setTitle() {} async loadURL() {}
  }
  const create = kind => async ({ outputAccess }) => {
    assert.ok(outputAccess instanceof OutputAccess);
    const service = new EncoderService({ ffmpeg: path.join(root, 'never-run'), ffprobe: path.join(root, 'never-probe'),
      stateDir: root, outputAccess, run() { assert.fail('No process allowed'); } });
    service.kind = kind; service.linuxRemuxStatus = { available: false };
    // Persistence-only seams; actual snapshot, admission, cancellation, resource
    // closure and openCompletedOutput methods remain inherited and unmodified.
    service.initializeDiagnostics = async () => ({ persisted: true });
    service.recordIncident = async value => { incidents.push({ kind, ...value }); };
    service.closeDiagnostics = async () => ({ persisted: true });
    services.push(service); return service;
  };
  const modules = {
    electron: { app, BrowserWindow: Window, dialog: { showErrorBox(...a) { errors.push(a); } },
      ipcMain: { handle: (n, f) => handlers.set(n, f), removeHandler: n => handlers.delete(n) },
      session: { fromPartition: () => local }, protocol: { registerSchemesAsPrivileged() {} }, nativeTheme: {},
      shell: { async openPath(file) { shellCalls.push(['open', file]); if (holdShell) { shellEntered.resolve(); await shellRelease.promise; } return ''; },
        showItemInFolder(file) { shellCalls.push(['reveal', file]); } } },
    'node:fs': { mkdirSync() {} }, 'node:path': path,
    './workbench-service.cjs': { createWorkbenchService: create('ordinary') },
    './candidate-full-copy-workbench.cjs': { createCandidateFullCopyWorkbench: create('full-copy') },
    './workbench-runtime-choice.cjs': require('./workbench-runtime-choice.cjs'), './workbench-session.cjs': { WorkbenchSession },
    '../src/appearance.cjs': { AppearanceSettings: class { async load() { return { theme: 'dark' }; } closeAdmission() {} async flush() {} } },
    '../src/output-access.cjs': { OutputAccess }, '../src/ipc.cjs': require('../src/ipc.cjs'),
    '../src/local-protocol.cjs': { ENTRY_URL: 'app://local/index.html', registerLocalProtocol() {}, resolveAsset: () => true },
  };
  const code = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  vm.runInNewContext(code, { require: n => { assert.ok(Object.hasOwn(modules, n), n); return modules[n]; }, __dirname,
    process: { argv: ['electron', '--blue-workbench-session-switching'], versions: {} },
    console: { log() {}, error(...a) { errors.push(a); } } });
  closeFixture = async () => { shellRelease.resolve(); if (!exits.length) app.emit('before-quit', { preventDefault() {} }); await exited.promise; };
  await tick(); assert.equal(windows.length, 1); assert.equal(services.length, 1);
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const call = (name, ...args) => handlers.get(name)(event(windows.at(-1)), ...args);
  const grant = async service => {
    const file = path.join(root, `published-${randomUUID()}.mkv`); await fs.writeFile(file, 'inert already-published fixture', { flag: 'wx' });
    const identity = await readSourceIdentity(file);
    return { file, token: await service.outputAccess.issue({ file, identity }) };
  };
  return { app, handlers, services, windows, shellCalls, exits, errors, incidents, event, call, grant,
    holdShell() { holdShell = true; }, shellEntered, shellRelease, exited };
}
test('actual main retires nonempty modeled plans, real output grants and delayed old callbacks across both switches', async t => {
  const h = await fixture(t);
  for (const kind of ['full-copy', 'ordinary']) {
    const old = h.services.at(-1), oldWindow = h.windows.at(-1), oldEvent = h.event(oldWindow);
    const fileId = randomUUID(), planId = randomUUID();
    old.plan = { id: planId, operation: 'encode', entries: new Map([[fileId, { operationPlan: { compatibilityPath: true } }]]) };
    old.state.phase = 'ready'; old.state.planId = planId; old.state.items = [{ id: fileId, status: 'ready', name: 'seeded.mkv' }];
    const grant = await h.grant(old), oldOutputHandler = h.handlers.get('encoder:open-completed-output');
    assert.equal((await h.call('encoder:open-completed-output', { ...grant.token, action: 'reveal' })).ok, true);
    assert.equal(h.shellCalls.at(-1)[1], grant.file);
    const callbacks = old.listeners('update'); assert.equal(callbacks.length, 1);
    old.emitState(); assert.equal(oldWindow.updates.at(-1).items.length, 1);
    assert.equal((await h.call('encoder:select-workbench-session', kind)).ok, true);
    const next = h.services.at(-1), nextWindow = h.windows.at(-1);
    assert.notEqual(next, old); assert.equal(next.kind, kind); assert.equal(oldWindow.destroyed, true);
    assert.equal(old.plan, null); assert.equal(old.admissionClosed, true);
    assert.throws(() => old.startBatch({ planId, fileIds: [fileId] }), { code: 'SHUTTING_DOWN' });
    assert.equal(next.plan, null); assert.equal(next.snapshot().items.length, 0);
    const before = nextWindow.updates.length;
    // Invoke the captured listener as a delayed callback, not merely an event
    // whose listener has already been removed. Both must be fenced.
    await Promise.resolve().then(() => callbacks[0]({ retired: true, items: [{ id: fileId }] }));
    old.emit('update', { retired: true }); assert.equal(nextWindow.updates.length, before);
    next.emitState(); assert.equal(nextWindow.updates.length, before + 1);
    const shellCount = h.shellCalls.length;
    await assert.rejects(old.outputAccess.action({ ...grant.token, action: 'reveal' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
    assert.equal((await oldOutputHandler(oldEvent, { ...grant.token, action: 'reveal' })).error.code, 'SESSION_RETIRED');
    assert.equal((await h.call('encoder:open-completed-output', { ...grant.token, action: 'reveal' })).error.code, 'OUTPUT_ACCESS_EXPIRED');
    assert.equal(h.shellCalls.length, shellCount);
  }
  assert.equal(h.windows.length, 3); assert.deepEqual(h.errors, []);
});
test('actual main Quit drains an admitted genuine output action and immediately revokes future grants', async t => {
  const h = await fixture(t), service = h.services[0], grant = await h.grant(service);
  h.holdShell();
  const handler = h.handlers.get('encoder:open-completed-output'), event = h.event(h.windows[0]);
  const pending = handler(event, { ...grant.token, action: 'open' }); await h.shellEntered.promise;
  h.app.emit('before-quit', { preventDefault() {} }); await tick();
  assert.deepEqual(h.exits, []); assert.equal(service.admissionClosed, true);
  assert.equal((await handler(event, { ...grant.token, action: 'reveal' })).error.code, 'SHUTTING_DOWN');
  await assert.rejects(service.outputAccess.action({ ...grant.token, action: 'reveal' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  assert.equal(h.shellCalls.length, 1);
  // Dispatch had already entered the injected shell callback. Quit cannot undo
  // that dispatch; it must wait for settlement, not claim no earlier dispatch.
  h.shellRelease.resolve(); assert.equal((await pending).ok, true); await h.exited.promise;
  assert.deepEqual(h.exits, [0]); assert.equal(h.shellCalls.length, 1); assert.deepEqual(h.errors, []);
});
