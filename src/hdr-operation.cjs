'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { describeRecipe, classifyColor, selectVideo, streamCreationTimeAlias, STREAM_CREATION_TIME_ALIAS } = require('./media.cjs');
const { buildOperationContract } = require('./operation-contract.cjs');
const { buildHdrEncoding, validateHdrEncodingOutput } = require('./hdr-encoding.cjs');
const { provenanceArgs, generationDescriptionOf, classifyMarker } = require('./provenance.cjs');
const { FORMATS, assertTelemetryBinding, assertCollectedTelemetry } = require('./operation-telemetry.cjs');
const { getObservedHdrInput } = require('./hdr-input.cjs');
const { HDR_TRANSFORM_VERSION } = require('./hdr-contract.cjs');

// This is an operation owner, not a relaxation of SDR inspection or its plan
// brand. Every selection is in-process, revision-bound and backed by a reviewed
// catalog. A successful writer contribution alone cannot publish anything.
const INVALID = 'INVALID_HDR_OPERATION', REQUIRED = 'HDR_QUALIFICATION_REQUIRED', STALE = 'HDR_OPERATION_STALE';
const PLAN_REQUIRED = 'HDR_OPERATION_PLAN_REQUIRED';
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9._:+-]{1,256}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8 * 1024 * 1024,
  maxPcmBytes: 128 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const EXECUTION_MS = 600000;
const SOURCE_FIELDS = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
const BINDINGS = ['plan', 'settings', 'sourceIdentity', 'sourceProbeFingerprint', 'runtimeIdentity', 'environment', 'budget', 'executionBudgetMs'];
const STREAMS = Object.freeze([Object.freeze({ outputIndex: 0, kind: 'video' })]);
const PLACEHOLDER = '<main-owned HDR telemetry stream 0 assigned at start>';
const MASTER = Object.freeze({ red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
  blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const SIDE = new Set(['Mastering display metadata', 'Content light level metadata', 'H.26[45] User Data Unregistered SEI message']);
const GENERATED = new Set(['encoder', 'duration', 'number_of_frames', 'number_of_bytes']);
const MARKERS = new Set(['ffmpeg_encoder_provenance', 'ffmpeg_encoder_output_id', 'ffmpeg_encoder_generation']);
const own = (v, k) => Object.hasOwn(v, k);
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const registry = new WeakMap();
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = (message, code = INVALID) => { throw new ToolError(code, message); };
const need = (v, message, code) => { if (!v) fail(message, code); };
function freeze(v) { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function record(v, fields, required = fields, label = 'HDR operation record') {
  need(plain(v) && required.every(k => own(v, k)), `${label} is incomplete.`);
  for (const key of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, key);
    need(typeof key === 'string' && fields.includes(key) && d.enumerable && own(d, 'value'), `${label} contains an unsupported field.`); }
}
function snapshot(v) {
  const seen = new Set(); let count = 0, characters = 0;
  function copy(x, depth) {
    need(++count <= 65536 && depth <= 16, 'HDR data exceeds its structural bound.');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') { need(Number.isFinite(x), 'HDR numbers must be finite.'); return x; }
    if (typeof x === 'string') { characters += x.length; need(x.length <= 524288 && characters <= 2 * 1024 * 1024 && !x.includes('\0'), 'HDR text exceeds its bound.'); return x; }
    need(plain(x) || Array.isArray(x), 'Only inert HDR data is accepted.');
    need(!seen.has(x), 'Cyclic HDR data is invalid.'); seen.add(x);
    const result = Array.isArray(x) ? [] : {};
    for (const k of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k);
      need(typeof k === 'string' && k !== '__proto__' && d.enumerable && own(d, 'value')
        && (!Array.isArray(x) || /^(0|[1-9]\d*)$/.test(k) && Number(k) < x.length), 'HDR data contains an accessor, hidden or extra field.');
      Object.defineProperty(result, k, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    need(!Array.isArray(x) || result.length === x.length && Object.keys(result).length === x.length, 'HDR arrays must be dense.');
    seen.delete(x); return result;
  }
  return copy(v, 0);
}
function local(v) {
  need(typeof v === 'string' && v.length > 0 && v.length <= 32767 && !/[\x00-\x1f\x7f]/.test(v)
    && (path.win32.isAbsolute(v) || path.posix.isAbsolute(v))
    && (!/^[a-z][a-z0-9+.-]*:/i.test(v) || /^[a-z]:[\\/]/i.test(v)), 'A main-resolved absolute local path is required.'); return v;
}
const samePath = (a, b) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
function digest(v, label) { need(typeof v === 'string' && HASH.test(v), `${label} needs a SHA256 identity.`); return v; }
function id(v, label) { need(typeof v === 'string' && ID.test(v), `${label} needs a bounded identity.`); return v; }
function sourceIdentity(v) {
  need(plain(v) && SOURCE_FIELDS.every(k => own(v, k)) && Reflect.ownKeys(v).length <= 32, 'Complete bounded source identity is required.');
  snapshot(v); const result = { canonicalPath: local(v.canonicalPath) };
  for (const k of SOURCE_FIELDS.slice(1, -1)) { need(typeof v[k] === 'string' && /^(0|-?[1-9]\d{0,19})$/.test(v[k]), 'Source identity needs exact integers.');
    const n = BigInt(v[k]); need(n >= (['dev', 'ino', 'size'].includes(k) ? 1n : -9223372036854775808n) && n <= 18446744073709551615n, 'Source identity integer exceeds its bound.'); result[k] = v[k]; }
  need(BigInt(result.size) <= 16n * 1024n * 1024n, 'HDR source exceeds the reviewed16MiB envelope.', REQUIRED);
  need(typeof v.sparseDigest === 'string' && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(v.sparseDigest), 'A complete bounded source digest is required.');
  result.sparseDigest = v.sparseDigest; return freeze(result);
}
function fingerprintHdrProbe(probe) { return hash(normalizeProbe(snapshot(probe))); }
function policy(v) {
  const content = own(v, 'profiles'), hdrPolicy = v.hdrPolicy ?? 'preserve';
  need(['preserve', 'sdr'].includes(hdrPolicy), 'Only an explicit preserve or SDR policy is supported.');
  const fields = content ? ['id', 'transfer', 'evidenceIds', 'runtimeIdentity', 'profiles', 'outputProfiles']
    : ['id', 'transfer', 'evidenceIds', 'runtimeIdentity', 'sourceSha256'];
  const extra = hdrPolicy === 'sdr' ? ['hdrPolicy', 'transformVersion'] : ['hdrPolicy'];
  record(v, [...fields, ...extra], [...fields, ...(hdrPolicy === 'sdr' ? extra : [])]);
  // A conversion cell is independent of preservation. Its input still uses the
  // genuine complete HDR observer; its output has separate reviewed BT.709 PS.
  if (hdrPolicy === 'sdr') {
    need(content && v.transformVersion === HDR_TRANSFORM_VERSION,
      'SDR conversion requires complete input profiles and the exact versioned software transform.');
    const rate = v.transfer === 'smpte2084' ? '30/1' : '25/1';
    need(Array.isArray(v.profiles) && v.profiles.length === 1
      && v.profiles.every(p => p.width === 1280 && p.height === 720 && p.frameRate === rate
        && p.transfer === v.transfer && p.sampleAspectRatio === '1:1'),
      'The first SDR conversion cells cover PQ720p30 and HLG720p25 only.');
    need(Array.isArray(v.outputProfiles) && v.outputProfiles.length === 1
      && v.outputProfiles.every(p => p.width === 1280 && p.height === 720 && p.frameRate === rate
        && p.transfer === 'bt709' && p.primaries === 'bt709' && p.matrix === 'bt709'
        && p.sampleAspectRatio === '1:1' && p.outputMode === 'sdr-bt709-main10'),
      'SDR conversion requires its explicitly declared finite BT.709 Main10 output profile.');
  }
  need(['smpte2084', 'arib-std-b67'].includes(v.transfer) && Array.isArray(v.evidenceIds) && v.evidenceIds.length >= 1 && v.evidenceIds.length <= 32, 'Only the two reviewed tiny HDR signal cells are available.');
  const evidenceIds = snapshot(v.evidenceIds).map(x => id(x, 'Retained evidence')); need(new Set(evidenceIds).size === evidenceIds.length, 'HDR evidence identities must be unique.');
  if (content) need(Array.isArray(v.profiles) && v.profiles.length > 0 && v.profiles.length <= 16
    && Array.isArray(v.outputProfiles) && v.outputProfiles.length > 0 && v.outputProfiles.length <= 16,
  'Content-derived HDR qualification requires reviewed source and output configurations.');
  return freeze({ id: id(v.id, 'HDR cell'), transfer: v.transfer, hdrPolicy,
    ...(hdrPolicy === 'sdr' ? { transformVersion: v.transformVersion } : {}),
    evidenceIds, runtimeIdentity: digest(v.runtimeIdentity, 'Paired runtime'),
    ...(content ? { profiles: snapshot(v.profiles), outputProfiles: snapshot(v.outputProfiles) }
      : { sourceSha256: digest(v.sourceSha256, 'Reviewed full source bytes') }) });
}
function dispositions(video) {
  const result = snapshot(video.disposition || {});
  for (const [key, value] of Object.entries(result)) need(/^[a-z_]{1,64}$/.test(key) && (value === 0 || value === '0'), 'This tiny family requires the retained all-zero disposition shape.', REQUIRED);
  return [];
}
function absentGeometry(video, content = false) {
  if (content && own(video, 'sample_aspect_ratio')) {
    need(video.sample_aspect_ratio === '1:1', 'This content family requires square SAR or the reviewed absent-SAR legacy configuration.', REQUIRED);
    if (own(video, 'display_aspect_ratio')) { const g = (a,b) => b ? g(b,a%b) : a, d = g(video.width,video.height);
      need(video.display_aspect_ratio === `${video.width/d}:${video.height/d}`, 'Display aspect ratio contradicts the reviewed square geometry.', REQUIRED); }
  } else need(!own(video, 'sample_aspect_ratio') && !own(video, 'display_aspect_ratio'), 'This finite family preserves genuinely unreported SAR/DAR only.', REQUIRED);
  const tags = tagsOf(video.tags || {});
  need(!['rotate', 'rotation', 'orientation'].some(k => tags.has(k)), 'Reported rotation requires a separately qualified HDR route.', REQUIRED);
  need(!own(video, 'side_data_list') || video.side_data_list.every(e => SIDE.has(e.side_data_type)), 'Unqualified functional stream side data cannot be omitted.', REQUIRED);
}
function probeFacts(raw, { output = false, content = false, hdrPolicy = 'preserve' } = {}) {
  const probe = normalizeProbe(snapshot(raw)), video = selectVideo(probe);
  need(probe.streams.length === 1 && video.index === 0 && probe.format.format_name === 'matroska,webm'
    && probe.chapters.length === 0 && Array.isArray(probe.programs) && probe.programs.length === 0
    && Array.isArray(probe.stream_groups) && probe.stream_groups.length === 0
    && probe.mediaEvidence.container.relationships.state === 'known', 'HDR requires exactly one video and complete empty native relationships.', REQUIRED);
  const sdrOutput = output && hdrPolicy === 'sdr';
  need(video.codec_name === 'hevc' && video.profile === 'Main 10' && (content
    ? [[1280,720],[1920,1080],[320,180]].some(([w,h]) => video.width === w && video.height === h)
    : video.width === 320 && video.height === 180)
    && video.pix_fmt === 'yuv420p10le' && video.field_order === 'progressive' && video.chroma_location === 'left'
    && video.color_primaries === (sdrOutput ? 'bt709' : 'bt2020') && video.color_space === (sdrOutput ? 'bt709' : 'bt2020nc') && video.color_range === 'tv'
    && (sdrOutput ? video.color_transfer === 'bt709' : ['smpte2084', 'arib-std-b67'].includes(video.color_transfer)),
  'The native source/output signal differs from its explicitly selected finite HDR route.', REQUIRED);
  if (!content) {
  need(video.time_base === '1/1000' && video.avg_frame_rate === '30/1' && video.r_frame_rate === '30/1'
    && String(video.start_pts) === '0' && Number(video.start_time) === 0
    && Number(probe.format.duration) === 3.2 && Number(probe.format.start_time) === 0,
  'The finite HDR family requires its exact zero-origin3.2second30fps/1ms clock.', REQUIRED);
  need(!own(video, 'duration_ts') || String(video.duration_ts) === '3200', 'Reported video duration disagrees with the frozen source extent.', REQUIRED);
  need(!own(video, 'duration') || Number(video.duration) === 3.2, 'Reported video duration disagrees with the frozen source extent.', REQUIRED);
  need(!own(video, 'nb_frames') || String(video.nb_frames) === '96', 'Reported frame count disagrees with the frozen source membership.', REQUIRED);
  need(output || !own(probe.format, 'size') || /^\d+$/.test(String(probe.format.size)) && BigInt(probe.format.size) <= 1024n * 1024n, 'Observed HDR source size exceeds the tiny envelope.', REQUIRED);
  if (!output) need(video.coded_width === 320 && video.coded_height === 192
    && (!own(video, 'side_data_list') || video.side_data_list.length === 0),
  'The reviewed source has exact coded320x192 geometry and frame-only static HDR metadata origins.', REQUIRED);
  } else {
    need(video.time_base === '1/1000' && ['24/1','25/1','30/1'].includes(video.avg_frame_rate) && video.r_frame_rate === video.avg_frame_rate
      && String(video.start_pts) === '0' && Number(video.start_time) === 0 && Number(probe.format.start_time) === 0
      && Number(probe.format.duration) > 0 && Number(probe.format.duration) <= 60,
    'Content-derived HDR requires its reviewed zero-origin integer-rate native clock.', REQUIRED);
    need(output || !own(probe.format, 'size') || /^\d+$/.test(String(probe.format.size)) && BigInt(probe.format.size) <= 16n*1024n*1024n,
      'Observed source exceeds the16MiB content envelope.', REQUIRED);
  }
  absentGeometry(video, content); dispositions(video); return { probe, video };
}
function metadataSignature(writer, content = false) {
  const metadata = writer.expectedOutput.metadata;
  if (content) { need(metadata.ambient === null && writer.contract.source.metadata.dolby === null,
    'Ambient/Dolby content has no preservation qualification.', REQUIRED);
    need(!(metadata.contentLight?.max_content.signalValue === 0 && metadata.contentLight?.max_average.signalValue === 0),
      'The pinned x265 writer does not emit an explicitly observed zero/zero content-light SEI. This signal needs a separately qualified writer.',
      'HDR_ZERO_CLL_WRITER_UNQUALIFIED'); return; }
  need(metadata.ambient === null && writer.contract.source.metadata.dolby === null && metadata.mastering && metadata.contentLight,
    'This family requires the measured static mastering/CLL and no ambient/Dolby metadata.', REQUIRED);
  for (const [key, value] of Object.entries(MASTER)) { const [n, d] = value.split('/').map(BigInt), actual = metadata.mastering[key];
    need(actual && BigInt(actual.numerator) * d === n * BigInt(actual.denominator), 'Static mastering values differ from the frozen cell.', REQUIRED); }
  need(metadata.contentLight.max_content.value === 1000 && metadata.contentLight.max_average.value === 400,
    'Static content-light values differ from the frozen cell.', REQUIRED);
}
// Small writer contracts stay bounded. A single complete input receipt owns the
// global count/EOF; contiguous sampled chunks check every signal/static value.
function completeWriter(videoEvidence, frames, hdrPolicy = 'preserve') {
  let writer;
  for (let start=0; start<frames.length; start+=256) {
    const next = buildHdrEncoding({ settings: SETTINGS, policy: hdrPolicy, videoEvidence,
      frameEvidence: { videoIndex: 0, coverage: 'sampled', decodedFrameCount: frames.length, decodeExitCode: 0, frames: frames.slice(start,start+256) } });
    if (hdrPolicy === 'preserve') metadataSignature(next, true);
    else need(next.contract.source.metadata.ambient === null && next.contract.source.metadata.dolby === null
      && Object.values(next.expectedOutput.metadata).every(value => value === null),
      'The finite SDR route requires ordinary PQ/HLG input and complete obsolete-HDR-metadata removal.', REQUIRED);
    need(!writer || same(writer.expectedOutput,next.expectedOutput)
      && same(writer.contract.source.metadata,next.contract.source.metadata)
      && writer.filterGraph === next.filterGraph,
      'Complete source metadata or transform changes across a chunk boundary.', REQUIRED); writer ||= next;
  }
  need(writer, 'A complete nonempty source observation is required.', REQUIRED); return writer;
}
function frameGeometry(plane, timestamps) {
  need(plain(plane) && Array.isArray(plane.frames) && plane.frames.length === 96 && plane.coverage === 'full'
    && plane.decodedFrameCount === 96 && plane.decodeExitCode === 0, 'Complete exactly96frame successful native evidence is required.');
  need(plane.video?.width === 320 && plane.video.height === 180, 'Native decoded plane dimensions differ from the plan.');
  need(!own(plane.video, 'sample_aspect_ratio') && !own(plane.video, 'display_aspect_ratio'), 'The output invented a SAR/DAR instruction.');
  for (const [i, frame] of plane.frames.entries()) {
    need(plain(frame) && frame.width === 320 && frame.height === 180 && !own(frame, 'sample_aspect_ratio')
      && !own(frame, 'display_aspect_ratio'), 'Decoded dimensions or absent SAR/DAR changed.');
    for (const k of ['crop_top', 'crop_bottom', 'crop_left', 'crop_right', 'repeat_pict']) need(!own(frame, k) || frame[k] === 0 || frame[k] === '0', 'Decoded crop or cadence interpretation changed.');
    need(!own(frame, 'side_data_list') || frame.side_data_list.every(e => SIDE.has(e.side_data_type)), 'Unqualified decoded side data is not preservation evidence.');
    if (timestamps) {
      const expected = String(Math.floor((i * 1000 + 15) / 30));
      need(String(frame.pts) === expected && String(frame.duration ?? frame.pkt_duration) === '33'
        && (!own(frame, 'duration') || !own(frame, 'pkt_duration') || String(frame.duration) === String(frame.pkt_duration)),
      'Every native PTS and duration must match the exact frozen96frame clock.');
    }
  }
}
function tagsOf(tags) {
  const result = new Map();
  for (const [key, value] of Object.entries(snapshot(tags))) { const normalized = key.toLowerCase();
    need(!result.has(normalized) && (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)), 'Duplicate or nonscalar metadata is invalid.'); result.set(normalized, String(value)); }
  return result;
}
function compareMetadata(before, after, { container = false, alias = null } = {}) {
  const source = tagsOf(before || {}), actual = tagsOf(after || {}), errors = [], warnings = [];
  for (const [key, value] of source) {
    if (container && MARKERS.has(key) || GENERATED.has(key)) { if (key === 'encoder' && actual.get(key) !== value) warnings.push({ code: 'HDR_DESCRIPTIVE_TAG_CHANGED', message: 'The encoder description changed while the encoded HDR operation and complete media evidence are validated independently.' }); continue; }
    if (key === 'creation_time' && alias !== null && actual.get(STREAM_CREATION_TIME_ALIAS.toLowerCase()) === value) continue;
    if (actual.get(key) !== value) errors.push(`Functional or unassessed metadata '${key}' was not preserved.`);
  }
  for (const [key, value] of actual) if (!source.has(key) && !GENERATED.has(key) && !(container && MARKERS.has(key))
      && !(alias !== null && key === STREAM_CREATION_TIME_ALIAS.toLowerCase() && value === alias)) errors.push(`Unassessed output-only metadata '${key}' was introduced.`);
  return { errors, warnings };
}
function collectionState(plan, bindings) {
  const entry = registry.get(plan); need(entry && entry.current(), 'Only a current original HDR operation plan may collect evidence.', PLAN_REQUIRED);
  record(bindings, ['sourcePath', 'outputPath', 'sourceProbe', 'outputProbe', 'runtimeIdentity', 'outputId']);
  const state = entry.state;
  need(state.selected && state.invocationOutput !== null && bindings.sourcePath === state.input && bindings.outputPath === state.invocationOutput
    && bindings.runtimeIdentity === state.runtimeIdentity && bindings.outputId === state.outputId
    && fingerprintHdrProbe(bindings.sourceProbe) === state.sourceProbeFingerprint,
  'Collected source, stage, runtime, UUID and genuine selected plan must match.', STALE);
  return state;
}
function getHdrOperationCollectionBinding(plan, bindings) {
  const state = collectionState(plan, bindings);
  return freeze({ planFingerprint: plan.planFingerprint, sourceEvidenceFingerprint: state.sourceProbeFingerprint,
    outputEvidenceFingerprint: fingerprintHdrProbe(bindings.outputProbe), sourceFingerprint: hash(state.identity), sourceIdentity: state.identity,
    sourceFileSha256: state.sourceFileSha256, writerPlan: state.writer, expectedOutput: plan.expectedOutput, policyIdentity: state.policyIdentity,
    hdrPolicy: state.route.hdrPolicy, ...(state.transform ? { transform: state.transform } : {}),
    eligibilityMode: state.inputObservation ? 'content' : 'exact-seed',
    ...(state.inputObservation ? { inputObservation: state.inputObservation, sourceProfiles: state.route.profiles, outputProfiles: state.route.outputProfiles } : {}) });
}

class HdrOperations {
  #runtime; #policy; #policies; #epoch = 0; #plans = new WeakMap(); #latest = new Map(); #selections = new WeakMap(); #outputIds = new Set();
  constructor(options) {
    record(options, ['runtimeIdentity', 'policies', 'policyIdentity'], ['runtimeIdentity', 'policyIdentity']);
    this.#runtime = digest(options.runtimeIdentity, 'Paired runtime'); this.#policy = id(options.policyIdentity, 'HDR policy');
    const entries = own(options, 'policies') ? snapshot(options.policies) : []; need(Array.isArray(entries) && entries.length <= 4, 'HDR catalog contains at most two preservation and two SDR conversion cells.');
    this.#policies = entries.map(policy); need(new Set(this.#policies.map(x => `${x.hdrPolicy}:${x.transfer}`)).size === this.#policies.length
      && new Set(this.#policies.map(x => x.id)).size === this.#policies.length, 'HDR cells require unique identities and policy/transfer pairs.'); freeze(this.#policies);
  }
  #current(plan) { const s = this.#plans.get(plan); need(s && s.epoch === this.#epoch && this.#latest.get(s.request.fileId) === plan, 'Only this owner\'s current original HDR plan is usable.', PLAN_REQUIRED); return s; }
  inputProfiles(probe, hdrPolicy = 'preserve') { const transfer = selectVideo(probe)?.color_transfer;
    return this.#policies.find(p => p.runtimeIdentity === this.#runtime && p.transfer === transfer && p.hdrPolicy === hdrPolicy)?.profiles || null; }
  prepare(options) {
    const fields = ['input', 'output', 'outputId', 'sourceIdentity', 'sourceFileSha256', 'request', 'settings', 'inspection', 'frameEvidence', 'generationDescription', 'inputReceipt'];
    // A missing source hash still fails after revoking the named old plan.
    // The trusted request identifies the affected file; no hash is inferred.
    record(options, fields, fields.filter(key => !['sourceFileSha256','inputReceipt'].includes(key)));
    const request = snapshot(options.request); id(request.fileId, 'Prepared file');
    // A failed new preparation must not leave an older Start authority live.
    // Application-default edits do not call this operation-specific boundary.
    this.#latest.delete(request.fileId);
    const config = snapshot(options.settings); need(same(config, SETTINGS), 'Only the reviewed CPU slow CRF25 tuple is qualified.', REQUIRED);
    const sourceFileSha256 = digest(options.sourceFileSha256, 'Observed full source bytes');
    need(request.operation === 'encode' && request.range === null && request.resolution === 'source' && request.target === 'matroska'
      && ['preserve', 'sdr'].includes(request.hdrPolicy) && request.audioPolicy === 'copy' && request.aacBitrateKbps === null
      && Array.isArray(request.omissionRequestIds) && request.omissionRequestIds.length === 0, 'Only explicit Full preserve-or-SDR/source/copy HDR requests can use these finite cells.', REQUIRED);
    const identity = sourceIdentity(options.sourceIdentity), input = local(options.input), destination = local(options.output);
    need(input === identity.canonicalPath && !samePath(input, destination), 'Prepared HDR source identity and distinct destination must agree.');
    record(options.inspection, ['probe', 'color', 'duration', 'evidence', 'summary', 'warnings', 'sampling', 'cache'], ['probe']);
    const transfer = selectVideo(options.inspection.probe)?.color_transfer;
    const route = this.#policies.find(p => p.runtimeIdentity === this.#runtime && p.transfer === transfer && p.hdrPolicy === request.hdrPolicy);
    need(route, 'No reviewed HDR cell applies to this exact runtime, transfer and requested HDR policy.', REQUIRED);
    const { probe, video } = probeFacts(options.inspection.probe, { content: Boolean(route.profiles) });
    need(!own(probe.format, 'size') || BigInt(probe.format.size) === BigInt(identity.size), 'Observed source size differs from prepared filesystem identity.');
    need(classifyColor(probe).classification === 'hdr', 'Positive source HDR evidence is required.', REQUIRED);
    let inputObservation = null, frames, writer;
    const typedVideo = probe.mediaEvidence.streams.find(s => s.index === video.index);
    if (route.profiles) {
      inputObservation = getObservedHdrInput(options.inputReceipt, { sourcePath: input, sourceIdentity: identity,
        probe: options.inspection.probe, runtimeIdentity: this.#runtime, profiles: route.profiles });
      need(inputObservation.sourceFileSha256 === sourceFileSha256, 'Full input receipt and prepared source hash differ.', REQUIRED);
      frames = { frames: inputObservation.frames };
      writer = completeWriter(typedVideo, frames.frames, route.hdrPolicy);
    } else {
    // The type of an unregistered SEI cannot prove that its payload is only
    // encoder prose. This first family therefore admits only reviewed seed
    // bytes, observed independently by main and again by the complete collector.
    need(sourceFileSha256 === route.sourceSha256, 'The full source bytes are not the exact reviewed HDR seed for this transfer.', REQUIRED);
    frames = snapshot(options.frameEvidence);
    need(frames.coverage === 'sampled' || frames.coverage === 'full' && frames.frames?.length === 96, 'Preparation must declare actual bounded sampled or complete source coverage.');
    need(Array.isArray(frames.frames) && frames.frames.length > 0 && frames.frames.length <= 96, 'Bounded native preparation frames are required.');
    let previous = -1;
    for (const frame of frames.frames) {
      const pts = typeof frame.pts === 'number' || typeof frame.pts === 'string' && /^\d+$/.test(frame.pts) ? Number(frame.pts) : NaN;
      need(Number.isSafeInteger(pts) && pts > previous && pts <= 3167 && String(frame.duration ?? frame.pkt_duration) === '33'
        && (!own(frame, 'best_effort_timestamp') || String(frame.best_effort_timestamp) === String(frame.pts)),
      'Preparation frames must have complete, strictly ordered native source timestamps/durations.'); previous = pts;
    }
    writer = buildHdrEncoding({ settings: config, policy: 'preserve', videoEvidence: typedVideo, frameEvidence: frames }); metadataSignature(writer);
    }
    const sdr = route.hdrPolicy === 'sdr';
    need(writer.status === 'native-qualification-required' && writer.missingWriters.length === 0
      && writer.route === `${video.color_transfer === 'smpte2084' ? 'pq' : 'hlg'}-${sdr ? 'to-sdr' : 'preserve'}`,
      'The exact qualified source/policy writer is required.', REQUIRED);
    if (!sdr) need(writer.filterGraph === 'format=yuv420p10le', 'Preservation requires the qualified identity HDR writer.', REQUIRED);
    const contribution = writer.contract.filterContribution;
    if (sdr) need(inputObservation && contribution?.engine === 'software'
      && contribution.version === route.transformVersion && writer.expectedOutput.signal.transfer === 'bt709'
      && writer.expectedOutput.signal.primaries === 'bt709' && writer.expectedOutput.signal.matrix === 'bt709'
      && writer.expectedOutput.signal.range === 'tv' && writer.expectedOutput.signal.bitDepth === 10,
      'The genuine complete source and exact software BT.709 Main10 conversion are required.', REQUIRED);
    // Parameter-set identity does not bind MaxCLL. These finite conversion
    // cells have actual numerical evidence only for the reported4000nit PQ
    // interpretation and declared1000nit/gamma1.2 HLG reference. A different
    // peak can change Hable while retaining the same source PS and version.
    if (sdr) {
      const interpretation = contribution.interpretation, pq = route.transfer === 'smpte2084';
      need(interpretation?.nominalSdrNits === 100
        && interpretation.sourcePeakNits === (pq ? 4000 : 1000)
        && interpretation.sourcePeakBasis === (pq ? 'reported-maxcll' : 'assumed-1000nit-hlg-reference-display')
        && interpretation.hlgSystemGamma === (pq ? null : 1.2)
        && interpretation.sourcePeakMeasuredByApplication === false,
      'This finite PQ conversion requires reported MaxCLL4000nits; HLG requires the declared1000nit/gamma1.2reference. Other peak interpretations need separate qualification.', REQUIRED);
    }
    const transform = sdr ? freeze({ version: route.transformVersion,
      filterGraphSha256: hash(writer.filterGraph), interpretation: contribution.interpretation,
      interpretationSha256: hash(contribution.interpretation), sourceProfilesSha256: hash(route.profiles),
      outputProfilesSha256: hash(route.outputProfiles) }) : null;
    const description = generationDescriptionOf(snapshot(options.generationDescription));
    need(description && description.profileId === SETTINGS.profileId && description.preset === SETTINGS.preset && description.quality === SETTINGS.quality
      && description.bitDepth === 10 && same(description.encoderArgs, describeRecipe(config).args), 'HDR provenance must retain the exact canonical v1 ordinary recipe.');
    need(typeof options.outputId === 'string' && UUID.test(options.outputId), 'A fresh main-created output UUID is required.'); const outputId = options.outputId.toLowerCase();
    need(!this.#outputIds.has(outputId), 'Output UUIDs cannot be reused after cancellation or supersession.');
    const alias = streamCreationTimeAlias(video), contract = buildOperationContract({ request, videoEvidence: typedVideo, audioEvidence: [] });
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-n',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm', '-noautorotate', '-copyts', '-i', input,
      '-map', '0:0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', '-map_metadata:s:0', '0:s:0', '-disposition:0', '0',
      ...writer.videoEncoderArgs, '-filter:v:0', writer.filterGraph, '-enc_time_base:v:0', 'filter', '-avoid_negative_ts', 'disabled'];
    let containerDurationWriter = null;
    if (inputObservation) {
      const last = inputObservation.frames.at(-1), pts = BigInt(last.pts), declared = BigInt(inputObservation.containerTiming.declaredDurationTicks);
      const duration = declared - pts, rate = BigInt(video.avg_frame_rate.slice(0,-2));
      need(duration === 1000n/rate || duration === (1000n+rate-1n)/rate, 'The frozen header has no qualified final-packet duration serialization.', REQUIRED);
      // Matroska omits BlockDuration for its exact low/high period states.
      // Preserve the source header state through the final presentation packet;
      // every demuxed native row remains independently exact. Explicit PTS/DTS
      // expressions are essential: setts otherwise assigns DTS to both fields.
      containerDurationWriter = `setts=pts=PTS:dts=DTS:duration=DURATION+not(PTS-${pts})*(${duration}-DURATION):time_base=1/1000:prescale=1`;
      args.push('-bsf:v:0',containerDurationWriter);
    }
    if (alias !== null) args.push('-metadata:s:0', `${STREAM_CREATION_TIME_ALIAS}=${alias}`);
    args.push(...provenanceArgs(outputId, description), '-stats_enc_pre:0', PLACEHOLDER, '-stats_enc_pre_fmt:0', FORMATS.video,
      '-default_mode', 'passthrough', '-f', 'matroska', destination);
    const expectedOutput = freeze({ operation: 'encode', target: 'matroska', hdr: writer.expectedOutput, hdrContract: writer.contract,
      geometry: contract.geometry, range: contract.range, audio: contract.audio, streams: [{ inputIndex: 0, outputIndex: 0, codecType: 'video', codecName: 'hevc' }],
      outputId, sourceFileSha256, decodedEvidenceRequired: true, measuredTolerancesRequired: true, frameCount: inputObservation?.frameCount || 96,
      ...(inputObservation ? { inputContentFingerprint: inputObservation.compressedFingerprint, inputTimelineHash: inputObservation.timelineHash,
        configuration: inputObservation.configurationMetadata.configuration, inputPixelFrames: inputObservation.pixelFrames,
        sourceContainerTiming: inputObservation.containerTiming, containerDurationWriter } : {}), timestampPolicy: 'exact-source-native-1ms-clock-zero-mismatch',
      descriptiveProvenanceScope: 'ordinary-video-recipe; exact-hdr-operation-retained-in-prepared-plan-and-correlated-invocation',
      hdrDisplayAcceptance: 'not-assessed', dolbyVision: false, hdr10Claim: false,
      ...(transform ? { hdrTransform: transform } : {}) });
    const instrumentation = freeze({ version: 1, kind: 'encoder-input-statistics', streams: STREAMS, placeholders: [PLACEHOLDER] });
    const sourceProbeFingerprint = fingerprintHdrProbe(probe), epoch = this.#epoch;
    const plan = freeze({ operation: 'encode', hdr: true, compatibilityPath: false, args, contract, expectedOutput, runtimeIdentity: this.#runtime,
      sourceProbeFingerprint, instrumentation, planFingerprint: hash({ args, contract, expectedOutput, sourceIdentity: identity, sourceProbeFingerprint,
        runtimeIdentity: this.#runtime, policyIdentity: this.#policy, route, description, epoch }) });
    const state = { epoch, request: contract.request, identity, sourceProbeFingerprint, probe: freeze(probe), writer, route,
      input, destination, outputId, sourceFileSha256, inputObservation, transform, description: freeze(description), alias, runtimeIdentity: this.#runtime, policyIdentity: this.#policy,
      selected: false, invocationOutput: null, telemetry: null, telemetryValidation: null };
    this.#plans.set(plan, state); this.#latest.set(request.fileId, plan); this.#outputIds.add(outputId);
    registry.set(plan, { state, current: () => state.epoch === this.#epoch && this.#latest.get(state.request.fileId) === plan }); return plan;
  }
  #bindings(options) {
    record(options, BINDINGS); const state = this.#current(options.plan);
    need(same(snapshot(options.settings), SETTINGS) && options.environment === null && options.runtimeIdentity === this.#runtime
      && options.sourceProbeFingerprint === state.sourceProbeFingerprint && same(sourceIdentity(options.sourceIdentity), state.identity),
    'The prepared source, runtime, CPU settings and environment must remain exact.');
    need(same(snapshot(options.budget), BUDGET) && options.executionBudgetMs === EXECUTION_MS, 'The complete existing HDR collection/execution budget must remain exact.'); return state;
  }
  select(options) {
    try { const state = this.#bindings(options), token = Object.freeze({}); state.selected = true;
      const result = freeze({ controlsRequired: true, hdr: true, budget: { ...BUDGET }, executionBudgetMs: EXECUTION_MS,
        evidenceIds: state.route.evidenceIds, policyIdentity: this.#policy, hdrPolicy: state.route.hdrPolicy,
        ...(state.transform ? { transform: state.transform } : {}), qualification: { operation: 'encode-hdr', cellId: state.route.id,
          evidenceId: state.route.evidenceIds[0], runtimeIdentity: this.#runtime, timestampToleranceTicks: 0, durationToleranceTicks: 0 } });
      this.#selections.set(token, { epoch: this.#epoch, plan: options.plan, result }); return token;
    } catch (e) { throw new ToolError(REQUIRED, e.message); }
  }
  requireCurrent(selection, options) {
    try { const chosen = this.#selections.get(selection); need(chosen && chosen.epoch === this.#epoch && chosen.plan === options?.plan, 'A genuine current HDR selection is required.');
      this.#bindings(options); return chosen.result;
    } catch (e) { throw new ToolError(STALE, e.message); }
  }
  resolveInvocation(plan, options) {
    record(options, ['output', 'telemetry']); const state = this.#current(plan), output = local(options.output);
    need(state.selected && !samePath(output, state.input) && !samePath(output, state.destination), 'A selected plan and distinct protected temporary stage are required.');
    need(state.invocationOutput === null || state.invocationOutput === output && state.telemetry === options.telemetry, 'A genuine HDR plan cannot rebind its actual output/telemetry.', STALE);
    const telemetryArgs = assertTelemetryBinding(options.telemetry, { runtimeIdentity: this.#runtime, planFingerprint: plan.planFingerprint, streams: STREAMS });
    state.invocationOutput = output; state.telemetry = options.telemetry;
    const args = plan.args.map(x => x === PLACEHOLDER ? telemetryArgs[1] : x); args[args.length - 1] = output; return freeze(args);
  }
  validateTelemetry(plan, telemetry, evidence) {
    const state = this.#current(plan); assertCollectedTelemetry(telemetry);
    const complete = require('./hdr-evidence.cjs').getCollectedHdrEvidence(evidence, { plan, runtimeIdentity: this.#runtime, outputId: state.outputId,
      sourcePath: state.input, outputPath: state.invocationOutput, sourceProbe: state.probe });
    const actual = telemetry.streams?.[0]?.summary, pts = createHash('sha256');
    for (const frame of complete.source.frames) { let n = BigInt(frame.pts), d = 1000n; const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; }; const g = gcd(n, d); n /= g; d /= g; pts.update(`${n}/${d}\n`); }
    need(state.telemetry && telemetry.runtimeIdentity === this.#runtime && telemetry.planFingerprint === plan.planFingerprint && telemetry.streams.length === 1
      && telemetry.streams[0].path === state.telemetry.streams[0].path
      && actual.stream.kind === 'video' && actual.stream.outputIndex === 0 && actual.records === String(plan.expectedOutput.frameCount)
      && actual.repeatedPts === '0' && actual.backwardsPts === '0' && actual.hashes.orderedPts === pts.digest('hex'),
    'Complete encoder-input telemetry does not match this exact source/plan/runtime clock.');
    state.telemetryValidation = { telemetry, evidence };
    return freeze({ valid: true, scope: 'encoder-input-count-and-timeline-only', records: String(plan.expectedOutput.frameCount), videoPixels: 'not-compared', lastFrameDuration: 'independent-complete-collector',
      unknownInputRecords: actual.unknownInputRecords, inputCorrespondence: actual.unknownInputRecords === '0'
        ? 'reported-input-and-independent-complete-source-clock' : 'upstream-input-lineage-unavailable; independently-matched-complete-source-clock-and-count' });
  }
  validate(plan, outputProbe, collectorReceipt) {
    const errors = [], warnings = [];
    try {
      const state = this.#current(plan), { probe: output, video } = probeFacts(outputProbe, { output: true, content: Boolean(state.inputObservation), hdrPolicy: state.route.hdrPolicy });
      need(state.selected && state.invocationOutput !== null && state.telemetryValidation?.evidence === collectorReceipt,
        'The genuine completed collection and its independently matched telemetry are required.');
      const complete = require('./hdr-evidence.cjs').getCollectedHdrEvidence(collectorReceipt, { plan, runtimeIdentity: this.#runtime, outputId: state.outputId,
        sourcePath: state.input, outputPath: state.invocationOutput, sourceProbe: state.probe, outputProbe: output });
      need(complete.sourceFileSha256 === state.sourceFileSha256, 'Collected full source bytes differ from the reviewed prepared seed.');
      let fullWriter;
      if (state.inputObservation) {
        need(String(output.format.duration) === String(state.probe.format.duration), 'The declared output container duration differs from the frozen source header.');
        need(same(complete.source.containerTiming,state.inputObservation.containerTiming), 'Recollected raw source container timing differs from preparation.');
        for (const field of ['timestampScaleNs','defaultDurationNs','declaredDurationTicks','trackTimeScale','codecDelayNs','trackOffsetNs','trackEnabled'])
          need(complete.outputSeal.containerTiming?.[field] === state.inputObservation.containerTiming[field], 'Raw output container timing differs from the frozen source header.');
        need(complete.source.frames.length === state.inputObservation.frameCount && complete.container.frames.length === state.inputObservation.frameCount
          && complete.bitstream.frames.length === state.inputObservation.frameCount
          && complete.source.compressedFingerprint === state.inputObservation.compressedFingerprint,
        'The complete collection differs from the prepared input membership/configuration.');
        for (let index=0; index<state.inputObservation.frameCount; index++) for (const plane of [complete.source,complete.container]) {
          const original = state.inputObservation.frames[index], actual = plane.frames[index];
          need(String(original.pts) === String(actual.pts) && String(original.duration ?? original.pkt_duration) === String(actual.duration ?? actual.pkt_duration),
            'Every collected native PTS/duration must equal the prepared complete source.');
        }
        fullWriter = completeWriter(state.probe.mediaEvidence.streams[0],complete.source.frames,state.route.hdrPolicy);
      } else {
        frameGeometry(complete.source, true); frameGeometry(complete.container, true); frameGeometry(complete.bitstream, false);
        fullWriter = buildHdrEncoding({ settings: SETTINGS, policy: 'preserve', videoEvidence: state.probe.mediaEvidence.streams[0],
          frameEvidence: { videoIndex: 0, coverage: 'full', decodedFrameCount: 96, decodeExitCode: 0, frames: complete.source.frames } }); metadataSignature(fullWriter);
      }
      need(same(fullWriter.expectedOutput, state.writer.expectedOutput) && fullWriter.filterGraph === state.writer.filterGraph
        && same(fullWriter.contract.source.metadata,state.writer.contract.source.metadata), 'Complete source HDR metadata or transform differs from the prepared writer.');
      const signalPlane = plane => Object.fromEntries(['video', 'frames', 'coverage', 'decodedFrameCount', 'decodeExitCode'].map(k => [k, plane[k]]));
      if (state.inputObservation) {
        for (let start=0;start<state.inputObservation.frameCount;start+=256) {
          const chunk = plane => {
            const observed = signalPlane(plane);
            // The genuine complete collector checked every progressive frame.
            // Derive a validation declaration for this internal subset while
            // preserving the original raw-demux observation in retained facts.
            const video = !['progressive'].includes(observed.video.field_order)
              && complete.bitstream === plane && plane.frames.every(frame => frame.interlaced_frame === 0 || frame.interlaced_frame === '0')
              ? { ...observed.video, field_order: 'progressive' } : observed.video;
            return { ...observed, video, coverage: 'sampled', frames: plane.frames.slice(start,start+256) };
          };
          const hdr = validateHdrEncodingOutput(state.writer,{ container: chunk(complete.container), bitstream: chunk(complete.bitstream) }); errors.push(...hdr.errors);
        }
      } else { const hdr = validateHdrEncodingOutput(state.writer, { container: signalPlane(complete.container), bitstream: signalPlane(complete.bitstream) }); errors.push(...hdr.errors); }
      need(video.color_transfer === state.writer.expectedOutput.signal.transfer, 'The effective output transfer differs from the explicitly selected HDR policy.');
      const marker = classifyMarker(output); need(marker.kind === 'generated' && marker.outputId === state.outputId && same(marker.previousGeneration, state.description), 'Actual staged output provenance differs from the immutable prepared recipe/UUID.');
      for (const [before, after, options] of [[state.probe.streams[0].tags, video.tags, { alias: state.alias }], [state.probe.format.tags, output.format.tags, { container: true }]]) {
        const result = compareMetadata(before, after, options); errors.push(...result.errors); warnings.push(...result.warnings);
      }
      digest(complete.outputFileSha256, 'Complete owned output seal');
      return { valid: errors.length === 0, errors, warnings, validation: 'complete-tiny-cpu-hdr-operation', publicationAuthorized: false, hdrDisplayAcceptance: 'not-assessed' };
    } catch (e) { errors.push(e.message); return { valid: false, errors, warnings, code: e.code || INVALID, publicationAuthorized: false }; }
  }
  discard(plan) {
    const state = this.#plans.get(plan);
    if (!state) return false;
    // Cancellation or another preparation can expire this provisional plan
    // during an awaited destination check. Remove only this named plan, never
    // a newer plan for the same file, and never mask the original cancellation.
    if (this.#latest.get(state.request.fileId) === plan) this.#latest.delete(state.request.fileId);
    this.#plans.delete(plan); registry.delete(plan);
    return true;
  }
  invalidate() { this.#epoch++; this.#latest.clear(); }
}

module.exports = { HdrOperations, fingerprintHdrProbe, getHdrOperationCollectionBinding };
