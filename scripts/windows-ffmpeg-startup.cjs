'use strict';
// FFmpeg only: never extract archive paths to disk, install Electron, or admit media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { retainDirectory } = require('./acquire-candidate-archives.cjs');
const { expectedCandidateManifest, assertOrdinaryPath, verifyPinnedFile } = require('../src/candidate-runtime.cjs');
const { provisionCandidateRuntime } = require('./provision-candidate-runtime.cjs');
const TOOL = 'C:\\Program Files\\7-Zip\\7z.exe';
const FLOOR = 27n * 1024n ** 3n;
const MAX_LIST = 1024 * 1024;
function selected(manifest = expectedCandidateManifest()) {
  assert.deepEqual(manifest, expectedCandidateManifest());
  return [...manifest.binaries, ...manifest.notices].map(pin => ({ pin,
    member: manifest.archive.rootDirectory + '/' + pin.archivePath }));
}
function safeMember(value) {
  assert(typeof value === 'string' && value.length > 0 && value.length < 512);
  assert(!/[\\:\x00-\x1f\x7f*?]/.test(value) && !value.startsWith('/'));
  assert(value.split('/').every(x => x && x !== '.' && x !== '..' && !/[. ]$/.test(x)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(x)));
  return value;
}
function inspectListing(text, manifest = expectedCandidateManifest()) {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= MAX_LIST && !text.includes('\0'));
  const blocks = text.trim().split(/\r?\n\r?\n/); assert(blocks.length > 0 && blocks.length <= 1024);
  const seen = new Map(); let total = 0n;
  const fields = new Set(['Path', 'Size', 'Packed Size', 'Modified', 'Created', 'Accessed', 'Attributes', 'CRC', 'Encrypted', 'Method', 'Block', 'Folder']);
  for (const block of blocks) {
    const entry = {};
    for (const line of block.split(/\r?\n/)) {
      const m = /^([^=]+?) = (.*)$/.exec(line); assert(m && fields.has(m[1]) && !Object.hasOwn(entry,m[1]), 'Ambiguous archive field.');
      entry[m[1]] = m[2];
    }
    const name = safeMember(entry.Path); const key=name.toLowerCase(); assert(!seen.has(key), 'Duplicate/case alias.');
    assert(name === manifest.archive.rootDirectory || name.startsWith(manifest.archive.rootDirectory + '/'));
    assert(/^[0-9]{1,12}$/.test(entry.Size) && entry.Encrypted === '-', 'Size/encryption not admissible.');
    // Strict Windows attributes only. Unix/link/reparse/unknown forms refuse.
    assert(typeof entry.Attributes === 'string' && /^[DRAHS_ ]*$/.test(entry.Attributes));
    const directory=entry.Attributes.includes('D');
    if (Object.hasOwn(entry,'Folder')) assert(entry.Folder === (directory ? '+' : '-'));
    assert(!directory || entry.Size === '0'); total += BigInt(entry.Size);
    assert(total <= 2n * 1024n ** 3n, 'Unbounded expanded listing.');
    seen.set(key,{name,size:Number(entry.Size),directory});
  }
  for (const {member,pin} of selected(manifest)) {
    const found=seen.get(member.toLowerCase());
    assert(found && found.name===member && !found.directory && found.size===pin.sizeBytes, 'Selected member differs from manifest.');
    for(let parent=path.posix.dirname(member); parent!=='.';parent=path.posix.dirname(parent)) {
      const e=seen.get(parent.toLowerCase()); assert(!e || (e.directory && e.name===parent),'File ancestor alias.');
    }
  }
  return selected(manifest);
}
// One child at a time, observed close mandatory. Stream limits checked BEFORE
// writing: stdout can never reserve beyond the selected member's exact size.
function runBounded(command,args,{limit,timeout=90000,fd=null,env=process.env,cwd,spawnImpl=spawn}={}) {
  assert(Number.isSafeInteger(limit) && limit>0 && limit<=228000000);
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let bytes=0,stderr=0,error=null; const chunks=[];
    const stop=e=>{if(!error)error=e;child.kill();};
    const timer=setTimeout(()=>stop(new Error('Bounded child timed out.')),timeout);
    child.on('error',e=>{error=e;});
    child.stdout.on('data',chunk=>{if(error)return;try {
      assert(bytes+chunk.length<=limit,'Child stdout limit exceeded.');
      if(fd===null)chunks.push(chunk);else {let pos=0;while(pos<chunk.length){const n=fs.writeSync(fd,chunk,pos,chunk.length-pos);assert(n>0);pos+=n;}}
      bytes+=chunk.length;
    }catch(e){stop(e);}});
    child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>65536)stop(new Error('Child stderr limit exceeded.'));});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(error)return reject(error);
      if(code!==0 || signal)return reject(new Error('Child did not close successfully.'));
      resolve({bytes,stdout:fd===null?Buffer.concat(chunks).toString('utf8'):null});});
  });
}
async function capacity(parent,extra) {
  const s=await fsp.statfs(parent,{bigint:true});assert(s.bavail*s.bsize>=FLOOR+extra,'Preserve 27 GiB residual floor.');
}
const STARTUP_STAGES = new Set(['preflight','tool-identification','listing','extraction','provisioning','version','final-checks']);
function startupDiagnostic(error) {
  const codes=new Set(['ETIMEDOUT','ENOENT','EACCES','EPERM','ENOBUFS','ERR_ASSERTION','EINVAL','ENOSPC']);
  const kinds=new Set(['AssertionError','TypeError','SyntaxError','RangeError','Error']);
  return {stage:STARTUP_STAGES.has(error?.startupStage)?error.startupStage:'preflight',
    kind:kinds.has(error?.name)?error.name:'Error',code:codes.has(error?.code)?error.code:'UNCLASSIFIED'};
}
async function startup({parent,acquisition,manifest=expectedCandidateManifest()}, {run=runBounded}={}) {
  let stage='preflight';
  try {
  assert(process.platform==='win32'); assert.deepEqual(manifest,expectedCandidateManifest());
  assert(!process.env.NODE_OPTIONS && !Object.entries(process.env).some(([k,v])=>k.startsWith('LD_')&&v));
  await assertOrdinaryPath(parent,'directory'); const owner=await retainDirectory(parent);
  const archive=path.join(acquisition.directory,manifest.archive.fileName);
  assert(acquisition.receipt===path.join(acquisition.directory,'transfer-report.json'));
  const ownsArchive=await retainDirectory(acquisition.directory);
  await ownsArchive();await verifyPinnedFile(archive,manifest.archive);
  stage='tool-identification';
  await assertOrdinaryPath(TOOL); const toolStat=await fsp.stat(TOOL);const toolHash=createHash('sha256').update(await fsp.readFile(TOOL)).digest('hex');
  const toolVersion=await run(TOOL,[],{limit:65536,timeout:10000,cwd:parent});
  assert(/^\s*7-Zip /m.test(toolVersion.stdout),'Unexpected extractor identity.');
  stage='listing';
  const listing=await run(TOOL,['l','-slt','-ba','-sccUTF-8','--',archive],{limit:MAX_LIST,timeout:30000,cwd:parent});
  const entries=inspectListing(listing.stdout,manifest);
  const bytes=entries.reduce((n,x)=>n+BigInt(x.pin.sizeBytes),0n);
  await capacity(parent,bytes*2n+1048576n);await owner();
  stage='extraction';
  const work=await fsp.mkdtemp(path.join(parent,'ffmpeg-startup-'));const owned=await retainDirectory(work);
  const payload=path.join(work,'payload');await fsp.mkdir(payload);await fsp.mkdir(path.join(payload,'bin'));
  const payloadOwned=await retainDirectory(payload);const binOwned=await retainDirectory(path.join(payload,'bin'));
  for(const {member,pin} of entries) {
    await owner();await owned();await payloadOwned();await binOwned();await ownsArchive();await verifyPinnedFile(archive,manifest.archive);
    await capacity(parent,bytes*2n+1048576n);
    const output=path.join(payload,...pin.archivePath.split('/'));
    const handle=await fsp.open(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
    try {
      const result=await run(TOOL,['x','-so','-spd','--',archive,member],{limit:pin.sizeBytes,fd:handle.fd,cwd:work});
      assert(result.bytes===pin.sizeBytes);await handle.sync();
    }finally{await handle.close();}
    await owned();await payloadOwned();await binOwned();await verifyPinnedFile(output,pin);
  }
  await verifyPinnedFile(archive,manifest.archive);await ownsArchive();await owned();
  // Provision into a fresh isolated root on the SAME measured volume, not checkout.
  stage='provisioning';
  const isolated=path.join(work,'runtime-root');await fsp.mkdir(isolated);await fsp.mkdir(path.join(isolated,'resources'));
  await fsp.writeFile(path.join(isolated,'resources','candidate-binary-manifest.json'),JSON.stringify(manifest),{flag:'wx'});
  await capacity(parent,bytes+1048576n);
  await provisionCandidateRuntime({root:isolated,receiptPath:acquisition.receipt,payloadDirectory:payload});
  stage='version';
  const versions=[];
  for(const pin of manifest.binaries) {
    const exe=path.join(isolated,...pin.developmentPath.split('/'));await verifyPinnedFile(exe,pin);await owned();
    const version=await run(exe,['-version'],{limit:65536,timeout:10000,cwd:work});
    const first=version.stdout.split(/\r?\n/)[0];assert(first.startsWith(pin.name.slice(0,-4)+' version '+manifest.version+' '),'Unexpected version.');
    await verifyPinnedFile(exe,pin);versions.push({name:pin.name,sha256:pin.sha256,sizeBytes:pin.sizeBytes,version:manifest.version,closed:true});
  }
  stage='final-checks';
  await owned();await owner();assert((await fsp.stat(TOOL)).size===toolStat.size);assert(createHash('sha256').update(await fsp.readFile(TOOL)).digest('hex')===toolHash);
  return {state:'FFMPEG_VERSION_VERIFIED_ONLY',toolSha256:toolHash,listingSha256:createHash('sha256').update(listing.stdout).digest('hex'),selectedFiles:entries.length,versions,media:'not-run',electron:'not-run'};
  } catch(error) {error.startupStage=stage;throw error;}
}
module.exports={selected,safeMember,inspectListing,runBounded,startup,startupDiagnostic};
