const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PROFILES, validateSettings, selectVideo, buildEncodeArgs, describeRecipe, outputPixelFormat } = require('./media.cjs');
const { runTool, isSharedToolFailure } = require('./process-runner.cjs');
const { inspectInput, inspectMetadata, finishInspection, parseProbeJson, validateOutput } = require('./inspection.cjs');
const { checkCapabilities } = require('./capabilities.cjs');
const { exists, createStage, sealStage, markStageValidated, cleanupStage, publishOutput } = require('./outputs.cjs');
const { createOutputId, classifyMarker, historicalSuffix, ProvenanceJournal, generationDescriptionOf } = require('./provenance.cjs');
const { readFileStamp, readSourceIdentity, sameStamp, sameIdentity, assertIdentityMatches, assessCompletedSource } = require('./source-identity.cjs');
const { StorageEligibility } = require('./storage-eligibility.cjs');
const { InspectionCache } = require('./inspection-cache.cjs');
const { Preferences } = require('./preferences.cjs');
const { DiagnosticJournal } = require('./diagnostics.cjs');
const { AppSettings } = require('./app-settings.cjs');

const BUSY = new Set(['checking', 'preparing', 'running', 'cancelling']);
const EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => structuredClone(value);
const OUTPUT_PLACEHOLDER = '<temporary output assigned at start>';
const APP_VERSION = require('../package.json').version;
// Keep the owned child's capture accounting separate from the small UI excerpt.
// Journals must not relabel an upstream-truncated tail as a complete capture.
const diagnosticStderr = result => ({ stderr: typeof result?.stderr === 'string' ? result.stderr : '',
  ...(result?.stderrCapture ? { stderrCapture: result.stderrCapture } : {}) });

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
  constructor({ ffmpeg, ffprobe, stateDir, run = runTool, inspect = inspectInput, verify = validateOutput, capabilities = checkCapabilities,
    inspectionCache, storageEligibility, inspectionWorkers = 2, provenanceJournal, preferences, diagnostics, appSettings }) {
    super();
    if (![1, 2].includes(inspectionWorkers)) throw new TypeError('Inspection workers must be one or two.');
    Object.assign(this, { ffmpeg, ffprobe, stateDir, run, inspect, verify, capabilities });
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
    this.cacheInitialization = null;
    this.diagnostics = diagnostics || new DiagnosticJournal({ directory: stateDir, versions: {
      app: APP_VERSION, ...(process.versions.electron ? { electron: process.versions.electron } : {}),
    } });
    this.diagnosticInitialization = null;
    this.appSettings = appSettings || new AppSettings({ directory: stateDir });
    this.appSettingsMutations = new Set();
    this.runtimeVersions = {};
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
        : { status: 'not-yet-observed', version: null, executable: this[name] }])) };
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
      this.state.diagnosticWarning = 'Diagnostic history is incomplete. ' + error.message;
      throw error;
    }
    // A failed durable start is retryable; caching its false result forever
    // would hide recovery after a transient storage failure.
    if (!result.persisted) this.diagnosticInitialization = null;
    this.state.diagnostics = this.diagnostics.snapshot();
    if (!result.persisted) this.state.diagnosticWarning = 'Diagnostic history is incomplete. The session start could not be saved.';
    if (result.recovered?.length) this.state.interruptedSessions = result.recovered;
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
      if (!result.persisted) this.state.diagnosticWarning = 'Diagnostic history is incomplete. ' + (result.status?.lastError?.message || 'A record could not be saved.');
      return result;
    } catch (error) {
      this.state.diagnosticWarning = 'Diagnostic history is incomplete. ' + error.message;
      return { persisted: false };
    }
  }

  async closeDiagnostics(outcome = 'completed') {
    await this.initializeDiagnostics();
    return this.diagnostics.closeSession({ outcome });
  }
  async getDiagnosticHistory(request) { await this.initializeDiagnostics(); return this.diagnostics.list(request); }
  async getDiagnosticRecord(request) {
    objectKeys(request, ['eventId']); await this.initializeDiagnostics(); return this.diagnostics.read(request.eventId);
  }
  async getDiagnosticExport(request) { await this.initializeDiagnostics(); return this.diagnostics.buildRedactedExport(request); }

  get busy() { return BUSY.has(this.state.phase); }
  snapshot() {
    const counts = { success: 0, failed: 0, skipped: 0, cancelled: 0, unprocessed: 0 };
    for (const item of this.state.items) {
      if (['unsupported', 'provenance-issue'].includes(item.status)) counts.failed++;
      else if (Object.hasOwn(counts, item.status)) counts[item.status]++;
    }
    return clone({ ...this.state, counts, elapsedSeconds: this.startedAt ? ((this.finishedAt || Date.now()) - this.startedAt) / 1000 : 0 });
  }
  emitState() {
    this.state.revision++;
    this.emit('update', this.snapshot());
  }
  requireIdle() { if (this.busy || this.preferenceMutation) throw fail('BUSY', 'Wait for the current operation and cleanup to finish.'); }
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
        this.capabilityResult = await this.capabilities({ ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, stateDir: this.stateDir, signal, run: this.run });
        await this.recordRuntimeVersions(this.capabilityResult.versions);
        await this.recordIncident({ stage: 'capability', reason: 'CAPABILITY_FINISHED', context: this.capabilityResult });
        await this.recoverProvenance(signal);
        // Capability initialization is a separate operation. Returning from it
        // must not erase a completed/failed/cancelled workflow or its timings.
        this.state = { ...previousState, revision: this.state.revision, provenanceRecovery: this.state.provenanceRecovery,
          diagnostics: this.state.diagnostics, diagnosticWarning: this.state.diagnosticWarning, interruptedSessions: this.state.interruptedSessions };
        Object.assign(this, previousTimes);
      } catch (error) {
        await this.recordRuntimeVersions(error.runtimeVersions);
        this.state.phase = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        this.state.error = error.message;
        await this.recordIncident({ stage: 'capability', reason: 'CAPABILITY_FAILED', severity: 'error', message: error.message, ...diagnosticStderr(error), context: { code: error.code } });
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
    this.plan = null;
    this.state.planId = null;
    if (this.state.phase === 'ready') {
      Object.assign(this.state, { phase: 'idle', items: [], progress: null, preparation: null, settings: null });
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
    const capability = this.capabilityResult?.profiles.find(profile => profile.id === profileId);
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
    const settings = validateSettings(request);
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      await this.preferences.saveSettings(settings);
      this.invalidatePlan();
      return this.preferencesSnapshot();
    });
  }

  getRecipe(request) {
    return clone(describeRecipe(validateSettings(request)));
  }

  getEncodingDetails(request) {
    objectKeys(request, ['planId', 'fileId']);
    if (!this.plan || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare the current batch again.');
    const entry = this.plan.entries.get(id(request.fileId));
    if (!entry) throw fail('UNPREPARED_FILE', 'Resolved encoding details are available after this file is admitted and prepared.');
    // This is display data, not a shell command or an argument submission API.
    // Execution consumes this exact stored array, substituting only its final
    // staging filename. The eventual publication destination is separate.
    return clone({ kind: entry.actualArgs ? 'actual-invocation' : 'resolved-argument-template', executable: this.ffmpeg,
      args: entry.actualArgs || entry.preparedArgs, destination: entry.destination,
      ...(entry.actualArgs ? {} : { outputPlaceholder: OUTPUT_PLACEHOLDER }),
      notice: entry.actualArgs ? 'Exact arguments passed to FFmpeg. This temporary output is validated before publication.'
        : 'Complete prepared arguments; only the final temporary output path is assigned when encoding starts. This is an argument array, not a shell command.' });
  }

  async resetProfile(request) {
    objectKeys(request, ['profileId']);
    if (!PROFILES.some(profile => profile.id === request.profileId)) throw fail('INVALID_SETTINGS', 'Choose a supported encoding profile.');
    return this.mutatePreferences(async () => {
      await this.initializePreferences();
      await this.preferences.resetProfile(request.profileId);
      this.invalidatePlan();
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

  async prepareItem(item, { input, output, settings, profile, caps, signal, owner }) {
    const progress = this.state.preparation;
    notCancelled(signal);
    progress.active++;
    Object.assign(progress, { fileId: item.id, stage: 'identity', window: null });
    const worker = { fileId: item.id, stage: 'identity', window: null };
    progress.workers.push(worker);
    this.emitState();
    const file = path.join(input.path, item.name);
    const destination = path.join(output.path, item.outputName);
    let inspectionDiagnostic;
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
      if (reason) progress.notice ||= reason;
      let inspection = reusable ? await this.inspectionCache.lookup(identity) : null;
      let probe = inspection?.probe;
      item.inspectionMethod = inspection ? 'reused' : 'fresh';
      if (inspection) { onStage({ stage: 'reused' }); progress.reused++; }
      else if (this.inspect === inspectInput) probe = await inspectMetadata(file, { ffprobe: this.ffprobe, signal, run: this.run, onStage });
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
      const destinationExists = await exists(destination);
      if (this.plan.reservedPaths.has(destination.toLowerCase())) {
        item.status = destinationExists ? 'skipped' : 'unsupported';
        item.reason = 'Destination is protected by the original directory snapshot; prepare another destination.';
        return;
      }
      if (destinationExists) { item.status = 'skipped'; item.reason = 'Output already exists.'; return; }
      if (!inspection) {
        progress.inspected++;
        inspection = await finishInspection(file, probe, { ffprobe: this.ffprobe, signal, run: this.run, onStage });
      } else if (item.inspectionMethod === 'fresh') progress.inspected++;
      notCancelled(signal);
      assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-inspection', message: 'Source identity changed during inspection.' });
      if (reusable && item.inspectionMethod === 'fresh') {
        await this.inspectionCache.store(identity, inspection);
        if (this.inspectionCache.warning) progress.notice ||= this.inspectionCache.warning;
      }
      if (!inspection.color.supported) throw fail('UNSUPPORTED_COLOR', inspection.color.reasons.join(' '));
      const video = selectVideo(inspection.probe);
      const depth = /(?:10|12)/.exec(video.pix_fmt)?.[0] || '8';
      const capability = caps.profiles.find(entry => entry.id === profile.id);
      if (!capability.supportedBitDepths.includes(Number(depth))) throw fail('UNSUPPORTED_DEPTH', profile.label + ' cannot encode this bit depth on the current device.');
      if (settings.recipeId && !caps.recipes?.find(recipe => recipe.id === settings.recipeId)?.supportedBitDepths.includes(Number(depth))) {
        throw fail('UNSUPPORTED_RECIPE_DEPTH', 'The named recipe has not passed a real encode/decode check for this input bit depth on the current device.');
      }
      const outputId = createOutputId();
      const recipe = describeRecipe(settings);
      const pixelFormat = outputPixelFormat(profile, video);
      const generationDescription = generationDescriptionOf({ version: 1, profileId: settings.profileId, codec: profile.codec,
        backend: profile.hardware, encoder: profile.encoder, preset: settings.preset, qualityMode: recipe.qualityMode, quality: settings.quality,
        bitDepth: /(?:10|12)/.test(pixelFormat) ? Number(/(?:10|12)/.exec(pixelFormat)[0]) : 8,
        encoderArgs: recipe.args, appVersion: APP_VERSION, createdAt: new Date().toISOString(),
        ...(settings.recipeId ? { recipeId: settings.recipeId } : {}),
        ...(typeof caps.versions?.ffmpeg === 'string' ? { runtimeVersion: caps.versions.ffmpeg.slice(0, 256) } : {}) });
      if (!generationDescription) throw fail('INVALID_RECIPE', 'The resolved generation description is invalid.');
      const preparedArgs = buildEncodeArgs({ input: file, output: destination, settings, probe: inspection.probe,
        colorEvidence: inspection.color, outputId, generationDescription });
      preparedArgs[preparedArgs.length - 1] = OUTPUT_PLACEHOLDER;
      this.plan.entries.set(item.id, { file, destination, inspection, fingerprint: identity, overridden: this.plan.overrides.has(item.id),
        reencodeAuthorized: item.reencodeAuthorized, sourceOutputId: marker.outputId || indexed?.outputId,
        outputId, generationDescription, preparedArgs: Object.freeze(preparedArgs) });
      this.plan.ambiguities.delete(item.id);
      Object.assign(item, { status: 'ready', summary: inspection.summary, reason: item.reencodeAuthorized
        ? 'Explicit re-encoding authorized for this file and prepared batch only.'
        : this.plan.overrides.has(item.id) ? 'Explicitly treated as original for this plan only.' : '' });
    } catch (error) {
      if (error.code === 'CANCELLED' || signal.aborted || sharedFailure(error)) throw error;
      if (['INPUT_CHANGED', 'UNSAFE_SOURCE'].includes(error.code)) {
        item.reencodeAuthorized = false;
        this.plan.reencodeAuthorizations.delete(item.id);
      }
      item.status = 'unsupported'; item.reason = error.message;
      item.reasonCode = error.code || 'INSPECTION_FAILED';
      item.details = typeof error.stderr === 'string' ? error.stderr.slice(-4000) : undefined;
      inspectionDiagnostic = diagnosticStderr(error);
      if (error.sourceIdentityDiagnostic) item.sourceIdentityDiagnostic = error.sourceIdentityDiagnostic;
    } finally {
      progress.active--;
      progress.workers = progress.workers.filter(entry => entry.fileId !== item.id);
      if (item.status !== 'pending') progress.resolved++;
      await this.recordIncident({ stage: 'inspection', reason: 'FILE_INSPECTED', severity: item.status === 'unsupported' ? 'warning' : 'info',
        fileId: item.id, message: item.reason, ...(inspectionDiagnostic || {}),
        context: { file: file, status: item.status, summary: item.summary, code: item.reasonCode, sourceIdentityDiagnostic: item.sourceIdentityDiagnostic } });
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
    objectKeys(request, ['inputFolderId', 'outputFolderId', 'settings']);
    const settings = validateSettings(request.settings);
    const input = this.folders.get(id(request.inputFolderId));
    const output = this.folders.get(id(request.outputFolderId));
    if (input?.role !== 'input' || output?.role !== 'output') throw fail('INVALID_FOLDER', 'Select both folders again.');
    const sameFolder = input.path.toLowerCase() === output.path.toLowerCase();
    this.requireIdle();
    const caps = await this.getCapabilities();
    this.requireIdle();
    if (this.folders.get(request.inputFolderId) !== input || this.folders.get(request.outputFolderId) !== output) {
      throw fail('INVALID_FOLDER', 'The folder selections changed. Select both folders again.');
    }
    if (!caps.profiles.find(profile => profile.id === settings.profileId)?.available) throw fail('UNAVAILABLE_PROFILE', 'The selected encoder cannot initialize on this computer.');
    if (settings.recipeId && !caps.recipes?.find(recipe => recipe.id === settings.recipeId)?.available) {
      throw fail('UNAVAILABLE_RECIPE', 'The named recipe cannot initialize with its complete settings on this computer. Choose standard options explicitly to continue.');
    }
    const signal = this.begin('preparing');
    this.state.items = [];
    this.state.settings = settings;
    this.plan = { id: randomUUID(), input: input.path, output: output.path, settings, sameFolder, entries: new Map(),
      baseline: new Map(), reservedPaths: new Set(), reservedIdentities: new Set(), overrides: new Map(), ambiguities: new Map(),
      generated: new Map(), reencodeAuthorizations: new Map() };
    this.state.planId = this.plan.id;
    this.taskPromise = (async () => {
      try {
        await this.recordIncident({ stage: 'preparation', reason: 'PREPARATION_STARTED', context: { settings, input: input.path, output: output.path } });
        await this.captureFolders();
        await this.verifyFolders();
        await this.initializeInspectionCache(signal);
        const files = (await fs.readdir(input.path, { withFileTypes: true }))
          .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: false }) || a.name.localeCompare(b.name));
        if (!files.length) throw fail('NO_INPUTS', 'No supported top-level video files were found.');
        await this.captureBaseline(files, signal);
        if (sameFolder) {
          const candidate = [...this.plan.baseline.values()].find(entry => entry.identity);
          const storage = candidate && await this.storageEligibility.check(candidate.identity.canonicalPath, candidate.identity, { signal });
          if (!storage?.eligible) throw fail('SAME_FOLDER_STORAGE', 'Output beside originals requires verified local fixed NTFS storage. Choose a distinct output folder for this storage.');
        }
        const profile = PROFILES.find(entry => entry.id === settings.profileId);
        this.state.items = files.map(entry => ({ id: randomUUID(), name: entry.name, outputName: `${path.parse(entry.name).name}_${profile.suffix}.mkv`, status: 'pending', reason: '', reencodeAuthorized: false }));
        this.state.preparation = { total: files.length, resolved: 0, reused: 0, inspected: 0, active: 0, workers: [], stage: 'identity', fileId: null, notice: this.cacheWarning };
        const context = { input, output, settings, profile, caps, signal, owner: this.state.batchId };
        await this.prepareWithWorkers(context);
        this.markConflicts();
        this.state.phase = 'ready';
      } catch (error) {
        this.state.phase = this.preparationFailure ? 'failed' : signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        this.state.error = error.message;
        await this.recordIncident({ stage: 'preparation', reason: 'PREPARATION_FAILED', severity: 'error', message: error.message,
          ...diagnosticStderr(error), context: { code: error.code || 'PREPARATION_FAILED' } });
        for (const item of this.state.items) if (item.status === 'pending') item.status = 'unprocessed';
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
    if (!this.plan || this.state.phase !== 'ready' || id(request.planId) !== this.plan.id) throw fail('STALE_PLAN', 'Prepare the current batch again.');
    const item = this.state.items.find(entry => entry.id === id(request.fileId));
    const ambiguous = this.plan.ambiguities.get(request.fileId);
    if (!item || item.status !== 'ambiguous' || !ambiguous) throw fail('INVALID_OVERRIDE', 'Only an ambiguous unmarked file can be treated as original.');
    const signal = this.begin('preparing');
    const priorResolved = this.state.items.filter(entry => entry.status !== 'pending').length;
    item.status = 'pending';
    this.state.preparation = { total: this.state.items.length, resolved: priorResolved - 1, reused: 0, inspected: 0, active: 0, workers: [], stage: 'identity', notice: null };
    this.taskPromise = (async () => {
      try {
        const current = await readSourceIdentity(ambiguous.file, { signal });
        if (!sameIdentity(current, ambiguous.fingerprint)) throw fail('INPUT_CHANGED', 'The possible previous output changed. Prepare the batch again.');
        this.plan.overrides.set(item.id, current);
        await this.prepareItem(item, { input: { path: this.plan.input }, output: { path: this.plan.output }, settings: this.plan.settings,
          profile: PROFILES.find(profile => profile.id === this.plan.settings.profileId), caps: this.capabilityResult, signal, owner: this.state.batchId });
        notCancelled(signal);
        this.markConflicts(); this.state.phase = 'ready';
      } catch (error) {
        item.status = signal.aborted ? 'unprocessed' : 'unsupported'; item.reason = error.message;
        this.state.phase = signal.aborted ? 'cancelled' : 'failed'; this.state.error = error.message;
        for (const entry of this.state.items) entry.reencodeAuthorized = false;
        this.plan = null; this.state.planId = null;
      } finally { this.finishedAt = Date.now(); this.emitState(); }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async reencodeOutputs(request) {
    objectKeys(request, ['planId', 'fileIds']);
    this.requireIdle();
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
    this.taskPromise = (async () => {
      try {
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
            profile: PROFILES.find(profile => profile.id === this.plan.settings.profileId), caps: this.capabilityResult, signal, owner: this.state.batchId });
        }
        notCancelled(signal);
        this.markConflicts(); this.state.phase = 'ready';
      } catch (error) {
        for (const item of items) {
          item.reencodeAuthorized = false;
          item.status = signal.aborted ? 'unprocessed' : 'unsupported'; item.reason = error.message;
        }
        this.state.phase = signal.aborted ? 'cancelled' : 'failed'; this.state.error = error.message;
        for (const entry of this.state.items) entry.reencodeAuthorized = false;
        this.plan = null; this.state.planId = null;
      } finally { this.finishedAt = Date.now(); this.emitState(); }
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
    } catch (error) {
      notCancelled(signal);
      this.state.provenanceRecovery = { matching: 0, absent: 0, unrelated: 0, uncertain: 0, warnings: ['Provenance recovery unavailable: ' + error.message] };
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
      const key = item.outputName.toLowerCase();
      if (names.has(key)) throw fail('OUTPUT_CONFLICT', 'Select only one input for each output name.');
      names.add(key);
    }
    for (const item of this.state.items) if (['ready', 'conflict'].includes(item.status)) item.status = selected.has(item.id) ? 'pending' : 'unprocessed';
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
        let stage;
        let invocationId;
        let validatingSource = false;
        try {
          await this.verifyFolders();
          if (await exists(entry.destination)) { item.status = 'skipped'; item.reason = 'Output appeared since preview.'; continue; }
          if (this.plan.reservedPaths.has(entry.destination.toLowerCase())) throw fail('PROTECTED_SOURCE', 'The destination belonged to the baseline input snapshot. It remains protected after disappearance.');
          validatingSource = true;
          await this.assertSourceMatches(entry, signal, 'before-encode', 'Source identity changed since preview.');
          const currentProbe = this.inspect === inspectInput
            ? await inspectMetadata(entry.file, { ffprobe: this.ffprobe, signal, run: this.run })
            : (await this.inspect(entry.file, { ffprobe: this.ffprobe, signal, run: this.run })).probe;
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
          if (entry.overridden && !sameIdentity(this.plan.overrides.get(item.id), await readSourceIdentity(entry.file, { signal }))) {
            throw fail('INPUT_CHANGED', 'The explicit original override no longer matches this file.');
          }
          await this.assertSourceMatches(entry, signal, 'after-provenance-check', 'Source identity changed during the final provenance check.');
          validatingSource = false;
          await this.provenanceJournal.recordIntent({ outputId: entry.outputId, sourceIdentity: entry.fingerprint,
            destination: entry.destination, profileId: this.plan.settings.profileId, generationDescription: entry.generationDescription });
          stage = await createStage(this.plan.output);
          item.status = 'running';
          const owner = this.state.batchId;
          let lastProgress = 0;
          this.state.progress = { fileId: item.id, duration: entry.inspection.duration, percent: null };
          this.emitState();
          const args = [...entry.preparedArgs];
          if (args.at(-1) !== OUTPUT_PLACEHOLDER) throw fail('INVALID_PLAN', 'The prepared output placeholder changed. Prepare again.');
          args[args.length - 1] = stage.file;
          entry.actualArgs = Object.freeze([...args]);
          invocationId = randomUUID();
          await this.recordIncident({ stage: 'invocation', reason: 'ENCODE_STARTED', fileId: item.id, invocationId, context: { executable: this.ffmpeg, argv: args, settings: this.plan.settings } });
          const encodeResult = await this.run(this.ffmpeg, args, { signal, timeoutMs: 0, onProgress: record => {
            if (owner !== this.state.batchId || item.status !== 'running') return;
            const duration = entry.inspection.duration;
            const percent = duration > 0 && record.seconds !== null ? Math.min(99, Math.max(0, record.seconds / duration * 100)) : null;
            this.state.progress = { ...record, fileId: item.id, duration, percent, etaSeconds: record.speed > 0 && duration > 0 ? Math.max(0, (duration - (record.seconds || 0)) / record.speed) : null };
            if (Date.now() - lastProgress > 150) { lastProgress = Date.now(); this.emitState(); }
          } });
          await this.recordIncident({ stage: 'invocation', reason: 'ENCODE_CLOSED', fileId: item.id, invocationId, ...diagnosticStderr(encodeResult), context: { exitCode: 0 } });
          await sealStage(stage);
          const stagedIdentity = await readFileStamp(stage.file);
          if (this.plan.reservedIdentities.has(`${stagedIdentity.dev}:${stagedIdentity.ino}`)) throw fail('PROTECTED_SOURCE', 'A temporary output aliases a protected source.');
          if (signal.aborted) throw fail('CANCELLED', 'Encoding cancelled.');
          const result = await this.run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', stage.file], { signal });
          const outputProbe = parseProbeJson(result.stdout, 'Output validation');
          const marker = classifyMarker(outputProbe);
          if (marker.kind !== 'generated' || marker.outputId !== entry.outputId) throw fail('INVALID_PROVENANCE', 'The completed output does not contain its expected application marker and output ID.');
          if (JSON.stringify(marker.previousGeneration) !== JSON.stringify(entry.generationDescription)) {
            throw fail('INVALID_PROVENANCE', 'The completed output does not contain its expected resolved generation description.');
          }
          const validation = this.verify(entry.inspection, outputProbe, this.plan.settings);
          await this.recordIncident({ stage: 'validation', reason: 'OUTPUT_CHECKED', fileId: item.id, severity: validation.valid ? 'info' : 'error', context: { validation } });
          if (!validation.valid) throw fail('INVALID_OUTPUT', validation.errors.join(' '));
          await markStageValidated(stage);
          item.outputDisposition = { kind: 'validated-staged', published: false };
          validatingSource = true;
          const assessment = await this.assessCompletedSource(entry, signal);
          item.sourceAssessment = assessment;
          await this.recordIncident({ stage: 'validation', reason: 'SOURCE_ASSESSED', fileId: item.id,
            severity: assessment.kind === 'unchanged' ? 'info' : 'warning', context: { assessment } });
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
          if (assessment.kind === 'ctime-only') item.warnings = [assessment.warning];
          validatingSource = false;
          await this.verifyFolders();
          const published = await publishOutput(stage, entry.destination, { signal, atomicOnly: this.plan.sameFolder });
          await this.recordIncident({ stage: 'publication', reason: published ? 'OUTPUT_PUBLISHED' : 'OUTPUT_COLLISION', fileId: item.id,
            severity: !published || assessment.kind === 'ctime-only' ? 'warning' : 'info', context: { destination: entry.destination, published, sourceAssessment: assessment } });
          item.status = published ? 'success' : 'skipped';
          item.outcome = published ? assessment.kind === 'ctime-only' ? 'saved-with-warning' : 'saved' : 'destination-collision';
          item.outputDisposition = { kind: published ? 'published' : 'retained-completed', published, ...(published ? { file: entry.destination } : {}) };
          item.reason = published ? item.warnings?.length ? 'Output saved. ' + item.warnings.map(warning => warning.message).join(' ') : '' : 'Another output won the publication race.';
          if (published) {
            this.state.progress = { ...this.state.progress, percent: 100 };
            try { await this.provenanceJournal.recordPublished(entry.outputId, await readSourceIdentity(entry.destination)); }
            catch (error) { item.reason = [item.reason, 'Output saved; provenance bookkeeping remains pending. ' + error.message].filter(Boolean).join(' '); }
          }
        } catch (error) {
          // Deletion, empty files and failed identity reads are invalidation
          // too; an errno must not leave a misleading authorized UI state.
          if (validatingSource || ['INPUT_CHANGED', 'GENERATED_SOURCE'].includes(error.code)) {
            item.reencodeAuthorized = false;
            entry.reencodeAuthorized = false;
            this.plan.reencodeAuthorizations.delete(item.id);
          }
          item.status = signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
          item.reason = error.message;
          item.reasonCode = error.code || 'OPERATION_FAILED';
          item.details = error.stderr?.slice(-4000);
          if (error.sourceIdentityDiagnostic) item.sourceIdentityDiagnostic = error.sourceIdentityDiagnostic;
          await this.recordIncident({ stage: item.status === 'cancelled' ? 'cancellation' : 'encoding', reason: item.status === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED',
            severity: item.status === 'cancelled' ? 'info' : 'error', fileId: item.id, message: error.message, ...diagnosticStderr(error),
            ...(invocationId ? { invocationId } : {}), context: { code: item.reasonCode, sourceIdentityDiagnostic: item.sourceIdentityDiagnostic,
              exitCode: error.exitCode, signal: error.signal } });
          if (item.status === 'cancelled') break;
          if (sharedFailure(error)) { stoppedByFailure = true; this.state.error = error.message; break; }
        } finally {
          let cleanup;
          try {
            cleanup = await cleanupStage(stage, { protectedIdentities: this.plan.reservedIdentities });
            if (cleanup?.retained) {
              item.cleanup = cleanup;
              item.reason = [item.reason, 'Temporary files retained for safety: ' + cleanup.reason].filter(Boolean).join(' ');
            }
          }
          catch (error) { stoppedByFailure = true; this.state.error = `Could not clean owned temporary output: ${error.message}`; }
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
          await this.recordIncident({ stage: 'publication', reason: 'JOB_DISPOSITION', fileId: item.id, context: {
            name: item.name, outputName: item.outputName, settings: this.plan.settings,
            status: item.status, outcome: item.outcome, outputDisposition: item.outputDisposition, cleanup: item.cleanup,
            warnings: item.warnings, sourceIdentityDiagnostic: item.sourceIdentityDiagnostic } });
          this.emitState();
        }
        if (stoppedByFailure) break;
      }
    } catch (error) {
      stoppedByFailure = true;
      this.state.error = error.message;
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
    if (this.busy) {
      this.state.phase = 'cancelling';
      this.controller.abort();
      this.emitState();
      await this.recordIncident({ stage: 'cancellation', reason: 'CANCELLATION_REQUESTED' });
      await this.taskPromise;
    }
    // A close or renderer loss can arrive during a bounded preference write.
    // Let the exact owned write finish before application shutdown.
    if (this.preferenceMutation) await this.preferenceMutation.catch(() => {});
    await Promise.allSettled([...this.appSettingsMutations]);
    return this.snapshot();
  }
}

module.exports = { EncoderService, objectKeys, sharedFailure };
