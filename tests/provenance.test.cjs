'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { createOutputId, provenanceArgs, classifyMarker, historicalSuffix, samePublishedIdentity,
  ProvenanceJournal, PROVENANCE_NAMESPACE, PROVENANCE_LIMITS, HISTORICAL_SUFFIXES, MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');

const identity = (number = 1) => ({ canonicalPath: path.resolve(__dirname, `../artifacts/provenance-tests/media-${number}.mkv`),
  dev: '1', ino: String(number), size: '4096', mtimeNs: '10000000001', ctimeNs: '10000000002', birthtimeNs: '10000000003',
  sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` });
const marked = (outputId = createOutputId(), tags = {}) => ({ format: { tags: { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: outputId, ...tags } }, streams: [], chapters: [] });
const hash = text => createHash('sha256').update(text).digest('hex');

async function fixture(t, options = {}) {
  const base = path.resolve(__dirname, '../artifacts/provenance-tests');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  t.after(async () => {
    const relative = path.relative(base, root);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, journal: new ProvenanceJournal({ directory: root, ...options }) };
}
function intent(root, outputId = createOutputId(), number = 1) {
  return { outputId, sourceIdentity: identity(number), destination: path.join(root, `output-${number}.mkv`), profileId: 'h265-cpu' };
}
const recordFile = (journal, outputId, kind) => path.join(journal.directory, `${outputId}.${kind}.json`);

test('descriptive provenance preserves earlier CQ32 generations after the helper change and rejects contradictions', () => {
  const { describeRecipe, ARCHIVE_RECIPE } = require('../src/media.cjs');
  const { generationDescriptionOf, GENERATION_KEY } = require('../src/provenance.cjs');
  const settings = { profileId: 'h265-nvidia', preset: 'p7', quality: 32, recipeId: ARCHIVE_RECIPE.id };
  const recipe = describeRecipe(settings);
  const description = { version: 1, ...settings, codec: recipe.codec, backend: recipe.backend, encoder: recipe.encoder,
    qualityMode: recipe.qualityMode, bitDepth: 8, encoderArgs: recipe.args, appVersion: '0.6.0-dev.1', createdAt: '2026-09-19T12:00:00.000Z' };
  assert.deepEqual(generationDescriptionOf(description), description);
  const outputId = createOutputId();
  const valid = marked(outputId); valid.format.tags[GENERATION_KEY] = JSON.stringify(description);
  assert.deepEqual(classifyMarker(valid).previousGeneration, description);
  for (const mutate of [d => { d.backend = 'CPU'; }, d => { d.codec = 'H264'; }, d => { d.qualityMode = 'CRF'; },
    d => { d.encoderArgs = [...d.encoderArgs, '-y']; }, d => { d.preset = 'p1'; }, d => { d.createdAt = '2026-99-19T12:00:00.000Z'; },
    d => { d.recipeId = 'unknown-future'; }, d => { d.version = 2; }]) {
    const changed = structuredClone(description); mutate(changed);
    assert.equal(generationDescriptionOf(changed), null);
    const probe = marked(outputId); probe.format.tags[GENERATION_KEY] = JSON.stringify(changed);
    const result = classifyMarker(probe); assert.equal(result.kind, 'generated'); assert.equal(result.outputId, outputId);
    assert.equal(result.previousGeneration, undefined); assert.match(result.descriptionNotice, /unavailable/);
  }
});
async function rewrite(filename, mutate) {
  const record = JSON.parse(await fs.readFile(filename, 'utf8'));
  mutate(record);
  const { checksum, ...body } = record;
  const serialized = JSON.stringify({ ...body, checksum: hash(JSON.stringify(body)) });
  await fs.writeFile(filename, serialized);
  return serialized;
}

test('main-generated UUID and fixed metadata arguments have a strict versioned marker', () => {
  const outputId = createOutputId();
  assert.match(outputId, /^[a-f0-9-]{36}$/);
  assert.notEqual(createOutputId(), outputId);
  assert.deepEqual(provenanceArgs(outputId), ['-metadata', 'FFMPEG_ENCODER_PROVENANCE=1', '-metadata', `FFMPEG_ENCODER_OUTPUT_ID=${outputId}`]);
  assert.deepEqual(classifyMarker(marked(outputId)), { kind: 'generated', outputId, reason: 'Recognized application-generated output.' });
  for (const invalid of ['', 'id', null, 1, `${outputId}\n`, '../../output']) assert.throws(() => provenanceArgs(invalid));
});

test('marker keys and UUID casing are normalized; ordinary media tags remain unmarked', () => {
  const outputId = createOutputId();
  assert.equal(classifyMarker({ format: { tags: { ffmpeg_encoder_provenance: '1', ffmpeg_encoder_output_id: outputId.toUpperCase() } } }).outputId, outputId);
  assert.equal(classifyMarker({ format: { tags: { title: 'Source', encoder: 'Lavf' } }, streams: [{ tags: { language: 'eng' } }], chapters: [{ tags: { title: 'Opening' } }] }).kind, 'unmarked');
});

test('partial, malformed, unknown-version, duplicate and unknown reserved markers always fail conservatively', () => {
  const outputId = createOutputId();
  const cases = [
    { [MARKER_KEY]: '1' }, { [OUTPUT_ID_KEY]: outputId },
    { [MARKER_KEY]: '2', [OUTPUT_ID_KEY]: outputId },
    { [MARKER_KEY]: 1, [OUTPUT_ID_KEY]: outputId },
    { [MARKER_KEY]: ' 1', [OUTPUT_ID_KEY]: outputId },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: '' },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: `${outputId}\n` },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: { value: outputId } },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: outputId, ffmpeg_encoder_output_id: outputId },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: outputId, ffmpeg_encoder_provenance: '2' },
    { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: outputId, FFMPEG_ENCODER_FUTURE: 'anything' },
    { ffmpeg_encoder_future: 'anything' },
  ];
  for (const tags of cases) assert.equal(classifyMarker({ format: { tags } }).kind, 'suspicious', JSON.stringify(tags));
});

test('reserved stream/chapter tags are suspicious even beside otherwise valid global markers', () => {
  for (const collection of ['streams', 'chapters']) {
    for (const key of [MARKER_KEY, OUTPUT_ID_KEY, 'ffmpeg_encoder_unknown']) {
      const probe = marked();
      probe[collection] = [{ tags: { [key]: 'anything' } }];
      assert.equal(classifyMarker(probe).kind, 'suspicious');
      delete probe.format.tags;
      assert.equal(classifyMarker(probe).kind, 'suspicious');
    }
  }
  for (const malformed of [null, [], { format: { tags: [] } }, { streams: {} }, { chapters: [null] }]) assert.equal(classifyMarker(malformed).kind, 'suspicious');
});

test('all six historical suffixes are recognized without any current hardware or profile input', () => {
  assert.equal(HISTORICAL_SUFFIXES.length, 6);
  for (const suffix of HISTORICAL_SUFFIXES) {
    assert.equal(historicalSuffix(`Recording_${suffix}.mkv`), suffix);
    assert.equal(historicalSuffix(`D:\\fixture\\Recording_${suffix.toUpperCase()}.MKV`), suffix);
    assert.equal(historicalSuffix(`Recording_H265-CPU_${suffix}.mkv`), suffix);
  }
  for (const name of ['Recording.mkv', 'Recording_H265-CPU_extra.mkv', 'H265-CPU.mkv', 'Recording_H264-AMD-GPU.mkv', null]) assert.equal(historicalSuffix(name), null);
});

test('journal intent and final record survive restart in a separate namespace and cannot be overridden', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  const prepared = await journal.recordIntent(input);
  assert.equal(journal.directory, path.join(root, PROVENANCE_NAMESPACE));
  assert.equal(prepared.kind, 'intent');
  assert.equal(await journal.lookupIdentity(identity(2)), null);
  await journal.recordPublished(input.outputId, identity(2));
  const restarted = new ProvenanceJournal({ directory: root });
  const match = await restarted.lookupIdentity(identity(2));
  assert.equal(match.outputId, input.outputId);
  match.outputIdentity.ino = '999';
  assert.equal((await restarted.lookupIdentity(identity(2))).outputIdentity.ino, '2');
  await assert.rejects(restarted.recordIntent(input), /already has/);
  assert.equal((await restarted.recordPublished(input.outputId, identity(2))).outputId, input.outputId);
  await assert.rejects(restarted.recordPublished(input.outputId, identity(3)), /different published identity/);
  assert.equal((await fs.readdir(journal.directory)).length, 2);
});

test('real renamed file retains reliable index identity; a byte-for-byte copy needs its retained media marker', async t => {
  const { root, journal } = await fixture(t);
  const original = path.join(root, 'original.mkv');
  const renamed = path.join(root, 'renamed.mkv');
  const copied = path.join(root, 'copy.mkv');
  await fs.writeFile(original, Buffer.alloc(8192, 42));
  const before = await readSourceIdentity(original);
  const input = intent(root);
  await journal.recordIntent(input);
  await journal.recordPublished(input.outputId, before);
  await fs.rename(original, renamed);
  const after = await readSourceIdentity(renamed);
  assert.equal((await journal.lookupIdentity(after)).outputId, input.outputId);
  assert.equal(samePublishedIdentity(before, after), true);
  await fs.copyFile(renamed, copied);
  assert.equal(await journal.lookupIdentity(await readSourceIdentity(copied)), null);
  assert.equal(classifyMarker(marked(input.outputId)).kind, 'generated');
});

test('index matching requires object identity, creation time, size and sparse content; incomplete identity never matches', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  await journal.recordIntent(input);
  await journal.recordPublished(input.outputId, identity());
  for (const [field, value] of Object.entries({ dev: '2', ino: '2', birthtimeNs: '4', size: '4097', sparseDigest: `sha256-sparse-v1:${'c'.repeat(64)}` })) {
    assert.equal(await journal.lookupIdentity({ ...identity(), [field]: value }), null, field);
  }
  for (const field of ['dev', 'ino', 'birthtimeNs', 'size']) assert.equal(await journal.lookupIdentity({ ...identity(), [field]: '0' }), null, field);
  const incomplete = identity(); delete incomplete.sparseDigest;
  assert.equal(await journal.lookupIdentity(incomplete), null);
  assert.equal((await journal.lookupIdentity({ ...identity(), canonicalPath: path.join(root, 'renamed.mkv'), ctimeNs: '900', mtimeNs: '901' })).outputId, input.outputId);
});

test('required intent failure throws and cleans only its owned temporary record', async t => {
  const { root, journal } = await fixture(t);
  const sentinel = path.join(root, 'original.mkv');
  await fs.writeFile(sentinel, 'original bytes');
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('Injected link failure'), { code: 'EPERM' }); });
  await assert.rejects(journal.recordIntent(intent(root)), /Injected link failure/);
  assert.deepEqual(await fs.readdir(journal.directory), []);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'original bytes');
  assert.match(journal.warning, /Required publication intent was not recorded/);
});

test('failure of final bookkeeping preserves a valid output and pending intent for read-only recovery', async t => {
  const { root, journal } = await fixture(t, { maxRecords: 1 });
  const input = intent(root);
  await journal.recordIntent(input);
  const savedIntent = await fs.readFile(recordFile(journal, input.outputId, 'intent'), 'utf8');
  await fs.writeFile(input.destination, 'completed output fixture');
  await assert.rejects(journal.recordPublished(input.outputId, identity(2)), /capacity/);
  const recovery = await journal.recover({ inspectDestination: async () => ({ marker: classifyMarker(marked(input.outputId)) }) });
  assert.deepEqual(recovery.matching, [{ outputId: input.outputId, destination: input.destination, pending: true }]);
  assert.equal(await fs.readFile(input.destination, 'utf8'), 'completed output fixture');
  assert.equal(await fs.readFile(recordFile(journal, input.outputId, 'intent'), 'utf8'), savedIntent);
  assert.equal((await fs.readdir(journal.directory)).length, 1);
  assert.match(recovery.warnings.join('\n'), /pending/);
});

test('recovery distinguishes matching marker, absent destination, unrelated winner and uncertainty without media mutations', async t => {
  const { root, journal } = await fixture(t);
  const pending = Array.from({ length: 6 }, (_, i) => intent(root, createOutputId(), i + 1));
  for (const item of pending) await journal.recordIntent(item);
  const before = new Map(await Promise.all((await fs.readdir(journal.directory)).map(async name => [name, await fs.readFile(path.join(journal.directory, name), 'utf8')])));
  const inspections = [
    { marker: classifyMarker(marked(pending[0].outputId)) }, null,
    { marker: classifyMarker(marked(createOutputId())) },
    { marker: { kind: 'unmarked' }, identity: identity(90) },
    { marker: { kind: 'suspicious' } }, null,
  ];
  const summary = await journal.recover({ inspectDestination: async destination => {
    const index = pending.findIndex(item => item.destination === destination);
    if (index === 5) throw new Error('Injected read failure');
    return inspections[index];
  } });
  assert.equal(summary.matching.length, 1);
  assert.equal(summary.absent.length, 1);
  assert.equal(summary.unrelated.length, 2);
  assert.equal(summary.uncertain.length, 2);
  assert.equal(summary.pendingRemaining, 0);
  assert.deepEqual(await fs.readdir(root), [PROVENANCE_NAMESPACE]);
  for (const [name, bytes] of before) assert.equal(await fs.readFile(path.join(journal.directory, name), 'utf8'), bytes);
});

test('startup recovery skips completed pairs and bounds pending media inspections', async t => {
  const { root, journal } = await fixture(t);
  const completed = intent(root);
  await journal.recordIntent(completed);
  await journal.recordPublished(completed.outputId, identity(2));
  for (let i = 0; i < 3; i += 1) await journal.recordIntent(intent(root, createOutputId(), i + 10));
  const inspected = [];
  const summary = await journal.recover({ maxPending: 2, inspectDestination: async destination => { inspected.push(destination); return null; } });
  assert.equal(inspected.length, 2);
  assert.equal(inspected.includes(completed.destination), false);
  assert.equal(summary.absent.length, 2);
  assert.equal(summary.pendingRemaining, 1);
  assert.match(summary.warnings.join('\n'), /additional pending intents/);
  await assert.rejects(journal.recover({ maxPending: 129, inspectDestination: async () => null }), /bounded/);
});

test('unknown schema, checksum corruption, partial JSON and duplicate record fields are preserved with warnings', async t => {
  for (const corrupt of [
    async filename => rewrite(filename, record => { record.version = 2; }),
    async filename => { const bytes = await fs.readFile(filename, 'utf8'); await fs.writeFile(filename, bytes.replace('"size":"4096"', '"size":"4097"')); },
    async filename => fs.writeFile(filename, '{"version":1'),
    async filename => { const bytes = await fs.readFile(filename, 'utf8'); await fs.writeFile(filename, bytes.replace('"version":1', '"version":2,"version":1')); },
  ]) {
    const { root, journal } = await fixture(t);
    const input = intent(root);
    await journal.recordIntent(input);
    await journal.recordPublished(input.outputId, identity(2));
    const filename = recordFile(journal, input.outputId, 'published');
    await corrupt(filename);
    const bytes = await fs.readFile(filename, 'utf8');
    const restarted = new ProvenanceJournal({ directory: root });
    assert.equal(await restarted.lookupIdentity(identity(2)), null);
    assert.ok(restarted.warnings.length > 0);
    const summary = await restarted.recover({ inspectDestination: async () => null });
    assert.ok(summary.uncertain.length > 0);
    assert.equal(await fs.readFile(filename, 'utf8'), bytes);
    await assert.rejects(restarted.recordPublished(input.outputId, identity(2)));
    assert.equal(await fs.readFile(filename, 'utf8'), bytes);
  }
});

test('unknown files and interrupted temporary records remain untouched and cannot supply cleanup authority', async t => {
  const { root, journal } = await fixture(t);
  await fs.mkdir(journal.directory);
  const names = ['foreign.json', 'old.intent.json.interrupted.tmp'];
  for (const name of names) await fs.writeFile(path.join(journal.directory, name), 'preserve me');
  const summary = await journal.recover({ inspectDestination: async () => { assert.fail('Unknown records must not trigger media inspection.'); } });
  assert.equal(summary.uncertain.length, 2);
  await journal.recordIntent(intent(root));
  for (const name of names) assert.equal(await fs.readFile(path.join(journal.directory, name), 'utf8'), 'preserve me');
});

test('a published record without valid intent cannot independently establish index recognition', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  await journal.recordIntent(input);
  await journal.recordPublished(input.outputId, identity(2));
  await fs.unlink(recordFile(journal, input.outputId, 'intent'));
  const restarted = new ProvenanceJournal({ directory: root });
  assert.equal(await restarted.lookupIdentity(identity(2)), null);
  assert.match(restarted.warning, /lacks valid intent/);
  assert.equal((await fs.readdir(journal.directory)).length, 1);
});

test('record count, total bytes and individual size bounds preserve records rather than evicting identity evidence', async t => {
  const { root, journal } = await fixture(t, { maxRecords: 2 });
  const input = intent(root);
  await journal.recordIntent(input);
  await journal.recordPublished(input.outputId, identity(2));
  await assert.rejects(journal.recordIntent(intent(root)), /capacity/);
  assert.equal((await fs.readdir(journal.directory)).length, 2);
  const small = await fixture(t, { maxRecordBytes: 128 });
  await assert.rejects(small.journal.recordIntent(intent(small.root)), /capacity/);
  assert.deepEqual(await fs.readdir(small.journal.directory), []);
  const byteLimited = await fixture(t, { maxBytes: 128 });
  await assert.rejects(byteLimited.journal.recordIntent(intent(byteLimited.root)), /capacity/);
  assert.throws(() => new ProvenanceJournal({ directory: root, maxRecords: PROVENANCE_LIMITS.records + 1 }));
});

test('oversized existing namespace produces bounded uncertainty and blocks new intents without deleting files', async t => {
  const { root, journal } = await fixture(t, { maxRecords: 1 });
  await fs.mkdir(journal.directory);
  await fs.writeFile(path.join(journal.directory, 'foreign-a'), 'a');
  await fs.writeFile(path.join(journal.directory, 'foreign-b'), 'b');
  const summary = await journal.recover({ inspectDestination: async () => null });
  assert.ok(summary.uncertain.some(item => item.reason.includes('bounds')));
  await assert.rejects(journal.recordIntent(intent(root)), /capacity/);
  assert.equal((await fs.readdir(journal.directory)).length, 2);
});

test('hard-linked journal records are rejected without touching the other name or source media', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  await journal.recordIntent(input);
  const filename = recordFile(journal, input.outputId, 'intent');
  const alias = path.join(root, 'record-alias.json');
  await fs.link(filename, alias);
  const bytes = await fs.readFile(alias, 'utf8');
  const restarted = new ProvenanceJournal({ directory: root });
  await assert.rejects(restarted.recordPublished(input.outputId, identity(2)), /Unsafe/);
  assert.equal(await fs.readFile(alias, 'utf8'), bytes);
  assert.equal(await fs.readFile(filename, 'utf8'), bytes);
});

test('concurrent API calls serialize and a failed write does not poison later work', async t => {
  const { root, journal } = await fixture(t);
  const first = intent(root);
  const second = intent(root, createOutputId(), 2);
  const results = await Promise.allSettled([journal.recordIntent(first), journal.recordIntent(first), journal.recordIntent(second)]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  await journal.recordPublished(second.outputId, identity(3));
  assert.equal((await journal.lookupIdentity(identity(3))).outputId, second.outputId);
});

test('missing index never changes marker or historical suffix recognition', async t => {
  const { journal } = await fixture(t);
  assert.equal(await journal.lookupIdentity(identity()), null);
  assert.equal(classifyMarker(marked()).kind, 'generated');
  assert.equal(classifyMarker({ format: { tags: { [MARKER_KEY]: 'future' } } }).kind, 'suspicious');
  assert.equal(historicalSuffix('renamed_H265-Nvidia-GPU.mkv'), 'H265-Nvidia-GPU');
});

test('unavailable journal namespace degrades recognition with notice but rejects required intent', async t => {
  const { root, journal } = await fixture(t);
  await fs.writeFile(journal.directory, 'unrelated preserved file');
  assert.equal(await journal.lookupIdentity(identity()), null);
  assert.match(journal.warning, /unavailable/);
  await assert.rejects(journal.recordIntent(intent(root)), /regular app-owned directory/);
  assert.equal(await fs.readFile(journal.directory, 'utf8'), 'unrelated preserved file');
});

test('a durable intent is revalidated before final recording after in-process corruption', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  await journal.recordIntent(input);
  const filename = recordFile(journal, input.outputId, 'intent');
  await fs.writeFile(filename, 'interrupted JSON');
  await assert.rejects(journal.recordPublished(input.outputId, identity(2)));
  assert.equal(await fs.readFile(filename, 'utf8'), 'interrupted JSON');
  assert.equal((await fs.readdir(journal.directory)).length, 1);
});

test('oversized existing recognized record is preserved and excluded before parsing', async t => {
  const { root, journal } = await fixture(t);
  const input = intent(root);
  await journal.recordIntent(input);
  await journal.recordPublished(input.outputId, identity(2));
  const filename = recordFile(journal, input.outputId, 'published');
  const oversized = 'x'.repeat(PROVENANCE_LIMITS.recordBytes + 1);
  await fs.writeFile(filename, oversized);
  const restarted = new ProvenanceJournal({ directory: root });
  assert.equal(await restarted.lookupIdentity(identity(2)), null);
  assert.match(restarted.warnings.join('\n'), /oversized/);
  assert.equal(await fs.readFile(filename, 'utf8'), oversized);
});
