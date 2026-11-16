'use strict';

// Opt-in experimental adapter. Nothing imports this from the production app.
// Paths and pins are code-owned, never selected by a renderer or PATH lookup.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { PROFILES, buildEncodeArgs } = require('../src/media.cjs');

const PINS = Object.freeze({
  ffmpeg: Object.freeze({ path: '/usr/bin/ffmpeg', size: 366984,
    sha256: 'e8a8d46f5225f3062cec7c07fb145d58ae73c603cb740dcd5bad34bfb54e455a' }),
  ffprobe: Object.freeze({ path: '/usr/bin/ffprobe', size: 206504,
    sha256: 'cefc5f81c0b18429cdbf8fa5a89e1e9c759235e10f93f9b329ff1b2fdff26f46' }),
});
const fail = (code, message) => Object.assign(new Error(message), { code });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function assertHost(platform = process.platform, arch = process.arch, env = process.env) {
  if (platform !== 'linux' || arch !== 'x64') throw fail('LINUX_PILOT_HOST', 'This pilot requires Linux x64.');
  if (['LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT'].some(key => env[key])) {
    throw fail('LINUX_PILOT_LOADER', 'Loader overrides are not allowed for this pilot.');
  }
}

function assertPinnedBytes(bytes, pin) {
  if (bytes.length !== pin.size || sha256(bytes) !== pin.sha256) {
    throw fail('LINUX_PILOT_RUNTIME_CHANGED', 'The fixed Linux tool changed; review the runtime instead of bypassing its pin.');
  }
}

async function verifyTool(kind) {
  assertHost();
  if (!Object.hasOwn(PINS, kind)) throw fail('LINUX_PILOT_TOOL', 'Unknown fixed tool.');
  const pin = PINS[kind];
  const stat = await fs.lstat(pin.path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022)
      || await fs.realpath(pin.path) !== pin.path) {
    throw fail('LINUX_PILOT_TOOL_PATH', 'The fixed tool must be a regular, non-writable system executable.');
  }
  await fs.access(pin.path, constants.X_OK);
  let writable = false;
  try { await fs.access(pin.path, constants.W_OK); writable = true; }
  catch (error) { if (error.code !== 'EACCES' && error.code !== 'EROFS') throw error; }
  if (writable) throw fail('LINUX_PILOT_TOOL_WRITABLE', 'The pilot must not run tools writable by its own account.');
  assertPinnedBytes(await fs.readFile(pin.path), pin);
  return pin;
}

async function runFixedTool(kind, args, options = {}) {
  validateRunOptions(options);
  const pin = await verifyTool(kind); // Recheck before every owned child.
  // This is a local developer harness, not an IPC/file-execution service. Args
  // are constructed by the pilot. Bound execution and captures at this seam.
  return runTool(pin.path, args, { timeoutMs: 60000, stdoutLimit: 2 * 1024 * 1024,
    stderrLimit: 128 * 1024, ...options,
    // Opt into upstream's total progress-output bound; callers cannot replace it.
    onOutputBytes() {} });
}

function validateRunOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype
      || Object.keys(options).some(key => !['timeoutMs', 'signal', 'onChild', 'onProgress'].includes(key))
      || (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs)
        || options.timeoutMs <= 0 || options.timeoutMs > 60000))
      || ['onChild', 'onProgress'].some(key => options[key] !== undefined && typeof options[key] !== 'function')
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    throw fail('LINUX_PILOT_OPTIONS', 'Only bounded timeout, cancellation and observation callbacks are allowed.');
  }
}

function assertEncodeCompleted(ended) {
  if (!ended) throw fail('LINUX_PILOT_INCOMPLETE', 'Zero process exit without terminal encode progress is not encode success.');
}

function cpuArgs(input) {
  const profile = PROFILES.find(item => item.id === input?.settings?.profileId);
  if (!profile || profile.hardware !== 'CPU') {
    throw fail('LINUX_PILOT_CPU_ONLY', 'Only the existing CPU profiles are admitted by this pilot.');
  }
  return buildEncodeArgs(input);
}

async function runCpuEncode(input, options = {}) {
  validateRunOptions(options);
  const args = cpuArgs(input);
  let exists = false;
  try { await fs.lstat(input.output); exists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) throw fail('LINUX_PILOT_OUTPUT_EXISTS', 'The pilot never replaces an existing output.');
  let ended = false;
  const result = await runFixedTool('ffmpeg', args, { ...options,
    onProgress(value) { ended ||= value.ended; options.onProgress?.(value); } });
  // FFmpeg 7.1.5 can return zero after -n refuses a collision. Keep -n as the
  // race guard, and do not confuse that exit with a completed encoding operation.
  assertEncodeCompleted(ended);
  return result;
}

module.exports = { PINS, assertHost, assertPinnedBytes, verifyTool, runFixedTool,
  cpuArgs, runCpuEncode, validateRunOptions, assertEncodeCompleted, sha256 };
