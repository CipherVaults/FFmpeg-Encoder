'use strict';
// Inert proposal: invoked only by the separately reviewed materialized workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const POLICY = Object.freeze({
  repo: 'CipherVaults/FFmpeg-Encoder', repoId: 1460111553,
  ref: 'refs/heads/blue/regular-win-cpu-138-once',
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
const DIR = '.github/regular-windows-138/';
const TEMPLATE = DIR + 'windows.yml.in';
const WORKFLOW = '.github/workflows/regular-windows-138.yml';
const SEED_FILES = [DIR+'binding.cjs',DIR+'binding.test.cjs',TEMPLATE].sort();
const SHA = /^[a-f0-9]{40}$/;
const validSha = s => typeof s === 'string' && SHA.test(s) && !/^0+$/.test(s);
const eqPath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function eventIdentity(env,event,p=POLICY) {
  assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===p.repo&&env.GITHUB_REPOSITORY_ID===String(p.repoId));
  assert(env.GITHUB_REF===p.ref&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_RUN_ATTEMPT==='1');
  assert(/^[1-9]\d{0,18}$/.test(env.GITHUB_RUN_ID));
  assert(event.repository?.id===p.repoId&&event.repository?.full_name===p.repo&&event.repository?.fork===false&&event.ref===p.ref);
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
  assert(validSha(seed));const template=bytes.toString('utf8');
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
// This is independent of journey's protected synthetic INPUT/package checks.
// Recheck exact harness and product on success and failure; invalid product
// bytes cannot be handed to the package input reader. Never publish raw errors.
async function runWithReadback(run,{verifyHarness,verifyProduct,verifyInputs}) {
  let failure=null,runFailed=false;
  try { await run(); } catch(error) { failure=error; runFailed=true; }
  const postRunReadback={harness:'not-run',product:'not-run',packageInputs:'not-run'};
  async function observe(key,operation){
    try { await operation(); postRunReadback[key]='verified'; }
    catch { postRunReadback[key]='failed'; }
  }
  await observe('harness',verifyHarness);
  await observe('product',verifyProduct);
  if(postRunReadback.product==='verified')await observe('packageInputs',verifyInputs);
  const complete=Object.values(postRunReadback).every(value=>value==='verified');
  return {failure,runFailed,postRunReadback,complete};
}
async function main() {
  const mode=process.argv[2];
  assert(process.argv.length===3&&['preflight','run'].includes(mode));
  assert(process.platform==='win32'&&process.arch==='x64');
  const workspace=process.env.GITHUB_WORKSPACE;
  assert(workspace&&path.isAbsolute(workspace));
  const harness=path.join(workspace,'harness'),product=path.join(workspace,'product');
  assert(eqPath(path.resolve(__dirname,'../..'),harness));
  const event=JSON.parse(await readBounded(process.env.GITHUB_EVENT_PATH,1024*1024));
  const id=eventIdentity(process.env,event);
  const harnessTree=await bindHarness(harness,id);
  await bindProduct(product);
  // No product modules load until both independent Git and worktree bindings pass.
  const fromProduct=name=>require(path.join(product,name));
  const {appSources,hashFile}=fromProduct('scripts/build-portable.cjs');
  async function packageInputs(){
    witness(await appSources(product,fromProduct('package.json')));
    for(const [name,sha] of Object.entries(LOCKS))assert.equal((await hashFile(path.join(product,name))).sha256,sha);
  }
  await packageInputs();
  const {preflight,createPreflightDiagnostic,execute}=fromProduct('scripts/windows-hosted-package-check.cjs');
  const {expectedCandidateManifest}=fromProduct('src/candidate-runtime.cjs');
  const {requiredFree}=fromProduct('scripts/windows-package-policy.cjs');
  const manifest=expectedCandidateManifest(),d=createPreflightDiagnostic(),parent=process.env.RUNNER_TEMP;
  assert.equal(requiredFree([manifest.archive,manifest.electron.archive]),POLICY.floor);
  try{await preflight(product,parent,manifest,d);}catch(error){console.error(JSON.stringify(d.failure(error)));process.exitCode=1;return;}
  if(mode==='preflight')return;
  assert.equal(process.version,'v24.22.1');
  const {journey}=fromProduct('scripts/windows-packaged-integration.cjs');
  const {sanitized,primaryFailure,publish}=fromProduct('scripts/windows-hosted-integration-check.cjs');
  const {head,runId,attempt}=id;
  let phase='build',result=null,build=null,failure=null,calls=0;
  const terminal=await runWithReadback(async()=>{
    await execute({root:product,parent,identity:{head:POLICY.source,runId,attempt:'1'}},{
      onVerifiedBuild:async built=>{
        assert(++calls===1);witness(built.sources);build=built;
        result=await journey({built,parent,onPhase:p=>{phase=p;}},{electron:fromProduct('node_modules/playwright')._electron});
      },
    });
    assert.equal(calls,1);
  },{
    verifyHarness:async()=>assert.equal(await bindHarness(harness,id),harnessTree),
    verifyProduct:async()=>assert.equal(await bindProduct(product),POLICY.sourceFileCount),
    verifyInputs:packageInputs,
  });
  if(terminal.runFailed){
    result=terminal.failure?.integrationResult||result;
    failure=primaryFailure(phase,terminal.failure,result);
  } else if(!terminal.complete)failure={phase:'report',code:'ERR_ASSERTION'};
  if(failure)process.exitCode=1;
  const report=sanitized({head,runId,attempt},result,failure,build);
  Object.assign(report,{postRunReadback:terminal.postRunReadback,scope:'regular-cp138-hosted-cpu-only',harnessTree,seed:id.seed,productHead:POLICY.source,productTree:POLICY.tree,packageInputsSha256:POLICY.productInputs,requiredFreeBytes:String(POLICY.floor)});
  console.log('Report SHA256 '+await publish(parent,report,process.env.GITHUB_OUTPUT));
}
module.exports={POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,bindHarness,bindProduct,parseRows,runWithReadback};
if(require.main===module)main().catch(()=>{console.error('Hosted regular Windows regression not admitted or evidence unavailable.');process.exitCode=1;});
