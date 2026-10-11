'use strict';

const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { describeRecipe } = require('./media.cjs');
const { resolveHdrContract } = require('./hdr-contract.cjs');

// An HDR contribution is not an executable job or a capability grant. Main must
// separately bind source identity, user decisions, ancillary preservation and a
// qualified runtime/device/operation cell. In particular no renderer JSON can
// manufacture the private plan identity used by the output checker below.
const HDR_ENCODING_VERSION = 2;
const plans = new WeakSet();
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw new ToolError(code, message); };
const MASTER_FIELDS = ['red_x', 'red_y', 'green_x', 'green_y', 'blue_x', 'blue_y', 'white_point_x', 'white_point_y', 'min_luminance', 'max_luminance'];
const AMBIENT_FIELDS = ['ambient_illuminance', 'ambient_light_x', 'ambient_light_y'];
const SIDE_TYPES = Object.freeze({ 'Mastering display metadata': 'mastering', 'Content light level metadata': 'contentLight', 'Ambient viewing environment': 'ambient' });
const MAX_FRAME_SAMPLES = 256;
const HELP_BASIS = Object.freeze({
  version: '9.0.2-full_build-www.gyan.dev',
  ffmpegSha256: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0',
  ffprobeSha256: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3',
  evidence: 'artifacts/v0.7/hdr-runtime-help/61ddd3c6-854c-4ea5-b1dd-ded599db63a8/manifest.json',
  qualification: 'help-and-upstream-source-only; no native HDR acceptance',
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function record(value, allowed, required, label) {
  if (!plain(value) || required.some(key => !own(value, key))) fail('INVALID_HDR_ENCODING', `${label} is missing required fields.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !own(descriptor, 'value')) fail('INVALID_HDR_ENCODING', `${label} contains an unsupported field.`);
  }
}
function snapshot(value) {
  let nodes = 0, characters = 0;
  const stack = new WeakSet();
  function copy(item, depth) {
    if (++nodes > 65536 || depth > 16) fail('INVALID_HDR_ENCODING', 'HDR evidence is too complex.');
    if (typeof item === 'string') {
      characters += item.length;
      if (item.length > 16384 || characters > 2097152 || item.includes('\0')) fail('INVALID_HDR_ENCODING', 'HDR evidence text exceeds its bound.');
      return item;
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (!plain(item) && !Array.isArray(item) || stack.has(item)) fail('INVALID_HDR_ENCODING', 'HDR evidence must be acyclic plain data.');
    stack.add(item);
    const array = Array.isArray(item);
    if (array && item.length > 1024) fail('INVALID_HDR_ENCODING', 'HDR evidence has too many entries.');
    const result = array ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || !own(descriptor, 'value')
          || array && !/^(0|[1-9]\d*)$/.test(key)) fail('INVALID_HDR_ENCODING', 'HDR evidence contains an accessor or unsupported key.');
      characters += key.length;
      if (key.length > 256 || characters > 2097152) fail('INVALID_HDR_ENCODING', 'HDR evidence keys exceed their bound.');
      result[key] = copy(descriptor.value, depth + 1);
    }
    if (array && (result.length !== item.length || Object.keys(result).length !== item.length)) fail('INVALID_HDR_ENCODING', 'Sparse HDR evidence is not allowed.');
    stack.delete(item);
    return result;
  }
  return copy(value, 0);
}

function scaledRational(value, scale, maximum, label) {
  record(value, ['numerator', 'denominator'], ['numerator', 'denominator'], label);
  if (!/^\d{1,40}$/.test(value.numerator) || !/^\d{1,40}$/.test(value.denominator)) fail('HDR_METADATA_INVALID', `${label} is not a bounded rational.`);
  const numerator = BigInt(value.numerator) * BigInt(scale), denominator = BigInt(value.denominator);
  if (!denominator || numerator % denominator || numerator / denominator > BigInt(maximum)) {
    fail('HDR_METADATA_PRECISION_UNSUPPORTED', `${label} cannot be represented exactly in HEVC metadata units; rounding is not authorized.`);
  }
  return (numerator / denominator).toString();
}

function masterDisplayString(values) {
  // x265 and HEVC MDCV use chromaticities /50000 and luminance /10000.
  // Serialize G,B,R (not source object order) and L(max,min). BigInt prevents
  // an apparently harmless floating-point conversion from changing metadata.
  // https://x265.readthedocs.io/en/stable/cli.html#cmdoption-master-display
  // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/libx265.c
  const chroma = key => scaledRational(values[key], 50000, 65535, key);
  const luminance = key => scaledRational(values[key], 10000, 4294967295, key);
  return `G(${chroma('green_x')},${chroma('green_y')})B(${chroma('blue_x')},${chroma('blue_y')})R(${chroma('red_x')},${chroma('red_y')})WP(${chroma('white_point_x')},${chroma('white_point_y')})L(${luminance('max_luminance')},${luminance('min_luminance')})`;
}
function lightSignal(entry) {
  if (entry.value === null && entry.signalValue === 0 && entry.reason === 'unspecified-zero-light-level') return 0;
  if (!Number.isSafeInteger(entry.value) || entry.value < 1 || entry.value > 65535) fail('HDR_METADATA_INVALID', 'The content-light value is invalid.');
  return entry.value;
}

function buildHdrIdentityPacking(options) {
  const input = snapshot(options);
  record(input, ['inputFormat', 'outputFormat', 'transfer', 'primaries', 'matrix', 'range', 'chromaLocation'],
    ['inputFormat', 'outputFormat', 'transfer', 'primaries', 'matrix', 'range', 'chromaLocation'], 'HDR packing request');
  if (!['yuv420p10le', 'p010le'].includes(input.inputFormat) || !['yuv420p10le', 'p010le'].includes(input.outputFormat)
      || input.inputFormat === input.outputFormat || input.range !== 'tv'
      || !['left', 'center', 'topleft', 'top', 'bottomleft', 'bottom'].includes(input.chromaLocation)
      || !(input.matrix === 'bt2020nc' && input.primaries === 'bt2020' && ['smpte2084', 'arib-std-b67'].includes(input.transfer)
        || input.matrix === 'bt709' && input.primaries === 'bt709' && input.transfer === 'bt709')) {
    fail('HDR_PACKING_UNQUALIFIED', 'Identity packing requires exact coherent 10-bit signal and chroma-location evidence.');
  }
  // format negotiates a pixel layout; it does not perform conversion when
  // strict +pix_fmt disables auto insertion. This is one explicit identity-size
  // converter with unchanged matrix/range/TRC/primaries/chroma siting, not an
  // implicit scaler or permission to resize. Native raw round-trip equality is
  // required before granting this runtime/layout cell.
  // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavfilter/vf_scale.c
  // https://ffmpeg.org/ffmpeg-scaler.html
  const filterGraph = `scale=w=iw:h=ih:flags=neighbor+bitexact+accurate_rnd:in_color_matrix=${input.matrix}:out_color_matrix=${input.matrix}`
    + `:in_range=tv:out_range=tv:in_chroma_loc=${input.chromaLocation}:out_chroma_loc=${input.chromaLocation}`
    + `:in_primaries=${input.primaries}:out_primaries=${input.primaries}:in_transfer=${input.transfer}:out_transfer=${input.transfer},format=${input.outputFormat}`;
  return freeze({ ...input, filterGraph, geometry: 'identity-iw-ih', qualification: 'full-numeric-sample-and-signal-roundtrip-required', executable: false });
}

function buildHdrEncoding(options) {
  const input = snapshot(options);
  record(input, ['settings', 'policy', 'videoEvidence', 'frameEvidence', 'outputBitDepth', 'target'], ['settings', 'policy', 'videoEvidence'], 'HDR encoding request');
  const recipe = describeRecipe(input.settings);
  // Initial writer qualification deliberately remains HEVC-specific. Existing
  // SDR six-profile execution still uses media.cjs unchanged; AV1/H.264 HDR or
  // SDR-conversion writers must not inherit HEVC-only metadata options.
  if (!['h265-cpu', 'h265-nvidia'].includes(recipe.settings.profileId)) fail('HDR_ENCODER_UNQUALIFIED', 'This HDR writer foundation currently covers CPU/NVIDIA HEVC only.');
  const target = input.target ?? 'matroska';
  if (target !== 'matroska') fail('HDR_CONTAINER_UNQUALIFIED', 'HDR encoding to this container requires a separate qualified writer contract.');
  const contract = resolveHdrContract({ policy: input.policy, videoEvidence: input.videoEvidence, outputCodec: 'h265',
    ...(own(input, 'frameEvidence') ? { frameEvidence: input.frameEvidence } : {}),
    ...(own(input, 'outputBitDepth') ? { outputBitDepth: input.outputBitDepth } : {}), target });
  if (contract.route === 'existing-sdr') fail('HDR_EXISTING_SDR_PATH', 'Unchanged SDR must use the existing accepted production builder.');
  const retained = contract.metadataDisposition.values || {};
  const expectedMetadata = { mastering: retained.mastering || null, contentLight: retained.contentLight || null, ambient: retained.ambient || null };
  const metadataText = expectedMetadata.mastering ? masterDisplayString(expectedMetadata.mastering) : null;
  const lightText = expectedMetadata.contentLight ? `${lightSignal(expectedMetadata.contentLight.max_content)},${lightSignal(expectedMetadata.contentLight.max_average)}` : null;
  const missingWriters = [];
  if (expectedMetadata.ambient) missingWriters.push({ code: 'HDR_AMBIENT_WRITER_UNQUALIFIED', field: 'ambient',
    requirement: 'Identify a bounded exact ambient-viewing metadata writer and independently round-trip its bitstream and container values. No omission or invented replacement is authorized.' });

  const encoderArgs = [...recipe.args];
  const isCpu = recipe.backend === 'CPU';
  const metadataWriter = { mastering: 'absent', contentLight: 'absent', ambient: expectedMetadata.ambient ? 'unavailable' : 'absent' };
  if (isCpu) {
    const index = encoderArgs.indexOf('-x265-params');
    if (index < 0 || typeof encoderArgs[index + 1] !== 'string') fail('HDR_RECIPE_CONTRACT_CHANGED', 'The canonical x265 contribution no longer exposes its parameter dictionary.');
    const parameters = [encoderArgs[index + 1]];
    if (metadataText) { parameters.push(`master-display=${metadataText}`); metadataWriter.mastering = 'explicit-x265-parameter'; }
    // x265 otherwise defaults to emitting unspecified zero CLL in some HDR
    // cases. Preserve an explicitly observed 0/0, but do not invent it for an
    // absent CLL entry. No hdr10-opt or other quality recipe is introduced.
    parameters.push(`cll=${lightText === null ? '0' : '1'}`);
    if (lightText !== null) { parameters.push(`max-cll=${lightText}`); metadataWriter.contentLight = 'explicit-x265-parameter'; }
    encoderArgs[index + 1] = parameters.join(':');
    // The pinned wrapper defaults to auto Dolby handling. All routes here
    // intentionally produce non-Dolby output, including the explicit RPU route.
    encoderArgs.push('-dolbyvision:v:0', '0');
  } else {
    // nvenc_setup_hevc_config and nvenc_set_mastering_display_data have an
    // SDK>=13 path using decoded_side_data and frame side data. It is distinct
    // from extra_sei. The built binary, filters and actual GPU must round-trip
    // this path; source code is not a native capability receipt.
    // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/nvenc.c
    // https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/nvenc.h
    if (metadataText) metadataWriter.mastering = 'nvenc-decoded-side-data-native-qualification-required';
    if (lightText !== null) metadataWriter.contentLight = 'nvenc-decoded-side-data-native-qualification-required';
  }
  const signal = contract.expectedOutput;
  const packing = isCpu ? signal.pixelFormat : signal.bitDepth === 10 ? 'p010le' : 'yuv420p';
  const filters = contract.filterContribution ? [...contract.filterContribution.beforeScale, ...contract.filterContribution.afterScale] : [];
  const chroma = contract.source.signal.chromaLocation;
  const incomingFormat = contract.filterContribution ? signal.pixelFormat : contract.source.signal.pixelFormat;
  let packingConversion = null;
  if (incomingFormat !== packing && signal.bitDepth === 10) {
    if (chroma === null) missingWriters.push({ code: 'HDR_PACKING_CHROMA_UNRESOLVED', field: 'chromaLocation',
      requirement: 'Establish exact input/output chroma siting before an identity-layout conversion; do not guess a location.' });
    else {
      packingConversion = buildHdrIdentityPacking({ inputFormat: incomingFormat, outputFormat: packing, transfer: signal.transfer,
        primaries: signal.primaries, matrix: signal.matrix, range: signal.range, chromaLocation: chroma });
      filters.push(packingConversion.filterGraph);
    }
  } else filters.push(`format=${packing}`);
  encoderArgs.push('-profile:v:0', signal.bitDepth === 10 ? 'main10' : 'main', '-pix_fmt:v:0', `+${packing}`,
    '-fps_mode:v:0', 'passthrough', '-color_trc:v:0', signal.transfer, '-color_primaries:v:0', signal.primaries,
    '-colorspace:v:0', signal.matrix, '-color_range:v:0', signal.range);
  if (chroma !== null) {
    if (!['left', 'center', 'topleft', 'top', 'bottomleft', 'bottom'].includes(chroma)) fail('HDR_CHROMA_LOCATION_UNQUALIFIED', 'The source chroma location is not a qualified FFmpeg value.');
    encoderArgs.push('-chroma_sample_location:v:0', chroma);
  }
  const requirements = [...contract.qualificationRequirements, 'matching-pinned-9.0.2-binary-pair',
    'source-stream-and-decoded-hdr-metadata-consistency', 'no-unexpected-encoder-option-warnings',
    'separate-full-operation-preservation-and-timeline-validator', 'elementary-bitstream-and-container-metadata-round-trip'];
  if (!isCpu && (metadataText || lightText !== null)) requirements.push('nvenc-sdk13-static-metadata-through-actual-filter-and-device');
  if (!expectedMetadata.mastering || !expectedMetadata.contentLight) requirements.push('absent-static-metadata-not-fabricated-by-wrapper-or-muxer');
  if (chroma === null) requirements.push('source-and-output-chroma-siting-qualification');
  if (packingConversion) requirements.push('identity-packing-full-numeric-sample-and-signal-roundtrip');
  const decisions = [...contract.decisionRequirements];
  if (contract.source.metadata.dolby && decisions.length === 0) decisions.push({
    kind: input.policy === 'hlg-base' ? 'dolby-hlg-base' : 'dolby-aware-pq', scope: 'exact-source-and-draft', authority: 'unbound',
    message: input.policy === 'hlg-base'
      ? 'Use the compatible HLG base without applying or retaining Dolby Vision metadata.'
      : 'Apply compatible Dolby information to produce PQ output; the result does not retain Dolby Vision.',
  });
  const plan = {
    version: HDR_ENCODING_VERSION, status: missingWriters.length ? 'writer-unavailable' : 'native-qualification-required', executable: false,
    helpBasis: HELP_BASIS, settings: recipe.settings, route: contract.route, contract,
    sourceHdrEvidenceSha256: createHash('sha256').update(JSON.stringify(contract.source)).digest('hex'),
    ordinaryRecipeArgs: recipe.args, metadataWriter, missingWriters, packingConversion,
    // Do not offer a runnable-looking fragment that would silently drop ambient
    // metadata. Its descriptive ExpectedOutput remains available for diagnosis.
    videoEncoderArgs: missingWriters.length ? null : encoderArgs,
    filterGraph: missingWriters.length ? null : filters.join(','),
    expectedOutput: { codec: 'hevc', profile: signal.bitDepth === 10 ? 'Main 10' : 'Main', target,
      signal: { transfer: signal.transfer, primaries: signal.primaries, matrix: signal.matrix, range: signal.range,
        pixelFormat: signal.pixelFormat, bitDepth: signal.bitDepth, chromaLocation: chroma },
      metadata: expectedMetadata, dolbyVision: false, hdr10Claim: false, scanMode: 'progressive',
      validationScope: 'HDR signal and static metadata only; not ancillary, cadence, geometry, publication or perceptual acceptance' },
    qualificationRequirements: [...new Set([...requirements, ...missingWriters.map(item => item.code)])],
    decisionRequirements: decisions,
  };
  freeze(plan); plans.add(plan); return plan;
}

function equivalentRational(actual, expected) {
  if (typeof actual !== 'string' || !/^\d{1,40}\/\d{1,40}$/.test(actual)) return false;
  const [numerator, denominator] = actual.split('/').map(BigInt);
  return denominator > 0n && numerator * BigInt(expected.denominator) === BigInt(expected.numerator) * denominator;
}
function rawLight(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string' && /^\d{1,5}$/.test(value))
    && Number(value) >= 0 && Number(value) <= 65535 ? Number(value) : null;
}

function validateHdrEncodingOutput(plan, observations) {
  const issues = [], coverage = {}; let issueCount = 0;
  const add = (code, plane, field, frame = null) => { issueCount++; if (issues.length < 128) issues.push({ code, plane, field, frame }); };
  const result = () => ({ valid: issueCount === 0, issues, issueCount, issuesTruncated: issueCount > issues.length,
    errors: issues.map(item => `${item.plane}: ${item.code} (${item.field}${item.frame === null ? '' : `, frame ${item.frame}`}).`),
    validationScope: 'hdr-signal-and-static-metadata', publicationAuthorized: false,
    capabilityGranted: false, perceptualAcceptance: 'not-assessed', coverage });
  if (!plans.has(plan)) { add('HDR_PLAN_NOT_OWNED', 'request', 'plan'); return result(); }
  if (plan.missingWriters.length) { add('HDR_WRITER_UNAVAILABLE', 'request', 'metadata'); return result(); }
  try {
    const evidence = snapshot(observations);
    record(evidence, ['container', 'bitstream'], ['container', 'bitstream'], 'HDR validation evidence');
    for (const planeName of ['container', 'bitstream']) {
      const plane = evidence[planeName];
      record(plane, ['video', 'frames', 'coverage', 'decodedFrameCount', 'decodeExitCode'], ['video', 'frames', 'coverage', 'decodedFrameCount', 'decodeExitCode'], 'HDR observation plane');
      if (!plain(plane.video) || !Array.isArray(plane.frames) || plane.frames.length < 1 || plane.frames.length > MAX_FRAME_SAMPLES
          || !['full', 'sampled'].includes(plane.coverage) || !Number.isSafeInteger(plane.decodedFrameCount) || plane.decodedFrameCount < plane.frames.length
          || plane.coverage === 'full' && plane.decodedFrameCount !== plane.frames.length || plane.decodeExitCode !== 0) {
        add('HDR_OBSERVATION_INCOMPLETE', planeName, 'coverage'); continue;
      }
      coverage[planeName] = { kind: plane.coverage, observedFrames: plane.frames.length, decodedFrameCount: plane.decodedFrameCount };
      const video = plane.video;
      if (video.codec_type !== 'video' || video.codec_name !== plan.expectedOutput.codec || video.profile !== plan.expectedOutput.profile
          || !Number.isSafeInteger(video.index) || video.index < 0) add('HDR_OUTPUT_CODEC_MISMATCH', planeName, 'codec');
      const seenMetadata = new Set();
      const checkSignal = (item, frame) => {
        const signal = plan.expectedOutput.signal;
        for (const [field, expected] of [['color_transfer', signal.transfer], ['color_primaries', signal.primaries],
          ['color_space', signal.matrix], ['color_range', signal.range], ['pix_fmt', signal.pixelFormat]]) {
          if (item[field] !== expected) add('HDR_OUTPUT_SIGNAL_MISMATCH', planeName, field, frame);
        }
        if (signal.chromaLocation !== null && item.chroma_location !== signal.chromaLocation) add('HDR_OUTPUT_SIGNAL_MISMATCH', planeName, 'chroma_location', frame);
      };
      const checkMetadata = (item, frame) => {
        const entries = item.side_data_list ?? [];
        if (!Array.isArray(entries) || entries.length > 64) { add('HDR_OUTPUT_METADATA_INVALID', planeName, 'side_data_list', frame); return; }
        const inRecord = new Set();
        for (const entry of entries) {
          if (!plain(entry) || typeof entry.side_data_type !== 'string') { add('HDR_OUTPUT_METADATA_INVALID', planeName, 'side_data_type', frame); continue; }
          const type = entry.side_data_type, key = own(SIDE_TYPES, type) ? SIDE_TYPES[type] : null;
          if (key) {
            if (inRecord.has(key)) add('HDR_OUTPUT_METADATA_DUPLICATE', planeName, key, frame);
            inRecord.add(key); seenMetadata.add(key);
            const expected = plan.expectedOutput.metadata[key];
            if (!expected) { add('HDR_OBSOLETE_OR_FABRICATED_METADATA', planeName, key, frame); continue; }
            if (key === 'contentLight') {
              for (const field of ['max_content', 'max_average']) if (rawLight(entry[field]) !== lightSignal(expected[field])) add('HDR_OUTPUT_METADATA_MISMATCH', planeName, field, frame);
            } else {
              for (const field of key === 'mastering' ? MASTER_FIELDS : AMBIENT_FIELDS) if (!equivalentRational(entry[field], expected[field])) add('HDR_OUTPUT_METADATA_MISMATCH', planeName, field, frame);
            }
          } else if (/hdr|dolby|dovi|ambient|mastering|content.light/i.test(type)) {
            // Unknown dynamic/color payloads are never silently accepted just
            // because the ordinary VUI happens to contain the expected transfer.
            add('HDR_UNEXPECTED_DYNAMIC_OR_COLOR_METADATA', planeName, 'side_data_type', frame);
          }
        }
      };
      checkSignal(video, null); checkMetadata(video, null);
      // Elementary HEVC probes can omit the stream-level scan declaration even
      // when every decoded frame explicitly proves progressive presentation.
      // Only complete, successful, exactly counted frame evidence may resolve
      // that absence. It must never override an explicit interlaced declaration
      // or turn sampled/ambiguous decoded evidence into a progressive claim.
      const scanDeclarationAbsent = !own(video, 'field_order') || video.field_order === 'unknown';
      const completeProgressiveFrames = plane.coverage === 'full' && plane.decodedFrameCount === plane.frames.length
        && plane.frames.every(frame => plain(frame) && frame.media_type === 'video' && frame.stream_index === video.index
          && (frame.interlaced_frame === 0 || frame.interlaced_frame === '0'));
      if (video.field_order !== 'progressive') {
        if (scanDeclarationAbsent && completeProgressiveFrames) coverage[planeName].scanModeEvidence = 'complete-progressive-decoded-frames';
        else add('HDR_OUTPUT_SCAN_UNRESOLVED', planeName, 'field_order');
      }
      for (const [index, frame] of plane.frames.entries()) {
        if (!plain(frame) || frame.media_type !== 'video' || frame.stream_index !== video.index) { add('HDR_FRAME_IDENTITY_INVALID', planeName, 'stream_index', index); continue; }
        checkSignal(frame, index); checkMetadata(frame, index);
        if (frame.interlaced_frame !== 0 && frame.interlaced_frame !== '0') add('HDR_OUTPUT_SCAN_UNRESOLVED', planeName, 'interlaced_frame', index);
      }
      for (const key of Object.keys(SIDE_TYPES).map(type => SIDE_TYPES[type])) if (plan.expectedOutput.metadata[key] && !seenMetadata.has(key)) add('HDR_REQUIRED_METADATA_MISSING', planeName, key);
    }
  } catch (error) {
    add(error instanceof ToolError ? error.code : 'INVALID_HDR_ENCODING', 'request', 'observations');
  }
  return result();
}

module.exports = { HDR_ENCODING_VERSION, HELP_BASIS, MAX_FRAME_SAMPLES, buildHdrIdentityPacking, buildHdrEncoding, validateHdrEncodingOutput };
