'use strict';
// Synthetic atom bytes for direct parser tests. These are not playable media or
// encoder/muxer capability evidence; no native process is ever launched.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
function atom(type, bytes, { extended = false, zero = false } = {}) {
  extended = extended && !zero; // Zero-size boxes have the ordinary 8-byte header.
  const header = Buffer.alloc(extended ? 16 : 8);
  header.writeUInt32BE(zero ? 0 : extended ? 1 : bytes.length + header.length); header.write(type, 4, 'ascii');
  if (extended) header.writeBigUInt64BE(BigInt(bytes.length + header.length), 8);
  return Buffer.concat([header, bytes]);
}
function fixture(tracks, { extended = false, zero = false, brand = 'qt  ' } = {}) {
  const ftyp = atom('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4)]), { extended });
  const traks = tracks.map(({ id, language = 32767, version = 0 }) => {
    const tkhd = Buffer.alloc(version ? 96 : 84); tkhd[0] = version; tkhd.writeUInt32BE(id, version ? 20 : 12);
    const mdhd = Buffer.alloc(version ? 36 : 24); mdhd[0] = version; mdhd.writeUInt16BE(language, version ? 32 : 20);
    return atom('trak', Buffer.concat([atom('tkhd', tkhd, { extended }), atom('mdia', atom('mdhd', mdhd, { extended }))]), { extended });
  });
  return Buffer.concat([ftyp, atom('moov', Buffer.concat(traks), { extended, zero })]);
}
// Native timing fixtures for injected collectors. These carry actual mvhd,
// sample timing and edit atoms, so the production observer runs without mocks.
// pts/durations/start/span use this track's integer media clock.
function timedFixture(tracks, { movieScale = 240000, brand = 'qt  ' } = {}) {
  const neutralMatrix = (b, at) => [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824].forEach((v, i) => b.writeInt32BE(v, at + i * 4));
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(movieScale, 12); mvhd.writeUInt32BE(65536, 20); mvhd.writeUInt16BE(256, 24); neutralMatrix(mvhd, 36);
  let movieEnd = 0;
  const traks = tracks.map(({ id, kind = id === 2 ? 'audio' : 'video', width = 2, height = 2, language = 32767, scale, pts, durations, start = Math.min(...pts),
    span = Math.max(...pts.map((p, i) => p + durations[i])) - start, mediaTime = 0 }) => {
    const floor = ticks => Number(BigInt(ticks) * BigInt(movieScale) / BigInt(scale));
    const ceil = ticks => Number((BigInt(ticks) * BigInt(movieScale) + BigInt(scale) - 1n) / BigInt(scale));
    const delay = floor(start), duration = ceil(span);
    const end = ceil(start + span); movieEnd = Math.max(movieEnd, end);
    const tkhd = Buffer.alloc(84); tkhd.writeUIntBE(3, 1, 3); tkhd.writeUInt32BE(id, 12); tkhd.writeUInt32BE(end, 20);
    tkhd.writeUInt16BE(kind === 'audio' ? 1 : 0, 34); tkhd.writeUInt16BE(kind === 'audio' ? 256 : 0, 36); neutralMatrix(tkhd, 40);
    if (kind === 'video') { tkhd.writeUInt32BE(width * 65536, 76); tkhd.writeUInt32BE(height * 65536, 80); }
    const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(scale, 12); mdhd.writeUInt32BE(durations.reduce((a, b) => a + b, 0), 16); mdhd.writeUInt16BE(language, 20);
    const run = (values, signed = false) => { const b = Buffer.alloc(8 + values.length * 8); b[0] = signed ? 1 : 0; b.writeUInt32BE(values.length, 4);
      values.forEach((value, i) => { b.writeUInt32BE(1, 8 + i * 8); b[signed ? 'writeInt32BE' : 'writeUInt32BE'](value, 12 + i * 8); }); return b; };
    let clock = 0; const minimum = Math.min(...pts), offsets = pts.map((p, i) => { const c = p - minimum - clock; clock += durations[i]; return c; });
    const stsz = Buffer.alloc(12); stsz.writeUInt32BE(1, 4); stsz.writeUInt32BE(pts.length, 8);
    const edits = [...(delay ? [{ duration: delay, mediaTime: -1 }] : []), { duration, mediaTime }];
    const elst = Buffer.alloc(8 + edits.length * 12); elst.writeUInt32BE(edits.length, 4);
    edits.forEach((e, i) => { elst.writeUInt32BE(e.duration, 8 + i * 12); elst.writeInt32BE(e.mediaTime, 12 + i * 12); elst.writeInt16BE(1, 16 + i * 12); });
    return atom('trak', Buffer.concat([atom('tkhd', tkhd), atom('edts', atom('elst', elst)), atom('mdia', Buffer.concat([
      atom('mdhd', mdhd), atom('minf', Buffer.concat([...(kind === 'audio' ? [atom('smhd', Buffer.alloc(8))] : []),
        atom('stbl', Buffer.concat([atom('stsz', stsz), atom('stts', run(durations)), atom('ctts', run(offsets, true))]))]))
    ]))]));
  });
  mvhd.writeUInt32BE(movieEnd, 16);
  return Buffer.concat([atom('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4)])), atom('moov', Buffer.concat([atom('mvhd', mvhd), ...traks]))]);
}
async function writeFixture(t, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-mov-test-')), filename = path.join(directory, 'owned.mov');
  await fs.writeFile(filename, bytes, { flag: 'wx' });
  t.after(async () => { await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); await fs.rmdir(directory); });
  const stat = await fs.stat(filename, { bigint: true });
  return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    identity: Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])])) };
}
function playbackFixture(probe, paddedBytes = 0) {
  if((probe.format?.format_name||'').split(',').includes('matroska'))return require('./matroska-fixture.cjs').matroskaFixture(probe,paddedBytes);
  const tracks = probe.streams.filter(s => ['video', 'audio'].includes(s.codec_type)).map(s => {
    s.id ||= String(s.index + 1);
    return { id: Number(BigInt(s.id)), kind: s.codec_type, width: s.width, height: s.height, scale: 48000, pts: [0], durations: [48000] };
  });
  const bytes = timedFixture(tracks);
  return paddedBytes ? Buffer.concat([bytes, atom('mdat', Buffer.alloc(paddedBytes - bytes.length - 8))]) : bytes;
}
module.exports = { atom, fixture, timedFixture, playbackFixture, writeFixture };
