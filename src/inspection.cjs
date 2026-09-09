'use strict';

const { runTool, ToolError, isSharedToolFailure } = require('./process-runner.cjs');
const { PROFILES, validateSettings, selectVideo, classifyColor, mappedStreams, outputPixelFormat } = require('./media.cjs');

const UNKNOWN_COLOR = new Set(['', 'unknown', 'unspecified', 'reserved', 'n/a']);
const GENERATED_TAGS = new Set(['encoder', 'duration', 'number_of_frames', 'number_of_bytes']);
// Bump these when normalization, stream selection, color policy or sample coverage
// changes. A cache entry is evidence for these exact rules, not a lasting approval.
const INSPECTION_POLICY = Object.freeze({ normalization: 1, color: 1, sampling: 1, selection: 1, preservation: 1 });
const SAMPLING_LIMIT = 'Bounded metadata samples cannot prove the absence of untagged HDR or HDR outside inspected frames. Demuxer seeking may begin at an earlier keyframe.';
const STREAM_FIELDS = ['index', 'codec_type', 'codec_name', 'width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space', 'color_range', 'avg_frame_rate', 'r_frame_rate', 'start_time', 'duration', 'sample_rate', 'channels', 'channel_layout', 'extradata_size', 'extradata_hash'];
const FRAME_FIELDS = ['media_type', 'stream_index', 'best_effort_timestamp_time', 'pts_time', 'color_transfer', 'color_primaries', 'color_space', 'color_range'];

function invalidEvidence(message) { throw new ToolError('INVALID_PROBE', message); }
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function scalar(value) {
  return typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value));
}
function fields(value, names) {
  if (!plainObject(value)) invalidEvidence('Inspection evidence must contain objects.');
  const result = {};
  for (const name of names) if (Object.hasOwn(value, name)) {
    if (!scalar(value[name])) invalidEvidence(`Invalid inspection field: ${name}.`);
    result[name] = value[name];
  }
  return result;
}
function dictionary(value) {
  if (!plainObject(value)) invalidEvidence('Invalid inspection metadata.');
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!scalar(entry)) invalidEvidence('Invalid inspection metadata entry.');
    Object.defineProperty(result, key, { value: entry, enumerable: true, configurable: true, writable: true });
  }
  return result;
}
function sideData(value) {
  if (!Array.isArray(value)) invalidEvidence('Invalid side-data evidence.');
  return value.map(entry => fields(entry, ['side_data_type']));
}
function normalizeProbe(probe) {
  if (!plainObject(probe) || !Array.isArray(probe.streams)) invalidEvidence('Invalid stream evidence.');
  const normalized = { streams: probe.streams.map(stream => {
    const result = fields(stream, STREAM_FIELDS);
    if (Object.hasOwn(stream, 'tags')) result.tags = dictionary(stream.tags);
    if (Object.hasOwn(stream, 'disposition')) result.disposition = dictionary(stream.disposition);
    if (Object.hasOwn(stream, 'side_data_list')) result.side_data_list = sideData(stream.side_data_list);
    return result;
  }) };
  const format = probe.format || {};
  normalized.format = fields(format, ['format_name', 'duration', 'start_time']);
  if (Object.hasOwn(format, 'tags')) normalized.format.tags = dictionary(format.tags);
  const chapters = probe.chapters || [];
  if (!Array.isArray(chapters)) invalidEvidence('Invalid chapter evidence.');
  normalized.chapters = chapters.map(chapter => {
    const result = fields(chapter, ['id', 'time_base', 'start', 'end', 'start_time', 'end_time']);
    if (Object.hasOwn(chapter, 'tags')) result.tags = dictionary(chapter.tags);
    return result;
  });
  selectVideo(normalized);
  return normalized;
}
function normalizeFrames(frames) {
  if (!Array.isArray(frames)) invalidEvidence('Invalid decoded-frame evidence.');
  return frames.map(frame => {
    if (!plainObject(frame)) return null;
    const result = fields(frame, FRAME_FIELDS);
    if (Object.hasOwn(frame, 'side_data_list')) result.side_data_list = sideData(frame.side_data_list);
    return result;
  });
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function durationOf(probe, video) {
  return finitePositive(video?.duration) || finitePositive(probe.format?.duration);
}

function timestamp(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ensureNotCancelled(signal) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Operation cancelled.');
}

function parseJson(stdout, label) {
  try {
    const value = JSON.parse(stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object');
    return value;
  } catch (error) {
    throw new ToolError('INVALID_PROBE', `${label} returned invalid JSON.`, { cause: error });
  }
}

function fraction(value) {
  if (typeof value === 'number') return finitePositive(value);
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  const result = parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}

// Depth is a storage property, independent of SDR/HDR classification. Packed and
// planar 4:2:0 can represent the same samples and are equivalent after decoding.
function pixelLayout(format) {
  if (typeof format !== 'string') return null;
  const planar = /^(yuvj?|yuva)(420|422|444)p(?:(\d+)(?:le|be|msble))?$/.exec(format);
  if (planar) return { depth: planar[3] ? Number(planar[3]) : 8, chroma: planar[2], alpha: planar[1] === 'yuva' };
  const gray = /^gray(?:(\d+)(?:le|be))?$/.exec(format);
  if (gray) return { depth: gray[1] ? Number(gray[1]) : 8, chroma: 'mono', alpha: false };
  if (['nv12', 'nv21'].includes(format)) return { depth: 8, chroma: '420', alpha: false };
  if (format === 'nv16') return { depth: 8, chroma: '422', alpha: false };
  const packed = /^p([02])(10|12|16)(?:le|be)$/.exec(format);
  return packed ? { depth: Number(packed[2]), chroma: packed[1] === '0' ? '420' : '422', alpha: false } : null;
}

async function inspectMetadata(file, { ffprobe, signal, run = runTool, onStage } = {}) {
  ensureNotCancelled(signal);
  if (typeof file !== 'string' || !file || typeof ffprobe !== 'string' || !ffprobe) {
    throw new ToolError('INVALID_INSPECTION', 'Inspection requires an input file and the bundled ffprobe.');
  }
  // Inputs are selected/resolved by main. Restrict demuxer protocols as a second
  // boundary: media playlists cannot turn this local inspector into a network client.
  onStage?.({ stage: 'metadata' });
  ensureNotCancelled(signal);
  const result = await run(ffprobe, [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-show_streams', '-show_format', '-show_chapters',
    '-show_data_hash', 'sha256', '-of', 'json', '-i', file,
  ], { signal, timeoutMs: 30_000, stdoutLimit: 16 * 1024 * 1024 });
  ensureNotCancelled(signal);
  if (result.stderr?.trim()) throw new ToolError('INVALID_PROBE', 'Media metadata inspection reported an error.', { stderr: result.stderr });
  return normalizeProbe(parseJson(result.stdout, 'Media inspection'));
}

function sampleWindows(probe) {
  const video = selectVideo(probe);
  const duration = durationOf(probe, video);
  const timelineStart = timestamp(video.start_time) ?? timestamp(probe.format?.start_time) ?? 0;
  const windows = [{ label: 'start', start: 0, seconds: 2 }];
  if (duration > 10) {
    windows.push({ label: 'middle', start: duration / 2, seconds: 1 });
    windows.push({ label: 'end', start: Math.max(0, duration - 2), seconds: 2 });
  }
  return windows.map(window => {
    const seekStart = timelineStart + window.start;
    const seekEnd = seekStart + window.seconds;
    return { ...window, seekStart, seekEnd, interval: `${seekStart.toFixed(6)}%${seekEnd.toFixed(6)}` };
  });
}

function sampleCoverage(frames, window, video) {
  if (!frames.length || frames.some(frame => !frame || frame.media_type !== 'video' || frame.stream_index !== video.index)) {
    throw new ToolError('EMPTY_FRAME_SAMPLE', `The ${window.label} inspection did not return decoded frames from the selected video stream.`);
  }
  const located = frames.map(frame => timestamp(frame.best_effort_timestamp_time) ?? timestamp(frame.pts_time))
    .filter(time => time !== null && time >= window.seekStart - 0.001 && time < window.seekEnd + 0.001);
  if (!located.length) throw new ToolError('FRAME_SAMPLE_COVERAGE', `The ${window.label} inspection did not reach decoded frames inside the requested time window.`);
  return located;
}

// Rebuild policy decisions and display summaries from observations. This same path
// handles cold inspection and persisted evidence; supported/summary fields are not
// accepted from a cache record. Window locations always come from current policy.
function reconstructInspection(probeValue, evidenceValue) {
  const probe = normalizeProbe(probeValue);
  const video = selectVideo(probe);
  const duration = durationOf(probe, video);
  if (!plainObject(evidenceValue) || evidenceValue.version !== 1
      || !['frames', 'metadata-hdr'].includes(evidenceValue.mode)
      || !Array.isArray(evidenceValue.windows)) invalidEvidence('Invalid inspection evidence schema.');
  const windows = sampleWindows(probe);
  if (evidenceValue.mode === 'metadata-hdr') {
    if (evidenceValue.windows.length || classifyColor(probe).classification !== 'hdr') invalidEvidence('Metadata-only evidence must positively identify unsupported HDR.');
  } else if (evidenceValue.windows.length !== windows.length) invalidEvidence('Required frame windows are missing.');
  const samples = [];
  const sampling = [];
  const evidence = { version: 1, mode: evidenceValue.mode, windows: [] };
  for (let index = 0; index < evidenceValue.windows.length; index++) {
    const entry = evidenceValue.windows[index];
    if (!plainObject(entry) || !Object.hasOwn(entry, 'error')) invalidEvidence('Invalid frame-window evidence.');
    const frames = normalizeFrames(entry.frames);
    const window = windows[index];
    let error = entry.error;
    if (error !== null && (!plainObject(error) || typeof error.code !== 'string' || error.code.length > 100
        || typeof error.reason !== 'string' || error.reason.length > 4000)) invalidEvidence('Invalid frame-window failure.');
    let located;
    if (!error) {
      try { located = sampleCoverage(frames, window, video); }
      catch (failure) { error = { code: failure.code, reason: failure.message }; }
    }
    samples.push({ frames });
    const { seekStart, seekEnd, ...description } = window;
    if (error) {
      samples.push({ failed: true, error: error.reason });
      sampling.push({ ...description, succeeded: false, code: error.code, reason: error.reason });
    } else {
      sampling.push({ ...description, succeeded: true, frames: frames.length, framesInWindow: located.length,
        observedStart: located.reduce((min, time) => Math.min(min, time), Infinity),
        observedEnd: located.reduce((max, time) => Math.max(max, time), -Infinity) });
    }
    evidence.windows.push({ frames, error: error && { code: error.code, reason: error.reason } });
  }
  const color = classifyColor(probe, samples);
  const streamCounts = {};
  for (const stream of probe.streams) {
    const type = stream.codec_type || 'unknown';
    Object.defineProperty(streamCounts, type, { value: (Object.hasOwn(streamCounts, type) ? streamCounts[type] : 0) + 1, enumerable: true, configurable: true });
  }
  return {
    probe, color, duration, evidence,
    summary: {
      selectedVideoIndex: video.index, codec: video.codec_name || 'unknown', width: video.width, height: video.height,
      pixelFormat: video.pix_fmt || 'unknown', bitDepth: pixelLayout(video.pix_fmt)?.depth || null,
      frameRate: fraction(video.avg_frame_rate) || fraction(video.r_frame_rate), streamCounts, durationSeconds: duration,
      sampling, samplingLimit: SAMPLING_LIMIT,
    },
  };
}

function cacheableInspection(inspection) {
  const result = reconstructInspection(inspection.probe, inspection.evidence);
  return result.color.classification !== 'ambiguous'
    && (result.evidence.mode === 'metadata-hdr' || result.summary.sampling.every(window => window.succeeded));
}

async function finishInspection(file, probeValue, { ffprobe, signal, run = runTool, onStage } = {}) {
  ensureNotCancelled(signal);
  if (typeof file !== 'string' || !file || typeof ffprobe !== 'string' || !ffprobe) {
    throw new ToolError('INVALID_INSPECTION', 'Inspection requires an input file and the bundled ffprobe.');
  }
  const probe = normalizeProbe(probeValue);
  // Positive metadata HDR already determines rejection; frame decoding cannot
  // make it supported. Do not spend three subprocesses reconfirming that result.
  if (classifyColor(probe).classification === 'hdr') return reconstructInspection(probe, { version: 1, mode: 'metadata-hdr', windows: [] });
  const video = selectVideo(probe);
  const evidence = { version: 1, mode: 'frames', windows: [] };
  for (const window of sampleWindows(probe)) {
    ensureNotCancelled(signal);
    // An absolute endpoint reaches the requested time even if seeking begins at
    // an earlier keyframe. % + duration would instead measure from that keyframe
    // and could repeatedly inspect the beginning of a long GOP. Timestamp coverage
    // below prevents that false assurance while the process/output limits stay fixed.
    const { interval } = window;
    let decodedFrames = [];
    try {
      onStage?.({ stage: 'frames', window: window.label });
      ensureNotCancelled(signal);
      const sampleResult = await run(ffprobe, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-select_streams', String(video.index),
        '-read_intervals', interval, '-show_frames',
        '-show_entries', 'frame=media_type,stream_index,best_effort_timestamp_time,pts_time,color_transfer,color_primaries,color_space,color_range:frame_side_data',
        '-of', 'json', '-i', file,
      ], { signal, timeoutMs: 20_000, stdoutLimit: 8 * 1024 * 1024 });
      ensureNotCancelled(signal);
      const sample = parseJson(sampleResult.stdout, 'Decoded-frame inspection');
      decodedFrames = normalizeFrames(Array.isArray(sample.frames) ? sample.frames : []);
      if (sampleResult.stderr?.trim()) throw new ToolError('FRAME_DECODE_ERROR', `The ${window.label} decoded-frame inspection reported an error.`);
      sampleCoverage(decodedFrames, window, video);
      // Include any decoded preroll in HDR classification: observing positive HDR
      // before the requested window is still evidence, never a reason to hide it.
      evidence.windows.push({ frames: decodedFrames, error: null });
    } catch (error) {
      // A timeout, broken decode or empty window cannot be interpreted as evidence
      // of SDR. Cancellation is different: it stops the queue instead of becoming a file result.
      if (error.code === 'CANCELLED' || signal?.aborted) throw new ToolError('CANCELLED', 'Operation cancelled.', { cause: error });
      if (isSharedToolFailure(error)) throw error;
      evidence.windows.push({ frames: decodedFrames, error: { code: String(error.code || 'FRAME_SAMPLE_FAILED').slice(0, 100), reason: String(error.message).slice(0, 4000) } });
    }
  }
  return reconstructInspection(probe, evidence);
}

async function inspectInput(file, options = {}) {
  const probe = await inspectMetadata(file, options);
  return finishInspection(file, probe, options);
}

function normalizedColor(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UNKNOWN_COLOR.has(normalized) ? null : normalized;
}

function normalizedTags(tags = {}) {
  return new Map(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function equalTag(key, left, right) {
  if (left === right) return true;
  // Muxers can render the same UTC timestamp with different fractional precision.
  if (key === 'creation_time') {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    return Number.isFinite(leftTime) && leftTime === rightTime;
  }
  return false;
}

function compareTags(inputTags, outputTags, label, errors, matroskaTrack = false) {
  const actual = normalizedTags(outputTags);
  for (const [key, expected] of normalizedTags(inputTags)) {
    if (GENERATED_TAGS.has(key) || key.startsWith('_statistics_')) continue;
    // Matroska stores TrackLanguage='und', but FFmpeg omits that value from its
    // stream tags. Absence is equivalent only to this undefined-language value.
    if (matroskaTrack && key === 'language' && expected === 'und' && !actual.has(key)) continue;
    if (!actual.has(key) || !equalTag(key, expected, actual.get(key))) errors.push(`${label}: metadata '${key}' was not preserved.`);
  }
}

function enabledDispositions(stream) {
  return Object.entries(stream.disposition || {}).filter(([, value]) => Number(value) === 1).map(([key]) => key).sort();
}

function chapterTime(chapter, field) {
  const direct = Number(chapter[`${field}_time`]);
  if (chapter[`${field}_time`] !== undefined && Number.isFinite(direct)) return direct;
  const timeBase = fraction(chapter.time_base);
  const ticks = Number(chapter[field]);
  return timeBase && Number.isFinite(ticks) ? ticks * timeBase : null;
}

function validateOutput(inputInspection, outputProbe, settings) {
  const errors = [];
  try {
    const validated = validateSettings(settings);
    const profile = PROFILES.find((item) => item.id === validated.profileId);
    const inputProbe = inputInspection.probe;
    const sourceVideo = selectVideo(inputProbe);
    const expected = mappedStreams(inputProbe, sourceVideo);
    // This shares the builder's compatibility policy, so validation cannot approve
    // a format the selected profile would have silently reduced or repacked differently.
    outputPixelFormat(profile, sourceVideo);
    selectVideo(outputProbe); // Also rejects malformed, duplicate or missing stream indexes.
    const actual = outputProbe.streams;
    if (actual.length !== expected.length) errors.push(`Stream count changed: expected ${expected.length}, received ${actual.length}.`);
    const outputVideo = actual[0];
    if (!outputVideo || outputVideo.codec_type !== 'video') errors.push('The selected video was not preserved as the first mapped output stream.');
    else {
      const codec = { H264: 'h264', H265: 'hevc', AV1: 'av1' }[profile.codec];
      if (outputVideo.codec_name !== codec) errors.push(`Encoded video codec differs: expected ${codec}, received ${outputVideo.codec_name || 'unknown'}.`);
      if (outputVideo.width !== sourceVideo.width || outputVideo.height !== sourceVideo.height) errors.push('Video resolution changed.');
      const before = pixelLayout(sourceVideo.pix_fmt);
      const after = pixelLayout(outputVideo.pix_fmt);
      if (!before || !after || before.depth !== after.depth || before.chroma !== after.chroma || before.alpha !== after.alpha
          || !profile.bitDepths.includes(after.depth)) errors.push('Video bit depth, chroma or alpha was not preserved in a supported format.');
      if (inputInspection.color?.classification !== 'sdr' || inputInspection.color.supported !== true
          || inputInspection.color.videoIndex !== sourceVideo.index || classifyColor(inputProbe).classification === 'hdr') {
        errors.push('The input did not have accepted SDR evidence.');
      }
      const expectedTransfer = inputInspection.color?.transfer;
      if (!expectedTransfer || normalizedColor(outputVideo.color_transfer) !== expectedTransfer) errors.push('The accepted SDR transfer characteristic was not preserved.');
      for (const field of ['color_primaries', 'color_space', 'color_range']) {
        const beforeSignal = normalizedColor(sourceVideo[field]);
        const afterSignal = normalizedColor(outputVideo[field]);
        if (beforeSignal && afterSignal !== beforeSignal) errors.push(`Video ${field} was not preserved.`);
      }
      if (classifyColor(outputProbe).classification !== 'sdr') errors.push('The encoded output has ambiguous or unsupported color metadata.');
      const expectedFps = fraction(sourceVideo.avg_frame_rate);
      const actualFps = fraction(outputVideo.avg_frame_rate);
      // Only a declared constant cadence is compared numerically. VFR averages can
      // change with container time-base rounding without changing frame timestamps.
      const sourceRate = fraction(sourceVideo.r_frame_rate);
      if (expectedFps && sourceRate && Math.abs(expectedFps - sourceRate) < 0.0001
          && (!actualFps || Math.abs(expectedFps - actualFps) > Math.max(0.001, expectedFps * 0.0001))) {
        errors.push('Constant video cadence was not preserved.');
      }
      const beforeDuration = inputInspection.duration ?? durationOf(inputProbe, sourceVideo);
      const afterDuration = durationOf(outputProbe, outputVideo);
      if (beforeDuration && (!afterDuration || Math.abs(beforeDuration - afterDuration) > Math.max(0.25, 2 / (expectedFps || 25)))) {
        errors.push('Output duration differs from the inspected video by more than the container/frame tolerance.');
      }
    }
    expected.forEach((stream, index) => {
      const output = actual[index];
      const label = `Stream ${stream.index} → ${index}`;
      if (!output) { errors.push(`${label}: mapped stream is missing.`); return; }
      if (output.codec_type !== stream.codec_type) errors.push(`${label}: stream type changed.`);
      if (index > 0 && stream.codec_name !== output.codec_name) errors.push(`${label}: copied codec changed.`);
      const matroskaTrack = String(outputProbe.format?.format_name || '').split(',').includes('matroska')
        && ['video', 'audio', 'subtitle'].includes(stream.codec_type);
      compareTags(stream.tags, output.tags, label, errors, matroskaTrack);
      if (JSON.stringify(enabledDispositions(stream)) !== JSON.stringify(enabledDispositions(output))) errors.push(`${label}: dispositions changed.`);
      if (stream.codec_type === 'audio') {
        for (const field of ['sample_rate', 'channels', 'channel_layout']) {
          if (stream[field] !== undefined && String(stream[field]) !== String(output[field])) errors.push(`${label}: audio ${field} changed.`);
        }
      }
      if (stream.codec_type === 'attachment') {
        // show_data_hash hashes attachment extradata without exposing its bytes in
        // renderer snapshots. A missing hash cannot prove attachment preservation.
        if (!stream.extradata_hash || stream.extradata_hash !== output.extradata_hash) errors.push(`${label}: attachment content hash was not preserved.`);
        if (stream.extradata_size !== undefined && Number(stream.extradata_size) !== Number(output.extradata_size)) errors.push(`${label}: attachment size changed.`);
      }
    });
    compareTags(inputProbe.format?.tags, outputProbe.format?.tags, 'Container', errors);
    const beforeChapters = inputProbe.chapters || [];
    const afterChapters = outputProbe.chapters || [];
    if (!Array.isArray(beforeChapters) || !Array.isArray(afterChapters)) errors.push('Invalid chapter inspection data.');
    else {
      if (beforeChapters.length !== afterChapters.length) errors.push('Chapter count changed.');
      beforeChapters.forEach((chapter, index) => {
        const output = afterChapters[index];
        if (!output) return;
        for (const field of ['start', 'end']) {
          const before = chapterTime(chapter, field);
          const after = chapterTime(output, field);
          if (before === null || after === null || Math.abs(before - after) > 0.001) errors.push(`Chapter ${index}: ${field} timing changed.`);
        }
        compareTags(chapter.tags, output.tags, `Chapter ${index}`, errors);
      });
    }
  } catch (error) {
    errors.push(error.message || 'Output validation failed.');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { inspectInput, inspectMetadata, finishInspection, validateOutput, normalizeProbe, reconstructInspection, cacheableInspection, INSPECTION_POLICY };
