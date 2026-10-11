'use strict';

// Provision only the already pinned, locally downloaded Electron archive. npm
// metadata is installed separately with --ignore-scripts, so this step never
// fetches a second executable or silently replaces an existing distribution.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { expectedCandidateManifest, resolveCandidateRuntime, verifyPinnedFile, assertOrdinaryPath, readBoundedJson } = require('../src/candidate-runtime.cjs');

// Check the existing parent before every additive reservation. A recursive mkdir
// could otherwise follow an existing redirected ancestor before a later guard
// rejects it. Unknown and incomplete entries are preserved, never repaired.
async function reserveDirectory(parent, name, { reuse = false, io = fs, assertPath = assertOrdinaryPath } = {}) {
  assert(typeof name === 'string' && name && name !== '.' && name !== '..' && !/[\\/\0]/.test(name), 'Expected one directory component.');
  await assertPath(parent, 'directory');
  const destination = path.join(parent, name);
  try { await io.mkdir(destination); }
  catch (error) { if (!reuse || error.code !== 'EEXIST') throw error; }
  await assertPath(destination, 'directory');
  return destination;
}

async function reserveDirectoryChain(root, components, options = {}) {
  assert(Array.isArray(components) && components.length > 0 && components.length <= 8, 'Expected a bounded directory chain.');
  let current = root;
  for (const name of components) current = await reserveDirectory(current, name, { ...options, reuse: true });
  return current;
}

async function requireAbsent(filename, io = fs) {
  try { await io.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Preserve existing provision state for explicit recovery: ' + filename);
}

const stamp = stat => Object.fromEntries(['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
  .map(field => [field, String(stat[field])]));

// The receipt is created once with wx and updated through that retained handle.
// Check its pathname and complete stamps before/after each write, so a replaced,
// linked or externally edited receipt never becomes a writable recovery target.
// This detects ordinary filesystem races; it is not an atomic path lock against
// a malicious same-user ancestor swap between checks and filesystem dispatch.
async function openProvisionReceipt(filename, initial, { io = fs, assertPath = assertOrdinaryPath } = {}) {
  await assertPath(path.dirname(filename), 'directory');
  const handle = await io.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  let previous, closed = false;
  async function observe() {
    await assertPath(filename);
    const actual = await handle.stat({ bigint: true });
    assert(actual.isFile() && actual.nlink === 1n, 'Provision receipt must remain an ordinary single-link file.');
    const pathname = await io.lstat(filename, { bigint: true });
    assert(pathname.isFile() && !pathname.isSymbolicLink(), 'Provision receipt path is no longer an ordinary file.');
    assert.deepEqual(stamp(pathname), stamp(actual), 'Provision receipt path no longer belongs to the retained handle.');
    return stamp(actual);
  }
  async function update(report) {
    assert(!closed, 'Provision receipt is closed.');
    const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    assert(bytes.length <= 1024 * 1024, 'Provision receipt exceeds its bounded size.');
    const before = await observe();
    if (previous) assert.deepEqual(before, previous, 'Provision receipt changed outside this provisioner.');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      assert(bytesWritten > 0, 'Provision receipt write made no progress.');
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
    previous = await observe();
  }
  async function close() { if (!closed) { closed = true; await handle.close(); } }
  try { previous = await observe(); await update(initial); }
  catch (error) { await close(); throw error; }
  return Object.freeze({ update, close });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = expectedCandidateManifest();
  const pin = manifest.electron.archive;
  const installed = path.join(root, 'node_modules/electron');
  await assertOrdinaryPath(installed, 'directory');
  const metadata = await readBoundedJson(path.join(installed, 'package.json'));
  assert.equal(metadata.version, manifest.electron.version, 'Install the exact candidate npm metadata with scripts disabled first.');
  const dist = path.join(installed, 'dist');
  const receipt = path.join(root, '.tools/candidate-runtime/electron-install-receipt.json');
  const installedPath = path.join(installed, 'path.txt');
  // Fail before reservations if a previous install or unknown receipt exists.
  // Successful installations stay valid; this command has no re-extract mode.
  for (const filename of [dist, receipt, installedPath]) await requireAbsent(filename);
  const space = await fs.statfs(root, { bigint: true });
  assert(space.bavail * space.bsize > 27n * 1024n ** 3n, 'Keep the D: floor plus a bounded extraction margin.');
  const source = path.join('F:/FFmpeg Encoder Project supplied videos/_FFmpeg-0.7-Owned/downloads/runtime-trials', pin.fileName);
  await verifyPinnedFile(source, pin);
  const archive = resolveCandidateRuntime({ root }).electronArchive;
  await reserveDirectoryChain(root, ['.tools', 'candidate-runtime', 'electron-44.7.0-zip']);
  try { await fs.copyFile(source, archive, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await verifyPinnedFile(archive, pin);
  // Exclusive creation preserves unknown or partial installs for recovery.
  await reserveDirectory(installed, 'dist');
  const report = { schema: 1, startedAt: new Date().toISOString(), archive, pin, dist, status: 'extracting' };
  const ownedReceipt = await openProvisionReceipt(receipt, report);
  try {
    await assertOrdinaryPath(dist, 'directory');
    const command = ['x', archive, '-o' + dist, '-aos'];
    const result = await execFile('C:/Program Files/7-Zip/7z.exe', command,
      { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    report.command = command; report.extraction = result.stdout;
    await assertOrdinaryPath(path.join(dist, 'version'));
    assert.equal((await fs.readFile(path.join(dist, 'version'), 'utf8')).trim(), manifest.electron.version);
    await assertOrdinaryPath(path.join(dist, 'electron.exe'));
    await assertOrdinaryPath(installed, 'directory');
    await fs.writeFile(installedPath, 'electron.exe', { flag: 'wx' });
    await verifyPinnedFile(archive, pin);
    report.status = 'provisioned'; report.finishedAt = new Date().toISOString();
  } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally { try { await ownedReceipt.update(report); } finally { await ownedReceipt.close(); } }
  console.log(JSON.stringify({ status: report.status, receipt, dist }));
}
module.exports = { reserveDirectory, reserveDirectoryChain, requireAbsent, openProvisionReceipt };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
