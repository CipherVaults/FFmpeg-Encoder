'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { OutputAccess } = require('../src/output-access.cjs');
const { createCandidateWorkbench, RESTORATION_ROOT } = require('./candidate-workbench.cjs');
async function fixture({ missing = false, rejectFactory = false } = {}) {
  const file = path.join(__dirname, 'candidate-workbench.cjs'), source = await fs.readFile(file, 'utf8'), real = createRequire(file), module = { exports: {} };
  const seen = { opened: 0, closed: 0, calls: [], manifest: null, configuration: null };
  const runtime = { close: async () => { seen.closed++; } };
  const service = { getCapabilities: async () => ({ profiles: [{ id: 'h265-cpu', quality: { mode: 'CRF' } }, { id: 'h264-cpu' }], recipes: [{}], vendorProfiles: [{}] }), getPreferences: async () => ({ profileId: 'h264-cpu', settingsByProfile: {}, notices: [] }) };
  const overrides = { 'node:fs/promises': { access: async file => { seen.calls.push(file); if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    './candidate-calibration-runtime.cjs': { openCandidateCalibrationRuntime: async manifest => { seen.opened++; seen.manifest = manifest; return runtime; } },
    './candidate-keep720-service.cjs': { ...real('./candidate-keep720-service.cjs'), createCandidateKeep720Service: async options => {
      seen.configuration = options; if (rejectFactory) throw new Error('Rejected fixed report'); return service;
    } }, '../src/process-runner.cjs': { runTool: () => { throw new Error('No media'); } } };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: file })(n => overrides[n] || real(n), module, module.exports, __dirname);
  return { seen, runtime, service, api: module.exports };
}
test('fixed ignored restoration and no caller runtime authority', async () => {
  assert.equal(path.dirname(RESTORATION_ROOT), path.join(__dirname, 'artifacts'));
  for (const options of [{ stateDir: '/tmp/test', manifest: {} }, { stateDir: '/tmp/test', ffmpeg: '/tmp/tool' }, { stateDir: '/tmp/test', outputAccess: {} }]) await assert.rejects(createCandidateWorkbench(options), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  let read = false; await assert.rejects(createCandidateWorkbench(Object.defineProperty({ stateDir: '/tmp/test' }, 'onChild', { enumerable: true, get() { read = true; } }))); assert.equal(read, false);
});
test('missing restoration stops before runtime opening; rejected live gates close owner', async () => {
  const a = await fixture({ missing: true }); await assert.rejects(a.api.createCandidateWorkbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED' }); assert.equal(a.seen.opened, 0);
  const b = await fixture({ rejectFactory: true }); await assert.rejects(b.api.createCandidateWorkbench({ stateDir: '/tmp/test' }), /fixed report/); assert.equal(b.seen.closed, 1);
});
test('injected composition binds exact pair/dependencies, isolated CPU tuple and unavailable Remux', async () => {
  const h = await fixture(), outputAccess = new OutputAccess({ openPath() {}, showItemInFolder() {} });
  const service = await h.api.createCandidateWorkbench({ stateDir: '/tmp/test', outputAccess });
  assert.equal(h.seen.configuration.verifiedRuntime, h.runtime); assert.equal(h.seen.configuration.outputAccess, outputAccess); assert.equal(h.seen.configuration.workbenchMode, true);
  assert.equal(h.seen.manifest.dependencies.length, 7); assert.equal(h.seen.manifest.pins.ffmpeg.size, 46175848);
  assert.equal(h.seen.manifest.pins.ffmpeg.path, path.join(RESTORATION_ROOT, 'ffmpeg'));
  assert.equal(service.linuxRemuxStatus.available, false); assert.equal(service.linuxQualifiedEncodeStatus.available, false);
  const caps = await service.getCapabilities(); assert.deepEqual(caps.profiles.map(p => p.id), ['h265-cpu']); assert.deepEqual(caps.profiles[0].presets, ['slow']); assert.equal(caps.profiles[0].quality.default, 25); assert.deepEqual(caps.recipes, []);
  assert.deepEqual((await service.getPreferences()).settingsByProfile, { 'h265-cpu': { preset: 'slow', quality: 25 } });
});
test('main keeps old factories, original shell/security, isolated candidate state and explicit failure disclosure', async () => {
  const source = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  const expression = source.match(/const createService = ([\s\S]*?);/)[1];
  for (const choice of ['baseline', '9.0.2-av1', '9.0.2-keep720-candidate']) {
    const calls = [], baseline = {}, av1 = {}, candidate = {};
    const selected = vm.runInNewContext(expression, { runtimeChoice: choice, createWorkbenchService: baseline,
      require: name => { calls.push(name); return name === './candidate-workbench.cjs' ? { createCandidateWorkbench: candidate } : { create1440QualifiedAv1WorkbenchService: av1 }; } });
    assert.equal(selected, choice === 'baseline' ? baseline : choice === '9.0.2-av1' ? av1 : candidate);
    assert.deepEqual(calls, choice === 'baseline' ? [] : [choice === '9.0.2-av1' ? './workbench-av1-service.cjs' : './candidate-workbench.cjs']);
  }
  for (const text of ['workbench-preview', 'workbench-av1-preview', 'workbench-keep720-candidate-preview', 'app.enableSandbox()', 'contextIsolation: true', 'nodeIntegration: false', "path.join(root, 'preload.js')", 'gauge-win-midtone-256.png', "dialog.showErrorBox('Experimental Keep720 preview unavailable'"]) assert.ok(source.includes(text), text);
  assert.match(source, /developer-keep720-range/); assert.match(source, /native threading unqualified/);
});
test('candidate main closes late startup owner before window creation and waits for resource drainage', async () => {
  const { EventEmitter } = require('node:events');
  const source = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  let resolveStartup, resolveDrain, windows = 0; const exits = [], order = [];
  const startup = new Promise(resolve => { resolveStartup = resolve; }), drain = new Promise(resolve => { resolveDrain = resolve; });
  const app = Object.assign(new EventEmitter(), { enableSandbox() {}, disableHardwareAcceleration() {}, setPath() {}, whenReady: async () => {},
    requestSingleInstanceLock: () => true, isReady: () => true, exit: code => exits.push(code), quit() {} });
  const service = Object.assign(new EventEmitter(), { closeAdmission() { order.push('admission'); }, async cancelCurrent() { order.push('cancel'); },
    async closeOperationResources() { order.push('resources-start'); await drain; order.push('resources-end'); },
    async closeDiagnostics() { order.push('diagnostics'); return { persisted: true }; } });
  const modules = { electron: { app, BrowserWindow: class { constructor() { windows++; throw new Error('No window after close'); } },
      dialog: { showErrorBox() { throw new Error('Unexpected failure'); } }, ipcMain: {}, session: {}, protocol: { registerSchemesAsPrivileged() {} }, nativeTheme: {}, shell: {} },
    'node:fs': { mkdirSync() {} }, 'node:path': path,
    './workbench-service.cjs': { createWorkbenchService() { throw new Error('Baseline fallback forbidden'); } },
    './workbench-runtime-choice.cjs': require('./workbench-runtime-choice.cjs'),
    './candidate-workbench.cjs': { createCandidateWorkbench: () => startup },
    '../src/appearance.cjs': { AppearanceSettings: class {} }, '../src/output-access.cjs': { OutputAccess: class {} },
    '../src/ipc.cjs': { registerIpc() { throw new Error('No IPC after close'); } }, '../src/local-protocol.cjs': {} };
  vm.runInNewContext(source, { require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; }, __dirname,
    process: { argv: ['electron', '--blue-runtime=9.0.2-keep720-candidate'], versions: {} }, console: { log() {}, error() {} } }, { filename: 'workbench-main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  app.emit('before-quit', { preventDefault() {} }); resolveStartup(service);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows, 0); assert.deepEqual(exits, []); assert.ok(order.includes('resources-start'));
  resolveDrain(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(exits, [0]); assert.ok(order.indexOf('resources-end') < order.indexOf('diagnostics'));
});
