'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { reserveDirectory, reserveDirectoryChain, requireAbsent, openProvisionReceipt } = require('../scripts/provision-candidate-electron.cjs');

const parent = path.resolve(__dirname, '../artifacts/electron-provision-unit-tests');
async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  return root;
}

test('fixed directory components are additive and existing ordinary parents are reused', async t => {
  const root = await fixture(t), components = ['.tools', 'candidate-runtime', 'electron-zip'];
  const target = await reserveDirectoryChain(root, components);
  assert.equal(target, path.join(root, ...components));
  await fs.writeFile(path.join(target, 'known.txt'), 'preserve');
  assert.equal(await reserveDirectoryChain(root, components), target);
  assert.equal(await fs.readFile(path.join(target, 'known.txt'), 'utf8'), 'preserve');
});

test('exclusive distribution reservation preserves an existing incomplete directory', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist', 'unknown.txt'), 'unknown');
  await assert.rejects(reserveDirectory(root, 'dist'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(root, 'dist', 'unknown.txt'), 'utf8'), 'unknown');
});

test('parent refusal occurs before child mkdir; no native junction claim is inferred', async t => {
  const root = await fixture(t), operations = [];
  const io = { mkdir: async filename => { operations.push(['mkdir', filename]); assert.fail('refused parent must not be written'); } };
  const assertPath = async (filename, type) => { operations.push(['guard', filename, type]); throw new Error('observed redirected parent'); };
  await assert.rejects(reserveDirectory(root, 'child', { io, assertPath }), /redirected parent/);
  assert.deepEqual(operations, [['guard', root, 'directory']]);
});

test('an existing non-directory ancestor is preserved and no descendants are created', async t => {
  const root = await fixture(t), existing = path.join(root, '.tools');
  await fs.writeFile(existing, 'unknown entry');
  await assert.rejects(reserveDirectoryChain(root, ['.tools', 'candidate-runtime']), /unexpected entry type/);
  assert.equal(await fs.readFile(existing, 'utf8'), 'unknown entry');
  assert.deepEqual(await fs.readdir(root), ['.tools']);
});

test('directory components cannot inject another path or escape the fixed parent', async t => {
  const root = await fixture(t);
  for (const name of ['', '.', '..', '../other', 'other/child', 'other\\child', 'bad\0entry']) {
    await assert.rejects(reserveDirectory(root, name), /directory component/);
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test('absence preflight preserves unknown files and incomplete directories', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json');
  await requireAbsent(filename);
  await fs.writeFile(filename, 'unknown receipt');
  await assert.rejects(requireAbsent(filename), /Preserve existing provision state/);
  await fs.mkdir(path.join(root, 'dist'));
  await assert.rejects(requireAbsent(path.join(root, 'dist')), /Preserve existing provision state/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'unknown receipt');
});

test('receipt updates retain one exclusive handle and truncate a shorter final report', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json');
  let opens = 0;
  const io = { open: async (...args) => { opens++; return fs.open(...args); }, lstat: (...args) => fs.lstat(...args) };
  const initial = { status: 'extracting', detail: 'long initial detail '.repeat(20) };
  const receipt = await openProvisionReceipt(filename, initial, { io });
  t.after(() => receipt.close());
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), initial);
  const final = { status: 'provisioned' };
  await receipt.update(final);
  assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), final);
  assert.equal(opens, 1);
  await receipt.close();
  await assert.rejects(receipt.update(initial), /closed/);
});

test('exclusive receipt open never overwrites an existing record', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json');
  await fs.writeFile(filename, 'unknown receipt');
  await assert.rejects(openProvisionReceipt(filename, { status: 'extracting' }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(filename, 'utf8'), 'unknown receipt');
});

test('replacement before final receipt update preserves the replacement and prior owned record', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json'), retained = path.join(root, 'retained.json');
  const receipt = await openProvisionReceipt(filename, { status: 'extracting' });
  t.after(() => receipt.close());
  const prior = await fs.readFile(filename, 'utf8');
  await fs.rename(filename, retained);
  await fs.writeFile(filename, 'unrelated replacement');
  await assert.rejects(receipt.update({ status: 'provisioned' }), /no longer belongs/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'unrelated replacement');
  assert.equal(await fs.readFile(retained, 'utf8'), prior);
});

test('external edits of the same receipt object are preserved rather than adopted', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json');
  const receipt = await openProvisionReceipt(filename, { status: 'extracting' });
  t.after(() => receipt.close());
  const edited = 'external modification of the same object';
  await fs.writeFile(filename, edited);
  await assert.rejects(receipt.update({ status: 'provisioned' }), /changed outside/);
  assert.equal(await fs.readFile(filename, 'utf8'), edited);
});

test('a newly hard-linked receipt refuses subsequent updates without deleting either name', async t => {
  const root = await fixture(t), filename = path.join(root, 'receipt.json'), alias = path.join(root, 'alias.json');
  const receipt = await openProvisionReceipt(filename, { status: 'extracting' });
  t.after(() => receipt.close());
  const prior = await fs.readFile(filename, 'utf8');
  await fs.link(filename, alias);
  await assert.rejects(receipt.update({ status: 'provisioned' }), /single-link/);
  assert.equal(await fs.readFile(filename, 'utf8'), prior);
  assert.equal(await fs.readFile(alias, 'utf8'), prior);
});
