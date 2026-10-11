'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { POLICY_VERSION, UPLOAD_PIPELINE, NATIVE_PROFILES, getNativeProfile, validateNativeSettings,
  validateTrustedDevice, nativeContribution, validateCapabilityPolicy, capabilityKey, validateCapabilityCell } = require('./backend-adapters.cjs');

// Main-only qualification ownership. Discovery is supplied by main's bounded
// binary/DXGI collectors; no shell, media process, path, IPC, or persistence is
// implemented here. Snapshots are descriptions, never reusable proof. Tests of
// this state machine do not establish that this computer has AMD/Intel support.
const SCHEMA = 1;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROFILE_ENCODERS = NATIVE_PROFILES.map(profile => profile.encoder);
const STATES = ['discovered', 'untested', 'verified', 'unavailable', 'stale'];
const UNTESTED = ['NOT_TESTED', 'RESOURCE_LIMIT', 'CANCELLED', 'PROBE_INTERRUPTED'];
const UNAVAILABLE = ['UNSUPPORTED_CODEC', 'UNSUPPORTED_DEPTH', 'UNSUPPORTED_MODE', 'UNSUPPORTED_PRESET',
  'OUTPUT_MISMATCH', 'MODE_MISMATCH', 'DEVICE_MISMATCH', 'INITIALIZATION_FAILED'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_BACKEND_EVIDENCE', `${label} must be a plain record.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value'))
    || keys.some(key => !Object.hasOwn(descriptors, key))) fail('INVALID_BACKEND_EVIDENCE', `Unknown, missing or accessor fields in ${label}.`);
}
function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_BACKEND_EVIDENCE', `${label} must be an opaque UUID.`);
  return value;
}
function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) fail('INVALID_BACKEND_EVIDENCE', `${label} must be a SHA-256 digest.`);
  return value;
}
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INVALID_BACKEND_EVIDENCE', `${label} is outside its bounded integer range.`);
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function binary(value, name) {
  if (value === null) return null;
  record(value, ['sha256', 'version'], `${name} identity`);
  if (typeof value.version !== 'string' || !new RegExp(`^${name} version [^\\x00-\\x1f\\x7f]{1,512}$`).test(value.version)) {
    fail('INVALID_BACKEND_EVIDENCE', `${name} needs its observed first version line.`);
  }
  return { sha256: hash(value.sha256, `${name} binary hash`), version: value.version };
}
function discovery(value, now) {
  record(value, ['schema', 'evidenceId', 'observedAt', 'runtime', 'wrappers', 'inventory'], 'discovery');
  if (value.schema !== SCHEMA) fail('INVALID_BACKEND_EVIDENCE', 'Unsupported discovery schema.');
  uuid(value.evidenceId, 'Discovery evidence ID');
  integer(value.observedAt, 0, Math.min(8640000000000000, now + 5000), 'Discovery time');
  record(value.runtime, ['ffmpeg', 'ffprobe'], 'runtime identities');
  const runtime = { ffmpeg: binary(value.runtime.ffmpeg, 'ffmpeg'), ffprobe: binary(value.runtime.ffprobe, 'ffprobe') };
  record(value.wrappers, PROFILE_ENCODERS, 'wrapper observations');
  const wrappers = {};
  for (const encoder of PROFILE_ENCODERS) {
    const state = value.wrappers[encoder];
    if (!['present', 'absent', 'unobserved'].includes(state)) fail('INVALID_BACKEND_EVIDENCE', 'Wrapper observation must be present, absent or unobserved.');
    wrappers[encoder] = state;
  }
  record(value.inventory, ['status', 'devices'], 'device inventory');
  const deviceDescriptors = Array.isArray(value.inventory.devices) ? Object.getOwnPropertyDescriptors(value.inventory.devices) : null;
  if (!['complete', 'partial', 'unavailable'].includes(value.inventory.status) || !Array.isArray(value.inventory.devices)
    || value.inventory.devices.length > 32 || Reflect.ownKeys(deviceDescriptors).some(key => key !== 'length'
      && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.inventory.devices.length || !Object.hasOwn(deviceDescriptors[key], 'value')))
    || Object.keys(value.inventory.devices).length !== value.inventory.devices.length
    || (value.inventory.status === 'unavailable' && value.inventory.devices.length)) fail('INVALID_BACKEND_EVIDENCE', 'Device discovery must be bounded and explicitly complete, partial or unavailable.');
  const devices = [], ids = new Set(), adapters = new Set(), indexes = new Set();
  for (const item of value.inventory.devices) {
    record(item, ['id', 'backend', 'vendorId', 'adapterIndex', 'adapterIdentity', 'driverVersion', 'runtimeVersion'], 'discovered device');
    const device = validateTrustedDevice(item, item.backend);
    if (ids.has(device.id) || adapters.has(device.adapterIdentity) || indexes.has(device.adapterIndex)) {
      fail('INVALID_BACKEND_EVIDENCE', 'Device discovery has duplicate IDs, adapter identities or DXGI indexes.');
    }
    ids.add(device.id); adapters.add(device.adapterIdentity); indexes.add(device.adapterIndex); devices.push(device);
  }
  return freeze({ schema: SCHEMA, evidenceId: value.evidenceId, observedAt: value.observedAt, runtime, wrappers,
    inventory: { status: value.inventory.status, devices } });
}
function bind(request, observation) {
  record(request, ['operation', 'profileId', 'settings', 'bitDepth', 'transformId', 'signal', 'container'], 'native cell request');
  if (request.operation !== 'encode') fail('UNSUPPORTED_BACKEND_OPERATION', 'Native encoder qualification only applies to Encode.');
  const profile = getNativeProfile(request.profileId), settings = validateNativeSettings(request.profileId, request.settings);
  if (!observation?.runtime.ffmpeg || !observation.runtime.ffprobe) fail('NATIVE_RUNTIME_UNAVAILABLE', 'Both exact bundled runtime identities must be observed first.');
  const device = observation.inventory.devices.find(item => item.id === settings.deviceId);
  if (!device) fail('NATIVE_DEVICE_UNAVAILABLE', 'The chosen device is not in the current main-owned adapter inventory.');
  const policy = validateCapabilityPolicy({ policyVersion: POLICY_VERSION, ffmpegSha256: observation.runtime.ffmpeg.sha256,
    ffprobeSha256: observation.runtime.ffprobe.sha256, device, profileId: profile.id,
    preset: settings.preset, mode: settings.mode, bitDepth: request.bitDepth, pipelineId: UPLOAD_PIPELINE,
    transformId: request.transformId, signal: request.signal, container: request.container });
  // Unlike the adapter's general syntax/policy key, activation here binds the
  // exact quality controls too. One tested seed grants no untested QP range.
  const measuredSettings = { preset: settings.preset, mode: settings.mode, quality: settings.quality };
  const key = `native-registry-v${SCHEMA}:` + digest({ operation: 'encode', policyKey: capabilityKey(policy), settings: measuredSettings });
  return { key, policy, settings, operation: 'encode', request: freeze({ operation: 'encode', profileId: profile.id, settings,
    bitDepth: policy.bitDepth, transformId: policy.transformId, signal: policy.signal, container: policy.container }) };
}
function staleReason(row, observed) {
  if (!observed.runtime.ffmpeg || !observed.runtime.ffprobe) return 'RUNTIME_CHANGED';
  if (row.policy.ffmpegSha256 !== observed.runtime.ffmpeg.sha256 || row.policy.ffprobeSha256 !== observed.runtime.ffprobe.sha256) return 'BINARY_CHANGED';
  const current = observed.inventory.devices.find(device => device.id === row.settings.deviceId);
  if (!current || current.adapterIdentity !== row.policy.device.adapterIdentity || current.adapterIndex !== row.policy.device.adapterIndex
    || current.backend !== row.policy.device.backend || current.vendorId !== row.policy.device.vendorId) return 'DEVICE_CHANGED';
  if (current.driverVersion !== row.policy.device.driverVersion) return 'DRIVER_CHANGED';
  if (current.runtimeVersion !== row.policy.device.runtimeVersion || observed.wrappers[getNativeProfile(row.policy.profileId).encoder] !== 'present') return 'RUNTIME_CHANGED';
  return null;
}
function identityKnown(device) {
  return ![device.adapterIdentity, device.driverVersion, device.runtimeVersion].some(value => /^(unknown|unavailable|unresolved|not-detected)$/i.test(value));
}
function closedLifecycle(value) {
  record(value, ['encode', 'decode'], 'probe process lifecycle');
  if (![value.encode, value.decode].every(state => ['not-started', 'closed'].includes(state))) {
    fail('PROBE_CHILD_NOT_CLOSED', 'The owner must wait for every started child to close before completing the probe.');
  }
  return value;
}

class NativeCapabilityRegistry {
  #now; #maxCells; #observed = null; #epoch = 0; #cells = new Map(); #keys = new Map(); #active = null; #receipts = new WeakMap();
  constructor({ now = Date.now, maxCells = 256 } = {}) {
    if (typeof now !== 'function') fail('INVALID_BACKEND_EVIDENCE', 'A clock function is required.');
    this.#now = now; this.#maxCells = integer(maxCells, 1, 2048, 'Cell capacity');
  }
  #time() { return integer(this.#now(), 0, 8640000000000000, 'Current observation time'); }
  #row(cellId) {
    uuid(cellId, 'Cell ID'); const row = this.#cells.get(cellId);
    if (!row) fail('UNKNOWN_CAPABILITY_CELL', 'That capability cell is not owned by this session.');
    return row;
  }
  #change(row, state, reason, evidence = null) {
    row.state = state; row.reason = reason; row.evidence = evidence; row.checkedAt = this.#time(); row.revision++;
  }
  #view(row) {
    return freeze({ schema: SCHEMA, cellId: row.cellId, key: row.key, revision: row.revision, operation: row.operation,
      policy: row.policy, settings: row.settings, state: row.state, reason: row.reason, checkedAt: row.checkedAt,
      evidenceId: row.evidence?.evidenceId || null, qualificationScope: row.evidence ? 'exact-settings-96-frame-SDR-encode-decode' : null,
      available: row.state === 'verified', probeActive: this.#active?.cellId === row.cellId });
  }
  observeDiscovery(input) {
    const observed = discovery(input, this.#time());
    if (this.#observed && observed.observedAt < this.#observed.observedAt) fail('STALE_DISCOVERY', 'Older discovery cannot replace newer evidence.');
    if (this.#observed?.evidenceId === observed.evidenceId) {
      if (digest(observed) !== digest(this.#observed)) fail('DISCOVERY_ID_REUSED', 'One discovery ID cannot describe different observations.');
      return this.snapshot();
    }
    this.#observed = observed; this.#epoch++;
    for (const row of this.#cells.values()) {
      const reason = staleReason(row, observed);
      if (reason) this.#change(row, 'stale', reason);
    }
    // An in-flight child is still owned after discovery changes. Its ticket is
    // not released here; completion must prove close and rejects the old epoch.
    return this.snapshot();
  }
  ensureCell(request) {
    const bound = bind(request, this.#observed), existing = this.#keys.get(bound.key);
    if (existing) {
      const row = this.#row(existing);
      // Refreshing opaque device handles cannot restore an old verified cell.
      if (row.settings.deviceId !== bound.settings.deviceId) {
        Object.assign(row, bound); this.#change(row, 'stale', 'DEVICE_CHANGED');
      }
      return this.#view(row);
    }
    if (this.#cells.size >= this.#maxCells) fail('CAPABILITY_REGISTRY_FULL', 'The bounded capability registry is full; no cell was evicted or implicitly authorized.');
    const wrapper = this.#observed.wrappers[getNativeProfile(bound.policy.profileId).encoder];
    const state = wrapper === 'present' && identityKnown(bound.policy.device) ? 'discovered' : wrapper === 'absent' ? 'unavailable' : 'untested';
    const row = { ...bound, cellId: randomUUID(), revision: 1, state,
      reason: state === 'discovered' ? 'DISCOVERED' : state === 'unavailable' ? 'UNSUPPORTED_CODEC' : 'NOT_TESTED',
      checkedAt: this.#observed.observedAt, evidence: null };
    this.#cells.set(row.cellId, row); this.#keys.set(row.key, row.cellId); return this.#view(row);
  }
  getCell(request) { record(request, ['cellId'], 'cell read'); return this.#view(this.#row(request.cellId)); }
  snapshot() {
    const profiles = NATIVE_PROFILES.map(profile => {
      const observed = this.#observed, devices = observed?.inventory.devices.filter(device => device.backend === profile.backend) || [];
      let state = 'untested', reason = 'DISCOVERY_NOT_OBSERVED';
      if (observed) {
        if (!observed.runtime.ffmpeg || !observed.runtime.ffprobe) { state = 'unavailable'; reason = 'MISSING_RUNTIME'; }
        else if (observed.wrappers[profile.encoder] === 'absent') { state = 'unavailable'; reason = 'UNSUPPORTED_CODEC'; }
        else if (!devices.length && observed.inventory.status === 'complete') { state = 'unavailable'; reason = 'MISSING_DEVICE'; }
        else if (!devices.length) reason = 'DEVICE_DISCOVERY_INCOMPLETE';
        else if (observed.wrappers[profile.encoder] !== 'present') reason = 'WRAPPER_UNOBSERVED';
        else { state = 'discovered'; reason = 'CHOOSE_AND_QUALIFY_CELL'; }
      }
      return { profileId: profile.id, backend: profile.backend, encoder: profile.encoder, state, reason, available: false,
        deviceIds: devices.map(device => device.id), note: 'Discovery is not encoding support. Select a device and qualify the exact settings; no fallback is chosen.' };
    });
    return freeze({ schema: SCHEMA, discoveryEvidenceId: this.#observed?.evidenceId || null, profiles,
      cells: [...this.#cells.values()].map(row => this.#view(row)), activeProbeId: this.#active?.probeId || null,
      persistence: 'session-only; serialized snapshots do not restore qualification authority' });
  }
  beginProbe(request) {
    record(request, ['cellId'], 'probe request');
    if (this.#active) fail('PROBE_BUSY', 'One native capability probe is already owned; wait for its children to close.');
    const row = this.#row(request.cellId), wrapper = this.#observed.wrappers[getNativeProfile(row.policy.profileId).encoder];
    if (wrapper !== 'present') fail('NATIVE_WRAPPER_UNAVAILABLE', wrapper === 'absent'
      ? 'The selected encoder wrapper is absent from this exact runtime.' : 'The selected encoder wrapper has not been observed in this exact runtime.');
    const reason = staleReason(row, this.#observed);
    if (reason) { this.#change(row, 'stale', reason); fail('CAPABILITY_STALE', 'Discover and select the current runtime/device cell before probing.'); }
    if (!identityKnown(row.policy.device)) fail('NATIVE_IDENTITY_UNRESOLVED', 'Observed adapter, driver and runtime identities are required before qualification.');
    // HDR and media transforms need their own fixture/oracle, not a relabelled
    // SDR test. Their cells can be represented but cannot be enabled here.
    if (row.policy.signal !== 'sdr' || row.policy.transformId !== 'none-v1') {
      fail('PROBE_PLAN_NOT_IMPLEMENTED', 'This foundation qualifies SDR without media transforms only. The requested HDR/transform probe has not been implemented.');
    }
    const contribution = nativeContribution(row.policy.profileId, row.settings,
      { device: row.policy.device, bitDepth: row.policy.bitDepth, pipelineId: row.policy.pipelineId });
    const fixture = { id: 'native-sdr-color-motion-v1', width: 320, height: 180, frameRateNumerator: 30, frameRateDenominator: 1,
      frames: 96, pixelFormat: row.policy.bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', bitDepth: row.policy.bitDepth,
      color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv' } };
    const probeId = randomUUID(), invocationId = randomUUID(), startedAt = this.#time();
    const contributionHash = digest({ contribution, fixture });
    const plan = freeze({ schema: SCHEMA, probeId, invocationId, cellId: row.cellId, cellKey: row.key,
      operation: 'encode', policy: row.policy, settings: row.settings, contribution, contributionHash, fixture,
      limits: { encodeTimeoutMs: 30000, decodeTimeoutMs: 20000, metadataTimeoutMs: 10000,
        stdoutBytes: 1024 * 1024, stderrBytes: 256 * 1024, maxOutputBytes: 32 * 1024 * 1024 },
      execution: 'Plan only. Main must reserve isolated owned paths, run fixed binaries sequentially without shell/fallback, enforce bounds, fully validate, and await close.',
      scope: 'Functional exact-settings SDR encode/decode only; not perceptual quality, stream-preservation, HDR, transformed-media or packaged acceptance.' });
    this.#change(row, 'untested', 'NOT_TESTED');
    const ticket = { probeId, invocationId, cellId: row.cellId, epoch: this.#epoch, startedAt, contributionHash, plan };
    this.#active = ticket;
    // Give this closure ONLY to main's native evidence collector, never preload.
    // A JSON object copied from disk/renderer cannot reproduce its WeakMap brand.
    const issueReceipt = observed => {
      if (this.#active !== ticket) fail('PROBE_TICKET_EXPIRED', 'That probe is no longer active.');
      record(observed, ['outcome', 'reason', 'evidenceId', 'environment', 'lifecycle', 'validation'], 'native observation');
      closedLifecycle(observed.lifecycle);
      const environment = discovery(observed.environment, this.#time());
      uuid(observed.evidenceId, 'Native evidence ID');
      if (!['verified', 'unavailable', 'untested'].includes(observed.outcome)) fail('INVALID_BACKEND_EVIDENCE', 'Unknown probe outcome.');
      const reasons = observed.outcome === 'verified' ? ['VERIFIED'] : observed.outcome === 'untested' ? UNTESTED : UNAVAILABLE;
      if (typeof observed.reason !== 'string' || !reasons.includes(observed.reason)) fail('INVALID_BACKEND_EVIDENCE', 'Unknown reason for that probe outcome.');
      // Validation is normalized below before storage; hostile descriptors and
      // arbitrary nested objects cannot enter retained evidence through cloning.
      const validation = observed.validation === null ? null : this.#validationShape(observed.validation);
      const data = freeze({ outcome: observed.outcome, reason: observed.reason, evidenceId: observed.evidenceId,
        environment, lifecycle: { ...observed.lifecycle }, validation });
      const receipt = Object.freeze({ schema: SCHEMA, probeId });
      this.#receipts.set(receipt, { ticket, data }); return receipt;
    };
    // A failed/cancelled collector may be unable to obtain fresh discovery.
    // This main-only closure can release ownership without inventing evidence;
    // it never creates a verified receipt and still requires child closure.
    const abandon = value => {
      if (this.#active !== ticket) fail('PROBE_TICKET_EXPIRED', 'That probe is no longer active.');
      record(value, ['reason', 'lifecycle'], 'abandoned probe');
      closedLifecycle(value.lifecycle);
      if (!UNTESTED.includes(value.reason)) fail('INVALID_BACKEND_EVIDENCE', 'Abandonment requires an untested outcome.');
      this.#active = null;
      if (row.state !== 'stale') this.#change(row, 'untested', value.reason);
      return this.#view(row);
    };
    return Object.freeze({ plan, issueReceipt, abandon });
  }
  #validationShape(value) {
    record(value, ['invocationId', 'contributionHash', 'argvSha256', 'fixtureSha256', 'warningCaptureComplete',
      'unexpectedWarnings', 'modeSource', 'actualMode', 'actualEncoder', 'actualAdapterIdentity', 'output'], 'native validation');
    record(value.output, ['codec', 'bitDepth', 'width', 'height', 'frames', 'decodedFrames', 'chroma', 'signal',
      'primaries', 'transfer', 'matrix', 'range', 'valid'], 'native output validation');
    const primitive = (item, label) => {
      if (!['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'string' && item.length > 256)
        || (typeof item === 'number' && !Number.isFinite(item))) fail('INVALID_BACKEND_EVIDENCE', `Invalid bounded primitive in ${label}.`);
      return item;
    };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'output'
      ? Object.fromEntries(Object.entries(item).map(([name, field]) => [name, primitive(field, name)])) : primitive(item, key)]));
  }
  completeProbe(request) {
    record(request, ['probeId', 'receipt'], 'probe completion'); uuid(request.probeId, 'Probe ID');
    const owned = request.receipt && this.#receipts.get(request.receipt), ticket = this.#active;
    if (!ticket || request.probeId !== ticket.probeId || owned?.ticket !== ticket) fail('UNTRUSTED_NATIVE_RECEIPT', 'Only the current main-owned probe collector can supply a qualification receipt.');
    const { data } = owned, row = this.#row(ticket.cellId);
    // issueReceipt already requires terminal lifecycle states. At this point
    // clearing the ticket cannot orphan a declared running encode/decode child.
    this.#receipts.delete(request.receipt); this.#active = null;
    try {
      if (ticket.epoch !== this.#epoch || data.environment.observedAt < ticket.startedAt
        || data.environment.evidenceId === this.#observed.evidenceId) fail('CAPABILITY_STALE', 'Qualification needs a fresh post-probe runtime/device observation from the same current discovery epoch.');
      const changed = staleReason(row, data.environment);
      if (changed) { this.#change(row, 'stale', changed); fail('CAPABILITY_STALE', 'The binary/device/driver/runtime changed while the probe was running.'); }
      if (data.outcome !== 'verified') {
        const reasons = data.outcome === 'untested' ? UNTESTED : UNAVAILABLE;
        if (!reasons.includes(data.reason) || data.validation !== null) fail('INVALID_BACKEND_EVIDENCE', 'Failure outcome must have its precise allowed reason and no success validation.');
        this.#change(row, data.outcome, data.reason); return this.#view(row);
      }
      if (data.reason !== 'VERIFIED' || data.lifecycle.encode !== 'closed' || data.lifecycle.decode !== 'closed' || !data.validation) {
        fail('INVALID_NATIVE_EVIDENCE', 'Verification requires both actual encode and complete decode to have closed.');
      }
      const v = data.validation;
      if (v.invocationId !== ticket.invocationId || v.contributionHash !== ticket.contributionHash
        || v.warningCaptureComplete !== true || v.unexpectedWarnings !== 0) fail('INVALID_NATIVE_EVIDENCE', 'Exact invocation/contribution and complete clean warning evidence are required.');
      hash(v.argvSha256, 'Executed argument digest'); hash(v.fixtureSha256, 'Owned fixture digest');
      const o = v.output;
      if (o.primaries !== 'bt709' || o.transfer !== 'bt709' || o.matrix !== 'bt709' || o.range !== 'tv') fail('INVALID_NATIVE_EVIDENCE', 'SDR output signaling must match the defined fixture.');
      const baseKey = capabilityKey(row.policy);
      const nativeCell = validateCapabilityCell({ schema: 1, key: baseKey, state: 'verified', reason: 'VERIFIED', checkedAt: data.environment.observedAt,
        evidence: { kind: 'native-hardware', policyKey: baseKey, evidenceId: data.evidenceId, invocationId: ticket.invocationId,
          modeSource: v.modeSource, actualMode: v.actualMode, actualEncoder: v.actualEncoder, actualAdapterIdentity: v.actualAdapterIdentity,
          encodeClosed: true, decodeClosed: true, output: { codec: o.codec, bitDepth: o.bitDepth, width: o.width, height: o.height,
            frames: o.frames, decodedFrames: o.decodedFrames, chroma: o.chroma, signal: o.signal, valid: o.valid } } }, row.policy);
      this.#change(row, 'verified', 'VERIFIED', freeze({ evidenceId: data.evidenceId, environmentEvidenceId: data.environment.evidenceId,
        argvSha256: v.argvSha256, fixtureSha256: v.fixtureSha256, contributionHash: ticket.contributionHash, nativeCell }));
      return this.#view(row);
    } catch (error) {
      if (row.state !== 'stale') this.#change(row, error.code === 'CAPABILITY_STALE' ? 'stale' : 'untested',
        error.code === 'CAPABILITY_STALE' ? 'IDENTITY_CHANGED' : 'NOT_TESTED');
      throw error;
    }
  }
  requireVerified(request) {
    record(request, ['cellId', 'revision'], 'capability admission');
    const row = this.#row(request.cellId);
    integer(request.revision, 1, Number.MAX_SAFE_INTEGER, 'Cell revision');
    // The service must refresh discovery at native job admission and use this
    // exact cell revision in its immutable plan. This pure module cannot detect
    // a driver swap that its main-owned collectors have not yet observed.
    const changed = row.state === 'verified' ? staleReason(row, this.#observed) : null;
    if (changed && row.state !== 'stale') this.#change(row, 'stale', changed);
    if (row.revision !== request.revision || row.state !== 'verified' || !row.evidence) {
      fail('NATIVE_CAPABILITY_UNVERIFIED', 'The exact requested cell is not currently verified at this revision. No backend or quality fallback is chosen.');
    }
    validateCapabilityCell(row.evidence.nativeCell, row.policy);
    return this.#view(row);
  }
}

module.exports = { NativeCapabilityRegistry, SCHEMA, STATES };
