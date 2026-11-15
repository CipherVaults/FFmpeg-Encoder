'use strict';
// Census-only I/O adapter. Native observers request the same exact metadata
// extents from their real read-only FileHandles. Avoid one thread-pool job per
// tiny header while auditing thousands of files; never prefetch coded bytes.
// This does not change application I/O, limits, source identities or decisions.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{performance}=require('node:perf_hooks'),{setImmediate:yieldIO}=require('node:timers/promises');
async function metadataIo(file,action){
  const selected=path.resolve(file).toLowerCase(),open=fsp.open;let yielded=performance.now();
  fsp.open=async function(name,flags,...rest){
    if(typeof name!=='string'||path.resolve(name).toLowerCase()!==selected)return open.call(this,name,flags,...rest);
    if(flags!=='r'&&flags!==fs.constants.O_RDONLY){const e=Error('Admission census may only open its source for reading.');e.code='REMUX_AUDIT_READ_ONLY';throw e;}
    let handle;
    // Node's documented Windows read-only mapping avoids a kernel read per
    // tiny header. Only requested extents enter a Buffer; no coded bytes are
    // prefetched by this adapter. Preserve ordinary read sharing if a mapping
    // cannot be opened. This is a census backend, never application I/O.
    if(process.platform==='win32'&&Number.isSafeInteger(fs.constants.UV_FS_O_FILEMAP)){
      try{handle=await open.call(this,name,fs.constants.O_RDONLY|fs.constants.UV_FS_O_FILEMAP,...rest);}
      catch(e){if(!['EINVAL','ENOTSUP','EACCES','EPERM','EBUSY'].includes(e.code))throw e;}
    }
    if(!handle)handle=await open.call(this,name,flags,...rest);
    const read=handle.read.bind(handle);
    handle.read=async function(buffer,offset,length,position){
      if(!Buffer.isBuffer(buffer)||!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||!Number.isSafeInteger(position))return read(...arguments);
      const bytesRead=fs.readSync(handle.fd,buffer,offset,length,position);
      if(performance.now()-yielded>=8){await yieldIO();yielded=performance.now();}
      return{bytesRead,buffer};
    };return handle;
  };
  try{return await action();}finally{fsp.open=open;}
}
module.exports={metadataIo};
