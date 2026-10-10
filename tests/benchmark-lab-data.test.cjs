'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const data = require('../scripts/benchmark-lab-data.cjs');
const { estimate } = require('../scripts/benchmark-lab-forecast.cjs');

test('raw metric recovery requires a known zero exit and exactly the same executable and argv', t => {
  const root = path.resolve(__dirname, '../artifacts');
  const dir = fs.mkdtempSync(path.join(root, 'benchmark-metric-recovery-'));
  t.after(() => { assert.equal(path.dirname(dir), root); fs.rmSync(dir, { recursive: true }); });
  const raw = path.join(dir, 'vmaf.json'), stdoutPath = path.join(dir, 'stdout.txt'), stderrPath = path.join(dir, 'stderr.txt');
  for (const file of [raw, stdoutPath, stderrPath]) fs.writeFileSync(file, 'retained');
  const command = { sequence: 7, executable: 'pinned.exe', argv: ['-i', 'owned-output', '-filter_complex', 'exact'],
    status: 'success', code: 0, endedUtc: '2026-10-10T00:00:00Z', stdoutPath, stderrPath };
  assert.equal(data.closedMetricCommand([command], 'pinned.exe', command.argv, raw), command);
  assert.equal(data.closedMetricCommand([command], 'other.exe', command.argv, raw), null);
  assert.equal(data.closedMetricCommand([command], 'pinned.exe', [...command.argv, 'changed'], raw), null);
  assert.equal(data.closedMetricCommand([{ ...command, status: 'running' }], 'pinned.exe', command.argv, raw), null);
  assert.equal(data.closedMetricCommand([{ ...command, code: 1 }], 'pinned.exe', command.argv, raw), null);
  assert.equal(data.closedMetricCommand([{ ...command, endedUtc: undefined }], 'pinned.exe', command.argv, raw), null);
});

test('observer close selects its exact command when Windows reuses a PID', () => {
  const old = { sequence: 152, pid: 50616, role: 'lightweight-telemetry', status: 'stopped', endedUtc: 'old' };
  const current = { sequence: 682, pid: 50616, role: 'lightweight-telemetry', status: 'running' };
  data.closeTelemetryRecord([old, current], 682, { code: 0, signal: null }, 'new');
  assert.equal(old.endedUtc, 'old'); assert.equal(current.endedUtc, 'new');
  assert.equal(current.status, 'stopped');
  assert.throws(() => data.closeTelemetryRecord([old, current], 999, { code: 0 }, 'missing'), /unique/);
  assert.throws(() => data.closeTelemetryRecord([old, current], 682, { code: 0 }, 'duplicate'), /running/);
});

test('raw metric reuse rejects altered observations and retained summaries', t => {
  const root = path.resolve(__dirname, '../artifacts'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'benchmark-data-test-'));
  t.after(() => { assert.equal(path.dirname(directory), root); fs.rmSync(directory, { recursive: true }); });
  const vmaf = path.join(directory, 'vmaf.json'), ssim = path.join(directory, 'ssim.txt');
  fs.writeFileSync(vmaf, JSON.stringify({ frames: [{ frameNum: 0, metrics: { vmaf: 90 } }, { frameNum: 1, metrics: { vmaf: 94 } }] }));
  fs.writeFileSync(ssim, 'n:1 Y:0.9 U:0.9 V:0.9 All:0.9\nn:2 Y:1 U:1 V:1 All:1\n');
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const quality = { regular: { rawPath: vmaf, rawSha256: digest(vmaf), mean: 92 },
    neg: { available: null }, ssim: { rawPath: ssim, rawSha256: digest(ssim), mean: 0.95 } };
  assert.equal(data.verifyMetricEvidence(quality, 2), true);
  assert.throws(() => data.verifyMetricEvidence(quality, 2, { withNeg: true }), /NEG/);
  quality.regular.mean = 93; assert.throws(() => data.verifyMetricEvidence(quality, 2), /summary/);
  quality.regular.mean = 92; fs.appendFileSync(vmaf, ' ');
  assert.throws(() => data.verifyMetricEvidence(quality, 2), /hash changed/);
});

test('global setting choice excludes partial scene coverage and does not imply quality equivalence', () => {
  const ids = ['cd', 'e33', 'fh5', 'sf'];
  const state = { sources: ids.map(id => ({ id, sourceId: id, video: {} })),
    windows: ids.map(id => ({ id: `${id}-a`, windowId: id, sourceVideoPayloadBytes: 1000 })), cases: [] };
  for (const id of ids) for (const [familyId, quality, size] of [['x265', 25, 100], ['av1-ordinary', 30, 90], ['av1-ordinary', 24, 130]]) {
    state.cases.push({ runId: `${id}-${familyId}-${quality}`, source: id, window: `${id}-a`,
      cohort: '1080p-gameplay', stage: 'coarse', status: 'complete', repeat: 0, validity: { valid: true },
      config: { familyId, settings: { quality } }, videoPayloadBytes: size, elapsedSeconds: 10,
      quality: { regular: { mean: 95 } } });
  }
  state.cases.push({ ...state.cases.at(-1), source: 'cd', window: 'cd-a', config: { familyId: 'av1-ordinary', settings: { quality: 29 } }, videoPayloadBytes: 100 });
  const chosen = data.chooseMeasuredPoints(state, 'av1-ordinary');
  assert.equal(chosen.selectedQuality, 30); assert.equal(chosen.points.length, 2);
  assert.equal(chosen.bracketedBySize, true); assert.match(chosen.basis, /not perceptual equivalence/);
  Object.assign(state.cases.at(-1), { failure: { message: 'old interruption' }, priorFailure: { message: 'old interruption' },
    recoveredUtc: '2026-10-10T01:00:00Z' });
  const recovered = data.caseRows(state).at(-1);
  assert.equal(recovered.failure_reason, null); assert.equal(recovered.prior_failure_reason, 'old interruption');
  assert.equal(recovered.recovered_utc, '2026-10-10T01:00:00Z');
});

test('CSV preserves embedded newlines, quotes, exact argv arrays and missing values', () => {
  const csv = data.csv([{ label: 'a,"b"\nc', argv: ['-i', 'a b.mp4'], metric: null }]);
  assert.match(csv, /"a,""b""\nc"/); assert.match(csv, /"\[""-i"",""a b.mp4""\]"/);
  assert.match(csv, /,\n$/);
});

test('effective settings fail closed for ignored options and wrong CQ, including recovered encodes', () => {
  const config = { encoder: 'av1_nvenc', settings: { quality: 30 }, args: ['-tune:v:0', 'uhq'] };
  assert.equal(data.effectiveEvidence(config, 'CQ(7680)').warnings.length, 0);
  assert.throws(() => data.effectiveEvidence(config, 'CQ(7424)'), /differs/);
  assert.throws(() => data.effectiveEvidence(config, 'CQ(7680)\nwarning: option has not been used'), /ignored/);
  assert.throws(() => data.effectiveEvidence(config, 'CQ(7680)\nTemporal filtering needs 4 B frames'), /ignored/);
  assert.doesNotThrow(() => data.effectiveEvidence({ ...config, args: ['-tf_level:v:0', '0'] },
    'CQ(7680)\nTemporal filtering needs 4 B frames'));
});

test('forecast reserves independent protected pairs and three held-out repetitions', () => {
  const families = ['x265', 'svt', 'hevc-ordinary', 'hevc-archive', 'av1-ordinary', 'av1-quality'];
  const state = { cases: [], commands: [], windows: [{ id: 'cd-b', durationSeconds: 12 }], encodeInvocations: 26 };
  for (const family of families) state.cases.push({ status: 'complete', stage: 'pilot', validity: { valid: true },
    config: { familyId: family, settings: { quality: 30 } }, cohort: '1080p-gameplay', window: 'cd-b',
    elapsedSeconds: family === 'x265' ? 100 : 15, encode: { sequence: 1 }, quality: {
      regular: { commandSequence: 4, elapsedSeconds: 15 }, neg: { elapsedSeconds: 15 }, ssim: { elapsedSeconds: 10 } } });
  const forecast = estimate(state, { accumulatedMs: 2000000, remainingMs: 41200000 }, {});
  assert.equal(forecast.counts.heldoutInvocationsBeforeOverlap, 108);
  assert.equal(forecast.counts.remainingCoarse, 96);
  assert.ok(forecast.stagesSecondsBeforeContingency.heldoutIncludingRepeats > 0);
  assert.equal(forecast.contingencyFactor, 1.25);
  assert.equal(forecast.maximumRemainingSeconds - forecast.mandatoryRemainingSeconds,
    forecast.contingencyFactor * forecast.stagesSecondsBeforeContingency.optionalAblation);
  assert.equal(forecast.capacityScenarios.length, 3);
  assert.ok(forecast.capacityScenarios[0].remainingSeconds < forecast.capacityScenarios[2].remainingSeconds);
  assert.equal(forecast.fullHeldoutPlusCoarseRemainingSeconds > 0, true);
  const completed = { ...state.cases.at(-1), stage: 'refinement', timingValidity: { valid: true } };
  state.cases.push(completed, { ...completed, repeat: 1 });
  const after = estimate(state, { accumulatedMs: 2000000, remainingMs: 41200000 }, {});
  assert.equal(after.counts.completedRefinement, 1);
  assert.equal(after.counts.remainingRefinement, 17);
  assert.equal(after.stagesSecondsBeforeContingency.refinement, 17 * after.unitCosts.refinement);
});

test('forecast retains difficult B cost while replacing only equivalent contaminated timings', () => {
  const families = ['x265', 'svt', 'hevc-ordinary', 'hevc-archive', 'av1-ordinary', 'av1-quality'];
  const state = { commands: [], encodeInvocations: 26,
    windows: ['cd-a', 'cd-b'].map(id => ({ id, durationSeconds: 12 })), cases: [] };
  for (const family of families) for (const [window, clean, elapsed] of [['cd-a', true, 10], ['cd-b', false, 100]]) {
    state.cases.push({ source: 'cd', status: 'complete', stage: 'coarse', repeat: 0, validity: { valid: true },
      timingValidity: { valid: clean }, window, cohort: '1080p-gameplay', elapsedSeconds: elapsed,
      config: { familyId: family, settings: { quality: 29 } }, quality: { regular: { elapsedSeconds: 1 }, ssim: { elapsedSeconds: 1 } } });
  }
  const snapshot = { accumulatedMs: 1000, remainingMs: 43199000 };
  const options = { sourceSpecific: true, reducedB: true, coarseSelection: [{ source: 'cd', family: 'hevc-archive', quality: 25 }] };
  const difficult = estimate(state, snapshot, {}, options);
  assert.equal(difficult.counts.remainingCoarse, 1);
  assert.equal(difficult.stagesSecondsBeforeContingency.coarse, 105);
  assert.match(difficult.capacityScenarios[0].qualification, /same-source/);
  for (const family of families) state.cases.push({ ...state.cases.find(c => c.config.familyId === family && c.window === 'cd-b'),
    timingValidity: { valid: true }, repeat: 1, retimingOf: 'old', elapsedSeconds: 20 });
  const replaced = estimate(state, snapshot, {}, options);
  assert.equal(replaced.stagesSecondsBeforeContingency.coarse, 25);
  assert.ok(replaced.capacityScenarios[0].remainingSeconds < difficult.capacityScenarios[0].remainingSeconds);
});

test('targeted search stays within original measured points and preserves all primary scenes', () => {
  const lab = require('../scripts/benchmark-lab-config.cjs');
  const cases = lab.targetedCases(); assert.equal(cases.length, 20);
  assert.equal(new Set(cases.map(c => `${c.window.id}:${c.config.familyId}`)).size, 20);
  for (const c of cases) {
    assert.equal(c.window.cohort, '1080p-gameplay');
    assert.ok(lab.FAMILIES.find(f => f.id === c.config.familyId).values.includes(c.config.settings.quality));
  }
});
