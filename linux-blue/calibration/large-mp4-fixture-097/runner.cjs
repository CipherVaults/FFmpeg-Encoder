'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {readPinned}=require('./pinned-read.cjs');
const SCOPE='current096-large-mp4-generation097', ROOT=__dirname;
const sha=b=>createHash('sha256').update(b).digest('hex');
const failure=e=>e?{code:String(e.code||'ERROR').slice(0,100),message:String(e.message).slice(0,1000)}:null;
function deadline(controller,budget=540000,clock=()=>performance.now()){
 const start=clock();return {remaining:()=>Math.max(0,budget-(clock()-start)),elapsed:()=>clock()-start,
 check(){if(controller.signal.aborted||clock()-start>=budget){controller.abort();throw Error('Generation monotonic deadline/abort');}}};
}
async function directoryIdentity(directory){
 assert.equal(await fs.realpath(directory),directory,'Canonical directory required');const s=await fs.lstat(directory,{bigint:true});
 assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===BigInt(process.getuid())&&s.dev!==0n&&s.ino!==0n,'Owned ordinary directory required');
 return {dev:s.dev,ino:s.ino,uid:s.uid};
}
async function requireDirectory(directory,identity){assert.deepEqual(await directoryIdentity(directory),identity,'Owned directory replaced');}
async function settle(work,close,verify,accept=()=>{}){let report,primary,closure,integrity,acceptance;try{report=await work();}catch(e){primary=e;}try{await close();}catch(e){closure=e;}try{await verify();}catch(e){integrity=e;}try{await accept();}catch(e){acceptance=e;}return{report,primaryFailure:failure(primary),closeFailure:failure(closure),integrityFailure:failure(integrity),acceptanceFailure:failure(acceptance),passed:!primary&&!closure&&!integrity&&!acceptance};}
async function persistOutcome(file,outcome,{check,guard}){
 // Failure evidence remains writable after timeout, but never through a stale
 // parent. Recheck after durable write so a delayed sync cannot retain success.
 await guard();const handle=await fs.open(file,'wx',0o600);
 async function write(){outcome.status=outcome.passed?'generated-metadata-only-awaiting-independent-audit':'failed-retained';const body=JSON.stringify(outcome,null,2)+'\n';assert(Buffer.byteLength(body)<=32*1024**2);await handle.truncate(0);const bytes=Buffer.from(body);let at=0;while(at<bytes.length){const r=await handle.write(bytes,at,bytes.length-at,at);assert(r.bytesWritten>0);at+=r.bytesWritten;}await handle.sync();}
 try{
  try{check();}catch(e){outcome.passed=false;outcome.acceptanceFailure=failure(e);}
  await write();await guard();
  try{check();}catch(e){outcome.passed=false;outcome.acceptanceFailure=failure(e);await write();await guard();}
 }finally{await handle.close();}
}
async function generate({runtime,helpers,owned,signal,remaining,observe,record}){
 const specs=helpers.FIXTURES.filter(x=>x.id==='LARGE_MP4');assert.equal(specs.length,1);const spec=specs[0];assert.equal(spec.seconds,180);assert.equal(spec.minBytes,600*1024**2);assert.equal(spec.maxBytes,800*1024**2);
 const file=path.join(owned,spec.name),run=runtime.createRunner();let count=0,live=0,closed=0;
 async function invoke(kind,args,ceiling,stdoutLimit){assert(count<2&&live===0);await observe();assert(!signal.aborted);const timeoutMs=Math.min(ceiling,remaining());assert(timeoutMs>0);const entry={ordinal:++count,kind,args,started:false,closed:false};record.invocations.push(entry);
  try{return await run(runtime.pins[kind].path,args,{signal,timeoutMs,stdoutLimit,stderrLimit:256*1024,onChild(c){assert.equal(live,0);live++;entry.started=true;entry.pid=c.pid;c.once('close',(code,sig)=>{live--;closed++;entry.closed=true;entry.exitCode=code;entry.signal=sig;});}});}finally{entry.settled=true;record.liveChildren=live;record.closedChildren=closed;assert.equal(live,0,'Child did not close');await observe();}}
 const generated=await invoke('ffmpeg',helpers.generationArgs(spec,file),360000,1024**2);record.generation={stderr:generated.stderr,stderrCapture:generated.stderrCapture};assert.equal(generated.exitCode,0);assert.equal(generated.stderrCapture?.truncated,false);
 const args=['-v','warning','-protocol_whitelist','file','-show_format','-show_streams','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json',file];
 const probe=await invoke('ffprobe',args,60000,2*1024**2);assert.equal(probe.exitCode,0);assert.equal(probe.stderr,'');assert.equal(probe.stderrCapture?.truncated,false);assert(Buffer.byteLength(probe.stdout)<=2*1024**2);
 await observe();await fs.writeFile(path.join(owned,'metadata.json'),probe.stdout,{flag:'wx',mode:0o600});await observe();const pin=await helpers.hashFile(file,{signal});await observe();record.file=pin;record.observation=helpers.assessFixture(JSON.parse(probe.stdout),spec,pin.bytes);assert.equal(count,2);assert.equal(closed,2);return record;
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--execute-reviewed-once']);assert.equal(process.execArgv.length,0);assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert(!process.env.NODE_OPTIONS&&!Object.entries(process.env).some(([k,v])=>k.startsWith('LD_')&&v));
 const rootIdentity=await directoryIdentity(ROOT);const controller=new AbortController(),clock=deadline(controller);
 const bindingBytes=await fs.readFile(path.join(ROOT,'BINDING.json')),b=JSON.parse(bindingBytes),gate=JSON.parse(await fs.readFile(path.join(ROOT,'LEAD_RELEASE.json')));assert.equal(b.scope,SCOPE);assert.equal(gate.scope,SCOPE);assert.equal(gate.binding.sha256,sha(bindingBytes));for(const key of ['approved','independentReviewApproved','preservationVerified'])assert.equal(gate[key],true);assert.equal(gate.commit,b.commit);assert(b.runtimeManifest,'Runtime binding remains unset');
 async function verify(){for(const [name,pin]of Object.entries(b.sourceFiles)){clock.check();await readPinned(path.join(b.sourceRoot,name),pin);clock.check();}for(const [name,pin]of Object.entries(b.helpers)){clock.check();await readPinned(path.join(ROOT,name),pin);clock.check();}await requireDirectory(ROOT,rootIdentity);clock.check();}
 await verify();for(const key of ['reviewReceipt','preservationReceipt'])await readPinned(gate[key].path,gate[key]);const manifest=JSON.parse(await readPinned(b.runtimeManifest.path,b.runtimeManifest));
 const helpers=require(path.join(b.sourceRoot,'scripts/v07-remux-long-fixtures.cjs'));const {openCandidateCalibrationRuntime}=require(path.join(b.sourceRoot,'linux-blue/candidate-calibration-runtime.cjs'));
 const owned=path.join(ROOT,'owned-attempt1');const disk=await fs.statfs(ROOT,{bigint:true});assert(disk.bavail*disk.bsize>=27n*1024n**3n);
 await requireDirectory(ROOT,rootIdentity);clock.check();await fs.writeFile(path.join(ROOT,'ATTEMPT_STARTED.json'),JSON.stringify({scope:SCOPE,commit:b.commit,at:new Date().toISOString()}),{flag:'wx',mode:0o600});await requireDirectory(ROOT,rootIdentity);await fs.mkdir(owned);const owner=await directoryIdentity(owned);await requireDirectory(ROOT,rootIdentity);clock.check();
 const lease=await fs.open(path.join(owned,'LEASE.json'),'wx',0o600);await lease.writeFile(JSON.stringify({scope:SCOPE,pid:process.pid}));await lease.sync();const leaseIdentity=await lease.stat({bigint:true});
 const record={scope:SCOPE,commit:b.commit,runtimeIdentity:manifest.runtimeIdentity,invocations:[],publication:false,acceptanceAuthority:false,completeDecodeProven:false,peakOwnedBytes:0,liveChildren:0,closedChildren:0};let runtime,monitorFailure,checking=false,monitorTask=Promise.resolve();
 async function guardDirectories(){await requireDirectory(ROOT,rootIdentity);await requireDirectory(owned,owner);}
 async function observe(){clock.check();await guardDirectories();const disk=await fs.statfs(owned,{bigint:true});assert(disk.bavail*disk.bsize>=27n*1024n**3n);const bytes=await helpers.ownedBytes(owned);assert(bytes<=2*1024**3);record.peakOwnedBytes=Math.max(record.peakOwnedBytes,Number(bytes));await guardDirectories();clock.check();}
 const timer=setTimeout(()=>controller.abort(),clock.remaining());const monitor=setInterval(()=>{if(checking)return;checking=true;monitorTask=observe().catch(e=>{monitorFailure=e;controller.abort();}).finally(()=>{checking=false;});},250);
 const outcome=await settle(async()=>{runtime=await openCandidateCalibrationRuntime(manifest);await generate({runtime,helpers,owned,signal:controller.signal,remaining:clock.remaining,observe,record});if(monitorFailure)throw monitorFailure;return record;},async()=>{clearInterval(monitor);await monitorTask;let error;try{if(runtime)await runtime.close();}catch(e){error=e;}try{const named=await fs.lstat(path.join(owned,'LEASE.json'),{bigint:true}),held=await lease.stat({bigint:true});assert(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n&&named.dev===leaseIdentity.dev&&named.ino===leaseIdentity.ino&&held.dev===named.dev&&held.ino===named.ino);}catch(e){error||=e;}try{await lease.close();}catch(e){error||=e;}try{await observe();}catch(e){error||=e;}if(monitorFailure)error||=monitorFailure;if(error)throw error;},verify,async()=>{await guardDirectories();clock.check();});clearTimeout(timer);
 outcome.record=record;outcome.elapsedMs=clock.elapsed();outcome.runtimeClosed=!!runtime&&!outcome.closeFailure;outcome.sourceUnchanged=!outcome.integrityFailure;
 await persistOutcome(path.join(ROOT,'RESULT.json'),outcome,{check:()=>clock.check(),guard:guardDirectories});if(!outcome.passed)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.code||'ERROR',e.message);process.exitCode=1;});module.exports={SCOPE,generate,settle,deadline,directoryIdentity,requireDirectory,persistOutcome};
