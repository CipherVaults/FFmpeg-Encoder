'use strict';

// PROPOSAL ONLY. All nulls are deliberate refusal gates. Root may fill them
// only after separately joining the retained completed service jobs with
// the later numerical proof, independent review and final source checks. The
// retained service report stays overall FAILED. No proposal grants activation.
const { verifyHdrCatalogSeals, readHdrCatalogResource } = require('./hdr-catalog-seals.cjs');
const HASH = /^[a-f0-9]{64}$/;
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const REPORT = '95c1de9288ac6a6aa78fb4aa6878c5971c9eeb96c1675bcc2fa43774c6ca34bc';
const APPEARANCE_REVIEW = '765edb5ba5d1a461e2eac12b4f8f117e218bee69a00f3269c1d6f1af75f23316';
const CONFIGURATIONS = 'd3bc7baaa80a99ac8f8a03ad0a4d53d508beea7f722f1f9b93f3462aa9b0df28';
const MAINTENANCE_REVIEW = '0013eab1bc9974363a914a9354c2e442cb3b40325e36b53becea1bc014858c72';
const SDR_TEMPLATE_CERTIFICATION = '700f32f898e56fe465028514888123c6601d48b11e11c2a1b6da7dee05c7af17';
const PRODUCERS = 'c6e436264467718d06f5e118c56d01284b3acb7c971e2fcbda1081ae23f99e65'; // exact final69-file resources/hdr-content-producers.json
const MAINTENANCE_EVIDENCE = 'b72b4163ac9e2db44f6584ad71185d6f4659bada6194e3262cc73f62dc207b0b'; // named approved final-byte source/test amendment
const SDR_CONFIGURATIONS = '5de17d8fd4c5ed65519a196017a1268931d357d139aa2a345935b59544b9d618'; // final dedicated two-output-profile JSON bytes
const SDR_RETAINED_SERVICE_JOB_REPORT = '4273ae03d510ce9b9e6471da522e4c10341aa5c7ce1a799491ced9815eb1df28'; // exact4273ae03...df28; overall FAILED, two completed/published jobs
const SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT = '6f47eeece0eed5e350e042daefa77c4c6caa0a547ae848d4f8453514f4ca447a'; // exact6f47eeec...447a; zeroStarts/children, both32framepasses
const SDR_PAIRED_RESULT_REVIEW = '992da505cfea59351d05b5ca5d2997a23c196d102e24459fc41a4192f0ebafc7'; // exact992da505...afc7; joins raw/ROI/frame lineage and independent scores
const SDR_EVIDENCE_JOIN_REVIEW = 'fcad5c3a709611a58fb01c044f7afe458f96509c37899da15229dce29a15c093'; // root-reviewed explicit split-evidence join; excludes future catalog hash
const TRANSFORM_VERSION = 'software-hable-100nit-v2';
const freeze = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };
function policies() {
  try {
    if (![PRODUCERS,MAINTENANCE_EVIDENCE,SDR_CONFIGURATIONS,SDR_RETAINED_SERVICE_JOB_REPORT,SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT,SDR_PAIRED_RESULT_REVIEW,SDR_EVIDENCE_JOIN_REVIEW].every(v => typeof v === 'string' && HASH.test(v))
        || SDR_RETAINED_SERVICE_JOB_REPORT !== '4273ae03d510ce9b9e6471da522e4c10341aa5c7ce1a799491ced9815eb1df28'
        || SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT !== '6f47eeece0eed5e350e042daefa77c4c6caa0a547ae848d4f8453514f4ca447a'
        || SDR_PAIRED_RESULT_REVIEW !== '992da505cfea59351d05b5ca5d2997a23c196d102e24459fc41a4192f0ebafc7'
        || !verifyHdrCatalogSeals(PRODUCERS)) return [];
    const originalBytes = readHdrCatalogResource('resources/hdr-content-configurations.json',CONFIGURATIONS);
    const sdrBytes = readHdrCatalogResource('resources/hdr-sdr-content-configurations.json',SDR_CONFIGURATIONS);
    if (!originalBytes || !sdrBytes) return [];
    const original = JSON.parse(originalBytes), sdr = JSON.parse(sdrBytes);
    if (original.schema !== 1 || !Array.isArray(original.profiles) || original.profiles.length !== 10
        || Object.keys(sdr).sort().join(',') !== 'profiles,purpose,schema' || sdr.schema !== 1
        || !Array.isArray(sdr.profiles) || sdr.profiles.length !== 2
        || sdr.profiles.some(p => p.role !== 'output' || p.transfer !== 'bt709' || p.outputMode !== 'sdr-bt709-main10')
        || sdr.profiles.map(p => p.id).sort().join(',') !== 'p06-sdr-720p25-slow25-v2-fitting,p06-sdr-720p30-slow25-v2-fitting') return [];
    const amendment = ['qualification-maintenance-reviewed-delta:sha256:' + MAINTENANCE_EVIDENCE,
      'qualification-maintenance-independent-review:sha256:' + MAINTENANCE_REVIEW];
    const preserve = ['smpte2084','arib-std-b67'].map(transfer => ({
      id:'content-cpu-hdr-'+transfer+'-v1',transfer,runtimeIdentity:RUNTIME,
      evidenceIds:['content-hdr-service:e2585ab6-1bc0-422a-ab2c-3209f194920e:sha256:'+REPORT,
        'appearance-only-reviewed-delta:b977fece-ee12-491b-af54-e5eb7017ff69:sha256:'+APPEARANCE_REVIEW,...amendment],
      profiles:original.profiles.filter(p => p.role === 'source' && p.transfer === transfer).map(({role,...p}) => p),
      outputProfiles:original.profiles.filter(p => p.role === 'output' && p.transfer === transfer).map(({role,...p}) => p),
    }));
    const converted = ['smpte2084','arib-std-b67'].map(transfer => {
      const rate = transfer === 'smpte2084' ? '30/1' : '25/1';
      const sourceId = transfer === 'smpte2084' ? 'hdr-v1-source-v1' : 'hdr-v2-source-v1';
      const outputId = rate === '30/1' ? 'p06-sdr-720p30-slow25-v2-fitting' : 'p06-sdr-720p25-slow25-v2-fitting';
      const sources = original.profiles.filter(p => p.role === 'source' && p.id === sourceId);
      const outputs = sdr.profiles.filter(p => p.id === outputId);
      if (sources.length !== 1 || outputs.length !== 1 || outputs[0].frameRate !== rate) throw new Error('Exact reviewed SDR profile is absent.');
      return {id:'content-cpu-sdr-'+transfer+'-v2',transfer,hdrPolicy:'sdr',transformVersion:TRANSFORM_VERSION,runtimeIdentity:RUNTIME,
        evidenceIds:['sdr-retained-service-job-report:b82ffc65-6b7b-43b2-a8c2-3b074f8c5e46:sha256:'+SDR_RETAINED_SERVICE_JOB_REPORT,
          'sdr-fullframe-spatial-numeric-report:76cb79f2-18d0-4c19-9769-672d4b6553b8:sha256:'+SDR_FULLFRAME_SPATIAL_NUMERIC_REPORT,
          'sdr-independent-paired-result-review:76cb79f2-18d0-4c19-9769-672d4b6553b8:sha256:'+SDR_PAIRED_RESULT_REVIEW,
          'sdr-root-reviewed-split-evidence-join:sha256:'+SDR_EVIDENCE_JOIN_REVIEW,
          'sdr-output-template-independent-certification:sha256:'+SDR_TEMPLATE_CERTIFICATION,...amendment],
        profiles:sources.map(({role,...p}) => p),outputProfiles:outputs.map(({role,...p}) => p)};
    });
    return [...preserve,...converted];
  } catch { return []; }
}
const HDR_POLICIES = freeze(policies());
const HDR_POLICY_ID = 'content-cpu-hdr-preserve-and-sdr-v2:maintenance:' + (typeof MAINTENANCE_EVIDENCE === 'string' ? MAINTENANCE_EVIDENCE : 'unqualified');
module.exports = { HDR_POLICIES, HDR_POLICY_ID };
