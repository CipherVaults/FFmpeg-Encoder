'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool, boundedToolStderr } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { getNativeProfile } = require('./backend-adapters.cjs');
const { NativeCapabilityRegistry } = require('./backend-capabilities.cjs');
const { NativeObservationCollector, qsvRuntimeSettings, nativeInitializationArgs,
  captureNativeInitialization, ASSURANCE } = require('./backend-observation.cjs');

// Main-only orchestration, never an IPC endpoint. The caller supplies the
// existing global media slot and actual discovery/vendor collectors. The
// default collector consumes this probe's captured-child receipt. Successful
// output, requested argv, or a fabricated runtime-query summary grant nothing.
const WIDTH = 320, HEIGHT = 180, FRAMES = 96, FPS = 30;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_ROOT_BYTES = 256 * 1024 * 1024, MAX_DIRECTORY_ENTRIES = 256;
const PROBE_FORECAST = 52 * 1024 * 1024, MIN_FREE_MARGIN = 512 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const same = (a, b) => ['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every(key => a[key] === b[key]);
const objectSame = (a, b) => ['dev', 'ino', 'birthtimeNs'].every(key => a[key] === b[key]);
const stamp = value => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].map(key => [key, String(value[key])]));
const interrupted = signal => { if (signal?.aborted) fail('CANCELLED', 'Native qualification cancelled.'); };
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_NATIVE_PROBE', `${label} must be an inert record.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)
      || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('INVALID_NATIVE_PROBE', `${label} has unknown, missing or accessor fields.`);
}
function localPath(file) {
  if (typeof file !== 'string' || file.length > 32760 || !path.isAbsolute(file) || path.normalize(file) !== file || /[\x00-\x1f\x7f]/.test(file)) fail('INVALID_NATIVE_PROBE', 'Main must supply a canonical local path.');
  const root = path.parse(file).root;
  if (process.platform === 'win32' ? !/^[a-z]:\\$/i.test(root) : root !== '/' || file.startsWith('//')) fail('INVALID_NATIVE_PROBE', 'Network and device namespaces are not probe paths.');
  const parts = file.slice(root.length).split(path.sep);
  if (parts.length > 64 || parts.some(part => !part || /[<>:"|?*]/.test(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('INVALID_NATIVE_PROBE', 'Unsafe probe path component.');
  return file;
}
async function seal(file, maximum) {
  await assertOrdinaryPath(file);
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.dev === 0n || before.ino === 0n
      || before.size < 0n || before.size > BigInt(maximum)) fail('PROBE_FILE_UNSAFE', 'Probe evidence is linked, invalid or over its byte limit.');
  const handle = await fs.open(file, 'r'), digest = createHash('sha256'), buffer = Buffer.alloc(Math.min(maximum + 1, 1024 * 1024));
  try {
    if (!same(before, await handle.stat({ bigint: true }))) fail('PROBE_FILE_CHANGED', 'Probe file changed during open.');
    for (let offset = 0; offset < Number(before.size);) {
      const part = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (!part.bytesRead) fail('PROBE_FILE_CHANGED', 'Probe file became incomplete.');
      digest.update(buffer.subarray(0, part.bytesRead)); offset += part.bytesRead;
    }
    await assertOrdinaryPath(file);
    if (!same(before, await handle.stat({ bigint: true })) || !same(before, await fs.lstat(file, { bigint: true }))) fail('PROBE_FILE_CHANGED', 'Probe file changed while observed.');
    return { file, bytes: Number(before.size), sha256: digest.digest('hex'), identity: stamp(before) };
  } finally { await handle.close(); }
}
async function stable(receipt) {
  await assertOrdinaryPath(receipt.file);
  if (JSON.stringify(stamp(await fs.lstat(receipt.file, { bigint: true }))) !== JSON.stringify(receipt.identity)) fail('PROBE_FILE_CHANGED', 'A sealed probe file changed before use.');
}

function numericProbeFrame(bitDepth, index) {
  if (![8, 10].includes(bitDepth) || !Number.isInteger(index) || index < 0 || index >= FRAMES) fail('INVALID_NATIVE_PROBE', 'Invalid numeric fixture frame.');
  const unit = bitDepth === 10 ? 2 : 1, scale = unit === 2 ? 4 : 1, bytes = Buffer.alloc(WIDTH * HEIGHT * 3 / 2 * unit);
  const write = (sample, value) => unit === 2 ? bytes.writeUInt16LE(value * scale, sample * 2) : bytes.writeUInt8(value, sample);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const column = Math.floor(x / 40);
    const code = y >= 128 && column < 7 ? (index >>> column & 1 ? 216 : 40)
      : y >= 128 ? 128 : 32 + ((x + index * 3 + y * 2) % 184);
    write(y * WIDTH + x, code);
  }
  const offset = WIDTH * HEIGHT, chroma = offset / 4;
  for (let i = 0; i < chroma; i++) {
    const x = i % (WIDTH / 2), y = Math.floor(i / (WIDTH / 2));
    write(offset + i, 96 + ((x + index) % 64)); write(offset + chroma + i, 96 + ((y * 2 + index * 3) % 64));
  }
  return bytes;
}
function decodedFrameId(bytes, bitDepth) {
  const unit = bitDepth === 10 ? 2 : 1, expected = WIDTH * HEIGHT * 3 / 2 * unit;
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected) fail('PROBE_OUTPUT_MISMATCH', 'Decoded frame byte count is wrong.');
  let id = 0;
  for (let bit = 0; bit < 7; bit++) {
    let total = 0;
    for (let y = 144; y < 160; y++) for (let x = bit * 40 + 10; x < bit * 40 + 26; x++) {
      const at = y * WIDTH + x; total += unit === 2 ? bytes.readUInt16LE(at * 2) / 4 : bytes.readUInt8(at);
    }
    const mean = total / 256;
    if (mean > 90 && mean < 166) fail('PROBE_OUTPUT_MISMATCH', 'Decoded frame identity is ambiguous at this quality setting.');
    if (mean >= 166) id |= 1 << bit;
  }
  return id;
}
function validateMetadata(stdout, plan) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > plan.limits.stdoutBytes) fail('PROBE_OUTPUT_MISMATCH', 'Metadata capture exceeded its bound.');
  let parsed; try { parsed = JSON.parse(stdout); } catch { fail('PROBE_OUTPUT_MISMATCH', 'Probe metadata is not complete JSON.'); }
  const profile = getNativeProfile(plan.policy.profileId), pixel = plan.fixture.pixelFormat;
  if (!Array.isArray(parsed.streams) || parsed.streams.length !== 1 || !Array.isArray(parsed.frames) || parsed.frames.length !== FRAMES) fail('PROBE_OUTPUT_MISMATCH', 'The output must contain one complete 96-frame video stream.');
  const video = parsed.streams[0];
  const expectedProfile = profile.codec === 'H264' ? 'High' : profile.codec === 'H265' ? plan.policy.bitDepth === 10 ? 'Main 10' : 'Main' : 'Main';
  const common = value => value.width === WIDTH && value.height === HEIGHT && value.pix_fmt === pixel && value.color_range === 'tv'
    && value.color_space === 'bt709' && value.color_transfer === 'bt709' && value.color_primaries === 'bt709';
  if (video.codec_type !== 'video' || video.codec_name !== profile.encodedCodec || video.profile !== expectedProfile || video.index !== 0 || !common(video)
      || !['progressive', 'unknown', undefined].includes(video.field_order)
      || !Number.isFinite(Number(parsed.format?.duration)) || Math.abs(Number(parsed.format.duration) - FRAMES / FPS) > 0.002) fail('PROBE_OUTPUT_MISMATCH', 'Output codec, geometry, depth, duration or SDR signaling differs.');
  for (const [index, frame] of parsed.frames.entries()) {
    const time = Number(frame.best_effort_timestamp_time ?? frame.pts_time);
    if (frame.media_type !== 'video' || frame.stream_index !== 0 || !common(frame) || frame.interlaced_frame !== 0
        || !Number.isFinite(time) || Math.abs(time - index / FPS) > 0.00051) fail('PROBE_OUTPUT_MISMATCH', 'Decoded metadata shows wrong frames, cadence, color or scan mode.');
    if (frame.side_data_list !== undefined && (!Array.isArray(frame.side_data_list) || frame.side_data_list.length > 32
        || frame.side_data_list.some(item => !item || typeof item.side_data_type !== 'string' || /mastering|content light|dolby|dovi|hdr|ambient/i.test(item.side_data_type)))) fail('PROBE_OUTPUT_MISMATCH', 'SDR fixture acquired malformed or unexpected HDR metadata.');
  }
  return { codec: profile.encodedCodec, bitDepth: plan.policy.bitDepth, width: WIDTH, height: HEIGHT, frames: FRAMES,
    decodedFrames: FRAMES, chroma: '4:2:0', signal: 'sdr', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv', valid: true };
}

function validateNativeObservation(receipt, context) {
  if (!(context?.collector instanceof NativeObservationCollector)) fail('PROBE_EVIDENCE_UNOBSERVED', 'Only the owning captured-child collector can validate native observation.');
  const { collector, ...bindings } = context; return collector.complete(receipt, bindings);
}

class NativeBackendProbe {
  #registry; #root; #runtime; #observe; #native; #slot; #run; #active = null; #maximum;
  #collector = new NativeObservationCollector();
  constructor({ registry, ownedRoot, runtime, observeEnvironment, acquireMediaSlot, observeNative = async ({ receipt }) => receipt, run = runTool, maxOwnedBytes = MAX_ROOT_BYTES }) {
    if (!(registry instanceof NativeCapabilityRegistry) || [observeEnvironment, acquireMediaSlot, observeNative, run].some(value => typeof value !== 'function')
        || !Number.isSafeInteger(maxOwnedBytes) || maxOwnedBytes < PROBE_FORECAST || maxOwnedBytes > 1024 * 1024 * 1024) throw new TypeError('Native probe needs main-owned registry, collectors, media admission and bounded storage.');
    exact(runtime, ['ffmpeg', 'ffprobe'], 'fixed runtime');
    this.#registry = registry; this.#root = localPath(ownedRoot); this.#runtime = { ffmpeg: localPath(runtime.ffmpeg), ffprobe: localPath(runtime.ffprobe) };
    this.#observe = observeEnvironment; this.#slot = acquireMediaSlot; this.#native = observeNative; this.#run = run; this.#maximum = maxOwnedBytes;
  }
  // Explicit main-only bootstrap, never called by construction/discovery/startup
  // or an IPC endpoint. The zero-frame generated/null child initializes only the
  // selected device/API; it neither encodes vendor media nor qualifies a cell.
  async initialize(request, { signal } = {}) {
    exact(request, ['cellId'], 'initialization request');
    if (typeof request.cellId !== 'string' || !UUID.test(request.cellId)
        || signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_NATIVE_PROBE', 'Choose a current main-owned cell and native cancellation signal.');
    if (this.#active) fail('PROBE_BUSY', 'A native initialization or capability probe is already owned.');
    const selected = this.#registry.getCell(request);
    if (getNativeProfile(selected.policy.profileId).backend === 'amf') return { status: 'untested', reason: 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED', initialization: null,
      invocations: [], limitation: 'The pinned AMF CLI has no complete same-component effective-property/runtime readback producer.' };
    interrupted(signal);
    const active = {}; this.#active = active;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort();
    const deadline = setTimeout(abort, 60000); deadline.unref();
    const report = { schema: 1, cellId: request.cellId, status: 'preparing', reason: null, initialization: null, invocations: [],
      assurance: ASSURANCE, scope: 'Explicit zero-frame generated/null device/API initialization only. No codec, RC, media, hardware qualification or execution grant.',
      storage: 'No media or filesystem output. Complete bounded capture is returned to main for owned evidence retention; JSON cannot restore the bootstrap receipt.' };
    let slot;
    try {
      const admitted = await this.#slot({ signal: controller.signal, purpose: 'native-backend-initialization' });
      if (!admitted || typeof admitted.release !== 'function') fail('INVALID_NATIVE_PROBE', 'Main media admission did not return an owned release handle.');
      slot = admitted;
      interrupted(controller.signal);
      const before = await this.#observe({ signal: controller.signal }); this.#registry.observeDiscovery(before);
      const cell = this.#registry.getCell(request);
      if (cell.state === 'stale') fail('CAPABILITY_STALE', 'Select the newly current device/runtime cell before initializing.');
      if (this.#registry.snapshot().profiles.find(profile => profile.profileId === cell.policy.profileId)?.reason !== 'CHOOSE_AND_QUALIFY_CELL') {
        fail('NATIVE_DEVICE_UNAVAILABLE', 'Complete current wrapper/device discovery is required before a native initializer child.');
      }
      const argv = nativeInitializationArgs(before, cell.settings.deviceId).slice(), pins = {};
      await assertOrdinaryPath(this.#root, 'directory');
      const available = await fs.statfs(this.#root, { bigint: true });
      if (available.bavail * available.bsize < BigInt(MIN_FREE_MARGIN)) fail('PROBE_RESOURCE_LIMIT', 'Insufficient owned-volume operational margin for bounded initialization.');
      for (const name of ['ffmpeg', 'ffprobe']) {
        pins[name] = await seal(this.#runtime[name], 512 * 1024 * 1024);
        if (pins[name].sha256 !== cell.policy[`${name}Sha256`]) fail('CAPABILITY_STALE', 'Initializer fixed binary bytes differ from current discovery.');
      }
      const entry = { kind: 'initialization', invocationId: randomUUID(), executable: this.#runtime.ffmpeg,
        executableSha256: pins.ffmpeg.sha256, argv, argvSha256: sha(JSON.stringify(argv)), status: 'running', startedAt: Date.now() };
      report.invocations.push(entry);
      let child, closed, closePromise, result;
      const stop = () => { try { child?.kill(); } catch { /* keep ownership until actual close */ } };
      try {
        interrupted(controller.signal);
        result = await this.#run(this.#runtime.ffmpeg, argv, { signal: controller.signal, timeoutMs: 15000,
          stdoutLimit: 8192, stderrLimit: 256 * 1024, onChild: owned => {
            if (child || !owned || typeof owned.once !== 'function' || typeof owned.kill !== 'function') fail('PROBE_CHILD_INVALID', 'Initializer runner supplied an invalid or duplicate child handle.');
            child = owned; closePromise = new Promise(resolve => { owned.once('close', (code, exitSignal) => { closed = { code, signal: exitSignal }; entry.close = closed; resolve(); }); });
            controller.signal.addEventListener('abort', stop, { once: true }); if (controller.signal.aborted) stop();
          } });
        if (!child) fail('PROBE_CHILD_UNOBSERVED', 'A result without an owned initializer child cannot establish actual closure.');
      } catch (error) {
        const captured = boundedToolStderr(error, 256 * 1024);
        entry.stderr = captured.stderr; entry.stderrCapture = captured.stderrCapture || null; throw error;
      } finally {
        if (child) { if (!closed) stop(); await closePromise; controller.signal.removeEventListener('abort', stop); }
        entry.finishedAt = Date.now();
      }
      entry.stderr = result.stderr; entry.stderrCapture = result.stderrCapture;
      if (result.exitCode !== 0 || closed.code !== 0 || closed.signal !== null) fail('INITIALIZATION_FAILED', 'The selected initializer child did not close successfully.');
      if (result.stdout !== '' || result.stdoutCapture !== undefined && (result.stdoutCapture.truncated !== false
          || result.stdoutCapture.totalBytes !== 0 || result.stdoutCapture.streamed === true)) fail('PROBE_CAPTURE_INCOMPLETE', 'The null initializer must have no stdout output or unexplained capture accounting.');
      exact(result.stderrCapture, ['totalBytes', 'truncated'], 'initializer stderr capture');
      if (typeof result.stderr !== 'string' || result.stderrCapture.truncated !== false
          || result.stderrCapture.totalBytes !== Buffer.byteLength(result.stderr) || result.stderrCapture.totalBytes > 256 * 1024) fail('PROBE_CAPTURE_INCOMPLETE', 'Complete bounded initialization stderr is required.');
      interrupted(controller.signal);
      const after = await this.#observe({ signal: controller.signal }); this.#registry.observeDiscovery(after);
      for (const name of ['ffmpeg', 'ffprobe']) {
        const current = await seal(this.#runtime[name], 512 * 1024 * 1024);
        if (current.sha256 !== after.runtime[name]?.sha256 || JSON.stringify(current) !== JSON.stringify(pins[name])) fail('CAPABILITY_STALE', 'Initializer binaries changed before completed evidence.');
      }
      interrupted(controller.signal);
      report.initialization = captureNativeInitialization({ before, after, deviceId: cell.settings.deviceId,
        invocation: this.#nativeInvocation(entry), stderr: result.stderr, stderrCapture: result.stderrCapture });
      entry.status = 'closed'; report.status = 'observed'; report.reason = 'API_VERSION_OBSERVED';
    } catch (error) {
      report.status = 'untested'; report.reason = controller.signal.aborted ? 'CANCELLED' : error.code || 'INITIALIZATION_FAILED';
      report.failure = { code: error.code || 'INITIALIZATION_FAILED', message: String(error.message).slice(0, 1024) };
      if (report.invocations.length) report.invocations[0].status = 'failed';
    } finally {
      clearTimeout(deadline);
      try { await slot?.release(); } catch (error) {
        report.initialization = null; report.status = 'untested'; report.reason = 'INITIALIZATION_SLOT_UNRELEASED'; report.slotReleaseFailure = String(error.message).slice(0, 1024);
      }
      if (controller.signal.aborted || signal?.aborted) { report.initialization = null; report.status = 'untested'; report.reason = 'CANCELLED'; }
      signal?.removeEventListener('abort', abort);
      report.finishedAt = Date.now(); if (this.#active === active) this.#active = null;
    }
    return report;
  }
  async probe(request, { signal } = {}) {
    exact(request, ['cellId'], 'probe request');
    if (typeof request.cellId !== 'string' || !UUID.test(request.cellId)) fail('INVALID_NATIVE_PROBE', 'Choose a current main-owned capability cell.');
    if (this.#active) fail('PROBE_BUSY', 'A native capability probe is already active.');
    const cell = this.#registry.getCell(request);
    if (getNativeProfile(cell.policy.profileId).backend === 'amf') return { cell, status: 'untested', reason: 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED', invocations: [],
      limitation: 'The pinned AMF CLI has no complete same-component effective RC/quality/preset/runtime readback. No helper session or requested values can supply this encoder invocation\'s missing proof.' };
    if (/^(unknown|unavailable|unresolved|not-detected)$/i.test(cell.policy.device.runtimeVersion)) return { cell, status: 'untested', reason: 'VENDOR_RUNTIME_UNOBSERVED', invocations: [],
      limitation: 'DXGI driver identity is not a vendor runtime version. A reliable bounded initializer observation is required before probing.' };
    interrupted(signal);
    const active = {}; this.#active = active;
    let ticket, slot, directory, directoryIdentity, reportHandle, reportIdentity;
    const lifecycle = { encode: 'not-started', decode: 'not-started' }, report = { schema: 1, evidenceId: randomUUID(), cellId: request.cellId,
      status: 'preparing', invocations: [], artifacts: [], lifecycle, cleanup: 'Retain owned diagnostic evidence; no files outside this unique run are modified or removed.',
      scope: 'Exact-setting 96-frame SDR functional encode/decode only. No HDR, benchmark, ancillary preservation, packaged or real-vendor acceptance is inferred from injected tests.' };
    let outputValidation, nativeValidation, nativeReceipt, beforeEnvironment, failure;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const deadline = setTimeout(abort, 90000); deadline.unref();
    const childClosures = new Set();
    const safeDirectory = async () => {
      await assertOrdinaryPath(this.#root, 'directory');
      if (directory) {
        await assertOrdinaryPath(directory, 'directory');
        if (!objectSame(directoryIdentity, await fs.lstat(directory, { bigint: true }))) fail('PROBE_FILE_CHANGED', 'Owned probe directory was replaced.');
      }
    };
    const storage = async forecast => {
      await safeDirectory(); let bytes = 0;
      const directories = await fs.readdir(this.#root, { withFileTypes: true });
      if (directories.length > MAX_DIRECTORY_ENTRIES) fail('PROBE_RESOURCE_LIMIT', 'Probe retention directory count exceeded its bound.');
      for (const entry of directories) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^native-probe-[a-f0-9-]{36}$/.test(entry.name)) fail('PROBE_FILE_UNSAFE', 'Probe root contains an unrecognized or linked entry.');
        const folder = path.join(this.#root, entry.name); await assertOrdinaryPath(folder, 'directory');
        const files = await fs.readdir(folder, { withFileTypes: true });
        if (files.length > 32) fail('PROBE_RESOURCE_LIMIT', 'Probe evidence count exceeded its bound.');
        for (const file of files) {
          const stat = await fs.lstat(path.join(folder, file.name), { bigint: true });
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('PROBE_FILE_UNSAFE', 'Probe retention contains a linked or unexpected file.');
          bytes += Number(stat.size);
        }
      }
      if (bytes + forecast > this.#maximum) fail('PROBE_RESOURCE_LIMIT', 'Retained probe evidence leaves insufficient owned storage budget; no automatic cleanup was performed.');
      const available = await fs.statfs(this.#root, { bigint: true });
      if (available.bavail * available.bsize < BigInt(forecast + MIN_FREE_MARGIN)) fail('PROBE_RESOURCE_LIMIT', 'Insufficient free space for a bounded probe plus margin.');
      return bytes;
    };
    const save = async () => {
      if (!reportHandle) return;
      await safeDirectory(); const file = path.join(directory, 'report.json'), current = await reportHandle.stat({ bigint: true });
      if (!objectSame(reportIdentity, current) || !same(current, await fs.lstat(file, { bigint: true })) || current.nlink !== 1n) fail('PROBE_FILE_CHANGED', 'Probe report ownership changed.');
      const bytes = Buffer.from(JSON.stringify(report, null, 2)); if (bytes.length > 128 * 1024) fail('PROBE_RESOURCE_LIMIT', 'Probe report exceeded its limit.');
      for (let offset = 0; offset < bytes.length;) { const part = await reportHandle.write(bytes, offset, bytes.length - offset, offset); if (!part.bytesWritten) fail('PROBE_IO', 'Report write did not advance.'); offset += part.bytesWritten; }
      await reportHandle.truncate(bytes.length); await reportHandle.sync();
    };
    const write = async (name, bytes) => {
      await safeDirectory(); const file = path.join(directory, name), handle = await fs.open(file, 'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const receipt = await seal(file, 32 * 1024 * 1024); report.artifacts.push(receipt); return receipt;
    };
    const invoke = async (kind, executable, argv, options = {}) => {
      interrupted(controller.signal); await safeDirectory(); await storage(0);
      if (report.invocations.length >= 3 || !Object.values(this.#runtime).includes(executable)) fail('INVALID_NATIVE_PROBE', 'Only the fixed three-child probe sequence is allowed.');
      const before = await seal(executable, 512 * 1024 * 1024);
      const runtimeName = executable === this.#runtime.ffmpeg ? 'ffmpeg' : 'ffprobe';
      if (before.sha256 !== ticket.plan.policy[`${runtimeName}Sha256`]) fail('CAPABILITY_STALE', 'Executable bytes changed before launch.');
      const input = argv[argv.indexOf('-i') + 1], inputReceipt = report.artifacts.find(item => item.file === input);
      if (!inputReceipt) fail('INVALID_NATIVE_PROBE', 'A probe input was not created and sealed by this invocation.');
      await stable(inputReceipt);
      const entry = { kind, invocationId: kind === 'encode' ? ticket.plan.invocationId : randomUUID(), executable,
        executableSha256: before.sha256, argv, argvSha256: sha(JSON.stringify(argv)), status: 'running', startedAt: Date.now() };
      report.invocations.push(entry); await save();
      let started = false, childClosed, child, closePromise;
      const stage = kind === 'encode' ? 'encode' : 'decode';
      try {
        const result = await this.#run(executable, argv, { signal: controller.signal, timeoutMs: kind === 'encode' ? ticket.plan.limits.encodeTimeoutMs
          : kind === 'metadata' ? ticket.plan.limits.metadataTimeoutMs : ticket.plan.limits.decodeTimeoutMs,
          stdoutLimit: ticket.plan.limits.stdoutBytes, stderrLimit: ticket.plan.limits.stderrBytes, ...options,
          onChild: owned => {
            if (started || !owned || typeof owned.once !== 'function') fail('PROBE_CHILD_INVALID', 'Runner supplied an invalid or duplicate child handle.');
            child = owned; started = true; lifecycle[stage] = 'running';
            closePromise = new Promise(resolve => { childClosed = resolve; }); childClosures.add(closePromise);
            const stopChild = () => { try { child.kill(); } catch { /* child closure remains required */ } };
            controller.signal.addEventListener('abort', stopChild, { once: true });
            owned.once('close', (code, closedSignal) => { controller.signal.removeEventListener('abort', stopChild); entry.close = { code, signal: closedSignal }; lifecycle[stage] = 'closed'; childClosed(); childClosures.delete(closePromise); });
            if (controller.signal.aborted) stopChild();
          } });
        // Even a faulty injected runner cannot create a receipt by resolving
        // before its owned child's close. The actual runner has this guarantee.
        if (!started) fail('PROBE_CHILD_UNOBSERVED', 'Runner did not expose an owned child lifecycle.');
        await closePromise;
        if (result.exitCode !== 0 || entry.close.code !== 0) fail('PROBE_PROCESS_FAILED', 'Probe child did not exit successfully.');
        if (result.stdoutCapture?.truncated === true) fail('PROBE_CAPTURE_INCOMPLETE', 'Truncated stdout cannot establish complete qualification evidence.');
        const captured = result.stderrCapture;
        if (typeof result.stderr !== 'string' || !captured || captured.truncated !== false || captured.totalBytes !== Buffer.byteLength(result.stderr)
            || captured.totalBytes > ticket.plan.limits.stderrBytes) fail('PROBE_CAPTURE_INCOMPLETE', 'Complete native stderr is required for qualification.');
        entry.stderr = await write(`${kind}.stderr.txt`, result.stderr); entry.stderrCapture = captured;
        if (kind === 'metadata') entry.stdout = await write('metadata.json', result.stdout);
        const warningLines = result.stderr.split(/\r?\n/).filter(line => /\[(warning|error|fatal|panic)\]|\b(?:warning|error|failed)\b/i.test(line));
        // The owned raw fixture has exact byte length, frame size and cadence;
        // this one demuxer estimate does not invalidate those independent facts.
        entry.explainedWarnings = kind === 'encode' ? warningLines.filter(line => /^\[in#0\/rawvideo @ [a-f0-9]+\] (?:\[warning\] )?Estimating duration from bitrate, this may be inaccurate$/i.test(line)) : [];
        entry.warningCount = kind === 'encode' ? warningLines.length - entry.explainedWarnings.length : result.stderr.trim() ? 1 : 0;
        entry.status = 'closed'; return result;
      } catch (error) {
        // A collector/pipe failure must not orphan a process even if an
        // injected wrapper violates runTool's close-before-reject contract.
        if (started && !entry.close) { try { child.kill(); } catch { /* retain ownership until close */ } await closePromise; }
        entry.status = 'failed'; entry.error = { code: error.code || 'PROBE_PROCESS_FAILED', message: String(error.message).slice(0, 1024) };
        const captured = boundedToolStderr(error, ticket.plan.limits.stderrBytes);
        entry.stderr = await write(`${kind}.failed-stderr.txt`, captured.stderr); entry.stderrCapture = captured.stderrCapture || null;
        throw error;
      } finally { entry.finishedAt = Date.now(); await stable(inputReceipt); await save(); }
    };
    try {
      slot = await this.#slot({ signal: controller.signal, purpose: 'native-backend-capability' });
      if (!slot || typeof slot.release !== 'function') fail('INVALID_NATIVE_PROBE', 'Main media admission did not return an owned release handle.');
      interrupted(controller.signal);
      const before = await this.#observe({ signal: controller.signal }); beforeEnvironment = before; this.#registry.observeDiscovery(before);
      const current = this.#registry.getCell(request);
      if (current.state === 'stale') fail('CAPABILITY_STALE', 'Device/runtime changed; choose its newly bound capability cell.');
      // Retesting revokes this cell's old verification before checking actual
      // binaries/resources. A newly discovered hash mismatch must not leave a
      // previously verified cell usable merely because no child was launched.
      ticket = this.#registry.beginProbe(request); report.probeId = ticket.plan.probeId; report.plan = ticket.plan;
      await storage(PROBE_FORECAST);
      // Verify actual executable bytes, not a version string or renderer path.
      for (const name of ['ffmpeg', 'ffprobe']) {
        const binary = await seal(this.#runtime[name], 512 * 1024 * 1024);
        if (binary.sha256 !== current.policy[`${name}Sha256`]) fail('CAPABILITY_STALE', 'The fixed binary does not match discovery.');
      }
      directory = path.join(this.#root, `native-probe-${ticket.plan.probeId}`); await fs.mkdir(directory);
      directoryIdentity = await fs.lstat(directory, { bigint: true }); await safeDirectory();
      reportHandle = await fs.open(path.join(directory, 'report.json'), 'wx+'); reportIdentity = await reportHandle.stat({ bigint: true });
      const frameBytes = numericProbeFrame(ticket.plan.policy.bitDepth, 0).length;
      const raw = Buffer.concat(Array.from({ length: FRAMES }, (_, index) => numericProbeFrame(ticket.plan.policy.bitDepth, index)));
      const fixture = await write('fixture.yuv', raw); report.fixture = fixture;
      const output = path.join(directory, 'encoded.mkv'), contribution = ticket.plan.contribution;
      const args = ['-hide_banner', '-loglevel', 'level+verbose', '-nostdin', '-n', '-xerror', '-protocol_whitelist', 'file,pipe',
        ...contribution.deviceArgs, '-f', 'rawvideo', '-pixel_format', ticket.plan.fixture.pixelFormat, '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', String(FPS), '-i', fixture.file,
        '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709,${contribution.uploadFilters.join(',')}`,
        ...contribution.args, '-color_range:v:0', 'tv', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-colorspace:v:0', 'bt709',
        '-fps_mode', 'passthrough', '-frames:v', String(FRAMES), '-fs', String(ticket.plan.limits.maxOutputBytes), '-f', 'matroska', output];
      report.status = 'running';
      const encoded = await invoke('encode', this.#runtime.ffmpeg, args);
      const encodedReceipt = await seal(output, ticket.plan.limits.maxOutputBytes); if (!encodedReceipt.bytes) fail('PROBE_OUTPUT_MISMATCH', 'Encoder produced an empty output.');
      report.artifacts.push(encodedReceipt); report.output = encodedReceipt;
      const metadata = await invoke('metadata', this.#runtime.ffprobe, ['-v', 'warning', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_frames', '-show_format', '-of', 'json', '-i', output]);
      outputValidation = validateMetadata(metadata.stdout, ticket.plan);
      let pending = Buffer.alloc(0), count = 0, totalBytes = 0;
      const decoded = await invoke('decode', this.#runtime.ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-xerror', '-protocol_whitelist', 'file,pipe',
        '-noautorotate', '-i', output, '-map', '0:v:0', '-an', '-sn', '-dn', '-c:v', 'rawvideo', '-pix_fmt', `+${ticket.plan.fixture.pixelFormat}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'],
      { stdoutLimit: frameBytes * FRAMES + 1, onStdoutChunk: chunk => {
        if (!Buffer.isBuffer(chunk)) fail('PROBE_CAPTURE_INCOMPLETE', 'Binary decode callback must receive bytes.');
        totalBytes += chunk.length; if (totalBytes > frameBytes * FRAMES) fail('PROBE_OUTPUT_MISMATCH', 'Decode contains excess frames or bytes.');
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= frameBytes) {
          if (decodedFrameId(pending.subarray(0, frameBytes), ticket.plan.policy.bitDepth) !== count) fail('PROBE_OUTPUT_MISMATCH', 'Decode dropped, duplicated or reordered presentation frames.');
          count++; pending = pending.subarray(frameBytes);
        }
      } });
      if (count !== FRAMES || pending.length || decoded.stdout !== '' || decoded.stdoutCapture?.streamed !== true || decoded.stdoutCapture.truncated !== false
          || decoded.stdoutCapture.totalBytes !== totalBytes) fail('PROBE_CAPTURE_INCOMPLETE', 'Complete binary decode and exact callback accounting are required.');
      report.decoded = { frames: count, bytes: totalBytes, everyFrameIdentityMatched: true };
      if (report.invocations.some(entry => entry.warningCount > 0)) fail('PROBE_WARNINGS_UNREVIEWED', 'Probe warnings require scoped review before qualification.');
      const entry = report.invocations[0];
      const receipt = this.#collector.captureClosed({ plan: ticket.plan, before: beforeEnvironment,
        invocation: this.#nativeInvocation(entry), source: { file: report.fixture.file, sha256: report.fixture.sha256 },
        stderr: encoded.stderr, stderrCapture: encoded.stderrCapture });
      // Custom main observers may withhold this receipt, but cannot replace its
      // captured evidence with a plain summary or query a destroyed component.
      nativeReceipt = await this.#native({ receipt, plan: ticket.plan, invocation: entry, stderr: encoded.stderr, signal: controller.signal });
      interrupted(controller.signal);
      for (const receipt of report.artifacts) if (JSON.stringify(await seal(receipt.file, 32 * 1024 * 1024)) !== JSON.stringify(receipt)) fail('PROBE_FILE_CHANGED', 'Owned evidence changed after observation.');
    } catch (error) { failure = error; }
    try {
      await Promise.all([...childClosures]);
      if (ticket) {
        if (failure) {
          report.failure = { code: failure.code || 'PROBE_INTERRUPTED', message: String(failure.message).slice(0, 1024) };
        }
        let environment;
        // Cancellation does not launch discovery work. The abandon closure
        // releases only after closed children, without manufacturing freshness.
        if (!controller.signal.aborted) try {
          environment = await this.#observe({ signal: controller.signal });
          for (const name of ['ffmpeg', 'ffprobe']) {
            const binary = await seal(this.#runtime[name], 512 * 1024 * 1024);
            if (binary.sha256 !== environment.runtime[name]?.sha256) fail('CAPABILITY_STALE', 'Fresh discovery does not identify the actual executable.');
          }
        } catch (error) { failure ||= error; report.failure ||= { code: error.code || 'PROBE_INTERRUPTED', message: String(error.message).slice(0, 1024) }; }
        if (!failure && environment && !controller.signal.aborted) try {
          const { observation, ...validation } = validateNativeObservation(nativeReceipt, { collector: this.#collector,
            plan: ticket.plan, invocation: this.#nativeInvocation(report.invocations[0]),
            source: { file: report.fixture.file, sha256: report.fixture.sha256 }, after: environment });
          report.nativeObservation = observation; nativeValidation = validation;
        } catch (error) { failure = error; report.failure = { code: error.code || 'PROBE_EVIDENCE_UNOBSERVED', message: String(error.message).slice(0, 1024) }; }
        const reason = controller.signal.aborted ? 'CANCELLED' : failure?.code === 'PROBE_RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'PROBE_INTERRUPTED';
        const unavailable = { PROBE_OUTPUT_MISMATCH: 'OUTPUT_MISMATCH', PROBE_MODE_MISMATCH: 'MODE_MISMATCH', PROBE_DEVICE_MISMATCH: 'DEVICE_MISMATCH' }[failure?.code];
        if (!environment || controller.signal.aborted) report.cell = ticket.abandon({ reason, lifecycle });
        else {
          const outcome = !failure ? 'verified' : unavailable ? 'unavailable' : 'untested';
          const receipt = ticket.issueReceipt({ outcome, reason: !failure ? 'VERIFIED' : unavailable || (failure.code === 'PROBE_RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'NOT_TESTED'),
            evidenceId: report.evidenceId, environment, lifecycle,
            validation: failure ? null : { invocationId: ticket.plan.invocationId, contributionHash: ticket.plan.contributionHash,
              argvSha256: report.invocations[0].argvSha256, fixtureSha256: report.fixture.sha256,
              warningCaptureComplete: true, unexpectedWarnings: 0, ...nativeValidation, output: outputValidation } });
          report.cell = this.#registry.completeProbe({ probeId: ticket.plan.probeId, receipt });
        }
      } else report.cell = this.#registry.getCell(request);
      report.status = report.cell.state; report.reason = report.cell.reason;
    } catch (error) {
      failure ||= error;
      if (ticket && this.#registry.snapshot().activeProbeId === ticket.plan.probeId) report.cell = ticket.abandon({ reason: 'PROBE_INTERRUPTED', lifecycle });
      else report.cell = this.#registry.getCell(request);
      report.status = report.cell.state; report.reason = error.code || 'PROBE_INTERRUPTED';
      report.failure ||= { code: error.code || 'PROBE_INTERRUPTED', message: String(error.message).slice(0, 1024) };
    } finally {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      try { report.finishedAt = Date.now(); if (directory) { report.ownedRootBytes = await storage(0); await save(); } }
      catch (error) { report.persistenceFailure = { code: error.code || 'PROBE_IO', message: String(error.message).slice(0, 1024) }; }
      await reportHandle?.close().catch(error => { report.persistenceFailure ||= { code: error.code || 'PROBE_IO', message: String(error.message).slice(0, 1024) }; });
      try { await slot?.release(); } catch (error) { report.slotReleaseFailure = String(error.message).slice(0, 1024); }
      if (this.#active === active) this.#active = null;
    }
    if (failure && !report.failure) report.failure = { code: failure.code || 'PROBE_INTERRUPTED', message: String(failure.message).slice(0, 1024) };
    return report;
  }
  #nativeInvocation(entry) {
    return { kind: entry.kind, invocationId: entry.invocationId, executableSha256: entry.executableSha256,
      argv: entry.argv, argvSha256: entry.argvSha256, close: entry.close };
  }
}

module.exports = { NativeBackendProbe, numericProbeFrame, decodedFrameId, validateMetadata, qsvRuntimeSettings, validateNativeObservation };
