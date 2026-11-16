'use strict';
// Real shared EncoderService proof, using only a retained synthetic fixture copy.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createTrimCandidateService, REPORT, REPORT_SHA } = require('./workbench-trim-candidate.cjs');
const { PINS, createCandidateRunner } = require('./runtime-candidate.cjs');
const { SETTINGS, SPECS } = require('./workbench-flac-calibration.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function smoke() {
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', 'trim-service-candidate-'));
  const input = path.join(root, 'input'), stateDir = path.join(root, 'state');
  await fs.mkdir(input); await fs.mkdir(stateDir);
  const report = { root, status: 'preparing', cases: [], appRuntimeChanged: false,
    scope: 'Only the three calibrated synthetic 720p30 precision-FLAC requests; not general trim or resize.',
    census: { spawned: 0, closed: 0, live: 0, maximum: 0, encodes: 0 } };
  let service, cancellation, cancelNext = false;
  const onChild = child => {
    const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    child.once('close', () => { c.closed++; c.live--; });
    if (child.spawnargs.includes('-progress') && /[/\\]\.ffmpeg-encoder-[^/\\]+[/\\]encoded\.mkv$/.test(child.spawnargs.at(-1))) {
      c.encodes++;
    }
  };
  const run = createCandidateRunner({ onChild });
  const source = path.join(input, 'calibrated-synthetic.mov');
  try {
    const retainedBytes = await fs.readFile(REPORT); assert.equal(sha(retainedBytes), REPORT_SHA);
    const retained = JSON.parse(retainedBytes);
    const original = path.join(path.dirname(REPORT), 'synthetic-720p30.mov');
    const bytes = await fs.readFile(original); assert.equal(sha(bytes), retained.source.sha256);
    await fs.writeFile(source, bytes, { flag: 'wx' }); report.sourceHash = sha(bytes);
    service = await createTrimCandidateService({ stateDir, source, onChild });
    service.on('update', snapshot => {
      const progress = snapshot.progress;
      if (cancelNext && report.census.live === 1 && progress?.stage === 'encoding'
          && progress.frame > 0 && progress.ended === false) {
        cancelNext = false; report.cancellationProgress = structuredClone(progress);
        cancellation = service.cancelCurrent();
      }
    });
    await service.initializeDiagnostics();
    const capabilities = await service.getCapabilities(); report.capabilities = capabilities;
    const folder = await service.registerFolder(input, 'input');
    async function prepare(name, range = SPECS[1].range) {
      const output = path.join(root, name); await fs.mkdir(output);
      const target = await service.registerFolder(output, 'output');
      let plan = await service.prepareBatch({ inputFolderId: folder.id, outputFolderId: target.id, settings: SETTINGS });
      plan = await service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id,
        revision: plan.operationDraft.revision, fileIds: [plan.items[0].id],
        overrides: { range, resolution: 'source', audioPolicy: 'precision-flac' } });
      assert.equal(plan.phase, 'ready', JSON.stringify(plan));
      return { plan, output, destination: path.join(output, plan.items[0].outputName) };
    }
    async function start(plan) {
      assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0]));
      service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
      await service.taskPromise;
      if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(report.census.live, 0);
      return service.snapshot().items[0];
    }
    async function publish(spec, label = spec.label) {
      const prepared = await prepare(label, spec.range), item = await start(prepared.plan);
      assert.equal(item.status, 'success', JSON.stringify(item));
      assert.equal(item.outputDisposition.published, true); assert.equal(item.sourceAssessment.kind, 'unchanged');
      const entry = service.plan.entries.get(item.id), evidence = entry.operationEvidence;
      assert.equal(evidence.status, 'completed'); assert.equal(evidence.completeSource.video.frames, 120);
      assert.equal(Number(evidence.completeSource.audio[0].sampleCount), 192000);
      const index = SPECS.indexOf(spec), selectedFrames = [15, 62, 60][index], selectedSamples = [24000, 99552, 96000][index];
      assert.equal(evidence.decodedEvidence.video.sourceFrameCount, selectedFrames);
      assert.equal(evidence.decodedEvidence.video.outputFrameCount, selectedFrames);
      assert.equal(evidence.decodedEvidence.audio[0].sourceSampleCount, selectedSamples);
      assert.equal(evidence.decodedEvidence.audio[0].outputSampleCount, selectedSamples);
      assert.equal(entry.telemetryValidation.valid, true);
      assert.equal(evidence.decodedEvidence.audio[0].pcmIdentity.sourceHash, evidence.decodedEvidence.audio[0].pcmIdentity.outputHash);
      const probe = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', prepared.destination], { timeoutMs: 30000 })).stdout);
      assert.equal(classifyMarker(probe).kind, 'generated');
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', prepared.destination, '-map', '0', '-f', 'null', '-'], { timeoutMs: 120000 });
      report.cases.push({ case: label, status: 'passed', item, evidenceDirectory: evidence.directory,
        sourceFrames: 120, sourceSamples: 192000, selectedFrames, selectedSamples,
        telemetry: entry.telemetryValidation, pcmIdentity: evidence.decodedEvidence.audio[0].pcmIdentity });
    }
    for (const spec of SPECS.slice(0, 2)) await publish(spec);
    const cancelled = await prepare('cancelled'); cancelNext = true;
    const beforeCancel = report.census.encodes, cancelledItem = await start(cancelled.plan);
    assert.ok(report.cancellationProgress, 'Cancellation is inconclusive without nonterminal encoded-frame progress from a live child.');
    assert.equal(report.census.encodes, beforeCancel + 1); assert.equal(cancelledItem.status, 'cancelled');
    await assert.rejects(fs.stat(cancelled.destination), { code: 'ENOENT' });
    // Shared cleanup intentionally retains an unsealed partial file: it cannot
    // safely adopt/delete an object never identity-bound after successful close.
    assert.equal(cancelledItem.cleanup.retained, true);
    assert.match(cancelledItem.cleanup.reason, /incomplete output was never identity-bound/);
    const retainedNames = await fs.readdir(cancelled.output);
    assert.equal(retainedNames.length, 1); assert.match(retainedNames[0], /^\.ffmpeg-encoder-/);
    report.cases.push({ case: 'real-child-cancelled-no-publication', status: 'passed', item: cancelledItem });
    await publish(SPECS[2], 'fresh-open-end-after-cancel');

    const collision = await prepare('collision');
    await fs.writeFile(collision.destination, 'synthetic existing output', { flag: 'wx' });
    const beforeCollision = report.census.encodes, collisionItem = await start(collision.plan);
    assert.equal(collisionItem.status, 'skipped'); assert.equal(report.census.encodes, beforeCollision);
    assert.equal(await fs.readFile(collision.destination, 'utf8'), 'synthetic existing output');
    report.cases.push({ case: 'existing-output-preserved', status: 'passed', item: collisionItem });

    const outside = await prepare('unmeasured-request', { startUs: 1000000, endUs: 3000000 });
    assert.equal(outside.plan.items[0].status, 'unsupported');
    assert.equal(outside.plan.items[0].reasonCode, 'LINUX_TRIM_CANDIDATE_SCOPE');
    assert.throws(() => service.startBatch({ planId: outside.plan.planId, fileIds: [outside.plan.items[0].id] }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
    report.cases.push({ case: 'unmeasured-request-refused', status: 'passed' });
    assert.equal(sha(await fs.readFile(source)), report.sourceHash); assert.equal(sha(await fs.readFile(original)), report.sourceHash);
    report.status = 'passed-developer-service-proof';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1;
    if (service) report.failedSnapshot = service.snapshot();
  } finally {
    service?.closeAdmission();
    try { await service?.cancelCurrent(); await service?.closeOperationResources();
      if (service) assert.equal((await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed')).persisted, true);
    } catch (error) { report.closureFailure = { code: error.code, message: error.message }; process.exitCode = 1; }
    if (report.census.live !== 0 || report.census.spawned !== report.census.closed || report.census.maximum !== 1) {
      report.closureFailure ||= { message: 'Unbalanced or overlapping children' }; process.exitCode = 1;
    }
    if (report.closureFailure) report.status = 'failed-retained';
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, cases: report.cases.map(row => ({ case: row.case, status: row.status })),
    census: report.census, failure: report.failure, closureFailure: report.closureFailure }, null, 2));
  return report;
}
if (require.main === module) smoke().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { smoke };
