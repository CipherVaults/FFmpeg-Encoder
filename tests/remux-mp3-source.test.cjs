'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { makeLayer3 } = require('../scripts/fixtures/q2j-layer3.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { prepareMp3Source, requireMp3Source, rereadMp3Source } = require('../src/remux-mp3-source.cjs');
const { assessRemux, buildRemuxQualificationArgs } = require('../src/remux-contract.cjs');
const { RemuxOperations, deriveRemuxAssessmentBudget, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');

const request = { operation: 'remux', target: 'mp4', range: null, fileId: 'audio-fixture',
  identityRevision: 0, draftRevision: 1, omissionRequestIds: [] };
const labPolicy = { id: 'standalone-audio-unit-policy', inputFamily: 'mp3', target: 'mp4',
  evidenceIds: ['injected-unit-test'], allowAncillary: false, runtimeIdentity: REGULAR_WINDOWS_PAIR,
  sourceEnvelope: 'mpeg1-layer3-untagged-v1', verificationMethod: 'complete-native-v1' };

async function ownedFixture(t) {
  const parent = path.resolve(__dirname, '../artifacts/remux-mp3-unit-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'fixture-'));
  const file = path.join(root, 'source.mp3');
  await fs.writeFile(file, makeLayer3(), { flag: 'wx' });
  t.after(async () => { await fs.unlink(file); await fs.rmdir(root); });
  const identity = await readSourceIdentity(file);
  const mp3Source = await prepareMp3Source(file, identity);
  return { root, file, identity, mp3Source };
}

const rawProbe = size => ({
  format: { format_name: 'mp3', size, duration: '0.960000', nb_streams: 1, nb_programs: 0, nb_stream_groups: 0 },
  streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp3', sample_rate: '48000', channels: 2,
    channel_layout: 'stereo', initial_padding: 0, time_base: '1/14112000', start_pts: 0, disposition: { default: 0 } }],
  chapters: [], programs: [], stream_groups: [],
});

test('standalone MP3 requires an honest current complete frame observation and the exact owner pair', async t => {
  const { root, file, identity, mp3Source } = await ownedFixture(t);
  const f = { request, probe: rawProbe(identity.size), sourceFingerprint: fingerprintRemuxSourceIdentity(identity), mp3Source };
  assert.throws(() => assessRemux({ ...f, mp3Source: undefined }), { code: 'NO_VIDEO' });
  assert.throws(() => assessRemux({ ...f, mp3Source: { ...mp3Source } }), { code: 'MP3_CUSTODY_UNAVAILABLE' });
  const bad = structuredClone(f.probe);
  bad.streams[0].channels = 1;
  assert.throws(() => assessRemux({ ...f, probe: bad }), { code: 'MP3_FAMILY_UNPROVED' });
  assert.throws(() => assessRemux({ ...f, request: { ...request, target: 'mov' } }), { code: 'REMUX_MP3_SHAPE' });

  const assessment = assessRemux(f);
  assert.equal(assessment.inputFamily, 'mp3');
  assert.deepEqual(assessment.expectedOutput.streams[0].disposition, ['default']);
  assert.equal(assessment.expectedOutput.selectedVideoInputIndex, null);
  const args = buildRemuxQualificationArgs({ assessment, input: file, output: path.join(root, 'destination.mp4'),
    outputId: '12345678-1234-4123-8123-123456789abc' });
  assert.equal(args[args.indexOf('-c:a:0') + 1], 'copy');
  assert.equal(args[args.indexOf('-format_whitelist') + 1], 'mp3');
  assert.equal(args[args.indexOf('-movie_timescale') + 1], '48000');

  const owner = new RemuxOperations({ runtimeIdentity: REGULAR_WINDOWS_PAIR, policyIdentity: 'finite-audio-test', policies: [labPolicy] });
  const held = new RemuxOperations({ runtimeIdentity: 'a'.repeat(64), policyIdentity: 'held', policies: [labPolicy] });
  assert.equal(owner.allowsStandaloneMp3('mp4'), true);
  assert.equal(owner.allowsStandaloneMp3('mov'), false);
  assert.equal(held.allowsStandaloneMp3('mp4'), false);
  assert.throws(() => deriveRemuxAssessmentBudget(assessment, identity.size, 'packet-identity-v1'), { code: 'REMUX_VERIFICATION_METHOD' });
  const { budget, resources } = deriveRemuxAssessmentBudget(assessment, identity.size, 'complete-native-v1');
  assert.equal(budget.maxPcmBytes, 46080 * 2 * 4);
  assert.equal(resources.evidenceReserveBytes, 32 * 1024 ** 2);
});

test('the current private source witness does not survive a changed input', async t => {
  const { file, identity, mp3Source } = await ownedFixture(t);
  assert.equal(requireMp3Source(mp3Source, identity).size, identity.size);
  const before = await rereadMp3Source(file, mp3Source);
  assert.equal(before.sha256, mp3Source.sha256);
  await fs.appendFile(file, Buffer.from([0]));
  await assert.rejects(rereadMp3Source(file, mp3Source), { code: 'INPUT_CHANGED' });
});
