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
  sourceMode = false, target = 'mp4', timeoutMs = 120000 } = {}) {
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
    const metadataLimit = maxRecords * (sourceMode ? 256 : 32) + 8 * 1024 ** 2;
    need(Number.isSafeInteger(metadataLimit), 'Native metadata accounting overflow.');
    async function read(at, count) {
      stop(); need(Number.isSafeInteger(at) && at >= 0 && Number.isSafeInteger(count) && count >= 0 && count <= 65536
        && at + count <= fileReceipt.bytes && (bytesRead += count) <= metadataLimit, 'Native edit-list read exceeds its byte/position bound.');
      const b = Buffer.alloc(count); for (let n = 0; n < count;) { stop(); const r = await handle.read(b, n, count - n, at + n); need(r.bytesRead > 0, 'Truncated native edit-list metadata.'); n += r.bytesRead; }
      onProgress?.({ completed: bytesRead, total: metadataLimit }); return b;
    }
    async function boxes(start, end, depth) {
      need(depth <= 6, 'Native edit-list nesting exceeds its bound.'); const result = [];
      for (let at = start; at < end;) {
        need(end - at >= 8 && ++atomCount <= (sourceMode ? maxRecords * 8 + 4096 : 4096), 'Native atom boundary/count is invalid.'); const h = await read(at, 8); let n = BigInt(h.readUInt32BE()), header = 8;
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
    const fragmented = sourceMode && (movieBoxes.some(b => b.type === 'mvex') || top.some(b => b.type === 'moof'));
    const initialTiming = new Map();
    const result = [], seen = new Set(); let maximumTrackEnd = 0n;
    for (const trak of traks) {
      const ts = await boxes(trak.body, trak.end, 2), tkhd = one(ts, 'tkhd'), mdia = one(ts, 'mdia');
      const th = await read(tkhd.body, Math.min(96, tkhd.end - tkhd.body)); need([0, 1].includes(th[0]) && th.length >= (th[0] ? 96 : 84), 'Invalid native track header.');
      const id = th.readUInt32BE(th[0] ? 20 : 12), duration = th[0] ? th.readBigUInt64BE(28) : BigInt(th.readUInt32BE(20));
      need(trackIds.has(id) && !seen.has(id), 'Native edit-list track ID is missing, duplicated or foreign.'); seen.add(id);
      const outputIndex = trackIds.get(id), expected = intervals.find(i => i.outputIndex === outputIndex); need(expected, 'Missing source edit interval.');
      // Omitted subtitles/data still need exact native ID coverage, but no
      // copied playback interpretation or sample table is required for them.
      if (sourceMode && expected.selected === false) {
        if (duration > maximumTrackEnd) maximumTrackEnd = duration;
        result.push({ outputIndex, trackId: id, selected: false }); continue;
      }
      const stream = outputProbe.streams.find(s => s.index === outputIndex), kind = stream.codec_type;
      need(['video', 'audio'].includes(kind), 'Native track kind must be known.', controlCode);
      const controlAt = th[0] ? 44 : 32, controls = { flags: th.readUIntBE(1, 3), layer: th.readInt16BE(controlAt),
        alternateGroup: th.readInt16BE(controlAt + 2), volume: th.readUInt16BE(controlAt + 4), matrix: matrix(th, controlAt + 8) };
      const muxerFlags = stream.disposition?.default === 0 ? 2 : 3;
      // ISO non-default alternative tracks use flags=2. They are selectable
      // alternatives, unlike an actually disabled/default track. Other enabled
      // combinations (1/7/15) and native layer/group values are preserved.
      const wanted = expected.sourceControls || { flags: muxerFlags, layer: 0, alternateGroup: kind === 'audio' ? 1 : 0,
        volume: kind === 'audio' ? 256 : 0, matrix: IDENTITY_MATRIX };
      if (sourceMode) {
        need((controls.flags & 1) !== 0 || controls.flags === 2 && stream.disposition?.default === 0,
          `Stream ${outputIndex}: tkhd.flags=${controls.flags} disables this copied track.`, controlCode);
        for (const [key, value] of [['volume', kind === 'audio' ? 256 : 0], ['matrix', IDENTITY_MATRIX]])
          need(equal(controls[key], value), `Stream ${outputIndex}: unsupported tkhd.${key}=${JSON.stringify(controls[key])}.`, controlCode);
        const copied = outputProbe.streams.filter(s => intervals.find(i => i.outputIndex === s.index)?.selected !== false),
          peers = copied.filter(s => s.codec_type === kind), predictedFlags = stream.disposition?.default === 0 && peers.length > 1 ? 2 : 3;
        // There is deliberately no post-mux writable handle. Admit ISO controls
        // only when movenc itself reproduces every admitted native value.
        if (target === 'mp4' || target === 'mov') need(controls.flags === predictedFlags && controls.layer === 0
          ,
          `Stream ${outputIndex}: ${target.toUpperCase()} cannot preserve tkhd.flags=${controls.flags}, layer=${controls.layer}, alternate_group=${controls.alternateGroup} without rewriting playback controls.`,
          'REMUX_SOURCE_CONTROL_UNREPRESENTABLE');
        else if (target === 'matroska') need([2, 3].includes(controls.flags) && controls.layer === 0
          ,
          `Stream ${outputIndex}: Matroska cannot represent tkhd.flags=${controls.flags}, layer=${controls.layer}, alternate_group=${controls.alternateGroup}; only ordinary movie tracks and the common audio alternative group map to default/forced dispositions.`,
          'REMUX_SOURCE_CONTROL_UNREPRESENTABLE');
        else need(false, 'The native playback-control target is unknown.', 'REMUX_SOURCE_CONTROL_UNREPRESENTABLE');
      } else for (const key of Object.keys(wanted).filter(key=>key!=='alternateGroup')) need(equal(controls[key], wanted[key]),
        `Stream ${outputIndex}: tkhd.${key}=${JSON.stringify(controls[key])}; expected ${JSON.stringify(wanted[key])}.`, controlCode);
      const dimensions = { width: th.readUInt32BE(controlAt + 44), height: th.readUInt32BE(controlAt + 48) };
      const sar = /^\d{1,9}:\d{1,9}$/.test(stream.sample_aspect_ratio || '') ? stream.sample_aspect_ratio.split(':').map(BigInt) : [1n, 1n];
      need(kind !== 'video' || Number.isSafeInteger(stream.width) && Number.isSafeInteger(stream.height) && stream.width > 0 && stream.height > 0 && sar[0] > 0n && sar[1] > 0n,
        `Stream ${outputIndex}: picture geometry is unavailable.`, 'REMUX_TRACK_GEOMETRY_UNSUPPORTED');
      const geometry = expected.sourceDimensions || { width: kind === 'video' ? Number(BigInt(stream.width) * sar[0] * 65536n / sar[1]) : 0,
        height: kind === 'video' ? stream.height * 65536 : 0 };
      need(equal(dimensions, geometry), `Stream ${outputIndex}: tkhd width/height ${dimensions.width}/${dimensions.height} differs from admitted display geometry ${geometry.width}/${geometry.height}.`,
        'REMUX_TRACK_GEOMETRY_UNSUPPORTED');
      const apertures = ts.filter(b => b.type === 'tapt');
      need(apertures.length <= 1, 'Duplicate track aperture geometry is not supported.', 'REMUX_TRACK_APERTURE_UNSUPPORTED');
      if (apertures.length) {
        const modes = await boxes(apertures[0].body, apertures[0].end, 3), names = new Set();
        need(modes.length > 0 && modes.length <= 3, 'Track aperture modes could not be verified.', 'REMUX_TRACK_APERTURE_UNSUPPORTED');
        for (const mode of modes) {
          need(['clef', 'prof', 'enof'].includes(mode.type) && !names.has(mode.type) && mode.end - mode.body === 12,
            'Malformed or unknown track aperture geometry is not supported.', 'REMUX_TRACK_APERTURE_UNSUPPORTED'); names.add(mode.type);
          const a = await read(mode.body, 12);
          need(a.readUInt32BE() === 0 && a.readUInt32BE(4) === dimensions.width && a.readUInt32BE(8) === dimensions.height,
            `Stream ${outputIndex}: tapt.${mode.type} differs from the plain tkhd display geometry; aperture-mode preservation is not supported.`,
            'REMUX_TRACK_APERTURE_UNSUPPORTED');
        }
      }
      const ms = await boxes(mdia.body, mdia.end, 3), mdhd = one(ms, 'mdhd'), minf = one(ms, 'minf');
      const h = await read(mdhd.body, Math.min(40, mdhd.end - mdhd.body)); need(h.length >= 24 && [0, 1].includes(h[0]), 'Invalid native media header.');
      const mediaScale = BigInt(h.readUInt32BE(h[0] ? 20 : 12)); need(mediaScale > 0n, 'Native media timescale must be positive.');
      need(h.length >= (h[0] ? 36 : 24), 'Truncated native media duration.');
      const mediaHeaderDuration = h[0] ? h.readBigUInt64BE(24) : BigInt(h.readUInt32BE(16));
      const mediaBoxes = await boxes(minf.body, minf.end, 4), stbl = one(mediaBoxes, 'stbl');
      if (kind === 'audio') { const smhd = one(mediaBoxes, 'smhd'), sound = await read(smhd.body, 8);
        need(smhd.end - smhd.body === 8 && sound.readInt16BE(4) === 0, `Stream ${outputIndex}: smhd.balance must be zero.`, 'REMUX_SOUND_BALANCE_UNSUPPORTED'); }
      const samples = await boxes(stbl.body, stbl.end, 5), sizeTables = samples.filter(b => b.type === 'stsz' || b.type === 'stz2');
      need(sizeTables.length === 1, 'Exactly one stsz or stz2 sample-size table is required.', 'REMUX_SAMPLE_TABLE_UNVERIFIED');
      const sizeTable = sizeTables[0], sizes = await read(sizeTable.body, 12), sampleCount = sizes.readUInt32BE(8), width = sizes[7];
      need(sizes.readUInt32BE() === 0 && sampleCount <= maxRecords && (sampleCount > 0 || fragmented)
        && (sizeTable.type === 'stsz' ? sizeTable.end - sizeTable.body === 12 + (sizes.readUInt32BE(4) ? 0 : sampleCount * 4)
          : sizes.readUIntBE(4, 3) === 0 && [4, 8, 16].includes(width) && sizeTable.end - sizeTable.body === 12 + Math.ceil(sampleCount * width / 8)),
        'Malformed or excessive native sample-size table.', fragmented ? 'REMUX_SOURCE_FRAGMENT_UNVERIFIED' : 'REMUX_SAMPLE_TABLE_UNVERIFIED');
      if (expected.packetCount !== undefined) need(BigInt(expected.packetCount) === BigInt(sampleCount), 'Native sample count differs from complete packet coverage.');
      async function* runs(box, composition = false) {
        const head = await read(box.body, 8), version = head[0], count = head.readUInt32BE(4);
        need((composition ? version === 0 || version === 1 : version === 0) && head.subarray(1, 4).every(b => b === 0)
          && count > 0 && count <= maxRecords && box.end - box.body === 8 + count * 8, 'Invalid native timing run table.', fragmented ? 'REMUX_SOURCE_FRAGMENT_UNVERIFIED' : undefined);
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
      let d, c, clock = 0n, minimum = null, maximum = null;
      try {
        if (!sampleCount) {
          minimum = maximum = 0n;
        } else {
        d = await ds.next(); c = await cs.next();
        while (!d.done && !c.done) {
          const take = d.value.n < c.value.n ? d.value.n : c.value.n, first = clock + c.value.value, end = clock + take * d.value.value + c.value.value;
          if (minimum === null || first < minimum) minimum = first;
          if (maximum === null || end > maximum) maximum = end;
          clock += take * d.value.value; d.value.n -= take; c.value.n -= take;
          if (!d.value.n) d = await ds.next(); if (!c.value.n) c = await cs.next();
        }
        need(d.done && c.done && minimum !== null, 'Incomplete native timing coverage.');
        }
      } finally { await ds.return(); await cs.return(); }
      if (fragmented) initialTiming.set(id, { count: sampleCount, clock, minimum: sampleCount ? minimum : null,
        maximum: sampleCount ? maximum : null, endDts: clock });
      // mdhd is decode duration, the exact sum of every STTS run, including
      // B-frame reordering. It is not the maximum CTTS presentation endpoint.
      need(fragmented && mediaHeaderDuration === 0n || mediaHeaderDuration === clock, 'Native media duration differs from its complete sample timing.', 'REMUX_MEDIA_DURATION_UNEXPECTED');
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
      if (sourceMode && count > 2) need(false,
        'Multiple media edits require exact accounting for demuxer-repeated preroll; this edit layout is not verified.', 'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED');
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
        need(entries.length < 2 || entries[0].mediaTime === -1n,
          'Consecutive media edits require exact accounting for demuxer-repeated preroll; this edit layout is not verified.', 'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED');
        const blank = entries.length === 2 ? entries[0] : null, media = entries.at(-1), trim = media ? media.mediaTime - minimum : 0n;
        need(!blank || blank.mediaTime === -1n && blank.duration > 0n, 'Only an initial empty edit can precede the media timeline.', editCode);
        need(!media || media.mediaTime >= 0n && trim >= 0n && trim < clock && (kind === 'audio' && stream.codec_name === 'aac' || trim === 0n),
          'An interior or video-head edit cannot be preserved by Remux.', editCode);
        // movenc subtracts the independently rounded leading AAC edit from
        // the rounded decode span. This also covers noncommensurate clocks.
        if (media) need(media.duration === scaled({ n: maximum, d: mediaScale }, movieScale, 'up') - scaled({ n: media.mediaTime, d: mediaScale }, movieScale, 'up'),
          'A shortened or extended source media edit cannot be carried by Remux.', editCode);
        const editEnd = entries.reduce((n, e) => n + e.duration, 0n);
        // Source semantics: edits describe track duration; some writers retain
        // independently rounded absolute ends. Both exact declarations are
        // reconciled with native presentation coverage, never a tick tolerance.
        const coverageEnd = scaled({ n: (maximum - (media?.mediaTime || minimum)) * movieScale + (blank?.duration || 0n) * mediaScale,
          d: mediaScale * movieScale }, movieScale, 'up');
        // An empty edit stores floor(original delay), while movenc stores
        // ceil(original absolute end) in tkhd. The original fractional delay
        // is no longer present in moov. Reconcile that writer's declaration
        // by its exact half-open delay interval [empty, empty+1 movie tick),
        // rather than imposing the output writer's layout on an input or
        // adding a numerical tolerance. The media edit itself stays exact.
        const endNumerator = (maximum - (media?.mediaTime || minimum)) * movieScale + (blank?.duration || 0n) * mediaScale;
        const declaredEndFitsQuantisedDelay = blank && duration * mediaScale >= endNumerator
          && (duration - 1n) * mediaScale < endNumerator + mediaScale;
        need(fragmented && duration === 0n || duration === (entries.length ? editEnd : coverageEnd) || duration === coverageEnd || declaredEndFitsQuantisedDelay,
          `Stream ${outputIndex}: source tkhd.duration=${duration} contradicts its edits/presentation coverage.`, 'REMUX_SOURCE_DURATION_UNVERIFIED');
        trackEnd = duration;
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
      result.push({ outputIndex, trackId: id, controls, dimensions, movieScale: String(movieScale), mediaScale: String(mediaScale), trackDuration: String(duration),
        mediaDuration: String(mediaHeaderDuration), entries: entries.map(e => ({ duration: String(e.duration), mediaTime: String(e.mediaTime), rateInteger: 1, rateFraction: 0 })) });
    }
    if (fragmented) {
      // moov duration/edit headers describe only the initial flat segment.
      // Fragments extend it implicitly. Check that header against its own flat
      // samples above, then reconcile the complete timeline without pretending
      // the initial edit clips the subsequent fragments.
      const coverage = await require('./remux-fragments.cjs').fragmentCoverage({ top, movieBoxes, boxes, read, maxRecords,
        initial: initialTiming, trackIds: new Set(trackIds.keys()) });
      for (const r of result.filter(r => r.selected !== false)) {
        const f = coverage.get(r.trackId); need(f?.count > 0, 'Fragment timing/sample coverage is unavailable.', 'REMUX_SOURCE_FRAGMENT_UNVERIFIED');
        r.fragmentCoverage = { samples: String(f.count), decodeDuration: String(f.clock), firstPts: String(f.minimum), endPts: String(f.maximum) };
      }
    }
    need(sourceMode && fragmented && movieDuration === 0n || movieDuration === maximumTrackEnd,
      'Native movie duration differs from its track durations.', sourceMode ? 'REMUX_SOURCE_DURATION_UNVERIFIED' : 'REMUX_MOVIE_DURATION_UNEXPECTED');
    stop(); await assertOrdinaryPath(fileReceipt.path);
    const after = await handle.stat({ bigint: true }), namedAfter = await fs.lstat(fileReceipt.path, { bigint: true });
    need(FIELDS.every(k => before[k] === after[k] && after[k] === namedAfter[k]), 'Native file changed while its edit lists were inspected.');
    const receipt = { version: 1, complete: true, outputSha256: fileReceipt.sha256, identity: stamp(after), metadataBytesRead: bytesRead, tracks: result };
    return receipt;
  } finally { await handle.close(); }
}
async function observeRemuxSourcePlayback({ file, probe, identity, selectedIndexes = probe.streams.map(s => s.index), target = 'mp4', maxRecords, signal, timeoutMs, onProgress }) {
  try {
    const stat = await fs.lstat(file, { bigint: true });
    need(identity && file === identity.canonicalPath && FIELDS.filter(k => k !== 'nlink').every(k => String(stat[k]) === identity[k]),
      'The ISO source changed before playback inspection.', 'REMUX_SOURCE_PLAYBACK_UNVERIFIED');
    return await observeRemuxEditLists({ fileReceipt: { path: file, bytes: Number(stat.size), identity: stamp(stat) }, outputProbe: probe,
      intervals: probe.streams.map(s => ({ outputIndex: s.index, selected: selectedIndexes.includes(s.index) })), maxRecords, sourceMode: true, target, signal, timeoutMs, onProgress });
  } catch (error) {
    if (error.code === 'CANCELLED' || /^REMUX_SOURCE_/.test(error.code || '') || ['REMUX_TRACK_GEOMETRY_UNSUPPORTED','REMUX_TRACK_APERTURE_UNSUPPORTED','REMUX_SOUND_BALANCE_UNSUPPORTED','REMUX_SAMPLE_TABLE_UNVERIFIED'].includes(error.code)) throw error;
    throw new ToolError('REMUX_SOURCE_PLAYBACK_UNVERIFIED', 'The source native playback controls could not be verified: ' + error.message);
  }
}
module.exports = { observeRemuxEditLists, remuxEditInterval, observeRemuxSourcePlayback };
