'use strict';

const { ToolError } = require('./process-runner.cjs');

// This module validates descriptive requests and computes pure contracts. It does
// not grant file access, approve omissions, qualify a runtime, or build arguments.
const OPERATION_CONTRACT_VERSION = 1;
const OPERATION_DEFAULTS = Object.freeze({ fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-aac',
  resolution: 'source', hdrPolicy: 'preserve', remuxTarget: 'matroska' });
const AUDIO_POLICIES = ['copy', 'precision-aac', 'precision-flac'];
const TARGETS = ['matroska', 'mp4', 'mov'];
const RESOLUTIONS = ['source', '2160', '1440', '1080', '720'];
const HDR_POLICIES = ['preserve', 'sdr', 'hlg-base', 'dolby-pq'];
const ORIGINS = ['factory', 'app', 'batch', 'file', 'not-applicable'];
const BOXES = { 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720] };
const LAYOUTS = Object.freeze({ mono: { channels: 1, bitrate: 128, minimum: 64, maximum: 256 },
  stereo: { channels: 2, bitrate: 320, minimum: 96, maximum: 512 },
  '5.1': { channels: 6, bitrate: 512, minimum: 256, maximum: 1024 },
  '5.1(side)': { channels: 6, bitrate: 512, minimum: 256, maximum: 1024 },
  '7.1': { channels: 8, bitrate: 768, minimum: 384, maximum: 1536 } });
const MAX_STREAMS = 1024;
const US = 1000000n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const AV_TIME_MAX = 9223372036854775807n;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };

function record(value, allowed, label) {
  if (!plain(value)) fail('INVALID_OPERATION', `${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
        || !own(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('INVALID_OPERATION', `${label} contains an unsupported field.`);
  }
  return value;
}
function enumValue(value, options, label) {
  if (!options.includes(value)) fail('INVALID_OPERATION', `${label} is not a supported choice.`);
  return value;
}
function exactInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail('INVALID_OPERATION', `${label} must be a bounded nonnegative integer.`);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function opaqueId(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value)) fail('INVALID_OPERATION', `${label} must be an opaque request identifier, not a path or authority record.`);
  return value;
}
function gcd(a, b) { a = a < 0n ? -a : a; while (b) { [a, b] = [b, a % b]; } return a; }
function rat(n, d = 1n) {
  if (d <= 0n) fail('INVALID_MEDIA_EVIDENCE', 'A rational denominator must be positive.');
  const g = gcd(n, d); return { n: n / g, d: d / g };
}
const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => rat(a.n * b.d, a.d * b.n);
const compare = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const absolute = value => rat(value.n < 0n ? -value.n : value.n, value.d);
const packed = value => value && ({ numerator: value.n.toString(), denominator: value.d.toString() });
function evidenceInteger(value, code, label, { minimum = 0n, maximum = SAFE, optional = false } = {}) {
  if (optional && value?.state === 'unknown') return null;
  if (value?.state !== 'known' || typeof value.value !== 'string' || !/^-?\d{1,40}$/.test(value.value)) fail(code, `${label} is missing or malformed.`);
  const result = BigInt(value.value);
  if (result < minimum || result > maximum) fail(code, `${label} is out of range.`);
  return result;
}
function evidenceRational(value, code, label, { positive = false, optional = false } = {}) {
  if (optional && (!value || value.state === 'unknown')) return null;
  if (value?.state !== 'known' || !plain(value.value) || typeof value.value.numerator !== 'string' || typeof value.value.denominator !== 'string'
      || !/^-?\d{1,40}$/.test(value.value.numerator) || !/^\d{1,40}$/.test(value.value.denominator)) fail(code, `${label} is missing or malformed.`);
  const n = BigInt(value.value.numerator), d = BigInt(value.value.denominator);
  if (d <= 0n || (positive && n <= 0n)) fail(code, `${label} is out of range.`);
  return rat(n, d);
}

function validateDefaults(value, label) {
  record(value, [...Object.keys(OPERATION_DEFAULTS), 'previewExpanded'], label);
  const result = {};
  for (const key of Object.keys(value)) {
    if (key === 'previewExpanded') {
      if (typeof value[key] !== 'boolean') fail('INVALID_OPERATION', 'Preview expansion must be boolean.');
      continue; // A cosmetic preference must never change an execution snapshot.
    }
    result[key] = enumValue(value[key], key.endsWith('AudioPolicy') ? AUDIO_POLICIES
      : key === 'resolution' ? RESOLUTIONS : key === 'hdrPolicy' ? ['preserve', 'sdr'] : TARGETS, key);
  }
  return result;
}

function createBatchDefaults(options = {}) {
  record(options, ['appDefaults', 'batchOverrides', 'appDefaultsRevision'], 'Batch defaults request');
  const { appDefaults = {}, batchOverrides = {}, appDefaultsRevision = 0 } = options;
  exactInteger(appDefaultsRevision, 'App defaults revision');
  const values = { ...OPERATION_DEFAULTS }, origins = Object.fromEntries(Object.keys(values).map(key => [key, 'factory']));
  for (const [label, value] of [['app', appDefaults], ['batch', batchOverrides]]) {
    for (const [key, entry] of Object.entries(validateDefaults(value, `${label} defaults`))) { values[key] = entry; origins[key] = label; }
  }
  return freeze({ version: OPERATION_CONTRACT_VERSION, appDefaultsRevision, values, origins });
}

function snapshotDefaults(value) {
  record(value, ['version', 'appDefaultsRevision', 'values', 'origins'], 'Batch snapshot');
  if (value.version !== OPERATION_CONTRACT_VERSION) fail('INVALID_OPERATION', 'Unknown batch snapshot version.');
  exactInteger(value.appDefaultsRevision, 'App defaults revision');
  const values = validateDefaults(value.values, 'Batch snapshot values');
  record(value.origins, Object.keys(OPERATION_DEFAULTS), 'Batch snapshot origins');
  const origins = {};
  for (const key of Object.keys(OPERATION_DEFAULTS)) {
    if (!own(values, key)) fail('INVALID_OPERATION', 'Batch snapshot is incomplete.');
    origins[key] = enumValue(value.origins[key], ['factory', 'app', 'batch'], 'Default origin');
  }
  return { values, origins };
}

function validateRangeRequest(value) {
  if (value === null) return null;
  record(value, ['startUs', 'endUs'], 'Time Range');
  if (!own(value, 'startUs') && !own(value, 'endUs')) fail('INVALID_OPERATION', 'Time Range needs at least one boundary.');
  const result = {};
  for (const key of ['startUs', 'endUs']) if (own(value, key)) result[key] = exactInteger(value[key], key);
  if (own(result, 'startUs') && own(result, 'endUs') && result.endUs <= result.startUs) fail('INVALID_RANGE', 'Time Range must have an end after its start.');
  return result;
}

function omissionIds(value = []) {
  if (!Array.isArray(value) || value.length > MAX_STREAMS) fail('INVALID_OPERATION', 'Omission requests exceed the bounded list.');
  const result = value.map(id => opaqueId(id, 'Omission request'));
  if (new Set(result).size !== result.length) fail('INVALID_OPERATION', 'Omission requests must be unique.');
  return result;
}

function resolveFileRequest(options) {
  record(options, ['fileId', 'identityRevision', 'draftRevision', 'operation', 'batchDefaults', 'overrides'], 'File request');
  const { fileId, identityRevision, draftRevision, operation, batchDefaults = createBatchDefaults(), overrides = {} } = options;
  opaqueId(fileId, 'File ID'); exactInteger(identityRevision, 'Identity revision'); exactInteger(draftRevision, 'Draft revision');
  enumValue(operation, ['encode', 'remux'], 'Operation');
  const { values, origins: defaultsOrigins } = snapshotDefaults(batchDefaults);
  record(overrides, ['target', 'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'], 'File overrides');
  const range = validateRangeRequest(own(overrides, 'range') ? overrides.range : null);
  const effective = { target: operation === 'remux' ? values.remuxTarget : 'matroska',
    resolution: operation === 'remux' ? 'source' : values.resolution, hdrPolicy: operation === 'remux' ? 'preserve' : values.hdrPolicy,
    range, audioPolicy: operation === 'remux' ? 'copy' : values[range === null ? 'fullAudioPolicy' : 'rangeAudioPolicy'], aacBitrateKbps: null };
  const origins = { target: operation === 'remux' ? defaultsOrigins.remuxTarget : 'factory',
    resolution: operation === 'remux' ? 'not-applicable' : defaultsOrigins.resolution,
    hdrPolicy: operation === 'remux' ? 'not-applicable' : defaultsOrigins.hdrPolicy,
    range: own(overrides, 'range') ? 'file' : 'factory',
    audioPolicy: operation === 'remux' ? 'not-applicable' : defaultsOrigins[range === null ? 'fullAudioPolicy' : 'rangeAudioPolicy'], aacBitrateKbps: 'factory' };
  for (const [key, choices] of [['target', TARGETS], ['resolution', RESOLUTIONS], ['hdrPolicy', HDR_POLICIES], ['audioPolicy', AUDIO_POLICIES]]) {
    if (own(overrides, key)) { effective[key] = enumValue(overrides[key], choices, key); origins[key] = 'file'; }
  }
  if (own(overrides, 'aacBitrateKbps')) {
    effective.aacBitrateKbps = overrides.aacBitrateKbps === null ? null : exactInteger(overrides.aacBitrateKbps, 'AAC bitrate in kb/s', 1536);
    if (effective.aacBitrateKbps !== null && effective.aacBitrateKbps < 32) fail('INVALID_AUDIO_BITRATE', 'AAC bitrate must be at least 32 kb/s; layout-specific bounds also apply.');
    origins.aacBitrateKbps = 'file';
  }
  if (effective.aacBitrateKbps !== null && effective.audioPolicy !== 'precision-aac') fail('INVALID_AUDIO_BITRATE', 'An AAC bitrate applies only to precision AAC.');
  if (operation === 'remux' && (range !== null || effective.resolution !== 'source' || effective.hdrPolicy !== 'preserve' || effective.audioPolicy !== 'copy')) {
    fail('INVALID_REMUX_TRANSFORM', 'Remux is Full, Keep Source, preserve color and stream copy; it cannot perform encoding transforms.');
  }
  return freeze({ version: OPERATION_CONTRACT_VERSION, fileId, identityRevision, draftRevision, operation, appDefaultsRevision: batchDefaults.appDefaultsRevision,
    ...effective, origins, omissionRequestIds: omissionIds(overrides.omissionRequestIds), omissionAuthority: 'unbound-request-ids' });
}

function orientation(geometry) {
  const rotation = evidenceRational(geometry.rotationDegrees, 'GEOMETRY_ORIENTATION_UNKNOWN', 'Orientation');
  if (rotation.d !== 1n) fail('GEOMETRY_ORIENTATION_UNSUPPORTED', 'Only orthogonal rotation is supported.');
  const degrees = Number((rotation.n % 360n + 360n) % 360n);
  if (![0, 90, 180, 270].includes(degrees)) fail('GEOMETRY_ORIENTATION_UNSUPPORTED', 'Only orthogonal rotation is supported.');
  if (geometry.rotationSource === 'display-matrix') {
    const matrix = geometry.displayMatrix;
    if (matrix?.state !== 'known' || !Array.isArray(matrix.value) || matrix.value.length !== 9) fail('GEOMETRY_ORIENTATION_UNKNOWN', 'A complete display matrix is required.');
    const candidates = { 0: ['65536', '0', '0', '0', '65536', '0', '0', '0', '1073741824'],
      90: ['0', '-65536', '0', '65536', '0', '0', '0', '0', '1073741824'],
      180: ['-65536', '0', '0', '0', '-65536', '0', '0', '0', '1073741824'],
      270: ['0', '65536', '0', '-65536', '0', '0', '0', '0', '1073741824'] };
    if (matrix.value.some((value, index) => value !== candidates[degrees][index])) fail('GEOMETRY_ORIENTATION_UNSUPPORTED', 'Mirrored, translated, scaled or conflicting display matrices need a separately qualified path.');
    if (geometry.legacyRotationDegrees?.state === 'known') fail('GEOMETRY_ORIENTATION_CONFLICT', 'Concurrent legacy rotation and display-matrix instructions need explicit reconciliation.');
  } else if (geometry.rotationSource !== 'legacy-rotate-tag' && geometry.rotationSource !== 'qualified-identity') {
    fail('GEOMETRY_ORIENTATION_UNKNOWN', 'Orientation lacks a qualified interpretation.');
  }
  return degrees;
}

function resolveGeometry(videoEvidence, resolution) {
  enumValue(resolution, RESOLUTIONS, 'Resolution');
  const geometry = videoEvidence?.geometry;
  if (!plain(geometry)) fail('GEOMETRY_UNKNOWN', 'Video geometry is unavailable.');
  const width = evidenceInteger(geometry.width, 'GEOMETRY_UNKNOWN', 'Coded width', { minimum: 1n, maximum: 1048576n });
  const height = evidenceInteger(geometry.height, 'GEOMETRY_UNKNOWN', 'Coded height', { minimum: 1n, maximum: 1048576n });
  const source = { width: Number(width), height: Number(height) };
  if (resolution === 'source') {
    const sourceSar = geometry.sampleAspectRatio?.state === 'known'
      ? evidenceRational(geometry.sampleAspectRatio, 'GEOMETRY_SAR_UNKNOWN', 'Sample aspect ratio', { positive: true }) : null;
    return freeze({ requested: resolution, filterRequired: false, mode: 'preserve-source', source,
      output: { ...source, sampleAspectRatio: packed(sourceSar), orientation: 'preserve-source' }, qualification: 'existing-source-path', notices: ['Source SAR and orientation remain source-owned; no values are invented.'] });
  }
  if (geometry.issues?.length) fail('GEOMETRY_CONFLICT', 'Source display geometry contains contradictory evidence.');
  const sar = evidenceRational(geometry.sampleAspectRatio, 'GEOMETRY_SAR_UNKNOWN', 'Sample aspect ratio', { positive: true });
  if (compare(sar, rat(1n, 1024n)) < 0 || compare(sar, rat(1024n)) > 0) fail('GEOMETRY_SAR_UNSUPPORTED', 'Sample aspect ratio exceeds the bounded geometry policy.');
  const [long, short] = BOXES[resolution];
  const unreported = geometry.rotationSource === 'not-reported'
    && ['rotationDegrees', 'legacyRotationDegrees', 'displayMatrix'].every(field => geometry[field]?.state === 'unknown');
  const unrotatedWidth = mul(rat(width), sar), unrotatedHeight = rat(height);
  const landscape = compare(unrotatedWidth, unrotatedHeight) >= 0;
  const [longer, shorter] = landscape ? [unrotatedWidth, unrotatedHeight] : [unrotatedHeight, unrotatedWidth];
  // The box turns with the displayed picture (see below), and an orthogonal
  // rotation only swaps the display sides, so whether the picture already fits
  // never depends on orientation. With no reported orientation at all, such a
  // request needs no interpretation; every real resize still requires one.
  if (unreported && compare(longer, rat(BigInt(long))) <= 0 && compare(shorter, rat(BigInt(short))) <= 0) {
    return freeze({ requested: resolution, mode: 'already-fits', filterRequired: false, source,
      display: { width: packed(unrotatedWidth), height: packed(unrotatedHeight), rotationDegrees: null },
      box: landscape ? { width: long, height: short } : { width: short, height: long },
      output: { ...source, sampleAspectRatio: packed(sar), orientation: 'preserve-source' },
      qualification: 'existing-source-path', notices: ['No upscaling or unnecessary SAR normalization.', 'Fitting does not depend on orientation; the unreported source orientation is left unchanged.'] });
  }
  const degrees = orientation(geometry);
  let displayWidth = mul(rat(width), sar), displayHeight = rat(height);
  if (degrees === 90 || degrees === 270) [displayWidth, displayHeight] = [displayHeight, displayWidth];
  const [boxWidth, boxHeight] = compare(displayWidth, displayHeight) >= 0 ? [long, short] : [short, long];
  const display = { width: packed(displayWidth), height: packed(displayHeight), rotationDegrees: degrees };
  if (compare(displayWidth, rat(BigInt(boxWidth))) <= 0 && compare(displayHeight, rat(BigInt(boxHeight))) <= 0) {
    return freeze({ requested: resolution, mode: 'already-fits', filterRequired: false, source, display, box: { width: boxWidth, height: boxHeight }, output: { ...source, sampleAspectRatio: packed(sar), orientation: 'preserve-source' }, qualification: 'existing-source-path', notices: ['No upscaling or unnecessary SAR normalization.'] });
  }
  if (geometry.fieldOrder?.state !== 'known' || geometry.fieldOrder.value !== 'progressive') fail('GEOMETRY_INTERLACE_UNQUALIFIED', 'Resizing requires positively identified progressive video; no automatic deinterlacing.');
  const factorW = div(rat(BigInt(boxWidth)), displayWidth), factorH = div(rat(BigInt(boxHeight)), displayHeight);
  const factor = compare(factorW, factorH) < 0 ? factorW : factorH;
  const idealW = mul(displayWidth, factor), idealH = mul(displayHeight, factor), dar = div(displayWidth, displayHeight);
  function alignedChoices(ideal, maximum, original) {
    const lower = ideal.n / (ideal.d * 2n) * 2n;
    return [...new Set([lower, lower + 2n])].filter(value => value >= 2n && value <= BigInt(maximum) && compare(rat(value), original) <= 0);
  }
  const candidates = [];
  for (const w of alignedChoices(idealW, boxWidth, displayWidth)) for (const h of alignedChoices(idealH, boxHeight, displayHeight)) {
    candidates.push({ w, h, error: div(absolute(sub(rat(w, h), dar)), dar) });
  }
  if (!candidates.length) fail('GEOMETRY_TOO_SMALL', 'The source cannot fit even output dimensions without upscaling.');
  candidates.sort((a, b) => compare(a.error, b.error) || (a.w * a.h > b.w * b.h ? -1 : 1));
  const selected = candidates[0], square = compare(selected.error, rat(1n, 1000n)) <= 0;
  const outputSar = square ? rat(1n) : mul(dar, rat(selected.h, selected.w));
  return freeze({ requested: resolution, mode: 'downscale', filterRequired: true, source, display, box: { width: boxWidth, height: boxHeight }, scaleFactor: packed(factor),
    output: { width: Number(selected.w), height: Number(selected.h), sampleAspectRatio: packed(outputSar), rotationDegrees: 0 },
    aspectError: packed(square ? selected.error : rat(0n)), aspectTolerance: packed(rat(1n, 1000n)), alignment: 2,
    qualification: square ? 'scaler-backend-container-required' : 'non-square-output-sar-required',
    notices: ['Normalize the qualified orientation once, preserve cadence, and qualify subtitle canvas geometry.'] });
}

function timeEvidence(timeline, kind, required) {
  const isDuration = kind === 'duration';
  const ticks = timeline?.[isDuration ? 'durationTicks' : 'startPts'];
  const seconds = timeline?.[isDuration ? 'durationSeconds' : 'startSeconds'];
  const base = evidenceRational(timeline?.timeBase, 'RANGE_TIMELINE_MALFORMED', 'Time base', { positive: true, optional: true });
  let exact = null;
  if (ticks && ticks.state !== 'unknown') {
    const value = evidenceInteger(ticks, 'RANGE_TIMELINE_MALFORMED', `${kind} ticks`, { minimum: isDuration ? 0n : -9223372036854775808n, maximum: 9223372036854775807n });
    if (base) exact = mul(rat(value), base);
  }
  const decimal = evidenceRational(seconds, 'RANGE_TIMELINE_MALFORMED', `${kind} seconds`, { optional: true });
  if (exact && decimal && compare(absolute(sub(exact, decimal)), rat(1n, US)) > 0) fail('RANGE_TIMELINE_CONFLICT', `${kind} ticks and seconds disagree beyond one microsecond of reported decimal precision.`);
  const chosen = exact || decimal;
  if (isDuration && chosen && chosen.n <= 0n) fail('RANGE_DURATION_UNKNOWN', 'A positive video duration is required.');
  if (!chosen && required) fail(isDuration ? 'RANGE_DURATION_UNKNOWN' : 'RANGE_ORIGIN_UNKNOWN', `Video ${kind} is not known; do not guess its timeline.`);
  return chosen;
}

function resolveTimeRange(videoEvidence, range) {
  const requested = validateRangeRequest(range);
  if (requested === null) return freeze({ kind: 'full', requested: null, timestampMapping: 'preserve-source', qualification: 'existing-full-path' });
  evidenceRational(videoEvidence?.timeline?.timeBase, 'RANGE_TIME_BASE_UNKNOWN', 'Video time base', { positive: true });
  const origin = timeEvidence(videoEvidence?.timeline, 'start', true), duration = timeEvidence(videoEvidence?.timeline, 'duration', true);
  const floorDurationUs = duration.n * US / duration.d;
  if (floorDurationUs > SAFE || floorDurationUs < 1n) fail('RANGE_DURATION_UNSUPPORTED', 'Duration exceeds exact microsecond range handling.');
  const startUs = own(requested, 'startUs') ? requested.startUs : 0, endUs = own(requested, 'endUs') ? requested.endUs : Number(floorDurationUs);
  if (BigInt(endUs) > floorDurationUs) fail('RANGE_EXCEEDS_DURATION', 'Range end exceeds this file duration; it is not clamped.');
  if (endUs <= startUs) fail('INVALID_RANGE', 'Time Range must retain a nonempty interval.');
  const absoluteStart = add(origin, rat(BigInt(startUs), US)), absoluteEnd = add(origin, rat(BigInt(endUs), US));
  if ([origin, absoluteStart, absoluteEnd].some(value => compare(absolute(value), rat(AV_TIME_MAX, US)) > 0)) {
    fail('RANGE_TIMELINE_OVERFLOW', 'The absolute timeline exceeds signed 64-bit microsecond handling.');
  }
  return freeze({ kind: 'range', requested, resolved: { startUs, endUs }, sourceOrigin: packed(origin), sourceDuration: packed(duration),
    absoluteStart: packed(absoluteStart), absoluteEnd: packed(absoluteEnd),
    boundaryRule: 'presentation-pts-start-inclusive-end-exclusive', timestampMapping: 'subtract-one-common-absolute-start',
    durationEndpointRounding: 'floor-to-microsecond-without-extending-source', effectiveFrameBounds: 'requires-decoded-evidence',
    audioBoundaryTarget: 'one-source-sample-plus-declared-timestamp-quantization', qualification: 'seek-frame-audio-delay-padding-container-required' });
}

function resolveAudio(audioEvidence, options) {
  record(options, ['target', 'range', 'audioPolicy', 'aacBitrateKbps'], 'Audio request');
  const { target, range, audioPolicy, aacBitrateKbps = null } = options;
  enumValue(target, TARGETS, 'Target'); enumValue(audioPolicy, AUDIO_POLICIES, 'Audio policy');
  if (!plain(range) || !['full', 'range'].includes(range.kind)) fail('INVALID_OPERATION', 'Audio requires a resolved range contract.');
  if (!Array.isArray(audioEvidence) || audioEvidence.length > MAX_STREAMS) fail('INVALID_OPERATION', 'Audio evidence must be a bounded stream list.');
  if (aacBitrateKbps !== null) {
    exactInteger(aacBitrateKbps, 'AAC bitrate', 1536);
    if (audioPolicy !== 'precision-aac' || aacBitrateKbps < 32) fail('INVALID_AUDIO_BITRATE', 'A valid AAC bitrate applies only to precision AAC.');
  }
  if (audioPolicy === 'precision-flac' && target !== 'matroska') fail('AUDIO_CONTAINER_UNSUPPORTED', 'Precision FLAC is qualified only for Matroska targets.');
  const seen = new Set();
  const streams = audioEvidence.map(stream => {
    exactInteger(stream?.index, 'Audio stream index', MAX_STREAMS - 1);
    if (seen.has(stream.index)) fail('INVALID_OPERATION', 'Audio stream indexes must be unique.'); seen.add(stream.index);
    if (stream.codec?.type?.state !== 'known' || stream.codec.type.value !== 'audio') fail('AUDIO_TYPE_UNKNOWN', 'Every selected audio stream requires positive audio-type evidence.');
    if (audioPolicy === 'copy') {
      const codec = stream.codec.name?.state === 'known' ? stream.codec.name.value : null;
      if (codec !== null && (typeof codec !== 'string' || codec.length > 128 || !/^[a-z0-9_]+$/.test(codec))) fail('AUDIO_CODEC_UNKNOWN', 'Copied audio codec evidence is malformed.');
      return { index: stream.index, mode: 'copy', codec,
        timing: range.kind === 'full' ? 'preserve-source' : 'explicit-packet-boundaries', qualification: range.kind === 'full' ? 'container-copy-required' : 'packet-range-container-required' };
    }
    const audio = stream.audio;
    const rate = Number(evidenceInteger(audio?.sampleRate, 'AUDIO_RATE_UNKNOWN', 'Audio sample rate', { minimum: 1n, maximum: 10000000n }));
    if (![44100, 48000].includes(rate)) fail('AUDIO_RATE_UNQUALIFIED', 'Initial precision-audio cells preserve 44.1 or 48 kHz; this rate needs separate qualification, never automatic resampling.');
    const channels = Number(evidenceInteger(audio?.channels, 'AUDIO_LAYOUT_UNKNOWN', 'Audio channel count', { minimum: 1n, maximum: 1024n }));
    const layout = audio?.channelLayout?.state === 'known' ? audio.channelLayout.value : null;
    const limits = own(LAYOUTS, layout) ? LAYOUTS[layout] : null;
    if (!limits || limits.channels !== channels) fail('AUDIO_LAYOUT_UNQUALIFIED', 'The channel layout/count is unknown, contradictory or outside the initial precision policy; no silent downmix.');
    const common = { index: stream.index, mode: audioPolicy, sampleRate: rate, channels, channelLayout: layout, timestampMapping: range.timestampMapping,
      qualification: 'encoder-layout-rate-container-delay-padding-required', losslessOriginalClaim: false };
    if (audioPolicy === 'precision-aac') {
      const bitrate = aacBitrateKbps ?? limits.bitrate;
      const maximum = Math.min(limits.maximum, Math.floor(6 * rate * channels / 1000));
      if (bitrate < limits.minimum || bitrate > maximum) fail('INVALID_AUDIO_BITRATE', `${layout} AAC bitrate must be ${limits.minimum}–${maximum} kb/s at the preserved sample rate.`);
      return { ...common, codec: 'aac', profile: 'LC', bitrateKbps: bitrate, bitrateOrigin: aacBitrateKbps === null ? 'layout-policy' : 'explicit-file', sampleRepresentation: 'decoded-audio-lossy-reencode' };
    }
    if (layout === '5.1(side)') fail('AUDIO_LAYOUT_UNQUALIFIED', 'FLAC 5.1(side) preservation requires a separately verified channel-assignment path.');
    const format = audio?.sampleFormat?.state === 'known' ? audio.sampleFormat.value : null;
    if (!['s16', 's16p', 's32', 's32p'].includes(format)) fail('FLAC_SAMPLE_REPRESENTATION_UNQUALIFIED', 'FLAC requires a qualified integer PCM representation; floating-point conversion cannot be silently called lossless.');
    return { ...common, codec: 'flac', sampleRepresentation: 'preserve-integer-decoded-pcm', sourceSampleFormat: format, bitrateKbps: null };
  });
  return freeze({ policy: audioPolicy, streams, noResampling: true, noDownmix: true, noIndependentTimestampZeroing: true });
}

function buildOperationContract(options) {
  record(options, ['request', 'videoEvidence', 'audioEvidence'], 'Operation contract request');
  const { request, videoEvidence, audioEvidence = [] } = options;
  record(request, ['version', 'fileId', 'identityRevision', 'draftRevision', 'operation', 'appDefaultsRevision', 'target', 'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps', 'origins', 'omissionRequestIds', 'omissionAuthority'], 'Resolved file request');
  if (request.version !== OPERATION_CONTRACT_VERSION || request.omissionAuthority !== 'unbound-request-ids') fail('INVALID_OPERATION', 'Unknown operation request schema or claimed omission authority.');
  const validated = resolveFileRequest({ fileId: request.fileId, identityRevision: request.identityRevision, draftRevision: request.draftRevision, operation: request.operation,
    overrides: { target: request.target, resolution: request.resolution, hdrPolicy: request.hdrPolicy, range: request.range, audioPolicy: request.audioPolicy,
      aacBitrateKbps: request.aacBitrateKbps, omissionRequestIds: request.omissionRequestIds } });
  exactInteger(request.appDefaultsRevision, 'App defaults revision');
  record(request.origins, Object.keys(validated.origins), 'Request origins');
  const origins = {};
  for (const key of Object.keys(validated.origins)) origins[key] = enumValue(request.origins[key], ORIGINS, 'Request origin');
  const requestSnapshot = { ...validated, appDefaultsRevision: request.appDefaultsRevision, origins };
  const geometry = resolveGeometry(videoEvidence, validated.resolution), range = resolveTimeRange(videoEvidence, validated.range);
  const audio = resolveAudio(audioEvidence, { target: validated.target, range, audioPolicy: validated.audioPolicy, aacBitrateKbps: validated.aacBitrateKbps });
  return freeze({ version: OPERATION_CONTRACT_VERSION, request: requestSnapshot, geometry, range, audio,
    hdr: { policy: validated.hdrPolicy, qualification: 'source-color-and-selected-transform-required' },
    omissionRequests: { ids: [...validated.omissionRequestIds], authority: 'none', requiresMainIdentityAndRevisionBinding: true },
    status: 'descriptive-unqualified-contract', argv: null });
}

module.exports = { OPERATION_CONTRACT_VERSION, OPERATION_DEFAULTS, createBatchDefaults, resolveFileRequest, resolveGeometry, resolveTimeRange, resolveAudio, buildOperationContract };
