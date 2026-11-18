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
const SAFE_LISTINGS = new WeakSet();
const LISTING_FIELDS = new Set(['Path', 'Size', 'Packed Size', 'Modified', 'Created', 'Accessed', 'Attributes', 'CRC', 'Encrypted', 'Method', 'Block', 'Folder']);
const LISTING_REASONS = new Set(['INPUT_BOUND','RECORD_COUNT','FIELD_FORMAT','FIELD_UNKNOWN','FIELD_DUPLICATE','PATH_BOUND','PATH_SEPARATOR','PATH_COMPONENT','PATH_DUPLICATE','PATH_ROOT','SIZE_OR_ENCRYPTION','ATTRIBUTES','FOLDER_CONFLICT','DIRECTORY_SIZE','EXPANDED_LIMIT','SELECTED_MEMBER','ANCESTOR_CONFLICT']);
function listingNeed(ok, reason) {
  if (!ok) { const error=new assert.AssertionError({message:'Archive listing refused.',actual:false,expected:true}); error.listingReason=reason; throw error; }
}
// Values, paths and unknown field names are never copied into diagnostics.
function listingStructure(text) {
  if(typeof text!=='string' || Buffer.byteLength(text)>MAX_LIST)return null;
  const result={bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),records:0,
    fieldNames:[],unknownFields:0,malformedLines:0,separators:{forward:0,backward:0,mixed:0,none:0},attributes:{windows:0,other:0}};
  const known=new Set();const blocks=text.trim().split(/\r?\n\r?\n/);result.records=Math.min(blocks.length,1025);
  for(const block of blocks.slice(0,1024))for(const line of block.split(/\r?\n/).slice(0,64)) {
    const m=/^([^=]+?) = (.*)$/.exec(line);
    if(!m){result.malformedLines++;continue;}
    if(LISTING_FIELDS.has(m[1]))known.add(m[1]);else result.unknownFields++;
    if(m[1]==='Path'){const f=m[2].includes('/'),b=m[2].includes('\\');result.separators[f&&b?'mixed':f?'forward':b?'backward':'none']++;}
    if(m[1]==='Attributes')result.attributes[/^[DRAHS_ ]*$/.test(m[2])?'windows':'other']++;
  }
  result.fieldNames=[...known].sort();Object.freeze(result.fieldNames);Object.freeze(result.separators);Object.freeze(result.attributes);Object.freeze(result);SAFE_LISTINGS.add(result);return result;
}
function safeMember(value) {
  listingNeed(typeof value === 'string' && value.length > 0 && value.length < 512,'PATH_BOUND');
  listingNeed(!/[\\:\x00-\x1f\x7f*?]/.test(value) && !value.startsWith('/'),'PATH_SEPARATOR');
  listingNeed(value.split('/').every(x => x && x !== '.' && x !== '..' && !/[. ]$/.test(x)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(x)),'PATH_COMPONENT');
  return value;
}
function inspectListing(text, manifest = expectedCandidateManifest()) {
  listingNeed(typeof text === 'string' && Buffer.byteLength(text) <= MAX_LIST && !text.includes('\0'),'INPUT_BOUND');
  const blocks = text.trim().split(/\r?\n\r?\n/); listingNeed(blocks.length > 0 && blocks.length <= 1024,'RECORD_COUNT');
  const seen = new Map(); let total = 0n;
  const fields = LISTING_FIELDS;
  for (const block of blocks) {
    const entry = {};
    for (const line of block.split(/\r?\n/)) {
      const m = /^([^=]+?) = (.*)$/.exec(line); listingNeed(m,'FIELD_FORMAT'); listingNeed(fields.has(m[1]),'FIELD_UNKNOWN'); listingNeed(!Object.hasOwn(entry,m[1]),'FIELD_DUPLICATE');
      entry[m[1]] = m[2];
    }
    const name = safeMember(entry.Path); const key=name.toLowerCase(); listingNeed(!seen.has(key),'PATH_DUPLICATE');
    listingNeed(name === manifest.archive.rootDirectory || name.startsWith(manifest.archive.rootDirectory + '/'),'PATH_ROOT');
    listingNeed(/^[0-9]{1,12}$/.test(entry.Size) && entry.Encrypted === '-','SIZE_OR_ENCRYPTION');
    // Strict Windows attributes only. Unix/link/reparse/unknown forms refuse.
    listingNeed(typeof entry.Attributes === 'string' && /^[DRAHS_ ]*$/.test(entry.Attributes),'ATTRIBUTES');
    const directory=entry.Attributes.includes('D');
    if (Object.hasOwn(entry,'Folder')) listingNeed(entry.Folder === (directory ? '+' : '-'),'FOLDER_CONFLICT');
    listingNeed(!directory || entry.Size === '0','DIRECTORY_SIZE'); total += BigInt(entry.Size);
    listingNeed(total <= 2n * 1024n ** 3n,'EXPANDED_LIMIT');
    seen.set(key,{name,size:Number(entry.Size),directory});
  }
  for (const {member,pin} of selected(manifest)) {
    const found=seen.get(member.toLowerCase());
    listingNeed(found && found.name===member && !found.directory && found.size===pin.sizeBytes,'SELECTED_MEMBER');
    for(let parent=path.posix.dirname(member); parent!=='.';parent=path.posix.dirname(parent)) {
      const e=seen.get(parent.toLowerCase()); listingNeed(!e || (e.directory && e.name===parent),'ANCESTOR_CONFLICT');
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
const STARTUP_STAGES = new Set(['preflight','tool-identification','listing','listing-command','listing-parse','post-list-capacity','post-list-owner','extraction','provisioning','version','final-checks']);
function startupDiagnostic(error) {
  const codes=new Set(['ETIMEDOUT','ENOENT','EACCES','EPERM','ENOBUFS','ERR_ASSERTION','EINVAL','ENOSPC']);
  const kinds=new Set(['AssertionError','TypeError','SyntaxError','RangeError','Error']);
  return {stage:STARTUP_STAGES.has(error?.startupStage)?error.startupStage:'preflight',
    kind:kinds.has(error?.name)?error.name:'Error',code:codes.has(error?.code)?error.code:'UNCLASSIFIED',
    listingReason:LISTING_REASONS.has(error?.listingReason)?error.listingReason:null,
    listing:SAFE_LISTINGS.has(error?.listingStructure)?error.listingStructure:null};
}
async function startup({parent,acquisition,manifest=expectedCandidateManifest()}, {run=runBounded}={}) {
  let stage='preflight', structure=null;
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
  stage='listing-command';
  const listing=await run(TOOL,['l','-slt','-ba','-sccUTF-8','--',archive],{limit:MAX_LIST,timeout:30000,cwd:parent});
  structure=listingStructure(listing.stdout);
  stage='listing-parse';
  const entries=inspectListing(listing.stdout,manifest);
  const bytes=entries.reduce((n,x)=>n+BigInt(x.pin.sizeBytes),0n);
  stage='post-list-capacity'; await capacity(parent,bytes*2n+1048576n);
  stage='post-list-owner'; await owner();
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
  } catch(error) {error.startupStage=stage;error.listingStructure=structure;throw error;}
}
module.exports={selected,safeMember,inspectListing,runBounded,startup,startupDiagnostic,listingStructure};
