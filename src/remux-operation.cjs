'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { ToolError } = require('./process-runner.cjs');
const { getRemuxAssessmentSource, validateRemuxRequest, buildRemuxQualificationArgs } = require('./remux-contract.cjs');
const { createRemuxValidator, remuxProbeFingerprint } = require('./remux-validation.cjs');

// Main-private ownership, not a renderer registry or a codec-table permission.
// A policy is supplied only after main reviews its retained route/lifecycle
// evidence and measured runtime. Every actual output still
// needs complete independent native collection and the strict remux validator.
const INVALID = 'INVALID_REMUX_OPERATION', REQUIRED = 'REMUX_QUALIFICATION_REQUIRED';
const STALE = 'REMUX_OPERATION_STALE', PLAN_REQUIRED = 'REMUX_OPERATION_PLAN_REQUIRED';
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SOURCE_FIELDS = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
const BINDINGS = ['plan', 'settings', 'sourceIdentity', 'sourceProbeFingerprint', 'runtimeIdentity', 'environment', 'budget', 'executionBudgetMs'];
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8 * 1024 * 1024,
  maxPcmBytes: 128 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const TIMING = Object.freeze({ numerator: '1', denominator: '500' });
const EXECUTION_MS = 600000, MAX_BYTES = 512n * 1024n * 1024n;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (message, code = INVALID) => { throw new ToolError(code, message); };
const need = (value, message, code) => { if (!value) fail(message, code); };
function record(value, fields, required = fields, label = 'Remux operation record') {
  need(plain(value) && required.every(key => own(value, key)), `${label} is incomplete.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && fields.includes(key) && descriptor.enumerable && own(descriptor, 'value'), `${label} contains an unsupported field.`);
  }
}
function list(value, maximum, label) {
  need(Array.isArray(value) && value.length <= maximum, `${label} exceeds its list bound.`);
  need(Reflect.ownKeys(value).length === value.length + 1 && Reflect.ownKeys(value).every(key => key === 'length'
    || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length
      && Object.getOwnPropertyDescriptor(value, key).enumerable && own(Object.getOwnPropertyDescriptor(value, key), 'value')),
  `${label} must be dense data without extra properties.`); return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function id(value, label) { need(typeof value === 'string' && ID.test(value), `${label} needs a bounded identity.`); return value; }
function digest(value, label) { need(typeof value === 'string' && HASH.test(value), `${label} needs a SHA256 digest.`); return value; }
function localPath(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 32767 && !/[\x00-\x1f\x7f]/.test(value)
    && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value))
    && (!/^[a-z][a-z0-9+.-]*:/i.test(value) || /^[a-z]:[\\/]/i.test(value)), 'A main-resolved absolute local path is required.'); return value;
}
const samePath = (a, b) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
function sourceIdentity(value) {
  // Identity readers may add bounded scalar diagnostics. They are never part of
  // media identity, never evaluated through getters and never retained as grants.
  need(plain(value) && SOURCE_FIELDS.every(key => own(value, key)) && Reflect.ownKeys(value).length <= 32, 'Complete bounded source identity is required.');
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && key.length <= 128 && d.enumerable && own(d, 'value'), 'Source identity cannot contain accessors or hidden fields.');
    if (!SOURCE_FIELDS.includes(key)) need(d.value === null || typeof d.value === 'boolean'
      || typeof d.value === 'number' && Number.isFinite(d.value) || typeof d.value === 'string' && d.value.length <= 1024, 'Source diagnostics must be bounded scalar data.');
  }
  const result = { canonicalPath: localPath(value.canonicalPath) };
  for (const key of SOURCE_FIELDS.slice(1, -1)) {
    need(typeof value[key] === 'string' && /^(0|-?[1-9]\d{0,19})$/.test(value[key]), 'Source identity needs exact filesystem integers.');
    const integer = BigInt(value[key]); need(integer >= (['dev', 'ino', 'size'].includes(key) ? 1n : -9223372036854775808n)
      && integer <= 18446744073709551615n, 'Source identity integer exceeds its bound.'); result[key] = value[key];
  }
  need(BigInt(result.size) <= MAX_BYTES, 'Source exceeds the measured 512MiB Remux envelope.', REQUIRED);
  need(typeof value.sparseDigest === 'string' && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(value.sparseDigest), 'Source identity needs its complete bounded sparse digest.');
  result.sparseDigest = value.sparseDigest; return result;
}
function fingerprintRemuxSourceIdentity(value) { return hash(sourceIdentity(value)); }
function policy(value) {
  const fields = ['id', 'inputFamily', 'target', 'evidenceIds', 'allowAncillary', 'runtimeIdentity', 'allowRotation90'];
  record(value, fields, fields.slice(0, -1), 'Main-reviewed Remux route policy');
  need(['isobmff', 'matroska'].includes(value.inputFamily) && ['matroska', 'mp4', 'mov'].includes(value.target), 'Only the finite reviewed local Remux families are available.');
  need(typeof value.allowAncillary === 'boolean' && (!own(value, 'allowRotation90') || typeof value.allowRotation90 === 'boolean'), 'Route options must be explicit booleans.');
  need(!value.allowAncillary || value.inputFamily === 'matroska' && value.target === 'matroska', 'Ancillary collection is available only for reviewed Matroska-to-Matroska routes.');
  const evidenceIds = list(value.evidenceIds, 32, 'Retained route evidence').map(item => id(item, 'Retained route evidence'));
  need(evidenceIds.length > 0 && new Set(evidenceIds).size === evidenceIds.length, 'A reviewed route needs unique retained evidence IDs.');
  return freeze({ id: id(value.id, 'Route policy'), inputFamily: value.inputFamily, target: value.target, evidenceIds,
    allowAncillary: value.allowAncillary, runtimeIdentity: digest(value.runtimeIdentity, 'Qualified paired runtime'),
    allowRotation90: value.allowRotation90 === true });
}
function ratio(value, separator = '/') {
  const parts = typeof value === 'string' && value.split(separator);
  need(parts && parts.length === 2 && parts.every(part => /^\d{1,16}$/.test(part)) && BigInt(parts[1]) > 0n, 'An exact positive-denominator ratio is required.', REQUIRED);
  return { n: BigInt(parts[0]), d: BigInt(parts[1]) };
}
function positiveTime(value, label) {
  need(value?.state === 'known' && /^-?\d{1,40}$/.test(value.value?.numerator) && /^[1-9]\d{0,39}$/.test(value.value?.denominator), `Known ${label} is required.`, REQUIRED);
  const n = BigInt(value.value.numerator), d = BigInt(value.value.denominator);
  need(n > 0n && n <= 120n * d, `${label} must be positive and at most120 seconds.`, REQUIRED);
}
function geometry(evidence, route) {
  const g = evidence?.geometry; need(g && !g.issues?.length, 'Complete unambiguous source geometry is required.', REQUIRED);
  const sar = g.sampleAspectRatio; need(sar.state === 'known' && BigInt(sar.value.numerator) === BigInt(sar.value.denominator), 'Only explicit square-pixel Remux source geometry is qualified.', REQUIRED);
  const fields = [g.rotationDegrees, g.legacyRotationDegrees, g.displayMatrix];
  need(fields.every(value => value && value.state !== 'malformed'), 'Malformed source orientation is unqualified.', REQUIRED);
  if (g.rotationSource === 'not-reported' && fields.every(value => value.state === 'unknown')) return;
  const angle = g.rotationDegrees;
  need(angle.state === 'known' && angle.value.denominator === '1', 'An exact measured source orientation is required.', REQUIRED);
  const degrees = Number(angle.value.numerator); need(degrees === 0 || degrees === 90 && route.allowRotation90, 'This route has no reviewed90-degree rotation evidence.', REQUIRED);
  need(g.legacyRotationDegrees.state === 'unknown' || g.legacyRotationDegrees.state === 'known'
    && g.legacyRotationDegrees.value.numerator === String(degrees) && g.legacyRotationDegrees.value.denominator === '1', 'Conflicting legacy rotation is unqualified.', REQUIRED);
  if (g.displayMatrix.state === 'known') need(isDeepStrictEqual(g.displayMatrix.value, degrees === 90
    ? ['0', '-65536', '0', '65536', '0', '0', '0', '0', '1073741824']
    : ['65536', '0', '0', '0', '65536', '0', '0', '0', '1073741824']), 'Only the exact reviewed native display matrix is qualified.', REQUIRED);
  else need(degrees === 0 && g.rotationSource === 'legacy-rotate-tag', 'A rotated source needs its exact native display matrix.', REQUIRED);
}
function sourcePolicy(assessment, source, identity, route) {
  const mapped = assessment.expectedOutput.streams.map(mapping => source.streams.find(stream => stream.index === mapping.inputIndex));
  need(source.mediaEvidence.container.relationships.state === 'known' && source.programs.length === 0 && source.stream_groups.length === 0
    && source.streams.every(stream => stream.codec_type !== 'data'), 'Programs, unknown relationships, groups and timed data/timecode remain unqualified.', REQUIRED);
  need(source.format.size === identity.size, 'Observed source size must match the current exact source identity.', REQUIRED);
  positiveTime(source.mediaEvidence.container.durationSeconds, 'container duration');
  need(source.streams.filter(stream => stream.codec_type === 'video' && Number(stream.disposition?.attached_pic || 0) === 0).length === 1,
    'The initial Remux envelope requires exactly one non-cover primary video.', REQUIRED);
  const videos = mapped.filter(stream => stream.codec_type === 'video'), audio = mapped.filter(stream => stream.codec_type === 'audio');
  need(videos.length === 1 && videos[0].index === assessment.expectedOutput.selectedVideoInputIndex && Number(videos[0].disposition?.attached_pic || 0) === 0,
    'The single primary video must remain mapped.', REQUIRED);
  const video = videos[0], ve = source.mediaEvidence.streams.find(item => item.index === video.index);
  need(video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && video.field_order === 'progressive'
    && Number.isSafeInteger(video.width) && Number.isSafeInteger(video.height) && video.width > 0 && video.height > 0
    && video.width <= 1920 && video.height <= 1920 && video.width * video.height <= 1920 * 1080,
  'Only bounded progressive8-bit H264 yuv420p video is in the reviewed Remux envelope.', REQUIRED);
  need(['color_transfer', 'color_primaries', 'color_space'].every(key => video[key] === 'bt709') && video.color_range === 'tv'
    && ve && ve.hdr.entries.length === 0, 'Explicit coherent BT709 limited-range SDR without HDR metadata is required.', REQUIRED);
  for (const field of ['avg_frame_rate', 'r_frame_rate']) { const r = ratio(video[field]); need(r.n > 0n && r.n <= 60n * r.d, 'Source video rate exceeds the reviewed60fps envelope.', REQUIRED); }
  geometry(ve, route);
  need((video.side_data_list || []).every(item => item.side_data_type === 'Display Matrix'), 'Unreviewed video stream side data is unavailable.', REQUIRED);
  need(audio.length <= 2, 'At most two measured AAC audio tracks are qualified.', REQUIRED);
  if (assessment.inputFamily === 'matroska' && assessment.target !== 'matroska' && audio.some(stream => stream.codec_name === 'aac'))
    fail('Matroska AAC to MP4/MOV remains refused: retained priming, decoded tail and delayed-track samples change.', REQUIRED);
  if (assessment.target === 'matroska' && audio.some(stream => /^pcm_/.test(stream.codec_name)))
    fail('PCM to Matroska remains refused: explicit native channel-layout semantics were lost in retained evidence.', REQUIRED);
  for (const stream of audio) need(stream.codec_name === 'aac' && stream.profile === 'LC' && stream.sample_fmt === 'fltp'
    && ['44100', '48000'].includes(stream.sample_rate) && (stream.channels === 1 && stream.channel_layout === 'mono'
      || stream.channels === 2 && stream.channel_layout === 'stereo') && !(stream.side_data_list || []).length,
  'Only measured44.1/48kHz AAC LC mono/stereo audio belongs to this Remux envelope.', REQUIRED);
  // The measured frame-probe diagnostic covers one preserved TTF only. An
  // omitted attachment is still encountered by source FFprobe, but has no
  // complete payload proof in this route; refuse before offering Start.
  const sourceAttachments = source.streams.filter(stream => stream.codec_type === 'attachment');
  need(sourceAttachments.length <= 1 && sourceAttachments.every(stream => mapped.some(item => item.index === stream.index)),
    'This route requires preserving its single attachment. Restore the attachment selection; omitted or multiple attachments need separate inspection qualification.', REQUIRED);
  const ancillary = mapped.filter(stream => !['video', 'audio'].includes(stream.codec_type));
  need(!ancillary.length && !source.chapters.length || route.allowAncillary, 'This route has no complete ancillary/chapter qualification.', REQUIRED);
  need(ancillary.every(stream => stream.codec_type === 'subtitle' && ['subrip', 'ass'].includes(stream.codec_name)
    || stream.codec_type === 'attachment' && stream.codec_name === 'ttf'), 'Only the measured SubRip/ASS coded events and TTF attachment payload representation are in this ancillary subset.', REQUIRED);
  need(!assessment.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired, 'MP4/MOV chapter carriers remain unqualified.', REQUIRED);
  return freeze({ id: route.id, inputFamily: route.inputFamily, target: route.target, maximumSourceBytes: Number(MAX_BYTES), maximumDurationSeconds: 120,
    videoInputIndex: video.index, audioInputIndexes: audio.map(stream => stream.index), ancillary: ancillary.length > 0 || source.chapters.length > 0 });
}

class RemuxOperations {
  #runtime; #policyIdentity; #policies; #epoch = 0; #plans = new WeakMap(); #selections = new WeakMap(); #latest = new Map(); #outputIds = new Set();
  constructor(options) {
    record(options, ['runtimeIdentity', 'policies', 'policyIdentity'], ['runtimeIdentity', 'policyIdentity'], 'Main Remux policy catalog');
    this.#runtime = digest(options.runtimeIdentity, 'Paired runtime'); this.#policyIdentity = id(options.policyIdentity, 'Remux policy');
    this.#policies = (own(options, 'policies') ? list(options.policies, 32, 'Reviewed Remux policies') : []).map(policy);
    need(new Set(this.#policies.map(item => item.id)).size === this.#policies.length
      && new Set(this.#policies.map(item => `${item.inputFamily}:${item.target}`)).size === this.#policies.length, 'Reviewed Remux policies must have unique identities and routes.');
    freeze(this.#policies);
  }
  #current(plan) {
    const state = plan && typeof plan === 'object' ? this.#plans.get(plan) : null;
    need(state && state.epoch === this.#epoch && this.#latest.get(state.request.fileId) === plan, 'Only this owner\'s current genuine Remux plan is usable.', PLAN_REQUIRED); return state;
  }
  prepare(options) {
    record(options, ['assessment', 'input', 'output', 'outputId', 'sourceIdentity', 'request']);
    const request = validateRemuxRequest(options.request); this.#latest.delete(request.fileId);
    const source = getRemuxAssessmentSource(options.assessment), identity = sourceIdentity(options.sourceIdentity);
    need(options.input === identity.canonicalPath && isDeepStrictEqual(request, options.assessment.request)
      && options.assessment.sourceFingerprint === hash(identity), 'Assessment, request, path and exact current source identity must agree.');
    const route = this.#policies.find(item => item.inputFamily === options.assessment.inputFamily && item.target === request.target);
    need(route && route.runtimeIdentity === this.#runtime,
      'No reviewed main-private route applies to this Remux source, target and exact paired runtime.', REQUIRED);
    const facts = sourcePolicy(options.assessment, source, identity, route), epoch = this.#epoch;
    const args = buildRemuxQualificationArgs({ assessment: options.assessment, input: options.input, output: options.output, outputId: options.outputId });
    const outputId = options.outputId.toLowerCase();
    need(!this.#outputIds.has(outputId), 'Every prepare requires a fresh output identity; cancelled or superseded output identities cannot be reused.');
    const validator = createRemuxValidator({ requireQualification: binding => {
      need(this.#epoch === epoch && binding.assessment === options.assessment && binding.runtimeIdentity === this.#runtime
        && binding.cellId === route.id && binding.inputFamily === route.inputFamily && binding.target === route.target,
      'Current genuine assessment and reviewed route qualification are required.', REQUIRED);
      // A new assessment requirement cannot silently inherit an older reviewed
      // policy merely because a future contract adds its name to this list.
      need(binding.requirementIds.every(requirement => /^(?:codec:|dispositions:|track-tags:|side-data:)/.test(requirement)
        || ['media-content-and-timeline', 'chapters-and-container-tags', `provenance:${route.target}`,
          'publication-and-lifecycle', 'mov-family-metadata-mode'].includes(requirement)), 'This route contains an unreviewed qualification requirement.', REQUIRED);
      return { status: 'verified', runtimeIdentity: this.#runtime, operation: 'remux', inputFamily: route.inputFamily, target: route.target,
        cellId: route.id, evidenceId: route.evidenceIds[0], requirementIds: [...binding.requirementIds], maxTimestampError: TIMING, maxChapterError: TIMING };
    } });
    const innerPlan = validator.prepare({ assessment: options.assessment, runtimeIdentity: this.#runtime, cellId: route.id, outputId: options.outputId });
    const sourceProbeFingerprint = remuxProbeFingerprint(source), contract = freeze({ operation: 'remux', range: { kind: 'full' }, target: request.target, request });
    const description = { operation: 'remux', compatibilityPath: false, args, contract, expectedOutput: options.assessment.expectedOutput,
      sourceProbeFingerprint, runtimeIdentity: this.#runtime };
    const plan = freeze({ ...description, planFingerprint: hash({ ...description, sourceIdentity: identity, outputId: options.outputId.toLowerCase(),
      policyIdentity: this.#policyIdentity, route, epoch }) });
    this.#plans.set(plan, { epoch, request, identity: freeze(identity), sourceProbeFingerprint, route, facts, validator, innerPlan,
      assessment: options.assessment, input: options.input, outputId: options.outputId.toLowerCase(), invocationOutput: null, selected: false });
    this.#outputIds.add(outputId); this.#latest.set(request.fileId, plan); return plan;
  }
  #bindings(options) {
    record(options, BINDINGS); const state = this.#current(options.plan);
    need(options.settings === null && options.environment === null && options.runtimeIdentity === this.#runtime
      && options.sourceProbeFingerprint === state.sourceProbeFingerprint && isDeepStrictEqual(sourceIdentity(options.sourceIdentity), state.identity),
    'Prepared source, probe, runtime and null Remux encoder settings/environment must remain current.');
    record(options.budget, Object.keys(BUDGET)); need(isDeepStrictEqual(options.budget, BUDGET) && options.executionBudgetMs === EXECUTION_MS,
      'The exact complete Remux evidence and active execution budgets are required.');
    return state;
  }
  select(options) {
    try {
      const state = this.#bindings(options), token = Object.freeze({});
      const result = freeze({ controlsRequired: true, remux: true, budget: { ...BUDGET }, executionBudgetMs: EXECUTION_MS,
        evidenceIds: state.route.evidenceIds, policyIdentity: this.#policyIdentity,
        qualification: { status: 'verified', operation: 'remux', runtimeIdentity: this.#runtime, inputFamily: state.route.inputFamily,
          target: state.route.target, cellId: state.route.id, evidenceId: state.route.evidenceIds[0], maxTimestampError: TIMING, maxChapterError: TIMING }, sourcePolicy: state.facts });
      state.selected = true; this.#selections.set(token, { epoch: this.#epoch, plan: options.plan, result }); return token;
    } catch (error) { throw new ToolError(REQUIRED, error.message); }
  }
  requireCurrent(selection, options) {
    try {
      const entry = selection && typeof selection === 'object' ? this.#selections.get(selection) : null;
      need(entry && entry.epoch === this.#epoch && options?.plan === entry.plan, 'A current genuine selection from this owner is required.');
      this.#bindings(options); return entry.result;
    } catch (error) { throw new ToolError(STALE, error.message); }
  }
  resolveInvocation(plan, options) {
    record(options, ['output']); const state = this.#current(plan), output = localPath(options.output);
    need(state.selected && !samePath(output, state.input), 'A selected genuine plan and distinct main-owned stage are required.');
    need(state.invocationOutput === null || state.invocationOutput === output, 'A prepared Remux invocation cannot be rebound to another stage.', STALE);
    state.invocationOutput = output; const args = [...plan.args]; args[args.length - 1] = output; return freeze(args);
  }
  validate(plan, outputProbe, collectorReceipt, optional = {}) {
    record(optional, ['movRepresentationReceipt', 'outputFileSha256'], []); const state = this.#current(plan);
    need(state.selected && state.invocationOutput !== null, 'Validation requires a selected plan and its bound actual invocation stage.');
    const { getCollectedRemuxEvidence } = require('./remux-evidence.cjs');
    const essence = getCollectedRemuxEvidence(collectorReceipt, { assessment: state.assessment, runtimeIdentity: this.#runtime, outputId: state.outputId });
    need(collectorReceipt.sourcePath === state.input && collectorReceipt.outputPath === state.invocationOutput
      && collectorReceipt.sourceProbeFingerprint === state.sourceProbeFingerprint
      && collectorReceipt.outputProbeFingerprint === remuxProbeFingerprint(outputProbe), 'Collected evidence belongs to another actual source, output path or probe.');
    for (const stamp of [collectorReceipt.sourceBefore, collectorReceipt.sourceAfter]) need(stamp
      && SOURCE_FIELDS.slice(1, -1).every(key => stamp[key] === state.identity[key]), 'Collected source identity differs from its prepared identity.');
    digest(essence.outputFileSha256, 'Complete owned output seal');
    need(!own(optional, 'outputFileSha256') || optional.outputFileSha256 === essence.outputFileSha256, 'The supplied output seal differs from complete collected bytes.');
    return state.validator.validate({ plan: state.innerPlan, outputProbe, essenceEvidence: essence,
      ...(own(optional, 'movRepresentationReceipt') ? { movRepresentationReceipt: optional.movRepresentationReceipt } : {}) });
  }
  invalidate() { this.#epoch++; this.#latest.clear(); }
}

module.exports = { RemuxOperations, fingerprintRemuxSourceIdentity };
