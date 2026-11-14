'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const outputs = require('../src/outputs.cjs');
const unsupported = async () => { throw Object.assign(Error('cross-volume'), { code: 'EXDEV' }); };

async function fixture(t, api = outputs) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-progress-'));
  const stage = await api.createStage(folder), destination = path.join(folder, 'result.mkv');
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 7, 53);
  await fs.writeFile(stage.file, bytes); await api.sealStage(stage); await api.markStageValidated(stage);
  t.after(async () => {
    const actual = await fs.realpath(folder); assert.equal(path.dirname(actual), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('publication-progress-')); await fs.rm(actual, { recursive: true, force: true });
  });
  return { stage, destination, bytes };
}
function altered(source, before, after) { assert.ok(source.includes(before), `missing mutant: ${before}`); return source.replace(before, after); }
async function compiled(before, after) {
  const filename = require.resolve('../src/outputs.cjs'), source = await fs.readFile(filename, 'utf8');
  const unit = new Module(filename, module); unit.filename = filename; unit.paths = module.paths;
  unit._compile((before ? altered(source, before, after) : source) + '\nmodule.exports.testCopy = copyWithProgress;\n', filename); return unit.exports;
}

async function successfulProgress(t, api = outputs) {
  const { stage, destination, bytes } = await fixture(t, api), events = [], open = fs.open.bind(fs);
  let nativeCopies = 0, partialWrites = 0;
  t.mock.method(fs, 'copyFile', async () => { nativeCopies++; throw Error('unexpected native copy'); });
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (file === destination && mode === 'wx+') {
      const write = handle.write.bind(handle);
      handle.write = (...a) => { partialWrites++; a[2] = Math.min(a[2], 400000); return write(...a); };
    }
    return handle;
  });
  assert.equal(await api.publishOutput(stage, destination, { link: unsupported, onProgress: e => {
    assert.ok(Object.isFrozen(e)); events.push(e);
  } }), true);
  assert.equal(nativeCopies, 0); assert.ok(partialWrites > 3);
  for (const name of ['publication-copy', 'publication-hash-source', 'publication-hash-destination']) {
    const rows = events.filter(e => e.stage === name); assert.ok(rows.length >= 3);
    let previous = 0;
    for (const row of rows) { assert.equal(row.total, bytes.length); assert.ok(row.completed > previous);
      assert.ok(row.completed - previous <= 1024 * 1024); previous = row.completed; }
    assert.equal(previous, bytes.length);
  }
  assert.deepEqual(await fs.readFile(destination), bytes);
  assert.deepEqual(await api.cleanupStage(stage), { retained: false });
}
test('opt-in exclusive publication reports bounded actual partial writes and both complete hashes', successfulProgress);

test('invalid publication progress is refused before any filesystem or authority access', async () => {
  for (const onProgress of [null, 1, {}, 'callback']) await assert.rejects(outputs.publishOutput({}, 'unused', { onProgress }), { code: 'INVALID_PUBLICATION_PROGRESS' });
});

async function closeFailure(t, api = outputs) {
  const { stage, destination } = await fixture(t, api), open = fs.open.bind(fs), closed = [];
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args), close = handle.close.bind(handle);
    t.after(() => close()); // A deliberately removed close must not leak the test's owned handle.
    if (file === stage.file || file === destination) handle.close = async () => {
      closed.push(file); await close();
      if (file === destination && mode === 'wx+') throw Object.assign(Error('close failed'), { code: 'EIO' });
    };
    return handle;
  });
  await assert.rejects(api.publishOutput(stage, destination, { link: unsupported, onProgress() {} }), e => {
    assert.equal(e.code, 'PUBLICATION_UNCERTAIN'); assert.equal(e.cause.code, 'EIO'); return true;
  });
  assert.deepEqual(new Set(closed), new Set([stage.file, destination]));
  assert.equal((await api.cleanupStage(stage)).retained, true);
}
test('a failed destination close still drains the held source and retains uncertain bytes', closeFailure);

async function invalidWrite(t, api = outputs, value = 0) {
  const { stage, destination } = await fixture(t, api), open = fs.open.bind(fs); let writes = 0;
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if (file === destination && mode === 'wx+') handle.write = async (_buffer, _offset, length) => {
      if (++writes > 1) throw Object.assign(Error('guard was removed'), { code: 'UNGUARDED_WRITE' });
      return { bytesWritten: value === 'oversize' ? length + 1 : value };
    };
    return handle;
  });
  await assert.rejects(api.publishOutput(stage, destination, { link: unsupported, onProgress() {} }), e => {
    assert.equal(e.code, 'PUBLICATION_UNCERTAIN'); assert.equal(e.cause.code, 'COPY_VERIFICATION_CHANGED'); return true;
  });
  assert.equal(writes, 1); assert.equal((await api.cleanupStage(stage)).retained, true);
}
for (const value of [0, -1, NaN, 'oversize']) test(`exclusive progress copy refuses invalid write progress ${value}`, t => invalidWrite(t, outputs, value));

test('cancellation from a copy progress callback stops before a second write and leaves no publication receipt', async t => {
  const { stage, destination } = await fixture(t), controller = new AbortController(); let writes = 0;
  await assert.rejects(outputs.publishOutput(stage, destination, { link: unsupported, signal: controller.signal,
    onProgress(event) { assert.equal(event.stage, 'publication-copy'); writes++; controller.abort(); } }), e => e.code === 'PUBLICATION_UNCERTAIN' && e.cause.code === 'CANCELLED');
  assert.equal(writes, 1); await assert.rejects(outputs.readPublishedOutputIdentity(stage), { code: 'INVALID_PUBLICATION_RECEIPT' });
  assert.equal((await outputs.cleanupStage(stage)).retained, true);
});

test('publication progress, exclusive-write and close-drain guard-removal mutants are killed', async t => {
  const mutants = [
    ['invalid callback', "if (onProgress !== undefined && typeof onProgress !== 'function')", 'if (false)', async api => {
      await assert.rejects(api.publishOutput({}, 'unused', { onProgress: 1 }), { code: 'INVALID_PUBLICATION_PROGRESS' });
    }],
    ['actual copy progress', "onProgress(Object.freeze({ stage: 'publication-copy', completed: position + written, total: size }));", '', (api, sub) => successfulProgress(sub, api)],
    ['write bound', 'if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytesRead - written)', 'if (false)', (api, sub) => invalidWrite(sub, api)],
    ['close both', 'const closes = await Promise.allSettled([output?.close(), source.close()]);', 'const closes = await Promise.allSettled([output?.close()]); if (closes.every(r => r.status === "fulfilled")) await source.close();', (api, sub) => closeFailure(sub, api)],
  ];
  for (const [name, before, after, check] of mutants) await t.test(name, async sub => {
    const api = await compiled(before, after);
    await assert.rejects(check(api, sub), assert.AssertionError);
  });
});

async function copyGuard(t, api, mode) {
  const { stage, destination } = await fixture(t), open = fs.open.bind(fs), before = await fs.stat(stage.file, { bigint: true });
  if (mode === 'offset') before.size = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  let reads = 0;
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await open(file, flags, ...args), stat = handle.stat.bind(handle), read = handle.read.bind(handle); let observations = 0;
    if (file === stage.file || file === destination) handle.stat = async (...a) => {
      const actual = await stat(...a); observations++;
      if (file === stage.file && mode === 'source') actual.nlink = 2n;
      if (file === stage.file && mode === 'offset') actual.size = before.size;
      if (file === destination && mode === 'destination' && observations === 1) actual.nlink = 2n;
      if (file === stage.file && mode === 'changed' && observations === 2) actual.ino += 1n;
      return actual;
    };
    if (file === stage.file) handle.read = async (...a) => {
      reads++;
      if (mode === 'offset') throw Object.assign(Error('offset guard bypassed'), { code: 'UNSAFE_OFFSET' });
      if (mode === 'truncated') { if (reads === 1) return { bytesRead: 0 }; throw Object.assign(Error('loop guard bypassed'), { code: 'UNGUARDED_READ' }); }
      if (mode === 'io') throw Object.assign(Error('read denied'), { code: 'EACCES' });
      return read(...a);
    };
    return handle;
  });
  await assert.rejects(api.testCopy(stage.file, destination, before, undefined, () => {}), e => {
    const created = !['source', 'offset'].includes(mode);
    assert.equal(e.code, created ? 'PUBLICATION_UNCERTAIN' : mode === 'offset' ? 'COPY_VERIFICATION_LIMIT' : 'COPY_VERIFICATION_CHANGED');
    if (created) assert.equal(e.cause.code, mode === 'io' ? 'EACCES' : 'COPY_VERIFICATION_CHANGED'); return true;
  });
  if (mode === 'offset') assert.equal(reads, 0);
}
test('progress copy retains safe offsets, source/destination ordinary identity, complete reads and final binding (mutants killed)', async t => {
  const modes = [
    ['source', '!regularSingleFile(before) || !sameContent(before, expected)', 'false'],
    ['destination', '!regularSingleFile(bound) || bound.size !== 0n', 'false'],
    ['offset', 'if (!Number.isSafeInteger(size)) throw failure(\'COPY_VERIFICATION_LIMIT\', \'The completed file is too large for safe copy offsets.\');', ''],
    ['truncated', "if (!bytesRead) throw failure('COPY_VERIFICATION_CHANGED', 'The validated copy source became shorter.');", ''],
    ['changed', '!sameContent(before, after) || !regularSingleFile(copied) || !regularSingleFile(named) || !sameObject(bound, copied)\n        || !sameContent(copied, named) || copied.size !== before.size', 'false'],
  ];
  for (const [mode, guard, replacement] of modes) await t.test(mode, async sub => {
    await copyGuard(sub, await compiled(), mode); sub.mock.restoreAll();
    await assert.rejects(copyGuard(sub, await compiled(guard, replacement), mode), assert.AssertionError);
  });
  await t.test('other I/O is retained, never swallowed', async sub => copyGuard(sub, await compiled(), 'io'));
});
