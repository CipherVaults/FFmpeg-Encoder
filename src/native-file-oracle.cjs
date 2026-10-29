'use strict';
const { createHash } = require('node:crypto'), path = require('node:path');
const { parseProbeJson } = require('./inspection.cjs');
const { classifyMarker, generationDescriptionOf, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('./provenance.cjs');
const { isNativeFileTemplate } = require('./native-file-template.cjs');
const { isNativeFileCommand } = require('./native-file-command.cjs');

// Exact-reference oracle for the finite native-file-h264-bt709-full-v1 contract.
//
// The current job is accepted only as an exact member of one independently
// qualified reference: each side's complete decoded raw hash, complete
// functional metadata, complete rational timeline and the output's complete
// Matroska byte template must equal the reference row. No quality score,
// timing tolerance or caller boolean can substitute for a missing match.
// Pure module: no IO, no child processes. The runtime owner supplies only its
// own session's role results, after checking their original receipts.
const REFERENCE_VERSION = 1, CONTRACT_ID = 'native-file-h264-bt709-full-v1';
const FRAME_BYTES = 1280 * 720 * 3 / 2, MAX_METADATA_TEXT = 64 * 1024 ** 2;
const HEX = /^[a-f0-9]{64}$/, TOKEN = /^[a-zA-Z0-9_.:-]{1,128}$/;
const ROLES = ['source-metadata', 'output-metadata', 'source-raw', 'output-raw'];
const PROBE_KEYS = ['programs', 'stream_groups', 'streams', 'chapters', 'format', 'frames'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code: 'NATIVE_ORACLE_' + code }); };
const sha = text => createHash('sha256').update(text).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Trusted rows are still checked as inert data: exact keys, own enumerable data
// properties only (no getters/proxies), so a policy row cannot execute code.
function record(value, keys, label) {
  if (!plain(value)) fail('REFERENCE', `${label} must be a plain object.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail('REFERENCE', `${label} has unexpected or missing fields.`);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('REFERENCE', `${label}.${key} must be plain data.`); }
  return value;
}
const digest = (value, label) => { if (typeof value !== 'string' || !HEX.test(value)) fail('REFERENCE', `${label} must be a lowercase SHA-256.`); return value; };

function validateNativeFileReference(value) {
  record(value, ['version', 'id', 'contractId', 'frames', 'source', 'output', 'proof'], 'Native file reference');
  if (value.version !== REFERENCE_VERSION || value.contractId !== CONTRACT_ID || typeof value.id !== 'string' || !TOKEN.test(value.id)) fail('REFERENCE', 'Unsupported native file reference version/contract/id.');
  if (!Number.isSafeInteger(value.frames) || value.frames < 15 || value.frames > 900) fail('REFERENCE', 'Reference frame count must be the finite contract range 15..900.');
  record(value.source, ['fileSha256', 'rawSha256', 'metadataSha256', 'timelineSha256'], 'reference.source');
  record(value.output, ['rawSha256', 'metadataSha256', 'timelineSha256', 'templateSha256', 'templateManifestSha256', 'templateBytes'], 'reference.output');
  record(value.proof, ['evidenceIds', 'reportSha256'], 'reference.proof');
  for (const side of ['source', 'output']) for (const [key, field] of Object.entries(value[side])) if (key !== 'templateBytes') digest(field, `reference.${side}.${key}`);
  if (!Number.isSafeInteger(value.output.templateBytes) || value.output.templateBytes < 1 || value.output.templateBytes > 128 * 1024 ** 2) fail('REFERENCE', 'Reference template length is outside the finite dialect.');
  const ids = value.proof.evidenceIds;
  if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype || ids.length < 1 || ids.length > 16 || Reflect.ownKeys(ids).length !== ids.length + 1
      || ids.some((id, i) => !Object.getOwnPropertyDescriptor(ids, String(i))?.enumerable || typeof id !== 'string' || !TOKEN.test(id))) fail('REFERENCE', 'Reference proof needs explicit evidence identifiers.');
  digest(value.proof.reportSha256, 'reference.proof.reportSha256');
  return freeze(structuredClone(value));
}

// Deterministic canonical JSON: object keys sorted at every level. Values are
// the duplicate-safe parsed probe values, so no field is summarized or rounded.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const STRUCTURE = { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1',
  color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709', field_order: 'progressive' };

function probeRecord(text, { role, contract, command }) {
  if (typeof text !== 'string' || !text.length || Buffer.byteLength(text) > MAX_METADATA_TEXT) fail('METADATA', `${role} metadata text is missing or exceeds its bound.`);
  let probe;
  try { probe = parseProbeJson(text, `Native ${role}`); } catch (error) { fail('METADATA', `${role} metadata is not one duplicate-free JSON document (${error.code || 'parse'}).`); }
  if (!plain(probe) || PROBE_KEYS.some(key => !Object.hasOwn(probe, key)) || Object.keys(probe).some(key => !PROBE_KEYS.includes(key))) fail('METADATA', `${role} metadata lacks the complete fixed probe sections.`);
  if (!['programs', 'stream_groups', 'chapters'].every(key => Array.isArray(probe[key]) && !probe[key].length)) fail('STRUCTURE', `${role} must have no programs, stream groups or chapters.`);
  if (!Array.isArray(probe.streams) || probe.streams.length !== 1 || !plain(probe.streams[0]) || !plain(probe.format) || !Array.isArray(probe.frames)) fail('STRUCTURE', `${role} must report exactly one stream.`);
  const stream = probe.streams[0], index = role === 'output-metadata' ? contract.expectedOutput.videoIndex : contract.expectedOutput.sourceVideoIndex;
  if (stream.index !== index) fail('STRUCTURE', `${role} reports an unexpected stream index.`);
  for (const [key, expected] of Object.entries(STRUCTURE)) if (stream[key] !== expected) fail('STRUCTURE', `${role} stream ${key} is not the finite contract value.`);
  if (role === 'output-metadata' && !/^matroska(,webm)?$/.test(String(probe.format.format_name))) fail('STRUCTURE', 'Output container is not Matroska.');

  const frames = Number(contract.expectedOutput.declaredFrames);
  if (probe.frames.length !== frames) fail('TIMELINE', `${role} reports ${probe.frames.length} frames; the contract declares ${frames}.`);
  let previous = null;
  const timeline = probe.frames.map((frame, ordinal) => {
    if (!plain(frame) || frame.media_type !== 'video' || frame.stream_index !== index) fail('TIMELINE', `${role} frame ${ordinal} is not a frame of the contracted stream.`);
    if (frame.width !== 1280 || frame.height !== 720 || frame.pix_fmt !== 'yuv420p') fail('STRUCTURE', `${role} frame ${ordinal} changes geometry or pixel format.`);
    const duration = Object.hasOwn(frame, 'duration') ? frame.duration : frame.pkt_duration;
    if (!Number.isSafeInteger(frame.pts) || !Number.isSafeInteger(duration) || duration <= 0 || (previous !== null && frame.pts <= previous)) fail('TIMELINE', `${role} frame ${ordinal} lacks an exact increasing timestamp and positive duration.`);
    previous = frame.pts;
    return [frame.pts, frame.pkt_dts ?? null, frame.best_effort_timestamp ?? null, duration];
  });

  // Provenance: the source must stay unmarked; the output must carry exactly
  // this command's fresh UUID and canonical native-v2 description. Only those
  // already-validated dynamic values are replaced before hashing.
  const marker = classifyMarker(probe), tags = probe.format.tags;
  const canonical = structuredClone(probe);
  delete canonical.format.filename;
  if (role === 'source-metadata') {
    if (marker.kind !== 'unmarked') fail('PROVENANCE', 'The complete source probe is no longer an unmarked original.');
  } else {
    const expected = generationDescriptionOf(command.generationDescription);
    if (marker.kind !== 'generated' || marker.outputId !== command.outputId || marker.descriptionNotice || !expected
        || stable(marker.previousGeneration) !== stable(expected) || !plain(tags) || tags[MARKER_KEY] !== '1'
        || tags[OUTPUT_ID_KEY] !== command.outputId || tags[GENERATION_KEY] !== JSON.stringify(expected)) fail('PROVENANCE', 'The output does not carry exactly this command\'s fresh provenance.');
    canonical.format.tags[OUTPUT_ID_KEY] = '<validated-current-output-id>';
    canonical.format.tags[GENERATION_KEY] = '<validated-current-native-v2-description>';
  }
  const sideData = [...new Set(probe.frames.flatMap(frame => Array.isArray(frame.side_data_list) ? frame.side_data_list.map(s => String(s?.side_data_type)) : []))].sort();
  return { frames, timelineSha256: sha(stable({ timeBase: stream.time_base, frames: timeline })), metadataSha256: sha(stable(canonical)), formatSize: probe.format.size, sideData };
}

// Joins every owned role, the template observation and the reference. Returns
// a frozen check report; it grants nothing by itself. The runtime owner binds
// it into its own one-use private receipt.
function joinNativeFileOracle({ reference, contract, command, sourceSha256, roles, template }) {
  const ref = validateNativeFileReference(reference);
  if (!isNativeFileCommand(command)) fail('COMMAND', 'The original main-built native command is required.');
  if (command.contractId !== contract?.id || command.sourceProbeFingerprint !== contract.sourceProbeFingerprint || stable(command.expectedOutput) !== stable(contract.expectedOutput))
    fail('COMMAND', 'The command was not built from this contract.');
  if (contract?.id !== ref.contractId || Number(contract.expectedOutput?.declaredFrames) !== ref.frames) fail('REFERENCE', 'The reference does not describe this contract and declared frame count.');
  if (sourceSha256 !== ref.source.fileSha256) fail('SOURCE', 'The complete held source is not the qualified reference source.');
  if (!plain(roles) || ROLES.some(role => !roles[role] || roles[role].kind !== role || roles[role].evidenceComplete !== true)) fail('EVIDENCE', 'All four complete evidence roles are required.');
  const checks = [];
  for (const side of ['source', 'output']) {
    const raw = roles[`${side}-raw`], expectedBytes = ref.frames * FRAME_BYTES;
    if (raw.bytes !== expectedBytes) fail('RAW', `${side} decoded bytes ${raw.bytes} differ from ${ref.frames} complete frames.`);
    if (raw.sha256 !== ref[side].rawSha256) fail('RAW', `${side} complete decoded frames differ from the qualified reference.`);
    const meta = probeRecord(roles[`${side}-metadata`].text, { role: `${side}-metadata`, contract, command });
    // The timeline is a subset of the complete metadata, so compare it first for a precise refusal.
    if (meta.timelineSha256 !== ref[side].timelineSha256) fail('TIMELINE', `${side} complete rational timeline differs from the qualified reference.`);
    if (meta.metadataSha256 !== ref[side].metadataSha256) fail('METADATA', `${side} complete functional metadata differs from the qualified reference.`);
    checks.push(`${side}-raw`, `${side}-timeline`, `${side}-metadata`);
    if (side === 'output' && meta.formatSize !== String(template?.bytes)) fail('TEMPLATE', 'Output metadata size and the observed template length disagree.');
  }
  // Only a genuine template receipt for THIS command: a stale/replayed file's
  // template would carry another UUID, argv or description.
  if (!isNativeFileTemplate(template) || template.observation !== 'file' || typeof template.file !== 'string'
      || path.win32.normalize(template.file).toLowerCase() !== path.win32.normalize(command.output).toLowerCase()
      || template.outputId !== command.outputId || template.argvSha256 !== command.argvSha256
      || template.generationSha256 !== sha(JSON.stringify(generationDescriptionOf(command.generationDescription)))) fail('TEMPLATE', 'A genuine complete template observation of this command is required.');
  if (template.bytes !== ref.output.templateBytes || template.templateSha256 !== ref.output.templateSha256 || template.manifestSha256 !== ref.output.templateManifestSha256)
    fail('TEMPLATE', 'The complete coded/container bytes differ from the qualified reference template.');
  checks.push('output-template');
  return freeze({ schema: 1, kind: 'native-file-oracle-checks', referenceId: ref.id, frames: ref.frames, outputSha256: template.sha256, checks,
    method: 'exact-qualified-reference-membership-v1', qualityCriterion: 'carried-by-reference-proof', executionAuthority: 'none' });
}

module.exports = { NATIVE_FILE_REFERENCE_VERSION: REFERENCE_VERSION, NATIVE_FILE_FRAME_BYTES: FRAME_BYTES, validateNativeFileReference, joinNativeFileOracle, nativeProbeRecord: probeRecord };
