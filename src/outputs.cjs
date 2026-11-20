const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { readSourceIdentity, sameStamp, sameIdentity } = require('./source-identity.cjs');

// Cleanup authority lives only in this process. A journal entry, copied path
// object, or a familiar temporary filename cannot grant that authority.
const stages = new WeakMap();
const CONTENT_FIELDS = ['size', 'mtimeNs', 'ctimeNs'];
const LINK_UNAVAILABLE = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);
const COPY_VERIFY_BYTES = 1024 * 1024;
const PUBLICATION_STAMP_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];

function failure(code, message, cause) {
  return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });
}

function recordOf(stage) {
  const record = stage && stages.get(stage);
  if (!record) throw failure('INVALID_STAGE', 'Only an explicitly created staging object can be used.');
  return record;
}

function reliable(stat) {
  return stat.dev !== 0n && stat.ino !== 0n;
}

function sameObject(expected, actual) {
  return reliable(expected) && reliable(actual)
    && expected.dev === actual.dev && expected.ino === actual.ino
    && expected.birthtimeNs === actual.birthtimeNs;
}

function sameContent(expected, actual) {
  return sameObject(expected, actual) && CONTENT_FIELDS.every(field => expected[field] === actual[field]);
}

async function statOrAbsent(file) {
  try { return await fs.lstat(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function sameDirectory(stage, record) {
  const named = await statOrAbsent(stage.directory);
  if (!named?.isDirectory() || named.isSymbolicLink() || !sameObject(record.directory, named)) return false;
  // Resolving the parent chain also detects a replaced/reparsed ancestor. The
  // selected output folder is separately revalidated by the service.
  return await fs.realpath(stage.directory) === record.canonicalDirectory;
}

async function createStage(folder) {
  const directory = await fs.mkdtemp(path.join(path.resolve(folder), '.ffmpeg-encoder-'));
  const directoryStat = await fs.lstat(directory, { bigint: true });
  if (!reliable(directoryStat) || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw failure('STAGE_IDENTITY_UNAVAILABLE', 'The temporary directory has no reliable filesystem identity; it has been retained.');
  }
  const stage = Object.freeze({ directory, file: path.join(directory, 'encoded.mkv') });
  stages.set(stage, { directory: directoryStat, canonicalDirectory: await fs.realpath(directory), sealed: null, cleaned: false });
  return stage;
}

async function inspectStageFile(stage, record) {
  if (record.cleaned || !await sameDirectory(stage, record)) {
    throw failure('STAGE_CHANGED', 'The owned temporary directory changed. The output was not published.');
  }
  const named = await statOrAbsent(stage.file);
  if (!named?.isFile() || named.isSymbolicLink() || !reliable(named)) {
    throw failure('STAGE_CHANGED', 'The temporary output is missing, replaced, or not an ordinary file.');
  }
  return named;
}

async function sealStage(stage) {
  const record = recordOf(stage);
  const before = await inspectStageFile(stage, record);
  if (before.nlink !== 1n) {
    throw failure('STAGE_CHANGED', 'The temporary output has another hard-linked name and cannot be bound for validation.');
  }
  const handle = await fs.open(stage.file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    const after = await inspectStageFile(stage, record);
    if (!opened.isFile() || opened.nlink !== 1n || after.nlink !== 1n
      || !sameContent(before, opened) || !sameContent(opened, after)
      || (record.sealed && !sameContent(record.sealed, after))) {
      throw failure('STAGE_CHANGED', 'The temporary output changed while binding its validation identity.');
    }
    // Call only after the owned encoder closes successfully and BEFORE ffprobe.
    // Re-sealing may verify the same file; it must never bless a replacement.
    record.sealed ||= after;
  } finally { await handle.close(); }
}

async function requireSealed(stage, record) {
  if (!record.sealed) throw failure('STAGE_NOT_SEALED', 'Bind the completed temporary output before validating and publishing it.');
  const current = await inspectStageFile(stage, record);
  if (current.nlink !== 1n || !sameContent(record.sealed, current)) {
    throw failure('STAGE_CHANGED', 'The temporary output changed after validation began. The output was not published.');
  }
}

async function markStageValidated(stage) {
  const record = recordOf(stage);
  await requireSealed(stage, record);
  // Only main calls this after all media/provenance checks pass. Persisted paths
  // cannot reconstruct this ownership. Later source failure, cancellation or a
  // destination race must not delete a completed, validated result.
  record.validated = true;
}

// Retention is deliberately weaker than validation/publication authority.
// A closed encoder's sealed output may still be useful after a bounded evidence
// collector fails. Preserve that exact owned object without approving its media.
async function retainSealedStage(stage, reason) {
  const record = recordOf(stage);
  if (typeof reason !== 'string' || !reason.length || reason.length > 512) {
    throw failure('INVALID_RETENTION_REASON', 'A bounded retention reason is required.');
  }
  await requireSealed(stage, record);
  record.retentionReason = reason;
}

function retained(stage, reason) {
  return { retained: true, directory: stage.directory, file: stage.file, reason };
}

function checkCopyCancellation(signal) {
  if (signal?.aborted) throw failure('CANCELLED', 'Copy verification cancelled; the copied file has not been approved.');
}

function regularSingleFile(stat) {
  return stat?.isFile() && !stat.isSymbolicLink() && reliable(stat) && stat.nlink === 1n;
}

async function hashBoundFile(file, { expected, signal, onProgress, progressStage } = {}) {
  checkCopyCancellation(signal);
  const before = await statOrAbsent(file);
  if (!regularSingleFile(before) || (expected && !sameContent(expected, before))) {
    throw failure('COPY_VERIFICATION_CHANGED', 'A file used for copy verification is missing, linked, replaced or changed.');
  }
  const canonical = await fs.realpath(file);
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!regularSingleFile(opened) || !sameContent(before, opened)) {
      throw failure('COPY_VERIFICATION_CHANGED', 'A copy-verification pathname no longer matches its opened handle.');
    }
    const size = Number(opened.size);
    if (!Number.isSafeInteger(size)) throw failure('COPY_VERIFICATION_LIMIT', 'The completed file is too large for safe verification offsets.');
    const buffer = Buffer.alloc(COPY_VERIFY_BYTES);
    const digest = createHash('sha256');
    let position = 0;
    while (position < size) {
      checkCopyCancellation(signal);
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytesRead) throw failure('COPY_VERIFICATION_CHANGED', 'A completed file became shorter during copy verification.');
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      onProgress?.(Object.freeze({ stage: progressStage, completed: position, total: size }));
    }
    checkCopyCancellation(signal);
    const after = await handle.stat({ bigint: true });
    const named = await statOrAbsent(file);
    if (!regularSingleFile(after) || !regularSingleFile(named)
      || !sameContent(opened, after) || !sameContent(after, named) || canonical !== await fs.realpath(file)) {
      throw failure('COPY_VERIFICATION_CHANGED', 'A completed file changed while verifying its complete contents.');
    }
    return { hash: digest.digest('hex'), stat: named, canonical };
  } finally { await handle.close(); }
}

// Opt-in main-owned remux path. Keep native COPYFILE_EXCL for every existing
// caller; this bounded copy reports actual writes and polls cancellation. An
// uncertain newly-created destination is retained, never deleted or approved.
async function copyWithProgress(file, destination, expected, signal, onProgress, assertCurrent) {
  const source = await fs.open(file, 'r'); let output, created = false, primary;
  try {
    const before = await source.stat({ bigint: true });
    if (!regularSingleFile(before) || !sameContent(before, expected)) throw failure('COPY_VERIFICATION_CHANGED', 'The validated copy source changed.');
    const size = Number(before.size);
    if (!Number.isSafeInteger(size)) throw failure('COPY_VERIFICATION_LIMIT', 'The completed file is too large for safe copy offsets.');
    checkCopyCancellation(signal);
    if (assertCurrent) assertPublishStart(signal, assertCurrent);
    output = await fs.open(destination, 'wx+'); created = true;
    const bound = await output.stat({ bigint: true });
    if (!regularSingleFile(bound) || bound.size !== 0n) throw failure('COPY_VERIFICATION_CHANGED', 'The exclusive copy destination is not an ordinary empty file.');
    const buffer = Buffer.alloc(COPY_VERIFY_BYTES); let position = 0;
    while (position < size) {
      checkCopyCancellation(signal);
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytesRead) throw failure('COPY_VERIFICATION_CHANGED', 'The validated copy source became shorter.');
      for (let written = 0; written < bytesRead;) {
        checkCopyCancellation(signal);
        const { bytesWritten } = await output.write(buffer, written, bytesRead - written, position + written);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytesRead - written) throw failure('COPY_VERIFICATION_CHANGED', 'The exclusive copy write made no valid progress.');
        written += bytesWritten;
        onProgress(Object.freeze({ stage: 'publication-copy', completed: position + written, total: size }));
      }
      position += bytesRead;
    }
    checkCopyCancellation(signal);
    const after = await source.stat({ bigint: true }), copied = await output.stat({ bigint: true }), named = await statOrAbsent(destination);
    if (!sameContent(before, after) || !regularSingleFile(copied) || !regularSingleFile(named) || !sameObject(bound, copied)
        || !sameContent(copied, named) || copied.size !== before.size) throw failure('COPY_VERIFICATION_CHANGED', 'The exclusive copy changed while writing.');
  } catch (error) {
    primary = error;
  } finally {
    const closes = await Promise.allSettled([output?.close(), source.close()]);
    primary ||= closes.find(result => result.status === 'rejected')?.reason;
  }
  if (primary) {
    if (created) throw failure('PUBLICATION_UNCERTAIN', 'The incomplete exclusive copy was retained without publication approval.', primary);
    throw primary;
  }
}

async function sameCopiedDestination(record) {
  const copied = record.copied;
  if (!copied) return true;
  const named = await statOrAbsent(copied.file);
  return regularSingleFile(named) && sameContent(copied.stat, named)
    && copied.canonical === await fs.realpath(copied.file);
}

function publicationStamp(file, stat) {
  return Object.freeze({ canonicalPath: file,
    ...Object.fromEntries(PUBLICATION_STAMP_FIELDS.map(field => [field, String(stat[field])])) });
}

// A fresh destination pathname is not publication authority. First bind it to
// the private receipt created by the checked hard-link/full-copy publication,
// then preserve that first observation's sparse identity through owned cleanup.
// This receipt cannot be recreated from a journal, a stage pathname or IPC.
async function readPublishedOutputIdentity(stage, { afterCleanup = false } = {}) {
  const record = recordOf(stage), receipt = record.publication;
  if (!record.validated || !record.published || !receipt) {
    throw failure('INVALID_PUBLICATION_RECEIPT', 'Only a validated, checked publication can provide an output identity.');
  }
  if (typeof afterCleanup !== 'boolean' || (afterCleanup ? !record.cleaned || !record.publishedObservation : record.cleaned)) {
    throw failure('PUBLICATION_OBSERVATION_ORDER', 'Observe the checked publication before cleanup and its final identity only after owned cleanup.');
  }
  if (record.publicationInvalid) throw failure('PUBLISHED_OUTPUT_CHANGED', 'The checked publication identity was invalidated; it cannot be adopted again.');
  try {
    const identity = await readSourceIdentity(receipt.identity.canonicalPath);
    if (!afterCleanup) {
      if (!sameStamp(receipt.identity, identity)
          || (record.publishedObservation && !sameIdentity(record.publishedObservation, identity))) {
        throw failure('PUBLISHED_OUTPUT_CHANGED', 'The saved name or contents changed before the checked publication could be observed.');
      }
      record.publishedObservation ||= Object.freeze({ ...identity });
    } else {
      // Removing OUR confirmed staging hard link explains one ctime transition,
      // not a new general output/source policy. A missing stage, verified copy,
      // failed cleanup or unrelated unlink cannot supply this exception.
      const expected = record.cleanedPublicationObservation || record.publishedObservation;
      const allowOwnedCleanupCtime = !record.cleanedPublicationObservation
        && receipt.method === 'hard-link' && record.ownedPublicationLinkRemoved === true;
      const comparable = allowOwnedCleanupCtime ? { ...identity, ctimeNs: expected.ctimeNs } : identity;
      if (!sameIdentity(expected, comparable)) {
        throw failure('PUBLISHED_OUTPUT_CHANGED', 'The checked publication changed during or after cleanup.');
      }
      record.cleanedPublicationObservation ||= Object.freeze({ ...identity });
    }
    // This remains bounded sparse observation plus filesystem identity, not a
    // claim of full-file immutability. Copy publication's full hash is separately
    // bound to its receipt; every future OutputAccess action checks strict stamps.
    return Object.freeze({ ...identity });
  } catch (cause) {
    record.publicationInvalid = true;
    if (cause.code === 'PUBLISHED_OUTPUT_CHANGED') throw cause;
    throw failure('PUBLISHED_OUTPUT_CHANGED', 'The checked publication could not be observed safely; no new identity was adopted.', cause);
  }
}

async function cleanupStage(stage, { protectedIdentities = new Set() } = {}) {
  if (!stage) return { retained: false };
  const record = recordOf(stage);
  if (record.cleaned) return { retained: false };
  if (!await sameDirectory(stage, record)) return retained(stage, 'The staging directory is missing or replaced; no pathname was removed.');
  const named = await statOrAbsent(stage.file);
  if (named) {
    if (protectedIdentities.has(`${named.dev}:${named.ino}`)) return retained(stage, 'The temporary pathname refers to a protected input identity; it was retained.');
    // A failed/cancelled encoder may leave a file that was never identity-bound.
    // Keep it rather than adopt whichever object now occupies that pathname.
    if (!record.sealed) return retained(stage, 'The incomplete output was never identity-bound; the temporary directory was retained.');
    if (!named.isFile() || named.isSymbolicLink() || !sameObject(record.sealed, named)) {
      return retained(stage, 'The temporary output was replaced; the current file and directory were retained.');
    }
    if (record.copied) {
      let current = false;
      try { current = await sameCopiedDestination(record); } catch { /* Retain on an unreadable destination too. */ }
      if (!current) {
        return { ...retained(stage, 'The copied destination changed or became unreadable after verification; the completed staging file was retained.'),
          completed: Boolean(record.validated), validationCurrent: named.nlink === 1n && sameContent(record.sealed, named) };
      }
    }
    if (record.validated && !record.published) {
      const validationCurrent = named.nlink === 1n && sameContent(record.sealed, named);
      const reason = validationCurrent
        ? 'Completed output retained without normal publication; review its recorded result before using it.'
        : 'A previously validated output changed before publication. It was retained for review; its current bytes are not approved.';
      return { ...retained(stage, reason), completed: true, validationCurrent };
    }
    if (record.retentionReason && !record.published) {
      return { ...retained(stage, record.retentionReason), completed: false, sealed: true, validationCurrent: false };
    }
    if (!await sameDirectory(stage, record)) return retained(stage, 'The staging directory changed before cleanup; no pathname was removed.');
    try {
      await fs.unlink(stage.file);
      if (record.publication?.method === 'hard-link') record.ownedPublicationLinkRemoved = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!await sameDirectory(stage, record)) return retained(stage, 'The staging directory changed before removal; it was retained.');
  try { await fs.rmdir(stage.directory); }
  catch (error) {
    if (['ENOTEMPTY', 'EEXIST'].includes(error.code)) return retained(stage, 'Additional objects remain in the staging directory; they were retained.');
    if (error.code !== 'ENOENT') throw error;
  }
  record.cleaned = true;
  return { retained: false };
}

// A monotonic owner check here can deny a new exclusive operation after all
// earlier awaits. It cannot undo a native write already submitted.
function assertPublishStart(signal, assertCurrent) {
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  if (assertCurrent === undefined) return;
  if (assertCurrent() !== undefined)
    throw failure('INVALID_PUBLICATION_GUARD', 'Publication requires a synchronous main-owned check.');
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
}

async function publishOutput(stage, destination, { signal, link = fs.link, atomicOnly = false, onProgress, assertCurrent } = {}) {
  if (onProgress !== undefined && typeof onProgress !== 'function') throw failure('INVALID_PUBLICATION_PROGRESS', 'Publication progress requires a main-owned callback.');
  if (assertCurrent !== undefined && typeof assertCurrent !== 'function')
    throw failure('INVALID_PUBLICATION_GUARD', 'Publication requires a synchronous main-owned check.');
  const record = recordOf(stage);
  if (record.retentionReason && !record.validated) {
    throw failure('STAGE_NOT_VALIDATED', 'A retained evidence-incomplete output cannot be published before successful validation.');
  }
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  await requireSealed(stage, record);
  assertPublishStart(signal, assertCurrent);
  let linked = false;
  try {
    // On NTFS this atomically creates a second name for the validated file. An
    // existing file, directory, or symlink makes link fail without overwriting.
    await link(stage.file, destination);
    linked = true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    if (!LINK_UNAVAILABLE.has(error.code)) throw error;
    if (atomicOnly) {
      throw failure('ATOMIC_PUBLICATION_UNAVAILABLE', 'Atomic exclusive publication is unavailable in this folder; same-folder output was not published.', error);
    }
  }
  if (linked) {
    let published;
    try { published = await statOrAbsent(destination); }
    catch (error) {
      // The exclusive link already succeeded. An observation failure cannot be
      // reported as a definite pre-publication failure or authorize deletion of
      // a destination that may contain the completed output. Preserve its cause.
      throw failure('PUBLICATION_UNCERTAIN', 'The destination may already contain the completed output, but its publication identity could not be checked. It was retained for review.', error);
    }
    // Linking changes ctime/link count. Object identity, size and mtime should
    // still match. Native path-based link has no identity-conditional variant:
    // detect a last-instant race and preserve the destination for review.
    if (!published?.isFile() || published.isSymbolicLink() || !sameObject(record.sealed, published)
      || record.sealed.size !== published.size || record.sealed.mtimeNs !== published.mtimeNs) {
      throw failure('PUBLICATION_UNCERTAIN', 'The published name changed during publication; it was retained for review.');
    }
    record.publication = Object.freeze({ method: 'hard-link', identity: publicationStamp(destination, published) });
    record.published = true;
    return true;
  }
  // Only distinct-folder callers permit this documented non-atomic fallback.
  // COPYFILE_EXCL protects a race winner. Cancellation before it starts prevents
  // publication; cancellation after success never deletes a completed output.
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  await requireSealed(stage, record);
  assertPublishStart(signal, assertCurrent);
  try {
    if (onProgress) await copyWithProgress(stage.file, destination, record.sealed, signal, onProgress, assertCurrent);
    else await fs.copyFile(stage.file, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  // Size/type checks cannot distinguish a same-sized damaged/replaced copy.
  // Only this non-atomic fallback reads both completed outputs in full. Stable
  // handle/path observations bind those SHA-256 values to the validated stage
  // and copied destination. Source admission remains bounded and unchanged.
  // Cancelling this additional I/O retains both names, rather than approving an
  // unchecked copy or discarding the sole validated staging file.
  try {
    await requireSealed(stage, record);
    const staged = await hashBoundFile(stage.file, { expected: record.sealed, signal, onProgress, progressStage: 'publication-hash-source' });
    const copied = await hashBoundFile(destination, { signal, onProgress, progressStage: 'publication-hash-destination' });
    await requireSealed(stage, record);
    if (copied.stat.size !== record.sealed.size || staged.hash !== copied.hash) {
      throw failure('COPY_CONTENT_MISMATCH', 'The copied destination does not contain the validated output bytes.');
    }
    const binding = { file: destination, stat: copied.stat, canonical: copied.canonical };
    if (!await sameCopiedDestination({ copied: binding })) throw failure('COPY_VERIFICATION_CHANGED', 'The copied destination changed before verification completed.');
    checkCopyCancellation(signal);
    record.copied = binding;
    record.publication = Object.freeze({ method: 'verified-copy', identity: publicationStamp(copied.canonical, copied.stat),
      sha256: copied.hash, sizeBytes: String(copied.stat.size) });
  } catch (error) {
    throw failure('PUBLICATION_UNCERTAIN', 'The destination may already contain the completed output, but the exclusive copy could not be checked. Both names were retained for review.', error);
  }
  record.published = true;
  return true;
}

module.exports = { exists, createStage, sealStage, markStageValidated, retainSealedStage, cleanupStage, publishOutput, readPublishedOutputIdentity };
