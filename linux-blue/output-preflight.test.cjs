'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { preflightOutputFolder } = require('./output-preflight.cjs');
const root = path.join(__dirname, 'artifacts', 'output-preflight-tests');
async function folder() { await fs.mkdir(root, { recursive: true, mode: 0o700 }); return fs.mkdtemp(path.join(root, 'case-')); }
test('actual exclusive publication and collision preserve bytes and identity without persistent claims', async () => {
  const parent = await folder(); const result = await preflightOutputFolder(parent);
  assert.deepEqual(Object.keys(result).sort(), ['atomicPublication', 'collisionPreserved', 'passed', 'persistentReuse', 'probeDirectory', 'scope']);
  assert(result.passed && result.atomicPublication && result.collisionPreserved); assert.equal(result.persistentReuse, false); assert(Object.isFrozen(result));
  const output = path.join(result.probeDirectory, 'exclusive-probe.txt');
  assert.equal(await fs.readFile(output, 'utf8'), 'Blue Linux exclusive publication probe v1\n');
  assert.equal((await fs.lstat(output)).nlink, 2);
  const again = await preflightOutputFolder(parent);
  assert.notEqual(again.probeDirectory, result.probeDirectory);
  assert.equal(await fs.readFile(output, 'utf8'), 'Blue Linux exclusive publication probe v1\n');
});
test('invalid paths/options refuse before creating any child directory', async () => {
  const parent = await folder();
  for (const bad of [null, '.', 'relative/folder', parent + '/', parent + '/..', parent + '\0']) await assert.rejects(preflightOutputFolder(bad), { code: 'LINUX_OUTPUT_FOLDER' });
  for (const opts of [null, [], { shell: true }, { link: 'override' }, { signal: {} }]) await assert.rejects(preflightOutputFolder(parent, opts), { code: 'LINUX_OUTPUT_OPTIONS' });
  assert.deepEqual(await fs.readdir(parent), []);
});
test('symlink parent, symlink ancestor and non-directory are refused without writes to targets', async () => {
  const parent = await folder(); const actual = path.join(parent, 'actual'); await fs.mkdir(actual);
  const alias = path.join(parent, 'alias'); await fs.symlink(actual, alias);
  await assert.rejects(preflightOutputFolder(alias), { code: 'LINUX_OUTPUT_FOLDER' });
  const nested = path.join(actual, 'nested'); await fs.mkdir(nested);
  await assert.rejects(preflightOutputFolder(path.join(alias, 'nested')), { code: 'LINUX_OUTPUT_FOLDER' });
  const file = path.join(parent, 'file'); await fs.writeFile(file, 'preserve', { flag: 'wx' });
  await assert.rejects(preflightOutputFolder(file), { code: 'LINUX_OUTPUT_FOLDER' });
  assert.deepEqual(await fs.readdir(actual), ['nested']); assert.deepEqual(await fs.readdir(nested), []);
  assert.equal(await fs.readFile(file, 'utf8'), 'preserve');
});
test('group-writable owned test directory is not admitted', async () => {
  const parent = await folder(); await fs.chmod(parent, 0o720);
  await assert.rejects(preflightOutputFolder(parent), { code: 'LINUX_OUTPUT_FOLDER' });
  assert.deepEqual(await fs.readdir(parent), []);
});
test('pre-aborted check performs no writes', async () => {
  const parent = await folder(); const controller = new AbortController(); controller.abort();
  await assert.rejects(preflightOutputFolder(parent, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.deepEqual(await fs.readdir(parent), []);
});
test('unavailable hard link refuses without copy fallback and retains the diagnostic stage', async () => {
  const parent = await folder(); let calls = 0, caught;
  try { await preflightOutputFolder(parent, { link: async () => { calls++; throw Object.assign(new Error('injected'), { code: 'EOPNOTSUPP' }); } }); } catch (failure) { caught = failure; }
  assert.equal(caught?.code, 'ATOMIC_PUBLICATION_UNAVAILABLE'); assert.equal(calls, 1); assert(caught.preflight.retained);
  await assert.rejects(fs.lstat(path.join(caught.preflight.probeDirectory, 'exclusive-probe.txt')), { code: 'ENOENT' });
  assert.equal((await fs.readdir(caught.preflight.probeDirectory)).length, 1);
});
test('a substitute copy cannot masquerade as an exclusive hard-link proof', async () => {
  const parent = await folder();
  await assert.rejects(preflightOutputFolder(parent, { link: (from, to) => fs.copyFile(from, to) }), { code: 'PUBLICATION_UNCERTAIN' });
});
test('permission change during publication invalidates the preflight without cleanup', async () => {
  const parent = await folder(); let retained;
  await assert.rejects(preflightOutputFolder(parent, { link: async (from, to) => { await fs.link(from, to); retained = to; await fs.chmod(parent, 0o720); } }), { code: 'LINUX_OUTPUT_FOLDER' });
  assert.equal(await fs.readFile(retained, 'utf8'), 'Blue Linux exclusive publication probe v1\n');
});
test('parent inode replacement after a link refuses without following or cleaning the replacement', async () => {
  const parent = await folder(); const moved = parent + '-moved'; let relative;
  await assert.rejects(preflightOutputFolder(parent, { link: async (from, to) => {
    await fs.link(from, to); relative = path.relative(parent, to);
    await fs.rename(parent, moved); await fs.mkdir(parent, { mode: 0o700 });
  // The shared publication receipt notices the vanished destination before
  // the later parent recheck. Preserve its stronger post-link uncertainty.
  } }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.deepEqual(await fs.readdir(parent), []);
  assert.equal(await fs.readFile(path.join(moved, relative), 'utf8'), 'Blue Linux exclusive publication probe v1\n');
});
test('cancellation after the first link retains the probe but never returns a passing result', async () => {
  const parent = await folder(); const controller = new AbortController(); let retained;
  await assert.rejects(preflightOutputFolder(parent, { signal: controller.signal, link: async (from, to) => { await fs.link(from, to); retained = to; controller.abort(); } }), { code: 'CANCELLED' });
  assert.equal(await fs.readFile(retained, 'utf8'), 'Blue Linux exclusive publication probe v1\n');
});
test('an unexpected first destination collision is not accepted as proof', async () => {
  const parent = await folder(); let retained;
  await assert.rejects(preflightOutputFolder(parent, { link: async (from, to) => { retained = to; await fs.writeFile(to, 'race winner', { flag: 'wx' }); await fs.link(from, to); } }), { code: 'LINUX_OUTPUT_COLLISION' });
  assert.equal(await fs.readFile(retained, 'utf8'), 'race winner');
});
