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
async function writeFixture(t, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-mov-test-')), filename = path.join(directory, 'owned.mov');
  await fs.writeFile(filename, bytes, { flag: 'wx' });
  t.after(async () => { await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); await fs.rmdir(directory); });
  const stat = await fs.stat(filename, { bigint: true });
  return { path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    identity: Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, String(stat[key])])) };
}
module.exports = { atom, fixture, writeFixture };
