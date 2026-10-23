'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { ToolError } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { readSourceIdentity, assertIdentityMatches } = require('./source-identity.cjs');
const { normalizeProbe, parseProbeJson } = require('./inspection.cjs');
const { classifyHevcPackets } = require('./hevc-content.cjs');
const { inspectHdrContainer } = require('./hdr-container.cjs');

// Main supplies an already observed fixed-runtime runner. This module acquires
// complete input facts; it neither selects an encoder nor grants publication.
const HDR_INPUT_LIMITS = Object.freeze({ sourceBytes: 16 * 1024 * 1024, packetBytes: 24 * 1024 * 1024,
  frameBytes: 8 * 1024 * 1024, frames: 1800, durationTicks: 60000, pixelFrames: 829440000,
  childTimeoutMs: 120000, totalTimeoutMs: 240000 });
const FIELDS = ['sourcePath', 'sourceIdentity', 'probe', 'runtimeIdentity', 'profiles'];
const HASH = /^[a-f0-9]{64}$/;
const MASTER = ['red_x', 'red_y', 'green_x', 'green_y', 'blue_x', 'blue_y', 'white_point_x', 'white_point_y', 'min_luminance', 'max_luminance'];
const FRAME_FIELDS = ['media_type', 'stream_index', 'pts', 'best_effort_timestamp', 'duration', 'pkt_duration', 'width', 'height', 'pix_fmt',
  'sample_aspect_ratio', 'interlaced_frame', 'top_field_first', 'repeat_pict', 'crop_top', 'crop_bottom', 'crop_left', 'crop_right',
  'color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location'];
const receipts = new WeakMap();
const own = (v, k) => Object.hasOwn(v, k);
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const fail = (message, code = 'HDR_INPUT_INVALID') => { throw new ToolError(code, message); };
const need = (v, message, code) => { if (!v) fail(message, code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function freeze(v) { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function record(v, fields, required = fields) {
  need(plain(v) && required.every(k => own(v, k)), 'Complete plain HDR input fields are required.');
  for (const k of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, k);
    need(typeof k === 'string' && fields.includes(k) && d.enumerable && own(d, 'value'), 'HDR input fields cannot contain accessors or unknown keys.'); }
}
// This is only for small caller-owned bindings. Full observations originate in
// bounded JSON captures and are validated independently below, not truncated to
// the older small-object snapshot bound used by the HDR writer.
function bindingSnapshot(v) {
  let nodes = 0, characters = 0; const ancestors = new Set();
  function copy(x, depth) {
    need(++nodes <= 65536 && depth <= 16, 'HDR input bindings exceed their structural bound.');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') { need(Number.isFinite(x), 'HDR input numbers must be finite.'); return x; }
    if (typeof x === 'string') { characters += x.length; need(x.length <= 524288 && characters <= 2 * 1024 * 1024 && !x.includes('\0'), 'HDR input binding text exceeds its bound.'); return x; }
    need((plain(x) || Array.isArray(x)) && !ancestors.has(x), 'HDR input bindings must be inert, acyclic plain data.'); ancestors.add(x);
    const result = Array.isArray(x) ? [] : {};
    for (const k of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(x, k);
      need(typeof k === 'string' && k !== '__proto__' && d.enumerable && own(d, 'value')
        && (!Array.isArray(x) || /^(0|[1-9]\d*)$/.test(k) && Number(k) < x.length), 'HDR input bindings contain accessors or extra fields.');
      Object.defineProperty(result, k, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    need(!Array.isArray(x) || result.length === x.length && Object.keys(result).length === x.length, 'HDR input arrays must be dense.');
    ancestors.delete(x); return result;
  }
  return copy(v, 0);
}
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (plain(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const fingerprint = probe => sha(stable(normalizeProbe(bindingSnapshot(probe))));
function integer(v, label, minimum = 0n) {
  need((typeof v === 'string' || typeof v === 'number' && Number.isSafeInteger(v)) && /^(0|-?[1-9]\d{0,18})$/.test(String(v)), `${label} must be an exact native integer.`);
  const n = BigInt(v); need(n >= minimum && n <= 9223372036854775807n, `${label} exceeds its native bound.`); return n;
}
function fraction(v) {
  const match = /^(\d{1,12})\/(\d{1,12})$/.exec(String(v));
  need(match && BigInt(match[2]) > 0n, 'Exact HDR metadata rational values are required.');
  return [BigInt(match[1]), BigInt(match[2])];
}
function equalRational(a, b) { const [an, ad] = fraction(a), [bn, bd] = fraction(b); return an * bd === bn * ad; }
function decimalTicks(v) {
  const match = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(String(v)); need(match, 'A nonnegative exact source duration is required.');
  const d = 10n ** BigInt((match[2] || '').length), n = BigInt(match[1]) * d + BigInt(match[2] || '0');
  need(n * 1000n % d === 0n, 'Source duration cannot be represented in its native clock.'); return n * 1000n / d;
}
function bindingsOf(v) {
  record(v, FIELDS); const snapshot = bindingSnapshot(v);
  need(typeof snapshot.sourcePath === 'string' && path.isAbsolute(snapshot.sourcePath) && path.resolve(snapshot.sourcePath) === snapshot.sourcePath
    && !/[\0\r\n]/.test(snapshot.sourcePath) && snapshot.sourceIdentity?.canonicalPath === snapshot.sourcePath, 'A canonical absolute source path and matching identity are required.');
  need(HASH.test(snapshot.runtimeIdentity) && Array.isArray(snapshot.profiles) && snapshot.profiles.length > 0 && snapshot.profiles.length <= 128, 'Current runtime identity and reviewed configuration profiles are required.');
  for (const k of ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest']) need(typeof snapshot.sourceIdentity[k] === 'string', 'Complete source identity is required.');
  need(integer(snapshot.sourceIdentity.size, 'Source size', 1n) <= BigInt(HDR_INPUT_LIMITS.sourceBytes), 'HDR source exceeds the admitted 16 MiB envelope.', 'HDR_INPUT_LIMIT');
  need(/^sha256-sparse-v1:[a-f0-9]{64}$/.test(snapshot.sourceIdentity.sparseDigest), 'Prepared source sparse identity is incomplete.');
  const normalized = normalizeProbe(snapshot.probe), video = normalized.streams[0];
  need(normalized.streams.length === 1 && video.codec_type === 'video' && video.codec_name === 'hevc' && video.profile === 'Main 10'
    && video.index === 0 && normalized.format.format_name === 'matroska,webm'
    && normalized.chapters.length === 0 && ['programs', 'stream_groups'].every(k => Array.isArray(normalized[k]) && normalized[k].length === 0),
  'HDR input requires one Main10 Matroska video and complete empty ancillary relationships.');
  need(video.pix_fmt === 'yuv420p10le' && video.field_order === 'progressive' && video.color_primaries === 'bt2020'
    && video.color_space === 'bt2020nc' && video.color_range === 'tv' && video.chroma_location === 'left'
    && ['smpte2084', 'arib-std-b67'].includes(video.color_transfer), 'Source HDR signal is outside the reviewed planar progressive family.');
  need(video.time_base === '1/1000' && String(video.start_pts) === '0' && decimalTicks(video.start_time) === 0n
    && decimalTicks(normalized.format.start_time) === 0n, 'Source native clock must have the reviewed zero-origin 1/1000 shape.');
  need(['24/1', '25/1', '30/1'].includes(video.avg_frame_rate) && video.r_frame_rate === video.avg_frame_rate, 'Source cadence has no reviewed integer configuration.');
  need(!['rotate', 'rotation', 'orientation'].some(k => Object.keys(video.tags || {}).some(x => x.toLowerCase() === k)), 'Source rotation/orientation is outside this preservation family.');
  for (const [key, value] of Object.entries(video.disposition || {})) need(/^[a-z_]{1,64}$/.test(key) && [0, '0'].includes(value), 'Source dispositions are outside the reviewed all-zero profile.');
  if (own(normalized.format, 'size')) need(integer(normalized.format.size, 'Observed source size', 1n) === BigInt(snapshot.sourceIdentity.size), 'Observed source size differs from its prepared filesystem identity.');
  return { sourcePath: snapshot.sourcePath, sourceIdentity: freeze(snapshot.sourceIdentity), probe: freeze(normalized),
    runtimeIdentity: snapshot.runtimeIdentity, profiles: freeze(snapshot.profiles), sourceProbeFingerprint: fingerprint(snapshot.probe),
    profilesFingerprint: sha(stable(snapshot.profiles)), video };
}
function checkSideData(item, metadata, requirePresent = false) {
  const entries = item.side_data_list ?? []; need(Array.isArray(entries) && entries.length <= 64, 'Source frame side-data is malformed or excessive.');
  const seen = new Set();
  for (const entry of entries) {
    need(plain(entry) && typeof entry.side_data_type === 'string', 'Source frame side-data must have a known type.');
    const type = entry.side_data_type;
    if (type === 'H.26[45] User Data Unregistered SEI message') { need(Object.keys(entry).length === 1, 'Unregistered frame data has unclassified fields.'); continue; }
    need(!seen.has(type), 'Duplicate source static metadata is ambiguous.'); seen.add(type);
    if (type === 'Mastering display metadata') {
      need(metadata.mastering !== null && Object.keys(entry).length === MASTER.length + 1 && MASTER.every(k => own(entry, k)), 'Mastering metadata was fabricated, incomplete or unclassified.');
      for (const k of MASTER) need(equalRational(entry[k], metadata.mastering[k]), 'Decoded mastering values differ from complete compressed metadata.');
    } else if (type === 'Content light level metadata') {
      need(metadata.contentLight !== null && Object.keys(entry).length === 3 && own(entry, 'max_content') && own(entry, 'max_average'), 'Content-light metadata was fabricated, incomplete or unclassified.');
      for (const k of ['max_content', 'max_average']) need(integer(entry[k], k) === BigInt(metadata.contentLight[k]), 'Decoded content-light values differ from complete compressed metadata.');
    } else fail(`Unclassified functional source side-data '${type}' cannot be omitted.`, 'HDR_INPUT_FUNCTIONAL_DATA');
  }
  if (requirePresent) for (const [key, type] of [['mastering', 'Mastering display metadata'], ['contentLight', 'Content light level metadata']])
    need((metadata[key] !== null) === seen.has(type), 'Every source frame must establish the complete constant static-metadata presence/absence.');
}
function completeFrames(payload, binding, classified, rawContainerTiming) {
  need(plain(payload) && Object.keys(payload).every(k => k === 'frames') && Array.isArray(payload.frames)
    && payload.frames.length > 0 && payload.frames.length <= HDR_INPUT_LIMITS.frames, 'Complete source frames are missing, excessive or mixed with unexpected sections.', 'HDR_INPUT_LIMIT');
  const video = binding.video, config = classified.configuration, frames = payload.frames;
  need(classified.pictureCount === frames.length && classified.packetCount === frames.length,
    'Complete decoded EOF count differs from the independently classified one-picture-per-packet source.', 'HDR_INPUT_COUNT');
  need(config.width === video.width && config.height === video.height && config.transfer === video.color_transfer
    && String(config.frameRate).replace(/\/1$/, '') === video.avg_frame_rate.slice(0, -2), 'Compressed configuration and prepared source geometry/rate/signal disagree.');
  need(Number.isSafeInteger(video.width) && Number.isSafeInteger(video.height) && video.width > 0 && video.height > 0
    && frames.length * video.width * video.height <= HDR_INPUT_LIMITS.pixelFrames, 'Complete source exceeds the reviewed pixel-frame work bound.', 'HDR_INPUT_LIMIT');
  const expectedSar = own(video, 'sample_aspect_ratio') ? video.sample_aspect_ratio : null;
  need(config.sampleAspectRatio === expectedSar, 'Source SAR does not match the explicitly reviewed native configuration.');
  need(expectedSar === null || expectedSar === '1:1', 'Non-square/unknown SAR requires a separate qualified route.');
  need(expectedSar !== null || video.width === 320 && video.height === 180, 'Only the reviewed legacy configuration preserves absent SAR.');
  if (own(video, 'display_aspect_ratio')) {
    const dar = /^(\d{1,9}):(\d{1,9})$/.exec(String(video.display_aspect_ratio));
    need(expectedSar !== null && dar && BigInt(dar[1]) > 0n && BigInt(dar[2]) > 0n
      && BigInt(dar[1]) * BigInt(video.height) === BigInt(dar[2]) * BigInt(video.width), 'Source display aspect disagrees with its qualified square-pixel geometry.');
  }
  checkSideData(video, classified.metadata);
  const timeline = [], clockHash = createHash('sha256'), rate = BigInt(video.avg_frame_rate.slice(0, -2)); let previous = -1n, constantDuration;
  for (const [index, frame] of frames.entries()) {
    need(plain(frame) && Object.keys(frame).every(k => FRAME_FIELDS.includes(k) || k === 'side_data_list')
      && frame.media_type === 'video' && frame.stream_index === video.index && frame.width === video.width && frame.height === video.height
      && frame.pix_fmt === 'yuv420p10le' && [0, '0'].includes(frame.interlaced_frame), 'Each complete source frame must establish exact geometry, identity, scan and packing.');
    need(expectedSar === null ? !own(frame, 'sample_aspect_ratio') : frame.sample_aspect_ratio === expectedSar, 'Decoded source SAR changes or does not establish the declared geometry.');
    for (const key of ['top_field_first', 'repeat_pict', 'crop_top', 'crop_bottom', 'crop_left', 'crop_right']) if (own(frame, key)) need([0, '0'].includes(frame[key]), `Source ${key} requires a separate geometry/cadence contract.`);
    for (const key of ['color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location']) need(frame[key] === video[key], `Decoded source ${key} changes or is unresolved.`);
    const pts = integer(frame.pts, 'Source frame PTS'), duration = integer(frame.duration ?? frame.pkt_duration, 'Source frame duration', 1n);
    need(pts > previous && pts === (BigInt(index) * 2000n + rate) / (rate * 2n), 'Source PTS is nonmonotonic or outside the reviewed nominal native grid.');
    if (own(frame, 'best_effort_timestamp')) need(integer(frame.best_effort_timestamp, 'Best-effort PTS') === pts, 'Native and best-effort source timestamps conflict.');
    if (own(frame, 'duration') && own(frame, 'pkt_duration')) need(integer(frame.duration, 'Duration', 1n) === integer(frame.pkt_duration, 'Packet duration', 1n), 'Source native duration declarations conflict.');
    need(duration === 1000n / rate, 'Source duration differs from the pinned Matroska default-duration floor.');
    constantDuration ??= duration; need(duration === constantDuration, 'Variable native frame durations require a separately qualified cadence.');
    previous = pts; checkSideData(frame, classified.metadata, true);
    timeline.push({ pts: String(pts), duration: String(duration) }); clockHash.update(`${pts}:${duration}\n`);
  }
  const end = BigInt(timeline.at(-1).pts) + BigInt(timeline.at(-1).duration);
  need(end > 0n && end <= BigInt(HDR_INPUT_LIMITS.durationTicks), 'Complete source duration exceeds 60 seconds.', 'HDR_INPUT_LIMIT');
  const declared = decimalTicks(binding.probe.format.duration), highEnd = BigInt(timeline.at(-1).pts) + (1000n + rate - 1n) / rate;
  // The pinned muxer omits BlockDuration for either its low/high duration.
  // Demux reports floor(DefaultDuration/TimecodeScale), while Segment.Duration
  // retains the muxed packet end. Preserve both observed facts independently;
  // no source/output timing tolerance follows from these two representations.
  need(declared > 0n && declared <= BigInt(HDR_INPUT_LIMITS.durationTicks) && (declared === end || declared === highEnd),
    'Declared container duration is outside the exact native low/high serialization states.', 'HDR_INPUT_DURATION');
  need(rawContainerTiming.declaredDurationTicks === String(declared), 'The raw Segment duration contradicts the reported source duration.', 'HDR_INPUT_DURATION');
  if (own(video, 'duration_ts')) need(integer(video.duration_ts, 'Video duration') === declared, 'Video duration contradicts the declared container extent.');
  if (own(video, 'duration')) need(decimalTicks(video.duration) === declared, 'Video duration contradicts the declared container extent.');
  if (own(video, 'nb_frames')) need(integer(video.nb_frames, 'Declared source count', 1n) === BigInt(frames.length), 'Declared source count differs from complete decoded EOF.');
  return { frames: freeze(frames), timeline: freeze({ timeBase: '1/1000', records: frames.length, rows: timeline, firstPts: '0', endPts: String(end), tolerance: 'zero-native-ticks' }),
    timelineHash: clockHash.digest('hex'), frameCount: frames.length, pixelFrames: frames.length * video.width * video.height,
    containerTiming: freeze({ ...rawContainerTiming, nativeEndTicks: String(end),
      headerRepresentation: declared === end ? 'native-end' : 'ceil-period-header', sourceOutputToleranceTicks: '0' }) };
}

async function observeHdrInput(options) {
  record(options, [...FIELDS, 'ffprobe', 'run', 'signal'], [...FIELDS, 'ffprobe', 'run']);
  const binding = bindingsOf(Object.fromEntries(FIELDS.map(k => [k, options[k]])));
  need(typeof options.ffprobe === 'string' && path.isAbsolute(options.ffprobe) && !/[\0\r\n]/.test(options.ffprobe)
    && typeof options.run === 'function', 'Main must supply its observed fixed ffprobe and owned runner.');
  need(options.signal === undefined || options.signal && typeof options.signal.addEventListener === 'function' && typeof options.signal.aborted === 'boolean', 'A native cancellation signal is required.');
  const controller = new AbortController(), started = Date.now(), captures = []; let timeout = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
  const timer = setTimeout(() => { timeout = true; controller.abort(); }, HDR_INPUT_LIMITS.totalTimeoutMs); timer.unref();
  const stop = () => { if (controller.signal.aborted) fail(timeout ? 'Complete HDR input observation exceeded its total deadline.' : 'Complete HDR input observation cancelled.', timeout ? 'HDR_INPUT_TIMEOUT' : 'CANCELLED');
    need(Date.now() - started < HDR_INPUT_LIMITS.totalTimeoutMs, 'Complete HDR input observation exceeded its total deadline.', 'HDR_INPUT_TIMEOUT'); };
  let handle, rawContainerTiming;
  async function current() {
    stop(); await assertOrdinaryPath(binding.sourcePath); const observed = await readSourceIdentity(binding.sourcePath, { signal: controller.signal });
    assertIdentityMatches(binding.sourceIdentity, observed, { digest: true, stage: 'hdr-input-observation', message: 'Source changed during complete HDR input observation.' });
    const stat = await fs.lstat(binding.sourcePath, { bigint: true });
    need(stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n && stat.size <= BigInt(HDR_INPUT_LIMITS.sourceBytes), 'Source must remain a single-linked ordinary bounded file.', 'HDR_INPUT_CHANGED');
    if (handle) { const opened = await handle.stat({ bigint: true }); need(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'nlink'].every(k => opened[k] === stat[k]), 'The source path no longer matches its retained open handle.', 'HDR_INPUT_CHANGED'); }
    return stat;
  }
  async function seal(observeContainer = false) {
    const before = await current(), hash = createHash('sha256'), buffer = Buffer.alloc(65536), chunks = []; let offset = 0;
    while (offset < Number(before.size)) { stop(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      need(bytesRead > 0, 'Complete source SHA256 was truncated.', 'HDR_INPUT_CHANGED'); hash.update(buffer.subarray(0, bytesRead));
      if (observeContainer) chunks.push(Buffer.from(buffer.subarray(0,bytesRead))); offset += bytesRead; }
    await current(); if (observeContainer) rawContainerTiming = inspectHdrContainer(Buffer.concat(chunks), { frameRate: binding.video.avg_frame_rate });
    return { complete: true, algorithm: 'sha256', bytes: String(offset), digest: hash.digest('hex') };
  }
  async function invoke(kind, args, maximum) {
    await current(); const chunks = [], hash = createHash('sha256'); let bytes = 0, accepting = true, children = 0, live = 0; const closures = [], streams = [];
    let result;
    try {
      stop();
      result = await options.run(options.ffprobe, args, { signal: controller.signal, timeoutMs: Math.min(HDR_INPUT_LIMITS.childTimeoutMs, HDR_INPUT_LIMITS.totalTimeoutMs - (Date.now() - started)),
        stdoutLimit: maximum, stderrLimit: 256 * 1024, onChild(child) {
          need(child && typeof child.once === 'function' && child.stdout && typeof child.stdout.once === 'function'
            && child.stderr && typeof child.stderr.once === 'function', 'The observed runner must expose its actual child and captured pipes.', 'HDR_INPUT_RUNNER');
          const ended = { stdout: false, stderr: false, failed: false }; streams.push(ended);
          child.stdout.once('end', () => { ended.stdout = true; }); child.stderr.once('end', () => { ended.stderr = true; });
          child.stdout.once('error', () => { ended.failed = true; }); child.stderr.once('error', () => { ended.failed = true; });
          child.once('error', () => { ended.failed = true; });
          children++; live++; closures.push(new Promise(resolve => child.once('close', (code, signal) => { live--; resolve({ code, signal }); })));
          need(children === 1, 'One actual child per HDR input observation stage is required.', 'HDR_INPUT_RUNNER');
        }, onStdoutChunk: async chunk => {
          stop(); need(accepting && Buffer.isBuffer(chunk), 'HDR input runner must await bounded binary sinks.', 'HDR_INPUT_RUNNER');
          bytes += chunk.length; need(bytes <= maximum, 'Complete HDR input stdout exceeds its capture bound.', 'HDR_INPUT_LIMIT'); hash.update(chunk); chunks.push(Buffer.from(chunk));
        } });
      accepting = false;
      // A faulty wrapper must not release a real child merely by resolving its
      // promise early. Request cancellation and retain ownership through close.
      if (live) controller.abort(); const closed = await Promise.all(closures);
      need(children === 1 && live === 0 && closed[0]?.code === 0 && [null, undefined].includes(closed[0]?.signal), 'A single successful actual child close is required.', 'HDR_INPUT_RUNNER');
      need(streams.length === 1 && streams[0].stdout && streams[0].stderr && !streams[0].failed, 'Both actual input pipes must reach clean EOF before eligibility.', 'HDR_INPUT_RUNNER');
      stop(); need(result?.exitCode === 0 && result.stdout === '' && result.stdoutCapture?.streamed === true
        && result.stdoutCapture.truncated === false && result.stdoutCapture.totalBytes === bytes, 'Complete closed/drained input stdout accounting is required.', 'HDR_INPUT_RUNNER');
      need(result.stderr === '' && result.stderrCapture?.truncated === false && result.stderrCapture.totalBytes === 0, 'Warnings/errors or incomplete diagnostics refuse input eligibility.', 'HDR_INPUT_DECODE');
      await current(); const data = Buffer.concat(chunks); let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail('Input probe JSON is not complete valid UTF-8.'); }
      need(text.trimEnd().endsWith('}'), 'Input probe JSON has no complete EOF.');
      const parsed = parseProbeJson(text, `Complete HDR input ${kind}`);
      captures.push(freeze({ kind, bytes, sha256: hash.digest('hex'), exitCode: 0, childClosed: true, stdoutDrained: true })); return parsed;
    } catch (error) {
      accepting = false; if (live) controller.abort(); await Promise.all(closures);
      if (timeout) fail('Complete HDR input observation exceeded its total deadline.', 'HDR_INPUT_TIMEOUT'); throw error;
    }
  }
  try {
    await current(); handle = await fs.open(binding.sourcePath, 'r'); const before = await seal(true);
    const guards = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm'];
    const packets = await invoke('packets-and-configuration', [...guards, '-show_packets', '-show_streams', '-show_data', '-data_dump_format', 'base64', '-show_data_hash', 'sha256', '-of', 'json', '-i', binding.sourcePath], HDR_INPUT_LIMITS.packetBytes);
    need(Array.isArray(packets.streams) && packets.streams.length === 1, 'Complete packet observation must contain one stream.');
    const observedProbe = { ...binding.probe, streams: packets.streams };
    need(fingerprint(observedProbe) === binding.sourceProbeFingerprint, 'Complete packet stream facts differ from the prepared source probe.', 'HDR_INPUT_CHANGED');
    const classified = classifyHevcPackets(packets, { profiles: binding.profiles, transfer: binding.video.color_transfer });
    // Complete compressed membership is available before decoding. Refuse a
    // source outside the declared work budget before spending a decode child;
    // complete decoded EOF must still independently confirm these counts.
    const count = classified.pictureCount, config = classified.configuration;
    need(Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(classified.packetCount) && classified.packetCount === count,
      'Complete compressed picture and packet membership disagree.', 'HDR_INPUT_COUNT');
    need(count <= HDR_INPUT_LIMITS.frames
      && count * config.width * config.height <= HDR_INPUT_LIMITS.pixelFrames
      && BigInt(count) * 1000n <= BigInt(HDR_INPUT_LIMITS.durationTicks) * BigInt(String(config.frameRate).replace(/\/1$/, '')),
    'Complete compressed membership exceeds the reviewed frame/duration/pixel work budget.', 'HDR_INPUT_LIMIT');
    const payload = await invoke('complete-frames', [...guards, '-select_streams', '0', '-show_frames', '-show_entries', `frame=${FRAME_FIELDS.join(',')}:frame_side_data`, '-of', 'json', '-i', binding.sourcePath], HDR_INPUT_LIMITS.frameBytes);
    const full = completeFrames(payload, binding, classified, rawContainerTiming), after = await seal();
    need(before.digest === after.digest && before.bytes === after.bytes, 'Complete source content changed during HDR input observation.', 'HDR_INPUT_CHANGED');
    const data = freeze({ version: 1, complete: true, sourcePath: binding.sourcePath, sourceIdentity: binding.sourceIdentity,
      sourceProbeFingerprint: binding.sourceProbeFingerprint, runtimeIdentity: binding.runtimeIdentity, profilesFingerprint: binding.profilesFingerprint,
      sourceFileSha256: before.digest, sourceSealBefore: before, sourceSealAfter: after,
      ...full, compressedFingerprint: classified.fingerprint, configurationMetadata: classified, captures,
      coverage: 'complete-source-configurations-packets-and-decoded-frames', qualificationGranted: false, publicationAuthorized: false });
    const receipt = freeze({ version: 1, status: 'completed', scope: data.coverage, sourceFileSha256: before.digest,
      sourceProbeFingerprint: binding.sourceProbeFingerprint, runtimeIdentity: binding.runtimeIdentity, profilesFingerprint: binding.profilesFingerprint,
      frameCount: full.frameCount, pixelFrames: full.pixelFrames, containerTiming: full.containerTiming, timelineHash: full.timelineHash, compressedFingerprint: classified.fingerprint,
      configuration: classified.configuration, metadata: classified.metadata, captures, qualificationGranted: false, publicationAuthorized: false });
    receipts.set(receipt, { binding, data }); return receipt;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (handle) await handle.close(); }
}

function getObservedHdrInput(receipt, options) {
  const retained = receipts.get(receipt); need(retained && receipt.status === 'completed', 'A genuine complete current-process HDR input receipt is required.', 'HDR_INPUT_RECEIPT_REQUIRED');
  const current = bindingsOf(options), before = retained.binding;
  need(current.sourcePath === before.sourcePath && current.runtimeIdentity === before.runtimeIdentity
    && stable(current.sourceIdentity) === stable(before.sourceIdentity) && current.sourceProbeFingerprint === before.sourceProbeFingerprint
    && current.profilesFingerprint === before.profilesFingerprint, 'HDR input receipt path, identity, probe, runtime or reviewed profiles changed.', 'HDR_INPUT_RECEIPT_REQUIRED');
  return retained.data;
}

module.exports = { HDR_INPUT_LIMITS, observeHdrInput, getObservedHdrInput };
