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

const DEVELOPMENT_ROOT = '.tools/candidate-runtime/ffmpeg-9.1';
const MINIMUM_D_FREE_BYTES = 25n * 1024n ** 3n;
const MAX_MANIFEST_BYTES = 64 * 1024;
// The 0.7 Alpha pair is built from signed FFmpeg n9.1 source with the build kit
// named below and qualified offline. Every value here is a non-private
// identifier: no local absolute path, drive letter or personal name.
const EXPECTED_MANIFEST = {
  schemaVersion: 1,
  purpose: 'Isolated local 0.7 candidate; accepted and benchmark runtimes remain unchanged.',
  release: '9.1', platform: 'win32-x64',
  variant: 'Source-built static FFmpeg n9.1 (GPL version 3, llvm-mingw UCRT, offline build)',
  version: '9.1',
  developmentRoot: DEVELOPMENT_ROOT,
  sourceBuild: {
    upstream: {
      project: 'FFmpeg', tag: 'n9.1', commit: '74e4393595cf2b5857f0da925c4e0dd74ea306e5',
      archive: 'ffmpeg-9.1.tar.xz',
      signatureKeyFingerprint: 'FCF986EA15E6E293A5644F10B4322F04D67658D8',
      signatureStatus: 'OpenPGP signature of the source archive verified offline against this primary key.',
    },
    sourceArchives: [
      { name: 'ffmpeg-9.1.tar.xz', sizeBytes: 12557532, sha256: '1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433' },
      { name: 'x264_0.164.3108+git31e19f9.orig.tar.gz', sizeBytes: 954789, sha256: '41606cb8e788a7f8c4514290646d4ba5c7bc68d9e1ccd1a73f446a90546913eb' },
      { name: 'x265_4.1.orig.tar.xz', sizeBytes: 1113508, sha256: '85abb8a850000bf693947459c42a666a3ecd6de10a2ac6b3c6647554b14d3270' },
      { name: 'svt-av1_2.3.0+dfsg.orig.tar.xz', sizeBytes: 9017580, sha256: '815e88cc539c41b8ebd1a6f362f82ab510147635fc6c3edfa35edcfbed302cd8' },
      { name: 'dav1d_1.5.1.orig.tar.xz', sizeBytes: 1020760, sha256: '401813f1f89fa8fd4295805aa5284d9aed9bc7fc1fdbe554af4292f64cbabe21' },
      { name: 'zlib-1.4.tar.gz', sizeBytes: 1507140, sha256: '02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584' },
      { name: 'nv-codec-headers-13.0.19.0.tar.gz', sizeBytes: 81250, sha256: '13da39edb3a40ed9713ae390ca89faa2f1202c9dda869ef306a8d4383e242bee' },
      { name: 'AMF-headers-v1.5.2.tar.gz', sizeBytes: 83716, sha256: 'd3c12eb324edf05e214608b6a395a51dd95770ed9d45520185d6c3a206811c99' },
      { name: 'libvpl-c45b5d786bf7cdabbe49ff1bab78693ad78feb78.tar.gz', sizeBytes: 12971955, sha256: 'fe67de2395886910b7d0d752a4d6ea24914fff4ed39a1ddd7265eaea80498183' },
    ],
    toolchain: 'llvm-mingw 20261104 UCRT x86_64 (clang 23.1.5)',
    configureFlags: [
      '--disable-autodetect', '--enable-w32threads', '--enable-gpl', '--enable-version3', '--enable-static',
      '--disable-shared', '--disable-doc', '--disable-debug', '--disable-ffplay', '--disable-network',
      '--enable-zlib', '--enable-libx264', '--enable-libx265', '--enable-libsvtav1', '--enable-libdav1d',
      '--enable-ffnvcodec', '--enable-cuda', '--enable-cuvid', '--enable-nvdec', '--enable-nvenc',
      '--enable-d3d11va', '--enable-amf', '--enable-libvpl',
    ],
    buildKit: {
      directory: 'release-kit/alpha-0.7/ffmpeg-build',
      scripts: [
        { name: 'build.sh', sha256: 'd785f2d4bbad2526c19e769fce585ec5bd3f205d171b4c516bf43440fdebc400' },
        { name: 'qualify.ps1', sha256: '51dd9f3aa67c0e6135475e63453590b4ee923bd216d8117d0bfab4d6949e8a28' },
      ],
    },
    qualification: 'sandbox run sbx-alpha-build2, 23/23 checks',
  },
  binaries: [
    { name: 'ffmpeg.exe', buildOutputPath: 'bin/ffmpeg.exe', runtimePath: 'ffmpeg/ffmpeg.exe',
      developmentPath: `${DEVELOPMENT_ROOT}/bin/ffmpeg.exe`, sizeBytes: 53270528,
      sha256: '3ef0f1cdf14c19dae15ec5ae24b71c16681c1d381fd94d20fdf472618d5eebb1', version: '9.1' },
    { name: 'ffprobe.exe', buildOutputPath: 'bin/ffprobe.exe', runtimePath: 'ffmpeg/ffprobe.exe',
      developmentPath: `${DEVELOPMENT_ROOT}/bin/ffprobe.exe`, sizeBytes: 53071360,
      sha256: '9adfbe97899c00145240061c70df70175a1f25e413ec9c745c06956240b33c28', version: '9.1' },
  ],
  notices: [
    { repositoryPath: `${DEVELOPMENT_ROOT}/notices/FFmpeg-LICENSE.txt`, packagedPath: 'third-party/FFmpeg-LICENSE.txt',
      sizeBytes: 35147, sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903', source: 'COPYING.GPLv3' },
    { repositoryPath: `${DEVELOPMENT_ROOT}/notices/FFmpeg-README.txt`, packagedPath: 'third-party/FFmpeg-README.txt',
      sizeBytes: 120388, sha256: '3e4c150293abd50aacf6f15e2b1a0e7abf2cd64faeed8242d2fe3e6e0ca7d1b9', source: 'generated' },
    { repositoryPath: `${DEVELOPMENT_ROOT}/notices/Electron-extra-notices.txt`, packagedPath: 'third-party/Electron-extra-notices.txt',
      sizeBytes: 43673, sha256: '699aa0b45735ca9c6c017f1bdf382528f7538cc9935665853da8cfa13751bc55', source: 'generated' },
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
    evidence: 'Configured with --enable-gpl --enable-version3, so the combined engine is GPL version 3 or later; the bundled FFmpeg-LICENSE.txt is the GPLv3 text from the source tree (COPYING.GPLv3).',
    correspondingSource: {
      asset: 'FFmpeg-Encoder-0.7.0-alpha.1-ffmpeg-9.1-source.zip',
      releasePage: 'https://github.com/CipherVaults/FFmpeg-Encoder/releases/tag/v0.7.0-alpha.1',
    },
    distributionStatus: 'The 0.7 Alpha prerelease engine (0.7.0-alpha.1). It is not a stable release or accepted product runtime.',
  },
  evidence: {
    qualification: 'sandbox build sbx-alpha-build2; qualify.json 23/23',
    qualificationLimit: 'The offline sandbox engine qualification did not test AMD, Intel or NVIDIA hardware encode/decode paths. This is not full candidate or packaged acceptance.',
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
