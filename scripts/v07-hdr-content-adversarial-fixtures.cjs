'use strict';

// Qualification-fixture construction only. This module never executes a tool,
// writes a file, grants eligibility, or claims native producer authenticity.
const { createHash } = require('node:crypto');
const { canonicalHevcNal, classifyHevcPackets } = require('../src/hevc-content.cjs');
const { inspectHdrContainer } = require('../src/hdr-container.cjs');
const LIMITS = Object.freeze({ sourceBytes: 16 * 1024 * 1024, captureBytes: 24 * 1024 * 1024,
  elements: 32768, depth: 12, packets: 1800, nals: 16384, seiBytes: 8192 });
const UUID = Buffer.from('2ca2de09b51747dbbb55a4fe7fc2fc4e', 'hex');
const MASTER = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966, 0x1654ae6b, 0xae,
  0xe0, 0x55b0, 0x55d0, 0x1f43b675, 0xa0, 0x75a1, 0xa6, 0x1c53bb6b, 0xbb, 0xb7, 0xdb,
  0x1254c367, 0x7373, 0x63c0, 0x67c8, 0x1043a770, 0x45b9, 0xb6, 0x80, 0x8f, 0x6944,
  0x6911, 0x6240, 0x5034, 0x5035, 0x6d80]);
const CODES = Object.freeze({ A1: 'HEVC_CONTENT_USER_DATA', A2: 'HEVC_CONTENT_USER_DATA', A3: 'HEVC_CONTENT_NAL_UNSUPPORTED',
  A4: 'HEVC_CONTENT_TRANSFER', A5: 'HEVC_CONTENT_CONFIGURATION', A6: 'HEVC_CONTENT_CONFIGURATION' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code: 'HDR_ADVERSARIAL_' + code }); };
const need = (condition, code, message) => { if (!condition) fail(code, message); };
function freeze(value) { if (value && typeof value === 'object' && !Buffer.isBuffer(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function matroskaCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function crcFor(bytes, master, crc) {
  return matroskaCrc32(Buffer.concat([bytes.subarray(master.data, crc.at), bytes.subarray(crc.end, master.end)]));
}
function container(bytes) {
  let count = 0; const all = [], masters = [], crcs = [];
  function vint(at, end, id = false) {
    need(at < end, 'EBML', 'Truncated variable integer.'); let marker = 128, width = 1;
    while (width <= 8 && !(bytes[at] & marker)) { marker >>= 1; width++; }
    need(width <= (id ? 4 : 8) && at + width <= end, 'EBML', 'Unsupported or truncated variable integer.');
    let value = BigInt(id ? bytes[at] : bytes[at] & (marker - 1));
    for (let index = 1; index < width; index++) value = value * 256n + BigInt(bytes[at + index]);
    if (id) { const data = value ^ 1n << BigInt(width * 7);
      need(data !== (1n << BigInt(width * 7)) - 1n && (width === 1 || data >= (1n << BigInt((width - 1) * 7)) - 1n), 'EBML', 'Reserved or noncanonical element ID.'); }
    return { width, value, unknown: !id && value === (1n << BigInt(width * 7)) - 1n };
  }
  function element(at, end, parent, depth) {
    need(++count <= LIMITS.elements && depth <= LIMITS.depth, 'LIMIT', 'Finite EBML fixture traversal budget exceeded.');
    const id = vint(at, end, true), size = vint(at + id.width, end), data = at + id.width + size.width;
    need(!size.unknown || id.value === 0x18538067n && parent === null, 'EBML', 'Only the file-bound outer Segment may have unknown size.');
    const length = size.unknown ? BigInt(end - data) : size.value;
    need(length <= BigInt(end - data), 'EBML', 'Element crosses its containing boundary.');
    const item = { id: Number(id.value), at, data, end: data + Number(length), length: Number(length), parent, depth, children: [] }; all.push(item);
    if (MASTER.has(item.id)) {
      masters.push(item); for (let cursor = item.data; cursor < item.end;) { const child = element(cursor, item.end, item, depth + 1); item.children.push(child); cursor = child.end; }
      const checksums = item.children.filter(child => child.id === 0xbf);
      need(checksums.length <= 1 && (!checksums.length || checksums[0] === item.children[0] && checksums[0].length === 4), 'CRC', 'CRC must be one four-byte first child of its master.');
      if (checksums.length) crcs.push({ master: item, crc: checksums[0] });
    }
    return item;
  }
  const roots = []; for (let at = 0; at < bytes.length;) { const root = element(at, bytes.length, null, 0); roots.push(root); at = root.end; }
  need(roots.length >= 2 && roots[0].id === 0x1a45dfa3 && roots.filter(item => item.id === 0x18538067).length === 1
    && roots.at(-1).id === 0x18538067 && roots.slice(1, -1).every(item => item.id === 0xec), 'EBML', 'One EBML header and one EOF-complete Segment are required.');
  for (const item of all.filter(item => item.id === 0xbf)) need(crcs.some(row => row.crc === item), 'CRC', 'CRC appeared outside a traversed known master.');
  for (const { master, crc } of crcs) need(bytes.readUInt32LE(crc.data) === crcFor(bytes, master, crc), 'CRC', 'Original fixture CRC does not match its complete master payload.');
  const segment = roots.at(-1), tracks = all.filter(item => item.id === 0xae);
  need(tracks.length === 1 && tracks[0].parent?.id === 0x1654ae6b && tracks[0].parent.parent === segment, 'TRACK', 'Exactly one directly bound TrackEntry is required.');
  const numbers = tracks[0].children.filter(item => item.id === 0xd7);
  need(numbers.length === 1 && numbers[0].length === 1 && bytes[numbers[0].data] === 1, 'TRACK', 'The sole TrackEntry must explicitly bind track number one.');
  const privateElements = tracks[0].children.filter(item => item.id === 0x63a2);
  need(privateElements.length === 1, 'TRACK', 'Exactly one bound CodecPrivate is required.');
  const blocks = all.filter(item => item.id === 0xa3 || item.id === 0xa1);
  need(blocks.every(item => item.id === 0xa3 ? item.parent?.id === 0x1f43b675 && item.parent.parent === segment
    : item.parent?.id === 0xa0 && item.parent.parent?.id === 0x1f43b675 && item.parent.parent.parent === segment), 'PACKET', 'Blocks must have the exact Segment/Cluster/{SimpleBlock|BlockGroup/Block} ancestry.');
  need(blocks.length > 0 && blocks.length <= LIMITS.packets, 'PACKET', 'Complete bounded block membership is required.');
  for (const block of blocks) {
    const track = vint(block.data, block.end); need(!track.unknown && track.value === 1n && block.length > track.width + 3, 'PACKET', 'Only complete track-one block payloads are supported.');
    const flags = bytes[block.data + track.width + 2]; need(!(flags & 6), 'LACING', 'Laced block construction is outside this finite helper.');
    block.packetData = block.data + track.width + 3;
  }
  return { all, masters, crcs, track: tracks[0], private: privateElements[0], blocks };
}
function decode(value) {
  if (typeof value === 'string' && value.startsWith('\n')) value = value.slice(1, -1).split('\n').join('');
  return Buffer.from(value, 'base64'); // Baseline classifier has already validated the exact producer form.
}
function escaped(raw) {
  const result = [...raw.subarray(0, 2)]; let zeros = 0;
  for (const byte of raw.subarray(2)) { if (zeros >= 2 && byte <= 3) { result.push(3); zeros = 0; } result.push(byte); zeros = byte === 0 ? zeros + 1 : 0; }
  const bytes = Buffer.from(result); need(canonicalHevcNal(bytes).equals(raw), 'NAL', 'Canonical HEVC escaping failed.'); return bytes;
}
function messages(nal) {
  const raw = canonicalHevcNal(nal), result = []; let at = 2;
  function variable() { let value = 0; while (at < raw.length && raw[at] === 255) { value += 255; at++; } need(at < raw.length, 'SEI', 'Truncated SEI field.'); value += raw[at++]; return value; }
  while (at < raw.length - 1) {
    const type = variable(), size = variable(); need(size <= LIMITS.seiBytes && at + size <= raw.length - 1, 'SEI', 'SEI payload crosses its complete RBSP.');
    result.push({ type, payload: Buffer.from(raw.subarray(at, at + size)) }); at += size;
  }
  need(at === raw.length - 1 && raw[at] === 128, 'SEI', 'SEI RBSP must end in its exact trailing byte.'); return result;
}
function variable(value) { const bytes = []; while (value >= 255) { bytes.push(255); value -= 255; } bytes.push(value); return bytes; }
function sei(nal, values, type = 39) {
  const header = Buffer.from(canonicalHevcNal(nal).subarray(0, 2)); header[0] = header[0] & 129 | type << 1;
  return escaped(Buffer.concat([header, ...values.flatMap(row => [Buffer.from([...variable(row.type), ...variable(row.payload.length)]), row.payload]), Buffer.from([128])]));
}
function unitsOf(extra, packets) {
  let total = 0;
  const units = [{ kind: 'extradata', index: 0, bytes: extra, nals: [], header: extra.subarray(0, 23) }];
  need(extra.length >= 23, 'NAL', 'Complete hvcC required.'); let at = 23;
  for (let array = 0; array < extra[22]; array++) {
    need(at + 3 <= extra.length, 'NAL', 'Truncated hvcC array.'); const arrayHeader = Buffer.from(extra.subarray(at, at + 3)), count = extra.readUInt16BE(at + 1); at += 3;
    for (let index = 0; index < count; index++) {
      need(at + 2 <= extra.length, 'NAL', 'Truncated hvcC NAL length.'); const length = extra.readUInt16BE(at); at += 2;
      need(length > 0 && at + length <= extra.length, 'NAL', 'Truncated hvcC NAL.');
      units[0].nals.push({ bytes: Buffer.from(extra.subarray(at, at + length)), array, arrayHeader: index === 0 ? arrayHeader : null }); at += length;
    }
  }
  need(at === extra.length, 'NAL', 'Unconsumed hvcC bytes.');
  for (const [index, bytes] of packets.entries()) {
    const unit = { kind: 'packet', index, bytes, nals: [] }; units.push(unit); at = 0;
    while (at < bytes.length) { need(at + 4 <= bytes.length, 'NAL', 'Truncated packet NAL length.'); const length = bytes.readUInt32BE(at); at += 4;
      need(length > 0 && at + length <= bytes.length, 'NAL', 'Truncated packet NAL.'); unit.nals.push({ bytes: Buffer.from(bytes.subarray(at, at + length)) }); at += length; }
  }
  let precedingVclCount = 0;
  for (const unit of units) for (const [index, row] of unit.nals.entries()) {
    need(++total <= LIMITS.nals, 'LIMIT', 'Finite NAL budget exceeded.'); row.type = row.bytes[0] >> 1 & 63; row.index = index; row.unit = unit;
    row.precedingVclCount = precedingVclCount; if (row.type < 32) precedingVclCount++;
  }
  return units;
}
function serialize(unit) {
  const chunks = unit.kind === 'extradata' ? [unit.header] : [];
  for (const row of unit.nals) { if (row.arrayHeader) chunks.push(row.arrayHeader); const size = Buffer.alloc(unit.kind === 'extradata' ? 2 : 4);
    need(row.bytes.length < (size.length === 2 ? 65536 : 0x100000000), 'NAL', 'NAL exceeds its fixed length field.');
    if (size.length === 2) size.writeUInt16BE(row.bytes.length); else size.writeUInt32BE(row.bytes.length); chunks.push(size, row.bytes); }
  const bytes = Buffer.concat(chunks); need(bytes.length === unit.bytes.length, 'LENGTH', 'Mutation would change the complete packet or hvcC length.'); return bytes;
}
function location(row, messageIndex) { return { kind: row.unit.kind, index: row.unit.index, nalIndex: row.index, nalType: row.type,
  ...(messageIndex === undefined ? {} : { messageIndex }), precedingVclCount: row.precedingVclCount }; }
function vclSeal(units) {
  const values = units.flatMap(unit => unit.nals.filter(row => row.type < 32).map(row => row.bytes));
  const hash = createHash('sha256'); for (const bytes of values) { const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); hash.update(length).update(bytes); }
  return { values, count: values.length, sha256: hash.digest('hex') };
}
function optionsOf(options) {
  need(options && typeof options === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(options)), 'OPTIONS', 'Plain explicit fixture options are required.');
  const allowed = ['variant', 'profiles', 'transfer', 'requireLate', 'spsAspectRatioBitOffset', 'newLevelIdc'];
  for (const key of Reflect.ownKeys(options)) { const descriptor = Object.getOwnPropertyDescriptor(options, key);
    need(typeof key === 'string' && allowed.includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'OPTIONS', 'Fixture options cannot contain unknown fields or accessors.'); }
  need(typeof options.variant === 'string' && /^A[1-8]$/.test(options.variant) && (options.requireLate === undefined || typeof options.requireLate === 'boolean'), 'OPTIONS', 'One finite variant and boolean late requirement are required.');
  return options;
}
function mutateHdrAdversarialFixture(source, capture, supplied) {
  const options = optionsOf(supplied), variant = options.variant;
  need(Buffer.isBuffer(source) && source.length > 0 && source.length <= LIMITS.sourceBytes
    && !(typeof SharedArrayBuffer !== 'undefined' && source.buffer instanceof SharedArrayBuffer), 'LIMIT', 'Complete bounded nonshared source bytes are required.');
  const parserOptions = { profiles: options.profiles, transfer: options.transfer }, baseline = classifyHevcPackets(capture, parserOptions);
  need(Buffer.byteLength(JSON.stringify(capture)) <= LIMITS.captureBytes, 'LIMIT', 'Complete capture exceeds the finite JSON bound.');
  const beforeTiming = inspectHdrContainer(source, { frameRate: baseline.configuration.frameRate }), tree = container(source), stream = capture.streams[0];
  const extra = decode(stream.extradata), packets = capture.packets.map(row => decode(row.data));
  need(tree.private.length === extra.length && source.subarray(tree.private.data, tree.private.end).equals(extra), 'BINDING', 'Exact captured hvcC does not equal the sole CodecPrivate.');
  need(tree.blocks.length === packets.length, 'BINDING', 'Container blocks differ from complete packet membership.');
  for (const [index, block] of tree.blocks.entries()) need(source.subarray(block.packetData, block.end).equals(packets[index]), 'BINDING', 'Captured packet bytes/order differ from their uniquely located block.');
  const units = unitsOf(extra, packets), oldVcl = vclSeal(units), rows = units.flatMap(unit => unit.nals), targets = [];
  function last(predicate) {
    const choices = rows.filter(row => row.unit.kind === 'packet' && predicate(row)); need(choices.length > 0, 'UNSUPPORTED', 'The source has no matching packet NAL for this variant.');
    const row = choices.at(-1); need(options.requireLate === false || row.precedingVclCount > 0, 'NOT_LATE', 'The final matching packet NAL occurs before any VCL; it cannot prove a late-payload case.'); return row;
  }
  if (['A1', 'A2', 'A3', 'A4'].includes(variant)) {
    const type = variant === 'A4' ? 147 : 5;
    const row = last(row => row.type === 39 && messages(row.bytes).some(message => message.type === type));
    const values = messages(row.bytes), index = values.map(message => message.type).lastIndexOf(type), value = values[index]; targets.push(location(row, index));
    if (variant === 'A1') { need(value.payload.subarray(0, 16).equals(UUID), 'SEI', 'Expected the complete known x265 UUID.'); value.payload.fill(81, 0, 16); }
    if (variant === 'A2') { need(value.payload.subarray(0, 16).equals(UUID) && value.payload.length > 17, 'SEI', 'Expected a complete known x265 description.'); value.payload[value.payload.length - 1] = 1; }
    if (variant === 'A4') { need(options.transfer === 'arib-std-b67' && value.payload.length === 1 && value.payload[0] === 18, 'SEI', 'Expected the HLG18 redundant alternative transfer.'); value.payload[0] = 16; }
    const replacement = sei(row.bytes, values, variant === 'A3' ? 40 : 39);
    need(replacement.length === row.bytes.length, 'LENGTH', 'Single-NAL mutation changes escaped size.'); row.bytes = replacement;
  } else if (variant === 'A5' || variant === 'A6') {
    const selected = variant === 'A5' ? [last(row => row.type === 33)] : rows.filter(row => row.type === 33);
    need(selected.length > 0, 'UNSUPPORTED', 'No SPS to mutate.');
    const bitOffset = variant === 'A5' ? 112 : options.spsAspectRatioBitOffset;
    need(Number.isSafeInteger(bitOffset) && bitOffset >= 16 && bitOffset <= 32760, 'UNSUPPORTED', 'A6 needs the exact reviewed canonical SPS aspect_ratio_idc trace offset.');
    if (variant === 'A6') need(baseline.configuration.sampleAspectRatio === '1:1', 'UNSUPPORTED', 'A6 requires an explicitly reviewed square-SAR SPS and its parent-supplied trace offset.');
    for (const row of selected) {
      const raw = canonicalHevcNal(row.bytes); need(bitOffset + 8 <= raw.length * 8, 'UNSUPPORTED', 'The reviewed SPS field is outside this complete canonical NAL.');
      if (variant === 'A6') need(raw[(bitOffset - 1) >> 3] >> (7 - ((bitOffset - 1) & 7)) & 1, 'UNSUPPORTED', 'A6 requires the preceding aspect_ratio_info_present_flag bit.');
      let old = 0; for (let index = 0; index < 8; index++) old = old * 2 + (raw[(bitOffset + index) >> 3] >> (7 - ((bitOffset + index) & 7)) & 1);
      const next = variant === 'A6' ? 2 : options.newLevelIdc ?? (old === 120 ? 123 : 120);
      need(variant === 'A6' ? old === 1 : [30, 60, 63, 90, 93, 120, 123, 150, 153, 156, 180, 183, 186].includes(next) && next !== old,
        'UNSUPPORTED', 'SPS field does not have the reviewed original value or a distinct standard level replacement.');
      for (let index = 0; index < 8; index++) { const bit = bitOffset + index, mask = 1 << (7 - (bit & 7)); raw[bit >> 3] = raw[bit >> 3] & ~mask | (next >> (7 - index) & 1 ? mask : 0); }
      const replacement = escaped(raw); need(replacement.length === row.bytes.length, 'LENGTH', 'SPS mutation changes escaped NAL length.');
      targets.push({ ...location(row), canonicalBitOffset: bitOffset, oldValue: old, newValue: next,
        ...(variant === 'A6' ? { offsetAuthority: 'parent-supplied-reviewed-trace', sourceSpsSha256: sha(canonicalHevcNal(row.bytes)), configurationDigest: baseline.configuration.digest } : {}) }); row.bytes = replacement;
    }
  } else if (variant === 'A7') {
    need(baseline.metadata.contentLight?.max_content === 1200 && baseline.metadata.contentLight.max_average === 300, 'UNSUPPORTED', 'A7 requires actual constant1200/300 content-light metadata.');
    let lights = 0;
    for (const unit of units) {
      const descriptions = [], cll = [];
      for (const row of unit.nals.filter(row => row.type === 39)) for (const [index, message] of messages(row.bytes).entries()) {
        if (message.type === 5) descriptions.push({ row, index }); if (message.type === 144) cll.push({ row, index });
      }
      need(cll.length <= 1 && (!cll.length || descriptions.length === 1), 'UNSUPPORTED', 'Each zero-CLL unit needs exactly one compensating description and one CLL.');
      for (const row of unit.nals.filter(row => row.type === 39)) {
        let changed = false; const values = messages(row.bytes);
        for (const [index, message] of values.entries()) {
          if (message.type === 144) { need(message.payload.length === 4 && message.payload.readUInt16BE() === 1200 && message.payload.readUInt16BE(2) === 300, 'SEI', 'Every original CLL must be exactly1200/300.'); message.payload = Buffer.alloc(4); lights++; changed = true; targets.push(location(row, index)); }
          if (message.type === 5) {
            need(message.payload.subarray(0, 16).equals(UUID), 'SEI', 'Expected complete known x265 description.'); let text = message.payload.subarray(16).toString('ascii');
            need((text.match(/(?:^| )cll=1200,300(?= |$)/g) || []).length === 1 && !/(?:^| )bitrate=/.test(text), 'UNSUPPORTED', 'A7 needs one CLL description token and no duplicate bitrate key.');
            text = text.replace('cll=1200,300', 'bitrate=1000');
            if (cll.length) { need((text.match(/(?:^| )cpuid=1111039(?= |$)/g) || []).length === 1, 'UNSUPPORTED', 'A7 needs the exact compensating CPU description token.'); text = text.replace('cpuid=1111039', 'cpuid=111103'); }
            message.payload = Buffer.concat([UUID, Buffer.from(text, 'ascii')]); changed = true; targets.push(location(row, index));
          }
        }
        if (changed) row.bytes = sei(row.bytes, values);
      }
    }
    need(lights > 0, 'UNSUPPORTED', 'A7 must retain an actual zero-valued type144 payload.');
  }
  const output = Buffer.from(source), modified = [], nextCapture = structuredClone(capture);
  if (variant === 'A8') {
    need(!tree.track.children.some(item => item.id === 0xb9), 'UNSUPPORTED', 'A8 requires originally absent FlagEnabled.');
    const lacing = tree.track.children.filter(item => item.id === 0x9c);
    need(lacing.length === 1 && lacing[0].data - lacing[0].at === 2 && lacing[0].length === 1 && source[lacing[0].data] === 0, 'UNSUPPORTED', 'A8 needs one same-width FlagLacing0 element.');
    const defaults = tree.track.children.filter(item => item.id === 0x88);
    need(defaults.length === 1 && defaults[0].length === 1 && source[defaults[0].data] === 0, 'UNSUPPORTED', 'A8 must retain explicit FlagDefault0.');
    output[lacing[0].at] = 0xb9; targets.push({ kind: 'track', field: 'FlagLacing->FlagEnabled', offset: lacing[0].at, oldValue: 0, newValue: 0 }); modified.push({ start: lacing[0].at, end: lacing[0].end });
  }
  for (const unit of units) {
    const bytes = serialize(unit), element = unit.kind === 'extradata' ? tree.private : tree.blocks[unit.index], start = unit.kind === 'extradata' ? element.data : element.packetData;
    if (!bytes.equals(unit.bytes)) { bytes.copy(output, start); modified.push({ start, end: start + bytes.length }); }
    const row = unit.kind === 'extradata' ? nextCapture.streams[0] : nextCapture.packets[unit.index];
    if (unit.kind === 'extradata') Object.assign(row, { extradata: bytes.toString('base64'), extradata_size: bytes.length, extradata_hash: 'SHA256:' + sha(bytes) });
    else Object.assign(row, { data: bytes.toString('base64'), size: bytes.length, data_hash: 'SHA256:' + sha(bytes) });
  }
  if (variant === 'A7') for (const row of nextCapture.streams[0].side_data_list || []) if (row.side_data_type === 'Content light level metadata') Object.assign(row, { max_content: 0, max_average: 0 });
  const crcRepairs = [];
  // n9.0.2 matroskaenc uses reflected IEEE CRC, initial/final XOR FFFFFFFF,
  // AV_WL32 storage; the entire CRC element is excluded. Repair nested first.
  for (const { master, crc } of [...tree.crcs].sort((a, b) => b.master.depth - a.master.depth)) {
    const value = crcFor(output, master, crc), before = output.readUInt32LE(crc.data);
    if (value !== before) { output.writeUInt32LE(value, crc.data); modified.push({ start: crc.data, end: crc.end }); crcRepairs.push({ masterId: master.id.toString(16), masterOffset: master.at, offset: crc.data, oldValue: before, newValue: value }); }
  }
  const rebuilt = container(output); need(rebuilt.blocks.length === tree.blocks.length && output.length === source.length && modified.length > 0, 'INTEGRITY', 'Output structure/size/mutation proof failed.');
  for (let at = 0; at < output.length; at++) if (output[at] !== source[at]) need(modified.some(range => at >= range.start && at < range.end), 'INTEGRITY', 'Mutation escaped its declared leaf/CRC ranges.');
  const nextUnits = unitsOf(decode(nextCapture.streams[0].extradata), nextCapture.packets.map(row => decode(row.data))), newVcl = vclSeal(nextUnits);
  need(oldVcl.count === newVcl.count && oldVcl.sha256 === newVcl.sha256 && oldVcl.values.every((bytes, index) => bytes.equals(newVcl.values[index])), 'VCL', 'Every original VCL byte and order must survive unchanged.');
  let parsed, parserCode = null; try { parsed = classifyHevcPackets(nextCapture, parserOptions); } catch (error) { parserCode = error.code; }
  if (CODES[variant]) need(parserCode === CODES[variant], 'EXPECTED', `Expected exact parser refusal ${CODES[variant]}, observed ${parserCode || 'classification'}.`);
  else need(!parserCode && parsed.pictureCount === baseline.pictureCount && (variant !== 'A7' || parsed.metadata.contentLight?.max_content === 0 && parsed.metadata.contentLight.max_average === 0), 'EXPECTED', 'A7/A8 must retain genuine complete compressed classification.');
  let afterTiming, containerCode = null; try { afterTiming = inspectHdrContainer(output, { frameRate: baseline.configuration.frameRate }); } catch (error) { containerCode = error.code; }
  if (variant === 'A8') need(containerCode === 'HDR_CONTAINER_TRACK_DISABLED', 'EXPECTED', 'A8 must specifically refuse the disabled raw track.');
  else need(!containerCode && JSON.stringify(afterTiming) === JSON.stringify(beforeTiming), 'TIMING', 'Adversarial compressed mutation changed raw timing or its serialization.');
  const report = freeze({ schema: 1, variant, purpose: 'Owned adversarial qualification fixture; no producer authenticity claim or eligibility grant',
    sourceSha256: sha(source), outputSha256: sha(output), sourceBytes: source.length, outputBytes: output.length, packetCount: packets.length,
    extradataBytes: extra.length, vcl: { count: oldVcl.count, sha256: oldVcl.sha256, preservedEveryByteAndOrder: true }, targets,
    crc: { algorithm: 'IEEE-reflected-EDB88320-init/final-FFFFFFFF-little-endian', verifiedOriginal: tree.crcs.length, repairs: crcRepairs, verifiedOutput: rebuilt.crcs.length },
    expected: { hevcCodes: parserCode ? [parserCode] : [], containerCodes: containerCode ? [containerCode] : [], ownerCodes: variant === 'A7' ? ['HDR_ZERO_CLL_WRITER_UNQUALIFIED'] : [] },
    observed: { parserCode, containerCode, ...(parsed ? { configuration: parsed.configuration, metadata: parsed.metadata } : {}) },
    beforeTiming, ...(afterTiming ? { afterTiming } : {}), publicationAuthorized: false, qualificationGranted: false });
  return { bytes: output, capture: nextCapture, report };
}

module.exports = { ADVERSARIAL_FIXTURE_LIMITS: LIMITS, matroskaCrc32, mutateHdrAdversarialFixture };
