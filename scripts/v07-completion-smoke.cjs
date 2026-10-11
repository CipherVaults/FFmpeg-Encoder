'use strict';

// Real completion disposition checks use only generated, owned tiny fixtures.
// Mutations model filesystem changes at a deterministic validation boundary;
// none of the supplied originals or benchmark recordings is opened here.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { validateOutput } = require('../src/inspection.cjs');
const { runTool } = require('../src/process-runner.cjs');

const root = path.resolve(__dirname, '..');
const owned = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const reportRoot = path.join(root, 'artifacts/v0.7/completion');
const id = randomUUID();
const directory = path.join(owned, 'outputs', 'completion-' + id);
const ffmpeg = path.join(root, 'ffmpeg/ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg/ffprobe.exe');
const lease = path.join(root, 'artifacts/v0.7/media-job.lock');
const report = { schema: 1, id, startedAt: new Date().toISOString(), status: 'running', directory, cases: [], invocations: [],
  scope: 'Real owned SDR encodes/output validation; deterministic source mutation/cancel injections; no personal media or benchmark.' };
let leaseHandle;
const save = async () => fs.writeFile(path.join(reportRoot, id + '.json'), JSON.stringify(report, null, 2));
async function run(executable, args, options) {
  const evidence = { executable, args, startedAt: new Date().toISOString() }; report.invocations.push(evidence);
  try { const result = await runTool(executable, args, options); evidence.status = 'passed'; return result; }
  catch (error) { evidence.status = 'failed'; evidence.code = error.code; evidence.stderr = error.stderr; throw error; }
  finally { evidence.finishedAt = new Date().toISOString(); }
}
async function one(mode, caps) {
  const input = path.join(directory, mode, 'input'), output = path.join(directory, mode, 'output');
  await fs.mkdir(input, { recursive: true }); await fs.mkdir(output);
  const source = path.join(input, 'owned-sdr.mkv');
  await fs.copyFile(path.join(directory, 'fixture.mkv'), source, require('node:fs').constants.COPYFILE_EXCL);
  const fixedTime = 1700000000; await fs.utimes(source, fixedTime, fixedTime);
  let service;
  let mutated = false;
  service = new EncoderService({ ffmpeg, ffprobe, stateDir: path.join(directory, mode, 'state'), run,
    capabilities: async () => structuredClone(caps), inspectionCache: null,
    verify: validateOutput });
  // The production verifier is synchronous. Inject the controlled filesystem
  // action at the next source-assessment boundary, after real output validation.
  const assess = service.assessCompletedSource.bind(service);
  service.assessCompletedSource = async function (entry, signal) {
    assert.equal(mutated, false); mutated = true;
    if (mode === 'ctime-only') await fs.utimes(source, fixedTime, fixedTime);
    if (mode === 'size-change') await fs.appendFile(source, Buffer.from('owned post-validation mutation'));
    if (mode === 'cancel-complete') this.controller.abort();
    return assess(entry, signal);
  };
  const item = { mode, source, output }; report.cases.push(item); await save();
  try {
    const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
    const prepared = await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id,
      settings: { profileId: 'h265-cpu', preset: 'veryfast', quality: 25 } });
    assert.equal(prepared.phase, 'ready', JSON.stringify(prepared));
    assert.equal(prepared.items[0].status, 'ready', JSON.stringify(prepared.items));
    service.startBatch({ planId: prepared.planId, fileIds: [prepared.items[0].id] });
    await service.taskPromise;
    item.result = service.snapshot();
    const result = item.result.items[0];
    assert.equal(mutated, true);
    if (mode === 'ctime-only') {
      assert.equal(result.status, 'success', JSON.stringify(result));
      assert.equal(result.outcome, 'saved-with-warning');
      assert.deepEqual(result.sourceAssessment.diagnostic.changedFields, ['ctimeNs']);
      assert.equal(result.warnings[0].code, 'SOURCE_CTIME_ONLY');
      await fs.access(result.outputDisposition.file);
    } else {
      assert.equal(result.status, mode === 'size-change' ? 'failed' : 'cancelled');
      assert.equal(result.outputDisposition.kind, 'retained-completed', JSON.stringify(result));
      assert.equal(result.outputDisposition.validationCurrent, true);
      assert.equal(result.outputDisposition.published, false);
      await fs.access(result.outputDisposition.file);
      assert.equal((await fs.readdir(output)).filter(name => !name.startsWith('.')).length, 0);
    }
    // Probe validation alone is not complete decode proof. Decode each saved or
    // retained result strictly; all three media files must remain usable.
    await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe',
      '-i', result.outputDisposition.file, '-map', '0:v:0', '-f', 'null', '-'], { timeoutMs: 30000 });
    const history = await service.getDiagnosticHistory({ limit: 200 });
    item.events = history.events;
    assert.ok(history.events.some(event => event.reason === 'BATCH_FINISHED'));
    if (mode === 'ctime-only') assert.ok(history.events.some(event => event.reason === 'SOURCE_ASSESSED'));
    item.status = 'passed';
  } finally { await service.closeDiagnostics(); await save(); }
}
async function main() {
  assert.ok(process.argv.includes('--parent-granted-media-slot'), 'Parent must grant the media slot.');
  await fs.mkdir(reportRoot, { recursive: true });
  leaseHandle = await fs.open(lease, 'wx');
  await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: id, pid: process.pid, purpose: 'v07-completion', startedAt: report.startedAt }));
  await fs.mkdir(directory, { recursive: false });
  try {
    const baseline = JSON.parse(await fs.readFile(path.join(root, 'artifacts/v0.7/native-foundation/c66a632e-e312-48d5-864e-39a83125192f/report.json'), 'utf8'));
    const caps = baseline.cases[0].capabilities;
    // Define frame color before encoder negotiation, as in the production
    // capability fixture; command-level tags alone are not evidence of signal.
    await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
      'testsrc2=size=320x180:rate=30:duration=2,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v', 'ffv1', '-level', '3', '-pix_fmt', '+yuv420p', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-f', 'matroska', path.join(directory, 'fixture.mkv')], { timeoutMs: 30000 });
    for (const mode of ['ctime-only', 'size-change', 'cancel-complete']) await one(mode, caps);
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); await save();
    await leaseHandle.close();
    const current = JSON.parse(await fs.readFile(lease, 'utf8'));
    assert.equal(current.token, id); assert.equal(current.pid, process.pid); await fs.unlink(lease);
    console.log(JSON.stringify({ status: report.status, report: path.join(reportRoot, id + '.json'), failure: report.failure?.message }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
