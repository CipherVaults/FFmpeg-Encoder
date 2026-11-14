'use strict';

// Main-only observation of the sealed native file. Demuxed packet timestamps
// do not expose elst playback rate or prove the absence of extra movie edits.
const fs = require('node:fs/promises');
const { ToolError } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const FIELDS = ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const need = (ok, message, code = 'REMUX_EDIT_LIST_UNVERIFIED') => { if (!ok) throw new ToolError(code, message); };
const stamp = s => Object.fromEntries(FIELDS.map(k => [k, String(s[k])]));
const ratio = value => {
  need(value && /^-?\d{1,40}$/.test(value.numerator) && /^[1-9]\d{0,39}$/.test(value.denominator), 'An exact source presentation interval is required.');
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
};
const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const greater = (a, b) => a.n * b.d > b.n * a.d;
const IDENTITY_MATRIX = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
const matrix = (b, at) => Array.from({ length: 9 }, (_, i) => b.readInt32BE(at + i * 4));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function scaled(value, scale, rounding = 'exact') {
  const n = value.n * scale;
  need(n >= 0n && (rounding !== 'exact' || n % value.d === 0n), 'The source interval cannot be represented exactly on the native movie/media clock.', 'REMUX_EDIT_LIST_UNEXPECTED');
  return rounding === 'up' ? (n + value.d - 1n) / value.d : n / value.d;
}
function remuxEditInterval(record, stream) {
  let start = ratio(record.firstPts); const end = ratio(record.endPts);
  if (stream.start_pts !== undefined && /^-?\d{1,20}$/.test(String(stream.start_pts)) && /^\d{1,16}\/\d{1,16}$/.test(stream.time_base)) {
    const [n, d] = stream.time_base.split('/').map(BigInt); need(n > 0n && d > 0n, 'Source track clock is invalid.');
    const declared = { n: BigInt(stream.start_pts) * n, d };
    if (greater(declared, start)) start = declared;
  }
  // PCM/sample-trim evidence can name a leading AAC edit even when the source
  // container has no explicit native start tick (e.g. a Matroska CodecDelay).
  if (stream.codec_type === 'audio' && record.audioTrim) {
    const first = ratio(record.firstPts), rate = BigInt(stream.sample_rate);
    const trimmed = { n: first.n * rate + BigInt(record.audioTrim.leadingSamples) * first.d, d: first.d * rate };
    if (greater(trimmed, start)) start = trimmed;
  }
  need(start.n >= 0n && greater(end, start), 'The source visible interval has no supported nonnegative movie edit.', 'REMUX_EDIT_LIST_UNEXPECTED');
  return { firstPts: record.firstPts, visibleStart: { numerator: String(start.n), denominator: String(start.d) }, endPts: record.endPts,
    ...(record.representation === 'packet-identity-v1' ? { packetCount: record.unitCount } : {}) };
}

async function observeRemuxEditLists({ fileReceipt, outputProbe, intervals, maxRecords, exact = false, signal, onProgress,
  sourceMode = false, timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // Keep source-derived time budgets proportional. A fixed upper limit here
  // would turn a long source's larger allowance into a length refusal.
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(deadline), 'Invalid native observation deadline.');
  const stop = () => { if (signal?.aborted) throw new ToolError('CANCELLED', 'Native edit-list observation cancelled.');
    need(Date.now() <= deadline, 'Native playback observation exceeded its deadline.', 'REMUX_NATIVE_TIMEOUT'); }; stop();
  const controlCode = sourceMode ? 'REMUX_SOURCE_PLAYBACK_UNSUPPORTED' : 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED';
  const editCode = sourceMode ? 'REMUX_SOURCE_EDIT_UNSUPPORTED' : 'REMUX_EDIT_LIST_UNEXPECTED';
  need(fileReceipt && typeof fileReceipt.path === 'string' && (sourceMode || /^[a-f0-9]{64}$/.test(fileReceipt.sha256))
    && Number.isSafeInteger(fileReceipt.bytes) && fileReceipt.bytes > 0 && fileReceipt.identity, 'A sealed native output-file receipt is required.');
  need(Number.isSafeInteger(maxRecords) && maxRecords > 0 && Number.isSafeInteger(maxRecords * 32 + 8 * 1024 ** 2), 'Native edit-list accounting overflow.');
  need(Array.isArray(intervals) && intervals.length > 0 && intervals.length <= 32 && intervals.length === outputProbe.streams.length, 'Exact native edit-list track coverage is required.');
  const trackIds = new Map();
  for (const stream of outputProbe.streams) {
    need(typeof stream.id === 'string' && /^(?:0x[0-9a-f]{1,8}|[1-9]\d{0,9})$/i.test(stream.id), 'A native output track ID is required.');
    const id = Number(BigInt(stream.id)); need(id > 0 && id <= 0xffffffff && !trackIds.has(id), 'Native output track IDs must be unique.'); trackIds.set(id, stream.index);
  }
  await assertOrdinaryPath(fileReceipt.path); const named = await fs.lstat(fileReceipt.path, { bigint: true }), handle = await fs.open(fileReceipt.path, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.dev !== 0n && before.ino !== 0n && Number(before.size) === fileReceipt.bytes
      && FIELDS.every(k => String(before[k]) === fileReceipt.identity[k] && before[k] === named[k]), 'Native file differs from its sealed identity.');
    let bytesRead = 0, atomCount = 0;
    const metadataLimit = maxRecords * 32 + 8 * 1024 ** 2;
    async function read(at, count) {
      stop(); need(Number.isSafeInteger(at) && at >= 0 && Number.isSafeInteger(count) && count >= 0 && count <= 65536
        && at + count <= fileReceipt.bytes && (bytesRead += count) <= metadataLimit, 'Native edit-list read exceeds its byte/position bound.');
      const b = Buffer.alloc(count); for (let n = 0; n < count;) { stop(); const r = await handle.read(b, n, count - n, at + n); need(r.bytesRead > 0, 'Truncated native edit-list metadata.'); n += r.bytesRead; }
      onProgress?.({ completed: bytesRead, total: metadataLimit }); return b;
    }
    async function boxes(start, end, depth) {
      need(depth <= 6, 'Native edit-list nesting exceeds its bound.'); const result = [];
      for (let at = start; at < end;) {
        need(end - at >= 8 && ++atomCount <= 4096, 'Native atom boundary/count is invalid.'); const h = await read(at, 8); let n = BigInt(h.readUInt32BE()), header = 8;
        if (n === 1n) { need(end - at >= 16, 'Truncated extended native atom.'); n = (await read(at + 8, 8)).readBigUInt64BE(); header = 16; }
        if (n === 0n) n = BigInt(end - at);
        need(n >= BigInt(header) && n <= BigInt(end - at), 'Native atom exceeds its parent.');
        result.push({ type: h.toString('ascii', 4, 8), body: at + header, end: at + Number(n) }); at += Number(n);
      } return result;
    }
    const one = (list, type) => { const a = list.filter(b => b.type === type); need(a.length === 1, `Exactly one ${type} atom is required.`); return a[0]; };
    const top = await boxes(0, fileReceipt.bytes, 0), movie = one(top, 'moov'), movieBoxes = await boxes(movie.body, movie.end, 1), mvhd = one(movieBoxes, 'mvhd');
    const mh = await read(mvhd.body, Math.min(112, mvhd.end - mvhd.body)); need([0, 1].includes(mh[0]) && mh.length >= (mh[0] ? 112 : 100), 'Invalid native movie header.');
    const movieScale = BigInt(mh.readUInt32BE(mh[0] ? 20 : 12)); need(movieScale > 0n, 'Native movie timescale must be positive.');
    const movieDuration = mh[0] ? mh.readBigUInt64BE(24) : BigInt(mh.readUInt32BE(16)), movieAt = mh[0] ? 32 : 20;
    need(mh.readInt32BE(movieAt) === 65536 && mh.readUInt16BE(movieAt + 4) === 256 && equal(matrix(mh, movieAt + 16), IDENTITY_MATRIX),
      'Movie playback must use rate 1.0, volume 1.0 and an identity matrix; Remux cannot normalise these controls.', controlCode);
    const traks = movieBoxes.filter(b => b.type === 'trak'); need(traks.length === trackIds.size, 'Native edit-list track set differs from the output.');
    const result = [], seen = new Set(); let maximumTrackEnd = 0n;
    for (const trak of traks) {
      const ts = await boxes(trak.body, trak.end, 2), tkhd = one(ts, 'tkhd'), mdia = one(ts, 'mdia');
      const th = await read(tkhd.body, Math.min(96, tkhd.end - tkhd.body)); need([0, 1].includes(th[0]) && th.length >= (th[0] ? 96 : 84), 'Invalid native track header.');
      const id = th.readUInt32BE(th[0] ? 20 : 12), duration = th[0] ? th.readBigUInt64BE(28) : BigInt(th.readUInt32BE(20));
      need(trackIds.has(id) && !seen.has(id), 'Native edit-list track ID is missing, duplicated or foreign.'); seen.add(id);
      const outputIndex = trackIds.get(id), expected = intervals.find(i => i.outputIndex === outputIndex); need(expected, 'Missing source edit interval.');
      const stream = outputProbe.streams.find(s => s.index === outputIndex), kind = stream.codec_type;
      need(['video', 'audio'].includes(kind), 'Native track kind must be known.', controlCode);
      const controlAt = th[0] ? 44 : 32, controls = { flags: th.readUIntBE(1, 3), layer: th.readInt16BE(controlAt),
        alternateGroup: th.readInt16BE(controlAt + 2), volume: th.readUInt16BE(controlAt + 4), matrix: matrix(th, controlAt + 8) };
      const neutral = { flags: 3, layer: 0, alternateGroup: kind === 'audio' ? 1 : 0, volume: kind === 'audio' ? 256 : 0, matrix: IDENTITY_MATRIX };
      // An explicitly omitted track has no copied playback to preserve. Movie
      // controls still apply globally; validate every copied track below.
      if (sourceMode && expected.selected === false) { result.push({ outputIndex, trackId: id, selected: false }); continue; }
      need(equal(controls, neutral) && (!expected.sourceControls || equal(controls, expected.sourceControls)),
        `Stream ${outputIndex}: playback requires an enabled track, default ${kind} volume, identity matrix and neutral layer/alternate group.`, controlCode);
      const ms = await boxes(mdia.body, mdia.end, 3), mdhd = one(ms, 'mdhd'), minf = one(ms, 'minf');
      const h = await read(mdhd.body, Math.min(40, mdhd.end - mdhd.body)); need(h.length >= 24 && [0, 1].includes(h[0]), 'Invalid native media header.');
      const mediaScale = BigInt(h.readUInt32BE(h[0] ? 20 : 12)); need(mediaScale > 0n, 'Native media timescale must be positive.');
      need(h.length >= (h[0] ? 36 : 24), 'Truncated native media duration.');
      const mediaHeaderDuration = h[0] ? h.readBigUInt64BE(24) : BigInt(h.readUInt32BE(16));
      const stbl = one(await boxes(minf.body, minf.end, 4), 'stbl'), samples = await boxes(stbl.body, stbl.end, 5), stsz = one(samples, 'stsz');
      const sizes = await read(stsz.body, 12); need(stsz.end - stsz.body >= 12 && sizes.readUInt32BE() === 0, 'Invalid native sample-size table.');
      const sampleCount = sizes.readUInt32BE(8); need(sampleCount > 0 && sampleCount <= maxRecords
        && stsz.end - stsz.body === 12 + (sizes.readUInt32BE(4) ? 0 : sampleCount * 4), 'Native sample count exceeds its bound.');
      if (expected.packetCount !== undefined) need(BigInt(expected.packetCount) === BigInt(sampleCount), 'Native sample count differs from complete packet coverage.');
      async function* runs(box, composition = false) {
        const head = await read(box.body, 8), version = head[0], count = head.readUInt32BE(4);
        need((composition ? version === 0 || version === 1 : version === 0) && head.subarray(1, 4).every(b => b === 0)
          && count > 0 && count <= maxRecords && box.end - box.body === 8 + count * 8, 'Invalid native timing run table.');
        let covered = 0;
        for (let i = 0; i < count;) {
          const amount = Math.min(512, count - i), chunk = await read(box.body + 8 + i * 8, amount * 8);
          for (let j = 0; j < amount; j++) {
            const n = chunk.readUInt32BE(j * 8), value = composition && version ? chunk.readInt32BE(j * 8 + 4) : chunk.readUInt32BE(j * 8 + 4);
            need(n > 0 && (covered += n) <= sampleCount && (composition || value > 0), 'Invalid native timing run/count.'); yield { n: BigInt(n), value: BigInt(value) };
          } i += amount;
        }
        need(covered === sampleCount, 'Native timing table does not cover every sample.');
      }
      const ctts = samples.filter(b => b.type === 'ctts'); need(ctts.length <= 1, 'Duplicate native composition table.');
      const ds = runs(one(samples, 'stts')), cs = ctts.length ? runs(ctts[0], true) : (async function* () { yield { n: BigInt(sampleCount), value: 0n }; })();
      let d = await ds.next(), c = await cs.next(), clock = 0n, minimum = null;
      try {
        while (!d.done && !c.done) {
          const take = d.value.n < c.value.n ? d.value.n : c.value.n, first = clock + c.value.value;
          if (minimum === null || first < minimum) minimum = first;
          clock += take * d.value.value; d.value.n -= take; c.value.n -= take;
          if (!d.value.n) d = await ds.next(); if (!c.value.n) c = await cs.next();
        }
        need(d.done && c.done && minimum !== null, 'Incomplete native timing coverage.');
      } finally { await ds.return(); await cs.return(); }
      // mdhd is decode duration, the exact sum of every STTS run, including
      // B-frame reordering. It is not the maximum CTTS presentation endpoint.
      need(mediaHeaderDuration === clock, 'Native media duration differs from its complete sample timing.', 'REMUX_MEDIA_DURATION_UNEXPECTED');
      const first = sourceMode ? null : ratio(expected.firstPts), start = sourceMode ? null : ratio(expected.visibleStart), end = sourceMode ? null : ratio(expected.endPts),
        span = sourceMode ? null : sub(end, start), lead = sourceMode ? null : sub(start, first);
      if (!sourceMode) need(start.n >= 0n && span.n > 0n && lead.n >= 0n, 'Unsupported source movie-edit interval.', editCode);
      // Pinned movenc rounds a positive empty-edit delay DOWN and the source
      // presentation span UP to movie ticks. Measured 1/30, 2/30, 4/30 seconds
      // at mvhd=1000 produce spans 34,67,134; 1/30 and 2/30 starts produce
      // delays 33,66. Require those exact integers (no +/- tick tolerance).
      // media_time remains exact in mdhd ticks. The last reordered sample's
      // STTS/CTTS endpoint is not a movie edit endpoint: the saved B-frame proof
      // has a 16/16000 s native tail but an exact 8 s source/movie interval.
      // Complete source/output packet timing identity is checked independently.
      const edts = ts.filter(b => b.type === 'edts');
      need(edts.length <= 1 && (sourceMode || edts.length === 1), 'Only one source-offset edit list is permitted.', editCode);
      const es = edts.length ? await boxes(edts[0].body, edts[0].end, 3) : [];
      need(!edts.length || es.length === 1 && es[0].type === 'elst', 'Only the source-offset edit list is permitted.', editCode);
      const elst = es[0], eh = edts.length ? await read(elst.body, 8) : Buffer.alloc(8), version = eh[0], count = eh.readUInt32BE(4);
      if (edts.length) need([0, 1].includes(version) && eh.subarray(1, 4).every(b => b === 0) && count > 0 && count <= 2
        && elst.end - elst.body === 8 + count * (version ? 20 : 12), 'Only one unity media edit, optionally preceded by one empty start edit, is supported.', editCode);
      const entries = [];
      for (let i = 0; i < (edts.length ? count : 0); i++) {
        const b = await read(elst.body + 8 + i * (version ? 20 : 12), version ? 20 : 12), rateAt = version ? 16 : 8;
        need(b.readInt16BE(rateAt) === 1 && b.readInt16BE(rateAt + 2) === 0, 'Movie edit rates must be exactly 1.0; speed changes and held-frame edits cannot be preserved by Remux.', sourceMode ? 'REMUX_SOURCE_EDIT_UNSUPPORTED' : 'REMUX_EDIT_RATE_UNSUPPORTED');
        entries.push({ duration: version ? b.readBigUInt64BE() : BigInt(b.readUInt32BE()), mediaTime: version ? b.readBigInt64BE(8) : BigInt(b.readInt32BE(4)) });
      }
      let trackEnd;
      if (sourceMode) {
        const blank = entries.length === 2 ? entries[0] : null, media = entries.at(-1), trim = media ? media.mediaTime - minimum : 0n;
        need(!blank || blank.mediaTime === -1n && blank.duration > 0n, 'Only an initial empty edit can precede the media timeline.', editCode);
        need(!media || media.mediaTime >= 0n && trim >= 0n && trim < clock && (kind === 'audio' && stream.codec_name === 'aac' || trim === 0n),
          'An interior or video-head edit cannot be preserved by Remux.', editCode);
        // movenc subtracts the independently rounded leading AAC edit from
        // the rounded decode span. This also covers noncommensurate clocks.
        if (media) need(media.duration === scaled({ n: clock, d: mediaScale }, movieScale, 'up') - scaled({ n: trim, d: mediaScale }, movieScale, 'up'),
          'A shortened or extended source media edit cannot be carried by Remux.', editCode);
        trackEnd = scaled({ n: (clock - trim) * movieScale + (blank?.duration || 0n) * mediaScale, d: mediaScale * movieScale }, movieScale, 'up');
      } else {
        const emptyDuration = scaled(start, movieScale, exact ? 'exact' : 'down'), mediaDuration = scaled(span, movieScale, exact ? 'exact' : 'up'),
          mediaTime = minimum + scaled(lead, mediaScale);
        need(mediaTime >= 0n, 'Native first presented media timestamp is negative.', editCode);
        const wanted = [...(emptyDuration > 0n ? [{ duration: emptyDuration, mediaTime: -1n }] : []), { duration: mediaDuration, mediaTime }];
        need(entries.length === wanted.length && entries.every((e, i) => e.duration === wanted[i].duration && e.mediaTime === wanted[i].mediaTime),
          'Native movie edits differ from the source start offset and full media interval.', editCode);
        // tkhd independently rounds the absolute presentation end UP; adding
        // floor(start) + ceil(span) is wrong (1000003/1001 clock fixtures).
        trackEnd = scaled(end, movieScale, 'up');
      }
      if (!sourceMode) need(duration === trackEnd, 'Native track duration differs from its independently rounded presentation end.', 'REMUX_TRACK_DURATION_UNEXPECTED');
      if (trackEnd > maximumTrackEnd) maximumTrackEnd = trackEnd;
      result.push({ outputIndex, trackId: id, controls, movieScale: String(movieScale), mediaScale: String(mediaScale), trackDuration: String(duration),
        mediaDuration: String(mediaHeaderDuration), entries: entries.map(e => ({ duration: String(e.duration), mediaTime: String(e.mediaTime), rateInteger: 1, rateFraction: 0 })) });
    }
    if (!sourceMode) need(movieDuration === maximumTrackEnd, 'Native movie duration differs from the maximum independently rounded track end.', 'REMUX_MOVIE_DURATION_UNEXPECTED');
    stop(); await assertOrdinaryPath(fileReceipt.path);
    const after = await handle.stat({ bigint: true }), namedAfter = await fs.lstat(fileReceipt.path, { bigint: true });
    need(FIELDS.every(k => before[k] === after[k] && after[k] === namedAfter[k]), 'Native file changed while its edit lists were inspected.');
    return { version: 1, complete: true, outputSha256: fileReceipt.sha256, identity: stamp(after), metadataBytesRead: bytesRead, tracks: result };
  } finally { await handle.close(); }
}
async function observeRemuxSourcePlayback({ file, probe, identity, selectedIndexes = probe.streams.map(s => s.index), maxRecords, signal, timeoutMs, onProgress }) {
  try {
    const stat = await fs.lstat(file, { bigint: true });
    need(identity && file === identity.canonicalPath && FIELDS.filter(k => k !== 'nlink').every(k => String(stat[k]) === identity[k]),
      'The ISO source changed before playback inspection.', 'REMUX_SOURCE_PLAYBACK_UNVERIFIED');
    return await observeRemuxEditLists({ fileReceipt: { path: file, bytes: Number(stat.size), identity: stamp(stat) }, outputProbe: probe,
      intervals: probe.streams.map(s => ({ outputIndex: s.index, selected: selectedIndexes.includes(s.index) })), maxRecords, sourceMode: true, signal, timeoutMs, onProgress });
  } catch (error) {
    if (error.code === 'CANCELLED' || /^REMUX_SOURCE_/.test(error.code || '')) throw error;
    throw new ToolError('REMUX_SOURCE_PLAYBACK_UNVERIFIED', 'The source native playback controls could not be verified: ' + error.message);
  }
}
module.exports = { observeRemuxEditLists, remuxEditInterval, observeRemuxSourcePlayback };
