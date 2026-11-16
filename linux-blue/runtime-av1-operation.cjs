'use strict';
// Main-only developer evidence runner for the fixed AV1-capable pair. This is
// not a qualification, application route, renderer API or alternate executable
// selector. Keep the ordinary workbench runner and both older pairs unchanged.
const { ToolError, runTool } = require('../src/process-runner.cjs');
const { PINS, RUNTIME_ID, verifyAv1Tool } = require('./runtime-av1.cjs');
const KEYS = new Set(['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit',
  'onProgress', 'onStdoutChunk', 'onOutputBytes', 'onChild']);
const CALLBACKS = ['onProgress', 'onStdoutChunk', 'onOutputBytes', 'onChild'];
const CPU_ENCODERS = new Set(['copy', 'ffv1', 'libx264', 'libx265', 'libsvtav1']);
const fail = (code, message) => { throw new ToolError(code, message); };

function validate(executable, args, options) {
  const kind = ['ffmpeg', 'ffprobe'].find(key => executable === PINS[key].path);
  if (!kind || !Array.isArray(args) || args.length > 512)
    fail('LINUX_AV1_OPERATION_INVOCATION', 'Evidence requires fixed tool paths and bounded main-owned arguments.');
  for (let i = 0; i < args.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(args, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string'
        || descriptor.value.length > 16384 || descriptor.value.includes('\0'))
      fail('LINUX_AV1_OPERATION_INVOCATION', 'Expected dense, inert bounded arguments.');
  }
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
      || Reflect.ownKeys(options).some(key => !KEYS.has(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value')))
    fail('LINUX_AV1_OPERATION_OPTIONS', 'Only main-owned bounded evidence options are supported.');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    fail('LINUX_AV1_OPERATION_OPTIONS', 'Expected an AbortSignal.');
  for (const [key, limit] of [['timeoutMs', 120000], ['stdoutLimit', 128 * 1024 * 1024], ['stderrLimit', 256 * 1024]]) {
    if ((key === 'timeoutMs' && options[key] === undefined) || (options[key] !== undefined
        && (!Number.isSafeInteger(options[key]) || options[key] <= 0 || options[key] > limit)))
      fail('LINUX_AV1_OPERATION_OPTIONS', 'Evidence child budgets must be positive and bounded.');
  }
  for (const key of CALLBACKS) {
    if (options[key] !== undefined && typeof options[key] !== 'function')
      fail('LINUX_AV1_OPERATION_OPTIONS', 'Expected an observation callback.');
  }
  for (let i = 0; i < args.length; i++) {
    if (/^-(?:hwaccel(?:_.*)?|init_hw_device|filter_hw_device)$/.test(args[i])
        || (/^-(?:c|codec)(?::v(?::\d+)?)?$/.test(args[i]) || args[i] === '-vcodec')
          && !CPU_ENCODERS.has(args[i + 1]))
      fail('LINUX_AV1_OPERATION_GPU_UNTESTED', 'GPU execution is not enabled by this CPU evidence runner.');
  }
  return kind;
}

function createAv1OperationRunner({ onChild, verify = verifyAv1Tool, execute = runTool } = {}) {
  if (onChild !== undefined && typeof onChild !== 'function')
    fail('LINUX_AV1_OPERATION_OPTIONS', 'Expected a main-owned child observer.');
  return async (executable, args, options = {}) => {
    const kind = validate(executable, args, options);
    // Freeze invocation values before asynchronous verification. The injectable
    // verifier/runner are test seams, not application or IPC inputs.
    args = [...args]; options = { ...options };
    await verify(kind);
    if (options.signal?.aborted) fail('CANCELLED', 'Changed-operation evidence cancelled.');
    let result, failure;
    try {
      result = await execute(executable, args, { stdoutLimit: 16 * 1024 * 1024,
        stderrLimit: 256 * 1024, ...options,
        // Progress-mode byte limits in runTool require a byte observer. Keep
        // accounting active even when this caller only consumes progress.
        onOutputBytes(record) { options.onOutputBytes?.(record); },
        onChild(child) { onChild?.(child); options.onChild?.(child); } });
    } catch (error) { failure = error; }
    // verifyAv1Tool checks the selected executable AND both pinned codec
    // libraries. Run it after child/sink settlement, including process errors.
    try { await verify(kind); }
    catch (error) {
      if (failure) throw new ToolError('LINUX_AV1_OPERATION_CHANGED_AFTER_FAILURE',
        'The evidence operation failed and runtime integrity could not be confirmed.',
        { cause: failure, postVerificationFailure: { code: error.code, message: error.message } });
      throw error;
    }
    if (failure) throw failure;
    // Like the earlier candidate runner, return process results unchanged.
    // The operation service/calibration owns terminal progress, telemetry,
    // decoded evidence and publication. Exit zero is not acceptance here.
    return result;
  };
}
module.exports = { PINS, RUNTIME_ID, createAv1OperationRunner };
