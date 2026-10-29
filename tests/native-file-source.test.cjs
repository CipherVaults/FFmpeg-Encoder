'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { NativeFileSourceOwner } = require('../src/native-file-source.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const Module = require('node:module'), fsSync = require('node:fs');

function injectedOwner(readIdentity, shiftCtime = () => false) {
  // Trusted test-only dependency replacement; production has no injection or
  // filesystem override API. All bytes/opens/closes still use our owned files.
  const filename = require.resolve('../src/native-file-source.cjs'), isolated = new Module(filename, module);
  isolated.filename = filename; isolated.paths = module.paths;
  const actualRequire = Module.createRequire(filename), shift = stat => {
    if (!shiftCtime()) return stat;
    const result = Object.create(stat); Object.defineProperty(result, 'ctimeNs', { value: stat.ctimeNs + 1n }); return result;
  };
  isolated.require = name => name === './source-identity.cjs' ? { ...actualRequire(name), readSourceIdentity: readIdentity }
    : name === 'node:fs/promises' ? { ...fs,
      lstat: async (...args) => shift(await fs.lstat(...args)),
      open: async (...args) => {
        const handle = await fs.open(...args);
        return { read: handle.read.bind(handle), close: handle.close.bind(handle), stat: async (...options) => shift(await handle.stat(...options)) };
      } } : actualRequire(name);
  isolated._compile(fsSync.readFileSync(filename, 'utf8'), filename);
  return new isolated.exports.NativeFileSourceOwner();
}

// Small owned byte files only. No media process, source fixture, device or UI.
async function fixture(t, bytes = 4096) {
  const base = path.resolve(__dirname, '..', 'artifacts'), directory = await fs.mkdtemp(path.join(base, 'native-source-test-'));
  const file = path.join(directory, 'owned source العربية.bin'), data = Buffer.alloc(bytes, 37), owner = new NativeFileSourceOwner();
  await fs.writeFile(file, data, { flag: 'wx' });
  t.after(async () => {
    await owner.close(); assert.equal(path.dirname(directory), base); assert.ok(path.basename(directory).startsWith('native-source-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }); return { file, directory, data, owner };
}
const code = expected => error => error.code === expected;

test('final source currentness requires the original completed assessment and refuses later changes', async t => {
  const {file,owner}=await fixture(t),source=await owner.seal(file);
  await assert.rejects(owner.requirePublicationCurrent({}),code('NATIVE_SOURCE_STALE'));
  await owner.beginCompletion(source);const assessment=await owner.assessCompleted(source);
  assert.equal(await owner.requirePublicationCurrent(assessment),assessment);
  await assert.rejects(owner.requirePublicationCurrent({...assessment}),code('NATIVE_SOURCE_STALE'));
  await assert.rejects(owner.requireCurrent(source),code('NATIVE_SOURCE_STALE'));
  await fs.writeFile(file,Buffer.alloc(4096,41));await assert.rejects(owner.requirePublicationCurrent(assessment),code('NATIVE_SOURCE_CHANGED'));
  await owner.release(source);await assert.rejects(owner.requirePublicationCurrent(assessment),code('NATIVE_SOURCE_STALE'));
});

test('cancelled final-currentness starts no publication check and does not mint new source authority', async t => {
  const {file,owner}=await fixture(t),source=await owner.seal(file);await owner.beginCompletion(source);const assessment=await owner.assessCompleted(source),controller=new AbortController();controller.abort();
  await assert.rejects(owner.requirePublicationCurrent(assessment,{signal:controller.signal}),code('CANCELLED'));
  assert.equal(await owner.requirePublicationCurrent(assessment),assessment);assert.equal(assessment.executionAuthority,'none');
});

test('complete source observations bind all bytes, retained identity and no execution authority', async t => {
  const { file, data, owner } = await fixture(t, 1024 * 1024 + 17), expectedIdentity = await readSourceIdentity(file);
  const token = await owner.seal(file, { expectedIdentity });
  assert.equal(token.content.complete, true); assert.equal(token.content.bytes, String(data.length));
  assert.equal(token.content.digest, createHash('sha256').update(data).digest('hex'));
  assert.equal(token.executionAuthority, 'none'); assert.ok(Object.isFrozen(token.identity));
  assert.equal(await owner.requireCurrent(token), token);
  await owner.release(token); await assert.rejects(owner.requireCurrent(token), code('NATIVE_SOURCE_STALE'));
});

test('completion is monotonic, returns full comparable observations and never renews a prepared input', async t => {
  const { file, owner } = await fixture(t), token = await owner.seal(file);
  await assert.rejects(owner.requireCompletionSource(token), code('NATIVE_SOURCE_COMPLETION_ONLY'));
  await owner.beginCompletion(token);
  await assert.rejects(owner.requireCurrent(token), code('NATIVE_SOURCE_COMPLETION_ONLY'));
  await assert.rejects(owner.beginCompletion(token), code('NATIVE_SOURCE_COMPLETION_ONLY'));
  assert.equal(await owner.requireCompletionSource(token), token);
  const result = await owner.assessCompleted(token);
  assert.equal(result.assessment.kind, 'unchanged'); assert.equal(result.contentEvidence.before.digest, result.contentEvidence.after.digest);
  assert.equal(result.executionAuthority, 'none'); assert.match(result.publicationRequires, /independent-complete-output/);
  await assert.rejects(owner.requireCurrent(token), code('NATIVE_SOURCE_STALE'));
  await owner.release(token);
});

test('serialized, foreign, released and restarted observations cannot supply source authority', async t => {
  const { file, owner } = await fixture(t), other = new NativeFileSourceOwner(), token = await owner.seal(file);
  try {
    await assert.rejects(owner.requireCurrent(JSON.parse(JSON.stringify(token))), code('NATIVE_SOURCE_STALE'));
    await assert.rejects(other.requireCurrent(token), code('NATIVE_SOURCE_STALE'));
    await owner.close(); await owner.close();
    await assert.rejects(owner.requireCurrent(token), code('NATIVE_SOURCE_STALE'));
    await assert.rejects(owner.seal(file), code('NATIVE_SOURCE_STALE'));
  } finally { await other.close(); }
});

test('one retained source prevents competing admission until release', async t => {
  const { file, owner } = await fixture(t), token = await owner.seal(file);
  await assert.rejects(owner.seal(file), code('NATIVE_SOURCE_BUSY'));
  await owner.release(token); await owner.release(token);
  const next = await owner.seal(file); assert.notEqual(next, token); await owner.release(next);
});

test('changed source bytes or file object revoke the observation through completion', async t => {
  const { file, owner, data } = await fixture(t), token = await owner.seal(file);
  await owner.beginCompletion(token);
  data[128] = 99; await fs.writeFile(file, data);
  await assert.rejects(owner.assessCompleted(token), code('NATIVE_SOURCE_CHANGED'));
  await assert.rejects(owner.requireCompletionSource(token), code('NATIVE_SOURCE_STALE'));
  await owner.release(token);
});

test('stale inspection identity refuses and closes its tentative full-read handle', async t => {
  const { file, owner } = await fixture(t), identity = await readSourceIdentity(file);
  await assert.rejects(owner.seal(file, { expectedIdentity: { ...identity, sparseDigest: 'sha256-sparse-v1:' + 'a'.repeat(64) } }), code('NATIVE_SOURCE_CHANGED'));
  const token = await owner.seal(file); await owner.release(token);
});

test('empty and oversized sources refuse before retained read admission', async t => {
  const { file, directory } = await fixture(t), owner = new NativeFileSourceOwner({ maximumBytes: 16 }), empty = path.join(directory, 'empty.bin');
  try {
    await fs.writeFile(empty, Buffer.alloc(0), { flag: 'wx' });
    for (const candidate of [empty, file]) await assert.rejects(owner.seal(candidate), code('NATIVE_SOURCE_SIZE'));
    await fs.writeFile(empty, Buffer.from('bounded'));
    const token = await owner.seal(empty); await owner.release(token);
  } finally { await owner.close(); }
});

test('hardlinked owned sources cannot enter the finite native route', async t => {
  const { file, directory, owner } = await fixture(t), link = path.join(directory, 'owned-alias.bin');
  await fs.link(file, link);
  await assert.rejects(owner.seal(file), code('NATIVE_SOURCE_CHANGED'));
});

test('pre-aborted source reads leave the owner reusable and perform no authority renewal', async t => {
  const { file, owner } = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(owner.seal(file, { signal: controller.signal }), code('CANCELLED'));
  const token = await owner.seal(file); await owner.release(token);
});

test('unknown options and source-identity accessors refuse without coercion', async t => {
  const { file, owner } = await fixture(t); let calls = 0;
  const expectedIdentity = await readSourceIdentity(file);
  Object.defineProperty(expectedIdentity, 'size', { enumerable: true, get() { calls++; return '4096'; } });
  await assert.rejects(owner.seal(file, { expectedIdentity }), code('INVALID_NATIVE_SOURCE'));
  await assert.rejects(owner.seal(file, { sourceSha256: 'a'.repeat(64) }), code('INVALID_NATIVE_SOURCE'));
  await assert.rejects(owner.seal({ toString() { calls++; return file; } }), code('INVALID_NATIVE_SOURCE'));
  assert.throws(() => new NativeFileSourceOwner({ maximumBytes: 134217729 }), code('INVALID_NATIVE_SOURCE'));
  assert.equal(calls, 0);
});

test('a sparse observation of another transient path cannot join the retained object full hash', async t => {
  const { file, directory } = await fixture(t), otherFile = path.join(directory, 'transient-other.bin');
  await fs.writeFile(otherFile, Buffer.alloc(4096, 89), { flag: 'wx' });
  const otherIdentity = await readSourceIdentity(otherFile), owner = injectedOwner(async () => otherIdentity);
  try { await assert.rejects(owner.seal(file), code('NATIVE_SOURCE_CHANGED')); }
  finally { await owner.close(); }
});

test('a ctime change between final full hashing and sparse sampling refuses a mixed observation', async t => {
  const { file } = await fixture(t); let calls = 0, changed = false;
  const owner = injectedOwner(async (...args) => {
    const identity = await readSourceIdentity(...args);
    if (++calls === 2) changed = true;
    return changed ? { ...identity, ctimeNs: String(BigInt(identity.ctimeNs) + 1n) } : identity;
  }, () => changed);
  try {
    const token = await owner.seal(file); await owner.beginCompletion(token);
    await assert.rejects(owner.assessCompleted(token), code('NATIVE_SOURCE_CHANGED'));
    await owner.release(token);
  } finally { await owner.close(); }
});

test('ctime-only observed before the final complete read retains the existing completion warning', async t => {
  const { file } = await fixture(t); let changed = false;
  const owner = injectedOwner(async (...args) => {
    const identity = await readSourceIdentity(...args);
    return changed ? { ...identity, ctimeNs: String(BigInt(identity.ctimeNs) + 1n) } : identity;
  }, () => changed);
  try {
    const token = await owner.seal(file); changed = true;
    await owner.beginCompletion(token); await assert.rejects(owner.requireCurrent(token), code('NATIVE_SOURCE_COMPLETION_ONLY'));
    const result = await owner.assessCompleted(token);
    assert.equal(result.assessment.kind, 'ctime-only'); assert.equal(result.assessment.warning.code, 'SOURCE_CTIME_ONLY');
    assert.equal(result.contentEvidence.before.digest, result.contentEvidence.after.digest);
    await owner.release(token);
  } finally { await owner.close(); }
});

test('close aborts an active preparation and waits for its retained-handle work to drain', async t => {
  const { file } = await fixture(t); let entered, release, sawAbort = false;
  const started = new Promise(resolve => { entered = resolve; }), drained = new Promise(resolve => { release = resolve; });
  const owner = injectedOwner(async (...args) => {
    args[1].signal.addEventListener('abort', () => { sawAbort = true; }, { once: true });
    entered(); await drained; return readSourceIdentity(...args);
  });
  const work = owner.seal(file), rejected = assert.rejects(work, code('CANCELLED')); await started;
  let closed = false; const closing = owner.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(sawAbort, true); assert.equal(closed, false);
  await assert.rejects(owner.seal(file), code('NATIVE_SOURCE_STALE'));
  release(); await rejected; await closing; assert.equal(closed, true); await owner.close();
});
