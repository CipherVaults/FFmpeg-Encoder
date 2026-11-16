'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createLongRangeService, assertLongRangeReceipt, assertQualifiedClocks, ClockQualifiedFamilySelector, REPORT, REPORT_SHA } = require('./workbench-long-range-service.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { deriveCfrFlacResources, FAMILY_ID, RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const { buildEncodeOperation, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { classifyColor } = require('../src/media.cjs');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}
// Synthetic structure exercises refusal logic, never a media qualification.
function report() {
  const sources = ['long-pattern', 'heldout-flipped'].map((id, i) => ({ id, sourceExtentUs: (i ? 11 : 150) * 1000000,
    sha256: (i ? 'b' : 'a').repeat(64), identity: { size: '100000000' }, probe: probe(i ? 11 : 150),
    frozen: frozenQualifications(`${path.basename(path.dirname(REPORT))}:${id}`, RUNTIME_ID, probe(i ? 11 : 150)) }));
  const cases = [ ['late-forty-seconds', 0, { startUs: 100000000, endUs: 140000000 }],
    ['late-open-end', 0, { startUs: 130000000 }], ['heldout-nonaligned', 1, { startUs: 413000, endUs: 8621000 }] ].map(([id, index, range]) => {
    const source = sources[index], end = range.endUs ?? source.sourceExtentUs;
    return { id, sourceId: source.id, range, status: 'passed', validation: { valid: true },
      resources: deriveCfrFlacResources({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - range.startUs, sourceBytes: source.identity.size }),
      pipeBytes: 1, elapsedMs: 1, frames: Math.ceil(end * 30 / 1e6) - Math.ceil(range.startUs * 30 / 1e6),
      samples: Math.ceil(end * 48000 / 1e6) - Math.ceil(range.startUs * 48000 / 1e6),
      pcmIdentity: { sourceHash: 'c'.repeat(64), outputHash: 'c'.repeat(64) }, completeSource: { video: { frames: source.sourceExtentUs * 30 / 1e6 },
        audio: [{ sampleCount: String(source.sourceExtentUs * 48000 / 1e6) }] } };
  });
  return { status: 'passed-pre-catalog-calibration', runtimeIdentity: RUNTIME_ID, resourcePolicy: RESOURCE_POLICY,
    publicationAuthorized: false, catalogActivated: false, settings, census: { spawned: 34, closed: 34, live: 0, maximum: 1 }, sources, cases };
}
const validate = r => { const bytes = Buffer.from(JSON.stringify(r)); return assertLongRangeReceipt(bytes, sha(bytes)); };
test('pending, missing or changed digests cannot authorize a receipt', async () => {
  assert.equal(REPORT_SHA, 'dc5af4b1c949e0ac8e6261493f67de5230ec4173d21b73a705287d183add2a33');
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}'), null), /pending/);
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}'), ''), /pending/);
  assert.throws(() => assertLongRangeReceipt(Buffer.from('{}')), /exact reviewed/);
  const bad = Buffer.from('{'); assert.throws(() => assertLongRangeReceipt(bad, sha(bad)), /JSON/);
  assert.equal(assertLongRangeReceipt(await fs.readFile(REPORT)).status, 'passed-pre-catalog-calibration');
});
test('exact-digest receipt validates complete frozen structure without granting service authority', () => {
  const value = report(); assert.deepEqual(validate(value), value);
  for (const mutate of [r => { r.status = 'preparing'; }, r => { r.runtimeIdentity = 'f'.repeat(64); },
    r => { r.resourcePolicy = 'other'; }, r => { r.census.live = 1; }, r => { r.sources.pop(); }, r => { r.cases.pop(); },
    r => { r.sources[1].sha256 = r.sources[0].sha256; }, r => { r.sources[0].frozen.qualification.tolerances.videoTimestampUs++; },
    r => { r.sources[0].probe.streams[0].time_base = '1/30'; }, r => { r.cases[1].range.startUs--; },
    r => { r.cases[0].resources.budget.timeoutMs++; }, r => { r.cases[0].validation.valid = false; },
    r => { r.cases[2].pcmIdentity.outputHash = 'd'.repeat(64); }, r => { r.cases[0].completeSource.video.frames--; }]) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => validate(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
});
function binding(tick = 15360) {
  const source = probe(150, tick), sourceIdentity = { canonicalPath: path.resolve('/synthetic-long/input.mov'), dev: '1', ino: '2', size: '100000000',
    mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const request = resolveFileRequest({ fileId: 'independent', identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: { startUs: 121000000, endUs: 141000000 }, resolution: 'source', audioPolicy: 'precision-flac' } });
  const plan = buildEncodeOperation({ input: sourceIdentity.canonicalPath, output: path.resolve('/synthetic-long/output.mkv'), settings,
    inspection: { probe: source, color: classifyColor(source), duration: 150 }, request, runtimeIdentity: RUNTIME_ID });
  return { plan, settings, sourceIdentity, sourceProbeFingerprint: fingerprintEncodeSource(source), runtimeIdentity: RUNTIME_ID,
    environment: null, budget: null, executionBudgetMs: 120000 };
}
test('clock selector binds genuine plan source, not external claims or an exact fixture/range', () => {
  const frozen = report().sources[0].frozen;
  const selector = new ClockQualifiedFamilySelector({ policyIdentity: 'synthetic-clock-policy', families: [{ id: FAMILY_ID,
    runtimeIdentity: RUNTIME_ID, environment: null, settings, resourcePolicy: RESOURCE_POLICY, qualification: frozen.qualification,
    timingQualification: frozen.timingQualification, evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] }] });
  assert.ok(selector instanceof OperationFamilySelector);
  const valid = binding(), token = selector.select(valid);
  assert.equal(selector.requireCurrent(token, valid).proportional, true);
  const wrong = binding(30000);
  assert.throws(() => selector.select(wrong), /clocks/);
  assert.throws(() => selector.requireCurrent(token, wrong), /clocks/);
  assert.throws(() => selector.select({ ...wrong, sourceProbe: probe() }), /clocks/);
  assert.throws(() => selector.select({ ...valid, plan: structuredClone(valid.plan) }), { code: 'INVALID_ENCODE_OPERATION' });
  assert.throws(() => selector.requireCurrent(token, binding()), { code: 'OPERATION_QUALIFICATION_STALE' });
  assertQualifiedClocks(probe());
});
test('composition is not activated and has no caller receipt/runtime or fixture binding route', async () => {
  const source = await fs.readFile(path.join(__dirname, 'workbench-long-range-service.cjs'), 'utf8');
  assert.doesNotMatch(source, /CalibratedSourceSelector|process\.env|process\.argv|ipcMain/);
  for (const filename of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, filename), 'utf8')).includes('workbench-long-range-service'));
});
test('output metadata clocks are checked without replacing shared parser or child result', async () => {
  const { clockGuardedRunner } = require('./workbench-long-range-service.cjs');
  const { PINS } = require('./runtime-av1.cjs');
  const args = ['-show_streams', '-show_format'];
  const result = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ time_base: '1/1000' }, { time_base: '1/1000' }] }) };
  assert.equal(await clockGuardedRunner(async () => result)(PINS.ffprobe.path, args), result);
  const capability = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ codec_type: 'video', time_base: '1/1000' }] }) };
  assert.equal(await clockGuardedRunner(async () => capability)(PINS.ffprobe.path, args), capability);
  const empty = { exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [] }) };
  await assert.rejects(clockGuardedRunner(async () => empty)(PINS.ffprobe.path, args), /output requires/);
  const wrong = { ...result, stdout: result.stdout.replace('1/1000', '1/90000') };
  await assert.rejects(clockGuardedRunner(async () => wrong)(PINS.ffprobe.path, args), /output requires/);
  const absent = { ...result, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ time_base: '1/1000' }, {}] }) };
  await assert.rejects(clockGuardedRunner(async () => absent)(PINS.ffprobe.path, args), /output requires/);
  const options = { onOutputBytes() {}, signal: new AbortController().signal };
  await clockGuardedRunner(async (exe, argv, supplied) => { assert.equal(exe, PINS.ffprobe.path); assert.equal(argv, args); assert.equal(supplied, options); return result; })(PINS.ffprobe.path, args, options);
  const streamed = { exitCode: 0, stdout: '' };
  assert.equal(await clockGuardedRunner(async () => streamed)(PINS.ffprobe.path, args, { onStdoutChunk() {} }), streamed);
  const failed = { exitCode: 1, stdout: '' };
  assert.equal(await clockGuardedRunner(async () => failed)(PINS.ffprobe.path, args), failed);
  const input = { exitCode: 0, stdout: JSON.stringify(probe()) };
  assert.equal(await clockGuardedRunner(async () => input)(PINS.ffprobe.path, args), input);
});
