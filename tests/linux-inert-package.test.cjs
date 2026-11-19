'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {validatePlan}=require('../scripts/build-linux-inert-package.cjs');
const PLAN=require('../resources/linux-inert-package-plan.json');
const clone=()=>structuredClone(PLAN);
test('fixed plan includes real runtime notices and no copied host-library binaries',()=>{
 assert(validatePlan(PLAN)>300*1024*1024);
 for(const target of ['electron/LICENSE','electron/LICENSES.chromium.html','electron/resources/runtime/ffmpeg','electron/resources/runtime/ffprobe','electron/resources/app/linux-blue/product-linux-shell.cjs','electron/resources/app/linux-blue/product-linux-qualification.json'])assert(PLAN.files.some(x=>x.target===target),target);
 assert.equal(PLAN.dependencyStrategy,'exact-inspected-host-libraries-not-bundled');
 assert(PLAN.files.filter(x=>x.root==='hostDocs').every(x=>x.group==='notice'));
});
test('plan rejects path escape, collisions, bad sizes and alleged release authority',()=>{
 for(const modify of [p=>p.files[0].source='../secret',p=>p.files[0].target='electron/resources/app.asar',p=>p.files[0].target='/outside',p=>p.files.push({...p.files[0]}),p=>p.files[0].bytes=1e12,p=>p.usableForEncoding=true,p=>p.distributionReady=true,p=>p.files[0].sha256='wrong']){const p=clone();modify(p);assert.throws(()=>validatePlan(p));}
});
test('inert fixture builder writes and verifies actual ASAR, refuses tampered inputs',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'linux-package-fixture-'));
 const moduleRoot=path.join(parent,'module'); await fs.mkdir(path.join(moduleRoot,'scripts'),{recursive:true});await fs.mkdir(path.join(moduleRoot,'resources'));await fs.mkdir(path.join(moduleRoot,'src'));
 const builder=await fs.readFile(path.join(__dirname,'../scripts/build-linux-inert-package.cjs'),'utf8');
 // Test-only statfs seam because /tmp capacity is unrelated to product admission.
 await fs.writeFile(path.join(moduleRoot,'scripts/build.cjs'),builder.replace("  validateCurrentProductPair(PLAN);", "  // Synthetic ASAR fixture only; actual pair authority tested separately.").replace("const space=await fs.statfs(outputParent,{bigint:true});","const space={bavail:64n*1024n**3n,bsize:1n};"));
 const roots={}; for(const k of ['source','electron','inputs','guidance','hostDocs']){roots[k]=path.join(parent,k);await fs.mkdir(roots[k]);}
 const outputParent=path.join(parent,'output');await fs.mkdir(outputParent);
 const bytes=Buffer.from('{"name":"inert-fixture","version":"1.0.0"}\n');await fs.writeFile(path.join(roots.source,'package.json'),bytes);
 const p={...clone(),files:[{root:'source',source:'package.json',target:'electron/resources/app/package.json',group:'application',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
 // Required output resources directory, supplied as an inert fixture file.
 const dummy=Buffer.from('inert');await fs.writeFile(path.join(roots.electron,'dummy'),dummy);
 p.files.push({root:'electron',source:'dummy',target:'electron/resources/dummy',group:'electron',bytes:dummy.length,sha256:createHash('sha256').update(dummy).digest('hex')});
 await fs.writeFile(path.join(moduleRoot,'resources/linux-inert-package-plan.json'),JSON.stringify(p));
 const {buildLinuxInertPackage}=require(path.join(moduleRoot,'scripts/build.cjs'));
 const out=await buildLinuxInertPackage({roots,outputParent});assert.equal(out.distributionReady,false);assert.equal(out.asarSourceFiles,1);
 await assert.rejects(fs.lstat(path.join(out.destination,'electron/resources/app.asar')),{code:'ENOENT'});
 const physical=path.join(out.destination,'electron/resources/app/package.json');
 const physicalStat=await fs.lstat(physical);const handle=await fs.open(physical,'r');try {assert.equal((await handle.stat()).ino,physicalStat.ino);assert.equal(physicalStat.nlink,1);}finally{await handle.close();}
 const generated=out.files.find(r=>r.path==='audit/app.asar');assert(generated);
 const archiveBytes=await fs.readFile(path.join(out.destination,generated.path));assert.equal(generated.bytes,archiveBytes.length);assert.equal(generated.sha256,createHash('sha256').update(archiveBytes).digest('hex'));
 const saved=JSON.parse(await fs.readFile(path.join(out.destination,'INERT_PACKAGE_INVENTORY.json'),'utf8'));assert.deepEqual(saved.files.find(r=>r.path===generated.path),generated);
 assert.equal((await fs.stat(path.join(out.destination,'audit/app.asar'))).mode&0o111,0);
 assert.equal((await fs.stat(path.join(out.destination,'electron/resources/dummy'))).mode&0o111,0);
 await fs.writeFile(path.join(roots.source,'package.json'),'changed');
 const before=await fs.readdir(outputParent);await assert.rejects(buildLinuxInertPackage({roots,outputParent}));assert.deepEqual(await fs.readdir(outputParent),before);
});

test('generated ASAR exact member set and whole-file identity are verified',async t=>{
 const {verifyGeneratedAsar}=require('../scripts/build-linux-inert-package.cjs');
 const {pathToFileURL}=require('node:url');const asar=await import(pathToFileURL(require.resolve('@electron/asar')).href);
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'asar-identity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const app=path.join(root,'app');await fs.mkdir(path.join(app,'nested'),{recursive:true});const bytes=Buffer.from('inert member');await fs.writeFile(path.join(app,'nested','test.txt'),bytes);
 const archive=path.join(root,'app.asar');await asar.createPackage(app,archive);
 const rows=[{target:'electron/resources/app/nested/test.txt',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
 const identity=await verifyGeneratedAsar(asar,archive,rows),actual=await fs.readFile(archive);
 assert.equal(identity.bytes,actual.length);assert.equal(identity.sha256,createHash('sha256').update(actual).digest('hex'));
 await assert.rejects(verifyGeneratedAsar(asar,archive,[]),/member set/);
 await assert.rejects(verifyGeneratedAsar(asar,archive,[...rows,{...rows[0],target:'electron/resources/app/missing.txt'}]),/member set/);
 await assert.rejects(verifyGeneratedAsar(asar,archive,[{...rows[0],sha256:'0'.repeat(64)}]));
});


test('physical relocated app preserves real product source and compact qualification checks',async t=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'real-product-layout-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(__dirname,'..'),app=path.join(root,'electron/resources/app');
 for(const row of PLAN.files.filter(r=>r.group==='application')) {
  const member=row.target.slice('electron/resources/app/'.length),dest=path.join(app,member);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(source,row.source),dest);
 }
 const q=require(path.join(app,'linux-blue/product-linux-qualification.cjs'));
 assert.equal(q.verifyProductSources().files,137);assert.equal(q.loadQualification().scope,'internal-opt-in-four-family-candidate');
 const moved=path.join(root,'moved');await fs.rename(path.join(root,'electron'),moved);
 const relocated=require(path.join(moved,'resources/app/linux-blue/product-linux-qualification.cjs'));
 assert.equal(relocated.verifyProductSources().files,137);assert.equal(relocated.loadQualification().nativeProof,null);
 await assert.rejects(fs.lstat(path.join(moved,'resources/app.asar')),{code:'ENOENT'});
});


test('Linux candidate basename selects packaged convention with unchanged sibling resources',()=>{
 const row=PLAN.files.find(r=>r.target==='electron/ffmpeg-encoder-linux-candidate');assert(row);
 assert.equal(row.bytes,228605256);assert.equal(row.sha256,'10a14d05c6ff4f94075cfb3eeb6ed6571be33ebcc08cbd675b5ce9ff84706564');
 assert.equal(row.source,'electron');assert.equal(row.root,'electron');
 assert(!PLAN.files.some(r=>r.target==='electron/electron'));
 assert.notEqual(path.posix.basename(row.target),'electron');
 assert(PLAN.files.some(r=>r.target==='electron/resources/app/package.json'));
 for(const binary of ['ffmpeg','ffprobe'])assert(PLAN.files.some(r=>r.target==='electron/resources/runtime/'+binary));
 const main=require('node:fs').readFileSync(path.join(__dirname,'../main.js'),'utf8');
 assert(main.includes("app.isPackaged ? process.resourcesPath : root"));
 assert(!main.includes('ELECTRON_FORCE_IS_PACKAGED'));
});


test('actual current package plan satisfies actual internal builder anchor; historical/mutated pairs refuse',()=>{
 const {validateCurrentProductPair}=require('../scripts/build-linux-inert-package.cjs');
 assert.doesNotThrow(()=>validateCurrentProductPair(PLAN));
 const historical=require('../src/linux-runtime-descriptor.cjs').DESCRIPTOR;
 for(const mutate of [
  p=>{const pin=historical.files[0];p.files.find(x=>x.target==='electron/resources/'+pin.path).sha256=pin.sha256;},
  p=>p.files.find(x=>x.target==='electron/resources/runtime/ffprobe').bytes++,
  p=>p.files=p.files.filter(x=>x.target!=='electron/resources/runtime/ffmpeg'),
  p=>p.files.push({...p.files.find(x=>x.target==='electron/resources/runtime/ffmpeg')}),
 ]){const p=clone();mutate(p);assert.throws(()=>validateCurrentProductPair(p),/Exact approved current Linux product pair/);}
 const pins=PLAN.files.filter(x=>['electron/resources/runtime/ffmpeg','electron/resources/runtime/ffprobe'].includes(x.target));
 const identity=createHash('sha256').update(JSON.stringify(['ffmpeg','ffprobe'].map(tool=>{const p=pins.find(x=>x.target.endsWith('/'+tool));return {sizeBytes:p.bytes,sha256:p.sha256};}))).digest('hex');
 assert.equal(identity,'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13');
});

test('actual builder accepts real current plan before refusing absent input owners, without creating output',async()=>{
 const {buildLinuxInertPackage}=require('../scripts/build-linux-inert-package.cjs');
 const absent=path.join(os.tmpdir(),'absent-current-pair-'+require('node:crypto').randomUUID());
 const roots=Object.fromEntries(['source','electron','inputs','guidance','hostDocs'].map(k=>[k,path.join(absent,k)]));
 await assert.rejects(buildLinuxInertPackage({roots,outputParent:path.join(absent,'output')}),{code:'ENOENT'});
 await assert.rejects(fs.lstat(absent),{code:'ENOENT'});
});
