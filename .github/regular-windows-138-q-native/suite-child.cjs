'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {run}=require('node:test');
const SUITES=Object.freeze({ 'contiguous-edits':1,'edit-lists':16,playback:5,transport:61 });
const KEYS=['tests','passed','failed','cancelled','skipped','todo'];

function summary(id,raw){
  assert(Object.hasOwn(SUITES,id)&&raw&&typeof raw.success==='boolean');
  const out={};
  for(const k of KEYS){const n=raw.counts?.[k];assert(Number.isSafeInteger(n)&&n>=0&&n<=SUITES[id]);out[k]=n;}
  assert.equal(out.tests,out.passed+out.failed+out.cancelled+out.skipped+out.todo);
  return {counts:out,success:raw.success};
}
function complete(id,value){
  const s=summary(id,{...value,counts:value?.counts});
  return s.success&&s.counts.tests===SUITES[id]&&s.counts.passed===SUITES[id];
}
async function aggregate(id,events){
  let result;
  for await(const event of events){
    if(event.type==='test:summary'){
      assert(!result);result=summary(id,event.data);
    }
  }
  assert(result);return result;
}
function admitDispatch(message,now=Date.now()){
  const limit=message?.notAfter;
  assert.equal(message?.kind,'run-approved-exact-suite');
  assert(Number.isSafeInteger(limit)&&Number.isSafeInteger(now)&&limit>now&&limit-now<=360000);
}
async function main(){
  assert(process.platform==='win32'&&process.arch==='x64'&&process.version==='v24.22.1'&&process.argv.length===3);
  const id=process.argv[2];assert(Object.hasOwn(SUITES,id)&&typeof process.send==='function'&&process.connected);
  // Do not load any tests before the parent binds the waiting process to its
  // observed PID, parent, creation stamp and actual Node executable path.
  const cmd=await new Promise(resolve=>process.once('message',resolve));
  admitDispatch(cmd);
  const result=await aggregate(id,run({files:[path.join(process.cwd(),'tests','remux-'+id+'.test.cjs')],
    isolation:'none',concurrency:1,timeout:120000}));
  await new Promise((resolve,reject)=>process.send(result,e=>e?reject(e):resolve()));
  process.disconnect();process.exitCode=complete(id,result)?0:1;
}
module.exports={SUITES,summary,complete,aggregate,admitDispatch};
if(require.main===module)main().catch(()=>{process.exitCode=1;if(process.connected)process.disconnect();});
