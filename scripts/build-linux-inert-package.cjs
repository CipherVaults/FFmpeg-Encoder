'use strict';
// Offline engineering builder. Never executes Electron/FFmpeg or grants runtime authority.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const PLAN = require('../resources/linux-inert-package-plan.json');
const { DESCRIPTOR } = require('../src/linux-runtime-descriptor.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const FLOOR = 27n * 1024n ** 3n;
function relative(name) {
  assert(typeof name === 'string' && name.length < 1024 && !/[\\:\x00-\x1f\x7f]/.test(name));
  assert(!name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..'));
}
function validatePlan(plan) {
  assert.equal(plan.scope, 'offline-inert-linux-product-package-proposal');
  assert.equal(plan.distributionReady, false); assert.equal(plan.usableForEncoding, false);
  assert.equal(plan.dependencyStrategy, 'exact-inspected-host-libraries-not-bundled');
  assert(plan.files.length > 0 && plan.files.length <= 1024);
  const seen = new Set(); let total = 0;
  for (const row of plan.files) {
    assert(['source', 'electron', 'inputs', 'guidance', 'hostDocs'].includes(row.root));
    relative(row.source); relative(row.target);
    assert(!/^electron\/resources\/app\.asar(?:\/|\.|$)/i.test(row.target),'Active ASAR launch paths are forbidden.');
    assert(!seen.has(row.target.toLowerCase())); seen.add(row.target.toLowerCase());
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 256 * 1024 * 1024);
    assert(/^[a-f0-9]{64}$/.test(row.sha256)); total += row.bytes;
    assert(row.target.startsWith(row.group === 'application' ? 'electron/resources/app/' : 'electron/'));
  }
  assert(total <= 768 * 1024 * 1024);
  for (const name of seen) for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) assert(!seen.has(parent));
  return total;
}
async function directory(root) {
  assert(typeof root === 'string' && path.isAbsolute(root) && path.resolve(root) === root);
  assert.equal(await fs.realpath(root), root);
  const st = await fs.lstat(root); assert(st.isDirectory() && !st.isSymbolicLink());
  return [st.dev, st.ino, st.birthtimeMs];
}
const stamp = s => [s.dev,s.ino,s.nlink,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs];
async function transfer(root, row, output) {
  let dir = root; await directory(dir);
  for (const part of row.source.split('/').slice(0,-1)) { dir = path.join(dir,part); await directory(dir); }
  const file = path.join(root,...row.source.split('/'));
  const before = await fs.lstat(file); assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size === row.bytes);
  const fd = await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let dest; const hash = createHash('sha256'); let total = 0;
  try {
    assert.deepEqual(stamp(await fd.stat()),stamp(before));
    if (output) dest = await fs.open(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
    const buffer = Buffer.alloc(1024*1024);
    while (true) {
      const { bytesRead } = await fd.read(buffer,0,buffer.length,null); if (!bytesRead) break;
      total += bytesRead; assert(total <= row.bytes); const bytes = buffer.subarray(0,bytesRead); hash.update(bytes);
      if (dest) { let offset = 0; while(offset < bytesRead) { const write = await dest.write(bytes,offset,bytesRead-offset,null); assert(write.bytesWritten > 0); offset += write.bytesWritten; } }
    }
    assert.equal(total,row.bytes); assert.equal(hash.digest('hex'),row.sha256);
    assert.deepEqual(stamp(await fd.stat()),stamp(before)); assert.deepEqual(stamp(await fs.lstat(file)),stamp(before));
    assert.equal(await fs.realpath(file),file); if(dest)await dest.sync();
  } finally { await dest?.close(); await fd.close(); }
}
async function verifyGeneratedAsar(asar, archive, rows) {
  const before=await fs.lstat(archive); const cap=rows.reduce((n,r)=>n+r.bytes,0)+64*1024*1024;
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink===1 && before.size<=cap);
  const expected = new Set();
  for (const row of rows) {
    const member = row.target.slice(23); relative(member); expected.add(member);
    for (let parent = path.posix.dirname(member); parent !== '.'; parent = path.posix.dirname(parent)) expected.add(parent);
  }
  const actual = asar.listPackage(archive).map(name => name.replaceAll('\\','/').replace(/^\//,''));
  assert.equal(new Set(actual).size,actual.length,'Duplicate ASAR members');
  assert.deepEqual(actual.slice().sort(),[...expected].sort(),'ASAR member set differs from pinned application closure');
  for (const member of actual) {
    relative(member); const stat = asar.statFile(archive,member,false);
    assert(!stat.link && !stat.unpacked,'Linked/unpacked ASAR member');
  }
  for (const row of rows) {
    const member=row.target.slice(23), bytes=asar.extractFile(archive,member);
    assert.equal(bytes.length,row.bytes); assert.equal(digest(bytes),row.sha256);
  }
  assert.deepEqual(stamp(await fs.lstat(archive)),stamp(before));
  const fd=await fs.open(archive,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const hash=createHash('sha256');let total=0;
  try {
    assert.deepEqual(stamp(await fd.stat()),stamp(before));const buffer=Buffer.alloc(1024*1024);
    while(true){const {bytesRead}=await fd.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;assert(total<=before.size);hash.update(buffer.subarray(0,bytesRead));}
    assert.equal(total,before.size);assert.deepEqual(stamp(await fd.stat()),stamp(before));assert.deepEqual(stamp(await fs.lstat(archive)),stamp(before));assert.equal(await fs.realpath(archive),archive);
    return {path:'audit/app.asar',bytes:total,sha256:hash.digest('hex'),group:'generated-archive'};
  } finally { await fd.close(); }
}
async function buildLinuxInertPackage(options) {
  assert(options && Object.getPrototypeOf(options) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(options).sort(),['outputParent','roots']);
  for(const key of Reflect.ownKeys(options)) assert(Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value'));
  const { roots,outputParent } = options;
  assert(roots && Object.getPrototypeOf(roots)===Object.prototype);
  assert.deepEqual(Reflect.ownKeys(roots).sort(),['electron','guidance','hostDocs','inputs','source']);
  for(const key of Reflect.ownKeys(roots)) assert(Object.hasOwn(Object.getOwnPropertyDescriptor(roots,key),'value'));
  assert.equal(process.platform,'linux'); assert.equal(process.arch,'x64');
  const total = validatePlan(PLAN), owners = {};
  for(const pin of DESCRIPTOR.files) {
    const row=PLAN.files.find(row=>row.target==='electron/resources/'+pin.path);
    assert(row && row.bytes===pin.bytes && row.sha256===pin.sha256,'Exact approved Linux pair required.');
  }
  for (const [key,root] of Object.entries(roots)) { owners[key]=await directory(root); assert(outputParent!==root && !outputParent.startsWith(root+path.sep)); }
  const parentOwner=await directory(outputParent);
  const space=await fs.statfs(outputParent,{bigint:true});
  assert(space.bavail*space.bsize >= FLOOR+BigInt(total*2+64*1024*1024),'Preserve 27 GiB plus admitted staging and ASAR bytes.');
  // Verify every input before creating an output; no fallback/download exists.
  for(const row of PLAN.files) await transfer(roots[row.root],row);
  const destination=await fs.mkdtemp(path.join(outputParent,'linux-inert-package-')),owner=await directory(destination);
  for (const row of PLAN.files) {
    assert.deepEqual(await directory(destination),owner);
    let dir=destination;
    for(const part of row.target.split('/').slice(0,-1)) {dir=path.join(dir,part);try{await fs.mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await directory(dir);}
    await transfer(roots[row.root],row,path.join(destination,...row.target.split('/')));
    await transfer(destination,{...row,source:row.target});
  }
  // Existing approved tooling only; import creates an archive, not a runtime.
  const asarEntry=require.resolve('@electron/asar');
  const toolPackage=JSON.parse(await fs.readFile(path.join(path.dirname(asarEntry),'..','package.json'),'utf8'));
  assert.equal(toolPackage.version,PLAN.asarVersion);
  assert.equal(PLAN.asarVersion,'4.3.0');
  const asar=await import(pathToFileURL(asarEntry).href);
  // Physical launch tree preserves retained-handle inode/stat semantics.
  const launchRoot=path.join(destination,'electron/resources/app');
  const auditRoot=path.join(destination,'audit');await fs.mkdir(auditRoot,{mode:0o700});
  const archive=path.join(auditRoot,'app.asar');
  await asar.createPackage(launchRoot,archive);
  await assert.rejects(fs.lstat(path.join(destination,'electron/resources/app.asar')), {code:'ENOENT'});
  await assert.rejects(fs.lstat(path.join(destination,'electron/resources/app.asar.unpacked')), {code:'ENOENT'});
  await fs.chmod(archive,0o600);
  const generatedArchive=await verifyGeneratedAsar(asar,archive,PLAN.files.filter(row=>row.group==='application'));
  for(const [key,root] of Object.entries(roots))assert.deepEqual(await directory(root),owners[key]);
  assert.deepEqual(await directory(outputParent),parentOwner);assert.deepEqual(await directory(destination),owner);
  const receipt={schema:1,scope:PLAN.scope,distributionReady:false,usableForEncoding:false,dependencyStrategy:PLAN.dependencyStrategy,
    releaseBlockers:PLAN.releaseBlockers,files:[...PLAN.files.map(({target,bytes,sha256,group})=>({path:target,bytes,sha256,group})),generatedArchive],
    asarSourceFiles:PLAN.files.filter(x=>x.group==='application').length};
  await fs.writeFile(path.join(destination,'INERT_PACKAGE_INVENTORY.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(destination,'NOT_FOR_DISTRIBUTION.txt'),PLAN.releaseBlockers.join('\n')+'\n',{flag:'wx',mode:0o600});
  return {destination,...receipt};
}
module.exports={buildLinuxInertPackage,validatePlan,verifyGeneratedAsar};
