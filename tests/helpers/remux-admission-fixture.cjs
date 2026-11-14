'use strict';
const { createHash } = require('node:crypto');
const hash = b => createHash('sha256').update(b).digest('hex');
class Bits {
  constructor() { this.values = []; }
  put(value, n) { for (let i = n - 1; i >= 0; i--) this.values.push(Math.floor(value / 2 ** i) & 1); return this; }
  ue(value) { const n = Math.floor(Math.log2(value + 1)); this.put(0, n); this.put(value + 1, n + 1); return this; }
  end(trailing = true) { if (trailing) this.put(1, 1); while (this.values.length % 8) this.put(0, 1);
    const data = Buffer.alloc(this.values.length / 8); this.values.forEach((b, i) => { data[i >> 3] |= b << (7 - (i & 7)); }); return data; }
}
function escape(data) { const out = []; let zeros = 0; for (const b of data) { if (zeros === 2 && b <= 3) { out.push(3); zeros = 0; } out.push(b); zeros = b === 0 ? zeros + 1 : 0; } return Buffer.from(out); }
function sps(options = {}) {
  const { width = 2, height = 2, profile = 100, level = 40, id = 0, chroma = 1, depth = 0, frameOnly = 1,
    sar = [1, 1], colour = [1, 1, 1], fullRange = 0, cropRight, cropBottom, refs = 2 } = options;
  const w = Math.ceil(width / 16), h = Math.ceil(height / 16), right = cropRight ?? (w * 16 - width) / 2, bottom = cropBottom ?? (h * 16 - height) / 2;
  const b = new Bits().put(profile, 8).put(0, 8).put(level, 8).ue(id);
  if ([100, 110, 122, 244, 44].includes(profile)) b.ue(chroma).ue(depth).ue(depth).put(0, 1).put(0, 1);
  b.ue(0).ue(0).ue(0).ue(refs).put(0, 1).ue(w - 1).ue(h - 1).put(frameOnly, 1);
  if (!frameOnly) b.put(0, 1);
  b.put(1, 1).put(right || bottom ? 1 : 0, 1); if (right || bottom) b.ue(0).ue(right).ue(0).ue(bottom);
  b.put(1, 1).put(1, 1).put(255, 8).put(sar[0], 16).put(sar[1], 16).put(0, 1).put(1, 1).put(5, 3).put(fullRange, 1).put(1, 1);
  colour.forEach(x => b.put(x, 8)); b.put(0, 1).put(0, 1).put(0, 1).put(0, 1).put(0, 1).put(0, 1);
  return Buffer.concat([Buffer.from([103]), escape(b.end())]);
}
function pps(id = 0, sid = 0) { return Buffer.concat([Buffer.from([104]), new Bits().ue(id).ue(sid).put(0, 1).put(0, 1).ue(0).end()]); }
function avcc(options = {}) {
  const a = options.sps || [sps(options)], p = options.pps || [pps()], length = options.lengthBytes || 4;
  const out = [Buffer.from([1, a[0][1], a[0][2], a[0][3], 252 | (length - 1), 224 | a.length])];
  for (const n of a) { const len = Buffer.alloc(2); len.writeUInt16BE(n.length); out.push(len, n); }
  out.push(Buffer.from([p.length])); for (const n of p) { const len = Buffer.alloc(2); len.writeUInt16BE(n.length); out.push(len, n); }
  return Buffer.concat(out);
}
function asc({ rate = 48000, channels = 2, object = 2, samples = 1024 } = {}) {
  return new Bits().put(object, 5).put(rate === 48000 ? 3 : 4, 4).put(channels, 4).put(samples === 960 ? 1 : 0, 1).put(0, 1).put(0, 1).end(false);
}
function sei(type = 5, payload = Buffer.from('owned-test')) {
  const head = []; for (; type >= 255; type -= 255) head.push(255); head.push(type);
  let n = payload.length; for (; n >= 255; n -= 255) head.push(255); head.push(n);
  return Buffer.concat([Buffer.from([6]), escape(Buffer.concat([Buffer.from(head), payload, Buffer.from([128])]))]);
}
function annex(nals) { return Buffer.concat(nals.flatMap(n => [Buffer.from([0, 0, 0, 1]), n])); }
function avcNals(nals) { return Buffer.concat(nals.flatMap(n => { const size = Buffer.alloc(4); size.writeUInt32BE(n.length); return [size, n]; })); }
function packet(i, key = [0, 4].includes(i)) {
  // Bounded valid prefix: first_mb=0, slice_type=I(2), pps_id=0. Remaining
  // two inert bits distinguish this six-packet model; these are not media.
  return Buffer.from([0, 0, 0, 2, key ? 101 : 65, 188 | [0, 1, 2, 3, 1, 0][i % 6]]);
}
function hexDump(data) {
  const out = ['']; for (let at = 0; at < data.length; at += 16) {
    const part = data.subarray(at, at + 16), hex = part.toString('hex').match(/.{1,4}/g).join(' ');
    out.push(at.toString(16).padStart(8, '0') + ': ' + hex.padEnd(39) + '  ' + '.'.repeat(part.length));
  } return out.join('\n') + '\n';
}
function extra(stream) { return stream.codec_type === 'video' ? avcc({ width: stream.width, height: stream.height, level: stream.level })
  : asc({ rate: Number(stream.sample_rate), channels: stream.channels }); }
module.exports = { Bits, sps, pps, avcc, asc, sei, annex, avcNals, packet, hash, hexDump, extra };
