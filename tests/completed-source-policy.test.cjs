'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assessCompletedSource, readSourceIdentity, sameIdentity, assertIdentityMatches } = require('../src/source-identity.cjs');

const source = Object.freeze({ canonicalPath: path.resolve('fixture.mkv'), dev: '42', ino: '123', size: '4194304',
  mtimeNs: '1700000000000000000', ctimeNs: '1700000000000000001', birthtimeNs: '1600000000000000000',
  sparseDigest: `sha256-sparse-v1:${'a'.repeat(64)}` });

test('unchanged complete bounded observations permit ordinary completion', () => {
  const assessment = assessCompletedSource(source, { ...source });
  assert.equal(assessment.kind, 'unchanged');
  assert.deepEqual(assessment.diagnostic.changedFields, []);
  assert.equal(assessment.warning, undefined);
});

test('only ctime may warn at completion without relaxing strict identity or authority checks', () => {
  const actual = { ...source, ctimeNs: '1700000000000000002' };
  const assessment = assessCompletedSource(source, actual);
  assert.equal(assessment.kind, 'ctime-only');
  assert.equal(assessment.warning.code, 'SOURCE_CTIME_ONLY');
  assert.match(assessment.warning.message, /cannot rule out changes outside the sampled regions/);
  assert.deepEqual(assessment.diagnostic.expected, source);
  assert.deepEqual(assessment.diagnostic.actual, actual);
  assert.deepEqual(assessment.diagnostic.changedFields, ['ctimeNs']);
  assert.equal(sameIdentity(source, actual), false);
  assert.throws(() => assertIdentityMatches(source, actual, { digest: true, stage: 'before-encode', message: 'Reprepare.' }), { code: 'INPUT_CHANGED' });
});

for (const field of ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'birthtimeNs', 'sparseDigest']) {
  test(`a changed ${field} never becomes a ctime-only exception`, () => {
    const actual = { ...source, ctimeNs: '1700000000000000002', [field]: field === 'sparseDigest'
      ? `sha256-sparse-v1:${'b'.repeat(64)}` : source[field] + '1' };
    assert.equal(assessCompletedSource(source, actual).kind, 'changed');
  });
}

for (const field of Object.keys(source)) {
  test(`missing ${field} is incomplete even if ctime is the only other change`, () => {
    const actual = { ...source, ctimeNs: '1700000000000000002' };
    delete actual[field];
    assert.equal(assessCompletedSource(source, actual).kind, 'incomplete');
  });
}

test('invalid or unreliable observations do not authorize completion', () => {
  for (const actual of [null, {}, { ...source, dev: '0' }, { ...source, ino: '0' }, { ...source, sparseDigest: 'truncated' }, { ...source, size: '0' },
    { ...source, canonicalPath: 'relative.mkv' }, { ...source, canonicalPath: `${source.canonicalPath}\u0000` },
    { ...source, birthtimeNs: null }, { ...source, mtimeNs: 123 }, { ...source, ctimeNs: 'NaN' }]) {
    assert.equal(assessCompletedSource(source, actual).kind, 'incomplete');
    assert.equal(assessCompletedSource(actual, source).kind, 'incomplete');
  }
});

test('genuine complete stronger mismatch evidence prevents warning success; partial hashes do not prove anything', () => {
  const hash = digest => ({ algorithm: 'sha256', complete: true, bytes: source.size, digest });
  const before = hash('a'.repeat(64));
  const after = hash('b'.repeat(64));
  const actual = { ...source, ctimeNs: '1700000000000000002' };
  const changed = assessCompletedSource(source, actual, { contentEvidence: { before, after } });
  assert.equal(changed.kind, 'changed');
  assert.equal(changed.reason, 'complete-content-mismatch');
  assert.equal(changed.diagnostic.contentMismatch, true);
  for (const partial of [{ before }, { before, after: { ...after, complete: false } }, { before, after: { ...after, bytes: '5' } }]) {
    assert.equal(assessCompletedSource(source, actual, { contentEvidence: partial }).kind, 'incomplete');
  }
  // Default behavior observes only the bounded contract, not this test's oracle.
  assert.equal(assessCompletedSource(source, actual).kind, 'ctime-only');
});

test('incomplete optional content evidence cannot conceal a complete observed source mismatch', () => {
  for (const field of ['size', 'ino', 'mtimeNs', 'birthtimeNs', 'sparseDigest']) {
    const actual = { ...source, [field]: field === 'sparseDigest' ? `sha256-sparse-v1:${'b'.repeat(64)}` : `${source[field]}1` };
    const result = assessCompletedSource(source, actual, { contentEvidence: {} });
    assert.equal(result.kind, 'changed');
    assert.equal(result.reason, 'observed-source-change');
    assert.deepEqual(result.diagnostic.changedFields, [field]);
  }
});

test('complete stronger evidence never relaxes unrelated file identity changes', () => {
  const hash = { algorithm: 'sha256', complete: true, bytes: source.size, digest: 'a'.repeat(64) };
  const contentEvidence = { before: hash, after: { ...hash } };
  assert.equal(assessCompletedSource(source, source, { contentEvidence }).kind, 'unchanged');
  assert.equal(assessCompletedSource(source, { ...source, ctimeNs: `${source.ctimeNs}1` }, { contentEvidence }).kind, 'ctime-only');
  assert.equal(assessCompletedSource(source, { ...source, ino: `${source.ino}1` }, { contentEvidence }).kind, 'changed');
  assert.equal(assessCompletedSource(source, source, { contentEvidence: { before: hash } }).kind, 'incomplete');
});

test('a real unsampled edit produces bounded uncertainty, while independent complete mismatch evidence prevents success', async t => {
  const base = path.resolve(__dirname, '../artifacts/completed-source-unit-tests');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'case-'));
  t.after(async () => {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), await fs.realpath(base));
    assert.ok(path.basename(actual).startsWith('case-'));
    await fs.rm(actual, { recursive: true });
  });
  const file = path.join(directory, 'owned-dummy-source.bin');
  await fs.writeFile(file, Buffer.alloc(4 * 1024 * 1024, 37));
  const fixedTime = 1_700_000_000;
  await fs.utimes(file, fixedTime, fixedTime);
  const expected = await readSourceIdentity(file);
  // Full hashes here are independent test oracles over a tiny owned fixture.
  // The production bounded reader does not perform or depend on these reads.
  const fullHash = async () => ({ algorithm: 'sha256', complete: true, bytes: expected.size,
    digest: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
  const beforeHash = await fullHash();
  const handle = await fs.open(file, 'r+');
  try { await handle.write(Buffer.from([99]), 0, 1, 500_000); }
  finally { await handle.close(); }
  await fs.utimes(file, fixedTime, fixedTime);
  const actual = await readSourceIdentity(file);
  const afterHash = await fullHash();
  assert.equal(actual.sparseDigest, expected.sparseDigest);
  assert.notEqual(afterHash.digest, beforeHash.digest);
  assert.deepEqual(Object.keys(expected).filter(field => expected[field] !== actual[field]), ['ctimeNs']);
  const bounded = assessCompletedSource(expected, actual);
  assert.equal(bounded.kind, 'ctime-only');
  assert.match(bounded.warning.message, /cannot rule out changes outside the sampled regions/);
  assert.equal(sameIdentity(expected, actual), false, 'completion warning never renews strict cache/source authority');
  assert.equal(assessCompletedSource(expected, actual, { contentEvidence: { before: beforeHash, after: afterHash } }).kind, 'changed');
});
