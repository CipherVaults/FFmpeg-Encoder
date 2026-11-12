'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { harness, settings, inspection, error, load, sha, adapter, inertBinding, noPrivate } = require('./vendor-s34-fixtures.cjs');
const execution = require('../src/vendor-execution.cjs');
const provenance = require('../src/provenance.cjs');
const preferences = require('../src/vendor-preferences.cjs');
const { VENDOR_PROFILES, describeVendorRecipe, VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const file = 'src/vendor-execution.cjs';
const code = (api, name) => load(file, source => source.replace('if (!condition)', `if (name !== '${name}' && !condition)`));
const baseRequest = { operation: 'encode', target: 'matroska', resolution: 'source', range: null,
  audioPolicy: 'copy', hdrPolicy: 'preserve', omissionRequestIds: [] };
const profile = VENDOR_PROFILES.find(row => row.id === settings.profileId);
const description = () => ({ version: 3, kind: 'vendor-encoder', profileId: profile.id, codec: profile.codec,
  backend: profile.hardware, encoder: profile.encoder, preset: settings.preset, qualityMode: profile.quality.mode,
  quality: settings.quality, bitDepth: 8, encoderArgs: describeVendorRecipe(settings).args,
  appVersion: '0.7.0-alpha.1', createdAt: '2026-11-12T07:00:00.000Z' });
const prefRecord = () => ({ namespace: preferences.VENDOR_PREFERENCES_NAMESPACE, version: 1,
  settingsByProfile: { 'h265-amd': { preset: 'balanced', quality: 24 } } });

async function assertKilled(t, target, original, mutant, check) {
  const before = sha(target);
  await check(original);
  await assert.rejects(async () => check(mutant), { code: 'ERR_ASSERTION' });
  assert.equal(sha(target), before, 'the on-disk bytes were never mutated');
}
const negative = (invoke, expected) => async api => {
  await assert.rejects(async () => invoke(api), { code: expected });
};
const mutations = [
  ['sdr', negative(api => api.requireVendorRoute({ color: { supported: true, classification: 'hdr' } }, baseRequest), 'VENDOR_HDR_DEFERRED')],
  ['color', negative(api => api.requireVendorRoute({ color: { supported: false, classification: 'sdr' } }, baseRequest), 'UNSUPPORTED_COLOR')],
  ['route', negative(api => api.requireVendorRoute(inspection(), { ...baseRequest, resolution: '720' }), 'VENDOR_ROUTE_UNQUALIFIED')],
  ['declared-count', negative(api => api.declaredVendorFrames({ nb_frames: 'bad' }), 'VENDOR_FRAME_COUNT_MISMATCH')],
  ['args-hash', negative(api => api.requireVendorArgs({ preparedArgs: ['changed'], vendor: { argsHash: '0'.repeat(64) } }), 'INVALID_PLAN')],
  ['duration', negative(api => api.vendorDecodeBudget(-1), 'VENDOR_OUTPUT_DECODE_FAILED')],
  ...['device-discovery', 'device-identity'].map(name => [name, negative(api => api.requireVendorDevice(inertBinding(adapter()), {
    adapters: async () => ({ status: name === 'device-discovery' ? 'partial' : 'complete',
      adapters: [adapter(0, 0x1002, name === 'device-identity' ? { luid: '00000002:00000000' } : {})] }),
  }), 'VENDOR_DEVICE_CHANGED')]),
];
for (const [name, check] of mutations) test(`guard removal: ${name} loses its own negative assertion`, async t => {
  await assertKilled(t, file, execution, code(execution, name), check);
});

function outputOptions() {
  return { vendor: { profileId: profile.id, sourceFrameCount: null },
    outputProbe: { streams: [{ index: 0, codec_type: 'video', pix_fmt: 'yuv420p', tags: { ENCODER: 'Lavc63.1.101 hevc_amf' } }] },
    encoderProgress: { frame: 60, ended: true }, duration: 2, file: 'owned-stage.mkv', ffmpeg: 'injected',
    signal: new AbortController().signal, run: async (_binary, _args, options) => {
      options.onProgress({ frame: 60, ended: true }); return { exitCode: 0 };
    } };
}
for (const [name, prepare, expected] of [
  ['encoder-tag', options => { options.outputProbe.streams[0].tags.ENCODER = 'Lavc63.1.101 libx265'; }, 'VENDOR_ENCODER_TAG_MISMATCH'],
  ['encoder-end', options => { options.encoderProgress.ended = false; }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['encoder-count', options => { options.encoderProgress.frame = 1.5; }, 'VENDOR_FRAME_COUNT_MISMATCH'],
  ['decode-exit', options => { options.run = async (_b, _a, opts) => { opts.onProgress({ frame: 60, ended: true }); return { exitCode: 1 }; }; }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['decode-end', options => { options.run = async (_b, _a, opts) => { opts.onProgress({ frame: 60, ended: false }); return { exitCode: 0 }; }; }, 'VENDOR_OUTPUT_DECODE_FAILED'],
  ['decode-count', options => { options.run = async (_b, _a, opts) => { opts.onProgress({ frame: 59, ended: true }); return { exitCode: 0 }; }; }, 'VENDOR_FRAME_COUNT_MISMATCH'],
  ['source-count', options => { options.vendor.sourceFrameCount = 100; }, 'VENDOR_FRAME_COUNT_MISMATCH'],
  ['decode-budget', options => { options.run = async (_b, _a, opts) => {
    opts.onProgress({ frame: 60, ended: true }); options.tick(); return { exitCode: 0 };
  }; }, 'VENDOR_VALIDATION_TIMEOUT'],
]) test(`guard removal: ${name} loses its own output assertion`, async t => {
  if (name === 'decode-budget') t.mock.timers.enable({ apis: ['setTimeout'] });
  const check = async api => {
    const options = outputOptions(); let ran = false;
    options.tick = () => t.mock.timers.tick(120_000); prepare(options);
    const run = options.run; options.run = async (...args) => { ran = true; return run(...args); };
    await assert.rejects(api.vendorOutputCheck(options), { code: expected });
    if (name === 'encoder-count') assert.equal(ran, false, 'invalid encoder count must refuse before decoding');
  };
  await assertKilled(t, file, execution, code(execution, name), check);
});

for (const name of ['capability-depth', 'preparation-binding', 'description', 'preservation', 'compatibility', 'start-entry', 'encode-exit']) {
  test(`guard removal: service ${name} loses its own preparation/Start assertion`, async t => {
    const check = async api => {
      let built = 0;
      const encodeOperation = require('../src/encode-operation.cjs');
      const overrides = { './vendor-execution.cjs': api,
        './encode-operation.cjs': { ...encodeOperation, buildEncodeOperation: options => {
          built++; const result = encodeOperation.buildEncodeOperation(options);
          return name === 'compatibility' ? { ...result, compatibilityPath: false } : result;
        } },
        ...(name === 'description' ? { './provenance.cjs': { ...provenance, generationDescriptionOf: () => null } } : {}),
        ...(name === 'preservation' ? { './encode-preservation-workspace.cjs': {
          ...require('../src/encode-preservation-workspace.cjs'), prepareEncodePreservation: () => ({}) } } : {}),
      };
      const Service = load('src/encoder-service.cjs', undefined, overrides).EncoderService;
      const h = await harness(t, { Service,
        ...(name === 'capability-depth' ? { unavailableDepth: 8 } : {}),
        ...(name === 'preparation-binding' ? { bindings: map => map.delete('h265-amd:8') } : {}),
        ...(name === 'encode-exit' ? { encodeExit: 1 } : {}),
      });
      const plan = await h.prepare();
      if (name === 'start-entry') {
        delete h.service.plan.entries.get(plan.items[0].id).vendor;
        try { assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }), { code: 'INVALID_PLAN' }); }
        finally { await h.service.taskPromise; }
      } else if (name === 'encode-exit') {
        const result = await h.finish(plan); assert.equal(result.items[0].reasonCode, 'VENDOR_ENCODE_FAILED');
      } else {
        assert.equal(plan.items[0].status, 'unsupported');
        const expected = { 'capability-depth': 'VENDOR_DEPTH_NOT_OFFERED', 'preparation-binding': 'VENDOR_DEVICE_REQUIRED',
          description: 'INVALID_PLAN', preservation: 'VENDOR_ROUTE_UNQUALIFIED', compatibility: 'VENDOR_ROUTE_UNQUALIFIED' }[name];
        assert.equal(plan.items[0].reasonCode, expected);
        if (name === 'preparation-binding') assert.equal(built, 0, 'binding is required before creating argv');
      }
    };
    await assertKilled(t, 'src/encoder-service.cjs', execution, code(execution, name), check);
  });
}

const seams = [
  ['preservation refusal', source => source.replace("throw fail('VENDOR_ROUTE_UNQUALIFIED', VENDOR_MESSAGES.VENDOR_ROUTE_UNQUALIFIED);", 'throw error;'), async (t, Service) => {
    const h = await harness(t, { Service, serviceOptions: { encodePreservationOperations: {
      invalidate() {}, describe() { throw error('ENCODE_PRESERVATION_DECISION_REQUIRED'); },
    } } });
    const result = await h.prepare(); assert.equal(result.items[0].reasonCode, 'VENDOR_ROUTE_UNQUALIFIED');
  }],
  ['Start hash', source => source.replace('if (entry?.vendor) requireVendorArgs(entry);', ''), async (t, Service) => {
    const h = await harness(t, { Service }), plan = await h.prepare();
    h.service.plan.entries.get(plan.items[0].id).preparedArgs = ['changed'];
    try { assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }), { code: 'INVALID_PLAN' }); }
    finally { await h.service.taskPromise; }
  }],
  ['spawn hash', source => source.replace('            requireVendorArgs(entry);', ''), async (t, Service) => {
    const h = await harness(t, { Service }), plan = await h.prepare(), record = h.service.recordIncident;
    h.service.recordIncident = async event => {
      if (event.reason === 'ENCODE_STARTED') h.service.plan.entries.get(plan.items[0].id).preparedArgs = ['changed'];
      return record(event);
    };
    const result = await h.finish(plan); assert.equal(result.items[0].reasonCode, 'INVALID_PLAN'); assert.equal(h.calls.length, 0);
  }],
  ['spawn DXGI', source => source.replace('await requireVendorDevice(entry.vendor.binding, { signal: jobSignal, run: this.run, adapters: this.vendorAdapters });', ''), async (t, Service) => {
    const h = await harness(t, { Service, adapters: () => ({ status: 'unavailable', adapters: [] }) });
    const result = await h.finish(await h.prepare()); assert.equal(result.items[0].reasonCode, 'VENDOR_DEVICE_CHANGED'); assert.equal(h.calls.length, 0);
  }],
  ['publish DXGI', source => source.replace('if (entry.vendor) await requireVendorDevice(entry.vendor.binding, { signal: jobSignal, run: this.run, adapters: this.vendorAdapters });', ''), async (t, Service) => {
    const h = await harness(t, { Service, adapters: ({ deviceReads, inventories }) => ({ status: deviceReads === 2 ? 'partial' : 'complete', adapters: inventories }) });
    const result = await h.finish(await h.prepare()); assert.equal(result.items[0].reasonCode, 'VENDOR_DEVICE_CHANGED'); await h.unpublished();
  }],
  ['output check', source => source.replace('if (entry.vendor) await vendorOutputCheck', 'if (false) await vendorOutputCheck'), async (t, Service) => {
    const h = await harness(t, { Service, encoderTag: 'libx265' });
    const result = await h.finish(await h.prepare()); assert.equal(result.items[0].reasonCode, 'VENDOR_ENCODER_TAG_MISMATCH'); await h.unpublished();
  }],
  ['twin verifier', source => source.replace('entry.vendor ? entry.vendor.twinSettings : this.plan.settings', 'this.plan.settings'), async (t, Service) => {
    const h = await harness(t, { Service }), result = await h.finish(await h.prepare()); assert.equal(result.items[0].status, 'success');
  }],
  ['private state projection', source => source.replace('this.state.items.map(vendorPublicItem)', 'this.state.items'), async (t, Service) => {
    const h = await harness(t, { Service }); await h.finish(await h.prepare()); noPrivate(h.states);
  }],
  ['fixed failure text', source => source.replace('const vendorFailure = entry.vendor ? vendorRefusal(error) : null;', 'const vendorFailure = null;'), async (t, Service) => {
    const h = await harness(t, { Service, encode: () => { throw error('SPAWN_FAILED'); } });
    await h.finish(await h.prepare()); noPrivate(h.states); assert.equal(h.service.state.items[0].reason, VENDOR_MESSAGES.VENDOR_ENCODE_FAILED);
  }],
];
for (const [name, transform, scenario] of seams) test(`guard removal: ${name} service seam`, async t => {
  const original = require('../src/encoder-service.cjs').EncoderService;
  const mutant = load('src/encoder-service.cjs', source => { const changed = transform(source); assert.notEqual(changed, source); return changed; }).EncoderService;
  await assertKilled(t, 'src/encoder-service.cjs', original, mutant, Service => scenario(t, Service));
});

for (const [name, transform, make] of [
  ['data', source => source.replace('if (!vendorDescriptionData(value)) return null;', ''), () => {
    let reads = 0; const value = description(); Object.defineProperty(value, 'encoder', { enumerable: true, get() { reads++; return 'hevc_amf'; } });
    return { value, reads: () => reads };
  }],
  ['shape', source => source.replace("if (!exactKeys(value, keys) || value.version !== 3 || value.kind !== 'vendor-encoder'\n        || Buffer.byteLength(JSON.stringify(value)) > 4096) return null;", ''), () => ({ value: { ...description(), kind: 'native-encoder' } })],
  ['scalar bounds', source => source.replace(/    if \(typeof value\.appVersion[\s\S]*?return null;\n    const \{ VENDOR_PROFILES/, '    const { VENDOR_PROFILES'), () => ({ value: { ...description(), appVersion: '\nPRIVATE' } })],
  ['catalog', source => source.replace(/    if \(!profile\.bitDepths\.includes\(value\.bitDepth\)[\s\S]*?return null;/, ''), () => ({ value: { ...description(), encoder: 'libx265' } })],
]) test(`guard removal: v3 ${name}`, async t => {
  const mutant = load('src/provenance.cjs', source => { const changed = transform(source.replaceAll('\r\n', '\n')); assert.notEqual(changed, source.replaceAll('\r\n', '\n')); return changed; });
  await assertKilled(t, 'src/provenance.cjs', provenance, mutant, async api => {
    const { value, reads } = make(); assert.equal(api.generationDescriptionV3(value), null); if (reads) assert.equal(reads(), 0);
  });
});

for (const [name, transform, make] of [
  ['schema', source => source.replace(/  if \(!dataRecord\(record,[\s\S]*?throw new Error\('Unrecognized vendor preference schema\.'\);/, ''), () => ({ ...prefRecord(), version: 99 })],
  ['map data', source => source.replace(/  if \(types\.isProxy\(values\)[^\n]+/, ''), () => { const record = prefRecord(); record.settingsByProfile[Symbol('private')] = 1; return record; }],
  ['tuple data', source => source.replace(/    if \(!dataRecord\(value,[^\n]+/, ''), () => { const record = prefRecord(); record.settingsByProfile['h265-amd'].mode = 'cqp'; return record; }],
]) test(`guard removal: vendor preferences ${name}`, async t => {
  const mutant = load('src/vendor-preferences.cjs', source => { const changed = transform(source); assert.notEqual(changed, source); return changed; });
  await assertKilled(t, 'src/vendor-preferences.cjs', preferences, mutant, async api => {
    assert.throws(() => api.decodeVendorPreferences(make()));
  });
});

test('guard removal: vendor preference constructor directory', async t => {
  const mutant = load('src/vendor-preferences.cjs', source => source.replace(/    if \(typeof directory !== 'string'[^\n]+/, ''));
  await assertKilled(t, 'src/vendor-preferences.cjs', preferences, mutant, async api => {
    assert.throws(() => new api.VendorPreferences({ directory: 'relative' }), TypeError);
  });
});

for (const name of ['namespace', 'named-file', 'opened-file', 'stable-read', 'write-size', 'forget-file']) {
  test(`guard removal: vendor preference storage ${name}`, async t => {
    const sourceTransforms = {
      namespace: source => source.replace(/    if \(!stat\.isDirectory\(\)[^\n]+/, ''),
      'named-file': source => source.replace(/    if \(!before\.isFile\(\)[^\n]+/, ''),
      'opened-file': source => source.replace(/      if \(!opened\.isFile\(\)[\s\S]*?throw new Error\('Vendor preference file changed\.'\);/, ''),
      'stable-read': source => source.replace(/      if \(length !== opened\.size[\s\S]*?throw new Error\('Vendor preference file changed during reading\.'\);\s*\}/, ''),
      'write-size': source => source.replace(/    if \(Buffer\.byteLength\(serialized\)[^\n]+/, ''),
      'forget-file': source => source.replace(/        if \(!stat\.isFile\(\)[^\n]+/, ''),
    };
    const scenario = async transform => {
      const h = await harness(t); let filePath, directoryPath, statCount = 0;
      const fakeFs = { ...fs, lstat: async pathname => {
        const stat = await fs.lstat(pathname);
        if (pathname === directoryPath && name === 'namespace') stat.isDirectory = () => false;
        if (pathname === filePath && ['named-file', 'forget-file'].includes(name)) stat.nlink = 2;
        return stat;
      }, open: async (...args) => {
        const handle = await fs.open(...args);
        if (args[0] !== filePath || args[1] !== 'r') return handle;
        return { close: handle.close.bind(handle), read: handle.read.bind(handle), stat: async () => {
          const stat = await handle.stat(); statCount++;
          if (name === 'opened-file') stat.nlink = 2;
          if (name === 'stable-read' && statCount % 2 === 0) stat.mtimeMs++;
          return stat;
        } };
      } };
      const api = load('src/vendor-preferences.cjs', source => {
        if (name === 'write-size') source = source.replace('const MAX_BYTES = 256 * 1024;', 'const MAX_BYTES = 1;');
        return transform(source);
      }, { 'node:fs/promises': fakeFs });
      const store = new api.VendorPreferences({ directory: h.root }); filePath = store.filename; directoryPath = store.directory;
      if (name === 'write-size') {
        await store.saveSettings(settings); await assert.rejects(fs.stat(store.filename), { code: 'ENOENT' });
      } else {
        await fs.mkdir(store.directory); await fs.writeFile(store.filename, JSON.stringify(prefRecord()));
        if (name === 'forget-file') await assert.rejects(store.forget(), /ordinary file/);
        else assert.ok((await store.load()).notices.length, 'unsafe storage must be refused');
      }
    };
    const before = sha('src/vendor-preferences.cjs');
    await scenario(source => source);
    await assert.rejects(scenario(source => { const changed = sourceTransforms[name](source); assert.notEqual(changed, source); return changed; }), { code: 'ERR_ASSERTION' });
    assert.equal(sha('src/vendor-preferences.cjs'), before);
  });
}
