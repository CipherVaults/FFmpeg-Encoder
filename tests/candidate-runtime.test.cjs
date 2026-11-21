'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DEVELOPMENT_ROOT, MINIMUM_D_FREE_BYTES, expectedCandidateManifest, validateCandidateManifest,
  resolveCandidateRuntime, loadCandidateManifest, verifyCandidateRuntime, readBoundedJson,
  verifyPinnedFile, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { verifyTransferReceipt, parseArguments, provisionCandidateRuntime } = require('../scripts/provision-candidate-runtime.cjs');
const { selectPortableRuntime } = require('../scripts/build-portable.cjs');

const parent = path.resolve(__dirname, '../artifacts/candidate-runtime-unit-tests');
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

function receipt() {
  const manifest = expectedCandidateManifest();
  return { schema: 1, items: [{ name: manifest.archive.fileName, release: manifest.releasePage,
    url: manifest.archive.url, expectedBytes: manifest.archive.sizeBytes,
    expectedSha256: manifest.archive.sha256, verified: true,
    path: path.join(path.parse(parent).root, 'owned-downloads', manifest.archive.fileName) }] };
}

test('candidate manifest is detached, fixed and validates the tracked manifest', async () => {
  const tracked = JSON.parse(await fsp.readFile(path.resolve(__dirname, '../resources/candidate-binary-manifest.json'), 'utf8'));
  assert.deepEqual(validateCandidateManifest(tracked), expectedCandidateManifest());
  const changed = expectedCandidateManifest(); changed.binaries[0].sha256 = '0'.repeat(64);
  assert.notEqual(expectedCandidateManifest().binaries[0].sha256, changed.binaries[0].sha256);
  assert.equal(MINIMUM_D_FREE_BYTES, 25n * 1024n ** 3n);
});

test('portable manifest evidence uses opaque labels and keeps the exact canonical manifest', async t => {
  const root = await fixture(t);
  const trackedPath = path.resolve(__dirname, '../resources/candidate-binary-manifest.json');
  const bytes = await fsp.readFile(trackedPath);
  const tracked = JSON.parse(bytes);
  const expected = expectedCandidateManifest();
  for (const manifest of [tracked, expected]) {
    const { transferReceipt, runtimeTrial, qualificationLimit } = manifest.evidence;
    assert.match(transferReceipt, /^[a-z0-9][a-z0-9.-]{0,63}$/, 'transfer evidence must not be a private path');
    assert.match(runtimeTrial, /^[a-z0-9][a-z0-9.-]{0,63}$/, 'runtime evidence must not be a private path');
    assert.notEqual(transferReceipt, runtimeTrial);
    assert.equal(qualificationLimit, 'The isolated trial passed current CPU/NVIDIA capability and supplied-file inspection checks. This is not full candidate or packaged acceptance.');
  }
  assert.deepEqual(tracked, expected);

  // Only copy the tracked JSON into the ordinary packaged location; do not
  // invoke Packager, the actual runtime, or the historical evidence locators.
  const resourcesPath = path.join(root, 'package-resources');
  await fsp.mkdir(resourcesPath);
  const packaged = path.join(resourcesPath, 'binary-manifest.json');
  await fsp.writeFile(packaged, bytes, { flag: 'wx' });
  assert.deepEqual(await loadCandidateManifest({ root, resourcesPath, isPackaged: true }), tracked);
  for (const [key, pathValue] of [
    ['transferReceipt', 'X:/owned-fixture/receipt.json'],
    ['runtimeTrial', 'artifacts/owned-fixture/runtime-trial.json'],
  ]) {
    const altered = expectedCandidateManifest();
    altered.evidence[key] = pathValue;
    assert.throws(() => validateCandidateManifest(altered), /approved fixed pins/);
  }
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
  assert.equal(selected.electronArchive, path.join(root, '.tools', 'candidate-runtime', 'electron-44.7.0-zip', 'electron-v44.7.0-win32-x64.zip'));
  assert.deepEqual(await loadCandidateManifest({ root }), expectedCandidateManifest());
});

test('packaged selection uses only packaged fixed resources, not development or PATH', async t => {
  const root = await fixture(t), resourcesPath = path.join(root, 'extracted', 'resources');
  const selected = resolveCandidateRuntime({ root, resourcesPath, isPackaged: true });
  assert.equal(selected.ffmpeg, path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'));
  assert.equal(selected.ffprobe, path.join(resourcesPath, 'ffmpeg', 'ffprobe.exe'));
  assert.equal(selected.manifestPath, path.join(resourcesPath, 'binary-manifest.json'));
  assert.equal(selected.notices[0], path.join(resourcesPath, 'third-party', 'FFmpeg-LICENSE.txt'));
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

test('receipt binds the exact already-verified local archive, not an alternate URL or pair', () => {
  assert.equal(verifyTransferReceipt(receipt()).name, expectedCandidateManifest().archive.fileName);
  const mutations = [
    value => { value.items[0].verified = false; }, value => { value.items.push(value.items[0]); },
    value => { value.items[0].expectedSha256 = '0'.repeat(64); }, value => { value.items[0].expectedBytes -= 1; },
    value => { value.items[0].url = 'https://unapproved.invalid/runtime.7z'; },
    value => { value.items[0].release = 'https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1'; },
    value => { value.items[0].path = './archive.7z'; }, value => { value.schema = 2; },
  ];
  for (const mutate of mutations) { const value = receipt(); mutate(value); assert.throws(() => verifyTransferReceipt(value)); }
  const changed = expectedCandidateManifest(); changed.archive.sha256 = '0'.repeat(64);
  assert.throws(() => verifyTransferReceipt(receipt(), changed), /fixed pins/);
});

test('provisioning CLI exposes only read-only source selection, no overwrite/activation/destination', () => {
  const filename = path.join(parent, 'receipt.json');
  assert.deepEqual(parseArguments(['--receipt', filename, '--payload', parent]), { receiptPath: filename, payloadDirectory: parent });
  assert.deepEqual(parseArguments([]), {});
  for (const args of [['--activate'], ['--overwrite'], ['--destination', parent], ['--receipt', './relative'],
    ['--payload'], ['--receipt', filename, '--receipt', filename]]) assert.throws(() => parseArguments(args));
});

test('existing partial candidate is preserved and rejected without reading external sources', async t => {
  const root = await fixture(t), destination = path.join(root, ...DEVELOPMENT_ROOT.split('/'));
  await fsp.mkdir(destination, { recursive: true });
  await fsp.writeFile(path.join(destination, 'evidence.txt'), 'preserve interrupted work');
  await assert.rejects(provisionCandidateRuntime({ root, receiptPath: path.join(root, 'missing-receipt.json'),
    payloadDirectory: path.join(root, 'missing-payload') }), /incomplete or contains unexpected files/);
  assert.equal(await fsp.readFile(path.join(destination, 'evidence.txt'), 'utf8'), 'preserve interrupted work');
  assert.deepEqual(await fsp.readdir(destination), ['evidence.txt']);
});

test('invalid transfer receipt does not create a candidate destination', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json');
  const bad = receipt(); bad.items[0].verified = false;
  await fsp.writeFile(filename, JSON.stringify(bad));
  await assert.rejects(provisionCandidateRuntime({ root, receiptPath: filename, payloadDirectory: root }), /not marked verified/);
  await assert.rejects(fsp.lstat(path.join(root, '.tools')), { code: 'ENOENT' });
});

test('build selection preserves legacy pins and independently selects the candidate', () => {
  assert.deepEqual(selectPortableRuntime({ version: '0.6.0' }), { mode: 'legacy-0.6', electronVersion: '44.2.0', manifestName: 'binary-manifest.json' });
  assert.deepEqual(selectPortableRuntime({ version: '0.6.1-rc.2' }), { mode: 'legacy-0.6', electronVersion: '44.2.0', manifestName: 'binary-manifest.json' });
  assert.deepEqual(selectPortableRuntime({ version: '0.7.0-alpha.1' }), { mode: 'candidate-0.7', electronVersion: '44.7.0', manifestName: 'candidate-binary-manifest.json' });
  for (const version of ['0.7.0', '0.7.0-alpha.2', '1.0.0', '0.8.0-alpha.1', undefined]) assert.throws(() => selectPortableRuntime({ version }));
});
