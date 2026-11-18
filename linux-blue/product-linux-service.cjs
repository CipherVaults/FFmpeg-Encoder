'use strict';
// Explicit product-shell candidate proposal, not an activated shipping catalog.
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { ClockQualifiedFamilySelector, clockGuardedRunner } = require('./workbench-long-range-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { RESIZE_1440_FAMILY_ID: FAMILY_ID, RESIZE_1440_RESOURCE_POLICY: RESOURCE_POLICY, FULL_COPY_FAMILY_ID, FULL_COPY_RESOURCE_POLICY, RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const RUNTIME_ID = '1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9';
const { loadQualification, verifyProductSources } = require('./product-linux-qualification.cjs');
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = b => createHash('sha256').update(b).digest('hex');
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'LINUX_PRODUCT_SCOPE' }); };
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
// The three existing families independently match the explicit request and source.
// Do not silently fall back to the ordinary compatibility encode path.
class ProductFamilySelector extends ClockQualifiedFamilySelector {
  select(options) {
    const token = super.select(options);
    need(token !== null, 'Choose an explicitly qualified product family; compatibility fallback is unavailable.');
    return token;
  }
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
          item.status = 'unsupported'; item.reasonCode = 'CANDIDATE_PRODUCT_FAMILY_REQUIRED';
          item.reason = 'Inspection only: explicitly choose a 1440p or qualified 1080p PCM range with precision FLAC, or a whole 1080p file with Copy audio, both at 720p, then Apply. Other combinations are not qualified.';
        }
      }
    }
    const snapshot = super.snapshot();
    if (this.workbenchMode) snapshot.developerProduct = { enabled: true, relaunchRequired: this.admissionClosed,
      notice: 'Experimental three-family candidate: qualified 1440p30 or 1080p30 PCM range → 720p with precision FLAC; or whole 1080p30 file → 720p with copied AAC. Explicit per-file choices required. H265 CPU slow / CRF 25 only. Keep source, other combinations and Remux unavailable. This new three-family package has not undergone native publication testing; predecessor Full-copy native proof belongs only to the exact 070 artifact. The 1080p range path requires H264 High CFR SDR bt709 and stereo 48 kHz s16 PCM QuickTime, not arbitrary AAC/VFR sources. CPU topology/thread-pool warnings remain; native threading/performance is not qualified.',
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
async function createLinuxProductService(options) {
  need(options && Object.getPrototypeOf(options) === Object.prototype, 'Inert main-owned options required.');
  const keys = Reflect.ownKeys(options);
  need(['verifiedRuntime', 'stateDir'].every(k => keys.includes(k))
    && keys.every(k => ['verifiedRuntime', 'stateDir', 'onChild', 'outputAccess', 'workbenchMode'].includes(k)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')), 'Only fixed main-owned service options are accepted.');
  const { verifiedRuntime, stateDir, onChild, outputAccess, workbenchMode = true } = options;
  const candidate = requireCandidateCalibrationRuntime(verifiedRuntime);
  let observer;
  try {
    need(workbenchMode === true && (outputAccess === undefined || outputAccess instanceof OutputAccess), 'Main-owned workbench mode and OutputAccess required.');
    need(typeof stateDir === 'string' && path.isAbsolute(stateDir) && stateDir === path.resolve(stateDir)
      && !/[\x00-\x1f\x7f]/.test(stateDir) && (onChild === undefined || typeof onChild === 'function'), 'Canonical state directory and child observer required.');
    need(candidate.runtimeIdentity === RUNTIME_ID && sha(JSON.stringify(candidate.dependencies)) === dependencyIdentity,
      'The exact reviewed pair and loaded dependency inventory are required.');
    loaderGuard(); verifyProductSources(); await candidate.requireCurrent();
    const report = loadQualification();
    verifyProductSources();
    await candidate.requireCurrent(); // Product-source/qualification checks cannot preserve stale authority.
    const invoke = clockGuardedRunner(candidate.createRunner({ onChild }), candidate.pins.ffprobe.path);
    const run = async (...args) => { loaderGuard(); await candidate.requireCurrent(); return invoke(...args); };
    observer = new OperationRuntimeObserver({
      runtime: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, v.path])),
      pins: Object.fromEntries(Object.entries(candidate.pins).map(([k, v]) => [k, { sizeBytes: v.size, sha256: v.sha256 }])), run,
    });
    const { qualification, timingQualification } = report.family;
    const selector = new ProductFamilySelector({ policyIdentity: 'product-range1440-range1080-and-full1080-copy-candidate', families: [{
      id: FAMILY_ID, resourcePolicy: RESOURCE_POLICY, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
      qualification, timingQualification, evidenceIds: report.family.evidenceIds,
    }, {
      id: FULL_COPY_FAMILY_ID, resourcePolicy: FULL_COPY_RESOURCE_POLICY, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
      qualification: report.fullCopy.family.qualification, timingQualification: report.fullCopy.family.timingQualification,
      evidenceIds: report.fullCopy.family.evidenceIds,
    }, {
      id: RESIZE_FAMILY_ID, resourcePolicy: RESIZE_RESOURCE_POLICY, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
      qualification: report.range1080.family.qualification, timingQualification: report.range1080.family.timingQualification,
      evidenceIds: report.range1080.family.evidenceIds,
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
    if (failures.length) throw new AggregateError([error, ...failures.map(x => x.reason)], 'Construction and owned cleanup failed.', { cause: error });
    throw error;
  }
}
module.exports = { createLinuxProductService };
