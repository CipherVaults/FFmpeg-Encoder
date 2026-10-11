'use strict';

// Parent-run runtime qualification only. This deliberately uses current main
// production capability/inspection/building code with a separate pinned pair.
// It never encodes supplied media, replaces the bundled runtime or touches the
// paused benchmark. --parent-granted-media-slot is required before any I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { checkCapabilities } = require('../src/capabilities.cjs');
const { inspectInput } = require('../src/inspection.cjs');
const { PROFILES, ARCHIVE_RECIPE, buildEncodeArgs } = require('../src/media.cjs');
const { readSourceIdentity, sameIdentity } = require('../src/source-identity.cjs');
const { runTool } = require('../src/process-runner.cjs');

const root = path.resolve(__dirname, '..');
const owned = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const supplied = 'F:\\FFmpeg Encoder Project supplied videos\\Videos our FFmpeg Encoder have Issues with';
const sources = ['107_new.mp4', '108_new.mp4', '109_new.mp4', 'Freelanzwya Sep 26th Live Workshop.mp4'].map(name => path.join(supplied, name));
const bin = path.join(owned, 'staging/runtime-trials/ffmpeg-9.0.2/ffmpeg-9.0.2-full_build/bin');
const binaries = { ffmpeg: path.join(bin, 'ffmpeg.exe'), ffprobe: path.join(bin, 'ffprobe.exe') };
const evidenceRoot = path.join(root, 'artifacts/v0.7');
const leasePath = path.join(evidenceRoot, 'media-job.lock');
const baselinePath = path.join(evidenceRoot, 'baseline/reproduction-8d90699c-b078-43b3-9a1d-ed9ac9aae313.json');
const baselineExpandedPath = path.join(evidenceRoot, 'baseline/expanded-native-inspection.json');
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const controller = new AbortController();
const report = { schema: 1, id: randomUUID(), startedAt: new Date().toISOString(), status: 'running',
  scope: 'FFmpeg/ffprobe 9.0.2 current production capability checks and four supplied-file inspections/plans only.',
  expectedRuntime: '9.0.2', expectedCapabilityCells: 14, invocations: [], cases: [], runtime: {}, maxConcurrentChildren: 0,
  limitations: [
    'Capability encodes/decode checks use only production-created short synthetic files in a unique owned F: staging directory.',
    'Supplied sources are inspected with production bounded ffprobe metadata/frame sampling; prepared argv is recorded, never executed.',
    'Bounded source identity equality is not a full-file content proof. No personal-media encode, remux, full hash or benchmark run occurs.',
    'Changed refusal outcomes are reported for review, not forced to match historical policy or declared fixed without further evidence.',
    'This is functional runtime qualification, not application UI, packaged, perceptual-quality or external-hardware acceptance.',
    'Observed binary hashes pin this trial; official archive/provisioning provenance must separately be reconciled by the parent.',
  ] };
let leaseHandle, leaseIdentity, reportHandle, reportDirectory, staging, outputs, phase = 'initialization';
const liveChildren = new Set();

function inside(parent, file) {
  const relative = path.relative(parent, file);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
const sameObject = (a, b) => a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameStamp = (a, b) => sameObject(a, b) && ['size', 'mtimeNs', 'ctimeNs', 'nlink'].every(key => a[key] === b[key]);
const stamp = value => Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'nlink'].map(key => [key, String(value[key])]));
const failure = error => ({ code: error.code || 'HARNESS_FAILED', message: error.message,
  ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}), ...(error.exitSignal ? { exitSignal: error.exitSignal } : {}),
  ...(error.stderr !== undefined ? { stderr: error.stderr } : {}), ...(error.stderrCapture ? { stderrCapture: error.stderrCapture } : {}) });

async function save() {
  if (!reportHandle) return;
  const json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json) > MAX_REPORT_BYTES) throw new Error('Bounded runtime report limit exceeded; no more tools may run.');
  try {
    const bytes = Buffer.from(json);
    await reportHandle.truncate(0);
    let position = 0;
    while (position < bytes.length) {
      const { bytesWritten } = await reportHandle.write(bytes, position, bytes.length - position, position);
      assert.ok(bytesWritten > 0, 'Complete evidence write required');
      position += bytesWritten;
    }
    await reportHandle.sync();
  } catch (error) { controller.abort(); throw error; }
}

async function ordinaryDirectory(directory) {
  const stat = await fs.lstat(directory, { bigint: true });
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev !== 0n && stat.ino !== 0n, 'Expected an ordinary owned directory.');
  return stat;
}

async function acquireLease() {
  await fs.mkdir(evidenceRoot, { recursive: true });
  await ordinaryDirectory(evidenceRoot);
  // Never infer that an existing lease is stale, and never remove a foreign one.
  leaseHandle = await fs.open(leasePath, 'wx+');
  await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid,
    purpose: 'ffmpeg-9.0.2-runtime-trial', startedAt: report.startedAt }));
  await leaseHandle.sync();
  leaseIdentity = await leaseHandle.stat({ bigint: true });
}

async function releaseLease() {
  if (!leaseHandle) return;
  try {
    if (liveChildren.size) { report.leaseRetained = 'Owned child exit is unconfirmed; the parent must reconcile before another job.'; return; }
    const named = await fs.lstat(leasePath, { bigint: true });
    const opened = await leaseHandle.stat({ bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || !leaseIdentity
      || !sameStamp(leaseIdentity, named) || !sameStamp(named, opened) || named.size > 8192n) {
      report.leaseRetained = 'Lease identity changed; no unlink was attempted.'; return;
    }
    const buffer = Buffer.alloc(Number(named.size));
    const { bytesRead } = await leaseHandle.read(buffer, 0, buffer.length, 0);
    assert.equal(bytesRead, buffer.length, 'Complete lease ownership record required');
    const data = JSON.parse(buffer.toString('utf8'));
    if (data.token !== report.id || data.pid !== process.pid || !sameStamp(named, await fs.lstat(leasePath, { bigint: true }))) {
      report.leaseRetained = 'Lease token/PID/identity no longer matches; no unlink was attempted.'; return;
    }
    await leaseHandle.close(); leaseHandle = null;
    const final = await fs.lstat(leasePath, { bigint: true });
    // Windows may finalize this writer's timestamps on close. Token/PID were
    // read through our bound handle; require the same sole ordinary object and
    // length again, rather than misclassifying our own close as a foreign lease.
    if (!final.isFile() || final.isSymbolicLink() || final.nlink !== 1n || !sameObject(named, final) || named.size !== final.size) {
      report.leaseRetained = 'Lease changed before release.'; return;
    }
    await fs.unlink(leasePath);
    report.leaseReleased = true;
  } catch (error) { report.leaseRetained = `Lease release could not be proved: ${error.message}`; }
  finally { await leaseHandle?.close().catch(() => {}); leaseHandle = null; }
}

async function hashBinary(file) {
  assert.ok(Object.values(binaries).includes(file), 'Only candidate binaries may receive a whole-file hash.');
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 512n * 1024n * 1024n, 'Candidate binary bounds/type');
  const handle = await fs.open(file, 'r');
  try {
    assert.ok(sameStamp(before, await handle.stat({ bigint: true })), 'Candidate handle binding');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      if (controller.signal.aborted) throw Object.assign(new Error('Runtime trial cancelled.'), { code: 'CANCELLED' });
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      assert.ok(bytesRead > 0, 'Complete binary read'); hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    assert.ok(sameStamp(before, await handle.stat({ bigint: true })) && sameStamp(before, await fs.lstat(file, { bigint: true })), 'Candidate binary remained bound');
    return { path: file, sha256: hash.digest('hex'), identity: stamp(before) };
  } finally { await handle.close(); }
}

async function readJson(file, limit) {
  const stat = await fs.lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, 'Bounded evidence JSON required');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function run(executable, argv, requested = {}) {
  assert.ok(Object.values(binaries).includes(executable), 'Only the fixed candidate runtime can execute.');
  assert.equal(liveChildren.size, 0, 'Only one child may run at a time.');
  assert.ok(report.invocations.length < 100, 'Bounded invocation count');
  const version = argv.length === 1 && argv[0] === '-version';
  if (phase === 'supplied-inspection') {
    assert.equal(executable, binaries.ffprobe, 'Personal files may only be inspected.');
    assert.ok(sources.includes(argv.at(-1)), 'Only the four known supplied inputs may be inspected.');
  } else if (!version) {
    assert.equal(phase, 'capabilities');
    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === '-i') {
        const input = argv[index + 1];
        assert.ok(inside(staging, input) || (argv.includes('lavfi') && input.startsWith('testsrc2=')), 'Capability input must be an owned fixture.');
      }
    }
    assert.ok(argv.at(-1) === '-' || inside(staging, argv.at(-1)), 'Capability output/probe path must be owned.');
  }
  const options = { ...requested, signal: controller.signal,
    timeoutMs: Math.min(requested.timeoutMs || 30000, 30000),
    stdoutLimit: Math.min(requested.stdoutLimit || 1024 * 1024, 16 * 1024 * 1024),
    stderrLimit: Math.min(requested.stderrLimit || 64 * 1024, 256 * 1024) };
  const invocation = { id: randomUUID(), phase, executable, argv: [...argv], startedAt: new Date().toISOString(),
    timeoutMs: options.timeoutMs, stdoutLimitBytes: options.stdoutLimit, stderrLimitBytes: options.stderrLimit };
  report.invocations.push(invocation);
  await save();
  let stdoutBytes = 0, result;
  const started = process.hrtime.bigint();
  options.onChild = child => {
    liveChildren.add(child);
    report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, liveChildren.size);
    invocation.pid = child.pid;
    child.stdout.on('data', chunk => { stdoutBytes += Buffer.byteLength(chunk); });
    child.once('close', (code, signal) => { invocation.observedExit = { code, signal }; liveChildren.delete(child); });
  };
  try {
    result = await runTool(executable, argv, options);
    Object.assign(invocation, { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, stderrCapture: result.stderrCapture });
    if (version) {
      const tool = executable === binaries.ffmpeg ? 'ffmpeg' : 'ffprobe';
      const line = result.stdout.split(/\r?\n/)[0];
      assert.match(line, new RegExp(`^${tool} version 9\\.0\\.2(?:[-\\s]|$)`), 'Both tools must be the requested 9.0.2 pair.');
      report.runtime[tool].version = line;
    }
    return result;
  } catch (error) { invocation.failure = failure(error); throw error; }
  finally {
    invocation.completedAt = new Date().toISOString();
    invocation.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    invocation.stdoutCapture = { totalBytes: stdoutBytes, retainedBytes: Buffer.byteLength(result?.stdout || ''),
      complete: Boolean(result && stdoutBytes === Buffer.byteLength(result.stdout)), limitBytes: options.stdoutLimit };
    await save();
  }
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--parent-granted-media-slot'], 'Parent permission flag required; no other paths or arguments accepted.');
  assert.deepEqual(PROFILES.map(profile => profile.id).sort(), ['h264-cpu', 'h265-cpu', 'av1-cpu', 'h264-nvidia', 'h265-nvidia', 'av1-nvidia'].sort(), 'This harness covers only the existing CPU/NVIDIA families.');
  assert.equal(ARCHIVE_RECIPE.quality, 29, 'Preserve the current Archive Quality anchor.');
  let deadline;
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    await acquireLease();
    deadline = setTimeout(() => controller.abort(), 25 * 60 * 1000);
    const reportBase = path.join(evidenceRoot, 'runtime-trials'); await fs.mkdir(reportBase, { recursive: true });
    await ordinaryDirectory(reportBase);
    reportDirectory = await fs.mkdtemp(path.join(reportBase, 'ffmpeg-9.0.2-'));
    reportHandle = await fs.open(path.join(reportDirectory, 'report.json'), 'wx');
    const stagingBase = path.join(owned, 'staging'); const outputsBase = path.join(owned, 'outputs');
    await ordinaryDirectory(owned); await ordinaryDirectory(stagingBase); await ordinaryDirectory(outputsBase);
    staging = await fs.mkdtemp(path.join(stagingBase, 'ffmpeg-9.0.2-qualification-'));
    outputs = await fs.mkdtemp(path.join(outputsBase, 'ffmpeg-9.0.2-plan-only-'));
    assert.ok(inside(owned, staging) && inside(owned, outputs));
    report.ownedPaths = { staging, plannedOutputs: outputs, reportDirectory };
    const baseline = await readJson(baselinePath, 4 * 1024 * 1024);
    assert.equal(baseline.baseline, 'be92b12205d299b6d3bdcc2fd4b2e3a02f928862');
    const oldManifest = await readJson(path.join(root, 'resources/binary-manifest.json'), 64 * 1024);
    assert.equal(oldManifest.release, '9.0.1', 'The bundled root runtime must remain the accepted 9.0.1 pair.');
    report.baseline = { reportPath: baselinePath, expandedInspectionReference: baselineExpandedPath,
      baseline: baseline.baseline, recordedAt: baseline.finishedAt, manifestRelease: oldManifest.release,
      note: 'Historical metadata/planner outcomes, not the original laptop UI/decoder error and not an expected-outcome assertion.',
      cases: baseline.cases.filter(item => sources.includes(item.source)).map(item => ({ source: item.source, name: item.name,
        preparation: item.preparation, code: item.code, boundedIdentityUnchanged: item.boundedIdentityUnchanged })) };
    assert.equal(report.baseline.cases.length, 4, 'Four corresponding accepted-baseline records required.');
    for (const [tool, file] of Object.entries(binaries)) report.runtime[tool] = await hashBinary(file);
    await save();
    phase = 'capabilities';
    report.capabilities = await checkCapabilities({ ...binaries, stateDir: staging, signal: controller.signal, run });
    report.capabilityCells = [...report.capabilities.profiles, ...report.capabilities.recipes].flatMap(profile =>
      profile.checks.map(check => ({ profileId: profile.id, ...check })));
    assert.equal(report.capabilityCells.length, 14, 'Record all fourteen CPU/NVIDIA depth/recipe checks.');
    await save();
    phase = 'supplied-inspection';
    for (const source of sources) {
      if (controller.signal.aborted) throw Object.assign(new Error('Runtime trial cancelled.'), { code: 'CANCELLED' });
      const item = { source, name: path.basename(source), before: await readSourceIdentity(source),
        settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, plannedOutput: path.join(outputs, `${path.parse(source).name}.NOT-EXECUTED.mkv`) };
      report.cases.push(item);
      try {
        item.inspection = await inspectInput(source, { ffprobe: binaries.ffprobe, signal: controller.signal, run });
        item.preparedArgv = buildEncodeArgs({ input: source, output: item.plannedOutput, settings: item.settings,
          probe: item.inspection.probe, colorEvidence: item.inspection.color });
        item.preparation = 'allowed-not-executed';
      } catch (error) { item.preparation = 'refused-or-inspection-failed'; item.failure = failure(error); }
      finally {
        try { item.after = await readSourceIdentity(source); item.boundedIdentityUnchanged = sameIdentity(item.before, item.after); }
        catch (error) { item.afterFailure = failure(error); item.boundedIdentityUnchanged = false; }
        await save();
      }
      assert.equal(item.boundedIdentityUnchanged, true, 'A supplied source identity changed or could not be reconciled.');
      console.log(JSON.stringify({ name: item.name, preparation: item.preparation, code: item.failure?.code, boundedIdentityUnchanged: true }));
    }
    phase = 'runtime-reconciliation';
    for (const [tool, file] of Object.entries(binaries)) {
      report.runtime[tool].after = await hashBinary(file);
      assert.equal(report.runtime[tool].sha256, report.runtime[tool].after.sha256, 'Runtime binaries remained unchanged throughout qualification.');
    }
    assert.deepEqual(await fs.readdir(outputs), [], 'No personal-media output was executed.');
    assert.deepEqual(await fs.readdir(staging), [], 'Production capability cleanup should remove its own temporary files.');
    assert.equal(report.maxConcurrentChildren, 1);
    report.status = report.capabilityCells.every(cell => cell.available) ? 'completed' : 'completed-with-capability-gaps';
  } catch (error) {
    report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = failure(error); process.exitCode = 1;
  } finally {
    clearTimeout(deadline); process.off('SIGINT', stop); process.off('SIGTERM', stop);
    report.finishedAt = new Date().toISOString();
    try { await save(); } finally {
      await releaseLease();
      try { await save(); } finally { await reportHandle?.close(); reportHandle = null; }
    }
    console.log(`Runtime trial report: ${reportDirectory ? path.join(reportDirectory, 'report.json') : 'not created'}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
