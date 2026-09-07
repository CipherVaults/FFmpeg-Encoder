'use strict';

// This is an engineering probe of the exact bundled encoders, not a product quality benchmark.
// Keeping it independent of application modules makes binary upgrades separately attributable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'binary-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const args = process.argv.slice(2);
const staged = args.includes('--staged');
const bitsOption = args.find((arg) => arg.startsWith('--bits='));
const bits = bitsOption ? bitsOption.slice(7).split(',').map(Number) : [8, 10];
const knownFlags = args.every((arg) => arg === '--staged' || arg === '--help' || /^--bits=(8|10)(,(8|10))*$/.test(arg));
if (args.includes('--help')) {
  console.log('Usage: node scripts/validate-encoders.cjs [--staged] [--bits=8,10]\nDefault: verify active pinned binaries, then test all six provisional profiles at 8 and 10 bits.\nWrites a fresh artifacts/encoder-validation-* directory. Failures remain explicit and exit 1.');
  process.exit(0);
}
if (!knownFlags || new Set(bits).size !== bits.length) throw new Error('Unknown or duplicate options. Use --help.');

const binaryRoot = staged
  ? path.join(root, '.tools', `ffmpeg-${manifest.release}`, manifest.archive.rootDirectory, 'bin')
  : path.join(root, 'ffmpeg');
for (const binary of manifest.binaries) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(binaryRoot, binary.name))).digest('hex');
  if (actual !== binary.sha256) throw new Error(`Refusing unpinned ${binary.name}: ${actual}`);
}
const ffmpeg = path.join(binaryRoot, 'ffmpeg.exe');
const ffprobe = path.join(binaryRoot, 'ffprobe.exe');
const runRoot = path.join(root, 'artifacts', `encoder-validation-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`);
fs.mkdirSync(runRoot, { recursive: true });

// These candidates came from the approved plan. Matching CRF/CQ numbers never imply
// matching quality across codecs or encoders; success only proves this argument combination works.
const profiles = [
  { id: 'h264-cpu', encoder: 'libx264', codec: 'h264', settings: ['-preset', 'slower', '-crf', '24'] },
  { id: 'h265-cpu', encoder: 'libx265', codec: 'hevc', settings: ['-preset', 'slow', '-crf', '25', '-x265-params', 'aq-mode=3:psy-rd=2.0'] },
  { id: 'av1-cpu', encoder: 'libsvtav1', codec: 'av1', settings: ['-preset', '6', '-crf', '32'] },
  { id: 'h264-nvidia', encoder: 'h264_nvenc', codec: 'h264', settings: ['-preset', 'p5', '-rc', 'vbr', '-cq', '28', '-b:v', '0'] },
  { id: 'h265-nvidia', encoder: 'hevc_nvenc', codec: 'hevc', settings: ['-preset', 'p5', '-rc', 'vbr', '-cq', '25', '-b:v', '0'] },
  { id: 'av1-nvidia', encoder: 'av1_nvenc', codec: 'av1', settings: ['-preset', 'p5', '-rc', 'vbr', '-cq', '30', '-b:v', '0'] },
];

function run(binary, argv, label) {
  const start = Date.now();
  const result = spawnSync(binary, argv, {
    cwd: root, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(runRoot, `${label}.stdout.txt`), result.stdout || '');
  fs.writeFileSync(path.join(runRoot, `${label}.stderr.txt`), result.stderr || '');
  return {
    executable: path.relative(root, binary), arguments: argv, exitCode: result.status,
    signal: result.signal, elapsedMs: Date.now() - start,
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
    stdout: result.stdout || '', stderr: result.stderr || '',
  };
}

function compact(command) {
  const { stdout, stderr, ...record } = command;
  return record;
}

const report = {
  schemaVersion: 1, startedAtUtc: new Date().toISOString(), binarySource: staged ? 'staged' : 'active',
  release: manifest.release, binaryHashes: manifest.binaries.map(({ name, sha256 }) => ({ name, sha256 })),
  fixture: { generator: 'testsrc2', width: 320, height: 180, frameRate: 30, frames: 60, transfer: 'bt709', primaries: 'bt709', matrix: 'bt709', range: 'tv' },
  limits: [
    'Synthetic two-second SDR samples prove argument acceptance and local encode/decode operation only.',
    'A compiled NVENC encoder may reject this GPU, driver or bit depth; failures are recorded, never converted to CPU fallback.',
    'This probe does not prove perceptual quality, speed on production media, multi-stream preservation or application lifecycle behavior.',
    'Ten-bit SDR remains SDR; bit depth is verified independently of transfer characteristics.',
  ],
  versions: {}, cases: [],
};
for (const [name, binary] of Object.entries({ ffmpeg, ffprobe })) {
  const version = run(binary, ['-version'], `${name}-version`);
  report.versions[name] = { ...compact(version), firstLine: version.stdout.split(/\r?\n/)[0] };
  if (version.error || version.exitCode !== 0) throw new Error(`${name} version command failed; see ${runRoot}`);
}

for (const profile of profiles) {
  const help = run(ffmpeg, ['-hide_banner', '-h', `encoder=${profile.encoder}`], `${profile.encoder}-help`);
  for (const bitDepth of bits) {
    const label = `${profile.id}-${bitDepth}bit`;
    const output = path.join(runRoot, `${label}.mkv`);
    const hardware = profile.encoder.endsWith('_nvenc');
    const pixelFormat = bitDepth === 8 ? 'yuv420p' : hardware ? 'p010le' : 'yuv420p10le';
    const codecProfile = bitDepth === 10 && profile.encoder === 'h264_nvenc' ? ['-profile:v', 'high10']
      : bitDepth === 10 && profile.encoder === 'hevc_nvenc' ? ['-profile:v', 'main10'] : [];
    const encodeArgs = [
      // Label the synthetic source as SDR before output negotiation. With '+' pixel format,
      // FFmpeg correctly rejects even implicit unknown-to-BT.709 color conversion.
      '-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30,format=${pixelFormat},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
      '-map', '0:v:0', '-frames:v', '60', '-an', '-c:v', profile.encoder, ...profile.settings, ...codecProfile,
      '-pix_fmt', `+${pixelFormat}`, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-metadata', 'title=Provisional SDR encoder validation', '-progress', 'pipe:1', '-nostats', output,
    ];
    const encode = run(ffmpeg, encodeArgs, `${label}-encode`);
    const item = {
      id: label, encoder: profile.encoder, requestedBitDepth: bitDepth, requestedPixelFormat: pixelFormat,
      settings: profile.settings, status: 'failed', help: compact(help), encode: compact(encode), checks: [],
    };
    report.cases.push(item);
    if (encode.error || encode.exitCode !== 0) {
      item.failure = encode.error?.message || encode.stderr.slice(-6000);
      console.log(`FAIL ${label}: encode exit ${encode.exitCode}`);
      continue;
    }
    const probe = run(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output], `${label}-probe`);
    item.probe = compact(probe);
    try {
      if (probe.error || probe.exitCode !== 0) throw new Error('ffprobe failed');
      const metadata = JSON.parse(probe.stdout);
      const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
      if (!video) throw new Error('No encoded video stream');
      item.observed = {
        codec: video.codec_name, profile: video.profile, pixelFormat: video.pix_fmt,
        frames: Number(video.nb_read_frames), width: video.width, height: video.height,
        frameRate: video.avg_frame_rate, colorTransfer: video.color_transfer,
        colorPrimaries: video.color_primaries, colorSpace: video.color_space, colorRange: video.color_range,
        sizeBytes: fs.statSync(output).size,
      };
      const expectedPixelFormat = bitDepth === 8 ? 'yuv420p' : 'yuv420p10le';
      const checks = {
        codec: video.codec_name === profile.codec,
        bitDepthAndChroma: video.pix_fmt === expectedPixelFormat,
        resolution: video.width === 320 && video.height === 180,
        frames: Number(video.nb_read_frames) === 60,
        cadence: video.avg_frame_rate === '30/1',
        sdrMetadata: video.color_transfer === 'bt709' && video.color_primaries === 'bt709' && video.color_space === 'bt709' && video.color_range === 'tv',
        title: metadata.format?.tags?.title === 'Provisional SDR encoder validation',
        finalTelemetry: /(?:^|\r?\n)progress=end(?:\r?\n|$)/.test(encode.stdout),
      };
      const decode = run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-f', 'null', '-'], `${label}-decode`);
      item.decode = compact(decode);
      checks.fullDecode = !decode.error && decode.exitCode === 0;
      item.checks = Object.entries(checks).map(([name, passed]) => ({ name, passed }));
      item.status = Object.values(checks).every(Boolean) ? 'passed' : 'failed';
      if (item.status === 'failed') item.failure = `Failed checks: ${item.checks.filter((check) => !check.passed).map((check) => check.name).join(', ')}`;
    } catch (error) {
      item.failure = error.message;
    }
    console.log(`${item.status === 'passed' ? 'PASS' : 'FAIL'} ${label}${item.failure ? `: ${item.failure}` : ''}`);
  }
  // Preserve evidence after each profile, including an interruption partway through the matrix.
  fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
report.completedAtUtc = new Date().toISOString();
report.summary = { passed: report.cases.filter((item) => item.status === 'passed').length, failed: report.cases.filter((item) => item.status !== 'passed').length };
fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${path.join(runRoot, 'report.json')}`);
process.exitCode = report.summary.failed ? 1 : 0;
