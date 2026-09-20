'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { checkCapabilities } = require('../src/capabilities.cjs');
const { ARCHIVE_RECIPE } = require('../src/media.cjs');

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
  assert.equal(h.commands.filter((args) => args.includes('-c:v:0')).length, 14);
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
  assert.ok(result.recipes.every((recipe) => !recipe.available && recipe.checks.every((check) => check.code === 'CAPABILITY_DECODE_FAILED')));
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('Archive Quality probes its complete options at both depths and separately decodes each output', async t => {
  const h = await harness(t);
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run: h.run });
  assert.equal(result.recipes.length, 1);
  const recipe = result.recipes[0];
  assert.equal(recipe.id, ARCHIVE_RECIPE.id);
  assert.equal(recipe.available, true);
  assert.deepEqual(recipe.supportedBitDepths, [8, 10]);
  assert.deepEqual(recipe.checks.map(check => [check.codec, check.pixelFormat, check.frames]), [
    ['hevc', 'yuv420p', 2], ['hevc', 'yuv420p10le', 2],
  ]);
  const encodes = h.commands.filter(args => args.includes('-c:v:0') && path.basename(args.at(-1)).startsWith(ARCHIVE_RECIPE.id));
  assert.equal(encodes.length, 2);
  for (const args of encodes) {
    // These are the claimed compound options, not merely a successful default
    // NVENC probe. Ordinary profile probes must remain a separate operation.
    for (const [flag, expected] of Object.entries({ '-c:v:0': 'hevc_nvenc', '-preset:v:0': ARCHIVE_RECIPE.preset,
      '-rc:v:0': 'vbr', '-cq:v:0': String(ARCHIVE_RECIPE.quality), '-b:v:0': '0', '-tune:v:0': 'uhq',
      '-multipass:v:0': 'fullres', '-bf:v:0': '4', '-b_ref_mode:v:0': 'each' })) {
      assert.equal(args.filter(value => value === flag).length, 1, flag);
      assert.equal(args[args.indexOf(flag) + 1], expected, flag);
    }
    assert.ok(h.commands.some(command => command.includes('-count_frames') && command.at(-1) === args.at(-1)));
    assert.ok(h.commands.some(command => command.includes('null') && command[command.indexOf('-i') + 1] === args.at(-1)));
  }
  const normal = h.commands.find(args => args.includes('-c:v:0') && args.at(-1).endsWith('h265-nvidia-8.mkv'));
  assert.equal(normal[normal.indexOf('-tune:v:0') + 1], 'hq');
  assert.equal(normal.includes('-multipass:v:0'), false);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('Archive Quality cannot inherit a successful ordinary profile or unsupported depth', async t => {
  const h = await harness(t, args => args.includes('-c:v:0') && args.at(-1).endsWith(`${ARCHIVE_RECIPE.id}-10.mkv`)
    ? Object.assign(new Error('Recipe rejected on this device'), { code: 'TOOL_FAILED', stderr: 'UHQ 10-bit path unsupported.' }) : null);
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run: h.run });
  assert.deepEqual(result.profiles.find(profile => profile.id === 'h265-nvidia').supportedBitDepths, [8, 10]);
  const recipe = result.recipes[0];
  assert.equal(recipe.available, true);
  assert.deepEqual(recipe.supportedBitDepths, [8]);
  assert.equal(recipe.checks.find(check => check.bitDepth === 10).code, 'TOOL_FAILED');
  assert.match(recipe.reason, /10-bit SDR: UHQ 10-bit path unsupported/);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('recipe warnings reject only the recipe instead of silently accepting potentially ignored options', async t => {
  const h = await harness(t);
  const run = async (binary, args, options) => {
    const result = await h.run(binary, args, options);
    return args.includes('-c:v:0') ? { ...result, stderr: 'Option was not applied as requested.' } : result;
  };
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run });
  assert.ok(result.profiles.every(profile => profile.available));
  assert.equal(result.recipes[0].available, false);
  assert.deepEqual(result.recipes[0].supportedBitDepths, []);
  assert.ok(result.recipes[0].checks.every(check => check.code === 'RECIPE_OPTIONS_UNVERIFIED'));
  assert.match(result.recipes[0].reason, /Option was not applied/);
  assert.equal(h.commands.some(args => args.includes('-count_frames') && args.at(-1).includes(ARCHIVE_RECIPE.id)), false);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

const expectedCopyOverride = "[vost#0:0 @ 000001FA12ab34] Multiple -codec/-c/-acodec/-vcodec/-scodec/-dcodec options specified for stream 0, only the last option '-codec:v:0 hevc_nvenc' will be used.";

test('the exact stream-copy override warning permits recipe inspection and decode without accepting arbitrary diagnostics', async t => {
  const h = await harness(t);
  const run = async (binary, args, options) => {
    const result = await h.run(binary, args, options);
    return args.includes('-c:v:0') && args.at(-1).includes(ARCHIVE_RECIPE.id)
      ? { ...result, stderr: `  ${expectedCopyOverride}\r\n\r\n` } : result;
  };
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run });
  assert.equal(result.recipes[0].available, true);
  assert.deepEqual(result.recipes[0].supportedBitDepths, [8, 10]);
  const outputs = h.commands.filter(args => args.includes('-c:v:0') && args.at(-1).includes(ARCHIVE_RECIPE.id)).map(args => args.at(-1));
  assert.equal(outputs.length, 2);
  for (const output of outputs) {
    assert.ok(h.commands.some(args => args.includes('-count_frames') && args.at(-1) === output));
    assert.ok(h.commands.some(args => args.includes('null') && args[args.indexOf('-i') + 1] === output));
  }
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

for (const [label, warning] of [
  ['same-line appended warning', `${expectedCopyOverride} Option multipass was ignored.`],
  ['additional LF warning', `${expectedCopyOverride}\nOption multipass was ignored.`],
  ['additional CRLF warning', `${expectedCopyOverride}\r\nOption multipass was ignored.\r\n`],
  ['different encoder', expectedCopyOverride.replace('hevc_nvenc', 'h264_nvenc')],
  ['different stream', expectedCopyOverride.replace('stream 0,', 'stream 1,')],
  ['missing final punctuation', expectedCopyOverride.slice(0, -1)],
]) test(`recipe warning exception rejects ${label}`, async t => {
  const h = await harness(t);
  const run = async (binary, args, options) => {
    const result = await h.run(binary, args, options);
    return args.includes('-c:v:0') && args.at(-1).includes(ARCHIVE_RECIPE.id) ? { ...result, stderr: warning } : result;
  };
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run });
  assert.ok(result.profiles.every(profile => profile.available));
  assert.equal(result.recipes[0].available, false);
  assert.deepEqual(result.recipes[0].supportedBitDepths, []);
  assert.ok(result.recipes[0].checks.every(check => check.code === 'RECIPE_OPTIONS_UNVERIFIED'));
  assert.ok(result.recipes[0].checks.every(check => check.reason.includes(warning.trim())));
  assert.equal(h.commands.some(args => args.includes('-count_frames') && args.at(-1).includes(ARCHIVE_RECIPE.id)), false);
  assert.equal(h.commands.some(args => args.includes('null') && args[args.indexOf('-i') + 1].includes(ARCHIVE_RECIPE.id)), false);
  assert.deepEqual(await fs.readdir(h.stateDir), ['fake-tool.exe']);
});

test('recipe output mismatch and incomplete decode fail independently of working ordinary HEVC', async t => {
  const h = await harness(t);
  const run = async (binary, args, options) => {
    const result = await h.run(binary, args, options);
    if (args.includes('-count_frames') && args.at(-1).endsWith(`${ARCHIVE_RECIPE.id}-10.mkv`)) {
      const probe = JSON.parse(result.stdout);
      probe.streams[0].pix_fmt = 'yuv420p';
      return { ...result, stdout: JSON.stringify(probe) };
    }
    if (args.includes('null') && args[args.indexOf('-i') + 1].endsWith(`${ARCHIVE_RECIPE.id}-8.mkv`)) {
      return { ...result, stdout: 'frame=1\nprogress=end\n' };
    }
    return result;
  };
  const result = await checkCapabilities({ ffmpeg: h.binary, ffprobe: h.binary, stateDir: h.stateDir, run });
  assert.ok(result.profiles.every(profile => profile.available));
  assert.equal(result.recipes[0].available, false);
  assert.deepEqual(result.recipes[0].checks.map(check => check.code), ['CAPABILITY_DECODE_FAILED', 'CAPABILITY_OUTPUT_MISMATCH']);
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
