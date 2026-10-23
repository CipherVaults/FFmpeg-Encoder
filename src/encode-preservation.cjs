'use strict';

// Main-only Full Encode preservation authority. An explicit functional loss is
// distinct from the unchanged Full path and from range/decoded-evidence routes.
const { createHash } = require('node:crypto');
const { sameIdentity } = require('./source-identity.cjs');
const selections = new WeakMap();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const SOURCE_CLASS = 'mov-av1-main8-1080p60-bt709-aac48-stereo-linked-tmcd-v1';
const MODE = 'full-preservation-selection';
const WARNING = freeze({ code: 'TIMED_TIMECODE_TRACK_OMITTED',
  message: 'The named timed timecode track and its linked editing/synchronization relationship are omitted from this output by your per-file choice. The original is preserved. Any copied starting-timecode text is not equivalent to the timed track.' });
const normalized = probe => require('./inspection.cjs').normalizeProbe(probe);
const fingerprintEncodePreservationProbe = probe => hash(normalized(probe));
const fingerprintEncodePreservationIdentity = identity => hash(identity);
const fingerprintEncodePreservationSettings = settings => hash(settings);
const ordinary = request => request?.operation === 'encode' && request.target === 'matroska' && request.range === null
  && request.resolution === 'source' && request.audioPolicy === 'copy' && ['preserve', 'sdr'].includes(request.hdrPolicy)
  && Array.isArray(request.omissionRequestIds) && request.omissionRequestIds.length === 0;
const supportedSettings = settings => settings?.profileId === 'h265-cpu' && settings.preset === 'slow'
  && settings.quality === 25 && !settings.recipeId;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function exact(value, keys) {
  return plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property?.enumerable && Object.hasOwn(property, 'value');
  });
}
function canonicalRequest(request, settings) {
  const keys = ['version', 'fileId', 'identityRevision', 'draftRevision', 'operation', 'appDefaultsRevision', 'target',
    'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps', 'origins', 'omissionRequestIds', 'omissionAuthority'];
  const originKeys = ['target', 'resolution', 'hdrPolicy', 'range', 'audioPolicy', 'aacBitrateKbps'];
  if (!exact(request, keys) || request.version !== 1 || !uuid(request.fileId)
      || ['identityRevision', 'draftRevision', 'appDefaultsRevision'].some(key => !Number.isSafeInteger(request[key]) || request[key] < 0)
      || !ordinary(request) || request.aacBitrateKbps !== null || request.omissionAuthority !== 'unbound-request-ids'
      || !exact(request.origins, originKeys) || Object.values(request.origins).some(value => !['factory', 'app', 'batch', 'file', 'not-applicable'].includes(value))
      || !supportedSettings(settings)) fail('ENCODE_PRESERVATION_SETTINGS', 'A complete canonical Full source/settings request is required.');
  const validated = require('./media.cjs').validateSettings(settings);
  if (hash(validated) !== hash(settings)) fail('ENCODE_PRESERVATION_SETTINGS', 'Only canonical validated encoder settings are accepted.');
}

function describeEncodePreservationSource(rawProbe) {
  const probe = normalized(rawProbe), evidence = probe.mediaEvidence;
  if (!probe.format.format_name?.split(',').includes('mov') || probe.streams.length !== 3 || probe.chapters.length
      || evidence.container.relationships.state !== 'known' || probe.programs.length || probe.stream_groups.length !== 1) return null;
  const video = probe.streams.find(stream => stream.codec_type === 'video' && Number(stream.disposition?.attached_pic || 0) !== 1);
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const timed = probe.streams.find(stream => stream.codec_type === 'data');
  if (!video || !audio || !timed || probe.streams.some(stream => ![video, audio, timed].includes(stream))) return null;
  if (video.codec_name !== 'av1' || video.profile !== 'Main' || video.pix_fmt !== 'yuv420p'
      || video.width !== 1920 || video.height !== 1080 || video.coded_width !== 1920 || video.coded_height !== 1080
      || !['1:1', '1/1'].includes(video.sample_aspect_ratio) || video.field_order !== 'progressive'
      || video.r_frame_rate !== '60/1' || video.avg_frame_rate !== '60/1'
      || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709' || video.color_space !== 'bt709' || video.color_range !== 'tv'
      || (video.side_data_list || []).length) return null;
  const geometry = evidence.streams.find(stream => stream.index === video.index).geometry;
  if (geometry.issues?.length || Object.values(geometry).some(value => value?.state === 'malformed')
      || geometry.rotationSource === 'display-matrix'
      || Object.hasOwn(video.tags || {}, 'rotate') && (geometry.legacyRotationDegrees.state !== 'known' || geometry.legacyRotationDegrees.value.numerator !== '0')) return null;
  const audioEvidence = evidence.streams.find(stream => stream.index === audio.index).audio;
  if (audio.codec_name !== 'aac' || audio.profile !== 'LC' || audioEvidence.sampleRate.state !== 'known' || audioEvidence.sampleRate.value !== '48000'
      || audioEvidence.channels.state !== 'known' || audioEvidence.channels.value !== '2' || audio.channel_layout !== 'stereo' || (audio.side_data_list || []).length) return null;
  if (timed.codec_tag_string !== 'tmcd' || Object.hasOwn(timed, 'codec_name') && timed.codec_name !== 'tmcd'
      || (timed.side_data_list || []).length) return null;
  if (evidence.streams.some(stream => [stream.timeline, stream.audio].some(section => Object.values(section).some(value => value?.state === 'malformed')))) return null;
  const group = probe.stream_groups[0], typed = evidence.container.streamGroups.value?.[0];
  if (!typed || typed.fields.type.state !== 'known' || typed.fields.type.value !== 'Track Reference'
      || typed.streamIndexes.length !== 2 || !typed.streamIndexes.includes(video.index) || !typed.streamIndexes.includes(timed.index)
      || Object.hasOwn(group, 'components') && (!Array.isArray(group.components) || group.components.length)
      || Object.hasOwn(group, 'tags') && (!group.tags || typeof group.tags !== 'object' || Array.isArray(group.tags) || Object.keys(group.tags).length)
      || Object.hasOwn(group, 'disposition') && (!plain(group.disposition)
        || Object.values(group.disposition).some(value => ![0, '0'].includes(value)))) return null;
  const timecode = stream => Object.entries(stream.tags || {}).filter(([key]) => key.toLowerCase() === 'timecode').map(([, value]) => String(value));
  const videoTime = timecode(video), timedTime = timecode(timed);
  if (videoTime.length !== 1 || timedTime.length !== 1 || videoTime[0] !== timedTime[0]
      || !/^\d{2}:\d{2}:\d{2}[:;]\d{2}$/.test(videoTime[0])) return null;
  return freeze({ sourceClass: SOURCE_CLASS, videoIndex: video.index, audioIndex: audio.index, streamIndex: timed.index,
    streamFingerprint: hash(timed), relationshipFingerprint: hash(group), probeFingerprint: hash(probe),
    relationshipIndex: group.index, label: `Stream ${timed.index}: timed timecode (tmcd) and its linked video relationship`,
    warning: WARNING });
}

function getEncodePreservationSelection(selection, probe, context = {}) {
  const state = selections.get(selection);
  if (!state) fail('ENCODE_PRESERVATION_UNBOUND', 'Only a genuine main-owned preservation selection may omit a stream.');
  state.requireCurrent();
  if (fingerprintEncodePreservationProbe(probe) !== state.probeFingerprint) fail('ENCODE_PRESERVATION_STALE', 'The original stream or relationship evidence changed. Prepare again.');
  if (context.settings !== undefined && hash(context.settings) !== state.expected.settingsFingerprint
      || context.input !== undefined && context.input !== state.identity.canonicalPath) fail('ENCODE_PRESERVATION_STALE', 'The selected source path or encoder settings changed.');
  return state.description;
}

function assertEncodePreservationBuilder(selection, { probe, input, settings, request, runtimeIdentity }) {
  const description = getEncodePreservationSelection(selection, probe, { input, settings }), state = selections.get(selection);
  canonicalRequest(request, settings);
  if (runtimeIdentity !== state.expected.runtimeIdentity || !ordinary(request)
      || request.fileId !== state.expected.fileId || request.identityRevision !== state.expected.identityRevision
      || request.draftRevision !== state.expected.draftRevision || hash(request) !== state.requestFingerprint) fail('ENCODE_PRESERVATION_STALE', 'The canonical builder context differs from the acknowledged source/runtime/draft.');
  return description;
}

class EncodePreservationOperations {
  #runtime; #policies; #policyIdentity; #epoch = 0; #latest = new Map();
  constructor({ runtimeIdentity, policies = [], policyIdentity }) {
    if (typeof runtimeIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(runtimeIdentity)
        || typeof policyIdentity !== 'string' || policyIdentity.length > 256 || !Array.isArray(policies) || policies.length > 1) throw new TypeError('Invalid Full preservation policy.');
    this.#runtime = runtimeIdentity; this.#policyIdentity = policyIdentity;
    this.#policies = policies.map(policy => {
      if (policy.sourceClass !== SOURCE_CLASS || policy.runtimeIdentity !== runtimeIdentity || typeof policy.id !== 'string'
          || !/^[A-Za-z0-9._:+-]{1,256}$/.test(policy.id) || !Array.isArray(policy.evidenceIds) || !policy.evidenceIds.length
          || policy.evidenceIds.length > 16 || policy.evidenceIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(id))) {
        throw new TypeError('Unsupported or unbound Full preservation policy.');
      }
      return freeze(structuredClone(policy));
    });
  }
  invalidate() { this.#epoch++; this.#latest.clear(); }
  describe({ probe, request, settings }) {
    const source = describeEncodePreservationSource(probe);
    if (!source) return null;
    return { ...structuredClone(source), applicable: ordinary(request) && supportedSettings(settings),
      notice: 'This explicit route requires Full, Keep Source, SDR preservation, Matroska, copied audio and H265 CPU / slow / CRF25 with no recipe. No settings are changed automatically.' };
  }
  prepare({ probe, sourceIdentity, request, settings, planId, draftId, decisionIds, resolveDecision }) {
    canonicalRequest(request, settings);
    if (!uuid(planId) || !uuid(draftId)) fail('ENCODE_PRESERVATION_STALE', 'The current plan and draft identifiers are required.');
    const source = describeEncodePreservationSource(probe);
    if (!source || !sameIdentity(sourceIdentity, sourceIdentity)) fail('ENCODE_PRESERVATION_SOURCE', 'Complete current source, stream and timecode-relationship evidence is required.');
    if (!Array.isArray(decisionIds) || decisionIds.length !== 1 || !uuid(decisionIds[0]) || typeof resolveDecision !== 'function') fail('ENCODE_PRESERVATION_DECISION_REQUIRED', 'Explicitly choose whether to omit this named timed timecode track and its relationship.');
    const decision = resolveDecision(decisionIds[0]);
    const expected = { id: decisionIds[0], planId, draftId, fileId: request.fileId, identityRevision: request.identityRevision,
      draftRevision: request.draftRevision, operation: 'encode', target: 'matroska', action: 'omit-timed-timecode',
      runtimeIdentity: this.#runtime, settingsFingerprint: hash(settings), sourceFingerprint: hash(sourceIdentity),
      probeFingerprint: source.probeFingerprint, streamIndex: source.streamIndex,
      streamFingerprint: source.streamFingerprint, relationshipFingerprint: source.relationshipFingerprint };
    if (!exact(decision, Object.keys(expected)) || Object.entries(expected).some(([key, value]) => decision[key] !== value)) fail('ENCODE_PRESERVATION_STALE', 'The decision does not belong to this exact source, track, relationship, settings and draft. Review again.');
    const policy = this.#policies.find(policy => policy.sourceClass === source.sourceClass);
    if (!policy) fail('ENCODE_PRESERVATION_QUALIFICATION_REQUIRED', 'The explicit Full timecode-omission route has not been qualified for the current runtime. No encode plan was admitted.');
    const epoch = this.#epoch, token = Object.freeze({}), identity = structuredClone(sourceIdentity);
    const description = freeze({ mode: MODE, sourceClass: source.sourceClass, videoIndex: source.videoIndex,
      retainedIndexes: [source.videoIndex, source.audioIndex], omittedStreams: [{ inputIndex: source.streamIndex, codecType: 'data', codecTag: 'tmcd' }],
      removedRelationships: [{ inputIndex: source.relationshipIndex, type: 'Track Reference' }],
      decisionIds: [...decisionIds], warning: WARNING });
    const requireCurrent = () => {
      if (this.#epoch !== epoch || this.#latest.get(expected.fileId) !== token) fail('ENCODE_PRESERVATION_STALE', 'The preservation selection expired. Prepare again.');
    };
    selections.set(token, { owner: this, expected: freeze(expected), identity, probeFingerprint: source.probeFingerprint,
      description, requireCurrent, policy, requestFingerprint: hash(request) });
    this.#latest.set(request.fileId, token);
    return token;
  }
  requireCurrent(selection, { probe, sourceIdentity, request, settings, planId, draftId, runtimeIdentity }) {
    try { canonicalRequest(request, settings); }
    catch { fail('ENCODE_PRESERVATION_STALE', 'The current canonical source/settings request changed. Prepare again.'); }
    const state = selections.get(selection);
    if (!state || state.owner !== this) fail('ENCODE_PRESERVATION_UNBOUND', 'The selection belongs to another owner.');
    state.requireCurrent();
    const expected = state.expected;
    if (runtimeIdentity !== this.#runtime || planId !== expected.planId || draftId !== expected.draftId
        || request.fileId !== expected.fileId || request.identityRevision !== expected.identityRevision || request.draftRevision !== expected.draftRevision
        || hash(request) !== state.requestFingerprint || hash(settings) !== expected.settingsFingerprint || !sameIdentity(sourceIdentity, state.identity)
        || fingerprintEncodePreservationProbe(probe) !== state.probeFingerprint) fail('ENCODE_PRESERVATION_STALE', 'Current source, runtime, settings and prepared draft must match the acknowledged preservation decision.');
    return freeze({ evidenceIds: [...state.policy.evidenceIds], policyIdentity: this.#policyIdentity,
      validationMode: MODE, decodedEvidenceRequired: false, warning: WARNING });
  }
}

module.exports = { EncodePreservationOperations, SOURCE_CLASS, MODE, WARNING, describeEncodePreservationSource,
  getEncodePreservationSelection, assertEncodePreservationBuilder, fingerprintEncodePreservationProbe, fingerprintEncodePreservationIdentity,
  fingerprintEncodePreservationSettings };
