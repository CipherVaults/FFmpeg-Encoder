'use strict';

// Phase 1 laboratory, isolated from the accepted application. Each command has
// an argv array, owned logs, a durable attempt record, and a cumulative budget.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const core = require('./benchmark-lab-core.cjs');
const lab = require('./benchmark-lab-config.cjs');
const ROOT = path.resolve(__dirname, '..');
const CAMPAIGN = path.join(ROOT, 'artifacts', 'phase1-2026-10-10');
const INPUTS = 'F:\\FFmpeg Station 1\\Records for FFmpeg Benchmark';
const FFMPEG = path.join(ROOT, 'ffmpeg', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'ffmpeg', 'ffprobe.exe');
const value = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = value('phase') || 'status';
const allowed = ['status', 'bootstrap', 'prepare-pilot', 'pilot', 'forecast', 'coarse', 'generalize', 'review'];
assert.ok(allowed.includes(phase), `Phase must be one of ${allowed.join(', ')}`);
fs.mkdirSync(CAMPAIGN, { recursive: true });
const stateFile = path.join(CAMPAIGN, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : {
  schemaVersion: 1, campaignId: 'phase1-2026-10-10', approvedObjectiveSha256: null,
  baseline: 'be92b12205d299b6d3bdcc2fd4b2e3a02f928862', sources: [], windows: [], commands: [], cases: [],
  limits: lab.LIMITS, matrix: lab.MATRIX, encodeInvocations: 0, exclusions: [],
  stage: 'authorized-bootstrap', humanReview: { status: 'not-ready', finalists: null },
};
const ledger = core.createActiveTimeLedger(path.join(CAMPAIGN, 'active-time.json'), { limitMs: lab.LIMITS.activeMs });
let lock;
let heartbeat;
let heartbeatChain = Promise.resolve();
let activeCommand;
let activeCopy;
let fatalAccountingError;

function save() {
  const temporary = `${stateFile}.${process.pid}.pending`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { flag: 'wx' });
  fs.renameSync(temporary, stateFile);
}
function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function stamp(file) {
  const s = fs.statSync(file, { bigint: true });
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(k => [k, String(s[k])]));
}
async function guard(additionalBytes = 0) {
  if (fatalAccountingError) throw fatalAccountingError;
  await core.assertResourceEnvelope({ campaignRoot: CAMPAIGN, workspacePath: ROOT,
    maxGrowthBytes: lab.LIMITS.growthBytes, minFreeBytes: lab.LIMITS.minFreeBytes, additionalBytes });
  assert.ok((await ledger.snapshot()).accumulatedMs < lab.LIMITS.activeMs, 'Active campaign time is exhausted.');
}
function checkSource(source) { assert.deepEqual(stamp(source.stagedPath), source.stagedIdentity, 'Staged source changed.'); }
function checkRuntime() {
  for (const b of state.runtime.binaries) assert.deepEqual(stamp(path.join(ROOT, b.runtimePath)), b.identity, 'Runtime changed.');
}
async function command(exe, argv, label, { timeoutMs = 300000, role = 'analysis', allowFailure = false } = {}) {
  await guard(); if (state.runtime) checkRuntime();
  assert.match(label, /^[a-z0-9-]+$/);
  if (role === 'encode') {
    assert.ok(state.encodeInvocations < lab.LIMITS.encodeInvocations, 'Encode invocation ceiling reached.');
    state.encodeInvocations += 1; save();
  }
  const logRoot = path.join(CAMPAIGN, 'commands'); fs.mkdirSync(logRoot, { recursive: true });
  const sequence = state.commands.length + 1;
  const prefix = path.join(logRoot, `${String(sequence).padStart(4, '0')}-${label}`);
  const stdoutFd = fs.openSync(`${prefix}.stdout.txt`, 'wx');
  const stderrFd = fs.openSync(`${prefix}.stderr.txt`, 'wx');
  const record = { sequence, label, role, executable: exe, argv, startedUtc: new Date().toISOString(),
    status: 'running', stdoutPath: `${prefix}.stdout.txt`, stderrPath: `${prefix}.stderr.txt` };
  state.commands.push(record); save(); console.log(`${sequence} ${role}: ${label}`);
  const remainingMs = (await ledger.snapshot()).remainingMs;
  const started = performance.now();
  const child = spawn(exe, argv, { cwd: CAMPAIGN, shell: false, windowsHide: true, stdio: ['ignore', stdoutFd, stderrFd] });
  activeCommand = child; record.pid = child.pid; save();
  const timer = setTimeout(() => child.kill(), Math.min(timeoutMs, remainingMs));
  let error;
  child.once('error', e => { error = e.message; });
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer); activeCommand = undefined; fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
  Object.assign(record, { ...result, elapsedSeconds: (performance.now() - started) / 1000,
    endedUtc: new Date().toISOString(), status: result.code === 0 ? 'success' : 'failed', error: error || null });
  save();
  const stdout = fs.readFileSync(record.stdoutPath, 'utf8');
  const stderr = fs.readFileSync(record.stderrPath, 'utf8');
  if (!allowFailure) assert.equal(result.code, 0, `${label}: ${stderr.slice(-3000)}`);
  return { record, stdout, stderr };
}
async function probe(file, label) {
  return JSON.parse((await command(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], label)).stdout);
}
function source(id) { const item = state.sources.find(s => s.id === id); assert.ok(item, `Source ${id} missing`); return item; }
async function stageCopy(original, staged) {
  if (fatalAccountingError) throw fatalAccountingError;
  const before = stamp(original); const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(original); const output = fs.createWriteStream(staged, { flags: 'wx' });
  activeCopy = { input, output };
  await new Promise((resolve, reject) => {
    input.on('data', b => hash.update(b)); input.on('error', reject); output.on('error', reject);
    output.on('close', resolve); input.pipe(output);
  });
  activeCopy = undefined;
  if (fatalAccountingError) throw fatalAccountingError;
  assert.deepEqual(stamp(original), before, 'Original changed during staging.');
  const originalSha256 = hash.digest('hex'); assert.equal(await core.sha256File(staged), originalSha256);
  return { originalIdentity: before, sha256: originalSha256 };
}
async function bootstrap() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'binary-manifest.json'), 'utf8'));
  state.runtime = { version: manifest.version, binaries: [], externalEncoderLibraryVersions: manifest.externalEncoderLibraryVersions };
  for (const b of manifest.binaries) {
    const file = path.join(ROOT, b.runtimePath); assert.equal(await core.sha256File(file), b.sha256);
    state.runtime.binaries.push({ ...b, identity: stamp(file) });
  }
  const baseline = await command('git.exe', ['-C', ROOT, 'rev-parse', 'local-v0.6.0^{}'], 'accepted-baseline');
  assert.equal(baseline.stdout.trim(), state.baseline);
  state.approvedObjectiveSha256 = sha(fs.readFileSync('C:\\Users\\Ahmed\\.codex\\attachments\\7d70aa06-3dd1-41b4-a653-38b4e3ff20b5\\goal-objective.md'));
  state.environment = { observedUtc: new Date().toISOString(), os: os.version(), platform: os.platform(),
    cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, memoryBytes: os.totalmem(), node: process.version,
    gpu: (await command('nvidia-smi.exe', ['--query-gpu=name,driver_version,memory.total,power.limit,temperature.gpu', '--format=csv'], 'hardware')).stdout.trim() };
  for (const encoder of ['libx265', 'libsvtav1', 'hevc_nvenc', 'av1_nvenc'])
    await command(FFMPEG, ['-hide_banner', '-h', `encoder=${encoder}`], `help-${encoder.replaceAll('_', '-')}`);
  await command(FFMPEG, ['-hide_banner', '-h', 'filter=libvmaf'], 'help-libvmaf');
  const totalBytes = lab.SOURCES.reduce((n, spec) => n + fs.statSync(path.join(INPUTS, spec.name)).size, 0);
  await guard(totalBytes); state.stagingPlannedBytes = totalBytes; save();
  const stagedRoot = path.join(CAMPAIGN, 'inputs'); fs.mkdirSync(stagedRoot, { recursive: true });
  for (const spec of lab.SOURCES) {
    if (state.sources.some(s => s.id === spec.id)) { checkSource(source(spec.id)); continue; }
    const originalPath = path.join(INPUTS, spec.name), stagedPath = path.join(stagedRoot, spec.name);
    // An unexplained existing staged file is not overwritten or adopted.
    assert.ok(!fs.existsSync(stagedPath), `Unrecorded staged file requires reconciliation: ${stagedPath}`);
    console.log(`Staging ${spec.id}: ${spec.name}`);
    const identity = await stageCopy(originalPath, stagedPath);
    const p = await probe(stagedPath, `${spec.id}-metadata`);
    const video = p.streams.find(s => s.codec_type === 'video');
    assert.equal(video.codec_name, 'av1'); assert.equal(video.pix_fmt, 'yuv420p');
    for (const [field, expected] of Object.entries({ color_transfer: 'bt709', color_space: 'bt709', color_primaries: 'bt709', color_range: 'tv' })) assert.equal(video[field], expected);
    assert.equal(video.height, spec.id === 'acc' ? 1440 : 1080);
    state.sources.push({ ...spec, originalPath, stagedPath, ...identity, sourceId: core.sourceId(identity.sha256),
      stagedIdentity: stamp(stagedPath), probe: p, video }); save();
  }
  state.stage = 'sources-staged-verified'; save();
}

function parseFrameHash(text) {
  const timebase = text.match(/^#tb 0: (\d+)\/(\d+)/m); assert.ok(timebase, 'Framehash timebase missing');
  const rows = text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const fields = line.split(',').map(v => v.trim()); assert.equal(fields.length, 6);
    return { stream: Number(fields[0]), dts: Number(fields[1]), pts: Number(fields[2]), duration: Number(fields[3]), bytes: Number(fields[4]), hash: fields[5] };
  });
  return { timeBase: { numerator: Number(timebase[1]), denominator: Number(timebase[2]) }, frames: rows };
}
async function frameHash(s, window, seek, label) {
  const input = seek ? lab.selector(s, window).input : ['-copyts', '-i', s.stagedPath];
  const result = await command(FFMPEG, ['-hide_banner', '-v', 'error', '-nostdin', ...input,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', lab.selector(s, window).filterAbsolute,
    '-pix_fmt', '+yuv420p', '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-f', 'framemd5', '-'], label);
  return parseFrameHash(result.stdout);
}
async function prepareWindow(definition) {
  const existing = state.windows.find(w => w.id === definition.id);
  if (existing) {
    checkSource(source(definition.sourceId));
    for (const k of ['id', 'sourceId', 'role', 'start', 'end', 'cohort']) assert.equal(existing[k], definition[k]);
    assert.equal(existing.selectorVersion, 2, 'Selector version changed; old trace cannot be reused silently.');
    assert.equal(await core.sha256File(existing.frameHashPath), existing.frameHashFileSha256);
    const saved = JSON.parse(fs.readFileSync(existing.frameHashPath));
    assert.equal(saved.sourceStableId, source(definition.sourceId).sourceId); assert.equal(saved.windowId, existing.windowId);
    return existing;
  }
  assert.notEqual(definition.role, 'holdout', 'Held-out frames remain unopened until settings are frozen.');
  const s = source(definition.sourceId); checkSource(s);
  const fast = await frameHash(s, definition, true, `${definition.id}-selector-seek`);
  const truth = await frameHash(s, definition, false, `${definition.id}-selector-origin`);
  assert.deepEqual(fast, truth, 'Accurate seek selector changes selected frames or native timestamps.');
  assert.ok(fast.frames.length > 0); assert.equal(fast.timeBase.denominator, Number(s.video.time_base.split('/')[1]));
  const secondsPerTick = fast.timeBase.numerator / fast.timeBase.denominator;
  assert.ok(fast.frames.every(f => f.pts * secondsPerTick >= definition.start && f.pts * secondsPerTick < definition.end));
  const packets = JSON.parse((await command(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-read_intervals', `${Math.max(0, definition.start - 3)}%${definition.end + 1}`, '-show_packets',
    '-show_entries', 'packet=pts_time,duration_time,size', '-of', 'json', s.stagedPath], `${definition.id}-source-packets`)).stdout).packets;
  const selected = packets.filter(p => Number(p.pts_time) >= definition.start && Number(p.pts_time) < definition.end);
  assert.equal(selected.length, fast.frames.length, 'Selected packet/frame count does not agree.');
  const firstPts = fast.frames[0].pts * secondsPerTick;
  assert.ok(Math.abs(firstPts - Math.min(...selected.map(p => Number(p.pts_time)))) < 0.00002);
  const actualEnd = Math.max(...selected.map(p => Number(p.pts_time) + Number(p.duration_time || 0)));
  const hashPath = path.join(CAMPAIGN, 'windows', `${definition.id}.json`); fs.mkdirSync(path.dirname(hashPath), { recursive: true });
  const prepared = { ...definition, selectorVersion: 2, sourceStableId: s.sourceId, frameCount: fast.frames.length,
    firstSourcePtsSeconds: firstPts, durationSeconds: actualEnd - firstPts,
    sourceVideoPayloadBytes: selected.reduce((n, p) => n + Number(p.size), 0),
    timeBase: fast.timeBase, frameHashPath: hashPath, selectionValidated: true };
  prepared.windowId = core.windowId({ sourceId: s.sourceId, role: prepared.role, firstPts, frameHash: sha(JSON.stringify(fast)) });
  await core.writeJsonExclusive(hashPath, { ...prepared, frameTrace: fast, sourcePackets: selected });
  prepared.frameHashFileSha256 = await core.sha256File(hashPath);
  state.windows.push(prepared); save(); checkSource(s); return prepared;
}
async function preparePilot() {
  for (const definition of new Map(lab.pilotCases().map(c => [c.window.id, c.window])).values()) await prepareWindow(definition);
  state.stage = 'pilot-selectors-verified'; save();
}

function metricSummary(values) {
  assert.ok(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((n, v) => n + v, 0) / values.length,
    p5: sorted[Math.floor((sorted.length - 1) * 0.05)], minimum: sorted[0], minimumFrame: values.indexOf(sorted[0]) };
}
function runtimeIdentity() {
  return sha(core.canonicalJson({ binaries: state.runtime.binaries.map(b => ({ name: b.name, sha256: b.sha256 })),
    gpu: state.environment.gpu.split(/\r?\n/).at(-1).split(',').slice(0, 4).map(v => v.trim()), os: state.environment.os }));
}
async function outputValidation(output, s, window, label) {
  const packetsProbe = JSON.parse((await command(FFPROBE, ['-v', 'warning', '-show_streams', '-show_format', '-show_packets',
    '-show_entries', 'packet=pts_time,duration_time,size:stream:format', '-of', 'json', output], `${label}-output-packets`)).stdout);
  const v = packetsProbe.streams.find(x => x.codec_type === 'video'); assert.ok(v);
  for (const field of ['width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space', 'color_range']) assert.equal(v[field], s.video[field], `${field} changed`);
  const framesResult = await command(FFPROBE, ['-v', 'warning', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'json', output], `${label}-decoded-frames`);
  const frames = JSON.parse(framesResult.stdout).frames;
  assert.equal(frames.length, window.frameCount); assert.equal(packetsProbe.packets.length, window.frameCount);
  assert.ok(!/error|invalid|corrupt/i.test(framesResult.stderr), 'Decoder reported invalid output.');
  const expected = JSON.parse(fs.readFileSync(window.frameHashPath)).frameTrace;
  const quantum = expected.timeBase.numerator / expected.timeBase.denominator;
  const first = expected.frames[0].pts;
  const deltas = frames.map((f, index) => Number(f.best_effort_timestamp_time) - (expected.frames[index].pts - first) * quantum);
  assert.ok(deltas.every(d => Number.isFinite(d) && Math.abs(d) <= 0.00102), 'Output presentation timing differs by more than Matroska quantization.');
  return { valid: true, frameCount: frames.length, maxPtsErrorSeconds: Math.max(...deltas.map(Math.abs)),
    packetPayloadBytes: packetsProbe.packets.reduce((n, p) => n + Number(p.size), 0),
    probe: packetsProbe, decoderWarnings: framesResult.stderr.trim() || null };
}
async function measureQuality(output, s, window, directory, label, withNeg) {
  const relative = filename => path.relative(CAMPAIGN, path.join(directory, filename)).replaceAll('\\', '/');
  const trace = JSON.parse(fs.readFileSync(window.frameHashPath)).frameTrace;
  // Metrics compare corresponding frames on an index timeline only after
  // actual encoded/native timestamps passed validation. No frames are changed,
  // duplicated or discarded to improve a metric.
  const before = `[0:v]settb=1/60,setpts=N[d];[1:v]${lab.selector(s, window).filterAbsolute},settb=1/60,setpts=N[r]`;
  async function vmaf(model, filename, suffix, allowFailure = false) {
    const graph = `${before};[d][r]libvmaf=model=version=${model}:log_fmt=json:log_path=${relative(filename)}:n_threads=6:n_subsample=1:eof_action=endall:shortest=1:repeatlast=0`;
    const result = await command(FFMPEG, ['-hide_banner', '-v', 'warning', '-nostdin', '-xerror', '-i', output,
      ...lab.selector(s, window).input, '-filter_complex', graph, '-an', '-fps_mode', 'passthrough', '-f', 'null', '-'], `${label}-${suffix}`, { timeoutMs: 600000, allowFailure });
    if (result.record.code !== 0) {
      if (allowFailure && /(?:could not|cannot|failed to) load.*(?:model|version)|model.*(?:not found|unavailable|unsupported)/i.test(result.stderr)) {
        return { available: false, stderr: result.stderr.trim(), commandSequence: result.record.sequence };
      }
      throw new Error(`Metric execution failed (${suffix}): ${result.stderr.slice(-2500)}`);
    }
    const data = JSON.parse(fs.readFileSync(path.join(directory, filename)));
    assert.equal(data.frames.length, window.frameCount);
    assert.ok(data.frames.every((f, index) => f.frameNum === index), 'Metric frame indices are not contiguous.');
    const values = data.frames.map(f => f.metrics.vmaf);
    const summary = metricSummary(values);
    let worst = { mean: Infinity, firstFrame: 0, lastFrame: 0 };
    const times = trace.frames.map(f => (f.pts - trace.frames[0].pts) * trace.timeBase.numerator / trace.timeBase.denominator);
    for (let start = 0, end = 0, sum = 0; start < values.length; start++) {
      while (end < values.length && times[end] < times[start] + 1) sum += values[end++];
      if (end > start && times.at(-1) >= times[start] + 0.95 && sum / (end - start) < worst.mean) worst = { mean: sum / (end - start), firstFrame: start, lastFrame: end - 1 };
      sum -= values[start];
    }
    return { available: true, model, libraryVersion: data.version, ...summary, worstOneSecond: worst,
      rawPath: path.join(directory, filename), commandSequence: result.record.sequence, elapsedSeconds: result.record.elapsedSeconds };
  }
  const regular = await vmaf('vmaf_v0.6.1', 'vmaf.json', 'vmaf');
  const neg = withNeg ? await vmaf('vmaf_v0.6.1neg', 'vmaf-neg.json', 'neg', true) : { available: null, reason: 'Outside protected crosscheck subset.' };
  const ssimPath = relative('ssim.txt');
  const ssim = await command(FFMPEG, ['-hide_banner', '-v', 'info', '-nostdin', '-xerror', '-i', output,
    ...lab.selector(s, window).input, '-filter_complex', `${before};[d][r]ssim=stats_file=${ssimPath}:eof_action=endall:shortest=1:repeatlast=0`,
    '-an', '-fps_mode', 'passthrough', '-f', 'null', '-'], `${label}-ssim`, { timeoutMs: 600000 });
  const rows = fs.readFileSync(path.join(directory, 'ssim.txt'), 'utf8').trim().split(/\r?\n/);
  assert.equal(rows.length, window.frameCount);
  const ssimValues = rows.map(line => Number(line.match(/All:([0-9.]+)/)?.[1]));
  return { regular, neg, ssim: { ...metricSummary(ssimValues),
    planes: Object.fromEntries(['Y', 'U', 'V', 'All'].map(k => [k, Number(ssim.stderr.match(new RegExp(`${k}:([0-9.]+)`))?.[1])])),
    rawPath: path.join(directory, 'ssim.txt'), elapsedSeconds: ssim.record.elapsedSeconds } };
}
async function runCase(definition, config, stage, { repeat = 0, withNeg = false, metrics = true } = {}) {
  const s = source(definition.sourceId); const window = await prepareWindow(definition); checkSource(s); checkRuntime();
  const configurationHash = core.configurationId(config);
  const runtimeHash = runtimeIdentity();
  const id = core.runId({ windowId: window.windowId, configurationHash, runtimeHash, repeat });
  const expected = { sourceHash: s.sha256, configurationHash, runtimeHash, windowId: window.windowId };
  const previous = state.cases.find(c => c.runId === id && c.status === 'complete');
  if (previous) {
    const checked = await core.inspectResume(previous, expected); assert.ok(checked.accepted, checked.reasons.join(', '));
    if (!withNeg || previous.quality.neg.available !== null) { console.log(`Reusing ${definition.id} ${config.familyId} Q${config.settings.quality}`); return previous; }
  }
  await guard(window.sourceVideoPayloadBytes * 2);
  const attempt = await core.createAttempt(path.join(CAMPAIGN, 'runs'), id);
  const output = path.join(attempt.directory, 'video.mkv');
  const label = `${definition.id}-${config.familyId}-q${config.settings.quality}-${attempt.attemptId.slice(-8)}`;
  const record = { runId: id, ...expected, window: window.id, source: s.id, cohort: s.cohort, stage, repeat, config,
    attemptId: attempt.attemptId, directory: attempt.directory, status: 'running',
    startedUtc: new Date().toISOString() };
  state.cases.push(record); save();
  let telemetry;
  let stopTelemetry;
  try {
    const telemetryPath = path.join(attempt.directory, 'gpu.csv');
    const stopPath = path.join(attempt.directory, 'telemetry.stop');
    const monitor = spawn(process.execPath, [path.join(__dirname, 'benchmark-lab-monitor.cjs'), String(process.pid), telemetryPath,
      path.join(attempt.directory, 'gpu-errors.txt'), stopPath], { windowsHide: true, shell: false, stdio: 'ignore' });
    const monitorClose = new Promise(resolve => monitor.once('close', (code, signal) => resolve({ code, signal })));
    monitor.on('error', () => {});
    let monitorStopped = false;
    stopTelemetry = async () => {
      if (monitorStopped) return;
      if (!fs.existsSync(stopPath)) fs.writeFileSync(stopPath, 'stop\n', { flag: 'wx' });
      const terminal = await monitorClose; monitorStopped = true;
      const saved = state.commands.find(c => c.pid === monitor.pid && c.role === 'lightweight-telemetry');
      if (saved) Object.assign(saved, terminal, { status: terminal.code === 0 ? 'stopped' : 'failed', endedUtc: new Date().toISOString() });
      telemetry.available = terminal.code === 0 && fs.existsSync(telemetryPath) && fs.statSync(telemetryPath).size > 0;
      save();
    };
    telemetry = { path: telemetryPath, pid: monitor.pid };
    state.commands.push({ sequence: state.commands.length + 1, label: `${label}-telemetry`, role: 'lightweight-telemetry',
      status: 'running', pid: monitor.pid, executable: 'nvidia-smi.exe', startedUtc: new Date().toISOString(), stdoutPath: telemetryPath }); save();
    let result;
    try {
      result = await command(FFMPEG, lab.encodeArgs(s, window, config, output), `${label}-encode`, { role: 'encode', allowFailure: true, timeoutMs: 900000 });
    } finally {
      await stopTelemetry();
    }
    record.encode = result.record; record.telemetry = telemetry; record.argv = result.record.argv;
    if (result.record.code !== 0) throw new Error(`Encoder failed: ${result.stderr.slice(-2500)}`);
    record.effectiveEvidence = {
      initializationLines: result.stderr.split(/\r?\n/).filter(line => /CQ\(|lookahead|multipass|temporal|b.?frame|b.?ref|Main|preset|rate control|CRF|AQ:|psy/i.test(line)),
      warnings: result.stderr.split(/\r?\n/).filter(line => /warning|unsupported|not supported|ignoring|has not been used|not enough B|Temporal filtering needs/i.test(line)),
      qualification: 'Reported effective fields only; unreported inherited internals remain unknown.',
    };
    if (config.encoder.endsWith('_nvenc')) {
      const observed = result.stderr.match(/CQ\((\d+)\)/); assert.ok(observed, 'NVENC did not report effective CQ mode.');
      assert.equal(Number(observed[1]), config.settings.quality * 256, 'Effective NVENC CQ differs from requested.');
    }
    const tfFlag = config.args.indexOf('-tf_level:v:0');
    const benignExplicitTfDisable = tfFlag >= 0 && config.args[tfFlag + 1] === '0';
    const invalidOptions = record.effectiveEvidence.warnings.filter(line =>
      /unsupported|not supported|ignoring|has not been used/i.test(line)
      || /Temporal filtering needs|not enough B/i.test(line) && !benignExplicitTfDisable);
    if (invalidOptions.length) throw new Error(`Unsupported or ignored requested recipe: ${invalidOptions.join('\n')}`);
    record.validity = await outputValidation(output, s, window, label);
    record.output = { path: output, bytes: fs.statSync(output).size, sha256: await core.sha256File(output) };
    record.elapsedSeconds = result.record.elapsedSeconds;
    record.averageFps = window.frameCount / record.elapsedSeconds;
    record.realtimeFactor = window.durationSeconds / record.elapsedSeconds;
    record.videoPayloadBytes = record.validity.packetPayloadBytes;
    record.videoPayloadRatioToCapture = record.videoPayloadBytes / window.sourceVideoPayloadBytes;
    record.videoBitrate = 8 * record.videoPayloadBytes / window.durationSeconds;
    record.containerBitrate = 8 * record.output.bytes / window.durationSeconds;
    checkSource(s);
    record.quality = metrics ? await measureQuality(output, s, window, attempt.directory, label, withNeg)
      : { regular: { available: null, reason: 'Warmup only' }, neg: { available: null, reason: 'Warmup only' } };
    record.status = 'complete'; record.endedUtc = new Date().toISOString();
    await core.completeAttempt(attempt.directory, record); save(); return record;
  } catch (error) {
    record.status = 'failed'; record.failure = { message: error.message, code: error.code || null, observedUtc: new Date().toISOString() };
    state.exclusions.push({ runId: id, attemptId: attempt.attemptId, reason: error.message });
    await core.completeAttempt(attempt.directory, record); save();
    if (config.experimental && /Encoder failed:.*(not supported|unsupported|invalid|cannot|failed)|Unsupported or ignored requested recipe/is.test(error.message)) {
      state.unsupportedFamilies ||= {}; state.unsupportedFamilies[config.familyId] = record.failure; save(); return record;
    }
    throw error;
  } finally {
    if (stopTelemetry) await stopTelemetry();
  }
}
async function pilot() {
  assert.ok(state.windows.length >= 4, 'Pilot selectors must pass first.');
  state.decodeDiagnostics ||= [];
  for (const window of state.windows) {
    if (state.decodeDiagnostics.some(d => d.windowId === window.windowId)) continue;
    const s = source(window.sourceId);
    const result = await command(FFMPEG, ['-hide_banner', '-v', 'warning', '-nostdin',
      ...lab.selector(s, window).input, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', lab.selector(s, window).filter,
      '-fps_mode', 'passthrough', '-frames:v', String(window.frameCount), '-f', 'null', '-'], `${window.id}-decode-null`);
    state.decodeDiagnostics.push({ windowId: window.windowId, seconds: result.record.elapsedSeconds,
      fps: window.frameCount / result.record.elapsedSeconds, commandSequence: result.record.sequence,
      note: 'Software decode/seek/trim to wrapped-frame null sink; not encoder-only throughput.' }); save();
  }
  const warmed = new Set();
  for (const item of lab.pilotCases()) {
    if (state.unsupportedFamilies?.[item.config.familyId]) continue;
    if (!warmed.has(item.config.familyId)) {
      const existing = state.cases.find(c => c.stage === 'pilot' && c.status === 'complete' && c.window === item.window.id && c.config.familyId === item.config.familyId);
      if (!existing) {
        assert.ok(state.cases.filter(c => c.stage === 'warmup').length < lab.MATRIX.warmupSupportMaximum);
        await runCase(item.window, item.config, 'warmup', { repeat: -(state.encodeInvocations + 1), metrics: false });
      }
      warmed.add(item.config.familyId);
    }
    if (state.unsupportedFamilies?.[item.config.familyId]) continue;
    const crosscheck = ['cd-b', 'desk-b'].includes(item.window.id) && item.config.familyId !== 'svt';
    await runCase(item.window, item.config, 'pilot', { withNeg: crosscheck });
  }
  state.stage = 'pilot-complete-await-forecast'; save();
}

async function main() {
  if (phase === 'status') { console.log(JSON.stringify({ stage: state.stage, sources: state.sources.length,
    windows: state.windows.length, cases: state.cases.length, invocations: state.encodeInvocations, ledger: await ledger.snapshot() }, null, 2)); return; }
  lock = await core.acquireOwnershipLock(path.join(CAMPAIGN, 'ownership.lock'));
  let accountingStarted = false;
  try {
    const interrupted = await core.assertNoLiveRecordedChildren(state.commands);
    for (const item of interrupted) {
      const saved = state.commands.find(c => c.sequence === item.sequence);
      Object.assign(saved, item); saved.recoveryNote = 'Recorded child PID is no longer live; exit status remains unknown.';
    }
    save();
    const prior = await ledger.snapshot();
    if (prior.open) await ledger.recoverDeadOwner();
    await ledger.begin(phase); accountingStarted = true;
    heartbeat = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        const snapshot = await ledger.heartbeat();
        if (snapshot.budgetExceeded) throw new Error('Cumulative active campaign budget reached.');
      }).catch(error => {
        fatalAccountingError = error;
        state.accountingFailure = { message: error.message, observedUtc: new Date().toISOString() }; save();
        console.error(`Accounting failure: ${error.message}`);
        activeCommand?.kill(); activeCopy?.input.destroy(error); activeCopy?.output.destroy(error); process.exitCode = 1;
      });
    }, 1000);
    if (phase === 'bootstrap') await bootstrap();
    else if (phase === 'prepare-pilot') await preparePilot();
    else if (phase === 'pilot') await pilot();
    else throw new Error(`${phase} implementation is not yet enabled. No measurement has been launched.`);
  } finally {
    clearInterval(heartbeat); await heartbeatChain;
    try { if (accountingStarted) await ledger.end('command-ended'); }
    finally { await lock.release(); }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
