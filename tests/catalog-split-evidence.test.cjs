'use strict';
// VM synthetic pin substitution isolates catalog logic; it grants no evidence,
// producer seal, service pass, media admission or activation authority.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const VALUES=Object.freeze({
  PRODUCERS:'a'.repeat(64),MAINTENANCE_EVIDENCE:'b'.repeat(64),SDR_CONFIGURATIONS:'c'.repeat(64),
  SDR_RETAINED_SERVICE_JOB_REPORT:'4273ae03d510ce9b9e6471da522e4c10341aa5c7ce1a799491ced9815eb1df28',
  SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT:'6f47eeece0eed5e350e042daefa77c4c6caa0a547ae848d4f8453514f4ca447a',
  SDR_PAIRED_RESULT_REVIEW:'992da505cfea59351d05b5ca5d2997a23c196d102e24459fc41a4192f0ebafc7',
  SDR_EVIDENCE_JOIN_REVIEW:'d'.repeat(64),
});
function load(overrides={},pending=false){
  let source=fs.readFileSync(path.join(ROOT,'src/hdr-catalog.cjs'),'utf8');
  for(const [name,actual]of Object.entries(VALUES)){
    const value=Object.hasOwn(overrides,name)?overrides[name]:pending?null:actual;
    const pattern=new RegExp('const '+name+' = (null|\'[a-f0-9]+\');');
    assert.equal((source.match(new RegExp(pattern.source,'g'))??[]).length,1,'one literal controlled constant '+name);
    source=source.replace(pattern,'const '+name+' = '+JSON.stringify(value)+';');
  }
  const context={module:{exports:{}},Buffer,require:name=>{
    assert.equal(name,'./hdr-catalog-seals.cjs');return {
      verifyHdrCatalogSeals:()=>true,
      readHdrCatalogResource:relative=>{
        assert.ok(['resources/hdr-content-configurations.json','resources/hdr-sdr-content-configurations.json'].includes(relative));
        return fs.readFileSync(path.join(ROOT,relative));
      },
    };
  }};
  vm.runInNewContext(source,context);
  return JSON.parse(JSON.stringify(context.module.exports));
}
test('all pending evidence refuses even when source/resource seals are deliberately bypassed',()=>{
  assert.equal(load({},true).HDR_POLICIES.length,0);
});
test('each separate activation pin is independently mandatory and must be a full raw digest',()=>{
  for(const name of Object.keys(VALUES))for(const missing of [null,'','e'.repeat(63),'E'.repeat(64)])
    assert.equal(load({[name]:missing}).HDR_POLICIES.length,0,name);
});
test('a valid-looking alternate or swapped report cannot replace the three exact retained facts',()=>{
  for(const name of ['SDR_RETAINED_SERVICE_JOB_REPORT','SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT','SDR_PAIRED_RESULT_REVIEW'])
    assert.equal(load({[name]:'e'.repeat(64)}).HDR_POLICIES.length,0,name);
  assert.equal(load({SDR_RETAINED_SERVICE_JOB_REPORT:VALUES.SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT}).HDR_POLICIES.length,0);
  assert.equal(load({SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT:VALUES.SDR_RETAINED_SERVICE_JOB_REPORT}).HDR_POLICIES.length,0);
});
test('synthetic approved-pin shape exposes two unchanged preserve and two finite explicit SDR cells',()=>{
  const policies=load().HDR_POLICIES;assert.equal(policies.length,4);
  const preserved=policies.filter(p=>p.hdrPolicy!=='sdr'),sdr=policies.filter(p=>p.hdrPolicy==='sdr');
  assert.equal(preserved.length,2);assert.equal(sdr.length,2);
  for(const p of preserved){
    assert.ok(p.evidenceIds.some(id=>id==='content-hdr-service:e2585ab6-1bc0-422a-ab2c-3209f194920e:sha256:95c1de9288ac6a6aa78fb4aa6878c5971c9eeb96c1675bcc2fa43774c6ca34bc'));
    assert.equal(p.evidenceIds.some(id=>id.startsWith('sdr-')),false);
  }
  const amendmentIds=[
    'qualification-maintenance-reviewed-delta:sha256:'+VALUES.MAINTENANCE_EVIDENCE,
    'qualification-maintenance-independent-review:sha256:0013eab1bc9974363a914a9354c2e442cb3b40325e36b53becea1bc014858c72',
  ];
  for(const p of policies)for(const id of amendmentIds)
    assert.equal(p.evidenceIds.filter(actual=>actual===id).length,1,id);
  for(const p of sdr){
    const pq=p.transfer==='smpte2084';assert.equal(p.transformVersion,'software-hable-100nit-v2');
    assert.equal(p.profiles.length,1);assert.equal(p.profiles[0].id,pq?'hdr-v1-source-v1':'hdr-v2-source-v1');
    assert.equal(p.outputProfiles.length,1);assert.equal(p.outputProfiles[0].id,pq?'p06-sdr-720p30-slow25-v2-fitting':'p06-sdr-720p25-slow25-v2-fitting');
    assert.equal(p.outputProfiles[0].frameRate,pq?'30/1':'25/1');
    assert.deepEqual(p.evidenceIds,[
      'sdr-retained-service-job-report:b82ffc65-6b7b-43b2-a8c2-3b074f8c5e46:sha256:'+VALUES.SDR_RETAINED_SERVICE_JOB_REPORT,
      'sdr-fullframe-spatial-numeric-report:76cb79f2-18d0-4c19-9769-672d4b6553b8:sha256:'+VALUES.SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT,
      'sdr-independent-paired-result-review:76cb79f2-18d0-4c19-9769-672d4b6553b8:sha256:'+VALUES.SDR_PAIRED_RESULT_REVIEW,
      'sdr-root-reviewed-split-evidence-join:sha256:'+VALUES.SDR_EVIDENCE_JOIN_REVIEW,
      'sdr-output-template-independent-certification:sha256:700f32f898e56fe465028514888123c6601d48b11e11c2a1b6da7dee05c7af17',
      ...amendmentIds,
    ]);
    assert.equal(p.evidenceIds.some(id=>id.startsWith('sdr-finite-service-laboratory:')),false);
    for(const profile of [...p.profiles,...p.outputProfiles])for(const key of ['sourceSha256','sourceFileSha256','fixtureHashes','sampleHashes'])
      assert.equal(Object.hasOwn(profile,key),false);
  }
});
