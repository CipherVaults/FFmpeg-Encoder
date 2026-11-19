'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
function deadline(milliseconds,clock=()=>process.hrtime.bigint()){
 const end=clock()+BigInt(milliseconds)*1000000n;
 return ()=>assert(clock()<end,'Authoritative monotonic deadline expired');
}
async function ownedGuard(parent,uid=process.getuid()){
 const identities=new Map();
 async function ordinary(directory){
  assert(path.isAbsolute(directory)&&path.resolve(directory)===directory,'Canonical directory required');
  let current=directory;while(true){const st=await fs.lstat(current);assert(st.isDirectory()&&!st.isSymbolicLink(),'Linked or non-directory ancestor');const next=path.dirname(current);if(next===current)break;current=next;}
  assert.equal(await fs.realpath(directory),directory,'Canonical directory changed');
  const st=await fs.lstat(directory,{bigint:true});assert.equal(st.uid,BigInt(uid),'Directory owner changed');return st;
 }
 async function bind(directory){const st=await ordinary(directory);assert(!identities.has(directory));identities.set(directory,{dev:st.dev,ino:st.ino});}
 async function check(){for(const [directory,id] of identities){const st=await ordinary(directory);assert.equal(st.dev,id.dev,'Directory device changed');assert.equal(st.ino,id.ino,'Directory identity changed');}}
 await bind(parent);return {bind,check};
}
module.exports={deadline,ownedGuard};
