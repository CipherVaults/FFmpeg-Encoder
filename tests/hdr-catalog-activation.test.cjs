'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),MANIFEST='resources/hdr-content-producers.json';
const {HDR_CONTENT_PRODUCER_PATHS}=require('../src/hdr-catalog-seals.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
  const root=path.join(ROOT,'artifacts/v0.7/p-completion-2026-10-23/qualification-maintenance-fixtures/hdr-activation',randomUUID());
  for(const relative of [...HDR_CONTENT_PRODUCER_PATHS,MANIFEST,'src/hdr-catalog.cjs']){
    const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,relative),target,fs.constants.COPYFILE_EXCL);
  }
  const catalog=path.join(root,'src/hdr-catalog.cjs'),reader=require(path.join(root,'src/hdr-catalog-seals.cjs'));
  const manifestSha256=sha(fs.readFileSync(path.join(root,MANIFEST)));
  t.diagnostic('Retained final-byte HDR activation fixture '+root);
  return{root,reader,manifestSha256,load:()=>{delete require.cache[require.resolve(catalog)];return require(catalog);}};
}
test('final source activates exactly two preserved and two separately evidenced finite SDR policies',t=>{
  const h=fixture(t),catalog=h.load(),policies=catalog.HDR_POLICIES;
  assert.equal(h.reader.verifyHdrCatalogSeals(h.manifestSha256,h.root),true);
  assert.deepEqual(policies.map(p=>p.id).sort(),['content-cpu-hdr-arib-std-b67-v1','content-cpu-hdr-smpte2084-v1','content-cpu-sdr-arib-std-b67-v2','content-cpu-sdr-smpte2084-v2']);
  const original=JSON.parse(fs.readFileSync(path.join(ROOT,'resources/hdr-content-configurations.json')));
  for(const p of policies){
    assert.equal(p.runtimeIdentity,'56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6');
    assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.profiles)&&Object.isFrozen(p.evidenceIds));
    if(p.hdrPolicy==='sdr'){
      assert.equal(p.transformVersion,'software-hable-100nit-v2');assert.equal(p.profiles.length,1);assert.equal(p.outputProfiles.length,1);
      assert.equal(p.outputProfiles[0].outputMode,'sdr-bt709-main10');assert.equal(p.outputProfiles[0].transfer,'bt709');
    }else{
      assert.deepEqual(p.profiles,original.profiles.filter(v=>v.role==='source'&&v.transfer===p.transfer).map(({role,...v})=>v));
      assert.deepEqual(p.outputProfiles,original.profiles.filter(v=>v.role==='output'&&v.transfer===p.transfer).map(({role,...v})=>v));
      assert.ok(p.evidenceIds.includes('content-hdr-service:e2585ab6-1bc0-422a-ab2c-3209f194920e:sha256:95c1de9288ac6a6aa78fb4aa6878c5971c9eeb96c1675bcc2fa43774c6ca34bc'));
    }
  }
  assert.ok(Object.isFrozen(policies));
});
test('cached stateless verifier and fresh catalog reject changed final producers/resources',t=>{
  for(const relative of ['src/hdr-operation.cjs','src/hdr-catalog-seals.cjs','src/encode-preservation-catalog.cjs','src/operation-names.cjs','resources/hdr-sdr-content-configurations.json','ui/styles.css']){
    const h=fixture(t);assert.equal(h.load().HDR_POLICIES.length,4);
    fs.appendFileSync(path.join(h.root,relative),'\n ');
    assert.equal(h.reader.verifyHdrCatalogSeals(h.manifestSha256,h.root),false,relative);
    assert.equal(h.load().HDR_POLICIES.length,0,relative);
  }
  // Catalog exports are immutable module-load snapshots. This checks a cached
  // stateless reader plus a fresh catalog, not live cached-factory expiration.
});
test('missing or mixed producer manifest cannot retain activation',t=>{
  const missing=fixture(t);fs.renameSync(path.join(missing.root,'src/operation-names.cjs'),path.join(missing.root,'src/operation-names.retained'));
  assert.equal(missing.load().HDR_POLICIES.length,0);
  const mixed=fixture(t);fs.copyFileSync(path.join(ROOT,'src/hdr-encoding.cjs'),path.join(mixed.root,'src/hdr-operation.cjs'));
  assert.equal(mixed.load().HDR_POLICIES.length,0);
  const changedManifest=fixture(t);fs.appendFileSync(path.join(changedManifest.root,MANIFEST),'\n');assert.equal(changedManifest.load().HDR_POLICIES.length,0);
});
