const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStage, sealStage, cleanupStage, publishOutput } = require('../src/outputs.cjs');

async function fixture(t, { seal = true, write = true } = {}) {
  const base = path.resolve(__dirname, '../artifacts/output-tests');
  await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, 'case-'));
  const stage = await createStage(folder);
  if (write) await fs.writeFile(stage.file, 'validated new media');
  if (seal) await sealStage(stage);
  t.after(async () => { await cleanupStage(stage); });
  return { folder, stage, destination: path.join(folder, 'result.mkv') };
}

function unsupported(code = 'ENOTSUP') {
  return async () => { throw Object.assign(new Error('not supported'), { code }); };
}

test('native atomic publication is a hard link and stage cleanup retains the completed output', async t => {
  const { stage, destination } = await fixture(t);
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true }), true);
  const [staged, final] = await Promise.all([fs.stat(stage.file, { bigint: true }), fs.stat(destination, { bigint: true })]);
  assert.equal(final.ino, staged.ino);
  assert.equal(final.dev, staged.dev);
  assert.ok(final.nlink >= 2n);
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  assert.equal(await fs.readFile(destination, 'utf8'), 'validated new media');
  await assert.rejects(fs.stat(stage.directory), { code: 'ENOENT' });
});

test('existing output wins a publication race and is byte-for-byte preserved', async t => {
  const { stage, destination } = await fixture(t);
  const link = async (source, target) => {
    await fs.writeFile(target, 'irreplaceable existing output', { flag: 'wx' });
    await fs.link(source, target);
  };
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true, link }), false);
  assert.equal(await fs.readFile(destination, 'utf8'), 'irreplaceable existing output');
});

test('an existing destination directory is never replaced or removed', async t => {
  const { stage, destination } = await fixture(t);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'keep.txt'), 'keep');
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true }), false);
  await cleanupStage(stage);
  assert.equal(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
});

for (const code of ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']) {
  test(`same-folder publication fails closed without copy when link returns ${code}`, async t => {
    const { stage, destination } = await fixture(t);
    await assert.rejects(publishOutput(stage, destination, { atomicOnly: true, link: unsupported(code) }), error => {
      assert.equal(error.code, 'ATOMIC_PUBLICATION_UNAVAILABLE');
      assert.equal(error.cause.code, code);
      return true;
    });
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
  });
}

test('distinct-folder exclusive-copy fallback preserves an existing destination and can publish a new one', async t => {
  const { stage, destination } = await fixture(t);
  const link = unsupported();
  await fs.writeFile(destination, 'existing');
  assert.equal(await publishOutput(stage, destination, { link }), false);
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing');
  const other = path.join(path.dirname(destination), 'other.mkv');
  assert.equal(await publishOutput(stage, other, { link }), true);
  const [staged, copied] = await Promise.all([fs.stat(stage.file, { bigint: true }), fs.stat(other, { bigint: true })]);
  assert.notEqual(copied.ino, staged.ino);
  assert.equal(await fs.readFile(other, 'utf8'), 'validated new media');
});

test('cancel before publication leaves no destination and cleans only owned staging', async t => {
  const { stage, destination } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(publishOutput(stage, destination, { signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  assert.deepEqual(await cleanupStage(stage), { retained: false });
});

test('cancellation during a successful native link preserves the completed output', async t => {
  const { stage, destination } = await fixture(t);
  const controller = new AbortController();
  const link = async (source, target) => {
    await fs.link(source, target);
    controller.abort();
  };
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true, signal: controller.signal, link }), true);
  await cleanupStage(stage);
  assert.equal(await fs.readFile(destination, 'utf8'), 'validated new media');
});

test('cancellation after unsupported link prevents the distinct-folder copy fallback', async t => {
  const { stage, destination } = await fixture(t);
  const controller = new AbortController();
  const link = async () => { controller.abort(); return unsupported()(); };
  await assert.rejects(publishOutput(stage, destination, { signal: controller.signal, link }), { code: 'CANCELLED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('copied path objects cannot publish, seal, or grant cleanup authority', async t => {
  const { stage, destination } = await fixture(t);
  const forged = { ...stage };
  await assert.rejects(publishOutput(forged, destination), { code: 'INVALID_STAGE' });
  await assert.rejects(sealStage(forged), { code: 'INVALID_STAGE' });
  await assert.rejects(cleanupStage(forged), { code: 'INVALID_STAGE' });
  assert.equal(Object.isFrozen(stage), true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
});

test('unsealed incomplete output is retained instead of adopting deletion authority', async t => {
  const { stage, destination } = await fixture(t, { seal: false });
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_NOT_SEALED' });
  const cleanup = await cleanupStage(stage);
  assert.equal(cleanup.retained, true);
  assert.equal(cleanup.directory, stage.directory);
  assert.match(cleanup.reason, /never identity-bound/);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
});

test('a never-written owned staging directory can be removed after encoder spawn failure', async t => {
  const { stage } = await fixture(t, { seal: false, write: false });
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  await assert.rejects(fs.stat(stage.directory), { code: 'ENOENT' });
});

test('a hard-linked stage is rejected before validation and retained without adopting ownership', async t => {
  const { folder, stage, destination } = await fixture(t, { seal: false });
  const alias = path.join(folder, 'external-alias.mkv');
  await fs.link(stage.file, alias);
  await assert.rejects(sealStage(stage), { code: 'STAGE_CHANGED' });
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_NOT_SEALED' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
  assert.equal(await fs.readFile(alias, 'utf8'), 'validated new media');
});

test('a hard-linked alias created after validation prevents publication and survives owned-stage cleanup', async t => {
  const { folder, stage, destination } = await fixture(t);
  const alias = path.join(folder, 'external-alias.mkv');
  await fs.link(stage.file, alias);
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  assert.equal(await fs.readFile(alias, 'utf8'), 'validated new media');
});

test('a file changed during validation cannot be published or re-sealed, but its owned inode can be cleaned', async t => {
  const { stage, destination } = await fixture(t);
  await fs.appendFile(stage.file, ' externally modified');
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  await assert.rejects(sealStage(stage), { code: 'STAGE_CHANGED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  assert.deepEqual(await cleanupStage(stage), { retained: false });
});

test('a replacement regular file is neither published nor deleted during cleanup', async t => {
  const { stage, destination } = await fixture(t);
  await fs.rename(stage.file, path.join(stage.directory, 'former-encoded.mkv'));
  await fs.writeFile(stage.file, 'unrelated replacement');
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  await assert.rejects(sealStage(stage), { code: 'STAGE_CHANGED' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'unrelated replacement');
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('a native hard-linked replacement remains intact under both names', async t => {
  const { folder, stage, destination } = await fixture(t);
  const unrelated = path.join(folder, 'unrelated.mkv');
  await fs.writeFile(unrelated, 'original media');
  await fs.unlink(stage.file);
  await fs.link(unrelated, stage.file);
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'original media');
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'original media');
});

test('a directory replacing the staged file is retained without traversing it', async t => {
  const { stage, destination } = await fixture(t);
  await fs.unlink(stage.file);
  await fs.mkdir(stage.file);
  await fs.writeFile(path.join(stage.file, 'original.txt'), 'unrelated');
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_CHANGED' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(path.join(stage.file, 'original.txt'), 'utf8'), 'unrelated');
});

test('a replaced staging directory cannot give its new contents cleanup or publication authority', async t => {
  const { folder, stage, destination } = await fixture(t);
  const moved = path.join(folder, 'moved-owned-stage');
  await fs.rename(stage.directory, moved);
  await fs.mkdir(stage.directory);
  await fs.writeFile(stage.file, 'unrelated directory contents');
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_CHANGED' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'unrelated directory contents');
  assert.equal(await fs.readFile(path.join(moved, 'encoded.mkv'), 'utf8'), 'validated new media');
});

test('cleanup removes only the bound file and retains unexpected directory contents', async t => {
  const { stage } = await fixture(t);
  const unrelated = path.join(stage.directory, 'unrelated.txt');
  await fs.writeFile(unrelated, 'keep');
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
  await assert.rejects(fs.stat(stage.file), { code: 'ENOENT' });
});

test('repeated cleanup never acts on a newly created object at a previously cleaned path', async t => {
  const { stage } = await fixture(t);
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  await fs.mkdir(stage.directory);
  await fs.writeFile(stage.file, 'new unrelated object');
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'new unrelated object');
});

test('a replacement inside the final native link window is detected and the uncertain destination is preserved', async t => {
  const { folder, stage, destination } = await fixture(t);
  const original = path.join(folder, 'original-validated.mkv');
  const link = async (source, target) => {
    await fs.rename(source, original);
    await fs.writeFile(source, 'unvalidated replacement');
    await fs.link(source, target);
  };
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true, link }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(destination, 'utf8'), 'unvalidated replacement');
  assert.equal(await fs.readFile(original, 'utf8'), 'validated new media');
});


test('cleanup never removes a sealed object whose identity belongs to the protected input snapshot', async t => {
  const { stage } = await fixture(t);
  const stat = await fs.stat(stage.file, { bigint: true });
  const result = await cleanupStage(stage, { protectedIdentities: new Set([String(stat.dev) + ':' + String(stat.ino)]) });
  assert.equal(result.retained, true); assert.match(result.reason, /protected input/);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
});
