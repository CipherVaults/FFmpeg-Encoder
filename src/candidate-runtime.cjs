'use strict';

// The candidate has a separate, fixed runtime namespace. In particular, the
// paused benchmark and accepted builds continue to read the legacy manifest and
// root ffmpeg directory. This module never executes, downloads or falls back to
// PATH, and it accepts no renderer-controlled runtime selection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const DEVELOPMENT_ROOT = '.tools/candidate-runtime/ffmpeg-9.0.2';
const MINIMUM_D_FREE_BYTES = 25n * 1024n ** 3n;
const MAX_MANIFEST_BYTES = 64 * 1024;
const EXPECTED_MANIFEST = {
  schemaVersion: 1,
  purpose: 'Isolated local 0.7 candidate; accepted and benchmark runtimes remain unchanged.',
  release: '9.0.2', platform: 'win32-x64', variant: 'Gyan release full static',
  version: '9.0.2-full_build-www.gyan.dev',
  developmentRoot: DEVELOPMENT_ROOT,
  publisherPage: 'https://www.gyan.dev/ffmpeg/builds/',
  releasePage: 'https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2',
  archive: {
    fileName: 'ffmpeg-9.0.2-full_build.7z', rootDirectory: 'ffmpeg-9.0.2-full_build',
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-full_build.7z',
    sha256: 'f0e46253c70dfe902bac915dfb4224f0cf1b7c6eeab9da2ccc9a5581f9a71b13', sizeBytes: 168971636,
  },
  binaries: [
    { name: 'ffmpeg.exe', archivePath: 'bin/ffmpeg.exe', runtimePath: 'ffmpeg/ffmpeg.exe',
      developmentPath: `${DEVELOPMENT_ROOT}/bin/ffmpeg.exe`, sizeBytes: 227823104,
      sha256: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0', version: '9.0.2-full_build-www.gyan.dev' },
    { name: 'ffprobe.exe', archivePath: 'bin/ffprobe.exe', runtimePath: 'ffmpeg/ffprobe.exe',
      developmentPath: `${DEVELOPMENT_ROOT}/bin/ffprobe.exe`, sizeBytes: 227621376,
      sha256: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3', version: '9.0.2-full_build-www.gyan.dev' },
  ],
  notices: [
    { archivePath: 'LICENSE', repositoryPath: `${DEVELOPMENT_ROOT}/notices/FFmpeg-LICENSE.txt`,
      packagedPath: 'third-party/FFmpeg-LICENSE.txt', sizeBytes: 35147,
      sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903' },
    { archivePath: 'README.txt', repositoryPath: `${DEVELOPMENT_ROOT}/notices/FFmpeg-README.txt`,
      packagedPath: 'third-party/FFmpeg-README.txt', sizeBytes: 45523,
      sha256: 'e7db34704804ed8844e837714eebbf843ca0a499555541df9e47fa2cc033dcb1' },
  ],
  electron: {
    version: '44.7.0',
    archive: {
      fileName: 'electron-v44.7.0-win32-x64.zip',
      releasePage: 'https://github.com/electron/electron/releases/tag/v44.7.0',
      url: 'https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-win32-x64.zip',
      localPath: '.tools/candidate-runtime/electron-44.7.0-zip/electron-v44.7.0-win32-x64.zip',
      sha256: 'eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c', sizeBytes: 158293649,
    },
  },
  license: {
    identifier: 'GPL-3.0-or-later',
    evidence: 'The unchanged publisher README labels this build GPL v3; the bundled LICENSE is GPL version 3.',
    publisherSourceCommitPrefix: '946fcce07b',
    publisherSourceUrl: 'https://github.com/FFmpeg/FFmpeg/commit/946fcce07b',
    distributionStatus: 'Local candidate only. Publisher source identification is not a complete corresponding-source distribution or public-release approval.',
  },
  evidence: {
    transferReceipt: 'F:/FFmpeg Encoder Project supplied videos/_FFmpeg-0.7-Owned/downloads/runtime-trials/transfer-report.json',
    runtimeTrial: 'artifacts/v0.7/runtime-trials/ffmpeg-9.0.2-Sy8OaJ/report.json',
    qualificationLimit: 'The isolated trial passed current CPU/NVIDIA capability and supplied-file inspection checks. This is not full candidate or packaged acceptance.',
  },
};

function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
freeze(EXPECTED_MANIFEST);

// Reject accessors and exotic objects before comparison: caller-provided values
// must remain inert data even though this API is main/build-only, not IPC.
function plainData(value, depth = 0) {
  assert(depth <= 8, 'Candidate manifest nesting is excessive.');
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
  assert(value && typeof value === 'object', 'Candidate manifest must contain plain JSON data.');
  assert(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, 'Candidate manifest contains an exotic object.');
  assert.equal(Object.getOwnPropertySymbols(value).length, 0, 'Candidate manifest contains symbol properties.');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    assert(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'Candidate manifest contains an accessor or hidden property.');
    plainData(descriptor.value, depth + 1);
  }
}

function expectedCandidateManifest() { return structuredClone(EXPECTED_MANIFEST); }

function validateCandidateManifest(value) {
  plainData(value);
  // Exact pins include paths, pair sizes/hashes, notices and Electron archive.
  // Changing a version or selection requires a separate reviewed checkpoint;
  // editing a manifest alone cannot redirect a production executable.
  assert.deepEqual(value, EXPECTED_MANIFEST, 'Candidate runtime manifest differs from the approved fixed pins.');
  return structuredClone(value);
}

function absolutePath(value, label) {
  assert(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'), `${label} must be an absolute path.`);
  return path.resolve(value);
}

function resolveCandidateRuntime({ root, resourcesPath, isPackaged = false } = {}) {
  assert(typeof isPackaged === 'boolean', 'isPackaged must be a boolean.');
  root = absolutePath(root, 'Project/application root');
  const resourceRoot = isPackaged ? absolutePath(resourcesPath, 'Packaged resources directory') : root;
  return {
    isPackaged, root, resourcesPath: isPackaged ? resourceRoot : null,
    manifestPath: isPackaged ? path.join(resourceRoot, 'binary-manifest.json') : path.join(root, 'resources', 'candidate-binary-manifest.json'),
    ffmpeg: path.join(resourceRoot, ...(isPackaged ? 'ffmpeg/ffmpeg.exe' : EXPECTED_MANIFEST.binaries[0].developmentPath).split('/')),
    ffprobe: path.join(resourceRoot, ...(isPackaged ? 'ffmpeg/ffprobe.exe' : EXPECTED_MANIFEST.binaries[1].developmentPath).split('/')),
    notices: EXPECTED_MANIFEST.notices.map(entry => path.join(resourceRoot, ...(isPackaged ? entry.packagedPath : entry.repositoryPath).split('/'))),
    electronArchive: isPackaged ? null : path.join(root, ...EXPECTED_MANIFEST.electron.archive.localPath.split('/')),
  };
}

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

async function assertOrdinaryPath(filename, type = 'file') {
  const resolved = absolutePath(filename, 'Verified runtime path');
  const anchor = path.parse(resolved).root;
  let current = anchor;
  const pieces = path.relative(anchor, resolved).split(path.sep).filter(Boolean);
  for (let index = 0; index <= pieces.length; index += 1) {
    if (index) current = path.join(current, pieces[index - 1]);
    const stat = await fsp.lstat(current);
    const leaf = index === pieces.length;
    assert(!stat.isSymbolicLink(), `Runtime path contains a link/reparse point: ${current}`);
    assert(leaf && type === 'file' ? stat.isFile() : stat.isDirectory(), `Runtime path has an unexpected entry type: ${current}`);
  }
  assert(samePath(await fsp.realpath(resolved), resolved), `Runtime path has a redirected ancestor: ${resolved}`);
  return resolved;
}

function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, nlink: stat.nlink,
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, birthtimeMs: stat.birthtimeMs };
}

async function openStableFile(filename) {
  await assertOrdinaryPath(filename);
  const before = await fsp.lstat(filename);
  assert.equal(before.nlink, 1, `Runtime file must have exactly one link: ${filename}`);
  const handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { assert.deepEqual(identity(await handle.stat()), identity(before), `Runtime file changed during open: ${filename}`); }
  catch (error) { await handle.close(); throw error; }
  return { handle, before };
}

async function assertStableFile(filename, handle, before) {
  assert.deepEqual(identity(await handle.stat()), identity(before), `Runtime file changed while reading: ${filename}`);
  assert.deepEqual(identity(await fsp.lstat(filename)), identity(before), `Runtime path changed while reading: ${filename}`);
  await assertOrdinaryPath(filename);
}

async function readBoundedJson(filename, maxBytes = MAX_MANIFEST_BYTES) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 * 1024, 'JSON read limit is invalid.');
  const { handle, before } = await openStableFile(filename);
  try {
    assert(before.size <= maxBytes, `JSON exceeds its bounded read limit: ${filename}`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    assert(offset <= maxBytes, `JSON grew past its bounded read limit: ${filename}`);
    await assertStableFile(filename, handle, before);
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally { await handle.close(); }
}

async function verifyPinnedFile(filename, expected) {
  assert(expected && Number.isSafeInteger(expected.sizeBytes) && expected.sizeBytes >= 0 && /^[a-f0-9]{64}$/.test(expected.sha256), 'Invalid file pin.');
  const { handle, before } = await openStableFile(filename);
  try {
    assert.equal(before.size, expected.sizeBytes, `Runtime size mismatch: ${filename}`);
    const hash = createHash('sha256');
    // Read through the retained handle, not a separately opened pathname.
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const actual = hash.digest('hex');
    assert.equal(actual, expected.sha256, `Runtime SHA-256 mismatch: ${filename}`);
    await assertStableFile(filename, handle, before);
    return { path: filename, sizeBytes: before.size, sha256: actual };
  } finally { await handle.close(); }
}

async function loadCandidateManifest(options) {
  const selected = resolveCandidateRuntime(options);
  return validateCandidateManifest(await readBoundedJson(selected.manifestPath));
}

async function verifyCandidateRuntime(options) {
  const selected = resolveCandidateRuntime(options);
  const manifest = await loadCandidateManifest(options);
  const verified = [];
  for (const [index, filename] of [selected.ffmpeg, selected.ffprobe].entries()) {
    verified.push(await verifyPinnedFile(filename, manifest.binaries[index]));
  }
  for (const [index, filename] of selected.notices.entries()) verified.push(await verifyPinnedFile(filename, manifest.notices[index]));
  return { ...selected, manifest, verified };
}

module.exports = { DEVELOPMENT_ROOT, MINIMUM_D_FREE_BYTES, MAX_MANIFEST_BYTES, expectedCandidateManifest,
  validateCandidateManifest, resolveCandidateRuntime, assertOrdinaryPath, readBoundedJson,
  verifyPinnedFile, loadCandidateManifest, verifyCandidateRuntime };
