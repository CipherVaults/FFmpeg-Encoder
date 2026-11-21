'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,reportRecord,clockValue,failureExit }=require('./binding.cjs');
const {timeToWork,makeLatch,fence,isStockBuildLeaf,createHostedLease}=require('./host-lease.cjs');
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
    {GITHUB_REF:'refs/heads/blue/regular-win-cpu-138-once'},{GITHUB_REF:'refs/heads/blue/regular-win-r03-138-once'},
    {GITHUB_WORKFLOW_REF:POLICY.repo+'/.github/workflows/regular-windows-r03-138.yml@'+POLICY.ref},{GITHUB_WORKFLOW_SHA:H},{GITHUB_WORKFLOW_REF:'wrong'}]){
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
  assert(cooked.includes('$npmLog = Join-Path $env:RUNNER_TEMP "regular-r03-cp138-successor-npm.log"'));
  assert(cooked.includes('npm ci --ignore-scripts --no-audit --no-fund *> $npmLog'));
  for(const expected of ['timeout-minutes: 24','timeout-minutes: 30','runs-on: windows-2022',
    "success() && !cancelled() && steps.verify.outputs.report_ready == 'true'",'group: regular-windows-r03-138-succ-1f11f610-once',
    'permissions:\n  contents: read','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:','regular-cp138-r03-successor-report-${{','persist-credentials: false']){
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
test('stock CP138 Windows build leaf admits the pinned mkdtemp alphabet, not alternate layouts',()=>{
  const root='portable-2026-11-21T12-28-07-123Z-';
  for(const letter of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'){
    for(let offset=0;offset<6;offset++){
      const chars=Array(6).fill('a');chars[offset]=letter;
      assert.equal(isStockBuildLeaf(root+chars.join('')),true,letter+' at '+offset);
    }
  }
  for(const leaf of [root+'abc12',root+'abc1234',root+'abc1_3',root+'abc123\n',
    'portable-AbC123','portable-2026-11-21T12:28:07.123Z-AbC123','result-'+root+'AbC123',undefined]){
    assert.equal(isStockBuildLeaf(leaf),false);
  }
});
test('mixed-case stock leaf still requires actual trusted direct parent, stock package and exclusive profile',async t=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'r03-owned-layout-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const productRoot=path.join(scratch,'product'), out=path.join(productRoot,'out');
  const leaf='portable-2026-11-21T12-28-07-123Z-AbC123';
  const buildRoot=path.join(out,leaf);
  const packageDir=path.join(buildRoot,'package','FFmpeg Encoder-win32-x64');
  const bin=path.join(packageDir,'FFmpeg Encoder.exe'), archive=path.join(packageDir,'resources','app.asar');
  fs.mkdirSync(path.dirname(archive),{recursive:true});
  fs.writeFileSync(bin,'only test label');fs.writeFileSync(archive,'test archive label');
  const pin={sha256:'a'.repeat(64),sizeBytes:15};
  const built={status:'build-verified-runtime-acceptance-pending',buildRoot,packageDir,
    executable:{path:bin,...pin},asar:pin,packageInventory:['FFmpeg Encoder.exe','resources/app.asar']};
  function setup(shape){
    return createHostedLease({built:shape,productRoot,temp:scratch,runner:{provider:'github-hosted',image:'windows-2022'},
      tick:1_000_000,readClock:async()=>1_000_000,productFunctions:{
        ownership:{canonical:p=>path.resolve(p)},verifyPinnedFile:async file=>assert(fs.statSync(file).isFile()),
        retainDirectory:async dir=>async()=>assert(fs.lstatSync(dir).isDirectory()),
        inventory:async()=>built.packageInventory.map(name=>({name})),
        electron:{launch:()=>assert.fail('No media/app launch in controlled test')},
      }});
  }
  await assert.rejects(setup({...built,buildRoot:path.join(scratch,leaf)}).api.claimOnce(PRODUCT));
  await assert.rejects(setup({...built,packageDir:buildRoot}).api.claimOnce(PRODUCT));
  assert(!fs.existsSync(path.join(buildRoot,'settings-profile')));
  const lease=await setup(built).api.claimOnce(PRODUCT);
  assert.equal(lease.jobRoot,buildRoot);
  assert(fs.lstatSync(path.join(lease.jobRoot,'settings-profile')).isDirectory());
  await assert.rejects(setup(built).api.claimOnce(PRODUCT),{code:'EEXIST'});
});
test('finite failure exits never assign a phase to an ambiguous launch and require durable witnesses',()=>{
  assert.equal(failureExit('binding',null),41);
  assert.equal(failureExit('preflight',null),42);
  assert.equal(failureExit('setup',null),43);
  assert.equal(failureExit('build',null),44);
  assert.equal(failureExit('prelaunch',null),45);
  assert.equal(failureExit('toString',null),50); // No prototype fallthrough.
  const latch=makeLatch(()=>1_000_000);
  assert.equal(failureExit('journey',latch),45);
  assert.equal(failureExit('report',latch),50);
  const a=latch.begin(1);
  assert.equal(failureExit('journey',latch),null);
  latch.confirm(a);latch.joined(a);
  assert.equal(failureExit('journey',latch),null);
  latch.durable(a);assert.equal(failureExit('journey',latch),46);
  const b=latch.begin(2);assert.equal(failureExit('report',latch),null);
  latch.confirm(b);latch.joined(b);latch.durable(b);
  assert.equal(failureExit('journey',latch),47);
  assert.equal(failureExit('final-binding',latch),48);
  assert.equal(failureExit('report',latch),49);
  latch.fail();assert.equal(failureExit('report',latch),null);
});
test('failure branch prints only finite labels, never reads raw redirected output or enables artifact',()=>{
  const cooked=cook(fs.readFileSync(path.join(__dirname,'windows.yml.in')),H).toString();
  const pre=cooked.indexOf('$status = $LASTEXITCODE');
  const digest=cooked.indexOf('$bound = @(Select-String');
  assert(pre>=0&&digest>pre);
  const failure=cooked.slice(pre,digest);
  assert.deepEqual([...failure.matchAll(/^\s+(4[1-9]) \{ '([A-Z_]+)' \}$/gm)].map(m=>[Number(m[1]),m[2]]),[
    [41,'BINDING_REFUSED'],[42,'FIXED_PREFLIGHT_REFUSED'],[43,'RUNNER_SETUP_REFUSED'],[44,'PACKAGE_UNVERIFIED'],
    [45,'PRELAUNCH_REFUSED'],[46,'SCENARIO_REFUSED_AFTER_ONE_DURABLE_CLOSE'],[47,'SCENARIO_REFUSED_AFTER_TWO_DURABLE_CLOSES'],
    [48,'FINAL_BINDING_REFUSED_AFTER_TWO_DURABLE_CLOSES'],[49,'REPORT_UNAVAILABLE_AFTER_TWO_DURABLE_CLOSES'],
  ]);
  assert(failure.includes("default { 'UNCLASSIFIED_FAILURE' }"));
  assert(failure.includes('Write-Host "::error title=Regular R03 hosted check::$reason"'));
  assert(failure.includes('exit 1'));
  assert.doesNotMatch(failure,/\$log|Get-Content|Select-String|GITHUB_OUTPUT|report_ready|upload-artifact/);
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
