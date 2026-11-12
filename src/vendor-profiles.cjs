'use strict';

const { types } = require('node:util');
const { NATIVE_PROFILES, nativeEncoderContribution } = require('./backend-adapters.cjs');

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const VENDOR_MESSAGES = Object.freeze({
  INVALID_SETTINGS: 'Choose a supported vendor profile, preset and integer quality value.',
  INVALID_PLAN: 'The prepared encoding plan changed. Prepare the file again.',
  UNSUPPORTED_PIXEL_FORMAT: 'Vendor encoding supports planar 4:2:0 8-bit or 10-bit source pixels only.',
  UNSUPPORTED_COLOR: 'The source color evidence is unsupported or incomplete.',
  VENDOR_DEPTH_NOT_OFFERED: 'This vendor profile does not offer the source bit depth. H.264 is 8-bit only.',
  VENDOR_HDR_DEFERRED: 'HDR encoding on AMD and Intel is deferred.',
  VENDOR_ROUTE_UNQUALIFIED: 'This vendor profile currently supports Full and Keep Source with copied streams only.',
  VENDOR_ARGV_SHAPE: 'The ordinary encoder command does not match the reviewed vendor overlay shape.',
  VENDOR_DEVICE_REQUIRED: 'A checked vendor adapter is required.',
  VENDOR_DEVICE_INVALID: 'The vendor adapter binding is invalid.',
  VENDOR_DEVICE_MISMATCH: 'The checked adapter does not match the selected vendor.',
  VENDOR_DEVICE_UNEXPECTED: 'CPU and NVIDIA profiles do not accept a vendor adapter binding.',
  VENDOR_DEVICE_CHANGED: 'The checked vendor adapter or driver changed. Check capabilities again.',
  VENDOR_NO_ADAPTER: 'No matching hardware adapter was found.',
  VENDOR_DISCOVERY_INCOMPLETE: 'Vendor adapter discovery could not be completed.',
  VENDOR_CHECK_BUDGET: 'The vendor startup check reached its time budget.',
  VENDOR_CHECK_FAILED: 'The vendor startup check failed.',
  VENDOR_PARAMS_ADJUSTED: 'The vendor encoder reported adjusted parameters or partial acceleration.',
  VENDOR_MULTIPLE_ADAPTERS: 'Multiple matching adapters were found. The first passing adapter is used.',
  VENDOR_ENCODER_TAG_MISMATCH: 'The output encoder tag does not match the selected vendor encoder.',
  VENDOR_FRAME_COUNT_MISMATCH: 'The reported frame counts do not agree.',
  VENDOR_OUTPUT_DECODE_FAILED: 'The output did not decode completely.',
  VENDOR_ENCODE_FAILED: 'The vendor encode failed. No output was published.',
  VENDOR_EXECUTION_UNAVAILABLE: 'Vendor execution is unavailable until its execution checks are installed.',
  VENDOR_VALIDATION_TIMEOUT: 'Vendor output validation reached its time budget. No output was published.',
  // Ordinary job outcomes keep their own codes so dispositions stay truthful.
  PUBLICATION_UNCERTAIN: 'Publication could not be confirmed. A copy may exist in the output folder under its final name; check it before use.',
  CANCELLED: 'Cancelled. No output was published.',
  INPUT_CHANGED: 'The source file changed while it was being encoded. The completed output was retained without publication.',
  SOURCE_CHECK_INCOMPLETE: 'The completed source check was incomplete. The completed output was retained without publication.',
  VENDOR_INSPECTION_REUSE_UNAVAILABLE: 'Inspection reuse is unavailable; using fresh inspection.',
});
const fail = code => { throw Object.assign(new Error(VENDOR_MESSAGES[code]), { code }); };

// Read syntax and starting values from the native *pure* table, never from its
// discovery, capability registry or file services. These rows grant no authority.
const VENDOR_PROFILES = freeze(NATIVE_PROFILES.map(native => {
  const hardware = native.backend === 'amf' ? 'AMD' : 'Intel';
  const slug = native.id.split('-')[0], mode = native.operationalSeed.mode;
  return {
    id: `${slug}-${hardware.toLowerCase()}`, nativeId: native.id, twin: `${slug}-cpu`,
    label: `${native.codec} · ${hardware}`, codec: native.codec, encoder: native.encoder,
    hardware, tier: 'untested', suffix: `${native.codec}-${hardware}-GPU`,
    bitDepths: [...native.bitDepths], presets: [...native.presets], defaultPreset: native.operationalSeed.preset,
    quality: { mode: mode === 'icq' ? 'ICQ' : 'QP', min: native.modes[mode].min,
      max: native.modes[mode].max, default: native.operationalSeed.quality },
    pixelFormats: native.bitDepths.map(depth => depth === 10 ? 'yuv420p10le' : 'yuv420p'),
  };
}));
const VENDOR_TESTED_EVIDENCE = Object.freeze([]);

function validateVendorSettings(request) {
  // Reject proxies before reflection, and accessors before reading any value.
  // Renderer settings are data, not executable property lookups.
  if (!request || typeof request !== 'object' || types.isProxy(request) || Array.isArray(request)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) fail('INVALID_SETTINGS');
  const fields = Object.getOwnPropertyDescriptors(request), keys = ['profileId', 'preset', 'quality'];
  if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)
      || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail('INVALID_SETTINGS');
  const profile = VENDOR_PROFILES.find(row => row.id === fields.profileId.value);
  if (!profile || typeof fields.preset.value !== 'string' || !profile.presets.includes(fields.preset.value)
      || !Number.isSafeInteger(fields.quality.value) || fields.quality.value < profile.quality.min
      || fields.quality.value > profile.quality.max) fail('INVALID_SETTINGS');
  return { profileId: profile.id, preset: fields.preset.value, quality: fields.quality.value };
}

function vendorPixelFormat(profile, pixelFormat) {
  if (!VENDOR_PROFILES.includes(profile)) fail('INVALID_SETTINGS');
  if (!['yuv420p', 'yuv420p10le'].includes(pixelFormat)) fail('UNSUPPORTED_PIXEL_FORMAT');
  const bitDepth = pixelFormat === 'yuv420p10le' ? 10 : 8;
  if (!profile.bitDepths.includes(bitDepth)) fail('VENDOR_DEPTH_NOT_OFFERED');
  return bitDepth === 10 ? 'p010le' : 'nv12';
}

function vendorFragments(profile, settings, bitDepth) {
  if (!VENDOR_PROFILES.includes(profile)) fail('INVALID_SETTINGS');
  const normalized = validateVendorSettings(settings);
  if (normalized.profileId !== profile.id) fail('INVALID_SETTINGS');
  if (!profile.bitDepths.includes(bitDepth)) fail('VENDOR_DEPTH_NOT_OFFERED');
  const native = NATIVE_PROFILES.find(row => row.id === profile.nativeId), mode = native.operationalSeed.mode;
  const quality = mode === 'cqp'
    ? Object.fromEntries(native.modes.cqp.fields.map(field => [field, normalized.quality])) : normalized.quality;
  return nativeEncoderContribution(native.id, { preset: normalized.preset, mode, quality },
    { bitDepth, pipelineId: 'software-d3d11-upload-v1' });
}

function recipeDescription(settings) {
  const normalized = validateVendorSettings(settings), profile = VENDOR_PROFILES.find(row => row.id === normalized.profileId);
  const fragment = vendorFragments(profile, normalized, 8);
  return {
    settings: normalized, label: profile.label, codec: profile.codec, encoder: profile.encoder,
    backend: profile.hardware, tier: profile.tier, qualityMode: profile.quality.mode, recipe: null,
    args: [...fragment.codec, ...fragment.preset, ...fragment.options], presetContribution: [...fragment.preset],
    presetHelp: profile.hardware === 'AMD'
      ? 'AMF speed, balanced, quality and high_quality are native encoder presets. Starting values are untested.'
      : 'QSV veryfast through veryslow are native encoder presets. Starting values are untested.',
    qualityHelp: profile.quality.mode === 'ICQ'
      ? 'ICQ requests Intel quality control. Lower values generally request higher quality. Values are not equivalent to CRF or CQ.'
      : 'QP requests constant frame quantizers with equal I and P values, and equal B where offered. Values are not equivalent to CRF or CQ.',
    mediaNote: 'Not yet tested on real AMD/Intel hardware. Results are checked after encoding.',
    disclosure: profile.hardware === 'AMD'
      ? 'The app cannot confirm which encoder settings AMD actually used.'
      : 'The app cannot prove which Intel adapter encoded the file.',
  };
}
function describeVendorRecipe(settings) {
  const result = recipeDescription(settings), profile = VENDOR_PROFILES.find(row => row.id === result.settings.profileId);
  return { ...result, startingValues: recipeDescription({ profileId: profile.id,
    preset: profile.defaultPreset, quality: profile.quality.default }) };
}

module.exports = { VENDOR_PROFILES, VENDOR_TESTED_EVIDENCE, VENDOR_MESSAGES,
  validateVendorSettings, vendorPixelFormat, describeVendorRecipe, vendorFragments };
