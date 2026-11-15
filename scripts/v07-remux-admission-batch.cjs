'use strict';
// Read-only, resumable comparison against the original work-11 implementation.
// Each saved decision binds the source identity, probe and implementation bytes.
const fs=require('node:fs/promises'),path=require('node:path');
const {sources,admission}=require('./v07-remux-admission-audit.cjs');
const {runTool}=require('../src/process-runner.cjs');
const {resolveCandidateRuntime}=require('../src/candidate-runtime.cjs');
const {metadataIo}=require('./v07-remux-admission-io.cjs');
const implementation=root=>require('./v07-remux-implementation.cjs').implementation(root,module);
async function identity(file){const s=await fs.stat(file,{bigint:true});return Object.fromEntries(['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));}
function partition(files,shard){
  if(shard===undefined)return files;
  const match=typeof shard==='string'&&/^([0-3])\/([1-4])$/.exec(shard);
  if(!match||Number(match[1])>=Number(match[2]))throw Error('Admission shard must be index/count with 0 <= index < count <= 4.');
  return files.filter((_,index)=>index%Number(match[2])===Number(match[1]));
}
function selected(files){if(!Array.isArray(files)||files.length<1||files.length>30||new Set(files).size!==files.length||files.some(f=>typeof f!=='string'||!path.isAbsolute(f)))throw Error('Focused admission requires 1..30 distinct absolute file paths.');return files;}
async function batch(log,beforeRoot,candidateRoot=path.resolve(__dirname,'..'),shard,selectedFiles){
  partition([],shard); // Refuse invalid scheduling before any file/tool I/O.
  if(selectedFiles!==undefined)selected(selectedFiles);
  const a=await implementation(beforeRoot),b=candidateRoot==='-'?null:await implementation(candidateRoot),oldLines=(await fs.readFile(log,'utf8')).split('\n'),saved=new Map();
  for(const line of oldLines)if(line.startsWith('ADMISSION_BATCH_ROW ')){const r=JSON.parse(line.slice(20));saved.set(r.file,r);}
  const ffprobe=resolveCandidateRuntime({root:path.resolve(__dirname,'..')}).ffprobe,rows=[];
  const ordered=await Promise.all((selectedFiles??await sources()).map(async file=>({file,size:BigInt((await identity(file)).size)})));ordered.sort((x,y)=>x.size<y.size?-1:x.size>y.size?1:x.file.localeCompare(y.file));
  for(const {file} of partition(ordered,shard)){
    let row;try{
      const id=await identity(file),prior=saved.get(file),same=prior&&!prior.inconclusive&&JSON.stringify(prior.identity)===JSON.stringify(id);
      const beforeMatches=prior&&await a.matches(prior.beforeBinding);
      if(same&&beforeMatches&&(!b||await b.matches(prior.afterBinding))){rows.push(prior);continue;}
      const probe=same?prior.probe:JSON.parse((await runTool(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json','-i',file],{timeoutMs:30000,stdoutLimit:8*1024**2})).stdout);
      const before=same&&beforeMatches?prior.before:await metadataIo(file,()=>admission(file,probe,a.api));
      const after=b?await metadataIo(file,()=>admission(file,probe,b.api)):null;
      const beforeBinding=beforeMatches?prior.beforeBinding:await a.refresh(),afterBinding=b?await b.refresh():null;
      row={file,identity:id,probe,beforeDigest:beforeBinding.digest,afterDigest:afterBinding?.digest||'pending',beforeBinding,afterBinding,before,after};
      if(JSON.stringify(id)!==JSON.stringify(await identity(file)))row.inconclusive='Source identity changed during comparison.';
    }catch(e){row={file,inconclusive:e.message};}
    rows.push(row);await fs.appendFile(log,'ADMISSION_BATCH_ROW '+JSON.stringify(row)+'\n');
  }
  const result={files:rows.length,...(shard?{shard}:{}),beforeDigest:a.digest,afterDigest:b?.digest||'pending',changes:b?rows.filter(r=>!r.inconclusive&&JSON.stringify(r.before)!==JSON.stringify(r.after)).map(({probe,...r})=>r):[],inconclusive:rows.filter(r=>r.inconclusive)};
  await fs.appendFile(log,'ADMISSION_BATCH_RESULT '+JSON.stringify(result)+'\n');return result;
}
if(require.main===module)batch(...process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.inconclusive.length?1:0;}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={batch,implementation,identity,partition,selected,focused:(log,beforeRoot,files,candidateRoot)=>batch(log,beforeRoot,candidateRoot,undefined,selected(files))};
