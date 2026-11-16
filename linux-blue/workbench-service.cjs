'use strict';

// Opt-in Linux composition of the existing workbench, not a second encoder.
const { createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { runTool, ToolError } = require('../src/process-runner.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { PINS, verifyTool } = require('./runtime.cjs');

const START_MESSAGE = 'Linux workbench preview: inspection and settings are available. Encoding is not enabled until the ordinary service execution and publication path has been qualified on Linux.';
const CPU_ENCODERS = new Set(['copy', 'ffv1', 'libx264', 'libx265', 'libsvtav1']);
const OPTION_KEYS = new Set(['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onProgress']);
const refusal = (code, message) => new ToolError(code, message);

function validateInvocation(executable, args, options) {
  const kind = Object.keys(PINS).find(key => PINS[key].path === executable);
  if (!kind) throw refusal('LINUX_WORKBENCH_TOOL', 'Only the two fixed Linux tools are allowed.');
  if (!Array.isArray(args) || args.length > 512 || args.some(arg => typeof arg !== 'string' || arg.length > 16384 || arg.includes('\0'))) {
    throw refusal('LINUX_WORKBENCH_ARGUMENTS', 'Expected bounded, main-owned tool arguments.');
  }
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(key => !OPTION_KEYS.has(key))
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      || (options.onProgress !== undefined && typeof options.onProgress !== 'function')) {
    throw refusal('LINUX_WORKBENCH_OPTIONS', 'Only bounded inspection and capability options are supported.');
  }
  for (const [key, limit] of [['timeoutMs', 60000], ['stdoutLimit', 16 * 1024 * 1024], ['stderrLimit', 256 * 1024]]) {
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
function createWorkbenchRunner({ verify = verifyTool, execute = runTool, onChild } = {}) {
  return async (executable, args, options = {}) => {
    const kind = validateInvocation(executable, args, options);
    await verify(kind);
    if (options.signal?.aborted) throw refusal('CANCELLED', 'Operation cancelled.');
    return execute(executable, args, { timeoutMs: 30000, stdoutLimit: 16 * 1024 * 1024,
      stderrLimit: 256 * 1024, ...options, onChild,
      // Apply the shared runner's total-output budget even for progress mode.
      onOutputBytes() {} });
  };
}

class LinuxWorkbenchService extends EncoderService {
  startBatch() { throw refusal('LINUX_WORKBENCH_EXECUTION_PENDING', START_MESSAGE); }
}

async function createWorkbenchService({ stateDir, onChild } = {}) {
  await verifyTool('ffmpeg'); await verifyTool('ffprobe');
  const runtimeIdentity = createHash('sha256').update(JSON.stringify(Object.values(PINS))).digest('hex');
  return new LinuxWorkbenchService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path,
    stateDir, runtimeIdentity, inspectionWorkers: 1, run: createWorkbenchRunner({ onChild }),
    // Do not run Windows DXGI or invent Linux adapter/device qualification.
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    // No changed-operation/native/remux/HDR controls or storage eligibility
    // overrides. Those existing gates stay closed; fresh inspection still works.
  });
}

module.exports = { createWorkbenchRunner, createWorkbenchService, LinuxWorkbenchService, validateInvocation, START_MESSAGE };
