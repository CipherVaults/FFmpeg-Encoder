'use strict';
// Read-only native admission census. Probes and decisions are retained in the
// executor's explicitly authorized progress log, so both sides use identical
// files/probes. This never starts a workflow, muxes, decodes or writes media.
const fs = require('node:fs/promises');
const path = require('node:path');
const { runTool } = require('../src/process-runner.cjs');
const { resolveCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { observeNativeInventory } = require('../src/remux-native-checks.cjs');
const { observeRemuxSourcePlayback } = require('../src/remux-edit-lists.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { reports } = require('./v07-remux-edit-proof-audit.cjs');
const { INVENTORY } = require('../src/remux-native-inventory.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { deriveRemuxAssessmentBudget } = require('../src/remux-operation.cjs');
const { createTransportIntegrity } = require('../src/remux-transport.cjs');
const { createHash } = require('node:crypto');
const counts = () => Object.fromEntries(['compare','require-default','covered','descriptive'].map(t => [t,INVENTORY.filter(r=>r.treatment===t).length]));
async function sources() {
  const files = new Set();
  async function walk(dir) {
    for (const e of await fs.readdir(dir, {withFileTypes:true})) {
      const file=path.join(dir,e.name);
      if (e.isDirectory()) await walk(file);
      else if(e.isFile() && /\.(mp4|mov|mkv|webm|ts|m2ts)$/i.test(e.name)) files.add(file);
    }
  }
  await walk('F:\\shadow play');
  for (const relative of Object.keys(require('./v07-remux-proof-cases.json'))) {
    const report=JSON.parse(await fs.readFile(path.join(__dirname,'../artifacts/v0.7',relative,'report.json'),'utf8'));
    for(const c of report.cases||[]) if(c.source||c.input) files.add(c.source||c.input);
  }
  return [...files].sort();
}
async function admission(file, probe, implementation={observeNativeInventory,observeRemuxSourcePlayback,assessRemux,deriveRemuxAssessmentBudget,createTransportIntegrity}) {
  const names=(probe.format?.format_name||'').split(','),family=names.includes('mov')?'isobmff':names.includes('matroska')?'matroska':names.includes('mpegts')?'mpegts':null;
  if(!family) return {status:'out-of-scope'};
  try {
    const assessment=implementation.assessRemux({request:{fileId:'admission-census',identityRevision:0,draftRevision:0,operation:'remux',target:'mp4',range:null,omissionRequestIds:[]},probe,sourceFingerprint:'a'.repeat(64)});
    if(assessment.status!=='qualification-required')return {status:'refused',family,stage:'contract',blockers:assessment.blockers};
    // Exactly the application's source-derived budget, on both versions.
    // Never substitute the observer's two-minute unit-test default here.
    const {budget}=implementation.deriveRemuxAssessmentBudget(assessment,String(probe.format.size),'packet-identity-v1');
    if(family==='isobmff') await implementation.observeRemuxSourcePlayback({file,probe,identity:await readSourceIdentity(file),target:'mp4',...budget});
    if(family==='mpegts'){
      const integrity=implementation.createTransportIntegrity(probe.streams,probe.programs);
      for await(const bytes of require('node:fs').createReadStream(file,{highWaterMark:65536}))integrity.push(bytes);
      integrity.finish();
    }
    await implementation.observeNativeInventory({file,probe,family,target:'mp4',...budget});
    return {status:'accepted',family};
  } catch(e) {return {status:'refused',family,code:e.code||'ERROR',reason:e.message};}
}
const identity=s=>Object.fromEntries(['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));
async function implementationDigest(baselineRoot){
  const graph=require('./v07-remux-implementation.cjs');
  const old=await graph.implementation(baselineRoot,module),current=await graph.implementation(path.resolve(__dirname,'..'),module);
  return{old,current,digest:createHash('sha256').update(old.digest).update(current.digest).digest('hex')};
}
function oldImplementation(root){return {...require(path.resolve(root,'src/remux-native-checks.cjs')),...require(path.resolve(root,'src/remux-edit-lists.cjs')),
  ...require(path.resolve(root,'src/remux-contract.cjs')),...require(path.resolve(root,'src/remux-operation.cjs')),...require(path.resolve(root,'src/remux-transport.cjs'))};}
async function paired(log,baselineRoot,onlyRetained=false){
  const bindings=await implementationDigest(baselineRoot),old=bindings.old.api,ffprobe=resolveCandidateRuntime({root:path.resolve(__dirname,'..')}).ffprobe;
  const lines=(await fs.readFile(log,'utf8')).split('\n'),resume=new Map(lines.filter(l=>l.startsWith('ADMISSION_PAIRED_ROW ')).map(l=>{const r=JSON.parse(l.slice(21));return[r.file,r];}));
  let files=await sources();if(onlyRetained)files=files.filter(f=>!f.toLowerCase().startsWith('f:\\shadow play\\'));
  const rows=[];
  // One source at a time: parallel sparse reads on the personal HDD distort
  // the result, and this census must not turn drive contention into a refusal.
  for(const file of files){
    let row;try{
      const before=identity(await fs.stat(file,{bigint:true})),saved=resume.get(file);
      if(saved&&JSON.stringify(saved.identity)===JSON.stringify(before)&&await bindings.old.matches(saved.beforeBinding)&&await bindings.current.matches(saved.afterBinding)){rows.push(saved);continue;}
      const probe=JSON.parse((await runTool(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json','-i',file],{timeoutMs:30000,stdoutLimit:8*1024**2})).stdout);
      const a=await admission(file,probe,old),b=await admission(file,probe),after=identity(await fs.stat(file,{bigint:true}));
      row={version:3,file,identity:before,beforeBinding:await bindings.old.refresh(),afterBinding:await bindings.current.refresh(),before:a,after:b};
      if(JSON.stringify(before)!==JSON.stringify(after))row.inconclusive='Source identity changed during the pair.';
    }catch(e){row={version:3,file,inconclusive:e.message};}
    rows.push(row);await fs.appendFile(log,'ADMISSION_PAIRED_ROW '+JSON.stringify(row)+'\n');
  }
  const result={version:3,scope:onlyRetained?'all retained proof sources':'all retained proof sources and readable personal media',implementation:bindings.digest,
    countsBefore:Object.fromEntries(['compare','require-default','covered','descriptive'].map(t=>[t,require(path.resolve(baselineRoot,'src/remux-native-inventory.cjs')).INVENTORY.filter(r=>r.treatment===t).length])),countsAfter:counts(),files:rows.length,
    changed:rows.filter(r=>!r.inconclusive&&JSON.stringify(r.before)!==JSON.stringify(r.after)),inconclusive:rows.filter(r=>r.inconclusive)};
  await fs.appendFile(log,'ADMISSION_PAIRED_RESULT '+JSON.stringify(result)+'\n');return result;
}
async function mapFiles(files,visit){const rows=new Array(files.length);let next=0;
  await Promise.all(Array.from({length:4},async()=>{for(;;){const i=next++;if(i>=files.length)return;rows[i]=await visit(files[i]);}}));return rows;}
async function baseline({implementation,onRow=async()=>{},resume=new Map()}={}) {
  const binding=await require('./v07-remux-implementation.cjs').implementation(path.resolve(__dirname,'..'),module);
  const ffprobe=resolveCandidateRuntime({root:path.resolve(__dirname,'..')}).ffprobe;
  const rows=await mapFiles(await sources(),async file=>{
    // Legacy before/after rows have no identity/module graph binding. Re-read
    // them; only paired mode and the batch runner may reuse bound decisions.
    let row;
    try {
      const before=identity(await fs.stat(file,{bigint:true}));
      const p=JSON.parse((await runTool(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-show_chapters','-show_programs','-show_stream_groups','-show_data_hash','sha256','-of','json','-i',file],{timeoutMs:30000,stdoutLimit:8*1024**2})).stdout);
      row={file,probe:p,identity:before,before:await admission(file,p,implementation)};
      if(JSON.stringify(before)!==JSON.stringify(identity(await fs.stat(file,{bigint:true}))))throw Error('Source changed during baseline admission.');
    } catch(e) {row={file,before:{status:'unreadable',code:e.code||'ERROR',reason:e.message}};}
    await onRow(row);return row;
  });
  return {version:3,implementationBinding:await binding.refresh(),counts:implementation?.counts||counts(),rows};
}
async function after(before) {
  const binding=await require('./v07-remux-implementation.cjs').implementation(path.resolve(__dirname,'..'),module);
  if(!await binding.matches(before.implementationBinding))throw Error('Unbound or changed legacy baseline; use paired admission against the saved before root.');
  const rows=await mapFiles(before.rows,async row=>{
    if(!row.identity||JSON.stringify(row.identity)!==JSON.stringify(identity(await fs.stat(row.file,{bigint:true}))))throw Error('Source identity differs from its bound baseline.');
    const result=row.probe?await admission(row.file,row.probe):row.before;
    return {file:row.file,before:row.before,after:result};
  });
  const changed=rows.filter(r=>JSON.stringify(r.before)!==JSON.stringify(r.after));
  return {implementationBinding:await binding.refresh(),countsBefore:before.counts,countsAfter:counts(),files:rows.length,changed};
}
if(require.main===module) (async()=>{
  const [mode,log,baselineRoot]=process.argv.slice(2);
  if(!['before','after','paired','paired-retained'].includes(mode)||!log) throw Error('Usage: before|after|paired|paired-retained <authorized progress.md> [before/ root]');
  if(mode.startsWith('paired')){if(!baselineRoot)throw Error('The paired census requires the original before/ root.');console.log(JSON.stringify(await paired(log,baselineRoot,mode==='paired-retained'),null,2));return;}
  if(mode==='before') {
    const implementation=baselineRoot?{...oldImplementation(baselineRoot),counts:Object.fromEntries(['compare','require-default','covered','descriptive'].map(t=>[t,require(path.resolve(baselineRoot,'src/remux-native-inventory.cjs')).INVENTORY.filter(r=>r.treatment===t).length]))}:undefined;
    const lines=(await fs.readFile(log,'utf8')).split('\n'),last=lines.findLastIndex(l=>l.startsWith('ADMISSION_BASELINE '));
    const resume=new Map(lines.slice(last+1).filter(l=>l.startsWith('ADMISSION_ROW ')).map(l=>{const r=JSON.parse(l.slice(14));return[r.file,r];}));
    let append=Promise.resolve();
    const result=await baseline({implementation,resume,onRow:row=>(append=append.then(()=>fs.appendFile(log,'ADMISSION_ROW '+JSON.stringify(row)+'\n')))});await fs.appendFile(log,'ADMISSION_BASELINE '+JSON.stringify(result)+'\n');
    const groups={};for(const r of result.rows)groups[r.before.status]=(groups[r.before.status]||0)+1;
    console.log(JSON.stringify({counts:result.counts,files:result.rows.length,statuses:groups}));
  } else {
    const line=(await fs.readFile(log,'utf8')).split('\n').findLast(l=>l.startsWith('ADMISSION_BASELINE '));
    if(!line)throw Error('Missing before census');
    const result=await after(JSON.parse(line.slice(19)));await fs.appendFile(log,'ADMISSION_AFTER '+JSON.stringify(result)+'\n');console.log(JSON.stringify(result,null,2));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={sources,admission,baseline,after,paired,implementationDigest};
