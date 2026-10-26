'use strict';

const { createHash } = require('node:crypto');
const { normalizeProbe, INSPECTION_POLICY } = require('./inspection.cjs');
const { EVIDENCE_VERSION, EVIDENCE_LIMITS } = require('./media-evidence.cjs');
const { validateNativeSettings, nativeEncoderContribution } = require('./backend-adapters.cjs');

// Pure engineering contract only. No collector, file, runtime, qualification,
// executable command, prepared grant or publication is created by this module.
const VERSION = 1, ID = 'native-file-h264-bt709-full-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const descriptions = new WeakMap();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function record(value, keys, label) {
  if (!plain(value)) fail('INVALID_NATIVE_FILE_REQUEST', `${label} must be an inert record.`);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !keys.includes(key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail('INVALID_NATIVE_FILE_REQUEST', `${label} has unknown, missing or accessor fields.`);
}
function inert(value, depth = 0, budget = { nodes: 0, characters: 0 }) {
  if (++budget.nodes > EVIDENCE_LIMITS.nodes || depth > EVIDENCE_LIMITS.depth) return false;
  if (typeof value === 'string') return value.length <= EVIDENCE_LIMITS.string && !value.includes('\0')
    && (budget.characters += value.length) <= EVIDENCE_LIMITS.characters;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!plain(value) && !Array.isArray(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (Array.isArray(value) && (Object.getPrototypeOf(value) !== Array.prototype || value.length > EVIDENCE_LIMITS.nodes || keys.length !== value.length + 1
      || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)))) return false;
  if (keys.length > EVIDENCE_LIMITS.nodes) return false;
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || key.length > EVIDENCE_LIMITS.string || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value')
        || !inert(fields[key].value, depth + 1, budget)) return false;
  }
  return true;
}
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function stable(value) { return Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function normalized(probe) {
  if (!inert(probe)) fail('NATIVE_FILE_PROBE_INVALID', 'Source evidence is not bounded inert data.');
  return normalizeProbe(probe); // Rebuild typed evidence; saved mediaEvidence is not trusted.
}
const CANDIDATE = freeze({ schema: VERSION, id: ID, kind: 'engineering-proposal', qualificationStatus: 'unqualified',
  sourceCodec: 'h264', sourceProfile: 'High', width: 1280, height: 720, frameRate: '30/1', minimumDeclaredFrames: 15, maximumDeclaredFrames: 900,
  maximumSourceBytes: '134217728', outputCodec: 'h264', outputBitDepth: 8, target: 'matroska', videoOnly: true,
  scope: 'Full/KeepSource BT709-limited progressive source; no active file policy or sample-to-file qualification.' });

function validateNativeFileRequest(value) {
  record(value, ['schema', 'kind', 'operation', 'fileId', 'identityRevision', 'draftId', 'draftRevision', 'profileId', 'settings', 'bitDepth',
    'target', 'resolution', 'range', 'signal', 'hdrPolicy', 'audioPolicy', 'omissionRequestIds'], 'Native file request');
  if (value.schema !== VERSION || value.kind !== 'native-file' || value.operation !== 'encode'
      || typeof value.fileId !== 'string' || !UUID.test(value.fileId) || typeof value.draftId !== 'string' || !UUID.test(value.draftId)
      || ![value.identityRevision, value.draftRevision].every(number => Number.isSafeInteger(number) && number >= 0)
      || !['h264-amf', 'h264-qsv'].includes(value.profileId) || value.bitDepth !== 8 || value.target !== 'matroska' || value.resolution !== 'source'
      || value.range !== null || value.signal !== 'sdr' || value.hdrPolicy !== 'sdr' || value.audioPolicy !== 'copy'
      || !Array.isArray(value.omissionRequestIds) || value.omissionRequestIds.length || !inert(value.omissionRequestIds)) {
    fail('NATIVE_FILE_REQUEST_UNSUPPORTED', 'The engineering native file route requires explicit H2648 Full/KeepSource video-only SDR without omissions.');
  }
  // hdrPolicy=sdr here is a source precondition, never an HDR conversion.
  return freeze({ ...value, settings: validateNativeSettings(value.profileId, value.settings), omissionRequestIds: [] });
}
function fingerprintNativeFileSource(probe) {
  return hash({ contractVersion: VERSION, inspectionPolicy: INSPECTION_POLICY, mediaEvidenceVersion: EVIDENCE_VERSION, probe: normalized(probe) });
}
const text = field => field?.state === 'known' ? field.value : null;
const integer = field => field?.state === 'known' && /^-?\d{1,40}$/.test(field.value) ? BigInt(field.value) : null;
function rational(field) {
  const value = field?.state === 'known' && field.value;
  return value && /^-?\d{1,40}$/.test(value.numerator) && /^[1-9]\d{0,39}$/.test(value.denominator)
    ? { n: BigInt(value.numerator), d: BigInt(value.denominator) } : null;
}
const equal = (a, b) => a && b && a.n * b.d === b.n * a.d;
const zero = field => { const value = rational(field); return value && value.n === 0n; };
function roundedMicroseconds(raw, exact) {
  if (typeof raw !== 'string' || !/^\d{1,12}\.\d{6}$/.test(raw) || !exact || exact.n < 0n) return false;
  const units = BigInt(raw.replace('.', '')), expected = (exact.n * 1000000n * 2n + exact.d) / (2n * exact.d);
  return units === expected; // Exact declared six-decimal rounding, not an empirical tolerance.
}
function describeNativeFileSource(options) {
  record(options, ['probe', 'sourceBytes', 'request'], 'Native source description');
  const request = validateNativeFileRequest(options.request), reasons = [];
  let probe;
  try { probe = normalized(options.probe); } catch { reasons.push('NATIVE_FILE_PROBE_INVALID'); }
  const size = typeof options.sourceBytes === 'string' && /^[1-9]\d{0,11}$/.test(options.sourceBytes) ? BigInt(options.sourceBytes) : null;
  if (size === null || size > BigInt(CANDIDATE.maximumSourceBytes)) reasons.push('NATIVE_FILE_SOURCE_SIZE');
  let facts = null, fingerprint = null;
  if (probe) {
    fingerprint = hash({ contractVersion: VERSION, inspectionPolicy: INSPECTION_POLICY, mediaEvidenceVersion: EVIDENCE_VERSION, probe });
    const media = probe.mediaEvidence, stream = probe.streams.find(value => value.codec_type === 'video'), evidence = media.streams.find(value => value.index === stream?.index);
    if (probe.streams.length !== 1 || !stream || !Number.isSafeInteger(stream.index) || stream.index < 0 || !evidence) reasons.push('NATIVE_FILE_SINGLE_VIDEO_REQUIRED');
    if (evidence) {
      const g = evidence.geometry, t = evidence.timeline, c = evidence.color, container = media.container;
      if (text(evidence.codec.name) !== 'h264' || text(evidence.codec.type) !== 'video' || text(evidence.codec.profile) !== 'High') reasons.push('NATIVE_FILE_SOURCE_CODEC');
      if (integer(g.width) !== 1280n || integer(g.height) !== 720n || !equal(rational(g.sampleAspectRatio), { n: 1n, d: 1n })
          || !equal(rational(g.displayAspectRatio), { n: 16n, d: 9n }) || text(g.fieldOrder) !== 'progressive' || g.issues?.length) reasons.push('NATIVE_FILE_SOURCE_GEOMETRY');
      // Missing orientation stays unknown and needs an exact-source oracle.
      // Explicit rotation/matrix/other side data is outside this first proposal.
      if (g.rotationSource !== 'not-reported' || (stream.side_data_list || []).length || Object.hasOwn(stream.tags || {}, 'rotate')) reasons.push('NATIVE_FILE_SOURCE_ORIENTATION_OR_SIDE_DATA');
      if (['pixelFormat', 'primaries', 'transfer', 'matrix', 'range', 'chromaLocation'].some((key, index) => text(c[key]) !== ['yuv420p', 'bt709', 'bt709', 'bt709', 'tv', 'left'][index])
          || evidence.hdr.entries.length) reasons.push('NATIVE_FILE_SOURCE_COLOR');
      const frames = integer(t.frameCount), timeBase = rational(t.timeBase), ticks = integer(t.durationTicks), duration = frames === null ? null : { n: frames, d: 30n };
      if (!equal(rational(t.averageFrameRate), { n: 30n, d: 1n }) || !equal(rational(t.nominalFrameRate), { n: 30n, d: 1n })
          || frames === null || frames < 15n || frames > 900n || !timeBase || timeBase.n <= 0n || ticks === null || ticks <= 0n
          || !equal(timeBase && ticks !== null ? { n: timeBase.n * ticks, d: timeBase.d } : null, duration)
          || integer(t.startPts) !== 0n || !zero(t.startSeconds) || !zero(container.startSeconds)
          || !roundedMicroseconds(stream.duration, duration) || !roundedMicroseconds(probe.format.duration, duration)) reasons.push('NATIVE_FILE_SOURCE_TIMELINE');
      if (!['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'].includes(text(container.name)) || integer(container.size) !== size) reasons.push('NATIVE_FILE_SOURCE_CONTAINER');
      if (container.relationships.state !== 'known' || integer(container.relationships.reportedStreamCount) !== 1n
          || container.relationships.observedStreamCount !== 1 || container.relationships.issues.length
          || [container.programs, container.streamGroups].some(value => value.state !== 'known' || value.value.length)
          || !Array.isArray(probe.programs) || !Array.isArray(probe.stream_groups) || probe.programs.length || probe.stream_groups.length
          || !Object.hasOwn(options.probe, 'chapters') || !Array.isArray(options.probe.chapters) || probe.chapters.length) reasons.push('NATIVE_FILE_SOURCE_RELATIONSHIPS');
      if (!plain(stream.disposition) || !Object.hasOwn(stream.disposition, 'default') || ![0, 1].includes(stream.disposition.default)
          || Object.entries(stream.disposition).some(([key, value]) => key !== 'default' && value !== 0)) reasons.push('NATIVE_FILE_SOURCE_DISPOSITION');
      facts = { videoIndex: stream.index, codec: evidence.codec, geometry: g, timeline: t, color: c, hdr: evidence.hdr,
        declaredFrameCount: frames === null ? null : frames.toString(), sourceBytes: size === null ? null : size.toString(), container,
        streamLayout: probe.streams.map(value => ({ index: value.index, type: value.codec_type })), decodedFrameProof: 'not-collected',
        orientationAbsence: 'unverified', hdrAbsence: 'stream-metadata-only-is-not-complete-proof' };
    }
  }
  const result = freeze({ schema: VERSION, contractId: ID, status: reasons.length ? 'outside-contract' : 'structurally-eligible-unqualified',
    reasonCodes: [...new Set(reasons)], sourceProbeFingerprint: fingerprint, facts,
    qualificationRequirements: ['main-held-complete-source-identity-and-sha256', 'exact-source-decoded-frame-and-header-oracle', 'qualified-orientation-and-HDR-absence',
      'independent-native-file-policy', 'fresh-exact-device-runtime-selection', 'same-job-effective-mode-proof', 'complete-output-source-validation'], executionAuthority: 'none' });
  descriptions.set(result, { requestHash: hash(request), probe, facts }); return result;
}
function buildNativeFileContract(options) {
  record(options, ['request', 'applicability'], 'Native file contract');
  const request = validateNativeFileRequest(options.request), owned = descriptions.get(options.applicability);
  if (!owned || owned.requestHash !== hash(request)) fail('NATIVE_FILE_APPLICABILITY_STALE', 'Use the genuine current source description for this exact request.');
  if (options.applicability.status !== 'structurally-eligible-unqualified') fail('NATIVE_FILE_SOURCE_UNSUPPORTED', 'This source is outside the native file engineering contract.');
  const settings = request.settings, fragment = nativeEncoderContribution(request.profileId, { preset: settings.preset, mode: settings.mode, quality: settings.quality }, { bitDepth: request.bitDepth });
  return freeze({ schema: VERSION, id: ID, kind: 'native-file-contract', request, sourceProbeFingerprint: options.applicability.sourceProbeFingerprint,
    inspectionPolicy: { ...INSPECTION_POLICY }, mediaEvidenceVersion: EVIDENCE_VERSION, sourceFacts: owned.facts,
    encoderContribution: fragment, expectedOutput: { target: 'matroska', videoIndex: 0, sourceVideoIndex: owned.facts.videoIndex,
      codec: 'h264', profile: 'High', bitDepth: 8, pixelFormat: 'yuv420p', width: 1280, height: 720, sampleAspectRatio: '1/1', displayAspectRatio: '16/9',
      frameRate: '30/1', declaredFrames: owned.facts.declaredFrameCount, signal: 'bt709-limited-sdr', range: 'Full', resolution: 'KeepSource',
      audio: 'not-applicable', retainedVideoStreams: 1, otherStreams: 0, chapters: 0, omissions: [],
      timestampPolicy: 'exact-source-and-container-clock-qualification-required', metadataPolicy: 'preserve-source-tags-and-dispositions-plus-descriptive-generation' },
    qualificationRequirements: options.applicability.qualificationRequirements, status: 'unqualified', fileExecutionReady: false, executionAuthority: 'none' });
}

module.exports = { NATIVE_FILE_CONTRACT_VERSION: VERSION, NATIVE_FILE_CANDIDATE: CANDIDATE,
  validateNativeFileRequest, fingerprintNativeFileSource, describeNativeFileSource, buildNativeFileContract };
