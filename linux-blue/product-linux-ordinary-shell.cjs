'use strict';
// Explicit main-owned developer route. No downloaded inputs or path/config IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { createOrdinaryCpuService } = require('./ordinary-cpu-service.cjs');
const { verifyProductSources } = require('./product-linux-qualification.cjs');
const RUNTIME_ID = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const { OutputAccess } = require('../src/output-access.cjs');
const { runTool } = require('../src/process-runner.cjs');

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
function manifest(runtimeRoot) {
  return { runtimeIdentity: RUNTIME_ID, dependencies: DEPENDENCIES.map(d => ({ ...d })), pins: {
    ffmpeg: { path: path.join(runtimeRoot, 'ffmpeg'), size: 46175848, sha256: '852df894561f1cabd6481c08cf59870570baace274c27c624e4b38d886ebcd9f' },
    ffprobe: { path: path.join(runtimeRoot, 'ffprobe'), size: 45962728, sha256: '152a8243f5b41b7c02dde01a28619f47151a73e0816aa30197c5b50f4d207ebf' },
  } };
}
function loaderGuard() {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.env.NODE_OPTIONS
    || Object.keys(process.env).some(k => k.startsWith('LD_') && process.env[k]))
    throw Object.assign(new Error('Candidate preview requires the inspected Linux x64 loader environment without overrides.'), { code: 'CANDIDATE_WORKBENCH_ENVIRONMENT' });
}
async function createLinuxOrdinaryShell(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || !Object.hasOwn(options, 'stateDir')
    || Reflect.ownKeys(options).some(k => !['stateDir', 'onChild', 'outputAccess', 'runtimeRoot'].includes(k)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value')))
    throw Object.assign(new Error('Only inert main-owned workbench options are accepted.'), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  const { stateDir, onChild, outputAccess, runtimeRoot } = options;
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir) || stateDir !== path.resolve(stateDir)
    || (onChild !== undefined && typeof onChild !== 'function') || (outputAccess !== undefined && !(outputAccess instanceof OutputAccess)))
    throw Object.assign(new Error('Main-owned state directory, observer and OutputAccess required.'), { code: 'CANDIDATE_WORKBENCH_OPTIONS' });
  loaderGuard();
  // Verify exact current composition before opening the private runtime.
  // This does not load or borrow measured calibration approval.
  verifyProductSources();
  if (typeof runtimeRoot !== 'string' || !path.isAbsolute(runtimeRoot) || runtimeRoot !== path.resolve(runtimeRoot)) throw new Error('Canonical main-owned runtime root required.');
  let runtime;
  try {
    runtime = await openCandidateCalibrationRuntime(manifest(runtimeRoot), { execute: (...args) => { loaderGuard(); return runTool(...args); } });
    verifyProductSources();
    const service = await createOrdinaryCpuService({ verifiedRuntime: runtime, stateDir, onChild, outputAccess });
    service.linuxRemuxStatus = Object.freeze({ available: false, reason: 'Remux is unavailable in the separate ordinary CPU candidate.' });
    service.linuxQualifiedEncodeStatus = Object.freeze({ available: false, familyIds: [], reason: 'Ordinary accepted-full validation only; no measured precision-family authority.' });
    return service;
  } catch (error) { try { await runtime?.close(); } catch (closeError) { error.runtimeCloseFailure = { code: closeError.code, message: closeError.message }; } throw error; }
}
module.exports = { createLinuxOrdinaryShell };
