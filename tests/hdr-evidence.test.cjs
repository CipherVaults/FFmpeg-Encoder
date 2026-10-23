'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { buildMediaEvidence } = require('../src/media-evidence.cjs');
const { buildHdrEncoding } = require('../src/hdr-encoding.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { normalizeProbe } = require('../src/inspection.cjs');
const clone = value => structuredClone(value), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const OUTPUT_ID = '69b15f97-2657-4b2b-9c2c-5e4cac779e35';
const mastering = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000',
  green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000',
  white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const light = () => ({ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 });
const budget = () => ({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8388608,
  maxPcmBytes: 134217728, maxRecords: 20000, maxSpoolBytes: 33554432 });
function video(transfer = 'smpte2084') { return { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10',
  width: 320, height: 180, coded_width: 320, coded_height: 192, pix_fmt: 'yuv420p10le', field_order: 'progressive',
  color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
  avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/1000', side_data_list: [] }; }
function frames(stream) { return Array.from({ length: 96 }, (_, index) => ({ media_type: 'video', stream_index: 0,
  pts: Math.round(index * 1000 / 30), best_effort_timestamp: Math.round(index * 1000 / 30), duration: 33,
  width: 320, height: 180, pix_fmt: 'yuv420p10le', interlaced_frame: 0, top_field_first: 0, repeat_pict: 0,
  color_transfer: stream.color_transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv',
  chroma_location: 'left', side_data_list: [mastering(), light()] })); }

// Isolate acquisition from the concurrently implemented owner. This fake owner
// has its own private brand and immutable current binding; real-owner/service
// tests must separately prove actual telemetry/invocation admission. No child
// process, runtime binary, hardware, application or media tool runs here.
async function loadCollector(getBinding) {
  const filename = path.resolve(__dirname, '../src/hdr-evidence.cjs'), source = await fs.readFile(filename, 'utf8');
  const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = Module.createRequire(filename);
  fixture.require = name => name === './hdr-operation.cjs' ? { getHdrOperationCollectionBinding: getBinding } : originalRequire(name);
  fixture._compile(source, filename); return fixture.exports;
}
async function setup(t, changes = {}) {
  // Keep all mock bytes and rejected evidence. These are isolated owned test
  // artifacts; the test suite deliberately performs no recursive cleanup.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hdr-evidence-test-'));
  const sourcePath = path.join(root, 'source.mkv'), outputPath = path.join(root, 'staged.mkv'), stageDirectory = path.join(root, 'evidence');
  await fs.mkdir(stageDirectory); await fs.writeFile(sourcePath, 'mock-owned-source-hdr-bytes'); await fs.writeFile(outputPath, 'mock-owned-encoded-hdr-bytes');
  const v = video(changes.transfer), sourceProbe = { streams: [v], format: { format_name: 'matroska,webm', duration: '3.200000' }, chapters: [], programs: [], stream_groups: [] };
  const outputProbe = clone(sourceProbe), sourceFrames = frames(v);
  const writerPlan = buildHdrEncoding({ settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, policy: 'preserve',
    videoEvidence: buildMediaEvidence(sourceProbe).streams[0], frameEvidence: { videoIndex: 0, coverage: 'full', decodedFrameCount: 96, decodeExitCode: 0, frames: sourceFrames } });
  const plan = Object.freeze({ version: 1, opaqueFixture: true }), state = { revoked: false };
  const expected = { plan, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID, sourcePath, outputPath, sourceProbe, outputProbe };
  const fingerprint = probe => sha(JSON.stringify(normalizeProbe(probe)));
  const observedIdentity = await readSourceIdentity(sourcePath);
  const admitted = Object.freeze({ planFingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64),
    sourceEvidenceFingerprint: fingerprint(sourceProbe), outputEvidenceFingerprint: fingerprint(outputProbe), writerPlan,
    sourceIdentity: changes.preparedIdentity?.(observedIdentity) ?? observedIdentity,
    sourceFileSha256: Object.hasOwn(changes, 'sourceFileSha256') ? changes.sourceFileSha256 : sha(await fs.readFile(sourcePath)) });
  const api = await loadCollector((candidate, bindings) => {
    assert.equal(state.revoked, false, 'The genuine selected plan expired.'); assert.equal(candidate, plan, 'A genuine selected HDR plan is required.');
    for (const [key, value] of Object.entries(expected)) if (!['plan', 'sourceProbe', 'outputProbe'].includes(key)) assert.equal(bindings[key], value, `The genuine ${key} binding changed.`);
    assert.equal(fingerprint(bindings.sourceProbe), admitted.sourceEvidenceFingerprint, 'The genuine sourceProbe binding changed.');
    return Object.freeze({ ...admitted, outputEvidenceFingerprint: fingerprint(bindings.outputProbe) });
  });
  const calls = []; let running = false;
  const ffmpeg = path.join(root, 'fixed-ffmpeg.exe'), ffprobe = path.join(root, 'fixed-ffprobe.exe');
  async function run(executable, args, options) {
    assert.equal(running, false, 'Only one evidence child runs at a time.'); running = true;
    const file = args[args.indexOf('-i') + 1], side = file === sourcePath ? 'source' : file === outputPath ? 'container' : 'bitstream';
    const call = { executable, args, options, file, side, number: calls.length + 1,
      kind: executable === ffprobe ? 'frames' : args.includes('framehash') ? 'hashes' : 'extraction' }; calls.push(call);
    assert.equal(options.timeoutMs, 120000); assert.equal(typeof options.onStdoutChunk, 'function');
    assert.ok(args.includes('-protocol_whitelist') && args.includes('-format_whitelist'));
    assert.ok(!args.includes('-t') && !args.includes('-ss') && !args.includes('-vf') && !args.includes('-s'), 'No sampling, scale or conversion.');
    try {
      let bytes;
      if (call.kind === 'frames') {
        let observed = clone(sourceFrames); if (side === 'bitstream') observed = observed.map(frame => { delete frame.pts; delete frame.best_effort_timestamp; return { ...frame, duration: 40000 }; });
        observed = changes.frames?.(observed, call) ?? observed;
        const elementaryVideo = { ...clone(v), time_base: '1/1200000', avg_frame_rate: '25/1' };
        const payload = side === 'bitstream' ? { frames: observed, streams: [elementaryVideo], programs: [], stream_groups: [] } : { frames: observed };
        changes.json?.(payload, call); bytes = Buffer.from(JSON.stringify(payload));
      } else if (call.kind === 'hashes') {
        assert.ok(args.includes('-noautorotate') && args.includes('+yuv420p10le'));
        let rows = Array.from({ length: 96 }, (_, index) => `0, ${index}, ${index}, 1, 172800, ${sha(`${side === 'source' ? 'source' : 'encoded'}-${index}`)}\n`);
        rows = changes.hashes?.(rows, call) ?? rows; bytes = Buffer.from('#format: frame checksums\n#hash: SHA256\n' + rows.join(''));
      } else {
        assert.equal(args[args.indexOf('-bsf:v') + 1], 'hevc_mp4toannexb,dump_extra=freq=keyframe');
        assert.equal(args.at(-1), 'pipe:1'); bytes = Buffer.from('mock-distinct-extracted-elementary-hevc-bytes');
      }
      bytes = changes.bytes?.(bytes, call) ?? bytes;
      const boundary = Math.max(1, Math.floor(bytes.length / 3));
      await options.onStdoutChunk(bytes.subarray(0, boundary)); await options.onStdoutChunk(bytes.subarray(boundary));
      await changes.mutate?.(call, { root, sourcePath, outputPath, stageDirectory, state });
      const result = { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true }, stderrCapture: { totalBytes: 0, truncated: false } };
      return changes.capture?.(result, call) ?? result;
    } finally { running = false; }
  }
  const controller = new AbortController(), options = { ...expected, stageDirectory, ffmpeg, ffprobe, run, signal: controller.signal, budget: budget() };
  t.diagnostic(`Retained isolated mock evidence: ${root}`);
  return { api, options, expected, root, calls, sourceFrames, sourceProbe, outputProbe, plan, state, controller,
    collect: changed => api.collectHdrEvidence({ ...options, ...changed }), get: receipt => api.getCollectedHdrEvidence(receipt, expected) };
}
function failed(receipt, pattern) {
  assert.equal(receipt.status, 'failed', JSON.stringify(receipt.failure)); assert.equal(receipt.hdrEvidence, null); assert.match(JSON.stringify(receipt.failure), pattern);
}

for (const transfer of ['smpte2084', 'arib-std-b67']) test(`complete ${transfer} collector covers 96 frames in three genuinely acquired planes and seals owned files`, async t => {
  const s = await setup(t, { transfer }), receipt = await s.collect(), evidence = s.get(receipt);
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.qualificationGranted, false); assert.equal(receipt.publicationAuthorized, false);
  assert.equal(evidence.complete, true); assert.equal(Object.isFrozen(evidence.source.frames), true);
  for (const plane of [evidence.source, evidence.container, evidence.bitstream]) {
    assert.equal(plane.coverage, 'full'); assert.equal(plane.frames.length, 96); assert.equal(plane.decodedFrameCount, 96);
    assert.equal(plane.nativeHashes.rows.length, 96); assert.equal(plane.video.sample_aspect_ratio, undefined);
  }
  assert.equal(evidence.bitstream.nativeTimeline.firstPts, null, 'A raw elementary stream does not acquire an invented PTS.');
  assert.deepEqual(evidence.source.nativeTimeline.endPts, { numerator: '16', denominator: '5' });
  assert.deepEqual(evidence.timestamps.maxPtsError, { numerator: '0', denominator: '1' });
  assert.notEqual(evidence.source.nativeHashes.sha256, evidence.container.nativeHashes.sha256, 'A lossy encoder does not promise source pixel identity.');
  assert.equal(evidence.container.nativeHashes.sha256, evidence.bitstream.nativeHashes.sha256);
  const withoutOutputProbe = { ...s.expected }; delete withoutOutputProbe.outputProbe;
  assert.equal(s.api.getCollectedHdrEvidence(receipt, withoutOutputProbe), evidence, 'The operation owner can use the private acquired output binding.');
  assert.equal(s.api.getCollectedHdrEvidence(receipt, { plan: s.plan, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID }), evidence);
  assert.equal(evidence.sourceFileSha256, sha(await fs.readFile(s.options.sourcePath)));
  assert.equal(evidence.expectedSourceFileSha256, evidence.sourceFileSha256);
  assert.equal(evidence.outputFileSha256, sha(await fs.readFile(s.options.outputPath)));
  assert.equal(s.calls.length, 7); assert.deepEqual(s.calls.map(call => call.side), ['source', 'source', 'container', 'container', 'container', 'bitstream', 'bitstream']);
  const artifacts = await fs.readdir(receipt.directory); assert.ok(artifacts.includes('output.hevc') && artifacts.includes('hdr-evidence.json') && artifacts.includes('receipt.json'));
  for (const artifact of receipt.artifacts) assert.equal(sha(await fs.readFile(path.join(receipt.directory, artifact.name))), artifact.sha256);
  assert.ok(receipt.spoolBytes < 33554432); assert.deepEqual(JSON.parse(await fs.readFile(path.join(receipt.directory, 'hdr-evidence.json'), 'utf8')), evidence);
});

test('receipt clones, foreign plans, stale identities, modified runtime/path/probe/output UUID and getters cannot regain authority', async t => {
  const s = await setup(t), receipt = await s.collect();
  assert.throws(() => s.api.getCollectedHdrEvidence(clone(receipt), s.expected), /genuine/);
  for (const [key, value] of [['plan', clone(s.plan)], ['runtimeIdentity', 'f'.repeat(64)], ['outputId', '7d46bf1a-0850-4f7d-8d65-ab77ca897f62'],
    ['sourcePath', path.join(s.root, 'different-source.mkv')], ['outputPath', path.join(s.root, 'different-output.mkv')],
    ['sourceProbe', { ...clone(s.sourceProbe), chapters: [{ id: 0 }] }], ['outputProbe', { ...clone(s.outputProbe), chapters: [{ id: 0 }] }]]) {
    assert.throws(() => s.api.getCollectedHdrEvidence(receipt, { ...s.expected, [key]: value }), /genuine/);
  }
  assert.equal(s.api.getCollectedHdrEvidence(receipt, { ...s.expected, sourceProbe: clone(s.sourceProbe), outputProbe: clone(s.outputProbe) }), receipt.hdrEvidence,
    'Inert identical probe snapshots use normalized fingerprints, never probe object identity.');
  let invoked = false; const accessor = { ...s.expected }; Object.defineProperty(accessor, 'sourceProbe', { enumerable: true, get() { invoked = true; return s.sourceProbe; } });
  assert.throws(() => s.api.getCollectedHdrEvidence(receipt, accessor), /accessors/); assert.equal(invoked, false);
  s.state.revoked = true; assert.throws(() => s.get(receipt), /expired/);
});

test('actual x265 fixture repeated benign unregistered SEI is retained while duplicate mastering remains refused', async t => {
  const benign = { side_data_type: 'H.26[45] User Data Unregistered SEI message' };
  const s = await setup(t, { frames: rows => rows.map((frame, index) => ({ ...frame,
    side_data_list: [...frame.side_data_list, clone(benign), ...index === 0 ? [clone(benign)] : []] })) });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed'); assert.equal(s.get(receipt).source.frames[0].side_data_list.length, 4);
  const duplicate = await setup(t, { frames: rows => { rows[0].side_data_list.push(mastering()); return rows; } });
  failed(await duplicate.collect(), /duplicate/);
});

test('unbranded/cloned binding is refused before acquisition', async t => {
  const s = await setup(t); await assert.rejects(s.collect({ plan: clone(s.plan) }), /genuine/); assert.equal(s.calls.length, 0);
});

for (const [name, change, pattern] of [
  ['late source static mismatch', (rows, call) => { if (call.side === 'source') rows[95].side_data_list[1].max_average = 401; return rows; }, /SIGNAL|metadata/],
  ['missing late source metadata', (rows, call) => { if (call.side === 'source') rows[95].side_data_list.pop(); return rows; }, /static HDR metadata/],
  ['late output signal mismatch', (rows, call) => { if (call.side === 'container') rows[95].color_transfer = 'bt709'; return rows; }, /SIGNAL/],
  ['late elementary static mismatch', (rows, call) => { if (call.side === 'bitstream') rows[95].side_data_list[0].red_x = '1/2'; return rows; }, /SIGNAL/],
  ['unknown functional side data', rows => { rows[0].side_data_list.push({ side_data_type: 'Unknown HDR dynamic payload' }); return rows; }, /Unknown.*side data/],
  ['fabricated square pixel SAR', rows => { rows[0].sample_aspect_ratio = '1:1'; return rows; }, /absent SAR/],
  ['nonzero crop', rows => { rows[0].crop_bottom = 1; return rows; }, /crop_bottom/],
  ['frame loss', rows => rows.slice(0, 95), /96 complete/],
  ['wrong geometry', rows => { rows[95].height = 192; return rows; }, /visible geometry/],
  ['interlaced frame', rows => { rows[95].interlaced_frame = 1; return rows; }, /progressive/],
  ['duration drift', (rows, call) => { if (call.side === 'container') rows[50].duration = 34; return rows; }, /TIMELINE|duration differs/],
  ['PTS drift', (rows, call) => { if (call.side === 'container') { rows[50].pts++; rows[50].best_effort_timestamp++; } return rows; }, /TIMELINE|timestamp/],
  ['contradictory native PTS', rows => { rows[50].best_effort_timestamp++; return rows; }, /contradict/],
  ['wrong source extent', rows => { rows[95].duration = 34; return rows; }, /3200/],
]) test(`${name} refuses complete collection and retains failure evidence`, async t => {
  const s = await setup(t, { frames: change }), receipt = await s.collect(); failed(receipt, pattern);
  assert.throws(() => s.get(receipt), /genuine/); assert.ok((await fs.readdir(receipt.directory)).includes('failure.json'));
});

for (const [name, changed, pattern] of [
  ['JSON parse failure', (bytes, call) => call.kind === 'frames' ? Buffer.from('{"frames":[') : bytes, /INVALID_PROBE|JSON/],
  ['duplicate JSON section', (bytes, call) => call.kind === 'frames' ? Buffer.from('{"frames":[],"frames":[]}') : bytes, /INVALID_PROBE|duplicate/],
  ['invalid UTF8', (bytes, call) => call.kind === 'frames' ? Buffer.from([123, 255, 125]) : bytes, /UTF-8/],
  ['truncated framehash', (bytes, call) => call.kind === 'hashes' ? bytes.subarray(0, bytes.length - 1) : bytes, /Truncated/],
  ['native frame byte mismatch', (bytes, call) => call.kind === 'hashes' ? Buffer.from(bytes.toString().replace('172800', '86400')) : bytes, /complete 10-bit/],
  ['native framehash missing row', (bytes, call) => call.kind === 'hashes' ? Buffer.from(bytes.toString().split('\n').slice(0, -2).join('\n') + '\n') : bytes, /96 decoded/],
  ['independent extracted pixels differ', (bytes, call) => call.kind === 'hashes' && call.side === 'bitstream' ? Buffer.from(bytes.toString().replace(/([a-f0-9]{64})/, 'e'.repeat(64))) : bytes, /BITSTREAM/],
  ['empty elementary output', (bytes, call) => call.kind === 'extraction' ? Buffer.alloc(0) : bytes, /extraction is empty/],
]) test(`${name} refuses authority`, async t => { const s = await setup(t, { bytes: changed }); failed(await s.collect(), pattern); });

for (const [name, mutate] of [
  ['missing streaming', result => { result.stdoutCapture.streamed = false; }],
  ['capture truncation', result => { result.stdoutCapture.truncated = true; }],
  ['capture byte mismatch', result => { result.stdoutCapture.totalBytes++; }],
  ['buffered stdout substitute', result => { result.stdout = '{}'; }],
  ['native failure exit', result => { result.exitCode = 1; }],
  ['missing stderr receipt', result => { delete result.stderrCapture; }],
  ['stderr truncation', result => { result.stderrCapture.truncated = true; }],
  ['decode warning', result => { result.stderr = 'warning\n'; result.stderrCapture.totalBytes = 8; }],
]) test(`${name} refuses incomplete runner evidence`, async t => {
  const s = await setup(t, { capture: result => { mutate(result); return result; } }); failed(await s.collect(), /RUNNER|DECODE/);
});

test('stdout byte ceiling and explicit complete budget cannot be bypassed', async t => {
  const s = await setup(t); await assert.rejects(s.collect({ budget: { ...budget(), sourceDecode: 'sampled' } }), /complete source decode|Complete source decode/);
  await assert.rejects(s.collect({ budget: { ...budget(), maxSpoolBytes: 33554433 } }), /ceiling/);
  failed(await s.collect({ budget: { ...budget(), maxFrameBytes: 1024 } }), /LIMIT/);
});

test('output/source content changes and expired owner binding fail during acquisition', async t => {
  for (const target of ['outputPath', 'sourcePath', 'owner']) {
    const s = await setup(t, { mutate: async (call, fields) => { if (call.number === 1) {
      if (target === 'owner') fields.state.revoked = true; else await fs.appendFile(fields[target], 'changed');
    } } }); failed(await s.collect(), /CHANGED|expired/);
  }
});

test('single-link identity and finite source/output bounds are enforced before children', async t => {
  const linked = await setup(t); await fs.link(linked.options.sourcePath, path.join(linked.root, 'alias.mkv'));
  await assert.rejects(linked.collect(), /multiply linked/); assert.equal(linked.calls.length, 0);
  const large = await setup(t); await fs.writeFile(large.options.sourcePath, Buffer.alloc(1048577));
  await assert.rejects(large.collect(), /byte envelope/); assert.equal(large.calls.length, 0);
});

test('prepared source stamp and sparse digest are independently checked before collection', async t => {
  for (const [key, value] of [['ino', '123'], ['mtimeNs', '123'], ['sparseDigest', `sha256-sparse-v1:${'f'.repeat(64)}`]]) {
    const s = await setup(t, { preparedIdentity: identity => ({ ...identity, [key]: value }) });
    await assert.rejects(s.collect(), /prepared HDR identity/); assert.equal(s.calls.length, 0);
  }
});

test('retained evidence file mutation is detected by its exclusive identity seal', async t => {
  const s = await setup(t, { mutate: async (call, fields) => { if (call.number === 2) {
    const [name] = await fs.readdir(fields.stageDirectory); await fs.appendFile(path.join(fields.stageDirectory, name, 'child-1.stdout'), 'tamper');
  } } }); failed(await s.collect(), /CHANGED/);
});

test('unexpected probe wrappers and elementary relationships refuse authority', async t => {
  const unexpected = await setup(t, { json: payload => { payload.packets = []; } }); failed(await unexpected.collect(), /records/);
  const related = await setup(t, { json: (payload, call) => { if (call.side === 'bitstream') payload.programs = [{ program_id: 1 }]; } });
  failed(await related.collect(), /relationships/);
});

for (const [field, value] of [['avg_frame_rate', '30/1'], ['r_frame_rate', '25/1'], ['time_base', '1/1000']]) {
  test(`raw elementary ${field} cannot masquerade as the native container clock`, async t => {
    const s = await setup(t, { json: (payload, call) => { if (call.side === 'bitstream') payload.streams[0][field] = value; } });
    failed(await s.collect(), /raw HEVC demux observation/);
  });
}
for (const [field, value] of [['duration', 50000], ['pts', 0], ['best_effort_timestamp', 0], ['pkt_duration', 50000]]) {
  test(`raw elementary ${field} must retain the independently observed absence or exact value`, async t => {
    const s = await setup(t, { frames: (rows, call) => { if (call.side === 'bitstream') rows[95][field] = value; return rows; } });
    failed(await s.collect(), /Raw HEVC.*exact observed duration/);
  });
}

test('wrapped child failure preserves stderr byte accounting, its cause and partial streamed bytes', async t => {
  const s = await setup(t, { capture: () => { const error = new Error('owned runner failed', { cause: Object.assign(new Error('sink cause'), { code: 'SINK_CAUSE' }) });
    error.code = 'TOOL_FAILED'; error.stderr = 'native decode failed\n'; error.stderrCapture = { totalBytes: 21, truncated: false }; throw error; } });
  const receipt = await s.collect(); failed(receipt, /TOOL_FAILED|SINK_CAUSE/);
  assert.equal(receipt.invocations[0].stderrCapture.totalBytes, 21); assert.ok(receipt.invocations[0].partialArtifact);
  assert.ok((await fs.readdir(receipt.directory)).includes('failure.json'));
});

test('cancelled collection has no completed receipt authority and retains captured artifacts', async t => {
  let s; s = await setup(t, { mutate: call => { if (call.number === 1) s.controller.abort(); } });
  const receipt = await s.collect(); assert.equal(receipt.status, 'cancelled'); assert.equal(receipt.hdrEvidence, null);
  assert.throws(() => s.get(receipt), /genuine/); assert.equal(receipt.invocations.length, 1);
  assert.ok((await fs.readdir(receipt.directory)).includes('failure.json'), 'Cancellation preserves its acquisition failure receipt.');
});

for (const sourceFileSha256 of [undefined, null, '', 'not-a-hash', 'A'.repeat(64)]) {
  test(`collector rejects missing or malformed reviewed full source hash before children (${String(sourceFileSha256).slice(0, 20)})`, async t => {
    const s = await setup(t, { sourceFileSha256 });
    await assert.rejects(s.collect(), /reviewed full source hash/); assert.equal(s.calls.length, 0);
  });
}

test('independently sealed actual source bytes must match the reviewed hash before any complete receipt is branded', async t => {
  const s = await setup(t, { sourceFileSha256: 'c'.repeat(64) }), receipt = await s.collect();
  failed(receipt, /HDR_EVIDENCE_SOURCE_HASH/); assert.equal(s.calls.length, 7, 'All native observations alone cannot qualify unreviewed bytes.');
  assert.throws(() => s.get(receipt), /genuine complete/);
  assert.equal(receipt.expectedSourceFileSha256, 'c'.repeat(64));
  const names = await fs.readdir(receipt.directory); assert.ok(names.includes('failure.json')); assert.ok(names.includes('output.hevc'));
  assert.ok(!names.includes('hdr-evidence.json'), 'No complete evidence file is created for a source hash mismatch.');
});
