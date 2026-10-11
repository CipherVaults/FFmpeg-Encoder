'use strict';

// Local-only provisioning from the already verified trial archive/extraction.
// There is no download, child process, root ffmpeg activation or overwrite mode.
// A failed/partial destination is preserved for explicit review, never deleted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DEVELOPMENT_ROOT, MINIMUM_D_FREE_BYTES, expectedCandidateManifest,
  validateCandidateManifest, loadCandidateManifest, readBoundedJson, assertOrdinaryPath, verifyPinnedFile,
  verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');

const OWNED_TRIAL_ROOT = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const DEFAULT_RECEIPT = path.join(OWNED_TRIAL_ROOT, 'downloads', 'runtime-trials', 'transfer-report.json');
const DEFAULT_PAYLOAD = path.join(OWNED_TRIAL_ROOT, 'staging', 'runtime-trials', 'ffmpeg-9.0.2', 'ffmpeg-9.0.2-full_build');
const READY_RECEIPT = 'provision-receipt.json';

function verifyTransferReceipt(receipt, manifest = expectedCandidateManifest()) {
  validateCandidateManifest(manifest);
  assert(receipt && receipt.schema === 1 && Array.isArray(receipt.items) && receipt.items.length <= 32, 'Expected a bounded runtime transfer receipt.');
  const matching = receipt.items.filter(item => item?.name === manifest.archive.fileName);
  assert.equal(matching.length, 1, 'Receipt must identify exactly one candidate FFmpeg archive.');
  const item = matching[0];
  assert.equal(item.verified, true, 'Archive transfer was not marked verified.');
  assert.equal(item.release, manifest.releasePage, 'Archive release receipt differs.');
  assert.equal(item.url, manifest.archive.url, 'Archive URL receipt differs.');
  assert.equal(item.expectedBytes, manifest.archive.sizeBytes, 'Archive size receipt differs.');
  assert.equal(item.expectedSha256, manifest.archive.sha256, 'Archive digest receipt differs.');
  assert(typeof item.path === 'string' && path.isAbsolute(item.path) && path.basename(item.path) === manifest.archive.fileName, 'Archive receipt has an invalid local path.');
  return { ...item };
}

async function reserveParentDirectory(root) {
  await assertOrdinaryPath(root, 'directory');
  // Walk each fixed relative component without accepting a linked existing
  // ancestor. Creation is local and additive; no cleanup follows an error.
  let current = root;
  for (const name of ['.tools', 'candidate-runtime']) {
    current = path.join(current, name);
    try { await fsp.mkdir(current); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await assertOrdinaryPath(current, 'directory');
  }
  return current;
}

async function verifyReadyDestination(root, destination, manifest) {
  await assertOrdinaryPath(destination, 'directory');
  assert.deepEqual((await fsp.readdir(destination)).sort(), ['bin', 'notices', READY_RECEIPT].sort(), 'Existing candidate destination is incomplete or contains unexpected files; preserve it for review.');
  await assertOrdinaryPath(path.join(destination, 'bin'), 'directory');
  await assertOrdinaryPath(path.join(destination, 'notices'), 'directory');
  assert.deepEqual((await fsp.readdir(path.join(destination, 'bin'))).sort(), ['ffmpeg.exe', 'ffprobe.exe']);
  assert.deepEqual((await fsp.readdir(path.join(destination, 'notices'))).sort(), ['FFmpeg-LICENSE.txt', 'FFmpeg-README.txt']);
  const ready = await readBoundedJson(path.join(destination, READY_RECEIPT));
  assert.equal(ready.schemaVersion, 1, 'Existing provision receipt schema differs.');
  assert.equal(ready.release, manifest.release);
  assert.equal(ready.developmentRoot, DEVELOPMENT_ROOT);
  assert.equal(ready.archive.sha256, manifest.archive.sha256);
  assert.equal(ready.archive.sizeBytes, manifest.archive.sizeBytes);
  const verified = await verifyCandidateRuntime({ root });
  assert.deepEqual(ready.files, verified.verified.map(({ path: filename, ...pin }) => ({ path: path.relative(destination, filename).replaceAll('\\', '/'), ...pin })), 'Existing candidate receipt differs from the verified payload.');
  return { status: 'reused-verified', destination, receipt: path.join(destination, READY_RECEIPT), files: verified.verified };
}

async function provisionCandidateRuntime({ root = path.resolve(__dirname, '..'), receiptPath = DEFAULT_RECEIPT,
  payloadDirectory = DEFAULT_PAYLOAD } = {}) {
  assert(path.isAbsolute(root) && path.isAbsolute(receiptPath) && path.isAbsolute(payloadDirectory), 'Provisioning paths must be absolute.');
  root = path.resolve(root); payloadDirectory = path.resolve(payloadDirectory);
  const manifest = await loadCandidateManifest({ root });
  const destination = path.join(root, ...DEVELOPMENT_ROOT.split('/'));
  let existing = false;
  try { await fsp.lstat(destination); existing = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Verify, never repair/replace, an existing versioned destination. A missing
  // file inside it is a failed provision, not permission to start over.
  if (existing) return await verifyReadyDestination(root, destination, manifest);
  const transfer = verifyTransferReceipt(await readBoundedJson(receiptPath), manifest);
  const archive = await verifyPinnedFile(transfer.path, manifest.archive);
  await assertOrdinaryPath(payloadDirectory, 'directory');
  const input = [
    ...manifest.binaries.map(entry => ({ entry, source: path.join(payloadDirectory, ...entry.archivePath.split('/')), relative: `bin/${entry.name}` })),
    ...manifest.notices.map(entry => ({ entry, source: path.join(payloadDirectory, entry.archivePath), relative: `notices/${path.posix.basename(entry.repositoryPath)}` })),
  ];
  for (const item of input) await verifyPinnedFile(item.source, item.entry);
  const plannedBytes = input.reduce((total, item) => total + BigInt(item.entry.sizeBytes), 0n) + 65536n;
  const disk = await fsp.statfs(root, { bigint: true });
  const free = disk.bavail * disk.bsize;
  assert(free - plannedBytes >= MINIMUM_D_FREE_BYTES, 'Candidate provisioning would breach the project 25 GiB free-space floor.');
  const parent = await reserveParentDirectory(root);
  assert.equal(path.dirname(destination), parent);
  // mkdir without recursive is the exclusive version-slot reservation. A
  // racing or interrupted provision cannot make this call overwrite its files.
  await fsp.mkdir(destination);
  await assertOrdinaryPath(destination, 'directory');
  await fsp.mkdir(path.join(destination, 'bin'));
  await fsp.mkdir(path.join(destination, 'notices'));
  const files = [];
  for (const item of input) {
    const target = path.join(destination, ...item.relative.split('/'));
    await assertOrdinaryPath(path.dirname(target), 'directory');
    await fsp.copyFile(item.source, target, fs.constants.COPYFILE_EXCL);
    const { path: ignored, ...verified } = await verifyPinnedFile(target, item.entry);
    files.push({ path: item.relative, ...verified });
  }
  const ready = {
    schemaVersion: 1, completedAtUtc: new Date().toISOString(), release: manifest.release,
    developmentRoot: DEVELOPMENT_ROOT, sourceReceipt: receiptPath, sourcePayload: payloadDirectory,
    archive, files, freeBytesBefore: free.toString(), plannedBytes: plannedBytes.toString(),
    scope: 'Local candidate pair/notices only; no activation, media jobs, network or modification of legacy runtimes.',
  };
  await fsp.writeFile(path.join(destination, READY_RECEIPT), JSON.stringify(ready, null, 2) + '\n', { flag: 'wx' });
  const result = await verifyReadyDestination(root, destination, manifest);
  return { ...result, status: 'provisioned-verified' };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = { '--receipt': 'receiptPath', '--payload': 'payloadDirectory' }[args[index]];
    assert(field && !Object.hasOwn(options, field) && typeof args[index + 1] === 'string' && path.isAbsolute(args[index + 1]), 'Use only --receipt ABSOLUTE_PATH and --payload ABSOLUTE_DIRECTORY; no destination/activation option exists.');
    options[field] = args[index + 1];
  }
  return options;
}

module.exports = { DEFAULT_RECEIPT, DEFAULT_PAYLOAD, READY_RECEIPT, verifyTransferReceipt, parseArguments, provisionCandidateRuntime };
if (require.main === module) provisionCandidateRuntime(parseArguments(process.argv.slice(2)))
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
