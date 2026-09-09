'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { InspectionCache, CACHE_NAMESPACE, CACHE_LIMITS } = require('../src/inspection-cache.cjs');
const { inspectInput, INSPECTION_POLICY } = require('../src/inspection.cjs');

const runtimeHash = 'a'.repeat(64);
const file = 'D:\\media\\input.mkv';
const identity = (number = 0) => ({ canonicalPath: `${file}.${number}`, dev: '1', ino: String(number + 1), size: '1000', mtimeNs: '123456789000000001', ctimeNs: '123456789000000002', birthtimeNs: '123456789000000003', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` });
const hash = text => createHash('sha256').update(text).digest('hex');
const filename = (cache, value = identity()) => path.join(cache.directory,
  `${hash(JSON.stringify({ namespace: CACHE_NAMESPACE, ffprobeHash: cache.ffprobeHash, policy: INSPECTION_POLICY, identity: value }))}.json`);

async function fixture(t) {
  const base = path.resolve(__dirname, '../artifacts/inspection-cache-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  t.after(async () => {
    const relative = path.relative(base, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, cache: new InspectionCache({ directory: root, ffprobeHash: runtimeHash }) };
}

async function inspection({ seconds = 20, transfer = 'bt709', frameTransfer = transfer, failWindow = -1, extraTags = {} } = {}) {
  const probe = {
    streams: [{ index: 3, codec_type: 'video', codec_name: 'hevc', width: 320, height: 180, pix_fmt: 'yuv420p10le',
      color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv',
      disposition: { default: 1 }, tags: { title: 'Original video' }, avg_frame_rate: '30/1', r_frame_rate: '30/1' },
    { index: 5, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, tags: { language: 'ara' }, disposition: { default: 1 } },
    { index: 7, codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'font.ttf', mimetype: 'application/x-truetype-font' }, extradata_hash: `SHA256:${'c'.repeat(64)}`, extradata_size: 100 }],
    format: { duration: String(seconds), tags: { title: 'Archive sample', ...extraTags } },
    chapters: [{ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: { title: 'Opening' } }],
  };
  let count = 0;
  const run = async (_, args) => {
    if (!args.includes('-show_frames')) return { stdout: JSON.stringify(probe), stderr: '' };
    const window = count++;
    const time = [0, seconds / 2, seconds - 2][window];
    return { stdout: JSON.stringify({ frames: [{ media_type: 'video', stream_index: 3, best_effort_timestamp_time: String(time), color_transfer: frameTransfer }] }), stderr: window === failWindow ? 'Frame decode failed' : '' };
  };
  return inspectInput(file, { ffprobe: 'D:\\app\\ffprobe.exe', run });
}

async function alterRecord(cache, mutate, { checksum = true } = {}) {
  const target = filename(cache);
  const record = JSON.parse(await fs.readFile(target, 'utf8'));
  mutate(record);
  if (checksum) {
    const { checksum: previous, ...body } = record;
    record.checksum = hash(JSON.stringify(body));
  }
  await fs.writeFile(target, JSON.stringify(record));
}

test('cold and hot cache reconstruct identical preservation/color evidence and isolate caller mutation', async t => {
  const { root, cache } = await fixture(t);
  const fresh = await inspection();
  assert.equal(await cache.lookup(identity()), null);
  assert.equal(await cache.store(identity(), { ...fresh, color: { supported: false }, summary: { bad: true } }), true);
  const hot = await cache.lookup(identity());
  assert.deepEqual(hot, fresh);
  hot.probe.streams[0].color_transfer = 'smpte2084';
  hot.evidence.windows.length = 0;
  assert.deepEqual(await cache.lookup(identity()), fresh);
  const cold = new InspectionCache({ directory: root, ffprobeHash: runtimeHash });
  assert.deepEqual(await cold.lookup(identity()), fresh);
  const record = JSON.parse(await fs.readFile(filename(cache), 'utf8'));
  assert.deepEqual(Object.keys(record.payload), ['probe', 'evidence']);
  assert.equal(record.payload.color, undefined);
  assert.equal(record.payload.probe.format.filename, undefined);
});

test('identity, runtime, namespace and policy changes cannot reuse old decisions', async t => {
  const { root, cache } = await fixture(t);
  await cache.store(identity(), await inspection());
  for (const key of Object.keys(identity())) {
    const changed = identity();
    changed[key] = key === 'canonicalPath' ? `${changed[key]}-renamed` : key === 'sparseDigest' ? `sha256-sparse-v1:${'d'.repeat(64)}` : `${changed[key]}1`;
    assert.equal(await cache.lookup(changed), null, key);
  }
  assert.equal(await new InspectionCache({ directory: root, ffprobeHash: 'f'.repeat(64) }).lookup(identity()), null);
  for (const mutate of [record => { record.policy.color++; }, record => { record.namespace = 'inspection-v0'; }, record => { record.version = 0; }]) {
    await cache.store(identity(), await inspection());
    await alterRecord(cache, mutate);
    assert.equal(await new InspectionCache({ directory: root, ffprobeHash: runtimeHash }).lookup(identity()), null);
  }
});

test('malformed JSON, checksum damage and normalized-schema violations are misses', async t => {
  const { root, cache } = await fixture(t);
  const fresh = await inspection();
  const cold = () => new InspectionCache({ directory: root, ffprobeHash: runtimeHash });
  await cache.store(identity(), fresh);
  await fs.writeFile(filename(cache), '{bad');
  assert.equal(await cold().lookup(identity()), null);
  for (const mutate of [
    record => { record.payload.color = { supported: true }; },
    record => { record.payload.probe.filename = 'D:\\unrelated\\victim.mkv'; },
    record => { record.payload.probe.streams[0].index = -1; },
    record => { record.payload.evidence.windows[1].frames[0].best_effort_timestamp_time = '0'; },
    record => { record.payload.evidence.windows.pop(); },
    record => { record.payload.evidence.mode = 'metadata-hdr'; record.payload.evidence.windows = []; },
    record => { record.payload.probe.streams[0].color_transfer = 'unknown'; record.payload.evidence.windows.forEach(window => { window.frames[0].color_transfer = 'unknown'; }); },
    record => { record.payload.probe.format.tags = JSON.parse('{"__proto__":{"polluted":true}}'); },
    record => { record.payload.probe.streams[0].width = { deeply: { invalid: true } }; },
  ]) {
    await cache.store(identity(), fresh);
    await alterRecord(cache, mutate);
    const reader = cold();
    assert.equal(await reader.lookup(identity()), null);
    assert.ok(reader.warning);
  }
  await cache.store(identity(), fresh);
  await alterRecord(cache, record => { record.payload.probe.format.tags.title = 'Changed'; }, { checksum: false });
  assert.equal(await cold().lookup(identity()), null);
  assert.equal({}.polluted, undefined);
});

test('definite metadata HDR and complete decoded HDR cache, failed/unknown/incomplete samples do not', async t => {
  const { root, cache } = await fixture(t);
  for (const fresh of [await inspection({ transfer: 'smpte2084' }), await inspection({ frameTransfer: 'arib-std-b67' })]) {
    assert.equal(await cache.store(identity(), fresh), true);
    assert.deepEqual(await new InspectionCache({ directory: root, ffprobeHash: runtimeHash }).lookup(identity()), fresh);
  }
  for (const fresh of [await inspection({ failWindow: 1 }), await inspection({ failWindow: 0, frameTransfer: 'smpte2084' }), await inspection({ transfer: 'unknown' })]) {
    fresh.color = { classification: 'sdr', supported: true };
    fresh.summary.sampling = [{ succeeded: true }];
    assert.equal(await cache.store(identity(1), fresh), false);
    assert.equal(await cache.lookup(identity(1)), null);
  }
  const missing = await inspection();
  missing.evidence.windows = [];
  assert.equal(await cache.store(identity(1), missing), false);
  assert.equal(await cache.store(identity(1), { probe: missing.probe, color: { supported: true } }), false);
});

test('oversized and excessive-complexity records are rejected before unbounded parsing', async t => {
  const { root, cache } = await fixture(t);
  const fresh = await inspection();
  await cache.store(identity(), fresh);
  const handle = await fs.open(filename(cache), 'w');
  await handle.truncate(CACHE_LIMITS.recordBytes + 1);
  await handle.close();
  assert.equal(await new InspectionCache({ directory: root, ffprobeHash: runtimeHash }).lookup(identity()), null);
  const large = structuredClone(fresh);
  large.probe.format.tags.large = 'x'.repeat(CACHE_LIMITS.recordBytes);
  assert.equal(await cache.store(identity(2), large), false);
  const usableLarge = await inspection({ extraTags: { large: 'x'.repeat(CACHE_LIMITS.recordBytes) } });
  assert.equal(usableLarge.color.supported, true);
  assert.equal(usableLarge.probe.format.tags.large.length, CACHE_LIMITS.recordBytes);
  assert.equal(await cache.store(identity(2), usableLarge), false);
  const complex = structuredClone(fresh);
  complex.evidence.extra = {};
  let cursor = complex.evidence.extra;
  for (let index = 0; index < 30; index++) { cursor.next = {}; cursor = cursor.next; }
  assert.equal(await cache.store(identity(2), complex), false);
  const cycle = structuredClone(fresh);
  cycle.evidence.cycle = cycle.evidence;
  assert.equal(await cache.store(identity(2), cycle), false);
});

test('unwritable namespace and full-disk writes fail open without incomplete publication', async t => {
  const { root, cache } = await fixture(t);
  const fresh = await inspection();
  await fs.writeFile(cache.directory, 'not a cache directory');
  assert.equal(await cache.store(identity(), fresh), false);
  assert.equal(await cache.lookup(identity()), null);
  assert.ok(cache.warning);
  await fs.unlink(cache.directory);
  const realOpen = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    if (String(args[0]).endsWith('.tmp')) throw Object.assign(new Error('No space left'), { code: 'ENOSPC' });
    return realOpen(...args);
  });
  assert.equal(await cache.store(identity(), fresh), false);
  assert.deepEqual(await fs.readdir(cache.directory), []);
  assert.deepEqual(fresh.color, (await inspection()).color);
  assert.equal(await new InspectionCache({ directory: root, ffprobeHash: runtimeHash }).lookup(identity()), null);
});

test('disk entry cap evicts oldest cache records and clear preserves unrelated/provenance files', async t => {
  const { root, cache } = await fixture(t);
  await fs.mkdir(cache.directory);
  for (let index = 0; index < CACHE_LIMITS.diskEntries; index++) {
    const target = path.join(cache.directory, `${index.toString(16).padStart(64, '0')}.json`);
    await fs.writeFile(target, '{}');
    await fs.utimes(target, new Date(index * 1000), new Date(index * 1000));
  }
  await fs.writeFile(path.join(cache.directory, 'keep.txt'), 'not a record');
  await fs.mkdir(path.join(root, 'provenance-v1'));
  await fs.writeFile(path.join(root, 'provenance-v1', 'index.json'), 'preserve provenance');
  assert.equal(await cache.store(identity(), await inspection()), true);
  const records = (await fs.readdir(cache.directory)).filter(name => name.endsWith('.json'));
  assert.equal(records.length, CACHE_LIMITS.diskEntries);
  assert.equal(records.includes(`${'0'.repeat(64)}.json`), false);
  assert.equal(await cache.clear(), true);
  assert.deepEqual(cache.stats, { hotEntries: 0, hotBytes: 0 });
  assert.deepEqual(await fs.readdir(cache.directory), ['keep.txt']);
  assert.equal(await fs.readFile(path.join(root, 'provenance-v1', 'index.json'), 'utf8'), 'preserve provenance');
});

test('disk byte cap accounts for existing files before atomic cache publication', async t => {
  const { cache } = await fixture(t);
  await fs.mkdir(cache.directory);
  for (let index = 0; index < 33; index++) {
    const target = path.join(cache.directory, `${index.toString(16).padStart(64, '0')}.json`);
    const handle = await fs.open(target, 'wx');
    await handle.truncate(CACHE_LIMITS.recordBytes);
    await handle.close();
  }
  assert.equal(await cache.store(identity(), await inspection()), true);
  const names = await fs.readdir(cache.directory);
  const bytes = (await Promise.all(names.map(name => fs.stat(path.join(cache.directory, name))))).reduce((total, stat) => total + stat.size, 0);
  assert.ok(bytes <= CACHE_LIMITS.diskBytes);
  assert.ok(names.every(name => !name.endsWith('.tmp')));
});

test('hot cache uses LRU entry and byte caps', async t => {
  const { cache } = await fixture(t);
  const fresh = await inspection();
  for (let index = 0; index < CACHE_LIMITS.hotEntries; index++) assert.equal(await cache.store(identity(index), fresh), true);
  await cache.lookup(identity(0));
  await cache.store(identity(CACHE_LIMITS.hotEntries), fresh);
  assert.equal(cache.stats.hotEntries, CACHE_LIMITS.hotEntries);
  await fs.unlink(filename(cache, identity(1)));
  assert.equal(await cache.lookup(identity(1)), null);
  await fs.unlink(filename(cache, identity(0)));
  assert.deepEqual(await cache.lookup(identity(0)), fresh);
  await cache.clear();
  const extraTags = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`long${index}`, 'x'.repeat(200000)]));
  const large = await inspection({ extraTags });
  for (let index = 0; index < 9; index++) assert.equal(await cache.store(identity(index), large), true);
  assert.ok(cache.stats.hotBytes <= CACHE_LIMITS.hotBytes);
  assert.ok(cache.stats.hotEntries < 9);
  await fs.unlink(filename(cache, identity(0)));
  assert.equal(await cache.lookup(identity(0)), null);
});

test('invalid identities never become filesystem paths and clear is serialized after writes', async t => {
  const { cache } = await fixture(t);
  const fresh = await inspection();
  assert.equal(await cache.store({ ...identity(), canonicalPath: '../../outside' }, fresh), false);
  assert.equal(await cache.lookup({ ...identity(), sparseDigest: '../outside' }), null);
  assert.equal(await cache.store({ ...identity(), sparseDigest: 'b'.repeat(64) }, fresh), false);
  assert.equal(await cache.store({ ...identity(), sparseDigest: `sha256-sparse-v2:${'b'.repeat(64)}` }, fresh), false);
  const written = cache.store(identity(), fresh);
  const cleared = cache.clear();
  assert.equal(await written, true);
  assert.equal(await cleared, true);
  assert.equal(await cache.lookup(identity()), null);
});

// Observe the public lookup boundary while retaining real file handles. In
// particular, swallowing optional LRU errors must not hide a pathname write.
function watchTouches(t, target, { beforeOpen, openedStat } = {}) {
  const originalOpen = fs.open;
  const originalUtimes = fs.utimes;
  const calls = { pathname: 0, opened: 0, touched: 0, closed: 0 };
  t.mock.method(fs, 'utimes', async (file, ...args) => {
    if (file === target) calls.pathname++;
    return originalUtimes(file, ...args);
  });
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    if (file !== target || flags !== 'r+') return originalOpen(file, flags, ...args);
    calls.opened++;
    await beforeOpen?.();
    const handle = await originalOpen(file, flags, ...args);
    const originalStat = handle.stat.bind(handle);
    const originalTouch = handle.utimes.bind(handle);
    const originalClose = handle.close.bind(handle);
    if (openedStat) t.mock.method(handle, 'stat', async (...options) => openedStat(await originalStat(...options)));
    t.mock.method(handle, 'utimes', async (...times) => { calls.touched++; return originalTouch(...times); });
    t.mock.method(handle, 'close', async () => { calls.closed++; return originalClose(); });
    return handle;
  });
  return calls;
}

async function timestamp(file) {
  const stat = await fs.stat(file, { bigint: true });
  return { atimeNs: stat.atimeNs, mtimeNs: stat.mtimeNs };
}

async function oldTimestamp(file) {
  await fs.utimes(file, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
  return timestamp(file);
}

for (const mode of ['hot', 'disk']) {
  async function populated(t) {
    const { root, cache } = await fixture(t);
    const fresh = await inspection();
    assert.equal(await cache.store(identity(), fresh), true);
    const reader = mode === 'hot' ? cache : new InspectionCache({ directory: root, ffprobeHash: runtimeHash });
    return { root, reader, fresh, target: filename(cache) };
  }

  test(`${mode} hit updates a regular owned record only through its checked handle`, async t => {
    const { reader, fresh, target } = await populated(t);
    const before = await oldTimestamp(target);
    const calls = watchTouches(t, target);
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.deepEqual(calls, { pathname: 0, opened: 1, touched: 1, closed: 1 });
    assert.ok((await timestamp(target)).mtimeNs > before.mtimeNs);
  });

  test(`${mode} hit refuses an injected replaced-link result before opening for a timestamp write`, async t => {
    const { root, reader, fresh, target } = await populated(t);
    const unrelated = path.join(root, 'unrelated-media.mkv');
    await fs.writeFile(unrelated, 'Original unrelated fixture');
    const before = await oldTimestamp(unrelated);
    const originalLstat = fs.lstat;
    let linkChecks = 0;
    t.mock.method(fs, 'lstat', async (file, options) => {
      if (file === target && options?.bigint) {
        linkChecks++;
        // Inject the final-link observation at the touch boundary. The disk
        // read remains real; this is not a native Windows symlink fixture.
        const stat = await originalLstat(unrelated, options);
        stat.isSymbolicLink = () => true;
        return stat;
      }
      return originalLstat(file, options);
    });
    const calls = watchTouches(t, target);
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.equal(linkChecks, 1);
    assert.deepEqual(calls, { pathname: 0, opened: 0, touched: 0, closed: 0 });
    assert.deepEqual(await timestamp(unrelated), before);
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'Original unrelated fixture');
  });

  test(`${mode} hit leaves a real hardlinked record and its unrelated alias timestamps unchanged`, async t => {
    const { root, reader, fresh, target } = await populated(t);
    const alias = path.join(root, 'unrelated-alias.mkv');
    try { await fs.link(target, alias); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      t.skip(`Native hardlink fixture unavailable: ${error.code}`); return;
    }
    const contents = await fs.readFile(alias, 'utf8');
    const before = await oldTimestamp(alias);
    assert.equal((await fs.lstat(target, { bigint: true })).nlink, 2n);
    const calls = watchTouches(t, target);
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.deepEqual(calls, { pathname: 0, opened: 0, touched: 0, closed: 0 });
    // A disk hit reads the record and can update access time normally; neither
    // path may explicitly change modification time on the shared object.
    assert.equal((await timestamp(alias)).mtimeNs, before.mtimeNs);
    assert.equal(await fs.readFile(alias, 'utf8'), contents);
  });

  test(`${mode} hit closes a real replacement opened after lstat without changing its timestamps`, async t => {
    const { root, reader, fresh, target } = await populated(t);
    const unrelated = path.join(root, 'unrelated-media.mkv');
    const saved = path.join(root, 'checked-record.json');
    await fs.writeFile(unrelated, 'Original unrelated fixture');
    const before = await oldTimestamp(unrelated);
    const oldInode = (await fs.lstat(target, { bigint: true })).ino;
    const calls = watchTouches(t, target, { beforeOpen: async () => {
      await fs.rename(target, saved);
      await fs.rename(unrelated, target);
      assert.notEqual((await fs.lstat(target, { bigint: true })).ino, oldInode);
    } });
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.deepEqual(calls, { pathname: 0, opened: 1, touched: 0, closed: 1 });
    assert.deepEqual(await timestamp(target), before);
    assert.equal(await fs.readFile(target, 'utf8'), 'Original unrelated fixture');
  });

  test(`${mode} hit detects a real hardlink introduced between lstat and open`, async t => {
    const { root, reader, fresh, target } = await populated(t);
    const alias = path.join(root, 'late-alias.mkv');
    // Establish native support before installing the precise race callback.
    try { await fs.link(target, alias); await fs.unlink(alias); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      t.skip(`Native hardlink fixture unavailable: ${error.code}`); return;
    }
    const before = await oldTimestamp(target);
    const calls = watchTouches(t, target, { beforeOpen: () => fs.link(target, alias) });
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.deepEqual(calls, { pathname: 0, opened: 1, touched: 0, closed: 1 });
    assert.equal((await fs.lstat(alias, { bigint: true })).nlink, 2n);
    assert.equal((await timestamp(alias)).mtimeNs, before.mtimeNs);
  });

  test(`${mode} hit rejects an injected opened-device mismatch and closes the handle`, async t => {
    const { reader, fresh, target } = await populated(t);
    const before = await oldTimestamp(target);
    const calls = watchTouches(t, target, { openedStat: stat => { stat.dev += 1n; return stat; } });
    assert.deepEqual(await reader.lookup(identity()), fresh);
    assert.deepEqual(calls, { pathname: 0, opened: 1, touched: 0, closed: 1 });
    assert.equal((await timestamp(target)).mtimeNs, before.mtimeNs);
  });
}
