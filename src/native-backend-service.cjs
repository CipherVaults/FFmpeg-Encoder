'use strict';

const { randomUUID } = require('node:crypto');
const { NativeCapabilityRegistry } = require('./backend-capabilities.cjs');
const { getNativeProfile, validateNativeSettings, NATIVE_PROFILES } = require('./backend-adapters.cjs');

// Main-private orchestration only. Construction and snapshots run no collector.
// Main injects the real discovery/probe owners and their shared media lease.
// This service never grants file applicability, Start, publication or raw IPC.
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function record(value, allowed, required = allowed) {
  if (!plain(value)) fail('INVALID_NATIVE_REQUEST', 'A native request must be an inert record.');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !allowed.includes(key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))
      || required.some(key => !Object.hasOwn(fields, key))) fail('INVALID_NATIVE_REQUEST', 'Unknown, missing or accessor native request fields.');
}
function inert(value, depth = 0, count = { nodes: 0 }) {
  if (++count.nodes > 64 || depth > 4) fail('INVALID_NATIVE_REQUEST', 'Native choices exceed their structural bound.');
  if (typeof value === 'string') { if (!value.length || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_NATIVE_REQUEST', 'Invalid native choice text.'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('INVALID_NATIVE_REQUEST', 'Native numbers must be finite.'); return; }
  if (!plain(value)) fail('INVALID_NATIVE_REQUEST', 'Native choices must contain only plain records and primitive values.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_NATIVE_REQUEST', 'Native choices cannot contain accessors or hidden fields.');
    inert(d.value, depth + 1, count);
  }
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function signalCheck(signal) { if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_NATIVE_REQUEST', 'Main must supply a native cancellation signal.'); }
function cancelled(signal) { if (signal?.aborted) fail('CANCELLED', 'Native backend work was cancelled.'); }

class NativeBackendService {
  #registry; #discover; #probe; #active = null; #pending = null;
  #devices = [];
  #revision = 0; #epoch = 0; #selection = null; #qualification = null; #last = null; #ownerBlock = null;
  constructor(options) {
    record(options, ['registry', 'discover', 'createProbe'], ['discover', 'createProbe']);
    if (typeof options.discover !== 'function' || typeof options.createProbe !== 'function') fail('INVALID_NATIVE_REQUEST', 'Main-owned discovery and probe factory are required.');
    const registry = options.registry === undefined ? new NativeCapabilityRegistry() : options.registry;
    if (!(registry instanceof NativeCapabilityRegistry)) fail('INVALID_NATIVE_REQUEST', 'A genuine session capability registry is required.');
    this.#registry = registry; this.#discover = options.discover;
    this.#probe = options.createProbe({ registry, observeEnvironment: options => this.#observe(options) });
    if (!this.#probe || typeof this.#probe.initialize !== 'function' || typeof this.#probe.probe !== 'function') fail('INVALID_NATIVE_REQUEST', 'The main probe owner must expose initialize and probe.');
  }
  #idle() {
    if (this.#active) fail('NATIVE_BACKEND_BUSY', 'Wait for native discovery or qualification to finish closing.');
    if (this.#ownerBlock) fail('NATIVE_OWNER_UNSETTLED', 'The prior native owner did not establish complete release; recover its lease before creating a new session.');
  }
  #revisionIs(value) { if (!Number.isSafeInteger(value) || value !== this.#revision) fail('STALE_NATIVE_SELECTION', 'Native choices changed; inspect the current revision.'); }
  #chosen(request) {
    record(request, ['selectionId', 'revision']); inert(request); this.#revisionIs(request.revision);
    if (!this.#selection || request.selectionId !== this.#selection.selectionId) fail('STALE_NATIVE_SELECTION', 'That native selection does not belong to the current session.');
    return this.#selection;
  }
  #drop() { this.#selection = null; this.#qualification = null; this.#epoch++; this.#revision++; }
  #view() {
    const native = this.#registry.snapshot();
    let cell = null, probeVerified = false;
    if (this.#selection) {
      cell = this.#registry.getCell({ cellId: this.#selection.cellId });
      probeVerified = Boolean(this.#qualification && this.#qualification.epoch === this.#epoch
        && this.#qualification.selectionId === this.#selection.selectionId
        && this.#qualification.cellId === cell.cellId && this.#qualification.cellRevision === cell.revision && cell.state === 'verified');
    }
    return freeze({ schema: 1, revision: this.#revision, busy: Boolean(this.#active), phase: this.#active?.kind || 'idle',
      native, controls: NATIVE_PROFILES, devices: this.#devices,
      selection: this.#selection ? { selectionId: this.#selection.selectionId, request: this.#selection.request, cell, probeVerified } : null,
      lastOutcome: this.#last, ownerBlock: this.#ownerBlock, beta: true, fileExecutionReady: false,
      scope: 'Session-only exact-settings SDR/no-transform probe coordination; no source-file or publication authority.' });
  }
  snapshot() { return this.#view(); }
  async #observe(options = {}) {
    cancelled(options.signal);
    const observed = await this.#discover({ ...options, registry: this.#registry });
    cancelled(options.signal);
    if (!observed || observed.registry !== this.#registry || !plain(observed.environment)) fail('NATIVE_DISCOVERY_OWNER_MISMATCH', 'Discovery must belong to this registry and current session.');
    this.#registry.observeDiscovery(observed.environment);
    this.#devices = observed.environment.inventory.devices.map(device => ({ id: device.id, backend: device.backend,
      description: observed.display?.devices?.find(row => row.id === device.id)?.description || `${device.backend.toUpperCase()} adapter`,
      driverVersion: device.driverVersion }));
    return observed.environment;
  }
  #begin(kind, signal) {
    this.#idle(); signalCheck(signal); cancelled(signal);
    const controller = new AbortController(), relay = () => controller.abort();
    signal?.addEventListener('abort', relay, { once: true });
    if (signal?.aborted) controller.abort();
    const active = { kind, controller, signal, relay, epoch: this.#epoch }; this.#active = active;
    return active;
  }
  #settle(active) {
    active.signal?.removeEventListener('abort', active.relay);
    if (this.#active === active) this.#active = null;
  }
  async refresh({ signal } = {}) {
    const active = this.#begin('discovering', signal);
    const pending = (async () => {
      try {
        await this.#observe({ signal: active.controller.signal }); cancelled(active.controller.signal);
        this.#drop(); this.#last = { status: 'observed', reason: 'DISCOVERY_ONLY_NO_EXECUTION_GRANT' };
      } catch (error) { this.#drop(); this.#last = { status: 'untested', reason: error.code || 'DISCOVERY_FAILED' }; throw error; }
      finally { this.#settle(active); }
      return this.#view();
    })();
    this.#pending = pending;
    try { return await pending; } finally { if (this.#pending === pending) this.#pending = null; }
  }
  select(request) {
    this.#idle(); record(request, ['revision', 'profileId', 'settings', 'bitDepth']); inert(request); this.#revisionIs(request.revision);
    const profile = getNativeProfile(request.profileId), settings = validateNativeSettings(profile.id, request.settings);
    if (![8, 10].includes(request.bitDepth)) fail('INVALID_NATIVE_REQUEST', 'Choose an explicit supported native bit depth.');
    const cellRequest = freeze({ operation: 'encode', profileId: profile.id, settings, bitDepth: request.bitDepth,
      transformId: 'none-v1', signal: 'sdr', container: 'matroska' });
    const cell = this.#registry.ensureCell(cellRequest);
    this.#drop(); this.#selection = { selectionId: randomUUID(), request: cellRequest, cellId: cell.cellId };
    this.#last = null; return this.#view();
  }
  async qualify(request, { signal } = {}) {
    this.#idle(); const chosen = this.#chosen(request), active = this.#begin('qualifying', signal);
    this.#qualification = null;
    const pending = (async () => {
      let awaitingOwner = false;
      try {
        const profile = getNativeProfile(chosen.request.profileId);
        // This missing same-component producer is not a missing-hardware claim.
        // Refuse before initializer/media scheduling; no helper session substitutes.
        if (profile.backend === 'amf') {
          this.#last = { status: 'untested', reason: 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED' };
          return;
        }
        awaitingOwner = true;
        const initial = await this.#probe.initialize({ cellId: chosen.cellId }, { signal: active.controller.signal });
        awaitingOwner = false;
        if (initial?.slotReleaseFailure || initial?.reason === 'INITIALIZATION_SLOT_UNRELEASED') {
          this.#ownerBlock = 'INITIALIZATION_SLOT_UNRELEASED'; fail('NATIVE_OWNER_UNSETTLED', 'Native initialization did not release its media owner.');
        }
        cancelled(active.controller.signal);
        if (this.#selection !== chosen || this.#epoch !== active.epoch) fail('STALE_NATIVE_SELECTION', 'Native choices were invalidated during initialization.');
        if (initial?.status !== 'observed' || !initial.initialization || initial.failure) {
          this.#last = { status: 'untested', reason: typeof initial?.reason === 'string' ? initial.reason.slice(0, 128) : 'INITIALIZATION_UNOBSERVED',
            ...(initial?.persistenceFailure ? { persistenceFailure: 'NATIVE_INITIALIZATION_NOT_RETAINED' } : {}) };
          return;
        }
        // A bootstrap receipt is consumed only by genuine current discovery.
        // Its new API identity can stale the preliminary cell; select a new one.
        await this.#observe({ signal: active.controller.signal, initialization: initial.initialization });
        cancelled(active.controller.signal);
        if (this.#selection !== chosen || this.#epoch !== active.epoch) fail('STALE_NATIVE_SELECTION', 'Native choices were invalidated during discovery.');
        const cell = this.#registry.ensureCell(chosen.request); chosen.cellId = cell.cellId;
        awaitingOwner = true;
        const result = await this.#probe.probe({ cellId: cell.cellId }, { signal: active.controller.signal });
        awaitingOwner = false;
        if (result?.slotReleaseFailure) { this.#ownerBlock = 'PROBE_SLOT_UNRELEASED'; fail('NATIVE_OWNER_UNSETTLED', 'Native qualification did not release its media owner.'); }
        if (result?.persistenceFailure || result?.failure) fail('NATIVE_PROBE_EVIDENCE_INCOMPLETE', 'Native qualification has an unresolved evidence/persistence failure.');
        cancelled(active.controller.signal);
        if (this.#selection !== chosen || this.#epoch !== active.epoch) fail('STALE_NATIVE_SELECTION', 'Native choices were invalidated during qualification.');
        const current = this.#registry.getCell({ cellId: chosen.cellId });
        if (result?.status === 'verified') {
          this.#registry.requireVerified({ cellId: current.cellId, revision: current.revision });
          // An older genuine registry row is not proof of this attempt. The
          // completed probe must advance both the exact cell and its evidence,
          // with the returned report bound to that same current invocation.
          if (current.revision <= cell.revision || !current.evidenceId || current.evidenceId === cell.evidenceId
              || result.evidenceId !== current.evidenceId || result.cellId !== current.cellId) {
            fail('NATIVE_PROBE_EVIDENCE_STALE', 'The native probe did not return fresh evidence for this exact cell and attempt.');
          }
          this.#qualification = { selectionId: chosen.selectionId, epoch: this.#epoch, cellId: current.cellId, cellRevision: current.revision };
        }
        this.#last = { status: current.state, reason: current.reason };
      } catch (error) {
        // A rejected owner promise may not have returned closure/release facts.
        // Do not turn its rejection into permission for a second native owner.
        if (awaitingOwner) this.#ownerBlock = 'NATIVE_OWNER_REJECTED_WITHOUT_RELEASE_REPORT';
        this.#qualification = null;
        this.#last = { status: 'untested', reason: active.controller.signal.aborted ? 'CANCELLED' : error.code || 'NATIVE_QUALIFICATION_FAILED' };
        throw error;
      } finally { this.#revision++; this.#settle(active); }
    })();
    this.#pending = pending;
    try { await pending; return this.#view(); } finally { if (this.#pending === pending) this.#pending = null; }
  }
  requireProbeVerified(request) {
    this.#idle(); const selected = this.#chosen(request), view = this.#view();
    if (!view.selection?.probeVerified) fail('NATIVE_CAPABILITY_UNVERIFIED', 'This current selection has no completed genuine exact-cell probe.');
    const cell = this.#registry.getCell({ cellId: selected.cellId });
    return this.#registry.requireVerified({ cellId: cell.cellId, revision: cell.revision });
  }
  async invalidate() {
    const pending = this.#pending, active = this.#active;
    this.#drop(); if (active) active.controller.abort();
    // The injected real probe promise retains child/slot ownership through close.
    // Invalidating choices never makes another operation schedulable before it settles.
    if (pending) await pending.catch(() => {});
    return this.#view();
  }
}

module.exports = { NativeBackendService };
