'use strict';

// Root-scheduled preparation-only check. No original file can reach FFmpeg or
// a Start action. Existing-destination sentinels keep unrelated folder entries
// from repeating their already known color-sampling refusals.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { readSourceIdentity, sameIdentity } = require('../src/source-identity.cjs');
const { ENCODE_PRESERVATION_PRODUCER_PATHS } = require('../src/encode-preservation-producers.cjs');
const { verifySourceCatalogSeals } = require('../src/source-catalog-seals.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = stat => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => String(stat[key])).join(':');
const ordinary = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;

async function main() {
  assert.equal(process.argv[2], '--prepare-only'); assert.equal(process.argv.length, 4);
  const target = path.resolve(process.argv[3]), sourceFolder = path.dirname(target), id = randomUUID();
  assert.ok(target.startsWith(path.dirname(OWNED) + path.sep) && !target.startsWith(OWNED + path.sep));
  await assertOrdinaryPath(target); assert.equal((await fs.stat(target)).size, 3881156343);
  const names = (await fs.readdir(sourceFolder, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(mp4|mkv|mov|avi|webm)$/i.test(entry.name)).map(entry => entry.name).sort();
  assert.equal(names.length, 4); assert.ok(names.includes(path.basename(target)));
  const sources = names.map(name => path.join(sourceFolder, name));
  const directory = path.join(ROOT, 'artifacts/v0.7/o-acceptance-2026-10-23/known-source', id);
  const owned = path.join(OWNED, 'staging/o07-known-source-' + id), output = path.join(owned, 'output'), stateDir = path.join(owned, 'state');
  const report = { schema: 1, id, purpose: 'Known-source normal preparation, explicit loss, Ready cancellation and stale Start refusal only',
    startedAt: new Date().toISOString(), target, owned, status: 'running',
    limits: { sourceInspectionChildren: 14, totalChildren: 120, totalMs: 10 * 60000, forecastBytes: 512 * 1024 ** 2, workflowStarts: 0, personalEncodes: 0 },
    invocations: [], sourceInspectionChildren: 0, maximumConcurrentChildren: 0,
    limitations: ['No original encode, full hash, publication, personal media write, native UI or long-source output acceptance.',
      'Three explicit inert owned existing-output sentinels skip unrelated files before color sampling; this is instrumented fixture setup around an unmodified production folder preparation.',
      'Source completion compares complete bounded identities, not every original byte.'] };
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock'), leaseBytes = Buffer.from(JSON.stringify({ token: id, pid: process.pid, purpose: report.purpose }));
  const children = new Set(), controller = new AbortController();
  let runtime, service, lease, leaseIdentity, handle, pending = false;
  const save = async () => { if (!handle) return; const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 8 * 1024 ** 2);
    const held = await handle.stat({ bigint: true }), named = await fs.lstat(path.join(directory, 'report.json'), { bigint: true }); assert.ok(ordinary(held) && ordinary(named) && held.dev === named.dev && held.ino === named.ino);
    let position = 0; while (position < bytes.length) { const value = await handle.write(bytes, position, bytes.length - position, position); assert.ok(value.bytesWritten > 0); position += value.bytesWritten; }
    await handle.truncate(bytes.length); await handle.sync(); };
  const guardLease = async () => { const held = await lease.stat({ bigint: true }), named = await fs.lstat(leasePath, { bigint: true });
    assert.ok(ordinary(held) && ordinary(named)); assert.equal(stamp(held), stamp(leaseIdentity)); assert.equal(stamp(named), stamp(leaseIdentity)); assert.ok((await fs.readFile(leasePath)).equals(leaseBytes)); };
  const resources = async () => { const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const value = { at: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize };
    assert.ok(value.DFreeBytes >= 25 * 1024 ** 3 && value.FFreeBytes >= report.limits.forecastBytes + 512 * 1024 ** 2); return value; };
  const timer = setTimeout(() => { controller.abort(); void service?.cancelCurrent(); }, report.limits.totalMs); timer.unref();
  async function run(executable, args, options = {}, execute = runTool) {
    assert.equal(pending, false); pending = true; let child, call;
    try {
      assert.equal(children.size, 0); assert.ok(!controller.signal.aborted && report.invocations.length < report.limits.totalChildren);
      await guardLease(); await resources(); assert.ok(verifySourceCatalogSeals(report.producers, ROOT));
      for (const folder of [sourceFolder, owned, output, stateDir, directory]) await assertOrdinaryPath(folder, 'directory');
      const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
      if (executable === helper) { assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']); assert.equal(args.length, 5);
        assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' }); assert.ok(args[4].includes('[System.IO.DriveInfo]::new')); }
      else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(executable));
      assert.ok(!args.includes('-y'));
      const inputs = args.flatMap((value, index) => value === '-i' ? [args[index + 1]] : []);
      if (executable === runtime.ffprobe && path.isAbsolute(args.at(-1))) inputs.push(args.at(-1));
      const originals = inputs.filter(file => sources.includes(file));
      const original = originals.length > 0;
      if (original) {
        assert.equal(executable, runtime.ffprobe, 'No original may reach FFmpeg.');
        assert.equal(new Set(originals).size, 1);
        if (originals[0] !== target) assert.equal(args.includes('-show_frames'), false, 'Do not repeat unrelated ambiguous-color sampling.');
        assert.ok(++report.sourceInspectionChildren <= report.limits.sourceInspectionChildren);
      }
      for (const input of inputs) {
        assert.ok(sources.includes(input) || input.startsWith(owned + path.sep) || /^(testsrc2=|color=)/.test(input));
        if (sources.includes(input)) { await assertOrdinaryPath(input); assert.ok(ordinary(await fs.lstat(input, { bigint: true }))); }
      }
      if (executable === runtime.ffmpeg) assert.ok(args.every(value => !sources.includes(value)), 'No original may appear anywhere in an FFmpeg invocation.');
      if (executable === runtime.ffmpeg && path.isAbsolute(args.at(-1))) assert.ok(args.at(-1).startsWith(owned + path.sep));
      call = { executable, args: [...args], original, phase: service?.snapshot().phase, status: 'running', startedAt: new Date().toISOString() };
      report.invocations.push(call); await save();
      const result = await execute(executable, args, { ...options, signal: options.signal || controller.signal, onChild(value) {
        assert.equal(children.size, 0); child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size);
        value.once('close', (code, signal) => { call.closed = { code, signal }; children.delete(value); }); options.onChild?.(value);
      } });
      Object.assign(call, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture, stdout: result.stdout }); return result;
    } catch (error) { if (call) Object.assign(call, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr }); throw error; }
    finally { if (child) assert.ok(call.closed); if (call) call.finishedAt = new Date().toISOString(); await save(); pending = false; }
  }
  try {
    await assertOrdinaryPath(OWNED, 'directory'); await assertOrdinaryPath(path.dirname(owned), 'directory');
    await assertOrdinaryPath(path.dirname(path.dirname(directory)), 'directory');
    await fs.mkdir(path.dirname(directory), { recursive: true }); await assertOrdinaryPath(path.dirname(directory), 'directory'); await fs.mkdir(directory);
    handle = await fs.open(path.join(directory, 'report.json'), 'wx+'); await fs.writeFile(path.join(directory, 'executed-harness.cjs'), await fs.readFile(__filename), { flag: 'wx' });
    report.harnessSha256 = sha(await fs.readFile(__filename)); report.resourcesBefore = await resources(); await save();
    lease = await fs.open(leasePath, 'wx+'); const empty = await lease.stat({ bigint: true }); assert.ok(ordinary(empty) && empty.size === 0n);
    assert.equal(stamp(empty), stamp(await fs.lstat(leasePath, { bigint: true })));
    await lease.writeFile(leaseBytes); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true }); await guardLease();
    await fs.mkdir(owned); await fs.mkdir(output); await fs.mkdir(stateDir);
    report.producers = Object.fromEntries(await Promise.all(ENCODE_PRESERVATION_PRODUCER_PATHS.map(async file => [file, sha(await fs.readFile(path.join(ROOT, file)))])));
    report.catalogAtEntrySha256 = sha(await fs.readFile(path.join(ROOT, 'src/encode-preservation-catalog.cjs')));
    runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified;
    report.runtimeIdentity = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    report.sourcesBefore = await Promise.all(sources.map(async file => { await assertOrdinaryPath(file); assert.ok(ordinary(await fs.lstat(file, { bigint: true }))); return { file, identity: await readSourceIdentity(file) }; }));
    report.sentinels = [];
    for (const file of sources.filter(file => file !== target)) {
      const destination = path.join(output, path.parse(file).name + '_H265-CPU.mkv'), bytes = Buffer.from('Inert owned existing-destination sentinel; not media.');
      await fs.writeFile(destination, bytes, { flag: 'wx' }); report.sentinels.push({ file: destination, bytes: bytes.length, sha256: sha(bytes) });
    }
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID });
    const observer = controls.operationRuntime, invoke = observer.invoke.bind(observer);
    observer.invoke = (token, tool, args, options) => run(runtime[tool], args, options, (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, runtimeIdentity: report.runtimeIdentity, run, inspectionWorkers: 1, ...controls });
    const a = await service.registerFolder(sourceFolder, 'input'), b = await service.registerFolder(output, 'output');
    await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
    let s = service.snapshot(), item = s.items.find(value => value.name === path.basename(target)); report.initial = s;
    assert.equal(s.items.length, 4); assert.ok(s.items.filter(value => value.id !== item.id).every(value => value.status === 'skipped'));
    assert.equal(item.reasonCode, 'ENCODE_PRESERVATION_DECISION_REQUIRED', item.reason);
    await service.setEncodePreservationDecisions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision,
      decisionIds: [item.encodePreservation.omissionCandidates[0].id] });
    s = service.snapshot(); item = s.items.find(value => value.name === path.basename(target)); report.prepared = s;
    assert.equal(item.status, 'ready', item.reason); assert.equal(s.items.filter(value => value.status === 'ready').length, 1);
    report.preparedProbe = service.plan.entries.get(item.id).inspection.probe;
    report.details = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); assert.equal(report.details.operation.validationMode, 'full-preservation-selection');
    await service.cancelCurrent(); report.cancelled = service.snapshot(); assert.equal(service.plan, null); assert.equal(report.cancelled.phase, 'cancelled');
    const callsBeforeStaleStart = report.invocations.length;
    assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [item.id] }), { code: 'STALE_PLAN' }); assert.equal(report.invocations.length, callsBeforeStaleStart);
    report.sourcesAfter = await Promise.all(sources.map(async file => ({ file, identity: await readSourceIdentity(file) })));
    report.sourcesBefore.forEach((value, index) => assert.ok(sameIdentity(value.identity, report.sourcesAfter[index].identity)));
    for (const sentinel of report.sentinels) assert.equal(sha(await fs.readFile(sentinel.file)), sentinel.sha256);
    assert.equal((await fs.readdir(output)).length, 3); report.resourcesAfter = await resources(); report.status = 'passed-normal-known-source-prepare-decision-ready-revocation';
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    clearTimeout(timer); report.closureFailures = [];
    const attempt = async (label, fn) => { try { await fn(); } catch (error) { report.closureFailures.push({ label, code: error.code, message: error.message }); process.exitCode = 1; report.status = 'failed-retained'; } };
    if (service) { await attempt('cancel', () => service.cancelCurrent()); await attempt('resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => { report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed'); assert.equal(report.diagnosticClosure.persisted, true); }); }
    report.liveChildren = children.size; await attempt('children', async () => assert.equal(children.size, 0));
    if (lease && !children.size) await attempt('lease', async () => { await guardLease(); await lease.close();
      const named = await fs.lstat(leasePath, { bigint: true }); assert.ok(ordinary(named)); assert.equal(stamp(named), stamp(leaseIdentity)); assert.ok((await fs.readFile(leasePath)).equals(leaseBytes));
      await fs.unlink(leasePath); report.leaseReleased = true; });
    if (report.producers) await attempt('source-seals', async () => assert.ok(verifySourceCatalogSeals(report.producers, ROOT)));
    report.finishedAt = new Date().toISOString(); await save(); await handle?.close(); console.log(JSON.stringify({ status: report.status, directory, failure: report.failure }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
