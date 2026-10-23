'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe, parseProbeJson } = require('./inspection.cjs');
const { getRemuxAssessmentSource } = require('./remux-contract.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { provenanceArgs } = require('./provenance.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { classifyColor } = require('./media.cjs');
const { projectRequiredRemuxTags } = require('./remux-metadata-policy.cjs');

// Acquisition is main-owned and deliberately separate from qualification and
// validation. A successful capture can contain differing content/timestamps;
// only the validator with its measured cell policy decides preservation.
const LIMITS = Object.freeze({ timeoutMs: 120000, maxSourceBytes: 512 * 1024 * 1024,
  maxDurationSeconds: 120, maxFrameBytes: 8 * 1024 * 1024, maxPcmBytes: 128 * 1024 * 1024,
  maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/, PACKET_HASH = /^SHA256:([a-f0-9]{64})$/i;
const receipts = new WeakMap();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, code = 'REMUX_EVIDENCE_INVALID') => { throw new ToolError(code, message); };
const need = (value, message, code) => { if (!value) fail(message, code); };
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stamp = value => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(value[key])]));
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const same = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
function integer(value, label, minimum = -9223372036854775807n) {
  need(['string', 'number'].includes(typeof value) && /^-?\d{1,20}$/.test(String(value))
    && (typeof value !== 'number' || Number.isSafeInteger(value)), `${label} needs an exact native integer.`);
  const result = BigInt(value); need(result >= minimum && result <= 9223372036854775807n, `${label} is negative or exceeds its bound.`); return result;
}
function gcd(a, b) { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n, d = 1n) { n = BigInt(n); d = BigInt(d); need(d > 0n, 'Positive exact rational denominator required.'); const g = gcd(n, d); return { n: n / g, d: d / g }; }
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const abs = a => rational(a.n < 0n ? -a.n : a.n, a.d);
const greater = (a, b) => a.n * b.d > b.n * a.d;
const encoded = a => ({ numerator: String(a.n), denominator: String(a.d) });
function base(value) { const m = /^([1-9]\d{0,15})\/([1-9]\d{0,15})$/.exec(String(value)); need(m, 'Known positive native time base required.'); return rational(m[1], m[2]); }
function decimal(value) { const m = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(String(value)); need(m, 'Exact observed decimal time required.'); const digits = m[3] || '', d = 10n ** BigInt(digits.length); return rational((BigInt(m[2]) * d + BigInt(digits || '0')) * (m[1] ? -1n : 1n), d); }
const time = (ticks, stream) => { const b = base(stream.time_base); return rational(integer(ticks, 'Native PTS/duration') * b.n, b.d); };
function duration(frame, stream) {
  if (stream.codec_type === 'audio') return rational(integer(frame.nb_samples, 'Decoded sample count', 1n), integer(stream.sample_rate, 'Sample rate', 1n));
  const ticks = frame.duration ?? frame.pkt_duration;
  const result = ticks !== undefined ? time(ticks, stream) : decimal(frame.duration_time ?? frame.pkt_duration_time);
  need(result.n > 0n, 'A complete observed positive presentation duration is required; nominal FPS is not evidence.'); return result;
}
function nativeMetadata(frame, type, stream) {
  const fields = type === 'video' ? ['width', 'height', 'pix_fmt', 'sample_aspect_ratio', 'color_range', 'color_space',
    'color_primaries', 'color_transfer', 'chroma_location', 'interlaced_frame', 'top_field_first', 'repeat_pict',
    'crop_top', 'crop_bottom', 'crop_left', 'crop_right', 'key_frame', 'pict_type']
    : ['sample_fmt', 'sample_rate', 'channels', 'channel_layout'];
  // A missing frame field may use independently observed stream properties,
  // but an absent native channel layout can never be guessed from channel count.
  return canonical({ ...Object.fromEntries(fields.filter(key => own(frame, key) || own(stream, key))
    .map(key => [key, own(frame, key) ? frame[key] : stream[key]])), side_data_list: frame.side_data_list || [] });
}
function collectTimeline(frames, stream, contentSha256, maximumRecords = LIMITS.maxRecords) {
  need(Array.isArray(frames) && frames.length > 0 && frames.length <= maximumRecords, 'Missing, empty or excessive complete decoded frames.');
  const metadata = createHash('sha256'), chunks = []; let count = 0;
  for (const frame of frames) {
    need(plain(frame) && frame.media_type === stream.codec_type && frame.stream_index === stream.index, 'Decoded frame belongs to another stream/type.');
    const pts = time(frame.pts ?? frame.best_effort_timestamp, stream), extent = duration(frame, stream);
    const units = stream.codec_type === 'audio' ? Number(integer(frame.nb_samples, 'Decoded sample count', 1n)) : 1;
    need(Number.isSafeInteger(units) && Number.isSafeInteger(count + units), 'Decoded count exceeds exact representation.');
    const step = stream.codec_type === 'audio' ? rational(1, integer(stream.sample_rate, 'Native sample rate', 1n)) : extent;
    const native = JSON.stringify(nativeMetadata(frame, stream.codec_type, stream)) + '\n';
    // Per-sample metadata remains invariant when lossless PCM packet segmentation
    // changes. Each sample is budgeted by the independently captured PCM bytes.
    for (let unit = 0; unit < units; unit += 1) metadata.update(native);
    chunks.push({ pts, duration: extent, step, units }); count += units;
  }
  const first = chunks[0].pts, end = add(chunks.at(-1).pts, chunks.at(-1).duration);
  need(greater(end, first), 'The complete native interval must have positive extent.');
  return { chunks, count, record: { complete: true, exitCode: 0, stderrComplete: true, errors: [],
    representation: stream.codec_type === 'video' ? 'native-video-v1' : 'native-audio-v1', contentSha256,
    metadataSha256: metadata.digest('hex'), unitCount: String(count), firstPts: encoded(first), endPts: encoded(end) } };
}
function compareTimelines(before, after) {
  need(before.count === after.count, 'Every complete decoded/event unit must remain present.');
  let ai = 0, bi = 0, ao = 0, bo = 0, compared = 0, ptsError = rational(0), durationError = rational(0);
  while (ai < before.chunks.length && bi < after.chunks.length) {
    const a = before.chunks[ai], b = after.chunks[bi], units = Math.min(a.units - ao, b.units - bo);
    for (const offset of [0, units - 1]) {
      const ap = add(a.pts, rational(a.step.n * BigInt(ao + offset), a.step.d));
      const bp = add(b.pts, rational(b.step.n * BigInt(bo + offset), b.step.d));
      const error = abs(sub(ap, bp)); if (greater(error, ptsError)) ptsError = error;
    }
    const error = abs(sub(a.step, b.step)); if (greater(error, durationError)) durationError = error;
    compared += units; ao += units; bo += units;
    if (ao === a.units) { ai++; ao = 0; } if (bo === b.units) { bi++; bo = 0; }
  }
  need(compared === before.count && ai === before.chunks.length && bi === after.chunks.length, 'Incomplete per-unit timestamp comparison.');
  return { complete: true, comparedUnits: String(compared), maxPtsError: encoded(ptsError), maxDurationError: encoded(durationError) };
}
function pcmRepresentation(stream) {
  const representations = { s16: ['s16le', 2], s16p: ['s16le', 2], s32: ['s32le', 4], s32p: ['s32le', 4],
    flt: ['f32le', 4], fltp: ['f32le', 4], dbl: ['f64le', 8], dblp: ['f64le', 8] };
  need(own(representations, stream.sample_fmt), 'Unknown or unsupported native sample precision.');
  const [format, bytesPerSample] = representations[stream.sample_fmt];
  need(Number.isSafeInteger(stream.channels) && [1, 2].includes(stream.channels)
    && ['mono', 'stereo'].includes(stream.channel_layout)
    && (stream.channels === 1 ? stream.channel_layout === 'mono' : stream.channel_layout === 'stereo'), 'An observed exact mono/stereo layout is required.');
  need(stream.codec_name === 'aac' && stream.profile === 'LC' && stream.sample_fmt === 'fltp'
    || /^pcm_(s16le|s24le|s32le|f32le|f64le)$/.test(String(stream.codec_name)), 'This bounded collector has no native audio proof for this codec/profile.');
  if (stream.codec_name.startsWith('pcm_')) {
    const expected = { pcm_s16le: ['s16', 's16p'], pcm_s24le: ['s32', 's32p'], pcm_s32le: ['s32', 's32p'],
      pcm_f32le: ['flt', 'fltp'], pcm_f64le: ['dbl', 'dblp'] }[stream.codec_name];
    need(expected.includes(stream.sample_fmt), 'PCM codec and observed decoded precision contradict one another.');
  }
  integer(stream.sample_rate, 'Observed sample rate', 1n); return { format, bytesPerSample };
}
function frameHashRows(text, stream, maximumRecords) {
  const rows = []; let header = false;
  need(text.endsWith('\n'), 'Incomplete native framehash line.');
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('#')) { if (/^#hash:\s*SHA256\s*$/i.test(line)) header = true; continue; }
    const fields = line.split(',').map(v => v.trim());
    need(header && fields.length === 6 && fields[0] === '0' && HASH.test(fields[5]), 'Malformed or incomplete native SHA256 framehash record.');
    integer(fields[1], 'Framehash DTS'); integer(fields[2], 'Framehash PTS'); integer(fields[3], 'Framehash duration', 1n);
    const bytes = integer(fields[4], 'Native frame bytes', 1n);
    need(bytes === BigInt(stream.width * stream.height * 3 / 2), 'Video hash was not the complete native 8-bit 4:2:0 frame.');
    rows.push({ bytes: Number(bytes), sha256: fields[5] }); need(rows.length <= maximumRecords, 'Framehash record limit exceeded.', 'REMUX_EVIDENCE_LIMIT');
  }
  need(header && rows.length > 0, 'No complete native video hashes.'); return rows;
}
function nativeFrames(frames, stream) {
  for (const frame of frames) {
    need(plain(frame) && frame.media_type === stream.codec_type && frame.stream_index === stream.index,
      'Decoded frame belongs to another native stream.');
    const fields = stream.codec_type === 'video' ? ['width', 'height', 'pix_fmt'] : ['sample_fmt', 'channels', 'channel_layout', 'sample_rate'];
    for (const key of fields) {
      if (stream.codec_type === 'video') need(own(frame, key), 'Complete native video geometry and pixel format are required per frame.');
      if (own(frame, key)) need(String(frame[key]) === String(stream[key]), `${key} changed within the native decoded stream; automatic conversion is not evidence.`);
    }
    need(frame.side_data_list === undefined || Array.isArray(frame.side_data_list) && frame.side_data_list.every(plain), 'Malformed native frame side metadata.');
  }
  if (stream.codec_type === 'video') need(classifyColor({ streams: [stream] }, frames).classification === 'sdr',
    'The complete decoded video has unknown, conflicting or unsupported SDR/HDR evidence.');
}
function boundedBudget(value) {
  need(plain(value) && value.sourceDecode === 'complete', 'Main must explicitly budget complete source decode.', 'REMUX_EVIDENCE_COST_APPROVAL');
  const result = { ...LIMITS, sourceDecode: 'complete' };
  need(Object.keys(value).every(key => key === 'sourceDecode' || own(LIMITS, key)), 'Unknown evidence budget field.');
  for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']) need(own(value, key), `Explicit ${key} budget required.`);
  for (const [key, maximum] of Object.entries(LIMITS)) if (own(value, key)) {
    need(Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= maximum, `${key} exceeds the bounded production ceiling.`, 'REMUX_EVIDENCE_LIMIT'); result[key] = value[key];
  }
  return result;
}
async function binding(file, directory = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && !/[\0\r\n]/.test(file), 'Exact absolute ordinary paths are required.', 'REMUX_EVIDENCE_PATH');
  await assertOrdinaryPath(file, directory ? 'directory' : 'file'); const stat = await fs.lstat(file, { bigint: true });
  need(stat.dev !== 0n && stat.ino !== 0n && (directory || stat.nlink === 1n), 'Unknown identity or multiply linked evidence path.', 'REMUX_EVIDENCE_PATH'); return stat;
}
async function unchanged(file, prior, directory = false) {
  const after = await binding(file, directory); need(directory ? sameObject(prior, after) : same(prior, after), 'Selected source, output or evidence path changed.', 'REMUX_EVIDENCE_CHANGED'); return after;
}
function errorData(error) { return { code: String(error?.code || 'REMUX_EVIDENCE_FAILED').slice(0, 128), message: String(error?.message || error).slice(0, 2000),
  ...(error?.cause ? { cause: { code: String(error.cause.code || 'ERROR').slice(0, 128), message: String(error.cause.message || error.cause).slice(0, 2000) } } : {}) }; }

async function collectRemuxEvidence(options) {
  need(plain(options), 'A main-owned collector request is required.');
  const { assessment, runtimeIdentity, outputId, sourceProbe, outputProbe, sourcePath, outputPath, stageDirectory, ffmpeg, ffprobe, run, signal } = options;
  const source = getRemuxAssessmentSource(assessment), budget = boundedBudget(options.budget);
  need(typeof runtimeIdentity === 'string' && HASH.test(runtimeIdentity), 'Exact verified runtime identity required.'); provenanceArgs(outputId);
  need(assessment.sourceAdmission.marker.outputId !== outputId.toLowerCase(), 'A fresh output generation ID is required.');
  need(typeof run === 'function' && [ffmpeg, ffprobe].every(file => typeof file === 'string' && path.isAbsolute(file)), 'Main supplies bundled tools and the queue-owned runner.');
  const sourceProbeFingerprint = remuxProbeFingerprint(sourceProbe), outputProbeFingerprint = remuxProbeFingerprint(outputProbe);
  need(sourceProbeFingerprint === remuxProbeFingerprint(source) && sourceProbeFingerprint === assessment.sourceEvidenceFingerprint, 'Source probe does not belong to the genuine assessment.');
  const output = normalizeProbe(outputProbe), mappings = assessment.expectedOutput.streams;
  need(assessment.request.range === null && !assessment.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired,
    'Only complete source preservation without unqualified chapter carriers is collectible.');
  need(Array.isArray(mappings) && mappings.length > 0 && mappings.length <= 32 && output.streams.length === mappings.length
    && new Set(mappings.map(v => v.outputIndex)).size === mappings.length, 'The complete admitted map must be unambiguous.');
  need(source.streams.every(s => !['data', 'unknown'].includes(s.codec_type)) && !(source.stream_groups || []).length,
    'Timed data, related tracks and unknown streams have no complete collector proof.');
  const sourceDuration = decimal(source.format.duration); need(sourceDuration.n > 0n && !greater(sourceDuration, rational(budget.maxDurationSeconds)), 'Complete source duration exceeds the bounded acquisition policy.', 'REMUX_EVIDENCE_LIMIT');
  for (const mapping of mappings) {
    const before = source.streams.find(s => s.index === mapping.inputIndex), after = output.streams.find(s => s.index === mapping.outputIndex);
    need(before && after && before.codec_type === mapping.codecType && after.codec_type === mapping.codecType
      && before.codec_name === mapping.codecName && after.codec_name === mapping.codecName, 'Observed mapped codec/type changed or is absent.');
    if (mapping.codecType === 'video') for (const stream of [before, after]) {
      need(stream.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && Number.isSafeInteger(stream.width) && Number.isSafeInteger(stream.height)
        && stream.width > 0 && stream.height > 0 && stream.width % 2 === 0 && stream.height % 2 === 0
        && stream.width * stream.height <= 4096 * 4096 && classifyColor({ streams: [stream] }).classification === 'sdr',
      'Only bounded native H.264 8-bit SDR 4:2:0 video is implemented.');
    } else if (mapping.codecType === 'audio') { pcmRepresentation(before); pcmRepresentation(after); }
    else if (mapping.codecType === 'subtitle') need(assessment.inputFamily === 'matroska' && assessment.target === 'matroska'
      && ['subrip', 'ass'].includes(mapping.codecName), 'Only same-codec Matroska subrip/ASS coded event/header identity is implemented.');
    else need(mapping.codecType === 'attachment', 'Unsupported complete semantic stream type.');
  }
  const stop = () => need(!signal?.aborted, 'Remux evidence collection cancelled.', 'CANCELLED'); stop();
  const [sourceBefore, outputBefore, stageBefore] = await Promise.all([binding(sourcePath), binding(outputPath), binding(stageDirectory, true)]);
  need(!sameObject(sourceBefore, outputBefore), 'Source and output must be distinct immutable files.', 'REMUX_EVIDENCE_PATH');
  need(sourceBefore.size > 0n && outputBefore.size > 0n && sourceBefore.size <= BigInt(budget.maxSourceBytes)
    && outputBefore.size <= BigInt(budget.maxSourceBytes), 'Selected file exceeds the complete bounded source/output policy.', 'REMUX_EVIDENCE_LIMIT');
  const directory = await fs.mkdtemp(path.join(stageDirectory, 'remux-evidence-')), directoryBefore = await binding(directory, true);
  let spoolBytes = 0, active = false; const owned = [];
  const receipt = { version: 1, status: 'collecting', scope: 'complete-native-remux-essence-and-timeline', directory,
    runtimeIdentity, outputId: outputId.toLowerCase(), sourcePath, outputPath, sourceProbeFingerprint, outputProbeFingerprint,
    sourceBefore: stamp(sourceBefore), outputBefore: stamp(outputBefore), sourceAfter: null, outputAfter: null,
    budget, spoolBytes: 0, artifacts: [], invocations: [], comparisons: [], essenceEvidence: null,
    qualificationGranted: false, publicationAuthorized: false,
    limitations: ['Collection records actual differences; measured qualification and strict validation remain required.',
      'Subtitle support proves complete coded event and header identity, not rendered or decoded subtitle equivalence.'] };
  async function paths() { await unchanged(stageDirectory, stageBefore, true); await unchanged(directory, directoryBefore, true); await unchanged(sourcePath, sourceBefore); await unchanged(outputPath, outputBefore); }
  async function persist(name, bytes, reserve = 16384) {
    await paths(); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    need(spoolBytes + bytes.length + reserve <= budget.maxSpoolBytes, 'Complete evidence spool ceiling exceeded.', 'REMUX_EVIDENCE_LIMIT');
    const file = path.join(directory, name), handle = await fs.open(file, 'wx');
    try {
      const created = await handle.stat({ bigint: true }); need(created.nlink === 1n, 'Owned receipt is multiply linked.');
      await handle.writeFile(bytes); await handle.sync(); const final = await handle.stat({ bigint: true });
      need(sameObject(created, final) && final.nlink === 1n && final.size === BigInt(bytes.length) && same(final, await binding(file)), 'Owned receipt was replaced or changed.', 'REMUX_EVIDENCE_CHANGED');
      const artifact = { path: file, bytes: bytes.length, sha256: sha(bytes), identity: stamp(final) };
      owned.push({ file, stat: final }); spoolBytes += bytes.length; receipt.spoolBytes = spoolBytes; receipt.artifacts.push(artifact); return artifact;
    } finally { await handle.close(); }
  }
  async function invoke(label, executable, args, maxBytes, binary = false, probeQuery = null) {
    stop(); await paths(); need(!active, 'Only one queue-owned evidence child may run.'); active = true;
    const entry = { label, executable, args, status: 'running' }; receipt.invocations.push(entry);
    let bytes = 0; const hash = createHash('sha256'), chunks = [];
    try {
      const result = await run(executable, args, { signal, timeoutMs: budget.timeoutMs, stdoutLimit: maxBytes, stderrLimit: 256 * 1024,
        onStdoutChunk: async chunk => { stop(); need(Buffer.isBuffer(chunk), 'The runner must drain binary stdout chunks.'); bytes += chunk.length;
          need(Number.isSafeInteger(bytes) && bytes <= maxBytes, 'Evidence pipe exceeded its byte ceiling.', 'REMUX_EVIDENCE_LIMIT'); hash.update(chunk);
          if (!binary) chunks.push(Buffer.from(chunk)); } });
      entry.exitCode = result?.exitCode ?? null; entry.stdoutCapture = result?.stdoutCapture ?? null;
      entry.stderrCapture = result?.stderrCapture ?? null;
      entry.stderr = typeof result?.stderr === 'string' ? result.stderr.slice(-8192) : null;
      stop(); need(result?.exitCode === 0 && result.stdout === '' && result.stdoutCapture?.streamed === true
        && result.stdoutCapture.truncated === false && result.stdoutCapture.totalBytes === bytes,
      'Complete drained binary stdout capture is required.', 'REMUX_EVIDENCE_RUNNER');
      const cleanDiagnostics = result.stderr === '' && result.stderrCapture?.truncated === false && result.stderrCapture.totalBytes === 0;
      const diagnosticAssessment = cleanDiagnostics ? null : assessProbeDiagnostics(result, executable, args, probeQuery);
      need(cleanDiagnostics || diagnosticAssessment,
        'Warnings, errors or incomplete diagnostics refuse complete collection.', 'REMUX_EVIDENCE_DECODE');
      if (diagnosticAssessment) entry.diagnosticAssessment = diagnosticAssessment;
      await paths(); entry.status = 'completed'; entry.bytes = bytes; entry.sha256 = hash.digest('hex'); entry.stderrCapture = result.stderrCapture;
      if (!binary) entry.artifact = await persist(`child-${receipt.invocations.length}.stdout`, Buffer.concat(chunks));
      return { bytes, sha256: entry.sha256, text: binary ? null : Buffer.concat(chunks).toString('utf8') };
    } catch (error) {
      entry.status = 'failed'; entry.failure = errorData(error);
      if (typeof error?.stderr === 'string') { entry.stderr = error.stderr.slice(-8192); entry.stderrCapture = error.stderrCapture ?? null; }
      if (error?.stdoutCapture) entry.stdoutCapture = error.stdoutCapture;
      throw error;
    }
    finally { active = false; }
  }
  const probeArgs = (file, index) => ['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-select_streams', String(index)];
  const ffmpegArgs = (file, index) => ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-xerror', '-threads', '1',
    '-protocol_whitelist', 'file,pipe', '-copyts', '-noautorotate', '-i', file, '-map', `0:${index}`];
  const probeQueries = new Map([
    ['frames', ['-show_frames']],
    ['packets', ['-show_packets', '-show_data_hash', 'sha256']],
    ['header', ['-show_streams', '-show_data_hash', 'sha256', '-show_entries',
      'stream=index,codec_type,codec_name,extradata_size,extradata_hash:stream_tags']],
  ]);
  function assessProbeDiagnostics(result, executable, args, context) {
    // Retained native FFprobe evidence reports its absent TTF decoder even for
    // canonical selected frame/packet/header queries, including the TTF header
    // itself. Decoder discovery is not payload decoding in these probe queries.
    // Keep the exact diagnostic and still verify all returned records/payloads.
    if (!context || executable !== ffprobe || assessment.inputFamily !== 'matroska' || assessment.target !== 'matroska'
        || typeof result.stderr !== 'string'
        || result.stderrCapture?.truncated !== false || result.stderrCapture.totalBytes !== Buffer.byteLength(result.stderr, 'utf8')) return null;
    const { file, stream, kind } = context, side = file === sourcePath ? 'source' : file === outputPath ? 'output' : null;
    const query = probeQueries.get(kind), av = ['video', 'audio'].includes(stream.codec_type);
    const subtitle = stream.codec_type === 'subtitle' && ['subrip', 'ass'].includes(stream.codec_name);
    const selectedTtf = stream.codec_type === 'attachment' && stream.codec_name === 'ttf';
    if (!side || !query || (kind === 'frames' ? !av : kind === 'packets' ? !av && !subtitle : !av && !subtitle && !selectedTtf)
        || JSON.stringify(args) !== JSON.stringify([...probeArgs(file, stream.index), ...query, '-of', 'json', '-i', file])) return null;
    const media = side === 'source' ? source : output, indexKey = side === 'source' ? 'inputIndex' : 'outputIndex';
    const selected = mappings.find(mapping => mapping[indexKey] === stream.index && mapping.codecType === stream.codec_type && mapping.codecName === stream.codec_name);
    const diagnostic = /^Unsupported codec with id 98304 for input stream (0|[1-9]\d*)\r?\n$/.exec(result.stderr);
    if (!selected || !diagnostic || diagnostic[0] !== result.stderr) return null;
    const index = Number(diagnostic[1]), attachment = media.streams.find(value => value.index === index);
    const mapped = mappings.find(mapping => mapping[indexKey] === index && mapping.codecType === 'attachment'
      && mapping.codecName === 'ttf' && mapping.action === 'preserve-copy');
    if (!Number.isSafeInteger(index) || (selectedTtf && (kind !== 'header' || index !== stream.index)) || (!selectedTtf && index === stream.index)
        || !mapped || attachment?.codec_type !== 'attachment' || attachment.codec_name !== 'ttf'
        || !PACKET_HASH.test(String(attachment.extradata_hash)) || !Number.isSafeInteger(attachment.extradata_size) || attachment.extradata_size <= 0) return null;
    return { code: 'FFPROBE_TTF_ATTACHMENT_DECODER_DISCOVERY', disposition: 'expected-ttf-attachment-discovery-diagnostic',
      probeQuery: kind, selectedStreamIndex: stream.index, selectedCodecType: stream.codec_type, diagnosticStreamIndex: index,
      codecType: 'attachment', codecName: 'ttf', codecId: 98304, attachmentEvidenceRequired: true,
      message: 'This canonical probe query does not decode TTF payloads. Complete attachment header/payload verification remains mandatory.' };
  }
  async function json(label, file, stream, extra, key) {
    const result = await invoke(label, ffprobe, [...probeArgs(file, stream.index), ...extra, '-of', 'json', '-i', file], budget.maxFrameBytes,
      false, { file, stream, kind: key === 'streams' ? 'header' : key });
    const parsed = parseProbeJson(result.text, label);
    // FFprobe's selected-stream header query also emits these empty wrappers.
    // Nonempty relationships and all other sections still require refusal; this
    // does not replace the complete inspection relationship/fingerprint checks.
    need(plain(parsed) && Object.keys(parsed).every(section => section === key || key === 'streams'
      && ['programs', 'stream_groups'].includes(section) && Array.isArray(parsed[section]) && parsed[section].length === 0)
      && Array.isArray(parsed[key]) && parsed[key].length <= budget.maxRecords,
      'Missing, unexpected or excessive complete probe records.', 'REMUX_EVIDENCE_LIMIT'); return parsed[key];
  }
  async function packets(file, stream, label) {
    const records = await json(`${label}-packets`, file, stream, ['-show_packets', '-show_data_hash', 'sha256'], 'packets');
    need(stream.codec_type === 'subtitle' || records.length > 0, 'Complete video packets are missing.');
    for (const packet of records) {
      need(packet.stream_index === stream.index && PACKET_HASH.test(String(packet.data_hash)), 'Missing complete coded packet payload SHA256.');
      integer(packet.size, 'Complete coded packet bytes', 1n);
    }
    return { records, seal: sha(JSON.stringify(records.map(p => ({ bytes: String(p.size), sha256: p.data_hash.toLowerCase() })))) };
  }
  async function header(file, stream, label) {
    const records = await json(`${label}-header`, file, stream, ['-show_streams', '-show_data_hash', 'sha256', '-show_entries',
      'stream=index,codec_type,codec_name,extradata_size,extradata_hash:stream_tags'], 'streams');
    need(records.length === 1, 'Exactly one complete native codec header is required.'); const actual = records[0];
    need(actual.index === stream.index && actual.codec_type === stream.codec_type && actual.codec_name === stream.codec_name, 'Native header belongs to another stream.');
    // No extradata is a meaningful empty header for subrip; absent nonzero size
    // or an unknown hash is never replaced with an invented payload hash.
    const bytes = actual.extradata_size === undefined ? 0n : integer(actual.extradata_size, 'Codec header bytes', 0n);
    need(bytes <= BigInt(budget.maxFrameBytes) && (bytes === 0n ? actual.extradata_hash === undefined
      || String(actual.extradata_hash).toLowerCase() === `sha256:${sha(Buffer.alloc(0))}` : PACKET_HASH.test(String(actual.extradata_hash))), 'Missing or excessive native extradata hash.');
    if (stream.extradata_size !== undefined) need(integer(stream.extradata_size, 'Observed header size', 0n) === bytes, 'Codec header size changed from inspection.');
    if (stream.extradata_hash !== undefined) need(String(stream.extradata_hash).toLowerCase() === String(actual.extradata_hash).toLowerCase(), 'Codec header hash changed from inspection.');
    return { bytes: String(bytes), sha256: bytes ? PACKET_HASH.exec(actual.extradata_hash)[1].toLowerCase() : sha(Buffer.alloc(0)), tags: actual.tags || {} };
  }
  const collections = { source: new Map(), output: new Map() };
  try {
    // All source streams finish before any output stream. The queue owns each
    // supplied runner promise until child close and sink drainage completes.
    for (const [side, file, media] of [['source', sourcePath, source], ['output', outputPath, output]]) {
      let filePcmBytes = 0;
      for (const mapping of mappings) {
        const index = side === 'source' ? mapping.inputIndex : mapping.outputIndex;
        const stream = media.streams.find(value => value.index === index), label = `${side}-${index}`;
        if (stream.codec_type === 'attachment') {
          const payload = await header(file, stream, label); need(BigInt(payload.bytes) > 0n, 'Attachment must contain one nonempty complete payload.');
          need(typeof payload.tags.filename === 'string' && typeof payload.tags.mimetype === 'string', 'Attachment filename and mimetype identity are required.');
          collections[side].set(index, { record: { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'attachment-extradata-v1',
            contentSha256: payload.sha256, metadataSha256: sha(JSON.stringify(canonical({ codec: stream.codec_name, bytes: payload.bytes,
              tags: projectRequiredRemuxTags(payload.tags, { scope: 'stream' }) }))),
            unitCount: '1', firstPts: null, endPts: null }, kind: 'complete-attachment-extradata-identity' }); continue;
        }
        if (stream.codec_type === 'subtitle') {
          const payload = await header(file, stream, label), coded = await packets(file, stream, label), chunks = [];
          const metadata = createHash('sha256'); metadata.update(JSON.stringify(canonical({ codec: stream.codec_name,
            header: { ...payload, tags: projectRequiredRemuxTags(payload.tags, { scope: 'stream' }) } })) + '\n');
          for (const packet of coded.records) {
            const pts = time(packet.pts, stream), extent = duration(packet, stream);
            need(!(packet.side_data_list || []).length, 'Uninterpreted subtitle packet side data is not qualified.');
            chunks.push({ pts, duration: extent, step: extent, units: 1 }); metadata.update('{}\n');
          }
          const count = chunks.length;
          collections[side].set(index, { count, chunks, kind: 'complete-coded-subtitle-event-and-header-identity',
            record: { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'subtitle-events-v1',
              contentSha256: coded.seal, metadataSha256: metadata.digest('hex'), unitCount: String(count),
              firstPts: count ? encoded(chunks[0].pts) : null, endPts: count ? encoded(add(chunks.at(-1).pts, chunks.at(-1).duration)) : null } }); continue;
        }
        const frames = await json(`${label}-frames`, file, stream, ['-show_frames'], 'frames');
        need(frames.length > 0, 'Complete stream unexpectedly decoded no frames.');
        nativeFrames(frames, stream);
        let content, coded;
        if (stream.codec_type === 'video') {
          const captured = await invoke(`${label}-native-video`, ffmpeg, [...ffmpegArgs(file, index), '-an', '-sn', '-dn',
            '-c:v', 'rawvideo', '-pix_fmt', stream.pix_fmt, '-enc_time_base', 'demux', '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', 'pipe:1'], budget.maxFrameBytes);
          const hashes = frameHashRows(captured.text, stream, budget.maxRecords); need(hashes.length === frames.length, 'Every decoded video frame needs a complete native hash.');
          content = sha(JSON.stringify(hashes)); coded = await packets(file, stream, label);
        } else {
          const representation = pcmRepresentation(stream), samples = frames.reduce((sum, frame) => sum + integer(frame.nb_samples, 'Native decoded samples', 1n), 0n);
          need(samples <= integer(stream.sample_rate, 'Native sample rate', 1n) * BigInt(budget.maxDurationSeconds),
            'Complete native sample count exceeds the bounded source duration.', 'REMUX_EVIDENCE_LIMIT');
          const expectedBytes = samples * BigInt(stream.channels * representation.bytesPerSample);
          need(expectedBytes > 0n && expectedBytes <= BigInt(budget.maxPcmBytes - filePcmBytes), 'Complete PCM exceeds its per-file byte ceiling.', 'REMUX_EVIDENCE_LIMIT');
          const pcm = await invoke(`${label}-native-audio`, ffmpeg, [...ffmpegArgs(file, index), '-vn', '-sn', '-dn',
            '-c:a', `pcm_${representation.format}`, '-f', representation.format, 'pipe:1'], Number(expectedBytes), true);
          need(pcm.bytes === Number(expectedBytes), 'Complete native samples were truncated, padded or converted.'); filePcmBytes += pcm.bytes; content = pcm.sha256;
        }
        const timeline = collectTimeline(frames, stream, content, budget.maxRecords);
        const first = timeline.chunks[0].pts, end = add(timeline.chunks.at(-1).pts, timeline.chunks.at(-1).duration);
        // Output audio PTS can round at the destination time base. Its resource
        // bound is exact decoded samples/rate, already enforced before PCM;
        // source audio and all video retain the strict observed extent bound.
        // Full per-sample PTS and first/end intervals remain unmodified below
        // and require the independent validator's qualified timing tolerance.
        const resourceDuration = side === 'output' && stream.codec_type === 'audio'
          ? rational(timeline.count, integer(stream.sample_rate, 'Native sample rate', 1n)) : sub(end, first);
        need(!greater(resourceDuration, rational(budget.maxDurationSeconds)), 'Actual complete decoded extent exceeds the bounded source policy.', 'REMUX_EVIDENCE_LIMIT');
        timeline.opaqueSideData = [stream, ...frames].some(frame => (frame.side_data_list || [])
          .some(item => Object.keys(item).every(key => key === 'side_data_type')));
        if (timeline.opaqueSideData && stream.codec_type === 'video') {
          const codecHeader = await header(file, stream, label);
          // Matching complete packet data alone cannot cover an unexposed
          // semantic payload carried in the codec header/extradata instead.
          timeline.packetSeal = sha(JSON.stringify({ packets: coded.seal, bytes: codecHeader.bytes, header: codecHeader.sha256 }));
        }
        collections[side].set(index, timeline);
      }
    }
    const essence = { version: 1, runtimeIdentity, sourceFingerprint: assessment.sourceFingerprint,
      sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint, outputId: outputId.toLowerCase(),
      outputEvidenceFingerprint: outputProbeFingerprint, complete: true, streams: [] };
    for (const mapping of mappings) {
      const before = collections.source.get(mapping.inputIndex), after = collections.output.get(mapping.outputIndex);
      if (before.opaqueSideData || after.opaqueSideData) need(before.packetSeal && before.packetSeal === after.packetSeal,
        'Opaque decoded side-data descriptors require complete identical coded payload sequence; normalized payload proof is unavailable.', 'REMUX_EVIDENCE_OPAQUE');
      essence.streams.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex, codecType: mapping.codecType,
        source: before.record, output: after.record, timestamps: mapping.codecType === 'attachment' ? null : compareTimelines(before, after) });
      receipt.comparisons.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex,
        contentIdentical: before.record.contentSha256 === after.record.contentSha256,
        metadataIdentical: before.record.metadataSha256 === after.record.metadataSha256,
        evidenceKind: before.kind || `complete-native-${mapping.codecType}` });
    }
    // A full output seal also binds MOV representation receipts. Hash from an
    // open stable handle and prove both the name and handle stayed unchanged.
    await paths(); const handle = await fs.open(outputPath, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    try {
      need(same(outputBefore, await handle.stat({ bigint: true })), 'Output handle changed before full seal.');
      for (let offset = 0; offset < Number(outputBefore.size);) {
        stop(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(outputBefore.size) - offset), offset);
        need(bytesRead > 0, 'Incomplete output seal.'); hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      need(same(outputBefore, await handle.stat({ bigint: true })), 'Output changed during full seal.', 'REMUX_EVIDENCE_CHANGED');
    } finally { await handle.close(); }
    essence.outputFileSha256 = hash.digest('hex'); await paths();
    receipt.sourceAfter = stamp(await unchanged(sourcePath, sourceBefore)); receipt.outputAfter = stamp(await unchanged(outputPath, outputBefore));
    await persist('essence.json', Buffer.from(JSON.stringify(essence, null, 2))); receipt.essenceEvidence = essence;
    for (const item of owned) await unchanged(item.file, item.stat);
    receipt.status = 'completed'; await persist('receipt.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0);
    await paths(); for (const item of owned) await unchanged(item.file, item.stat);
    const result = freeze(receipt); receipts.set(result, { assessment, runtimeIdentity, outputId: outputId.toLowerCase(), essence }); return result;
  } catch (error) {
    receipt.status = signal?.aborted ? 'cancelled' : 'failed'; receipt.failure = errorData(error); receipt.essenceEvidence = null;
    // Never clean up or overwrite partial evidence. If the owned directory/path
    // changed, saving is refused and the in-memory failure retains that reason.
    try { await persist('failure.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0); }
    catch (saveError) { receipt.persistenceFailure = errorData(saveError); }
    return freeze(receipt);
  }
}

function getCollectedRemuxEvidence(receipt, { assessment, runtimeIdentity, outputId } = {}) {
  const state = receipts.get(receipt);
  need(state && receipt.status === 'completed' && state.assessment === assessment && state.runtimeIdentity === runtimeIdentity
    && typeof outputId === 'string' && state.outputId === outputId.toLowerCase(), 'A genuine complete matching main-owned Remux collector receipt is required.', 'REMUX_EVIDENCE_RECEIPT_REQUIRED');
  getRemuxAssessmentSource(assessment); return state.essence;
}

module.exports = { REMUX_EVIDENCE_LIMITS: LIMITS, collectRemuxEvidence, getCollectedRemuxEvidence };
