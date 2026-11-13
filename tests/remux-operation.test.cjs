'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { REMUX_POLICIES } = require('../src/remux-catalog.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const { collectRemuxEvidence, getCollectedMovRepresentation } = require('../src/remux-evidence.cjs');
const { observeMovRepresentation } = require('../src/mov-representation.cjs');
const { fixture: movFixture, writeFixture: writeMovFixture } = require('./helpers/mov-fixture.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../src/provenance.cjs');

// Policies and child streams here are deterministic synthetic fixtures. They
// establish private ownership/replay/validation behavior, never media/runtime or
// lifecycle qualification. No FFmpeg/ffprobe process is launched by these tests.
const RUNTIME = 'a'.repeat(64), OUTPUT_ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
const NEXT_ID = 'b032d93e-ab78-45ad-87b2-78ce4833e572';
const clone = value => structuredClone(value);
const BUDGET = { sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8 * 1024 * 1024,
  maxPcmBytes: 128 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 };
const SOURCE = { canonicalPath: 'F:\\synthetic-remux\\input.mp4', dev: '1', ino: '2', size: '1000000',
  mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
const reject = (action, code) => assert.throws(action, error => error.code === code);
const required = action => reject(action, 'REMUX_QUALIFICATION_REQUIRED');
const stale = action => reject(action, 'REMUX_OPERATION_STALE');
const invalid = action => reject(action, 'INVALID_REMUX_OPERATION');
const planRequired = action => reject(action, 'REMUX_OPERATION_PLAN_REQUIRED');
function source({ family = 'isobmff', audio = true } = {}) {
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/90000',
    start_pts: 0, start_time: '0', duration_ts: 180000, duration: '2', disposition: { default: 1 }, tags: { language: 'eng', title: 'Video' } }],
  format: { format_name: family === 'matroska' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2', start_time: '0', size: SOURCE.size,
    nb_streams: audio ? 2 : 1, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic source' } }, chapters: [], programs: [], stream_groups: [] };
  if (audio) probe.streams.push({ index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2,
    channel_layout: 'stereo', time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: 96000, duration: '2', disposition: { default: 1 }, tags: { title: 'Audio' } });
  return probe;
}
function fixture(options = {}) {
  const probe = options.probe || source(options); options.change?.(probe);
  const identity = { ...clone(SOURCE), ...options.identity }, target = options.target || 'matroska';
  const request = { fileId: options.fileId || 'synthetic-file', identityRevision: 1, draftRevision: options.draftRevision ?? 1,
    operation: 'remux', target, range: null, omissionRequestIds: [] };
  const fingerprint = fingerprintRemuxSourceIdentity(identity);
  let assessment = assessRemux({ request, probe, sourceFingerprint: fingerprint });
  if (options.omit?.length) {
    const decisions = options.omit.map(index => ({ id: `omit-${index}`, fileId: request.fileId, identityRevision: request.identityRevision,
      draftRevision: request.draftRevision, sourceFingerprint: fingerprint, target, operation: 'remux', streamIndex: index,
      streamFingerprint: assessment.expectedOutput.streams.find(item => item.inputIndex === index).streamFingerprint, action: 'omit-stream' }));
    request.omissionRequestIds = decisions.map(item => item.id);
    options.changeDecisions?.(decisions);
    assessment = assessRemux({ request, probe, sourceFingerprint: fingerprint, resolveOmission: id => decisions.find(item => item.id === id) });
  }
  const retained = { id: 'synthetic-reviewed-route', inputFamily: assessment.inputFamily, target, evidenceIds: ['synthetic-native', 'synthetic-lifecycle'],
    allowAncillary: false, runtimeIdentity: RUNTIME, ...options.policy };
  const owner = options.owner || new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-policy-v1', policies: options.empty ? [] : [retained] });
  const prepare = { assessment, input: identity.canonicalPath, output: 'F:\\synthetic-remux-output\\destination.mkv', outputId: options.outputId || OUTPUT_ID, sourceIdentity: identity, request };
  const plan = options.noPrepare ? null : owner.prepare(prepare);
  const bindings = { plan, settings: null, sourceIdentity: identity, sourceProbeFingerprint: remuxProbeFingerprint(probe), runtimeIdentity: RUNTIME,
    environment: null, budget: clone(BUDGET), executionBudgetMs: 600000 };
  return { owner, probe, identity, request, assessment, retained, prepare, plan, bindings };
}

const MOV_POLICY = { id: 'test-isobmff-mov', inputFamily: 'isobmff', target: 'mov', allowAncillary: false,
  allowRotation90: false, sourceEnvelope: 'h264-aac-lc-48k-stereo-v1', runtimeIdentity: RUNTIME, evidenceIds: ['test-only-mov'] };
const PRE_MOV_POLICY_IDS = ['full-remux-isobmff-matroska-v1', 'full-remux-isobmff-mp4-v1',
  'full-remux-matroska-matroska-v1', 'full-remux-matroska-mp4-v1'];
const PRE_MOV_POLICIES = REMUX_POLICIES.filter(route => PRE_MOV_POLICY_IDS.includes(route.id));
function movRoute(options = {}) {
  const owner = new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'five-test-routes',
    policies: [...PRE_MOV_POLICIES.map(route => ({ ...route, runtimeIdentity: RUNTIME })), MOV_POLICY] });
  return fixture({ target: 'mov', owner, ...options });
}
test('five-policy test catalog admits the exact MOV AAC shape with native track fields and B frames', () => {
  assert.deepEqual(PRE_MOV_POLICIES.map(route => route.id).sort(), [...PRE_MOV_POLICY_IDS].sort());
  const promoted = REMUX_POLICIES.filter(route => route.inputFamily === 'isobmff' && route.target === 'mov');
  assert.equal(promoted.length, 1);
  assert.match(promoted[0].id, /^full-remux-isobmff-mov-v[12]$/);
  assert.ok(['h264-aac-lc-48k-stereo-v1', 'h264-aac-lc-48k-stereo-v2'].includes(promoted[0].sourceEnvelope));
  assert.equal(promoted[0].allowAncillary, false); assert.equal(promoted[0].allowRotation90, false);
  const h = movRoute({ change: p => { p.streams[0].has_b_frames = 2; p.streams[0].tags.handler_name = 'VideoHandler';
    p.streams[1].tags.language = 'und'; p.streams[1].tags.handler_name = 'SoundHandler'; } });
  assert.ok(h.plan); assert.equal(h.plan.expectedOutput.streams.length, 2);
  assert.deepEqual(h.plan.args.slice(-3, -1), ['-f', 'mov']);
  assert.equal(h.plan.args[h.plan.args.indexOf('-write_tmcd') + 1], '0');
  assert.equal(h.plan.args[h.plan.args.indexOf('-movflags') + 1], 'use_metadata_tags');
  assert.equal(h.plan.args[h.plan.args.indexOf('-c') + 1], 'copy');
});
test('MOV rate prefilter refuses differing, unknown and unmeasured summaries without claiming CFR proof', () => {
  for (const [average, nominal] of [['299/10', '30/1'], ['30/1', '60/1'], ['24/1', '24/1'],
    [undefined, '30/1'], ['30/1', undefined], ['0/0', '0/0'], ['N/A', '30/1'], ['61/1', '61/1']]) {
    const h = movRoute({ noPrepare: true, change: p => {
      if (average === undefined) delete p.streams[0].avg_frame_rate; else p.streams[0].avg_frame_rate = average;
      if (nominal === undefined) delete p.streams[0].r_frame_rate; else p.streams[0].r_frame_rate = nominal;
    } });
    reject(() => h.owner.prepare(h.prepare), 'REMUX_MOV_RATE_UNQUALIFIED');
  }
  for (const [average, nominal] of [['30/1', '30/1'], ['60/1', '60/1'], ['30000/1000', '30/1']])
    assert.ok(movRoute({ change: p => { p.streams[0].avg_frame_rate = average; p.streams[0].r_frame_rate = nominal; } }).plan);
  // Admission remains only a summary prefilter. These fields cannot certify all
  // source presentation intervals; bound collected cadence is checked after Start.
  for (const route of PRE_MOV_POLICIES) assert.ok(fixture({ family: route.inputFamily, target: route.target,
    policy: { ...route, runtimeIdentity: RUNTIME }, ...(route.audio ? { omit: [2] } : {}),
    change: p => { p.streams[0].avg_frame_rate = '299/10'; } }).plan, route.id);
});

const MOV_V2_POLICY = { ...MOV_POLICY, sourceEnvelope: 'h264-aac-lc-48k-stereo-v2' };
test('MOV v2 admits bounded positive unequal summaries while refusing each missing/unknown/over-60 summary', () => {
  const prepareV2 = change => fixture({ target: 'mov', policy: MOV_V2_POLICY, change });
  for (const [average, nominal] of [['40/1', '60/1'], ['299/10', '30/1'], ['24/1', '24/1'], ['60/1', '60/1']])
    assert.ok(prepareV2(p => { p.streams[0].avg_frame_rate = average; p.streams[0].r_frame_rate = nominal; }).plan);
  for (const key of ['avg_frame_rate', 'r_frame_rate']) for (const value of [undefined, 'N/A', '0/0', '0/1', '1/0',
    '61/1', '60001/1000', '-1/1', '1.5/1', '1/10000000000000000']) {
    reject(() => prepareV2(p => { if (value === undefined) delete p.streams[0][key]; else p.streams[0][key] = value; }), 'REMUX_MOV_RATE_UNQUALIFIED');
  }
});
test('MOV v2 preserves every whole-source shape, audio, geometry and functional-metadata guard', () => {
  for (const [change, code] of [
    [p => { p.streams.pop(); p.format.nb_streams--; }, 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED'],
    [p => { p.chapters.push({ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: {} }); }, 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED'],
    [p => { p.streams[1].sample_rate = '44100'; }, 'REMUX_MOV_AUDIO_UNQUALIFIED'],
    [p => { p.streams[1].channels = 1; p.streams[1].channel_layout = 'mono'; }, 'REMUX_MOV_AUDIO_UNQUALIFIED'],
    [p => { p.streams[0].tags.BPS = '1000'; }, 'REMUX_TRACK_TAG_UNREPRESENTABLE'],
    [p => { p.streams[0].pix_fmt = 'yuv420p10le'; }, 'REMUX_QUALIFICATION_REQUIRED'],
    [p => { p.streams[0].sample_aspect_ratio = '4:3'; }, 'REMUX_QUALIFICATION_REQUIRED'],
  ]) reject(() => fixture({ target: 'mov', policy: MOV_V2_POLICY, change }), code);
  reject(() => fixture({ target: 'mov', policy: MOV_V2_POLICY, omit: [2] }), 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED');
  for (const delta of [{ inputFamily: 'matroska' }, { target: 'mp4' }, { allowRotation90: true }]) invalid(() =>
    new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'v2-test', policies: [{ ...MOV_V2_POLICY, ...delta }] }));
  let reads = 0; const hostile = { ...MOV_V2_POLICY };
  Object.defineProperty(hostile, 'sourceEnvelope', { enumerable: true, get() { reads++; return MOV_V2_POLICY.sourceEnvelope; } });
  invalid(() => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'v2-test', policies: [hostile] }));
  assert.equal(reads, 0);
});

test('the MOV route envelope is an exact inert route-local policy field', () => {
  const make = route => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'p', policies: [route] });
  for (const delta of [{ sourceEnvelope: undefined }, { sourceEnvelope: 'any-aac' }, { inputFamily: 'matroska' },
    { target: 'mp4' }, { target: 'matroska' }, { allowRotation90: true }]) invalid(() => make({ ...MOV_POLICY, ...delta }));
  let reads = 0; const hostile = { ...MOV_POLICY };
  Object.defineProperty(hostile, 'sourceEnvelope', { enumerable: true, get() { reads++; return MOV_POLICY.sourceEnvelope; } });
  invalid(() => make(hostile)); assert.equal(reads, 0);
});
test('five-policy MOV preparation refuses every unmeasured audio shape', () => {
  for (const change of [a => { a.sample_rate = '44100'; }, a => { a.sample_rate = '96000'; },
    a => { a.channels = 1; a.channel_layout = 'mono'; }, a => { a.channels = 6; a.channel_layout = '5.1'; },
    a => { a.profile = 'HE-AAC'; }, a => { a.sample_fmt = 's16'; }, a => { a.codec_name = 'pcm_s16le'; },
    a => { delete a.profile; }, a => { delete a.channel_layout; }]) {
    const h = movRoute({ noPrepare: true, change: p => change(p.streams[1]) });
    reject(() => h.owner.prepare(h.prepare), 'REMUX_MOV_AUDIO_UNQUALIFIED');
  }
});
test('five-policy MOV preparation refuses extra, missing and explicitly omitted tracks and chapters', () => {
  for (const change of [p => { p.streams.pop(); p.format.nb_streams--; },
    p => { p.streams.push({ ...clone(p.streams[1]), index: 4 }); p.format.nb_streams++; },
    p => { p.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: {} }]; }]) {
    const h = movRoute({ noPrepare: true, change }); reject(() => h.owner.prepare(h.prepare), 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED');
  }
  for (const extra of [{ codec_type: 'subtitle', codec_name: 'mov_text' }, { codec_type: 'data', codec_name: 'tmcd', codec_tag_string: 'tmcd' },
    { codec_type: 'attachment', codec_name: 'ttf' }, { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }]) {
    const h = movRoute({ noPrepare: true, change: p => { p.streams.push({ index: 4, ...extra }); p.format.nb_streams++; }, omit: [4] });
    reject(() => h.owner.prepare(h.prepare), 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED');
  }
  const omitted = movRoute({ noPrepare: true, omit: [2] }); reject(() => omitted.owner.prepare(omitted.prepare), 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED');
});
test('MOV required track tags without a representation refuse before Start while descriptive tags stay admitted', () => {
  for (const tags of [{ BPS: '1234' }, { replaygain_track_gain: '-3 dB' }, { language: 'en' }, { language: 'ENG' }, { handler_name: '' }]) {
    const h = movRoute({ noPrepare: true, change: p => { p.streams[0].tags = tags; } });
    reject(() => h.owner.prepare(h.prepare), 'REMUX_TRACK_TAG_UNREPRESENTABLE');
  }
  assert.ok(movRoute({ change: p => { p.streams[0].tags.vendor_id = 'FFMP'; } }).plan);
});
test('the new MOV policy retains all existing video/geometry/color/bounds refusals', () => {
  for (const change of [p => { p.streams[0].codec_name = 'hevc'; }, p => { p.streams[0].pix_fmt = 'yuv420p10le'; },
    p => { p.streams[0].color_transfer = 'smpte2084'; }, p => { p.streams[0].sample_aspect_ratio = '4:3'; },
    p => { p.streams[0].width = 1921; }, p => { p.format.duration = '121'; },
    p => { p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', rotation: 90,
      displaymatrix: '\n00000000: 0 -65536 0\n00000001: 65536 0 0\n00000002: 0 0 1073741824\n' }]; }]) {
    const h = movRoute({ noPrepare: true, change }); required(() => h.owner.prepare(h.prepare));
  }
});

test('empty catalogs, unreviewed routes and copied assessments never prepare execution', () => {
  const h = fixture({ noPrepare: true, empty: true }); required(() => h.owner.prepare(h.prepare));
  const valid = fixture({ noPrepare: true });
  reject(() => valid.owner.prepare({ ...valid.prepare, assessment: clone(valid.assessment) }), 'REMUX_NOT_PLANNABLE');
  invalid(() => valid.owner.prepare({ ...valid.prepare, request: { ...valid.request, draftRevision: 2 } }));
  invalid(() => valid.owner.prepare({ ...valid.prepare, input: 'F:\\another-file.mp4' }));
  invalid(() => valid.owner.prepare({ ...valid.prepare, sourceIdentity: { ...valid.identity, ino: '3' } }));
});

test('retained route evidence cannot qualify a different paired runtime or omit its runtime identity', () => {
  const h = fixture({ noPrepare: true });
  const upgraded = new RemuxOperations({ runtimeIdentity: 'f'.repeat(64), policyIdentity: 'changed-tools', policies: [h.retained] });
  required(() => upgraded.prepare(h.prepare));
  invalid(() => fixture({ policy: { runtimeIdentity: undefined } }));
  assert.ok(h.owner.prepare(h.prepare), 'The exact qualified pair still prepares normally.');
});

test('canonical identity helper binds exact identity with stable field ordering and bounded inert diagnostics', () => {
  const reordered = Object.fromEntries(Object.entries(SOURCE).reverse());
  assert.equal(fingerprintRemuxSourceIdentity(reordered), fingerprintRemuxSourceIdentity(SOURCE));
  assert.equal(fingerprintRemuxSourceIdentity({ ...SOURCE, diagnostic: 'bounded note' }), fingerprintRemuxSourceIdentity(SOURCE));
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest', 'canonicalPath']) {
    const changed = { ...SOURCE, [key]: key === 'sparseDigest' ? `sha256-sparse-v1:${'c'.repeat(64)}` : key === 'canonicalPath' ? 'F:\\other.mp4' : '3' };
    assert.notEqual(fingerprintRemuxSourceIdentity(changed), fingerprintRemuxSourceIdentity(SOURCE));
  }
  let reads = 0; const malicious = { ...SOURCE }; Object.defineProperty(malicious, 'size', { enumerable: true, get() { reads++; return '1'; } });
  invalid(() => fingerprintRemuxSourceIdentity(malicious)); assert.equal(reads, 0);
  invalid(() => fingerprintRemuxSourceIdentity({ ...SOURCE, diagnostic: {} }));
});

test('genuine immutable plans reuse only canonical stream-copy arguments and fixed reviewed controls', () => {
  const h = fixture(), selection = h.owner.select(h.bindings), result = h.owner.requireCurrent(selection, h.bindings);
  assert.ok(Object.isFrozen(h.plan) && Object.isFrozen(h.plan.args) && Object.isFrozen(h.plan.expectedOutput.streams));
  assert.deepEqual(h.plan.contract.range, { kind: 'full' }); assert.equal(h.plan.compatibilityPath, false); assert.equal(h.plan.operation, 'remux');
  assert.equal(h.plan.args[h.plan.args.indexOf('-c') + 1], 'copy'); assert.ok(h.plan.args.includes('-copyts') && h.plan.args.includes('-n'));
  assert.ok(!h.plan.args.includes('-vf') && !h.plan.args.includes('-af') && !h.plan.args.some(arg => arg.startsWith('-stats_enc')));
  assert.ok(!h.plan.args.some(arg => arg.includes(`${GENERATION_KEY}=`) && !arg.endsWith('=')));
  assert.deepEqual(result.budget, BUDGET); assert.equal(result.executionBudgetMs, 600000); assert.equal(result.controlsRequired, true); assert.equal(result.remux, true);
  assert.deepEqual(result.qualification.maxTimestampError, { numerator: '1', denominator: '500' });
  assert.deepEqual(result.qualification.maxChapterError, result.qualification.maxTimestampError); assert.deepEqual(result.evidenceIds, h.retained.evidenceIds);
  assert.ok(Object.isFrozen(result.qualification.maxTimestampError)); assert.equal(h.plan.sourceProbeFingerprint, remuxProbeFingerprint(h.probe));
});

test('assessed descriptive vendor labels remain copy attempts without blocking the functional route', () => {
  for (const streamIndex of [0, 1]) {
    const change = p => { p.streams[streamIndex].tags.vendor_id = 'FFMP'; };
    const mp4 = fixture({ target: 'mp4', change });
    assert.equal(mp4.plan.expectedOutput.streams[streamIndex].metadata.attempted.vendor_id, 'FFMP');
    assert.equal(Object.hasOwn(mp4.plan.expectedOutput.streams[streamIndex].metadata.preserved, 'vendor_id'), false);
    const alternative = fixture({ target: 'matroska', change });
    assert.equal(alternative.plan.expectedOutput.streams[streamIndex].metadata.attempted.vendor_id, 'FFMP');
  }
  assert.ok(fixture({ target: 'mp4' }).plan, 'Native MP4 without this unrepresentable source field remains a candidate.');
});

test('every current binding is checked and copied/foreign selections and plans fail replay', () => {
  const h = fixture(), selection = h.owner.select(h.bindings), other = fixture();
  for (const fake of [{}, clone(selection), null]) stale(() => h.owner.requireCurrent(fake, h.bindings));
  stale(() => other.owner.requireCurrent(selection, h.bindings));
  stale(() => h.owner.requireCurrent(selection, { ...h.bindings, plan: clone(h.plan) }));
  for (const change of [{ settings: {} }, { environment: {} }, { runtimeIdentity: 'c'.repeat(64) }, { sourceProbeFingerprint: 'c'.repeat(64) },
    { sourceIdentity: { ...h.identity, ctimeNs: '2' } }, { sourceIdentity: { ...h.identity, canonicalPath: 'F:\\other.mp4' } },
    { executionBudgetMs: 600001 }, { budget: { ...BUDGET, maxPcmBytes: BUDGET.maxPcmBytes + 1 } }, { target: 'mp4' }, { request: h.request }]) {
    required(() => h.owner.select({ ...h.bindings, ...change })); stale(() => h.owner.requireCurrent(selection, { ...h.bindings, ...change }));
  }
  for (const key of Object.keys(BUDGET)) {
    const budget = { ...BUDGET, [key]: key === 'sourceDecode' ? 'sampled' : BUDGET[key] - 1 };
    required(() => h.owner.select({ ...h.bindings, budget })); stale(() => h.owner.requireCurrent(selection, { ...h.bindings, budget }));
  }
  for (const key of Object.keys(h.bindings)) { const missing = { ...h.bindings }; delete missing[key]; required(() => h.owner.select(missing)); }
});

test('cancel/invalidation/reprepare revoke previous authority without revoking another prepared file', () => {
  const h = fixture(), selection = h.owner.select(h.bindings);
  const next = fixture({ owner: h.owner, fileId: 'another-file', outputId: NEXT_ID }); assert.ok(h.owner.requireCurrent(selection, h.bindings));
  invalid(() => h.owner.prepare(h.prepare)); stale(() => h.owner.requireCurrent(selection, h.bindings)); planRequired(() => h.owner.resolveInvocation(h.plan, { output: 'F:\\stage\\stale.mkv' }));
  const nextSelection = h.owner.select(next.bindings); h.owner.invalidate(); stale(() => h.owner.requireCurrent(nextSelection, next.bindings));
  planRequired(() => h.owner.validate(next.plan, {}, {}));
  const failure = fixture(), old = failure.owner.select(failure.bindings);
  invalid(() => failure.owner.prepare({ ...failure.prepare, sourceIdentity: { ...failure.identity, ino: '3' } }));
  stale(() => failure.owner.requireCurrent(old, failure.bindings));
});

test('actual invocation output is privately bound once and cannot borrow destination or cloned plans', () => {
  const h = fixture(), stage = 'F:\\owned-stage\\actual.mkv';
  invalid(() => h.owner.resolveInvocation(h.plan, { output: stage })); h.owner.select(h.bindings);
  const actual = h.owner.resolveInvocation(h.plan, { output: stage }); assert.equal(actual.at(-1), stage); assert.equal(h.plan.args.at(-1), h.prepare.output);
  assert.deepEqual(h.owner.resolveInvocation(h.plan, { output: stage }), actual); assert.ok(Object.isFrozen(actual));
  stale(() => h.owner.resolveInvocation(h.plan, { output: 'F:\\owned-stage\\other.mkv' }));
  planRequired(() => h.owner.resolveInvocation(clone(h.plan), { output: stage }));
  invalid(() => h.owner.resolveInvocation(h.plan, { output: h.prepare.input })); invalid(() => h.owner.resolveInvocation(h.plan, { output: 'https://invalid/stage' }));
  invalid(() => h.owner.resolveInvocation(h.plan, { output: stage, args: [] }));
});

test('retained MKV AAC and PCM MKV defects stay refused while genuine audio omissions can leave a qualified video route', () => {
  for (const target of ['mp4', 'mov']) {
    const h = fixture({ family: 'matroska', target, noPrepare: true }); required(() => h.owner.prepare(h.prepare));
    const videoOnly = fixture({ family: 'matroska', target, omit: [2] }); assert.equal(videoOnly.plan.expectedOutput.streams.length, 1);
  }
  const pcm = fixture({ noPrepare: true, change: p => { Object.assign(p.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16' }); delete p.streams[1].profile; } });
  required(() => pcm.owner.prepare(pcm.prepare));
  const videoOnly = fixture({ change: p => { Object.assign(p.streams[1], { codec_name: 'pcm_s16le', sample_fmt: 's16' }); delete p.streams[1].profile; }, omit: [2] });
  assert.equal(videoOnly.plan.expectedOutput.streams.length, 1);
});

const EXISTING_POLICIES = REMUX_POLICIES.filter(value => ['full-remux-isobmff-matroska-v1', 'full-remux-isobmff-mp4-v1',
  'full-remux-matroska-matroska-v1'].includes(value.id));
function fourPolicyOwner() {
  return new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-four-routes', policies: [
    ...EXISTING_POLICIES.map(value => ({ ...value, runtimeIdentity: RUNTIME })),
    { id: 'full-remux-matroska-mp4-v1', inputFamily: 'matroska', target: 'mp4', allowAncillary: false,
      audio: 'explicitly-omitted-only', evidenceIds: ['synthetic-mkv-mp4-only'], runtimeIdentity: RUNTIME },
  ] });
}
function twoAudio(probe) {
  probe.streams.push({ ...clone(probe.streams[1]), index: 5 }); probe.format.nb_streams++;
}
test('four-policy catalog admits Matroska-to-MP4 only after all current audio omissions, or without source audio', () => {
  for (const options of [{ change: twoAudio, omit: [2, 5] }, { audio: false }]) {
    const h = fixture({ family: 'matroska', target: 'mp4', owner: fourPolicyOwner(), ...options });
    assert.deepEqual(h.plan.expectedOutput.streams.map(item => item.inputIndex), [0]);
    assert.deepEqual(h.plan.expectedOutput.omittedStreams.map(item => item.inputIndex), options.omit || []);
    assert.deepEqual(h.plan.args.filter((arg, index, args) => args[index - 1] === '-map'), ['0:0']);
    const current = h.owner.requireCurrent(h.owner.select(h.bindings), h.bindings);
    assert.equal(current.sourcePolicy.id, 'full-remux-matroska-mp4-v1');
    assert.deepEqual(current.sourcePolicy.audioInputIndexes, []);
  }
});
test('explicit audio policy refuses every unomitted audio codec, including a partial multi-track omission', () => {
  for (const codec of ['aac', 'ac3', 'mp3']) {
    for (const omit of [[], [2]]) {
      const h = fixture({ family: 'matroska', target: 'mp4', owner: fourPolicyOwner(), noPrepare: true, omit,
        change: p => { twoAudio(p); p.streams[2].codec_name = codec; } });
      assert.throws(() => h.owner.prepare(h.prepare), error => error.code === 'REMUX_AUDIO_OMISSION_REQUIRED'
        && /current explicit omission decision for every audio stream/.test(error.message));
    }
  }
  const pcm = { family: 'matroska', target: 'mp4', owner: fourPolicyOwner(),
    change: p => { p.streams[1].codec_name = 'pcm_s16le'; } };
  reject(() => fixture(pcm), 'REMUX_NOT_PLANNABLE', 'Unsupported PCM is refused by the earlier contract guard.');
  assert.ok(fixture({ ...pcm, omit: [2] }).plan, 'An unsupported audio codec still requires its exact explicit omission.');
});
test('explicit audio policy cannot borrow stale or unresolved omission decisions', () => {
  for (const change of [{ id: 'unresolved' }, { fileId: 'another-file' }, { identityRevision: 2 }, { draftRevision: 2 },
    { sourceFingerprint: 'c'.repeat(64) }, { target: 'mov' }, { operation: 'encode' }, { streamIndex: 0 },
    { streamFingerprint: 'c'.repeat(64) }, { action: 'preserve-copy' }]) {
    const h = fixture({ family: 'matroska', target: 'mp4', owner: fourPolicyOwner(), noPrepare: true, omit: [2],
      changeDecisions: decisions => Object.assign(decisions[0], change) });
    assert.ok(h.assessment.blockers.some(item => ['REMUX_OMISSION_STALE', 'REMUX_OMISSION_UNAUTHORIZED'].includes(item.code)));
    assert.deepEqual(h.assessment.expectedOutput.omittedStreams, []);
    reject(() => h.owner.prepare(h.prepare), 'REMUX_NOT_PLANNABLE');
  }
});
test('Matroska-to-MP4 refuses required track tags without a declared representation before Start', () => {
  for (const key of ['BPS', '_STATISTICS_WRITING_APP', 'unassessed.track', 'replaygain_track_gain', 'rotate']) {
    assert.throws(() => fixture({ family: 'matroska', target: 'mp4', audio: false, owner: fourPolicyOwner(),
      change: p => { p.streams[0].tags[key] = 'unrepresentable'; } }), error => error.code === 'REMUX_TRACK_TAG_UNREPRESENTABLE'
        && error.message.includes(`'${key}'`) && error.message.includes('stream 0'));
  }
  const h = fixture({ family: 'matroska', target: 'mp4', audio: false, owner: fourPolicyOwner(), change: p => {
    p.streams[0].tags = { ENCODER: 'Lavc63.1.102 libx264', HANDLER_NAME: 'VideoHandler', VENDOR_ID: 'FFMP', DURATION: '00:00:01.640000000' };
  } });
  assert.ok(h.plan); assert.equal(h.plan.expectedOutput.streams[0].metadata.attempted.VENDOR_ID, 'FFMP');
  for (const route of EXISTING_POLICIES) {
    const kept = fixture({ family: route.inputFamily, target: route.target, change: p => {
      Object.assign(p.streams[0].tags, { BPS: '12345', _STATISTICS_WRITING_APP: 'mkvmerge' });
    } });
    assert.ok(kept.plan, route.id);
  }
});
test('Matroska-to-MP4 rejects short/uppercase/regional language and empty native fields before Start', () => {
  for (const [key, value] of [['language', 'en'], ['language', 'EN'], ['language', 'en-US'], ['language', 'English'], ['language', ''], ['HANDLER_NAME', '']]) {
    assert.throws(() => fixture({ family: 'matroska', target: 'mp4', audio: false, owner: fourPolicyOwner(),
      change: p => { p.streams[0].tags = { [key]: value }; } }), error => error.code === 'REMUX_TRACK_TAG_UNREPRESENTABLE' && error.message.includes(`'${key}'`));
    for (const route of EXISTING_POLICIES) assert.ok(fixture({ family: route.inputFamily, target: route.target,
      change: p => { p.streams[0].tags = { [key]: value }; } }).plan, route.id);
  }
  assert.ok(fixture({ family: 'matroska', target: 'mp4', audio: false, owner: fourPolicyOwner(),
    change: p => { p.streams[0].tags = { language: 'eng', HANDLER_NAME: 'VideoHandler' }; } }).plan);
});
test('audio route option rejects other routes, unknown values and getter authority', () => {
  const h = fixture({ family: 'matroska', target: 'mp4', noPrepare: true });
  const make = policy => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-audio-policy', policies: [{ ...h.retained, ...policy }] });
  for (const [inputFamily, target] of [['isobmff', 'mp4'], ['isobmff', 'matroska'], ['matroska', 'matroska'], ['matroska', 'mov']])
    invalid(() => make({ inputFamily, target, audio: 'explicitly-omitted-only' }));
  for (const audio of [undefined, null, '', 'copy', 'explicitly-omitted', true, {}, []]) invalid(() => make({ audio }));
  invalid(() => make({ audio: 'explicitly-omitted-only', allowAncillary: true }));
  let reads = 0; const policy = { ...h.retained };
  Object.defineProperty(policy, 'audio', { enumerable: true, get() { reads++; return 'explicitly-omitted-only'; } });
  invalid(() => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'getter-policy', policies: [policy] }));
  assert.equal(reads, 0);
});
test('adding the audio-only route leaves the three existing routes and their plans unchanged', () => {
  assert.equal(EXISTING_POLICIES.length, 3);
  for (const route of EXISTING_POLICIES) {
    assert.equal(Object.hasOwn(route, 'audio'), false);
    const policies = EXISTING_POLICIES.map(value => ({ ...value, runtimeIdentity: RUNTIME }));
    const before = new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'same-catalog-identity', policies });
    const after = new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'same-catalog-identity', policies: [...policies,
      { id: 'synthetic-fourth', inputFamily: 'matroska', target: 'mp4', audio: 'explicitly-omitted-only', allowAncillary: false,
        evidenceIds: ['synthetic'], runtimeIdentity: RUNTIME }] });
    const options = { family: route.inputFamily, target: route.target };
    const a = fixture({ ...options, owner: before }), b = fixture({ ...options, owner: after });
    assert.deepEqual(a.plan, b.plan, route.id);
    assert.deepEqual(before.requireCurrent(before.select(a.bindings), a.bindings), after.requireCurrent(after.select(b.bindings), b.bindings));
  }
});

test('Q2d proof configuration refuses unknown cases/modes/extra flags and normal mode uses only the production catalog', () => {
  // Importing the harness calls no main, child or filesystem operation.
  const { configuration, routeOptions, CASES, LIMITS } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  for (const mode of ['--qualify', '--normal']) {
    const config = configuration(['--run-owned-remux', mode, '--cases', CASES.join(',')]);
    assert.equal(config.mode, mode); assert.deepEqual(config.choices, [...CASES]);
    assert.ok(Object.isFrozen(config) && Object.isFrozen(config.choices));
  }
  for (const cli of [[], ['--run-owned-remux'], ['--run-owned-remux', '--qualify', '--cases', ''],
    ['--run-owned-remux', '--qualify', '--cases', CASES[0] + ',' + CASES[0]],
    ['--run-owned-remux', '--qualify', '--cases', 'E-mkv'], ['--run-owned-remux', '--qualify', '--cases', CASES[0] + ',unknown'],
    ['--run-owned-remux', '--qualify', '--cases', CASES[0], '--lifecycle'],
    ['--run-owned-remux', '--qualify', '--cases', 1], ['--run-owned-remux', '--other', '--cases', CASES[0]],
    ['--run-other', '--qualify', '--cases', CASES[0]], ['--run-owned-remux', '--normal', '--all', CASES[0]]]) assert.throws(() => configuration(cli));
  assert.throws(() => routeOptions('--other'));
  const promoted = REMUX_POLICIES.some(value => value.inputFamily === 'matroska' && value.target === 'mp4');
  if (promoted) {
    const normal = routeOptions('--normal');
    assert.equal(normal.remuxPolicies, REMUX_POLICIES);
    assert.equal(normal.remuxPolicyIdentity, require('../src/remux-catalog.cjs').REMUX_POLICY_ID);
  } else assert.throws(() => routeOptions('--normal'), /requires full-remux-matroska-mp4-v1/);
  const lab = routeOptions('--qualify');
  for (const route of REMUX_POLICIES.filter(value => value.inputFamily !== 'matroska' || value.target !== 'mp4'))
    assert.equal(lab.remuxPolicies.find(value => value.id === route.id), route);
  const route = lab.remuxPolicies.find(value => value.inputFamily === 'matroska' && value.target === 'mp4');
  assert.equal(route.audio, 'explicitly-omitted-only'); assert.equal(route.allowAncillary, false); assert.equal(route.allowRotation90, false);
  assert.deepEqual(CASES, ['timeline-video-mp4', 'cfr-video-mp4', 'bframe-video-mp4']);
  assert.deepEqual(LIMITS, { totalMs: 3600000, forecastBytes: 2147483648, maxInvocations: 128, maxStarts: 5 });
});
test('Q2d proof refuses mislabeled cadence and exhausted Start budgets without running media', () => {
  const { requireCadence, requireStartBudget, LIMITS } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const essence = { streams: [{ codecType: 'video', source: { cadence: { classification: 'constant' } }, output: { cadence: { classification: 'constant' } } }] };
  requireCadence(essence, 'constant');
  for (const change of [e => { e.streams = []; }, e => { e.streams.push(clone(e.streams[0])); }, e => { e.streams[0].codecType = 'audio'; },
    e => { e.streams[0].source.cadence.classification = 'variable'; }, e => { e.streams[0].output.cadence.classification = 'variable'; }]) {
    const changed = clone(essence); change(changed); assert.throws(() => requireCadence(changed, 'constant'));
  }
  assert.throws(() => requireCadence(essence, 'nominal-CFR'));
  requireStartBudget(0); requireStartBudget(LIMITS.maxStarts - 1);
  for (const count of [LIMITS.maxStarts, LIMITS.maxStarts + 1, -1, 0.5, NaN, '0']) assert.throws(() => requireStartBudget(count));
});

test('Q2d normal route and omission checks pin the exact reviewed policy and error code', () => {
  const { requireProductionRoute, requireOmissionRefusal } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const route = { id: 'full-remux-matroska-mp4-v1', inputFamily: 'matroska', target: 'mp4', audio: 'explicitly-omitted-only' };
  assert.equal(requireProductionRoute([route]), route);
  assert.throws(() => requireProductionRoute([]), /real production catalog/);
  for (const change of [{ id: 'laboratory' }, { audio: undefined }, { audio: 'copy' }, { inputFamily: 'isobmff' }, { target: 'mov' }])
    assert.throws(() => requireProductionRoute([{ ...route, ...change }]));
  requireOmissionRefusal({ status: 'unsupported', reasonCode: 'REMUX_AUDIO_OMISSION_REQUIRED' });
  requireOmissionRefusal({ status: 'unsupported', remux: { blockers: [{ code: 'REMUX_AUDIO_OMISSION_REQUIRED' }] } });
  for (const item of [{ status: 'ready', reasonCode: 'REMUX_AUDIO_OMISSION_REQUIRED' }, { status: 'unsupported', reason: 'Matroska AAC priming omission' },
    { status: 'unsupported', reasonCode: 'REMUX_QUALIFICATION_REQUIRED' },
    { status: 'unsupported', reasonCode: 'OTHER', remux: { blockers: [{ code: 'REMUX_AUDIO_OMISSION_REQUIRED' }] } }]) assert.throws(() => requireOmissionRefusal(item));
});
test('Q2d outcomes reject every extra, missing, changed or duplicated warning and pin the CFR rate branch', () => {
  const { requireOutcome, requireCfrRates } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const vendor = { code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', key: 'VENDOR_ID',
    message: "Stream 0 → 0: descriptive metadata 'VENDOR_ID' is missing or changed in its requested representation." };
  const average = { code: 'OPERATION_VALIDATION_WARNING',
    message: 'Stream 0 → 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.' };
  for (const [label, warnings] of [['timeline-video-mp4', [vendor, average]], ['bframe-video-mp4', [vendor]],
    ['cfr-video-mp4', []], ['cfr-seed-mkv', []], ['bframe-seed-mkv', []]]) {
    const outcome = warnings.length ? 'saved-with-warning' : 'saved';
    requireOutcome(label, { outcome, warnings });
    requireOutcome(label, { outcome, warnings: [...warnings].reverse() });
    assert.throws(() => requireOutcome(label, { outcome: outcome === 'saved' ? 'saved-with-warning' : 'saved', warnings }));
    assert.throws(() => requireOutcome(label, { outcome, warnings: [...warnings, average] }));
    if (warnings.length) {
      assert.throws(() => requireOutcome(label, { outcome, warnings: warnings.slice(1) }));
      for (const change of [{ key: 'vendor_id' }, { code: 'OTHER' }, { message: 'Another validation warning' }])
        assert.throws(() => requireOutcome(label, { outcome, warnings: [{ ...warnings[0], ...change }, ...warnings.slice(1)] }));
      assert.throws(() => requireOutcome(label, { outcome, warnings: [...warnings, warnings[0]] }));
    }
  }
  assert.throws(() => requireOutcome('__proto__', { outcome: 'saved' }));
  const probe = { streams: [{ codec_type: 'video', avg_frame_rate: '10/1', r_frame_rate: '10/1' }] }; requireCfrRates(probe);
  for (const change of [{ avg_frame_rate: undefined }, { avg_frame_rate: '' }, { r_frame_rate: undefined }, { r_frame_rate: '30/1' }])
    assert.throws(() => requireCfrRates({ streams: [{ ...probe.streams[0], ...change }] }));
});
test('Q2d B-frame proof is bound to the pinned source receipt and its retained positive raw observation', () => {
  const { bframeFixture, requireBframeSource, requireBframeObservation } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const file = path.join('F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned',
    'fixtures/sdr-envelope-6b317682-605b-4d40-8ff3-b3f84678f0ae/B-1280x720-30fps.mov');
  const hash = 'd6030cb3613006b72da5ea02a80fefd82ad14f57c76268b823a691f83e162273';
  const receipt = { cases: [{ id: 'B', output: file, file: { sha256: hash } }], invocations: [
    { kind: 'metadata', argv: ['-i', file], exitCode: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', has_b_frames: 2 }] }) },
  ] };
  const specimen = requireBframeSource(receipt); assert.equal(specimen.proof.kind, 'retained-raw-metadata');
  assert.equal(specimen.proof.value, 2); assert.match(specimen.file, /B-1280x720-30fps\.mov$/);
  assert.equal(specimen.sha256, 'd6030cb3613006b72da5ea02a80fefd82ad14f57c76268b823a691f83e162273');
  assert.throws(() => bframeFixture(Buffer.from('{}')), /receipt changed/);
  for (const change of [r => { r.cases[0].id = 'E'; }, r => { r.cases[0].output = 'foreign'; }, r => { r.cases[0].file.sha256 = '0'.repeat(64); },
    r => { r.invocations = []; }, r => { r.invocations[0].exitCode = 1; }, r => { r.invocations[0].stdout = '{}'; },
    r => { r.invocations[0].stdout = JSON.stringify({ streams: [{ codec_type: 'video', has_b_frames: 0 }] }); }]) {
    const changed = clone(receipt); change(changed); assert.throws(() => requireBframeSource(changed));
  }
  for (const video of [undefined, {}, { has_b_frames: 0 }, { has_b_frames: -1 }, { has_b_frames: '2' }, { has_b_frames: 1.5 }])
    assert.throws(() => requireBframeObservation(video));
});
test('Q2d child admission enforces the copy ceiling for any path and accounts for the storage floor and actual growth', () => {
  const { countFileCopy, requireSpace, requireGrowth, LIMITS } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const owned = path.join('F:\\proof', 'run'), ffmpeg = path.join('D:\\tools', 'ffmpeg.exe');
  const args = ['-n', '-c', 'copy', path.join(owned, 'stage.mp4')];
  let copies = 0; for (let i = 0; i < LIMITS.maxStarts; i++) copies = countFileCopy(ffmpeg, args, ffmpeg, owned, copies);
  assert.equal(copies, LIMITS.maxStarts);
  assert.throws(() => countFileCopy(ffmpeg, args, ffmpeg, owned, copies), /Start ceiling/);
  assert.equal(countFileCopy(ffmpeg, ['-f', 'framehash', 'pipe:1'], ffmpeg, owned, copies), copies);
  assert.equal(countFileCopy('ffprobe', ['-of', 'json'], ffmpeg, owned, copies), copies);
  assert.throws(() => countFileCopy(ffmpeg, ['-c', 'libx264', args.at(-1)], ffmpeg, owned, 0));
  assert.throws(() => countFileCopy(ffmpeg, ['-c', 'copy', path.join('F:\\other', 'stage.mp4')], ffmpeg, owned, 0));
  const floor = require('../src/operation-storage.cjs').LIMITS.minFreeBytes;
  const enough = { DFreeBytes: 25 * 1024 ** 3, FFreeBytes: floor + LIMITS.forecastBytes + 512 * 1024 ** 2 }; requireSpace(enough);
  for (const change of [{ DFreeBytes: enough.DFreeBytes - 1 }, { FFreeBytes: enough.FFreeBytes - 1 }, { FFreeBytes: LIMITS.forecastBytes + 512 * 1024 ** 2 },
    { FFreeBytes: '99999999999' }, { DFreeBytes: Infinity }]) assert.throws(() => requireSpace({ ...enough, ...change }));
  assert.equal(requireGrowth(7, 7 + LIMITS.forecastBytes), LIMITS.forecastBytes);
  for (const values of [[7, 8 + LIMITS.forecastBytes], [7, 6], [-1, 0], [0, NaN], ['0', 1]]) assert.throws(() => requireGrowth(...values));
});
test('Q2d actual-growth walk accounts for every file and refuses malformed or unbounded trees', async () => {
  const { ownedBytes } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');
  const stat = (type, size = 0) => ({ size, isFile: () => type === 'file', isDirectory: () => type === 'dir', isSymbolicLink: () => type === 'link' });
  const root = path.resolve('inert-owned');
  const tree = new Map([[root, stat('dir')], [path.join(root, 'state'), stat('dir')], [path.join(root, 'state', 'receipt'), stat('file', 17)], [path.join(root, 'output'), stat('file', 23)]]);
  assert.equal(await ownedBytes(root, { lstat: async p => tree.get(p), readdir: async p => p === root ? ['state', 'output'] : ['receipt'] }), 40);
  for (const type of ['link', 'special']) await assert.rejects(ownedBytes(root, { lstat: async () => stat(type) }));
  for (const size of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(ownedBytes(root, { lstat: async () => stat('file', size) }));
  for (const name of ['', '.', '..', '../outside', 'a/b', 'a\\b', 1]) await assert.rejects(ownedBytes(root, { lstat: async () => stat('dir'), readdir: async () => [name] }));
  await assert.rejects(ownedBytes(root, { lstat: async () => stat('dir'), readdir: async () => ['deeper'] }), /structural bound/);
  await assert.rejects(ownedBytes(root, { lstat: async p => stat(p === root ? 'dir' : 'file'), readdir: async () => Array.from({ length: 8193 }, (_, i) => String(i)) }), /structural bound/);
});

test('the finite SDR/source envelope refuses unmeasured dimensions/rates/color/layout and bounded observation conflicts', () => {
  for (const change of [p => { p.streams[0].width = 1921; }, p => { p.streams[0].height = 1920; }, p => { p.streams[0].pix_fmt = 'yuv420p10le'; },
    p => { p.streams[0].field_order = 'tt'; }, p => { p.streams[0].r_frame_rate = '61/1'; }, p => { p.streams[0].avg_frame_rate = '0/0'; },
    p => { p.streams[0].color_transfer = 'smpte2084'; }, p => { delete p.streams[0].color_range; }, p => { p.streams[0].sample_aspect_ratio = '4:3'; },
    p => { p.streams[1].sample_rate = '96000'; }, p => { p.streams[1].channel_layout = '5.1'; }, p => { p.streams[1].codec_name = 'opus'; },
    p => { p.format.duration = '121'; }, p => { p.format.size = '1'; }]) {
    const h = fixture({ noPrepare: true, change }); required(() => h.owner.prepare(h.prepare));
  }
  const absent = fixture({ noPrepare: true, change: p => { delete p.format.duration; } }); required(() => absent.owner.prepare(absent.prepare));
  required(() => fingerprintRemuxSourceIdentity({ ...SOURCE, size: String(512 * 1024 * 1024 + 1) }));
});

test('rotation opt-in requires exact independent native matrix and rejects other side-data', () => {
  const rotate = p => { p.streams[0].side_data_list = [{ side_data_type: 'Display Matrix', rotation: 90,
    displaymatrix: '\n00000000: 0 -65536 0\n00000001: 65536 0 0\n00000002: 0 0 1073741824\n' }]; };
  const h = fixture({ noPrepare: true, change: rotate }); required(() => h.owner.prepare(h.prepare));
  assert.ok(fixture({ change: rotate, policy: { allowRotation90: true } }).plan);
  const hostile = fixture({ noPrepare: true, change: p => { p.streams[0].side_data_list = [{ side_data_type: 'Stereo 3D' }]; } }); required(() => hostile.owner.prepare(hostile.prepare));
});

test('timed data and relationships remain hard refusals even with main-authorized stream omission', () => {
  const p = source(); p.streams.push({ index: 4, codec_type: 'data', codec_name: 'tmcd' }); p.format.nb_streams++;
  const h = fixture({ probe: p, target: 'mov', omit: [4], noPrepare: true }); required(() => h.owner.prepare(h.prepare));
  const grouped = fixture({ noPrepare: true, change: value => { value.format.nb_stream_groups = 1; value.stream_groups = [{ index: 0, streams: [{ index: 0 }] }]; } });
  reject(() => grouped.owner.prepare(grouped.prepare), 'REMUX_NOT_PLANNABLE');
  const ts = fixture({ noPrepare: true, policy: { inputFamily: 'isobmff' }, change: value => { value.format.format_name = 'mpegts'; } });
  reject(() => ts.owner.prepare(ts.prepare), 'REMUX_NOT_PLANNABLE');
});

test('ancillary policy is explicit and MP4 chapter carriers cannot borrow Matroska qualification', () => {
  const p = source(); p.streams.push({ index: 4, codec_type: 'subtitle', codec_name: 'subrip', time_base: '1/1000' }); p.format.nb_streams++;
  const h = fixture({ probe: p, noPrepare: true }); required(() => h.owner.prepare(h.prepare));
  p.format.format_name = 'matroska,webm'; assert.ok(fixture({ probe: p, policy: { allowAncillary: true } }).plan);
  const chapters = source(); chapters.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: { title: 'First' } }];
  required(() => fixture({ probe: chapters, target: 'mp4' }));
  invalid(() => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'policy', policies: [{ id: 'p', inputFamily: 'isobmff', target: 'mp4', evidenceIds: ['e'], allowAncillary: true, runtimeIdentity: RUNTIME }] }));
});

test('single preserved TTF is qualified while omitted or multiple attachments fail before Start', () => {
  const p = source({ family: 'matroska' });
  p.streams.push({ index: 4, codec_type: 'attachment', codec_name: 'ttf', extradata_size: 24,
    extradata_hash: `SHA256:${'9'.repeat(64)}`, tags: { filename: 'owned.ttf', mimetype: 'application/x-truetype-font' } });
  p.format.nb_streams++;
  assert.ok(fixture({ probe: p, policy: { allowAncillary: true } }).plan);
  assert.throws(() => fixture({ probe: p, omit: [4], policy: { allowAncillary: true } }),
    error => error.code === 'REMUX_QUALIFICATION_REQUIRED' && /Restore the attachment/.test(error.message));
  assert.ok(fixture({ probe: p, omit: [2], policy: { allowAncillary: true } }).plan, 'Exact audio omission remains available.');
  p.streams.push({ ...clone(p.streams[2]), index: 5 }); p.format.nb_streams++;
  required(() => fixture({ probe: p, policy: { allowAncillary: true } }));
});

test('catalogs are immutable bounded main-owned data and reject forged authority fields/getters', () => {
  const h = fixture({ noPrepare: true }); h.retained.evidenceIds.length = 0; assert.ok(h.owner.prepare(h.prepare));
  const make = policies => new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'policy', policies });
  for (const change of [{ evidenceIds: [] }, { evidenceIds: ['same', 'same'] }, { evidenceIds: new Array(1) }, { id: '' }, { inputFamily: 'mpegts' },
    { target: 'mpegts' }, { allowAncillary: 'yes' }, { maxTimestampError: { numerator: '1', denominator: '1' } }, { status: 'verified' }]) invalid(() => make([{ ...h.retained, evidenceIds: ['e'], ...change }]));
  invalid(() => make([{ ...h.retained, evidenceIds: ['e'] }, { ...h.retained, id: 'other', evidenceIds: ['e'] }]));
  let reads = 0; const p = { ...h.retained, evidenceIds: ['e'] }; Object.defineProperty(p, 'target', { enumerable: true, get() { reads++; return 'mp4'; } });
  invalid(() => make([p])); assert.equal(reads, 0);
});

async function collected(t, { offset = 0, contentChanged = false, metadataChanged = false, mov = false, variable = false, route } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-owner-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^remux-owner-test-/); await fs.rm(directory, { recursive: true, force: true }); });
  const input = path.join(directory, 'source.inert'), output = path.join(directory, 'output.inert'), stageDirectory = path.join(directory, 'evidence');
  await fs.writeFile(input, 'source inert fixture'); await fs.writeFile(output, mov ? movFixture([{ id: 1 }]) : 'output inert fixture'); await fs.mkdir(stageDirectory);
  const identity = await readSourceIdentity(input), p = source({ audio: false, family: route?.inputFamily }); p.format.size = identity.size;
  Object.assign(p.streams[0], { width: 2, height: 2, display_aspect_ratio: '1:1', avg_frame_rate: '1/1', r_frame_rate: '1/1', time_base: '1/1000', duration_ts: 2000 });
  // MOV declares stream titles differently; this check is about track languages only.
  const targetName = route?.target || (mov ? 'mov' : 'matroska');
  if (targetName !== 'matroska') delete p.streams[0].tags.title;
  const h = fixture({ probe: p, identity, target: targetName, ...(route ? { policy: { ...route, runtimeIdentity: RUNTIME } } : {}) }),
    selection = h.owner.select(h.bindings); h.owner.requireCurrent(selection, h.bindings);
  h.owner.resolveInvocation(h.plan, { output });
  const target = clone(p); target.format.format_name = targetName === 'matroska' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2'; if (mov) target.streams[0].id = '0x1'; target.format.tags = { ...target.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: OUTPUT_ID };
  const pts = variable ? [0, 500, 1500] : [0, 1000], duration = variable ? 500 : 1000;
  const run = async (executable, args, options) => {
    const isOutput = args[args.indexOf('-i') + 1] === output; let bytes;
    if (args.includes('-show_frames')) bytes = Buffer.from(JSON.stringify({ frames: pts.map(pts => ({ media_type: 'video', stream_index: 0,
      pts: pts + (isOutput ? offset : 0), duration, width: 2, height: 2, pix_fmt: 'yuv420p', key_frame: 1,
      ...(isOutput && metadataChanged ? { color_primaries: 'bt2020' } : {}) })) }));
    else if (args.includes('-show_packets')) bytes = Buffer.from(JSON.stringify({ packets: pts.map(pts => ({ stream_index: 0, pts, duration, size: '6', data_hash: `SHA256:${'c'.repeat(64)}` })) }));
    else bytes = Buffer.from('#hash: SHA256\n' + pts.map((pts, i) => `0, ${i}, ${pts}, ${duration}, 6, ${(isOutput && contentChanged && i === 0 ? 'd' : 'c').repeat(64)}\n`).join(''));
    await options.onStdoutChunk(bytes);
    return { exitCode: 0, stdout: '', stderr: '', stderrCapture: { totalBytes: 0, truncated: false }, stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true } };
  };
  const receipt = await collectRemuxEvidence({ assessment: h.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID,
    sourcePath: input, outputPath: output, sourceProbe: p, outputProbe: target, stageDirectory,
    ffmpeg: path.join(directory, 'mock-ffmpeg.exe'), ffprobe: path.join(directory, 'mock-ffprobe.exe'), run, budget: clone(BUDGET) });
  assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure)); return { ...h, receipt, target, output };
}

test('complete genuine collected evidence validates actual stage while serialized/laundered receipts fail', async t => {
  const h = await collected(t), result = h.owner.validate(h.plan, h.target, h.receipt);
  assert.equal(result.valid, true); assert.equal(result.operation, 'remux');
  reject(() => h.owner.validate(h.plan, h.target, clone(h.receipt)), 'REMUX_EVIDENCE_RECEIPT_REQUIRED');
  invalid(() => h.owner.validate(h.plan, h.target, h.receipt, { outputFileSha256: 'f'.repeat(64) }));
  const changed = clone(h.target); changed.streams[0].tags.title = 'Changed'; invalid(() => h.owner.validate(h.plan, changed, h.receipt));
  const other = fixture(); other.owner.select(other.bindings); other.owner.resolveInvocation(other.plan, { output: h.output });
  reject(() => other.owner.validate(other.plan, h.target, h.receipt), 'REMUX_EVIDENCE_RECEIPT_REQUIRED');
  const anotherOwner = fixture({ probe: h.probe, identity: h.identity, noPrepare: true });
  const renewed = anotherOwner.owner.prepare(h.prepare); anotherOwner.owner.select({ ...h.bindings, plan: renewed });
  invalid(() => anotherOwner.owner.validate(renewed, h.target, h.receipt));
  anotherOwner.owner.resolveInvocation(renewed, { output: `${h.output}.different` }); invalid(() => anotherOwner.owner.validate(renewed, h.target, h.receipt));
  invalid(() => h.owner.prepare(h.prepare)); h.owner.invalidate(); invalid(() => h.owner.prepare(h.prepare));
});

test('the four existing routes still validate complete variable cadence without the MOV envelope gate', async t => {
  assert.equal(PRE_MOV_POLICIES.length, 4);
  for (const route of PRE_MOV_POLICIES) {
    const h = await collected(t, { route, variable: true });
    const video = h.receipt.essenceEvidence.streams.find(stream => stream.codecType === 'video');
    assert.equal(video.source.cadence.classification, 'variable'); assert.equal(video.output.cadence.classification, 'variable');
    const result = h.owner.validate(h.plan, h.target, h.receipt);
    assert.equal(result.valid, true, route.id + ': ' + result.errors.join('; '));
  }
});

test('complete receipts cannot weaken native content, metadata or fixed timing validation', async t => {
  for (const options of [{ contentChanged: true }, { metadataChanged: true }, { offset: 3 }]) {
    const h = await collected(t, options), result = h.owner.validate(h.plan, h.target, h.receipt);
    assert.equal(result.valid, false); assert.match(result.errors.join('\n'), options.offset ? /maxPtsError|interval/ : /native essence/);
  }
});

test("a MOV remux validates with the collector's own MOV observation and refuses any other representation receipt", async t => {
  const h = await collected(t, { mov: true });
  const own = getCollectedMovRepresentation(h.receipt, { assessment: h.assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID });
  assert.equal(own.tracks[0].languageCode, 32767);
  const result = h.owner.validate(h.plan, h.target, h.receipt);
  assert.equal(result.valid, true, result.errors?.join('; '));
  assert.equal(h.owner.validate(h.plan, h.target, h.receipt, { movRepresentationReceipt: own }).valid, true);
  const file = await writeMovFixture(t, movFixture([{ id: 1 }]));
  const foreign = await observeMovRepresentation({ outputId: OUTPUT_ID, outputProbe: h.target, fileReceipt: file });
  assert.throws(() => h.owner.validate(h.plan, h.target, h.receipt, { movRepresentationReceipt: foreign }), /collector's own observation/);
  assert.throws(() => h.owner.validate(h.plan, h.target, h.receipt, { movRepresentationReceipt: clone(own) }), /collector's own observation/);
  // A Matroska remux has no MOV observation, so none can be supplied.
  const mkv = await collected(t);
  assert.throws(() => mkv.owner.validate(mkv.plan, mkv.target, mkv.receipt, { movRepresentationReceipt: own }), /collector's own observation/);
});
