'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { OutputAccess } = require('../src/output-access.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');

const parent = path.resolve(__dirname, '../artifacts/output-access-unit-tests');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.match(path.basename(actual), /^case-/);
    await fs.rm(actual, { recursive: true });
  });
  const calls = [];
  const callbacks = {
    openPath: async file => { calls.push(['open', file]); return ''; },
    showItemInFolder: file => { calls.push(['reveal', file]); }
  };
  const create = async (name = 'published.mkv') => {
    const file = path.join(root, name);
    await fs.writeFile(file, Buffer.alloc(2048, 0x61), { flag: 'wx' });
    const identity = await readSourceIdentity(file);
    return { file: identity.canonicalPath, identity };
  };
  return { root, create, calls, callbacks, access: extra => new OutputAccess({ ...callbacks, ...extra }) };
}

test('tokens open or reveal only their exact canonical completed media path', async t => {
  const h = await fixture(t), access = h.access();
  for (const name of ['a.mkv', 'unicode Ω [1] & motion.MP4', 'b.mov']) {
    const published = await h.create(name), token = await access.issue(published);
    assert.deepEqual(Object.keys(token), ['outputId']);
    assert.match(token.outputId, uuid);
    for (const action of ['open', 'reveal']) {
      assert.deepEqual(await access.action({ ...token, action }), { ...token, action, dispatched: true });
      assert.deepEqual(h.calls.at(-1), [action, published.file]);
    }
  }
  assert.equal(h.calls.length, 6);
});

test('issuance and action reject non-data payloads and extra authority before reading paths', async t => {
  const h = await fixture(t), published = await h.create(), access = h.access();
  const identityGetter = { file: published.file };
  Object.defineProperty(identityGetter, 'identity', { enumerable: true, get() { assert.fail('getter ran'); } });
  const badIdentity = { ...published.identity };
  Object.defineProperty(badIdentity, 'ctimeNs', { enumerable: true, get() { assert.fail('identity getter ran'); } });
  for (const value of [null, [], {}, identityGetter, { ...published, command: 'cmd.exe' },
    { ...published, identity: badIdentity }, { ...published, identity: { ...published.identity, path: published.file } },
    { ...published, identity: { ...published.identity, sparseDigest: 'not-a-digest' } },
    { ...published, identity: { ...published.identity, dev: '0' } },
    { ...published, identity: { ...published.identity, ino: '0' } },
    { ...published, identity: { ...published.identity, size: '9007199254740992' } },
    { ...published, [Symbol('hidden')]: 1 }, Object.assign(Object.create({ unsafe: true }), published)]) {
    await assert.rejects(access.issue(value), { code: 'INVALID_OUTPUT_ACCESS' });
  }
  const token = await access.issue(published);
  const getter = { outputId: token.outputId };
  Object.defineProperty(getter, 'action', { enumerable: true, get() { assert.fail('action getter ran'); } });
  for (const value of [null, [], {}, getter, { ...token, action: 'execute' },
    { ...token, action: 'open', file: published.file }, { ...token, action: 'open', url: 'file:///c:/cmd.exe' },
    { outputId: published.file, action: 'open' }, { outputId: token.outputId.toUpperCase(), action: 'open' },
    { ...token, action: 'open', [Symbol('hidden')]: true }]) {
    await assert.rejects(access.action(value), { code: 'INVALID_OUTPUT_ACCESS' });
  }
  await assert.rejects(access.action({ outputId: randomUUID(), action: 'open' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  assert.deepEqual(h.calls, []);
});

test('unsafe namespaces, extensions, aliases and unbounded paths receive no filesystem operation', async t => {
  const h = await fixture(t), published = await h.create();
  let observed = 0;
  const access = h.access({ io: { lstat() { observed++; assert.fail('unsafe path reached filesystem'); } } });
  const names = ['movie.exe', 'movie.mkv.exe', 'movie.mkv:stream.mkv', 'NUL.mkv', 'movie\n.mkv',
    'COM1.mkv', 'LPT9.mp4', 'a?.mkv'];
  const files = names.map(name => path.join(h.root, name));
  files.push('relative.mkv', 'https://example.com/a.mp4', `${h.root}${path.sep}..${path.sep}movie.mkv`,
    path.join(h.root, 'bad. ', 'movie.mkv'), path.join(h.root, ...Array(130).fill('folder'), 'movie.mkv'),
    'x'.repeat(32761));
  if (process.platform === 'win32') files.push('\\\\host\\share\\movie.mkv', '\\\\?\\C:\\movie.mkv', 'C:movie.mkv');
  for (const file of files) await assert.rejects(access.issue({ file, identity: { ...published.identity, canonicalPath: file } }), { code: 'INVALID_OUTPUT_ACCESS' });
  assert.equal(observed, 0); assert.deepEqual(h.calls, []);
});

test('issuance coalesces identical pending requests and snapshots caller-owned data', async t => {
  const h = await fixture(t), published = await h.create(), access = h.access();
  const request = { ...published, identity: { ...published.identity } };
  const first = access.issue(request), second = access.issue(published);
  assert.equal(first, second);
  request.file = path.join(h.root, 'arbitrary.exe'); request.identity.ctimeNs = '-1';
  const token = await first;
  assert.deepEqual(await access.issue(published), token);
  await access.action({ ...token, action: 'open' });
  assert.deepEqual(h.calls, [['open', published.file]]);
});

test('identical concurrent actions dispatch once; a later action rechecks then dispatches', async t => {
  const h = await fixture(t), published = await h.create(), entered = deferred(), done = deferred();
  let dispatches = 0, reads = 0;
  const access = h.access({ readIdentity: async file => { reads++; return readSourceIdentity(file); },
    openPath: async file => { assert.equal(file, published.file); dispatches++; entered.resolve(); await done.promise; return ''; } });
  const token = await access.issue(published), request = { ...token, action: 'open' };
  const first = access.action(request), second = access.action(request);
  assert.equal(first, second);
  request.action = 'reveal'; request.outputId = randomUUID();
  await entered.promise; assert.equal(dispatches, 1); done.resolve();
  await first;
  await access.action({ ...token, action: 'open' });
  assert.equal(dispatches, 2); assert.equal(reads, 2);
});

test('all identity fields including ctime remain strict and revoke changed tokens', async t => {
  const h = await fixture(t), published = await h.create();
  for (const field of Object.keys(published.identity)) {
    const actual = { ...published.identity, [field]: field === 'canonicalPath' ? `${published.file}.mkv`
      : field === 'sparseDigest' ? `sha256-sparse-v1:${'0'.repeat(64)}` : String(BigInt(published.identity[field]) + 1n) };
    const access = h.access({ readIdentity: async () => actual });
    const token = await access.issue(published);
    await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
    await assert.rejects(access.action({ ...token, action: 'reveal' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  }
  assert.deepEqual(h.calls, []);
});

test('real replacement, modification and deletion refuse dispatch', async t => {
  const h = await fixture(t);
  for (const mutation of ['modify', 'replace', 'delete']) {
    const published = await h.create(`${mutation}.mkv`), access = h.access(), token = await access.issue(published);
    if (mutation === 'modify') await fs.appendFile(published.file, 'changed');
    else {
      await fs.unlink(published.file);
      if (mutation === 'replace') await fs.writeFile(published.file, Buffer.alloc(2048, 0x62));
    }
    await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
  }
  assert.deepEqual(h.calls, []);
});

test('links, reparse-like ancestors, redirected names and replaced directory objects fail closed', async t => {
  const h = await fixture(t), published = await h.create();
  for (const kind of ['final-link', 'parent-link', 'hard-link', 'redirected', 'parent-replaced', 'parent-birthtime']) {
    let alter = false;
    const io = {
      async lstat(file, options) {
        const stat = await fs.lstat(file, options);
        if (!alter) return stat;
        if ((kind === 'final-link' && file === published.file) || (kind === 'parent-link' && file === h.root)) stat.isSymbolicLink = () => true;
        if (kind === 'hard-link' && file === published.file) stat.nlink = 2n;
        if (kind === 'parent-replaced' && file === h.root) stat.ino += 1n;
        if (kind === 'parent-birthtime' && file === h.root) stat.birthtimeNs += 1n;
        return stat;
      },
      async realpath(file) { const canonical = await fs.realpath(file); return alter && kind === 'redirected' ? `${canonical}.mkv` : canonical; }
    };
    const access = h.access({ io }), token = await access.issue(published); alter = true;
    await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
    // A new trusted issuance may bind a new ordinary parent object. Unlike
    // the old token, that is legitimate new main-owned authority.
    if (kind === 'parent-replaced' || kind === 'parent-birthtime') assert.notEqual((await access.issue(published)).outputId, token.outputId);
    else await assert.rejects(access.issue(published), { code: 'OUTPUT_ACCESS_CHANGED' });
  }
  assert.deepEqual(h.calls, []);
});

test('a filesystem change during identity sampling is detected by the final name check', async t => {
  const h = await fixture(t), published = await h.create();
  const access = h.access({ readIdentity: async file => {
    const captured = await readSourceIdentity(file);
    await fs.appendFile(file, 'after sampling'); return captured;
  } });
  const token = await access.issue(published);
  await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
  assert.deepEqual(h.calls, []);
});

test('publication hard-link cleanup requires a fresh post-cleanup identity', async t => {
  const h = await fixture(t), published = await h.create(), access = h.access();
  const stage = path.join(h.root, 'owned-publication-stage.mkv');
  await fs.link(published.file, stage);
  const linked = { file: published.file, identity: await readSourceIdentity(published.file) };
  await assert.rejects(access.issue(linked), { code: 'OUTPUT_ACCESS_CHANGED' });
  await fs.unlink(stage);
  const cleaned = { file: published.file, identity: await readSourceIdentity(published.file) };
  // The publication stage's link removal changes ctime on the supported NTFS
  // workflow. A stale pre-cleanup identity never gets relaxed to compensate.
  if (linked.identity.ctimeNs !== cleaned.identity.ctimeNs) await assert.rejects(access.issue(linked), { code: 'OUTPUT_ACCESS_CHANGED' });
  const token = await access.issue(cleaned);
  await access.action({ ...token, action: 'open' });
  assert.deepEqual(h.calls, [['open', published.file]]);
});

test('failed shell association and thrown failures are honest, bounded and retryable', async t => {
  const h = await fixture(t), published = await h.create();
  let result = 'No associated application. ' + 'x'.repeat(3000);
  const access = h.access({ openPath: async () => result });
  const token = await access.issue(published);
  await assert.rejects(access.action({ ...token, action: 'open' }), error => error.code === 'OUTPUT_OPEN_FAILED' && error.message.length < 1600);
  result = undefined;
  await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_OPEN_FAILED' });
  result = '';
  assert.equal((await access.action({ ...token, action: 'open' })).dispatched, true);
  for (const action of ['open', 'reveal']) {
    for (const cause of [new Error('shell failed'), null, 'failure']) {
      const failing = h.access({ [action === 'open' ? 'openPath' : 'showItemInFolder']: async () => { throw cause; } });
      const issued = await failing.issue(published);
      await assert.rejects(failing.action({ ...issued, action }), { code: action === 'open' ? 'OUTPUT_OPEN_FAILED' : 'OUTPUT_REVEAL_FAILED' });
    }
  }
  const invalidReveal = h.access({ showItemInFolder: () => false });
  await assert.rejects(invalidReveal.action({ ...await invalidReveal.issue(published), action: 'reveal' }), { code: 'OUTPUT_REVEAL_FAILED' });
});

test('a failed identity observer refuses access even when it throws a non-Error', async t => {
  const h = await fixture(t), published = await h.create();
  const access = h.access({ readIdentity: async () => { throw null; } }), token = await access.issue(published);
  await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
  assert.deepEqual(h.calls, []);
});

test('clear and a new service instance do not restore token authority', async t => {
  const h = await fixture(t), published = await h.create(), access = h.access(), token = await access.issue(published);
  assert.deepEqual(access.clear(), { revoked: 1 });
  assert.deepEqual(access.clear(), { revoked: 0 });
  await assert.rejects(access.action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  await assert.rejects(h.access().action({ ...token, action: 'open' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  const fresh = await access.issue(published);
  assert.notEqual(fresh.outputId, token.outputId);
  await access.action({ ...fresh, action: 'open' });
});

test('clear during an in-flight verification prevents any later dispatch', async t => {
  const h = await fixture(t), published = await h.create(), entered = deferred(), continueRead = deferred();
  const access = h.access({ readIdentity: async file => { entered.resolve(); await continueRead.promise; return readSourceIdentity(file); } });
  const token = await access.issue(published), pending = access.action({ ...token, action: 'open' });
  const checked = assert.rejects(pending, { code: 'OUTPUT_ACCESS_EXPIRED' });
  await entered.promise; access.clear(); continueRead.resolve(); await checked;
  assert.deepEqual(h.calls, []);
});

test('clear during token issuance cannot publish an old generation grant', async t => {
  const h = await fixture(t), published = await h.create(), entered = deferred(), proceed = deferred();
  let first = true;
  const access = h.access({ io: { ...fs, async lstat(file, options) {
    if (first) { first = false; entered.resolve(); await proceed.promise; }
    return fs.lstat(file, options);
  } } });
  const pending = access.issue(published), checked = assert.rejects(pending, { code: 'OUTPUT_ACCESS_EXPIRED' });
  await entered.promise; access.clear(); const fresh = access.issue(published); proceed.resolve(); await checked;
  await access.action({ ...await fresh, action: 'open' }); assert.equal(h.calls.length, 1);
});

test('bounded grants evict old tokens and same-file fresh identities replace old authority', async t => {
  const h = await fixture(t), access = h.access({ maxEntries: 2 });
  const a = await h.create('a.mkv'), b = await h.create('b.mp4'), c = await h.create('c.mov');
  const first = await access.issue(a), second = await access.issue(b), third = await access.issue(c);
  await assert.rejects(access.action({ ...first, action: 'open' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  await access.action({ ...second, action: 'open' }); await access.action({ ...third, action: 'reveal' });
  await fs.appendFile(c.file, 'changed');
  const replaced = await access.issue({ file: c.file, identity: await readSourceIdentity(c.file) });
  assert.notEqual(replaced.outputId, third.outputId);
  await assert.rejects(access.action({ ...third, action: 'open' }), { code: 'OUTPUT_ACCESS_EXPIRED' });
  await access.action({ ...replaced, action: 'open' });
});

test('pending issuance and actions remain bounded even across grant eviction', async t => {
  const h = await fixture(t), a = await h.create('a.mkv'), b = await h.create('b.mkv');
  const proceed = deferred(), entered = deferred(); let block = true;
  const access = h.access({ maxEntries: 1, io: { ...fs, async lstat(file, options) {
    if (block) { block = false; entered.resolve(); await proceed.promise; } return fs.lstat(file, options);
  } } });
  const first = access.issue(a); await entered.promise;
  await assert.rejects(access.issue(b), { code: 'OUTPUT_ACCESS_BUSY' });
  assert.equal(access.issue(a), first); proceed.resolve(); await first;

  const openEntered = deferred(), revealEntered = deferred(), shellDone = deferred();
  const busy = h.access({ maxEntries: 1,
    openPath: async () => { openEntered.resolve(); await shellDone.promise; return ''; },
    showItemInFolder: async () => { revealEntered.resolve(); await shellDone.promise; }
  });
  const token = await busy.issue(a);
  const opened = busy.action({ ...token, action: 'open' }), revealed = busy.action({ ...token, action: 'reveal' });
  await Promise.all([openEntered.promise, revealEntered.promise]);
  const next = await busy.issue(b);
  await assert.rejects(busy.action({ ...next, action: 'open' }), { code: 'OUTPUT_ACCESS_BUSY' });
  shellDone.resolve(); await Promise.all([opened, revealed]);
  await busy.action({ ...next, action: 'open' });
});

test('constructor enforces bounded main-owned dependencies', () => {
  for (const maxEntries of [0, -1, 4097, Infinity, '12']) assert.throws(() => new OutputAccess({ openPath() {}, showItemInFolder() {}, maxEntries }), TypeError);
  assert.throws(() => new OutputAccess(), TypeError);
  assert.throws(() => new OutputAccess({ openPath() {}, showItemInFolder() {}, readIdentity: 'renderer' }), TypeError);
});
