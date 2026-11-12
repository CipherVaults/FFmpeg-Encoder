'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { VENDOR_PROFILES } = require('../src/vendor-profiles.cjs');
const { createVendorBinding } = require('../src/vendor-encode.cjs');
const { validateOutput } = require('../src/inspection.cjs');
const { adapter } = require('./vendor-capabilities-fixtures.cjs');

const settings = { profileId: 'h265-amd', preset: 'balanced', quality: 24 };
const error = (code, message = 'EACCES PRIVATE X:\\private\\fixture.mkv') => Object.assign(new Error(message), { code, stderr: message });
const tick = () => new Promise(resolve => setImmediate(resolve));
const sha = file => createHash('sha256').update(syncFs.readFileSync(file)).digest('hex');
function load(file, transform = value => value, overrides = {}) {
  const filename = path.resolve(__dirname, '..', file), loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(overrides, name) ? overrides[name] : realRequire(name);
  loaded._compile(transform(syncFs.readFileSync(filename, 'utf8')), filename);
  return loaded.exports;
}
const inertBinding = (row, vendor = 'AMD') => createVendorBinding({ vendor,
  ...Object.fromEntries(['adapterIndex', 'description', 'luid', 'umdVersion', 'vendorId', 'deviceId'].map(key => [key, row[key]])) });
function inspection() {
  return { probe: { format: { format_name: 'matroska,webm', duration: '2' }, streams: [{
    index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
    avg_frame_rate: '30/1', r_frame_rate: '30/1', nb_frames: '60', duration: '2', disposition: { default: 1 },
  }] }, color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] },
  duration: 2, summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } };
}
async function harness(t, config = {}) {
  const parent = path.resolve(__dirname, '../artifacts/vendor-s34-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-')), input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(input); await fs.mkdir(output); await fs.writeFile(path.join(input, 'source.mp4'), 'Owned vendor source bytes');
  t.after(async () => {
    const actual = await fs.realpath(root);
    assert.ok(actual.startsWith((await fs.realpath(parent)) + path.sep) && path.basename(actual).startsWith('run-'));
    await fs.rm(actual, { recursive: true });
  });
  const source = config.inspection || inspection(), calls = [], incidents = [], states = [];
  const inventories = [adapter(), adapter(1, 0x8086)];
  const bindings = new Map(VENDOR_PROFILES.flatMap(profile => profile.bitDepths.map(depth => [
    `${profile.id}:${depth}`, inertBinding(inventories[profile.hardware === 'AMD' ? 0 : 1], profile.hardware),
  ])));
  config.bindings?.(bindings);
  let deviceReads = 0, verifiedSettings;
  const run = async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args.includes('-xerror')) {
      const override = await config.decode?.({ binary, args, options, service });
      if (override) return override;
      options.onProgress?.({ frame: config.decodeCount ?? config.encodeCount ?? 60, ended: config.decodeEnded ?? true });
      return { stdout: '', stderr: '', exitCode: config.decodeExit ?? 0 };
    }
    if (binary === 'injected-ffprobe') {
      const encoded = calls.find(call => call.args.includes('-c:v:0'));
      const tags = {};
      for (let i = 0; i < encoded.args.length; i++) if (encoded.args[i] === '-metadata') {
        const [key, ...rest] = encoded.args[i + 1].split('='); tags[key] = rest.join('=');
      }
      const profile = VENDOR_PROFILES.find(row => row.id === request.settings.profileId);
      const probe = { ...structuredClone(source.probe), format: { ...source.probe.format, tags },
        streams: [{ ...structuredClone(source.probe.streams[0]), index: 0,
          codec_name: { H264: 'h264', H265: 'hevc', AV1: 'av1' }[profile.codec],
          tags: { ENCODER: `Lavc63.1.101 ${config.encoderTag || profile.encoder}` },
          pix_fmt: config.outputPixels || source.probe.streams[0].pix_fmt }] };
      config.outputProbe?.(probe);
      return { stdout: JSON.stringify(probe), stderr: '', exitCode: 0 };
    }
    assert.ok(args.includes('-c:v:0'), 'Only owned encode/decode/probe fakes are allowed');
    await config.encode?.({ binary, args, options, service });
    if (options.signal.aborted) throw error('CANCELLED');
    await fs.writeFile(args.at(-1), 'Owned vendor encoded stage bytes');
    options.onProgress?.({ frame: config.encodeCount ?? 60, ended: config.encodeEnded ?? true, seconds: 2, speed: 1 });
    return { stdout: '', stderr: '', exitCode: config.encodeExit ?? 0 };
  };
  const Service = config.Service || EncoderService;
  const service = new Service({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir: path.join(root, 'state'),
    inspectionCache: null, inspectionWorkers: 1, run,
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'ffmpeg version injected', ffprobe: 'ffprobe version injected' } }),
    vendorCapabilities: async () => ({ profiles: VENDOR_PROFILES.map(profile => ({ id: profile.id, checks: [8, 10].map(bitDepth => ({
      bitDepth, available: config.unavailableDepth !== bitDepth && profile.bitDepths.includes(bitDepth), device: { description: `${profile.hardware} display adapter` },
    })) })), bindings }),
    vendorAdapters: async options => {
      deviceReads++;
      return config.adapters ? config.adapters({ options, deviceReads, inventories }) : { status: 'complete', adapters: inventories };
    },
    inspect: async () => { if (config.inspectError) throw config.inspectError; return structuredClone(source); },
    verify: (before, after, tuple) => { verifiedSettings = tuple; return config.verify ? config.verify(before, after, tuple) : validateOutput(before, after, tuple); },
    ...config.serviceOptions });
  service.recordIncident = async event => { incidents.push(structuredClone(event)); return { persisted: true }; };
  service.on('update', state => states.push(state));
  const inFolder = await service.registerFolder(input, 'input'), outFolder = await service.registerFolder(output, 'output');
  const request = { inputFolderId: inFolder.id, outputFolderId: outFolder.id, settings: config.settings || { ...settings },
    ...(config.batchOverrides ? { batchOverrides: config.batchOverrides } : {}) };
  return { root, input, output, service, request, source, calls, incidents, states, bindings,
    deviceReads: () => deviceReads, verifiedSettings: () => verifiedSettings,
    async prepare() {
      const plan = await service.prepareBatch(request);
      return config.fileOverrides ? service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id,
        revision: plan.operationDraft.revision, fileIds: [plan.items[0].id], overrides: config.fileOverrides }) : plan;
    },
    async finish(plan) {
      service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
      await service.taskPromise; return service.snapshot();
    },
    async unpublished() { assert.deepEqual((await fs.readdir(output, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name), []); },
  };
}
function noPrivate(value) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /EACCES|PRIVATE|X:\\|"(?:binding|luid|umdVersion|nativePrivate|canonicalPath)"/);
  assert.doesNotMatch(text, /[A-Z]:\\\\/i);
}
module.exports = { settings, error, tick, sha, load, inspection, harness, inertBinding, adapter, noPrivate };
