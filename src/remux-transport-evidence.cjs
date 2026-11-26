'use strict';
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { transportNals, dumpBytes, canonicalTransportVideo, canonicalTransportAudio, transportClock, createTransportIntegrity } = require('./remux-transport.cjs');
const prepared = new WeakMap();
const BINARY_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_BINARY_PACKET_BYTES = 8 * 1024 * 1024;
const BINARY_PROJECTION = 'REMUX_TS_BINARY_PROJECTION';
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
function binaryPacketSink(rows, consume, signal) {
  let ordinal = 0, filled = 0, buffer = null;
  function start() {
    const record = rows[ordinal];
    const size = Number(record?.size);
    need(Number.isSafeInteger(size) && size > 0 && size <= MAX_BINARY_PACKET_BYTES
      && /^SHA256:[a-f0-9]{64}$/i.test(record?.data_hash || ''),
    BINARY_PROJECTION, 'Source packet metadata cannot bind a bounded binary packet.');
    return Buffer.alloc(size);
  }
  return {
    async push(chunk) {
      for (let offset = 0; offset < chunk.length;) {
        need(!signal?.aborted, 'CANCELLED', 'Transport packet read cancelled.');
        buffer ||= start();
        const bytes = Math.min(buffer.length - filled, chunk.length - offset);
        chunk.copy(buffer, filled, offset, offset + bytes);
        filled += bytes;
        offset += bytes;
        if (filled === buffer.length) {
          const record = rows[ordinal++];
          need('sha256:' + sha(buffer) === record.data_hash.toLowerCase(),
            BINARY_PROJECTION, 'The binary source packet differs from the independently probed packet hash.');
          await consume(record, buffer);
          buffer = null;
          filled = 0;
        }
      }
    },
    finish() {
      need(!buffer && ordinal === rows.length, BINARY_PROJECTION, 'The binary source stream did not cover the complete packet metadata.');
    },
  };
}

async function scanTransportPackets({ file, probe, source = true, sourceAdmission = null, invoke, budget, signal,
  readOutputPacket = null, readSourceStream = null }) {
  need((!readOutputPacket || !source) && (!readSourceStream || source), 'REMUX_TS_PACKET_BYTES', 'Payload reader differs from its transport side.');
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
  async function onRecord(packet, payload = null) {
      need(!signal?.aborted, 'CANCELLED', 'Transport verification cancelled.');
      const entry = entries.get(packet.stream_index);
      need(entry && packet.codec_type === entry.stream.codec_type, 'REMUX_PACKET_STREAM', 'Transport packet names an unexpected stream.');
      const raw = payload || (readOutputPacket ? await readOutputPacket(packet, entry.received) : dumpBytes(packet.data, packet.size));
      payloadBytes += raw.length;
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
      if (source && video) {
        // TS has no coded packet-duration field. FFprobe's nominal frame-rate
        // guess is not the transport interval for VFR: consecutive native DTS
        // delimit that interval exactly. Only the final packet uses its
        // positive demuxer duration, as there is no following decode clock.
        if (entry.pending) {
          entry.pending.packet.duration = String(BigInt(p.dts) - BigInt(entry.pending.packet.dts)); delete entry.pending.packet.duration_time;
          commit(entry, entry.pending.packet, entry.pending.nalUnitsSha256);
        }
        entry.pending = { packet: p, nalUnitsSha256 };
      } else commit(entry, p, nalUnitsSha256);
  }
  function onAuxRecord(header) {
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
  }
  const maximum = budget.maxOutputBytes * 6 + budget.maxTextBytes;
  need(Number.isSafeInteger(maximum) && maximum > 0 && Number.isSafeInteger(budget.maxOutputBytes * 4),
    'REMUX_PROPORTIONAL_BUDGET', 'Transport byte accounting exceeds exact integer bounds.');
  const prefix = ['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-format_whitelist', source ? 'mpegts' : 'mov'];
  if (readOutputPacket || readSourceStream) {
    const side = source ? 'source' : 'output';
    const headerRecordSink = createRemuxJsonSink('streams', { maxRecords: 32, maxRecordBytes: 512 * 1024, onRecord: onAuxRecord });
    const packetMetadataArgs = [...prefix, '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', '-i', file];
    const getHeaders = () => invoke([...prefix, '-show_streams', '-show_data', '-of', 'json', '-i', file],
      2 * 1024 * 1024, headerRecordSink, side + '-stream-headers');
    if (readSourceStream) {
      const packets = new Map(media.streams.map(stream => [stream.index, []]));
      let metadataBytes = 0;
      const packetSink = createRemuxJsonSink('packets', { maxRecords: budget.maxRecords, maxRecordBytes: 65536, onRecord(packet) {
        const rows = packets.get(packet.stream_index);
        need(rows, 'REMUX_PACKET_STREAM', 'Transport packet metadata names an unexpected stream.');
        metadataBytes += Buffer.byteLength(JSON.stringify(packet));
        need(metadataBytes <= BINARY_METADATA_BYTES, BINARY_PROJECTION, 'Source packet metadata exceeds the binary lane memory allowance.');
        rows.push(packet);
      } });
      await invoke(packetMetadataArgs, budget.maxTextBytes, packetSink, 'source-packet-metadata');
      // Video initialization must be observed before any stream header is checked.
      for (const stream of [...media.streams].sort((a, b) => Number(b.codec_type === 'video') - Number(a.codec_type === 'video'))) {
        const rows = packets.get(stream.index);
        need(rows.length > 0, 'REMUX_PACKET_COUNT', 'The transport stream has no packets.');
        await readSourceStream(stream.index, binaryPacketSink(rows, onRecord, signal));
      }
      await getHeaders();
    } else {
      await getHeaders();
      const packetSink = createRemuxJsonSink('packets', { maxRecords: budget.maxRecords, maxRecordBytes: 65536, onRecord });
      await invoke(packetMetadataArgs, budget.maxTextBytes, packetSink, 'output-packet-metadata');
    }
  } else {
    const sink = createRemuxJsonSink('packets', { maxRecords: budget.maxRecords, maxRecordBytes: 50 * 1024 * 1024, onRecord, onAuxRecord });
    await invoke([...prefix, '-show_packets', '-show_data', '-show_streams', '-of', 'json', '-i', file], maximum, sink);
  }
  need(headers === entries.size && admitted && headerSink, 'REMUX_CODEC_PARAMETERS', 'Incomplete transport codec header coverage.');
  const videoAdmission = await headerSink.finish();
  for (const entry of entries.values()) {
    if (entry.pending) { commit(entry, entry.pending.packet, entry.pending.nalUnitsSha256); delete entry.pending; }
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
async function prepareTransport({ file, probe, identity, ffprobe, ffmpeg = null, run, budget, signal }) {
  const before = await fs.lstat(file, { bigint: true });
  const fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && fields.every(key => String(before[key]) === identity[key]),
    'REMUX_TS_SOURCE_CHANGED', 'TS source identity is unavailable or changed.');
  const expectedStamp = JSON.stringify(stamp(before));
  const requireUnchanged = async () => need(expectedStamp === JSON.stringify(stamp(await fs.lstat(file, { bigint: true }))),
    'REMUX_TS_SOURCE_CHANGED', 'TS source changed between preparation reads.');
  const binarySource = ffmpeg && budget.maxRecords <= 20000;
  const deadline = binarySource ? performance.now() + budget.timeoutMs : Infinity;
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
    const runOwned = async (binary, args, maximum, sink) => {
      let bytes = 0, projectionFailure = null, r;
      await requireUnchanged();
      const remainingMs = Math.min(budget.timeoutMs, Math.floor(deadline - performance.now()));
      need(remainingMs > 0, 'TIMEOUT', 'TS preparation exhausted its complete source-observation deadline.');
      try { r = await run(binary, args, { signal: controller.signal, timeoutMs: remainingMs, stdoutLimit: maximum, stderrLimit: 256 * 1024,
        onStdoutChunk: async chunk => {
          bytes += chunk.length;
          touched = Date.now();
          need(bytes <= maximum, 'REMUX_PROPORTIONAL_BUDGET', 'TS preparation exceeded its proportional budget.');
          if (projectionFailure) return;
          try { await sink.push(chunk); }
          catch (error) { if (error.code !== BINARY_PROJECTION) throw error; projectionFailure = error; }
        } }); }
      catch (error) { if (error.code === 'STDOUT_SINK_FAILED' && error.cause) throw error.cause; throw error; }
      need(r.exitCode === 0 && r.stderr === '' && r.stderrCapture?.truncated === false && r.stdoutCapture?.streamed === true
        && r.stdoutCapture.truncated === false && r.stdoutCapture.totalBytes === bytes, 'REMUX_TS_DEMUX', 'TS demuxing reported damaged or incomplete packets.');
      await requireUnchanged();
      need(!controller.signal.aborted, 'CANCELLED', 'TS preparation cancelled.');
      if (projectionFailure) throw projectionFailure;
      await sink.finish();
      return bytes;
    };
    const observation = { file, probe, budget, signal: controller.signal,
      invoke: (args, maximum, sink) => runOwned(ffprobe, args, maximum, sink) };
    let result, sourceAcquisition = { method: 'demux-packet-dump' };
    // Continue streaming the existing packet dump for longer sources. The
    // binary variant's retained metadata has a stricter independent RAM bound.
    if (binarySource) {
      const streams = [];
      try {
        result = await scanTransportPackets({ ...observation, async readSourceStream(index, sink) {
          const bytes = await runOwned(ffmpeg, ['-hide_banner', '-nostdin', '-xerror', '-v', 'warning',
            '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mpegts', '-i', file,
            '-map', '0:' + index, '-c', 'copy', '-f', 'data', 'pipe:1'], budget.maxOutputBytes, sink);
          streams.push({ index, bytes });
        } });
        sourceAcquisition = { method: 'packet-hash-and-binary-demux', streams };
      } catch (error) {
        if (error.code !== BINARY_PROJECTION || controller.signal.aborted) throw error;
        sourceAcquisition.fallback = { code: error.code, reason: error.message };
      }
    }
    result ||= await scanTransportPackets(observation);
    need(JSON.stringify(stamp(before)) === JSON.stringify(stamp(await fs.lstat(file, { bigint: true }))), 'REMUX_TS_SOURCE_CHANGED', 'TS changed during preparation.');
    const token = Object.freeze({ kind: 'main-owned-ts-packet-preparation-v1' });
    prepared.set(token, { ...result, sourceAcquisition, file, probeHash: sha(JSON.stringify(normalizeProbe(probe))), stamp: stamp(before) }); return token;
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
