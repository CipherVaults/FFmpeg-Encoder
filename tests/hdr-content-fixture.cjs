'use strict';

// Synthetic compressed bytes and mocked actual-child events only. The real
// parser/observer/owner are used without replacement or fabricated brands.
// Parameter-set templates below are structural unit data, never native media
// qualification profiles. No tool, codec, GPU or application is executed.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { observeHdrInput, getObservedHdrInput } = require('../src/hdr-input.cjs');
const { canonicalHevcNal } = require('../src/hevc-content.cjs');
const { HdrOperations, fingerprintHdrProbe } = require('../src/hdr-operation.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { describeRecipe, classifyColor, PROFILES } = require('../src/media.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { syntheticContainer } = require('./hdr-container-fixture.cjs');
const RUNTIME = 'a'.repeat(64), SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8388608, maxPcmBytes: 134217728, maxRecords: 20000, maxSpoolBytes: 33554432 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), clone = value => structuredClone(value);
function escape(bytes) { const result = [...bytes.subarray(0, 2)]; let zeros = 0;
  for (const byte of bytes.subarray(2)) { if (zeros >= 2 && byte <= 3) { result.push(3); zeros = 0; } result.push(byte); zeros = byte === 0 ? zeros + 1 : 0; } return Buffer.from(result); }
function nal(type, body = [128]) { return escape(Buffer.from([type << 1, 1, ...body])); }
function variable(value) { const bytes = []; while (value >= 255) { bytes.push(255); value -= 255; } bytes.push(value); return bytes; }
function sei(messages) { return nal(39, [...messages.flatMap(([type, bytes]) => [...variable(type), ...variable(bytes.length), ...bytes]), 128]); }
function header() { const bytes = Buffer.alloc(22); bytes[0] = 1; bytes[1] = 2; bytes[13] = 0xf0; bytes[15] = 0xfc; bytes[16] = 0xfd; bytes[17] = bytes[18] = 0xfa; bytes[21] = 15; return bytes; }
function parameterSets() { return [nal(32, [1, 128]), nal(33, [2, 128]), nal(34, [192])]; }
function masteringBytes() { const bytes = Buffer.alloc(24); [13250, 34500, 7500, 3000, 34000, 16000, 15635, 16450].forEach((value, index) => bytes.writeUInt16BE(value, index * 2)); bytes.writeUInt32BE(40000000, 16); bytes.writeUInt32BE(2, 20); return bytes; }
function lightBytes(maximum = 2000, average = 500) { const bytes = Buffer.alloc(4); bytes.writeUInt16BE(maximum); bytes.writeUInt16BE(average, 2); return bytes; }
const master = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
  blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '2/10000', max_luminance: '4000/1' });
const light = (maximum = 2000, average = 500) => ({ side_data_type: 'Content light level metadata', max_content: maximum, max_average: average });
function extraData(messages) { const sets = parameterSets(), chunks = [header(), Buffer.from([messages.length ? 4 : 3])];
  for (const [type, values] of [[32, [sets[0]]], [33, [sets[1]]], [34, [sets[2]]], ...messages.length ? [[39, [sei(messages)]]] : []]) {
    const array = Buffer.alloc(3); array[0] = type; array.writeUInt16BE(values.length, 1); chunks.push(array);
    for (const value of values) { const size = Buffer.alloc(2); size.writeUInt16BE(value.length); chunks.push(size, value); }
  } return Buffer.concat(chunks); }
function packet(index, content = 7) { const bytes = nal(index === 0 ? 20 : 1, [index === 0 ? 160 : 192, content, 128]), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); return Buffer.concat([size, bytes]); }
function generation() { const recipe = describeRecipe(SETTINGS); return { version: 1, profileId: SETTINGS.profileId, codec: recipe.codec, backend: recipe.backend,
  encoder: recipe.encoder, preset: SETTINGS.preset, qualityMode: recipe.qualityMode, quality: SETTINGS.quality, bitDepth: 10, encoderArgs: recipe.args,
  appVersion: '0.7.0-alpha.1', createdAt: '2026-10-23T10:00:00.000Z' }; }
async function contentFixture(t, changes = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hdr-content-owner-'));
  const inputDirectory = path.join(directory, 'input'), outputDirectory = path.join(directory, 'output');
  await fs.mkdir(inputDirectory); await fs.mkdir(outputDirectory);
  const sourcePath = path.join(inputDirectory, 'source.mkv');
  const width = changes.width ?? 1280, height = changes.height ?? 720, count = changes.count ?? 12, rate = changes.rate ?? 30, transfer = changes.transfer ?? 'smpte2084';
  const mode = changes.metadata ?? 'none', hasMaster = ['master', 'both'].includes(mode), hasLight = ['light', 'both'].includes(mode), sampleAspectRatio = width === 320 ? null : '1:1';
  const lightLevels = changes.lightLevels ?? [2000, 500];
  const sets = parameterSets();
  const profile = { id: `synthetic-reviewed-${width}-${height}-${rate}-${transfer}`, width, height, frameRate: rate + '/1', transfer, sampleAspectRatio,
    hvccHeader: header().toString('base64'), parameterSets: Object.fromEntries(['vps', 'sps', 'pps'].map((name, index) => [name, canonicalHevcNal(sets[index]).toString('base64')])) };
  const profiles = [profile];
  const frames = Array.from({ length: count }, (_, index) => ({ media_type: 'video', stream_index: 0, pts: Math.round(index * 1000 / rate), best_effort_timestamp: Math.round(index * 1000 / rate),
    duration: Math.floor(1000 / rate), width, height, pix_fmt: 'yuv420p10le', interlaced_frame: 0, top_field_first: 0, repeat_pict: 0,
    crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0, color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
    ...(sampleAspectRatio ? { sample_aspect_ratio: sampleAspectRatio } : {}), side_data_list: [...hasMaster ? [master()] : [], ...hasLight ? [light(...lightLevels)] : []] }));
  const end = frames.at(-1).pts + frames.at(-1).duration;
  const declared = changes.declaredDurationTicks ?? String(end);
  let bytes = syntheticContainer({ frameRate: rate + '/1', declaredDurationTicks: changes.rawDeclaredDurationTicks ?? declared,
    payload: 'Owned synthetic source identity ' + randomUUID(), ...changes.container });
  bytes = changes.containerBytes?.(bytes) ?? bytes; await fs.writeFile(sourcePath, bytes);
  const video = { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width, height, coded_width: width, coded_height: height,
    pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
    time_base: '1/1000', start_pts: 0, start_time: '0.000000', avg_frame_rate: rate + '/1', r_frame_rate: rate + '/1', disposition: { default: 0, attached_pic: 0 },
    ...(sampleAspectRatio ? { sample_aspect_ratio: sampleAspectRatio } : {}), tags: { ENCODER: 'Synthetic byte capture' } };
  const probe = { streams: [video], format: { format_name: 'matroska,webm', size: String(bytes.length), duration: (Number(declared) / 1000).toFixed(6), start_time: '0.000000',
    nb_streams: 1, nb_programs: 0, nb_stream_groups: 0, tags: { ENCODER: 'Synthetic container' } }, chapters: [], programs: [], stream_groups: [] };
  const metadataMessages = [...hasMaster ? [[137, masteringBytes()]] : [], ...hasLight ? [[144, lightBytes(...lightLevels)]] : [], ...transfer === 'arib-std-b67' ? [[147, Buffer.from([18])]] : []];
  const extra = extraData(metadataMessages), calls = []; let live = 0;
  // Ordinary inspection already reports these seals. Complete packet capture
  // adds the bytes, rather than inventing a different source-probe identity.
  Object.assign(video, { extradata_size: extra.length, extradata_hash: 'SHA256:' + sha(extra) });
  const identity = await readSourceIdentity(sourcePath);
  const bindings = { sourcePath, sourceIdentity: identity, probe, runtimeIdentity: RUNTIME, profiles };
  async function run(executable, args, options) {
    assert.equal(live, 0); assert.equal(executable, path.join(directory, 'fixed-ffprobe.exe')); assert.equal(args.at(-1), sourcePath);
    assert.ok(!args.includes('-read_intervals')); const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); live++;
    options.onChild(child); const kind = args.includes('-show_packets') ? 'packets' : 'frames', call = { index: calls.length, kind, args }; calls.push(call);
    try {
      const payload = kind === 'packets' ? { streams: [{ ...clone(video), extradata: extra.toString('base64'), extradata_size: extra.length, extradata_hash: 'SHA256:' + sha(extra) }],
        packets: frames.map((_, index) => { const data = packet(index, changes.content ?? 7); return { stream_index: 0, size: data.length, data: data.toString('base64'), data_hash: 'SHA256:' + sha(data) }; }) } : { frames: clone(frames) };
      changes.capture?.(payload, call); const output = Buffer.from(JSON.stringify(payload));
      await options.onStdoutChunk(output.subarray(0, 79)); await options.onStdoutChunk(output.subarray(79)); await changes.during?.(call, { sourcePath });
      child.stdout.emit('end'); child.stderr.emit('end'); live--; child.emit('close', 0, null);
      return { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { streamed: true, totalBytes: output.length, truncated: false }, stderrCapture: { totalBytes: 0, truncated: false } };
    } catch (error) { child.stdout.emit('end'); child.stderr.emit('end'); live--; child.emit('close', 1, null); throw error; }
  }
  const options = { ...bindings, ffprobe: path.join(directory, 'fixed-ffprobe.exe'), run };
  const policy = { id: 'synthetic-content-' + transfer, transfer, evidenceIds: ['synthetic-content-qualification-only'], runtimeIdentity: RUNTIME, profiles, outputProfiles: clone(profiles) };
  const owner = changes.owner ?? new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-content-owner', policies: [policy] });
  const request = resolveFileRequest({ fileId: changes.fileId ?? 'synthetic-content-file', identityRevision: 1, draftRevision: 1, operation: 'encode' });
  const inspection = { probe, color: classifyColor(probe), duration: Number(declared) / 1000, summary: { durationSeconds: Number(declared) / 1000 } };
  let receipt;
  const observe = async () => { receipt = await observeHdrInput(options); return receipt; };
  const prepared = (overrides = {}) => ({ input: sourcePath, output: path.join(outputDirectory, 'result.mkv'), outputId: randomUUID(), sourceIdentity: identity,
    sourceFileSha256: sha(bytes), request, settings: clone(SETTINGS), inspection: clone(inspection), frameEvidence: { videoIndex: 0, coverage: 'sampled', decodedFrameCount: count, decodeExitCode: 0, frames: clone(frames.slice(0, 256)) },
    generationDescription: generation(), inputReceipt: receipt, ...overrides });
  const selectBindings = plan => ({ plan, settings: clone(SETTINGS), sourceIdentity: identity, sourceProbeFingerprint: fingerprintHdrProbe(probe), runtimeIdentity: RUNTIME, environment: null, budget: clone(BUDGET), executionBudgetMs: 600000 });
  const context = { hdrOperations: owner, operationStorage: true, operationTelemetry: true, operationEvidenceBudget: clone(BUDGET), operationDeadlineMs: 600000,
    runtimeIdentity: RUNTIME, ffprobe: options.ffprobe, plan: { entries: new Map(), overrides: new Map(), ambiguities: new Set() },
    operationRuntime: { async observe() { return Object.freeze({}); }, snapshot() { return { runtimeIdentity: RUNTIME, environment: null }; },
      async invoke(_token, tool, args, opts) { assert.equal(tool, 'ffprobe'); return run(options.ffprobe, args, opts); } } };
  t?.diagnostic('Retained synthetic content-owner fixture: ' + directory);
  return { directory, inputDirectory, outputDirectory, sourcePath, bytes, identity, profiles, profile, frames, video, probe, bindings, options, owner, policy, request, inspection, calls,
    observe, get: observed => getObservedHdrInput(observed ?? receipt, bindings), prepared, selectBindings, context,
    workspaceOptions: { file: sourcePath, destination: path.join(outputDirectory, 'result.mkv'), inspection, identity, marker: {}, settings: clone(SETTINGS),
      caps: { profiles: PROFILES.map(value => ({ ...value, available: true, supportedBitDepths: [8, 10] })), versions: { ffmpeg: 'mocked fixed runtime' } } }, live: () => live };
}
module.exports = { contentFixture, RUNTIME, SETTINGS, BUDGET, clone, sha, packet, sei, nal, master, light };
