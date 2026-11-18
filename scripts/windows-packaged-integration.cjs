'use strict';
// One synthetic ordinary CPU journey. Never a native picker or GPU acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {hashFile}=require('./build-portable.cjs');
const {runBounded}=require('./windows-ffmpeg-startup.cjs');
const {assertOrdinaryPath,verifyPinnedFile}=require('../src/candidate-runtime.cjs');
const PARENT='007da483659278edd6916137249f568f29afc9df';
const SETTINGS=Object.freeze({profileId:'h264-cpu',preset:'veryfast',quality:23});
const PHASES=new Set(['authority','build','owned-input','fixture','launch','security','prepare','encode','readback','collision','close','report']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function authority(env,event){
  assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY==='CipherVaults/FFmpeg-Encoder-Blue-Linux'&&env.GITHUB_REF==='refs/heads/blue/linux-development'&&env.GITHUB_EVENT_NAME==='push');
  assert(event.before===PARENT&&event.after===env.GITHUB_SHA&&event.forced===false&&event.created===false&&event.deleted===false&&env.GITHUB_RUN_ATTEMPT==='1');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)&&/^\d+$/.test(env.GITHUB_RUN_ID));
  return {head:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,attempt:1};
}
function diagnostic(phase,error){return {phase:PHASES.has(phase)?phase:'report',code:new Set(['ERR_ASSERTION','ENOENT','EACCES','EPERM','ETIMEDOUT','ENOSPC','INTEGRATION_TIMEOUT','CLOSURE_UNCONFIRMED']).has(error?.code)?error.code:'INTEGRATION_FAILED'};}
function deadline(promise,ms){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Bounded integration timed out.'),{code:'INTEGRATION_TIMEOUT'})),ms);})]).finally(()=>clearTimeout(timer));}
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
  const input=path.join(dirs.input,'fixture.mp4'),sentinel=path.join(dirs.output,'protected.txt');
  await fs.writeFile(sentinel,'Owned sentinel must not change.\n',{flag:'wx'});const sentinelPin=await hashFile(sentinel);
  const ffmpeg=path.join(built.packageDir,'resources','ffmpeg','ffmpeg.exe');
  const ffprobe=path.join(built.packageDir,'resources','ffmpeg','ffprobe.exe');
  const result={picker:'substituted-dialog-return',gpu:'not-qualified',nativeDesktop:'not-qualified',fixtureGenerationCalls:0,requestedEncodes:0,extraDecodeCalls:0,probeReadbackCalls:0,close:'pending',sourceUnchanged:false,packageUnchanged:false};
  let app,page,phase='owned-input',child,failed,launchAttempted=false;
  const endsAt=Date.now()+6*60*1000;
  const remaining=()=>{const ms=endsAt-Date.now();if(ms<=0)throw Object.assign(new Error('Journey deadline.'),{code:'INTEGRATION_TIMEOUT'});return ms;};
  const phaseSet=p=>{if(p!=='close')remaining();phase=p;onPhase(p);};
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  async function snapshot(){return deadline(page.evaluate(()=>window.encoder.getSnapshot()),Math.min(15000,remaining()));}
  async function until(predicate,ms){const end=Date.now()+Math.min(ms,remaining());do{const s=await snapshot();if(predicate(s))return s;await sleep(100);}while(Date.now()<end);throw Object.assign(new Error('State deadline.'),{code:'INTEGRATION_TIMEOUT'});}
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  async function processIdentity(pid){assert(Number.isSafeInteger(pid)&&pid>0);const x=await run(shell,['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){$p | Select-Object ProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress}`],{limit:65536,timeout:10000,cwd:dirs.cwd});return x.stdout.trim()?JSON.parse(x.stdout):null;}
  let originalIdentity=null,sampling=false,sampler=null,sampleFailure=null;
  const observed=new Map();let samples=0;
  async function sample(){
    assert(++samples<=1200);
    const x=await run(shell,['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath)'],{limit:2*1024*1024,timeout:10000,cwd:dirs.cwd});
    const rows=JSON.parse(x.stdout);assert(Array.isArray(rows)&&rows.length<10000);
    const active=new Set();
    for(const row of rows){const key=row.ProcessId+':'+row.CreationDate;if(observed.has(key))active.add(row.ProcessId);}
    if(rows.some(row=>row.ProcessId===originalIdentity.ProcessId&&row.CreationDate===originalIdentity.CreationDate&&row.ExecutablePath===originalIdentity.ExecutablePath))active.add(originalIdentity.ProcessId);
    let changed=true;while(changed){changed=false;for(const row of rows)if(active.has(row.ParentProcessId)&&!active.has(row.ProcessId)){active.add(row.ProcessId);changed=true;}}
    for(const row of rows)if(active.has(row.ProcessId)&&row.ProcessId!==originalIdentity.ProcessId){const key=row.ProcessId+':'+row.CreationDate;if(!observed.has(key)){assert(observed.size<512);observed.set(key,{...row,phase});}}
    return rows.filter(row=>observed.has(row.ProcessId+':'+row.CreationDate)).length;
  }

  try {
    phaseSet('fixture');result.fixtureGenerationCalls++;
    await run(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited','-f','lavfi','-i','sine=sample_rate=48000:duration=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-n',input],{limit:65536,timeout:30000,cwd:dirs.cwd});
    const inputPin=await hashFile(input);assert(inputPin.sizeBytes>0&&inputPin.sizeBytes<8*1024*1024);
    phaseSet('launch');launchAttempted=true;
    app=await electron.launch({executablePath:built.executable.path,args:[`--user-data-dir=${dirs.state}`],cwd:dirs.cwd,env,timeout:60000});
    child=app.process();originalIdentity=await processIdentity(child.pid);assert(originalIdentity&&originalIdentity.ExecutablePath.toLowerCase()===built.executable.path.toLowerCase());
    sampling=true;sampler=(async()=>{while(sampling){await sample();await sleep(500);}})().catch(error=>{sampleFailure=error;sampling=false;});
    page=await app.firstWindow({timeout:30000});page.setDefaultTimeout(15000);
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
    const ready=await until(s=>s.phase==='ready',90000);assert(ready.items.length===1&&ready.items[0].status==='ready');
    assert.equal(ready.settings.profileId,SETTINGS.profileId);assert.equal(ready.settings.preset,SETTINGS.preset);assert.equal(ready.settings.quality,SETTINGS.quality);
    const details=await page.evaluate(({planId,fileId})=>window.encoder.getEncodingDetails({planId,fileId}),{planId:ready.planId,fileId:ready.items[0].id});
    assert(details.operation?.compatibilityPath===true);assert(path.dirname(details.destination).toLowerCase()===dirs.output.toLowerCase());
    phaseSet('encode');result.requestedEncodes++;await page.click('#start-batch');
    const done=await until(s=>['completed','failed'].includes(s.phase),120000);assert.equal(done.counts.success,1);assert.equal(done.items[0].outputDisposition?.kind,'published');
    phaseSet('readback');
    const output=done.items[0].outputDisposition.file;assert(output===details.destination);await assertOrdinaryPath(output,'file');
    result.output=await hashFile(output);assert(result.output.sizeBytes>0&&result.output.sizeBytes<16*1024*1024);
    result.probeReadbackCalls++;
    const probe=await run(ffprobe,['-v','error','-show_entries','stream=codec_type,codec_name,width,height','-of','json',output],{limit:65536,timeout:30000,cwd:dirs.cwd});
    const streams=JSON.parse(probe.stdout).streams;assert(streams.length===2);const video=streams.find(s=>s.codec_type==='video');assert(video.codec_name==='h264'&&video.width===320&&video.height===180);assert(streams.find(s=>s.codec_type==='audio').codec_name==='aac');
    result.fixtureExpectedFrames=48;result.outputValidation='application-validator-and-independent-probe-no-second-decode';
    phaseSet('collision');await page.click('#new-batch');await page.click('#prepare-batch');const collision=await until(s=>s.phase==='ready',90000);assert(collision.items.length===1&&collision.items[0].status==='skipped');
    result.collisionRefused=true;assert.deepEqual(await hashFile(output),result.output);assert.deepEqual(await hashFile(input),inputPin);assert.deepEqual(await hashFile(sentinel),sentinelPin);assert.equal(pageErrors.length,0);result.sourceUnchanged=true;
  } catch(error){failed=error;result.failure=diagnostic(phase,error);}
  finally {
    phaseSet('close');
    if(launchAttempted&&!originalIdentity){result.processObservation=unobservedLaunch();result.close='unconfirmed';}
    sampling=false;if(sampler)await sampler;
    try { if(app){try{if(page&&!page.isClosed()){await deadline(page.evaluate(async()=>{const s=await window.encoder.getSnapshot();if(s.batchId)await window.encoder.cancelBatch({batchId:s.batchId});}),15000);}await deadline(app.close(),20000);result.close='normal';}catch(error){result.close='unconfirmed';result.cleanupFailure=diagnostic('close',error);
      // Never taskkill a guessed/recycled PID. The OS identity must still match.
      if(child&&originalIdentity){const current=await processIdentity(child.pid);if(current&&JSON.stringify(current)===JSON.stringify(originalIdentity)){await run(path.join(process.env.SystemRoot,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{limit:65536,timeout:15000,cwd:dirs.cwd});result.close='forced-owned-tree';}}
      failed||=Object.assign(new Error('Normal closure unconfirmed.'),{code:'CLOSURE_UNCONFIRMED'});
    }
    if(originalIdentity){const current=await processIdentity(child.pid);assert(!current||JSON.stringify(current)!==JSON.stringify(originalIdentity));}
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
module.exports={PARENT,SETTINGS,authority,diagnostic,unobservedLaunch,deadline,assertSecurity,inventory,journey};
