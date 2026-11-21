'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createHash}=require('node:crypto');
const {SUITES,summary,complete,aggregate,admitDispatch}=require('./suite-child.cjs');
const {descendants,supervise,canContinue}=require('./run-native.cjs');
const {project,publish}=require('./report.cjs');
const {POLICY}=require('./binding.cjs');

const result=(passed=1,skipped=0)=>({success:true,counts:{tests:passed+skipped,passed,failed:0,cancelled:0,skipped,todo:0}});
test('only the exact per-file Node summary is completion; skips and mismatches cannot pass',async()=>{
  assert.deepEqual(SUITES,{'contiguous-edits':1,'edit-lists':16,playback:5,transport:61});
  const v=result();
  assert(complete('contiguous-edits',v));assert(!complete('contiguous-edits',result(0,1)));
  assert.throws(()=>summary('contiguous-edits',result(2)));
  assert.throws(()=>summary('other',v));
  assert.throws(()=>summary('contiguous-edits',{...v,counts:{...v.counts,tests:0}}));
  const terminal={type:'test:summary',data:v};
  assert.deepEqual(await aggregate('contiguous-edits',[{type:'test:diagnostic',data:'Never serialized'},terminal]),v);
  await assert.rejects(aggregate('contiguous-edits',[terminal,terminal]));
  await assert.rejects(aggregate('contiguous-edits',[]));
});
const node='C:\\runner\\node.exe',ffmpeg='C:\\runtime\\ffmpeg.exe',ffprobe='C:\\runtime\\ffprobe.exe';
const r=(p,pp,ts,exe)=>({ProcessId:p,ParentProcessId:pp,CreationDate:ts,ExecutablePath:exe});
const identity={validIdentity:x=>!!x&&typeof x.ExecutablePath==='string'&&Number.isSafeInteger(x.CreationDate),
  sameIdentity:(a,b)=>!!a&&!!b&&['ProcessId','ParentProcessId','CreationDate','ExecutablePath'].every(k=>a[k]===b[k]),
  canonical:x=>x.toLowerCase(),createdAt:x=>x};
const mediaPaths=new Set([ffmpeg,ffprobe].map(identity.canonical));
const root=r(123,process.pid,100,node),native=r(124,123,101,ffmpeg);
test('custody only admits exact pinned direct children from a live identity-matching parent',()=>{
  const owned=new Map(),unexpected=r(125,123,101,'C:\\something\\stray.exe');
  assert.deepEqual(descendants([root,native,unexpected,r(8,9,104,ffprobe)],root,owned,mediaPaths,identity),
    {rootLive:true,live:[native],unexpected:true});
  assert.deepEqual(descendants([native],root,owned,mediaPaths,identity),{rootLive:false,live:[native],unexpected:false});
  assert.deepEqual(descendants([r(123,process.pid,103,node),r(124,123,104,ffmpeg)],root,owned,mediaPaths,identity),
    {rootLive:false,live:[],unexpected:false});
  assert.throws(()=>descendants([root,native,native],root,new Map(),mediaPaths,identity));
  assert.deepEqual(descendants([root,r(124,123,99,ffmpeg)],root,new Map(),mediaPaths,identity),
    {rootLive:true,live:[],unexpected:true});
});
function simulate({naturally=true,unknown=false,scannerFailure=false,sendAdvance=0,neverAck=false,foreign=null,testFailure=false}={}){
  const child=new EventEmitter();child.pid=123;child.stdout=new PassThrough();child.stderr=new PassThrough();
  let live=true,media=false,granted=0,kills=0,scans=0,offset=0;
  const clock=()=>performance.now()+offset;
  let offending=unknown;
  const reapCalls=[];
  const close=(code,signal)=>{live=false;child.emit('close',code,signal);};
  child.send=(accepted,cb)=>{
    admitDispatch(accepted);granted++;media=true;offset+=sendAdvance;
    if(!neverAck)cb();
    if(naturally)setTimeout(()=>{
      if(foreign){close(foreign.code,foreign.signal);return;}
      media=false;child.emit('message',testFailure?result(0,1):result());close(testFailure?1:0,null);
    },10);
  };
  child.kill=()=>{kills++;close(null,'SIGTERM');return true;};
  return {options:{product:'no-product-is-opened',node,env:{},identity,mediaPaths,deadlineAt:clock()+80,clock,
    rows:async()=>{
      scans++;if(scannerFailure&&scans===3)throw Error('No process sample');
      return [...(live?[root]:[]),...(media?[native]:[]),...(live&&media&&offending?[r(125,123,104,'unknown.exe')]:[])];
    },reap:async row=>{assert.deepEqual(row,native);media=false;reapCalls.push(row.ProcessId);},launch:()=>child},
    inspect:()=>({granted,kills,reapCalls})};
}
test('matching root handshakes only once; normal passing summary still requires final process samples',async()=>{
  const s=simulate(); const item=await supervise('contiguous-edits',s.options);
  assert.equal(item.state,'passed');assert.equal(item.close,'normal');assert.equal(item.remaining,0);
  assert(item.samples>=3&&item.observedChildren===1);
  assert.deepEqual(s.inspect(),{granted:1,kills:0,reapCalls:[]});
});
test('mismatched root executable never authorizes its suite',async()=>{
  const s=simulate({naturally:false});
  s.options.rows=async()=>[r(123,process.pid,100,'C:\\unrelated\\node.exe')];
  const item=await supervise('contiguous-edits',s.options);
  assert.equal(item.state,'failed');assert.equal(item.code,'OWNERSHIP');assert.equal(item.close,'unconfirmed');
  assert.deepEqual(s.inspect(),{granted:0,kills:1,reapCalls:[]});
});
test('timeout stops only the retained root and exact sampled child; forced closure never passes',async()=>{
  const s=simulate({naturally:false}); const item=await supervise('contiguous-edits',s.options);
  assert.equal(item.state,'failed');assert.equal(item.code,'TIMEOUT');assert.equal(item.close,'forced-owned');assert.equal(item.remaining,0);
  assert.deepEqual(s.inspect(),{granted:1,kills:1,reapCalls:[124]});
});
test('no worker is created after the common deadline; worker also refuses stale or invalid grants',async()=>{
  const s=simulate({naturally:false});
  s.options.deadlineAt=s.options.clock()-1;
  s.options.launch=()=>assert.fail('must not spawn an expired suite');
  const item=await supervise('contiguous-edits',s.options);
  assert.equal(item.code,'TIMEOUT');assert.equal(item.close,'not-started');assert(!canContinue(item));
  admitDispatch({kind:'run-approved-exact-suite',notAfter:101},100);
  for(const b of [null,'run-approved-exact-suite',{kind:'run-approved-exact-suite',notAfter:100},
    {kind:'run-approved-exact-suite',notAfter:360101},{kind:'run-approved-exact-suite',notAfter:100.5}]){
    assert.throws(()=>admitDispatch(b,100));
  }
});
test('ownership scan and delayed IPC are charged to the original monotonic budget, not a fresh window',async()=>{
  const afterScan=simulate({naturally:false});
  let calls=0,after=0;const baseRows=afterScan.options.rows,baseClock=afterScan.options.clock;
  afterScan.options.clock=()=>baseClock()+after;
  afterScan.options.rows=()=>{if(++calls===2)after=1000;return baseRows();};
  const noDispatch=await supervise('contiguous-edits',afterScan.options);
  assert.equal(noDispatch.code,'TIMEOUT');assert(!canContinue(noDispatch));
  assert.deepEqual(afterScan.inspect(),{granted:0,kills:1,reapCalls:[]});
  for(const issue of [{sendAdvance:1000},{neverAck:true}]){
    const s=simulate({naturally:false,...issue});const item=await supervise('contiguous-edits',s.options);
    assert.equal(item.code,'TIMEOUT');assert.equal(item.close,'forced-owned');assert(!canContinue(item));
    assert.deepEqual(s.inspect(),{granted:1,kills:1,reapCalls:[124]});
  }
});
test('foreign signals and unexplained exits stop the sequence even if a sampled child can be reaped',async()=>{
  for(const foreign of [{code:null,signal:'SIGTERM'},{code:7,signal:null},{code:1,signal:null}]){
    const s=simulate({foreign});const item=await supervise('contiguous-edits',s.options);
    assert.equal(item.state,'failed');assert(!canContinue(item));
    if(foreign.code!==1){assert.equal(item.code,'CLOSURE_UNCONFIRMED');assert.equal(item.close,'unconfirmed');}
    assert.deepEqual(s.inspect(),{granted:1,kills:0,reapCalls:[124]});
  }
});
test('a coherent ordinary test refusal is red but can continue to another independent suite',async()=>{
  const s=simulate({testFailure:true});const item=await supervise('contiguous-edits',s.options);
  assert.equal(item.state,'failed');assert.equal(item.code,'TEST_FAILED');assert.equal(item.close,'normal');
  assert(item.counts);assert(canContinue(item));
});
test('unknown children are not reaped or certified closed; sampler failure still stops exact owned handles',async()=>{
  for(const cause of [{unknown:true},{scannerFailure:true}]){
    const s=simulate({naturally:false,...cause});const item=await supervise('contiguous-edits',s.options);
    assert.equal(item.state,'failed');
    if(cause.unknown){assert.equal(item.close,'unconfirmed');assert.equal(item.remaining,null);}
    assert.deepEqual(s.inspect(),{granted:1,kills:1,reapCalls:[124]});
  }
});
const hash='a'.repeat(64),pin={sha256:hash,sizeBytes:1,path:'PRIVATE LOCAL PATH'};
function reportSample(){
  const suite=n=>({state:'passed',code:null,counts:result(n).counts,close:'normal',remaining:0,samples:5,observedChildren:3});
  return {policy:POLICY,id:{head:'b'.repeat(40),seed:'c'.repeat(40),runId:'123',attempt:1},harnessTree:'d'.repeat(40),result:{
    failure:null,readback:{harness:'verified',product:'verified',runtime:'verified'},runtime:{archive:pin,
      versions:['ffmpeg.exe','ffprobe.exe'].map(name=>({...pin,name,version:'9.0.2-full_build-www.gyan.dev'})),
      notices:[pin,pin],extractorSha256:hash,listingSha256:hash},
    suites:Object.fromEntries(Object.entries(SUITES).map(([id,n])=>[id,suite(n)])),
    secret:'DO NOT EMIT'}};
}
test('finite log projection is hashed, only includes intended keys, never emits raw test/case data',()=>{
  const i=reportSample(),lines=[];
  assert(publish(i,x=>lines.push(x)));assert.equal(lines.length,2);
  const bytes=lines[1].slice('WIN_Q_REPORT_JSON '.length);
  assert.equal(lines[0],'WIN_Q_REPORT_SHA256 '+createHash('sha256').update(bytes).digest('hex'));
  assert(!/PRIVATE|DO NOT EMIT/.test(bytes));assert.equal(JSON.parse(bytes).state,'PASSED');
  assert.equal(JSON.parse(bytes).schema,'windows-regular-q-native-remux-suites/v2');
  assert.equal(JSON.parse(bytes).suites.transport.expected,61);
});
test('refusals and readback gaps preserve exact observed scope and cannot masquerade as a pass',()=>{
  for(const change of [
    s=>s.readback.runtime='failed',s=>s.suites.playback.close='forced-owned',
    s=>s.suites['edit-lists'].counts=result(15,1).counts,
    s=>delete s.suites.transport,s=>{for(const x of Object.values(s.suites))x.observedChildren=0;},
  ]){
    const input=reportSample();change(input.result);assert.throws(()=>project(input));
  }
  const input=reportSample();delete input.result.suites.transport;input.result.failure={phase:'suites',code:'TIMEOUT',raw:'PRIVATE'};
  const report=project(input);assert.equal(report.state,'FAILED_OR_INCOMPLETE');assert.deepEqual(report.suites.transport,{state:'not-run',expected:61});
  assert.deepEqual(report.failure,{phase:'suites',code:'TIMEOUT'});
});
