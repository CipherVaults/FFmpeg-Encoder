'use strict';
// Explicit main-owned ordinary CPU developer composition; defaults unchanged.
// Exact runtime bytes are prerequisites, not general media qualification.
const fs = require('node:fs/promises');
const path = require('node:path');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { LinuxWorkbenchService, createWorkbenchRunner } = require('./workbench-service.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { runTool } = require('../src/process-runner.cjs');
const RUNTIME_ID = '1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9';
const RESTORATION_ROOT = path.join(__dirname, 'artifacts', 'candidate-runtime-' + RUNTIME_ID);
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
function manifest() {
  return { runtimeIdentity: RUNTIME_ID, dependencies: DEPENDENCIES.map(d => ({ ...d })), pins: {
    ffmpeg: { path: path.join(RESTORATION_ROOT, 'ffmpeg'), size: 46175848, sha256: 'ae5b2e8b48ad0e9b51b89ebab000ebcfc0b76a09b8cb80c88e18fddcc5d9e8ba' },
    ffprobe: { path: path.join(RESTORATION_ROOT, 'ffprobe'), size: 45962728, sha256: '923dab8640da8804c445418b6e2efe4b395665bdb9d4cfc84f6a244ed0fb156b' },
  } };
}

const fail = (code, message) => Object.assign(new Error(message), { code });
function loaderGuard() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.env.NODE_OPTIONS
    || Object.keys(process.env).some(k => k.startsWith('LD_') && process.env[k]))
    throw fail('CANDIDATE_ORDINARY_ENVIRONMENT', 'Linux x64 without loader overrides is required.');
}
class CandidateOrdinaryService extends LinuxWorkbenchService {
  #runtime; #closePromise;
  constructor(options, runtime) { super(options); this.#runtime = runtime; }
  snapshot() {
    const snapshot = super.snapshot();
    snapshot.developerOrdinary = { enabled: true, relaunchRequired: this.admissionClosed,
      notice: 'Experimental ordinary FFmpeg 9.0.2 CPU · Full / Keep source / copied audio · 30-minute encode limit. Media and native qualification remain scoped; no default runtime promotion.',
      relaunchNotice: 'This developer session is closed to new work. Wait for cancellation to drain, then close and relaunch. Same-session retry is unavailable.' };
    return snapshot;
  }
  async cancelCurrent() {
    // A cancellation invalidates the candidate observer. Never silently revive
    // it for a later batch; main must construct a fresh owner after drainage.
    this.closeAdmission();
    this.emitState();
    return super.cancelCurrent();
  }
  closeOperationResources() {
    this.closeAdmission();
    return this.#closePromise ||= (async () => {
      const failures = [];
      try { await super.closeOperationResources(); } catch (error) { failures.push(error); }
      try { await this.#runtime.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Ordinary service and candidate closure failed.');
    })();
  }
}
async function createCandidateOrdinaryService(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || !Object.hasOwn(options, 'stateDir')
    || Reflect.ownKeys(options).some(k => !['stateDir', 'onChild', 'outputAccess'].includes(k)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')))
    throw fail('CANDIDATE_ORDINARY_OPTIONS', 'Only inert main-owned ordinary service options are accepted.');
  const { stateDir, onChild, outputAccess } = options;
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir) || path.resolve(stateDir) !== stateDir
    || (onChild !== undefined && typeof onChild !== 'function')
    || (outputAccess !== undefined && !(outputAccess instanceof OutputAccess)))
    throw fail('CANDIDATE_ORDINARY_OPTIONS', 'Canonical main-owned state, observer and OutputAccess required.');
  loaderGuard();
  try { for (const file of [path.join(RESTORATION_ROOT, 'ffmpeg'), path.join(RESTORATION_ROOT, 'ffprobe')]) await fs.access(file); }
  catch (cause) { throw Object.assign(fail('CANDIDATE_ORDINARY_NOT_RESTORED',
    'Ordinary 9.0.2 candidate unavailable: restore the exact fixed tools and seven listed dependencies. Source-only backup is insufficient; no fallback attempted.'), { cause }); }
  let runtime;
  try {
    runtime = await openCandidateCalibrationRuntime(manifest(), { execute: (...args) => { loaderGuard(); return runTool(...args); } });
    const execute = runtime.createRunner({ onChild });
    const run = createWorkbenchRunner({ pins: runtime.pins,
      verify: async () => { loaderGuard(); await runtime.requireCurrent(); },
      execute: (file, args, options) => {
        // Candidate owns child observation; the ordinary wrapper's private
        // onChild field is not an extra caller option to the candidate runner.
        const { onChild: ignored, ...bounded } = options;
        return execute(file, args, bounded);
      } });
    const service = new CandidateOrdinaryService({ ffmpeg: runtime.pins.ffmpeg.path, ffprobe: runtime.pins.ffprobe.path,
      stateDir, runtimeIdentity: RUNTIME_ID, outputAccess, inspectionWorkers: 1, run,
      vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    }, runtime);
    // Keep canonical capability initialization and profiles/settings unchanged.
    // No cached baseline capabilities, remux or historical family grant copied.
    service.linuxRemuxStatus = Object.freeze({ available: false, reason: 'Remux is not qualified for this ordinary candidate composition.' });
    service.linuxQualifiedEncodeStatus = Object.freeze({ available: false, familyIds: [], reason: 'Ordinary CPU foundation only; no changed-encode catalog qualification.' });
    return service;
  } catch (error) {
    try { await runtime?.close(); } catch (closeError) { error.runtimeCloseFailure = { code: closeError.code, message: closeError.message }; }
    throw error;
  }
}
module.exports = { createCandidateOrdinaryService, RESTORATION_ROOT };
