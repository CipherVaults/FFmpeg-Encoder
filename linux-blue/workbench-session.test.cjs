'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WorkbenchSession } = require('./workbench-session.cjs');
const { sessionSwitchingEnabled, selectWorkbenchRuntime } = require('./workbench-runtime-choice.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function fixture(overrides = {}) {
  const events = [], services = [], accesses = [], updates = [];
  const create = async kind => {
    const service = Object.assign(new EventEmitter(), { kind, busy: false, admissionClosed: false,
      requireIdle() { if (this.busy || this.admissionClosed) throw Object.assign(new Error('busy'), {code:'BUSY'}); },
      closeAdmission() { this.admissionClosed = true; events.push(`${kind}:admission`); },
      async initializeDiagnostics() {}, async cancelCurrent() { events.push(`${kind}:cancel`); },
      async closeOperationResources() { events.push(`${kind}:resources`); },
      async closeDiagnostics() { events.push(`${kind}:diagnostics`); return {persisted:true}; },
    }); services.push(service); return service;
  };
  const owner = new WorkbenchSession({ ordinary: () => create('ordinary'), fullCopy: () => create('full-copy'),
    createAccess() { const access = { grants:new Set(['old-token']), clear() { this.grants.clear(); events.push('access:clear'); } }; accesses.push(access); return access; },
    publish: value => updates.push(value), ...overrides });
  return {owner, events, services, accesses, updates, create};
}
test('opt-in exact flag leaves ordinary default and old AV1 selector unchanged', () => {
  assert.equal(sessionSwitchingEnabled([]),false); assert.equal(selectWorkbenchRuntime([]),'baseline');
  assert.equal(selectWorkbenchRuntime(['--blue-runtime=9.0.2-av1']),'9.0.2-av1');
  assert.equal(sessionSwitchingEnabled(['--blue-workbench-session-switching']),true);
  for (const args of [['--blue-workbench-session-switching=x'],['--blue-workbench-session-switching','--blue-workbench-session-switching'],['--blue-workbench-session-switching','--blue-runtime=9.0.2-av1']]) assert.throws(()=>sessionSwitchingEnabled(args));
});
test('idle switching drains old owner, revokes access and fences saved callbacks', async()=>{
  const f=fixture(); const old=await f.owner.select('ordinary'); const callback=f.owner.owner.listener;
  old.plan={planId:'retired-plan'}; old.emit('update',1); const next=await f.owner.select('full-copy'); callback(2); old.emit('update',3); next.emit('update',4);
  assert.deepEqual(f.updates,[1,4]); assert.equal(old.admissionClosed,true); assert.equal(old.plan,null); assert.equal(f.accesses[0].grants.size,0);
  assert.throws(()=>old.requireIdle()); assert.deepEqual(f.events.slice(0,5),['ordinary:admission','access:clear','ordinary:cancel','ordinary:resources','ordinary:diagnostics']);
});
test('busy and invalid transitions keep old owner untouched',async()=>{
  const f=fixture(); const old=await f.owner.select('ordinary'); old.busy=true;
  await assert.rejects(f.owner.select('full-copy'),{code:'BUSY'}); await assert.rejects(f.owner.select('../anything'),{code:'INVALID_REQUEST'});
  assert.equal(f.owner.owner.service,old); assert.deepEqual(f.events,[]);
});
test('duplicate transition refused while old resource drain pending',async()=>{
  const f=fixture(); const old=await f.owner.select('ordinary'), gate=deferred(); old.closeOperationResources=()=>gate.promise;
  const pending=f.owner.select('full-copy'); await assert.rejects(f.owner.select('ordinary'),{code:'BUSY'});
  assert.equal(f.owner.owner,null); gate.resolve(); await pending;
});
test('missing candidate remains unavailable with explicit ordinary recovery, no fallback',async()=>{
  const f=fixture({fullCopy:async()=>{throw new Error('Missing fixed inputs');}}); await f.owner.select('ordinary');
  await assert.rejects(f.owner.select('full-copy'),/Missing fixed inputs/); assert.equal(f.owner.owner,null);
  assert.equal(f.services.length,1); await f.owner.select('ordinary'); assert.equal(f.services.length,2);
});
test('failed old cleanup drains remaining steps then permanently blocks replacement',async()=>{
  const f=fixture(); const old=await f.owner.select('ordinary'); old.cancelCurrent=async()=>{throw new Error('cancel failed');};
  await assert.rejects(f.owner.select('full-copy'),/cleanup failed/); assert.ok(f.events.includes('ordinary:diagnostics'));
  await assert.rejects(f.owner.select('ordinary'),{code:'SESSION_CLEANUP_FAILED'}); assert.equal(f.services.length,1);
});
test('close during acquisition closes late owner and never publishes',async()=>{
  const gate=deferred(), f=fixture(); f.owner.factories['full-copy']=async()=>{await gate.promise; return f.create('late');};
  await f.owner.select('ordinary'); const pending=f.owner.select('full-copy'); await new Promise(r=>setImmediate(r));
  f.owner.beginClose(); gate.resolve(); await assert.rejects(pending,{code:'SHUTTING_DOWN'});
  assert.equal(f.owner.owner,null); assert.equal(f.services[1].admissionClosed,true); assert.ok(f.events.includes('late:diagnostics'));
});
test('diagnostic initialization failure retires acquired owner',async()=>{
  const f=fixture(); f.owner.factories['full-copy']=async()=>{const s=await f.create('failed'); s.initializeDiagnostics=async()=>{throw new Error('init');};return s;};
  await assert.rejects(f.owner.select('full-copy'),/init/); assert.equal(f.owner.owner,null); assert.ok(f.events.includes('failed:resources'));
});

test('IPC fences active operations, blocked transitions and retired captured handlers',async()=>{
  const {registerIpc}=require('../src/ipc.cjs'), handlers=new Map(), gate=deferred(); let blocked=false, selected=0, starts=0;
  const frame={url:'app://encoder/index.html'}, window={isDestroyed:()=>false,webContents:{mainFrame:frame}}, event={sender:window.webContents,senderFrame:frame};
  const unregister=registerIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window,entryUrl:frame.url,
    service:{getRuntimeInformation:()=>gate.promise,startBatch:()=>{starts++;}},appearance:{},dialog:{},
    workbenchSession:{status:()=>({enabled:true}),blocked:()=>blocked,select:()=>{selected++;}}});
  const pending=handlers.get('encoder:runtime-information')(event);
  assert.equal((await handlers.get('encoder:select-workbench-session')(event,'full-copy')).error.code,'BUSY');
  gate.resolve({}); await pending; assert.equal((await handlers.get('encoder:select-workbench-session')(event,'full-copy')).ok,true);
  blocked=true; assert.equal((await handlers.get('encoder:start')(event,{})).error.code,'BUSY');
  const stale=handlers.get('encoder:start'); unregister(); blocked=false;
  assert.equal((await stale(event,{})).error.code,'SESSION_RETIRED'); assert.equal(starts,0);assert.equal(selected,1);
});

test('actual main handoff destroys old document and permits replacement startup reads before load settles',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[];let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const create=async kind=>{const s=await f.create(kind);Object.assign(s,{linuxRemuxStatus:{available:false},runtimeIdentity:kind,getRuntimeInformation:()=>({kind})});return s;};
 const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
 class Window extends EventEmitter {
  constructor(){super();windows.push(this);this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}
  isDestroyed(){return this.destroyed;} destroy(){this.destroyed=true;app.emit('window-all-closed');}setBackgroundColor(){}setTitle(){}
  async loadURL(){const event={sender:this.webContents,senderFrame:this.webContents.mainFrame};
    if(oldEvent) assert.equal((await handlers.get('encoder:runtime-information')(oldEvent)).error.code,'UNTRUSTED_SENDER');
    startupReads.push(await handlers.get('encoder:runtime-information')(event));oldEvent=event;
  }
 }
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(){assert.fail('unexpected failure');}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
 './workbench-service.cjs':{createWorkbenchService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const selected=await handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');assert.equal(selected.ok,true);
 assert.equal(windows.length,2);assert.equal(windows[0].destroyed,true);assert.equal(windows[1].destroyed,false);
 assert.equal(startupReads[1].ok,true);assert.equal(startupReads[1].value.kind,'full-copy');
 assert.equal((await oldHandler(firstEvent)).error.code,'SESSION_RETIRED');assert.deepEqual(exits,[]);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});

test('actual main replacement-window construction failure closes new owner and exits explicitly',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[], errors=[];let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const create=async kind=>{const s=await f.create(kind);Object.assign(s,{linuxRemuxStatus:{available:false},runtimeIdentity:kind,getRuntimeInformation:()=>({kind})});return s;};
 const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
 class Window extends EventEmitter {
  constructor(){super();if(windows.length) throw new Error("synthetic window failure");windows.push(this);this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}
  isDestroyed(){return this.destroyed;} destroy(){this.destroyed=true;app.emit('window-all-closed');}setBackgroundColor(){}setTitle(){}
  async loadURL(){const event={sender:this.webContents,senderFrame:this.webContents.mainFrame};
    if(oldEvent) assert.equal((await handlers.get('encoder:runtime-information')(oldEvent)).error.code,'UNTRUSTED_SENDER');
    startupReads.push(await handlers.get('encoder:runtime-information')(event));oldEvent=event;
  }
 }
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(...args){errors.push(args);}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
 './workbench-service.cjs':{createWorkbenchService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const selected=await handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy'); assert.equal(selected.ok,false);
 await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
 assert.equal(windows[0].destroyed,true); assert.equal(f.services[1].admissionClosed,true);
 assert.ok(f.events.includes('full-copy:resources')); assert.deepEqual(exits,[1]);assert.equal(errors.length,1);
});

test('actual main quit during pending replacement acquisition drains late owner without replacement window',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[], acquisition=deferred();let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const create=async kind=>{if(kind==='full-copy') await acquisition.promise;const s=await f.create(kind);Object.assign(s,{linuxRemuxStatus:{available:false},runtimeIdentity:kind,getRuntimeInformation:()=>({kind})});return s;};
 const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
 class Window extends EventEmitter {
  constructor(){super();windows.push(this);this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}
  isDestroyed(){return this.destroyed;} destroy(){this.destroyed=true;app.emit('window-all-closed');}setBackgroundColor(){}setTitle(){}
  async loadURL(){const event={sender:this.webContents,senderFrame:this.webContents.mainFrame};
    if(oldEvent) assert.equal((await handlers.get('encoder:runtime-information')(oldEvent)).error.code,'UNTRUSTED_SENDER');
    startupReads.push(await handlers.get('encoder:runtime-information')(event));oldEvent=event;
  }
 }
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(){assert.fail('unexpected failure');}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
 './workbench-service.cjs':{createWorkbenchService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const pending=handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');
 await new Promise(r=>setImmediate(r)); app.emit('before-quit',{preventDefault(){}}); acquisition.resolve();
 await pending; await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
 assert.equal(windows.length,1); assert.equal(windows[0].destroyed,true);assert.equal(f.services[1].admissionClosed,true);
 assert.ok(f.events.includes('full-copy:resources'));assert.deepEqual(exits,[0]);
});

test('replacement window close during its load is not suppressed as an old-window retirement',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[], replacementLoad=deferred();let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const create=async kind=>{const s=await f.create(kind);Object.assign(s,{linuxRemuxStatus:{available:false},runtimeIdentity:kind,getRuntimeInformation:()=>({kind})});return s;};
 const local=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDevicePermissionHandler(){},protocol:{},webRequest:{onBeforeRequest(){}}});
 class Window extends EventEmitter {
  constructor(){super();windows.push(this);this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'app://local/index.html'},setWindowOpenHandler(){},isDestroyed:()=>this.destroyed,send(){},getLastWebPreferences:()=>({sandbox:true})});}
  isDestroyed(){return this.destroyed;} destroy(){this.destroyed=true;app.emit('window-all-closed');}setBackgroundColor(){}setTitle(){}
  async loadURL(){const event={sender:this.webContents,senderFrame:this.webContents.mainFrame};
    if(oldEvent) assert.equal((await handlers.get('encoder:runtime-information')(oldEvent)).error.code,'UNTRUSTED_SENDER');
    startupReads.push(await handlers.get('encoder:runtime-information')(event));oldEvent=event; if(windows.length===2) await replacementLoad.promise;
  }
 }
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(){assert.fail('unexpected failure');}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
 './workbench-service.cjs':{createWorkbenchService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const pending=handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');
 await new Promise(r=>setImmediate(r)); assert.equal(windows.length,2);let prevented=false;
 windows[1].emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,true);
 replacementLoad.resolve();await pending;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(windows[1].destroyed,true);assert.equal(f.services[1].admissionClosed,true);assert.deepEqual(exits,[0]);
});

test('named preload session methods retain envelopes, not arbitrary IPC routing',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');let api;const calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preload.js'),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'encoder');api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true,value:{enabled:true}};}}};}});
 await api.getWorkbenchSession();await api.selectWorkbenchSession('full-copy');
 assert.deepEqual(calls,[['encoder:workbench-session'],['encoder:select-workbench-session','full-copy']]);assert.equal(api.invoke,undefined);
});
test('production opt-in control block stays hidden by default and offers explicit recovery after missing inputs',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../ui/renderer.js'),'utf8');
 const block=source.slice(source.indexOf('  // Absent on ordinary/default and Windows main'),source.lastIndexOf('})();'));
 function element(){return {children:[],events:{},appendChild(child){this.children.push(child);},addEventListener(name,fn){this.events[name]=fn;}};}
 for(const enabled of [false,true]){
  const body=element(),calls=[],api={getWorkbenchSession:async()=>({enabled,selected:'ordinary',notice:'Explicit reset'}),selectWorkbenchSession:async kind=>{calls.push(kind);throw new Error('Missing fixed inputs');}};
  vm.runInNewContext(block,{api,document:{body,createElement:element}});await new Promise(r=>setImmediate(r));
  assert.equal(body.children.length,enabled?1:0);
  if(enabled){const [notice,ordinary,candidate]=body.children[0].children;assert.equal(ordinary.disabled,true);await candidate.events.click();assert.deepEqual(calls,['full-copy']);assert.equal(notice.textContent,'Missing fixed inputs');assert.equal(ordinary.disabled,false);}
 }
});

test('trusted rejection diagnostics drain before transition and retirement creates no old-owner incident',async()=>{
 const {registerIpc}=require('../src/ipc.cjs'),handlers=new Map(),held=deferred();let logging=0,selected=0,blocked=false;
 const frame={url:'app://encoder/index.html'},window={isDestroyed:()=>false,webContents:{mainFrame:frame}},event={sender:window.webContents,senderFrame:frame};
 const service={admissionClosed:false,recordIncident:async()=>{logging++;await held.promise;},snapshot:()=>({phase:'idle'})};
 registerIpc({ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},window,entryUrl:frame.url,service,appearance:{},dialog:{},
 workbenchSession:{status:()=>({enabled:true}),blocked:()=>blocked,select:()=>{selected++;}}});
 const rejected=handlers.get('encoder:snapshot')(event,'extra');await new Promise(r=>setImmediate(r));assert.equal(logging,1);
 const transition=handlers.get('encoder:select-workbench-session')(event,'full-copy');
 const result=await Promise.race([transition,new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),50))]);
 assert.equal(result.error?.code,'BUSY');assert.equal(selected,0);assert.equal(logging,1);
 held.resolve();assert.equal((await rejected).error.code,'INVALID_REQUEST');
 assert.equal((await handlers.get('encoder:select-workbench-session')(event,'full-copy')).ok,true);assert.equal(selected,1);
 blocked=true;assert.equal((await handlers.get('encoder:snapshot')(event)).error.code,'BUSY');assert.equal(logging,1);
 assert.equal((await handlers.get('encoder:snapshot')(event,'extra')).error.code,'INVALID_REQUEST');assert.equal(logging,1);
 blocked=false;service.admissionClosed=true;
 assert.equal((await handlers.get('encoder:snapshot')(event,'extra')).error.code,'INVALID_REQUEST');assert.equal(logging,1);
 assert.equal((await handlers.get('encoder:snapshot')({...event,sender:{}},'extra')).error.code,'UNTRUSTED_SENDER');assert.equal(logging,1);
});
