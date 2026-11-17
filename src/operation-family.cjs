'use strict';

// Main-only applicability for explicitly measured source families. Retained
// qualification belongs to the trusted catalog, while every issued selection
// separately binds a genuine plan and the current file's complete identity.
// Metadata admits collection only; complete decoded source evidence is required
// before publication. This module reads no files and launches no processes.
const path = require('node:path');
const { ToolError } = require('./process-runner.cjs');
const { validateSettings, selectVideo } = require('./media.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { resolveTimeRange, resolveAudio, resolveGeometry } = require('./operation-contract.cjs');
const { assertEncodeOperationPlan, describeEncodeOperationSource, fingerprintEncodeSource } = require('./encode-operation.cjs');

const { FAMILY_ID: PROPORTIONAL, RESOURCE_POLICY, deriveCfrFlacResources,
  RESIZE_FAMILY_ID: RESIZE_PROPORTIONAL, RESIZE_RESOURCE_POLICY, deriveCfrResizeFlacResources } = require('./operation-resource-budget.cjs');
// Two fixed main-owned range policies, never caller-selected coefficients.
const proportionalId = id => id === PROPORTIONAL || id === RESIZE_PROPORTIONAL;
const resourcePolicy = id => id === RESIZE_PROPORTIONAL ? RESIZE_RESOURCE_POLICY : RESOURCE_POLICY;
const proportionalResults = new WeakMap();
// A result's private issuing epoch and plan identity, never a public flag, carry
// resource authority. Callers must still requireCurrent at the normal boundary;
// the brand alone is not a fresh source/runtime observation or media qualification.
function isProportionalFamilySelection(result, plan) {
  const issued = result && typeof result === 'object' ? proportionalResults.get(result) : null;
  return !!issued && issued.current() && (plan === undefined || plan === issued.plan);
}

// Pure admission only: this does not re-observe filesystem bytes or runtime.
// Exact frozen references prevent substituting permissive cost/timing policies.
function assertProportionalCollectionSelection(selection, options) {
  return checked('OPERATION_PROPORTIONAL_COLLECTION', () => {
    const issued = selection && typeof selection === 'object' ? proportionalResults.get(selection) : null;
    need(issued && issued.current(), 'A genuine current proportional family selection is required.');
    record(options, ['plan', 'sourcePath', 'sourceProbe', 'budget', 'timingQualification', 'sourcePolicy']);
    need(options.plan === issued.plan && options.sourcePath === issued.sourceIdentity.canonicalPath,
      'Collection must use the exact selected plan and source path.');
    need(options.budget === selection.budget && options.timingQualification === selection.timingQualification
      && options.sourcePolicy === selection.sourcePolicy, 'Collection must use the issued frozen budget, timing and source policy.');
    inert(options.sourceProbe);
    need(fingerprintEncodeSource(options.sourceProbe) === issued.sourceProbeFingerprint,
      'Collection source metadata differs from the selected source.');
    return issued.sourceIdentity;
  });
}

function verifyProportionalCollectedSource(selection, evidence) {
  const issued = selection && typeof selection === 'object' ? proportionalResults.get(selection) : null;
  if (!issued || !issued.current()) throw new ToolError('OPERATION_PROPORTIONAL_COLLECTION', 'A current proportional selection is required.');
  return issued.verify(evidence);
}

const FAMILY = 'short-sdr-range-v1', MAX_EXTENT_US = 120000000, MAX_BYTES = 512 * 1024 * 1024;
// Record 47 Q2b: whole-file 1080p30 -> 720p with copied audio. The first cells
// were measured on a 10 s and a 31 s file, so video, audio, container and the
// decoded source must all last 10 to 31 s, and audio must end within one AAC
// frame of the video (as measured). No budget raised.
const FULL = 'full-sdr-resize-copy-v1', FLAC = 'short-sdr-range-flac-v1', FULL_MIN_SECONDS = 10n, FULL_MAX_SECONDS = 31n, FAMILY_IDS = Object.freeze([FAMILY, FULL, FLAC]);
const AAC_FRAME = Object.freeze({ n: 1024n, d: 48000n });
const AMBIGUOUS = 'OPERATION_FAMILY_AMBIGUOUS';
const INVALID = 'INVALID_OPERATION_QUALIFICATION', REQUIRED = 'OPERATION_QUALIFICATION_REQUIRED', STALE = 'OPERATION_QUALIFICATION_STALE';
const SOURCE_FAILED = 'OPERATION_SOURCE_FAMILY_MISMATCH';
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9._:+-]{1,256}$/;
const GPU = /^GPU-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new ToolError(INVALID, message); };
const need = (condition, message) => { if (!condition) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(value, allowed, required = allowed, label = 'Family record') {
  need(plain(value), `${label} must be an inert record.`);
  const keys = Reflect.ownKeys(value);
  need(required.every(key => own(value, key)) && keys.every(key => typeof key === 'string' && allowed.includes(key)), `${label} has missing or unsupported fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor.enumerable && own(descriptor, 'value'), `${label} cannot contain accessors or hidden fields.`);
  }
}
function list(value, maximum, label) {
  need(Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1, `${label} must be a bounded dense list.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    need(descriptor && descriptor.enumerable && own(descriptor, 'value'), `${label} cannot contain accessors or holes.`);
  }
  return value;
}
function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} must be an exact bounded integer.`); return value;
}
function identity(value, label) { need(typeof value === 'string' && ID.test(value), `${label} must be a bounded evidence identity.`); return value; }
function digest(value, label) { need(typeof value === 'string' && HASH.test(value), `${label} must be a SHA256 digest.`); return value; }
function exactInteger(value, label, minimum = -9223372036854775808n, maximum = 18446744073709551615n) {
  need(typeof value === 'string' && /^(0|-?[1-9]\d{0,19})$/.test(value), `${label} must retain its exact filesystem integer.`);
  const result = BigInt(value); need(result >= minimum && result <= maximum, `${label} exceeds its exact bound.`); return result;
}
function sourceIdentity(value) {
  const keys = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest']; record(value, keys);
  need(typeof value.canonicalPath === 'string' && value.canonicalPath.length <= 32767 && path.isAbsolute(value.canonicalPath)
    && !/[\x00-\x1f\x7f]/.test(value.canonicalPath), 'The current source needs its canonical absolute path.');
  const result = { canonicalPath: value.canonicalPath };
  for (const key of keys.slice(1, -1)) { exactInteger(value[key], key, ['dev', 'ino', 'size'].includes(key) ? 1n : -9223372036854775808n); result[key] = value[key]; }
  need(typeof value.sparseDigest === 'string' && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(value.sparseDigest), 'The current complete bounded source identity needs its sparse digest.');
  result.sparseDigest = value.sparseDigest; return result;
}
function settings(value) {
  record(value, ['profileId', 'preset', 'quality']); const result = validateSettings(value);
  need(result.quality === 25 && (result.profileId === 'h265-cpu' && result.preset === 'slow'
    || result.profileId === 'h265-nvidia' && result.preset === 'p5'), 'Only the exact measured CPU slow CRF 25 or NVIDIA p5 CQ 25 HEVC tuple belongs to this family.'); return result;
}
function environment(value, config, runtimeIdentity) {
  if (config.profileId === 'h265-cpu') { need(value === null || value === undefined, 'A CPU family has a null device environment.'); return null; }
  record(value, ['adapterIdentity', 'driverVersion', 'runtimeVersion']);
  need(typeof value.adapterIdentity === 'string' && GPU.test(value.adapterIdentity)
    && typeof value.driverVersion === 'string' && /^\d{1,4}\.\d{1,6}(?:\.\d{1,6}){0,2}$/.test(value.driverVersion)
    && value.runtimeVersion === `FFmpeg9.0.2:${runtimeIdentity}`, 'A NVIDIA family needs the exact observed UUID, driver and pinned pair runtime.');
  return { adapterIdentity: value.adapterIdentity, driverVersion: value.driverVersion, runtimeVersion: value.runtimeVersion };
}
function budget(value) {
  const keys = ['sourceDecode', 'timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']; record(value, keys);
  need(value.sourceDecode === 'complete', 'The family requires explicitly budgeted complete source collection.');
  return { sourceDecode: 'complete', ...Object.fromEntries(keys.slice(1).map(key => [key,
    integer(value[key], key, 1, key === 'timeoutMs' ? 2147483647 : Number.MAX_SAFE_INTEGER)])) };
}
function qualification(value, runtimeIdentity) {
  record(value, ['evidenceId', 'runtimeIdentity', 'containerDuration', 'tolerances']);
  const evidenceId = identity(value.evidenceId, 'Endpoint evidence');
  need(value.runtimeIdentity === runtimeIdentity && ['span', 'end-timestamp', 'matroska-packet-end-plus-codec-delay', 'matroska-copy-end-plus-codec-delay'].includes(value.containerDuration), 'Endpoint qualification must bind this exact runtime.');
  const keys = ['videoTimestampUs', 'audioTimestampUs', 'avSyncUs', 'durationUs', 'sampleCount']; record(value.tolerances, keys);
  return { evidenceId, runtimeIdentity, containerDuration: value.containerDuration,
    tolerances: Object.fromEntries(keys.map(key => [key, integer(value.tolerances[key], key, 0, key === 'sampleCount' ? 1048576 : 1000000)])) };
}
function timingQualification(value, runtimeIdentity, lossless = false) {
  record(value, ['evidenceId', 'runtimeIdentity', 'videoDurationUs', 'audioTimelineUs', 'aac']);
  if (lossless) {
    // Copy and integer PCM -> FLAC carry no AAC encoder alignment.
    need(value.aac === null, 'A copied-audio or precision-FLAC family carries no AAC encoder alignment.');
    const evidenceId = identity(value.evidenceId, 'Interior timing evidence'); need(value.runtimeIdentity === runtimeIdentity, 'Interior timing qualification must bind this exact runtime.');
    return { evidenceId, runtimeIdentity, videoDurationUs: integer(value.videoDurationUs, 'Video duration tolerance', 0, 1000000),
      audioTimelineUs: integer(value.audioTimelineUs, 'Audio clock tolerance', 0, 1000000), aac: null };
  }
  const evidenceId = identity(value.evidenceId, 'Interior timing evidence'); need(value.runtimeIdentity === runtimeIdentity, 'Interior timing qualification must bind this exact runtime.');
  record(value.aac, ['alignment', 'encoderDelaySamples', 'discardPaddingSamples']);
  need(value.aac.alignment === 'decoded-after-signalled-skip', 'AAC needs the retained measured decoder-signalled alignment.');
  return { evidenceId, runtimeIdentity, videoDurationUs: integer(value.videoDurationUs, 'Video duration tolerance', 0, 1000000),
    audioTimelineUs: integer(value.audioTimelineUs, 'Audio clock tolerance', 0, 1000000), aac: { alignment: value.aac.alignment,
      encoderDelaySamples: integer(value.aac.encoderDelaySamples, 'AAC encoder delay', 0, 1048576),
      discardPaddingSamples: integer(value.aac.discardPaddingSamples, 'AAC discard padding', 0, 1048576) } };
}
function family(value) {
  const id = plain(value) && Object.getOwnPropertyDescriptor(value, 'id');
  const proportional = id && own(id, 'value') && proportionalId(id.value);
  const keys = ['id', 'evidenceIds', 'runtimeIdentity', 'environment', 'settings', 'qualification', 'timingQualification', ...(proportional ? ['resourcePolicy'] : ['budget', 'executionBudgetMs'])]; record(value, keys);
  need(proportional || FAMILY_IDS.includes(value.id), 'Only the fixed SDR AAC-range, FLAC-range and whole-file copied-audio family schemas are implemented.');
  const full = value.id === FULL, flac = value.id === FLAC || proportional;
  if (proportional) need(value.resourcePolicy === resourcePolicy(value.id), 'Only the fixed proportional FLAC resource policy is supported.');
  const evidenceIds = list(value.evidenceIds, 32, 'Family provenance').map(item => identity(item, 'Retained family evidence'));
  need(evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length, 'Family provenance needs unique retained evidence identities.');
  const runtimeIdentity = digest(value.runtimeIdentity, 'Paired runtime'), config = settings(value.settings);
  need(config.profileId !== 'h265-cpu' || value.environment === null, 'The trusted CPU family must explicitly store a null environment.');
  if (proportional) need(config.profileId === 'h265-cpu', 'The proportional FLAC family is CPU-only.');
  const endpoint = qualification(value.qualification, runtimeIdentity), timing = timingQualification(value.timingQualification, runtimeIdentity, full || flac);
  // The packet clock is the precision-AAC model; the copy clock belongs only to copied audio.
  need(full ? endpoint.containerDuration === 'matroska-copy-end-plus-codec-delay' && endpoint.tolerances.sampleCount === 0
    : endpoint.containerDuration !== 'matroska-copy-end-plus-codec-delay',
  'A copied-audio family uses the copy clock and an exact sample count; the copy clock belongs to no other family.');
  // TEMP mux observations established the existing end-timestamp model, with
  // no codec delay. This family never borrows either AAC clock or padding.
  need(!flac || endpoint.containerDuration === 'end-timestamp' && endpoint.tolerances.sampleCount === 0,
    'The precision-FLAC range family uses end-timestamp and an exact sample count, with no packet or copy clock.');
  if (flac) {
    // Match the calibration's frozen ceilings at catalog admission too. This
    // cannot widen a retained FLAC bound or change either older family's schema.
    for (const [key, maximum] of Object.entries({ videoTimestampUs: 1067, audioTimestampUs: 22355, avSyncUs: 23422, durationUs: 1088 })) {
      need(endpoint.tolerances[key] <= maximum, `The precision-FLAC ${key} tolerance exceeds the frozen AAC range ceiling.`);
    }
    need(timing.videoDurationUs <= 1067 && timing.audioTimelineUs <= 1042,
      'The precision-FLAC interior timing tolerances exceed the frozen AAC range ceilings.');
  }
  need([endpoint.evidenceId, timing.evidenceId].every(id => evidenceIds.includes(id)), 'Both measured qualifications must belong to retained family provenance.');
  return freeze({ id: value.id, evidenceIds, runtimeIdentity, environment: environment(value.environment, config, runtimeIdentity), settings: config,
    qualification: endpoint, timingQualification: timing, ...(proportional ? { resourcePolicy: resourcePolicy(value.id) }
      : { budget: budget(value.budget), executionBudgetMs: integer(value.executionBudgetMs, 'Execution budget', 1, 1800000) }) });
}
function rational(value, short = false) {
  record(value, short ? ['n', 'd'] : ['numerator', 'denominator']); const n = short ? value.n : value.numerator, d = short ? value.d : value.denominator;
  need(typeof n === 'string' && /^-?(0|[1-9]\d{0,39})$/.test(n) && typeof d === 'string' && /^[1-9]\d{0,39}$/.test(d), 'An exact bounded rational with a positive denominator is required.');
  return { n: BigInt(n), d: BigInt(d) };
}
const compare = (a, b) => a.n * b.d - b.n * a.d;
const minus = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const absolute = value => ({ n: value.n < 0n ? -value.n : value.n, d: value.d });
const rat = (n, d = 1n) => ({ n, d });
function known(value, label) { need(value?.state === 'known', `Known ${label} is required.`); return value.value; }
function observedRational(value, label) { return rational(known(value, label)); }
function positiveExtent(value, label, proportional = false) {
  const result = observedRational(value, label), limit = proportional ? rat(BigInt(Number.MAX_SAFE_INTEGER), 1000000n) : rat(120n);
  need(result.n > 0n && compare(result, limit) <= 0n, proportional ? `${label} must be positive and within exact microsecond capacity.` : `${label} must be positive and at most 120 seconds.`); return result;
}
function extentUs(value) {
  const result = (value.n * 1000000n + value.d - 1n) / value.d;
  need(result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER), 'Source extent exceeds exact microsecond capacity.');
  return Number(result);
}
function orientation(geometry) {
  const rotation = geometry.rotationDegrees, legacy = geometry.legacyRotationDegrees, matrix = geometry.displayMatrix;
  need(!geometry.issues?.length && [rotation, legacy, matrix].every(value => value && value.state !== 'malformed'), 'Source orientation must be complete and unambiguous.');
  const absent = geometry.rotationSource === 'not-reported' && [rotation, legacy, matrix].every(value => value.state === 'unknown');
  if (absent) return 'absent';
  need(rotation.state === 'known' && rational(rotation.value).n === 0n && (legacy.state === 'unknown'
    || legacy.state === 'known' && rational(legacy.value).n === 0n), 'Reported orientation must explicitly be identity zero.');
  if (geometry.rotationSource === 'legacy-rotate-tag') need(legacy.state === 'known' && matrix.state === 'unknown', 'A legacy identity rotation cannot override a conflicting matrix.');
  else {
    need(geometry.rotationSource === 'display-matrix' && matrix.state === 'known'
      && same(matrix.value, ['65536', '0', '0', '0', '65536', '0', '0', '0', '1073741824']), 'Only the explicit identity display matrix belongs to this family.');
  }
  return 'identity';
}
function timeline(stream, proportional = false) {
  const value = stream.timeline, timeBase = observedRational(value.timeBase, 'stream time base'); need(timeBase.n > 0n, 'Stream time base must be positive.');
  need(known(value.startPts, 'stream start ticks') === '0' && observedRational(value.startSeconds, 'stream start').n === 0n, 'Every source stream must have an explicit zero origin.');
  const duration = positiveExtent(value.durationSeconds, 'Stream duration', proportional), ticks = exactInteger(known(value.durationTicks, 'stream duration ticks'), 'Duration ticks', 1n, 9223372036854775807n);
  need(compare(absolute(minus(duration, rat(ticks * timeBase.n, timeBase.d))), rat(1n, 1000000n)) <= 0n, 'Stream duration ticks and seconds must agree within reported decimal precision.');
  return { timeBase, duration };
}
function streamSideData(video, audio) {
  const entries = list(video.side_data_list === undefined ? [] : video.side_data_list, 1, 'Qualified video stream side data');
  need(list(audio.side_data_list === undefined ? [] : audio.side_data_list, 0, 'Qualified audio stream side data').length === 0,
    'Audio stream side data requires a separate qualified policy.');
  for (const entry of entries) {
    record(entry, ['side_data_type', 'displaymatrix', 'rotation']);
    need(entry.side_data_type === 'Display Matrix' && typeof entry.displaymatrix === 'string' && entry.displaymatrix.length <= 1024
      && (typeof entry.rotation === 'number' && entry.rotation === 0
        || typeof entry.rotation === 'string' && /^-?0(?:\.0{1,18})?$/.test(entry.rotation)),
    'Only the bounded explicit identity display-matrix stream representation is qualified.');
  }
  // The typed geometry policy separately parses and verifies all nine matrix
  // entries and any legacy representation. Unknown original side-data fields
  // remain in normalizeProbe and are refused here, rather than silently ignored.
}
function sourceFacts(probe, actualBytes, proportional = false) {
  need(probe.streams.length === 2 && probe.chapters.length === 0 && Array.isArray(probe.programs) && !probe.programs.length
    && Array.isArray(probe.stream_groups) && !probe.stream_groups.length, 'The family requires exactly one video and one audio stream with no chapters, programs or groups.');
  const video = probe.streams.find(item => item.codec_type === 'video'), audio = probe.streams.find(item => item.codec_type === 'audio');
  need(video && audio && video.index !== audio.index && video.codec_name === 'h264' && video.profile === 'High' && video.pix_fmt === 'yuv420p'
    && video.field_order === 'progressive' && Number(video.disposition?.attached_pic || 0) === 0
    && (video.width === 1920 && video.height === 1080 || video.width === 1280 && video.height === 720), 'Only progressive 8-bit H264 High 1080p/720p source video belongs to this family.');
  need(['30/1', '60/1'].includes(video.avg_frame_rate) && video.r_frame_rate === video.avg_frame_rate, 'Only matching nominal and average 30/1 or 60/1 rates belong to this family.');
  // Refuse unsupported audio before side-data or clock diagnostics. Codec
  // selection remains per family; this common shape grants no applicability.
  need(String(audio.sample_rate) === '48000' && audio.channels === 2 && audio.channel_layout === 'stereo'
    && (audio.codec_name === 'aac' && audio.profile === 'LC' && audio.sample_fmt === 'fltp'
      || audio.codec_name === 'pcm_s16le' && audio.sample_fmt === 's16'),
  'Only 48 kHz stereo AAC LC/fltp or pcm_s16le/s16 source audio belongs to these families.');
  streamSideData(video, audio);
  need(probe.format.format_name === 'mov,mp4,m4a,3gp,3g2,mj2', 'Only the observed MOV/MP4 demuxer family is implemented.');
  const media = probe.mediaEvidence, container = media.container;
  need(container.relationships.state === 'known' && known(container.relationships.reportedStreamCount, 'stream count') === '2'
    && known(container.programs.reportedCount, 'program count') === '0' && known(container.streamGroups.reportedCount, 'stream group count') === '0', 'Source relationships must explicitly establish the complete two-stream layout.');
  need(observedRational(container.startSeconds, 'container start').n === 0n, 'Container origin must explicitly be zero.');
  const containerExtent = positiveExtent(container.durationSeconds, 'Container duration', proportional);
  const reportedBytes = exactInteger(known(container.size, 'container byte size'), 'Container byte size', 1n, BigInt(proportional ? Number.MAX_SAFE_INTEGER : MAX_BYTES));
  if (actualBytes !== undefined) need(actualBytes > 0n && actualBytes <= BigInt(proportional ? Number.MAX_SAFE_INTEGER : MAX_BYTES) && reportedBytes === actualBytes, 'The actual current source size must match the bounded observed container size.');
  const ve = media.streams.find(item => item.index === video.index), ae = media.streams.find(item => item.index === audio.index);
  need(compare(observedRational(ve.geometry.sampleAspectRatio, 'sample aspect ratio'), rat(1n)) === 0n
    && compare(observedRational(ve.geometry.displayAspectRatio, 'display aspect ratio'), rat(16n, 9n)) === 0n, 'Only explicit square-pixel 16:9 geometry belongs to this family.');
  need(['color_transfer', 'color_primaries', 'color_space'].every(key => video[key] === 'bt709') && video.color_range === 'tv' && video.chroma_location === 'left'
    && !ve.hdr.entries.length && !ae.hdr.entries.length, 'Explicit BT709 limited-range SDR without reported HDR metadata is required.');
  const videoTimeline = timeline(ve, proportional), audioTimeline = timeline(ae, proportional), rate = Number(video.avg_frame_rate.split('/')[0]);
  need(compare(videoTimeline.timeBase, rat(1n, BigInt(rate))) <= 0n && compare(audioTimeline.timeBase, rat(1n, 48000n)) <= 0n, 'Observed source timestamp ticks must resolve the nominal video period and audio samples.');
  return { rate, width: video.width, videoIndex: video.index, audioIndex: audio.index, sourceAudio: audio,
    majorBrand: probe.format.tags?.major_brand, videoTick: videoTimeline.timeBase,
    audioTick: audioTimeline.timeBase, orientation: orientation(ve.geometry), videoEvidence: ve, audioEvidence: ae,
    extents: { video: videoTimeline.duration, audio: audioTimeline.duration, container: containerExtent } };
}
function rangeScope(request, facts, contract, flac = false, proportional = false) {
  const policy = flac ? 'precision-flac' : 'precision-aac';
  need(request.operation === 'encode' && request.target === 'matroska' && ['preserve', 'sdr'].includes(request.hdrPolicy)
    && request.audioPolicy === policy && request.aacBitrateKbps === null
    && Array.isArray(request.omissionRequestIds) && request.omissionRequestIds.length === 0,
  flac ? 'Only SDR Matroska range encoding with precision FLAC and no omissions belongs to this family.'
    : 'Only SDR Matroska range encoding with layout-default precision AAC and no omissions belongs to this family.');
  need(request.resolution === 'source' || request.resolution === '720' && facts.width === 1920, 'Only Keep Source or 1080p to 720p belongs to this family.');
  const range = contract?.range || resolveTimeRange(facts.videoEvidence, request.range);
  need(range.kind === 'range' && range.resolved && Number.isSafeInteger(range.resolved.startUs) && Number.isSafeInteger(range.resolved.endUs), 'A resolved bounded range is required.');
  const span = range.resolved.endUs - range.resolved.startUs;
  need(range.resolved.startUs >= 0 && span >= 500000 && (proportional || span <= 30000000) && range.resolved.endUs <= (proportional ? extentUs(facts.extents.video) : MAX_EXTENT_US), proportional ? 'The resolved range must retain at least 0.5 seconds within the complete source.' : 'The resolved range must retain 0.5 to 30 seconds within the bounded source.');
  const audio = contract?.audio || resolveAudio([facts.audioEvidence], { target: request.target, range, audioPolicy: request.audioPolicy, aacBitrateKbps: request.aacBitrateKbps });
  need(audio.streams.length === 1 && audio.streams[0].index === facts.audioIndex && audio.streams[0].mode === policy
    && audio.streams[0].sampleRate === 48000 && audio.streams[0].channels === 2 && audio.streams[0].channelLayout === 'stereo'
    && (flac ? audio.streams[0].codec === 'flac' && audio.streams[0].sourceSampleFormat === 's16' && audio.streams[0].bitrateKbps === null
      : audio.streams[0].bitrateKbps === 320 && audio.streams[0].bitrateOrigin === 'layout-policy'),
  flac ? 'The canonical audio contract must encode exactly the one 48 kHz stereo s16 source stream as precision FLAC.'
    : 'The canonical audio contract must retain 48 kHz stereo at the measured layout-default 320 kb/s AAC policy.');
  return Object.fromEntries(['range', 'resolution', 'target', 'hdrPolicy', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'].map(key => [key, structuredClone(request[key])]));
}
function fullScope(request, facts, contract) {
  need(request.operation === 'encode' && request.target === 'matroska' && ['preserve', 'sdr'].includes(request.hdrPolicy)
    && request.audioPolicy === 'copy' && request.aacBitrateKbps === null
    && Array.isArray(request.omissionRequestIds) && request.omissionRequestIds.length === 0, 'Only SDR Matroska whole-file encoding with copied audio and no omissions belongs to this family.');
  need(request.resolution === '720' && facts.width === 1920 && facts.rate === 30, 'Only 1080p30 to 720p belongs to the whole-file copied-audio family.');
  const range = contract?.range || resolveTimeRange(facts.videoEvidence, request.range);
  need(range.kind === 'full' && request.range === null, 'The whole-file copied-audio family encodes the whole file only.');
  fullExtents(facts.extents.video, facts.extents.audio, 'reported');
  need(compare(facts.extents.container, rat(FULL_MAX_SECONDS)) <= 0n
    && compare(minus(facts.extents.container, maximum(facts.extents.video, facts.extents.audio)), AAC_FRAME) <= 0n,
  'The reported container must not run past its streams by more than one AAC frame, within 31 seconds.');
  const audio = contract?.audio || resolveAudio([facts.audioEvidence], { target: request.target, range, audioPolicy: request.audioPolicy, aacBitrateKbps: request.aacBitrateKbps });
  need(audio.streams.length === 1 && audio.streams[0].index === facts.audioIndex && audio.streams[0].mode === 'copy' && audio.streams[0].codec === 'aac',
    'The canonical audio contract must copy exactly the one AAC source stream.');
  return Object.fromEntries(['range', 'resolution', 'target', 'hdrPolicy', 'audioPolicy', 'aacBitrateKbps', 'omissionRequestIds'].map(key => [key, structuredClone(request[key])]));
}
function maximum(a, b) { return compare(a, b) >= 0n ? a : b; }
// Whole-file copied-audio extents, from metadata or from the decoded source.
function fullExtents(video, audio, label) {
  for (const [value, name] of [[video, 'video'], [audio, 'audio']]) {
    need(compare(value, rat(FULL_MIN_SECONDS)) >= 0n && compare(value, rat(FULL_MAX_SECONDS)) <= 0n, `The ${label} ${name} must last 10 to 31 seconds for the whole-file copied-audio family.`);
  }
  need(compare(absolute(minus(audio, video)), AAC_FRAME) <= 0n, `The ${label} audio must end within one AAC frame of the video for the whole-file copied-audio family.`);
}
function requestScope(request, facts, contract, id = FAMILY) {
  const audio = facts.sourceAudio, proportional = proportionalId(id), flac = id === FLAC || proportional;
  if (proportional) {
    need(facts.rate === 30 && (id === RESIZE_PROPORTIONAL
      ? facts.width === 1920 && request.resolution === '720'
      : facts.width === 1280 && request.resolution === 'source'),
    'Only the exact proportional 720p30 Keep Source or 1080p30 to720p range belongs to its respective family.');
    // The core contract carries the measured clock boundary too; a caller must
    // not obtain a broader branded family by omitting the Linux composition.
    need(compare(facts.videoTick, rat(1n, 15360n)) === 0n && compare(facts.audioTick, rat(1n, 48000n)) === 0n,
      'The proportional FLAC family requires its measured video and audio clocks.');
  }
  // The PCM endpoint evidence was measured in QuickTime, not MP4-branded
  // files sharing the MOV demuxer. Preserve the exact brand, including spaces.
  need(!flac || facts.majorBrand === 'qt  ', 'The precision-FLAC range family requires the measured QuickTime major brand qt  .');
  need(String(audio.sample_rate) === '48000' && audio.channels === 2 && audio.channel_layout === 'stereo'
    && (flac ? audio.codec_name === 'pcm_s16le' && audio.sample_fmt === 's16'
      && (audio.bits_per_sample === undefined || String(audio.bits_per_sample) === '16')
      && (audio.bits_per_raw_sample === undefined || ['0', '16'].includes(String(audio.bits_per_raw_sample)))
      : audio.codec_name === 'aac' && audio.profile === 'LC' && audio.sample_fmt === 'fltp'),
  flac ? 'Only 48 kHz stereo pcm_s16le/s16 source audio belongs to the precision-FLAC range family.'
    : 'Only 48 kHz stereo AAC LC/fltp source audio belongs to this family.');
  return id === FULL ? fullScope(request, facts, contract) : rangeScope(request, facts, contract, flac, proportional);
}
const BINDINGS = ['plan', 'settings', 'sourceIdentity', 'sourceProbeFingerprint', 'runtimeIdentity', 'environment', 'budget', 'executionBudgetMs'];
function bindings(value, familyId, scopeOnly = false) {
  record(value, BINDINGS, BINDINGS.filter(key => key !== 'environment'), 'Main-owned family admission');
  const config = settings(value.settings), source = sourceIdentity(value.sourceIdentity), fingerprint = digest(value.sourceProbeFingerprint, 'Source probe fingerprint');
  const plan = assertEncodeOperationPlan(value.plan, { settings: config, sourceProbeFingerprint: fingerprint, sourcePath: source.canonicalPath });
  const runtimeIdentity = digest(value.runtimeIdentity, 'Paired runtime');
  need(!plan.compatibilityPath && plan.runtimeIdentity === runtimeIdentity && plan.expectedOutput?.operation === 'encode'
    && plan.expectedOutput.color?.supported === true && plan.expectedOutput.color.classification === 'sdr', 'A genuine matching changed SDR Encode plan is required.');
  // Without a family id this only gathers facts; the scope is that family's own.
  const proportional = proportionalId(familyId);
  if (proportional && !scopeOnly) need(value.budget === null, 'Proportional selection derives its budget; caller overrides are forbidden.');
  const facts = sourceFacts(describeEncodeOperationSource(plan), BigInt(source.size), proportional);
  const base = { plan, facts, sourcePolicy: { id: null, rate: facts.rate, maximumExtentUs: MAX_EXTENT_US }, state: { planFingerprint: digest(plan.planFingerprint, 'Plan fingerprint'), settings: config, sourceIdentity: source,
    sourceProbeFingerprint: fingerprint, runtimeIdentity, environment: environment(value.environment, config, runtimeIdentity), familyId: null, request: null,
    budget: proportional || scopeOnly ? null : budget(value.budget), executionBudgetMs: scopeOnly ? 0 : integer(value.executionBudgetMs, 'Execution budget', 1, 1800000) } };
  return familyId === undefined ? base : forFamily(base, familyId);
}
// Binds one family's own scope to bindings already read once; options are never re-read.
function forFamily(base, familyId) {
  const request = requestScope(base.plan.contract.request, base.facts, base.plan.contract, familyId);
  if (proportionalId(familyId)) {
    const sourceExtentUs = extentUs(maximum(maximum(base.facts.extents.video, base.facts.extents.audio), base.facts.extents.container));
    const interval = base.plan.contract.range.resolved, selectedExtentUs = interval.endUs - interval.startUs;
    const derive = familyId === RESIZE_PROPORTIONAL ? deriveCfrResizeFlacResources : deriveCfrFlacResources;
    const derived = derive({ sourceExtentUs, selectedExtentUs, sourceBytes: base.state.sourceIdentity.size });
    return { plan: base.plan, facts: base.facts, sourcePolicy: { id: familyId, rate: base.facts.rate, maximumExtentUs: sourceExtentUs },
      state: { ...base.state, familyId, request, resourcePolicy: resourcePolicy(familyId), sourceExtentUs, selectedExtentUs,
        inputBudget: base.state.budget, inputExecutionBudgetMs: base.state.executionBudgetMs, ...derived } };
  }
  return { plan: base.plan, facts: base.facts, sourcePolicy: { ...base.sourcePolicy, id: familyId }, state: { ...base.state, familyId, request } };
}
// The refusal that names the family the request was aimed at (whole file or range).
function preferredReason(reasons, request) {
  return reasons.get(request?.audioPolicy === 'precision-flac' ? FLAC : request?.range === null ? FULL : FAMILY) || reasons.values().next().value || null;
}
function checked(code, action) {
  try { return action(); } catch (error) { if (error.code === 'INVALID_ENCODE_OPERATION' || error.code === AMBIGUOUS) throw error; throw new ToolError(code, error.message || 'The source family is not qualified.'); }
}
function inert(value, state = { count: 0 }, depth = 0) {
  need(depth <= 12 && ++state.count <= 32768, 'Inspection exceeds the bounded family input.');
  if (value === null || ['number', 'boolean', 'string'].includes(typeof value)) { need(typeof value !== 'string' || value.length <= 524288, 'Inspection string exceeds its bound.'); return; }
  need(plain(value) || Array.isArray(value), 'Inspection must contain only inert data.');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value'), 'Inspection cannot contain accessors or hidden data.'); inert(descriptor.value, state, depth + 1);
  }
}

// Reads only a plain data property, so no getter runs before the inert walk.
function resolutionOf(request) {
  if (!plain(request)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(request, 'resolution');
  return descriptor && own(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : null;
}

class OperationFamilySelector {
  #families; #policy; #epoch = 0; #selections = new WeakMap();
  constructor(options) {
    record(options, ['families', 'policyIdentity'], ['policyIdentity']); this.#policy = identity(options.policyIdentity, 'Family evidence policy');
    this.#families = list(options.families === undefined ? [] : options.families, 32, 'Family catalog').map(family);
    const keys = this.#families.map(item => JSON.stringify([item.id, item.runtimeIdentity, item.environment, item.settings]));
    need(new Set(keys).size === keys.length, 'One exact runtime/environment/settings tuple cannot have ambiguous family records.'); freeze(this.#families);
  }
  select(options) {
    return checked(REQUIRED, () => {
      record(options, BINDINGS, ['plan'], 'Main-owned family selection'); const plan = assertEncodeOperationPlan(options.plan);
      if (plan.compatibilityPath) return null;
      const config = settings(options.settings), runtimeIdentity = digest(options.runtimeIdentity, 'Paired runtime');
      const device = environment(options.environment, config, runtimeIdentity);
      const matches = this.#families.filter(item => item.runtimeIdentity === runtimeIdentity
        && same(item.settings, config) && same(item.environment, device));
      // Each exact catalog candidate applies its own bounds; legacy metadata is
      // never globally widened merely because another proportional family exists.
      const reasons = new Map(), admitted = [];
      for (const item of matches) {
        try { bindings(options, item.id, true); admitted.push(item); }
        catch (error) { if (error.code === 'INVALID_ENCODE_OPERATION') throw error; reasons.set(item.id, error.message); }
      }
      if (admitted.length > 1) throw new ToolError(AMBIGUOUS, 'More than one measured family admits this exact job; nothing was selected.');
      need(admitted.length === 1, preferredReason(reasons, plan.contract.request) || 'No trusted measured family and exact complete execution budget apply to this current job.');
      const selected = admitted[0], current = bindings(options, selected.id), proportional = proportionalId(selected.id);
      need(proportional || same(selected.budget, current.state.budget) && selected.executionBudgetMs === current.state.executionBudgetMs, 'No trusted measured family and exact complete execution budget apply to this current job.');
      const token = Object.freeze({}), result = freeze({ qualification: selected.qualification, timingQualification: selected.timingQualification,
        budget: current.state.budget, evidenceIds: selected.evidenceIds, executionBudgetMs: current.state.executionBudgetMs, policyIdentity: this.#policy,
        controlsRequired: true, sourcePolicy: current.sourcePolicy,
        ...(proportional ? { proportional: true, resourcePolicy: resourcePolicy(selected.id), resources: current.state.resources } : {}) });
      if (proportional) { const epoch = this.#epoch; proportionalResults.set(result, { plan: current.plan, sourceIdentity: freeze(current.state.sourceIdentity),
        sourceProbeFingerprint: current.state.sourceProbeFingerprint, verify: evidence => this.#verifyCollectedSource(token, evidence), current: () => this.#epoch === epoch }); }
      this.#selections.set(token, { epoch: this.#epoch, plan: current.plan, state: freeze(current.state), facts: current.facts, result }); return token;
    });
  }
  #selected(token) { const value = token && typeof token === 'object' ? this.#selections.get(token) : null;
    need(value && value.epoch === this.#epoch, 'Only this family selector\'s current private selection is usable.'); return value; }
  requireCurrent(token, options) {
    return checked(STALE, () => { const selected = this.#selected(token), current = bindings(options, selected.state.familyId);
      need(selected.plan === current.plan && same(selected.state, current.state), 'The exact plan, source, probe, runtime, environment, settings, request or budget changed.'); return selected.result; });
  }
  invalidate(diagnosticReason) { need(typeof diagnosticReason === 'string' && /^[\x20-\x7e]{1,512}$/.test(diagnosticReason) && diagnosticReason.trim(), 'Invalidation requires a bounded diagnostic reason.'); this.#epoch++; }
  orientationQualification(options) {
    record(options, ['inspection', 'request', 'runtimeIdentity', 'settings']);
    // This helper can only interpret absence for the one resize route. Avoid
    // adding family/runtime preconditions, including the bounded inert walk,
    // to unrelated ordinary Full requests.
    if (resolutionOf(options.request) !== '720') return {};
    inert(options.inspection); inert(options.request);
    // Ordinary Full settings and known recipes can legitimately be outside the
    // family; they receive no orientation override and keep their existing path.
    record(options.settings, ['profileId', 'preset', 'quality', 'recipeId'], ['profileId', 'preset', 'quality']);
    const config = validateSettings(options.settings);
    const runtimeIdentity = digest(options.runtimeIdentity, 'Paired runtime');
    const tuple = this.#families.filter(item => item.runtimeIdentity === runtimeIdentity && same(item.settings, config)); if (!tuple.length) return {};
    try {
      const probe = normalizeProbe(options.inspection.probe);
      let facts;
      const selected = tuple.find(item => { try {
        const candidate = sourceFacts(probe, undefined, proportionalId(item.id));
        requestScope(options.request, candidate, undefined, item.id); facts = candidate; return true;
      } catch { return false; } });
      if (!selected || facts.orientation !== 'absent') return {};
      return freeze({ identityOrientationQualification: { evidenceId: selected.qualification.evidenceId, runtimeIdentity,
        sourceEvidenceFingerprint: fingerprintEncodeSource(probe), videoIndex: facts.videoIndex } });
    } catch { return {}; }
  }
  // Main-only diagnosis for a resize whose plan could not be built. It grants
  // nothing: it returns null whenever some measured family admits the request,
  // so the original geometry refusal stands, and otherwise names the missing
  // qualification instead of an orientation detail of an unqualified route.
  explainResize(options) {
    record(options, ['inspection', 'request', 'runtimeIdentity', 'settings']);
    const resolution = resolutionOf(options.request); if (resolution === null || resolution === 'source') return null;
    inert(options.inspection); inert(options.request);
    // Explain only a real downscale of a picture with no reported orientation
    // at all. Already-fitting requests, partial or conflicting orientation and
    // other geometry faults keep their own specific refusal.
    try {
      const probe = normalizeProbe(options.inspection.probe), index = selectVideo(probe).index;
      const evidence = structuredClone(probe.mediaEvidence.streams.find(item => item.index === index)), g = evidence?.geometry;
      if (!plain(g) || g.rotationSource !== 'not-reported'
          || !['rotationDegrees', 'legacyRotationDegrees', 'displayMatrix'].every(field => g[field]?.state === 'unknown')) return null;
      g.rotationSource = 'qualified-identity'; g.rotationDegrees = { state: 'known', value: { numerator: '0', denominator: '1' } };
      if (resolveGeometry(evidence, resolution).mode !== 'downscale') return null;
    } catch { return null; }
    const refusal = reason => freeze({ code: 'OPERATION_RESIZE_UNQUALIFIED',
      message: `This resize has no measured qualification, so no plan was created. ${reason}`.slice(0, 1024) });
    let config, runtimeIdentity;
    try {
      record(options.settings, ['profileId', 'preset', 'quality', 'recipeId'], ['profileId', 'preset', 'quality']);
      config = validateSettings(options.settings); runtimeIdentity = digest(options.runtimeIdentity, 'Paired runtime');
    } catch { return refusal('The encoder settings are outside every measured family.'); }
    const tuple = this.#families.filter(item => item.runtimeIdentity === runtimeIdentity && same(item.settings, config));
    if (!tuple.length) return refusal('No measured family exists for these encoder settings and this runtime.');
    const reasons = new Map(); let reason = null;
    try {
      const facts = sourceFacts(normalizeProbe(options.inspection.probe));
      for (const item of tuple) { try { requestScope(options.request, facts, undefined, item.id); return null; } catch (error) { if (typeof error?.message === 'string' && error.message) reasons.set(item.id, error.message); } }
      reason = preferredReason(reasons, options.request);
    } catch (error) { reason = typeof error?.message === 'string' && error.message ? error.message : null; }
    return refusal(reason || 'The file or request is outside the measured family.');
  }
  verifyCollectedSource(token, evidence) { return this.#verifyCollectedSource(token, evidence); }
  #verifyCollectedSource(token, evidence) {
    return checked(SOURCE_FAILED, () => {
      const selected = this.#selected(token);
      need(plain(evidence), 'A complete main-owned collection receipt is required.');
      for (const key of ['schema', 'runtimeIdentity', 'planFingerprint', 'sourcePath', 'status', 'completeSource']) {
        const descriptor = Object.getOwnPropertyDescriptor(evidence, key); need(descriptor?.enumerable && own(descriptor, 'value'), 'Collection receipt is incomplete or contains accessors.');
      }
      need(evidence.schema === 1 && evidence.status === 'completed' && evidence.runtimeIdentity === selected.state.runtimeIdentity
        && evidence.planFingerprint === selected.state.planFingerprint && evidence.sourcePath === selected.state.sourceIdentity.canonicalPath, 'Complete source collection must bind this exact plan, runtime and source path.');
      record(evidence.completeSource, ['video', 'audio']);
      const video = evidence.completeSource.video, facts = selected.facts, full = selected.state.familyId === FULL, proportional = proportionalId(selected.state.familyId);
      const seconds = full ? FULL_MAX_SECONDS : 120n, limit = proportional ? rat(BigInt(selected.state.sourceExtentUs), 1000000n) : rat(seconds);
      const countLimit = rate => (limit.n * rate + limit.d - 1n) / limit.d;
      record(video, ['frames', 'firstTime', 'endTime', 'maximumNominalCadenceErrorUs', 'maximumNominalDurationErrorUs', 'maximumNominalPhaseErrorUs', 'properties']);
      integer(video.frames, 'Complete video frames', 1, Number(countLimit(BigInt(facts.rate))));
      record(video.properties, ['policy', 'sampleAspectRatio', 'chromaLocation', 'sideDataPolicy', 'framesChecked']);
      need(video.properties.policy === selected.state.familyId && video.properties.sampleAspectRatio === '1:1' && video.properties.chromaLocation === 'left'
        && video.properties.sideDataPolicy === 'h26x-unregistered-sei-only' && video.properties.framesChecked === video.frames,
      'Every complete source video frame must receive the exact qualified SAR, chroma and side-data checks.');
      const first = rational(video.firstTime, true), end = rational(video.endTime, true);
      need(first.n === 0n && end.n > 0n && compare(end, limit) <= 0n, proportional
        ? 'Complete decoded video must start at zero and end within the source-derived extent.'
        : `Complete decoded video must start at zero and end within ${seconds} seconds.`);
      for (const key of ['maximumNominalCadenceErrorUs', 'maximumNominalDurationErrorUs', 'maximumNominalPhaseErrorUs']) {
        integer(video[key], key); need(BigInt(video[key]) * facts.videoTick.d <= facts.videoTick.n * 1000000n, 'Complete source video is not CFR within its one observed source timestamp tick.');
      }
      need(compare(absolute(minus(end, rat(BigInt(video.frames), BigInt(facts.rate)))), facts.videoTick) <= 0n, 'Complete source frame count and nominal CFR extent disagree beyond one observed tick.');
      const audio = list(evidence.completeSource.audio, 1, 'Complete source audio'); need(audio.length === 1, 'Exactly one complete source audio stream is required.');
      record(audio[0], ['inputIndex', 'sampleCount', 'firstTime', 'endTime', 'gaps']);
      need(audio[0].inputIndex === facts.audioIndex && audio[0].gaps === 0, 'Complete source audio must name the original stream and contain no gaps.');
      const samples = exactInteger(audio[0].sampleCount, 'Complete source sample count', 1n, countLimit(48000n));
      const audioFirst = rational(audio[0].firstTime, true), audioEnd = rational(audio[0].endTime, true);
      need(audioFirst.n === 0n && audioEnd.n > 0n && compare(audioEnd, limit) <= 0n, proportional
        ? 'Complete decoded audio must start at zero and end within the source-derived extent.'
        : `Complete decoded audio must start at zero and end within ${seconds} seconds.`);
      need(compare(absolute(minus(audioEnd, rat(samples, 48000n))), facts.audioTick) <= 0n, 'Complete source samples and decoded audio extent disagree beyond one observed audio tick.');
      // Metadata admitted the whole-file job; the decoded source must keep the same measured shape.
      if (full) fullExtents(end, audioEnd, 'decoded');
      if (proportional) need(compare(absolute(minus(end, facts.extents.video)), facts.videoTick) <= 0n
        && compare(absolute(minus(audioEnd, facts.extents.audio)), facts.audioTick) <= 0n,
      'Complete proportional collection must cover the observed whole source, not only the selected range.');
      return true;
    });
  }
}

module.exports = { OperationFamilySelector, isProportionalFamilySelection, assertProportionalCollectionSelection, verifyProportionalCollectedSource };
