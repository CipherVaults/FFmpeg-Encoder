'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),p=require('node:path');
const {createStage,cleanupStage,describeFreshServiceStage}=require('../src/outputs.cjs');
const {readSourceIdentity}=require('../src/source-identity.cjs');
const {observePreparedCustody}=require('../linux-blue/product-two-aac-custody.cjs');
const ordinary={skip:process.platform!=='linux'};
async function observed(source,output){
 const stamp=async n=>{const s=await fs.lstat(n,{bigint:true});return Object.fromEntries(['dev','ino','birthtimeNs','mtimeNs','ctimeNs','size','nlink'].map(k=>[k,String(s[k])]));};
 const si=await stamp(source),oi=await stamp(output);return {sourcePath:source,outputPath:output,sourceBefore:si,sourceAfter:si,outputBefore:oi,outputAfter:oi};
}

async function setup(t){
 const top=await fs.mkdtemp(p.join(os.tmpdir(),'q2l-custody-'));t.after(()=>fs.rm(top,{recursive:true,force:true}));
 const input=p.join(top,'in'),output=p.join(top,'out');await fs.mkdir(input);await fs.mkdir(output);
 const source=p.join(input,'source.mp4'),destination=p.join(output,'target.mp4');await fs.writeFile(source,'ordinary guard-only sample',{flag:'wx'});
 const sourceIdentity=await readSourceIdentity(source),folderIdentities={input:await fs.stat(input,{bigint:true}),output:await fs.stat(output,{bigint:true})};
 let active=true;const args={source,sourceIdentity,input,output,destination,folderIdentities,maxOutputBytes:1024,requireOwner(){if(!active)throw Error('Owner retired.');}};
 const take=()=>{const l=observePreparedCustody(args);t.after(()=>l.close());return l;};return {args,top,input,output,source,destination,sourceIdentity,retire:()=>{active=false;},take};
}
test('real shared stage is distinct, selected, bounded and single-use; a guard grants no write or route',ordinary,async t=>{
 const w=await setup(t),g=w.take(),s=await createStage(w.output);g.current();g.claim(s);g.invocation(s.file);
 await fs.writeFile(s.file,'guard-only test',{flag:'wx'});g.beforeValidation();g.matchReceipt(await observed(w.source,s.file));g.verified();g.beforePublish();g.close();
 a.throws(()=>g.current(),{code:'REMUX_OPERATION_STALE'});a.deepEqual(await fs.readdir(w.output),[p.basename(s.directory)]);
});
test('a lookalike or genuine stage in another registered folder cannot bind',ordinary,async t=>{
 const w=await setup(t),fakeDir=await fs.mkdtemp(p.join(w.output,'.ffmpeg-encoder-')),fake=Object.freeze({directory:fakeDir,file:p.join(fakeDir,'encoded.mkv')});
 a.throws(()=>w.take().claim(fake),{code:'REMUX_OPERATION_STALE'});const unrelated=await createStage(w.input);
 a.throws(()=>w.take().claim(unrelated),{code:'REMUX_OPERATION_STALE'});a.equal((await cleanupStage(unrelated)).retained,false);
 a.throws(()=>describeFreshServiceStage(unrelated,w.input),{code:'INVALID_STAGE'});
});
test('same-byte input replacement invalidates the prepared file; repeated check stays stale',ordinary,async t=>{
 const w=await setup(t),g=w.take(),retained=w.source+'.retained';await fs.rename(w.source,retained);await fs.copyFile(retained,w.source);
 for(let i=0;i<2;i++)a.throws(()=>g.current(),{code:'REMUX_OPERATION_STALE'});a.deepEqual(await fs.readdir(w.output),[]);
});
test('late output collision is retained and cannot acquire an invocation',ordinary,async t=>{
 const w=await setup(t),g=w.take(),s=await createStage(w.output);g.claim(s);await fs.writeFile(w.destination,'retained',{flag:'wx'});
 a.throws(()=>g.invocation(s.file),{code:'REMUX_OPERATION_STALE'});a.equal(await fs.readFile(w.destination,'utf8'),'retained');a.equal((await cleanupStage(s)).retained,false);
});
test('replaced stage file after verification or changed current registered root refuses final publication',ordinary,async t=>{
 const w=await setup(t),g=w.take(),s=await createStage(w.output);g.claim(s);g.invocation(s.file);
 await fs.writeFile(s.file,'stage',{flag:'wx'});g.beforeValidation();g.matchReceipt(await observed(w.source,s.file));g.verified();await fs.rename(s.file,s.file+'.previous');await fs.writeFile(s.file,'stage',{flag:'wx'});
 a.throws(()=>g.beforePublish(),{code:'REMUX_OPERATION_STALE'});const after=w.take();await fs.rename(w.output,w.output+'.previous');await fs.mkdir(w.output);
 a.throws(()=>after.current(),{code:'REMUX_OPERATION_STALE'});
});
test('generation retirement and oversized output both fail closed without deleting media',ordinary,async t=>{
 const w=await setup(t),gone=w.take(),g=w.take(),s=await createStage(w.output);g.claim(s);g.invocation(s.file);
 await fs.writeFile(s.file,Buffer.alloc(1025),{flag:'wx'});a.throws(()=>g.beforeValidation(),{code:'REMUX_OPERATION_STALE'});w.retire();
 a.throws(()=>gone.current(),{code:'REMUX_OPERATION_STALE'});a.equal((await fs.stat(s.file)).size,1025);
});
test('same-sized receipt from another ordinary file cannot seal the actual stage observation',ordinary,async t=>{
 const w=await setup(t),g=w.take(),s=await createStage(w.output);g.claim(s);g.invocation(s.file);
 await fs.writeFile(s.file,'stage',{flag:'wx'});const other=p.join(w.top,'another.mp4');await fs.writeFile(other,'stage',{flag:'wx'});
 g.beforeValidation();const wrong=await observed(w.source,other);a.throws(()=>g.matchReceipt(wrong),{code:'REMUX_OPERATION_STALE'});
 a.throws(()=>g.beforePublish(),{code:'REMUX_OPERATION_STALE'});
});
test('regular file handles use nonblocking no-follow opening and a directory named as a file is refused before open',ordinary,async t=>{
 const w=await setup(t),f=require('node:fs'),open=f.openSync,seen=[];
 t.mock.method(f,'openSync',function(name,flags,...rest){if(name===w.source)seen.push(flags);return Reflect.apply(open,this,[name,flags,...rest]);});
 const g=w.take();g.close();a.equal(seen.length,1);a.equal(seen[0]&f.constants.O_NOFOLLOW,f.constants.O_NOFOLLOW);
 a.equal(seen[0]&f.constants.O_NONBLOCK,f.constants.O_NONBLOCK);
 await fs.rename(w.source,w.source+'.retained');await fs.mkdir(w.source);a.throws(()=>w.take(),{code:'REMUX_OPERATION_STALE'});a.equal(seen.length,1);
});

// Regression from the ordinary 9.0.2 MP4 mux with use_metadata_tags. This is
// only a bounded header observation on a genuine custody handle, not a media
// receipt, a real ffprobe run, or permission to run/publish.
const {matchesTwoAacStageContainer}=require('../linux-blue/product-two-aac-custody.cjs');
const stagePrefix=Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431','hex');
const observedTags=(twice)=>Object.fromEntries(Object.entries({major_brand:'isom',minor_version:'512',compatible_brands:'isomiso2avc1mp41'}).map(([k,v])=>[k,twice?v+';'+v:v]));
const probeOf=(tags)=>({format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',tags}});
async function observedStage(t,bytes){const w=await setup(t),g=w.take(),s=await createStage(w.output);g.claim(s);g.invocation(s.file);
 await fs.writeFile(s.file,bytes,{flag:'wx'});g.beforeValidation();
 return {w,g,s,r:{...await observed(w.source,s.file),sourcePath:w.source,outputPath:s.file}};}
test('pinned physical MP4 corroborates single and mux-duplicated identical field summaries; inconsistent or unmeasured representations do not pass',ordinary,async(t)=>{
 const {g,r}=await observedStage(t,stagePrefix);
 for(const twice of [false,true])a.equal(matchesTwoAacStageContainer(g,r,probeOf(observedTags(twice))),true);
 for(const tags of [{...observedTags(true),major_brand:'isom;qt  '},{...observedTags(true),major_brand:'isom;isom;isom'},
  {...observedTags(true),minor_version:'512'}, {...observedTags(false),compatible_brands:'isomiso2mp41'},
  {...observedTags(true),major_brand:'isom;ISOM'}, {...observedTags(false),major_brand:'qt  '}])
   a.equal(matchesTwoAacStageContainer(g,r,probeOf(tags)),false);
 a.equal(matchesTwoAacStageContainer(g,r,{format:{format_name:'matroska',tags:observedTags(true)}}),false);
 g.close();a.throws(()=>matchesTwoAacStageContainer(g,r,probeOf(observedTags(true))),{code:'REMUX_OPERATION_STALE'});
});
test('a duplicated MP4 summary cannot validate a short, MOV or physically different file type, unrelated stage or plain custody token',ordinary,async(t)=>{
 const tags=probeOf(observedTags(true));
 for(const bytes of [stagePrefix.subarray(0,13),Buffer.concat([stagePrefix.subarray(0,8),Buffer.from('qt  '),stagePrefix.subarray(12)]),Buffer.from(stagePrefix).fill(0x70,24,28)]){
  const {g,r}=await observedStage(t,bytes);a.equal(matchesTwoAacStageContainer(g,r,tags),false);
 }
 const {g,s,r}=await observedStage(t,stagePrefix);
 a.equal(matchesTwoAacStageContainer(g,r,{format:{format_name:'matroska,mp4',tags:observedTags(true)}}),false);
 a.throws(()=>matchesTwoAacStageContainer({},r,tags),{code:'REMUX_OPERATION_STALE'});
 a.throws(()=>matchesTwoAacStageContainer(g,{...r,outputPath:s.file+'.elsewhere'},tags),{code:'REMUX_OPERATION_STALE'});
});
test('current file-type observation cannot be used after the ordinary same-byte output has been replaced',ordinary,async(t)=>{
 const {g,s,r}=await observedStage(t,stagePrefix);await fs.rename(s.file,s.file+'.original');await fs.writeFile(s.file,stagePrefix,{flag:'wx'});
 a.throws(()=>matchesTwoAacStageContainer(g,r,probeOf(observedTags(true))),{code:'REMUX_OPERATION_STALE'});
});
