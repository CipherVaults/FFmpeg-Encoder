'use strict';
// Shared synthetic fixtures for native-file template/oracle tests: a genuine
// command from the real builder, a minimal RFC 8794/9559 EBML writer and
// ffprobe-shaped metadata. No FFmpeg, device or media file is involved.
const { describeNativeFileSource, buildNativeFileContract } = require('../../src/native-file-contract.cjs');
const { buildNativeFileCommand } = require('../../src/native-file-command.cjs');
const { nativeEncoderContribution } = require('../../src/backend-adapters.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../../src/provenance.cjs');

const DEVICE = '33333333-3333-4333-8333-333333333333', FRAMES = 30;
function nativeCommand(outputId = '44444444-4444-4444-8444-444444444444', createdAt = '2026-10-26T12:00:00.000Z', appVersion = '0.7.0-alpha.1', output = 'F:\\owned\\candidate.mkv') {
  const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: '11111111-1111-4111-8111-111111111111', identityRevision: 0,
    draftId: '22222222-2222-4222-8222-222222222222', draftRevision: 0, profileId: 'h264-qsv',
    settings: { preset: 'medium', mode: 'icq', quality: 25, deviceId: DEVICE }, bitDepth: 8, target: 'matroska',
    resolution: 'source', range: null, signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] };
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360', start_pts: 0, start_time: '0.000000', duration_ts: 15360, duration: '1.000000', nb_frames: String(FRAMES), disposition: { default: 1 }, tags: {} }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: '4096', start_time: '0.000000', duration: '1.000000', tags: {} }, chapters: [], programs: [], stream_groups: [] };
  const applicability = describeNativeFileSource({ probe, sourceBytes: '4096', request }), contract = buildNativeFileContract({ request, applicability });
  const fragment = nativeEncoderContribution('h264-qsv', { preset: 'medium', mode: 'icq', quality: 25 }, { bitDepth: 8 });
  const generationDescription = { version: 2, kind: 'native-encoder', adapterPolicyVersion: 1, profileId: 'h264-qsv', codec: 'H264', backend: 'qsv',
    encoder: 'h264_qsv', preset: 'medium', qualityMode: 'ICQ', quality: structuredClone(fragment.settings.quality), bitDepth: 8,
    pipelineId: fragment.pipelineId, encoderArgs: [...fragment.args], settingsRole: 'requested', scope: 'native-encoder-contribution-only', appVersion, createdAt };
  const device = { id: DEVICE, backend: 'qsv', vendorId: '0x8086', adapterIndex: 0, adapterIdentity: 'adapter-0', driverVersion: 'driver-1', runtimeVersion: 'runtime-1' };
  const command = buildNativeFileCommand({ contract, input: 'D:\\sources\\native source.mp4', output, device, outputId, generationDescription });
  return { contract, command };
}

// ---- Minimal EBML writer ------------------------------------------------------------
const table = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const x of bytes) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function size(n, width) {
  const w = width || (n < 0x7f ? 1 : n < 0x3fff ? 2 : n < 0x1fffff ? 3 : 4);
  const out = Buffer.alloc(w); let v = BigInt(n);
  for (let i = w - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  out[0] |= 1 << (8 - w); return out;
}
const UNKNOWN8 = Buffer.from('01ffffffffffffff', 'hex');
const uint = n => { const out = []; let v = BigInt(n); do { out.unshift(Number(v & 0xffn)); v >>= 8n; } while (v); return Buffer.from(out); };
const el = (id, data, opts = {}) => { data = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'); return Buffer.concat([Buffer.from(id, 'hex'), opts.unknown ? UNKNOWN8 : size(data.length, opts.width), data]); };
const DURATION = Buffer.from('4489' + '84' + '447a0000', 'hex');
const crcOf = parts => { const v = Buffer.alloc(4); v.writeUInt32LE(crc32(Buffer.concat(parts))); return el('bf', v); };
const master = (id, parts, { crc = true, ...opts } = {}) => el(id, Buffer.concat(crc ? [crcOf(parts), ...parts] : parts), opts);
const simple = (name, value, extra = []) => master('67c8', [el('45a3', name), el('4487', value), ...extra], { crc: false });

function matroska(cmd, overrides = {}) {
  const o = { docType: 'matroska', segmentUnknown: false, trackUid: 1, tracks: 1, frame: Buffer.from('opaque-coded-frame-bytes-0123456789'),
    reserved: null, extraTags: [], infoExtra: [], targets: [], clusterExtra: [], trailing: Buffer.alloc(0), duration: true, segmentWidth: undefined,
    trackUidBytes: null, headerExtra: [], entryExtra: [], ...overrides };
  const header = master('1a45dfa3', [el('4286', uint(1)), el('42f7', uint(1)), el('42f2', uint(4)), el('42f3', uint(8)), el('4282', o.docType), el('4287', uint(4)), el('4285', uint(2)), ...o.headerExtra], { crc: false });
  const info = master('1549a966', [el('2ad7b1', uint(1000000)), el('4d80', 'Lavf'), el('5741', 'Lavf'), ...(o.duration ? [DURATION] : []), ...o.infoExtra]);
  const entry = n => master('ae', [el('d7', uint(n)), el('73c5', n === 1 && o.trackUidBytes ? o.trackUidBytes : uint(n === 1 ? o.trackUid : n)), el('83', uint(1)), el('86', 'V_MPEG4/ISO/AVC'), ...o.entryExtra], { crc: false });
  const tracks = master('1654ae6b', Array.from({ length: o.tracks }, (_, i) => entry(i + 1)));
  const reserved = o.reserved || [simple(MARKER_KEY, '1'), simple(OUTPUT_ID_KEY, cmd.outputId), simple(GENERATION_KEY, JSON.stringify(cmd.generationDescription))];
  const tags = master('1254c367', [master('7373', [master('63c0', o.targets, { crc: false }), ...reserved], { crc: false }),
    master('7373', [master('63c0', [], { crc: false }), simple('ENCODER', 'Lavf')], { crc: false }), ...o.extraTags]);
  const cluster = master('1f43b675', [el('e7', uint(0)), el('a3', o.frame), ...o.clusterExtra]);
  const segmentData = Buffer.concat([info, tracks, tags, cluster]);
  return Buffer.concat([header, o.segmentUnknown ? el('18538067', segmentData, { unknown: true }) : el('18538067', segmentData, { width: o.segmentWidth }), o.trailing]);
}

// ffprobe-shaped complete metadata (format/streams/frames) for one role.
function probeText({ role, command, frames = FRAMES, bytes = 4096, index = 0, filename, edit = () => {} }) {
  const output = role === 'output';
  const probe = { programs: [], stream_groups: [],
    streams: [{ index: output ? 0 : index, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1',
      display_aspect_ratio: '16:9', field_order: 'progressive', color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
      time_base: output ? '1/1000' : '1/15360', disposition: { default: 1 }, tags: {} }],
    chapters: [],
    format: { filename: filename !== undefined ? filename : output ?'F:\\owned\\stage\\candidate.mkv' : 'D:\\sources\\native source.mp4', format_name: output ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2',
      nb_streams: 1, size: String(bytes), tags: output ? { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: command.outputId, [GENERATION_KEY]: JSON.stringify(command.generationDescription) } : {} },
    frames: Array.from({ length: frames }, (_, i) => { const step = output ? 33 : 512; return { media_type: 'video', stream_index: output ? 0 : index, pts: i * step, pkt_dts: i * step,
      best_effort_timestamp: i * step, duration: step, width: 1280, height: 720, pix_fmt: 'yuv420p', key_frame: i === 0 ? 1 : 0 }; }) };
  edit(probe);
  return JSON.stringify(probe);
}

module.exports = { FRAMES, nativeCommand, matroska, probeText, el, uint, master, simple, crcOf, DURATION };
