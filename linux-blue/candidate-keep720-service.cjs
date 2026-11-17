'use strict';
// Developer-only Keep720 normal-service proof. No application imports this module.
// A cancelled session requires a NEW service and NEW verified candidate handle.
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { OutputAccess } = require('../src/output-access.cjs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { ClockQualifiedFamilySelector, clockGuardedRunner, assertProportionalReceiptForRuntime } = require('./workbench-long-range-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { FAMILY_ID, RESOURCE_POLICY, deriveCfrFlacResources } = require('../src/operation-resource-budget.cjs');
const RUNTIME_ID = '1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9';
const REPORT = path.join(__dirname, 'artifacts/candidate-keep720-calibration-g1p64G/report.json');
const REPORT_SHA = '1feb0f2958c78cc73683c70fed08835d1e61b98462e8b30e0127f95b5cf350ab';
const REPORT_BYTES = 55953;
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'CANDIDATE_KEEP720_SERVICE_SCOPE' }); };
// Complete literal relative-import closure rooted at the calibration producer,
// from immutable 54ee143. This excludes separately reviewed new composition code.
const PRODUCERS = Object.freeze({
  "linux-blue/workbench-long-range-calibration.cjs": "002cb7974a6e55c6b2ee5e58e29218dd1a07e84853c417615cc40629770a8a80",
  "linux-blue/runtime-av1-operation.cjs": "f664ec1a79ac95683bdb062633e454259dab25e8bfa00fecae7f8ed39dc921cc",
  "src/process-runner.cjs": "257ae0ce717d086635a133535df9a73afd2609b83ad231ea8ed0798b3596395c",
  "linux-blue/runtime-av1.cjs": "f4e905f1e15fb86b0d20d9bde941d5e6c8ac2a0bb7b72adff41f056aef2e1e27",
  "linux-blue/runtime.cjs": "0ddd5026996fa23e8122e359c340b08ff84a2786f56362099b38eaf8927331c8",
  "src/media.cjs": "4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66",
  "src/encode-preservation.cjs": "7de7fde7f20544f6b8480ca14b275865694163d3ed5608891c91c2be7aaabab4",
  "src/source-identity.cjs": "fe6f73342936aa70ed6bbda98348da6fb892d05ddb566ee6d1664ba3f38e42bd",
  "src/inspection.cjs": "948559c31919629326f02ebabe30a3a6918677c91cf9bba338bf382b3401c491",
  "src/media-evidence.cjs": "102de80ca6e3e4509448e015d2012bed7025502584e2f934ae2dbe2dfad19502",
  "src/remux-transport.cjs": "cd99370b3971d80cc917fa63c374005b3a895d25775b5084a91f9c6740b27c5e",
  "src/remux-native-inventory.cjs": "b98c0bbd232c6581cfaff9fd6579a2094baf7d0b48842a1a27910b32e45c5fa2",
  "src/provenance.cjs": "3fcce843cbc995086adda7b45444c23acedce9d54813c01b92123d97cfcff894",
  "src/backend-adapters.cjs": "7fbd1b2df2a0261e9d9b0457d224c4c3c77bfd2a4e16b497f8fb339d542847aa",
  "src/vendor-profiles.cjs": "cc194f022665aa729410060804de2021175f0e87bd394fc18e4b3c47716cf65d",
  "linux-blue/workbench-service.cjs": "1f8ef2673fb3e0ea6d4cdbd8d7e726fee72d94dd9d54120d9cd7e9877fb52c80",
  "src/encoder-service.cjs": "9db5757ead17e1b859dd89e85fb412c4d2e88a9edba8728896ae30b585733e26",
  "src/encoder-catalog.cjs": "1fd039577d83fbb35c8424d098fa06056822f538ae65e6b855c3021aab314cf2",
  "src/vendor-encode.cjs": "4ace2e31776981382f86fa742f5caca2a8874314c61bf9d6ea1cde069980dd74",
  "src/vendor-execution.cjs": "4f9d08432499e3840e7b6c867f5b965c4466d58e8644a84d9655fcb323342f78",
  "src/windows-adapters.cjs": "8700b6de13ecf46e49d1b8bd7ac347b04232c86efd9b8a1eee2827d0d3265eb4",
  "src/operation-names.cjs": "185a019d034db77c0e6c4f06ffc7a4d32817296cf394f1fe6b8ede383977e56c",
  "src/encode-operation.cjs": "ebd24233c03a78f2c67f6ce3787694eb9d73b0b3ee8da2f6758ae42deeb20a3a",
  "src/operation-contract.cjs": "e87c0bd40a27e9bc4309cfff489a3270899edc6505face10a9c4461272bb343d",
  "src/operation-telemetry.cjs": "ef1f30ac5d311224cb8b0e79f60f55f55c69c0610d920d17e5f9c7e191a55814",
  "src/container-clock.cjs": "b823f1e41c4cca19a0b06d82dadf1941f4e0a0326b6d16bd910691c702763857",
  "src/operation-family.cjs": "8194bcf01f27cb9d9bb6fc5680ca3aa8e08f0638dd0dc02d75964fdc5e750ecb",
  "src/operation-resource-budget.cjs": "b60f0fe312e79c6f1b15e717f0cb4a7925fba132ca62b8aa753aa5a3ef51accd",
  "src/operation-evidence.cjs": "9a359914f1ddc1a59cdfc651b2f82e67e7eac3d4d54562d0c19dca2c0ff7714e",
  "src/capabilities.cjs": "88b697955e5f938c98455faf0f2b98e51b98295cf0237da7dab9ecd360f31aca",
  "src/vendor-capabilities.cjs": "a48712b3b93c792c1aab7298b37f576a5eb8859504ffe95aec9ccd3bbfa20fea",
  "src/outputs.cjs": "0871e35adb50b7fca7c177b6beb34c5533df8bac98751b55c8af31b8e422ca96",
  "src/storage-eligibility.cjs": "a03a88ed0820beb807719d0e92ddbd761932efa8a11e9891cc6893902f930196",
  "src/inspection-cache.cjs": "a8df2a0b65a4c4117e1efb903710ff159335424d4f3645adb53b99b278e55de1",
  "src/native-initialization-evidence.cjs": "032d30b043934cfbb6e5063f799128ddabd6aef2aa7a6a3ec1c851153823caa7",
  "src/native-file-controls.cjs": "c8f9edab25393bf4944df0e07da239923b97a16f13fc5115842887efb97f81d6",
  "src/native-backend-service.cjs": "ca7a9ea38034c992eb553f9a649f9d2c17411764c16d5aa016a1ae2ce78d6019",
  "src/backend-capabilities.cjs": "33b6f2952f9fe106019c1416801f374cb9053d90bdd2b8df14e4c45b1df5b4c3",
  "src/native-file-runtime-pair.cjs": "5e8dd98c7e2ab70406b5f57f82a8c25b24f1e0ca98e3256f759f3bf5a52107a8",
  "src/candidate-runtime.cjs": "9566a7691feab7cb65f5c739a723f99c48833064aea2edfe8cf410cc5dc0d712",
  "src/native-file-runtime.cjs": "c96ee8adcd48d5a76e6abd5f58310963f6321b5e663c43d6751826377f59f90a",
  "src/native-file-source.cjs": "d246f7b9e612f18ce210c56b80d08d5e3d8b4e89f4dab2de5253248dba0be8d9",
  "src/native-file-contract.cjs": "2cf75cfb1b5ba25a51da513f311fe0287be4700fbf3893f9e27a1440e5e6e91a",
  "src/native-file-tools.cjs": "da73dbecf1e13d2fef34a553f4f568370abf561c8bee7db5268076b9889ffb4f",
  "src/native-file-command.cjs": "936116ef5e251ee4afaf0db8907082806a79c06c70159688417e26ecfecb5216",
  "src/backend-observation.cjs": "bcecce31a7de01aa8e3022f1deb7acd0033ff90130a1c8a6cc9fd4651e0e373a",
  "src/native-file-oracle.cjs": "0bdadd1e91acf494aa5baf2f5b2177953676f919047ccfa8f64d4eb9c9d2c1e4",
  "src/native-file-template.cjs": "0823a97b036e0bd2e342b59ac3f12a6bd85454d8870dc664ef524b7d53cc89f3",
  "src/native-file-workspace.cjs": "433fcd2610c2530fef086b5151bbb01b70bb214ded14af5b2209e40db056d387",
  "package.json": "b5678dc133c1e5fb8da250bfe828c9da55f50d89dac3728af1f0870693e69a82",
  "src/preferences.cjs": "ba49926594e97665064f63b5db440ef9e3144c5b4eee6e60404af5dfde2f82c9",
  "src/vendor-preferences.cjs": "820033d07a8f0cef5de7bfd071537d0d26e4d778bb2e3cc82bc0699a4cbfad11",
  "src/diagnostics.cjs": "fa785aaca639324959339acceefbeaf7bfa1dfce4d38d27598b20c4d82df7901",
  "src/app-settings.cjs": "b0e9a2c7da8a21ccc4f5a7223fb6176777aa14e4d02875c3d324bcb318aae970",
  "src/operation-draft.cjs": "9c4a25e65021be52bff887830a5cbdf5db07c03720be69b0352020437707251a",
  "src/remux-workspace.cjs": "7430f312bfcbabce39ae942ceeac7c0231ebaf7c387d21b7bc8d64d9de7f5260",
  "src/remux-contract.cjs": "f420e73a9a95b310459c4dd7adb5b4e5657ea819d1b6f61a405ef72531c284da",
  "src/remux-metadata-policy.cjs": "56b613509412a0a986276a705e6fff57aa97577fd5b6def2aaec275781c129a8",
  "src/remux-validation.cjs": "6166b0e226b5755a0dfa1ca8b9333a1401c3186e21f6f31ad30cdf1266a6f810",
  "src/mov-representation.cjs": "0155dc48d2b81e2c2b72d0e291c25dee372df2f37d7dbc592062724013b14348",
  "src/remux-operation.cjs": "62715bdbb137e3f0938d26d7394172b6818e4f950f0bc5b7331f18769f51dcac",
  "src/remux-evidence.cjs": "76ed8963119b7217b3d94cf6058bcf9afca081cadf0d51f6166be5fbdd408a75",
  "src/remux-edit-lists.cjs": "2c43bcd88ee7772470abddc232d428751e37b95a072e4f989189a5a4178a99de",
  "src/remux-fragments.cjs": "7f8df279d723d48b44c6ee8dbc1a4e2d9263b416a42a1812ef98e42eac1a5968",
  "src/remux-native-checks.cjs": "70764d731e52a6b648b902147cdd2492bc153b22d877d56510902120a97ff3c7",
  "src/remux-native-reader.cjs": "b9df0fcb3638d9ff251c70f57d94b040598d465d5b7731c28638b45a8fe436d1",
  "src/remux-ebml-reader.cjs": "693f3f6fc8a1e22630691ccdbc99c5b82aaa5fbef0070f38215a1846a4005bd3",
  "src/remux-language-codes.cjs": "84ec89c4d01c29b6be7de57cf99e4c13c0a73c573279b67cdac539799074afd6",
  "src/remux-native-isobmff.cjs": "996d68381b22431b265af4f96138be5ca9fcd01b10e4fc13f9c3150629d1aced",
  "src/remux-native-matroska.cjs": "e6b2b011ca6b840cd1540f3491cace78f506e92a4c81dd2956e15d29a82e6a14",
  "src/remux-native-samples.cjs": "ef79e3591a8b63e9d91400e709b7718f758222999eac408f16e6e86f37212fb2",
  "src/remux-native-sync.cjs": "9d24c8191d1ea6d35dee7f7727643def30c0a0b3def2b1c81dfdd00174da05c7",
  "src/remux-native-indexes.cjs": "e14658f20cbb818eff9a7d2773ce3078e24db39caf0ed77ca0b0b6a5839ebbf8",
  "src/remux-native-cues.cjs": "fe894c5ab1f7f413dd62e824a89398fed5c6ff3d487c3c4590b736de4ef279dd",
  "src/remux-transport-evidence.cjs": "529e67c24200cc216c7f3578f9984d383714de6990c249bf6f3a8453a724b62a",
  "src/operation-storage.cjs": "fb9bcf00b2bf1fac3fe70f5421355a1aea0a2ded5358a38f41f7fd28fe7b1226",
  "src/hdr-workspace.cjs": "20ae02c4dc3aa816a76ee7c5fb10b0f8d8fcf1c4cd010b0311065a60d3b358c7",
  "src/hdr-encoding.cjs": "91cdaaf3fc33d0fa7d4e982f588847a26c6bc23a755f05ef9ac8805e4b0858b8",
  "src/hdr-contract.cjs": "3086db24ed02645cdb3663cdfc69303c1213689b5201c7d72b133a85c99828a4",
  "src/hdr-operation.cjs": "0a269db9ea829f2478334b6ec8dfff1ae8477a71d23a00313bba7709c49dead7",
  "src/hdr-input.cjs": "3e7373a4416410ad06c3130e4959f569c41a77ad90f3b7a860699f31584073f3",
  "src/hevc-content.cjs": "5e3b70c3b5f8250ebb3b037e1ac6287b5d55ca768a99e9c964e79fef5382a931",
  "src/hdr-container.cjs": "8fc887ce472905d1642d7a855213a034cda0550e7bf6fa7c531c1c728f10d901",
  "src/hdr-evidence.cjs": "ceb2bfd7ae65b5ec0534dbcb25a6caf017d806e48d8215c202db10f5cfaf316d",
  "src/encode-preservation-workspace.cjs": "30031b818ca362ea71c79a4cab6b6038e3b29ecaa5bc8efef00ce5fa5017bda9",
  "linux-blue/workbench-remux.cjs": "6a6cbf2a009a6ad48f6359e15d6c2432e615623c3b799df6dc29eb0eae4b4e2a",
  "src/operation-runtime.cjs": "95285842847006e2fbcad43d46bbca7bc3823c3378fdc33a755ee82398681b79",
  "linux-blue/runtime-av1-pins.json": "d3f390eb66119e402042d17d3d0f96d44f24c3b657597d94ec5e54f9edc635c8",
  "scripts/v07-sdr-flac-range-calibration.cjs": "623973624f0ff72a92d8d684ba4d19a31d2fb4abc017d3f5cc0e078b2146ec28",
  "src/operation-controls.cjs": "bd0977641d5fe62b182a70e58d9f89a69f4af4564daeea0c616dcb066238f59f",
  "src/remux-catalog.cjs": "ba299093370dd87e7e154cbeba22cd9f9fe8bc5246eb64266dff193ad21093ec",
  "src/hdr-catalog.cjs": "8efa4fc80256fbe73c5e7a4aaeebd91ad754339385441f1518112227cabab03f",
  "src/hdr-catalog-seals.cjs": "e92d84a4688ea63b04f2b7190376f4a7d028c6a5c77768cf61eb38133117fda3",
  "src/encode-preservation-catalog.cjs": "1bce9f0b0c9a79a18e6d1c89fb181200ee366603dfe28097f1ace3d809bbf17f",
  "src/source-catalog-seals.cjs": "87bfdd9f0f72a3d3c124a3f1befc8fe07a26daa727c18ba1c2fd77573c9404e7",
  "src/encode-preservation-producers.cjs": "0fd773d1bb0c0fab1af9d28861d80107e5e34809d7f3057467882d83f6f0de76",
  "linux-blue/candidate-calibration-runtime.cjs": "a62ceab690931736a7d7a81e7c6c7495987f7015f953013366ab6f5a0fd8217a"
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
const dependencyIdentity = sha(JSON.stringify(DEPENDENCIES));
function loaderGuard() {
  need(process.platform === 'linux' && process.arch === 'x64', 'Only the inspected Linux x64 candidate is admitted.');
  need(!process.env.NODE_OPTIONS && !Object.keys(process.env).some(k => k.startsWith('LD_') && process.env[k]), 'Loader overrides are not admitted.');
}
function assertCandidateServiceReceipt(bytes, expectedSha = REPORT_SHA) {
  // Caller-selected digest is solely a pure test seam. The live factory always
  // uses the fixed original raw report, never a portable transformed record.
  const report = assertProportionalReceiptForRuntime(bytes, expectedSha, {
    report: REPORT, resourcePolicy: RESOURCE_POLICY, familyId: FAMILY_ID, derive: deriveCfrFlacResources,
  }, RUNTIME_ID);
  need(report.candidateRuntime === true && report.geometry?.resolution === 'source'
    && report.geometry.sourceWidth === 1280 && report.geometry.sourceHeight === 720
    && report.geometry.outputWidth === 1280 && report.geometry.outputHeight === 720,
  'Only the reviewed candidate KeepSource720 campaign is admitted.');
  for (const row of report.cases) {
    const t = row.telemetry;
    need(t?.valid === true && t.scope === 'encoder-input-count-and-timeline-only'
      && Array.isArray(t.streams) && t.streams.length === 2
      && t.streams.every((s, i) => s.outputIndex === i && s.kind === (i ? 'audio' : 'video')
        && s.unknownInputRecords === '0' && s.correspondence === 'reported-input-and-independent-selected-source'),
    'Every case requires the reviewed complete telemetry result.');
  }
  return report;
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
    return bytes.subarray(0, REPORT_BYTES);
  } finally { await file.close(); }
}
async function verifyCandidateServiceProducers() {
  for (const [name, digest] of Object.entries(PRODUCERS))
    need(sha(await fs.readFile(path.resolve(__dirname, '..', name))) === digest, 'Calibration producer changed: ' + name);
}
class OwnedCandidateService extends CandidateTrimService {
  #candidate;
  constructor(options, candidate, workbenchMode) { super(options); this.#candidate = candidate; this.workbenchMode = workbenchMode; }
  snapshot() {
    if (this.workbenchMode) {
      for (const item of this.state.items) {
        if (item.status !== 'ready') continue;
        const entry = this.plan?.entries?.get(item.id);
        if (!entry?.qualificationSelection || !entry.operationRuntimeToken || !entry.operationPlan?.instrumentation || entry.operationPlan.compatibilityPath) {
          this.plan?.entries?.delete(item.id);
          item.status = 'unsupported'; item.reasonCode = 'CANDIDATE_RANGE_REQUIRED';
          item.reason = 'Inspection only: choose a per-file range, Keep source and precision FLAC, then Apply. Full is not qualified in this developer preview.';
        }
      }
    }
    const snapshot = super.snapshot();
    if (this.workbenchMode) snapshot.developerKeep720 = { enabled: true, relaunchRequired: this.admissionClosed,
      notice: 'Experimental Keep720 range only · H265 CPU slow / CRF 25 · precision FLAC. Full, resize and Remux unavailable. CPU topology/thread-pool warnings remain; native threading/performance is not qualified.',
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
async function createCandidateKeep720Service(options) {
  need(options && Object.getPrototypeOf(options) === Object.prototype, 'Inert main-owned options required.');
  const keys = Reflect.ownKeys(options);
  need(['verifiedRuntime', 'stateDir'].every(k => keys.includes(k))
    && keys.every(k => ['verifiedRuntime', 'stateDir', 'onChild', 'outputAccess', 'workbenchMode'].includes(k)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')), 'Only fixed main-owned service options are accepted.');
  const { verifiedRuntime, stateDir, onChild, outputAccess, workbenchMode = false } = options;
  const candidate = requireCandidateCalibrationRuntime(verifiedRuntime);
  let observer;
  try {
    need(typeof workbenchMode === 'boolean' && (outputAccess === undefined || outputAccess instanceof OutputAccess), 'Main-owned workbench mode and OutputAccess required.');
    need(typeof stateDir === 'string' && path.isAbsolute(stateDir) && stateDir === path.resolve(stateDir)
      && !/[\x00-\x1f\x7f]/.test(stateDir) && (onChild === undefined || typeof onChild === 'function'), 'Canonical state directory and child observer required.');
    need(candidate.runtimeIdentity === RUNTIME_ID && sha(JSON.stringify(candidate.dependencies)) === dependencyIdentity,
      'The exact reviewed pair and loaded dependency inventory are required.');
    loaderGuard(); await candidate.requireCurrent();
    await verifyCandidateServiceProducers();
    const report = assertCandidateServiceReceipt(await readReviewedReport(), REPORT_SHA);
    await candidate.requireCurrent(); // Producer/report awaits cannot preserve stale authority.
    const invoke = clockGuardedRunner(candidate.createRunner({ onChild }), candidate.pins.ffprobe.path);
    const run = async (...args) => { loaderGuard(); await candidate.requireCurrent(); return invoke(...args); };
    observer = new OperationRuntimeObserver({
      runtime: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, v.path])),
      pins: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, { sizeBytes: v.size, sha256: v.sha256 }])), run,
    });
    const { qualification, timingQualification } = report.sources[0].frozen;
    const selector = new ClockQualifiedFamilySelector({ policyIdentity: 'candidate-keep720-normal-service-54ee143', families: [{
      id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
      qualification, timingQualification, evidenceIds: report.sources.flatMap(s => [s.frozen.qualification.evidenceId, s.frozen.timingQualification.evidenceId]),
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
    if (failures.length) error.cleanupFailureCount = failures.length;
    throw error;
  }
}
module.exports = { createCandidateKeep720Service, assertCandidateServiceReceipt, verifyCandidateServiceProducers,
  REPORT, REPORT_SHA, RUNTIME_ID };
