'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { normalizeProbe } = require('./inspection.cjs');
const { getRemuxAssessmentSource, getRemuxMp3Source, remuxVerificationDescription } = require('./remux-contract.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { provenanceArgs } = require('./provenance.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { classifyColor } = require('./media.cjs');
const { observeMovRepresentation } = require('./mov-representation.cjs');
const { projectRequiredRemuxTags } = require('./remux-metadata-policy.cjs');
const { deriveRemuxAssessmentBudget } = require('./remux-operation.cjs');
const { observeRemuxEditLists, remuxEditInterval, observeRemuxSourcePlayback } = require('./remux-edit-lists.cjs');
const { observeNativeInventory, compareNativeInventories } = require('./remux-native-checks.cjs');
const { TextDecoder, isDeepStrictEqual } = require('node:util');
const { setImmediate: yieldIO } = require('node:timers/promises');

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
function boundedBudget(value, derived) {
  need(plain(value) && value.sourceDecode === 'complete', 'Main must explicitly budget complete source decode.', 'REMUX_EVIDENCE_COST_APPROVAL');
  const result = { ...derived };
  need(Object.keys(value).every(key => key === 'sourceDecode' || own(derived, key)), 'Unknown evidence budget field.');
  for (const key of ['timeoutMs', 'maxFrameBytes', 'maxPcmBytes', 'maxRecords', 'maxSpoolBytes']) need(own(value, key), `Explicit ${key} budget required.`);
  for (const [key, maximum] of Object.entries(derived)) if (key !== 'sourceDecode' && own(value, key)) {
    const legacy = LIMITS[key];
    need(Number.isSafeInteger(value[key]) && value[key] > 0 && (value[key] === maximum || legacy !== undefined && value[key] <= legacy),
      `${key} exceeds the source-derived production ceiling.`, 'REMUX_EVIDENCE_LIMIT');
    // A legacy main configuration is explicit complete-decode approval, not
    // the actual per-file cost ceiling. Smaller injected budgets still bind.
    if (value[key] !== legacy) result[key] = value[key];
  }
  return result;
}

// Packet proof is valid only with the same decoder initialization and native
// interpretation. Container tags avc1/mp4a and Matroska's zero tag name the same
// codec; all other tags must match exactly. Timestamps/rate summaries are checked
// separately as rationals, never hashed as container-dependent strings.
function remuxCodecParameters(stream) {
  need(plain(stream), 'Missing codec parameters.', 'REMUX_CODEC_PARAMETERS');
  const fields = ['codec_type', 'codec_name', 'profile', 'level', 'width', 'height', 'pix_fmt', 'bits_per_raw_sample',
    'field_order', 'color_transfer', 'color_primaries', 'color_space', 'color_range', 'chroma_location',
    'sample_fmt', 'sample_rate', 'channels', 'channel_layout', 'bits_per_sample', 'initial_padding', 'trailing_padding', 'seek_preroll'];
  const result = Object.fromEntries(fields.filter(key => own(stream, key)).map(key => [key, String(stream[key])]));
  for (const key of ['coded_width', 'coded_height']) if (Number(stream[key]) > 0) result[key] = String(stream[key]);
  for (const key of ['sample_aspect_ratio', 'display_aspect_ratio']) if (own(stream, key)) {
    const m = /^(\d{1,16}):(\d{1,16})$/.exec(stream[key]);
    need(m && BigInt(m[2]) > 0n, 'Unknown codec geometry ratio.', 'REMUX_CODEC_PARAMETERS');
    result[key] = encoded(rational(m[1], m[2]));
  }
  const bytes = stream.extradata_size === undefined ? 0n : integer(stream.extradata_size, 'Extradata bytes', 0n);
  need(bytes <= 8n * 1024n * 1024n && (bytes ? PACKET_HASH.test(String(stream.extradata_hash))
    : stream.extradata_hash === undefined || String(stream.extradata_hash).toLowerCase() === 'sha256:' + sha(Buffer.alloc(0))),
  'Missing or excessive decoder extradata.', 'REMUX_CODEC_PARAMETERS');
  need(!['h264', 'aac'].includes(stream.codec_name) || bytes > 0n, 'H264/AAC requires complete decoder extradata.', 'REMUX_CODEC_PARAMETERS');
  result.extradata = { bytes: String(bytes), sha256: bytes ? PACKET_HASH.exec(stream.extradata_hash)[1].toLowerCase() : sha(Buffer.alloc(0)) };
  const tag = stream.codec_tag_string;
  need(typeof tag === 'string' && tag.length <= 64, 'Missing codec tag interpretation.', 'REMUX_CODEC_PARAMETERS');
  const equivalent = { h264: ['avc1', '[0][0][0][0]'], aac: ['mp4a', '[0][0][0][0]'] }[stream.codec_name];
  result.codecTag = equivalent?.includes(tag) ? stream.codec_name : tag;
  return canonical(result);
}

// ISO/IEC 14496-15 length-prefixed AVC initialization; all parsing below is
// bounded by codec syntax, not source duration. No pixels are decoded here.
function h264Bits(nal) {
  need(Buffer.isBuffer(nal) && nal.length > 1 && nal.length <= 65535 && !(nal[0] & 128), 'Malformed H264 parameter NAL.', 'REMUX_H264_BITSTREAM');
  const raw = Buffer.alloc(nal.length - 1); let length = 0, zeros = 0;
  for (let i = 1; i < nal.length; i++) {
    const b = nal[i];
    if (zeros === 2 && b === 3) { need(i + 1 < nal.length && nal[i + 1] <= 3, 'Invalid H264 emulation prevention.', 'REMUX_H264_BITSTREAM'); zeros = 0; continue; }
    need(zeros !== 2 || b > 2, 'Unescaped H264 start code.', 'REMUX_H264_BITSTREAM');
    raw[length++] = b; zeros = b === 0 ? zeros + 1 : 0;
  }
  return remuxBits(raw, length);
}
function remuxBits(raw, length = raw.length) {
  let at = 0;
  const bits = n => { need(Number.isInteger(n) && n >= 0 && n <= 32 && at + n <= length * 8, 'Truncated H264 syntax.', 'REMUX_H264_BITSTREAM');
    let value = 0; while (n--) { value = value * 2 + ((raw[at >> 3] >> (7 - (at & 7))) & 1); at++; } return value; };
  const ue = (maximum = 2147483647) => { let n = 0; while (!bits(1)) need(++n <= 30, 'Excessive H264 Exp-Golomb value.', 'REMUX_H264_BITSTREAM');
    const value = 2 ** n - 1 + bits(n); need(value <= maximum, 'H264 syntax value exceeds its bound.', 'REMUX_H264_BITSTREAM'); return value; };
  return { bits, ue, se: () => { const v = ue(); return v & 1 ? (v + 1) / 2 : -v / 2; } };
}
function inspectRemuxSps(nal, stream) {
  const r = h264Bits(nal); need((nal[0] & 31) === 7, 'Expected an SPS.', 'REMUX_H264_BITSTREAM');
  const profile = r.bits(8), constraints = r.bits(8), level = r.bits(8), id = r.ue(31);
  const profiles = { 66: ['Baseline', 'Constrained Baseline'], 77: ['Main'], 88: ['Extended'], 100: ['High', 'Constrained High', 'Progressive High'],
    110: ['High 10', 'High 10 Intra'], 122: ['High 4:2:2', 'High 4:2:2 Intra'], 244: ['High 4:4:4 Predictive', 'High 4:4:4 Intra'], 44: ['CAVLC 4:4:4'] };
  need(profiles[profile]?.includes(stream.profile) && (constraints & 3) === 0, 'SPS leaves the admitted profile.', 'REMUX_H264_PROFILE');
  need([9, 10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62].includes(level)
    && level === Number(stream.level), 'SPS leaves the admitted level.', 'REMUX_H264_LEVEL');
  let chroma = 1;
  if ([100, 110, 122, 244, 44].includes(profile)) {
    chroma = r.ue(3); need(chroma === 1, 'Only admitted 4:2:0 SPS chroma is supported.', 'REMUX_H264_CHROMA');
    need(r.ue(6) === 0 && r.ue(6) === 0, 'SPS leaves admitted eight-bit precision.', 'REMUX_H264_BIT_DEPTH');
    r.bits(1);
    if (r.bits(1)) for (let i = 0; i < 8; i++) if (r.bits(1)) {
      let last = 8, next = 8;
      for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + r.se() + 256) % 256; last = next || last; }
    }
  }
  r.ue(12); const order = r.ue(2);
  if (order === 0) r.ue(12);
  else if (order === 1) { r.bits(1); r.se(); r.se(); const n = r.ue(255); for (let i = 0; i < n; i++) r.se(); }
  r.ue(16); r.bits(1); const widthMbs = r.ue(255) + 1, heightMap = r.ue(255) + 1;
  const frameOnly = r.bits(1); need(frameOnly === 1, 'SPS leaves progressive frame coding.', 'REMUX_H264_FIELD_CODING');
  r.bits(1); let left = 0, right = 0, top = 0, bottom = 0;
  if (r.bits(1)) { left = r.ue(8192); right = r.ue(8192); top = r.ue(8192); bottom = r.ue(8192); }
  need(widthMbs * 16 - 2 * (left + right) === stream.width && heightMap * 16 - 2 * (top + bottom) === stream.height,
    'SPS dimensions/cropping leave admitted geometry.', 'REMUX_H264_GEOMETRY');
  if (r.bits(1)) {
    if (r.bits(1)) {
      const sarId = r.bits(8), table = [[0, 0], [1, 1], [12, 11], [10, 11], [16, 11], [40, 33], [24, 11], [20, 11], [32, 11],
        [80, 33], [18, 11], [15, 11], [64, 33], [160, 99], [4, 3], [3, 2], [2, 1]];
      const sar = sarId === 255 ? [r.bits(16), r.bits(16)] : table[sarId];
      if (sarId !== 0) {
        const expected = /^(\d+):(\d+)$/.exec(stream.sample_aspect_ratio);
        need(sar && sar[0] > 0 && sar[1] > 0 && expected && BigInt(sar[0]) * BigInt(expected[2]) === BigInt(sar[1]) * BigInt(expected[1]),
          'SPS VUI leaves admitted sample aspect ratio.', 'REMUX_H264_SAR');
      }
    }
    if (r.bits(1)) r.bits(1);
    if (r.bits(1)) {
      r.bits(3); const full = r.bits(1);
      need(full === 0 && stream.color_range === 'tv', 'SPS VUI changes native colour range.', 'REMUX_H264_COLOUR_RANGE');
      if (r.bits(1)) {
        need(r.bits(8) === 1, 'SPS VUI leaves admitted BT709 primaries.', 'REMUX_H264_COLOUR_PRIMARIES');
        need(r.bits(8) === 1, 'SPS VUI leaves admitted BT709 transfer.', 'REMUX_H264_COLOUR_TRANSFER');
        need(r.bits(8) === 1, 'SPS VUI leaves admitted BT709 matrix.', 'REMUX_H264_COLOUR_MATRIX');
      }
    }
    // Remaining VUI cannot override colour/geometry. Exact complete SPS byte
    // membership below still covers timing, HRD and all unprojected fields.
  }
  need(stream.pix_fmt === 'yuv420p' && ['color_primaries', 'color_transfer', 'color_space'].every(k => stream[k] === 'bt709')
    && stream.color_range === 'tv', 'Unknown admitted SDR interpretation.', 'REMUX_H264_COLOUR');
  return { id, profile, level, chroma, widthMbs, heightMap };
}
function parseRemuxAvcc(data, stream) {
  need(Buffer.isBuffer(data) && data.length >= 7 && data.length <= 8 * 1024 ** 2 && data[0] === 1
    && (data[4] & 252) === 252 && (data[5] & 224) === 224, 'Malformed admitted AVC configuration.', 'REMUX_H264_CONFIG');
  const sps = new Map(), pps = new Map(), ids = new Set(); let at = 6;
  const take = () => { need(at + 2 <= data.length, 'Truncated AVC parameter length.', 'REMUX_H264_CONFIG'); const n = data.readUInt16BE(at); at += 2;
    need(n > 1 && at + n <= data.length, 'Truncated AVC parameter bytes.', 'REMUX_H264_CONFIG'); const nal = data.subarray(at, at + n); at += n; return nal; };
  const nsps = data[5] & 31; need(nsps > 0, 'Missing admitted SPS.', 'REMUX_H264_CONFIG');
  for (let i = 0; i < nsps; i++) { const nal = take(), parsed = inspectRemuxSps(nal, stream);
    need(!ids.has(parsed.id) && nal[1] === data[1] && nal[2] === data[2] && nal[3] === data[3], 'Ambiguous AVC SPS initialization.', 'REMUX_H264_CONFIG');
    ids.add(parsed.id); sps.set(sha(nal), Buffer.from(nal)); }
  need(at < data.length, 'Missing AVC PPS count.', 'REMUX_H264_CONFIG'); const npps = data[at++], pids = new Set();
  need(npps > 0, 'Missing admitted PPS.', 'REMUX_H264_CONFIG');
  for (let i = 0; i < npps; i++) { const nal = take(), r = h264Bits(nal), id = r.ue(255), sid = r.ue(31);
    need((nal[0] & 31) === 8 && ids.has(sid) && !pids.has(id), 'PPS has an unknown SPS or duplicate identity.', 'REMUX_H264_PPS');
    pids.add(id); pps.set(sha(nal), Buffer.from(nal)); }
  if (at < data.length) {
    need([100, 110, 122, 244, 44].includes(data[1]) && at + 4 === data.length && data[at] === 253
      && data[at + 1] === 248 && data[at + 2] === 248 && data[at + 3] === 0,
    'Unsupported AVC extension or trailing data.', 'REMUX_H264_CONFIG'); at += 4;
  }
  need(at === data.length, 'Unexamined AVC initialization data.', 'REMUX_H264_CONFIG');
  return { lengthBytes: (data[4] & 3) + 1, sps, pps, configurationSha256: sha(data), bytes: data.length };
}
function parseRemuxAsc(data, stream) {
  need(Buffer.isBuffer(data) && data.length >= 2 && data.length <= 64, 'Missing bounded AAC configuration.', 'REMUX_AAC_CONFIG');
  let at = 0; const bits = n => { need(at + n <= data.length * 8, 'Truncated AAC configuration.', 'REMUX_AAC_CONFIG');
    let v = 0; while (n--) { v = v * 2 + ((data[at >> 3] >> (7 - (at & 7))) & 1); at++; } return v; };
  need(bits(5) === 2 && stream.profile === 'LC', 'Only admitted AAC LC initialization is supported.', 'REMUX_AAC_PROFILE');
  const index = bits(4), rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const rate = index === 15 ? bits(24) : rates[index], channels = bits(4);
  need(rate === Number(stream.sample_rate) && [44100, 48000].includes(rate), 'AAC initialization changes admitted sample rate.', 'REMUX_AAC_RATE');
  need([1, 2].includes(channels) && channels === stream.channels && stream.channel_layout === (channels === 1 ? 'mono' : 'stereo'),
    'AAC initialization changes admitted channel layout or requires an unobserved PCE.', 'REMUX_AAC_LAYOUT');
  const samples = bits(1) ? 960 : 1024;
  need(bits(1) === 0 && bits(1) === 0, 'Unsupported dependent/extended AAC configuration.', 'REMUX_AAC_CONFIG');
  if (data.length * 8 - at >= 17) {
    const remainder = at; const extension = bits(11);
    if (extension === 695) need(bits(5) === 5 && bits(1) === 0, 'AAC SBR changes the admitted LC interpretation.', 'REMUX_AAC_PROFILE');
    else at = remainder;
  }
  while (at < data.length * 8) need(bits(1) === 0, 'Unknown AAC configuration extension.', 'REMUX_AAC_CONFIG');
  return { samples, rate, channels, configurationSha256: sha(data) };
}
function createRemuxHexSink(expectedBytes, expectedHash) {
  need(Number.isSafeInteger(expectedBytes) && expectedBytes > 0 && expectedBytes <= 8 * 1024 ** 2 && PACKET_HASH.test(expectedHash),
    'Bounded complete extradata is required.', 'REMUX_CODEC_PARAMETERS');
  const data = Buffer.alloc(expectedBytes); let at = 0;
  const lineSink = createLineSink(line => {
    if (!line) return;
    need(/^[a-f0-9]{8}: /i.test(line), 'Unexpected extradata dump record.', 'REMUX_CODEC_PARAMETERS');
    need(parseInt(line.slice(0, 8), 16) === at, 'Extradata dump offset changed.', 'REMUX_CODEC_PARAMETERS');
    const hex = line.slice(10, 49).replace(/ /g, '');
    need(/^[a-f0-9]+$/i.test(hex) && hex.length % 2 === 0 && hex.length <= 32 && at + hex.length / 2 <= data.length,
      'Malformed or excessive extradata dump.', 'REMUX_CODEC_PARAMETERS');
    const bytes = Buffer.from(hex, 'hex'); bytes.copy(data, at); at += bytes.length;
  }, 256);
  return { push: c => lineSink.push(c), async finish() { await lineSink.finish();
    need(at === data.length && sha(data) === expectedHash.slice(7).toLowerCase(), 'Extradata dump differs from its admitted bytes/hash.', 'REMUX_CODEC_PARAMETERS'); return data; } };
}
// Main checks every NAL header and the bounded slice prefix; FFmpeg's CBS
// h264_metadata branch validates the entire slice header, never entropy data.
// VCL bodies are discarded with native Buffer searches, not retained or walked
// byte-by-byte in JS. Parameter/SEI bodies retain the existing streaming checks.
function createRemuxHeaderSink(admitted, stream, limits, framing = 'annexb') {
  const parameters = createRemuxParameterSink(admitted, stream, limits), marker = Buffer.from([0, 0, 1]);
  // One lookahead byte validates an escape at the edge of the64-byte prefix.
  let tail = Buffer.alloc(0), started = false, prefix = Buffer.alloc(65), used = 0, type = null;
  let bytes = 0, units = 0, slices = 0, fillerBytes = 0, fillerTail = Buffer.alloc(0);
  const fillerBlock = Buffer.alloc(65536, 255);
  let length = 0, lengthBytes = 0, left = 0;
  need(framing === 'annexb' || framing === 'avcc', 'Unknown H264 framing.', 'REMUX_H264_HEADER_SYNTAX');
  function filler(data) {
    fillerBytes += data.length;
    const joined = fillerTail.length ? Buffer.concat([fillerTail, data]) : data, bodyEnd = Math.max(0, joined.length - 4);
    for (let at = 0; at < bodyEnd;) {
      const take = Math.min(fillerBlock.length, bodyEnd - at);
      need(joined.subarray(at, at + take).equals(fillerBlock.subarray(0, take)), 'Invalid H264 filler byte.', 'REMUX_H264_HEADER_SYNTAX'); at += take;
    }
    fillerTail = Buffer.from(joined.subarray(bodyEnd));
  }
  const pictures = new Map([...admitted.sps.values()].map(nal => {
    const s = inspectRemuxSps(nal, stream); return [s.id, s.widthMbs * s.heightMap];
  }));
  const ppsPictures = new Map([...admitted.pps.values()].map(nal => {
    const reader = h264Bits(nal); return [reader.ue(255), pictures.get(reader.ue(31))];
  }));
  async function part(data) {
    if (!data.length) return;
    const first = type === null;
    if (type === null) {
      const header = data[0]; type = header & 31;
      need(!(header & 128), 'Forbidden H264 NAL header bit.', 'REMUX_H264_HEADER_SYNTAX');
      need([1, 5, 6, 7, 8, 9, 10, 11, 12].includes(type), 'Reserved or unadmitted H264 NAL type.',
        type >= 13 && type <= 23 || type >= 30 ? 'REMUX_H264_PARAMETER_EXTENSION' : 'REMUX_H264_HEADER_SYNTAX');
      need([5, 7, 8].includes(type) ? (header & 96) !== 0 : ![6, 9, 10, 11, 12].includes(type) || (header & 96) === 0,
        'H264 NAL reference priority contradicts its type.', 'REMUX_H264_HEADER_SYNTAX');
      if ([6, 7, 8].includes(type)) await parameters.push(Buffer.from([0, 0, 0, 1]));
    }
    if ([1, 5].includes(type)) { const take = Math.min(data.length, prefix.length - used); data.copy(prefix, used, 0, take); used += take; }
    else if ([6, 7, 8].includes(type)) await parameters.push(data);
    else if (type === 12) filler(data.subarray(first ? 1 : 0));
  }
  function end() {
    need(type !== null, 'Empty H264 NAL unit.', 'REMUX_H264_HEADER_SYNTAX');
    need(++units <= limits.maxUnits, 'Excessive H264 NAL units.', 'REMUX_PROPORTIONAL_BUDGET');
    if ([6, 7, 8].includes(type)) parameters.endNal();
    if ([1, 5].includes(type)) {
      // Only bytes needed by the first three ue fields are interpreted here.
      // CBS handles all remaining context-dependent fields in the same child.
      const rbsp = []; let zeros = 0;
      for (let i = 1; i < Math.min(used, 64); i++) {
        const byte = prefix[i];
        if (zeros === 2 && byte === 3) {
          need(i + 1 < used && prefix[i + 1] <= 3, 'Invalid slice-header emulation prevention.', 'REMUX_H264_SLICE_ESCAPE');
          zeros = 0; continue;
        }
        need(zeros !== 2 || byte > 2, 'Unescaped slice-header byte sequence.', 'REMUX_H264_SLICE_ESCAPE');
        rbsp.push(byte); zeros = byte === 0 ? zeros + 1 : 0;
      }
      try {
        const reader = remuxBits(Buffer.from(rbsp));
        const firstMb = reader.ue();
        reader.ue(9);
        const picture = ppsPictures.get(reader.ue(255));
        need(picture !== undefined, 'Slice references an unadmitted PPS.', 'REMUX_H264_HEADER_SYNTAX');
        need(firstMb < picture, 'First macroblock exceeds the referenced SPS picture.', 'REMUX_H264_HEADER_SYNTAX');
      } catch (error) { throw new ToolError('REMUX_H264_HEADER_SYNTAX', 'Invalid or truncated H264 slice header.', { cause: error }); }
      slices++;
    }
    if (type === 12) {
      let end = fillerTail.length; while (end && fillerTail[end - 1] === 0) end--;
      need(end > 0 && fillerTail[end - 1] === 128 && fillerTail.subarray(0, end - 1).every(b => b === 255),
        'Invalid H264 filler trailing bits.', 'REMUX_H264_HEADER_SYNTAX'); fillerTail = Buffer.alloc(0);
    }
    used = 0; type = null;
  }
  return {
    endPacket() {
      need(framing === 'avcc' && left === 0 && lengthBytes === 0 && type === null,
        'An AVC packet ends inside a NAL.', 'REMUX_H264_HEADER_SYNTAX');
    },
    async push(chunk) {
      bytes += chunk.length; need(Number.isSafeInteger(bytes) && bytes <= limits.maxBytes, 'Header scan exceeds source-derived bytes.', 'REMUX_PROPORTIONAL_BUDGET');
      if (framing === 'avcc') {
        for (let at = 0; at < chunk.length;) {
          if (!left) {
            while (at < chunk.length && lengthBytes < admitted.lengthBytes) { length = length * 256 + chunk[at++]; lengthBytes++; }
            if (lengthBytes !== admitted.lengthBytes) break;
            need(length > 0 && length <= limits.maxBytes, 'Invalid original AVC NAL length.', 'REMUX_H264_HEADER_SYNTAX');
            left = length; length = 0; lengthBytes = 0; started = true;
          }
          const take = Math.min(left, chunk.length - at);
          await part(chunk.subarray(at, at + take)); at += take; left -= take;
          if (!left) end();
        }
        return;
      }
      const data = tail.length ? Buffer.concat([tail, chunk]) : chunk; let at = 0, next;
      while ((next = data.indexOf(marker, at)) !== -1) {
        if (started) { await part(data.subarray(at, next)); end(); }
        else need(data.subarray(at, next).every(b => b === 0), 'Missing H264 Annex-B prefix.', 'REMUX_H264_HEADER_SYNTAX');
        started = true; at = next + 3;
      }
      const stopAt = Math.max(at, data.length - 3);
      if (started) await part(data.subarray(at, stopAt));
      else need(data.subarray(at, stopAt).every(b => b === 0), 'Invalid H264 prefix.', 'REMUX_H264_HEADER_SYNTAX');
      tail = Buffer.from(data.subarray(stopAt));
    },
    async finish() {
      need(started, 'No complete H264 header stream.', 'REMUX_H264_HEADER_SYNTAX');
      if (framing === 'avcc') need(left === 0 && lengthBytes === 0, 'Truncated original AVC NAL.', 'REMUX_H264_HEADER_SYNTAX');
      else { await part(tail); end(); }
      need(slices > 0, 'No validated H264 slices.', 'REMUX_H264_HEADER_SYNTAX');
      return { ...await parameters.finish(), headerSyntax: { version: 1, complete: true, method: 'ffmpeg-cbs-h264-v1',
        nalUnits: units, sliceHeaders: slices, fillerBytes, interiorDecoded: false } };
    },
  };
}
// One compressed-data pipe, bounded by the independently acquired packet
// sizes. Each packet is hashed in main while every original NAL is inspected;
// a missing/extra/reordered/truncated packet cannot hide in a hash summary.
function createRemuxPacketHeaderSink(admitted, stream, limits, cursor, expectedCount, onKeyChunk = null, onPacketEnd = null) {
  const headers = createRemuxHeaderSink(admitted, stream, limits, 'avcc');
  const payload = createHash('sha256'); let packet = null, remaining = 0, count = 0, digest;
  return {
    async push(chunk) {
      for (let at = 0; at < chunk.length;) {
        if (!packet) {
          const next = await cursor.next();
          need(!next.done && count < expectedCount, 'An extra video packet entered header validation.', 'REMUX_H264_SCAN_COVERAGE');
          packet = next.value; remaining = Number(packet.size);
          need(Number.isSafeInteger(remaining) && remaining > 0 && remaining <= limits.maxBytes, 'Invalid header-scan packet size.', 'REMUX_H264_SCAN_COVERAGE');
          need(HASH.test(packet.hash) || limits.deferredPacketHashes === true && packet.hash === null,
            'An independently completed packet hash pass is required.', 'REMUX_H264_SCAN_COVERAGE');
          digest = createHash('sha256');
        }
        const take = Math.min(remaining, chunk.length - at), part = chunk.subarray(at, at + take);
        await headers.push(part); digest.update(part); await onKeyChunk?.(count, part);
        at += take; remaining -= take;
        if (!remaining) {
          headers.endPacket();
          const hash = digest.digest('hex');
          need(packet.hash === null || hash === packet.hash, 'A video packet changed during complete header validation.', 'REMUX_H264_SCAN_COVERAGE');
          payload.update(packet.size + ':' + hash + '\n');
          await onPacketEnd?.(count); count++; packet = null;
        }
      }
    },
    async finish() {
      need(!packet && count === expectedCount && (await cursor.next()).done,
        'The complete video header pass was truncated.', 'REMUX_H264_SCAN_COVERAGE');
      return { ...await headers.finish(), packetPayloadSha256: payload.digest('hex') };
    },
  };
}
function createRemuxParameterSink(admitted, stream, { maxBytes, maxUnits }) {
  let bytes = 0, units = 0, parameters = 0, seis = 0, zeros = 0, started = false, type = null, nalBytes = 0, parts = [];
  let rbspZeros = 0, prevent = false, phase = 'type', seiType = 0, size = 0, left = 0, trailing = false;
  function emit(b) {
    if (type === null) {
      need(!(b & 128), 'Forbidden H264 NAL header bit.', 'REMUX_H264_BITSTREAM');
      need([6, 7, 8].includes(b & 31), 'Unadmitted extension/parameter NAL in the complete scan.', 'REMUX_H264_PARAMETER_EXTENSION'); type = b & 31;
    }
    need(++nalBytes <= (type === 6 ? 64 * 1024 ** 2 : 65535), 'Parameter/SEI unit exceeds its byte ceiling.', 'REMUX_PROPORTIONAL_BUDGET');
    if (type !== 6) { parts.push(b); return; }
    if (nalBytes === 1) return;
    if (prevent) { need(b <= 3, 'Malformed SEI emulation prevention.', 'REMUX_H264_BITSTREAM'); prevent = false; }
    else if (rbspZeros === 2 && b === 3) { prevent = true; rbspZeros = 0; return; }
    else need(rbspZeros !== 2 || b > 2, 'Unescaped SEI byte sequence.', 'REMUX_H264_BITSTREAM');
    rbspZeros = b === 0 ? rbspZeros + 1 : 0;
    if (trailing) { need(b === 0, 'SEI data follows trailing bits.', 'REMUX_H264_BITSTREAM'); return; }
    if (phase === 'body') { if (--left === 0) { phase = 'type'; seiType = 0; } return; }
    if (phase === 'type') {
      if (b === 128 && seiType === 0) { trailing = true; return; }
      seiType += b; need(seiType <= 65535, 'Excessive SEI type.', 'REMUX_PROPORTIONAL_BUDGET');
      if (b !== 255) {
        need(![4, 23, 137, 142, 144, 147, 148, 149].includes(seiType), 'HDR/registered or alternative-colour SEI is outside admitted SDR.', 'REMUX_H264_HDR_SEI');
        // Only timing, filler, unregistered opaque bytes and recovery points
        // cannot carry a standard colour override or nested parameter/SEI set.
        // In particular scalable/MVC nesting must not hide an HDR payload.
        need([0, 1, 3, 5, 6].includes(seiType), 'Uninterpreted or nested SEI is outside admitted SDR.', 'REMUX_H264_SEI_UNSUPPORTED');
        phase = 'size'; size = 0;
      }
    } else {
      size += b; need(size <= 64 * 1024 ** 2, 'Excessive SEI payload.', 'REMUX_PROPORTIONAL_BUDGET');
      if (b !== 255) { if (size) { left = size; phase = 'body'; } else { phase = 'type'; seiType = 0; } }
    }
  }
  function finishNal() {
    if (type === null) return;
    need(++units <= maxUnits, 'Parameter NAL count exceeds source budget.', 'REMUX_PROPORTIONAL_BUDGET');
    if (type === 6) { need(!prevent && phase === 'type' && trailing, 'Truncated SEI message.', 'REMUX_H264_BITSTREAM'); seis++; }
    else {
      const nal = Buffer.from(parts);
      if (type === 7) { inspectRemuxSps(nal, stream); need(admitted.sps.has(sha(nal)), 'An in-band SPS differs from admitted extradata.', 'REMUX_H264_SPS_CHANGED'); }
      else need(admitted.pps.has(sha(nal)), 'An in-band PPS differs from admitted extradata.', 'REMUX_H264_PPS_CHANGED');
      parameters++;
    }
    type = null; nalBytes = 0; parts = []; rbspZeros = 0; prevent = false; phase = 'type'; seiType = 0; size = 0; left = 0; trailing = false;
  }
  return { endNal() { finishNal(); zeros = 0; }, async push(chunk) {
    bytes += chunk.length; need(Number.isSafeInteger(bytes) && bytes <= maxBytes, 'Parameter scan exceeds source-derived bytes.', 'REMUX_PROPORTIONAL_BUDGET');
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]; if (b === 0) { zeros++; continue; }
      if (b === 1 && zeros >= 2) { if (started) finishNal(); started = true; zeros = 0; continue; }
      need(started, 'Missing Annex-B parameter start code.', 'REMUX_H264_BITSTREAM');
      while (zeros > 0) { emit(0); zeros--; } emit(b);
    }
    await yieldIO();
  }, async finish() { need(started || bytes === 0, 'Incomplete Annex-B parameter scan.', 'REMUX_H264_BITSTREAM'); finishNal();
    return { version: 1, complete: true, kind: 'h264-parameter-sei-v1', configurationSha256: admitted.configurationSha256,
      parameterSets: parameters, seiUnits: seis, scannedBytes: bytes }; } };
}
function createRemuxAvccClipSink(admitted, writer) {
  let length = 0, lengthBytes = 0, left = 0, units = 0;
  return { async push(chunk) {
    for (let at = 0; at < chunk.length;) {
      if (!left) {
        while (at < chunk.length && lengthBytes < admitted.lengthBytes) { length = length * 256 + chunk[at++]; lengthBytes++; }
        if (lengthBytes !== admitted.lengthBytes) break;
        need(length > 0 && length <= 64 * 1024 ** 2 && ++units <= 1024, 'Malformed bounded AVC key packet.', 'REMUX_PACKET_WINDOW_ANCHOR');
        left = length; length = 0; lengthBytes = 0; await writer.write(Buffer.from([0, 0, 0, 1]));
      }
      const n = Math.min(left, chunk.length - at); if (n) await writer.write(chunk.subarray(at, at + n)); left -= n; at += n;
    }
  }, async finish() { need(units > 0 && left === 0 && lengthBytes === 0, 'Truncated AVC key packet.', 'REMUX_PACKET_WINDOW_ANCHOR'); } };
}

const PACKET_TOLERANCE = rational(1, 500), MAX_REORDER = 16;
const PACKET_FIELDS = new Set(['codec_type', 'stream_index', 'pts', 'pts_time', 'dts', 'dts_time', 'duration', 'duration_time',
  'size', 'pos', 'flags', 'data_hash', 'side_data_list', 'sample_rate', 'sample_fmt', 'channels', 'channel_layout', 'profile', 'codec_name']);
function createRemuxPacketAccumulator(stream, { maxRecords, maxSourceBytes, maxDurationSeconds, family, semanticAudio = false, deferPayloadHash = false }) {
  let count = 0, bytes = 0n, first = null, end = null, previous = null, firstStep = null, differingStep = null;
  let firstKey = null, lastKey = null, keyCount = 0, lastDecodePts = null, reordered = false, peakRows = 0;
  const presentation = [], presentationHash = createHash('sha256');
  if (stream.codec_type === 'video' && stream.has_b_frames !== undefined) need(Number.isSafeInteger(stream.has_b_frames) && stream.has_b_frames >= 0 && stream.has_b_frames <= MAX_REORDER,
    'A bounded H264 presentation reorder depth is required.', 'REMUX_PACKET_REORDER');
  function present(row) {
    presentationHash.update(row.packetIndex + ':' + row.hash + '\n');
    const pts = rational(row.pts.numerator, row.pts.denominator);
    if (previous) {
      const delta = sub(pts, previous); need(delta.n > 0n, 'Packet presentation order exceeds the H264 reorder bound.', 'REMUX_PACKET_REORDER');
      if (!firstStep) firstStep = delta; else if (!differingStep && sub(firstStep, delta).n) differingStep = delta;
    }
    previous = pts;
  }
  return {
    push(packet) {
      need(plain(packet) && packet.stream_index === stream.index && packet.codec_type === stream.codec_type,
        'Packet belongs to another mapped stream.', 'REMUX_PACKET_STREAM');
      const sideData = packet.side_data_list || [];
      need(Array.isArray(sideData) && sideData.length <= 16 && sideData.every(plain), 'Malformed packet side metadata.', 'REMUX_PACKET_SIDE_DATA');
      for (const entry of sideData) {
        need(typeof entry.side_data_type === 'string', 'Unknown packet side metadata.', 'REMUX_PACKET_SIDE_DATA');
        need(!/new[ _]?extradata/i.test(entry.side_data_type), 'Mid-stream decoder initialization changed.',
          stream.codec_type === 'audio' ? 'REMUX_AUDIO_EXTRADATA_CHANGED' : 'REMUX_H264_EXTRADATA_CHANGED');
        need(!/param(?:eter)?[ _]?change/i.test(entry.side_data_type), 'Mid-stream codec parameters changed.',
          stream.codec_type === 'audio' ? 'REMUX_AUDIO_PARAMETERS_CHANGED' : 'REMUX_H264_PARAMETERS_CHANGED');
      }
      for (const field of ['sample_rate', 'sample_fmt', 'channels', 'channel_layout', 'profile', 'codec_name'])
        need(!own(packet, field) || String(packet[field]) === String(stream[field]), `Packet ${field} changes admitted codec parameters.`,
          stream.codec_type === 'audio' ? 'REMUX_AUDIO_PARAMETERS_CHANGED' : 'REMUX_H264_PARAMETERS_CHANGED');
      need(Object.keys(packet).every(key => PACKET_FIELDS.has(key)), 'Uninterpreted packet fields cannot establish identity.', 'REMUX_PACKET_SCHEMA');
      need(++count <= maxRecords, 'Packet record budget exceeded.', 'REMUX_PROPORTIONAL_BUDGET');
      const size = integer(packet.size, 'Packet size', 1n); bytes += size;
      need(size <= 64n * 1024n * 1024n && bytes <= BigInt(maxSourceBytes), 'Packet payload exceeds its source-derived byte budget.', 'REMUX_PROPORTIONAL_BUDGET');
      need(deferPayloadHash || PACKET_HASH.test(String(packet.data_hash)), 'Missing complete packet payload SHA256.', 'REMUX_PACKET_PAYLOAD');
      need(typeof packet.flags === 'string' && /^[K_][D_][C_]$/.test(packet.flags) && packet.flags[2] !== 'C',
        'Unknown or corrupt packet flags.', 'REMUX_PACKET_FLAGS');
      const pts = time(packet.pts, stream), extent = time(packet.duration, stream);
      need(extent.n > 0n, 'A complete positive packet duration is required.', 'REMUX_PACKET_TIMING');
      let dts = packet.dts === undefined ? null : time(packet.dts, stream);
      for (const field of ['pts', 'dts', 'duration']) if (packet[field + '_time'] !== undefined) {
        need(packet[field] !== undefined && !greater(abs(sub(time(packet[field], stream), decimal(packet[field + '_time']))), PACKET_TOLERANCE),
          'Packet native ticks contradict reported seconds.', 'REMUX_PACKET_TIMING');
      }
      // Event and audio streams cannot reorder. Matroska video's leading DTS
      // prefix is reconstructed later from its first concrete decode clock.
      if (!dts && stream.codec_type !== 'video') dts = pts;
      need(dts || family === 'matroska' && stream.codec_type === 'video',
        'Packet DTS is unavailable outside the Matroska reorder prefix.', 'REMUX_PACKET_DTS');
      need(Array.isArray(sideData) && sideData.length <= 16 && sideData.every(entry => plain(entry)
        && entry.side_data_type === 'Skip Samples' && Object.keys(entry).every(key => ['side_data_type', 'skip_samples', 'discard_padding', 'skip_reason', 'discard_reason'].includes(key))
        && ['skip_samples', 'discard_padding', 'skip_reason', 'discard_reason'].every(key => own(entry, key) && integer(entry[key], key, 0n) <= 4294967295n)),
      'Uninterpreted packet side metadata cannot establish identity.', 'REMUX_PACKET_SIDE_DATA');
      if (semanticAudio) need(stream.codec_type === 'audio' && sideData.length <= 1,
        'Ambiguous duplicate audio trim side data.', 'REMUX_PACKET_SIDE_DATA');
      const row = { packetIndex: count - 1, size: String(size), hash: deferPayloadHash ? null : PACKET_HASH.exec(packet.data_hash)[1].toLowerCase(), key: packet.flags[0] === 'K',
        discard: packet.flags[1] === 'D', sideSha256: sha(JSON.stringify(canonical(sideData))),
        pts: encoded(pts), dts: dts && encoded(dts), duration: encoded(extent),
        ...(semanticAudio ? { trim: { skip: String(sideData[0]?.skip_samples || 0), padding: String(sideData[0]?.discard_padding || 0) } } : {}) };
      if (!first || greater(first, pts)) first = pts;
      const tail = add(pts, extent); if (!end || greater(tail, end)) end = tail;
      need(!greater(sub(end, first), rational(maxDurationSeconds)), 'Packet extent exceeds the probed duration budget.', 'REMUX_PROPORTIONAL_BUDGET');
      if (stream.codec_type === 'video') {
        reordered ||= lastDecodePts !== null && greater(lastDecodePts, pts); lastDecodePts = pts;
        presentation.push(row); presentation.sort((a, b) => { const d = sub(rational(a.pts.numerator, a.pts.denominator), rational(b.pts.numerator, b.pts.denominator)); return d.n < 0n ? -1 : d.n > 0n ? 1 : 0; });
        peakRows = Math.max(peakRows, presentation.length);
        if (presentation.length > MAX_REORDER) present(presentation.shift());
        if (row.key) { const key = { pts: row.pts, dts: row.dts, packetIndex: count - 1, hash: row.hash, size: row.size }; firstKey ||= key; lastKey = key; keyCount++; }
      }
      return row;
    },
    finish() {
      need(stream.codec_type === 'subtitle' || count > 0, 'Copied stream has no complete packets.', 'REMUX_PACKET_COUNT');
      for (const row of presentation) present(row); presentation.length = 0;
      if (stream.codec_type === 'video') need(firstKey && lastKey, 'Bounded decoding requires actual random-access packets.', 'REMUX_PACKET_WINDOW');
      return { count, bytes: String(bytes), firstPts: first && encoded(first), endPts: end && encoded(end), firstKey, lastKey,
        keyCount, reordered, peakRows, presentationSha256: presentationHash.digest('hex'), ...(stream.codec_type === 'video' ? { cadence: { version: 1,
          classification: !firstStep ? 'insufficient' : differingStep ? 'variable' : 'constant', intervalCount: String(count - 1),
          firstStep: firstStep && encoded(firstStep), differingStep: differingStep && encoded(differingStep) } } : {}) };
    },
  };
}

// Cross-family audio compares the samples the decoder actually keeps, not the
// demuxer's choice of edit-list/CodecDelay flags. This is deliberately separate
// from same-family byte-exact metadata and never guesses from negative PTS alone.
function createRemuxAudioTrim(stream, samplesPerPacket, packetCount, family) {
  need(stream.codec_name === 'aac' && stream.profile === 'LC' && [960, 1024].includes(samplesPerPacket)
    && Number.isSafeInteger(packetCount) && packetCount > 0, 'An admitted AAC sample grid is required.', 'REMUX_AUDIO_TRIM');
  const rate = integer(stream.sample_rate, 'AAC sample rate', 1n), unit = BigInt(samplesPerPacket), coded = unit * BigInt(packetCount);
  const hint = key => own(stream, key) ? integer(stream[key], key, 0n) : 0n;
  let declaredLead = hint('initial_padding'), declaredTail = hint('trailing_padding');
  if (own(stream, 'codec_delay')) {
    need(family === 'matroska', 'Unknown codec-delay units outside Matroska.', 'REMUX_AUDIO_TRIM');
    const ns = hint('codec_delay'), scaled = ns * rate, samples = (scaled + 500000000n) / 1000000000n;
    // Matroska CodecDelay is integer nanoseconds; permit only its <=1ns
    // serialization error, never a sample of semantic trim tolerance.
    need((scaled > samples * 1000000000n ? scaled - samples * 1000000000n : samples * 1000000000n - scaled) <= rate,
      'Codec delay does not name an exact sample count.', 'REMUX_AUDIO_TRIM');
    need(!declaredLead || !samples || declaredLead === samples, 'Conflicting audio delay representations.', 'REMUX_AUDIO_TRIM');
    declaredLead ||= samples;
  }
  need(declaredLead + declaredTail < coded, 'Audio trim exceeds its complete coded samples.', 'REMUX_AUDIO_TRIM');
  let leadLimit = declaredLead, explicitLead = declaredLead > 0n, leading = 0n, trailing = 0n, kept = 0n, index = 0, tailStarted = false, clock = null;
  return { push(row) {
    need(plain(row.trim) && Object.keys(row.trim).length === 2 && own(row.trim, 'skip') && own(row.trim, 'padding'),
      'Complete audio trim records are required.', 'REMUX_AUDIO_TRIM');
    const skip = integer(row.trim.skip, 'Skip samples', 0n), pad = integer(row.trim.padding, 'Discard padding', 0n), base = BigInt(index++) * unit;
    need(skip <= coded - base && pad <= unit, 'Audio trim exceeds its sample extent.', 'REMUX_AUDIO_TRIM');
    if (base === 0n) {
      const start = own(stream, 'start_pts') ? time(stream.start_pts, stream)
        : typeof stream.start_time === 'string' && /^-?\d+(?:\.\d+)?$/.test(stream.start_time) ? decimal(stream.start_time) : null;
      if (start) { const delta = sub(start, rational(row.pts.numerator, row.pts.denominator)); if (delta.n > 0n) clock = delta; }
      if (!explicitLead && !skip && !row.discard && clock) {
        need(clock.n * rate % clock.d === 0n, 'Track start alone cannot resolve an exact audio trim.', 'REMUX_AUDIO_TRIM');
        leadLimit = clock.n * rate / clock.d;
      }
    }
    if (skip) {
      need(base <= leadLimit && (!explicitLead || base + skip === leadLimit), 'Interior or conflicting audio leading trim.', 'REMUX_AUDIO_TRIM');
      leadLimit = base + skip > leadLimit ? base + skip : leadLimit; explicitLead = true;
    }
    let head = leadLimit > base ? (leadLimit - base > unit ? unit : leadLimit - base) : 0n;
    let tail = base + unit > coded - declaredTail ? base + unit - (coded - declaredTail) : 0n; if (tail > unit) tail = unit;
    if (row.discard && !kept && !tailStarted) {
      need(!explicitLead || base + unit <= leadLimit, 'Discard flag contradicts explicit leading samples.', 'REMUX_AUDIO_TRIM');
      head = unit; if (base + unit > leadLimit) leadLimit = base + unit;
    } else if (row.discard) {
      need(!pad || pad === unit, 'Discard flag contradicts explicit tail padding.', 'REMUX_AUDIO_TRIM'); tail = unit - head;
    }
    if (pad > tail) tail = pad;
    need(head + tail <= unit && (!kept || head === 0n), 'Overlapping or interior audio trim.', 'REMUX_AUDIO_TRIM');
    const audible = unit - head - tail;
    need(!tailStarted || audible === 0n, 'Interior audio padding cannot stand for a trailing trim.', 'REMUX_AUDIO_TRIM');
    leading += head; trailing += tail; kept += audible; if (tail) tailStarted = true;
  }, finish() {
    need(index === packetCount && kept > 0n && leading === leadLimit && (!declaredLead || leading === declaredLead)
      && (!declaredTail || trailing === declaredTail), 'Incomplete or contradictory effective audio trim.', 'REMUX_AUDIO_TRIM');
    if (clock) need(!greater(abs(sub(clock, rational(leading, rate))), PACKET_TOLERANCE),
      'Audio trim contradicts its track start clock.', 'REMUX_AUDIO_TRIM');
    return { version: 1, samplesPerPacket, codedSamples: String(coded), leadingSamples: String(leading), trailingSamples: String(trailing) };
  } };
}

async function* packetDecodeClock(input, { allowPrefix, signal } = {}) {
  const prefix = []; let seenDts = false;
  for await (const row of input) {
    need(!signal?.aborted, 'Packet comparison cancelled.', 'CANCELLED');
    if (!row.dts) {
      need(allowPrefix && !seenDts && prefix.length < MAX_REORDER, 'Missing interior or excessive leading DTS.', 'REMUX_PACKET_DTS');
      prefix.push(row); continue;
    }
    if (prefix.length) {
      let dts = rational(row.dts.numerator, row.dts.denominator);
      for (let i = prefix.length - 1; i >= 0; i--) { dts = sub(dts, rational(prefix[i].duration.numerator, prefix[i].duration.denominator)); prefix[i].dts = encoded(dts); }
      for (const held of prefix) yield held; prefix.length = 0;
    }
    seenDts = true; yield row;
  }
  need(prefix.length === 0, 'No concrete DTS anchors the leading reorder prefix.', 'REMUX_PACKET_DTS');
}
async function compareRemuxPackets(beforeCount, afterCount, sourceRows, outputRows, { signal, sourcePrefix = false, outputPrefix = false, audioTrim = null, exactTiming = false } = {}) {
  const a = packetDecodeClock(sourceRows, { allowPrefix: sourcePrefix, signal }), b = packetDecodeClock(outputRows, { allowPrefix: outputPrefix, signal });
  let count = 0, ptsError = rational(0), durationError = rational(0), dtsError = rational(0);
  const exact = (row, field) => rational(row[field].numerator, row[field].denominator);
  const trims = audioTrim && [createRemuxAudioTrim(audioTrim.source, audioTrim.sourceSamples, beforeCount, audioTrim.sourceFamily),
    createRemuxAudioTrim(audioTrim.output, audioTrim.outputSamples, afterCount, audioTrim.outputFamily)];
  try {
    while (true) {
      need(!signal?.aborted, 'Packet comparison cancelled.', 'CANCELLED');
      const av = await a.next(), bv = await b.next();
      need(av.done === bv.done, `Packet count changed at packet ${count}.`, 'REMUX_PACKET_COUNT');
      if (av.done) break;
      const ar = av.value, br = bv.value, at = ` at packet ${count}`;
      need(ar.size === br.size, 'Compressed packet size changed' + at, 'REMUX_PACKET_SIZE');
      need(ar.hash === br.hash, 'Compressed packet payload changed, reordered or duplicated' + at, 'REMUX_PACKET_PAYLOAD');
      need(ar.key === br.key, 'Packet key flag changed' + at, 'REMUX_PACKET_KEY_FLAG');
      if (trims) { trims[0].push(ar); trims[1].push(br); }
      else need(ar.discard === br.discard && ar.sideSha256 === br.sideSha256, 'Packet discard/priming/side metadata changed' + at, 'REMUX_PACKET_SIDE_DATA');
      for (const field of ['pts', 'dts', 'duration']) {
        if (ar[field].numerator === br[field].numerator && ar[field].denominator === br[field].denominator) continue;
        const error = abs(sub(exact(ar, field), exact(br, field)));
        need(!exactTiming || error.n === 0n, `Transport packet ${field} changed` + at, 'REMUX_TS_PACKET_IDENTITY');
        need(!greater(error, PACKET_TOLERANCE), `Packet ${field} exceeds 1/500s` + at, 'REMUX_PACKET_TIMING');
        if (field === 'pts' && greater(error, ptsError)) ptsError = error;
        if (field === 'dts' && greater(error, dtsError)) dtsError = error;
        if (field === 'duration' && greater(error, durationError)) durationError = error;
      }
      if ((++count & 4095) === 0) await yieldIO();
    }
    need(count === beforeCount && count === afterCount, `Incomplete packet coverage at packet ${count}.`, 'REMUX_PACKET_COUNT');
    const effective = trims && { source: trims[0].finish(), output: trims[1].finish() };
    if (effective) need(effective.source.leadingSamples === effective.output.leadingSamples && effective.source.trailingSamples === effective.output.trailingSamples,
      'Effective leading samples or trailing audio padding changed.', 'REMUX_AUDIO_TRIM');
    return { complete: true, comparedUnits: String(count), maxPtsError: encoded(ptsError), maxDurationError: encoded(durationError), maxDtsError: encoded(dtsError),
      ...(effective ? { audioTrim: effective } : {}) };
  } finally { await a.return(); await b.return(); }
}

// Incremental, strict FFprobe JSON-array reader. It retains one bounded object,
// never the entire array. The original JSON argv and native record contents are
// unchanged. Reject duplicate/unknown outer sections, bad UTF-8 and partial EOF.
function createRemuxJsonSink(key, { maxRecords, maxRecordBytes = 8 * 1024 * 1024, onRecord, onAuxRecord = null }) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let state = 'root', field = '', token = '', tokenBytes = 0, depth = 0, quoted = false, escaped = false;
  let count = 0, auxCount = 0, maximumRetainedBytes = 0, selected = false;
  const seen = new Set(), ws = c => /[\x20\t\r\n]/.test(c);
  const syntax = condition => need(condition, 'Missing, unexpected or excessive complete probe records; incomplete or malformed JSON.', 'REMUX_EVIDENCE_INVALID');
  function append(text) {
    tokenBytes += Buffer.byteLength(text); maximumRetainedBytes = Math.max(maximumRetainedBytes, tokenBytes);
    need(tokenBytes <= maxRecordBytes, 'A native JSON record exceeds its byte ceiling.', 'REMUX_PROPORTIONAL_BUDGET'); token += text;
  }
  async function consume(text) {
    for (let i = 0; i < text.length;) {
      const c = text[i];
      if (state === 'object') {
        const start = i;
        for (; i < text.length; i++) {
          const ch = text[i];
          if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
          else if (ch === '"') quoted = true;
          else if (ch === '{' || ch === '[') { depth++; need(depth <= 64, 'Native JSON nesting exceeded its bound.', 'REMUX_PROPORTIONAL_BUDGET'); }
          else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { i++; break; } }
        }
        append(text.slice(start, i));
        if (depth === 0) {
          let record; try { record = JSON.parse(token); } catch { fail('Malformed native JSON record.'); }
          syntax(plain(record));
          if (field === key) {
            need(++count <= maxRecords, 'Excessive native record count exceeds the source-derived limit.', 'REMUX_PROPORTIONAL_BUDGET');
            await onRecord(record);
          } else { need(++auxCount <= 32, 'Excessive codec header records.', 'REMUX_PROPORTIONAL_BUDGET'); await onAuxRecord(record); }
          token = ''; tokenBytes = 0; state = 'item-separator';
        }
        continue;
      }
      if (state !== 'key-text' && ws(c)) { i++; continue; }
      if (state === 'root') { syntax(c === '{'); state = 'key-or-end'; }
      else if (state === 'key-or-end' && c === '}') { syntax(selected); state = 'end'; }
      else if (state === 'key' || state === 'key-or-end') { syntax(c === '"'); token = '"'; state = 'key-text'; }
      else if (state === 'key-text') {
        // FFprobe emits literal ASCII section names. Escapes cannot conceal a
        // second spelling of a section, and section names are structural data.
        syntax(/[A-Za-z_]/.test(c) || c === '"'); token += c; syntax(token.length <= 64);
        if (c === '"') {
          field = JSON.parse(token); syntax(!seen.has(field) && (field === key || (key === 'streams' || onAuxRecord) && ['programs', 'stream_groups'].includes(field)
            || onAuxRecord && field === 'streams'));
          seen.add(field); selected ||= field === key; token = ''; state = 'colon';
        }
      } else if (state === 'colon') { syntax(c === ':'); state = 'array'; }
      else if (state === 'array') { syntax(c === '['); state = 'item-or-end'; }
      else if ((state === 'item-or-end' || state === 'item') && c === '{') {
        syntax(field === key || onAuxRecord && field === 'streams'); token = ''; tokenBytes = 0; depth = 0; quoted = false; escaped = false; state = 'object'; continue;
      } else if (state === 'item-or-end' && c === ']') state = 'root-separator';
      else if (state === 'item-separator') { syntax(c === ',' || c === ']'); state = c === ',' ? 'item' : 'root-separator'; }
      else if (state === 'root-separator') { syntax(c === ',' || c === '}'); state = c === ',' ? 'key' : 'end'; }
      else syntax(false);
      i++;
    }
  }
  return {
    async push(chunk) {
      need(Buffer.isBuffer(chunk), 'Native JSON requires byte chunks.');
      for (let offset = 0; offset < chunk.length; offset += 65536) {
        let text; try { text = decoder.decode(chunk.subarray(offset, offset + 65536), { stream: true }); } catch { fail('Invalid UTF-8 in native JSON.'); }
        await consume(text); await yieldIO();
      }
    },
    async finish() { let text; try { text = decoder.decode(); } catch { fail('Incomplete UTF-8 in native JSON.'); } await consume(text); syntax(state === 'end' && selected && (!onAuxRecord || seen.has('streams'))); return { count, maximumRetainedBytes }; },
  };
}
function createLineSink(onLine, maximum = 2048) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); let pending = '';
  async function consume(text) {
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      const line = pending + text.slice(start, end); pending = ''; start = end + 1;
      need(Buffer.byteLength(line) <= maximum, 'Native line exceeds its structural limit.', 'REMUX_PROPORTIONAL_BUDGET');
      await onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    }
    pending += text.slice(start); need(Buffer.byteLength(pending) <= maximum, 'Unterminated native line exceeds its limit.', 'REMUX_PROPORTIONAL_BUDGET');
  }
  return { async push(chunk) { for (let i = 0; i < chunk.length; i += 65536) {
    let text; try { text = decoder.decode(chunk.subarray(i, i + 65536), { stream: true }); } catch { fail('Invalid native UTF-8.'); } await consume(text);
  } }, async finish() { let text; try { text = decoder.decode(); } catch { fail('Incomplete native UTF-8.'); } await consume(text); need(pending === '', 'Incomplete native line.'); } };
}
const ROW_FIELDS = Object.freeze(['pts', 'duration', 'step', 'units']), RATIO_FIELDS = Object.freeze(['numerator', 'denominator']);
function exactRowData(value, fields) {
  return plain(value) && Reflect.ownKeys(value).length === fields.length && fields.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key); return d?.enumerable && own(d, 'value');
  });
}
function decodeRemuxTimelineRow(row) {
  need(exactRowData(row, ROW_FIELDS) && Number.isSafeInteger(row.units) && row.units > 0,
    'Invalid private timeline row units.', 'REMUX_EVIDENCE_CHANGED');
  const result = { units: row.units };
  for (const key of ['pts', 'duration', 'step']) {
    const value = row[key];
    need(exactRowData(value, RATIO_FIELDS) && typeof value.numerator === 'string' && /^-?\d{1,40}$/.test(value.numerator)
      && typeof value.denominator === 'string' && /^[1-9]\d{0,39}$/.test(value.denominator), 'Invalid private timeline rational.', 'REMUX_EVIDENCE_CHANGED');
    result[key] = { n: BigInt(value.numerator), d: BigInt(value.denominator) };
  }
  need(result.duration.n > 0n && result.step.n > 0n, 'Invalid private timeline extent.', 'REMUX_EVIDENCE_CHANGED');
  return result;
}
async function compareRemuxTimelines(beforeCount, afterCount, sourceRows, outputRows, { signal } = {}) {
    need(beforeCount === afterCount, 'Every complete decoded/event unit must remain present.');
    need(Number.isSafeInteger(beforeCount) && beforeCount >= 0, 'Exact complete unit count is required.');
    const a = sourceRows[Symbol.asyncIterator](), b = outputRows[Symbol.asyncIterator](); let ao = 0, bo = 0, compared = 0, ptsError = rational(0), durationError = rational(0);
    try {
      let av = await a.next(), bv = await b.next();
      while (!av.done && !bv.done) {
        need(!signal?.aborted, 'Remux timestamp comparison cancelled.', 'CANCELLED'); const ar = decodeRemuxTimelineRow(av.value), br = decodeRemuxTimelineRow(bv.value), units = Math.min(ar.units - ao, br.units - bo);
        need(units > 0 && Number.isSafeInteger(compared + units) && compared + units <= beforeCount,
          'Private timeline units exceed complete coverage.', 'REMUX_EVIDENCE_CHANGED');
        // Equal exact rationals need no temporary reduction. Video compares
        // its single endpoint once; audio still proves both affine endpoints
        // of every joined segment, including all sample PTS and durations.
        for (const offset of units === 1 ? [0] : [0, units - 1]) {
          const ap = ao + offset === 0 ? ar.pts : add(ar.pts, rational(ar.step.n * BigInt(ao + offset), ar.step.d));
          const bp = bo + offset === 0 ? br.pts : add(br.pts, rational(br.step.n * BigInt(bo + offset), br.step.d));
          if (ap.n * bp.d !== bp.n * ap.d) { const error = abs(sub(ap, bp)); if (greater(error, ptsError)) ptsError = error; }
        }
        if (ar.step.n * br.step.d !== br.step.n * ar.step.d) { const error = abs(sub(ar.step, br.step)); if (greater(error, durationError)) durationError = error; }
        compared += units; ao += units; bo += units;
        if (ao === ar.units) { av = await a.next(); ao = 0; } if (bo === br.units) { bv = await b.next(); bo = 0; }
        if ((compared & 4095) === 0) await yieldIO();
      }
      need(!signal?.aborted, 'Remux timestamp comparison cancelled.', 'CANCELLED');
      need(av.done && bv.done && compared === beforeCount, 'Incomplete per-unit timestamp comparison.');
      return { complete: true, comparedUnits: String(compared), maxPtsError: encoded(ptsError), maxDurationError: encoded(durationError) };
    } finally { await a.return(); await b.return(); }
  }

async function binding(file, directory = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && !/[\0\r\n]/.test(file), 'Exact absolute ordinary paths are required.', 'REMUX_EVIDENCE_PATH');
  await assertOrdinaryPath(file, directory ? 'directory' : 'file'); const stat = await fs.lstat(file, { bigint: true });
  need(stat.dev !== 0n && stat.ino !== 0n && (directory || stat.nlink === 1n), 'Unknown identity or multiply linked evidence path.', 'REMUX_EVIDENCE_PATH'); return stat;
}
async function unchanged(file, prior, directory = false) {
  const after = await binding(file, directory); need(directory ? sameObject(prior, after) : same(prior, after), 'Selected source, output or evidence path changed.', 'REMUX_EVIDENCE_CHANGED'); return after;
}
// The four boundary checks share most ancestors. Recheck every ancestor on
// every call, but observe a shared directory once within THIS pass, in bounded
// batches. Keep canonical-name, ordinary-kind and final leaf identity checks.
async function checkRemuxBindings(entries, io = fs) {
  const ancestors = new Map();
  for (const { file, directory = false } of entries) {
    need(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file && !/[\0\r\n]/.test(file),
      'Exact absolute ordinary paths are required.', 'REMUX_EVIDENCE_PATH');
    const root = path.parse(file).root, pieces = path.relative(root, file).split(path.sep).filter(Boolean); let current = root;
    for (let index = 0; index <= pieces.length; index++) {
      if (index) current = path.join(current, pieces[index - 1]);
      const type = index === pieces.length && !directory ? 'file' : 'directory';
      if (!ancestors.has(current)) ancestors.set(current, new Set()); ancestors.get(current).add(type);
    }
  }
  const nodes = [...ancestors];
  for (let at = 0; at < nodes.length; at += 8) {
    const results = await Promise.allSettled(nodes.slice(at, at + 8).map(async ([file, types]) => {
      const stat = await io.lstat(file, { bigint: true });
      need(!stat.isSymbolicLink() && [...types].every(type => type === 'file' ? stat.isFile() : stat.isDirectory()),
        'A Remux path contains a link/reparse point or unexpected entry type.', 'REMUX_EVIDENCE_PATH');
    }));
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  }
  const results = await Promise.allSettled(entries.map(async ({ file, stat: before, directory = false }) => {
    const resolved = await io.realpath(file), comparable = text => process.platform === 'win32' ? text.toLowerCase() : text;
    need(comparable(resolved) === comparable(file), 'A Remux path has a redirected ancestor.', 'REMUX_EVIDENCE_PATH');
    const after = await io.lstat(file, { bigint: true });
    need(!after.isSymbolicLink() && (directory ? after.isDirectory() : after.isFile()) && after.dev !== 0n && after.ino !== 0n
      && (directory || after.nlink === 1n), 'Unknown identity or multiply linked evidence path.', 'REMUX_EVIDENCE_PATH');
    need(directory ? sameObject(before, after) : same(before, after), 'Selected source, output or evidence path changed.', 'REMUX_EVIDENCE_CHANGED');
  }));
  const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
}
const linuxVerificationLimits = new WeakMap();
const REMUX_VERIFICATION_CANCELLED_MESSAGE = 'The copy was cancelled before verification finished. No copy was saved.';
function errorData(error) {
  const limit = linuxVerificationLimits.get(error);
  return { code: String(error?.code || 'REMUX_EVIDENCE_FAILED').slice(0, 128), message: String(error?.message || error).slice(0, 2000),
  ...(limit ? { verificationLimit: limit } : {}),
  ...(error?.cause ? { cause: { code: String(error.cause.code || 'ERROR').slice(0, 128), message: String(error.cause.message || error.cause).slice(0, 2000) } } : {}) }; }
function describeLinuxRemuxPipeLimit(error, label) {
  if (!(error instanceof ToolError) || error.code !== 'REMUX_LINUX_CHILD_STDOUT_LIMIT'
      || !Number.isSafeInteger(error.limitBytes) || error.limitBytes <= 0
      || !Number.isSafeInteger(error.requestedBytes) || error.requestedBytes <= error.limitBytes) return error;
  // The collector's own label, not the path or a child diagnostic, identifies
  // the complete check. This is a forecast refusal, not measured bytes or
  // corruption. Keep exact counts in the receipt and no paths in the message.
  const role = /^(source|output)-\d+-(complete-parameters|native-audio)$/.exec(label);
  if (!role) return error;
  const side = role[1], h264 = role[2] === 'complete-parameters', check = h264 ? 'h264' : 'pcm';
  const code = 'REMUX_LINUX_' + side.toUpperCase() + (h264 ? '_H264_LIMIT' : '_AAC_PCM_LIMIT');
  const part = side === 'source' ? 'source' : 'temporary copy’s';
  const media = h264 ? 'video (H.264)' : 'decoded AAC audio';
  const limit = error.limitBytes === 1024 ** 3 ? '1 GiB' : error.limitBytes + ' byte';
  const message = `The verification request exceeds this Linux build’s ${limit} limit for the ${part} ${media}. No copy was saved. Try a ${h264 ? 'smaller' : 'shorter'} source.`;
  const refusal = new ToolError(code, message);
  linuxVerificationLimits.set(refusal, Object.freeze({ side, check, requestedBytes: error.requestedBytes, limitBytes: error.limitBytes }));
  return refusal;
}

async function collectRemuxEvidence(options) {
  need(plain(options), 'A main-owned collector request is required.');
  need(options.onProgress === undefined || typeof options.onProgress === 'function', 'Evidence progress requires a main-owned callback.');
  const { assessment, runtimeIdentity, outputId, sourceProbe, outputProbe, sourcePath, outputPath, stageDirectory, ffmpeg, ffprobe, run, signal } = options;
  if (assessment?.inputFamily === 'mp3') {
    const observed = getRemuxMp3Source(assessment);
    const { budget } = deriveRemuxAssessmentBudget(assessment, observed.size, options.verificationMethod);
    need(isDeepStrictEqual(options.budget, budget), 'MP3 evidence requires its exact source-derived budget.');
    const { collectMp3RemuxEvidence } = require('./remux-mp3-evidence.cjs');
    const result = freeze(await collectMp3RemuxEvidence(options));
    if (result.status === 'completed') {
      receipts.set(result, { assessment, runtimeIdentity, outputId: outputId.toLowerCase(), essence: result.essenceEvidence, movRepresentation: null });
    }
    return result;
  }
  const verificationMethod = options.verificationMethod ?? 'complete-native-v1';
  need(['packet-identity-v1', 'complete-native-v1'].includes(verificationMethod), 'Unknown main-selected verification method.', 'REMUX_VERIFICATION_METHOD');
  const maximumChildren = options.maxConcurrentChildren ?? 1;
  need(maximumChildren === 1 || maximumChildren === 2 && verificationMethod === 'packet-identity-v1',
    'Only the main-owned packet verifier may use two children.', 'REMUX_EVIDENCE_RUNNER');
  const started = Date.now();
  const source = getRemuxAssessmentSource(assessment);
  // Legacy callers approve complete acquisition with the fixed configuration;
  // actual ceilings come only from this genuine assessment and current files.
  let budget = boundedBudget(options.budget, deriveRemuxAssessmentBudget(assessment, source.format.size || '1', verificationMethod).budget);
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
  budget = boundedBudget(options.budget, deriveRemuxAssessmentBudget(assessment, String(sourceBefore.size), verificationMethod).budget);
  need(sourceBefore.size > 0n && outputBefore.size > 0n && sourceBefore.size <= BigInt(budget.maxSourceBytes)
    && outputBefore.size <= BigInt(budget.maxOutputBytes), 'Selected file exceeds its source-derived source/output policy.', 'REMUX_EVIDENCE_LIMIT');
  const directory = await fs.mkdtemp(path.join(stageDirectory, 'remux-evidence-')), directoryBefore = await binding(directory, true);
  let spoolBytes = 0, active = 0; const owned = [];
  const transport = assessment.inputFamily === 'mpegts';
  need(!transport || verificationMethod === 'packet-identity-v1', 'TS requires compressed packet identity.', 'REMUX_VERIFICATION_METHOD');
  const receipt = { version: 1, status: 'collecting', verificationMethod, verificationClaim: remuxVerificationDescription(verificationMethod, assessment.inputFamily),
    scope: verificationMethod === 'packet-identity-v1' ? 'complete-compressed-remux-identity-and-timeline' : 'complete-native-remux-essence-and-timeline', directory,
    runtimeIdentity, outputId: outputId.toLowerCase(), sourcePath, outputPath, sourceProbeFingerprint, outputProbeFingerprint,
    sourceBefore: stamp(sourceBefore), outputBefore: stamp(outputBefore), sourceAfter: null, outputAfter: null,
    budget, spoolBytes: 0, artifacts: [], invocations: [], comparisons: [], essenceEvidence: null,
    profile: { pathChecks: 0, pathCheckMs: 0, syncs: 0, syncMs: 0, peakChildren: 0 },
    qualificationGranted: false, publicationAuthorized: false,
    limitations: ['Collection records actual differences; measured qualification and strict validation remain required.',
      'Subtitle support proves complete coded event and header identity, not rendered or decoded subtitle equivalence.'] };
  async function paths() {
    const start = performance.now(); receipt.profile.pathChecks++;
    try {
      if (verificationMethod === 'packet-identity-v1') await checkRemuxBindings([
        { file: stageDirectory, stat: stageBefore, directory: true }, { file: directory, stat: directoryBefore, directory: true },
        { file: sourcePath, stat: sourceBefore }, { file: outputPath, stat: outputBefore }]);
      else {
        const checks = await Promise.allSettled([unchanged(stageDirectory, stageBefore, true), unchanged(directory, directoryBefore, true),
          unchanged(sourcePath, sourceBefore), unchanged(outputPath, outputBefore)]);
        const failed = checks.find(check => check.status === 'rejected'); if (failed) throw failed.reason;
      }
    }
    finally { receipt.profile.pathCheckMs += performance.now() - start; }
  }
  async function sync(handle) {
    const start = performance.now(); receipt.profile.syncs++;
    try { await handle.sync(); } finally { receipt.profile.syncMs += performance.now() - start; }
  }
  const pendingSyncs = [];
  async function syncCompletedStreams() {
    // Intermediate private rows grant no validation authority. Keep every
    // fsync, but batch the completed files before either terminal receipt.
    // This avoids serial drive-flush latency after each tiny child artifact.
    const start = performance.now(); receipt.profile.deferredSyncs = pendingSyncs.length;
    for (let at = 0; at < pendingSyncs.length; at += 8) {
      const results = await Promise.allSettled(pendingSyncs.slice(at, at + 8).map(async held => {
        await unchanged(held.file, held.stat); const handle = await fs.open(held.file, 'r+');
        try {
          need(same(held.stat, await handle.stat({ bigint: true })), 'Deferred evidence sync opened a different object.', 'REMUX_EVIDENCE_CHANGED');
          await sync(handle);
          need(same(held.stat, await handle.stat({ bigint: true })), 'Evidence changed during deferred sync.', 'REMUX_EVIDENCE_CHANGED');
          await unchanged(held.file, held.stat);
        } finally { await handle.close(); }
      }));
      const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
    }
    receipt.profile.syncWallMs = performance.now() - start; pendingSyncs.length = 0;
  }
  async function persist(name, bytes, reserve = 16384) {
    await paths(); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    need(spoolBytes + bytes.length + reserve <= budget.maxSpoolBytes, 'Complete evidence spool ceiling exceeded.', 'REMUX_EVIDENCE_LIMIT');
    const file = path.join(directory, name), handle = await fs.open(file, 'wx');
    try {
      const created = await handle.stat({ bigint: true }); need(created.nlink === 1n, 'Owned receipt is multiply linked.');
      await handle.writeFile(bytes); await sync(handle); const final = await handle.stat({ bigint: true });
      need(sameObject(created, final) && final.nlink === 1n && final.size === BigInt(bytes.length) && same(final, await binding(file)), 'Owned receipt was replaced or changed.', 'REMUX_EVIDENCE_CHANGED');
      const artifact = { path: file, bytes: bytes.length, sha256: sha(bytes), identity: stamp(final) };
      owned.push({ file, stat: final }); spoolBytes += bytes.length; receipt.spoolBytes = spoolBytes; receipt.artifacts.push(artifact); return artifact;
    } finally { await handle.close(); }
  }
  let lastProgress = 0;
  function progress(stage, completed, total = null, force = false) {
    stop(); const now = Date.now();
    if (!force && now - lastProgress < 150) return;
    lastProgress = now;
    options.onProgress?.(Object.freeze({ stage, completed, total }));
  }
  // Exclusive, held, append-only evidence streams. Neither an artifact path nor
  // a renderer value grants read authority: only these closed private objects do.
  async function spool(name) {
    await paths(); const file = path.join(directory, name), handle = await fs.open(file, 'wx+');
    let created;
    try { created = await handle.stat({ bigint: true }); need(created.nlink === 1n && same(created, await binding(file)), 'Owned stream reservation changed.', 'REMUX_EVIDENCE_CHANGED'); }
    catch (error) { await handle.close(); throw error; }
    const hash = createHash('sha256'); let bytes = 0, closed = false;
    return {
      async write(chunk) {
        stop(); need(!closed && Buffer.isBuffer(chunk), 'Only a live evidence stream accepts bytes.');
        need(Number.isSafeInteger(spoolBytes + chunk.length) && spoolBytes + chunk.length + 16384 <= budget.maxSpoolBytes,
          'Source-derived evidence spool budget exceeded.', 'REMUX_PROPORTIONAL_BUDGET');
        // Reserve before any await so two drains cannot spend the same bytes.
        spoolBytes += chunk.length; receipt.spoolBytes = spoolBytes;
        let offset = 0;
        while (offset < chunk.length) { stop(); const result = await handle.write(chunk, offset, chunk.length - offset, bytes + offset); need(result.bytesWritten > 0, 'Incomplete owned evidence write.'); offset += result.bytesWritten; }
        hash.update(chunk); bytes += chunk.length;
      },
      async finish() {
        need(!closed, 'Evidence stream already closed.');
        try {
          if (verificationMethod !== 'packet-identity-v1') await sync(handle);
          const final = await handle.stat({ bigint: true });
          need(sameObject(created, final) && final.nlink === 1n && final.size === BigInt(bytes) && same(final, await binding(file)),
            'Owned evidence stream changed.', 'REMUX_EVIDENCE_CHANGED');
          const artifact = { path: file, bytes, sha256: hash.digest('hex'), identity: stamp(final) };
          owned.push({ file, stat: final }); receipt.artifacts.push(artifact);
          if (verificationMethod === 'packet-identity-v1') {
            // The fixed pipeline creates <=16 files per mapped stream plus16,
            // independently of packet count/length. No open handle is queued.
            pendingSyncs.push({ file, stat: final });
          }
          return { artifact, file, stat: final };
        } finally { closed = true; await handle.close(); }
      },
      async close() { if (!closed) { closed = true; await handle.close(); } },
    };
  }
  async function* rows(held) {
    await unchanged(held.file, held.stat); const handle = await fs.open(held.file, 'r'), buffer = Buffer.alloc(65536), hash = createHash('sha256');
    let offset = 0, pending = '';
    try {
      need(same(held.stat, await handle.stat({ bigint: true })), 'Evidence cursor opened a different object.', 'REMUX_EVIDENCE_CHANGED');
      while (offset < held.artifact.bytes) {
        stop(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, held.artifact.bytes - offset), offset);
        need(bytesRead > 0, 'Truncated evidence cursor.'); offset += bytesRead; hash.update(buffer.subarray(0, bytesRead));
        // Private spool rows are canonical ASCII integers/hashes only.
        const text = pending + buffer.subarray(0, bytesRead).toString('ascii'); let start = 0, end;
        while ((end = text.indexOf('\n', start)) !== -1) {
          const line = text.slice(start, end); need(line.length <= 2048, 'Oversized private evidence row.'); start = end + 1;
          yield JSON.parse(line);
        }
        pending = text.slice(start); need(pending.length <= 2048, 'Unterminated private evidence row.');
        progress('timestamp-comparison', offset, held.artifact.bytes);
      }
      need(!pending && hash.digest('hex') === held.artifact.sha256 && same(held.stat, await handle.stat({ bigint: true })),
        'Evidence cursor contents changed or were incomplete.', 'REMUX_EVIDENCE_CHANGED');
      await unchanged(held.file, held.stat);
    } finally { await handle.close(); }
  }
  async function invoke(label, executable, args, maxBytes, binary = false, probeQuery = null, consumer = null, auxiliary = null) {
    stop(); await paths(); need(active < maximumChildren, 'The main-owned evidence child ceiling is in use.'); active++;
    receipt.profile.peakChildren = Math.max(receipt.profile.peakChildren, active);
    const entry = { label, executable, args, status: 'running' }; receipt.invocations.push(entry);
    let bytes = 0, auxBytes = 0, outputSpool;
    // The raw video sink independently SHA256-checks EVERY bounded packet.
    // A second whole-pipe checksum has no additional identity authority.
    const hash = verificationMethod === 'packet-identity-v1' && label.endsWith('-complete-parameters') ? null : createHash('sha256');
    try {
      // The strict streaming parser retains every admitted packet field in
      // SHA-bound private rows. Keep the complete stdout byte/hash receipt,
      // without a redundant second copy of the large metadata JSON. Native
      // fallback and all other text captures retain their original artifacts.
      if (!binary && (verificationMethod !== 'packet-identity-v1' || !label.endsWith('-all-packets')))
        outputSpool = await spool(`child-${receipt.invocations.length}.stdout`);
      progress(label, 0, maxBytes, true);
      const result = await run(executable, args, { signal, timeoutMs: budget.timeoutMs, stdoutLimit: auxiliary ? Math.max(maxBytes, auxiliary.maxBytes) : maxBytes, stderrLimit: 256 * 1024,
        onStdoutChunk: async (chunk, pipe = 1) => { stop(); need(Buffer.isBuffer(chunk), 'The runner must drain binary stdout chunks.');
          if (pipe === 3 && auxiliary) {
            auxBytes += chunk.length;
            need(Number.isSafeInteger(auxBytes) && auxBytes <= auxiliary.maxBytes, 'Parameter pipe exceeded its proportional budget.', 'REMUX_PROPORTIONAL_BUDGET');
            await auxiliary.sink.push(chunk); return;
          }
          need(pipe === 1, 'Unexpected binary evidence channel.', 'REMUX_EVIDENCE_RUNNER'); bytes += chunk.length;
          need(Number.isSafeInteger(bytes) && bytes <= maxBytes, 'Evidence pipe exceeded its source-derived byte ceiling.', 'REMUX_PROPORTIONAL_BUDGET'); hash?.update(chunk);
          if (outputSpool) await outputSpool.write(chunk);
          await consumer?.push(chunk); progress(label, bytes, maxBytes); } });
      entry.exitCode = result?.exitCode ?? null; entry.stdoutCapture = result?.stdoutCapture ?? null;
      entry.stderrCapture = result?.stderrCapture ?? null;
      if (auxiliary) {
        entry.auxCapture = result?.auxCapture ?? null;
        need(result?.auxCapture?.streamed === true && result.auxCapture.truncated === false && result.auxCapture.totalBytes === auxBytes,
          'Complete drained auxiliary parameter capture is required.', 'REMUX_EVIDENCE_RUNNER');
      }
      entry.stderr = typeof result?.stderr === 'string' ? result.stderr.slice(-8192) : null;
      if (verificationMethod === 'packet-identity-v1' && label.endsWith('-native-audio')
        && /Changing audio frame properties on the fly is not supported\./.test(result?.stderr || ''))
        fail('Complete native audio changed format/rate/layout with filter reinitialization disabled.', 'REMUX_AUDIO_PARAMETERS_CHANGED');
      stop(); need(result?.exitCode === 0 && result.stdout === '' && result.stdoutCapture?.streamed === true
        && result.stdoutCapture.truncated === false && result.stdoutCapture.totalBytes === bytes,
      'Complete drained binary stdout capture is required.', 'REMUX_EVIDENCE_RUNNER');
      const cleanDiagnostics = result.stderr === '' && result.stderrCapture?.truncated === false && result.stderrCapture.totalBytes === 0;
      if (label.endsWith('-complete-parameters') && !cleanDiagnostics)
        fail('Complete H264 header validation reported an error or skipped syntax.', 'REMUX_H264_HEADER_SYNTAX');
      const diagnosticAssessment = cleanDiagnostics ? null : assessProbeDiagnostics(result, executable, args, probeQuery);
      need(cleanDiagnostics || diagnosticAssessment,
        'Warnings, errors or incomplete diagnostics refuse complete collection.', 'REMUX_EVIDENCE_DECODE');
      if (diagnosticAssessment) entry.diagnosticAssessment = diagnosticAssessment;
      await paths(); entry.status = 'completed'; entry.bytes = bytes; entry.sha256 = hash?.digest('hex') || null; entry.stderrCapture = result.stderrCapture;
      const summary = await consumer?.finish();
      const auxiliarySummary = await auxiliary?.sink.finish();
      if (outputSpool) entry.artifact = (await outputSpool.finish()).artifact;
      progress(label, bytes, bytes, true); return { bytes, sha256: entry.sha256, summary, auxiliarySummary };
    } catch (original) {
      const error = verificationMethod === 'packet-identity-v1' && !transport && !signal?.aborted
        ? describeLinuxRemuxPipeLimit(original, label) : original;
      entry.status = 'failed'; entry.failure = errorData(error);
      if (label.endsWith('-complete-parameters') && error.code === 'TOOL_FAILED')
        throw new ToolError('REMUX_H264_HEADER_SYNTAX', 'FFmpeg CBS refused a complete H264 NAL/slice header.', { cause: error,
          stderr: error.stderr, stderrCapture: error.stderrCapture, exitCode: error.exitCode });
      if (typeof error?.stderr === 'string') { entry.stderr = error.stderr.slice(-8192); entry.stderrCapture = error.stderrCapture ?? null; }
      if (error?.stdoutCapture) entry.stdoutCapture = error.stdoutCapture;
      if (verificationMethod === 'packet-identity-v1' && label.endsWith('-native-audio')
        && /Changing audio frame properties on the fly is not supported\./.test(error?.stderr || ''))
        throw new ToolError('REMUX_AUDIO_PARAMETERS_CHANGED', 'Complete native audio changed format/rate/layout with filter reinitialization disabled.', { cause: error,
          stderr: error.stderr, stderrCapture: error.stderrCapture, stdoutCapture: error.stdoutCapture, exitCode: error.exitCode, exitSignal: error.exitSignal });
      if (error.code === 'OUTPUT_LIMIT' || error.code === 'STDOUT_SINK_FAILED' && error.cause?.code === 'REMUX_PROPORTIONAL_BUDGET')
        throw new ToolError('REMUX_PROPORTIONAL_BUDGET', error.cause?.message || error.message, { cause: error,
          stderr: error.stderr, stderrCapture: error.stderrCapture, stdoutCapture: error.stdoutCapture, exitCode: error.exitCode, exitSignal: error.exitSignal });
      if (verificationMethod === 'packet-identity-v1' && error.code === 'STDOUT_SINK_FAILED' && /^REMUX_|^CANCELLED$/.test(error.cause?.code || ''))
        throw new ToolError(error.cause.code, error.cause.message, { cause: error, stderr: error.stderr, stderrCapture: error.stderrCapture,
          stdoutCapture: error.stdoutCapture, auxCapture: error.auxCapture, exitCode: error.exitCode, exitSignal: error.exitSignal });
      throw error;
    }
    finally { await outputSpool?.close(); active--; }
  }
  const probeArgs = (file, index) => ['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-select_streams', String(index)];
  const ffmpegArgs = (file, index) => ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-xerror', '-threads', '1',
    '-protocol_whitelist', 'file,pipe', '-copyts', '-noautorotate', '-i', file, '-map', `0:${index}`];
  const probeQueries = new Map([
    ['frames', ['-show_frames']],
    ['packets', ['-show_packets', '-show_data_hash', 'sha256']],
    ['header', ['-show_streams', '-show_data_hash', 'sha256', '-show_entries',
      'stream=index,codec_type,codec_name,extradata_size,extradata_hash:stream_tags']],
    ['extradata', ['-show_streams', '-show_data', '-show_entries', 'stream=extradata:stream_tags=:stream_disposition=']],
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
    if (kind === 'all-packets') {
      const media = side === 'source' ? source : output, indexKey = side === 'source' ? 'inputIndex' : 'outputIndex';
      const match = /^Unsupported codec with id 98304 for input stream (0|[1-9]\d*)\r?\n$/.exec(result.stderr);
      if (!side || !match || match[0] !== result.stderr || JSON.stringify(args) !== JSON.stringify(['-v', 'warning',
        '-protocol_whitelist', 'file,pipe', '-show_packets', '-show_streams', '-of', 'json', '-i', file])) return null;
      const attachment = media.streams.find(s => s.index === Number(match[1]));
      if (!attachment || attachment.codec_type !== 'attachment' || attachment.codec_name !== 'ttf'
        || !PACKET_HASH.test(String(attachment.extradata_hash)) || !Number.isSafeInteger(attachment.extradata_size) || attachment.extradata_size <= 0
        || !mappings.some(m => m[indexKey] === attachment.index && m.codecType === 'attachment' && m.codecName === 'ttf' && m.action === 'preserve-copy')) return null;
      return { code: 'FFPROBE_TTF_ATTACHMENT_DECODER_DISCOVERY', disposition: 'expected-ttf-attachment-discovery-diagnostic',
        probeQuery: kind, diagnosticStreamIndex: attachment.index, attachmentEvidenceRequired: true };
    }
    const query = probeQueries.get(kind), av = ['video', 'audio'].includes(stream.codec_type);
    const subtitle = stream.codec_type === 'subtitle' && ['subrip', 'ass'].includes(stream.codec_name);
    const selectedTtf = stream.codec_type === 'attachment' && stream.codec_name === 'ttf';
    if (!side || !query || (kind === 'frames' ? !av : kind === 'packets' ? !av && !subtitle : !av && !subtitle && !selectedTtf)
        || JSON.stringify(args) !== JSON.stringify([...probeArgs(file, stream.index), ...query, '-of',
          kind === 'extradata' ? 'default=noprint_wrappers=1:nokey=1' : 'json', '-i', file])) return null;
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
  async function json(label, file, stream, extra, key, onRecord, maximum = budget.maxRecords) {
    const sink = createRemuxJsonSink(key, { maxRecords: maximum, maxRecordBytes: budget.maxFrameBytes, onRecord });
    const result = await invoke(label, ffprobe, [...probeArgs(file, stream.index), ...extra, '-of', 'json', '-i', file], budget.maxTextBytes,
      false, { file, stream, kind: key === 'streams' ? 'header' : key }, sink);
    return result.summary;
  }
  async function packets(file, stream, label, onPacket = null) {
    const hash = createHash('sha256'); hash.update('['); let count = 0;
    await json(`${label}-packets`, file, stream, ['-show_packets', '-show_data_hash', 'sha256'], 'packets', async packet => {
      need(packet.stream_index === stream.index && PACKET_HASH.test(String(packet.data_hash)), 'Missing complete coded packet payload SHA256.');
      integer(packet.size, 'Complete coded packet bytes', 1n);
      if (count++) hash.update(','); hash.update(JSON.stringify({ bytes: String(packet.size), sha256: packet.data_hash.toLowerCase() }));
      await onPacket?.(packet);
    });
    need(stream.codec_type === 'subtitle' || count > 0, 'Complete video packets are missing.');
    hash.update(']'); return { count, seal: hash.digest('hex') };
  }
  async function header(file, stream, label) {
    let actual;
    const summary = await json(`${label}-header`, file, stream, ['-show_streams', '-show_data_hash', 'sha256', '-show_entries',
      'stream=index,codec_type,codec_name,extradata_size,extradata_hash:stream_tags'], 'streams', record => { actual = record; }, 1);
    need(summary.count === 1, 'Exactly one complete native codec header is required.');
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
  async function rowSpool(name) {
    const writer = await spool(name); let pending = '', bytes = 0;
    return { async write(row) { const text = JSON.stringify(row) + '\n'; need(text.length <= 2048, 'Private timeline row exceeds its structural bound.');
      pending += text; bytes += text.length;
      if (bytes >= 65536) { await writer.write(Buffer.from(pending)); pending = ''; bytes = 0; }
    }, async finish() { if (bytes) await writer.write(Buffer.from(pending)); pending = ''; return writer.finish(); }, close: () => writer.close() };
  }
  async function timelineBuilder(stream, label, side, subtitleHeader = null, remainingPcmBytes = budget.maxPcmBytes) {
    const writer = await rowSpool(label + '.timeline'), metadata = createHash('sha256');
    if (subtitleHeader) metadata.update(subtitleHeader);
    let count = 0, frameCount = 0, first = null, last = null, previousPts = null, firstStep = null, differingStep = null;
    let opaqueSideData = (stream.side_data_list || []).some(item => Object.keys(item).every(key => key === 'side_data_type'));
    return {
      async push(frame) {
        stop();
        if (!subtitleHeader) nativeFrames([frame], stream);
        const pts = time(frame.pts ?? frame.best_effort_timestamp, stream), extent = duration(frame, stream);
        const units = stream.codec_type === 'audio' ? Number(integer(frame.nb_samples, 'Decoded sample count', 1n)) : 1;
        need(Number.isSafeInteger(units) && Number.isSafeInteger(count + units), 'Decoded count exceeds exact representation.');
        if (stream.codec_type === 'audio') {
          // Refuse crafted enormous nb_samples before doing per-sample metadata
          // work, rather than waiting until the following PCM byte check.
          need(BigInt(count + units) <= integer(stream.sample_rate, 'Native sample rate', 1n) * BigInt(budget.maxDurationSeconds),
            'Complete native sample count exceeds its source-derived duration.', 'REMUX_EVIDENCE_LIMIT');
          const precision = pcmRepresentation(stream);
          need(BigInt(count + units) * BigInt(stream.channels * precision.bytesPerSample) <= BigInt(remainingPcmBytes),
            'Complete PCM exceeds its source-derived per-file byte ceiling.', 'REMUX_EVIDENCE_LIMIT');
        }
        const step = stream.codec_type === 'audio' ? rational(1, integer(stream.sample_rate, 'Native sample rate', 1n)) : extent;
        if (stream.codec_type === 'video' && previousPts) {
          const delta = sub(pts, previousPts); need(delta.n > 0n, 'Complete video frame presentation timestamps must be strictly increasing.');
          if (!firstStep) firstStep = delta; else if (sub(firstStep, delta).n !== 0n && !differingStep) differingStep = delta;
        }
        const native = subtitleHeader ? '{}\n' : JSON.stringify(nativeMetadata(frame, stream.codec_type, stream)) + '\n';
        // The identical historical per-sample digest, batched into <=64KiB
        // updates; periodic yielding keeps cancellation/timers prompt even for
        // injected unusually large decoded audio frames.
        const repetitions = Math.max(1, Math.floor(65536 / Buffer.byteLength(native)));
        const block = Buffer.from(native.repeat(Math.min(repetitions, units))); let remaining = units, hashed = 0;
        while (remaining) {
          stop(); const take = Math.min(remaining, repetitions);
          metadata.update(take === repetitions ? block : Buffer.from(native.repeat(take))); remaining -= take; hashed += take * Buffer.byteLength(native);
          if (hashed >= 4 * 1024 * 1024) { hashed = 0; progress(label + '-metadata', count + units - remaining); await yieldIO(); }
        }
        await writer.write({ pts: encoded(pts), duration: encoded(extent), step: encoded(step), units });
        count += units; frameCount++; first ||= pts; last = { pts, duration: extent }; previousPts = pts;
        opaqueSideData ||= (frame.side_data_list || []).some(item => Object.keys(item).every(key => key === 'side_data_type'));
        if ((frameCount & 4095) === 0) { progress(label, frameCount, budget.maxRecords); await yieldIO(); }
      },
      async finish(contentSha256, kind) {
        const end = last && add(last.pts, last.duration);
        need(subtitleHeader || count > 0, 'Complete stream unexpectedly decoded no frames.');
        if (count) need(greater(end, first), 'The complete native interval must have positive extent.');
        const resourceDuration = side === 'output' && stream.codec_type === 'audio'
          ? rational(count, integer(stream.sample_rate, 'Native sample rate', 1n)) : count ? sub(end, first) : rational(0);
        need(!greater(resourceDuration, rational(budget.maxDurationSeconds)), 'Actual complete decoded extent exceeds the source-derived policy.', 'REMUX_EVIDENCE_LIMIT');
        const held = await writer.finish();
        return { count, frameCount, held, opaqueSideData, ...(kind ? { kind } : {}), record: {
          complete: true, exitCode: 0, stderrComplete: true, errors: [],
          representation: subtitleHeader ? 'subtitle-events-v1' : stream.codec_type === 'video' ? 'native-video-v1' : 'native-audio-v1',
          contentSha256, metadataSha256: metadata.digest('hex'), unitCount: String(count),
          firstPts: first && encoded(first), endPts: end && encoded(end),
          ...(stream.codec_type === 'video' ? { cadence: { version: 1,
            classification: !firstStep ? 'insufficient' : differingStep ? 'variable' : 'constant', intervalCount: String(frameCount - 1),
            firstStep: firstStep && encoded(firstStep), differingStep: differingStep && encoded(differingStep) } } : {}) } };
      }, get count() { return count; }, get frameCount() { return frameCount; }, close: () => writer.close(),
    };
  }
  async function pcmSink(label) {
    const writer = await rowSpool(label + '.pcm-windows'); let window = createHash('sha256'), inWindow = 0, bytes = 0;
    const emit = async () => { await writer.write({ offset: bytes - inWindow, bytes: inWindow, sha256: window.digest('hex') }); window = createHash('sha256'); inWindow = 0; };
    return { async push(chunk) {
      for (let offset = 0; offset < chunk.length;) { stop(); const take = Math.min(chunk.length - offset, 1024 * 1024 - inWindow);
        window.update(chunk.subarray(offset, offset + take)); offset += take; bytes += take; inWindow += take;
        if (inWindow === 1024 * 1024) await emit();
      }
    }, async finish() { if (inWindow) await emit(); return writer.finish(); }, close: () => writer.close() };
  }
  async function comparePcmWindows(before, after) {
    if (!before.pcmWindows || !after.pcmWindows) return null;
    const a = rows(before.pcmWindows), b = rows(after.pcmWindows); let firstMismatchByte = null, windows = 0;
    try {
      let av = await a.next(), bv = await b.next();
      while (!av.done || !bv.done) {
        stop(); const ar = av.value, br = bv.value;
        if (firstMismatchByte === null && (av.done || bv.done || ar.offset !== br.offset || ar.bytes !== br.bytes || ar.sha256 !== br.sha256))
          firstMismatchByte = ar?.offset ?? br.offset;
        windows++; if (!av.done) av = await a.next(); if (!bv.done) bv = await b.next();
      }
      return { windowBytes: 1024 * 1024, comparedWindows: windows, firstMismatchByte };
    } finally { await a.return(); await b.return(); }
  }
  const collections = { source: new Map(), output: new Map() };
  const codecAdmission = { source: new Map(), output: new Map() };
  const outputFamily = assessment.target === 'matroska' ? 'matroska' : 'isobmff';
  const semanticAudio = type => type === 'audio' && assessment.inputFamily !== outputFamily;
  async function eachSide(action) {
    const sides = [['source', sourcePath, source], ['output', outputPath, output]];
    if (maximumChildren === 1) { for (const side of sides) await action(...side); return; }
    const results = await Promise.allSettled(sides.map(side => action(...side)));
    const failures = results.filter(result => result.status === 'rejected');
    const primary = failures.find(result => result.reason?.code !== 'CANCELLED') || failures[0];
    if (primary) throw primary.reason;
  }
  async function collectTransportSides() {
    const { getTransportPreparation, scanTransportPackets } = require('./remux-transport-evidence.cjs');
    const prepared = getTransportPreparation(options.transportPreparation, sourcePath, sourceProbe, stamp(sourceBefore));
    const scanned = await scanTransportPackets({ file: outputPath, probe: outputProbe, source: false, sourceAdmission: prepared.admitted,
      budget, signal, invoke: (args, maximum, sink) => invoke('output-all-packets', ffprobe, args, maximum, false, null, sink) });
    for (const mapping of mappings) {
      const before = prepared.entries.get(mapping.inputIndex), after = scanned.entries.get(mapping.outputIndex);
      need(before && after && before.count === after.count, 'Transport packet count changed.', 'REMUX_PACKET_COUNT');
      need(after.record.decoderParametersSha256 === before.record.decoderParametersSha256,
        'Transport decoder parameters changed.', 'REMUX_CODEC_PARAMETERS');
      need(before.record.contentSha256 === after.record.contentSha256,
        'Ordered AVC NALs or raw AAC frame payload changed, disappeared or moved.', 'REMUX_PACKET_PAYLOAD');
      need(before.record.metadataSha256 === after.record.metadataSha256,
        'Exact packet clocks, duration, key flag, side metadata or A/V offset changed.', 'REMUX_TS_PACKET_IDENTITY');
      // The rolling transcript contains every exact-rational row in decode
      // order, including its per-packet canonical payload hash and key flag.
      // Equal complete transcripts avoid a second source demux or unbounded
      // in-memory row list. The preparation token is main-private and stamped.
      const pair = [structuredClone(before), after];
      for (let i = 0; i < pair.length; i++) {
        const side = i ? 'output' : 'source', entry = pair[i];
        entry.family = i ? 'isobmff' : 'mpegts'; entry.inferredDts = 0; entry.observedBFrames = entry.header?.has_b_frames || 0;
        entry.bytes = before.bytes;
        if (mapping.codecType === 'video') {
          entry.windowClips = {};
          for (const position of ['start', 'end']) {
            const writer = await spool(side + '-' + mapping.outputIndex + '-window-' + position + '.h264');
            try { await writer.write(Buffer.from(position === 'start' ? entry.firstClip : entry.lastClip)); entry.windowClips[position] = await writer.finish(); }
            finally { await writer.close(); }
          }
        }
        collections[side].set(i ? mapping.outputIndex : mapping.inputIndex, entry);
      }
      collections.source.get(mapping.inputIndex).packetComparison = { complete: true, comparedUnits: String(before.count),
        maxPtsError: encoded(rational(0)), maxDurationError: encoded(rational(0)), maxDtsError: encoded(rational(0)) };
    }
    // Canonical byte identity above proves the very same ordered NAL sequence
    // on both sides. Validate all output slice headers in CBS without decoding
    // interior frames; the existing keyframe-window decoder follows below.
    const video = mappings.find(m => m.codecType === 'video');
    await invoke('output-' + video.outputIndex + '-complete-parameters', ffmpeg, [...ffmpegArgs(outputPath, video.outputIndex),
      '-an', '-sn', '-dn', '-copyinkf', '-c:v', 'copy', '-bsf:v', ['h264_mp4toannexb', 'filter_units=remove_types=12', 'h264_metadata'].join(','), '-f', 'null', '-'],
    1024, true);
    receipt.transport = { rule: 'keep-source-clocks-exactly', nalMovements: [], strippedFraming: ['annex-b-start-codes', 'seven-byte-adts-header'],
      sampleDescription: 'byte-identical-sps-pps-and-adts-asc', headDroppedPackets: 0 };
  }
  async function collectCodecAdmission() {
    const boundCodecBytes = new Map();
    await eachSide(async (side, file, media) => {
      const videoMappings = mappings.filter(m => m.codecType === 'video');
      need(videoMappings.length === 1, 'The fast route requires exactly one admitted H264 stream.', 'REMUX_CODEC_PARAMETERS');
      for (const mapping of mappings.filter(m => ['video', 'audio'].includes(m.codecType))) {
        const index = side === 'source' ? mapping.inputIndex : mapping.outputIndex, stream = media.streams.find(s => s.index === index);
        const cacheKey = String(stream.extradata_size) + ':' + String(stream.extradata_hash).toLowerCase();
        if (!boundCodecBytes.has(cacheKey)) {
          const pending = (async () => {
            const sink = createRemuxHexSink(Number(stream.extradata_size), stream.extradata_hash);
            const raw = await invoke(side + '-' + index + '-codec-extradata', ffprobe, [...probeArgs(file, index),
              ...probeQueries.get('extradata'), '-of', 'default=noprint_wrappers=1:nokey=1', '-i', file],
            Number(stream.extradata_size) * 5 + 1024, false, { file, stream, kind: 'extradata' }, sink);
            return raw.summary;
          })();
          boundCodecBytes.set(cacheKey, pending);
        }
        // Independently bound equal size/hash permits one retrieval; parse
        // these bytes against each side's own admitted stream properties.
        const codecBytes = await boundCodecBytes.get(cacheKey);
        const admitted = mapping.codecType === 'video' ? parseRemuxAvcc(codecBytes, stream) : parseRemuxAsc(codecBytes, stream);
        codecAdmission[side].set(index, admitted);
        const collected = collections[side].get(index);
        if (mapping.codecType === 'video') {
          const forecast = 4n * (side === 'source' ? sourceBefore.size : outputBefore.size) + BigInt(budget.maxRecords) * BigInt(admitted.bytes + 16);
          need(forecast <= BigInt(Number.MAX_SAFE_INTEGER), 'Parameter scan byte forecast is not exactly addressable.', 'REMUX_PROPORTIONAL_BUDGET');
          const ceiling = Number(forecast);
          const cursor = rows(collected.held), captures = new Map(), identities = [];
          const selected = mappings.filter(m => m.codecType !== 'attachment'); collected.windowClips = {};
          try {
            for (const selectedMapping of selected) {
              const selectedIndex = side === 'source' ? selectedMapping.inputIndex : selectedMapping.outputIndex;
              const complete = collections[side].get(selectedIndex);
              identities.push({ complete, cursor: rows(complete.held), writer: await rowSpool(side + '-' + selectedIndex + '.identity'),
                hash: createHash('sha256'), count: 0 });
            }
            let hashHeader = false;
            const codedLines = createLineSink(async line => {
              if (!line) return;
              if (line.startsWith('#')) { if (/^#hash:\s*SHA256\s*$/i.test(line)) hashHeader = true; return; }
              const columns = line.split(',').map(value => value.trim()), ordinal = Number(columns[0]);
              need(hashHeader && /^\d+$/.test(columns[0]) && Number.isSafeInteger(ordinal) && identities[ordinal]
                && columns.length >= 6 && HASH.test(columns[5]), 'Malformed complete coded packet hash.', 'REMUX_PACKET_PAYLOAD');
              const identity = identities[ordinal], next = await identity.cursor.next();
              need(!next.done && identity.count < identity.complete.count, 'Extra coded packet in the complete hash pass.', 'REMUX_PACKET_COUNT');
              const row = next.value;
              need(/^\d+$/.test(columns[4]) && BigInt(columns[4]) === BigInt(row.size),
                'Coded packet size changed between metadata and payload passes.', 'REMUX_PACKET_PAYLOAD');
              row.hash = columns[5]; identity.hash.update(row.size + ':' + row.hash + '\n'); await identity.writer.write(row);
              for (const key of [identity.complete.firstKey, identity.complete.lastKey]) if (key?.packetIndex === row.packetIndex) key.hash = row.hash;
              identity.count++;
            });
            const coded = { push: chunk => codedLines.push(chunk), async finish() {
              await codedLines.finish();
              for (const identity of identities) {
                need(hashHeader && identity.count === identity.complete.count && (await identity.cursor.next()).done,
                  'Incomplete coded packet hash coverage.', 'REMUX_PACKET_COUNT');
                identity.complete.held = await identity.writer.finish(); identity.complete.record.contentSha256 = identity.hash.digest('hex');
              }
              return { complete: true, streams: identities.length };
            } };
            for (const position of ['start', 'end']) {
              const key = position === 'start' ? collected.firstKey : collected.lastKey;
              need(key && Number.isSafeInteger(key.packetIndex) && key.packetIndex >= 0 && key.packetIndex < collected.count,
                'No admitted boundary key packet.', 'REMUX_PACKET_WINDOW_ANCHOR');
              let capture = captures.get(key.packetIndex);
              if (!capture) {
                const writer = await spool(side + '-' + index + '-window-' + position + '.h264');
                capture = { writer, sink: createRemuxAvccClipSink(admitted, writer), positions: [] }; captures.set(key.packetIndex, capture);
                for (const nal of [...admitted.sps.values(), ...admitted.pps.values()]) {
                  await writer.write(Buffer.from([0, 0, 0, 1])); await writer.write(nal);
                }
              }
              capture.positions.push(position);
            }
            const sink = createRemuxPacketHeaderSink(admitted, stream, { maxBytes: ceiling, maxUnits: budget.maxRecords * 1024 + 256, deferredPacketHashes: true },
              cursor, collected.count, async (packet, chunk) => { await captures.get(packet)?.sink.push(chunk); }, async packet => {
                const capture = captures.get(packet); if (!capture) return;
                await capture.sink.finish(); const held = await capture.writer.finish();
                for (const position of capture.positions) collected.windowClips[position] = held;
              });
            // One demux child hashes ALL copied streams, scans original AVC and
            // validates complete CBS slice headers. FFprobe above lists timing
            // and side data only. Independently hash the raw video branch and
            // require its complete packet digest to match the coded hash pipe.
            const result = await invoke(side + '-' + index + '-complete-parameters', ffmpeg, [...ffmpegArgs(file, index),
              '-an', '-sn', '-dn', '-copyinkf', '-c:v', 'copy', '-f', 'data', 'pipe:1',
              ...selected.flatMap(m => ['-map', '0:' + (side === 'source' ? m.inputIndex : m.outputIndex)]),
              '-c', 'copy', '-copyinkf', '-avoid_negative_ts', 'disabled', '-f', 'framehash', '-hash', 'sha256', 'pipe:3',
              '-map', '0:' + index, '-an', '-sn', '-dn', '-copyinkf', '-c:v', 'copy', '-bsf:v',
              'h264_mp4toannexb,filter_units=remove_types=12,h264_metadata', '-f', 'null', '-'],
            Number(side === 'source' ? sourceBefore.size : outputBefore.size), true, null, sink,
            { maxBytes: budget.maxTextBytes, sink: coded });
            need(result.summary.packetPayloadSha256 === collected.record.contentSha256,
              'The complete original AVC pipe differs from the coded packet hash pipe.', 'REMUX_PACKET_PAYLOAD');
            const { packetPayloadSha256, ...admission } = result.summary; collected.record.admission = admission;
            need(collected.windowClips.start && collected.windowClips.end, 'Boundary key capture is incomplete.', 'REMUX_PACKET_WINDOW_ANCHOR');
          } finally { await cursor.return(); for (const capture of captures.values()) await capture.writer.close();
            for (const identity of identities) { await identity.cursor.return(); await identity.writer.close(); } }
        } else {
          // The bounded initial decoded observation establishes the native
          // buffer-source format. The complete PCM pass below disables filter
          // reinitialization: libavfilter rejects any later audio format/rate/
          // layout change instead of silently rebuilding conversion filters.
          const first = rational(collected.firstPts.numerator, collected.firstPts.denominator);
          const text = t => { const n = t.n * 1000000n / t.d, a = n < 0n ? -n : n; return (n < 0n ? '-' : '') + String(a / 1000000n) + '.' + String(a % 1000000n).padStart(6, '0'); };
          const query = ['-read_intervals', text(first) + '%' + text(add(first, rational(1))), '-show_frames', '-show_entries',
            'frame=media_type,stream_index,pts,nb_samples,sample_fmt,sample_rate,channels,channel_layout:frame_side_data='];
          probeQueries.set('audio-admission', [...query]); let frames = 0;
          const native = createRemuxJsonSink('frames', { maxRecords: 256, maxRecordBytes: 65536, onRecord(frame) {
            try { nativeFrames([frame], stream); }
            catch { fail('Initial native audio differs from admitted AAC parameters.', 'REMUX_AUDIO_PARAMETERS_CHANGED'); }
            need(['sample_fmt', 'channels', 'channel_layout'].every(k => own(frame, k)), 'Missing native audio admission fields.', 'REMUX_AUDIO_PARAMETERS_CHANGED');
            need(integer(frame.nb_samples, 'Native AAC samples', 1n) <= BigInt(admitted.samples), 'AAC native frame length changed.', 'REMUX_AUDIO_PARAMETERS_CHANGED'); frames++;
          } });
          await invoke(side + '-' + index + '-audio-admission', ffprobe, [...probeArgs(file, index), ...query, '-of', 'json', '-i', file],
            512 * 1024, false, { file, stream, kind: 'audio-admission' }, native);
          need(frames > 0, 'No native audio admission window.', 'REMUX_AUDIO_PARAMETERS_CHANGED');
          collected.record.admission = { version: 1, complete: true, kind: 'aac-lc-packet-and-frozen-pcm-v1', configurationSha256: admitted.configurationSha256,
            nativeStartFrames: frames };
        }
      }
    });
  }
  async function collectPacketSides() {
    await eachSide(async (side, file, media) => {
      const family = side === 'source' ? assessment.inputFamily : outputFamily;
      const pending = new Map(), headers = new Map(); let payloadBytes = 0n;
      try {
        for (const mapping of mappings) {
          const index = side === 'source' ? mapping.inputIndex : mapping.outputIndex, stream = media.streams.find(s => s.index === index);
          const parameters = remuxCodecParameters(stream);
          if (semanticAudio(stream.codec_type)) { delete parameters.initial_padding; delete parameters.trailing_padding; }
          const parametersSha256 = sha(JSON.stringify(parameters));
          if (stream.codec_type === 'attachment') {
            const payload = await header(file, stream, side + '-' + index);
            need(BigInt(payload.bytes) > 0n && typeof payload.tags.filename === 'string' && typeof payload.tags.mimetype === 'string', 'Complete attachment identity required.');
            collections[side].set(index, { record: { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'attachment-extradata-v1',
              contentSha256: payload.sha256, metadataSha256: sha(JSON.stringify(canonical({ codec: stream.codec_name, bytes: payload.bytes,
                tags: projectRequiredRemuxTags(payload.tags, { scope: 'stream' }) }))), unitCount: '1', firstPts: null, endPts: null } });
            continue;
          }
          const accumulator = createRemuxPacketAccumulator(stream, { maxRecords: budget.maxRecords, maxSourceBytes: Number(side === 'source' ? sourceBefore.size : outputBefore.size),
            maxDurationSeconds: budget.maxDurationSeconds, family, semanticAudio: semanticAudio(stream.codec_type), deferPayloadHash: true });
          const writer = await rowSpool(side + '-' + index + '.packets');
          pending.set(index, { writer, accumulator, stream, parametersSha256, hash: createHash('sha256'), sideHash: createHash('sha256'), inferredDts: 0 });
        }
        const sink = createRemuxJsonSink('packets', { maxRecords: budget.maxRecords, maxRecordBytes: Math.min(65536, budget.maxFrameBytes),
          async onRecord(packet) {
            const stream = media.streams.find(s => s.index === packet.stream_index);
            need(stream && packet.codec_type === stream.codec_type, 'Packet names an unknown/swapped stream.', 'REMUX_PACKET_STREAM');
            const entry = pending.get(packet.stream_index);
            if (!entry) {
              need(side === 'source' && !mappings.some(m => m.inputIndex === packet.stream_index), 'Unexpected output/attachment packet.', 'REMUX_PACKET_STREAM');
              return; // Only an explicit assessed omission may bypass comparison.
            }
            const row = entry.accumulator.push(packet); if (!row.dts) entry.inferredDts++;
            payloadBytes += BigInt(row.size);
            need(payloadBytes <= (side === 'source' ? sourceBefore.size : outputBefore.size), 'Aggregate packet payload exceeds its file byte budget.', 'REMUX_PROPORTIONAL_BUDGET');
            entry.hash.update(row.size + ':' + row.hash + '\n');
            entry.sideHash.update(semanticAudio(stream.codec_type) ? row.key + '\n' : row.key + ':' + row.discard + ':' + row.sideSha256 + '\n');
            await entry.writer.write(row);
          }, onAuxRecord(header) {
            const stream = media.streams.find(s => s.index === header.index);
            need(stream && !headers.has(header.index) && header.codec_type === stream.codec_type && header.codec_name === stream.codec_name,
              'Duplicate or foreign codec header.', 'REMUX_CODEC_PARAMETERS');
            // The separately bound probe supplies the initialization hash;
            // actual initialization bytes are retrieved and SHA-proven below.
            // This metadata-only traversal never hashes whole packet payloads.
            need(!own(header, 'extradata_hash') || header.extradata_hash === stream.extradata_hash,
              'Codec initialization hash changed from its bound probe.', 'REMUX_CODEC_PARAMETERS');
            need(JSON.stringify(remuxCodecParameters({ ...header, ...(own(stream, 'extradata_hash') ? { extradata_hash: stream.extradata_hash } : {}) })) === JSON.stringify(remuxCodecParameters(stream)),
              'Codec header changed from its bound probe.', 'REMUX_CODEC_PARAMETERS');
            if (header.codec_type === 'video') need(Number.isSafeInteger(header.has_b_frames) && header.has_b_frames >= 0 && header.has_b_frames <= MAX_REORDER,
              'Missing or excessive H264 reorder observation.', 'REMUX_PACKET_REORDER');
            headers.set(header.index, header);
          } });
        // A single demux traversal, including all interleaved selected streams.
        // No decoder or frame listing is requested. Keep packet side-data fields
        // (especially skip_samples/discard_padding), rather than narrowing them.
        await invoke(side + '-all-packets', ffprobe, ['-v', 'warning', '-protocol_whitelist', 'file,pipe',
          '-show_packets', '-show_streams', '-of', 'json', '-i', file], budget.maxTextBytes, false, { file, kind: 'all-packets' }, sink);
        need(headers.size === media.streams.length, 'Incomplete codec header coverage.', 'REMUX_CODEC_PARAMETERS');
        for (const [index, entry] of pending) {
          const observedBFrames = headers.get(index).has_b_frames || 0;
          need(entry.inferredDts <= observedBFrames, 'Missing DTS exceeds the observed reorder depth.', 'REMUX_PACKET_DTS');
          const summary = entry.accumulator.finish(), held = await entry.writer.finish();
          need(!summary.reordered || observedBFrames > 0, 'Packet reordering contradicts the decoder header.', 'REMUX_PACKET_REORDER');
          const decoderParametersSha256 = sha(entry.parametersSha256 + ':' + observedBFrames);
          const sideHash = entry.sideHash.digest('hex');
          collections[side].set(index, { ...summary, held, stream: { ...entry.stream,
            ...(own(headers.get(index), 'codec_delay') ? { codec_delay: headers.get(index).codec_delay } : {}) },
            sideHash, inferredDts: entry.inferredDts, family, observedBFrames,
            record: { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'packet-identity-v1',
              contentSha256: entry.hash.digest('hex'), metadataSha256: sha(decoderParametersSha256 + ':' + sideHash + ':' + summary.presentationSha256),
              decoderParametersSha256, unitCount: String(summary.count), firstPts: summary.firstPts, endPts: summary.endPts,
              ...(summary.cadence ? { cadence: summary.cadence } : {}) } });
        }
      } finally { for (const entry of pending.values()) await entry.writer.close(); }
    });
  }
  async function decodePacketWindows(side, collected) {
    const stream = collected.stream, positions = ['start'];
    if (collected.lastKey.packetIndex !== collected.firstKey.packetIndex) positions.push('end');
    const clips = positions.map(position => collected.windowClips?.[position]);
    need(clips.every(Boolean), 'Complete hash-bound key captures are required.', 'REMUX_PACKET_WINDOW_ANCHOR');
    for (const clip of clips) await unchanged(clip.file, clip.stat);
    const windows = positions.map(position => {
      let count = 0, headerSeen = false; const digest = createHash('sha256');
      const lines = createLineSink(line => {
        if (!line) return;
        if (line.startsWith('#')) { if (/^#hash:\s*SHA256\s*$/i.test(line)) headerSeen = true; return; }
        need(headerSeen && ++count <= 1, 'Bounded native decode exceeded one picture.', 'REMUX_PACKET_WINDOW');
        const row = frameHashRows('#hash: SHA256\n' + line + '\n', stream, 1)[0]; digest.update(JSON.stringify(row) + '\n');
      });
      return { push: chunk => lines.push(chunk), async finish() { await lines.finish();
        need(count === 1, 'Bounded native decode was empty or truncated.', 'REMUX_PACKET_WINDOW');
        const key = position === 'start' ? collected.firstKey : collected.lastKey;
        return { keyPacketIndex: key.packetIndex, frameCount: count, sha256: digest.digest('hex') };
      } };
    });
    const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-xerror', '-protocol_whitelist', 'file,pipe'];
    for (const clip of clips) args.push('-threads', '1', '-noautorotate', '-f', 'h264', '-i', clip.file);
    for (let index = 0; index < clips.length; index++) args.push('-map', index + ':v:0', '-an', '-sn', '-dn', '-frames:v', '1',
      '-c:v', 'rawvideo', '-threads', '1', '-pix_fmt', stream.pix_fmt, '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', index ? 'pipe:3' : 'pipe:1');
    const result = await invoke(side + '-' + stream.index + '-windows', ffmpeg, args, 16384, false, null, windows[0],
      windows[1] ? { maxBytes: 16384, sink: windows[1] } : null);
    for (const clip of clips) await unchanged(clip.file, clip.stat);
    return { start: result.summary, end: windows[1] ? result.auxiliarySummary : { ...result.summary } };
  }
  const packetPcmBytes = { source: 0, output: 0 };
  async function verifyPacketDecodes(before, after, type) {
    if (type === 'video') {
      await eachSide(async (side) => {
        const collected = side === 'source' ? before : after;
        collected.record.decodedWindows = await decodePacketWindows(side, collected);
      });
      for (const position of ['start', 'end']) {
        const a = before.record.decodedWindows[position], b = after.record.decodedWindows[position];
        need(a.keyPacketIndex === b.keyPacketIndex && a.frameCount === b.frameCount && a.sha256 === b.sha256,
          'Bounded native decode differs at the ' + position + ' keyframe.', 'REMUX_PACKET_WINDOW');
      }
    } else if (type === 'audio' && !transport) {
      await eachSide(async (side, file) => {
        const collected = side === 'source' ? before : after;
        const stream = collected.stream, representation = pcmRepresentation(stream), sink = await pcmSink(side + '-' + stream.index);
        try {
          const maximum = Math.min(budget.maxPcmBytes - packetPcmBytes[side],
            budget.maxDurationSeconds * Number(stream.sample_rate) * stream.channels * representation.bytesPerSample);
          need(Number.isSafeInteger(maximum) && maximum > 0, 'Complete PCM file budget is exhausted.', 'REMUX_EVIDENCE_LIMIT');
          const pcmArgs = ffmpegArgs(file, stream.index); pcmArgs.splice(pcmArgs.indexOf('-i'), 0, '-reinit_filter', '0');
          const pcm = await invoke(side + '-' + stream.index + '-native-audio', ffmpeg, [...pcmArgs, '-vn', '-sn', '-dn',
            '-c:a', 'pcm_' + representation.format, '-f', representation.format, 'pipe:1'], maximum, true, null, sink);
          const sampleBytes = stream.channels * representation.bytesPerSample;
          need(pcm.bytes > 0 && pcm.bytes % sampleBytes === 0, 'Incomplete native audio samples.', 'REMUX_PACKET_PCM');
          collected.pcmWindows = pcm.summary; collected.record.pcm = { bytes: pcm.bytes, samples: String(pcm.bytes / sampleBytes), sha256: pcm.sha256 };
          packetPcmBytes[side] += pcm.bytes;
        } finally { await sink.close(); }
      });
      const windows = await comparePcmWindows(before, after);
      need(before.record.pcm.bytes === after.record.pcm.bytes && before.record.pcm.sha256 === after.record.pcm.sha256 && windows.firstMismatchByte === null,
        'Complete PCM priming/delay/tail differs at byte ' + windows.firstMismatchByte + '.', 'REMUX_PACKET_PCM');
      if (semanticAudio(type)) for (const collected of [before, after]) {
        const trim = collected.record.audioTrim;
        need(BigInt(trim.codedSamples) - BigInt(trim.leadingSamples) - BigInt(trim.trailingSamples) === BigInt(collected.record.pcm.samples),
          'Effective audio trim does not describe the complete decoded sample count.', 'REMUX_AUDIO_TRIM');
      }
    }
  }
  try {
    const nativeSource=await observeNativeInventory({file:sourcePath,probe:source,family:assessment.inputFamily,target:assessment.target,
      identity:stamp(sourceBefore),selectedIndexes:mappings.map(m=>m.inputIndex),...budget,signal});
    const nativeOutput=await observeNativeInventory({file:outputPath,probe:output,family:outputFamily,target:assessment.target,
      identity:stamp(outputBefore),...budget,signal});
    receipt.nativeInventory=compareNativeInventories(nativeSource,nativeOutput,mappings);
    if (verificationMethod === 'packet-identity-v1') {
      if (transport) await collectTransportSides();
      else {
      await collectPacketSides();
      for (const mapping of mappings) if (mapping.codecType !== 'attachment') {
        const before = collections.source.get(mapping.inputIndex), after = collections.output.get(mapping.outputIndex);
        need(before.record.decoderParametersSha256 === after.record.decoderParametersSha256,
          `Decoder parameters/extradata changed for stream ${mapping.inputIndex} → ${mapping.outputIndex}.`, 'REMUX_CODEC_PARAMETERS');
        need(before.count === after.count, 'Complete packet counts differ.', 'REMUX_PACKET_COUNT');
        if (!semanticAudio(mapping.codecType)) await compareRemuxPackets(before.count, after.count, rows(before.held), rows(after.held), { signal,
          sourcePrefix: before.family === 'matroska', outputPrefix: after.family === 'matroska' });
      }
      await collectCodecAdmission();
      for (const mapping of mappings) if (mapping.codecType !== 'attachment') {
        const before = collections.source.get(mapping.inputIndex), after = collections.output.get(mapping.outputIndex);
        if (semanticAudio(mapping.codecType)) continue; // ASC sample grid is admitted below, before semantic audio comparison.
        before.packetComparison = await compareRemuxPackets(before.count, after.count, rows(before.held), rows(after.held), { signal,
          sourcePrefix: before.family === 'matroska', outputPrefix: after.family === 'matroska' });
        need(before.presentationSha256 === after.presentationSha256, 'Complete presentation packet order changed.', 'REMUX_PACKET_REORDER');
      }
      for (const mapping of mappings.filter(m => semanticAudio(m.codecType))) {
        const before = collections.source.get(mapping.inputIndex), after = collections.output.get(mapping.outputIndex);
        before.packetComparison = await compareRemuxPackets(before.count, after.count, rows(before.held), rows(after.held), { signal,
          audioTrim: { source: before.stream, output: after.stream, sourceSamples: codecAdmission.source.get(mapping.inputIndex).samples,
            outputSamples: codecAdmission.output.get(mapping.outputIndex).samples, sourceFamily: assessment.inputFamily, outputFamily } });
        for (const [collected, trim] of [[before, before.packetComparison.audioTrim.source], [after, before.packetComparison.audioTrim.output]]) {
          collected.record.audioTrim = trim;
          collected.record.metadataSha256 = sha(collected.record.decoderParametersSha256 + ':' + collected.sideHash + ':' + JSON.stringify(trim));
        }
      }
      }
    }
    else for (const [side, file, media] of [['source', sourcePath, source], ['output', outputPath, output]]) {
      let filePcmBytes = 0;
      for (const mapping of mappings) {
        const index = side === 'source' ? mapping.inputIndex : mapping.outputIndex;
        const stream = media.streams.find(value => value.index === index), label = side + '-' + index;
        if (stream.codec_type === 'attachment') {
          const payload = await header(file, stream, label); need(BigInt(payload.bytes) > 0n, 'Attachment must contain one nonempty complete payload.');
          need(typeof payload.tags.filename === 'string' && typeof payload.tags.mimetype === 'string', 'Attachment filename and mimetype identity are required.');
          collections[side].set(index, { record: { complete: true, exitCode: 0, stderrComplete: true, errors: [], representation: 'attachment-extradata-v1',
            contentSha256: payload.sha256, metadataSha256: sha(JSON.stringify(canonical({ codec: stream.codec_name, bytes: payload.bytes,
              tags: projectRequiredRemuxTags(payload.tags, { scope: 'stream' }) }))), unitCount: '1', firstPts: null, endPts: null },
            kind: 'complete-attachment-extradata-identity' }); continue;
        }
        if (stream.codec_type === 'subtitle') {
          const payload = await header(file, stream, label);
          const builder = await timelineBuilder(stream, label, side, JSON.stringify(canonical({ codec: stream.codec_name,
            header: { ...payload, tags: projectRequiredRemuxTags(payload.tags, { scope: 'stream' }) } })) + '\n');
          try {
            const coded = await packets(file, stream, label, async packet => {
              need(!(packet.side_data_list || []).length, 'Uninterpreted subtitle packet side data is not qualified.'); await builder.push(packet);
            });
            collections[side].set(index, await builder.finish(coded.seal, 'complete-coded-subtitle-event-and-header-identity'));
          } finally { await builder.close(); } continue;
        }
        const builder = await timelineBuilder(stream, label, side, null, budget.maxPcmBytes - filePcmBytes);
        try {
          await json(label + '-frames', file, stream, ['-show_frames'], 'frames', frame => builder.push(frame));
          need(builder.frameCount > 0, 'Complete stream unexpectedly decoded no frames.');
          let content, coded, pcmWindows;
          if (stream.codec_type === 'video') {
            const hash = createHash('sha256'); hash.update('['); let count = 0, headerSeen = false;
            const sink = createLineSink(line => {
              if (!line) return;
              if (line.startsWith('#')) { if (/^#hash:\s*SHA256\s*$/i.test(line)) headerSeen = true; return; }
              need(headerSeen, 'Missing native SHA256 framehash header.');
              const row = frameHashRows('#hash: SHA256\n' + line + '\n', stream, 1)[0];
              need(++count <= budget.maxRecords, 'Framehash record limit exceeded.', 'REMUX_PROPORTIONAL_BUDGET');
              if (count > 1) hash.update(','); hash.update(JSON.stringify(row));
            });
            await invoke(label + '-native-video', ffmpeg, [...ffmpegArgs(file, index), '-an', '-sn', '-dn',
              '-c:v', 'rawvideo', '-pix_fmt', stream.pix_fmt, '-enc_time_base', 'demux', '-fps_mode', 'passthrough', '-f', 'framehash', '-hash', 'sha256', 'pipe:1'], budget.maxTextBytes, false, null, sink);
            need(headerSeen && count > 0 && count === builder.frameCount, 'Every decoded video frame needs a complete native hash.');
            hash.update(']'); content = hash.digest('hex'); coded = await packets(file, stream, label);
          } else {
            const representation = pcmRepresentation(stream), samples = BigInt(builder.count);
            need(samples <= integer(stream.sample_rate, 'Native sample rate', 1n) * BigInt(budget.maxDurationSeconds),
              'Complete native sample count exceeds its source-derived duration.', 'REMUX_EVIDENCE_LIMIT');
            const expectedBytes = samples * BigInt(stream.channels * representation.bytesPerSample);
            need(expectedBytes > 0n && expectedBytes <= BigInt(budget.maxPcmBytes - filePcmBytes), 'Complete PCM exceeds its source-derived per-file byte ceiling.', 'REMUX_EVIDENCE_LIMIT');
            const sink = await pcmSink(label);
            try {
              const pcm = await invoke(label + '-native-audio', ffmpeg, [...ffmpegArgs(file, index), '-vn', '-sn', '-dn',
                '-c:a', 'pcm_' + representation.format, '-f', representation.format, 'pipe:1'], Number(expectedBytes), true, null, sink);
              need(pcm.bytes === Number(expectedBytes), 'Complete native samples were truncated, padded or converted.');
              filePcmBytes += pcm.bytes; content = pcm.sha256; pcmWindows = pcm.summary;
            } finally { await sink.close(); }
          }
          const timeline = await builder.finish(content); if (pcmWindows) timeline.pcmWindows = pcmWindows;
          if (timeline.opaqueSideData && stream.codec_type === 'video') {
            const codecHeader = await header(file, stream, label);
            timeline.packetSeal = sha(JSON.stringify({ packets: coded.seal, bytes: codecHeader.bytes, header: codecHeader.sha256 }));
          }
          collections[side].set(index, timeline);
        } finally { await builder.close(); }
      }
    }
    const essence = { version: 1, verificationMethod, verificationClaim: remuxVerificationDescription(verificationMethod, assessment.inputFamily), runtimeIdentity, sourceFingerprint: assessment.sourceFingerprint,
      sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint, outputId: outputId.toLowerCase(),
      outputEvidenceFingerprint: outputProbeFingerprint, complete: true, streams: [] };
    for (const mapping of mappings) {
      const before = collections.source.get(mapping.inputIndex), after = collections.output.get(mapping.outputIndex);
      let timestamps;
      if (verificationMethod === 'packet-identity-v1' && mapping.codecType !== 'attachment') {
        timestamps = before.packetComparison;
        await verifyPacketDecodes(before, after, mapping.codecType);
        receipt.comparisons.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex, sourceInferredDts: before.inferredDts,
          outputInferredDts: after.inferredDts, maxDtsError: timestamps.maxDtsError, packetPayloadBytes: before.bytes,
          peakReorderRows: Math.max(before.peakRows, after.peakRows), sourceBFrames: before.observedBFrames, outputBFrames: after.observedBFrames });
        // The independent validator retains the existing timestamp schema.
        timestamps = { complete: timestamps.complete, comparedUnits: timestamps.comparedUnits, maxPtsError: timestamps.maxPtsError, maxDurationError: timestamps.maxDurationError };
      }
      if (before.opaqueSideData || after.opaqueSideData) need(before.packetSeal && before.packetSeal === after.packetSeal,
        'Opaque decoded side-data descriptors require complete identical coded payload sequence; normalized payload proof is unavailable.', 'REMUX_EVIDENCE_OPAQUE');
      essence.streams.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex, codecType: mapping.codecType,
        source: before.record, output: after.record, timestamps: mapping.codecType === 'attachment' ? null : timestamps || await compareRemuxTimelines(before.count, after.count, rows(before.held), rows(after.held), { signal }) });
      receipt.comparisons.push({ inputIndex: mapping.inputIndex, outputIndex: mapping.outputIndex,
        contentIdentical: before.record.contentSha256 === after.record.contentSha256,
        metadataIdentical: before.record.metadataSha256 === after.record.metadataSha256,
        evidenceKind: before.kind || (verificationMethod === 'packet-identity-v1' ? 'packet-identity-' + mapping.codecType : `complete-native-${mapping.codecType}`),
        ...(mapping.codecType === 'audio' && !transport ? { pcmWindows: await comparePcmWindows(before, after) } : {}) });
    }
    // A full output seal also binds MOV representation receipts. Hash from an
    // open stable handle and prove both the name and handle stayed unchanged.
    await paths(); const handle = await fs.open(outputPath, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    try {
      need(same(outputBefore, await handle.stat({ bigint: true })), 'Output handle changed before full seal.');
      for (let offset = 0; offset < Number(outputBefore.size);) {
        stop(); const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(outputBefore.size) - offset), offset);
        need(bytesRead > 0, 'Incomplete output seal.'); hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead; progress('output-seal', offset, Number(outputBefore.size));
      }
      need(same(outputBefore, await handle.stat({ bigint: true })), 'Output changed during full seal.', 'REMUX_EVIDENCE_CHANGED');
    } finally { await handle.close(); }
    essence.outputFileSha256 = hash.digest('hex'); await paths();
    // Preparation rejects source controls before Ready. Inspect them again at
    // collection under this job's unchanged identity, including ISO->Matroska.
    // A container padding declaration is independent of a decoder deciding to
    // ignore an interior trim. Native admission proves a terminal AAC block;
    // crossing containers additionally binds its exact samples to the complete
    // packet/PCM trim proof. No new timing tolerance is introduced here.
    if(assessment.inputFamily!==outputFamily)for(const [native,side]of [[nativeSource,'source'],[nativeOutput,'output']]){
      for(const p of native.fields.find(f=>f.id==='matroska:DiscardPadding')?.values||[]){
        need(collections[side].get(p.index)?.record.audioTrim?.trailingSamples===p.value,'Native terminal Matroska padding lacks an identical complete effective AAC trim.','REMUX_NATIVE_DISCARDPADDING');
      }
    }
    const sourcePlayback = assessment.inputFamily === 'isobmff' ? await observeRemuxSourcePlayback({ file: sourcePath, probe: source, target: assessment.target,
      identity: { canonicalPath: sourcePath, ...stamp(sourceBefore) }, selectedIndexes: mappings.map(m => m.inputIndex),
      maxRecords: budget.maxRecords, timeoutMs: budget.timeoutMs, signal, onProgress: value => progress('source-playback-controls', value.completed, value.total) }) : null;
    if (sourcePlayback) receipt.sourcePlayback = sourcePlayback;
    if (['mp4', 'mov'].includes(assessment.target)) {
      receipt.nativeEditLists = await observeRemuxEditLists({ outputProbe, signal, maxRecords: budget.maxRecords, exact: transport,
        fileReceipt: { path: outputPath, sha256: essence.outputFileSha256, bytes: Number(outputBefore.size), identity: stamp(outputBefore) },
        intervals: mappings.map(m => ({ outputIndex: m.outputIndex,
          ...remuxEditInterval(collections.source.get(m.inputIndex).record, source.streams.find(s => s.index === m.inputIndex)),
          ...(sourcePlayback ? { sourceControls: sourcePlayback.tracks.find(t => t.outputIndex === m.inputIndex).controls,
            sourceDimensions: sourcePlayback.tracks.find(t => t.outputIndex === m.inputIndex).dimensions } : {}) })),
        onProgress: value => progress('native-edit-lists', value.completed, value.total) });
      await paths();
    }
    // A MOV target's unspecified track languages are read from the sealed
    // owned file itself (record 47, Q1e). The branded receipt stays private to
    // main; the persisted receipt keeps only a bounded description of it.
    let movRepresentation = null;
    if (assessment.target === 'mov') {
      movRepresentation = await observeMovRepresentation({ outputId, outputProbe, signal,
        onProgress: value => progress('mov-representation', value.completed, value.total),
        fileReceipt: { path: outputPath, sha256: essence.outputFileSha256, bytes: Number(outputBefore.size), identity: stamp(outputBefore) } });
      await paths();
      receipt.movRepresentation = { kind: movRepresentation.kind,
        tracks: movRepresentation.tracks.map(track => ({ outputIndex: track.outputIndex, trackId: track.trackId, languageCode: track.languageCode })) };
    }
    receipt.sourceAfter = stamp(await unchanged(sourcePath, sourceBefore)); receipt.outputAfter = stamp(await unchanged(outputPath, outputBefore));
    await syncCompletedStreams();
    await persist('essence.json', Buffer.from(JSON.stringify(essence, null, 2))); receipt.essenceEvidence = essence;
    for (const item of owned) await unchanged(item.file, item.stat);
    receipt.elapsedMs = Date.now() - started;
    receipt.ioBytes = { packetPayload: String(receipt.comparisons.reduce((n, c) => n + 2n * BigInt(c.packetPayloadBytes || 0), 0n)),
      outputSeal: Number(outputBefore.size), movSeal: assessment.target === 'mov' ? Number(outputBefore.size) : 0,
      physicalMediaReads: null };
    // Logical complete-file operations are not physical disk passes. A tool
    // can seek/re-read internally; copying and initial inspection are outside
    // this collector. Preserve the extra TS integrity/probe work from prepare.
    const completeOperations = transport ? [{ side: 'source', operation: 'transport-integrity', bytesRead: Number(sourceBefore.size) },
      { side: 'source', operation: 'packet-probe-during-preparation' }] : [];
    const partialOperations = [];
    for(const side of ['source','output']){
      const native=receipt.nativeInventory?.[side];
      if(native?.metadataBytesRead!==undefined)partialOperations.push({side,operation:'native-inventory-metadata',bytesRead:native.metadataBytesRead,
        ...(side==='source'?{preparationRead:'Normal-service preparation separately inspects native source metadata; those metadata bytes are unmeasured here.'}:{})});
    }
    if (sourcePlayback) partialOperations.push({ side: 'source', operation: 'native-source-playback-metadata', bytesRead: sourcePlayback.metadataBytesRead,
      preparationRead: 'Normal-service preparation separately inspects ISO source metadata; those preparation metadata bytes are unmeasured here.' });
    for (const call of receipt.invocations) {
      const input = call.args[call.args.indexOf('-i') + 1], side = input === sourcePath ? 'source' : input === outputPath ? 'output' : null;
      if (!side) continue;
      if (call.args.includes('-show_packets') || call.label.endsWith('-complete-parameters') || call.label.endsWith('-native-audio')
        || call.label.endsWith('-native-video') || call.args.includes('-show_frames') && !call.args.includes('-read_intervals'))
        completeOperations.push({ side, operation: call.label });
      else partialOperations.push({ side, operation: call.label, toolInternalReads: 'unmeasured' });
    }
    completeOperations.push({ side: 'output', operation: 'output-seal', bytesRead: Number(outputBefore.size) });
    if (assessment.target === 'mov') completeOperations.push({ side: 'output', operation: 'mov-representation-reseal', bytesRead: Number(outputBefore.size) });
    if (receipt.nativeEditLists) partialOperations.push({ side: 'output', operation: 'native-edit-list-metadata', bytesRead: receipt.nativeEditLists.metadataBytesRead });
    receipt.readAccounting = { scope: 'Logical verification operations including TS preparation; excludes copying and initial inspection. ISO preparation metadata reads are separately noted and unmeasured here. Tool-internal seeks/re-reads are unmeasured.',
      completeOperations, partialOperations, capturedClipDecodeOperations: receipt.invocations.filter(c => c.args.includes('rawvideo') && c.args.includes('-frames:v')).length,
      physicalIOBytes: null };
    receipt.status = 'completed'; await persist('receipt.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0);
    await paths(); for (const item of owned) await unchanged(item.file, item.stat);
    const result = freeze(receipt); receipts.set(result, { assessment, runtimeIdentity, outputId: outputId.toLowerCase(), essence, movRepresentation }); return result;
  } catch (error) {
    const linuxForecastRefusal = linuxVerificationLimits.has(error)
      || (verificationMethod === 'packet-identity-v1' && !transport && error instanceof ToolError
        && error.code === 'REMUX_LINUX_CHILD_STDOUT_LIMIT');
    const cancelled = () => errorData(new ToolError('CANCELLED', REMUX_VERIFICATION_CANCELLED_MESSAGE));
    receipt.status = signal?.aborted ? 'cancelled' : 'failed';
    receipt.failure = linuxForecastRefusal && receipt.status === 'cancelled' ? cancelled() : errorData(error);
    receipt.essenceEvidence = null;
    // Never clean up or overwrite partial evidence. If the owned directory/path
    // changed, saving is refused and the in-memory failure retains that reason.
    try { await persist('failure.json', Buffer.from(JSON.stringify(receipt, null, 2)), 0); }
    catch (saveError) { receipt.persistenceFailure = errorData(saveError); }
    // The immutable receipt on disk reflects its write boundary. A Cancel
    // arriving during it still owns the returned terminal result, while the
    // recorded refusal and its completed substep remain private evidence.
    if (linuxForecastRefusal && signal?.aborted && receipt.status !== 'cancelled') {
      receipt.status = 'cancelled'; receipt.failure = cancelled();
    }
    return freeze(receipt);
  }
}

function getCollectedRemuxEvidence(receipt, { assessment, runtimeIdentity, outputId } = {}) {
  const state = receipts.get(receipt);
  need(state && receipt.status === 'completed' && state.assessment === assessment && state.runtimeIdentity === runtimeIdentity
    && typeof outputId === 'string' && state.outputId === outputId.toLowerCase(), 'A genuine complete matching main-owned Remux collector receipt is required.', 'REMUX_EVIDENCE_RECEIPT_REQUIRED');
  getRemuxAssessmentSource(assessment); return state.essence;
}
// The collector's own MOV observation for the same genuine receipt, or null
// when the target is not MOV. Same binding rules as the essence accessor.
function getCollectedMovRepresentation(receipt, bindings) {
  getCollectedRemuxEvidence(receipt, bindings); return receipts.get(receipt).movRepresentation;
}

module.exports = { REMUX_VERIFICATION_CANCELLED_MESSAGE, REMUX_EVIDENCE_LIMITS: LIMITS, collectRemuxEvidence, getCollectedRemuxEvidence, getCollectedMovRepresentation, createRemuxJsonSink, createLineSink, decodeRemuxTimelineRow, compareRemuxTimelines,
  remuxCodecParameters, createRemuxPacketAccumulator, compareRemuxPackets, inspectRemuxSps, parseRemuxAvcc, parseRemuxAsc,
  createRemuxHexSink, createRemuxParameterSink, createRemuxHeaderSink, createRemuxPacketHeaderSink, createRemuxAvccClipSink, createRemuxAudioTrim };
