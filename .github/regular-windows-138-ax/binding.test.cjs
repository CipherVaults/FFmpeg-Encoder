'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,bindHarness,bindProduct,parseRows,runWithReadback}=require('./binding.cjs');
const SHA='a'.repeat(40), SEED='b'.repeat(40);
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:POLICY.repo,GITHUB_REPOSITORY_ID:String(POLICY.repoId),GITHUB_REF:POLICY.ref,GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_RUN_ID:'123',GITHUB_SHA:SHA,GITHUB_WORKFLOW_SHA:SHA,GITHUB_WORKFLOW_REF:POLICY.repo+'/'+WORKFLOW+'@'+POLICY.ref};
const event={repository:{id:POLICY.repoId,full_name:POLICY.repo,fork:false},ref:POLICY.ref,created:false,forced:false,deleted:false,before:SEED,after:SHA,commits:[{id:SHA}],head_commit:{id:SHA}};
test('ordinary exact non-forced first attempt only; other repos, branch, dispatch and malformed case refuse',()=>{
  assert.deepEqual(eventIdentity(env,event),{head:SHA,seed:SEED,runId:'123',attempt:1});
  for(const change of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REPOSITORY_ID:'111'},{GITHUB_REF:'refs/heads/main'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_SHA:'c'.repeat(40)},{GITHUB_WORKFLOW_SHA:SEED},{GITHUB_WORKFLOW_REF:undefined},{GITHUB_WORKFLOW_REF:POLICY.repo+'/.github/workflows/anything.yml@'+POLICY.ref},{GITHUB_WORKFLOW_REF:POLICY.repo+'/'+WORKFLOW+'@refs/heads/main'}]) assert.throws(()=>eventIdentity({...env,...change},event));
  for(const change of [{created:true},{forced:true},{deleted:true},{ref:'refs/heads/main'},{before:'0'.repeat(40)},{before:SHA},{after:SEED},{commits:[]},{commits:[{id:SHA},{id:SEED}]},{head_commit:{id:SEED}},{repository:{...event.repository,fork:true}}]) assert.throws(()=>eventIdentity(env,{...event,...change}));
});
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000}).trim();
const put=async(root,name,contents)=>{const f=path.join(root,name);await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,contents);};
const commit=(root,subject)=>{git(root,'add','--all');git(root,'-c','user.name=Fixture','-c','user.email=synthetic@localhost.invalid','commit','-m',subject);return git(root,'rev-parse','HEAD');};
test('separate source rejects wrong commit/tree and altered tracked bytes; exact linked workflow may have server-authored metadata',async t=>{
  const home=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'win-harness-inert-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const h=path.join(home,'harness'),p=path.join(home,'product');await fs.mkdir(h);git(h,'init','-q');git(h,'config','core.autocrlf','false');
  await put(h,'app.cjs','inert exercise\n');
  const source=commit(h,'Synthetic product base'),tree=git(h,'rev-parse','HEAD^{tree}');
  const pin={...POLICY,source,tree,sourceFileCount:1};
  git(home,'-c','advice.detachedHead=false','clone','--quiet','--no-hardlinks',h,p);
  assert.equal(await bindProduct(p,pin),1);
  await assert.rejects(bindProduct(p,{...pin,source:SHA}));
  await assert.rejects(bindProduct(p,{...pin,tree:SHA}));
  await put(p,'app.cjs','altered exercise\n');await assert.rejects(bindProduct(p,pin));await put(p,'app.cjs','inert exercise\n');
  for(const file of SEED_FILES)await put(h,file,file===TEMPLATE?'head: __BOUND_SEED__\n':'not runnable\n');
  const seed=commit(h,'Synthetic server-side seed');
  await put(h,WORKFLOW,cook(Buffer.from('head: __BOUND_SEED__\n'),seed));
  const head=commit(h,'Synthetic server-side activation with arbitrary metadata');
  const id={head,seed};
  assert.equal(await bindHarness(h,id,pin),git(h,'rev-parse','HEAD^{tree}'));
  await assert.rejects(bindHarness(h,{head,seed:source},pin));
  await assert.rejects(bindHarness(h,id,{...pin,tree:SHA}));
  await put(h,WORKFLOW,'dirty workflow\n');await assert.rejects(bindHarness(h,id,pin));
  const wrong=commit(h,'Wrong workflow');await assert.rejects(bindHarness(h,{head:wrong,seed},pin));
  git(h,'checkout','--detach',seed);await put(h,WORKFLOW,'uncooked workflow\n');
  const uncooked=commit(h,'Unreviewed workflow');await assert.rejects(bindHarness(h,{head:uncooked,seed},pin));
  git(h,'checkout','--detach',seed);await put(h,WORKFLOW,cook(Buffer.from('head: __BOUND_SEED__\n'),seed));await put(h,'unreviewed.txt','extra\n');
  const extra=commit(h,'Workflow with unexpected sibling path');await assert.rejects(bindHarness(h,{head:extra,seed},pin));
  assert.equal(await bindProduct(p,pin),1);
});
test('tracked byte inventory denies aliases, symlinks and unsupported names',()=>{
  const row=(name,mode='100644')=>mode+' blob '+SHA+'\t'+name+'\0';
  assert.deepEqual(parseRows(Buffer.from(row('ui/file.js'))),[{blob:SHA,name:'ui/file.js'}]);
  for(const r of [row('a')+row('A'),row('../else'),row('.git/config'),row('ui/ap:js'),row('foo.js','120000'),row('ui/foo. ')])assert.throws(()=>parseRows(Buffer.from(r)));
});
test('unmaterialized workflow retains separate fixed checkout, preflight and report-only boundary',async()=>{
  const s=await fs.readFile(path.join(__dirname,'windows.yml.in'),'utf8');
  assert.equal(s.split('__BOUND_SEED__').length,2);assert(s.includes('ref: '+POLICY.source));
  assert(s.includes('path: harness')&&s.includes('path: product')&&s.includes('working-directory: product'));
  assert(s.includes('github.workflow_sha == github.sha')&&s.includes(POLICY.repo+'/'+WORKFLOW+'@'+POLICY.ref));
  assert(s.includes('contents: read')&&s.includes('github.run_attempt == 1')&&s.includes("steps.verify.outputs.report_ready == 'true'"));
  assert(s.indexOf('binding.cjs preflight')<s.indexOf('npm ci'));assert(s.includes('npm ci --ignore-scripts --no-audit --no-fund'));
  for(const forbidden of ['pull_request','workflow_dispatch','repository_dispatch','secrets.','no-sandbox','contents: write'])assert(!s.includes(forbidden));
});

test('all readbacks run after a failed journey; failure and independent readback evidence stay distinct',async()=>{
  const seen=[],failure=Object.assign(new Error('private fixture path never copied to report'),{code:'INTEGRATION_TIMEOUT'});
  const r=await runWithReadback(async()=>{seen.push('run');throw failure;},{
    verifyHarness:async()=>{seen.push('harness');throw Error('bad harness');},
    verifyProduct:async()=>{seen.push('product');},
    verifyInputs:async()=>{seen.push('inputs');},
  });
  assert.equal(r.failure,failure);assert.equal(r.runFailed,true);
  assert.deepEqual(seen,['run','harness','product','inputs']);
  assert.deepEqual(r.postRunReadback,{harness:'failed',product:'verified',packageInputs:'verified'});
  assert.equal(r.complete,false);
});
test('unverified product refuses post-run package readback, even after successful native work',async()=>{
  let ran=0;
  const r=await runWithReadback(async()=>{},{
    verifyHarness:async()=>{},verifyProduct:async()=>{throw Error('changed source');},
    verifyInputs:async()=>{ran++;},
  });
  assert.equal(ran,0);assert.equal(r.failure,null);assert.equal(r.complete,false);
  assert.deepEqual(r.postRunReadback,{harness:'verified',product:'failed',packageInputs:'not-run'});
});
test('readback proves only observed successful checks, regardless of primary journey result',async()=>{
  const checks={verifyHarness:async()=>{},verifyProduct:async()=>{},verifyInputs:async()=>{}};
  for(const run of [async()=>{},async()=>{throw Error('launch failed');}]){
    const r=await runWithReadback(run,checks);
    assert.deepEqual(r.postRunReadback,{harness:'verified',product:'verified',packageInputs:'verified'});
    assert.equal(r.complete,true);
  }
  const r=await runWithReadback(async()=>{},{...checks,verifyInputs:async()=>{throw Error('changed lock');}});
  assert.equal(r.postRunReadback.packageInputs,'failed');assert.equal(r.complete,false);
});

test('even a falsy rejection remains a failed journey',async()=>{
  const verify=async()=>{};
  const r=await runWithReadback(async()=>{throw undefined;},{verifyHarness:verify,verifyProduct:verify,verifyInputs:verify});
  assert.equal(r.failure,undefined);assert.equal(r.runFailed,true);assert.equal(r.complete,true);
});

test('concurrency isolates checkpoint 138 from past and future Windows smoke attempts',async()=>{
  const s=await fs.readFile(path.join(__dirname,'windows.yml.in'),'utf8');
  const verify=text=>assert.deepEqual(text.match(/^  group: .*$/gm),['  group: regular-windows-ax-138-once']);
  verify(s);
  assert.throws(()=>verify(s.replace('group: regular-windows-ax-138-once','group: regular-windows-ax-137-once')));
  assert.throws(()=>verify(s.replace('group: regular-windows-ax-138-once','group: regular-windows-ax-139-once')));
});
