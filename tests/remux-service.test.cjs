'use strict';
const admission = require('./helpers/remux-admission-fixture.cjs');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const { EVIDENCE_BUDGET } = require('../src/operation-controls.cjs');
const { timedFixture } = require('./helpers/mov-fixture.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');

// Preparation/authority tests use owned inert bytes and injected media facts.
// They do not invoke FFmpeg, qualify a physical file or establish native media.
const RUNTIME = 'a'.repeat(64);
const parent = path.resolve(__dirname, '../artifacts/v0.7/slice3/service-unit');
function probe() {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 31,
    width: 320, height: 180, coded_width: 320, coded_height: 180, pix_fmt: 'yuv420p', field_order: 'progressive',
    color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', chroma_location: 'left',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2', tags: { title: 'Native video' }, disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000',
    channels: 2, channel_layout: 'stereo', time_base: '1/1000', start_pts: 0, start_time: '0', duration: '2',
    tags: { language: 'eng', title: 'Stereo' }, disposition: { default: 1 } }],
  format: { format_name: 'matroska,webm', duration: '2', start_time: '0', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { title: 'Synthetic preparation facts' } },
  chapters: [], programs: [], stream_groups: [] };
}
async function harness(t, { target = 'matroska', count = 1, explicitAudio = false, videoTags = {}, mov = false,
  sourceEnvelope = 'h264-aac-lc-48k-stereo-v1', verificationMethod = 'complete-native-v1', Service = EncoderService, change = () => {} } = {}) {
  await fs.mkdir(parent, { recursive: true }); const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'); await fs.mkdir(input); await fs.mkdir(output);
  for (let i = 0; i < count; i++) { const native = probe(); if(mov)native.format.format_name='mov,mp4,m4a,3gp,3g2,mj2';change(native); await fs.writeFile(path.join(input, `source-${i}.mkv`), require('./helpers/mov-fixture.cjs').playbackFixture(native)); }
  const service = new Service({ ffmpeg: path.join(root, 'dummy-ffmpeg'), ffprobe: path.join(root, 'dummy-ffprobe'), stateDir: path.join(root, 'state'),
    inspect: async file => { const value = probe(); if (mov) value.format.format_name = 'mov,mp4,m4a,3gp,3g2,mj2';
      Object.assign(value.streams[0].tags, videoTags); change(value); value.streams.forEach(s => { s.id = String(s.index + 1); }); value.format.size = String((await fs.stat(file)).size); return { probe: value, duration: 2, summary: {} }; }, capabilities: async () => { throw new Error('Remux must not initialize encoders'); },
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false, reason: 'Synthetic storage observation' }) },
    runtimeIdentity: RUNTIME, operationRuntime: { observe: async () => Object.freeze({}), snapshot: () => ({ runtimeIdentity: RUNTIME, environment: null }), close: async () => {} },
    operationStorage: () => { throw new Error('No execution storage should open during preparation'); },
    operationEvidenceBudget: EVIDENCE_BUDGET, operationDeadlineMs: 600000,
    remuxOperations: new RemuxOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-main-route-policy', policies: mov
      ? [{ id: 'synthetic-mov', inputFamily: 'isobmff', target: 'mov', evidenceIds: ['synthetic-route'], allowAncillary: false, verificationMethod,
        runtimeIdentity: RUNTIME, sourceEnvelope }]
      : ['matroska', 'mp4'].map(target =>
        ({ id: 'synthetic-' + target, inputFamily: 'matroska', target, evidenceIds: ['synthetic-route'], allowAncillary: false, verificationMethod, runtimeIdentity: RUNTIME,
          ...(explicitAudio && target === 'mp4' ? { audio: 'explicitly-omitted-only' } : {}) })) }) });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target });
  return { service, input, output, a, b };
}
test('real service/storage admits the complete long omitted-AAC packet forecast; wrong-method allowance mutant is killed', async t => {
  const { openEvidenceStorage } = require('../src/operation-storage.cjs'), { deriveRemuxAssessmentBudget } = require('../src/remux-operation.cjs');
  const originalStatfs = fs.statfs; fs.statfs = async () => ({ bavail: 1024n ** 4n, bsize: 1n });
  t.after(() => { fs.statfs = originalStatfs; });
  async function exercise(Service, seconds, channels = 2) {
    const h = await harness(t, { Service, target: 'mp4', explicitAudio: true, verificationMethod: 'packet-identity-v1', change: p => {
      p.format.duration = String(seconds); for (const s of p.streams) { s.duration = String(seconds); s.duration_ts = seconds * 1000; }
      p.streams[1].channels = channels; p.streams[1].channel_layout = channels === 6 ? '5.1' : channels === 8 ? '7.1' : 'stereo';
    } });
    let ready = h.service.snapshot(); assert.equal(ready.items[0].reasonCode, 'REMUX_AUDIO_OMISSION_REQUIRED');
    await h.service.setRemuxOmissions({ planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision,
      decisionIds: ready.items[0].remux.omissionCandidates.filter(c => /audio/.test(c.label)).map(c => c.id) });
    ready = h.service.snapshot(); assert.equal(ready.items[0].status, 'ready', ready.items[0].reason);
    const entry = h.service.plan.entries.get(ready.items[0].id), storageRoot = path.join(path.dirname(h.input), 'state', 'actual-evidence');
    await fs.mkdir(storageRoot, { recursive: true }); const store = await openEvidenceStorage({ root: storageRoot });
    let forecast, copied = false, childClosed = false;
    h.service.operationStorage = { ...store, admit: request => { forecast = request.forecastBytes; return store.admit(request); } };
    h.service.operationRuntime.requireCurrent = async () => ({ runtimeIdentity: RUNTIME, environment: null });
    h.service.operationRuntime.invoke = async (_token, tool, args, options) => {
      assert.equal(tool, 'ffmpeg'); assert.equal(args[args.indexOf('-c') + 1], 'copy'); copied = true;
      await fs.writeFile(args.at(-1), 'owned incomplete copy');
      void h.service.cancelCurrent(); await new Promise(resolve => setImmediate(resolve)); childClosed = true;
      throw Object.assign(Error('owned copy cancelled after storage admission'), { code: 'CANCELLED' });
    };
    try {
      h.service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }); await h.service.taskPromise;
      const expected = deriveRemuxAssessmentBudget(entry.remuxAssessment, entry.fingerprint.size, 'packet-identity-v1');
      const selectedOnly = deriveRemuxAssessmentBudget(entry.remuxAssessment, entry.fingerprint.size, 'complete-native-v1');
      assert.equal(expected.budget.maxPcmBytes, EVIDENCE_BUDGET.maxPcmBytes, 'Omitted audio spends no PCM beyond the unchanged floor.');
      assert.ok(expected.resources.evidenceReserveBytes > selectedOnly.resources.evidenceReserveBytes);
      assert.equal(forecast, expected.resources.evidenceReserveBytes, 'Never lower the all-stream forecast to fit a smaller allowance.');
      assert.equal(copied, true, h.service.snapshot().items[0].reason); assert.equal(childClosed, true);
      assert.equal(h.service.snapshot().items[0].status, 'cancelled'); await assert.rejects(fs.lstat(entry.destination), { code: 'ENOENT' });
    } finally { await store.close(); }
  }
  for (const seconds of [1200, 10800]) for (const channels of [2, 6, 8]) await exercise(EncoderService, seconds, channels);
  const filename = require.resolve('../src/encoder-service.cjs'), text = require('node:fs').readFileSync(filename, 'utf8');
  const before = 'createRemuxStorageAllowance(entry.remuxAssessment, entry.fingerprint.size, qualified.verificationMethod)'; assert.equal(text.split(before).length, 2);
  const Module = require('node:module'), m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(text.replace(before, "createRemuxStorageAllowance(entry.remuxAssessment, entry.fingerprint.size, 'complete-native-v1')"), filename);
  await assert.rejects(exercise(m.exports.EncoderService, 1200), { code: 'ERR_ASSERTION' });
});
test('MOV source-shape, AAC and required-track-tag guards reach service preparation before any Start', async t => {
  for (const [change, code] of [
    [p => { p.streams[1].sample_rate = '44100'; }, 'REMUX_MOV_AUDIO_UNQUALIFIED'],
    [p => { p.streams[0].avg_frame_rate = '299/10'; }, 'REMUX_MOV_RATE_UNQUALIFIED'],
    [p => { p.chapters = [{ id: 0, time_base: '1/1000', start: 0, end: 1000, tags: {} }]; }, 'REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED'],
    [p => { p.streams[0].tags.BPS = '1000'; }, 'REMUX_TRACK_TAG_UNREPRESENTABLE'],
  ]) {
    const { service } = await harness(t, { mov: true, target: 'mov', change }); const s = service.snapshot();
    assert.equal(s.items[0].status, 'unsupported'); assert.equal(s.items[0].reasonCode, code);
    assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'INVALID_SELECTION' });
  }
  const { service } = await harness(t, { mov: true, target: 'mov' });
  assert.equal(service.snapshot().items[0].status, 'ready', service.snapshot().items[0].reason);
});

async function cadenceJob(t, { sourceVariable = false, outputVariable = false, insufficient = false,
  sourceEnvelope = 'h264-aac-lc-48k-stereo-v1', average = '30/1', nominal = '30/1', outputAverage,
  cadenceFps = 30, offsetTicks = 0, contentChanged = false, cancelStage = null, verificationMethod = 'complete-native-v1', Service = EncoderService } = {}) {
  // Real service, owner, collector, validator and publication; only tool output,
  // runtime observation and storage accounting are injected. Atom fixtures are
  // inert bytes, not playable media, and no native process is created.
  const step = 30000 / cadenceFps;
  const timestamps = variable => insufficient ? [0] : variable ? [0, step, 3 * step] : [0, step, 2 * step];
  const extent = variable => String((timestamps(variable).at(-1) + step) / 30000).slice(0, 14);
  const h = await harness(t, { target: 'mov', mov: true, sourceEnvelope, verificationMethod, Service, change: p => {
    Object.assign(p.streams[0], { width: 2, height: 2, coded_width: 2, coded_height: 2, display_aspect_ratio: '1:1',
      time_base: '1/30000', avg_frame_rate: average, r_frame_rate: nominal,
      duration_ts: timestamps(sourceVariable).at(-1) + step, duration: extent(sourceVariable) });
    p.streams[0].tags.language = 'und'; p.streams[1].tags.language = 'und';
    Object.assign(p.streams[1], { time_base: '1/48000', duration_ts: 4, duration: '0.000083333333' });
    if (verificationMethod === 'packet-identity-v1') for (const s of p.streams) {
      const data = admission.extra(s); Object.assign(s, {
        codec_tag_string: s.codec_type === 'video' ? 'avc1' : 'mp4a', extradata_size: data.length, extradata_hash: 'SHA256:' + admission.hash(data) });
    }
    p.format.duration = extent(sourceVariable);
  } });
  const service = h.service, ready = service.snapshot();
  const selectedMethod = ready.items[0].verificationMethod;
  assert.equal(ready.items[0].status, 'ready', ready.items[0].reason);
  const entry = service.plan.entries.get(ready.items[0].id), original = await fs.readFile(entry.file);
  const evidence = path.join(path.dirname(h.input), 'cadence-evidence'); await fs.mkdir(evidence);
  service.operationStorage = { admit: async () => ({ directory: evidence }), assertReservation: async () => {},
    observeGrowth: async () => ({}), finish: async () => ({ final: { violations: [] } }), close: async () => {} };
  let outputProbe;
  const run = async (executable, args, options = {}) => {
    let bytes = Buffer.alloc(0), auxBytes = 0;
    if (args.includes('-progress') && args.includes('-c') && args[args.indexOf('-c') + 1] === 'copy') {
      // Native edits describe the source interval. Independent injected output
      // frame faults below continue to exercise the cadence/timestamp validator.
      await fs.writeFile(args.at(-1), timedFixture([
        { id: 1, scale: 30000, pts: timestamps(sourceVariable), durations: timestamps(sourceVariable).map(() => step) },
        { id: 2, scale: 48000, pts: [0], durations: [4] }]));
      if (cancelStage === 'copy') void service.cancelCurrent();
    } else if (args.includes('-show_format')) {
      outputProbe = structuredClone(entry.inspection.probe);
      outputProbe.streams.forEach((stream, i) => {
        stream.id = '0x' + (i + 1); stream.tags.name = stream.tags.title; delete stream.tags.title;
        stream.tags.handler_name = i === 0 ? 'VideoHandler' : 'SoundHandler';
      });
      Object.assign(outputProbe.streams[0], { duration_ts: timestamps(outputVariable).at(-1) + step, duration: extent(outputVariable) });
      if (outputAverage) outputProbe.streams[0].avg_frame_rate = outputAverage;
      Object.assign(outputProbe.format, { size: String((await fs.stat(args.at(-1))).size), duration: extent(outputVariable),
        tags: { ...outputProbe.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: entry.outputId } });
      bytes = Buffer.from(JSON.stringify(outputProbe));
    } else {
      const file = args[args.indexOf('-i') + 1], isOutput = file !== entry.file && !path.basename(file).startsWith('source-');
      const index = args.includes('-map') || args.includes('-select_streams')
        ? Number(args[args.indexOf(args.includes('-select_streams') ? '-select_streams' : '-map') + 1].replace(/^0:/, '')) : 0;
      const pts = timestamps(isOutput ? outputVariable : sourceVariable).map(value => value + (isOutput ? offsetTicks : 0));
      if (args.includes('-show_frames')) bytes = Buffer.from(JSON.stringify({ frames: index === 0
        ? pts.map(pts => ({ media_type: 'video', stream_index: 0, pts, duration: step, width: 2, height: 2, pix_fmt: 'yuv420p', key_frame: 1 }))
        : [{ media_type: 'audio', stream_index: 1, pts: 0, nb_samples: 4, sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }] }));
      else if (args.includes('-show_packets') && selectedMethod === 'packet-identity-v1') bytes = Buffer.from(JSON.stringify({
        packets: [...pts.map((pts, i) => ({ codec_type: 'video', stream_index: 0, pts, dts: pts, duration: step, size: '6', flags: 'K__', data_hash: 'SHA256:' + admission.hash(admission.packet(i, true)) })),
          { codec_type: 'audio', stream_index: 1, pts: 0, dts: 0, duration: 4, size: '1', flags: 'K__', data_hash: 'SHA256:' + 'd'.repeat(64) }],
        programs: [], stream_groups: [], streams: (isOutput ? outputProbe : entry.inspection.probe).streams.map(s => ({ ...s, ...(s.codec_type === 'video' ? { has_b_frames: 0 } : {}) })) }));
      else if (args.includes('-show_packets')) bytes = Buffer.from(JSON.stringify({ packets: pts.map(pts =>
        ({ stream_index: 0, pts, duration: step, size: '6', data_hash: `SHA256:${'c'.repeat(64)}` })) }));
      else if (args.includes('-show_data')) bytes = Buffer.from(admission.hexDump(admission.extra(entry.inspection.probe.streams[index])));
      else if (args.includes('-bsf:v')) {
        bytes = Buffer.concat(pts.map((_, i) => admission.packet(i, true)));
        const auxiliary = Buffer.from('#hash: SHA256\n' + pts.map((_, i) => `0, 0, 0, 1, 6, ${admission.hash(admission.packet(i, true))}\n`).join('')
          + `1, 0, 0, 1, 1, ${'d'.repeat(64)}\n`);
        auxBytes = auxiliary.length; await options.onStdoutChunk(auxiliary, 3);
      }
      else if (args.includes('data')) bytes = admission.packet(Number(args[args.indexOf('-ss') + 1]) > 0 ? pts.length - 1 : 0, true);
      else if (args.includes('framehash')) {
        const selected = args.includes('-frames:v') ? [0] : pts;
        bytes = Buffer.from('#hash: SHA256\n' + selected.map((pts, i) => `0, ${i}, ${pts}, ${step}, 6, ${(isOutput && contentChanged ? 'd' : 'c').repeat(64)}\n`).join(''));
        if (args.includes('pipe:3')) { auxBytes = bytes.length; await options.onStdoutChunk(bytes, 3); }
      }
      else { assert.ok(args.includes('pcm_f32le')); bytes = Buffer.alloc(4 * 2 * 4, 5); }
    }
    await options.onStdoutChunk?.(bytes);
    if (cancelStage === 'verification' && (args.includes('-show_frames') || args.includes('-show_packets'))) void service.cancelCurrent();
    return { exitCode: 0, stdout: options.onStdoutChunk ? '' : bytes.toString(), stderr: '',
      ...(args.includes('pipe:3') ? { auxCapture: { streamed: true, truncated: false, totalBytes: auxBytes } } : {}),
      stderrCapture: { totalBytes: 0, truncated: false }, stdoutCapture: { totalBytes: bytes.length, truncated: false, streamed: Boolean(options.onStdoutChunk) } };
  };
  service.run = run;
  service.operationRuntime.requireCurrent = () => ({ runtimeIdentity: RUNTIME, environment: null });
  service.operationRuntime.invoke = (_token, tool, args, options) => run(tool === 'ffmpeg' ? service.ffmpeg : service.ffprobe, args, options);
  const validate = service.remuxOperations.validate.bind(service.remuxOperations);
  let refusedCopies = 0;
  service.remuxOperations.validate = (plan, probe, receipt) => {
    // Exercise the real private-receipt boundary while the plan is still live;
    // terminal service cleanup deliberately invalidates it afterwards.
    const forged = structuredClone(receipt), video = forged.essenceEvidence.streams.find(stream => stream.codecType === 'video');
    video.source.cadence.classification = video.output.cadence.classification = 'constant';
    assert.throws(() => validate(plan, probe, forged), { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' }); refusedCopies++;
    return validate(plan, probe, receipt);
  };
  service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }); await service.taskPromise;
  assert.deepEqual(await fs.readFile(entry.file), original);
  return { ...h, entry, outputProbe, refusedCopies, result: service.snapshot().items[0] };
}

test('main-selected packet verification publishes a genuine result row and cancellation in either stage never publishes', async t => {
  for (const cancelStage of [null, 'copy', 'verification']) {
    const h = await cadenceJob(t, { verificationMethod: 'packet-identity-v1', cancelStage });
    if (!cancelStage) {
      assert.equal(h.result.status, 'success', h.result.reason); assert.equal(h.result.verificationMethod, 'packet-identity-v1');
      assert.equal(h.entry.operationEvidence.verificationMethod, 'packet-identity-v1'); assert.equal(h.result.outputDisposition.published, true);
      assert.equal(h.entry.operationEvidence.invocations.filter(c => c.args.includes('-show_packets')).length, 2);
      assert.ok(h.entry.operationEvidence.invocations.every(c => !c.args.includes('-show_frames') || c.args.includes('-read_intervals')));
    } else {
      assert.equal(h.result.status, 'cancelled', h.result.reason); assert.notEqual(h.result.outputDisposition?.published, true);
      await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
    }
  }
  const changed = await cadenceJob(t, { verificationMethod: 'packet-identity-v1', contentChanged: true });
  assert.equal(changed.result.status, 'failed'); assert.equal(changed.result.reasonCode, 'REMUX_PACKET_WINDOW');
  assert.notEqual(changed.result.outputDisposition?.published, true); await assert.rejects(fs.stat(changed.entry.destination), { code: 'ENOENT' });
});

test('preferences and renderer requests cannot select the internal complete-native method', async t => {
  const { service, a, b } = await harness(t, { verificationMethod: 'packet-identity-v1' });
  assert.equal(service.remuxOperations.setDeepVerificationPreference, undefined);
  const app = await service.getAppSettings();
  await assert.rejects(service.saveAppSettings({ revision: app.revision, defaults: { ...app.defaults, remuxDeepVerification: true } }), { code: 'INVALID_APP_SETTINGS' });
  for (const fields of [{ verificationMethod: 'complete-native-v1' }, { remuxDeepVerification: true }, { maxConcurrentChildren: 2 }])
    await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska', ...fields }), { code: 'INVALID_REQUEST' });
  assert.equal(service.snapshot().items[0].verificationMethod, 'packet-identity-v1');
});

async function publicationClockJob(t, { stalled = false, Service = EncoderService } = {}) {
  let publishing = false, idleCheck, fakeNow = Date.now(), copiedReads = 0;
  const actualNow = Date.now, actualOpen = fs.open.bind(fs), actualLink = fs.link.bind(fs), actualInterval = global.setInterval;
  t.mock.method(Date, 'now', () => fakeNow);
  t.mock.method(global, 'setInterval', (callback, delay, ...args) => { if (delay === 1000) idleCheck = callback; return actualInterval(callback, delay, ...args); });
  t.mock.method(fs, 'link', async (source, destination) => { if (!/encoded\.mkv$/i.test(source)) return actualLink(source, destination);
    publishing = true; throw Object.assign(Error('owned fallback'), { code: 'ENOTSUP' }); });
  t.mock.method(fs, 'open', async (file, flags, ...args) => {
    const handle = await actualOpen(file, flags, ...args);
    if (!publishing || !/encoded\.mkv$|_Remux-MOV\.mov$/i.test(String(file))) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'read') return async (...params) => { const result = await target.read(...params); if (result.bytesRead) {
        copiedReads++; fakeNow += stalled ? 121000 : 80000; if (stalled) idleCheck?.();
      } return result; };
      if (key === 'stat') return async (...params) => { idleCheck?.(); return target.stat(...params); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  try {
    const h = await cadenceJob(t, { verificationMethod: 'packet-identity-v1', Service }); assert.ok(copiedReads > 0, JSON.stringify(h.result));
    if (stalled) assert.notEqual(h.result.outputDisposition?.published, true);
    else { assert.equal(h.result.status, 'success', h.result.reason); assert.equal(h.result.outputDisposition.published, true); assert.ok(copiedReads >= 3); }
  } finally { t.mock.restoreAll(); fakeNow = actualNow(); }
}
test('real publication copy and both complete hashes renew the main remux idle clock; stopped I/O never publishes; missing hook mutant is killed', async t => {
  await publicationClockJob(t); await publicationClockJob(t, { stalled: true });
  const file = require.resolve('../src/encoder-service.cjs'), raw = require('node:fs').readFileSync(file, 'utf8'), Module = require('node:module');
  const before = 'onProgress: event => advanceRemux(event.stage, event.completed)'; assert.equal(raw.split(before).length, 2);
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(raw.replace(before, ''), file);
  await assert.rejects(publicationClockJob(t, { Service: m.exports.EncoderService }), { code: 'ERR_ASSERTION' });
});

test('MOV publishes only constant/constant bound cadence; variable or insufficient collection never publishes', async t => {
  for (const options of [{}, { sourceVariable: true }, { outputVariable: true },
    { sourceVariable: true, outputVariable: true }, { insufficient: true }]) {
    const h = await cadenceJob(t, options);
    assert.equal(h.entry.operationEvidence.status, 'completed', JSON.stringify(h.entry.operationEvidence.failure));
    assert.equal(h.refusedCopies, 1);
    if (Object.keys(options).length === 0) {
      assert.equal(h.result.status, 'success', h.result.reason); assert.equal(h.result.outputDisposition.published, true);
      assert.ok((await fs.stat(h.entry.destination)).size > 0);
    } else {
      assert.equal(h.result.status, 'failed', h.result.reason); assert.equal(h.result.reasonCode, 'REMUX_MOV_CADENCE_UNQUALIFIED');
      assert.equal(h.result.outputDisposition.published, false);
      await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
    }
  }
});

test('matching variable MOV timing is refused even when native preservation checks alone would pass', async t => {
  const h = await cadenceJob(t, { sourceVariable: true, outputVariable: true });
  const video = h.entry.operationEvidence.essenceEvidence.streams.find(stream => stream.codecType === 'video');
  assert.deepEqual(video.source, video.output);
  assert.equal(h.result.reasonCode, 'REMUX_MOV_CADENCE_UNQUALIFIED');
  assert.equal(h.result.outputDisposition.published, false);
  await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
});

const MOV_V2 = 'h264-aac-lc-48k-stereo-v2';
test('MOV v2 publishes matching complete CFR/VFR and retains the exact average-summary warning', async t => {
  for (const options of [{}, { average: '60/1', nominal: '60/1', cadenceFps: 60 },
    { average: '30000/1000', nominal: '30/1' },
    ...[24, 25, 50].map(fps => ({ sourceVariable: true, outputVariable: true, average: `${fps}/1`, nominal: `${fps}/1` })),
    { sourceVariable: true, outputVariable: true, average: '20/1', nominal: '30/1' },
    { sourceVariable: true, outputVariable: true, outputAverage: '299/10' }]) {
    const h = await cadenceJob(t, { ...options, sourceEnvelope: MOV_V2 });
    assert.equal(h.result.status, 'success', h.result.reason); assert.equal(h.result.outputDisposition.published, true);
    assert.equal(h.refusedCopies, 1); assert.ok((await fs.stat(h.entry.destination)).size > 0);
    assert.deepEqual(h.result.warnings ?? [], options.outputAverage ? [{ code: 'OPERATION_VALIDATION_WARNING',
      message: 'Stream 0 → 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.' }] : []);
  }
});
test('MOV v2 refuses unmeasured constant24/25/50fps and mismatched summaries before publication', async t => {
  for (const options of [...[24, 25, 50].map(fps => ({ average: `${fps}/1`, nominal: `${fps}/1`, cadenceFps: fps })),
    { average: '30/1', nominal: '60/1' }, { average: '30/1', nominal: '24/1' }]) {
    const h = await cadenceJob(t, { ...options, sourceEnvelope: MOV_V2 });
    const video = h.entry.operationEvidence.essenceEvidence.streams.find(stream => stream.codecType === 'video');
    assert.equal(video.source.cadence.classification, 'constant'); assert.equal(video.output.cadence.classification, 'constant');
    assert.equal(h.entry.operationEvidence.status, 'completed');
    assert.equal(h.result.status, 'failed'); assert.equal(h.result.reasonCode, 'REMUX_MOV_RATE_UNQUALIFIED');
    assert.equal(h.result.outputDisposition.published, false);
    await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
  }
});
test('MOV v2 refuses mismatched or insufficient genuine cadence before publication', async t => {
  for (const options of [{ sourceVariable: true }, { outputVariable: true }, { insufficient: true }]) {
    const h = await cadenceJob(t, { ...options, sourceEnvelope: MOV_V2 });
    assert.equal(h.entry.operationEvidence.status, 'completed', JSON.stringify(h.entry.operationEvidence.failure));
    assert.equal(h.result.status, 'failed'); assert.equal(h.result.reasonCode, 'REMUX_MOV_CADENCE_UNQUALIFIED');
    assert.equal(h.refusedCopies, 1); assert.equal(h.result.outputDisposition.published, false);
    await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
  }
});
test('MOV v2 matching VFR never waives the unchanged timestamp or native-content checks', async t => {
  for (const options of [{ offsetTicks: 90 }, { contentChanged: true }]) {
    const h = await cadenceJob(t, { ...options, sourceEnvelope: MOV_V2, sourceVariable: true, outputVariable: true });
    assert.equal(h.entry.operationEvidence.status, 'completed', JSON.stringify(h.entry.operationEvidence.failure));
    assert.equal(h.result.status, 'failed'); assert.equal(h.result.outputDisposition.published, false);
    assert.match(h.result.reason, options.offsetTicks ? /maxPtsError|interval/ : /native essence/);
    await assert.rejects(fs.stat(h.entry.destination), { code: 'ENOENT' });
  }
});
test('Remux prepares a canonical Full copy without an encoder or quality settings', async t => {
  const { service } = await harness(t); const s = service.snapshot();
  assert.equal(s.operation, 'remux'); assert.equal(s.settings, null); assert.equal(s.phase, 'ready');
  assert.equal(s.items[0].status, 'ready', s.items[0].reason); assert.match(s.items[0].outputName, /_Remux-MKV\.mkv$/);
  const detail = service.getEncodingDetails({ planId: s.planId, fileId: s.items[0].id });
  assert.equal(detail.operation.contract.range.kind, 'full'); assert.ok(detail.args.includes('copy'));
  for (const option of ['-preset', '-crf', '-cq', '-vf', '-af', '-ss', '-t']) assert.ok(!detail.args.includes(option));
  const oldPlan = service.plan; service.invalidatePreparedEncoding(); assert.equal(service.plan, oldPlan);
});
test('known AAC conversion refuses; exact omission set enables only the remaining qualified video', async t => {
  const { service } = await harness(t, { target: 'mp4' }); let s = service.snapshot(), item = s.items[0];
  assert.equal(item.status, 'unsupported'); assert.match(item.reason, /AAC|priming|Matroska/i);
  const candidate = item.remux.omissionCandidates.find(value => value.streamIndex === 1); assert.ok(candidate);
  const oldPlan = s.planId;
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); item = s.items[0]; assert.notEqual(s.planId, oldPlan); assert.equal(item.status, 'ready', item.reason);
  assert.equal(item.remux.streams.find(value => value.streamIndex === 1).action, 'explicitly-omitted');
  assert.deepEqual(item.remux.omissionDecisionIds, [candidate.id]);
  const detail = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); assert.deepEqual(detail.operation.expectedOutput.streams.map(value => value.inputIndex), [0]);
  assert.throws(() => service.setRemuxOmissions({ planId: oldPlan, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] }), { code: 'STALE_PLAN' });
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [] });
  assert.equal(service.snapshot().items[0].status, 'unsupported');
});
test('explicit-audio MP4 route exposes the omission refusal and revokes Ready when the choice is cleared', async t => {
  const { service } = await harness(t, { target: 'mp4', explicitAudio: true });
  let s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.match(s.items[0].reason, /Matroska-to-MP4 requires a current explicit omission decision for every audio stream/);
  const candidate = s.items[0].remux.omissionCandidates.find(item => item.streamIndex === 1);
  assert.ok(candidate);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'ready', s.items[0].reason);
  const ready = s;
  assert.deepEqual(service.getEncodingDetails({ planId: s.planId, fileId: s.items[0].id }).operation.expectedOutput.streams.map(item => item.inputIndex), [0]);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.match(s.items[0].reason, /every audio stream/);
  assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [ready.items[0].id] }), { code: 'STALE_PLAN' });
});
test('an explicit audio omission cannot make an unrepresentable Matroska track tag Ready', async t => {
  const { service } = await harness(t, { target: 'mp4', explicitAudio: true, videoTags: { BPS: '12345' } });
  let s = service.snapshot(); assert.equal(s.items[0].reasonCode, 'REMUX_AUDIO_OMISSION_REQUIRED');
  const candidate = s.items[0].remux.omissionCandidates.find(item => item.streamIndex === 1);
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); assert.equal(s.items[0].status, 'unsupported');
  assert.equal(s.items[0].reasonCode, 'REMUX_TRACK_TAG_UNREPRESENTABLE'); assert.match(s.items[0].reason, /'BPS'/);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'INVALID_SELECTION' });
});
test('arbitrary/duplicate/foreign decisions and transforms cannot manufacture Remux authority', async t => {
  const { service, a, b } = await harness(t); const s = service.snapshot(), candidate = s.items[0].remux.omissionCandidates[0];
  for (const decisionIds of [[randomUUID()], [candidate.id, candidate.id], ['../source'], [{ id: candidate.id }]]) {
    assert.throws(() => service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds }));
  }
  await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska', args: ['-y'] }), { code: 'INVALID_REQUEST' });
  assert.throws(() => service.updateFileOperations({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision,
    fileIds: [s.items[0].id], overrides: { range: { startUs: 1 } } }));
});
test('changed source invalidates an omission before it can become prepared', async t => {
  const { service, input } = await harness(t); const s = service.snapshot(), candidate = s.items[0].remux.omissionCandidates[0];
  await fs.appendFile(path.join(input, s.items[0].name), 'changed');
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  assert.equal(service.snapshot().phase, 'failed'); assert.equal(service.plan, null);
});
test('ordinary reprepare and target changes revoke temporary omission decisions', async t => {
  const { service } = await harness(t); let s = service.snapshot(); const candidate = s.items[0].remux.omissionCandidates[0];
  await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [candidate.id] });
  s = service.snapshot(); await service.updateBatchOperationDefaults({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, overrides: { remuxTarget: 'mp4' } });
  s = service.snapshot(); assert.deepEqual(s.items[0].remux.omissionDecisionIds, []); assert.equal(s.items[0].status, 'unsupported');
});

test('cancelling a ready Remux batch revokes its old Start and omission authority', async t => {
  const { service } = await harness(t); const s = service.snapshot();
  await service.cancelBatch({ batchId: s.batchId });
  assert.equal(service.snapshot().phase, 'cancelled'); assert.equal(service.plan, null);
  assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [s.items[0].id] }), { code: 'STALE_PLAN' });
  assert.throws(() => service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id,
    revision: s.operationDraft.revision, decisionIds: [s.items[0].remux.omissionCandidates[0].id] }), { code: 'STALE_PLAN' });
});

test('ready Remux cancellation keeps admission closed until diagnostics and owned writes drain', async t => {
  const { service, a, b } = await harness(t), before = service.snapshot(), oldController = service.controller;
  let releaseIncident, releaseWrite, incidentEntered;
  const entered = new Promise(resolve => { incidentEntered = resolve; });
  const incident = new Promise(resolve => { releaseIncident = resolve; });
  const write = new Promise(resolve => { releaseWrite = resolve; });
  const record = service.recordIncident.bind(service);
  service.recordIncident = async event => {
    if (event.reason === 'PREPARED_REMUX_CANCELLED') { incidentEntered(); await incident; }
    return record(event);
  };
  service.appSettingsMutations.add(write);
  const cancelling = service.cancelBatch({ batchId: before.batchId }); await entered;
  const duplicate = service.cancelCurrent();
  try {
    assert.equal(service.snapshot().phase, 'cancelling');
    assert.equal(service.plan, null);
    await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' }), { code: 'BUSY' });
    assert.equal(service.controller, oldController);
    releaseIncident(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.snapshot().phase, 'cancelling', 'Saved writes must also drain before admission reopens.');
    await assert.rejects(service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' }), { code: 'BUSY' });
  } finally {
    releaseIncident(); releaseWrite(); await Promise.allSettled([cancelling, duplicate]);
    service.appSettingsMutations.delete(write);
  }
  assert.equal(service.snapshot().phase, 'cancelled');
  await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'matroska' });
  assert.notEqual(service.snapshot().batchId, before.batchId);
  assert.equal(service.snapshot().phase, 'ready');
  assert.equal(service.controller.signal.aborted, false, 'Completed old cancellation cannot abort the subsequent batch.');
});

// Injected child data, real queue/collector/protection/publication lifecycle.
test('copy and complete-verification cancellation never publish a destination', async t => {
  for (const cancelStage of ['copy', 'verification']) {
    const h = await cadenceJob(t, { cancelStage });
    assert.equal(h.result.status, 'cancelled', h.result.reason);
    assert.notEqual(h.result.outputDisposition?.published, true);
    await assert.rejects(fs.lstat(h.entry.destination), { code: 'ENOENT' });
    if (cancelStage === 'verification') assert.equal(h.entry.operationEvidence.status, 'cancelled');
  }
});

test('Linux standalone default policy refuses genuine variable finish hidden by equal30 summaries; unified v2 permits it', async t => {
 const Module=require('node:module'),syncFs=require('node:fs');
 const filename=require.resolve('../linux-blue/product-linux-remux-qualification.cjs');
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const real=m.require.bind(m);
 m.require=id=>id==='./product-linux-qualification.cjs'?{verifyProductSources(){}}:real(id);
 m._compile(syncFs.readFileSync(filename,'utf8'),filename);
 const {remuxPolicies}=require('../linux-blue/product-linux-remux-service.cjs');
 for(const unified of [false,true]){
  const q=m.exports.loadRemuxQualification(unified?{unifiedMovCadence:true}:undefined);
  const policy=remuxPolicies(q).find(p=>p.target==='mov');
  const h=await cadenceJob(t,{sourceVariable:true,outputVariable:true,average:'30/1',nominal:'30/1',sourceEnvelope:policy.sourceEnvelope});
  assert.equal(h.entry.operationEvidence.status,'completed');
  assert.equal(h.result.outputDisposition.published,unified);
  if(!unified){assert.equal(h.result.reasonCode,'REMUX_MOV_CADENCE_UNQUALIFIED');await assert.rejects(fs.stat(h.entry.destination),{code:'ENOENT'});}
  else assert.equal(h.result.status,'success',h.result.reason);
 }
});

test('only the exact shared stage during its own synchronous service handoff carries the emitted-stage observation',async t=>{
  const {requireServiceEmittedRemuxStage:check}=require('../src/encoder-service.cjs');
  const {createStage,cleanupStage}=require('../src/outputs.cjs');let calls=0,saved;
  class Observed extends EncoderService{
    async captureFolders(){await super.captureFolders();this.peer=await createStage(this.plan.output);}
    bindCreatedRemuxStage(entry,qualified,stage){
      calls++;saved={service:this,entry,stage};
      assert.doesNotThrow(()=>check(this,entry,stage));
      assert.throws(()=>check(this,entry,this.peer),{code:'REMUX_STAGE_ORIGIN'});
      assert.throws(()=>check(this,{...entry},stage),{code:'REMUX_STAGE_ORIGIN'});
      assert.throws(()=>check(Object.create(this),entry,stage),{code:'REMUX_STAGE_ORIGIN'});
      throw Object.assign(new Error('Deliberate non-native stop after observing the real service-created stage.'),{code:'TEST_STOP_BEFORE_COPY'});
    }
  }
  const h=await cadenceJob(t,{Service:Observed,verificationMethod:'packet-identity-v1'});
  assert.equal(calls,1);assert.equal(h.result.status,'failed');assert.equal(h.result.reasonCode,'TEST_STOP_BEFORE_COPY');
  assert.throws(()=>check(saved.service,saved.entry,saved.stage),{code:'REMUX_STAGE_ORIGIN'});
  assert.equal((await cleanupStage(h.service.peer)).retained,false);assert.deepEqual(await fs.readdir(h.output),[]);
});
