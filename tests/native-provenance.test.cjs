'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { NATIVE_PROFILES, UPLOAD_PIPELINE, POLICY_VERSION, validateNativeEncoderSettings, nativeEncoderContribution, nativeContribution } = require('../src/backend-adapters.cjs');
const { generationDescriptionOf, provenanceArgs, classifyMarker, createOutputId, MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY, PROVENANCE_NAMESPACE, ProvenanceJournal } = require('../src/provenance.cjs');
const fixtures = require('./fixtures/native-live-contributions-v1.json');
const settings = (profile, mode) => ({ preset: profile.operationalSeed.preset, mode, quality: profile.modes[mode].seed });
function description(profileId = 'h265-qsv', mode = 'cqp', quality = { i: 22, p: 25, b: 28 }, bitDepth = 10) {
  const profile = NATIVE_PROFILES.find(row => row.id === profileId), value = { preset: profile.operationalSeed.preset, mode, quality };
  const fragment = nativeEncoderContribution(profileId, value, { bitDepth, pipelineId: UPLOAD_PIPELINE });
  return { version: 2, kind: 'native-encoder', adapterPolicyVersion: POLICY_VERSION, profileId, codec: profile.codec, backend: profile.backend, encoder: profile.encoder,
    preset: value.preset, qualityMode: profile.modes[mode].label, quality: structuredClone(fragment.settings.quality), bitDepth, pipelineId: UPLOAD_PIPELINE, encoderArgs: [...fragment.args],
    settingsRole: 'requested', scope: 'native-encoder-contribution-only', appVersion: '0.7.0-alpha.1', createdAt: '2026-10-26T08:00:00.000Z' };
}
const marked = value => ({ format: { tags: { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: createOutputId(), [GENERATION_KEY]: JSON.stringify(value) } } });
test('all twenty pre-refactor live contribution fixtures retain the exact DTO, args and device requirements', () => {
  assert.equal(fixtures.cases.length, 20);
  for (const row of fixtures.cases) assert.deepEqual(nativeContribution(row.profileId, row.settings, row.trusted), row.expected);
});
test('device-free native fragments cover every offered profile, mode, depth and quality boundary without session authority', () => {
  for (const profile of NATIVE_PROFILES) for (const [mode, spec] of Object.entries(profile.modes)) for (const bitDepth of profile.bitDepths) for (const quality of [spec.min, spec.max]) {
    const input = { ...settings(profile, mode), quality }, fragment = nativeEncoderContribution(profile.id, input, { bitDepth });
    assert.equal(fragment.executionAuthority, 'none'); assert.equal(fragment.scope, 'native-encoder-contribution-only'); assert.equal(fragment.bitDepth, bitDepth);
    for (const key of ['deviceId', 'deviceArgs', 'requiredEvidence', 'receipt', 'available', 'verified']) assert.equal(Object.hasOwn(fragment, key), false);
    assert.ok(!fragment.args.includes('-init_hw_device')); assert.ok(Object.isFrozen(fragment)); assert.ok(Object.isFrozen(fragment.args));
    input.quality = 'edited'; assert.notEqual(fragment.settings.quality, 'edited');
    if (spec.fields) { assert.deepEqual(Object.keys(fragment.settings.quality), spec.fields); assert.ok(Object.isFrozen(fragment.settings.quality)); }
  }
});
test('native encoder records reject hidden/accessor/foreign-device/unknown fields and invalid scales without coercion', () => {
  const valid = { preset: 'medium', mode: 'cqp', quality: { i: 22, p: 25, b: 28 } }; let getterCalls = 0;
  const getter = { ...valid }; Object.defineProperty(getter, 'quality', { enumerable: true, get() { getterCalls++; return 25; } });
  const hidden = { ...valid }; Object.defineProperty(hidden, 'preset', { enumerable: false, value: 'medium' });
  for (const value of [getter, hidden, { ...valid, deviceId: randomUUID() }, { ...valid, quality: { i: 22, p: 25 } }, { ...valid, quality: '25' },
    { ...valid, quality: -1 }, { ...valid, mode: 'qvbr' }, { ...valid, [Symbol('extra')]: 1 }, { ...valid, quality: { i: 1, p: 2, b: 3, extra: 4 } }]) {
    assert.throws(() => validateNativeEncoderSettings('h264-qsv', value));
  }
  assert.equal(getterCalls, 0);
  for (const configuration of [{ bitDepth: 10 }, { bitDepth: 12 }, { bitDepth: 8, pipelineId: undefined }, { bitDepth: 8, device: {} }]) {
    assert.throws(() => nativeEncoderContribution('h264-qsv', valid, configuration));
  }
});
test('native descriptions retain asymmetric CQP, AMF HEVC I/P, ICQ, QVBR and AV1 scales without a device', () => {
  for (const value of [description(), description('h265-amf', 'cqp', { i: 20, p: 27 }), description('h264-qsv', 'icq', 29, 8),
    description('av1-amf', 'qvbr', 37), description('av1-qsv', 'cqp', { i: 111, p: 128, b: 143 })]) {
    const result = generationDescriptionOf(value); assert.deepEqual(result, value); assert.notEqual(result, value);
    const probe = marked(value), id = probe.format.tags[OUTPUT_ID_KEY], marker = classifyMarker(probe);
    assert.equal(marker.kind, 'generated'); assert.equal(marker.outputId, id); assert.deepEqual(marker.previousGeneration, value);
    const args = provenanceArgs(id, value); assert.equal(args[1], MARKER_KEY + '=1'); assert.equal(args[3], OUTPUT_ID_KEY + '=' + id);
    assert.equal(JSON.parse(args[5].slice(GENERATION_KEY.length + 1)).version, 2);
  }
});
test('native descriptions reject contradictions, authority/source fields and noncanonical encoder contributions while retaining marker identity', () => {
  const value = description();
  const mutations = [v => { v.version = 3; }, v => { v.kind = 'ordinary'; }, v => { v.adapterPolicyVersion = 2; }, v => { v.profileId = 'h264-cpu'; },
    v => { v.codec = 'AV1'; }, v => { v.backend = 'amf'; }, v => { v.encoder = 'libx265'; }, v => { v.preset = 'p7'; },
    v => { v.qualityMode = 'CRF'; }, v => { v.quality = 25; }, v => { v.quality.b = 999; }, v => { v.bitDepth = 12; },
    v => { v.pipelineId = 'other'; }, v => { v.settingsRole = 'effective'; }, v => { v.scope = 'file-job'; }, v => { v.createdAt = '2026-02-30T08:00:00.000Z'; },
    v => { v.encoderArgs.reverse(); }, v => { v.encoderArgs.push('-y'); }, v => { v.encoderArgs[1] = 'hevc_amf'; },
    v => { v.runtimeVersion = 'x'.repeat(257); }, v => { v.runtimeVersion = 'line\nend'; },
    ...['deviceId', 'cellId', 'revision', 'available', 'verified', 'fileExecutionReady', 'deviceArgs', 'sourceHash', 'recipeId', 'outputPath', 'hdrPolicy'].map(key => v => { v[key] = 'forbidden'; })];
  for (const mutate of mutations) {
    const changed = structuredClone(value); mutate(changed); assert.equal(generationDescriptionOf(changed), null);
    const probe = marked(changed), id = probe.format.tags[OUTPUT_ID_KEY], marker = classifyMarker(probe);
    assert.equal(marker.kind, 'generated'); assert.equal(marker.outputId, id); assert.equal(marker.previousGeneration, undefined);
  }
});
test('native description traversal rejects getters, sparse/exotic arrays and oversized data before serialization', () => {
  let calls = 0; const accessor = description(); Object.defineProperty(accessor, 'quality', { enumerable: true, get() { calls++; return 25; } });
  assert.equal(generationDescriptionOf(accessor), null);
  const arrayAccessor = description(); Object.defineProperty(arrayAccessor.encoderArgs, '0', { enumerable: true, get() { calls++; return '-c:v:0'; } });
  assert.equal(generationDescriptionOf(arrayAccessor), null);
  const exotic = description(); Object.setPrototypeOf(exotic.encoderArgs, { toJSON() { calls++; return []; } });
  assert.equal(generationDescriptionOf(exotic), null);
  const sparse = description(); delete sparse.encoderArgs[0]; assert.equal(generationDescriptionOf(sparse), null);
  const oversized = description(); oversized.encoderArgs = Array(64).fill('x'.repeat(128)); assert.equal(generationDescriptionOf(oversized), null);
  const hidden = description(); Object.defineProperty(hidden, 'scope', { enumerable: false, value: hidden.scope }); assert.equal(generationDescriptionOf(hidden), null);
  assert.equal(calls, 0);
});
test('duplicate/noncanonical native JSON and duplicate generation tags preserve generated exclusion', () => {
  const value = description(), text = JSON.stringify(value), probe = marked(value);
  for (const changed of [' ' + text, text.replace('"version":2', '"version":2,"version":2')]) {
    probe.format.tags[GENERATION_KEY] = changed; const marker = classifyMarker(probe);
    assert.equal(marker.kind, 'generated'); assert.equal(marker.previousGeneration, undefined);
  }
  const duplicate = marked(value); duplicate.streams = [{ tags: { [GENERATION_KEY]: text } }];
  assert.equal(classifyMarker(duplicate).previousGeneration, undefined);
});
test('native descriptive payload survives the v1 journal without migrating identity or producing a file', async () => {
  const root = path.resolve('artifacts/native-provenance-tests', randomUUID()); await fs.mkdir(root, { recursive: true });
  const journal = new ProvenanceJournal({ directory: root }), value = description(), outputId = createOutputId();
  const sourceIdentity = { canonicalPath: path.join(root, 'source-not-created.mkv'), dev: '1', ino: '2', size: '4096', mtimeNs: '1', ctimeNs: '2', birthtimeNs: '3', sparseDigest: 'sha256-sparse-v1:' + 'b'.repeat(64) };
  const destination = path.join(root, 'output-not-created.mkv');
  const intent = await journal.recordIntent({ outputId, sourceIdentity, destination, profileId: value.profileId, generationDescription: value });
  assert.equal(intent.namespace, PROVENANCE_NAMESPACE); assert.equal(intent.version, 1); assert.equal(intent.outputId, outputId);
  assert.deepEqual(intent.generationDescription, value);
  const record = await fs.readFile(path.join(journal.directory, outputId + '.intent.json'), 'utf8');
  assert.deepEqual(JSON.parse(record).generationDescription, value); assert.equal(require('node:fs').existsSync(destination), false);
});
