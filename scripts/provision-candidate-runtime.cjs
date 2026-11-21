'use strict';

// Local-only provisioning of the qualified source-built candidate pair and its
// notices from two folders the caller names: the build output that holds
// ffmpeg.exe/ffprobe.exe and the folder that holds the generated notices.
// There is no download, child process, shell, root ffmpeg activation or
// overwrite mode. Every source is checked against the fixed manifest pins
// before anything is created. A failed/partial destination is preserved for
// explicit review, never deleted, repaired or replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DEVELOPMENT_ROOT, MINIMUM_D_FREE_BYTES, loadCandidateManifest, readBoundedJson,
  assertOrdinaryPath, verifyPinnedFile, verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');

const READY_RECEIPT = 'provision-receipt.json';
const READY_FIELDS = Object.freeze(['schemaVersion', 'completedAtUtc', 'release', 'version', 'developmentRoot',
  'upstreamCommit', 'qualification', 'sources', 'files', 'freeBytesBefore', 'plannedBytes', 'scope'].sort());
const noticeName = entry => path.posix.basename(entry.repositoryPath);
// Fixed receipt values shared by the writer and the reuse check, so a reused
// slot's receipt can carry only these manifest-derived relative identifiers.
const RECEIPT_SCOPE = 'Local candidate pair/notices only; no activation, media jobs, network or modification of legacy runtimes.';
const receiptSources = manifest => ({ binaries: manifest.binaries.map(entry => entry.buildOutputPath), notices: manifest.notices.map(noticeName) });
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Source files are named only by the fixed manifest: a binary by its pinned
// name (the basename of its build output path), a notice by its pinned
// repository basename. Nothing in either folder chooses what is copied.
function plannedInputs(manifest, binariesDirectory, noticesDirectory) {
  return [
    ...manifest.binaries.map(entry => {
      assert.equal(path.posix.basename(entry.buildOutputPath), entry.name, 'Build output path differs from the pinned binary name.');
      return { entry, source: path.join(binariesDirectory, entry.name), relative: `bin/${entry.name}` };
    }),
    ...manifest.notices.map(entry => ({ entry, source: path.join(noticesDirectory, noticeName(entry)), relative: `notices/${noticeName(entry)}` })),
  ];
}

async function verifySourceFolders({ binariesDirectory, noticesDirectory }, manifest) {
  await assertOrdinaryPath(binariesDirectory, 'directory');
  await assertOrdinaryPath(noticesDirectory, 'directory');
  const input = plannedInputs(manifest, binariesDirectory, noticesDirectory);
  // Exact size and SHA-256 through the retained handle, before any write.
  for (const item of input) await verifyPinnedFile(item.source, item.entry);
  return input;
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
  assert.deepEqual((await fsp.readdir(path.join(destination, 'bin'))).sort(), manifest.binaries.map(entry => entry.name).sort(), 'Candidate bin folder differs from the pinned pair.');
  assert.deepEqual((await fsp.readdir(path.join(destination, 'notices'))).sort(), manifest.notices.map(noticeName).sort(), 'Candidate notices folder differs from the pinned notice set.');
  const ready = await readBoundedJson(path.join(destination, READY_RECEIPT));
  assert(ready && typeof ready === 'object' && !Array.isArray(ready), 'Existing provision receipt is not an object.');
  assert.deepEqual(Object.keys(ready).sort(), READY_FIELDS, 'Existing provision receipt fields differ.');
  assert.equal(ready.schemaVersion, 2, 'Existing provision receipt schema differs.');
  assert.equal(ready.release, manifest.release, 'Existing provision receipt release differs.');
  assert.equal(ready.version, manifest.version, 'Existing provision receipt version differs.');
  assert.equal(ready.developmentRoot, DEVELOPMENT_ROOT, 'Existing provision receipt development root differs.');
  assert.equal(ready.upstreamCommit, manifest.sourceBuild.upstream.commit, 'Existing provision receipt upstream commit differs.');
  assert.equal(ready.qualification, manifest.sourceBuild.qualification, 'Existing provision receipt qualification differs.');
  assert.deepEqual(ready.sources, receiptSources(manifest), 'Existing provision receipt sources differ from the manifest-derived relative paths.');
  assert.equal(ready.scope, RECEIPT_SCOPE, 'Existing provision receipt scope differs.');
  assert(typeof ready.completedAtUtc === 'string' && ISO_UTC.test(ready.completedAtUtc)
    && Number.isFinite(Date.parse(ready.completedAtUtc)) && new Date(ready.completedAtUtc).toISOString() === ready.completedAtUtc, 'Existing provision receipt completion time is not an ISO-8601 UTC timestamp.');
  for (const field of ['freeBytesBefore', 'plannedBytes']) {
    assert(typeof ready[field] === 'string' && /^(?:0|[1-9]\d{0,30})$/.test(ready[field]), `Existing provision receipt ${field} is not a decimal byte count.`);
  }
  const verified = await verifyCandidateRuntime({ root });
  assert.deepEqual(ready.files, verified.verified.map(({ path: filename, ...pin }) => ({ path: path.relative(destination, filename).replaceAll('\\', '/'), ...pin })), 'Existing candidate receipt differs from the verified payload.');
  return { status: 'reused-verified', destination, receipt: path.join(destination, READY_RECEIPT), files: verified.verified };
}

async function provisionCandidateRuntime({ root = path.resolve(__dirname, '..'), binariesDirectory, noticesDirectory } = {}) {
  for (const value of [root, binariesDirectory, noticesDirectory]) {
    assert(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'), 'Provisioning root, --binaries and --notices must be absolute paths.');
  }
  root = path.resolve(root); binariesDirectory = path.resolve(binariesDirectory); noticesDirectory = path.resolve(noticesDirectory);
  const manifest = await loadCandidateManifest({ root });
  const destination = path.join(root, ...DEVELOPMENT_ROOT.split('/'));
  let existing = false;
  try { await fsp.lstat(destination); existing = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Verify, never repair/replace, an existing versioned destination. A missing
  // file inside it is a failed provision, not permission to start over.
  if (existing) return await verifyReadyDestination(root, destination, manifest);
  const input = await verifySourceFolders({ binariesDirectory, noticesDirectory }, manifest);
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
    // The copy, not the source, is what the pin must describe.
    const { path: ignored, ...verified } = await verifyPinnedFile(target, item.entry);
    files.push({ path: item.relative, ...verified });
  }
  // Relative, non-private identifiers only: the receipt names no source folder.
  const ready = {
    schemaVersion: 2, completedAtUtc: new Date().toISOString(), release: manifest.release, version: manifest.version,
    developmentRoot: DEVELOPMENT_ROOT, upstreamCommit: manifest.sourceBuild.upstream.commit,
    qualification: manifest.sourceBuild.qualification,
    sources: receiptSources(manifest),
    files, freeBytesBefore: free.toString(), plannedBytes: plannedBytes.toString(),
    scope: RECEIPT_SCOPE,
  };
  await fsp.writeFile(path.join(destination, READY_RECEIPT), JSON.stringify(ready, null, 2) + '\n', { flag: 'wx' });
  const result = await verifyReadyDestination(root, destination, manifest);
  return { ...result, status: 'provisioned-verified' };
}

function parseArguments(args) {
  assert(Array.isArray(args) && args.length === 4, 'Use exactly --binaries ABSOLUTE_DIRECTORY --notices ABSOLUTE_DIRECTORY; no destination/activation option exists.');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = { '--binaries': 'binariesDirectory', '--notices': 'noticesDirectory' }[args[index]];
    assert(field && !Object.hasOwn(options, field) && typeof args[index + 1] === 'string' && path.isAbsolute(args[index + 1]), 'Use exactly --binaries ABSOLUTE_DIRECTORY --notices ABSOLUTE_DIRECTORY; no destination/activation option exists.');
    options[field] = args[index + 1];
  }
  return options;
}

module.exports = { READY_RECEIPT, RECEIPT_SCOPE, receiptSources, parseArguments, verifySourceFolders, provisionCandidateRuntime };
if (require.main === module) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  if (options) provisionCandidateRuntime(options)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
}
