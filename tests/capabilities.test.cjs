'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { checkCapabilities } = require('../src/capabilities.cjs');

async function harness(t, fault = () => {}) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-capabilities-test-'));
  const binary = path.join(stateDir, 'fake-tool.exe');
  await fs.writeFile(binary, 'This file is never executed.');
  t.after(async () => { await fs.unlink(binary); await fs.rmdir(stateDir); });
  const media = new Map();
  const commands = [];
  const run = async (_binary, args, options) => {
    commands.push(args);
    assert.equal(options.timeoutMs, 20_000);
    assert.equal(options.stdoutLimit, 1024 * 1024);
    assert.equal(options.stderrLimit, 64 * 1024);
    if (options.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    if (args[0] === '-version') {
      const name = commands.length === 1 ? 'ffmpeg' : 'ffprobe';
      return { stdout: `${name} version test\n`, stderr: '', exitCode: 0 };
    }
    const failure = fault(args);
    if (failure) throw failure;
    const last = args.at(-1);
    if (args.includes('-show_streams')) {
      const stream = { ...media.get(last) };
      return { stdout: JSON.stringify({ streams: [stream] }), stderr: '', exitCode: 0 };
    }
    if (args.includes('lavfi')) {
      const bitDepth = last.endsWith('input-10.mkv') ? 10 : 8;
      media.set(last, {
        index: 0, codec_type: 'video', codec_name: 'ffv1',
        pix_fmt: bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', width: 320, height: 180,
        color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
        disposition: { default: 0 }, nb_read_frames: '2',
      });
      await fs.writeFile(last, 'fixture');
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args.includes('-c:v:0')) {
      const source = media.get(args[args.indexOf('-i') + 1]);
      const encoder = args[args.indexOf('-c:v:0') + 1];
      const codec = encoder.includes('264') ? 'h264' : encoder.includes('265') || encoder.includes('hevc') ? 'hevc' : 'av1';
      media.set(last, { ...source, codec_name: codec });
      await fs.writeFile(last, 'encoded');
      return { stdout: 'frame=2\nprogress=end\n', stderr: '', exitCode: 0 };
    }
    return { stdout: 'frame=2\nprogress=end\n', stderr: '', exitCode: 0 };
  };
  return { binary, stateDir, run, commands, media };
}

test('capability checks preserve partial per-depth support and clean only owned temporary media', async (t) => {
  const h = await harness(t, (args) => args.at(-1).endsWith('h264-nvidia-10.mkv') && args.includes('-c:v:0')
    ? Object.assign(new Error('Unsupported ten bit'), { code: 'TOOL_FAILED', stderr: 'Device does not support 10-bit encode.' }) : null);
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run: h.run });
  assert.equal(result.profiles.length, 6);
  const partial = result.profiles.find((profile) => profile.id === 'h264-nvidia');
  assert.equal(partial.available, true);
  assert.deepEqual(partial.supportedBitDepths, [8]);
  assert.match(partial.reason, /10-bit/);
  assert.equal(result.profiles.filter((profile) => profile.supportedBitDepths.length === 2).length, 5);
  assert.equal(h.commands.filter((args) => args.includes('-c:v:0')).length, 12);
  assert.equal(h.commands.some((args) => args.includes('-encoders')), false);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('successful process exit is insufficient when decoded frame count is wrong', async (t) => {
  const h = await harness(t);
  const run = async (binary, args, options) => {
    const result = await h.run(binary, args, options);
    if (args.includes('null')) return { ...result, stdout: 'frame=1\nprogress=end\n' };
    return result;
  };
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run });
  assert.ok(result.profiles.every((profile) => !profile.available && profile.supportedBitDepths.length === 0));
  assert.ok(result.profiles.every((profile) => profile.checks.every((check) => check.code === 'CAPABILITY_DECODE_FAILED')));
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('cancellation aborts the capability scan and cleans already-created fixtures', async (t) => {
  const controller = new AbortController();
  const h = await harness(t, (args) => {
    if (args.includes('-c:v:0')) {
      controller.abort();
      return Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    }
  });
  await assert.rejects(checkCapabilities({
    ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run: h.run, signal: controller.signal,
  }), { code: 'CANCELLED' });
  assert.equal(h.commands.filter((args) => args.includes('-c:v:0')).length, 1);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('missing bundled binary fails before profiles or temporary files are created', async (t) => {
  const h = await harness(t);
  await assert.rejects(checkCapabilities({
    ffmpeg: path.join(h.stateDir, 'missing.exe'), ffprobe: h.binary, stateDir: h.stateDir, run: h.run,
  }), { code: 'MISSING_BINARY' });
  assert.equal(h.commands.length, 0);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});
