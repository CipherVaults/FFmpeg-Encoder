'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { VENDOR_PROFILES, VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { vendorDecodeBudget, declaredVendorFrames, vendorOutputCheck, requireVendorArgs } = require('../src/vendor-execution.cjs');
const { harness, settings, inspection, noPrivate, error, tick } = require('./vendor-s34-fixtures.cjs');

for (const profile of VENDOR_PROFILES) test(`${profile.id}: fake vendor job passes real twin validation and publishes`, async t => {
  const h = await harness(t, { settings: { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default } });
  const plan = await h.prepare(), result = await h.finish(plan);
  assert.equal(result.items[0].status, 'success', result.items[0].reason);
  assert.equal(result.items[0].outputDisposition.published, true); assert.equal(result.items[0].hardwareTier, 'untested');
  assert.equal(h.verifiedSettings().profileId, profile.twin); assert.equal(h.deviceReads(), 2);
  assert.equal(h.incidents.find(event => event.reason === 'ENCODE_STARTED').context.hardwareTier, 'untested');
  assert.equal((await fs.readdir(h.output)).length, 1); noPrivate(h.states);
  const decode = h.calls.find(call => call.args.includes('-xerror'));
  assert.equal(decode.options.timeoutMs, 120_000); assert.ok(decode.args.includes('-map'));
});

for (const [label, config, code] of [
  ['encode errno', { encode: () => { throw error('SPAWN_FAILED'); } }, 'VENDOR_ENCODE_FAILED'],
  ['decode error', { decode: () => { throw error('TOOL_FAILED'); } }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['nonzero decode result', { decodeExit: 1 }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['missing decoder progress=end', { decodeEnded: false }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['missing encoder progress=end', { encodeEnded: false }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['decoder count mismatch', { decodeCount: 59 }, 'VENDOR_FRAME_COUNT_MISMATCH'],
  ['bad encoder count', { encodeCount: 0 }, 'VENDOR_FRAME_COUNT_MISMATCH'],
  ['libx265 encoder tag', { encoderTag: 'libx265' }, 'VENDOR_ENCODER_TAG_MISMATCH'],
  ['header tag with trailing data', { encoderTag: 'hevc_amf PRIVATE X:\\private' }, 'VENDOR_ENCODER_TAG_MISMATCH'],
  ['dishonest nb_frames 100 versus 101', { inspection: (() => { const value = inspection(); value.probe.streams[0].nb_frames = '100'; return value; })(),
    encodeCount: 101, decodeCount: 101 }, 'VENDOR_FRAME_COUNT_MISMATCH'],
]) test(`${label} cannot publish and exposes only fixed failure text`, async t => {
  const h = await harness(t, config), plan = await h.prepare(), result = await h.finish(plan);
  assert.equal(result.items[0].status, 'failed'); assert.equal(result.items[0].reasonCode, code);
  assert.equal(result.items[0].reason, VENDOR_MESSAGES[code]); await h.unpublished(); noPrivate(h.states);
});

for (const when of ['spawn', 'publish']) for (const field of ['luid', 'vendorId', 'deviceId', 'umdVersion']) {
  test(`${field} changes before ${when}: refuse publication at the bound index`, async t => {
    const h = await harness(t, { adapters: ({ deviceReads, inventories }) => {
      const rows = structuredClone(inventories);
      if (when === 'spawn' || deviceReads === 2) rows[0][field] = {
        luid: '00000002:00000000', vendorId: 0x8086, deviceId: 0x9876, umdVersion: '32.0.1.1',
      }[field];
      return { status: 'complete', adapters: rows };
    } });
    const plan = await h.prepare(), result = await h.finish(plan);
    assert.equal(result.items[0].reasonCode, 'VENDOR_DEVICE_CHANGED'); await h.unpublished(); noPrivate(h.states);
    assert.equal(h.calls.filter(call => call.args.includes('-c:v:0')).length, when === 'spawn' ? 0 : 1);
  });
}
test('incomplete DXGI discovery fails closed before spawn', async t => {
  const h = await harness(t, { adapters: () => ({ status: 'partial', adapters: [] }) });
  const result = await h.finish(await h.prepare()); assert.equal(result.items[0].reasonCode, 'VENDOR_DEVICE_CHANGED');
  assert.equal(h.calls.length, 0); await h.unpublished();
});

test('argsHash tampering and removal of vendor guards are refused at Start before queue mutation', async t => {
  for (const mode of ['args', 'vendor']) {
    const h = await harness(t), plan = await h.prepare(), entry = h.service.plan.entries.get(plan.items[0].id);
    if (mode === 'args') entry.preparedArgs = [...entry.preparedArgs.slice(0, -1), 'tampered'];
    else delete entry.vendor;
    assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }), { code: 'INVALID_PLAN' });
    assert.equal(h.service.state.items[0].status, 'ready'); assert.equal(h.calls.length, 0); await h.unpublished();
  }
});

test('vendor decode budgets are explicit, scale with duration and cap at six hours', () => {
  assert.equal(vendorDecodeBudget(2), 120_000); assert.equal(vendorDecodeBudget(60), 180_000);
  assert.equal(vendorDecodeBudget(100_000), 21_600_000);
  for (const value of [null, '60', NaN, Infinity, 0, -1]) assert.throws(() => vendorDecodeBudget(value), { code: 'VENDOR_OUTPUT_DECODE_FAILED' });
  for (const value of ['bad', '0', 1.1, -1, '9007199254740992']) assert.throws(() => declaredVendorFrames({ nb_frames: value }), { code: 'VENDOR_FRAME_COUNT_MISMATCH' });
});

test('malformed prepared argv is INVALID_PLAN and an H264 ten-bit output refuses before decoding', async () => {
  assert.throws(() => requireVendorArgs({ preparedArgs: null, vendor: { argsHash: 'invalid' } }), { code: 'INVALID_PLAN' });
  let decoded = false;
  await assert.rejects(vendorOutputCheck({ vendor: { profileId: 'h264-amd', sourceFrameCount: null },
    outputProbe: { streams: [{ index: 0, codec_type: 'video', pix_fmt: 'yuv420p10le' }] },
    run: async () => { decoded = true; },
  }), { code: 'VENDOR_DEPTH_NOT_OFFERED' });
  assert.equal(decoded, false);
});

test('a vendor bookkeeping error keeps the published result and reports no errno or private path', async t => {
  const h = await harness(t), plan = await h.prepare();
  h.service.provenanceJournal.recordPublished = async () => { throw error('EACCES'); };
  const result = await h.finish(plan);
  assert.equal(result.items[0].status, 'success');
  assert.equal(h.service.state.items[0].reason, 'Output saved; provenance bookkeeping remains pending.');
  assert.equal(result.items[0].reason, h.service.state.items[0].reason); noPrivate(h.states);
  assert.match(JSON.stringify(h.incidents.find(event => event.reason === 'VENDOR_BOOKKEEPING_PENDING')), /PRIVATE/);
});

for (const mode of ['long', 'timeout', 'cancel']) test(`validation ${mode} owns the child through settlement`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered, release, closed = false;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await harness(t, { decode: async ({ options }) => {
    assert.equal(options.timeoutMs, 120_000);
    entered(); await new Promise(resolve => { release = resolve; });
    closed = true;
    if (options.signal.aborted) throw error('CANCELLED');
    options.onProgress({ frame: 60, ended: true }); return { exitCode: 0, stdout: '', stderr: '' };
  } });
  const plan = await h.prepare(); h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
  await started;
  let settled = false; h.service.taskPromise.then(() => { settled = true; });
  let cancel;
  if (mode === 'cancel') cancel = h.service.cancelCurrent();
  else t.mock.timers.tick(mode === 'long' ? 31_000 : 120_000);
  await tick(); assert.equal(settled, false); assert.equal(closed, false); assert.equal(h.service.busy, true);
  await h.unpublished(); release(); await h.service.taskPromise; await cancel;
  assert.equal(closed, true);
  const item = h.service.snapshot().items[0];
  assert.equal(item.status, mode === 'long' ? 'success' : mode === 'cancel' ? 'cancelled' : 'failed');
  if (mode === 'timeout') assert.equal(item.reasonCode, 'VENDOR_VALIDATION_TIMEOUT');
  if (mode !== 'long') await h.unpublished(); noPrivate(h.states);
});

test('vendor preparation and execution do not call native services, discovery or native file controls; policyCount remains zero', async t => {
  const { createNativeFileControls } = require('../src/native-file-controls.cjs');
  const { DEFAULT_NATIVE_FILE_POLICIES } = require('../src/native-file-runtime.cjs');
  let calls = 0;
  const forbidden = new Proxy({}, { get() { calls++; throw error('PRIVATE'); } });
  const h = await harness(t, { serviceOptions: { nativeBackends: forbidden } });
  const plan = await h.prepare();
  const { NativeBackendService } = require('../src/native-backend-service.cjs');
  const backends = new NativeBackendService({ discover: async () => { calls++; throw error('PRIVATE'); },
    createProbe: () => ({ initialize() { calls++; throw error('PRIVATE'); }, probe() { calls++; throw error('PRIVATE'); } }) });
  const controls = createNativeFileControls({ stateDir: h.service.stateDir, nativeBackends: backends,
    runtime: { ffmpeg: { file: path.join(h.root, 'ffmpeg.exe'), sizeBytes: 10, sha256: 'a'.repeat(64) },
      ffprobe: { file: path.join(h.root, 'ffprobe.exe'), sizeBytes: 10, sha256: 'b'.repeat(64) } } });
  h.service.nativeFiles = new Proxy(controls, { get() { calls++; throw error('PRIVATE'); } });
  h.service.discoverBackends = () => { calls++; throw error('PRIVATE'); };
  const result = await h.finish(plan);
  assert.equal(result.items[0].status, 'success'); assert.equal(calls, 0);
  assert.equal(DEFAULT_NATIVE_FILE_POLICIES.length, 0);
  assert.equal(controls.policyCount, 0);
  assert.equal(typeof createNativeFileControls, 'function');
});
