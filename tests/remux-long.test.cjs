'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeProbe } = require('../src/inspection.cjs');
const { deriveRemuxBudget, RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { createRemuxJsonSink, createLineSink, collectRemuxEvidence, getCollectedRemuxEvidence, compareRemuxTimelines } = require('../src/remux-evidence.cjs');
const { operationCostLimits, createRemuxProgressClock, requireRemuxOutputSpace } = require('../src/encoder-service.cjs');
const { EVIDENCE_BUDGET } = require('../src/operation-controls.cjs');
const { safeMovFileBytes } = require('../src/mov-representation.cjs');
const RUNTIME = 'b'.repeat(64), OUTPUT = '715e278f-1b7e-4d19-948d-a952b68c328e';
const MiB = 1024 ** 2, GiB = 1024 ** 3;
function probe(seconds = 10800, bytes = 40 * GiB) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', field_order: 'progressive',
    width: 1920, height: 1080, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', color_range: 'tv', color_space: 'bt709',
    color_primaries: 'bt709', color_transfer: 'bt709', time_base: '1/1000', duration: String(seconds),
    r_frame_rate: '30/1', avg_frame_rate: '30/1', disposition: { default: 1 }, tags: {} },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2,
    channel_layout: 'stereo', time_base: '1/48000', duration: String(seconds), disposition: { default: 1 }, tags: {} }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), size: String(bytes), nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0, tags: {} }, chapters: [], programs: [], stream_groups: [] };
}
test('genuine three-hour 40GiB remux selection derives budgets without a duration/size ceiling', () => {
  const p = probe(), identity = { canonicalPath: 'D:\\owned\\long.mp4', dev: '1', ino: '2', size: p.format.size,
    mtimeNs: '3', ctimeNs: '4', birthtimeNs: '5', sparseDigest: 'sha256-sparse-v1:' + 'a'.repeat(64) };
  const request = { fileId: 'long', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'matroska', range: null, omissionRequestIds: [] };
  const assessment = assessRemux({ request, probe: p, sourceFingerprint: fingerprintRemuxSourceIdentity(identity) });
  const owner = new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'long-test', policies: [{ id: 'p', inputFamily: 'isobmff',
    target: 'matroska', allowAncillary: false, runtimeIdentity: RUNTIME, evidenceIds: ['injected-only'] }] });
  const plan = owner.prepare({ assessment, sourceIdentity: identity, input: identity.canonicalPath, output: 'D:\\owned\\out.mkv', outputId: OUTPUT, request });
  const bindings = { plan, settings: null, environment: null, sourceIdentity: identity, sourceProbeFingerprint: plan.sourceProbeFingerprint,
    runtimeIdentity: RUNTIME, budget: EVIDENCE_BUDGET, executionBudgetMs: 600000 };
  const selected = owner.requireCurrent(owner.select(bindings), bindings), costs = deriveRemuxBudget(normalizeProbe(p), identity.size);
  assert.deepEqual(selected.budget, costs.budget); assert.equal(selected.sourcePolicy.maximumSourceBytes, null);
  assert.equal(selected.sourcePolicy.maximumDurationSeconds, null); assert.ok(selected.budget.maxPcmBytes > 3 * GiB);
  assert.ok(selected.resources.pipeBytes > 8 * GiB); assert.ok(selected.executionBudgetMs > 10800 * 1000);
  assert.equal(selected.resources.outputReserveBytes, Math.ceil(40 * GiB * 1.25) + 80 * MiB + costs.budget.maxRecords * 128);
  assert.ok(Object.isFrozen(selected.budget));
  assert.throws(() => owner.requireCurrent(owner.select(bindings), { ...bindings, budget: { ...EVIDENCE_BUDGET, maxRecords: 30000 } }), /current|budget/i);
});
test('proportional budgets reject missing clocks, unsafe addressing, malformed audio and evidence overflow', () => {
  const p = normalizeProbe(probe());
  for (const bytes of ['0', '-1', '1.5', '9007199254740992', 40 * GiB, '', '1e9']) assert.throws(() => deriveRemuxBudget(p, bytes));
  for (const duration of [undefined, '0', '-1', 'N/A']) { const bad = probe(); if (duration === undefined) delete bad.format.duration; else bad.format.duration = duration;
    assert.throws(() => deriveRemuxBudget(normalizeProbe(bad), '1')); }
  const bad = probe(); bad.streams[1].sample_rate = '0'; assert.throws(() => deriveRemuxBudget(normalizeProbe(bad), '1'), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  assert.throws(() => deriveRemuxBudget(normalizeProbe(probe(1e12)), '1'), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  const a = deriveRemuxBudget(normalizeProbe(probe(120)), '1000000'), b = deriveRemuxBudget(p, String(40 * GiB));
  for (const key of ['maxRecords', 'maxPcmBytes', 'maxSpoolBytes', 'timeoutMs', 'maxOutputBytes']) assert.ok(b.budget[key] > a.budget[key], key);
});
test('ordinary Full and range keep their old fixed costs and deadlines while only remux receives larger costs', () => {
  const long = deriveRemuxBudget(normalizeProbe(probe()), String(40 * GiB));
  const ordinary = operationCostLimits({ remux: false }, null);
  assert.equal(ordinary.executionBudgetMs, null); // ordinary Full has no changed-operation backstop
  const range = operationCostLimits({ remux: false }, { budget: EVIDENCE_BUDGET, executionBudgetMs: 600000, resources: long.resources });
  for (const value of [ordinary, range]) {
    assert.equal(value.pipeBytes, 256 * MiB); assert.equal(value.evidenceBytes, 256 * MiB);
    assert.equal(value.evidenceReserveBytes, 32 * MiB); assert.equal(value.maxChildren, 64); assert.equal(value.stallMs, null);
  }
  assert.equal(range.executionBudgetMs, 600000); assert.equal(EVIDENCE_BUDGET.timeoutMs, 120000);
  assert.equal(EVIDENCE_BUDGET.maxPcmBytes, 128 * MiB); assert.equal(EVIDENCE_BUDGET.maxSpoolBytes, 32 * MiB);
  const remux = operationCostLimits({ remux: true }, { remux: true, ...long });
  assert.equal(remux.executionBudgetMs, long.executionBudgetMs); assert.ok(remux.pipeBytes > range.pipeBytes);
  for (const q of [null, {}, { remux: true }]) assert.throws(() => operationCostLimits({ remux: true }, q), { code: 'REMUX_PROPORTIONAL_BUDGET' });
});
test('remux idle detection requires actual advancement and its proportional backstop cannot be renewed', () => {
  let now = 0; const clock = createRemuxProgressClock(120000, 1000000, () => now);
  clock.advance('copy', 1); now = 119999; assert.equal(clock.check(), null);
  clock.advance('copy', 1); clock.advance('copy', 0); now = 120000;
  assert.equal(clock.check().code, 'REMUX_STALLED');
  clock.advance('copy', 2); assert.equal(clock.check(), null);
  now = 239999; clock.advance('source-frames', 0); now = 359998; assert.equal(clock.check(), null);
  now = 1000000; clock.advance('output-seal', 999999); assert.equal(clock.check().code, 'REMUX_PROPORTIONAL_BUDGET');
  for (const args of [[0, 10], [-1, 10], [NaN, 10], [1, 0], [1, Infinity]]) assert.throws(() => createRemuxProgressClock(...args, () => 0));
});
test('output admission counts source growth, margin, same-volume evidence and exact free-space floor', () => {
  const value = { freeBytes: 25n * BigInt(GiB) + 300n, actualBytes: 100n, maxOutputBytes: 200, outputReserveBytes: 300, evidenceReserveBytes: 100 };
  assert.equal(requireRemuxOutputSpace(value), true);
  for (const change of [{ freeBytes: value.freeBytes - 1n }, { actualBytes: 201n }, { actualBytes: -1n }, { freeBytes: '99999999999999' },
    { outputReserveBytes: 199 }, { maxOutputBytes: Number.MAX_SAFE_INTEGER + 1 }, { evidenceReserveBytes: -1 }])
    assert.throws(() => requireRemuxOutputSpace({ ...value, ...change }), { code: 'REMUX_STORAGE' });
});
test('MOV admits more than 64GiB with exact addressing and refuses unsafe sizes', () => {
  assert.equal(safeMovFileBytes(100n * BigInt(GiB)), 100 * GiB);
  assert.equal(safeMovFileBytes(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const size of [0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 100 * GiB]) assert.throws(() => safeMovFileBytes(size), { code: 'MOV_REPRESENTATION_UNVERIFIED' });
});
async function parse(text, options = {}) {
  const seen = [], sink = createRemuxJsonSink('frames', { maxRecords: 2, maxRecordBytes: 1024, onRecord: row => seen.push(row), ...options });
  for (const byte of Buffer.from(text)) await sink.push(Buffer.from([byte]));
  const summary = await sink.finish(); return { seen, summary };
}
test('streaming JSON preserves split UTF-8, strings/escapes and exact outer structure', async () => {
  const rows = [{ text: 'Cairo القاهرة \\" {} []', nested: [{ a: 1 }] }, { index: 2 }];
  const result = await parse(JSON.stringify({ frames: rows })); assert.deepEqual(result.seen, rows); assert.equal(result.summary.count, 2);
  const headers = createRemuxJsonSink('streams', { maxRecords: 1, onRecord() {} });
  await headers.push(Buffer.from('{"programs":[],"streams":[{}],"stream_groups":[]}')); assert.equal((await headers.finish()).count, 1);
});
test('streaming JSON and line guards each reject malformed, truncated, extra or over-budget evidence', async () => {
  for (const text of ['{"frames":[{},{},{}]}', '{"frames":[{"x":"' + 'x'.repeat(1100) + '"}]}', '{"frames":[', '{"frames":[{},]}',
    '\uFEFF{"frames":[]}', '{"frames":[]}x', '{"frames":[],"frames":[]}', '{"frames":[],"programs":[]}', '{"fra mes":[]}', '{"frames":[1]}',
    '{"frames":[],}', '{"frames":[{"x":' + '['.repeat(70) + '0' + ']'.repeat(70) + '}]}']) await assert.rejects(parse(text));
  const sink = createRemuxJsonSink('frames', { maxRecords: 1, onRecord() {} }); await assert.rejects(sink.push(Buffer.from([0xff])));
  const lines = []; const line = createLineSink(value => lines.push(value), 5);
  await line.push(Buffer.from('ab')); await line.push(Buffer.from('c\r\nd\n')); await line.finish(); assert.deepEqual(lines, ['abc', 'd']);
  const tooLong = createLineSink(() => {}, 5); await assert.rejects(tooLong.push(Buffer.from('abcdef')), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  const partial = createLineSink(() => {}); await partial.push(Buffer.from('partial')); await assert.rejects(partial.finish());
});
test('two million synthetic native records retain only one record, independent of stream length', async t => {
  const count = 2000000; let seen = 0;
  const sink = createRemuxJsonSink('packets', { maxRecords: count, onRecord: row => { assert.equal(row.pts, seen++); } });
  await sink.push(Buffer.from('{"packets":[')); let maximumRss = process.memoryUsage().rss, baseline = maximumRss;
  for (let i = 0; i < count; i += 512) {
    const text = Array.from({ length: Math.min(512, count - i) }, (_, j) => (i + j ? ',' : '') + JSON.stringify({ pts: i + j, size: '6' })).join('');
    await sink.push(Buffer.from(text)); maximumRss = Math.max(maximumRss, process.memoryUsage().rss);
    if (i === 65536) baseline = process.memoryUsage().rss;
  }
  await sink.push(Buffer.from(']}')); const summary = await sink.finish();
  assert.equal(seen, count); assert.ok(summary.maximumRetainedBytes < 64);
  assert.ok(maximumRss - baseline < 128 * MiB, 'RSS growth must remain bounded across millions of records');
  t.diagnostic(JSON.stringify({ records: count, maximumRetainedRecordBytes: summary.maximumRetainedBytes, peakRssBytes: maximumRss, warmRssBytes: baseline }));
});
test('one million native video timestamps are compared in lockstep, including an interior single-tick change', async t => {
  const count = 1000003, q = { numerator: '1', denominator: '30' }, produced = { source: 0, output: 0 };
  let maximumAhead = 0, closed = 0, peakRss = process.memoryUsage().rss; const baselineRss = peakRss;
  async function* timeline(side) {
    try {
      for (let i = 0; i < count; i++) {
        produced[side]++; maximumAhead = Math.max(maximumAhead, Math.abs(produced.source - produced.output));
        if ((i & 4095) === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
        yield { pts: side === 'output' && i === 700003 ? { numerator: String(i * 1000 + 1), denominator: '30000' }
          : { numerator: String(i), denominator: '30' }, duration: q, step: q, units: 1 };
      }
    } finally { closed++; }
  }
  const result = await compareRemuxTimelines(count, count, timeline('source'), timeline('output'));
  assert.equal(result.comparedUnits, String(count)); assert.deepEqual(result.maxPtsError, { numerator: '1', denominator: '30000' });
  assert.deepEqual(result.maxDurationError, { numerator: '0', denominator: '1' }); assert.equal(closed, 2); assert.equal(maximumAhead, 1);
  t.diagnostic(JSON.stringify({ videoUnits: count, maximumAhead, peakRssBytes: peakRss, baselineRssBytes: baselineRss }));
  // RSS includes V8's retained heap reserve. The live algorithm holds one row
  // from each cursor (maximumAhead=1); use an absolute VM envelope rather than
  // treating normal cold-heap expansion as retained per-frame records.
  assert.ok(peakRss < 512 * MiB, `Timestamp comparison RSS ${peakRss} exceeds the fixed 512MiB VM envelope.`);
});
test('streaming sample comparison joins segmentation, detects extent changes and cancels with both iterators closed', async () => {
  const count = 1000000, step = { numerator: '1', denominator: '48000' }; let closed = 0;
  const controller = new AbortController();
  async function* samples(size, change = false, cancel = false) {
    try { for (let offset = 0; offset < count; offset += size) {
      if (cancel && offset > 10000) controller.abort(); const units = Math.min(size, count - offset);
      const q = change && offset === size ? { numerator: '1', denominator: '48001' } : step;
      yield { units, pts: { numerator: String(offset), denominator: '48000' }, step: q, duration: { numerator: String(units), denominator: '48000' } };
    } } finally { closed++; }
  }
  const valid = await compareRemuxTimelines(count, count, samples(1024), samples(333));
  assert.equal(valid.comparedUnits, String(count)); assert.equal(valid.maxPtsError.numerator, '0'); assert.equal(closed, 2);
  const changed = await compareRemuxTimelines(count, count, samples(1024), samples(333, true)); assert.notEqual(changed.maxDurationError.numerator, '0');
  await assert.rejects(compareRemuxTimelines(count, count, samples(1024), samples(333, false, true), { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(closed, 6);
  await assert.rejects(compareRemuxTimelines(count, count + 1, samples(1024), samples(333)), /remain present/);
  async function* short() { yield { units: 1, pts: { numerator: '0', denominator: '1' }, step, duration: step }; }
  await assert.rejects(compareRemuxTimelines(2, 2, short(), short()), /Incomplete per-unit/);
});
test('complete fake long-file acquisition spools and compares a million packets per side without whole-stream arrays', { timeout: 180000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-long-stream-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('remux-long-stream-')); await fs.rm(root, { recursive: true, force: true }); });
  const sourcePath = path.join(root, 'source'), outputPath = path.join(root, 'output'), stageDirectory = path.join(root, 'evidence');
  await fs.writeFile(sourcePath, 'owned fake source'); await fs.writeFile(outputPath, 'owned fake output'); await fs.mkdir(stageDirectory);
  const p = probe(); p.streams[0].width = p.streams[0].height = 2;
  const request = { fileId: 'fake', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'matroska', range: null, omissionRequestIds: [] };
  const assessment = assessRemux({ request, probe: p, sourceFingerprint: 'a'.repeat(64) });
  const out = structuredClone(p); out.format.format_name = 'matroska,webm';
  let pipeBytes = 0, packetUnits = 0, peakRss = process.memoryUsage().rss; const baselineRss = peakRss;
  const run = async (_file, args, options) => {
    let bytes = 0;
    const send = async value => { const data = Buffer.from(value); bytes += data.length; await options.onStdoutChunk(data); peakRss = Math.max(peakRss, process.memoryUsage().rss); };
    const index = Number(args[args.indexOf(args.includes('-select_streams') ? '-select_streams' : '-map') + 1].replace(/^0:/, ''));
    if (args.includes('-show_packets')) {
      await send('{"packets":['); const total = 1000001;
      for (let i = 0; i < total; i += 256) {
        await send(Array.from({ length: Math.min(256, total - i) }, (_, j) => (i + j ? ',' : '') + JSON.stringify({ stream_index: index,
          pts: i + j, duration: 1, size: '6', data_hash: 'SHA256:' + 'c'.repeat(64) })).join('')); packetUnits += Math.min(256, total - i);
      }
      await send(']}');
    } else if (args.includes('-show_frames')) await send(JSON.stringify({ frames: index === 0
      ? [0, 1000].map(pts => ({ media_type: 'video', stream_index: index, pts, duration: 1000, width: 2, height: 2, pix_fmt: 'yuv420p' }))
      : [{ media_type: 'audio', stream_index: index, pts: 0, nb_samples: 4 }] }));
    else if (args.includes('framehash')) await send('#hash: SHA256\n' + [0, 1].map(i => `0, ${i}, ${i}, 1, 6, ${'c'.repeat(64)}\n`).join(''));
    else { assert.ok(args.includes('pcm_f32le')); await send(Buffer.alloc(32)); }
    pipeBytes += bytes;
    return { exitCode: 0, stdout: '', stderr: '', stderrCapture: { totalBytes: 0, truncated: false }, stdoutCapture: { streamed: true, truncated: false, totalBytes: bytes } };
  };
  const receipt = await collectRemuxEvidence({ assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT, sourceProbe: p, outputProbe: out,
    sourcePath, outputPath, stageDirectory, ffmpeg: path.join(root, 'fake-ffmpeg'), ffprobe: path.join(root, 'fake-ffprobe'), run, budget: EVIDENCE_BUDGET });
  assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure)); assert.equal(packetUnits, 2000002); assert.ok(pipeBytes > 256 * MiB);
  assert.ok(peakRss - baselineRss < 128 * MiB, 'complete acquisition must not retain the packet arrays');
  const value = getCollectedRemuxEvidence(receipt, { assessment, runtimeIdentity: RUNTIME, outputId: OUTPUT });
  assert.equal(value.streams[0].timestamps.comparedUnits, '2'); assert.equal(value.streams[1].timestamps.comparedUnits, '4');
  assert.equal(receipt.comparisons[1].pcmWindows.firstMismatchByte, null);
  t.diagnostic(JSON.stringify({ packetUnits, pipeBytes, peakRssBytes: peakRss, baselineRssBytes: baselineRss, spoolBytes: receipt.spoolBytes }));
});
