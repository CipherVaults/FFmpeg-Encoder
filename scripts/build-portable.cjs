'use strict';

// Builds an unsigned local ZIP only. It never launches Electron or publishes.
// Each attempt retains its own output and report; there is no cleanup/replacement
// of earlier artifacts. Runtime/offline acceptance is a separate explicit step.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

function appFiles(root) {
  const modules = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.cjs'))
    .map(entry => {
      assert(entry.isFile(), `Source module must be a regular file: ${entry.name}`);
      return `src/${entry.name}`;
    });
  return ['main.js', 'preload.js', 'package.json', 'ui/index.html', 'ui/renderer.js', 'ui/styles.css', ...modules].sort();
}

async function hashFile(file) {
  const stat = await fsp.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return { sizeBytes: stat.size, sha256: hash.digest('hex') };
}

async function walkFiles(directory, relative = '') {
  const results = [];
  for (const entry of await fsp.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) results.push(...await walkFiles(directory, child));
    else {
      assert(entry.isFile(), `Unexpected link or non-regular packaged entry: ${child}`);
      results.push(child);
    }
  }
  return results.sort();
}

async function stageFile(root, staged, source, destination, expected = {}) {
  const before = await hashFile(path.join(root, source));
  if (expected.sha256) assert.equal(before.sha256, expected.sha256.toLowerCase(), `Source SHA-256 mismatch: ${source}`);
  if (expected.sizeBytes !== undefined) assert.equal(before.sizeBytes, expected.sizeBytes, `Source size mismatch: ${source}`);
  const target = path.join(staged, destination);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(path.join(root, source), target, fs.constants.COPYFILE_EXCL);
  assert.deepEqual(await hashFile(target), before, `Staged resource differs: ${source}`);
  return { source, path: destination, ...before };
}

async function runPackaging(root, buildRoot, packageJson) {
  const { packager } = await import('@electron/packager');
  const options = require('../packaging.config.cjs')(root, buildRoot, packageJson);
  const packages = await packager(options);
  assert.deepEqual(packages, [path.join(buildRoot, 'package', 'FFmpeg Encoder-win32-x64')]);
  const zipDirectory = path.join(buildRoot, 'zip');
  await fsp.mkdir(zipDirectory);
  const zip = path.join(zipDirectory, 'FFmpeg-Encoder-' + packageJson.version + '-win32-x64.zip');
  const executable = 'C:\\Program Files\\7-Zip\\7z.exe';
  const args = ['a', '-tzip', '-mx=5', '-mmt=on', zip, '.'];
  await new Promise((resolve, reject) => execFile(executable, args, { cwd: packages[0], windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 }, async (error, stdout, stderr) => {
    try { await fsp.writeFile(path.join(buildRoot, 'zip-build.log'), stdout + stderr, {flag:'wx'}); }
    catch (writeError) { reject(writeError); return; }
    if(error) reject(error); else resolve();
  }));
  return { packager: '@electron/packager', executable, args };
}

async function main() {
  assert.equal(process.platform, 'win32', 'The local portable build targets Windows x64.');
  const root = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.version, /^0\.5\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Expected the approved 0.5.x version sequence.');
  assert.equal(packageJson.main, 'main.js');
  const versions = {};
  for (const [name, required] of Object.entries({ electron: '44.2.0', '@electron/packager': '20.3.0' })) {
    assert.equal(packageJson.devDependencies?.[name], required, `${name} must be exactly pinned before building.`);
    versions[name] = JSON.parse(await fsp.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    assert.equal(versions[name], required, `Installed ${name} differs from its pin.`);
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'resources', 'binary-manifest.json'), 'utf8'));
  assert.equal(manifest.platform, 'win32-x64');
  assert.deepEqual(manifest.binaries.map(entry => entry.name).sort(), ['ffmpeg.exe', 'ffprobe.exe']);
  assert.deepEqual(manifest.notices.map(entry => entry.repositoryPath).sort(), [
    'resources/third-party/FFmpeg-LICENSE.txt', 'resources/third-party/FFmpeg-README.txt',
  ]);
  const sources = [];
  for (const name of appFiles(root)) sources.push({ path: name, ...await hashFile(path.join(root, name)) });
  const out = path.join(root, 'out');
  await fsp.mkdir(out, { recursive: true });
  assert(!(await fsp.lstat(out)).isSymbolicLink(), 'The project output directory must not be a link.');
  assert.equal(await fsp.realpath(out), path.join(await fsp.realpath(root), 'out'));
  const buildRoot = await fsp.mkdtemp(path.join(out, `portable-${new Date().toISOString().replace(/[:.]/g, '-')}-`));
  console.log(`Fresh local build: ${buildRoot}`);
  const report = {
    schemaVersion: 1, startedAtUtc: new Date().toISOString(), status: 'building', buildRoot,
    product: 'FFmpeg Encoder', version: packageJson.version, platform: 'win32', arch: 'x64',
    tools: versions, sources, resources: [],
    acceptance: { extractedApp: 'not-run', offline: 'not-run', realEncodeCancelSkip: 'not-run', cleanMachine: 'not-run' },
    distribution: 'Unsigned local ZIP only; no publication or complete corresponding-source claim.',
  };
  try {
    report.git = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    };
    const staged = path.join(buildRoot, 'staged-resources');
    for (const entry of manifest.binaries) {
      assert.equal(entry.runtimePath, `ffmpeg/${entry.name}`);
      assert.match(entry.sha256, /^[a-f0-9]{64}$/i);
      report.resources.push(await stageFile(root, staged, entry.runtimePath, entry.runtimePath, entry));
    }
    for (const entry of manifest.notices) {
      assert.match(entry.sha256, /^[a-f0-9]{64}$/i);
      report.resources.push(await stageFile(root, staged, entry.repositoryPath, entry.repositoryPath.slice('resources/'.length), entry));
    }
    for (const name of ['binary-manifest.json', 'PORTABLE_README.txt']) {
      report.resources.push(await stageFile(root, staged, `resources/${name}`, name));
    }
    report.electronNotices = [];
    for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
      report.electronNotices.push({ path: name, ...await hashFile(path.join(root, 'node_modules', 'electron', 'dist', name)) });
    }
    report.command = await runPackaging(root, buildRoot, packageJson);
    report.electronExtraction = JSON.parse(await fsp.readFile(path.join(buildRoot, 'electron-extraction.json'), 'utf8'));
    assert.equal(report.electronExtraction.electronVersion, versions.electron);

    const packageDir = path.join(buildRoot, 'package', 'FFmpeg Encoder-win32-x64');
    const archive = path.join(packageDir, 'resources', 'app.asar');
    // Resolve ASAR through Packager's own dependencies, including nested npm
    // layouts, instead of relying on a global CLI or top-level hoisting.
    const packagerRequire = createRequire(require.resolve('@electron/packager'));
    const importedAsar = await import(pathToFileURL(packagerRequire.resolve('@electron/asar')).href);
    const asar = importedAsar.default || importedAsar;
    const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')).sort();
    assert.deepEqual(entries, [...sources.map(entry => entry.path), 'src', 'ui'].sort(), 'ASAR inventory differs from the exact application allowlist.');
    report.asar = { ...await hashFile(archive), entries, files: [] };
    for (const source of sources) {
      const info = asar.statFile(archive, source.path, false);
      assert(!info.link && !info.unpacked, `ASAR contains a link or unpacked file: ${source.path}`);
      const content = asar.extractFile(archive, source.path, false);
      const sha256 = createHash('sha256').update(content).digest('hex');
      if (source.path === 'package.json') {
        // Packager removes development dependencies and scripts from the
        // runtime manifest. Require exactly that documented sanitization while
        // retaining both source and archive hashes in the build evidence.
        const expected = structuredClone(packageJson);
        delete expected.devDependencies;
        delete expected.scripts;
        if (expected.config) delete expected.config.forge;
        assert.deepEqual(JSON.parse(content.toString('utf8')), expected, 'Bundled package metadata/version differs.');
      } else assert.equal(sha256, source.sha256, `Bundled source differs: ${source.path}`);
      report.asar.files.push({ path: source.path, sizeBytes: content.length, sha256 });
      assert.deepEqual(await hashFile(path.join(root, source.path)), { sizeBytes: source.sizeBytes, sha256: source.sha256 }, `Source changed during build: ${source.path}`);
    }
    const expectedResources = ['app.asar', ...report.resources.map(entry => entry.path)].sort();
    assert.deepEqual(await walkFiles(path.join(packageDir, 'resources')), expectedResources, 'Unexpected packaged resources or loose application files.');
    for (const entry of report.resources) {
      assert.deepEqual(await hashFile(path.join(packageDir, 'resources', entry.path)), { sizeBytes: entry.sizeBytes, sha256: entry.sha256 }, `Bundled resource differs: ${entry.path}`);
    }
    for (const entry of report.electronNotices) {
      assert.deepEqual(await hashFile(path.join(packageDir, entry.path)), { sizeBytes: entry.sizeBytes, sha256: entry.sha256 }, `Electron notice differs: ${entry.path}`);
    }
    const packageInventory = await walkFiles(packageDir);
    assert(!packageInventory.some(name => name.startsWith('data/')), 'A fresh package must not contain prior user data.');
    assert(!packageInventory.includes('electron.exe'), 'Executable was not renamed.');
    report.executable = { path: path.join(packageDir, 'FFmpeg Encoder.exe'), ...await hashFile(path.join(packageDir, 'FFmpeg Encoder.exe')) };
    report.packageDir = packageDir;
    report.packageInventory = packageInventory;
    const zips = (await walkFiles(path.join(buildRoot, 'zip'))).filter(name => name.toLowerCase().endsWith('.zip'));
    assert.equal(zips.length, 1, 'Expected exactly one portable ZIP.');
    const zip = path.join(buildRoot, 'zip', zips[0]);
    const handle = await fsp.open(zip, 'r');
    try {
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, 4, 0);
      assert.equal(signature.toString('hex'), '504b0304', 'Artifact does not begin with a ZIP local-file header.');
    } finally { await handle.close(); }
    report.zip = { path: zip, ...await hashFile(zip) };
    report.status = 'build-verified-runtime-acceptance-pending';
    report.completedAtUtc = new Date().toISOString();
    await fsp.writeFile(path.join(buildRoot, 'build-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, zip: report.zip, report: path.join(buildRoot, 'build-report.json') }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || String(error);
    report.completedAtUtc = new Date().toISOString();
    await fsp.writeFile(path.join(buildRoot, 'failed-build-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
    throw error;
  }
}

module.exports = { appFiles, hashFile };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
