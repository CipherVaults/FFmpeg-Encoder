'use strict';
// Inert proposal: invoked only by the separately reviewed materialized workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const POLICY = Object.freeze({
  repo: 'CipherVaults/FFmpeg-Encoder', repoId: 1460111553,
  ref: 'refs/heads/blue/regular-win-r03-138-succ-1f11f610-once',
  source: '33196f7434d781e683bb35ed4445fd1db3cc118a',
  tree: '98067ae82443fa03bd21fe20e9f86593d01ad092',
  productInputs: '5da439d49926db38516c421f5b40f749c6cb5259ee845ee09bf13ca6f807aec6',
  productInputCount: 113, sourceFileCount: 1689,
  floor: 46498163717n,
});
const LOCKS = Object.freeze({
  'package-lock.json':'a992833bd3c49ea484d349e1de48c1260b6fc38c5d6360e22e1725e640ed7731',
  'resources/candidate-binary-manifest.json':'79ed7d063dc57480e065c86795dd14af11c179d9a377ef0fa0e47beab8339e3a',
  'resources/PORTABLE_README.txt':'3de03bf22c7603ec10831ff0554c899f0a7d7ca87c8114e1daad6369d4e1e707',
  'packaging.config.cjs':'168a7f5c54e10e621218c222dac9b4c2a77452f7e8d0b49225399d18c520646d',
});
const DIR = '.github/regular-windows-r03-138/';
const TEMPLATE = DIR + 'windows.yml.in';
const WORKFLOW = '.github/workflows/regular-windows-r03-138-successor.yml';
const SEED_FILES = ['binding.cjs','controls.test.cjs','host-lease.cjs','settings-restart.cjs','state-witness.cjs','windows-settings-adapter.cjs','windows.yml.in'].map(leaf=>DIR+leaf).sort();
const SHA = /^[a-f0-9]{40}$/;
const validSha = s => typeof s === 'string' && SHA.test(s) && !/^0+$/.test(s);
const eqPath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function eventIdentity(env,event,p=POLICY) {
  assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===p.repo&&env.GITHUB_REPOSITORY_ID===String(p.repoId));
  assert(env.GITHUB_REF===p.ref&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_RUN_ATTEMPT==='1');
  assert(env.RUNNER_ENVIRONMENT==='github-hosted'&&env.RUNNER_OS==='Windows'&&env.RUNNER_ARCH==='X64'&&env.GITHUB_JOB==='settings');
  assert(/^[1-9]\d{0,18}$/.test(env.GITHUB_RUN_ID));
  assert(event.repository?.id===p.repoId&&event.repository?.full_name===p.repo&&event.repository?.fork===false&&event.repository?.private===false&&event.ref===p.ref);
  assert(event.created===false&&event.forced===false&&event.deleted===false);
  assert(validSha(event.before)&&validSha(event.after)&&event.before!==event.after&&env.GITHUB_SHA===event.after);
  assert(env.GITHUB_WORKFLOW_SHA===event.after&&env.GITHUB_WORKFLOW_REF===p.repo+'/'+WORKFLOW+'@'+p.ref);
  assert(event.commits?.length===1&&event.commits[0]?.id===event.after&&event.head_commit?.id===event.after);
  return Object.freeze({head:event.after,seed:event.before,runId:env.GITHUB_RUN_ID,attempt:1});
}
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:null,windowsHide:true,timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
const line=(cwd,...args)=>git(cwd,...args).toString().trim();
function additions(cwd,before,after,expected) {
  const fields=git(cwd,'diff','--no-ext-diff','--raw','--no-abbrev','--no-renames','-z',before,after,'--').toString().split('\0');
  assert.equal(fields.pop(),'');assert.equal(fields.length,expected.length*2);
  const names=[];
  for(let i=0;i<fields.length;i+=2){assert(/^:000000 100644 0{40} [0-9a-f]{40} A$/.test(fields[i]));names.push(fields[i+1]);}
  assert.deepEqual(names.sort(),expected);
}
function cook(bytes,seed) {
  assert(validSha(seed));
  assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024
    &&bytes.every(byte=>byte===10||byte>=32&&byte!==127),'Workflow must use ordinary UTF-8 and LF only');
  const template=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  assert.equal(template.split('__BOUND_SEED__').length,2);
  return Buffer.from(template.replace('__BOUND_SEED__',seed));
}
async function ordinaryDirectory(dir) {
  assert(path.isAbsolute(dir)&&eqPath(await fs.realpath(dir),dir));
  const stat=await fs.lstat(dir);assert(stat.isDirectory()&&!stat.isSymbolicLink());
}
async function readBounded(filename,maximum) {
  const before=await fs.lstat(filename,{bigint:true});
  assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=BigInt(maximum));
  const handle=await fs.open(filename,'r');
  const same=s=>s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.nlink===before.nlink&&s.mtimeNs===before.mtimeNs&&s.ctimeNs===before.ctimeNs;
  try {
    assert(same(await handle.stat({bigint:true})));
    const buffer=Buffer.alloc(Number(before.size)+1);
    let pos=0;
    while(pos<buffer.length){const {bytesRead}=await handle.read(buffer,pos,buffer.length-pos,pos);if(!bytesRead)break;pos+=bytesRead;}
    assert.equal(pos,Number(before.size));
    assert(same(await handle.stat({bigint:true}))&&same(await fs.lstat(filename,{bigint:true})));
    return buffer.subarray(0,pos);
  } finally { await handle.close(); }
}
async function bindHarness(root,id,p=POLICY) {
  await ordinaryDirectory(root);
  assert.equal(line(root,'rev-parse','HEAD'),id.head);
  assert.equal(line(root,'rev-parse',p.source+'^{tree}'),p.tree);
  assert.equal(line(root,'show','-s','--format=%P',id.seed),p.source);
  assert.equal(line(root,'show','-s','--format=%P',id.head),id.seed);
  additions(root,p.source,id.seed,SEED_FILES);
  additions(root,id.seed,id.head,[WORKFLOW]);
  const workflow=git(root,'show',id.head+':'+WORKFLOW);
  assert.deepEqual(workflow,cook(git(root,'show',id.seed+':'+TEMPLATE),id.seed));
  for(const name of [...SEED_FILES,WORKFLOW]) {
    await ordinaryDirectory(path.dirname(path.join(root,name)));
    assert.deepEqual(await readBounded(path.join(root,name),64*1024),git(root,'show',id.head+':'+name));
  }
  return line(root,'rev-parse','HEAD^{tree}');
}
function parseRows(raw) {
  const fields=new TextDecoder('utf8',{fatal:true}).decode(raw).split('\0');
  assert.equal(fields.pop(),'');const seen=new Set();
  return fields.map(row=>{
    const match=/^100644 blob ([0-9a-f]{40})\t(.+)$/.exec(row);assert(match);
    const name=match[2],parts=name.split('/');
    assert(parts.every(s=>s&&s!=='.'&&s!=='..'&&s.toLowerCase()!=='.git'&&!/[\x00-\x1f:*?"<>|\\]/.test(s)&&!/[. ]$/.test(s)));
    assert(!seen.has(name.toLowerCase()));seen.add(name.toLowerCase());
    return {name,blob:match[1]};
  });
}
async function bindProduct(root,p=POLICY) {
  await ordinaryDirectory(root);
  assert.equal(line(root,'rev-parse','HEAD'),p.source);
  assert.equal(line(root,'rev-parse','HEAD^{tree}'),p.tree);
  const rows=parseRows(git(root,'ls-tree','-r','-z','--full-tree',p.source));
  assert.equal(rows.length,p.sourceFileCount);const directories=new Set();let total=0;
  for(const {name,blob} of rows) {
    const filename=path.join(root,name),dir=path.dirname(filename);
    if(!directories.has(dir)){await ordinaryDirectory(dir);directories.add(dir);}
    const bytes=await readBounded(filename,16*1024*1024);
    total+=bytes.length;assert(total<=64*1024*1024);
    assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),blob);
  }
  return rows.length;
}
function witness(rows) {
  assert.equal(rows.length,POLICY.productInputCount);
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),POLICY.productInputs);
}

const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const clockValue = (value => {
  assert(typeof value === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(value));
  const n=Number(value);assert(Number.isInteger(n)&&n>=0&&n<2**32);
  return n;
});

function reportRecord({identity,harnessTree,settings,built}) {
  assert(settings?.scope==='cp138-r03-clean-settings-restart-observations'
    && settings.startup==='unmodified-ordinary-capability-self-tests'&&settings.r02==='not-run'&&settings.userJob==='not-requested');
  assert.deepEqual(settings.savedRevisions,[1,2]);assert.equal(settings.isolatedLaunches,2);assert.equal(settings.cleanWindowCloses,2);
  assert(/^[0-9a-f]{64}$/.test(settings.settingsSha256) && Number.isSafeInteger(settings.settingsBytes) && settings.settingsBytes>0&&settings.settingsBytes<=16*1024);
  assert(validSha(identity.head)&&validSha(identity.seed)&&validSha(harnessTree)&&/^[1-9]\d{0,18}$/.test(identity.runId)&&identity.attempt===1);
  const pin = x=>{
    assert(/^[0-9a-f]{64}$/.test(x.sha256)&&Number.isSafeInteger(x.sizeBytes)&&x.sizeBytes>0);
    return {sha256:x.sha256,bytes:x.sizeBytes};
  };
  return Object.freeze({schema:'regular-win-r03-clean-settings/v1',scope:'cp138-hosted-clean-r03-only',
    state:'HOSTED_CLEAN_SETTINGS_OBSERVED',head:identity.head,seed:identity.seed,runId:identity.runId,attempt:1,harnessTree,
    product:POLICY.source,tree:POLICY.tree,packageInputsSha256:POLICY.productInputs,requiredFreeBytes:String(POLICY.floor),
    executable:pin(built.executable),asar:pin(built.asar),zip:pin(built.zip),
    settingsSha256:settings.settingsSha256,settingsBytes:settings.settingsBytes,saves:2,firstRevision:1,restartRevision:2,launches:2,
    cleanCompletedJournals:2,observedProcessJoin:'sampled-descendants-not-exhaustive',
    startup:'ordinary-app-owned-self-tests',deliberateMedia:'none',jobStart:'none',r02:'not-run',
    nativeDesktop:'not-qualified',gpu:'not-qualified',distribution:'report-only'});
}

// Use only trusted control-flow milestones, never an Error, stdout contents,
// private paths, raw counters or a presumed launch to classify a failure.
function failureExit(phase, gate) {
  if (gate?.parked || gate?.outstanding) return null;
  const closed = gate?.durablyClosed ?? 0;
  if (phase === 'journey') return closed === 0 ? 45 : closed === 1 ? 46 : closed === 2 ? 47 : 50;
  if (phase === 'final-binding') return closed === 2 ? 48 : 50;
  if (phase === 'report') return closed === 2 ? 49 : 50;
  if (closed !== 0) return 50;
  const before = { binding:41, preflight:42, setup:43, build:44, prelaunch:45 };
  return Object.hasOwn(before,phase) ? before[phase] : 50;
}

async function main(observedPhase) {
  const mode=process.argv[2];
  assert(process.argv.length===3&&['preflight','run'].includes(mode));
  assert(process.platform==='win32'&&process.arch==='x64');
  const workspace=process.env.GITHUB_WORKSPACE; assert(workspace&&path.isAbsolute(workspace));
  const harness=path.join(workspace,'harness'),product=path.join(workspace,'product');
  assert(eqPath(path.resolve(__dirname,'../..'),harness));
  const event=JSON.parse(await readBounded(process.env.GITHUB_EVENT_PATH,1024*1024));
  const id=eventIdentity(process.env,event);
  const harnessTree=await bindHarness(harness,id);
  await bindProduct(product);
  // No harness execution modules or product code until both exact checks pass.
  const fromProduct=name=>require(path.join(product,name));
  const {appSources,hashFile}=fromProduct('scripts/build-portable.cjs');
  async function packageInputs(){
    witness(await appSources(product,fromProduct('package.json')));
    for(const [name,digest] of Object.entries(LOCKS))assert.equal((await hashFile(path.join(product,name))).sha256,digest);
  }
  await packageInputs();
  observedPhase.phase='preflight';
  const {preflight,createPreflightDiagnostic,execute}=fromProduct('scripts/windows-hosted-package-check.cjs');
  const {expectedCandidateManifest,verifyPinnedFile}=fromProduct('src/candidate-runtime.cjs');
  const {requiredFree}=fromProduct('scripts/windows-package-policy.cjs');
  const {retainDirectory}=fromProduct('scripts/acquire-candidate-archives.cjs');
  const manifest=expectedCandidateManifest(),d=createPreflightDiagnostic(),parent=process.env.RUNNER_TEMP;
  assert.equal(requiredFree([manifest.archive,manifest.electron.archive]),POLICY.floor);
  try{await preflight(product,parent,manifest,d);}catch(error){
    // Preserve the earlier standalone capacity diagnostic; the job's
    // no-export run phase reports only its finite exit category.
    if(mode==='preflight') console.error(JSON.stringify(d.failure(error)));
    throw error;
  }
  const {runBounded}=fromProduct('scripts/windows-ffmpeg-startup.cjs');
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const ps=async(...args)=>(await runBounded(shell,args,{limit:2*1024*1024,timeout:10000,cwd:parent})).stdout;
  const drive=path.parse(parent).root;
  assert(/^[A-Za-z]:\\$/.test(drive));
  const verifyNtfs=async()=>assert.equal((await ps('-NoProfile','-NonInteractive','-Command',
    `$ErrorActionPreference='Stop'; $d=[System.IO.DriveInfo]::new('${drive}'); [Console]::WriteLine($d.DriveFormat)`)).trim(),'NTFS');
  await verifyNtfs();
  if(mode==='preflight')return;
  observedPhase.phase='setup';
  assert.equal(process.version,'v24.22.1');
  const {timeToWork,createHostedLease,waitForProviderTimeout}=require('./host-lease.cjs');
  const {runWindowsSettingsProof}=require('./windows-settings-adapter.cjs');
  const jobStart=clockValue(process.env.R03_JOB_TICK),stepStart=clockValue(process.env.R03_STEP_TICK);
  const readClock=async()=>timeToWork(jobStart,stepStart,clockValue((await ps('-NoProfile','-NonInteractive','-Command',
    '$n=[int64][Environment]::TickCount; if($n -lt 0){$n+=4294967296}; [Console]::WriteLine($n)')).trim()));
  assert(await readClock()>0);
  let built=null,observed=null,host=null,attempts=0;
  observedPhase.phase='build';
  try {
    await execute({root:product,parent,identity:{head:POLICY.source,runId:id.runId,attempt:'1'}},{
      onVerifiedBuild:async value=>{
        assert(++attempts===1);
        observedPhase.phase='prelaunch';
        witness(value.sources); built=value;
        assert.equal(await bindHarness(harness,id),harnessTree);
        await bindProduct(product);await packageInputs();
        await preflight(product,parent,manifest);await verifyNtfs();
        const {inventory}=fromProduct('scripts/windows-packaged-integration.cjs');
        host=createHostedLease({built,productRoot:product,temp:parent,runner:{provider:process.env.RUNNER_ENVIRONMENT,image:'windows-2022'},
          tick:await readClock(),readClock,productFunctions:{
            electron:fromProduct('node_modules/playwright')._electron,
            ownership:fromProduct('scripts/windows-electron-ownership.cjs'),
            verifyPinnedFile,retainDirectory,inventory,hashFile,ps,
          }});
        observedPhase.gate=host.gate;
        observedPhase.phase='journey';
        observed=await runWindowsSettingsProof(host.api);
      },
    });
    assert(attempts===1&&observed&&host.gate.complete());
  } catch(error) {
    if(host?.gate.parked||host?.gate.outstanding) {
      host.gate.fail();
      // No subsequent active application, package/profile read, report or
      // artifact operation in this VM. The verified provider timeout ends it.
      console.error('R03 attempt is quarantined. No report was issued.');
      await waitForProviderTimeout();
    }
    throw error;
  }
  // This block cannot run on any failed or partial attempt.
  observedPhase.phase='final-binding';
  assert.equal(await bindHarness(harness,id),harnessTree);
  assert.equal(await bindProduct(product),POLICY.sourceFileCount);await packageInputs();
  assert(await readClock()>0 && host.gate.complete());
  observedPhase.phase='report';
  const bytes=Buffer.from(JSON.stringify(reportRecord({identity:id,harnessTree,settings:observed,built}),null,2)+'\n');
  assert(bytes.length<=8192);
  const folder=await fs.mkdtemp(path.join(parent,'regular-r03-successor-report-')),owner=await retainDirectory(folder);
  const filename=path.join(folder,'report.json');assert(path.isAbsolute(filename)&&!/[\r\n]/.test(filename));
  await owner();await fs.writeFile(filename,bytes,{flag:'wx',mode:0o600});await owner();
  await verifyPinnedFile(filename,{sizeBytes:bytes.length,sha256:sha(bytes)});
  assert(host.gate.complete() && await readClock()>0);
  const output=process.env.GITHUB_OUTPUT;
  assert(typeof output==='string'&&path.isAbsolute(output)&&!/[\r\n]/.test(output));
  const relative=path.relative(parent,output);
  assert(relative.length&&!path.isAbsolute(relative)&&!relative.split(path.sep).some(x=>x==='..'));
  await ordinaryDirectory(path.dirname(output));
  await readBounded(output,1024*1024);
  await fs.appendFile(output,`report_path=${filename}\nreport_sha256=${sha(bytes)}\nreport_ready=true\n`);
  console.log('Report SHA256 '+sha(bytes));
}

module.exports={POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,bindHarness,bindProduct,parseRows,reportRecord,clockValue,failureExit};
if(require.main===module){
  const observedPhase={phase:'binding',gate:null};
  main(observedPhase).catch(async()=>{
    const code=failureExit(observedPhase.phase,observedPhase.gate);
    if(code===null){
      observedPhase.gate.fail();
      await require('./host-lease.cjs').waitForProviderTimeout();
      return;
    }
    process.exitCode=code;
  });
}
