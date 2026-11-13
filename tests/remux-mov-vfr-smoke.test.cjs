'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const { remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { normalizeProbe } = require('../src/inspection.cjs');
const producer = require('../scripts/v07-mov-vfr-fixtures.cjs');
const TEST_ID = '11111111-1111-4111-8111-111111111111', TEST_SHA = '1'.repeat(64);
function loadProof({ catalog, mutate = text => text, bind = true } = {}) {
  const file = require.resolve('../scripts/v07-remux-mov-vfr-smoke.cjs'), catalogFile = require.resolve('../src/remux-catalog.cjs');
  let source = fs.readFileSync(file, 'utf8');
  if (bind) source = source.replace(/const FIXTURE_ID = '[^']*';/, "const FIXTURE_ID = '" + TEST_ID + "';")
    .replace(/const FIXTURE_REPORT_SHA = '[^']*';/, "const FIXTURE_REPORT_SHA = '" + TEST_SHA + "';");
  const temporary = new Module(file, module), native = Module.createRequire(file);
  temporary.filename = file; temporary.paths = Module._nodeModulePaths(path.dirname(file));
  temporary.require = request => catalog && native.resolve(request) === catalogFile ? catalog : native(request);
  temporary._compile(mutate(source), file); return temporary.exports;
}
const api = loadProof();
const { createSmoke, configuration, routeOptions, requireProductionRoute, requireStartBudget, requireGrowth, requireSpace, countFileCopy,
  requireOutcome, requireCadence, requireFixtureBinding, fixtureSource, FIXTURES, LIMITS, readMovReceipt, AVERAGE_WARNING } = api;

// All filesystem, tool, service and MOV-receipt dependencies below are inert.
// Running these factories exercises real orchestration and call sites only.
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const RECEIPT = path.join(ROOT, 'artifacts/v0.7/q2g-vfr-fixtures', TEST_ID, 'report.json');
function frameText(change = () => {}) {
  return Array.from({ length: 320 }, (_, i) => {
    const ordinal = Math.floor(i / 2) * 3 + (i % 2 ? 2 : 0);
    const row = { pts: ordinal * 1000, duration: (i % 2 ? 1 : 2) * 1000,
      key_frame: i === 0 ? 1 : 0, pict_type: i === 0 ? 'I' : i % 4 ? 'B' : 'P' };
    change(row, i);
    return 'frame|' + Object.entries(row).map(([key, value]) => key + '=' + value).join('|');
  }).join('\n') + '\n';
}
function sourceProbe(variable = false) {
  const duration = variable ? 8 : 10;
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', has_b_frames: 2, pix_fmt: 'yuv420p',
    width: variable ? 1280 : 1920, height: variable ? 720 : 1080, sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9',
    field_order: 'progressive', color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709',
    avg_frame_rate: variable ? '40/1' : '30/1', r_frame_rate: variable ? '60/1' : '30/1',
    time_base: '1/60000', start_pts: 0, start_time: '0', duration_ts: duration * 60000, duration: String(duration),
    disposition: { default: 1 }, tags: { language: 'und', handler_name: 'VideoHandler' } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: duration * 48000, duration: String(duration), disposition: { default: 1 },
    tags: { language: 'und', handler_name: 'SoundHandler' } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration), start_time: '0', size: '1000000', nb_streams: 2,
    nb_programs: 0, nb_stream_groups: 0 }, chapters: [], programs: [], stream_groups: [] };
}
function completeVideo(expected, change = () => {}) {
  const side = () => ({ complete: true, unitCount: expected.frames, firstPts: { numerator: '0', denominator: '1' },
    endPts: { numerator: expected.cadence === 'variable' ? '8' : '10', denominator: '1' },
    cadence: { version: 1, classification: expected.cadence, intervalCount: String(BigInt(expected.frames) - 1n),
      firstStep: { numerator: '1', denominator: '30' },
      differingStep: expected.cadence === 'variable' ? { numerator: '1', denominator: '60' } : null } });
  const video = { codecType: 'video', source: side(), output: side(), timestamps: { complete: true, comparedUnits: expected.frames,
    maxPtsError: { numerator: '0', denominator: '1' }, maxDurationError: { numerator: '0', denominator: '1' } } };
  change(video); return video;
}
function movReceipt() {
  return { version: 1, kind: 'owned-mov-mdhd-language', outputId: 'unit-output-id', outputSha256: 'c'.repeat(64),
    outputEvidenceFingerprint: 'd'.repeat(64), tracks: [0, 1].map(outputIndex => ({ outputIndex, trackId: outputIndex + 1,
      languageCode: 32767, mdhdSha256: 'e'.repeat(64) })) };
}
function harness(options = {}) {
  const nodes = new Map(), trace = { executions: [], starts: [], observations: 0, movReads: 0, liveChildren: 0, maxLiveChildren: 0 };
  let releaseHeld, enteredHeld;
  const held = new Promise(resolve => { releaseHeld = resolve; }), entered = new Promise(resolve => { enteredHeld = resolve; });
  let ino = 1;
  function directory(file) {
    if (nodes.has(file)) return;
    const parent = path.dirname(file); if (parent !== file) directory(parent);
    nodes.set(file, { directory: true, ino: ino++ });
  }
  function put(file, bytes) { directory(path.dirname(file)); nodes.set(file, { bytes: Buffer.from(bytes), ino: nodes.get(file)?.ino || ino++ }); }
  const expectedSha = value => value.sha256 || createHash('sha256').update('inert master ' + value.id).digest('hex');
  function receiptFor(values, variable) {
    const r = { id: TEST_ID, status: 'generated-and-inspected-owned-fixtures', leaseReleased: true, liveChildren: 0,
      allTrackedChildrenClosed: true, maximumConcurrentChildren: 1,
      runtime: { runtimeIdentity: require('../src/operation-catalog.cjs').FAMILIES[0].runtimeIdentity }, cases: [], invocations: [] };
    for (const value of values) {
      const probe = sourceProbe(variable); options.sourceChange?.(probe);
      const rawFrames = frameText(options.frameChange);
      const videoTiming = producer.assessVideoFrames(producer.FIXTURES[0], sourceProbe(true), frameText());
      r.cases.push({ id: value.id, output: value.file, status: 'generated-and-inspected', probe: normalizeProbe(probe), videoTiming,
        file: { sha256: expectedSha(value), bytes: value.bytes || Buffer.byteLength('inert master ' + value.id) } });
      r.invocations.push({ kind: 'metadata', argv: ['-i', value.file], exitCode: 0, stdout: JSON.stringify(probe) });
      r.invocations.push({ kind: 'source-video-timing', argv: ['-i', value.file], exitCode: 0, stdout: rawFrames, stderr: '',
        stdoutCapture: { truncated: false }, stderrCapture: { truncated: false } });
    }
    options.receiptChange?.(r); return r;
  }
  const receipts = new Map();
  for (const variable of [false, true]) {
    const values = Object.values(FIXTURES).filter(value => (value.cadence === 'variable') === variable);
    receipts.set(values[0].report, { bytes: Buffer.from(JSON.stringify(receiptFor(values, variable))), sha: values[0].reportSha256 });
  }
  const masters = new Map(Object.values(FIXTURES).map(value => {
    const bytes = value.bytes ? Buffer.alloc(value.bytes) : Buffer.from('inert master ' + value.id);
    if (value.bytes) bytes.write('inert master ' + value.id);
    return [value.file, bytes];
  }));
  const pins = new Map(Object.values(FIXTURES).map(value => [masters.get(value.file).toString(), expectedSha(value)]));
  for (const r of receipts.values()) pins.set(r.bytes.toString(), r.sha);
  const digest = bytes => pins.get(bytes.toString()) || createHash('sha256').update(bytes).digest('hex');
  function get(file) {
    if (!nodes.has(file)) {
      if (masters.has(file)) put(file, options.badMaster ? 'changed master' : masters.get(file));
      else if (receipts.has(file)) put(file, options.badReceipt ? Buffer.from(JSON.stringify({ ...JSON.parse(receipts.get(file).bytes), changed: true })) : receipts.get(file).bytes);
      else if (['main.js', 'preload.js', 'scripts/v07-remux-mov-vfr-smoke.cjs', 'scripts/v07-mov-vfr-fixtures.cjs'].some(name => file === path.join(ROOT, name))) put(file, 'inert frozen module');
      else throw Object.assign(new Error(`Missing inert path: ${file}`), { code: 'ENOENT' });
    }
    return nodes.get(file);
  }
  function stat(file, opts = {}) {
    const node = get(file), number = n => opts.bigint ? BigInt(n) : n;
    return { dev: number(1), ino: number(node.ino), size: number(file.endsWith('excess.inert') ? LIMITS.forecastBytes + 1 : node.bytes?.length || 0), nlink: number(1),
      mtimeNs: number(1), ctimeNs: number(1), birthtimeNs: number(1), isFile: () => !node.directory,
      isDirectory: () => Boolean(node.directory), isSymbolicLink: () => false };
  }
  const io = {
    mkdir: async file => directory(file), lstat: async (file, opts) => stat(file, opts), stat: async file => stat(file),
    readFile: async (file, encoding) => encoding ? get(file).bytes.toString(encoding) : Buffer.from(get(file).bytes),
    writeFile: async (file, bytes, opts = {}) => {
      if (opts.flag === 'wx' && nodes.has(file)) throw Object.assign(new Error('Exists'), { code: 'EEXIST' }); put(file, bytes);
    },
    readdir: async (file, opts) => {
      if (file === path.join(ROOT, 'src') && opts?.withFileTypes) return [];
      return [...nodes.keys()].filter(name => name !== file && path.dirname(name) === file).map(name => path.basename(name));
    },
    statfs: async file => ({ bsize: 1, bavail: file === OWNED && options.lowSpace ? 3 * 1024 ** 3 : 40 * 1024 ** 3 }),
    open: async file => {
      assert.equal(nodes.has(file), false); put(file, '');
      return { writeFile: async bytes => put(file, bytes), sync: async () => {}, stat: async opts => stat(file, opts), close: async () => {} };
    },
    unlink: async file => { nodes.delete(file); },
  };
  const runtime = { ffmpeg: path.join(ROOT, 'inert-tools/ffmpeg.exe'), ffprobe: path.join(ROOT, 'inert-tools/ffprobe.exe'), verified: [] };
  function outputProbe() {
    const p = sourceProbe(true);
    Object.assign(p.streams[0], { index: 0, id: '0x1', codec_tag_string: 'avc1', tags: { handler_name: 'VideoHandler' } });
    Object.assign(p.streams[1], { index: 1, id: '0x2', codec_tag_string: 'mp4a', tags: { handler_name: 'SoundHandler' } });
    Object.assign(p, { format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0 }, programs: [], stream_groups: [] });
    options.outputProbeChange?.(p); return p;
  }
  const runner = async (file, args, opts) => {
    trace.executions.push({ file, args });
    const child = new EventEmitter(); opts.onChild?.(child);
    trace.liveChildren++; trace.maxLiveChildren = Math.max(trace.maxLiveChildren, trace.liveChildren);
    try {
      if (options.concurrentProbe && trace.executions.length === 1) { enteredHeld(); await held; }
      if (file === runtime.ffmpeg) await io.writeFile(args.at(-1), 'inert child output');
      const probe = outputProbe(); options.captureProbeChange?.(probe);
      return { exitCode: 0, stdout: JSON.stringify(probe), stderr: '', stderrCapture: { totalBytes: 0, truncated: false } };
    } finally {
      child.emit('close', 0, null); trace.liveChildren--;
      if (options.changeModule && trace.executions.length === 1) put(path.join(ROOT, 'main.js'), 'changed frozen module');
    }
  };
  class FakeService {
    constructor(config) { this.config = config; this.folders = new Map(); this.plan = { entries: new Map() }; this.serial = 0; }
    async initializeDiagnostics() {
      const invoke = observed => observed
        ? this.config.operationRuntime.invoke({}, 'ffprobe', ['-version'], {}) : this.config.run(runtime.ffprobe, ['-version']);
      if (options.callStorm) for (let i = 0; i <= LIMITS.maxInvocations; i++) await invoke(Boolean(i % 2));
      if (options.concurrentProbe) {
        const first = invoke(options.concurrentProbe === 'observed-first');
        await entered;
        try { await invoke(options.concurrentProbe !== 'observed-first'); }
        finally { releaseHeld(); await first; }
      }
    }
    async registerFolder(file) { const id = String(this.folders.size); this.folders.set(id, file); return { id }; }
    async prepareRemuxBatch(request) {
      this.file = [...nodes.keys()].find(file => path.dirname(file) === this.folders.get(request.inputFolderId) && !get(file).directory);
      this.output = this.folders.get(request.outputFolderId); this.label = path.basename(this.output).replace(/^output-/, '');
      this.destination = path.join(this.output, path.basename(this.file) + '.' + request.target);
      this.state = { phase: 'ready', planId: `plan-${++this.serial}`, batchId: `batch-${this.serial}`,
        operationDraft: { id: 'draft', revision: this.serial }, items: [{ id: 'file', name: path.basename(this.file),
          status: nodes.has(this.destination) && !options.ignoreCollision ? 'skipped' : 'ready' }] };
      this.plan = { entries: new Map([['file', { destination: this.destination, outputId: 'unit-output-id',
        operationPlan: { runtimeIdentity: 'a'.repeat(64) }, remuxAssessment: {} }]]) };
    }
    snapshot() { return structuredClone(this.state); }
    async reencodeOutputs() {}
    getEncodingDetails() { return {}; }
    startBatch(request) {
      if ((!options.acceptStale && this.state.phase === 'cancelled') || request.planId !== this.state.planId) throw Object.assign(new Error('stale'), { code: 'STALE_PLAN' });
      if (this.state.items[0].status !== 'ready') throw Object.assign(new Error('not selected'), { code: 'INVALID_SELECTION' });
      trace.starts.push(this.label); this.taskPromise = this.complete();
    }
    async complete() {
      const count = options.extraCopies ? LIMITS.maxStarts + 1 : 1;
      for (let i = 0; i < count; i++) {
        const args = ['-n', '-i', this.file, '-c', 'copy', path.join(path.dirname(this.output), 'staging', `${this.label}-${i}`)];
        if (options.outsideWriter) args[args.length - 1] = path.join(path.dirname(this.output), '..', 'escape.inert');
        if (options.encodeWriter) args[args.indexOf('-c') + 1] = 'libx264';
        if (trace.executions.filter(value => value.file === runtime.ffmpeg).length % 2) await this.config.operationRuntime.invoke({}, 'ffmpeg', args, {});
        else await this.config.run(runtime.ffmpeg, args);
      }
      const item = this.state.items[0]; item.status = 'success'; item.outcome = options.badOutcome || options.averageWarning ? 'saved-with-warning' : 'saved';
      item.warnings = options.extraWarning ? [{ code: 'UNEXPECTED', key: 'vendor_id', message: 'Not reviewed' }] : options.averageWarning ? [{ ...AVERAGE_WARNING, ...options.warningChange }] : [];
      options.resultChange?.(item);
      item.evidenceStorage = { final: { violations: [] } };
      const outputSha256 = digest(Buffer.from('inert publication ' + this.label));
      const outputPath = path.join(path.dirname(this.output), 'staging', this.label + '-0');
      if (!options.missingOutputProbe) await this.config.run(runtime.ffprobe, ['-show_streams', '-show_format', '-i', outputPath]);
      const fingerprint = remuxProbeFingerprint(outputProbe());
      this.plan.entries.get('file').operationEvidence = { status: 'completed', outputProbeFingerprint: fingerprint, outputPath,
        essenceEvidence: { outputFileSha256: outputSha256, streams: [completeVideo(FIXTURES[this.label], video => {
          if (options.sourceCadence) video.source.cadence.classification = options.sourceCadence;
          if (options.outputCadence) video.output.cadence.classification = options.outputCadence;
          options.evidenceChange?.(video);
        })] } };
      this.plan.entries.get('file').fakeMov = { ...movReceipt(), outputSha256, outputEvidenceFingerprint: fingerprint };
      if (options.growth) put(path.join(path.dirname(this.output), 'excess.inert'), 'growth');

      put(this.destination, `inert publication ${this.label}`);
    }
    async cancelBatch() { this.state.phase = 'cancelled'; }
    async cancelCurrent() { if (this.taskPromise) await Promise.allSettled([this.taskPromise]); }
    async closeOperationResources() {}
    async closeDiagnostics() { return { persisted: true }; }
  }
  const run = (options.createSmoke || createSmoke)({ fs: io, sha: digest, runTool: runner, EncoderService: FakeService, randomUUID: () => 'inert-unit-run',
    readMovReceipt: (evidence, entry) => {
      trace.movReads++; const mov = structuredClone(entry.fakeMov);
      if (options.missingMov) return null;
      if (options.wrongMovHash) mov.outputSha256 = 'f'.repeat(64);
      if (options.wrongMovId) mov.outputId = 'foreign';
      if (options.wrongMovProbe) mov.outputEvidenceFingerprint = 'f'.repeat(64);
      if (options.wrongSeal) evidence.essenceEvidence.outputFileSha256 = 'f'.repeat(64);
      if (options.wrongLanguage) mov.tracks[0].languageCode = 0;
      if (options.wrongTrack) mov.tracks[1].trackId = mov.tracks[0].trackId;
      options.movChange?.(mov);
      return mov;
    },
    verifyCandidateRuntime: async () => runtime,
    createOperationControls: () => ({ operationRuntime: { invoke: async (_token, tool, args, opts) => { trace.observations++; return runner(runtime[tool], args, opts); } } }),
  });
  return { trace, run: (choices, mode = '--qualify') => run(['--run-owned-remux', mode, '--cases', choices]), nodes };
}


test('Q2g orchestration reaches MP4 and MOV sources with pinned outcomes, MOV receipts, cancel and collision', async () => {
  const h = harness(), result = await h.run('vfr-mp4-mov,vfr-mov-mov,cfr-mp4-mov');
  assert.equal(result.status, 'passed-bounded-copy-service', JSON.stringify(result.failure || result.closureFailures));
  assert.equal(result.acceptedStarts, 3); assert.equal(result.fileWritingCopies, 3); assert.equal(h.trace.movReads, 3);
  assert.equal(result.sourceProofs['cfr-mp4-mov'].averageRate, '30/1');
  assert.ok(h.trace.observations > 0);
  assert.equal(result.preparedCancel.staleStartRefused, true); assert.equal(result.existingOutputSkip.noNewCopy, true);
  assert.equal(result.leaseReleased, true); assert.deepEqual(result.closureFailures, []);
});
test('Q2g actual job guard refuses absent, foreign or changed MOV output receipt facts', async () => {
  for (const options of [{ missingMov: true }, { wrongMovHash: true }, { wrongMovId: true }, { wrongMovProbe: true },
    { wrongSeal: true }, { wrongLanguage: true }, { wrongTrack: true }]) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained', JSON.stringify(options));
    assert.equal(h.trace.movReads, 1); assert.deepEqual(h.trace.starts, ['vfr-mp4-mov']);
  }
});
test('Q2g actual job refuses unexpected warnings and publication outcome', async () => {
  for (const options of [{ extraWarning: true }, { badOutcome: true }]) {
    const h = harness(options), r = await h.run('vfr-mov-mov');
    assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /unexpected/);
  }
});
test('Q2g actual input preparation enforces source/receipt pins before Start', async () => {
  for (const options of [{ badReceipt: true }, { badMaster: true }]) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.starts, []); assert.deepEqual(h.trace.executions, []);
    if (options.badReceipt) assert.match(r.failure.message, /Retained fixture receipt changed/);
  }
});
test('Q2g orchestration refuses the 65th invocation before either runner path creates it', async () => {
  const h = harness({ callStorm: true }), r = await h.run('vfr-mp4-mov');
  assert.equal(LIMITS.maxInvocations, 64);
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Prospective invocation ceiling/);
  assert.equal(h.trace.executions.length, 64); assert.equal(r.invocations.length, 64);
  assert.ok(h.trace.observations > 0); assert.deepEqual(h.trace.starts, []);
  assert.equal(h.trace.liveChildren, 0);
});
test('Q2g orchestration refuses an excess Start before service admission, independently of the later copy ceiling', async () => {
  // A lower ceiling in a temporary in-memory module lets real CLI cases reach
  // an excess Start without inventing a fourth production proof case. Nothing
  // is written, and no dependency/CLI can alter the real fixed limits.
  const file = require.resolve('../scripts/v07-remux-mov-vfr-smoke.cjs');
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split('maxStarts: 3').length, 2);
  const limited = loadProof({ mutate: value => value.replace('maxStarts: 3', 'maxStarts: 1') });
  const h = harness({ createSmoke: limited.createSmoke }), r = await h.run('vfr-mp4-mov,vfr-mov-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Prospective Start ceiling/);
  assert.deepEqual(h.trace.starts, ['vfr-mp4-mov']);
  assert.equal(r.acceptedStarts, 1); assert.equal(r.fileWritingCopies, 1);
});
test('Q2g orchestration refuses a changed module hash before the next child, independently of final freeze', async () => {
  const h = harness({ changeModule: true }), r = await h.run('vfr-mp4-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Source modules changed before child admission/);
  assert.equal(h.trace.executions.length, 1); assert.equal(r.invocations.length, 1);
  assert.equal(h.trace.liveChildren, 0);
});
test('Q2g orchestration refuses a second live child through both direct/observed path orders', async () => {
  for (const concurrentProbe of ['direct-first', 'observed-first']) {
    const h = harness({ concurrentProbe }), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Concurrent child admission is forbidden/);
    assert.equal(h.trace.executions.length, 1); assert.equal(h.trace.maxLiveChildren, 1); assert.equal(h.trace.liveChildren, 0);
    assert.deepEqual(h.trace.starts, []); assert.equal(r.liveChildren, 0);
  }
});
test('Q2g both child paths enforce the fourth-copy refusal before execution', async () => {
  const h = harness({ extraCopies: true }), r = await h.run('vfr-mp4-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Start ceiling/);
  assert.equal(h.trace.executions.length, LIMITS.maxStarts); assert.ok(h.trace.observations > 0);
});
test('Q2g actual preflight refuses the storage floor and closure refuses excess growth', async () => {
  const h = harness({ lowSpace: true }), r = await h.run('vfr-mp4-mov');
  assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.executions.length, 0); assert.deepEqual(h.trace.starts, []);
  const g = await harness({ growth: true }).run('vfr-mp4-mov');
  assert.equal(g.status, 'failed-retained'); assert.ok(g.closureFailures.some(value => value.label === 'owned-growth'));
});
test('Q2g orchestration fails if the service accepts a stale Start or ignores a collision', async () => {
  for (const options of [{ acceptStale: true }, { ignoreCollision: true }]) {
    const r = await harness(options).run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained');
  }
});
test('Q2g retained source observations and receipt fields are checked at their harness call site', async () => {
  for (const options of [
    ...[p => { p.streams[0].has_b_frames = 0; }, p => { p.streams[0].pix_fmt = 'yuv420p10le'; },
      p => { p.streams[1].sample_rate = '44100'; }, p => { p.streams.pop(); }, p => { p.chapters.push({}); }]
      .map(sourceChange => ({ sourceChange })),
    ...[r => { r.cases[0].output = 'foreign'; }, r => { r.cases[0].file.sha256 = 'f'.repeat(64); },
      r => { r.cases[0].file.bytes++; }, r => { r.invocations[0].exitCode = 1; }].map(receiptChange => ({ receiptChange })),
  ]) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.starts, []); assert.deepEqual(h.trace.executions, []);
  }
});
test('Q2g actual output receipt guard refuses malformed tracks, kind, fingerprint and mdhd seals', async () => {
  for (const movChange of [m => { m.version = 2; }, m => { m.kind = 'copied-json'; }, m => { m.tracks.pop(); },
    m => { m.tracks[1].outputIndex = 4; }, m => { m.tracks[1].trackId = 0; }, m => { m.tracks[1].mdhdSha256 = 'bad'; },
    m => { m.outputEvidenceFingerprint = undefined; }]) {
    const h = harness({ movChange }), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.movReads, 1);
  }
  assert.throws(() => readMovReceipt({}, { operationPlan: { runtimeIdentity: 'a'.repeat(64) }, outputId: 'id' }),
    { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' });
});
test('Q2g actual writer admission refuses path escapes and encoders before creating a child', async () => {
  for (const options of [{ outsideWriter: true }, { encodeWriter: true }]) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.executions, []);
  }
});

test('Q2g actual output headers must bind collection and retain the pinned codec tags and handlers', async () => {
  for (const options of [{ missingOutputProbe: true },
    { captureProbeChange: p => { p.streams[0].id = '0x9'; } },
    { outputProbeChange: p => { p.streams[0].codec_tag_string = 'avc3'; } },
    { outputProbeChange: p => { p.streams[1].codec_tag_string = 'xxxx'; } },
    { outputProbeChange: p => { p.streams[1].tags.handler_name = 'foreign'; } }]) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.movReads, 1);
  }
});

test('Q2g accepts only exact CLI cases and refuses unfilled pins before any I/O or child', async () => {
  for (const mode of ['--qualify', '--normal']) assert.deepEqual(configuration(['--run-owned-remux', mode, '--cases', 'vfr-mp4-mov,cfr-mp4-mov']),
    { mode, choices: ['vfr-mp4-mov', 'cfr-mp4-mov'] });
  for (const args of [[], ['--run-owned-remux', '--qualify', '--cases', 'all'],
    ['--run-owned-remux', '--qualify', '--cases', 'vfr-mp4-mov,vfr-mp4-mov'],
    ['--run-owned-remux', '--qualify', '--cases', ''], ['--run-owned-remux', '--qualify', '--cases', '__proto__'],
    ['--run-owned-remux', '--qualify', '--cases', 'vfr-mp4-mov', '--maxStarts', '4']]) assert.throws(() => configuration(args));
  assert.throws(() => routeOptions('--fallback'));
  assert.throws(() => fixtureSource(Buffer.from('{}'), '__proto__'), { code: 'MOV_VFR_FIXTURE_CASE' });
  requireFixtureBinding(TEST_ID, TEST_SHA);
  for (const [id, sha] of [['ROOT_FILL_VFR_FIXTURE_ID', TEST_SHA], [TEST_ID, 'ROOT_FILL_VFR_REPORT_SHA256'],
    ['../escape', TEST_SHA], [TEST_ID, 'f'.repeat(63)], [TEST_ID, 'G'.repeat(64)], [{}, TEST_SHA]])
    assert.throws(() => requireFixtureBinding(id, sha), { code: 'MOV_VFR_FIXTURE_BINDING' });
  const unfilled = loadProof({ mutate: source => source.replace(TEST_ID, 'ROOT_FILL_VFR_FIXTURE_ID') });
  const h = harness({ createSmoke: unfilled.createSmoke });
  await assert.rejects(h.run('vfr-mp4-mov'), { code: 'MOV_VFR_FIXTURE_BINDING' });
  assert.equal(h.nodes.size, 0); assert.deepEqual(h.trace.executions, []); assert.deepEqual(h.trace.starts, []);
});

test('Q2g normal mode uses the real supplied catalog and refuses any route without the reviewed v2 envelope', async () => {
  const rest = REMUX_POLICIES.filter(route => route.inputFamily !== 'isobmff' || route.target !== 'mov');
  const route = { id: 'full-remux-isobmff-mov-v1', inputFamily: 'isobmff', target: 'mov', allowAncillary: false,
    allowRotation90: false, sourceEnvelope: 'h264-aac-lc-48k-stereo-v2' };
  for (const id of ['full-remux-isobmff-mov-v1', 'full-remux-isobmff-mov-v2']) {
    const policies = [...rest, { ...route, id }], identity = 'test-reviewed-catalog-' + id;
    const normal = loadProof({ catalog: { REMUX_POLICIES: policies, REMUX_POLICY_ID: identity } });
    assert.equal(normal.routeOptions('--normal').remuxPolicies, policies);
    assert.equal(normal.routeOptions('--normal').remuxPolicyIdentity, identity);
    const r = await harness({ createSmoke: normal.createSmoke }).run('vfr-mp4-mov', '--normal');
    assert.equal(r.status, 'passed-bounded-copy-service', JSON.stringify(r.failure));
  }
  for (const routes of [[], [route, route], ...[{ sourceEnvelope: 'h264-aac-lc-48k-stereo-v1' },
    { sourceEnvelope: undefined }, { allowAncillary: true }, { allowRotation90: true }, { id: 'laboratory' }]
    .map(delta => [{ ...route, ...delta }])]) {
    const refused = loadProof({ catalog: { REMUX_POLICIES: [...rest, ...routes], REMUX_POLICY_ID } });
    const h = harness({ createSmoke: refused.createSmoke });
    await assert.rejects(h.run('vfr-mp4-mov', '--normal'), { code: 'MOV_VFR_PRODUCTION_ROUTE' });
    assert.equal(h.nodes.size, 0); assert.deepEqual(h.trace.starts, []);
  }
  const qualify = routeOptions('--qualify');
  assert.equal(qualify.remuxPolicies.length, rest.length + 1);
  assert.deepEqual(qualify.remuxPolicies.slice(0, -1), rest);
  assert.equal(qualify.remuxPolicies.at(-1).sourceEnvelope, 'h264-aac-lc-48k-stereo-v2');
});

test('Q2g records only the two declared VFR warning alternatives and keeps the CFR control warning-free', async () => {
  assert.equal(AVERAGE_WARNING.message,
    'Stream 0 → 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.');
  for (const averageWarning of [false, true]) {
    const h = harness({ averageWarning }), r = await h.run('vfr-mp4-mov,vfr-mov-mov');
    assert.equal(r.status, 'passed-bounded-copy-service', JSON.stringify(r.failure));
    assert.deepEqual(r.cases.map(value => value.warningSet), [averageWarning ? 'variable-average' : 'no-warnings', averageWarning ? 'variable-average' : 'no-warnings']);
  }
  const control = await harness({ averageWarning: true }).run('cfr-mp4-mov');
  assert.equal(control.failure.code, 'MOV_VFR_PROOF_OUTCOME');
  for (const warningChange of [{ code: 'OTHER' }, { key: 'VENDOR_ID' }, { message: 'Changed average warning' }]) {
    const r = await harness({ averageWarning: true, warningChange }).run('vfr-mp4-mov');
    assert.equal(r.failure.code, 'MOV_VFR_PROOF_OUTCOME');
  }
  for (const resultChange of [r => { r.warnings.push({ ...r.warnings[0] }); },
    r => { r.outcome = 'saved'; }, r => { r.warnings = []; }]) {
    const r = await harness({ averageWarning: true, resultChange }).run('vfr-mp4-mov');
    assert.equal(r.failure.code, 'MOV_VFR_PROOF_OUTCOME');
  }
});

test('Q2g post-copy call sites refuse insufficient/mismatched/incomplete cadence and each malformed witness field', async () => {
  const changes = [v => { v.source.cadence.classification = 'constant'; }, v => { v.output.cadence.classification = 'constant'; },
    v => { v.source.cadence.classification = v.output.cadence.classification = 'insufficient'; },
    v => { v.source.complete = false; }, v => { v.output.complete = false; },
    v => { delete v.source.cadence; }, v => { v.output.unitCount = '319'; }, v => { v.source.cadence.version = 2; },
    v => { v.source.cadence.intervalCount = '318'; }, v => { v.output.cadence.firstStep.numerator = '0'; },
    v => { v.output.cadence.differingStep = { numerator: '2', denominator: '60' }; },
    v => { v.source.cadence.differingStep = null; }, v => { v.output.cadence.firstStep.denominator = '0'; }];
  for (const evidenceChange of changes) {
    const h = harness({ evidenceChange }), r = await h.run('vfr-mp4-mov');
    assert.equal(r.failure.code, 'MOV_VFR_PROOF_CADENCE', JSON.stringify(r.failure));
    assert.deepEqual(h.trace.starts, ['vfr-mp4-mov']);
  }
  const badControl = await harness({ evidenceChange: v => { v.source.cadence.differingStep = { numerator: '1', denominator: '60' }; } }).run('cfr-mp4-mov');
  assert.equal(badControl.failure.code, 'MOV_VFR_PROOF_CADENCE');
  const noVideo = { streams: [] }, duplicate = { streams: [completeVideo(FIXTURES['vfr-mp4-mov']), completeVideo(FIXTURES['vfr-mp4-mov'])] };
  for (const essence of [noVideo, duplicate]) assert.throws(() => requireCadence(essence, FIXTURES['vfr-mp4-mov']), { code: 'MOV_VFR_PROOF_CADENCE' });
});

test('Q2g proof call sites enforce exact timing and the60000Hz output clock', async () => {
  for (const evidenceChange of [v => { v.timestamps.complete = false; }, v => { v.timestamps.comparedUnits = '319'; },
    v => { v.timestamps.maxPtsError.numerator = '1'; }, v => { v.timestamps.maxDurationError.numerator = '1'; },
    v => { v.timestamps.maxPtsError.denominator = '0'; }, v => { v.output.endPts.numerator = '9'; },
    v => { v.output.firstPts.numerator = '1'; }]) {
    const r = await harness({ evidenceChange }).run('vfr-mp4-mov'); assert.equal(r.failure.code, 'MOV_VFR_PROOF_TIMING');
  }
  const r = await harness({ outputProbeChange: p => { p.streams[0].time_base = '1/30000'; } }).run('vfr-mp4-mov');
  assert.equal(r.failure.code, 'MOV_VFR_PROOF_CLOCK');
});

test('Q2g pre-Start call sites recheck closed fixture provenance, full raw timing, frame count and B pictures', async () => {
  const corruptions = [
    ...[r => { r.id = TEST_ID.replace(/^1/, '2'); }, r => { r.status = 'failed-retained'; }, r => { r.leaseReleased = false; },
      r => { r.liveChildren = 1; }, r => { r.allTrackedChildrenClosed = false; }, r => { r.maximumConcurrentChildren = 2; },
      r => { r.runtime.runtimeIdentity = 'f'.repeat(64); }, r => { r.cases[0].status = 'planned'; },
      r => { r.invocations[1].stdoutCapture.truncated = true; }, r => { r.invocations[1].stderrCapture.truncated = true; },
      r => { r.invocations[1].stderr = 'decoder error'; }, r => { r.invocations[1].exitCode = 1; },
      r => { r.cases[0].videoTiming.frames--; }, r => { r.cases[0].probe.streams[0].avg_frame_rate = '39/1'; },
      r => { r.invocations[1].stdout = r.invocations[1].stdout.split('\n').slice(0, -2).join('\n') + '\n'; },
      r => { r.cases[0].file.sha256 = 'bad'; }, r => { r.cases[0].file.bytes = 0; },
      r => { r.cases[0].file.bytes = 256 * 1024 ** 2 + 1; }].map(receiptChange => ({ receiptChange })),
    ...[p => { p.streams[0].avg_frame_rate = '61/1'; }, p => { p.streams[0].r_frame_rate = '0/0'; },
      p => { p.streams[0].time_base = '1/30000'; }].map(sourceChange => ({ sourceChange })),
    ...[(row, i) => { if (i === 1) row.pts++; }, (row, i) => { if (i === 319) row.duration++; },
      row => { row.pict_type = 'P'; }, row => { row.pict_type = 'X'; }, row => { row.key_frame = 2; }]
      .map(frameChange => ({ frameChange })),
  ];
  for (const options of corruptions) {
    const h = harness(options), r = await h.run('vfr-mp4-mov');
    assert.equal(r.status, 'failed-retained', JSON.stringify(options)); assert.deepEqual(h.trace.starts, []); assert.deepEqual(h.trace.executions, []);
  }
});

function fixtureHarness(options = {}) {
  const nodes = new Map(), trace = { children: [], opens: [], live: 0, maxLive: 0 }; let serial = 1, clock = 1;
  const error = code => Object.assign(new Error(code), { code });
  function dir(file) {
    if (nodes.has(file)) return;
    const parent = path.dirname(file); if (parent !== file) dir(parent);
    nodes.set(file, { directory: true, ino: serial++, mtime: clock++ });
  }
  function put(file, bytes) {
    dir(path.dirname(file)); const old = nodes.get(file);
    nodes.set(file, { bytes: Buffer.from(bytes), ino: old?.ino || serial++, mtime: clock++ });
  }
  function get(file) { const n = nodes.get(file); if (!n) throw error('ENOENT'); return n; }
  function stat(file, opts = {}) {
    const n = get(file), number = value => opts.bigint ? BigInt(value) : value;
    return { dev: number(1), ino: number(n.ino), size: number(n.bytes?.length || 0), nlink: number(1),
      mtimeNs: number(n.mtime), ctimeNs: number(n.mtime), birthtimeNs: number(n.ino),
      isFile: () => !n.directory, isDirectory: () => Boolean(n.directory), isSymbolicLink: () => false };
  }
  dir(ROOT); dir(path.join(OWNED, 'fixtures'));
  const runtime = { ffmpeg: path.join(ROOT, 'inert/ffmpeg.exe'), ffprobe: path.join(ROOT, 'inert/ffprobe.exe'),
    verified: [{ sizeBytes: 1, sha256: 'a'.repeat(64) }, { sizeBytes: 1, sha256: 'b'.repeat(64) }] };
  put(runtime.ffmpeg, 'F'); put(runtime.ffprobe, 'P');
  const io = {
    mkdir: async file => { if (nodes.has(file)) throw error('EEXIST'); dir(file); },
    lstat: async (file, opts) => stat(file, opts), realpath: async file => path.resolve(file),
    readdir: async file => { get(file); return [...nodes.keys()].filter(p => p !== file && path.dirname(p) === file).map(p => path.basename(p)); },
    statfs: async file => ({ bsize: 1, bavail: options.lowSpace && file === ROOT ? 1 : 40 * 1024 ** 3 }),
    unlink: async file => { get(file); nodes.delete(file); },
    open: async (file, mode) => {
      trace.opens.push({ file, mode });
      if (mode === 'wx+') { if (nodes.has(file)) throw error('EEXIST'); put(file, ''); } else assert.equal(mode, 'r');
      get(file);
      return {
        stat: async opts => stat(file, opts), sync: async () => {}, close: async () => {},
        writeFile: async bytes => put(file, bytes),
        write: async (bytes, offset, length, position) => {
          const old = get(file).bytes, combined = Buffer.alloc(Math.max(old.length, position + length)); old.copy(combined);
          bytes.copy(combined, position, offset, offset + length); put(file, combined); return { bytesWritten: length };
        },
        truncate: async length => { const bytes = Buffer.alloc(length); get(file).bytes.copy(bytes); put(file, bytes); },
        read: async (bytes, offset, length, position) => {
          const content = get(file).bytes.subarray(position, position + length); content.copy(bytes, offset); return { bytesRead: content.length };
        },
        createReadStream: () => (async function* () { yield Buffer.from(get(file).bytes); })(),
      };
    },
  };
  const runTool = async (file, args, opts) => {
    trace.children.push({ file, args });
    const child = new EventEmitter(); opts.onChild?.(child); trace.live++; trace.maxLive = Math.max(trace.maxLive, trace.live);
    try {
      let stdout = '';
      if (args.includes('-version')) stdout = 'ffmpeg version 9.0.2-full_build-www.gyan.dev\n';
      else if (file === runtime.ffmpeg) { assert.ok(args.includes('-n')); assert.equal(nodes.has(args.at(-1)), false); put(args.at(-1), 'inert generated fixture'); }
      else if (args.includes('-show_frames')) stdout = options.frameText ?? frameText(options.frameChange);
      else { const p = sourceProbe(true); options.metadataChange?.(p); stdout = JSON.stringify(p); }
      return { exitCode: 0, stdout, stderr: '', stdoutCapture: { totalBytes: Buffer.byteLength(stdout), truncated: false },
        stderrCapture: { totalBytes: 0, truncated: false } };
    } finally { child.emit('close', 0, null); trace.live--; }
  };
  const run = (options.createFixtures || producer.createFixtures)({ fs: io, runTool, verifyCandidateRuntime: async () => runtime,
    assertOrdinaryPath: async file => { get(file); }, randomUUID: () => TEST_ID, platform: 'win32' });
  return { trace, nodes, run: async args => {
    const result = await run(args || ['--run-owned-fixtures']);
    return { result, report: JSON.parse(get(result.report).bytes) };
  } };
}

test('Q2g fixture producer really wires two generated sources, complete raw observations, wx receipts and closure', async () => {
  const h = fixtureHarness(), { result, report } = await h.run();
  assert.equal(result.status, 'generated-and-inspected-owned-fixtures', JSON.stringify(result.failure));
  assert.equal(report.invocations.length, 8); assert.equal(h.trace.children.length, 8); assert.equal(h.trace.maxLive, 1);
  assert.deepEqual(report.cases.map(value => value.container), ['mp4', 'mov']);
  assert.ok(report.cases.every(value => value.videoTiming.classification === 'variable' && value.videoTiming.frames === 320
    && value.videoTiming.pictureTypes.B > 0 && /^[a-f0-9]{64}$/.test(value.file.sha256) && value.probe.streams[1].profile === 'LC'));
  assert.equal(report.liveChildren, 0); assert.equal(report.allTrackedChildrenClosed, true); assert.equal(report.leaseReleased, true);
  assert.ok(h.trace.opens.filter(value => !value.file.endsWith('.mp4') && !value.file.endsWith('.mov')).every(value => value.mode === 'wx+'));
  assert.ok(h.trace.children.filter(value => value.file.endsWith('ffmpeg.exe') && !value.args.includes('-version')).every(value =>
    value.args.at(-1).startsWith(path.join(OWNED, 'fixtures', 'mov-vfr-' + TEST_ID)) && value.args.includes('-n') && !value.args.includes('-y')));
});
test('Q2g fixture producer call sites fail closed on invalid metadata, incomplete timing, absent B pictures and low storage', async () => {
  for (const [options, code] of [
    [{ metadataChange: p => { p.streams[0].avg_frame_rate = '61/1'; } }, 'MOV_VFR_FIXTURE_RATE'],
    [{ metadataChange: p => { p.streams[0].r_frame_rate = '0/0'; } }, 'MOV_VFR_FIXTURE_RATIO'],
    [{ metadataChange: p => { p.streams[0].time_base = '1/30000'; p.streams[0].duration_ts /= 2; },
      frameChange: row => { row.pts /= 2; row.duration /= 2; } }, 'MOV_VFR_FIXTURE_CLOCK'],
    [{ frameText: frameText().split('\n').slice(0, -2).join('\n') + '\n' }, 'MOV_VFR_FIXTURE_FRAME_COUNT'],
    [{ frameChange: row => { row.pict_type = 'P'; } }, 'MOV_VFR_FIXTURE_B_FRAMES'],
    [{ frameChange: (row, i) => { if (i === 319) row.duration++; } }, 'MOV_VFR_FIXTURE_TIMING'],
    [{ frameChange: row => { row.key_frame = 2; } }, 'MOV_VFR_FIXTURE_PICTURE_TYPE'],
  ]) {
    const h = fixtureHarness(options), { result, report } = await h.run();
    assert.equal(result.status, 'failed-retained'); assert.equal(result.failure.code, code, JSON.stringify(result.failure));
    if (options.metadataChange) {
      assert.equal(h.trace.children.length, 4, 'Bad metadata must stop after two versions, generation and metadata.');
      assert.equal(h.trace.children.some(child => child.args.includes('-show_frames')), false, 'Invalid metadata must never launch the timing child.');
    }
    assert.equal(report.leaseReleased, true); assert.equal(report.liveChildren, 0);
    assert.equal(report.cases.length, 1); assert.ok(h.nodes.has(report.cases[0].output), 'Failed synthetic fixture stays retained.');
  }
  const h = fixtureHarness({ lowSpace: true }), r = await h.run();
  assert.equal(r.result.status, 'failed-retained'); assert.deepEqual(h.trace.children, []);
});
test('Q2g raw PTS and duration lexical guards independently reject noncanonical integers', () => {
  for (const field of ['pts', 'duration']) {
    const text = frameText(row => { row[field] = '00' + row[field]; });
    // BigInt accepts these exact values and later timing math would pass. Only
    // the lexical guard rejects their noncanonical spelling; no other guard
    // or frame-count/timestamp change masks its removal.
    assert.throws(() => producer.assessVideoFrames(producer.FIXTURES[0], sourceProbe(true), text),
      { code: 'MOV_VFR_FIXTURE_TIMING' });
  }
});
test('Q2g outcome label guard independently refuses unknown and inherited labels with its specific code', () => {
  for (const label of ['unreviewed-mov', '__proto__']) assert.throws(() =>
    requireOutcome(label, { outcome: 'saved', warnings: [] }), { code: 'MOV_VFR_PROOF_OUTCOME' });
});
test('Q2g fixture producer refuses excess children and unknown arguments/specs at their actual call sites', async () => {
  const file = require.resolve('../scripts/v07-mov-vfr-fixtures.cjs'), source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split('maximumChildren: 8').length, 2);
  const temporary = new Module(file, module); temporary.filename = file; temporary.paths = Module._nodeModulePaths(path.dirname(file));
  temporary._compile(source.replace('maximumChildren: 8', 'maximumChildren: 7'), file);
  const h = fixtureHarness({ createFixtures: temporary.exports.createFixtures }), r = await h.run();
  assert.equal(r.result.status, 'failed-retained'); assert.match(r.result.failure.message, /Child budget exhausted/);
  assert.equal(h.trace.children.length, 7); assert.equal(r.report.liveChildren, 0); assert.equal(r.report.leaseReleased, true);
  for (const args of [[], ['--run-owned-fixtures', '--maxChildren', '10']]) {
    const invalid = fixtureHarness(); await assert.rejects(invalid.run(args)); assert.deepEqual(invalid.trace.children, []); assert.deepEqual(invalid.trace.opens, []);
  }
  const spec = producer.FIXTURES[0], argv = producer.generationArgs(spec, 'inert.mp4', 1024 ** 2);
  assert.ok(argv.includes('1/60000') && argv.includes('60000') && argv.includes('aac') && argv.includes('passthrough'));
  assert.equal(argv[argv.indexOf('-vf') + 1].includes('select=not(eq(mod(n\\,3)\\,1))'), true);
  assert.equal(producer.LIMITS.maximumChildren, 8);
  assert.throws(() => producer.generationArgs({ ...spec }, 'inert.mp4', 1024 ** 2), { code: 'MOV_VFR_FIXTURE_SPEC' });
  assert.throws(() => producer.assessVideoFrames({ ...spec }, sourceProbe(true), frameText()), { code: 'MOV_VFR_FIXTURE_SPEC' });
});
