'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const workspace=path.resolve(__dirname,'..');
// These are the API entry modules, not a list of implementation dependencies.
// Edges below come only from modules Node actually loaded, including lazy
// children discovered while executing an admission. Never execute cache paths.
const entryNames=['remux-native-checks.cjs','remux-edit-lists.cjs','remux-contract.cjs','remux-operation.cjs','remux-transport.cjs'];
const runtime=()=>JSON.stringify({node:process.version,uv:process.versions.uv,platform:process.platform,arch:process.arch});
const within=(file,root)=>{const relative=path.relative(root,file);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function loadedFiles(entries){const seen=new Map();function visit(id){const module=require.cache[id];if(!module||seen.has(id))return;seen.set(id,module);for(const child of module.children)visit(child.filename);}for(const id of entries)visit(id);return [...seen.keys()].sort();}
const digest=files=>createHash('sha256').update(runtime()).update(JSON.stringify(files)).digest('hex');
async function graphBinding(entries,roots){
  const files=[];for(const file of loadedFiles(entries)){
    if(!roots.some(root=>within(file,root)))throw Error('Loaded dependency is outside the implementation roots: '+file);
    files.push({file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
  }return{version:3,runtime:runtime(),entries:[...entries].sort(),files,digest:digest(files)};
}
async function bindingMatches(saved,entries,roots){
  if(saved?.version!==3||saved.runtime!==runtime()||!Array.isArray(saved.files)||!Array.isArray(saved.entries)
    ||entries.some(file=>!saved.entries.includes(file)))return false;
  try{const files=[],seen=new Set();for(const item of saved.files){
    if(typeof item.file!=='string'||!path.isAbsolute(item.file)||!roots.some(root=>within(item.file,root))||seen.has(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256||''))return false;
    seen.add(item.file);files.push({file:item.file,sha256:createHash('sha256').update(await fs.readFile(item.file)).digest('hex')});
  }
  if(entries.some(file=>!seen.has(file))||loadedFiles(entries).some(file=>!seen.has(file)))return false;
  return digest(files)===saved.digest;
  }catch{return false;}
}
async function implementation(root,caller){
  root=path.resolve(root);const ids=entryNames.map(name=>require.resolve(path.join(root,'src',name))),api=Object.assign({},...ids.map(id=>require(id)));
  const entries=[...ids,__filename,...(caller?[caller.filename]:[])],roots=[root,workspace];let binding=await graphBinding(entries,roots);
  return{api,get digest(){return binding.digest;},get binding(){return binding;},async refresh(){
    const next=await graphBinding(entries,roots),previous=new Map(binding.files.map(f=>[f.file,f.sha256]));
    for(const f of next.files)if(previous.has(f.file)&&previous.get(f.file)!==f.sha256)throw Error('Implementation changed during admission: '+f.file);
    binding=next;return binding;
  },matches:saved=>bindingMatches(saved,entries,roots)};
}
module.exports={implementation,graphBinding,bindingMatches,loadedFiles};
