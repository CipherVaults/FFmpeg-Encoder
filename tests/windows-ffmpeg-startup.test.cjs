'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {selected,safeMember,inspectListing,runBounded}=require('../scripts/windows-ffmpeg-startup.cjs');
const rows=()=>selected().map(({member,pin})=>`Path = ${member}\nSize = ${pin.sizeBytes}\nAttributes = A\nEncrypted = -`).join('\n\n');
test('synthetic manifest layout accepts only the exact four selections',()=>assert.equal(inspectListing(rows()).length,4));
test('selected mapping is fixed by repository manifest, not caller pins',()=>assert.throws(()=>selected({})));
test('hostile and ambiguous paths refuse',()=>{for(const x of ['../x','/root','C:/x','a\\b','a:b','a/../b','a//b','a/NUL.txt','a/trailing.','a/*','a/space ','a\0b'])assert.throws(()=>safeMember(x),x);});
test('duplicate and casefold aliases refuse',()=>{assert.throws(()=>inspectListing(rows()+'\n\n'+rows().split('\n\n')[0]));assert.throws(()=>inspectListing(rows()+'\n\n'+rows().split('\n\n')[0].replace('ffmpeg-','FFMPEG-')));});
test('links, reparse/Unix attributes, duplicate fields and unknown listing formats refuse',()=>{for(const suffix of ['\nSymbolic Link = target','\nHard Link = target','\nReparse = +','\nPath = x'])assert.throws(()=>inspectListing(rows()+suffix));assert.throws(()=>inspectListing(rows().replace('Attributes = A','Attributes = lrwxrwxrwx')));assert.throws(()=>inspectListing('unsupported'));});
test('encrypted/size mismatch/missing selected member and expanded bombs refuse',()=>{for(const txt of [rows().replace('Encrypted = -','Encrypted = +'),rows().replace('227823104','227823105'),rows().split('\n\n').slice(1).join('\n\n'),rows()+'\n\nPath = ffmpeg-9.0.2-full_build/extra\nSize = 999999999999\nAttributes = A\nEncrypted = -'])assert.throws(()=>inspectListing(txt));});
function fake(chunks,code=0){return()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{queueMicrotask(()=>c.emit('close',null,'SIGTERM'));};queueMicrotask(()=>{for(const b of chunks)c.stdout.emit('data',Buffer.from(b));c.emit('close',code,null);});return c;};}
test('bounded child success requires close and collects only capped output',async()=>assert.deepEqual(await runBounded('injected',[],{limit:4,spawnImpl:fake(['ok'])}),{bytes:2,stdout:'ok'}));
test('oversize and nonzero child refuse',async()=>{await assert.rejects(runBounded('injected',[],{limit:1,spawnImpl:fake(['xx'])}));await assert.rejects(runBounded('injected',[],{limit:1,spawnImpl:fake([],1)}));});
test('timeout kills and waits for observed close',async()=>{let killed=false;const spawnImpl=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{killed=true;queueMicrotask(()=>c.emit('close',null,'SIGTERM'));};return c;};await assert.rejects(runBounded('injected',[],{limit:1,timeout:5,spawnImpl}));assert.equal(killed,true);});
test('oversized selected stream cannot write beyond admitted bytes',async()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const d=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-stream-'));const p=path.join(d,'partial');const fd=fs.openSync(p,'wx');try{await assert.rejects(runBounded('injected',[],{limit:2,fd,spawnImpl:fake(['ok','extra'])}));assert.equal(fs.readFileSync(p,'utf8'),'ok');}finally{fs.closeSync(fd);fs.rmSync(d,{recursive:true});}});
test('unbounded listing and file-as-ancestor refuse',()=>{assert.throws(()=>inspectListing('x'.repeat(1024*1024+1)));assert.throws(()=>inspectListing(rows()+'\n\nPath = ffmpeg-9.0.2-full_build/bin\nSize = 0\nAttributes = A\nEncrypted = -'));});
test('stderr cap and spawn error remain failures after close',async()=>{for(const mode of ['stderr','error']){const spawnImpl=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>queueMicrotask(()=>c.emit('close',null,'SIGTERM'));queueMicrotask(()=>{if(mode==='stderr')c.stderr.emit('data',Buffer.alloc(65537));else{c.emit('error',new Error('injected'));c.emit('close',-1,null);}});return c;};await assert.rejects(runBounded('injected',[],{limit:1,spawnImpl}));}});
test('actual pinned archive listing selects exact existing manifest payload',()=>{const fs=require('node:fs'),path=require('node:path');assert.equal(inspectListing(fs.readFileSync(path.join(__dirname,'fixtures/windows-ffmpeg-9.0.2-listing.txt'),'utf8')).length,4);});
test('all startup phase failures retain bounded stage and partial disposition',async()=>{const {applyStartup}=require('../scripts/windows-hosted-archive-check.cjs');for(const startupStage of ['preflight','tool-identification','listing','extraction','provisioning','version','final-checks']){const report={extraction:'not-run',installation:'not-run'};await applyStartup(report,async()=>{throw Object.assign(new Error('secret path and output'),{startupStage,code:'ENOSPC'});});assert.equal(report.state,'FFMPEG_STARTUP_FAILED');assert.equal(report.startup.stage,startupStage);assert.equal(report.startup.code,'ENOSPC');assert.equal(report.extraction,'failed-or-partial-unverified');assert.equal(report.installation,'failed-or-partial-unverified');assert(!JSON.stringify(report).includes('secret'));}});
test('unknown diagnostic labels cannot leak; successful startup has explicit restricted scope',async()=>{const {applyStartup}=require('../scripts/windows-hosted-archive-check.cjs');const {startupDiagnostic}=require('../scripts/windows-ffmpeg-startup.cjs');assert.deepEqual(startupDiagnostic({startupStage:'private',name:'private',code:'private',message:'private'}),{stage:'preflight',kind:'Error',code:'UNCLASSIFIED',listingReason:null,listing:null});const r={};await applyStartup(r,async()=>({state:'FFMPEG_VERSION_VERIFIED_ONLY'}));assert.equal(r.state,'FFMPEG_VERSION_VERIFIED_ONLY');assert.equal(r.installation,'isolated-ffmpeg-only');});
test('Windows separators remain refused and diagnosed, not silently normalized',()=>{
 const {listingStructure,startupDiagnostic}=require('../scripts/windows-ffmpeg-startup.cjs');
 const text=rows().replaceAll('/','\\');const structure=listingStructure(text);
 assert.equal(structure.separators.backward,4);assert.equal(structure.separators.forward,0);
 let e;try{inspectListing(text);}catch(error){e=error;}assert(e);e.startupStage='listing-parse';e.listingStructure=structure;
 const d=startupDiagnostic(e);assert.equal(d.listingReason,'PATH_SEPARATOR');assert.equal(d.stage,'listing-parse');assert.equal(d.listing,structure);
 assert(!JSON.stringify(d).includes('ffmpeg-9.0.2'));assert(!JSON.stringify(d).includes('\\'));
});
test('structural diagnostics expose only bounded known names, never unknown names or values',()=>{
 const {listingStructure,startupDiagnostic}=require('../scripts/windows-ffmpeg-startup.cjs');
 const text=rows()+'\nPrivateNameSecret = /private/hostpath\nAttributes = lrwxprivate\nmalformed-private';
 const s=listingStructure(text);assert.equal(s.unknownFields,1);assert.equal(s.malformedLines,1);assert.equal(s.attributes.other,1);
 assert(!JSON.stringify(s).includes('private'));assert(!JSON.stringify(s).includes('PrivateName'));assert(Object.isFrozen(s));
 assert.equal(startupDiagnostic({listingStructure:{private:'secret'},listingReason:'secret'}).listing,null);
 assert.equal(listingStructure('x'.repeat(1048577)),null);
});
test('field, link, duplicate and expanded size violations have distinct safe reasons',()=>{
 const cases=[['FIELD_UNKNOWN',rows()+'\nSymbolic Link = secret'],['FIELD_DUPLICATE',rows()+'\nPath = secret'],['ATTRIBUTES',rows().replace('Attributes = A','Attributes = lrwx')],['SIZE_OR_ENCRYPTION',rows().replace('Encrypted = -','Encrypted = +')],['SELECTED_MEMBER',rows().replace('227823104','227823105')]];
 for(const [reason,text] of cases)assert.throws(()=>inspectListing(text),e=>e.listingReason===reason);
});
test('four listing boundaries retain distinct safe diagnostics through wrapper failure publication',async()=>{
 const {applyStartup}=require('../scripts/windows-hosted-archive-check.cjs');
 for(const startupStage of ['listing-command','listing-parse','post-list-capacity','post-list-owner']){
  const r={};await applyStartup(r,async()=>{throw Object.assign(new assert.AssertionError({message:'private'}),{startupStage});});assert.equal(r.startup.stage,startupStage);assert.equal(r.state,'FFMPEG_STARTUP_FAILED');assert(!JSON.stringify(r).includes('private'));
 }
});
