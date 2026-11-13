'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { streamCreationTimeAlias, STREAM_CREATION_TIME_ALIAS } = require('./media.cjs');
const { provenanceArgs, classifyMarker, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('./provenance.cjs');
const { REMUX_METADATA_POLICY, classifyRemuxMetadataTag } = require('./remux-metadata-policy.cjs');

// Pure main-side planning only. A table entry is a candidate for qualification,
// not evidence that a muxer preserved the requested media. This module runs no
// child, reads no file and grants no admission, omission or publication authority.
const REMUX_CONTRACT_VERSION = 1;
const TARGETS = Object.freeze(['matroska', 'mp4', 'mov']);
const TARGET_CODECS = {
  matroska: {
    video: ['h264', 'hevc', 'av1', 'vp8', 'vp9', 'mpeg1video', 'mpeg2video', 'mpeg4', 'theora', 'ffv1', 'mjpeg', 'prores'],
    audio: ['aac', 'ac3', 'eac3', 'alac', 'dts', 'flac', 'mp1', 'mp2', 'mp3', 'opus', 'vorbis', 'truehd', 'mlp', 'tta', 'wavpack',
      'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_s16be', 'pcm_s24be', 'pcm_s32be', 'pcm_u8', 'pcm_f32le', 'pcm_f64le'],
    subtitle: ['subrip', 'text', 'ass', 'ssa', 'webvtt', 'dvd_subtitle', 'dvb_subtitle', 'hdmv_pgs_subtitle', 'hdmv_text_subtitle', 'arib_caption'],
    attachment: ['ttf', 'otf', 'bin_data'],
  },
  mp4: { video: ['h264', 'hevc', 'av1', 'mpeg4'], audio: ['aac', 'ac3', 'eac3', 'mp3', 'alac'], subtitle: ['mov_text'] },
  mov: { video: ['h264', 'hevc', 'mpeg4', 'prores', 'dnxhd', 'qtrle', 'rawvideo', 'mjpeg'],
    audio: ['aac', 'ac3', 'eac3', 'alac', 'mp3', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_s16be', 'pcm_s24be', 'pcm_s32be', 'pcm_f32le', 'pcm_f64le'],
    subtitle: ['mov_text'], data: ['tmcd'] },
};
const MKV_FLAGS = ['default', 'dub', 'original', 'comment', 'forced', 'hearing_impaired', 'visual_impaired', 'descriptions'];
// Even these named flags need round-trip qualification: container track flags
// are not interchangeable merely because FFmpeg accepts the same CLI spelling.
const MOV_FLAGS = ['default', 'forced', 'hearing_impaired', 'visual_impaired', 'attached_pic'];
const APPLICATION_TAGS = [MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY];
const BRAND_TAGS = new Set(['major_brand', 'minor_version', 'compatible_brands']);
const DEFAULT_HANDLER_NAMES = new Map([['video', 'VideoHandler'], ['audio', 'SoundHandler'], ['subtitle', 'SubtitleHandler']]);
const assessments = new WeakMap();
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };

function record(value, keys, label, required = keys) {
  if (!plain(value)) fail('INVALID_REMUX_REQUEST', `${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !descriptor?.enumerable || !own(descriptor, 'value')) {
      fail('INVALID_REMUX_REQUEST', `${label} contains an unsupported field.`);
    }
  }
  if (required.some(key => !own(value, key))) fail('INVALID_REMUX_REQUEST', `${label} is incomplete.`);
}
function opaque(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) fail('INVALID_REMUX_REQUEST', `${label} must be a bounded identifier.`);
  return value;
}
function revision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REMUX_REQUEST', `${label} must be a nonnegative safe integer.`);
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Normalize only after a bounded data-only copy. Never execute getters from a
// purported probe, recurse forever, or let a large tag expand an IPC snapshot.
function copyEvidence(value) {
  const seen = new WeakSet();
  let nodes = 0, characters = 0;
  function copy(entry, depth) {
    if (++nodes > 65536 || depth > 16) fail('INVALID_REMUX_EVIDENCE', 'Media evidence exceeds the structural bound.');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (typeof entry === 'string') {
      characters += entry.length;
      if (entry.length > 16384 || characters > 1048576 || entry.includes('\0')) fail('INVALID_REMUX_EVIDENCE', 'Media evidence exceeds the text bound or contains NUL.');
      return entry;
    }
    if (!entry || typeof entry !== 'object' || (!Array.isArray(entry) && !plain(entry)) || seen.has(entry)) fail('INVALID_REMUX_EVIDENCE', 'Media evidence must be acyclic plain data.');
    seen.add(entry);
    const result = Array.isArray(entry) ? [] : {};
    if (Array.isArray(entry) && entry.length > 16384) fail('INVALID_REMUX_EVIDENCE', 'Media evidence collection exceeds its bound.');
    for (const key of Reflect.ownKeys(entry)) {
      if (Array.isArray(entry) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !own(descriptor, 'value')
          || (Array.isArray(entry) && !/^(0|[1-9]\d*)$/.test(key))) fail('INVALID_REMUX_EVIDENCE', 'Media evidence contains unsupported properties.');
      characters += key.length;
      if (key.length > 256 || characters > 1048576 || key.includes('\0')) fail('INVALID_REMUX_EVIDENCE', 'Media evidence key exceeds its bound.');
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    seen.delete(entry);
    return result;
  }
  return copy(value, 0);
}

function validateRemuxRequest(value) {
  const keys = ['fileId', 'identityRevision', 'draftRevision', 'operation', 'target', 'range', 'omissionRequestIds'];
  record(value, keys, 'Remux request', keys.filter(key => key !== 'omissionRequestIds'));
  if (value.operation !== 'remux' || !TARGETS.includes(value.target) || value.range !== null) {
    fail('INVALID_REMUX_REQUEST', 'Remux requires a Full selection and Matroska, MP4 or MOV; encoding transforms and TS output are unavailable.');
  }
  const ids = value.omissionRequestIds ?? [];
  if (!Array.isArray(ids) || ids.length > 1024) fail('INVALID_REMUX_REQUEST', 'Omission request list is invalid.');
  const omissionRequestIds = ids.map(id => opaque(id, 'Omission request ID'));
  if (new Set(omissionRequestIds).size !== omissionRequestIds.length) fail('INVALID_REMUX_REQUEST', 'Omission request IDs must be unique.');
  return freeze({ fileId: opaque(value.fileId, 'File ID'), identityRevision: revision(value.identityRevision, 'Identity revision'),
    draftRevision: revision(value.draftRevision, 'Draft revision'), operation: 'remux', target: value.target, range: null, omissionRequestIds });
}

function tagContract(tags = {}, { target, stream, container = false } = {}) {
  const preserved = {}, attempted = {}, classifications = [], representations = [], replacements = [], allowedAdditions = [], seen = new Set();
  const scope = container ? 'container' : stream ? 'stream' : 'chapter';
  const matroskaTrack = target === 'matroska' && stream && ['video', 'audio', 'subtitle'].includes(stream.codec_type);
  for (const [key, value] of Object.entries(tags)) {
    const lower = key.toLowerCase();
    if (seen.has(lower) || key.includes('=')) fail('REMUX_METADATA_AMBIGUOUS', 'Metadata contains ambiguous case-folded keys or an unrepresentable key.');
    seen.add(lower);
    const classification = classifyRemuxMetadataTag(key, { scope });
    if (container && APPLICATION_TAGS.includes(key.toUpperCase())) {
      replacements.push({ key, action: 'operation-required-transformation', reason: 'Fresh remux provenance replaces the prior application generation; prior encode settings must not describe this operation.' });
    } else if (classification.classification === 'operation-derived' || container && BRAND_TAGS.has(lower)) {
      replacements.push({ key, action: 'operation-required-transformation', reason: 'Muxer-owned identity or derived counters must describe the new container, not be asserted identical.' });
    } else {
      classifications.push(classification);
      // Metadata keys are arbitrary media data, including __proto__. Define
      // an own property rather than invoking Object.prototype's legacy setter.
      Object.defineProperty(classification.mismatch === 'warning' ? attempted : preserved, key,
        { value: String(value), enumerable: true, configurable: true, writable: true });
      if (lower === 'creation_time') representations.push({ key, equivalence: matroskaTrack ? 'exact-source-text-track-alias' : 'same-UTC-instant-or-exact-source-text',
        ...(matroskaTrack ? { outputKey: STREAM_CREATION_TIME_ALIAS } : {}) });
      if (matroskaTrack && lower === 'language' && value === 'und') representations.push({ key, equivalence: 'undefined-track-language-may-be-omitted-by-ffprobe' });
      if (target === 'mov' && stream && lower === 'language' && value === 'und') representations.push({ key,
        equivalence: 'owned-mov-mdhd-unspecified-language', nativeLanguageCode: 32767,
        evidence: 'Owned output hash, exact native track ID and observed mdhd are required; tag absence alone is insufficient.' });
    }
  }
  if (target !== 'matroska' && stream && ['video', 'audio', 'subtitle'].includes(stream.codec_type)) {
    const nameKey = Object.keys(preserved).find(key => key.toLowerCase() === 'name');
    const titleKey = Object.keys(preserved).find(key => key.toLowerCase() === 'title');
    if (nameKey && titleKey && preserved[nameKey] !== preserved[titleKey]) {
      fail('REMUX_METADATA_AMBIGUOUS', 'Distinct track name and title cannot both occupy the native MOV/MP4 track-name atom.');
    }
    // FFmpeg's MOV writer consumes "title" for udta/name; the MOV demuxer
    // exposes that native track name as "name". Copying a source "name" alone
    // does not invoke the writer. Declare and emit this representation once.
    for (const key of [nameKey, titleKey].filter(Boolean)) representations.push({ key,
      equivalence: 'native-isobmff-track-name', outputKey: 'name', writeKey: 'title' });
  }
  let creationAlias = null;
  if (target === 'matroska' && stream) creationAlias = streamCreationTimeAlias(stream);
  // Source comparisons alone cannot detect a new functional tag. Declare only
  // neutral muxer defaults/aliases and fresh provenance; no unknown-key wildcard
  // or arbitrary-value track default can become an output allowance.
  if (stream) {
    if (!seen.has('language')) allowedAdditions.push({ key: 'language', match: 'exact', value: 'und',
      reason: 'An unspecified track language adds no language selection information.' });
    if (target !== 'matroska' && !seen.has('handler_name') && DEFAULT_HANDLER_NAMES.has(stream.codec_type)) {
      allowedAdditions.push({ key: 'handler_name', match: 'exact', value: DEFAULT_HANDLER_NAMES.get(stream.codec_type),
        reason: 'The native default handler label identifies only this already-bound track type.' });
    }
    for (const representation of representations) {
      if (representation.equivalence === 'native-isobmff-track-name' && !seen.has(representation.outputKey)) {
        allowedAdditions.push({ key: representation.outputKey, match: 'exact', value: Object.getOwnPropertyDescriptor(preserved, representation.key).value,
          reason: 'The declared native track-name alias must equal the exact source label.' });
      }
    }
  } else if (container) {
    allowedAdditions.push({ key: MARKER_KEY, match: 'exact', value: '1', reason: 'Fresh normal application marker; full provenance validation remains mandatory.' },
      { key: OUTPUT_ID_KEY, match: 'fresh-output-id', reason: 'Only the prepared output identity is allowed; full provenance validation remains mandatory.' });
    if (target !== 'matroska') for (const key of BRAND_TAGS) allowedAdditions.push({ key, match: 'operation-derived',
      reason: 'The qualified target muxer describes its new container brands; brands do not grant target qualification.' });
  }
  return { policy: REMUX_METADATA_POLICY, scope, preserved, attempted, classifications, representations, replacements, allowedAdditions, creationAlias };
}

function sourceFamily(probe) {
  const names = String(probe.format.format_name || '').split(',');
  if (names.includes('mpegts')) return 'mpegts';
  if (names.includes('matroska') || names.includes('webm')) return 'matroska';
  if (names.includes('mov')) return 'isobmff';
  if (names.includes('avi')) return 'avi';
  return null;
}

function streamReasons(stream, target) {
  const reasons = [];
  const flags = [];
  for (const [key, value] of Object.entries(stream.disposition || {})) {
    if (![0, 1, '0', '1'].includes(value)) reasons.push(`Malformed disposition ${key}.`);
    else if (Number(value) === 1) flags.push(key);
  }
  flags.sort();
  const attached = flags.includes('attached_pic');
  const codecs = TARGET_CODECS[target][stream.codec_type] || [];
  const coverCandidate = target !== 'matroska' && stream.codec_type === 'video' && attached && ['mjpeg', 'png'].includes(stream.codec_name);
  if (!codecs.includes(stream.codec_name) && !coverCandidate) reasons.push(`No qualified candidate mapping for ${stream.codec_type || 'unknown'} / ${stream.codec_name || 'unknown'} in ${target}.`);
  if (attached && !coverCandidate) reasons.push('This attached-picture representation is not supported by the selected remux path.');
  const allowedFlags = target === 'matroska' ? MKV_FLAGS : MOV_FLAGS;
  if (flags.some(flag => !allowedFlags.includes(flag))) reasons.push('One or more enabled stream dispositions need another target or a specific omission decision.');
  if (target === 'matroska' && flags.includes('original') && flags.includes('dub')) reasons.push('Matroska cannot represent original and dubbed simultaneously.');
  if (flags.includes('descriptions') && stream.codec_type !== 'subtitle') reasons.push('Text-description disposition on a non-subtitle stream is unqualified.');
  if (stream.codec_type === 'attachment' && (!stream.tags?.filename || !stream.tags?.mimetype || flags.length || !/^SHA256:[a-f0-9]{64}$/i.test(stream.extradata_hash || ''))) {
    reasons.push('An attachment needs filename, MIME type and bounded content-hash evidence, with no unrepresentable track flags.');
  }
  if (stream.codec_type === 'data' && (stream.codec_name !== 'tmcd' || stream.codec_tag_string !== 'tmcd')) reasons.push('Timed data needs a specific codec and relationship preservation path; a copied tag is not a timed track.');
  return { reasons, flags };
}

function qualificationRequirement(id, message, streamIndex = null) { return { id, message, streamIndex, status: 'unverified' }; }

function assessRemux(options) {
  record(options, ['request', 'probe', 'sourceFingerprint', 'resolveOmission'], 'Remux assessment', ['request', 'probe', 'sourceFingerprint']);
  const request = validateRemuxRequest(options.request);
  if (typeof options.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.sourceFingerprint)) fail('INVALID_REMUX_REQUEST', 'Source fingerprint must be the current main-owned identity digest.');
  if (options.resolveOmission !== undefined && typeof options.resolveOmission !== 'function') fail('INVALID_REMUX_REQUEST', 'Omission resolver must be a main-owned function.');
  const probe = normalizeProbe(copyEvidence(options.probe));
  const sourceFingerprint = options.sourceFingerprint;
  const blockers = [], decisionsNeeded = [], qualifications = [];
  const addBlocker = (code, message, streamIndex = null) => blockers.push({ code, message, streamIndex });
  const family = sourceFamily(probe);
  if (!family) addBlocker('REMUX_CONTAINER_UNKNOWN', 'The inspected container is outside the bounded local remux input set.');
  const evidence = probe.mediaEvidence;
  const relationships = evidence.container.relationships;
  if (relationships.state !== 'known') addBlocker('REMUX_RELATIONSHIPS_UNKNOWN', 'Stream counts, programs or stream groups are incomplete or contradictory; do not flatten unknown relationships.');
  const groups = evidence.container.streamGroups.value || [];
  if (groups.length) addBlocker('REMUX_STREAM_GROUP_UNQUALIFIED', 'Stream groups or track references require an explicit relationship-preserving implementation; omitting a referenced stream cannot silently dissolve them.');
  const programs = evidence.container.programs.value || [];
  if (programs.length > 1 || programs.length && family !== 'mpegts') addBlocker('REMUX_PROGRAM_UNQUALIFIED', 'Only a fully known single transport program is a remux qualification candidate.');
  if (family === 'mpegts' && (programs.length !== 1 || programs[0]?.state !== 'known'
      || programs[0].streamIndexes.length !== probe.streams.length)) addBlocker('REMUX_PROGRAM_UNKNOWN', 'TS requires one known program containing every admitted elementary stream.');
  if (programs.length && Object.keys(probe.programs?.[0]?.tags || {}).length) {
    addBlocker('REMUX_PROGRAM_METADATA_UNREPRESENTABLE', 'Program/service metadata has no implemented equivalent representation in this target. Retain the source or use a qualified alternative; do not silently discard it.');
  }

  const marker = classifyMarker(probe);
  if (marker.kind === 'suspicious') addBlocker('REMUX_PROVENANCE_AMBIGUOUS', marker.reason);
  const streams = [...probe.streams].sort((a, b) => a.index - b.index);
  const fingerprints = new Map(streams.map(stream => [stream.index, digest(stream)]));
  const omitted = new Map();
  // IDs from the renderer are lookups, never approvals. Main's transient grant
  // resolver must return the complete binding; stale or unrelated grants fail.
  for (const id of request.omissionRequestIds) {
    const decision = options.resolveOmission?.(id);
    if (!decision) { addBlocker('REMUX_OMISSION_UNAUTHORIZED', `Omission request ${id} has no current per-file decision.`); continue; }
    record(decision, ['id', 'fileId', 'identityRevision', 'draftRevision', 'sourceFingerprint', 'target', 'operation', 'streamIndex', 'streamFingerprint', 'action'], 'Main omission decision');
    const matches = decision.id === id && decision.fileId === request.fileId && decision.identityRevision === request.identityRevision
      && decision.draftRevision === request.draftRevision && decision.sourceFingerprint === sourceFingerprint && decision.target === request.target
      && decision.operation === 'remux' && decision.action === 'omit-stream' && Number.isSafeInteger(decision.streamIndex)
      && fingerprints.has(decision.streamIndex) && decision.streamFingerprint === fingerprints.get(decision.streamIndex);
    if (!matches || omitted.has(decision.streamIndex)) { addBlocker('REMUX_OMISSION_STALE', `Omission request ${id} does not match this file, stream, revision and target.`); continue; }
    omitted.set(decision.streamIndex, id);
  }

  const mapped = [];
  for (const stream of streams) {
    if (omitted.has(stream.index)) continue;
    const { reasons, flags } = streamReasons(stream, request.target);
    if (reasons.length) {
      addBlocker('REMUX_STREAM_UNSUPPORTED', reasons.join(' '), stream.index);
      decisionsNeeded.push({ streamIndex: stream.index, streamFingerprint: fingerprints.get(stream.index),
        label: `Stream ${stream.index}: ${stream.codec_type || 'unknown'} / ${stream.codec_name || 'unknown'}`,
        choices: ['choose-qualified-alternate-target', 'explicitly-omit-this-stream'], reasons });
    }
    let metadata = null;
    try {
      metadata = tagContract(stream.tags, { target: request.target, stream });
      if (family === 'matroska' && request.target === 'mp4') {
        // The contract already names native track fields through its neutral
        // defaults (language and the type's handler label). Declare exact source
        // preservation for those same fields, without adding output allowances
        // or changing the builder/validator's existing exact-value comparison.
        const nativeFields = tagContract({}, { target: request.target, stream }).allowedAdditions;
        for (const item of metadata.classifications) if (item.mismatch === 'error'
          && nativeFields.some(field => field.key === item.normalizedKey)
          && (item.normalizedKey === 'language' ? /^[a-z]{3}$/.test(metadata.preserved[item.key])
            : item.normalizedKey === 'handler_name' && metadata.preserved[item.key].length > 0)
          && !metadata.representations.some(rep => rep.key === item.key)) metadata.representations.push({
          key: item.key, equivalence: 'native-isobmff-track-field', outputKey: item.normalizedKey });
      }
    }
    catch (error) { addBlocker(error.code || 'REMUX_METADATA_AMBIGUOUS', error.message, stream.index); }
    const outputIndex = mapped.length;
    mapped.push({ inputIndex: stream.index, outputIndex, streamFingerprint: fingerprints.get(stream.index), codecType: stream.codec_type,
      codecName: stream.codec_name, action: 'preserve-copy', disposition: flags, metadata,
      evidence: evidence.streams.find(item => item.index === stream.index), sideData: structuredClone(stream.side_data_list || []),
      attachment: stream.codec_type === 'attachment' ? { extradataHash: stream.extradata_hash, extradataSize: stream.extradata_size ?? null } : null });
    qualifications.push(qualificationRequirement(`codec:${request.target}:${stream.codec_type}:${stream.codec_name}`, 'Exact runtime codec/container mux, decode and preservation round-trip.', stream.index));
    if (flags.length) qualifications.push(qualificationRequirement(`dispositions:${request.target}:${flags.join('+')}`, 'Every enabled disposition survives without automatic additions.', stream.index));
    if (Object.keys(stream.tags || {}).length) qualifications.push(qualificationRequirement(`track-tags:${stream.index}`, 'Every meaningful track tag or explicitly declared equivalent representation survives.', stream.index));
    if (stream.side_data_list?.length) qualifications.push(qualificationRequirement(`side-data:${stream.index}`, 'Rotation, HDR/Dolby and other side-data require actual semantic and bitstream retention evidence.', stream.index));
  }
  const videos = mapped.filter(stream => stream.codecType === 'video' && !stream.disposition.includes('attached_pic'));
  const defaults = videos.filter(stream => stream.disposition.includes('default'));
  const selected = videos.length === 1 ? videos[0] : defaults.length === 1 ? defaults[0] : null;
  if (!selected) addBlocker(videos.length ? 'REMUX_SELECTED_VIDEO_AMBIGUOUS' : 'REMUX_NO_VIDEO', 'A single primary video must be identifiable; all admitted alternate streams still remain mapped.');
  let globalMetadata = null;
  try { globalMetadata = tagContract(probe.format.tags, { target: request.target, container: true }); }
  catch (error) { addBlocker(error.code || 'REMUX_METADATA_AMBIGUOUS', error.message); }
  const chapters = probe.chapters.map((chapter, index) => {
    try {
      // A missing/invalid boundary cannot serve as an expected-output contract.
      // Decimal seconds are retained alongside exact ticks, never synthesized.
      const base = /^([1-9]\d{0,19})\/([1-9]\d{0,19})$/.exec(String(chapter.time_base || ''));
      const tick = value => /^-?\d{1,20}$/.test(String(value)) ? BigInt(value) : null;
      const start = tick(chapter.start), end = tick(chapter.end);
      if (!base || start === null || end === null || end <= start) fail('REMUX_CHAPTER_TIMELINE_UNKNOWN', `Chapter ${index} needs valid ordered ticks and a positive time base.`);
      return { inputIndex: index, action: 'preserve', timeline: Object.fromEntries(Object.entries(chapter).filter(([key]) => key !== 'tags')), metadata: tagContract(chapter.tags, { target: request.target }) };
    }
    catch (error) { addBlocker(error.code || 'REMUX_METADATA_AMBIGUOUS', error.message); return null; }
  });
  const bitstream = mapped.filter(stream => family === 'mpegts' && stream.codecName === 'aac')
    .map(stream => ({ outputIndex: stream.outputIndex, inputIndex: stream.inputIndex, filter: 'aac_adtstoasc',
      action: 'equivalent-representation', reason: 'Remove ADTS transport framing and retain AAC access-unit content; qualify packet/sample identity and decoder configuration.' }));
  qualifications.push(
    qualificationRequirement('media-content-and-timeline', 'Validate all copied streams, relative A/V offsets, full duration, frame/packet content and permissible time-base rounding.'),
    qualificationRequirement('chapters-and-container-tags', 'Preserve chapter boundaries, functional and unassessed metadata; attempt descriptive tags and report differences as warnings.'),
    qualificationRequirement(`provenance:${request.target}`, 'Fresh marker/output ID must round-trip and be recognized on a subsequent same-folder scan.'),
    qualificationRequirement('publication-and-lifecycle', 'Validate output before no-overwrite publication; preserve source, cancellation, retained-output and cleanup guarantees.'),
  );
  if (family === 'mpegts') qualifications.push(qualificationRequirement('transport-timestamps-and-framing', 'Inspect discontinuity/wrap/missing timestamps and prove the supported transport framing conversion; metadata alone cannot qualify TS.'));
  if (request.target !== 'matroska') qualifications.push(qualificationRequirement('mov-family-metadata-mode', 'Qualify use_metadata_tags, disabled automatic timecode-track creation, chapters, track flags and exact codec brands/tags; simple MP4 evidence does not qualify MOV.'));
  if (chapters.length && request.target !== 'matroska') qualifications.push(qualificationRequirement('mov-chapter-carrier', 'Establish the exact muxer-generated chapter carrier, if any. It must be named in the qualified expected output; arbitrary extra data tracks are not acceptable.'));
  const result = freeze({ version: REMUX_CONTRACT_VERSION, operation: 'remux', request, sourceFingerprint, sourceEvidenceFingerprint: digest(probe),
    inputFamily: family, target: request.target, status: blockers.length ? 'blocked' : 'qualification-required', executionReady: false,
    sourceAdmission: { required: marker.kind === 'generated' ? 'main-bound-generated-source-authorization' : 'normal-main-source-admission', marker },
    blockers, decisionsNeeded, qualifications,
    expectedOutput: { version: REMUX_CONTRACT_VERSION, operation: 'remux', target: request.target, full: true,
      selectedVideoInputIndex: selected?.inputIndex ?? null, streams: mapped,
      omittedStreams: streams.filter(stream => omitted.has(stream.index)).map(stream => ({ inputIndex: stream.index,
        streamFingerprint: fingerprints.get(stream.index), action: 'explicitly-omitted', decisionId: omitted.get(stream.index), codecType: stream.codec_type, codecName: stream.codec_name })),
      chapters, metadata: globalMetadata, metadataPolicy: REMUX_METADATA_POLICY, bitstream,
      auxiliaryStreams: { policy: 'no-unexpected-streams', chapterCarrierQualificationRequired: chapters.length > 0 && request.target !== 'matroska',
        qualifiedCarriers: null, automaticTimecodeTrack: false },
      timeline: { policy: 'copy-input-timestamps-no-independent-stream-rebase', trim: false, frameRateConversion: false,
        validation: 'relative-offsets-content-and-full-interval; qualified-time-base-rounding-only', source: evidence.container },
      relationships: { sourcePrograms: structuredClone(probe.programs || []), sourceStreamGroups: structuredClone(probe.stream_groups || []),
        target: 'flat-explicit-stream-map', disposition: programs.length ? 'operation-required-transformation' : 'no-reported-relationships',
        limitation: 'Transport PID/program structure is not claimed identical to MP4/MOV/Matroska track structure.' },
      provenance: { markerVersion: 1, freshOutputIdRequired: true, descriptiveGeneration: 'absent-until-remux-description-schema', roundTrip: 'required-before-target-enablement' },
      contentClaim: 'Copied coded media and validated semantic representation, never identical whole-container bytes.',
    },
    notices: ['This is a qualification plan, not runtime support or prepared execution authority.',
      'No encoder, scaling, color conversion, audio conversion or range operation is introduced.',
      'Metadata-only evidence cannot prove all packet relationships or dynamic HDR payloads.'],
  });
  assessments.set(result, { probe });
  return result;
}

function localPath(value, role) {
  if (typeof value !== 'string' || value.length > 32768 || !value || /[\0\r\n]/.test(value)
      || (!path.win32.isAbsolute(value) && !path.posix.isAbsolute(value))
      || /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) fail('INVALID_REMUX_PATH', `${role} must be an absolute local filesystem path resolved by main.`);
}

// Native qualification uses exactly this contribution; execution may reuse it
// only after main supplies runtime-qualified PreparedPlan ownership. Serialized
// UI copies and hand-edited assessments are intentionally not accepted here.
function buildRemuxQualificationArgs(options) {
  record(options, ['assessment', 'input', 'output', 'outputId'], 'Remux argument request');
  const { assessment, input, output, outputId } = options;
  const privateState = assessments.get(assessment);
  if (!privateState || assessment.status !== 'qualification-required') fail('REMUX_NOT_PLANNABLE', 'A genuine unblocked main assessment is required.');
  localPath(input, 'Input'); localPath(output, 'Output');
  if (path.win32.normalize(input).toLowerCase() === path.win32.normalize(output).toLowerCase()) fail('INVALID_REMUX_PATH', 'Source and output must be different files.');
  const markerArgs = provenanceArgs(outputId);
  if (assessment.sourceAdmission.marker.outputId === String(outputId).toLowerCase()) fail('INVALID_REMUX_PROVENANCE', 'A remux needs a new output identity.');
  const { probe } = privateState;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-n',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts', '-copyts', '-i', input];
  for (const stream of assessment.expectedOutput.streams) args.push('-map', `0:${stream.inputIndex}`);
  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy');
  for (const stream of assessment.expectedOutput.streams) {
    args.push(`-map_metadata:s:${stream.outputIndex}`, `0:s:${stream.inputIndex}`, `-disposition:${stream.outputIndex}`, stream.disposition.join('+') || '0');
    if (stream.metadata.creationAlias !== null) args.push(`-metadata:s:${stream.outputIndex}`, `${STREAM_CREATION_TIME_ALIAS}=${stream.metadata.creationAlias}`);
    const writes = new Map(stream.metadata.representations.filter(item => item.writeKey)
      .map(item => [item.writeKey, stream.metadata.preserved[item.key]]));
    for (const [key, value] of writes) args.push(`-metadata:s:${stream.outputIndex}`, `${key}=${value}`);
  }
  for (const change of assessment.expectedOutput.bitstream) args.push(`-bsf:${change.outputIndex}`, change.filter);
  // A copied old encode description must not be advertised as a new remux's
  // configuration. Clear original casing too, then write the existing v1 marker.
  for (const key of Object.keys(probe.format.tags || {})) if (APPLICATION_TAGS.includes(key.toUpperCase())) args.push('-metadata', `${key}=`);
  args.push(...markerArgs, '-avoid_negative_ts', 'disabled');
  if (assessment.target === 'matroska') args.push('-default_mode', 'passthrough');
  else args.push('-movflags', 'use_metadata_tags', '-write_tmcd', '0');
  args.push('-f', assessment.target, output);
  return args;
}

// Trusted validator access only. Serialized UI assessments cannot recover the
// original evidence or manufacture a prepared validation plan.
function getRemuxAssessmentSource(assessment) {
  const state = assessments.get(assessment);
  if (!state || assessment.status !== 'qualification-required') fail('REMUX_NOT_PLANNABLE', 'A genuine unblocked main assessment is required.');
  return freeze(structuredClone(state.probe));
}

module.exports = { REMUX_CONTRACT_VERSION, REMUX_TARGETS: TARGETS, validateRemuxRequest, assessRemux, buildRemuxQualificationArgs, getRemuxAssessmentSource };
