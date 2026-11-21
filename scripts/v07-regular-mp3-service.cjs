'use strict';

// The prospective path exercises the real service under a single proof-only
// row. Normal mode exercises the actual reviewed default policy.
const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { COPY_NOTICE } = require('../src/remux-mp3-copy.cjs');
const { createOwnedSession, hashFile, fault } = require('./v07-remux-long-fixtures.cjs');
const { makeLayer3 } = require('./fixtures/q2j-layer3.cjs');

const MiB = 1024 ** 2;
const LIMITS = Object.freeze({ totalMs: 6 * 60000, childMs: 60000, maxChildren: 65, maxStarts: 6,
  minimumDFreeBytes: 25 * 1024 ** 3, marginBytes: 128 * MiB, forecastBytes: 64 * MiB, reportBytes: 8 * MiB });
const positives = [
  ['stereo-48-cbr', { rate: 48000, channels: 2 }],
  ['mono-441-vbr', { rate: 44100, channels: 1, variable: true }],
  ['stereo-32-vbr', { rate: 32000, channels: 2, variable: true }],
];

const labControls = {
  remuxPolicyIdentity: 'q2j-windows-mp3-service-proof',
  remuxPolicies: [{ id: 'q2j-mp3-copy-service-lab-v1', inputFamily: 'mp3', target: 'mp4', allowAncillary: false,
    runtimeIdentity: REGULAR_WINDOWS_PAIR, sourceEnvelope: 'mpeg1-layer3-untagged-v1',
    verificationMethod: 'complete-native-v1', evidenceIds: ['q2j-mp3-current-pair-service-prospective'] }],
};

async function proof(mode) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'mp3-service' });
  const { report, io } = session;
  report.mode = mode;
  report.enginePair = REGULAR_WINDOWS_PAIR;
  let service, cancelActive = false;
  try {
    await session.open();
    const runtime = session.runtime;
    const stateDir = path.join(session.owned, 'state');
    await io.mkdir(stateDir);
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(mode === '--lab' ? labControls : {}) });
    const invoke = controls.operationRuntime.invoke.bind(controls.operationRuntime);
    controls.operationRuntime.invoke = (token, tool, args, options) => session.run(runtime[tool], args, {
      ...options,
      onChild(child) {
        options.onChild?.(child);
        if (cancelActive && tool === 'ffprobe' && args.includes('-show_packets')) {
          assert.equal(child.exitCode, null);
          report.cancelWitness = { live: true, childPid: child.pid, invocation: report.invocations.at(-1).ordinal };
          cancelActive = false;
          void service.cancelCurrent();
        }
      },
    }, (_file, av, opts) => invoke(token, tool, av, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, runtimeIdentity: REGULAR_WINDOWS_PAIR,
      stateDir, run: session.run, inspectionWorkers: 1, ...controls });
    await service.initializeDiagnostics();
    session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });
    async function prepare(label, bytes) {
      const input = path.join(session.owned, label + '-source'), output = path.join(session.owned, label + '-out');
      await io.mkdir(input);
      await io.mkdir(output);
      const file = path.join(input, label + '.mp3');
      await io.writeFile(file, bytes, { flag: 'wx' });
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      const snapshot = await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'mp4' });
      assert.equal(snapshot.phase, 'ready', snapshot.error);
      assert.equal(snapshot.items.length, 1);
      const ready = snapshot.items[0];
      const entry = service.plan.entries.get(ready.id);
      const result = { label, input, output, file, item: ready, planId: snapshot.planId, expectedFile: path.join(output, ready.outputName) };
      report.cases.push(result);
      await session.save();
      return { result, entry };
    }
    async function start(test) {
      const { result } = test;
      assert.equal(result.item.status, 'ready', result.item.reason);
      assert.equal(result.item.remux.notice, COPY_NOTICE);
      assert(report.acceptedStarts < LIMITS.maxStarts);
      service.startBatch({ planId: result.planId, fileIds: [result.item.id] });
      report.acceptedStarts++;
      await service.taskPromise;
      result.result = service.snapshot().items[0];
      result.evidence = test.entry.operationEvidence;
      result.outputNames = await io.readdir(result.output);
      await session.save();
      return result.result;
    }

    for (const [name, config] of positives) {
      const test = await prepare(name, makeLayer3(config));
      const result = await start(test);
      const { entry } = test, evidence = entry.operationEvidence;
      assert.equal(result.status, 'success', result.reason);
      assert.equal(result.outputDisposition.published, true);
      assert.equal(result.verificationMethod, 'complete-native-v1');
      assert(result.warnings.some(warning => warning.code === 'REMUX_MP3_COMPATIBILITY' && warning.message === COPY_NOTICE));
      assert.equal(evidence.status, 'completed');
      assert.equal(evidence.invocations.length, 4);
      assert.equal(evidence.essenceEvidence.mp3Copy.sampleFrames, 46080);
      const pin = await hashFile(entry.destination);
      assert.equal(pin.sha256, evidence.essenceEvidence.outputFileSha256);
      assert.deepEqual(test.result.outputNames, [path.basename(entry.destination)]);
      test.result.publishedFile = { destination: entry.destination, ...pin };
      if (name === 'stereo-48-cbr') {
        const folder = await service.registerFolder(test.result.output, 'input');
        const same = await service.registerFolder(test.result.output, 'output');
        const scan = await service.prepareRemuxBatch({ inputFolderId: folder.id, outputFolderId: same.id, target: 'mp4' });
        assert.equal(scan.items.length, 1);
        assert.equal(scan.items[0].status, 'generated', scan.items[0].reason);
        assert.equal(service.plan.entries.size, 0);
        test.result.sameFolderRecognition = scan.items[0];
        // Recreate an interrupted bookkeeping state in a separate owned
        // namespace while preserving the real saved file and journal.
        const recoveryState = path.join(session.owned, 'recovery-state');
        await io.mkdir(recoveryState);
        const recovery = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, runtimeIdentity: REGULAR_WINDOWS_PAIR,
          stateDir: recoveryState, run: session.run,
          ...createOperationControls({ runtime, stateDir: recoveryState, families: FAMILIES, policyIdentity: POLICY_ID,
            ...(mode === '--lab' ? labControls : {}) }) });
        try {
          await recovery.initializeDiagnostics();
          await recovery.provenanceJournal.recordIntent({ outputId: entry.outputId, sourceIdentity: entry.fingerprint,
            destination: entry.destination, profileId: 'remux-mp4' });
          await recovery.recoverProvenance(session.controller.signal);
          assert.equal(recovery.snapshot().provenanceRecovery.matching, 1);
          const indexed = await recovery.provenanceJournal.lookupIdentity(await readSourceIdentity(entry.destination));
          assert.equal(indexed, null, 'Read-only recovery reports matching pending intents and grants no publication record.');
          assert.deepEqual(await hashFile(entry.destination), pin);
          test.result.provenanceRecovery = recovery.snapshot().provenanceRecovery;
        } finally {
          await recovery.closeOperationResources();
          assert.equal((await recovery.closeDiagnostics()).persisted, true);
        }
      }
    }

    const negative = await prepare('truncated', makeLayer3().subarray(0, -19));
    assert.equal(negative.result.item.reasonCode, 'MP3_FRAME_UNPROVED');
    assert.equal(negative.entry, undefined);
    assert.deepEqual(await io.readdir(negative.result.output), []);
    negative.result.noStartOrOutput = true;

    const stale = await prepare('stale', makeLayer3());
    await io.appendFile(stale.result.file, Buffer.from([0]));
    const staleResult = await start(stale);
    assert.equal(staleResult.status, 'failed');
    assert.equal(staleResult.outputDisposition?.published, undefined);
    assert.deepEqual(stale.result.outputNames, []);

    const collision = await prepare('collision', makeLayer3());
    const sentinel = Buffer.from('owned no-clobber sentinel');
    await io.writeFile(collision.result.expectedFile, sentinel, { flag: 'wx' });
    const collisionResult = await start(collision);
    assert.equal(collisionResult.status, 'skipped');
    assert.deepEqual(await io.readFile(collision.result.expectedFile), sentinel);
    assert.deepEqual(collision.result.outputNames, [path.basename(collision.result.expectedFile)]);

    const cancelled = await prepare('active-cancel', makeLayer3({ frames: 256 }));
    cancelActive = true;
    const cancelledResult = await start(cancelled);
    assert.equal(cancelledResult.status, 'cancelled');
    assert.equal(cancelledResult.outputDisposition?.published, false);
    assert.ok(report.cancelWitness?.live);
    assert(!cancelled.result.outputNames.some(name => name.endsWith('.mp4')));
    assert.equal(report.acceptedStarts, LIMITS.maxStarts);
    report.status = mode === '--lab' ? 'passed-mp3-service-lab' : 'passed-mp3-service-normal';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
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
    } finally {
      await session.close();
    }
  }
  return report;
}

if (require.main === module) {
  const [mode] = process.argv.slice(2);
  assert(process.argv.length === 3 && ['--lab', '--normal'].includes(mode));
  proof(mode).then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, acceptedStarts: report.acceptedStarts,
      childrenClosed: report.childrenClosed, report: path.join(report.directory, 'report.json'),
      failure: report.failure, closureFailures: report.closureFailures, serviceClosureFailure: report.serviceClosureFailure }));
    if (!report.status.startsWith('passed')) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
