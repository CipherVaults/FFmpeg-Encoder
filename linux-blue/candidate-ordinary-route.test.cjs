'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {registerIpc}=require('../src/ipc.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
async function mainFixture({diagnostic,method,picker,resourceFailure=false,missing=false,load,acquire,argv=['--blue-runtime=9.0.2-ordinary-candidate']}={}) {
 const handlers=new Map(),order=[],exits=[],logs=[],errors=[],directories=[],factories=[];let window;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const service=Object.assign(new EventEmitter(),{admissionClosed:false,runtimeIdentity:'synthetic',linuxRemuxStatus:{available:false},initializeDiagnostics:async()=>{},
 closeAdmission(){this.admissionClosed=true;order.push('admission');},cancelCurrent:async()=>{order.push('cancel');},
 closeOperationResources:async()=>{order.push('resources');if(resourceFailure)throw new Error('resources failed');},closeDiagnostics:async()=>{order.push('diagnostics-close');return {persisted:true};},
 recordIncident:async()=>{order.push('incident-start');if(diagnostic)await diagnostic.promise;order.push('incident-end');},
 requireIdle(){if(this.admissionClosed)throw Object.assign(new Error('closed'),{code:'SHUTTING_DOWN'});},
 registerFolder:async()=>{service.requireIdle();order.push('folder-registered');return {};},
 openCompletedOutput:async()=>{order.push('output-action-start');if(method)await method.promise;order.push('output-action-end');return {};},
 getRuntimeInformation:async()=>{order.push('method-start');if(method)await method.promise;order.push('method-end');return {};}});
 const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
 class Window extends EventEmitter {constructor(options){super();window=this;this.options=options;this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;order.push('window-destroy');app.emit('window-all-closed');}setBackgroundColor(){}async loadURL(){if(load)await load.promise;}}
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox:(...args)=>errors.push(args),showOpenDialog:async()=>{order.push('picker-open');return picker.promise;}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync:p=>directories.push(p)},'node:path':path,'./workbench-service.cjs':{createWorkbenchService:async()=>{factories.push('baseline');return service;}},'./candidate-ordinary-service.cjs':{createCandidateOrdinaryService:async options=>{factories.push(options);if(acquire)await acquire.promise;if(missing)throw Object.assign(new Error('fixed candidate missing'),{code:'CANDIDATE_ORDINARY_NOT_RESTORED'});return service;}},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){order.push('appearance-admission');}async flush(){order.push('appearance-flush');}}},'../src/output-access.cjs':{OutputAccess:class{}},'../src/ipc.cjs':{registerIpc},'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8'),{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron',...argv],versions:{}},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
 await tick();const event=window?{sender:window.webContents,senderFrame:window.webContents.mainFrame}:null;
 return {handlers,order,exits,logs,errors,directories,factories,service,get window(){return window;},event,quit:()=>app.emit('before-quit',{preventDefault(){}})};
}

test('exact ordinary route is opt-in, rejects unknown/duplicate/combined switching choices', () => {
 const {selectWorkbenchRuntime,sessionSwitchingEnabled}=require('./workbench-runtime-choice.cjs');
 assert.equal(selectWorkbenchRuntime([]),'baseline');assert.equal(selectWorkbenchRuntime(['--blue-runtime=9.0.2-ordinary-candidate']),'9.0.2-ordinary-candidate');
 for(const argv of [['--blue-runtime=ordinary'],['--blue-runtime=/tmp/tool'],['--blue-runtime=9.0.2-ordinary-candidate','--blue-runtime=9.0.2-ordinary-candidate']])assert.throws(()=>selectWorkbenchRuntime(argv),{code:'LINUX_RUNTIME_CHOICE'});
 assert.throws(()=>sessionSwitchingEnabled(['--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate']),{code:'LINUX_RUNTIME_CHOICE'});
});
test('actual main picks only fixed candidate factory and separate state/title with existing security',async()=>{
 const h=await mainFixture();assert.equal(h.factories.length,1);assert.deepEqual(Object.keys(h.factories[0]).sort(),['onChild','outputAccess','stateDir']);
 assert.ok(h.factories[0].stateDir.endsWith('/artifacts/workbench-ordinary-candidate-preview'));
 assert.match(h.window.options.title,/Experimental ordinary FFmpeg 9.0.2/);assert.match(h.window.options.title,/Cancel requires relaunch/);
 const w=h.window.options.webPreferences;assert.equal(w.sandbox,true);assert.equal(w.contextIsolation,true);assert.equal(w.nodeIntegration,false);assert.equal(w.webSecurity,true);
 assert.ok(h.logs.some(x=>x[0]==='LINUX_WORKBENCH_READY'&&x[1].includes('developer-ordinary-cpu-full-sdr')));
 h.quit();await tick();await tick();assert.deepEqual(h.exits,[0]);
});
test('actual main keeps baseline default and reports candidate missing without fallback',async()=>{
 const base=await mainFixture({argv:[]});assert.deepEqual(base.factories,['baseline']);base.quit();await tick();await tick();
 const h=await mainFixture({missing:true});await tick();await tick();assert.equal(h.window,undefined);assert.equal(h.factories.length,1);
 assert.match(h.errors[0][0],/ordinary 9.0.2 preview unavailable/);assert.deepEqual(h.exits,[1]);assert.ok(!h.logs.some(x=>x[0]==='LINUX_WORKBENCH_READY'));
});
test('candidate actual-main admitted diagnostic drains before repeated Quit closes resources',async()=>{
 const diagnostic=deferred(),h=await mainFixture({diagnostic});const captured=h.handlers.get('encoder:runtime-information'),request=captured(h.event,'extra');await tick();h.quit();h.quit();await tick();
 assert.equal(h.service.admissionClosed,true);assert.deepEqual(h.exits,[]);assert.ok(!h.order.includes('resources'));
 const late=await captured(h.event);assert.equal(late.ok,false);assert.equal(late.error.code,'SHUTTING_DOWN');
 diagnostic.resolve();assert.equal((await request).error.code,'INVALID_REQUEST');await tick();await tick();assert.deepEqual(h.exits,[0]);assert.ok(h.order.indexOf('incident-end')<h.order.indexOf('resources'));
});
test('close during candidate acquisition or load never logs late READY and closes owner once',async()=>{
 for(const phase of ['acquire','load']){
  const pending=deferred(),h=await mainFixture({[phase]:pending});h.quit();await tick();assert.deepEqual(h.exits,[]);pending.resolve();await tick();await tick();await tick();
  assert.deepEqual(h.exits,[0]);assert.equal(h.order.filter(x=>x==='resources').length,1);assert.ok(!h.logs.some(x=>x[0]==='LINUX_WORKBENCH_READY'));
 }
});
