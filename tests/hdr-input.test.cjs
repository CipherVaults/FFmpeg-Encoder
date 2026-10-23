'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { inspectHdrContainer } = require('../src/hdr-container.cjs');
const { syntheticContainer } = require('./hdr-container-fixture.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value), RUNTIME = 'a'.repeat(64);
const mastering = () => ({ red_x: '34000/50000', red_y: '16000/50000', green_x: '13250/50000', green_y: '34500/50000',
  blue_x: '7500/50000', blue_y: '3000/50000', white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });

// Test the acquisition trust boundary with mock child events/bytes. The parser
// has an independent pure suite; these tests do not execute a media binary.
async function load(parser) {
  const filename = path.resolve(__dirname, '../src/hdr-input.cjs'), source = await fs.readFile(filename, 'utf8');
  const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = Module.createRequire(filename);
  fixture.require = name => name === './hevc-content.cjs' ? { classifyHevcPackets: parser } : originalRequire(name);
  fixture._compile(source, filename); return fixture.exports;
}
async function setup(t, changes = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hdr-input-test-')), sourcePath = path.join(root, 'owned-mock.mkv');
  const width = changes.width ?? 320, height = changes.height ?? 180, count = changes.count ?? 96, rate = changes.rate ?? 30;
  const metadata = changes.metadata ?? { mastering: mastering(), contentLight: { max_content: 1000, max_average: 400 } };
  const video = { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10', width, height, coded_width: width, coded_height: height,
    pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: changes.transfer ?? 'smpte2084', color_primaries: 'bt2020', color_space: 'bt2020nc',
    color_range: 'tv', chroma_location: 'left', time_base: '1/1000', start_pts: 0, start_time: '0.000000', avg_frame_rate: `${rate}/1`, r_frame_rate: `${rate}/1`,
    disposition: { default: 0, attached_pic: 0 }, tags: { ENCODER: 'Mocked descriptive source label' } };
  if (width !== 320 || height !== 180 || changes.square) video.sample_aspect_ratio = '1:1';
  const frames = Array.from({ length: count }, (_, index) => ({ media_type: 'video', stream_index: 0, pts: Math.round(index * 1000 / rate),
    best_effort_timestamp: Math.round(index * 1000 / rate), duration: Math.floor(1000 / rate), width, height, pix_fmt: 'yuv420p10le', interlaced_frame: 0,
    top_field_first: 0, repeat_pict: 0, crop_top: 0, crop_bottom: 0, crop_left: 0, crop_right: 0,
    color_transfer: video.color_transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
    ...(video.sample_aspect_ratio ? { sample_aspect_ratio: video.sample_aspect_ratio } : {}),
    side_data_list: [...metadata.mastering ? [{ side_data_type: 'Mastering display metadata', ...metadata.mastering }] : [],
      ...metadata.contentLight ? [{ side_data_type: 'Content light level metadata', ...metadata.contentLight }] : []] }));
  const end = frames.at(-1).pts + frames.at(-1).duration;
  const declared = changes.declaredDurationTicks ?? String(end);
  // Cost-refusal fixtures can declare more than sixty seconds in the probe;
  // their scalar wrapper remains bounded so the compressed cost gate is tested.
  let bytes = syntheticContainer({ frameRate: `${rate}/1`, declaredDurationTicks: changes.rawDeclaredDurationTicks ?? String(Math.min(Number(declared), 60000)),
    payload: 'owned mocked compressed bytes, never a real media fixture', ...changes.container });
  bytes = changes.containerBytes?.(bytes) ?? bytes; await fs.writeFile(sourcePath, bytes);
  const probe = { streams: [video], format: { format_name: 'matroska,webm', size: String(bytes.length), duration: (Number(declared) / 1000).toFixed(6), start_time: '0.000000' },
    chapters: [], programs: [], stream_groups: [] };
  const profiles = [{ id: 'mocked-reviewed-configuration', width, height, frameRate: `${rate}/1`, transfer: video.color_transfer,
    sampleAspectRatio: video.sample_aspect_ratio ?? null,
    hvccHeader: 'mocked-template', parameterSets: { vps: 'mocked-vps', sps: 'mocked-sps', pps: 'mocked-pps' } }];
  const calls = [], parserCalls = [], controller = new AbortController();
  const api = await load((payload, options) => {
    parserCalls.push({ payload, options }); changes.parse?.(payload, options);
    assert.deepEqual(options.profiles, profiles); assert.equal(options.transfer, video.color_transfer);
    const classified = { version: 1, configuration: Object.freeze({ id: profiles[0].id, digest: 'b'.repeat(64), width, height,
      frameRate: `${rate}/1`, transfer: video.color_transfer, sampleAspectRatio: video.sample_aspect_ratio ?? null }), transfer: video.color_transfer, metadata: clone(metadata), alternativeTransfer: null,
      pictureCount: count, packetCount: count, packetInventory: [{ index: 0, size: bytes.length }], nalInventory: [{ type: 1, count: count }], fingerprint: 'c'.repeat(64), warnings: [] };
    changes.classified?.(classified); return Object.freeze(classified);
  });
  let live = 0;
  async function run(executable, args, options) {
    assert.equal(live, 0); assert.equal(executable, path.join(root, 'fixed-ffprobe.exe')); assert.equal(args.at(-1), sourcePath);
    assert.ok(!args.includes('-read_intervals') && !args.includes('-t') && !args.includes('-ss')); assert.equal(args[args.indexOf('-v') + 1], 'error');
    assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe'); assert.equal(args[args.indexOf('-format_whitelist') + 1], 'matroska,webm');
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 120000); assert.equal(options.stderrLimit, 262144);
    const number = calls.length, child = new EventEmitter(), call = { args, options, number, child }; calls.push(call); live++;
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    options.onChild(child);
    let payload;
    if (number === 0) { assert.ok(args.includes('-show_packets') && args.includes('-show_data') && args.includes('base64') && args.includes('sha256'));
      payload = { streams: [clone(video)], packets: [{ stream_index: 0, size: String(bytes.length), data: '\n' + bytes.toString('base64') + '\n', data_hash: 'SHA256:' + sha(bytes) }] };
    } else { assert.ok(args.includes('-show_frames') && args.includes('-show_entries')); payload = { frames: clone(frames) }; }
    changes.payload?.(payload, call); let captured = Buffer.from(JSON.stringify(payload)); captured = changes.bytes?.(captured, call) ?? captured;
    try {
      const split = Math.min(53, captured.length); await options.onStdoutChunk(captured.subarray(0, split)); await options.onStdoutChunk(captured.subarray(split));
      await changes.mutate?.(call, { sourcePath, root, controller, probe, profiles });
      if (!changes.noStdoutEnd) child.stdout.emit('end'); if (!changes.noStderrEnd) child.stderr.emit('end');
      if (changes.pipeError) child.stdout.emit('error', new Error('mock owned stdout error'));
      if (changes.premature && number === 0) {
        options.signal.addEventListener('abort', () => { live--; child.emit('close', 0, null); }, { once: true });
      } else { live--; if (!changes.noChildClose) child.emit('close', 0, null); }
      const result = { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { totalBytes: captured.length, truncated: false, streamed: true }, stderrCapture: { totalBytes: 0, truncated: false } };
      return changes.result?.(result, call) ?? result;
    } catch (error) { if (live) { live--; child.emit('close', null, 'SIGTERM'); } throw error; }
  }
  const sourceIdentity = await readSourceIdentity(sourcePath), bindings = { sourcePath, sourceIdentity, probe, runtimeIdentity: RUNTIME, profiles };
  const options = { ...bindings, ffprobe: path.join(root, 'fixed-ffprobe.exe'), run, signal: controller.signal };
  t.diagnostic(`Retained mock input: ${root}`);
  return { api, options, bindings, calls, parserCalls, frames, probe, profiles, controller, sourcePath,
    observe: changed => api.observeHdrInput({ ...options, ...changed }), get: receipt => api.getObservedHdrInput(receipt, bindings), live: () => live };
}

for (const transfer of ['smpte2084', 'arib-std-b67']) test(`complete ${transfer} input observation brands exactly two closed sequential captures and source seals`, async t => {
  const s = await setup(t, { transfer }), receipt = await s.observe(), data = s.get(receipt);
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.qualificationGranted, false); assert.equal(receipt.publicationAuthorized, false);
  assert.equal(s.calls.length, 2); assert.equal(s.parserCalls.length, 1); assert.equal(s.live(), 0);
  assert.equal(data.frames.length, 96); assert.equal(data.frameCount, 96); assert.equal(data.timeline.endPts, '3200');
  assert.equal(data.sourceSealBefore.digest, sha(await fs.readFile(s.sourcePath))); assert.deepEqual(data.sourceSealBefore, data.sourceSealAfter);
  assert.equal(data.sourceFileSha256, data.sourceSealAfter.digest); assert.equal(Object.isFrozen(data.frames[0].side_data_list), true);
  assert.equal(Object.hasOwn(receipt, 'frames'), false, 'Public diagnostic receipt does not duplicate all frame observations.');
  assert.equal(data.captures.every(value => value.childClosed && value.stdoutDrained && value.bytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256)), true);
});

test('1800-frame legacy source passes complete bounds without the writer 256-frame snapshot limit', async t => {
  const s = await setup(t, { count: 1800, metadata: { mastering: null, contentLight: null } }), receipt = await s.observe();
  assert.equal(s.get(receipt).frames.length, 1800); assert.equal(s.get(receipt).timeline.endPts, '60000'); assert.equal(s.calls.length, 2);
});
for (const spec of [{ width: 1280, height: 720, count: 900 }, { width: 1920, height: 1080, count: 400, rate: 24 }])
  test(`reviewed ${spec.width}x${spec.height} reaches exact pixel-frame ceiling`, async t => {
    const s = await setup(t, { ...spec, metadata: { mastering: null, contentLight: { max_content: 0, max_average: 0 } } });
    assert.equal(s.get(await s.observe()).pixelFrames, 829440000);
  });

for (const declaredDurationTicks of ['16666', '16667']) test(`24fps complete observation freezes exact header ${declaredDurationTicks} independently of native end16666`, async t => {
  const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24, declaredDurationTicks });
  const receipt = await s.observe(), data = s.get(receipt);
  assert.equal(data.timeline.records, 400); assert.equal(data.timeline.endPts, '16666');
  assert.equal(data.timeline.rows.at(-1).pts, '16625'); assert.equal(data.timeline.rows.at(-1).duration, '41');
  assert.equal(data.containerTiming.declaredDurationTicks, declaredDurationTicks);
  assert.equal(data.containerTiming.nativeEndTicks, '16666'); assert.equal(data.containerTiming.sourceOutputToleranceTicks, '0');
  assert.equal(data.containerTiming.headerRepresentation, declaredDurationTicks === '16666' ? 'native-end' : 'ceil-period-header');
  assert.equal(data.containerTiming.timestampScaleNs, '1000000'); assert.equal(data.containerTiming.defaultDurationNs, '41666666');
  assert.equal(data.sourceFileSha256, sha(await fs.readFile(s.sourcePath))); assert.equal(s.calls.length, 2); assert.equal(s.live(), 0);
});

for (const declaredDurationTicks of ['16665', '16668']) test(`source header ${declaredDurationTicks} outside exact24fps low/high states refuses a receipt`, async t => {
  const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24, declaredDurationTicks });
  await assert.rejects(s.observe(), { code: 'HDR_INPUT_DURATION' }); assert.equal(s.calls.length, 2); assert.equal(s.live(), 0);
});

test('raw Segment header must equal the independently reported container duration', async t => {
  const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24, declaredDurationTicks: '16666', rawDeclaredDurationTicks: '16667' });
  await assert.rejects(s.observe(), error => error.code === 'HDR_INPUT_DURATION' && /raw Segment duration contradicts/.test(error.message));
  assert.equal(s.calls.length, 2); assert.equal(s.live(), 0);
});

for (const container of [{ defaultDurationNs: '41666667' }, { timestampScaleNs: '1000001' }])
  test(`raw one-nanosecond clock change ${JSON.stringify(container)} refuses before any child`, async t => {
    const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24, container });
    await assert.rejects(s.observe(), { code: 'HDR_CONTAINER_TIMING' }); assert.equal(s.calls.length, 0); assert.equal(s.parserCalls.length, 0); assert.equal(s.live(), 0);
  });

test('nonintegral raw Segment duration refuses before any child even when the reported duration is integral', async t => {
  let patched = false;
  const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24, containerBytes(bytes) {
    const { offset, bytes: width } = inspectHdrContainer(bytes, { frameRate: '24/1' }).origins.declaredDurationTicks;
    assert.equal(width, 8); bytes.writeDoubleBE(16666.5, offset); patched = true; return bytes;
  } });
  await assert.rejects(s.observe(), { code: 'HDR_CONTAINER_TIMING' }); assert.equal(patched, true); assert.equal(s.calls.length, 0); assert.equal(s.live(), 0);
});

test('an explicitly disabled raw video track refuses before any child despite an ordinary decoded probe', async t => {
  const s = await setup(t, { container: { trackEnabled: '0' } });
  assert.equal(s.probe.streams.length, 1); assert.equal(s.probe.streams[0].codec_type, 'video');
  await assert.rejects(s.observe(), { code: 'HDR_CONTAINER_TRACK_DISABLED' }); assert.equal(s.calls.length, 0); assert.equal(s.live(), 0);
});

test('a valid neighboring header and new current identity cannot renew the earlier complete receipt', async t => {
  const s = await setup(t, { width: 1920, height: 1080, count: 400, rate: 24 }), receipt = await s.observe();
  const bytes = await fs.readFile(s.sourcePath), origin = inspectHdrContainer(bytes, { frameRate: '24/1' }).origins.declaredDurationTicks;
  bytes.writeDoubleBE(16667, origin.offset); await fs.writeFile(s.sourcePath, bytes);
  const changedProbe = clone(s.probe); changedProbe.format.duration = '16.667000';
  const changedBindings = { ...s.bindings, sourceIdentity: await readSourceIdentity(s.sourcePath), probe: changedProbe };
  assert.equal(inspectHdrContainer(bytes, { frameRate: '24/1' }).declaredDurationTicks, '16667');
  assert.throws(() => s.api.getObservedHdrInput(receipt, changedBindings), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  await assert.rejects(s.observe(), { code: 'INPUT_CHANGED' }); assert.equal(s.calls.length, 2); assert.equal(s.live(), 0);
});

test('clones and changed path/source identity/probe/runtime/profile bindings cannot regain receipt authority', async t => {
  const s = await setup(t), receipt = await s.observe();
  assert.throws(() => s.api.getObservedHdrInput(clone(receipt), s.bindings), { code: 'HDR_INPUT_RECEIPT_REQUIRED' });
  const variants = [{ runtimeIdentity: 'f'.repeat(64) }, { sourceIdentity: { ...s.bindings.sourceIdentity, mtimeNs: '1' } },
    { probe: { ...clone(s.probe), format: { ...s.probe.format, duration: '3.100000' } } },
    { profiles: [{ ...clone(s.profiles[0]), id: 'different-reviewed-profile' }] }];
  for (const variant of variants) assert.throws(() => s.api.getObservedHdrInput(receipt, { ...s.bindings, ...variant }), /changed/);
  assert.equal(s.api.getObservedHdrInput(receipt, clone(s.bindings)), s.get(receipt), 'Matching inert copies preserve descriptive binding equality.');
  assert.throws(() => s.api.getObservedHdrInput(receipt, { ...s.bindings, sourcePath: path.join(path.dirname(s.sourcePath), 'different.mkv') }), /canonical/);
  let accessed = false; const accessor = { ...s.options }; Object.defineProperty(accessor, 'profiles', { enumerable: true, get() { accessed = true; return s.profiles; } });
  await assert.rejects(s.api.observeHdrInput(accessor), /accessors/); assert.equal(accessed, false);
});

test('unknown complete compressed payload refuses before the frame child', async t => {
  const s = await setup(t, { parse() { throw Object.assign(new Error('Unknown late suffix functional payload'), { code: 'HEVC_CONTENT_UNSUPPORTED' }); } });
  await assert.rejects(s.observe(), { code: 'HEVC_CONTENT_UNSUPPORTED' }); assert.equal(s.calls.length, 1); assert.equal(s.live(), 0);
});

for (const field of ['pictureCount', 'packetCount']) test(`complete ${field} disagrees before decoding and refuses authority`, async t => {
  const s = await setup(t, { classified(value) { value[field]--; } }); await assert.rejects(s.observe(), { code: 'HDR_INPUT_COUNT' });
  assert.equal(s.calls.length, 1); assert.equal(s.live(), 0);
});

for (const [name, mutate] of [
  ['late unknown functional side-data', frames => frames.at(-1).side_data_list.push({ side_data_type: 'Unclassified proprietary data' })],
  ['last-frame mastering change', frames => { frames.at(-1).side_data_list[0].max_luminance = '4000/1'; }],
  ['missing static metadata', frames => { frames[0].side_data_list = []; }],
  ['chunk-boundary signal change', frames => { frames[256].color_transfer = 'arib-std-b67'; }],
  ['one native PTS tick', frames => { frames.at(-1).pts++; frames.at(-1).best_effort_timestamp++; }],
  ['one native duration tick', frames => { frames.at(-1).duration++; }],
  ['source orientation', frames => { frames[0].side_data_list.push({ side_data_type: 'Display Matrix', rotation: -90 }); }],
  ['non-square decoded SAR', frames => { frames[0].sample_aspect_ratio = '4:3'; }],
]) test(`${name} refuses complete input eligibility`, async t => {
  const s = await setup(t, { count: 300, payload(value, call) { if (call.number === 1) mutate(value.frames); } });
  await assert.rejects(s.observe()); assert.equal(s.calls.length, 2); assert.equal(s.live(), 0);
});

test('source changed after complete packet capture refuses before a second child', async t => {
  const s = await setup(t, { async mutate(call, { sourcePath }) { if (call.number === 0) await fs.appendFile(sourcePath, 'owned-negative-change'); } });
  await assert.rejects(s.observe(), /changed/); assert.equal(s.calls.length, 1); assert.equal(s.live(), 0);
});

for (const [name, result] of [
  ['truncated stdout', value => ({ ...value, stdoutCapture: { ...value.stdoutCapture, truncated: true } })],
  ['unaccounted stdout', value => ({ ...value, stdoutCapture: { ...value.stdoutCapture, totalBytes: value.stdoutCapture.totalBytes + 1 } })],
  ['nonstreaming stdout', value => ({ ...value, stdout: '{}', stdoutCapture: undefined })],
  ['warning diagnostics', value => ({ ...value, stderr: 'warning', stderrCapture: { totalBytes: 7, truncated: false } })],
  ['incomplete diagnostics', value => ({ ...value, stderrCapture: { totalBytes: 0, truncated: true } })],
]) test(`${name} cannot grant input authority`, async t => {
  const s = await setup(t, { result }); await assert.rejects(s.observe()); assert.equal(s.calls.length, 1); assert.equal(s.live(), 0);
});

test('malformed/duplicate JSON and incomplete UTF-8 refuse canonical EOF', async t => {
  for (const bytes of [Buffer.from('{"streams":[],"streams":[]}'), Buffer.from('{"streams":'), Buffer.from([123, 34, 255, 34, 58, 48, 125])]) {
    const s = await setup(t, { bytes: () => bytes }); await assert.rejects(s.observe()); assert.equal(s.calls.length, 1);
  }
});

test('over-limit pixel work, duration and frame counts remain conjunctive', async t => {
  for (const spec of [{ width: 1920, height: 1080, count: 401 }, { count: 1801 }, { count: 1800, rate: 24 }]) {
    const s = await setup(t, spec); await assert.rejects(s.observe(), { code: 'HDR_INPUT_LIMIT' }); assert.equal(s.live(), 0);
  }
});

test('cancellation and a wrapper resolving before actual close retain ownership through close', async t => {
  const cancelled = await setup(t, { mutate(call, { controller }) { if (call.number === 0) controller.abort(); } });
  await assert.rejects(cancelled.observe(), { code: 'CANCELLED' }); assert.equal(cancelled.live(), 0); assert.equal(cancelled.calls.length, 1);
  const premature = await setup(t, { premature: true }); await assert.rejects(premature.observe(), { code: 'CANCELLED' }); assert.equal(premature.live(), 0);
});

for (const stimulus of [{ noStdoutEnd: true }, { noStderrEnd: true }, { pipeError: true }])
  test(`actual pipe EOF/error ${JSON.stringify(stimulus)} refuses fabricated successful capture accounting`, async t => {
    const s = await setup(t, stimulus); await assert.rejects(s.observe(), { code: 'HDR_INPUT_RUNNER' }); assert.equal(s.live(), 0); assert.equal(s.calls.length, 1);
  });
