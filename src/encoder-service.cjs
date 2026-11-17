const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { selectVideo, outputPixelFormat, classifyColor } = require('./media.cjs');
const { resolveCatalogSettings, catalogProfile, describeCatalogRecipe, catalogCapability } = require('./encoder-catalog.cjs');
const { VENDOR_PROFILES, VENDOR_MESSAGES, vendorPixelFormat } = require('./vendor-profiles.cjs');
const { overlayVendorArgs, vendorArgsHash } = require('./vendor-encode.cjs');
const { vendorGuard, vendorRefusal, vendorPublicItem, requireVendorRoute, declaredVendorFrames, requireVendorArgs,
  requireVendorDevice, vendorOutputCheck } = require('./vendor-execution.cjs');
// The catalog returns ordinary settings unchanged; vendor twins stay main-only.
const catalogSettings = request => { const resolved = resolveCatalogSettings(request); return resolved.settings || resolved; };
const { encodeOutputName } = require('./operation-names.cjs');
const { buildEncodeOperation, validateEncodeOperationOutput, fingerprintEncodeSource, withEncodeOperationTelemetry,
  resolveEncodeOperationInvocation, validateEncodeOperationTelemetry } = require('./encode-operation.cjs');
const { isProportionalFamilySelection, assertProportionalCollectionSelection } = require('./operation-family.cjs');
const { collectOperationEvidence } = require('./operation-evidence.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('./operation-telemetry.cjs');
const { runTool, isSharedToolFailure, boundedToolStderr } = require('./process-runner.cjs');
const { inspectInput, inspectMetadata, finishInspection, parseProbeJson, validateOutput, normalizeProbe } = require('./inspection.cjs');
const { rangeLimitUs } = require('./operation-contract.cjs');
const { checkCapabilities } = require('./capabilities.cjs');
const { projectVendorCapabilities, failedVendorCapabilities } = require('./vendor-capabilities.cjs');
const { exists, createStage, sealStage, markStageValidated, retainSealedStage, cleanupStage, publishOutput, readPublishedOutputIdentity } = require('./outputs.cjs');
const { createOutputId, classifyMarker, historicalSuffix, ProvenanceJournal, generationDescriptionOf } = require('./provenance.cjs');
const { readFileStamp, readSourceIdentity, sameStamp, sameIdentity, assertIdentityMatches, assessCompletedSource } = require('./source-identity.cjs');
const { StorageEligibility } = require('./storage-eligibility.cjs');
const { InspectionCache } = require('./inspection-cache.cjs');
const { retainNativeInitialization } = require('./native-initialization-evidence.cjs');
const { nativeFileControlsKind, nativeRefusal, NATIVE_MESSAGES } = require('./native-file-controls.cjs');
const { readNativeBatchRequest, nativeBatchFolders, requireNativeReadiness, nativeGateRefusal, requireNativeOutputFolder,
  requireNativeSelection, nativeBatchState, nativeItemRefusal, prepareNativeItem, executeNativeJob } = require('./native-file-workspace.cjs');
const { Preferences } = require('./preferences.cjs');
const { DiagnosticJournal } = require('./diagnostics.cjs');
const { AppSettings } = require('./app-settings.cjs');
const { OperationDraft } = require('./operation-draft.cjs');
const { prepareRemuxItem, setRemuxOmissions, requireRemuxGrants, installRemuxDecisions, remuxOutputName } = require('./remux-workspace.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { collectRemuxEvidence } = require('./remux-evidence.cjs');
const { createRemuxStorageAllowance } = require('./operation-storage.cjs');
const { prepareHdrItem } = require('./hdr-workspace.cjs');
const { fingerprintHdrProbe } = require('./hdr-operation.cjs');
const { collectHdrEvidence } = require('./hdr-evidence.cjs');
const { prepareEncodePreservation, requireEncodePreservation, setEncodePreservationDecisions,
  installEncodePreservationDecisions } = require('./encode-preservation-workspace.cjs');

const BUSY = new Set(['checking', 'native-checking', 'preparing', 'running', 'cancelling']);
const EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);
const REMUX_EXTENSIONS = new Set([...EXTENSIONS, '.ts']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => structuredClone(value);
const OUTPUT_PLACEHOLDER = '<temporary output assigned at start>';
// Ordinary/legacy encode defaults remain unchanged. Main-private Remux or a
// genuine plan-bound proportional encode selection supplies its own limits.
const LEGACY_OPERATION_COSTS = Object.freeze({ pipeBytes: 256 * 1024 * 1024, evidenceBytes: 256 * 1024 * 1024,
  maxChildren: 64, evidenceReserveBytes: 32 * 1024 * 1024, stallMs: null });
function operationCostLimits(entry, qualified) {
  // Inspect only the presence of a claim; never invoke a forged flag getter.
  const proportionalClaim = qualified && ['object', 'function'].includes(typeof qualified) && 'proportional' in qualified;
  if (proportionalClaim) {
    if (entry.remux || entry.hdr || !entry.operationPlan || !isProportionalFamilySelection(qualified, entry.operationPlan))
      throw fail('OPERATION_PROPORTIONAL_BUDGET', 'Only this encode plan\'s genuine current proportional selection supplies resources.');
    return { ...qualified.resources, executionBudgetMs: qualified.executionBudgetMs };
  }
  if (!entry.remux) return { ...LEGACY_OPERATION_COSTS, executionBudgetMs: qualified?.executionBudgetMs ?? null };
  if (!qualified || qualified.remux !== true || !qualified.resources) throw fail('REMUX_PROPORTIONAL_BUDGET', 'A genuine source-derived Remux selection is required.');
  return { ...qualified.resources, executionBudgetMs: qualified.executionBudgetMs };
}
function createRemuxProgressClock(stallMs, deadline, now = Date.now) {
  if (!Number.isSafeInteger(stallMs) || stallMs <= 0 || !Number.isSafeInteger(deadline) || deadline <= now())
    throw fail('REMUX_PROPORTIONAL_BUDGET', 'Invalid Remux progress clock budget.');
  let advancedAt = now(), previousStage = '', previousValue = -1;
  return { advance(stage, completed = 0) {
    if (stage !== previousStage || Number.isFinite(completed) && completed > previousValue) {
      advancedAt = now(); previousStage = stage; previousValue = completed;
    }
  }, check() {
    if (now() >= deadline) return fail('REMUX_PROPORTIONAL_BUDGET', 'Remux exceeded its source-derived absolute time budget.');
    if (now() - advancedAt >= stallMs) return fail('REMUX_STALLED', 'Remux stopped making progress.');
    return null;
  } };
}
function requireRemuxOutputSpace({ freeBytes, actualBytes, maxOutputBytes, outputReserveBytes, evidenceReserveBytes }) {
  if (typeof freeBytes !== 'bigint' || freeBytes < 0n || typeof actualBytes !== 'bigint' || actualBytes < 0n
    || ![maxOutputBytes, outputReserveBytes, evidenceReserveBytes].every(Number.isSafeInteger)
    || maxOutputBytes <= 0 || outputReserveBytes < maxOutputBytes || evidenceReserveBytes < 0
    || actualBytes > BigInt(maxOutputBytes)
    || freeBytes < BigInt(outputReserveBytes) - actualBytes + BigInt(evidenceReserveBytes) + 25n * 1024n ** 3n)
    throw fail('REMUX_STORAGE', 'Insufficient or unknown output-volume space for source size plus margin and retained evidence.');
  return true;
}
const APP_VERSION = require('../package.json').version;
// Keep the owned child's capture accounting separate from the small UI excerpt.
// Journals must not relabel an upstream-truncated tail as a complete capture.
const diagnosticStderr = result => ({ stderr: typeof result?.stderr === 'string' ? result.stderr : '',
  ...(result?.stderrCapture ? { stderrCapture: result.stderrCapture } : {}) });
const diagnosticFields = (value, keys) => Object.fromEntries(keys.filter(key => value && Object.hasOwn(value, key))
  .map(key => [key, clone(value[key])]));
// Descriptive only: the exact latest range end main would accept for the
// selected video, sent to the window as an inert integer, or null when main
// cannot establish it. Main still validates every submitted range itself.
function rangeLimitOf(probe) {
  try {
    const normalized = normalizeProbe(probe), video = selectVideo(normalized);
    const limit = rangeLimitUs(normalized.mediaEvidence.streams.find(stream => stream.index === video.index));
    return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
  } catch { return null; }
}

function describeDiagnosticOperation(plan, request) {
  // Describe processing choices rather than duplicating private source/frame
  // evidence or an arbitrarily deep expected-output tree in every incident.
  // This inert projection carries no plan, grant or execution authority.
  const expected = plan?.expectedOutput || {};
  const resolved = diagnosticFields(expected, ['operation', 'target', 'timestampPolicy', 'dolbyVision', 'hdr10Claim']);
  if (expected.geometry) resolved.geometry = { ...diagnosticFields(expected.geometry, ['requested', 'mode', 'filterRequired']),
    output: diagnosticFields(expected.geometry.output, ['width', 'height', 'sampleAspectRatio', 'orientation']) };
  if (expected.range) resolved.range = diagnosticFields(expected.range, ['kind', 'requested', 'resolved', 'sourceOrigin', 'sourceDuration', 'absoluteStart', 'absoluteEnd', 'timestampMapping']);
  if (expected.audio) resolved.audio = { ...diagnosticFields(expected.audio, ['policy', 'noResampling', 'noDownmix', 'noIndependentTimestampZeroing']),
    streams: (expected.audio.streams || []).map(stream => diagnosticFields(stream, ['index', 'inputIndex', 'mode', 'codec', 'profile', 'sampleRate', 'channels', 'channelLayout', 'bitrateKbps', 'bitrateOrigin', 'timestampMapping', 'sampleRepresentation'])) };
  if (expected.color) resolved.color = diagnosticFields(expected.color, ['classification', 'supported', 'transfer', 'videoIndex']);
  if (plan?.validationMode === 'full-preservation-selection') resolved.preservation = {
    omittedStreams: clone(expected.omittedStreams), removedRelationships: clone(expected.removedRelationships),
    warning: clone(plan.contract.preservation.warning) };
  if (expected.hdr) resolved.hdr = { ...diagnosticFields(expected.hdr, ['hdr10Claim', 'dolbyVision']), signal: clone(expected.hdr.signal) };
  if (expected.hdrContract) resolved.hdrContract = { ...diagnosticFields(expected.hdrContract, ['route']),
    metadataDisposition: diagnosticFields(expected.hdrContract.metadataDisposition, ['action', 'dolby']) };
  return { requested: diagnosticFields(request, ['operation', 'target', 'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps']), resolved };
}
// A policy disposition must retain the owned child's bounded close diagnostics.
// In particular a storage monitor abort is not evidence that stderr was empty.
function operationFailure(disposition, upstream) {
  if (!upstream || upstream === disposition) return disposition;
  disposition.cause = upstream;
  Object.assign(disposition, boundedToolStderr(upstream));
  for (const key of ['exitCode', 'exitSignal', 'signal', 'stdoutCapture', 'evidenceDirectory', 'evidenceReceipt', 'sourceIdentityDiagnostic']) {
    if (Object.hasOwn(upstream, key)) disposition[key] = upstream[key];
  }
  return disposition;
}
const operationDuration = entry => entry.operationPlan?.contract.range.kind === 'range'
  ? (entry.operationPlan.contract.range.resolved.endUs - entry.operationPlan.contract.range.resolved.startUs) / 1000000
  : entry.inspection.duration;
const mergeWarnings = (...sets) => [...new Map(sets.flat().filter(Boolean).map(value => {
  const warning = typeof value === 'string' ? { code: 'OPERATION_VALIDATION_WARNING', message: value } : value;
  return [JSON.stringify(warning), warning];
})).values()];

function objectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw fail('INVALID_REQUEST', `Expected only: ${keys.join(', ')}.`);
  }
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw fail('INVALID_ID', 'Invalid selection or job identifier.');
  return value;
}
function notCancelled(signal) { if (signal?.aborted) throw fail('CANCELLED', 'Preparation cancelled.'); }
const sharedFailure = isSharedToolFailure;

class EncoderService extends EventEmitter {
  #vendorBindings = new Map();
  constructor({ ffmpeg, ffprobe, stateDir, run = runTool, inspect = inspectInput, verify = validateOutput, capabilities = checkCapabilities, vendorCapabilities = null,
    inspectionCache, storageEligibility, inspectionWorkers = 2, provenanceJournal, preferences, diagnostics, appSettings, outputAccess, runtimeIdentity = null, discoverBackends = null, nativeBackends = null,
    operationQualifications = null, operationEvidenceBudget = null, operationEnvironment = null, operationDeadlineMs = 120000,
    operationRuntime = null, operationStorage = null, operationTelemetry = false, remuxOperations = null, hdrOperations = null, encodePreservationOperations = null,
    nativeFiles = null, allowInjectedNativeFiles = false, vendorAdapters }) {
    super();
    if (![1, 2].includes(inspectionWorkers)) throw new TypeError('Inspection workers must be one or two.');
    // Main composes native file controls once (record 37). Only tests may pass
    // the injected brand, and only with this explicit allowance.
    const nativeFilesKind = nativeFiles === null ? null : nativeFileControlsKind(nativeFiles);
    if (nativeFiles !== null && (!nativeFilesKind || (nativeFilesKind === 'injected' && allowInjectedNativeFiles !== true))) {
      throw fail('INVALID_NATIVE_FILE_COMPOSITION', NATIVE_MESSAGES.INVALID_NATIVE_FILE_COMPOSITION);
    }
    Object.assign(this, { ffmpeg, ffprobe, stateDir, run, inspect, verify, capabilities, vendorCapabilities });
    this.vendorAdapters = vendorAdapters;
    this.inspectionWorkers = inspectionWorkers;
    this.folders = new Map();
    this.plan = null;
    this.capabilityResult = null;
    this.state = { revision: 0, batchId: null, phase: 'idle', planId: null, settings: null, items: [], progress: null, counts: {}, elapsedSeconds: 0, error: null };
    this.taskPromise = Promise.resolve();
    this.startedAt = 0;
    this.finishedAt = 0;
    this.preparationFailure = null;
    this.inspectionCache = inspectionCache;
    this.cacheInjected = inspectionCache !== undefined;
    this.cacheWarning = null;
    this.storageEligibility = storageEligibility || new StorageEligibility({ run });
    this.identityTail = Promise.resolve();
    this.provenanceJournal = provenanceJournal || new ProvenanceJournal({ directory: stateDir });
    this.recoveredProvenance = false;
    this.preferences = preferences || new Preferences({ directory: stateDir });
    this.rememberedFolders = { input: null, output: null };
    this.preferencesInitialization = null;
    this.preferenceMutation = null;
    this.preparedCancellation = null;
    this.cacheInitialization = null;
    this.diagnostics = diagnostics || new DiagnosticJournal({ directory: stateDir, versions: {
      app: APP_VERSION, ...(process.versions.electron ? { electron: process.versions.electron } : {}),
    } });
    this.diagnosticInitialization = null;
    this.appSettings = appSettings || new AppSettings({ directory: stateDir });
    this.appSettingsMutations = new Set();
    this.runtimeVersions = {};
    this.outputAccess = outputAccess || null;
    // Main supplies this only after checking the pinned runtime pair. Existing
    // direct mocks remain null; this field does not itself qualify a new path.
    this.runtimeIdentity = runtimeIdentity;
    this.discoverBackends = discoverBackends;
    this.nativeCapabilities = null;
    this.nativeBackends = nativeBackends;
    this.nativeMediaSlot = null;
    this.nativeOperation = null;
    // One native file job at a time owns these; they stay set (quarantine)
    // until its runtime confirms that no child, lease or source remains.
    this.nativeFiles = nativeFiles;
    this.nativeFileJob = null;
    this.nativeFileRuntime = null;
    this.nativeSettle = null;
    this.admissionClosed = false;
    // Main-private dependency injection, never an IPC registration surface.
    // Without a trusted catalog and complete cost envelope, changed operations
    // retain their existing refusal. Ordinary Full never consumes this gate.
    this.operationQualifications = operationQualifications;
    this.operationEvidenceBudget = operationEvidenceBudget;
    this.operationEnvironment = operationEnvironment;
    if (!Number.isSafeInteger(operationDeadlineMs) || operationDeadlineMs < 1 || operationDeadlineMs > 1800000) {
      throw new TypeError('Changed-operation deadline must be bounded to thirty minutes.');
    }
    this.operationDeadlineMs = operationDeadlineMs;
    this.operationRuntime = operationRuntime;
    this.operationStorage = operationStorage;
    this.operationStoragePromise = null;
    this.operationTelemetry = operationTelemetry;
    this.remuxOperations = remuxOperations;
    this.hdrOperations = hdrOperations;
    this.encodePreservationOperations = encodePreservationOperations;
    this.state.operation = 'encode';
    this.state.remuxSupport = { targets: ['matroska', 'mp4', 'mov'], notice: 'Full stream copy only. Each source/target and every retained stream needs a qualified preservation path; unsupported cases are explained per file.' };
  }

  async operationStore() {
    if (!this.operationStorage) throw fail('OPERATION_STORAGE_UNAVAILABLE', 'Cumulative evidence storage has not been observed.');
    return this.operationStoragePromise ||= Promise.resolve().then(() => typeof this.operationStorage === 'function'
      ? this.operationStorage() : this.operationStorage).catch(error => { this.operationStoragePromise = null; throw error; });
  }
  async closeOperationResources() {
    this.admissionClosed = true;
    // The caller drains queue children and sink callbacks first. Closing these
    // handles/leases never removes media or accumulated evidence.
    await this.taskPromise.catch(() => {});
    // A native file owner settles before its backend selections are invalidated.
    const nativeUnsettled = this.nativeFileRuntime && !(await this.settleNativeFileRuntime());
    this.hdrOperations?.invalidate();
    this.encodePreservationOperations?.invalidate();
    const closed = await Promise.allSettled([this.nativeBackends?.invalidate(), this.operationRuntime?.close(),
      this.operationStoragePromise ? this.operationStoragePromise.then(store => store.close()) : undefined]);
    const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
    if (nativeUnsettled) failures.push(fail('NATIVE_OWNER_UNSETTLED', NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED));
    if (this.nativeMediaSlot) failures.push(fail('NATIVE_OWNER_UNSETTLED', 'A native media owner has not released its slot.'));
    if (failures.length) throw new AggregateError(failures, 'Some owned operation resources could not be closed.');
  }

  // Saving application defaults never mutates a draft, prepared plan or active
  // queue. A new workspace snapshots them; applying them to an existing draft
  // is a separate explicit operation owned by that draft.
  async getAppSettings() { return this.appSettings.load(); }
  saveAppSettings(request) {
    return this.mutateAppSettings('save', request, 'APP_DEFAULTS_SAVED');
  }
  resetAppSettings(request) {
    return this.mutateAppSettings('reset', request, 'APP_DEFAULTS_RESET');
  }
  mutateAppSettings(method, request, reason) {
    // Register ownership synchronously, before the store can yield. Shutdown
    // drains the atomic write AND its diagnostic receipt, including failures.
    const pending = (async () => {
      const result = await this.appSettings[method](request);
      await this.recordIncident({ stage: 'admission', reason, context: { revision: result.revision } });
      return result;
    })();
    this.appSettingsMutations.add(pending);
    return pending.finally(() => this.appSettingsMutations.delete(pending));
  }
  getRuntimeInformation() {
    // No hardcoded mockup versions and no extra capability/encode work merely
    // to open Help. Missing observations remain visibly uninspected.
    return { appVersion: APP_VERSION, electron: process.versions.electron || null,
      chromium: process.versions.chrome || null, node: process.versions.node,
      platform: process.platform, architecture: process.arch,
      media: Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, this.runtimeVersions[name]
        ? { status: 'observed', version: this.runtimeVersions[name], executable: this[name] }
        : { status: 'not-yet-observed', version: null, executable: this[name] }])),
      backendDiscovery: this.capabilityResult?.backendDiscovery ? clone(this.capabilityResult.backendDiscovery) : null };
  }
  async recordRuntimeVersions(versions) {
    const safe = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const match = typeof versions?.[name] === 'string'
        && versions[name].match(new RegExp(`^${name} version ([A-Za-z0-9._+~\\-]{1,120})(?:\\s|$)`));
      if (match) { safe[name] = match[1]; this.runtimeVersions[name] = match[1]; }
    }
    if (Object.keys(safe).length) await this.recordIncident({ stage: 'capability', reason: 'RUNTIME_IDENTIFIED', context: { runtimeVersions: safe } });
  }

  async initializeDiagnostics() {
    const pending = this.diagnosticInitialization ||= (async () => {
      await fs.mkdir(this.stateDir, { recursive: true });
      return this.diagnostics.startSession();
    })();
    let result;
    try { result = await pending; }
    catch (error) {
      // Rejected initialization (including mkdir) is just as retryable as an
      // explicit persisted:false result. Do not retain a rejected promise.
      if (this.diagnosticInitialization === pending) this.diagnosticInitialization = null;
      this.state.diagnosticWarning = 'Diagnostic history is incomplete. The session start could not be saved.';
      throw error;
    }
    // A failed durable start is retryable; caching its false result forever
    // would hide recovery after a transient storage failure.
    if (!result.persisted) this.diagnosticInitialization = null;
    this.state.diagnostics = this.diagnostics.snapshot();
    if (!result.persisted) this.state.diagnosticWarning = 'Diagnostic history is incomplete. The session start could not be saved.';
    if (result.recovered?.length) {
      this.state.interruptedSessions = result.recovered;
      this.state.diagnosticWarning ||= 'A previous session was interrupted. Work after its last durable record is unknown. Review History; no jobs or files were resumed or deleted.';
    }
    return result;
  }

  // Persistence is observed, never assumed. A diagnostics failure must not
  // transform a valid media result into a false failure or conceal lost history.
  async recordIncident(event) {
    try {
      await this.initializeDiagnostics();
      const contextIds = Object.fromEntries(['batchId', 'planId'].filter(key => this.state[key]).map(key => [key, this.state[key]]));
      const result = await this.diagnostics.append({ ...contextIds, ...event });
      this.state.diagnostics = this.diagnostics.snapshot();
      if (!result.persisted) this.state.diagnosticWarning = 'Diagnostic history is incomplete. A record could not be saved.';
      return result;
    } catch (error) {
      this.state.diagnosticWarning = 'Diagnostic history is incomplete. A record could not be saved.';
      return { persisted: false };
    }
  }

  async closeDiagnostics(outcome = 'completed') {
    try {
      await this.initializeDiagnostics();
      const result = await this.diagnostics.closeSession({ outcome });
      this.state.diagnostics = this.diagnostics.snapshot();
      if (!result.persisted) this.state.diagnosticWarning = 'Diagnostic history is incomplete. The final session record could not be saved.';
      return result;
    } catch (error) {
      this.state.diagnostics = this.diagnostics.snapshot();
      this.state.diagnosticWarning = 'Diagnostic history is incomplete. The final session record could not be confirmed saved.';
      throw error;
    }
  }
  async getDiagnosticHistory(request) { await this.initializeDiagnostics(); return this.diagnostics.list(request); }
  async getDiagnosticRecord(request) {
    objectKeys(request, ['eventId']); await this.initializeDiagnostics(); return this.diagnostics.read(request.eventId);
  }
  async getDiagnosticExport(request) { await this.initializeDiagnostics(); return this.diagnostics.buildRedactedExport(request); }
  async openCompletedOutput(request) {
    objectKeys(request, ['outputId', 'action']);
    if (!this.outputAccess) throw fail('OUTPUT_ACCESS_UNAVAILABLE', 'Completed-output actions are unavailable in this host.');
    const result = await this.outputAccess.action(request);
    await this.recordIncident({ stage: 'publication', reason: 'OUTPUT_ACTION_DISPATCHED', context: { action: result.action } });
    return result;
  }

  get busy() { return BUSY.has(this.state.phase); }
  snapshot() {
    const counts = { success: 0, failed: 0, skipped: 0, cancelled: 0, unprocessed: 0 };
    for (const item of this.state.items) {
      if (['unsupported', 'provenance-issue'].includes(item.status)) counts.failed++;
      else if (Object.hasOwn(counts, item.status)) counts[item.status]++;
    }
    const items = VENDOR_PROFILES.some(profile => profile.id === this.state.settings?.profileId)
      ? this.state.items.map(vendorPublicItem) : this.state.items;
    return clone({ ...this.state, items, counts, elapsedSeconds: this.startedAt ? ((this.finishedAt || Date.now()) - this.startedAt) / 1000 : 0 });
  }
  emitState() {
    this.state.revision++;
    this.emit('update', this.snapshot());
  }
  requireIdle() {
    if (this.admissionClosed) throw fail('SHUTTING_DOWN', 'The application is closing.');
    if (this.nativeFileRuntime && !this.busy) { void this.settleNativeFileRuntime(); throw fail('NATIVE_OWNER_UNSETTLED', NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED); }
    if (this.busy || this.preferenceMutation || this.nativeMediaSlot) throw fail('BUSY', 'Wait for the current operation and cleanup to finish.');
  }
  closeAdmission() { this.admissionClosed = true; }
  // Record 37 §3.5: a prepared native file plan fixes its selection, source
  // permissions and options until it is cancelled, replaced or finished.
  requireNoNativePlan(code) {
    if (this.plan?.operation === 'native-encode' && (this.state.phase === 'ready' || this.busy)) throw fail(code, NATIVE_MESSAGES[code]);
  }

  getNativeBackendState() {
    if (!this.nativeBackends) throw fail('NATIVE_BACKEND_UNAVAILABLE', 'Native backend qualification is unavailable in this host.');
    return this.nativeBackends.snapshot();
  }
  selectNativeBackend(request) {
    this.requireIdle(); this.requireNoNativePlan('NATIVE_FILE_PLAN_ACTIVE'); this.getNativeBackendState();
    const result = this.nativeBackends.select(request);
    this.emitState(); return result;
  }
  // One scheduler/controller/task owns ordinary capabilities, native discovery,
  // initialization, encode/decode probes and application workflows. A distinct
  // phase prevents getCapabilities from joining the wrong kind of task.
  async runNativeBackendOperation(method, request) {
    this.requireIdle(); this.requireNoNativePlan('NATIVE_FILE_PLAN_ACTIVE'); this.getNativeBackendState();
    const previousState = this.state, previousTimes = { startedAt: this.startedAt, finishedAt: this.finishedAt };
    const signal = this.begin('native-checking');
    const nativeOperation = {}; this.nativeOperation = nativeOperation;
    let result, failure;
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ stage: 'capability', reason: 'NATIVE_CHECK_STARTED', context: { action: method } });
        result = method === 'refresh' ? await this.nativeBackends.refresh({ signal })
          : await this.nativeBackends.qualify(request, { signal });
        notCancelled(signal);
      } catch (error) { failure = error; }
      finally {
        try {
          if (signal.aborted) await this.nativeBackends.invalidate();
          await this.recordIncident({ stage: 'capability', reason: failure ? 'NATIVE_CHECK_FAILED' : 'NATIVE_CHECK_FINISHED',
            severity: failure ? 'warning' : 'info', context: { action: method, code: failure?.code || 'COMPLETED', fileExecutionReady: false } });
        } catch (error) { failure ||= error; }
        if (this.nativeMediaSlot) failure ||= fail('NATIVE_OWNER_UNSETTLED', 'The native media owner has not confirmed release.');
        this.state = { ...previousState, revision: this.state.revision, diagnostics: this.state.diagnostics,
          diagnosticWarning: this.state.diagnosticWarning, interruptedSessions: this.state.interruptedSessions,
          ...(this.nativeMediaSlot ? { phase: 'native-checking', error: failure.message } : {}) };
        Object.assign(this, previousTimes); this.emitState();
        if (this.nativeOperation === nativeOperation) this.nativeOperation = null;
      }
    })();
    await this.taskPromise;
    if (failure) throw failure;
    return result;
  }
  refreshNativeBackends() { return this.runNativeBackendOperation('refresh'); }
  qualifyNativeBackend(request) { return this.runNativeBackendOperation('qualify', request); }
  acquireNativeMediaSlot({ signal, purpose }) {
    if (this.admissionClosed || this.state.phase !== 'native-checking' || this.controller.signal.aborted || signal?.aborted
        || !['native-backend-initialization', 'native-backend-capability'].includes(purpose) || this.nativeMediaSlot) {
      throw fail('NATIVE_MEDIA_ADMISSION_REFUSED', 'The current native operation does not own an available media slot.');
    }
    const owner = {}; this.nativeMediaSlot = owner;
    return { release: async () => { if (this.nativeMediaSlot === owner) this.nativeMediaSlot = null; } };
  }
  // The native file runtime's lease: only the current running job, for its one
  // purpose, with no other holder. Never an IPC surface (record 37 §4).
  acquireNativeFileSlot(jobOwner, { signal, purpose } = {}) {
    if (this.admissionClosed || this.state.phase !== 'running' || typeof jobOwner !== 'object' || jobOwner === null
        || this.nativeFileJob !== jobOwner || purpose !== 'native-file-runtime' || this.controller?.signal.aborted !== false
        || signal?.aborted || this.nativeMediaSlot) {
      throw fail('NATIVE_MEDIA_ADMISSION_REFUSED', NATIVE_MESSAGES.NATIVE_MEDIA_ADMISSION_REFUSED);
    }
    // Release clears only its own holder, so a repeated or stale release is inert.
    const owner = {}; this.nativeMediaSlot = owner;
    return { release: async () => { if (this.nativeMediaSlot === owner) this.nativeMediaSlot = null; } };
  }
  // Single-flight. The owner is dropped only after close() resolves and the
  // runtime reports no work, lease, unknown lease or source handle, and the
  // slot is free. Otherwise it stays quarantined; resolves true when settled.
  settleNativeFileRuntime(onBookkeepingError) {
    return this.nativeSettle ||= (async () => {
      const runtime = this.nativeFileRuntime;
      if (!runtime) return true;
      let settled = false, failure = null, facts = {};
      try { await runtime.close(); } catch (error) { failure = error; }
      // The facts are read on both paths: a rejected close is the usual
      // permanent-quarantine case, and its record must say what is still held.
      try {
        const s = runtime.snapshot();
        facts = { busy: s.busy === true, leaseHeld: s.leaseHeld === true, leaseOwnershipUnknown: s.leaseOwnershipUnknown === true,
          sourceHeld: s.sourceHeld === true, slotHeld: this.nativeMediaSlot !== null };
        settled = !failure && s.busy === false && s.leaseHeld === false && s.leaseOwnershipUnknown === false && s.sourceHeld === false
          && this.nativeMediaSlot === null;
      } catch (error) { failure ||= error; }
      if (settled && this.nativeFileRuntime === runtime) { this.nativeFileRuntime = null; this.nativeFileJob = null; }
      try {
        const recorded = await this.recordIncident({ stage: 'recovery', reason: settled ? 'NATIVE_RUNTIME_SETTLED' : 'NATIVE_RUNTIME_CLOSE_FAILED',
          severity: settled ? 'info' : 'warning', context: { settled, ...facts,
            ...(failure ? { nativePrivate: nativeRefusal(failure).nativePrivate } : {}) } });
        if (settled && !recorded?.persisted) onBookkeepingError?.(new Error(NATIVE_MESSAGES.OPERATION_DIAGNOSTICS_INCOMPLETE));
      } catch (error) {
        // A record failure never changes the settlement result and never rejects:
        // requireIdle does not await this, and shutdown must still close the rest.
        if (settled) onBookkeepingError?.(error);
      }
      // requireIdle does not await this; a listener fault must not become an
      // unhandled rejection. The settled state is already recorded above.
      try { if (settled) this.emitState(); } catch {}
      return settled;
    })().finally(() => { this.nativeSettle = null; });
  }
  async retainNativeInitialization(report) {
    if (!this.nativeOperation || !['native-checking', 'cancelling'].includes(this.state.phase)) throw fail('NATIVE_MEDIA_ADMISSION_REFUSED', 'Only the current native operation may retain initialization evidence.');
    return retainNativeInitialization({ store: await this.operationStore(), report });
  }
  begin(phase) {
    this.controller = new AbortController();
    this.preparationFailure = null;
    this.startedAt = Date.now();
    this.finishedAt = 0;
    this.state = { ...this.state, phase, batchId: randomUUID(), progress: null, preparation: null, error: null };
    this.emitState();
    return this.controller.signal;
  }

  async getCapabilities() {
    return this.#getCapabilities();
  }
  // Only native preparation can select fixed-text failure diagnostics. A
  // joined check keeps the policy of the caller that started it.
  async #getCapabilities(native = false) {
    if (this.capabilityResult) return clone(this.capabilityResult);
    if (this.state.phase === 'checking') {
      await this.taskPromise;
      if (!this.capabilityResult) throw fail('CAPABILITIES_FAILED', this.state.error || 'Runtime capabilities unavailable.');
      return clone(this.capabilityResult);
    }
    this.requireIdle();
    const previousState = this.state;
    const previousTimes = { startedAt: this.startedAt, finishedAt: this.finishedAt };
    const signal = this.begin('checking');
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ stage: 'capability', reason: 'CAPABILITY_STARTED' });
        await fs.mkdir(this.stateDir, { recursive: true });
        const capabilityResult = await this.capabilities({ ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, stateDir: this.stateDir, signal, run: this.run });
        await this.recordRuntimeVersions(capabilityResult.versions);
        let nativeCapabilities = null;
        if (this.discoverBackends) {
          const discovered = await this.discoverBackends({ signal, run: this.run, versions: capabilityResult.versions });
          notCancelled(signal);
          nativeCapabilities = discovered.registry;
          capabilityResult.backendDiscovery = discovered.display;
        }
        let vendorBindings = new Map(), vendorPrivate;
        if (this.vendorCapabilities) {
          try {
            const vendors = await this.vendorCapabilities({ ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, stateDir: this.stateDir, signal, run: this.run });
            notCancelled(signal);
            capabilityResult.vendorProfiles = projectVendorCapabilities(vendors);
            vendorBindings = new Map(vendors.bindings);
            vendorPrivate = vendors.nativePrivate;
          } catch (error) {
            notCancelled(signal);
            if (error?.code === 'CANCELLED') throw fail('CANCELLED', 'Vendor capability inspection cancelled.');
            vendorBindings = new Map();
            capabilityResult.vendorProfiles = failedVendorCapabilities();
            vendorPrivate = { message: typeof error?.message === 'string' ? error.message : null,
              ...diagnosticStderr(error), context: error?.nativePrivate };
          }
        }
        await this.recordIncident({ stage: 'capability', reason: 'CAPABILITY_FINISHED',
          context: vendorPrivate ? { ...capabilityResult, nativePrivate: vendorPrivate } : capabilityResult });
        await this.recoverProvenance(signal);
        notCancelled(signal);
        this.capabilityResult = capabilityResult;
        this.#vendorBindings = vendorBindings;
        this.nativeCapabilities = nativeCapabilities;
        // Capability initialization is a separate operation. Returning from it
        // must not erase a completed/failed/cancelled workflow or its timings.
        this.state = { ...previousState, revision: this.state.revision, provenanceRecovery: this.state.provenanceRecovery,
          diagnostics: this.state.diagnostics, diagnosticWarning: this.state.diagnosticWarning, interruptedSessions: this.state.interruptedSessions };
        Object.assign(this, previousTimes);
      } catch (error) {
        // Partially completed capability/discovery work is not a reusable ready
        // result after cancellation or failure. A retry re-observes ownership.
        this.capabilityResult = null;
        this.#vendorBindings.clear();
        this.nativeCapabilities = null;
        await this.recordRuntimeVersions(error.runtimeVersions);
        this.state.phase = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        const failure = native ? nativeRefusal(error) : null;
        this.state.error = failure ? failure.reason : error.message;
        // As for every native event, stderr keeps its bounded tail; the projection withholds its text.
        await this.recordIncident({ stage: 'capability', reason: 'CAPABILITY_FAILED', severity: 'error', message: this.state.error,
          ...diagnosticStderr(error), context: { code: failure ? failure.reasonCode : error.code, ...(failure ? { nativePrivate: failure.nativePrivate } : {}) } });
      } finally { this.emitState(); }
    })();
    await this.taskPromise;
    if (!this.capabilityResult) throw fail('CAPABILITIES_FAILED', this.state.error || 'Runtime capabilities unavailable.');
    return clone(this.capabilityResult);
  }

  async registerFolder(folder, role) {
    if (!['input', 'output'].includes(role)) throw fail('INVALID_FOLDER', 'Invalid folder role.');
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      const canonical = await fs.realpath(folder);
      if (!(await fs.stat(canonical)).isDirectory()) throw fail('INVALID_FOLDER', 'Select a directory.');
      for (const [key, entry] of this.folders) if (entry.role === role) this.folders.delete(key);
      const token = randomUUID();
      this.folders.set(token, { path: canonical, role });
      this.rememberedFolders[role] = { id: token, path: canonical, available: true };
      await this.preferences.rememberFolder(role, canonical);
      this.invalidatePlan();
      return { id: token, path: canonical };
    });
  }

  invalidatePlan() {
    this.remuxOperations?.invalidate();
    this.hdrOperations?.invalidate();
    this.encodePreservationOperations?.invalidate();
    this.plan = null;
    this.state.planId = null;
    this.state.encodingSettingsStale = false;
    this.state.operationDraft = null;
    if (this.state.phase === 'ready') {
      Object.assign(this.state, { phase: 'idle', items: [], progress: null, preparation: null, settings: null });
    }
    this.emitState();
  }

  invalidatePreparedEncoding() {
    // Ordinary encoder settings never feed a native plan, so saving them keeps it.
    if (this.plan?.operation === 'native-encode') return;
    if (this.plan?.operation === 'remux') return;
    this.hdrOperations?.invalidate();
    this.encodePreservationOperations?.invalidate();
    if (!this.plan?.draft || this.state.phase !== 'ready') return this.invalidatePlan();
    // Remembering expert-control edits must revoke prepared execution without
    // deleting the user's per-file draft. Keep the draft revision unchanged so
    // an unsent range edit in the renderer is not overwritten by autosave.
    // Only explicit reprepare validates new settings and advances that revision.
    this.plan.id = randomUUID(); this.state.planId = this.plan.id;
    this.plan.encodingSettingsStale = true; this.state.encodingSettingsStale = true;
    this.plan.entries.clear(); this.plan.overrides.clear(); this.plan.ambiguities.clear();
    this.plan.generated.clear(); this.plan.reencodeAuthorizations.clear();
    this.plan.encodePreservationGrants?.clear(); this.plan.encodePreservationCandidates?.clear();
    for (const item of this.state.items) {
      delete item.encodePreservation; delete item.warnings;
      Object.assign(item, { status: 'unprocessed', reencodeAuthorized: false,
        reasonCode: 'ENCODING_SETTINGS_CHANGED', reason: 'Encoding settings changed. Prepare this draft again before starting.' });
    }
    this.emitState();
  }

  mutatePreferences(operation) {
    this.requireIdle();
    // Close admission synchronously, before any disk await. This prevents a
    // renderer from racing a reset/save/folder change against batch startup.
    const pending = Promise.resolve().then(operation);
    this.preferenceMutation = pending;
    return pending.finally(() => { this.preferenceMutation = null; });
  }

  initializePreferences() {
    this.preferencesInitialization ||= (async () => {
      const saved = await this.preferences.load();
      for (const role of ['input', 'output']) {
        const folder = saved[`${role}Path`];
        if (!folder) continue;
        try {
          const canonical = await fs.realpath(folder);
          if (!(await fs.stat(canonical)).isDirectory()) throw fail('INVALID_FOLDER', 'The remembered location is not a directory.');
          const token = randomUUID();
          this.folders.set(token, { path: canonical, role });
          this.rememberedFolders[role] = { id: token, path: canonical, available: true };
        } catch (error) {
          // Keep the display path, but issue no authority for unavailable data.
          this.rememberedFolders[role] = { id: null, path: folder, available: false,
            reason: error.code === 'ENOENT' ? 'This remembered folder is missing or disconnected. Choose a folder to continue.'
              : 'This remembered folder is unavailable. Choose a folder to continue.' };
        }
      }
    })();
    return this.preferencesInitialization;
  }

  preferencesSnapshot() {
    const { profileId, settingsByProfile, notices } = this.preferences.snapshot();
    const capability = catalogCapability(this.capabilityResult, profileId);
    if (capability && !capability.available) notices.push(`${capability.label} remains selected but is unavailable: ${capability.reason || 'The encoder could not initialize on this computer.'}`);
    return clone({ inputFolder: this.rememberedFolders.input, outputFolder: this.rememberedFolders.output,
      profileId, settingsByProfile, notices });
  }

  async getPreferences() {
    await this.initializePreferences();
    if (this.preferenceMutation) await this.preferenceMutation;
    return this.preferencesSnapshot();
  }

  async saveSettings(request) {
    const settings = catalogSettings(request);
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      await this.preferences.saveSettings(settings);
      this.invalidatePreparedEncoding();
      return this.preferencesSnapshot();
    });
  }

  getRecipe(request) {
    return clone(describeCatalogRecipe(catalogSettings(request)));
  }

  getEncodingDetails(request) {
    objectKeys(request, ['planId', 'fileId']);
    if (!this.plan || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare the current batch again.');
    const entry = this.plan.entries.get(id(request.fileId));
    if (!entry) throw fail('UNPREPARED_FILE', 'Resolved encoding details are available after this file is admitted and prepared.');
    // Native details were frozen at preparation and never derive from argv (record 37 §7).
    if (entry.native) return clone(entry.details);
    // This is display data, not a shell command or an argument submission API.
    // Execution consumes this exact stored array, substituting only its final
    // staging filename. The eventual publication destination is separate.
    return clone({ kind: entry.actualArgs ? 'actual-invocation' : 'resolved-argument-template', executable: this.ffmpeg,
      args: entry.actualArgs || entry.preparedArgs, destination: entry.destination,
      operation: entry.operationPlan ? { contract: entry.operationPlan.contract, expectedOutput: entry.operationPlan.expectedOutput,
        ...(entry.remux ? { verificationMethod: entry.operationPlan.verificationMethod, verificationClaim: entry.operationPlan.verificationClaim } : {}),
        compatibilityPath: entry.operationPlan.compatibilityPath, ...(entry.operationPlan.validationMode ? { validationMode: entry.operationPlan.validationMode } : {}), instrumentation: entry.operationPlan.instrumentation || null } : null,
      ...(entry.actualArgs ? {} : { outputPlaceholder: OUTPUT_PLACEHOLDER }),
      notice: entry.actualArgs ? 'Exact arguments passed to FFmpeg. This temporary output is validated before publication.'
        : entry.operationPlan.instrumentation ? 'Canonical prepared arguments with labelled owned telemetry and staging slots. Exclusive paths are bound by main at start; actual invocation details replace these slots. This is not a shell command.'
        : 'Complete prepared arguments; only the final temporary output path is assigned when encoding starts. This is an argument array, not a shell command.' });
  }

  async resetProfile(request) {
    objectKeys(request, ['profileId']);
    if (!catalogProfile(request.profileId)) throw fail('INVALID_SETTINGS', 'Choose a supported encoding profile.');
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      await this.preferences.resetProfile(request.profileId);
      this.invalidatePreparedEncoding();
      return this.preferencesSnapshot();
    });
  }

  async forgetPreferences() {
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      await this.preferences.forget();
      this.folders.clear();
      this.rememberedFolders = { input: null, output: null };
      this.invalidatePlan();
      return this.preferencesSnapshot();
    });
  }

  async clearInspectionCache() {
    return this.mutatePreferences(async () => {
      // Await any initialization already in flight. Clearing does not require
      // a successful eligibility helper, capabilities or a usable ffprobe.
      if (this.cacheInitialization) await this.cacheInitialization;
      if (!this.inspectionCache) await this.initializeInspectionCache();
      const cache = this.inspectionCache || new InspectionCache({ directory: path.join(this.stateDir, 'cache'), ffprobeHash: '0'.repeat(64) });
      const cleared = await cache.clear();
      return cleared ? { cleared: true } : { cleared: false, notice: cache.warning || 'The inspection cache could not be cleared.' };
    });
  }

  async initializeInspectionCache(signal) {
    if (this.cacheInjected) return;
    if (this.cacheInitialization) return this.cacheInitialization;
    this.cacheInitialization = (async () => { try {
      // Bind evidence to bytes actually shipped, not just a version label. Hash
      // once per unchanged runtime in this service; capability availability is
      // still established independently by real device encodes.
      const before = await readFileStamp(this.ffprobe);
      if (sameStamp(before, this.cacheProbeStamp) && this.inspectionCache) return;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(this.ffprobe, { signal })) hash.update(chunk);
      notCancelled(signal);
      if (!sameStamp(before, await readFileStamp(this.ffprobe))) throw fail('INPUT_CHANGED', 'The inspector runtime changed while being identified.');
      this.inspectionCache = new InspectionCache({ directory: path.join(this.stateDir, 'cache'), ffprobeHash: hash.digest('hex') });
      this.cacheProbeStamp = before;
      this.cacheWarning = null;
    } catch (error) {
      notCancelled(signal);
      this.inspectionCache = null;
      this.cacheWarning = 'Persistent inspection reuse is unavailable; using fresh inspection.';
    } })();
    try { await this.cacheInitialization; }
    finally { this.cacheInitialization = null; }
  }

  async identifyForInspection(file, signal) {
    // Serialized identity reads avoid uncontrolled seeks on archive HDDs even
    // when decoded inspection later uses more than one worker. Failed tasks do
    // not poison the chain; callers still receive their own error.
    const pending = this.identityTail.then(async () => {
      notCancelled(signal);
      const stamp = await readFileStamp(file);
      const storage = this.inspectionCache ? await this.storageEligibility.check(file, stamp, { signal })
        : { eligible: false, reason: this.cacheWarning };
      notCancelled(signal);
      // Provenance recognition and explicit legacy overrides need content-bound
      // identity even when persistent inspection caching is unavailable.
      const identity = await readSourceIdentity(file, { signal });
      assertIdentityMatches(stamp, identity, { stage: 'after-storage-eligibility', message: 'Source identity changed after storage eligibility was checked.' });
      return { identity, reusable: storage.eligible, reason: storage.reason };
    });
    this.identityTail = pending.catch(() => {});
    return pending;
  }

  async assertSourceMatches(entry, signal, stage, message) {
    notCancelled(signal);
    try {
      const digest = Boolean(entry.fingerprint.sparseDigest);
      const actual = digest ? await readSourceIdentity(entry.file, { signal }) : await readFileStamp(entry.file);
      assertIdentityMatches(entry.fingerprint, actual, { stage, message, digest });
    } catch (error) {
      if (error.code !== 'CANCELLED' && !signal?.aborted) {
        // Preserve sampling's more precise path/handle stage when it failed;
        // the outer checkpoint still identifies which encode check requested it.
        error.sourceIdentityDiagnostic = error.sourceIdentityDiagnostic
          ? { ...error.sourceIdentityDiagnostic, checkpoint: stage }
          : { version: 1, stage, changedFields: [], readFailure: error.code || 'IDENTITY_READ_FAILED',
            expected: clone(entry.fingerprint), actual: null };
      }
      throw error;
    }
  }

  async assessCompletedSource(entry, signal) {
    notCancelled(signal);
    try {
      // readSourceIdentity still rejects internally inconsistent path/handle
      // samples. Only a complete stable observation reaches the ctime policy.
      const actual = await readSourceIdentity(entry.file, { signal });
      return assessCompletedSource(entry.fingerprint, actual);
    } catch (error) {
      if (error.code === 'CANCELLED' || signal?.aborted) throw error;
      return { kind: 'incomplete', diagnostic: error.sourceIdentityDiagnostic
        ? { ...error.sourceIdentityDiagnostic, checkpoint: 'after-encode', readFailure: error.code || 'IDENTITY_READ_FAILED' }
        : { version: 1, stage: 'after-encode', checkpoint: 'after-encode', changedFields: [],
          expected: clone(entry.fingerprint), actual: null, readFailure: error.code || 'IDENTITY_READ_FAILED' } };
    }
  }

  prepareVendorItem(item, { file, destination, inspection, identity, marker, indexed, settings, profile, caps }) {
    requireVendorRoute(inspection, item.operationRequest);
    const video = selectVideo(inspection.probe);
    // Refuse silent chroma/range conversions before creating any argv.
    vendorPixelFormat(profile, video.pix_fmt);
    const bitDepth = video.pix_fmt === 'yuv420p10le' ? 10 : 8;
    vendorGuard('capability-depth', catalogCapability(caps, profile.id)?.supportedBitDepths.includes(bitDepth), 'VENDOR_DEPTH_NOT_OFFERED');
    const binding = this.#vendorBindings.get(`${profile.id}:${bitDepth}`);
    vendorGuard('preparation-binding', binding !== undefined && binding !== null, 'VENDOR_DEVICE_REQUIRED');
    const { twinSettings } = resolveCatalogSettings(settings), recipe = describeCatalogRecipe(settings);
    const outputId = createOutputId();
    const generationDescription = generationDescriptionOf({ version: 3, kind: 'vendor-encoder', profileId: profile.id,
      codec: profile.codec, backend: profile.hardware, encoder: profile.encoder, preset: settings.preset,
      qualityMode: recipe.qualityMode, quality: settings.quality, bitDepth, encoderArgs: recipe.args,
      appVersion: APP_VERSION, createdAt: new Date().toISOString(),
      ...(typeof caps.versions?.ffmpeg === 'string' ? { runtimeVersion: caps.versions.ffmpeg.slice(0, 256) } : {}) });
    vendorGuard('description', generationDescription !== null, 'INVALID_PLAN');
    let preservation;
    try { preservation = prepareEncodePreservation.call(this, item, { probe: inspection.probe, identity, settings: twinSettings }); }
    catch (error) {
      if (!error.code?.startsWith('ENCODE_PRESERVATION_')) throw error;
      throw fail('VENDOR_ROUTE_UNQUALIFIED', VENDOR_MESSAGES.VENDOR_ROUTE_UNQUALIFIED);
    }
    vendorGuard('preservation', !preservation, 'VENDOR_ROUTE_UNQUALIFIED');
    const operationPlan = buildEncodeOperation({ input: file, output: destination, settings: twinSettings, inspection,
      request: item.operationRequest, runtimeIdentity: this.runtimeIdentity, outputId, generationDescription });
    vendorGuard('compatibility', operationPlan.compatibilityPath === true, 'VENDOR_ROUTE_UNQUALIFIED');
    const args = overlayVendorArgs(operationPlan.args, { twinSettings, profile, settings, bitDepth, binding });
    const preparedArgs = Object.freeze([...args.slice(0, -1), OUTPUT_PLACEHOLDER]);
    const vendor = Object.freeze({ profileId: profile.id, settings: Object.freeze({ ...settings }),
      twinSettings: Object.freeze(twinSettings), binding, argsHash: vendorArgsHash(preparedArgs), sourceFrameCount: declaredVendorFrames(video) });
    this.plan.entries.set(item.id, { file, destination, inspection, fingerprint: identity, overridden: this.plan.overrides.has(item.id),
      reencodeAuthorized: item.reencodeAuthorized, sourceOutputId: marker.outputId || indexed?.outputId,
      outputId, generationDescription, operationPlan, preparedArgs, vendor });
    this.plan.ambiguities.delete(item.id);
    Object.assign(item, { status: 'ready', hardwareTier: 'untested', reason: item.reencodeAuthorized
      ? 'Explicit re-encoding authorized for this file and prepared batch only.'
      : this.plan.overrides.has(item.id) ? 'Explicitly treated as original for this plan only.' : '' });
  }

  async prepareItem(item, { input, output, settings, profile, caps, signal, owner }) {
    const progress = this.state.preparation;
    notCancelled(signal);
    progress.active++;
    Object.assign(progress, { fileId: item.id, stage: 'identity', window: null });
    const worker = { fileId: item.id, stage: 'identity', window: null };
    progress.workers.push(worker);
    this.emitState();
    const file = path.join(input.path, item.name);
    let destination = path.join(output.path, item.outputName);
    const preparedPlan = this.plan;
    if (this.plan.draft) item.operationRequest = this.plan.draft.fileRequest(item.id);
    let inspectionDiagnostic, nativePrivate = null;
    const onStage = detail => {
      if (signal.aborted || owner !== this.state.batchId || this.state.phase !== 'preparing') return;
      Object.assign(progress, { fileId: item.id, stage: detail.stage, window: detail.window || null });
      Object.assign(worker, { stage: detail.stage, window: detail.window || null });
      this.emitState();
    };
    try {
      const baseline = this.plan.baseline.get(item.name);
      if (baseline.error) throw fail('UNSAFE_SOURCE', baseline.error);
      const { identity, reusable, reason } = await this.identifyForInspection(file, signal);
      assertIdentityMatches(baseline.identity, identity, { stage: 'after-directory-snapshot', message: 'Source identity changed after the directory snapshot.' });
      notCancelled(signal);
      if (reason) progress.notice ||= preparedPlan.operation === 'native-encode' ? NATIVE_MESSAGES.NATIVE_FILE_INSPECTION_REUSE_UNAVAILABLE
        : VENDOR_PROFILES.includes(profile) ? VENDOR_MESSAGES.VENDOR_INSPECTION_REUSE_UNAVAILABLE : reason;
      let inspection = reusable ? await this.inspectionCache.lookup(identity) : null;
      let probe = inspection?.probe;
      item.inspectionMethod = inspection ? 'reused' : 'fresh';
      if (inspection) { onStage({ stage: 'reused' }); progress.reused++; }
      else if (this.inspect === inspectInput) probe = await inspectMetadata(file, { ffprobe: this.ffprobe, signal, run: this.run, onStage, remux: preparedPlan.operation === 'remux' });
      else { inspection = await this.inspect(file, { ffprobe: this.ffprobe, signal, run: this.run, onStage }); probe = inspection.probe; }
      notCancelled(signal);
      assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-metadata-inspection', message: 'Source identity changed during metadata inspection.' });
      const marker = classifyMarker(probe);
      const indexed = marker.kind !== 'suspicious' ? await this.provenanceJournal.lookupIdentity(identity) : null;
      if (marker.kind !== 'unmarked' || indexed) {
        const kind = marker.kind === 'suspicious' ? 'suspicious' : 'generated';
        const previousGeneration = marker.previousGeneration
          || (marker.kind === 'unmarked' || marker.outputId === indexed?.outputId ? indexed?.previousGeneration : null);
        item.origin = { kind, reason: indexed ? 'Recognized application output from local provenance.' : marker.reason,
          ...(previousGeneration ? { previousGeneration } : {}),
          ...(marker.descriptionNotice ? { descriptionNotice: marker.descriptionNotice } : {}) };
        const authorized = this.plan.reencodeAuthorizations.get(item.id);
        item.reencodeAuthorized = kind === 'generated' && Boolean(authorized && sameIdentity(authorized, identity));
        if (!item.reencodeAuthorized) {
          item.status = kind === 'suspicious' ? 'provenance-issue' : 'generated';
          item.reason = item.origin.reason;
          if (kind === 'generated') this.plan.generated.set(item.id, { file, fingerprint: identity, outputId: marker.outputId || indexed.outputId });
          return;
        }
      } else {
        item.origin = { kind: historicalSuffix(item.name) ? 'legacy' : 'original', reason: historicalSuffix(item.name)
          ? 'Historical filename evidence only; exact generation details are unknown.' : 'No application-generated provenance was detected.' };
        item.reencodeAuthorized = false;
      }
      if (item.origin.kind === 'legacy') {
        const override = this.plan.overrides.get(item.id);
        if (!override || !sameIdentity(override, identity)) {
          item.status = 'ambiguous';
          item.reason = 'Possible previous output. Excluded unless you explicitly treat this unchanged, unmarked file as an original.';
          this.plan.ambiguities.set(item.id, { file, fingerprint: identity });
          return;
        }
      }
      // Origin is established before checking destinations. Generated outputs
      // never become a silently skipped/ordinary source just because a name exists.
      const checkDestination = async candidate => {
        notCancelled(signal);
        if (this.plan !== preparedPlan || this.state.batchId !== owner || this.state.phase !== 'preparing') {
          throw fail('STALE_PLAN', 'The prepared batch changed before its destination was checked.');
        }
        const destinationExists = await exists(candidate);
        notCancelled(signal);
        if (this.plan !== preparedPlan || this.state.batchId !== owner || this.state.phase !== 'preparing') {
          throw fail('STALE_PLAN', 'The prepared batch changed while its destination was checked.');
        }
        if (preparedPlan.reservedPaths.has(candidate.toLowerCase())) {
          item.status = destinationExists ? 'skipped' : 'unsupported';
          item.reason = 'Destination is protected by the original directory snapshot; prepare another destination.';
          return false;
        }
        if (destinationExists) { item.status = 'skipped'; item.reason = 'Output already exists.'; return false; }
        return true;
      };
      // A real HDR-to-SDR destination depends on complete source peak evidence.
      // Do not let an ordinary preservation output suppress that distinct job.
      // The main-only resolver below checks its final name before any selection.
      const deferredSdrDestination = this.plan.operation !== 'remux' && item.operationRequest?.hdrPolicy === 'sdr'
        && classifyColor(probe).classification === 'hdr';
      if (!deferredSdrDestination && !await checkDestination(destination)) return;
      if (this.plan.operation === 'remux') {
        // Copy-only admission needs complete metadata and a qualified full
        // preservation collector, not Encode's color/encoder capability path.
        if (!inspection) progress.inspected++;
        onStage({ stage: 'stream-preservation' });
        await prepareRemuxItem.call(this, item, { file, destination, probe, identity, marker, indexed, signal });
        const prepared = this.plan.entries.get(item.id)?.operationPlan;
        if (prepared) { item.verificationMethod = prepared.verificationMethod; item.verificationClaim = prepared.verificationClaim; }
        return;
      }
      if (!inspection) {
        progress.inspected++;
        inspection = await finishInspection(file, probe, { ffprobe: this.ffprobe, signal, run: this.run, onStage });
      } else if (item.inspectionMethod === 'fresh') progress.inspected++;
      notCancelled(signal);
      assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-inspection', message: 'Source identity changed during inspection.' });
      if (reusable && item.inspectionMethod === 'fresh') {
        await this.inspectionCache.store(identity, inspection);
        if (this.inspectionCache.warning) progress.notice ||= preparedPlan.operation === 'native-encode' ? NATIVE_MESSAGES.NATIVE_FILE_INSPECTION_REUSE_UNAVAILABLE
          : VENDOR_PROFILES.includes(profile) ? VENDOR_MESSAGES.VENDOR_INSPECTION_REUSE_UNAVAILABLE : this.inspectionCache.warning;
      }
      // Inspection facts remain useful when a later operation policy refuses
      // the file. Duration in the preview is descriptive, never admission.
      item.summary = inspection.summary;
      item.rangeLimitUs = rangeLimitOf(inspection.probe);
      if (this.plan.operation === 'native-encode') { nativePrivate = prepareNativeItem.call(this, item, { file, destination, inspection, identity, caps, signal }); return; }
      if (VENDOR_PROFILES.includes(profile)) {
        this.prepareVendorItem(item, { file, destination, inspection, identity, marker, indexed, settings, profile, caps });
        return;
      }
      if (!inspection.color.supported && inspection.color.classification === 'hdr' && this.hdrOperations) {
        const resolveTransformDestination = deferredSdrDestination ? async descriptor => {
          notCancelled(signal);
          item.outputName = encodeOutputName(item.name, profile.suffix, descriptor);
          const candidate = path.join(output.path, item.outputName);
          if (path.dirname(candidate) !== path.resolve(output.path)) throw fail('INVALID_OUTPUT_NAME', 'The derived output must stay directly inside the selected output folder.');
          if (!await checkDestination(candidate)) return null;
          destination = candidate;
          return candidate;
        } : null;
        await prepareHdrItem.call(this, item, { file, destination, inspection, identity, marker, indexed, settings, caps, signal, onStage,
          resolveTransformDestination });
        return;
      }
      if (!inspection.color.supported) throw fail('UNSUPPORTED_COLOR', inspection.color.reasons.join(' '));
      if (!this.operationQualifications && item.operationRequest && (item.operationRequest.range !== null || item.operationRequest.resolution !== 'source'
          || item.operationRequest.audioPolicy !== 'copy' || item.operationRequest.target !== 'matroska'
          || !['preserve', 'sdr'].includes(item.operationRequest.hdrPolicy) || item.operationRequest.omissionRequestIds.length)) {
        throw fail('OPERATION_QUALIFICATION_REQUIRED', 'These file processing options require a qualified operation path. No encode plan was created and no options were silently ignored.');
      }
      const video = selectVideo(inspection.probe);
      const depth = /(?:10|12)/.exec(video.pix_fmt)?.[0] || '8';
      const capability = catalogCapability(caps, profile.id);
      if (!capability.supportedBitDepths.includes(Number(depth))) throw fail('UNSUPPORTED_DEPTH', profile.label + ' cannot encode this bit depth on the current device.');
      if (settings.recipeId && !caps.recipes?.find(recipe => recipe.id === settings.recipeId)?.supportedBitDepths.includes(Number(depth))) {
        throw fail('UNSUPPORTED_RECIPE_DEPTH', 'The named recipe has not passed a real encode/decode check for this input bit depth on the current device.');
      }
      const outputId = createOutputId();
      const recipe = describeCatalogRecipe(settings);
      const pixelFormat = outputPixelFormat(profile, video);
      const generationDescription = generationDescriptionOf({ version: 1, profileId: settings.profileId, codec: profile.codec,
        backend: profile.hardware, encoder: profile.encoder, preset: settings.preset, qualityMode: recipe.qualityMode, quality: settings.quality,
        bitDepth: /(?:10|12)/.test(pixelFormat) ? Number(/(?:10|12)/.exec(pixelFormat)[0]) : 8,
        encoderArgs: recipe.args, appVersion: APP_VERSION, createdAt: new Date().toISOString(),
        ...(settings.recipeId ? { recipeId: settings.recipeId } : {}),
        ...(typeof caps.versions?.ffmpeg === 'string' ? { runtimeVersion: caps.versions.ffmpeg.slice(0, 256) } : {}) });
      if (!generationDescription) throw fail('INVALID_RECIPE', 'The resolved generation description is invalid.');
      // The same immutable main-built operation owns both the prepared argv and
      // its descriptive contract. The compatibility branch delegates to the
      // accepted ordinary builder byte-for-byte; new paths still require the
      // qualification gate above, not merely a syntactically valid command.
      const encodePreservationSelection = prepareEncodePreservation.call(this, item, { probe: inspection.probe, identity, settings });
      if (encodePreservationSelection && !this.operationRuntime) throw fail('OPERATION_CONTROLS_UNAVAILABLE', 'Full preservation needs the current pinned runtime observer.');
      let operationPlan;
      try {
        operationPlan = buildEncodeOperation({ input: file, output: destination, settings, inspection,
          request: item.operationRequest, runtimeIdentity: this.runtimeIdentity, outputId, generationDescription,
          ...(encodePreservationSelection ? { preservationSelection: encodePreservationSelection } : {}),
          ...(this.operationQualifications?.orientationQualification?.({ inspection, request: item.operationRequest, runtimeIdentity: this.runtimeIdentity, settings }) || {}) });
      } catch (error) {
        // Missing orientation on a resize that no measured family admits would
        // otherwise report an orientation detail of a route that cannot run.
        // Faults in the file's own geometry evidence keep their specific code.
        let explained = null;
        if (error?.code === 'GEOMETRY_ORIENTATION_UNKNOWN' && !encodePreservationSelection
            && item.operationRequest?.resolution !== 'source' && typeof this.operationQualifications?.explainResize === 'function') {
          try { explained = this.operationQualifications.explainResize({ inspection, request: item.operationRequest, runtimeIdentity: this.runtimeIdentity, settings }); } catch { explained = null; }
        }
        if (explained?.code === 'OPERATION_RESIZE_UNQUALIFIED' && typeof explained.message === 'string') throw fail(explained.code, explained.message);
        throw error;
      }
      if (this.operationTelemetry) operationPlan = withEncodeOperationTelemetry(operationPlan);
      const operationRuntimeToken = !operationPlan.compatibilityPath && this.operationRuntime
        ? await this.operationRuntime.observe({ hardware: profile.hardware, signal }) : null;
      const runtimeObservation = operationRuntimeToken ? this.operationRuntime.snapshot(operationRuntimeToken) : null;
      if (runtimeObservation && runtimeObservation.runtimeIdentity !== this.runtimeIdentity) throw fail('OPERATION_RUNTIME_STALE', 'The current executable pair differs from the prepared runtime.');
      const qualificationBindings = operationPlan.compatibilityPath || encodePreservationSelection ? null : {
        plan: operationPlan, settings, sourceIdentity: identity,
        sourceProbeFingerprint: fingerprintEncodeSource(inspection.probe), runtimeIdentity: this.runtimeIdentity,
        environment: runtimeObservation ? runtimeObservation.environment : this.operationEnvironment ? clone(this.operationEnvironment()) : null,
        budget: this.operationEvidenceBudget, executionBudgetMs: this.operationDeadlineMs,
      };
      const qualificationSelection = qualificationBindings
        ? this.operationQualifications.select(qualificationBindings) : null;
      if (qualificationBindings && !qualificationSelection) throw fail('OPERATION_QUALIFICATION_REQUIRED', 'No exact current operation qualification is available.');
      if (qualificationSelection && this.operationQualifications.requireCurrent(qualificationSelection, qualificationBindings).controlsRequired
          && (!operationRuntimeToken || !this.operationStorage || !this.operationTelemetry)) {
        throw fail('OPERATION_CONTROLS_UNAVAILABLE', 'This route requires current tools/device observation, cumulative storage admission and encoder-input telemetry.');
      }
      // The canonical builder validates real local paths. Only the final output
      // slot is a template in the prepared presentation; main substitutes its
      // exclusively owned staging path at start, never the public destination.
      const preparedArgs = Object.freeze([...operationPlan.args.slice(0, -1), OUTPUT_PLACEHOLDER]);
      this.plan.entries.set(item.id, { file, destination, inspection, fingerprint: identity, overridden: this.plan.overrides.has(item.id),
        reencodeAuthorized: item.reencodeAuthorized, sourceOutputId: marker.outputId || indexed?.outputId,
        outputId, generationDescription, operationPlan, preparedArgs, qualificationBindings, qualificationSelection, operationRuntimeToken,
        ...(encodePreservationSelection ? { encodePreservation: true, encodePreservationSelection, encodePreservationOwner: this.plan,
          preparedPlanId: this.plan.id, encodePreservationRequest: item.operationRequest } : {}) });
      if (encodePreservationSelection) requireEncodePreservation.call(this, this.plan.entries.get(item.id));
      this.plan.ambiguities.delete(item.id);
      Object.assign(item, { status: 'ready', summary: inspection.summary, reason: item.reencodeAuthorized
        ? 'Explicit re-encoding authorized for this file and prepared batch only.'
        : this.plan.overrides.has(item.id) ? 'Explicitly treated as original for this plan only.' : '' });
    } catch (error) {
      if (error.code === 'CANCELLED' || signal.aborted || !VENDOR_PROFILES.includes(profile) && sharedFailure(error)) throw error;
      if (['INPUT_CHANGED', 'UNSAFE_SOURCE'].includes(error.code)) {
        item.reencodeAuthorized = false;
        this.plan.reencodeAuthorizations.delete(item.id);
      }
      item.status = 'unsupported'; item.reason = error.message;
      item.reasonCode = error.code || 'INSPECTION_FAILED';
      item.details = typeof error.stderr === 'string' ? error.stderr.slice(-4000) : undefined;
      inspectionDiagnostic = diagnosticStderr(error);
      if (error.sourceIdentityDiagnostic) item.sourceIdentityDiagnostic = error.sourceIdentityDiagnostic;
      // Invariant 9 (record 37): a native plan's item keeps fixed text only.
      if (preparedPlan.operation === 'native-encode') nativePrivate = nativeItemRefusal(item, error);
      if (VENDOR_PROFILES.includes(profile)) {
        const refusal = vendorRefusal(error);
        item.reason = refusal.reason; item.reasonCode = refusal.reasonCode;
        delete item.details; delete item.sourceIdentityDiagnostic;
        nativePrivate = refusal.nativePrivate;
      }
    } finally {
      progress.active--;
      progress.workers = progress.workers.filter(entry => entry.fileId !== item.id);
      if (item.status !== 'pending') progress.resolved++;
      if (preparedPlan.operation === 'native-encode') nativePrivate = { file, ...nativePrivate };
      await this.recordIncident({ stage: 'inspection', reason: 'FILE_INSPECTED', severity: item.status === 'unsupported' ? 'warning' : 'info',
        fileId: item.id, message: item.reason, ...(inspectionDiagnostic || {}),
        context: { ...(preparedPlan.operation === 'native-encode' ? {} : { file }), status: item.status, summary: item.summary, code: item.reasonCode,
          ...(item.encodePreservation ? { preservation: item.encodePreservation, warnings: item.warnings || [] } : {}), sourceIdentityDiagnostic: item.sourceIdentityDiagnostic,
          ...(nativePrivate ? { nativePrivate } : {}) } });
      if (owner === this.state.batchId) this.emitState();
    }
  }

  async prepareWithWorkers(context) {
    let cursor = 0;
    const worker = async () => {
      while (!context.signal.aborted && !this.preparationFailure) {
        const item = this.state.items[cursor++];
        if (!item) return;
        try { await this.prepareItem(item, context); }
        catch (error) {
          // Internal shared failure aborts peers, but remains a failure rather
          // than masquerading as a user cancellation. The first observed cause
          // wins. Neither path releases admission before every child closes.
          if (!context.signal.aborted && error.code !== 'CANCELLED') this.preparationFailure ||= error;
          this.controller.abort();
          return;
        }
      }
    };
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(this.inspectionWorkers, this.state.items.length) }, worker));
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    if (rejected) this.preparationFailure ||= rejected.reason;
    if (this.preparationFailure) throw this.preparationFailure;
    notCancelled(context.signal);
  }

  async prepareBatch(request) {
    objectKeys(request, ['inputFolderId', 'outputFolderId', 'settings', ...(Object.hasOwn(request || {}, 'batchOverrides') ? ['batchOverrides'] : [])]);
    return this.prepareSourceBatch(request, 'encode');
  }

  async prepareRemuxBatch(request) {
    objectKeys(request, ['inputFolderId', 'outputFolderId', 'target']);
    if (!['matroska', 'mp4', 'mov'].includes(request.target)) throw fail('INVALID_REMUX_REQUEST', 'Choose a supported container; Remux is Full-only.');
    if (!this.remuxOperations) throw fail('REMUX_CONTROLS_UNAVAILABLE', 'Remux is unavailable without its trusted route policy.');
    return this.prepareSourceBatch(request, 'remux');
  }

  // Record 37 §3.2, in order. Main-only in C3 (the channel is C5, deferred).
  // Production's empty catalog refuses at readiness, before any capability
  // check, folder read or inspection. The selection token is captured after
  // capabilities and reaches begin() with no await between them.
  async prepareNativeFileBatch(request) {
    try {
      const native = readNativeBatchRequest(request);
      if (!nativeFileControlsKind(this.nativeFiles) || !this.nativeBackends) throw fail('NATIVE_FILE_RUNTIME_UNAVAILABLE', NATIVE_MESSAGES.NATIVE_FILE_RUNTIME_UNAVAILABLE);
      this.requireIdle();
      const { input, output } = nativeBatchFolders.call(this, native);
      requireNativeReadiness.call(this);
      const caps = await this.#getCapabilities(true);
      this.requireIdle();
      const current = nativeBatchFolders.call(this, native);
      if (current.input !== input || current.output !== output) throw fail('INVALID_FOLDER', NATIVE_MESSAGES.INVALID_FOLDER);
      // The capture runs before the readiness recheck so that a capability
      // refresh which dropped the selection says so (case 30). Both are synchronous.
      const token = this.nativeBackends.captureFileSelection({ selectionId: native.selectionId, revision: native.revision });
      requireNativeReadiness.call(this);
      return await this.prepareSourceBatch(native, 'native-encode', { token, caps });
    } catch (error) { throw nativeGateRefusal(error); }
  }

  setRemuxOmissions(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'decisionIds']);
    return setRemuxOmissions.call(this, request);
  }

  setEncodePreservationDecisions(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'decisionIds']);
    return setEncodePreservationDecisions.call(this, request);
  }

  async prepareSourceBatch(request, operation, native = null) {
    const remux = operation === 'remux';
    const settings = remux || native ? null : catalogSettings(request.settings);
    const input = this.folders.get(id(request.inputFolderId));
    const output = this.folders.get(id(request.outputFolderId));
    if (input?.role !== 'input' || output?.role !== 'output') throw fail('INVALID_FOLDER', 'Select both folders again.');
    const sameFolder = input.path.toLowerCase() === output.path.toLowerCase();
    this.requireIdle();
    // A native batch has no draft and already holds its capabilities, so it
    // reaches begin() synchronously after its token capture (record 37 §3.2).
    const appDefaults = native ? null : await this.getAppSettings();
    const draft = native ? null : new OperationDraft({ operation, appDefaults: appDefaults.defaults, appDefaultsRevision: appDefaults.revision });
    if (Object.hasOwn(request, 'batchOverrides')) draft.setBatchOverrides({ draftId: draft.id, revision: 0, overrides: request.batchOverrides });
    if (remux) draft.setBatchOverrides({ draftId: draft.id, revision: 0, overrides: { remuxTarget: request.target } });
    const caps = remux ? null : native ? native.caps : await this.getCapabilities();
    this.requireIdle();
    if (this.folders.get(request.inputFolderId) !== input || this.folders.get(request.outputFolderId) !== output) {
      throw fail('INVALID_FOLDER', 'The folder selections changed. Select both folders again.');
    }
    if (!remux && !native && !catalogCapability(caps, settings.profileId)?.available) throw fail('UNAVAILABLE_PROFILE', 'The selected encoder cannot initialize on this computer.');
    if (!remux && !native && settings.recipeId && !caps.recipes?.find(recipe => recipe.id === settings.recipeId)?.available) {
      throw fail('UNAVAILABLE_RECIPE', 'The named recipe cannot initialize with its complete settings on this computer. Choose standard options explicitly to continue.');
    }
    this.state.items = [];
    this.state.settings = settings;
    this.state.operation = operation;
    if (native) this.state.native = nativeBatchState(native.token); else delete this.state.native;
    this.state.planId = null;
    this.state.operationDraft = null;
    this.state.encodingSettingsStale = false;
    const signal = this.begin('preparing');
    this.remuxOperations?.invalidate();
    this.hdrOperations?.invalidate();
    this.encodePreservationOperations?.invalidate();
    this.plan = { operation, encodePreservationGrants: new Map(), encodePreservationCandidates: new Map(), remuxGrants: new Map(), remuxCandidates: new Map(), remuxFacts: new Map(), id: randomUUID(), input: input.path, output: output.path, settings, sameFolder, draft, entries: new Map(),
      baseline: new Map(), reservedPaths: new Set(), reservedIdentities: new Set(), overrides: new Map(), ambiguities: new Map(),
      generated: new Map(), reencodeAuthorizations: new Map() };
    if (native) this.plan.nativeSelection = native.token;
    this.state.planId = this.plan.id;
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ stage: 'preparation', reason: 'PREPARATION_STARTED', context: { settings,
          ...(native ? { nativePrivate: { input: input.path, output: output.path } } : { input: input.path, output: output.path }) } });
        await this.captureFolders();
        await this.verifyFolders();
        if (native) await requireNativeOutputFolder(this.plan.output);
        await this.initializeInspectionCache(signal);
        const files = (await fs.readdir(input.path, { withFileTypes: true }))
          .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && (operation === 'remux' ? REMUX_EXTENSIONS : EXTENSIONS).has(path.extname(entry.name).toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: false }) || a.name.localeCompare(b.name));
        if (!files.length) throw fail('NO_INPUTS', 'No supported top-level video files were found.');
        await this.captureBaseline(files, signal);
        if (sameFolder) {
          const candidate = [...this.plan.baseline.values()].find(entry => entry.identity);
          const storage = candidate && await this.storageEligibility.check(candidate.identity.canonicalPath, candidate.identity, { signal });
          if (!storage?.eligible) throw fail('SAME_FOLDER_STORAGE', 'Output beside originals requires verified local fixed NTFS storage. Choose a distinct output folder for this storage.');
        }
        const profile = remux || native ? null : catalogProfile(settings.profileId);
        this.state.items = files.map(entry => ({ id: randomUUID(), name: entry.name, outputName: remux ? remuxOutputName(entry.name, request.target) : encodeOutputName(entry.name, native ? native.token.request.profileId : profile.suffix), status: 'pending', reason: '', reencodeAuthorized: false }));
        draft?.addSources(this.state.items.map(item => ({ fileId: item.id, identityRevision: 0 })));
        this.state.operationDraft = draft ? draft.snapshot() : null;
        this.state.preparation = { total: files.length, resolved: 0, reused: 0, inspected: 0, active: 0, workers: [], stage: 'identity', fileId: null,
          notice: native && this.cacheWarning ? NATIVE_MESSAGES.NATIVE_FILE_INSPECTION_REUSE_UNAVAILABLE : this.cacheWarning };
        const context = { input, output, settings, profile, caps, signal, owner: this.state.batchId };
        await this.prepareWithWorkers(context);
        this.markConflicts();
        if (native) requireNativeSelection.call(this, native.token);
        this.state.phase = 'ready';
      } catch (error) {
        this.state.phase = this.preparationFailure ? 'failed' : signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        // A native batch reports fixed text; the original stays main-only.
        const refusal = native ? nativeRefusal(error) : VENDOR_PROFILES.some(row => row.id === settings?.profileId) ? vendorRefusal(error) : null;
        this.state.error = refusal ? refusal.reason : error.message;
        await this.recordIncident({ stage: 'preparation', reason: 'PREPARATION_FAILED', severity: 'error', message: this.state.error,
          ...diagnosticStderr(error), context: { code: refusal ? refusal.reasonCode : error.code || 'PREPARATION_FAILED', ...(refusal ? { nativePrivate: refusal.nativePrivate } : {}) } });
        for (const item of this.state.items) {
          if (native && ['ready', 'conflict'].includes(item.status)) { item.status = 'unprocessed'; item.reason = refusal.reason; }
          else if (item.status === 'pending') item.status = 'unprocessed';
        }
        this.plan = null;
        this.state.planId = null;
      } finally {
        await this.recordIncident({ stage: 'preparation', reason: 'PREPARATION_FINISHED', severity: this.state.phase === 'failed' ? 'error' : 'info',
          message: this.state.error || '', context: { phase: this.state.phase, items: this.state.items.map(item => ({ id: item.id, status: item.status, reason: item.reason })) } });
        this.finishedAt = Date.now(); this.emitState();
      }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async verifyFolders() {
    try {
      if (await fs.realpath(this.plan.input) !== this.plan.input || await fs.realpath(this.plan.output) !== this.plan.output) {
        throw fail('OUTPUT_FOLDER_CHANGED', 'A selected folder changed. Select the folders again.');
      }
      for (const role of ['input', 'output']) {
        const current = await fs.lstat(this.plan[role], { bigint: true });
        const original = this.plan.folderIdentities[role];
        if (!current.isDirectory() || current.isSymbolicLink() || String(current.dev) !== original.dev
            || String(current.ino) !== original.ino || String(current.birthtimeNs) !== original.birthtimeNs) {
          throw fail('OUTPUT_FOLDER_CHANGED', 'A selected directory was replaced. Select the folders again.');
        }
      }
      await fs.access(this.plan.output, require('node:fs').constants.W_OK);
    } catch (error) {
      throw fail('OUTPUT_FOLDER_CHANGED', `A selected folder is unavailable or changed: ${error.message}`);
    }
  }

  requireEditableDraft(planId, { allowStaleEncoding = false } = {}) {
    this.requireIdle();
    this.requireNoNativePlan('NATIVE_FILE_OPTIONS_FIXED');
    if (!this.plan?.draft || this.state.phase !== 'ready' || id(planId) !== this.plan.id) {
      throw fail('STALE_PLAN', 'Review a current batch before changing its file options.');
    }
    if (this.plan.encodingSettingsStale && !allowStaleEncoding) {
      throw fail('ENCODING_SETTINGS_CHANGED', 'Prepare the current encoder settings before applying file or batch processing changes.');
    }
    return this.plan;
  }
  updateFileOperations(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'fileIds', 'overrides']);
    const plan = this.requireEditableDraft(request.planId);
    plan.draft.patchFiles({ draftId: request.draftId, revision: request.revision, fileIds: request.fileIds, overrides: request.overrides });
    return this.reprepareDraft();
  }
  updateBatchOperationDefaults(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'overrides']);
    const plan = this.requireEditableDraft(request.planId);
    plan.draft.setBatchOverrides({ draftId: request.draftId, revision: request.revision, overrides: request.overrides });
    return this.reprepareDraft();
  }
  async applyAppDefaultsToBatch(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'resetFileOverrides']);
    const plan = this.requireEditableDraft(request.planId);
    const app = await this.getAppSettings();
    if (this.requireEditableDraft(request.planId) !== plan) throw fail('STALE_PLAN', 'The batch changed while reading app defaults.');
    plan.draft.applyAppDefaults({ draftId: request.draftId, revision: request.revision, resetFileOverrides: request.resetFileOverrides },
      { defaults: app.defaults, revision: app.revision });
    return this.reprepareDraft();
  }
  async reprepareEncodingSettings(request) {
    objectKeys(request, ['planId', 'draftId', 'revision', 'settings']);
    const plan = this.requireEditableDraft(request.planId, { allowStaleEncoding: true });
    const settings = catalogSettings(request.settings);
    const caps = await this.getCapabilities();
    if (this.requireEditableDraft(request.planId, { allowStaleEncoding: true }) !== plan) throw fail('STALE_PLAN', 'The batch changed while checking encoder settings.');
    if (!catalogCapability(caps, settings.profileId)?.available) throw fail('UNAVAILABLE_PROFILE', 'The selected encoder cannot initialize on this computer.');
    if (settings.recipeId && !caps.recipes?.find(recipe => recipe.id === settings.recipeId)?.available) {
      throw fail('UNAVAILABLE_RECIPE', 'The complete named recipe is unavailable; choose ordinary settings explicitly.');
    }
    plan.draft.invalidateEncodingSettings({ draftId: request.draftId, revision: request.revision });
    plan.settings = settings; this.state.settings = settings;
    plan.encodingSettingsStale = false; this.state.encodingSettingsStale = false;
    const profile = catalogProfile(settings.profileId);
    for (const item of this.state.items) item.outputName = encodeOutputName(item.name, profile.suffix);
    return this.reprepareDraft();
  }
  async reprepareDraft({ remuxDecisions = null, encodePreservationDecisions = null } = {}) {
    // Meaningful edits start a new prepared authority. Reuse evidence through
    // the ordinary cache, but never reuse a generated-source/omission grant.
    // The original source reservation remains protected throughout this draft.
    const remux = this.plan.operation === 'remux';
    // An explicit exact-set omission edit is related to this same prepared
    // source subset. Revalidate its existing generated-source grants; ordinary
    // reprepare/target changes still discard them without renewal.
    const relatedSources = remux && remuxDecisions !== null || !remux && encodePreservationDecisions !== null
      ? new Map(this.plan.reencodeAuthorizations) : null;
    const relatedOriginals = !remux && encodePreservationDecisions !== null ? new Map(this.plan.overrides) : null;
    this.hdrOperations?.invalidate();
    this.encodePreservationOperations?.invalidate();
    this.plan.encodePreservationGrants.clear(); this.plan.encodePreservationCandidates.clear();
    this.plan.id = randomUUID(); this.state.planId = this.plan.id;
    this.plan.entries.clear(); this.plan.overrides.clear(); this.plan.ambiguities.clear();
    this.plan.generated.clear(); this.plan.reencodeAuthorizations.clear();
    if (remux) {
      this.remuxOperations.invalidate(); this.plan.remuxGrants.clear(); this.plan.remuxCandidates.clear(); this.plan.remuxFacts.clear();
      for (const item of this.state.items) item.outputName = remuxOutputName(item.name, this.plan.draft.fileRequest(item.id).target);
    } else {
      const profile = catalogProfile(this.plan.settings.profileId);
      for (const item of this.state.items) item.outputName = encodeOutputName(item.name, profile.suffix);
    }
    this.state.operationDraft = this.plan.draft.snapshot();
    for (const item of this.state.items) {
      Object.assign(item, { status: 'pending', reason: '', reencodeAuthorized: false });
      for (const field of ['reasonCode', 'details', 'sourceIdentityDiagnostic', 'summary', 'rangeLimitUs', 'timing', 'hdr', 'encodePreservation', 'warnings', 'hardwareTier']) delete item[field];
    }
    const signal = this.begin('preparing');
    this.state.preparation = { total: this.state.items.length, resolved: 0, reused: 0, inspected: 0,
      active: 0, workers: [], stage: 'identity', fileId: null, notice: this.cacheWarning };
    const receiptIds = { batchId: this.state.batchId, planId: this.plan.id };
    const context = { input: { path: this.plan.input }, output: { path: this.plan.output }, settings: this.plan.settings,
      profile: this.plan.operation === 'remux' ? null : catalogProfile(this.plan.settings.profileId), caps: this.capabilityResult,
      signal, owner: this.state.batchId };
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ ...receiptIds, stage: 'preparation', reason: 'DRAFT_REPREPARATION_STARTED', context: { draftRevision: this.state.operationDraft.revision } });
        if (relatedSources) for (const [fileId, identity] of relatedSources) {
            const current = await readSourceIdentity(identity.canonicalPath, { signal });
            if (!sameIdentity(current, identity)) throw fail('INPUT_CHANGED', 'An explicitly admitted source changed during the preservation decision edit.');
            this.plan.reencodeAuthorizations.set(fileId, current);
        }
        if (relatedOriginals) for (const [fileId, identity] of relatedOriginals) {
          const current = await readSourceIdentity(identity.canonicalPath, { signal });
          if (!sameIdentity(current, identity)) throw fail('INPUT_CHANGED', 'An explicitly treated original changed during the preservation decision edit.');
          this.plan.overrides.set(fileId, current);
        }
        if (remux) {
          await installRemuxDecisions.call(this, remuxDecisions || [], signal);
        } else await installEncodePreservationDecisions.call(this, encodePreservationDecisions || [], signal);
        await this.verifyFolders(); await this.prepareWithWorkers(context);
        notCancelled(signal);
        this.markConflicts(); this.state.phase = 'ready';
      } catch (error) {
        this.state.phase = this.preparationFailure ? 'failed' : signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        this.state.error = VENDOR_PROFILES.some(row => row.id === this.state.settings?.profileId) ? vendorRefusal(error).reason : error.message;
        for (const item of this.state.items) { item.reencodeAuthorized = false; if (item.status === 'pending') item.status = 'unprocessed'; }
        this.plan = null; this.state.planId = null;
        await this.recordIncident({ ...receiptIds, stage: 'preparation', reason: 'DRAFT_REPREPARATION_FAILED', severity: 'error', message: error.message,
          ...diagnosticStderr(error), context: { code: error.code || 'PREPARATION_FAILED' } });
      } finally {
        await this.finishPreparationReceipt({ receiptIds, signal, stage: 'preparation', reason: 'DRAFT_REPREPARATION_FINISHED' });
      }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async finishPreparationReceipt({ receiptIds, signal, stage, reason, context = {} }) {
    const phase = this.state.phase;
    // Keep admission closed through the receipt and any late cancellation.
    // Never let a slow journal replace this operation's state/correlation.
    this.state.phase = 'preparing';
    try {
      await this.recordIncident({ ...receiptIds, stage, reason, severity: phase === 'failed' ? 'error' : 'info',
        context: { ...context, phase, counts: this.snapshot().counts } });
      if (signal.aborted) {
        this.hdrOperations?.invalidate();
        this.encodePreservationOperations?.invalidate();
        if (this.plan?.operation === 'remux') this.remuxOperations?.invalidate();
        this.plan = null; this.state.planId = null; this.state.operationDraft = null;
        for (const item of this.state.items) {
          item.reencodeAuthorized = false;
          if (['ready', 'conflict', 'pending'].includes(item.status)) { item.status = 'cancelled'; item.reason = 'Preparation cancelled. Prepare again.'; }
        }
        // The first receipt may already say Ready when abort arrives during its
        // disk write. Record revocation afterwards rather than rewriting history.
        if (phase !== 'cancelled') await this.recordIncident({ ...receiptIds, stage: phase === 'failed' || this.preparationFailure ? stage : 'cancellation', reason: 'PREPARED_AUTHORITY_REVOKED',
          context: { phase: phase === 'failed' || this.preparationFailure ? 'failed' : 'cancelled', counts: this.snapshot().counts } });
      }
    } finally {
      this.state.phase = phase === 'failed' || this.preparationFailure ? 'failed' : signal.aborted ? 'cancelled' : phase;
      this.finishedAt = Date.now(); this.emitState();
    }
  }

  async captureFolders() {
    this.plan.folderIdentities = {};
    for (const role of ['input', 'output']) {
      const stat = await fs.lstat(this.plan[role], { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('OUTPUT_FOLDER_CHANGED', 'Selected folders must be ordinary directories.');
      this.plan.folderIdentities[role] = { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
    }
  }

  async captureBaseline(files, signal) {
    const aliases = new Map();
    // Reserve the complete discovery snapshot before workers can inspect or
    // skip anything. A disappeared original's name must never become writable.
    for (const file of files) {
      notCancelled(signal);
      const pathname = path.join(this.plan.input, file.name);
      this.plan.reservedPaths.add(pathname.toLowerCase());
      let entry;
      try {
        const identity = await readFileStamp(pathname);
        entry = { identity };
        const key = `${identity.dev}:${identity.ino}`;
        if (identity.ino !== '0' && identity.dev !== '0') {
          this.plan.reservedIdentities.add(key);
          const group = aliases.get(key) || [];
          group.push(entry); aliases.set(key, group);
        }
      } catch (error) { entry = { error: error.message }; }
      this.plan.baseline.set(file.name, entry);
    }
    for (const group of aliases.values()) if (group.length > 1) {
      for (const entry of group) entry.error = 'Multiple discovered names refer to the same file. Hard-linked source aliases are excluded.';
    }
  }

  markConflicts() {
    const groups = new Map();
    for (const item of this.state.items.filter(entry => ['ready', 'conflict'].includes(entry.status))) {
      item.status = 'ready';
      const key = item.outputName.toLowerCase();
      const group = groups.get(key) || [];
      group.push(item); groups.set(key, group);
    }
    for (const group of groups.values()) if (group.length > 1) for (const item of group) {
      item.status = 'conflict'; item.reason = 'Another input has the same output name. Select only one.';
    }
  }

  async treatAsOriginal(request) {
    objectKeys(request, ['planId', 'fileId']);
    this.requireIdle();
    this.requireNoNativePlan('NATIVE_FILE_SOURCE_PERMISSION_REQUIRED');
    if (!this.plan || this.state.phase !== 'ready' || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare the current batch again.');
    const item = this.state.items.find(entry => entry.id === id(request.fileId));
    const ambiguous = this.plan.ambiguities.get(request.fileId);
    if (!item || item.status !== 'ambiguous' || !ambiguous) throw fail('INVALID_OVERRIDE', 'Only an ambiguous unmarked file can be treated as original.');
    const signal = this.begin('preparing');
    const priorResolved = this.state.items.filter(entry => entry.status !== 'pending').length;
    item.status = 'pending';
    this.state.preparation = { total: this.state.items.length, resolved: priorResolved - 1, reused: 0, inspected: 0, active: 0, workers: [], stage: 'identity', notice: null };
    const receiptIds = { batchId: this.state.batchId, planId: this.plan.id, fileId: item.id };
    let permissionCode = null;
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ ...receiptIds, stage: 'admission', reason: 'SOURCE_PERMISSION_STARTED', context: { mode: 'treat-as-original' } });
        const current = await readSourceIdentity(ambiguous.file, { signal });
        if (!sameIdentity(current, ambiguous.fingerprint)) throw fail('INPUT_CHANGED', 'The possible previous output changed. Prepare the batch again.');
        this.plan.overrides.set(item.id, current);
        await this.prepareItem(item, { input: { path: this.plan.input }, output: { path: this.plan.output }, settings: this.plan.settings,
          profile: this.plan.operation === 'remux' ? null : catalogProfile(this.plan.settings.profileId), caps: this.capabilityResult, signal, owner: this.state.batchId });
        notCancelled(signal);
        this.markConflicts(); this.state.phase = 'ready';
      } catch (error) {
        permissionCode = error.code || 'SOURCE_PERMISSION_FAILED';
        item.status = signal.aborted ? 'unprocessed' : 'unsupported'; item.reason = error.message;
        this.state.phase = signal.aborted ? 'cancelled' : 'failed'; this.state.error = VENDOR_PROFILES.some(row => row.id === this.state.settings?.profileId) ? vendorRefusal(error).reason : error.message;
        for (const entry of this.state.items) entry.reencodeAuthorized = false;
        this.plan = null; this.state.planId = null;
      } finally {
        await this.finishPreparationReceipt({ receiptIds, signal, stage: 'admission', reason: 'SOURCE_PERMISSION_FINISHED',
          context: { mode: 'treat-as-original', code: permissionCode } });
      }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async reencodeOutputs(request) {
    objectKeys(request, ['planId', 'fileIds']);
    this.requireIdle();
    this.requireNoNativePlan('NATIVE_FILE_SOURCE_PERMISSION_REQUIRED');
    if (!this.plan || this.state.phase !== 'ready' || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare the current batch again.');
    if (!Array.isArray(request.fileIds) || !request.fileIds.length || request.fileIds.length > this.state.items.length) throw fail('INVALID_SELECTION', 'Choose the generated outputs to re-encode.');
    const selected = new Set(request.fileIds.map(id));
    if (selected.size !== request.fileIds.length) throw fail('INVALID_SELECTION', 'Duplicate generated-output identifiers are not allowed.');
    const items = [...selected].map(fileId => this.state.items.find(item => item.id === fileId));
    if (items.some(item => !item || item.status !== 'generated' || item.origin?.kind !== 'generated' || !this.plan.generated.has(item.id))) {
      throw fail('INVALID_OVERRIDE', 'Only explicitly selected, recognized generated outputs can be authorized for re-encoding.');
    }
    const signal = this.begin('preparing');
    this.state.preparation = { total: this.state.items.length, resolved: this.state.items.length - items.length,
      reused: 0, inspected: 0, active: 0, workers: [], stage: 'identity', notice: null };
    const receiptIds = { batchId: this.state.batchId, planId: this.plan.id };
    let permissionCode = null;
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ ...receiptIds, stage: 'admission', reason: 'SOURCE_PERMISSION_STARTED', context: { mode: 'reencode-outputs', count: items.length } });
        // Validate the whole requested subset before granting any authority.
        // Filtering/queue selection never enters this map. It exists only in
        // this prepared plan and is discarded on every new preparation/restart.
        const verified = [];
        for (const item of items) {
          const candidate = this.plan.generated.get(item.id);
          const current = await readSourceIdentity(candidate.file, { signal });
          if (!sameIdentity(current, candidate.fingerprint)) throw fail('INPUT_CHANGED', 'A selected generated output changed. Prepare the batch again.');
          verified.push([item.id, current]);
        }
        notCancelled(signal);
        for (const [fileId, identity] of verified) this.plan.reencodeAuthorizations.set(fileId, identity);
        for (const item of items) {
          item.status = 'pending';
          await this.prepareItem(item, { input: { path: this.plan.input }, output: { path: this.plan.output }, settings: this.plan.settings,
            profile: this.plan.operation === 'remux' ? null : catalogProfile(this.plan.settings.profileId), caps: this.capabilityResult, signal, owner: this.state.batchId });
        }
        notCancelled(signal);
        this.markConflicts(); this.state.phase = 'ready';
      } catch (error) {
        permissionCode = error.code || 'SOURCE_PERMISSION_FAILED';
        for (const item of items) {
          item.reencodeAuthorized = false;
          item.status = signal.aborted ? 'unprocessed' : 'unsupported'; item.reason = error.message;
        }
        this.state.phase = signal.aborted ? 'cancelled' : 'failed'; this.state.error = VENDOR_PROFILES.some(row => row.id === this.state.settings?.profileId) ? vendorRefusal(error).reason : error.message;
        for (const entry of this.state.items) entry.reencodeAuthorized = false;
        this.plan = null; this.state.planId = null;
      } finally {
        await this.finishPreparationReceipt({ receiptIds, signal, stage: 'admission', reason: 'SOURCE_PERMISSION_FINISHED',
          context: { mode: 'reencode-outputs', code: permissionCode, count: items.length } });
      }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async recoverProvenance(signal) {
    if (this.recoveredProvenance) return;
    try {
      const result = await this.provenanceJournal.recover({ maxPending: 128, inspectDestination: async destination => {
        notCancelled(signal);
        if (!await exists(destination)) return null;
        const identity = await readSourceIdentity(destination, { signal });
        const probe = await inspectMetadata(destination, { ffprobe: this.ffprobe, signal, run: this.run });
        if (!sameStamp(identity, await readFileStamp(destination))) throw fail('INPUT_CHANGED', 'Output changed during provenance recovery.');
        return { identity, marker: classifyMarker(probe) };
      } });
      notCancelled(signal);
      this.state.provenanceRecovery = { ...Object.fromEntries(['matching', 'absent', 'unrelated', 'uncertain'].map(key => [key, result[key].length])),
        pendingRemaining: result.pendingRemaining || 0, warnings: result.warnings || [] };
      this.recoveredProvenance = true;
      await this.recordIncident({ stage: 'recovery', reason: 'PROVENANCE_RECOVERY_FINISHED', context: { recovery: this.state.provenanceRecovery } });
    } catch (error) {
      await this.recordIncident({ stage: 'recovery', reason: signal?.aborted || error.code === 'CANCELLED' ? 'PROVENANCE_RECOVERY_CANCELLED' : 'PROVENANCE_RECOVERY_FAILED',
        severity: signal?.aborted || error.code === 'CANCELLED' ? 'info' : 'warning', message: error.message, context: { code: error.code || 'PROVENANCE_UNAVAILABLE' } });
      notCancelled(signal);
      this.state.provenanceRecovery = { matching: 0, absent: 0, unrelated: 0, uncertain: 0, warnings: ['Provenance recovery unavailable: ' + error.message] };
    }
  }

  // Synchronous and before any queue/status mutation (record 37 §3.4).
  // A refused Start keeps the prepared plan available for a valid retry.
  requireNativeStart(selected) {
    if (this.plan.operation !== 'native-encode') return;
    try {
      if (nativeFileControlsKind(this.nativeFiles) === null || !this.nativeBackends) throw fail('NATIVE_FILE_RUNTIME_UNAVAILABLE', NATIVE_MESSAGES.NATIVE_FILE_RUNTIME_UNAVAILABLE);
      requireNativeReadiness.call(this);
      for (const fileId of selected) {
        const entry = this.plan.entries.get(fileId);
        if (!entry?.native) throw fail('NATIVE_FILE_CONTRACT_UNOWNED', NATIVE_MESSAGES.NATIVE_FILE_CONTRACT_UNOWNED);
        this.nativeBackends.requireFileSelection(entry.selection);
        const assessed = this.nativeFiles.assess({ contract: entry.contract, selection: entry.selection });
        if (!assessed.admissible) throw fail(assessed.reasonCodes[0], NATIVE_MESSAGES[assessed.reasonCodes[0]]);
      }
    } catch (error) {
      const refusal = nativeGateRefusal(error); throw refusal;
    }
  }

  startBatch(request) {
    objectKeys(request, ['planId', 'fileIds']);
    this.requireIdle();
    if (!this.plan || this.state.phase !== 'ready' || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare a new batch before starting.');
    if (!Array.isArray(request.fileIds) || !request.fileIds.length || request.fileIds.length > this.state.items.length) throw fail('INVALID_SELECTION', 'Select at least one ready input.');
    const selected = new Set(request.fileIds.map(id));
    if (selected.size !== request.fileIds.length) throw fail('INVALID_SELECTION', 'Duplicate file identifiers are not allowed.');
    const names = new Set();
    for (const fileId of selected) {
      const item = this.state.items.find(entry => entry.id === fileId);
      if (!item || !['ready', 'conflict'].includes(item.status)) throw fail('INVALID_SELECTION', 'A selected input is not ready.');
      const entry = this.plan.entries.get(fileId);
      if (VENDOR_PROFILES.some(profile => profile.id === this.plan.settings?.profileId)) {
        vendorGuard('start-entry', Boolean(entry?.vendor), 'INVALID_PLAN');
      }
      if (entry?.vendor) requireVendorArgs(entry);
      requireEncodePreservation.call(this, this.plan.entries.get(fileId));
      const key = item.outputName.toLowerCase();
      if (names.has(key)) throw fail('OUTPUT_CONFLICT', 'Select only one input for each output name.');
      names.add(key);
    }
    this.requireNativeStart(selected);
    for (const item of this.state.items) if (['ready', 'conflict'].includes(item.status)) item.status = selected.has(item.id) ? 'pending' : 'unprocessed';
    if (this.plan.draft) {
      const draft = this.plan.draft.snapshot();
      this.plan.queueOperationSnapshot = this.plan.draft.freezeForQueue({ draftId: draft.id, revision: draft.revision, fileIds: [...selected] });
      this.state.operationDraft = this.plan.draft.snapshot();
    }
    const signal = this.begin('running');
    this.taskPromise = this.execute(selected, signal);
    return this.snapshot();
  }

  async execute(selected, signal) {
    let stoppedByFailure = false;
    try {
      for (const item of this.state.items.filter(entry => selected.has(entry.id))) {
        if (signal.aborted) break;
        const entry = this.plan.entries.get(item.id);
        if (entry.native) {
          const outcome = await executeNativeJob.call(this, item, entry, signal);
          if (outcome === 'stop') { stoppedByFailure = true; break; }
          if (outcome === 'cancelled') break;
          continue;
        }
        let stage;
        let invocationId;
        let publishedIdentity;
        let encoderProgress;
        let validatingSource = false;
        let operationTimer;
        let operationController;
        let operationExpired = false, remuxFailure = null, remuxGroup = null;
        let advanceRemux = () => {};
        let storage, storageReservation, storageMonitor, storageFailure, telemetry;
        let storageWatch = Promise.resolve();
        try {
          const qualificationOwner = entry.remux ? this.remuxOperations : entry.hdr ? this.hdrOperations : this.operationQualifications;
          const sourceFingerprint = entry.remux ? remuxProbeFingerprint : entry.hdr ? fingerprintHdrProbe : fingerprintEncodeSource;
          const qualificationBindings = () => ({ ...entry.qualificationBindings, settings: this.plan.settings,
            sourceIdentity: entry.fingerprint, sourceProbeFingerprint: sourceFingerprint(entry.inspection.probe),
            runtimeIdentity: this.runtimeIdentity, budget: this.operationEvidenceBudget, executionBudgetMs: this.operationDeadlineMs,
            environment: entry.operationRuntimeToken ? this.operationRuntime.snapshot(entry.operationRuntimeToken).environment
              : this.operationEnvironment ? clone(this.operationEnvironment()) : null });
          const requireQualification = () => {
            if (entry.remux) requireRemuxGrants.call(this, entry);
            requireEncodePreservation.call(this, entry);
            return entry.qualificationSelection ? qualificationOwner.requireCurrent(entry.qualificationSelection, qualificationBindings()) : null;
          };
          const qualified = requireQualification();
          const costLimits = operationCostLimits(entry, qualified);
          let evidenceRemainingBytes = costLimits.evidenceReserveBytes;
          const observeEvidenceGrowth = async () => {
            const current = await storage.observeGrowth(storageReservation);
            if (entry.remux && Array.isArray(current.jobs)) {
              const job = current.jobs.find(value => value.id === storageReservation.id);
              if (!job || !Number.isSafeInteger(job.remainingBytes) || job.remainingBytes < 0 || job.remainingBytes > costLimits.evidenceReserveBytes)
                throw fail('REMUX_STORAGE', 'Remux evidence reservation accounting is incomplete.');
              evidenceRemainingBytes = job.remainingBytes;
            }
            return current;
          };
          const protectedReceipt = qualified || requireEncodePreservation.call(this, entry);
          operationController = qualified ? new AbortController() : null;
          const jobSignal = operationController ? AbortSignal.any([signal, operationController.signal]) : signal;
          // Review/queued time does not consume an active job's cost envelope.
          // Policy/source/runtime freshness is checked independently above.
          const activeDeadline = qualified ? Date.now() + costLimits.executionBudgetMs : null;
          if (entry.remux) {
            const clock = createRemuxProgressClock(costLimits.stallMs, activeDeadline);
            advanceRemux = clock.advance;
            // Periodic checking avoids signed-32-bit timer overflow. Only actual
            // copy/verification advancement renews the idle clock, never logs.
            operationTimer = setInterval(() => {
              remuxFailure ||= clock.check();
              if (remuxFailure) operationController.abort();
            }, 1000);
            operationTimer.unref();
          } else if (qualified) operationTimer = setTimeout(() => { operationExpired = true; operationController.abort(); }, costLimits.executionBudgetMs);
          const observeRemuxOutput = async () => {
            if (!entry.remux) return;
            try {
              const free = await fs.statfs(this.plan.output, { bigint: true });
              if (typeof free.bavail !== 'bigint' || typeof free.bsize !== 'bigint' || free.bavail < 0n || free.bsize <= 0n)
                throw fail('REMUX_STORAGE', 'Remux output free space is unknown.');
              let actualBytes = 0n;
              if (stage) {
                try { const current = await fs.lstat(stage.file, { bigint: true });
                  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || current.size > BigInt(qualified.budget.maxOutputBytes))
                    throw fail('REMUX_STORAGE', 'Remux stage exceeded its source-derived output budget or changed kind.');
                  actualBytes = current.size;
                } catch (error) { if (error.code !== 'ENOENT') throw error; }
              }
              const outputStat = await fs.stat(this.plan.output, { bigint: true });
              const evidenceStat = storageReservation ? await fs.stat(storageReservation.directory, { bigint: true }) : null;
              // Same-volume admission must cover both reservations. The retained
              // evidence store independently monitors actual spool growth.
              const evidenceReserve = evidenceStat?.dev === outputStat.dev ? BigInt(evidenceRemainingBytes) : 0n;
              requireRemuxOutputSpace({ freeBytes: free.bavail * free.bsize, actualBytes, maxOutputBytes: qualified.budget.maxOutputBytes,
                outputReserveBytes: costLimits.outputReserveBytes, evidenceReserveBytes: Number(evidenceReserve) });
            } catch (error) {
              if (error.code === 'REMUX_STORAGE') throw error;
              throw Object.assign(fail('REMUX_STORAGE', 'Remux output storage could not be observed.'), { cause: error });
            }
          };
          let operationChildren = 0, evidenceBytes = 0;
          const pipeBytes = { stdout: 0, stderr: 0 };
          if (qualified && this.operationStorage) {
            storage = await this.operationStore();
            try { storageReservation = await storage.admit({ forecastBytes: costLimits.evidenceReserveBytes,
              ...(entry.remux ? { remuxAllowance: createRemuxStorageAllowance(entry.remuxAssessment, entry.fingerprint.size, qualified.verificationMethod) } : {}) }); }
            catch (error) { storageReservation = error.storageReservation; throw error; }
            const observe = async () => { await storage.assertReservation(storageReservation); const current = await observeEvidenceGrowth(); if (entry.remux) await observeRemuxOutput(); return current; };
            let watching = false;
            storageMonitor = setInterval(() => {
              if (watching || storageFailure) return;
              watching = true;
              storageWatch = observe().catch(error => { storageFailure = error; operationController.abort(); }).finally(() => { watching = false; });
            }, 200);
          }
          // The runner does not release ownership until child close and stdout
          // sink drainage. The aggregate deadline is independent of per-child
          // collector limits; an exhausted job never falls back to legacy proof.
          const run = qualified ? async (executable, args, options = {}) => {
            requireQualification();
            if (++operationChildren > costLimits.maxChildren) throw fail('OPERATION_CHILD_LIMIT', 'The changed operation exceeded its child-process budget.');
            const remaining = activeDeadline - Date.now();
            if (remaining <= 0 || operationController.signal.aborted) throw fail('OPERATION_DEADLINE', 'The changed operation exceeded its total deadline.');
            advanceRemux('child-' + operationChildren, 0);
            const chunk = options.onStdoutChunk;
            try {
              if (storage) await observeEvidenceGrowth();
              if (entry.remux) await observeRemuxOutput();
              const runner = entry.operationRuntimeToken
                ? (executable, argv, options) => {
                  const tool = executable === this.ffmpeg ? 'ffmpeg' : executable === this.ffprobe ? 'ffprobe' : null;
                  if (!tool) throw fail('OPERATION_RUNTIME_UNBOUND', 'The invocation does not use an observed fixed tool.');
                  return remuxGroup ? this.operationRuntime.invokeRemux(remuxGroup, tool, argv, options)
                    : this.operationRuntime.invoke(entry.operationRuntimeToken, tool, argv, options);
                } : (executable, argv, options) => this.run(executable, argv, options);
              const result = await runner(executable, args, { ...options, signal: jobSignal,
                timeoutMs: Math.min(options.timeoutMs || remaining, remaining),
                stdoutLimit: options.stdoutLimit || 16 * 1024 * 1024,
                onOutputBytes: ({ stream, bytes }) => {
                  pipeBytes[stream] += bytes;
                  if (pipeBytes.stdout + pipeBytes.stderr > costLimits.pipeBytes) throw fail(entry.remux ? 'REMUX_PROPORTIONAL_BUDGET' : 'OPERATION_PIPE_LIMIT', 'The aggregate stdout/stderr pipe-byte allowance was exhausted.');
                  options.onOutputBytes?.({ stream, bytes });
                },
                ...(chunk ? { onStdoutChunk: async (bytes, pipe) => {
                  evidenceBytes += bytes.length;
                  if (evidenceBytes > costLimits.evidenceBytes) throw fail(entry.remux ? 'REMUX_PROPORTIONAL_BUDGET' : 'OPERATION_EVIDENCE_LIMIT', 'The total evidence stdout budget was exceeded.');
                  advanceRemux('evidence-child-' + operationChildren, evidenceBytes);
                  return chunk(bytes, pipe);
                } } : {}) });
              if (storage) {
                // A successful child can still be followed by a failed disk
                // observation. Retain its close diagnostics without retaining
                // an entire metadata/stdout payload as an error cause.
                const closed = Object.assign(new Error('The owned tool closed before the retained-storage observation failed.'),
                  { code: 'OWNED_CHILD_COMPLETED', ...boundedToolStderr(result), exitCode: result.exitCode,
                    ...(result.stdoutCapture ? { stdoutCapture: result.stdoutCapture } : {}) });
                if (storageFailure) throw operationFailure(storageFailure, closed);
                try { await observeEvidenceGrowth(); }
                catch (error) { throw operationFailure(error, closed); }
              }
              advanceRemux('child-' + operationChildren + '-closed', 1);
              if (entry.remux) await observeRemuxOutput();
              return result;
            } catch (error) {
              if (remuxFailure && !signal.aborted) throw operationFailure(remuxFailure, error);
              if (storageFailure && !signal.aborted) throw operationFailure(storageFailure, error);
              if (!signal.aborted && (operationExpired || Date.now() >= activeDeadline)) {
                throw operationFailure(fail('OPERATION_DEADLINE', 'The changed operation exceeded its total deadline; its child and sinks have settled.'), error);
              }
              throw error;
            }
          } : entry.encodePreservation ? async (executable, args, options = {}) => {
            // This Full route changes only an acknowledged mapping. Its runtime
            // and decisions stay current without borrowing range deadlines or
            // a complete per-input decode/read budget from another policy.
            requireEncodePreservation.call(this, entry);
            const tool = executable === this.ffmpeg ? 'ffmpeg' : executable === this.ffprobe ? 'ffprobe' : null;
            if (!tool || !entry.operationRuntimeToken) throw fail('OPERATION_RUNTIME_UNBOUND', 'Full preservation requires the observed fixed tool pair.');
            if (++operationChildren > 8) throw fail('OPERATION_CHILD_LIMIT', 'The Full preservation workflow exceeded its bounded helper count.');
            return this.operationRuntime.invoke(entry.operationRuntimeToken, tool, args, { ...options, signal: jobSignal });
          } : (executable, args, options) => this.run(executable, args, options);
          await this.verifyFolders();
          if (await exists(entry.destination)) { item.status = 'skipped'; item.reason = 'Output appeared since preview.'; continue; }
          if (this.plan.reservedPaths.has(entry.destination.toLowerCase())) throw fail('PROTECTED_SOURCE', 'The destination belonged to the baseline input snapshot. It remains protected after disappearance.');
          validatingSource = true;
          await this.assertSourceMatches(entry, jobSignal, 'before-encode', 'Source identity changed since preview.');
          const currentProbe = this.inspect === inspectInput
            ? await inspectMetadata(entry.file, { ffprobe: this.ffprobe, signal: jobSignal, run })
            : (await this.inspect(entry.file, { ffprobe: this.ffprobe, signal: jobSignal, run })).probe;
          if (qualified && sourceFingerprint(currentProbe) !== entry.qualificationBindings.sourceProbeFingerprint) {
            throw fail('OPERATION_QUALIFICATION_STALE', 'The current media evidence no longer matches the prepared qualification.');
          }
          requireEncodePreservation.call(this, entry, currentProbe);
          const currentMarker = classifyMarker(currentProbe);
          const currentIndexed = await this.provenanceJournal.lookupIdentity(entry.fingerprint);
          const generated = currentMarker.kind === 'generated' || Boolean(currentIndexed);
          if (entry.reencodeAuthorized) {
            if (currentMarker.kind === 'suspicious' || !generated || (currentMarker.outputId || currentIndexed?.outputId) !== entry.sourceOutputId
                || !sameIdentity(this.plan.reencodeAuthorizations.get(item.id), entry.fingerprint)) {
              throw fail('GENERATED_SOURCE', 'The explicit re-encode authorization no longer matches this generated output. Prepare again.');
            }
          } else if (currentMarker.kind !== 'unmarked' || currentIndexed) {
            throw fail('GENERATED_SOURCE', 'This source is now recognized as a generated output; prepare again.');
          }
          if (entry.overridden && !sameIdentity(this.plan.overrides.get(item.id), await readSourceIdentity(entry.file, { signal: jobSignal }))) {
            throw fail('INPUT_CHANGED', 'The explicit original override no longer matches this file.');
          }
          await this.assertSourceMatches(entry, jobSignal, 'after-provenance-check', 'Source identity changed during the final provenance check.');
          if (isProportionalFamilySelection(qualified, entry.operationPlan)) {
            requireQualification();
            assertProportionalCollectionSelection(qualified, { plan: entry.operationPlan, sourcePath: entry.file,
              sourceProbe: currentProbe, budget: qualified.budget, timingQualification: qualified.timingQualification, sourcePolicy: qualified.sourcePolicy });
          }
          validatingSource = false;
          await this.provenanceJournal.recordIntent({ outputId: entry.outputId, sourceIdentity: entry.fingerprint,
            destination: entry.destination, profileId: entry.remux ? `remux-${entry.remuxRequest.target}` : this.plan.settings.profileId, generationDescription: entry.generationDescription });
          if (entry.remux) await observeRemuxOutput();
          stage = await createStage(this.plan.output);
          item.status = 'running';
          const owner = this.state.batchId;
          let lastProgress = 0;
          // The owned job continues after FFmpeg closes. These descriptive
          // stages change presentation only; queue/cancel ownership stays held
          // through validation, publication and the existing cleanup pipeline.
          const setJobStage = stageName => {
            advanceRemux(stageName, 0);
            item.status = ['encoding', 'remuxing'].includes(stageName) ? 'running' : 'validating';
            this.state.progress = { fileId: item.id, stage: stageName, duration: operationDuration(entry), percent: null };
            this.emitState();
          };
          const processingStage = entry.remux ? 'remuxing' : 'encoding';
          setJobStage(processingStage);
          const args = [...entry.preparedArgs];
          if (args.at(-1) !== OUTPUT_PLACEHOLDER) throw fail('INVALID_PLAN', 'The prepared output placeholder changed. Prepare again.');
          args[args.length - 1] = stage.file;
          if (entry.remux) args.splice(0, args.length, ...this.remuxOperations.resolveInvocation(entry.operationPlan, { output: stage.file }));
          if (entry.operationPlan.instrumentation) {
            if (!storageReservation || !entry.operationRuntimeToken) throw fail('OPERATION_CONTROLS_UNAVAILABLE', 'Instrumented operations require current runtime and admitted evidence storage.');
            telemetry = await createOperationTelemetry({ stageDirectory: storageReservation.directory, runtimeIdentity: this.runtimeIdentity,
              planFingerprint: entry.operationPlan.planFingerprint, streams: entry.operationPlan.instrumentation.streams,
              maxBytes: costLimits.telemetryBytes ?? 4 * 1024 * 1024, maxRecords: costLimits.telemetryRecords ?? 20000 });
            await assertTelemetryReady(telemetry);
            args.splice(0, args.length, ...(entry.hdr
              ? this.hdrOperations.resolveInvocation(entry.operationPlan, { output: stage.file, telemetry })
              : resolveEncodeOperationInvocation(entry.operationPlan, { output: stage.file, telemetry })));
          }
          entry.actualArgs = Object.freeze([...args]);
          invocationId = randomUUID();
          const invocationRecord = await this.recordIncident({ stage: 'invocation', reason: entry.remux ? 'REMUX_STARTED' : 'ENCODE_STARTED', fileId: item.id, invocationId,
            context: { executable: this.ffmpeg, argv: args, settings: this.plan.settings,
              ...(entry.vendor ? { hardwareTier: 'untested' } : {}),
              operation: describeDiagnosticOperation(entry.operationPlan, item.operationRequest),
              ...(protectedReceipt ? { planFingerprint: entry.operationPlan.planFingerprint, evidenceIds: protectedReceipt.evidenceIds, policyIdentity: protectedReceipt.policyIdentity } : {}) } });
          if (protectedReceipt && !invocationRecord.persisted) throw fail('OPERATION_DIAGNOSTICS_INCOMPLETE', 'The prepared invocation and preservation choices could not be recorded; encoding did not start.');
          if (entry.vendor) {
            requireVendorArgs(entry);
            await requireVendorDevice(entry.vendor.binding, { signal: jobSignal, run: this.run, adapters: this.vendorAdapters });
          }
          const encodeResult = await run(this.ffmpeg, args, { signal: jobSignal, timeoutMs: 0, onProgress: record => {
            advanceRemux(processingStage, Math.max(record.seconds || 0, record.bytes || 0, record.frame || 0));
            if (entry.vendor) encoderProgress = { frame: record.frame, ended: record.ended };
            if (owner !== this.state.batchId || item.status !== 'running' || this.state.progress?.stage !== processingStage) return;
            const duration = operationDuration(entry);
            const percent = duration > 0 && record.seconds !== null ? Math.min(99, Math.max(0, record.seconds / duration * 100)) : null;
            this.state.progress = { ...record, fileId: item.id, stage: processingStage, duration, percent, etaSeconds: record.speed > 0 && duration > 0 ? Math.max(0, (duration - (record.seconds || 0)) / record.speed) : null };
            if (Date.now() - lastProgress > 150) { lastProgress = Date.now(); this.emitState(); }
          } });
          if (entry.vendor) vendorGuard('encode-exit', encodeResult.exitCode === 0, 'VENDOR_ENCODE_FAILED');
          setJobStage('output-validation');
          await this.recordIncident({ stage: 'invocation', reason: entry.remux ? 'REMUX_CLOSED' : 'ENCODE_CLOSED', fileId: item.id, invocationId, ...diagnosticStderr(encodeResult), context: { exitCode: 0 } });
          await sealStage(stage);
          if (protectedReceipt) {
            await retainSealedStage(stage, 'The encoder closed successfully, but changed-operation evidence or publication is incomplete. These bytes are retained without validation authority.');
            item.outputDisposition = { kind: 'sealed-unverified', published: false, validationCurrent: false };
          }
          if (telemetry) {
            setJobStage('encoder-input-check');
            entry.operationTelemetryReceipt = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false }, signal: jobSignal });
            await storage.assertReservation(storageReservation);
            await fs.writeFile(path.join(storageReservation.directory, 'encoder-input-receipt.json'),
              JSON.stringify(entry.operationTelemetryReceipt, null, 2), { flag: 'wx' });
            await closeOperationTelemetry(telemetry, { childClosed: true }); telemetry = null;
          }
          const stagedIdentity = await readFileStamp(stage.file);
          if (this.plan.reservedIdentities.has(`${stagedIdentity.dev}:${stagedIdentity.ino}`)) throw fail('PROTECTED_SOURCE', 'A temporary output aliases a protected source.');
          if (signal.aborted) throw fail('CANCELLED', 'Encoding cancelled.');
          const result = await run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-show_chapters',
            ...(entry.remux || entry.hdr || entry.encodePreservation ? ['-show_programs', '-show_stream_groups'] : []),
            '-show_data_hash', 'sha256', '-of', 'json', stage.file], { signal: jobSignal });
          const outputProbe = parseProbeJson(result.stdout, 'Output validation');
          const marker = classifyMarker(outputProbe);
          if (marker.kind !== 'generated' || marker.outputId !== entry.outputId) throw fail('INVALID_PROVENANCE', 'The completed output does not contain its expected application marker and output ID.');
          if (JSON.stringify(marker.previousGeneration) !== JSON.stringify(entry.generationDescription)) {
            throw fail('INVALID_PROVENANCE', 'The completed output does not contain its expected resolved generation description.');
          }
          let validation;
          if (qualified) {
            requireQualification(); setJobStage('evidence-collection');
            // Evidence has independent retention; it must not keep the media
            // staging directory nonempty and suppress safe result actions.
            const evidenceDirectory = storageReservation ? storageReservation.directory : path.join(this.stateDir, 'operation-evidence');
            await fs.mkdir(evidenceDirectory, { recursive: true });
            if (entry.remux && qualified.verificationMethod === 'packet-identity-v1' && typeof this.operationRuntime.createRemuxGroup === 'function') {
              remuxGroup = this.operationRuntime.createRemuxGroup(entry.operationRuntimeToken, entry.remuxAssessment);
            }
            const evidence = entry.remux ? await collectRemuxEvidence({ assessment: entry.remuxAssessment,
              transportPreparation: entry.transportPreparation,
              runtimeIdentity: this.runtimeIdentity, outputId: entry.outputId, sourceProbe: entry.inspection.probe,
              outputProbe, sourcePath: entry.file, outputPath: stage.file, stageDirectory: evidenceDirectory,
              ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, run, signal: jobSignal, budget: qualified.budget, verificationMethod: qualified.verificationMethod, maxConcurrentChildren: remuxGroup ? 2 : 1,
              onProgress: record => {
                advanceRemux(record.stage, record.completed);
                if (owner !== this.state.batchId || jobSignal.aborted) return;
                this.state.progress = { fileId: item.id, stage: 'evidence-collection', verificationStage: record.stage,
                  completed: record.completed, total: record.total, percent: record.total > 0 ? Math.min(99, record.completed / record.total * 100) : null };
                this.emitState();
              } })
              : entry.hdr ? await collectHdrEvidence({ plan: entry.operationPlan,
                runtimeIdentity: this.runtimeIdentity, outputId: entry.outputId, sourceProbe: entry.inspection.probe,
                outputProbe, sourcePath: entry.file, outputPath: stage.file, stageDirectory: evidenceDirectory,
                ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, run, signal: jobSignal, budget: qualified.budget })
              : await collectOperationEvidence({ plan: entry.operationPlan, sourceProbe: entry.inspection.probe,
              outputProbe, sourcePath: entry.file, outputPath: stage.file, stageDirectory: evidenceDirectory,
              ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, run, signal: jobSignal,
              budget: qualified.budget, timingQualification: qualified.timingQualification,
              ...(qualified.sourcePolicy ? { sourcePolicy: qualified.sourcePolicy } : {}),
              ...(isProportionalFamilySelection(qualified, entry.operationPlan) ? { familySelection: qualified } : {}),
              ...(qualified.qualification.containerDuration === 'matroska-packet-end-plus-codec-delay'
                ? { containerClockPolicy: qualified.qualification.containerDuration } : {}) });
            if (remuxGroup) { entry.operationRuntimeGroup = await this.operationRuntime.closeRemuxGroup(remuxGroup); remuxGroup = null; }
            entry.operationEvidence = evidence;
            if (entry.remux) { item.verificationMethod = evidence.verificationMethod; item.verificationClaim = evidence.verificationClaim; }
            qualificationOwner.verifyCollectedSource?.(entry.qualificationSelection, evidence);
            if (entry.operationPlan.instrumentation && (!entry.hdr || evidence.status === 'completed')) {
              entry.telemetryValidation = entry.hdr
                ? this.hdrOperations.validateTelemetry(entry.operationPlan, entry.operationTelemetryReceipt, evidence)
                : validateEncodeOperationTelemetry(entry.operationPlan, entry.operationTelemetryReceipt, evidence);
            }
            const receiptRecord = await this.recordIncident({ stage: 'validation', reason: 'OPERATION_EVIDENCE_COLLECTED', fileId: item.id, invocationId,
              context: { directory: evidence.directory, planFingerprint: evidence.planFingerprint, evidenceIds: qualified.evidenceIds,
                status: evidence.status, scope: evidence.scope, failure: evidence.failure, children: operationChildren, streamedBytes: evidenceBytes, pipeBytes,
                ...(entry.remux ? { runtimeGroup: entry.operationRuntimeGroup || null } : {}),
                telemetryValidation: entry.telemetryValidation,
                sourceIdentityDisposition: evidence.sourceIdentityDisposition } });
            if (!receiptRecord.persisted) throw fail('OPERATION_DIAGNOSTICS_INCOMPLETE', 'Complete evidence was collected but its correlated record could not be saved. Output retained without publication.');
            // A failed collector deliberately has no validation authority. Keep
            // its actual acquisition reason, rather than hiding it behind the
            // genuine-receipt guard in the independent validator.
            if ((entry.remux || entry.hdr) && evidence.status !== 'completed') throw Object.assign(fail(
              evidence.failure?.code || (entry.hdr ? 'HDR_EVIDENCE_INCOMPLETE' : 'REMUX_EVIDENCE_INCOMPLETE'),
              evidence.failure?.message || 'Complete native preservation evidence could not be collected. Output retained without publication.'),
            { evidenceDirectory: evidence.directory, evidenceReceipt: evidence });
            requireQualification(); setJobStage('output-validation');
            validation = entry.remux ? this.remuxOperations.validate(entry.operationPlan, outputProbe, evidence)
              : entry.hdr ? this.hdrOperations.validate(entry.operationPlan, outputProbe, evidence)
              : validateEncodeOperationOutput(entry.operationPlan, outputProbe,
                { qualification: qualified.qualification, decodedEvidence: evidence.decodedEvidence });
          } else if (entry.encodePreservation) {
            requireEncodePreservation.call(this, entry);
            validation = validateEncodeOperationOutput(entry.operationPlan, outputProbe);
          } else validation = this.verify(entry.inspection, outputProbe, entry.vendor ? entry.vendor.twinSettings : this.plan.settings);
          const validationRecord = await this.recordIncident({ stage: 'validation', reason: 'OUTPUT_CHECKED', fileId: item.id, invocationId,
            severity: validation.valid ? 'info' : 'error', context: { validation } });
          if (protectedReceipt && !validationRecord.persisted) throw fail('OPERATION_DIAGNOSTICS_INCOMPLETE', 'The output-validation record could not be saved. Output retained without publication.');
          if (!validation.valid) throw fail('INVALID_OUTPUT', validation.errors.join(' '));
          // Changed-path encodes only: a read-only copy of the checked timing,
          // attached to the item only once the output is published below.
          // The ordinary and remux result shapes stay exactly as before.
          const checkedTiming = validation.validation === 'decoded-operation-contract' && validation.timing ? clone(validation.timing) : null;
          const validationWarnings = mergeWarnings(item.warnings || [], validation.warnings || []);
          if (validationWarnings.length) item.warnings = validationWarnings;
          if (entry.vendor) await vendorOutputCheck({ vendor: entry.vendor, outputProbe, encoderProgress,
            duration: entry.inspection.duration, file: stage.file, ffmpeg: this.ffmpeg, run, signal: jobSignal });
          await markStageValidated(stage);
          item.outputDisposition = { kind: 'validated-staged', published: false };
          validatingSource = true;
          setJobStage('source-check');
          const assessment = await this.assessCompletedSource(entry, jobSignal);
          item.sourceAssessment = assessment;
          const sourceRecord = await this.recordIncident({ stage: 'validation', reason: 'SOURCE_ASSESSED', fileId: item.id,
            severity: assessment.kind === 'unchanged' ? 'info' : 'warning', context: { sourceAssessment: assessment } });
          if (protectedReceipt && !sourceRecord.persisted) throw fail('OPERATION_DIAGNOSTICS_INCOMPLETE', 'The source assessment could not be recorded. Output retained without publication.');
          if (assessment.kind !== 'unchanged') {
            item.sourceIdentityDiagnostic = assessment.diagnostic;
            // Retaining this completed output cannot authorize a later job or
            // manufacture a fresh generated-source grant/cache identity.
            item.reencodeAuthorized = false;
            entry.reencodeAuthorized = false;
            this.plan.reencodeAuthorizations.delete(item.id);
            this.plan.overrides.delete(item.id);
          }
          if (assessment.kind === 'changed' || assessment.kind === 'incomplete') {
            const fields = assessment.diagnostic.changedFields.join(', ');
            throw Object.assign(fail(assessment.kind === 'changed' ? 'INPUT_CHANGED' : 'SOURCE_CHECK_INCOMPLETE',
              assessment.kind === 'changed'
                ? `Source identity changed while it was being encoded. Changed identity fields: ${fields || 'stronger content evidence'}. The completed output was retained without publication.`
                : 'The completed source check was incomplete. The completed output was retained without publication.'),
            { sourceIdentityDiagnostic: assessment.diagnostic });
          }
          if (assessment.kind === 'ctime-only') item.warnings = mergeWarnings(item.warnings || [], [assessment.warning]);
          validatingSource = false;
          setJobStage('publication');
          await this.verifyFolders();
          // Completion's ctime-only warning does not renew the original source
          // grant/catalog. Recheck the same frozen qualification, then publish
          // only through the existing no-overwrite owned stage.
          requireQualification(); notCancelled(jobSignal);
          if (entry.operationRuntimeToken) await this.operationRuntime.requireCurrent(entry.operationRuntimeToken, { signal: jobSignal });
          if (storage) await observeEvidenceGrowth();
          if (storageFailure) throw storageFailure;
          if (entry.vendor) await requireVendorDevice(entry.vendor.binding, { signal: jobSignal, run: this.run, adapters: this.vendorAdapters });
          const published = await publishOutput(stage, entry.destination, { signal: jobSignal, atomicOnly: this.plan.sameFolder,
            ...(entry.remux ? { onProgress: event => advanceRemux(event.stage, event.completed) } : {}) });
          await this.recordIncident({ stage: 'publication', reason: published ? 'OUTPUT_PUBLISHED' : 'OUTPUT_COLLISION', fileId: item.id,
            severity: !published || assessment.kind === 'ctime-only' ? 'warning' : 'info', context: { destination: entry.destination, published, sourceAssessment: assessment } });
          item.status = published ? 'success' : 'skipped';
          if (published && checkedTiming) item.timing = checkedTiming;
          item.outcome = published ? item.warnings?.length ? 'saved-with-warning' : 'saved' : 'destination-collision';
          item.outputDisposition = { kind: published ? 'published' : 'retained-completed', published, ...(published ? { file: entry.destination } : {}) };
          item.reason = published ? item.warnings?.length ? 'Output saved. ' + item.warnings.map(warning => warning.message).join(' ') : '' : 'Another output won the publication race.';
          if (published) {
            try {
              publishedIdentity = await readPublishedOutputIdentity(stage);
              await this.provenanceJournal.recordPublished(entry.outputId, publishedIdentity);
            }
            catch (error) {
              item.reason = entry.vendor ? 'Output saved; provenance bookkeeping remains pending.'
                : [item.reason, 'Output saved; provenance bookkeeping remains pending. ' + error.message].filter(Boolean).join(' ');
              if (entry.vendor) await this.recordIncident({ stage: 'publication', reason: 'VENDOR_BOOKKEEPING_PENDING', severity: 'warning',
                fileId: item.id, context: { nativePrivate: vendorRefusal(error).nativePrivate } });
              if (this.outputAccess && !publishedIdentity) {
                item.outputAccessWarning = entry.vendor ? 'Output saved, but its open/reveal action could not be bound safely.'
                  : 'Output saved, but its open/reveal action could not be bound safely: ' + error.message;
              }
            }
          }
        } catch (error) {
          if (remuxFailure && !signal.aborted && error.code !== 'PUBLICATION_UNCERTAIN') error = operationFailure(remuxFailure, error);
          if (storageFailure && !signal.aborted && error.code !== 'PUBLICATION_UNCERTAIN') error = operationFailure(storageFailure, error);
          if (operationExpired && !signal.aborted && error.code !== 'PUBLICATION_UNCERTAIN') {
            error = Object.assign(fail('OPERATION_DEADLINE', 'The changed operation exceeded its total deadline. No unvalidated output was published.'),
              { cause: error, evidenceDirectory: error.evidenceDirectory, evidenceReceipt: error.evidenceReceipt,
                ...diagnosticStderr(error), sourceIdentityDiagnostic: error.sourceIdentityDiagnostic });
          }
          // Deletion, empty files and failed identity reads are invalidation
          // too; an errno must not leave a misleading authorized UI state.
          if (validatingSource || ['INPUT_CHANGED', 'GENERATED_SOURCE'].includes(error.code)) {
            item.reencodeAuthorized = false;
            entry.reencodeAuthorized = false;
            this.plan.reencodeAuthorizations.delete(item.id);
          }
          item.status = signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
          const vendorFailure = entry.vendor ? vendorRefusal(error) : null;
          item.reason = vendorFailure ? vendorFailure.reason : error.message;
          item.reasonCode = vendorFailure ? vendorFailure.reasonCode : error.code || 'OPERATION_FAILED';
          if (!entry.vendor) {
            item.details = error.stderr?.slice(-4000);
            if (error.sourceIdentityDiagnostic) item.sourceIdentityDiagnostic = error.sourceIdentityDiagnostic;
          }
          await this.recordIncident({ stage: item.status === 'cancelled' ? 'cancellation' : 'encoding', reason: item.status === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED',
            severity: item.status === 'cancelled' ? 'info' : 'error', fileId: item.id, message: item.reason, ...diagnosticStderr(error),
            ...(invocationId ? { invocationId } : {}), context: { code: item.reasonCode, sourceIdentityDiagnostic: item.sourceIdentityDiagnostic,
              exitCode: error.exitCode, signal: error.exitSignal ?? error.signal, evidenceDirectory: error.evidenceDirectory,
              evidenceFailure: error.evidenceReceipt?.failure, ...(vendorFailure ? { nativePrivate: vendorFailure.nativePrivate } : {}) } });
          if (item.status === 'cancelled') break;
          if (sharedFailure(error)) { stoppedByFailure = true; this.state.error = item.reason; break; }
        } finally {
          if (operationTimer) clearTimeout(operationTimer);
          if (remuxGroup) { await this.operationRuntime.closeRemuxGroup(remuxGroup); remuxGroup = null; }
          if (storageMonitor) clearInterval(storageMonitor);
          await storageWatch;
          if (telemetry) {
            try { await closeOperationTelemetry(telemetry, { childClosed: true }); }
            catch (error) { item.evidenceWarning = 'Encoder telemetry handles could not be closed: ' + error.message; }
          }
          let cleanup;
          try {
            cleanup = await cleanupStage(stage, { protectedIdentities: this.plan.reservedIdentities });
            if (cleanup?.retained) {
              item.cleanup = cleanup;
              item.reason = [item.reason, 'Temporary files retained for safety: ' + cleanup.reason].filter(Boolean).join(' ');
            }
          }
          catch (error) {
            stoppedByFailure = true;
            this.state.error = entry.vendor ? VENDOR_MESSAGES.VENDOR_ENCODE_FAILED : `Could not clean owned temporary output: ${error.message}`;
            if (entry.vendor) await this.recordIncident({ stage: 'publication', reason: 'VENDOR_ENCODE_FAILED', severity: 'error',
              context: { nativePrivate: vendorRefusal(error).nativePrivate } });
          }
          if (item.outputDisposition && item.outputDisposition.published !== true) {
            // Validation describes the earlier bound bytes, not whichever file
            // now occupies a pathname. Reconcile even when cleanup found no file
            // or could not complete its checks. A committed publication remains
            // published independently of temporary-directory cleanup failures.
            const staged = cleanup?.completed
              ? { kind: cleanup.validationCurrent ? 'retained-completed' : 'retained-changed-stage', published: false,
                validationCurrent: cleanup.validationCurrent, file: cleanup.file, directory: cleanup.directory }
              : { kind: cleanup?.retained ? 'retained-unverified' : cleanup?.retained === false ? 'stage-unavailable' : 'stage-unverified',
                published: false, validationCurrent: false, file: stage?.file, directory: stage?.directory };
            item.outputDisposition = item.reasonCode === 'PUBLICATION_UNCERTAIN'
              ? { kind: 'publication-uncertain', published: null, validationCurrent: false, file: entry.destination, stage: staged }
              : staged;
          }
          if (this.outputAccess && item.outputDisposition?.published === true && publishedIdentity && cleanup?.retained === false) {
            try {
              const current = await readPublishedOutputIdentity(stage, { afterCleanup: true });
              item.outputAccess = await this.outputAccess.issue({ file: current.canonicalPath, identity: current });
            } catch (error) {
              item.outputAccessWarning = entry.vendor ? 'Output saved, but its open/reveal action could not be bound safely.'
                : 'Output saved, but its open/reveal action could not be bound safely: ' + error.message;
              if (entry.vendor) await this.recordIncident({ stage: 'publication', reason: 'VENDOR_OUTPUT_ACTION_UNAVAILABLE', severity: 'warning',
                fileId: item.id, context: { nativePrivate: vendorRefusal(error).nativePrivate } });
            }
          }
          if (storage && storageReservation) {
            try { item.evidenceStorage = await storage.finish(storageReservation,
              { status: item.status === 'cancelled' ? 'cancelled' : ['success', 'skipped'].includes(item.status) ? 'completed' : 'failed' }); }
            catch (error) { item.evidenceStorage = { observation: 'unavailable',
              lastObserved: error.storageSnapshot || null, accounting: error.accounting || null,
              failure: { code: error.code || 'OPERATION_STORAGE_UNAVAILABLE', message: error.message } };
              item.evidenceWarning = 'Retained evidence accounting is incomplete: ' + error.message; }
          }
          if (entry.vendor && ['failed', 'cancelled'].includes(item.status)) item.reason = vendorRefusal({ code: item.reasonCode }).reason;
          await this.recordIncident({ stage: 'publication', reason: 'JOB_DISPOSITION', fileId: item.id, context: {
            name: item.name, outputName: item.outputName, settings: this.plan.settings,
            operation: describeDiagnosticOperation(entry.operationPlan, item.operationRequest),
            status: item.status, outcome: item.outcome, outputDisposition: item.outputDisposition, cleanup: item.cleanup,
            warnings: item.warnings, sourceIdentityDiagnostic: item.sourceIdentityDiagnostic,
            evidenceStorage: item.evidenceStorage, evidenceWarning: item.evidenceWarning } });
          this.emitState();
        }
        if (stoppedByFailure) break;
      }
    } catch (error) {
      stoppedByFailure = true;
      this.state.error = VENDOR_PROFILES.some(row => row.id === this.state.settings?.profileId) ? vendorRefusal(error).reason : error.message;
    } finally {
      for (const item of this.state.items) if (item.status === 'pending') item.status = 'unprocessed';
      const terminalPhase = signal.aborted ? 'cancelled' : stoppedByFailure ? 'failed' : 'completed';
      await this.recordIncident({ stage: 'session', reason: 'BATCH_FINISHED', context: {
        phase: terminalPhase, counts: this.snapshot().counts, settings: this.plan.settings,
        elapsedSeconds: (Date.now() - this.startedAt) / 1000, totalItems: this.state.items.length,
        jobDetails: 'Correlate JOB_DISPOSITION records by batchId and fileId. Retention/truncation status applies.',
      } });
      // Per-file dispositions and this terminal record replace the unbounded
      // duplicate batch JSON writer. Existing historical logs stay untouched;
      // all newly generated diagnostic content shares the bounded journal.
      // Keep admission closed through all asynchronous finalization. Otherwise a
      // new batch could replace state while the old batch is still logging it.
      if (this.plan?.operation === 'remux') { this.remuxOperations.invalidate(); this.plan.remuxGrants.clear(); this.plan.remuxCandidates.clear(); }
      this.hdrOperations?.invalidate();
      this.encodePreservationOperations?.invalidate();
      this.plan?.encodePreservationGrants.clear(); this.plan?.encodePreservationCandidates.clear();
      if (this.plan?.operation === 'native-encode') {
        for (const entry of this.plan.entries.values()) { entry.selection = null; entry.contract = null; }
        this.plan.nativeSelection = null;
      }
      this.state.phase = terminalPhase;
      this.finishedAt = Date.now();
      this.emitState();
    }
  }

  async cancelBatch(request) {
    objectKeys(request, ['batchId']);
    if (id(request.batchId) !== this.state.batchId) throw fail('STALE_BATCH', 'That batch is no longer active.');
    return this.cancelCurrent();
  }
  async cancelCurrent() {
    if (this.preparedCancellation) return this.preparedCancellation;
    const drainWrites = async () => {
      if (this.preferenceMutation) await this.preferenceMutation.catch(() => {});
      await Promise.allSettled([...this.appSettingsMutations]);
    };
    // Cancelling a prepared Remux batch must revoke its temporary stream
    // decisions even when no child has started. A successful no-op cancel may
    // not leave the old Start capability live.
    const preparedHdr = this.plan?.entries && [...this.plan.entries.values()].some(entry => entry.hdr);
    const preparedPreservation = this.state.items.some(item => item.encodePreservation);
    // A ready native plan holds selection tokens and contracts; Cancel revokes them (record 37 §3.5).
    const preparedNative = this.plan?.operation === 'native-encode';
    if (!this.busy && (this.plan?.operation === 'remux' || preparedHdr || preparedPreservation || preparedNative) && this.state.phase === 'ready') {
      const remux = this.plan.operation === 'remux';
      if (remux) { this.remuxOperations.invalidate(); this.plan.remuxGrants.clear(); this.plan.remuxCandidates.clear(); }
      if (preparedNative) this.plan.nativeSelection = null;
      this.hdrOperations?.invalidate(); this.plan.entries.clear();
      this.encodePreservationOperations?.invalidate(); this.plan.encodePreservationGrants.clear(); this.plan.encodePreservationCandidates.clear();
      this.plan = null; this.state.planId = null; this.state.operationDraft = null;
      for (const item of this.state.items) if (['ready', 'conflict'].includes(item.status)) {
        item.status = 'cancelled'; item.reason = `Prepared ${remux ? 'Remux' : preparedPreservation ? 'Encode preservation' : 'HDR'} cancelled. Prepare again to create new authority.`;
        if (preparedNative) item.reason = NATIVE_MESSAGES.PREPARED_NATIVE_CANCELLED;
      }
      // Keep admission closed across asynchronous diagnostics and saved writes.
      // This cancellation must never fall through and abort a later batch.
      this.state.phase = 'cancelling';
      this.preparedCancellation = (async () => {
        try {
          await this.recordIncident({ stage: 'cancellation', reason: preparedNative ? 'PREPARED_NATIVE_CANCELLED' : remux ? 'PREPARED_REMUX_CANCELLED' : preparedPreservation ? 'PREPARED_ENCODE_PRESERVATION_CANCELLED' : 'PREPARED_HDR_CANCELLED' });
        } finally {
          await drainWrites();
          this.state.phase = 'cancelled'; this.finishedAt = Date.now(); this.emitState();
        }
        return this.snapshot();
      })();
      this.emitState();
      try { return await this.preparedCancellation; }
      finally { this.preparedCancellation = null; }
    }
    if (this.busy) {
      this.state.phase = 'cancelling';
      this.controller.abort();
      this.emitState();
      await this.recordIncident({ stage: 'cancellation', reason: 'CANCELLATION_REQUESTED' });
      await this.taskPromise;
    }
    // A close or renderer loss can arrive during a bounded preference write.
    // Let the exact owned write finish before application shutdown.
    await drainWrites();
    return this.snapshot();
  }
}

module.exports = { EncoderService, objectKeys, sharedFailure, describeDiagnosticOperation, operationCostLimits, createRemuxProgressClock, requireRemuxOutputSpace };
