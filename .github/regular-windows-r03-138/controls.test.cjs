'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,reportRecord,clockValue }=require('./binding.cjs');
const {timeToWork,makeLatch,fence}=require('./host-lease.cjs');
const {PRODUCT}=require('./settings-restart.cjs');
const {settingsLayout,assertLaunch,ordinaryCloseRequest,runWindowsSettingsProof}=require('./windows-settings-adapter.cjs');
const H='1'.repeat(40), C='2'.repeat(40);
function ordinaryEvent() {
  return {
    env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:POLICY.repo,GITHUB_REPOSITORY_ID:String(POLICY.repoId),
      GITHUB_REF:POLICY.ref,GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'4567',GITHUB_SHA:C,
      RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Windows',RUNNER_ARCH:'X64',GITHUB_JOB:'settings',
      GITHUB_WORKFLOW_SHA:C,GITHUB_WORKFLOW_REF:POLICY.repo+'/'+WORKFLOW+'@'+POLICY.ref},
    event:{repository:{id:POLICY.repoId,full_name:POLICY.repo,fork:false,private:false},ref:POLICY.ref,
      created:false,forced:false,deleted:false,before:H,after:C,commits:[{id:C}],head_commit:{id:C}},
  };
}
test('only a first retained hosted event can enter the R03 binding',()=>{
  const {env,event}=ordinaryEvent();
  assert.deepEqual(eventIdentity(env,event),{head:C,seed:H,runId:'4567',attempt:1});
  for(const bad of [{RUNNER_ENVIRONMENT:'self-hosted'},{RUNNER_OS:'Linux'},{RUNNER_ARCH:'ARM64'},
    {GITHUB_JOB:'package'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'workflow_dispatch'},
    {GITHUB_REF:'refs/heads/blue/regular-win-cpu-138-once'},{GITHUB_WORKFLOW_SHA:H},{GITHUB_WORKFLOW_REF:'wrong'}]){
    assert.throws(()=>eventIdentity({...env,...bad},event));
  }
  for(const bad of [{created:true},{deleted:true},{forced:true},{commits:[{id:C},{id:H}]},
    {repository:{...event.repository,fork:true}},{repository:{...event.repository,private:true}}]){
    assert.throws(()=>eventIdentity(env,{...event,...bad}));
  }
});
test('inert template cooks only the exact expected predecessor and success-only report path',()=>{
  const template=fs.readFileSync(path.join(__dirname,'windows.yml.in'));
  const cooked=cook(template,H).toString();
  assert(cooked.includes("github.event.before == '"+H+"'"));
  assert(!cooked.includes('__BOUND_SEED__'));
  assert(!/[\x00-\x09\x0b-\x1f\x7f]/.test(cooked));
  assert(cooked.includes('$npmLog = Join-Path $env:RUNNER_TEMP "regular-r03-cp138-npm.log"'));
  assert(cooked.includes('npm ci --ignore-scripts --no-audit --no-fund *> $npmLog'));
  for(const expected of ['timeout-minutes: 24','timeout-minutes: 30','runs-on: windows-2022',
    "success() && !cancelled() && steps.verify.outputs.report_ready == 'true'",'group: regular-windows-r03-138-once',
    'permissions:\n  contents: read','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:','regular-cp138-r03-report-${{','persist-credentials: false']){
    assert(cooked.includes(expected));
  }
  assert.equal((cooked.match(/persist-credentials: false/g)||[]).length,2);
  for(const excluded of ['always()','workflow_dispatch','contents: write','secrets.','node-version: latest','failure()','start-batch']){
    assert(!cooked.includes(excluded));
  }
  assert.equal(SEED_FILES.length,7);
  assert(TEMPLATE.endsWith('.yml.in'));assert(!SEED_FILES.includes(WORKFLOW));
  assert.equal(POLICY.floor,46498163717n);
});
test('workflow rendering rejects the previously observed raw carriage return and malformed text',()=>{
  for(const extra of [Buffer.from([13]),Buffer.from([0]),Buffer.from([9]),Buffer.from([127]),Buffer.from([0xff])]){
    const original=fs.readFileSync(path.join(__dirname,'windows.yml.in'));
    assert.throws(()=>cook(Buffer.concat([original,extra]),H));
  }
});
test('elapsed work is bounded by the earlier actual job/step elapsed and reserves 90 seconds',()=>{
  assert.equal(timeToWork(100,140,140),24*60_000-90_000);
  assert.equal(timeToWork(100,900_100,900_100),15*60_000-90_000);
  assert.equal(timeToWork(2**32-30,10,20),24*60_000-90_010);
  assert.throws(()=>timeToWork(100,90,150));
  assert.throws(()=>timeToWork(100,200,100+30*60_000));
  assert.throws(()=>clockValue('4294967296'));
  assert.throws(()=>clockValue('01'));
});
test('a first open latches before ownership; premature restart or report is refused',()=>{
  const latch=makeLatch(()=>1_000_000), ticket=latch.begin(1);
  assert(latch.outstanding && !latch.complete());
  assert.throws(()=>latch.begin(1));assert.throws(()=>latch.begin(2));
  assert.throws(()=>latch.joined(ticket));assert.throws(()=>latch.durable(ticket));
  latch.confirm(ticket);latch.joined(ticket);
  assert.throws(()=>latch.begin(2),'native close alone must not release next launch');
  latch.durable(ticket);
  const second=latch.begin(2);latch.confirm(second);latch.joined(second);latch.durable(second);
  assert(latch.complete());assert.throws(()=>latch.begin(3));
});
test('insufficient time cannot expose a first or second process owner',()=>{
  let left=929_999;const latch=makeLatch(()=>left);
  assert.throws(()=>latch.begin(1),/Insufficient/);assert(!latch.outstanding);
  left=930_001;const one=latch.begin(1);latch.confirm(one);latch.joined(one);latch.durable(one);
  left=449_999;
  assert.throws(()=>latch.begin(2),/Insufficient/);assert(!latch.outstanding);
});
test('an unobserved launch quarantines; no second launch or later operation is possible',()=>{
  const latch=makeLatch(()=>1_000_000), first=latch.begin(1);
  latch.fail();
  assert(latch.parked&&!latch.complete());
  for(const attempt of [()=>latch.begin(2),()=>latch.confirm(first),()=>latch.joined(first),
    ()=>latch.durable(first),()=>latch.budget(15_000)]){assert.throws(attempt,/quarantined/);}
});
test('stage timeout latches before a delayed callback can make another effective action',async()=>{
  const latch=makeLatch(()=>1_000_000);latch.begin(1);
  let release,lateOperations=0;
  const blocked=new Promise(resolve=>{release=resolve;});
  await assert.rejects(fence(latch,8,async()=>{
    await blocked;latch.guard();lateOperations++;
  }),{code:'R03_STAGE_TIMEOUT'});
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lateOperations,0);assert(latch.parked);
  let after=0;
  await assert.rejects(fence(latch,25,()=>{after++;}),/quarantined/);
  assert.equal(after,0);
});
test('direct Playwright timeout also cannot permit later application actions',async()=>{
  const latch=makeLatch(()=>1_000_000);latch.begin(1);
  await assert.rejects(fence(latch,50,()=>{throw Object.assign(new Error('API timed out'),{name:'TimeoutError'});}),{name:'TimeoutError'});
  assert(latch.parked);
});
test('profile role is sibling of stock built package, not staged by copying or state inside package',()=>{
  const lease=Object.freeze({product:PRODUCT,provider:'github-hosted',image:'windows-2022',
    jobRoot:'D:\\a\\product\\out\\portable-exact',packageDir:'D:\\a\\product\\out\\portable-exact\\package\\FFmpeg Encoder-win32-x64',
    exe:'a'.repeat(64),asar:'b'.repeat(64),profile:'c'.repeat(64)});
  const names=settingsLayout(lease);
  assert(names.stateDir.endsWith('portable-exact\\settings-profile'));
  assert(names.exePath.endsWith('FFmpeg Encoder.exe'));
  assert.throws(()=>settingsLayout({...lease,packageDir:lease.jobRoot+'\\packages\\pinned'}));
  assert.throws(()=>settingsLayout({...lease,packageDir:lease.jobRoot+'\\settings-profile\\package'}));
  const exact={pid:240,executable:names.exePath,appExe:names.exePath,asar:names.asarPath,userData:names.stateDir,sessionData:names.stateDir,
    security:{packaged:true,sandbox:true,contextIsolation:true,nodeIntegration:false,platform:'win32',arch:'x64',
      version:PRODUCT.version,electron:PRODUCT.electron}};
  assert.doesNotThrow(()=>assertLaunch(exact,names));
  assert.throws(()=>assertLaunch({...exact,sessionData:names.cwd},names));
});
test('normal close callback schedules only the one present and live window',async()=>{
  let closes=0;
  const win={isDestroyed:()=>false,close:()=>{closes++;}};
  assert.equal(ordinaryCloseRequest({BrowserWindow:{getAllWindows:()=>[win,win]}}),false);
  assert.equal(ordinaryCloseRequest({BrowserWindow:{getAllWindows:()=>[win]}}),true);
  assert.equal(closes,0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closes,1);
});
test('source validation cannot call native admission in this non-Windows controlled host',{skip:process.platform==='win32'},async()=>{
  let attempts=0;
  await assert.rejects(runWindowsSettingsProof({claimOnce:()=>{attempts++;}}),/No Windows adapter/);
  assert.equal(attempts,0);
});
test('only typed sanitized success with two durable closes is eligible for a report',()=>{
  const identity={head:C,seed:H,runId:'456',attempt:1};
  const pin={sha256:'a'.repeat(64),sizeBytes:80,path:'D:\\owned-private\\unsafe-to-upload'};
  const settings={scope:'cp138-r03-clean-settings-restart-observations',settingsSha256:'b'.repeat(64),
    settingsBytes:155,savedRevisions:[1,2],isolatedLaunches:2,cleanWindowCloses:2,startup:'unmodified-ordinary-capability-self-tests',
    r02:'not-run',userJob:'not-requested'};
  const input={identity,harnessTree:'c'.repeat(40),settings,built:{exe:pin,executable:pin,zip:pin,asar:pin}};
  const receipt=reportRecord(input);
  assert.equal(receipt.state,'HOSTED_CLEAN_SETTINGS_OBSERVED');
  assert.match(receipt.observedProcessJoin,/not-exhaustive/);
  assert.equal(receipt.nativeDesktop,'not-qualified');
  assert.equal(receipt.distribution,'report-only');
  assert.doesNotMatch(JSON.stringify(receipt),/owned-private|unsafe-to-upload/);
  assert.throws(()=>reportRecord({...input,settings:{...settings,cleanWindowCloses:1}}));
});
