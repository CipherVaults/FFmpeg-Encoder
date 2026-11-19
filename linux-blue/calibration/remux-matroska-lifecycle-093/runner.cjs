'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=__dirname,SCOPE='current092-private-matroska-lifecycle093';
const {deadline,ownedGuard}=require('./ownership.cjs');
let verifyOwner=null,checkDeadline=null;
const stamp = s => ['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k => s[k]);
async function pinned(file, pin) {
  assert(pin && Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 32 * 1024 * 1024);
  assert.equal(await fs.realpath(file), file); const before = await fs.lstat(file, { bigint:true });
  assert(before.isFile() && before.nlink === 1n && before.size === BigInt(pin.bytes));
  const h = await fs.open(file, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
  try {
    assert.deepEqual(stamp(await h.stat({bigint:true})), stamp(before));
    const bytes = Buffer.alloc(pin.bytes); let offset = 0;
    while (offset < bytes.length) { const r = await h.read(bytes, offset, bytes.length-offset, offset); assert(r.bytesRead > 0); offset += r.bytesRead; }
    assert.equal((await h.read(Buffer.alloc(1),0,1,bytes.length)).bytesRead,0);
    assert.deepEqual(stamp(await h.stat({bigint:true})), stamp(before)); assert.deepEqual(stamp(await fs.lstat(file,{bigint:true})),stamp(before));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),pin.sha256); return bytes;
  } finally { await h.close(); }
}
async function write(name,value){if(checkDeadline)checkDeadline();if(verifyOwner)await verifyOwner();await fs.writeFile(path.join(ROOT,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
async function persistFinalResult({result,primary,check,owner,persist}) {
 let failure=primary;
 try{check();}catch(e){result.deadlineFailure={code:e.code||e.name,message:String(e.message).slice(0,1000)};failure ||= e;}
 result.status=failure?'failed-retained':'completed-awaiting-independent-audit';
 // Failure evidence has its own exclusive, identity-checked persistence path.
 // Expiry can prohibit acceptance, never erase the already collected failure.
 await owner();await persist(result);await owner();
 try{check();}catch(e){failure ||= e;}
 return failure;
}
function cancellationConclusion(item,requested){
 if(item.status==='cancelled'){
  assert(requested,'Unrequested cancellation is not this test');
  assert.notEqual(item.outputDisposition?.published,true);assert(!item.outputAccess);
  return 'cancelled';
 }
 assert.equal(item.status,'success','Cancellation attempt failed rather than completing too quickly');
 assert.equal(item.outputDisposition?.published,true,'Successful race must retain published output');
 return 'inconclusive-too-quick';
}
async function run(){
 assert(process.argv.slice(2).join(' ')==='--execute-reviewed-once');assert(!process.env.NODE_OPTIONS&&!Object.entries(process.env).some(([k,v])=>k.startsWith('LD_')&&v));
 const binding=JSON.parse(await fs.readFile(path.join(ROOT,'BINDING.json')));assert.equal(binding.status,'BOUND_AWAITING_RELEASE');const gate=JSON.parse(await fs.readFile(path.join(ROOT,'LEAD_RELEASE.json')));
 assert.equal(binding.scope,SCOPE);assert.equal(gate.scope,SCOPE);assert.equal(gate.approved,true);assert.equal(gate.independentReviewApproved,true);assert.equal(gate.preservationVerified,true);
 await pinned(path.join(ROOT,'BINDING.json'),gate.binding);
 for(const key of ['reviewReceipt','preservationReceipt'])await pinned(gate[key].path,gate[key]);
 for(const [name,pin]of Object.entries(binding.sourceFiles))await pinned(path.join(binding.sourceRoot,name),pin);
 for(const [name,pin]of Object.entries(binding.helpers))await pinned(path.join(ROOT,name),pin);
 const fixture=await pinned(binding.fixture.path,binding.fixture),manifest=JSON.parse(await pinned(binding.runtimeManifest.path,binding.runtimeManifest));
 await write('ATTEMPT_STARTED.json',{scope:SCOPE,started:new Date().toISOString()});
 const guard=await ownedGuard(ROOT);const owned=path.join(ROOT,'owned-attempt1');await fs.mkdir(owned,{mode:0o700});await guard.bind(owned);verifyOwner=()=>guard.check();checkDeadline=deadline(600000);await verifyOwner();for(const n of ['input','output','rescan','cancel-output','state','rescan-state','cancel-state'])await fs.mkdir(path.join(owned,n));
 await fs.writeFile(path.join(owned,'input','fixture.mp4'),fixture,{flag:'wx',mode:0o600});
 // Source is imported only after exact binding verification.
 const load=n=>require(path.join(binding.sourceRoot,n));
 const {openCandidateCalibrationRuntime}=load('linux-blue/candidate-calibration-runtime.cjs');
 const {createAcquisition}=require('./acquisition.cjs');const {OutputAccess}=load('src/output-access.cjs');
 const result={scope:SCOPE,status:'running',cases:[],limits:binding.limits,shellDispatch:'injected-no-desktop',mediaQualification:'Two independently accepted092 MP4-to-Matroska media cells; lifecycle acquisition only, not product authority',cleanup:[]};let owner,primary,timer,cancelPromise;let totalStarted=0,live=0,maxLive=0,closed=0;
 const onChild=child=>{totalStarted++;live++;(result.childEvents ||= []).push({kind:'spawn',sequence:totalStarted,pid:child.pid,atMs:performance.now()});maxLive=Math.max(maxLive,live);child.once('close',(code,signal)=>{live--;closed++;result.childEvents.push({kind:'close',pid:child.pid,code,signal,atMs:performance.now()});});};
 const make=async(state)=>{const runtime=await openCandidateCalibrationRuntime(manifest);return createAcquisition({verifiedRuntime:runtime,stateDir:path.join(owned,state),onChild,outputAccess:new OutputAccess({openPath:async()=>{throw Error('Open not part of acquisition');},showItemInFolder:()=>{result.revealDispatches=(result.revealDispatches||0)+1;}})});};
 const prepare=async(service,input,output)=>{checkDeadline();await verifyOwner();const a=await service.registerFolder(path.join(owned,input),'input'),b=await service.registerFolder(path.join(owned,output),'output');await service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'matroska'});checkDeadline();await verifyOwner();return service.snapshot();};
 const close=async()=>{if(owner){const o=owner;owner=null;try{await o.close();result.cleanup.push({closed:true,requested:o.counts().started});}catch(e){result.cleanup.push({closed:false,code:e.code||e.name});throw e;}}};
 try{
 timer=setTimeout(()=>{result.deadlineReached=true;cancelPromise=owner?.service.cancelCurrent();cancelPromise?.catch(()=>{});},540000);timer.unref();
 owner=await make('state');let ready=await prepare(owner.service,'input','output');assert.equal(ready.items.length,1);assert.equal(ready.items[0].status,'ready',ready.items[0].reason);
 owner.service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]});await owner.service.taskPromise;checkDeadline();await verifyOwner();
 const done=owner.service.snapshot(),item=done.items[0];assert.equal(item.status,'success',item.reason);assert.equal(item.outputDisposition?.published,true);assert(item.outputAccess?.outputId);
 const output=item.outputDisposition.file;assert.equal(path.dirname(output),path.join(owned,'output'));const bytes=await fs.readFile(output),sha=crypto.createHash('sha256').update(bytes).digest('hex');
 await owner.service.openCompletedOutput({outputId:item.outputAccess.outputId,action:'reveal'});assert.equal(result.revealDispatches,1);
 result.cases.push({case:'success',snapshot:done,output:{bytes:bytes.length,sha256:sha}});
 ready=await prepare(owner.service,'input','output');assert.equal(ready.items[0].status,'skipped');assert.equal(ready.items[0].reason,'Output already exists.');assert.equal(crypto.createHash('sha256').update(await fs.readFile(output)).digest('hex'),sha);result.cases.push({case:'collision-no-start',snapshot:ready});
 await close();owner=await make('rescan-state');
 const scan=await prepare(owner.service,'output','rescan');assert.equal(scan.items[0].status,'generated');assert.equal(scan.items[0].origin.kind,'generated');assert.notEqual(scan.items[0].origin.reason,'Recognized application output from local provenance.');result.cases.push({case:'generated-rescan-no-override',snapshot:scan});await close();
 assert(!result.deadlineReached);owner=await make('cancel-state');ready=await prepare(owner.service,'input','cancel-output');assert.equal(ready.items[0].status,'ready',ready.items[0].reason);let requested=false;let cancellationObservation=null;
 owner.service.on('update',s=>{if(!requested&&s.progress?.stage==='remuxing'&&Number.isFinite(s.progress.seconds)){requested=true;cancellationObservation={atMs:performance.now(),liveChildren:live,startedChildren:totalStarted,closedChildren:closed};cancelPromise=owner.service.cancelCurrent();cancelPromise.catch(()=>{});}});
 owner.service.startBatch({planId:ready.planId,fileIds:[ready.items[0].id]});await owner.service.taskPromise;checkDeadline();await verifyOwner();await cancelPromise;
 const cancelled=owner.service.snapshot();const cancellationRecord={case:'cancellation',requested,cancellationObservation,snapshot:cancelled,conclusion:'pending-classification'};result.cases.push(cancellationRecord);
 cancellationRecord.conclusion=cancellationConclusion(cancelled.items[0],requested);
 if(cancelled.items[0].status==='success'){const file=cancelled.items[0].outputDisposition.file;assert.equal(path.dirname(file),path.join(owned,'cancel-output'));const b=await fs.readFile(file);cancellationRecord.publishedOutput={bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),accessIssued:Boolean(cancelled.items[0].outputAccess?.outputId)};}
 if(cancelled.items[0].status==='cancelled'){assert.notEqual(cancelled.items[0].outputDisposition?.published,true);assert(!cancelled.items[0].outputAccess);assert.equal((await fs.readdir(path.join(owned,'cancel-output'))).filter(n=>n.endsWith('.mkv')).length,0);}
 }catch(e){primary=e;result.failure={code:e.code||e.name,message:String(e.message).slice(0,1000)};}
 finally{clearTimeout(timer);try{await close();}catch(e){result.closureFailure={code:e.code||e.name};primary ||= e;}try{await pinned(binding.fixture.path,binding.fixture);for(const [n,p]of Object.entries(binding.sourceFiles))await pinned(path.join(binding.sourceRoot,n),p);result.finalIntegrity=true;}catch(e){result.integrityFailure={code:e.code||e.name};primary ||= e;}result.children={started:totalStarted,closed,live,maxLive};try{checkDeadline();await verifyOwner();assert(totalStarted<=36); }catch(e){primary ||= e;}if(live||result.deadlineReached)primary ||= Error('Unsettled or deadline');primary=await persistFinalResult({result,primary,check:checkDeadline,owner:verifyOwner,persist:async value=>{const data=JSON.stringify(value,null,2)+'\n';assert(Buffer.byteLength(data)<=8*1024*1024,'Failure receipt bound');await fs.writeFile(path.join(ROOT,'RESULT.json'),data,{flag:'wx',mode:0o600});}});}
 if(primary)throw primary;
}
module.exports={pinned,run,cancellationConclusion,persistFinalResult};if(require.main===module)run().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
