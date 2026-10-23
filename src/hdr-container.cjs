'use strict';

// Pure observation of named raw timing scalars only. Main binds these facts to
// complete source/output bytes and owns all qualification/publication grants.
const LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, elements: 8192, depth: 4 });
const ID = Object.freeze({ ebml: 0x1a45dfa3, segment: 0x18538067, info: 0x1549a966, tracks: 0x1654ae6b, entry: 0xae,
  timestamp: 0x2ad7b1, duration: 0x4489, defaultDuration: 0x23e383, trackScale: 0x23314f, delay: 0x56aa, offset: 0x537f,
  type: 0x83, codec: 0x86, enabled: 0xb9, doctype: 0x4282, void: 0xec, crc: 0xbf });
const NAMED = new Set(Object.values(ID).filter(id => id !== ID.void && id !== ID.crc));
const fail = (code, message) => { throw Object.assign(new Error(message), { code: 'HDR_CONTAINER_' + code }); };
const need = (condition, code, message) => { if (!condition) fail(code, message); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

function inspectHdrContainer(bytes, options) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMITS.bytes
    && !(typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer), 'LIMIT', 'A complete nonshared bounded container Buffer is required.');
  need(options && typeof options === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(options)), 'SHAPE', 'Inert container options are required.');
  const keys = Reflect.ownKeys(options), descriptor = Object.getOwnPropertyDescriptor(options, 'frameRate');
  need(keys.length === 1 && keys[0] === 'frameRate' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), 'SHAPE', 'Only a plain frameRate value is accepted.');
  need(['24/1', '25/1', '30/1'].includes(descriptor.value), 'RATE', 'Only reviewed integer frame-rate strings are accepted.');
  const rate = BigInt(descriptor.value.slice(0, -2)); let count = 0;
  const facts = {}, origins = {};

  function vint(at, end, isId) {
    need(at < end, 'TRUNCATED', 'Truncated EBML variable integer.');
    const first = bytes[at]; let length = 1, marker = 0x80;
    while (length <= 8 && !(first & marker)) { marker >>= 1; length++; }
    need(length <= (isId ? 4 : 8), 'VINT', 'Invalid or unsupported EBML variable integer width.');
    need(at + length <= end, 'TRUNCATED', 'Truncated EBML variable integer bytes.');
    let value = BigInt(isId ? first : first & (marker - 1));
    for (let index = 1; index < length; index++) value = value * 256n + BigInt(bytes[at + index]);
    if (isId) {
      const data = value ^ (1n << BigInt(7 * length));
      need(data !== (1n << BigInt(7 * length)) - 1n && (length === 1 || data >= (1n << BigInt(7 * (length - 1))) - 1n), 'VINT', 'Reserved or noncanonical EBML element ID.');
    }
    return { length, value, unknown: !isId && value === (1n << BigInt(7 * length)) - 1n };
  }
  function element(at, end, segmentUnknown = false) {
    need(++count <= LIMITS.elements, 'LIMIT', 'Container element count exceeds the finite scalar-reader budget.');
    const id = vint(at, end, true), size = vint(at + id.length, end, false), data = at + id.length + size.length;
    need(!size.unknown || segmentUnknown && Number(id.value) === ID.segment, 'UNKNOWN_SIZE', 'Only the outer Segment may have unknown size.');
    const length = size.unknown ? BigInt(end - data) : size.value;
    need(length <= BigInt(end - data), 'TRUNCATED', 'EBML element exceeds its containing boundary.');
    return { id: Number(id.value), at, data, length: Number(length), end: data + Number(length), unknown: size.unknown };
  }
  function walk(start, end, depth, visit) {
    need(depth <= LIMITS.depth, 'LIMIT', 'Container scalar nesting exceeds its fixed depth.');
    for (let at = start; at < end;) { const item = element(at, end); visit(item); at = item.end; }
  }
  function uint(item, signed = false) {
    need(item.length >= 1 && item.length <= 8, 'SCALAR', 'Container integer must contain one through eight bytes.');
    let value = 0n; for (let at = item.data; at < item.end; at++) value = value * 256n + BigInt(bytes[at]);
    if (signed && bytes[item.data] & 0x80) value -= 1n << BigInt(8 * item.length);
    return value;
  }
  function float(item) {
    need(item.length === 4 || item.length === 8, 'SCALAR', 'Container float must contain four or eight bytes.');
    const value = item.length === 4 ? bytes.readFloatBE(item.data) : bytes.readDoubleBE(item.data);
    need(Number.isFinite(value), 'SCALAR', 'Nonfinite container timing is forbidden.'); return value;
  }
  function observe(name, item, value, path) {
    need(!Object.hasOwn(facts, name), 'DUPLICATE', 'Repeated container timing or identity scalar is ambiguous.');
    facts[name] = String(value); origins[name] = { present: true, path, offset: item.data, bytes: item.length };
  }
  function skipped(item) {
    need(!NAMED.has(item.id), 'PLACEMENT', 'Named container timing/identity element appears at an unsupported path.');
    // Known-length uninspected payloads carry no generic preservation claim.
  }
  const head = element(0, bytes.length);
  need(head.id === ID.ebml, 'STRUCTURE', 'A single leading EBML header is required.');
  let doctype = false; const headerSeen = new Set();
  walk(head.data, head.end, 1, item => {
    if (item.id === ID.doctype) {
      need(!doctype && bytes.subarray(item.data, item.end).equals(Buffer.from('matroska')), 'STRUCTURE', 'Exactly one Matroska DocType is required.'); doctype = true;
    } else if ([0x4286, 0x42f7, 0x42f2, 0x42f3, 0x4287, 0x4285].includes(item.id)) {
      need(!headerSeen.has(item.id), 'DUPLICATE', 'Repeated EBML header declaration.'); headerSeen.add(item.id); const value = uint(item);
      need(item.id === 0x42f2 ? value === 4n : item.id === 0x42f3 ? value > 0n && value <= 8n
        : [0x4287, 0x4285].includes(item.id) ? value > 0n && value <= 4n : value === 1n, 'STRUCTURE', 'Unsupported EBML header declaration.');
    } else skipped(item);
  });
  need(doctype, 'STRUCTURE', 'Explicit Matroska DocType is required.');
  let at = head.end;
  while (at < bytes.length) { const next = element(at, bytes.length, true); if (next.id === ID.void || next.id === ID.crc) { at = next.end; continue; } break; }
  const segment = element(at, bytes.length, true);
  need(segment.id === ID.segment && segment.end === bytes.length, 'STRUCTURE', 'One complete Segment ending at file EOF is required.');
  let info = false, tracks = false, entry = false;
  walk(segment.data, segment.end, 1, item => {
    if (item.id === ID.info) {
      need(!info, 'DUPLICATE', 'Repeated Segment Info is ambiguous.'); info = true;
      walk(item.data, item.end, 2, scalar => {
        if (scalar.id === ID.timestamp) {
          const value = uint(scalar); need(value === 1000000n, 'TIMING', 'Raw TimestampScale must be exactly one million nanoseconds.');
          observe('timestampScaleNs', scalar, value, 'Segment/Info/TimestampScale');
        } else if (scalar.id === ID.duration) {
          const value = float(scalar); need(Number.isSafeInteger(value) && value > 0 && value <= 60000, 'TIMING', 'Declared duration must be a positive integral native millisecond within sixty seconds.');
          observe('declaredDurationTicks', scalar, value, 'Segment/Info/Duration');
        } else skipped(scalar);
      });
    } else if (item.id === ID.tracks) {
      need(!tracks, 'DUPLICATE', 'Repeated Tracks is ambiguous.'); tracks = true;
      walk(item.data, item.end, 2, track => {
        if (track.id !== ID.entry) { skipped(track); return; }
        need(!entry, 'DUPLICATE', 'Exactly one TrackEntry is required.'); entry = true;
        walk(track.data, track.end, 3, scalar => {
          const base = 'Segment/Tracks/TrackEntry/';
          if (scalar.id === ID.type) { const value = uint(scalar); need(value === 1n, 'TRACK', 'The sole track must be video.'); observe('trackType', scalar, value, base + 'TrackType'); }
          else if (scalar.id === ID.codec) { need(bytes.subarray(scalar.data, scalar.end).equals(Buffer.from('V_MPEGH/ISO/HEVC')), 'TRACK', 'The sole track must explicitly declare HEVC.'); observe('codecId', scalar, 'V_MPEGH/ISO/HEVC', base + 'CodecID'); }
          else if (scalar.id === ID.enabled) { const value = uint(scalar); need(value !== 0n, 'TRACK_DISABLED', 'A disabled Matroska track is outside the preservation family.'); need(value === 1n, 'TRACK', 'FlagEnabled must be a known unsigned boolean.'); observe('trackEnabled', scalar, value, base + 'FlagEnabled'); }
          else if (scalar.id === ID.defaultDuration) { const value = uint(scalar); need(value === 1000000000n / rate, 'TIMING', 'Raw DefaultDuration must exactly match the reviewed nanosecond period.'); observe('defaultDurationNs', scalar, value, base + 'DefaultDuration'); }
          else if (scalar.id === ID.trackScale) { const value = float(scalar); need(value === 1, 'TIMING', 'TrackTimestampScale must be exactly one.'); observe('trackTimeScale', scalar, value, base + 'TrackTimestampScale'); }
          else if (scalar.id === ID.delay || scalar.id === ID.offset) { const value = uint(scalar, scalar.id === ID.offset); need(value === 0n, 'TIMING', 'CodecDelay and TrackOffset must be zero.'); const name = scalar.id === ID.delay ? 'codecDelayNs' : 'trackOffsetNs'; observe(name, scalar, value, base + (scalar.id === ID.delay ? 'CodecDelay' : 'TrackOffset')); }
          else skipped(scalar);
        });
      });
    } else skipped(item);
  });
  need(info && tracks && entry && ['timestampScaleNs', 'declaredDurationTicks', 'defaultDurationNs', 'trackType', 'codecId'].every(key => Object.hasOwn(facts, key)), 'MISSING', 'Complete explicit container timing and one HEVC track are required.');
  for (const [key, value, name] of [['trackTimeScale', '1', 'TrackTimestampScale'], ['codecDelayNs', '0', 'CodecDelay'], ['trackOffsetNs', '0', 'TrackOffset'], ['trackEnabled', '1', 'FlagEnabled']]) if (!Object.hasOwn(facts, key)) {
    facts[key] = value; origins[key] = { present: false, path: 'Segment/Tracks/TrackEntry/' + name, default: 'Matroska-schema' };
  }
  return freeze({ timestampScaleNs: facts.timestampScaleNs, defaultDurationNs: facts.defaultDurationNs, declaredDurationTicks: facts.declaredDurationTicks,
    trackTimeScale: facts.trackTimeScale, codecDelayNs: facts.codecDelayNs, trackOffsetNs: facts.trackOffsetNs, trackEnabled: facts.trackEnabled, origins });
}

module.exports = { HDR_CONTAINER_LIMITS: LIMITS, inspectHdrContainer };
