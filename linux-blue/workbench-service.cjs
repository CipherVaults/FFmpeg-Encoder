'use strict';

// Opt-in Linux composition of the existing workbench, not a second encoder.
const { EncoderService } = require('../src/encoder-service.cjs');
const { runTool, ToolError } = require('../src/process-runner.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { PROFILES } = require('../src/media.cjs');
const { PINS, verifyTool } = require('./runtime.cjs');
const { createRemuxControls, RUNTIME_ID } = require('./workbench-remux.cjs');

const START_MESSAGE = 'Linux CPU preview supports only SDR Full, Keep source, copied audio to a distinct folder. Changed encodes, GPU and HDR remain unavailable. Remux requires the separate verified MP4 preview (video-only to MKV, retained AAC to MP4).';
const ENCODE_LIMIT_MS = 30 * 60 * 1000;
const CPU_ENCODERS = new Set(['copy', 'ffv1', 'libx264', 'libx265', 'libsvtav1']);
const OPTION_KEYS = new Set(['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onProgress']);
const refusal = (code, message) => new ToolError(code, message);

function ordinaryEncodeInvocation(kind, args, options) {
  return kind === 'ffmpeg' && typeof options.onProgress === 'function'
    && args.includes('-n') && args.includes('-nostdin') && args.includes('-i')
    && args[args.indexOf('-progress') + 1] === 'pipe:1'
    && args[args.indexOf('-f') + 1] === 'matroska'
    && PROFILES.some(profile => profile.hardware === 'CPU' && args[args.indexOf('-c:v:0') + 1] === profile.encoder);
}

function validateInvocation(executable, args, options, pins = PINS) {
  const kind = Object.keys(pins).find(key => pins[key].path === executable);
  if (!kind) throw refusal('LINUX_WORKBENCH_TOOL', 'Only the two fixed Linux tools are allowed.');
  if (!Array.isArray(args) || args.length > 512 || args.some(arg => typeof arg !== 'string' || arg.length > 16384 || arg.includes('\0'))) {
    throw refusal('LINUX_WORKBENCH_ARGUMENTS', 'Expected bounded, main-owned tool arguments.');
  }
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(key => !OPTION_KEYS.has(key))
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      || (options.onProgress !== undefined && typeof options.onProgress !== 'function')) {
      throw refusal('LINUX_WORKBENCH_OPTIONS', 'Only bounded workbench options are supported.');
  }
  for (const [key, limit] of [['timeoutMs', 60000], ['stdoutLimit', 16 * 1024 * 1024], ['stderrLimit', 256 * 1024]]) {
    if (key === 'timeoutMs' && options[key] === 0 && ordinaryEncodeInvocation(kind, args, options)) continue;
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key] <= 0 || options[key] > limit)) {
      throw refusal('LINUX_WORKBENCH_OPTIONS', 'Inspection and capability limits must remain positive and bounded.');
    }
  }
  // The original capability checker keeps its canonical encode/probe/decode
  // tests. GPU requests are refused here, before launch, not reported as tested.
  for (let i = 0; i < args.length; i++) {
    if (/^-(?:hwaccel(?:_.*)?|init_hw_device|filter_hw_device)$/.test(args[i])
        || (/^-(?:c|codec)(?::v(?::\d+)?)?$/.test(args[i]) || args[i] === '-vcodec')
          && !CPU_ENCODERS.has(args[i + 1])) {
      throw refusal('LINUX_WORKBENCH_GPU_UNTESTED', 'GPU execution is not tested or enabled in this Linux CPU preview.');
    }
  }
  return kind;
}

// Dependency seams are main-only and used by the unit tests; no IPC exposes
// executable selection, run options, verifier replacement or process handles.
function createWorkbenchRunner({ verify = verifyTool, execute = runTool, onChild, pins = PINS } = {}) {
  return async (executable, args, options = {}) => {
    const kind = validateInvocation(executable, args, options, pins);
    await verify(kind);
    if (options.signal?.aborted) throw refusal('CANCELLED', 'Operation cancelled.');
    const encoding = ordinaryEncodeInvocation(kind, args, options);
    let ended = false;
    const result = await execute(executable, args, { timeoutMs: 30000, stdoutLimit: 16 * 1024 * 1024,
      stderrLimit: 256 * 1024, ...options,
      // Original ordinary service requests unlimited time. Linux makes that
      // request a documented 30-minute-per-file ceiling, never an unlimited job.
      ...(options.timeoutMs === 0 ? { timeoutMs: ENCODE_LIMIT_MS } : {}), onChild,
      ...(encoding ? { onProgress(record) { ended ||= record.ended === true; options.onProgress(record); } } : {}),
      // Apply the shared runner's total-output budget even for progress mode.
      onOutputBytes() {} });
    if (encoding && (result.exitCode !== 0 || !ended)) {
      throw refusal('LINUX_WORKBENCH_INCOMPLETE', 'The CPU encode closed without confirmed terminal progress. No output is approved.');
    }
    return result;
  };
}

// Shared admission predicate only; superclass owns currentness and execution.
function isOrdinaryWorkbenchEntry(entry) {
  const operation = entry?.operationPlan, contract = operation?.contract, effective = contract?.request;
  return !(!entry || operation?.compatibilityPath !== true || operation.instrumentation
          || operation.qualificationRequirements?.length !== 0
          || ['native', 'vendor', 'remux', 'hdr', 'encodePreservation'].some(key => entry[key])
          || entry.inspection?.color?.classification !== 'sdr' || entry.inspection.color.supported !== true
          || effective?.operation !== 'encode' || effective.target !== 'matroska'
          || effective.range !== null || effective.resolution !== 'source' || effective.audioPolicy !== 'copy'
          || !['preserve', 'sdr'].includes(effective.hdrPolicy)
          || effective.omissionRequestIds?.length !== 0 || contract.omissionRequests?.ids?.length !== 0);
}

class LinuxWorkbenchService extends EncoderService {
  async prepareRemuxBatch(request) {
    if (!this.remuxOperations) throw refusal('REMUX_CONTROLS_UNAVAILABLE',
      this.linuxRemuxStatus?.reason || 'Linux Remux is unavailable: this checkout lacks the reviewed local dependency bytes. CPU encoding remains available. See WORKBENCH_REMUX_CHECKPOINT.md.');
    return super.prepareRemuxBatch(request);
  }
  startBatch(request) {
    this.requireIdle();
    const plan = this.plan;
    // Superclass still owns request shape, stale plan and selection validation.
    if (!plan || !Array.isArray(request?.fileIds) || !request.fileIds.length) return super.startBatch(request);
    if (plan.operation === 'remux' && this.remuxOperations && !plan.sameFolder) {
      for (const fileId of request.fileIds) {
        const entry = plan.entries.get(fileId);
        if (!entry?.remux || entry.native || entry.hdr || entry.vendor || entry.encodePreservation
            || !['matroska', 'mp4'].includes(entry.operationPlan?.contract?.request?.target)
            || entry.remuxRequest?.omissionRequestIds.length !== 0) {
          throw refusal('LINUX_WORKBENCH_ROUTE_UNAVAILABLE', START_MESSAGE);
        }
      }
      return super.startBatch(request);
    }
    const profile = PROFILES.find(row => row.id === plan.settings?.profileId);
    if (plan.operation !== 'encode' || plan.sameFolder || profile?.hardware !== 'CPU') {
      throw refusal('LINUX_WORKBENCH_ROUTE_UNAVAILABLE', START_MESSAGE);
    }
    for (const fileId of request.fileIds) {
      if (!isOrdinaryWorkbenchEntry(plan.entries.get(fileId))) {
        throw refusal('LINUX_WORKBENCH_ROUTE_UNAVAILABLE', START_MESSAGE);
      }
    }
    return super.startBatch(request);
  }
}

async function createWorkbenchService({ stateDir, onChild, outputAccess } = {}) {
  await verifyTool('ffmpeg'); await verifyTool('ffprobe');
  const remux = await createRemuxControls({ stateDir, onChild });
  const service = new LinuxWorkbenchService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path,
    stateDir, runtimeIdentity: RUNTIME_ID, outputAccess, inspectionWorkers: 1, run: createWorkbenchRunner({ onChild }),
    // Do not run Windows DXGI or invent Linux adapter/device qualification.
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    // Only this reviewed remux preview is composed. No Windows catalogs,
    // native/HDR/changed-encode controls or storage eligibility overrides.
    ...remux.controls,
  });
  service.linuxRemuxStatus = remux.status;
  return service;
}

module.exports = { isOrdinaryWorkbenchEntry, createWorkbenchRunner, createWorkbenchService, LinuxWorkbenchService, validateInvocation, START_MESSAGE, ENCODE_LIMIT_MS };
