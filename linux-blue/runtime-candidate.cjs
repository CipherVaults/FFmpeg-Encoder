'use strict';
// Explicit developer qualification candidate, NOT an installed app runtime.
// Build bytes are workspace-owned, unlike the immutable system baseline. Pins
// are checked before and after every child; this does not claim executable-FD
// launch or a production deployment trust boundary. No PATH/IPC selection.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertHost, assertPinnedBytes } = require('./runtime.cjs');
const { runTool, ToolError } = require('../src/process-runner.cjs');
const manifest = require('./runtime-candidate-pins.json');
const root = path.resolve(__dirname, '../../runtime-candidates/ffmpeg-9.0.2-source/ffmpeg-9.0.2');
const PINS = Object.freeze(Object.fromEntries(['ffmpeg', 'ffprobe'].map(kind => [kind,
  Object.freeze({ ...manifest.tools[kind], path: path.join(root, kind) })])));
const RUNTIME_ID = createHash('sha256').update(JSON.stringify(['ffmpeg', 'ffprobe'].map(kind => ({
  sizeBytes: PINS[kind].size, sha256: PINS[kind].sha256 })))).digest('hex');
const fail = (code, message) => { throw new ToolError(code, message); };
async function verifyCandidateTool(kind) {
  assertHost();
  if (!Object.hasOwn(PINS, kind)) fail('LINUX_CANDIDATE_TOOL', 'Unknown qualification candidate tool.');
  const pin = PINS[kind], stat = await fs.lstat(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(pin.path) !== pin.path)
    fail('LINUX_CANDIDATE_PATH', 'Candidate must be the exact regular build artifact.');
  assertPinnedBytes(await fs.readFile(pin.path), pin);
  return pin;
}
const KEYS = new Set(['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onProgress', 'onStdoutChunk', 'onOutputBytes', 'onChild']);
function createCandidateRunner({ onChild, verify = verifyCandidateTool, execute = runTool } = {}) {
  return async (executable, args, options = {}) => {
    const kind = ['ffmpeg', 'ffprobe'].find(key => executable === PINS[key].path);
    if (!kind || !Array.isArray(args) || args.length > 512 || args.some(arg => typeof arg !== 'string' || arg.length > 16384 || arg.includes('\0')))
      fail('LINUX_CANDIDATE_INVOCATION', 'Candidate requires fixed tool paths and bounded main-owned arguments.');
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(key => !KEYS.has(key))
        || options.signal !== undefined && !(options.signal instanceof AbortSignal))
      fail('LINUX_CANDIDATE_OPTIONS', 'Unsupported candidate runner options.');
    for (const [key, limit] of [['timeoutMs', 120000], ['stdoutLimit', 128 * 1024 * 1024], ['stderrLimit', 256 * 1024]]) {
      if (key === 'timeoutMs' && options[key] === undefined || options[key] !== undefined
          && (!Number.isSafeInteger(options[key]) || options[key] <= 0 || options[key] > limit))
        fail('LINUX_CANDIDATE_OPTIONS', 'Candidate child budgets must be positive and bounded.');
    }
    for (const key of ['onProgress', 'onStdoutChunk', 'onOutputBytes', 'onChild']) {
      if (options[key] !== undefined && typeof options[key] !== 'function') fail('LINUX_CANDIDATE_OPTIONS', 'Invalid observation callback.');
    }
    await verify(kind);
    if (options.signal?.aborted) fail('CANCELLED', 'Candidate qualification cancelled.');
    let result, failure;
    try { result = await execute(executable, args, { stdoutLimit: 16 * 1024 * 1024, stderrLimit: 256 * 1024, ...options,
      onChild(child) { options.onChild?.(child); onChild?.(child); } }); }
    catch (error) { failure = error; }
    try { await verify(kind); }
    catch (error) {
      if (failure) throw new ToolError('LINUX_CANDIDATE_CHANGED_AFTER_FAILURE',
        'The candidate child failed and its executable no longer matches the pinned build.',
        { cause: failure, postVerificationFailure: { code: error.code, message: error.message } });
      throw error;
    }
    if (failure) throw failure;
    return result;
  };
}
module.exports = { PINS, RUNTIME_ID, verifyCandidateTool, createCandidateRunner };
