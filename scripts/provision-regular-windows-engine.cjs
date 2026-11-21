'use strict';

// Inputs are offline Gate 0 files. The recipe output and source ZIP are read
// only, and an existing or partial destination always requires explicit review.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { verifyPinnedFile } = require('../src/candidate-runtime.cjs');
const { RUNTIME_SLOT, loadRegularWindowsManifest, verifyRegularWindowsRuntime } = require('../src/regular-windows-runtime.cjs');
const { reserveDirectory, reserveDirectoryChain } = require('./provision-candidate-electron.cjs');

async function provisionRegularWindowsEngine(gateRoot) {
  assert.equal(process.platform, 'win32', 'The regular Windows engine intake requires Windows.');
  assert(typeof gateRoot === 'string' && path.isAbsolute(gateRoot), 'Pass the absolute Gate 0 evidence root.');
  const root = path.resolve(__dirname, '..');
  const { manifest } = await loadRegularWindowsManifest({ root });
  await verifyPinnedFile(path.join(gateRoot, manifest.correspondingSource.fileName), manifest.correspondingSource);
  const runOutput = path.join(gateRoot, 'build-run-a-r2', 'out');
  const entries = [
    ...manifest.binaries.map(pin => ({ pin, source: path.join(runOutput, 'bin', pin.name), destination: pin.developmentPath })),
    ...manifest.notices.map(pin => ({ pin, source: path.join(pin.sourceGroup === 'engine'
      ? path.join(runOutput, 'notices') : path.join(gateRoot, 'notice-supplement'), pin.name), destination: pin.repositoryPath })),
  ];
  for (const { pin, source } of entries) await verifyPinnedFile(source, pin);
  const parent = await reserveDirectoryChain(root, ['.tools', 'candidate-runtime']);
  const destination = await reserveDirectory(parent, RUNTIME_SLOT);
  await reserveDirectory(destination, 'bin');
  await reserveDirectory(destination, 'notices');
  for (const entry of entries) {
    await fs.copyFile(entry.source, path.join(root, entry.destination), constants.COPYFILE_EXCL);
  }
  const proof = await verifyRegularWindowsRuntime({ root });
  console.log(JSON.stringify({ status: 'REGULAR_WINDOWS_ENGINE_VERIFIED', enginePair: proof.manifest.enginePair,
    verifiedFiles: proof.verified.length }));
}

if (require.main === module) {
  provisionRegularWindowsEngine(process.argv.length === 3 ? process.argv[2] : undefined)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
