'use strict';
// Main-only observation, NOT an encode-admission token or preservation proof.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { runFixedTool } = require('./runtime.cjs');
const failure = code => Object.assign(new Error(code), { code });
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid'].every(key => a[key] === b[key]);
const cancelled = signal => { if (signal?.aborted) throw failure('CANCELLED'); };
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_.,-]{1,64}$/.test(value) ? value : null;
const number = (value, max, integer = false) => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= max && (!integer || Number.isSafeInteger(result)) ? result : null;
};
function summarize(stdout, bytes) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536) throw failure('SOURCE_REPORT');
  let data;
  try { data = JSON.parse(stdout); } catch { throw failure('SOURCE_REPORT'); }
  if (!data || data.format?.format_name !== 'matroska,webm' || !Array.isArray(data.streams)
      || !data.streams.length || data.streams.length > 32) throw failure('SOURCE_REPORT');
  const streams = data.streams.map(stream => {
    if (!stream || typeof stream !== 'object' || !['video', 'audio', 'subtitle', 'attachment', 'data'].includes(stream.codec_type)
        || typeof stream.index !== 'number' || number(stream.index, 31, true) === null) throw failure('SOURCE_REPORT');
    return Object.freeze({ index: stream.index, type: stream.codec_type, codec: token(stream.codec_name),
      ...(stream.codec_type === 'video' ? { width: number(stream.width, 32768, true), height: number(stream.height, 32768, true),
        pixelFormat: token(stream.pix_fmt), frameRate: typeof stream.avg_frame_rate === 'string' && /^\d{1,9}\/[1-9]\d{0,8}$/.test(stream.avg_frame_rate) ? stream.avg_frame_rate : null } : {}),
      ...(stream.codec_type === 'audio' ? { sampleRate: number(stream.sample_rate, 768000, true), channels: number(stream.channels, 64, true) } : {}) });
  });
  if (new Set(streams.map(stream => stream.index)).size !== streams.length) throw failure('SOURCE_REPORT');
  return Object.freeze({ scope: 'read-only-matroska-observation', encodeAllowed: false,
    bytes, durationSeconds: number(data.format.duration, 315576000), streams: Object.freeze(streams) });
}
async function inspectSource(source, { signal, onChild, run = runFixedTool } = {}) {
  if (process.platform !== 'linux' || typeof source !== 'string' || !path.isAbsolute(source)
      || source.includes('\0') || path.normalize(source) !== source || !/\.(mkv|webm)$/i.test(source)) throw failure('SOURCE_PATH');
  cancelled(signal);
  const before = await fs.lstat(source, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.size > 64n * 1024n ** 3n
      || before.dev === 0n || before.ino === 0n || await fs.realpath(source) !== source) throw failure('SOURCE_PATH');
  // O_NONBLOCK prevents a raced FIFO open from hanging; fstat then refuses it.
  const handle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !same(before, opened)) throw failure('SOURCE_CHANGED');
    cancelled(signal);
    // Use our held descriptor, not a later pathname replacement. No FD or path
    // comes from the renderer; the child cannot choose another demuxer/protocol.
    const result = await run('ffprobe', ['-v', 'error', '-max_alloc', '16777216', '-threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', 'matroska,webm', '-f', 'matroska',
      '-probesize', '1048576', '-analyzeduration', '1000000', '-max_streams', '32',
      '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,channels',
      '-of', 'json', '-i', `/proc/${process.pid}/fd/${handle.fd}`], { signal, onChild, timeoutMs: 10000 });
    cancelled(signal);
    const after = await handle.stat({ bigint: true });
    const named = await fs.lstat(source, { bigint: true });
    if (!same(opened, after) || !same(opened, named) || await fs.realpath(source) !== source) throw failure('SOURCE_CHANGED');
    return summarize(result.stdout, Number(opened.size));
  } finally { await handle.close(); }
}
module.exports = { inspectSource, summarize };
