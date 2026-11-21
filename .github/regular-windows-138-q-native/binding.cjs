'use strict';
// Inert proposal: invoked only by the separately reviewed materialized workflow.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const POLICY = Object.freeze({
  repo: 'CipherVaults/FFmpeg-Encoder', repoId: 1460111553,
  ref: 'refs/heads/blue/regular-win-q-native-138-once',
  source: '33196f7434d781e683bb35ed4445fd1db3cc118a',
  tree: '98067ae82443fa03bd21fe20e9f86593d01ad092',
  sourceFileCount: 1689,
  floor: 46498163717n,
});
const DIR = '.github/regular-windows-138-q-native/';
const TEMPLATE = DIR + 'windows.yml.in';
const WORKFLOW = '.github/workflows/regular-windows-138-q-native.yml';
const SEED_FILES = [DIR+'binding.cjs',DIR+'binding.test.cjs',DIR+'run-native.cjs',DIR+'suite-child.cjs',DIR+'safety.test.cjs',DIR+'report.cjs',TEMPLATE].sort();
const SHA = /^[a-f0-9]{40}$/;
const validSha = s => typeof s === 'string' && SHA.test(s) && !/^0+$/.test(s);
const eqPath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function eventIdentity(env,event,p=POLICY) {
  assert(env.RUNNER_ENVIRONMENT==='github-hosted');
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
async function main() {
  const mode=process.argv[2];
  assert(process.argv.length===3&&['preflight','run'].includes(mode));
  assert(process.platform==='win32'&&process.arch==='x64'&&process.version==='v24.22.1');
  const workspace=process.env.GITHUB_WORKSPACE,parent=process.env.RUNNER_TEMP;
  assert(workspace&&path.isAbsolute(workspace));
  const harness=path.join(workspace,'harness'),product=path.join(workspace,'product');
  assert(eqPath(path.resolve(__dirname,'../..'),harness));
  const event=JSON.parse(await readBounded(process.env.GITHUB_EVENT_PATH,1024*1024));
  const id=eventIdentity(process.env,event);
  const harnessTree=await bindHarness(harness,id);
  await bindProduct(product);
  const {preflight}=require(path.join(product,'scripts/windows-hosted-package-check.cjs'));
  const {expectedCandidateManifest}=require(path.join(product,'src/candidate-runtime.cjs'));
  const {requiredFree}=require(path.join(product,'scripts/windows-package-policy.cjs'));
  const manifest=expectedCandidateManifest();
  assert.equal(requiredFree([manifest.archive,manifest.electron.archive]),POLICY.floor);
  const {execute}=require('./run-native.cjs');
  if(mode==='preflight'){
    await preflight(product,parent,manifest);
    return;
  }
  const result=await execute({product,parent,manifest,preflight},{
    verifyHarness:async()=>assert.equal(await bindHarness(harness,id),harnessTree),
    verifyProduct:async()=>assert.equal(await bindProduct(product),POLICY.sourceFileCount),
  });
  const {publish}=require('./report.cjs');
  const ok=publish({id,harnessTree,policy:POLICY,result});
  process.exitCode=ok?0:1;
}
module.exports={POLICY,SEED_FILES,TEMPLATE,WORKFLOW,eventIdentity,cook,bindHarness,bindProduct,parseRows};
if(require.main===module)main().catch(()=>{console.error('WIN_Q_EVIDENCE_UNAVAILABLE_OR_NOT_ADMITTED');process.exitCode=1;});
