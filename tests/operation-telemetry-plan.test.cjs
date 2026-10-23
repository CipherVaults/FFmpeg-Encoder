'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { buildEncodeOperation, withEncodeOperationTelemetry, resolveEncodeOperationInvocation,
  validateEncodeOperationTelemetry } = require('../src/encode-operation.cjs');
const { buildEncodeArgs, classifyColor, ARCHIVE_RECIPE } = require('../src/media.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { FORMATS, createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry,
  closeOperationTelemetry } = require('../src/operation-telemetry.cjs');

// These dummy files and deliberately small synthetic timelines exercise the
// production trust boundaries. They are not media or qualification evidence.
const RUNTIME = 'a'.repeat(64);
const DONE = Object.freeze({ childClosed: true, exitCode: 0, cancelled: false });
const MISMATCH = { code: 'OPERATION_TELEMETRY_MISMATCH' };
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const clone = value => structuredClone(value);
const packed = (n, d = 1) => ({ n: String(n), d: String(d) });

function source() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p',
    width: 1920, height: 1080, sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
    avg_frame_rate: '25/1', r_frame_rate: '25/1', time_base: '1/1000', start_pts: 0, start_time: '0',
    duration_ts: 4000, duration: '4', tags: { rotate: '0', title: 'Synthetic video' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', channels: 2,
    channel_layout: 'stereo', sample_rate: '48000', time_base: '1/48000', start_pts: 0, start_time: '0',
    duration_ts: 192000, duration: '4', tags: { language: 'eng' }, disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', start_time: '0', duration: '4', nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic unit fixture only' } },
  programs: [], stream_groups: [], chapters: [] };
}

function build(root, { ordinary = false, settings = SETTINGS, range = { startUs: 1000000, endUs: 1120000 } } = {}) {
  const probe = source();
  const options = { input: path.join(root, 'synthetic-input.mp4'), output: path.join(root, 'prepared-output.mkv'), settings,
    inspection: { probe, color: classifyColor(probe), duration: 4, evidence: {}, summary: {} }, runtimeIdentity: RUNTIME,
    request: resolveFileRequest({ fileId: 'synthetic-file', identityRevision: 1, draftRevision: 1, operation: 'encode',
      overrides: ordinary ? {} : { range } }) };
  return { options, original: buildEncodeOperation(options) };
}

async function fixture(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-telemetry-plan-unit-'));
  const handles = [];
  t.after(async () => {
    await Promise.all(handles.map(handle => closeOperationTelemetry(handle, { childClosed: true })));
    const resolved = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(parent) && path.basename(resolved).startsWith('ffmpeg-telemetry-plan-unit-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'synthetic-input.mp4'), 'Owned dummy bytes; not a media file.');
  const built = build(root, options);
  return { root, handles, ...built, plan: withEncodeOperationTelemetry(built.original), output: path.join(root, 'actual-output.mkv') };
}

async function reserve(f, overrides = {}) {
  const handle = await createOperationTelemetry({ stageDirectory: f.root, runtimeIdentity: f.plan.runtimeIdentity,
    planFingerprint: f.plan.planFingerprint, streams: f.plan.instrumentation.streams,
    maxBytes: 64 * 1024, maxRecords: 100, ...overrides });
  f.handles.push(handle); return handle;
}

function videoRows({ pts = [0, 40, 80], tb = '1/1000', unknown = false } = {}) {
  return pts.map((value, n) => ['ffet1', 'v', '0', '0', n, unknown ? '18446744073709551615' : n,
    tb, value, unknown ? '0/1' : '1/1000', unknown ? '9223372036854775807' : 1000 + n * 40].join('\t') + '\n').join('');
}

function audioRows({ samples = [1024, 1024, 1024, 1024, 1024, 640], shifts = [], tbScale = 1, unknown = false } = {}) {
  let offset = 0;
  return samples.map((count, n) => {
    const line = ['ffet1', 'a', '0', '1', n, unknown ? '18446744073709551615' : n,
      `1/${48000 * tbScale}`, (offset + (shifts[n] || 0)) * tbScale, unknown ? '0/1' : '1/48000',
      unknown ? '9223372036854775807' : 48000 + offset, offset, count].join('\t') + '\n';
    offset += count; return line;
  }).join('');
}

async function capture(f, { handle, video = videoRows(), audio = audioRows(), completion = DONE } = {}) {
  handle ||= await reserve(f);
  await assertTelemetryReady(handle);
  for (const stream of handle.streams) await fs.writeFile(stream.path, stream.kind === 'video' ? video : audio);
  const receipt = await collectOperationTelemetry(handle, { completion });
  return { handle, receipt };
}

function evidence(plan) {
  // Fixed independent source selection: three 25fps frames, and 5,760 audio
  // samples in [1,1.12). Do not derive expectations from parsed telemetry.
  return { status: 'completed', runtimeIdentity: plan.runtimeIdentity, planFingerprint: plan.planFingerprint,
    completeSource: { video: { frames: 100, firstTime: packed(0), endTime: packed(4) },
      audio: [{ inputIndex: 2, sampleCount: '192000', firstTime: packed(0), endTime: packed(4), gaps: 0 }] },
    encoderInputs: { video: { outputIndex: 0, records: '3',
      orderedPts: createHash('sha256').update('0/1\n1/25\n2/25\n').digest('hex'),
      scope: 'independent-selected-source-timestamps-minus-canonical-filter-origin' },
    audio: [{ inputIndex: 2, outputIndex: 1, sampleCount: '5760', firstTime: packed(0), endTime: packed(3, 25), selectedGaps: 0 }] } };
}

test('telemetry wrapping preserves ordinary CPU, NVIDIA and Archive argv exactly', async t => {
  for (const settings of [SETTINGS, { profileId: 'h265-nvidia', preset: 'p5', quality: 25 },
    { profileId: 'h265-nvidia', preset: 'p7', quality: 29, recipeId: ARCHIVE_RECIPE.id }]) {
    const f = await fixture(t, { ordinary: true, settings });
    assert.equal(f.plan, f.original);
    assert.equal(f.plan.compatibilityPath, true);
    assert.equal(f.plan.instrumentation, undefined);
    assert.deepEqual(f.plan.args, buildEncodeArgs({ input: f.options.input, output: f.options.output, settings,
      probe: f.options.inspection.probe, colorEvidence: f.options.inspection.color }));
    assert.equal(f.plan.args.some(arg => arg.startsWith('-stats_enc_pre')), false);
  }
});

test('changed plan owns immutable diagnostic slots and instrumentation changes its fingerprint once', async t => {
  const f = await fixture(t), originalArgs = [...f.original.args];
  assert.notEqual(f.plan, f.original);
  assert.notEqual(f.plan.planFingerprint, f.original.planFingerprint);
  assert.deepEqual(f.original.args, originalArgs);
  assert.equal(withEncodeOperationTelemetry(f.plan), f.plan);
  assert.deepEqual(f.plan.instrumentation.streams, [{ outputIndex: 0, kind: 'video' }, { outputIndex: 1, kind: 'audio', sampleRate: 48000 }]);
  for (const spec of f.plan.instrumentation.streams) {
    const slot = f.plan.args.indexOf(`-stats_enc_pre:${spec.outputIndex}`);
    assert.equal(f.plan.args[slot + 1], f.plan.instrumentation.placeholders[spec.outputIndex]);
    assert.equal(f.plan.args[slot + 2], `-stats_enc_pre_fmt:${spec.outputIndex}`);
    assert.equal(f.plan.args[slot + 3], FORMATS[spec.kind]);
  }
  assert.ok(Object.isFrozen(f.plan.args) && Object.isFrozen(f.plan.instrumentation.streams));
});

test('actual invocation changes only prepared diagnostic slots and the exact output slot', async t => {
  const f = await fixture(t), handle = await reserve(f);
  const actual = resolveEncodeOperationInvocation(f.plan, { output: f.output, telemetry: handle });
  const permitted = new Map([[f.plan.args.length - 1, f.output]]);
  for (let i = 0; i < handle.streams.length; i++) permitted.set(f.plan.args.indexOf(f.plan.instrumentation.placeholders[i]), handle.streams[i].path);
  for (let i = 0; i < actual.length; i++) assert.equal(actual[i], permitted.has(i) ? permitted.get(i) : f.plan.args[i], `argv index ${i}`);
  assert.equal(actual.length, f.plan.args.length);
  assert.ok(Object.isFrozen(actual));
  const { receipt } = await capture(f, { handle });
  assert.equal(validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)).valid, true);
  assert.equal(await fs.readFile(f.options.input, 'utf8'), 'Owned dummy bytes; not a media file.');
});

test('serialized plan or telemetry handle cannot bind an invocation', async t => {
  const f = await fixture(t), handle = await reserve(f);
  assert.throws(() => withEncodeOperationTelemetry(clone(f.plan)), { code: 'INVALID_ENCODE_OPERATION' });
  assert.throws(() => resolveEncodeOperationInvocation(clone(f.plan), { output: f.output, telemetry: handle }), { code: 'INVALID_ENCODE_OPERATION' });
  assert.throws(() => resolveEncodeOperationInvocation(f.plan, { output: f.output, telemetry: clone(handle) }), { code: 'TELEMETRY_INVALID' });
  for (const output of ['relative.mkv', `${f.output}\n`, `${f.output}\0`]) {
    assert.throws(() => resolveEncodeOperationInvocation(f.plan, { output, telemetry: handle }), { code: 'INVALID_ENCODE_OPERATION' });
  }
});

test('genuine reservations with wrong runtime, plan or encoded streams are refused', async t => {
  const f = await fixture(t);
  const otherPlan = withEncodeOperationTelemetry(build(f.root, { range: { startUs: 1040000, endUs: 1160000 } }).original);
  for (const overrides of [{ runtimeIdentity: 'b'.repeat(64) }, { planFingerprint: otherPlan.planFingerprint },
    { streams: [{ outputIndex: 0, kind: 'video' }] },
    { streams: [{ outputIndex: 0, kind: 'video' }, { outputIndex: 1, kind: 'audio', sampleRate: 44100 }] },
    { streams: [...f.plan.instrumentation.streams].reverse() }]) {
    const handle = await reserve(f, overrides);
    assert.throws(() => resolveEncodeOperationInvocation(f.plan, { output: f.output, telemetry: handle }), { code: 'TELEMETRY_INVALID' });
  }
});

test('closed or already collected reservations cannot be reused for another invocation', async t => {
  const f = await fixture(t), closed = await reserve(f);
  await closeOperationTelemetry(closed, { childClosed: true });
  assert.throws(() => resolveEncodeOperationInvocation(f.plan, { output: f.output, telemetry: closed }), { code: 'TELEMETRY_INVALID' });
  const { handle } = await capture(f);
  assert.throws(() => resolveEncodeOperationInvocation(f.plan, { output: f.output, telemetry: handle }), { code: 'TELEMETRY_INVALID' });
});

test('only original completed receipts validate; closing retains valid descriptive evidence', async t => {
  const f = await fixture(t), { handle, receipt } = await capture(f);
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, clone(receipt), evidence(f.plan)), { code: 'TELEMETRY_INVALID' });
  assert.throws(() => validateEncodeOperationTelemetry(clone(f.plan), receipt, evidence(f.plan)), { code: 'INVALID_ENCODE_OPERATION' });
  await closeOperationTelemetry(handle, { childClosed: true });
  const checked = validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan));
  assert.equal(checked.scope, 'encoder-input-count-and-timeline-only');
  assert.deepEqual(checked.doesNotEstablish, ['video-pixel-identity', 'lossless-audio-identity', 'last-video-frame-duration', 'output-or-publication-validity']);
  assert.equal(receipt.publicationAuthorized, false);
  assert.equal(await fs.readFile(handle.streams[0].path, 'utf8'), videoRows());
});

test('genuine receipts from another runtime or plan cannot validate against this plan', async t => {
  const f = await fixture(t);
  for (const overrides of [{ runtimeIdentity: 'b'.repeat(64) }, { planFingerprint: 'c'.repeat(64) }]) {
    const { receipt } = await capture(f, { handle: await reserve(f, overrides) });
    assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)), MISMATCH);
  }
});

test('rationally equivalent statistics match independent source timing without float tolerance', async t => {
  const f = await fixture(t), { receipt } = await capture(f, {
    video: videoRows({ pts: [0, 80, 160], tb: '1/2000' }), audio: audioRows({ tbScale: 2 }) });
  assert.equal(validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)).valid, true);
});

test('unavailable upstream lineage is disclosed and still needs independent source selection', async t => {
  const f = await fixture(t), { receipt } = await capture(f, { video: videoRows({ unknown: true }), audio: audioRows({ unknown: true }) });
  const checked = validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan));
  assert.deepEqual(checked.streams.map(stream => stream.unknownInputRecords), ['3', '6']);
  for (const stream of checked.streams) assert.equal(stream.correspondence,
    'upstream-input-lineage-unavailable; independently-matched-selected-source-clock-and-count');
  const wrong = evidence(f.plan); wrong.encoderInputs.video.orderedPts = '0'.repeat(64);
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, wrong), MISMATCH);
});

test('same frame count with changed interior PTS fails independent ordered timing comparison', async t => {
  const f = await fixture(t), { receipt } = await capture(f, { video: videoRows({ pts: [0, 41, 80] }) });
  assert.equal(receipt.streams[0].summary.records, '3');
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)), MISMATCH);
});

test('a valid telemetry prefix after child success is incomplete against independent frame membership', async t => {
  const f = await fixture(t), { receipt } = await capture(f, { video: videoRows({ pts: [0, 40] }) });
  assert.equal(receipt.streams[0].summary.records, '2');
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)), MISMATCH);
});

test('repeated or backwards video clocks remain failures even with genuine receipt brands', async t => {
  const f = await fixture(t);
  for (const pts of [[0, 40, 40], [0, 80, 40]]) {
    const { receipt } = await capture(f, { video: videoRows({ pts }) });
    assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, evidence(f.plan)), MISMATCH);
  }
});

test('audio selected gaps or interior clock gaps cannot hide behind matching counts and endpoints', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  const gap = evidence(f.plan); gap.encoderInputs.audio[0].selectedGaps = 1;
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, gap), MISMATCH);
  const shifted = await capture(f, { audio: audioRows({ shifts: [0, 1, 0, 0, 0, 0] }) });
  assert.equal(shifted.receipt.streams[1].summary.sampleCount, '5760');
  assert.deepEqual(shifted.receipt.streams[1].summary.last.endTime, { numerator: '3', denominator: '25' });
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, shifted.receipt, evidence(f.plan)), MISMATCH);
});

test('audio sample count, first clock and exclusive end must each match independent evidence', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  for (const mutate of [e => { e.encoderInputs.audio[0].sampleCount = '5759'; },
    e => { e.encoderInputs.audio[0].firstTime = packed(1, 48000); },
    e => { e.encoderInputs.audio[0].endTime = packed(5761, 48000); }]) {
    const independent = evidence(f.plan); mutate(independent);
    assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, independent), MISMATCH);
  }
  const longer = await capture(f, { audio: audioRows({ samples: [1024, 1024, 1024, 1024, 1024, 641] }) });
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, longer.receipt, evidence(f.plan)), MISMATCH);
});

test('missing or incomplete independent evidence fails with the typed telemetry mismatch', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  for (const mutate of [e => { e.status = 'running'; }, e => { e.runtimeIdentity = 'b'.repeat(64); },
    e => { e.planFingerprint = 'c'.repeat(64); }, e => { delete e.encoderInputs.video; }, e => { delete e.encoderInputs.audio; }]) {
    const independent = evidence(f.plan); mutate(independent);
    assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, independent), MISMATCH);
  }
});

test('independent selected video cannot be relabelled while its hash and count still match', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  const independent = evidence(f.plan); independent.encoderInputs.video.outputIndex = 1;
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, independent), MISMATCH);
});

test('independent selected audio cannot name another input while its output clock and count still match', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  const independent = evidence(f.plan); independent.encoderInputs.audio[0].inputIndex = 99;
  assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, independent), MISMATCH);
});

test('malformed independent rational endpoints cannot make cross multiplication vacuously succeed', async t => {
  const f = await fixture(t), { receipt } = await capture(f);
  for (const field of ['firstTime', 'endTime']) {
    const independent = evidence(f.plan); independent.encoderInputs.audio[0][field] = packed(0, 0);
    assert.throws(() => validateEncodeOperationTelemetry(f.plan, receipt, independent), MISMATCH);
  }
});

test('partial, empty or truncated statistics never produce a completed telemetry receipt', async t => {
  const f = await fixture(t);
  for (const completion of [{ ...DONE, childClosed: false }, { ...DONE, exitCode: 1 }, { ...DONE, cancelled: true }]) {
    await assert.rejects(capture(f, { completion }), { code: 'TELEMETRY_INCOMPLETE' });
  }
  await assert.rejects(capture(f, { video: videoRows().trimEnd() }), { code: 'TELEMETRY_INVALID' });
  await assert.rejects(capture(f, { video: '' }), { code: 'TELEMETRY_PATH' });
});
