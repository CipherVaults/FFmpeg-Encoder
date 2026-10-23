'use strict';

// Pure media decisions shared by preparation and execution. Nothing in this
// module launches a process or trusts renderer-provided paths/FFmpeg options.
const path = require('node:path');

function mediaError(code, message) {
  return Object.assign(new Error(message), { code });
}

function deepFreeze(value) {
  Object.values(value).forEach((item) => {
    if (item && typeof item === 'object') deepFreeze(item);
  });
  return Object.freeze(value);
}

const CPU_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const NVIDIA_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const YUV8 = ['yuv420p', 'yuvj420p', 'yuv422p', 'yuvj422p', 'yuv444p', 'yuvj444p', 'gray'];
const YUV10 = ['yuv420p10le', 'yuv422p10le', 'yuv444p10le', 'gray10le'];

// These are adopted engineering defaults, not quality-equivalent presets or a
// perceptual benchmark. Pinned 9.0.1 help and short real 8/10-bit encodes establish
// the exposed choices; scripts/validate-profile-options.cjs checks the production
// builder's presets and quality boundaries. Each actual device must still pass
// runtime capability checks: a compiled NVENC name does not prove GPU support.
const PROFILES = deepFreeze([
  {
    id: 'h264-cpu', label: 'H264 · CPU', codec: 'H264', hardware: 'CPU', encoder: 'libx264',
    presets: CPU_PRESETS, defaultPreset: 'slower', quality: { mode: 'CRF', min: 0, max: 51, default: 24 },
    suffix: 'H264-CPU', pixelFormats: [...YUV8, ...YUV10], bitDepths: [8, 10], provisional: false,
  },
  {
    id: 'h265-cpu', label: 'H265 · CPU', codec: 'H265', hardware: 'CPU', encoder: 'libx265',
    presets: CPU_PRESETS, defaultPreset: 'slow', quality: { mode: 'CRF', min: 0, max: 51, default: 25 },
    // Runtime capabilities and this milestone cover 8/10-bit SDR. The library
    // also lists 12-bit formats, but those are not an accepted product feature.
    suffix: 'H265-CPU', pixelFormats: [...YUV8, ...YUV10], bitDepths: [8, 10], provisional: false,
  },
  {
    id: 'av1-cpu', label: 'AV1 · CPU', codec: 'AV1', hardware: 'CPU', encoder: 'libsvtav1',
    // SVT maps 12/13 to 11 and warns that non-RTC presets 10+ are for automation
    // tooling with possible visual artifacts. Offer its ordinary video range.
    presets: Array.from({ length: 10 }, (_, index) => String(index)), defaultPreset: '6',
    // In the pinned wrapper, CRF zero leaves SVT's default (35) in effect. Keep
    // the control honest by exposing only explicit rate-factor values 1..63.
    quality: { mode: 'CRF', min: 1, max: 63, default: 32 }, suffix: 'AV1-CPU',
    pixelFormats: ['yuv420p', 'yuv420p10le'], bitDepths: [8, 10], provisional: false,
  },
  ...[
    ['h264-nvidia', 'H264', 'h264_nvenc', 28, 51],
    ['h265-nvidia', 'H265', 'hevc_nvenc', 25, 51],
    ['av1-nvidia', 'AV1', 'av1_nvenc', 30, 63],
  ].map(([id, codec, encoder, quality, maximum]) => ({
    id, label: `${codec} · NVIDIA`, codec, hardware: 'NVIDIA', encoder,
    presets: NVIDIA_PRESETS, defaultPreset: 'p5',
    // CQ zero means automatic in the shipped encoder; do not present it as a
    // fixed quality level. This differs deliberately from CPU CRF ranges.
    quality: { mode: 'CQ', min: 1, max: maximum, default: quality },
    suffix: `${codec}-Nvidia-GPU`, pixelFormats: ['yuv420p', 'nv12', 'yuv420p10le', 'p010le'],
    bitDepths: [8, 10], provisional: false,
  })),
]);

// Compound recipes supplement native preset/quality controls; they never
// replace Tested Default. Runtime probes and benchmark acceptance gate use.
const ARCHIVE_RECIPE = deepFreeze({
  id: 'archive-quality-hevc-v1', profileId: 'h265-nvidia',
  label: 'Archive Quality — Ada/Blackwell NVENC', preset: 'p7', quality: 29,
  evidenceNote: 'A measured starting point; quality and size vary by scene. Ada support is documented and capability-gated; local benchmark evidence applies to Blackwell only. CRF and CQ numbers are not equivalent.',
});

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(settings))) {
    throw mediaError('INVALID_SETTINGS', 'Encoding settings must be a plain object.');
  }
  const expectedKeys = ['profileId', 'preset', 'quality', ...(Object.hasOwn(settings, 'recipeId') ? ['recipeId'] : [])];
  if (Reflect.ownKeys(settings).length !== expectedKeys.length
      || expectedKeys.some((key) => !Object.hasOwn(settings, key))) {
    throw mediaError('INVALID_SETTINGS', 'Only profileId, preset, quality, and a known recipeId are accepted.');
  }
  const profile = PROFILES.find((item) => item.id === settings.profileId);
  if (!profile) throw mediaError('INVALID_SETTINGS', 'Choose a supported encoding profile.');
  if (Object.hasOwn(settings, 'recipeId') && (settings.recipeId !== ARCHIVE_RECIPE.id || profile.id !== ARCHIVE_RECIPE.profileId)) {
    throw mediaError('INVALID_SETTINGS', 'This named recipe is not supported by the selected profile.');
  }
  if (typeof settings.preset !== 'string' || !profile.presets.includes(settings.preset)) {
    throw mediaError('INVALID_SETTINGS', `The preset is not supported by ${profile.label}.`);
  }
  if (!Number.isInteger(settings.quality)
      || settings.quality < profile.quality.min || settings.quality > profile.quality.max) {
    throw mediaError('INVALID_SETTINGS', `${profile.quality.mode} must be an integer from ${profile.quality.min} to ${profile.quality.max}.`);
  }
  return { profileId: profile.id, preset: settings.preset, quality: settings.quality,
    ...(settings.recipeId ? { recipeId: settings.recipeId } : {}) };
}

// The encoder contribution has one source of truth for execution, settings
// help and descriptive provenance. Its fragments preserve production ordering:
// stream metadata/dispositions are inserted between codec and encoder options.
// Source-dependent pixel/profile/color decisions remain in the prepared plan.
function encoderContribution(profile, settings) {
  const codec = ['-c:v:0', profile.encoder];
  const preset = ['-preset:v:0', settings.preset];
  const archive = settings.recipeId === ARCHIVE_RECIPE.id;
  const options = profile.hardware === 'NVIDIA'
    ? ['-rc:v:0', 'vbr', '-cq:v:0', String(settings.quality), '-b:v:0', '0', '-tune:v:0', archive ? 'uhq' : 'hq']
    : ['-crf:v:0', String(settings.quality)];
  if (archive) options.push('-multipass:v:0', 'fullres', '-bf:v:0', '4', '-b_ref_mode:v:0', 'each');
  if (profile.encoder === 'libx265') options.push('-x265-params', 'aq-mode=3:psy-rd=2');
  return { codec, preset, options };
}

function recipeDescription(settings) {
  const validated = validateSettings(settings);
  const profile = PROFILES.find((item) => item.id === validated.profileId);
  const contribution = encoderContribution(profile, validated);
  let presetHelp;
  if (profile.hardware === 'NVIDIA') {
    presetHelp = 'P1 prioritizes speed; P7 permits more encoding effort. This selects the native NVENC preset only. The current rate-control and tune options are listed separately in the encoder arguments.';
  } else if (profile.encoder === 'libsvtav1') {
    presetHelp = 'Lower SVT-AV1 preset numbers use more encoding effort; higher numbers prioritize speed. These numbers are native SVT presets, not NVIDIA P1–P7 equivalents.';
  } else {
    presetHelp = 'Slower CPU presets allow more encoding effort for compression efficiency; faster presets prioritize speed. A preset is separate from CRF and does not promise a particular file size or equal quality across encoders.';
  }
  return {
    settings: validated,
    label: profile.label,
    codec: profile.codec,
    encoder: profile.encoder,
    backend: profile.hardware,
    qualityMode: profile.quality.mode,
    recipe: validated.recipeId ? ARCHIVE_RECIPE : null,
    args: [...contribution.codec, ...contribution.preset, ...contribution.options],
    presetContribution: [...contribution.preset],
    presetHelp,
    qualityHelp: profile.quality.mode === 'CQ'
      ? 'CQ is the NVENC target quality in the current VBR mode with no target bitrate. Lower values generally request higher quality and larger files. CQ and CPU CRF numbers are not quality-equivalent, nor are equal values across codecs.'
      : 'CRF is this encoder\'s quality-based rate control. Lower values generally request higher quality and larger files. CRF values are not quality-equivalent across encoders or interchangeable with NVIDIA CQ.',
    mediaNote: 'These are the deterministic video-encoder options, not a complete command. Preparation resolves stream mapping, preserved metadata, pixel format/bit depth, hardware codec profile, color, provenance and input/output paths from each inspected file.',
  };
}

function describeRecipe(settings) {
  const recipe = recipeDescription(settings);
  const profile = PROFILES.find((item) => item.id === recipe.settings.profileId);
  return {
    ...recipe,
    // A default is an ordinary editable settings tuple, never a hidden mode.
    // Resolve it through exactly the same contribution builder as manual edits.
    testedDefault: recipeDescription({
      profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default,
    }),
  };
}

function streamsOf(probe) {
  if (!probe || !Array.isArray(probe.streams)) {
    throw mediaError('INVALID_PROBE', 'The media probe did not return a stream list.');
  }
  const indexes = new Set();
  for (const stream of probe.streams) {
    if (!stream || !Number.isSafeInteger(stream.index) || stream.index < 0 || indexes.has(stream.index)) {
      throw mediaError('INVALID_PROBE', 'The media probe returned an invalid or duplicate stream index.');
    }
    indexes.add(stream.index);
  }
  return probe.streams;
}

function selectVideo(probe) {
  const videos = streamsOf(probe).filter((stream) => stream.codec_type === 'video'
    && Number(stream.disposition?.attached_pic || 0) !== 1);
  const selected = videos.find((stream) => Number(stream.disposition?.default || 0) === 1) || videos[0];
  if (!selected) throw mediaError('NO_VIDEO', 'No non-attached video stream was found.');
  return selected;
}

const SDR_TRANSFERS = new Set(['bt709', 'gamma22', 'gamma28', 'smpte170m', 'smpte240m', 'iec61966-2-1', 'bt2020-10', 'bt2020-12']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const UNKNOWN_VALUES = new Set(['', 'unknown', 'unspecified', 'reserved', 'n/a']);
const DYNAMIC_HDR_TYPES = new Set([
  'dovi configuration record',
  'dolby vision rpu data',
  'dolby vision metadata',
  'dovi rpu data',
  'dovi metadata',
  'hdr10+ dynamic metadata (smpte 2094-40)',
  'hdr dynamic metadata smpte2094-40 (hdr10+)',
  'hdr dynamic metadata smpte2094-10',
]);
const STATIC_HDR_TYPES = new Set(['mastering display metadata', 'content light level metadata']);

function normalizeSignal(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function classifyColor(probe, frameSamples = []) {
  let video;
  try {
    video = selectVideo(probe);
  } catch (error) {
    return { classification: 'ambiguous', supported: false, reasons: [error.message], transfer: null, videoIndex: null };
  }
  const frames = [];
  let samplingFailed = false;
  // Accept either the collected frames or bounded ffprobe window results. An
  // explicit failed window cannot be mistaken for an empty successful sample.
  if (!Array.isArray(frameSamples)) {
    samplingFailed = true;
  } else {
    for (const sample of frameSamples) {
      if (!sample || sample.error || sample.failed) {
        samplingFailed = true;
      } else if (Array.isArray(sample.frames)) {
        frames.push(...sample.frames);
      } else {
        frames.push(sample);
      }
    }
  }
  const selectedFrames = frames.filter((frame) => frame && frame.media_type !== 'audio'
    && (frame.stream_index === undefined || frame.stream_index === video.index)
    && Number(frame.disposition?.attached_pic || 0) !== 1);
  const records = [video, ...selectedFrames];
  const transfers = new Set(records.map((record) => normalizeSignal(record.color_transfer))
    .filter((value) => !UNKNOWN_VALUES.has(value)));
  const sideData = records.flatMap((record) => Array.isArray(record.side_data_list) ? record.side_data_list : []);
  const dynamic = sideData.filter((entry) => DYNAMIC_HDR_TYPES.has(normalizeSignal(entry.side_data_type)));
  const staticMetadata = sideData.some((entry) => STATIC_HDR_TYPES.has(normalizeSignal(entry.side_data_type)));
  const hdrTransfers = [...transfers].filter((value) => HDR_TRANSFERS.has(value));

  // Positive HDR signaling wins over contradictory SDR tags and failed samples.
  // Bit depth, pixel format, codec profile, primaries and filenames are never HDR
  // predicates; a 10-bit BT.2020 stream can legitimately carry SDR content.
  if (hdrTransfers.length || dynamic.length) {
    const reasons = hdrTransfers.map((value) => `Unsupported HDR transfer: ${value}.`);
    if (dynamic.length) reasons.push('Unsupported Dolby Vision or dynamic HDR metadata is present.');
    return { classification: 'hdr', supported: false, reasons, transfer: hdrTransfers[0] || null, videoIndex: video.index };
  }

  const reasons = [];
  if (samplingFailed) reasons.push('A required decoded-frame color sample failed.');
  if (!transfers.size) reasons.push('The transfer characteristic is missing or unknown in all inspected evidence.');
  if (transfers.size > 1) reasons.push('Inspected stream and frame transfer characteristics conflict.');
  if ([...transfers].some((value) => !SDR_TRANSFERS.has(value))) reasons.push('The transfer characteristic is outside the supported SDR set.');
  if (staticMetadata) reasons.push('Static mastering-display or content-light metadata has no coherent supported HDR transfer.');
  const transfer = transfers.size === 1 ? [...transfers][0] : null;
  return {
    classification: reasons.length ? 'ambiguous' : 'sdr',
    supported: reasons.length === 0,
    reasons: reasons.length ? reasons : ['Coherent recognized SDR transfer with no detected HDR metadata.'],
    transfer,
    videoIndex: video.index,
  };
}

// Explicit Matroska stream-copy allowlists avoid silently dropping tracks or
// quietly transcoding them to make a container succeed. Unlisted cases produce
// an actionable per-file failure and can be expanded with real mux/probe tests.
const AUDIO_CODECS = new Set([
  'aac', 'ac3', 'alac', 'atrac1', 'dts', 'eac3', 'flac', 'mlp', 'mp1', 'mp2', 'mp3', 'opus', 'vorbis',
  'pcm_f32le', 'pcm_f64le', 'pcm_s16be', 'pcm_s24be', 'pcm_s32be',
  'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_u8',
  'qdmc', 'qdm2', 'ra_144', 'ra_288', 'atrac3', 'cook', 'sipr', 'truehd', 'tta', 'wavpack',
]);
const SUBTITLE_CODECS = new Set(['subrip', 'text', 'ass', 'ssa', 'webvtt', 'dvd_subtitle', 'dvb_subtitle', 'hdmv_pgs_subtitle', 'hdmv_text_subtitle', 'arib_caption']);
const DISPOSITIONS = new Set([
  'default', 'dub', 'original', 'comment', 'forced', 'hearing_impaired', 'visual_impaired', 'descriptions',
]);

function dispositionValue(stream) {
  const enabled = Object.entries(stream.disposition || {}).filter(([, value]) => Number(value) === 1).map(([flag]) => flag);
  if (enabled.some((flag) => !DISPOSITIONS.has(flag))) {
    throw mediaError('UNSUPPORTED_STREAM', `Stream ${stream.index} has a disposition that Matroska cannot preserve.`);
  }
  if (enabled.includes('original') && enabled.includes('dub')) {
    throw mediaError('UNSUPPORTED_STREAM', `Stream ${stream.index} is both original and dubbed; Matroska cannot preserve both flags.`);
  }
  if (enabled.includes('descriptions') && stream.codec_type !== 'subtitle') {
    throw mediaError('UNSUPPORTED_STREAM', `Stream ${stream.index} has text-description metadata on a non-subtitle stream.`);
  }
  if (stream.codec_type === 'attachment' && enabled.length) {
    throw mediaError('UNSUPPORTED_STREAM', `Attachment ${stream.index} has track dispositions that Matroska cannot preserve.`);
  }
  return enabled.join('+') || '0';
}

function mappedStreams(probe, video, preservationSelection) {
  const streams = streamsOf(probe);
  const selection = preservationSelection === undefined ? null
    : require('./encode-preservation.cjs').getEncodePreservationSelection(preservationSelection, probe);
  if (selection && selection.videoIndex !== video.index) throw mediaError('ENCODE_PRESERVATION_STALE', 'The selected primary video changed.');
  const omitted = new Set(selection?.omittedStreams.map(stream => stream.inputIndex) || []);
  const preserved = [];
  for (const stream of streams) {
    if (stream.index === video.index) continue;
    // Only the exact genuine main-owned selection can remove this timed track.
    // Keep the original probe/relationships intact for planning and validation.
    if (omitted.has(stream.index)) continue;
    if (stream.codec_type === 'video') {
      if (Number(stream.disposition?.attached_pic || 0) === 1) {
        throw mediaError('UNSUPPORTED_STREAM', `Attached picture stream ${stream.index} cannot yet be preserved safely in Matroska.`);
      }
      // The approved product encodes the primary video, not every alternate
      // camera angle. Preparation exposes this selection in the batch preview.
      continue;
    }
    if (stream.codec_type === 'audio' && AUDIO_CODECS.has(stream.codec_name)) {
      preserved.push(stream);
    } else if (stream.codec_type === 'subtitle' && SUBTITLE_CODECS.has(stream.codec_name)) {
      preserved.push(stream);
    } else if (stream.codec_type === 'attachment') {
      if (!stream.tags?.filename || !stream.tags?.mimetype) {
        throw mediaError('UNSUPPORTED_STREAM', `Attachment ${stream.index} needs filename and mimetype metadata for Matroska preservation.`);
      }
      preserved.push(stream);
    } else {
      throw mediaError('UNSUPPORTED_STREAM', `Cannot preserve ${stream.codec_type || 'unknown'} stream ${stream.index} (${stream.codec_name || 'unknown codec'}) in Matroska.`);
    }
  }
  return [video, ...preserved];
}

function validateLocalPath(value, role) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)
      || (!path.win32.isAbsolute(value) && !path.posix.isAbsolute(value))
      || /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    throw mediaError('INVALID_PATH', `${role} must be an absolute local filesystem path.`);
  }
}

function outputPixelFormat(profile, video) {
  if (!profile.pixelFormats.includes(video.pix_fmt)) {
    throw mediaError('UNSUPPORTED_PIXEL_FORMAT', `${profile.label} cannot preserve input pixel format ${video.pix_fmt || 'unknown'}.`);
  }
  // NVIDIA consumes semiplanar ten-bit samples. Repacking planar 4:2:0 into
  // p010le preserves sample depth/chroma; do not force ten-bit SDR to eight bits.
  if (profile.hardware === 'NVIDIA' && video.pix_fmt === 'yuv420p10le') return 'p010le';
  return video.pix_fmt;
}

// FFmpeg's Matroska muxer filters creation_time from track SimpleTags; only
// the container timestamp has a native DateUTC representation. Retain each
// track's exact source text under an explicit alias instead of losing it. A
// pre-existing different alias is user metadata and must never be overwritten.
const STREAM_CREATION_TIME_ALIAS = 'SOURCE_CREATION_TIME';
function streamCreationTimeAlias(stream) {
  if (!['video', 'audio', 'subtitle'].includes(stream.codec_type)) return null;
  const entries = Object.entries(stream.tags || {});
  const times = entries.filter(([key]) => key.toLowerCase() === 'creation_time').map(([, value]) => String(value));
  if (!times.length) return null;
  const aliases = entries.filter(([key]) => key.toUpperCase() === STREAM_CREATION_TIME_ALIAS).map(([, value]) => String(value));
  if (times.some(value => value !== times[0]) || aliases.some(value => value !== times[0])) {
    throw mediaError('UNSUPPORTED_METADATA', `Stream ${stream.index}: creation_time conflicts with ${STREAM_CREATION_TIME_ALIAS} or another creation_time tag; preserving both values requires a different representation.`);
  }
  return times[0];
}

function buildEncodeArgs({ input, output, settings, probe, colorEvidence, outputId, generationDescription, preservationSelection }) {
  const validated = validateSettings(settings);
  if (preservationSelection !== undefined) require('./encode-preservation.cjs').getEncodePreservationSelection(preservationSelection, probe, { input, settings: validated });
  validateLocalPath(input, 'Input');
  validateLocalPath(output, 'Output');
  if (path.win32.normalize(input).toLowerCase() === path.win32.normalize(output).toLowerCase()) {
    throw mediaError('INVALID_PATH', 'Input and output files must be different.');
  }
  const profile = PROFILES.find((item) => item.id === validated.profileId);
  const video = selectVideo(probe);
  const streamColor = classifyColor(probe);
  const color = colorEvidence || streamColor;
  // Sample-derived SDR may fill missing stream signaling, but cannot override
  // positive stream HDR, a different selected stream, or an invalid transfer.
  if (streamColor.classification === 'hdr' || color.classification === 'hdr') {
    throw mediaError('UNSUPPORTED_HDR', 'HDR encoding is unsupported for this milestone.');
  }
  if (color.classification !== 'sdr' || color.supported !== true || color.videoIndex !== video.index
      || !SDR_TRANSFERS.has(color.transfer)) {
    throw mediaError('AMBIGUOUS_COLOR', 'Input color evidence is ambiguous or unsupported.');
  }
  if (streamColor.transfer && streamColor.transfer !== color.transfer
      || (video.side_data_list || []).some((entry) => STATIC_HDR_TYPES.has(normalizeSignal(entry.side_data_type)))) {
    throw mediaError('AMBIGUOUS_COLOR', 'Sampled SDR evidence conflicts with the stream color metadata.');
  }
  const mapped = mappedStreams(probe, video, preservationSelection);
  const pixelFormat = outputPixelFormat(profile, video);
  const contribution = encoderContribution(profile, validated);
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats',
    '-progress', 'pipe:1', '-n', '-protocol_whitelist', 'file,pipe',
    '-format_whitelist', 'mov,matroska,webm,avi', '-i', input,
  ];
  for (const stream of mapped) args.push('-map', `0:${stream.index}`);
  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', ...contribution.codec);
  mapped.forEach((stream, index) => {
    args.push(`-map_metadata:s:${index}`, `0:s:${stream.index}`);
    const creationTime = streamCreationTimeAlias(stream);
    if (creationTime !== null) args.push(`-metadata:s:${index}`, `${STREAM_CREATION_TIME_ALIAS}=${creationTime}`);
    // Explicit zero suppresses FFmpeg's automatic default-stream assignment.
    args.push(`-disposition:${index}`, dispositionValue(stream));
  });
  args.push(...contribution.preset, ...contribution.options);
  if (profile.hardware === 'NVIDIA') {
    const tenBit = pixelFormat === 'p010le';
    if (profile.codec === 'H264') args.push('-profile:v:0', tenBit ? 'high10' : 'high');
    if (profile.codec === 'H265') args.push('-profile:v:0', tenBit ? 'main10' : 'main');
  }
  // A '+' requests failure rather than FFmpeg silently choosing another format.
  // The sole explicit conversion is the equivalent NVIDIA packing above.
  args.push('-pix_fmt:v:0', pixelFormat === video.pix_fmt ? `+${pixelFormat}` : pixelFormat);
  args.push('-fps_mode:v:0', 'passthrough', '-color_trc:v:0', color.transfer);
  for (const [field, option] of [
    ['color_primaries', '-color_primaries:v:0'], ['color_space', '-colorspace:v:0'], ['color_range', '-color_range:v:0'],
  ]) {
    const value = normalizeSignal(video[field]);
    if (value && !UNKNOWN_VALUES.has(value)) {
      if (!/^[a-z0-9-]+$/.test(value)) throw mediaError('INVALID_PROBE', `Invalid ${field} metadata.`);
      args.push(option, value);
    }
  }
  if (outputId !== undefined) args.push(...require('./provenance.cjs').provenanceArgs(outputId, generationDescription));
  args.push('-default_mode', 'passthrough', '-f', 'matroska', output);
  return args;
}

module.exports = {
  PROFILES, ARCHIVE_RECIPE, validateSettings, describeRecipe, selectVideo, classifyColor, buildEncodeArgs,
  // Inspection uses the same preservation/pixel policies as execution, so a
  // preview cannot approve a combination that the argument builder rejects.
  mappedStreams, outputPixelFormat,
  streamCreationTimeAlias, STREAM_CREATION_TIME_ALIAS,
};
