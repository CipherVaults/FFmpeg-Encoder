'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { types } = require('node:util');

const PROVENANCE_NAMESPACE = 'provenance-v1';
const PROVENANCE_LIMITS = Object.freeze({ records: 10000, bytes: 32 * 1024 * 1024, recordBytes: 16 * 1024 });
const MARKER_KEY = 'FFMPEG_ENCODER_PROVENANCE';
const OUTPUT_ID_KEY = 'FFMPEG_ENCODER_OUTPUT_ID';
const GENERATION_KEY = 'FFMPEG_ENCODER_GENERATION';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RECORD_NAME = /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(intent|published)\.json$/;
// Historical recognition must survive hardware/profile availability changes.
const HISTORICAL_SUFFIXES = Object.freeze(['H264-CPU', 'H265-CPU', 'AV1-CPU', 'H264-Nvidia-GPU', 'H265-Nvidia-GPU', 'AV1-Nvidia-GPU',
  'H264-AMD-GPU', 'H265-AMD-GPU', 'AV1-AMD-GPU', 'H264-Intel-GPU', 'H265-Intel-GPU', 'AV1-Intel-GPU']);
const STAMP_FIELDS = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const HASH = /^[a-f0-9]{64}$/;
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => createHash('sha256').update(value).digest('hex');
const error = message => Object.assign(new Error(message), { code: 'PROVENANCE_UNAVAILABLE' });
const absolute = value => typeof value === 'string' && value.length > 0 && value.length <= 32768
  && !/[\0\r\n]/.test(value) && (path.isAbsolute(value) || path.win32.isAbsolute(value));

function createOutputId() { return randomUUID(); }
function outputIdOf(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw error('Invalid provenance output ID.');
  return value.toLowerCase();
}
// This bounded extension describes an encode. It never grants source admission,
// publication, cleanup or filesystem authority; the original marker/ID stay v1.
function generationDescriptionV1(value) {
  const required = ['version', 'profileId', 'codec', 'backend', 'encoder', 'preset', 'qualityMode', 'quality', 'bitDepth', 'encoderArgs', 'appVersion', 'createdAt'];
  const keys = [...required, ...['runtimeVersion', 'recipeId'].filter(key => value && Object.hasOwn(value, key))];
  if (!exactKeys(value, keys) || value.version !== 1 || Buffer.byteLength(JSON.stringify(value)) > 4096) return null;
  const token = entry => typeof entry === 'string' && /^[a-zA-Z0-9.+_-]{1,80}$/.test(entry);
  if (![value.profileId, value.encoder, value.preset, value.appVersion].every(token)
      || !['H264', 'H265', 'AV1'].includes(value.codec) || !['CPU', 'NVIDIA'].includes(value.backend)
      || !['CRF', 'CQ'].includes(value.qualityMode) || !Number.isInteger(value.quality) || value.quality < 0 || value.quality > 63
      || ![8, 10, 12].includes(value.bitDepth) || typeof value.createdAt !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
      || !Array.isArray(value.encoderArgs) || value.encoderArgs.length > 64
      || value.encoderArgs.some(entry => typeof entry !== 'string' || entry.length > 128 || /[\x00-\x1f\x7f]/.test(entry))
      || (value.runtimeVersion !== undefined && (typeof value.runtimeVersion !== 'string' || value.runtimeVersion.length > 256 || /[\x00-\x1f\x7f]/.test(value.runtimeVersion)))) return null;
  try {
    // Shape is insufficient for a human-facing description: contradictory
    // codec/backend/quality labels must not be presented as known history.
    // Version 1 describes the canonical recipes supported by this application;
    // unknown future options degrade to unavailable, never to source authority.
    const { describeRecipe, PROFILES } = require('./media.cjs');
    const recipe = describeRecipe({ profileId: value.profileId, preset: value.preset, quality: value.quality,
      ...(Object.hasOwn(value, 'recipeId') ? { recipeId: value.recipeId } : {}) });
    if (['codec', 'backend', 'encoder', 'qualityMode'].some(key => recipe[key] !== value[key])
        || JSON.stringify(recipe.args) !== JSON.stringify(value.encoderArgs)
        || !PROFILES.find(profile => profile.id === value.profileId).bitDepths.includes(value.bitDepth)
        || new Date(value.createdAt).toISOString() !== value.createdAt) return null;
  } catch { return null; }
  return structuredClone(value);
}
function inertNativeDescription(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 128 || depth > 3) return false;
  if (typeof value === 'string') return Buffer.byteLength(value) <= 4096;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!object(value) && !Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || !Number.isSafeInteger(value.length) || value.length > 64 || keys.length !== value.length + 1
        || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) return false;
  } else if (keys.length > 32) return false;
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const field = descriptors[key];
    if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value') || !inertNativeDescription(field.value, depth + 1, budget)) return false;
  }
  return true;
}
function generationDescriptionV2(value) {
  try {
    if (!inertNativeDescription(value)) return null;
    const required = ['version', 'kind', 'adapterPolicyVersion', 'profileId', 'codec', 'backend', 'encoder', 'preset', 'qualityMode', 'quality',
      'bitDepth', 'pipelineId', 'encoderArgs', 'settingsRole', 'scope', 'appVersion', 'createdAt'];
    const keys = [...required, ...(Object.hasOwn(value, 'runtimeVersion') ? ['runtimeVersion'] : [])];
    if (!exactKeys(value, keys) || value.version !== 2 || value.kind !== 'native-encoder' || value.adapterPolicyVersion !== 1
        || value.settingsRole !== 'requested' || value.scope !== 'native-encoder-contribution-only' || Buffer.byteLength(JSON.stringify(value)) > 4096) return null;
    const token = entry => typeof entry === 'string' && /^[a-zA-Z0-9.+_-]{1,80}$/.test(entry);
    if (![value.profileId, value.encoder, value.preset, value.appVersion].every(token)
        || !Array.isArray(value.encoderArgs) || value.encoderArgs.length > 64
        || value.encoderArgs.some(entry => typeof entry !== 'string' || entry.length > 128 || /[\x00-\x1f\x7f]/.test(entry))
        || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || (Object.hasOwn(value, 'runtimeVersion') && (typeof value.runtimeVersion !== 'string' || !value.runtimeVersion.length
          || value.runtimeVersion.length > 256 || /[\x00-\x1f\x7f]/.test(value.runtimeVersion)))) return null;
    const { nativeEncoderContribution } = require('./backend-adapters.cjs');
    if (!['CQP', 'QVBR', 'ICQ'].includes(value.qualityMode)) return null;
    const mode = { CQP: 'cqp', QVBR: 'qvbr', ICQ: 'icq' }[value.qualityMode];
    if (!mode || mode === 'cqp' && !object(value.quality)) return null;
    const fragment = nativeEncoderContribution(value.profileId, { preset: value.preset, mode, quality: value.quality },
      { bitDepth: value.bitDepth, pipelineId: value.pipelineId });
    if (fragment.codecName !== value.codec || fragment.backend !== value.backend || fragment.encoder !== value.encoder
        || fragment.policyVersion !== value.adapterPolicyVersion || JSON.stringify(fragment.args) !== JSON.stringify(value.encoderArgs)) return null;
    return { ...structuredClone(value), quality: structuredClone(fragment.settings.quality) };
  } catch { return null; }
}
// Version 3 is descriptive only. Reject executable properties before consulting
// the catalog; neither a forged description nor a device identifier is authority.
function vendorDescriptionData(value, depth = 0) {
  if (typeof value === 'string') return value.length <= 4096;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || types.isProxy(value) || depth > 1
      || !(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : object(value))) return false;
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length > 65 || Array.isArray(value) && keys.length !== value.length + 1) return false;
  return keys.every(key => Array.isArray(value) && key === 'length' || typeof key === 'string'
    && fields[key].enumerable && Object.hasOwn(fields[key], 'value') && vendorDescriptionData(fields[key].value, depth + 1));
}
function generationDescriptionV3(value) {
  try {
    if (!vendorDescriptionData(value)) return null;
    const required = ['version', 'kind', 'profileId', 'codec', 'backend', 'encoder', 'preset', 'qualityMode', 'quality',
      'bitDepth', 'encoderArgs', 'appVersion', 'createdAt'];
    const keys = [...required, ...(Object.hasOwn(value, 'runtimeVersion') ? ['runtimeVersion'] : [])];
    if (!exactKeys(value, keys) || value.version !== 3 || value.kind !== 'vendor-encoder'
        || Buffer.byteLength(JSON.stringify(value)) > 4096) return null;
    if (typeof value.appVersion !== 'string' || !/^[a-zA-Z0-9.+_-]{1,80}$/.test(value.appVersion)
        || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || !Array.isArray(value.encoderArgs) || value.encoderArgs.length > 64
        || value.encoderArgs.some(entry => typeof entry !== 'string' || entry.length > 128 || /[\x00-\x1f\x7f]/.test(entry))
        || (Object.hasOwn(value, 'runtimeVersion') && (typeof value.runtimeVersion !== 'string' || !value.runtimeVersion.length
          || value.runtimeVersion.length > 256 || /[\x00-\x1f\x7f]/.test(value.runtimeVersion)))) return null;
    const { VENDOR_PROFILES, describeVendorRecipe } = require('./vendor-profiles.cjs');
    const profile = VENDOR_PROFILES.find(row => row.id === value.profileId);
    const recipe = describeVendorRecipe({ profileId: value.profileId, preset: value.preset, quality: value.quality });
    if (!profile.bitDepths.includes(value.bitDepth) || ['codec', 'backend', 'encoder', 'qualityMode'].some(key => recipe[key] !== value[key])
        || JSON.stringify(recipe.args) !== JSON.stringify(value.encoderArgs)) return null;
    return structuredClone(value);
  } catch { return null; }
}
// Version 4 describes a remux generation (record 47, Q1e): which copied
// streams it carried and which it omitted. It names no encoder settings, so a
// remux never inherits or advertises a previous encode's configuration. It is
// descriptive only; no remux route writes it until that route's own measured
// round trip qualifies it (remux contract: required-before-target-enablement).
const REMUX_TARGETS = ['matroska', 'mp4', 'mov'], REMUX_FAMILIES = ['isobmff', 'matroska', 'mpegts'];
const REMUX_STREAM_TYPES = ['video', 'audio', 'subtitle', 'attachment'];
// Copies only own enumerable data properties of plain records and dense plain
// arrays, so no getter, proxy trap, toJSON or hidden key is ever honoured.
function inertDescriptionCopy(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 256) throw new Error('too large');
  if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || depth > 2
      || !(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : object(value))) throw new Error('not inert');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length > 65 || Array.isArray(value) && keys.length !== value.length + 1) throw new Error('not dense');
  const copy = Array.isArray(value) ? [] : {};
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const field = fields[key];
    if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')
        || Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key)) throw new Error('not data');
    Object.defineProperty(copy, key, { value: inertDescriptionCopy(field.value, depth + 1, budget), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
function generationDescriptionV4(input) {
  try {
    const value = inertDescriptionCopy(input);
    const required = ['version', 'kind', 'inputFamily', 'target', 'streams', 'omittedStreams', 'bitstreamFilters', 'appVersion', 'createdAt'];
    const keys = [...required, ...(Object.hasOwn(value, 'runtimeVersion') ? ['runtimeVersion'] : [])];
    if (!exactKeys(value, keys) || value.version !== 4 || value.kind !== 'remux' || Buffer.byteLength(JSON.stringify(value)) > 4096) return null;
    const token = entry => typeof entry === 'string' && /^[a-z0-9_]{1,64}$/.test(entry);
    const list = (entry, max) => Array.isArray(entry) && !types.isProxy(entry) && Object.getPrototypeOf(entry) === Array.prototype
      && entry.length <= max && Object.keys(entry).length === entry.length;
    const stream = entry => !types.isProxy(entry) && exactKeys(entry, ['codecType', 'codecName'])
      && REMUX_STREAM_TYPES.includes(entry.codecType) && token(entry.codecName);
    if (!REMUX_FAMILIES.includes(value.inputFamily) || !REMUX_TARGETS.includes(value.target)
        || !list(value.streams, 32) || !value.streams.length || !value.streams.every(stream)
        || !list(value.omittedStreams, 32) || !value.omittedStreams.every(stream)
        || !list(value.bitstreamFilters, 32) || !value.bitstreamFilters.every(token)
        || typeof value.appVersion !== 'string' || !/^[a-zA-Z0-9.+_-]{1,80}$/.test(value.appVersion)
        || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || (Object.hasOwn(value, 'runtimeVersion') && (typeof value.runtimeVersion !== 'string' || !value.runtimeVersion.length
          || value.runtimeVersion.length > 256 || /[\x00-\x1f\x7f]/.test(value.runtimeVersion)))) return null;
    return structuredClone(value);
  } catch { return null; }
}
function generationDescriptionOf(value) {
  if (types.isProxy(value)) return null;
  if (!object(value)) return null;
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  if (!version || !Object.hasOwn(version, 'value') || !version.enumerable) return null;
  return version.value === 1 ? generationDescriptionV1(value) : version.value === 2 ? generationDescriptionV2(value)
    : version.value === 3 ? generationDescriptionV3(value) : version.value === 4 ? generationDescriptionV4(value) : null;
}
function provenanceArgs(outputId, generationDescription) {
  const args = ['-metadata', `${MARKER_KEY}=1`, '-metadata', `${OUTPUT_ID_KEY}=${outputIdOf(outputId)}`];
  if (generationDescription !== undefined) {
    const description = generationDescriptionOf(generationDescription);
    if (!description) throw error('Invalid descriptive generation metadata.');
    args.push('-metadata', `${GENERATION_KEY}=${JSON.stringify(description)}`);
  }
  return args;
}

function classifyMarker(probe) {
  const suspicious = reason => ({ kind: 'suspicious', reason });
  if (!object(probe)) return suspicious('Media provenance could not be inspected.');
  const reserved = [];
  let malformed = false;
  function collect(tags, location) {
    if (tags === undefined) return;
    if (!object(tags)) { malformed = true; return; }
    for (const [key, value] of Object.entries(tags)) {
      if (/^FFMPEG_ENCODER_/i.test(key)) reserved.push({ key: key.toUpperCase(), value, location });
    }
  }
  if (probe.format !== undefined && !object(probe.format)) malformed = true;
  collect(probe.format?.tags, 'format');
  for (const collection of ['streams', 'chapters']) {
    if (probe[collection] === undefined) continue;
    if (!Array.isArray(probe[collection])) { malformed = true; continue; }
    for (const item of probe[collection]) {
      if (!object(item)) malformed = true;
      else collect(item.tags, collection);
    }
  }
  if (malformed) return suspicious('Malformed media tags prevent reliable provenance classification.');
  if (!reserved.length) return { kind: 'unmarked', reason: 'No reserved application marker is present.' };
  if (reserved.some(tag => tag.location !== 'format')) return suspicious('Reserved application tags are misplaced on a stream or chapter.');
  if (reserved.some(tag => ![MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY].includes(tag.key))) return suspicious('Unknown reserved application tag.');
  const identityTags = reserved.filter(tag => tag.key !== GENERATION_KEY);
  if (identityTags.length !== 2 || new Set(identityTags.map(tag => tag.key)).size !== 2) return suspicious('Partial, duplicate or conflicting application marker.');
  const version = reserved.find(tag => tag.key === MARKER_KEY).value;
  const outputId = reserved.find(tag => tag.key === OUTPUT_ID_KEY).value;
  if (version !== '1') return suspicious('Malformed or unsupported application marker version.');
  if (typeof outputId !== 'string' || !UUID.test(outputId)) return suspicious('Malformed application output ID.');
  const result = { kind: 'generated', outputId: outputId.toLowerCase(), reason: 'Recognized application-generated output.' };
  const descriptions = reserved.filter(tag => tag.key === GENERATION_KEY);
  if (descriptions.length) {
    try {
      if (descriptions.length !== 1 || typeof descriptions[0].value !== 'string' || Buffer.byteLength(descriptions[0].value) > 4096) throw new Error('Invalid description');
      const parsed = JSON.parse(descriptions[0].value);
      // Reject duplicate JSON keys/noncanonical encodings, but retain the valid
      // identity marker. Descriptive corruption must not admit an output.
      if (JSON.stringify(parsed) !== descriptions[0].value) throw new Error('Noncanonical description');
      const description = generationDescriptionOf(parsed);
      if (!description) throw new Error('Unsupported description');
      result.previousGeneration = description;
    } catch { result.descriptionNotice = 'Previous settings unavailable: descriptive metadata is malformed or unsupported.'; }
  }
  return result;
}

function historicalSuffix(name) {
  if (typeof name !== 'string') return null;
  const stem = path.win32.parse(path.parse(name).base).name.toLowerCase();
  return HISTORICAL_SUFFIXES.find(suffix => stem.endsWith(`_${suffix.toLowerCase()}`)) || null;
}

function identityOf(value) {
  const fields = Object.hasOwn(value || {}, 'sparseDigest') ? [...STAMP_FIELDS, 'sparseDigest'] : STAMP_FIELDS;
  if (!exactKeys(value, fields)) throw error('Invalid provenance file identity.');
  const identity = {};
  for (const field of fields) {
    if (typeof value[field] !== 'string' || value[field].length > (field === 'canonicalPath' ? 32768 : 128)) throw error('Invalid provenance file identity.');
    identity[field] = value[field];
  }
  if (!absolute(identity.canonicalPath) || !['dev', 'ino', 'size'].every(field => /^\d+$/.test(identity[field]))
      || !['mtimeNs', 'ctimeNs', 'birthtimeNs'].every(field => /^-?\d+$/.test(identity[field]))
      || (identity.sparseDigest !== undefined && !/^sha256-sparse-v1:[a-f0-9]{64}$/.test(identity.sparseDigest))) throw error('Invalid provenance file identity.');
  return identity;
}
function reliableIdentity(value) {
  try {
    const identity = identityOf(value);
    return ['dev', 'ino', 'birthtimeNs', 'size'].every(field => /^[1-9]\d*$/.test(identity[field])) && Boolean(identity.sparseDigest);
  } catch { return false; }
}
function samePublishedIdentity(left, right) {
  // Names and change timestamps may change during a rename. Filesystem object,
  // creation time, size and sparse content must all survive. A sparse digest is
  // not full-file equality or protection against a deliberately concealed edit.
  return reliableIdentity(left) && reliableIdentity(right)
    && ['dev', 'ino', 'birthtimeNs', 'size', 'sparseDigest'].every(field => left[field] === right[field]);
}

class ProvenanceJournal {
  #pending = Promise.resolve();
  #records = new Map();
  #loaded = false;
  #blocked = false;
  #entries = 0;
  #bytes = 0;
  #warnings = [];
  #recordIssues = [];

  constructor({ directory, onWarning, maxRecords = PROVENANCE_LIMITS.records, maxBytes = PROVENANCE_LIMITS.bytes, maxRecordBytes = PROVENANCE_LIMITS.recordBytes }) {
    if (!absolute(directory) || (onWarning !== undefined && typeof onWarning !== 'function')) throw new TypeError('ProvenanceJournal requires an absolute app-owned state directory.');
    if (![maxRecords, maxBytes, maxRecordBytes].every(value => Number.isSafeInteger(value) && value > 0)
        || maxRecords > PROVENANCE_LIMITS.records || maxBytes > PROVENANCE_LIMITS.bytes || maxRecordBytes > PROVENANCE_LIMITS.recordBytes) throw new TypeError('Invalid provenance journal bounds.');
    this.directory = path.join(directory, PROVENANCE_NAMESPACE);
    this.limits = Object.freeze({ records: maxRecords, bytes: maxBytes, recordBytes: maxRecordBytes });
    this.onWarning = onWarning;
    this.warning = null;
  }

  get warnings() { return [...this.#warnings]; }
  #warn(reason) {
    const warning = `Provenance bookkeeping: ${String(reason).slice(0, 240)}`;
    this.warning = warning;
    if (!this.#warnings.includes(warning) && this.#warnings.length < 64) {
      this.#warnings.push(warning);
      try { this.onWarning?.(warning); } catch { /* A presentation callback cannot alter persistence. */ }
    }
  }
  #sequence(operation) {
    const pending = this.#pending.then(operation);
    this.#pending = pending.catch(() => {});
    return pending;
  }
  async #ensureDirectory(create = false) {
    let stat;
    try { stat = await fs.lstat(this.directory); }
    catch (cause) {
      if (cause.code !== 'ENOENT' || !create) throw cause;
      await fs.mkdir(this.directory, { recursive: true });
      stat = await fs.lstat(this.directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('The provenance namespace must be a regular app-owned directory.');
  }
  #decode(serialized, name) {
    if (Buffer.byteLength(serialized) > this.limits.recordBytes) throw error('Oversized provenance record.');
    const record = JSON.parse(serialized);
    const match = RECORD_NAME.exec(name);
    const fields = record?.kind === 'intent'
      ? ['namespace', 'version', 'kind', 'outputId', 'sourceIdentity', 'destination', 'profileId', 'createdAt', 'checksum']
      : ['namespace', 'version', 'kind', 'outputId', 'outputIdentity', 'createdAt', 'checksum'];
    if (record?.kind === 'intent' && Object.hasOwn(record, 'generationDescription')) fields.push('generationDescription');
    if (!match || !exactKeys(record, fields) || record.namespace !== PROVENANCE_NAMESPACE || record.version !== 1
        || record.outputId !== match[1] || record.kind !== match[2] || typeof record.createdAt !== 'string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.createdAt)
        || !HASH.test(record.checksum) || JSON.stringify(record) !== serialized) throw error('Malformed, noncanonical or unsupported provenance record.');
    const { checksum, ...body } = record;
    if (digest(JSON.stringify(body)) !== checksum) throw error('Provenance record checksum mismatch.');
    if (record.kind === 'intent') {
      identityOf(record.sourceIdentity);
      if (!absolute(record.destination) || typeof record.profileId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(record.profileId)) throw error('Invalid publication intent.');
      if (record.generationDescription !== undefined && !generationDescriptionOf(record.generationDescription)) {
        // A description is not identity evidence. Preserve the valid record and
        // marker recognition when a future/invalid description is unavailable.
        delete record.generationDescription;
      }
    } else identityOf(record.outputIdentity);
    return record;
  }
  async #read(name) {
    const filename = path.join(this.directory, name);
    const before = await fs.lstat(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(this.limits.recordBytes)) throw error('Unsafe or oversized provenance record; preserved.');
    const handle = await fs.open(filename, 'r');
    try {
      const opened = await handle.stat({ bigint: true });
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n || opened.size !== before.size) throw error('Provenance record changed before reading.');
      const buffer = Buffer.alloc(Number(opened.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (BigInt(length) !== opened.size || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw error('Provenance record changed while reading.');
      return this.#decode(buffer.subarray(0, length).toString('utf8'), name);
    } finally { await handle.close(); }
  }
  async #load(refresh = false) {
    if (this.#loaded && !refresh) return;
    this.#loaded = false;
    this.#blocked = false;
    this.#records.clear(); this.#entries = 0; this.#bytes = 0; this.#recordIssues = [];
    try { await this.#ensureDirectory(); }
    catch (cause) { if (cause.code === 'ENOENT') { this.#loaded = true; return; } throw cause; }
    const directory = await fs.opendir(this.directory);
    for await (const entry of directory) {
      this.#entries += 1;
      if (this.#entries > this.limits.records) { this.#blocked = true; this.#warn('Namespace record limit exceeded; remaining files are preserved and unindexed.'); break; }
      try {
        const stat = await fs.lstat(path.join(this.directory, entry.name));
        this.#bytes += stat.size;
        if (this.#bytes > this.limits.bytes) { this.#blocked = true; this.#warn('Namespace byte limit exceeded; remaining files are preserved and unindexed.'); break; }
        if (!RECORD_NAME.test(entry.name)) {
          this.#warn('Unknown file or interrupted temporary record preserved in provenance namespace.');
          if (this.#recordIssues.length < 64) this.#recordIssues.push({ reason: 'Unknown file or interrupted temporary record preserved.' });
          continue;
        }
        this.#records.set(entry.name, await this.#read(entry.name));
      } catch (cause) {
        this.#warn(`Record ${entry.name.slice(0, 80)} preserved: ${cause.message}`);
        if (this.#recordIssues.length < 64) this.#recordIssues.push({ record: entry.name.slice(0, 80), reason: String(cause.message).slice(0, 240) });
      }
    }
    for (const record of this.#records.values()) {
      if (record.kind === 'published' && !this.#records.has(`${record.outputId}.intent.json`)) this.#warn(`Published record ${record.outputId} lacks valid intent; excluded from identity recognition.`);
    }
    this.#loaded = true;
  }
  async #write(body) {
    await this.#ensureDirectory(true);
    const serialized = JSON.stringify({ ...body, checksum: digest(JSON.stringify(body)) });
    const bytes = Buffer.byteLength(serialized);
    if (bytes > this.limits.recordBytes || this.#blocked || this.#entries + 1 > this.limits.records || this.#bytes + bytes > this.limits.bytes) throw error('Provenance capacity reached; existing records are preserved.');
    const name = `${body.outputId}.${body.kind}.json`;
    const temp = path.join(this.directory, `${name}.${randomUUID()}.tmp`);
    const target = path.join(this.directory, name);
    let handle;
    let owned;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      owned = await handle.stat({ bigint: true });
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close(); handle = null;
      // Never replace an existing journal record. Linking a complete, synced
      // owned temporary record publishes one atomic namespace entry or fails.
      await fs.link(temp, target);
      this.#records.set(name, JSON.parse(serialized));
      this.#entries += 1; this.#bytes += bytes;
    } finally {
      await handle?.close().catch(() => {});
      if (owned) {
        try {
          const current = await fs.lstat(temp, { bigint: true });
          if (current.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino) await fs.unlink(temp);
          else this.#warn('Owned temporary record changed; preserved without cleanup.');
        } catch (cause) { if (cause.code !== 'ENOENT') this.#warn('Owned temporary record could not be removed; preserved.'); }
      }
    }
    return this.#records.get(name);
  }
  recordIntent({ outputId, sourceIdentity, destination, profileId, generationDescription }) {
    return this.#sequence(async () => {
      try {
        outputId = outputIdOf(outputId);
        sourceIdentity = identityOf(sourceIdentity);
        if (!absolute(destination) || typeof profileId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(profileId)) throw error('Invalid publication intent.');
        if (generationDescription !== undefined && !generationDescriptionOf(generationDescription)) throw error('Invalid descriptive generation metadata.');
        await this.#load(true);
        if (this.#records.has(`${outputId}.intent.json`) || this.#records.has(`${outputId}.published.json`)) throw error('Output ID already has provenance history.');
        return structuredClone(await this.#write({ namespace: PROVENANCE_NAMESPACE, version: 1, kind: 'intent', outputId, sourceIdentity, destination, profileId, createdAt: new Date().toISOString(),
          ...(generationDescription === undefined ? {} : { generationDescription: generationDescriptionOf(generationDescription) }) }));
      } catch (cause) { this.#warn(`Required publication intent was not recorded. ${cause.message}`); throw cause; }
    });
  }
  recordPublished(outputId, outputIdentity) {
    return this.#sequence(async () => {
      try {
        outputId = outputIdOf(outputId); outputIdentity = identityOf(outputIdentity);
        await this.#load(true);
        // Re-read the durable intent, not only the in-memory recognition index.
        await this.#ensureDirectory();
        await this.#read(`${outputId}.intent.json`);
        const existing = this.#records.get(`${outputId}.published.json`);
        if (existing) {
          const fresh = await this.#read(`${outputId}.published.json`);
          if (JSON.stringify(fresh.outputIdentity) === JSON.stringify(outputIdentity)) return structuredClone(fresh);
          throw error('Output ID already has a different published identity.');
        }
        return structuredClone(await this.#write({ namespace: PROVENANCE_NAMESPACE, version: 1, kind: 'published', outputId, outputIdentity, createdAt: new Date().toISOString() }));
      } catch (cause) { this.#warn(`Final publication bookkeeping is pending; preserve the completed output and intent. ${cause.message}`); throw cause; }
    });
  }
  lookupIdentity(identity) {
    return this.#sequence(async () => {
      try {
        await this.#load();
        if (!reliableIdentity(identity)) return null;
        const matches = [...this.#records.values()].filter(record => record.kind === 'published'
          && this.#records.has(`${record.outputId}.intent.json`) && samePublishedIdentity(record.outputIdentity, identity));
        if (matches.length > 1) this.#warn('Multiple output records match this identity; conservatively recognize it as generated.');
        if (!matches.length) return null;
        const match = matches[0];
        const intent = this.#records.get(`${match.outputId}.intent.json`);
        return structuredClone({ ...match, ...(matches.length === 1 && intent.generationDescription ? { previousGeneration: intent.generationDescription } : {}) });
      } catch (cause) { this.#warn(`Identity lookup unavailable. ${cause.message}`); return null; }
    });
  }
  recover({ inspectDestination, maxPending = 128 }) {
    if (typeof inspectDestination !== 'function') return Promise.reject(new TypeError('Recovery requires a read-only destination inspector.'));
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 128) return Promise.reject(new TypeError('Recovery is bounded to 1–128 pending intents.'));
    return this.#sequence(async () => {
      const summary = { matching: [], absent: [], unrelated: [], uncertain: [], pendingRemaining: 0, warnings: [] };
      try { await this.#load(true); }
      catch (cause) { this.#warn(`Recovery unavailable. ${cause.message}`); summary.uncertain.push({ reason: 'Provenance records could not be read.' }); }
      summary.uncertain.push(...this.#recordIssues);
      if (this.#blocked) summary.uncertain.push({ reason: 'Provenance namespace bounds prevent a complete recovery inventory.' });
      let inspected = 0;
      for (const intent of this.#records.values()) {
        // Completed pairs already serve the recognition index. Startup only
        // inspects unresolved intents, with a bounded number of media probes.
        if (intent.kind !== 'intent' || this.#records.has(`${intent.outputId}.published.json`)) continue;
        if (inspected >= maxPending) { summary.pendingRemaining += 1; continue; }
        inspected += 1;
        const item = { outputId: intent.outputId, destination: intent.destination };
        try {
          // Journal destinations are passed only to a read-only inspector. They
          // never select a write, retry, overwrite, staging cleanup or deletion.
          const current = await inspectDestination(intent.destination);
          if (current === null) { summary.absent.push(item); continue; }
          const marker = current?.marker;
          if (!object(current) || !object(marker) || !['generated', 'unmarked', 'suspicious'].includes(marker.kind)) throw error('Destination inspection is incomplete.');
          if (marker.kind === 'suspicious') throw error('Destination has suspicious application markers.');
          if (marker.kind === 'generated') {
            if (!UUID.test(marker.outputId || '')) throw error('Destination output ID is malformed.');
            if (marker.outputId.toLowerCase() !== intent.outputId) { summary.unrelated.push(item); continue; }
            summary.matching.push({ ...item, pending: true });
          } else if (reliableIdentity(current.identity)) summary.unrelated.push(item);
          else throw error('Unmarked destination has no reliable matching identity.');
        } catch (cause) { summary.uncertain.push({ ...item, reason: String(cause.message).slice(0, 240) }); }
      }
      if (summary.pendingRemaining) this.#warn(`${summary.pendingRemaining} additional pending intents were left for a later bounded recovery review.`);
      summary.warnings = this.warnings;
      return summary;
    });
  }
}

module.exports = { createOutputId, provenanceArgs, classifyMarker, historicalSuffix, samePublishedIdentity, generationDescriptionOf, generationDescriptionV3,
  ProvenanceJournal, PROVENANCE_NAMESPACE, PROVENANCE_LIMITS, HISTORICAL_SUFFIXES, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY };
