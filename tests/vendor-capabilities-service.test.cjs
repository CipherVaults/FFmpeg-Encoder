'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { harness, api, error, noPrivate, load, filename, sha, adapter } = require('./vendor-capabilities-fixtures.cjs');

const ordinary = () => ({ profiles: PROFILES.map(row => ({ ...structuredClone(row), available: true,
  supportedBitDepths: [8, 10], reason: null, checks: [8, 10].map(bitDepth => ({ bitDepth, available: true, reason: null })) })),
  recipes: [], versions: { ffmpeg: 'ffmpeg version injected', ffprobe: 'ffprobe version injected' } });
async function serviceHarness(t, vendorCapabilities = null, extra = {}, config = {}) {
  const h = await harness(t, config);
  const Service = config.Service || EncoderService;
  const service = new Service({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir: h.stateDir,
    capabilities: async () => ordinary(), run: h.run, vendorCapabilities, ...extra });
  t.after(async () => { await service.closeDiagnostics(); });
  return { ...h, service };
}

test('null vendor hook preserves the complete pre-vendor result and cached response', async t => {
  const h = await serviceHarness(t);
  const result = await h.service.getCapabilities();
  assert.deepEqual(result, ordinary()); assert.equal(Object.hasOwn(result, 'vendorProfiles'), false);
  assert.deepEqual(await h.service.getCapabilities(), result); assert.equal(h.calls.length, 0);
});

test('vendor hook runs after native discovery and before capability-finished with only its own inputs', async t => {
  const order = [], registry = { PRIVATE: 'native registry' };
  const h = await serviceHarness(t, async options => {
    order.push('vendors'); assert.deepEqual(Object.keys(options).sort(), ['ffmpeg', 'ffprobe', 'stateDir', 'signal', 'run'].sort());
    return api.checkVendorCapabilities({ ...options, adapters: async () => ({ status: 'complete', adapters: [] }) });
  }, { discoverBackends: async () => { order.push('discovery'); return { registry, display: { status: 'complete' } }; } });
  const recordIncident = h.service.recordIncident.bind(h.service);
  h.service.recordIncident = async event => { if (event.reason === 'CAPABILITY_FINISHED') order.push('finished'); return recordIncident(event); };
  const result = await h.service.getCapabilities();
  assert.deepEqual(order, ['discovery', 'vendors', 'finished']);
  assert.deepEqual(result.profiles, ordinary().profiles); assert.equal(h.service.nativeCapabilities, registry);
  assert.equal(h.calls.length, 0); assert.equal(result.vendorProfiles.length, 6);
});

for (const kind of ['SPAWN_FAILED', 'crash', 'hang']) test(`vendor ${kind} is contained and the six ordinary rows stay deep-equal`, async t => {
  if (kind === 'hang') t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered, hung = false, closed = false;
  const started = new Promise(resolve => { entered = resolve; });
  const baseline = await serviceHarness(t), before = await baseline.service.getCapabilities();
  const h = await serviceHarness(t, options => api.checkVendorCapabilities({ ...options,
    adapters: async () => ({ status: 'complete', adapters: [adapter()] }) }), {}, { before: async ({ options }) => {
    const hanging = kind === 'hang' && !hung;
    if (hanging) {
      hung = true; entered();
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      closed = true;
    }
    throw error(kind === 'SPAWN_FAILED' ? kind : hanging ? 'CANCELLED' : 'TOOL_FAILED');
  } });
  const pending = h.service.getCapabilities();
  if (kind === 'hang') { await started; t.mock.timers.tick(20_000); }
  const result = await pending;
  assert.deepEqual(result.profiles, before.profiles); assert.deepEqual(result.recipes, before.recipes); assert.deepEqual(result.versions, before.versions);
  assert.ok(result.vendorProfiles.every(row => !row.available));
  assert.ok(result.vendorProfiles.filter(row => row.hardware === 'AMD').every(row => row.reasonCode === 'VENDOR_CHECK_FAILED'));
  if (kind === 'hang') assert.equal(closed, true);
  noPrivate(result.vendorProfiles); assert.equal(h.service.snapshot().phase, 'idle'); await h.clean();
});

test('a throwing vendor hook is contained, diagnostics retain private context and renderer records withhold it', async t => {
  const h = await serviceHarness(t, async () => { throw error('SPAWN_FAILED'); });
  const states = []; h.service.on('update', state => states.push(state));
  const result = await h.service.getCapabilities();
  assert.deepEqual(result.profiles, ordinary().profiles); noPrivate(result.vendorProfiles); noPrivate(states);
  const history = await h.service.getDiagnosticHistory({});
  const finished = history.events.find(event => event.reason === 'CAPABILITY_FINISHED');
  assert.ok(finished);
  const record = (await h.service.getDiagnosticRecord({ eventId: finished.id })).event;
  assert.equal(record.context.nativePrivate, '[main-only]');
  assert.equal(JSON.stringify(record).includes('PRIVATE stderr'), false);
});

test('renderer projection, cache and emitted states contain no binding, LUID, UMD, stderr or paths', async t => {
  const h = await serviceHarness(t, async options => {
    const actual = await api.checkVendorCapabilities({ ...options, adapters: async () => ({ status: 'complete', adapters: [adapter()] }) });
    for (const row of actual.profiles) {
      row.binding = 'PRIVATE'; row.stderr = 'PRIVATE'; row.path = 'X:\\private\\file'; row.umdVersion = 'PRIVATE';
      for (const check of row.checks) { check.binding = 'PRIVATE'; check.device = check.device && { ...check.device, luid: 'PRIVATE' }; }
    }
    return actual;
  });
  const states = []; h.service.on('update', state => states.push(state));
  const result = await h.service.getCapabilities();
  noPrivate(result.vendorProfiles); noPrivate(h.service.capabilityResult.vendorProfiles); noPrivate(states);
  const history = await h.service.getDiagnosticHistory({});
  const summary = history.events.find(event => event.reason === 'CAPABILITY_FINISHED');
  const record = (await h.service.getDiagnosticRecord({ eventId: summary.id })).event;
  const projected = { ...record, context: { ...record.context } }; delete projected.context.nativePrivate;
  noPrivate(projected.context.vendorProfiles);
  assert.equal(JSON.stringify(history).includes('00000001:'), false);
  assert.equal(JSON.stringify(history).includes('vendor-capability-'), false);
  await h.clean();
});

test('cancelled vendor checks are not cached and a retry observes vendors afresh', async t => {
  let entered, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const h = await serviceHarness(t, async ({ signal }) => {
    calls++;
    if (calls === 1) { entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw error('CANCELLED'); }
    return { profiles: api.failedVendorCapabilities(), bindings: new Map() };
  });
  const pending = h.service.getCapabilities(); await started;
  const cancelled = h.service.cancelCurrent();
  await assert.rejects(pending, { code: 'CAPABILITIES_FAILED' }); await cancelled;
  assert.equal(h.service.capabilityResult, null); assert.equal(h.service.snapshot().phase, 'cancelled');
  assert.equal((await h.service.getCapabilities()).vendorProfiles.length, 6); assert.equal(calls, 2);
});

test('vendor path does not call native backend/discovery/file modules or consume their registries', async t => {
  const blocked = /(?:native-(?:backend|file)|backend-discovery|backend-capabilities|native-capabilities)/;
  let touched = 0;
  const source = fs.readFileSync(filename, 'utf8');
  const dependencies = new Set();
  const isolated = load(source, new Proxy({}, { getOwnPropertyDescriptor(_target, name) {
    dependencies.add(name);
    if (blocked.test(name)) { touched++; throw new Error('Native dependency read'); }
  } }));
  const poison = new Proxy({}, { get() { touched++; throw new Error('Native state read'); } });
  const h = await serviceHarness(t, options => isolated.checkVendorCapabilities({ ...options,
    adapters: async () => ({ status: 'complete', adapters: [adapter()] }) }), { nativeBackends: poison });
  h.service.nativeCapabilities = poison;
  const result = await h.service.getCapabilities();
  assert.equal(result.vendorProfiles.filter(row => row.available).length, 3);
  assert.equal(touched, 0);
  assert.equal(require('../src/native-file-runtime.cjs').DEFAULT_NATIVE_FILE_POLICIES.length, 0);
  assert.ok(dependencies.size > 0);
});

test('main composition passes the check and otherwise keeps the native construction intact', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.match(main, /vendorCapabilities: checkVendorCapabilities/);
  assert.match(main, /const \{ checkVendorCapabilities \} = require\('\.\/src\/vendor-capabilities\.cjs'\)/);
});

const serviceFile = path.resolve(__dirname, '../src/encoder-service.cjs');
function loadService(source, onNativeCall) {
  const loaded = new Module(serviceFile, module);
  loaded.filename = serviceFile; loaded.paths = Module._nodeModulePaths(path.dirname(serviceFile));
  const original = loaded.require.bind(loaded);
  loaded.require = name => {
    const value = original(name);
    if (!onNativeCall || !/native-(?:file|backend)/.test(name)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, typeof member === 'function'
      ? (...args) => { onNativeCall(name, key); return member(...args); } : member]));
  };
  loaded._compile(source, serviceFile); return loaded.exports.EncoderService;
}

test('startup calls no native file or backend function even with a present vendor', async t => {
  const calls = [];
  const Service = loadService(fs.readFileSync(serviceFile, 'utf8'), (name, key) => calls.push([name, key]));
  const h = await serviceHarness(t, options => api.checkVendorCapabilities({ ...options,
    adapters: async () => ({ status: 'complete', adapters: [adapter()] }) }), {}, { Service });
  const result = await h.service.getCapabilities(); assert.equal(result.vendorProfiles[0].available, true);
  assert.deepEqual(calls, []);
});

async function bindingLifecycle(t, source) {
  // Instrument only the in-memory copy to observe a JavaScript private field.
  // Production never exposes the Map or a binding through its public methods.
  const Service = loadService(source.replaceAll('#vendorBindings', 'observedBindings'));
  let fail = false;
  const h = await serviceHarness(t, options => api.checkVendorCapabilities({ ...options,
    adapters: async () => ({ status: 'complete', adapters: [adapter()] }) }),
  { capabilities: async () => { if (fail) throw error('TOOL_FAILED'); return ordinary(); } }, { Service });
  const result = await h.service.getCapabilities();
  assert.equal(h.service.observedBindings.size, 5); assert.deepEqual(result, h.service.capabilityResult);
  for (const [key, value] of h.service.observedBindings) { assert.match(key, /:(8|10)$/); assert.ok(Object.isFrozen(value)); }
  fail = true; h.service.capabilityResult = null;
  await assert.rejects(h.service.getCapabilities(), { code: 'CAPABILITIES_FAILED' });
  assert.equal(h.service.capabilityResult, null); assert.equal(h.service.observedBindings.size, 0);
}
test('bindings are committed and cleared with the capability result', async t => bindingLifecycle(t, fs.readFileSync(serviceFile, 'utf8')));

const serviceMutations = [
  ['optional hook', 'if (this.vendorCapabilities)', 'if (true)', async (t, Service) => {
    const h = await serviceHarness(t, null, {}, { Service }); assert.deepEqual(await h.service.getCapabilities(), ordinary());
  }],
  ['error containment', 'capabilityResult.vendorProfiles = failedVendorCapabilities();', 'throw error;', async (t, Service) => {
    const h = await serviceHarness(t, async () => { throw error('SPAWN_FAILED'); }, {}, { Service });
    await assert.doesNotReject(async () => { const result = await h.service.getCapabilities(); assert.deepEqual(result.profiles, ordinary().profiles); });
  }],
  ['primitive failure handling', "error?.code === 'CANCELLED'", "error.code === 'CANCELLED'", async (t, Service) => {
    const h = await serviceHarness(t, async () => { throw null; }, {}, { Service });
    await assert.doesNotReject(async () => { assert.deepEqual((await h.service.getCapabilities()).profiles, ordinary().profiles); });
  }],
  ['cancellation propagation', "if (error?.code === 'CANCELLED') throw fail('CANCELLED', 'Vendor capability inspection cancelled.');", '', async (t, Service) => {
    const h = await serviceHarness(t, async () => { throw error('CANCELLED'); }, {}, { Service });
    await assert.rejects(h.service.getCapabilities(), { code: 'CAPABILITIES_FAILED' });
    assert.equal(h.service.snapshot().error, 'Vendor capability inspection cancelled.');
    assert.equal(h.service.capabilityResult, null);
  }],
  ['public projection', 'projectVendorCapabilities(vendors)', 'vendors.profiles', async (t, Service) => {
    const h = await serviceHarness(t, async () => ({ profiles: [{ id: 'h265-amd', binding: 'PRIVATE' }], bindings: new Map() }), {}, { Service });
    noPrivate((await h.service.getCapabilities()).vendorProfiles);
  }],
  ['private diagnostics', 'nativePrivate: vendorPrivate', 'vendorDetails: vendorPrivate', async (t, Service) => {
    const h = await serviceHarness(t, async () => { throw error('SPAWN_FAILED'); }, {}, { Service });
    await h.service.getCapabilities();
    const history = await h.service.getDiagnosticHistory({});
    const summary = history.events.find(event => event.reason === 'CAPABILITY_FINISHED');
    const record = (await h.service.getDiagnosticRecord({ eventId: summary.id })).event;
    assert.equal(JSON.stringify(record).includes('PRIVATE'), false);
  }],
];
for (const [name, needle, replacement, negative] of serviceMutations) test(`service guard removal: ${name} fails its own negative assertion without changing bytes`, async t => {
  const before = sha(serviceFile), source = fs.readFileSync(serviceFile, 'utf8');
  assert.ok(source.includes(needle));
  await negative(t, EncoderService);
  await assert.rejects(negative(t, loadService(source.replace(needle, replacement))), { code: 'ERR_ASSERTION' });
  assert.equal(sha(serviceFile), before);
});

for (const [name, needle] of [['binding commit', 'this.#vendorBindings = vendorBindings;'], ['binding cleanup', 'this.#vendorBindings.clear();']]) {
  test(`service lifecycle removal: ${name} fails its own assertion; hash preserved`, async t => {
    const before = sha(serviceFile), source = fs.readFileSync(serviceFile, 'utf8');
    await bindingLifecycle(t, source);
    await assert.rejects(bindingLifecycle(t, source.replace(needle, '')), { code: 'ERR_ASSERTION' });
    assert.equal(sha(serviceFile), before);
  });
}

for (const thrown of [null, undefined, 'PRIVATE primitive error']) test(`primitive vendor failure ${String(thrown)} is contained`, async t => {
  const h = await serviceHarness(t, async () => { throw thrown; });
  const result = await h.service.getCapabilities();
  assert.deepEqual(result.profiles, ordinary().profiles);
  assert.ok(result.vendorProfiles.every(row => !row.available && row.reasonCode === 'VENDOR_CHECK_FAILED'));
  noPrivate(result.vendorProfiles);
});

async function lateFailure(t, source) {
  const Service = loadService(source.replaceAll('#vendorBindings', 'observedBindings'));
  const h = await serviceHarness(t, async options => {
    const vendors = await api.checkVendorCapabilities({ ...options, adapters: async () => ({ status: 'complete', adapters: [adapter()] }) });
    Object.defineProperty(vendors, 'nativePrivate', { get() { throw error('PRIVATE_CONTEXT_FAILED'); } });
    return vendors;
  }, {}, { Service });
  const result = await h.service.getCapabilities();
  assert.ok(result.vendorProfiles.every(row => !row.available)); assert.equal(h.service.observedBindings.size, 0);
}
test('a late vendor result failure clears bindings; removing that cleanup fails its own test', async t => {
  const before = sha(serviceFile), source = fs.readFileSync(serviceFile, 'utf8').replaceAll('\r\n', '\n');
  const needle = 'vendorBindings = new Map();\n            capabilityResult.vendorProfiles = failedVendorCapabilities();';
  assert.ok(source.includes(needle));
  await lateFailure(t, source);
  await assert.rejects(lateFailure(t, source.replace(needle, 'capabilityResult.vendorProfiles = failedVendorCapabilities();')), { code: 'ERR_ASSERTION' });
  assert.equal(sha(serviceFile), before);
});

for (const throws of [false, true]) test(`cancellation ${throws ? 'with failure' : 'with success'} cannot emit a capability-finished record; guard removal is detected`, async t => {
  const before = sha(serviceFile), source = fs.readFileSync(serviceFile, 'utf8').replaceAll('\r\n', '\n');
  const needle = throws ? '} catch (error) {\n            notCancelled(signal);' : 'notCancelled(signal);\n            capabilityResult.vendorProfiles = projectVendorCapabilities(vendors);';
  assert.ok(source.includes(needle));
  const negative = async Service => {
    const events = [];
    const h = await serviceHarness(t, async () => {
      h.service.controller.abort();
      if (throws) throw error('TOOL_FAILED');
      return { profiles: api.failedVendorCapabilities(), bindings: new Map() };
    }, {}, { Service });
    const record = h.service.recordIncident.bind(h.service);
    h.service.recordIncident = event => { events.push(event.reason); return record(event); };
    await assert.rejects(h.service.getCapabilities(), { code: 'CAPABILITIES_FAILED' });
    assert.equal(events.includes('CAPABILITY_FINISHED'), false);
  };
  await negative(EncoderService);
  const replacement = throws ? '} catch (error) {' : 'capabilityResult.vendorProfiles = projectVendorCapabilities(vendors);';
  await assert.rejects(negative(loadService(source.replace(needle, replacement))), { code: 'ERR_ASSERTION' });
  assert.equal(sha(serviceFile), before);
});
