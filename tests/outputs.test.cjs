const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStage, sealStage, markStageValidated, cleanupStage, publishOutput, readPublishedOutputIdentity } = require('../src/outputs.cjs');

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

test('publication observations require private validated ownership and the correct cleanup order', async t => {
  const { stage, destination } = await fixture(t);
  await assert.rejects(readPublishedOutputIdentity({ ...stage }), { code: 'INVALID_STAGE' });
  await assert.rejects(readPublishedOutputIdentity(stage), { code: 'INVALID_PUBLICATION_RECEIPT' });
  assert.equal(await publishOutput(stage, destination), true);
  await assert.rejects(readPublishedOutputIdentity(stage), { code: 'INVALID_PUBLICATION_RECEIPT' });
});

for (const method of ['hard-link', 'verified-copy']) {
  test(`${method} observation binds its actual validated destination before and after cleanup`, async t => {
    const { stage, destination } = await fixture(t);
    await markStageValidated(stage);
    assert.equal(await publishOutput(stage, destination, method === 'verified-copy' ? { link: unsupported() } : {}), true);
    await assert.rejects(readPublishedOutputIdentity(stage, { afterCleanup: true }), { code: 'PUBLICATION_OBSERVATION_ORDER' });
    const before = await readPublishedOutputIdentity(stage);
    assert.equal(Object.isFrozen(before), true);
    const staged = await fs.stat(stage.file, { bigint: true });
    assert.equal(before.canonicalPath, await fs.realpath(destination));
    assert.equal(before.ino === String(staged.ino), method === 'hard-link');
    assert.deepEqual(await cleanupStage(stage), { retained: false });
    const after = await readPublishedOutputIdentity(stage, { afterCleanup: true });
    assert.deepEqual({ ...after, ctimeNs: before.ctimeNs }, before);
    assert.deepEqual(await readPublishedOutputIdentity(stage, { afterCleanup: true }), after);
    assert.equal((await fs.stat(destination)).nlink, 1);
    await assert.rejects(readPublishedOutputIdentity(stage), { code: 'PUBLICATION_OBSERVATION_ORDER' });
  });

  for (const mutation of ['replacement', 'same-object-content']) {
    test(`${method} ${mutation} before its first observation cannot be adopted as a published identity`, async t => {
      const { stage, destination } = await fixture(t);
      await markStageValidated(stage);
      assert.equal(await publishOutput(stage, destination, method === 'verified-copy' ? { link: unsupported() } : {}), true);
      const before = await fs.stat(destination, { bigint: true });
      if (mutation === 'replacement') await fs.rename(destination, `${destination}.validated`);
      await fs.writeFile(destination, Buffer.alloc(Number(before.size), 90));
      await fs.utimes(destination, new Date(), new Date(Number(before.mtimeNs / 1000000n) + 1000));
      const after = await fs.stat(destination, { bigint: true });
      assert.equal(before.ino === after.ino, mutation === 'same-object-content');
      await assert.rejects(readPublishedOutputIdentity(stage), { code: 'PUBLISHED_OUTPUT_CHANGED' });
      await assert.rejects(readPublishedOutputIdentity(stage), { code: 'PUBLISHED_OUTPUT_CHANGED' });
      const cleanup = await cleanupStage(stage);
      assert.equal(cleanup.retained, method === 'verified-copy');
      assert.deepEqual(await fs.readFile(destination), Buffer.alloc(Number(before.size), 90));
    });
  }
}

function shiftObservedCtime(t, destination) {
  // Simulate consistent handle/path observations differing ONLY in ctime. This
  // tests the transition policy without relying on Windows attribute timing.
  const lstat = fs.lstat.bind(fs), open = fs.open.bind(fs);
  const shifted = stat => { stat.ctimeNs += 1n; return stat; };
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    const stat = await lstat(file, ...args);
    return file === destination && args[0]?.bigint ? shifted(stat) : stat;
  });
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === destination) {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...statArgs) => {
        const result = await stat(...statArgs);
        return statArgs[0]?.bigint ? shifted(result) : result;
      };
    }
    return handle;
  });
}

test('the owned-hard-link cleanup ctime exception is consumed and future observations remain strict', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage); await publishOutput(stage, destination);
  await readPublishedOutputIdentity(stage); await cleanupStage(stage);
  await readPublishedOutputIdentity(stage, { afterCleanup: true });
  shiftObservedCtime(t, destination);
  await assert.rejects(readPublishedOutputIdentity(stage, { afterCleanup: true }), { code: 'PUBLISHED_OUTPUT_CHANGED' });
});

for (const method of ['verified-copy', 'externally-removed-stage-link']) {
  test(`${method} cannot borrow an owned cleanup ctime exception`, async t => {
    const { stage, destination } = await fixture(t);
    await markStageValidated(stage);
    await publishOutput(stage, destination, method === 'verified-copy' ? { link: unsupported() } : {});
    await readPublishedOutputIdentity(stage);
    if (method === 'externally-removed-stage-link') await fs.unlink(stage.file);
    assert.deepEqual(await cleanupStage(stage), { retained: false });
    shiftObservedCtime(t, destination);
    await assert.rejects(readPublishedOutputIdentity(stage, { afterCleanup: true }), { code: 'PUBLISHED_OUTPUT_CHANGED' });
  });
}

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

for (const code of ['EACCES', 'EIO']) {
  test(`post-link ${code} remains uncertain publication with its cause and both names preserved`, async t => {
    const { stage, destination } = await fixture(t);
    await markStageValidated(stage);
    const lstat = fs.lstat;
    const cause = Object.assign(new Error('Injected destination observation failure'), { code });
    t.mock.method(fs, 'lstat', async (file, ...options) => {
      if (file === destination) throw cause;
      return lstat(file, ...options);
    });
    await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), error => {
      assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
      assert.equal(error.cause, cause);
      assert.match(error.message, /may already contain/);
      return true;
    });
    const cleanup = await cleanupStage(stage);
    assert.equal(cleanup.retained, true);
    assert.equal(cleanup.validationCurrent, false);
    assert.equal(await fs.readFile(destination, 'utf8'), 'validated new media');
    assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
  });
}

for (const mutation of ['same-size edit', 'same-size replacement']) {
  test(`exclusive-copy ${mutation} is not published as validated and cannot delete its good stage`, async t => {
    const { stage, destination } = await fixture(t);
    await markStageValidated(stage);
    const original = await fs.readFile(stage.file);
    const copy = fs.copyFile.bind(fs);
    t.mock.method(fs, 'copyFile', async (...args) => {
      await copy(...args);
      if (mutation === 'same-size replacement') await fs.rename(destination, `${destination}.first-copy`);
      await fs.writeFile(destination, Buffer.alloc(original.length, 88));
    });
    await assert.rejects(publishOutput(stage, destination, { link: unsupported() }), error => {
      assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
      assert.equal(error.cause.code, 'COPY_CONTENT_MISMATCH');
      return true;
    });
    const cleanup = await cleanupStage(stage);
    assert.equal(cleanup.retained, true);
    assert.equal(cleanup.validationCurrent, true);
    assert.deepEqual(await fs.readFile(stage.file), original);
    assert.deepEqual(await fs.readFile(destination), Buffer.alloc(original.length, 88));
  });
}

test('an ordinary verified exclusive copy reads each full file once with bounded buffers then permits staging cleanup', async t => {
  const { stage, destination } = await fixture(t, { seal: false });
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 7, 37);
  await fs.writeFile(stage.file, bytes);
  await sealStage(stage); await markStageValidated(stage);
  const open = fs.open.bind(fs), readTotals = new Map(), closed = new Set();
  t.mock.method(fs, 'open', async (file, mode, ...args) => {
    const handle = await open(file, mode, ...args);
    if ([stage.file, destination].includes(file)) {
      assert.equal(mode, 'r');
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        assert.ok(buffer.length <= 1024 * 1024);
        const result = await read(buffer, offset, length, position);
        readTotals.set(file, (readTotals.get(file) || 0) + result.bytesRead);
        return result;
      };
      handle.close = async () => { closed.add(file); return close(); };
    }
    return handle;
  });
  assert.equal(await publishOutput(stage, destination, { link: unsupported() }), true);
  assert.equal(readTotals.get(stage.file), bytes.length);
  assert.equal(readTotals.get(destination), bytes.length);
  assert.deepEqual(closed, new Set([stage.file, destination]));
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  assert.deepEqual(await fs.readFile(destination), bytes);
});

test('a same-size destination mutation during verification is uncertain even if the bytes were already read', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const original = await fs.readFile(stage.file), open = fs.open.bind(fs);
  let changed = false, closed = false;
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === destination && args[0] === 'r') {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!changed) { changed = true; await fs.writeFile(destination, Buffer.alloc(original.length, 89)); }
        return result;
      };
      handle.close = async () => { closed = true; return close(); };
    }
    return handle;
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupported() }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause.code, 'COPY_VERIFICATION_CHANGED');
    return true;
  });
  assert.equal(closed, true);
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.deepEqual(await fs.readFile(stage.file), original);
});

test('a destination replacement between lstat and open cannot borrow the prior pathname identity', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const original = await fs.readFile(stage.file), open = fs.open.bind(fs);
  let replaced = false;
  t.mock.method(fs, 'open', async (file, ...args) => {
    if (file === destination && args[0] === 'r' && !replaced) {
      replaced = true;
      await fs.rename(destination, `${destination}.old`);
      await fs.writeFile(destination, original);
    }
    return open(file, ...args);
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupported() }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause.code, 'COPY_VERIFICATION_CHANGED');
    return true;
  });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.deepEqual(await fs.readFile(stage.file), original);
  assert.deepEqual(await fs.readFile(destination), original);
});

test('a copied destination replaced after verification prevents removal of the validated stage', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const original = await fs.readFile(stage.file);
  assert.equal(await publishOutput(stage, destination, { link: unsupported() }), true);
  await fs.rename(destination, `${destination}.verified`);
  await fs.writeFile(destination, Buffer.alloc(original.length, 90));
  const cleanup = await cleanupStage(stage);
  assert.equal(cleanup.retained, true);
  assert.equal(cleanup.validationCurrent, true);
  assert.match(cleanup.reason, /copied destination changed/);
  assert.deepEqual(await fs.readFile(stage.file), original);
});

test('cancellation during copy verification closes the read handle and retains both names', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const controller = new AbortController(), open = fs.open.bind(fs);
  let reads = 0, closed = false;
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === stage.file && args[0] === 'r') {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...readArgs) => { reads++; const result = await read(...readArgs); controller.abort(); return result; };
      handle.close = async () => { closed = true; return close(); };
    }
    return handle;
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupported(), signal: controller.signal }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause.code, 'CANCELLED');
    return true;
  });
  assert.equal(reads, 1); assert.equal(closed, true);
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.equal(await fs.readFile(destination, 'utf8'), 'validated new media');
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'validated new media');
});

test('wrong publication guard cannot link; current or absent guards still preserve an existing destination',async t=>{
  const {stage,destination}=await fixture(t);await markStageValidated(stage);
  const data='existing no-overwrite winner';await fs.writeFile(destination,data,{flag:'wx'});
  let links=0;
  const link=(...args)=>{links++;return fs.link(...args);};
  for(const assertCurrent of [true,()=>true,async()=>{}])
    await assert.rejects(publishOutput(stage,destination,{link,assertCurrent}),{code:'INVALID_PUBLICATION_GUARD'});
  assert.equal(links,0);
  let checks=0;
  assert.equal(await publishOutput(stage,destination,{link,assertCurrent:()=>{checks++;}}),false);
  assert.equal(await publishOutput(stage,destination,{link}),false);
  assert.equal(checks,1);assert.equal(links,2);assert.equal(await fs.readFile(destination,'utf8'),data);
});
