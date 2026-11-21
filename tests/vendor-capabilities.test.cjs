'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { buildEncodeArgs } = require('../src/media.cjs');
const { resolveCatalogSettings } = require('../src/encoder-catalog.cjs');
const { overlayVendorArgs, createVendorTwinCommand } = require('../src/vendor-encode.cjs');
const { queryWindowsAdapters } = require('../src/windows-adapters.cjs');
const { api, filename, sha, adapter, error, load, harness, encodeCalls, noPrivate } = require('./vendor-capabilities-fixtures.cjs');

test('no hardware adapter creates no fixtures or encodes; H.264 10-bit is never offered', async t => {
  const h = await harness(t, { inventory: { status: 'complete', adapters: [adapter(0, 0x10de), adapter(1, 0x1002, { flags: 2 })] } });
  const result = await h.check();
  assert.equal(h.queryCount(), 1); assert.equal(h.calls.length, 0);
  assert.equal(result.bindings.size, 0);
  assert.ok(result.profiles.every(row => !row.available && row.reasonCode === 'VENDOR_NO_ADAPTER'));
  assert.equal(result.profiles[0].checks[1].reasonCode, 'VENDOR_DEPTH_NOT_OFFERED');
  await h.clean();
});

for (const [label, config] of [
  ['query failure', { adapters: () => { throw error('SPAWN_FAILED'); } }],
  ['non-win32', { adapters: options => queryWindowsAdapters({ ...options, platform: 'linux' }) }],
  ['partial inventory', { inventory: { status: 'partial', adapters: [adapter()] } }],
  ['forged ordinal', { inventory: { status: 'complete', adapters: [adapter(64)] } }],
  ['bad LUID', { inventory: { status: 'complete', adapters: [adapter(0, 0x1002, { luid: 'injected' })] } }],
]) test(`${label} fails discovery closed without encodes`, async t => {
  const h = await harness(t, config), result = await h.check();
  assert.ok(result.profiles.every(row => row.reasonCode === 'VENDOR_DISCOVERY_INCOMPLETE' && !row.available));
  assert.equal(h.calls.length, 0); assert.equal(result.bindings.size, 0); await h.clean();
});

test('each passing profile/depth uses the production twin overlay and its own verified two-frame fixtures', async t => {
  const h = await harness(t), result = await h.check();
  assert.equal(result.bindings.size, 10); assert.equal(encodeCalls(h).length, 10);
  assert.equal(h.calls.filter(call => call.args.includes('lavfi')).length, 4);
  assert.equal(h.calls.filter(call => call.args.includes('-xerror')).length, 10);
  for (const profile of result.profiles) {
    assert.equal(profile.tier, 'untested');
    assert.deepEqual(profile.supportedBitDepths, profile.bitDepths);
    for (const bitDepth of profile.bitDepths) {
      const binding = result.bindings.get(`${profile.id}:${bitDepth}`);
      assert.ok(Object.isFrozen(binding)); assert.equal(binding.vendor, profile.hardware);
      const call = encodeCalls(h).find(call => path.basename(call.args.at(-1)).startsWith(`${profile.id}-${bitDepth}-`));
      const input = call.args[call.args.indexOf('-i') + 1];
      const { settings, twinSettings } = resolveCatalogSettings({ profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default });
      const catalogProfile = require('../src/vendor-profiles.cjs').VENDOR_PROFILES.find(row => row.id === profile.id);
      const cpu = { input, output: call.args.at(-1), settings: twinSettings, probe: { streams: [h.media.get(input)] } };
      const twinCommand = createVendorTwinCommand(cpu);
      assert.deepEqual(twinCommand.args, buildEncodeArgs(cpu));
      assert.deepEqual(call.args, overlayVendorArgs(twinCommand.args, { profile: catalogProfile, settings, twinSettings, bitDepth, binding, twinCommand }));
      assert.ok(h.calls.some(call2 => call2.args.includes('-count_frames') && call2.args.at(-1) === call.args.at(-1)));
    }
  }
  assert.equal(encodeCalls(h).some(call => /h264-(amd|intel)-10-/.test(call.args.at(-1))), false);
  noPrivate(result.profiles); await h.clean();
});

test('the second adapter is bound when the first fails, in DXGI order', async t => {
  const h = await harness(t, { inventory: { status: 'complete', adapters: [adapter(), adapter(1)] },
    before: ({ args }) => { if (args.includes('-c:v:0') && args.includes('d3d11va=ffenc_d3d:0')) throw error('TOOL_FAILED'); } });
  const result = await h.check();
  assert.equal(encodeCalls(h).length, 10);
  for (const binding of result.bindings.values()) assert.equal(binding.adapterIndex, 1);
  for (const row of result.profiles.filter(row => row.hardware === 'AMD')) {
    assert.ok(row.available); assert.deepEqual(row.disclosures, [{ code: 'VENDOR_MULTIPLE_ADAPTERS', message: VENDOR_MESSAGES.VENDOR_MULTIPLE_ADAPTERS }]);
  }
  await h.clean();
});

test('only four adapters per vendor are attempted, and software candidates are ignored', async t => {
  const h = await harness(t, { inventory: { status: 'complete', adapters: Array.from({ length: 6 }, (_, i) => adapter(i, 0x1002, { flags: i === 0 ? 2 : 0 })) },
    before: ({ args }) => { if (args.includes('-c:v:0')) throw error('TOOL_FAILED'); } });
  const result = await h.check();
  assert.equal(encodeCalls(h).length, 20); assert.equal(result.bindings.size, 0);
  assert.equal(encodeCalls(h).some(call => call.args.includes('d3d11va=ffenc_d3d:0') || call.args.includes('d3d11va=ffenc_d3d:5')), false);
  await h.clean();
});

for (const warning of ['[qsvenc @ 123] incompatible video params (5)', '[hevc_qsv @ 123] Partial acceleration',
  '[h264_qsv @ 123] incompatible video parameters']) {
  test(`known QSV diagnostic is a fixed disclosure: ${warning}`, async t => {
    const h = await harness(t, { after: ({ args, result }) => args.includes('-c:v:0') ? { ...result, stderr: warning } : result });
    const result = await h.check();
    assert.ok(result.profiles.every(row => row.available));
    assert.ok(result.profiles.filter(row => row.hardware === 'Intel').every(row => row.disclosures.some(item => item.code === 'VENDOR_PARAMS_ADJUSTED')));
    assert.ok(result.profiles.filter(row => row.hardware === 'AMD').every(row => row.disclosures.length === 0));
    noPrivate(result.profiles); await h.clean();
  });
}
test('unknown warning text is private and never becomes a renderer message', async t => {
  const h = await harness(t, { after: ({ args, result }) => args.includes('-c:v:0') ? { ...result, stderr: 'PRIVATE arbitrary warning X:\\private\\fixture.mkv' } : result });
  const result = await h.check();
  assert.ok(result.profiles.every(row => row.disclosures.length === 0));
  assert.match(JSON.stringify(result.nativePrivate), /PRIVATE/); noPrivate(result.profiles); await h.clean();
});

for (const [label, after] of [
  ['wrong frame count', ({ args, result }) => args.includes('null') ? { ...result, stdout: 'frame=1\nprogress=end\n' } : result],
  ['missing progress end', ({ args, result }) => args.includes('null') ? { ...result, stdout: 'frame=2\nprogress=continue\n' } : result],
  ['crash with misleading output', ({ args, result }) => args.includes('-c:v:0') ? { ...result, exitCode: 1 } : result],
  ['wrong encoded depth', ({ args, result }) => args.includes('-count_frames') && !args.at(-1).includes('input-')
    ? { ...result, stdout: result.stdout.replace(/yuv420p(10le)?/g, 'yuv444p') } : result],
  ['incomplete fixture', ({ args, result }) => args.includes('-count_frames') && args.at(-1).includes('input-')
    ? { ...result, stdout: result.stdout.replace('"nb_read_frames":"2"', '"nb_read_frames":"1"') } : result],
  ['invalid probe JSON', ({ args, result }) => args.includes('-show_streams') ? { ...result, stdout: 'PRIVATE not json' } : result],
]) test(`${label} refuses availability and removes fixtures`, async t => {
  const h = await harness(t, { after }), result = await h.check();
  assert.ok(result.profiles.every(row => !row.available)); assert.equal(result.bindings.size, 0);
  noPrivate(result.profiles); await h.clean();
});

test('invalid state path is refused before any child', async t => {
  const h = await harness(t, { stateDir: 'relative' });
  await assert.rejects(h.check(), { code: 'VENDOR_CHECK_FAILED' }); assert.equal(h.calls.length, 0); await h.clean();
});

test('cancellation waits for the active child to settle before removing fixtures', async t => {
  const controller = new AbortController(); let entered, closed = false, release;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await harness(t, { before: async ({ args, options }) => {
    if (!args.includes('-c:v:0')) return;
    entered();
    await new Promise(resolve => { options.signal.addEventListener('abort', () => { release = resolve; }, { once: true }); });
    closed = true; throw error('CANCELLED');
  } });
  const pending = h.check({ signal: controller.signal }); let settled = false;
  pending.catch(() => { settled = true; }); await started;
  controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(closed, false);
  assert.ok((await require('node:fs/promises').readdir(h.root)).some(name => name.startsWith('vendor-capability-')));
  release(); await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(closed, true); await h.clean();
});

test('already cancelled checks run neither discovery nor children', async t => {
  const h = await harness(t), controller = new AbortController(); controller.abort();
  await assert.rejects(h.check({ signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(h.queryCount(), 0); assert.equal(h.calls.length, 0);
});

test('a hung child is aborted at 20 seconds, awaited and cleaned up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered, released = false, hung = false;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await harness(t, { inventory: { status: 'complete', adapters: [adapter()] }, before: async ({ args, options }) => {
    if (!args.includes('lavfi')) return;
    if (hung) throw error('TOOL_FAILED');
    hung = true;
    entered();
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    released = true; throw error('CANCELLED');
  } });
  const pending = h.check(); await started;
  t.mock.timers.tick(20_000);
  const result = await pending;
  assert.equal(released, true); assert.ok(result.profiles.every(row => !row.available)); await h.clean();
});

test('each vendor has a separate 90-second budget and remaining cells do not spawn', async t => {
  let now = 0;
  const implementation = load(undefined, { 'node:perf_hooks': { performance: { now: () => now } } });
  const h = await harness(t, { implementation, before: ({ args }) => {
    if (args.includes('-c:v:0')) { now += 90_001; throw error('TIMEOUT'); }
  } });
  const result = await h.check();
  assert.equal(encodeCalls(h).length, 2);
  assert.ok(result.profiles.every(row => row.reasonCode === 'VENDOR_CHECK_BUDGET'));
  await h.clean();
});

test('budget remaining below 20 seconds bounds the next child and late successful exits fail closed', async t => {
  let now = 0, shortened = false;
  const implementation = load(undefined, { 'node:perf_hooks': { performance: { now: () => now } } });
  const h = await harness(t, { implementation, inventory: { status: 'complete', adapters: [adapter()] },
    after: ({ args, result, options }) => {
      if (args.includes('lavfi')) now = 75_000;
      else if (args.includes('-show_streams')) { assert.equal(options.timeoutMs, 15_000); shortened = true; now = 90_001; }
      return result;
    } });
  const result = await h.check(); assert.equal(shortened, true); assert.equal(encodeCalls(h).length, 0);
  assert.equal(result.profiles[0].reasonCode, 'VENDOR_CHECK_BUDGET'); await h.clean();
});

test('projection rebuilds fixed rows and refuses unsafe adapter display text', () => {
  const result = api.projectVendorCapabilities({ profiles: [{ id: 'h265-intel', binding: 'PRIVATE',
    checks: [{ bitDepth: 8, available: true, reason: 'PRIVATE', device: { description: 'Intel display adapter', luid: 'PRIVATE' },
      disclosures: [{ code: 'VENDOR_PARAMS_ADJUSTED', message: 'PRIVATE' }], stderr: 'PRIVATE' }] }] });
  noPrivate(result);
  assert.throws(() => api.projectVendorCapabilities({ profiles: [{ id: 'h265-intel', checks: [
    { bitDepth: 8, available: true, device: { description: 'unsafe\nPRIVATE' } }] }] }), { code: 'VENDOR_CHECK_FAILED' });
});

// Each guard is disabled in an isolated in-memory CommonJS module. The same
// assertion that accepts the production module must reject its mutant.
const mutations = [
  ['cleanup-failure', 'if (errors.length)', 'if (false)', async (t, _implementation, source) => {
    const realFs = require('node:fs/promises'); let failed = false;
    const implementation = load(source, { 'node:fs/promises': { ...realFs, unlink: async file => {
      await realFs.unlink(file); if (!failed) { failed = true; throw error('EACCES'); }
    } } });
    const h = await harness(t, { implementation });
    await assert.rejects(h.check(), { code: 'VENDOR_CHECK_FAILED' }); await h.clean();
  }],
  ['fixture-verification', "verifyVideo(probe, { bitDepth, codec: 'ffv1', countFrames: true }, inspected);", '', async (t, implementation) => {
    const h = await harness(t, { implementation, after: ({ args, result }) => args.includes('-count_frames') && args.at(-1).includes('input-')
      ? { ...result, stdout: result.stdout.replace('"nb_read_frames":"2"', '"nb_read_frames":"1"') } : result });
    assert.equal((await h.check()).profiles[0].available, false);
  }],
  ['cancellation', 'if (signal?.aborted) throw new ToolError', 'if (false) throw new ToolError', async (t, implementation) => {
    const h = await harness(t, { implementation }), controller = new AbortController(); controller.abort();
    await assert.rejects(h.check({ signal: controller.signal }), { code: 'CANCELLED' });
    assert.equal(h.queryCount(), 0);
  }],
  ['depth-not-offered', '!profile.bitDepths.includes(bitDepth)', 'false', async (t, implementation) => {
    const h = await harness(t, { implementation });
    assert.equal((await h.check()).profiles[0].checks[1].reasonCode, 'VENDOR_DEPTH_NOT_OFFERED');
  }],
  ['candidate-limit', 'matching.slice(0, 4)', 'matching.slice(0, 5)', async (t, implementation) => {
    const h = await harness(t, { implementation, inventory: { status: 'complete', adapters: Array.from({ length: 5 }, (_, i) => adapter(i)) },
      before: ({ args }) => { if (args.includes('-c:v:0')) throw error('TOOL_FAILED'); } });
    await h.check(); assert.equal(encodeCalls(h).length, 20);
  }],
  ['vendor-budget', 'remaining > 0', 'true', async (t, _implementation, source) => {
    let calls = 0;
    const implementation = load(source, { 'node:perf_hooks': { performance: { now: () => ++calls < 4 ? 0 : 90_001 } } });
    const h = await harness(t, { implementation, inventory: { status: 'complete', adapters: [adapter()] } });
    await h.check(); assert.equal(h.calls.length, 1);
  }],
  ['vendor-budget-after-child', 'performance.now() < deadline', 'true', async (t, _implementation, source) => {
    let calls = 0;
    const implementation = load(source, { 'node:perf_hooks': { performance: { now: () => ++calls === 3 ? 90_001 : 0 } } });
    const h = await harness(t, { implementation }); assert.equal((await h.check()).profiles[0].available, false);
  }],
  ['child-deadline', '!expired', 'true', async (t, implementation) => {
    let entered, hung = false;
    const started = new Promise(resolve => { entered = resolve; });
    const h = await harness(t, { implementation, before: async ({ args, options, media }) => {
      if (!args.includes('-c:v:0') || hung) return;
      hung = true; entered();
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      media.set(args.at(-1), { ...media.get(args[args.indexOf('-i') + 1]), codec_name: 'h264' });
      await require('node:fs/promises').writeFile(args.at(-1), 'closed fake child');
      return { stdout: 'frame=2\nprogress=end\n', stderr: '', exitCode: 0 };
    } });
    const pending = h.check(); await started; t.mock.timers.tick(20_000);
    assert.equal((await pending).profiles[0].available, false);
  }],
  ['complete-discovery', "observed?.status === 'complete'", 'true', async (t, implementation) => {
    const h = await harness(t, { implementation, inventory: { status: 'partial', adapters: [adapter()] } });
    const result = await h.check(); assert.equal(result.profiles[0].reasonCode, 'VENDOR_DISCOVERY_INCOMPLETE');
  }],
  ['state-directory', "typeof stateDir === 'string' && path.isAbsolute(stateDir) && !/[\\0\\r\\n]/.test(stateDir)", 'true', async (t, implementation) => {
    const h = await harness(t, { implementation, stateDir: 'relative' });
    await assert.rejects(h.check(), { code: 'VENDOR_CHECK_FAILED' });
  }],
  ['decoded-frames', 'counts.at(-1) === 2', 'true', async (t, implementation) => {
    const h = await harness(t, { implementation, after: ({ args, result }) => args.includes('null') ? { ...result, stdout: 'frame=1\nprogress=end\n' } : result });
    assert.equal((await h.check()).profiles[0].available, false);
  }],
  ['decode-ended', '/^progress=end\\s*$/m.test(decoded.stdout)', 'true', async (t, implementation) => {
    const h = await harness(t, { implementation, after: ({ args, result }) => args.includes('null') ? { ...result, stdout: 'frame=2\n' } : result });
    assert.equal((await h.check()).profiles[0].available, false);
  }],
  ['child-exit', 'result.exitCode === 0', 'true', async (t, implementation) => {
    const h = await harness(t, { implementation, after: ({ args, result }) => args.includes('-c:v:0') ? { ...result, exitCode: 1 } : result });
    assert.equal((await h.check()).profiles[0].available, false);
  }],
  ['display-description', "typeof description === 'string' && description.length <= 128\n        && !/[\\x00-\\x1f\\x7f]/.test(description)", 'true', async (_t, implementation) => {
    assert.throws(() => implementation.projectVendorCapabilities({ profiles: [{ id: 'h265-intel', checks: [
      { bitDepth: 8, available: true, device: { description: 'unsafe\nPRIVATE' } }] }] }), { code: 'VENDOR_CHECK_FAILED' });
  }],
];
for (const [name, needle, replacement, negative] of mutations) test(`guard removal: ${name} defeats its own negative test; source hash unchanged`, async t => {
  const before = sha(filename), source = fs.readFileSync(filename, 'utf8');
  assert.ok(source.includes(needle), 'mutation anchor');
  if (name === 'child-deadline') t.mock.timers.enable({ apis: ['setTimeout'] });
  await negative(t, api, source);
  const mutated = ['vendor-budget', 'vendor-budget-after-child', 'child-deadline'].includes(name)
    ? source.replace('if (!condition)', `if (name !== '${name}' && !condition)`) : source.replaceAll(needle, replacement);
  const overrides = name === 'state-directory' ? { 'node:fs/promises': { ...require('node:fs/promises'),
    mkdir: async () => { throw error('MUTANT_REACHED_FS'); } } } : {};
  const mutant = load(mutated, overrides);
  await assert.rejects(negative(t, mutant, mutated), { code: 'ERR_ASSERTION' });
  assert.equal(sha(filename), before);
});

test('every named startup guard has an in-memory removal check', () => {
  const guards = [...fs.readFileSync(filename, 'utf8').matchAll(/guard\('([^']+)'/g)].map(match => match[1]);
  const names = mutations.map(row => row[0]);
  for (const name of guards) assert.ok(names.includes(name), name);
});
