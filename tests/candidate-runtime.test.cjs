'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DEVELOPMENT_ROOT, MINIMUM_D_FREE_BYTES, expectedCandidateManifest, validateCandidateManifest,
  resolveCandidateRuntime, loadCandidateManifest, verifyCandidateRuntime, readBoundedJson,
  verifyPinnedFile, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { READY_RECEIPT, RECEIPT_SCOPE, receiptSources, parseArguments, verifySourceFolders, provisionCandidateRuntime } = require('../scripts/provision-candidate-runtime.cjs');
const { selectPortableRuntime, assertCandidateNotices, assertCandidateReadme, candidateDistribution,
  CANDIDATE_README } = require('../scripts/build-portable.cjs');

// Fixtures live under the native (long-name) temporary directory so the
// ordinary-path guard's realpath comparison sees the same spelling.
const parent = path.join(fs.realpathSync.native(os.tmpdir()), 'ffenc-candidate-runtime-unit-tests');
async function fixture(t) {
  await fsp.mkdir(parent, { recursive: true });
  const root = await fsp.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fsp.realpath(root);
    assert.equal(path.dirname(actual), await fsp.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fsp.rm(actual, { recursive: true });
  });
  await fsp.mkdir(path.join(root, 'resources'));
  await fsp.writeFile(path.join(root, 'resources', 'candidate-binary-manifest.json'), JSON.stringify(expectedCandidateManifest()));
  return root;
}

const noticeNames = () => expectedCandidateManifest().notices.map(entry => path.posix.basename(entry.repositoryPath));

// Source folders shaped like the qualified build output and the notices
// folder. Each file is a stand-in: `ffmpegSizeDelta`/`fill` make ffmpeg.exe
// differ from its production pin; production pins are never changed.
async function sourceFolders(root, { ffmpegSizeDelta = 0, fill = 0 } = {}) {
  const manifest = expectedCandidateManifest();
  const binariesDirectory = path.join(root, 'build-output', 'bin'), noticesDirectory = path.join(root, 'notices-source');
  await fsp.mkdir(binariesDirectory, { recursive: true }); await fsp.mkdir(noticesDirectory);
  const ffmpeg = path.join(binariesDirectory, 'ffmpeg.exe');
  await fsp.writeFile(ffmpeg, Buffer.alloc(1, fill));
  await fsp.truncate(ffmpeg, manifest.binaries[0].sizeBytes + ffmpegSizeDelta);
  await fsp.writeFile(path.join(binariesDirectory, 'ffprobe.exe'), 'stand-in');
  for (const name of noticeNames()) await fsp.writeFile(path.join(noticesDirectory, name), 'stand-in');
  return { binariesDirectory, noticesDirectory };
}

test('candidate manifest is detached, fixed and validates the tracked manifest', async () => {
  const tracked = JSON.parse(await fsp.readFile(path.resolve(__dirname, '../resources/candidate-binary-manifest.json'), 'utf8'));
  assert.deepEqual(validateCandidateManifest(tracked), expectedCandidateManifest());
  const changed = expectedCandidateManifest(); changed.binaries[0].sha256 = '0'.repeat(64);
  assert.notEqual(expectedCandidateManifest().binaries[0].sha256, changed.binaries[0].sha256);
  assert.equal(MINIMUM_D_FREE_BYTES, 25n * 1024n ** 3n);
});

test('manifest rejects runtime redirection, mixed pairs, changed pins and extra authority', () => {
  const mutations = [
    value => { value.release = '9.0.1'; },
    value => { value.developmentRoot = 'ffmpeg'; },
    value => { value.binaries[0].developmentPath = '../outside.exe'; },
    value => { value.binaries[1].runtimePath = 'ffmpeg/ffmpeg.exe'; },
    value => { value.binaries[0].sha256 = '0'.repeat(64); },
    value => { value.binaries[0].sizeBytes -= 1; },
    value => { value.binaries.reverse(); },
    value => { value.notices[0].repositoryPath = 'resources/third-party/FFmpeg-LICENSE.txt'; },
    value => { value.binaries[0].version = '9.0.2-full_build-www.gyan.dev'; },
    value => { value.sourceBuild.upstream.commit = '0'.repeat(40); },
    value => { value.sourceBuild.sourceArchives[1].sha256 = '0'.repeat(64); },
    value => { value.sourceBuild.configureFlags.push('--enable-nonfree'); },
    value => { value.sourceBuild.buildKit.scripts[0].sha256 = '0'.repeat(64); },
    value => { value.license.correspondingSource.releasePage = 'https://example.invalid/source'; },
    value => { value.evidence.transferReceipt = 'F:/private/transfer-report.json'; },
    value => { value.electron.version = '44.2.0'; },
    value => { value.electron.archive.localPath = 'C:/arbitrary-runtime.zip'; },
    value => { value.argv = ['-y']; },
  ];
  for (const mutate of mutations) { const value = expectedCandidateManifest(); mutate(value); assert.throws(() => validateCandidateManifest(value)); }
});

test('manifest rejects exotic/accessor/hidden properties without evaluating them', () => {
  const getter = expectedCandidateManifest();
  Object.defineProperty(getter, 'release', { enumerable: true, get() { assert.fail('accessor must not run'); } });
  const hidden = expectedCandidateManifest(); Object.defineProperty(hidden, 'unsafe', { value: true });
  const symbol = expectedCandidateManifest(); symbol[Symbol('unsafe')] = true;
  const unusual = Object.assign(Object.create({ unsafe: true }), expectedCandidateManifest());
  for (const value of [getter, hidden, symbol, unusual, null, [], new Date()]) assert.throws(() => validateCandidateManifest(value));
});

test('development selection is fixed and leaves legacy ffmpeg paths unused', async t => {
  const root = await fixture(t), selected = resolveCandidateRuntime({ root });
  assert.equal(selected.ffmpeg, path.join(root, ...DEVELOPMENT_ROOT.split('/'), 'bin', 'ffmpeg.exe'));
  assert.equal(selected.ffprobe, path.join(root, ...DEVELOPMENT_ROOT.split('/'), 'bin', 'ffprobe.exe'));
  assert.equal(selected.manifestPath, path.join(root, 'resources', 'candidate-binary-manifest.json'));
  assert.notEqual(selected.ffmpeg, path.join(root, 'ffmpeg', 'ffmpeg.exe'));
  assert.equal(DEVELOPMENT_ROOT, '.tools/candidate-runtime/ffmpeg-9.1');
  assert.deepEqual(selected.notices, noticeNames().map(name => path.join(root, ...DEVELOPMENT_ROOT.split('/'), 'notices', name)));
  assert.equal(selected.electronArchive, path.join(root, '.tools', 'candidate-runtime', 'electron-44.7.0-zip', 'electron-v44.7.0-win32-x64.zip'));
  assert.deepEqual(await loadCandidateManifest({ root }), expectedCandidateManifest());
});

test('packaged selection uses only packaged fixed resources, not development or PATH', async t => {
  const root = await fixture(t), resourcesPath = path.join(root, 'extracted', 'resources');
  const selected = resolveCandidateRuntime({ root, resourcesPath, isPackaged: true });
  assert.equal(selected.ffmpeg, path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
  assert.equal(selected.ffprobe, path.join(resourcesPath, 'ffmpeg', 'ffprobe.exe'));
  assert.equal(selected.manifestPath, path.join(resourcesPath, 'binary-manifest.json'));
  assert.deepEqual(selected.notices, ['FFmpeg-LICENSE.txt', 'FFmpeg-README.txt', 'Electron-extra-notices.txt']
    .map(name => path.join(resourcesPath, 'third-party', name)));
  assert.equal(selected.electronArchive, null);
});

test('selection rejects relative/invalid roots and missing packaged resources', () => {
  for (const options of [{}, { root: '.' }, { root: 123 }, { root: parent, isPackaged: 'yes' },
    { root: parent, isPackaged: true }, { root: parent, isPackaged: true, resourcesPath: './resources' },
    { root: parent + '\0hidden' }]) assert.throws(() => resolveCandidateRuntime(options));
});

test('missing candidate fails rather than falling back to available legacy binaries', async t => {
  const root = await fixture(t);
  await fsp.mkdir(path.join(root, 'ffmpeg'));
  await fsp.writeFile(path.join(root, 'ffmpeg', 'ffmpeg.exe'), 'legacy');
  await fsp.writeFile(path.join(root, 'ffmpeg', 'ffprobe.exe'), 'legacy');
  await assert.rejects(verifyCandidateRuntime({ root }), { code: 'ENOENT' });
});

test('legacy manifest cannot silently become the packaged candidate manifest', async t => {
  const root = await fixture(t);
  await fsp.writeFile(path.join(root, 'resources', 'binary-manifest.json'), JSON.stringify({ release: '9.0.1' }));
  await assert.rejects(loadCandidateManifest({ root, resourcesPath: path.join(root, 'resources'), isPackaged: true }), /fixed pins/);
});

test('bounded manifest reading rejects oversize and malformed JSON', async t => {
  const root = await fixture(t), filename = path.join(root, 'bad.json');
  await fsp.writeFile(filename, '{}'); assert.deepEqual(await readBoundedJson(filename, 2), {});
  await assert.rejects(readBoundedJson(filename, 1), /bounded read limit/);
  await fsp.writeFile(filename, '{bad'); await assert.rejects(readBoundedJson(filename), SyntaxError);
});

test('pinned-file hashing validates actual retained-handle bytes and exact size', async t => {
  const root = await fixture(t), filename = path.join(root, 'fixture.txt');
  const bytes = Buffer.from('small fixture; never an executable');
  await fsp.writeFile(filename, bytes);
  const pin = { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(await verifyPinnedFile(filename, pin), { path: filename, ...pin });
  await assert.rejects(verifyPinnedFile(filename, { ...pin, sizeBytes: pin.sizeBytes + 1 }), /size mismatch/);
  await assert.rejects(verifyPinnedFile(filename, { ...pin, sha256: '0'.repeat(64) }), /SHA-256 mismatch/);
  await assert.rejects(verifyPinnedFile(filename, { ...pin, sha256: pin.sha256.toUpperCase() }), /Invalid file pin/);
});

test('verification rejects hard-linked runtime files', async t => {
  const root = await fixture(t), filename = path.join(root, 'fixture.txt');
  await fsp.writeFile(filename, 'fixture');
  await fsp.link(filename, path.join(root, 'other-link.txt'));
  const pin = { sizeBytes: 7, sha256: createHash('sha256').update('fixture').digest('hex') };
  await assert.rejects(verifyPinnedFile(filename, pin), /exactly one link/);
});

test('verification rejects linked directory ancestors when the filesystem supports fixture creation', async t => {
  const root = await fixture(t);
  const ordinary = path.join(root, 'ordinary'), linked = path.join(root, 'linked');
  await fsp.mkdir(ordinary); await fsp.writeFile(path.join(ordinary, 'child.txt'), 'child');
  try { await fsp.symlink(ordinary, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) throw error;
    t.skip(`Owned fixture cannot create a directory link (${error.code}); this is not live linked-path evidence.`); return;
  }
  await assert.rejects(assertOrdinaryPath(path.join(linked, 'child.txt')), /link\/reparse point/);
});

test('ordinary-path guard rejects an observed linked ancestor before reading its target', async t => {
  const root = await fixture(t), sentinel = path.join(root, 'sentinel');
  const realLstat = fsp.lstat;
  t.after(() => { fsp.lstat = realLstat; });
  // A deterministic guard test complements, rather than substitutes for, the
  // explicitly limited live filesystem fixture above. No actual link is made.
  fsp.lstat = async filename => filename === sentinel ? { isSymbolicLink: () => true } : realLstat(filename);
  await assert.rejects(assertOrdinaryPath(path.join(sentinel, 'child.exe')), /link\/reparse point/);
});

test('manifest refuses an extra, missing or redirected notice and a changed build output path', () => {
  const extra = expectedCandidateManifest();
  extra.notices.push({ ...extra.notices[0], repositoryPath: `${DEVELOPMENT_ROOT}/notices/Extra.txt`, packagedPath: 'third-party/Extra.txt' });
  const missing = expectedCandidateManifest(); missing.notices.pop();
  const dropped = expectedCandidateManifest(); dropped.notices.shift();
  const repacked = expectedCandidateManifest(); repacked.notices[2].packagedPath = 'Electron-extra-notices.txt';
  const source = expectedCandidateManifest(); source.notices[0].source = 'generated';
  const output = expectedCandidateManifest(); output.binaries[0].buildOutputPath = 'ffmpeg.exe';
  const swapped = expectedCandidateManifest(); swapped.binaries[1].buildOutputPath = 'bin/ffmpeg.exe';
  const legacy = expectedCandidateManifest(); legacy.binaries[0].archivePath = legacy.binaries[0].buildOutputPath; delete legacy.binaries[0].buildOutputPath;
  for (const value of [extra, missing, dropped, repacked, source, output, swapped, legacy]) {
    assert.throws(() => validateCandidateManifest(value), /fixed pins/);
  }
  assert.equal(expectedCandidateManifest().notices.length, 3);
  assert.deepEqual(expectedCandidateManifest().notices.map(entry => entry.source), ['COPYING.GPLv3', 'generated', 'generated']);
  assert.deepEqual(expectedCandidateManifest().binaries.map(entry => entry.buildOutputPath), ['bin/ffmpeg.exe', 'bin/ffprobe.exe']);
});

test('tracked manifest text names no absolute path, drive letter, private F: location or personal name', async () => {
  const text = await fsp.readFile(path.resolve(__dirname, '../resources/candidate-binary-manifest.json'), 'utf8');
  // A checkout under core.autocrlf may add CR; the content must still be the
  // exact generated form line for line.
  assert.equal(text.replaceAll('\r\n', '\n'), JSON.stringify(expectedCandidateManifest(), null, 2) + '\n', 'Tracked manifest is not the exact generated form.');
  assert.doesNotMatch(text, /F:/);
  assert.doesNotMatch(text, /\\/, 'No Windows separators or escapes.');
  assert.doesNotMatch(text, /(^|[^A-Za-z])[A-Za-z]:[\\/]/, 'No drive-letter path.');
  assert.doesNotMatch(text, /Users|Documents|AppData/i);
  const strings = [];
  (function walk(value) {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  })(JSON.parse(text));
  for (const value of strings.filter(item => !/^https:\/\//.test(item))) {
    assert(!path.win32.isAbsolute(value) && !path.posix.isAbsolute(value), `Manifest string is an absolute path: ${value}`);
  }
  // The guard itself must fire on the old private receipt spelling.
  assert.match('"F:/FFmpeg Encoder Project supplied videos/x.json"', /(^|[^A-Za-z])[A-Za-z]:[\\/]/);
});

test('provisioning CLI exposes only the two read-only source folders, no overwrite/activation/destination', () => {
  const binaries = path.join(parent, 'bin'), notices = path.join(parent, 'notices');
  assert.deepEqual(parseArguments(['--binaries', binaries, '--notices', notices]), { binariesDirectory: binaries, noticesDirectory: notices });
  assert.deepEqual(parseArguments(['--notices', notices, '--binaries', binaries]), { binariesDirectory: binaries, noticesDirectory: notices });
  for (const args of [[], ['--binaries', binaries], ['--activate'], ['--overwrite'], ['--destination', parent],
    ['--binaries', './relative', '--notices', notices], ['--binaries', binaries, '--binaries', binaries],
    ['--receipt', binaries, '--payload', notices], ['--binaries', binaries, '--notices', notices, '--force', parent],
    ['--binaries', binaries, '--notices']]) assert.throws(() => parseArguments(args));
});

test('provisioning requires absolute source folders before reading anything', async t => {
  const root = await fixture(t);
  for (const options of [{ root }, { root, binariesDirectory: root }, { root, noticesDirectory: root },
    { root, binariesDirectory: './bin', noticesDirectory: root }, { root, binariesDirectory: root + '\0x', noticesDirectory: root }]) {
    await assert.rejects(provisionCandidateRuntime(options), /must be absolute paths/);
  }
  await assert.rejects(fsp.lstat(path.join(root, '.tools')), { code: 'ENOENT' });
});

test('a build-output ffmpeg.exe that differs from its pin is refused before any slot is created', async t => {
  const root = await fixture(t);
  // One byte longer than the pinned size, then the exact pinned size with
  // different bytes: both must be refused by the size and SHA-256 checks.
  const longer = await sourceFolders(path.join(root, 'longer'), { ffmpegSizeDelta: 1 });
  await assert.rejects(provisionCandidateRuntime({ root, ...longer }), /size mismatch/);
  const shorter = await sourceFolders(path.join(root, 'shorter'), { ffmpegSizeDelta: -1 });
  await assert.rejects(provisionCandidateRuntime({ root, ...shorter }), /size mismatch/);
  const sameSize = await sourceFolders(path.join(root, 'same-size'), { fill: 1 });
  await assert.rejects(provisionCandidateRuntime({ root, ...sameSize }), /SHA-256 mismatch/);
  await assert.rejects(verifySourceFolders(sameSize, expectedCandidateManifest()), /SHA-256 mismatch/);
  await assert.rejects(fsp.lstat(path.join(root, '.tools')), { code: 'ENOENT' });
});

test('missing or linked source folders are refused before any slot is created', async t => {
  const root = await fixture(t);
  await assert.rejects(provisionCandidateRuntime({ root, binariesDirectory: path.join(root, 'absent-bin'),
    noticesDirectory: path.join(root, 'absent-notices') }), { code: 'ENOENT' });
  const folders = await sourceFolders(path.join(root, 'sources'));
  const realLstat = fsp.lstat;
  t.after(() => { fsp.lstat = realLstat; });
  fsp.lstat = async filename => filename === folders.noticesDirectory ? { isSymbolicLink: () => true } : realLstat(filename);
  await assert.rejects(verifySourceFolders(folders, expectedCandidateManifest()), /link\/reparse point/);
  fsp.lstat = realLstat;
  await assert.rejects(fsp.lstat(path.join(root, '.tools')), { code: 'ENOENT' });
});

test('existing partial candidate slot is preserved and refused without reading the source folders', async t => {
  const root = await fixture(t), destination = path.join(root, ...DEVELOPMENT_ROOT.split('/'));
  await fsp.mkdir(destination, { recursive: true });
  await fsp.writeFile(path.join(destination, 'evidence.txt'), 'preserve interrupted work');
  await assert.rejects(provisionCandidateRuntime({ root, binariesDirectory: path.join(root, 'missing-bin'),
    noticesDirectory: path.join(root, 'missing-notices') }), /incomplete or contains unexpected files/);
  assert.equal(await fsp.readFile(path.join(destination, 'evidence.txt'), 'utf8'), 'preserve interrupted work');
  assert.deepEqual(await fsp.readdir(destination), ['evidence.txt']);
});

test('existing complete-looking slot with a wrong notice set, receipt or payload is refused and left untouched', async t => {
  const manifest = expectedCandidateManifest();
  async function slot(t, { notices = noticeNames(), receipt = {} } = {}) {
    const root = await fixture(t), destination = path.join(root, ...DEVELOPMENT_ROOT.split('/'));
    await fsp.mkdir(path.join(destination, 'bin'), { recursive: true }); await fsp.mkdir(path.join(destination, 'notices'));
    for (const entry of manifest.binaries) await fsp.writeFile(path.join(destination, 'bin', entry.name), 'existing');
    for (const name of notices) await fsp.writeFile(path.join(destination, 'notices', name), 'existing');
    const ready = { schemaVersion: 2, completedAtUtc: '2026-11-21T00:00:00.000Z', release: manifest.release, version: manifest.version,
      developmentRoot: DEVELOPMENT_ROOT, upstreamCommit: manifest.sourceBuild.upstream.commit, qualification: manifest.sourceBuild.qualification,
      sources: receiptSources(manifest), files: [], freeBytesBefore: '0', plannedBytes: '0', scope: RECEIPT_SCOPE, ...receipt };
    await fsp.writeFile(path.join(destination, READY_RECEIPT), JSON.stringify(ready));
    const sources = await sourceFolders(path.join(root, 'sources'));
    return { root, destination, sources };
  }
  const cases = [
    [{ notices: ['FFmpeg-LICENSE.txt', 'FFmpeg-README.txt'] }, /pinned notice set/],
    [{ notices: [...noticeNames(), 'Extra.txt'] }, /pinned notice set/],
    [{ receipt: { sourcePayload: 'F:/private/payload' } }, /receipt fields differ/],
    [{ receipt: { release: '9.0.2' } }, /receipt release differs/],
    [{ receipt: { version: '9.0.2' } }, /receipt version differs/],
    [{ receipt: { upstreamCommit: '0'.repeat(40) } }, /receipt upstream commit differs/],
    [{ receipt: { qualification: 'other' } }, /receipt qualification differs/],
    [{ receipt: { schemaVersion: 1 } }, /schema differs/],
    // Private values inside allowed fields are refused, not only extra keys.
    [{ receipt: { sources: { ...receiptSources(manifest), binaries: ['F:/private/ffmpeg.exe', 'bin/ffprobe.exe'] } } }, /receipt sources differ/],
    [{ receipt: { sources: { ...receiptSources(manifest), notices: ['C:/Users/x/notices/FFmpeg-LICENSE.txt'] } } }, /receipt sources differ/],
    [{ receipt: { scope: 'fixture' } }, /receipt scope differs/],
    [{ receipt: { scope: `${RECEIPT_SCOPE} F:/private` } }, /receipt scope differs/],
    [{ receipt: { completedAtUtc: 'F:/private' } }, /completion time/],
    [{ receipt: { completedAtUtc: '2026-13-45T00:00:00.000Z' } }, /completion time/],
    [{ receipt: { freeBytesBefore: 'F:/private' } }, /freeBytesBefore is not a decimal/],
    [{ receipt: { plannedBytes: 12 } }, /plannedBytes is not a decimal/],
    [{}, /size mismatch/],
  ];
  for (const [options, expected] of cases) {
    const { root, destination, sources } = await slot(t, options);
    const before = await fsp.readFile(path.join(destination, READY_RECEIPT), 'utf8');
    await assert.rejects(provisionCandidateRuntime({ root, ...sources }), expected);
    assert.equal(await fsp.readFile(path.join(destination, READY_RECEIPT), 'utf8'), before);
    assert.equal(await fsp.readFile(path.join(destination, 'bin', 'ffmpeg.exe'), 'utf8'), 'existing');
  }
});

test('portable build ships exactly the three candidate notices from the fixed slot', () => {
  assertCandidateNotices(expectedCandidateManifest());
  const extra = expectedCandidateManifest();
  extra.notices.push({ ...extra.notices[0], repositoryPath: `${DEVELOPMENT_ROOT}/notices/Extra.txt`, packagedPath: 'third-party/Extra.txt' });
  const missing = expectedCandidateManifest(); missing.notices.splice(2, 1);
  const moved = expectedCandidateManifest(); moved.notices[1].repositoryPath = 'resources/third-party/FFmpeg-README.txt';
  const renamed = expectedCandidateManifest(); renamed.notices[2].packagedPath = 'third-party/Electron-notices.txt';
  const legacy = { notices: [{ repositoryPath: 'resources/third-party/FFmpeg-LICENSE.txt', packagedPath: 'third-party/FFmpeg-LICENSE.txt' },
    { repositoryPath: 'resources/third-party/FFmpeg-README.txt', packagedPath: 'third-party/FFmpeg-README.txt' }] };
  for (const value of [extra, missing, moved, renamed, legacy]) assert.throws(() => assertCandidateNotices(value));
});

test('candidate README lists exactly the manifest notices and names the corresponding-source asset', async () => {
  const manifest = expectedCandidateManifest();
  const repository = path.resolve(__dirname, '..');
  const readme = await fsp.readFile(path.join(repository, ...CANDIDATE_README.split('/')), 'utf8');
  assertCandidateReadme(readme, manifest);
  assertCandidateReadme(readme.replace(/\r?\n/g, '\r\n'), manifest);
  const legacy = await fsp.readFile(path.join(repository, 'resources', 'PORTABLE_README.txt'), 'utf8');
  assert.throws(() => assertCandidateReadme(legacy, manifest), /notice list differs/);
  const electronLine = '  resources/third-party/Electron-extra-notices.txt\n';
  assert.ok(readme.replace(/\r\n/g, '\n').includes(electronLine));
  const normalized = readme.replace(/\r\n/g, '\n');
  const cases = [
    [normalized.replace(electronLine, ''), /notice list differs/],
    [normalized.replace(electronLine, `${electronLine}  resources/third-party/Extra.txt\n`), /notice list differs/],
    [normalized.replaceAll(manifest.license.correspondingSource.asset, 'other.zip'), /does not name FFmpeg-Encoder-0\.7\.0-alpha\.1-ffmpeg-9\.1-source\.zip/],
    [normalized.replaceAll(manifest.license.correspondingSource.releasePage, 'https://example.invalid/'), /does not name https:/],
    [`${normalized}\nNot a complete corresponding source distribution.\n`, /legacy wording/],
    [`${normalized}\nBundled notices and provenance:\n  resources/binary-manifest.json\n`, /exactly one bundled-notices section/],
  ];
  for (const [text, expected] of cases) assert.throws(() => assertCandidateReadme(text, manifest), expected);
  const extra = expectedCandidateManifest();
  extra.notices.push({ ...extra.notices[0], packagedPath: 'third-party/Extra.txt' });
  assert.throws(() => assertCandidateReadme(readme, extra), /notice list differs/);
  const distribution = candidateDistribution(manifest);
  assert.ok(distribution.includes(manifest.license.correspondingSource.asset) && distribution.includes(manifest.license.correspondingSource.releasePage));
  assert.doesNotMatch(distribution, /no publication or complete corresponding-source claim/);
});

test('build selection preserves legacy pins and independently selects the candidate', () => {
  assert.deepEqual(selectPortableRuntime({ version: '0.6.0' }), { mode: 'legacy-0.6', electronVersion: '44.2.0', manifestName: 'binary-manifest.json' });
  assert.deepEqual(selectPortableRuntime({ version: '0.6.1-rc.2' }), { mode: 'legacy-0.6', electronVersion: '44.2.0', manifestName: 'binary-manifest.json' });
  assert.deepEqual(selectPortableRuntime({ version: '0.7.0-alpha.1' }), { mode: 'candidate-0.7', electronVersion: '44.7.0', manifestName: 'candidate-binary-manifest.json' });
  for (const version of ['0.7.0', '0.7.0-alpha.2', '1.0.0', '0.8.0-alpha.1', undefined]) assert.throws(() => selectPortableRuntime({ version }));
});
