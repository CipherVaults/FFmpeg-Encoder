'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createSmoke, LIMITS } = require('../scripts/v07-remux-mkv-mp4-smoke.cjs');

// The real orchestration runs here with a wholly in-memory filesystem, inert
// byte fixtures, a fake service and a fake runner. No filesystem or child API
// is called by these dependencies; this is wiring evidence, never media proof.
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const B_SOURCE = path.join(OWNED, 'fixtures/sdr-envelope-6b317682-605b-4d40-8ff3-b3f84678f0ae/B-1280x720-30fps.mov');
const B_RECEIPT = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const B_HASH = 'd6030cb3613006b72da5ea02a80fefd82ad14f57c76268b823a691f83e162273';
const vendor = () => ({ code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', key: 'VENDOR_ID',
  message: "Stream 0 → 0: descriptive metadata 'VENDOR_ID' is missing or changed in its requested representation." });
const average = () => ({ code: 'OPERATION_VALIDATION_WARNING',
  message: 'Stream 0 → 0: average frame-rate summaries differ; complete variable presentation timestamps remain subject to every preservation check.' });

function harness(options = {}) {
  const nodes = new Map(), trace = { executions: [], starts: [], omissions: 0, observations: 0 };
  let ino = 1;
  function directory(file) {
    if (nodes.has(file)) return;
    const parent = path.dirname(file); if (parent !== file) directory(parent);
    nodes.set(file, { directory: true, ino: ino++ });
  }
  function put(file, bytes) { directory(path.dirname(file)); nodes.set(file, { bytes: Buffer.from(bytes), ino: nodes.get(file)?.ino || ino++ }); }
  const receipt = Buffer.from(JSON.stringify({ cases: [{ id: 'B', output: B_SOURCE, file: { sha256: B_HASH } }], invocations: [
    { kind: 'metadata', argv: ['-i', B_SOURCE], exitCode: 0, stdout: JSON.stringify({ streams: [{ codec_type: 'video', has_b_frames: 2 }] }) },
  ] }));
  const masters = new Map([
    [path.join(OWNED, 'fixtures/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/landscape.mp4'), Buffer.from('inert CFR master')],
    [path.join(OWNED, 'outputs/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/aac-calibration-delayed.mkv'), Buffer.from('inert VFR master')],
    [B_SOURCE, Buffer.from('inert B master')],
  ]);
  // Only the imported factory receives this synthetic digest adapter. The CLI
  // always uses crypto and the real retained receipt/source pins.
  const pins = new Map([
    ['inert CFR master', '488a30e753a3129a2a64ef9314a69be91e4db1bc508a6bd14b26ad5fc01f10e4'],
    ['inert VFR master', '5ef90a319c77abe5eca10df81b7afcc27571b323b05316d180ae653641abd2b4'],
    ['inert B master', B_HASH], [receipt.toString(), '17f7e802480f092093f5dcaebc61f78c0710a5fc36b444f016933871c4e647a9'],
  ]);
  const digest = bytes => pins.get(bytes.toString()) || createHash('sha256').update(bytes).digest('hex');
  function get(file) {
    if (!nodes.has(file)) {
      if (masters.has(file)) put(file, file === B_SOURCE && options.badBMaster ? 'changed B master' : masters.get(file));
      else if (file === B_RECEIPT) put(file, options.badBReceipt ? 'changed B receipt' : receipt);
      else if (['main.js', 'preload.js', 'scripts/v07-remux-mkv-mp4-smoke.cjs'].some(name => file === path.join(ROOT, name))) put(file, 'inert frozen module');
      else throw Object.assign(new Error(`Missing inert path: ${file}`), { code: 'ENOENT' });
    }
    return nodes.get(file);
  }
  function stat(file, opts = {}) {
    const node = get(file), number = n => opts.bigint ? BigInt(n) : n;
    return { dev: number(1), ino: number(node.ino), size: number(node.bytes?.length || 0), nlink: number(1),
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
  const runner = async (file, args, opts) => {
    trace.executions.push({ file, args });
    const child = new EventEmitter(); opts.onChild?.(child);
    await io.writeFile(args.at(-1), 'inert child output'); child.emit('close', 0, null);
    return { exitCode: 0, stderr: '', stderrCapture: { totalBytes: 0, truncated: false } };
  };
  class FakeService {
    constructor(config) { this.config = config; this.folders = new Map(); this.plan = { entries: new Map() }; this.serial = 0; }
    async initializeDiagnostics() {}
    async registerFolder(file) { const id = String(this.folders.size); this.folders.set(id, file); return { id }; }
    async prepareRemuxBatch(request) {
      this.file = [...nodes.keys()].find(file => path.dirname(file) === this.folders.get(request.inputFolderId) && !get(file).directory);
      this.output = this.folders.get(request.outputFolderId); this.label = path.basename(this.output).replace(/^output-/, '');
      this.destination = path.join(this.output, path.basename(this.file) + '.' + request.target);
      const omissionCount = request.target !== 'mp4' ? 0 : this.file.includes('input-timeline') ? 2 : this.file.includes('output-bframe-seed-mkv') ? 1 : 0;
      this.state = { phase: 'ready', planId: `plan-${++this.serial}`, batchId: `batch-${this.serial}`,
        operationDraft: { id: 'draft', revision: this.serial }, items: [{ id: 'file', name: path.basename(this.file),
          status: nodes.has(this.destination) ? 'skipped' : omissionCount ? 'unsupported' : 'ready',
          reasonCode: options.wrongOmissionCode ? 'REMUX_QUALIFICATION_REQUIRED' : 'REMUX_AUDIO_OMISSION_REQUIRED',
          reason: 'Matroska audio omission', remux: { omissionCandidates: Array.from({ length: omissionCount }, (_, i) => ({ id: `audio-${i}`, label: 'audio' })) } }] };
      this.plan = { entries: new Map([['file', { destination: this.destination, inspection: { probe: { streams: [{ codec_type: 'video',
        avg_frame_rate: '10/1', r_frame_rate: this.label === 'cfr-video-mp4' && options.badCfrRate ? '30/1' : '10/1' }] } } }]]) };
    }
    snapshot() { return structuredClone(this.state); }
    async reencodeOutputs() {}
    async setRemuxOmissions() { trace.omissions++; this.state.items[0].status = 'ready'; }
    getEncodingDetails() { return {}; }
    startBatch(request) {
      if (this.state.phase === 'cancelled' || request.planId !== this.state.planId) throw Object.assign(new Error('stale'), { code: 'STALE_PLAN' });
      if (this.state.items[0].status !== 'ready') throw Object.assign(new Error('not selected'), { code: 'INVALID_SELECTION' });
      trace.starts.push(this.label); this.taskPromise = this.complete();
    }
    async complete() {
      const count = options.sixCopies ? 6 : 1;
      for (let i = 0; i < count; i++) {
        const args = ['-n', '-i', this.file, '-c', 'copy', path.join(path.dirname(this.output), 'staging', `${this.label}-${i}`)];
        if (i % 2) await this.config.operationRuntime.invoke({}, 'ffmpeg', args, {});
        else await this.config.run(runtime.ffmpeg, args);
      }
      const item = this.state.items[0]; item.status = 'success';
      item.outcome = ['timeline-video-mp4', 'bframe-video-mp4'].includes(this.label) ? 'saved-with-warning' : 'saved';
      item.warnings = this.label === 'timeline-video-mp4' ? [vendor(), average()] : this.label === 'bframe-video-mp4' ? [vendor()] : [];
      if (this.label === 'bframe-video-mp4' && options.bframeAverage) item.warnings.push(average());
      if (options.extraWarning) item.warnings.push({ code: 'UNEXPECTED', key: 'unknown', message: 'Not reviewed' });
      if (options.missingWarning) item.warnings.pop();
      item.evidenceStorage = { final: { violations: [] } };
      const cadence = this.label.startsWith('cfr-') ? 'constant' : 'variable';
      this.plan.entries.get('file').operationEvidence = { status: 'completed', essenceEvidence: { streams: [{ codecType: 'video',
        source: { cadence: { classification: this.label === 'bframe-video-mp4' && options.sourceConstant ? 'constant' : cadence } },
        output: { cadence: { classification: this.label === 'bframe-video-mp4' && options.mixedCadence ? 'constant' : cadence } } }] } };
      put(this.destination, `inert publication ${this.label}`);
    }
    async cancelBatch() { this.state.phase = 'cancelled'; }
    async cancelCurrent() { if (this.taskPromise) await Promise.allSettled([this.taskPromise]); }
    async closeOperationResources() {}
    async closeDiagnostics() { return { persisted: true }; }
  }
  const run = createSmoke({ fs: io, sha: digest, runTool: runner, EncoderService: FakeService, randomUUID: () => 'inert-unit-run',
    verifyCandidateRuntime: async () => runtime,
    createOperationControls: () => ({ operationRuntime: { invoke: async (_token, tool, args, opts) => { trace.observations++; return runner(runtime[tool], args, opts); } } }),
  });
  return { trace, run: choices => run(['--run-owned-remux', '--qualify', '--cases', choices]), nodes };
}

test('actual orchestration reaches all three fake cases and records each B-frame warning set', async () => {
  for (const bframeAverage of [false, true]) {
    const h = harness({ bframeAverage });
    const result = await h.run('timeline-video-mp4,cfr-video-mp4,bframe-video-mp4');
    assert.equal(result.status, 'passed-bounded-copy-service', JSON.stringify(result.failure || result.closureFailures));
    assert.equal(result.acceptedStarts, 5); assert.equal(result.fileWritingCopies, 5);
    assert.equal(result.cases.find(value => value.label === 'bframe-video-mp4').warningSet,
      bframeAverage ? 'vendor-and-variable-average' : 'vendor-only');
    assert.equal(result.preparedCancel.staleStartRefused, true); assert.equal(result.existingOutputSkip.noNewCopy, true);
    assert.equal(result.leaseReleased, true); assert.deepEqual(result.closureFailures, []);
  }
});
test('run refuses the sixth fake file writer before either execution path creates it', async () => {
  const h = harness({ sixCopies: true }), result = await h.run('cfr-video-mp4');
  assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /Start ceiling/);
  assert.equal(h.trace.executions.length, LIMITS.maxStarts); assert.ok(h.trace.observations > 0);
});
test('actual omission preparation refuses the older code before setRemuxOmissions', async () => {
  const h = harness({ wrongOmissionCode: true }), result = await h.run('timeline-video-mp4');
  assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /explicit audio policy/);
  assert.equal(h.trace.omissions, 0); assert.deepEqual(h.trace.starts, []);
});
test('actual job result validation refuses extra and missing warnings', async () => {
  for (const options of [{ extraWarning: true }, { missingWarning: true }]) {
    const h = harness(options), result = await h.run('timeline-video-mp4');
    assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /unexpected warning/);
    assert.deepEqual(h.trace.starts, ['timeline-video-mp4']);
  }
});
test('actual CFR preparation refuses unequal source rates before its Start', async () => {
  const h = harness({ badCfrRate: true }), result = await h.run('cfr-video-mp4');
  assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /strict equal-average/);
  assert.deepEqual(h.trace.starts, ['cfr-seed-mkv']);
});
test('actual B-frame preparation enforces the retained receipt and media-byte pins', async () => {
  for (const options of [{ badBReceipt: true }, { badBMaster: true }]) {
    const h = harness(options), result = await h.run('bframe-video-mp4');
    assert.equal(result.status, 'failed-retained'); assert.deepEqual(h.trace.starts, []);
    assert.equal(h.trace.executions.length, 0);
    if (options.badBReceipt) assert.match(result.failure.message, /receipt changed/);
  }
});
test('actual preflight enforces the evidence-storage free-space floor', async () => {
  const h = harness({ lowSpace: true }), result = await h.run('timeline-video-mp4');
  assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /25GiB evidence storage floor/);
  assert.equal(h.trace.executions.length, 0); assert.deepEqual(h.trace.starts, []);
});
test('actual B-frame average warning requires both collected cadence classifications to be variable', async () => {
  for (const options of [{ mixedCadence: true }, { sourceConstant: true }]) {
    const h = harness({ bframeAverage: true, ...options }), result = await h.run('bframe-video-mp4');
    assert.equal(result.status, 'failed-retained'); assert.match(result.failure.message, /variable/);
  }
});
