'use strict';
// Main-process custody for a single prepared Linux two-AAC development job.
// A custody object can deny further work; it is never a route, media receipt,
// selection or permission to publish. No test fixtures, release marker or IPC.
const fs=require('node:fs'),path=require('node:path');
const {ToolError}=require('../src/process-runner.cjs');
const {describeFreshServiceStage}=require('../src/outputs.cjs');
const opt={bigint:true},all=['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs'],dirKeys=['dev','ino','birthtimeNs'];
function deny(message){throw new ToolError('REMUX_OPERATION_STALE',message);}
function need(x,message){if(!x)deny(message);}
const shared='Prepared source, selected folder or owned stage changed. Prepare this file again.';
const named=p=>fs.lstatSync(p,opt),opened=fd=>fs.fstatSync(fd,opt);
const eq=(x,y,keys)=>keys.every(k=>String(x[k])===String(y[k]));
const missing=p=>{try{named(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
function ordinary(p){return typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p&&p!==path.parse(p).root&&!/[\0\r\n]/.test(p);}
function inspect(p,fd,kind,fields,expected){
  const a=named(p),b=opened(fd);need(fs.realpathSync.native(p)===p,shared);const c=named(p);
  need(a.dev!==0n&&a.ino!==0n&&eq(a,b,fields)&&eq(b,c,fields)&&eq(b,expected,fields)
    &&(kind==='directory' ? b.isDirectory() : b.isFile()&&b.nlink===1n),shared);
  return b;
}
function observePreparedCustody({source,sourceIdentity,input,output,destination,folderIdentities,maxOutputBytes,requireOwner}){
  const handles=[];let live=true,phase,stage,file;
  const open=(p,directory)=>{
    // A directory or other non-regular name cannot enter the file-open path.
    // Recheck the opened descriptor against the observed name: O_NONBLOCK and
    // O_NOFOLLOW also bound the intervening replacement race on Linux.
    const before=named(p),kind=directory?'directory':'file',keys=directory?dirKeys:all;
    need((directory?before.isDirectory():before.isFile()&&before.nlink===1n)
      &&fs.realpathSync.native(p)===p&&Number.isSafeInteger(fs.constants.O_NONBLOCK)&&fs.constants.O_NONBLOCK>0,shared);
    const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK|(directory?fs.constants.O_DIRECTORY:0));
    handles.push(fd);inspect(p,fd,kind,keys,before);return fd;
  };
  const close=()=>{live=false;const errors=[];while(handles.length){try{fs.closeSync(handles.pop());}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Two-track custody close failed.');};
  const guarded=fn=>{try{return fn();}catch(e){live=false;if(e?.code==='REMUX_OPERATION_STALE')throw e;throw new ToolError('REMUX_OPERATION_STALE',shared,{cause:e});}};
  try{
    need(process.platform==='linux'&&[source,input,output,destination].every(ordinary)&&sourceIdentity?.canonicalPath===source
      &&path.dirname(source)===input&&path.dirname(destination)===output&&input!==output&&source!==destination
      &&Number.isSafeInteger(maxOutputBytes)&&maxOutputBytes>0&&typeof requireOwner==='function',shared);
    const idir=open(input,true),odir=open(output,true),src=open(source,false);
    const check=()=>{need(live,shared);requireOwner();
      inspect(input,idir,'directory',dirKeys,folderIdentities.input);inspect(output,odir,'directory',dirKeys,folderIdentities.output);
      inspect(source,src,'file',all,sourceIdentity);
      if(stage)inspect(stage.directory,stage.dirFd,'directory',dirKeys,stage.identity);
      if(file)inspect(stage.file,file.fd,'file',all,file.identity);
    };
    guarded(check);
    return Object.freeze({
      current(){return guarded(check);},
      claim(actual){return guarded(()=>{check();need(!stage&&!file,shared);
        const owned=describeFreshServiceStage(actual,output);
        need(actual.file!==destination&&actual.file!==source&&path.dirname(actual.file)===actual.directory
          &&path.basename(actual.file)==='encoded.mkv'&&path.dirname(actual.directory)===output,shared);
        const fd=open(actual.directory,true);inspect(actual.directory,fd,'directory',dirKeys,owned);
        need(missing(actual.file)&&missing(destination)&&fs.readdirSync(actual.directory).length===0,shared);
        stage={object:actual,directory:actual.directory,file:actual.file,dirFd:fd,identity:owned};check();
      });},
      invocation(proposed){return guarded(()=>{check();need(stage&&!phase&&stage.file===proposed&&missing(proposed)&&missing(destination),shared);phase='started';});},
      beforeValidation(){return guarded(()=>{check();need(phase==='started'&&!file&&missing(destination),shared);
        const fd=open(stage.file,false),identity=opened(fd);need(identity.isFile()&&identity.nlink===1n&&identity.size>0n
          &&identity.size<=BigInt(maxOutputBytes)&&!eq(identity,sourceIdentity,['dev','ino']),shared);
        inspect(stage.file,fd,'file',all,identity);file={fd,identity};phase='validating';check();
      });},
      matchReceipt(receipt){return guarded(()=>{check();need(phase==='validating'&&file
        &&[receipt?.sourceBefore,receipt?.sourceAfter].every(x=>x?.nlink==='1'&&eq(x,sourceIdentity,all))
        &&[receipt?.outputBefore,receipt?.outputAfter].every(x=>x?.nlink==='1'&&eq(x,file.identity,all)),shared);phase='observed';});},
      verified(){return guarded(()=>{check();need(phase==='observed',shared);phase='validated';});},
      beforePublish(){return guarded(()=>{check();need(phase==='validated'&&missing(destination),shared);});},
      close
    });
  }catch(e){try{close();}catch(c){throw new AggregateError([e,c],'Two-track open and custody closure failed.');}if(e?.code==='REMUX_OPERATION_STALE')throw e;throw new ToolError('REMUX_OPERATION_STALE',shared,{cause:e});}
}
module.exports=Object.freeze({observePreparedCustody});
