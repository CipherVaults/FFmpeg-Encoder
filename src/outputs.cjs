const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

// Cleanup authority lives only in this process. A journal entry, copied path
// object, or a familiar temporary filename cannot grant that authority.
const stages = new WeakMap();
const CONTENT_FIELDS = ['size', 'mtimeNs', 'ctimeNs'];
const LINK_UNAVAILABLE = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

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

function retained(stage, reason) {
  return { retained: true, directory: stage.directory, file: stage.file, reason };
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
    if (!await sameDirectory(stage, record)) return retained(stage, 'The staging directory changed before cleanup; no pathname was removed.');
    await fs.unlink(stage.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
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

async function publishOutput(stage, destination, { signal, link = fs.link, atomicOnly = false } = {}) {
  const record = recordOf(stage);
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  await requireSealed(stage, record);
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
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
    const published = await statOrAbsent(destination);
    // Linking changes ctime/link count. Object identity, size and mtime should
    // still match. Native path-based link has no identity-conditional variant:
    // detect a last-instant race and preserve the destination for review.
    if (!published?.isFile() || published.isSymbolicLink() || !sameObject(record.sealed, published)
      || record.sealed.size !== published.size || record.sealed.mtimeNs !== published.mtimeNs) {
      throw failure('PUBLICATION_UNCERTAIN', 'The published name changed during publication; it was retained for review.');
    }
    return true;
  }
  // Only distinct-folder callers permit this documented non-atomic fallback.
  // COPYFILE_EXCL protects a race winner. Cancellation before it starts prevents
  // publication; cancellation after success never deletes a completed output.
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  await requireSealed(stage, record);
  if (signal?.aborted) throw failure('CANCELLED', 'Encoding cancelled before publication.');
  try {
    await fs.copyFile(stage.file, destination, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

module.exports = { exists, createStage, sealStage, cleanupStage, publishOutput };
