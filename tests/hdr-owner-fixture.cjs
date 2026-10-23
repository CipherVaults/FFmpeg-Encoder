'use strict';

// Deterministic contract data and mocked tool bytes only. No external process,
// codec, native device, display or runtime qualification is performed here.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { HdrOperations, fingerprintHdrProbe } = require('../src/hdr-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { describeRecipe, classifyColor } = require('../src/media.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../src/provenance.cjs');
const RUNTIME = 'a'.repeat(64), SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8388608, maxPcmBytes: 134217728, maxRecords: 20000, maxSpoolBytes: 33554432 });
const clone = value => structuredClone(value);
const sha = text => createHash('sha256').update(text).digest('hex');
const SOURCE_FILE_SHA256 = sha('owned-mocked-source');
const master = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
  blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const light = () => ({ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 });
function video(transfer = 'smpte2084') { return { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width: 320, height: 180,
  coded_width: 320, coded_height: 192, pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: transfer, color_primaries: 'bt2020',
  color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left', avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/1000', start_pts: 0,
  start_time: '0.000000', disposition: { default: 0, attached_pic: 0 }, tags: { ENCODER: 'Synthetic source description', DURATION: '00:00:03.200000000' } }; }
function frames(transfer = 'smpte2084') { return Array.from({ length: 96 }, (_, i) => ({ media_type: 'video', stream_index: 0,
  pts: Math.floor((i * 1000 + 15) / 30), best_effort_timestamp: Math.floor((i * 1000 + 15) / 30), duration: 33, width: 320, height: 180,
  pix_fmt: 'yuv420p10le', interlaced_frame: 0, repeat_pict: 0, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0,
  color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
  side_data_list: [...(i === 0 ? [{ side_data_type: 'H.26[45] User Data Unregistered SEI message' }, { side_data_type: 'H.26[45] User Data Unregistered SEI message' }] : []), master(), light()] })); }
function fixture(options = {}) {
  const transfer = options.transfer || 'smpte2084', identity = options.identity || { canonicalPath: 'F:\\synthetic-hdr\\source.mkv', dev: '1', ino: '2', size: '256', mtimeNs: '1000', ctimeNs: '1001', birthtimeNs: '900', sparseDigest: `sha256-sparse-v1:${'b'.repeat(64)}` };
  const probe = { streams: [video(transfer)], format: { format_name: 'matroska,webm', duration: '3.200000', start_time: '0.000000', size: identity.size, nb_streams: 1,
    nb_programs: 0, nb_stream_groups: 0, tags: { ENCODER: 'Synthetic container description' } }, chapters: [], programs: [], stream_groups: [] };
  options.changeProbe?.(probe);
  const request = resolveFileRequest({ fileId: options.fileId || 'synthetic-hdr-file', identityRevision: 1, draftRevision: options.revision || 1, operation: 'encode' });
  const settings = clone(SETTINGS), recipe = describeRecipe(settings), generationDescription = { version: 1, profileId: settings.profileId, codec: recipe.codec, backend: recipe.backend,
    encoder: recipe.encoder, preset: settings.preset, qualityMode: recipe.qualityMode, quality: settings.quality, bitDepth: 10, encoderArgs: recipe.args,
    appVersion: '0.7.0-alpha.1', createdAt: '2026-10-23T07:15:00.000Z' };
  const policies = ['smpte2084', 'arib-std-b67'].map((tr, i) => ({ id: `synthetic-hdr-${i}`, transfer: tr, evidenceIds: [`synthetic-lifecycle-${i}`], runtimeIdentity: RUNTIME,
    sourceSha256: SOURCE_FILE_SHA256 }));
  const owner = options.owner || new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-only-hdr-policy', policies: options.empty ? [] : policies });
  const sourceFrames = frames(transfer), frameEvidence = { videoIndex: 0, coverage: 'sampled', decodedFrameCount: 61, decodeExitCode: 0, frames: sourceFrames.slice(0, 61) };
  const outputId = options.outputId || randomUUID(), prepare = { input: identity.canonicalPath, output: options.destination || 'F:\\synthetic-hdr-output\\destination.mkv', outputId,
    sourceIdentity: identity, sourceFileSha256: SOURCE_FILE_SHA256, request, settings, inspection: { probe, color: classifyColor(probe), duration: 3.2 }, frameEvidence, generationDescription };
  options.changePrepare?.(prepare);
  const plan = options.noPrepare ? null : owner.prepare(prepare), bindings = { plan, settings: clone(settings), sourceIdentity: identity,
    sourceProbeFingerprint: fingerprintHdrProbe(probe), runtimeIdentity: RUNTIME, environment: null, budget: clone(BUDGET), executionBudgetMs: 600000 };
  const outputProbe = clone(probe); outputProbe.format.tags = { ...outputProbe.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: outputId, [GENERATION_KEY]: JSON.stringify(generationDescription) };
  outputProbe.streams[0].tags.ENCODER = 'Synthetic encoded description';
  return { owner, policies, identity, request, settings, probe, prepare, plan, bindings, sourceFrames, outputProbe, outputId, generationDescription };
}
async function acquired(t, changes = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hdr-owner-test-')), input = path.join(root, 'source.mkv'), output = path.join(root, 'staged.mkv'), stageDirectory = path.join(root, 'evidence');
  await fs.mkdir(stageDirectory); await fs.writeFile(input, 'owned-mocked-source'); await fs.writeFile(output, 'owned-mocked-output');
  const h = fixture({ identity: await readSourceIdentity(input), destination: path.join(root, 'destination.mkv'), ...changes.fixture });
  h.owner.select(h.bindings);
  const telemetry = await createOperationTelemetry({ stageDirectory, runtimeIdentity: RUNTIME, planFingerprint: h.plan.planFingerprint, streams: h.plan.instrumentation.streams });
  await assertTelemetryReady(telemetry); h.owner.resolveInvocation(h.plan, { output, telemetry });
  const rows = h.sourceFrames.map((f, i) => `ffet1\tv\t0\t0\t${i}\t${i}\t1/1000\t${f.pts}\t1/1000\t${f.pts}\n`);
  changes.telemetry?.(rows); await fs.writeFile(telemetry.streams[0].path, rows.join(''));
  const telemetryReceipt = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false } });
  let active = false, calls = [];
  async function run(executable, args, options) {
    if (active) throw new Error('Overlapping mocked collector invocation.'); active = true;
    try {
      const file = args[args.indexOf('-i') + 1], side = file === input ? 'source' : file === output ? 'container' : 'bitstream';
      const call = { executable, args, side, ordinal: calls.length }; calls.push(call);
      let bytes;
      if (executable.endsWith('ffprobe.exe')) {
        const observed = clone(h.sourceFrames), v = clone(h.outputProbe.streams[0]);
        if (side === 'source') Object.assign(v, clone(h.probe.streams[0]));
        if (side === 'bitstream') { v.time_base = '1/1200000'; v.avg_frame_rate = '25/1'; delete v.start_pts; delete v.start_time; v.field_order = 'unknown';
          observed.forEach(f => { delete f.pts; delete f.best_effort_timestamp; f.duration = 40000; }); }
        changes.frames?.(observed, call); const payload = side === 'bitstream' ? { frames: observed, streams: [v], programs: [], stream_groups: [] } : { frames: observed };
        bytes = Buffer.from(JSON.stringify(payload));
      } else if (args.includes('framehash')) bytes = Buffer.from('#format: frame checksums\n#hash: SHA256\n' + h.sourceFrames.map((_, i) => `0, ${i}, ${i}, 1, 172800, ${sha(`${side === 'source' ? 'source' : 'encoded'}-${i}`)}\n`).join(''));
      else bytes = Buffer.from('mock-distinct-elementary-payload');
      await options.onStdoutChunk(bytes);
      return { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { streamed: true, truncated: false, totalBytes: bytes.length }, stderrCapture: { truncated: false, totalBytes: 0 } };
    } finally { active = false; }
  }
  const options = { plan: h.plan, runtimeIdentity: RUNTIME, outputId: h.outputId, sourceProbe: h.probe, outputProbe: h.outputProbe,
    sourcePath: input, outputPath: output, stageDirectory, ffmpeg: path.join(root, 'ffmpeg.exe'), ffprobe: path.join(root, 'ffprobe.exe'), run, budget: clone(BUDGET) };
  t?.diagnostic(`Retained mocked owner/collector evidence: ${root}`);
  return { ...h, root, input, output, stageDirectory, telemetry, telemetryReceipt, calls, collectionOptions: options };
}
module.exports = { RUNTIME, SETTINGS, BUDGET, SOURCE_FILE_SHA256, fixture, acquired, frames, video, master, light, clone };
