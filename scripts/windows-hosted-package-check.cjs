'use strict';
// Future one-shot hosted package build. No Electron/app/media launches; report only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {acquire,retainDirectory,localDrivePath}=require('./acquire-candidate-archives.cjs');
const {preparePayload,runBounded}=require('./windows-ffmpeg-startup.cjs');
const {provisionCandidateRuntime}=require('./provision-candidate-runtime.cjs');
const {main:provisionElectron}=require('./provision-candidate-electron.cjs');
const {main:buildPortable,hashFile,appSources}=require('./build-portable.cjs');
const {expectedCandidateManifest,assertOrdinaryPath,verifyPinnedFile,readBoundedJson}=require('../src/candidate-runtime.cjs');
const {LISTING_CODES,inspectPinnedElectronListing,inspectElectronListing,requiredFree,reportSummary}=require('./windows-package-policy.cjs');
const PARENT='d71d50cb83660246ea77ed4f1837af18f4426e58';
const TOOL='C:\\Program Files\\7-Zip\\7z.exe';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const PHASES=new Set(['preflight','source-inventory','dependency-metadata','acquisition','ffmpeg-payload','ffmpeg-provision','electron-archive','electron-listing','electron-extraction','electron-inventory','package-capacity','package-build','source-readback','zip-integrity','zip-inventory','final-readback']);
function failureDiagnostic(error){
  const codes=new Set(['ETIMEDOUT','ENOENT','EACCES','EPERM','ENOBUFS','ERR_ASSERTION','EINVAL','ENOSPC',...LISTING_CODES]);
  return {phase:PHASES.has(error?.packagePhase)?error.packagePhase:'preflight',code:codes.has(error?.code)?error.code:'UNCLASSIFIED'};
}

// Diagnostic state is owned by this invocation, never populated from an event or error.
const PREFLIGHT_PHASES=new Set(['main-arguments','report-publication','event-read','event-authority','source-head','source-clean','platform','environment','source-path','staging-path','same-volume','fixed-drive-process','fixed-drive-type','capacity-stat','capacity-floor']);
function createPreflightDiagnostic(){
  let phase='preflight',capacity=null;
  return {
    async boundary(name,action){assert(PREFLIGHT_PHASES.has(name));phase=name;return await action();},
    capacity(available,required){
      assert(typeof available==='bigint'&&typeof required==='bigint'&&available>=0n&&required>=0n&&available<=2n**64n-1n&&required<=2n**64n-1n);
      capacity={availableBytes:String(available),requiredBytes:String(required),meetsFloor:available>=required};
      phase='capacity-floor';assert(available>=required,'Package reservation floor not met.');
    },
    failure(error){return {schema:1,state:'PREFLIGHT_OR_REPORT_UNAVAILABLE',phase,code:failureDiagnostic(error).code,capacity};}
  };
}

function authority(env,event){
  assert(/^[a-f0-9]{40}$/.test(PARENT),'Future package push is not bound.');
  assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY==='CipherVaults/FFmpeg-Encoder-Blue-Linux'&&env.GITHUB_REF==='refs/heads/blue/linux-development'&&env.GITHUB_EVENT_NAME==='push');
  assert(event.before===PARENT&&event.after===env.GITHUB_SHA&&event.forced===false&&event.created===false&&event.deleted===false);
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA)&&/^\d+$/.test(env.GITHUB_RUN_ID)&&env.GITHUB_RUN_ATTEMPT==='1');
  return {head:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,attempt:'1'};
}
async function preflight(root,parent,manifest,diagnostic=createPreflightDiagnostic()){
  const step=(name,action)=>diagnostic.boundary(name,action);
  await step('platform',()=>assert(process.platform==='win32'&&process.arch==='x64'));
  await step('environment',()=>assert(!process.env.NODE_OPTIONS&&!Object.entries(process.env).some(([k,v])=>k.startsWith('LD_')&&v)));
  await step('source-path',async()=>{localDrivePath(root);await assertOrdinaryPath(root,'directory');});
  await step('staging-path',async()=>{localDrivePath(parent);await assertOrdinaryPath(parent,'directory');});
  await step('same-volume',()=>assert(path.parse(root).root.toLowerCase()===path.parse(parent).root.toLowerCase(),'Source/staging must use same measured volume.'));
  const type=await step('fixed-drive-process',()=>{
    const drive=path.win32.parse(parent).root.slice(0,2);
    const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
    return execFileSync(shell,['-NoProfile','-NonInteractive','-Command',`$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; if (!$d) {exit 2}; Write-Output $d.DriveType`],{encoding:'utf8',timeout:10000,maxBuffer:1024,windowsHide:true});
  });
  await step('fixed-drive-type',()=>assert(type.trim()==='3'));
  const s=await step('capacity-stat',()=>fs.statfs(parent,{bigint:true}));
  await step('capacity-floor',()=>diagnostic.capacity(s.bavail*s.bsize,requiredFree([manifest.archive,manifest.electron.archive])));
}
async function treeBound(root,limit=16n*1024n**3n){
  let bytes=0n,count=0;
  async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){assert(++count<=100000);const f=path.join(dir,e.name);const st=await fs.lstat(f);assert(!st.isSymbolicLink());if(st.isDirectory())await walk(f);else{assert(st.isFile()&&st.nlink===1);bytes+=BigInt(st.size);assert(bytes<=limit);}}}
  await walk(root);return {bytes:String(bytes),files:count};
}
async function publish(parent,report,output){
  const allowed=new Set(['schema','head','runId','attempt','state','asar','executable','zip','sourceFiles','resourceFiles','packageFiles','gui','media','gpu','distribution','electronArchiveSha256','electronListingSha256','packageLockSha256','failure']);
  assert(Object.keys(report).every(k=>allowed.has(k)));
  if(report.failure)assert.deepEqual(report.failure,failureDiagnostic({packagePhase:report.failure.phase,code:report.failure.code}));
  assert(report.distribution==='report-only'&&report.gui==='not-run'&&report.media==='not-run'&&report.gpu==='not-run');
  const directory=await fs.mkdtemp(path.join(parent,'package-report-'));const owned=await retainDirectory(directory);const file=path.join(directory,'report.json');
  const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');assert(bytes.length<=32768);await owned();await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
  await verifyPinnedFile(file,{sizeBytes:bytes.length,sha256:sha(bytes)});await owned();assert(!/[\r\n]/.test(file));
  await fs.appendFile(output,`report_path=${file}\nreport_sha256=${sha(bytes)}\nreport_ready=true\n`);return sha(bytes);
}
async function execute({root,parent,identity},{acquireImpl=acquire,prepareImpl=preparePayload,electronImpl=provisionElectron,buildImpl=buildPortable,run=runBounded,onVerifiedBuild=null}={}){
  let phase='preflight';
  try {
  const manifest=expectedCandidateManifest();await preflight(root,parent,manifest);const owner=await retainDirectory(root);
  phase='source-inventory';
  const packageJson=await readBoundedJson(path.join(root,'package.json'));const sources=await appSources(root,packageJson);const lock=await hashFile(path.join(root,'package-lock.json'));
  phase='dependency-metadata';
  for(const name of ['electron','@electron/packager']){const m=await readBoundedJson(path.join(root,'node_modules',name,'package.json'));assert(m.version===packageJson.devDependencies[name]);}
  phase='acquisition';
  const acquired=await acquireImpl({parent});await owner();
  phase='ffmpeg-payload';
  const prepared=await prepareImpl({parent,acquisition:acquired,manifest},{run});
  phase='ffmpeg-provision';
  await provisionCandidateRuntime({root,receiptPath:acquired.receipt,payloadDirectory:prepared.payload});
  phase='electron-archive';
  const electronArchive=path.join(acquired.directory,manifest.electron.archive.fileName);await verifyPinnedFile(electronArchive,manifest.electron.archive);
  phase='electron-listing';
  const listing=await run(TOOL,['l','-slt','-ba','-sccUTF-8','--',electronArchive],{limit:2*1024*1024,timeout:30000,cwd:root});
  await verifyPinnedFile(electronArchive,manifest.electron.archive);
  const inspected=inspectPinnedElectronListing(listing.stdout,manifest.electron.archive);await preflight(root,parent,manifest);await owner();
  phase='electron-extraction';
  await electronImpl({archivePath:electronArchive});
  phase='electron-inventory';
  const dist=path.join(root,'node_modules/electron/dist');
  // Verify every extracted relative pathname against the preflight inventory.
  const actual=[];async function walk(dir,relative=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const name=relative?relative+'/'+e.name:e.name;const f=path.join(dir,e.name);const st=await fs.lstat(f);assert(!st.isSymbolicLink());if(st.isDirectory()){actual.push({name,directory:true,size:0});await walk(f,name);}else{assert(st.isFile()&&st.nlink===1);actual.push({name,directory:false,size:st.size});}}}
  await walk(dist);const byName=(a,b)=>a.name.localeCompare(b.name);assert.deepEqual(actual.sort(byName),inspected.entries.sort(byName));
  phase='package-capacity';
  await treeBound(path.join(root,'node_modules'));await preflight(root,parent,manifest);
  const sourceProvenance={commit:identity.head,packageLockSha256:lock.sha256,kind:'hosted-checkout-source-not-staging-git'};
  phase='package-build';
  const built=await buildImpl({root,sourceProvenance});await owner();
  phase='source-readback';
  assert.deepEqual(await appSources(root,packageJson),sources);assert.deepEqual(await hashFile(path.join(root,'package-lock.json')),lock);
  await treeBound(built.buildRoot);await verifyPinnedFile(built.zip.path,built.zip);
  phase='zip-integrity';
  await run(TOOL,['t','-bd','-bb0','--',built.zip.path],{limit:1048576,timeout:180000,cwd:built.buildRoot});
  phase='zip-inventory';
  const zipListing=await run(TOOL,['l','-slt','-ba','-sccUTF-8','--',built.zip.path],{limit:2*1024*1024,timeout:30000,cwd:built.buildRoot});
  const zipEntries=inspectElectronListing(zipListing.stdout,[]).entries.filter(e=>!e.directory);
  assert.deepEqual(zipEntries.map(e=>e.name).sort(),built.packageInventory.slice().sort());
  for(const entry of zipEntries){const st=await fs.stat(path.join(built.packageDir,...entry.name.split('/')));assert(st.size===entry.size);}
  await verifyPinnedFile(built.zip.path,built.zip);
  phase='final-readback';
  const report=reportSummary(built,identity);report.electronArchiveSha256=manifest.electron.archive.sha256;report.electronListingSha256=sha(listing.stdout);report.packageLockSha256=lock.sha256;
  if(onVerifiedBuild!==null){assert(typeof onVerifiedBuild==='function');await onVerifiedBuild(built,report);}
  return report;
  }catch(error){error.packagePhase=phase;throw error;}
}
// The shared ordinary-file reader permits at most 1 MiB; do not relax it for events.
async function readHostedEvent(filename){return readBoundedJson(filename,1024*1024);}
async function main(diagnostic=createPreflightDiagnostic()){
  const step=(name,action)=>diagnostic.boundary(name,action);
  const root=path.resolve(__dirname,'..'),parent=process.env.RUNNER_TEMP;
  const event=await step('event-read',()=>readHostedEvent(process.env.GITHUB_EVENT_PATH));const identity=await step('event-authority',()=>authority(process.env,event));
  await step('source-head',()=>{const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024}).trim();assert(head===identity.head);});
  await step('source-clean',()=>execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:root,timeout:10000,maxBuffer:1024}));
  if(process.argv.length===3&&process.argv[2]==='--preflight'){await preflight(root,parent,expectedCandidateManifest(),diagnostic);return;}
  await step('main-arguments',()=>assert(process.argv.length===2));
  let report;try{report=await execute({root,parent,identity});}catch(error){report={schema:1,...identity,failure:failureDiagnostic(error),state:'PACKAGE_FAILED_OR_INCOMPLETE',gui:'not-run',media:'not-run',gpu:'not-run',distribution:'report-only'};process.exitCode=1;}
  console.log('Inert Windows package result: '+report.state+'; report SHA256 '+await step('report-publication',()=>publish(parent,report,process.env.GITHUB_OUTPUT)));
}
module.exports={preflight,readHostedEvent,createPreflightDiagnostic,failureDiagnostic,authority,treeBound,publish,execute};
if(require.main===module){const diagnostic=createPreflightDiagnostic();main(diagnostic).catch(error=>{console.error('Windows package diagnostic: '+JSON.stringify(diagnostic.failure(error)));process.exitCode=1;});}
