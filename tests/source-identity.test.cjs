'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readFileStamp, readSourceIdentity, sameStamp, sameIdentity, assertIdentityMatches } = require('../src/source-identity.cjs');

async function fixture(t, bytes = 1024 * 1024) {
  const base = path.resolve(__dirname, '..', 'artifacts');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'identity-test-'));
  const file = path.join(directory, 'source العربية & [recording].mkv');
  await fs.writeFile(file, Buffer.alloc(bytes, 37));
  t.after(async () => {
    assert.equal(path.dirname(directory), base);
    assert.ok(path.basename(directory).startsWith('identity-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { file, directory };
}

test('stable regular files have JSON-safe precise stamps and repeatable bounded identities', async t => {
  const { file } = await fixture(t);
  const first = await readSourceIdentity(file);
  assert.equal(first.canonicalPath, await fs.realpath(file));
  const stat = await fs.lstat(file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(first[key], String(stat[key]));
  assert.match(first.sparseDigest, /^sha256-sparse-v1:[a-f0-9]{64}$/);
  assert.equal(sameIdentity(first, JSON.parse(JSON.stringify(await readSourceIdentity(file)))), true);
  assert.equal(sameStamp(first, await readFileStamp(file)), true);
  assert.equal(sameIdentity(first, { ...first, sparseDigest: 'unversioned' }), false);
  assert.equal(sameStamp({}, {}), false);
  assert.equal(sameStamp(first, { ...first, size: '0' }), false);
});

test('content changes invalidate the digest even if a caller compares identical historical stamp fields', async t => {
  const { file } = await fixture(t);
  const first = await readSourceIdentity(file);
  const handle = await fs.open(file, 'r+');
  try { await handle.write(Buffer.from([99]), 0, 1, 500_000); }
  finally { await handle.close(); }
  const second = await readSourceIdentity(file);
  assert.notEqual(first.sparseDigest, second.sparseDigest);
  assert.equal(sameIdentity(first, second), false);
  assert.equal(sameStamp(first, { ...first, sparseDigest: second.sparseDigest }), true);
  assert.equal(sameIdentity(first, { ...first, sparseDigest: second.sparseDigest }), false);
});

test('every compared field is identified with exact before/after values without relaxing rejection', async t => {
  const { file } = await fixture(t);
  const expected = await readSourceIdentity(file);
  const fields = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
  for (const field of fields) {
    const actual = { ...expected, [field]: field === 'sparseDigest' ? `sha256-sparse-v1:${'a'.repeat(64)}` : `${expected[field]}1` };
    assert.throws(() => assertIdentityMatches(expected, actual, { message: 'Source identity changed.', stage: 'test', digest: true }), error => {
      assert.equal(error.code, 'INPUT_CHANGED');
      assert.match(error.message, new RegExp(field));
      assert.deepEqual(error.sourceIdentityDiagnostic.changedFields, [field]);
      assert.deepEqual(error.sourceIdentityDiagnostic.expected, expected);
      assert.deepEqual(error.sourceIdentityDiagnostic.actual, actual);
      assert.equal(error.sourceIdentityDiagnostic.stage, 'test');
      return true;
    });
  }
  assert.doesNotThrow(() => assertIdentityMatches(expected, expected, { message: '', stage: 'test', digest: true }));
  assert.throws(() => assertIdentityMatches({}, {}, { message: 'Invalid.', stage: 'test' }), { code: 'INPUT_CHANGED' });
  const malformed = { ...expected, sparseDigest: 'invalid' };
  assert.throws(() => assertIdentityMatches(malformed, malformed, { message: 'Invalid.', stage: 'test', digest: true }), error => {
    assert.equal(error.code, 'INPUT_CHANGED');
    assert.doesNotMatch(error.message, /Sparse samples match/);
    return true;
  });
});

test('incidental attribute changes retain full content but ctime alone cannot authorize reuse', async t => {
  const { file } = await fixture(t, 4 * 1024 * 1024);
  const before = await readSourceIdentity(file);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const beforeHash = hash(await fs.readFile(file));
  try {
    await fs.chmod(file, 0o444);
    const after = await readSourceIdentity(file);
    assert.deepEqual(Object.keys(before).filter(field => before[field] !== after[field]), ['ctimeNs']);
    assert.equal(hash(await fs.readFile(file)), beforeHash);
    assert.equal(sameIdentity(before, after), false);
    assert.throws(() => assertIdentityMatches(before, after, { message: 'Source identity changed.', stage: 'after-encode', digest: true }), error => {
      assert.match(error.message, /Sparse samples match; unchanged full content cannot be established/);
      assert.deepEqual(error.sourceIdentityDiagnostic.changedFields, ['ctimeNs']);
      return true;
    });
  } finally { await fs.chmod(file, 0o666); }
});

test('ctime invalidates an unsampled same-size edit even when mtime is restored', async t => {
  const { file } = await fixture(t, 4 * 1024 * 1024);
  const fixedTime = 1_700_000_000;
  await fs.utimes(file, fixedTime, fixedTime);
  const first = await readSourceIdentity(file);
  const handle = await fs.open(file, 'r+');
  try { await handle.write(Buffer.from([99]), 0, 1, 500_000); }
  finally { await handle.close(); }
  await fs.utimes(file, fixedTime, fixedTime);
  const second = await readSourceIdentity(file);
  assert.equal(second.size, first.size);
  assert.equal(second.mtimeNs, first.mtimeNs);
  assert.notEqual(second.ctimeNs, first.ctimeNs);
  assert.equal(second.sparseDigest, first.sparseDigest, 'the edit intentionally lies between sparse windows');
  assert.equal(sameStamp(first, second), false);
  assert.equal(sameIdentity(first, second), false);
});

test('replacing a selected file and appending content invalidate source stamps', async t => {
  const { file, directory } = await fixture(t, 32);
  const first = await readFileStamp(file);
  await fs.appendFile(file, Buffer.from([1]));
  assert.equal(sameStamp(first, await readFileStamp(file)), false);
  await fs.rename(file, path.join(directory, 'old.mkv'));
  await fs.writeFile(file, Buffer.alloc(32, 37));
  assert.equal(sameStamp(first, await readFileStamp(file)), false);
});

test('empty, missing, nonregular and relative sources cannot produce an identity', async t => {
  const { file, directory } = await fixture(t, 0);
  await assert.rejects(readFileStamp(file), { code: 'EMPTY_INPUT' });
  await assert.rejects(readFileStamp(directory), { code: 'INPUT_CHANGED' });
  await assert.rejects(readFileStamp(path.join(directory, 'missing.mkv')), { code: 'ENOENT' });
  await assert.rejects(readFileStamp('relative.mkv'), { code: 'INVALID_PATH' });
});

test('a selected symbolic-link stat is rejected before realpath can follow its target', async t => {
  const { file } = await fixture(t);
  const original = fs.lstat.bind(fs);
  t.mock.method(fs, 'lstat', async (...args) => {
    const stat = await original(...args);
    if (args[0] === file) stat.isSymbolicLink = () => true;
    return stat;
  });
  t.mock.method(fs, 'realpath', () => assert.fail('must reject a link before resolving its target'));
  await assert.rejects(readFileStamp(file), { code: 'INPUT_CHANGED' });
});

test('sampling reads at most three 256 KiB windows and closes its one read-only handle', async t => {
  const { file } = await fixture(t, 4 * 1024 * 1024);
  const original = fs.open.bind(fs);
  let count = 0, total = 0, closed = 0;
  t.mock.method(fs, 'open', async (...args) => {
    assert.equal(args[1], 'r');
    count++;
    const handle = await original(...args);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...readArgs) => { const result = await read(...readArgs); total += result.bytesRead; return result; };
    handle.close = async () => { closed++; return close(); };
    return handle;
  });
  await readSourceIdentity(file);
  assert.equal(count, 1);
  assert.equal(total, 3 * 256 * 1024);
  assert.equal(closed, 1);
});

test('mutation during a real sampling read rejects instead of caching mixed generations', async t => {
  const { file } = await fixture(t);
  const original = fs.open.bind(fs);
  let changed = false, closed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...readArgs) => {
      const result = await read(...readArgs);
      if (!changed) { changed = true; await fs.appendFile(file, Buffer.from([1])); }
      return result;
    };
    handle.close = async () => { closed = true; return close(); };
    return handle;
  });
  await assert.rejects(readSourceIdentity(file), error => {
    assert.equal(error.code, 'INPUT_CHANGED');
    assert.equal(error.sourceIdentityDiagnostic.stage, 'handle-before-after-sampling');
    assert.ok(error.sourceIdentityDiagnostic.changedFields.includes('size'));
    return true;
  });
  assert.equal(changed, true);
  assert.equal(closed, true);
});

test('a path/file-handle mismatch reports its precise comparison stage and file ID delta', async t => {
  const { file } = await fixture(t);
  const lstat = fs.lstat.bind(fs);
  let count = 0;
  t.mock.method(fs, 'lstat', async (...args) => {
    const stat = await lstat(...args);
    // Two initial path stats agree; the final two path stats represent a
    // replacement while the sampled handle still refers to the original.
    if (++count > 2) stat.ino += 1n;
    return stat;
  });
  await assert.rejects(readSourceIdentity(file), error => {
    assert.equal(error.code, 'INPUT_CHANGED');
    assert.equal(error.sourceIdentityDiagnostic.stage, 'handle-to-path-after-sampling');
    assert.deepEqual(error.sourceIdentityDiagnostic.changedFields, ['ino']);
    assert.notEqual(error.sourceIdentityDiagnostic.expected.ino, error.sourceIdentityDiagnostic.actual.ino);
    return true;
  });
});

test('cancellation before and during sampling closes ownership without reading later windows', async t => {
  const { file } = await fixture(t);
  const before = new AbortController(); before.abort();
  await assert.rejects(readSourceIdentity(file, { signal: before.signal }), { code: 'CANCELLED' });
  const abort = new AbortController(), original = fs.open.bind(fs);
  let reads = 0, closed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...readArgs) => { reads++; const result = await read(...readArgs); abort.abort(); return result; };
    handle.close = async () => { closed = true; return close(); };
    return handle;
  });
  await assert.rejects(readSourceIdentity(file, { signal: abort.signal }), { code: 'CANCELLED' });
  assert.equal(reads, 1);
  assert.equal(closed, true);
});
