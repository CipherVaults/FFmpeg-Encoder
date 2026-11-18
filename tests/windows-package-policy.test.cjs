'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {inspectElectronListing,requiredFree,reportSummary}=require('../scripts/windows-package-policy.cjs');
const row=(name,size=1,attr='A')=>`Path = ${name}\nSize = ${size}\nAttributes = ${attr}\nEncrypted = -`;
const names=['electron.exe','version','LICENSE','LICENSES.chromium.html'];const good=names.map(n=>row(n)).join('\n\n');
test('bounded ordinary Electron listing',()=>assert.equal(inspectElectronListing(good).expandedBytes,4n));
for(const bad of ['../escape','C:escape','a/../b','a\\b/c','NUL','a.'])test('unsafe archive member '+bad,()=>assert.throws(()=>inspectElectronListing(good+'\n\n'+row(bad))));
test('duplicates, links, ancestry and expansion refused',()=>{for(const bad of [row('VERSION'),row('link',1,'lrwxrwxrwx'),row('electron.exe/child'),row('large',2147483648)])assert.throws(()=>inspectElectronListing(good+'\n\n'+bad));});
test('floor budgets full staging, not just archives',()=>assert.equal(requiredFree([{sizeBytes:100}]),43n*1024n**3n+100n));
test('summary excludes raw paths/logs and requires verified build',()=>{const p={sha256:'a'.repeat(64),sizeBytes:1,path:'private'};const b={status:'build-verified-runtime-acceptance-pending',asar:p,executable:p,zip:p,sources:[1],resources:[1],packageInventory:[1],error:'private'};const r=reportSummary(b,{head:'b'.repeat(40),runId:'1',attempt:'1'});assert(!JSON.stringify(r).includes('private'));assert.throws(()=>reportSummary({...b,status:'failed'},{head:'b'.repeat(40),runId:'1',attempt:'1'}));});
const os=require('node:os'),fs=require('node:fs/promises'),path=require('node:path');
const hosted=require('../scripts/windows-hosted-package-check.cjs');
test('hosted authority rejects missing identity',()=>assert.throws(()=>hosted.authority({},{})));
test('tree bound refuses oversized owned data and symbolic links',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'package-policy-'));try{await fs.writeFile(path.join(root,'file'),'ab');await assert.rejects(hosted.treeBound(root,1n));assert.equal((await hosted.treeBound(root,2n)).bytes,'2');await fs.symlink(path.join(root,'file'),path.join(root,'link'));await assert.rejects(hosted.treeBound(root));}finally{await fs.rm(root,{recursive:true,force:true});}});
test('report publisher refuses unknown raw field before reservation',async()=>{await assert.rejects(hosted.publish('/nonexistent',{secret:'raw'},'/unused'));});
test('package listing validates exact files without Electron executable name',()=>assert.equal(inspectElectronListing(row('FFmpeg Encoder.exe'),[]).entries[0].name,'FFmpeg Encoder.exe'));
test('package failure diagnostics retain bounded phase/code only',()=>{
  assert.deepEqual(hosted.failureDiagnostic({packagePhase:'electron-listing',code:'ERR_ASSERTION',message:'private path',stack:'secret'}),{phase:'electron-listing',code:'ERR_ASSERTION'});
  assert.deepEqual(hosted.failureDiagnostic({packagePhase:'private path',code:'secret'}),{phase:'preflight',code:'UNCLASSIFIED'});
});
test('final startup validation runs after versions and preserves final-checks failures',async()=>{
  const {finalStartupCheck}=require('../scripts/windows-ffmpeg-startup.cjs');let count=0;
  await finalStartupCheck({validateFinal:async()=>{count++;}});assert.equal(count,1);
  const failure=new Error('tool or parent changed');await assert.rejects(finalStartupCheck({validateFinal:async()=>{throw failure;}}),e=>e===failure&&e.startupStage==='final-checks');
  const source=await fs.readFile(path.join(__dirname,'../scripts/windows-ffmpeg-startup.cjs'),'utf8');
  assert(source.indexOf('await finalStartupCheck(prepared)')>source.indexOf("const version=await run(exe,['-version']"));
});

test('bound authority admits only exact ordinary successor push',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'CipherVaults/FFmpeg-Encoder-Blue-Linux',GITHUB_REF:'refs/heads/blue/linux-development',GITHUB_EVENT_NAME:'push',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
  const event={before:'d71d50cb83660246ea77ed4f1837af18f4426e58',after:env.GITHUB_SHA,forced:false,created:false,deleted:false};
  assert.deepEqual(hosted.authority(env,event),{head:env.GITHUB_SHA,runId:'123',attempt:'1'});
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_SHA:'bad'},{GITHUB_RUN_ID:'private'}])assert.throws(()=>hosted.authority({...env,...change},event));
  for(const change of [{before:'b'.repeat(40)},{after:'b'.repeat(40)},{forced:true},{created:true},{deleted:true}])assert.throws(()=>hosted.authority(env,{...event,...change}));
});
test('listing failure reason remains finite and does not disclose raw field/path',()=>{
  const cases=[[good.replace('Attributes = A','Attributes = lrwx'),'ERR_ZIP_ATTRIBUTES'],[good+'\nUnknownSecretField = private','ERR_ZIP_FIELD_UNKNOWN'],[good+'\n\n'+row('../private'),'ERR_ZIP_PATH'],[good.replace('Size = 1','Size = private'),'ERR_ZIP_SIZE']];
  for(const [text,code] of cases){let failure;try{inspectElectronListing(text);}catch(e){failure=e;}assert(failure);failure.packagePhase='electron-listing';assert.deepEqual(hosted.failureDiagnostic(failure),{phase:'electron-listing',code});assert(!failure.message.includes('private'));}
  assert.deepEqual(hosted.failureDiagnostic({packagePhase:'electron-listing',code:'ERR_ZIP_PRIVATE'}),{phase:'electron-listing',code:'UNCLASSIFIED'});
});

test('preflight diagnostics identify each boundary without exception text',async()=>{
  for(const phase of ['main-arguments','report-publication','event-read','event-authority','source-head','source-clean','platform','environment','source-path','staging-path','same-volume','fixed-drive-process','fixed-drive-type','capacity-stat','capacity-floor']){
    const d=hosted.createPreflightDiagnostic();const error=Object.assign(new Error('private path and environment'),{code:'ERR_ASSERTION',packagePhase:'untrusted'});
    await assert.rejects(d.boundary(phase,async()=>{throw error;}));
    assert.deepEqual(d.failure(error),{schema:1,state:'PREFLIGHT_OR_REPORT_UNAVAILABLE',phase,code:'ERR_ASSERTION',capacity:null});
    assert(!JSON.stringify(d.failure(error)).includes('private'));
  }
});
test('unknown labels/codes never leak and success returns exact result',async()=>{
  const d=hosted.createPreflightDiagnostic();assert.equal(await d.boundary('event-read',async()=>42),42);
  await assert.rejects(d.boundary('private secret',()=>{throw new Error('must not run');}));
  assert.deepEqual(d.failure({code:'private',capacity:{availableBytes:'private'}}),{schema:1,state:'PREFLIGHT_OR_REPORT_UNAVAILABLE',phase:'event-read',code:'UNCLASSIFIED',capacity:null});
});
test('capacity evidence requires bounded bigint measurement; failure preserves measured refusal',()=>{
  const d=hosted.createPreflightDiagnostic();assert.equal(d.failure({}).capacity,null);
  for(const args of [[1,2],[-1n,2n],[2n**64n,1n],[1n,-1n]])assert.throws(()=>d.capacity(...args));
  assert.equal(d.failure({}).capacity,null);
  assert.throws(()=>d.capacity(1n,2n));
  assert.deepEqual(d.failure({code:'ERR_ASSERTION'}).capacity,{availableBytes:'1',requiredBytes:'2',meetsFloor:false});
  const success=hosted.createPreflightDiagnostic();success.capacity(2n,2n);assert.deepEqual(success.failure({}).capacity,{availableBytes:'2',requiredBytes:'2',meetsFloor:true});
});
test('workflow and source bind only next ordinary push without changing job scope',async()=>{
  const workflow=await fs.readFile(path.join(__dirname,'../.github/workflows/windows-package.yml'),'utf8');
  assert(workflow.includes("github.event.before == 'd71d50cb83660246ea77ed4f1837af18f4426e58'"));
  assert(!workflow.includes('workflow_dispatch'));assert(workflow.includes('github.run_attempt == 1'));
  const source=await fs.readFile(path.join(__dirname,'../scripts/windows-hosted-package-check.cjs'),'utf8');
  for(const phase of ['event-read','event-authority','source-head','source-clean','platform','environment','source-path','staging-path','same-volume','fixed-drive-process','fixed-drive-type','capacity-stat','capacity-floor'])assert(source.includes("step('"+phase+"'"));
  assert(source.includes('timeout:10000,maxBuffer:1024'));assert(source.includes('requiredFree([manifest.archive,manifest.electron.archive])'));
  assert(source.includes("console.error('Windows package diagnostic: '+JSON.stringify(diagnostic.failure(error)))"));
});

test('real event reader accepts small ordinary JSON through exact main helper',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hosted-event-'));
  try{
    const file=path.join(dir,'event.json');const event={before:'d71d50cb83660246ea77ed4f1837af18f4426e58',after:'a'.repeat(40),forced:false,created:false,deleted:false};
    await fs.writeFile(file,JSON.stringify(event),{flag:'wx'});
    const {readBoundedJson}=require('../src/candidate-runtime.cjs');
    // The former caller fails unconditionally at argument validation, even for valid small input.
    await assert.rejects(readBoundedJson(file,2*1024*1024),{code:'ERR_ASSERTION',message:'JSON read limit is invalid.'});
    const actual=await hosted.readHostedEvent(file);assert.deepEqual(actual,event);
    const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'CipherVaults/FFmpeg-Encoder-Blue-Linux',GITHUB_REF:'refs/heads/blue/linux-development',GITHUB_EVENT_NAME:'push',GITHUB_SHA:event.after,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
    assert.equal(hosted.authority(env,actual).head,event.after);
    const source=await fs.readFile(path.join(__dirname,'../scripts/windows-hosted-package-check.cjs'),'utf8');
    assert(source.includes("step('event-read',()=>readHostedEvent(process.env.GITHUB_EVENT_PATH))"));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('real event reader keeps size, syntax and ordinary-file refusals',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hosted-event-'));
  try{
    const file=path.join(dir,'event.json');
    await fs.writeFile(file,' '.repeat(1024*1024-2)+'{}',{flag:'wx'});
    assert.deepEqual(await hosted.readHostedEvent(file),{}); // Exact inclusive bound.
    await fs.appendFile(file,' ');await assert.rejects(hosted.readHostedEvent(file),{code:'ERR_ASSERTION'});
    await fs.writeFile(file,'{');await assert.rejects(hosted.readHostedEvent(file),SyntaxError);
    await fs.writeFile(file,'{}');const link=path.join(dir,'link');await fs.symlink(file,link);await assert.rejects(hosted.readHostedEvent(link),{code:'ERR_ASSERTION'});
    const hard=path.join(dir,'hard');await fs.link(file,hard);await assert.rejects(hosted.readHostedEvent(file),{code:'ERR_ASSERTION'});
    await assert.rejects(hosted.readHostedEvent(dir),{code:'ERR_ASSERTION'});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

const {inspectPinnedElectronListing}=require('../scripts/windows-package-policy.cjs');
const pinnedElectron={sha256:'eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c',sizeBytes:158293649};
const actualElectronListing=()=>fs.readFile(path.join(__dirname,'fixtures/electron-44.7.0-win32-x64-listing.txt'),'utf8');
test('actual hash-verified Electron listing uses only closed pinned context and exact implied directories',async()=>{
 const text=await actualElectronListing();
 assert.throws(()=>inspectElectronListing(text),{code:'ERR_ZIP_ATTRIBUTES'});
 const result=inspectPinnedElectronListing(text,pinnedElectron);
 assert.equal(result.expandedBytes,385514847n);
 assert.equal(result.entries.filter(x=>!x.directory).length,73);
 assert.deepEqual(result.entries.filter(x=>x.directory).map(x=>x.name).sort(),['locales','resources']);
 assert.equal(result.entries.length,75);
 for(const archive of [null,{...pinnedElectron,sha256:'0'.repeat(64)},{...pinnedElectron,sizeBytes:1}])assert.throws(()=>inspectPinnedElectronListing(text,archive),{code:'ERR_ZIP_PINNED_CONTEXT'});
});
test('pinned listing rejects altered types,attributes,hosts,paths,counts and encryption',async()=>{
 const text=await actualElectronListing();
 for(const replacement of ['A','D','L','R','XU 81A40001','XU A1FF0000','vXPUM 81A40000','lrwxrwxrwx','XU 81A40000 extra'])
  assert.throws(()=>inspectPinnedElectronListing(text.replace('Attributes = XU 81A40000','Attributes = '+replacement),pinnedElectron));
 for(const changed of [text.replace('Host OS = FAT','Host OS = Unix'),text.replace('Folder = -','Folder = +'),text.replace('Encrypted = -','Encrypted = +'),text.replace('Path = resources.pak','Path = ../resources.pak'),text.replace('Path = resources.pak','Path = foreign.pak'),text.replace('Size = 12436174','Size = 12436175'),text+'\n\n'+row('foreign'),text.split(/\n\n/).slice(1).join('\n\n')])
  assert.throws(()=>inspectPinnedElectronListing(changed,pinnedElectron));
 // Nothing unusual is admitted for generic output-package listings.
 for(const attr of ['XU 81A40000','vXPUM 81A40000','lrwxrwxrwx','L'])assert.throws(()=>inspectElectronListing(row('output.exe',1,attr),[]));
});
test('only verified Electron acquisition opts into pinned parser; built ZIP stays generic',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../scripts/windows-hosted-package-check.cjs'),'utf8');
 assert(source.includes('inspectPinnedElectronListing(listing.stdout,manifest.electron.archive)'));
 assert(source.includes('await verifyPinnedFile(electronArchive,manifest.electron.archive);\n  const inspected=inspectPinnedElectronListing'));
 assert(source.includes('inspectElectronListing(zipListing.stdout,[])'));
});
