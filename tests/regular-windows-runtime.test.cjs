'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { loadRegularWindowsManifest, verifyRegularWindowsRuntime, REGULAR_WINDOWS_PAIR, MANIFEST_NAME } =
  require('../src/regular-windows-runtime.cjs');

const root = path.resolve(__dirname, '..');

test('the fixed Windows manifest binds the ordered build, matching source and dependency notices', async () => {
  const { manifest } = await loadRegularWindowsManifest({ root });
  assert.equal(manifest.enginePair, REGULAR_WINDOWS_PAIR);
  assert.deepEqual(manifest.binaries.map(pin => pin.name), ['ffmpeg.exe', 'ffprobe.exe']);
  assert.equal(manifest.release, '9.1');
  assert.equal(manifest.notices.length, 24);
  assert.equal(manifest.notices.filter(pin => pin.sourceGroup === 'toolchain').length, 2);
  assert.match(manifest.correspondingSource.sha256, /^[0-9a-f]{64}$/);
});

test('a changed manifest, loose DLL or unprovisioned pair fails before any launch', async () => {
  const parent = path.join(root, 'artifacts', 'regular-windows-runtime-unit-tests');
  await fs.mkdir(parent, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(parent, 'runtime-'));
  const files = [], directories = [temporary];
  const reserve = async (parent, name) => {
    const directory = path.join(parent, name);
    await fs.mkdir(directory);
    directories.push(directory);
    return directory;
  };
  const write = async (directory, name, content) => {
    const file = path.join(directory, name);
    await fs.writeFile(file, content, { flag: 'wx' });
    files.push(file);
    return file;
  };
  try {
    const resourceDir = await reserve(temporary, 'resources');
    const manifestFile = await fs.readFile(path.join(root, 'resources', MANIFEST_NAME));
    const options = { root: temporary, resourcesPath: resourceDir, isPackaged: true };
    const altered = await write(resourceDir, 'binary-manifest.json', Buffer.concat([manifestFile, Buffer.from(' ')]));
    await assert.rejects(verifyRegularWindowsRuntime(options), /Runtime manifest SHA-256 mismatch/);
    await fs.unlink(altered);
    files.pop();
    await write(resourceDir, 'binary-manifest.json', manifestFile);
    await assert.rejects(verifyRegularWindowsRuntime(options), { code: 'ENOENT' });
    const tools = await reserve(resourceDir, 'ffmpeg');
    await write(tools, 'ffmpeg.exe', '');
    await write(tools, 'ffprobe.exe', '');
    await assert.rejects(verifyRegularWindowsRuntime(options), /Runtime size mismatch/);
    await write(tools, 'unapproved.dll', '');
    await assert.rejects(verifyRegularWindowsRuntime(options), /Unexpected entry/);
  } finally {
    for (const file of files.reverse()) await fs.unlink(file);
    for (const directory of directories.reverse()) await fs.rmdir(directory);
  }
});
