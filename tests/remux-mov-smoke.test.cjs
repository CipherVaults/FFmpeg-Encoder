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
const { createSmoke, configuration, routeOptions, requireProductionRoute, requireStartBudget, requireGrowth, requireSpace, countFileCopy,
  requireOutcome, requireMovReceipt, fixtureSource, requireSourceObservation, FIXTURES, LIMITS, readMovReceipt } = require('../scripts/v07-remux-mov-smoke.cjs');

// The real orchestration runs here with a wholly in-memory filesystem, inert
// byte fixtures, a fake service and a fake runner. No filesystem or child API
// is called by these dependencies; this is wiring evidence, never media proof.
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const RECEIPT = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const RECEIPT_SHA = '17f7e802480f092093f5dcaebc61f78c0710a5fc36b444f016933871c4e647a9';
function sourceProbe() {
  return { streams: [{ codec_type: 'video', codec_name: 'h264', profile: 'High', has_b_frames: 2, pix_fmt: 'yuv420p',
    field_order: 'progressive', color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709',
    avg_frame_rate: '30/1', r_frame_rate: '30/1' },
  { codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }], chapters: [] };
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
  const receiptData = { cases: Object.values(FIXTURES).map(value =>
    ({ id: value.id, output: value.file, file: { sha256: value.sha256, bytes: value.bytes } })),
  invocations: Object.values(FIXTURES).map(value => {
    const probe = sourceProbe(); Object.assign(probe.streams[0], { avg_frame_rate: value.fps, r_frame_rate: value.fps });
    options.sourceChange?.(probe);
    return { kind: 'metadata', argv: ['-i', value.file], exitCode: 0, stdout: JSON.stringify(probe) };
  }) };
  options.receiptChange?.(receiptData);
  const receipt = Buffer.from(JSON.stringify(receiptData));
  // Valid JSON with an irrelevant extra field: without the SHA guard it must
  // reach successful orchestration, rather than failing a parser/shape check.
  const changedReceipt = Buffer.from(JSON.stringify({ ...receiptData, alteredReceiptNote: 'valid altered content' }));
  const masters = new Map(Object.values(FIXTURES).map(value => [value.file, Buffer.from('inert master ' + value.id)]));
  // Synthetic SHA adapter is available only through the imported factory seam.
  const pins = new Map(Object.values(FIXTURES).map(value => ['inert master ' + value.id, value.sha256]));
  pins.set(receipt.toString(), RECEIPT_SHA);
  const digest = bytes => pins.get(bytes.toString()) || createHash('sha256').update(bytes).digest('hex');
  function get(file) {
    if (!nodes.has(file)) {
      if (masters.has(file)) put(file, options.badMaster ? 'changed master' : masters.get(file));
      else if (file === RECEIPT) put(file, options.badReceipt ? changedReceipt : receipt);
      else if (['main.js', 'preload.js', 'scripts/v07-remux-mov-smoke.cjs'].some(name => file === path.join(ROOT, name))) put(file, 'inert frozen module');
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
    const p = sourceProbe();
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
      const item = this.state.items[0]; item.status = 'success'; item.outcome = options.badOutcome ? 'saved-with-warning' : 'saved';
      item.warnings = options.extraWarning ? [{ code: 'UNEXPECTED', key: 'vendor_id', message: 'Not reviewed' }] : [];
      item.evidenceStorage = { final: { violations: [] } };
      const outputSha256 = digest(Buffer.from('inert publication ' + this.label));
      const outputPath = path.join(path.dirname(this.output), 'staging', this.label + '-0');
      if (!options.missingOutputProbe) await this.config.run(runtime.ffprobe, ['-show_streams', '-show_format', '-i', outputPath]);
      const fingerprint = remuxProbeFingerprint(outputProbe());
      this.plan.entries.get('file').operationEvidence = { status: 'completed', outputProbeFingerprint: fingerprint, outputPath,
        essenceEvidence: { outputFileSha256: outputSha256, streams: [{ codecType: 'video',
          source: { cadence: { classification: options.sourceVariable ? 'variable' : 'constant' } },
          output: { cadence: { classification: options.outputVariable ? 'variable' : 'constant' } } }] } };
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
  return { trace, run: choices => run(['--run-owned-remux', '--qualify', '--cases', choices]), nodes };
}


test('Q2e orchestration reaches MP4 and MOV sources with pinned outcomes, MOV receipts, cancel and collision', async () => {
  const h = harness(), result = await h.run('mp4-a-mov,mov-b-mov,mp4-c-mov');
  assert.equal(result.status, 'passed-bounded-copy-service', JSON.stringify(result.failure || result.closureFailures));
  assert.equal(result.acceptedStarts, 3); assert.equal(result.fileWritingCopies, 3); assert.equal(h.trace.movReads, 3);
  assert.equal(result.sourceProofs['mp4-c-mov'].fps, '60/1');
  assert.ok(h.trace.observations > 0);
  assert.equal(result.preparedCancel.staleStartRefused, true); assert.equal(result.existingOutputSkip.noNewCopy, true);
  assert.equal(result.leaseReleased, true); assert.deepEqual(result.closureFailures, []);
});
test('Q2e actual job guard refuses absent, foreign or changed MOV output receipt facts', async () => {
  for (const options of [{ missingMov: true }, { wrongMovHash: true }, { wrongMovId: true }, { wrongMovProbe: true },
    { wrongSeal: true }, { wrongLanguage: true }, { wrongTrack: true }]) {
    const h = harness(options), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained', JSON.stringify(options));
    assert.equal(h.trace.movReads, 1); assert.deepEqual(h.trace.starts, ['mp4-a-mov']);
  }
});
test('Q2e actual job refuses unexpected warnings and publication outcome', async () => {
  for (const options of [{ extraWarning: true }, { badOutcome: true }]) {
    const h = harness(options), r = await h.run('mov-b-mov');
    assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /unexpected/);
  }
});
test('Q2e actual input preparation enforces source/receipt pins before Start', async () => {
  for (const options of [{ badReceipt: true }, { badMaster: true }]) {
    const h = harness(options), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.starts, []); assert.deepEqual(h.trace.executions, []);
    if (options.badReceipt) assert.match(r.failure.message, /Retained fixture receipt changed/);
  }
});
test('Q2e orchestration refuses the 65th invocation before either runner path creates it', async () => {
  const h = harness({ callStorm: true }), r = await h.run('mp4-a-mov');
  assert.equal(LIMITS.maxInvocations, 64);
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Prospective invocation ceiling/);
  assert.equal(h.trace.executions.length, 64); assert.equal(r.invocations.length, 64);
  assert.ok(h.trace.observations > 0); assert.deepEqual(h.trace.starts, []);
  assert.equal(h.trace.liveChildren, 0);
});
test('Q2e orchestration refuses an excess Start before service admission, independently of the later copy ceiling', async () => {
  // A lower ceiling in a temporary in-memory module lets real CLI cases reach
  // an excess Start without inventing a fourth production proof case. Nothing
  // is written, and no dependency/CLI can alter the real fixed limits.
  const file = require.resolve('../scripts/v07-remux-mov-smoke.cjs');
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split('maxStarts: 3').length, 2);
  const temporary = new Module(file, module); temporary.filename = file; temporary.paths = Module._nodeModulePaths(path.dirname(file));
  temporary._compile(source.replace('maxStarts: 3', 'maxStarts: 1'), file);
  const h = harness({ createSmoke: temporary.exports.createSmoke }), r = await h.run('mp4-a-mov,mov-b-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Prospective Start ceiling/);
  assert.deepEqual(h.trace.starts, ['mp4-a-mov']);
  assert.equal(r.acceptedStarts, 1); assert.equal(r.fileWritingCopies, 1);
});
test('Q2e orchestration refuses a changed module hash before the next child, independently of final freeze', async () => {
  const h = harness({ changeModule: true }), r = await h.run('mp4-a-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Source modules changed before child admission/);
  assert.equal(h.trace.executions.length, 1); assert.equal(r.invocations.length, 1);
  assert.equal(h.trace.liveChildren, 0);
});
test('Q2e orchestration refuses a second live child through both direct/observed path orders', async () => {
  for (const concurrentProbe of ['direct-first', 'observed-first']) {
    const h = harness({ concurrentProbe }), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Concurrent child admission is forbidden/);
    assert.equal(h.trace.executions.length, 1); assert.equal(h.trace.maxLiveChildren, 1); assert.equal(h.trace.liveChildren, 0);
    assert.deepEqual(h.trace.starts, []); assert.equal(r.liveChildren, 0);
  }
});
test('Q2e both child paths enforce the fourth-copy refusal before execution', async () => {
  const h = harness({ extraCopies: true }), r = await h.run('mp4-a-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Start ceiling/);
  assert.equal(h.trace.executions.length, LIMITS.maxStarts); assert.ok(h.trace.observations > 0);
});
test('Q2e actual preflight refuses the storage floor and closure refuses excess growth', async () => {
  const h = harness({ lowSpace: true }), r = await h.run('mp4-a-mov');
  assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.executions.length, 0); assert.deepEqual(h.trace.starts, []);
  const g = await harness({ growth: true }).run('mp4-a-mov');
  assert.equal(g.status, 'failed-retained'); assert.ok(g.closureFailures.some(value => value.label === 'owned-growth'));
});
test('Q2e orchestration fails if the service accepts a stale Start or ignores a collision', async () => {
  for (const options of [{ acceptStale: true }, { ignoreCollision: true }]) {
    const r = await harness(options).run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained');
  }
});
test('Q2e exact configuration, normal route identity and fixed bounds cannot widen via CLI', () => {
  assert.equal(routeOptions('--qualify').remuxPolicies.length, 5);
  // Q2g (record 47) moved the production route to envelope v2. This retained Q2e
  // harness is pinned to v1, so its normal mode must now refuse instead of
  // producing evidence against a different production policy.
  assert.equal(REMUX_POLICY_ID, 'full-remux-v4:2026-11-13:five-routes-mov-vfr');
  const promoted = REMUX_POLICIES.filter(route => route.inputFamily === 'isobmff' && route.target === 'mov');
  assert.equal(promoted.length, 1); assert.equal(promoted[0].id, 'full-remux-isobmff-mov-v1');
  assert.equal(promoted[0].sourceEnvelope, 'h264-aac-lc-48k-stereo-v2');
  assert.equal(promoted[0].allowAncillary, false); assert.equal(promoted[0].allowRotation90, false);
  assert.throws(() => routeOptions('--normal'));
  assert.throws(() => requireProductionRoute(REMUX_POLICIES));
  assert.throws(() => requireProductionRoute(REMUX_POLICIES.filter(route => route.id !== 'full-remux-isobmff-mov-v1')));
  for (const args of [[], ['--run-owned-remux','--qualify','--cases','mp4-a-mov,mp4-a-mov'],
    ['--run-owned-remux','--qualify','--cases','all'], ['--run-owned-remux','--qualify','--cases','mp4-a-mov','--maxStarts','3']]) assert.throws(() => configuration(args));
  assert.throws(() => routeOptions('--fallback'));
  const route = { id: 'full-remux-isobmff-mov-v1', inputFamily: 'isobmff', target: 'mov', allowAncillary: false,
    allowRotation90: false, sourceEnvelope: 'h264-aac-lc-48k-stereo-v1' };
  assert.equal(requireProductionRoute([route]), route);
  for (const change of [{ id: 'laboratory' }, { sourceEnvelope: undefined }, { allowAncillary: true }, { allowRotation90: true }])
    assert.throws(() => requireProductionRoute([{ ...route, ...change }]));
  assert.throws(() => requireStartBudget(LIMITS.maxStarts)); assert.throws(() => requireGrowth(0, LIMITS.forecastBytes + 1));
  assert.throws(() => requireSpace({ DFreeBytes: 0, FFreeBytes: 100 * 1024 ** 3 }));
  assert.throws(() => requireSpace({ DFreeBytes: 30 * 1024 ** 3, FFreeBytes: 25 * 1024 ** 3 }));
  assert.throws(() => requireOutcome('unknown', { outcome: 'saved', warnings: [] }));
  assert.throws(() => requireSourceObservation({ ...sourceProbe(), streams: [{ ...sourceProbe().streams[0], has_b_frames: 0 }, sourceProbe().streams[1]] }));
});

test('Q2e normal configuration still refuses a catalog without the promoted MOV route at the real call site', () => {
  // Only an in-memory imported module sees this catalog. The shipped script,
  // real catalog and CLI are unchanged; its main is never invoked.
  const file = require.resolve('../scripts/v07-remux-mov-smoke.cjs'), catalogFile = require.resolve('../src/remux-catalog.cjs');
  const priorIds = ['full-remux-isobmff-matroska-v1', 'full-remux-isobmff-mp4-v1',
    'full-remux-matroska-matroska-v1', 'full-remux-matroska-mp4-v1'];
  const prior = REMUX_POLICIES.filter(route => priorIds.includes(route.id));
  assert.equal(prior.length, 4);
  const temporary = new Module(file, module), native = Module.createRequire(file);
  temporary.filename = file; temporary.paths = Module._nodeModulePaths(path.dirname(file));
  temporary.require = request => native.resolve(request) === catalogFile
    ? { REMUX_POLICIES: prior, REMUX_POLICY_ID } : native(request);
  temporary._compile(fs.readFileSync(file, 'utf8'), file);
  assert.throws(() => temporary.exports.routeOptions('--normal'), /full-remux-isobmff-mov-v1/);
});

test('Q2e retained source observations and receipt fields are checked at their harness call site', async () => {
  for (const options of [
    ...[p => { p.streams[0].has_b_frames = 0; }, p => { p.streams[0].pix_fmt = 'yuv420p10le'; },
      p => { p.streams[1].sample_rate = '44100'; }, p => { p.streams.pop(); }, p => { p.chapters.push({}); }]
      .map(sourceChange => ({ sourceChange })),
    ...[r => { r.cases[0].output = 'foreign'; }, r => { r.cases[0].file.sha256 = 'f'.repeat(64); },
      r => { r.cases[0].file.bytes++; }, r => { r.invocations[0].exitCode = 1; }].map(receiptChange => ({ receiptChange })),
  ]) {
    const h = harness(options), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.starts, []); assert.deepEqual(h.trace.executions, []);
  }
});
test('Q2e actual output receipt guard refuses malformed tracks, kind, fingerprint and mdhd seals', async () => {
  for (const movChange of [m => { m.version = 2; }, m => { m.kind = 'copied-json'; }, m => { m.tracks.pop(); },
    m => { m.tracks[1].outputIndex = 4; }, m => { m.tracks[1].trackId = 0; }, m => { m.tracks[1].mdhdSha256 = 'bad'; },
    m => { m.outputEvidenceFingerprint = undefined; }]) {
    const h = harness({ movChange }), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.movReads, 1);
  }
  assert.throws(() => readMovReceipt({}, { operationPlan: { runtimeIdentity: 'a'.repeat(64) }, outputId: 'id' }),
    { code: 'REMUX_EVIDENCE_RECEIPT_REQUIRED' });
});
test('Q2e actual writer admission refuses path escapes and encoders before creating a child', async () => {
  for (const options of [{ outsideWriter: true }, { encodeWriter: true }]) {
    const h = harness(options), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.deepEqual(h.trace.executions, []);
  }
});

test('Q2e actual output headers must bind collection and retain the pinned codec tags and handlers', async () => {
  for (const options of [{ missingOutputProbe: true },
    { captureProbeChange: p => { p.streams[0].id = '0x9'; } },
    { outputProbeChange: p => { p.streams[0].codec_tag_string = 'avc3'; } },
    { outputProbeChange: p => { p.streams[1].codec_tag_string = 'xxxx'; } },
    { outputProbeChange: p => { p.streams[1].tags.handler_name = 'foreign'; } }]) {
    const h = harness(options), r = await h.run('mp4-a-mov');
    assert.equal(r.status, 'failed-retained'); assert.equal(h.trace.movReads, 1);
  }
});
test('Q2e proof refuses variable source/output witnesses and altered fixture C rate observations', async () => {
  for (const options of [{ sourceVariable: true }, { outputVariable: true }]) {
    const r = await harness(options).run('mp4-c-mov');
    assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /constant source\/output cadence/);
  }
  const h = harness({ sourceChange: p => { p.streams[0].avg_frame_rate = '30/1'; } }), r = await h.run('mp4-c-mov');
  assert.equal(r.status, 'failed-retained'); assert.match(r.failure.message, /Pinned fixture rate summaries changed/);
  assert.deepEqual(h.trace.starts, []);
});
