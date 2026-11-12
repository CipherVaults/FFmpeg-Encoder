'use strict';

// Capture accepted builders before adding vendor code. Capability filesystem
// calls are virtual: neither a real binary nor temporary media is needed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PROFILES, ARCHIVE_RECIPE, buildEncodeArgs, classifyColor, describeRecipe } = require('../src/media.cjs');
const { buildEncodeOperation } = require('../src/encode-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { defaultPreferences } = require('../src/preferences.cjs');

const OUTPUT_ID = '12345678-1234-4123-8123-123456789abc';
const FORMATS = ['yuv420p', 'nv12', 'yuv420p10le', 'p010le', 'yuv444p'];
const VARIANTS = ['plain', 'metadata', 'attachment', 'subtitle', 'chapters', 'combined'];
function ordinaryProbe(pixelFormat = 'yuv420p', variant = 'plain') {
  const probe = {
    streams: [{ index: 2, codec_type: 'video', codec_name: 'h264', pix_fmt: pixelFormat,
      width: 1920, height: 1080, color_transfer: 'bt709', color_primaries: 'bt709',
      color_space: 'bt709', color_range: 'tv', disposition: { default: 1 } }],
    format: { format_name: 'matroska,webm', duration: '4', tags: {} }, chapters: [],
  };
  if (['metadata', 'combined'].includes(variant)) {
    probe.format.tags = { title: 'Ordinary source', comment: 'Literal -i and spaces remain metadata' };
    probe.streams[0].tags = { title: 'Primary video', creation_time: 'source-time-text' };
    probe.streams.push({ index: 4, codec_type: 'audio', codec_name: 'aac', channels: 2,
      sample_rate: '48000', tags: { language: 'eng', title: 'Main audio', creation_time: 'audio-time-text' },
      disposition: { default: 1, original: 1 } });
  }
  if (['attachment', 'combined'].includes(variant)) probe.streams.push({ index: 7,
    codec_type: 'attachment', codec_name: 'ttf', tags: { filename: 'font.ttf', mimetype: 'application/x-truetype-font' } });
  if (['subtitle', 'combined'].includes(variant)) probe.streams.push({ index: 9,
    codec_type: 'subtitle', codec_name: 'ass', tags: { language: 'eng', title: 'Captions' }, disposition: { forced: 1 } });
  if (['chapters', 'combined'].includes(variant)) probe.chapters = [{ id: 1, time_base: '1/1000',
    start: 0, end: 4000, tags: { title: 'First chapter' } }];
  return probe;
}

async function captureCapabilities() {
  const filename = path.resolve(__dirname, '../src/capabilities.cjs');
  const realRequire = createRequire(filename), module = { exports: {} };
  const files = new Map(), commands = [];
  const virtualFs = {
    stat: async () => ({ isFile: () => true }), mkdir: async () => {},
    mkdtemp: async prefix => `${prefix}fixed`, unlink: async () => {}, rmdir: async () => {},
  };
  const load = name => name === 'node:fs/promises' ? virtualFs
    : name === 'node:path' ? path.win32 : realRequire(name);
  new vm.Script(`(function(require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, { filename })
    .runInThisContext()(load, module, module.exports);
  const run = async (binary, args) => {
    commands.push({ binary, args: [...args] });
    const last = args.at(-1);
    if (args[0] === '-version') return { stdout: `${binary.endsWith('ffprobe.exe') ? 'ffprobe' : 'ffmpeg'} version golden\n`, stderr: '' };
    if (args.includes('lavfi')) {
      const count = Number(args[args.indexOf('-frames:v') + 1]);
      const pixelFormat = last.endsWith('-10.mkv') ? 'yuv420p10le' : 'yuv420p';
      files.set(last, { ...ordinaryProbe(pixelFormat).streams[0], index: 0, codec_name: 'ffv1',
        width: 320, height: 180, nb_read_frames: String(count) });
    } else if (args.includes('-c:v:0')) {
      const encoder = args[args.indexOf('-c:v:0') + 1];
      files.set(last, { ...files.get(args[args.indexOf('-i') + 1]),
        codec_name: encoder.includes('264') ? 'h264' : /265|hevc/.test(encoder) ? 'hevc' : 'av1' });
    } else if (args.includes('-show_streams')) {
      const stream = files.get(last);
      return { stdout: JSON.stringify({ streams: [stream], ...(args.includes('-show_frames') ? {
        frames: Array.from({ length: Number(stream.nb_read_frames) }, (_, i) => ({ pict_type: i % 5 ? 'B' : 'P' })),
      } : {}) }), stderr: '' };
    } else if (args.includes('null')) return {
      stdout: `frame=${files.get(args[args.indexOf('-i') + 1]).nb_read_frames}\nprogress=end\n`, stderr: '',
    };
    return { stdout: '', stderr: '' };
  };
  const result = await module.exports.checkCapabilities({ ffmpeg: 'X:\\golden\\ffmpeg.exe',
    ffprobe: 'X:\\golden\\ffprobe.exe', stateDir: 'X:\\golden\\state', run });
  return { commands, result };
}

async function captureOrdinary() {
  const descriptions = [], cases = [];
  const configurations = PROFILES.flatMap(profile => profile.presets.flatMap(preset =>
    [profile.quality.min, profile.quality.max, profile.quality.default].map(quality => ({ profileId: profile.id, preset, quality }))));
  configurations.push({ profileId: ARCHIVE_RECIPE.profileId, preset: ARCHIVE_RECIPE.preset,
    quality: ARCHIVE_RECIPE.quality, recipeId: ARCHIVE_RECIPE.id });
  for (const settings of configurations) {
    descriptions.push(describeRecipe(settings));
    const profile = PROFILES.find(row => row.id === settings.profileId);
    for (const pixelFormat of FORMATS.filter(format => format !== 'yuv444p' || profile.hardware === 'CPU')) {
      for (const variant of VARIANTS) {
        const probe = ordinaryProbe(pixelFormat, variant), color = classifyColor(probe);
        const item = { settings, pixelFormat, variant };
        try {
          const options = { input: 'X:\\golden\\input.mkv', output: 'X:\\golden\\output.mkv', settings,
            probe, colorEvidence: color, outputId: OUTPUT_ID };
          const args = buildEncodeArgs(options);
          const plan = buildEncodeOperation({ input: options.input, output: options.output, settings,
            inspection: { probe, color }, outputId: OUTPUT_ID,
            request: resolveFileRequest({ fileId: 'golden-file', identityRevision: 1, draftRevision: 1, operation: 'encode' }) });
          cases.push({ ...item, args, operationArgs: plan.args, planFingerprint: plan.planFingerprint, expectedOutput: plan.expectedOutput });
        } catch (error) {
          if (error.code !== 'UNSUPPORTED_PIXEL_FORMAT') throw error;
          cases.push({ ...item, error: { code: error.code, message: error.message } });
        }
      }
    }
  }
  return { version: 1, profiles: PROFILES, archive: ARCHIVE_RECIPE, descriptions, cases,
    preferences: defaultPreferences(), capabilities: await captureCapabilities() };
}

if (require.main === module) captureOrdinary().then(result => {
  fs.mkdirSync(path.resolve(__dirname, '../tests/fixtures'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../tests/fixtures/ordinary-argv-golden.json'), `${JSON.stringify(result)}\n`, { flag: 'wx' });
  console.log(`Captured ${result.cases.length} cases and ${result.capabilities.commands.length} fake capability calls.`);
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { captureOrdinary, ordinaryProbe };
