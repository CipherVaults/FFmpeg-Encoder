const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStage, cleanupStage, publishOutput } = require('../src/outputs.cjs');

async function fixture(t) {
  const base = path.resolve(__dirname, '../artifacts/output-tests');
  await fs.mkdir(base, { recursive: true });
  const folder = await fs.mkdtemp(path.join(base, 'case-'));
  const stage = await createStage(folder);
  await fs.writeFile(stage.file, 'validated new media');
  t.after(async () => { await cleanupStage(stage); });
  return { folder, stage, destination: path.join(folder, 'result.mkv') };
}

test('publication and stage cleanup retain the completed output', async t => {
  const { stage, destination } = await fixture(t);
  assert.equal(await publishOutput(stage, destination), true);
  await cleanupStage(stage);
  assert.equal(await fs.readFile(destination, 'utf8'), 'validated new media');
});

test('existing output wins a publication race and is byte-for-byte preserved', async t => {
  const { stage, destination } = await fixture(t);
  await fs.writeFile(destination, 'irreplaceable existing output');
  assert.equal(await publishOutput(stage, destination), false);
  assert.equal(await fs.readFile(destination, 'utf8'), 'irreplaceable existing output');
});

test('exclusive-copy fallback also preserves an existing destination', async t => {
  const { stage, destination } = await fixture(t);
  const link = async () => { throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' }); };
  await fs.writeFile(destination, 'existing');
  assert.equal(await publishOutput(stage, destination, { link }), false);
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing');
  const other = path.join(path.dirname(destination), 'other.mkv');
  assert.equal(await publishOutput(stage, other, { link }), true);
  assert.equal(await fs.readFile(other, 'utf8'), 'validated new media');
});

test('cancel before publication leaves no destination and removes only owned staging', async t => {
  const { stage, destination } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(publishOutput(stage, destination, { signal: controller.signal }), { code: 'CANCELLED' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});
