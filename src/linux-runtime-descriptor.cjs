'use strict';
// Non-default engineering artifact only. This descriptor is NOT a runtime grant.
function freeze(value) { if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
const DESCRIPTOR=freeze({
  schema:1,id:'linux-candidate-9.0.2-pair-staging-v1',platform:'linux',arch:'x64',
  scope:'pair-bytes-only-not-encoding-authority',distributionReady:false,
  runtimeIdentity:'1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9',
  files:[
    {role:'ffmpeg',path:'runtime/ffmpeg',bytes:46175848,sha256:'ae5b2e8b48ad0e9b51b89ebab000ebcfc0b76a09b8cb80c88e18fddcc5d9e8ba'},
    {role:'ffprobe',path:'runtime/ffprobe',bytes:45962728,sha256:'923dab8640da8804c445418b6e2efe4b395665bdb9d4cfc84f6a244ed0fb156b'}
  ],
  abiObservation:{elfClass:'ELF64',machine:'x86-64',requiredGlibcSymbol:'GLIBC_2.38',supportMatrix:'unqualified'},
  unresolvedDependencies:['libm.so.6','libc.so.6','libgcc_s.so.1','libstdc++.so.6','libdav1d.so.7','libSvtAv1Enc.so.2','ELF interpreter'],
  releaseBlockers:['Dependency strategy and CPU/desktop baseline not qualified.','Corresponding source and runtime dependency notices not staged or reviewed.','Production Linux catalog/composition not connected.','Electron Linux artifact and native package not built or tested.'],
  provenance:{sourceRecord:'linux-blue/RUNTIME_AV1_CHECKPOINT.md',sourceVersion:'FFmpeg 9.0.2',qualification:'Existing local candidate bytes only; no portability or reproducible-build claim.'}
});
module.exports={DESCRIPTOR};
