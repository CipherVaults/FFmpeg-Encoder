'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');
const { ToolError } = require('./process-runner.cjs');
const { PROFILES, validateSettings, selectVideo, mappedStreams, buildEncodeArgs } = require('./media.cjs');
const { normalizeProbe, validateOutput } = require('./inspection.cjs');
const { buildOperationContract, resolveFileRequest } = require('./operation-contract.cjs');
const { classifyMarker } = require('./provenance.cjs');
const { FORMATS, assertTelemetryBinding, assertCollectedTelemetry } = require('./operation-telemetry.cjs');
const { validateContainerClock } = require('./container-clock.cjs');
const PACKET_CLOCK = 'matroska-packet-end-plus-codec-delay';
// Record 47 Q2b: Matroska stores a copied AAC stream's end plus its own codec
// delay, so the whole-file copy clock is the decoded end plus the observed delay.
const COPY_CLOCK = 'matroska-copy-end-plus-codec-delay';

// Canonical main-side SDR operation builder. It never launches a child or accepts
// renderer filter strings. Native qualification owns runtime support and measured
// tolerances; an executable argv is not itself execution authority or acceptance.
const ENCODE_OPERATION_VERSION = 1;
const plans = new WeakMap();
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };
function record(value, allowed, required, label) {
  if (!plain(value) || required.some(key => !own(value, key))) fail('INVALID_ENCODE_OPERATION', `${label} is missing required fields.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor?.enumerable || !own(descriptor, 'value')) fail('INVALID_ENCODE_OPERATION', `${label} contains an unsupported field.`);
  }
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fingerprintEncodeSource(probe) { return hash(normalizeProbe(probe)); }
function rat(value) {
  if (!plain(value) || !/^-?\d{1,40}$/.test(value.numerator) || !/^\d{1,40}$/.test(value.denominator) || BigInt(value.denominator) <= 0n) fail('INVALID_ENCODE_OPERATION', 'A bounded positive-denominator rational is required.');
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
}
function ceil(n, d) { const q = n / d, r = n % d; return q + (r > 0n ? 1n : 0n); }
function ticks(boundary, timeBase) {
  const a = rat(boundary), b = rat(timeBase);
  if (b.n <= 0n) fail('ENCODE_TIME_BASE_UNKNOWN', 'The filter time base must be positive.');
  const value = ceil(a.n * b.d, a.d * b.n);
  if (value < -9223372036854775808n || value > 9223372036854775807n) fail('ENCODE_TIMELINE_OVERFLOW', 'A filter boundary exceeds signed 64-bit ticks.');
  return value.toString();
}
function packedRational(n, d) {
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / (a || 1n)), denominator: String(d / (a || 1n)) };
}
function integerOrigin(range, timeBase, inputIndex) {
  const start = rat(range.absoluteStart), base = rat(timeBase);
  if (base.n <= 0n || base.n > 2147483647n || base.d > 2147483647n) fail('ENCODE_TIME_BASE_UNKNOWN', 'An exact supported filter time base is required.');
  const numerator = start.n * base.d, denominator = start.d * base.n;
  let origin = numerator / denominator;
  const remainder = numerator % denominator, magnitude = remainder < 0n ? -remainder : remainder;
  if (magnitude * 2n >= denominator) origin += numerator < 0n ? -1n : 1n;
  const begin = BigInt(ticks(range.absoluteStart, timeBase)), end = BigInt(ticks(range.absoluteEnd, timeBase));
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  // FFmpeg's setpts evaluator stores doubles. Integer literals, selected PTS,
  // and their differences must all be exactly representable. Reject rather
  // than rounding an extreme timeline into an apparently valid interval.
  for (const value of [origin, begin, end, begin - origin, end - origin]) {
    if (value < -limit || value > limit) fail('ENCODE_FILTER_INTEGER_UNSAFE', 'This timeline exceeds the exact integer range of the FFmpeg timestamp expression evaluator.');
  }
  return { inputIndex, filterTimeBase: structuredClone(timeBase), originTicks: String(origin),
    effectiveOrigin: packedRational(origin * base.n, base.d),
    originMinusRequestedStart: packedRational(origin * base.n * start.d - start.n * base.d, base.d * start.d),
    rounding: 'nearest-tick-ties-away-from-zero', exactIntegerLimit: String(limit) };
}
const subtractOrigin = origin => `PTS-(${origin.originTicks})`;
function fraction(value) { const item = rat(value); return `(${item.n}/${item.d})`; }
function micros(value) { const item = rat(value); return Number(item.n) * 1000000 / Number(item.d); }
function rationalNumber(value) {
  if (typeof value !== 'string') return null;
  const match = /^(-?\d+)[:/]([1-9]\d*)$/.exec(value);
  return match ? Number(match[1]) / Number(match[2]) : null;
}
function insertBeforeInput(args, options) { args.splice(args.indexOf('-i'), 0, ...options); }
function outputOptions(args, options) { args.splice(args.length - 5, 0, ...options); }

function sourceOrientation(geometry) {
  const fields = ['rotationDegrees', 'displayMatrix', 'legacyRotationDegrees'];
  if (fields.some(field => geometry[field]?.state === 'malformed')
      || geometry.rotationSource === 'display-matrix' && (geometry.displayMatrix?.state !== 'known' || geometry.rotationDegrees?.state !== 'known')
      || geometry.rotationSource === 'legacy-rotate-tag' && geometry.legacyRotationDegrees?.state !== 'known') {
    fail('ENCODE_ORIENTATION_UNQUALIFIED', 'The reported source orientation is incomplete or malformed; it cannot be silently flattened by a changed operation.');
  }
  return Object.fromEntries(fields.map(field => [field, structuredClone(geometry[field])]));
}

function flacPrecision(audio, evidence) {
  const storageBits = audio.sourceSampleFormat.startsWith('s16') ? 16 : 32;
  const reported = evidence.audio.bitsPerRawSample;
  const significant = reported.state === 'known' && reported.value !== '0' ? Number(reported.value) : null;
  if (reported.state === 'malformed'
      || significant !== null && (!/^[1-9]\d?$/.test(reported.value) || significant > storageBits)
      || storageBits === 32 && (reported.state !== 'known' || !['16', '20', '24'].includes(reported.value))) {
    fail('ENCODE_FLAC_PRECISION_UNQUALIFIED', 'FLAC needs a known supported significant-bit depth within its decoded storage; unknown 32-bit precision cannot be reduced silently.');
  }
  return { inputIndex: audio.index, minimumSignificantBits: significant ?? storageBits,
    storageBits, pcmFormat: storageBits === 16 ? 's16le-interleaved' : 's32le-interleaved',
    contentValidation: 'entire-selected-decoded-pcm-sha256-byte-and-sample-identity' };
}

function ordinaryRequest(request) {
  const keys = ['version', 'fileId', 'identityRevision', 'draftRevision', 'operation', 'appDefaultsRevision', 'target', 'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps', 'origins', 'omissionRequestIds', 'omissionAuthority'];
  record(request, keys, keys, 'Resolved file request');
  if (request.version !== 1 || request.omissionAuthority !== 'unbound-request-ids') fail('INVALID_ENCODE_OPERATION', 'Unknown request schema or claimed authority.');
  const validated = resolveFileRequest({ fileId: request.fileId, identityRevision: request.identityRevision, draftRevision: request.draftRevision,
    operation: request.operation, overrides: { target: request.target, resolution: request.resolution, hdrPolicy: request.hdrPolicy,
      range: request.range, audioPolicy: request.audioPolicy, aacBitrateKbps: request.aacBitrateKbps, omissionRequestIds: request.omissionRequestIds } });
  finite(request.appDefaultsRevision, 'Defaults revision', { integer: true, minimum: 0 });
  const originKeys = Object.keys(validated.origins);
  record(request.origins, originKeys, originKeys, 'Effective setting origins');
  if (Object.values(request.origins).some(value => !['factory', 'app', 'batch', 'file', 'not-applicable'].includes(value))) fail('INVALID_ENCODE_OPERATION', 'Unknown setting origin.');
  return validated.operation === 'encode' && validated.target === 'matroska' && validated.resolution === 'source'
    && ['preserve', 'sdr'].includes(validated.hdrPolicy) && validated.range === null && validated.audioPolicy === 'copy'
    && validated.omissionRequestIds.length === 0;
}

function buildCompatibility(options) {
  const { input, output, outputId, generationDescription, runtimeIdentity = null } = options;
  const settings = validateSettings(options.settings), probe = structuredClone(options.inspection.probe), color = structuredClone(options.inspection.color);
  const preservation = options.preservationSelection === undefined ? null
    : require('./encode-preservation.cjs').getEncodePreservationSelection(options.preservationSelection, probe);
  const video = selectVideo(probe), mapped = mappedStreams(probe, video, options.preservationSelection);
  const args = buildEncodeArgs({ input, output, settings, probe, colorEvidence: color, runtimeIdentity,
    ...(preservation ? { preservationSelection: options.preservationSelection } : {}),
    ...(outputId === undefined ? {} : { outputId }), ...(generationDescription === undefined ? {} : { generationDescription }) });
  // Do not make old Full admission depend on newly added relationship/geometry
  // fields. This exact path retains the established builder and validator.
  const request = structuredClone(options.request);
  const contract = { version: 1, request, geometry: { requested: 'source', filterRequired: false, mode: 'preserve-source',
    output: { width: video.width ?? null, height: video.height ?? null, sampleAspectRatio: null, orientation: 'preserve-source' } },
  range: { kind: 'full', requested: null, timestampMapping: 'preserve-source' },
  audio: { policy: 'copy', streams: mapped.filter(stream => stream.codec_type === 'audio').map(stream => ({ index: stream.index, mode: 'copy', codec: stream.codec_name })) },
  omissionRequests: preservation ? { ids: [...preservation.decisionIds], authority: 'main-owned-full-preservation-selection' } : { ids: [], authority: 'none' },
  ...(preservation ? { preservation } : {}) };
  const result = freeze({ version: ENCODE_OPERATION_VERSION, args, contract, compatibilityPath: !preservation, runtimeIdentity,
    ...(preservation ? { validationMode: 'full-preservation-selection' } : {}),
    planFingerprint: hash({ settings, probe, color, request, runtimeIdentity, outputId: outputId ?? null,
      ...(preservation ? { preservation } : {}) }),
    expectedOutput: { version: ENCODE_OPERATION_VERSION, operation: 'encode', target: 'matroska', sourceVideoIndex: video.index,
      geometry: contract.geometry, range: contract.range, audio: contract.audio, color, outputId: outputId ?? null,
      streams: mapped.map((stream, outputIndex) => ({ inputIndex: stream.index, outputIndex, codecType: stream.codec_type, codecName: outputIndex === 0
        ? { H264: 'h264', H265: 'hevc', AV1: 'av1' }[PROFILES.find(profile => profile.id === settings.profileId).codec] : stream.codec_name })),
      ...(preservation ? { omittedStreams: preservation.omittedStreams, removedRelationships: preservation.removedRelationships } : {}),
      decodedEvidenceRequired: false, measuredTolerancesRequired: false,
      timestampPolicy: preservation ? 'full-source-retained-streams-with-acknowledged-timed-track-loss' : 'accepted-full-compatibility-path' },
    qualificationRequirements: preservation ? ['main-owned-full-preservation-selection', 'explicit-timed-track-and-relationship-loss'] : [], executionAuthority: 'main-owned-prepared-plan-required' });
  plans.set(result, { input, probe, color, settings, duration: options.inspection.duration,
    ...(preservation ? { preservationSelection: options.preservationSelection } : {}) });
  return result;
}

function buildEncodeOperation(options) {
  const allowed = ['input', 'output', 'settings', 'inspection', 'request', 'outputId', 'generationDescription', 'runtimeIdentity', 'identityOrientationQualification', 'preservationSelection'];
  record(options, allowed, ['input', 'output', 'settings', 'inspection', 'request'], 'Encode operation');
  const { input, output, outputId, generationDescription, runtimeIdentity = null } = options;
  record(options.inspection, ['probe', 'color', 'duration', 'evidence', 'summary', 'warnings', 'sampling', 'cache'], ['probe', 'color'], 'Inspection');
  if (own(options, 'preservationSelection')) {
    if (!ordinaryRequest(options.request) || options.identityOrientationQualification !== undefined) fail('ENCODE_PRESERVATION_SETTINGS', 'An acknowledged timed-track loss applies only to the unchanged Full/Keep Source media operation.');
    require('./encode-preservation.cjs').assertEncodePreservationBuilder(options.preservationSelection,
      { probe: options.inspection.probe, input: options.input, settings: options.settings, request: options.request, runtimeIdentity: options.runtimeIdentity });
    return buildCompatibility(options);
  }
  if (ordinaryRequest(options.request)) {
    if (options.identityOrientationQualification !== undefined) fail('INVALID_ENCODE_OPERATION', 'Keep Source does not consume an orientation override.');
    return buildCompatibility(options);
  }
  const probe = normalizeProbe(options.inspection.probe), color = structuredClone(options.inspection.color);
  const settings = validateSettings(options.settings), video = selectVideo(probe), mapped = mappedStreams(probe, video);
  const videoEvidence = structuredClone(probe.mediaEvidence.streams.find(stream => stream.index === video.index));
  let orientationQualification = null;
  if (options.identityOrientationQualification !== undefined) {
    const value = options.identityOrientationQualification;
    record(value, ['evidenceId', 'runtimeIdentity', 'sourceEvidenceFingerprint', 'videoIndex'], ['evidenceId', 'runtimeIdentity', 'sourceEvidenceFingerprint', 'videoIndex'], 'Identity-orientation qualification');
    if (typeof value.evidenceId !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(value.evidenceId) || value.runtimeIdentity !== runtimeIdentity
        || value.sourceEvidenceFingerprint !== hash(probe) || value.videoIndex !== video.index || options.request.resolution === 'source'
        || videoEvidence.geometry.rotationSource !== 'not-reported' || videoEvidence.geometry.rotationDegrees.state !== 'unknown'
        || videoEvidence.geometry.displayMatrix.state !== 'unknown' || videoEvidence.geometry.legacyRotationDegrees.state !== 'unknown') {
      fail('ENCODE_ORIENTATION_QUALIFICATION_MISMATCH', 'Only matching main-owned evidence may qualify absent rotation as identity; reported rotation is never overridden.');
    }
    // No tag is invented in the preserved probe. This explicit qualification
    // interprets the absence for one runtime/source, and remains visible in the
    // ExpectedOutput contract. Main must never source this record from renderer.
    videoEvidence.geometry.rotationSource = 'qualified-identity';
    videoEvidence.geometry.rotationDegrees = { state: 'known', value: { numerator: '0', denominator: '1' } };
    orientationQualification = structuredClone(value);
  }
  const audioEvidence = mapped.filter(stream => stream.codec_type === 'audio').map(stream => probe.mediaEvidence.streams.find(item => item.index === stream.index));
  const contract = buildOperationContract({ request: options.request, videoEvidence, audioEvidence });
  if (contract.request.operation !== 'encode' || contract.request.target !== 'matroska'
      || !['preserve', 'sdr'].includes(contract.request.hdrPolicy)) fail('ENCODE_OPERATION_UNSUPPORTED', 'This builder implements SDR Encode to Matroska only; HDR routes use their separately qualified builder.');
  if (contract.omissionRequests.ids.length) fail('ENCODE_OMISSION_UNBOUND', 'This path cannot authorize omissions from request IDs; use a separately bound per-file preservation plan.');
  const args = buildEncodeArgs({ input, output, settings, probe, colorEvidence: color, runtimeIdentity,
    ...(outputId === undefined ? {} : { outputId }), ...(generationDescription === undefined ? {} : { generationDescription }) });
  const isRange = contract.range.kind === 'range';
  const resize = contract.geometry.filterRequired;
  const precisionAudio = contract.audio.policy !== 'copy' && contract.audio.streams.length > 0;
  const compatibilityPath = !isRange && !resize && !precisionAudio;
  const requirements = [], videoFilters = [], audioFilters = [];
  const audioPrecision = [], preservedOrientation = !compatibilityPath && !resize ? sourceOrientation(videoEvidence.geometry) : null;
  let seek = null;
  const timestampOrigins = isRange ? { requestedCommonStart: structuredClone(contract.range.absoluteStart),
    policy: 'nearest-tick-ties-away-from-zero', video: null, audio: [] } : null;

  if (!compatibilityPath) {
    if (typeof runtimeIdentity !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(runtimeIdentity)) fail('ENCODE_RUNTIME_UNBOUND', 'A changed operation must bind its qualified paired runtime identity.');
    if (probe.mediaEvidence.container.relationships.state !== 'known' || probe.programs?.length || probe.stream_groups?.length) fail('ENCODE_RELATIONSHIPS_UNQUALIFIED', 'Changed operations require complete, unambiguous stream relationships with no unhandled program or group.');
    if (probe.streams.filter(stream => stream.codec_type === 'video' && Number(stream.disposition?.attached_pic || 0) !== 1).length !== 1) fail('ENCODE_ALTERNATE_VIDEO_UNQUALIFIED', 'Changed operations with alternate video need a separately qualified selection contract.');
    if ((isRange || resize) && mapped.some(stream => stream.codec_type === 'subtitle')) fail('ENCODE_SUBTITLE_TRANSFORM_UNQUALIFIED', 'This subtitle needs a qualified range or resized-canvas policy; it cannot be dropped or burned in silently.');
    if (isRange && probe.chapters.length) fail('ENCODE_CHAPTER_RANGE_UNQUALIFIED', 'Chapter intersection/rebasing must be qualified before this range can be prepared.');
    if (isRange && contract.audio.streams.some(stream => stream.mode === 'copy')) fail('ENCODE_PACKET_RANGE_UNQUALIFIED', 'Packet-copy audio is an explicit alternative whose range/container boundaries are not yet qualified.');
    for (const audio of contract.audio.streams) if (audio.mode === 'precision-flac') audioPrecision.push(flacPrecision(audio, audioEvidence.find(stream => stream.index === audio.index)));
    insertBeforeInput(args, ['-noautorotate', '-copyts']);
    if (resize) {
      const rotation = contract.geometry.display.rotationDegrees;
      const matrices = { bt709: 'bt709', bt470bg: 'bt601', smpte170m: 'bt601', smpte240m: 'smpte240m', fcc: 'fcc', bt2020nc: 'bt2020' };
      if (!own(matrices, video.color_space) || !['tv', 'pc'].includes(video.color_range)) fail('ENCODE_SCALE_COLOR_UNQUALIFIED', 'Resizing needs a known supported matrix/range; do not let a resolution change infer a different color conversion.');
      // FFmpeg display_rotation is counter-clockwise. Clear its instruction at
      // input, then apply the known orthogonal transform once in the real graph.
      insertBeforeInput(args, [`-display_rotation:${video.index}`, '0']);
      if (rotation === 90) videoFilters.push('transpose=cclock');
      else if (rotation === 180) videoFilters.push('hflip', 'vflip');
      else if (rotation === 270) videoFilters.push('transpose=clock');
      const geometry = contract.geometry.output;
      videoFilters.push(`scale=w=${geometry.width}:h=${geometry.height}:flags=lanczos+accurate_rnd:in_color_matrix=${matrices[video.color_space]}:out_color_matrix=${matrices[video.color_space]}:in_range=${video.color_range}:out_range=${video.color_range}`,
        `setsar=sar=${fraction(geometry.sampleAspectRatio)}:max=2147483647`, 'sidedata=mode=delete:type=DISPLAYMATRIX');
      outputOptions(args, ['-metadata:s:v:0', 'rotate=0']);
      requirements.push('scale-orientation-sar-pixel-format-and-ringing');
    }
    if (isRange) {
      const range = contract.range;
      // Retain one common requested A, quantized explicitly per filter time
      // base. Subtracting A/TB as a double can turn an exact integer origin into
      // 1200624.0000000002 and shift every later audio frame by one sample.
      // Integer subtraction preserves actual track delays/gaps; STARTPTS or
      // N/SR would erase them. Quantization remains visible in ExpectedOutput.
      const videoBase = videoEvidence.timeline.timeBase.value;
      timestampOrigins.video = integerOrigin(range, videoBase, video.index);
      videoFilters.unshift(`settb=expr=${videoBase.numerator}/${videoBase.denominator}`,
        `trim=start_pts=${ticks(range.absoluteStart, videoBase)}:end_pts=${ticks(range.absoluteEnd, videoBase)}`,
        `setpts=${subtractOrigin(timestampOrigins.video)}`);
      // Late input seek is only an efficiency hint. No accurate-seek discard or
      // guessed frame count replaces exact decoded PTS selection in the graph.
      if (range.resolved.startUs > 10000000) {
        const a = rat(range.absoluteStart), candidate = a.n * 1000000n / a.d - 5000000n;
        if (candidate >= 0n) {
          const decimal = `${candidate / 1000000n}.${String(candidate % 1000000n).padStart(6, '0')}`;
          seek = { absoluteUs: Number(candidate), prerollTargetUs: 5000000, verifiedBound: false };
          insertBeforeInput(args, ['-seek_timestamp', '1', '-ss', decimal, '-noaccurate_seek']);
        }
      }
      requirements.push('decoded-range-membership-vfr-late-seek-and-common-timestamp-origin');
      requirements.push('integer-origin-quantization-and-filter-timebase');
    }
    if (videoFilters.length) outputOptions(args, ['-filter:v:0', videoFilters.join(',')]);
    outputOptions(args, ['-enc_time_base:v:0', 'filter']);
    for (const [audioOrdinal, audio] of contract.audio.streams.entries()) {
      if (audio.mode === 'copy') continue;
      const filters = [];
      if (isRange) {
        const timeBase = { numerator: '1', denominator: String(audio.sampleRate) };
        const origin = integerOrigin(contract.range, timeBase, audio.index); timestampOrigins.audio.push(origin);
        // asettb changes timestamp units only, not PCM or sample rate. atrim's
        // sample ticks and the subsequent integer subtraction now share units.
        filters.push(`asettb=expr=1/${audio.sampleRate}`,
          `atrim=start_pts=${ticks(contract.range.absoluteStart, timeBase)}:end_pts=${ticks(contract.range.absoluteEnd, timeBase)}`,
          `asetpts=${subtractOrigin(origin)}`);
      }
      // Explicit same-rate/layout constraints cannot authorize a downmix or a
      // resample. Decoder/encoder/output evidence must establish these values.
      const codecOption = `-c:a:${audioOrdinal}`;
      const codecIndex = args.indexOf(codecOption);
      if (codecIndex < 0 || args[codecIndex + 1] !== 'copy' || args.lastIndexOf(codecOption) !== codecIndex)
        fail('ENCODE_CODEC_PLAN_MISMATCH', 'Precision audio requires exactly one mapped copy decision to replace.');
      args[codecIndex + 1] = audio.codec;
      const audioArgs = [`-ar:a:${audioOrdinal}`, String(audio.sampleRate),
        `-channel_layout:a:${audioOrdinal}`, audio.channelLayout, `-enc_time_base:a:${audioOrdinal}`, `1/${audio.sampleRate}`];
      if (audio.mode === 'precision-aac') audioArgs.push(`-profile:a:${audioOrdinal}`, 'aac_low', `-b:a:${audioOrdinal}`, `${audio.bitrateKbps}k`);
      else audioArgs.push(`-sample_fmt:a:${audioOrdinal}`, audio.sourceSampleFormat.startsWith('s16') ? 's16' : 's32');
      if (filters.length) audioArgs.push(`-filter:a:${audioOrdinal}`, filters.join(','));
      outputOptions(args, audioArgs);
      audioFilters.push({ inputIndex: audio.index, outputIndex: mapped.findIndex(stream => stream.index === audio.index), audioOrdinal, filters, ...audio });
    }
    if (precisionAudio) requirements.push('decoded-audio-count-layout-rate-delay-padding-and-av-sync');
    outputOptions(args, ['-avoid_negative_ts', 'disabled']);
    requirements.push('preservation-provenance-and-runtime-specific-output-validation');
  }

  const expected = { version: ENCODE_OPERATION_VERSION, operation: 'encode', target: 'matroska', sourceVideoIndex: video.index,
    geometry: contract.geometry, range: contract.range, audio: contract.audio, audioPrecision, preservedOrientation, color: color,
    streams: mapped.map((stream, outputIndex) => ({ inputIndex: stream.index, outputIndex, codecType: stream.codec_type,
      codecName: outputIndex === 0 ? { H264: 'h264', H265: 'hevc', AV1: 'av1' }[PROFILES.find(profile => profile.id === settings.profileId).codec]
        : contract.audio.streams.find(audio => audio.index === stream.index)?.codec || stream.codec_name })),
    copiedAttachments: mapped.filter(stream => stream.codec_type === 'attachment').map(stream => stream.index),
    filters: { video: videoFilters, audio: audioFilters }, inputSeek: seek, orientationQualification, timestampOrigins,
    outputId: outputId ?? null, descriptiveProvenanceScope: 'existing-video-recipe; operation contract retained separately',
    decodedEvidenceRequired: !compatibilityPath, measuredTolerancesRequired: !compatibilityPath,
    timestampPolicy: compatibilityPath ? 'accepted-full-compatibility-path' : isRange ? 'subtract-common-start-quantized-per-stream' : 'copy-source-timestamps',
    cadence: 'preserve-presentation-frame-sequence; never synthesize-frame-rate',
  };
  const result = freeze({ version: ENCODE_OPERATION_VERSION, args, contract, expectedOutput: expected, compatibilityPath,
    runtimeIdentity, planFingerprint: hash({ settings, probe, color, request: contract.request, runtimeIdentity, outputId: outputId ?? null,
      ...(isRange ? { timestampOrigins } : {}) }),
    qualificationRequirements: requirements, executionAuthority: 'main-owned-prepared-plan-required' });
  plans.set(result, { input, probe, color, settings, duration: options.inspection.duration });
  return result;
}

function finite(value, label, { integer = false, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || integer && !Number.isSafeInteger(value)) fail('INVALID_OPERATION_VALIDATION', `${label} must be a bounded ${integer ? 'integer' : 'number'}.`);
  return value;
}
function qualifier(value, plan) {
  record(value, ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances'], ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances'], 'Measured qualification');
  if (typeof value.evidenceId !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(value.evidenceId)
      || value.runtimeIdentity !== plan.runtimeIdentity || !['span', 'end-timestamp', PACKET_CLOCK, COPY_CLOCK].includes(value.containerDuration)) fail('INVALID_OPERATION_VALIDATION', 'Measured qualification must identify matching runtime evidence and duration representation.');
  const keys = ['videoTimestampUs', 'audioTimestampUs', 'avSyncUs', 'durationUs', 'sampleCount'];
  record(value.tolerances, keys, keys, 'Measured tolerances');
  for (const key of keys) finite(value.tolerances[key], key, { minimum: 0, maximum: key === 'sampleCount' ? 1048576 : 1000000, integer: true });
  return value;
}

function decodedEvidence(value, plan, qualification, errors, warnings) {
  const packetClock = qualification.containerDuration === PACKET_CLOCK;
  const fields = ['video', 'audio', ...(packetClock ? ['containerClock'] : [])];
  record(value, fields, fields, 'Decoded evidence');
  const videoKeys = ['sourceFrameCount', 'outputFrameCount', 'firstSourcePtsUs', 'lastSourcePtsUs', 'lastSourceDurationUs',
    'firstOutputPtsUs', 'lastOutputPtsUs', 'lastOutputDurationUs', 'comparedFrames', 'maxRebasedTimestampErrorUs'];
  record(value.video, videoKeys, videoKeys, 'Decoded video evidence');
  const video = value.video, tolerance = qualification.tolerances;
  for (const key of videoKeys) finite(video[key], key, { integer: true, minimum: key.includes('Pts') ? -Number.MAX_SAFE_INTEGER : key.includes('Count') || key === 'comparedFrames' || key.includes('Duration') ? 1 : 0 });
  if (video.outputFrameCount !== video.sourceFrameCount || video.comparedFrames !== video.sourceFrameCount) errors.push('Decoded frame membership/count comparison is incomplete or differs.');
  const isRange = plan.contract.range.kind === 'range', originUs = isRange ? micros(plan.contract.range.absoluteStart) : 0;
  if (video.lastSourcePtsUs < video.firstSourcePtsUs || video.lastOutputPtsUs < video.firstOutputPtsUs) errors.push('Decoded video boundaries are not ordered.');
  if (isRange && (video.firstSourcePtsUs < originUs - 1 || video.lastSourcePtsUs >= micros(plan.contract.range.absoluteEnd) + 1)) errors.push('A decoded source frame falls outside the requested start-inclusive/end-exclusive range.');
  if (Math.abs(video.firstOutputPtsUs - (video.firstSourcePtsUs - originUs)) > tolerance.videoTimestampUs
      || Math.abs(video.lastOutputPtsUs - (video.lastSourcePtsUs - originUs)) > tolerance.videoTimestampUs
      || Math.abs(video.lastOutputDurationUs - video.lastSourceDurationUs) > tolerance.videoTimestampUs
      || video.maxRebasedTimestampErrorUs > tolerance.videoTimestampUs) errors.push('Video timestamps/cadence differ beyond the measured runtime tolerance.');
  const expectedAudio = plan.contract.audio.streams;
  if (!Array.isArray(value.audio) || value.audio.length !== expectedAudio.length) fail('INVALID_OPERATION_VALIDATION', 'Every mapped audio stream requires decoded evidence.');
  const seen = new Set(), outputEnds = [video.lastOutputPtsUs + video.lastOutputDurationUs], outputStarts = [video.firstOutputPtsUs];
  for (const item of value.audio) {
    const keys = ['inputIndex', 'sourceSampleCount', 'outputSampleCount', 'firstSourcePtsUs', 'lastSourceEndUs', 'firstOutputPtsUs', 'lastOutputEndUs', 'encoderDelaySamples', 'discardPaddingSamples'];
    record(item, [...keys, 'pcmIdentity', 'packetIdentity'], keys, 'Decoded audio evidence');
    for (const key of keys) finite(item[key], key, { integer: true, minimum: /Pts|End/.test(key) ? -Number.MAX_SAFE_INTEGER : 0 });
    const source = expectedAudio.find(stream => stream.index === item.inputIndex);
    if (!source || seen.has(item.inputIndex)) fail('INVALID_OPERATION_VALIDATION', 'Decoded audio evidence is duplicated or unrelated.');
    seen.add(item.inputIndex);
    if (source.mode === 'precision-flac') {
      const precision = plan.expectedOutput.audioPrecision.find(stream => stream.inputIndex === item.inputIndex);
      const identity = item.pcmIdentity;
      const identityKeys = ['algorithm', 'format', 'sourceHash', 'outputHash', 'sourceBytes', 'outputBytes'];
      record(identity, identityKeys, identityKeys, 'Decoded FLAC PCM identity');
      if (identity.algorithm !== 'sha256' || identity.format !== precision.pcmFormat
          || typeof identity.sourceHash !== 'string' || typeof identity.outputHash !== 'string'
          || !/^[a-f0-9]{64}$/.test(identity.sourceHash) || !/^[a-f0-9]{64}$/.test(identity.outputHash)) fail('INVALID_OPERATION_VALIDATION', 'FLAC requires hashes of the complete selected PCM in its canonical packed representation.');
      for (const key of ['sourceBytes', 'outputBytes']) finite(identity[key], key, { integer: true, minimum: 1 });
      const bytesPerSample = BigInt(source.channels * (precision.storageBits / 8));
      if (BigInt(identity.sourceBytes) !== BigInt(item.sourceSampleCount) * bytesPerSample
          || BigInt(identity.outputBytes) !== BigInt(item.outputSampleCount) * bytesPerSample
          || identity.sourceBytes !== identity.outputBytes || identity.sourceHash !== identity.outputHash
          || item.sourceSampleCount !== item.outputSampleCount || item.encoderDelaySamples !== 0 || item.discardPaddingSamples !== 0) {
        errors.push(`Audio ${item.inputIndex}: FLAC must preserve every selected decoded PCM sample exactly, without a padding or precision-loss allowance.`);
      }
    } else if (own(item, 'pcmIdentity')) fail('INVALID_OPERATION_VALIDATION', 'PCM identity belongs only to the qualified lossless FLAC path.');
    if (source.mode === 'copy') {
      // Record 47 Q2b: a copy keeps the source's own packets, so its decoded
      // samples must match exactly; the shared padding tolerance never applies.
      const identity = item.packetIdentity, identityKeys = ['algorithm', 'packets', 'sourceSeal', 'outputSeal'];
      record(identity, identityKeys, identityKeys, 'Copied audio packet identity');
      if (identity.algorithm !== 'sha256' || typeof identity.sourceSeal !== 'string' || typeof identity.outputSeal !== 'string'
          || !/^[a-f0-9]{64}$/.test(identity.sourceSeal) || !/^[a-f0-9]{64}$/.test(identity.outputSeal)) fail('INVALID_OPERATION_VALIDATION', 'Copied audio requires the collector\'s packet identity seals for both files.');
      finite(identity.packets, 'packets', { integer: true, minimum: 1 });
      if (identity.sourceSeal !== identity.outputSeal || item.sourceSampleCount !== item.outputSampleCount) {
        errors.push(`Audio ${item.inputIndex}: copied audio must keep every source packet and decoded sample exactly.`);
      }
    } else if (own(item, 'packetIdentity')) fail('INVALID_OPERATION_VALIDATION', 'Packet identity belongs only to copied audio.');
    if (item.sourceSampleCount <= 0 || item.outputSampleCount <= 0 || item.lastSourceEndUs <= item.firstSourcePtsUs || item.lastOutputEndUs <= item.firstOutputPtsUs) errors.push(`Audio ${item.inputIndex}: empty or unordered decoded samples.`);
    if (Math.abs(item.outputSampleCount - item.sourceSampleCount) > tolerance.sampleCount) errors.push(`Audio ${item.inputIndex}: decoded sample count differs beyond measured padding tolerance.`);
    else if (item.outputSampleCount !== item.sourceSampleCount) warnings.push(`Audio ${item.inputIndex}: measured decoded sample-count difference ${item.outputSampleCount - item.sourceSampleCount}; not sample-identical.`);
    // A sample selected by PTS < B can end at the next sample boundary. The
    // allowance is that source's one sample period, not a blanket 100 ms policy.
    const samplePeriodUs = source.sampleRate ? Math.ceil(1000000 / source.sampleRate) : 0;
    if (isRange && (item.firstSourcePtsUs < originUs - 1 || item.lastSourceEndUs > micros(plan.contract.range.absoluteEnd) + samplePeriodUs + 1)) errors.push(`Audio ${item.inputIndex}: selected samples exceed the requested interval.`);
    if (Math.abs(item.firstOutputPtsUs - (item.firstSourcePtsUs - originUs)) > tolerance.audioTimestampUs
        || Math.abs(item.lastOutputEndUs - (item.lastSourceEndUs - originUs)) > tolerance.audioTimestampUs) errors.push(`Audio ${item.inputIndex}: decoded boundaries differ beyond measured audio tolerance.`);
    const firstSync = (item.firstOutputPtsUs - video.firstOutputPtsUs) - (item.firstSourcePtsUs - video.firstSourcePtsUs);
    const endSync = (item.lastOutputEndUs - (video.lastOutputPtsUs + video.lastOutputDurationUs)) - (item.lastSourceEndUs - (video.lastSourcePtsUs + video.lastSourceDurationUs));
    if (Math.abs(firstSync) > tolerance.avSyncUs || Math.abs(endSync) > tolerance.avSyncUs) errors.push(`Audio ${item.inputIndex}: relative A/V timing changed beyond measured tolerance.`);
    outputEnds.push(item.lastOutputEndUs); outputStarts.push(item.firstOutputPtsUs);
  }
  const audioOrigin = packetClock ? plan.expectedOutput.timestampOrigins?.audio?.[0]?.effectiveOrigin : null;
  if (packetClock && !audioOrigin) fail('INVALID_OPERATION_VALIDATION', 'The qualified packet clock needs the canonical selected-audio origin.');
  const clock = packetClock ? validateContainerClock(value.containerClock, { mappings: plan.expectedOutput.streams,
    video, audio: value.audio, audioPolicies: expectedAudio, videoToleranceUs: tolerance.videoTimestampUs,
    audioOrigin: { n: audioOrigin.numerator, d: audioOrigin.denominator },
    // Fixed48k family: one source tick + one sample + the measured1ms MKV tick.
    // This is clock quantization, not an added AAC frame/padding allowance.
    audioToleranceUs: Math.ceil(2000000 / 48000 + 1000) }) : null;
  return { maximumEndUs: Math.max(...outputEnds), minimumStartUs: Math.min(...outputStarts),
    outputEnds: { video: [outputEnds[0]], audio: value.audio.map(item => ({ inputIndex: item.inputIndex, lastOutputEndUs: item.lastOutputEndUs, encoderDelaySamples: item.encoderDelaySamples })) },
    ...(clock ? { containerEndUs: clock.maximumStoredEndUs } : {}), timing: operationTiming(plan, video, value.audio) };
}

// Read-only result description, attached only to a valid result, from the
// same decoded evidence the validator checked: what the request asked for, what main resolved and what
// each stream actually kept, plus the AAC start delay and end padding. Source
// spans use the request's timeline (relative to the source origin) so they
// compare directly with the asked range. Inert integers; no authority.
function roundedMicros(value) {
  const item = rat(value), scaled = item.n * 1000000n, negative = scaled < 0n, magnitude = negative ? -scaled : scaled;
  const rounded = magnitude / item.d + (magnitude % item.d * 2n >= item.d ? 1n : 0n);
  return Number(negative ? -rounded : rounded);
}
function operationTiming(plan, video, audio) {
  const range = plan.contract.range, ranged = range.kind === 'range';
  // Same nearest-microsecond rule (ties away from zero) the collector applies
  // to each decoded timestamp, so a frame at the asked edge reads exactly there.
  const baseUs = ranged ? roundedMicros(range.sourceOrigin) : 0;
  const asked = key => ranged && own(range.requested, key) ? range.requested[key] : null;
  return freeze({
    timeline: ranged ? 'request-relative' : 'source-timestamps',
    requested: ranged ? { startUs: asked('startUs'), endUs: asked('endUs') } : null,
    resolved: ranged ? { startUs: range.resolved.startUs, endUs: range.resolved.endUs } : null,
    video: { startUs: video.firstSourcePtsUs - baseUs, endUs: video.lastSourcePtsUs + video.lastSourceDurationUs - baseUs,
      frames: video.outputFrameCount, outputStartUs: video.firstOutputPtsUs, outputEndUs: video.lastOutputPtsUs + video.lastOutputDurationUs },
    audio: audio.map(item => ({ inputIndex: item.inputIndex,
      mode: plan.contract.audio.streams.find(stream => stream.index === item.inputIndex).mode,
      startUs: item.firstSourcePtsUs - baseUs, endUs: item.lastSourceEndUs - baseUs,
      outputStartUs: item.firstOutputPtsUs, outputEndUs: item.lastOutputEndUs,
      encoderDelaySamples: item.encoderDelaySamples, discardPaddingSamples: item.discardPaddingSamples,
      sampleCountDifference: item.outputSampleCount - item.sourceSampleCount })),
  });
}

function validateEncodeOperationOutput(plan, rawOutputProbe, options = {}) {
  const errors = [], warnings = [];
  try {
    record(options, ['qualification', 'decodedEvidence'], [], 'Output-validation options');
    const state = plans.get(plan);
    if (!state) fail('INVALID_OPERATION_VALIDATION', 'Output validation requires the genuine immutable main-built plan.');
    const output = normalizeProbe(rawOutputProbe);
    const input = structuredClone(state.probe), inputVideo = selectVideo(input), actualVideo = selectVideo(output);
    if (plan.validationMode === 'full-preservation-selection') {
      const selection = require('./encode-preservation.cjs').getEncodePreservationSelection(state.preservationSelection, input);
      const result = validateOutput({ probe: input, color: state.color, duration: state.duration }, output, state.settings,
        { preservationSelection: state.preservationSelection });
      const relationships = output.mediaEvidence.container;
      if (relationships.relationships.state !== 'known' || output.programs.length || output.stream_groups.length
          || output.streams.some(stream => stream.codec_type === 'data')) result.errors.push('The output contains residual or unresolved timed-data relationships.');
      const geometry = output.mediaEvidence.streams.find(stream => stream.index === actualVideo.index).geometry;
      if (output.format.format_name !== 'matroska,webm') result.errors.push('The output must use the prepared Matroska container.');
      if (actualVideo.field_order !== 'progressive' || !['1:1', '1/1'].includes(actualVideo.sample_aspect_ratio)
          || geometry.issues?.length || Object.values(geometry).some(value => value?.state === 'malformed')
          || geometry.rotationSource === 'display-matrix'
          || Object.hasOwn(actualVideo.tags || {}, 'rotate') && (geometry.legacyRotationDegrees.state !== 'known' || geometry.legacyRotationDegrees.value.numerator !== '0')) {
        result.errors.push('The retained video must remain progressive, square-pixel and unrotated with consistent display geometry.');
      }
      if (inputVideo.chroma_location !== undefined && inputVideo.chroma_location !== actualVideo.chroma_location) result.errors.push('The retained video chroma location changed.');
      const sourceAudio = input.streams.find(stream => stream.codec_type === 'audio'), outputAudio = output.streams[1];
      if (outputAudio?.profile !== sourceAudio.profile || outputAudio?.sample_fmt !== sourceAudio.sample_fmt) result.errors.push('The copied audio profile or sample representation changed.');
      if (plan.expectedOutput.outputId) {
        const marker = classifyMarker(output);
        if (marker.kind !== 'generated' || marker.outputId !== plan.expectedOutput.outputId.toLowerCase()) result.errors.push('Prepared output provenance did not round-trip.');
      }
      return { valid: result.errors.length === 0, errors: result.errors, warnings: [selection.warning],
        validation: 'full-preservation-selection', decodedEvidenceRequired: false };
    }
    let qualified = null, decoded = null;
    if (!plan.compatibilityPath) {
      qualified = qualifier(options.qualification, plan);
      if (qualified.containerDuration === PACKET_CLOCK && (plan.contract.audio.streams.length !== 1
          || plan.contract.audio.streams[0].mode !== 'precision-aac')) {
        fail('INVALID_OPERATION_VALIDATION', 'The packet clock belongs only to precision AAC, never FLAC or copied audio.');
      }
      if (qualified.containerDuration === PACKET_CLOCK && (output.format.format_name !== 'matroska,webm'
          || output.streams.length !== 2 || output.streams.some(stream => stream.time_base !== '1/1000'))) {
        fail('INVALID_OPERATION_VALIDATION', 'The qualified packet clock requires the measured1/1000 Matroska output time bases.');
      }
      if (qualified.containerDuration === COPY_CLOCK && (plan.contract.range.kind !== 'full' || !plan.contract.audio.streams.length
          || plan.contract.audio.streams.some(audio => audio.mode !== 'copy') || output.format.format_name !== 'matroska,webm'
          || output.streams.some(stream => stream.time_base !== '1/1000'))) {
        fail('INVALID_OPERATION_VALIDATION', 'The copy clock applies only to whole-file copied audio in 1/1000 Matroska output.');
      }
      decoded = decodedEvidence(options.decodedEvidence, plan, qualified, errors, warnings);
      // Reuse the established metadata/stream/color validator against the
      // explicitly transformed expectation. Its old blanket duration/FPS check
      // is replaced by complete decoded timing evidence and measured tolerances.
      inputVideo.width = plan.contract.geometry.output.width; inputVideo.height = plan.contract.geometry.output.height;
      delete inputVideo.duration; delete input.format.duration;
      inputVideo.avg_frame_rate = '0/0'; inputVideo.r_frame_rate = '0/0';
      if (plan.contract.geometry.filterRequired && inputVideo.tags && own(inputVideo.tags, 'rotate')) inputVideo.tags.rotate = '0';
      for (const audio of plan.contract.audio.streams) {
        if (audio.mode === 'copy') continue;
        const stream = input.streams.find(item => item.index === audio.index);
        stream.codec_name = audio.codec; stream.sample_rate = String(audio.sampleRate); stream.channels = audio.channels; stream.channel_layout = audio.channelLayout;
      }
      const copyEnd = () => Math.max(...decoded.outputEnds.video, ...decoded.outputEnds.audio.map(item => {
        const rate = Number(input.streams.find(stream => stream.index === item.inputIndex)?.sample_rate);
        if (!Number.isSafeInteger(rate) || rate <= 0) fail('INVALID_OPERATION_VALIDATION', 'The copy clock needs the copied stream\'s own sample rate.');
        return Math.round(item.lastOutputEndUs + item.encoderDelaySamples * 1000000 / rate);
      }));
      const expectedDurationUs = qualified.containerDuration === PACKET_CLOCK ? decoded.containerEndUs : qualified.containerDuration === COPY_CLOCK ? copyEnd()
        : qualified.containerDuration === 'span' ? decoded.maximumEndUs - decoded.minimumStartUs : decoded.maximumEndUs;
      const containerDuration = Number(output.format.duration);
      if (!Number.isFinite(containerDuration) || containerDuration <= 0 || Math.abs(containerDuration * 1000000 - expectedDurationUs) > qualified.tolerances.durationUs) errors.push('Container duration differs from decoded full output extent beyond the measured tolerance.');
      const expectedSar = plan.contract.geometry.output.sampleAspectRatio;
      if (expectedSar) {
        const sar = rationalNumber(actualVideo.sample_aspect_ratio), expected = rat(expectedSar);
        if (sar === null || Math.abs(sar - Number(expected.n) / Number(expected.d)) > 1e-9) errors.push('Output sample aspect ratio differs from the planned geometry.');
      }
      if (plan.contract.geometry.filterRequired) {
        const rotations = (actualVideo.side_data_list || []).filter(item => item.side_data_type === 'Display Matrix');
        if (rotations.some(item => Number(item.rotation) !== 0) || actualVideo.tags?.rotate !== undefined && Number(actualVideo.tags.rotate) !== 0) errors.push('Output retains a nonzero or malformed orientation after explicit normalization.');
        const matrix = output.mediaEvidence.streams.find(stream => stream.index === actualVideo.index).geometry.displayMatrix;
        if (rotations.length && (matrix.state !== 'known' || JSON.stringify(matrix.value) !== JSON.stringify(['65536', '0', '0', '0', '65536', '0', '0', '0', '1073741824']))) errors.push('Output retains an unqualified display matrix after orientation normalization.');
      } else if (plan.expectedOutput.preservedOrientation) {
        const actualGeometry = output.mediaEvidence.streams.find(stream => stream.index === actualVideo.index).geometry;
        // No resize means no permission to flatten, invent or translate a
        // rotation representation. Known matrix/legacy instructions must survive;
        // absent-to-absent remains unknown, not a manufactured zero-degree fact.
        for (const [field, expected] of Object.entries(plan.expectedOutput.preservedOrientation)) {
          const actual = actualGeometry[field];
          if (!actual || actual.state !== expected.state
              || expected.state === 'known' && JSON.stringify(actual.value) !== JSON.stringify(expected.value)) {
            errors.push(`Video ${field} changed without a qualified orientation transform.`);
          }
        }
      }
      for (const audio of plan.contract.audio.streams) {
        if (audio.mode === 'copy') continue;
        const mapping = plan.expectedOutput.streams.find(stream => stream.inputIndex === audio.index), actual = output.streams[mapping.outputIndex];
        if (audio.mode === 'precision-aac' && actual?.profile !== 'LC') errors.push(`Audio ${audio.index}: AAC output does not report the qualified LC profile.`);
        if (audio.mode === 'precision-flac') {
          const precision = plan.expectedOutput.audioPrecision.find(stream => stream.inputIndex === audio.index);
          if (actual?.sample_fmt !== (precision.storageBits === 16 ? 's16' : 's32')) errors.push(`Audio ${audio.index}: FLAC decoded sample representation changed.`);
          const bits = Number(actual?.bits_per_raw_sample);
          if (!Number.isSafeInteger(bits) || bits < precision.minimumSignificantBits || bits > precision.storageBits) errors.push(`Audio ${audio.index}: FLAC significant-bit precision is missing, reduced or inconsistent.`);
        }
      }
    }
    const legacy = validateOutput({ probe: input, color: state.color, duration: plan.compatibilityPath ? state.duration : null }, output, state.settings);
    errors.push(...legacy.errors);
    if (plan.expectedOutput.outputId) {
      const marker = classifyMarker(output);
      if (marker.kind !== 'generated' || marker.outputId !== plan.expectedOutput.outputId.toLowerCase()) errors.push('Prepared output provenance did not round-trip.');
    }
    return { valid: errors.length === 0, errors, warnings, validation: plan.compatibilityPath ? 'accepted-full-validator' : 'decoded-operation-contract',
      qualificationEvidenceId: qualified?.evidenceId ?? null, ...(decoded && errors.length === 0 ? { timing: decoded.timing } : {}) };
  } catch (error) {
    errors.push(error.message || 'Operation output validation failed.');
    return { valid: false, errors, warnings, code: error.code || 'INVALID_OPERATION_VALIDATION' };
  }
}

// A read-only main-side assertion shares the builder's private identity brand.
// Serialized/copy-shaped plans can describe a job but cannot acquire execution
// qualification through a matching fingerprint supplied by another caller.
function assertEncodeOperationPlan(plan, bindings) {
  const state = plans.get(plan);
  if (!state) fail('INVALID_ENCODE_OPERATION', 'Only an original main-built Encode operation plan may be qualified.');
  if (bindings !== undefined) {
    record(bindings, ['settings', 'sourceProbeFingerprint', 'sourcePath'], ['settings', 'sourceProbeFingerprint'], 'Operation bindings');
    if (JSON.stringify(validateSettings(bindings.settings)) !== JSON.stringify(state.settings)
        || bindings.sourceProbeFingerprint !== fingerprintEncodeSource(state.probe)) {
      fail('INVALID_ENCODE_OPERATION', 'Qualification settings or source evidence do not describe this original operation plan.');
    }
    if (bindings.sourcePath !== undefined && (typeof bindings.sourcePath !== 'string' || !path.isAbsolute(bindings.sourcePath)
        || path.resolve(bindings.sourcePath) !== path.resolve(state.input))) {
      fail('INVALID_ENCODE_OPERATION', 'The qualified source path does not describe this original operation plan.');
    }
  }
  return plan;
}

function describeEncodeOperationSource(plan) {
  assertEncodeOperationPlan(plan);
  return freeze(structuredClone(plans.get(plan).probe));
}

// Instrumentation is part of the same canonical main-owned plan. Its typed
// diagnostic slots are visibly unresolved until fresh exclusive reservations
// exist at job start; neither renderer strings nor serialized handles bind them.
function withEncodeOperationTelemetry(plan) {
  assertEncodeOperationPlan(plan);
  if (plan.compatibilityPath || plan.validationMode === 'full-preservation-selection') return plan;
  const state = plans.get(plan);
  if (state.instrumentation) return plan;
  const streams = plan.expectedOutput.streams.flatMap(mapping => {
    if (mapping.codecType === 'video') return [{ outputIndex: mapping.outputIndex, kind: 'video' }];
    const audio = plan.contract.audio.streams.find(item => item.index === mapping.inputIndex);
    return mapping.codecType === 'audio' && audio?.mode !== 'copy'
      ? [{ outputIndex: mapping.outputIndex, kind: 'audio', sampleRate: audio.sampleRate }] : [];
  });
  const placeholders = streams.map(stream => `<main-owned telemetry stream ${stream.outputIndex} assigned at start>`);
  const additions = streams.flatMap((stream, index) => [`-stats_enc_pre:${stream.outputIndex}`, placeholders[index],
    `-stats_enc_pre_fmt:${stream.outputIndex}`, FORMATS[stream.kind]]);
  const args = [...plan.args]; args.splice(args.length - 5, 0, ...additions);
  const instrumentation = freeze({ version: 1, kind: 'encoder-input-statistics', streams, placeholders });
  const result = freeze({ ...plan, args, instrumentation, planFingerprint: hash({ operation: plan.planFingerprint, instrumentation }) });
  plans.set(result, { ...state, instrumentation }); return result;
}

function resolveEncodeOperationInvocation(plan, { output, telemetry }) {
  assertEncodeOperationPlan(plan);
  const state = plans.get(plan);
  if (!state.instrumentation || typeof output !== 'string' || !path.isAbsolute(output) || /[\0\r\n]/.test(output)) {
    fail('INVALID_ENCODE_OPERATION', 'An instrumented genuine plan and owned absolute staging output are required.');
  }
  const actual = assertTelemetryBinding(telemetry, { runtimeIdentity: plan.runtimeIdentity,
    planFingerprint: plan.planFingerprint, streams: state.instrumentation.streams });
  const paths = state.instrumentation.streams.map((_, index) => actual[index * 4 + 1]);
  const args = plan.args.map(value => {
    const index = state.instrumentation.placeholders.indexOf(value); return index < 0 ? value : paths[index];
  });
  args[args.length - 1] = output; return freeze(args);
}

function validateEncodeOperationTelemetry(plan, telemetry, evidence) {
  assertEncodeOperationPlan(plan); assertCollectedTelemetry(telemetry);
  if (!plans.get(plan).instrumentation || telemetry.runtimeIdentity !== plan.runtimeIdentity || telemetry.planFingerprint !== plan.planFingerprint
      || evidence?.status !== 'completed' || evidence.runtimeIdentity !== plan.runtimeIdentity || evidence.planFingerprint !== plan.planFingerprint) {
    fail('OPERATION_TELEMETRY_MISMATCH', 'Telemetry and complete decoded evidence must belong to this exact operation.');
  }
  const matchesTime = (actual, expected) => actual && expected
    && typeof expected.n === 'string' && /^-?\d{1,40}$/.test(expected.n)
    && typeof expected.d === 'string' && /^[1-9]\d{0,39}$/.test(expected.d)
    && BigInt(actual.numerator) * BigInt(expected.d) === BigInt(expected.n) * BigInt(actual.denominator);
  const expectedStreams = plan.instrumentation.streams, verified = [];
  if (telemetry.streams.length !== expectedStreams.length) fail('OPERATION_TELEMETRY_MISMATCH', 'Every encoded stream needs its own telemetry receipt.');
  for (const spec of expectedStreams) {
    const matching = telemetry.streams.filter(item => item.summary.stream.outputIndex === spec.outputIndex);
    const summary = matching[0]?.summary;
    if (matching.length !== 1 || summary.stream.kind !== spec.kind || summary.backwardsPts !== '0' || summary.repeatedPts !== '0') {
      fail('OPERATION_TELEMETRY_MISMATCH', 'Encoded-stream telemetry is missing, duplicated or has invalid timestamp ordering.');
    }
    if (spec.kind === 'video') {
      const original = evidence.encoderInputs?.video;
      if (!original || original.outputIndex !== spec.outputIndex || summary.records !== original.records || summary.hashes.orderedPts !== original.orderedPts) {
        fail('OPERATION_TELEMETRY_MISMATCH', 'Encoder input video frames/ordered rational timestamps differ from independent source selection.');
      }
    } else {
      const original = Array.isArray(evidence.encoderInputs?.audio) ? evidence.encoderInputs.audio.find(item => item.outputIndex === spec.outputIndex) : null;
      const mapping = plan.expectedOutput.streams.find(item => item.outputIndex === spec.outputIndex);
      if (!original || original.inputIndex !== mapping.inputIndex || original.selectedGaps !== 0 || summary.audioDiscontinuities !== '0' || summary.sampleCount !== original.sampleCount
          || !matchesTime(summary.first.time, original.firstTime) || !matchesTime(summary.last.endTime, original.endTime)) {
        fail('OPERATION_TELEMETRY_MISMATCH', 'Encoder input audio samples/continuous clock differ from independent source selection.');
      }
    }
    verified.push({ outputIndex: spec.outputIndex, kind: spec.kind, unknownInputRecords: summary.unknownInputRecords,
      correspondence: summary.unknownInputRecords === '0' ? 'reported-input-and-independent-selected-source' : 'upstream-input-lineage-unavailable; independently-matched-selected-source-clock-and-count' });
  }
  return freeze({ valid: true, scope: 'encoder-input-count-and-timeline-only', streams: verified,
    doesNotEstablish: ['video-pixel-identity', 'lossless-audio-identity', 'last-video-frame-duration', 'output-or-publication-validity'] });
}

module.exports = { ENCODE_OPERATION_VERSION, fingerprintEncodeSource, buildEncodeOperation, validateEncodeOperationOutput, assertEncodeOperationPlan,
  withEncodeOperationTelemetry, resolveEncodeOperationInvocation, validateEncodeOperationTelemetry, describeEncodeOperationSource };
