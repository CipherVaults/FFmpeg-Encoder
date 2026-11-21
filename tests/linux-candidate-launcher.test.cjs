'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'resources/linux-candidate');
const name='Launch-FFmpeg-Encoder-Linux-Candidate.sh';
const linux={skip:process.platform!=='linux'};
async function fixture(t){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'candidate launch '));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const electron=path.join(temp,'package with spaces','electron');await fs.mkdir(electron,{recursive:true});await fs.copyFile(path.join(directory,name),path.join(electron,name));await fs.writeFile(path.join(electron,'ffmpeg-encoder-linux-candidate'),'#!/bin/sh\nprintf "%s\\n" "$#" "$@" "${ELECTRON_RUN_AS_NODE-unset}" > "$TEST_RECEIPT"\nexit 17\n',{mode:0o700});return {temp,electron,launcher:path.join(electron,name),receipt:path.join(temp,'observed.txt')};}
function invoke(f,args=[],options={}){return spawnSync('/bin/sh',[f.launcher,...args],{cwd:'/',env:{...process.env,TEST_RECEIPT:f.receipt},encoding:'utf8',...options});}
test('explicit candidate launch uses package-relative executable, literal flag and exit status from unrelated cwd',linux,async t=>{const f=await fixture(t),result=invoke(f);assert.equal(result.status,17);assert.deepEqual((await fs.readFile(f.receipt,'utf8')).split('\n').slice(0,2),['1','--linux-unified-candidate']);});
test('relative script path with spaces resolves without changing candidate arguments',linux,async t=>{const f=await fixture(t);const result=spawnSync('/bin/sh',['./package with spaces/electron/'+name],{cwd:f.temp,env:{...process.env,TEST_RECEIPT:f.receipt},encoding:'utf8'});assert.equal(result.status,17);assert.match(await fs.readFile(f.receipt,'utf8'),/^1\n--linux-unified-candidate\n/);});
test('arguments are rejected before any executable invocation',linux,async t=>{const f=await fixture(t);for(const value of ['--no-sandbox','--user-data-dir=/tmp/other','file.mp4']){assert.equal(invoke(f,[value]).status,64);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});}});
test('script symlink refuses rather than changing package origin',linux,async t=>{const f=await fixture(t),link=path.join(f.temp,'alias.sh');await fs.symlink(f.launcher,link);assert.equal(invoke({...f,launcher:link}).status,64);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});});
test('missing package executable fails without PATH fallback',linux,async t=>{const f=await fixture(t);await fs.unlink(path.join(f.electron,'ffmpeg-encoder-linux-candidate'));assert.notEqual(invoke(f).status,0);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});});
test('pre-main runtime and loader overrides refuse without executing or clearing them',linux,async t=>{const f=await fixture(t);for(const key of ['ELECTRON_RUN_AS_NODE','ELECTRON_FORCE_IS_PACKAGED','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS','LD_UNRECOGNIZED_TEST']){for(const value of ['', '1']){const result=invoke(f,[],{env:{...process.env,TEST_RECEIPT:f.receipt,[key]:value}});assert.equal(result.status,64);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});}}});
test('actual fixed plan binds the launcher artifacts and the reviewed application inventory',async()=>{
  const plan=require('../resources/linux-inert-package-plan.json');
  const builder=require('../scripts/build-linux-inert-package.cjs');
  builder.validatePlan(plan);
  builder.validateCurrentProductPair(plan);
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const rowsByTarget=new Map(plan.files.map(row=>[row.target,row]));
  for(const file of [name,'CANDIDATE_README.txt','CANDIDATE_FINALIZATION.json']){
    const target='electron/'+file, bytes=await fs.readFile(path.join(directory,file));
    assert.deepEqual(rowsByTarget.get(target),{
      root:'source',source:'resources/linux-candidate/'+file,target,group:'candidate-launcher',
      bytes:bytes.length,sha256:digest(bytes),
    },target);
  }

  // CP138/139 added the MP3 triplet over fe3d787 (172 application,
  // 273 total, 155 active). Preserve CP144 and the successor inventory hashes.
  // The only permitted membership change is old calibration CLI out, timing
  // helper in. Reconstruct CP144 by reversing exactly that one change.
  assert.equal(plan.files.filter(row=>row.group==='application').length,175);
  assert.equal(plan.files.length,276);
  const historical='scripts/v07-sdr-flac-range-calibration.cjs';
  const helper='linux-blue/flac-timing-qualification.cjs';
  const historicalTarget='electron/resources/app/'+historical;
  const helperTarget='electron/resources/app/'+helper;
  const helperRow=rowsByTarget.get(helperTarget);
  assert.ok(helperRow,'reviewed timing helper missing from current package');
  assert.equal(rowsByTarget.has(historicalTarget),false,'historical CLI must not be in the current package');
  assert.equal(plan.files.some(row=>row.root==='source'&&row.source===historical),false);
  assert.equal(plan.files.filter(row=>row.root==='source'&&row.source===helper).length,1);
  const topology=rows=>[...rows.keys()].sort().map(target=>{
    const {root,source,group}=rows.get(target);
    return [root,source,target,group];
  });
  assert.equal(digest(JSON.stringify(topology(rowsByTarget))),'007c45246cd32481be82a47a321753fa6539c876801d668d0e404593fc747627',
    'reviewed current inert package topology changed');
  const cp144Rows=new Map(rowsByTarget);
  cp144Rows.delete(helperTarget);
  cp144Rows.set(historicalTarget,{root:'source',source:historical,group:'application'});
  assert.equal(digest(JSON.stringify(topology(cp144Rows))),'85507bd980ca27c7e111afe9eb0cd6fcb15d8ccad02243e696bdd6ff2ae87833',
    'reversing the one reviewed row substitution must recover CP144 topology');

  const qualificationFile=require.resolve('../linux-blue/product-linux-qualification.cjs');
  const qualification=require(qualificationFile);
  assert.deepEqual(qualification.verifyProductSources(),{
    scope:'reviewed-product-source-closure-only',files:158,usableForEncoding:false,
  });
  const declaration=(await fs.readFile(qualificationFile,'utf8')).match(/const SOURCE_PINS = (\{[\s\S]*?\n\});/);
  assert.ok(declaration,'reviewed active source pin declaration missing');
  const pins=JSON.parse(declaration[1]);
  assert.equal(Object.hasOwn(pins,historical),false,'historical CLI must not be an active source pin');
  assert.equal(Object.hasOwn(pins,helper),true,'reviewed timing helper missing from active pins');
  const helperBytes=await fs.readFile(path.join(root,helper));
  assert.deepEqual(pins[helper],{bytes:helperBytes.length,sha256:digest(helperBytes)});
  assert.deepEqual(helperRow,{root:'source',source:helper,target:helperTarget,group:'application',...pins[helper]});
  const activePaths=Object.keys(pins).sort();
  assert.equal(digest(JSON.stringify(activePaths)),'8333b16d218c95f93cc3e4e32e27a40e83c245b71523f35f9fbf5d9542ed904a',
    'reviewed current active product paths changed');
  const cp144Paths=activePaths.map(source=>source===helper?historical:source).sort();
  assert.equal(digest(JSON.stringify(cp144Paths)),'5e51b617d0dd575c789a396ccc9d9a1034e4518fb1fd7741edfaa9192678d4e6',
    'reversing the one reviewed pin substitution must recover CP144 active paths');

  const mp3Pins={
    'linux-blue/product-mp3-source.cjs': {bytes:7623,sha256:'e8b552a2e10dda42e2bc2b7431adbb63d761d823fa0cc8c8a3b99cbbf9d58389'},
    'linux-blue/product-mp3-inspection.cjs': {bytes:7978,sha256:'93894552037b4abce9c92a2d0c97558b3ae0dee91a665af0c8963f127181c435'},
    'linux-blue/product-mp3-prepare.cjs': {bytes:4714,sha256:'c85a2b894cace7a7c57c67aa8ac041225be9f41fec954122c0a11838abc8a1c2'},
  };
  for(const [source,pin] of Object.entries(mp3Pins)){
    const target='electron/resources/app/'+source;
    assert.deepEqual(rowsByTarget.get(target),{root:'source',source,target,group:'application',...pin},target);
    assert.deepEqual(pins[source],pin,source+' active pin');
    const bytes=await fs.readFile(path.join(root,source));
    assert.deepEqual({bytes:bytes.length,sha256:digest(bytes)},pin,source+' current bytes');
  }
});
test('finalization is explicit, ordinary-mode-only and does not assert distribution readiness',async()=>{const c=JSON.parse(await fs.readFile(path.join(directory,'CANDIDATE_FINALIZATION.json')));assert.deepEqual(c.executablePaths,[`electron/${name}`,'electron/ffmpeg-encoder-linux-candidate','electron/chrome-sandbox','electron/chrome_crashpad_handler','electron/resources/runtime/ffmpeg','electron/resources/runtime/ffprobe']);assert.equal(c.inertFileMode,'0600');assert.equal(c.ordinaryExecutableMode,'0755');assert.equal(c.allOtherFileMode,'0600');for(const k of ['requiresIndependentArtifactAudit','requiresSeparateLeadRelease','preserveOriginalInventory','preserveNotForDistributionMarker','preserveAllFileBytes','nativeLaunchRequiresSeparateGate'])assert.equal(c[k],true);assert.equal(c.automaticFinalization,false);assert.equal(c.distributionReady,false);});

test('symlink executable refuses even when its target is executable',linux,async t=>{const f=await fixture(t),exe=path.join(f.electron,'ffmpeg-encoder-linux-candidate'),other=path.join(f.temp,'other');await fs.rename(exe,other);await fs.symlink(other,exe);assert.equal(invoke(f).status,64);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});});
test('nonordinary directory or nonexecutable regular target refuses',linux,async t=>{const f=await fixture(t),exe=path.join(f.electron,'ffmpeg-encoder-linux-candidate');await fs.chmod(exe,0o600);assert.equal(invoke(f).status,64);await fs.unlink(exe);await fs.mkdir(exe);assert.equal(invoke(f).status,64);await assert.rejects(fs.stat(f.receipt),{code:'ENOENT'});});
