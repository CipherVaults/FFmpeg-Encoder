'use strict';

// Finite Windows Q2j proof. Every child goes through the owned session. The
// lab can qualify one proposed route; normal mode uses the ordinary factory.
const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { REMUX_POLICIES } = require('../src/remux-catalog.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { createOwnedSession, generationArgs, cutTransportFixture, copyPinnedFile, hashFile, sha, fault, TS_FIXTURES, ROOT, readBoundedFile } =
  require('./v07-remux-long-fixtures.cjs');
const { requireOutcome, requireRefusal, requireChildAccounting } = require('./v07-remux-long-smoke.cjs');

const MiB = 1024 ** 2;
const LIMITS = Object.freeze({ totalMs: 9 * 60000, childMs: 90000,
  maxChildren: 50, maxStarts: 1, minimumDFreeBytes: 25 * 1024 ** 3, forecastBytes: 256 * MiB, marginBytes: 512 * MiB, reportBytes: 8 * MiB });
const TARGETS = Object.freeze(['0/1', '1/20', '39/20', '2/1', '41/20', '199/25']);
const TICKS = 90000n;
const FRAMES = 240;

function decodeRows(stdout, count) {
  assert.match(stdout, /^#tb 0: 1\/90000\r?$/m, 'The decoder output must expose the exact 90 kHz timeline.');
  assert.match(stdout, /^#hash: SHA256\r?$/m);
  const rows = stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const [stream, dts, pts, duration, size, hash, ...rest] = line.split(',').map(value => value.trim());
    assert.equal(stream, '0');
    assert.match(pts, /^-?\d+$/);
    assert.equal(dts, pts);
    assert.match(duration, /^\d+$/);
    assert.match(size, /^[1-9]\d*$/);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(rest, []);
    return { pts, sha256: hash.toLowerCase() };
  });
  assert.equal(rows.length, count);
  return rows;
}

async function decode(session, input, seek) {
  const format = path.extname(input) === '.ts' ? 'mpegts' : 'mov';
  const args = ['-hide_banner', '-nostdin', '-v', 'warning', '-xerror', '-copyts', '-noautorotate',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', format];
  if (seek !== undefined) args.push('-seek_timestamp', '0', '-ss', seek, '-accurate_seek');
  args.push('-i', input, '-map', '0:v:0', '-an', '-sn', '-dn', '-c:v', 'rawvideo',
    '-threads:v', '1', '-pix_fmt:v', '+yuv420p', '-fps_mode:v', 'passthrough', '-enc_time_base:v', 'demux');
  if (seek !== undefined) args.push('-frames:v', '1');
  args.push('-avoid_negative_ts', 'disabled', '-hash', 'sha256', '-f', 'framehash', '-format_version', '1', 'pipe:1');
  const output = await session.run(session.runtime.ffmpeg, args, { stdoutLimit: MiB, stderrLimit: 64 * 1024 });
  assert.equal(output.stderr, '');
  assert.equal(output.stderrCapture.truncated, false);
  return decodeRows(output.stdout, seek === undefined ? FRAMES : 1);
}

function decimalMicros(value) {
  assert.match(value, /^\d+\.\d{6}$/);
  return BigInt(value.replace('.', ''));
}

function cliTime(micros) {
  assert(micros >= 0n);
  const fraction = (micros % 1000000n).toString().padStart(6, '0');
  return String(micros / 1000000n) + '.' + fraction;
}

async function seekProof(session, source, output, witness) {
  witness.timeBase = '1/90000';
  witness.sourceLinear = await decode(session, source);
  witness.decodedOutputLinear = await decode(session, output);
  assert.deepEqual(witness.decodedOutputLinear, witness.sourceLinear, 'Linear decoded content and exact source PTS must agree.');
  const hashes = new Set(witness.sourceLinear.map(row => row.sha256));
  assert.equal(hashes.size, FRAMES, 'Every moving fixture frame must have a distinct decoded hash.');
  const start = BigInt(witness.sourceLinear[0].pts);
  for (const [index, row] of witness.sourceLinear.entries()) {
    assert.equal(BigInt(row.pts), start + BigInt(index) * 3000n, 'The linear oracle must cover all 240 presentation frames.');
  }
  witness.originPts = String(start);
  const probe = await session.run(session.runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file',
    '-show_entries', 'format=start_time', '-of', 'default=noprint_wrappers=1:nokey=1', output], { stdoutLimit: 4096 });
  const formatStart = decimalMicros(probe.stdout.trim());
  witness.outputFormatStartMicros = String(formatStart);
  witness.targets = [];
  for (const target of TARGETS) {
    const [num, den] = target.split('/').map(BigInt);
    assert.equal(num * TICKS % den, 0n);
    const absolute = start + num * TICKS / den;
    const expected = witness.sourceLinear.find(row => BigInt(row.pts) >= absolute);
    assert(expected, 'The linear oracle has no frame at or after the frozen target.');
    // FFmpeg input -ss uses the container start coordinate. Convert only
    // that command argument. Oracle comparison is exact in source ticks.
    const roundedMicros = (absolute * 1000000n + TICKS / 2n) / TICKS;
    assert.equal((roundedMicros * TICKS + 500000n) / 1000000n, absolute);
    const seek = cliTime(roundedMicros - formatStart);
    const [observed] = await decode(session, output, seek);
    const row = { target, targetPts: String(absolute), inputSs: seek, expected, observed };
    witness.targets.push(row);
    await session.save();
    assert.deepEqual(observed, expected, 'Accurate seek changed the first displayed frame or timestamp at ' + target);
  }
}

function labControls() {
  const source = REMUX_POLICIES.find(row => row.inputFamily === 'mpegts' && row.target === 'mp4');
  assert(source);
  return { remuxPolicyIdentity: 'q2j-regular-windows-ts-laboratory',
    remuxPolicies: [{ ...source, id: 'q2j-regular-windows-ts-lab-v1', runtimeIdentity: REGULAR_WINDOWS_PAIR,
      evidenceIds: ['q2j-regular-windows-ts-prospective-lab-only'] }] };
}

async function readLab(id, digest) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const file = path.join(ROOT, 'artifacts/v0.7/q2j-regular/smoke', id, 'report.json');
  const content = await readBoundedFile(file, LIMITS.reportBytes);
  assert.equal(sha(content), digest);
  const report = JSON.parse(content);
  assert.equal(report.status, 'passed-lab-ts-seek');
  assert.equal(report.enginePair, REGULAR_WINDOWS_PAIR);
  assert.equal(report.leaseReleased, true);
  assert.deepEqual(report.closureFailures, []);
  return report.fixtures;
}

async function run(mode, lab) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: true });
  const { report, io } = session;
  report.mode = mode;
  report.frozenTargets = TARGETS;
  report.enginePair = REGULAR_WINDOWS_PAIR;
  let service;
  try {
    await session.open();
    assert.equal(session.runtime.manifest.enginePair, REGULAR_WINDOWS_PAIR);
    const stateDir = path.join(session.owned, 'state');
    await io.mkdir(stateDir);
    const state = { runtime: session.runtime, stateDir };
    const controls = createOperationControls(mode === '--normal' ? state : { ...state, families: FAMILIES, policyIdentity: POLICY_ID, ...labControls() });
    const { operationRuntime } = controls;
    const invokeRemux = operationRuntime.invokeRemux.bind(operationRuntime);
    operationRuntime.invokeRemux = (token, tool, args, options) => session.run(session.runtime[tool], args, options,
      (_file, argv, opts) => invokeRemux(token, tool, argv, opts));
    const invoke = operationRuntime.invoke.bind(operationRuntime);
    operationRuntime.invoke = (token, tool, args, options) => session.run(session.runtime[tool], args, options,
      (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new EncoderService({ ffmpeg: session.runtime.ffmpeg, ffprobe: session.runtime.ffprobe, stateDir,
      runtimeIdentity: REGULAR_WINDOWS_PAIR, inspectionWorkers: 1, run: session.run, ...controls });
    await service.initializeDiagnostics();
    session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });

    const positiveInput = path.join(session.owned, 'source');
    const negativeInput = path.join(session.owned, 'cut-source');
    const positiveOutput = path.join(session.owned, 'out');
    const negativeOutput = path.join(session.owned, 'cut-out');
    for (const directory of [positiveInput, negativeInput, positiveOutput, negativeOutput]) await io.mkdir(directory);
    const fixture = TS_FIXTURES.find(row => row.id === 'TS_AV');
    const positiveFile = path.join(positiveInput, fixture.name), negativeFile = path.join(negativeInput, 'ts-cut.ts');
    const pin = file => hashFile(file, { io, signal: session.controller.signal });
    if (lab) {
      await copyPinnedFile(lab.positive.file, positiveFile, lab.positive, { io, signal: session.controller.signal });
      await copyPinnedFile(lab.negative.file, negativeFile, lab.negative, { io, signal: session.controller.signal });
    } else {
      const args = [...generationArgs(fixture, positiveFile)];
      args[args.findIndex(value => value.startsWith('color='))] = 'testsrc2=size=640x360:rate=30:duration=8';
      const generated = await session.run(session.runtime.ffmpeg, args);
      assert.equal(generated.stderr, '');
      const positivePin = await pin(positiveFile);
      report.cut = await cutTransportFixture(positiveFile, negativeFile, positivePin, { io, signal: session.controller.signal });
    }
    report.fixtures = { positive: { file: positiveFile, ...await pin(positiveFile) }, negative: { file: negativeFile, ...await pin(negativeFile) } };
    const prepare = async (input, output) => {
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'mp4' });
      await service.taskPromise;
      return service.snapshot();
    };

    const before = report.invocations.length;
    const ready = await prepare(positiveInput, positiveOutput);
    report.positive = { prepared: ready };
    assert.equal(ready.phase, 'ready', ready.error);
    assert.equal(ready.items.length, 1);
    const item = ready.items[0];
    assert.equal(item.status, 'ready', item.reason);
    assert.equal(report.acceptedStarts, 0);
    service.startBatch({ planId: ready.planId, fileIds: [item.id] });
    report.acceptedStarts++;
    await service.taskPromise;
    const result = service.snapshot().items[0], entry = service.plan.entries.get(item.id);
    const evidence = entry.operationEvidence;
    Object.assign(report.positive, { result, evidence, runtimeGroup: entry.operationRuntimeGroup });
    requireOutcome('ts-mp4', result, evidence);
    requireChildAccounting(report.positive, report.invocations.slice(before));
    const out = await pin(entry.destination);
    assert.equal(out.sha256, evidence.essenceEvidence.outputFileSha256);
    report.positive.output = { file: entry.destination, ...out };
    report.positive.seekWitness = {};
    await seekProof(session, positiveFile, entry.destination, report.positive.seekWitness);
    assert.deepEqual(await pin(entry.destination), out);

    const beforeRefusal = report.invocations.length;
    const refused = await prepare(negativeInput, negativeOutput);
    report.refusal = { result: refused, invocationCount: report.invocations.length - beforeRefusal };
    assert.equal(refused.items.length, 1);
    requireRefusal('ts-refused-cut', refused.items[0]);
    assert.deepEqual(await io.readdir(negativeOutput), []);
    assert.equal(report.acceptedStarts, LIMITS.maxStarts);
    report.refusal.noPublication = true;
    report.refusal.acceptedStarts = 0;
    for (const fixture of Object.values(report.fixtures)) {
      assert.equal((await pin(fixture.file)).sha256, fixture.sha256);
    }
    report.status = mode === '--normal' ? 'passed-normal-ts-seek' : 'passed-lab-ts-seek';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
  } finally {
    if (service) {
      try {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      } catch (error) {
        report.status = 'failed-retained';
        report.serviceClosureFailure = fault(error);
      }
    }
    await session.close();
  }
  return report;
}

if (require.main === module) {
  (async () => {
    const [mode, labId, digest, ...extra] = process.argv.slice(2);
    assert((mode === '--lab' && !labId) || (mode === '--normal' && labId && digest && !extra.length));
    const report = await run(mode, mode === '--normal' ? await readLab(labId, digest) : null);
    console.log(JSON.stringify({ id: report.id, status: report.status, report: path.join(report.directory, 'report.json'),
      acceptedStarts: report.acceptedStarts, childrenClosed: report.childrenClosed, failure: report.failure, closureFailures: report.closureFailures }));
    if (!report.status.startsWith('passed')) process.exitCode = 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
