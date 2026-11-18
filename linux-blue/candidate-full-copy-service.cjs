'use strict';
// Developer-only Full1080p30-to-720p copied-AAC normal-service composition. Only the explicit developer workbench imports this module; default application routes are unchanged.
// Raw calibration/runtime files are local restoration prerequisites, not bundled source.
// Retained duplicate-codec and NUMA/thread-pool warnings do not qualify performance.
// A cancelled session requires a NEW service and NEW verified candidate handle.
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { ClockQualifiedFamilySelector, clockGuardedRunner } = require('./workbench-long-range-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { FULL_COPY_FAMILY_ID: FAMILY_ID, FULL_COPY_RESOURCE_POLICY: RESOURCE_POLICY, deriveCfrFullResizeCopyResources } = require('../src/operation-resource-budget.cjs');
const { FROZEN, SPECS } = require('./candidate-full-copy-calibration.cjs');
const RUNTIME_ID = '1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9';
const REPORT = path.join(__dirname, 'artifacts/candidate-full-copy-calibration-8wuK9M/report.json');
const REPORT_SHA = '5f74a9efb7981fefb242dcf34c82e972bbc269c5a5ea7a92c62a68db1bc34ad9';
const REPORT_BYTES = 207464;
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'CANDIDATE_FULL_COPY_SERVICE_SCOPE' }); };
// Literal producer closure independently enumerated from tested2714557.
// Saved-output audit a535b47cffd2dc40a79126c696c95c9a81ec28c1569236026709c02a5ac7da90.
// New composition is separately reviewed, not historically exercised by calibration.
// No pre-target decoded diagnostic hook is installed: normal collector verifies
// complete decoded source AFTER encode and BEFORE publication, unlike calibration.
const PRODUCERS = Object.freeze({
  "linux-blue/candidate-full-copy-calibration.cjs": "12aff9c8c7f2d58a0c1e2c64299c456918a965c16a41f35a28a6b3da0e1e228a",
  "package.json": "b5678dc133c1e5fb8da250bfe828c9da55f50d89dac3728af1f0870693e69a82",
  "src/media.cjs": "4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66",
  "src/provenance.cjs": "3fcce843cbc995086adda7b45444c23acedce9d54813c01b92123d97cfcff894",
  "src/vendor-profiles.cjs": "cc194f022665aa729410060804de2021175f0e87bd394fc18e4b3c47716cf65d",
  "src/backend-adapters.cjs": "7fbd1b2df2a0261e9d9b0457d224c4c3c77bfd2a4e16b497f8fb339d542847aa",
  "src/encode-preservation.cjs": "7de7fde7f20544f6b8480ca14b275865694163d3ed5608891c91c2be7aaabab4",
  "src/inspection.cjs": "948559c31919629326f02ebabe30a3a6918677c91cf9bba338bf382b3401c491",
  "src/remux-transport.cjs": "cd99370b3971d80cc917fa63c374005b3a895d25775b5084a91f9c6740b27c5e",
  "src/remux-native-inventory.cjs": "b98c0bbd232c6581cfaff9fd6579a2094baf7d0b48842a1a27910b32e45c5fa2",
  "src/process-runner.cjs": "257ae0ce717d086635a133535df9a73afd2609b83ad231ea8ed0798b3596395c",
  "src/media-evidence.cjs": "102de80ca6e3e4509448e015d2012bed7025502584e2f934ae2dbe2dfad19502",
  "src/source-identity.cjs": "fe6f73342936aa70ed6bbda98348da6fb892d05ddb566ee6d1664ba3f38e42bd",
  "src/outputs.cjs": "0871e35adb50b7fca7c177b6beb34c5533df8bac98751b55c8af31b8e422ca96",
  "src/operation-telemetry.cjs": "ef1f30ac5d311224cb8b0e79f60f55f55c69c0610d920d17e5f9c7e191a55814",
  "src/encode-operation.cjs": "ebd24233c03a78f2c67f6ce3787694eb9d73b0b3ee8da2f6758ae42deeb20a3a",
  "src/container-clock.cjs": "b823f1e41c4cca19a0b06d82dadf1941f4e0a0326b6d16bd910691c702763857",
  "src/operation-contract.cjs": "e87c0bd40a27e9bc4309cfff489a3270899edc6505face10a9c4461272bb343d",
  "src/operation-evidence.cjs": "9b680168395be354b8261bd4aa6624c1484daeecab424fd5278db55fa3aba9b9",
  "src/operation-resource-budget.cjs": "1914192dc877344b94bb6786a831e07b6e8b9704ee31c0a63fd225db426e5926",
  "src/operation-family.cjs": "c981fe49e8f67b674cd23eda6b6424ee031b022bbf1a90dfe2cb2b5d51f99f65",
  "linux-blue/candidate-calibration-runtime.cjs": "a62ceab690931736a7d7a81e7c6c7495987f7015f953013366ab6f5a0fd8217a",
  "src/operation-runtime.cjs": "95285842847006e2fbcad43d46bbca7bc3823c3378fdc33a755ee82398681b79",
  "src/remux-contract.cjs": "f420e73a9a95b310459c4dd7adb5b4e5657ea819d1b6f61a405ef72531c284da",
  "src/remux-metadata-policy.cjs": "56b613509412a0a986276a705e6fff57aa97577fd5b6def2aaec275781c129a8",
  "src/candidate-runtime.cjs": "9566a7691feab7cb65f5c739a723f99c48833064aea2edfe8cf410cc5dc0d712"
});
// Exact audited loaded-library inventory, not automatic ELF closure discovery.
const DEPENDENCIES = [
  {
    "path": "/usr/lib/x86_64-linux-gnu/libm.so.6",
    "sonamePath": "/lib/x86_64-linux-gnu/libm.so.6",
    "size": 977112,
    "sha256": "6d567d53e895273ca14a1f9dc164fc6c8d39aed2f60aa46a733c2784228915f3"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/libdav1d.so.7.0.0",
    "sonamePath": "/lib/x86_64-linux-gnu/libdav1d.so.7",
    "size": 1746880,
    "sha256": "1d7a4182344230d5f4cf9f58bf4485da2801c411e9c9fd6d8471460c75ae8fbf"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/libSvtAv1Enc.so.2.3.0",
    "sonamePath": "/lib/x86_64-linux-gnu/libSvtAv1Enc.so.2",
    "size": 7984736,
    "sha256": "48713dd9caf08909462bad0274cc9d9b249ccf836a9be72fd731f8d8096c4d35"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/libgcc_s.so.1",
    "sonamePath": "/lib/x86_64-linux-gnu/libgcc_s.so.1",
    "size": 182856,
    "sha256": "30c61ab012a4241bed033725a09b61f5fdd3bb7df95ee852d0b096520524c7af"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/libstdc++.so.6.0.33",
    "sonamePath": "/lib/x86_64-linux-gnu/libstdc++.so.6",
    "size": 2497768,
    "sha256": "972bb2a18b71140dab0240f8a1f68ab3fb1d56bcd4c4f824a91b70888faf5a00"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/libc.so.6",
    "sonamePath": "/lib/x86_64-linux-gnu/libc.so.6",
    "size": 1995216,
    "sha256": "9792e3cbb541c8f44c7acf5f14f4022ea62998ecc787d326bed4d8b6547dfd92"
  },
  {
    "path": "/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
    "sonamePath": "/lib64/ld-linux-x86-64.so.2",
    "size": 225672,
    "sha256": "c8438e4fde1934e61c88311633f00949ff645d5c04cdb8671fa3d78164d2f307"
  }
];
const TOOL_PINS = Object.freeze({"ffmpeg": {"size": 46175848, "sha256": "ae5b2e8b48ad0e9b51b89ebab000ebcfc0b76a09b8cb80c88e18fddcc5d9e8ba"}, "ffprobe": {"size": 45962728, "sha256": "923dab8640da8804c445418b6e2efe4b395665bdb9d4cfc84f6a244ed0fb156b"}});
const dependencyIdentity = sha(JSON.stringify(DEPENDENCIES));
function loaderGuard() {
  need(process.platform === 'linux' && process.arch === 'x64', 'Only the inspected Linux x64 candidate is admitted.');
  need(!process.env.NODE_OPTIONS && !Object.keys(process.env).some(k => k.startsWith('LD_') && process.env[k]), 'Loader overrides are not admitted.');
}
const hex = x => typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const nonnegative = x => Number.isSafeInteger(x) && x>=0;
function rationalEquals(value, seconds) {
  need(value && /^-?\d{1,30}$/.test(value.n) && /^[1-9]\d{0,29}$/.test(value.d), 'Bounded exact rational required.');
  return BigInt(value.n) === BigInt(seconds)*BigInt(value.d);
}
function assertCandidateServiceReceipt(bytes, expectedSha = REPORT_SHA) {
  // Alternate digest is pure validation/testing only, never live authority.
  need(Buffer.isBuffer(bytes) && bytes.length<=REPORT_BYTES && hex(expectedSha) && sha(bytes)===expectedSha, 'Exact bounded raw Full-copy receipt required.');
  let r;try{r=JSON.parse(bytes);}catch{need(false,'Malformed Full-copy JSON.');}
  need(r?.schema===1 && r.status==='passed-preregistered-full-copy-calibration' && r.runtimeIdentity===RUNTIME_ID
    && r.publicationAuthorized===false && r.catalogActivated===false && same(r.settings,SETTINGS)
    && same(r.frozen,FROZEN) && same(r.specs,SPECS), 'Exact preregistered Full-copy campaign required.');
  need(same(r.dependencies,DEPENDENCIES) && Object.entries(TOOL_PINS).every(([k,v])=>r.pins?.[k]?.size===v.size&&r.pins[k].sha256===v.sha256), 'Exact audited runtime identities required.');
  for(const key of ['failure','runtimeCloseFailure','telemetryCloseFailure','postCloseIdentityFailure','stageRetentionFailure','partialDiagnostic'])need(r[key]===undefined,'No failed or partial calibration authority.');
  need(r.postCloseIdentitiesVerified===true && r.diagnosticsComplete===true && same(r.census,{spawned:70,closed:70,live:0,maximum:1}) && Array.isArray(r.children)&&r.children.length===70,'Exact closed diagnostic census required.');
  for(const [i,c] of r.children.entries()){
    const e=c.stderr;need(c.index===i+1&&c.spawned===true&&c.closed===true&&c.exitCode===0&&c.signal===null&&!c.failure&&e?.completeAtSave===true&&nonnegative(e.bytes)&&e.bytes<=256*1024&&hex(e.sha256)&&e.capture?.totalBytes===e.bytes&&e.capture.truncated===false,'Successful bounded complete stderr required.');
  }
  need(Array.isArray(r.cases)&&r.cases.length===3,'All three audited cases required.');
  const labels=['source-video-frames','output-video-frames','source-audio-1-frames','output-audio-1-frames','output-audio-1-padding','source-audio-1-packet-identity','source-audio-1-header','output-audio-1-packet-identity','output-audio-1-header'];
  for(const [i,c] of r.cases.entries()){
    const spec=SPECS[i],seconds=spec.seconds,frames=seconds*30,samples=seconds*48000;
    need(c.id===spec.id&&c.status==='passed'&&c.sourceDiagnosticAccepted===true&&hex(c.source?.sha256)&&hex(c.output?.sha256)&&nonnegative(c.source.bytes)&&c.source.bytes>0&&String(c.source.bytes)===c.sourceIdentity?.size,'Exact admitted source/output case required.');
    need(same(c.resources,deriveCfrFullResizeCopyResources({sourceExtentUs:seconds*1000000,sourceBytes:c.sourceIdentity.size})),'Re-derived whole-source resource formula required.');
    need(c.pcmIdentity===undefined,'Copied AAC is not PCM identity.');
    for(const [isSource,d] of [[true,c.sourceDiagnostic],[false,c.outputDiagnostic]]){
      need(d?.collectorAuthority===false&&d.source===isSource&&d.file===(isSource?c.source.path:c.output.path)&&Array.isArray(d.files)&&same(d.files.map(x=>x.label),['video','audio','packets','header']),'Independent diagnostic shape required, never collector authority.');
      need(d.files.every(x=>nonnegative(x.bytes)&&nonnegative(x.records)&&hex(x.sha256)),'Bounded diagnostic file seals required.');
      need(d.video?.frames===frames&&d.audio?.samples===String(samples),'Complete decoded counts required.');
      if(isSource){
        for(const [kind,clock,count] of [['video','1/15360',seconds*15360],['audio','1/48000',samples]]){
          const row=d[kind];need(row.gaps===0&&row.cadence===true&&rationalEquals(row.first,0)&&rationalEquals(row.end,seconds)&&row.metadata?.startPts==='0'&&row.metadata.timeBase===clock&&row.metadata.durationTs===String(count),'Exact source origin/metadata/decoded extent required.');
        }
      } // Output AAC timestamps have bounded millisecond rounding, not exact adjacency.
      need(d.packets?.timeBase===(isSource?'1/48000':'1/1000')&&nonnegative(d.packets.count)&&d.packets.count>0&&['payloadSha256','paddingSha256','headerSha256'].every(k=>hex(d.packets[k])),'Coded packet/header/padding diagnostic seals required.');
    }
    for(const key of ['count','payloadSha256','paddingSha256','headerSha256'])need(c.sourceDiagnostic.packets[key]===c.outputDiagnostic.packets[key],'Independent copied coded identity differs.');
    const col=c.collection;need(col?.schema===1&&col.status==='completed'&&col.runtimeIdentity===RUNTIME_ID&&hex(col.planFingerprint)&&col.publicationAuthorized===false&&col.qualificationGranted===false&&col.scope==='complete-decoded-timing-and-copied-packet-identity'&&col.sourceIdentityDisposition==='unchanged'&&same(col.sourceBefore,col.sourceAfter)&&same(col.outputBefore,col.outputAfter),'Complete unchanged-source collection required.');
    need(col.sourcePath===c.source.path&&col.outputPath===c.output.path&&same(col.budget,c.resources.budget),'Collection must bind exact case paths and budget.');
    need(Array.isArray(col.invocations)&&same(col.invocations.map(x=>x.label),labels)&&col.invocations.every(x=>x.status==='completed'&&x.stderrCapture?.truncated===false&&x.stderrCapture.totalBytes===Buffer.byteLength(x.stderr)&&hex(x.capture?.sha256)),'Exact nine successful bounded collector streams required.');
    need(col.timingQualification?.runtimeIdentity===RUNTIME_ID&&col.timingQualification.videoDurationUs===FROZEN.videoDurationUs&&col.timingQualification.audioTimelineUs===FROZEN.audioTimelineUs&&col.timingQualification.aac===null,'Frozen interior bounds required.');
    const v=col.completeSource?.video,a=col.completeSource?.audio;
    need(v?.frames===frames&&v.properties?.policy===FAMILY_ID&&v.properties.framesChecked===frames&&v.properties.sampleAspectRatio==='1:1'&&v.properties.chromaLocation==='left'&&v.properties.sideDataPolicy==='h26x-unregistered-sei-only'&&rationalEquals(v.firstTime,0)&&rationalEquals(v.endTime,seconds)&&v.maximumNominalCadenceErrorUs===0&&v.maximumNominalDurationErrorUs===0&&v.maximumNominalPhaseErrorUs===0,'Complete source video evidence required.');
    need(Array.isArray(a)&&a.length===1&&a[0].inputIndex===1&&a[0].sampleCount===String(samples)&&a[0].gaps===0&&rationalEquals(a[0].firstTime,0)&&rationalEquals(a[0].endTime,seconds),'Complete source copied audio evidence required.');
    need(Array.isArray(col.packetIdentity)&&col.packetIdentity.length===1,'One coded audio identity required.');
    const p=col.packetIdentity[0];need(p.inputIndex===1&&p.outputIndex===1&&same(p.source,p.output)&&p.source.packets===c.sourceDiagnostic.packets.count&&hex(p.source.seal)&&p.source.payloadSha256===c.sourceDiagnostic.packets.payloadSha256&&p.source.sideDataSha256===c.sourceDiagnostic.packets.paddingSha256&&p.source.extradataSha256===c.sourceDiagnostic.packets.headerSha256,'Ordered coded/header/ordinal-padding identity required.');
    need(p.source.seal===sha(JSON.stringify({packets:p.source.packets,payloadSha256:p.source.payloadSha256,sideDataSha256:p.source.sideDataSha256,extradataSha256:p.source.extradataSha256})), 'Packet seal must bind coded identity facts.');
    const dv=col.decodedEvidence?.video,da=col.decodedEvidence?.audio;
    need(dv?.sourceFrameCount===frames&&dv.outputFrameCount===frames&&dv.comparedFrames===frames&&dv.firstSourcePtsUs===0&&dv.firstOutputPtsUs===0&&nonnegative(dv.maxRebasedTimestampErrorUs)&&dv.maxRebasedTimestampErrorUs<=FROZEN.tolerances.videoTimestampUs,'Whole video frame correspondence required.');
    need(Array.isArray(da)&&da.length===1,'One decoded copied stream required.');const d=da[0];
    need(d.inputIndex===1&&d.sourceSampleCount===samples&&d.outputSampleCount===samples&&d.firstSourcePtsUs===0&&d.firstOutputPtsUs===0&&d.lastSourceEndUs===seconds*1000000&&Math.abs(d.lastOutputEndUs-d.lastSourceEndUs)<=FROZEN.tolerances.audioTimestampUs&&d.encoderDelaySamples===1024&&d.discardPaddingSamples===[0,768,384][i]&&d.pcmIdentity===undefined&&d.packetIdentity?.algorithm==='sha256'&&d.packetIdentity.sourceSeal===p.source.seal&&d.packetIdentity.outputSeal===p.output.seal&&d.packetIdentity.packets===p.source.packets,'Exact decoded samples and audited padding without PCM claim required.');
    const tl=col.timelineComparisons;need(tl?.video?.comparedFrames===frames&&tl.video.toleranceUs===FROZEN.videoDurationUs&&nonnegative(tl.video.maximumDurationErrorUs)&&tl.video.maximumDurationErrorUs<=FROZEN.videoDurationUs&&tl.audio?.length===1,'Complete bounded interior comparison required.');
    const ta=tl.audio[0];need(ta.inputIndex===1&&ta.mode==='copy'&&ta.selectedSourceGaps===0&&ta.unmatchedSourceTailSamples===0&&ta.unmatchedOutputTailSamples===0&&ta.comparedSamples===samples&&ta.contentIdentity===false&&ta.toleranceUs===FROZEN.audioTimelineUs&&nonnegative(ta.maximumElapsedClockErrorUs)&&ta.maximumElapsedClockErrorUs<=FROZEN.audioTimelineUs,'Sample ordinal timeline comparison required.');
    need(c.telemetryValidation?.valid===true&&c.telemetryValidation.scope==='encoder-input-count-and-timeline-only'&&same(c.telemetryValidation.streams,[{outputIndex:0,kind:'video',unknownInputRecords:'0',correspondence:'reported-input-and-independent-selected-source'}])&&col.encoderInputs?.video?.records===String(frames)&&hex(col.encoderInputs.video.orderedPts),'Video-only complete encoder telemetry required.');
    const val=c.validation,t=val?.timing;need(val?.valid===true&&same(val.errors,[])&&val.validation==='decoded-operation-contract'&&t?.requested===null&&t.resolved===null&&t.video?.frames===frames&&t.video.startUs===0&&t.video.endUs===seconds*1000000&&t.audio?.length===1&&t.audio[0].mode==='copy'&&t.audio[0].sampleCountDifference===0,'Canonical Full/null copied-audio validation required.');
  }
  return r;
}

async function readReviewedReport() {
  need(await fs.realpath(REPORT) === REPORT, 'The original report must have a canonical non-symlink path.');
  const file = await fs.open(REPORT, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size === BigInt(REPORT_BYTES), 'The exact ordinary report size is required.');
    // Bounded positioned reads do not allocate an arbitrarily enlarged file.
    const bytes = Buffer.alloc(REPORT_BYTES + 1); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    need(offset === REPORT_BYTES && ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].every(k => before[k] === after[k]),
      'The original report changed during bounded reading.');
    const current = await fs.lstat(REPORT, { bigint: true });
    need(await fs.realpath(REPORT) === REPORT && ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].every(k => before[k] === current[k]), 'Report path replaced during reading.');
    return bytes.subarray(0, REPORT_BYTES);
  } finally { await file.close(); }
}
async function verifyCandidateServiceProducers() {
  for (const [name, digest] of Object.entries(PRODUCERS))
    need(sha(await fs.readFile(path.resolve(__dirname, '..', name))) === digest, 'Calibration producer changed: ' + name);
}
// Compatibility-path null is not a runnable fallback in this fixed developer route.
class FullCopySelector extends ClockQualifiedFamilySelector {
  select(options) { const token=super.select(options);need(token!==null,'Only genuine Full/null/720/copied-AAC selection is admitted.');return token; }
}
class OwnedCandidateService extends CandidateTrimService {
  #candidate;
  constructor(options, candidate, workbenchMode) { super(options); this.#candidate = candidate; this.workbenchMode = workbenchMode; }
  snapshot() {
    // Synchronous, current-owner-only presentation. Never await or accept a
    // callback-supplied older plan. Start still requires genuine current tokens.
    if (this.workbenchMode) {
      const state = this.state, plan = this.plan;
      for (const item of state.items) {
        if (item.status !== 'ready') continue;
        const entry = plan?.entries?.get(item.id);
        if (!entry?.qualificationSelection || !entry.operationRuntimeToken || !entry.operationPlan?.instrumentation || entry.operationPlan.compatibilityPath) {
          plan?.entries?.delete(item.id);
          item.status = 'unsupported'; item.reasonCode = 'CANDIDATE_FULL_COPY_REQUIRED';
          item.reason = 'Inspection only: choose Full, 720p and Copy audio per file, then Apply. Keep source and ranges are not qualified in this developer preview.';
        }
      }
    }
    const snapshot = super.snapshot();
    if (this.workbenchMode) snapshot.developerFullCopy = { enabled: true, relaunchRequired: this.admissionClosed,
      notice: 'Experimental whole-file 1080p30-to-720p only · H265 CPU slow / CRF 25 · copied AAC. Ranges, Keep source, other resolutions and Remux unavailable. CPU topology/thread-pool warnings remain; native threading/performance is not qualified.',
      relaunchNotice: 'This developer session is closed to new work. Close and relaunch to obtain a new verified runtime; same-session retry is unavailable.' };
    return snapshot;
  }
  async cancelCurrent() {
    // Preserve cancellation's invalidated operation/candidate tokens. No retry
    // route re-observes them. Main must close this service and open a new one.
    // Close synchronously: saved-write drainage and terminal callbacks may yield.
    this.closeAdmission();
    if (this.workbenchMode) this.emitState();
    return super.cancelCurrent();
  }
  async closeOperationResources() {
    const failures = [];
    try { await super.closeOperationResources(); } catch (error) { failures.push(error); }
    try { await this.#candidate.close(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Service and candidate resource closure failed.');
  }
}
async function createCandidateFullCopyService(options) {
  need(options && Object.getPrototypeOf(options) === Object.prototype, 'Inert main-owned options required.');
  const keys = Reflect.ownKeys(options);
  need(['verifiedRuntime', 'stateDir'].every(k => keys.includes(k))
    && keys.every(k => ['verifiedRuntime', 'stateDir', 'onChild', 'outputAccess', 'workbenchMode'].includes(k)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')), 'Only fixed main-owned service options are accepted.');
  const { verifiedRuntime, stateDir, onChild, outputAccess, workbenchMode = false } = options;
  const candidate = requireCandidateCalibrationRuntime(verifiedRuntime);
  let observer;
  try {
    need(typeof workbenchMode === 'boolean' && (outputAccess === undefined || outputAccess instanceof OutputAccess), 'Main-owned boolean workbench mode and genuine OutputAccess required.');
    need(typeof stateDir === 'string' && path.isAbsolute(stateDir) && stateDir === path.resolve(stateDir)
      && !/[\x00-\x1f\x7f]/.test(stateDir) && (onChild === undefined || typeof onChild === 'function'), 'Canonical state directory and child observer required.');
    need(candidate.runtimeIdentity === RUNTIME_ID && sha(JSON.stringify(candidate.dependencies)) === dependencyIdentity && Object.entries(TOOL_PINS).every(([k,v]) => candidate.pins[k]?.size === v.size && candidate.pins[k]?.sha256 === v.sha256),
      'The exact reviewed pair and loaded dependency inventory are required.');
    loaderGuard(); await candidate.requireCurrent();
    await verifyCandidateServiceProducers();
    assertCandidateServiceReceipt(await readReviewedReport(), REPORT_SHA);
    await verifyCandidateServiceProducers();
    await candidate.requireCurrent(); // Producer/report awaits cannot preserve stale authority.
    const invoke = clockGuardedRunner(candidate.createRunner({ onChild }), candidate.pins.ffprobe.path);
    const run = async (...args) => { loaderGuard(); await candidate.requireCurrent(); return invoke(...args); };
    observer = new OperationRuntimeObserver({
      runtime: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, v.path])),
      pins: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, { sizeBytes: v.size, sha256: v.sha256 }])), run,
    });
    // Fresh capsule IDs bind the exact reviewed report, not portable summaries.
    const id='full-copy-reviewed-2714557-'+REPORT_SHA.slice(0,16);
    const qualification={evidenceId:id+':endpoints',runtimeIdentity:RUNTIME_ID,containerDuration:FROZEN.containerDuration,tolerances:{...FROZEN.tolerances}};
    const timingQualification={evidenceId:id+':interior',runtimeIdentity:RUNTIME_ID,videoDurationUs:FROZEN.videoDurationUs,audioTimelineUs:FROZEN.audioTimelineUs,aac:null};
    const selector = new FullCopySelector({ policyIdentity: 'candidate-full-copy-normal-service-2714557', families: [{
      id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
      qualification, timingQualification, evidenceIds: [qualification.evidenceId, timingQualification.evidenceId],
    }] });
    return new OwnedCandidateService({ ffmpeg: candidate.pins.ffmpeg.path, ffprobe: candidate.pins.ffprobe.path,
      runtimeIdentity: RUNTIME_ID, stateDir, outputAccess, run, inspectionWorkers: 1, operationRuntime: observer, operationQualifications: selector,
      vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
      operationEvidenceBudget: null, operationDeadlineMs: 120000, operationTelemetry: true,
      operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
    }, candidate, workbenchMode);
  } catch (error) {
    const cleanup = await Promise.allSettled([observer?.close(), candidate.close()]);
    const failures = cleanup.filter(x => x.status === 'rejected');
    if (failures.length) throw new AggregateError([error,...failures.map(x=>x.reason)], 'Construction and owned cleanup failed', { cause:error });
    throw error;
  }
}
module.exports = { createCandidateFullCopyService, assertCandidateServiceReceipt, verifyCandidateServiceProducers,
  REPORT, REPORT_SHA, RUNTIME_ID };
