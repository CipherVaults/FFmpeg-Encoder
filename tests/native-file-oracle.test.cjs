'use strict';
// Exact-reference native file oracle. Role results are synthetic; template
// receipts are genuine observations of synthetic Matroska stage files.
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { validateNativeFileReference, joinNativeFileOracle, nativeProbeRecord, NATIVE_FILE_FRAME_BYTES } = require('../src/native-file-oracle.cjs');
const { inspectNativeFileTemplate, observeNativeFileTemplate } = require('../src/native-file-template.cjs');
const { FRAMES, nativeCommand, matroska, probeText } = require('./fixtures/native-file-fixtures.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');

const sha = text => createHash('sha256').update(text).digest('hex');
const code = expected => error => error.code === 'NATIVE_ORACLE_' + expected;
const RAW = { source: sha('source decoded frames'), output: sha('output decoded frames') };
let root;

// One independently "qualified" run (A) defines the reference; job B differs
// only in its fresh output UUID and createdAt, which the oracle must accept.
let stageCount = 0;
async function job(outputId, createdAt, edits = {}) {
  const stage = path.join(root, `stage-${++stageCount}.mkv`);
  const { contract, command } = nativeCommand(outputId, createdAt, undefined, stage), bytes = matroska(command, edits.matroska);
  await fs.writeFile(stage, bytes);
  const template = await observeNativeFileTemplate(stage, command, { maximumBytes: bytes.length, deadlineAt: Date.now() + 60000 });
  const roles = {
    'source-metadata': { kind: 'source-metadata', evidenceComplete: true, text: probeText({ role: 'source', command, edit: edits.source }) },
    'output-metadata': { kind: 'output-metadata', evidenceComplete: true, text: probeText({ role: 'output', command, bytes: bytes.length, edit: edits.output }) },
    'source-raw': { kind: 'source-raw', evidenceComplete: true, bytes: FRAMES * NATIVE_FILE_FRAME_BYTES, sha256: RAW.source, ...edits.sourceRaw },
    'output-raw': { kind: 'output-raw', evidenceComplete: true, bytes: FRAMES * NATIVE_FILE_FRAME_BYTES, sha256: RAW.output, ...edits.outputRaw },
  };
  return { contract, command, template, roles, bytes, sourceSha256: sha('complete source bytes') };
}
function referenceFrom(a) {
  const meta = role => nativeProbeRecord(a.roles[`${role}-metadata`].text, { role: `${role}-metadata`, contract: a.contract, command: a.command });
  const s = meta('source'), o = meta('output');
  return { version: 1, id: 'synthetic-reference-a', contractId: a.contract.id, frames: FRAMES,
    source: { fileSha256: a.sourceSha256, rawSha256: RAW.source, metadataSha256: s.metadataSha256, timelineSha256: s.timelineSha256 },
    output: { rawSha256: RAW.output, metadataSha256: o.metadataSha256, timelineSha256: o.timelineSha256,
      templateSha256: a.template.templateSha256, templateManifestSha256: a.template.manifestSha256, templateBytes: a.template.bytes },
    proof: { evidenceIds: ['synthetic-qualification-report'], reportSha256: sha('synthetic qualification report') } };
}
let A, REFERENCE, ready;
// One shared temporary stage folder and qualifying run for the whole file.
const setup = () => ready ||= (async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffenc-native-oracle-'));
  process.once('exit', () => require('node:fs').rmSync(root, { recursive: true, force: true }));
  A = await job('44444444-4444-4444-8444-444444444444', '2026-10-26T12:00:00.000Z'); REFERENCE = referenceFrom(A);
})();
const join = (j, reference = REFERENCE) => joinNativeFileOracle({ reference, contract: j.contract, command: j.command, sourceSha256: j.sourceSha256, roles: j.roles, template: j.template });
const B = edits => job('66666666-6666-4666-8666-666666666666', '2026-10-29T23:59:59.999Z', edits);

test('a fresh job that is an exact member of the qualified reference passes every check without authority', async () => {
  await setup();
  const b = await B(), result = join(b);
  assert.deepEqual(result.checks, ['source-raw', 'source-timeline', 'source-metadata', 'output-raw', 'output-timeline', 'output-metadata', 'output-template']);
  assert.equal(result.executionAuthority, 'none'); assert.equal(result.outputSha256, b.template.sha256); assert.ok(Object.isFrozen(result));
});

test('reference rows are inert, exact, versioned data', async () => {
  await setup();
  assert.ok(Object.isFrozen(validateNativeFileReference(REFERENCE)));
  const bad = [
    { ...REFERENCE, extra: 1 }, { ...REFERENCE, version: 2 }, { ...REFERENCE, frames: 14 }, { ...REFERENCE, contractId: 'other' },
    { ...REFERENCE, source: { ...REFERENCE.source, rawSha256: 'A'.repeat(64) } }, { ...REFERENCE, output: { ...REFERENCE.output, templateBytes: 0 } },
    { ...REFERENCE, proof: { ...REFERENCE.proof, evidenceIds: [] } }, Object.defineProperty({ ...REFERENCE }, 'id', { get: () => 'x', enumerable: true }),
  ];
  for (const value of bad) assert.throws(() => validateNativeFileReference(value), code('REFERENCE'));
});

test('any difference in source, decoded frames, metadata, timeline or coded bytes refuses membership', async () => {
  await setup();
  const cases = [
    [{ ...(await B()), sourceSha256: sha('other source') }, 'SOURCE'],
    [await B({ outputRaw: { sha256: sha('different output frames') } }), 'RAW'],
    [await B({ sourceRaw: { bytes: (FRAMES - 1) * NATIVE_FILE_FRAME_BYTES } }), 'RAW'],
    [await B({ source: p => { p.streams[0].tags.title = 'edited'; } }), 'METADATA'],
    [await B({ output: p => { p.frames[7].key_frame = 1; } }), 'METADATA'],
    [await B({ output: p => { p.frames[5].duration = 34; } }), 'TIMELINE'],
    [await B({ matroska: { frame: Buffer.from('opaque-coded-frame-bytes-0123456788') } }), 'TEMPLATE'],
  ];
  for (const [j, expected] of cases) assert.throws(() => join(j), code(expected), expected);
});

test('provenance, structure and timeline invariants refuse before any reference comparison can pass', async () => {
  await setup();
  const cases = [
    [await B({ output: p => { p.format.tags[OUTPUT_ID_KEY] = '77777777-7777-4777-8777-777777777777'; } }), 'PROVENANCE'],
    [await B({ source: p => { p.format.tags[MARKER_KEY] = '1'; p.format.tags[OUTPUT_ID_KEY] = '66666666-6666-4666-8666-666666666666'; } }), 'PROVENANCE'],
    [await B({ output: p => { p.streams.push({ ...p.streams[0], index: 1 }); } }), 'STRUCTURE'],
    [await B({ source: p => { p.programs.push({}); } }), 'STRUCTURE'],
    [await B({ output: p => { p.streams[0].pix_fmt = 'nv12'; } }), 'STRUCTURE'],
    [await B({ output: p => { p.frames.pop(); } }), 'TIMELINE'],
    [await B({ source: p => { p.frames[3].pts = p.frames[2].pts; } }), 'TIMELINE'],
    [await B({ output: p => { p.frames[1].width = 640; } }), 'STRUCTURE'],
  ];
  for (const [j, expected] of cases) assert.throws(() => join(j), code(expected), expected);
  const duplicate = await B(); duplicate.roles['output-metadata'] = { ...duplicate.roles['output-metadata'], text: duplicate.roles['output-metadata'].text.replace('"chapters":[]', '"chapters":[],"chapters":[]') };
  assert.throws(() => join(duplicate), code('METADATA'));
});

test('only genuine file observations of this exact command and contract are accepted', async () => {
  await setup();
  const b = await B();
  assert.throws(() => join({ ...b, template: { ...b.template } }), code('TEMPLATE'));
  assert.throws(() => join({ ...b, template: A.template }), code('TEMPLATE'));
  // A buffer inspection of the same bytes names no held stage file.
  assert.throws(() => join({ ...b, template: inspectNativeFileTemplate(b.bytes, b.command) }), code('TEMPLATE'));
  assert.throws(() => join({ ...b, command: JSON.parse(JSON.stringify(b.command)) }), code('COMMAND'));
  assert.throws(() => join({ ...b, contract: { ...b.contract, sourceProbeFingerprint: 'f'.repeat(64) } }), code('COMMAND'));
  assert.throws(() => join({ ...b, contract: { ...b.contract, expectedOutput: { ...b.contract.expectedOutput, declaredFrames: '31' } } }), code('COMMAND'));
  const missing = await B(); delete missing.roles['output-raw']; assert.throws(() => join(missing), code('EVIDENCE'));
  const incomplete = await B(); incomplete.roles['source-metadata'] = { ...incomplete.roles['source-metadata'], evidenceComplete: false }; assert.throws(() => join(incomplete), code('EVIDENCE'));
});

test('file paths are not content: a different source path keeps the metadata digest', async () => {
  await setup();
  const b = await B({ source: p => { p.format.filename = 'E:\\elsewhere\\copy.mp4'; } });
  assert.equal(join(b).kind, 'native-file-oracle-checks');
});
