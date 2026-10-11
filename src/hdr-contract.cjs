'use strict';

const { ToolError } = require('./process-runner.cjs');

// This is a pure planning boundary, not a capability grant. Main must match the
// returned requirements to native evidence and bind any decision to the current
// source/draft. Neither a display label nor serialized metadata can authorize a
// filter, drop an ancillary stream, or establish HDR-display acceptance.
const HDR_CONTRACT_VERSION = 1;
const HDR_TRANSFORM_VERSION = 'software-hable-100nit-v1';
const HELP_BASIS = 'FFmpeg 9.0.1: transform-runtime-help.txt (2026-10-11)';
const SDR_TRANSFERS = ['bt709', 'gamma22', 'gamma28', 'smpte170m', 'smpte240m', 'iec61966-2-1', 'bt2020-10', 'bt2020-12'];
const MASTER_FIELDS = ['red_x', 'red_y', 'green_x', 'green_y', 'blue_x', 'blue_y', 'white_point_x', 'white_point_y', 'min_luminance', 'max_luminance'];
const DOVI_FIELDS = ['dv_version_major', 'dv_version_minor', 'dv_profile', 'dv_level', 'rpu_present_flag', 'el_present_flag', 'bl_present_flag', 'dv_bl_signal_compatibility_id'];
const HDR_FRAME_TYPES = ['MASTERING_DISPLAY_METADATA', 'CONTENT_LIGHT_LEVEL', 'DYNAMIC_HDR_PLUS', 'DYNAMIC_HDR_VIVID', 'DOVI_RPU_BUFFER', 'DOVI_METADATA', 'AMBIENT_VIEWING_ENVIRONMENT'];
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function record(value, keys, label) {
  if (!plain(value)) fail('INVALID_HDR_REQUEST', `${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !descriptor.enumerable || !own(descriptor, 'value')) {
      fail('INVALID_HDR_REQUEST', `${label} contains an unsupported field.`);
    }
  }
}

// Inspection already bounds data, but copying through this boundary also rejects
// accessors, cycles and arbitrary objects and prevents later input mutation from
// rewriting a prepared descriptive result.
function evidenceSnapshot(value) {
  let nodes = 0, characters = 0;
  function copy(item, depth) {
    if (++nodes > 16384 || depth > 10) fail('INVALID_HDR_EVIDENCE', 'HDR evidence exceeds the bounded data shape.');
    if (typeof item === 'string') {
      characters += item.length;
      if (item.length > 16384 || characters > 524288 || item.includes('\0')) fail('INVALID_HDR_EVIDENCE', 'HDR evidence text exceeds its bound.');
      return item;
    }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    if (Array.isArray(item)) {
      if (item.length > 1024) fail('INVALID_HDR_EVIDENCE', 'HDR evidence contains too many entries.');
      const result = [];
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !own(descriptor, 'value')) fail('INVALID_HDR_EVIDENCE', 'HDR evidence contains an accessor or sparse array.');
        result.push(copy(descriptor.value, depth + 1));
      }
      if (Reflect.ownKeys(item).length !== item.length + 1) fail('INVALID_HDR_EVIDENCE', 'HDR evidence array has extra fields.');
      return result;
    }
    if (!plain(item)) fail('INVALID_HDR_EVIDENCE', 'HDR evidence must contain only bounded plain data.');
    const result = {};
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || key === '__proto__' || !descriptor.enumerable || !own(descriptor, 'value')) fail('INVALID_HDR_EVIDENCE', 'HDR evidence contains an unsupported field.');
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  return copy(value, 0);
}

function textEvidence(value, label, optional = false) {
  if (optional && value?.state === 'unknown') return null;
  if (value?.state !== 'known' || typeof value.value !== 'string' || !value.value.length || value.value.length > 1024) {
    fail('HDR_EVIDENCE_UNRESOLVED', `${label} is missing or malformed.`);
  }
  return value.value;
}
function integerEvidence(value, label, maximum = 255) {
  if (value?.state !== 'known' || typeof value.value !== 'string' || !/^\d{1,10}$/.test(value.value)) fail('HDR_METADATA_INVALID', `${label} is missing or malformed.`);
  const result = Number(value.value);
  if (!Number.isSafeInteger(result) || result > maximum) fail('HDR_METADATA_INVALID', `${label} is out of range.`);
  return result;
}
function rationalEvidence(value, label, maximum) {
  if (value?.state !== 'known' || !plain(value.value) || !/^\d{1,40}$/.test(value.value.numerator)
      || !/^\d{1,40}$/.test(value.value.denominator)) fail('HDR_METADATA_INVALID', `${label} is missing or malformed.`);
  const n = BigInt(value.value.numerator), d = BigInt(value.value.denominator);
  if (!d || n > BigInt(maximum) * d) fail('HDR_METADATA_INVALID', `${label} is out of range.`);
  return { numerator: n.toString(), denominator: d.toString() };
}
const greater = (a, b) => BigInt(a.numerator) * BigInt(b.denominator) > BigInt(b.numerator) * BigInt(a.denominator);

function metadataOf(video) {
  if (!plain(video.hdr) || video.hdr.coverage !== 'stream-metadata-only' || !Array.isArray(video.hdr.entries)
      || video.hdr.entries.length > 64) fail('INVALID_HDR_EVIDENCE', 'A bounded typed HDR evidence record is required.');
  const metadata = { mastering: null, contentLight: null, ambient: null, dolby: null };
  const seen = new Set();
  for (const entry of video.hdr.entries) {
    const type = textEvidence(entry.type, 'HDR side-data type');
    if (seen.has(type)) fail('HDR_METADATA_AMBIGUOUS', `Repeated ${type} needs reconciliation before preparation.`);
    seen.add(type);
    if (!plain(entry.fields) || (entry.issues && (!Array.isArray(entry.issues) || entry.issues.length))) fail('HDR_METADATA_INVALID', `${type} contains contradictory evidence.`);
    const fields = entry.fields;
    if (type === 'Mastering display metadata') {
      const values = Object.fromEntries(MASTER_FIELDS.map(key => [key, rationalEvidence(fields[key], key, key.endsWith('luminance') ? 10000 : 1)]));
      if (values.max_luminance.numerator === '0' || greater(values.min_luminance, values.max_luminance)) fail('HDR_METADATA_INVALID', 'Mastering luminance is invalid.');
      metadata.mastering = values;
    } else if (type === 'Content light level metadata') {
      const values = {};
      for (const key of ['max_content', 'max_average']) {
        // Zero is explicitly unspecified in this side-data format, not a measured
        // zero-nit scene. Retain that distinction for future metadata writers.
        values[key] = fields[key]?.state === 'unknown' && fields[key].reason === 'unspecified-zero-light-level'
          ? { value: null, signalValue: 0, reason: 'unspecified-zero-light-level' }
          : { value: integerEvidence(fields[key], key, 65535), reason: 'reported' };
        if (values[key].value === 0) fail('HDR_METADATA_INVALID', 'A zero light level must be normalized as unspecified.');
      }
      if (values.max_content.value !== null && values.max_average.value !== null && values.max_average.value > values.max_content.value) fail('HDR_METADATA_INVALID', 'Average light exceeds the reported maximum.');
      metadata.contentLight = values;
    } else if (type === 'Ambient viewing environment') {
      metadata.ambient = Object.fromEntries(['ambient_illuminance', 'ambient_light_x', 'ambient_light_y'].map(key =>
        [key, rationalEvidence(fields[key], key, key === 'ambient_illuminance' ? 1000000 : 1)]));
    } else if (type === 'DOVI configuration record') {
      metadata.dolby = Object.fromEntries(DOVI_FIELDS.map(key => [key, integerEvidence(fields[key], key, key.endsWith('_flag') ? 1 : 255)]));
      metadata.dolby.dv_md_compression = textEvidence(fields.dv_md_compression, 'Dolby metadata compression', true);
    } else {
      // An unimplemented dynamic format cannot become permission to drop it just
      // because the underlying transfer happens to be PQ or HLG.
      fail('HDR_DYNAMIC_METADATA_UNSUPPORTED', `${type} has no qualified interpretation in this HDR contract.`);
    }
  }
  return metadata;
}

function sourceOf(video, decision) {
  if (!plain(video) || !Number.isSafeInteger(video.index) || video.index < 0 || video.index > 100000
      || !plain(video.color) || !plain(video.geometry)) fail('INVALID_HDR_EVIDENCE', 'A typed selected-video evidence record is required.');
  if (textEvidence(video.codec?.type, 'Stream type') !== 'video') fail('INVALID_HDR_EVIDENCE', 'HDR evidence must describe the selected video stream.');
  const metadata = metadataOf(video);
  let transfer = textEvidence(video.color.transfer, 'Transfer characteristic', true);
  if (decision !== undefined) {
    if (!plain(decision) || decision.videoIndex !== video.index || !['sdr', 'hdr', 'ambiguous'].includes(decision.classification)) fail('HDR_EVIDENCE_CONFLICT', 'Color decision does not identify this video.');
    if (decision.classification === 'ambiguous') fail('HDR_EVIDENCE_UNRESOLVED', 'The source color inspection is unresolved.');
    if (decision.transfer !== null && (typeof decision.transfer !== 'string' || (transfer && transfer !== decision.transfer))) fail('HDR_EVIDENCE_CONFLICT', 'Stream and inspected transfer characteristics conflict.');
    if (!transfer && decision.classification === 'sdr' && decision.supported === true && SDR_TRANSFERS.includes(decision.transfer)) transfer = decision.transfer;
  }
  if (!transfer) fail('HDR_EVIDENCE_UNRESOLVED', 'The transfer characteristic is unknown; bit depth does not establish HDR.');
  const classification = transfer === 'smpte2084' ? 'pq' : transfer === 'arib-std-b67' ? 'hlg' : SDR_TRANSFERS.includes(transfer) ? 'sdr' : null;
  if (!classification) fail('HDR_TRANSFER_UNSUPPORTED', 'The transfer characteristic has no implemented interpretation.');
  if (decision && ((classification === 'sdr') !== (decision.classification === 'sdr') || (classification === 'sdr' && decision.supported !== true))) fail('HDR_EVIDENCE_CONFLICT', 'The source signal conflicts with its inspected classification.');
  if (classification === 'sdr' && Object.values(metadata).some(Boolean)) fail('HDR_EVIDENCE_CONFLICT', 'HDR metadata conflicts with the reported SDR transfer.');
  const signal = { transfer, primaries: textEvidence(video.color.primaries, 'Primaries', true),
    matrix: textEvidence(video.color.matrix, 'Matrix', true), range: textEvidence(video.color.range, 'Range', true),
    pixelFormat: textEvidence(video.color.pixelFormat, 'Pixel format', true), chromaLocation: textEvidence(video.color.chromaLocation, 'Chroma location', true) };
  let scanMode = null;
  if (classification !== 'sdr') {
    if (signal.primaries !== 'bt2020' || signal.matrix !== 'bt2020nc' || signal.range !== 'tv'
        || !['yuv420p10le', 'p010le'].includes(signal.pixelFormat)) fail('HDR_SIGNAL_UNSUPPORTED', 'The initial HDR contract requires coherent limited-range BT.2020 non-constant-luminance 10-bit 4:2:0 evidence.');
    scanMode = textEvidence(video.geometry.fieldOrder, 'Field order', true);
    if (scanMode !== null && scanMode !== 'progressive') fail('HDR_SCAN_UNSUPPORTED', 'This HDR path requires progressive input; it does not deinterlace.');
  }
  if (metadata.dolby) {
    const d = metadata.dolby;
    if (classification !== 'hlg' || d.dv_profile !== 8 || d.dv_bl_signal_compatibility_id !== 4
        || d.bl_present_flag !== 1 || d.el_present_flag !== 0 || d.rpu_present_flag !== 1
        || d.dv_version_major !== 1 || d.dv_version_minor !== 0) fail('HDR_DOLBY_UNSUPPORTED', 'Only the explicitly qualified Dolby profile 8 HLG-compatible base-layer shape is planned here.');
  }
  return { videoIndex: video.index, classification, signal, metadata, scanMode, coverage: video.hdr.coverage };
}

const removeFrameMetadata = types => types.map(type => `sidedata=mode=delete:type=${type}`);
const retainedMetadata = source => ['mastering', 'contentLight', 'ambient'].filter(key => source.metadata[key] !== null);
function outputSignal(transfer, depth) {
  return { transfer, primaries: transfer === 'bt709' ? 'bt709' : 'bt2020', matrix: transfer === 'bt709' ? 'bt709' : 'bt2020nc',
    range: 'tv', bitDepth: depth, pixelFormat: depth === 10 ? 'yuv420p10le' : 'yuv420p', hdr10Claim: false, dolbyVision: false };
}

function softwareSdr(source, depth) {
  const hlg = source.classification === 'hlg';
  const reportedPeak = source.metadata.contentLight?.max_content.value;
  const peakNits = hlg ? 1000 : reportedPeak ?? 1000;
  if (peakNits <= 0 || peakNits > 10000) fail('HDR_PEAK_UNSUPPORTED', 'Reported source peak falls outside the implemented PQ luminance domain.');
  // FFmpeg's tonemap consumes linear float RGB. zimg's display-referred HLG
  // inverse operation uses gamma 1.2 and 1000/npl scaling; npl=100 puts 100 nits
  // at linear 1, so a 1000-nit reference uses peak=10, not peak=1000.
  // https://ffmpeg.org/ffmpeg-filters.html#tonemap
  // https://raw.githubusercontent.com/sekrit-twc/zimg/master/src/zimg/colorspace/operation_impl.cpp
  // https://raw.githubusercontent.com/sekrit-twc/zimg/master/src/zimg/colorspace/gamma.cpp
  return {
    engine: 'software', version: HDR_TRANSFORM_VERSION, helpBasis: HELP_BASIS,
    beforeScale: [`zscale=pin=bt2020:tin=${source.signal.transfer}:min=bt2020nc:rin=limited:p=bt2020:t=linear:m=gbr:r=full:npl=100:agamma=0`,
      'format=gbrpf32le', 'zscale=pin=bt2020:tin=linear:min=gbr:rin=full:p=bt709:t=linear:m=gbr:r=full:agamma=0',
      `tonemap=tonemap=hable:desat=2:peak=${peakNits / 100}`],
    scaleInsertion: 'optional-qualified-downscale-in-linear-float-bt709',
    afterScale: ['zscale=pin=bt709:tin=linear:min=gbr:rin=full:p=bt709:t=bt709:m=bt709:r=limited:dither=error_diffusion:agamma=0',
      `format=${depth === 10 ? 'yuv420p10le' : 'yuv420p'}`, ...removeFrameMetadata(HDR_FRAME_TYPES)],
    interpretation: { nominalSdrNits: 100, sourcePeakNits: peakNits,
      sourcePeakBasis: hlg ? 'assumed-1000nit-hlg-reference-display' : reportedPeak === undefined || reportedPeak === null ? 'assumed-1000nit-pq-source-peak' : 'reported-maxcll',
      hlgSystemGamma: hlg ? 1.2 : null, sourcePeakMeasuredByApplication: false,
      gamutHandling: 'linear-primaries-conversion-highlight-desaturation-and-output-clipping',
      clippingQualificationRequired: true },
  };
}

function dolbyPqFilter() {
  // RPU application changes the representation; it is not Dolby preservation.
  // No invented target-peak option: target interpretation remains a native-test
  // requirement. Main separately owns Vulkan device selection/lifetime.
  // https://ffmpeg.org/ffmpeg-filters.html#libplacebo
  return { engine: 'libplacebo-vulkan', version: 'dovi84-to-pq-v1', helpBasis: HELP_BASIS,
    beforeScale: ['libplacebo=format=yuv420p10le:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=limited:apply_dolbyvision=1:apply_filmgrain=0:peak_detect=0:tonemapping=bt.2390:gamut_mode=perceptual:inverse_tonemapping=0:contrast_recovery=0:deband=0:frame_mixer=none:deinterlace=weave:send_fields=0'],
    scaleInsertion: 'requires-separate-qualified-hdr-geometry-contract',
    afterScale: removeFrameMetadata(HDR_FRAME_TYPES),
    interpretation: { appliesDolbyRpu: true, targetPeakNits: null, targetPeakBasis: 'not-configurable-by-this-pinned-wrapper-contribution',
      noClaimOfVisibleImprovement: true } };
}

function resolveHdrContract(options) {
  record(options, ['policy', 'videoEvidence', 'colorDecision', 'outputCodec', 'outputBitDepth', 'target'], 'HDR request');
  const { policy, outputCodec, outputBitDepth, target = 'matroska' } = options;
  if (!['preserve', 'sdr', 'hlg-base', 'dolby-pq'].includes(policy) || !['h264', 'h265', 'av1'].includes(outputCodec)
      || ![undefined, 8, 10].includes(outputBitDepth) || !['matroska', 'mp4', 'mov'].includes(target)) fail('INVALID_HDR_REQUEST', 'Unsupported HDR operation, codec, depth or container.');
  const source = sourceOf(evidenceSnapshot(options.videoEvidence), options.colorDecision === undefined ? undefined : evidenceSnapshot(options.colorDecision));
  const result = { version: HDR_CONTRACT_VERSION, policy, source, outputCodec, target,
    status: 'descriptive-unqualified-contract', executable: false, filterContribution: null,
    decisionRequirements: [], qualificationRequirements: [], warnings: [], ancillaryStreamAuthority: 'none' };
  if (source.classification === 'sdr') {
    if (!['preserve', 'sdr'].includes(policy)) fail('HDR_POLICY_NOT_APPLICABLE', 'A Dolby/base-layer operation cannot be applied to an SDR source.');
    result.route = 'existing-sdr';
    result.expectedOutput = { label: 'SDR', ...source.signal, bitDepth: outputBitDepth ?? null, bitDepthPolicy: 'existing-profile-builder', hdr10Claim: false, dolbyVision: false };
    result.metadataDisposition = { action: 'existing-sdr-preservation', retained: [], removed: [], dolby: 'not-observed' };
    result.qualificationRequirements = ['existing-inspection-and-profile-acceptance'];
    return freeze(result);
  }
  const isDolby = source.metadata.dolby !== null;
  if (isDolby && policy === 'preserve') fail('HDR_DOLBY_CHOICE_REQUIRED', 'Dolby Vision cannot be silently discarded. Choose the explicit HLG base-layer route or Dolby-aware PQ conversion.');
  if (!isDolby && ['hlg-base', 'dolby-pq'].includes(policy)) fail('HDR_POLICY_NOT_APPLICABLE', 'This operation requires compatible Dolby Vision evidence.');
  const depth = outputBitDepth ?? (policy === 'sdr' && outputCodec === 'h264' ? 8 : 10);
  if (policy !== 'sdr' && (outputCodec !== 'h265' || depth !== 10)) fail('HDR_OUTPUT_UNSUPPORTED', 'The initial retained-HDR contract requires qualified HEVC Main10.');
  if (policy === 'sdr' && outputCodec === 'h264' && depth !== 8) fail('HDR_OUTPUT_UNSUPPORTED', 'The initial H.264 SDR conversion contract uses 8-bit output.');
  result.qualificationRequirements.push('matching-runtime-backend-container-cell', 'decoded-signal-and-frame-consistency',
    'output-bitstream-and-container-signal', 'preservation-validation-and-ancillary-decisions', 'native-playback', 'hdr-display-judgment-not-yet-verified');
  if (source.scanMode === null) result.qualificationRequirements.push('source-progressive-scan-evidence-required');
  const retained = retainedMetadata(source);
  if (policy === 'sdr') {
    result.route = isDolby ? 'dolby84-hlg-base-to-sdr' : `${source.classification}-to-sdr`;
    result.expectedOutput = { label: 'SDR', ...outputSignal('bt709', depth) };
    result.filterContribution = softwareSdr(source, depth);
    result.metadataDisposition = { action: 'remove-obsolete-color-metadata', retained: [], removed: [...retained, ...(isDolby ? ['dolby'] : [])],
      dolby: isDolby ? 'discarded-without-rpu-application' : 'not-observed', validateAbsentFrameTypes: [...HDR_FRAME_TYPES], validateAbsentDolbyConfiguration: true };
    result.qualificationRequirements.push('linear-float-and-luminance-numeric-fixtures', 'highlight-gamut-and-gradient-judgment', 'obsolete-hdr-metadata-absence');
    result.warnings.push('HDR is deliberately converted to SDR; the peak interpretation and tone-map are engineering choices, not measured display equivalence.');
    if (isDolby) {
      result.decisionRequirements.push({ kind: 'dolby-hlg-base-to-sdr', scope: 'exact-source-and-draft', authority: 'unbound',
        message: 'Convert the compatible HLG base to SDR. Dolby Vision metadata is discarded without being applied.' });
    }
  } else if (policy === 'dolby-pq') {
    result.route = 'dolby84-aware-pq'; result.expectedOutput = { label: 'PQ HDR', ...outputSignal('smpte2084', 10) };
    result.filterContribution = dolbyPqFilter();
    result.metadataDisposition = { action: 'apply-dolby-then-discard-obsolete-metadata', retained: [], removed: [...retained, 'dolby'], dolby: 'applied-not-retained',
      replacementStaticMetadata: 'none-fabricated', validateAbsentDolbyConfiguration: true };
    result.qualificationRequirements.push('vulkan-device-and-frame-path', 'decoded-rpu-reaches-filter', 'pq-target-interpretation', 'dolby-on-off-controlled-comparison', 'replacement-static-metadata-policy');
    result.warnings.push('Dolby information is applied where qualified, but the result is PQ HDR, not Dolby Vision or automatically HDR10.');
  } else {
    result.route = isDolby ? 'dolby84-hlg-base' : `${source.classification}-preserve`;
    result.expectedOutput = { label: source.classification === 'hlg' ? 'HLG HDR' : 'PQ HDR', ...outputSignal(source.signal.transfer, 10) };
    result.metadataDisposition = { action: isDolby ? 'retain-hlg-base-discard-dolby' : 'retain-valid-hdr-metadata', retained, removed: isDolby ? ['dolby'] : [],
      dolby: isDolby ? 'discarded-without-rpu-application' : 'not-observed', values: { mastering: source.metadata.mastering, contentLight: source.metadata.contentLight, ambient: source.metadata.ambient },
      validateAbsentDolbyConfiguration: isDolby };
    if (retained.length) result.qualificationRequirements.push('backend-static-and-ambient-metadata-writers');
    if (isDolby) {
      result.filterContribution = { engine: 'software', version: 'dovi84-hlg-base-v1', helpBasis: HELP_BASIS, beforeScale: [],
        scaleInsertion: 'requires-separate-qualified-hdr-geometry-contract', afterScale: removeFrameMetadata(['DOVI_RPU_BUFFER', 'DOVI_METADATA']) };
      result.warnings.push('HDR is retained as HLG. Dolby Vision dynamic metadata is not applied or retained.');
      result.qualificationRequirements.push('compatible-hlg-base-decoding', 'dolby-configuration-and-rpu-absence');
    }
  }
  return freeze(result);
}

module.exports = { HDR_CONTRACT_VERSION, HDR_TRANSFORM_VERSION, resolveHdrContract };
