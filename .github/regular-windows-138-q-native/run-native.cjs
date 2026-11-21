'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {SUITES,summary,complete}=require('./suite-child.cjs');
const WAIT_MS=Object.freeze({'contiguous-edits':75000,'edit-lists':90000,playback:150000,transport:360000});
function fail(code){throw Object.assign(new Error('Bounded Windows Q scope refused.'),{code});}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(p,ms){
  let timer;try{return await Promise.race([p,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Object.assign(new Error('Bounded Windows Q scope timed out.'),{code:'TIMEOUT'})),ms);
  })]);}finally{clearTimeout(timer);}
}
function remaining(until,clock){
  const ms=Math.floor(until-clock());
  if(!Number.isSafeInteger(ms)||ms<=0)fail('TIMEOUT');
  return ms;
}
function canContinue(item){
  return item?.close==='normal'&&item.remaining===0&&
    (item.state==='passed'||(item.state==='failed'&&item.code==='TEST_FAILED'&&item.counts&&typeof item.counts==='object'));
}
function bounded(operation,end,clock){const ms=remaining(end,clock);return deadline(operation(),ms);}
function key(r){return r.ProcessId+':'+r.CreationDate;}
function descendants(rows,root,owned,paths,identity){
  assert(Array.isArray(rows)&&rows.length<=4096);
  const byPid=new Map();
  for(const r of rows){assert(Number.isSafeInteger(r?.ProcessId)&&r.ProcessId>=0&&!byPid.has(r.ProcessId));byPid.set(r.ProcessId,r);}
  const rootCurrent=byPid.get(root.ProcessId);
  const rootLive=identity.sameIdentity(rootCurrent,root);
  // Admission occurs only while the verified parent still exists. Stale or
  // reused PIDs are never used to assert ancestry or dispatch cleanup.
  let unexpected=false;
  if(rootLive)for(const r of rows){
    if(r.ParentProcessId!==root.ProcessId||r.ProcessId===root.ProcessId)continue;
    if(!identity.validIdentity(r)||identity.createdAt(r.CreationDate)<identity.createdAt(root.CreationDate)||
       !paths.has(identity.canonical(r.ExecutablePath))){unexpected=true;continue;}
    if(!owned.has(key(r))){assert(owned.size<2048);owned.set(key(r),r);}
  }
  const live=[...owned.values()].filter(r=>identity.sameIdentity(byPid.get(r.ProcessId),r));
  return {rootLive,live,unexpected};
}
async function supervise(id,{product,node,env,identity,rows,reap,mediaPaths,deadlineAt,launch=spawn,clock=()=>performance.now()}){
  const result={state:'failed',code:'TEST_FAILED',counts:null,close:'unconfirmed',samples:0,observedChildren:0,remaining:null};
  assert(Object.hasOwn(WAIT_MS,id));
  const end=Math.min(deadlineAt,clock()+WAIT_MS[id]);
  const file=path.join(__dirname,'suite-child.cjs');
  // Absolute monotonic deadline applies to setup, dispatch and useful work;
  // reaping a process already owned never gives future work extra time.
  try{remaining(end,clock);}catch{return {...result,code:'TIMEOUT',close:'not-started'};}
  const child=launch(node,[file,id],{cwd:product,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});
  let closed=null,error=false,received=null,messages=0,bytes=0,root=null,forced=false,forcedRoot=false,sampling=null,stopSampling=false,protocolConfirmed=false;
  const owned=new Map();let sawUnknown=false;
  const tooLarge=()=>bytes>1024*1024;
  const finished=new Promise(resolve=>child.once('close',(code,signal)=>{closed={code,signal,at:clock()};resolve(closed);}));
  child.on('error',()=>{error=true;});
  child.on('message',value=>{if(++messages===1)received=value;});
  for(const pipe of [child.stdout,child.stderr])if(pipe){
    pipe.on('data',chunk=>{bytes=Math.min(1024*1024+1,bytes+chunk.length);});
    pipe.on('error',()=>{error=true;});
  }
  const take=async()=>{
    assert(++result.samples<=1800);
    const x=descendants(await rows(),root,owned,mediaPaths,identity);
    sawUnknown ||= x.unexpected;return x;
  };
  try{
    if(!Number.isSafeInteger(child.pid)||child.pid<=0)fail('OWNERSHIP');
    const first=await bounded(rows,end,clock),row=first.find(r=>r?.ProcessId===child.pid);
    if(!identity.validIdentity(row)||row.ParentProcessId!==process.pid||
      identity.canonical(row.ExecutablePath)!==identity.canonical(node)||closed)fail('OWNERSHIP');
    root=row;
    const initial=await bounded(take,end,clock);
    if(!initial.rootLive||initial.unexpected||initial.live.length||closed)fail('OWNERSHIP');
    const windowMs=remaining(end,clock);
    const authorization={kind:'run-approved-exact-suite',notAfter:Date.now()+windowMs};
    const send=new Promise((resolve,reject)=>child.send(authorization,e=>e?reject(e):resolve()));
    sampling=(async()=>{
      while(!stopSampling&&!closed){
        if(error||tooLarge()||messages>1)fail(tooLarge()?'OUTPUT_LIMIT':'CHILD_PROTOCOL');
        if((await take()).unexpected)fail('UNEXPECTED_CHILD');
        if(!closed)await sleep(500);
      }
    })();
    // Observed errors from the monitoring loop also stop an unacknowledged send.
    const samplingFailure=sampling.then(()=>finished);
    await deadline(Promise.race([send,samplingFailure]),Math.min(10000,windowMs));
    const observed=await deadline(Promise.race([finished,samplingFailure]),remaining(end,clock));
    if(observed.at>=end)fail('TIMEOUT');
    stopSampling=true;await sampling;
    if(error||messages!==1||!received||tooLarge())fail(tooLarge()?'OUTPUT_LIMIT':'CHILD_PROTOCOL');
    result.counts=summary(id,received).counts;
    const passed=complete(id,received);
    if(closed.signal!==null||closed.code!==(passed?0:1))fail('CHILD_PROTOCOL');
    protocolConfirmed=true;
    if(!passed)fail('TEST_FAILED');
    result.state='passed';result.code=null;
  }catch(error){
    result.state='failed';
    result.code=['OWNERSHIP','TIMEOUT','OUTPUT_LIMIT','CHILD_PROTOCOL','UNEXPECTED_CHILD','TEST_FAILED'].includes(error?.code)?error.code:'TEST_FAILED';
  }finally{
    stopSampling=true;
    try{if(sampling)await deadline(sampling.catch(()=>{}),12000);}catch{result.code='CLOSURE_UNCONFIRMED';result.state='failed';}
    try{
      if(root){
        let snap=null, samplingGap=false;
        try{snap=await deadline(take(),11000);}catch{samplingGap=true;}
        if(!closed&&(snap?.rootLive||samplingGap)){
          // Kill the already retained Node child handle, not an arbitrary PID.
          if(child.kill()){forced=true;forcedRoot=true;}
        }else if(!closed&&!snap.rootLive){
          // The original handle still has not emitted close; never kill a PID
          // identified only by a reused/absent process-table row.
          await deadline(finished,3000);
        }
        const held=closed||await deadline(finished,8000);
        assert(held);
        let post=await deadline(take(),11000);
        if(post.live.length>2)fail('CLOSURE_UNCONFIRMED');
        for(const r of post.live){
          const now=(await deadline(rows(),11000)).find(x=>x.ProcessId===r.ProcessId);
          if(identity.sameIdentity(now,r)){await reap(r);forced=true;}
        }
        post=await deadline(take(),11000);
        result.remaining=(sawUnknown||samplingGap)?null:post.live.length+Number(post.rootLive);
        result.observedChildren=owned.size;
        if(result.remaining!==0)fail('CLOSURE_UNCONFIRMED');
        if(!forcedRoot&&(held.signal!==null||![0,1].includes(held.code)))fail('CLOSURE_UNCONFIRMED');
        // A recorded clean close without valid matching test protocol is still
        // a refusal. It is not an ordinary failed test summary or next permit.
        if(!forced&&!protocolConfirmed&&result.code==='TEST_FAILED')result.code='CHILD_PROTOCOL';
        result.close=forced?'forced-owned':'normal';
      }else{
        // No test authorization message was sent; terminate only the native
        // handle returned by our direct spawn and do not assert observed close.
        if(!closed&&Number.isSafeInteger(child.pid))child.kill();
        if(!closed)await deadline(finished,8000);
      }
    }catch{result.code='CLOSURE_UNCONFIRMED';result.state='failed';}
  }
  if(result.close!=='normal'){result.state='failed';result.code=result.code||'CLOSURE_UNCONFIRMED';}
  return result;
}
async function attempt(check){
  try{await check();return 'verified';}catch{return 'failed';}
}
async function execute({product,parent,manifest,preflight},{verifyHarness,verifyProduct}){
  const from=name=>require(path.join(product,name));
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  const {downloadPinned,retainDirectory}=from('scripts/acquire-candidate-archives.cjs');
  const {preparePayload,runBounded,finalStartupCheck}=from('scripts/windows-ffmpeg-startup.cjs');
  const {provisionCandidateRuntime}=from('scripts/provision-candidate-runtime.cjs');
  const {verifyCandidateRuntime,verifyPinnedFile,assertOrdinaryPath}=from('src/candidate-runtime.cjs');
  const identity=from('scripts/windows-electron-ownership.cjs');
  const result={failure:null,runtime:null,suites:{},readback:{harness:'not-run',product:'not-run',runtime:'not-run'}};
  let phase='capacity',runtimeReady=false,archive=null,prepared=null;
  try{
    await preflight(product,parent,manifest);
    const parentOwner=await retainDirectory(parent),productOwner=await retainDirectory(product);
    await parentOwner();await productOwner();
    await assert.rejects(fs.lstat(path.join(product,'.tools')),{code:'ENOENT'});
    const reserved=await fs.mkdtemp(path.join(parent,'q-native-tests-'));
    await parentOwner();await assertOrdinaryPath(reserved,'directory');
    const temp=await fs.realpath(reserved),own=await retainDirectory(temp);
    const dirs={transfer:path.join(temp,'download'),test:path.join(temp,'cases')};
    for(const dir of Object.values(dirs)){await own();await fs.mkdir(dir);}
    const transferOwner=await retainDirectory(dirs.transfer),testOwner=await retainDirectory(dirs.test);
    phase='archive';
    const pin=manifest.archive;
    await transferOwner();archive=await downloadPinned(pin,path.join(dirs.transfer,pin.fileName),{assertOwned:transferOwner});
    await transferOwner();await verifyPinnedFile(archive.path,pin);
    const receipt=path.join(dirs.transfer,'transfer-report.json');
    await fs.writeFile(receipt,JSON.stringify({schema:1,items:[{name:pin.fileName,path:archive.path,release:manifest.releasePage,
      url:pin.url,verified:true,expectedBytes:pin.sizeBytes,expectedSha256:pin.sha256}]}),{flag:'wx',mode:0o600});
    phase='provision';
    await preflight(product,parent,manifest);await transferOwner();await own();await productOwner();
    prepared=await preparePayload({parent:temp,acquisition:{directory:dirs.transfer,receipt},manifest});
    await own();await productOwner();await preflight(product,parent,manifest);
    await provisionCandidateRuntime({root:product,receiptPath:receipt,payloadDirectory:prepared.payload});
    phase='runtime';
    const verified=await verifyCandidateRuntime({root:product});
    runtimeReady=true;
    const versions=[];
    for(const [index,file] of [verified.ffmpeg,verified.ffprobe].entries()){
      const p=manifest.binaries[index],v=await runBounded(file,['-version'],{limit:65536,timeout:10000,cwd:temp});
      assert(v.stdout.split(/\r?\n/,1)[0].startsWith(p.name.slice(0,-4)+' version '+p.version+' '));
      await verifyPinnedFile(file,p);versions.push({name:p.name,sha256:p.sha256,sizeBytes:p.sizeBytes,version:p.version});
    }
    result.runtime={archive:{sha256:pin.sha256,sizeBytes:pin.sizeBytes},versions,
      notices:manifest.notices.map(({sha256,sizeBytes})=>({sha256,sizeBytes})),
      extractorSha256:prepared.toolSha256,listingSha256:prepared.listingSha256};
    phase='suites';await finalStartupCheck(prepared);
    const root=process.env.SystemRoot;
    assert(/^[A-Za-z]:\\Windows$/i.test(root));
    const shell=path.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const node=await fs.realpath(process.execPath);
    for(const f of [shell,node])await assertOrdinaryPath(f);
    const rows=async()=>{
      const command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)";
      const p=await runBounded(shell,['-NoProfile','-NonInteractive','-Command',command],{limit:2*1024*1024,timeout:10000,cwd:temp});
      const data=JSON.parse(p.stdout);assert(Array.isArray(data)&&data.length<=4096);return data;
    };
    const reap=async row=>{
      assert(identity.validIdentity(row)&&mediaPaths.has(identity.canonical(row.ExecutablePath)));
      // Re-bind a retained .NET process handle inside one trusted helper.
      // Refuse if the recorded process has already gone away or differs; no
      // blind taskkill-by-PID or wildcard search is ever used.
      const command="$ErrorActionPreference='Stop'; $id=[int]$env:Q_REAP_PID; $p=[Diagnostics.Process]::GetProcessById($id); try { $hold=$p.Handle; $r=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$id); if(!$r -or [int]$r.ParentProcessId -ne [int]$env:Q_REAP_PARENT -or [long]([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() -ne [long]$env:Q_REAP_CREATED -or $p.MainModule.FileName -ine $env:Q_REAP_EXE -or $r.ExecutablePath -ine $env:Q_REAP_EXE) { throw 'Owned process identity unavailable' }; $p.Kill(); if(!$p.WaitForExit(3000)){throw 'Owned process closure unconfirmed'} } finally { $p.Dispose() }";
      await runBounded(shell,['-NoProfile','-NonInteractive','-Command',command],{limit:65536,timeout:7500,cwd:temp,env:{
        ...process.env,Q_REAP_PID:String(row.ProcessId),Q_REAP_PARENT:String(row.ParentProcessId),
        Q_REAP_CREATED:String(identity.createdAt(row.CreationDate)),Q_REAP_EXE:row.ExecutablePath,
      }});
    };
    const env={SystemRoot:root,WINDIR:root,PATH:path.join(root,'System32'),TEMP:dirs.test,TMP:dirs.test};
    const mediaPaths=new Set([verified.ffmpeg,verified.ffprobe].map(identity.canonical));
    const clock=()=>performance.now();
    const deadlineAt=clock()+10*60*1000;
    for(const id of Object.keys(SUITES)){
      await testOwner();await productOwner();
      remaining(deadlineAt,clock);
      const item=await supervise(id,{product,node,env,identity,rows,reap,mediaPaths,deadlineAt,clock});
      result.suites[id]=item;
      await testOwner();await productOwner();
      if(!canContinue(item))fail(item.code==='TIMEOUT'?'TIMEOUT':item.close!=='normal'?'CLOSURE_UNCONFIRMED':item.code);
      remaining(deadlineAt,clock);
    }
    if(Object.values(result.suites).some(x=>x.state!=='passed'))fail('TEST_FAILED');
    if(!Object.values(result.suites).some(x=>x.observedChildren>0))fail('CLOSURE_UNCONFIRMED');
  }catch(error){
    const known=['TIMEOUT','CLOSURE_UNCONFIRMED','TEST_FAILED'].includes(error?.code)?error.code:'BOUNDARY_REFUSED';
    result.failure={phase,code:known};
  }finally{
    result.readback.harness=await attempt(verifyHarness);
    result.readback.product=await attempt(verifyProduct);
    if(runtimeReady&&result.readback.product==='verified')result.readback.runtime=await attempt(async()=>{
      await verifyCandidateRuntime({root:product});await verifyPinnedFile(archive.path,manifest.archive);await finalStartupCheck(prepared);
    });
    if(!result.failure&&Object.values(result.readback).some(x=>x!=='verified'))result.failure={phase:'readback',code:'BOUNDARY_REFUSED'};
  }
  return result;
}
module.exports={execute,descendants,supervise,canContinue};
