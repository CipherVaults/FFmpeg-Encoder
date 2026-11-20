'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('../src/process-runner.cjs');
const { assertIdentityMatches } = require('../src/source-identity.cjs');

const WINDOW = 256 * 1024; // Exact existing sparse-v1 identity window.
const FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const RATE = [44100, 48000, 32000];
const KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const handles = new WeakSet();

function fail(code, message) { throw new ToolError(code, message); }
function cancelled(signal) {
  if (signal?.aborted) fail('CANCELLED', 'MP3 source observation cancelled.');
}
function changed() { fail('INPUT_CHANGED', 'MP3 source is no longer the same canonical single-link regular file. Prepare it again.'); }

function checkStamp(expected, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) changed();
  assertIdentityMatches(expected, {
    canonicalPath: expected.canonicalPath,
    ...Object.fromEntries(FIELDS.map(field => [field, String(stat[field])])),
  }, { stage: 'mp3-source-custody', message: 'MP3 source changed during observation.' });
}

function current(expected, descriptor) {
  try {
    const selected = expected.canonicalPath;
    checkStamp(expected, fs.lstatSync(selected, { bigint: true }));
    if (fs.realpathSync(selected) !== selected) changed();
    if (descriptor) checkStamp(expected, fs.fstatSync(descriptor.fd, { bigint: true }));
    checkStamp(expected, fs.lstatSync(selected, { bigint: true }));
  } catch (error) {
    if (error?.code === 'INPUT_CHANGED') throw error;
    changed();
  }
}

function inspect(prefix, tail, size) {
  const at = (bytes, offset, literal) => offset >= 0 && offset + literal.length <= bytes.length &&
    bytes.toString('latin1', offset, offset + literal.length) === literal;
  if (at(prefix, 0, 'ID3')) fail('MP3_ID3V2_UNSUPPORTED', 'An ID3v2 prefix was observed; its metadata or artwork is not qualified.');
  const tag = at(tail, tail.length - 128, 'TAG');
  if (tag || at(tail, tail.length - 32, 'APETAGEX')) {
    fail('MP3_TRAILING_TAG_UNSUPPORTED', 'A trailing ID3v1 or APE tag signature was observed.');
  }
  let rate, channels, frames = 0, pos = 0;
  const frame = () => fail('MP3_FRAME_UNPROVED', 'Expected contiguous MPEG-1 Layer III frames in the bounded source observation.');
  while (pos < prefix.length) {
    if (prefix.length - pos < 4) {
      if (prefix.length === size) frame();
      break;
    }
    const [a, b, c, d] = prefix.subarray(pos, pos + 4);
    const kbps = KBPS[c >>> 4], hz = RATE[(c >>> 2) & 3], ch = d >>> 6 === 3 ? 1 : 2;
    if (a !== 255 || (b & 254) !== 250 || !kbps || !hz || (d & 3) === 2 ||
      (frames && (hz !== rate || ch !== channels))) frame();
    const length = Math.floor(144000 * kbps / hz) + ((c >>> 1) & 1);
    if (pos + length > size) frame();
    if (pos + length > prefix.length) break;
    if (!frames) {
      const xing = pos + 4 + ((b & 1) ? 0 : 2) + (ch === 1 ? 17 : 32);
      if (['Xing', 'Info'].some(marker => xing + 4 <= pos + length && at(prefix, xing, marker)) ||
        (length >= 40 && at(prefix, pos + 36, 'VBRI'))) {
        fail('MP3_SEEK_HEADER_UNSUPPORTED', 'A Xing, Info or VBRI first-frame marker was observed; timing metadata is not qualified.');
      }
      rate = hz;
      channels = ch;
    }
    frames++;
    pos += length;
  }
  if (frames < 4) frame();
  return Object.freeze({
    method: 'mp3-mpeg1-layer3-prefix-headers-v1', rate, channels, frames,
    contiguousPrefixBytes: pos, fileBytes: size, reachesEof: pos === size,
    // Signature checks are not proof of complete metadata absence or playable payload.
    completePayloadVerified: false, metadataAbsenceVerified: false,
  });
}

// One read-only Prepare descriptor, never an execution token. Callers must close
// in finally. Synchronous currentness is a point-in-time check, not a path lock.
async function openProductMp3Source(sourceIdentity, { signal } = {}) {
  cancelled(signal);
  const expected = Object.freeze({ canonicalPath: sourceIdentity?.canonicalPath, sparseDigest: sourceIdentity?.sparseDigest,
    ...Object.fromEntries(FIELDS.map(field => [field, sourceIdentity?.[field]])) });
  const file = expected.canonicalPath;
  if (typeof file !== 'string' || !path.isAbsolute(file) || /[\0\r\n]/.test(file) ||
      (expected.sparseDigest !== undefined && (typeof expected.sparseDigest !== 'string' ||
        !/^sha256-sparse-v1:[a-f0-9]{64}$/.test(expected.sparseDigest)))) changed();
  current(expected);
  const size = Number(expected.size);
  if (!Number.isSafeInteger(size) || size < 1) fail('INPUT_TOO_LARGE', 'MP3 source exceeds safe observation offsets.');
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!O_NOFOLLOW || !O_NONBLOCK) fail('MP3_CUSTODY_UNAVAILABLE', 'Safe source descriptor flags are unavailable.');
  let descriptor;
  try { descriptor = await fs.promises.open(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK); }
  catch { cancelled(signal); changed(); }
  let retired;
  const assertCurrent = ({ signal: currentSignal } = {}) => {
    cancelled(signal);
    cancelled(currentSignal);
    if (retired) changed();
    current(expected, descriptor);
  };
  // A final post-close named stamp comparison is not descriptor or digest custody.
  const assertNamedCurrent = ({ signal: currentSignal } = {}) => {
    cancelled(signal);
    cancelled(currentSignal);
    current(expected);
  };
  const close = () => retired ??= descriptor.close();
  try {
    assertCurrent();
    const length = Math.min(WINDOW, size);
    const offsets = [...new Set([0, Math.floor((size - length) / 2), size - length])];
    const digest = createHash('sha256').update(`ffmpeg-encoder/sparse/v1\0${size}\0`);
    const buffer = Buffer.alloc(length);
    let prefix, tail;
    for (const offset of offsets) {
      let read = 0;
      while (read < length) {
        cancelled(signal);
        const { bytesRead } = await descriptor.read(buffer, read, length - read, offset + read);
        cancelled(signal);
        if (!bytesRead) changed();
        read += bytesRead;
      }
      digest.update(`${offset}:${length}:`).update(buffer);
      if (!offset) prefix = Buffer.from(buffer);
      if (offset === size - length) tail = buffer.subarray(Math.max(0, length - 128));
    }
    assertCurrent();
    const identity = Object.freeze({ ...expected, sparseDigest: 'sha256-sparse-v1:' + digest.digest('hex') });
    if (expected.sparseDigest !== undefined) assertIdentityMatches(expected, identity,
      { stage: 'mp3-source-sampling', digest: true, message: 'MP3 source differs from the main-owned sparse identity.' });
    const observation = inspect(prefix, tail, size);
    assertCurrent();
    const result = Object.freeze({ observation, identity, assertCurrent, assertNamedCurrent, close });
    handles.add(result);
    return result;
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

function assertProductMp3Source(handle, shape, options) {
  if (!handles.has(handle)) fail('MP3_CUSTODY_UNAVAILABLE', 'MP3 shape comparison requires a live source observation.');
  handle.assertCurrent(options);
  if (shape?.rate !== handle.observation.rate || shape?.channels !== handle.observation.channels) {
    fail('MP3_PROBE_MISMATCH', 'Probed MP3 sample rate or channel count disagrees with the physical frame headers.');
  }
  handle.assertCurrent(options);
  return handle.observation;
}

module.exports = { openProductMp3Source, assertProductMp3Source };
