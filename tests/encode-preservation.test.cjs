'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { EncodePreservationOperations, SOURCE_CLASS, describeEncodePreservationSource, getEncodePreservationSelection,
  fingerprintEncodePreservationProbe, fingerprintEncodePreservationIdentity, fingerprintEncodePreservationSettings } = require('../src/encode-preservation.cjs');
const RUNTIME = 'a'.repeat(64), SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });

const { source } = require('./fixtures/encode-preservation-source.cjs');
function fixture({ probe = source(), empty = false } = {}) {
  const owner = new EncodePreservationOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-only-full-preservation',
    policies: empty ? [] : [{ id: 'synthetic-full-tmcd', sourceClass: SOURCE_CLASS, runtimeIdentity: RUNTIME, evidenceIds: ['synthetic-only-proof'] }] });
  const identity = { canonicalPath: 'F:\\synthetic-preservation\\source.mp4', dev: '1', ino: '2', size: '400',
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: 'sha256-sparse-v1:' + 'b'.repeat(64) };
  const request = resolveFileRequest({ fileId: randomUUID(), identityRevision: 1, draftRevision: 1, operation: 'encode' });
  const planId = randomUUID(), draftId = randomUUID(), id = randomUUID(), described = describeEncodePreservationSource(probe);
  const decision = { id, planId, draftId, fileId: request.fileId, identityRevision: request.identityRevision,
    draftRevision: request.draftRevision, operation: 'encode', target: 'matroska', action: 'omit-timed-timecode', runtimeIdentity: RUNTIME,
    settingsFingerprint: fingerprintEncodePreservationSettings(SETTINGS), sourceFingerprint: fingerprintEncodePreservationIdentity(identity),
    probeFingerprint: fingerprintEncodePreservationProbe(probe), streamIndex: described?.streamIndex,
    streamFingerprint: described?.streamFingerprint, relationshipFingerprint: described?.relationshipFingerprint };
  const options = { probe, sourceIdentity: identity, request, settings: SETTINGS, planId, draftId,
    decisionIds: [id], resolveDecision: value => value === id ? decision : null };
  const binding = { probe, sourceIdentity: identity, request, settings: SETTINGS, planId, draftId, runtimeIdentity: RUNTIME };
  return { owner, probe, identity, request, decision, options, binding };
}

test('a genuine decision names the timed track and relationship with codec_name absent and keeps original observations intact', () => {
  const h = fixture(), before = JSON.stringify(h.probe);
  const description = h.owner.describe(h.options);
  assert.equal(description.applicable, true); assert.match(description.label, /timed timecode.*linked video/);
  assert.equal(h.probe.streams[2].codec_name, undefined);
  assert.throws(() => h.owner.prepare({ ...h.options, decisionIds: [] }), { code: 'ENCODE_PRESERVATION_DECISION_REQUIRED' });
  const selection = h.owner.prepare(h.options), selected = getEncodePreservationSelection(selection, h.probe);
  assert.deepEqual(selected.retainedIndexes, [0, 1]); assert.deepEqual(selected.omittedStreams.map(x => x.inputIndex), [2]);
  assert.equal(selected.removedRelationships[0].type, 'Track Reference');
  assert.match(selected.warning.message, /editing\/synchronization/); assert.match(selected.warning.message, /not equivalent/);
  assert.equal(h.owner.requireCurrent(selection, h.binding).decodedEvidenceRequired, false);
  assert.equal(JSON.stringify(h.probe), before);
  assert.ok(Object.isFrozen(selected) && Object.isFrozen(selected.omittedStreams));
});

test('source class uses observed membership rather than literal stream indexes or source file hash', () => {
  const h = fixture({ probe: source([5, 9, 12]) }), selection = h.owner.prepare(h.options);
  assert.deepEqual(getEncodePreservationSelection(selection, h.probe).retainedIndexes, [5, 9]);
  assert.equal(getEncodePreservationSelection(selection, h.probe).omittedStreams[0].inputIndex, 12);
});

test('an empty or mismatched runtime policy cannot turn consent into execution authority', () => {
  const h = fixture({ empty: true });
  assert.throws(() => h.owner.prepare(h.options), { code: 'ENCODE_PRESERVATION_QUALIFICATION_REQUIRED' });
  assert.throws(() => new EncodePreservationOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'test',
    policies: [{ id: 'wrong', sourceClass: SOURCE_CLASS, runtimeIdentity: 'c'.repeat(64), evidenceIds: ['synthetic'] }] }));
});

for (const [key, value] of Object.entries({ planId: 'wrong', draftId: 'wrong', fileId: 'wrong', identityRevision: 2,
  draftRevision: 2, operation: 'remux', target: 'mp4', action: 'ignore-all-data', runtimeIdentity: 'c'.repeat(64),
  settingsFingerprint: 'wrong', sourceFingerprint: 'wrong', probeFingerprint: 'wrong', streamIndex: 10,
  streamFingerprint: 'wrong', relationshipFingerprint: 'wrong' })) {
  test(`consent bound to another ${key} cannot select a stream`, () => {
    const h = fixture(); h.decision[key] = value;
    assert.throws(() => h.owner.prepare(h.options), { code: 'ENCODE_PRESERVATION_STALE' });
  });
}

test('copied/foreign/expired selections and changed current bindings are refused', () => {
  const h = fixture(), token = h.owner.prepare(h.options), other = fixture();
  assert.throws(() => getEncodePreservationSelection({ ...token }, h.probe), { code: 'ENCODE_PRESERVATION_UNBOUND' });
  assert.throws(() => other.owner.requireCurrent(token, h.binding), { code: 'ENCODE_PRESERVATION_UNBOUND' });
  for (const binding of [{ ...h.binding, runtimeIdentity: 'c'.repeat(64) }, { ...h.binding, planId: randomUUID() },
    { ...h.binding, request: { ...h.request, draftRevision: 2 } }, { ...h.binding, sourceIdentity: { ...h.identity, ctimeNs: '1002' } },
    { ...h.binding, settings: { ...SETTINGS, quality: 24 } }]) {
    assert.throws(() => h.owner.requireCurrent(token, binding), { code: 'ENCODE_PRESERVATION_STALE' });
  }
  const changed = structuredClone(h.probe); changed.streams[2].tags.timecode = '02:00:00:00';
  assert.throws(() => getEncodePreservationSelection(token, changed), { code: 'ENCODE_PRESERVATION_STALE' });
  h.owner.invalidate(); assert.throws(() => getEncodePreservationSelection(token, h.probe), { code: 'ENCODE_PRESERVATION_STALE' });
});

for (const change of [p => { delete p.stream_groups; }, p => { p.stream_groups[0].type = 'Unknown'; },
  p => { p.stream_groups[0].nb_streams = 3; }, p => { p.streams[2].codec_tag_string = 'mebx'; },
  p => { p.streams[0].width = 1280; }, p => { p.streams[0].color_transfer = 'smpte2084'; },
  p => { p.streams[1].channels = 6; }, p => { p.streams[2].tags.timecode = '00:00:00:00'; },
  p => { p.chapters.push({ id: 0, time_base: '1/1000', start: 0, end: 1000 }); },
  p => { p.streams.push({ index: 3, codec_type: 'subtitle', codec_name: 'ass' }); p.format.nb_streams = 4; }]) {
  test('unknown, changed or additional functional content does not become a generic data-drop route', () => {
    const p = source(); change(p); assert.equal(describeEncodePreservationSource(p), null);
  });
}

test('range/resize/audio/backend overrides never silently take this Full route', () => {
  const h = fixture();
  for (const request of [{ ...h.request, range: { startUs: 0, endUs: 1000000 } }, { ...h.request, resolution: '720' },
    { ...h.request, audioPolicy: 'precision-aac' }, { ...h.request, omissionRequestIds: [randomUUID()] }]) {
    assert.throws(() => h.owner.prepare({ ...h.options, request }), { code: 'ENCODE_PRESERVATION_SETTINGS' });
  }
  assert.throws(() => h.owner.prepare({ ...h.options, settings: { ...SETTINGS, profileId: 'h265-nvidia' } }), { code: 'ENCODE_PRESERVATION_SETTINGS' });
});

for (const change of [p => { p.streams[1].sample_rate = '4.8e4'; }, p => { p.streams[1].channels = '2e0'; },
  p => { p.streams[2].codec_name = 0; }, p => { p.streams[2].codec_name = ''; },
  p => { p.streams[0].tags.rotate = 'unknown'; }, p => { p.streams[0].tags.rotate = '90'; },
  p => { p.streams[0].display_aspect_ratio = '2:1'; }, p => { p.streams[0].duration_ts = 'oops'; },
  ...[false, null, '0', [0]].map(value => p => { p.stream_groups[0].disposition = value; }),
  p => { p.stream_groups[0].components = {}; }, p => { p.stream_groups[0].tags = { unknown: 'functional?' }; }]) {
  test('malformed observed geometry, track, timeline and relationship fields refuse the finite class', () => {
    const p = source(); change(p); assert.equal(describeEncodePreservationSource(p), null);
  });
}

test('missing, extra and accessor authority fields cannot mint a branded selection', () => {
  for (const field of ['planId', 'draftId']) {
    const h = fixture(); delete h.options[field]; delete h.decision[field];
    assert.throws(() => h.owner.prepare(h.options), { code: 'ENCODE_PRESERVATION_STALE' });
  }
  const h = fixture(); h.decision.unrelated = true;
  assert.throws(() => h.owner.prepare(h.options), { code: 'ENCODE_PRESERVATION_STALE' });
  delete h.decision.unrelated;
  Object.defineProperty(h.decision, 'planId', { enumerable: true, get() { throw new Error('must not read accessor'); } });
  assert.throws(() => h.owner.prepare(h.options), { code: 'ENCODE_PRESERVATION_STALE' });
});

test('canonical selected argv retains ordinary protection and independent output refusals', () => {
  const { buildEncodeOperation, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
  const { classifyColor, buildEncodeArgs } = require('../src/media.cjs');
  const h = fixture(), token = h.owner.prepare(h.options), before = JSON.stringify(h.probe);
  const options = { input: h.identity.canonicalPath, output: 'F:\\synthetic-preservation\\out.mkv',
    settings: SETTINGS, inspection: { probe: h.probe, color: classifyColor(h.probe), duration: 6 },
    request: h.request, runtimeIdentity: RUNTIME, preservationSelection: token };
  const plan = buildEncodeOperation(options);
  assert.equal(plan.compatibilityPath, false); assert.equal(plan.validationMode, 'full-preservation-selection');
  assert.equal(plan.expectedOutput.decodedEvidenceRequired, false);
  assert.deepEqual(plan.args.flatMap((value, index) => value === '-map' ? [plan.args[index + 1]] : []), ['0:0', '0:1']);
  assert.ok(plan.args.includes('-n')); assert.equal(plan.args[plan.args.indexOf('-f') + 1], 'matroska');
  assert.equal(plan.args.includes('-ss'), false); assert.equal(plan.args.includes('-filter:a:0'), false);
  assert.equal(JSON.stringify(h.probe), before);
  assert.throws(() => buildEncodeArgs({ ...options, probe: h.probe, preservationSelection: {} }), { code: 'ENCODE_PRESERVATION_UNBOUND' });
  assert.throws(() => buildEncodeOperation({ ...options, input: 'F:\\another.mp4' }), { code: 'ENCODE_PRESERVATION_STALE' });
  assert.throws(() => buildEncodeOperation({ ...options, runtimeIdentity: 'b'.repeat(64) }), { code: 'ENCODE_PRESERVATION_STALE' });
  const output = structuredClone(h.probe);
  output.streams = output.streams.slice(0, 2); output.streams[0].codec_name = 'hevc'; output.stream_groups = [];
  Object.assign(output.format, { format_name: 'matroska,webm', nb_streams: 2, nb_stream_groups: 0 });
  assert.equal(validateEncodeOperationOutput(plan, output).valid, true);
  for (const tamper of [p => { p.streams[0].sample_aspect_ratio = '2:1'; }, p => { p.streams[0].field_order = 'tt'; },
    p => { p.streams[0].tags.rotate = '90'; }, p => { p.streams[0].tags.rotate = 'unknown'; },
    p => { p.format.format_name = 'mov,mp4,m4a,3gp,3g2,mj2'; }, p => { delete p.stream_groups; },
    p => { p.streams[1].profile = 'HE-AAC'; }, p => { p.streams[1].channels = 1; },
    p => { p.streams[0].tags.timecode = '01:00:00:00'; }]) {
    const changed = structuredClone(output); tamper(changed);
    assert.equal(validateEncodeOperationOutput(plan, changed).valid, false, JSON.stringify(changed));
  }
  h.owner.prepare(h.options);
  assert.throws(() => buildEncodeOperation(options), { code: 'ENCODE_PRESERVATION_STALE' });
  assert.equal(validateEncodeOperationOutput(plan, output).valid, false);
});
