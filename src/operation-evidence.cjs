'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');

// Main-only evidence acquisition, not a capability cell or publication grant.
// This first complete path deliberately reads source decoded timing. Main must
// explicitly budget that cost. stats_enc_pre is not substituted: it lacks the
// last source-frame duration and may not retain original input correspondence.
// Every child uses the supplied queue-owned runner, sequentially, with a drained
// async binary stdout sink. Never tap onChild or raise JSON capture limits.
// ffprobe compact writer: https://ffmpeg.org/ffprobe.html#compact_002c-csv
const VERSION = 1, LINE_LIMIT = 8192, CHUNK = 65536;
const fail = (code, message) => { throw new ToolError(code, message); };
const need = (value, message, code = 'OPERATION_EVIDENCE_INVALID') => { if (!value) fail(code, message); };
const cancelled = signal => { if (signal?.aborted) fail('CANCELLED', 'Operation evidence collection cancelled; retained evidence is unchanged.'); };
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function exact(value, keys, label) {
  need(plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => own(value, key)), `${label} needs every explicit field.`);
  for (const key of keys) need(Object.getOwnPropertyDescriptor(value, key)?.enumerable && own(Object.getOwnPropertyDescriptor(value, key), 'value'), `${label} cannot contain accessors.`);
}
function safe(value, label, minimum = 0) { need(Number.isSafeInteger(value) && value >= minimum, `${label} must be an exact bounded integer.`); return value; }
function int(value, label, minimum = -9223372036854775807n) {
  need(typeof value === 'string' && /^-?(0|[1-9]\d{0,18})$/.test(value), `${label} is absent or not an integer.`);
  const n = BigInt(value); need(n >= minimum && n <= 9223372036854775807n, `${label} overflows or is unavailable.`); return n;
}
function rational(value) {
  need(plain(value) && typeof value.numerator === 'string' && /^-?\d{1,40}$/.test(value.numerator)
    && typeof value.denominator === 'string' && /^[1-9]\d{0,39}$/.test(value.denominator), 'Invalid exact rational.');
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
}
function base(value) {
  need(typeof value === 'string' && /^[1-9]\d{0,9}\/[1-9]\d{0,9}$/.test(value), 'Observed stream time base is required.');
  const [n, d] = value.split('/').map(BigInt); need(n <= 2147483647n && d <= 2147483647n, 'Unsupported stream time base.'); return { n, d };
}
const mul = (r, n) => ({ n: r.n * n, d: r.d });
const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const cmp = (a, b) => a.n * b.d - b.n * a.d;
const ceil = (n, d) => n / d + (n % d > 0n ? 1n : 0n);
function reducedKey(value) {
  let a = value.n < 0n ? -value.n : value.n, b = value.d;
  while (b) [a, b] = [b, a % b];
  return `${value.n / (a || 1n)}/${value.d / (a || 1n)}`;
}
function round(r) {
  const sign = r.n < 0n ? -1n : 1n, n = r.n < 0n ? -r.n : r.n;
  return sign * (n / r.d + (n % r.d * 2n >= r.d ? 1n : 0n));
}
function numeric(n) { need(n >= -BigInt(Number.MAX_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER), 'Evidence exceeds exact numeric representation.'); return Number(n); }
const us = r => numeric(round(mul(r, 1000000n)));
const errorUs = r => numeric(ceil((r.n < 0n ? -r.n : r.n) * 1000000n, r.d));
const pack = r => ({ n: String(r.n), d: String(r.d) });
const unpack = r => ({ n: BigInt(r.n), d: BigInt(r.d) });

// Local diagnostic receipts may include a bounded causal chain, never a raw
// Error object, stack or arbitrary attached state. Sink exceptions are wrapped
// by the owned runner, so retaining only the wrapper loses the actionable cause.
function evidenceFailure(error, depth = 0, seen = new Set()) {
  const result = { code: typeof error?.code === 'string' ? error.code.slice(0, 128) : 'ERROR',
    message: String(error?.message ?? error).slice(0, 2000) };
  if (error?.evidenceRow) result.evidenceRow = { section: String(error.evidenceRow.section).slice(0, 32),
    prefix: String(error.evidenceRow.prefix).slice(0, 512), length: error.evidenceRow.length,
    sha256: error.evidenceRow.sha256, truncated: error.evidenceRow.truncated === true };
  if (error?.cause) {
    if (depth >= 2 || seen.has(error.cause)) result.causeTruncated = true;
    else { seen.add(error); result.cause = evidenceFailure(error.cause, depth + 1, seen); }
  }
  return result;
}

// Only selected numeric/ASCII FFprobe fields are requested. The pinned9.0.2
// writer qualifies packet skip fields as side_datum/skip_samples:<field>.
// Recognize exactly those three paths, not a generic strip-prefix rule. Older
// retained fixtures use an inline side_data section marker. Both forms share
// duplicate detection after canonicalization; unknown paths still fail closed.
const PACKET_COMPACT_KEYS = Object.freeze({
  'side_datum/skip_samples:side_data_type': 'side_data_type',
  'side_datum/skip_samples:skip_samples': 'skip_samples',
  'side_datum/skip_samples:discard_padding': 'discard_padding',
});
function compactRow(line, section, allowed) {
  try {
    need(typeof line === 'string' && line.length > 0 && line.length <= LINE_LIMIT && /^[\x20-\x7e]+$/.test(line), 'Malformed compact evidence row.');
    const cells = line.split('|'); need(cells.shift() === section, 'Unexpected FFprobe evidence section.');
    const row = {};
    for (const cell of cells) {
      if (cell === '' || cell === 'side_data') continue;
      const separator = cell.indexOf('='); need(separator > 0, 'Malformed compact evidence field.');
      const rawKey = cell.slice(0, separator), value = cell.slice(separator + 1);
      const key = section === 'packet' && own(PACKET_COMPACT_KEYS, rawKey) ? PACKET_COMPACT_KEYS[rawKey]
        : section === 'frame' && rawKey === BENIGN_SEI_KEY ? 'side_data_type' : rawKey;
      need(allowed.includes(key) && !own(row, key) && !value.includes('\\'), 'Unknown, escaped or repeated evidence field.'); row[key] = value;
    }
    return row;
  } catch (error) {
    if (typeof line === 'string') error.evidenceRow = { section, prefix: line.slice(0, 512), length: line.length,
      sha256: createHash('sha256').update(line).digest('hex'), truncated: line.length > 512 };
    throw error;
  }
}
function lineSink(onLine, { maxBytes, maxRecords, signal }) {
  let pending = '', bytes = 0, records = 0;
  const hash = createHash('sha256');
  return {
    async push(chunk) {
      cancelled(signal); need(Buffer.isBuffer(chunk), 'Runner must deliver binary stdout chunks.'); bytes += chunk.length;
      need(Number.isSafeInteger(bytes) && bytes <= maxBytes, 'Evidence byte budget exceeded.', 'OPERATION_EVIDENCE_LIMIT'); hash.update(chunk);
      for (let offset = 0; offset < chunk.length; offset += CHUNK) {
        const piece = chunk.subarray(offset, offset + CHUNK);
        need(piece.every(byte => byte === 10 || byte === 13 || byte >= 32 && byte <= 126), 'Non-ASCII compact evidence.');
        pending += piece.toString('ascii'); let end;
        while ((end = pending.indexOf('\n')) !== -1) {
          let line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.endsWith('\r')) line = line.slice(0, -1);
          // FFprobe can place an empty separator after a nested side-data block.
          if (!line) continue;
          need(++records <= maxRecords && line.length <= LINE_LIMIT, 'Evidence row budget exceeded.', 'OPERATION_EVIDENCE_LIMIT');
          cancelled(signal); await onLine(line);
        }
        need(pending.length <= LINE_LIMIT, 'Unterminated evidence row exceeds its limit.', 'OPERATION_EVIDENCE_LIMIT');
      }
    },
    finish() { need(pending.length === 0 && records > 0, 'Empty or truncated evidence stream.'); return { bytes, records, sha256: hash.digest('hex') }; },
    get bytes() { return bytes; },
  };
}
const stamps = value => Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'nlink'].map(key => [key, String(value[key])]));
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const same = (a, b) => sameObject(a, b) && ['size', 'mtimeNs', 'ctimeNs', 'nlink'].every(key => a[key] === b[key]);
async function binding(file, directory = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && !/[\0\r\n]/.test(file), 'Absolute main-owned/selected paths are required.', 'OPERATION_EVIDENCE_PATH');
  const stat = await fs.lstat(file, { bigint: true });
  need(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()) && stat.dev !== 0n && stat.ino !== 0n
    && path.resolve(await fs.realpath(file)) === path.resolve(file), 'An ordinary unchanged path is required.', 'OPERATION_EVIDENCE_PATH'); return stat;
}
async function assertBound(file, prior, directory = false) {
  const current = await binding(file, directory); need(directory ? sameObject(prior, current) : same(prior, current), 'Evidence source/output/path changed during collection.', 'OPERATION_EVIDENCE_CHANGED'); return current;
}
function sourceChange(before, after) {
  if (same(before, after)) return 'unchanged';
  if (sameObject(before, after) && ['size', 'mtimeNs', 'nlink'].every(key => before[key] === after[key])) return 'ctime-only';
  return 'changed';
}

const FRAME_FIELDS = ['media_type', 'stream_index', 'pts', 'duration', 'pkt_duration', 'nb_samples', 'sample_fmt', 'channels', 'channel_layout', 'width', 'height', 'pix_fmt', 'interlaced_frame', 'color_range', 'color_space', 'color_primaries', 'color_transfer'];
const PACKET_FIELDS = ['stream_index', 'side_data_type', 'skip_samples', 'discard_padding', 'pts', 'duration'];
const PACKET_HASH = /^SHA256:[0-9a-f]{64}$/i, IDENTITY_CODE = 'OPERATION_EVIDENCE_PACKET_IDENTITY';
const CONTAINER_CLOCK = 'matroska-packet-end-plus-codec-delay';
const INPUT_GUARDS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts'];
const PROPERTY_FIELDS = ['sample_aspect_ratio', 'chroma_location', 'side_data_type'];
const BENIGN_SEI_KEY = 'side_datum/h_26_45__user_data_unregistered_sei_message:side_data_type';
function frameArgs(file, index, sourceProperties = false) {
  return ['-v', 'error', ...INPUT_GUARDS, '-select_streams', String(index), '-show_frames', '-show_entries',
    `frame=${[...FRAME_FIELDS, ...(sourceProperties ? PROPERTY_FIELDS.slice(0, 2) : [])].join(',')}:frame_tags=:frame_side_data=${sourceProperties ? 'side_data_type' : ''}`, '-of', 'compact=p=1:nk=0:escape=c', '-i', file];
}
function checkFrame(line, stream, sourceProperties = false) {
  const row = compactRow(line, 'frame', [...FRAME_FIELDS, ...(sourceProperties ? PROPERTY_FIELDS : [])]);
  need(row.media_type === stream.codec_type && int(row.stream_index, 'Stream index', 0n) === BigInt(stream.index), 'Decoded frame belongs to another stream.');
  const time = mul(base(stream.time_base), int(row.pts, 'Decoded PTS'));
  if (stream.codec_type === 'video') {
    if (sourceProperties) {
      need(row.sample_aspect_ratio === '1:1' && row.chroma_location === 'left',
        'A decoded source frame has unqualified SAR/chroma location or lacks those observations.', 'OPERATION_SOURCE_FAMILY_MISMATCH');
      need(row.side_data_type === undefined || row.side_data_type === 'H.26[45] User Data Unregistered SEI message',
        'A decoded source frame contains unqualified display/HDR/ancillary side data.', 'OPERATION_SOURCE_FAMILY_MISMATCH');
    }
    for (const key of ['width', 'height', 'pix_fmt', 'color_range', 'color_space', 'color_primaries', 'color_transfer']) {
      need(stream[key] !== undefined && row[key] === String(stream[key]), `Decoded video ${key} disagrees with the observed stream or is unavailable.`);
    }
    need(row.interlaced_frame === '0', 'Progressive decoded evidence is required; no deinterlacing is implied.');
    const duration = int(row.duration ?? row.pkt_duration, 'Decoded frame duration', 1n);
    if (row.duration !== undefined && row.pkt_duration !== undefined) need(row.duration === row.pkt_duration, 'Conflicting decoded frame durations.');
    return { time, duration: mul(base(stream.time_base), duration) };
  }
  need(row.channels === String(stream.channels) && row.channel_layout === stream.channel_layout && row.sample_fmt === stream.sample_fmt,
    'Decoded audio layout/format disagrees with the observed stream or is unavailable.');
  const samples = int(row.nb_samples, 'Decoded samples', 1n), rate = int(String(stream.sample_rate), 'Audio sample rate', 1n);
  need(rate <= 768000n && samples <= 2147483647n, 'Unsupported decoded audio dimensions.');
  return { time, samples, rate };
}

// Compare the presentation clock at every sample-index interval boundary, not
// decoded frame boundaries (AAC/FLAC may legitimately reframe the same audio).
// Both functions have slope1/rate inside a span, so the exact rational difference
// is constant on each intersected span. Exhaust both streams to verify spool
// hashes/bindings even where measured codec end padding leaves an unmatched tail.
async function compareAudioTimelines({ sourceRows, outputRows, sampleRate, sourceOrigin, toleranceUs, signal }) {
  const rate = BigInt(safe(sampleRate, 'Sample rate', 1)); safe(toleranceUs, 'Interior audio clock tolerance');
  const source = sourceRows[Symbol.asyncIterator](), output = outputRows[Symbol.asyncIterator]();
  let a = await source.next(), b = await output.next(), compared = 0n, maximum = 0, segments = 0;
  while (!a.done && !b.done) {
    cancelled(signal);
    const a0 = BigInt(a.value.offset), a1 = a0 + BigInt(a.value.samples), b0 = BigInt(b.value.offset), b1 = b0 + BigInt(b.value.samples);
    const begin = a0 > b0 ? a0 : b0, end = a1 < b1 ? a1 : b1;
    need(end > begin, 'Decoded sample-clock spans are missing, reordered or nonoverlapping.');
    // The source is rebased only by the requested shared origin. Never align
    // individual tracks to their first sample or fit a shift to make them pass:
    // that would erase delays and conceal a whole-stream timing displacement.
    const timeA = sub(add(unpack(a.value.time), { n: begin - a0, d: rate }), sourceOrigin);
    const timeB = add(unpack(b.value.time), { n: begin - b0, d: rate });
    maximum = Math.max(maximum, errorUs(sub(timeB, timeA))); compared += end - begin; segments++;
    if (a1 <= b1) a = await source.next();
    if (b1 <= a1) b = await output.next();
  }
  while (!a.done) { cancelled(signal); a = await source.next(); }
  while (!b.done) { cancelled(signal); b = await output.next(); }
  need(compared > 0n, 'No decoded sample-clock intervals were compared.');
  need(maximum <= toleranceUs, `Audio interior presentation clock changed by ${maximum} us beyond the independently qualified ${toleranceUs} us bound.`, 'OPERATION_EVIDENCE_AUDIO_TIMELINE');
  return { comparedSamples: numeric(compared), intersectedSpans: segments, maximumElapsedClockErrorUs: maximum, toleranceUs,
    alignment: 'sample ordinal after decoder-signalled skip; source minus the shared requested origin; no fitted shift',
    contentIdentity: false };
}

async function collectOperationEvidence(options) {
  exact(options, ['plan', 'sourceProbe', 'outputProbe', 'sourcePath', 'outputPath', 'stageDirectory', 'ffmpeg', 'ffprobe', 'run', 'signal', 'budget', 'timingQualification', ...(own(options, 'sourcePolicy') ? ['sourcePolicy'] : []),
    ...(own(options, 'containerClockPolicy') ? ['containerClockPolicy'] : [])], 'Main collector request');
  const { plan, sourcePath, outputPath, stageDirectory, ffmpeg, ffprobe, run, signal, budget, timingQualification } = options;
  const sourceProperties = own(options, 'sourcePolicy');
  if (sourceProperties) {
    exact(options.sourcePolicy, ['id', 'rate', 'maximumExtentUs'], 'Decoded source policy');
    // Record 47 Q2b: the whole-file copied-audio family uses the same SDR source checks at 30 fps only.
    need((['short-sdr-range-v1', 'short-sdr-range-flac-v1'].includes(options.sourcePolicy.id) && [30, 60].includes(options.sourcePolicy.rate)
      || options.sourcePolicy.id === 'full-sdr-resize-copy-v1' && options.sourcePolicy.rate === 30)
      && options.sourcePolicy.maximumExtentUs === 120000000, 'Only the bounded short SDR source policies are implemented.');
  }
  const packetClock = own(options, 'containerClockPolicy');
  if (packetClock) need(sourceProperties && options.sourcePolicy.id === 'short-sdr-range-v1' && options.containerClockPolicy === CONTAINER_CLOCK,
    'The packet/codec-delay clock requires the qualified short SDR source policy.');
  exact(budget, ['sourceDecode', 'timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes'], 'Evidence budget');
  need(budget.sourceDecode === 'complete', 'Main must explicitly budget complete source decoding; telemetry alone does not satisfy this validator.', 'OPERATION_EVIDENCE_COST_APPROVAL');
  for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']) safe(budget[key], key, 1);
  need(budget.timeoutMs <= 2147483647, 'Timeout exceeds the owned runner timer range.');
  need(typeof run === 'function' && typeof ffmpeg === 'string' && path.isAbsolute(ffmpeg) && typeof ffprobe === 'string' && path.isAbsolute(ffprobe), 'Main supplies exact bundled tool paths and its owned runner.');
  need(plan?.expectedOutput?.operation === 'encode' && plan.compatibilityPath === false && plan.validationMode !== 'full-preservation-selection' && typeof plan.runtimeIdentity === 'string'
    && /^[a-f0-9]{64}$/.test(plan.planFingerprint), 'A changed-path main-built Encode plan is required.');
  exact(timingQualification, ['evidenceId', 'runtimeIdentity', 'videoDurationUs', 'audioTimelineUs', 'aac'], 'Measured interior timing qualification');
  need(typeof timingQualification.evidenceId === 'string' && /^[A-Za-z0-9._:+-]{1,256}$/.test(timingQualification.evidenceId)
    && timingQualification.runtimeIdentity === plan.runtimeIdentity, 'Interior timing qualification must bind the exact runtime.');
  for (const key of ['videoDurationUs', 'audioTimelineUs']) need(safe(timingQualification[key], key) <= 1000000, 'Interior timing bound exceeds the contract.');
  if (timingQualification.aac !== null) {
    exact(timingQualification.aac, ['alignment', 'encoderDelaySamples', 'discardPaddingSamples'], 'Measured AAC decoder alignment');
    need(timingQualification.aac.alignment === 'decoded-after-signalled-skip', 'AAC requires a measured decoded-sample alignment contract.');
    for (const key of ['encoderDelaySamples', 'discardPaddingSamples']) need(safe(timingQualification.aac[key], key) <= 1048576, 'Unsupported AAC padding qualification.');
  }
  const source = normalizeProbe(options.sourceProbe), output = normalizeProbe(options.outputProbe);
  if (sourceProperties && options.sourcePolicy.id === 'short-sdr-range-flac-v1') {
    // The new source policy is specific to one integer-PCM range route. It
    // cannot be attached to an AAC or copied-audio plan to borrow its checks.
    const audio = plan.contract.audio.streams, stream = source.streams.find(item => item.index === audio[0]?.index);
    need(plan.contract.range.kind === 'range' && timingQualification.aac === null && audio.length === 1
      && audio[0].mode === 'precision-flac' && audio[0].codec === 'flac' && audio[0].sourceSampleFormat === 's16'
      && audio[0].sampleRate === 48000 && audio[0].channels === 2 && audio[0].channelLayout === 'stereo'
      && stream?.codec_name === 'pcm_s16le' && stream.sample_fmt === 's16'
      && stream.sample_rate === '48000' && stream.channels === 2 && stream.channel_layout === 'stereo',
    'The precision-FLAC source policy requires one 48 kHz stereo pcm_s16le/s16 range stream and no AAC alignment.');
  }
  if (packetClock) need(output.format.format_name === 'matroska,webm' && output.streams.length === 2
    && output.streams.every(stream => stream.time_base === '1/1000'),
  'The qualified stored-clock representation requires the exact observed1/1000 Matroska output clock.');
  const mappings = plan.expectedOutput.streams;
  need(Array.isArray(mappings) && mappings.length <= 32 && mappings[0]?.codecType === 'video', 'Bounded expected stream mapping required.');
  const videos = mappings.filter(entry => entry.codecType === 'video'), audio = mappings.filter(entry => entry.codecType === 'audio');
  need(videos.length === 1 && audio.length === plan.contract.audio.streams.length, 'Unambiguous video/audio mapping required.');
  need(new Set(mappings.map(entry => entry.inputIndex)).size === mappings.length && new Set(mappings.map(entry => entry.outputIndex)).size === mappings.length, 'Duplicate expected mappings.');
  for (const mapping of mappings) {
    safe(mapping.inputIndex, 'Input index'); safe(mapping.outputIndex, 'Output index');
    need(source.streams.find(s => s.index === mapping.inputIndex)?.codec_type === mapping.codecType
      && output.streams.find(s => s.index === mapping.outputIndex)?.codec_type === mapping.codecType, 'Observed stream mapping does not match the plan.');
  }
  const range = plan.contract.range.kind === 'range' ? { start: rational(plan.contract.range.absoluteStart), end: rational(plan.contract.range.absoluteEnd) } : null;
  need(!range || cmp(range.end, range.start) > 0n, 'Invalid selected interval.');
  const origin = range?.start || { n: 0n, d: 1n };
  cancelled(signal);
  const [sourceBefore, outputBefore, stageBefore] = await Promise.all([binding(sourcePath), binding(outputPath), binding(stageDirectory, true)]);
  need(!sameObject(sourceBefore, outputBefore), 'Source and encoded output must be distinct files.', 'OPERATION_EVIDENCE_PATH');
  const directory = await fs.mkdtemp(path.join(stageDirectory, 'operation-evidence-')), directoryBefore = await binding(directory, true);
  const handles = [], spools = [], invocations = [];
  let spoolBytes = 0, completed = false;
  const receipt = { schema: VERSION, runtimeIdentity: plan.runtimeIdentity, planFingerprint: plan.planFingerprint, directory,
    scope: plan.contract.audio.streams.some(stream => stream.mode === 'copy') ? 'complete-decoded-timing-and-copied-packet-identity' : 'complete-decoded-timing-and-selected-flac-pcm', publicationAuthorized: false, qualificationGranted: false,
    cost: 'Sequential complete source/output timing decode; extra complete audio PCM decoding for FLAC. No original video prehash. timeoutMs and stream byte/row budgets apply per child; main owns the total operation deadline.',
    budget: { ...budget }, timingQualification: { ...timingQualification }, timelineComparisons: { video: null, audio: [] },
    sourcePath, outputPath, sourceBefore: stamps(sourceBefore), outputBefore: stamps(outputBefore), spools, invocations,
    completeSource: { video: null, audio: [] }, encoderInputs: { video: null, audio: [] } };
  async function directories() { await assertBound(stageDirectory, stageBefore, true); await assertBound(directory, directoryBefore, true); }
  async function persist(name, value) {
    await directories(); const encoded = Buffer.from(JSON.stringify(value, null, 2)); need(encoded.length <= 2 * 1024 * 1024, 'Receipt exceeds its bound.');
    await fs.writeFile(path.join(directory, name), encoded, { flag: 'wx' });
  }
  async function spool(name) {
    await directories(); const file = path.join(directory, name), handle = await fs.open(file, 'wx+'); handles.push(handle);
    const created = await handle.stat({ bigint: true }); need(created.nlink === 1n && same(created, await fs.lstat(file, { bigint: true })), 'Spool reservation is not bound.');
    const hash = createHash('sha256'); let length = 0, sealed;
    const details = { path: file, bytes: 0, status: 'writing' }; spools.push(details);
    return {
      async append(value) {
        cancelled(signal); need(!sealed, 'Spool is already sealed.'); const bytes = Buffer.from(JSON.stringify(value) + '\n');
        need(bytes.length <= LINE_LIMIT && spoolBytes + bytes.length <= budget.maxSpoolBytes, 'Owned evidence spool budget exceeded.', 'OPERATION_EVIDENCE_LIMIT');
        let offset = 0; while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset, length + offset); need(result.bytesWritten > 0, 'Incomplete spool write.'); offset += result.bytesWritten; }
        length += bytes.length; spoolBytes += bytes.length; details.bytes = length; hash.update(bytes);
      },
      async seal() {
        await handle.sync(); sealed = await handle.stat({ bigint: true });
        need(sameObject(created, sealed) && sealed.nlink === 1n && sealed.size === BigInt(length) && same(sealed, await fs.lstat(file, { bigint: true })), 'Spool changed while collecting.', 'OPERATION_EVIDENCE_CHANGED');
        Object.assign(details, { status: 'sealed', sha256: hash.digest('hex'), identity: stamps(sealed) });
      },
      async *rows() {
        need(sealed, 'A sealed source timeline is required.'); await directories();
        need(same(sealed, await handle.stat({ bigint: true })) && same(sealed, await fs.lstat(file, { bigint: true })), 'Spool changed before reading.', 'OPERATION_EVIDENCE_CHANGED');
        const buffer = Buffer.alloc(CHUNK), readHash = createHash('sha256'); let position = 0, pending = '';
        while (position < length) {
          cancelled(signal); const result = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position); need(result.bytesRead > 0, 'Incomplete spool read.');
          const bytes = buffer.subarray(0, result.bytesRead); readHash.update(bytes); position += result.bytesRead; pending += bytes.toString('ascii'); let end;
          while ((end = pending.indexOf('\n')) !== -1) { const line = pending.slice(0, end); pending = pending.slice(end + 1); need(line.length <= LINE_LIMIT, 'Oversized stored timeline row.'); yield JSON.parse(line); }
          need(pending.length <= LINE_LIMIT, 'Oversized stored timeline row.');
        }
        need(!pending && readHash.digest('hex') === details.sha256 && same(sealed, await handle.stat({ bigint: true }))
          && same(sealed, await fs.lstat(file, { bigint: true })), 'Spool changed during reading.', 'OPERATION_EVIDENCE_CHANGED');
      },
    };
  }
  async function invoke(label, executable, args, sink, limit) {
    await directories(); cancelled(signal);
    const entry = { label, executable, args, status: 'running', startedAt: new Date().toISOString() }; invocations.push(entry);
    try {
      const result = await run(executable, args, { signal, timeoutMs: budget.timeoutMs, stdoutLimit: limit, stderrLimit: 256 * 1024, onStdoutChunk: chunk => sink.push(chunk) });
      cancelled(signal);
      need(result?.exitCode === 0 && result.stdout === '' && result.stdoutCapture?.streamed === true
        && result.stdoutCapture.truncated === false && result.stdoutCapture.totalBytes === sink.bytes,
      'Owned runner did not confirm fully drained streaming stdout.', 'OPERATION_EVIDENCE_RUNNER');
      need(typeof result.stderr === 'string' && !result.stderr.trim() && result.stderrCapture?.truncated === false
        && Number.isSafeInteger(result.stderrCapture.totalBytes) && result.stderrCapture.totalBytes === Buffer.byteLength(result.stderr),
      'Decoder/inspection reported errors or incomplete diagnostics.', 'OPERATION_EVIDENCE_DECODE');
      entry.capture = sink.finish(); entry.status = 'completed'; entry.stderr = result.stderr; entry.stderrCapture = result.stderrCapture;
      return entry.capture;
    } catch (error) {
      Object.assign(entry, { status: 'failed', ...evidenceFailure(error),
        ...(typeof error.stderr === 'string' ? { stderr: error.stderr.slice(-262144), stderrCapture: error.stderrCapture } : {}) }); throw error;
    } finally { entry.finishedAt = new Date().toISOString(); await persist(`child-${invocations.length}.json`, entry); }
  }
  const sinkOptions = { maxBytes: budget.maxFrameBytes, maxRecords: budget.maxRecords, signal };
  try {
    await persist('start.json', receipt);
    const mapping = videos[0], sv = source.streams.find(s => s.index === mapping.inputIndex), ov = output.streams.find(s => s.index === mapping.outputIndex);
    const timeline = await spool('selected-video.jsonl'); let sourceCount = 0, sourceFirst, sourceLast, priorSource;
    const encoderPtsHash = createHash('sha256');
    const encoderVideoOrigin = plan.expectedOutput.timestampOrigins?.video?.effectiveOrigin
      ? rational(plan.expectedOutput.timestampOrigins.video.effectiveOrigin) : { n: 0n, d: 1n };
    let completeVideoCount = 0, completeFirst, completeLast, cadenceErrorUs = 0, durationErrorUs = 0, phaseErrorUs = 0;
    const rate = typeof sv.avg_frame_rate === 'string' && /^[1-9]\d*\/[1-9]\d*$/.test(sv.avg_frame_rate) ? base(sv.avg_frame_rate) : null;
    const period = rate ? { n: rate.d, d: rate.n } : null;
    await invoke('source-video-frames', ffprobe, frameArgs(sourcePath, sv.index, sourceProperties), lineSink(async line => {
      const frame = checkFrame(line, sv, sourceProperties); need(!priorSource || cmp(frame.time, priorSource) > 0n, 'Source video PTS are not strictly increasing.');
      if (period) {
        if (priorSource) cadenceErrorUs = Math.max(cadenceErrorUs, errorUs(sub(sub(frame.time, priorSource), period)));
        durationErrorUs = Math.max(durationErrorUs, errorUs(sub(frame.duration, period)));
        // Local jitter can accumulate and return to the nominal final extent.
        // Every ordinal must also remain on the zero-origin nominal clock.
        phaseErrorUs = Math.max(phaseErrorUs, errorUs(sub(frame.time, mul(period, BigInt(completeVideoCount)))));
      }
      priorSource = frame.time; completeFirst ||= frame; completeLast = frame; completeVideoCount++;
      if (range && (cmp(frame.time, range.start) < 0n || cmp(frame.time, range.end) >= 0n)) return;
      encoderPtsHash.update(reducedKey(sub(frame.time, encoderVideoOrigin)) + '\n');
      sourceCount++; sourceFirst ||= frame; sourceLast = frame; await timeline.append({ time: pack(frame.time), duration: pack(frame.duration) });
    }, sinkOptions), budget.maxFrameBytes);
    need(sourceCount > 0, 'No source frames belong to this selected interval.'); await timeline.seal();
    receipt.completeSource.video = { frames: completeVideoCount, firstTime: pack(completeFirst.time), endTime: pack(add(completeLast.time, completeLast.duration)),
      maximumNominalCadenceErrorUs: period ? cadenceErrorUs : null, maximumNominalDurationErrorUs: period ? durationErrorUs : null,
      maximumNominalPhaseErrorUs: period ? phaseErrorUs : null,
      ...(sourceProperties ? { properties: { policy: options.sourcePolicy.id, sampleAspectRatio: '1:1', chromaLocation: 'left',
        sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: completeVideoCount } } : {}) };
    receipt.encoderInputs.video = { outputIndex: mapping.outputIndex, records: String(sourceCount), orderedPts: encoderPtsHash.digest('hex'),
      scope: 'independent-selected-source-timestamps-minus-canonical-filter-origin' };
    const iterator = timeline.rows(); let outputCount = 0, outputFirst, outputLast, priorOutput, maxError = 0, maxDurationError = 0;
    await invoke('output-video-frames', ffprobe, frameArgs(outputPath, ov.index), lineSink(async line => {
      const frame = checkFrame(line, ov); need(!priorOutput || cmp(frame.time, priorOutput) > 0n, 'Output video PTS are not strictly increasing.'); priorOutput = frame.time;
      const next = await iterator.next(); need(!next.done, 'Output contains extra decoded video frames.', 'OPERATION_EVIDENCE_MEMBERSHIP');
      maxError = Math.max(maxError, errorUs(sub(frame.time, sub(unpack(next.value.time), origin))));
      maxDurationError = Math.max(maxDurationError, errorUs(sub(frame.duration, unpack(next.value.duration))));
      need(maxDurationError <= timingQualification.videoDurationUs, 'An interior video frame duration differs beyond the independently qualified bound.', 'OPERATION_EVIDENCE_VIDEO_DURATION');
      outputCount++; outputFirst ||= frame; outputLast = frame;
    }, sinkOptions), budget.maxFrameBytes);
    need((await iterator.next()).done && outputCount === sourceCount, 'Output is missing decoded video frames.', 'OPERATION_EVIDENCE_MEMBERSHIP');
    receipt.timelineComparisons.video = { comparedFrames: outputCount, maximumDurationErrorUs: maxDurationError, toleranceUs: timingQualification.videoDurationUs };
    const decodedEvidence = { video: { sourceFrameCount: sourceCount, outputFrameCount: outputCount, comparedFrames: outputCount,
      firstSourcePtsUs: us(sourceFirst.time), lastSourcePtsUs: us(sourceLast.time), lastSourceDurationUs: us(sourceLast.duration),
      firstOutputPtsUs: us(outputFirst.time), lastOutputPtsUs: us(outputLast.time), lastOutputDurationUs: us(outputLast.duration), maxRebasedTimestampErrorUs: maxError }, audio: [] };
    const clockStreams = [];
    if (packetClock) {
      let packets = 0, end;
      await invoke('output-video-packets', ffprobe, ['-v', 'error', ...INPUT_GUARDS, '-select_streams', String(ov.index), '-show_packets',
        '-show_entries', 'packet=stream_index,pts,duration:packet_tags=:packet_side_data=', '-of', 'compact=p=1:nk=0:escape=c', '-i', outputPath], lineSink(async line => {
        const row = compactRow(line, 'packet', ['stream_index', 'pts', 'duration']);
        need(int(row.stream_index, 'Video packet stream', 0n) === BigInt(ov.index), 'Wrong video packet stream.');
        const value = mul(base(ov.time_base), int(row.pts, 'Video packet PTS') + int(row.duration, 'Video packet duration', 1n));
        if (!end || cmp(value, end) > 0n) end = value; packets++;
      }, sinkOptions), budget.maxFrameBytes);
      need(ov.initial_padding === undefined || String(ov.initial_padding) === '0', 'Unexpected video codec delay.');
      clockStreams.push({ outputIndex: ov.index, packetCount: packets, packetEnd: pack(end), codecDelaySamples: 0, sampleRate: null });
    }
    for (const mapping of audio) {
      const sa = source.streams.find(s => s.index === mapping.inputIndex), oa = output.streams.find(s => s.index === mapping.outputIndex);
      need(String(sa.sample_rate) === String(oa.sample_rate) && sa.channels === oa.channels && sa.channel_layout === oa.channel_layout, 'Audio rate/layout cannot change during validation.');
      const ranges = await spool(`selected-audio-${mapping.inputIndex}.jsonl`); let totalSamples = 0n, selectedSamples = 0n, selectedFirst, selectedEnd, priorEnd, selectedGaps = 0;
      let completeAudioFirst, completeAudioGaps = 0;
      const mode = plan.contract.audio.streams.find(s => s.index === mapping.inputIndex).mode;
      await invoke(`source-audio-${mapping.inputIndex}-frames`, ffprobe, frameArgs(sourcePath, sa.index), lineSink(async line => {
        const frame = checkFrame(line, sa), end = add(frame.time, { n: frame.samples, d: frame.rate });
        need(!priorEnd || cmp(sub(frame.time, priorEnd), mul(base(sa.time_base), -1n)) >= 0n, 'Source audio decoded frames overlap beyond their observed timestamp tick.');
        if (priorEnd && cmp(sub(frame.time, priorEnd), base(sa.time_base)) > 0n) completeAudioGaps++;
        completeAudioFirst ||= frame.time; priorEnd = end;
        const clamp = n => n < 0n ? 0n : n > frame.samples ? frame.samples : n;
        const begin = range ? clamp(ceil(sub(range.start, frame.time).n * frame.rate, sub(range.start, frame.time).d)) : 0n;
        const finish = range ? clamp(ceil(sub(range.end, frame.time).n * frame.rate, sub(range.end, frame.time).d)) : frame.samples;
        if (finish > begin) {
          const first = add(frame.time, { n: begin, d: frame.rate });
          if (selectedEnd && cmp(sub(first, selectedEnd), base(sa.time_base)) > 0n) selectedGaps++;
          selectedFirst ||= first; selectedEnd = add(frame.time, { n: finish, d: frame.rate });
          await ranges.append({ first: String(totalSamples + begin), end: String(totalSamples + finish),
            offset: String(selectedSamples), samples: String(finish - begin), time: pack(first) });
          selectedSamples += finish - begin;
        }
        totalSamples += frame.samples;
      }, sinkOptions), budget.maxFrameBytes);
      need(selectedSamples > 0n, 'No selected source audio samples.'); await ranges.seal();
      receipt.completeSource.audio.push({ inputIndex: mapping.inputIndex, sampleCount: String(totalSamples), firstTime: pack(completeAudioFirst), endTime: pack(priorEnd), gaps: completeAudioGaps });
      const audioOrigin = plan.expectedOutput.timestampOrigins?.audio?.find(item => item.inputIndex === mapping.inputIndex)?.effectiveOrigin;
      const effectiveAudioOrigin = audioOrigin ? rational(audioOrigin) : { n: 0n, d: 1n };
      receipt.encoderInputs.audio.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex, sampleCount: String(selectedSamples),
        firstTime: pack(sub(selectedFirst, effectiveAudioOrigin)), endTime: pack(sub(selectedEnd, effectiveAudioOrigin)), selectedGaps });
      // Lossy codec delay can move a discontinuity's sample-ordinal location.
      // Do not infer that alignment from endpoint similarity or PCM length.
      if (mode === 'precision-aac') {
        need(timingQualification.aac !== null, 'AAC decoder-skip/sample alignment must be independently qualified.', 'OPERATION_EVIDENCE_AAC_ALIGNMENT');
        need(selectedGaps === 0, 'Discontinuous selected AAC input requires a separately qualified encoder-delay/sample-alignment contract.', 'OPERATION_EVIDENCE_AAC_GAPS_UNQUALIFIED');
      }
      const outputTimeline = await spool(`output-audio-${mapping.outputIndex}.jsonl`);
      let decodedSamples = 0n, decodedFirst, decodedEnd;
      await invoke(`output-audio-${mapping.outputIndex}-frames`, ffprobe, frameArgs(outputPath, oa.index), lineSink(async line => {
        const frame = checkFrame(line, oa); need(!decodedEnd || cmp(sub(frame.time, decodedEnd), mul(base(oa.time_base), -1n)) >= 0n,
          'Output audio frames overlap beyond timestamp quantization.');
        decodedFirst ||= frame.time; decodedEnd = add(frame.time, { n: frame.samples, d: frame.rate });
        await outputTimeline.append({ offset: String(decodedSamples), samples: String(frame.samples), time: pack(frame.time) }); decodedSamples += frame.samples;
      }, sinkOptions), budget.maxFrameBytes);
      await outputTimeline.seal();
      const timelineCheck = await compareAudioTimelines({ sourceRows: ranges.rows(), outputRows: outputTimeline.rows(), sampleRate: Number(sa.sample_rate),
        sourceOrigin: origin, toleranceUs: timingQualification.audioTimelineUs, signal });
      need(timelineCheck.comparedSamples === numeric(selectedSamples < decodedSamples ? selectedSamples : decodedSamples), 'Audio sample-clock coverage is incomplete.');
      receipt.timelineComparisons.audio.push({ inputIndex: mapping.inputIndex, mode, selectedSourceGaps: selectedGaps,
        unmatchedSourceTailSamples: numeric(selectedSamples > decodedSamples ? selectedSamples - decodedSamples : 0n),
        unmatchedOutputTailSamples: numeric(decodedSamples > selectedSamples ? decodedSamples - selectedSamples : 0n), ...timelineCheck });
      let skip = 0n, discard = 0n, packets = 0, packetEnd;
      const packetArgs = ['-v', 'error', ...INPUT_GUARDS, '-select_streams', String(oa.index), '-show_packets', '-show_entries',
        `packet=stream_index${packetClock ? ',pts,duration' : ''}:packet_tags=:packet_side_data=side_data_type,skip_samples,discard_padding`, '-of', 'compact=p=1:nk=0:escape=c', '-i', outputPath];
      await invoke(`output-audio-${mapping.outputIndex}-padding`, ffprobe, packetArgs, lineSink(async line => {
        const row = compactRow(line, 'packet', PACKET_FIELDS); need(int(row.stream_index, 'Packet stream', 0n) === BigInt(oa.index), 'Wrong packet stream.');
        if (packetClock) {
          const value = mul(base(oa.time_base), int(row.pts, 'Audio packet PTS') + int(row.duration, 'Audio packet duration', 1n));
          if (!packetEnd || cmp(value, packetEnd) > 0n) packetEnd = value; packets++;
        }
        if (own(row, 'side_data_type') || own(row, 'skip_samples') || own(row, 'discard_padding')) {
          need(row.side_data_type === 'Skip Samples' && own(row, 'skip_samples') && own(row, 'discard_padding'), 'Incomplete/unknown packet padding evidence.');
          skip += int(row.skip_samples, 'Skip samples', 0n); discard += int(row.discard_padding, 'Discard padding', 0n);
        }
      }, sinkOptions), budget.maxFrameBytes);
      const reconcilePadding = (packets, field) => {
        const stream = own(oa, field) ? int(String(oa[field]), field, 0n) : 0n;
        need(!packets || !stream || packets === stream, 'Stream and packet padding disagree; no value is guessed.'); return packets || stream;
      };
      const evidence = { inputIndex: mapping.inputIndex, sourceSampleCount: numeric(selectedSamples), outputSampleCount: numeric(decodedSamples),
        firstSourcePtsUs: us(selectedFirst), lastSourceEndUs: us(selectedEnd), firstOutputPtsUs: us(decodedFirst), lastOutputEndUs: us(decodedEnd),
        encoderDelaySamples: numeric(reconcilePadding(skip, 'initial_padding')), discardPaddingSamples: numeric(reconcilePadding(discard, 'trailing_padding')) };
      if (mode === 'precision-aac') {
        // FFprobe frames are already decoded after signalled skip handling.
        // The calibration establishes ordinal correspondence for this exact
        // runtime/codec route; do not subtract padding a second time or infer
        // delay/padding from a convenient count difference. Unknown cells fail.
        need(evidence.encoderDelaySamples === timingQualification.aac.encoderDelaySamples
          && evidence.discardPaddingSamples === timingQualification.aac.discardPaddingSamples,
        'Observed AAC skip/padding does not match the independently qualified decoder alignment.', 'OPERATION_EVIDENCE_AAC_ALIGNMENT');
      }
      if (packetClock) {
        need(mode === 'precision-aac' && String(oa.initial_padding) === '1024' && evidence.encoderDelaySamples === 1024
          && evidence.discardPaddingSamples === 0 && sa.sample_rate === '48000', 'The packet clock requires the explicitly observed AAC48k codec delay.');
        clockStreams.push({ outputIndex: oa.index, packetCount: packets, packetEnd: pack(packetEnd), codecDelaySamples: 1024, sampleRate: 48000 });
      }
      if (mode === 'precision-flac') {
        const precision = plan.expectedOutput.audioPrecision.find(s => s.inputIndex === mapping.inputIndex);
        need(precision && [16, 32].includes(precision.storageBits) && precision.pcmFormat === `s${precision.storageBits}le-interleaved`, 'Qualified packed PCM representation required.');
        const width = BigInt(sa.channels * precision.storageBits / 8), format = `s${precision.storageBits}le`;
        async function pcm(file, stream, selected) {
          const hash = createHash('sha256'); let bytes = 0, hashed = 0n, current, reader = selected ? ranges.rows() : null;
          if (reader) current = await reader.next();
          const sink = {
            async push(chunk) {
              cancelled(signal); need(Buffer.isBuffer(chunk), 'PCM runner chunks must be bytes.'); const start = BigInt(bytes), end = start + BigInt(chunk.length); bytes += chunk.length;
              need(Number.isSafeInteger(bytes) && bytes <= budget.maxPcmBytes, 'PCM decode byte budget exceeded.', 'OPERATION_EVIDENCE_LIMIT');
              if (!reader) { hash.update(chunk); hashed += BigInt(chunk.length); return; }
              while (!current.done) {
                const a = BigInt(current.value.first) * width, b = BigInt(current.value.end) * width;
                if (a >= end) break;
                if (b > start) { const left = a > start ? a : start, right = b < end ? b : end; if (right > left) { hash.update(chunk.subarray(Number(left - start), Number(right - start))); hashed += right - left; } }
                if (b <= end) current = await reader.next(); else break;
              }
            },
            finish() {
              need(bytes > 0 && (!reader || current.done) && BigInt(bytes) === (selected ? totalSamples : decodedSamples) * width,
                'Decoded PCM byte count does not match complete frame/sample evidence.');
              need(!selected || hashed === selectedSamples * width, 'Selected PCM membership is incomplete.');
              return { bytes, selectedBytes: numeric(hashed), sha256: hash.digest('hex') };
            },
            get bytes() { return bytes; },
          };
          return invoke(`${selected ? 'source' : 'output'}-audio-${stream.index}-pcm`, ffmpeg,
            ['-hide_banner', '-v', 'error', '-nostdin', '-copyts', ...INPUT_GUARDS, '-i', file, '-map', `0:${stream.index}`, '-vn', '-sn', '-dn',
              '-c:a', `pcm_${format}`, '-f', format, 'pipe:1'], sink, budget.maxPcmBytes);
        }
        const original = await pcm(sourcePath, sa, true), result = await pcm(outputPath, oa, false);
        evidence.pcmIdentity = { algorithm: 'sha256', format: precision.pcmFormat, sourceHash: original.sha256, outputHash: result.sha256,
          sourceBytes: original.selectedBytes, outputBytes: result.selectedBytes };
      }
      if (mode === 'copy') {
        // Record 47 Q2b: copied audio must be the source's own coded packets in
        // order, with the same decoder header and the same priming/padding side
        // data. Timestamps are checked separately (the container may round them).
        async function packetIdentity(file, stream, label) {
          const payload = createHash('sha256'), side = createHash('sha256'); let count = 0;
          await invoke(`${label}-audio-${stream.index}-packet-identity`, ffprobe, ['-v', 'error', ...INPUT_GUARDS, '-select_streams', String(stream.index),
            '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=stream_index,data_hash:packet_tags=:packet_side_data=side_data_type,skip_samples,discard_padding',
            '-of', 'compact=p=1:nk=0:escape=c', '-i', file], lineSink(async line => {
            const row = compactRow(line, 'packet', [...PACKET_FIELDS, 'data_hash']);
            need(int(row.stream_index, 'Packet stream', 0n) === BigInt(stream.index) && PACKET_HASH.test(String(row.data_hash)), 'Every copied packet needs its payload SHA-256.', IDENTITY_CODE);
            const signalled = own(row, 'side_data_type') || own(row, 'skip_samples') || own(row, 'discard_padding');
            if (signalled) need(row.side_data_type === 'Skip Samples' && own(row, 'skip_samples') && own(row, 'discard_padding'), 'Incomplete/unknown packet padding evidence.', IDENTITY_CODE);
            payload.update(`${row.data_hash.slice(7).toLowerCase()}\n`);
            side.update(`${count}:${signalled ? `${int(row.skip_samples, 'Skip samples', 0n)},${int(row.discard_padding, 'Discard padding', 0n)}` : '-'}\n`); count++;
          }, sinkOptions), budget.maxFrameBytes);
          let header = null;
          await invoke(`${label}-audio-${stream.index}-header`, ffprobe, ['-v', 'error', ...INPUT_GUARDS, '-select_streams', String(stream.index),
            '-show_streams', '-show_data_hash', 'sha256', '-show_entries', 'stream=index,extradata_hash:stream_tags=:stream_disposition=',
            '-of', 'compact=p=1:nk=0:escape=c', '-i', file], lineSink(async line => {
            const row = compactRow(line, 'stream', ['index', 'extradata_hash']);
            need(header === null && row.index === String(stream.index) && PACKET_HASH.test(String(row.extradata_hash)), 'The copied stream needs exactly one decoder header hash.', IDENTITY_CODE);
            header = row.extradata_hash.slice(7).toLowerCase();
          }, sinkOptions), budget.maxFrameBytes);
          need(count > 0 && header !== null, 'No copied packet identity was observed.', IDENTITY_CODE);
          const facts = { packets: count, payloadSha256: payload.digest('hex'), sideDataSha256: side.digest('hex'), extradataSha256: header };
          return { ...facts, seal: createHash('sha256').update(JSON.stringify(facts)).digest('hex') };
        }
        const sourcePackets = await packetIdentity(sourcePath, sa, 'source'), outputPackets = await packetIdentity(outputPath, oa, 'output');
        receipt.packetIdentity ||= [];
        receipt.packetIdentity.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex, source: sourcePackets, output: outputPackets });
        need(sourcePackets.seal === outputPackets.seal, 'Copied audio is not the source stream\'s own coded packets, header and padding.', IDENTITY_CODE);
        evidence.packetIdentity = { algorithm: 'sha256', packets: sourcePackets.packets, sourceSeal: sourcePackets.seal, outputSeal: outputPackets.seal };
      }
      decodedEvidence.audio.push(evidence);
    }
    if (packetClock) decodedEvidence.containerClock = { representation: CONTAINER_CLOCK, streams: clockStreams };
    const sourceAfter = await binding(sourcePath), sourceDisposition = sourceChange(sourceBefore, sourceAfter);
    need(sourceDisposition !== 'changed', 'Source content-related identity changed during evidence collection.', 'OPERATION_EVIDENCE_CHANGED');
    receipt.sourceAfter = stamps(sourceAfter); receipt.sourceIdentityDisposition = sourceDisposition;
    if (sourceDisposition === 'ctime-only') receipt.sourceIdentityWarning = 'Only ctime changed in the observed filesystem stamp. This is not proof of unchanged bytes; main must apply completed-source bounded-identity/warning policy. No cache, source or publication authority is granted.';
    receipt.outputAfter = stamps(await assertBound(outputPath, outputBefore));
    await directories(); cancelled(signal); Object.assign(receipt, { status: 'completed', decodedEvidence }); completed = true;
    return freeze(receipt);
  } catch (error) {
    Object.assign(receipt, { status: error.code === 'CANCELLED' ? 'cancelled' : 'failed', failure: evidenceFailure(error) });
    error.evidenceDirectory = directory; error.evidenceReceipt = receipt; throw error;
  } finally {
    // No generic cleanup API. An interrupted or rejected collection remains
    // diagnosable, and none of these logs grants authority over media/staging.
    try { await persist('receipt.json', receipt); }
    catch (error) { if (completed) { error.evidenceDirectory = directory; error.evidenceReceipt = receipt; throw error; } }
    finally { await Promise.allSettled(handles.map(handle => handle.close())); }
  }
}

module.exports = { VERSION, collectOperationEvidence, compactRow, lineSink, sourceChange, compareAudioTimelines, evidenceFailure };
