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
 for (const kind of ['ordinary','full-copy']) for (const phase of ['cancel','resources','diagnostics'])
  assert.equal(f.events.filter(value=>value===`${kind}:${phase}`).length,1,`${kind} ${phase} closes exactly once`);
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
  const body=element(),calls=[],api={getWorkbenchSession:async()=>({enabled,selected:calls.length?null:'ordinary',notice:'Explicit reset'}),selectWorkbenchSession:async kind=>{calls.push(kind);throw new Error('Missing fixed inputs');}};
  const context={api,document:{body,createElement:element},render(){const c=context.developerSessionChoices;if(c)for(const row of c.buttons)row.button.disabled=c.pending||c.selected===row.kind;}};
  vm.runInNewContext(block,context);await new Promise(r=>setImmediate(r));
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

test('candidate recovery retires admission-closed owner before fresh acquisition and fences old grants/events',async()=>{
 const gate=deferred();let live=0;
 const f=fixture({recoveryOnly:true,verifyDrained(){if(live)throw new Error('live child');}});
 const old=await f.owner.select('ordinary'), listener=f.owner.owner.listener;
 // Actual shared admission guard, not a permissive mock.
 old.requireIdle=require('../src/encoder-service.cjs').EncoderService.prototype.requireIdle;
 await assert.rejects(f.owner.select('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 old.closeAdmission();assert.throws(()=>old.requireIdle(),{code:'SHUTTING_DOWN'});
 old.closeOperationResources=()=>gate.promise;
 const pending=f.owner.select('restart-ordinary');assert.equal(f.services.length,1);assert.equal(f.accesses[0].grants.size,0);
 await assert.rejects(f.owner.select('restart-ordinary'),{code:'BUSY'});listener('stale');assert.deepEqual(f.updates,[]);
 gate.resolve();const next=await pending;assert.notEqual(next,old);assert.equal(next.admissionClosed,false);assert.equal(old.admissionClosed,true);
 assert.equal(f.services.length,2);await assert.rejects(f.owner.select('full-copy'),{code:'INVALID_REQUEST'});
});
test('recovery is absent on baseline switching and cleanup or live children prohibit new owner',async()=>{
 const normal=fixture();await normal.owner.select('ordinary');await assert.rejects(normal.owner.select('restart-ordinary'),{code:'INVALID_REQUEST'});
 for(const mode of ['resources','children']){
  let active=false;const f=fixture({recoveryOnly:true,verifyDrained(){if(active&&mode==='children')throw new Error('live child');}});const old=await f.owner.select('ordinary');active=true;old.closeAdmission();
  if(mode==='resources')old.closeOperationResources=async()=>{throw new Error('closure');};
  await assert.rejects(f.owner.select('restart-ordinary'));assert.equal(f.services.length,1);assert.equal(f.owner.owner.service,old,'failed owner remains owned for final shutdown');await assert.rejects(f.owner.select('restart-ordinary'),{code:'SESSION_CLEANUP_FAILED'});
 }
});
test('recovery pending closure never acquires; close during fresh acquisition retires late owner',async()=>{
 const drain=deferred(),acquire=deferred();const f=fixture({recoveryOnly:true});const old=await f.owner.select('ordinary');old.closeAdmission();old.closeOperationResources=()=>drain.promise;
 f.owner.factories.ordinary=async()=>{await acquire.promise;return f.create('fresh');};const pending=f.owner.select('restart-ordinary');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);
 drain.resolve();await new Promise(r=>setImmediate(r));f.owner.beginClose();acquire.resolve();await assert.rejects(pending,{code:'SHUTTING_DOWN'});assert.equal(f.owner.owner,null);assert.equal(f.services[1].admissionClosed,true);
});

test('actual candidate main recovery uses fresh fixed factory and preload bridge, replacing cancelled document',async()=>{
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{constructor(){this.clears=0;f.accesses.push(this);}clear(){this.clears++;}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 const oldPlan={id:'retained-plan'}, oldAccess=f.accesses[0];f.services[0].plan=oldPlan;const priorClears=oldAccess.clears;
 const beforeWindow=windows[0],beforeService=f.services[0],beforeEvents=[...f.events];
 await assert.rejects(api.selectWorkbenchSession('ordinary'),{code:'INVALID_REQUEST'});
 assert.equal(f.services.length,1);assert.equal(windows.length,1);assert.equal(windows[0],beforeWindow);assert.equal(beforeWindow.destroyed,false);
 assert.equal(f.services[0],beforeService);assert.equal(beforeService.plan,oldPlan);assert.deepEqual(f.events,beforeEvents);assert.equal(f.accesses.length,1);assert.equal(f.accesses[0],oldAccess);assert.equal(oldAccess.clears,priorClears);

 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 f.services[0].closeAdmission();
 await api.selectWorkbenchSession('restart-ordinary');assert.equal(f.services.length,2);assert.equal(f.services[0].admissionClosed,true);assert.equal(f.services[1].admissionClosed,false);
 assert.equal(windows.length,2);assert.equal(windows[0].destroyed,true);assert.equal(windows[1].destroyed,false);
 assert.equal(startupReads[1].ok,true);assert.equal(startupReads[1].value.kind,'candidate');
 assert.equal((await oldHandler(firstEvent)).error.code,'SESSION_RETIRED');assert.deepEqual(exits,[]);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});


test('candidate restart IPC refuses pending picker, forged frame, extra arguments and retired handler',async()=>{
 const {registerIpc}=require('../src/ipc.cjs');const f=fixture({recoveryOnly:true});const service=await f.owner.select('ordinary');
 const picker=deferred(),handlers=new Map(),frame={url:'app://encoder/index.html'},window={isDestroyed:()=>false,webContents:{mainFrame:frame}};
 Object.assign(service,{registerFolder:async()=>({id:'owned'}),recordIncident:async()=>{}});
 const event={sender:window.webContents,senderFrame:frame};const unregister=registerIpc({ipcMain:{handle:(n,x)=>handlers.set(n,x),removeHandler:n=>handlers.delete(n)},window,service,entryUrl:frame.url,dialog:{showOpenDialog:()=>picker.promise},appearance:{},workbenchSession:{status:()=>f.owner.status(),blocked:()=>f.owner.transitioning,select:k=>f.owner.select(k)}});
 const choosing=handlers.get('encoder:input-folder')(event);await new Promise(r=>setImmediate(r));service.closeAdmission();
 const restart=handlers.get('encoder:select-workbench-session');assert.equal((await restart(event,'restart-ordinary')).error.code,'BUSY');assert.equal(f.services.length,1);
 picker.resolve({canceled:true,filePaths:[]});await choosing;
 assert.equal((await restart({...event,senderFrame:{url:frame.url}},'restart-ordinary')).error.code,'UNTRUSTED_SENDER');
 assert.equal((await restart(event,'restart-ordinary','extra')).error.code,'INVALID_REQUEST');assert.equal(f.services.length,1);
 unregister();assert.equal((await restart(event,'restart-ordinary')).error.code,'SESSION_RETIRED');assert.equal(f.services.length,1);
});

test('actual candidate main close during retirement waits for owner drainage without new acquisition',async()=>{
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 const drainage=deferred();f.services[0].closeAdmission();f.services[0].closeOperationResources=()=>drainage.promise;
 const restart=api.selectWorkbenchSession('restart-ordinary');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[]);
 drainage.resolve();await restart;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[0]);assert.equal(f.services.length,1);assert.equal(windows.length,1);assert.equal(windows[0].destroyed,true);
});

test('actual candidate main waits for cancellation and rejects a second restart',async()=>{
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 const waiting=deferred();f.services[0].closeAdmission();f.services[0].cancelCurrent=()=>waiting.promise;
 const restart=api.selectWorkbenchSession('restart-ordinary');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);assert.equal(windows.length,1);
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'BUSY'});assert.equal(f.services.length,1);
 waiting.resolve({persisted:true});await restart;assert.equal(f.services.length,2);assert.equal(windows.length,2);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});

test('actual candidate main waits for diagnostics and rejects a second restart',async()=>{
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 const waiting=deferred();f.services[0].closeAdmission();f.services[0].closeDiagnostics=()=>waiting.promise;
 const restart=api.selectWorkbenchSession('restart-ordinary');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);assert.equal(windows.length,1);
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'BUSY'});assert.equal(f.services.length,1);
 waiting.resolve({persisted:true});await restart;assert.equal(f.services.length,2);assert.equal(windows.length,2);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});

test('actual candidate main refuses acquisition when an observed child remains live',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[];let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const child=new EventEmitter();
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:options=>{options.onChild(child);return create('candidate');}},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 f.services[0].closeAdmission();await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),/owned media child remains live/);assert.equal(f.services.length,1);assert.equal(windows.length,1);
 child.emit('close');await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'SESSION_CLEANUP_FAILED'});
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[1],'failed transition remains a shutdown failure even after child eventually closes');
});

test('actual candidate main close during fresh acquisition retires late service and never displays it',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
 const source=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
 const f=fixture(),handlers=new Map(),windows=[],logs=[],exits=[],startupReads=[];let oldEvent;
 const app=Object.assign(new EventEmitter(),{enableSandbox(){},disableHardwareAcceleration(){},setPath(){},whenReady:async()=>{},requestSingleInstanceLock:()=>true,isReady:()=>true,exit:n=>exits.push(n),quit(){}});
 const acquiring=deferred();
 const create=async kind=>{if(f.services.length)await acquiring.promise;const s=await f.create(kind);Object.assign(s,{linuxRemuxStatus:{available:false},runtimeIdentity:kind,getRuntimeInformation:()=>({kind})});return s;};
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).recoveryOnly,true);
 await assert.rejects(api.selectWorkbenchSession('full-copy'),{code:'INVALID_REQUEST'});
 await assert.rejects(api.selectWorkbenchSession('restart-ordinary'),{code:'RECOVERY_NOT_REQUIRED'});
 f.services[0].closeAdmission();const restart=api.selectWorkbenchSession('restart-ordinary');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[]);
 acquiring.resolve();await restart;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);assert.equal(f.services.length,2);assert.equal(f.services[1].admissionClosed,true);assert.equal(windows.length,1);
});

test('fresh ordinary recovery clears a genuine old output grant before pending resource settlement',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');const {OutputAccess}=require('../src/output-access.cjs'),{readSourceIdentity}=require('../src/source-identity.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-recovery-access-'));
 try{const file=path.join(dir,'owned.mkv');await fs.writeFile(file,Buffer.alloc(2048,7));let calls=0;
 const f=fixture({recoveryOnly:true,createAccess:()=>new OutputAccess({openPath:async()=>{throw new Error('No player');},showItemInFolder:async()=>{calls++;}})});const old=await f.owner.select('ordinary'),access=f.owner.owner.access,identity=await readSourceIdentity(file);
 const grant=await access.issue({file:identity.canonicalPath,identity});const drain=deferred();old.closeAdmission();old.closeOperationResources=()=>drain.promise;
 const recovery=f.owner.select('restart-ordinary');await assert.rejects(access.action({...grant,action:'reveal'}),{code:'OUTPUT_ACCESS_EXPIRED'});assert.equal(calls,0);
 drain.resolve();await recovery;await assert.rejects(f.owner.owner.access.action({...grant,action:'reveal'}),{code:'OUTPUT_ACCESS_EXPIRED'});assert.equal(calls,0);
 }finally{await fs.rm(dir,{recursive:true});}
});

// Current 9.0.2 composition: cancelled owners are replaced, never reopened.
test('candidate selector explicitly accepts ordinary902 and drains closed owner before fresh selection', async()=>{
 assert.equal(sessionSwitchingEnabled(['--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate']),true);
 const f=fixture({replaceClosed:true}),old=await f.owner.select('ordinary'),gate=deferred();old.admissionClosed=true;
 old.closeOperationResources=()=>gate.promise;
 const pending=f.owner.select('ordinary');await new Promise(r=>setImmediate(r));
 assert.equal(f.services.length,1);assert.equal(f.accesses[0].grants.size,0);
 gate.resolve();const fresh=await pending;assert.notEqual(fresh,old);assert.equal(f.services.length,2);
 fresh.admissionClosed=true;fresh.busy=true;
 await assert.rejects(f.owner.select('full-copy'),{code:'BUSY'});assert.equal(f.owner.owner.service,fresh);
 fresh.busy=false;await f.owner.select('full-copy');assert.equal(f.owner.owner.kind,'full-copy');
});

test('candidate902 actual main handoff destroys old document and permits replacement startup reads before load settles',async()=>{
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
 './workbench-service.cjs':{createWorkbenchService:()=>assert.fail('No baseline fallback')},'./candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const selected=await handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');assert.equal(selected.ok,true);
 assert.equal(windows.length,2);assert.equal(windows[0].destroyed,true);assert.equal(windows[1].destroyed,false);
 assert.equal(startupReads[1].ok,true);assert.equal(startupReads[1].value.kind,'full-copy');
 assert.equal((await oldHandler(firstEvent)).error.code,'SESSION_RETIRED');assert.deepEqual(exits,[]);
 const back=await handlers.get('encoder:select-workbench-session')(oldEvent,'ordinary');assert.equal(back.ok,true);assert.equal(windows.length,3);assert.equal(startupReads[2].value.kind,'ordinary');
 f.services[2].admissionClosed=true;const restarted=await handlers.get('encoder:select-workbench-session')(oldEvent,'ordinary');assert.equal(restarted.ok,true);assert.equal(windows.length,4);assert.notEqual(f.services[3],f.services[2]);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});

test('candidate902 actual main quit during pending replacement acquisition drains late owner without replacement window',async()=>{
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
 './workbench-service.cjs':{createWorkbenchService:()=>assert.fail('No baseline fallback')},'./candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const pending=handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');
 await new Promise(r=>setImmediate(r)); app.emit('before-quit',{preventDefault(){}}); acquisition.resolve();
 await pending; await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
 assert.equal(windows.length,1); assert.equal(windows[0].destroyed,true);assert.equal(f.services[1].admissionClosed,true);
 assert.ok(f.events.includes('full-copy:resources'));assert.deepEqual(exits,[0]);
 for (const kind of ['ordinary','full-copy']) for (const phase of ['cancel','resources','diagnostics'])
  assert.equal(f.events.filter(value=>value===`${kind}:${phase}`).length,1,`${kind} ${phase} closes exactly once`);
});

test('candidate902 actual main replacement-window construction failure closes new owner and exits explicitly',async()=>{
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
 './workbench-service.cjs':{createWorkbenchService:()=>assert.fail('No baseline fallback')},'./candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const selected=await handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy'); assert.equal(selected.ok,false);
 await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
 assert.equal(windows[0].destroyed,true); assert.equal(f.services[1].admissionClosed,true);
 assert.ok(f.events.includes('full-copy:resources')); assert.deepEqual(exits,[1]);assert.equal(errors.length,1);
});

test('mixed candidate selector quit during retirement waits without acquisition',async()=>{
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
 './candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('candidate')},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>create('full-copy')},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-runtime=9.0.2-ordinary-candidate','--blue-workbench-session-switching'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'candidate');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 let api;vm.runInNewContext(await fs.readFile(path.join(__dirname,'../preload.js'),'utf8'),{require:n=>{assert.equal(n,'electron');return {contextBridge:{exposeInMainWorld:(_n,x)=>{api=x;}},ipcRenderer:{invoke:(n,...args)=>handlers.get(n)(oldEvent,...args),on(){},removeListener(){}}};}});
 assert.equal((await api.getWorkbenchSession()).replaceClosed,true);
 const drainage=deferred();f.services[0].closeAdmission();f.services[0].closeOperationResources=()=>drainage.promise;
 const restart=api.selectWorkbenchSession('full-copy');await new Promise(r=>setImmediate(r));assert.equal(f.services.length,1);
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[]);
 drainage.resolve();await restart;await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.deepEqual(exits,[0]);assert.equal(f.services.length,1);assert.equal(windows.length,1);assert.equal(windows[0].destroyed,true);
});

test('candidate902 missing Full-copy stays unavailable then explicit ordinary recovery',async()=>{
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
 const modules={electron:{app,BrowserWindow:Window,dialog:{showErrorBox(){}},ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},session:{fromPartition:()=>local},protocol:{registerSchemesAsPrivileged(){}},nativeTheme:{},shell:{}},'node:fs':{mkdirSync(){}},'node:path':path,
 './workbench-service.cjs':{createWorkbenchService:()=>assert.fail('No baseline fallback')},'./candidate-ordinary-service.cjs':{createCandidateOrdinaryService:()=>create('ordinary')},'./workbench-runtime-choice.cjs':require('./workbench-runtime-choice.cjs'),'./workbench-session.cjs':{WorkbenchSession},
 './candidate-full-copy-workbench.cjs':{createCandidateFullCopyWorkbench:()=>{throw new Error('Missing fixed candidate inputs');}},
 '../src/appearance.cjs':{AppearanceSettings:class{async load(){return {theme:'dark'};}closeAdmission(){}async flush(){}}},'../src/output-access.cjs':{OutputAccess:class{clear(){}}},'../src/ipc.cjs':require('../src/ipc.cjs'),'../src/local-protocol.cjs':{ENTRY_URL:'app://local/index.html',registerLocalProtocol(){},resolveAsset(){return true;}}};
 vm.runInNewContext(source,{require:n=>{assert.ok(Object.hasOwn(modules,n),n);return modules[n];},__dirname,process:{argv:['electron','--blue-workbench-session-switching','--blue-runtime=9.0.2-ordinary-candidate'],versions:{}},console:{log:(...x)=>logs.push(x),error:()=>assert.fail('startup failure')}});
 await new Promise(r=>setImmediate(r));assert.equal(startupReads[0].value.kind,'ordinary');
 const oldHandler=handlers.get('encoder:runtime-information'), firstEvent=oldEvent;
 const selected=await handlers.get('encoder:select-workbench-session')(oldEvent,'full-copy');assert.equal(selected.ok,false);
 assert.equal(f.services.length,1);assert.equal(f.services[0].admissionClosed,true);
 assert.equal((await handlers.get('encoder:workbench-session')(oldEvent)).value.selected,null);
 const recovered=await handlers.get('encoder:select-workbench-session')(oldEvent,'ordinary');assert.equal(recovered.ok,true);
 assert.equal(f.services.length,2);assert.equal(windows.length,2);assert.equal(startupReads[1].value.kind,'ordinary');
 assert.equal((await oldHandler(firstEvent)).error.code,'SESSION_RETIRED');
 app.emit('before-quit',{preventDefault(){}});await new Promise(r=>setImmediate(r));assert.deepEqual(exits,[0]);
});
