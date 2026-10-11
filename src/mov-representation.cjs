'use strict';

// Main-only, read-only observation of the actual owned MOV output. An absent
// ffprobe language tag is not evidence of an unspecified QuickTime language.
// The retained handle, full file seal and exact track IDs establish that fact;
// this receipt grants only metadata equivalence, never publication or cleanup.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeProbe } = require('./inspection.cjs');
const { ToolError } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');

const receipts = new WeakMap();
const LIMITS = Object.freeze({ fileBytes: 64n * 1024n ** 3n, atoms: 2048, depth: 4, tracks: 64, metadataBytes: 8 * 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const fail = message => { throw new ToolError('MOV_REPRESENTATION_UNVERIFIED', message); };
const check = (value, message) => { if (!value) fail(message); };
const stamp = value => Object.fromEntries(FIELDS.map(key => [key, String(value[key])]));
const same = (left, right) => left.dev !== 0n && left.ino !== 0n && FIELDS.every(key => left[key] === right[key]);
const fingerprint = probe => createHash('sha256').update(JSON.stringify(normalizeProbe(probe))).digest('hex');
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function trackId(value) {
  check(typeof value === 'string' && /^(?:0x[0-9a-f]{1,8}|[1-9]\d{0,9})$/i.test(value), 'Every output stream needs its actual native MOV track ID.');
  const id = BigInt(value); check(id > 0n && id <= 0xffffffffn, 'Invalid MOV track ID.'); return Number(id);
}

async function observeMovRepresentation({ outputId, outputProbe, fileReceipt, signal } = {}) {
  const cancelled = () => { if (signal?.aborted) throw new ToolError('CANCELLED', 'MOV representation observation cancelled.'); };
  cancelled();
  check(typeof outputId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(outputId), 'A current output ID is required.');
  check(fileReceipt && typeof fileReceipt.path === 'string' && path.isAbsolute(fileReceipt.path)
    && HASH.test(fileReceipt.sha256) && Number.isSafeInteger(fileReceipt.bytes) && fileReceipt.bytes > 0
    && fileReceipt.identity && FIELDS.every(key => typeof fileReceipt.identity[key] === 'string' && /^\d+$/.test(fileReceipt.identity[key])),
  'A complete main-owned output-file receipt is required.');
  const probe = normalizeProbe(outputProbe);
  check(String(probe.format.format_name || '').split(',').includes('mov') && probe.streams.length > 0 && probe.streams.length <= LIMITS.tracks,
    'MOV observation requires its complete bounded output probe.');
  const streamIds = new Map();
  for (const stream of probe.streams) {
    const id = trackId(stream.id); check(!streamIds.has(id), 'MOV stream IDs must be unique.');
    streamIds.set(id, stream.index);
  }
  await assertOrdinaryPath(fileReceipt.path);
  const namedBefore = await fs.lstat(fileReceipt.path, { bigint: true });
  const handle = await fs.open(fileReceipt.path, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    check(before.isFile() && before.nlink === 1n && before.size <= LIMITS.fileBytes && same(namedBefore, before)
      && Number(before.size) === fileReceipt.bytes && FIELDS.every(key => String(before[key]) === fileReceipt.identity[key]),
    'MOV output differs from its retained owned-file receipt.');
    let atomCount = 0, metadataBytes = 0;
    async function read(position, length) {
      cancelled(); check(Number.isSafeInteger(position) && position >= 0 && Number.isSafeInteger(length) && length >= 0
        && position + length <= Number(before.size), 'MOV read lies outside the retained file.');
      metadataBytes += length; check(metadataBytes <= LIMITS.metadataBytes, 'MOV metadata observation exceeded its byte bound.');
      const bytes = Buffer.alloc(length); let offset = 0;
      while (offset < length) { const value = await handle.read(bytes, offset, length - offset, position + offset); check(value.bytesRead > 0, 'Incomplete MOV atom read.'); offset += value.bytesRead; }
      return bytes;
    }
    async function children(start, end, depth) {
      check(depth <= LIMITS.depth && start <= end, 'MOV atom nesting exceeded its bound.');
      const result = []; let position = start;
      while (position < end) {
        check(end - position >= 8 && ++atomCount <= LIMITS.atoms, 'MOV atom boundary/count is invalid.');
        const header = await read(position, 8); let size = BigInt(header.readUInt32BE(0)), headerBytes = 8;
        if (size === 1n) { check(end - position >= 16, 'Incomplete extended MOV atom.'); size = (await read(position + 8, 8)).readBigUInt64BE(); headerBytes = 16; }
        else if (size === 0n) size = BigInt(end - position); // Zero size extends only to this parent boundary.
        check(size >= BigInt(headerBytes) && size <= BigInt(end - position) && size <= BigInt(Number.MAX_SAFE_INTEGER), 'MOV atom size exceeds its parent.');
        result.push({ type: header.toString('ascii', 4, 8), start: position, body: position + headerBytes, end: position + Number(size) });
        position += Number(size);
      }
      check(position === end, 'MOV child atoms do not cover their parent exactly.'); return result;
    }
    const top = await children(0, Number(before.size), 0);
    const ftypes = top.filter(atom => atom.type === 'ftyp'), movies = top.filter(atom => atom.type === 'moov');
    check(ftypes.length === 1 && movies.length === 1 && ftypes[0].end - ftypes[0].body >= 8, 'Exactly one native MOV brand and movie atom are required.');
    check((await read(ftypes[0].body, 4)).toString('ascii') === 'qt  ', 'The observed output is not the selected QuickTime MOV target.');
    const traks = (await children(movies[0].body, movies[0].end, 1)).filter(atom => atom.type === 'trak');
    check(traks.length === streamIds.size && traks.length <= LIMITS.tracks, 'MOV track set differs from the exact probed stream set.');
    const tracks = [], seen = new Set();
    for (const trak of traks) {
      const atoms = await children(trak.body, trak.end, 2), headers = atoms.filter(atom => atom.type === 'tkhd'), media = atoms.filter(atom => atom.type === 'mdia');
      check(headers.length === 1 && media.length === 1, 'Every MOV track needs exactly one track and media header.');
      const version = (await read(headers[0].body, 1))[0]; check(version === 0 || version === 1, 'Unsupported MOV track-header version.');
      check(headers[0].end - headers[0].body >= (version ? 96 : 84), 'Incomplete MOV track header.');
      const id = (await read(headers[0].body + (version ? 20 : 12), 4)).readUInt32BE();
      check(streamIds.has(id) && !seen.has(id), 'MOV native track ID is missing, duplicated or unrelated.'); seen.add(id);
      const mds = (await children(media[0].body, media[0].end, 3)).filter(atom => atom.type === 'mdhd');
      check(mds.length === 1, 'Every MOV track needs exactly one media header.');
      const mdVersion = (await read(mds[0].body, 1))[0]; check(mdVersion === 0 || mdVersion === 1, 'Unsupported MOV media-header version.');
      check(mds[0].end - mds[0].body >= (mdVersion ? 36 : 24), 'Incomplete MOV media header.');
      const languageCode = (await read(mds[0].body + (mdVersion ? 32 : 20), 2)).readUInt16BE();
      const atomBytes = await read(mds[0].start, mds[0].end - mds[0].start);
      tracks.push({ outputIndex: streamIds.get(id), trackId: id, languageCode,
        mdhdSha256: createHash('sha256').update(atomBytes).digest('hex') });
    }
    // Verify the entire already-owned file, without loading media into RAM.
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let position = 0;
    while (position < Number(before.size)) {
      cancelled(); const count = Math.min(buffer.length, Number(before.size) - position);
      const { bytesRead } = await handle.read(buffer, 0, count, position); check(bytesRead > 0, 'Incomplete MOV output seal.');
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    const sha256 = hash.digest('hex'); check(sha256 === fileReceipt.sha256, 'MOV output content differs from its sealed receipt.');
    await assertOrdinaryPath(fileReceipt.path);
    const after = await handle.stat({ bigint: true }), namedAfter = await fs.lstat(fileReceipt.path, { bigint: true });
    check(same(before, after) && same(after, namedAfter), 'MOV output changed or was replaced during metadata observation.'); cancelled();
    const receipt = freeze({ version: 1, kind: 'owned-mov-mdhd-language', outputId: outputId.toLowerCase(), outputEvidenceFingerprint: fingerprint(probe),
      outputSha256: sha256, identity: stamp(after), tracks: tracks.sort((a, b) => a.outputIndex - b.outputIndex) });
    receipts.set(receipt, receipt); return receipt;
  } finally { await handle.close(); }
}

function getMovRepresentation(receipt, { outputId, outputEvidenceFingerprint, outputSha256 } = {}) {
  const value = receipts.get(receipt);
  check(value && value.outputId === outputId && value.outputEvidenceFingerprint === outputEvidenceFingerprint && value.outputSha256 === outputSha256,
    'A genuine matching main-owned MOV observation receipt is required.'); return value;
}
module.exports = { observeMovRepresentation, getMovRepresentation };
