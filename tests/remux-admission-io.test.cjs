'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {metadataIo}=require('../scripts/v07-remux-admission-io.cjs');
test('census metadata adapter reads actual requested bytes without prefetch and always restores the opener',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'remux-admission-io-')),file=path.join(dir,'owned');t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^remux-admission-io-/);await fs.rm(dir,{recursive:true});});
  await fs.writeFile(file,'0123456789');const open=fs.open,read=sync.readSync,requests=[],mock=t.mock.method(sync,'readSync',(...args)=>{requests.push(args.slice(2));return read(...args);});
  try{await metadataIo(file,async()=>{const h=await fs.open(file,'r');try{const b=Buffer.alloc(3),r=await h.read(b,0,3,2);assert.equal(r.bytesRead,3);assert.equal(b.toString(),'234');}finally{await h.close();}});}finally{mock.mock.restore();}
  assert.deepEqual(requests,[[0,3,2]]);assert.equal(fs.open,open);await assert.rejects(metadataIo(file,async()=>{throw Error('controlled callback failure');}),/controlled callback/);assert.equal(fs.open,open);
  for(const flag of ['w','a','r+'])await assert.rejects(metadataIo(file,()=>fs.open(file,flag)),{code:'REMUX_AUDIT_READ_ONLY'});
  assert.equal(await fs.readFile(file,'utf8'),'0123456789');assert.equal(fs.open,open);
});

test('read-only mapping falls back to the original read-only open on sharing failure without changing source bytes',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'remux-admission-io-')),file=path.join(dir,'owned');t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^remux-admission-io-/);await fs.rm(dir,{recursive:true});});
  await fs.writeFile(file,'source');const open=fs.open,flags=[],mock=t.mock.method(fs,'open',async(name,mode,...rest)=>{flags.push(mode);if(mode===sync.constants.UV_FS_O_FILEMAP){const e=Error('controlled mapping sharing failure');e.code='EBUSY';throw e;}return open(name,mode,...rest);});
  try{await metadataIo(file,async()=>{const h=await fs.open(file,'r');try{const b=Buffer.alloc(6);await h.read(b,0,6,0);assert.equal(b.toString(),'source');}finally{await h.close();}});}finally{mock.mock.restore();}
  assert.deepEqual(flags,process.platform==='win32'&&Number.isSafeInteger(sync.constants.UV_FS_O_FILEMAP)?[sync.constants.UV_FS_O_FILEMAP,'r']:['r']);
  assert.equal(await fs.readFile(file,'utf8'),'source');assert.equal(fs.open,open);
  let attempts=0;const fault=t.mock.method(fs,'open',async()=>{attempts++;const e=Error('controlled hard read failure');e.code='EIO';throw e;});
  try{await assert.rejects(metadataIo(file,()=>fs.open(file,'r')),{code:'EIO'});assert.equal(attempts,1);}finally{fault.mock.restore();}
  assert.equal(fs.open,open);assert.equal(await fs.readFile(file,'utf8'),'source');
});
