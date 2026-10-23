'use strict';

const { createHash } = require('node:crypto');

// Pure byte classification only. Main owns capture completeness, source/runtime
// identity, reviewed profile admission and every execution/publication grant.
const VERSION = 1;
const LIMITS = Object.freeze({ maxCompressedBytes: 16 * 1024 * 1024, maxJsonBytes: 24 * 1024 * 1024,
  maxPackets: 1800, maxNals: 16384, maxNalsPerPacket: 64, maxSeiMessages: 8192,
  maxSeiPayloadBytes: 8192, maxProfiles: 64, maxParameterSetBytes: 4096 });
const TRANSFERS = Object.freeze({ smpte2084: 16, 'arib-std-b67': 18 });
// BT.709 is available only with an explicitly declared output purpose/profile.
// The default source parser remains the strict PQ/HLG classifier.
const SDR_OUTPUT = 'sdr-bt709-main10';
const PS = Object.freeze({ 32: 'vps', 33: 'sps', 34: 'pps' });
const VCL = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21]);
const X265_UUID = '2ca2de09b51747dbbb55a4fe7fc2fc4e';
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code: 'HEVC_CONTENT_' + code }); };
const need = (value, code, message) => { if (!value) fail(code, message); };
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function inert(value, maximum) {
  const seen = new Set(); let nodes = 0, characters = 0;
  function visit(entry, depth) {
    need(++nodes <= 100000 && depth <= 12, 'SHAPE', 'Compressed observations exceed the inert structural bound.');
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number') { need(Number.isFinite(entry), 'SHAPE', 'Observation numbers must be finite.'); return; }
    if (typeof entry === 'string') { characters += entry.length; need(characters <= maximum && !entry.includes('\0'), 'LIMIT', 'Compressed observation text exceeds its bound.'); return; }
    need((plain(entry) || Array.isArray(entry)) && !seen.has(entry), 'SHAPE', 'Only acyclic inert compressed observations are accepted.'); seen.add(entry);
    const keys = Reflect.ownKeys(entry); let arrayEntries = 0;
    for (const key of keys) {
      if (Array.isArray(entry) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      need(typeof key === 'string' && key !== '__proto__' && descriptor.enumerable && own(descriptor, 'value'), 'SHAPE', 'Compressed observations cannot contain hidden fields or accessors.');
      if (Array.isArray(entry)) { need(/^(0|[1-9]\d*)$/.test(key) && Number(key) < entry.length, 'SHAPE', 'Observation arrays must be dense.'); arrayEntries++; }
      characters += key.length; visit(descriptor.value, depth + 1);
    }
    need(!Array.isArray(entry) || arrayEntries === entry.length, 'SHAPE', 'Observation arrays must be dense.'); seen.delete(entry);
  }
  visit(value, 0);
}
function keys(value, allowed, required, label) {
  need(plain(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => allowed.includes(key)), 'SHAPE', label + ' has an unsupported or missing field.');
}
function integer(value, maximum, label, minimum = 0) {
  need((typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) || Number.isSafeInteger(value))
    && Number(value) >= minimum && Number(value) <= maximum, 'SIZE', label + ' is outside its exact integer bound.'); return Number(value);
}
function base64(value, maximum, label) {
  need(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(maximum / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'BASE64', label + ' is not canonical bounded base64.');
  const bytes = Buffer.from(value, 'base64');
  need(bytes.length > 0 && bytes.length <= maximum && bytes.toString('base64') === value, 'BASE64', label + ' has invalid base64 padding or unused bits.'); return bytes;
}
function captureBase64(value, maximum, label) {
  // n9.0.2's base64 dump is one leading LF, 80-character lines and a
  // terminating LF. Accept that exact producer form or canonical bare base64;
  // never repair arbitrary whitespace, CRLF, empty lines or partial padding.
  if (typeof value === 'string' && value.startsWith('\n')) {
    need(value.endsWith('\n'), 'BASE64', label + ' has a truncated ffprobe base64 wrapper.');
    const lines = value.slice(1, -1).split('\n');
    need(lines.length > 0 && lines.every((line, index) => line.length > 0 && line.length <= 80
      && line.length % 4 === 0 && (index === lines.length - 1 || line.length === 80 && !line.includes('='))),
    'BASE64', label + ' does not match the complete pinned ffprobe base64 wrapping.'); value = lines.join('');
  }
  return base64(value, maximum, label);
}
function dataHash(value, bytes, label) {
  need(typeof value === 'string' && /^SHA256:[a-f0-9]{64}$/.test(value) && value.slice(7) === sha(bytes), 'DATA_HASH', label + ' SHA256 does not match every captured byte.');
}
function limitsOf(value) {
  if (value === undefined) return LIMITS;
  keys(value, Object.keys(LIMITS), [], 'Parser limits');
  return Object.freeze(Object.fromEntries(Object.entries(LIMITS).map(([key, maximum]) =>
    [key, own(value, key) ? integer(value[key], maximum, key, 1) : maximum])));
}
function header(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length >= 3, 'NAL_HEADER', 'A complete two-byte HEVC NAL header and payload are required.');
  need(!(bytes[0] & 128) && (((bytes[0] & 1) << 5) | (bytes[1] >> 3)) === 0 && (bytes[1] & 7) === 1,
    'NAL_HEADER', 'Only single-layer temporal-id-zero HEVC NAL headers are qualified.'); return (bytes[0] >> 1) & 63;
}
function canonicalHevcNal(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length <= LIMITS.maxCompressedBytes, 'LIMIT', 'A bounded HEVC NAL buffer is required.'); header(bytes);
  const body = []; let zeros = 0;
  for (let index = 2; index < bytes.length; index++) {
    const value = bytes[index];
    if (zeros >= 2) {
      if (value === 3) {
        need(index + 1 < bytes.length && bytes[index + 1] <= 3, 'EMULATION_PREVENTION', 'Truncated or unnecessary HEVC emulation-prevention byte.'); zeros = 0; continue;
      }
      need(value > 2, 'EMULATION_PREVENTION', 'Unescaped start-code emulation occurs inside the HEVC NAL.');
    }
    body.push(value); zeros = value === 0 ? zeros + 1 : 0;
  }
  return Buffer.concat([bytes.subarray(0, 2), Buffer.from(body)]);
}
function unsignedGolomb(bytes, bitOffset, maximum, label) {
  let cursor = bitOffset, leading = 0;
  const bit = () => { need(cursor < bytes.length * 8, 'PICTURE', label + ' is truncated.'); const value = bytes[cursor >> 3] >> (7 - (cursor & 7)) & 1; cursor++; return value; };
  while (bit() === 0) { need(++leading <= 6, 'PICTURE', label + ' exceeds the single reviewed parameter-set identifier bound.'); }
  let value = 1; for (let index = 0; index < leading; index++) value = value * 2 + bit(); value--;
  need(value <= maximum, 'PICTURE', label + ' is outside its HEVC identifier bound.'); return value;
}
function profilesOf(values, transfer, limits, outputMode = null) {
  const sdr = outputMode === SDR_OUTPUT;
  need(sdr ? transfer === 'bt709' : own(TRANSFERS, transfer), 'TRANSFER', 'The requested transfer requires its explicit source/output interpretation.');
  need(Array.isArray(values) && values.length > 0 && values.length <= limits.maxProfiles, 'PROFILE', 'A bounded reviewed parameter-set profile catalog is required.');
  inert(values, 1024 * 1024); const ids = new Set();
  const profiles = values.map(value => {
    const fields = ['id', 'width', 'height', 'frameRate', 'transfer', 'sampleAspectRatio', 'hvccHeader', 'parameterSets',
      ...(sdr ? ['outputMode', 'primaries', 'matrix'] : [])];
    keys(value, fields, fields, 'HEVC profile');
    need(typeof value.id === 'string' && /^[A-Za-z0-9._:+-]{1,160}$/.test(value.id) && !ids.has(value.id), 'PROFILE', 'HEVC configuration IDs must be unique bounded identities.'); ids.add(value.id);
    need([[1280, 720], [1920, 1080], [320, 180]].some(([w, h]) => value.width === w && value.height === h)
      && ['24/1', '25/1', '30/1'].includes(value.frameRate) && (sdr
        ? value.width === 1280 && value.height === 720 && ['25/1','30/1'].includes(value.frameRate)
          && value.transfer === 'bt709' && value.primaries === 'bt709' && value.matrix === 'bt709' && value.outputMode === SDR_OUTPUT
        : own(TRANSFERS, value.transfer))
      && value.sampleAspectRatio === (value.width === 320 ? null : '1:1'), 'PROFILE', 'HEVC profile geometry/rate/transfer/SAR is outside this reviewed configuration envelope.');
    const hvc = base64(value.hvccHeader, 22, 'hvcC header');
    need(hvc.length === 22 && hvc[0] === 1 && (hvc[1] & 31) === 2 && (hvc[1] >> 6) === 0
      && (hvc[13] & 0xf0) === 0xf0 && (hvc[15] & 0xfc) === 0xfc && (hvc[16] & 0xfc) === 0xfc
      && (hvc[17] & 0xf8) === 0xf8 && (hvc[18] & 0xf8) === 0xf8
      && (hvc[16] & 3) === 1 && (hvc[17] & 7) === 2 && (hvc[18] & 7) === 2 && (hvc[21] & 3) === 3,
    'PROFILE', 'Reviewed hvcC header must describe canonical version1 four-byte-length Main10 4:2:0.');
    keys(value.parameterSets, ['vps', 'sps', 'pps'], ['vps', 'sps', 'pps'], 'HEVC parameter sets');
    const parameterSets = {};
    for (const [type, name] of Object.entries(PS)) {
      const bytes = base64(value.parameterSets[name], limits.maxParameterSetBytes, 'Reviewed ' + name);
      need(header(bytes) === Number(type) && bytes.at(-1) !== 0, 'PROFILE', 'Complete reviewed parameter-set RBSP bytes are required.'); parameterSets[name] = bytes;
    }
    // Full byte templates include every extension/VUI bit. Their independent
    // semantic review belongs to catalog admission, never to this pure parser.
    const canonical = { id: value.id, width: value.width, height: value.height, frameRate: value.frameRate,
      transfer: value.transfer, sampleAspectRatio: value.sampleAspectRatio, hvccHeader: value.hvccHeader,
      ...(sdr ? { outputMode, primaries: value.primaries, matrix: value.matrix } : {}),
      parameterSets: Object.fromEntries(['vps', 'sps', 'pps'].map(name => [name, value.parameterSets[name]])) };
    return { ...canonical, digest: sha(JSON.stringify(canonical)), hvc, bytes: parameterSets,
      ppsId: unsignedGolomb(parameterSets.pps, 16, 63, 'Reviewed PPS identifier') };
  });
  const matches = profiles.filter(profile => profile.transfer === transfer);
  need(matches.length > 0, 'PROFILE', 'No reviewed HEVC profile describes the requested transfer.'); return matches;
}
const FLAGS = new Set(('wpp pmode pme psnr ssim allow-non-conformance repeat-headers annexb aud eob eos hrd info open-gop b-pyramid hist-scenecut splice intra-refresh rect amp ssim-rd signhide tskip constrained-intra strong-intra-smoothing limit-modes temporal-mvp frame-dup hme weightp weightb analyze-src-pics sao sao-non-deblock early-skip rskip fast-intra tskip-fast cu-lossless b-intra splitrd-skip rd-refine lossless cutree strict-cbr rc-grain const-vbv vui-timing-info vui-hrd-info opt-qp-pps opt-ref-list-length-pps multi-pass-opt-rps opt-cu-delta-qp aq-motion hdr10 hdr10-opt dhdr10-opt idr-recovery-sei limit-sao lowpass-dct dynamic-refine single-sei hevc-aq svt field vbv-live-multi-pass mcstf sbrc frame-rc conformance-window-offsets').split(' '));
const NUMBERS = new Set(('cpuid frame-threads log-level bitdepth input-csp interlace total-frames level-idc high-tier uhd-bd ref hash temporal-layers min-keyint keyint gop-lookahead bframes b-adapt bframe-bias rc-lookahead lookahead-slices scenecut radl ctu min-cu-size max-tu-size tu-inter-depth tu-intra-depth limit-tu rdoq-level dynamic-rd nr-intra nr-inter max-merge limit-refs me subme merange deblock rd selective-sao rdpenalty psy-rd psy-rdoq cbqpoffs crqpoffs crf qp bitrate qcomp qpstep stats-write stats-read ipratio pbratio aq-mode aq-strength zone-count qg-size qpmax qpmin sar overscan videoformat range colorprim transfer colormatrix chromaloc chromaloc-top chromaloc-bottom display-window min-luma max-luma log2-max-poc-lsb slices scenecut-bias analysis-reuse-level analysis-save-reuse-level analysis-load-reuse-level scale-factor refine-intra refine-inter refine-mv refine-ctu-distortion ctu-info refine-analysis-type copy-pic max-ausize-factor qp-adaptation-range scenecut-aware-qp right bottom decoder-max-rate').split(' '));
function description(payload, limit, outputMode = null) {
  need(payload.length >= 17 && payload.length <= limit && payload.subarray(0, 16).toString('hex') === X265_UUID,
    'USER_DATA', 'Unregistered SEI is not a qualified x265 encoder description.');
  const bytes = payload.subarray(16);
  need(bytes.every(value => value >= 32 && value <= 126), 'USER_DATA', 'x265 description contains a control, terminator or non-ASCII payload.');
  const text = bytes.toString('ascii');
  const match = /^x265 \(build 217\) - 4\.3\+45-116b875:\[Windows\]\[GCC 16\.2\.0\]\[64 bit\] 10bit - H\.265\/HEVC codec - Copyright 2013-2018 \(c\) Multicoreware, Inc - http:\/\/x265\.org - options: (.+)$/.exec(text);
  need(match && !match[1].includes('  '), 'USER_DATA', 'The entire x265 description header/options format is not recognized.');
  // This exact fused producer spelling is present in the pinned x265 build.
  const tokens = match[1].replace(/scenecut-aware-qp=([0-9]+)conformance-window-offsets/g, 'scenecut-aware-qp=$1 conformance-window-offsets').split(' ');
  const values = {}, seen = new Set();
  for (const token of tokens) {
    const equal = token.indexOf('=');
    if (equal < 0) {
      const flag = token.startsWith('no-') ? token.slice(3) : token;
      need(FLAGS.has(flag) && !seen.has(flag), 'USER_DATA', 'Unknown or duplicate x265 description flag.'); seen.add(flag); values[flag] = !token.startsWith('no-'); continue;
    }
    const key = token.slice(0, equal), value = token.slice(equal + 1);
    need(!seen.has(key) && value.length > 0, 'USER_DATA', 'Duplicate or empty x265 description option.'); seen.add(key);
    if (key === 'fps') need(/^(24|25|30)\/1$/.test(value), 'USER_DATA', 'Unqualified x265 description frame rate.');
    else if (key === 'input-res') need(/^(1280x720|1920x1080|320x180)$/.test(value), 'USER_DATA', 'Unqualified x265 description geometry.');
    else if (key === 'numa-pools') need(/^(none|[0-9]{1,3}(,[0-9]{1,3}){0,63})$/.test(value), 'USER_DATA', 'Unrecognized x265 NUMA description.');
    else if (key === 'rc') need(['crf', 'cqp', 'abr'].includes(value), 'USER_DATA', 'Unrecognized x265 rate-control description.');
    else if (key === 'master-display') need(/^G\(\d{1,5},\d{1,5}\)B\(\d{1,5},\d{1,5}\)R\(\d{1,5},\d{1,5}\)WP\(\d{1,5},\d{1,5}\)L\(\d{1,10},\d{1,10}\)$/.test(value), 'USER_DATA', 'Malformed x265 mastering description.');
    else if (key === 'cll') need(/^\d{1,5},\d{1,5}$/.test(value) && value.split(',').every(part => Number(part) <= 65535), 'USER_DATA', 'Malformed x265 content-light description.');
    else if (key === 'deblock') need(/^-?[0-6]:-?[0-6]$/.test(value), 'USER_DATA', 'Malformed x265 deblock description.');
    else need(NUMBERS.has(key) && /^-?(0|[1-9]\d{0,9})(\.\d{1,6})?$/.test(value) && Math.abs(Number(value)) <= 4294967295,
      'USER_DATA', 'Unknown or malformed x265 description option.');
    values[key] = value;
  }
  for (const key of ['bitdepth', 'input-csp', 'fps', 'input-res', 'interlace', 'sar', 'overscan', 'range', 'colorprim', 'transfer', 'colormatrix', 'chromaloc', 'chromaloc-top', 'chromaloc-bottom', 'display-window', 'right', 'bottom'])
    need(own(values, key), 'USER_DATA', 'x265 description omits a required interpretation field.');
  for (const [key, expected] of Object.entries({ bitdepth: '10', 'input-csp': '1', interlace: '0', overscan: '0', range: '0', colorprim: outputMode === SDR_OUTPUT ? '1' : '9', colormatrix: outputMode === SDR_OUTPUT ? '1' : '9', chromaloc: '1', 'chromaloc-top': '0', 'chromaloc-bottom': '0', 'display-window': '0', right: '0', bottom: '0' }))
    need(values[key] === expected, 'USER_DATA', 'x265 description contains an unqualified interpretation value.');
  return { sha256: sha(payload), values };
}
function stateOf(profiles, transfer, limits, framing, outputMode = null) {
  let candidates = profiles, vclCount = 0, seiCount = 0, totalBytes = 0, mastering = null, contentLight = null, alternative = null;
  const seen = new Set(), nals = [], descriptions = [], packets = [], arrays = [];
  function metadata(previous, next, label) {
    need(previous !== null || vclCount === 0, 'LATE_METADATA', label + ' first appears after picture interpretation began.');
    need(previous === null || JSON.stringify(previous) === JSON.stringify(next), 'METADATA_CHANGE', label + ' changes within the compressed source.'); return previous || next;
  }
  function sei(raw, nalIndex) {
    const body = raw.subarray(2); let cursor = 0;
    need(body.length >= 1, 'SEI', 'Empty SEI RBSP.'); const inventory = [];
    while (!(cursor === body.length - 1 && body[cursor] === 128)) {
      need(cursor < body.length - 1, 'SEI', 'Complete SEI messages and exact trailing bits are required.');
      let type = 0, size = 0, value;
      do { need(cursor < body.length - 1, 'SEI', 'Truncated extended SEI payload type.'); value = body[cursor++]; type += value;
        need(type <= 65535, 'SEI', 'SEI payload type exceeds the finite bound.'); } while (value === 255);
      do { need(cursor < body.length - 1, 'SEI', 'Truncated extended SEI payload size.'); value = body[cursor++]; size += value;
        need(size <= limits.maxSeiPayloadBytes, 'LIMIT', 'SEI payload exceeds the finite byte bound.'); } while (value === 255);
      need(size > 0 && cursor + size <= body.length - 1 && ++seiCount <= limits.maxSeiMessages, 'SEI', 'SEI payload is empty, truncated or excessive.');
      const payload = body.subarray(cursor, cursor + size); cursor += size;
      need(outputMode !== SDR_OUTPUT || type === 5, 'SDR_METADATA', 'SDR output must not retain obsolete HDR/static/alternative-transfer SEI.');
      if (type === 137) {
        need(size === 24, 'STATIC_METADATA', 'Mastering-display SEI must contain exactly24 bytes.');
        const c = offset => payload.readUInt16BE(offset), l = offset => payload.readUInt32BE(offset);
        need([0, 2, 4, 6, 8, 10, 12, 14].every(offset => c(offset) <= 50000) && l(16) > 0 && l(20) <= l(16), 'STATIC_METADATA', 'Mastering-display integer values are invalid.');
        mastering = metadata(mastering, { red_x: c(8) + '/50000', red_y: c(10) + '/50000', green_x: c(0) + '/50000', green_y: c(2) + '/50000',
          blue_x: c(4) + '/50000', blue_y: c(6) + '/50000', white_point_x: c(12) + '/50000', white_point_y: c(14) + '/50000',
          min_luminance: l(20) + '/10000', max_luminance: l(16) + '/10000' }, 'Mastering-display metadata');
      } else if (type === 144) {
        need(size === 4, 'STATIC_METADATA', 'Content-light SEI must contain exactly4 bytes.'); const maximum = payload.readUInt16BE(0), average = payload.readUInt16BE(2);
        need(!maximum || !average || average <= maximum, 'STATIC_METADATA', 'Average light exceeds the nonzero maximum.');
        contentLight = metadata(contentLight, { max_content: maximum, max_average: average }, 'Content-light metadata');
      } else if (type === 147) {
        need(size === 1 && payload[0] === TRANSFERS[transfer], 'TRANSFER', 'Alternative transfer must exactly repeat the qualified SPS transfer.');
        alternative = metadata(alternative, payload[0], 'Alternative transfer');
      } else if (type === 5) descriptions.push(description(payload, limits.maxSeiPayloadBytes, outputMode));
      else fail('SEI_UNSUPPORTED', 'Unassessed prefix SEI payload type ' + type + ' cannot be dropped.');
      inventory.push({ type, bytes: size, sha256: sha(payload) });
    }
    need(cursor === body.length - 1 && body[cursor] === 128, 'SEI', 'SEI RBSP has unconsumed bytes or invalid trailing bits.'); return inventory;
  }
  function nal(bytes, origin) {
    need(nals.length < limits.maxNals, 'LIMIT', 'HEVC NAL count exceeds its bound.'); totalBytes += bytes.length;
    need(totalBytes <= limits.maxCompressedBytes, 'LIMIT', 'Complete compressed HEVC bytes exceed their aggregate bound.');
    const raw = canonicalHevcNal(bytes), type = header(raw); let messages = [];
    need(own(PS, type) || type === 39 || VCL.has(type), 'NAL_UNSUPPORTED', 'Unassessed HEVC NAL type ' + type + ' is refused.');
    if (own(PS, type)) {
      need(raw.length <= limits.maxParameterSetBytes, 'LIMIT', 'Parameter-set bytes exceed the reviewed bound.');
      candidates = candidates.filter(profile => profile.bytes[PS[type]].equals(raw));
      need(candidates.length > 0, 'CONFIGURATION', 'Complete HEVC parameter-set bytes do not match a reviewed configuration.'); seen.add(type);
    } else if (type === 39) messages = sei(raw, nals.length);
    else {
      need(origin.kind !== 'extradata' && [32, 33, 34].every(value => seen.has(value)), 'PARAMETER_SETS', 'All reviewed parameter sets must precede coded pictures.');
      need(vclCount > 0 || type === 19 || type === 20, 'PICTURE', 'This complete stream must begin with an independent IDR picture.');
      need((raw[2] & 128) !== 0, 'PICTURE', 'Only one complete first slice per coded picture is qualified.');
      const ppsId = unsignedGolomb(raw, 16 + (type >= 16 ? 2 : 1), 63, 'Coded picture PPS identifier');
      candidates = candidates.filter(profile => profile.ppsId === ppsId);
      need(candidates.length > 0, 'PICTURE', 'A coded picture references an unreviewed PPS identifier.'); vclCount++;
    }
    nals.push({ index: nals.length, type, bytes: bytes.length, sha256: sha(bytes), rbspSha256: sha(raw), origin, ...(messages.length ? { sei: messages } : {}) }); return type;
  }
  function finish() {
    need(vclCount > 0 && [32, 33, 34].every(value => seen.has(value)), 'PICTURE', 'A complete qualified parameter-set/picture sequence is required.');
    need(candidates.length === 1, 'CONFIGURATION', 'Compressed bytes do not identify one unambiguous reviewed configuration.');
    const profile = candidates[0];
    for (const item of descriptions) {
      const values = item.values;
      need(values.fps === profile.frameRate && values['input-res'] === profile.width + 'x' + profile.height && values.transfer === String(outputMode === SDR_OUTPUT ? 1 : TRANSFERS[transfer]), 'USER_DATA', 'The x265 description contradicts its reviewed parameter-set configuration.');
      need(values.sar === (profile.sampleAspectRatio === null ? '0' : '1'), 'USER_DATA', 'The x265 description contradicts its reviewed SAR interpretation.');
      if (own(values, 'master-display')) {
        need(mastering !== null, 'USER_DATA', 'The x265 mastering description has no matching static metadata payload.');
        const number = key => mastering[key].split('/')[0];
        const expected = `G(${number('green_x')},${number('green_y')})B(${number('blue_x')},${number('blue_y')})R(${number('red_x')},${number('red_y')})WP(${number('white_point_x')},${number('white_point_y')})L(${number('max_luminance')},${number('min_luminance')})`;
        need(values['master-display'] === expected, 'USER_DATA', 'The x265 mastering description contradicts the complete SEI values.');
      }
      if (own(values, 'cll')) need(values.cll === (contentLight ? contentLight.max_content + ',' + contentLight.max_average : '0,0'), 'USER_DATA', 'The x265 content-light description contradicts the complete SEI values.');
    }
    const configuration = { id: profile.id, digest: profile.digest, width: profile.width, height: profile.height, frameRate: profile.frameRate, transfer, sampleAspectRatio: profile.sampleAspectRatio,
      ...(outputMode === SDR_OUTPUT ? { primaries: profile.primaries, matrix: profile.matrix } : {}) };
    const facts = { version: VERSION, framing, configuration, transfer,
      ...(outputMode === SDR_OUTPUT ? { outputMode } : {}), metadata: { mastering, contentLight }, alternativeTransfer: alternative,
      compressedBytes: totalBytes, pictureCount: vclCount, packetCount: packets.length, nalCount: nals.length, seiCount,
      arrays, packetInventory: packets, nalInventory: nals,
      warnings: [...(descriptions.length ? [{ code: 'HEVC_ENCODER_DESCRIPTION_REPLACED', count: descriptions.length,
        message: 'Complete recognized x265 encoder descriptions are assessed descriptive; replacement is permitted only with independent media validation.' }] : []),
      ...(alternative !== null ? [{ code: 'HEVC_REDUNDANT_TRANSFER_SIGNAL', value: alternative, message: 'Alternative transfer exactly repeats the reviewed SPS transfer.' }] : [])] };
    return freeze({ ...facts, fingerprint: sha(JSON.stringify(facts)) });
  }
  return { nal, finish, packets, arrays, headerMatches(bytes) { candidates = candidates.filter(profile => profile.hvc.equals(bytes));
    need(candidates.length > 0, 'CONFIGURATION', 'Complete hvcC header bytes do not match a reviewed configuration.'); } };
}
function optionsOf(options) {
  inert(options, 2 * 1024 * 1024);
  keys(options, ['profiles', 'transfer', 'limits', 'outputMode'], ['profiles', 'transfer'], 'HEVC classifier options');
  need(!own(options, 'outputMode') || options.outputMode === SDR_OUTPUT, 'PROFILE', 'Only the explicit BT.709 Main10 output mode is supported.');
  const outputMode = options.outputMode ?? null, limits = limitsOf(options.limits);
  return { limits, profiles: profilesOf(options.profiles, options.transfer, limits, outputMode), transfer: options.transfer, outputMode };
}
function equalRational(actual, expected) {
  if (typeof actual !== 'string' || !/^\d{1,12}\/[1-9]\d{0,12}$/.test(actual)) return false;
  const [an, ad] = actual.split('/').map(BigInt), [en, ed] = expected.split('/').map(BigInt); return an * ed === en * ad;
}
function checkStreamDeclarations(stream, summary) {
  const sdr = summary.outputMode === SDR_OUTPUT;
  const expected = { codec_name: 'hevc', codec_type: 'video', profile: 'Main 10', width: summary.configuration.width, height: summary.configuration.height,
    pix_fmt: 'yuv420p10le', color_range: 'tv', color_space: sdr ? 'bt709' : 'bt2020nc', color_transfer: summary.transfer, color_primaries: sdr ? 'bt709' : 'bt2020',
    chroma_location: 'left', field_order: 'progressive', time_base: '1/1000' };
  for (const [key, value] of Object.entries(expected)) need(!own(stream, key) || stream[key] === value, 'STREAM', 'Stream ' + key + ' contradicts the reviewed compressed configuration.');
  for (const key of ['view_ids_available', 'view_pos_available']) need(!own(stream, key) || stream[key] === '', 'STREAM', 'Nonempty view declarations require a separately qualified multilayer route.');
  if (summary.configuration.sampleAspectRatio === null) {
    for (const key of ['sample_aspect_ratio', 'display_aspect_ratio']) need(!own(stream, key), 'STREAM', 'The legacy configuration preserves absent SAR/DAR declarations only.');
  } else {
    need(!own(stream, 'sample_aspect_ratio') || stream.sample_aspect_ratio === '1:1', 'STREAM', 'Stream SAR contradicts the reviewed square-pixel configuration.');
    if (own(stream, 'display_aspect_ratio')) {
      const dar = /^(\d{1,9}):(\d{1,9})$/.exec(String(stream.display_aspect_ratio));
      need(dar && BigInt(dar[1]) > 0n && BigInt(dar[2]) > 0n && BigInt(dar[1]) * BigInt(summary.configuration.height) === BigInt(dar[2]) * BigInt(summary.configuration.width), 'STREAM', 'Stream DAR contradicts the reviewed square-pixel configuration.');
    }
  }
  need(!own(stream, 'start_pts') || String(stream.start_pts) === '0', 'STREAM', 'Only the qualified zero-origin presentation is available.');
  need(!own(stream, 'start_time') || Number(stream.start_time) === 0, 'STREAM', 'Only the qualified zero-origin presentation is available.');
  need(!own(stream, 'r_frame_rate') || stream.r_frame_rate === summary.configuration.frameRate, 'STREAM', 'Nominal stream rate contradicts the reviewed configuration.');
  need(!own(stream, 'avg_frame_rate') || [summary.configuration.frameRate, '0/0'].includes(stream.avg_frame_rate), 'STREAM', 'Average stream rate contradicts the reviewed configuration.');
  for (const [key, dimension] of [['coded_width', summary.configuration.width], ['coded_height', summary.configuration.height]]) if (own(stream, key)) {
    integer(stream[key], dimension + 63, 'Reported coded geometry', dimension);
  }
  if (own(stream, 'nb_read_packets')) need(integer(stream.nb_read_packets, LIMITS.maxPackets, 'Complete reported packet count', 1) === summary.packetCount, 'PACKETS', 'Reported packet count differs from the complete captured inventory.');
  if (own(stream, 'disposition')) need(plain(stream.disposition) && Object.values(stream.disposition).every(value => value === 0 || value === '0'), 'STREAM', 'Nonzero stream disposition is outside this configuration family.');
  if (own(stream, 'tags')) need(plain(stream.tags) && !Object.keys(stream.tags).some(key => /^(rotate|rotation|orientation)$/i.test(key)), 'STREAM', 'Rotation metadata requires a separately qualified geometry route.');
  if (own(stream, 'side_data_list')) {
    need(Array.isArray(stream.side_data_list), 'STREAM_SIDE_DATA', 'Stream side data must be a complete bounded list.'); const seen = new Set();
    for (const entry of stream.side_data_list) {
      need(plain(entry) && typeof entry.side_data_type === 'string' && !seen.has(entry.side_data_type), 'STREAM_SIDE_DATA', 'Malformed or duplicate stream side data.'); seen.add(entry.side_data_type);
      if (entry.side_data_type === 'Mastering display metadata') {
        const expectedMastering = summary.metadata.mastering;
        need(expectedMastering && Object.keys(entry).length === 11 && Object.entries(expectedMastering).every(([key, value]) => equalRational(entry[key], value)), 'STREAM_SIDE_DATA', 'Stream mastering metadata contradicts complete compressed payload evidence.');
      } else if (entry.side_data_type === 'Content light level metadata') {
        const expectedLight = summary.metadata.contentLight;
        need(expectedLight && Object.keys(entry).length === 3 && ['max_content', 'max_average'].every(key => String(entry[key]) === String(expectedLight[key])), 'STREAM_SIDE_DATA', 'Stream content-light metadata contradicts complete compressed payload evidence.');
      } else fail('STREAM_SIDE_DATA', 'Unassessed functional stream side data cannot be discarded.');
    }
  }
}
function classifyHevcPackets(payload, options) {
  const { limits, profiles, transfer, outputMode } = optionsOf(options); inert(payload, limits.maxJsonBytes);
  need(Buffer.byteLength(JSON.stringify(payload)) <= limits.maxJsonBytes, 'LIMIT', 'Compressed packet JSON exceeds its explicit byte ceiling.');
  need(plain(payload) && Object.keys(payload).every(key => ['streams', 'packets'].includes(key))
    && Array.isArray(payload.streams) && payload.streams.length === 1 && Array.isArray(payload.packets)
    && payload.packets.length > 0 && payload.packets.length <= limits.maxPackets, 'PACKETS', 'Exactly one stream and a complete bounded packet sequence are required.');
  const stream = payload.streams[0];
  need(plain(stream) && integer(stream.index, 0, 'Stream index') === 0, 'STREAM', 'Compressed evidence must describe the only video stream at index0.');
  const extra = captureBase64(stream.extradata, limits.maxCompressedBytes, 'Codec extradata');
  need(extra.length === integer(stream.extradata_size, limits.maxCompressedBytes, 'Extradata size', 1), 'SIZE', 'Codec extradata size does not match captured bytes.'); dataHash(stream.extradata_hash, extra, 'Extradata');
  need(extra.length >= 23 && extra[0] === 1, 'HVCC', 'Complete version1 hvcC extradata is required.');
  const state = stateOf(profiles, transfer, limits, 'hvcC-and-four-byte-length-packets', outputMode); state.headerMatches(extra.subarray(0, 22));
  const arrayCount = extra[22]; need(arrayCount >= 3 && arrayCount <= 8, 'HVCC', 'hvcC array count is outside the finite configuration envelope.');
  let cursor = 23; const arrayTypes = new Set();
  for (let array = 0; array < arrayCount; array++) {
    need(cursor + 3 <= extra.length, 'HVCC', 'Truncated hvcC array header.'); const flags = extra[cursor++], type = flags & 63, count = extra.readUInt16BE(cursor); cursor += 2;
    need(!(flags & 64) && [32, 33, 34, 39].includes(type) && !arrayTypes.has(type) && count > 0 && count <= 64, 'HVCC', 'Unknown, duplicate, empty or malformed hvcC array.'); arrayTypes.add(type);
    state.arrays.push({ index: array, type, complete: Boolean(flags & 128), count });
    for (let index = 0; index < count; index++) {
      need(cursor + 2 <= extra.length, 'HVCC', 'Truncated hvcC NAL length.'); const size = extra.readUInt16BE(cursor); cursor += 2;
      need(size >= 3 && cursor + size <= extra.length, 'HVCC', 'Truncated or empty hvcC NAL.'); const bytes = extra.subarray(cursor, cursor + size); cursor += size;
      need(header(bytes) === type, 'HVCC', 'hvcC array type contradicts its NAL header.'); state.nal(bytes, { kind: 'extradata', array, index });
    }
  }
  need(cursor === extra.length && [32, 33, 34].every(type => arrayTypes.has(type)), 'HVCC', 'hvcC must completely contain each parameter-set array without trailing bytes.');
  let captured = extra.length;
  for (const [index, packet] of payload.packets.entries()) {
    need(plain(packet) && packet.stream_index === 0 && (!own(packet, 'side_data_list') || Array.isArray(packet.side_data_list) && packet.side_data_list.length === 0), 'PACKET_SIDE_DATA', 'Every packet must belong to stream0 and have no unassessed packet side data.');
    need((!own(packet, 'codec_type') || packet.codec_type === 'video') && (!own(packet, 'flags') || /^[K_]__$/.test(packet.flags)), 'PACKETS', 'Discard, corrupt or contradictory packet declarations cannot qualify content.');
    const bytes = captureBase64(packet.data, limits.maxCompressedBytes, 'Packet data'); const size = integer(packet.size, limits.maxCompressedBytes, 'Packet size', 1);
    need(bytes.length === size, 'SIZE', 'Packet size differs from every captured byte.'); dataHash(packet.data_hash, bytes, 'Packet'); captured += size;
    need(captured <= limits.maxCompressedBytes, 'LIMIT', 'Captured packets plus codec extradata exceed the compressed byte ceiling.');
    let position = 0, count = 0, pictures = 0;
    while (position < bytes.length) {
      need(position + 4 <= bytes.length, 'PACKET_LENGTH', 'Truncated four-byte HEVC packet NAL length.'); const length = bytes.readUInt32BE(position); position += 4;
      need(length >= 3 && position + length <= bytes.length && ++count <= limits.maxNalsPerPacket, 'PACKET_LENGTH', 'Empty, truncated or excessive packet NAL sequence.');
      const type = state.nal(bytes.subarray(position, position + length), { kind: 'packet', packet: index, index: count - 1 }); position += length; if (VCL.has(type)) pictures++;
    }
    need(position === bytes.length && pictures === 1, 'PICTURE', 'Every qualified packet must contain exactly one complete coded picture.');
    state.packets.push({ index, bytes: size, sha256: sha(bytes), nalCount: count });
  }
  const summary = state.finish(); checkStreamDeclarations(stream, summary); return summary;
}
function classifyAnnexB(bytes, options) {
  const { limits, profiles, transfer, outputMode } = optionsOf(options);
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= limits.maxCompressedBytes, 'LIMIT', 'A complete bounded Annex-B buffer is required.');
  const starts = [];
  for (let index = 0; index < bytes.length - 2; index++) {
    let length = 0;
    if (bytes[index] === 0 && bytes[index + 1] === 0) {
      if (bytes[index + 2] === 0 && bytes[index + 3] === 1) length = 4;
      else if (bytes[index + 2] === 1) length = 3;
    }
    if (length) { starts.push({ offset: index, length }); need(starts.length <= limits.maxNals, 'LIMIT', 'Annex-B NAL count exceeds its bound.'); index += length - 1; }
  }
  need(starts.length > 0 && starts[0].offset === 0, 'ANNEX_B', 'Annex-B framing must begin at the first observed byte.');
  const state = stateOf(profiles, transfer, limits, 'annex-b', outputMode);
  for (const [index, start] of starts.entries()) {
    const from = start.offset + start.length; let end = starts[index + 1]?.offset ?? bytes.length;
    // Annex-B trailing_zero_8bits are outside the NAL. Count them explicitly;
    // never trim a SEI payload or treat zero as its message terminator.
    const framedEnd = end; while (end > from && bytes[end - 1] === 0) end--;
    need(end - from >= 3, 'ANNEX_B', 'An Annex-B start code has no complete NAL payload.');
    state.nal(bytes.subarray(from, end), { kind: 'annex-b', index, startCodeBytes: start.length, trailingZeroBytes: framedEnd - end });
  }
  return state.finish();
}

module.exports = { HEVC_CONTENT_VERSION: VERSION, HEVC_CONTENT_LIMITS: LIMITS, canonicalHevcNal, classifyHevcPackets, classifyAnnexB };
