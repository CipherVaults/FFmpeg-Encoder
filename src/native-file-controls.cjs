'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { NativeBackendService } = require('./native-backend-service.cjs');
const { NativeFileRuntimePair } = require('./native-file-runtime-pair.cjs');
const { DEFAULT_NATIVE_FILE_POLICIES, assessNativeFileAdmission, readNativeFilePolicies, createNativeFileRuntimeJob } = require('./native-file-runtime.cjs');
const { getNativeProfile, capabilityKey } = require('./backend-adapters.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');

// Main's fixed native file composition (record 37 §2). Production has no
// policy or runner parameter; injection exists only through the test factory,
// whose controls carry a different module-private brand.
const fail = (code, message, cause) => { throw Object.assign(new Error(message), { code }, cause ? { cause } : {}); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const stampOf = s => ({ dev: String(s.dev), ino: String(s.ino), birthtimeNs: String(s.birthtimeNs) });
const KINDS = new WeakMap();
const STAGE_NAME = /^\.ffmpeg-encoder-[A-Za-z0-9]{6}$/;
const KEPT_STAGE_LIMIT = 8, KEPT_BYTES_LIMIT = 3 * 1024 ** 3, SCAN_LIMIT = 64;

function composition(options, keys, required) {
  if (!plain(options)) fail('INVALID_NATIVE_FILE_COMPOSITION', 'Native file controls need an inert main-owned record.');
  const fields = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !keys.includes(key) || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))
    || required.some(key => !Object.hasOwn(fields, key))) fail('INVALID_NATIVE_FILE_COMPOSITION', 'Native file controls accept only their fixed main-owned fields.');
}

// One frozen main table: fixed text with no interpolation (record 37 §6).
const NATIVE_MESSAGES = freeze(Object.assign(Object.create(null), {
  // Readiness (§3.1).
  NATIVE_FILE_RUNTIME_UNAVAILABLE: 'Native file encoding is not available in this build.',
  NATIVE_DISCOVERY_UNOBSERVED: 'Native devices have not been checked on this computer yet, or the last check did not finish.',
  NATIVE_HARDWARE_UNAVAILABLE: 'No Intel Quick Sync or AMD AMF device was found on this computer.',
  NATIVE_SELECTION_REQUIRED: 'Choose a native device and exact settings, then run "Check these settings".',
  AMF_EFFECTIVE_PROPERTIES_UNOBSERVED: 'AMD AMF cannot encode files yet. The pinned FFmpeg cannot report the settings AMF actually used. This is a missing producer, not missing hardware.',
  NATIVE_FILE_REQUEST_UNSUPPORTED: 'Native file encoding (Beta) supports only H.264 8-bit SDR to Matroska.',
  NATIVE_CAPABILITY_UNVERIFIED: 'These exact settings have not passed the generated-sample check in this session.',
  NATIVE_FILE_POLICY_REQUIRED: 'No qualified native file policy exists for this device, runtime and settings, so file encoding stays off.',
  NATIVE_FILE_REFERENCE_REQUIRED: 'The matching policy has no qualified reference output, so a result could never be validated or saved.',
  // Preparation and Start (§3.2–3.5).
  INVALID_REQUEST: 'The native file request was not valid.',
  INVALID_ID: 'The native file request named an unknown item.',
  INVALID_NATIVE_REQUEST: 'The native request was not valid.',
  INVALID_FOLDER: 'Choose an input folder and a separate output folder.',
  NATIVE_FILE_SAME_FOLDER_UNSUPPORTED: 'Native file encoding (Beta) needs an output folder that is different from the input folder.',
  NATIVE_FILE_SOURCE_PATH_UNSUPPORTED: 'Native file encoding (Beta) needs an input folder on a local drive.',
  NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED: 'Native file encoding (Beta) needs an ordinary output folder on a local drive, outside the app data folder.',
  NATIVE_FILE_PLAN_ACTIVE: 'A native file batch is ready. Cancel it before changing native devices or settings.',
  NATIVE_FILE_OPTIONS_FIXED: 'Native file options are fixed once the batch is prepared.',
  NATIVE_FILE_SOURCE_PERMISSION_REQUIRED: 'Native file encoding (Beta) accepts only original sources; generated or uncertain files cannot be re-encoded here.',
  NATIVE_FILE_SELECTION_STALE: 'The native settings check no longer matches this batch. Run "Check these settings" again.',
  STALE_NATIVE_SELECTION: 'The capability check re-ran native discovery, so the earlier settings check no longer applies. Run "Check these settings" again.',
  NATIVE_SELECTION_DISCARDED: 'The native settings check was discarded; run "Check these settings" again.',
  NATIVE_BACKEND_BUSY: 'A native device check is still running. Wait for it to finish, then try again.',
  NATIVE_OWNER_UNSETTLED: 'A native file job has not confirmed that it released its device, files and work folder. The app is retrying; try again. If this continues, restart the app.',
  NATIVE_MEDIA_ADMISSION_REFUSED: 'The native file job could not reserve the media slot.',
  NATIVE_FILE_STAGE_QUOTA: 'Kept native work files have reached their limit. Remove the folders inside native-files in the app\'s data folder, then try again.',
  INVALID_NATIVE_FILE_COMPOSITION: 'Native file encoding is not composed correctly in this build.',
  NATIVE_FILE_JOB_FAILED: 'The native file job failed. The details are kept in the app\'s own diagnostics.',
  // Runtime owner (native-file-runtime.cjs and its helpers).
  INVALID_NATIVE_FILE_RUNTIME: 'The native file runtime refused an invalid internal request.',
  NATIVE_FILE_SESSION_STALE: 'This native file session is no longer current.',
  NATIVE_FILE_RUNTIME_BUSY: 'The native file runtime is still finishing a previous step.',
  NATIVE_FILE_RUNTIME_CLOSED: 'The native file runtime for this job has closed.',
  NATIVE_FILE_PHASE: 'The native file job tried a step out of order.',
  NATIVE_FILE_LEASE_REQUIRED: 'The native file job could not confirm its media slot.',
  NATIVE_FILE_SOURCE_UNQUALIFIED: 'This source file is not the exact file the native policy was qualified with.',
  NATIVE_FILE_STAGE_CHANGED: 'The native work folder changed unexpectedly. Restart the app, then try again.',
  NATIVE_FILE_STAGE_LIMIT: 'The native encoder wrote more data than allowed. The work file was kept.',
  NATIVE_FILE_DISCOVERY_COMMAND: 'The native file job refused an unexpected device check.',
  NATIVE_FILE_EVIDENCE_REQUEST: 'The native file job refused an unexpected evidence request.',
  NATIVE_FILE_EVIDENCE_UNOWNED: 'The native file job refused evidence that it did not produce.',
  NATIVE_FILE_FRAME_BYTES: 'The decoded frames did not have the expected size.',
  NATIVE_FILE_DESTINATION: 'The output file must be a new .mkv file in an ordinary local folder.',
  NATIVE_FILE_PUBLISHED_CHANGED: 'The saved file does not match the checked output. It was left in place and not recorded as saved.',
  NATIVE_FILE_UNSETTLED: 'A native process did not confirm that it closed.',
  NATIVE_FILE_SOURCE_UNSETTLED: 'A source file handle did not close.',
  INVALID_NATIVE_FILE_COMMAND: 'The native encoder command was not valid.',
  INVALID_NATIVE_FILE_PATH: 'A native file path was not valid.',
  NATIVE_FILE_COMMAND_LIMIT: 'The native encoder command exceeded its size limit.',
  NATIVE_FILE_DESCRIPTION_MISMATCH: 'The native output description did not match its settings.',
  NATIVE_FILE_PROVENANCE_UNSUPPORTED: 'The native output description is not supported.',
  INVALID_NATIVE_FILE_REQUEST: 'The native file request was not valid.',
  NATIVE_FILE_APPLICABILITY_STALE: 'The source file changed after it was checked.',
  NATIVE_FILE_CONTRACT_UNOWNED: 'The native file job refused a contract that main did not create.',
  NATIVE_FILE_PROBE_INVALID: 'The source file could not be read as a supported video.',
  NATIVE_FILE_SOURCE_UNSUPPORTED: 'This source file is outside what native file encoding (Beta) supports.',
  NATIVE_FILE_SOURCE_SIZE: 'This source file\'s size is outside what native file encoding (Beta) supports.',
  NATIVE_FILE_SINGLE_VIDEO_REQUIRED: 'Native file encoding (Beta) needs a source with exactly one video stream and nothing else.',
  NATIVE_FILE_SOURCE_CODEC: 'This source file\'s video format is not supported by native file encoding (Beta).',
  NATIVE_FILE_SOURCE_GEOMETRY: 'This source file\'s picture size is not supported by native file encoding (Beta).',
  NATIVE_FILE_SOURCE_ORIENTATION_OR_SIDE_DATA: 'This source file has rotation or extra picture data that native file encoding (Beta) does not support.',
  NATIVE_FILE_SOURCE_COLOR: 'This source file\'s colour settings are not supported by native file encoding (Beta).',
  NATIVE_FILE_SOURCE_TIMELINE: 'This source file\'s timing is not supported by native file encoding (Beta).',
  NATIVE_FILE_SOURCE_CONTAINER: 'This source file\'s container is not supported by native file encoding (Beta).',
  NATIVE_FILE_SOURCE_RELATIONSHIPS: 'This source file has programs, chapters or stream groups that native file encoding (Beta) does not support.',
  NATIVE_FILE_SOURCE_DISPOSITION: 'This source file\'s stream flags are not supported by native file encoding (Beta).',
  INVALID_NATIVE_RUNTIME: 'The pinned FFmpeg runtime description was not valid.',
  NATIVE_RUNTIME_BUSY: 'The pinned FFmpeg runtime is still finishing a check.',
  NATIVE_RUNTIME_STALE: 'The pinned FFmpeg files changed. Restart the app.',
  INVALID_NATIVE_SOURCE: 'The source file request was not valid.',
  NATIVE_SOURCE_BUSY: 'The source file is still being checked.',
  NATIVE_SOURCE_CHANGED: 'The source file changed during the job.',
  NATIVE_SOURCE_COMPLETION_ONLY: 'The source file can only be checked for completion at this step.',
  NATIVE_SOURCE_SIZE: 'The source file is larger than allowed.',
  NATIVE_SOURCE_STALE: 'The source file is no longer the one that was checked.',
  INVALID_NATIVE_TOOL: 'A native tool request was not valid.',
  NATIVE_CAPTURE_MISMATCH: 'A native tool\'s output did not match what was captured.',
  NATIVE_CHILD_INCOMPLETE: 'A native process did not finish cleanly.',
  NATIVE_CHILD_UNOBSERVED: 'A native process was not observed closing.',
  NATIVE_CHILD_DUPLICATE: 'A native process reported its result twice.',
  NATIVE_RUNNER_INCOMPLETE: 'A native process runner did not finish cleanly.',
  NATIVE_TOOL_BUSY: 'A native tool is still running.',
  NATIVE_TOOL_CLOCK: 'The system clock moved backwards during a native step.',
  NATIVE_TOOL_CLOSED: 'Native tools for this job have closed.',
  NATIVE_TOOL_LIMIT: 'A native process exceeded its limits.',
  NATIVE_TOOL_OWNERSHIP_UNKNOWN: 'A native process could not be confirmed as closed.',
  NATIVE_TOOL_RECEIPT_UNOWNED: 'The native file job refused a process result that it did not produce.',
  NATIVE_TOOL_TIMEOUT: 'A native process took longer than allowed.',
  NATIVE_DISCOVERY_OWNER_MISMATCH: 'The native device check did not belong to this session.',
  NATIVE_PROBE_EVIDENCE_INCOMPLETE: 'The native settings check did not finish recording its evidence.',
  NATIVE_PROBE_EVIDENCE_STALE: 'The native settings check did not return fresh evidence.',
  // Output staging and publication (outputs.cjs).
  ATOMIC_PUBLICATION_UNAVAILABLE: 'The output could not be saved without the risk of overwriting a file.',
  COPY_CONTENT_MISMATCH: 'The copied output did not match the checked output.',
  COPY_VERIFICATION_CHANGED: 'The output changed while it was being verified.',
  COPY_VERIFICATION_LIMIT: 'The output was too large to verify.',
  INVALID_PUBLICATION_RECEIPT: 'The output receipt was not valid.',
  INVALID_RETENTION_REASON: 'The reason for keeping a work file was not valid.',
  INVALID_STAGE: 'The work folder was not valid.',
  PUBLICATION_OBSERVATION_ORDER: 'The output was checked out of order.',
  PUBLISHED_OUTPUT_CHANGED: 'The saved file changed after it was saved.',
  STAGE_CHANGED: 'The work file changed while the job was running.',
  STAGE_IDENTITY_UNAVAILABLE: 'The work file could not be identified.',
  STAGE_NOT_SEALED: 'The work file was not finished.',
  STAGE_NOT_VALIDATED: 'The work file was not validated.',
  // Device evidence on the native job's call path (backend-observation.cjs, backend-capabilities.cjs).
  PROBE_MODE_MISMATCH: 'The device reported different encoder settings from the ones requested, so the result was not used.',
  PROBE_DEVICE_MISMATCH: 'The device that encoded was not the one that was checked, so the result was not used.',
  PROBE_EVIDENCE_UNOBSERVED: 'The device did not report enough about what it did, so the result was not used.',
  NATIVE_DEVICE_UNAVAILABLE: 'The native device is not available.',
  NATIVE_INITIALIZATION_STALE: 'The native device check is out of date. Run "Check these settings" again.',
  NATIVE_INITIALIZATION_UNTRUSTED: 'The native device check could not be trusted.',
  CAPABILITY_REGISTRY_FULL: 'Too many native settings were checked in this session. Restart the app.',
  CAPABILITY_STALE: 'The native settings check is out of date. Run "Check these settings" again.',
  DISCOVERY_ID_REUSED: 'A native device check was reported twice.',
  INVALID_BACKEND_EVIDENCE: 'A native device check returned invalid evidence.',
  INVALID_NATIVE_EVIDENCE: 'A native device check returned invalid evidence.',
  NATIVE_DISCOVERY_INCOMPLETE: 'The native device check did not finish.',
  NATIVE_IDENTITY_UNRESOLVED: 'The native device could not be identified exactly.',
  NATIVE_RUNTIME_UNAVAILABLE: 'The pinned FFmpeg runtime is not available for native encoding.',
  NATIVE_WRAPPER_UNAVAILABLE: 'The pinned FFmpeg does not include this native encoder.',
  PROBE_BUSY: 'A native settings check is already running.',
  PROBE_CHILD_NOT_CLOSED: 'A native settings check process did not confirm that it closed.',
  PROBE_PLAN_NOT_IMPLEMENTED: 'This native settings check is not available.',
  PROBE_TICKET_EXPIRED: 'The native settings check expired. Run it again.',
  STALE_DISCOVERY: 'An older native device check cannot replace a newer one.',
  UNKNOWN_CAPABILITY_CELL: 'The native settings were not found in this session.',
  UNSUPPORTED_BACKEND_OPERATION: 'This native operation is not supported.',
  UNTRUSTED_NATIVE_RECEIPT: 'A native settings check returned a result that was not trusted.',
  // Process and source helpers on the native job's call path (process-runner.cjs, source-identity.cjs).
  EMPTY_INPUT: 'The source file is empty.',
  INPUT_LIMIT: 'The source file is larger than allowed.',
  INPUT_TOO_LARGE: 'The source file is larger than allowed.',
  INVALID_INPUT: 'The source file request was not valid.',
  INVALID_LIMIT: 'A native process limit was not valid.',
  INVALID_OUTPUT_MODE: 'A native process output request was not valid.',
  INVALID_PATH: 'A file path was not valid.',
  OUTPUT_LIMIT: 'A native process produced more output than allowed.',
  PIPE_FAILED: 'A native process stream failed.',
  PROGRESS_LIMIT: 'The encoder progress report was larger than allowed.',
  SPAWN_FAILED: 'A native process could not be started.',
  STDOUT_SINK_FAILED: 'A native process output could not be processed.',
  TIMEOUT: 'A native process took longer than allowed.',
  TOOL_FAILED: 'A native process exited with an error.',
  SOURCE_CTIME_ONLY: 'The source file\'s change time moved during the job, but no other change was found.',
  // Shared preparation and Start codes the native gate passes through (encoder-service.cjs).
  BUSY: 'Wait for the current operation and cleanup to finish.',
  SHUTTING_DOWN: 'The application is closing.',
  NO_INPUTS: 'No supported top-level video files were found.',
  STALE_PLAN: 'The batch changed. Prepare it again.',
  UNPREPARED_FILE: 'Encoding details are available after this file is prepared.',
  // Ordinary codes a native job can raise.
  CANCELLED: 'Cancelled.',
  INPUT_CHANGED: 'The source file changed after it was checked.',
  GENERATED_SOURCE: 'This file was made by FFmpeg Encoder, so it is not re-encoded.',
  OUTPUT_FOLDER_CHANGED: 'The output folder changed. Choose it again.',
  PROTECTED_SOURCE: 'The output would replace a file that this batch reads.',
  PUBLICATION_UNCERTAIN: 'It is not certain whether the output was saved. The app will check it the next time it starts.',
  OPERATION_DIAGNOSTICS_INCOMPLETE: 'The job stopped because its diagnostics could not be saved.',
}));
const NATIVE_MESSAGE_FAMILIES = freeze({
  NATIVE_TEMPLATE_: 'The encoded file\'s structure did not pass the exact container check. The work file was kept.',
  NATIVE_ORACLE_: 'The encoded file did not match its qualified reference output. The work file was kept.',
});
const CODE = /^[A-Z][A-Z0-9_]{0,95}$/;

// Control flow keeps the original code; only the fixed text and a known code
// reach the renderer. The original stays in main-only nativePrivate.
// Each field is read once into a local and only a validated string is used,
// so a hostile error object cannot make this throw or return a non-text code.
function nativeRefusal(error) {
  let code = null, message = '', causeCode = null;
  try {
    if (error && typeof error === 'object') {
      const c = error.code, m = error.message, k = error.cause;
      if (typeof c === 'string' && CODE.test(c)) code = c;
      if (typeof m === 'string') message = m.slice(0, 2048);
      if (k && typeof k === 'object') { const kc = k.code; if (typeof kc === 'string' && CODE.test(kc)) causeCode = kc; }
    }
  } catch { code = null; message = ''; causeCode = null; }
  const family = code && Object.keys(NATIVE_MESSAGE_FAMILIES).find(prefix => code.startsWith(prefix) && code.length > prefix.length);
  const reasonCode = code && (Object.hasOwn(NATIVE_MESSAGES, code) || family) ? code : 'NATIVE_FILE_JOB_FAILED';
  return freeze({ reasonCode, reason: Object.hasOwn(NATIVE_MESSAGES, reasonCode) ? NATIVE_MESSAGES[reasonCode] : NATIVE_MESSAGE_FAMILIES[family],
    nativePrivate: { code, message, causeCode } });
}

// Readiness (§3.1): pure, fixed order; a reason is hidden only by an earlier
// shown reason it depends on. NATIVE_FILE_POLICY_REQUIRED is never hidden.
const HIDES = freeze({
  NATIVE_DISCOVERY_UNOBSERVED: ['NATIVE_HARDWARE_UNAVAILABLE', 'NATIVE_SELECTION_REQUIRED', 'NATIVE_CAPABILITY_UNVERIFIED'],
  NATIVE_HARDWARE_UNAVAILABLE: ['NATIVE_SELECTION_REQUIRED', 'NATIVE_CAPABILITY_UNVERIFIED'],
  NATIVE_SELECTION_REQUIRED: ['NATIVE_CAPABILITY_UNVERIFIED'],
  AMF_EFFECTIVE_PROPERTIES_UNOBSERVED: ['NATIVE_CAPABILITY_UNVERIFIED'],
  NATIVE_FILE_REQUEST_UNSUPPORTED: ['NATIVE_CAPABILITY_UNVERIFIED'],
});
function readableView(view) {
  if (!plain(view) || view.schema !== 1 || !plain(view.native) || !Array.isArray(view.native.profiles) || !view.native.profiles.length) return false;
  if (view.native.profiles.some(p => !plain(p) || typeof p.profileId !== 'string' || typeof p.backend !== 'string' || typeof p.reason !== 'string')) return false;
  const s = view.selection;
  return s === null || (plain(s) && plain(s.request) && typeof s.request.profileId === 'string' && typeof s.probeVerified === 'boolean');
}
function backendOf(profileId) { try { return getNativeProfile(profileId).backend; } catch { return null; } }
function readinessReasons(view, catalog, identity) {
  if (!readableView(view)) return ['NATIVE_FILE_RUNTIME_UNAVAILABLE'];
  const profiles = view.native.profiles, selection = view.selection, backend = selection && backendOf(selection.request.profileId);
  const candidates = [];
  if (profiles.every(p => ['DISCOVERY_NOT_OBSERVED', 'DEVICE_DISCOVERY_INCOMPLETE'].includes(p.reason))) candidates.push('NATIVE_DISCOVERY_UNOBSERVED');
  const relevant = profiles.filter(p => selection ? p.backend === backend : ['amf', 'qsv'].includes(p.backend));
  if (relevant.length && relevant.every(p => p.reason === 'MISSING_DEVICE')) candidates.push('NATIVE_HARDWARE_UNAVAILABLE');
  if (!selection) candidates.push('NATIVE_SELECTION_REQUIRED');
  if (selection && backend === 'amf') candidates.push('AMF_EFFECTIVE_PROPERTIES_UNOBSERVED');
  if (selection && (!['h264-qsv', 'h264-amf'].includes(selection.request.profileId) || selection.request.bitDepth !== 8)) candidates.push('NATIVE_FILE_REQUEST_UNSUPPORTED');
  if (!selection || selection.probeVerified !== true) candidates.push('NATIVE_CAPABILITY_UNVERIFIED');
  let key = null;
  if (selection) { try { key = capabilityKey(selection.cell?.policy); } catch { key = null; } }
  const matching = key === null ? [] : catalog.filter(p => p.runtimeIdentity === identity && p.nativeCellKey === key
    && p.profileId === selection.request.profileId && same(p.settings, selection.request.settings));
  if (!matching.length) candidates.push('NATIVE_FILE_POLICY_REQUIRED');
  else if (!matching.some(p => p.reference)) candidates.push('NATIVE_FILE_REFERENCE_REQUIRED');
  const shown = [];
  for (const code of candidates) if (!shown.some(earlier => HIDES[earlier]?.includes(code))) shown.push(code);
  return shown;
}

function compose(options, { kind, policies, run }) {
  const { runtime, stateDir, nativeBackends } = options;
  if (!(nativeBackends instanceof NativeBackendService)) fail('INVALID_NATIVE_FILE_COMPOSITION', 'The genuine native backend service is required.');
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir) || stateDir.length > 32767 || /[\x00-\x1f\x7f]/.test(stateDir)) fail('INVALID_NATIVE_FILE_COMPOSITION', 'An absolute main-owned state folder is required.');
  if (run !== undefined && typeof run !== 'function') fail('INVALID_NATIVE_FILE_COMPOSITION', 'An injected test runner must be a function.');
  const pair = new NativeFileRuntimePair(runtime), identity = pair.identity();
  const stateRoot = path.resolve(stateDir), ownedRoot = path.join(stateRoot, 'native-files');
  // Construction writes nothing and starts no process; main.js created stateDir.
  let stateStamp;
  try {
    const stat = fs.lstatSync(stateRoot, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(stateRoot), stateRoot)) throw new Error('not ordinary');
    stateStamp = stampOf(stat);
  } catch (error) { fail('INVALID_NATIVE_FILE_COMPOSITION', 'The state folder must be an existing ordinary folder.', error); }
  // Owners re-validate their rows; keep an inert frozen copy for every job.
  const rows = policies === DEFAULT_NATIVE_FILE_POLICIES ? DEFAULT_NATIVE_FILE_POLICIES : (readNativeFilePolicies(policies), freeze(structuredClone(policies)));
  const catalog = rows === DEFAULT_NATIVE_FILE_POLICIES ? rows : freeze(readNativeFilePolicies(rows));
  // kept: stages counted by the last lease-time scan; sinceScan: jobs leased
  // after it, whose own stage the next scan will count.
  let rootPin = null, kept = null, sinceScan = [];

  const stateCurrent = async () => {
    try {
      await assertOrdinaryPath(stateRoot, 'directory');
      const stat = await fsp.lstat(stateRoot, { bigint: true });
      if (!same(stampOf(stat), stateStamp)) throw new Error('state folder replaced');
    } catch (error) { fail('NATIVE_FILE_STAGE_CHANGED', 'The app\'s state folder changed.', error); }
  };
  const rootCurrent = async () => {
    try {
      if (await assertOrdinaryPath(ownedRoot, 'directory') !== ownedRoot) throw new Error('owned root redirected');
      const stat = await fsp.lstat(ownedRoot, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('owned root is not a folder');
      const stamp = stampOf(stat);
      if (rootPin && !same(rootPin, stamp)) throw new Error('owned root replaced');
      return stamp;
    } catch (error) { fail('NATIVE_FILE_STAGE_CHANGED', 'The native work folder changed.', error); }
  };
  // Kept-stage bound: bounded lstat-only scan of ordinary stage folders.
  const scan = async () => {
    let count = 0, bytes = 0n, dir;
    try {
      dir = await fsp.opendir(ownedRoot);
      for await (const entry of dir) {
        if (++count > SCAN_LIMIT) throw new Error('too many entries');
        const folder = path.join(ownedRoot, entry.name), stat = await fsp.lstat(folder, { bigint: true });
        if (!STAGE_NAME.test(entry.name) || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unexpected entry');
        try {
          const file = await fsp.lstat(path.join(folder, 'encoded.mkv'), { bigint: true });
          if (!file.isFile() || file.isSymbolicLink()) throw new Error('unexpected stage file');
          bytes += file.size;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } catch (error) { fail('NATIVE_FILE_STAGE_CHANGED', 'The native work folder holds unexpected entries.', error); }
    finally { await dir?.close().catch(() => {}); }
    kept = count;
    if (count >= KEPT_STAGE_LIMIT || bytes > BigInt(KEPT_BYTES_LIMIT)) fail('NATIVE_FILE_STAGE_QUOTA', 'Kept native work files reached their bound.');
  };
  const cancelled = signal => { if (signal?.aborted) fail('CANCELLED', 'Native file preparation cancelled.'); };
  // Lease-time checks (§5 kept-stage bound, steps 1-6). The runtime calls this
  // while it already holds the slot, so any refusal here is released by the
  // runtime under its retry and quarantine rules rather than by this code.
  const admitLease = async signal => {
    cancelled(signal);
    await stateCurrent();
    let present = true;
    try { await fsp.lstat(ownedRoot); } catch (error) {
      if (error.code !== 'ENOENT') fail('NATIVE_FILE_STAGE_CHANGED', 'The native work folder could not be checked.', error);
      present = false;
    }
    // An absent folder holds no kept stage (for example after the user removed
    // it); it is recreated and pinned afresh. A present one must match the pin.
    if (!present) {
      rootPin = null;
      await fsp.mkdir(ownedRoot).catch(error => { if (error.code !== 'EEXIST') fail('NATIVE_FILE_STAGE_CHANGED', 'The native work folder could not be created.', error); });
    }
    const stamp = await rootCurrent();
    rootPin ||= freeze(stamp);
    sinceScan = [];
    await scan();
    await stateCurrent(); await rootCurrent();
    cancelled(signal);
  };

  const keptCount = () => kept === null ? null : kept + sinceScan.filter(job => job.snapshot().stageRetained).length;
  const controls = Object.freeze({
    policyCount: catalog.length,
    readiness(view) {
      const reasons = readinessReasons(view, catalog, identity);
      return freeze({ schema: 1, beta: true, available: reasons.length === 0, reasons: reasons.map(code => ({ code, message: NATIVE_MESSAGES[code] })),
        policyCount: catalog.length, keptStages: keptCount() });
    },
    assess(request) {
      composition(request, ['contract', 'selection'], ['contract']);
      const assessed = assessNativeFileAdmission({ policies: rows, runtime, contract: request.contract, ...(request.selection == null ? {} : { selection: request.selection }) });
      // §3.3 step 4: a matching row without a qualified reference is not admissible.
      return assessed.admissible && !assessed.referencePresent
        ? freeze({ ...assessed, admissible: false, reasonCodes: ['NATIVE_FILE_REFERENCE_REQUIRED'] }) : assessed;
    },
    createJob(request) {
      composition(request, ['acquireMediaSlot'], ['acquireMediaSlot']);
      if (typeof request.acquireMediaSlot !== 'function') fail('INVALID_NATIVE_FILE_COMPOSITION', 'Main\'s media slot provider is required.');
      let job = null;
      job = createNativeFileRuntimeJob({ runtime, nativeSelections: nativeBackends, ownedRoot, acquireMediaSlot: request.acquireMediaSlot,
        policies: rows, ...(run ? { run } : {}) }, { ownedRootPin: () => rootPin, admitLease: async ({ signal }) => { await admitLease(signal); sinceScan = [job]; } });
      return job;
    },
    // Stages counted at the last lease plus any stage a later job still keeps;
    // null before the first native lease.
    keptStages() { return keptCount(); },
  });
  KINDS.set(controls, kind);
  return controls;
}

function createNativeFileControls(options) {
  composition(options, ['runtime', 'stateDir', 'nativeBackends'], ['runtime', 'stateDir', 'nativeBackends']);
  return compose(options, { kind: 'production', policies: DEFAULT_NATIVE_FILE_POLICIES });
}
function createTestNativeFileControls(options) {
  composition(options, ['runtime', 'stateDir', 'nativeBackends', 'policies', 'run'], ['runtime', 'stateDir', 'nativeBackends', 'policies']);
  return compose(options, { kind: 'injected', policies: options.policies, run: options.run });
}
function nativeFileControlsKind(value) { return (value && typeof value === 'object' && KINDS.get(value)) || null; }

module.exports = { createNativeFileControls, createTestNativeFileControls, nativeFileControlsKind, NATIVE_MESSAGES, NATIVE_MESSAGE_FAMILIES, nativeRefusal };
