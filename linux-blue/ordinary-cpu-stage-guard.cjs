'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {POLICY}=require('./ordinary-cpu-policy.cjs');
const fail=code=>Object.assign(new Error('Ordinary candidate storage/ownership check refused.'),{code});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
async function openOrdinaryStageGuard({outputDirectory,signal},{io=fs}={}){
  const controller=new AbortController();let stage=null,dirIdentity=null,fileIdentity=null,failure=null,timer=null,pending=Promise.resolve(),closed=false,polling=false;
  const outputIdentity=await io.lstat(outputDirectory,{bigint:true});
  if(!outputIdentity.isDirectory()||outputIdentity.isSymbolicLink()||await io.realpath(outputDirectory)!==outputDirectory)throw fail('ORDINARY_OUTPUT_DIRECTORY');
  async function check(){
    if(failure)throw failure;
    if(signal?.aborted)throw fail('CANCELLED');
    const root=await io.lstat(outputDirectory,{bigint:true});if(!same(root,outputIdentity)||!root.isDirectory()||root.isSymbolicLink()||await io.realpath(outputDirectory)!==outputDirectory)throw fail('ORDINARY_OUTPUT_DIRECTORY');
    const free=await io.statfs(outputDirectory,{bigint:true});if(typeof free.bavail!=='bigint'||typeof free.bsize!=='bigint'||free.bavail<0n||free.bsize<=0n||free.bavail*free.bsize<POLICY.floorBytes+(stage?0n:POLICY.headroomBytes))throw fail('ORDINARY_STORAGE_FLOOR');
    if(stage){const d=await io.lstat(stage.directory,{bigint:true});if(!same(d,dirIdentity)||!d.isDirectory()||d.isSymbolicLink()||await io.realpath(stage.directory)!==stage.directory)throw fail('ORDINARY_STAGE_DIRECTORY');
      let st;try{st=await io.lstat(stage.file,{bigint:true});}catch(e){if(e.code!=='ENOENT'||fileIdentity)throw e;return;}
      if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||st.size>POLICY.headroomBytes||(fileIdentity&&!same(st,fileIdentity)))throw fail('ORDINARY_STAGE_GROWTH');fileIdentity||=st;
    }
  }
  const stop=async()=>{clearInterval(timer);timer=null;await pending;};
  await check();
  return Object.freeze({signal:controller.signal,
    async onStage(value){if(closed||stage||!value||!Object.isFrozen(value)||path.dirname(value.directory)!==outputDirectory||path.dirname(value.file)!==value.directory)throw fail('ORDINARY_STAGE_OWNER');stage=value;dirIdentity=await io.lstat(stage.directory,{bigint:true});await check();timer=setInterval(()=>{if(polling)return;polling=true;pending=check().catch(error=>{failure||=error;controller.abort();}).finally(()=>{polling=false;});},POLICY.monitorMs);timer.unref();},
    async beforePublish(value){if(closed||!stage||value!==stage)throw fail('ORDINARY_STAGE_OWNER');await stop();await check();if(!fileIdentity)throw fail('ORDINARY_STAGE_ABSENT');if(signal?.aborted)throw fail('CANCELLED');},
    async close(){if(closed)return;closed=true;await stop();if(failure)throw failure;}
  });
}
module.exports={openOrdinaryStageGuard};
