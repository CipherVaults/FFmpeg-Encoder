'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {NativeFileToolOwner}=require('../src/native-file-tools.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const options={timeoutMs:5000,stdoutLimit:1024,stderrLimit:1024};
const makeChild=()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kills=0;c.kill=()=>{c.kills++;return true;};return c;};
function harness(changes={}){
  const entered=deferred(),runner=deferred();let io,child,calls=0;
  const owner=new NativeFileToolOwner({maximumChildren:changes.maximumChildren||8,maximumBytes:changes.maximumBytes||8192,deadlineMs:changes.deadlineMs||5000,...(changes.now?{now:changes.now}:{}),run:changes.run||((_exe,_argv,context)=>{calls++;io=context;child=makeChild();io.onChild(child);child.stdout.on('data',b=>{io.onOutputBytes({stream:'stdout',bytes:b.length});if(io.onStdoutChunk)io.onStdoutChunk(changes.forward?changes.forward(b):b);if(io.onProgress)io.onProgress({frame:1});});child.stderr.on('data',b=>io.onOutputBytes({stream:'stderr',bytes:b.length}));entered.resolve();return runner.promise;})});
  const start=extra=>owner.invoke('C:\\fixed\\ffmpeg.exe',['-fixed'],{...options,...extra});
  const finish=({out=Buffer.from('metadata'),err=Buffer.from('native log\n'),code=0,signal=null,closeFirst=false,eof=true,resultChanges={}}={})=>{
    if(closeFirst)child.emit('close',code,signal);child.stdout.write(out);child.stderr.write(err);if(eof){child.stdout.end();child.stderr.end();}if(!closeFirst)child.emit('close',code,signal);
    runner.resolve({stdout:io.onProgress||io.onStdoutChunk?'':out.toString('utf8'),stderr:err.toString('utf8'),stderrCapture:{totalBytes:err.length,truncated:false},exitCode:code,
      ...(io.onStdoutChunk?{stdoutCapture:{totalBytes:out.length,truncated:false,streamed:true}}:{}),...resultChanges});
  };
  return{owner,entered,start,finish,runner,get child(){return child;},get io(){return io;},get calls(){return calls;}};
}
test('real pipes join both EOF/close orders and original private receipt; copies refuse',async()=>{
  for(const closeFirst of [false,true]){const h=harness(),work=h.start();await h.entered.promise;h.finish({closeFirst});const receipt=await work,result=h.owner.requireReceipt(receipt);assert.equal(result.resourceClosureConfirmed,true);assert.equal(result.stderr,'native log\n');assert.equal(result.stdout,'metadata');assert.deepEqual(result.close,{code:0,signal:null});assert.throws(()=>h.owner.requireReceipt({...receipt}),{code:'NATIVE_TOOL_RECEIPT_UNOWNED'});await h.owner.close();}
});
test('early runner and child close cannot replace the missing pipe EOFs',async()=>{
  const h=harness(),work=h.start();let finished=false;work.then(()=>{finished=true;});await h.entered.promise;h.finish({eof:false});await tick();assert.equal(finished,false);assert.equal(h.owner.snapshot().busy,true);await assert.rejects(h.start(),{code:'NATIVE_TOOL_BUSY'});h.child.stdout.end();h.child.stderr.end();await work;await h.owner.close();
});
test('async binary sink retains the slot beyond child/EOF/runner and records exact complete bytes',async()=>{
  const sink=deferred(),h=harness(),work=h.start({onStdoutChunk:()=>sink.promise});await h.entered.promise;h.finish();await tick();assert.equal(h.owner.snapshot().busy,true);let closed=false;const closing=h.owner.close().then(()=>{closed=true;});await tick();assert.equal(closed,false);sink.resolve();await assert.rejects(work,{code:'CANCELLED'});await closing;assert.equal(h.owner.snapshot().busy,false);
});
test('successful streamed sink receives actual bytes and complete streamed capture',async()=>{
  const data=[],h=harness(),work=h.start({onStdoutChunk:async b=>{await tick();data.push(Buffer.from(b));}});await h.entered.promise;h.finish();const receipt=await work;assert.equal(Buffer.concat(data).toString(),'metadata');assert.equal(h.owner.requireReceipt(receipt).stdoutBytes,8);await h.owner.close();
});
test('late sink rejection remains failure after child close and all other sinks drain',async()=>{
  const a=deferred(),b=deferred(),h=harness(),work=h.start({onStdoutChunk:()=>a.promise,onOutputBytes:()=>b.promise});const rejected=assert.rejects(work,/sink failed/);await h.entered.promise;h.finish();a.reject(new Error('sink failed'));await tick();assert.equal(h.owner.snapshot().busy,true);b.resolve();await rejected;await h.owner.close();
});
test('pre-abort and immediate invoke-close do not enter the runner or quarantine an unspawned child',async()=>{
  const h=harness(),abort=new AbortController();abort.abort();await assert.rejects(h.start({signal:abort.signal}),{code:'CANCELLED'});assert.equal(h.calls,0);
  const work=h.start(),rejected=assert.rejects(work,{code:'CANCELLED'}),closing=h.owner.close();await rejected;await closing;assert.equal(h.calls,0);assert.equal(h.owner.snapshot().ownershipUnknown,false);
});
test('active cancel waits real resources and rejects zero exit success',async()=>{
  const h=harness(),controller=new AbortController(),work=h.start({signal:controller.signal}),rejected=assert.rejects(work,{code:'CANCELLED'});await h.entered.promise;controller.abort();await tick();assert.ok(h.child.kills>0);assert.equal(h.owner.snapshot().busy,true);h.finish();await rejected;await h.owner.close();
});
test('failure resumes paused pipes after sink drain without releasing early',async()=>{
  const h=harness(),controller=new AbortController(),work=h.start({signal:controller.signal}),rejected=assert.rejects(work,{code:'CANCELLED'});await h.entered.promise;h.child.stdout.pause();h.finish();controller.abort();await rejected;await h.owner.close();assert.equal(h.owner.snapshot().busy,false);
});
test('child errors and nonzero/signal closes cannot be hidden by a successful runner result',async()=>{
  for(const mode of ['error','code','signal']){const h=harness(),work=h.start(),rejected=assert.rejects(work);await h.entered.promise;if(mode==='error')h.child.emit('error',new Error('child failed'));h.finish({code:mode==='code'?1:0,signal:mode==='signal'?'SIGTERM':null,resultChanges:{exitCode:0}});await rejected;await h.owner.close();}
});
test('pipe close without EOF refuses complete evidence but physically closed resources can drain',async()=>{
  const h=harness(),work=h.start(),rejected=assert.rejects(work,{code:'NATIVE_CHILD_INCOMPLETE'});await h.entered.promise;h.finish({eof:false});h.child.stdout.destroy();h.child.stderr.destroy();await rejected;await h.owner.close();
});
test('fake returned stderr, invalid UTF8 metadata and lost capture prefixes refuse',async()=>{
  for(const change of [{resultChanges:{stderr:'substituted'}},{out:Buffer.from([0xff])},{resultChanges:{stderrCapture:{totalBytes:11,truncated:true}}}]){const h=harness(),work=h.start(),rejected=assert.rejects(work,{code:'NATIVE_CAPTURE_MISMATCH'});await h.entered.promise;h.finish(change);await rejected;await h.owner.close();}
});
test('independent hard stdout/stderr/aggregate limits stop rather than accepting tail captures',async()=>{
  for(const [extra,change,maximumBytes]of [[{stdoutLimit:2},{out:Buffer.from('oversize')},8192],[{stderrLimit:2},{err:Buffer.from('oversize')},8192],[{}, {},2]]){const h=harness({maximumBytes}),work=h.start(extra),rejected=assert.rejects(work,{code:'NATIVE_TOOL_LIMIT'});await h.entered.promise;h.finish(change);await rejected;await h.owner.close();}
});
test('no-child and malformed observer setup quarantine lease release',async()=>{
  for(const run of [async()=>({stdout:'',stderr:'',stderrCapture:{totalBytes:0,truncated:false},exitCode:0}),async(_e,_a,o)=>{const c=makeChild();c.stdout.once=()=>{throw new Error('listener setup failed');};o.onChild(c);return{exitCode:0};}]){const h=harness({run});await assert.rejects(h.start(),{code:'NATIVE_CHILD_UNOBSERVED'});assert.equal(h.owner.snapshot().ownershipUnknown,true);await assert.rejects(h.owner.close(),{code:'NATIVE_TOOL_OWNERSHIP_UNKNOWN'});}
});
test('synchronous reentrant close observes the already installed work promise and drains',async()=>{
  let h,closing;h=harness({run:async(_e,_a,o)=>{const c=makeChild();o.onChild(c);closing=h.owner.close();c.stdout.end();c.stderr.end();c.emit('close',0,null);return{stdout:'',stderr:'',stderrCapture:{totalBytes:0,truncated:false},exitCode:0};}});await assert.rejects(h.start(),{code:'CANCELLED'});await closing;assert.equal(h.owner.snapshot().ownershipUnknown,false);
});
test('a second child arriving during drain is also joined and quarantines late callbacks',async()=>{
  const first=makeChild(),second=makeChild(),entered=deferred();let callback;
  const h=harness({run:async(_e,_a,o)=>{callback=o.onChild;callback(first);entered.resolve();return{stdout:'',stderr:'',stderrCapture:{totalBytes:0,truncated:false},exitCode:0};}}),work=h.start(),rejected=assert.rejects(work,{code:'NATIVE_CHILD_UNOBSERVED'});await entered.promise;await tick();callback(second);first.stdout.end();first.stderr.end();first.emit('close',0,null);await tick();assert.equal(h.owner.snapshot().busy,true);second.stdout.end();second.stderr.end();second.emit('close',0,null);await rejected;await assert.rejects(h.owner.close(),{code:'NATIVE_TOOL_OWNERSHIP_UNKNOWN'});assert.equal(h.owner.snapshot().observedChildren,2);
});
test('clock rollback/overflow and post-drain overdue completion refuse, retaining primary cancellation',async()=>{
  assert.throws(()=>harness({now:()=>Number.MAX_SAFE_INTEGER}),{code:'NATIVE_TOOL_CLOCK'});
  let now=100;const h=harness({now:()=>now}),first=h.start();await h.entered.promise;h.finish();await first;now=99;await assert.rejects(h.start(),{code:'NATIVE_TOOL_CLOCK'});await h.owner.close();
  for(const cancel of [false,true]){let clock=100;const x=harness({now:()=>clock,deadlineMs:10}),controller=new AbortController(),work=x.start({signal:controller.signal}),rejected=assert.rejects(work,{code:cancel?'CANCELLED':'NATIVE_TOOL_TIMEOUT'});await x.entered.promise;if(cancel)controller.abort();clock=111;x.finish();await rejected;await x.owner.close();}
});
test('dense inert argv/options and finite >2GiB budget arithmetic never coerce getters',async()=>{
  let calls=0;const h=harness({maximumBytes:3*1024**3}),argv=['x'];Object.defineProperty(argv,0,{enumerable:true,get(){calls++;return'x';}});
  await assert.rejects(h.owner.invoke('fixed',argv,options),{code:'INVALID_NATIVE_TOOL'});await assert.rejects(h.owner.invoke('fixed',['x'],{...options,spawnImpl(){calls++;}}),{code:'INVALID_NATIVE_TOOL'});assert.equal(calls,0);assert.equal(h.owner.snapshot().bytes,0);await h.owner.close();
});

test('a sink that receives altered, missing or misreported stdout bytes refuses the complete capture',async()=>{
  const cases=[[{forward:b=>Buffer.from(b).fill(0x41)},{}],[{forward:b=>b.subarray(1)},{}],
    [{},{stdoutCapture:{totalBytes:8,truncated:true,streamed:true}}],[{},{stdoutCapture:{totalBytes:8,truncated:false,streamed:false}}],[{},{stdoutCapture:{totalBytes:9,truncated:false,streamed:true}}]];
  for(const [changes,resultChanges] of cases){const h=harness(changes),work=h.start({onStdoutChunk:()=>{}});await h.entered.promise;h.finish({resultChanges});
    await assert.rejects(work,{code:'NATIVE_CAPTURE_MISMATCH'},JSON.stringify(resultChanges)+String(changes.forward));await h.owner.close();}
});
