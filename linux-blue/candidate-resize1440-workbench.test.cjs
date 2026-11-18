'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { OutputAccess } = require('../src/output-access.cjs');
const { createCandidateResize1440Workbench, RESTORATION_ROOT } = require('./candidate-resize1440-workbench.cjs');
async function fixture({ missing = false, missingAt = null, rejectFactory = false } = {}) {
  const file = path.join(__dirname, 'candidate-resize1440-workbench.cjs'), source = await fs.readFile(file, 'utf8'), real = createRequire(file), module = { exports: {} };
  const seen = { opened: 0, closed: 0, calls: [], manifest: null, configuration: null };
  const runtime = { close: async () => { seen.closed++; } };
  const service = { getCapabilities: async () => ({ profiles: [{ id: 'h265-cpu', quality: { mode: 'CRF' } }, { id: 'h264-cpu' }], recipes: [{}], vendorProfiles: [{}] }), getPreferences: async () => ({ profileId: 'h264-cpu', settingsByProfile: {}, notices: [] }) };
  const overrides = { 'node:fs/promises': { access: async file => { seen.calls.push(file); if (missing || seen.calls.length === missingAt) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    './candidate-calibration-runtime.cjs': { openCandidateCalibrationRuntime: async manifest => { seen.opened++; seen.manifest = manifest; return runtime; } },
    './candidate-resize1440-service.cjs': { ...real('./candidate-resize1440-service.cjs'), createCandidateResize1440Service: async options => {
      seen.configuration = options; if (rejectFactory) throw new Error('Rejected fixed report'); return service;
    } }, '../src/process-runner.cjs': { runTool: () => { throw new Error('No media'); } } };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: file })(n => overrides[n] || real(n), module, module.exports, __dirname);
  return { seen, runtime, service, api: module.exports };
}
test('fixed ignored restoration and no caller runtime authority', async () => {
  assert.equal(path.dirname(RESTORATION_ROOT), path.join(__dirname, 'artifacts'));
  for (const options of [{ stateDir: '/tmp/test', manifest: {} }, { stateDir: '/tmp/test', ffmpeg: '/tmp/tool' }, { stateDir: '/tmp/test', outputAccess: {} }]) await assert.rejects(createCandidateResize1440Workbench(options), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  let read = false; await assert.rejects(createCandidateResize1440Workbench(Object.defineProperty({ stateDir: '/tmp/test' }, 'onChild', { enumerable: true, get() { read = true; } }))); assert.equal(read, false);
});
test('missing restoration stops before runtime opening; rejected live gates close owner', async () => {
  const a = await fixture({ missing: true }); await assert.rejects(a.api.createCandidateResize1440Workbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED' }); assert.equal(a.seen.opened, 0);
  const b = await fixture({ rejectFactory: true }); await assert.rejects(b.api.createCandidateResize1440Workbench({ stateDir: '/tmp/test' }), /fixed report/); assert.equal(b.seen.closed, 1);
});
test('injected composition binds exact pair/dependencies, isolated CPU tuple and unavailable Remux', async () => {
  const h = await fixture(), outputAccess = new OutputAccess({ openPath() {}, showItemInFolder() {} });
  const service = await h.api.createCandidateResize1440Workbench({ stateDir: '/tmp/test', outputAccess });
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
  for (const choice of ['baseline', '9.0.2-av1', '9.0.2-resize1440-candidate']) {
    const calls = [], baseline = {}, av1 = {}, candidate = {};
    const selected = vm.runInNewContext(expression, { runtimeChoice: choice, createWorkbenchService: baseline,
      require: name => { calls.push(name); return name === './candidate-resize1440-workbench.cjs' ? { createCandidateResize1440Workbench: candidate } : { create1440QualifiedAv1WorkbenchService: av1 }; } });
    assert.equal(selected, choice === 'baseline' ? baseline : choice === '9.0.2-av1' ? av1 : candidate);
    assert.deepEqual(calls, choice === 'baseline' ? [] : [choice === '9.0.2-av1' ? './workbench-av1-service.cjs' : './candidate-resize1440-workbench.cjs']);
  }
  for (const text of ['workbench-preview', 'workbench-av1-preview', 'workbench-resize1440-candidate-preview', 'app.enableSandbox()', 'contextIsolation: true', 'nodeIntegration: false', "path.join(root, 'preload.js')", 'gauge-win-midtone-256.png', "dialog.showErrorBox('Experimental 1440 resize preview unavailable'"]) assert.ok(source.includes(text), text);
  assert.match(source, /developer-resize1440-range/); assert.match(source, /native threading unqualified/);
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
    './candidate-resize1440-workbench.cjs': { createCandidateResize1440Workbench: () => startup },
    '../src/appearance.cjs': { AppearanceSettings: class {} }, '../src/output-access.cjs': { OutputAccess: class {} },
    '../src/ipc.cjs': { registerIpc() { throw new Error('No IPC after close'); } }, '../src/local-protocol.cjs': {} };
  vm.runInNewContext(source, { require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; }, __dirname,
    process: { argv: ['electron', '--blue-runtime=9.0.2-resize1440-candidate'], versions: {} }, console: { log() {}, error() {} } }, { filename: 'workbench-main.cjs' });
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
    await assert.rejects(h.api.createCandidateResize1440Workbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED' });
    assert.equal(h.seen.opened, 0); assert.equal(h.seen.calls.length, missingAt);
  }
});
test('loader override refuses before fixed restoration checks or runtime opening', async () => {
  const h = await fixture(), before = process.env.LD_PRELOAD;
  try {
    process.env.LD_PRELOAD = '/synthetic/not-loaded';
    await assert.rejects(h.api.createCandidateResize1440Workbench({ stateDir: '/tmp/test' }), { code: 'CANDIDATE_WORKBENCH_ENVIRONMENT' });
    assert.equal(h.seen.opened, 0); assert.equal(h.seen.calls.length, 0);
  } finally { if (before === undefined) delete process.env.LD_PRELOAD; else process.env.LD_PRELOAD = before; }
});

test('1440 workbench inspection prevents unqualified Full/Keep execution and gives honest range notice',async()=>{
 const s=await fs.readFile(path.join(__dirname,'candidate-resize1440-service.cjs'),'utf8');
 const classText=s.slice(s.indexOf('class OwnedCandidateService'),s.indexOf('async function createCandidateResize1440Service'));
 class Base {constructor(options){Object.assign(this,options);}snapshot(){return {items:this.state.items};}closeAdmission(){this.admissionClosed=true;}emitState(){this.emitted=true;}async cancelCurrent(){return 'cancelled';}}
 const C=vm.runInNewContext(classText+';OwnedCandidateService',{CandidateTrimService:Base,AggregateError});
 const item={id:'a',status:'ready'},entry={operationPlan:{compatibilityPath:true}};
 const service=new C({state:{items:[item]},plan:{entries:new Map([['a',entry]])}},{},true);
 const snap=service.snapshot();assert.equal(item.status,'unsupported');assert.equal(service.plan.entries.size,0);assert.match(snap.developerResize.notice,/1440p30-to-720p/);
 assert.equal(await service.cancelCurrent(),'cancelled');assert.equal(service.admissionClosed,true);assert.equal(service.emitted,true);
 const good={id:'b',status:'ready'};const valid=new C({state:{items:[good]},plan:{entries:new Map([['b',{qualificationSelection:{},operationRuntimeToken:{},operationPlan:{instrumentation:{}}}]])}},{},true);assert.equal(valid.snapshot().items[0].status,'ready');
 const plain={id:'c',status:'ready'},headless=new C({state:{items:[plain]}},{},false);assert.equal(headless.snapshot().developerResize,undefined);assert.equal(plain.status,'ready');
});
test('1440 runtime is explicit and never permits switching from a standalone candidate',()=>{
 const {selectWorkbenchRuntime,sessionSwitchingEnabled}=require('./workbench-runtime-choice.cjs');
 assert.equal(selectWorkbenchRuntime([]),'baseline');assert.equal(selectWorkbenchRuntime(['--blue-runtime=9.0.2-resize1440-candidate']),'9.0.2-resize1440-candidate');
 assert.throws(()=>sessionSwitchingEnabled(['--blue-runtime=9.0.2-resize1440-candidate','--blue-workbench-session-switching']));
 assert.throws(()=>selectWorkbenchRuntime(['--blue-runtime=9.0.2-resize1440-candidate','--blue-runtime=9.0.2-resize-candidate']));
});
test('1440 session is explicitly offered, drains old owner, and rejects absent factory without fallback',async()=>{
 const {WorkbenchSession}=require('./workbench-session.cjs'),{EventEmitter}=require('node:events');let drained=false,opened=0;
 const factory=()=>Object.assign(new EventEmitter(),{requireIdle(){},closeAdmission(){},async cancelCurrent(){},async closeOperationResources(){drained=true;},async closeDiagnostics(){return {persisted:true};},async initializeDiagnostics(){}});
 const options={ordinary:factory,fullCopy:factory,createAccess:()=>({clear(){}}),publish(){},replaceClosed:true};
 const off=new WorkbenchSession(options);await assert.rejects(off.select('resize-range1440'),{code:'INVALID_REQUEST'});assert.equal(off.status().resizeRange1440Available,false);
 const on=new WorkbenchSession({...options,resizeRange1440:()=>{assert.equal(drained,true);opened++;return factory();}});await on.select('ordinary');await on.select('resize-range1440');assert.equal(opened,1);assert.equal(on.status().selected,'resize-range1440');assert.equal(on.status().resizeRange1440Available,true);
 const recovery=new WorkbenchSession({...options,recoveryOnly:true,resizeRange1440:factory});assert.equal(recovery.status().resizeRange1440Available,false);
});
