'use strict';

// The regular Windows runtime is issued only from this fixed rebuild. The
// legacy candidate verifier still supports its historical comparison harnesses.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertOrdinaryPath, readBoundedJson, verifyPinnedFile } = require('./candidate-runtime.cjs');

const MANIFEST_NAME = 'regular-windows-engine-manifest.json';
const MANIFEST_SHA256 = '62ecac1a03fe102a0ebf7b4ecd0573d8ac0daec50ea4899484b95863f62fe801';
const REGULAR_WINDOWS_PAIR = 'faea502a4addd1dde4b74f1a63ae454d3615c7c04fac7d9b20b85a77c74b5590';
const RUNTIME_SLOT = 'ffmpeg-9.1-faea502a4add';

async function loadRegularWindowsManifest({ root, resourcesPath, isPackaged = false }) {
  assert(typeof isPackaged === 'boolean', 'Expected a fixed Windows runtime layout.');
  const directory = isPackaged ? resourcesPath : root;
  assert(typeof directory === 'string' && path.isAbsolute(directory), 'Windows runtime root must be absolute.');
  const manifestPath = isPackaged ? path.join(directory, 'binary-manifest.json')
    : path.join(directory, 'resources', MANIFEST_NAME);
  const manifest = await readBoundedJson(manifestPath, undefined, MANIFEST_SHA256);
  const pair = createHash('sha256').update(JSON.stringify(manifest.binaries
    .map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex');
  assert.equal(pair, REGULAR_WINDOWS_PAIR);
  assert.equal(manifest.enginePair, pair);
  return { manifest, manifestPath };
}

async function verifyRegularWindowsRuntime(options) {
  const { manifest, manifestPath } = await loadRegularWindowsManifest(options);
  const directory = options.isPackaged ? options.resourcesPath : options.root;
  const binaries = manifest.binaries.map(pin => path.join(directory, options.isPackaged ? pin.runtimePath : pin.developmentPath));
  const notices = manifest.notices.map(pin => path.join(directory, options.isPackaged ? pin.packagedPath : pin.repositoryPath));
  const binaryDirectory = await assertOrdinaryPath(path.dirname(binaries[0]), 'directory');
  // A loose DLL beside the pair must never enter the trusted search directory.
  assert.deepEqual((await fs.readdir(binaryDirectory)).sort(), ['ffmpeg.exe', 'ffprobe.exe'],
    'Unexpected entry in the regular Windows engine binary directory.');
  const verified = [];
  const pins = [...manifest.binaries, ...manifest.notices];
  for (const [index, filename] of [...binaries, ...notices].entries()) {
    verified.push(await verifyPinnedFile(filename, pins[index]));
  }
  return { manifest, manifestPath, ffmpeg: binaries[0], ffprobe: binaries[1], notices, verified };
}

// Call only after the runner restricts this to absolute Windows media tools.
function isRegularWindowsMediaPath(file, resourcesPath) {
  const directory = path.win32.dirname(file).toLowerCase();
  return directory.endsWith('\\.tools\\candidate-runtime\\' + RUNTIME_SLOT + '\\bin')
    || typeof resourcesPath === 'string' && path.win32.isAbsolute(resourcesPath)
      && directory === path.win32.join(resourcesPath, 'ffmpeg').toLowerCase();
}

module.exports = { MANIFEST_NAME, MANIFEST_SHA256, REGULAR_WINDOWS_PAIR, RUNTIME_SLOT,
  loadRegularWindowsManifest, verifyRegularWindowsRuntime, isRegularWindowsMediaPath };
