'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AppearanceSettings, APPEARANCE_NAMESPACE, APPEARANCE_FILE, MAX_APPEARANCE_BYTES, MAX_PENDING_APPEARANCE_WRITES } = require('../src/appearance.cjs');

const parent = path.resolve(__dirname, '../artifacts/v0.7/icon-themes/appearance-unit');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    t.mock.restoreAll();
    const actual = await fs.realpath(root);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  const directory = path.join(root, APPEARANCE_NAMESPACE);
  const filename = path.join(directory, APPEARANCE_FILE);
  const write = async data => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filename, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
  };
  const record = theme => ({ namespace: APPEARANCE_NAMESPACE, schema: 1, theme });
  return { root, directory, filename, write, record, open: () => new AppearanceSettings({ directory: root }) };
}

test('missing appearance uses detached dark defaults without creating a namespace', async t => {
  const h = await fixture(t), store = h.open();
  const loaded = await store.load();
  assert.deepEqual(loaded, { schema: 1, theme: 'dark', persistence: { state: 'default', persisted: false }, notices: [] });
  loaded.theme = 'light'; loaded.persistence.persisted = true; loaded.notices.push('untrusted');
  assert.deepEqual(await store.load(), store.snapshot());
  assert.equal(store.snapshot().theme, 'dark');
  assert.deepEqual(await fs.readdir(h.root), []);
  assert.deepEqual(await store.flush(), store.snapshot());
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('appearance is additive and leaves existing schema1 processing and profile preferences byte-identical', async t => {
  const h = await fixture(t);
  const existing = [
    [path.join(h.root, 'appsettings-v1', 'settings.json'), Buffer.from('{"namespace":"appsettings-v1","schema":1,"revision":6,"defaults":{"resolution":"1080"}}\n')],
    [path.join(h.root, 'localpreferences-v1', 'preferences.json'), Buffer.from('{"namespace":"localpreferences-v1","version":2,"profileId":"h265-nvidia","settingsByProfile":{"recipeId":"preserved"}}\n')],
  ];
  for (const [file, bytes] of existing) { await fs.mkdir(path.dirname(file)); await fs.writeFile(file, bytes); }
  const store = h.open();
  assert.equal((await store.load()).theme, 'dark');
  assert.deepEqual((await fs.readdir(h.root)).sort(), ['appsettings-v1', 'localpreferences-v1']);
  await store.set({ theme: 'light' });
  for (const [file, bytes] of existing) assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal((await h.open().load()).theme, 'light');
});

for (const theme of ['dark', 'light']) {
  test(`${theme} saves with the exact versioned schema and survives a new store`, async t => {
    const h = await fixture(t), store = h.open();
    const saved = await store.set({ theme });
    assert.deepEqual(saved, { schema: 1, theme, persistence: { state: 'saved', persisted: true }, notices: [] });
    assert.deepEqual(JSON.parse(await fs.readFile(h.filename, 'utf8')), h.record(theme));
    assert.deepEqual(await h.open().load(), saved);
    assert.deepEqual(await fs.readdir(h.directory), [APPEARANCE_FILE]);
    saved.persistence.persisted = false; saved.notices.push('fake');
    assert.equal(store.snapshot().persistence.persisted, true);
    assert.deepEqual(store.snapshot().notices, []);
  });
}

test('invalid DTOs reject synchronously before invoking getters or creating files', async t => {
  const h = await fixture(t), store = h.open();
  const accessor = {};
  Object.defineProperty(accessor, 'theme', { enumerable: true, get() { assert.fail('an accessor must never be invoked'); } });
  const hidden = {}; Object.defineProperty(hidden, 'theme', { value: 'light' });
  const protoKey = { theme: 'light' }; Object.defineProperty(protoKey, '__proto__', { value: null, enumerable: true });
  for (const request of [null, [], {}, 'light', accessor, hidden, protoKey,
    { theme: 'system' }, { theme: 'Light' }, { theme: '' }, { theme: null }, { theme: 1 },
    { theme: ['light'] }, { theme: 'light', path: h.filename }, { theme: 'light', defaults: {} },
    { theme: 'light', [Symbol('extra')]: true }, Object.create({ theme: 'light' }),
    Object.assign(Object.create({ inherited: true }), { theme: 'light' })]) {
    assert.throws(() => store.set(request), { code: 'INVALID_APPEARANCE' });
  }
  assert.deepEqual(await fs.readdir(h.root), []);
  assert.equal((await store.flush()).persistence.persisted, false);
});

test('queued requests capture their theme before yielding', async t => {
  const h = await fixture(t), store = h.open(), request = { theme: 'light' };
  const pending = store.set(request);
  request.theme = 'dark'; request.path = h.root;
  assert.equal((await pending).theme, 'light');
  assert.equal((await h.open().load()).theme, 'light');
});

test('rapid accepted changes serialize and flush waits through the final durable write', async t => {
  const h = await fixture(t), store = h.open(), gate = deferred(), entered = deferred();
  const open = fs.open.bind(fs), rename = fs.rename.bind(fs), committed = [];
  let held = false;
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx' && !held) {
      held = true;
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { entered.resolve(); await gate.promise; return sync(); };
    }
    return handle;
  });
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === h.filename) committed.push(JSON.parse(await fs.readFile(source, 'utf8')).theme);
    return rename(source, destination);
  });
  const first = store.set({ theme: 'light' });
  const second = store.set({ theme: 'dark' });
  let closed = false;
  const closing = store.flush().then(result => { closed = true; return result; });
  await entered.promise;
  const third = store.set({ theme: 'light' });
  await tick(); assert.equal(closed, false);
  gate.resolve();
  assert.deepEqual((await Promise.all([first, second, third])).map(result => result.theme), ['light', 'dark', 'light']);
  assert.equal((await closing).theme, 'light');
  assert.equal(closed, true);
  assert.deepEqual(committed, ['light', 'dark', 'light']);
  assert.equal((await h.open().load()).theme, 'light');
});

test('hostile overload admits only the fixed cap and creates no writes for rejected requests', async t => {
  const h = await fixture(t), store = h.open(), gate = deferred(), entered = deferred();
  const open = fs.open.bind(fs), rename = fs.rename.bind(fs), committed = [];
  let temporaryCount = 0, held = false;
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx') {
      temporaryCount++;
      if (!held) {
        held = true;
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { entered.resolve(); await gate.promise; return sync(); };
      }
    }
    return handle;
  });
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === h.filename) committed.push(JSON.parse(await fs.readFile(source, 'utf8')).theme);
    return rename(source, destination);
  });
  const themes = Array.from({ length: MAX_PENDING_APPEARANCE_WRITES }, (_, index) => index % 2 ? 'dark' : 'light');
  const accepted = themes.map(theme => store.set({ theme }));
  await entered.promise;
  const before = store.snapshot();
  for (let index = 0; index < 64; index++) {
    assert.throws(() => store.set({ theme: index % 2 ? 'light' : 'dark' }), { code: 'APPEARANCE_BUSY' });
  }
  assert.equal(temporaryCount, 1, 'rejected requests never reach the filesystem');
  assert.deepEqual(store.snapshot(), before, 'overload does not change the theme or persistence state');
  gate.resolve();
  const results = await Promise.all(accepted); await store.flush();
  assert.equal(temporaryCount, MAX_PENDING_APPEARANCE_WRITES);
  assert.deepEqual(committed, themes);
  assert.deepEqual(results.map(result => result.theme), themes);
  assert.ok(results.every(result => result.persistence.persisted));
  assert.equal((await h.open().load()).theme, themes.at(-1));
  assert.equal((await store.set({ theme: 'light' })).persistence.persisted, true, 'capacity becomes available after writes settle');
});

test('closing admission is synchronous and idempotent even before load', async t => {
  const h = await fixture(t), store = h.open();
  store.closeAdmission(); store.closeAdmission();
  assert.throws(() => store.set({ theme: 'light' }), { code: 'APPEARANCE_CLOSED' });
  assert.equal((await store.flush()).theme, 'dark');
  assert.equal((await store.load()).persistence.state, 'default');
  assert.throws(() => store.set({ theme: 'dark' }), { code: 'APPEARANCE_CLOSED' });
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('closed admission makes flush finite while all previously accepted writes remain durable', async t => {
  const h = await fixture(t), store = h.open(), gate = deferred(), entered = deferred();
  const open = fs.open.bind(fs); let held = false, temporaryCount = 0;
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx') {
      temporaryCount++;
      if (!held) {
        held = true;
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { entered.resolve(); await gate.promise; return sync(); };
      }
    }
    return handle;
  });
  const themes = Array.from({ length: MAX_PENDING_APPEARANCE_WRITES }, (_, index) => index % 2 ? 'light' : 'dark');
  const accepted = themes.map(theme => store.set({ theme }));
  await entered.promise;
  store.closeAdmission(); store.closeAdmission();
  let closed = false;
  const closing = store.flush().then(result => { closed = true; return result; });
  for (let index = 0; index < 64; index++) {
    assert.throws(() => store.set({ theme: 'dark' }), { code: 'APPEARANCE_CLOSED' });
  }
  await tick(); assert.equal(closed, false);
  gate.resolve();
  const results = await Promise.all(accepted), final = await closing;
  assert.equal(closed, true); assert.equal(final.theme, themes.at(-1));
  assert.equal(final.persistence.persisted, true);
  assert.deepEqual(results.map(result => result.theme), themes);
  assert.ok(results.every(result => result.persistence.persisted));
  assert.equal(temporaryCount, MAX_PENDING_APPEARANCE_WRITES, 'attempts during close cannot extend the accepted queue');
  assert.throws(() => store.set({ theme: 'light' }), { code: 'APPEARANCE_CLOSED' });
  assert.equal((await h.open().load()).theme, themes.at(-1));
});

for (const [name, data] of [
  ['corrupt JSON', Buffer.from([0x7b, 0xff, 0x00, 0x0a])],
  ['unknown schema', { namespace: APPEARANCE_NAMESPACE, schema: 9, theme: 'light' }],
  ['unknown namespace', { namespace: 'unrelated', schema: 1, theme: 'light' }],
  ['unknown field', { namespace: APPEARANCE_NAMESPACE, schema: 1, theme: 'light', sourceGrant: 'never' }],
  ['unsupported theme', { namespace: APPEARANCE_NAMESPACE, schema: 1, theme: 'system' }],
  ['missing theme', { namespace: APPEARANCE_NAMESPACE, schema: 1 }],
]) {
  test(`${name} falls back without writes; explicit choice archives the exact original`, async t => {
    const h = await fixture(t); await h.write(data);
    const original = await fs.readFile(h.filename), store = h.open();
    const loaded = await store.load();
    assert.equal(loaded.theme, 'dark'); assert.equal(loaded.persistence.state, 'invalid');
    assert.equal(loaded.persistence.persisted, false); assert.match(loaded.notices.join(' '), /preserved.*Choosing a theme explicitly/);
    assert.deepEqual(await fs.readFile(h.filename), original);
    assert.deepEqual(await fs.readdir(h.directory), [APPEARANCE_FILE]);
    const saved = await store.set({ theme: 'light' });
    assert.equal(saved.theme, 'light'); assert.equal(saved.persistence.persisted, true);
    assert.match(saved.notices.join(' '), /archived/);
    const archives = await fs.readdir(path.join(h.directory, 'archives'));
    assert.equal(archives.length, 1); assert.match(archives[0], /^[a-f0-9-]{36}\.json$/);
    const archived = path.join(h.directory, 'archives', archives[0]);
    assert.deepEqual(await fs.readFile(archived), original);
    assert.equal((await fs.stat(archived)).nlink, 1);
    assert.equal((await fs.stat(h.filename)).nlink, 1);
    assert.equal((await h.open().load()).theme, 'light');
    await store.set({ theme: 'dark' });
    assert.deepEqual(await fs.readFile(archived), original);
    assert.deepEqual(await fs.readdir(path.dirname(archived)), archives);
  });
}

test('oversized appearance is never read into memory and is archived without a copy', async t => {
  const h = await fixture(t), original = Buffer.alloc(MAX_APPEARANCE_BYTES + 257, 0x61);
  await h.write(original);
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === h.filename) assert.ok((await fs.stat(file)).size <= MAX_APPEARANCE_BYTES, 'oversized settings must never be opened');
    return open(file, ...args);
  });
  t.mock.method(fs, 'copyFile', async () => assert.fail('recovery must not copy an unbounded original'));
  const store = h.open();
  assert.equal((await store.load()).persistence.state, 'invalid');
  assert.equal((await store.set({ theme: 'light' })).persistence.persisted, true);
  t.mock.restoreAll();
  const archives = await fs.readdir(path.join(h.directory, 'archives'));
  assert.deepEqual(await fs.readFile(path.join(h.directory, 'archives', archives[0])), original);
});

test('an external replacement after load cannot be silently overwritten', async t => {
  const h = await fixture(t), store = h.open();
  await store.set({ theme: 'dark' });
  const replacement = path.join(h.directory, 'external.json'), bytes = Buffer.from(JSON.stringify(h.record('light')));
  await fs.writeFile(replacement, bytes); await fs.rename(replacement, h.filename);
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_CHANGED' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.equal(store.snapshot().theme, 'dark');
  assert.equal(store.snapshot().persistence.state, 'unavailable');
  await assert.rejects(store.set({ theme: 'light' }), { code: 'APPEARANCE_UNAVAILABLE' });
  assert.equal((await h.open().load()).theme, 'light');
});

test('same-file external content edits invalidate the bound observation', async t => {
  const h = await fixture(t), store = h.open();
  await store.set({ theme: 'dark' });
  await fs.writeFile(h.filename, JSON.stringify(h.record('light')));
  const bytes = await fs.readFile(h.filename);
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_CHANGED' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
});

test('two loaded views serialize operations but a stale view cannot overwrite the newer file', async t => {
  const h = await fixture(t), first = h.open(), second = h.open();
  await Promise.all([first.load(), second.load()]);
  const accepted = first.set({ theme: 'light' });
  const stale = assert.rejects(second.set({ theme: 'dark' }), { code: 'APPEARANCE_CHANGED' });
  await accepted; await stale;
  assert.equal((await h.open().load()).theme, 'light');
});

test('hard-linked settings cannot grant write or archive authority', async t => {
  const h = await fixture(t), target = path.join(h.root, 'unrelated.json');
  await fs.mkdir(h.directory); await fs.writeFile(target, JSON.stringify(h.record('light'))); await fs.link(target, h.filename);
  const bytes = await fs.readFile(target), store = h.open();
  assert.equal((await store.load()).persistence.state, 'unavailable');
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_UNAVAILABLE' });
  assert.deepEqual(await fs.readFile(target), bytes); assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.deepEqual(await fs.readdir(h.directory), [APPEARANCE_FILE]);
});

for (const boundary of ['root', 'namespace', 'file']) {
  test(`a simulated symbolic-link observation at the ${boundary} boundary refuses any write`, async t => {
    const h = await fixture(t); await h.write(h.record('light'));
    const bytes = await fs.readFile(h.filename), lstat = fs.lstat.bind(fs);
    const target = boundary === 'root' ? h.root : boundary === 'namespace' ? h.directory : h.filename;
    // This is a deterministic guard observation, not native junction/symlink QA.
    t.mock.method(fs, 'lstat', async (file, ...args) => {
      const stat = await lstat(file, ...args);
      if (file === target) stat.isSymbolicLink = () => true;
      return stat;
    });
    const store = h.open(); assert.equal((await store.load()).persistence.state, 'unavailable');
    await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_UNAVAILABLE' });
    assert.deepEqual(await fs.readFile(h.filename), bytes);
  });
}

test('a replaced namespace after load is rejected before modifying its new contents', async t => {
  const h = await fixture(t), store = h.open(); await store.set({ theme: 'dark' });
  const held = path.join(h.root, 'held-appearance');
  assert.equal(path.dirname(held), h.root); assert.equal(path.dirname(h.directory), h.root);
  await fs.rename(h.directory, held); await h.write(h.record('light'));
  const bytes = await fs.readFile(h.filename);
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_UNSAFE_PATH' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.equal(JSON.parse(await fs.readFile(path.join(held, APPEARANCE_FILE), 'utf8')).theme, 'dark');
});

test('a file changed during its bounded read is never accepted as a persisted preference', async t => {
  const h = await fixture(t); await h.write(h.record('light'));
  const open = fs.open.bind(fs); let injected = false;
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (file === h.filename && !injected) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!injected) { injected = true; await fs.writeFile(h.filename, '{externally changed'); }
        return result;
      };
    }
    return handle;
  });
  const store = h.open();
  assert.equal((await store.load()).persistence.state, 'unavailable');
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_UNAVAILABLE' });
  assert.equal(await fs.readFile(h.filename, 'utf8'), '{externally changed');
});

test('failed temporary writes preserve the prior theme and only clean their owned temporary file', async t => {
  const h = await fixture(t), store = h.open(); await store.set({ theme: 'dark' });
  const bytes = await fs.readFile(h.filename), open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx') handle.writeFile = async () => { throw Object.assign(new Error('Disk is full'), { code: 'ENOSPC' }); };
    return handle;
  });
  const setting = assert.rejects(store.set({ theme: 'light' }), { code: 'ENOSPC' });
  const closed = await store.flush(); await setting;
  assert.equal(closed.theme, 'dark'); assert.equal(closed.persistence.state, 'unavailable');
  assert.equal(closed.persistence.persisted, false); assert.match(closed.notices.join(' '), /not confirmed saved/);
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.deepEqual(await fs.readdir(h.directory), [APPEARANCE_FILE]);
  t.mock.restoreAll(); assert.equal((await store.set({ theme: 'light' })).persistence.persisted, true);
});

test('failed fsync never renames an unconfirmed temporary record', async t => {
  const h = await fixture(t), store = h.open(), open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (mode === 'wx') handle.sync = async () => { throw Object.assign(new Error('Sync unavailable'), { code: 'EIO' }); };
    return handle;
  });
  t.mock.method(fs, 'rename', async () => assert.fail('unsynced appearance must not be published'));
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EIO' });
  assert.equal(store.snapshot().theme, 'dark'); assert.equal(store.snapshot().persistence.persisted, false);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('failed rename preserves the previous file and allows a safe subsequent save', async t => {
  const h = await fixture(t), store = h.open(); await store.set({ theme: 'dark' });
  const bytes = await fs.readFile(h.filename);
  t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('Write denied'), { code: 'EACCES' }); });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EACCES' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.deepEqual(await fs.readdir(h.directory), [APPEARANCE_FILE]);
  t.mock.restoreAll(); assert.equal((await store.set({ theme: 'light' })).theme, 'light');
});

test('post-rename observation failure never falsely confirms persistence', async t => {
  const h = await fixture(t), store = h.open(); await store.set({ theme: 'dark' });
  const rename = fs.rename.bind(fs), lstat = fs.lstat.bind(fs); let renamed = false;
  t.mock.method(fs, 'rename', async (...args) => { await rename(...args); renamed = true; });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (renamed && file === h.filename) throw Object.assign(new Error('Readback denied'), { code: 'EACCES' });
    return lstat(file, ...args);
  });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EACCES' });
  assert.equal(store.snapshot().theme, 'dark'); assert.equal(store.snapshot().persistence.persisted, false);
  assert.match(store.snapshot().notices.join(' '), /may have been saved/);
  t.mock.restoreAll();
  await assert.rejects(store.set({ theme: 'dark' }), { code: 'APPEARANCE_UNAVAILABLE' });
  assert.equal((await h.open().load()).theme, 'light', 'the possibly committed file remains available for restart review');
});

test('archive creation failure leaves the corrupt original untouched', async t => {
  const h = await fixture(t); await h.write('{corrupt'); const store = h.open(); await store.load();
  const bytes = await fs.readFile(h.filename);
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('Archive denied'), { code: 'EACCES' }); });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EACCES' });
  assert.deepEqual(await fs.readFile(h.filename), bytes); assert.equal((await fs.stat(h.filename)).nlink, 1);
  t.mock.restoreAll(); assert.equal((await store.set({ theme: 'light' })).theme, 'light');
});

test('failed recovery rename removes only its still-bound duplicate archive and keeps the original', async t => {
  const h = await fixture(t); await h.write('{corrupt'); const store = h.open(); await store.load();
  const bytes = await fs.readFile(h.filename);
  t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('Rename denied'), { code: 'EACCES' }); });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EACCES' });
  assert.deepEqual(await fs.readFile(h.filename), bytes); assert.equal((await fs.stat(h.filename)).nlink, 1);
  assert.deepEqual(await fs.readdir(path.join(h.directory, 'archives')), []);
  t.mock.restoreAll(); assert.equal((await store.set({ theme: 'light' })).theme, 'light');
});

test('an uncertain recovery archive is retained and further writes refuse truthfully', async t => {
  const h = await fixture(t); await h.write('{corrupt'); const store = h.open(); await store.load();
  const bytes = await fs.readFile(h.filename), directory = path.join(h.directory, 'archives'), lstat = fs.lstat.bind(fs);
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (path.dirname(file) === directory) throw Object.assign(new Error('Archive identity unavailable'), { code: 'EACCES' });
    return lstat(file, ...args);
  });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'EACCES' });
  assert.match(store.snapshot().notices.join(' '), /Both names were preserved/);
  t.mock.restoreAll();
  const archives = await fs.readdir(directory); assert.equal(archives.length, 1);
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.deepEqual(await fs.readFile(path.join(directory, archives[0])), bytes);
  assert.equal((await fs.stat(h.filename)).nlink, 2);
  await assert.rejects(store.set({ theme: 'light' }), { code: 'APPEARANCE_UNAVAILABLE' });
  assert.equal((await h.open().load()).persistence.state, 'unavailable');
});

test('a substituted temporary file is preserved and cannot be published or cleaned as ours', async t => {
  const h = await fixture(t), store = h.open(); await store.set({ theme: 'dark' });
  const bytes = await fs.readFile(h.filename), replacement = path.join(h.root, 'external-temporary'), lstat = fs.lstat.bind(fs);
  await fs.writeFile(replacement, 'external bytes'); let substituted;
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (!substituted && path.dirname(file) === h.directory && file.endsWith('.tmp')) {
      substituted = file; await fs.rename(replacement, file);
    }
    return lstat(file, ...args);
  });
  await assert.rejects(store.set({ theme: 'light' }), { code: 'APPEARANCE_CHANGED' });
  assert.deepEqual(await fs.readFile(h.filename), bytes);
  assert.equal(await fs.readFile(substituted, 'utf8'), 'external bytes');
});

test('invalid constructor paths reject without filesystem mutations', async t => {
  const h = await fixture(t);
  for (const directory of ['', 'relative', null, `${h.root}\u0000`, '\\\\?\\C:\\owned', '\\\\.\\C:\\owned']) {
    assert.throws(() => new AppearanceSettings({ directory }), TypeError);
  }
  assert.deepEqual(await fs.readdir(h.root), []);
});
