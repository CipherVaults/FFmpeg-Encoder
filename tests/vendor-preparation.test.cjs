'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, inspection, load, settings, inertBinding, adapter, noPrivate, error } = require('./vendor-s34-fixtures.cjs');
const { VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { vendorArgsHash } = require('../src/vendor-encode.cjs');

test('vendor preparation builds the twin plan and a private frozen vendor invocation', async t => {
  const h = await harness(t), plan = await h.prepare(), item = plan.items[0];
  assert.equal(item.status, 'ready'); assert.equal(item.hardwareTier, 'untested');
  const entry = h.service.plan.entries.get(item.id);
  assert.ok(entry.operationPlan.args.includes('libx265'));
  assert.equal(entry.vendor.profileId, settings.profileId); assert.ok(Object.isFrozen(entry.vendor));
  assert.equal(entry.vendor.sourceFrameCount, 60); assert.equal(entry.vendor.argsHash, vendorArgsHash(entry.preparedArgs));
  assert.equal(entry.generationDescription.version, 3); assert.equal(entry.generationDescription.kind, 'vendor-encoder');
  assert.ok(entry.preparedArgs.includes('hevc_amf')); assert.equal(h.deviceReads(), 0); assert.equal(h.calls.length, 0);
  noPrivate(plan); noPrivate(h.states);
});

for (const [label, config, code] of [
  ['HDR', () => { const value = inspection(); value.color = { ...value.color, supported: false, classification: 'hdr' }; return { inspection: value }; }, 'VENDOR_HDR_DEFERRED'],
  ['unsupported color', () => { const value = inspection(); value.color.supported = false; return { inspection: value }; }, 'UNSUPPORTED_COLOR'],
  ...[{ range: { startUs: 0, endUs: 1000000 } }, { resolution: '720' }, { audioPolicy: 'precision-flac' },
    { target: 'mp4' }, { hdrPolicy: 'hlg-base' }, { omissionRequestIds: ['fake'] }]
    .map(fileOverrides => [JSON.stringify(fileOverrides), () => ({ fileOverrides }), 'VENDOR_ROUTE_UNQUALIFIED']),
  ['unsupported depth', () => ({ unavailableDepth: 8 }), 'VENDOR_DEPTH_NOT_OFFERED'],
  ['H264 ten-bit', () => { const value = inspection(); value.probe.streams[0].pix_fmt = 'yuv420p10le'; return {
    inspection: value, settings: { profileId: 'h264-amd', preset: 'balanced', quality: 24 } }; }, 'VENDOR_DEPTH_NOT_OFFERED'],
  ...['yuv422p', 'yuvj420p', 'gray', 'yuv444p10le', 'nv12', 'p010le'].map(pixels => [pixels,
    () => { const value = inspection(); value.probe.streams[0].pix_fmt = pixels; return { inspection: value }; }, 'UNSUPPORTED_PIXEL_FORMAT']),
  ['missing binding', () => ({ bindings: map => map.delete('h265-amd:8') }), 'VENDOR_DEVICE_REQUIRED'],
  ['forged binding', () => ({ bindings: map => map.set('h265-amd:8', { ...map.get('h265-amd:8') }) }), 'VENDOR_DEVICE_INVALID'],
  ['binding mismatch', () => ({ bindings: map => map.set('h265-amd:8', inertBinding(adapter(1, 0x8086), 'Intel')) }), 'VENDOR_DEVICE_MISMATCH'],
]) test(`preparation refuses ${label} before any runtime observation or argv invocation`, async t => {
  let observed = 0;
  const h = await harness(t, { ...config(), serviceOptions: { operationRuntime: { observe() { observed++; throw error('PRIVATE'); } } } });
  const plan = await h.prepare();
  assert.equal(plan.items[0].status, 'unsupported'); assert.equal(plan.items[0].reasonCode, code);
  assert.equal(plan.items[0].reason, VENDOR_MESSAGES[code]); assert.equal(observed, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.service.plan.entries.size, 0); noPrivate(h.states);
});

test('a preservation selection cannot enter vendor preparation', async t => {
  const { EncoderService } = load('src/encoder-service.cjs', undefined, {
    './encode-preservation-workspace.cjs': { ...require('../src/encode-preservation-workspace.cjs'), prepareEncodePreservation: () => ({}) },
  });
  const h = await harness(t, { Service: EncoderService }), plan = await h.prepare();
  assert.equal(plan.items[0].reasonCode, 'VENDOR_ROUTE_UNQUALIFIED'); assert.equal(h.calls.length, 0);
});

test('a source needing an explicit preservation decision receives the vendor route refusal', async t => {
  const { EncoderService } = load('src/encoder-service.cjs', undefined, {
    './encode-preservation-workspace.cjs': { ...require('../src/encode-preservation-workspace.cjs'),
      prepareEncodePreservation: () => { throw error('ENCODE_PRESERVATION_DECISION_REQUIRED'); } },
  });
  const h = await harness(t, { Service: EncoderService }), plan = await h.prepare();
  assert.equal(plan.items[0].reasonCode, 'VENDOR_ROUTE_UNQUALIFIED'); assert.equal(h.calls.length, 0); noPrivate(h.states);
});

for (const profileId of ['h265-amf', 'h265-qsv', 'unknown', '__proto__']) test(`ordinary preparation refuses noncatalog id ${profileId}`, async t => {
  const h = await harness(t, { settings: { ...settings, profileId } });
  await assert.rejects(h.prepare(), { code: 'INVALID_SETTINGS' }); assert.equal(h.calls.length, 0);
});

test('absence of declared nb_frames does not run any source count or invent source-frame proof', async t => {
  const value = inspection(); delete value.probe.streams[0].nb_frames;
  const h = await harness(t, { inspection: value }), plan = await h.prepare();
  assert.equal(h.service.plan.entries.get(plan.items[0].id).vendor.sourceFrameCount, null);
  assert.equal(h.calls.length, 0);
});

test('catalog seams cover recipes, saved settings, resets and draft repreparation', async t => {
  const h = await harness(t);
  assert.equal(h.service.getRecipe(settings).encoder, 'hevc_amf');
  const saved = await h.service.saveSettings({ ...settings, quality: 20 });
  assert.deepEqual(saved.settingsByProfile['h265-amd'], { preset: 'balanced', quality: 20 });
  assert.equal((await h.service.resetProfile({ profileId: 'h265-amd' })).settingsByProfile['h265-amd'].quality, 24);
  const plan = await h.prepare();
  const next = await h.service.reprepareEncodingSettings({ planId: plan.planId, draftId: plan.operationDraft.id,
    revision: plan.operationDraft.revision, settings: { profileId: 'h265-intel', preset: 'medium', quality: 25 } });
  assert.equal(next.items[0].status, 'ready'); assert.match(next.items[0].outputName, /Intel/);
  assert.ok(h.service.getEncodingDetails({ planId: next.planId, fileId: next.items[0].id }).args.includes('hevc_qsv'));
});

test('inspection errno and paths remain private even before the vendor branch', async t => {
  const h = await harness(t, { inspectError: error('SPAWN_FAILED') }), plan = await h.prepare();
  assert.equal(plan.items[0].reason, VENDOR_MESSAGES.VENDOR_ENCODE_FAILED); noPrivate(h.states);
  assert.match(JSON.stringify(h.incidents), /PRIVATE/);
});
