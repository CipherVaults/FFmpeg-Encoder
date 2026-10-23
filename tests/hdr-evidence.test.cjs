'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { buildMediaEvidence } = require('../src/media-evidence.cjs');
const { buildHdrEncoding } = require('../src/hdr-encoding.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { normalizeProbe } = require('../src/inspection.cjs');
const { inspectHdrContainer } = require('../src/hdr-container.cjs');
const { syntheticContainer } = require('./hdr-container-fixture.cjs');
const clone = value => structuredClone(value), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const OUTPUT_ID = '69b15f97-2657-4b2b-9c2c-5e4cac779e35';
const mastering = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000',
  green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000',
  white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const light = () => ({ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 400 });
const budget = () => ({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 8388608,
  maxPcmBytes: 134217728, maxRecords: 20000, maxSpoolBytes: 33554432 });
function video(transfer = 'smpte2084', config = {}) { return { index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10',
  width: 320, height: 180, coded_width: 320, coded_height: 192, pix_fmt: 'yuv420p10le', field_order: 'progressive',
  color_transfer: transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', chroma_location: 'left',
  avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/1000', side_data_list: [], ...config }; }
function frames(stream, count = 96, staticBranch = 'both') { const rate = Number(stream.avg_frame_rate.slice(0, -2)); return Array.from({ length: count }, (_, index) => ({ media_type: 'video', stream_index: 0,
  pts: Math.round(index * 1000 / rate), best_effort_timestamp: Math.round(index * 1000 / rate), duration: Math.floor(1000 / rate),
  width: stream.width, height: stream.height, pix_fmt: 'yuv420p10le', interlaced_frame: 0, top_field_first: 0, repeat_pict: 0,
  ...(stream.sample_aspect_ratio ? { sample_aspect_ratio: stream.sample_aspect_ratio } : {}),
  color_transfer: stream.color_transfer, color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv',
  chroma_location: 'left', side_data_list: [...['both', 'mastering'].includes(staticBranch) ? [mastering()] : [], ...['both', 'light'].includes(staticBranch) ? [light()] : []] })); }

// Isolate acquisition from the concurrently implemented owner. This fake owner
// has its own private brand and immutable current binding; real-owner/service
// tests must separately prove actual telemetry/invocation admission. No child
// process, runtime binary, hardware, application or media tool runs here.
async function loadCollector(getBinding, observer, classify) {
  const filename = path.resolve(__dirname, '../src/hdr-evidence.cjs'), source = await fs.readFile(filename, 'utf8');
  const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = Module.createRequire(filename);
  fixture.require = name => name === './hdr-operation.cjs' ? { getHdrOperationCollectionBinding: getBinding }
    : name === './hdr-input.cjs' ? observer : name === './hevc-content.cjs' ? { classifyAnnexB: classify } : originalRequire(name);
  fixture._compile(source, filename); return fixture.exports;
}
async function setup(t, changes = {}) {
  // Keep all mock bytes and rejected evidence. These are isolated owned test
  // artifacts; the test suite deliberately performs no recursive cleanup.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-hdr-evidence-test-'));
  const sourcePath = path.join(root, 'source.mkv'), outputPath = path.join(root, 'staged.mkv'), stageDirectory = path.join(root, 'evidence');
  await fs.mkdir(stageDirectory);
  const v = video(changes.transfer, changes.video), sourceFrames = frames(v, changes.count, changes.staticBranch);
  const nativeEndTicks = sourceFrames.at(-1).pts + sourceFrames.at(-1).duration;
  const declaredDurationTicks = String(changes.declaredDurationTicks ?? Math.min(60000, nativeEndTicks));
  const containerOptions = { frameRate: v.avg_frame_rate, declaredDurationTicks };
  const sourceBytes = syntheticContainer({ ...containerOptions, payload: 'mock-owned-source-hdr-bytes' });
  const outputBytes = syntheticContainer({ ...containerOptions, ...changes.outputContainer, payload: 'mock-owned-encoded-hdr-bytes' });
  await fs.writeFile(sourcePath, sourceBytes); await fs.writeFile(outputPath, outputBytes);
  const containerTiming = { ...inspectHdrContainer(sourceBytes, { frameRate: v.avg_frame_rate }), nativeEndTicks: String(nativeEndTicks),
    headerRepresentation: declaredDurationTicks === String(nativeEndTicks) ? 'native-end' : 'ceil-period-header', sourceOutputToleranceTicks: '0' };
  const sourceProbe = { streams: [v], format: { format_name: 'matroska,webm', duration: String(Number(declaredDurationTicks) / 1000) }, chapters: [], programs: [], stream_groups: [] };
  const outputProbe = clone(sourceProbe), sdr = changes.hdrPolicy === 'sdr';
  if(sdr) Object.assign(outputProbe.streams[0],{color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',side_data_list:[]});
  const writerPlan = buildHdrEncoding({ settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, policy: sdr ? 'sdr' : 'preserve',
    videoEvidence: buildMediaEvidence(sourceProbe).streams[0], frameEvidence: { videoIndex: 0, coverage: sourceFrames.length <= 256 ? 'full' : 'sampled', decodedFrameCount: sourceFrames.length, decodeExitCode: 0, frames: sourceFrames.slice(0, 256) } });
  const plan = Object.freeze({ version: 1, opaqueFixture: true }), state = { revoked: false };
  const expected = { plan, runtimeIdentity: RUNTIME, outputId: OUTPUT_ID, sourcePath, outputPath, sourceProbe, outputProbe };
  const fingerprint = probe => sha(JSON.stringify(normalizeProbe(probe)));
  const observedIdentity = await readSourceIdentity(sourcePath);
  const fullSha = sha(await fs.readFile(sourcePath));
  const configuration = { id: 'reviewed-source', digest: 'd'.repeat(64), width: v.width, height: v.height, frameRate: v.avg_frame_rate,
    transfer: v.color_transfer, sampleAspectRatio: v.sample_aspect_ratio ?? null };
  const compressed = { version: 1, framing: 'length-prefixed', configuration, metadata: {
    mastering: ['both', 'mastering', undefined].includes(changes.staticBranch) ? Object.fromEntries(Object.entries(mastering()).filter(([key]) => key !== 'side_data_type')) : null,
    contentLight: ['both', 'light', undefined].includes(changes.staticBranch) ? { max_content: 1000, max_average: 400 } : null },
    compressedBytes: 1000, pictureCount: sourceFrames.length, packetCount: sourceFrames.length, nalCount: sourceFrames.length + 3, seiCount: 1,
    arrays: [{ index: 0, type: 33, complete: true, count: 1 }],
    packetInventory: sourceFrames.map((_, index) => ({ index, bytes: 100, sha256: sha(`packet-${index}`), nalCount: 1 })),
    nalInventory: [{ index: 0, type: 33, bytes: 100, sha256: 'a'.repeat(64), rbspSha256: 'b'.repeat(64), origin: { kind: 'extradata', array: 0 } }], fingerprint: 'e'.repeat(64) };
  const inputObservation = { complete: true, sourceFileSha256: fullSha, frames: sourceFrames,
    frameCount: sourceFrames.length, pixelFrames: v.width * v.height * sourceFrames.length,
    timeline: { timeBase: '1/1000', records: sourceFrames.length, rows: sourceFrames.map(frame => ({ pts: String(frame.pts), duration: String(frame.duration) })) },
    timelineHash: 'f'.repeat(64), containerTiming, compressedFingerprint: compressed.fingerprint, configurationMetadata: compressed, profilesFingerprint: '1'.repeat(64) };
  const admitted = Object.freeze({ planFingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64),
    sourceEvidenceFingerprint: fingerprint(sourceProbe), outputEvidenceFingerprint: fingerprint(outputProbe), writerPlan,
    sourceIdentity: changes.preparedIdentity?.(observedIdentity) ?? observedIdentity,
    sourceFileSha256: Object.hasOwn(changes, 'sourceFileSha256') ? changes.sourceFileSha256 : fullSha,
    eligibilityMode: 'content', inputObservation, sourceProfiles: [{ id: 'reviewed-source' }], outputProfiles: [{ id: 'reviewed-output' }],
    ...(sdr ? {hdrPolicy:'sdr',transform:{version:writerPlan.contract.filterContribution.version,
      filterGraphSha256:sha(JSON.stringify(writerPlan.filterGraph)),interpretation:writerPlan.contract.filterContribution.interpretation,
      interpretationSha256:sha(JSON.stringify(writerPlan.contract.filterContribution.interpretation)),
      sourceProfilesSha256:sha(JSON.stringify([{id:'reviewed-source'}])),outputProfilesSha256:sha(JSON.stringify([{id:'reviewed-output'}])),...changes.transform}} : {}),
    ...changes.admitted });
  const inputReceipts = new WeakMap();
  const observer = { async observeHdrInput(options) {
    assert.deepEqual(options.profiles, admitted.sourceProfiles); assert.deepEqual(options.sourceIdentity, observedIdentity);
    const observed = clone(inputObservation); observed.frames = changes.frames?.(observed.frames, { side: 'source', kind: 'frames', number: 0 }) ?? observed.frames;
    changes.inputObservation?.(observed);
    const receipt = Object.freeze({ status: 'completed', frameCount: observed.frameCount, sourceFileSha256: observed.sourceFileSha256 }); inputReceipts.set(receipt, observed); return receipt;
  }, getObservedHdrInput(receipt) { assert.ok(inputReceipts.has(receipt)); return inputReceipts.get(receipt); } };
  const api = await loadCollector((candidate, bindings) => {
    assert.equal(state.revoked, false, 'The genuine selected plan expired.'); assert.equal(candidate, plan, 'A genuine selected HDR plan is required.');
    for (const [key, value] of Object.entries(expected)) if (!['plan', 'sourceProbe', 'outputProbe'].includes(key)) assert.equal(bindings[key], value, `The genuine ${key} binding changed.`);
    assert.equal(fingerprint(bindings.sourceProbe), admitted.sourceEvidenceFingerprint, 'The genuine sourceProbe binding changed.');
    return Object.freeze({ ...admitted, outputEvidenceFingerprint: fingerprint(bindings.outputProbe) });
  }, observer, (bytes, options) => { assert.deepEqual(options.profiles, admitted.outputProfiles); assert.ok(Buffer.isBuffer(bytes));
    const facts = { ...clone(compressed), framing: 'annex-b', packetCount: 0, packetInventory: [], configuration: { ...configuration, id: 'reviewed-output', digest: '2'.repeat(64) } };
    if(sdr) { assert.equal(options.transfer,'bt709');assert.equal(options.outputMode,'sdr-bt709-main10');
      Object.assign(facts,{outputMode:'sdr-bt709-main10',metadata:{mastering:null,contentLight:null},alternativeTransfer:null});
      Object.assign(facts.configuration,{transfer:'bt709',primaries:'bt709',matrix:'bt709'}); }
    changes.classification?.(facts); return facts; });
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
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); let closed = false;
    child.once('close', () => { closed = true; });
    try {
      if (!changes.noChild) options.onChild?.(child);
      let bytes;
      if (call.kind === 'frames') {
        let observed = clone(sourceFrames);
        if(sdr && side !== 'source') observed=observed.map(frame=>({...frame,color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',side_data_list:[]}));
        if (side === 'bitstream') observed = observed.map(frame => { delete frame.pts; delete frame.best_effort_timestamp; return { ...frame, duration: 1200000 / Number(v.avg_frame_rate.slice(0, -2)) }; });
        observed = changes.frames?.(observed, call) ?? observed;
        const elementaryVideo = { ...clone(sdr ? outputProbe.streams[0] : v), time_base: '1/1200000', avg_frame_rate: '25/1' };
        const payload = side === 'bitstream' ? { frames: observed, streams: [elementaryVideo], programs: [], stream_groups: [] } : { frames: observed };
        changes.json?.(payload, call); bytes = Buffer.from(JSON.stringify(payload));
      } else if (call.kind === 'hashes') {
        assert.ok(args.includes('-noautorotate') && args.includes('+yuv420p10le'));
        let rows = Array.from({ length: sourceFrames.length }, (_, index) => `0, ${index}, ${index}, 1, ${v.width * v.height * 3}, ${sha(`${side === 'source' ? 'source' : 'encoded'}-${index}`)}\n`);
        rows = changes.hashes?.(rows, call) ?? rows; bytes = Buffer.from('#format: frame checksums\n#hash: SHA256\n' + rows.join(''));
      } else {
        assert.equal(args[args.indexOf('-bsf:v') + 1], 'hevc_mp4toannexb,dump_extra=freq=keyframe');
        assert.equal(args.at(-1), 'pipe:1'); bytes = Buffer.from('mock-distinct-extracted-elementary-hevc-bytes');
      }
      bytes = changes.bytes?.(bytes, call) ?? bytes;
      const boundary = Math.max(1, Math.floor(bytes.length / 3));
      await options.onStdoutChunk(bytes.subarray(0, boundary)); await options.onStdoutChunk(bytes.subarray(boundary));
      await changes.mutate?.(call, { root, sourcePath, outputPath, stageDirectory, state });
      if (!changes.noStdoutEnd) child.stdout.emit('end'); if (!changes.noStderrEnd) child.stderr.emit('end');
      if (changes.pipeError) child.stdout.emit('error', new Error('mock pipe failure'));
      if (changes.earlyResolve) setImmediate(() => child.emit('close', 0, null)); else child.emit('close', changes.closeCode ?? 0, null);
      const result = { exitCode: 0, stdout: '', stderr: '', stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: true }, stderrCapture: { totalBytes: 0, truncated: false } };
      return changes.capture?.(result, call) ?? result;
    } finally { if (!closed && !changes.earlyResolve) { child.stdout.emit('end'); child.stderr.emit('end'); child.emit('close', 1, null); } running = false; }
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
  assert.equal(s.calls.length, 6); assert.deepEqual(s.calls.map(call => call.side), ['source', 'container', 'container', 'container', 'bitstream', 'bitstream']);
  const artifacts = await fs.readdir(receipt.directory); assert.ok(artifacts.includes('output.hevc') && artifacts.includes('hdr-evidence.json') && artifacts.includes('receipt.json'));
  for (const artifact of receipt.artifacts) assert.equal(sha(await fs.readFile(path.join(receipt.directory, artifact.name))), artifact.sha256);
  assert.ok(receipt.spoolBytes < 33554432); assert.deepEqual(JSON.parse(await fs.readFile(path.join(receipt.directory, 'hdr-evidence.json'), 'utf8')), receipt.hdrEvidence);
  for (const plane of [receipt.hdrEvidence.source, receipt.hdrEvidence.container, receipt.hdrEvidence.bitstream]) {
    assert.equal(Object.hasOwn(plane, 'frames'), false); assert.equal(Object.hasOwn(plane.nativeHashes, 'rows'), false);
    assert.ok(plane.frameArtifact.sha256 && plane.timeline.rowsSha256, 'Full observations have sealed canonical references.');
  }
  const inventory = receipt.hdrEvidence.source.compressed.inventory.artifact;
  assert.equal(inventory.sha256, receipt.hdrEvidence.bitstream.compressed.inventory.artifact.sha256);
  const saved = JSON.parse(await fs.readFile(path.join(receipt.directory, inventory.name), 'utf8'));
  assert.equal(saved.source.packetInventory.length, 96); assert.equal(saved.source.packetInventory.at(-1).index, 95);
  assert.equal(saved.output.packetInventory.length, 0); assert.equal(sha(JSON.stringify(saved.source.nalInventory)), receipt.hdrEvidence.source.compressed.nalInventorySha256);
});

test('receipt clones, foreign plans, stale identities, modified runtime/path/probe/output UUID and getters cannot regain authority', async t => {
  const s = await setup(t), receipt = await s.collect();
  assert.throws(() => s.api.getCollectedHdrEvidence(clone(receipt), s.expected), /genuine/);
  for (const [key, value] of [['plan', clone(s.plan)], ['runtimeIdentity', 'f'.repeat(64)], ['outputId', '7d46bf1a-0850-4f7d-8d65-ab77ca897f62'],
    ['sourcePath', path.join(s.root, 'different-source.mkv')], ['outputPath', path.join(s.root, 'different-output.mkv')],
    ['sourceProbe', { ...clone(s.sourceProbe), chapters: [{ id: 0 }] }], ['outputProbe', { ...clone(s.outputProbe), chapters: [{ id: 0 }] }]]) {
    assert.throws(() => s.api.getCollectedHdrEvidence(receipt, { ...s.expected, [key]: value }), /genuine/);
  }
  assert.equal(s.api.getCollectedHdrEvidence(receipt, { ...s.expected, sourceProbe: clone(s.sourceProbe), outputProbe: clone(s.outputProbe) }), s.get(receipt),
    'Inert identical probe snapshots use normalized fingerprints, never probe object identity.');
  let invoked = false; const accessor = { ...s.expected }; Object.defineProperty(accessor, 'sourceProbe', { enumerable: true, get() { invoked = true; return s.sourceProbe; } });
  assert.throws(() => s.api.getCollectedHdrEvidence(receipt, accessor), /accessors/); assert.equal(invoked, false);
  s.state.revoked = true; assert.throws(() => s.get(receipt), /expired/);
});

test('modeled x265 repeated benign unregistered SEI is retained while duplicate mastering remains refused', async t => {
  const benign = { side_data_type: 'H.26[45] User Data Unregistered SEI message' };
  const s = await setup(t, { frames: rows => rows.map((frame, index) => ({ ...frame,
    side_data_list: [...frame.side_data_list, clone(benign), ...index === 0 ? [clone(benign)] : []] })) });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed'); assert.equal(s.get(receipt).source.frames[0].side_data_list.length, 4);
  const duplicate = await setup(t, { frames: rows => { rows[0].side_data_list.push(mastering()); return rows; } });
  failed(await duplicate.collect(), /duplicate/);
});

for (const count of [1, 255, 256, 257, 511, 512, 513, 1799, 1800]) {
  test(`complete source EOF ${count} aggregates exact sampled chunks without repeated frame artifacts`, async t => {
    const s = await setup(t, { count }), receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
    const evidence = s.get(receipt);
    for (const name of ['source', 'container', 'bitstream']) {
      const plane = evidence[name], chunks = plane.validation.chunks;
      assert.equal(plane.frames.length, count); assert.equal(plane.nativeHashes.rows.length, count);
      assert.equal(plane.validation.complete, true); assert.equal(plane.validation.comparedUnits, count);
      assert.equal(chunks.length, Math.ceil(count / 256)); assert.equal(chunks[0].startOrdinal, 0); assert.equal(chunks.at(-1).endOrdinalExclusive, count);
      assert.ok(chunks.every((chunk, i) => chunk.coverage === 'sampled' && chunk.frames > 0 && chunk.frames <= 256
        && chunk.startOrdinal === (i ? chunks[i - 1].endOrdinalExclusive : 0)));
      const canonical = JSON.parse(await fs.readFile(path.join(receipt.directory, plane.frameArtifact.name), 'utf8'));
      assert.equal(canonical.frames.length, count);
      assert.equal(Object.hasOwn(receipt.hdrEvidence[name], 'frames'), false);
    }
    assert.equal(receipt.artifacts.filter(artifact => artifact.name === 'source-frames.json').length, 1);
    assert.equal(receipt.invocations.filter(invocation => invocation.label === 'independent-hevc-extraction')[0].artifact, undefined,
      'AnnexB extraction is retained once as output.hevc.');
  });
}

for (const config of [
  { width: 1280, height: 720, count: 257, rate: 24 },
  { width: 1920, height: 1080, count: 400, rate: 25 },
  { width: 1280, height: 720, count: 900, rate: 30 },
]) test(`dynamic ${config.width}x${config.height} ${config.rate}fps preserves native bytes/clock at ${config.count} frames`, async t => {
  const s = await setup(t, { count: config.count, video: { width: config.width, height: config.height,
    sample_aspect_ratio: '1:1', avg_frame_rate: `${config.rate}/1`, r_frame_rate: `${config.rate}/1` } });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure)); const evidence = s.get(receipt);
  assert.equal(evidence.source.frames.length, config.count); assert.equal(evidence.container.nativeHashes.rows[0].bytes, config.width * config.height * 3);
  assert.equal(evidence.bitstream.video.avg_frame_rate, '25/1'); assert.equal(evidence.bitstream.video.r_frame_rate, `${config.rate}/1`);
  assert.ok(evidence.bitstream.frames.every(frame => frame.pts === undefined && frame.duration === 1200000 / config.rate));
  assert.equal(evidence.source.video.sample_aspect_ratio, '1:1'); assert.equal(evidence.timestamps.comparedUnits, String(config.count));
});

for (const staticBranch of ['both', 'neither', 'mastering', 'light']) test(`static HDR branch ${staticBranch} preserves exact presence and absence through every plane`, async t => {
  const s = await setup(t, { count: 257, staticBranch }), receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  for (const plane of [s.get(receipt).source, s.get(receipt).container, s.get(receipt).bitstream]) {
    assert.equal(plane.frames[256].side_data_list.length, staticBranch === 'both' ? 2 : staticBranch === 'neither' ? 0 : 1);
  }
});

for (const index of [255, 256, 512]) test(`signal mismatch at ordinal ${index} is not hidden by chunk boundaries`, async t => {
  const s = await setup(t, { count: 513, frames: (rows, call) => { if (call.side === 'container') rows[index].color_transfer = 'bt709'; return rows; } });
  failed(await s.collect(), /SIGNAL/);
});

for (const field of ['compressedFingerprint', 'timelineHash', 'frameCount', 'pixelFrames', 'profilesFingerprint']) test(`fresh source ${field} drift refuses current evidence`, async t => {
  const s = await setup(t, { inputObservation: observation => { observation[field] = typeof observation[field] === 'number' ? observation[field] + 1 : '0'.repeat(64); } });
  const receipt = await s.collect(); failed(receipt, /CHANGED/); assert.equal(s.calls.length, 0);
});

test('fresh complete configuration changes cannot hide behind unchanged summary hashes', async t => {
  const s = await setup(t, { inputObservation: observation => { observation.configurationMetadata.configuration.digest = '0'.repeat(64); } });
  const receipt = await s.collect(); failed(receipt, /CHANGED/); assert.equal(s.calls.length, 0);
});

test('the exact high container header and lower native end remain separate preserved facts', async t => {
  const s = await setup(t, { count: 400, declaredDurationTicks: '16667', video: { width: 1280, height: 720,
    sample_aspect_ratio: '1:1', avg_frame_rate: '24/1', r_frame_rate: '24/1' } });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  const evidence = s.get(receipt);
  assert.equal(evidence.source.containerTiming.nativeEndTicks, '16666');
  assert.equal(evidence.source.containerTiming.declaredDurationTicks, '16667');
  assert.equal(evidence.source.containerTiming.sourceOutputToleranceTicks, '0');
  assert.equal(evidence.outputSeal.containerTiming.declaredDurationTicks, '16667');
  assert.deepEqual(evidence.source.nativeTimeline.endPts, { numerator: '8333', denominator: '500' });
});

for (const outputDuration of ['3199', '3201']) test(`output raw duration ${outputDuration} cannot replace the exact frozen source header 3200`, async t => {
  const s = await setup(t, { outputContainer: { declaredDurationTicks: outputDuration } }), receipt = await s.collect();
  failed(receipt, /HDR_EVIDENCE_DURATION/); assert.equal(s.calls.length, 6, 'Identical decoded PTS/durations and pixels cannot override raw timing drift.');
  assert.throws(() => s.get(receipt), /genuine complete/);
});

test('a high source container header cannot be replaced by the equal native end', async t => {
  const s = await setup(t, { count: 400, declaredDurationTicks: '16667', outputContainer: { declaredDurationTicks: '16666' },
    video: { width: 1280, height: 720, sample_aspect_ratio: '1:1', avg_frame_rate: '24/1', r_frame_rate: '24/1' } });
  failed(await s.collect(), /HDR_EVIDENCE_DURATION/);
});

for (const defaultDurationNs of ['33333332', '33333334']) test(`one-nanosecond output DefaultDuration ${defaultDurationNs} refuses despite unchanged rounded frame-rate probes`, async t => {
  const s = await setup(t, { outputContainer: { defaultDurationNs } }), receipt = await s.collect();
  failed(receipt, /HDR_CONTAINER_TIMING/); assert.equal(s.calls.length, 6);
  assert.throws(() => s.get(receipt), /genuine complete/);
});

for (const field of ['width', 'height', 'frameRate', 'transfer', 'sampleAspectRatio']) test(`complete AnnexB ${field} mismatch refuses output evidence`, async t => {
  const s = await setup(t, { classification: facts => { facts.configuration[field] = field === 'width' || field === 'height' ? 999 : 'mismatch'; } });
  failed(await s.collect(), /BITSTREAM/);
});

for (const mutate of [facts => { facts.pictureCount--; }, facts => { facts.metadata.contentLight.max_average++; }, facts => { facts.metadata.mastering = null; }]) {
  test('complete independent NAL count/static mismatch refuses even matching decoded probes', async t => {
    const s = await setup(t, { classification: mutate }), receipt = await s.collect(); failed(receipt, /BITSTREAM/);
    assert.ok((await fs.readdir(receipt.directory)).includes('output.hevc'), 'Rejected NAL evidence remains reconstructable.');
  });
}

test('independent parser refusal retains the exact extracted bytes and grants no receipt', async t => {
  const s = await setup(t, { classification: () => { throw Object.assign(new Error('Unclassified functional NAL payload'), { code: 'HEVC_CONTENT_SEI' }); } });
  const receipt = await s.collect(); failed(receipt, /HEVC_CONTENT_SEI/); assert.throws(() => s.get(receipt), /genuine complete/);
  const output = receipt.artifacts.find(artifact => artifact.name === 'output.hevc'); assert.ok(output);
  assert.equal(sha(await fs.readFile(path.join(receipt.directory, output.name))), output.sha256);
});

for (const [name, changed] of [['missing child', { noChild: true }], ['missing stdout EOF', { noStdoutEnd: true }],
  ['missing stderr EOF', { noStderrEnd: true }], ['early runner resolution', { earlyResolve: true }],
  ['pipe error', { pipeError: true }], ['failed actual close', { closeCode: 1 }]]) {
  test(`${name} cannot receive complete collector authority`, async t => {
    const s = await setup(t, changed); failed(await s.collect(), /RUNNER/);
  });
}

test('per-input source count and pixel-frame ceilings refuse before native output acquisition', async t => {
  for (const changes of [{ count: 1801 }, { count: 901, video: { width: 1280, height: 720, sample_aspect_ratio: '1:1' } }]) {
    const s = await setup(t, changes); failed(await s.collect(), /LIMIT/); assert.equal(s.calls.length, 0);
  }
});

test('ctime-only prepared identity difference remains descriptive with complete current hash checks', async t => {
  const s = await setup(t, { preparedIdentity: identity => ({ ...identity, ctimeNs: '1' }) });
  const receipt = await s.collect(); assert.equal(receipt.status, 'completed', JSON.stringify(receipt.failure));
  assert.equal(receipt.sourceIdentityDisposition, 'ctime-only'); assert.match(receipt.sourceIdentityWarning, /renew[s]? no cache/);
});

test('unbranded/cloned binding is refused before acquisition', async t => {
  const s = await setup(t); await assert.rejects(s.collect({ plan: clone(s.plan) }), /genuine/); assert.equal(s.calls.length, 0);
});

for (const admitted of [{ eligibilityMode: 'unknown' }, { eligibilityMode: undefined }, { inputObservation: null }, { sourceProfiles: [] }, { outputProfiles: [] }]) {
  test('incomplete content authority cannot fall back to the exact-seed collector', async t => {
    const s = await setup(t, { admitted }); await assert.rejects(s.collect(), /eligibility mode|main-owned source observations/); assert.equal(s.calls.length, 0);
  });
}

for (const [name, change, pattern] of [
  ['late source static mismatch', (rows, call) => { if (call.side === 'source') rows[95].side_data_list[1].max_average = 401; return rows; }, /SIGNAL|metadata/],
  ['missing late source metadata', (rows, call) => { if (call.side === 'source') rows[95].side_data_list.pop(); return rows; }, /static HDR metadata/],
  ['late output signal mismatch', (rows, call) => { if (call.side === 'container') rows[95].color_transfer = 'bt709'; return rows; }, /SIGNAL/],
  ['late elementary static mismatch', (rows, call) => { if (call.side === 'bitstream') rows[95].side_data_list[0].red_x = '1/2'; return rows; }, /SIGNAL/],
  ['unknown functional side data', rows => { rows[0].side_data_list.push({ side_data_type: 'Unknown HDR dynamic payload' }); return rows; }, /Unknown.*side data/],
  ['fabricated square pixel SAR', rows => { rows[0].sample_aspect_ratio = '1:1'; return rows; }, /SAR/],
  ['nonzero crop', rows => { rows[0].crop_bottom = 1; return rows; }, /crop_bottom/],
  ['frame loss', rows => rows.slice(0, 95), /source EOF count/],
  ['wrong geometry', rows => { rows[95].height = 192; return rows; }, /visible geometry/],
  ['interlaced frame', rows => { rows[95].interlaced_frame = 1; return rows; }, /progressive/],
  ['duration drift', (rows, call) => { if (call.side === 'container') rows[50].duration = 34; return rows; }, /TIMELINE|duration differs/],
  ['PTS drift', (rows, call) => { if (call.side === 'container') { rows[50].pts++; rows[50].best_effort_timestamp++; } return rows; }, /TIMELINE|timestamp/],
  ['contradictory native PTS', rows => { rows[50].best_effort_timestamp++; return rows; }, /contradict/],
  ['wrong source extent', rows => { rows[95].duration = 34; return rows; }, /clocks disagree/],
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
  ['native framehash missing row', (bytes, call) => call.kind === 'hashes' ? Buffer.from(bytes.toString().split('\n').slice(0, -2).join('\n') + '\n') : bytes, /decoded source-EOF/],
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
  const large = await setup(t); await fs.writeFile(large.options.sourcePath, Buffer.alloc(16777217));
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
    const [name] = await fs.readdir(fields.stageDirectory); await fs.appendFile(path.join(fields.stageDirectory, name, 'source-frames.json'), 'tamper');
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
  failed(receipt, /HDR_EVIDENCE_SOURCE_HASH/); assert.equal(s.calls.length, 0, 'Fresh input SHA mismatch refuses before output observations.');
  assert.throws(() => s.get(receipt), /genuine complete/);
  assert.equal(receipt.expectedSourceFileSha256, 'c'.repeat(64));
  const names = await fs.readdir(receipt.directory); assert.ok(names.includes('failure.json'));
  assert.ok(!names.includes('hdr-evidence.json'), 'No complete evidence file is created for a source hash mismatch.');
});


for(const transfer of ['smpte2084','arib-std-b67']) test(`complete ${transfer} SDR collection validates source HDR separately from BT.709 output`,async t=>{
  const s=await setup(t,{transfer,hdrPolicy:'sdr',video:{width:1280,height:720,coded_width:1280,coded_height:720,sample_aspect_ratio:'1:1'}});
  const receipt=await s.collect();assert.equal(receipt.status,'completed',JSON.stringify(receipt.failure));
  const facts=s.get(receipt);assert.equal(facts.source.video.color_transfer,transfer);
  assert.equal(facts.container.video.color_transfer,'bt709');assert.equal(facts.bitstream.video.color_transfer,'bt709');
  assert.equal(facts.source.validation.scope,'genuine-complete-hdr-input-observation');
  assert.equal(facts.container.nativeHashes.sha256,facts.bitstream.nativeHashes.sha256);
  assert.equal(facts.hdrPolicy,'sdr');assert.equal(facts.timestamps.tolerance,'zero-native-ticks');
  assert.ok(facts.source.frames[0].side_data_list.some(entry=>entry.side_data_type==='Mastering display metadata'));
  assert.deepEqual(facts.container.frames[0].side_data_list,[]);
});
for(const field of ['filterGraphSha256','interpretationSha256','sourceProfilesSha256','outputProfilesSha256'])
  test(`SDR collector refuses stale ${field}`,async t=>{
    const s=await setup(t,{hdrPolicy:'sdr',transform:{[field]:'0'.repeat(64)}});
    await assert.rejects(s.collect(),/exact transform\/profile bindings/);assert.equal(s.calls.length,0);
  });
for(const kind of ['retained-hdr-metadata','source-transfer','wrong-primaries','missing-output-mode'])
  test(`SDR output cannot pass with ${kind}`,async t=>{
    const s=await setup(t,{hdrPolicy:'sdr',classification(facts){
      if(kind==='retained-hdr-metadata') facts.metadata.contentLight={max_content:1000,max_average:400};
      if(kind==='source-transfer') facts.configuration.transfer='smpte2084';
      if(kind==='wrong-primaries') facts.configuration.primaries='bt2020';
      if(kind==='missing-output-mode') delete facts.outputMode;
    }});failed(await s.collect(),/HDR_EVIDENCE_BITSTREAM/);
  });
test('SDR decoded output retaining mastering metadata refuses before compressed extraction',async t=>{
  const s=await setup(t,{hdrPolicy:'sdr',frames(rows,call){if(call.side==='container')rows[0].side_data_list=[mastering()];return rows;}});
  failed(await s.collect(),/static HDR metadata presence|HDR_EVIDENCE_SIGNAL/);
});
