'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { WINDOWS_AAC_FAMILY, EXPLICIT_AAC_DISCARD_CLOCK, EXPLICIT_AAC_DISCARD_ALIGNMENT } = require('../src/operation-aac-discard-clock.cjs');
const { PROFILES } = require('../src/media.cjs');
const { lossySignal } = require('./v07-encode-operation-smoke.cjs');
const { fixtureArgs, audioBytes, videoFrames } = require('./v07-regular-precision-aac-proof.cjs');
const { createOwnedSession, hashFile, fault } = require('./v07-remux-long-fixtures.cjs');

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 360000, childMs: 90000, maxChildren: 62, maxStarts: 3,
  minimumDFreeBytes: 25 * GiB, marginBytes: 128 * MiB, forecastBytes: 256 * MiB, reportBytes: 12 * MiB });
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const LAB = 'c38c5ef3-0e2f-428d-ad66-0bd7c61faf3f';
const HOLDOUTS = [
  { rate: 44100, layout: 'stereo', channels: 2, bitrate: 320, frequency: 809, range: { startUs: 1137721, endUs: 2065823 } },
  { rate: 48000, layout: 'mono', channels: 1, bitrate: 128, frequency: 1031, range: { startUs: 2198719, endUs: 2999527 } },
  { rate: 48000, layout: 'mono', channels: 1, bitrate: 128, frequency: 1213, range: { startUs: 1200000, endUs: 1882666 } },
];

function prospectiveFamily() {
  const evidenceIds = [LAB + ':endpoints', LAB + ':interior'];
  return { id: WINDOWS_AAC_FAMILY, evidenceIds, runtimeIdentity: REGULAR_WINDOWS_PAIR, environment: null, settings: SETTINGS,
    budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS,
    qualification: { evidenceId: evidenceIds[0], runtimeIdentity: REGULAR_WINDOWS_PAIR, containerDuration: EXPLICIT_AAC_DISCARD_CLOCK,
      tolerances: { videoTimestampUs: 1067, audioTimestampUs: 1046, avSyncUs: 2113, durationUs: 1088, sampleCount: 0 } },
    timingQualification: { evidenceId: evidenceIds[1], runtimeIdentity: REGULAR_WINDOWS_PAIR, videoDurationUs: 1067, audioTimelineUs: 1046,
      aac: { alignment: EXPLICIT_AAC_DISCARD_ALIGNMENT, encoderDelaySamples: 1024, discardPaddingSamples: null } },
  };
}

async function run(prospective) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'precision-aac' });
  const { report, io } = session;
  report.scope = prospective ? 'Prospective Windows precision AAC service proof' : 'Default Windows precision AAC service proof';
  report.lab = LAB;
  let service;
  try {
    await session.open();
    const runtime = session.runtime, stateDir = path.join(session.owned, 'state');
    await io.mkdir(stateDir);
    const factoryInputs = { runtime, stateDir, ...(prospective
      ? { families: [prospectiveFamily()], policyIdentity: 'windows-9.1-precision-aac-prospective' } : {}) };
    report.factoryInputs = Object.keys(factoryInputs).sort();
    const controls = createOperationControls(factoryInputs);
    const invoke = controls.operationRuntime.invoke.bind(controls.operationRuntime);
    controls.operationRuntime.invoke = (token, tool, argv, options) => session.run(runtime[tool], argv, options,
      (_file, args, owned) => invoke(token, tool, args, owned));
    // Keep device queries independent. Exercise the sole CPU capability in
    // this run before serving it to the normal preparation path.
    const trial = path.join(session.owned, 'cpu-init.mkv');
    await session.run(runtime.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=0.08',
      '-c:v', 'libx265', '-preset:v', 'slow', '-crf:v', '25', '-x265-params', 'log-level=error',
      '-frames:v', '2', '-an', '-f', 'matroska', trial]);
    assert.equal((await videoFrames(session, trial)).length, 2);
    const profile = PROFILES.find(item => item.id === SETTINGS.profileId);
    const capabilities = { profiles: [{ ...profile, available: true, supportedBitDepths: [8] }], vendorProfiles: [], recipes: [], versions: {} };
    report.cpuTrial = { path: trial, ...await hashFile(trial), profile: SETTINGS, frames: 2 };
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, run: session.run,
      runtimeIdentity: REGULAR_WINDOWS_PAIR, inspectionWorkers: 1, ...controls, capabilities: async () => capabilities });
    await service.initializeDiagnostics();
    session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });
    for (const [index, tuple] of (prospective ? HOLDOUTS.slice(0, 2) : HOLDOUTS).entries()) {
      const input = path.join(session.owned, 'input-' + index), output = path.join(session.owned, 'output-' + index);
      await io.mkdir(input);
      await io.mkdir(output);
      const source = path.join(input, 'source.mov');
      await session.run(runtime.ffmpeg, fixtureArgs(tuple, source));
      const sourcePin = await hashFile(source);
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
      await service.taskPromise;
      let ready = service.snapshot();
      assert.equal(ready.phase, 'ready', ready.error);
      const { id } = ready.items[0];
      const row = { tuple, source, sourcePin, defaults: ready };
      report.cases.push(row);
      const overrides = { target: 'matroska', resolution: 'source', hdrPolicy: 'preserve', audioPolicy: 'precision-aac',
        range: tuple.range, aacBitrateKbps: null, omissionRequestIds: [] };
      async function edit(changes) {
        const draft = ready.operationDraft;
        await service.updateFileOperations({ planId: ready.planId, draftId: draft.id, revision: draft.revision,
          fileIds: [id], overrides: { ...overrides, ...changes } });
        await service.taskPromise;
        ready = service.snapshot();
        return ready.items.find(item => item.id === id);
      }
      if (index === 0) {
        row.refusedBitrate = await edit({ aacBitrateKbps: 160 });
        assert.equal(row.refusedBitrate.status, 'unsupported', row.refusedBitrate.reason);
        const before = report.invocations.length;
        assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [id] }), { code: 'INVALID_SELECTION' });
        assert.equal(report.invocations.length, before);
        assert.deepEqual(await io.readdir(output), []);
      } else if (index === 2) {
        row.refusedShortTail = await edit({ range: { startUs: 1200000, endUs: 1882687 } });
        assert.equal(row.refusedShortTail.status, 'unsupported', row.refusedShortTail.reason);
        assert.match(row.refusedShortTail.reason, /positive duration on the verified one-millisecond/);
        const before = report.invocations.length;
        assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [id] }), { code: 'INVALID_SELECTION' });
        assert.equal(report.invocations.length, before);
      }
      const item = await edit({});
      row.prepared = item;
      await session.save();
      assert.equal(item.status, 'ready', item.reason);
      const entry = service.plan.entries.get(id);
      row.selection = service.operationQualifications.requireCurrent(entry.qualificationSelection, entry.qualificationBindings);
      assert.equal(row.selection.sourcePolicy.id, WINDOWS_AAC_FAMILY);
      assert.equal(row.selection.qualification.containerDuration, EXPLICIT_AAC_DISCARD_CLOCK);
      assert.deepEqual(row.selection.budget, EVIDENCE_BUDGET);
      service.startBatch({ planId: ready.planId, fileIds: [id] });
      report.acceptedStarts++;
      await service.taskPromise;
      row.outcome = service.snapshot().items[0];
      row.evidence = entry.operationEvidence;
      row.telemetry = entry.telemetryValidation;
      await session.save();
      assert.equal(row.outcome.status, 'success', row.outcome.reason);
      assert.equal(row.outcome.outputDisposition.published, true);
      const first = Math.ceil(tuple.range.startUs * tuple.rate / 1000000), end = Math.ceil(tuple.range.endUs * tuple.rate / 1000000);
      const selected = end - first, discard = Math.ceil(selected / 1024) * 1024 - selected;
      const audio = row.evidence.decodedEvidence.audio[0];
      assert.deepEqual([audio.sourceSampleCount, audio.outputSampleCount, audio.encoderDelaySamples, audio.discardPaddingSamples],
        [selected, selected, 1024, discard]);
      assert.equal(row.evidence.explicitAacClock.pcmBytes, selected * tuple.channels * 2);
      assert.equal(row.evidence.decodedEvidence.containerClock.representation, EXPLICIT_AAC_DISCARD_CLOCK);
      assert.equal(row.telemetry.valid, true);
      row.output = { file: entry.destination, ...await hashFile(entry.destination) };
      const sourceAudio = await audioBytes(session, source);
      const outputAudio = await audioBytes(session, row.output.file);
      const width = tuple.channels * 2;
      assert.equal(sourceAudio.length, 3 * tuple.rate * width);
      assert.equal(outputAudio.length, selected * width);
      row.signal = lossySignal(sourceAudio.subarray(first * width, end * width), outputAudio, tuple.channels, tuple.rate);
      assert.ok(row.signal.valid && row.signal.channels.every(channel => channel.lagSamples === 0));
      assert.deepEqual(await hashFile(source), sourcePin);
      assert.deepEqual(await io.readdir(output), [path.basename(entry.destination)]);
    }
    assert.equal(report.acceptedStarts, prospective ? 2 : HOLDOUTS.length);
    report.status = prospective ? 'passed-precision-aac-prospective' : 'passed-precision-aac-default';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    try {
      if (service) {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      }
    } catch (error) {
      report.status = 'failed-retained';
      report.serviceClosureFailure = fault(error);
    } finally { await session.close(); }
  }
  return report;
}

if (require.main === module) {
  const [mode] = process.argv.slice(2);
  assert(process.argv.length === 3 && ['--prospective', '--normal'].includes(mode));
  run(mode === '--prospective').then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, starts: report.acceptedStarts, closed: report.childrenClosed,
      report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
    if (!report.status.startsWith('passed')) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
