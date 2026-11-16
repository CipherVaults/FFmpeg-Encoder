'use strict';
// Explicit workspace runtime for the real Linux workbench, never a PATH or IPC
// selection. The baseline and earlier two-codec candidate retain their own pins.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertHost, assertPinnedBytes } = require('./runtime.cjs');
const { ToolError, runTool } = require('../src/process-runner.cjs');
const { createWorkbenchRunner } = require('./workbench-service.cjs');
const manifest = require('./runtime-av1-pins.json');
const root = path.resolve(__dirname, '../../runtime-candidates/ffmpeg-9.0.2-av1/ffmpeg-9.0.2');
const PINS = Object.freeze(Object.fromEntries(Object.entries(manifest.tools).map(([kind, pin]) =>
  [kind, Object.freeze({ ...pin, path: path.join(root, kind) })])));
const DEPENDENCIES = Object.freeze(manifest.codecDependencies.map(pin => Object.freeze({ ...pin })));
// Match the shared observer's executable-pair identity. Dependency identity is
// separate and is checked on every child, not substituted for that contract.
const RUNTIME_ID = createHash('sha256').update(JSON.stringify(['ffmpeg', 'ffprobe'].map(kind => ({
  sizeBytes: PINS[kind].size, sha256: PINS[kind].sha256 })))).digest('hex');
const DEPENDENCY_ID = createHash('sha256').update(JSON.stringify(manifest.codecDependencies)).digest('hex');
const fail = (code, message) => { throw new ToolError(code, message); };
async function verifyFile(pin) {
  const stat = await fs.lstat(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(pin.path) !== pin.path)
    fail('LINUX_AV1_RUNTIME_PATH', 'The exact regular runtime artifact is required.');
  if (stat.size !== pin.size) fail('LINUX_AV1_RUNTIME_SIZE', 'The reviewed runtime artifact size changed.');
  if (pin.sonamePath && await fs.realpath(pin.sonamePath) !== pin.path)
    fail('LINUX_AV1_DEPENDENCY_PATH', 'The system codec link no longer resolves to its reviewed library.');
  assertPinnedBytes(await fs.readFile(pin.path), pin);
}
async function verifyAv1Tool(kind) {
  assertHost();
  if (!Object.hasOwn(PINS, kind)) fail('LINUX_AV1_TOOL', 'Unknown workbench runtime tool.');
  await verifyFile(PINS[kind]);
  for (const pin of DEPENDENCIES) await verifyFile(pin);
  return PINS[kind];
}
function createAv1Runner({ onChild, verify = verifyAv1Tool, execute = runTool } = {}) {
  return async (executable, args, options = {}) => {
    // The existing workbench runner validates paths, CPU-only argv, options,
    // deadlines and terminal progress. Never translate paths or fall back.
    const kind = Object.keys(PINS).find(key => PINS[key].path === executable);
    let result, failure, verified = false;
    const run = createWorkbenchRunner({ pins: PINS, execute, onChild,
      verify: async tool => { await verify(tool); verified = true; } });
    try { result = await run(executable, args, options); }
    catch (error) { failure = error; }
    if (verified) {
      try { await verify(kind); }
      catch (error) {
        if (failure) throw new ToolError('LINUX_AV1_CHANGED_AFTER_FAILURE',
          'The operation failed and runtime integrity could not be confirmed.',
          { cause: failure, postVerificationFailure: { code: error.code, message: error.message } });
        throw error;
      }
    }
    if (failure) throw failure;
    return result;
  };
}
module.exports = { PINS, DEPENDENCIES, RUNTIME_ID, DEPENDENCY_ID, verifyAv1Tool, createAv1Runner };
