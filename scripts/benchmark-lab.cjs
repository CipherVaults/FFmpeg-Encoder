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
const data = require('./benchmark-lab-data.cjs');
const { generateReview } = require('./benchmark-lab-pack.cjs');
const { estimate } = require('./benchmark-lab-forecast.cjs');
const ROOT = path.resolve(__dirname, '..');
const CAMPAIGN = path.join(ROOT, 'artifacts', 'phase1-2026-10-10');
const INPUTS = 'F:\\FFmpeg Station 1\\Records for FFmpeg Benchmark';
const FFMPEG = path.join(ROOT, 'ffmpeg', 'ffmpeg.exe');
const FFPROBE = path.join(ROOT, 'ffmpeg', 'ffprobe.exe');
const value = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = value('phase') || 'status';
const allowed = ['status', 'bootstrap', 'prepare-pilot', 'pilot', 'checks', 'reconcile-environment', 'reconcile-observers', 'forecast', 'coarse', 'generalize', 'refine', 'review'];
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
let protectedReserveMs = 0;
const phaseWarmed = new Set();

function warmupInvocations() {
  return state.cases.filter(c => c.stage === 'warmup' && state.commands.some(command => command.role === 'encode'
    && command.argv?.at(-1) === path.join(c.directory, 'video.mkv'))).length;
}

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
  const resource = await core.assertResourceEnvelope({ campaignRoot: CAMPAIGN, workspacePath: ROOT,
    maxGrowthBytes: lab.LIMITS.growthBytes, minFreeBytes: lab.LIMITS.minFreeBytes, additionalBytes });
  assert.ok((await ledger.snapshot()).accumulatedMs < lab.LIMITS.activeMs, 'Active campaign time is exhausted.');
  return resource;
}
function checkSource(source) { assert.deepEqual(stamp(source.stagedPath), source.stagedIdentity, 'Staged source changed.'); }
function checkRuntime() {
  for (const b of state.runtime.binaries) assert.deepEqual(stamp(path.join(ROOT, b.runtimePath)), b.identity, 'Runtime changed.');
}
async function command(exe, argv, label, { timeoutMs = 300000, role = 'analysis', allowFailure = false, trackedOutput, allowedPidFile } = {}) {
  const resource = await guard(); if (state.runtime) checkRuntime();
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
    status: 'running', stdoutPath: `${prefix}.stdout.txt`, stderrPath: `${prefix}.stderr.txt`, leasePath: `${prefix}.child.json` };
  state.commands.push(record); save(); console.log(`${sequence} ${role}: ${label}`);
  const remainingMs = (await ledger.snapshot()).remainingMs;
  const started = performance.now();
  const child = spawn(exe, argv, { cwd: CAMPAIGN, shell: false, windowsHide: true, stdio: ['ignore', stdoutFd, stderrFd] });
  let error;
  child.once('error', e => { error = e.message; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  activeCommand = child; record.pid = child.pid;
  // The small durable lease replaces rewriting the growing campaign manifest
  // during timing. Recovery rehydrates the child PID before claiming ownership.
  try {
    if (child.pid) fs.writeFileSync(record.leasePath, JSON.stringify({ sequence, pid: child.pid, executable: exe,
      argvSha256: sha(core.canonicalJson(argv)), startedUtc: record.startedUtc }), { flag: 'wx' });
    if (child.pid && allowedPidFile) {
      const pending = `${allowedPidFile}.pending`;
      fs.writeFileSync(pending, JSON.stringify({ pid: child.pid }), { flag: 'wx' });
      fs.linkSync(pending, allowedPidFile); fs.unlinkSync(pending);
    }
  } catch (failure) {
    child.kill(); await closed; activeCommand = undefined; fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
    Object.assign(record, { status: 'failed', error: `Child lease could not be preserved: ${failure.message}`,
      endedUtc: new Date().toISOString() }); save(); throw failure;
  }
  let fenceError;
  const fence = setInterval(() => {
    try {
      const volume = fs.statfsSync(ROOT, { bigint: true });
      assert.ok(volume.bavail * volume.bsize >= BigInt(lab.LIMITS.minFreeBytes), 'Live free-space floor reached.');
      const growth = [record.stdoutPath, record.stderrPath, trackedOutput].filter(Boolean)
        .reduce((n, file) => n + (fs.existsSync(file) ? fs.statSync(file).size : 0), 0);
      assert.ok(resource.growthBytes + growth < lab.LIMITS.growthBytes, 'Live campaign growth ceiling reached.');
    } catch (error) { fenceError = error; child.kill(); }
  }, 2000);
  const timer = setTimeout(() => child.kill(), Math.max(1, Math.min(timeoutMs, remainingMs - protectedReserveMs)));
  const result = await closed;
  clearTimeout(timer); clearInterval(fence); activeCommand = undefined; fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
  Object.assign(record, { ...result, elapsedSeconds: (performance.now() - started) / 1000,
    endedUtc: new Date().toISOString(), status: result.code === 0 && !fenceError ? 'success' : 'failed', error: fenceError?.message || error || null });
  save();
  if (fenceError) throw fenceError;
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
async function outputValidation(output, s, window, label, { losslessReview = false } = {}) {
  const packetCommand = await command(FFPROBE, ['-v', 'warning', '-show_streams', '-show_format', '-show_packets',
    '-show_entries', 'packet=pts_time,duration_time,size:stream:format', '-of', 'json', output], `${label}-output-packets`);
  const packetsProbe = JSON.parse(packetCommand.stdout);
  const v = packetsProbe.streams.find(x => x.codec_type === 'video'); assert.ok(v);
  if (losslessReview) assert.equal(v.codec_name, 'ffv1', 'Only the explicit lossless review source may use this validation path.');
  else assert.equal(v.profile, 'Main', 'Current8-bit production anchor profile changed.');
  for (const field of ['width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space', 'color_range']) assert.equal(v[field], s.video[field], `${field} changed`);
  const framesResult = await command(FFPROBE, ['-v', 'warning', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time', '-of', 'json', output], `${label}-decoded-frames`);
  assert.equal(framesResult.stderr.trim(), '', 'Output decode emitted a warning/error; diagnose before accepting.');
  const frames = JSON.parse(framesResult.stdout).frames;
  assert.equal(frames.length, window.frameCount); assert.equal(packetsProbe.packets.length, window.frameCount);
  assert.ok(!/error|invalid|corrupt/i.test(framesResult.stderr), 'Decoder reported invalid output.');
  const expected = JSON.parse(fs.readFileSync(window.frameHashPath)).frameTrace;
  const quantum = expected.timeBase.numerator / expected.timeBase.denominator;
  const first = expected.frames[0].pts;
  const deltas = frames.map((f, index) => Number(f.best_effort_timestamp_time) - (expected.frames[index].pts - first) * quantum);
  assert.ok(deltas.every(d => Number.isFinite(d) && Math.abs(d) <= 0.00102), 'Output presentation timing differs by more than Matroska quantization.');
  return { valid: true, frameCount: frames.length, maxPtsErrorSeconds: Math.max(...deltas.map(Math.abs)),
    commandSequences: { packets: packetCommand.record.sequence, decodedFrames: framesResult.record.sequence },
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
      rawPath: path.join(directory, filename), rawSha256: await core.sha256File(path.join(directory, filename)),
      commandSequence: result.record.sequence, elapsedSeconds: result.record.elapsedSeconds };
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
    rawPath: path.join(directory, 'ssim.txt'), rawSha256: await core.sha256File(path.join(directory, 'ssim.txt')),
    commandSequence: ssim.record.sequence, elapsedSeconds: ssim.record.elapsedSeconds } };
}

function harnessIdentity() {
  return Object.fromEntries(['benchmark-lab.cjs', 'benchmark-lab-core.cjs', 'benchmark-lab-config.cjs',
    'benchmark-lab-data.cjs', 'benchmark-lab-forecast.cjs', 'benchmark-lab-monitor.cjs', 'benchmark-lab-quiet.ps1',
    'benchmark-lab-review.cjs', 'benchmark-lab-review-assets.cjs', 'benchmark-lab-pack.cjs']
    .map(name => [name, sha(fs.readFileSync(path.join(__dirname, name)))]));
}
async function quietPreflight(label) {
  const cpu = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'benchmark-lab-quiet.ps1')], `${label}-quiet-cpu`);
  const gpu = await command('nvidia-smi.exe', ['--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder,temperature.gpu,power.draw',
    '--format=csv,noheader,nounits'], `${label}-quiet-gpu`);
  const observation = { cpu: JSON.parse(cpu.stdout), gpu: gpu.stdout.trim(), observedUtc: new Date().toISOString() };
  state.workloadObservations ||= []; state.workloadObservations.push(observation); save();
  const utilization = observation.gpu.split(',').slice(0, 3).map(v => Number(v.trim()));
  assert.ok(utilization.every(Number.isFinite), 'GPU workload observation unavailable.');
  assert.ok(utilization[0] <= 20 && utilization[1] === 0 && utilization[2] <= 5,
    'Background GPU/video work would contaminate timing; no foreign process was stopped.');
  assert.ok((observation.cpu.totalCpuSeconds || 0) <= 1.5,
    'Background CPU work exceeds quiet baseline; no foreign process was stopped.');
  return observation;
}
async function recoverQuality(previous, s, window, withNeg) {
  const revisions = previous.analysisRevisions ||= [];
  try {
    data.verifyMetricEvidence(previous.quality, window.frameCount, { allowUnsealed: true, withNeg });
    // Legacy pilot evidence predates file seals. Check the complete raw trace
    // against retained summaries, then record a present-time seal honestly.
    if (['regular', 'neg', 'ssim'].some(k => previous.quality[k]?.rawPath && !previous.quality[k].rawSha256)) {
      const sealed = structuredClone(previous.quality);
      for (const entry of Object.values(sealed)) if (entry?.rawPath) entry.rawSha256 = await core.sha256File(entry.rawPath);
      const seal = { reason: 'Post-pilot raw-evidence seal; origin hashes were not recorded by first harness.',
        observedUtc: new Date().toISOString(), quality: sealed };
      const file = path.join(previous.directory, `analysis-seal-${crypto.randomUUID()}.json`);
      await core.writeJsonExclusive(file, seal); revisions.push({ path: file, sha256: await core.sha256File(file), ...seal });
      previous.quality = sealed; save();
    }
    return;
  } catch (error) {
    const directory = path.join(previous.directory, `analysis-revision-${crypto.randomUUID()}`);
    fs.mkdirSync(directory);
    const quality = await measureQuality(previous.output.path, s, window, directory,
      `${window.id}-${previous.config.familyId}-repair-${revisions.length + 1}`, withNeg);
    data.verifyMetricEvidence(quality, window.frameCount, { withNeg });
    const revision = { reason: error.message, observedUtc: new Date().toISOString(), priorQuality: previous.quality,
      outputSha256: previous.output.sha256, quality };
    const file = path.join(directory, 'result.json'); await core.writeJsonExclusive(file, revision);
    revisions.push({ path: file, sha256: await core.sha256File(file), ...revision });
    previous.quality = quality; save();
  }
}
async function runCase(definition, config, stage, { repeat = 0, withNeg = false, metrics = true, retimingOf } = {}) {
  const s = source(definition.sourceId); const window = await prepareWindow(definition); checkSource(s); checkRuntime();
  const configurationHash = core.configurationId(config);
  const runtimeHash = runtimeIdentity();
  const id = core.runId({ windowId: window.windowId, configurationHash, runtimeHash, repeat });
  const expected = { sourceHash: s.sha256, configurationHash, runtimeHash, windowId: window.windowId };
  const previous = state.cases.find(c => c.runId === id && c.status === 'complete');
  if (previous) {
    const checked = await core.inspectResume(previous, expected); assert.ok(checked.accepted, checked.reasons.join(', '));
    assert.deepEqual(previous.argv, lab.encodeArgs(s, window, config, previous.output.path), 'Saved executable plan differs from the current builder.');
    if (previous.timingValidity?.valid !== true && stage !== 'warmup') {
      assert.ok(state.cases.filter(c => c.retimingOf).length < lab.MATRIX.diagnosticRetryMaximum,
        'Quiet retiming has consumed the diagnostic allowance.');
      return runCase(definition, config, stage, { repeat: repeat + 1, withNeg, metrics, retimingOf: previous.runId });
    }
    if (metrics) await recoverQuality(previous, s, window, withNeg);
    console.log(`Reusing ${definition.id} ${config.familyId} Q${config.settings.quality}`); return previous;
  }
  const unfinished = [...state.cases].reverse().find(c => c.runId === id && c.status !== 'complete');
  if (unfinished) {
    const output = path.join(unfinished.directory, 'video.mkv');
    const closedEncode = state.commands.find(c => c.role === 'encode' && c.status === 'success'
      && c.code === 0 && c.argv.at(-1) === output && c.endedUtc);
    // A completed child with durable close evidence can survive interrupted
    // metrics/reporting. A playable file with unknown child exit cannot.
    if (closedEncode && fs.existsSync(output) && unfinished.timingValidity?.valid === true) {
      for (const [key, expectedValue] of Object.entries(expected)) assert.equal(unfinished[key], expectedValue);
      assert.deepEqual(closedEncode.argv, lab.encodeArgs(s, window, config, output));
      const recovery = structuredClone(unfinished);
      recovery.priorAttemptStatus = unfinished.status;
      recovery.priorFailure = unfinished.failure || null;
      recovery.encode = closedEncode; recovery.argv = closedEncode.argv;
      recovery.effectiveEvidence = data.effectiveEvidence(config, fs.readFileSync(closedEncode.stderrPath, 'utf8'));
      recovery.validity = await outputValidation(output, s, window, `${definition.id}-recovery-${state.commands.length}`);
      recovery.output = { path: output, bytes: fs.statSync(output).size, sha256: await core.sha256File(output) };
      recovery.elapsedSeconds = closedEncode.elapsedSeconds;
      recovery.averageFps = window.frameCount / recovery.elapsedSeconds;
      recovery.realtimeFactor = window.durationSeconds / recovery.elapsedSeconds;
      recovery.videoPayloadBytes = recovery.validity.packetPayloadBytes;
      recovery.videoPayloadRatioToCapture = recovery.videoPayloadBytes / window.sourceVideoPayloadBytes;
      recovery.videoBitrate = 8 * recovery.videoPayloadBytes / window.durationSeconds;
      recovery.containerBitrate = 8 * recovery.output.bytes / window.durationSeconds;
      if (metrics) await recoverQuality(recovery, s, window, withNeg);
      recovery.status = 'complete'; recovery.recoveredUtc = new Date().toISOString();
      const file = path.join(unfinished.directory, `recovery-result-${crypto.randomUUID()}.json`);
      await core.writeJsonExclusive(file, recovery);
      recovery.recoveryEvidence = { path: file, sha256: await core.sha256File(file) };
      state.cases[state.cases.indexOf(unfinished)] = recovery; save();
      console.log(`Recovered completed encode without re-encoding: ${definition.id} ${config.familyId}`);
      return recovery;
    }
  }
  if (stage !== 'warmup' && !phaseWarmed.has(config.familyId)) {
    const last = [...state.cases].reverse().find(c => c.status === 'complete' && c.timingValidity?.valid === true
      && c.config.familyId === config.familyId && c.encode?.endedUtc);
    if (!last || Date.now() - Date.parse(last.encode.endedUtc) > 30 * 60 * 1000) {
      const supportCount = warmupInvocations() + (state.supportInvocations || 0);
      assert.ok(supportCount < lab.MATRIX.warmupSupportMaximum, 'Warmup/support allowance reached; do not silently expand it.');
      await runCase(definition, config, 'warmup', { repeat: -(state.encodeInvocations + 1), metrics: false });
    }
    phaseWarmed.add(config.familyId);
  }
  await guard(window.sourceVideoPayloadBytes * 2);
  const attempt = await core.createAttempt(path.join(CAMPAIGN, 'runs'), id);
  const output = path.join(attempt.directory, 'video.mkv');
  const label = `${definition.id}-${config.familyId}-q${config.settings.quality}-${attempt.attemptId.slice(-8)}`;
  const record = { runId: id, ...expected, window: window.id, source: s.id, cohort: s.cohort, stage, repeat, config,
    attemptId: attempt.attemptId, directory: attempt.directory, status: 'running',
    startedUtc: new Date().toISOString(), harnessIdentity: harnessIdentity(), ...(retimingOf ? { retimingOf } : {}) };
  state.cases.push(record); save();
  let telemetry;
  let stopTelemetry;
  try {
    record.preflight = await quietPreflight(label);
    const telemetryPath = path.join(attempt.directory, 'gpu.csv');
    const stopPath = path.join(attempt.directory, 'telemetry.stop');
    const allowedPidFile = path.join(attempt.directory, 'timed-child.json');
    const contaminationFile = path.join(attempt.directory, 'foreign-encoder.json');
    const monitor = spawn(process.execPath, [path.join(__dirname, 'benchmark-lab-monitor.cjs'), String(process.pid), telemetryPath,
      path.join(attempt.directory, 'gpu-errors.txt'), stopPath, allowedPidFile, contaminationFile], { windowsHide: true, shell: false, stdio: 'ignore' });
    const monitorClose = new Promise(resolve => monitor.once('close', (code, signal) => resolve({ code, signal })));
    monitor.on('error', () => {});
    let monitorStopped = false;
    const telemetrySequence = state.commands.length + 1;
    stopTelemetry = async () => {
      if (monitorStopped) return;
      if (!fs.existsSync(stopPath)) fs.writeFileSync(stopPath, 'stop\n', { flag: 'wx' });
      const terminal = await monitorClose; monitorStopped = true;
      data.closeTelemetryRecord(state.commands, telemetrySequence, terminal, new Date().toISOString());
      telemetry.available = terminal.code === 0 && fs.existsSync(telemetryPath) && fs.statSync(telemetryPath).size > 0;
      save();
    };
    telemetry = { path: telemetryPath, pid: monitor.pid };
    state.commands.push({ sequence: telemetrySequence, label: `${label}-telemetry`, role: 'lightweight-telemetry',
      status: 'running', pid: monitor.pid, executable: 'nvidia-smi.exe', startedUtc: new Date().toISOString(), stdoutPath: telemetryPath }); save();
    let result;
    try {
      result = await command(FFMPEG, lab.encodeArgs(s, window, config, output), `${label}-encode`,
        { role: 'encode', allowFailure: true, timeoutMs: 3600000, trackedOutput: output, allowedPidFile });
    } finally {
      await stopTelemetry();
    }
    record.encode = result.record; record.telemetry = telemetry; record.argv = result.record.argv;
    record.timingValidity = { valid: telemetry.available && Boolean(record.preflight),
      method: 'Quiet CPU/GPU preflight plus owned telemetry and foreign-NVENC-session observation.' };
    if (!telemetry.available) throw new Error('GPU/session observers failed; clean timing remains unverified.');
    if (fs.existsSync(contaminationFile)) {
      record.timingValidity = { valid: false, reason: 'Foreign NVENCsession appeared during timing.',
        evidence: JSON.parse(fs.readFileSync(contaminationFile)) };
      throw new Error('Foreign hardware encoding appeared during timing; no foreign process was stopped.');
    }
    if (result.record.code !== 0) throw new Error(`Encoder failed: ${result.stderr.slice(-2500)}`);
    record.effectiveEvidence = data.effectiveEvidence(config, result.stderr);
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
    if (metrics) data.verifyMetricEvidence(record.quality, window.frameCount, { withNeg });
    record.status = 'complete'; record.endedUtc = new Date().toISOString();
    await core.completeAttempt(attempt.directory, record); save(); return record;
  } catch (error) {
    record.status = 'failed'; record.failure = { message: error.message, code: error.code || null, observedUtc: new Date().toISOString() };
    state.exclusions.push({ runId: id, attemptId: attempt.attemptId, reason: error.message });
    await core.completeAttempt(attempt.directory, record); save();
    if (config.experimental && /Encoder failed:.*(not supported|unsupported|invalid|cannot|failed)|Unsupported or ignored requested recipe/is.test(error.message)) {
      state.unsupportedConfigurations ||= {}; state.unsupportedConfigurations[configurationHash] = record.failure;
      if (!Object.keys(config.overrides || {}).length) {
        state.unsupportedFamilies ||= {}; state.unsupportedFamilies[config.familyId] = record.failure;
      }
      save(); return record;
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
        assert.ok(warmupInvocations() < lab.MATRIX.warmupSupportMaximum);
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

async function forecast() {
  for (const item of lab.pilotCases().filter(c => !state.unsupportedFamilies?.[c.config.familyId])) {
    assert.ok(state.cases.some(c => c.status === 'complete' && c.stage !== 'warmup' && c.window === item.window.id
      && c.configurationHash === core.configurationId(item.config)), `Pilot case is unfinished: ${item.window.id} ${item.config.familyId}`);
  }
  for (const c of state.cases.filter(c => c.status === 'complete' && c.stage !== 'warmup')) {
    await recoverQuality(c, source(c.source), state.windows.find(w => w.id === c.window),
      ['cd-b', 'desk-b'].includes(c.window) && c.config.familyId !== 'svt');
  }
  const resource = await guard();
  const targeted = lab.targetedCases().map(item => ({ source: item.window.sourceId,
    family: item.config.familyId, quality: item.config.settings.quality }));
  const snapshot = await ledger.snapshot();
  const report = estimate(state, snapshot, resource);
  report.adaptiveScenarios = [
    { name: 'source-specific-reduced-b-full-coarse', options: { sourceSpecific: true, reducedB: true } },
    { name: 'source-specific-reduced-b-targeted20', options: { sourceSpecific: true, reducedB: true, coarseSelection: targeted } },
  ].map(({ name, options }) => ({ name, ...estimate(state, snapshot, resource, options) }));
  const file = path.join(CAMPAIGN, `forecast-${crypto.randomUUID()}.json`);
  await core.writeJsonExclusive(file, report);
  state.forecasts ||= []; state.forecasts.push({ path: file, sha256: await core.sha256File(file), ...report });
  if (state.stage.startsWith('pilot-')) state.stage = report.fullSearchFitsWithOneFinalist ? 'pilot-accepted-ready-coarse' : 'pilot-budget-review-required';
  save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'pilot'));
  console.log(JSON.stringify(report, null, 2));
}
async function reconcileEnvironment() {
  if (!state.timingContamination) {
    const evidence = { observedUtc: new Date().toISOString(), foreignPid: 28084, process: 'obs64.exe',
      liveEncoder: 'HEVC1920x1080, approximately100fps, observed NVENCsession161',
      evidence: ['CPU x265pilot telemetry shows18–21percent hardware encoder utilization.',
        'WindowsVideoEncode engine counter attributes19percent toPID28084.',
        'nvidia-smi encodersessions identifiesPID28084 asactiveHEVCsession.',
        'Ahmed replied that he would stopOBS; PID subsequently exited and twoidleGPU observations reportencoder0/decoder0.'],
      disposition: 'Preserve valid frames/content/quality/payload evidence. Exclude originalpilot timing from clean comparisons; retime only reused consequential settings under quiet conditions.' };
    const file = path.join(CAMPAIGN, 'pilot-timing-contamination.json');
    await core.writeJsonExclusive(file, evidence); state.timingContamination = { ...evidence, path: file };
    for (const c of state.cases.filter(c => c.encode && c.status === 'complete')) {
      c.timingValidity = { valid: false, reason: 'ConcurrentOBS hardware encoding during initialpilot.', evidence: file };
    }
    save();
  }
  await quietPreflight('environment-restored');
  state.stage = 'quiet-environment-ready-bounded-coarse'; save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'pilot'));
}

async function reconcileObservers() {
  const changes = [];
  for (const record of state.commands.filter(c => c.role === 'lightweight-telemetry')) {
    const terminalPath = `${record.stdoutPath}.terminal.json`;
    const processPath = `${record.stdoutPath}.process.json`;
    if (!fs.existsSync(terminalPath) || !fs.existsSync(processPath)) continue;
    const terminal = JSON.parse(fs.readFileSync(terminalPath));
    const owned = JSON.parse(fs.readFileSync(processPath));
    assert.equal(owned.wrapperPid, record.pid);
    assert.ok(Number.isFinite(Date.parse(terminal.endedUtc)), 'Observer terminal time is invalid.');
    const mismatch = !['stopped', 'failed'].includes(record.status)
      || Math.abs(Date.parse(record.endedUtc) - Date.parse(terminal.endedUtc)) > 1000;
    if (!mismatch) continue;
    assert.equal(core.defaultPidAlive(record.pid), false, 'A currently live observer cannot be reconciled from old evidence.');
    const before = structuredClone(record);
    if (!Array.isArray(terminal.results)) {
      // Restore only a corrupted historical time from the original observer's
      // terminal evidence. Its weaker single-observer/timing validity stays as
      // recorded; this does not promote the contaminated pilot to clean data.
      assert.equal(record.status, 'stopped');
      assert.ok(terminal.terminating && terminal.signal === 'SIGTERM');
      Object.assign(record, { endedUtc: terminal.endedUtc,
        closeRecovery: 'Historical observer time restored from its own single-child terminal sidecar after PID-reuse bookkeeping; original evidence limitations unchanged.' });
    } else {
      assert.equal(terminal.results.length, 2);
      assert.equal(new Set(terminal.results.map(r => r.pid)).size, 2);
      assert.ok(terminal.results.every(r => [owned.childPid, owned.sessionPid].includes(r.pid)));
      assert.ok(terminal.errorsSeen.length === 0 && terminal.results.every(r => r.code === 0 || r.terminatedByUs));
      Object.assign(record, { code: 0, signal: null, status: 'stopped', endedUtc: terminal.endedUtc,
        closeRecovery: 'Terminal time and successful owned-child closure reconstructed from this observer’s own sidecars after a PID-reuse bookkeeping defect.' });
    }
    changes.push({ before, after: structuredClone(record), terminalPath, processPath,
      terminalSha256: await core.sha256File(terminalPath), processSha256: await core.sha256File(processPath) });
  }
  if (changes.length) {
    const file = path.join(CAMPAIGN, `observer-reconciliation-${crypto.randomUUID()}.json`);
    await core.writeJsonExclusive(file, { observedUtc: new Date().toISOString(), changes });
    state.observerReconciliations ||= []; state.observerReconciliations.push({ path: file, sha256: await core.sha256File(file) }); save();
  }
  console.log(JSON.stringify({ reconciled: changes.map(c => c.after.sequence) }));
}

function crosscheck(item) {
  return ['cd-b', 'desk-b'].includes(item.window.id) && item.config.familyId !== 'svt';
}
function orderedCases(items, stage) {
  state.schedules ||= {};
  const ordered = [...items].sort((a, b) => sha(`${stage}:${a.window.id}:${core.configurationId(a.config)}`)
    .localeCompare(sha(`${stage}:${b.window.id}:${core.configurationId(b.config)}`)));
  const descriptors = ordered.map(c => ({ window: c.window.id, configuration: c.config, configurationHash: core.configurationId(c.config) }));
  if (state.schedules[stage]) assert.deepEqual(state.schedules[stage], descriptors, 'A saved schedule cannot silently change.');
  else { state.schedules[stage] = descriptors; save(); }
  return ordered;
}
async function coarse() {
  const block = value('block') || 'anchors';
  assert.ok(['anchors', 'remainder', 'targeted20'].includes(block));
  const latest = state.forecasts?.at(-1); assert.ok(latest, 'A pilot forecast is required before search.');
  const forecast = block === 'targeted20'
    ? latest.adaptiveScenarios.find(s => s.name === 'source-specific-reduced-b-targeted20') : latest;
  assert.ok(forecast, 'The exact bounded allocation needs a measured forecast.');
  if (block === 'targeted20') assert.ok(forecast.capacityScenarios[0].fits, 'The bounded allocation cannot fit its protected reserve.');
  // The nominal matrix is a maximum. A bounded first block is permitted only
  // after reserving original held-outs, all protected pairs, refinement and
  // reporting. No supposed future overlap is spent before it is known.
  const reservedSeconds = forecast.contingencyFactor * (forecast.capacityScenarios[0].heldoutSecondsBeforeContingency
    + forecast.stagesSecondsBeforeContingency.refinement + forecast.stagesSecondsBeforeContingency.selectorReserve
    + forecast.stagesSecondsBeforeContingency.supportReserve) + forecast.stagesSecondsBeforeContingency.reportingReserve;
  assert.ok((await ledger.snapshot()).remainingMs / 1000 > reservedSeconds, 'Protected validation/reporting reserve leaves no safe search budget.');
  protectedReserveMs = reservedSeconds * 1000;
  if (!state.environment.powerPlan) {
    state.environment.powerPlan = (await command('powercfg.exe', ['/getactivescheme'], 'power-plan')).stdout.trim(); save();
  }
  const cases = lab.SOURCES.flatMap(s => lab.FAMILIES.filter(f => !state.unsupportedFamilies?.[f.id])
    .flatMap(f => f.values.map(q => ({ window: lab.windowDefinitions(s.id, 'a'), config: lab.configuration(f.id, q) }))));
  const selected = block === 'targeted20' ? orderedCases(lab.targetedCases(), 'coarse-targeted20')
    : orderedCases(cases, 'coarse').filter(item => block === 'remainder'
    || item.config.settings.quality === lab.FAMILIES.find(f => f.id === item.config.familyId).values
      [Math.floor(lab.FAMILIES.find(f => f.id === item.config.familyId).values.length / 2)]);
  state.matrixChanges ||= [];
  if (!state.matrixChanges.some(c => c.id === 'pilot-bounded-search')) {
    state.matrixChanges.push({ id: 'pilot-bounded-search', observedUtc: new Date().toISOString(),
      reason: 'Conservative nominal96point/threefinalist maximum does not fit12h. Matrix ceilings are not obligations.',
      firstBlock: '36 middle-point/reference A cases before8 exact pilot reuses;28 new cases.',
      priority: 'AllA/BArchive29;protectedrecipepairs;measuredreferencebrackets;humanvisualfreeze;originalheldouts/repeats.',
      deferred: 'FullBpointbreadth, optionalablations, extrafinalists and low-valuecoarsepoints depend on measured remaining capacity.' }); save();
  }
  for (const item of selected) {
    const remaining = (await ledger.snapshot()).remainingMs / 1000;
    assert.ok(remaining > reservedSeconds + 180, 'Search stopped before consuming protected validation/reporting reserve.');
    await runCase(item.window, item.config, 'coarse');
  }
  state.stage = block === 'anchors' ? 'coarse-anchor-block-complete-await-forecast'
    : block === 'targeted20' ? 'targeted-a-complete-await-forecast' : 'coarse-complete'; save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'coarse'));
}
async function generalize() {
  assert.ok(['coarse-complete', 'targeted-a-complete-await-forecast'].includes(state.stage)
    || state.schedules?.['generalization-reduced23'], 'Accepted bounded A search must finish first.');
  if (!state.selections) {
    state.selections = lab.FAMILIES.filter(f => f.id !== 'x265' && !state.unsupportedFamilies?.[f.id])
      .map(f => data.chooseMeasuredPoints(state, f.id)); save();
  }
  await reserveSearch(18);
  state.matrixChanges ||= [];
  if (!state.matrixChanges.some(c => c.id === 'reduced-b23')) state.matrixChanges.push({ id: 'reduced-b23',
    observedUtc: new Date().toISOString(), reason: 'Source-specific measured forecast and independent bounded review protect original held-outs/recipe pairs while reducing generalization breadth.',
    requirements: 'x265+Archive29 all sixB; threeotherNVENC arms CD/SF/Desktop; SVT CD/Desktop.',
    interpretation: 'Closest measured A size points challenge B generalization; these are not perceived-equivalence finalists.' });
  save();
  for (const item of orderedCases(lab.reducedGeneralization(state.selections), 'generalization-reduced23'))
    await runCase(item.window, item.config, 'generalization', { withNeg: crosscheck(item) });
  state.generalizationEvidence = lab.reducedGeneralization(state.selections).map(item => {
    const record = [...state.cases].reverse().find(c => c.status === 'complete' && c.validity?.valid
      && c.timingValidity?.valid && c.window === item.window.id && c.configurationHash === core.configurationId(item.config));
    assert.ok(record, 'A reduced B requirement lacks a valid clean result.'); return record.runId;
  });
  state.stage = 'generalization-complete'; save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'generalization'));
  console.log(JSON.stringify(state.selections, null, 2));
}

async function reserveSearch(refinementRemaining) {
  const latest = state.forecasts?.at(-1)?.adaptiveScenarios.find(s => s.name === 'source-specific-reduced-b-targeted20');
  assert.ok(latest && latest.capacityScenarios[0].fits, 'A measured source-specific budget is required.');
  const perRefinement = latest.unitCosts?.refinement ?? latest.stagesSecondsBeforeContingency.refinement
    / (latest.forecastOptions.refinementCases ?? lab.MATRIX.refinement);
  const seconds = latest.contingencyFactor * (latest.capacityScenarios[0].heldoutSecondsBeforeContingency
    + refinementRemaining * perRefinement + latest.stagesSecondsBeforeContingency.selectorReserve
    + latest.stagesSecondsBeforeContingency.supportReserve) + latest.stagesSecondsBeforeContingency.reportingReserve;
  assert.ok((await ledger.snapshot()).remainingMs > seconds * 1000 + 180000, 'Search would consume the protected validation/reporting reserve.');
  protectedReserveMs = seconds * 1000;
}

async function refine() {
  assert.equal(state.generalizationEvidence?.length, 23, 'Verified generalization must precede the protected challenges.');
  const block = value('block') || 'cd-challenges';
  const items = lab.refinementCases(block);
  const completed = new Set(state.cases.filter(c => c.stage === 'refinement' && c.status === 'complete')
    .map(c => `${c.window}:${c.configurationHash}`)).size;
  const pending = items.filter(item => !state.cases.some(c => c.stage === 'refinement' && c.status === 'complete'
    && c.window === item.window.id && c.configurationHash === core.configurationId(item.config))).length;
  assert.ok(completed + pending <= lab.MATRIX.refinement);
  await reserveSearch(Math.max(0, lab.MATRIX.refinement - completed - pending));
  for (const item of orderedCases(items, `refinement-${block}`))
    await runCase(item.window, item.config, 'refinement', { withNeg: crosscheck(item) });
  state.stage = `refinement-${block}-complete-await-review`; save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'refinement'));
}

async function prepareReview() {
  assert.ok(state.reviewAllocation, 'Review assets require an explicitly recorded, measured calibration allocation.');
  assert.notEqual(state.humanReview.status, 'finalists-frozen', 'Frozen finalists must not regenerate calibration.');
  await generateReview({ state, campaign: CAMPAIGN, ffmpeg: FFMPEG, command, source, guard, checkSource, save,
    outputValidation, parseFrameHash, supportCount: () => warmupInvocations() + (state.supportInvocations || 0),
    supportMaximum: () => lab.MATRIX.warmupSupportMaximum }, state.reviewAllocation);
  state.stage = 'awaiting-calibration-judgment'; save();
  data.exportData(state, path.join(CAMPAIGN, 'data', 'calibration'));
  console.log(JSON.stringify({ reviewPath: state.reviewBundle.directory, status: state.humanReview.status }));
}

async function main() {
  if (phase === 'status') { console.log(JSON.stringify({ stage: state.stage, sources: state.sources.length,
    windows: state.windows.length, cases: state.cases.length, invocations: state.encodeInvocations, ledger: await ledger.snapshot() }, null, 2)); return; }
  lock = await core.acquireOwnershipLock(path.join(CAMPAIGN, 'ownership.lock'));
  let accountingStarted = false;
  try {
    for (const command of state.commands.filter(c => c.status === 'running' && c.leasePath && fs.existsSync(c.leasePath))) {
      const lease = JSON.parse(fs.readFileSync(command.leasePath));
      assert.equal(lease.sequence, command.sequence); assert.equal(lease.executable, command.executable);
      assert.equal(lease.argvSha256, sha(core.canonicalJson(command.argv))); command.pid = lease.pid;
    }
    const nativeObservers = [];
    for (const c of state.commands.filter(c => c.role === 'lightweight-telemetry' && c.status === 'running')) {
      const file = `${c.stdoutPath}.process.json`;
      if (!fs.existsSync(file)) continue;
      const process = JSON.parse(fs.readFileSync(file));
      for (const key of ['childPid', 'sessionPid']) if (process[key]) nativeObservers.push({
        pid: process[key], status: 'running', sequence: `observer-${c.sequence}-${key}`, role: 'lightweight-telemetry' });
    }
    const interrupted = await core.assertNoLiveRecordedChildren([...state.commands, ...nativeObservers]);
    for (const item of interrupted) {
      const saved = state.commands.find(c => c.sequence === item.sequence);
      if (!saved) continue;
      Object.assign(saved, item); saved.recoveryNote = 'Recorded child PID is no longer live; exit status remains unknown.';
    }
    save();
    const prior = await ledger.snapshot();
    if (prior.open) await ledger.recoverDeadOwner();
    await ledger.begin(phase); accountingStarted = true;
    if (state.matrix.warmupSupportMaximum !== lab.MATRIX.warmupSupportMaximum) {
      state.matrixChanges ||= [];
      state.matrixChanges.push({ id: 'support-from-optional-ablation', observedUtc: new Date().toISOString(),
        before: state.matrix, after: lab.MATRIX,
        reason: 'Prioritize measured comparability and native lossless visual review; move eight optional ablation invocations to warm-up/support. Total340 stays unchanged; protected pairs/NEG/refinement/heldouts/repeats remain.' });
      state.matrix = lab.MATRIX; save();
    }
    heartbeat = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        const snapshot = await ledger.heartbeat();
        if (snapshot.budgetExceeded) throw new Error('Cumulative active campaign budget reached.');
        if (protectedReserveMs && snapshot.remainingMs <= protectedReserveMs)
          throw new Error('Protected validation/reporting reserve reached; further search is not authorized by the budget.');
      }).catch(error => {
        fatalAccountingError = error;
        core.failClosedAccounting(error, {
          stopOwnedWork: failure => {
            activeCommand?.kill(); activeCopy?.input.destroy(failure); activeCopy?.output.destroy(failure);
          },
          persistFailure: failure => {
            state.accountingFailure = { message: failure.message, observedUtc: new Date().toISOString() }; save();
          },
          reportFailure: failure => console.error(`Failure-state persistence also failed: ${failure.message}`),
        });
        console.error(`Accounting failure: ${error.message}`); process.exitCode = 1;
      });
    }, 1000);
    if (phase === 'bootstrap') await bootstrap();
    else if (phase === 'prepare-pilot') await preparePilot();
    else if (phase === 'pilot') await pilot();
    else if (phase === 'checks') await command(process.execPath, ['--test',
      ...['core', 'config', 'data', 'monitor', 'review', 'review-assets', 'pack'].map(name => path.join(ROOT, 'tests', `benchmark-lab-${name}.test.cjs`))], 'focused-harness-checks');
    else if (phase === 'forecast') await forecast();
    else if (phase === 'reconcile-environment') await reconcileEnvironment();
    else if (phase === 'reconcile-observers') await reconcileObservers();
    else if (phase === 'coarse') await coarse();
    else if (phase === 'generalize') await generalize();
    else if (phase === 'refine') await refine();
    else if (phase === 'review') await prepareReview();
    else throw new Error(`${phase} implementation is not yet enabled. No measurement has been launched.`);
  } finally {
    clearInterval(heartbeat);
    await core.finalizeAccounting({ pendingHeartbeat: heartbeatChain,
      endInterval: () => accountingStarted ? ledger.end('command-ended') : undefined,
      releaseLock: () => lock.release() });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
