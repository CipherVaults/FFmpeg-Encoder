'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStage, sealStage, markStageValidated, retainSealedStage, cleanupStage, publishOutput } = require('../src/outputs.cjs');

async function fixture(t) {
  const parent = path.resolve(__dirname, '../artifacts/completed-output-unit-tests');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(parent));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  const stage = await createStage(directory);
  await fs.writeFile(stage.file, 'completed dummy fixture');
  await sealStage(stage);
  return { stage, destination: path.join(directory, 'final.mkv') };
}

test('completed validated staging survives cleanup until publication and cannot be authorized by a copied path', async t => {
  const { stage } = await fixture(t);
  await assert.rejects(markStageValidated({ ...stage }), { code: 'INVALID_STAGE' });
  await markStageValidated(stage);
  const result = await cleanupStage(stage);
  assert.equal(result.retained, true);
  assert.equal(result.completed, true);
  assert.equal(result.validationCurrent, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  assert.equal((await cleanupStage(stage)).completed, true);
});

test('sealed evidence-failed output can be retained without becoming validated or publishable', async t => {
  const { stage, destination } = await fixture(t);
  await assert.rejects(retainSealedStage({ ...stage }, 'Evidence incomplete.'), { code: 'INVALID_STAGE' });
  await retainSealedStage(stage, 'Evidence incomplete; retained for diagnosis only.');
  const result = await cleanupStage(stage);
  assert.equal(result.retained, true); assert.equal(result.completed, false);
  assert.equal(result.sealed, true); assert.equal(result.validationCurrent, false);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_NOT_VALIDATED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('retention never confers authority after stage replacement or over an unrelated output', async t => {
  const { stage, destination } = await fixture(t);
  await retainSealedStage(stage, 'Collector deadline.');
  await fs.rename(stage.file, stage.file + '.preserved');
  await fs.writeFile(stage.file, 'Unrelated replacement');
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'Unrelated replacement');
  await assert.rejects(markStageValidated(stage), { code: 'STAGE_CHANGED' });
  await assert.rejects(publishOutput(stage, destination));
});

test('successfully published validated output remains while owned staging can be cleaned', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true }), true);
  assert.deepEqual(await cleanupStage(stage), { retained: false });
  assert.equal(await fs.readFile(destination, 'utf8'), 'completed dummy fixture');
  await assert.rejects(fs.stat(stage.directory), { code: 'ENOENT' });
});

test('collision retains completed staging and never overwrites existing output', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  await fs.writeFile(destination, 'existing protected output');
  assert.equal(await publishOutput(stage, destination, { atomicOnly: true }), false);
  assert.equal((await cleanupStage(stage)).completed, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing protected output');
});

test('cancel before publication retains completed staging; cancel after native commit never deletes the result', async t => {
  const first = await fixture(t);
  await markStageValidated(first.stage);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(publishOutput(first.stage, first.destination, { signal: stopped.signal }), { code: 'CANCELLED' });
  assert.equal((await cleanupStage(first.stage)).completed, true);
  await assert.rejects(fs.stat(first.destination), { code: 'ENOENT' });
  const second = await fixture(t);
  await markStageValidated(second.stage);
  const during = new AbortController();
  const link = async (source, destination) => { await fs.link(source, destination); during.abort(); };
  assert.equal(await publishOutput(second.stage, second.destination, { atomicOnly: true, signal: during.signal, link }), true);
  assert.deepEqual(await cleanupStage(second.stage), { retained: false });
  assert.equal(await fs.readFile(second.destination, 'utf8'), 'completed dummy fixture');
});

test('changed or replaced stage cannot be marked valid and is never published', async t => {
  const { stage, destination } = await fixture(t);
  await fs.appendFile(stage.file, ' mutated');
  await assert.rejects(markStageValidated(stage), { code: 'STAGE_CHANGED' });
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_CHANGED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('post-validation mutation is retained but never described as currently validated', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  await fs.appendFile(stage.file, ' changed after validation');
  await assert.rejects(publishOutput(stage, destination), { code: 'STAGE_CHANGED' });
  const retained = await cleanupStage(stage);
  assert.equal(retained.completed, true);
  assert.equal(retained.validationCurrent, false);
  assert.match(retained.reason, /current bytes are not approved/);
  assert.match(await fs.readFile(stage.file, 'utf8'), /changed after validation/);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('completed output remains retained across repeated unsuccessful publication attempts', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const link = async () => { throw Object.assign(new Error('Unavailable filesystem primitive'), { code: 'ENOTSUP' }); };
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true, link }), { code: 'ATOMIC_PUBLICATION_UNAVAILABLE' });
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(publishOutput(stage, destination, { signal: abort.signal }), { code: 'CANCELLED' });
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('a replaced validated stage is preserved but never inherits the prior validation', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const original = path.join(stage.directory, 'original-completed.mkv');
  await fs.rename(stage.file, original);
  await fs.writeFile(stage.file, 'replacement not validated');
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  const retained = await cleanupStage(stage);
  assert.equal(retained.retained, true);
  assert.notEqual(retained.validationCurrent, true);
  assert.equal(await fs.readFile(original, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'replacement not validated');
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});

test('a link added after validation preserves the completed stage and unrelated alias', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const alias = path.join(stage.directory, 'extra-name.mkv');
  await fs.link(stage.file, alias);
  await assert.rejects(publishOutput(stage, destination, { atomicOnly: true }), { code: 'STAGE_CHANGED' });
  const retained = await cleanupStage(stage);
  assert.equal(retained.retained, true);
  assert.equal(retained.validationCurrent, false);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(alias, 'utf8'), 'completed dummy fixture');
});

const unsupportedLink = async () => { throw Object.assign(new Error('Use distinct-folder copy'), { code: 'ENOTSUP' }); };

test('cancellation during exclusive copy retains both names without blessing an unverified copy', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const abort = new AbortController();
  const copy = fs.copyFile.bind(fs);
  t.mock.method(fs, 'copyFile', async (...args) => { await copy(...args); abort.abort(); });
  await assert.rejects(publishOutput(stage, destination, { signal: abort.signal, link: unsupportedLink }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause.code, 'CANCELLED');
    return true;
  });
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(destination, 'utf8'), 'completed dummy fixture');
});

test('replacement during the exclusive-copy window cannot be reported as validated publication', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const original = path.join(stage.directory, 'original-completed.mkv');
  const copy = fs.copyFile.bind(fs);
  t.mock.method(fs, 'copyFile', async (...args) => {
    await fs.rename(stage.file, original);
    await fs.writeFile(stage.file, 'unvalidated replacement');
    await copy(...args);
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupportedLink }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause.code, 'STAGE_CHANGED');
    return true;
  });
  assert.equal((await cleanupStage(stage)).retained, true);
  assert.equal(await fs.readFile(original, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(destination, 'utf8'), 'unvalidated replacement');
});

test('a copied destination that changes before its check stays uncertain and is never removed', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const copy = fs.copyFile.bind(fs);
  t.mock.method(fs, 'copyFile', async (...args) => {
    await copy(...args);
    await fs.writeFile(destination, 'different-size file');
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupportedLink }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.equal(await fs.readFile(destination, 'utf8'), 'different-size file');
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
});

test('post-copy observation error preserves its cause, completed stage and possible destination', async t => {
  const { stage, destination } = await fixture(t);
  await markStageValidated(stage);
  const lstat = fs.lstat.bind(fs);
  const cause = Object.assign(new Error('Destination observation unavailable'), { code: 'EACCES' });
  t.mock.method(fs, 'lstat', async (file, ...args) => {
    if (file === destination) throw cause;
    return lstat(file, ...args);
  });
  await assert.rejects(publishOutput(stage, destination, { link: unsupportedLink }), error => {
    assert.equal(error.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal((await cleanupStage(stage)).validationCurrent, true);
  assert.equal(await fs.readFile(destination, 'utf8'), 'completed dummy fixture');
  assert.equal(await fs.readFile(stage.file, 'utf8'), 'completed dummy fixture');
});
