'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const packageOptions = require('../packaging.config.cjs');
const { appFiles, appDirectories, appSources, readAsarSource } = require('../scripts/build-portable.cjs');

const repository = path.resolve(__dirname, '..');
const parent = path.join(repository, 'artifacts', 'packaging-unit-tests');
const baseFiles = ['main.js', 'preload.js', 'package.json', 'ui/index.html', 'ui/renderer.js', 'ui/styles.css', 'src/example.cjs'].sort();
const iconFiles = [
  'assets/app-icon/LICENSE.txt', 'assets/app-icon/PROVENANCE.md',
  'assets/app-icon/app-icon-256.png', 'assets/app-icon/app-icon.ico', 'assets/app-icon/app-icon.svg',
].sort();
const candidate = { version: '0.7.0-alpha.1', devDependencies: { electron: '44.7.0' } };
const legacy = { version: '0.6.0', devDependencies: { electron: '44.2.0' } };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeLinkUnavailable = error => ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)
  || (process.platform === 'win32' && error.syscall === 'symlink' && error.code === 'UNKNOWN' && error.errno === -4094);

async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  const root = path.join(directory, 'application');
  for (const filename of baseFiles) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await fs.writeFile(path.join(root, filename), filename === 'package.json' ? JSON.stringify(candidate) : `fixture: ${filename}\n`);
  }
  for (const filename of iconFiles) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await fs.copyFile(path.join(repository, filename), path.join(root, filename));
  }
  return { root, buildRoot: path.join(root, 'out', 'portable-fixture') };
}

test('candidate embeds the exact ICO and allows only its five declared artwork files and parent directories', async t => {
  const { root, buildRoot } = await fixture(t);
  const options = packageOptions(root, buildRoot, candidate);
  assert.equal(options.icon, path.join(root, 'assets', 'app-icon', 'app-icon.ico'));
  assert.equal(options.electronVersion, '44.7.0');
  assert.equal(options.overwrite, false);
  assert.equal(options.derefSymlinks, false);
  assert.deepEqual(appFiles(root, candidate), [...baseFiles, ...iconFiles].sort());
  assert.deepEqual(appDirectories(candidate), ['assets', 'assets/app-icon', 'src', 'ui']);
  for (const filename of ['', ...baseFiles, ...iconFiles, 'assets', 'assets/app-icon', 'src', 'ui']) {
    assert.equal(options.ignore(filename), false, filename);
    assert.equal(options.ignore(`/${filename.replaceAll('/', '\\')}`), false, filename);
  }
});

test('candidate refuses review artifacts, extra artwork, executable helpers and private Planning from the package allowlist', async t => {
  const { root, buildRoot } = await fixture(t);
  const options = packageOptions(root, buildRoot, candidate);
  for (const filename of ['assets/other.svg', 'assets/app-icon/app-icon-16.png', 'assets/app-icon/app-icon-16.svg',
    'assets/app-icon/manifest.json', 'assets/app-icon/review-sheet.png', 'assets/app-icon/unreviewed.ico',
    'assets/app-icon/nested', 'assets/app-icon/nested/app-icon.ico', 'scripts/generate-app-icon.cjs',
    '0- Documentation', '0- Documentation/Planning', '0- Documentation/Planning/0.7/private.md',
    'out', 'artifacts', 'node_modules', 'media.mkv', '.git', 'data']) {
    assert.equal(options.ignore(filename), true, filename);
    assert.equal(options.ignore(`/${filename.replaceAll('/', '\\')}`), true, filename);
  }
});

test('legacy packaging keeps its original file/directories inventory and has no executable icon option', async t => {
  const { root, buildRoot } = await fixture(t);
  const options = packageOptions(root, buildRoot, legacy);
  assert.equal(Object.hasOwn(options, 'icon'), false);
  assert.equal(options.electronVersion, '44.2.0');
  assert.deepEqual(appFiles(root, legacy), baseFiles);
  assert.deepEqual(appDirectories(legacy), ['src', 'ui']);
  for (const filename of ['assets', 'assets/app-icon', ...iconFiles]) assert.equal(options.ignore(filename), true);
  await fs.rename(path.join(root, 'assets'), path.join(root, 'assets-not-selected'));
  assert.deepEqual(appFiles(root, legacy), baseFiles, 'Legacy packaging does not require new candidate artwork.');
});

test('candidate missing artwork fails before a silent Electron icon fallback', async t => {
  const { root, buildRoot } = await fixture(t);
  await fs.unlink(path.join(root, 'assets/app-icon/app-icon.ico'));
  assert.throws(() => packageOptions(root, buildRoot, candidate), { code: 'ENOENT' });
});

test('candidate refuses a non-file artwork entry and a non-directory artwork parent', async t => {
  const { root, buildRoot } = await fixture(t);
  const icon = path.join(root, 'assets/app-icon/app-icon.ico');
  await fs.unlink(icon);
  await fs.mkdir(icon);
  assert.throws(() => packageOptions(root, buildRoot, candidate), /Icon asset must be a regular file/);
  await fs.rename(path.join(root, 'assets/app-icon'), path.join(root, 'assets/saved-app-icon'));
  await fs.writeFile(path.join(root, 'assets/app-icon'), 'not a directory');
  assert.throws(() => packageOptions(root, buildRoot, candidate), /Icon parent must be an ordinary directory/);
});

test('candidate refuses an actual symbolic-link artwork entry without reading its target', async t => {
  const { root, buildRoot } = await fixture(t);
  const icon = path.join(root, 'assets/app-icon/app-icon.ico');
  const target = path.join(path.dirname(root), 'linked-icon-target.ico');
  assert.equal(path.dirname(target), path.dirname(root), 'the link target must remain inside this owned fixture');
  await fs.copyFile(icon, target); await fs.unlink(icon);
  try { await fs.symlink(target, icon, 'file'); }
  catch (error) {
    if (nativeLinkUnavailable(error)) {
      t.skip(`Host rejected native file symlink creation (${error.code}, errno ${error.errno}); no privilege or machine setting changed.`);
      return;
    }
    throw error;
  }
  assert.equal((await fs.lstat(icon)).isSymbolicLink(), true);
  const before = await fs.readFile(target);
  assert.throws(() => appFiles(root, candidate), /Icon asset must be a regular file/);
  assert.throws(() => packageOptions(root, buildRoot, candidate), /Icon asset must be a regular file/);
  assert.deepEqual(await fs.readFile(target), before);
});

for (const parentName of ['assets', 'assets/app-icon']) {
  test(`candidate refuses an actual junction at the ${parentName} parent`, async t => {
    const { root, buildRoot } = await fixture(t);
    const original = path.join(root, parentName);
    const target = path.join(path.dirname(root), 'linked-parent-target');
    assert.equal(path.dirname(target), path.dirname(root), 'the junction target must remain inside this owned fixture');
    assert.ok(original.startsWith(root + path.sep));
    await fs.rename(original, target);
    try { await fs.symlink(target, original, 'junction'); }
    catch (error) {
      if (nativeLinkUnavailable(error)) {
        t.skip(`Host rejected native directory junction creation (${error.code}, errno ${error.errno}); no privilege or machine setting changed.`);
        return;
      }
      throw error;
    }
    assert.equal((await fs.lstat(original)).isSymbolicLink(), true);
    const targetIcon = path.join(target, parentName === 'assets' ? 'app-icon/app-icon.ico' : 'app-icon.ico');
    const before = await fs.readFile(targetIcon);
    assert.throws(() => appFiles(root, candidate), /Icon parent must be an ordinary directory/);
    assert.throws(() => packageOptions(root, buildRoot, candidate), /Icon parent must be an ordinary directory/);
    assert.deepEqual(await fs.readFile(targetIcon), before);
    assert.deepEqual(appFiles(root, legacy), baseFiles, 'legacy packaging does not inspect candidate-only parents');
  });
}

for (const filename of ['assets', 'assets/app-icon', 'assets/app-icon/app-icon.ico']) {
  test(`a simulated symbolic-link observation refuses ${filename} without dereferencing it`, async t => {
    const { root, buildRoot } = await fixture(t), target = path.join(root, filename);
    const lstat = syncFs.lstatSync.bind(syncFs);
    // Native link fixtures remain separately reported. This deterministic
    // observation exercises the refusal branch without claiming native QA.
    t.mock.method(syncFs, 'lstatSync', (file, ...args) => {
      const stat = lstat(file, ...args);
      if (file === target) stat.isSymbolicLink = () => true;
      return stat;
    });
    assert.throws(() => packageOptions(root, buildRoot, candidate),
      filename.endsWith('.ico') ? /Icon asset must be a regular file/ : /Icon parent must be an ordinary directory/);
  });
}

test('build source receipts hash every selected icon asset and retain the legacy source inventory', async t => {
  const { root } = await fixture(t);
  const sources = await appSources(root, candidate);
  assert.deepEqual(sources.map(source => source.path), [...baseFiles, ...iconFiles].sort());
  for (const filename of iconFiles) {
    const original = await fs.readFile(path.join(repository, filename));
    assert.deepEqual(sources.find(source => source.path === filename), {
      path: filename, sizeBytes: original.length, sha256: digest(original),
    });
  }
  assert.deepEqual((await appSources(root, legacy)).map(source => source.path), baseFiles);
});

test('filtered source staging and an actual ASAR retain exact icon hashes and exclude planted private/unrelated files', async t => {
  const { root, buildRoot } = await fixture(t);
  for (const filename of ['assets/app-icon/review-sheet.png', 'assets/app-icon/unreviewed.ico',
    'assets/unrelated.txt', '0- Documentation/Planning/private.md', 'artifacts/private.json']) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await fs.writeFile(path.join(root, filename), 'must not enter the archive');
  }
  const options = packageOptions(root, buildRoot, candidate);
  const sources = await appSources(root, candidate);
  const staged = path.join(root, '..', 'filtered-staging');
  await fs.cp(root, staged, {
    recursive: true,
    filter: filename => !options.ignore(path.relative(root, filename).replaceAll('\\', '/')),
  });
  const packagerRequire = createRequire(require.resolve('@electron/packager'));
  const asar = await import(pathToFileURL(packagerRequire.resolve('@electron/asar')).href);
  const archive = path.join(root, '..', 'fixture.asar');
  await asar.createPackage(staged, archive);
  assert.deepEqual(asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')).sort(),
    [...baseFiles, ...iconFiles, 'assets', 'assets/app-icon', 'src', 'ui'].sort());
  for (const source of sources) {
    assert.equal(digest(readAsarSource(asar, archive, source.path)), source.sha256);
  }
});

test('production ASAR readback supplies host-native lookup paths while preserving canonical receipt names', () => {
  const calls = [], content = Buffer.from('exact source bytes'), archive = 'fixture.asar';
  const lookup = path.join('assets', 'app-icon', 'app-icon.ico');
  const asar = {
    statFile(...args) { calls.push(['stat', ...args]); return {}; },
    extractFile(...args) { calls.push(['extract', ...args]); return content; },
  };
  assert.equal(readAsarSource(asar, archive, 'assets/app-icon/app-icon.ico'), content);
  assert.deepEqual(calls, [['stat', archive, lookup, false], ['extract', archive, lookup, false]]);
});

test('production ASAR readback refuses linked or unpacked entries before extracting bytes', () => {
  for (const info of [{ link: 'elsewhere' }, { unpacked: true }]) {
    assert.throws(() => readAsarSource({ statFile: () => info,
      extractFile() { assert.fail('unsafe ASAR entries must never be extracted'); } }, 'fixture.asar', 'assets/app-icon/app-icon.ico'),
    /ASAR contains a link or unpacked file: assets\/app-icon\/app-icon.ico/);
  }
});

test('packaging still rejects output destinations outside a fresh portable build root', async t => {
  const { root } = await fixture(t);
  for (const destination of [path.join(root, 'out'), path.join(root, 'out', 'accepted'), path.join(root, 'elsewhere', 'portable-fixture')]) {
    assert.throws(() => packageOptions(root, destination, candidate), /reserve a fresh local directory/);
  }
});
