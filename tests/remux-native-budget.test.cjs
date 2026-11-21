'use strict';
// Probe arithmetic and inert in-memory EBML only: no media files or tools.
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeProbe } = require('../src/inspection.cjs');
const { deriveRemuxBudget, deriveRemuxAssessmentBudget } = require('../src/remux-operation.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { admission } = require('../scripts/v07-remux-admission-audit.cjs');
const { walkMatroskaMetadata, ebmlLimits } = require('../src/remux-ebml-reader.cjs');
const { element, uint, matroskaFixture } = require('./helpers/matroska-fixture.cjs');
const { segmentParts } = require('./helpers/ebml-fixture.cjs');
function probe({ seconds = '817.408', nominal = '120/1', average = nominal, audio = true } = {}) {
  return { streams: [{ index: 0, id: '1', codec_type: 'video', codec_name: 'hevc', profile: 'Main',
    width: 1920, height: 1080, pix_fmt: 'yuv420p', time_base: '1/1000', r_frame_rate: nominal,
    avg_frame_rate: average, disposition: { default: 1 }, tags: {} },
  ...(audio ? [{ index: 1, id: '2', codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp',
    sample_rate: '48000', channels: 2, channel_layout: 'stereo', time_base: '1/1000', disposition: { default: 1 }, tags: {} }] : [])],
  format: { format_name: 'matroska,webm', duration: seconds, size: '64676193', nb_streams: audio ? 2 : 1,
    nb_programs: 0, nb_stream_groups: 0, tags: {} }, chapters: [], programs: [], stream_groups: [] };
}
const costs = (p, selected = null, pcm = selected) => deriveRemuxBudget(normalizeProbe(p), p.format.size, selected, pcm);
const request = { fileId: 'inert-budget', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'mp4', range: null, omissionRequestIds: [] };
function assessment(p, omit = false) {
  const base = assessRemux({ request, probe: p, sourceFingerprint: 'a'.repeat(64) });
  assert.equal(base.status, 'qualification-required');
  if (!omit) return base;
  const decision = { id: 'omit-audio', fileId: request.fileId, identityRevision: 0, draftRevision: 0,
    operation: 'remux', target: 'mp4', sourceFingerprint: 'a'.repeat(64), action: 'omit-stream', streamIndex: 1,
    streamFingerprint: base.expectedOutput.streams.find(s => s.inputIndex === 1).streamFingerprint };
  return assessRemux({ request: { ...request, omissionRequestIds: [decision.id] }, probe: p,
    sourceFingerprint: 'a'.repeat(64), resolveOmission: id => id === decision.id ? decision : null });
}
test('the saved 817.408-second 120fps A/V probe receives 183467 records rather than 134267', () => {
  const before = costs(probe({ nominal: '60/1' })), after = costs(probe());
  assert.equal(before.budget.maxRecords, 134267); assert.equal(after.budget.maxRecords, 183467);
  assert.deepEqual(ebmlLimits(after.budget.maxRecords), { elements: 2943664, headerBytes: 5936480, depth: 12 });
  assert.equal(after.budget.maxRecords * 256 + 8388608, 55356160);
  assert.equal(after.budget.timeoutMs, 4976000); assert.equal(after.budget.timeoutMs, before.budget.timeoutMs);
  assert.equal(after.executionBudgetMs, before.executionBudgetMs);
  assert.equal(after.budget.maxPcmBytes, before.budget.maxPcmBytes);
});
test('fractional rate accounting uses an exact ceiling and the greater positive nominal/average rate', () => {
  const fractional = probe({ nominal: '120000/1001', average: '60/1' }), expectedVideo = Number((820n * 120000n + 1000n) / 1001n) + 4096;
  const audio = Math.ceil(820 * 48000 / 512) + 4096;
  assert.equal(costs(fractional).budget.maxRecords, expectedVideo + audio);
  assert.deepEqual(costs(probe({ nominal: '60/1', average: '120000/1001' })), costs(fractional));
  assert.equal(costs(probe({ nominal: '120000/1001', average: '120/1' })).budget.maxRecords, 183467);
  assert.deepEqual(costs(probe({ nominal: '120/1', average: '240/2' })), costs(probe()));
});
test('30/60fps, sub-floor fractions and unknown/nonpositive rate hints preserve the prior floor', () => {
  const floor = costs(probe({ nominal: '60/1' }));
  for (const rate of ['30/1', '60000/1001', '0/0', '0/1', '1/0', 'N/A', '-1/1', '1.5/1', '', 120]) {
    const p = probe(); p.streams[0].r_frame_rate = rate; p.streams[0].avg_frame_rate = rate;
    assert.deepEqual(costs(p), floor, String(rate));
  }
  const noRates = probe(); delete noRates.streams[0].r_frame_rate; delete noRates.streams[0].avg_frame_rate;
  assert.deepEqual(costs(noRates), floor);
  assert.equal(costs(probe({ nominal: 'N/A', average: '120/1' })).budget.maxRecords, 183467);
});
test('all traversed video/audio streams count regardless of selection or stream ordering, while PCM stays selected', () => {
  const p = probe(); p.streams.push({ ...p.streams[0], index: 3, id: '3', r_frame_rate: '90/1', avg_frame_rate: '90/1' }); p.format.nb_streams++;
  const all = costs(p), omitted = costs(p, [0], [0]), reordered = structuredClone(p); reordered.streams.reverse();
  assert.equal(all.budget.maxRecords, 183467 + 820 * 90 + 4096);
  assert.equal(omitted.budget.maxRecords, all.budget.maxRecords);
  assert.equal(omitted.budget.maxPcmBytes, 128 * 1024 ** 2);
  assert.ok(all.budget.maxPcmBytes > omitted.budget.maxPcmBytes);
  assert.deepEqual(costs(reordered, [0], [0]), omitted);
  assert.ok(all.budget.maxSpoolBytes > omitted.budget.maxSpoolBytes);
});
test('assessment budgets fund all omitted native blocks in both methods, without spending omitted PCM', () => {
  const p = probe(), a = assessment(p, true); assert.deepEqual(a.expectedOutput.streams.map(s => s.inputIndex), [0]);
  const packet = deriveRemuxAssessmentBudget(a, p.format.size, 'packet-identity-v1');
  const native = deriveRemuxAssessmentBudget(a, p.format.size, 'complete-native-v1');
  assert.equal(packet.budget.maxRecords, 183467); assert.equal(native.budget.maxRecords, 183467);
  for (const value of [packet, native]) assert.equal(value.budget.maxPcmBytes, 128 * 1024 ** 2);
  assert.ok(costs(p).budget.maxPcmBytes > packet.budget.maxPcmBytes);
});
test('read-only generic admission forwards the derived 120fps budget unchanged to native observation', async () => {
  const p = probe(); let observed;
  const verdict = await admission('D:\\inert-not-opened.mkv', p, { assessRemux, deriveRemuxAssessmentBudget,
    observeNativeInventory: async options => { observed = options; } });
  assert.deepEqual(verdict, { status: 'accepted', family: 'matroska' });
  const expected = deriveRemuxAssessmentBudget(assessment(p), p.format.size, 'packet-identity-v1').budget;
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(observed[key], value, key);
  assert.equal(observed.maxRecords, 183467); assert.equal(observed.timeoutMs, 4976000);
});
test('unsafe exact rate and downstream resource arithmetic retain REMUX_PROPORTIONAL_BUDGET refusals', () => {
  costs(probe());
  for (const rate of ['9007199254740991/1', '9999999999999999999999999999999999999999/1', '1'.repeat(41) + '/1'])
    assert.throws(() => costs(probe({ nominal: rate })), { code: 'REMUX_PROPORTIONAL_BUDGET' });
  // A representable record count must still fit all unchanged byte/resource bounds.
  assert.throws(() => costs(probe({ nominal: '1000000000/1' })), { code: 'REMUX_PROPORTIONAL_BUDGET' });
});
function inertBlocks(count) {
  const p = probe({ seconds: '200', audio: false }), { prefix, parts } = segmentParts(matroskaFixture(p));
  const block = element(0xa3, Buffer.from([0x81, 0, 0, 128, 1]));
  const cluster = element(0x1f43b675, Buffer.concat([element(0xe7, uint(0)), ...Array(count).fill(block)]));
  return Buffer.concat([prefix, element(0x18538067, Buffer.concat([...parts.map(n => n.bytes), cluster]))]);
}
async function walk(bytes, maxRecords) {
  return walkMatroskaMetadata({ end: bytes.length, maxRecords, seekRecords: true, seenTypes: new Set(), stop() {},
    read: async (at, n) => { assert.ok(at >= 0 && n <= 65536 && at + n <= bytes.length); return bytes.subarray(at, at + n); },
    add(type, body, end, path, parent) { const node = { type, body, end, path, parent, children: [] }; parent?.children.push(node); return node; } });
}
test('24000 inert video block headers exceed the old cap and fit the proportional 200-second 120fps cap', async () => {
  const p = probe({ seconds: '200', audio: false }), bytes = inertBlocks(24000), budget = costs(p).budget;
  assert.equal(budget.maxRecords, 28336); assert.ok(bytes.length < 200000);
  await assert.rejects(walk(bytes, 20000), { code: 'REMUX_NATIVE_SEEK_BUDGET' });
  const result = await walk(bytes, budget.maxRecords); assert.equal(result.packets.length, 24000);
  assert.equal(result.packets[23999].ordinal, 24000); assert.equal(result.packets[23999].number, 24000);
});
test('the complete native record guard accepts exactly R and refuses R+1, irrespective of forecasts', async () => {
  const R = 7; assert.equal((await walk(inertBlocks(R), R)).packets.length, R);
  await assert.rejects(walk(inertBlocks(R + 1), R), { code: 'REMUX_NATIVE_SEEK_BUDGET' });
});
