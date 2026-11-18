'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { OutputAccess } = require('../src/output-access.cjs');
const { createCandidateFullCopyWorkbench, RESTORATION_ROOT } = require('./candidate-full-copy-workbench.cjs');
async function fixture({ missing = false, missingAt = null, rejectFactory = false } = {}) {
  const file = path.join(__dirname, 'candidate-full-copy-workbench.cjs'), source = await fs.readFile(file, 'utf8'), real = createRequire(file), module = { exports: {} };
  const seen = { opened: 0, closed: 0, calls: [], manifest: null, configuration: null };
  const runtime = { close: async () => { seen.closed++; } };
  const service = { getCapabilities: async () => ({ profiles: [{ id: 'h265-cpu', quality: { mode: 'CRF' } }, { id: 'h264-cpu' }], recipes: [{}], vendorProfiles: [{}] }), getPreferences: async () => ({ profileId: 'h264-cpu', settingsByProfile: {}, notices: [] }) };
  const overrides = { 'node:fs/promises': { access: async file => { seen.calls.push(file); if (missing || seen.calls.length === missingAt) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    './candidate-calibration-runtime.cjs': { openCandidateCalibrationRuntime: async manifest => { seen.opened++; seen.manifest = manifest; return runtime; } },
    './candidate-full-copy-service.cjs': { ...real('./candidate-full-copy-service.cjs'), createCandidateFullCopyService: async options => {
      seen.configuration = options; if (rejectFactory) throw new Error('Rejected fixed report'); return service;
    } }, '../src/process-runner.cjs': { runTool: () => { throw new Error('No media'); } } };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: file })(n => overrides[n] || real(n), module, module.exports, __dirname);
  return { seen, runtime, service, api: module.exports };
}
test('fixed ignored restoration and no caller runtime authority', async () => {
  assert.equal(path.dirname(RESTORATION_ROOT), path.join(__dirname, 'artifacts'));
  for (const options of [{ stateDir: '/tmp/test', manifest: {} }, { stateDir: '/tmp/test', ffmpeg: '/tmp/tool' }, { stateDir: '/tmp/test', outputAccess: {} }]) await assert.rejects(createCandidateFullCopyWorkbench(options), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  let read = false; await assert.rejects(createCandidateFullCopyWorkbench(Object.defineProperty({ stateDir: '/tmp/test' }, 'onChild', { enumerable: true, get() { read = true; } }))); assert.equal(read, false);
});
test('missing restoration stops before runtime opening; rejected live gates close owner', async () => {
  const a = await fixture({ missing: true }); await assert.rejects(a.api.createCandidateFullCopyWorkbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED' }); assert.equal(a.seen.opened, 0);
  const b = await fixture({ rejectFactory: true }); await assert.rejects(b.api.createCandidateFullCopyWorkbench({ stateDir: '/tmp/test' }), /fixed report/); assert.equal(b.seen.closed, 1);
});
test('injected composition binds exact pair/dependencies, isolated CPU tuple and unavailable Remux', async () => {
  const h = await fixture(), outputAccess = new OutputAccess({ openPath() {}, showItemInFolder() {} });
  const service = await h.api.createCandidateFullCopyWorkbench({ stateDir: '/tmp/test', outputAccess });
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
  for (const choice of ['baseline', '9.0.2-av1', '9.0.2-full-copy-candidate']) {
    const calls = [], baseline = {}, av1 = {}, candidate = {};
    const selected = vm.runInNewContext(expression, { runtimeChoice: choice, createWorkbenchService: baseline,
      require: name => { calls.push(name); return name === './candidate-full-copy-workbench.cjs' ? { createCandidateFullCopyWorkbench: candidate } : { create1440QualifiedAv1WorkbenchService: av1 }; } });
    assert.equal(selected, choice === 'baseline' ? baseline : choice === '9.0.2-av1' ? av1 : candidate);
    assert.deepEqual(calls, choice === 'baseline' ? [] : [choice === '9.0.2-av1' ? './workbench-av1-service.cjs' : './candidate-full-copy-workbench.cjs']);
  }
  for (const text of ['workbench-preview', 'workbench-av1-preview', 'workbench-full-copy-candidate-preview', 'app.enableSandbox()', 'contextIsolation: true', 'nodeIntegration: false', "path.join(root, 'preload.js')", 'gauge-win-midtone-256.png', "dialog.showErrorBox('Experimental Full-copy preview unavailable'"]) assert.ok(source.includes(text), text);
  assert.match(source, /developer-full-copy/); assert.match(source, /native threading unqualified/);
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
    './candidate-full-copy-workbench.cjs': { createCandidateFullCopyWorkbench: () => startup },
    '../src/appearance.cjs': { AppearanceSettings: class {} }, '../src/output-access.cjs': { OutputAccess: class {} },
    '../src/ipc.cjs': { registerIpc() { throw new Error('No IPC after close'); } }, '../src/local-protocol.cjs': {} };
  vm.runInNewContext(source, { require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; }, __dirname,
    process: { argv: ['electron', '--blue-runtime=9.0.2-full-copy-candidate'], versions: {} }, console: { log() {}, error() {} } }, { filename: 'workbench-main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  app.emit('before-quit', { preventDefault() {} }); resolveStartup(service);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows, 0); assert.deepEqual(exits, []); assert.ok(order.includes('resources-start'));
  resolveDrain(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(exits, [0]); assert.ok(order.indexOf('resources-end') < order.indexOf('diagnostics'));
});

test('each missing fixed tool or raw report refuses before any runtime owner opens', async () => {
  for (const missingAt of [1, 2, 3]) {
    const h = await fixture({ missingAt });
    await assert.rejects(h.api.createCandidateFullCopyWorkbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED' });
    assert.equal(h.seen.opened, 0); assert.equal(h.seen.calls.length, missingAt);
  }
});
test('loader override refuses before fixed restoration checks or runtime opening', async () => {
  const h = await fixture(), before = process.env.LD_PRELOAD;
  try {
    process.env.LD_PRELOAD = '/synthetic/not-loaded';
    await assert.rejects(h.api.createCandidateFullCopyWorkbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_ENVIRONMENT' });
    assert.equal(h.seen.opened, 0); assert.equal(h.seen.calls.length, 0);
  } finally { if (before === undefined) delete process.env.LD_PRELOAD; else process.env.LD_PRELOAD = before; }
});


test('close during actual awaited loadURL never emits READY for new or existing routes', async () => {
 const {EventEmitter}=require('node:events'); const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 for(const choice of ['9.0.2-full-copy-candidate','9.0.2-resize-candidate','baseline']){
  let arrived,release;const entered=new Promise(r=>arrived=r),load=new Promise(r=>release=r);const logs=[],exits=[];let destroyed=false,readPreferences=0;
  const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
  const service=Object.assign(new EventEmitter(),{runtimeIdentity:'synthetic',linuxRemuxStatus:{available:false},initializeDiagnostics:async()=>{},closeAdmission(){},cancelCurrent:async()=>{},closeOperationResources:async()=>{},closeDiagnostics:async()=>({persisted:true})});
  const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
  class Window extends EventEmitter {constructor(){super();this.webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){},isDestroyed:()=>destroyed,send(){},getLastWebPreferences(){readPreferences++;return {sandbox:true,contextIsolation:true,nodeIntegration:false};}});}isDestroyed(){return destroyed;}destroy(){destroyed=true;}setBackgroundColor(){}async loadURL(){arrived();await load;}}
  const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(){assert.fail('Unexpected startup failure');}},ipcMain:{},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
   './workbench-service.cjs':{createWorkbenchService:async()=>service},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),
   './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:async()=>service},'./candidate-resize-workbench.cjs':{createCandidateResizeWorkbench:async()=>service},
   '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{}},'../src/ipc.cjs':{registerIpc:()=>()=>{}},'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
  vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:choice==='baseline'?['electron']:['electron','--blue-runtime='+choice],versions:{}},console:{log:(...args)=>logs.push(args),error:()=>assert.fail('Unexpected error')}},{filename:'workbench-main.cjs'});
  await entered;app.emit('before-quit',{preventDefault(){}});assert.deepEqual(exits,[]);release();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.equal(logs.filter(x=>x[0]==='LINUX_WORKBENCH_READY').length,0);assert.equal(readPreferences,0);assert.equal(destroyed,true);assert.deepEqual(exits,[0]);assert.equal(logs.filter(x=>x[0]==='LINUX_WORKBENCH_CLOSED').length,1);
 }
});
