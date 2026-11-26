'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { createOwnedSession, generationArgs, TS_FIXTURES, hashFile, readBoundedFile, sha, fault, ROOT } = require('./v07-remux-long-fixtures.cjs');
const { requireOutcome } = require('./v07-remux-long-smoke.cjs');

const MiB = 1024 ** 2, MINIMUM_FREE = 25 * 1024 ** 3;
const FORECAST = 1040 * MiB;
const BASELINE = '7a11e48a-9bfd-4f5c-98c7-8d86f1473056';
const BASELINE_SHA = '89f50158402ba5a09f84d38bcc540d76f6d237aad46fbd1941f709df3d0fb5e1';
const LIMITS = Object.freeze({ totalMs: 540000, childMs: 150000, maxChildren: 40, maxStarts: 2,
  minimumDFreeBytes: MINIMUM_FREE, forecastBytes: 384 * MiB, marginBytes: 64 * MiB, reportBytes: 8 * MiB });
const FIXTURES = Object.freeze([
  { id: 'low', rate: '1600k', cap: 20 * MiB },
  { id: 'high', rate: '14000k', cap: 120 * MiB },
]);
const SECONDS = 60, MINIMUM_SPREAD = 64 * MiB;
const TARGET = Object.freeze({ fixedSeconds: 3, secondsPerDecimalGB: 6 });
const targetSeconds = byteCount => TARGET.fixedSeconds + TARGET.secondsPerDecimalGB * byteCount / 1e9;

function fixtureArgs(file, { rate, cap }) {
  const spec = TS_FIXTURES.find(item => item.id === 'TS_AV');
  const args = [...generationArgs(spec, file)];
  args[args.findIndex(value => value.startsWith('color='))] = 'testsrc2=size=1920x1080:rate=30:duration=' + SECONDS;
  const tone = args.findIndex(value => value.startsWith('aevalsrc='));
  args[tone] = args[tone].replace(/:d=\d+$/, ':d=' + SECONDS);
  args.splice(args.indexOf('-crf:v'), 2, '-b:v', rate, '-maxrate:v', rate, '-bufsize:v', rate);
  args[args.indexOf('-t') + 1] = String(SECONDS);
  args[args.indexOf('-fs') + 1] = String(cap);
  return args;
}

async function available(io, location) {
  const stat = await io.statfs(location, { bigint: true });
  return Number(stat.bavail * stat.bsize);
}

function fit([low, high], metric) {
  const deltaGB = (high.source.bytes - low.source.bytes) / 1e9;
  const secondsPerDecimalGB = (high.timing[metric] - low.timing[metric]) / 1000 / deltaGB;
  const fixedSeconds = low.timing[metric] / 1000 - secondsPerDecimalGB * low.source.bytes / 1e9;
  return { metric, deltaGB, secondsPerDecimalGB, fixedSeconds,
    withinFixed: fixedSeconds >= 0 && fixedSeconds <= TARGET.fixedSeconds,
    withinRate: secondsPerDecimalGB >= 0 && secondsPerDecimalGB <= TARGET.secondsPerDecimalGB,
    bothUnderEnvelope: [low, high].every(row => row.timing[metric] / 1000 <= row.targetSeconds) };
}

function durationOf(intervals) {
  const points = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && start <= end)
    .sort(([a], [b]) => a - b);
  let last = -Infinity, ms = 0;
  for (const [a, b] of points) { ms += Math.max(0, b - Math.max(a, last)); last = Math.max(last, b); }
  return ms;
}

function wrapperOutsideChildMs(calls, begin, end) {
  const clip = (a, b) => [Math.max(a, begin), Math.min(b, end)];
  const children = calls.map(call => clip(call.childStartedAt, call.childClosedAt));
  const wrappers = calls.flatMap(call => [clip(call.admissionStartedAt, call.executorStartedAt),
    clip(call.executorSettledAt, call.proofDoneAt)]);
  return durationOf([...children, ...wrappers]) - durationOf(children);
}

async function retainedSources() {
  const directory = path.join(ROOT, 'artifacts/v0.7/q2o-regular-performance/smoke', BASELINE);
  const data = await readBoundedFile(path.join(directory, 'report.json'), 8 * MiB);
  assert.equal(sha(data), BASELINE_SHA);
  const old = JSON.parse(data);
  assert.equal(old.id, BASELINE);
  assert.equal(old.status, 'measured-target-miss');
  assert.equal(old.leaseReleased, true);
  assert.equal(old.liveChildren, 0);
  assert.deepEqual(old.closureFailures, []);
  const result = new Map();
  for (const fixture of FIXTURES) {
    const row = old.cases.find(value => value.id === fixture.id), file = path.join(directory, 'owned', fixture.id, 'input', 'ts-av.ts');
    assert.equal(row.source.file, file);
    assert.equal(row.result.status, 'success');
    assert.equal(row.evidence.essenceEvidence.streams[0].source.unitCount, '1800');
    assert.deepEqual(await hashFile(file), { bytes: row.source.bytes, sha256: row.source.sha256, identity: row.source.identity });
    result.set(fixture.id, row);
  }
  return result;
}

async function run(reuse) {
  const retained = reuse ? await retainedSources() : null;
  const limits = reuse ? { ...LIMITS, marginBytes: 32 * MiB } : LIMITS;
  const forecast = reuse ? 800 * MiB : FORECAST;
  const session = createOwnedSession({ kind: 'smoke', limits, regularProof: 'remux-performance',
    ...(retained ? { readOnlyInputs: [...retained.values()].map(row => row.source.file) } : {}) });
  const { report, io, controller: { signal } } = session;
  report.target = TARGET;
  if (retained) report.baseline = { id: BASELINE, sha256: BASELINE_SHA, inputOrder: ['high', 'low'], marginBytes: limits.marginBytes };
  report.scope = 'Normal Windows 9.1 MPEG-TS to MP4, two 60-second 1080p30 owned files with different coded byte sizes';
  report.limitations.push('One measurement at each size on the current drive. Source hashing warmed the cache. Per-child guard and receipt costs are included in raw times.',
    'Only the chosen Windows transport route and byte range are measured. No drive speed, fixed overhead or slope may be generalized across routes.');
  let service;
  try {
    report.sameVolumeAdmission = { availableBytes: await available(io, path.parse(session.owned).root),
      requiredBytes: MINIMUM_FREE + forecast, floorBytes: MINIMUM_FREE, forecastBytes: forecast };
    assert(report.sameVolumeAdmission.availableBytes >= report.sameVolumeAdmission.requiredBytes, 'Same-volume forecast would consume the 25 GiB reserve.');
    await session.open();
    const { runtime } = session, stateDir = path.join(session.owned, 'state');
    const factoryOptions = { runtime, stateDir };
    report.factoryInputs = Object.keys(factoryOptions).sort();
    await io.mkdir(stateDir);
    const controls = createOperationControls(factoryOptions), { operationRuntime } = controls;
    for (const method of ['invoke', 'invokeRemux']) {
      const invoke = operationRuntime[method].bind(operationRuntime);
      operationRuntime[method] = (token, tool, args, options) => session.run(runtime[tool], args, options,
        (_file, argv, owned) => invoke(token, tool, argv, owned));
    }
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1,
      runtimeIdentity: REGULAR_WINDOWS_PAIR, run: session.run, ...controls });
    await service.initializeDiagnostics();
    signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });

    for (const fixture of reuse ? [...FIXTURES].reverse() : FIXTURES) {
      const prior = retained?.get(fixture.id);
      const root = path.join(session.owned, fixture.id), output = path.join(root, 'output');
      const input = prior ? path.dirname(prior.source.file) : path.join(root, 'input');
      for (const dir of prior ? [root, output] : [root, input, output]) await io.mkdir(dir);
      const source = prior?.source.file ?? path.join(input, TS_FIXTURES.find(item => item.id === 'TS_AV').name);
      const row = { id: fixture.id, plannedVideoRate: fixture.rate, hardSourceCapBytes: fixture.cap };
      report.cases.push(row);
      if (!prior) {
        assert(await available(io, session.owned) >= MINIMUM_FREE + fixture.cap + limits.marginBytes, 'Owned generation needs room above the scratch floor.');
        await session.run(runtime.ffmpeg, fixtureArgs(source, fixture));
      }
      row.source = { file: source, ...await hashFile(source, { io, signal }) };
      assert(row.source.bytes < fixture.cap, 'Fixture generation reached the hard byte cap.');
      if (prior) assert.deepEqual(row.source, prior.source);
      row.targetSeconds = targetSeconds(row.source.bytes);
      const [a, b] = [await service.registerFolder(input, 'input'), await service.registerFolder(output, 'output')];
      const firstCall = report.invocations.length, preparedAtWall = Date.now(), preparedAt = performance.now();
      await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'mp4' });
      await service.taskPromise;
      const readyAt = performance.now(), readyWall = Date.now(), ready = service.snapshot(), item = ready.items[0];
      row.prepared = item;
      row.timing = { prepareMs: readyAt - preparedAt };
      await session.save();
      assert.equal(item?.status, 'ready', item?.reason);
      const entry = service.plan.entries.get(item.id), probe = entry.inspection.probe;
      assert.equal(probe.streams.find(stream => stream.codec_type === 'video').width, 1920);
      assert.equal(probe.streams.find(stream => stream.codec_type === 'video').height, 1080);
      assert(Number(probe.format.duration) >= SECONDS && Number(probe.format.duration) <= SECONDS + 0.2, 'Fixture has a truncated or unexpected presentation duration.');
      row.seconds = Number(probe.format.duration);
      const selected = service.remuxOperations.requireCurrent(entry.qualificationSelection, entry.qualificationBindings);
      assert.equal(selected.verificationMethod, 'packet-identity-v1');
      row.policy = selected.qualification.cellId;
      row.storage = { availableBytes: await available(io, session.owned),
        reservedBytes: selected.resources.outputReserveBytes + selected.resources.evidenceReserveBytes + limits.marginBytes };
      assert(Number.isSafeInteger(row.storage.reservedBytes) && row.storage.availableBytes >= MINIMUM_FREE + row.storage.reservedBytes,
        'Current output and evidence forecasts would consume the 25 GiB reserve.');
      const startWall = Date.now(), start = performance.now();
      service.startBatch({ planId: ready.planId, fileIds: [item.id] });
      report.acceptedStarts++;
      await service.taskPromise;
      const done = performance.now(), doneWall = Date.now();
      row.result = service.snapshot().items[0];
      row.evidence = entry.operationEvidence;
      row.timing.startToTerminalMs = done - start;
      const calls = report.invocations.slice(firstCall);
      const copy = calls.find(call => call.file === runtime.ffmpeg && call.argv.some((value, i) => value === '-c' && call.argv[i + 1] === 'copy')
        && call.argv.some((value, i) => value === '-f' && call.argv[i + 1] === 'mp4'));
      if (copy) {
        row.timing.copyMs = copy.childClosedAt - copy.childStartedAt;
        row.timing.beforeCopyMs = copy.childStartedAt - startWall;
        row.timing.postCopyMs = doneWall - copy.childClosedAt;
        row.timing.preparePlusPostCopyMs = row.timing.prepareMs + row.timing.postCopyMs;
        row.timing.fullWallMs = row.timing.prepareMs + row.timing.startToTerminalMs;
        row.timing.wallExcludingCopyMs = row.timing.fullWallMs - row.timing.copyMs;
        row.timing.prepareWrapperMs = wrapperOutsideChildMs(calls, preparedAtWall, readyWall);
        row.timing.postCopyWrapperMs = wrapperOutsideChildMs(calls, copy.childClosedAt, doneWall);
        row.timing.postCopyWithMeasuredWrappersExcludedMs = row.timing.postCopyMs - row.timing.postCopyWrapperMs;
        row.timing.postCopyRawSecondsPerDecimalGB = row.timing.postCopyMs / 1000 / (row.source.bytes / 1e9);
      }
      await session.save();
      requireOutcome('ts-mp4', row.result, row.evidence);
      assert.equal(row.evidence.essenceEvidence.streams[0].source.unitCount, '1800');
      if (prior) {
        assert.equal(row.evidence.transport.sourceAcquisition.method, 'packet-hash-and-binary-demux');
        assert.equal(row.evidence.nativeTransportPayload.complete, true);
        const identity = result => result.evidence.essenceEvidence.streams.map(({ source, output, timestamps }) =>
          [source.unitCount, source.contentSha256, source.metadataSha256, source.decoderParametersSha256,
            output.unitCount, output.contentSha256, output.metadataSha256, output.decoderParametersSha256, timestamps]);
        assert.deepEqual(identity(row), identity(prior), 'The acquisition change must preserve the entire source and output proof transcript.');
      }
      assert(copy?.closed?.code === 0 && row.timing.postCopyMs >= 0, 'The protected copy child must have observed timing and closure.');
      row.output = { file: entry.destination, ...await hashFile(entry.destination, { io, signal }) };
      assert.equal(row.output.sha256, row.evidence.essenceEvidence.outputFileSha256);
      assert.deepEqual(await hashFile(source, { io, signal }), { bytes: row.source.bytes, sha256: row.source.sha256, identity: row.source.identity });
      await session.save();
    }
    const bySize = [...report.cases].sort((a, b) => a.source.bytes - b.source.bytes);
    const [low, high] = bySize;
    report.byteSpread = high.source.bytes - low.source.bytes;
    assert(report.byteSpread >= MINIMUM_SPREAD, 'The recorded coded byte spread is insufficient to estimate a rate.');
    report.fit = ['postCopyMs', 'wallExcludingCopyMs', 'preparePlusPostCopyMs', 'postCopyWithMeasuredWrappersExcludedMs']
      .map(metric => fit(bySize, metric));
    const raw = report.fit.slice(0, 2);
    report.status = raw.every(metric => metric.withinFixed && metric.withinRate && metric.bothUnderEnvelope)
      ? 'measured-within-target' : 'measured-target-miss';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    try {
      if (service) {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('measured') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      }
    } catch (error) { report.status = 'failed-retained'; report.serviceClosureFailure = fault(error); }
    finally { await session.close(); }
  }
  return report;
}

if (require.main === module) {
  const [mode, reuse, ...extra] = process.argv.slice(2);
  assert(mode === '--run-owned-remux-performance' && (reuse === undefined || reuse === '--reuse-pinned-baseline') && extra.length === 0);
  run(reuse !== undefined).then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, closed: report.childrenClosed, starts: report.acceptedStarts,
      report: path.join(report.directory, 'report.json'), failure: report.failure, fit: report.fit,
      closureFailures: report.closureFailures, serviceClosureFailure: report.serviceClosureFailure }));
    process.exitCode = report.status === 'measured-within-target' ? 0 : report.status === 'measured-target-miss' ? 2 : 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
