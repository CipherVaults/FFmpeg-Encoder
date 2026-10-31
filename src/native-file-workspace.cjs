'use strict';

const path = require('node:path');
const { describeNativeFileSource, buildNativeFileContract } = require('./native-file-contract.cjs');
const { getNativeProfile } = require('./backend-adapters.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { createOutputId, generationDescriptionOf } = require('./provenance.cjs');
const { isSharedToolFailure } = require('./process-runner.cjs');
const { nativeRefusal, NATIVE_MESSAGES } = require('./native-file-controls.cjs');

// Main-only native file preparation (record 37 §3.2-§3.3). The service calls
// these with itself as `this`. Nothing here grants Start, publication or a
// channel; every refusal reaching an item or a caller carries table text.
const fail = (code, cause) => { throw Object.assign(new Error(NATIVE_MESSAGES[code]), { code }, cause ? { cause } : {}); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const REQUEST_KEYS = ['inputFolderId', 'outputFolderId', 'selectionId', 'revision'];
const APP_VERSION = require('../package.json').version;
const READY_REASON ='Native file encoding (Beta): this file matches a qualified native policy. Main checks it again at Start.';
const DETAILS_NOTICE = 'Native encoder contribution only. Source, stage and device arguments are bound in main at start and kept in main-only diagnostics; this is not a command.';
// Readiness refusals keep their joined table texts; every other gate refusal is relabelled.
const READINESS_REFUSALS = new WeakSet();

// §3.2 step 1: exactly four own enumerable data properties, read once into a
// fresh record so an accessor never runs and a later read cannot differ.
function readNativeBatchRequest(request) {
  let fields;
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) throw new Error('shape');
    fields = Object.getOwnPropertyDescriptors(request);
    const keys = Reflect.ownKeys(fields);
    if (keys.length !== REQUEST_KEYS.length || keys.some(key => typeof key !== 'string' || !REQUEST_KEYS.includes(key)
        || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) throw new Error('fields');
  } catch (error) { fail('INVALID_REQUEST', error); }
  const value = Object.fromEntries(REQUEST_KEYS.map(key => [key, fields[key].value]));
  if (REQUEST_KEYS.slice(0, 3).some(key => typeof value[key] !== 'string' || !/^[a-f0-9-]{36}$/.test(value[key]))) fail('INVALID_ID');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('INVALID_NATIVE_REQUEST');
  return Object.freeze(value);
}

// The runtime owner's #destination rules, applied lexically in main to the
// output folder and to every derived destination.
const ownedRootOf = stateDir => path.join(path.resolve(stateDir), 'native-files');
function inside(value, root) {
  const target = path.win32.resolve(value).toLowerCase(), owned = path.win32.resolve(root).toLowerCase();
  return target === owned || target.startsWith(owned + '\\');
}
function ordinaryLocalFolder(folder, ownedRoot) {
  return typeof folder === 'string' && folder.length <= 32767 && !/[\x00-\x1f\x7f"<>|?*]/.test(folder)
    && /^[A-Za-z]:\\/.test(folder) && !folder.slice(2).includes(':') && !inside(folder, ownedRoot);
}
function nativeDestinationAllowed(file, ownedRoot) {
  const name = path.win32.basename(file);
  return ordinaryLocalFolder(file, ownedRoot) && ordinaryLocalFolder(path.win32.dirname(file), ownedRoot) && !/[. ]$/.test(file)
    && path.win32.extname(file).toLowerCase() === '.mkv' && !/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name);
}

// §3.2 step 3: roles, distinct folders and local drive-qualified paths. Lexical
// and synchronous; the step 5 recheck compares the registrations themselves.
function nativeBatchFolders(request) {
  const input = this.folders.get(request.inputFolderId), output = this.folders.get(request.outputFolderId);
  if (input?.role !== 'input' || output?.role !== 'output') fail('INVALID_FOLDER');
  if (input.path.toLowerCase() === output.path.toLowerCase()) fail('NATIVE_FILE_SAME_FOLDER_UNSUPPORTED');
  if (!/^[A-Za-z]:\\/.test(input.path)) fail('NATIVE_FILE_SOURCE_PATH_UNSUPPORTED');
  if (!ordinaryLocalFolder(output.path, ownedRootOf(this.stateDir))) fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
  return { input, output };
}

// §3.2 step 4: the thrown code is the first shown reason; the message joins
// every shown reason text in order, all from the frozen table.
function requireNativeReadiness() {
  const view = this.nativeFiles.readiness(this.nativeBackends.snapshot());
  if (view.available) return view;
  const error = Object.assign(new Error(view.reasons.map(reason => reason.message).join(' ')), { code: view.reasons[0].code });
  READINESS_REFUSALS.add(error);
  throw error;
}
function nativeGateRefusal(error) {
  if (READINESS_REFUSALS.has(error)) return error;
  const refusal = nativeRefusal(error);
  return Object.assign(new Error(refusal.reason), { code: refusal.reasonCode });
}

// After verifyFolders: a reparse ancestor or redirected output folder refuses.
async function requireNativeOutputFolder(folder) {
  try { if (await assertOrdinaryPath(folder, 'directory') !== folder) throw new Error('The output folder path is redirected.'); }
  catch (error) { fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED', error); }
}
// §3.2 step 8: the captured token must still be current before the plan is ready.
function requireNativeSelection(token) {
  try { this.nativeBackends.requireFileSelection(token); } catch (error) { fail('NATIVE_FILE_SELECTION_STALE', error); }
}

function nativeBatchState(token) {
  const { profileId, settings } = token.request;
  return { beta: true, profileId, label: getNativeProfile(profileId).label, settings: structuredClone(settings) };
}
// The native-v2 description of the requested encoder contribution; it must
// pass generationDescriptionOf (and later the command builder's comparison).
function nativeGenerationDescription(fragment, { appVersion, createdAt, runtimeVersion }) {
  return { version: 2, kind: 'native-encoder', adapterPolicyVersion: fragment.policyVersion, profileId: fragment.profileId,
    codec: fragment.codecName, backend: fragment.backend, encoder: fragment.encoder, preset: fragment.settings.preset,
    qualityMode: fragment.settings.mode.toUpperCase(), quality: structuredClone(fragment.settings.quality), bitDepth: fragment.bitDepth,
    pipelineId: fragment.pipelineId, encoderArgs: [...fragment.args], settingsRole: 'requested', scope: 'native-encoder-contribution-only',
    appVersion, createdAt, ...(typeof runtimeVersion === 'string' && runtimeVersion ? { runtimeVersion: runtimeVersion.slice(0, 256) } : {}) };
}
// Display data computed once at preparation (§7): no executable, argv or destination.
function nativeDetails(contract) {
  const { request, expectedOutput: o } = contract;
  return freeze({ kind: 'native-description', beta: true, profileId: request.profileId, label: getNativeProfile(request.profileId).label,
    settings: structuredClone(request.settings), contractId: contract.id, encoderArgs: [...contract.encoderContribution.args],
    expectedOutput: { codec: o.codec, profile: o.profile, bitDepth: o.bitDepth, pixelFormat: o.pixelFormat, width: o.width, height: o.height,
      frameRate: o.frameRate, target: o.target, signal: o.signal, range: o.range, resolution: o.resolution },
    notice: DETAILS_NOTICE });
}

function refuseItem(item, codes) {
  const reasons = codes.slice(0, 16), shown = nativeRefusal({ code: reasons[0] });
  delete item.details; delete item.sourceIdentityDiagnostic;
  Object.assign(item, { status: 'unsupported', beta: true, reasonCode: shown.reasonCode, reason: shown.reason, nativeReasons: reasons });
  return { code: reasons[0], message: '', causeCode: null, reasons };
}
// The shared catch's item is relabelled for native plans (invariant 9): the
// original message, stderr and identity diagnostic stay main-only.
function nativeItemRefusal(item, error) {
  const refusal = nativeRefusal(error);
  let diagnostic = null;
  try { const value = error?.sourceIdentityDiagnostic; if (value && typeof value === 'object') diagnostic = structuredClone(value); } catch {}
  delete item.details; delete item.sourceIdentityDiagnostic; delete item.nativeReasons;
  Object.assign(item, { status: 'unsupported', beta: true, reasonCode: refusal.reasonCode, reason: refusal.reason });
  return { ...refusal.nativePrivate, ...(diagnostic ? { sourceIdentityDiagnostic: diagnostic } : {}) };
}

// §3.3: dispatched after the shared identity, provenance, destination and
// inspection steps. Sets its own item; returns main-only detail or null.
function prepareNativeItem(item, { file, destination, inspection, identity, caps, signal }) {
  const plan = this.plan, token = plan.nativeSelection;
  try {
    if (!nativeDestinationAllowed(destination, ownedRootOf(this.stateDir))) fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
    const { profileId, settings } = token.request;
    const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: item.id, identityRevision: 0, draftId: plan.id, draftRevision: 0,
      profileId, settings, bitDepth: 8, target: 'matroska', resolution: 'source', range: null, signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy',
      omissionRequestIds: [] };
    const applicability = describeNativeFileSource({ probe: inspection.probe, sourceBytes: String(identity.size), request });
    if (applicability.status === 'outside-contract') return refuseItem(item, applicability.reasonCodes);
    const contract = buildNativeFileContract({ request, applicability });
    const assessed = this.nativeFiles.assess({ contract, selection: token });
    if (!assessed.admissible) return refuseItem(item, assessed.reasonCodes);
    const outputId = createOutputId();
    const generationDescription = nativeGenerationDescription(contract.encoderContribution, { appVersion: APP_VERSION,
      createdAt: new Date().toISOString(), runtimeVersion: caps?.versions?.ffmpeg });
    if (!generationDescriptionOf(generationDescription)) fail('NATIVE_FILE_DESCRIPTION_MISMATCH');
    plan.entries.set(item.id, { native: true, file, destination, fingerprint: identity, inspection, outputId, generationDescription,
      contract, selection: token, policyId: assessed.policyId, details: nativeDetails(contract) });
    delete item.reasonCode; delete item.nativeReasons;
    Object.assign(item, { status: 'ready', beta: true, reason: READY_REASON });
    return null;
  } catch (error) {
    if (error.code === 'CANCELLED' || signal?.aborted || isSharedToolFailure(error)) throw error;
    return nativeItemRefusal(item, error);
  }
}

module.exports = { readNativeBatchRequest, nativeBatchFolders, requireNativeReadiness, nativeGateRefusal, requireNativeOutputFolder,
  requireNativeSelection, nativeBatchState, nativeGenerationDescription, nativeDetails, nativeItemRefusal, prepareNativeItem,
  nativeDestinationAllowed };
