'use strict';

// Accessible data is generated from retained attempts, never from a manually
// edited leaderboard. Missing results remain null; failed attempts stay visible.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function metricValues(file, kind, frameCount) {
  let values;
  if (kind === 'ssim') {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert.ok(lines.every((line, i) => Number(line.match(/n:(\d+)/)?.[1]) === i + 1), 'SSIM frame indices changed.');
    values = lines.map(line => Number(line.match(/All:([0-9.]+)/)?.[1]));
  } else {
    const parsed = JSON.parse(fs.readFileSync(file));
    assert.ok(parsed.frames.every((frame, i) => frame.frameNum === i), 'VMAF frame indices changed.');
    values = parsed.frames.map(frame => frame.metrics.vmaf);
  }
  assert.equal(values.length, frameCount, 'Metric frame count changed.');
  assert.ok(values.every(Number.isFinite), 'Metric contains a missing/non-finite value.');
  return values;
}
function verifyMetricEvidence(quality, frameCount, { allowUnsealed = false, withNeg = false } = {}) {
  for (const kind of ['regular', 'neg', 'ssim']) {
    const entry = quality?.[kind];
    if (kind === 'neg' && entry?.available !== true) {
      assert.ok(!withNeg || entry?.available === false, 'Protected NEG measurement is missing.'); continue;
    }
    assert.ok(entry?.rawPath, `Missing ${kind} evidence.`);
    const bytes = fs.readFileSync(entry.rawPath);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.ok(allowUnsealed || entry.rawSha256, `Unsealed ${kind} evidence.`);
    if (entry.rawSha256) assert.equal(digest, entry.rawSha256, `${kind} evidence hash changed.`);
    const values = metricValues(entry.rawPath, kind, frameCount);
    assert.ok(Math.abs(values.reduce((n, v) => n + v, 0) / values.length - entry.mean) < 1e-9,
      `${kind} retained summary differs from raw observations.`);
    const sorted = [...values].sort((a, b) => a - b);
    for (const [field, expected] of Object.entries({ p5: sorted[Math.floor((sorted.length - 1) * 0.05)],
      minimum: sorted[0], minimumFrame: values.indexOf(sorted[0]) })) {
      if (entry[field] !== undefined) assert.equal(entry[field], expected, `${kind} ${field} differs from raw observations.`);
    }
  }
  return true;
}
function effectiveEvidence(config, stderr) {
  const evidence = {
    initializationLines: stderr.split(/\r?\n/).filter(line => /CQ\(|lookahead|multipass|temporal|b.?frame|b.?ref|Main|preset|rate control|CRF|AQ:|psy/i.test(line)),
    warnings: stderr.split(/\r?\n/).filter(line => /warning|unsupported|not supported|ignoring|has not been used|not enough B|Temporal filtering needs/i.test(line)),
    qualification: 'Reported effective fields only; unreported inherited internals remain unknown.',
  };
  if (config.encoder.endsWith('_nvenc')) {
    const observed = stderr.match(/CQ\((\d+)\)/); assert.ok(observed, 'NVENC did not report effective CQ mode.');
    assert.equal(Number(observed[1]), config.settings.quality * 256, 'Effective NVENC CQ differs from requested.');
  }
  const tfFlag = config.args.indexOf('-tf_level:v:0');
  const benignExplicitTfDisable = tfFlag >= 0 && config.args[tfFlag + 1] === '0';
  const invalidOptions = evidence.warnings.filter(line => /unsupported|not supported|ignoring|has not been used/i.test(line)
    || /Temporal filtering needs|not enough B/i.test(line) && !benignExplicitTfDisable);
  assert.ok(!invalidOptions.length, `Unsupported or ignored requested recipe: ${invalidOptions.join('\n')}`);
  return evidence;
}

function csv(rows) {
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = value => {
    if (value === undefined || value === null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${columns.map(quote).join(',')}\n${rows.map(row => columns.map(c => quote(row[c])).join(',')).join('\n')}\n`;
}
function caseRows(state) {
  return state.cases.map(c => {
    const s = state.sources.find(s => s.id === c.source), w = state.windows.find(w => w.id === c.window);
    const references = state.cases.filter(x => x.window === c.window && x.config.familyId === 'x265'
      && x.status === 'complete' && x.stage !== 'warmup');
    const reference = references.find(x => x.timingValidity?.valid === true) || references.find(x => x.repeat === 0);
    return { run_id: c.runId, attempt_id: c.attemptId, source_id: s.sourceId, source_label: c.source,
      window_id: w.windowId, window_label: c.window, cohort: c.cohort, stage: c.stage,
      status: c.status, valid: c.validity?.valid ?? false, family: c.config.familyId, encoder: c.config.encoder,
      timing_valid: c.timingValidity?.valid ?? null, timing_reason: c.timingValidity?.reason ?? null,
      retiming_of: c.retimingOf ?? null,
      preset: c.config.settings.preset, quality_mode: c.config.qualityMode, quality_value: c.config.settings.quality,
      recipe_id: c.config.settings.recipeId ?? null, overrides: c.config.overrides, repeat: c.repeat,
      width: s.video.width, height: s.video.height, pixel_format: c.validity?.probe?.streams?.[0]?.pix_fmt ?? null,
      native_source_time_base: s.video.time_base, frames: w.frameCount, duration_seconds: w.durationSeconds,
      elapsed_seconds: c.elapsedSeconds ?? null, average_fps: c.averageFps ?? null, realtime_factor: c.realtimeFactor ?? null,
      video_payload_bytes: c.videoPayloadBytes ?? null, container_bytes: c.output?.bytes ?? null,
      video_bitrate_bps: c.videoBitrate ?? null, container_bitrate_bps: c.containerBitrate ?? null,
      capture_window_video_bytes: w.sourceVideoPayloadBytes, ratio_to_capture: c.videoPayloadRatioToCapture ?? null,
      x265_video_bytes: reference?.videoPayloadBytes ?? null,
      ratio_to_x265_video: reference && c.videoPayloadBytes ? c.videoPayloadBytes / reference.videoPayloadBytes : null,
      speedup_vs_x265: reference && c.elapsedSeconds && c.timingValidity?.valid === true && reference.timingValidity?.valid === true
        ? reference.elapsedSeconds / c.elapsedSeconds : null,
      vmaf_mean: c.quality?.regular?.mean ?? null, vmaf_p5: c.quality?.regular?.p5 ?? null,
      vmaf_delta_vs_x265: Number.isFinite(c.quality?.regular?.mean) && Number.isFinite(reference?.quality?.regular?.mean)
        ? c.quality.regular.mean - reference.quality.regular.mean : null,
      vmaf_minimum: c.quality?.regular?.minimum ?? null, vmaf_worst_second: c.quality?.regular?.worstOneSecond?.mean ?? null,
      neg_available: c.quality?.neg?.available ?? null, neg_mean: c.quality?.neg?.mean ?? null,
      ssim_mean: c.quality?.ssim?.mean ?? null, ssim_p5: c.quality?.ssim?.p5 ?? null,
      vmaf_model: c.quality?.regular?.model ?? null, metric_library_version: c.quality?.regular?.libraryVersion ?? null,
      runtime_hash: c.runtimeHash, source_sha256: c.sourceHash, output_sha256: c.output?.sha256 ?? null,
      evidence_directory: c.directory, raw_vmaf: c.quality?.regular?.rawPath ?? null,
      raw_neg: c.quality?.neg?.rawPath ?? null, raw_ssim: c.quality?.ssim?.rawPath ?? null,
      harness_identity: c.harnessIdentity ?? null,
      resolved_argv: c.argv ?? null, effective_warnings: c.effectiveEvidence?.warnings ?? null,
      failure_reason: c.failure?.message ?? null };
  });
}
function exportData(state, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const rows = caseRows(state);
  fs.writeFileSync(path.join(directory, 'runs.csv'), csv(rows));
  fs.writeFileSync(path.join(directory, 'runs.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(directory, 'attempts.jsonl'), state.cases.map(c => JSON.stringify(c)).join('\n') + '\n');
  fs.writeFileSync(path.join(directory, 'sources.json'), JSON.stringify(state.sources, null, 2));
  fs.writeFileSync(path.join(directory, 'windows.json'), JSON.stringify(state.windows, null, 2));
  fs.writeFileSync(path.join(directory, 'commands.json'), JSON.stringify(state.commands, null, 2));
  fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({ campaignId: state.campaignId,
    objectiveSha256: state.approvedObjectiveSha256, baseline: state.baseline, environment: state.environment,
    runtime: state.runtime, limits: state.limits, matrix: state.matrix, encodeInvocations: state.encodeInvocations,
    limitations: ['Compressed AV1 capture fidelity, not lossless game-render fidelity.',
      'Native1440 gameplay,1080 gameplay and desktop are separate cohorts.',
      'Screening timing is one completed process, not statistically independent content replication.',
      'Metrics do not constitute Ahmed subjective acceptance.'] }, null, 2));
  return rows;
}
function geometricMean(values) {
  assert.ok(values.length > 0 && values.every(v => Number.isFinite(v) && v > 0));
  return Math.exp(values.reduce((n, v) => n + Math.log(v), 0) / values.length);
}
function chooseMeasuredPoints(state, familyId) {
  const candidates = caseRows(state).filter(r => r.status === 'complete' && r.valid && r.stage !== 'warmup'
    && (r.repeat === 0 || r.retiming_of) && r.family === familyId && r.window_label.endsWith('-a') && r.cohort === '1080p-gameplay'
    && Number.isFinite(r.ratio_to_x265_video) && r.ratio_to_x265_video > 0);
  const valid = [...new Map(candidates.sort((a, b) => Number(a.timing_valid === true) - Number(b.timing_valid === true))
    .map(r => [`${r.window_label}:${r.quality_value}`, r])).values()];
  const groups = new Map();
  for (const row of valid) {
    if (!groups.has(row.quality_value)) groups.set(row.quality_value, []);
    groups.get(row.quality_value).push(row);
  }
  const points = [...groups].filter(([, rows]) => new Set(rows.map(r => r.source_label)).size === 4)
    .map(([quality, rows]) => ({ quality, scenes: rows.map(r => r.source_label),
    sceneCount: rows.length, sizeRatio: geometricMean(rows.map(r => r.ratio_to_x265_video)),
    vmafMean: rows.reduce((n, r) => n + r.vmaf_mean, 0) / rows.length,
    perScene: rows.map(r => ({ source: r.source_label, sizeRatio: r.ratio_to_x265_video,
      vmaf: r.vmaf_mean, p5: r.vmaf_p5, vmafDeltaVsX265: r.vmaf_delta_vs_x265, speedup: r.speedup_vs_x265 })),
    speedup: rows.every(r => Number.isFinite(r.speedup_vs_x265) && r.speedup_vs_x265 > 0)
      ? geometricMean(rows.map(r => r.speedup_vs_x265)) : null }));
  assert.ok(points.length > 0, `No measured points for ${familyId}`);
  const selected = [...points].sort((a, b) => Math.abs(Math.log(a.sizeRatio)) - Math.abs(Math.log(b.sizeRatio)))[0];
  return { familyId, selectedQuality: selected.quality, points,
    bracketedBySize: points.some(p => p.sizeRatio <= 1) && points.some(p => p.sizeRatio >= 1),
    basis: 'Closest measured geometric video-payload ratio to x265 across primary1080 gameplay A scenes; not perceptual equivalence.' };
}
module.exports = { csv, caseRows, exportData, geometricMean, chooseMeasuredPoints, metricValues, verifyMetricEvidence, effectiveEvidence };
