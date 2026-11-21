'use strict';
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { transportNals, dumpBytes, canonicalTransportVideo, canonicalTransportAudio, transportClock, createTransportIntegrity } = require('./remux-transport.cjs');
const prepared = new WeakMap();
const sha = data => createHash('sha256').update(data).digest('hex');
const need = (ok, code, message) => { if (!ok) throw new ToolError(code, message); };
const stamp = s => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(k => [k, String(s[k])]));
function initialization(nals, stream) {
  const { parseRemuxAvcc } = require('./remux-evidence.cjs');
  const sps = nals.filter(n => (n[0] & 31) === 7), pps = nals.filter(n => (n[0] & 31) === 8);
  need(sps.length === 1 && pps.length === 1 && sps[0].length >= 4 && sps[0].length <= 65535 && pps[0].length <= 65535,
    'REMUX_TS_INITIALIZATION', 'The first TS key packet needs one complete SPS and PPS.');
  const length = b => { const v = Buffer.alloc(2); v.writeUInt16BE(b.length); return v; };
  const data = Buffer.concat([Buffer.from([1, sps[0][1], sps[0][2], sps[0][3], 255, 225]), length(sps[0]), sps[0], Buffer.from([1]), length(pps[0]), pps[0]]);
  const parsed = parseRemuxAvcc(data, stream);
  parsed.configurationSha256 = sha(Buffer.concat([...parsed.sps.values(), ...parsed.pps.values()])); return parsed;
}
function sameParameters(a, b) {
  return ['sps', 'pps'].every(k => a[k].size === b[k].size && [...a[k].keys()].every(h => b[k].has(h)));
}
function codecParameters(stream, admitted, asc) {
  const { remuxCodecParameters } = require('./remux-evidence.cjs');
  const v = { ...stream, codec_tag_string: stream.codec_type === 'video' ? 'avc1' : 'mp4a' };
  const data = stream.codec_type === 'video' ? Buffer.concat([...admitted.sps.values(), ...admitted.pps.values()]) : asc;
  v.extradata_size = data.length; v.extradata_hash = 'SHA256:' + sha(data);
  if (!Number(v.initial_padding || 0)) delete v.initial_padding;
  if (!Number(v.trailing_padding || 0)) delete v.trailing_padding;
  return sha(JSON.stringify(remuxCodecParameters(v)));
}
async function scanTransportPackets({ file, probe, source = true, sourceAdmission = null, invoke, budget, signal, nativeOutput = null }) {
  const { createRemuxJsonSink, createRemuxHeaderSink, createRemuxPacketAccumulator, parseRemuxAvcc, parseRemuxAsc } = require('./remux-evidence.cjs');
  const media = normalizeProbe(probe), entries = new Map(); let admitted = sourceAdmission, headers = 0, payloadBytes = 0;
  for (const stream of media.streams) {
    const asc = stream.codec_type === 'audio' ? Buffer.from([17, stream.channels === 1 ? 136 : 144]) : null;
    entries.set(stream.index, { stream, asc, count: 0, received: 0, content: createHash('sha256'), transcript: createHash('sha256'),
      clock: source ? transportClock(stream) : null, accumulator: createRemuxPacketAccumulator(stream, {
        maxRecords: budget.maxRecords, maxSourceBytes: budget.maxOutputBytes, maxDurationSeconds: budget.maxDurationSeconds,
        family: source ? 'mpegts' : 'isobmff' }) });
  }
  const commit = (entry, packet, nalUnitsSha256 = null) => {
    const row = entry.accumulator.push(packet);
    if (nalUnitsSha256) row.nalUnitsSha256 = nalUnitsSha256;
    entry.transcript.update(JSON.stringify(row) + '\n'); entry.content.update(row.size + ':' + row.hash + '\n'); entry.count++;
  };
  let headerSink = null;
  const sink = createRemuxJsonSink('packets', { maxRecords: budget.maxRecords, maxRecordBytes: 50 * 1024 * 1024,
    async onRecord(packet) {
      need(!signal?.aborted, 'CANCELLED', 'Transport verification cancelled.');
      const entry = entries.get(packet.stream_index);
      need(entry && packet.codec_type === entry.stream.codec_type, 'REMUX_PACKET_STREAM', 'Transport packet names an unexpected stream.');
      const raw = dumpBytes(packet.data, packet.size); payloadBytes += raw.length;
      need(Number.isSafeInteger(payloadBytes) && payloadBytes <= budget.maxOutputBytes, 'REMUX_PROPORTIONAL_BUDGET', 'Transport payload exceeds its proportional byte budget.');
      entry.clock?.(packet);
      const first = entry.received++ === 0, video = packet.codec_type === 'video';
      need(!source || !video || !first || packet.flags === 'K__', 'REMUX_TS_HEAD_NOT_KEYFRAME', 'The TS begins before a complete IDR keyframe.');
      if (video && !admitted) admitted = initialization(transportNals(raw), entry.stream);
      if (video && !headerSink) headerSink = createRemuxHeaderSink(admitted, entry.stream,
        { maxBytes: budget.maxOutputBytes * 4, maxUnits: budget.maxRecords * 1024 + 256 }, 'avcc');
      const canonical = video ? canonicalTransportVideo(raw, source ? 'annexb' : 'avcc', admitted, first)
        : canonicalTransportAudio(raw, source ? 'adts' : 'raw', entry.asc, entry.stream);
      // Bind the exact ordered type/size/SHA256 NAL list in each packet row,
      // as well as the SHA256 of the complete canonical packet bytes.
      const nalUnitsSha256 = video ? sha(JSON.stringify(canonical.units)) : null;
      if (video) { await headerSink.push(canonical.data); headerSink.endPacket(); }
      const p = { ...packet, size: String(canonical.data.length), data_hash: 'SHA256:' + canonical.sha256 }; delete p.data;
      if (source && Object.hasOwn(p, 'side_data_list')) {
        need(Array.isArray(p.side_data_list) && p.side_data_list.length <= 16
          && p.side_data_list.every(d => d && typeof d === 'object' && !Array.isArray(d)),
        'REMUX_TS_PACKET_SIDE_DATA', 'Malformed or excessive TS packet side metadata cannot be discarded.');
        for (const d of p.side_data_list) need(d.side_data_type === 'MPEGTS Stream ID' && Object.keys(d).every(k => ['side_data_type', 'id'].includes(k))
          && Number.isSafeInteger(d.id) && d.id >= 0 && d.id <= 255, 'REMUX_TS_PACKET_SIDE_DATA', 'Unknown TS packet side metadata cannot be discarded.');
        delete p.side_data_list; // Transport-only PES stream ID has no MP4 track meaning.
      }
      need(!video || !first || p.flags === 'K__', 'REMUX_TS_HEAD_NOT_KEYFRAME', 'The TS does not begin with a complete keyframe.');
      if (video && p.flags?.[0] === 'K') {
        const clip = Buffer.concat([...admitted.sps.values(), ...admitted.pps.values(), ...transportNals(canonical.data, 'avcc')]
          .flatMap(n => [Buffer.from([0, 0, 0, 1]), n]));
        entry.firstClip ||= clip; entry.lastClip = clip;
      }
      if (video) {
        // TS has no coded packet-duration field. FFprobe's nominal frame-rate
        // guess is not the transport interval for VFR: consecutive native DTS
        // delimit that interval exactly. Only the final packet uses its
        // positive demuxer duration, as there is no following decode clock.
        // The MP4 side uses the same decode-order form: in non-fragmented MP4
        // each DTS step is exactly its stts delta, while FFmpeg 9.1 reports
        // reordered VFR durations in presentation order. Its final packet
        // takes the native sample-table duration below, never FFprobe's.
        need(source || /^(0|-?[1-9][0-9]{0,18})$/.test(String(p.dts)), 'REMUX_PACKET_DTS', 'MP4 video packet DTS is not an exact native tick.');
        if (entry.pending) {
          const step = BigInt(p.dts) - BigInt(entry.pending.packet.dts);
          need(source || step > 0n, 'REMUX_TS_PACKET_IDENTITY', 'MP4 video decode clocks do not advance.');
          entry.pending.packet.duration = String(step); delete entry.pending.packet.duration_time;
          commit(entry, entry.pending.packet, entry.pending.nalUnitsSha256);
        }
        entry.pending = { packet: p, nalUnitsSha256 };
      } else commit(entry, p, nalUnitsSha256);
    }, onAuxRecord(header) {
      const entry = entries.get(header.index); need(entry && !entry.header, 'REMUX_CODEC_PARAMETERS', 'Duplicate or foreign TS codec header.');
      entry.header = header; headers++;
      if (header.codec_type === 'video') {
        const data = dumpBytes(header.extradata, header.extradata_size);
        const parsed = source ? initialization(transportNals(data), entry.stream) : parseRemuxAvcc(data, entry.stream);
        need(admitted && sameParameters(admitted, parsed), 'REMUX_TS_PARAMETER_CHANGE', 'SPS/PPS differs from the stream/sample description.');
      } else if (!source) {
        const data = dumpBytes(header.extradata, header.extradata_size); parseRemuxAsc(data, entry.stream);
        need(data.equals(entry.asc), 'REMUX_TS_ADTS_CONFIG', 'MP4 AudioSpecificConfig differs from every admitted ADTS frame.');
      }
      const observed = normalizeProbe({ ...media, streams: media.streams.map(s => s.index === header.index ? header : s) }).streams.find(s => s.index === header.index);
      need(header.codec_type === entry.stream.codec_type && header.codec_name === entry.stream.codec_name
        && codecParameters(observed, admitted, entry.asc) === codecParameters(entry.stream, admitted, entry.asc),
      'REMUX_CODEC_PARAMETERS', 'Transport codec parameters changed from the inspected source/output.');
    } });
  const maximum = budget.maxOutputBytes * 6 + budget.maxTextBytes;
  need(Number.isSafeInteger(maximum) && maximum > 0 && Number.isSafeInteger(budget.maxOutputBytes * 4),
    'REMUX_PROPORTIONAL_BUDGET', 'Transport byte accounting exceeds exact integer bounds.');
  await invoke(['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-format_whitelist', source ? 'mpegts' : 'mov',
    '-show_packets', '-show_data', '-show_streams', '-of', 'json', '-i', file], maximum, sink);
  need(headers === entries.size && admitted && headerSink, 'REMUX_CODEC_PARAMETERS', 'Incomplete transport codec header coverage.');
  const videoAdmission = await headerSink.finish();
  for (const entry of entries.values()) {
    if (entry.pending) {
      if (!source) {
        // Only the collector's own native ISO sample-table reading of this
        // stamped output names the final sample clock; fragments add samples
        // outside that table, so they have no admitted final duration here.
        const native = nativeOutput?.family === 'isobmff' ? nativeOutput.randomAccess?.streams?.filter(s => s?.index === entry.stream.index) : null;
        need(Array.isArray(native) && native.length === 1, 'REMUX_TS_PACKET_IDENTITY', 'The MP4 final native video sample duration is unavailable.');
        need(native[0].fragmented === false, 'REMUX_TS_PACKET_IDENTITY', 'Fragmented MP4 video has no admitted final native sample duration.');
        need(typeof native[0].finalDuration === 'string' && /^[1-9][0-9]{0,9}$/.test(native[0].finalDuration), 'REMUX_TS_PACKET_IDENTITY',
          'The MP4 final native video sample duration is unavailable.');
        entry.pending.packet.duration = native[0].finalDuration; delete entry.pending.packet.duration_time;
      }
      commit(entry, entry.pending.packet, entry.pending.nalUnitsSha256); delete entry.pending;
    }
    Object.assign(entry, entry.accumulator.finish());
    const parameters = codecParameters(entry.stream, admitted, entry.asc);
    entry.record = { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'packet-identity-v1',
      contentSha256: entry.content.digest('hex'), decoderParametersSha256: parameters,
      metadataSha256: entry.transcript.digest('hex'), unitCount: String(entry.count), firstPts: entry.firstPts, endPts: entry.endPts,
      ...(entry.cadence ? { cadence: entry.cadence } : {}), admission: entry.stream.codec_type === 'video'
        ? { ...videoAdmission, configurationSha256: admitted.configurationSha256 }
        : { version: 1, complete: true, kind: 'aac-lc-adts-payload-v1', configurationSha256: sha(entry.asc), frames: entry.count } };
    delete entry.accumulator; delete entry.content; delete entry.transcript; delete entry.clock;
  }
  return { entries, admitted };
}
async function prepareTransport({ file, probe, identity, ffprobe, run, budget, signal }) {
  const before = await fs.lstat(file, { bigint: true });
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && String(before.size) === identity.size,
    'REMUX_TS_SOURCE_CHANGED', 'TS source identity is unavailable or changed.');
  const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort(); let touched = Date.now(), stalled = false;
  const timer = setInterval(() => { if (Date.now() - touched > 120000) { stalled = true; controller.abort(); } }, 1000); timer.unref();
  try {
    // Read only fixed-size TS headers; no payload is retained or decoded here.
    // The single demuxed packet traversal below supplies all essence identity.
    const integrity = createTransportIntegrity(probe.streams, probe.programs), handle = await fs.open(file, 'r'), buffer = Buffer.alloc(188 * 1024);
    try {
      need(JSON.stringify(stamp(before)) === JSON.stringify(stamp(await handle.stat({ bigint: true }))), 'REMUX_TS_SOURCE_CHANGED', 'TS source handle changed.');
      for (let at = 0; at < Number(before.size);) {
        need(!controller.signal.aborted, 'CANCELLED', 'TS preparation cancelled.');
        const r = await handle.read(buffer, 0, buffer.length, at); need(r.bytesRead > 0, 'REMUX_TS_FRAMING', 'TS source was truncated.');
        integrity.push(buffer.subarray(0, r.bytesRead)); at += r.bytesRead; touched = Date.now();
      }
      integrity.finish();
    } finally { await handle.close(); }
    const result = await scanTransportPackets({ file, probe, budget, signal: controller.signal, invoke: async (args, maximum, sink) => {
      let bytes = 0;
      let r;
      try { r = await run(ffprobe, args, { signal: controller.signal, timeoutMs: budget.timeoutMs, stdoutLimit: maximum, stderrLimit: 256 * 1024,
        onStdoutChunk: async chunk => { bytes += chunk.length; touched = Date.now(); need(bytes <= maximum, 'REMUX_PROPORTIONAL_BUDGET', 'TS preparation exceeded its proportional budget.'); await sink.push(chunk); } }); }
      catch (error) { if (error.code === 'STDOUT_SINK_FAILED' && error.cause) throw error.cause; throw error; }
      need(r.exitCode === 0 && r.stderr === '' && r.stderrCapture?.truncated === false && r.stdoutCapture?.streamed === true
        && r.stdoutCapture.truncated === false && r.stdoutCapture.totalBytes === bytes, 'REMUX_TS_DEMUX', 'TS demuxing reported damaged or incomplete packets.');
      await sink.finish();
    } });
    need(JSON.stringify(stamp(before)) === JSON.stringify(stamp(await fs.lstat(file, { bigint: true }))), 'REMUX_TS_SOURCE_CHANGED', 'TS changed during preparation.');
    const token = Object.freeze({ kind: 'main-owned-ts-packet-preparation-v1' });
    prepared.set(token, { ...result, file, probeHash: sha(JSON.stringify(normalizeProbe(probe))), stamp: stamp(before) }); return token;
  } catch (error) {
    if (stalled && !signal?.aborted) throw new ToolError('REMUX_TS_STALLED', 'TS preparation stopped making progress for two minutes; no output was created.', { cause: error });
    throw error;
  } finally { clearInterval(timer); signal?.removeEventListener('abort', abort); }
}
function getTransportPreparation(token, file, probe, observedStamp) {
  const state = prepared.get(token);
  need(state && state.file === file && state.probeHash === sha(JSON.stringify(normalizeProbe(probe)))
    && JSON.stringify(state.stamp) === JSON.stringify(observedStamp), 'REMUX_TS_PREPARATION_REQUIRED', 'Current main-owned complete TS packet preparation is required.'); return state;
}
module.exports = { prepareTransport, getTransportPreparation, scanTransportPackets, initialization };
