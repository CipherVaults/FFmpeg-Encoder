'use strict';

const path = require('node:path');
const { ToolError } = require('./process-runner.cjs');
const { validateSettings, PROFILES } = require('./media.cjs');
const { assertEncodeOperationPlan } = require('./encode-operation.cjs');

// Main-only applicability, not discovery or a serialized execution grant. Main
// supplies independently verified cells and current bounded source observations.
// This module reads no source/runtime/evidence files and never invents a catalog.
const INVALID = 'INVALID_OPERATION_QUALIFICATION';
const REQUIRED = 'OPERATION_QUALIFICATION_REQUIRED';
const STALE = 'OPERATION_QUALIFICATION_STALE';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:+-]{1,256}$/;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new ToolError(INVALID, message); };
const need = (condition, message) => { if (!condition) fail(message); };
function record(value, allowed, required = allowed, label = 'Qualification record') {
  need(plain(value), `${label} must be a plain record.`);
  const keys = Reflect.ownKeys(value);
  need(required.every(key => own(value, key)) && keys.every(key => typeof key === 'string' && allowed.includes(key)), `${label} has missing or unsupported fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor.enumerable && own(descriptor, 'value'), `${label} cannot contain accessors or hidden fields.`);
  }
}
function list(value, maximum, label) {
  need(Array.isArray(value) && value.length <= maximum, `${label} exceeds its bounded list.`);
  const keys = Reflect.ownKeys(value);
  need(keys.length === value.length + 1 && keys.every(key => key === 'length'
    || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length
      && own(Object.getOwnPropertyDescriptor(value, key), 'value')
      && Object.getOwnPropertyDescriptor(value, key).enumerable), `${label} must be dense data without extra fields.`);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function identity(value, label) { need(typeof value === 'string' && ID.test(value), `${label} must be a bounded evidence identity.`); return value; }
function digest(value, label) { need(typeof value === 'string' && HASH.test(value), `${label} must be a SHA256 digest.`); return value; }
function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} must be an exact bounded integer.`); return value;
}
function statInteger(value, label, positive = false) {
  need(typeof value === 'string' && /^(0|-?[1-9]\d{0,19})$/.test(value), `${label} must be an exact filesystem integer.`);
  const number = BigInt(value);
  need(number >= (positive ? 1n : -9223372036854775808n) && number <= 18446744073709551615n, `${label} exceeds its filesystem bound.`);
  return value;
}
function sourceIdentity(value) {
  const keys = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
  record(value, keys, keys, 'Bounded source identity');
  need(typeof value.canonicalPath === 'string' && value.canonicalPath.length <= 32767
    && path.isAbsolute(value.canonicalPath) && !/[\x00-\x1f\x7f]/.test(value.canonicalPath), 'A canonical absolute source path is required.');
  const result = { canonicalPath: value.canonicalPath };
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) result[key] = statInteger(value[key], key, ['dev', 'ino', 'size'].includes(key));
  need(BigInt(result.size) <= BigInt(Number.MAX_SAFE_INTEGER), 'Source size exceeds the existing bounded identity reader.');
  need(typeof value.sparseDigest === 'string' && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(value.sparseDigest), 'The complete bounded source identity needs its sparse digest.');
  result.sparseDigest = value.sparseDigest;
  return result;
}
function settings(value) {
  record(value, ['profileId', 'preset', 'quality'], undefined, 'Ordinary encoder settings');
  return validateSettings(value);
}
const REQUEST_KEYS = ['range', 'resolution', 'target', 'hdrPolicy', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'];
function requestScope(value) {
  record(value, REQUEST_KEYS, REQUEST_KEYS, 'Exact operation scope');
  let range = null;
  if (value.range !== null) {
    record(value.range, ['startUs', 'endUs'], [], 'Range scope');
    need(own(value.range, 'startUs') || own(value.range, 'endUs'), 'A range needs a measured boundary.');
    range = {};
    for (const key of ['startUs', 'endUs']) if (own(value.range, key)) range[key] = integer(value.range[key], key);
    need(!own(range, 'startUs') || !own(range, 'endUs') || range.endUs > range.startUs, 'Range boundaries must be ordered.');
  }
  need(['source', '2160', '1440', '1080', '720'].includes(value.resolution) && value.target === 'matroska'
    && ['preserve', 'sdr'].includes(value.hdrPolicy) && ['copy', 'precision-aac', 'precision-flac'].includes(value.audioPolicy), 'Only the implemented SDR Encode operation scope can be qualified.');
  const bitrate = value.aacBitrateKbps === null ? null : integer(value.aacBitrateKbps, 'AAC bitrate', 32, 1536);
  need(bitrate === null || value.audioPolicy === 'precision-aac', 'An explicit AAC bitrate requires precision AAC.');
  list(value.omissionRequestIds, 0, 'Omission scope');
  return { range, resolution: value.resolution, target: value.target, hdrPolicy: value.hdrPolicy,
    audioPolicy: value.audioPolicy, aacBitrateKbps: bitrate, omissionRequestIds: [] };
}
function evidenceBudget(value) {
  const keys = ['sourceDecode', 'timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes'];
  record(value, keys, keys, 'Complete collection budget');
  need(value.sourceDecode === 'complete', 'Complete source decoding must be explicitly budgeted.');
  const result = { sourceDecode: 'complete' };
  for (const key of keys.slice(1)) result[key] = integer(value[key], key, 1, key === 'timeoutMs' ? 2147483647 : Number.MAX_SAFE_INTEGER);
  return result;
}
function environmentIdentity(value) {
  if (value === null || value === undefined) return null;
  const keys = ['adapterIdentity', 'driverVersion', 'runtimeVersion'];
  record(value, keys, keys, 'Exact device environment');
  const result = {};
  for (const key of keys) {
    need(typeof value[key] === 'string' && /^[\x20-\x7e]{1,512}$/.test(value[key])
      && value[key].trim() === value[key] && !/^(unknown|unavailable|unresolved|not-detected)$/i.test(value[key]), `A known ${key} is required.`);
    result[key] = value[key];
  }
  return result;
}
function endpointQualification(value, runtimeIdentity) {
  const keys = ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances'];
  record(value, keys, keys, 'Endpoint qualification');
  identity(value.evidenceId, 'Endpoint evidence');
  need(value.runtimeIdentity === runtimeIdentity && ['span', 'end-timestamp'].includes(value.containerDuration), 'Endpoint qualification must bind the paired runtime and duration representation.');
  const toleranceKeys = ['videoTimestampUs', 'audioTimestampUs', 'avSyncUs', 'durationUs', 'sampleCount'];
  record(value.tolerances, toleranceKeys, toleranceKeys, 'Endpoint tolerances');
  return { evidenceId: value.evidenceId, runtimeIdentity, containerDuration: value.containerDuration,
    tolerances: Object.fromEntries(toleranceKeys.map(key => [key, integer(value.tolerances[key], key, 0, key === 'sampleCount' ? 1048576 : 1000000)])) };
}
function interiorQualification(value, runtimeIdentity, request) {
  const keys = ['evidenceId', 'runtimeIdentity', 'videoDurationUs', 'audioTimelineUs', 'aac'];
  record(value, keys, keys, 'Interior timing qualification');
  identity(value.evidenceId, 'Interior timing evidence');
  need(value.runtimeIdentity === runtimeIdentity, 'Interior timing qualification must bind the paired runtime.');
  let aac = null;
  if (value.aac !== null) {
    const aacKeys = ['alignment', 'encoderDelaySamples', 'discardPaddingSamples'];
    record(value.aac, aacKeys, aacKeys, 'AAC decoder alignment');
    need(value.aac.alignment === 'decoded-after-signalled-skip', 'Only measured decoder-signalled AAC alignment is supported.');
    aac = { alignment: value.aac.alignment, encoderDelaySamples: integer(value.aac.encoderDelaySamples, 'AAC delay', 0, 1048576),
      discardPaddingSamples: integer(value.aac.discardPaddingSamples, 'AAC padding', 0, 1048576) };
  }
  need(request.audioPolicy !== 'precision-aac' || aac !== null, 'Precision AAC requires measured decoder alignment.');
  return { evidenceId: value.evidenceId, runtimeIdentity, videoDurationUs: integer(value.videoDurationUs, 'Interior video duration tolerance', 0, 1000000),
    audioTimelineUs: integer(value.audioTimelineUs, 'Interior audio clock tolerance', 0, 1000000), aac };
}
function cell(value) {
  const keys = ['evidenceIds', 'runtimeIdentity', 'sourceIdentity', 'sourceProbeFingerprint', 'settings', 'request', 'qualification', 'timingQualification', 'budget', 'environment'];
  record(value, keys, keys.filter(key => key !== 'environment'), 'Main-trusted qualification cell');
  const evidenceIds = list(value.evidenceIds, 32, 'Evidence identities').map(item => identity(item, 'Retained evidence'));
  need(evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length, 'A cell needs unique retained evidence identities.');
  const runtimeIdentity = digest(value.runtimeIdentity, 'Paired runtime identity'), resolvedSettings = settings(value.settings), request = requestScope(value.request);
  const environment = environmentIdentity(value.environment);
  need(PROFILES.find(profile => profile.id === resolvedSettings.profileId).hardware !== 'NVIDIA' || environment !== null, 'A GPU cell requires exact adapter, driver and runtime observations.');
  const qualification = endpointQualification(value.qualification, runtimeIdentity), timingQualification = interiorQualification(value.timingQualification, runtimeIdentity, request);
  need([qualification.evidenceId, timingQualification.evidenceId].every(id => evidenceIds.includes(id)), 'Both measured qualifications must be identified in retained evidence.');
  return freeze({ evidenceIds, runtimeIdentity, sourceIdentity: sourceIdentity(value.sourceIdentity), sourceProbeFingerprint: digest(value.sourceProbeFingerprint, 'Source probe fingerprint'),
    settings: resolvedSettings, request, qualification, timingQualification, budget: evidenceBudget(value.budget), environment });
}
const applicability = value => ({ runtimeIdentity: value.runtimeIdentity, sourceIdentity: value.sourceIdentity,
  sourceProbeFingerprint: value.sourceProbeFingerprint, settings: value.settings, request: value.request, environment: value.environment });
const BINDING_KEYS = ['plan', 'settings', 'sourceIdentity', 'sourceProbeFingerprint', 'runtimeIdentity', 'environment', 'budget', 'executionBudgetMs'];
function bindings(value) {
  record(value, BINDING_KEYS, BINDING_KEYS.filter(key => key !== 'environment'), 'Main-owned operation admission');
  const resolvedSettings = settings(value.settings), probeFingerprint = digest(value.sourceProbeFingerprint, 'Source probe fingerprint');
  const observedSource = sourceIdentity(value.sourceIdentity);
  const plan = assertEncodeOperationPlan(value.plan, { settings: resolvedSettings, sourceProbeFingerprint: probeFingerprint,
    sourcePath: observedSource.canonicalPath });
  need(plan.compatibilityPath === false && plan.expectedOutput?.operation === 'encode'
    && plan.expectedOutput.color?.supported === true && plan.expectedOutput.color.classification === 'sdr', 'Changed admission requires the genuine SDR Encode plan.');
  const runtimeIdentity = digest(value.runtimeIdentity, 'Paired runtime identity');
  need(plan.runtimeIdentity === runtimeIdentity, 'The prepared plan runtime differs from current runtime observations.');
  digest(plan.planFingerprint, 'Prepared plan fingerprint');
  const request = requestScope(Object.fromEntries(REQUEST_KEYS.map(key => [key, plan.contract.request[key]])));
  // Bind an execution duration, not preview time. The sequential service starts
  // its aggregate deadline only when this prepared job becomes active.
  const executionBudgetMs = integer(value.executionBudgetMs, 'Active execution budget', 1, 1800000);
  return { plan, state: { planFingerprint: plan.planFingerprint, settings: resolvedSettings, sourceIdentity: observedSource,
    sourceProbeFingerprint: probeFingerprint, runtimeIdentity, request, environment: environmentIdentity(value.environment), budget: evidenceBudget(value.budget), executionBudgetMs } };
}
function checked(code, action) {
  try { return action(); }
  catch (error) {
    if (error.code === 'INVALID_ENCODE_OPERATION') throw error;
    throw new ToolError(code, error.message || 'The exact operation qualification is unavailable.');
  }
}

class OperationQualificationSelector {
  #cells;
  #policyIdentity;
  #epoch = 0;
  #selections = new WeakMap();
  constructor(options) {
    record(options, ['cells', 'policyIdentity'], ['policyIdentity'], 'Main qualification catalog');
    this.#policyIdentity = identity(options.policyIdentity, 'Evidence policy');
    this.#cells = list(own(options, 'cells') ? options.cells : [], 256, 'Qualification catalog').map(cell);
    const keys = this.#cells.map(item => JSON.stringify(applicability(item)));
    need(new Set(keys).size === keys.length, 'An exact scope cannot have ambiguous qualification cells.');
    Object.freeze(this.#cells);
  }
  select(options) {
    return checked(REQUIRED, () => {
      record(options, BINDING_KEYS, ['plan'], 'Main-owned operation selection');
      const plan = assertEncodeOperationPlan(options.plan);
      // Ordinary Full never starts new decoding, needs new evidence or acquires
      // this selection authority. Its existing builder/validator stay in place.
      if (plan.compatibilityPath) return null;
      const current = bindings(options);
      const selected = this.#cells.find(item => same(applicability(item), applicability(current.state)));
      need(selected && same(selected.budget, current.state.budget), 'No exact current qualification cell and complete budget apply to this operation.');
      const selection = Object.freeze({});
      const result = freeze({ qualification: selected.qualification, timingQualification: selected.timingQualification,
        budget: selected.budget, evidenceIds: selected.evidenceIds, executionBudgetMs: current.state.executionBudgetMs, policyIdentity: this.#policyIdentity });
      this.#selections.set(selection, { epoch: this.#epoch, plan: current.plan, state: freeze(current.state), result });
      return selection;
    });
  }
  requireCurrent(selection, options) {
    return checked(STALE, () => {
      const selected = selection && typeof selection === 'object' ? this.#selections.get(selection) : null;
      need(selected && selected.epoch === this.#epoch, 'Only this selector\'s current main-owned selection can authorize collection.');
      const current = bindings(options);
      need(current.plan === selected.plan && same(current.state, selected.state), 'The prepared operation, source, runtime, settings, environment or execution budget changed.');
      return selected.result;
    });
  }
  invalidate(reason) {
    need(typeof reason === 'string' && /^[\x20-\x7e]{1,512}$/.test(reason) && reason.trim().length > 0, 'Invalidation needs a bounded diagnostic reason.');
    this.#epoch++;
  }
}

module.exports = { OperationQualificationSelector };
