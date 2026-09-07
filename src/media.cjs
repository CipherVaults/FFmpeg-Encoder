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
const YUV12 = ['yuv420p12le', 'yuv422p12le', 'yuv444p12le', 'gray12le'];

// These values are engineering candidates, not quality-equivalent presets.
// The exact shipped binary and actual device must pass real encode checks before
// a profile is advertised as available. In particular an encoder listing alone
// does not prove that NVENC can initialize on the current driver/GPU.
const PROFILES = deepFreeze([
  {
    id: 'h264-cpu', label: 'H264 · CPU', codec: 'H264', hardware: 'CPU', encoder: 'libx264',
    presets: CPU_PRESETS, defaultPreset: 'slower', quality: { mode: 'CRF', min: 0, max: 51, default: 24 },
    suffix: 'H264-CPU', pixelFormats: [...YUV8, ...YUV10], bitDepths: [8, 10], provisional: true,
  },
  {
    id: 'h265-cpu', label: 'H265 · CPU', codec: 'H265', hardware: 'CPU', encoder: 'libx265',
    presets: CPU_PRESETS, defaultPreset: 'slow', quality: { mode: 'CRF', min: 0, max: 51, default: 25 },
    suffix: 'H265-CPU', pixelFormats: [...YUV8, ...YUV10, ...YUV12], bitDepths: [8, 10, 12], provisional: true,
  },
  {
    id: 'av1-cpu', label: 'AV1 · CPU', codec: 'AV1', hardware: 'CPU', encoder: 'libsvtav1',
    presets: Array.from({ length: 14 }, (_, index) => String(index)), defaultPreset: '6',
    quality: { mode: 'CRF', min: 0, max: 63, default: 32 }, suffix: 'AV1-CPU',
    pixelFormats: ['yuv420p', 'yuv420p10le'], bitDepths: [8, 10], provisional: true,
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
    bitDepths: [8, 10], provisional: true,
  })),
]);

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(settings))) {
    throw mediaError('INVALID_SETTINGS', 'Encoding settings must be a plain object.');
  }
  const expectedKeys = ['profileId', 'preset', 'quality'];
  if (Reflect.ownKeys(settings).length !== expectedKeys.length
      || expectedKeys.some((key) => !Object.hasOwn(settings, key))) {
    throw mediaError('INVALID_SETTINGS', 'Only profileId, preset, and quality are accepted.');
  }
  const profile = PROFILES.find((item) => item.id === settings.profileId);
  if (!profile) throw mediaError('INVALID_SETTINGS', 'Choose a supported encoding profile.');
  if (typeof settings.preset !== 'string' || !profile.presets.includes(settings.preset)) {
    throw mediaError('INVALID_SETTINGS', `The preset is not supported by ${profile.label}.`);
  }
  if (!Number.isInteger(settings.quality)
      || settings.quality < profile.quality.min || settings.quality > profile.quality.max) {
    throw mediaError('INVALID_SETTINGS', `${profile.quality.mode} must be an integer from ${profile.quality.min} to ${profile.quality.max}.`);
  }
  return { profileId: profile.id, preset: settings.preset, quality: settings.quality };
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

function mappedStreams(probe, video) {
  const streams = streamsOf(probe);
  const preserved = [];
  for (const stream of streams) {
    if (stream.index === video.index) continue;
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

function buildEncodeArgs({ input, output, settings, probe, colorEvidence }) {
  const validated = validateSettings(settings);
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
  const mapped = mappedStreams(probe, video);
  const pixelFormat = outputPixelFormat(profile, video);
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats',
    '-progress', 'pipe:1', '-n', '-protocol_whitelist', 'file,pipe',
    '-format_whitelist', 'mov,matroska,webm,avi', '-i', input,
  ];
  for (const stream of mapped) args.push('-map', `0:${stream.index}`);
  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', '-c:v:0', profile.encoder);
  mapped.forEach((stream, index) => {
    args.push(`-map_metadata:s:${index}`, `0:s:${stream.index}`);
    // Explicit zero suppresses FFmpeg's automatic default-stream assignment.
    args.push(`-disposition:${index}`, dispositionValue(stream));
  });
  args.push('-preset:v:0', validated.preset);
  if (profile.hardware === 'NVIDIA') {
    args.push('-rc:v:0', 'vbr', '-cq:v:0', String(validated.quality), '-b:v:0', '0', '-tune:v:0', 'hq');
    const tenBit = pixelFormat === 'p010le';
    if (profile.codec === 'H264') args.push('-profile:v:0', tenBit ? 'high10' : 'high');
    if (profile.codec === 'H265') args.push('-profile:v:0', tenBit ? 'main10' : 'main');
  } else {
    args.push('-crf:v:0', String(validated.quality));
    if (profile.encoder === 'libx265') args.push('-x265-params', 'aq-mode=3:psy-rd=2');
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
  args.push('-default_mode', 'passthrough', '-f', 'matroska', output);
  return args;
}

module.exports = {
  PROFILES, validateSettings, selectVideo, classifyColor, buildEncodeArgs,
  // Inspection uses the same preservation/pixel policies as execution, so a
  // preview cannot approve a combination that the argument builder rejects.
  mappedStreams, outputPixelFormat,
};
