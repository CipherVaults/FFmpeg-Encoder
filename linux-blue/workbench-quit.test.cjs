'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {registerIpc}=require('../src/ipc.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
async function mainFixture({diagnostic,method,picker,resourceFailure=false}={}) {
 const handlers=new Map(),order=[],exits=[],logs=[];let window;
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
 class Window extends EventEmitter {constructor(){super();window=this;this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;order.push('window-destroy');app.emit('window-all-closed');}setBackgroundColor(){}async loadURL(){}}
 const modules={electron:{app,BrowserWindow:Window,dialog:{showOpenDialog:async()=>{order.push('picker-open');return picker.promise;}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,'./workbench-service.cjs':{createWorkbenchService:async()=>service},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){order.push('appearance-admission');}async flush(){order.push('appearance-flush');}}},'../src/output-access.cjs':{OutputAccess:class{}},'../src/ipc.cjs':{registerIpc},'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8'),{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron'],versions:{}},console:{log:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}});
 await tick();const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
 return {handlers,order,exits,logs,service,window,event,quit:()=>app.emit('before-quit',{preventDefault(){}})};
}
test('actual main waits for admitted trusted rejection diagnostic before resource closure',async()=>{
 const diagnostic=deferred(),h=await mainFixture({diagnostic});const request=h.handlers.get('encoder:runtime-information')(h.event,'extra');await tick();h.quit();h.quit();await tick();
 assert.ok(h.order.includes('cancel'));assert.equal(h.service.admissionClosed,true);assert.deepEqual(h.exits,[]);assert.ok(!h.order.includes('resources'));
 diagnostic.resolve();assert.equal((await request).error.code,'INVALID_REQUEST');await tick();await tick();
 assert.deepEqual(h.exits,[0]);assert.ok(h.order.indexOf('incident-end')<h.order.indexOf('resources'));assert.equal(h.order.filter(x=>x==='cancel').length,1);
});
test('actual main refuses new admission while held method drains; no fake completed close',async()=>{
 const method=deferred(),h=await mainFixture({method});const captured=h.handlers.get('encoder:runtime-information'),request=captured(h.event);await tick();h.quit();await tick();
 const late=await captured(h.event);assert.equal(late.ok,false);assert.equal(late.error.code,'SHUTTING_DOWN');assert.deepEqual(h.exits,[]);assert.ok(!h.logs.some(x=>x[0]==='LINUX_WORKBENCH_CLOSED'));
 method.resolve();await request;await tick();await tick();assert.deepEqual(h.exits,[0]);assert.ok(h.order.indexOf('method-end')<h.order.indexOf('resources'));
});
test('pending diagnostic persistence failure is not lost during close',async()=>{
 const diagnostic=deferred(),h=await mainFixture({diagnostic});const request=h.handlers.get('encoder:runtime-information')(h.event,'extra');const rejected=assert.rejects(request,/disk failure/);await tick();h.quit();diagnostic.reject(new Error('disk failure'));await rejected;await tick();await tick();
 assert.deepEqual(h.exits,[1]);assert.ok(h.order.includes('diagnostics-close'));
});
test('resource failure remains failed after admitted calls settle',async()=>{
 const method=deferred(),h=await mainFixture({method,resourceFailure:true});const request=h.handlers.get('encoder:runtime-information')(h.event);h.quit();method.resolve();await request;await tick();await tick();assert.deepEqual(h.exits,[1]);assert.equal(h.order.filter(x=>x==='resources').length,1);assert.equal(h.order.filter(x=>x==='diagnostics-close').length,1);
});

test('actual picker admitted before quit settles without registering a late folder',async()=>{
 const picker=deferred(),h=await mainFixture({picker});const request=h.handlers.get('encoder:input-folder')(h.event);await tick();assert.ok(h.order.includes('picker-open'));h.quit();await tick();assert.deepEqual(h.exits,[]);
 picker.resolve({canceled:false,filePaths:['/synthetic/late']});assert.equal((await request).error.code,'SHUTTING_DOWN');await tick();await tick();
 assert.ok(!h.order.includes('folder-registered'));assert.deepEqual(h.exits,[0]);
});

test('admitted output action settles before final diagnostics; no OS shell is executed',async()=>{
 const method=deferred(),h=await mainFixture({method});const request=h.handlers.get('encoder:open-completed-output')(h.event,{outputId:'synthetic'});await tick();h.quit();await tick();assert.deepEqual(h.exits,[]);
 method.resolve();await request;await tick();await tick();assert.ok(h.order.indexOf('output-action-end')<h.order.indexOf('diagnostics-close'));assert.deepEqual(h.exits,[0]);
});
