'use strict';

// Read-only full-file custody for the finite MP3-to-MP4 route. Identity checks
// detect replacement around each bounded read. FFmpeg still opens by path, so
// the collector and publisher must join the entire staged copy to these bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { ToolError } = require('./process-runner.cjs');
const { readFileStamp, sameStamp } = require('./source-identity.cjs');
const { inspectFrames, MAX_SOURCE_BYTES, SAMPLES_PER_PACKET } = require('./remux-mp3-copy.cjs');

const actualSources = new WeakMap();
const STAMP_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function checkCancellation(signal) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'MP3 verification was cancelled.');
}

function requireFileObject(stat, expected) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
      || !STAMP_FIELDS.every(key => String(stat[key]) === expected[key])) {
    throw new ToolError('INPUT_CHANGED', 'The single-link MP3 source or temporary output changed during verification.');
  }
}

async function readMp3File(file, { maximumBytes, expectedIdentity, signal } = {}) {
  checkCancellation(signal);
  let handle;
  try {
    await assertOrdinaryPath(file);
    const before = await readFileStamp(file);
    if (expectedIdentity && !sameStamp(expectedIdentity, before)) {
      throw new ToolError('INPUT_CHANGED', 'The selected MP3 source has changed. Prepare it again.');
    }
    const size = Number(before.size);
    if (!Number.isSafeInteger(maximumBytes) || !Number.isSafeInteger(size) || size < 1 || size > maximumBytes) {
      throw new ToolError('MP3_WITNESS_LIMIT', 'The MP3 source or temporary output exceeds the bounded complete-read limit.');
    }
    requireFileObject(await fs.lstat(before.canonicalPath, { bigint: true }), before);
    handle = await fs.open(before.canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    requireFileObject(await handle.stat({ bigint: true }), before);
    const bytes = Buffer.alloc(size);
    for (let offset = 0; offset < size;) {
      checkCancellation(signal);
      const result = await handle.read(bytes, offset, size - offset, offset);
      if (!result.bytesRead) throw new ToolError('INPUT_CHANGED', 'The MP3 source or temporary output ended early.');
      offset += result.bytesRead;
    }
    requireFileObject(await handle.stat({ bigint: true }), before);
    requireFileObject(await fs.lstat(before.canonicalPath, { bigint: true }), before);
    await assertOrdinaryPath(file);
    checkCancellation(signal);
    return { bytes, sha256: sha(bytes), stamp: before };
  } catch (error) {
    checkCancellation(signal);
    if (error instanceof ToolError) throw error;
    throw new ToolError('MP3_CUSTODY_UNAVAILABLE', 'The MP3 source or temporary output could not be read safely.', { cause: error });
  } finally {
    await handle?.close();
  }
}

async function prepareMp3Source(file, identity, { signal } = {}) {
  assert(identity?.canonicalPath === file);
  const read = await readMp3File(file, { maximumBytes: MAX_SOURCE_BYTES, expectedIdentity: identity, signal });
  const { frames, rate, channels } = inspectFrames(read.bytes);
  const result = Object.freeze({ sha256: read.sha256, size: read.stamp.size, rate, channels,
    packets: frames.length, sampleFrames: frames.length * SAMPLES_PER_PACKET });
  actualSources.set(result, Object.freeze({ ...identity }));
  return result;
}

function requireMp3Source(observed, identity) {
  const expected = actualSources.get(observed);
  if (!expected || identity && !sameStamp(identity, expected)) {
    throw new ToolError('MP3_CUSTODY_UNAVAILABLE', 'A current main-owned MP3 source observation is required.');
  }
  return expected;
}

async function rereadMp3Source(file, observed, { signal } = {}) {
  const expectedIdentity = requireMp3Source(observed);
  const result = await readMp3File(file, { maximumBytes: MAX_SOURCE_BYTES, expectedIdentity, signal });
  if (result.sha256 !== observed.sha256) throw new ToolError('INPUT_CHANGED', 'The complete MP3 source bytes have changed. Prepare it again.');
  return result;
}

module.exports = { prepareMp3Source, requireMp3Source, rereadMp3Source, readMp3File };
