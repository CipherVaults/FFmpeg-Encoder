'use strict';

// Complements validate-encoders.cjs and the runtime capability check: exercise
// every exposed nondefault preset and both quality boundaries through the same
// argv builder as a real job. This is acceptance evidence, not a quality score.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PROFILES, buildEncodeArgs, selectVideo, classifyColor } = require('../src/media.cjs');
const { runTool } = require('../src/process-runner.cjs');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('Usage: node scripts/validate-profile-options.cjs [--profiles=id,id] [--kind=presets|quality]\nTests active pinned binaries on two-frame 160x96 8/10-bit SDR. Default-preset/default-quality cases belong to the separate default/capability suite. Each encode has a 30-second limit. Writes artifacts/profile-options-*/report.json; any failure exits 1.');
  process.exit(0);
}
const profilesOption = argv.find((arg) => arg.startsWith('--profiles='));
const kindOption = argv.find((arg) => arg.startsWith('--kind='));
const ids = profilesOption?.slice('--profiles='.length).split(',') || PROFILES.map((profile) => profile.id);
const kind = kindOption?.slice('--kind='.length);
if (argv.some((arg) => !/^--profiles=[a-z0-9,-]+$/.test(arg) && !/^--kind=(presets|quality)$/.test(arg))
    || argv.filter((arg) => arg.startsWith('--profiles=')).length > 1
    || argv.filter((arg) => arg.startsWith('--kind=')).length > 1
    || new Set(ids).size !== ids.length || ids.some((id) => !PROFILES.some((profile) => profile.id === id))) {
  throw new Error('Invalid options. Use --help.');
}
const profiles = PROFILES.filter((profile) => ids.includes(profile.id));
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const expectedCodec = { H264: 'h264', H265: 'hevc', AV1: 'av1' };
const frameCount = 2;
const runRoot = path.join(root, 'artifacts', `profile-options-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`);
const report = {
  schemaVersion: 1, startedAtUtc: new Date().toISOString(), status: 'running',
  invocation: argv, host: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
  fixture: { width: 160, height: 96, frameRate: 30, frames: frameCount, transfer: 'bt709', bits: [8, 10] },
  productionBuilder: 'src/media.cjs:buildEncodeArgs', versions: {}, binaryHashes: [],
  profiles, help: [], fixtures: [], cases: [], commands: [],
  limits: [
    'Tiny synthetic samples establish argument acceptance, codec/color/depth/cadence preservation and complete decode on this host only.',
    'Each exposed preset is tested at its profile default quality; quality endpoints use the default preset. This is not every preset/quality Cartesian combination.',
    'Default-preset/default-quality samples are intentionally left to validate-encoders.cjs and runtime capabilities rather than repeated here.',
    'NVIDIA success depends on this GPU and driver; capability checks on each installation remain authoritative.',
    'No perceptual-quality, production-speed, long-video, non-4:2:0, HDR, or clean-machine claim follows from these samples.',
  ],
};

async function checkpoint() {
  await fs.writeFile(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

async function execute(binary, args, label, timeoutMs = 30_000) {
  const started = Date.now();
  const command = { label, executable: binary, arguments: args, timeoutMs };
  report.commands.push(command);
  try {
    const result = await runTool(binary, args, { timeoutMs, stdoutLimit: 2 * 1024 * 1024, stderrLimit: 256 * 1024 });
    Object.assign(command, { exitCode: result.exitCode, elapsedMs: Date.now() - started });
    await fs.writeFile(path.join(runRoot, `${label}.stdout.txt`), result.stdout);
    await fs.writeFile(path.join(runRoot, `${label}.stderr.txt`), result.stderr);
    return result;
  } catch (error) {
    Object.assign(command, { exitCode: error.exitCode ?? null, elapsedMs: Date.now() - started, error: { code: error.code, message: error.message } });
    await fs.writeFile(path.join(runRoot, `${label}.stderr.txt`), error.stderr || error.message);
    throw error;
  }
}

function verifyStream(probe, bitDepth, codec) {
  const stream = selectVideo(probe);
  assert.equal(stream.codec_name, codec, 'Output codec');
  assert.equal(stream.pix_fmt, bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', 'Output pixel depth/chroma');
  assert.equal(stream.width, 160, 'Width');
  assert.equal(stream.height, 96, 'Height');
  assert.equal(Number(stream.nb_read_frames), frameCount, 'Fully read frame count');
  assert.equal(stream.r_frame_rate, '30/1', 'Frame cadence');
  for (const key of ['color_transfer', 'color_primaries', 'color_space']) assert.equal(stream[key], 'bt709', key);
  assert.equal(stream.color_range, 'tv', 'Color range');
  assert.equal(classifyColor(probe).classification, 'sdr', 'SDR classification');
  return stream;
}

async function inspect(filename, label) {
  const result = await execute(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames', '-show_streams', '-show_format', '-of', 'json', filename], label);
  return JSON.parse(result.stdout);
}

async function main() {
  await fs.mkdir(runRoot, { recursive: true });
  console.log(`Evidence: ${runRoot}`);
  const manifest = JSON.parse((await fs.readFile(path.join(root, 'resources', 'binary-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
  for (const binary of manifest.binaries) {
    const actual = crypto.createHash('sha256').update(await fs.readFile(path.join(root, binary.runtimePath))).digest('hex');
    assert.equal(actual, binary.sha256, `Refusing unpinned ${binary.name}`);
    report.binaryHashes.push({ name: binary.name, sha256: actual });
  }
  report.mediaSourceSha256 = crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'src', 'media.cjs'))).digest('hex');
  report.scriptSourceSha256 = crypto.createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  for (const [name, binary] of Object.entries({ ffmpeg, ffprobe })) {
    const result = await execute(binary, ['-version'], `${name}-version`);
    report.versions[name] = result.stdout.split(/\r?\n/)[0];
  }
  try {
    const gpu = await execute('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], 'gpu', 5000);
    report.host.gpu = gpu.stdout.trim();
  } catch (error) {
    report.host.gpuInspectionError = error.message;
  }
  for (const profile of profiles) {
    const result = await execute(ffmpeg, ['-hide_banner', '-h', `encoder=${profile.encoder}`], `${profile.id}-help`);
    const help = `${result.stdout}\n${result.stderr}`;
    assert.ok(help.includes(`Encoder ${profile.encoder} `), `${profile.encoder} help must exist`);
    const pixelFormats = help.match(/Supported pixel formats:\s*([^\r\n]+)/)?.[1].trim().split(/\s+/) || [];
    assert.ok(pixelFormats.includes('yuv420p'));
    assert.ok(pixelFormats.includes(profile.hardware === 'NVIDIA' ? 'p010le' : 'yuv420p10le'));
    const control = profile.quality.mode.toLowerCase();
    const qualityLine = help.split(/\r?\n/).find((line) => new RegExp(`^\\s+-${control}\\s`).test(line));
    assert.ok(qualityLine, `Missing ${control} option`);
    if (profile.hardware === 'NVIDIA') {
      for (const preset of profile.presets) assert.match(help, new RegExp(`^\\s+${preset}\\s+\\d+\\s`, 'm'));
      assert.match(qualityLine, new RegExp(`from 0 to ${profile.quality.max}`));
      assert.match(qualityLine, /0 means automatic/);
    }
    if (profile.encoder === 'libsvtav1') {
      assert.match(help, /Encoding preset \(from -2 to 13\)/);
      assert.match(qualityLine, /from 0 to 63/);
    }
    report.help.push({ profileId: profile.id, pixelFormats, qualityLine: qualityLine.trim(), presetValidation: profile.hardware === 'CPU' && profile.encoder !== 'libsvtav1' ? 'Help accepts a preset string; each exposed name is established by real encodes below.' : 'Exposed choices verified against encoder help and real encodes below.' });
  }
  const fixtures = new Map();
  for (const bitDepth of [8, 10]) {
    const pixelFormat = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
    const input = path.join(runRoot, `input-${bitDepth}.mkv`);
    const source = `testsrc2=size=160x96:rate=30,format=${pixelFormat},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
    await execute(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', source, '-frames:v', String(frameCount), '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', `+${pixelFormat}`, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-f', 'matroska', input], `fixture-${bitDepth}`);
    const probe = await inspect(input, `fixture-${bitDepth}-probe`);
    verifyStream(probe, bitDepth, 'ffv1');
    fixtures.set(bitDepth, { input, probe });
    report.fixtures.push({ bitDepth, input });
  }
  await checkpoint();
  for (const profile of profiles) {
    const options = [];
    // Endpoints run first so a misleading or rejected boundary becomes visible
    // before spending time on slower preset checks.
    if (kind !== 'presets') for (const quality of [profile.quality.min, profile.quality.max]) {
      options.push({ kind: 'quality', preset: profile.defaultPreset, quality });
    }
    if (kind !== 'quality') for (const preset of profile.presets.filter((preset) => preset !== profile.defaultPreset)) {
      options.push({ kind: 'preset', preset, quality: profile.quality.default });
    }
    for (const option of options) for (const bitDepth of [8, 10]) {
      const id = `${profile.id}-${bitDepth}-${option.kind}-${option.preset}-${option.quality}`;
      const entry = { id, profileId: profile.id, bitDepth, ...option, status: 'running' };
      report.cases.push(entry);
      const { input, probe } = fixtures.get(bitDepth);
      const output = path.join(runRoot, `${id}.mkv`);
      const settings = { profileId: profile.id, preset: option.preset, quality: option.quality };
      const started = Date.now();
      try {
        const args = buildEncodeArgs({ input, output, settings, probe });
        const encoded = await execute(ffmpeg, args, `${id}-encode`);
        assert.match(encoded.stdout, /^progress=end\s*$/m, 'Final encode progress');
        const inspected = await inspect(output, `${id}-probe`);
        const stream = verifyStream(inspected, bitDepth, expectedCodec[profile.codec]);
        const decoded = await execute(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats', '-protocol_whitelist', 'file,pipe', '-i', output, '-map', '0:v:0', '-progress', 'pipe:1', '-f', 'null', '-'], `${id}-decode`);
        const counts = [...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map((match) => Number(match[1]));
        assert.equal(counts.at(-1), frameCount, 'Complete strict decode');
        assert.match(decoded.stdout, /^progress=end\s*$/m);
        entry.observed = { codec: stream.codec_name, pixelFormat: stream.pix_fmt, frames: frameCount, sizeBytes: (await fs.stat(output)).size };
        // SVT writes its resolved CRF configuration even at FFmpeg's warning
        // level. Do not call a value accepted if the library silently replaces it.
        if (profile.encoder === 'libsvtav1') {
          const resolvedCrf = encoded.stderr.match(/BRC mode\s*\/\s*rate factor\s*:\s*CRF\s*\/\s*(\d+(?:\.\d+)?)/i);
          assert.ok(resolvedCrf, 'SVT must report its resolved CRF');
          entry.observed.resolvedCrf = Number(resolvedCrf[1]);
          assert.equal(entry.observed.resolvedCrf, option.quality, 'Requested SVT CRF must match resolved CRF');
          const resolvedPreset = encoded.stderr.match(/preset\s*\/\s*tune\s*\/\s*pred struct\s*:\s*(\d+)/i);
          assert.ok(resolvedPreset, 'SVT must report its resolved preset');
          entry.observed.resolvedPreset = resolvedPreset[1];
          assert.equal(entry.observed.resolvedPreset, option.preset, 'Requested SVT preset must not be silently remapped');
          assert.doesNotMatch(encoded.stderr, /Non-RTC M10\+ are meant for automation tooling usage/i, 'Do not expose SVT automation-tooling presets as normal video choices');
        }
        entry.status = 'passed';
      } catch (error) {
        entry.status = 'failed';
        entry.error = { code: error.code || 'ASSERTION', message: error.message, stderr: error.stderr?.trim().slice(-2000) };
      }
      entry.elapsedMs = Date.now() - started;
      console.log(`${entry.status}: ${id} (${entry.elapsedMs} ms)${entry.error ? `: ${entry.error.message}` : ''}`);
      await checkpoint();
    }
  }
  report.summary = { passed: report.cases.filter((entry) => entry.status === 'passed').length, failed: report.cases.filter((entry) => entry.status !== 'passed').length };
  report.status = report.summary.failed ? 'failed' : 'passed';
  report.finishedAtUtc = new Date().toISOString();
  await checkpoint();
  console.log(JSON.stringify({ report: path.join(runRoot, 'report.json'), ...report.summary }));
  if (report.summary.failed) process.exitCode = 1;
}

main().catch(async (error) => {
  report.status = 'failed';
  report.infrastructureError = { code: error.code, message: error.message, stderr: error.stderr };
  try { await checkpoint(); } catch { /* Preserve the original infrastructure error. */ }
  console.error(error);
  process.exitCode = 1;
});
