'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { getRemuxAssessmentSource } = require('./remux-contract.cjs');
const { classifyMarker, provenanceArgs, GENERATION_KEY } = require('./provenance.cjs');
const { STREAM_CREATION_TIME_ALIAS } = require('./media.cjs');
const { getMovRepresentation } = require('./mov-representation.cjs');
const { classifyRemuxMetadataTag } = require('./remux-metadata-policy.cjs');

const VERSION = 1;
const HASH = /^[a-f0-9]{64}$/;
const plans = new WeakMap();
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };
function check(condition, message, code = 'INVALID_REMUX_VALIDATION') { if (!condition) fail(code, message); }
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

// All inspection/collector receipts remain bounded inert data. Renderer copies
// cannot reconstruct private plans; getters must never execute while validating.
function dataCopy(value) {
  const seen = new WeakSet(); let nodes = 0, characters = 0;
  function copy(entry, depth) {
    check(++nodes <= 65536 && depth <= 18, 'Remux evidence exceeds its structural bound.');
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)) return entry;
    if (typeof entry === 'string') {
      characters += entry.length;
      check(entry.length <= 16384 && characters <= 4 * 1024 * 1024 && !entry.includes('\0'), 'Remux evidence exceeds its text bound.');
      return entry;
    }
    check(entry && typeof entry === 'object' && (Array.isArray(entry) || plain(entry)) && !seen.has(entry), 'Remux evidence must be acyclic plain data.');
    seen.add(entry); const result = Array.isArray(entry) ? [] : {};
    if (Array.isArray(entry)) check(entry.length <= 16384, 'Remux evidence collection is excessive.');
    for (const key of Reflect.ownKeys(entry)) {
      if (Array.isArray(entry) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      check(typeof key === 'string' && descriptor?.enumerable && own(descriptor, 'value')
        && (!Array.isArray(entry) || /^(0|[1-9]\d*)$/.test(key)), 'Remux evidence contains unsupported properties.');
      characters += key.length;
      check(key.length <= 256 && characters <= 4 * 1024 * 1024, 'Remux evidence keys exceed their bound.');
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    seen.delete(entry); return result;
  }
  return copy(value, 0);
}
function record(value, fields, label, required = fields) {
  check(plain(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && fields.includes(key)
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable && own(Object.getOwnPropertyDescriptor(value, key), 'value'))
    && required.every(key => own(value, key)), `${label} has an invalid schema.`);
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function remuxProbeFingerprint(probe) { return hash(normalizeProbe(dataCopy(probe))); }
function rational(value, label, nonnegative = false) {
  record(value, ['numerator', 'denominator'], label);
  check(typeof value.numerator === 'string' && /^-?\d{1,40}$/.test(value.numerator)
    && typeof value.denominator === 'string' && /^[1-9]\d{0,39}$/.test(value.denominator), `${label} must contain exact rational strings.`);
  const result = { n: BigInt(value.numerator), d: BigInt(value.denominator) };
  check(!nonnegative || result.n >= 0n, `${label} must not be negative.`); return result;
}
const greater = (left, right) => left.n * right.d > right.n * left.d;
const difference = (left, right) => ({ n: left.n * right.d - right.n * left.d, d: left.d * right.d });
const absolute = value => ({ n: value.n < 0n ? -value.n : value.n, d: value.d });
function count(value, label, allowZero = true) {
  check(typeof value === 'string' && /^\d{1,20}$/.test(value) && BigInt(value) <= 9223372036854775807n
    && (allowZero || BigInt(value) > 0n), `${label} must be a bounded exact count.`); return BigInt(value);
}
function decimal(value) {
  const match = /^(-?)(\d{1,20})(?:\.(\d{1,12}))?$/.exec(String(value));
  if (!match) return null;
  const d = 10n ** BigInt((match[3] || '').length);
  return { n: (BigInt(match[2]) * d + BigInt(match[3] || '0')) * (match[1] ? -1n : 1n), d };
}
function ticks(value, base) {
  const match = /^([1-9]\d{0,19})\/([1-9]\d{0,19})$/.exec(String(base));
  if (!match || !/^-?\d{1,20}$/.test(String(value))) return null;
  return { n: BigInt(value) * BigInt(match[1]), d: BigInt(match[2]) };
}
function timeOf(value, field) { return ticks(value[field], value.time_base) || decimal(value[`${field}_time`]); }
function tagMap(tags = {}) {
  const result = new Map();
  for (const [key, value] of Object.entries(tags)) {
    const folded = key.toLowerCase();
    check(!result.has(folded), 'Output metadata has ambiguous case-folded keys.');
    result.set(folded, String(value));
  }
  return result;
}
// Date.parse alone discards sub-millisecond precision. Accept only an exact text
// match or a fully specified ISO instant with the same fractional nanoseconds.
function instant(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const base = Date.parse(match[1] + match[3]);
  return Number.isFinite(base) ? BigInt(base) * 1000000n + BigInt((match[2] || '').padEnd(9, '0')) : null;
}
function tagsMatch(contract, actualTags, label, errors, warnings, { movRepresentation, outputIndex, outputId } = {}) {
  const actual = tagMap(actualTags);
  for (const [key, value] of [...Object.entries(contract.preserved), ...Object.entries(contract.attempted)]) {
    const name = key.toLowerCase(), expected = String(value);
    // The generated creation-time alias is the same descriptive copy attempt,
    // not another preservation failure when that exact source alias also exists.
    if (name === STREAM_CREATION_TIME_ALIAS.toLowerCase() && contract.creationAlias !== null) continue;
    const representation = contract.representations.find(item => item.key === key);
    const received = actual.get(name);
    let matches = received === expected;
    if (representation?.equivalence === 'exact-source-text-track-alias') {
      // The actual builder writes the alias even if native creation_time survives.
      matches = actual.get(String(representation.outputKey || STREAM_CREATION_TIME_ALIAS).toLowerCase()) === expected
        && (received === undefined || received === expected || instant(received) !== null && instant(received) === instant(expected));
    } else if (representation?.equivalence === 'undefined-track-language-may-be-omitted-by-ffprobe' && received === undefined) matches = true;
    else if (representation?.equivalence === 'owned-mov-mdhd-unspecified-language' && received === undefined) {
      matches = expected === 'und' && movRepresentation?.tracks.find(track => track.outputIndex === outputIndex)?.languageCode === 32767;
    } else if (representation?.equivalence === 'native-isobmff-track-name') {
      matches = actual.get(representation.outputKey) === expected && (received === undefined || received === expected);
    }
    else if (representation?.equivalence === 'same-UTC-instant-or-exact-source-text' && received !== undefined) {
      const before = instant(expected), after = instant(received); matches ||= before !== null && before === after;
    }
    if (!matches) {
      const classification = contract.classifications.find(item => item.key === key);
      if (classification?.mismatch === 'warning') warnings.push({ code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE',
        message: `${label}: descriptive metadata '${key}' is missing or changed in its requested representation.`,
        key, scope: contract.scope, location: label, policy: contract.policy.id, policyVersion: contract.policy.version });
      else errors.push(`${label}: metadata '${key}' was not preserved in its declared representation.`);
    }
  }
  const sourceKeys = new Set([...Object.keys(contract.preserved), ...Object.keys(contract.attempted),
    ...contract.replacements.map(item => item.key)].map(key => key.toLowerCase()));
  for (const [key, value] of actual) {
    if (sourceKeys.has(key)) continue;
    const classification = classifyRemuxMetadataTag(key, { scope: contract.scope });
    if (classification.preservation !== 'required') continue;
    const allowance = contract.allowedAdditions.find(item => item.key.toLowerCase() === key);
    const allowed = allowance?.match === 'exact' ? value === allowance.value
      : allowance?.match === 'fresh-output-id' ? typeof outputId === 'string' && value.toLowerCase() === outputId
      : allowance?.match === 'operation-derived';
    if (!allowed) errors.push(`${label}: output-only ${classification.classification} metadata '${key}' has no matching declared neutral representation.`);
  }
}
function dispositions(stream) {
  const result = [];
  for (const [key, value] of Object.entries(stream.disposition || {})) {
    check([0, 1, '0', '1'].includes(value), 'Output disposition contains an invalid value.');
    if (Number(value) === 1) result.push(key);
  }
  return result.sort();
}
function compareKnown(source, output, fields, label, errors) {
  for (const field of fields) if (source[field] !== undefined && String(source[field]) !== String(output[field])) errors.push(`${label}: ${field} changed or became unavailable.`);
}
function compareRatio(source, output, field, separator, label, errors) {
  if (source[field] === undefined) return;
  const parse = value => {
    const pieces = String(value).split(separator);
    if (pieces.length !== 2 || !pieces.every(item => /^\d{1,20}$/.test(item)) || BigInt(pieces[1]) === 0n) return null;
    return { n: BigInt(pieces[0]), d: BigInt(pieces[1]) };
  };
  const before = parse(source[field]), after = parse(output[field]);
  // Unspecified 0:1/0:0 evidence cannot impose an invented geometry/cadence.
  if (!before || before.n === 0n) return;
  if (!after || before.n * after.d !== after.n * before.d) errors.push(`${label}: ${field} changed.`);
}

function verifyQualification(receipt, policy) {
  record(receipt, ['status', 'runtimeIdentity', 'operation', 'inputFamily', 'target', 'cellId', 'evidenceId', 'requirementIds', 'maxTimestampError', 'maxChapterError'], 'Qualification receipt');
  check(receipt.status === 'verified' && ['runtimeIdentity', 'operation', 'inputFamily', 'target', 'cellId'].every(key => receipt[key] === policy[key]), 'Exact runtime/operation/container/cell qualification is required.', 'REMUX_QUALIFICATION_REQUIRED');
  check(typeof receipt.evidenceId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(receipt.evidenceId), 'Qualification needs a durable evidence ID.', 'REMUX_QUALIFICATION_REQUIRED');
  check(Array.isArray(receipt.requirementIds) && receipt.requirementIds.length <= 8192 && receipt.requirementIds.every(id => typeof id === 'string')
    && new Set(receipt.requirementIds).size === receipt.requirementIds.length && policy.requirementIds.every(id => receipt.requirementIds.includes(id)), 'Every assessment requirement needs actual qualification.', 'REMUX_QUALIFICATION_REQUIRED');
  const timestamp = rational(receipt.maxTimestampError, 'Qualified timestamp error', true);
  const chapter = rational(receipt.maxChapterError, 'Qualified chapter error', true);
  check(!greater(timestamp, { n: 1n, d: 1n }) && !greater(chapter, { n: 1n, d: 1n }), 'Qualification timing bounds exceed the structural maximum.', 'REMUX_QUALIFICATION_REQUIRED');
  return { timestamp, chapter };
}

function verifyDecode(recordValue, type, label) {
  const fields = ['complete', 'exitCode', 'stderrComplete', 'errors', 'representation', 'contentSha256', 'metadataSha256', 'unitCount', 'firstPts', 'endPts'];
  record(recordValue, [...fields, 'cadence'], label, fields);
  check(recordValue.complete === true && recordValue.exitCode === 0 && recordValue.stderrComplete === true
    && Array.isArray(recordValue.errors) && recordValue.errors.length === 0, `${label}: complete successful decoder/semantic evidence is required.`);
  const representation = { video: 'native-video-v1', audio: 'native-audio-v1', subtitle: 'subtitle-events-v1', attachment: 'attachment-extradata-v1' }[type];
  check(representation && recordValue.representation === representation && HASH.test(recordValue.contentSha256) && HASH.test(recordValue.metadataSha256), `${label}: qualified native essence and meaningful metadata hashes are required.`);
  const units = count(recordValue.unitCount, `${label} unit count`, type === 'subtitle');
  let cadence = null;
  if (own(recordValue, 'cadence')) {
    check(type === 'video', `${label}: only complete video evidence can describe cadence.`);
    cadence = verifyCadence(recordValue.cadence, units, label);
  }
  if (type === 'attachment') {
    check(units === 1n && recordValue.firstPts === null && recordValue.endPts === null, `${label}: attachment evidence must describe exactly one complete payload.`);
    return { units, first: null, end: null };
  }
  if (units === 0n) {
    check(recordValue.firstPts === null && recordValue.endPts === null, `${label}: empty streams must not invent timestamps.`); return { units, first: null, end: null };
  }
  const first = rational(recordValue.firstPts, `${label} first PTS`), end = rational(recordValue.endPts, `${label} end PTS`);
  check(greater(end, first), `${label}: decoded timeline must have positive extent.`);
  return { units, first, end, cadence };
}

function verifyCadence(value, units, label) {
  record(value, ['version', 'classification', 'intervalCount', 'firstStep', 'differingStep'], `${label} cadence`);
  check(value.version === 1 && ['constant', 'variable', 'insufficient'].includes(value.classification)
    && count(value.intervalCount, `${label} cadence interval count`) === units - 1n, `${label}: cadence does not cover every decoded interval.`);
  if (units === 1n) {
    check(value.classification === 'insufficient' && value.firstStep === null && value.differingStep === null, `${label}: one frame cannot establish cadence.`);
    return 'insufficient';
  }
  const first = rational(value.firstStep, `${label} cadence first step`);
  check(first.n > 0n, `${label}: cadence steps must be positive.`);
  if (value.classification === 'constant') check(value.differingStep === null, `${label}: constant cadence cannot contain a variable witness.`);
  else {
    check(value.classification === 'variable' && units >= 3n, `${label}: variable cadence needs at least two observed intervals.`);
    const different = rational(value.differingStep, `${label} cadence differing step`);
    check(different.n > 0n && difference(first, different).n !== 0n, `${label}: variable cadence needs mathematically different positive steps.`);
  }
  return value.classification;
}
function positiveRate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}\/[1-9]\d{0,19}$/.test(value)) return null;
  const [n, d] = value.split('/'); return { n: BigInt(n), d: BigInt(d) };
}

/**
 * Main-only registry integration. requireQualification must validate measured
 * cells against the actual assessment, not echo policy or consult codec names.
 * No default registry exists. Receipts are descriptive input from that trusted
 * function; serialized renderer values never create assessment/plan authority.
 * Essence collectors must cover the full stream, normalize native decoded data
 * without scaling/color conversion and hash meaningful per-unit side metadata.
 * This pure validator cannot attest that an arbitrary JSON receipt came from a
 * decoder; the main-owned collector and registry establish that provenance.
 */
function createRemuxValidator({ requireQualification } = {}) {
  check(typeof requireQualification === 'function', 'A trusted main-owned qualification registry is required.', 'REMUX_QUALIFICATION_REQUIRED');
  const owner = {};
  function assessmentContext(options) {
    const { assessment, runtimeIdentity, cellId, outputId } = options;
    const source = getRemuxAssessmentSource(assessment); // WeakMap brand; clone/blocked requests fail.
    check(typeof runtimeIdentity === 'string' && HASH.test(runtimeIdentity) && typeof cellId === 'string'
      && /^[A-Za-z0-9._:-]{1,128}$/.test(cellId), 'Exact verified runtime identity and cell ID are required.');
    provenanceArgs(outputId); // Reuse canonical output-ID validation.
    check(assessment.sourceAdmission.marker.outputId !== outputId.toLowerCase(), 'Remux must receive a fresh output ID.');
    check(assessment.expectedOutput.streams.every(stream => ['video', 'audio', 'subtitle', 'attachment'].includes(stream.codecType))
      && source.streams.every(stream => stream.codec_type !== 'data') && !(source.stream_groups || []).length,
    'Timed data/timecode and related-track remux remain unqualified.', 'REMUX_RELATIONSHIP_UNQUALIFIED');
    check(!assessment.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired, 'MOV-family chapter carriers need a separately qualified explicit expected-stream contract.', 'REMUX_AUXILIARY_UNQUALIFIED');
    return { assessment, source, runtimeIdentity, cellId, outputId };
  }
  function prepare(options) {
    record(options, ['assessment', 'runtimeIdentity', 'cellId', 'outputId'], 'Remux validation preparation');
    const { assessment, source, runtimeIdentity, cellId, outputId } = assessmentContext(options);
    const policy = freeze({ runtimeIdentity, operation: 'remux', inputFamily: assessment.inputFamily, target: assessment.target, cellId,
      requirementIds: [...new Set(assessment.qualifications.map(item => item.id))], assessment });
    const receipt = dataCopy(requireQualification(policy));
    const tolerance = verifyQualification(receipt, policy);
    const plan = freeze({ version: VERSION, operation: 'remux', runtimeIdentity, cellId, target: assessment.target,
      outputId: outputId.toLowerCase(), sourceFingerprint: assessment.sourceFingerprint, sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint,
      qualificationEvidenceId: receipt.evidenceId });
    plans.set(plan, { owner, assessment, source, tolerance }); return plan;
  }
  function validate(options) {
    record(options, ['plan', 'outputProbe', 'essenceEvidence', 'movRepresentationReceipt'], 'Remux output validation', ['plan', 'outputProbe', 'essenceEvidence']);
    const context = plans.get(options.plan);
    check(context?.owner === owner, 'A genuine prepared validation plan from this registry is required.', 'REMUX_VALIDATION_PLAN_REQUIRED');
    const errors = [], warnings = [], { assessment, source, tolerance } = context, { plan } = options;
    let output;
    try {
      output = normalizeProbe(dataCopy(options.outputProbe));
      const evidence = dataCopy(options.essenceEvidence);
      const evidenceFields = ['version', 'runtimeIdentity', 'sourceFingerprint', 'sourceEvidenceFingerprint', 'outputId', 'outputEvidenceFingerprint', 'complete', 'streams'];
      record(evidence, [...evidenceFields, 'outputFileSha256'], 'Complete remux essence evidence', evidenceFields);
      check(evidence.version === VERSION && evidence.complete === true && ['runtimeIdentity', 'sourceFingerprint', 'sourceEvidenceFingerprint', 'outputId'].every(key => evidence[key] === plan[key])
        && evidence.outputEvidenceFingerprint === hash(output) && (!own(evidence, 'outputFileSha256') || HASH.test(evidence.outputFileSha256)),
      'Decoded evidence is incomplete or belongs to another runtime/source/output.');
      let movRepresentation = null;
      if (options.movRepresentationReceipt !== undefined) {
        check(plan.target === 'mov', 'A MOV representation cannot qualify another target.');
        movRepresentation = getMovRepresentation(options.movRepresentationReceipt, { outputId: plan.outputId,
          outputEvidenceFingerprint: evidence.outputEvidenceFingerprint, outputSha256: evidence.outputFileSha256 });
      }
      const expected = assessment.expectedOutput, names = String(output.format.format_name || '').split(',');
      check(plan.target === 'matroska' ? names.includes('matroska') : names.includes('mov'), 'Output container does not match its qualified target.');
      // ffprobe shares the same format_name for MP4 and MOV. The exact target is
      // bound to the prepared builder/qualified muxer, never inferred from that
      // shared name or a filename alone.
      check(output.mediaEvidence.container.relationships.state === 'known' && output.programs.length === 0 && output.stream_groups.length === 0, 'Unexpected or unknown output track relationships.');
      if (output.streams.length !== expected.streams.length) errors.push('Stream count differs from the exact admitted map.');
      const actual = new Map(output.streams.map(stream => [stream.index, stream]));
      const originals = new Map(source.streams.map(stream => [stream.index, stream]));
      for (const stream of expected.streams) {
        const after = actual.get(stream.outputIndex), before = originals.get(stream.inputIndex), label = `Stream ${stream.inputIndex} → ${stream.outputIndex}`;
        if (!after) { errors.push(`${label}: mapped stream is missing.`); continue; }
        if (after.codec_type !== stream.codecType || after.codec_name !== stream.codecName) errors.push(`${label}: copied stream type or codec changed.`);
        if (!isDeepStrictEqual(dispositions(after), stream.disposition)) errors.push(`${label}: dispositions changed.`);
        tagsMatch(stream.metadata, after.tags, label, errors, warnings, { movRepresentation, outputIndex: stream.outputIndex });
        compareKnown(before, after, ['profile', 'level'], label, errors);
        if (stream.codecType === 'video') {
          compareKnown(before, after, ['width', 'height', 'pix_fmt', 'bits_per_raw_sample', 'field_order', 'color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location'], label, errors);
          for (const field of ['coded_width', 'coded_height']) if (Number(before[field]) > 0) compareKnown(before, after, [field], label, errors);
          compareRatio(before, after, 'sample_aspect_ratio', ':', label, errors);
          compareRatio(before, after, 'display_aspect_ratio', ':', label, errors);
          // Complete decoded cadence below decides whether a different valid
          // VFR average is a representation difference. Tag equality alone
          // does not prove a constant frame grid.
        } else if (stream.codecType === 'audio') {
          compareKnown(before, after, ['sample_fmt', 'sample_rate', 'channels', 'channel_layout', 'bits_per_sample', 'bits_per_raw_sample'], label, errors);
        } else if (stream.codecType === 'attachment') {
          if (String(after.extradata_hash || '').toLowerCase() !== String(stream.attachment.extradataHash).toLowerCase()) errors.push(`${label}: attachment content hash changed or is missing.`);
          compareKnown(before, after, ['extradata_size'], label, errors);
        }
        if (!isDeepStrictEqual(before.side_data_list || [], after.side_data_list || [])) errors.push(`${label}: meaningful side-data representation changed or is missing.`);
      }
      tagsMatch(expected.metadata, output.format.tags, 'Container', errors, warnings, { outputId: plan.outputId });
      if (output.chapters.length !== expected.chapters.length) errors.push('Chapter count changed.');
      expected.chapters.forEach((chapter, index) => {
        const after = output.chapters[index]; if (!after) return;
        for (const field of ['start', 'end']) {
          const beforeTime = timeOf(chapter.timeline, field), afterTime = timeOf(after, field);
          if (!beforeTime || !afterTime || greater(absolute(difference(beforeTime, afterTime)), tolerance.chapter)) errors.push(`Chapter ${index}: ${field} timing changed or is unavailable.`);
          for (const entry of [chapter.timeline, after]) {
            const exact = ticks(entry[field], entry.time_base), presented = decimal(entry[`${field}_time`]);
            if (exact && entry[`${field}_time`] !== undefined && (!presented || greater(absolute(difference(exact, presented)), tolerance.chapter))) errors.push(`Chapter ${index}: ${field} ticks and reported seconds contradict each other.`);
          }
        }
        tagsMatch(chapter.metadata, after.tags, `Chapter ${index}`, errors, warnings);
      });
      const marker = classifyMarker(output);
      if (marker.kind !== 'generated' || marker.outputId !== plan.outputId) errors.push('Fresh normal application provenance did not round-trip.');
      if (Object.keys(output.format.tags || {}).some(key => key.toUpperCase() === GENERATION_KEY)) errors.push('Prior encode settings must not describe the newly remuxed generation.');
      check(Array.isArray(evidence.streams) && evidence.streams.length === expected.streams.length, 'Complete decoded evidence must cover every admitted stream.');
      const seen = new Set();
      for (const item of evidence.streams) {
        record(item, ['inputIndex', 'outputIndex', 'codecType', 'source', 'output', 'timestamps'], 'Stream essence evidence');
        const stream = expected.streams.find(candidate => candidate.inputIndex === item.inputIndex && candidate.outputIndex === item.outputIndex && candidate.codecType === item.codecType);
        check(stream && !seen.has(item.outputIndex), 'Stream essence evidence is duplicated, unmapped or has changed type.'); seen.add(item.outputIndex);
        const label = `Stream ${item.inputIndex} → ${item.outputIndex}`;
        const before = verifyDecode(item.source, item.codecType, `${label} source`), after = verifyDecode(item.output, item.codecType, `${label} output`);
        if (item.codecType === 'video') {
          const original = originals.get(item.inputIndex), actualVideo = actual.get(item.outputIndex);
          const avg = original.avg_frame_rate, nominal = original.r_frame_rate;
          if (avg && nominal && avg === nominal) {
            const a = positiveRate(avg), b = positiveRate(actualVideo?.avg_frame_rate);
            if (before.cadence === 'variable' && after.cadence === 'variable' && a && b) {
              if (difference(a, b).n !== 0n) warnings.push(`${label}: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.`);
            } else compareRatio(original, actualVideo || {}, 'avg_frame_rate', '/', label, errors);
          }
        }
        if (item.source.contentSha256 !== item.output.contentSha256 || item.source.metadataSha256 !== item.output.metadataSha256 || before.units !== after.units) errors.push(`${label}: complete native essence, meaningful per-unit metadata or unit count changed.`);
        if (item.codecType === 'attachment') { check(item.timestamps === null, 'Attachments cannot invent a packet timeline.'); continue; }
        record(item.timestamps, ['complete', 'comparedUnits', 'maxPtsError', 'maxDurationError'], 'Complete timestamp comparison');
        check(item.timestamps.complete === true && count(item.timestamps.comparedUnits, 'Compared units') === before.units, `${label}: per-unit timestamp comparison is incomplete.`);
        for (const field of ['maxPtsError', 'maxDurationError']) if (greater(rational(item.timestamps[field], `${label} ${field}`, true), tolerance.timestamp)) errors.push(`${label}: ${field} exceeds its measured cell tolerance.`);
        if (before.first && after.first) {
          if (greater(absolute(difference(before.first, after.first)), tolerance.timestamp) || greater(absolute(difference(before.end, after.end)), tolerance.timestamp)) errors.push(`${label}: complete interval or source A/V offset changed.`);
        }
      }
    } catch (error) { errors.push(error.message || 'Remux validation failed.'); }
    return freeze({ valid: errors.length === 0, errors, warnings, version: VERSION, operation: 'remux', target: plan.target,
      qualificationEvidenceId: plan.qualificationEvidenceId,
      contentClaim: 'Complete qualified native essence and declared semantic preservation; container and framed packet bytes may differ.' });
  }
  function validateMediaQualification(options) {
    const fields = ['assessment', 'runtimeIdentity', 'cellId', 'outputId', 'outputProbe', 'essenceEvidence', 'maxTimestampError', 'maxChapterError'];
    record(options, [...fields, 'movRepresentationReceipt'], 'Remux media-only qualification', fields);
    const { assessment, source, runtimeIdentity, cellId, outputId } = assessmentContext(options);
    const timestamp = rational(options.maxTimestampError, 'Qualification timestamp ceiling', true);
    const chapter = rational(options.maxChapterError, 'Qualification chapter ceiling', true);
    check(!greater(timestamp, { n: 1n, d: 1n }) && !greater(chapter, { n: 1n, d: 1n }),
      'Media qualification ceilings exceed the structural maximum.');
    // Native qualification must be able to exercise these exact media checks
    // before the separate application lifecycle/rescan gates have passed. The
    // private temporary plan is never returned, and this result is deliberately
    // not a registry receipt or reusable PreparedPlan execution authority.
    const plan = freeze({ version: VERSION, operation: 'remux', runtimeIdentity, cellId, target: assessment.target,
      outputId: outputId.toLowerCase(), sourceFingerprint: assessment.sourceFingerprint,
      sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint, qualificationEvidenceId: `media-only:${cellId}` });
    plans.set(plan, { owner, assessment, source, tolerance: { timestamp, chapter } });
    const result = validate({ plan, outputProbe: options.outputProbe, essenceEvidence: options.essenceEvidence,
      ...(options.movRepresentationReceipt !== undefined ? { movRepresentationReceipt: options.movRepresentationReceipt } : {}) });
    const requirements = [...new Set(assessment.qualifications.map(item => item.id))];
    // Name the checks this validator actually performs. Unknown/new contract
    // requirements and muxer/framing qualification cannot acquire a "passed"
    // label merely because they appeared in assessment.qualifications.
    const mediaRequirement = id => /^(?:codec:|dispositions:|track-tags:|side-data:)/.test(id)
      || ['media-content-and-timeline', 'chapters-and-container-tags'].includes(id);
    const missingQualificationIds = result.valid ? requirements.filter(id => !mediaRequirement(id)) : requirements;
    return freeze({ ...result, status: result.valid ? 'media-validation-passed' : 'media-validation-failed',
      scope: 'main-owned-native-qualification-only', executionReady: false, cellId, runtimeIdentity,
      mediaChecks: requirements.filter(mediaRequirement).map(id => ({ id,
        status: result.valid ? 'passed-for-this-fixture' : 'not-qualified' })), missingQualificationIds,
      limitations: ['No support registry is changed or inferred.',
        'Normal provenance marker round-trip is checked; subsequent application rescan and source admission are not.',
        'No-overwrite publication, cancellation, retained outputs, cleanup and application/package acceptance remain separate gates.',
        'An empty chapter/subtitle/attachment set does not qualify nonempty cases.'] });
  }
  return Object.freeze({ prepare, validate, validateMediaQualification });
}

function validateRemuxMediaQualification(options) {
  return createRemuxValidator({ requireQualification() {
    fail('REMUX_QUALIFICATION_REQUIRED', 'Media-only evidence cannot grant production qualification.');
  } }).validateMediaQualification(options);
}

module.exports = { REMUX_VALIDATION_VERSION: VERSION, createRemuxValidator, remuxProbeFingerprint, validateRemuxMediaQualification };
