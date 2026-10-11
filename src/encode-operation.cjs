'use strict';

const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { PROFILES, validateSettings, selectVideo, mappedStreams, buildEncodeArgs } = require('./media.cjs');
const { normalizeProbe, validateOutput } = require('./inspection.cjs');
const { buildOperationContract, resolveFileRequest } = require('./operation-contract.cjs');
const { classifyMarker } = require('./provenance.cjs');

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
  const video = selectVideo(probe), mapped = mappedStreams(probe, video);
  const args = buildEncodeArgs({ input, output, settings, probe, colorEvidence: color,
    ...(outputId === undefined ? {} : { outputId }), ...(generationDescription === undefined ? {} : { generationDescription }) });
  // Do not make old Full admission depend on newly added relationship/geometry
  // fields. This exact path retains the established builder and validator.
  const request = structuredClone(options.request);
  const contract = { version: 1, request, geometry: { requested: 'source', filterRequired: false, mode: 'preserve-source',
    output: { width: video.width ?? null, height: video.height ?? null, sampleAspectRatio: null, orientation: 'preserve-source' } },
  range: { kind: 'full', requested: null, timestampMapping: 'preserve-source' },
  audio: { policy: 'copy', streams: mapped.filter(stream => stream.codec_type === 'audio').map(stream => ({ index: stream.index, mode: 'copy', codec: stream.codec_name })) },
  omissionRequests: { ids: [], authority: 'none' } };
  const result = freeze({ version: ENCODE_OPERATION_VERSION, args, contract, compatibilityPath: true, runtimeIdentity,
    planFingerprint: hash({ settings, probe, color, request, runtimeIdentity, outputId: outputId ?? null }),
    expectedOutput: { version: ENCODE_OPERATION_VERSION, operation: 'encode', target: 'matroska', sourceVideoIndex: video.index,
      geometry: contract.geometry, range: contract.range, audio: contract.audio, color, outputId: outputId ?? null,
      streams: mapped.map((stream, outputIndex) => ({ inputIndex: stream.index, outputIndex, codecType: stream.codec_type, codecName: outputIndex === 0
        ? { H264: 'h264', H265: 'hevc', AV1: 'av1' }[PROFILES.find(profile => profile.id === settings.profileId).codec] : stream.codec_name })),
      decodedEvidenceRequired: false, measuredTolerancesRequired: false, timestampPolicy: 'accepted-full-compatibility-path' },
    qualificationRequirements: [], executionAuthority: 'main-owned-prepared-plan-required' });
  plans.set(result, { probe, color, settings, duration: options.inspection.duration });
  return result;
}

function buildEncodeOperation(options) {
  const allowed = ['input', 'output', 'settings', 'inspection', 'request', 'outputId', 'generationDescription', 'runtimeIdentity', 'identityOrientationQualification'];
  record(options, allowed, ['input', 'output', 'settings', 'inspection', 'request'], 'Encode operation');
  const { input, output, outputId, generationDescription, runtimeIdentity = null } = options;
  record(options.inspection, ['probe', 'color', 'duration', 'evidence', 'summary', 'warnings', 'sampling', 'cache'], ['probe', 'color'], 'Inspection');
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
  const args = buildEncodeArgs({ input, output, settings, probe, colorEvidence: color,
    ...(outputId === undefined ? {} : { outputId }), ...(generationDescription === undefined ? {} : { generationDescription }) });
  const isRange = contract.range.kind === 'range';
  const resize = contract.geometry.filterRequired;
  const precisionAudio = contract.audio.policy !== 'copy' && contract.audio.streams.length > 0;
  const compatibilityPath = !isRange && !resize && !precisionAudio;
  const requirements = [], videoFilters = [], audioFilters = [];
  const audioPrecision = [], preservedOrientation = !compatibilityPath && !resize ? sourceOrientation(videoEvidence.geometry) : null;
  let seek = null;

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
      // Keep source timestamps through demux/decode. Unlike independent
      // STARTPTS resets, this common A retains each track's meaningful delay.
      const videoBase = videoEvidence.timeline.timeBase.value;
      videoFilters.unshift(`trim=start_pts=${ticks(range.absoluteStart, videoBase)}:end_pts=${ticks(range.absoluteEnd, videoBase)}`,
        `setpts=PTS-${fraction(range.absoluteStart)}/TB`);
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
    }
    if (videoFilters.length) outputOptions(args, ['-filter:v:0', videoFilters.join(',')]);
    outputOptions(args, ['-enc_time_base:v:0', 'filter']);
    for (const [audioOrdinal, audio] of contract.audio.streams.entries()) {
      if (audio.mode === 'copy') continue;
      const filters = [];
      if (isRange) {
        const timeBase = { numerator: '1', denominator: String(audio.sampleRate) };
        filters.push(`atrim=start_pts=${ticks(contract.range.absoluteStart, timeBase)}:end_pts=${ticks(contract.range.absoluteEnd, timeBase)}`,
          `asetpts=PTS-${fraction(contract.range.absoluteStart)}/TB`);
      }
      // Explicit same-rate/layout constraints cannot authorize a downmix or a
      // resample. Decoder/encoder/output evidence must establish these values.
      const audioArgs = [`-c:a:${audioOrdinal}`, audio.codec, `-ar:a:${audioOrdinal}`, String(audio.sampleRate),
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
    filters: { video: videoFilters, audio: audioFilters }, inputSeek: seek, orientationQualification,
    outputId: outputId ?? null, descriptiveProvenanceScope: 'existing-video-recipe; operation contract retained separately',
    decodedEvidenceRequired: !compatibilityPath, measuredTolerancesRequired: !compatibilityPath,
    timestampPolicy: compatibilityPath ? 'accepted-full-compatibility-path' : isRange ? 'subtract-one-common-absolute-start' : 'copy-source-timestamps',
    cadence: 'preserve-presentation-frame-sequence; never synthesize-frame-rate',
  };
  const result = freeze({ version: ENCODE_OPERATION_VERSION, args, contract, expectedOutput: expected, compatibilityPath,
    runtimeIdentity, planFingerprint: hash({ settings, probe, color, request: contract.request, runtimeIdentity, outputId: outputId ?? null }),
    qualificationRequirements: requirements, executionAuthority: 'main-owned-prepared-plan-required' });
  plans.set(result, { probe, color, settings, duration: options.inspection.duration });
  return result;
}

function finite(value, label, { integer = false, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || integer && !Number.isSafeInteger(value)) fail('INVALID_OPERATION_VALIDATION', `${label} must be a bounded ${integer ? 'integer' : 'number'}.`);
  return value;
}
function qualifier(value, plan) {
  record(value, ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances'], ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances'], 'Measured qualification');
  if (typeof value.evidenceId !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(value.evidenceId)
      || value.runtimeIdentity !== plan.runtimeIdentity || !['span', 'end-timestamp'].includes(value.containerDuration)) fail('INVALID_OPERATION_VALIDATION', 'Measured qualification must identify matching runtime evidence and duration representation.');
  const keys = ['videoTimestampUs', 'audioTimestampUs', 'avSyncUs', 'durationUs', 'sampleCount'];
  record(value.tolerances, keys, keys, 'Measured tolerances');
  for (const key of keys) finite(value.tolerances[key], key, { minimum: 0, maximum: key === 'sampleCount' ? 1048576 : 1000000, integer: true });
  return value;
}

function decodedEvidence(value, plan, qualification, errors, warnings) {
  record(value, ['video', 'audio'], ['video', 'audio'], 'Decoded evidence');
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
    record(item, [...keys, 'pcmIdentity'], keys, 'Decoded audio evidence');
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
  return { maximumEndUs: Math.max(...outputEnds), minimumStartUs: Math.min(...outputStarts) };
}

function validateEncodeOperationOutput(plan, rawOutputProbe, options = {}) {
  const errors = [], warnings = [];
  try {
    record(options, ['qualification', 'decodedEvidence'], [], 'Output-validation options');
    const state = plans.get(plan);
    if (!state) fail('INVALID_OPERATION_VALIDATION', 'Output validation requires the genuine immutable main-built plan.');
    const output = normalizeProbe(rawOutputProbe);
    const input = structuredClone(state.probe), inputVideo = selectVideo(input), actualVideo = selectVideo(output);
    let qualified = null, decoded = null;
    if (!plan.compatibilityPath) {
      qualified = qualifier(options.qualification, plan);
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
      const expectedDurationUs = qualified.containerDuration === 'span' ? decoded.maximumEndUs - decoded.minimumStartUs : decoded.maximumEndUs;
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
      qualificationEvidenceId: qualified?.evidenceId ?? null };
  } catch (error) {
    errors.push(error.message || 'Operation output validation failed.');
    return { valid: false, errors, warnings, code: error.code || 'INVALID_OPERATION_VALIDATION' };
  }
}

module.exports = { ENCODE_OPERATION_VERSION, fingerprintEncodeSource, buildEncodeOperation, validateEncodeOperationOutput };
