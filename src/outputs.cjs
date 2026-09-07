const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function createStage(folder) {
  const directory = await fs.mkdtemp(path.join(folder, '.ffmpeg-encoder-'));
  return { directory, file: path.join(directory, 'encoded.mkv') };
}

async function cleanupStage(stage) {
  if (!stage) return;
  // Delete only the file and directory created for this particular job. Never
  // recursively delete a user-selected folder, or sweep by filename pattern.
  await fs.unlink(stage.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(stage.directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

async function publishOutput(stage, destination, { signal, link = fs.link } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('Encoding cancelled before publication.'), { code: 'CANCELLED' });
  try {
    // On NTFS this atomically creates a second name for the validated file. An
    // existing file, directory, or symlink makes link fail without overwriting.
    await link(stage.file, destination);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
  }
  // Filesystems without hard links use exclusive copy. COPYFILE_EXCL guarantees
  // conflict safety; a failed copy is cleaned up by Node. This fallback cannot
  // make the final name appear atomically, so callers report that limitation.
  try {
    await fs.copyFile(stage.file, destination, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

module.exports = { exists, createStage, cleanupStage, publishOutput };
