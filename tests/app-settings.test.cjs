'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AppSettings, defaultAppSettings, APP_SETTINGS_NAMESPACE, APP_SETTINGS_FILE, MAX_APP_SETTINGS_BYTES } = require('../src/app-settings.cjs');

const parent = path.resolve(__dirname, '../artifacts/app-settings-unit-tests');
async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  const directory = path.join(root, APP_SETTINGS_NAMESPACE);
  const filename = path.join(directory, APP_SETTINGS_FILE);
  const write = async data => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filename, typeof data === 'string' ? data : JSON.stringify(data));
  };
  const record = (revision = 7) => ({ namespace: APP_SETTINGS_NAMESPACE, schema: 1, revision, defaults: defaultAppSettings() });
  return { root, directory, filename, write, record, open: () => new AppSettings({ directory: root }) };
}

test('defaults load without writes and every returned snapshot is detached', async t => {
  const h = await fixture(t);
  const store = h.open();
  assert.equal(store.snapshot().persistence.state, 'unloaded');
  const loaded = await store.load();
  assert.deepEqual(loaded, { schema: 1, revision: 0, defaults: defaultAppSettings(), notices: [],
    persistence: { state: 'ready', persisted: false, resetRequired: false } });
  loaded.defaults.hdrPolicy = 'sdr'; loaded.notices.push('fake'); loaded.persistence.persisted = true;
  assert.deepEqual(await store.load(), store.snapshot());
  assert.deepEqual(store.snapshot().defaults, defaultAppSettings());
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('exact versioned new-batch defaults save atomically and survive restart', async t => {
  const h = await fixture(t);
  const store = h.open();
  const defaults = { fullAudioPolicy: 'precision-flac', rangeAudioPolicy: 'copy', resolution: '1080', hdrPolicy: 'sdr',
    remuxTarget: 'mov', previewExpanded: true };
  const saved = await store.save({ revision: 0, defaults });
  assert.equal(saved.revision, 1); assert.equal(saved.persistence.persisted, true);
  assert.deepEqual(saved.defaults, defaults);
  const disk = JSON.parse(await fs.readFile(h.filename, 'utf8'));
  assert.deepEqual(disk, { namespace: APP_SETTINGS_NAMESPACE, schema: 1, revision: 1, defaults });
  assert.deepEqual((await h.open().load()).defaults, defaults);
  assert.deepEqual(await fs.readdir(h.directory), [APP_SETTINGS_FILE]);
  saved.defaults.rangeAudioPolicy = 'precision-aac';
  assert.equal(store.snapshot().defaults.rangeAudioPolicy, 'copy');
});

test('request payloads reject extra authority, getters, wrong types and unsupported controls before writing', async t => {
  const h = await fixture(t), store = h.open();
  const good = { revision: 0, defaults: defaultAppSettings() };
  const getter = { revision: 0 };
  Object.defineProperty(getter, 'defaults', { enumerable: true, get() { assert.fail('untrusted accessor must not run'); } });
  for (const request of [null, [], {}, getter, { ...good, revision: '0' }, { ...good, revision: NaN },
    { ...good, revision: Infinity }, { ...good, revision: -1 }, { ...good, revision: 0.5 },
    { ...good, path: h.root }, { ...good, defaults: { ...good.defaults, sourceGrant: 'fake' } },
    { ...good, defaults: { ...good.defaults, fullAudioPolicy: 'drop' } },
    { ...good, defaults: { ...good.defaults, rangeAudioPolicy: 'skip' } },
    { ...good, defaults: { ...good.defaults, resolution: 1080 } },
    { ...good, defaults: { ...good.defaults, hdrPolicy: 'ignore' } },
    { ...good, defaults: { ...good.defaults, remuxTarget: '-y' } },
    { ...good, defaults: { ...good.defaults, previewExpanded: 'true' } },
    { ...good, defaults: Object.assign(Object.create({ path: h.root }), good.defaults) },
    { ...good, defaults: { ...good.defaults, [Symbol('hidden')]: true } }]) {
    assert.throws(() => store.save(request), { code: 'INVALID_APP_SETTINGS' });
  }
  for (const request of [null, [], {}, { revision: 0, defaults: good.defaults }, { revision: Infinity }, { revision: '0' }]) {
    assert.throws(() => store.reset(request), { code: 'INVALID_APP_SETTINGS' });
  }
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('save snapshots its request before queuing, then rejects stale saves and resets', async t => {
  const h = await fixture(t), store = h.open();
  const request = { revision: 0, defaults: { ...defaultAppSettings(), resolution: '720' } };
  const first = store.save(request);
  request.defaults.resolution = '2160';
  const stale = store.save({ revision: 0, defaults: defaultAppSettings() });
  await assert.rejects(stale, { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  assert.equal((await first).defaults.resolution, '720');
  const before = await fs.readFile(h.filename);
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.deepEqual(await fs.readdir(h.directory), [APP_SETTINGS_FILE]);
});

test('two in-process views cannot overwrite one another through matching old revisions', async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  await Promise.all([first.load(), second.load()]);
  await first.save({ revision: 0, defaults: { ...defaultAppSettings(), remuxTarget: 'mp4' } });
  await assert.rejects(second.save({ revision: 0, defaults: defaultAppSettings() }), { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  assert.equal((await h.open().load()).defaults.remuxTarget, 'mp4');
});

for (const [name, data] of [
  ['corrupt JSON', '{partial'],
  ['future schema', { namespace: APP_SETTINGS_NAMESPACE, schema: 9, revision: 4, defaults: defaultAppSettings() }],
  ['unknown field', { namespace: APP_SETTINGS_NAMESPACE, schema: 1, revision: 4, defaults: defaultAppSettings(), grant: 'never' }],
  ['invalid default', { namespace: APP_SETTINGS_NAMESPACE, schema: 1, revision: 4, defaults: { ...defaultAppSettings(), previewExpanded: 1 } }],
  ['oversized file', 'x'.repeat(MAX_APP_SETTINGS_BYTES + 1)],
]) {
  test(`${name} stays untouched until explicit reset archives its exact bytes`, async t => {
    const h = await fixture(t);
    await h.write(data);
    const before = await fs.readFile(h.filename);
    const store = h.open();
    const loaded = await store.load();
    assert.equal(loaded.persistence.resetRequired, true);
    assert.deepEqual(loaded.defaults, defaultAppSettings());
    await assert.rejects(store.save({ revision: loaded.revision, defaults: defaultAppSettings() }), { code: 'APP_SETTINGS_RESET_REQUIRED' });
    assert.deepEqual(await fs.readFile(h.filename), before);
    const reset = await store.reset({ revision: loaded.revision });
    assert.equal(reset.revision, 1); assert.equal(reset.persistence.persisted, true);
    assert.equal(reset.persistence.resetRequired, false);
    const archives = await fs.readdir(path.join(h.directory, 'archives'));
    assert.equal(archives.length, 1);
    assert.deepEqual(await fs.readFile(path.join(h.directory, 'archives', archives[0])), before);
    assert.deepEqual((await h.open().load()).defaults, defaultAppSettings());
  });
}

test('explicit reset archives valid preferences while leaving separate profile preferences untouched', async t => {
  const h = await fixture(t), store = h.open();
  await store.save({ revision: 0, defaults: { ...defaultAppSettings(), fullAudioPolicy: 'precision-aac' } });
  const original = await fs.readFile(h.filename);
  const separate = path.join(h.root, 'localpreferences-v1');
  await fs.mkdir(separate); await fs.writeFile(path.join(separate, 'preferences.json'), 'unrelated profile preference');
  const reset = await store.reset({ revision: 1 });
  assert.equal(reset.revision, 2); assert.deepEqual(reset.defaults, defaultAppSettings());
  const archived = await fs.readdir(path.join(h.directory, 'archives'));
  assert.deepEqual(await fs.readFile(path.join(h.directory, 'archives', archived[0])), original);
  assert.equal(await fs.readFile(path.join(separate, 'preferences.json'), 'utf8'), 'unrelated profile preference');
});

test('unknown external replacement after load remains untouched', async t => {
  const h = await fixture(t), store = h.open();
  await store.save({ revision: 0, defaults: defaultAppSettings() });
  await h.write({ ...h.record(), schema: 2 });
  const bytes = await fs.readFile(h.filename);
  await assert.rejects(store.save({ revision: 1, defaults: { ...defaultAppSettings(), hdrPolicy: 'sdr' } }), { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.equal(store.snapshot().persistence.resetRequired, true);
  await assert.rejects(store.reset({ revision: 1 }), { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  await store.reset({ revision: store.snapshot().revision });
  const archived = await fs.readdir(path.join(h.directory, 'archives'));
  assert.deepEqual(await fs.readFile(path.join(h.directory, 'archives', archived[0])), bytes);
});

test('hard-linked settings cannot grant overwrite or reset authority', async t => {
  const h = await fixture(t);
  await fs.mkdir(h.directory);
  const target = path.join(h.root, 'unrelated.json');
  await fs.writeFile(target, JSON.stringify(h.record()));
  await fs.link(target, h.filename);
  const store = h.open(), before = await fs.readFile(target);
  assert.equal((await store.load()).persistence.resetRequired, true);
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_UNSAFE_FILE' });
  assert.deepEqual(await fs.readFile(target), before);
  assert.deepEqual(await fs.readFile(h.filename), before);
});

test('a namespace reporting a reparse link is rejected before reading or mutating its target', async t => {
  const h = await fixture(t);
  await h.write(h.record());
  const before = await fs.readFile(h.filename);
  const lstat = fs.lstat.bind(fs);
  // Deterministic boundary test: this host rejected creation of a native
  // junction. Do not mistake this simulated observation for native reparse QA.
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    const stat = await lstat(file, ...args);
    if (file === h.directory) stat.isSymbolicLink = () => true;
    return stat;
  });
  const store = h.open();
  assert.equal((await store.load()).persistence.resetRequired, true);
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_UNSAFE_PATH' });
  assert.deepEqual(await fs.readFile(h.filename), before);
});

test('oversized load never opens the file and reset archives without copying it', async t => {
  const h = await fixture(t);
  await h.write('x'.repeat(MAX_APP_SETTINGS_BYTES + 128));
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === h.filename) assert.fail('oversized record must not be read before replacement');
    return open(file, ...args);
  });
  const store = h.open();
  assert.equal((await store.load()).persistence.resetRequired, true);
  // Reset's final bounded read is allowed once its newly written file exists.
  t.mock.restoreAll();
  t.mock.method(fs, 'copyFile', async () => assert.fail('archive must not copy unbounded data'));
  assert.equal((await store.reset({ revision: 0 })).persistence.persisted, true);
});

test('failed atomic rename preserves previous defaults/revision/file and permits a safe retry', async t => {
  const h = await fixture(t), store = h.open();
  await store.save({ revision: 0, defaults: defaultAppSettings() });
  const before = await fs.readFile(h.filename);
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === h.filename) throw Object.assign(new Error('Write denied'), { code: 'EACCES' });
    return rename(source, target);
  });
  await assert.rejects(store.save({ revision: 1, defaults: { ...defaultAppSettings(), resolution: '720' } }), { code: 'EACCES' });
  assert.equal(store.snapshot().revision, 1);
  assert.equal(store.snapshot().defaults.resolution, 'source');
  assert.equal(store.snapshot().persistence.state, 'write-failed');
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.deepEqual(await fs.readdir(h.directory), [APP_SETTINGS_FILE]);
  t.mock.restoreAll();
  assert.equal((await store.save({ revision: 1, defaults: { ...defaultAppSettings(), resolution: '720' } })).revision, 2);
});

test('failed temporary write removes only its owned temporary file and preserves previous settings', async t => {
  const h = await fixture(t), store = h.open();
  await store.save({ revision: 0, defaults: defaultAppSettings() });
  const before = await fs.readFile(h.filename), open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx') handle.writeFile = async () => { throw Object.assign(new Error('Disk write unavailable'), { code: 'ENOSPC' }); };
    return handle;
  });
  await assert.rejects(store.save({ revision: 1, defaults: { ...defaultAppSettings(), hdrPolicy: 'sdr' } }), { code: 'ENOSPC' });
  assert.equal(store.snapshot().revision, 1);
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.deepEqual(await fs.readdir(h.directory), [APP_SETTINGS_FILE]);
});

test('uncertain observation after rename does not falsely report saved defaults', async t => {
  const h = await fixture(t), store = h.open();
  await store.save({ revision: 0, defaults: defaultAppSettings() });
  const rename = fs.rename.bind(fs), lstat = fs.lstat.bind(fs);
  let committed = false;
  t.mock.method(fs, 'rename', async (...args) => { await rename(...args); committed = true; });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (committed && file === h.filename) throw Object.assign(new Error('Post-commit observation denied'), { code: 'EACCES' });
    return lstat(file, ...args);
  });
  await assert.rejects(store.save({ revision: 1, defaults: { ...defaultAppSettings(), hdrPolicy: 'sdr' } }), { code: 'EACCES' });
  assert.equal(store.snapshot().revision, 1);
  assert.equal(store.snapshot().defaults.hdrPolicy, 'preserve');
  assert.equal(store.snapshot().persistence.persisted, false);
  assert.equal(store.snapshot().persistence.resetRequired, true);
  t.mock.restoreAll();
  assert.equal((await h.open().load()).defaults.hdrPolicy, 'sdr', 'the possibly committed file was preserved for restart review');
});

test('reset rename failure preserves old file and removes only its own still-bound archive link', async t => {
  const h = await fixture(t);
  await h.write('{unknown');
  const before = await fs.readFile(h.filename), store = h.open();
  await store.load();
  t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('Write denied'), { code: 'EACCES' }); });
  await assert.rejects(store.reset({ revision: 0 }), { code: 'EACCES' });
  assert.equal((await fs.stat(h.filename)).nlink, 1);
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.equal(store.snapshot().revision, 0);
  assert.deepEqual(await fs.readdir(path.join(h.directory, 'archives')), []);
  t.mock.restoreAll();
  assert.equal((await store.reset({ revision: 0 })).persistence.persisted, true);
});

test('a transient observation failure immediately after archive link creation does not strand reset', async t => {
  const h = await fixture(t);
  await h.write('{unknown');
  const before = await fs.readFile(h.filename), store = h.open();
  await store.load();
  const link = fs.link.bind(fs), lstat = fs.lstat.bind(fs), archiveDirectory = path.join(h.directory, 'archives');
  let linked = false, failed = false;
  t.mock.method(fs, 'link', async (...args) => { await link(...args); linked = true; });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (linked && !failed && path.dirname(file) === archiveDirectory) {
      failed = true;
      throw Object.assign(new Error('Archive observation temporarily unavailable'), { code: 'EACCES' });
    }
    return lstat(file, ...args);
  });
  await assert.rejects(store.reset({ revision: 0 }), { code: 'EACCES' });
  assert.equal(failed, true);
  assert.equal((await fs.stat(h.filename)).nlink, 1);
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.deepEqual(await fs.readdir(archiveDirectory), []);
  assert.equal(store.snapshot().revision, 0);
  t.mock.restoreAll();
  assert.equal((await store.reset({ revision: 0 })).persistence.persisted, true);
});

for (const restart of [false, true]) {
  test(`an uncertain retained archive can finish explicit reset ${restart ? 'after restart' : 'in the same view'} without deleting old bytes`, async t => {
    const h = await fixture(t);
    await h.write('{unknown');
    const before = await fs.readFile(h.filename), original = h.open();
    await original.load();
    const link = fs.link.bind(fs), lstat = fs.lstat.bind(fs), archiveDirectory = path.join(h.directory, 'archives');
    let linked = false;
    t.mock.method(fs, 'link', async (...args) => { await link(...args); linked = true; });
    t.mock.method(fs, 'lstat', async (file, ...args) => {
      if (linked && path.dirname(file) === archiveDirectory) {
        throw Object.assign(new Error('Archive identity cannot be observed'), { code: 'EACCES' });
      }
      return lstat(file, ...args);
    });
    await assert.rejects(original.reset({ revision: 0 }), { code: 'EACCES' });
    assert.equal((await fs.stat(h.filename)).nlink, 2);
    assert.deepEqual(await fs.readFile(h.filename), before);
    assert.equal(original.snapshot().persistence.resetRequired, true);
    assert.match(original.snapshot().notices.join(' '), /Reset explicitly to recover/);
    t.mock.restoreAll();
    const archives = await fs.readdir(archiveDirectory);
    assert.equal(archives.length, 1);
    const retained = path.join(archiveDirectory, archives[0]);
    assert.deepEqual(await fs.readFile(retained), before);
    const store = restart ? h.open() : original;
    assert.equal((await store.load()).persistence.resetRequired, true);
    await assert.rejects(store.save({ revision: 0, defaults: defaultAppSettings() }), { code: 'APP_SETTINGS_RESET_REQUIRED' });
    const saved = await store.reset({ revision: store.snapshot().revision });
    assert.equal(saved.persistence.persisted, true);
    assert.deepEqual(saved.defaults, defaultAppSettings());
    assert.deepEqual(await fs.readdir(archiveDirectory), archives, 'recovery preserves the existing archive instead of creating or deleting an uncertain link');
    assert.equal((await fs.stat(retained)).nlink, 1);
    assert.equal((await fs.stat(h.filename)).nlink, 1);
    assert.deepEqual(await fs.readFile(retained), before);
    assert.deepEqual((await h.open().load()).defaults, defaultAppSettings());
  });
}

test('reset recovery refuses non-archive links and extra unaccounted links', async t => {
  const h = await fixture(t);
  await h.write('{unknown');
  const archiveDirectory = path.join(h.directory, 'archives');
  await fs.mkdir(archiveDirectory);
  const unrelated = path.join(archiveDirectory, 'unrelated.json');
  await fs.link(h.filename, unrelated);
  let store = h.open(); await store.load();
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_UNSAFE_FILE' });
  assert.equal(await fs.readFile(unrelated, 'utf8'), '{unknown');
  const archive = path.join(archiveDirectory, '11111111-1111-4111-8111-111111111111.json');
  await fs.link(h.filename, archive);
  store = h.open(); await store.load();
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_UNSAFE_FILE' });
  assert.equal((await fs.stat(h.filename)).nlink, 3);
  assert.equal(await fs.readFile(archive, 'utf8'), '{unknown');
  assert.equal(await fs.readFile(unrelated, 'utf8'), '{unknown');
});

test('reset recovery does not silently adopt changed content in a retained archive pair', async t => {
  const h = await fixture(t);
  await h.write('{unknown');
  const store = h.open(); await store.load();
  const link = fs.link.bind(fs), lstat = fs.lstat.bind(fs), archiveDirectory = path.join(h.directory, 'archives');
  let linked = false;
  t.mock.method(fs, 'link', async (...args) => { await link(...args); linked = true; });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (linked && path.dirname(file) === archiveDirectory) throw Object.assign(new Error('Unknown archive identity'), { code: 'EACCES' });
    return lstat(file, ...args);
  });
  await assert.rejects(store.reset({ revision: 0 }), { code: 'EACCES' });
  t.mock.restoreAll();
  await fs.writeFile(h.filename, '{changed-content');
  const before = await fs.readFile(h.filename), archives = await fs.readdir(archiveDirectory);
  await assert.rejects(store.reset({ revision: 0 }), { code: 'APP_SETTINGS_CHANGED' });
  assert.equal((await fs.stat(h.filename)).nlink, 2);
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.deepEqual(await fs.readFile(path.join(archiveDirectory, archives[0])), before);
  assert.deepEqual(await fs.readdir(archiveDirectory), archives);
});

test('revision overflow and invalid constructor paths fail without writes', async t => {
  const h = await fixture(t);
  for (const directory of ['', 'relative', `${h.root}\u0000`, '\\\\?\\C:\\owned']) {
    assert.throws(() => new AppSettings({ directory }), TypeError);
  }
  await h.write(h.record(Number.MAX_SAFE_INTEGER));
  const store = h.open(); await store.load();
  await assert.rejects(store.save({ revision: Number.MAX_SAFE_INTEGER, defaults: defaultAppSettings() }), { code: 'APP_SETTINGS_REVISION_EXHAUSTED' });
});
