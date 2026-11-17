'use strict';
// Explicit main-owned developer route. No downloaded inputs or path/config IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { createCandidateKeep720Service, REPORT, RUNTIME_ID } = require('./candidate-keep720-service.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { runTool } = require('../src/process-runner.cjs');
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
function loaderGuard() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.env.NODE_OPTIONS
    || Object.keys(process.env).some(k => k.startsWith('LD_') && process.env[k]))
    throw Object.assign(new Error('Candidate preview requires the inspected Linux x64 loader environment without overrides.'), { code: 'CANDIDATE_WORKBENCH_ENVIRONMENT' });
}
async function createCandidateWorkbench(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || !Object.hasOwn(options, 'stateDir')
    || Reflect.ownKeys(options).some(k => !['stateDir', 'onChild', 'outputAccess'].includes(k)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')))
    throw Object.assign(new Error('Only inert main-owned workbench options are accepted.'), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  const { stateDir, onChild, outputAccess } = options;
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir) || stateDir !== path.resolve(stateDir)
    || (onChild !== undefined && typeof onChild !== 'function') || (outputAccess !== undefined && !(outputAccess instanceof OutputAccess)))
    throw Object.assign(new Error('Main-owned state directory, observer and OutputAccess required.'), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  loaderGuard();
  // Missing source-only restoration inputs fail before any observer or child.
  try { for (const file of [path.join(RESTORATION_ROOT, 'ffmpeg'), path.join(RESTORATION_ROOT, 'ffprobe'), REPORT]) await fs.access(file); }
  catch (cause) { throw Object.assign(new Error('Candidate preview unavailable: restore the exact reviewed candidate tools in the fixed local artifacts directory and the original raw long-calibration report. Source-only/portable records are insufficient. No baseline fallback was attempted.'), { code: 'CANDIDATE_WORKBENCH_NOT_RESTORED', cause }); }
  let runtime;
  try {
    runtime = await openCandidateCalibrationRuntime(manifest(), { execute: (...args) => { loaderGuard(); return runTool(...args); } });
    const service = await createCandidateKeep720Service({ verifiedRuntime: runtime, stateDir, onChild, outputAccess, workbenchMode: true });
    service.linuxRemuxStatus = Object.freeze({ available: false, reason: 'Remux is not qualified in the developer Keep720 preview.' });
    service.linuxQualifiedEncodeStatus = Object.freeze({ available: false, familyIds: [], reason: 'Developer range proof only, not production catalog activation.' });
    const capabilities = service.getCapabilities.bind(service);
    service.getCapabilities = async () => {
      const value = await capabilities();
      return { ...value, profiles: value.profiles.filter(p => p.id === 'h265-cpu').map(p => ({ ...p, presets: ['slow'], defaultPreset: 'slow',
        quality: { ...p.quality, min: 25, max: 25, default: 25 } })), recipes: [], vendorProfiles: [] };
    };
    const preferences = service.getPreferences.bind(service);
    service.getPreferences = async () => ({ ...await preferences(), profileId: 'h265-cpu', settingsByProfile: { 'h265-cpu': { preset: 'slow', quality: 25 } } });
    return service;
  } catch (error) { try { await runtime?.close(); } catch (closeError) { error.runtimeCloseFailure = { code: closeError.code, message: closeError.message }; } throw error; }
}
module.exports = { createCandidateWorkbench, RESTORATION_ROOT };
