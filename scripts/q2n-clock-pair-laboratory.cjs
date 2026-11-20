'use strict';
// Developer-only native ownership exercise for an already-recovered, exact
// synthetic fixture pair. Never supply personal media or an active output folder.
const fs=require('node:fs/promises'), path=require('node:path'), {constants}=require('node:fs');
const a=require('node:assert/strict'), {createHash}=require('node:crypto');
const casePath='../linux-blue/qualification-tests/q2n-clock-pair.cjs';
async function main(runtimeRoot,trial,control,parent){
  const {openClockPair}=require(casePath);
  for(const f of [runtimeRoot,trial,control,parent])a.ok(typeof f==='string'&&f===path.resolve(f)&&f===await fs.realpath(f));
  for(const f of [trial,control]){const s=await fs.lstat(f);a.ok(s.isFile()&&s.size===85993336&&s.nlink===1);}
  a.notEqual(trial,control);
  const dir=await fs.mkdtemp(path.join(parent,'q2n-owner-'));await fs.chmod(dir,0o700);
  const src=path.join(dir,'trial.mov'), children=[], results=[], pids=[];
  await fs.copyFile(trial,src,constants.COPYFILE_EXCL);
  let abortNext=false,owner;
  const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
  const observe=child=>{
    a.ok(Number.isSafeInteger(child.pid)&&child.pid>0);pids.push(child.pid);children.push({...child,liveAtNotice:alive(child.pid)});
    if(abortNext){abortNext=false;setImmediate(()=>owner.cancel());}
  };
  const item=(name,evidence)=>results.push({name,...evidence});
  owner=await openClockPair(runtimeRoot,observe);
  const other=await openClockPair(runtimeRoot);
  const hold=path.join(dir,'before-replacement.mov');
  try{
    const t=await owner.prepare(src,control,'aligned'), r=await owner.requireCurrent(t);
    item('aligned bound to native pair',{window:r.window,packets:r.packets,scope:r.scope});
    a.equal(r.cleanThreadedQualification,false);a.deepEqual(Object.keys(t),[]);
    await a.rejects(other.requireCurrent(t),{code:'Q2N_CLOCK_PAIR'});await a.rejects(owner.requireCurrent({...t}),{code:'Q2N_CLOCK_PAIR'});
    item('foreign and cloned token rejected',{});
    const before=children.length;abortNext=true;
    await a.rejects(owner.prepare(src,control,'off-grid'),{code:'CANCELLED'});a.equal(children.length,before+1);
    a.ok(children.at(-1).liveAtNotice&&!alive(pids.at(-1)));await a.rejects(owner.requireCurrent(t),{code:'Q2N_CLOCK_PAIR'});
    item('cancel real ffprobe and await retirement',{cancelledOneRealProbe:true,stalePriorToken:true});
    const u=await owner.prepare(src,control,'off-grid'),v=await owner.requireCurrent(u);
    a.notEqual(t,u);item('fresh prepare after real cancellation',{window:v.window,packets:v.packets});
    await fs.rename(src,hold);await fs.copyFile(hold,src,constants.COPYFILE_EXCL);
    await a.rejects(owner.requireCurrent(u),{code:'Q2N_CLOCK_PAIR'});
    await a.rejects(owner.requireCurrent(u),{code:'Q2N_CLOCK_PAIR'});item('identical bytes at replacement inode invalidate binding',{});
    const n=children.length;await a.rejects(owner.prepare(control,src,'aligned'),{code:'Q2N_CLOCK_PAIR'});
    a.equal(n,children.length);item('trial/control reversal refused before native probe',{});
    owner.close();await a.rejects(owner.prepare(src,control,'aligned'),{code:'Q2N_CLOCK_PAIR'});item('closed owner remains closed',{});
    a.ok(pids.every(pid=>!alive(pid)));
    return {scope:'native component owner only; no product Prepare, Start, save or GPU',runtimeRoot,
      componentSha256:createHash('sha256').update(await fs.readFile(require.resolve('../linux-blue/qualification-tests/q2n-clock-pair.cjs'))).digest('hex'),
      fullOriginalSourcePairHashes:['9c8f6229c5b00c3c6646d1144ef2f8485b34f60789c0aa716debec798d13c389','21c11d41e997d1774e6d6a4be665dee8c319fc2bc5542c4fa5baec690cecbb03'],
      children,allNativeProbePidsRetired:true,results};
  }finally{owner.close();other.close();}
}
// Separate process, ordinary replacement at a deterministic late observation.
// Only the timing of a real filesystem action is instrumented, not the result
// of any file identity read, hash, tool invocation, runtime handle, or selection.
async function lateReplacement(stage,runtimeRoot,trial,control,parent) {
  a.ok(['prepare','requireCurrent'].includes(stage));
  for(const f of [runtimeRoot,trial,control,parent])a.ok(typeof f==='string'&&f===path.resolve(f)&&f===await fs.realpath(f));
  for(const f of [trial,control]){const s=await fs.lstat(f);a.ok(s.isFile()&&s.size===85993336&&s.nlink===1);}
  a.notEqual(trial,control);const dir=await fs.mkdtemp(path.join(parent,'q2n-late-'));await fs.chmod(dir,0o700);
  const src=path.join(dir,'trial.mov'),replacement=path.join(dir,'replace.mov');
  for(const f of [src,replacement])await fs.copyFile(trial,f,constants.COPYFILE_EXCL);
  const originalIno=(await fs.lstat(src,{bigint:true})).ino;
  const identity=require('../src/source-identity.cjs'),read=identity.readSourceIdentity;
  let armed=false,controlReads=0,replaced=false,totalChildren=0;
  // After the final of the existing control's actual asynchronous sparse reads:
  // 2 around full hash, then 2 more around probe/binding for prepare.
  identity.readSourceIdentity=async (...args)=>{
    const record=await read(...args);
    if(armed && args[0]===control && ++controlReads===(stage==='prepare'?4:2)) {
      await fs.rename(replacement,src);replaced=true;
      a.notEqual(originalIno,(await fs.lstat(src,{bigint:true})).ino);
    }
    return record;
  };
  let open;
  try {open=require(casePath).openClockPair;}finally{identity.readSourceIdentity=read;}
  const owner=await open(runtimeRoot,()=>totalChildren++);
  try {
    let t; if(stage==='requireCurrent')t=await owner.prepare(src,control,'aligned');
    armed=true;const action=()=>stage==='prepare'?owner.prepare(src,control,'off-grid'):owner.requireCurrent(t);
    await a.rejects(action(),{code:'Q2N_CLOCK_PAIR'});a.equal(replaced,true);
    if(t)await a.rejects(owner.requireCurrent(t),{code:'Q2N_CLOCK_PAIR'});
    armed=false;const fresh=await owner.prepare(src,control,'aligned');a.ok((await owner.requireCurrent(fresh)).packets.videoPackets===3750);
    return {scope:'native components; replacement timing instrumented, no observation values changed',stage,controlReads,replaced,totalChildren,freshAfterStale:true};
  }finally{owner.close();}
}
if(require.main===module){
  const args=process.argv.slice(2),action=args[0]==='--late-replacement'?lateReplacement(...args.slice(1)):main(...args);
  action.then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
}
