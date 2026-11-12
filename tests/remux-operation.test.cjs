'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
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

async function collected(t, { offset = 0, contentChanged = false, metadataChanged = false, mov = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-owner-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^remux-owner-test-/); await fs.rm(directory, { recursive: true, force: true }); });
  const input = path.join(directory, 'source.inert'), output = path.join(directory, 'output.inert'), stageDirectory = path.join(directory, 'evidence');
  await fs.writeFile(input, 'source inert fixture'); await fs.writeFile(output, mov ? movFixture([{ id: 1 }]) : 'output inert fixture'); await fs.mkdir(stageDirectory);
  const identity = await readSourceIdentity(input), p = source({ audio: false }); p.format.size = identity.size;
  Object.assign(p.streams[0], { width: 2, height: 2, display_aspect_ratio: '1:1', avg_frame_rate: '1/1', r_frame_rate: '1/1', time_base: '1/1000', duration_ts: 2000 });
  // MOV declares stream titles differently; this check is about track languages only.
  if (mov) delete p.streams[0].tags.title;
  const h = fixture({ probe: p, identity, ...(mov ? { target: 'mov' } : {}) }), selection = h.owner.select(h.bindings); h.owner.requireCurrent(selection, h.bindings);
  h.owner.resolveInvocation(h.plan, { output });
  const target = clone(p); target.format.format_name = mov ? 'mov,mp4,m4a,3gp,3g2,mj2' : 'matroska,webm'; if (mov) target.streams[0].id = '0x1'; target.format.tags = { ...target.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: OUTPUT_ID };
  const run = async (executable, args, options) => {
    const isOutput = args[args.indexOf('-i') + 1] === output; let bytes;
    if (args.includes('-show_frames')) bytes = Buffer.from(JSON.stringify({ frames: [0, 1000].map(pts => ({ media_type: 'video', stream_index: 0,
      pts: pts + (isOutput ? offset : 0), duration: 1000, width: 2, height: 2, pix_fmt: 'yuv420p', key_frame: 1,
      ...(isOutput && metadataChanged ? { color_primaries: 'bt2020' } : {}) })) }));
    else if (args.includes('-show_packets')) bytes = Buffer.from(JSON.stringify({ packets: [0, 1000].map(pts => ({ stream_index: 0, pts, duration: 1000, size: '6', data_hash: `SHA256:${'c'.repeat(64)}` })) }));
    else bytes = Buffer.from(`#hash: SHA256\n0, 0, 0, 1, 6, ${(isOutput && contentChanged ? 'd' : 'c').repeat(64)}\n0, 1, 1, 1, 6, ${'c'.repeat(64)}\n`);
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
