'use strict';
// Operates only on disposable checkouts; never edits canonical refs or calls GitHub writes.
const A=require('node:assert/strict'), fs=require('node:fs/promises'), F=require('node:fs'), P=require('node:path');
const {execFileSync}=require('node:child_process'), {createHash}=require('node:crypto');
const C=require('./pinned.cjs'), sh=b=>createHash('sha256').update(b).digest('hex');
const W=Object.freeze(['assets/app-icon/app-icon-256.png','assets/app-icon/app-icon.ico','assets/app-icon/app-icon.svg','assets/app-icon/PROVENANCE.md','assets/app-icon/LICENSE.txt','resources/PORTABLE_README.txt'].sort());
function git(root,...args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:2e6}).trim();}
function checkedHead(root,id){A.equal(git(root,'rev-parse','HEAD'),id); A.equal(git(root,'status','--porcelain=v1','--untracked-files=all'),'','Fresh checkout required'); }
async function stock(root,path,kind='file'){const p=P.join(root,path),s=await fs.lstat(p);A(!s.isSymbolicLink()&&(kind==='file'?s.isFile()&&s.nlink===1:s.isDirectory()));A.equal((await fs.realpath(p)).toLowerCase(),P.resolve(p).toLowerCase());return p;}
async function verified(f,h){A.equal(sh(await fs.readFile(f)),h);return f;}
async function existingTarget(root,rel,bytes){const filename=await stock(root,rel);await fs.writeFile(filename,bytes);}
function authority(env,event){
 A.equal(env.GITHUB_REPOSITORY,C.privateRepo); A.equal(env.GITHUB_EVENT_NAME,'push');
 A.equal(env.GITHUB_REF,'refs/heads/blue/private-windows-alpha-preflight-20261121');
 A.equal(event.repository.private,true);A.equal(event.forced,false);A.equal(event.deleted,false);A.equal(event.created,false);A.equal(event.before,C.original,'Only the reserved source parent can trigger this first rehearsal');
 A.equal(env.GITHUB_SHA,event.after);A.equal(env.GITHUB_RUN_ATTEMPT,'1');A.equal(env.GITHUB_ACTOR,'AE0101');A.equal(env.RUNNER_ENVIRONMENT,'github-hosted');
 A.match(env.GITHUB_SHA,/^[a-f0-9]{40}$/); A.equal(env.RUNNER_OS,'Windows');
}
async function metadata(pin,fetchImpl=fetch){
 const url='https://api.github.com/repos/'+pin.repo+'/releases/tags/'+pin.tag;
 const resp=await fetchImpl(url,{redirect:'error',headers:{Accept:'application/vnd.github+json','User-Agent':'private-alpha-build-preflight'},signal:AbortSignal.timeout(30000)});
 A.equal(resp.status,200,'Cannot verify official release metadata');const rr=await resp.json();
 A.equal(rr.tag_name,pin.tag);A.equal(rr.draft,false);const assets=rr.assets.filter(a=>a.name===pin.file);A.equal(assets.length,1);
 const a=assets[0]; A.equal(a.digest,'sha256:'+pin.sha,'Official asset digest unavailable or changed');
 A.equal(a.size,pin.size); A.equal(a.browser_download_url,'https://github.com/'+pin.repo+'/releases/download/'+pin.tag+'/'+pin.file);
}
function safeSource(src,helpers,work){
 A(process.platform==='win32'&&process.arch==='x64');A(!process.env.NODE_OPTIONS);
 for(const x of [src,helpers,work])A(P.isAbsolute(x)&&!x.startsWith('\\\\')&&P.resolve(x)===x&&x.length>4);
 A.equal(new Set([src,helpers,work].map(x=>x.toLowerCase())).size,3);
 A.equal(new Set([src,helpers,work].map(x=>P.parse(x).root.toLowerCase())).size,1,'This lane requires one measured local volume; different volumes need a separately reviewed budget');
 for(const x of [src,helpers,work])for(const y of [src,helpers,work])if(x!==y){const r=P.relative(x,y);A(r==='..'||r.startsWith('..'+P.sep),'Checkouts/work roots must be non-nested');}
 checkedHead(src,C.original);checkedHead(helpers,C.helper);
}
async function prepare(src,helpers,work){
 A.equal(process.env.GITHUB_ACTIONS,'true','This prepared lane is hosted-only; never use an owner checkout');
 authority(process.env,JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8')));
 A.equal(src,P.resolve(process.env.GITHUB_WORKSPACE,'candidate'));A.equal(helpers,P.resolve(process.env.GITHUB_WORKSPACE,'trusted-helpers'));A.equal(work,P.resolve(process.env.RUNNER_TEMP,'alpha-private-prep-20261121'));
 safeSource(src,helpers,work);await fs.mkdir(work); // exclusive; stale outputs never reused
 A(!(F.existsSync(P.join(src,'out'))||F.existsSync(P.join(src,'.tools'))));
 const rel=x=>require(P.join(helpers,x)), orig=x=>require(P.join(src,x));
 const m=await orig('src/candidate-runtime.cjs').loadCandidateManifest({root:src});
 A.deepEqual(m,rel('src/candidate-runtime.cjs').expectedCandidateManifest());
 const g=[m.archive,m.electron.archive];
 for(const [i,p] of C.archives.entries()){A.equal(g[i].sha256,p.sha);A.equal(g[i].sizeBytes,p.size);await metadata(p);}
 const stats=await fs.statfs(work,{bigint:true}),required=rel('scripts/windows-package-policy.cjs').requiredFree(g),free=stats.bavail*stats.bsize;console.log('Private runner disk preflight: availableBytes='+String(free)+' requiredBytes='+String(required));A(free>required,'Insufficient disk; no floor override');
 const png=await fs.readFile(await verified(await stock(src,'assets/logo-gauge-2026-11-14/gauge-win-midtone-256.png'),C.png));
 const ico=await fs.readFile(await verified(P.join(__dirname,'gauge-app.ico'),C.ico));
 await existingTarget(src,W.find(x=>x.endsWith('256.png')),png);await existingTarget(src,W.find(x=>x.endsWith('.ico')),ico);
 await existingTarget(src,'assets/app-icon/app-icon.svg','<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" xlink:href="data:image/png;base64,'+png.toString('base64')+'"/></svg>\n');
 await existingTarget(src,'assets/app-icon/PROVENANCE.md',await fs.readFile(P.join(__dirname,'GAUGE.txt')));
 await existingTarget(src,'assets/app-icon/LICENSE.txt','Private Gauge asset: no third-party license grant is inferred. See PROVENANCE.md. Upstream Folded Frame art is not included in this package.\n');
 await existingTarget(src,'resources/PORTABLE_README.txt',await fs.readFile(P.join(__dirname,'PRIVATE-ALPHA.txt')));
 A.deepEqual(git(src,'diff','--name-only','HEAD').split(/\r?\n/).sort(),W);
 const {downloadPinned,acquire}=rel('scripts/acquire-candidate-archives.cjs');
 const {preparePayload,runBounded}=rel('scripts/windows-ffmpeg-startup.cjs');A(typeof downloadPinned==='function');
 const seven='C:\\Program Files\\7-Zip\\7z.exe';
 const sevenVer=await runBounded(seven,[],{limit:65536,timeout:10000,cwd:work});A.match(sevenVer.stdout,/7-Zip(?: \([^)]+\))? 26\.06\b/);
 const a=await acquire({parent:work});const f=await preparePayload({parent:work,acquisition:a,manifest:m});
 await orig('scripts/provision-candidate-runtime.cjs').provisionCandidateRuntime({root:src,receiptPath:a.receipt,payloadDirectory:f.payload});
 await f.validateFinal();const ar=P.join(a.directory,m.electron.archive.fileName);
 const runtime=orig('src/candidate-runtime.cjs');await runtime.verifyPinnedFile(ar,m.electron.archive);
 const listing=await runBounded(seven,['l','-slt','-ba','-sccUTF-8','--',ar],{limit:2*1024*1024,timeout:30000,cwd:work});
 const entries=rel('scripts/windows-package-policy.cjs').inspectPinnedElectronListing(listing.stdout,m.electron.archive).entries;
 const ep=P.join(src,'node_modules','electron');await stock(src,'node_modules/electron','dir');
 const dest=runtime.resolveCandidateRuntime({root:src}).electronArchive;await fs.mkdir(P.dirname(dest));await fs.copyFile(ar,dest,F.constants.COPYFILE_EXCL);
 await runtime.verifyPinnedFile(dest,m.electron.archive);const dist=P.join(ep,'dist');await fs.mkdir(dist);
 await runBounded(seven,['x','-bd','-bb0','-aos','-o'+dist,'--',dest],{limit:1024*1024,timeout:120000,cwd:work});
 const walk=async(d,re='')=>{let arr=[];for(const e of await fs.readdir(d,{withFileTypes:true})){const n=re?re+'/'+e.name:e.name;const p=P.join(d,e.name);A(!e.isSymbolicLink());if(e.isDirectory()){arr.push([n,true,0],...await walk(p,n));}else{let s=await fs.lstat(p);A(s.isFile()&&s.nlink===1);arr.push([n,false,s.size]);}}return arr;};
 const byName=(a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0;
 A.deepEqual((await walk(dist)).sort(byName),entries.map(e=>[e.name,e.directory,e.size]).sort(byName));
 A.equal((await fs.readFile(P.join(dist,'version'),'utf8')).trim(),m.electron.version);
 await fs.writeFile(P.join(ep,'path.txt'),'electron.exe',{flag:'wx'});await runtime.verifyPinnedFile(ar,m.electron.archive);
 await runtime.verifyCandidateRuntime({root:src});A.deepEqual(git(src,'diff','--name-only','HEAD').split(/\r?\n/).sort(),W);
 execFileSync(process.execPath,[P.join(src,'scripts/build-portable.cjs')],{cwd:src,timeout:480000,stdio:'inherit'});
 const [b,...extra]=await fs.readdir(P.join(src,'out'));A(/^portable-/.test(b)&&!extra.length);const br=P.join(src,'out',b);
 const report=JSON.parse(await fs.readFile(P.join(br,'build-report.json'),'utf8'));
 A.equal(report.status,'build-verified-runtime-acceptance-pending');A.equal(report.git.commit,C.original); A.equal(report.runtimeSelection.mode,'candidate-0.7'); A.equal(report.version,'0.7.0-alpha.1');
 const stage=P.join(br,'package','FFmpeg Encoder-win32-x64');A.equal(P.resolve(report.packageDir),stage);
 const zip=P.join(br,'zip','FFmpeg-Encoder-0.7.0-alpha.1-win32-x64.zip');A.equal(P.resolve(report.zip.path),zip);
 await runtime.verifyPinnedFile(zip,report.zip);
 await fs.writeFile(P.join(work,'build.json'),JSON.stringify({schema:1,original:C.original,helper:C.helper,stage,zip,icon:P.join(__dirname,'gauge-app.ico'),packageSha256:report.zip.sha256,form:'not yet smoke-tested',shipping:'disabled'}),{flag:'wx'});
 return {stage,zip};
}
module.exports={authority,metadata,safeSource,checkedHead};
if(require.main===module)(async()=>{A.equal(process.argv.length,5);const [src,h,work]=process.argv.slice(2);await prepare(src,h,work);})().catch(e=>{console.error('Private build preparation failed:',e.message);process.exitCode=1;});
