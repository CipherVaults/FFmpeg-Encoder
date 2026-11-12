'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const api = require('../src/vendor-capabilities.cjs');

const filename = path.resolve(__dirname, '../src/vendor-capabilities.cjs');
const artifactParent = path.resolve(__dirname, '../artifacts/vendor-capabilities-tests');
const sha = file => createHash('sha256').update(syncFs.readFileSync(file)).digest('hex');
const error = (code, message = 'PRIVATE stderr X:\\private\\fixture.mkv') => Object.assign(new Error(message), { code, stderr: message });
function adapter(adapterIndex = 0, vendorId = 0x1002, extra = {}) {
  return { adapterIndex, vendorId, description: vendorId === 0x1002 ? 'AMD display adapter' : 'Intel display adapter',
    deviceId: 0x1234, luid: `00000001:${adapterIndex.toString(16).padStart(8, '0')}`, umdVersion: '31.0.1.2',
    subsystemId: 0, revision: 1, flags: 0, dedicatedVideoBytes: 1024, driverQueryHresult: 0, ...extra };
}
function load(source = syncFs.readFileSync(filename, 'utf8'), overrides = {}) {
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(overrides, name) ? overrides[name] : realRequire(name);
  loaded._compile(source, filename);
  return loaded.exports;
}
async function harness(t, { inventory = { status: 'complete', adapters: [adapter(), adapter(1, 0x8086)] },
  before, after, implementation = api, adapters, stateDir: requestedStateDir } = {}) {
  await fs.mkdir(artifactParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifactParent, 'run-'));
  t.after(async () => {
    const actual = await fs.realpath(root), parent = await fs.realpath(artifactParent);
    assert.ok(actual.startsWith(parent + path.sep) && path.basename(actual).startsWith('run-'));
    await fs.rm(actual, { recursive: true });
  });
  const stateDir = requestedStateDir || root, calls = [], media = new Map();
  let queryCount = 0;
  const run = async (binary, args, options) => {
    calls.push({ binary, args, options });
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 20_000);
    assert.equal(options.stdoutLimit, 1024 * 1024);
    assert.equal(options.stderrLimit, 64 * 1024);
    const override = await before?.({ binary, args, options, media, calls });
    if (override) return override;
    if (options.signal.aborted) throw error('CANCELLED');
    const last = args.at(-1);
    let result = { stdout: '', stderr: '', exitCode: 0 };
    if (args.includes('lavfi')) {
      const ten = args[args.indexOf('-pix_fmt') + 1] === '+yuv420p10le';
      media.set(last, { index: 0, codec_type: 'video', codec_name: 'ffv1', pix_fmt: ten ? 'yuv420p10le' : 'yuv420p',
        width: 320, height: 180, color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
        disposition: { default: 0 }, nb_read_frames: '2' });
      await fs.writeFile(last, 'owned fixture');
    } else if (args.includes('-show_streams')) {
      result.stdout = JSON.stringify({ streams: [media.get(last)] });
    } else if (args.includes('-c:v:0')) {
      const source = media.get(args[args.indexOf('-i') + 1]), encoder = args[args.indexOf('-c:v:0') + 1];
      media.set(last, { ...source, codec_name: encoder.includes('264') ? 'h264' : encoder.includes('hevc') ? 'hevc' : 'av1' });
      await fs.writeFile(last, 'owned encoded fixture');
      result.stdout = 'frame=2\nprogress=end\n';
    } else if (args.includes('null')) {
      assert.ok(args.includes('-xerror'));
      assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2), ['-map', '0:v:0']);
      result.stdout = 'frame=2\nprogress=end\n';
    } else throw new Error('Unexpected fake child argv');
    return await after?.({ binary, args, options, media, result, calls }) || result;
  };
  const query = async options => { queryCount++; assert.equal(options.run, run); return adapters ? adapters(options) : inventory; };
  return { root, stateDir, run, calls, media, queryCount: () => queryCount,
    check: options => implementation.checkVendorCapabilities({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe',
      stateDir, run, adapters: query, ...options }),
    async clean() { assert.equal((await fs.readdir(root)).some(name => name.startsWith('vendor-capability-')), false); } };
}
const encodeCalls = h => h.calls.filter(({ args }) => args.includes('-c:v:0'));
function noPrivate(value) {
  const text = JSON.stringify(value);
  for (const forbidden of ['PRIVATE', '00000001:', '31.0.1.2', 'vendor-capability-', 'X:\\private', 'adapterIndex',
    'umdVersion', 'luid', 'binding', 'stderr', 'nativePrivate', 'input', 'output']) assert.equal(text.includes(forbidden), false, forbidden);
}
module.exports = { api, filename, sha, adapter, error, load, harness, encodeCalls, noPrivate };
