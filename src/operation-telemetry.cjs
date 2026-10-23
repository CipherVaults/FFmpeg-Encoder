'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Main-only encoder-input receipts, not a new IPC surface or publication grant.
// FFmpeg n9.0.2: fftools/ffmpeg_enc.c enc_stats_write/encode_frame. n and sn
// are written before incrementing; these are frames offered to the encoder,
// not proof that a packet was encoded, muxed, decoded or preserved correctly.
const FORMATS = Object.freeze({
  video: 'ffet1\tv\t{fidx}\t{sidx}\t{n}\t{ni}\t{tb}\t{pts}\t{tbi}\t{ptsi}',
  audio: 'ffet1\ta\t{fidx}\t{sidx}\t{n}\t{ni}\t{tb}\t{pts}\t{tbi}\t{ptsi}\t{sn}\t{samp}',
});
const sessions = new WeakMap();
const receipts = new WeakSet();
const MAX_BYTES = 256 * 1024 * 1024, MAX_RECORDS = 10000000, MAX_LINE = 1024;
const fault = (code, message) => Object.assign(new Error(message), { code });
function need(condition, message, code = 'TELEMETRY_INVALID') { if (!condition) throw fault(code, message); }
function cancelled(signal) { if (signal?.aborted) throw fault('CANCELLED', 'Telemetry reading was cancelled; retained files are unchanged.'); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function integer(value, { signed = false, unavailable = false } = {}) {
  need(typeof value === 'string' && (signed ? /^-?(0|[1-9]\d{0,19})$/ : /^(0|[1-9]\d{0,19})$/).test(value), 'Invalid bounded integer in encoder telemetry.');
  const number = BigInt(value);
  if (unavailable && (number === -1n || number === 18446744073709551615n)) return null;
  need(number >= (signed ? -9223372036854775808n : 0n) && number <= (signed ? 9223372036854775807n : 18446744073709551615n), 'Telemetry integer overflow.');
  return number;
}
function fraction(n, d) {
  need(d > 0n, 'Positive rational denominator required.');
  let a = n < 0n ? -n : n, b = d;
  while (b) { const r = a % b; a = b; b = r; }
  return { numerator: String(n / (a || 1n)), denominator: String(d / (a || 1n)) };
}
function timeBase(value, allowUnknown = false) {
  const match = /^(0|[1-9]\d{0,9})\/([1-9]\d{0,9})$/.exec(value);
  need(match && Number(match[1]) <= 2147483647 && Number(match[2]) <= 2147483647 && (allowUnknown || match[1] !== '0'), 'Invalid encoder time base.');
  return fraction(BigInt(match[1]), BigInt(match[2]));
}
const multiply = (r, value) => fraction(BigInt(r.numerator) * value, BigInt(r.denominator));
const subtract = (a, b) => fraction(BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
const add = (a, b) => fraction(BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
const compare = (a, b) => BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
function streamSpec(value) {
  need(value && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Array.isArray(value), 'Typed telemetry stream required.');
  const keys = Object.keys(value), allowed = ['outputIndex', 'kind', 'sampleRate'];
  need(keys.every(key => allowed.includes(key)) && keys.includes('outputIndex') && keys.includes('kind'), 'Unknown telemetry stream field.');
  need(Number.isSafeInteger(value.outputIndex) && value.outputIndex >= 0 && value.outputIndex <= 1023 && ['video', 'audio'].includes(value.kind), 'Invalid telemetry stream index or media type.');
  if (value.kind === 'audio') need(Number.isSafeInteger(value.sampleRate) && value.sampleRate > 0 && value.sampleRate <= 768000, 'Audio telemetry requires its validated sample rate.');
  else need(!keys.includes('sampleRate'), 'Video telemetry cannot carry an audio sample rate.');
  return { outputIndex: value.outputIndex, kind: value.kind, ...(value.kind === 'audio' ? { sampleRate: value.sampleRate } : {}) };
}
function limits(options) {
  const bytes = options.maxBytes ?? MAX_BYTES, records = options.maxRecords ?? MAX_RECORDS;
  need(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAX_BYTES && Number.isSafeInteger(records) && records > 0 && records <= MAX_RECORDS, 'Telemetry limits must be positive and bounded.');
  return { bytes, records };
}

// Streaming parser retains only a partial line and first/last records. Hashes
// authenticate these *statistics*, never video pixels or audio PCM. All timing
// arithmetic uses integer PTS/time_base; decimal display fields are not parsed.
async function summarizeTelemetry(chunks, specification, options = {}) {
  const spec = streamSpec(specification), cap = limits(options);
  const rawHash = createHash('sha256'), recordHash = createHash('sha256'), ptsHash = createHash('sha256');
  let bytes = 0, pending = '', count = 0n, samples = 0n, first = null, last = null;
  let unknownInput = 0n, repeatedPts = 0n, backwardsPts = 0n, audioDiscontinuities = 0n, minDelta = null, maxDelta = null;
  function consume(line) {
    need(line.length > 0 && line.length <= MAX_LINE && /^[\x09\x20-\x7e]+$/.test(line), 'Invalid or oversized statistics line.');
    const cells = line.split('\t'); need(cells.length === (spec.kind === 'video' ? 10 : 12), 'Unexpected statistics field count.');
    need(cells[0] === 'ffet1' && cells[1] === (spec.kind === 'video' ? 'v' : 'a'), 'Wrong telemetry format version or media type.');
    need(integer(cells[2]) === 0n && integer(cells[3]) === BigInt(spec.outputIndex), 'Statistics belong to another output file/stream.');
    need(integer(cells[4]) === count, 'Missing, duplicate or reordered encoder record.');
    const inputFrame = integer(cells[5], { signed: cells[5].startsWith('-'), unavailable: true });
    const tb = timeBase(cells[6]), pts = integer(cells[7], { signed: true });
    need(pts !== -9223372036854775808n, 'Encoder timestamp is unavailable.');
    const tbi = timeBase(cells[8], true), ptsi = integer(cells[9], { signed: true });
    const inputKnown = tbi.numerator !== '0' && ptsi !== 9223372036854775807n && ptsi !== -9223372036854775808n;
    const row = { n: String(count), inputFrame: inputFrame === null ? null : String(inputFrame), timeBase: tb, pts: String(pts), time: multiply(tb, pts),
      inputTimeBase: tbi, inputPts: inputKnown ? String(ptsi) : null, inputTime: inputKnown ? multiply(tbi, ptsi) : null };
    if (!inputKnown || inputFrame === null) unknownInput++;
    if (spec.kind === 'audio') {
      const sn = integer(cells[10]), samp = integer(cells[11]);
      need(sn === samples && samp > 0n && samp <= 2147483647n, 'Missing/overlapping sample receipt or invalid audio frame size.');
      row.sampleOffset = String(sn); row.samples = String(samp);
      row.endTime = add(row.time, fraction(samp, BigInt(spec.sampleRate))); samples += samp;
    }
    if (last) {
      const delta = subtract(row.time, last.time), sign = BigInt(delta.numerator);
      if (sign === 0n) repeatedPts++; if (sign < 0n) backwardsPts++;
      if (!minDelta || compare(delta, minDelta) < 0n) minDelta = delta;
      if (!maxDelta || compare(delta, maxDelta) > 0n) maxDelta = delta;
      if (spec.kind === 'audio' && compare(row.time, last.endTime) !== 0n) audioDiscontinuities++;
    }
    first ||= row; last = row; count++;
    need(count <= BigInt(cap.records), 'Encoder record limit exceeded.', 'TELEMETRY_LIMIT');
    recordHash.update(`${JSON.stringify(row)}\n`); ptsHash.update(`${row.time.numerator}/${row.time.denominator}\n`);
  }
  for await (const chunk of chunks) {
    cancelled(options.signal); need(Buffer.isBuffer(chunk) || typeof chunk === 'string', 'Byte chunks required.');
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += data.length;
    need(bytes <= cap.bytes, 'Telemetry file exceeds the read budget.', 'TELEMETRY_LIMIT'); rawHash.update(data);
    // Work in fixed slices even when a caller's chunk is larger than disk reads.
    for (let start = 0; start < data.length; start += 65536) {
      const slice = data.subarray(start, start + 65536);
      need(slice.every(byte => byte === 9 || byte === 10 || byte === 13 || byte >= 32 && byte <= 126), 'Non-ASCII telemetry data.');
      pending += slice.toString('ascii'); let end;
      while ((end = pending.indexOf('\n')) !== -1) { let line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.endsWith('\r')) line = line.slice(0, -1); consume(line); }
      need(pending.length <= MAX_LINE + 1, 'Unterminated/oversized statistics line.', 'TELEMETRY_LIMIT');
    }
  }
  cancelled(options.signal);
  need(pending.length === 0 && count > 0n, 'Empty or truncated statistics file.');
  return freeze({ schema: 1, scope: 'encoder-input-statistics', stream: spec, bytes, records: String(count),
    sampleCount: spec.kind === 'audio' ? String(samples) : null, first, last, unknownInputRecords: String(unknownInput),
    repeatedPts: String(repeatedPts), backwardsPts: String(backwardsPts), audioDiscontinuities: String(audioDiscontinuities), minPtsDelta: minDelta, maxPtsDelta: maxDelta,
    hashes: { algorithm: 'sha256', raw: rawHash.digest('hex'), canonicalRecords: recordHash.digest('hex'), orderedPts: ptsHash.digest('hex'), contentHash: false },
    videoDurationAvailable: false, completeOutputValidation: false });
}

const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const stamp = value => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].map(key => [key, String(value[key])]));
async function ordinaryDirectory(file) {
  const stat = await fs.lstat(file, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev !== 0n && stat.ino !== 0n && path.resolve(await fs.realpath(file)) === path.resolve(file), 'An ordinary main-owned directory is required.', 'TELEMETRY_PATH');
  return stat;
}
async function boundDirectories(session) {
  need(sameObject(session.stageIdentity, await ordinaryDirectory(session.stageDirectory)) && sameObject(session.directoryIdentity, await ordinaryDirectory(session.directory)), 'Telemetry directory identity changed.', 'TELEMETRY_PATH');
}
async function createOperationTelemetry({ stageDirectory, runtimeIdentity, planFingerprint, streams, maxBytes, maxRecords }) {
  need(typeof stageDirectory === 'string' && path.isAbsolute(stageDirectory), 'A main-owned absolute stage directory is required.', 'TELEMETRY_PATH');
  need(typeof runtimeIdentity === 'string' && /^[a-f0-9]{64}$/.test(runtimeIdentity) && typeof planFingerprint === 'string' && /^[a-f0-9]{64}$/.test(planFingerprint), 'Runtime and prepared-plan fingerprints are required.');
  need(Array.isArray(streams) && streams.length > 0 && streams.length <= 32, 'One to 32 encoded streams required.');
  const specs = streams.map(streamSpec); need(new Set(specs.map(s => s.outputIndex)).size === specs.length, 'Duplicate stream specifications.');
  const cap = limits({ maxBytes, maxRecords }), stage = path.resolve(stageDirectory), stageIdentity = await ordinaryDirectory(stage);
  // mkdtemp provides a fresh namespace: FFmpeg's stats files are not protected
  // by -n and must never be directed at existing evidence or renderer paths.
  const directory = await fs.mkdtemp(path.join(stage, 'encoder-telemetry-'));
  const directoryIdentity = await ordinaryDirectory(directory);
  need(sameObject(stageIdentity, await ordinaryDirectory(stage)), 'Stage changed while creating telemetry.', 'TELEMETRY_PATH');
  const files = specs.map(spec => ({ ...spec, path: path.join(directory, `stream-${spec.outputIndex}.tsv`), format: FORMATS[spec.kind] }));
  const reserved = [];
  try {
    for (const file of files) {
      const opened = await fs.open(file.path, 'wx+'); reserved.push({ file, opened });
      const identity = await opened.stat({ bigint: true });
      need(identity.isFile() && identity.nlink === 1n && identity.dev !== 0n && identity.ino !== 0n && identity.size === 0n
        && sameFile(identity, await fs.lstat(file.path, { bigint: true })), 'Exclusive statistics reservation could not be bound.', 'TELEMETRY_PATH');
      reserved.at(-1).identity = identity;
    }
  } catch (error) { await Promise.allSettled(reserved.map(item => item.opened.close())); throw error; }
  const ffmpegArgs = files.flatMap(file => [`-stats_enc_pre:${file.outputIndex}`, file.path, `-stats_enc_pre_fmt:${file.outputIndex}`, file.format]);
  const handle = freeze({ schema: 1, runtimeIdentity, planFingerprint, directory, streams: files, ffmpegArgs });
  sessions.set(handle, { stageDirectory: stage, stageIdentity, directory, directoryIdentity, files, reserved, cap, armed: false, collected: false, closed: false });
  return handle;
}
async function assertTelemetryReady(handle) {
  const state = sessions.get(handle); need(state && !state.armed && !state.collected && !state.closed, 'A fresh trusted telemetry handle is required.');
  await boundDirectories(state);
  const names = await fs.readdir(state.directory);
  need(names.length === state.files.length && names.every(name => state.files.some(file => path.basename(file.path) === name)), 'Telemetry namespace contains unexpected files.', 'TELEMETRY_PATH');
  for (const reserved of state.reserved) {
    const named = await fs.lstat(reserved.file.path, { bigint: true });
    need(named.isFile() && !named.isSymbolicLink() && sameFile(reserved.identity, named) && sameFile(named, await reserved.opened.stat({ bigint: true })), 'Reserved statistics changed; refuse FFmpeg truncation.', 'TELEMETRY_PATH');
  }
  state.armed = true; return true;
}
function assertTelemetryBinding(handle, { runtimeIdentity, planFingerprint, streams }) {
  const state = sessions.get(handle);
  need(state && !state.collected && !state.closed && handle.runtimeIdentity === runtimeIdentity
    && handle.planFingerprint === planFingerprint
    && JSON.stringify(state.files.map(({ outputIndex, kind, sampleRate }) => ({ outputIndex, kind, ...(sampleRate ? { sampleRate } : {}) }))) === JSON.stringify(streams),
  'Only the original main-owned telemetry reservation for this exact plan and encoded streams may bind an invocation.');
  return handle.ffmpegArgs;
}
async function collectOperationTelemetry(handle, { completion, signal } = {}) {
  const state = sessions.get(handle); need(state && state.armed && !state.collected && !state.closed, 'An armed trusted telemetry handle is required.');
  // This receipt comes from main's retained child, never from renderer input.
  need(completion?.childClosed === true && completion.exitCode === 0 && completion.cancelled === false, 'Successful child close is required; retained partial statistics grant no completeness.', 'TELEMETRY_INCOMPLETE');
  await boundDirectories(state); cancelled(signal);
  const collected = [];
  for (const reserved of state.reserved) {
    const file = reserved.file;
    const before = await fs.lstat(file.path, { bigint: true });
    need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.dev !== 0n && before.ino !== 0n && before.size > 0n && before.size <= BigInt(state.cap.bytes), 'Bounded ordinary single-link telemetry file required.', 'TELEMETRY_PATH');
    const opened = reserved.opened;
    {
      need(sameObject(reserved.identity, before), 'Reserved statistics file was replaced.', 'TELEMETRY_PATH');
      need(sameFile(before, await opened.stat({ bigint: true })), 'Telemetry open binding changed.', 'TELEMETRY_PATH');
      async function* read() { const buffer = Buffer.alloc(65536); let position = 0; while (position < Number(before.size)) { cancelled(signal); const result = await opened.read(buffer, 0, Math.min(buffer.length, Number(before.size) - position), position); need(result.bytesRead > 0, 'Telemetry read was incomplete.'); position += result.bytesRead; yield buffer.subarray(0, result.bytesRead); } }
      const summary = await summarizeTelemetry(read(), { outputIndex: file.outputIndex, kind: file.kind, ...(file.sampleRate ? { sampleRate: file.sampleRate } : {}) }, { maxBytes: state.cap.bytes, maxRecords: state.cap.records, signal });
      need(sameFile(before, await opened.stat({ bigint: true })) && sameFile(before, await fs.lstat(file.path, { bigint: true })), 'Telemetry changed while reading.', 'TELEMETRY_PATH');
      collected.push({ path: file.path, identity: stamp(before), summary });
    }
  }
  await boundDirectories(state); cancelled(signal); state.collected = true;
  const receipt = freeze({ schema: 1, runtimeIdentity: handle.runtimeIdentity, planFingerprint: handle.planFingerprint, completion: { childClosed: true, exitCode: 0, cancelled: false }, streams: collected,
    scope: 'encoder-input-statistics-only', publicationAuthorized: false,
    limitations: ['Not a decoded-content hash or output validity proof.', 'Input correspondence can be unknown after filtering.', 'No video last-frame duration in stats_enc_pre.', 'Read budgets bound memory and accepted evidence; the caller must separately budget disk growth while encoding.'] });
  receipts.add(receipt); return receipt;
}

function assertCollectedTelemetry(receipt) {
  need(receipt && receipts.has(receipt), 'Only an original completed main-owned telemetry receipt may be validated.');
  return receipt;
}

async function closeOperationTelemetry(handle, { childClosed } = {}) {
  const state = sessions.get(handle); need(state && childClosed === true, 'Main must drain its child before closing telemetry handles.', 'TELEMETRY_INCOMPLETE');
  if (state.closed) return;
  const result = await Promise.allSettled(state.reserved.map(item => item.opened.close())); state.closed = true;
  const failure = result.find(item => item.status === 'rejected'); if (failure) throw failure.reason;
  // No deletion: these receipts convey no cleanup or output publication right.
}

module.exports = { FORMATS, createOperationTelemetry, assertTelemetryReady, assertTelemetryBinding, assertCollectedTelemetry,
  collectOperationTelemetry, closeOperationTelemetry, summarizeTelemetry };
