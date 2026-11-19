'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {PARENT,authority:actualAuthority,diagnostic,unobservedLaunch,deadline,assertSecurity,inventory}=require('../scripts/windows-packaged-integration.cjs');
const {primaryFailure,sanitized}=require('../scripts/windows-hosted-integration-check.cjs');
// Test both states without granting production callers an alternate parent.
const Module=require('node:module'),syncFs=require('node:fs');
const filename=require.resolve('../scripts/windows-packaged-integration.cjs');
const text=syncFs.readFileSync(filename,'utf8');
assert.equal(text.split("const PARENT='").length,2);
const syntheticParent='c'.repeat(40);
const boundModule=new Module(filename,module);boundModule.filename=filename;boundModule.paths=Module._nodeModulePaths(path.dirname(filename));
boundModule._compile(text.replace("const PARENT='"+PARENT+"';","const PARENT='"+syntheticParent+"';"),filename);
const authority=boundModule.exports.authority;
const unboundModule=new Module(filename,module);unboundModule.filename=filename;unboundModule.paths=boundModule.paths;
unboundModule._compile(text.replace("const PARENT='"+PARENT+"';","const PARENT='UNBOUND_SUCCESSOR';"),filename);
test('actual predecessor is explicitly unbound or an exact final SHA',()=>assert(PARENT==='UNBOUND_SUCCESSOR'||/^[a-f0-9]{40}$/.test(PARENT)));
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'CipherVaults/FFmpeg-Encoder-Blue-Linux',GITHUB_REF:'refs/heads/blue/linux-development',GITHUB_EVENT_NAME:'push',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
const event={before:syntheticParent,after:env.GITHUB_SHA,forced:false,created:false,deleted:false};
test('synthetically bound exact single ordinary successor admitted',()=>assert.equal(authority(env,event).head,env.GITHUB_SHA));
for(const [key,value] of [['GITHUB_RUN_ATTEMPT','2'],['GITHUB_EVENT_NAME','workflow_dispatch'],['GITHUB_REF','refs/heads/main'],['GITHUB_REPOSITORY','other/repo']])test('refuses '+key,()=>assert.throws(()=>authority({...env,[key]:value},event)));
for(const [key,value] of [['before','b'.repeat(40)],['after','b'.repeat(40)],['forced',true],['created',true],['deleted',true]])test('refuses event '+key,()=>assert.throws(()=>authority(env,{...event,[key]:value})));
test('actual unbound authority refuses; final bound authority admits only its exact event',()=>{const ownEvent={...event,before:PARENT};if(PARENT==='UNBOUND_SUCCESSOR')assert.throws(()=>actualAuthority(env,ownEvent),/unbound/);else assert.equal(actualAuthority(env,ownEvent).head,env.GITHUB_SHA);});
test('unbound helper always refuses even a synthetically valid push',()=>assert.throws(()=>unboundModule.exports.authority(env,event),/unbound/));
const secure={packaged:true,sandbox:true,contextIsolation:true,nodeIntegration:false,requireType:'undefined',processType:'undefined'};
test('actual packaged security contract',()=>assert.doesNotThrow(()=>assertSecurity(secure)));
for(const [key,value] of [['packaged',false],['sandbox',false],['contextIsolation',false],['nodeIntegration',true],['requireType','function'],['processType','object']])test('security rejects '+key,()=>assert.throws(()=>assertSecurity({...secure,[key]:value})));
test('finite diagnostics never transmit raw text',()=>assert.deepEqual(diagnostic('evil /private',{code:'secret',message:'password'}),{phase:'report',code:'INTEGRATION_FAILED'}));
test('evaluation deadlines terminate wait',async()=>await assert.rejects(deadline(new Promise(()=>{}),5),{code:'INTEGRATION_TIMEOUT'}));
test('sanitized report excludes arbitrary paths and raw failure',()=>{const r={fixtureGenerationCalls:1,fixtureCopyCalls:1,startClicks:1,collisionSkips:2,fixtureCopies:'two-distinct-paths-identical-bytes',terminalTimer:{frozen:true,domMatchesSnapshot:true,reset:true,observedWaitMs:2300,elapsedSeconds:1.4},requestedEncodes:2,extraDecodeCalls:0,probeReadbackCalls:2,processObservation:{kind:'sampled-not-exhaustive',samples:2,observedDescendants:1,observedStartupMedia:0,observedLiveAfterClose:0},launchOwnership:'verified-shell-launcher-and-pinned-main',close:'normal',collisionRefused:true,collisionSnapshotVerified:true,sourceUnchanged:true,packageUnchanged:true,security:secure,outputs:[{sizeBytes:5,sha256:'a'.repeat(64),path:'secret'},{sizeBytes:6,sha256:'c'.repeat(64)}],privatePath:'secret'};const build=Object.fromEntries(['asar','executable','zip'].map(k=>[k,{sizeBytes:5,sha256:'b'.repeat(64)}]));const x=sanitized(authority(env,event),r,null,build);assert(!JSON.stringify(x).includes('secret'));assert.equal(x.picker,'substituted-dialog-return');assert.equal(x.gpu,'not-qualified');for(const o of [undefined,{...r.processObservation,samples:0},{...r.processObservation,observedLiveAfterClose:1},unobservedLaunch()])assert.throws(()=>sanitized(authority(env,event),{...r,processObservation:o},null,build));assert.throws(()=>sanitized(authority(env,event),{...r,close:'forced-owned-tree'}));});
test('inventory refuses linked payload and detects byte change',async()=>{const d=await fs.mkdtemp(path.join(os.tmpdir(),'integration-test-'));try{await fs.writeFile(path.join(d,'a'),'x');const before=await inventory(d);await fs.writeFile(path.join(d,'a'),'y');assert.notDeepEqual(await inventory(d),before);await fs.symlink(path.join(d,'a'),path.join(d,'link'));await assert.rejects(inventory(d));}finally{await fs.rm(d,{recursive:true,force:true});}});
test('workflow is report-only and single successor',async()=>{const t=await fs.readFile(path.join(__dirname,'../.github/workflows/windows-integration.yml'),'utf8');assert(t.includes(PARENT));assert(t.includes('github.run_attempt == 1'));assert(!t.includes('workflow_dispatch'));assert(t.includes('contents: read'));assert(t.includes('steps.verify.outputs.report_path'));assert(!t.includes('no-sandbox'));});

test('report rejects untrusted identity and diagnostics',()=>{assert.throws(()=>sanitized({head:'secret',runId:'1',attempt:1},null,{phase:'build',code:'ERR_ASSERTION'}));assert.throws(()=>sanitized(authority(env,event),null,{phase:'secret',code:'ERR_ASSERTION'}));assert.throws(()=>sanitized(authority(env,event),null,{phase:'build',code:'ERR_ASSERTION',message:'secret'}));});

test('rejected launch without process identity is unobserved, never zero-live',()=>{const o=unobservedLaunch();assert.equal(o.kind,'unobserved-launch');assert.equal(o.observedLiveAfterClose,null);const r={fixtureGenerationCalls:1,fixtureCopyCalls:1,startClicks:0,collisionSkips:0,requestedEncodes:0,extraDecodeCalls:0,probeReadbackCalls:0,close:'unconfirmed',processObservation:o};const report=sanitized(authority(env,event),r,{phase:'launch',code:'INTEGRATION_FAILED'});assert.equal(report.processObservation.observedLiveAfterClose,null);assert.equal(report.close,'unconfirmed');});
test('primary encode failure survives successful and failed cleanup',()=>{const failure={phase:'encode',code:'ERR_ASSERTION'};const r={fixtureGenerationCalls:1,fixtureCopyCalls:1,startClicks:1,collisionSkips:0,requestedEncodes:2,extraDecodeCalls:0,probeReadbackCalls:0,close:'normal',failure};assert.deepEqual(primaryFailure('close',new Error('private'),r),failure);const cleanupFailure={phase:'close',code:'CLOSURE_UNCONFIRMED'};const both={...r,close:'unconfirmed',cleanupFailure};const report=sanitized(authority(env,event),both,primaryFailure('close',new Error('private'),both));assert.deepEqual(report.failure,failure);assert.deepEqual(report.cleanupFailure,cleanupFailure);assert.throws(()=>primaryFailure('close',{}, {failure:{phase:'encode',code:'secret'}}));});

test('two-file success cannot omit counter, output or terminal display proof',()=>{
 const result={fixtureGenerationCalls:1,fixtureCopyCalls:1,startClicks:1,requestedEncodes:2,extraDecodeCalls:0,probeReadbackCalls:2,collisionSkips:2,fixtureCopies:'two-distinct-paths-identical-bytes',terminalTimer:{frozen:true,domMatchesSnapshot:true,reset:true,observedWaitMs:2200,elapsedSeconds:2},outputs:[{sizeBytes:5,sha256:'a'.repeat(64)},{sizeBytes:6,sha256:'b'.repeat(64)}],close:'normal',collisionRefused:true,collisionSnapshotVerified:true,sourceUnchanged:true,packageUnchanged:true,security:secure,launchOwnership:'verified-shell-launcher-and-pinned-main',processObservation:{kind:'sampled-not-exhaustive',samples:2,observedDescendants:2,observedStartupMedia:0,observedLiveAfterClose:0}};
 const build=Object.fromEntries(['asar','executable','zip'].map(k=>[k,{sizeBytes:5,sha256:'b'.repeat(64)}]));
 assert.equal(sanitized(authority(env,event),result,null,build).schema,'windows-packaged-two-file-cpu-integration/v2');
 for(const change of [r=>r.startClicks=2,r=>r.requestedEncodes=1,r=>r.probeReadbackCalls=1,r=>r.collisionSkips=1,r=>r.outputs.pop(),r=>r.terminalTimer.frozen=false,r=>r.terminalTimer.reset=false,r=>r.terminalTimer.observedWaitMs=2199,r=>r.terminalTimer.elapsedSeconds=Infinity,r=>r.fixtureCopies='private']){const r=structuredClone(result);change(r);assert.throws(()=>sanitized(authority(env,event),r,null,build));}
});

test('terminal display readiness waits for renderer without changing completed snapshot',async()=>{
 const {waitForTerminalDisplay}=require('../scripts/windows-packaged-integration.cjs');const done={phase:'completed',batchId:'owned',elapsedSeconds:2.3};
 const shown={snapshot:done,hidden:false,label:'Batch elapsed',elapsed:'00:02',result:'00:02'};let calls=0;
 const result=await waitForTerminalDisplay(async()=>++calls===1?{...shown,hidden:true,result:'—'}:shown,done,'00:02',()=>1000);
 assert.deepEqual(result,shown);assert.equal(calls,2);
});
test('terminal display readiness remains bounded by journey deadline',async()=>{
 const {waitForTerminalDisplay}=require('../scripts/windows-packaged-integration.cjs');
 await assert.rejects(waitForTerminalDisplay(()=>new Promise(()=>{}),{},'00:02',()=>5),{code:'INTEGRATION_TIMEOUT'});
});
