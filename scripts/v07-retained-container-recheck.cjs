'use strict';

// Read-only recovery of two already encoded, failed calibration outputs. No
// child, source edit, publication, tolerance fitting or family grant occurs.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildEncodeOperation, withEncodeOperationTelemetry, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'artifacts/v0.7/slice2/continuation2-2026-10-23';
const MODE = 'matroska-packet-end-plus-codec-delay';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function bounded(file, maximum) {
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(maximum));
  assert.equal(await fs.realpath(file), path.resolve(file));
  const bytes = await fs.readFile(file), after = await fs.lstat(file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(before[key], after[key]);
  return { bytes, sha256: sha(bytes), size: bytes.length };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ['--read-retained']);
  const file = path.join(ROOT, 'artifacts/v0.7/slice2/family-calibration/6cedbad8-593c-44eb-874e-5e5cfb732e32/report.json');
  const packetsFile = path.join(ROOT, BASE, 'retained-aac-container.json');
  const saved = await bounded(file, 32 * 1024 * 1024), packetBytes = await bounded(packetsFile, 1024 * 1024);
  const old = JSON.parse(saved.bytes), packets = JSON.parse(packetBytes.bytes);
  assert.equal(old.status, 'failed-retained'); assert.equal(old.leaseReleased, true); assert.equal(packets.status, 'observed');
  const report = { schema: 2, purpose: 'Zero-child retained AAC Matroska clock correction; no encoder, publication or family authority',
    oldReport: { file, sha256: saved.sha256 }, packetReport: { file: packetsFile, sha256: packetBytes.sha256 },
    encodes: 0, children: 0, cases: [],
    rationale: 'The stored Matroska clock precedes CodecDelay subtraction; compare its packet end plus signalled delay, separately from decoded AAC terminal samples.',
    reference: 'https://www.matroska.org/technical/notes.html#block-timestamps',
    limits: ['Historical failed report remains unchanged.', 'Only A/B retained CPU outputs are rechecked.',
      'Original frozen numerical tolerances remain unchanged; the explicit container representation changes.',
      'No normal application or complete family acceptance follows.'] };
  for (const entry of old.cases.slice(0, 2)) {
    assert.equal(entry.signal.valid, true); assert.equal(entry.telemetryValidation.valid, true); assert.equal(entry.collection.status, 'completed');
    assert.deepEqual(entry.validation.errors, ['Container duration differs from decoded full output extent beyond the measured tolerance.']);
    const currentSource = await bounded(entry.sourceBefore.path, 16 * 1024 * 1024);
    assert.equal(currentSource.sha256, entry.sourceBefore.sha256);
    const output = await bounded(entry.stage.file, 16 * 1024 * 1024); assert.equal(output.sha256, entry.outputBefore.sha256);
    const packetIndex = packets.inputs.findIndex(item => item.id === entry.id);
    assert.ok(packetIndex >= 0 && packets.inputs.filter(item => item.id === entry.id).length === 1);
    assert.equal(packets.inputs[packetIndex].input, entry.stage.file);
    assert.equal(packets.inputs[packetIndex].sha256, output.sha256);
    const invocation = packets.invocations[packetIndex];
    assert.equal(invocation.argv[invocation.argv.indexOf('-i') + 1], entry.stage.file);
    const actual = invocation.result;
    assert.equal(actual.exitCode, 0); assert.equal(actual.stderrCapture.truncated, false); assert.equal(actual.stderr, '');
    const rows = actual.stdout.packets, streams = actual.stdout.streams;
    assert.ok(rows.every(row => [0, 1].includes(row.stream_index)));
    const clock = { representation: MODE, streams: streams.map(stream => {
      assert.equal(stream.time_base, '1/1000');
      const subset = rows.filter(row => row.stream_index === stream.index); let end;
      for (const row of subset) {
        assert.ok(Number.isSafeInteger(row.pts) && Number.isSafeInteger(row.duration) && row.duration > 0);
        const value = BigInt(row.pts) + BigInt(row.duration); if (end === undefined || value > end) end = value;
      }
      assert.ok(end > 0n);
      if (stream.index === 1) {
        assert.equal(stream.initial_padding, 1024);
        const side = subset.flatMap(row => row.side_data_list || []);
        assert.ok(side.every(item => item.side_data_type === 'Skip Samples'));
        assert.equal(side.reduce((sum, item) => sum + item.skip_samples, 0), 1024);
        assert.equal(side.reduce((sum, item) => sum + item.discard_padding, 0), 0);
      }
      return { outputIndex: stream.index, packetCount: subset.length, packetEnd: { n: String(end), d: '1000' },
        codecDelaySamples: stream.index === 1 ? 1024 : 0, sampleRate: stream.index === 1 ? 48000 : null };
    }) };
    const plan = withEncodeOperationTelemetry(buildEncodeOperation({ input: entry.sourceBefore.path, output: entry.plan.args.at(-1),
      settings: entry.settings, inspection: entry.inspection, request: entry.plan.contract.request,
      runtimeIdentity: old.runtime.runtimeIdentity, outputId: entry.outputId, generationDescription: entry.generationDescription }));
    assert.equal(plan.planFingerprint, entry.plan.planFingerprint); assert.deepEqual(plan.args, entry.plan.args);
    const qualification = { ...entry.frozen.qualification, containerDuration: MODE };
    const decodedEvidence = { ...entry.collection.decodedEvidence, containerClock: clock };
    const validation = validateEncodeOperationOutput(plan, entry.outputProbe, { qualification, decodedEvidence });
    assert.equal(validation.valid, true, validation.errors.join('; '));
    // Neither a corrupt header nor missing/forged packet evidence can acquire
    // permission through the representation correction.
    const corrupt = structuredClone(entry.outputProbe); corrupt.format.duration = String(Number(corrupt.format.duration) + .01);
    assert.equal(validateEncodeOperationOutput(plan, corrupt, { qualification, decodedEvidence }).valid, false);
    const bad = structuredClone(decodedEvidence); bad.containerClock.streams[1].codecDelaySamples = 0;
    assert.equal(validateEncodeOperationOutput(plan, entry.outputProbe, { qualification, decodedEvidence: bad }).valid, false);
    for (const base of [undefined, '1/48000']) {
      const changed = structuredClone(entry.outputProbe); changed.streams[1].time_base = base;
      assert.equal(validateEncodeOperationOutput(plan, changed, { qualification, decodedEvidence }).valid, false);
    }
    report.cases.push({ id: entry.id, source: { file: entry.sourceBefore.path, sha256: currentSource.sha256, bytes: currentSource.size },
      output: { file: entry.stage.file, sha256: output.sha256, bytes: output.size }, planFingerprint: plan.planFingerprint,
      identicalPreparedArgv: true, qualification, decodedEvidence, validation, sourceProperties: entry.collection.completeSource,
      signalValid: true, telemetryValid: true, negativeHeaderAndDelayChecks: true });
  }
  assert.equal((await bounded(file, 32 * 1024 * 1024)).sha256, saved.sha256);
  assert.equal((await bounded(packetsFile, 1024 * 1024)).sha256, packetBytes.sha256);
  report.status = 'passed-retained-two-case-clock-recheck'; report.finishedAt = new Date().toISOString();
  const target = path.join(ROOT, BASE, 'retained-container-recheck-v2.json');
  await fs.writeFile(target, JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: report.status, report: target, encodes: 0, children: 0, cases: report.cases.map(item => item.id) }) + '\n');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
