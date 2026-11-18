'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { assertCandidateServiceReceipt, verifyCandidateServiceProducers, createCandidateResizeService, REPORT, REPORT_SHA, RUNTIME_ID } = require('./candidate-resize-service.cjs');
const shared = require('./workbench-long-range-service.cjs');
const { deriveCfrResizeFlacResources, RESIZE_RESOURCE_POLICY: RESOURCE_POLICY, RESIZE_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1920, height: 1080,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}
// Synthetic structure exercises refusal logic, never a media qualification.
function report() {
  const sources = ['long-pattern', 'heldout-flipped'].map((id, i) => ({ id, sourceExtentUs: (i ? 11 : 150) * 1000000,
    sha256: (i ? 'b' : 'a').repeat(64), identity: { size: '100000000' }, probe: probe(i ? 11 : 150),
    frozen: frozenQualifications(`${path.basename(path.dirname(REPORT))}:${id}`, RUNTIME_ID, probe(i ? 11 : 150)) }));
  const cases = [ ['late-forty-seconds', 0, { startUs: 100000000, endUs: 140000000 }],
    ['late-open-end', 0, { startUs: 130000000 }], ['heldout-nonaligned', 1, { startUs: 413000, endUs: 8621000 }] ].map(([id, index, range]) => {
    const source = sources[index], end = range.endUs ?? source.sourceExtentUs;
    return { id, geometry: { requested: '720', mode: 'downscale', filterRequired: true, source: { width: 1920, height: 1080 }, output: { width: 1280, height: 720, sampleAspectRatio: { numerator: '1', denominator: '1' }, rotationDegrees: 0 } }, sourceId: source.id, range, status: 'passed', validation: { valid: true },
      resources: deriveCfrResizeFlacResources({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - range.startUs, sourceBytes: source.identity.size }),
      pipeBytes: 1, elapsedMs: 1, frames: Math.ceil(end * 30 / 1e6) - Math.ceil(range.startUs * 30 / 1e6),
      samples: Math.ceil(end * 48000 / 1e6) - Math.ceil(range.startUs * 48000 / 1e6),
      pcmIdentity: { sourceHash: 'c'.repeat(64), outputHash: 'c'.repeat(64) }, completeSource: { video: { frames: source.sourceExtentUs * 30 / 1e6, properties: { policy: RESIZE_FAMILY_ID } },
        audio: [{ sampleCount: String(source.sourceExtentUs * 48000 / 1e6) }] } };
  });
  for (const row of cases) row.telemetry = { valid: true, scope: 'encoder-input-count-and-timeline-only', streams: ['video', 'audio'].map((kind, outputIndex) => ({ kind, outputIndex, unknownInputRecords: '0', correspondence: 'reported-input-and-independent-selected-source' })) };
  return { diagnosticsComplete: true, children: Array.from({ length: 42 }, (_, i) => ({ sequence: i + 1, closed: true, exitCode: 0, signal: null, stderr: { available: true, completeAtSave: true, truncated: false, totalBytes: 0, retainedBytes: 0, sha256: sha(Buffer.alloc(0)) } })), candidateRuntime: true, geometry: { sourceWidth: 1920, sourceHeight: 1080, resolution: '720', outputWidth: 1280, outputHeight: 720 }, status: 'passed-pre-catalog-calibration', runtimeIdentity: RUNTIME_ID, resourcePolicy: RESOURCE_POLICY,
    publicationAuthorized: false, catalogActivated: false, settings, census: { spawned: 42, closed: 42, live: 0, maximum: 1 }, sources, cases };
}

const validate = value => { const bytes = Buffer.from(JSON.stringify(value)); return assertCandidateServiceReceipt(bytes, sha(bytes)); };
test('pure candidate receipt requires complete exact resize1080to720 evidence, not service authority', () => {
  assert.deepEqual(validate(report()), report());
  assert.throws(() => assertCandidateServiceReceipt(Buffer.from(JSON.stringify(report()))));
  for (const mutate of [r => r.runtimeIdentity = 'a'.repeat(64), r => r.candidateRuntime = false,
    r => r.geometry.resolution = 'source', r => r.resourcePolicy = 'other', r => r.cases.pop(),
    r => r.sources[0].probe.streams[0].time_base = '1/30', r => r.cases[0].telemetry.valid = false,
    r => delete r.cases[0].telemetry, r => r.cases[0].telemetry.streams[0].unknownInputRecords = '1',
    r => r.cases[0].telemetry.streams[1].kind = 'video', r => r.cases[0].completeSource.video.frames--, r => r.runtimeCloseFailure = {}, r => r.diagnosticsComplete = false, r => r.children[0].stderr.truncated = true, r => r.children[0].stderr.completeAtSave = false, r => r.children[0].exitCode = 1, r => r.children.pop(), r => r.cases[0].completeSource.video.properties.policy = 'other', r => r.cases[0].geometry.output.width = 1920, r => r.cases[0].pcmIdentity.outputHash = 'd'.repeat(64), r => r.cases[0].resources = deriveCfrResizeFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 1, sourceBytes: '100000000' })]) {
    const value = report(); mutate(value); assert.throws(() => validate(value));
  }
});
test('new current producer capsule matches; historical capsule still refuses current bytes', async () => {
  await verifyCandidateServiceProducers();
  const file = path.join(__dirname, 'candidate-resize-service.cjs');
  let source = await fs.readFile(file, 'utf8');
  const legacy = {"linux-blue/workbench-long-range-calibration.cjs": "1e7a3425672f3662733370de2ee8babbaecea912db899556d7ad4a0bcbc66ee9", "src/operation-family.cjs": "4453619d3f68d891bf7472a9dcfc919508b4dbb0533e0a07ee3b48461424ae3e", "src/operation-resource-budget.cjs": "b60f0fe312e79c6f1b15e717f0cb4a7925fba132ca62b8aa753aa5a3ef51accd", "src/operation-evidence.cjs": "8de2516179f3c80667004855ef720250b934fd7b816b170ac2be1b9c39179ef8"};
  const current = {"linux-blue/workbench-long-range-calibration.cjs": "ee8d48e294f098ed9f47e7b6e1e75edd5a4661d460ee6b00bb2a375010692afc", "src/operation-family.cjs": "3e27335e4228969d670545b0fb6aeb77a6fd9303529c248ae7560d0c9e4fade3", "src/operation-resource-budget.cjs": "9a328f902ee4203465083da4afd477ad86d045654104fe33409cb571cd02d3f6", "src/operation-evidence.cjs": "5ec5452881d01789f7f181e4540cfcca268371f13f6abdd7f59fa9ad57e8b8d4"};
  for (const name of Object.keys(legacy)) source = source.replace(current[name], legacy[name]);
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: file })(createRequire(file), module, module.exports, __dirname);
  await assert.rejects(module.exports.verifyCandidateServiceProducers(), /Calibration producer changed:/);
});
test('actual freshly audited raw report passes fixed pure validator when explicitly supplied', { skip: !process.env.CANDIDATE_RESIZE_REPORT_TEST_PATH }, async () => {
  // Read-only evidence test; no live factory/runtime grant or media execution.
  const bytes = await fs.readFile(process.env.CANDIDATE_RESIZE_REPORT_TEST_PATH);
  assert.equal(bytes.length, 125797); assert.equal(sha(bytes), REPORT_SHA);
  const parsed = assertCandidateServiceReceipt(bytes); assert.equal(parsed.status, 'passed-pre-catalog-calibration');
  assert.equal(parsed.cases.length, 3); assert.equal(parsed.census.closed, 42);
  const changed = Buffer.from(bytes); changed[0] ^= 1; assert.throws(() => assertCandidateServiceReceipt(changed));
});
test('public factory rejects copied handles and inert-option violations without runtime or receipt access', async () => {
  let reads = 0;
  await assert.rejects(createCandidateResizeService({ verifiedRuntime: {}, stateDir: '/tmp/not-created-candidate-service' }));
  const options = Object.defineProperty({ stateDir: '/tmp/not-created-candidate-service' }, 'verifiedRuntime', { enumerable: true, get() { reads++; return {}; } });
  await assert.rejects(createCandidateResizeService(options)); assert.equal(reads, 0);
});
// Dependency injection exists only in this test's VM loader, not in the exported
// live factory. No candidate binaries, retained media or historical reports needed.
async function injected({ changedProducer = false, changedReport = false, wrongIdentity = false, changedDependencies = false, reportIssue = null, staleAfterChecks = false } = {}) {
  const file = path.join(__dirname, 'candidate-resize-service.cjs'), sourceOriginal = await fs.readFile(file, 'utf8');
  // VM-only synthetic closure. These bytes are not a media qualification and
  // never alter production pins. Real live-gate refusal is asserted separately.
  const literal = sourceOriginal.match(/const PRODUCERS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  assert.ok(literal);
  const syntheticProducers = {};
  for (const name of Object.keys(JSON.parse(literal[1])))
    syntheticProducers[name] = sha(await fs.readFile(path.resolve(__dirname, '..', name)));
  const source = sourceOriginal.replace(literal[0], 'const PRODUCERS = ' + JSON.stringify(syntheticProducers) + ';');
  const dependencies = JSON.parse(source.match(/const DEPENDENCIES = (\[[\s\S]*?\n\]);/)[1]);
  let closed = 0, observed = 0, invoked = 0, reportClosed = 0, reportStats = 0, reportReadBytes = 0, reportRealpaths = 0;
  const fake = { runtimeIdentity: wrongIdentity ? 'a'.repeat(64) : RUNTIME_ID, dependencies: changedDependencies ? [] : dependencies,
    pins: Object.fromEntries(['ffmpeg', 'ffprobe'].map(k => [k, { path: '/synthetic/' + k, size: 1, sha256: 'a'.repeat(64) }])),
    async requireCurrent() { observed++; if (staleAfterChecks && observed > 1) throw new Error('Injected stale runtime after report verification'); }, async close() { closed++; }, createRunner() { return async () => { invoked++; throw new Error('No child authorized by this test'); }; } };
  const originalRequire = createRequire(file), module = { exports: {} }, syntheticBytes = Buffer.from(JSON.stringify(report()).padEnd(125797));
  const overrides = {
    'node:fs/promises': { ...fs,
      lstat: async name => name === REPORT ? { dev: 1n, ino: reportIssue === 'path-replacement' && reportReadBytes === 125797 ? 3n : 2n, size: 125797n, nlink: 1n, mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n } : fs.lstat(name, { bigint: true }),
      realpath: async name => name === REPORT ? (++reportRealpaths && (reportIssue === 'symlink' || (reportIssue === 'path-alias' && reportReadBytes === 125797)) ? REPORT + '.elsewhere' : REPORT) : fs.realpath(name),
      open: async (name, flags) => {
        assert.equal(name, REPORT); assert.ok(flags & require('node:fs').constants.O_NOFOLLOW);
        return { stat: async () => ({ isFile: () => reportIssue !== 'nonregular', nlink: reportIssue === 'hardlink' ? 2n : 1n, size: reportIssue === 'large' ? 125798n : 125797n, dev: 1n, ino: 2n, mtimeNs: 1n, ctimeNs: reportIssue === 'mutation' ? BigInt(++reportStats) : 1n, birthtimeNs: 1n }),
          read: async (target, offset, length, position) => {
            const bytesRead = reportIssue === 'truncated' ? 0 : syntheticBytes.copy(target, offset, position, position + length);
            reportReadBytes += bytesRead; return { bytesRead };
          }, close: async () => { reportClosed++; } };
      }, readFile: async (name, ...args) => name === REPORT ? syntheticBytes
      : changedProducer && String(name).endsWith('workbench-long-range-calibration.cjs') ? Buffer.from('changed') : fs.readFile(name, ...args) },
    './candidate-calibration-runtime.cjs': { requireCandidateCalibrationRuntime: h => { assert.equal(h, fake); return h; } },
    './workbench-long-range-service.cjs': { ...shared, assertProportionalReceiptForRuntime: (bytes, expectedSha, config, identity) => {
      assert.equal(expectedSha, REPORT_SHA); assert.equal(config.report, REPORT); assert.equal(identity, RUNTIME_ID);
      if (changedReport) throw new Error('Injected raw-report mismatch');
      return shared.assertProportionalReceiptForRuntime(bytes, sha(bytes), config, identity);
    } },
  };
  vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename: file })(
    name => Object.hasOwn(overrides, name) ? overrides[name] : originalRequire(name), module, module.exports, __dirname);
  return { api: module.exports, fake, counts: () => ({ closed, observed, invoked, reportClosed, reportReadBytes, reportRealpaths }) };
}
test('synthetic factory composition uses normal selector, observer, telemetry and storage, with owned closure', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' });
  assert.ok(service instanceof CandidateTrimService); assert.ok(service.operationRuntime instanceof OperationRuntimeObserver);
  assert.ok(service.operationQualifications instanceof shared.ClockQualifiedFamilySelector);
  assert.equal(service.operationTelemetry, true); assert.equal(service.operationEvidenceBudget, null);
  assert.equal(typeof service.operationStorage, 'function'); assert.equal(service.inspectionWorkers, 1);
  await service.cancelCurrent(); assert.equal(service.admissionClosed, true);
  assert.throws(() => service.startBatch({ planId: 'stale', fileIds: ['stale'] }), { code: 'SHUTTING_DOWN' });
  await service.closeOperationResources(); assert.equal(h.counts().closed, 1); assert.equal(h.counts().invoked, 0);
});
test('rejected synthetic construction closes candidate without child or storage effects', async () => {
  for (const options of [{ changedProducer: true }, { changedReport: true }, { wrongIdentity: true }, { changedDependencies: true }]) {
    const h = await injected(options);
    await assert.rejects(h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' }),
      options.changedProducer ? /Calibration producer changed: linux-blue\/workbench-long-range-calibration\.cjs/ : undefined);
    if (options.changedProducer) assert.equal(h.counts().reportClosed, 0, 'tampered producer stops before report read');
    assert.equal(h.counts().closed, 1); assert.equal(h.counts().invoked, 0);
  }
});
test('clock helper checks candidate path while preserving historical default', async () => {
  const invoke = async () => ({ exitCode: 0, stdout: JSON.stringify({ format: { format_name: 'matroska,webm' }, streams: [{ time_base: '1/30' }] }) });
  const args = ['-show_format', '-show_streams'];
  await assert.rejects(shared.clockGuardedRunner(invoke, '/synthetic/ffprobe')('/synthetic/ffprobe', args, {}));
  await shared.clockGuardedRunner(invoke)('/synthetic/ffprobe', args, {});
});

test('genuine but unreviewed candidate pair is closed before live report or service admission', async t => {
  const os = require('node:os');
  const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'candidate-service-refusal-'));
  let runtime;
  t.after(async () => { await runtime?.close(); assert.equal(await fs.realpath(root), root); await fs.rm(root, { recursive: true }); });
  const pins = {};
  for (const kind of ['ffmpeg', 'ffprobe']) {
    const bytes = Buffer.from('non-executable synthetic ' + kind), file = path.join(root, kind);
    await fs.writeFile(file, bytes); pins[kind] = { path: file, size: bytes.length, sha256: sha(bytes) };
  }
  const runtimeIdentity = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(k => ({ sizeBytes: pins[k].size, sha256: pins[k].sha256 }))));
  runtime = await openCandidateCalibrationRuntime({ pins, runtimeIdentity, dependencies: [] }, { execute: async () => { throw new Error('No child expected'); } });
  const stateDir = path.join(root, 'never-created');
  await assert.rejects(createCandidateResizeService({ verifiedRuntime: runtime, stateDir }), /exact reviewed pair/);
  await assert.rejects(runtime.requireCurrent(), /closed/);
  await assert.rejects(fs.stat(stateDir), { code: 'ENOENT' });
});

test('bounded original-report read and post-await currentness fail closed with descriptor cleanup', async () => {
  for (const options of ['symlink', 'nonregular', 'large', 'mutation', 'truncated', 'hardlink'].map(reportIssue => ({ reportIssue })).concat([{ staleAfterChecks: true }])) {
    const h = await injected(options);
    await assert.rejects(h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' }));
    assert.equal(h.counts().closed, 1); assert.equal(h.counts().invoked, 0);
    assert.equal(h.counts().reportClosed, options.reportIssue === 'symlink' ? 0 : 1);
  }
});
test('cancellation closes admission synchronously before pending saved writes drain', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' });
  let release; service.preferenceMutation = new Promise(resolve => { release = resolve; });
  const cancellation = service.cancelCurrent();
  try {
    assert.equal(service.admissionClosed, true);
    assert.throws(() => service.startBatch({ planId: 'stale', fileIds: ['stale'] }), { code: 'SHUTTING_DOWN' });
  } finally { release(); await cancellation; await service.closeOperationResources(); }
});
test('service and candidate cleanup failures both survive without masking the primary', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' });
  const primary = new Error('Injected observer close failure'), secondary = new Error('Injected candidate close failure');
  const closeObserver = service.operationRuntime.close.bind(service.operationRuntime), closeCandidate = h.fake.close;
  service.operationRuntime.close = async () => { throw primary; };
  h.fake.close = async () => { throw secondary; };
  try {
    await assert.rejects(service.closeOperationResources(), error => {
      assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 2);
      assert.ok(error.errors[0] instanceof AggregateError); assert.ok(error.errors[0].errors.includes(primary));
      assert.equal(error.errors[1], secondary); return true;
    });
  } finally { service.operationRuntime.close = closeObserver; h.fake.close = closeCandidate; await service.closeOperationResources(); }
});

test('composed selector issues only genuine fixed resize range authority with its own resource policy', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-resize-selector' });
  const { buildEncodeOperation, withEncodeOperationTelemetry, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
  const { resolveFileRequest } = require('../src/operation-contract.cjs');
  const { classifyColor } = require('../src/media.cjs');
  const { isProportionalFamilySelection } = require('../src/operation-family.cjs');
  const source = probe(), inspection = { probe: source, color: classifyColor(source), duration: 150 };
  const identity = { canonicalPath: '/synthetic/source.mov', dev: '1', ino: '2', size: '100000000', mtimeNs: '1', ctimeNs: '1', birthtimeNs: '1', sparseDigest: 'sha256-sparse-v1:' + 'a'.repeat(64) };
  const make = (resolution, overrides = {}, orientationRequest = null) => {
    const request = resolveFileRequest({ fileId: 'synthetic', identityRevision: 1, draftRevision: 1, operation: 'encode', overrides: { range: { startUs: 130000000 }, resolution, audioPolicy: 'precision-flac', ...overrides } });
    const orientation = service.operationQualifications.orientationQualification({ inspection, request: orientationRequest || request, runtimeIdentity: RUNTIME_ID, settings });
    const plan = withEncodeOperationTelemetry(buildEncodeOperation({ input: identity.canonicalPath, output: '/synthetic/output.mkv', inspection, request, settings, runtimeIdentity: RUNTIME_ID, ...orientation }));
    return { plan, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), settings, runtimeIdentity: RUNTIME_ID, environment: null, budget: null, executionBudgetMs: 120000 };
  };
  try {
    const bindings = make('720'), token = service.operationQualifications.select(bindings);
    const selection = service.operationQualifications.requireCurrent(token, bindings);
    assert.equal(isProportionalFamilySelection(selection), true);
    assert.equal(selection.resourcePolicy, RESOURCE_POLICY);
    assert.deepEqual(selection.resources, deriveCfrResizeFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 20000000, sourceBytes: '100000000' }).resources);
    assert.throws(() => service.operationQualifications.select(make('source')));
    for (const resolution of ['1080', '1440', '2160']) assert.throws(() => service.operationQualifications.select(make(resolution)));
    assert.throws(() => service.operationQualifications.select(make('720', { range: null })));
    // Test-only orientation fixture isolates audio-family admission from the
    // earlier orientation refusal: build valid AAC syntax, never run this plan.
    const aacBindings = make('720', { audioPolicy: 'precision-aac' }, bindings.plan.contract.request);
    assert.equal(aacBindings.plan.contract.request.audioPolicy, 'precision-aac');
    assert.throws(() => service.operationQualifications.select(aacBindings));
    assert.throws(() => service.operationQualifications.requireCurrent({ ...token }, bindings));
    service.operationQualifications.invalidate('test scope ended');
    assert.throws(() => service.operationQualifications.requireCurrent(token, bindings));
  } finally { await service.closeOperationResources(); }
});

test('report path replacement and canonical alias after bounded read reject and close the open handle', async () => {
  for (const reportIssue of ['path-replacement', 'path-alias']) {
    const h = await injected({ reportIssue });
    await assert.rejects(h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service' }), /Report path replaced during reading/);
    // The descriptor itself remains stable: only the post-read path identity or
    // canonical target changes, exercising the distinct pathname guard.
    assert.equal(h.counts().reportReadBytes, 125797);
    assert.equal(h.counts().reportRealpaths, 2);
    assert.equal(h.counts().reportClosed, 1);
    assert.equal(h.counts().closed, 1);
    assert.equal(h.counts().invoked, 0);
  }
});

test('workbench snapshot removes unqualified runnable entry before every update, then ordinary file-edit reprepare issues genuine range selection', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/not-created-candidate-service', workbenchMode: true });
  const { OperationDraft } = require('../src/operation-draft.cjs');
  const { buildEncodeOperation, withEncodeOperationTelemetry, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
  const { classifyColor } = require('../src/media.cjs');
  const { isProportionalFamilySelection } = require('../src/operation-family.cjs');
  const { randomUUID } = require('node:crypto');
  const fileId = randomUUID(), planId = randomUUID();
  const draft = new OperationDraft({ operation: 'encode', appDefaults: {}, appDefaultsRevision: 0 }); draft.addSources([{ fileId, identityRevision: 0 }]);
  service.plan = { id: planId, operation: 'encode', settings, input: '/synthetic', output: '/synthetic-output', draft, sameFolder: false,
    entries: new Map([[fileId, { operationPlan: { compatibilityPath: true } }]]), ...Object.fromEntries(['overrides', 'ambiguities', 'generated', 'reencodeAuthorizations', 'encodePreservationGrants', 'encodePreservationCandidates'].map(k => [k, new Map()])) };
  service.state.phase = 'ready'; service.state.planId = planId; service.state.settings = settings;
  service.state.operationDraft = draft.snapshot(); service.state.items = [{ id: fileId, name: 'source.mov', status: 'ready' }];
  assert.throws(() => service.startBatch({ planId, fileIds: [fileId] }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  const updates = []; service.on('update', value => {
    updates.push(value);
    if (value.items[0]?.reasonCode === 'CANDIDATE_RANGE_REQUIRED') {
      assert.equal(service.plan.entries.has(fileId), false);
      assert.throws(() => service.startBatch({ planId: service.plan.id, fileIds: [fileId] }), error => ['LINUX_TRIM_CANDIDATE_SCOPE', 'BUSY'].includes(error.code));
    }
  }); service.emitState();
  assert.equal(updates[0].items[0].status, 'unsupported'); assert.equal(service.plan.entries.has(fileId), false);
  assert.equal(updates[0].operationDraft.files.length, 1);
  service.state.items[0].status = 'ready'; service.emitState(); assert.equal(updates.at(-1).items[0].status, 'unsupported');
  // Runtime, report, inspection/worker evidence and the runtime token are injected.
  // Real draft editing, reprepare lifecycle, final-plan construction and the
  // family selector run below; this is not observed runtime authority.
  service.recordIncident = async () => {}; service.verifyFolders = async () => {};
  service.prepareWithWorkers = async () => {
    const source = probe(), identity = { canonicalPath: '/synthetic/source.mov', dev: '1', ino: '2', size: '100000000', mtimeNs: '1', ctimeNs: '1', birthtimeNs: '1', sparseDigest: 'sha256-sparse-v1:' + 'a'.repeat(64) };
    const inspection = { probe: source, color: classifyColor(source), duration: 150 }, request = draft.fileRequest(fileId);
    const orientation = service.operationQualifications.orientationQualification({ inspection, request, settings, runtimeIdentity: RUNTIME_ID });
    const plan = withEncodeOperationTelemetry(buildEncodeOperation({ ...orientation, input: identity.canonicalPath, output: '/synthetic-output/output.mkv', settings,
      runtimeIdentity: RUNTIME_ID, inspection: { probe: source, color: classifyColor(source), duration: 150 }, request: draft.fileRequest(fileId) }));
    const bindings = { plan, sourceIdentity: identity, sourceProbeFingerprint: fingerprintEncodeSource(source), settings, runtimeIdentity: RUNTIME_ID, environment: null, budget: null, executionBudgetMs: 120000 };
    const token = service.operationQualifications.select(bindings);
    assert.equal(isProportionalFamilySelection(service.operationQualifications.requireCurrent(token, bindings)), true);
    service.plan.entries.set(fileId, { operationPlan: plan, qualificationSelection: token, qualificationBindings: bindings, operationRuntimeToken: {} });
    service.state.items[0].status = 'ready'; service.emitState();
  };
  try {
    const next = await service.updateFileOperations({ planId, draftId: draft.id, revision: draft.snapshot().revision, fileIds: [fileId],
      overrides: { range: { startUs: 130000000, endUs: 132000000 }, resolution: '720', audioPolicy: 'precision-flac' } });
    assert.equal(next.phase, 'ready', next.error); assert.equal(next.items[0].status, 'ready'); assert.equal(service.plan.entries.has(fileId), true);
    assert.notEqual(next.planId, planId); assert.equal(next.operationDraft.files[0].request.range.startUs, 130000000);
    const currentEntry = service.plan.entries.get(fileId);
    // Snapshot reads current state, not this disconnected old-item fixture.
    // This does not execute a real delayed prepareItem callback.
    const oldItem = { id: fileId, status: 'ready' }; oldItem.status = 'unsupported';
    service.emitState(); assert.equal(service.plan.entries.get(fileId), currentEntry); assert.equal(service.snapshot().items[0].status, 'ready');
  } finally { await service.closeOperationResources(); }
});
test('strict OutputAccess seam rejects callback-shaped impostor and accepts real main-owned authority', async () => {
  const h = await injected(); await assert.rejects(h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/test', outputAccess: { issue() {}, action() {} } }), /OutputAccess/);
  const other = await injected(), { OutputAccess } = require('../src/output-access.cjs');
  const outputAccess = new OutputAccess({ openPath() {}, showItemInFolder() {} });
  const service = await other.api.createCandidateResizeService({ verifiedRuntime: other.fake, stateDir: '/tmp/test', outputAccess, workbenchMode: true });
  assert.equal(service.outputAccess, outputAccess); const pending = service.cancelCurrent();
  assert.equal(service.snapshot().developerResize.relaunchRequired, true); await pending; await service.closeOperationResources();
});

test('inspection-only boundary refuses Start across a modeled pending-write window and does not emit ready compatibility rows', async () => {
  const h = await injected(), service = await h.api.createCandidateResizeService({ verifiedRuntime: h.fake, stateDir: '/tmp/test', workbenchMode: true });
  const { randomUUID } = require('node:crypto'), fileId = randomUUID(), planId = randomUUID();
  service.plan = { id: planId, operation: 'encode', settings, sameFolder: false, entries: new Map([[fileId, { operationPlan: { compatibilityPath: true } }]]) };
  service.state.phase = 'preparing'; service.state.items = [{ id: fileId, status: 'ready' }];
  let release; const pendingWrite = new Promise(resolve => { release = resolve; });
  const seen = []; service.on('update', snapshot => { seen.push(snapshot.items[0].status); assert.notEqual(snapshot.items[0].status, 'ready'); });
  const diagnostic = (async () => { service.emitState(); await pendingWrite; service.emitState(); })();
  try {
    assert.throws(() => service.startBatch({ planId, fileIds: [fileId] }), { code: 'BUSY' });
    assert.equal(service.plan.entries.has(fileId), false);
    service.state.phase = 'ready';
    assert.throws(() => service.startBatch({ planId, fileIds: [fileId] }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  } finally { release(); await diagnostic; await service.closeOperationResources(); }
  assert.deepEqual(seen, ['unsupported', 'unsupported']);
});

test('actual historical raw report is not compatible with the new fixed evidence binding', { skip: !process.env.CANDIDATE_RESIZE_OLD_REPORT_TEST_PATH }, async () => {
 const bytes = await fs.readFile(process.env.CANDIDATE_RESIZE_OLD_REPORT_TEST_PATH);
 assert.equal(sha(bytes), '3fc9a4678890da318728f2c8b44ac7c6b4fe345ccd271b7f1064928f63eb1317');
 assert.throws(() => assertCandidateServiceReceipt(bytes));
});

// Previous Q8fIWI evidence cannot authorize the changed codec producers.
test('immediately prior Q8fIWI producer capsule rejects current codec producer bytes', async () => {
 const file=path.join(__dirname,'candidate-resize-service.cjs');let source=await fs.readFile(file,'utf8');
 const pairs=[["aae37c5479897a13f9ee66b1ea1a8a9a6a46d2c57f76d36bdebdedf21569a5de", "ebd24233c03a78f2c67f6ce3787694eb9d73b0b3ee8da2f6758ae42deeb20a3a"], ["79f040a7e136b2b06235090675360996e12d7ff815ea776eb800fd479ce9a7e7", "4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66"]];
 for(const [current,prior] of pairs){assert.equal(source.split(current).length-1,1,'Exact current producer pin must occur once');source=source.replace(current,prior);}
 const module={exports:{}};
 vm.runInThisContext('(function(require,module,exports,__dirname){'+source+'\n})',{filename:file})(createRequire(file),module,module.exports,__dirname);
 await assert.rejects(module.exports.verifyCandidateServiceProducers(), /Calibration producer changed: src\/(encode-operation|media)\.cjs/);
});
test('actual prior Q8fIWI raw report stays incompatible', {skip:!process.env.CANDIDATE_RESIZE_PRIOR_REPORT_TEST_PATH}, async()=>{
 const bytes=await fs.readFile(process.env.CANDIDATE_RESIZE_PRIOR_REPORT_TEST_PATH);
 assert.equal(bytes.length,125887);assert.equal(sha(bytes),'ea6a92b5d9455174c46e18aab50995712c1d1a09a49b8b49e1fc2e0870417004');
 assert.throws(()=>assertCandidateServiceReceipt(bytes));
});

// Immediately prior raw evidence remains rejected, even at the same byte length.
test('actual prior uj6Zhk report cannot substitute for fresh current1080 evidence', {skip:!process.env.CANDIDATE_RESIZE_IMMEDIATE_PRIOR_REPORT_TEST_PATH}, async()=>{
 const bytes=await fs.readFile(process.env.CANDIDATE_RESIZE_IMMEDIATE_PRIOR_REPORT_TEST_PATH);
 assert.equal(bytes.length,125797);assert.equal(sha(bytes),'226ec3b5a0f4ab58870a43a89a7579eb53a48dc6182000b45e8eaaba806901e2');
 assert.throws(()=>assertCandidateServiceReceipt(bytes));
});

test('immediately prior uj6Zhk producer capsule rejects current source', async()=>{
 const file=path.join(__dirname,'candidate-resize-service.cjs');let source=await fs.readFile(file,'utf8');
 const pairs=[["ee8d48e294f098ed9f47e7b6e1e75edd5a4661d460ee6b00bb2a375010692afc", "7460d5f369949a84827b6b6b96edab05656aecf2abd2b711a244942abab7b484"], ["5ec5452881d01789f7f181e4540cfcca268371f13f6abdd7f59fa9ad57e8b8d4", "9b680168395be354b8261bd4aa6624c1484daeecab424fd5278db55fa3aba9b9"], ["3e27335e4228969d670545b0fb6aeb77a6fd9303529c248ae7560d0c9e4fade3", "c981fe49e8f67b674cd23eda6b6424ee031b022bbf1a90dfe2cb2b5d51f99f65"], ["9a328f902ee4203465083da4afd477ad86d045654104fe33409cb571cd02d3f6", "1914192dc877344b94bb6786a831e07b6e8b9704ee31c0a63fd225db426e5926"]];
 for(const [current,prior] of pairs){assert.equal(source.split(current).length-1,1);source=source.replace(current,prior);}
 const module={exports:{}};vm.runInThisContext('(function(require,module,exports,__dirname){'+source+'\n})',{filename:file})(createRequire(file),module,module.exports,__dirname);
 await assert.rejects(module.exports.verifyCandidateServiceProducers(),/Calibration producer changed:/);
});
