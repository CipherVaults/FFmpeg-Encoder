'use strict';
// Linux-only composition, not a replacement for the shared remux verifier.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const { getRemuxAssessmentSource } = require('../src/remux-contract.cjs');
const { runTool, ToolError } = require('../src/process-runner.cjs');
const { PINS, verifyTool } = require('./runtime.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const RUNTIME_ID = sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(key => ({ sizeBytes: PINS[key].size, sha256: PINS[key].sha256 }))));
// These hashes identify retained local corrections; their source is NOT copied
// here. A clone without them must refuse remux, not silently run older guards.
const SOURCE_PINS = Object.freeze({
  'src/operation-runtime.cjs': '177f139bc1913051f9754673a21dd2ecb60f5dcba38f91785f84ab56d8159b1c',
  'src/remux-operation.cjs': '6adc49a4b26c5cc5d98f08724c3969c58351dedf781d8a8ad13581c78d6bd258',
  'src/remux-native-cues.cjs': '93c30683ba9cb5efa6b1537f86b759ddaf84a9562d98d67a964ff5bb110a06cd',
});
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000,
  maxFrameBytes: 8 * 1024 * 1024, maxPcmBytes: 128 * 1024 * 1024,
  maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const POLICY_ID = 'blue-linux-remux-short-preview-v2';
const fail = (code, message) => { throw new ToolError(code, message); };
async function checkRemuxSources(root = path.resolve(__dirname, '..')) {
  const missing = [];
  for (const [file, expected] of Object.entries(SOURCE_PINS)) {
    try {
      const full = path.join(root, file), stat = await fs.lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || sha(await fs.readFile(full)) !== expected) missing.push(file);
    } catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; missing.push(file); }
  }
  return Object.freeze({ available: missing.length === 0, missing: Object.freeze(missing) });
}
function requirePreviewSource(assessment, input) {
  const source = getRemuxAssessmentSource(assessment);
  const audio = source.streams.filter(stream => stream.codec_type === 'audio');
  const retainedAac = assessment.target === 'mp4' && audio.length === 1
    && audio[0].codec_name === 'aac' && audio[0].profile === 'LC'
    && audio[0].sample_fmt === 'fltp' && ['44100', '48000'].includes(audio[0].sample_rate)
    && (audio[0].channels === 1 && audio[0].channel_layout === 'mono'
      || audio[0].channels === 2 && audio[0].channel_layout === 'stereo');
  const videoOnlyMkv = assessment.target === 'matroska' && audio.length === 0;
  // Add a deliberately small Linux envelope on top of all shared native checks.
  // AAC-to-MKV is intentionally refused: retained evidence lost priming/timing.
  if (typeof input !== 'string' || path.extname(input).toLowerCase() !== '.mp4' || assessment.inputFamily !== 'isobmff' || !(videoOnlyMkv || retainedAac)
      || assessment.request.omissionRequestIds.length || source.chapters.length
      || source.streams.length !== 1 + audio.length
      || source.streams.some(s => !['video', 'audio'].includes(s.codec_type))
      || source.streams.filter(s => s.codec_type === 'video').length !== 1
      || !(Number(source.format.duration) > 0 && Number(source.format.duration) <= 60)
      || !(Number(source.format.size) > 0 && Number(source.format.size) <= 128 * 1024 * 1024)) {
    fail('LINUX_REMUX_ENVELOPE', 'Linux Remux preview requires Full MP4 input: video-only to MKV, or one retained AAC-LC 44.1/48kHz mono/stereo track to MP4. No omissions/chapters; up to 60 seconds and 128 MiB.');
  }
  // Shared sourcePolicy independently enforces SDR H264, geometry, cadence,
  // audio formats, relationships, orientation and native admission.
}
class PreviewRemuxOperations extends RemuxOperations {
  prepare(options) { requirePreviewSource(options.assessment, options.input); return super.prepare(options); }
}
function createRemuxRunner({ onChild, verify = verifyTool, execute = runTool } = {}) {
  return async (executable, args, options = {}) => {
    const kind = Object.keys(PINS).find(key => PINS[key].path === executable);
    if (!kind) fail('LINUX_REMUX_TOOL', 'Remux requires its fixed Linux tool pair.');
    // Called only through the existing main-owned observer, which validates
    // inert argv/options, owns children, and retains every sink/callback.
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 600000)
      fail('LINUX_REMUX_LIMIT', 'Remux requires a positive limit no greater than ten minutes.');
    await verify(kind);
    if (options.signal?.aborted) fail('CANCELLED', 'Remux cancelled.');
    const copying = kind === 'ffmpeg' && args[args.indexOf('-c') + 1] === 'copy' && typeof options.onProgress === 'function';
    let ended = false;
    const result = await execute(executable, args, { ...options,
      onChild(child) { options.onChild?.(child); onChild?.(child); },
      ...(copying ? { onProgress(record) { ended ||= record.ended === true; options.onProgress(record); } } : {}) });
    if (copying && (result.exitCode !== 0 || !ended)) fail('LINUX_REMUX_INCOMPLETE', 'Stream copy closed without confirmed terminal progress.');
    return result;
  };
}
async function createRemuxControls({ stateDir, onChild } = {}) {
  const status = await checkRemuxSources();
  if (!status.available) return { status, controls: {} };
  const runtime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(PINS).map(([key, value]) => [key, value.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([key, value]) => [key, { sizeBytes: value.size, sha256: value.sha256 }])),
    run: createRemuxRunner({ onChild }),
  });
  return { status, controls: {
    remuxOperations: new PreviewRemuxOperations({ runtimeIdentity: RUNTIME_ID, policyIdentity: POLICY_ID,
      policies: [{ id: 'blue-linux-isobmff-matroska-preview-v1', inputFamily: 'isobmff', target: 'matroska',
        runtimeIdentity: RUNTIME_ID, evidenceIds: ['blue-linux-remux-2JIh4F:reviewed-video-and-lifecycle'],
        allowAncillary: false, allowRotation90: false, verificationMethod: 'packet-identity-v1' },
      { id: 'blue-linux-isobmff-mp4-aac-preview-v1', inputFamily: 'isobmff', target: 'mp4',
        runtimeIdentity: RUNTIME_ID, evidenceIds: ['blue-linux-aac-u50FPp:reviewed-four-formats-and-cancel'],
        allowAncillary: false, allowRotation90: false, verificationMethod: 'packet-identity-v1' }] }),
    operationRuntime: runtime, operationEvidenceBudget: BUDGET, operationDeadlineMs: 600000,
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
  } };
}
module.exports = { RUNTIME_ID, SOURCE_PINS, checkRemuxSources, requirePreviewSource, createRemuxRunner, createRemuxControls };
