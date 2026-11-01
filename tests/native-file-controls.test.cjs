'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createNativeFileControls,createTestNativeFileControls,nativeFileControlsKind,NATIVE_MESSAGES,NATIVE_MESSAGE_FAMILIES,nativeRefusal}=require('../src/native-file-controls.cjs');
const {DEFAULT_NATIVE_FILE_POLICIES}=require('../src/native-file-runtime.cjs');
const {NativeBackendService}=require('../src/native-backend-service.cjs');
const {NATIVE_PROFILES}=require('../src/backend-adapters.cjs');
// Composition, readiness and message checks only: synthetic pins and views,
// no media tool, device, lease or child process. Lifecycle tests that need a
// genuine verified selection live in native-file-runtime.test.cjs.
async function setup(t){
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'ffenc-native-controls-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  let runs=0;const nativeBackends=new NativeBackendService({discover:async()=>{runs++;throw new Error('No discovery in this test.');},createProbe:()=>({initialize:async()=>{runs++;},probe:async()=>{runs++;}})});
  const runtime={ffmpeg:{file:path.join(root,'ffmpeg.exe'),sizeBytes:10,sha256:'a'.repeat(64)},ffprobe:{file:path.join(root,'ffprobe.exe'),sizeBytes:10,sha256:'b'.repeat(64)}};
  return {root,nativeBackends,runtime,options:{runtime,stateDir:root,nativeBackends},count(){runs++;},get runs(){return runs;}};
}
const native=root=>path.join(root,'native-files');

test('NF-C1: the production catalog is frozen and empty, construction is inert and only exact production keys are accepted',async t=>{
  const s=await setup(t);
  assert.ok(Object.isFrozen(DEFAULT_NATIVE_FILE_POLICIES));assert.equal(DEFAULT_NATIVE_FILE_POLICIES.length,0);
  const production=createNativeFileControls(s.options);
  assert.equal(nativeFileControlsKind(production),'production');assert.equal(production.policyCount,0);assert.ok(Object.isFrozen(production));
  assert.equal(production.keptStages(),null);assert.equal(s.runs,0);assert.equal(fs.existsSync(native(s.root)),false);
  const job=production.createJob({acquireMediaSlot:async()=>{throw new Error('No lease in this test.');}});
  assert.equal(job.snapshot().policyCount,0);assert.equal(fs.existsSync(native(s.root)),false);
  await assert.rejects(job.publish(undefined,undefined,{destination:path.join(s.root,'x.mkv')}),{code:'INVALID_NATIVE_FILE_RUNTIME'});await job.close();
  const accessor={...s.options};Object.defineProperty(accessor,'stateDir',{get:()=>s.root,enumerable:true});
  for(const bad of [{...s.options,policies:[]},{...s.options,run:s.count},{...s.options,extra:true},{runtime:s.runtime,stateDir:s.root},accessor,Object.assign(Object.create({}),s.options),null,'options',[s.options]])
    assert.throws(()=>createNativeFileControls(bad),{code:'INVALID_NATIVE_FILE_COMPOSITION'});
  // A build defect (shape, a non-genuine backend service) and the data folder's own condition have distinct codes.
  for(const bad of [{...s.options,nativeBackends:{}},{...s.options,stateDir:1}])assert.throws(()=>createNativeFileControls(bad),{code:'INVALID_NATIVE_FILE_COMPOSITION'});
  for(const bad of [{...s.options,stateDir:'relative'},{...s.options,stateDir:path.join(s.root,'missing')}])
    assert.throws(()=>createNativeFileControls(bad),{code:'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE',message:/state folder/});
  await fsp.writeFile(path.join(s.root,'file'),'x');assert.throws(()=>createNativeFileControls({...s.options,stateDir:path.join(s.root,'file')}),{code:'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE'});
  if(process.platform==='win32'){const target=path.join(s.root,'target'),link=path.join(s.root,'link');await fsp.mkdir(target);await fsp.symlink(target,link,'junction');
    assert.throws(()=>createNativeFileControls({...s.options,stateDir:link}),{code:'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE'});}
  for(const bad of [{},{acquireMediaSlot:1},{acquireMediaSlot:async()=>{},extra:1}])assert.throws(()=>production.createJob(bad),{code:'INVALID_NATIVE_FILE_COMPOSITION'});
  assert.equal(s.runs,0);
});

test('NF-C1: the test factory is the only injection path and its brand differs from production',async t=>{
  const s=await setup(t);
  const injected=createTestNativeFileControls({...s.options,policies:[],run:s.count});
  assert.equal(nativeFileControlsKind(injected),'injected');assert.notEqual(nativeFileControlsKind(injected),nativeFileControlsKind(createNativeFileControls(s.options)));
  for(const value of [{...injected},Object.create(injected),{},null,undefined,'production',1])assert.equal(nativeFileControlsKind(value),null);
  assert.throws(()=>createTestNativeFileControls({...s.options,run:s.count}),{code:'INVALID_NATIVE_FILE_COMPOSITION'});
  assert.throws(()=>createTestNativeFileControls({...s.options,policies:[],run:'runner'}),{code:'INVALID_NATIVE_FILE_COMPOSITION'});
  assert.throws(()=>createTestNativeFileControls({...s.options,policies:[{id:'not-a-policy'}]}),{code:'INVALID_NATIVE_FILE_RUNTIME'});
  assert.equal(s.runs,0);assert.equal(fs.existsSync(native(s.root)),false);
  // Production reaches the runtime only through the controls: any mention of the raw
  // owner or the job factory (alias, Reflect.construct, subclass) outside these two
  // modules fails, and only the controls module names the test factory.
  const repo=path.join(__dirname,'..'),files=[path.join(repo,'main.js'),path.join(repo,'preload.js')];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(c?js|mjs)$/.test(entry.name))files.push(full);}};walk(path.join(repo,'src'));
  const using=pattern=>files.filter(file=>pattern.test(fs.readFileSync(file,'utf8'))).map(file=>path.relative(repo,file).replace(/\\/g,'/')).sort();
  assert.deepEqual(using(/NativeFileRuntimeOwner|createNativeFileRuntimeJob/),['src/native-file-controls.cjs','src/native-file-runtime.cjs']);
  assert.deepEqual(using(/native-file-runtime\.cjs/),['src/native-file-controls.cjs']);
  assert.deepEqual(using(/createTestNativeFileControls/),['src/native-file-controls.cjs']);
});

const profiles=reason=>NATIVE_PROFILES.map(p=>({profileId:p.id,backend:p.backend,reason:typeof reason==='function'?reason(p):reason}));
const view=(reason,selection=null)=>({schema:1,native:{profiles:profiles(reason)},selection});
const chose=(profileId,{bitDepth=8,probeVerified=true}={})=>({selectionId:'synthetic',request:{profileId,settings:{},bitDepth},cell:null,probeVerified});
const qsvOnly=p=>p.backend==='qsv'?'CHOOSE_AND_QUALIFY_CELL':'MISSING_DEVICE',amfOnly=p=>p.backend==='amf'?'CHOOSE_AND_QUALIFY_CELL':'MISSING_DEVICE';

test('NF-C3: readiness keeps its fixed order and hiding, and production never becomes available',async t=>{
  const s=await setup(t),controls=createNativeFileControls(s.options),codes=v=>controls.readiness(v).reasons.map(r=>r.code);
  assert.deepEqual(codes(s.nativeBackends.snapshot()),['NATIVE_DISCOVERY_UNOBSERVED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view('DEVICE_DISCOVERY_INCOMPLETE')),['NATIVE_DISCOVERY_UNOBSERVED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view('DISCOVERY_NOT_OBSERVED',chose('h264-amf',{probeVerified:false}))),['NATIVE_DISCOVERY_UNOBSERVED','AMF_EFFECTIVE_PROPERTIES_UNOBSERVED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view('MISSING_DEVICE')),['NATIVE_HARDWARE_UNAVAILABLE','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(amfOnly,chose('h264-qsv',{probeVerified:false}))),['NATIVE_HARDWARE_UNAVAILABLE','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(qsvOnly)),['NATIVE_SELECTION_REQUIRED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(amfOnly,chose('h264-amf',{probeVerified:false}))),['AMF_EFFECTIVE_PROPERTIES_UNOBSERVED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(amfOnly,chose('h265-amf'))),['AMF_EFFECTIVE_PROPERTIES_UNOBSERVED','NATIVE_FILE_REQUEST_UNSUPPORTED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(qsvOnly,chose('h265-qsv',{probeVerified:false}))),['NATIVE_FILE_REQUEST_UNSUPPORTED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(qsvOnly,chose('h264-qsv',{bitDepth:10}))),['NATIVE_FILE_REQUEST_UNSUPPORTED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(qsvOnly,chose('h264-qsv',{probeVerified:false}))),['NATIVE_CAPABILITY_UNVERIFIED','NATIVE_FILE_POLICY_REQUIRED']);
  assert.deepEqual(codes(view(qsvOnly,chose('h264-qsv'))),['NATIVE_FILE_POLICY_REQUIRED']);
  for(const bad of [null,{},{schema:2,native:{profiles:profiles('MISSING_DEVICE')},selection:null},{schema:1,native:{profiles:[]},selection:null},{...view(qsvOnly),selection:{request:{profileId:'h264-qsv'}}}])
    assert.deepEqual(codes(bad),['NATIVE_FILE_RUNTIME_UNAVAILABLE']);
  const projection=controls.readiness(view(qsvOnly,chose('h264-qsv')));
  assert.deepEqual([projection.schema,projection.beta,projection.available,projection.policyCount,projection.keptStages],[1,true,false,0,null]);assert.ok(Object.isFrozen(projection));
  for(const reason of projection.reasons)assert.equal(reason.message,NATIVE_MESSAGES[reason.code]);
});

test('NF-C2: admissible assessment returns only the matched policy evidence as a frozen independent copy',async t=>{
  const {fixture,referenceFor}=require('./native-file-fixture.cjs'),h=await fixture(t,{matroska:true});await h.owner.close();
  const policy={...h.policy,reference:referenceFor(h)},other={...policy,id:'other-policy',sourceProbeFingerprint:'0'.repeat(64),evidenceIds:['other-policy-evidence']};
  const options={runtime:h.runtime,stateDir:h.root,nativeBackends:h.native,policies:[other,policy]};
  const controls=createTestNativeFileControls(options),request={contract:h.contract,selection:h.selection};
  const assessed=controls.assess(request);
  assert.equal(assessed.admissible,true);assert.equal(assessed.policyId,policy.id);
  assert.deepEqual(assessed.evidenceIds,['synthetic-fixture-not-hardware-proof']);
  assert.ok(Object.isFrozen(assessed));assert.ok(Object.isFrozen(assessed.evidenceIds));
  assert.notEqual(assessed.evidenceIds,policy.evidenceIds);assert.notEqual(assessed.evidenceIds,controls.assess(request).evidenceIds);
  assert.throws(()=>assessed.evidenceIds.push('tampered'),TypeError);
  policy.evidenceIds.push('caller-edit');assert.deepEqual(controls.assess(request).evidenceIds,['synthetic-fixture-not-hardware-proof']);
  for(const policies of [[other],[{...policy,reference:undefined}]]){
    const denied=createTestNativeFileControls({...options,policies}).assess(request);
    assert.equal(denied.admissible,false);assert.equal(Object.hasOwn(denied,'evidenceIds'),false);
  }
  assert.equal(h.calls.length,0);
});

test('NS-09a: every literal refusal code in the scanned modules has fixed main text',()=>{
  // Record 37 §6's modules plus the helpers a native job calls into (device evidence,
  // capabilities, adapters, the process runner, source identity and output provenance).
  const dir=path.join(__dirname,'..','src'),files=fs.readdirSync(dir).filter(name=>/^native-file-.*\.cjs$/.test(name))
    .concat(['native-backend-service.cjs','outputs.cjs','backend-observation.cjs','backend-capabilities.cjs','backend-adapters.cjs','process-runner.cjs','source-identity.cjs','provenance.cjs']);
  const prefixes={'native-file-oracle.cjs':'NATIVE_ORACLE_','native-file-template.cjs':'NATIVE_TEMPLATE_'},found=new Set();
  for(const name of files){const text=fs.readFileSync(path.join(dir,name),'utf8'),prefix=prefixes[name]||'';
    for(const m of text.matchAll(/\b(?:fail|failure|error)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g))found.add(prefix+m[1]);
    for(const m of text.matchAll(/\b(?:ToolError|beforeSpawnError)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g))found.add(m[1]);
    for(const m of text.matchAll(/\bcode\s*:\s*['"]([A-Z][A-Z0-9_]*[A-Z0-9])['"]/g))found.add(m[1]);
    if(name==='native-file-runtime.cjs')for(const m of text.matchAll(/\[['"]([A-Z][A-Z0-9_]+)['"],\s*['"]/g))found.add(m[1]);}
  // Shared preparation and Start codes the native gate passes through (encoder-service.cjs).
  for(const code of ['BUSY','SHUTTING_DOWN','NO_INPUTS','STALE_PLAN','UNPREPARED_FILE','INVALID_REQUEST','INVALID_ID','INVALID_FOLDER','CAPABILITIES_FAILED'])found.add(code);
  for(const code of ['INVALID_NATIVE_SETTINGS','NATIVE_DEVICE_MISMATCH','INVALID_CAPABILITY_POLICY','PROVENANCE_UNAVAILABLE'])assert.ok(found.has(code),code);
  assert.ok(found.size>=140,String(found.size));
  for(const code of found){const refusal=nativeRefusal({code,message:'D:\\zq-sentinel\\folder\\file.mkv'});assert.equal(refusal.reasonCode,code,code);assert.ok(!refusal.reason.includes('zq-sentinel'),code);}
  for(const [code,text] of [...Object.entries(NATIVE_MESSAGES),...Object.entries(NATIVE_MESSAGE_FAMILIES)])
    assert.ok(typeof text==='string'&&text.length>0&&text.length<=200&&!/[\\$`{}]/.test(text),code);
  assert.ok(Object.isFrozen(NATIVE_MESSAGES));assert.equal(Object.getPrototypeOf(NATIVE_MESSAGES),null);
});

test('NS-09a: unknown or hostile errors get the fixed job-failed text and keep the original main-only',()=>{
  const unknown=nativeRefusal(Object.assign(new Error('EACCES: permission denied, open D:\\secret\\a.mkv'),{code:'EACCES'}));
  assert.deepEqual([unknown.reasonCode,unknown.reason],['NATIVE_FILE_JOB_FAILED',NATIVE_MESSAGES.NATIVE_FILE_JOB_FAILED]);
  assert.deepEqual([unknown.nativePrivate.code,unknown.nativePrivate.message.includes('secret')],['EACCES',true]);assert.ok(Object.isFrozen(unknown));
  assert.equal(nativeRefusal(Object.assign(new Error('Runtime path contains a link: D:\\x'),{code:'ERR_ASSERTION'})).reasonCode,'NATIVE_FILE_JOB_FAILED');
  assert.deepEqual([nativeRefusal({code:'NATIVE_TEMPLATE_CRC'}).reasonCode,nativeRefusal({code:'NATIVE_TEMPLATE_CRC'}).reason],['NATIVE_TEMPLATE_CRC',NATIVE_MESSAGE_FAMILIES.NATIVE_TEMPLATE_]);
  assert.equal(nativeRefusal({code:'NATIVE_ORACLE_RAW'}).reason,NATIVE_MESSAGE_FAMILIES.NATIVE_ORACLE_);
  assert.equal(nativeRefusal({code:'NATIVE_TEMPLATE_'}).reasonCode,'NATIVE_FILE_JOB_FAILED');
  assert.equal(nativeRefusal({code:'OUTPUT_FOLDER_CHANGED',message:'EPERM D:\\out'}).reason,NATIVE_MESSAGES.OUTPUT_FOLDER_CHANGED);
  const cause=nativeRefusal(Object.assign(new Error('x'),{code:'NATIVE_FILE_STAGE_CHANGED',cause:{code:'EBUSY'}}));assert.equal(cause.nativePrivate.causeCode,'EBUSY');
  assert.equal(Object.hasOwn(cause.nativePrivate,'memberCodes'),false);
  // An aggregate keeps at most eight member codes, read safely; the shown text stays fixed.
  const members=[{code:'NATIVE_FILE_UNSETTLED'},{code:'EBUSY'},'text',{get code(){throw new Error('trap');}},{code:'not a code'},...Array.from({length:6},()=>({code:'EPERM'}))];
  const aggregate=nativeRefusal(new AggregateError(members,'Native runtime closure is incomplete.'));
  assert.deepEqual([aggregate.reasonCode,aggregate.nativePrivate.code],['NATIVE_FILE_JOB_FAILED',null]);
  assert.deepEqual(aggregate.nativePrivate.memberCodes,['NATIVE_FILE_UNSETTLED','EBUSY',null,null,null,'EPERM','EPERM','EPERM']);
  assert.equal(nativeRefusal({errors:new Proxy([],{get(){throw new Error('trap');}})}).reasonCode,'NATIVE_FILE_JOB_FAILED');
  for(const hostile of [null,undefined,'NATIVE_FILE_DESTINATION',{code:'__proto__'},{code:'constructor'},{code:'a'.repeat(300)},{get code(){throw new Error('trap');}},new Proxy({},{get(){throw new Error('trap');}})])
    assert.equal(nativeRefusal(hostile).reasonCode,'NATIVE_FILE_JOB_FAILED');
  // A code that changes between reads is read once: it can neither throw nor return a non-text code.
  for(const later of [{},{startsWith:()=>true,toString:()=>'CANCELLED'}]){let reads=0;
    const flipping=new Proxy({},{get(target,key){if(key!=='code')return undefined;return ++reads<=1?'CANCELLED':later;}});
    const refusal=nativeRefusal(flipping);assert.equal(typeof refusal.reasonCode,'string');assert.equal(refusal.reasonCode,'CANCELLED');assert.equal(reads,1);}
});

test('NS-09a: the main-only cause message is a bounded string read once',()=>{
  for(const message of ['D:\\private\\ancestor','x'.repeat(4096),null,17,{}]){
    let reads=0;const cause=new Proxy({code:'ERR_ASSERTION',message},{getOwnPropertyDescriptor(target,key){if(key==='message')reads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
    const refusal=nativeRefusal({code:'NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED',message:'outer',cause});
    assert.equal(refusal.nativePrivate.causeMessage,typeof message==='string'?message.slice(0,2048):'');
    assert.equal(reads,1);assert.ok(Object.isFrozen(refusal.nativePrivate));
    assert.equal(refusal.reason,NATIVE_MESSAGES.NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED);
  }
});

test('NS-09a: a cause message accessor never runs',()=>{
  let reads=0;const accessor={get message(){reads++;throw new Error('A cause message accessor must not run.');}};
  for(const cause of [accessor,Object.create(accessor)]){
    const refusal=nativeRefusal({code:'NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED',cause});
    assert.equal(reads,0);assert.equal(refusal.nativePrivate.causeMessage,'');
    assert.equal(refusal.reasonCode,'NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
  }
});
