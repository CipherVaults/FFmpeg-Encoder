'use strict';
// Original deterministic miniature Matroska fixture: two distinct >53-bit ChapterUIDs
// and one PCM track. Neither inspecting nor clipping this file publishes any media.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {manifest,loaderGuard}=require('../linux-blue/product-linux-shell.cjs');
const {openCandidateCalibrationRuntime}=require('../linux-blue/candidate-calibration-runtime.cjs');
const {clipMatroskaProbeChapters}=require('../src/operation-chapter-probe.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function uint(n){let s=BigInt(n).toString(16);return Buffer.from(s.length%2?'0'+s:s,'hex');}
function node(id,...parts){const b=Buffer.concat(parts.map(p=>typeof p==='string'?Buffer.from(p):p)),len=b.length;
  let width=1;while(BigInt(len)>=(1n<<BigInt(width*7))-1n)width++;
  const sz=uint((1n<<BigInt(width*7))|BigInt(len));return Buffer.concat([uint(id),sz,b]);}
function chapter(id,start,end,title){return node(0xb6,node(0x73c4,uint(id)),node(0x91,uint(start)),node(0x92,uint(end)),node(0x80,node(0x85,title),node(0x437c,'eng')));}
function fixture(ids){
  const ebml=node(0x1a45dfa3,node(0x4286,uint(1)),node(0x42f7,uint(1)),node(0x42f2,uint(4)),node(0x42f3,uint(8)),node(0x4282,'matroska'),node(0x4287,uint(4)),node(0x4285,uint(2)));
  const fl=n=>{const b=Buffer.alloc(8);b.writeDoubleBE(n);return b;};
  const info=node(0x1549a966,node(0x2ad7b1,uint(1000000)),node(0x4489,fl(4000)),node(0x4d80,'Q06'),node(0x5741,'Q06'));
  const track=node(0x1654ae6b,node(0xae,node(0xd7,uint(1)),node(0x73c5,uint(1)),node(0x83,uint(2)),node(0x86,'A_PCM/INT/LIT'),node(0xe1,node(0xb5,fl(8000)),node(0x9f,uint(1)),node(0x6264,uint(16)))));
  const chapters=node(0x1043a770,node(0x45b9,node(0x45bc,uint(1)),chapter(ids[0],0,1800000000,'First'),chapter(ids[1],1800000000,4000000000,'Second')));
  const pcm=Buffer.alloc(64000);for(let i=0;i<32000;i++)pcm.writeInt16LE(i%100<50?2000:-2000,2*i);
  const cluster=node(0x1f43b675,node(0xe7,uint(0)),node(0xa3,Buffer.from([0x81,0,0,0x80]),pcm));
  return Buffer.concat([ebml,node(0x18538067,info,track,chapters,cluster)]);
}
async function main(){
  const [runtimeRoot,parent]=process.argv.slice(2);assert.equal(process.argv.length,4);assert.equal(await fs.realpath(runtimeRoot),runtimeRoot);assert.equal(await fs.realpath(parent),parent);loaderGuard();
  const dir=await fs.mkdtemp(path.join(parent,'q06-chapters-')),runtime=await openCandidateCalibrationRuntime(manifest(runtimeRoot)),run=runtime.createRunner();
  try{
    const ids=[9007199254740992n,9007199254740993n],bytes=fixture(ids),file=path.join(dir,'chapters.mkv');
    await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
    const args=['-v','error','-protocol_whitelist','file','-show_chapters','-show_format','-of','json',file];
    const read=await run(runtime.pins.ffprobe.path,args,{timeoutMs:8000,stdoutLimit:32768,stderrLimit:32768});
    assert.equal(read.exitCode,0);assert.equal(read.stderr,'');assert.deepEqual(JSON.parse(read.stdout).chapters.map(c=>c.id),[Number(ids[0]),Number(ids[0])]);
    const result=clipMatroskaProbeChapters(read.stdout,{absoluteStart:{numerator:'1',denominator:'1'},absoluteEnd:{numerator:'3',denominator:'1'}},'1/1000');
    assert.deepEqual(result.chapters.map(c=>[c.id,c.start,c.end]),[[String(ids[0]),'0','800'],[String(ids[1]),'800','2000']]);assert.deepEqual(result.clipped,[{sourceIndex:0,start:true,end:false},{sourceIndex:1,start:false,end:true}]);
    assert.deepEqual(await fs.readFile(file),bytes);await runtime.requireCurrent();
    await fs.writeFile(path.join(dir,'probe.json'),read.stdout,{flag:'wx'});const receipt={scope:'native read and component clip only; no output, cache or product operation',runtimeIdentity:runtime.runtimeIdentity,sourceSha256:hash(bytes),rawProbeSha256:hash(read.stdout),result,exitCode:read.exitCode};
    const data=JSON.stringify(receipt,null,2)+'\n';await fs.writeFile(path.join(dir,'receipt.json'),data,{flag:'wx'});console.log(JSON.stringify({dir,status:'passed',receiptSha256:hash(data)}));
  }finally{await runtime.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
