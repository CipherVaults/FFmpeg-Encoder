'use strict';
// UNEXECUTED DRAFT. Intended installed path: tests/hdr-catalog-bounded-read.test.cjs.
// Modeled synchronous FS only. No fixture mutations or native junction claim.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),RESOURCE='resources/hdr-content-configurations.json';
const SOURCE=fs.readFileSync(path.join(ROOT,'src/hdr-catalog-seals.cjs'),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture({size=16,chunk=7,growth=false,truncated=false,readError=false,heldDrift=false,namedDrift=false}={}){
  const target=path.join(ROOT,RESOURCE),fd=47,payload=Buffer.alloc(size,0x41),calls={open:0,close:0,read:0,maxBuffer:0,totalRead:0,eof:0};
  const metadata=(change={})=>({dev:1n,ino:2n,size:BigInt(size),nlink:1n,mtimeNs:3n,ctimeNs:4n,birthtimeNs:5n,
    isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,...change});
  const directory={isDirectory:()=>true,isSymbolicLink:()=>false};
  const stub=Object.create(fs);stub.realpathSync=file=>file;
  stub.lstatSync=file=>file===target?metadata(namedDrift&&calls.read?{ino:99n}:{}):directory;
  stub.openSync=file=>{assert.equal(file,target);calls.open++;return fd;};
  stub.fstatSync=selected=>{assert.equal(selected,fd);return metadata(heldDrift&&calls.read?{mtimeNs:99n}:{});};
  stub.closeSync=selected=>{assert.equal(selected,fd);calls.close++;};
  stub.readFileSync=()=>{throw new Error('unbounded readFileSync is forbidden in rawFile');};
  stub.readSync=(selected,b,offset,length,position)=>{
    assert.equal(selected,fd);assert.equal(position,calls.totalRead);calls.read++;calls.maxBuffer=Math.max(calls.maxBuffer,b.length);
    assert.equal(b.length,size+1);assert.ok(offset>=0&&length>=0&&offset+length<=b.length);
    if(readError)throw new Error('modeled bounded read failure');
    const available=size+(growth?1:0)-(truncated?1:0),count=Math.min(chunk,length,Math.max(0,available-position));
    if(count===0){calls.eof++;return 0;}
    b.fill(0x41,offset,offset+count);calls.totalRead+=count;return count;
  };
  const context={module:{exports:{}},__dirname:path.join(ROOT,'src'),Buffer,process,require:name=>name==='node:fs'?stub:require(name)};
  vm.runInNewContext(SOURCE,context);
  return {calls,payload,read:()=>context.module.exports.readHdrCatalogResource(RESOURCE,sha(payload),ROOT)};
}
test('chunked admitted bytes require a separate actual EOF and close once',()=>{
  const f=fixture();assert.deepEqual(f.read(),f.payload);assert.equal(f.calls.totalRead,16);assert.equal(f.calls.maxBuffer,17);assert.equal(f.calls.eof,1);assert.equal(f.calls.close,1);
});
test('concurrent growth consumes at most admitted size plus one and refuses',()=>{
  const f=fixture({growth:true,chunk:1000000});assert.equal(f.read(),null);assert.equal(f.calls.maxBuffer,17);assert.equal(f.calls.totalRead,17);assert.equal(f.calls.close,1);
});
test('truncation, bounded read failure and held/named drift always refuse and close',()=>{
  for(const options of [{truncated:true},{readError:true},{heldDrift:true},{namedDrift:true}]){
    const f=fixture(options);assert.equal(f.read(),null);assert.equal(f.calls.close,1);
  }
});
test('fixed JSON limit65536 is exact and65537 refuses before open or allocation',()=>{
  const exact=fixture({size:65536,chunk:8192});assert.deepEqual(exact.read(),exact.payload);assert.equal(exact.calls.maxBuffer,65537);assert.equal(exact.calls.eof,1);assert.equal(exact.calls.close,1);
  const excess=fixture({size:65537});assert.equal(excess.read(),null);assert.equal(excess.calls.open,0);assert.equal(excess.calls.read,0);assert.equal(excess.calls.close,0);
});
