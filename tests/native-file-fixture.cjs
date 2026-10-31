'use strict';
// Shared synthetic native file fixture for the service tests (record 37 C3;
// C4 extends it). Injected registry receipts, policy rows and references only:
// no device, child process or media tool runs, and nothing here is hardware,
// source or qualification evidence.
const fsp = require('node:fs/promises'), path = require('node:path'), { createHash, randomUUID } = require('node:crypto');
const { NativeBackendService } = require('../src/native-backend-service.cjs');
const { NativeCapabilityRegistry } = require('../src/backend-capabilities.cjs');
const { NATIVE_PROFILES, getNativeProfile, capabilityKey } = require('../src/backend-adapters.cjs');
const { NativeFileRuntimePair } = require('../src/native-file-runtime-pair.cjs');
const { describeNativeFileSource } = require('../src/native-file-contract.cjs');

const sha = value => createHash('sha256').update(value).digest('hex');

// Synthetic pinned executables: their bytes only feed the full-SHA pins.
async function nativeRuntime(dir) {
  const runtime = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = path.join(dir, name + '.exe'), data = Buffer.from('synthetic ' + name + ' bytes');
    await fsp.writeFile(file, data); runtime[name] = { file, sizeBytes: data.length, sha256: sha(data) };
  }
  return runtime;
}

// A genuine NativeBackendService over a fresh registry. Discovery reports the
// listed devices; the probe mints a verified receipt for the selected cell.
// AMF selections never reach the probe (the service refuses them first).
function nativeBackends(runtime, { devices = ['amf', 'qsv'] } = {}) {
  let now = 1000, initialized = false;
  const ids = { amf: randomUUID(), qsv: randomUUID() }, registry = new NativeCapabilityRegistry({ now: () => now }), calls = { discovery: 0, probe: 0, capture: 0 };
  const device = backend => ({ id: ids[backend], backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086', adapterIndex: backend === 'amf' ? 1 : 2,
    adapterIdentity: `${backend}:luid:00000000:00001234`, driverVersion: '32.0.1.2', runtimeVersion: initialized ? '1.35.0' : 'unresolved' });
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: ++now,
    runtime: Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, { sha256: runtime[name].sha256, version: name + ' version 9.0.2-test' }])),
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(p => [p.encoder, 'present'])), inventory: { status: 'complete', devices: devices.map(device) } });
  const native = new NativeBackendService({ registry,
    discover: async request => { calls.discovery++; if (request.initialization !== undefined) initialized = true; return { registry, environment: environment() }; },
    createProbe: () => ({
      initialize: async () => ({ status: 'observed', initialization: Object.freeze({ testOnly: true }), invocations: [] }),
      probe: async ({ cellId }) => {
        calls.probe++;
        const ticket = registry.beginProbe({ cellId }), p = ticket.plan, profile = getNativeProfile(p.policy.profileId), observed = environment();
        registry.observeDiscovery(observed);
        const receipt = ticket.issueReceipt({ outcome: 'verified', reason: 'VERIFIED', evidenceId: randomUUID(), environment: observed,
          lifecycle: { encode: 'closed', decode: 'closed' }, validation: { invocationId: p.invocationId, contributionHash: p.contributionHash,
            argvSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), warningCaptureComplete: true, unexpectedWarnings: 0, modeSource: 'runtime-log',
            actualMode: p.settings.mode, actualEncoder: profile.encoder, actualAdapterIdentity: p.policy.device.adapterIdentity,
            output: { codec: profile.encodedCodec, bitDepth: p.policy.bitDepth, width: 320, height: 180, frames: 96, decodedFrames: 96,
              chroma: '4:2:0', signal: 'sdr', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv', valid: true } } });
        const cell = registry.completeProbe({ probeId: p.probeId, receipt });
        return { status: 'verified', cell, cellId: cell.cellId, evidenceId: cell.evidenceId };
      } }) });
  const capture = native.captureFileSelection.bind(native);
  native.captureFileSelection = request => { calls.capture++; return capture(request); };
  const selected = () => ({ selectionId: native.snapshot().selection.selectionId, revision: native.snapshot().revision });
  // Select and check exact settings, as "Check these settings" would.
  const choose = async (profileId = 'h264-qsv', bitDepth = 8) => {
    const p = getNativeProfile(profileId);
    native.select({ revision: native.snapshot().revision, profileId, settings: { ...p.operationalSeed, deviceId: ids[p.backend] }, bitDepth });
    await native.qualify(selected());
    return selected();
  };
  return { native, registry, ids, calls, choose, selected };
}

// A 1280x720 H.264 High source inside the native contract (record 37 §3.3).
// `index` changes the probe fingerprint without leaving the contract.
function nativeProbe({ index = 7, frames = 15, size = 4096, edit } = {}) {
  const probe = { streams: [{ index, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1280, height: 720, pix_fmt: 'yuv420p',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', color_primaries: 'bt709', color_transfer: 'bt709',
    color_space: 'bt709', color_range: 'tv', chroma_location: 'left', avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/15360',
    start_pts: 0, start_time: '0.000000', duration_ts: frames * 512, duration: (frames / 30).toFixed(6), nb_frames: String(frames),
    disposition: { default: 1 }, tags: {} }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 1, size: String(size), start_time: '0.000000', duration: (frames / 30).toFixed(6) },
  chapters: [], programs: [], stream_groups: [] };
  edit?.(probe);
  return probe;
}
// What an injected inspector returns for that probe.
const nativeInspection = probe => ({ probe, duration: Number(probe.format.duration),
  color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: probe.streams[0]?.index ?? 0, reasons: [] },
  summary: { selectedVideoIndex: probe.streams[0]?.index ?? 0, codec: probe.streams[0]?.codec_name || null, width: probe.streams[0]?.width || null,
    height: probe.streams[0]?.height || null, bitDepth: 8 } });

// A structurally valid reference: enough for plan-time admission, never validated here.
const syntheticReference = (sourceSha256, id) => ({ version: 1, id: 'synthetic-reference-' + id, contractId: 'native-file-h264-bt709-full-v1', frames: 15,
  source: { fileSha256: sourceSha256, rawSha256: sha('raw ' + id), metadataSha256: sha('meta ' + id), timelineSha256: sha('time ' + id) },
  output: { rawSha256: sha('out raw ' + id), metadataSha256: sha('out meta ' + id), timelineSha256: sha('out time ' + id), templateSha256: sha('tpl ' + id),
    templateManifestSha256: sha('manifest ' + id), templateBytes: 4096 }, proof: { evidenceIds: ['synthetic-reference-proof'], reportSha256: sha('report ' + id) } });

// One exact policy row for the current verified selection and this probe.
function nativePolicy({ runtime, native, probe, id = 'synthetic-test-only', reference = true }) {
  const selection = native.snapshot().selection, sourceBytes = probe.format.size;
  const request = { schema: 1, kind: 'native-file', operation: 'encode', fileId: randomUUID(), identityRevision: 0, draftId: randomUUID(), draftRevision: 0,
    profileId: selection.request.profileId, settings: selection.request.settings, bitDepth: 8, target: 'matroska', resolution: 'source', range: null,
    signal: 'sdr', hdrPolicy: 'sdr', audioPolicy: 'copy', omissionRequestIds: [] };
  const applicability = describeNativeFileSource({ probe, sourceBytes, request }), sourceSha256 = sha('source ' + id);
  if (applicability.status !== 'structurally-eligible-unqualified') throw new Error('The fixture probe is outside the native contract.');
  return { id, contractId: applicability.contractId, runtimeIdentity: new NativeFileRuntimePair(runtime).identity(), sourceSha256,
    sourceProbeFingerprint: applicability.sourceProbeFingerprint, nativeCellKey: capabilityKey(selection.cell.policy),
    profileId: selection.request.profileId, settings: selection.request.settings,
    budget: { maximumChildren: 32, maximumPipeBytes: 128 * 1024 ** 2, deadlineMs: 30000, maximumStageBytes: 1024 ** 2, metadataBytes: 1024 ** 2, nativeStderrBytes: 262144 },
    evidenceIds: ['synthetic-fixture-not-hardware-proof'], ...(reference ? { reference: syntheticReference(sourceSha256, id) } : {}) };
}

module.exports = { sha, nativeRuntime, nativeBackends, nativeProbe, nativeInspection, nativePolicy, syntheticReference };
