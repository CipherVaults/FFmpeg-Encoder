'use strict';
// One two-file synthetic ordinary CPU batch. Never a native picker or GPU acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {hashFile}=require('./build-portable.cjs');
const {runBounded}=require('./windows-ffmpeg-startup.cjs');
const {assertOrdinaryPath,verifyPinnedFile}=require('../src/candidate-runtime.cjs');
const PARENT='6c87d1313660c758ebf2d0ca0c38860dbb38277b';
const ownership=require('./windows-electron-ownership.cjs');
const SETTINGS=Object.freeze({profileId:'h264-cpu',preset:'veryfast',quality:23});
const PHASES=new Set(['authority','build','owned-input','fixture','launch','security','prepare','encode','readback','collision','terminal-timer','close','report']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function authority(env,event){
  assert(/^[a-f0-9]{40}$/.test(PARENT),'Successor parent is unbound.');
  assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY==='CipherVaults/FFmpeg-Encoder-Blue-Linux'&&env.GITHUB_REF==='refs/heads/blue/linux-development'&&env.GITHUB_EVENT_NAME==='push');
  assert(event.before===PARENT&&event.after===env.GITHUB_SHA&&event.forced===false&&event.created===false&&event.deleted===false&&env.GITHUB_RUN_ATTEMPT==='1');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)&&/^\d+$/.test(env.GITHUB_RUN_ID));
  return {head:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,attempt:1};
}
function diagnostic(phase,error){return {phase:PHASES.has(phase)?phase:'report',code:new Set(['ERR_ASSERTION','ENOENT','EACCES','EPERM','ETIMEDOUT','ENOSPC','INTEGRATION_TIMEOUT','CLOSURE_UNCONFIRMED',...ownership.CODES]).has(error?.code)?error.code:'INTEGRATION_FAILED'};}
function deadline(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Bounded integration timed out.'),{code:'INTEGRATION_TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));}
async function waitForTerminalDisplay(read,done,formatted,remaining){
  const end=Date.now()+Math.min(5000,remaining());
  do {
    const value=await deadline(read(),Math.min(remaining(),Math.max(1,end-Date.now())));
    if(value.snapshot.phase==='completed'&&value.snapshot.batchId===done.batchId&&value.snapshot.elapsedSeconds===done.elapsedSeconds&&value.hidden===false&&value.label==='Batch elapsed'&&value.elapsed===formatted&&value.result===formatted)return value;
    await deadline(sleep(100),remaining());
  }while(Date.now()<end);
  throw Object.assign(new Error('Terminal display readiness deadline.'),{code:'INTEGRATION_TIMEOUT'});
}
function unobservedLaunch(){return {kind:'unobserved-launch',samples:0,observedDescendants:0,observedStartupMedia:0,observedLiveAfterClose:null};}
function assertSecurity(s){assert(s.packaged===true&&s.sandbox===true&&s.contextIsolation===true&&s.nodeIntegration===false&&s.requireType==='undefined'&&s.processType==='undefined');}
async function inventory(root){const rows=[];async function walk(dir,rel=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const name=rel?rel+'/'+e.name:e.name,file=path.join(dir,e.name);const st=await fs.lstat(file);assert(!st.isSymbolicLink());if(st.isDirectory())await walk(file,name);else{assert(st.isFile()&&st.nlink===1);assert(rows.length<2048);rows.push({name,...await hashFile(file)});}}}await walk(root);return rows.sort((a,b)=>a.name.localeCompare(b.name));}
async function journey({built,parent,onPhase=()=>{}},{electron,run=runBounded}={}){
  assert(process.platform==='win32'&&process.arch==='x64');
  for(const [key,value] of Object.entries(process.env))assert(!value||!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','ELECTRON_FORCE_IS_PACKAGED'].includes(key.toUpperCase()));
  assert(built.status==='build-verified-runtime-acceptance-pending');
  await verifyPinnedFile(built.executable.path,built.executable);await assertOrdinaryPath(parent,'directory');
  const before=await inventory(built.packageDir),owned=await fs.mkdtemp(path.join(parent,'packaged-cpu-'));
  const dirs=Object.fromEntries(['input','output','state','cwd'].map(x=>[x,path.join(owned,x)]));
  for(const dir of Object.values(dirs))await fs.mkdir(dir);
  const input=path.join(dirs.input,'fixture-a.mp4'),secondInput=path.join(dirs.input,'fixture-b.mp4'),sentinel=path.join(dirs.output,'protected.txt');
  await fs.writeFile(sentinel,'Owned sentinel must not change.\n',{flag:'wx'});const sentinelPin=await hashFile(sentinel);
  const ffmpeg=path.join(built.packageDir,'resources','ffmpeg','ffmpeg.exe');
  const ffprobe=path.join(built.packageDir,'resources','ffmpeg','ffprobe.exe');
  const result={picker:'substituted-dialog-return',gpu:'not-qualified',nativeDesktop:'not-qualified',fixtureGenerationCalls:0,fixtureCopyCalls:0,startClicks:0,requestedEncodes:0,extraDecodeCalls:0,probeReadbackCalls:0,collisionSkips:0,close:'pending',sourceUnchanged:false,packageUnchanged:false};
  let app,page,phase='owned-input',child,failed,launchAttempted=false;
  const endsAt=Date.now()+6*60*1000;
  const remaining=()=>{const ms=endsAt-Date.now();if(ms<=0)throw Object.assign(new Error('Journey deadline.'),{code:'INTEGRATION_TIMEOUT'});return ms;};
  const phaseSet=p=>{if(p!=='close')remaining();phase=p;onPhase(p);};
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  async function snapshot(){return deadline(page.evaluate(()=>window.encoder.getSnapshot()),Math.min(15000,remaining()));}
  async function until(predicate,ms){const end=Date.now()+Math.min(ms,remaining());do{const s=await snapshot();if(predicate(s))return s;await sleep(100);}while(Date.now()<end);throw Object.assign(new Error('State deadline.'),{code:'INTEGRATION_TIMEOUT'});}
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  async function processIdentity(pid){assert(Number.isSafeInteger(pid)&&pid>0);const x=await run(shell,['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){$p | Select-Object ProcessId,CreationDate,ExecutablePath,ParentProcessId | ConvertTo-Json -Compress}`],{limit:65536,timeout:10000,cwd:dirs.cwd});return x.stdout.trim()?JSON.parse(x.stdout):null;}
  let originalIdentity=null,validatedLauncher=null,mainIdentity=null,sampling=false,sampler=null,sampleFailure=null;
  let verifiedOwners=null;
  const observed=new Map();let samples=0;
  async function processRows(){
    const x=await run(shell,['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)'],{limit:2*1024*1024,timeout:10000,cwd:dirs.cwd});
    const rows=JSON.parse(x.stdout);assert(Array.isArray(rows)&&rows.length<10000);return rows;
  }
  async function sample(){
    assert(++samples<=1200);const rows=await processRows();
    const active=new Set();
    for(const row of rows){const key=row.ProcessId+':'+row.CreationDate;if(observed.has(key))active.add(row.ProcessId);}
    for(const owner of [originalIdentity,mainIdentity].filter(Boolean))if(rows.some(row=>ownership.sameIdentity(row,owner)))active.add(owner.ProcessId);
    let changed=true;while(changed){changed=false;for(const row of rows)if(active.has(row.ParentProcessId)&&!active.has(row.ProcessId)){active.add(row.ProcessId);changed=true;}}
    for(const row of rows)if(active.has(row.ProcessId)&&row.ProcessId!==originalIdentity.ProcessId){const key=row.ProcessId+':'+row.CreationDate;if(!observed.has(key)){assert(observed.size<512);observed.set(key,{...row,phase});}}
    return rows.filter(row=>observed.has(row.ProcessId+':'+row.CreationDate)).length;
  }

  try {
    phaseSet('fixture');result.fixtureGenerationCalls++;
    await run(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited','-f','lavfi','-i','sine=sample_rate=48000:duration=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-n',input],{limit:65536,timeout:30000,cwd:dirs.cwd});
    const inputPin=await hashFile(input);assert(inputPin.sizeBytes>0&&inputPin.sizeBytes<8*1024*1024);
    await fs.copyFile(input,secondInput,require('node:fs').constants.COPYFILE_EXCL);result.fixtureCopyCalls++;assert.deepEqual(await hashFile(secondInput),inputPin);result.fixtureCopies='two-distinct-paths-identical-bytes';
    phaseSet('launch');
    if(process.env.ComSpec||process.env.COMSPEC)ownership.need(ownership.canonical(process.env.ComSpec||process.env.COMSPEC)===ownership.canonical(path.join(process.env.SystemRoot,'System32','cmd.exe')),'LAUNCHER_IDENTITY');
    launchAttempted=true;
    app=await electron.launch({executablePath:built.executable.path,args:[`--user-data-dir=${dirs.state}`],cwd:dirs.cwd,env,timeout:60000});
    child=app.process();
    const shellPath=path.join(process.env.SystemRoot,'System32','cmd.exe');
    originalIdentity=await processIdentity(child.pid);
    ownership.requireLauncher(originalIdentity,child.pid,shellPath,process.pid,child);
    ownership.need(ownership.sameIdentity(await processIdentity(child.pid),originalIdentity),'LAUNCHER_IDENTITY');
    ownership.requireLauncher(originalIdentity,child.pid,shellPath,process.pid,child);
    validatedLauncher=originalIdentity;
    const mainObserved=await deadline(app.evaluate(({app})=>({pid:process.pid,execPath:process.execPath,appExe:app.getPath('exe')})),15000);
    mainIdentity=await processIdentity(mainObserved.pid);
    const ancestry=await processRows();
    verifiedOwners=ownership.requireMain({launcher:originalIdentity,main:mainIdentity,pid:mainObserved.pid,execPath:mainObserved.execPath,appExe:mainObserved.appExe,expected:built.executable.path,rows:ancestry});
    for(const exe of [mainIdentity.ExecutablePath,mainObserved.execPath,mainObserved.appExe])await ownership.verifyMainFile(exe,built.executable.path,built.executable);
    ownership.need(ownership.sameIdentity(await processIdentity(child.pid),originalIdentity)&&ownership.sameIdentity(await processIdentity(mainIdentity.ProcessId),mainIdentity),'MAIN_IDENTITY');
    result.launchOwnership='verified-shell-launcher-and-pinned-main';
    sampling=true;sampler=(async()=>{while(sampling){await sample();await sleep(500);}})().catch(error=>{sampleFailure=error;sampling=false;});
    try{page=await app.firstWindow({timeout:30000});}catch{ownership.need(false,'FIRST_WINDOW');}page.setDefaultTimeout(15000);
    // Playwright evaluate has no action timeout; bound each evaluation explicitly.
    const appEvaluate=app.evaluate.bind(app),pageEvaluate=page.evaluate.bind(page);
    app.evaluate=(...args)=>deadline(appEvaluate(...args),15000);
    page.evaluate=(...args)=>deadline(pageEvaluate(...args),15000);
    const pageErrors=[];page.on('pageerror',()=>pageErrors.push(true));
    phaseSet('security');
    const security=await app.evaluate(({app,BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {packaged:app.isPackaged,sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
    Object.assign(security,await page.evaluate(()=>({requireType:typeof require,processType:typeof process})));
    assertSecurity(security);result.security=security;
    await page.waitForFunction(()=>document.querySelector('#profile')&&!document.querySelector('#profile').disabled,{},{timeout:Math.min(240000,remaining())});
    // Only the native picker return is substituted. UI, preload, IPC and service remain real.
    await app.evaluate(({dialog},folders)=>{let n=0;dialog.showOpenDialog=async()=>{if(n>=folders.length)throw Error('Picker budget exceeded');return {canceled:false,filePaths:[folders[n++]]};};},[dirs.input,dirs.output]);
    await page.click('#choose-input');await page.click('#choose-output');
    await page.selectOption('#profile',SETTINGS.profileId);await page.selectOption('#preset',SETTINGS.preset);await page.fill('#quality',String(SETTINGS.quality));
    phaseSet('prepare');await page.click('#prepare-batch');
    const ready=await until(s=>s.phase==='ready',90000);assert(ready.items.length===2&&ready.items.every(x=>x.status==='ready'));
    assert.equal(ready.settings.profileId,SETTINGS.profileId);assert.equal(ready.settings.preset,SETTINGS.preset);assert.equal(ready.settings.quality,SETTINGS.quality);
    const destinations=new Map();
    for(const item of ready.items){
      const details=await page.evaluate(({planId,fileId})=>window.encoder.getEncodingDetails({planId,fileId}),{planId:ready.planId,fileId:item.id});
      assert(details.operation?.compatibilityPath===true);assert(path.dirname(details.destination).toLowerCase()===dirs.output.toLowerCase());destinations.set(item.id,details.destination);
    }
    assert.equal(new Set(destinations.values()).size,2);
    phaseSet('encode');result.requestedEncodes+=2;result.startClicks++;await page.click('#start-batch');
    const done=await until(s=>['completed','failed'].includes(s.phase),120000);assert.equal(done.phase,'completed');assert.equal(done.counts.success,2);assert.equal(done.items.length,2);
    assert(done.items.every(x=>x.outputDisposition?.kind==='published'));
    phaseSet('terminal-timer');
    const readTimer=()=>deadline(page.evaluate(async()=>({snapshot:await window.encoder.getSnapshot(),elapsed:document.querySelector('#elapsed').textContent,result:document.querySelector('#result-elapsed').textContent,label:document.querySelector('#result-elapsed-label').textContent,hidden:document.querySelector('#results-panel').hidden})),remaining());
    assert(Number.isFinite(done.elapsedSeconds)&&done.elapsedSeconds>=0);
    const seconds=Math.floor(done.elapsedSeconds),formatted=seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const first=await waitForTerminalDisplay(readTimer,done,formatted,remaining);assert.equal(first.snapshot.phase,'completed');assert(Number.isFinite(first.snapshot.elapsedSeconds)&&first.snapshot.elapsedSeconds>=0);
    assert.equal(first.elapsed,formatted);assert.equal(first.result,formatted);assert.equal(first.label,'Batch elapsed');assert.equal(first.hidden,false);
    const timerStarted=Date.now();await deadline(sleep(2200),remaining());const later=await readTimer();
    assert.equal(later.snapshot.batchId,first.snapshot.batchId);assert.equal(later.snapshot.elapsedSeconds,first.snapshot.elapsedSeconds);assert.equal(later.result,first.result);assert.equal(later.elapsed,first.elapsed);
    result.terminalTimer={frozen:true,observedWaitMs:Date.now()-timerStarted,elapsedSeconds:first.snapshot.elapsedSeconds,domMatchesSnapshot:true,reset:false};
    phaseSet('readback');result.outputs=[];
    for(const item of done.items){
      const output=item.outputDisposition.file;assert(output===destinations.get(item.id));await assertOrdinaryPath(output,'file');
      const pin=await hashFile(output);assert(pin.sizeBytes>0&&pin.sizeBytes<16*1024*1024);result.outputs.push(pin);result.probeReadbackCalls++;
      const probe=await run(ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,width,height','-of','json',output],{limit:65536,timeout:30000,cwd:dirs.cwd});
      const streams=JSON.parse(probe.stdout).streams;assert(streams.length===2);const video=streams.find(s=>s.codec_type==='video');assert(video.codec_name==='h264'&&video.width===320&&video.height===180);assert(streams.find(s=>s.codec_type==='audio').codec_name==='aac');
    }
    result.fixtureExpectedFrames=48;result.outputValidation='application-validator-and-independent-probe-no-second-decode';
    phaseSet('collision');await page.click('#new-batch');
    // New batch navigates to setup; the prior completed result remains intact
    // until an actual new preparation replaces the main-owned snapshot.
    assert.equal(await deadline(page.evaluate(()=>document.querySelector('#workspace-encode').hidden),remaining()),false);
    await page.click('#prepare-batch');const collision=await until(s=>s.phase==='ready',90000);assert(collision.items.length===2&&collision.items.every(x=>x.status==='skipped'&&x.reason==='Output already exists.'));
    await deadline(page.waitForFunction(()=>document.querySelector('#results-panel').hidden&&document.querySelector('#result-elapsed').textContent==='—'&&document.querySelector('#result-elapsed-note').textContent==='',{},{timeout:Math.min(5000,remaining())}),remaining());
    const reset=await deadline(page.evaluate(()=>({hidden:document.querySelector('#results-panel').hidden,result:document.querySelector('#result-elapsed').textContent,note:document.querySelector('#result-elapsed-note').textContent})),remaining());
    assert.deepEqual(reset,{hidden:true,result:'—',note:''});result.terminalTimer.reset=true;
    assert.notEqual(collision.planId,ready.planId);assert(Number.isFinite(collision.elapsedSeconds)&&collision.elapsedSeconds>=0);result.collisionSnapshotVerified=true;
    result.collisionSkips=2;result.collisionRefused=true;
    for(const [index,item]of done.items.entries())assert.deepEqual(await hashFile(item.outputDisposition.file),result.outputs[index]);
    for(const file of [input,secondInput])assert.deepEqual(await hashFile(file),inputPin);
    assert.deepEqual(await hashFile(sentinel),sentinelPin);assert.equal(pageErrors.length,0);result.sourceUnchanged=true;
  } catch(error){failed=error;result.failure=diagnostic(phase,error);}
  finally {
    phaseSet('close');
    if(launchAttempted&&!originalIdentity){result.processObservation=unobservedLaunch();result.close='unconfirmed';}
    sampling=false;if(sampler)await sampler;
    try { if(app){try{if(page&&!page.isClosed()){await deadline(page.evaluate(async()=>{const s=await window.encoder.getSnapshot();if(s.batchId)await window.encoder.cancelBatch({batchId:s.batchId});}),15000);}await deadline(app.close(),20000);result.close='normal';}catch(error){result.close='unconfirmed';result.cleanupFailure=diagnostic('close',error);
      // Never taskkill a guessed/recycled PID. The OS identity must still match.
      if(child&&originalIdentity){
        const owners=verifiedOwners||{launcher:validatedLauncher,main:null};
        const target=ownership.cleanupRoot(owners,await processRows());
        if(target&&ownership.sameIdentity(await processIdentity(target.ProcessId),target)){await run(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(target.ProcessId),'/T','/F'],{limit:65536,timeout:15000,cwd:dirs.cwd});result.close='forced-owned-tree';}
      }
      failed||=Object.assign(new Error('Normal closure unconfirmed.'),{code:'CLOSURE_UNCONFIRMED'});
    }
    for(const owner of [originalIdentity,mainIdentity].filter(Boolean)){const current=await processIdentity(owner.ProcessId);assert(!ownership.sameIdentity(current,owner));}
    }
    if(originalIdentity){assert.equal(await sample(),0,'Observed descendants remain alive');if(sampleFailure)throw sampleFailure;}
    if(originalIdentity)result.processObservation={kind:'sampled-not-exhaustive',samples,observedDescendants:observed.size,
      observedStartupMedia:[...observed.values()].filter(row=>['launch','security'].includes(row.phase)&&/[/\\]ff(?:mpeg|probe)\.exe$/i.test(row.ExecutablePath||'')).length,
      observedLiveAfterClose:0};
    result.startupDiscovery='unchanged-production-including-GPU-capability-attempts';
    assert.deepEqual(await inventory(built.packageDir),before);result.packageUnchanged=true;
    }catch(error){result.cleanupFailure=diagnostic('close',error);failed||=error;}
  }
  if(failed){failed.integrationResult=result;throw failed;}assert.equal(result.close,'normal');return result;
}
module.exports={PARENT,SETTINGS,authority,diagnostic,unobservedLaunch,deadline,assertSecurity,inventory,waitForTerminalDisplay,journey};
