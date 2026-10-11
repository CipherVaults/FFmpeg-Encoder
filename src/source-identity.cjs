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

// Completion is a disposition decision, not renewed source/cache authority.
// A bounded observation cannot distinguish an attribute-only change from an
// unsampled edit with restored timestamps. Keep that uncertainty explicit.
function assessCompletedSource(expected, actual, { stage = 'after-encode', contentEvidence } = {}) {
  const fields = ['canonicalPath', ...STAT_FIELDS, 'sparseDigest'];
  const snapshot = value => Object.fromEntries(fields.map(field => [field, typeof value?.[field] === 'string' ? value[field] : null]));
  const complete = value => validStamp(value) && /^[1-9]\d*$/.test(value.dev) && /^[1-9]\d*$/.test(value.ino)
    && typeof value.sparseDigest === 'string' && /^sha256-sparse-v1:[a-f0-9]{64}$/.test(value.sparseDigest);
  const changedFields = fields.filter(field => expected?.[field] !== actual?.[field]);
  const diagnostic = { version: 1, stage, checkpoint: stage, changedFields,
    expected: snapshot(expected), actual: snapshot(actual), comparison: 'sparse-identity' };
  if (!complete(expected) || !complete(actual)) return { kind: 'incomplete', diagnostic };
  // An independently observed replacement/content-significant stamp change
  // remains a change even if optional stronger verification was interrupted.
  // Incomplete extra evidence must not obscure a mismatch already established
  // by the complete bounded observations used by the ordinary path.
  const boundedChange = changedFields.some(field => field !== 'ctimeNs');
  if (boundedChange) return { kind: 'changed', reason: 'observed-source-change', diagnostic };
  // Optional stronger evidence is main-owned and must contain complete before
  // and after SHA-256 observations. No full-file reading is performed here or
  // required by the default completion path. Invalid evidence never grants a pass.
  if (contentEvidence !== undefined) {
    const validHash = value => value && value.complete === true && value.algorithm === 'sha256'
      && value.bytes === expected.size && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest);
    if (!validHash(contentEvidence?.before) || !validHash(contentEvidence?.after)) return { kind: 'incomplete', diagnostic };
    if (contentEvidence.before.digest !== contentEvidence.after.digest) {
      return { kind: 'changed', reason: 'complete-content-mismatch', diagnostic: { ...diagnostic, contentMismatch: true } };
    }
  }
  if (!changedFields.length) return { kind: 'unchanged', diagnostic };
  if (changedFields.length === 1 && changedFields[0] === 'ctimeNs') {
    return { kind: 'ctime-only', diagnostic,
      warning: { code: 'SOURCE_CTIME_ONLY', message: 'The source\u2019s filesystem change time changed. Bounded checks did not demonstrate another change, but cannot rule out changes outside the sampled regions.' } };
  }
  // All complete differing observations must have been classified above.
  // This fallback stays closed if another comparison field is added later.
  return { kind: 'incomplete', diagnostic };
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

module.exports = { readFileStamp, readSourceIdentity, sameStamp, sameIdentity, assertIdentityMatches, assessCompletedSource };
