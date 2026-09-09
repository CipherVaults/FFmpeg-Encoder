const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PROFILES, validateSettings, selectVideo, buildEncodeArgs } = require('./media.cjs');
const { runTool } = require('./process-runner.cjs');
const { inspectInput, validateOutput } = require('./inspection.cjs');
const { checkCapabilities } = require('./capabilities.cjs');
const { exists, createStage, cleanupStage, publishOutput } = require('./outputs.cjs');
const { readFileStamp, readSourceIdentity, sameStamp, sameIdentity } = require('./source-identity.cjs');
const { StorageEligibility } = require('./storage-eligibility.cjs');
const { InspectionCache } = require('./inspection-cache.cjs');

const BUSY = new Set(['checking', 'preparing', 'running', 'cancelling']);
const EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);
const fail = (code, message) => Object.assign(new Error(message), { code });
const clone = value => structuredClone(value);

function objectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw fail('INVALID_REQUEST', `Expected only: ${keys.join(', ')}.`);
  }
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw fail('INVALID_ID', 'Invalid selection or job identifier.');
  return value;
}
function notCancelled(signal) { if (signal?.aborted) throw fail('CANCELLED', 'Preparation cancelled.'); }
function sharedFailure(error) {
  return ['SPAWN_FAILED', 'ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'OUTPUT_FOLDER_CHANGED'].includes(error.code)
    || /no space left|disk full|cannot load.*nv|driver does not support|no capable devices/i.test(error.stderr || '');
}

class EncoderService extends EventEmitter {
  constructor({ ffmpeg, ffprobe, stateDir, run = runTool, inspect = inspectInput, verify = validateOutput, capabilities = checkCapabilities,
    inspectionCache, storageEligibility }) {
    super();
    Object.assign(this, { ffmpeg, ffprobe, stateDir, run, inspect, verify, capabilities });
    this.folders = new Map();
    this.plan = null;
    this.capabilityResult = null;
    this.state = { revision: 0, batchId: null, phase: 'idle', planId: null, settings: null, items: [], progress: null, counts: {}, elapsedSeconds: 0, error: null };
    this.taskPromise = Promise.resolve();
    this.startedAt = 0;
    this.finishedAt = 0;
    this.inspectionCache = inspectionCache;
    this.cacheInjected = inspectionCache !== undefined;
    this.cacheWarning = null;
    this.storageEligibility = storageEligibility || new StorageEligibility({ run });
    this.identityTail = Promise.resolve();
  }

  get busy() { return BUSY.has(this.state.phase); }
  snapshot() {
    const counts = { success: 0, failed: 0, skipped: 0, cancelled: 0, unprocessed: 0 };
    for (const item of this.state.items) {
      if (item.status === 'unsupported') counts.failed++;
      else if (Object.hasOwn(counts, item.status)) counts[item.status]++;
    }
    return clone({ ...this.state, counts, elapsedSeconds: this.startedAt ? ((this.finishedAt || Date.now()) - this.startedAt) / 1000 : 0 });
  }
  emitState() {
    this.state.revision++;
    this.emit('update', this.snapshot());
  }
  requireIdle() { if (this.busy) throw fail('BUSY', 'Wait for the current operation and cleanup to finish.'); }
  begin(phase) {
    this.controller = new AbortController();
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
    const signal = this.begin('checking');
    this.taskPromise = (async () => {
      try {
        await fs.mkdir(this.stateDir, { recursive: true });
        this.capabilityResult = await this.capabilities({ ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, stateDir: this.stateDir, signal, run: this.run });
        this.state.phase = 'idle';
      } catch (error) {
        this.state.phase = error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        this.state.error = error.message;
      } finally { this.emitState(); }
    })();
    await this.taskPromise;
    if (!this.capabilityResult) throw fail('CAPABILITIES_FAILED', this.state.error || 'Runtime capabilities unavailable.');
    return clone(this.capabilityResult);
  }

  async registerFolder(folder, role) {
    this.requireIdle();
    if (!['input', 'output'].includes(role)) throw fail('INVALID_FOLDER', 'Invalid folder role.');
    const canonical = await fs.realpath(folder);
    if (!(await fs.stat(canonical)).isDirectory()) throw fail('INVALID_FOLDER', 'Select a directory.');
    this.requireIdle();
    for (const [key, entry] of this.folders) if (entry.role === role) this.folders.delete(key);
    const token = randomUUID();
    this.folders.set(token, { path: canonical, role });
    this.plan = null;
    this.state.planId = null;
    return { id: token, path: canonical };
  }

  async initializeInspectionCache(signal) {
    if (this.cacheInjected) return;
    try {
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
    }
  }

  async identifyForInspection(file, signal) {
    // Serialized identity reads avoid uncontrolled seeks on archive HDDs even
    // when decoded inspection later uses more than one worker. Failed tasks do
    // not poison the chain; callers still receive their own error.
    const pending = this.identityTail.then(async () => {
      notCancelled(signal);
      const stamp = await readFileStamp(file);
      if (!this.inspectionCache) return { identity: stamp, reusable: false, reason: this.cacheWarning };
      const storage = await this.storageEligibility.check(file, stamp, { signal });
      notCancelled(signal);
      if (!storage.eligible) return { identity: stamp, reusable: false, reason: storage.reason };
      return { identity: await readSourceIdentity(file, { signal }), reusable: true, reason: null };
    });
    this.identityTail = pending.catch(() => {});
    return pending;
  }

  async sourceStillMatches(entry, signal) {
    notCancelled(signal);
    return entry.fingerprint.sparseDigest
      ? sameIdentity(entry.fingerprint, await readSourceIdentity(entry.file, { signal }))
      : sameStamp(entry.fingerprint, await readFileStamp(entry.file));
  }

  async prepareItem(item, { input, output, settings, profile, caps, signal, owner }) {
    const progress = this.state.preparation;
    notCancelled(signal);
    progress.active++;
    progress.fileId = item.id;
    progress.stage = 'identity';
    this.emitState();
    const file = path.join(input.path, item.name);
    const destination = path.join(output.path, item.outputName);
    try {
      if (await exists(destination)) { item.status = 'skipped'; item.reason = 'Output already exists.'; return; }
      const { identity, reusable, reason } = await this.identifyForInspection(file, signal);
      notCancelled(signal);
      if (reason) progress.notice ||= reason;
      let inspection = reusable ? await this.inspectionCache.lookup(identity) : null;
      notCancelled(signal);
      if (inspection) {
        item.inspectionMethod = 'reused';
        progress.stage = 'reused';
      } else {
        progress.inspected++;
        item.inspectionMethod = 'fresh';
        inspection = await this.inspect(file, { ffprobe: this.ffprobe, signal, run: this.run, onStage: detail => {
          if (signal.aborted || owner !== this.state.batchId || this.state.phase !== 'preparing') return;
          progress.fileId = item.id;
          progress.stage = detail.stage;
          progress.window = detail.window || null;
          this.emitState();
        } });
      }
      notCancelled(signal);
      // Hits are facts about this still-unchanged source, not persistent plans.
      // Current settings/hardware/mapping/destination checks always run anew.
      if (!sameStamp(identity, await readFileStamp(file))) throw fail('INPUT_CHANGED', 'Input changed during inspection.');
      if (item.inspectionMethod === 'reused') progress.reused++;
      if (reusable && item.inspectionMethod === 'fresh') {
        await this.inspectionCache.store(identity, inspection);
        if (this.inspectionCache.warning) progress.notice ||= this.inspectionCache.warning;
      }
      notCancelled(signal);
      if (!inspection.color.supported) throw fail('UNSUPPORTED_COLOR', inspection.color.reasons.join(' '));
      buildEncodeArgs({ input: file, output: destination, settings, probe: inspection.probe, colorEvidence: inspection.color });
      const video = selectVideo(inspection.probe);
      const depth = /(?:10|12)/.exec(video.pix_fmt)?.[0] || '8';
      const capability = caps.profiles.find(entry => entry.id === profile.id);
      if (!capability.supportedBitDepths.includes(Number(depth))) throw fail('UNSUPPORTED_DEPTH', `${profile.label} cannot encode this bit depth on the current device.`);
      this.plan.entries.set(item.id, { file, destination, inspection, fingerprint: identity });
      Object.assign(item, { status: 'ready', summary: inspection.summary, reason: '' });
    } catch (error) {
      if (error.code === 'CANCELLED' || signal.aborted || sharedFailure(error)) throw error;
      item.status = 'unsupported';
      item.reason = error.message;
    } finally {
      progress.active--;
      if (item.status !== 'pending') progress.resolved++;
      if (owner === this.state.batchId) this.emitState();
    }
  }

  async prepareBatch(request) {
    objectKeys(request, ['inputFolderId', 'outputFolderId', 'settings']);
    const settings = validateSettings(request.settings);
    const input = this.folders.get(id(request.inputFolderId));
    const output = this.folders.get(id(request.outputFolderId));
    if (input?.role !== 'input' || output?.role !== 'output') throw fail('INVALID_FOLDER', 'Select both folders again.');
    if (input.path.toLowerCase() === output.path.toLowerCase()) throw fail('SAME_FOLDER', 'Input and output folders must be different.');
    this.requireIdle();
    const caps = await this.getCapabilities();
    this.requireIdle();
    if (!caps.profiles.find(profile => profile.id === settings.profileId)?.available) throw fail('UNAVAILABLE_PROFILE', 'The selected encoder cannot initialize on this computer.');
    const signal = this.begin('preparing');
    this.state.items = [];
    this.state.settings = settings;
    this.plan = { id: randomUUID(), input: input.path, output: output.path, settings, entries: new Map() };
    this.state.planId = this.plan.id;
    this.taskPromise = (async () => {
      try {
        await this.verifyFolders();
        await this.initializeInspectionCache(signal);
        const files = (await fs.readdir(input.path, { withFileTypes: true }))
          .filter(entry => entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: false }) || a.name.localeCompare(b.name));
        if (!files.length) throw fail('NO_INPUTS', 'No supported top-level video files were found.');
        const profile = PROFILES.find(entry => entry.id === settings.profileId);
        this.state.items = files.map(entry => ({ id: randomUUID(), name: entry.name, outputName: `${path.parse(entry.name).name}_${profile.suffix}.mkv`, status: 'pending', reason: '' }));
        this.state.preparation = { total: files.length, resolved: 0, reused: 0, inspected: 0, active: 0, stage: 'identity', fileId: null, notice: this.cacheWarning };
        const context = { input, output, settings, profile, caps, signal, owner: this.state.batchId };
        for (const item of this.state.items) {
          await this.prepareItem(item, context);
        }
        const names = new Map();
        for (const item of this.state.items.filter(entry => entry.status === 'ready')) {
          const key = item.outputName.toLowerCase();
          const group = names.get(key) || [];
          group.push(item); names.set(key, group);
        }
        for (const group of names.values()) if (group.length > 1) for (const item of group) {
          item.status = 'conflict'; item.reason = 'Another input has the same output name. Select only one.';
        }
        this.state.phase = 'ready';
      } catch (error) {
        this.state.phase = signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        this.state.error = error.message;
        for (const item of this.state.items) if (item.status === 'pending') item.status = 'unprocessed';
        this.plan = null;
        this.state.planId = null;
      } finally { this.finishedAt = Date.now(); this.emitState(); }
    })();
    await this.taskPromise;
    return this.snapshot();
  }

  async verifyFolders() {
    try {
      if (await fs.realpath(this.plan.input) !== this.plan.input || await fs.realpath(this.plan.output) !== this.plan.output) {
        throw fail('OUTPUT_FOLDER_CHANGED', 'A selected folder changed. Select the folders again.');
      }
      await fs.access(this.plan.output, require('node:fs').constants.W_OK);
    } catch (error) {
      throw fail('OUTPUT_FOLDER_CHANGED', `A selected folder is unavailable or changed: ${error.message}`);
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
        try {
          await this.verifyFolders();
          if (await exists(entry.destination)) { item.status = 'skipped'; item.reason = 'Output appeared since preview.'; continue; }
          if (!await this.sourceStillMatches(entry, signal)) throw fail('INPUT_CHANGED', 'Input changed since preview. Prepare it again.');
          stage = await createStage(this.plan.output);
          item.status = 'running';
          const owner = this.state.batchId;
          let lastProgress = 0;
          this.state.progress = { fileId: item.id, duration: entry.inspection.duration, percent: null };
          this.emitState();
          const args = buildEncodeArgs({ input: entry.file, output: stage.file, settings: this.plan.settings, probe: entry.inspection.probe, colorEvidence: entry.inspection.color });
          await this.run(this.ffmpeg, args, { signal, timeoutMs: 0, onProgress: record => {
            if (owner !== this.state.batchId || item.status !== 'running') return;
            const duration = entry.inspection.duration;
            const percent = duration > 0 && record.seconds !== null ? Math.min(99, Math.max(0, record.seconds / duration * 100)) : null;
            this.state.progress = { ...record, fileId: item.id, duration, percent, etaSeconds: record.speed > 0 && duration > 0 ? Math.max(0, (duration - (record.seconds || 0)) / record.speed) : null };
            if (Date.now() - lastProgress > 150) { lastProgress = Date.now(); this.emitState(); }
          } });
          if (signal.aborted) throw fail('CANCELLED', 'Encoding cancelled.');
          const result = await this.run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', stage.file], { signal });
          const validation = this.verify(entry.inspection, JSON.parse(result.stdout), this.plan.settings);
          if (!validation.valid) throw fail('INVALID_OUTPUT', validation.errors.join(' '));
          if (!await this.sourceStillMatches(entry, signal)) throw fail('INPUT_CHANGED', 'Input changed while it was being encoded.');
          await this.verifyFolders();
          const published = await publishOutput(stage, entry.destination, { signal });
          item.status = published ? 'success' : 'skipped';
          item.reason = published ? '' : 'Another output won the publication race.';
          if (published) this.state.progress = { ...this.state.progress, percent: 100 };
        } catch (error) {
          item.status = signal.aborted || error.code === 'CANCELLED' ? 'cancelled' : 'failed';
          item.reason = error.message;
          item.details = error.stderr?.slice(-4000);
          if (item.status === 'cancelled') break;
          if (sharedFailure(error)) { stoppedByFailure = true; this.state.error = error.message; break; }
        } finally {
          try { await cleanupStage(stage); }
          catch (error) { stoppedByFailure = true; this.state.error = `Could not clean owned temporary output: ${error.message}`; }
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
      // Bounded per-batch diagnostics are local. They are never sent to a server.
      try {
        const logs = path.join(this.stateDir, 'logs');
        await fs.mkdir(logs, { recursive: true });
        await fs.writeFile(path.join(logs, `${this.state.batchId}.json`), JSON.stringify({ ...this.snapshot(), phase: terminalPhase }, null, 2), { flag: 'wx' });
      } catch (error) { this.state.error ||= `Results could not be logged: ${error.message}`; }
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
      await this.taskPromise;
    }
    return this.snapshot();
  }
}

module.exports = { EncoderService, objectKeys, sharedFailure };
