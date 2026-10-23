'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { getNativeProfile, validateNativeSettings, NATIVE_PROFILES } = require('./backend-adapters.cjs');

// Main-only raw evidence producers. No process, device initializer, path lookup,
// IPC or execution grant lives here. The caller owns the fixed child and captures
// its complete stderr after close. A record saying "runtime-query" is not proof.
// Synthetic runners/logs test this plumbing; they never establish real hardware.
// Parser rationale (not shipped-binary/hardware acceptance):
// https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavcodec/qsvenc.c
// https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavutil/hwcontext_d3d11va.c
// https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/libavutil/hwcontext_qsv.c
const HASH = /^[a-f0-9]{64}$/;
const MAX_STDERR = 256 * 1024;
const inventories = new WeakMap(), initializations = new WeakMap();
const ASSURANCE = Object.freeze({
  parser: 'ffmpeg-9.0.2-qsv-log-v1',
  device: 'explicit-derived-d3d11-ordinal-and-descriptor-with-complete-pre-post-dxgi',
  runtime: 'derived-device-MFXQueryVersion-API-major-minor; encoder-session-and-DLL-build-not-independently-observed',
  limitations: 'D3D11 logs omit LUID. Binding to unchanged complete DXGI inventories is a bounded inference, not an atomic encoder-handle LUID query or loaded-vendor-DLL hash.',
});
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function record(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('PROBE_EVIDENCE_UNOBSERVED', 'Native evidence must be an inert record.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
      || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('PROBE_EVIDENCE_UNOBSERVED', 'Native evidence has unknown, missing, hidden or accessor fields.');
}
function dense(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail('PROBE_EVIDENCE_UNOBSERVED', 'Native evidence needs a bounded dense list.');
  for (let i = 0; i < value.length; i++) {
    const property = Object.getOwnPropertyDescriptor(value, String(i));
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) fail('PROBE_EVIDENCE_UNOBSERVED', 'Native evidence lists cannot contain accessors or holes.');
  }
}
function pair(runtime, pinned = false) {
  record(runtime, ['ffmpeg', 'ffprobe']);
  return Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => {
    if (runtime[name] === null && !pinned) return [name, null];
    record(runtime[name], ['sha256', 'version']);
    if (typeof runtime[name].sha256 !== 'string' || !HASH.test(runtime[name].sha256)
        || typeof runtime[name].version !== 'string' || !new RegExp(`^${name} version [^\\x00-\\x1f\\x7f]{1,512}$`).test(runtime[name].version)
        || pinned && !new RegExp(`^${name} version 9\\.0\\.2(?:[- ]|$)`).test(runtime[name].version)) {
      fail('PROBE_EVIDENCE_UNOBSERVED', 'Known exact binary/version observations are required; this native parser supports only pinned FFmpeg 9.0.2.');
    }
    return [name, runtime[name].sha256];
  }));
}
function descriptor(row) {
  const fields = ['adapterIndex', 'description', 'luid', 'umdVersion', 'vendorId', 'deviceId', 'backendCandidate', 'software'];
  record(row, [...fields, 'subsystemId', 'revision', 'flags', 'dedicatedVideoBytes', 'driverQueryHresult'], fields);
  if (!Number.isInteger(row.adapterIndex) || row.adapterIndex < 0 || row.adapterIndex > 31
      || typeof row.luid !== 'string' || !/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(row.luid)
      || typeof row.description !== 'string' || row.description.length > 128 || /[\x00-\x1f\x7f]/.test(row.description)
      || !['vendorId', 'deviceId'].every(key => Number.isInteger(row[key]) && row[key] >= 0 && row[key] <= 0xffffffff)
      || typeof row.software !== 'boolean' || !(row.umdVersion === null || typeof row.umdVersion === 'string' && /^\d{1,5}(\.\d{1,5}){3}$/.test(row.umdVersion))) fail('PROBE_EVIDENCE_UNOBSERVED', 'Malformed DXGI descriptor.');
  const backend = row.software ? null : row.vendorId === 0x8086 ? 'qsv' : row.vendorId === 0x1002 ? 'amf' : null;
  if (row.backendCandidate !== backend) fail('PROBE_DEVICE_MISMATCH', 'DXGI vendor and backend disagree.');
  return { adapterIndex: row.adapterIndex, adapterIdentity: `dxgi:${row.luid}`, description: row.description,
    vendorId: row.vendorId, deviceId: row.deviceId, driverVersion: row.umdVersion || 'unresolved', backend };
}
const deviceKey = value => digest({ adapterIdentity: value.adapterIdentity, adapterIndex: value.adapterIndex,
  vendorId: value.vendorId, deviceId: value.deviceId, description: value.description, driverVersion: value.driverVersion, backend: value.backend });

// Called only by main's actual discovery owner. This sidecar retains fields the
// public registry deliberately omits; copied JSON cannot recreate its identity.
function bindDiscoveryInventory(environment, inventory, owner) {
  record(environment, ['schema', 'evidenceId', 'observedAt', 'runtime', 'wrappers', 'inventory']);
  record(environment.inventory, ['status', 'devices']); dense(environment.inventory.devices, 32);
  record(environment.wrappers, NATIVE_PROFILES.map(profile => profile.encoder));
  for (const device of environment.inventory.devices) record(device,
    ['id', 'backend', 'vendorId', 'adapterIndex', 'adapterIdentity', 'driverVersion', 'runtimeVersion']);
  record(inventory, ['status', 'adapters', 'source', 'driverVersionScope', 'reason', 'diagnostic'], ['status', 'adapters']);
  if (!['complete', 'partial', 'unavailable'].includes(inventory.status) || !owner || typeof owner !== 'object') fail('PROBE_EVIDENCE_UNOBSERVED', 'Discovery ownership/status is missing.');
  dense(inventory.adapters, 32);
  const rows = inventory.adapters.map(descriptor);
  if (rows.some((row, index) => row.adapterIndex !== index) || new Set(rows.map(row => row.adapterIdentity)).size !== rows.length
      || environment.inventory.status !== inventory.status) fail('PROBE_EVIDENCE_UNOBSERVED', 'DXGI order, identity or status is ambiguous.');
  const binaries = pair(environment.runtime);
  for (const row of rows.filter(item => item.backend)) {
    const device = environment.inventory.devices.find(item => item.adapterIdentity === row.adapterIdentity);
    if (!device || device.backend !== row.backend || device.adapterIndex !== row.adapterIndex
        || device.vendorId !== '0x' + row.vendorId.toString(16).padStart(4, '0') || device.driverVersion !== row.driverVersion) fail('PROBE_DEVICE_MISMATCH', 'The raw descriptor is not this discovery device.');
  }
  const value = freeze({ status: inventory.status, evidenceId: environment.evidenceId, observedAt: environment.observedAt,
    binaries, rows, devices: environment.inventory.devices.map(item => ({ ...item })) });
  inventories.set(environment, { owner, value }); return freeze(environment);
}
function inventory(environment) {
  const result = environment && typeof environment === 'object' && inventories.get(environment);
  if (!result || result.value.status !== 'complete') fail('PROBE_EVIDENCE_UNOBSERVED', 'Complete main-owned raw DXGI evidence is required; a JSON snapshot or partial inventory is insufficient.');
  return result;
}
function freshPair(before, after) {
  const first = inventory(before), last = inventory(after);
  // Discovery can describe unavailable/other runtimes without harming ordinary
  // startup. Only native parsing demands this exact supported source dialect.
  pair(before.runtime, true); pair(after.runtime, true);
  if (first.owner !== last.owner || first.value.evidenceId === last.value.evidenceId
      || !Number.isSafeInteger(first.value.observedAt) || !Number.isSafeInteger(last.value.observedAt)
      || last.value.observedAt < first.value.observedAt || !same(first.value.binaries, last.value.binaries)) fail('PROBE_EVIDENCE_UNOBSERVED', 'Fresh paired observations must have the same owner and exact binaries.');
  return [first, last];
}
function cleanCapture(stderr, capture) {
  record(capture, ['totalBytes', 'truncated']);
  if (typeof stderr !== 'string' || Buffer.byteLength(stderr) > MAX_STDERR || capture.truncated !== false
      || capture.totalBytes !== Buffer.byteLength(stderr) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(stderr)) fail('PROBE_EVIDENCE_UNOBSERVED', 'Complete bounded native stderr is required.');
}
function closedInvocation(value, kind) {
  record(value, ['kind', 'invocationId', 'executableSha256', 'argv', 'argvSha256', 'close']);
  record(value.close, ['code', 'signal']); dense(value.argv, 8192);
  if (value.kind !== kind || typeof value.invocationId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.invocationId)
      || typeof value.executableSha256 !== 'string' || !HASH.test(value.executableSha256)
      || value.argv.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 32767)
      || Buffer.byteLength(JSON.stringify(value.argv)) > 1024 * 1024 || digest(value.argv) !== value.argvSha256
      || value.close.code !== 0 || value.close.signal !== null) fail('PROBE_EVIDENCE_UNOBSERVED', 'The actual fixed invocation, argument digest and successful child closure are required.');
  return freeze({ ...value, argv: value.argv.slice(), close: { ...value.close } });
}
function scopedRows(stderr, scope) {
  return stderr.split(/\r?\n/).flatMap(line => {
    const match = line.match(new RegExp(`^\\[${scope} @ ([a-fA-F0-9]+)\\] (?:\\[(?:verbose|info)\\] )?(.*)$`));
    return match ? [{ context: match[1].toLowerCase(), text: match[2] }] : [];
  });
}
function qsvRuntimeSettings(stderr, encoder) {
  if (!['h264_qsv', 'hevc_qsv', 'av1_qsv'].includes(encoder) || typeof stderr !== 'string' || Buffer.byteLength(stderr) > MAX_STDERR) return null;
  const rows = scopedRows(stderr, encoder), relevant = rows.filter(row => /TargetUsage|RateControlMethod|QPI|QPP|QPB|ICQQuality|Unsupported ratecontrol/i.test(row.text));
  const rawRelevant = stderr.split(/\r?\n/).filter(line => line.startsWith(`[${encoder} @ `)
    && /TargetUsage|RateControlMethod|QPI|QPP|QPB|ICQQuality|Unsupported ratecontrol/i.test(line));
  if (rawRelevant.length !== relevant.length) return null;
  const modeRows = relevant.filter(row => /^TargetUsage: \d+; RateControlMethod: [A-Z_]+$/.test(row.text));
  if (modeRows.length !== 1 || new Set(relevant.map(row => row.context)).size !== 1) return null;
  const match = modeRows[0].text.match(/^TargetUsage: (\d+); RateControlMethod: ([A-Z_]+)$/);
  const preset = ['veryslow', 'slower', 'slow', 'medium', 'fast', 'faster', 'veryfast'][Number(match[1]) - 1] || null;
  const mode = match[2].toLowerCase(), pattern = mode === 'cqp' ? /^QPI: (\d+); QPP: (\d+); QPB: (\d+)$/ : mode === 'icq' ? /^ICQQuality: (\d+)$/ : null;
  if (!pattern) return relevant.length === 1 ? { mode, preset, quality: null } : null;
  const qualityRows = relevant.filter(row => pattern.test(row.text));
  if (relevant.length !== 2 || qualityRows.length !== 1) return null;
  const quality = qualityRows[0].text.match(pattern);
  return { mode, preset, quality: mode === 'cqp' ? { i: Number(quality[1]), p: Number(quality[2]), b: Number(quality[3]) } : Number(quality[1]) };
}
function qsvDevice(stderr, selected) {
  const rows = scopedRows(stderr, 'AVHWDeviceContext');
  const rawRelevant = stderr.split(/\r?\n/).filter(line => line.startsWith('[AVHWDeviceContext @ ')
    && /Selecting d3d11va adapter|Using device|Initialize MFX session: implementation version/i.test(line));
  if (rawRelevant.length !== rows.filter(row => /Selecting d3d11va adapter|Using device|Initialize MFX session: implementation version/i.test(row.text)).length) fail('PROBE_EVIDENCE_UNOBSERVED', 'Malformed native device/version context.');
  const selections = rows.filter(row => /Selecting d3d11va adapter/i.test(row.text));
  const devices = rows.filter(row => /Using device/i.test(row.text));
  const versions = rows.filter(row => /Initialize MFX session: implementation version/i.test(row.text));
  if (selections.length !== 1 || devices.length !== 1 || versions.length !== 1) fail('PROBE_EVIDENCE_UNOBSERVED', 'Exactly one actual D3D11 selection/device and queried QSV API version are required.');
  const index = selections[0].text.match(/^Selecting d3d11va adapter (\d+)$/);
  const device = devices[0].text.match(/^Using device ([a-fA-F0-9]{4}):([a-fA-F0-9]{4}) \(([^\r\n]*)\)\.$/);
  const version = versions[0].text.match(/^Initialize MFX session: implementation version is (\d{1,3})\.(\d{1,3})$/);
  if (!index || !device || !version || selections[0].context !== devices[0].context
      || versions[0].context === devices[0].context || !Number(version[1])) fail('PROBE_EVIDENCE_UNOBSERVED', 'Malformed or ambiguous device/API-version contexts.');
  if (Number(index[1]) !== selected.adapterIndex || parseInt(device[1], 16) !== selected.vendorId
      || parseInt(device[2], 16) !== selected.deviceId || device[3] !== selected.description) fail('PROBE_DEVICE_MISMATCH', 'The actual logged adapter differs from the selected DXGI descriptor.');
  if (/Initialized an internal MFX session|software implementation|try next mfx implementation|AMF|D3D9|DXVA2|Vulkan/i.test(stderr)) fail('PROBE_EVIDENCE_UNOBSERVED', 'An internal, alternate or fallback device path cannot prove the explicit derived QSV pipeline.');
  return `mfx-api:${Number(version[1])}.${Number(version[2])}`;
}
function explicitDeviceArgs(args, selected) {
  const values = name => args.flatMap((arg, index) => arg === name ? [args[index + 1]] : []);
  if (!same(values('-init_hw_device'), [`d3d11va=ffenc_d3d:${selected.adapterIndex}`, 'qsv=ffenc_qsv@ffenc_d3d'])
      || !same(values('-filter_hw_device'), ['ffenc_qsv'])) fail('PROBE_EVIDENCE_UNOBSERVED', 'Only the fixed explicit derived D3D11/QSV path is observed by this parser.');
}
function selectedDescriptor(before, device) {
  const observed = inventory(before), row = observed.value.rows.find(item => item.adapterIdentity === device.adapterIdentity);
  const bound = observed.value.devices.find(item => item.id === device.id);
  if (!row || !bound || !same(bound, device) || row.backend !== 'qsv' || row.driverVersion === 'unresolved') fail('PROBE_DEVICE_MISMATCH', 'The selected current QSV device/driver is not resolved by this main owner.');
  return row;
}

// Explicit bootstrap handoff only. Main may capture a separately authorized,
// closed initialization child's raw output. This grants a scoped API observation,
// never codec/RC support, and starts no startup work itself.
function nativeInitializationArgs(environment, deviceId) {
  const observed = inventory(environment); pair(environment.runtime, true);
  const device = observed.value.devices.find(item => item.id === deviceId);
  if (!device) fail('NATIVE_DEVICE_UNAVAILABLE', 'No current selected vendor device is observed.');
  if (device.backend === 'amf') fail('AMF_EFFECTIVE_PROPERTIES_UNOBSERVED', 'The pinned AMF CLI has no complete same-component effective-property/runtime readback producer.');
  const selected = selectedDescriptor(environment, device);
  return Object.freeze(['-hide_banner', '-loglevel', 'level+verbose', '-nostdin', '-nostats', '-n', '-xerror',
    '-protocol_whitelist', 'file,pipe', '-init_hw_device', `d3d11va=ffenc_d3d:${selected.adapterIndex}`,
    '-init_hw_device', 'qsv=ffenc_qsv@ffenc_d3d', '-filter_hw_device', 'ffenc_qsv',
    '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1', '-map', '0:v:0', '-frames:v:0', '0',
    '-an', '-sn', '-dn', '-c:v:0', 'wrapped_avframe', '-threads:v:0', '1', '-f', 'null', 'pipe:1']);
}
function captureNativeInitialization({ before, after, invocation, stderr, stderrCapture, deviceId }) {
  const [first, last] = freshPair(before, after), executed = closedInvocation(invocation, 'initialization'); cleanCapture(stderr, stderrCapture);
  const device = first.value.devices.find(item => item.id === deviceId);
  if (!device) fail('PROBE_DEVICE_MISMATCH', 'Choose a current main-owned device.');
  if (device.backend === 'amf') fail('AMF_EFFECTIVE_PROPERTIES_UNOBSERVED', 'The pinned AMF CLI has no complete same-component effective-property/runtime readback producer.');
  const selected = selectedDescriptor(before, device), current = last.value.rows.find(item => item.adapterIdentity === selected.adapterIdentity);
  const currentDevice = last.value.devices.find(item => item.id === device.id);
  if (!current || !currentDevice || currentDevice.adapterIdentity !== device.adapterIdentity
      || deviceKey(current) !== deviceKey(selected) || executed.executableSha256 !== first.value.binaries.ffmpeg) fail('PROBE_DEVICE_MISMATCH', 'Initialization device handle, driver or executable changed.');
  explicitDeviceArgs(executed.argv, selected);
  if (!same(executed.argv, nativeInitializationArgs(before, deviceId))) fail('PROBE_EVIDENCE_UNOBSERVED', 'Only the fixed zero-frame generated/null initializer invocation can issue a bootstrap receipt.');
  if (/^\[(?:h264|hevc|av1)_qsv @ /m.test(stderr)) fail('PROBE_EVIDENCE_UNOBSERVED', 'Vendor encoder-session logs cannot describe the fixed wrapped_avframe/null initializer.');
  const runtimeVersion = qsvDevice(stderr, selected), receipt = Object.freeze({ schema: 1, evidenceId: randomUUID() });
  initializations.set(receipt, { owner: first.owner, binaries: first.value.binaries, deviceKey: deviceKey(selected),
    deviceId: device.id, afterEvidenceId: last.value.evidenceId,
    adapterIdentity: selected.adapterIdentity, runtimeVersion, assurance: ASSURANCE, invocationId: executed.invocationId,
    argvSha256: executed.argvSha256, stderrSha256: sha(stderr) }); return receipt;
}
function consumeNativeInitialization(receipt, { owner, runtime, inventory: raw, currentDevices }) {
  const observed = receipt && typeof receipt === 'object' && initializations.get(receipt);
  if (!observed) fail('NATIVE_INITIALIZATION_UNTRUSTED', 'Only a current main-captured initialization receipt is accepted.');
  initializations.delete(receipt);
  dense(currentDevices, 32);
  for (const item of currentDevices) record(item, ['id', 'adapterIdentity']);
  if (owner !== observed.owner || typeof owner.snapshot !== 'function' || owner.snapshot().discoveryEvidenceId !== observed.afterEvidenceId
      || !currentDevices.some(item => item.id === observed.deviceId && item.adapterIdentity === observed.adapterIdentity)
      || raw.status !== 'complete' || !same(pair(runtime, true), observed.binaries)) {
    fail('NATIVE_INITIALIZATION_STALE', 'The exact post-initialization observation, current device handle, owner or binaries changed. Rediscovery requires a fresh initializer receipt.');
  }
  dense(raw.adapters, 32);
  const selected = raw.adapters.map(descriptor).find(item => item.adapterIdentity === observed.adapterIdentity);
  if (!selected || deviceKey(selected) !== observed.deviceKey) fail('NATIVE_INITIALIZATION_STALE', 'The initialized adapter/driver changed.');
  return freeze({ ...observed, owner: undefined });
}

class NativeObservationCollector {
  #receipts = new WeakMap();
  captureClosed({ plan, before, invocation, source, stderr, stderrCapture }) {
    const executed = closedInvocation(invocation, 'encode'); cleanCapture(stderr, stderrCapture);
    record(source, ['file', 'sha256']);
    if (typeof source.file !== 'string' || !HASH.test(source.sha256) || executed.argv.filter(arg => arg === '-i').length !== 1
        || executed.argv[executed.argv.indexOf('-i') + 1] !== source.file || executed.invocationId !== plan.invocationId
        || executed.executableSha256 !== plan.policy.ffmpegSha256) fail('PROBE_EVIDENCE_UNOBSERVED', 'Captured source/invocation/binary differs from the original probe.');
    const codecPositions = executed.argv.flatMap((arg, index) => arg === '-c:v:0' ? [index] : []);
    if (codecPositions.length !== 1 || executed.argv[codecPositions[0] + 1] !== plan.contribution.encoder) fail('PROBE_EVIDENCE_UNOBSERVED', 'The executed encoder differs from the original contribution.');
    for (let index = 0; index < plan.contribution.args.length; index += 2) {
      const option = plan.contribution.args[index], positions = executed.argv.flatMap((arg, at) => arg === option ? [at] : []);
      if (positions.length !== 1 || executed.argv[positions[0] + 1] !== plan.contribution.args[index + 1]) fail('PROBE_EVIDENCE_UNOBSERVED', 'The executed native contribution differs from the original probe plan.');
    }
    const receipt = Object.freeze({ schema: 1, evidenceId: randomUUID() });
    this.#receipts.set(receipt, { plan, before, invocation: executed, source: { ...source }, stderr,
      stderrSha256: sha(stderr), contributionHash: plan.contributionHash }); return receipt;
  }
  complete(receipt, { plan, invocation, source, after }) {
    const observed = receipt && typeof receipt === 'object' && this.#receipts.get(receipt);
    if (!observed) fail('PROBE_EVIDENCE_UNOBSERVED', 'Only this collector\'s original one-use captured-child receipt is accepted; JSON and runtime-query summaries are not evidence.');
    this.#receipts.delete(receipt);
    const executed = closedInvocation(invocation, 'encode'); record(source, ['file', 'sha256']);
    if (observed.plan !== plan || observed.contributionHash !== plan.contributionHash || !same(observed.invocation, executed)
        || !same(observed.source, source)) fail('PROBE_EVIDENCE_UNOBSERVED', 'The original plan/invocation/arguments/source changed.');
    if (getNativeProfile(plan.policy.profileId).backend === 'amf') fail('AMF_EFFECTIVE_PROPERTIES_UNOBSERVED', 'The pinned AMF CLI sets encoder properties but exposes no complete same-component effective RC/quality/preset/runtime readback. A separate helper session cannot describe this invocation.');
    const [first, last] = freshPair(observed.before, after), selected = selectedDescriptor(observed.before, plan.policy.device);
    const current = last.value.rows.find(item => item.adapterIdentity === selected.adapterIdentity), currentDevice = last.value.devices.find(item => item.id === plan.policy.device.id);
    if (!current || deviceKey(current) !== deviceKey(selected) || !same(currentDevice, plan.policy.device)
        || first.value.binaries.ffmpeg !== plan.policy.ffmpegSha256 || first.value.binaries.ffprobe !== plan.policy.ffprobeSha256) fail('PROBE_DEVICE_MISMATCH', 'Current selected device, driver, runtime or binaries changed.');
    explicitDeviceArgs(executed.argv, selected);
    const runtimeVersion = qsvDevice(observed.stderr, selected);
    if (runtimeVersion !== plan.policy.device.runtimeVersion) fail('PROBE_DEVICE_MISMATCH', 'Actual queried API version differs from the selected runtime cell.');
    const encoderBlocks = observed.stderr.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\[((?:h264|hevc|av1)_qsv) @ [a-fA-F0-9]+\] (?:\[verbose\] )?TargetUsage:/);
      return match ? [match[1]] : [];
    });
    if (encoderBlocks.length !== 1) fail('PROBE_EVIDENCE_UNOBSERVED', 'Exactly one observed QSV encoder settings context is required.');
    const encoder = encoderBlocks[0];
    if (encoder !== plan.contribution.encoder) fail('PROBE_DEVICE_MISMATCH', 'The actual logged encoder differs from the selected contribution.');
    const effective = qsvRuntimeSettings(observed.stderr, encoder);
    // An extra effective block for another encoder cannot be hidden by selecting
    // just the desired prefix from a mixed multi-session transcript.
    if (!effective || observed.stderr.split(/\r?\n/).some(line => /^\[(?:h264|hevc|av1)_qsv @ /i.test(line)
        && !line.startsWith(`[${encoder} @ `) && /TargetUsage|RateControlMethod|QPI|ICQQuality/i.test(line))) fail('PROBE_EVIDENCE_UNOBSERVED', 'One complete unambiguous encoder-scoped effective-settings block is required.');
    let normalized;
    try { normalized = validateNativeSettings(plan.policy.profileId, { mode: effective.mode, preset: effective.preset,
      quality: effective.quality, deviceId: plan.settings.deviceId }); }
    catch { fail('PROBE_MODE_MISMATCH', 'The encoder reports an unsupported/substituted native mode, preset or quality.'); }
    if (!same(normalized, plan.settings)) fail('PROBE_MODE_MISMATCH', 'The effective RC mode, native quality or preset differs from the selected settings.');
    return freeze({ modeSource: 'runtime-log', actualMode: effective.mode, actualEncoder: encoder,
      actualAdapterIdentity: selected.adapterIdentity, observation: { schema: 1, evidenceId: receipt.evidenceId,
        invocationId: executed.invocationId, contributionHash: observed.contributionHash, argvSha256: executed.argvSha256,
        fixtureSha256: source.sha256, stderrSha256: observed.stderrSha256, actualQuality: effective.quality, actualPreset: effective.preset,
        runtimeVersion, assurance: ASSURANCE, scope: 'same-child-derived-device-and-effective-encoder-log' } });
  }
}

module.exports = { NativeObservationCollector, qsvRuntimeSettings, bindDiscoveryInventory,
  nativeInitializationArgs, captureNativeInitialization, consumeNativeInitialization, ASSURANCE };
