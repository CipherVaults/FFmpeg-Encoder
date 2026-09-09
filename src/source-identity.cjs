'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');

const STAT_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];
const SAMPLE_BYTES = 256 * 1024;
const DIGEST_PREFIX = 'sha256-sparse-v1:';

function cancelled(signal) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Source identity check cancelled.');
}

function stampOf(stat, canonicalPath) {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ToolError('INPUT_CHANGED', 'Input must be a regular file, not a symbolic link.');
  }
  if (stat.size === 0n) throw new ToolError('EMPTY_INPUT', 'The input is empty. Finish recording before preparing it.');
  return { canonicalPath, ...Object.fromEntries(STAT_FIELDS.map(field => [field, String(stat[field])])) };
}

function validStamp(stamp) {
  return stamp && typeof stamp.canonicalPath === 'string' && path.isAbsolute(stamp.canonicalPath)
    && !/[\0\r\n]/.test(stamp.canonicalPath)
    && STAT_FIELDS.every(field => typeof stamp[field] === 'string' && /^-?\d+$/.test(stamp[field]))
    && /^[1-9]\d*$/.test(stamp.size);
}

function sameStamp(left, right) {
  return Boolean(validStamp(left) && validStamp(right) && left.canonicalPath === right.canonicalPath
    && STAT_FIELDS.every(field => left[field] === right[field]));
}

function sameIdentity(left, right) {
  return sameStamp(left, right) && typeof left.sparseDigest === 'string'
    && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(left.sparseDigest) && left.sparseDigest === right.sparseDigest;
}

async function readFileStamp(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /[\0\r\n]/.test(file)) {
    throw new ToolError('INVALID_PATH', 'Source identity requires an absolute filesystem path.');
  }
  const before = await fs.lstat(file, { bigint: true });
  // Inspect the selected name before resolving it: resolving first would hide a
  // final symbolic link. Canonical parent resolution remains main's authority.
  stampOf(before, file);
  const canonicalPath = await fs.realpath(file);
  const expected = stampOf(before, canonicalPath);
  const after = stampOf(await fs.lstat(canonicalPath, { bigint: true }), canonicalPath);
  if (!sameStamp(expected, after)) throw new ToolError('INPUT_CHANGED', 'Input changed while identifying it.');
  return after;
}

async function readSourceIdentity(file, { signal } = {}) {
  cancelled(signal);
  const before = await readFileStamp(file);
  cancelled(signal);
  const handle = await fs.open(before.canonicalPath, 'r');
  try {
    cancelled(signal);
    const opened = stampOf(await handle.stat({ bigint: true }), before.canonicalPath);
    if (!sameStamp(before, opened)) throw new ToolError('INPUT_CHANGED', 'Input changed before identity sampling.');
    const size = Number(before.size);
    if (!Number.isSafeInteger(size)) throw new ToolError('INPUT_TOO_LARGE', 'Input size exceeds safe sampling offsets.');
    const length = Math.min(SAMPLE_BYTES, size);
    const offsets = [...new Set([0, Math.floor((size - length) / 2), size - length])];
    const digest = createHash('sha256').update(`ffmpeg-encoder/sparse/v1\0${size}\0`);
    for (const offset of offsets) {
      cancelled(signal);
      const buffer = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
        cancelled(signal);
        if (!bytesRead) throw new ToolError('INPUT_CHANGED', 'Input became shorter during identity sampling.');
        read += bytesRead;
      }
      digest.update(`${offset}:${length}:`).update(buffer);
    }
    const after = stampOf(await handle.stat({ bigint: true }), before.canonicalPath);
    const named = await readFileStamp(file);
    cancelled(signal);
    if (!sameStamp(before, after) || !sameStamp(after, named)) {
      throw new ToolError('INPUT_CHANGED', 'Input changed during identity sampling.');
    }
    // This digest strengthens ordinary change detection without reading an
    // entire archive. It is not a full-file hash or a lock against active writers.
    return { ...after, sparseDigest: DIGEST_PREFIX + digest.digest('hex') };
  } finally {
    await handle.close();
  }
}

module.exports = { readFileStamp, readSourceIdentity, sameStamp, sameIdentity };
