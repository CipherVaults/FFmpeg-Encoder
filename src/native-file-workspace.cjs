'use strict';

const path = require('node:path');
const { describeNativeFileSource, buildNativeFileContract } = require('./native-file-contract.cjs');
const { getNativeProfile } = require('./backend-adapters.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { createOutputId, generationDescriptionOf, classifyMarker } = require('./provenance.cjs');
const { isSharedToolFailure } = require('./process-runner.cjs');
const { inspectInput, inspectMetadata } = require('./inspection.cjs');
const { exists } = require('./outputs.cjs');
const { capabilityKey } = require('./backend-adapters.cjs');
const { randomUUID } = require('node:crypto');
const { nativeRefusal, NATIVE_MESSAGES } = require('./native-file-controls.cjs');

// Main-only native file preparation (record 37 §3.2-§3.3). The service calls
// these with itself as `this`. Authority stays in main; every refusal reaching
// an item or a caller carries table text. This module adds no renderer channel.
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

// Main excludes the whole app data folder, including the runtime owner's
// native-files root, from output folders and every derived destination.
const stateRootOf = stateDir => path.resolve(stateDir);
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
  if (!ordinaryLocalFolder(output.path, stateRootOf(this.stateDir))) fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
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
    if (!nativeDestinationAllowed(destination, stateRootOf(this.stateDir))) fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
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
      contract, selection: token, policyId: assessed.policyId, evidenceIds: assessed.evidenceIds, details: nativeDetails(contract) });
    delete item.reasonCode; delete item.nativeReasons;
    Object.assign(item, { status: 'ready', beta: true, reason: READY_REASON });
    return null;
  } catch (error) {
    if (error.code === 'CANCELLED' || signal?.aborted || isSharedToolFailure(error)) throw error;
    return nativeItemRefusal(item, error);
  }
}

// Publication facts, never existence guesses: an unrelated destination created
// after a pre-link refusal cannot turn a retained stage into an uncertain save.
function nativeDisposition(code, snapshot = {}) {
  const { publication, stageState, stageRetained } = snapshot;
  if (publication === 'verified') return { kind: 'published', published: true };
  if (publication === 'committed' && code === 'NATIVE_FILE_PUBLISHED_CHANGED') return { kind: 'published-changed', published: false };
  if (code === 'PUBLICATION_UNCERTAIN' || publication === 'committed') return { kind: 'publication-uncertain', published: null };
  if (stageRetained && stageState === 'validated') return { kind: 'retained-completed', published: false };
  if (stageRetained && stageState === 'sealed') return { kind: 'retained-unvalidated', published: false };
  if (stageRetained && stageState === 'unsealed') return { kind: 'retained-incomplete', published: false };
  return { kind: 'stage-unavailable', published: false };
}
const NATIVE_STOP_CODES = new Set(['NATIVE_FILE_SELECTION_STALE', 'STALE_NATIVE_SELECTION', 'NATIVE_OWNER_UNSETTLED',
  'NATIVE_FILE_UNSETTLED', 'NATIVE_FILE_SOURCE_UNSETTLED', 'NATIVE_FILE_LEASE_REQUIRED', 'NATIVE_RUNTIME_STALE',
  'NATIVE_FILE_STAGE_QUOTA', 'NATIVE_FILE_STAGE_CHANGED']);
// Internal failures can carry hostile accessors too. Capture each own data
// property once; stderr's byte bound belongs to the journal, not its context.
const dataProperty = (value, key) => { try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch {} };

// The queue owns this whole lifecycle. Errors are classified before display
// mapping; only table text leaves main, including on exceptional cleanup paths.
async function executeNativeJob(item, entry, signal) {
  let runtime = null, errorCode = null, outcome = 'ok', invocationId;
  const record = async event => {
    try { return await this.recordIncident({ fileId: item.id, ...(invocationId ? { invocationId } : {}),
      ...event, context: { beta: true, nativePrivate: {}, ...event.context } }); }
    catch (error) { return { persisted: false, error }; }
  };
  const emit = () => { try { this.emitState(); } catch {} };
  const setJobStage = stage => {
    item.status = stage === 'encoding' ? 'running' : 'validating';
    this.state.progress = { fileId: item.id, stage, duration: null, percent: null };
    emit();
  };
  const destinationAllowed = () => {
    const stateRoot = stateRootOf(this.stateDir);
    if (!ordinaryLocalFolder(this.plan.output, stateRoot) || !nativeDestinationAllowed(entry.destination, stateRoot)) fail('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED');
  };
  const reserved = () => { destinationAllowed(); if (this.plan.reservedPaths.has(entry.destination.toLowerCase())) fail('PROTECTED_SOURCE'); };
  try {
    destinationAllowed();
    if (this.nativeFileRuntime !== null) fail('NATIVE_OWNER_UNSETTLED');
    requireNativeSelection.call(this, entry.selection);
    const jobOwner = {}; this.nativeFileJob = jobOwner;
    runtime = this.nativeFiles.createJob({ acquireMediaSlot: request => this.acquireNativeFileSlot(jobOwner, request) });
    this.nativeFileRuntime = runtime;
    await this.verifyFolders();
    if (await exists(entry.destination)) {
      item.status = 'skipped'; item.reasonCode = 'NATIVE_OUTPUT_APPEARED'; item.reason = NATIVE_MESSAGES.NATIVE_OUTPUT_APPEARED;
    } else {
      reserved();
      await this.assertSourceMatches(entry, signal, 'before-encode');
      const currentProbe = this.inspect === inspectInput
        ? await inspectMetadata(entry.file, { ffprobe: this.ffprobe, signal, run: this.run })
        : (await this.inspect(entry.file, { ffprobe: this.ffprobe, signal, run: this.run })).probe;
      if (classifyMarker(currentProbe).kind !== 'unmarked' || await this.provenanceJournal.lookupIdentity(entry.fingerprint)) fail('GENERATED_SOURCE');
      const current = describeNativeFileSource({ probe: currentProbe, sourceBytes: String(entry.fingerprint.size), request: entry.contract.request });
      if (current.sourceProbeFingerprint !== entry.contract.sourceProbeFingerprint) fail('NATIVE_FILE_APPLICABILITY_STALE');
      await this.assertSourceMatches(entry, signal, 'after-provenance-check');
      setJobStage('native-preparing');
      const token = await runtime.prepare({ contract: entry.contract, input: entry.file, selection: entry.selection,
        outputId: entry.outputId, generationDescription: entry.generationDescription }, { signal });
      await this.provenanceJournal.recordIntent({ outputId: entry.outputId, sourceIdentity: entry.fingerprint, destination: entry.destination,
        profileId: entry.contract.request.profileId, generationDescription: entry.generationDescription });
      const described = runtime.describe(token);
      invocationId = randomUUID();
      const started = await record({ stage: 'invocation', reason: 'ENCODE_STARTED', message: NATIVE_MESSAGES.NATIVE_ENCODE_STARTED,
        context: { code: 'NATIVE_ENCODE_STARTED', contractId: entry.contract.id, profileId: entry.contract.request.profileId,
          nativePrivate: { argv: described.command.argv, policyId: entry.policyId, nativeCellKey: capabilityKey(entry.selection.policy),
            evidenceIds: entry.evidenceIds, selectionEvidenceId: entry.selection.evidenceId } } });
      if (!started?.persisted) fail('OPERATION_DIAGNOSTICS_INCOMPLETE');
      setJobStage('encoding');
      const rate = /^(\d+)\/(\d+)$/.exec(entry.contract.expectedOutput.frameRate);
      const duration = rate ? Number(entry.contract.expectedOutput.declaredFrames) * Number(rate[2]) / Number(rate[1]) : NaN;
      let lastProgress = 0;
      const effective = await runtime.encode(token, { signal, onProgress: progress => {
        const seconds = progress?.seconds;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration <= 0) return;
        const percent = Math.max(lastProgress, Math.min(99, Math.max(0, seconds / duration * 100)));
        lastProgress = percent;
        this.state.progress = { fileId: item.id, stage: 'encoding', duration, seconds, percent }; emit();
      } });
      await record({ stage: 'encoding', reason: 'ENCODE_CLOSED', message: NATIVE_MESSAGES.NATIVE_ENCODE_CLOSED,
        context: { code: 'NATIVE_ENCODE_CLOSED', nativePrivate: { effective } } });
      setJobStage('native-evidence');
      for (const kind of ['source-metadata', 'output-metadata', 'source-raw', 'output-raw']) {
        let bytes = 0;
        await runtime.collect(token, kind, { signal, ...(kind.endsWith('-raw') ? { onStdoutChunk: chunk => { bytes += chunk.length; } } : {}) });
      }
      setJobStage('output-validation');
      const checked = await runtime.validate(token, { signal });
      const checkedRecord = await record({ stage: 'validation', reason: 'OUTPUT_CHECKED', message: NATIVE_MESSAGES.NATIVE_OUTPUT_CHECKED,
        context: { code: 'NATIVE_OUTPUT_CHECKED', nativePrivate: { checked } } });
      if (!checkedRecord?.persisted) fail('OPERATION_DIAGNOSTICS_INCOMPLETE');
      setJobStage('publication');
      await this.verifyFolders(); reserved();
      const pub = await runtime.publish(token, checked, { destination: entry.destination, signal,
        requireDestinationCurrent: async () => { await this.verifyFolders(); reserved(); } });
      item.status = pub.published ? 'success' : 'skipped';
      item.outcome = pub.published ? pub.warnings?.length ? 'saved-with-warning' : 'saved' : 'destination-collision';
      item.reasonCode = pub.published ? 'NATIVE_OUTPUT_SAVED' : 'NATIVE_OUTPUT_COLLISION';
      item.reason = NATIVE_MESSAGES[item.reasonCode];
      if (pub.warnings?.length) {
        item.warnings = pub.warnings.map(() => ({ code: 'SOURCE_CTIME_ONLY', message: NATIVE_MESSAGES.SOURCE_CTIME_ONLY }));
      }
      if (pub.published) {
        try { await this.provenanceJournal.recordPublished(entry.outputId, pub.identity); }
        catch (error) {
          item.outcome = 'saved-with-warning'; item.reasonCode = 'NATIVE_PROVENANCE_PENDING'; item.reason = NATIVE_MESSAGES.NATIVE_PROVENANCE_PENDING;
          await record({ stage: 'publication', reason: 'NATIVE_PROVENANCE_PENDING', message: item.reason,
            context: { code: item.reasonCode, nativePrivate: nativeRefusal(error).nativePrivate } });
        }
      }
    }
  } catch (error) {
    const refusal = nativeRefusal(error);
    errorCode = refusal.nativePrivate.code;
    const cancelled = signal?.aborted || errorCode === 'CANCELLED';
    item.status = cancelled ? 'cancelled' : 'failed';
    item.reasonCode = refusal.reasonCode; item.reason = refusal.reason;
    delete item.details; delete item.sourceIdentityDiagnostic;
    let shared = false;
    try { shared = isSharedToolFailure(error); } catch {}
    const stderr = dataProperty(error, 'stderr'), capture = dataProperty(error, 'stderrCapture');
    const totalBytes = dataProperty(capture, 'totalBytes'), truncated = dataProperty(capture, 'truncated');
    outcome = cancelled ? 'cancelled' : NATIVE_STOP_CODES.has(errorCode) || shared ? 'stop' : 'ok';
    if (outcome === 'stop') this.state.error = refusal.reason;
    await record({ stage: cancelled ? 'cancellation' : 'encoding', reason: cancelled ? 'JOB_CANCELLED' : 'JOB_FAILED',
      severity: cancelled ? 'info' : 'error', message: refusal.reason,
      stderr: typeof stderr === 'string' ? stderr : '',
      ...(totalBytes !== undefined && truncated !== undefined ? { stderrCapture: { totalBytes, truncated } } : {}),
      context: { code: refusal.reasonCode, nativePrivate: refusal.nativePrivate } });
    try { this.nativeBackends.requireFileSelection(entry.selection); }
    catch { item.reason += ' ' + NATIVE_MESSAGES.NATIVE_SELECTION_DISCARDED; }
  } finally {
    let settled = !runtime, bookkeepingError = null;
    try {
      if (runtime && !(settled = await this.settleNativeFileRuntime(error => { bookkeepingError = error; }))) {
        outcome = 'stop'; this.state.error = NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED;
      } else if (!runtime && !this.nativeFileRuntime) this.nativeFileJob = null;
    } catch (error) {
      // Settlement clears these fields only after confirming closure. A record
      // failure after that point cannot turn confirmed ownership into quarantine.
      settled = Boolean(runtime && this.nativeFileRuntime === null && this.nativeFileJob === null && this.nativeMediaSlot === null);
      if (settled) bookkeepingError = error;
      else {
        outcome = 'stop'; this.state.error = NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED;
        await record({ stage: 'recovery', reason: 'NATIVE_RUNTIME_CLOSE_FAILED', severity: 'warning',
          context: { code: 'NATIVE_OWNER_UNSETTLED', nativePrivate: nativeRefusal(error).nativePrivate } });
      }
    }
    // A derived disposition is a publication fact: a later record failure stops
    // the batch as incomplete diagnostics but never hides what happened to the output.
    let derived = false;
    try {
      const snapshot = runtime ? runtime.snapshot() : {};
      item.outputDisposition = nativeDisposition(errorCode, snapshot);
      if (item.outputDisposition.kind.startsWith('retained-')) item.nativeKeptStages = this.nativeFiles.keptStages();
      derived = true;
      if (bookkeepingError) throw bookkeepingError;
      if (item.outputDisposition.kind === 'published-changed') {
        const changed = await record({ stage: 'publication', reason: 'NATIVE_PUBLICATION_CHANGED', severity: 'error',
          message: NATIVE_MESSAGES.NATIVE_PUBLICATION_CHANGED, context: { code: 'NATIVE_PUBLICATION_CHANGED' } });
        if (!changed?.persisted) throw changed?.error || new Error(NATIVE_MESSAGES.OPERATION_DIAGNOSTICS_INCOMPLETE);
      }
      const disposition = await record({ stage: 'publication', reason: 'JOB_DISPOSITION', context: { code: item.reasonCode,
        status: item.status, outcome: item.outcome, outputDisposition: item.outputDisposition, nativeKeptStages: item.nativeKeptStages } });
      if (!disposition?.persisted) throw disposition?.error || new Error(NATIVE_MESSAGES.OPERATION_DIAGNOSTICS_INCOMPLETE);
    } catch (error) {
      outcome = 'stop';
      if (settled) {
        const code = derived ? 'OPERATION_DIAGNOSTICS_INCOMPLETE' : 'NATIVE_FILE_JOB_FAILED';
        this.state.error = NATIVE_MESSAGES[code];
        if (!derived) { item.outputDisposition = { kind: 'stage-unavailable', published: false }; delete item.nativeKeptStages; }
        await record({ stage: 'recovery', reason: code, severity: 'error', message: NATIVE_MESSAGES[code],
          context: { code, nativePrivate: nativeRefusal(error).nativePrivate } });
      } else {
        this.state.error = NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED;
        await record({ stage: 'recovery', reason: 'NATIVE_RUNTIME_CLOSE_FAILED', severity: 'warning',
          context: { code: 'NATIVE_OWNER_UNSETTLED', nativePrivate: nativeRefusal(error).nativePrivate } });
      }
    }
    emit();
  }
  return outcome;
}

module.exports = { readNativeBatchRequest, nativeBatchFolders, requireNativeReadiness, nativeGateRefusal, requireNativeOutputFolder,
  requireNativeSelection, nativeBatchState, nativeGenerationDescription, nativeDetails, nativeItemRefusal, prepareNativeItem,
  nativeDestinationAllowed, executeNativeJob, nativeDisposition };
