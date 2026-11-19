'use strict';
// Fresh, unbound successor. No media launch until missing inputs and new review/release exist.
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { SOURCE_ROOT, collectActual } = require('./collector-options.cjs');
const {deadline,ownedGuard}=require('./ownership.cjs');
const SCOPE = 'current091-mp4-matroska-private-proof';
const LEDGER=Object.freeze({'source-assessment':1,'packet-copy':1,'output-probe':1,'independent-pcm':2,'collect-current-evidence':14});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = s => ['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k => s[k]);
async function readPinned(file, pin) {
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
    assert.equal(sha(bytes),pin.sha256); return bytes;
  } finally { await h.close(); }
}
async function run() {
  assert.deepEqual(process.argv.slice(2), ['--execute-reviewed-once']); assert.equal(process.execArgv.length,0);
  assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64'); assert(!process.env.NODE_OPTIONS);
  assert(!Object.keys(process.env).some(k=>k.startsWith('LD_') && process.env[k]));
  const bindingBytes=await fs.readFile(path.join(__dirname,'BINDING.json')), b=JSON.parse(bindingBytes);
  assert.equal(b.scope,SCOPE); assert.equal(b.sourceRoot,SOURCE_ROOT); assert.equal(b.status,'BOUND_AWAITING_RELEASE');assert(b.fixture && b.runtimeManifest && b.ownerRoot && b.gatePath, 'Inputs remain unbound');
  assert.deepEqual(b.limits,{children:19,overallMs:600000,childMs:120000,minimumFreeBytes:28991029248,ownedBytes:536870912});
  const gate=JSON.parse(await fs.readFile(b.gatePath));
  assert.equal(gate.scope,SCOPE); assert.equal(gate.approved,true); assert.equal(gate.bindingSha256,sha(bindingBytes)); assert.equal(gate.commit,b.commit);
  for (const name of ['runner.cjs','collector-options.cjs','experiment-runtime.cjs','ownership.cjs']) assert.equal(gate.helperHashes[name],sha(await fs.readFile(path.join(__dirname,name))));
  for (const p of [gate.reviewReceipt,gate.preservationReceipt]) await readPinned(p.path,p);
  assert.equal(gate.independentReviewApproved,true); assert.equal(gate.preservationVerified,true);
  async function verifySource() { for (const [name,pin] of Object.entries(b.sourceFiles)) await readPinned(path.join(SOURCE_ROOT,name),pin); }
  await verifySource(); await readPinned(b.fixture.path,b.fixture);
  const manifest=JSON.parse(await readPinned(b.runtimeManifest.path,b.runtimeManifest));
  const load=name=>require(path.join(SOURCE_ROOT,'src',name));
  const { runTool }=load('process-runner.cjs'), { inspectMetadata }=load('inspection.cjs');
  const { assessRemux,buildRemuxQualificationArgs }=load('remux-contract.cjs');
  const { getCollectedRemuxEvidence }=load('remux-evidence.cjs');
  const { validateRemuxMediaQualification,createRemuxValidator }=load('remux-validation.cjs');
  const { openCandidateCalibrationRuntime }=require('./experiment-runtime.cjs');
  await fs.writeFile(path.join(__dirname,'ATTEMPT_STARTED.json'),JSON.stringify({commit:b.commit,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const guard=await ownedGuard(__dirname);const owned=b.ownerRoot;assert.equal(path.dirname(owned),__dirname);assert(path.basename(owned).startsWith('owned-'));await fs.mkdir(owned,{mode:0o700});await guard.bind(owned);const assertDeadline=deadline(b.limits.overallMs),phaseCounts={};
  const controller=new AbortController(), started=Date.now(), live=new Set(); let runtime, count=0, busy=false, polling=null, phase='runtime';
  const report={scope:SCOPE,commit:b.commit,qualificationGranted:false,publication:false,status:'running',children:[]};
  async function capacity() {
    assertDeadline();await guard.check();const disk=await fs.statfs(owned,{bigint:true}); assert(disk.bavail*disk.bsize>=BigInt(b.limits.minimumFreeBytes)); let bytes=0;
    async function walk(dir) { for (const e of await fs.readdir(dir,{withFileTypes:true})) { const p=path.join(dir,e.name),s=await fs.lstat(p); assert(!s.isSymbolicLink()); if(s.isDirectory()) await walk(p); else { assert(s.isFile() && s.nlink===1); bytes+=s.size; } } }
    await walk(owned); assert(bytes<=b.limits.ownedBytes);
  }
  const timer=setTimeout(()=>controller.abort(new Error('Overall deadline')),b.limits.overallMs);
  const poll=setInterval(()=>{if(!polling) polling=capacity().catch(e=>controller.abort(e)).finally(()=>{polling=null;});},1000);
  try {
    await capacity(); runtime=await openCandidateCalibrationRuntime(manifest,{execute:async(exe,args,opts={})=>{
      assertDeadline();await guard.check();assert(!busy && live.size===0 && count<b.limits.children);assert(LEDGER[phase]&&((phaseCounts[phase]||0)<LEDGER[phase]));phaseCounts[phase]=(phaseCounts[phase]||0)+1;busy=true;
      try { await capacity(); assert(!controller.signal.aborted); const remaining=b.limits.overallMs-(Date.now()-started); assert(remaining>0);
        const row={sequence:++count,phase,args,closed:false}; report.children.push(row);
        return await runTool(exe,args,{...opts,timeoutMs:Math.min(opts.timeoutMs||b.limits.childMs,b.limits.childMs,remaining),signal:AbortSignal.any([controller.signal,...(opts.signal?[opts.signal]:[])]),onChild(child){live.add(child);child.once('close',(code,signal)=>{live.delete(child);Object.assign(row,{closed:true,code,signal});});opts.onChild?.(child);}});
      } finally { busy=false; }
    }});
    const runner=runtime.createRunner(), runBound=(exe,args,opts={})=>runner(exe,args,{...opts,timeoutMs:Math.min(opts.timeoutMs||b.limits.childMs,b.limits.childMs),signal:AbortSignal.any([controller.signal,...(opts.signal?[opts.signal]:[])])});
    const probe=file=>inspectMetadata(file,{ffprobe:manifest.pins.ffprobe.path,run:runBound,signal:controller.signal});
    phase='source-assessment';const sourceProbe=await probe(b.fixture.path);report.sourceProbe=sourceProbe;
    assert.equal(sourceProbe.streams.length,2);const v=sourceProbe.streams.find(s=>s.codec_type==='video'),a=sourceProbe.streams.find(s=>s.codec_type==='audio');
    assert(v?.codec_name==='h264' && v.pix_fmt==='yuv420p' && a?.codec_name==='aac' && a.profile==='LC');assert(String(a.sample_rate)==='48000' && a.channels===2 && a.channel_layout==='stereo');assert(v.width<=1920&&v.height<=1080&&v.field_order==='progressive'&&v.color_transfer==='bt709');assert(Number(sourceProbe.format.duration)<=8.1);assert(!(sourceProbe.chapters||[]).length);
    const assessment=assessRemux({request:{fileId:'fixed-owned-fixture',identityRevision:0,draftRevision:0,operation:'remux',target:'matroska',range:null,omissionRequestIds:[]},probe:sourceProbe,sourceFingerprint:b.fixture.sha256});report.assessment=assessment;assert.notEqual(assessment.status,'blocked');
    const outputId=randomUUID(),output=path.join(owned,'copy.mkv'); const args=buildRemuxQualificationArgs({assessment,input:b.fixture.path,output,outputId});assert(args.includes('-n') && args.includes('copy'));
    phase='packet-copy';report.copy=await runBound(manifest.pins.ffmpeg.path,args);assert.equal(report.copy.exitCode,0);assert(!report.copy.stderrCapture.truncated);
    phase='output-probe';const outputProbe=await probe(output);report.outputProbe=outputProbe;
    phase='independent-pcm';report.completePresentation=[];
    for(const file of [b.fixture.path,output]){
      let bytes=0;const digest=createHash('sha256');
      const result=await runBound(manifest.pins.ffmpeg.path,['-hide_banner','-nostdin','-v','error','-xerror','-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-vn','-sn','-dn','-c:a','pcm_f32le','-f','f32le','pipe:1'],{stdoutLimit:64*1024*1024,onStdoutChunk:chunk=>{bytes+=chunk.length;assert(bytes<=64*1024*1024);digest.update(chunk);}});
      assert.equal(result.exitCode,0);assert(bytes>0&&bytes%8===0);assert(!result.stderrCapture.truncated);assertDeadline();await guard.check();
      report.completePresentation.push({bytes,samples:bytes/8,sha256:digest.digest('hex'),alignment:'none; full decoded presentation from sample zero'});
    }
    report.completePresentationEqual=JSON.stringify(report.completePresentation[0])===JSON.stringify(report.completePresentation[1]);
    phase='collect-current-evidence';
    const receipt=await collectActual({assessment,sourceBytes:b.fixture.bytes,runtimeIdentity:manifest.runtimeIdentity,outputId,sourceProbe,outputProbe,sourcePath:b.fixture.path,outputPath:output,stageDirectory:owned,ffmpeg:manifest.pins.ffmpeg.path,ffprobe:manifest.pins.ffprobe.path,run:runBound,signal:controller.signal});
    report.collectorReceipt=receipt;
    const bindings={assessment,runtimeIdentity:manifest.runtimeIdentity,outputId};const essence=getCollectedRemuxEvidence(receipt,bindings);report.essence=essence;
    phase='media-only-validation';report.mediaValidation=validateRemuxMediaQualification({...bindings,cellId:'current-linux-mp4-matroska-media-only',outputProbe,essenceEvidence:essence,maxTimestampError:{numerator:'1',denominator:'500'},maxChapterError:{numerator:'0',denominator:'1'}});
    assert.throws(()=>createRemuxValidator({requireQualification:()=>report.mediaValidation}).prepare({...bindings,cellId:'current-linux-mp4-matroska-media-only'}));
    await runtime.requireCurrent();await capacity();assertDeadline();await guard.check();report.status=report.mediaValidation.valid&&report.completePresentationEqual?'media-only-passed-awaiting-audit':'media-only-refused';
  } catch(e) {report.status='failed';report.failure={phase,code:e.code||'ERROR',message:String(e.message).slice(0,2000)};}
  finally {
    clearInterval(poll);clearTimeout(timer);await polling;
    try{await runtime?.close();}catch(e){report.closureFailure={code:e.code||'ERROR'};}
    try{await verifySource();await readPinned(b.fixture.path,b.fixture);report.finalSourceUnchanged=true;}catch(e){report.finalSourceUnchanged=false;}
    report.liveAfterClose=live.size;report.durationMs=Date.now()-started;report.phaseCounts=phaseCounts;
    try{assertDeadline();await guard.check();assert(!controller.signal.aborted);assert(report.finalSourceUnchanged&&!report.closureFailure&&live.size===0);}catch(e){report.status='failed';report.finalAcceptanceFailure={code:e.code||e.name,message:String(e.message)};}
    await guard.check();
    await fs.writeFile(path.join(owned,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    assertDeadline();await guard.check();
    await fs.writeFile(path.join(owned,'FINAL_ACCEPTANCE.json'),JSON.stringify({accepted:report.status==='media-only-passed-awaiting-audit',publication:false,activation:false,scope:SCOPE,reportSha256:sha(await fs.readFile(path.join(owned,'report.json')))})+'\n',{flag:'wx',mode:0o600});
    assertDeadline();await guard.check();
  }
  assert.equal(report.liveAfterClose,0);assert(!report.closureFailure);assert(report.finalSourceUnchanged);if(report.status!=='media-only-passed-awaiting-audit')process.exitCode=1;
}
if(require.main===module)run().catch(e=>{console.error(e.code||'ERROR',e.message);process.exitCode=1;});
module.exports={readPinned,collectActual,run,LEDGER};
