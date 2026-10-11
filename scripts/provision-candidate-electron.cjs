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
const { expectedCandidateManifest, resolveCandidateRuntime, verifyPinnedFile, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = expectedCandidateManifest();
  const pin = manifest.electron.archive;
  const installed = path.join(root, 'node_modules/electron');
  const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.version, manifest.electron.version, 'Install the exact candidate npm metadata with scripts disabled first.');
  const space = await fs.statfs(root, { bigint: true });
  assert(space.bavail * space.bsize > 27n * 1024n ** 3n, 'Keep the D: floor plus a bounded extraction margin.');
  const source = path.join('F:/FFmpeg Encoder Project supplied videos/_FFmpeg-0.7-Owned/downloads/runtime-trials', pin.fileName);
  await verifyPinnedFile(source, pin);
  const archive = resolveCandidateRuntime({ root }).electronArchive;
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await assertOrdinaryPath(path.dirname(archive), 'directory');
  try { await fs.copyFile(source, archive, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await verifyPinnedFile(archive, pin);
  const dist = path.join(installed, 'dist');
  // Exclusive creation preserves unknown or partial installs for recovery.
  await fs.mkdir(dist);
  const report = { schema: 1, startedAt: new Date().toISOString(), archive, pin, dist, status: 'extracting' };
  const receipt = path.join(root, '.tools/candidate-runtime/electron-install-receipt.json');
  await fs.writeFile(receipt, JSON.stringify(report, null, 2), { flag: 'wx' });
  try {
    const command = ['x', archive, '-o' + dist, '-aos'];
    const result = await execFile('C:/Program Files/7-Zip/7z.exe', command,
      { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    report.command = command; report.extraction = result.stdout;
    assert.equal((await fs.readFile(path.join(dist, 'version'), 'utf8')).trim(), manifest.electron.version);
    await assertOrdinaryPath(path.join(dist, 'electron.exe'));
    await fs.writeFile(path.join(installed, 'path.txt'), 'electron.exe', { flag: 'wx' });
    await verifyPinnedFile(archive, pin);
    report.status = 'provisioned'; report.finishedAt = new Date().toISOString();
  } catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
  finally { await fs.writeFile(receipt, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ status: report.status, receipt, dist }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
