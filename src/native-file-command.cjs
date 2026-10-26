'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { readNativeFileContract } = require('./native-file-contract.cjs');
const { nativeContribution, validateTrustedDevice } = require('./backend-adapters.cjs');
const { streamCreationTimeAlias, STREAM_CREATION_TIME_ALIAS } = require('./media.cjs');
const { generationDescriptionOf, provenanceArgs, classifyMarker, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('./provenance.cjs');

// Pure main-private command construction. No path, descriptor or returned argv
// proves a live device, held source, owned stage, file policy or execution grant.
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function record(value) {
  const keys = ['contract', 'input', 'output', 'device', 'outputId', 'generationDescription'];
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_NATIVE_FILE_COMMAND', 'Main must supply an inert command request.');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !keys.includes(key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail('INVALID_NATIVE_FILE_COMMAND', 'Unknown, missing or accessor command fields.');
}
function localPath(value, stage = false) {
  if (typeof value !== 'string' || !value.length || value.length > 32767 || /[\x00-\x1f\x7f]/.test(value)
      || !/^[a-z]:[\\/]/i.test(value) || /[:<>"|?*]/.test(value.slice(2)) || /[\\/]$/.test(value)) fail('INVALID_NATIVE_FILE_PATH', 'Source and stage must be drive-qualified local Windows file path assertions.');
  const normalized = path.win32.normalize(value), parts = normalized.slice(3).split('\\');
  if (normalized === path.win32.parse(normalized).root || parts.some(part => !part || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part))
      || stage && path.win32.extname(normalized).toLowerCase() !== '.mkv') fail('INVALID_NATIVE_FILE_PATH', 'Use ordinary file names and a Matroska .mkv stage assertion.');
}
function sameDescription(description, fragment) {
  return description?.version === 2 && description.profileId === fragment.profileId
    && description.preset === fragment.settings.preset && description.qualityMode.toLowerCase() === fragment.settings.mode
    && JSON.stringify(description.quality) === JSON.stringify(fragment.settings.quality)
    && description.bitDepth === fragment.bitDepth && description.pipelineId === fragment.pipelineId
    && JSON.stringify(description.encoderArgs) === JSON.stringify(fragment.args);
}
function buildNativeFileCommand(options) {
  record(options);
  const { contract, probe } = readNativeFileContract(options.contract), { request } = contract;
  const contribution = nativeContribution(request.profileId, request.settings, { device: options.device, bitDepth: request.bitDepth });
  const device = validateTrustedDevice(options.device, contribution.backend);
  localPath(options.input); localPath(options.output, true);
  if (path.win32.normalize(options.input).toLowerCase() === path.win32.normalize(options.output).toLowerCase()) fail('INVALID_NATIVE_FILE_PATH', 'The source and stage must be different paths.');
  const description = generationDescriptionOf(options.generationDescription);
  if (!sameDescription(description, contract.encoderContribution)) fail('NATIVE_FILE_DESCRIPTION_MISMATCH', 'The native-v2 description must match this exact requested encoder contribution.');
  const markerArgs = provenanceArgs(options.outputId, description), marker = classifyMarker(probe);
  if (marker.kind === 'suspicious') fail('NATIVE_FILE_PROVENANCE_UNSUPPORTED', marker.reason);
  const outputId = options.outputId.toLowerCase();
  if (marker.outputId === outputId) fail('NATIVE_FILE_PROVENANCE_UNSUPPORTED', 'The new generation requires a distinct output identity.');
  const video = probe.streams[0], creationTime = streamCreationTimeAlias(video);
  const argv = ['-hide_banner', '-nostdin', '-loglevel', 'level+verbose', '-nostats', '-progress', 'pipe:1', '-n', '-xerror',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', ...contribution.deviceArgs,
    '-copyts', '-noautorotate', '-i', options.input, '-map', `0:${video.index}`, '-an', '-sn', '-dn',
    '-map_metadata', '0', '-map_chapters', '0', '-map_metadata:s:0', `0:s:${video.index}`, '-disposition:0', video.disposition.default === 1 ? 'default' : '0'];
  if (creationTime !== null) argv.push('-metadata:s:0', `${STREAM_CREATION_TIME_ALIAS}=${creationTime}`);
  argv.push('-vf', contribution.uploadFilters.join(','), ...contribution.args,
    '-fps_mode:v:0', 'passthrough', '-color_range:v:0', 'tv', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-colorspace:v:0', 'bt709', '-chroma_sample_location:v:0', 'left');
  for (const key of Object.keys(probe.format.tags || {})) if ([MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY].includes(key.toUpperCase())) argv.push('-metadata', `${key}=`);
  argv.push(...markerArgs, '-avoid_negative_ts', 'disabled', '-default_mode', 'passthrough', '-f', 'matroska', options.output);
  if (argv.length > 8192 || argv.some(value => typeof value !== 'string' || value.length > 32767 || value.includes('\0'))
      || Buffer.byteLength(JSON.stringify(argv)) > 1024 * 1024) fail('NATIVE_FILE_COMMAND_LIMIT', 'The native command exceeds its bounded argument representation.');
  return freeze({ schema: 1, kind: 'native-file-command', contractId: contract.id, sourceProbeFingerprint: contract.sourceProbeFingerprint,
    profileId: request.profileId, settings: request.settings, contribution, device,
    input: options.input, output: options.output, outputId, generationDescription: description, argv,
    argvSha256: createHash('sha256').update(JSON.stringify(argv)).digest('hex'), expectedOutput: contract.expectedOutput,
    sourceAdmission: marker.kind === 'generated' ? 'current-per-file-generated-source-permission-required' : 'unmarked-source-binding-only',
    bindingAssurance: 'Main-supplied paths/device descriptor only; no live selection, complete source, runtime or stage-ownership proof.',
    outputRole: 'expected-owned-stage', status: 'unqualified', fileExecutionReady: false, executionAuthority: 'none' });
}

module.exports = { buildNativeFileCommand };
