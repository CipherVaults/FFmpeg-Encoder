const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpc } = require('../src/ipc.cjs');
function harness(serviceOverrides = {}, appearance = { load() {}, set() {} }) {
  const handlers = new Map();
  const frame = { url: 'file:///app/ui/index.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  let starts = 0;
  const unregister = registerIpc({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) }, window,
    service: { snapshot: () => ({ phase: 'idle' }), startBatch: () => { starts++; return {}; }, ...serviceOverrides }, appearance, dialog: {}, entryUrl: frame.url });
  return { handlers, event, window, unregister, starts: () => starts };
}

test('native channels retain sender and arity checks, with no path or generic invocation bridge', async () => {
  const calls = [], h = harness({ getNativeBackendState: () => ({ fileExecutionReady: false }),
    refreshNativeBackends: () => { calls.push('refresh'); return {}; },
    selectNativeBackend: request => { calls.push(request); return {}; }, qualifyNativeBackend: request => { calls.push(request); return {}; } });
  for (const [channel, args] of [['encoder:native-state', []], ['encoder:native-refresh', []],
    ['encoder:native-select', [{ revision: 1 }]], ['encoder:native-qualify', [{ selectionId: 'opaque', revision: 2 }]]]) {
    const invoke = h.handlers.get(channel);
    assert.equal((await invoke({ ...h.event, sender: {} }, ...args)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await invoke(h.event, ...args, 'extra')).error.code, 'INVALID_REQUEST');
    assert.equal((await invoke(h.event, ...args)).ok, true);
  }
  assert.equal(calls.length, 3); assert.ok(!h.handlers.has('encoder:native-run'));
});
test('foreign window, subframe and changed URL cannot invoke a privileged method', async () => {
  const { handlers, event, starts } = harness();
  for (const altered of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
    assert.equal((await handlers.get('encoder:start')(altered, {})).error.code, 'UNTRUSTED_SENDER');
  }
  event.senderFrame.url = 'https://example.invalid/';
  assert.equal((await handlers.get('encoder:start')(event, {})).error.code, 'UNTRUSTED_SENDER');
  assert.equal(starts(), 0);
});

test('draft processing methods retain sender and arity guards and forward only their one typed request', async () => {
  for (const [channel, method] of [['encoder:update-file-operations', 'updateFileOperations'],
    ['encoder:update-batch-operation-defaults', 'updateBatchOperationDefaults'], ['encoder:apply-app-defaults-to-batch', 'applyAppDefaultsToBatch'],
    ['encoder:reprepare-encoding-settings', 'reprepareEncodingSettings'], ['encoder:prepare-remux', 'prepareRemuxBatch'],
    ['encoder:remux-omissions', 'setRemuxOmissions'], ['encoder:encode-preservation-decisions', 'setEncodePreservationDecisions']]) {
    const calls = [];
    const { handlers, event } = harness({ [method]: async request => { calls.push(request); return { phase: 'ready', revision: 12 }; } });
    const handler = handlers.get(channel), request = { planId: 'main-plan', draftId: 'main-draft', revision: 2,
      ...(method === 'updateFileOperations' ? { fileIds: ['main-file'], overrides: { range: { startUs: 1234567 } } }
        : method === 'updateBatchOperationDefaults' ? { overrides: { resolution: '720' } }
          : method === 'reprepareEncodingSettings' ? { settings: { profileId: 'h265-cpu', preset: 'slow', quality: 26 } } : { resetFileOverrides: false }) };
    assert.equal((await handler({ ...event, sender: {} }, request)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await handler({ ...event, senderFrame: { url: event.senderFrame.url } }, request)).error.code, 'UNTRUSTED_SENDER');
    assert.equal((await handler(event)).error.code, 'INVALID_REQUEST');
    assert.equal((await handler(event, request, { args: ['-y'] })).error.code, 'INVALID_REQUEST');
    assert.deepEqual(calls, []);
    assert.deepEqual(await handler(event, request), { ok: true, value: { phase: 'ready', revision: 12 } });
    assert.deepEqual(calls, [request]);
  }
});

test('preload exposes named draft methods without generic IPC and preserves rejection codes', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(label, value) { assert.equal(label, 'encoder'); api = value; } },
      ipcRenderer: { invoke: async (channel, request) => { calls.push({ channel, request }); return request.revision === -1
        ? { ok: false, error: { code: 'STALE_DRAFT', message: 'Review the current draft.' } } : { ok: true, value: { revision: 4 } }; } }
    };
  } });
  assert.equal(Object.isFrozen(api), true); assert.equal(api.invoke, undefined); assert.equal(api.send, undefined);
  for (const [method, channel] of [['updateFileOperations', 'encoder:update-file-operations'],
    ['updateBatchOperationDefaults', 'encoder:update-batch-operation-defaults'], ['applyAppDefaultsToBatch', 'encoder:apply-app-defaults-to-batch'],
    ['reprepareEncodingSettings', 'encoder:reprepare-encoding-settings'], ['setEncodePreservationDecisions', 'encoder:encode-preservation-decisions']]) {
    const request = { revision: 3 };
    assert.deepEqual(await api[method](request), { revision: 4 });
    assert.deepEqual(calls.at(-1), { channel, request });
    await assert.rejects(api[method]({ revision: -1 }), error => error.code === 'STALE_DRAFT' && /current draft/.test(error.message));
  }
});
test('snapshot rejects extra arguments and returns only explicit envelope', async () => {
  const { handlers, event } = harness();
  assert.equal((await handlers.get('encoder:snapshot')(event, 'injected')).error.code, 'INVALID_REQUEST');
  assert.deepEqual(await handlers.get('encoder:snapshot')(event), { ok: true, value: { phase: 'idle' } });
  assert.equal(handlers.has('encode-video'), false);
});

test('settings and runtime information keep exact argument counts and trusted-frame admission', async () => {
  const { handlers, event } = harness();
  for (const channel of ['encoder:app-settings', 'encoder:runtime-information']) {
    assert.equal((await handlers.get(channel)(event, { path: 'injected' })).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)({ ...event, senderFrame: { url: event.senderFrame.url } })).error.code, 'UNTRUSTED_SENDER');
  }
  for (const channel of ['encoder:save-app-settings', 'encoder:reset-app-settings', 'encoder:open-completed-output']) {
    assert.equal((await handlers.get(channel)(event)).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)(event, {}, {})).error.code, 'INVALID_REQUEST');
    assert.equal((await handlers.get(channel)({ ...event, sender: {} }, {})).error.code, 'UNTRUSTED_SENDER');
  }
});

test('appearance channels retain exact trusted-frame and argument guards without media service authority', async () => {
  const calls = [], incidents = [];
  const appearance = { load: async () => { calls.push('load'); return { theme: 'dark' }; },
    set: async request => { calls.push(request); return { theme: request.theme }; } };
  const { handlers, event, window, unregister, starts } = harness({ recordIncident: async incident => incidents.push(incident) }, appearance);
  for (const [channel, args] of [['encoder:appearance', []], ['encoder:save-appearance', [{ theme: 'light' }]]]) {
    const handle = handlers.get(channel);
    for (const altered of [{ ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
      assert.equal((await handle(altered, ...args)).error.code, 'UNTRUSTED_SENDER');
    }
    assert.equal((await handle(event, ...args, {})).error.code, 'INVALID_REQUEST');
  }
  assert.equal((await handlers.get('encoder:save-appearance')(event)).error.code, 'INVALID_REQUEST');
  assert.deepEqual(calls, []); assert.equal(starts(), 0);
  assert.equal(incidents.length, 3); assert.ok(incidents.every(incident => incident.context.code === 'INVALID_REQUEST'));
  assert.deepEqual(await handlers.get('encoder:appearance')(event), { ok: true, value: { theme: 'dark' } });
  const request = { theme: 'light' };
  assert.deepEqual(await handlers.get('encoder:save-appearance')(event, request), { ok: true, value: { theme: 'light' } });
  assert.deepEqual(calls, ['load', request]);
  event.senderFrame.url = 'https://example.invalid/';
  assert.equal((await handlers.get('encoder:appearance')(event)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('encoder:save-appearance')(event, request)).error.code, 'UNTRUSTED_SENDER');
  assert.deepEqual(calls, ['load', request]);
  event.senderFrame.url = 'file:///app/ui/index.html'; window.isDestroyed = () => true;
  assert.equal((await handlers.get('encoder:appearance')(event)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('encoder:save-appearance')(event, request)).error.code, 'UNTRUSTED_SENDER');
  assert.deepEqual(calls, ['load', request]); unregister(); assert.equal(handlers.size, 0);
});

test('actual appearance store rejects invalid IPC DTOs before writes and persists only the strict theme', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
  const { AppearanceSettings } = require('../src/appearance.cjs');
  const directory = path.resolve(__dirname, '../artifacts/v0.7/icon-themes/ipc-fixture-' + randomUUID());
  const appearance = new AppearanceSettings({ directory });
  const { handlers, event, starts } = harness({}, appearance), save = handlers.get('encoder:save-appearance');
  let getters = 0;
  for (const value of [null, [], {}, { theme: 'system' }, { theme: 'LIGHT' }, { theme: 1 },
    { theme: 'light', path: 'untrusted' }, { theme: 'light', profileId: 'h265-cpu' },
    Object.defineProperty({}, 'theme', { enumerable: true, get() { getters++; return 'light'; } })]) {
    assert.equal((await save(event, value)).error.code, 'INVALID_APPEARANCE');
  }
  assert.equal(getters, 0); assert.equal(starts(), 0);
  await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  const result = await save(event, { theme: 'light' });
  assert.equal(result.ok, true); assert.equal(result.value.theme, 'light'); assert.equal(result.value.persistence.persisted, true);
  const record = JSON.parse(await fs.readFile(appearance.filename, 'utf8'));
  assert.deepEqual(record, { namespace: 'appearance-v1', schema: 1, theme: 'light' });
  const restarted = new AppearanceSettings({ directory });
  assert.equal((await restarted.load()).theme, 'light');
  t.diagnostic('Retained isolated appearance IPC fixture: ' + directory);
});

test('preload exposes only named appearance capabilities and preserves store failure codes', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), { require(name) {
    assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(label, value) { assert.equal(label, 'encoder'); api = value; } },
      ipcRenderer: { invoke: async (channel, ...args) => { calls.push({ channel, args });
        return channel === 'encoder:save-appearance'
          ? { ok: false, error: { code: 'APPEARANCE_WRITE_UNCERTAIN', message: 'Saved bytes could not be confirmed.' } }
          : { ok: true, value: { schema: 1, theme: 'dark' } }; } },
    };
  } });
  assert.equal(Object.isFrozen(api), true); assert.equal(api.invoke, undefined); assert.equal(api.send, undefined);
  assert.deepEqual(await api.getAppearance(), { schema: 1, theme: 'dark' });
  assert.equal(calls[0].channel, 'encoder:appearance'); assert.equal(calls[0].args.length, 0);
  const request = { theme: 'light' };
  await assert.rejects(api.saveAppearance(request), error => error.code === 'APPEARANCE_WRITE_UNCERTAIN' && /confirmed/.test(error.message));
  assert.equal(calls[1].channel, 'encoder:save-appearance'); assert.equal(calls[1].args.length, 1);
  assert.equal(calls[1].args[0], request);
});

test('actual appearance IPC overload and close refuse more writes while accepted saves drain durably', async t => {
  const path = require('node:path'), { randomUUID } = require('node:crypto');
  const { AppearanceSettings, MAX_PENDING_APPEARANCE_WRITES } = require('../src/appearance.cjs');
  const directory = path.resolve(__dirname, '../artifacts/v0.7/icon-themes/ipc-drain-' + randomUUID());
  const appearance = new AppearanceSettings({ directory });
  const { handlers, event, starts } = harness({}, appearance), save = handlers.get('encoder:save-appearance');
  assert.equal(MAX_PENDING_APPEARANCE_WRITES, 8);
  // Invoke without awaiting: these are simultaneously accepted IPC calls,
  // including the operation whose first filesystem step has not run yet.
  const accepted = Array.from({ length: MAX_PENDING_APPEARANCE_WRITES }, (_, index) => save(event, { theme: index % 2 ? 'light' : 'dark' }));
  const overloaded = save(event, { theme: 'dark' });
  appearance.closeAdmission(); appearance.closeAdmission();
  const closed = save(event, { theme: 'dark' });
  assert.equal((await overloaded).error.code, 'APPEARANCE_BUSY');
  assert.equal((await closed).error.code, 'APPEARANCE_CLOSED');
  const drained = appearance.flush();
  assert.ok((await Promise.all(accepted)).every(result => result.ok && result.value.persistence.persisted));
  assert.equal((await drained).theme, 'light');
  assert.equal((await new AppearanceSettings({ directory }).load()).theme, 'light');
  assert.equal(starts(), 0);
  t.diagnostic('Retained bounded appearance IPC drain fixture: ' + directory);
});

function pickerHarness({ selection = { canceled: true, filePaths: [] }, open, register, diagnostic } = {}) {
  const handlers=new Map(), incidents=[], registrations=[], dialogs=[];
  const frame={url:'file:///app/ui/index.html'}, window={isDestroyed:()=>false,webContents:{mainFrame:frame}};
  const event={sender:window.webContents,senderFrame:frame};let blocked=false;
  const service={requireIdle(){if(blocked)throw Object.assign(new Error('Not idle'),{code:'SHUTTING_DOWN'});},
    async registerFolder(folder,role){this.requireIdle();registrations.push({folder,role});return register?register(folder,role):{id:'private-token',path:folder};},
    async recordIncident(row){incidents.push(row);return diagnostic?diagnostic(row):{persisted:true};}};
  registerIpc({ipcMain:{handle:(n,f)=>handlers.set(n,f)},window,service,entryUrl:frame.url,dialog:{async showOpenDialog(w,opts){dialogs.push(opts);return open?open():selection;}}});
  return {handlers,event,window,incidents,registrations,dialogs,block:()=>{blocked=true;},call:(role='input',...args)=>handlers.get('encoder:'+role+'-folder')(event,...args)};
}
const pickerMarkers=h=>h.incidents.filter(x=>x.reason.startsWith('FOLDER_PICKER_'));
test('folder picker both roles retain cancelled-null and valid single registration contracts',async()=>{
 for(const role of ['input','output']) {
  let h=pickerHarness({selection:{canceled:true,filePaths:['/secret/stale']}});
  assert.deepEqual(await h.call(role),{ok:true,value:null});assert.equal(h.registrations.length,0);
  assert.deepEqual(pickerMarkers(h).map(x=>x.context.outcome),['requested','cancelled']);
  h=pickerHarness({selection:{canceled:false,filePaths:['/secret/selected']}});
  assert.deepEqual(await h.call(role),{ok:true,value:{id:'private-token',path:'/secret/selected'}});
  assert.deepEqual(h.registrations,[{folder:'/secret/selected',role}]);
  assert.deepEqual(h.dialogs[0].properties,['openDirectory']);
  assert.deepEqual(pickerMarkers(h).map(x=>x.context.outcome),['requested','registered']);
 }
});
test('noncancelled empty malformed multiple selection rejects explicitly without registering',async()=>{
 for(const role of ['input','output'])for(const selection of [null,{}, {canceled:false}, {canceled:false,filePaths:[]},{canceled:false,filePaths:['a','b']},{canceled:false,filePaths:[null]},{canceled:false,filePaths:['  ']},{canceled:'false',filePaths:['a']}]) {
  const h=pickerHarness({selection});assert.equal((await h.call(role)).error.code,'INVALID_FOLDER_SELECTION');assert.equal(h.registrations.length,0);
  assert.deepEqual(pickerMarkers(h).map(x=>x.context.outcome),['requested','invalid-selection']);
 }
});
test('picker guards retain sender arity idle concurrency and finally unlock',async()=>{
 let resolve;const h=pickerHarness({open:()=>new Promise(r=>resolve=r)});
 const fn=h.handlers.get('encoder:input-folder');
 assert.equal((await fn({...h.event,sender:{} })).error.code,'UNTRUSTED_SENDER');
 assert.equal((await h.call('input','path-injection')).error.code,'INVALID_REQUEST');assert.equal(h.dialogs.length,0);assert.equal(pickerMarkers(h).length,0);
 const first=h.call();await new Promise(r=>setImmediate(r));assert.equal((await h.call('output')).error.code,'BUSY');
 resolve({canceled:true,filePaths:[]});await first;
 const next=h.call('output');await new Promise(r=>setImmediate(r));resolve({canceled:true,filePaths:[]});assert.equal((await next).ok,true);
 h.block();assert.equal((await h.call()).error.code,'SHUTTING_DOWN');assert.equal(h.dialogs.length,2);
});
test('dialog and registration rejection preserve error envelope and unlock picker',async()=>{
 for(const stage of ['dialog','registration']) {
  const error=Object.assign(new Error('synthetic secret path /private/secret and token'),{code:'EACCES'});let once=true;
  const h=pickerHarness({selection:{canceled:false,filePaths:['/private/secret']},
    ...(stage==='dialog'?{open:()=>{if(once){once=false;throw error;}return {canceled:true,filePaths:[]};}}:{register:()=>{if(once){once=false;throw error;}return {id:'private-token',path:'/private/secret'};}})});
  assert.deepEqual(await h.call(),{ok:false,error:{code:'EACCES',message:error.message}});
  assert.equal((await h.call()).ok,true);
  assert.ok(pickerMarkers(h).some(x=>x.context.outcome===stage+'-rejected'));
  assert.doesNotMatch(JSON.stringify(pickerMarkers(h)),/private|secret|token|EACCES/);
 }
});
test('close while picker pending still refuses registration at existing service idle boundary',async()=>{
 let resolve;const h=pickerHarness({open:()=>new Promise(r=>resolve=r)});const pending=h.call();await new Promise(r=>setImmediate(r));h.block();resolve({canceled:false,filePaths:['/secret/selected']});
 assert.equal((await pending).error.code,'SHUTTING_DOWN');assert.equal(h.registrations.length,0);
 assert.equal(pickerMarkers(h).at(-1).context.outcome,'registration-rejected');
});
test('diagnostic false or throw cannot turn registration or cancellation into failure',async()=>{
 for(const diagnostic of [()=>({persisted:false}),()=>{throw new Error('logging failed');}])for(const canceled of [true,false]) {
  const h=pickerHarness({selection:{canceled,filePaths:['/secret/selected']},diagnostic});const result=await h.call();assert.equal(result.ok,true);assert.equal(h.registrations.length,canceled?0:1);
 }
});
test('new fixed picker markers survive actual export sanitizer without secrets',async()=>{
 const {redactEvents}=require('../src/diagnostics.cjs');
 const h=pickerHarness({selection:{canceled:false,filePaths:['/private/synthetic-secret']}});await h.call();
 const events=pickerMarkers(h).map((x,i)=>({...x,id:String(i),sessionId:'session',at:1,type:'event',severity:'info'}));
 const exported=redactEvents(events);assert.equal(exported.events.length,2);
 assert.deepEqual(exported.events.map(x=>x.context),events.map(x=>x.context));
 assert.doesNotMatch(JSON.stringify(events)+JSON.stringify(exported),/synthetic-secret|private-token|\/private/);
});


test('delayed request diagnostic cannot open picker after busy or window close',async()=>{
 for(const closed of [false,true]) {
  let release;const h=pickerHarness({diagnostic:row=>row.reason==='FOLDER_PICKER_REQUESTED'?new Promise(r=>release=r):{persisted:true}});
  const pending=h.call();await new Promise(r=>setImmediate(r));
  if(closed)h.window.isDestroyed=()=>true;else h.block();
  release({persisted:true});assert.equal((await pending).error.code,'SHUTTING_DOWN');
  assert.equal(h.dialogs.length,0);assert.equal(h.registrations.length,0);
  assert.deepEqual(pickerMarkers(h).map(x=>x.context.outcome),['requested','admission-rejected']);
  assert.ok(pickerMarkers(h).every(x=>!x.reason.includes('OPENED')));
 }
});
