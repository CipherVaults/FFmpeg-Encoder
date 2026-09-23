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

function assertIdentityMatches(expected, actual, { message, stage, digest = false }) {
  if (digest ? sameIdentity(expected, actual) : sameStamp(expected, actual)) return;
  const fields = ['canonicalPath', ...STAT_FIELDS, ...(digest ? ['sparseDigest'] : [])];
  const changedFields = fields.filter(field => expected?.[field] !== actual?.[field]);
  // Keep the exact evidence in the local results log. Diagnostics never replace
  // the strict identity comparison or turn a matching sparse digest into proof
  // that unsampled bytes are unchanged (including when mtime was restored).
  const snapshot = value => Object.fromEntries(fields.map(field => [field, typeof value?.[field] === 'string' ? value[field] : null]));
  const diagnostic = { version: 1, stage, changedFields, expected: snapshot(expected), actual: snapshot(actual),
    comparison: digest ? 'sparse-identity' : 'filesystem-stamp' };
  const detail = changedFields.length ? `Changed identity fields: ${changedFields.join(', ')}.` : 'The source identity is incomplete or invalid.';
  const sparseMatch = digest && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(expected?.sparseDigest)
    && expected.sparseDigest === actual?.sparseDigest;
  const limit = sparseMatch ? ' Sparse samples match; unchanged full content cannot be established.' : '';
  throw new ToolError('INPUT_CHANGED', `${message} ${detail}${limit} Prepare the source again.`, { sourceIdentityDiagnostic: diagnostic });
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
  assertIdentityMatches(expected, after, { stage: 'path-resolution', message: 'Source identity changed while resolving its path.' });
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
    assertIdentityMatches(before, opened, { stage: 'path-to-open-handle', message: 'Source identity changed before sampling.' });
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
    assertIdentityMatches(before, after, { stage: 'handle-before-after-sampling', message: 'Source identity changed during sampling.' });
    assertIdentityMatches(after, named, { stage: 'handle-to-path-after-sampling', message: 'The source path no longer matches its sampled file handle.' });
    // This digest strengthens ordinary change detection without reading an
    // entire archive. It is not a full-file hash or a lock against active writers.
    return { ...after, sparseDigest: DIGEST_PREFIX + digest.digest('hex') };
  } finally {
    await handle.close();
  }
}

module.exports = { readFileStamp, readSourceIdentity, sameStamp, sameIdentity, assertIdentityMatches };
