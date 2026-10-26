'use strict';

const { createHash } = require('node:crypto');

// Pure P.A contracts. This module never discovers devices, launches a child,
// reads a path, or changes the accepted CPU/NVIDIA builder. Its profiles describe
// wrapper syntax; only a main-owned, matching native capability record can
// establish that an actual device honored the requested operation.
const POLICY_VERSION = 1;
const UPLOAD_PIPELINE = 'software-d3d11-upload-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,127}$/;
const STATES = ['discovered', 'untested', 'verified', 'unavailable', 'stale'];
const REASONS = {
  discovered: ['DISCOVERED'],
  untested: ['NOT_TESTED', 'RESOURCE_LIMIT', 'CANCELLED', 'PROBE_INTERRUPTED'],
  verified: ['VERIFIED'],
  unavailable: ['MISSING_DEVICE', 'MISSING_RUNTIME', 'UNSUPPORTED_CODEC', 'UNSUPPORTED_DEPTH', 'UNSUPPORTED_MODE',
    'UNSUPPORTED_PRESET', 'OUTPUT_MISMATCH', 'MODE_MISMATCH', 'DEVICE_MISMATCH', 'INITIALIZATION_FAILED'],
  stale: ['BINARY_CHANGED', 'DEVICE_CHANGED', 'DRIVER_CHANGED', 'RUNTIME_CHANGED', 'POLICY_CHANGED', 'IDENTITY_CHANGED'],
};
const error = (code, message) => Object.assign(new Error(message), { code });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function record(value, keys, label, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw error('INVALID_NATIVE_SETTINGS', `${label} must be a plain record.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value'))
    || keys.some(key => !optional.includes(key) && !Object.hasOwn(descriptors, key))) {
    throw error('INVALID_NATIVE_SETTINGS', `Unknown, missing or accessor fields in ${label}.`);
  }
}
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw error('INVALID_NATIVE_SETTINGS', `${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
function token(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw error('INVALID_NATIVE_SETTINGS', `Invalid ${label}.`);
  return value;
}
function opaqueId(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw error('INVALID_NATIVE_SETTINGS', `${label} must be a main-issued opaque UUID.`);
  return value;
}

const AMF_PRESETS = ['speed', 'balanced', 'quality', 'high_quality'];
const QSV_PRESETS = ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const CODECS = [
  { slug: 'h264', codec: 'H264', encodedCodec: 'h264', bitDepths: [8] },
  { slug: 'h265', codec: 'H265', encodedCodec: 'hevc', bitDepths: [8, 10] },
  { slug: 'av1', codec: 'AV1', encodedCodec: 'av1', bitDepths: [8, 10] },
];
const NATIVE_PROFILES = freeze(['amf', 'qsv'].flatMap(backend => CODECS.map(codec => {
  const qpMaximum = codec.codec === 'AV1' ? 255 : 51;
  const qpFields = backend === 'amf' && codec.codec === 'H265' ? ['i', 'p'] : ['i', 'p', 'b'];
  const defaultMode = backend === 'qsv' && codec.codec !== 'AV1' ? 'icq' : 'cqp';
  return {
    id: `${codec.slug}-${backend}`, backend, hardware: backend === 'amf' ? 'AMD AMF' : 'Intel QSV',
    codec: codec.codec, encodedCodec: codec.encodedCodec, encoder: `${codec.encodedCodec}_${backend}`,
    label: `${codec.codec} · ${backend === 'amf' ? 'AMD AMF' : 'Intel QSV'}`,
    bitDepths: [...codec.bitDepths], chroma: '4:2:0', progressive: true,
    presets: [...(backend === 'amf' ? AMF_PRESETS : QSV_PRESETS)],
    modes: {
      cqp: { label: 'CQP', kind: 'frame-quantizers', fields: qpFields, min: 0, max: qpMaximum,
        seed: codec.codec === 'AV1' ? 128 : 24 },
      ...(backend === 'amf'
        ? { qvbr: { label: 'QVBR', kind: 'quality-level', min: 0, max: 51, seed: 25 } }
        : { icq: { label: 'ICQ', kind: 'quality-level', min: 1, max: 51, seed: 25 } }),
    },
    operationalSeed: { preset: backend === 'amf' ? 'balanced' : 'medium', mode: defaultMode,
      quality: defaultMode === 'icq' ? 25 : codec.codec === 'AV1' ? 128 : 24 },
    evidenceStatus: 'hardware-unverified', testedDefault: false,
    seedNote: 'Operational starting values only. No benchmark, perceptual-equivalence or hardware-acceptance claim.',
  };
})));

function getNativeProfile(profileId) {
  const profile = NATIVE_PROFILES.find(item => item.id === profileId);
  if (!profile) throw error('INVALID_NATIVE_PROFILE', 'Choose a known AMF or QSV profile.');
  return profile;
}
function validateMode(profile, mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(profile.modes, mode)) throw error('INVALID_NATIVE_SETTINGS', 'The native rate-control mode is not offered for this backend.');
  return profile.modes[mode];
}
function validatePreset(profile, preset) {
  if (typeof preset !== 'string' || !profile.presets.includes(preset)) throw error('INVALID_NATIVE_SETTINGS', 'Choose a native preset offered by this profile.');
  return preset;
}
function validateNativeEncoderSettings(profileId, settings) {
  const profile = getNativeProfile(profileId);
  record(settings, ['preset', 'mode', 'quality'], 'native encoder settings');
  if (Object.values(Object.getOwnPropertyDescriptors(settings)).some(field => !field.enumerable)) throw error('INVALID_NATIVE_SETTINGS', 'Native encoder settings cannot contain hidden fields.');
  const preset = validatePreset(profile, settings.preset), mode = validateMode(profile, settings.mode);
  let quality;
  if (mode.kind === 'frame-quantizers') {
    // A numeric convenience value visibly expands into native frame controls.
    // It is not a conversion from another encoder's CRF/CQ scale.
    if (typeof settings.quality === 'number') {
      const value = integer(settings.quality, mode.min, mode.max, 'Native quantizer');
      quality = Object.fromEntries(mode.fields.map(field => [field, value]));
    } else {
      record(settings.quality, mode.fields, 'native frame quantizers');
      if (Object.values(Object.getOwnPropertyDescriptors(settings.quality)).some(field => !field.enumerable)) throw error('INVALID_NATIVE_SETTINGS', 'Native frame quantizers cannot contain hidden fields.');
      quality = Object.fromEntries(mode.fields.map(field => [field,
        integer(settings.quality[field], mode.min, mode.max, `${field.toUpperCase()} quantizer`)]));
    }
  } else quality = integer(settings.quality, mode.min, mode.max, mode.label);
  return freeze({ preset, mode: settings.mode, quality });
}
function validateNativeSettings(profileId, settings) {
  const profile = getNativeProfile(profileId);
  record(settings, ['preset', 'mode', 'quality', 'deviceId'], 'native settings');
  validatePreset(profile, settings.preset); validateMode(profile, settings.mode);
  const deviceId = opaqueId(settings.deviceId, 'Device ID');
  const normalized = validateNativeEncoderSettings(profileId, { preset: settings.preset, mode: settings.mode, quality: settings.quality });
  return freeze({ ...normalized, deviceId });
}

// Main resolves an opaque UI ID into this descriptor from its actual adapter
// inventory. Merely satisfying this schema does NOT grant device authority.
// adapterIndex is the Direct3D11/DXGI adapter index, never a WMI row ordinal.
function validateTrustedDevice(device, backend) {
  if (device === null || device === undefined) throw error('NATIVE_DEVICE_UNAVAILABLE', 'The selected hardware device is not currently resolved.');
  record(device, ['id', 'backend', 'vendorId', 'adapterIndex', 'adapterIdentity', 'driverVersion', 'runtimeVersion'], 'trusted device');
  if (!['amf', 'qsv'].includes(device.backend) || device.backend !== backend
    || device.vendorId !== (backend === 'amf' ? '0x1002' : '0x8086')) {
    throw error('NATIVE_DEVICE_MISMATCH', 'The selected device does not match the requested backend.');
  }
  return freeze({ id: opaqueId(device.id, 'Device ID'), backend, vendorId: device.vendorId,
    adapterIndex: integer(device.adapterIndex, 0, 63, 'Direct3D11 adapter index'),
    adapterIdentity: token(device.adapterIdentity, 'adapter identity'), driverVersion: token(device.driverVersion, 'driver version'),
    runtimeVersion: token(device.runtimeVersion, 'runtime version') });
}
function validateDepth(profile, bitDepth) {
  if (!profile.bitDepths.includes(bitDepth)) throw error('UNSUPPORTED_NATIVE_DEPTH', `${profile.label} does not offer that output bit depth.`);
  return bitDepth;
}

// Canonical requested encoder fragment, independent of current device/session.
// This can describe history after device removal. It grants no execution proof.
function nativeEncoderContribution(profileId, settings, configuration) {
  const profile = getNativeProfile(profileId), normalized = validateNativeEncoderSettings(profileId, settings);
  record(configuration, ['bitDepth', 'pipelineId'], 'native encoder configuration', ['pipelineId']);
  if (Object.values(Object.getOwnPropertyDescriptors(configuration)).some(field => !field.enumerable)) throw error('INVALID_NATIVE_SETTINGS', 'Native encoder configuration cannot contain hidden fields.');
  const bitDepth = validateDepth(profile, configuration.bitDepth), pipelineId = Object.hasOwn(configuration, 'pipelineId') ? configuration.pipelineId : UPLOAD_PIPELINE;
  if (pipelineId !== UPLOAD_PIPELINE) throw error('UNSUPPORTED_NATIVE_PIPELINE', 'This adapter contribution requires its qualified software-to-D3D11 upload path.');
  const codec = ['-c:v:0', profile.encoder];
  const preset = [profile.backend === 'amf' ? '-quality:v:0' : '-preset:v:0', normalized.preset];
  const options = [];
  if (profile.backend === 'amf') {
    options.push('-usage:v:0', 'transcoding', '-rc:v:0', normalized.mode, '-b:v:0', '0');
    if (normalized.mode === 'cqp') {
      for (const field of profile.modes.cqp.fields) options.push(`-qp_${field}:v:0`, String(normalized.quality[field]));
    } else options.push('-qvbr_quality_level:v:0', String(normalized.quality));
  } else {
    // Pinned qsvenc.c selects CQP via QSCALE, but ICQ via global_quality.
    // Derive all native QPs explicitly: QPP=q, QPI=q*abs(factor)+offset,
    // QPB likewise. Factors1 and integer offsets avoid hidden default ratios.
    // No lookahead, target bitrate or vendor dictionary is silently inserted.
    options.push('-b:v:0', '0');
    if (normalized.mode === 'cqp') {
      options.push('-q:v:0', String(normalized.quality.p), '-i_qfactor:v:0', '1',
        '-i_qoffset:v:0', String(normalized.quality.i - normalized.quality.p), '-b_qfactor:v:0', '1',
        '-b_qoffset:v:0', String(normalized.quality.b - normalized.quality.p));
    } else options.push('-global_quality:v:0', String(normalized.quality));
  }
  const encodedProfile = profile.codec === 'H264' ? 'high' : profile.codec === 'H265' && bitDepth === 10 ? 'main10' : 'main';
  const pixelArgs = ['-profile:v:0', encodedProfile, '-pix_fmt:v:0', profile.backend === 'amf' ? 'd3d11' : 'qsv'];
  if (profile.backend === 'amf' && profile.codec !== 'H264') pixelArgs.push('-bitdepth:v:0', String(bitDepth));
  const uploadFilters = [`format=${bitDepth === 10 ? 'p010le' : 'nv12'}`, 'hwupload=extra_hw_frames=16'];
  return freeze({ policyVersion: POLICY_VERSION, profileId, settings: normalized, backend: profile.backend,
    codecName: profile.codec, encodedCodec: profile.encodedCodec, encoder: profile.encoder, bitDepth, pipelineId,
    codec, preset, options, pixelArgs, uploadFilters, args: [...codec, ...preset, ...options, ...pixelArgs],
    scope: 'native-encoder-contribution-only', executionAuthority: 'none' });
}
function nativeContribution(profileId, settings, trusted) {
  const profile = getNativeProfile(profileId), normalized = validateNativeSettings(profileId, settings);
  record(trusted, ['device', 'bitDepth', 'pipelineId'], 'trusted preparation', ['pipelineId']);
  const device = validateTrustedDevice(trusted.device, profile.backend);
  if (normalized.deviceId !== device.id) throw error('NATIVE_DEVICE_MISMATCH', 'The chosen device ID is no longer bound to this adapter.');
  const fragment = nativeEncoderContribution(profileId, { preset: normalized.preset, mode: normalized.mode, quality: normalized.quality },
    { bitDepth: trusted.bitDepth, ...(Object.hasOwn(trusted, 'pipelineId') ? { pipelineId: trusted.pipelineId } : {}) });
  const { bitDepth, pipelineId, codec, preset, options, pixelArgs, uploadFilters } = fragment;
  const deviceArgs = ['-init_hw_device', `d3d11va=ffenc_d3d:${device.adapterIndex}`];
  const filterDevice = profile.backend === 'amf' ? 'ffenc_d3d' : 'ffenc_qsv';
  if (profile.backend === 'qsv') deviceArgs.push('-init_hw_device', 'qsv=ffenc_qsv@ffenc_d3d');
  deviceArgs.push('-filter_hw_device', filterDevice);
  return freeze({ profileId, settings: normalized, backend: profile.backend, encoder: profile.encoder, bitDepth,
    pipelineId, deviceId: device.id, codec, preset, options, pixelArgs, deviceArgs, uploadFilters,
    // This is output-side encoder argv only. Device setup precedes the input;
    // upload belongs AFTER main's media transform. Neither is a full command.
    args: [...codec, ...preset, ...options, ...pixelArgs],
    requiredEvidence: { mode: normalized.mode, encoder: profile.encoder, adapterIdentity: device.adapterIdentity,
      codec: profile.encodedCodec, bitDepth, hardwareExecution: true },
  });
}

function describeNativeRecipe(profileId, settings, trusted) {
  const profile = getNativeProfile(profileId), contribution = nativeContribution(profileId, settings, trusted);
  return freeze({ label: profile.label, qualityMode: profile.modes[contribution.settings.mode].label,
    settings: contribution.settings, contribution, args: contribution.args, presetContribution: contribution.preset,
    presetHelp: profile.backend === 'amf'
      ? 'Native AMF quality preset. Its symbolic meaning and supported features depend on codec and device; it is separate from CQP/QVBR.'
      : 'Native QSV target-usage preset. Slower choices allow more encoder effort; this is separate from ICQ/CQP and other vendors\' preset numbers.',
    qualityHelp: contribution.settings.mode === 'cqp'
      ? 'Native frame quantizers are applied explicitly. AV1 quantizer indices are not equivalent to H.264/HEVC QP, CRF, CQ or ICQ.'
      : 'This is the selected backend\'s native quality mode, not a cross-encoder quality scale. Hardware evidence must confirm the requested mode.',
    automaticBehavior: 'Unspecified backend/driver options retain their native defaults. No target bitrate is supplied by the application. Runtime qualification must inspect the actual mode; rejection never triggers a fallback.',
    evidenceStatus: 'hardware-qualification-required', testedDefault: false, seedNote: profile.seedNote,
    scope: 'Encoder contribution and device/upload setup only; preparation supplies the actual source-dependent command.' });
}

// A cell describes an exact policy/preset/mode/pipeline. Native value bounds
// are validated independently; a probe seed does not prove perceptual quality
// or turn every possible quality value into a separately measured result.
function validateCapabilityPolicy(policy) {
  record(policy, ['policyVersion', 'ffmpegSha256', 'ffprobeSha256', 'device', 'profileId', 'preset', 'mode', 'bitDepth',
    'pipelineId', 'transformId', 'signal', 'container'], 'capability policy');
  const profile = getNativeProfile(policy.profileId);
  if (policy.policyVersion !== POLICY_VERSION || typeof policy.ffmpegSha256 !== 'string' || !HASH.test(policy.ffmpegSha256)
    || typeof policy.ffprobeSha256 !== 'string' || !HASH.test(policy.ffprobeSha256)) {
    throw error('INVALID_CAPABILITY_POLICY', 'Capability policy must identify both exact binaries and the supported policy version.');
  }
  const preset = validatePreset(profile, policy.preset); validateMode(profile, policy.mode);
  const bitDepth = validateDepth(profile, policy.bitDepth);
  if (policy.pipelineId !== UPLOAD_PIPELINE || !['sdr', 'pq', 'hlg'].includes(policy.signal) || policy.container !== 'matroska') {
    throw error('INVALID_CAPABILITY_POLICY', 'Unsupported capability pipeline, signal or container.');
  }
  if (policy.signal !== 'sdr' && (profile.codec !== 'H265' || bitDepth !== 10)) {
    throw error('INVALID_CAPABILITY_POLICY', 'Initial native HDR cells require HEVC Main10.');
  }
  return freeze({ policyVersion: POLICY_VERSION, ffmpegSha256: policy.ffmpegSha256, ffprobeSha256: policy.ffprobeSha256,
    device: policy.device === null ? null : validateTrustedDevice(policy.device, profile.backend), profileId: profile.id,
    preset, mode: policy.mode, bitDepth, pipelineId: UPLOAD_PIPELINE, transformId: token(policy.transformId, 'main-owned transform ID'),
    signal: policy.signal, container: 'matroska' });
}
function capabilityKey(policy) {
  const normalized = validateCapabilityPolicy(policy);
  // A renderer session's opaque device handle may be refreshed at restart.
  // Stable adapter identity, ordinal, driver and runtime remain in the key.
  const device = normalized.device && { ...normalized.device }; if (device) delete device.id;
  return `native-v${POLICY_VERSION}:` + createHash('sha256').update(JSON.stringify({ ...normalized, device })).digest('hex');
}
function validateNativeEvidence(evidence, policy, key) {
  record(evidence, ['kind', 'policyKey', 'evidenceId', 'invocationId', 'modeSource', 'actualMode', 'actualEncoder',
    'actualAdapterIdentity', 'encodeClosed', 'decodeClosed', 'output'], 'native hardware evidence');
  const profile = getNativeProfile(policy.profileId);
  if (evidence.kind !== 'native-hardware' || evidence.policyKey !== key || !policy.device
    || !['runtime-log', 'runtime-query'].includes(evidence.modeSource) || evidence.actualMode !== policy.mode
    || evidence.actualEncoder !== profile.encoder || evidence.actualAdapterIdentity !== policy.device.adapterIdentity
    || evidence.encodeClosed !== true || evidence.decodeClosed !== true) {
    throw error('INVALID_NATIVE_EVIDENCE', 'Real closed encode/decode, selected-device and actual-mode evidence are required without substitution.');
  }
  if ([policy.device.adapterIdentity, policy.device.driverVersion, policy.device.runtimeVersion]
    .some(value => /^(unknown|unavailable|unresolved|not-detected)$/i.test(value))) {
    throw error('INVALID_NATIVE_EVIDENCE', 'Unknown adapter, driver or runtime identity cannot establish a verified cell.');
  }
  opaqueId(evidence.evidenceId, 'Evidence ID'); opaqueId(evidence.invocationId, 'Invocation ID');
  const output = evidence.output;
  record(output, ['codec', 'bitDepth', 'width', 'height', 'frames', 'decodedFrames', 'chroma', 'signal', 'valid'], 'native probe output');
  if (output.codec !== profile.encodedCodec || output.bitDepth !== policy.bitDepth || output.width !== 320 || output.height !== 180
    || output.frames !== 96 || output.decodedFrames !== 96 || output.chroma !== '4:2:0' || output.signal !== policy.signal || output.valid !== true) {
    throw error('INVALID_NATIVE_EVIDENCE', 'The native probe must fully decode the expected 96-frame codec/depth/signal output.');
  }
  return freeze({ kind: 'native-hardware', policyKey: key, evidenceId: evidence.evidenceId, invocationId: evidence.invocationId,
    modeSource: evidence.modeSource, actualMode: evidence.actualMode, actualEncoder: evidence.actualEncoder,
    actualAdapterIdentity: evidence.actualAdapterIdentity, encodeClosed: true, decodeClosed: true,
    output: { codec: output.codec, bitDepth: output.bitDepth, width: 320, height: 180, frames: 96, decodedFrames: 96,
      chroma: '4:2:0', signal: output.signal, valid: true } });
}
function validateCapabilityCell(cell, expectedPolicy) {
  record(cell, ['schema', 'key', 'state', 'reason', 'checkedAt', 'evidence'], 'capability cell');
  const policy = validateCapabilityPolicy(expectedPolicy), key = capabilityKey(policy);
  if (cell.schema !== 1 || typeof cell.key !== 'string' || cell.key !== key) throw error('CAPABILITY_STALE', 'Capability identity no longer matches this policy, runtime or device.');
  if (!STATES.includes(cell.state) || !REASONS[cell.state].includes(cell.reason)) throw error('INVALID_CAPABILITY_STATE', 'Capability state and reason do not agree.');
  if (cell.checkedAt !== null) integer(cell.checkedAt, 0, 8640000000000000, 'Capability observation time');
  let evidence = null;
  if (cell.state === 'verified') {
    if (cell.checkedAt === null) throw error('INVALID_NATIVE_EVIDENCE', 'Verified capability evidence needs an observation time.');
    evidence = validateNativeEvidence(cell.evidence, policy, key);
  } else if (cell.evidence !== null) throw error('INVALID_CAPABILITY_STATE', 'Non-verified cells cannot carry authoritative success evidence.');
  return freeze({ schema: 1, key, state: cell.state, reason: cell.reason, checkedAt: cell.checkedAt, evidence });
}
function requireVerifiedCapability(cell, policy) {
  const result = validateCapabilityCell(cell, policy);
  if (result.state !== 'verified') throw error('NATIVE_CAPABILITY_UNVERIFIED', `This hardware cell is ${result.state}: ${result.reason}. Choose another backend explicitly or qualify this cell.`);
  return result;
}

module.exports = { POLICY_VERSION, UPLOAD_PIPELINE, NATIVE_PROFILES, getNativeProfile, validateNativeSettings,
  validateNativeEncoderSettings, nativeEncoderContribution,
  validateTrustedDevice, nativeContribution, describeNativeRecipe, validateCapabilityPolicy, capabilityKey,
  validateCapabilityCell, requireVerifiedCapability };
