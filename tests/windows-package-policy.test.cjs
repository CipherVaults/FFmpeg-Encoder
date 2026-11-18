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
  const event={before:'11346c21595cf08076952abf94d69130ddf4e83b',after:env.GITHUB_SHA,forced:false,created:false,deleted:false};
  assert.deepEqual(hosted.authority(env,event),{head:env.GITHUB_SHA,runId:'123',attempt:'1'});
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_SHA:'bad'},{GITHUB_RUN_ID:'private'}])assert.throws(()=>hosted.authority({...env,...change},event));
  for(const change of [{before:'b'.repeat(40)},{after:'b'.repeat(40)},{forced:true},{created:true},{deleted:true}])assert.throws(()=>hosted.authority(env,{...event,...change}));
});
test('listing failure reason remains finite and does not disclose raw field/path',()=>{
  const cases=[[good.replace('Attributes = A','Attributes = lrwx'),'ERR_ZIP_ATTRIBUTES'],[good+'\nUnknownSecretField = private','ERR_ZIP_FIELD_UNKNOWN'],[good+'\n\n'+row('../private'),'ERR_ZIP_PATH'],[good.replace('Size = 1','Size = private'),'ERR_ZIP_SIZE']];
  for(const [text,code] of cases){let failure;try{inspectElectronListing(text);}catch(e){failure=e;}assert(failure);failure.packagePhase='electron-listing';assert.deepEqual(hosted.failureDiagnostic(failure),{phase:'electron-listing',code});assert(!failure.message.includes('private'));}
  assert.deepEqual(hosted.failureDiagnostic({packagePhase:'electron-listing',code:'ERR_ZIP_PRIVATE'}),{phase:'electron-listing',code:'UNCLASSIFIED'});
});
