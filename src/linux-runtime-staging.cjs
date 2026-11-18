'use strict';
// Main-owned development utility only. No CLI/IPC/environment/runtime fallback.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DESCRIPTOR}=require('./linux-runtime-descriptor.cjs');
const {appFiles,selectPortableRuntime}=require('../scripts/build-portable.cjs');
const SHA=b=>createHash('sha256').update(b).digest('hex');
const MAX_SOURCE_BYTES=64*1024*1024;
const FLOOR=27n*1024n**3n;
function options(value,keys){assert(value && Object.getPrototypeOf(value)===Object.prototype);assert.deepEqual(Reflect.ownKeys(value).sort(),keys.slice().sort());for(const k of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'));}
function relative(name){assert(typeof name==='string' && name.length && !/[\\:\x00-\x1f\x7f]/.test(name) && !path.posix.isAbsolute(name));assert(name.split('/').every(x=>x && x!=='.' && x!=='..'));return name;}
async function directory(root){assert(typeof root==='string' && path.isAbsolute(root) && root===path.resolve(root));assert.equal(await fs.realpath(root),root);const s=await fs.lstat(root,{bigint:true});assert(s.isDirectory()&&!s.isSymbolicLink());return {dev:s.dev,ino:s.ino,birthtimeNs:s.birthtimeNs};}
const stamp=s=>['dev','ino','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k=>String(s[k]));
async function readRegular(root,name,maxBytes){
  relative(name);await directory(root);
  const target=path.join(root,...name.split('/'));assert.equal(await fs.realpath(target),target);
  let parent=root;for(const part of name.split('/').slice(0,-1)){parent=path.join(parent,part);await directory(parent);}
  const entry=await fs.lstat(target,{bigint:true});assert(entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1n&&entry.size<=BigInt(maxBytes));
  const fd=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await fd.stat({bigint:true});assert.deepEqual(stamp(before),stamp(entry));
    const chunks=[];let count=0;const buffer=Buffer.alloc(1024*1024);
    while(true){const {bytesRead}=await fd.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;assert(count<=maxBytes && BigInt(count)<=before.size);chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));}
    assert.equal(BigInt(count),before.size);assert.deepEqual(stamp(await fd.stat({bigint:true})),stamp(before));assert.deepEqual(stamp(await fs.lstat(target,{bigint:true})),stamp(before));assert.equal(await fs.realpath(target),target);
    return Buffer.concat(chunks);
  }finally{await fd.close();}
}
async function verifyLinuxStagingPair(input){
  options(input,['root']);assert.equal(process.platform,DESCRIPTOR.platform);assert.equal(process.arch,DESCRIPTOR.arch);
  const root=input.root,owner=await directory(root),files=[];
  for(const pin of DESCRIPTOR.files){const b=await readRegular(root,pin.path,pin.bytes);assert.equal(b.length,pin.bytes);assert.equal(SHA(b),pin.sha256);files.push({...pin});}
  assert.deepEqual(await directory(root),owner);
  // No executable paths or production handles returned. This is an inventory.
  return Object.freeze({schema:1,descriptorId:DESCRIPTOR.id,scope:DESCRIPTOR.scope,distributionReady:false,usableForEncoding:false,files:Object.freeze(files.map(Object.freeze))});
}
async function stageLinuxInertTree(input){
  options(input,['sourceRoot','runtimeRoot','outputParent']);
  const {sourceRoot,runtimeRoot,outputParent}=input;
  const owners=await Promise.all([sourceRoot,runtimeRoot,outputParent].map(directory));
  assert(!outputParent.startsWith(sourceRoot+path.sep)&&outputParent!==sourceRoot);
  assert(!outputParent.startsWith(runtimeRoot+path.sep)&&outputParent!==runtimeRoot);
  await verifyLinuxStagingPair({root:runtimeRoot});
  const pkgBytes=await readRegular(sourceRoot,'package.json',1024*1024),pkg=JSON.parse(pkgBytes);
  assert.equal(selectPortableRuntime(pkg).mode,'candidate-0.7');
  const names=appFiles(sourceRoot,pkg);assert(names.length<=1024);assert.equal(new Set(names).size,names.length);
  const sources=[];let sourceBytes=0;
  for(const name of names){const bytes=await readRegular(sourceRoot,name,32*1024*1024);sourceBytes+=bytes.length;assert(sourceBytes<=MAX_SOURCE_BYTES);sources.push({name,bytes});}
  const needed=BigInt(sourceBytes)+DESCRIPTOR.files.reduce((n,p)=>n+BigInt(p.bytes),0n)+1048576n;
  const disk=await fs.statfs(outputParent,{bigint:true});assert(disk.bavail*disk.bsize>=FLOOR+needed,'Preserve 27 GiB plus admitted staging bytes.');
  for(let i=0;i<3;i++)assert.deepEqual(await directory([sourceRoot,runtimeRoot,outputParent][i]),owners[i]);
  const destination=await fs.mkdtemp(path.join(outputParent,'linux-inert-stage-')),owner=await directory(destination),inventory=[];
  async function put(name,bytes){relative(name);assert.deepEqual(await directory(destination),owner);let parent=destination;for(const part of name.split('/').slice(0,-1)){const child=path.join(parent,part);try{await fs.mkdir(child,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await directory(child);parent=child;}await fs.writeFile(path.join(destination,...name.split('/')),bytes,{flag:'wx',mode:0o600});assert.deepEqual(await readRegular(destination,name,bytes.length),bytes);inventory.push({path:name,bytes:bytes.length,sha256:SHA(bytes)});}
  // No chmod +x, Electron, packager, ASAR or archive creation in this slice.
  for(const row of sources)await put('app/'+row.name,row.bytes);
  for(const pin of DESCRIPTOR.files){const bytes=await readRegular(runtimeRoot,pin.path,pin.bytes);assert.equal(SHA(bytes),pin.sha256);await put(pin.path,bytes);}
  await put('linux-runtime-descriptor.json',Buffer.from(JSON.stringify(DESCRIPTOR,null,2)+'\n'));
  await put('NOT_FOR_DISTRIBUTION.txt',Buffer.from('INERT ENGINEERING STAGING ONLY. Not an executable package or supported runtime.\n'+DESCRIPTOR.releaseBlockers.join('\n')+'\n'));
  // Project/app notices are preserved by the Windows source allowlist. Missing
  // runtime notices remain an explicit release blocker, never filled by a substitute.
  for(const row of sources)assert.deepEqual(await readRegular(sourceRoot,row.name,row.bytes.length),row.bytes);
  await verifyLinuxStagingPair({root:runtimeRoot});
  for(let i=0;i<3;i++)assert.deepEqual(await directory([sourceRoot,runtimeRoot,outputParent][i]),owners[i]);
  const manifest={schema:1,scope:'relocatable-inert-tree-not-package',platform:DESCRIPTOR.platform,arch:DESCRIPTOR.arch,distributionReady:false,usableForEncoding:false,runtimeNotices:'not-staged-unreviewed',files:inventory};
  await put('staging-inventory.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  // Read every staged artifact again after finalization; no caller-visible authority.
  for(const row of inventory){const bytes=await readRegular(destination,row.path,row.bytes);assert.equal(SHA(bytes),row.sha256);}
  return {destination,scope:manifest.scope,distributionReady:false,usableForEncoding:false,inventory};
}
module.exports={verifyLinuxStagingPair,stageLinuxInertTree};
