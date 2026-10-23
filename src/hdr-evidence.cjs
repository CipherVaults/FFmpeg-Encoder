'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { ToolError } = require('./process-runner.cjs');
const { parseProbeJson } = require('./inspection.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { validateHdrEncodingOutput } = require('./hdr-encoding.cjs');
const { getHdrOperationCollectionBinding } = require('./hdr-operation.cjs');
const { readSourceIdentity } = require('./source-identity.cjs');
const { inspectHdrContainer } = require('./hdr-container.cjs');
const { observeHdrInput, getObservedHdrInput } = require('./hdr-input.cjs');
const { classifyAnnexB } = require('./hevc-content.cjs');

// This collector owns acquisition only. The operation owner admits the exact
// content/configuration family and separately validates these branded facts.
const HDR_EVIDENCE_LIMITS = Object.freeze({ timeoutMs: 120000, maxFrameBytes: 8 * 1024 * 1024,
  maxPcmBytes: 128 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const SOURCE_BYTES = 16 * 1024 * 1024, OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_FRAMES = 1800, MAX_PIXEL_FRAMES = 829440000, MAX_DURATION_TICKS = 60000n, JOB_TIMEOUT_MS = 600000;
const FRAME_FIELDS = ['media_type', 'stream_index', 'pts', 'best_effort_timestamp', 'duration', 'pkt_duration', 'width', 'height', 'pix_fmt',
  'sample_aspect_ratio', 'display_aspect_ratio', 'interlaced_frame', 'top_field_first', 'repeat_pict', 'crop_top', 'crop_bottom', 'crop_left', 'crop_right',
  'color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location'];
const receipts = new WeakMap(), HASH = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (message, code = 'HDR_EVIDENCE_INVALID') => { throw new ToolError(code, message); };
const need = (value, message, code) => { if (!value) fail(message, code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const stamp = stat => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])]));
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const same = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const sourceChange = (a, b) => same(a, b) ? 'unchanged' : sameObject(a, b)
  && ['size', 'nlink', 'mtimeNs'].every(key => a[key] === b[key]) ? 'ctime-only' : 'changed';
function schema(value, allowed, required = allowed) {
  need(plain(value) && required.every(key => own(value, key)), 'Complete inert collector fields are required.');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && allowed.includes(key) && descriptor.enumerable && own(descriptor, 'value'), 'Collector fields cannot contain accessors or unsupported keys.');
  }
}
function budgetOf(value) {
  schema(value, ['sourceDecode', ...Object.keys(HDR_EVIDENCE_LIMITS)]);
  need(value.sourceDecode === 'complete', 'Complete source decode must be explicitly budgeted.', 'HDR_EVIDENCE_COST_APPROVAL');
  for (const [key, maximum] of Object.entries(HDR_EVIDENCE_LIMITS)) need(Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= maximum,
    `Explicit ${key} exceeds the bounded collector ceiling.`, 'HDR_EVIDENCE_LIMIT');
  return Object.freeze({ ...value });
}
function integer(value, label, minimum = 0n) {
  need((typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)) && /^-?\d{1,19}$/.test(String(value)), `${label} needs a native exact integer.`);
  const result = BigInt(value); need(result >= minimum && result <= 9223372036854775807n, `${label} is unavailable or outside its native bound.`); return result;
}
function base(value) {
  const match = /^([1-9]\d{0,9})\/([1-9]\d{0,9})$/.exec(String(value)); need(match, 'A reported positive native time base is required.');
  return { n: BigInt(match[1]), d: BigInt(match[2]) };
}
function rational(n, d) {
  let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b];
  return { numerator: String(n / (a || 1n)), denominator: String(d / (a || 1n)) };
}
const zero = () => ({ numerator: '0', denominator: '1' });
function timeline(frames, video, nativeClock = true) {
  const tb = base(video.time_base), rows = [];
  for (const frame of frames) {
    const reportedPts = frame.pts ?? frame.best_effort_timestamp;
    if (!nativeClock && reportedPts === undefined) { rows.push({ pts: null, duration: frame.duration ?? frame.pkt_duration ?? null }); continue; }
    const pts = integer(reportedPts, 'Decoded presentation timestamp'), duration = integer(frame.duration ?? frame.pkt_duration, 'Decoded presentation duration', 1n);
    if (frame.pts !== undefined && frame.best_effort_timestamp !== undefined) need(integer(frame.pts, 'PTS') === integer(frame.best_effort_timestamp, 'Best-effort PTS'), 'Native and best-effort PTS contradict one another.');
    if (frame.duration !== undefined && frame.pkt_duration !== undefined) need(integer(frame.duration, 'Duration', 1n) === integer(frame.pkt_duration, 'Packet duration', 1n), 'Reported native durations contradict one another.');
    if (rows.length && rows.at(-1).pts !== null) need(pts > BigInt(rows.at(-1).pts), 'Presentation timestamps are repeated or reordered.');
    rows.push({ pts: String(pts), duration: String(duration) });
  }
  if (nativeClock) need(video.time_base === '1/1000' && rows[0].pts === '0'
    && BigInt(rows.at(-1).pts) + BigInt(rows.at(-1).duration) <= MAX_DURATION_TICKS,
  'The complete native HDR interval must preserve its bounded zero-origin source clock.');
  const first = rows[0].pts === null ? null : rational(BigInt(rows[0].pts) * tb.n, tb.d);
  const last = rows.at(-1), end = last.pts === null ? null : rational((BigInt(last.pts) + BigInt(last.duration)) * tb.n, tb.d);
  return { timeBase: video.time_base, records: String(rows.length), rows, firstPts: first, endPts: end,
    clockAuthority: nativeClock ? 'complete-native-container-presentation' : 'raw-elementary-observation-only; no-invented-container-clock' };
}
function absence(value) { return value === undefined; }
function sideData(record, metadata, requireStatic) {
  const entries = record.side_data_list ?? []; need(Array.isArray(entries) && entries.length <= 8, 'Malformed or excessive HDR side data.');
  const seen = new Set();
  for (const entry of entries) {
    need(plain(entry) && typeof entry.side_data_type === 'string' && (!seen.has(entry.side_data_type)
      || entry.side_data_type === 'H.26[45] User Data Unregistered SEI message'), 'Malformed or duplicate HDR side data.'); seen.add(entry.side_data_type);
    const type = entry.side_data_type;
    const fields = type === 'Mastering display metadata' ? ['red_x', 'red_y', 'green_x', 'green_y', 'blue_x', 'blue_y', 'white_point_x', 'white_point_y', 'min_luminance', 'max_luminance']
      : type === 'Content light level metadata' ? ['max_content', 'max_average'] : type === 'H.26[45] User Data Unregistered SEI message' ? [] : null;
    need(fields !== null && Object.keys(entry).every(key => key === 'side_data_type' || fields.includes(key))
      && fields.every(key => own(entry, key)), 'Unknown or incompletely observed functional HDR side data is refused.');
  }
  if (requireStatic) for (const [key, type] of [['mastering', 'Mastering display metadata'], ['contentLight', 'Content light level metadata']])
    need(Boolean(metadata[key]) === seen.has(type), 'Each decoded frame must retain the exact static HDR metadata presence or absence.');
}
function checkPlane(video, frames, writerPlan, nativeClock, expected) {
  const width = expected.video.width, height = expected.video.height, rate = expected.video.avg_frame_rate;
  const sar = expected.video.sample_aspect_ratio;
  need(plain(video) && video.codec_type === 'video' && video.codec_name === 'hevc' && video.profile === 'Main 10'
    && video.width === width && video.height === height && video.pix_fmt === 'yuv420p10le'
    && Number.isSafeInteger(video.index) && video.index >= 0 && video.sample_aspect_ratio === sar
    && (sar === undefined ? absence(video.display_aspect_ratio) : video.display_aspect_ratio === undefined || video.display_aspect_ratio === expected.video.display_aspect_ratio)
    && ['progressive', undefined, 'unknown'].includes(video.field_order), 'HDR stream geometry, codec, SAR or scan declaration is outside the admitted family.');
  if (nativeClock) need(video.avg_frame_rate === rate && video.r_frame_rate === rate, 'HDR cadence declaration changed.');
  else {
    // Pinned rawdec.c initializes avg_frame_rate from its default25 option;
    // that field is not a recovered container presentation clock. Freeze the
    // measured raw tuple separately, retaining strict source/container clocks.
    // FFmpeg n9.0.2 libavformat/rawdec.c:82-83,114; hevcdec.c:58.
    need(video.avg_frame_rate === '25/1' && video.r_frame_rate === rate && video.time_base === '1/1200000',
      'The independent raw HEVC demux observation differs from its pinned exact signature.');
  }
  need(!Object.keys(video.tags || {}).some(key => /^(rotate|rotation|orientation)$/i.test(key)), 'Reported rotation is outside the admitted absence-preserving route.');
  const metadata = writerPlan ? writerPlan.expectedOutput.metadata : expected.sourceMetadata;
  need(metadata && typeof metadata === 'object', 'The complete observed source or selected output metadata expectation is required.');
  sideData(video, metadata, false);
  need(Array.isArray(frames) && frames.length === expected.frameCount && frames.length > 0 && frames.length <= MAX_FRAMES,
    'Every complete decoded HDR frame must match the observed source EOF count.');
  const rawDuration = String(1200000 / Number(rate.slice(0, -2)));
  for (const frame of frames) {
    if (!nativeClock) need(frame.pts === undefined && frame.best_effort_timestamp === undefined
      && String(frame.duration) === rawDuration && (!own(frame, 'pkt_duration') || String(frame.pkt_duration) === rawDuration),
    'Raw HEVC must retain the exact observed duration and absent presentation clock; no container clock is inferred.');
    need(plain(frame) && Object.keys(frame).every(key => FRAME_FIELDS.includes(key) || key === 'side_data_list')
      && frame.media_type === 'video' && frame.stream_index === video.index && frame.width === width && frame.height === height
      && frame.pix_fmt === 'yuv420p10le' && frame.sample_aspect_ratio === sar
      && (sar === undefined ? absence(frame.display_aspect_ratio) : frame.display_aspect_ratio === undefined || frame.display_aspect_ratio === expected.video.display_aspect_ratio)
      && [0, '0'].includes(frame.interlaced_frame), 'Every HDR frame needs exact native visible geometry, SAR and progressive scan.');
    for (const field of ['top_field_first', 'repeat_pict', 'crop_top', 'crop_bottom', 'crop_left', 'crop_right']) if (own(frame, field)) need([0, '0'].includes(frame[field]), `Nonzero ${field} is outside the admitted geometry.`);
    sideData(frame, metadata, true);
  }
  const plane = { video, frames, coverage: 'full', decodedFrameCount: frames.length, decodeExitCode: 0 };
  if (!writerPlan) {
    // Only the content-derived SDR branch reaches this path, after reacquiring
    // and reading a genuine complete HDR-input receipt. Its source contract is
    // independent of the transformed output; no preserve grant/writer is faked.
    for (const item of [video, ...frames]) for (const key of ['color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location'])
      need(item[key] === expected.video[key], 'Complete source HDR signal differs from its genuine input observation.', 'HDR_EVIDENCE_SIGNAL');
    return { ...plane, nativeTimeline: timeline(frames, video, nativeClock),
      validation: { complete: true, comparedUnits: frames.length, scope: 'genuine-complete-hdr-input-observation', chunks: [] } };
  }
  // The writer is a genuine owner-built HDR plan; its strict signal/static
  // checker is applied to every source/output frame as well as stream fields.
  // The pure signal checker remains bounded to 256 samples. Full EOF above is
  // the authority for this aggregator; no partial chunk calls itself complete.
  const chunks = [], validationVideo = video.field_order === 'progressive' ? video : { ...video, field_order: 'progressive' };
  let nextOrdinal = 0;
  while (nextOrdinal < frames.length) {
    const startOrdinal = nextOrdinal, chunk = frames.slice(startOrdinal, startOrdinal + 256);
    const sampled = { video: validationVideo, frames: chunk, coverage: 'sampled', decodedFrameCount: frames.length, decodeExitCode: 0 };
    const checked = validateHdrEncodingOutput(writerPlan, { container: sampled, bitstream: sampled });
    need(checked.valid, `Complete HDR signal/static observations differ from the prepared writer: ${checked.errors.join(' ')}`, 'HDR_EVIDENCE_SIGNAL');
    nextOrdinal += chunk.length; chunks.push({ startOrdinal, endOrdinalExclusive: nextOrdinal, frames: chunk.length, coverage: 'sampled', valid: true });
  }
  need(nextOrdinal === expected.frameCount && chunks.every((chunk, i) => chunk.startOrdinal === (i ? chunks[i - 1].endOrdinalExclusive : 0)), 'Complete HDR validation has an ordinal gap or overlap.');
  return { ...plane, nativeTimeline: timeline(frames, video, nativeClock), validation: { complete: true, comparedUnits: nextOrdinal, chunks } };
}
function compareTimelines(source, output) {
  need(source.timeBase === output.timeBase && source.rows.length === output.rows.length, 'Complete HDR clocks/counts must match.');
  for (let index = 0; index < source.rows.length; index++) need(source.rows[index].pts === output.rows[index].pts
    && source.rows[index].duration === output.rows[index].duration, `HDR presentation timestamp or duration differs at frame ${index}.`, 'HDR_EVIDENCE_TIMELINE');
  return { complete: true, comparedUnits: String(source.rows.length), maxPtsError: zero(), maxDurationError: zero(), tolerance: 'zero-native-ticks' };
}
function hashRows(text, video, frameCount) {
  need(text.endsWith('\n'), 'Truncated complete framehash output.');
  const rows = []; let hashHeader = false, formatHeader = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('#')) { if (/^#hash:\s*SHA256\s*$/i.test(line)) hashHeader = true; if (/^#format:\s*frame checksums\s*$/.test(line)) formatHeader = true; continue; }
    const fields = line.split(',').map(field => field.trim());
    need(hashHeader && formatHeader && fields.length === 6 && fields[0] === '0' && HASH.test(fields[5]), 'Malformed complete native SHA256 framehash.');
    integer(fields[1], 'Framehash DTS', -9223372036854775807n); integer(fields[2], 'Framehash PTS', -9223372036854775807n);
    const nativeBytes = video.width * video.height * 3;
    integer(fields[3], 'Framehash duration', 1n); need(integer(fields[4], 'Native frame bytes', 1n) === BigInt(nativeBytes), 'Native framehash must cover the complete 10-bit planar frame.');
    rows.push({ bytes: nativeBytes, sha256: fields[5] }); need(rows.length <= frameCount, 'Excess native video framehash records.', 'HDR_EVIDENCE_LIMIT');
  }
  need(hashHeader && rows.length === frameCount, 'Every decoded source-EOF frame needs a complete native hash.'); return rows;
}
async function binding(file, directory = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && !/[\0\r\n]/.test(file), 'Exact absolute ordinary paths are required.', 'HDR_EVIDENCE_PATH');
  await assertOrdinaryPath(file, directory ? 'directory' : 'file'); const stat = await fs.lstat(file, { bigint: true });
  need(stat.dev !== 0n && stat.ino !== 0n && (directory || stat.nlink === 1n), 'Unknown identity or multiply linked HDR evidence path.', 'HDR_EVIDENCE_PATH'); return stat;
}
async function unchanged(file, before, directory = false, source = false) {
  const after = await binding(file, directory); need(directory ? sameObject(before, after) : source ? sourceChange(before, after) !== 'changed' : same(before, after),
    'HDR source/output/evidence identity changed during collection.', 'HDR_EVIDENCE_CHANGED'); return after;
}
function failure(error, depth = 0) { return { code: String(error?.code || 'HDR_EVIDENCE_FAILED').slice(0, 128), message: String(error?.message || error).slice(0, 2000),
  ...(error?.cause && depth < 2 ? { cause: failure(error.cause, depth + 1) } : {}) }; }
const BINDING_FIELDS = ['plan', 'runtimeIdentity', 'outputId', 'sourcePath', 'outputPath', 'sourceProbe', 'outputProbe'];
function ownerBinding(options) {
  schema(options, BINDING_FIELDS); return getHdrOperationCollectionBinding(options.plan, Object.fromEntries(BINDING_FIELDS.filter(key => key !== 'plan').map(key => [key, options[key]])));
}

async function collectHdrEvidence(options) {
  schema(options, [...BINDING_FIELDS, 'stageDirectory', 'ffmpeg', 'ffprobe', 'run', 'signal', 'budget'], [...BINDING_FIELDS, 'stageDirectory', 'ffmpeg', 'ffprobe', 'run', 'budget']);
  const current = Object.fromEntries(BINDING_FIELDS.map(key => [key, options[key]])), admitted = ownerBinding(current);
  const { plan, runtimeIdentity, outputId, sourcePath, outputPath, sourceProbe, outputProbe, stageDirectory, ffmpeg, ffprobe, run } = options;
  const budget = budgetOf(options.budget);
  need(typeof run === 'function' && [ffmpeg, ffprobe].every(file => typeof file === 'string' && path.isAbsolute(file) && !/[\0\r\n]/.test(file)), 'Main supplies fixed bundled tools and the queue-owned runner.');
  need(admitted && HASH.test(admitted.planFingerprint) && admitted.writerPlan && typeof admitted.sourceFileSha256 === 'string'
    && HASH.test(admitted.sourceFileSha256), 'A genuine admitted HDR operation and reviewed full source hash are required.');
  const contentDerived = admitted.eligibilityMode === 'content', sdr = admitted.hdrPolicy === 'sdr';
  need(!sdr || contentDerived && admitted.writerPlan.contract.policy === 'sdr'
    && admitted.transform && admitted.transform.version === admitted.writerPlan.contract.filterContribution?.version
    && admitted.transform.filterGraphSha256 === sha(JSON.stringify(admitted.writerPlan.filterGraph))
    && admitted.transform.interpretationSha256 === sha(JSON.stringify(admitted.writerPlan.contract.filterContribution.interpretation))
    && admitted.transform.sourceProfilesSha256 === sha(JSON.stringify(admitted.sourceProfiles))
    && admitted.transform.outputProfilesSha256 === sha(JSON.stringify(admitted.outputProfiles)),
    'SDR collection requires the genuine complete-source and exact transform/profile bindings.');
  need(contentDerived || admitted.eligibilityMode === 'exact-seed', 'An explicit genuine content-derived or exact-seed eligibility mode is required.');
  need(!contentDerived || admitted.inputObservation?.complete === true && Array.isArray(admitted.sourceProfiles) && admitted.sourceProfiles.length > 0
    && Array.isArray(admitted.outputProfiles) && admitted.outputProfiles.length > 0,
  'Complete main-owned source observations and reviewed source/output parser profiles are required.');
  need(options.signal === undefined || options.signal && typeof options.signal.addEventListener === 'function' && typeof options.signal.aborted === 'boolean', 'A native cancellation signal is required.');
  const controller = new AbortController(), started = Date.now(); let timedOut = false;
  const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
  const signal = controller.signal;
  const stop = () => { need(!signal.aborted, timedOut ? 'HDR evidence exceeded its complete job deadline.' : 'HDR evidence collection cancelled; partial evidence is retained.', timedOut ? 'HDR_EVIDENCE_TIMEOUT' : 'CANCELLED');
    need(Date.now() - started < JOB_TIMEOUT_MS, 'HDR evidence exceeded its complete job deadline.', 'HDR_EVIDENCE_TIMEOUT'); };
  let sourceBefore, outputBefore, stageBefore, observedSource, directory, directoryBefore;
  try {
    stop();
    [sourceBefore, outputBefore, stageBefore] = await Promise.all([binding(sourcePath), binding(outputPath), binding(stageDirectory, true)]);
    need(!sameObject(sourceBefore, outputBefore), 'Source and output must be distinct files.', 'HDR_EVIDENCE_PATH');
    need(sourceBefore.size > 0n && sourceBefore.size <= BigInt(SOURCE_BYTES) && outputBefore.size > 0n && outputBefore.size <= BigInt(OUTPUT_BYTES), 'HDR source/output exceeds its finite byte envelope.', 'HDR_EVIDENCE_LIMIT');
    observedSource = await readSourceIdentity(sourcePath, { signal });
    need(admitted.sourceIdentity && ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'birthtimeNs', 'sparseDigest']
      .every(key => observedSource[key] === admitted.sourceIdentity[key]), 'Current source content-related identity differs from the prepared HDR identity.', 'HDR_EVIDENCE_CHANGED');
    directory = await fs.mkdtemp(path.join(stageDirectory, 'hdr-evidence-')); directoryBefore = await binding(directory, true);
  } catch (error) { options.signal?.removeEventListener('abort', abort); throw error; }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, JOB_TIMEOUT_MS); timer.unref();
  const receipt = { version: 2, status: 'collecting', scope: contentDerived ? 'complete-content-cpu-hdr-native-source-container-and-independent-bitstream'
    : 'complete-exact-seed-cpu-hdr-native-source-container-and-independent-bitstream', eligibilityMode: admitted.eligibilityMode, directory,
    planFingerprint: admitted.planFingerprint, runtimeIdentity, outputId, sourcePath, outputPath,
    sourceEvidenceFingerprint: admitted.sourceEvidenceFingerprint, outputEvidenceFingerprint: admitted.outputEvidenceFingerprint,
    expectedSourceFileSha256: admitted.sourceFileSha256,
    sourceBefore: stamp(sourceBefore), outputBefore: stamp(outputBefore), sourceAfter: null, outputAfter: null,
    budget, spoolBytes: 0, artifacts: [], invocations: [], hdrEvidence: null, qualificationGranted: false, publicationAuthorized: false };
  let spoolBytes = 0, active = false; const owned = [];
  async function paths(retainingFailure = false) {
    if (!retainingFailure) stop(); await unchanged(stageDirectory, stageBefore, true); await unchanged(directory, directoryBefore, true);
    await unchanged(sourcePath, sourceBefore, false, true); await unchanged(outputPath, outputBefore);
    for (const item of owned) await unchanged(item.file, item.stat);
    if (retainingFailure) return;
    const latest = ownerBinding(current); need(latest === admitted || latest.planFingerprint === admitted.planFingerprint
      && latest.sourceEvidenceFingerprint === admitted.sourceEvidenceFingerprint && latest.outputEvidenceFingerprint === admitted.outputEvidenceFingerprint
      && latest.sourceFileSha256 === admitted.sourceFileSha256,
    'The genuine operation binding expired during collection.', 'HDR_EVIDENCE_CHANGED');
  }
  async function persist(name, bytes, reserve = 65536, retainingFailure = false) {
    await paths(retainingFailure); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    need(spoolBytes + bytes.length + reserve <= budget.maxSpoolBytes, 'HDR retained evidence exceeds its spool ceiling.', 'HDR_EVIDENCE_LIMIT');
    const file = path.join(directory, name), handle = await fs.open(file, 'wx');
    try { const created = await handle.stat({ bigint: true }); need(created.nlink === 1n, 'Evidence file must be single linked.');
      await handle.writeFile(bytes); await handle.sync(); const final = await handle.stat({ bigint: true });
      need(sameObject(created, final) && final.size === BigInt(bytes.length), 'Incomplete owned evidence write.'); await unchanged(file, final);
      const artifact = { name, bytes: bytes.length, sha256: sha(bytes), stamp: stamp(final) };
      owned.push({ file, stat: final }); spoolBytes += bytes.length; receipt.spoolBytes = spoolBytes; receipt.artifacts.push(artifact); return { file, artifact };
    } finally { await handle.close(); }
  }
  async function invoke(label, executable, args, maximum, retain = true) {
    await paths(); need(!active, 'HDR collector children must remain sequential.'); active = true;
    const invocation = { label, executable, args, status: 'running' }; receipt.invocations.push(invocation);
    const chunks = [], hash = createHash('sha256'); let bytes = 0, accepting = true, children = 0, live = 0;
    const closures = [], streams = []; let childError = null;
    try {
      const result = await run(executable, args, { signal, timeoutMs: Math.min(budget.timeoutMs, JOB_TIMEOUT_MS - (Date.now() - started)), stdoutLimit: maximum, stderrLimit: 256 * 1024,
        onChild(child) {
          need(child && typeof child.once === 'function' && child.stdout && typeof child.stdout.once === 'function'
            && child.stderr && typeof child.stderr.once === 'function', 'One actual child and observable stdout/stderr pipes are required.', 'HDR_EVIDENCE_RUNNER');
          children++; live++; const stream = { stdoutEnded: false, stderrEnded: false }; streams.push(stream);
          closures.push(new Promise(resolve => child.once('close', (code, exitSignal) => { live--; resolve({ code, signal: exitSignal }); })));
          child.once('error', error => { childError = error; });
          child.stdout.once('end', () => { stream.stdoutEnded = true; }); child.stderr.once('end', () => { stream.stderrEnded = true; });
          child.stdout.once('error', error => { childError = error; }); child.stderr.once('error', error => { childError = error; });
          need(children === 1, 'Only one actual child per sequential collector stage is permitted.', 'HDR_EVIDENCE_RUNNER');
        },
        onStdoutChunk: async chunk => { stop(); need(accepting && Buffer.isBuffer(chunk), 'Runner must await and drain bounded binary stdout sinks.', 'HDR_EVIDENCE_RUNNER'); bytes += chunk.length;
          need(Number.isSafeInteger(bytes) && bytes <= maximum, 'HDR child stdout exceeds its byte ceiling.', 'HDR_EVIDENCE_LIMIT'); hash.update(chunk);
          chunks.push(Buffer.from(chunk)); } });
      accepting = false; invocation.exitCode = result?.exitCode ?? null; invocation.stdoutCapture = result?.stdoutCapture ?? null;
      invocation.stderrCapture = result?.stderrCapture ?? null; invocation.stderr = typeof result?.stderr === 'string' ? result.stderr.slice(-8192) : null;
      const premature = live > 0; if (premature) controller.abort(); const closed = await Promise.all(closures);
      need(!premature && children === 1 && live === 0 && closed[0]?.code === 0 && [null, undefined].includes(closed[0]?.signal)
        && streams[0]?.stdoutEnded && streams[0]?.stderrEnded && !childError,
      'An actual successful child close, complete stream EOF and drained sinks are required.', 'HDR_EVIDENCE_RUNNER');
      stop(); need(result?.exitCode === 0 && result.stdout === '' && result.stdoutCapture?.streamed === true && result.stdoutCapture.truncated === false
        && result.stdoutCapture.totalBytes === bytes, 'Actual successful closed/drained stdout accounting is required.', 'HDR_EVIDENCE_RUNNER');
      need(result.stderr === '' && result.stderrCapture?.truncated === false && result.stderrCapture.totalBytes === 0,
        'Warnings/errors or incomplete stderr accounting refuse complete HDR evidence.', 'HDR_EVIDENCE_DECODE');
      await paths(); invocation.status = 'completed'; invocation.bytes = bytes; invocation.sha256 = hash.digest('hex');
      invocation.childClosed = true; invocation.stdoutDrained = true; invocation.stdoutEnded = true; invocation.stderrEnded = true;
      const captured = Buffer.concat(chunks); if (retain) invocation.artifact = (await persist(`child-${receipt.invocations.length}.stdout`, captured)).artifact;
      return { bytes, sha256: invocation.sha256, bytesData: captured, artifact: invocation.artifact };
    } catch (error) {
      accepting = false; if (live) controller.abort(); await Promise.all(closures); invocation.status = 'failed'; invocation.failure = failure(error);
      if (typeof error?.stderr === 'string') { invocation.stderr = error.stderr.slice(-8192); invocation.stderrCapture = error.stderrCapture ?? null; }
      if (error?.stdoutCapture) invocation.stdoutCapture = error.stdoutCapture;
      if (chunks.length) try { invocation.partialArtifact = (await persist(`child-${receipt.invocations.length}.partial`, Buffer.concat(chunks), 65536, true)).artifact; } catch (saveError) { invocation.persistenceFailure = failure(saveError); }
      throw error;
    } finally { active = false; }
  }
  const guards = elementary => ['-protocol_whitelist', 'file,pipe', '-format_whitelist', elementary ? 'hevc' : 'matroska,webm'];
  async function frames(label, file, video, expected, elementary = false) {
    const capture = await invoke(`${label}-frames`, ffprobe, ['-v', 'error', ...guards(elementary), '-select_streams', String(video.index),
      '-show_frames', '-show_entries', `frame=${FRAME_FIELDS.join(',')}:frame_side_data`, ...(elementary ? ['-show_streams', '-show_programs', '-show_stream_groups'] : []), '-of', 'json', '-i', file], budget.maxFrameBytes);
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(capture.bytesData); } catch { fail('Invalid UTF-8 in complete probe output.'); }
    const parsed = parseProbeJson(text, `${label} complete HDR frames`);
    need(plain(parsed) && Object.keys(parsed).every(key => key === 'frames' || elementary && ['streams', 'programs', 'stream_groups'].includes(key))
      && Array.isArray(parsed.frames) && parsed.frames.length <= budget.maxRecords, 'Unexpected, missing or excessive complete HDR probe records.', 'HDR_EVIDENCE_LIMIT');
    if (elementary) {
      need(Array.isArray(parsed.streams) && parsed.streams.length === 1 && ['programs', 'stream_groups'].every(key => Array.isArray(parsed[key]) && parsed[key].length === 0), 'Raw HEVC must have one independently observed stream and no relationships.');
      video = parsed.streams[0];
    }
    return { ...checkPlane(video, parsed.frames, admitted.writerPlan, !elementary, expected), frameArtifact: capture.artifact };
  }
  async function nativeHashes(label, file, video, elementary = false) {
    const capture = await invoke(`${label}-native-framehash`, ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', '-threads', '1',
      ...guards(elementary), '-copyts', '-noautorotate', '-i', file, '-map', `0:${video.index}`, '-an', '-sn', '-dn', '-c:v', 'rawvideo',
      '-pix_fmt', '+yuv420p10le', '-enc_time_base', 'demux', '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', 'pipe:1'], budget.maxFrameBytes);
    const rows = hashRows(capture.bytesData.toString('ascii'), video, contentDerived ? admitted.inputObservation.frameCount : 96);
    return { representation: `native-yuv420p10le-full-${video.width}x${video.height}-framehash-sha256`, complete: true, rows, sha256: sha(JSON.stringify(rows)), artifact: capture.artifact };
  }
  async function fileSeal(file, before, source = false, containerRate = null) {
    await paths(); const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536), chunks = []; let total = 0;
    try {
      need(source ? sourceChange(before, await handle.stat({ bigint: true })) !== 'changed' : same(before, await handle.stat({ bigint: true })), 'File handle changed before full HDR seal.');
      while (total < Number(before.size)) { stop(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - total), total);
        need(bytesRead > 0, 'Incomplete full HDR file seal.'); hash.update(buffer.subarray(0, bytesRead));
        if (containerRate) chunks.push(Buffer.from(buffer.subarray(0,bytesRead))); total += bytesRead; }
      need(source ? sourceChange(before, await handle.stat({ bigint: true })) !== 'changed' : same(before, await handle.stat({ bigint: true })), 'File changed during full HDR seal.', 'HDR_EVIDENCE_CHANGED');
      await unchanged(file, before, false, source); return { bytes: total, sha256: hash.digest('hex'), stamp: stamp(await handle.stat({ bigint: true })),
        ...(containerRate ? { containerTiming: inspectHdrContainer(Buffer.concat(chunks),{frameRate:containerRate}) } : {}) };
    } finally { await handle.close(); }
  }
  try {
    need(Array.isArray(sourceProbe.streams) && sourceProbe.streams.length === 1 && Array.isArray(outputProbe.streams) && outputProbe.streams.length === 1,
      'One complete video stream is required for both HDR planes.');
    let observed, observedReceipt, source, expected;
    if (contentDerived) {
      const inputBindings = { sourcePath, sourceIdentity: observedSource, probe: sourceProbe, runtimeIdentity, profiles: admitted.sourceProfiles };
      // Reacquire complete packet/configuration and source EOF facts. An earlier
      // prepared receipt is a comparison target, never a substitute for current
      // collection or permission to renew its source identity.
      observedReceipt = await observeHdrInput({ ...inputBindings, ffprobe, run, signal });
      observed = getObservedHdrInput(observedReceipt, inputBindings); const prepared = admitted.inputObservation;
      need(observed.sourceFileSha256 === admitted.sourceFileSha256 && observed.sourceFileSha256 === prepared.sourceFileSha256,
        'Fresh complete source SHA256 differs from the prepared per-input content.', 'HDR_EVIDENCE_SOURCE_HASH');
      need(observed.compressedFingerprint === prepared.compressedFingerprint && observed.timelineHash === prepared.timelineHash
        && observed.frameCount === prepared.frameCount && observed.pixelFrames === prepared.pixelFrames
        && JSON.stringify(observed.configurationMetadata) === JSON.stringify(prepared.configurationMetadata)
        && observed.profilesFingerprint === prepared.profilesFingerprint,
      'Fresh complete source configuration, compressed classification, clock or EOF differs from preparation.', 'HDR_EVIDENCE_CHANGED');
      expected = { video: sourceProbe.streams[0], frameCount: observed.frameCount,
        ...(sdr ? { sourceMetadata: observed.configurationMetadata.metadata } : {}) };
      need(Number.isSafeInteger(expected.frameCount) && expected.frameCount > 0 && expected.frameCount <= MAX_FRAMES && expected.frameCount <= budget.maxRecords
        && expected.video.width * expected.video.height * expected.frameCount <= MAX_PIXEL_FRAMES,
      'Complete source exceeds its frame or pixel-frame envelope.', 'HDR_EVIDENCE_LIMIT');
      source = checkPlane(expected.video, observed.frames, sdr ? null : admitted.writerPlan, true, expected);
      source.containerTiming = observed.containerTiming;
      source.compressedFingerprint = observed.compressedFingerprint;
      need(observed.timeline?.timeBase === source.nativeTimeline.timeBase && observed.timeline.records === expected.frameCount
        && JSON.stringify(observed.timeline.rows) === JSON.stringify(source.nativeTimeline.rows), 'Source observer and collector native clocks disagree.', 'HDR_EVIDENCE_TIMELINE');
      const sourceFrameBytes = Buffer.from(JSON.stringify({ frames: observed.frames }));
      need(sourceFrameBytes.length <= budget.maxFrameBytes, 'Complete source frames exceed the explicit frame-capture ceiling.', 'HDR_EVIDENCE_LIMIT');
      source.frameArtifact = (await persist('source-frames.json', sourceFrameBytes)).artifact;
      source.inputObservation = observedReceipt;
    } else {
      // Compatibility is intentionally confined to the already reviewed two
      // exact source hashes by the genuine operation owner. Missing content
      // observations never fall back into this mode; the explicit owner mode,
      // historic byte/geometry/count/clock envelope and final full SHA all bind.
      need(sourceBefore.size <= 1048576n && outputBefore.size <= 4194304n, 'Exact-seed HDR exceeds its historical byte envelope.', 'HDR_EVIDENCE_LIMIT');
      expected = { video: sourceProbe.streams[0], frameCount: 96 };
      need(expected.video.width === 320 && expected.video.height === 180 && expected.video.avg_frame_rate === '30/1'
        && absence(expected.video.sample_aspect_ratio) && absence(expected.video.display_aspect_ratio), 'Exact-seed HDR geometry and cadence changed.');
      source = await frames('source', sourcePath, expected.video, expected);
      need(source.nativeTimeline.timeBase === '1/1000' && source.nativeTimeline.rows.at(-1).pts === '3167'
        && BigInt(source.nativeTimeline.rows.at(-1).pts) + BigInt(source.nativeTimeline.rows.at(-1).duration) === 3200n,
      'Exact-seed HDR must retain its complete historical 0..3200 native interval.', 'HDR_EVIDENCE_TIMELINE');
    }
    source.nativeHashes = await nativeHashes('source', sourcePath, source.video);
    const container = await frames('container', outputPath, outputProbe.streams[0], expected); container.nativeHashes = await nativeHashes('container', outputPath, container.video);
    const timestamps = compareTimelines(source.nativeTimeline, container.nativeTimeline);
    // Independently extract compressed HEVC into an exclusively created owned
    // file. dump_extra retains parameter sets at keyframes; no SEI is stripped.
    const extraction = await invoke('independent-hevc-extraction', ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-xerror', ...guards(false),
      '-i', outputPath, '-map', `0:${container.video.index}`, '-an', '-sn', '-dn', '-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb,dump_extra=freq=keyframe', '-f', 'hevc', 'pipe:1'], OUTPUT_BYTES, false);
    need(extraction.bytes > 0, 'The independent elementary HEVC extraction is empty.');
    const elementary = await persist('output.hevc', extraction.bytesData), elementaryBefore = await binding(elementary.file);
    let compressedOutput;
    if (contentDerived) {
      compressedOutput = classifyAnnexB(extraction.bytesData, { profiles: admitted.outputProfiles,
        transfer: sdr ? 'bt709' : expected.video.color_transfer, ...(sdr ? { outputMode: 'sdr-bt709-main10' } : {}) });
      need(compressedOutput.pictureCount === expected.frameCount && ['width', 'height', 'frameRate', 'sampleAspectRatio'].every(key =>
        compressedOutput.configuration[key] === observed.configurationMetadata.configuration[key]),
      'Independent complete output configuration, count or geometry differs from the current source.', 'HDR_EVIDENCE_BITSTREAM');
      if (sdr) need(compressedOutput.outputMode === 'sdr-bt709-main10'
        && compressedOutput.configuration.transfer === 'bt709' && compressedOutput.configuration.primaries === 'bt709'
        && compressedOutput.configuration.matrix === 'bt709' && compressedOutput.metadata.mastering === null
        && compressedOutput.metadata.contentLight === null && compressedOutput.alternativeTransfer === null,
        'SDR compressed output must establish BT.709 and complete obsolete-HDR-metadata absence.', 'HDR_EVIDENCE_BITSTREAM');
      else need(compressedOutput.configuration.transfer === observed.configurationMetadata.configuration.transfer
        && JSON.stringify(compressedOutput.metadata) === JSON.stringify(observed.configurationMetadata.metadata),
        'Independent complete output transfer/static metadata differs from the current HDR source.', 'HDR_EVIDENCE_BITSTREAM');
    } else need(extraction.bytes <= 4194304, 'Exact-seed elementary output exceeds its historical byte envelope.', 'HDR_EVIDENCE_LIMIT');
    const bitstream = await frames('bitstream', elementary.file, { index: 0 }, expected, true); bitstream.nativeHashes = await nativeHashes('bitstream', elementary.file, bitstream.video, true);
    if (compressedOutput) bitstream.compressed = compressedOutput;
    need(container.nativeHashes.sha256 === bitstream.nativeHashes.sha256, 'Independently extracted HEVC decoded pixels differ from the staged container.', 'HDR_EVIDENCE_BITSTREAM');
    const sourceSeal = await fileSeal(sourcePath, sourceBefore, true), outputSeal = await fileSeal(outputPath, outputBefore, false, contentDerived ? sourceProbe.streams[0].avg_frame_rate : null);
    if (contentDerived) for (const field of ['timestampScaleNs','defaultDurationNs','declaredDurationTicks','trackTimeScale','codecDelayNs','trackOffsetNs','trackEnabled'])
      need(outputSeal.containerTiming[field] === observed.containerTiming[field], 'Raw output timing metadata differs from the frozen source container.', 'HDR_EVIDENCE_DURATION');
    need(sourceSeal.sha256 === admitted.sourceFileSha256,
      'Independent complete source SHA256 differs from the prepared per-input content; no complete evidence authority is granted.', 'HDR_EVIDENCE_SOURCE_HASH');
    const elementarySeal = await fileSeal(elementary.file, elementaryBefore);
    let compressedInventoryArtifact;
    if (contentDerived) {
      const inventory = facts => ({ fingerprint: facts.fingerprint, framing: facts.framing,
        arrays: facts.arrays || [], packetInventory: facts.packetInventory || [], nalInventory: facts.nalInventory });
      compressedInventoryArtifact = (await persist('compressed-inventories.json', Buffer.from(JSON.stringify({ version: 1,
        source: inventory(observed.configurationMetadata), output: inventory(compressedOutput) })))).artifact;
    }
    receipt.sourceAfter = stamp(await unchanged(sourcePath, sourceBefore, false, true)); receipt.outputAfter = stamp(await unchanged(outputPath, outputBefore));
    receipt.sourceIdentityDisposition = sourceChange(sourceBefore, await binding(sourcePath));
    if (admitted.sourceIdentity.ctimeNs !== receipt.sourceAfter.ctimeNs) receipt.sourceIdentityDisposition = 'ctime-only';
    if (receipt.sourceIdentityDisposition === 'ctime-only') receipt.sourceIdentityWarning = 'Observed ctime-only difference is descriptive; main must still perform its completed-source policy. It renews no cache, grant or publication authority.';
    const hdrEvidence = { version: 2, complete: true, eligibilityMode: admitted.eligibilityMode, planFingerprint: admitted.planFingerprint, runtimeIdentity, outputId,
      hdrPolicy: admitted.hdrPolicy ?? 'preserve', ...(sdr ? { transform: admitted.transform } : {}),
      sourceFingerprint: admitted.sourceFingerprint, sourceEvidenceFingerprint: admitted.sourceEvidenceFingerprint, outputEvidenceFingerprint: admitted.outputEvidenceFingerprint,
      source, container, bitstream, timestamps, expectedSourceFileSha256: admitted.sourceFileSha256,
      sourceFileSha256: sourceSeal.sha256, outputFileSha256: outputSeal.sha256,
      sourceSeal, outputSeal, elementarySeal, outputBefore: receipt.outputBefore, outputAfter: receipt.outputAfter,
      sourceBefore: receipt.sourceBefore, sourceAfter: receipt.sourceAfter, sourceIdentityDisposition: receipt.sourceIdentityDisposition };
    // Retain each full frame array only in its canonical child/source capture.
    // Public evidence uses sealed references; the genuine accessor below owns
    // the complete in-memory facts needed for final operation assessment.
    const compressedManifest = (facts, section) => ({ fingerprint: facts.fingerprint, configuration: facts.configuration, metadata: facts.metadata,
      framing: facts.framing, compressedBytes: facts.compressedBytes, pictureCount: facts.pictureCount, packetCount: facts.packetCount,
      nalCount: facts.nalCount, seiCount: facts.seiCount, nalInventorySha256: sha(JSON.stringify(facts.nalInventory)),
      packetInventorySha256: sha(JSON.stringify(facts.packetInventory || [])), inventory: { artifact: compressedInventoryArtifact, section },
      nalTypes: (facts.nalInventory || []).reduce((counts, nal) => { const key = String(nal.type); counts[key] = (counts[key] || 0) + 1; return counts; }, {}) });
    const planeManifest = plane => ({ video: plane.video, coverage: plane.coverage, decodedFrameCount: plane.decodedFrameCount, decodeExitCode: plane.decodeExitCode,
      frameArtifact: plane.frameArtifact, timeline: { timeBase: plane.nativeTimeline.timeBase, records: plane.nativeTimeline.records,
        firstPts: plane.nativeTimeline.firstPts, endPts: plane.nativeTimeline.endPts, clockAuthority: plane.nativeTimeline.clockAuthority,
        rowsSha256: sha(JSON.stringify(plane.nativeTimeline.rows)) }, validation: plane.validation,
      nativeHashes: { representation: plane.nativeHashes.representation, complete: true, records: plane.nativeHashes.rows.length,
        sha256: plane.nativeHashes.sha256, artifact: plane.nativeHashes.artifact } });
    const manifest = { ...hdrEvidence, eligibilityMode: admitted.eligibilityMode,
      source: { ...planeManifest(source), ...(contentDerived ? { inputObservation: observedReceipt, compressed: compressedManifest(observed.configurationMetadata, 'source') } : {}) },
      container: planeManifest(container), bitstream: { ...planeManifest(bitstream), ...(compressedOutput ? { compressed: compressedManifest(compressedOutput, 'output') } : {}) } };
    await persist('hdr-evidence.json', Buffer.from(JSON.stringify(manifest, null, 2))); receipt.hdrEvidence = manifest;
    await paths(); receipt.status = 'completed'; await persist('receipt.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0); await paths();
    const result = freeze(receipt); receipts.set(result, { admitted, current, evidence: freeze(hdrEvidence) }); return result;
  } catch (error) {
    receipt.status = options.signal?.aborted || error?.code === 'CANCELLED' && !timedOut ? 'cancelled' : 'failed'; receipt.failure = failure(error); receipt.hdrEvidence = null;
    try { await persist('failure.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0, true); } catch (saveError) { receipt.persistenceFailure = failure(saveError); }
    return freeze(receipt);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

function getCollectedHdrEvidence(receipt, bindings) {
  const state = receipts.get(receipt); need(state && receipt.status === 'completed', 'A genuine complete matching main-owned HDR collector receipt is required.', 'HDR_EVIDENCE_RECEIPT_REQUIRED');
  // Retrieve omitted paths/probes from this private completed collection, never
  // from an unbranded public receipt property. Descriptive probe copies may
  // match by normalized fingerprint; the private plan remains unforgeable.
  schema(bindings, BINDING_FIELDS, ['plan', 'runtimeIdentity', 'outputId']);
  const resolved = { ...state.current, ...bindings };
  const current = ownerBinding(resolved);
  need(BINDING_FIELDS.filter(key => !['sourceProbe', 'outputProbe'].includes(key)).every(key => state.current[key] === resolved[key]) && current.planFingerprint === state.admitted.planFingerprint
    && current.sourceEvidenceFingerprint === state.admitted.sourceEvidenceFingerprint && current.outputEvidenceFingerprint === state.admitted.outputEvidenceFingerprint
    && current.sourceFileSha256 === state.admitted.sourceFileSha256 && state.evidence.sourceFileSha256 === state.admitted.sourceFileSha256,
  'A genuine current matching HDR collection binding is required.', 'HDR_EVIDENCE_RECEIPT_REQUIRED');
  return state.evidence;
}

module.exports = { HDR_EVIDENCE_LIMITS, collectHdrEvidence, getCollectedHdrEvidence };
