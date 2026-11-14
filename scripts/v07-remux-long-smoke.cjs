'use strict';
// Root fills the two pins after reviewing fixture generation. Importing or
// invoking with placeholders cannot create a directory, lease or child.
const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const vfrProof = require('./v07-remux-mov-vfr-smoke.cjs');
const mkvProof = require('./v07-remux-mkv-mp4-smoke.cjs');
const { createOwnedSession, copyPinnedFile, hashFile, readBoundedFile, ROOT, OWNED, FIXTURES, sha, fault } = require('./v07-remux-long-fixtures.cjs');
const FIXTURE_ID = 'b29f31e5-bdd1-4f02-afe5-7d0f293ef39f';
const FIXTURE_REPORT_SHA = '133b550b5ec2158caeef0e041c3a91238056a20e947f866793fb1df72c0cfaf5';
const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 4 * 60 * 60000, childMs: 90 * 60000, forecastBytes: 8 * GiB,
  maxChildren: 512, maxStarts: 14, verificationMs: 60000, minimumDFreeBytes: 25 * GiB, marginBytes: 512 * MiB, reportBytes: 32 * MiB });
const MKV_REPORT_ID = 'b154a940-ae29-4601-b8c7-e3ef8015d351';
const MKV_REPORT_SHA = 'ab37baac148ac4d209f0e42c803b80b6b0fe99ecda7604dd996d6cdc400ff6fb';
const LEGACY = Object.freeze({
  ...Object.fromEntries(Object.entries(vfrProof.FIXTURES).map(([name, spec]) => [name, Object.freeze({ ...spec, kind: 'vfr' })])),
  'timeline-video-mp4': Object.freeze({ kind: 'mkv', origin: true, bytes: 415069, sha256: '5ef90a319c77abe5eca10df81b7afcc27571b323b05316d180ae653641abd2b4',
    file: path.join(OWNED, 'outputs/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/aac-calibration-delayed.mkv') }),
  'cfr-video-mp4': Object.freeze({ kind: 'mkv', seed: 'cfr-seed-mkv', bytes: 2896151, sha256: '2ddcf317ed092f68b57fd8fce12350e39cd5e36129eaef6ef4de47feca0f0121',
    file: path.join(OWNED, 'outputs', 'q2d-mkv-mp4-' + MKV_REPORT_ID, 'output-cfr-seed-mkv/landscape_Remux-MKV.mkv') }),
  'bframe-video-mp4': Object.freeze({ kind: 'mkv', seed: 'bframe-seed-mkv', bytes: 3081807, sha256: '60805ba49a8ae558d676c0866f06736042bcc9d29f5b2af084d01d0b6482ac5a',
    file: path.join(OWNED, 'outputs', 'q2d-mkv-mp4-' + MKV_REPORT_ID, 'output-bframe-seed-mkv/B-1280x720-30fps_Remux-MKV.mkv') }),
});
const CASES = Object.freeze({
  'mp4-mkv': Object.freeze({ fixture: 'LONG_MP4', target: 'matroska' }),
  'mp4-mp4': Object.freeze({ fixture: 'LONG_MP4', target: 'mp4' }),
  'mp4-mov': Object.freeze({ fixture: 'LONG_MP4', target: 'mov' }),
  'mkv-mkv': Object.freeze({ fixture: 'LONG_MKV', target: 'matroska' }),
  // b29f31e5 LONG_MKV probe: its sole video has default=0. The pinned muxer
  // promotes it to default=1 despite -disposition:0 0 (c655c522 retained).
  // Root's Q2o5 decision: this sole video has no competing track of its type,
  // so the added default flag has no selection effect and must be disclosed.
  'mkv-mp4': Object.freeze({ fixture: 'LONG_MKV', target: 'mp4' }),
  'large-mp4': Object.freeze({ fixture: 'LARGE_MP4', target: 'mp4' }),
  'cancel-copy': Object.freeze({ fixture: 'LARGE_MP4', target: 'mp4', cancel: 'copy' }),
  'cancel-verification': Object.freeze({ fixture: 'LONG_MP4', target: 'mp4', cancel: 'verification' }),
  ...Object.fromEntries(Object.keys(vfrProof.FIXTURES).map(name => [name, Object.freeze({ legacy: name, target: 'mov' })])),
  'timeline-video-mp4': Object.freeze({ legacy: 'timeline-video-mp4', target: 'mp4', omissions: 2 }),
  'cfr-video-mp4': Object.freeze({ legacy: 'cfr-video-mp4', target: 'mp4' }),
  'bframe-video-mp4': Object.freeze({ legacy: 'bframe-video-mp4', target: 'mp4', omissions: 1 }),
});
// Prospective exact expectations, never learned from the run under test. A new
// warning keeps the report FAILED for root review; no post-run wildcard grant.
const EXPECTED_WARNINGS = Object.freeze({
  // LONG_MP4 carries no vendor_id tag (fixture report b29f31e5 probe: language,
  // handler_name, encoder only), so nothing descriptive can be lost to Matroska.
  // Failed run bb1a7617 retained: it pinned the MOV-source precedent by mistake.
  'mp4-mkv': Object.freeze([]),
  'mp4-mp4': Object.freeze([]), 'mp4-mov': Object.freeze([]), 'mkv-mkv': Object.freeze([]),
  'mkv-mp4': Object.freeze([
    { code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', key: 'VENDOR_ID',
      message: "Stream 0 → 0: descriptive metadata 'VENDOR_ID' is missing or changed in its requested representation." },
    { code: 'REMUX_SINGLETON_DEFAULT_MARKED', key: 'disposition.default',
      message: 'Stream 0 → 0: the MP4 target marks this sole video track as default; it has no track-selection effect.' },
  ]),
  'large-mp4': Object.freeze([]),
});
function configuration(argv) {
  assert.ok(Array.isArray(argv) && argv.length === 4 && argv[0] === '--run-owned-remux'
    && ['--qualify', '--normal'].includes(argv[1]) && argv[2] === '--cases' && typeof argv[3] === 'string', 'Exact explicit root proof arguments required.');
  const cases = argv[3].split(','); assert.ok(cases.length > 0 && new Set(cases).size === cases.length && cases.every(c => Object.hasOwn(CASES, c)), 'Only exact named long-remux cases.');
  return Object.freeze({ mode: argv[1], cases: Object.freeze(cases) });
}
function requirePins(id, reportSha) {
  assert.ok(typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    && typeof reportSha === 'string' && /^[a-f0-9]{64}$/.test(reportSha), 'ROOT must fill fixture UUID and report SHA256 before any I/O.');
}
function routeOptions(mode) {
  assert.ok(['--qualify', '--normal'].includes(mode));
  assert.equal(REMUX_POLICIES.length, 5); assert.equal(new Set(REMUX_POLICIES.map(p => p.inputFamily + ':' + p.target)).size, 5);
  if (mode === '--normal') return { remuxPolicies: REMUX_POLICIES, remuxPolicyIdentity: REMUX_POLICY_ID };
  return { remuxPolicies: REMUX_POLICIES.map(route => ({ ...route, id: 'q2o-packet-lab:' + route.id,
    verificationMethod: 'packet-identity-v1',
    evidenceIds: ['q2o-packet-fresh-prospective:' + route.inputFamily + ':' + route.target] })), remuxPolicyIdentity: 'q2o-packet-laboratory-v1' };
}
function requireOutcome(label, result, evidence) {
  assert.ok(Object.hasOwn(EXPECTED_WARNINGS, label) || Object.hasOwn(LEGACY, label)); assert.equal(result.status, 'success', result.reason);
  assert.equal(result.outputDisposition?.published, true); assert.equal(evidence.status, 'completed');
  assert.equal(result.verificationMethod, 'packet-identity-v1'); assert.equal(evidence.verificationMethod, 'packet-identity-v1');
  assert.equal(evidence.essenceEvidence.verificationMethod, 'packet-identity-v1');
  const warnings = values => values.map(v => JSON.stringify({ code: v.code, key: v.key ?? null, message: v.message })).sort();
  if (LEGACY[label]?.kind === 'vfr') vfrProof.requireOutcome(label, result, evidence.essenceEvidence);
  else if (LEGACY[label]?.kind === 'mkv') mkvProof.requireOutcome(label, result, evidence.essenceEvidence);
  else {
    assert.equal(result.outcome, EXPECTED_WARNINGS[label].length ? 'saved-with-warning' : 'saved');
    assert.deepEqual(warnings(result.warnings || []), warnings(EXPECTED_WARNINGS[label]), 'Unexpected warning code/key/message set.');
  }
  const streams = evidence.essenceEvidence.streams;
  assert.ok(streams.length > 0 && streams.every(s => s.source.complete && s.output.complete && s.source.unitCount === s.output.unitCount
    && s.source.contentSha256 === s.output.contentSha256 && s.source.metadataSha256 === s.output.metadataSha256
    && s.timestamps.complete && s.timestamps.comparedUnits === s.source.unitCount), 'Complete native preservation remains mandatory.');
  return true;
}
function requirePerformance(record) {
  assert.ok(Number.isSafeInteger(record.copyMs) && record.copyMs >= 0 && Number.isSafeInteger(record.verificationMs)
    && record.verificationMs >= 0 && record.verificationMs <= LIMITS.verificationMs, 'Packet verification exceeded the prospective 60s ceiling.');
  const calls = record.evidence.invocations;
  assert.equal(calls.filter(c => c.args.includes('-show_packets')).length, 2, 'One complete packet pass per file.');
  assert.ok(calls.every(c => (!c.args.includes('-show_frames') || c.args.includes('-read_intervals') && c.label?.endsWith('-audio-admission')) && (!c.args.includes('rawvideo')
    || c.args.includes('-frames:v') && c.args.every((arg, index) => arg !== '-frames:v' || c.args[index + 1] === '1'))), 'No unbounded native video decoding.');
  const streams = record.evidence.essenceEvidence.streams;
  assert.equal(calls.filter(c => c.args.includes('rawvideo')).length, 2 * streams.filter(s => s.codecType === 'video').length);
  assert.equal(calls.filter(c => c.args.includes('data') && c.args.includes('copy') && !c.args.includes('-bsf:v')).length, 0,
    'Keys are SHA-bound and captured during the complete raw pass, without later seeks.');
  const scans = calls.filter(c => c.args.includes('data') && c.args.includes('h264_mp4toannexb,filter_units=remove_types=12,h264_metadata'));
  assert.equal(scans.length, 2 * streams.filter(s => s.codecType === 'video').length, 'Complete parameter/SEI admission on both files.');
  assert.ok(scans.every(c => ['pipe:1', 'pipe:3', 'framehash', '-copyinkf', 'sha256'].every(arg => c.args.includes(arg))),
    'One child per file proves every packet payload and validates complete video headers.');
  assert.ok(calls.filter(c => c.args.includes('-show_packets')).every(c => !c.args.includes('-show_data_hash')),
    'The metadata pass must not duplicate complete payload hashing.');
  assert.equal(calls.filter(c => c.args.includes('-show_data')).length, streams.filter(s => ['video', 'audio'].includes(s.codecType)).length,
    'Retrieve codec initialization once after complete passes prove both bound hashes equal.');
  assert.equal(calls.filter(c => c.args.includes('-show_frames')).length, 2 * streams.filter(s => s.codecType === 'audio').length);
  assert.equal(calls.filter(c => c.args.some(a => /^pcm_/.test(a))).length, 2 * streams.filter(s => s.codecType === 'audio').length);
}
function requireChildAccounting(record, invocations) {
  const actual = invocations.map(call => JSON.stringify([call.file, call.argv]));
  for (const call of record.evidence.invocations) {
    const key = JSON.stringify([call.executable, call.args]), index = actual.indexOf(key);
    assert.ok(index >= 0, 'Every evidence child must have its own owned invocation receipt.'); actual.splice(index, 1);
  }
  const g = record.runtimeGroup;
  assert.ok(g && g.limit === 2 && g.closed && g.live === 0 && g.liveChildren === 0 && g.started === record.evidence.invocations.length
    && g.completed === g.started && g.childrenStarted === g.started && g.childrenClosed === g.started && g.peakChildren >= 1 && g.peakChildren <= 2,
  'The main Remux group must account every child through actual close.');
}
// Union, not sum: the two owned scanners overlap. This partitions end-to-end
// verification time into observed child liveness and main/harness work.
function childCoverage(calls, start, end) {
  const intervals = calls.filter(call => Number.isFinite(call.childStartedAt) && Number.isFinite(call.childClosedAt))
    .map(call => [Math.max(start, call.childStartedAt), Math.min(end, call.childClosedAt)]).filter(([a, b]) => b >= a).sort((a, b) => a[0] - b[0]);
  let completed = start, milliseconds = 0;
  for (const [a, b] of intervals) { milliseconds += Math.max(0, b - Math.max(a, completed)); completed = Math.max(completed, b); }
  return milliseconds;
}
function legacySource(bytes, label, digest = sha) {
  const expected = LEGACY[label]; assert.ok(expected && Buffer.isBuffer(bytes));
  if (expected.kind === 'vfr') return vfrProof.fixtureSource(bytes, label, digest);
  assert.equal(digest(bytes), MKV_REPORT_SHA, 'Pinned Q2d proof changed.'); const report = JSON.parse(bytes);
  assert.equal(report.id, MKV_REPORT_ID); assert.equal(report.status, 'passed-bounded-copy-service');
  assert.equal(report.liveChildren, 0); assert.equal(report.leaseReleased, true); assert.deepEqual(report.closureFailures, []);
  const entry = expected.origin ? report.sources.find(s => s.origin === expected.file)
    : report.cases.find(c => c.label === expected.seed && c.status === 'passed-real-full-remux-service')?.output;
  assert.ok(entry); assert.equal(expected.origin ? entry.origin : entry.file, expected.file);
  assert.equal(entry.bytes, expected.bytes); assert.equal(entry.sha256, expected.sha256);
  return { file: expected.file, bytes: expected.bytes, sha256: expected.sha256, proof: { reportSha256: MKV_REPORT_SHA } };
}
function fixtureSources(bytes, pins) {
  requirePins(pins.id, pins.sha256); assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 2 * MiB); assert.equal(sha(bytes), pins.sha256, 'Pinned fixture report changed.');
  const report = JSON.parse(bytes.toString('utf8')); assert.equal(report.id, pins.id); assert.equal(report.status, 'passed-owned-fixtures');
  assert.equal(report.liveChildren, 0); assert.equal(report.leaseReleased, true); assert.deepEqual(report.closureFailures, []);
  assert.equal(report.cases.length, FIXTURES.length); const result = new Map();
  for (const spec of FIXTURES) {
    const matches = report.cases.filter(c => c.id === spec.id); assert.equal(matches.length, 1); const entry = matches[0];
    const file = path.join(OWNED, 'fixtures', 'remux-long-' + pins.id, spec.name);
    assert.equal(entry.output, file); assert.equal(entry.status, 'passed-generated-metadata');
    assert.ok(entry.file && /^[a-f0-9]{64}$/.test(entry.file.sha256) && Number.isSafeInteger(entry.file.bytes)
      && entry.file.bytes >= (spec.minBytes || 1) && entry.file.bytes < spec.maxBytes);
    assert.equal(entry.observation.scope, 'generated-source-metadata-only'); assert.equal(entry.observation.seconds, spec.seconds);
    result.set(spec.id, { file, bytes: entry.file.bytes, sha256: entry.file.sha256 });
  }
  return result;
}
function requireStart(count) { assert.ok(Number.isSafeInteger(count) && count >= 0 && count < LIMITS.maxStarts, 'Prospective Start ceiling.'); }
function requireRefusal(label, result) {
  assert.equal(CASES[label]?.refusal, 'REMUX_DEFAULT_DISPOSITION_UNREPRESENTABLE');
  assert.equal(result.status, 'unsupported'); assert.equal(result.reasonCode, CASES[label].refusal);
  assert.notEqual(result.outputDisposition?.published, true);
}
async function observeCopyStage(io, file, stillLive) {
  let stat;
  try { stat = await io.lstat(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n, 'Copy stage must be an ordinary owned file.');
  return stillLive() && stat.size > 0n ? { stage: 'copy', bytes: String(stat.size), observation: 'owned-stage-growth', liveOwnedChild: true } : null;
}
function createSmoke(dependencies = {}) {
  return async argv => {
    const config = configuration(argv), pins = dependencies.pins || { id: FIXTURE_ID, sha256: FIXTURE_REPORT_SHA };
    requirePins(pins.id, pins.sha256);
    const session = (dependencies.createOwnedSession || createOwnedSession)({ kind: 'smoke', limits: LIMITS, dependencies });
    const Service = dependencies.EncoderService || EncoderService, controlsFactory = dependencies.createOperationControls || createOperationControls;
    const copy = dependencies.copyPinnedFile || copyPinnedFile, hash = dependencies.hashFile || hashFile;
    let service, activeCase = null, cancellation = null, caseSampler;
    const report = session.report; report.mode = config.mode; report.selectedCases = config.cases;
    const cancel = evidence => {
      if (cancellation || !activeCase?.cancel) return;
      cancellation = evidence; activeCase.cancelObserved = evidence;
      // Never await the service from its own live child's callback.
      void service.cancelCurrent();
    };
    try {
      await session.open();
      const reportPath = path.join(ROOT, 'artifacts/v0.7/q2i/fixtures', pins.id, 'report.json');
      const reportBytes = await (dependencies.readFixtureReport || readBoundedFile)(reportPath, 2 * MiB, { io: session.io, signal: session.controller.signal });
      const sources = fixtureSources(reportBytes, pins);
      const stateDir = path.join(session.owned, 'state'); await session.io.mkdir(stateDir);
      const controls = controlsFactory({ runtime: session.runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID, ...routeOptions(config.mode) });
      if (typeof controls.operationStorage === 'function') {
        const openStore = controls.operationStorage;
        controls.operationStorage = async () => {
          const store = await openStore();
          return { ...store, observeGrowth: async (...args) => {
            const metric = activeCase && (activeCase.storageProfile ||= { observations: 0, wallMs: 0 });
            const start = performance.now(); if (metric) metric.observations++;
            try { return await store.observeGrowth(...args); } finally { if (metric) metric.wallMs += performance.now() - start; }
          } };
        };
      }
      // Every real runtime invocation goes through the same prospective child
      // accounting, including initial probes and all complete verification.
      const run = async (file, args, options = {}, execute) => {
        const isCopy = args.includes('-progress') && args.includes('-c') && args[args.indexOf('-c') + 1] === 'copy', sink = options.onStdoutChunk;
        const start = Date.now(); if (activeCase && args.includes('-show_packets')) activeCase.verificationStartedAt ??= start;
        let liveChild = null, closed = false, exited = false, verifiedBytes = 0, copySampler, sampling = false, samplePromise;
        try { return await session.run(file, args, { ...options,
          onChild(child) { liveChild = child; child.once('close', () => { closed = true; }); child.once('exit', () => { exited = true; }); options.onChild?.(child);
            // A sub-second copy can emit only progress=end. Observe actual
            // owned stage growth while its same child is alive, without changing
            // production argv or slowing/replaying the copy to manufacture proof.
            if (activeCase?.cancel === 'copy' && isCopy) {
              copySampler = setInterval(() => {
                if (sampling || cancellation || closed || exited || child.exitCode !== null) return;
                sampling = true;
                samplePromise = (async () => {
                try {
                  const observed = await observeCopyStage(session.io, args.at(-1), () => !closed && !exited && child.exitCode === null);
                  if (observed) cancel(observed);
                } catch (error) {
                  report.copyObservationFailure = fault(error); session.controller.abort();
                } finally { sampling = false; }
                })();
              }, 10); copySampler.unref();
            }
          },
          ...(options.onProgress ? { onProgress(record) { options.onProgress(record);
            if (activeCase?.cancel === 'copy' && isCopy && liveChild?.exitCode === null && !closed && !exited && !record.ended && (record.frame > 0 || record.bytes > 0))
              cancel({ stage: 'copy', frame: record.frame, bytes: record.bytes, liveOwnedChild: true });
          } } : {}),
          ...(sink ? { async onStdoutChunk(bytes, pipe) { await sink(bytes, pipe); verifiedBytes += bytes.length;
            if (activeCase?.cancel === 'verification' && args.includes('-show_packets') && liveChild?.exitCode === null && !closed && !exited && verifiedBytes >= 4096)
              cancel({ stage: 'verification', bytes: verifiedBytes, liveOwnedChild: true });
          } } : {}),
        }, execute); } finally {
          clearInterval(copySampler); await samplePromise;
          if (activeCase && isCopy) {
            const finished = Date.now(); activeCase.copyMs += finished - start;
            // Include post-copy probing, full file identity/seals and admission
            // setup, rather than starting the performance clock at packet IO.
            if (activeCase.cancel !== 'copy') activeCase.verificationStartedAt ??= finished;
          }
        }
      };
      const observer = controls.operationRuntime, invoke = observer.invoke.bind(observer);
      observer.invoke = (token, tool, args, options) => run(session.runtime[tool], args, options, (_file, av, opts) => invoke(token, tool, av, opts));
      if (typeof observer.invokeRemux === 'function') {
        const invokeRemux = observer.invokeRemux.bind(observer);
        observer.invokeRemux = (group, tool, args, options) => run(session.runtime[tool], args, options,
          (_file, av, opts) => invokeRemux(group, tool, av, opts));
      }
      service = new Service({ ffmpeg: session.runtime.ffmpeg, ffprobe: session.runtime.ffprobe, stateDir, inspectionWorkers: 1,
        runtimeIdentity: FAMILIES[0].runtimeIdentity, run, ...controls }); await service.initializeDiagnostics();
      session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });
      for (const label of config.cases) report.cases.push({ label, ...CASES[label], status: 'pending', copyMs: 0, verificationMs: 0, wallMs: 0,
        bytesRead: null, peakRssBytes: process.memoryUsage().rss });
      for (const record of report.cases) {
        const label = record.label, spec = CASES[label]; let original, file;
        record.invocationStart = report.invocations?.length || 0;
        record.peakHeapUsedBytes = process.memoryUsage().heapUsed;
        activeCase = record; cancellation = null;
        try {
        original = spec.legacy ? await (dependencies.readLegacySource || (async name => {
          const binding = LEGACY[name], reportFile = binding.kind === 'vfr' ? binding.report : path.join(ROOT, 'artifacts/v0.7/q2d-mkv-mp4', MKV_REPORT_ID, 'report.json');
          const bytes = await readBoundedFile(reportFile, 16 * MiB, { io: session.io, signal: session.controller.signal });
          return legacySource(bytes, name);
        }))(spec.legacy) : sources.get(spec.fixture);
        const input = path.join(session.owned, 'input-' + label), output = path.join(session.owned, 'output-' + label);
        await session.io.mkdir(input); await session.io.mkdir(output); file = path.join(input, path.basename(original.file));
        const copied = await copy(original.file, file, original, { io: session.io, signal: session.controller.signal }); assert.equal(copied.sha256, original.sha256);
        Object.assign(record, { input: file, outputDirectory: output, status: 'preparing' });
        caseSampler = setInterval(() => { const memory = process.memoryUsage(); record.peakRssBytes = Math.max(record.peakRssBytes, memory.rss);
          record.peakHeapUsedBytes = Math.max(record.peakHeapUsedBytes, memory.heapUsed); }, 100); caseSampler.unref();
        const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
        await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: spec.target }); await service.taskPromise;
        let ready = service.snapshot(), item = ready.items.find(i => i.name === path.basename(file));
        if (item.status === 'generated') {
          await service.reencodeOutputs({ planId: ready.planId, fileIds: [item.id] }); await service.taskPromise;
          ready = service.snapshot(); item = ready.items.find(i => i.name === path.basename(file)); record.generatedSourceAuthorized = true;
        }
        if (spec.omissions) {
          mkvProof.requireOmissionRefusal(item); const ids = item.remux.omissionCandidates.filter(c => /audio/.test(c.label)).map(c => c.id);
          assert.equal(ids.length, spec.omissions); await service.setRemuxOmissions({ planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision, decisionIds: ids });
          await service.taskPromise; ready = service.snapshot(); item = ready.items.find(i => i.name === path.basename(file)); record.omissionIds = ids;
        }
        if (spec.refusal) {
          requireRefusal(label, item); record.result = ready;
          assert.deepEqual(await session.io.readdir(output), [], 'A refused source cannot create a stage or publication.');
          assert.equal((await hash(file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
          assert.equal((await hash(original.file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
          assert.equal(session.children.size, 0); record.noPublication = true; record.status = 'passed-preservation-refusal'; continue;
        }
        assert.equal(ready.phase, 'ready', ready.error); assert.equal(item.status, 'ready', item.reason);
        record.prepared = ready; record.details = service.getEncodingDetails({ planId: ready.planId, fileId: item.id });
        const started = Date.now(); requireStart(report.acceptedStarts);
        service.startBatch({ planId: ready.planId, fileIds: [item.id] }); report.acceptedStarts++; await service.taskPromise;
        record.wallMs = Date.now() - started; record.result = service.snapshot();
        const result = record.result.items.find(i => i.id === item.id), entry = service.plan.entries.get(item.id);
        record.evidence = entry.operationEvidence;
        record.runtimeGroup = entry.operationRuntimeGroup || null;
        record.verificationMs = record.verificationStartedAt === undefined ? 0 : Date.now() - record.verificationStartedAt;
        record.bytesRead = record.evidence?.ioBytes || null; record.peakRssBytes = Math.max(record.peakRssBytes, process.memoryUsage().rss);
        clearInterval(caseSampler); caseSampler = null;
        if (spec.cancel) {
          assert.ok(cancellation?.liveOwnedChild && cancellation.stage === spec.cancel, 'Cancellation must observe the intended live child stage.');
          assert.equal(result.status, 'cancelled', result.reason); assert.notEqual(result.outputDisposition?.published, true);
          await assert.rejects(session.io.lstat(entry.destination), { code: 'ENOENT' }); record.noPublication = true; record.status = 'passed-live-cancellation';
        } else {
          requireOutcome(label, result, record.evidence); requirePerformance(record);
          requireChildAccounting(record, (report.invocations || []).slice(record.invocationStart)); assert.deepEqual(result.evidenceStorage.final.violations, []);
          if (LEGACY[label]?.kind === 'vfr') vfrProof.requireCadence(record.evidence.essenceEvidence, vfrProof.FIXTURES[label]);
          if (label === 'timeline-video-mp4') mkvProof.requireCadence(record.evidence.essenceEvidence, 'variable');
          if (label === 'cfr-video-mp4') { mkvProof.requireCadence(record.evidence.essenceEvidence, 'constant'); mkvProof.requireCfrRates(entry.inspection.probe); }
          record.output = { file: entry.destination, ...await hash(entry.destination, { io: session.io, signal: session.controller.signal }) };
          assert.equal(record.output.sha256, record.evidence.essenceEvidence.outputFileSha256); record.status = 'passed-complete-verified-remux';
        }
        assert.equal((await hash(file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
        assert.equal((await hash(original.file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
        assert.equal(session.children.size, 0);
        } catch (error) {
          record.status = 'failed-retained'; record.failure = fault(error); report.failure ||= record.failure;
          report.status = 'failed-retained';
          try {
            await service.cancelCurrent(); await service.taskPromise;
            assert.ok(['idle', 'ready', 'completed', 'cancelled', 'error'].includes(service.snapshot().phase), 'Case work has not drained.');
            assert.equal(session.children.size, 0, 'A failed case still has a live owned child.');
            assert.equal(session.controller.signal.aborted, false, 'The proof session was aborted.');
            assert.ok(original && file, 'An input-pin/preparation failure cannot safely continue.');
            assert.equal((await hash(file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
            assert.equal((await hash(original.file, { io: session.io, signal: session.controller.signal })).sha256, original.sha256);
            assert.equal(typeof session.assertHealthy, 'function', 'The owned session must verify its held lease before continuation.');
            const health = await session.assertHealthy();
            assert.ok(health?.leaseIntact === true && health.liveChildren === 0, 'The owned session did not prove safe continuation.');
            record.continuation = { safe: true, leaseIntact: true, liveChildren: 0, sourcePinsIntact: true };
          } catch (unsafe) { record.continuation = { safe: false, failure: fault(unsafe) }; throw unsafe; }
        } finally {
          clearInterval(caseSampler); caseSampler = null; activeCase = null;
          record.childCount = (report.invocations?.length || 0) - record.invocationStart;
          record.endHeapUsedBytes = process.memoryUsage().heapUsed;
          record.toolWallMs = (report.invocations || []).slice(record.invocationStart).reduce((sum, call) => sum + (call.wallMs || 0), 0);
          if (record.verificationStartedAt !== undefined) {
            record.verificationChildActiveMs = childCoverage((report.invocations || []).slice(record.invocationStart), record.verificationStartedAt,
              record.verificationStartedAt + record.verificationMs);
            record.verificationOutsideChildMs = record.verificationMs - record.verificationChildActiveMs;
            const calls = (report.invocations || []).slice(record.invocationStart), controls = calls.flatMap(call => [
              { childStartedAt: call.admissionStartedAt, childClosedAt: call.executorStartedAt },
              { childStartedAt: call.executorSettledAt, childClosedAt: call.proofDoneAt }]);
            record.verificationHarnessOutsideChildMs = childCoverage([...calls, ...controls], record.verificationStartedAt,
              record.verificationStartedAt + record.verificationMs) - record.verificationChildActiveMs;
            record.verificationProductAndUnattributedMs = record.verificationMs - record.verificationHarnessOutsideChildMs;
          }
          if (record.label === 'large-mp4' && original) record.verificationSecondsPerGB = record.verificationMs / 1000 / (original.bytes / 1e9);
          await session.save();
        }
      }
      report.status = report.cases.some(c => c.status === 'failed-retained') ? 'failed-retained' : 'passed-owned-long-remux';
    } catch (error) {
      report.status = 'failed-retained'; report.failure ||= fault(error); report.stopped = fault(error);
      for (const record of report.cases) if (record.status === 'pending') { record.status = 'not-run-unsafe'; record.failure = fault(error); }
    }
    finally {
      clearInterval(caseSampler);
      if (service) {
        try { await service.cancelCurrent(); await service.closeOperationResources(); report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
          assert.equal(report.diagnosticClosure.persisted, true);
        } catch (error) { report.status = 'failed-retained'; report.serviceClosureFailure = fault(error); }
      }
      await session.close();
    }
    return report;
  };
}
module.exports = { createSmoke, configuration, requirePins, fixtureSources, requireOutcome, requireStart, requireRefusal, observeCopyStage, requirePerformance, requireChildAccounting, childCoverage,
  legacySource, routeOptions, CASES, LIMITS, EXPECTED_WARNINGS, LEGACY, MKV_REPORT_SHA, MKV_REPORT_ID };
if (require.main === module) createSmoke()(process.argv.slice(2)).then(report => {
  console.log(JSON.stringify({ id: report.id, status: report.status, report: path.join(report.directory, 'report.json'), failure: report.failure }));
  if (report.status !== 'passed-owned-long-remux') process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
