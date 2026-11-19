// Reconstructed off-main adapter from restored074 source, not recovered old runner.
'use strict';
// Developer-only candidate observation. No CLI/environment/renderer wiring and
// no catalog grant. The caller separately reviews provenance/dependency closure;
// this verifies only the explicit pair and listed dependencies, not a release.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { OperationRuntimeObserver } = require(require('./collector-options.cjs').SOURCE_ROOT + '/src/operation-runtime.cjs');
const { runTool, ToolError } = require(require('./collector-options.cjs').SOURCE_ROOT + '/src/process-runner.cjs');
const handles = new WeakMap(), tools = ['ffmpeg', 'ffprobe'];
const fail = message => { throw new ToolError('CANDIDATE_CALIBRATION_RUNTIME', message); };
function record(value, allowed, required = allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || required.some(k => !Object.hasOwn(value, k)) || Reflect.ownKeys(value).some(k => !allowed.includes(k)
      || !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('Expected inert explicit candidate fields.');
}
function pin(value, dependency = false) {
  record(value, ['path', 'size', 'sha256', ...(dependency ? ['sonamePath'] : [])], ['path', 'size', 'sha256']);
  for (const k of ['path', ...(value.sonamePath === undefined ? [] : ['sonamePath'])])
    if (typeof value[k] !== 'string' || !path.isAbsolute(value[k]) || value[k] !== path.resolve(value[k]) || /[\x00-\x1f\x7f]/.test(value[k])) fail('Fixed canonical absolute candidate paths required.');
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > 512 * 1024 * 1024 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('Exact bounded candidate size/hash required.');
  return Object.freeze({ ...value });
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function verifyDependency(value) {
  const before = await fs.lstat(value.path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(value.size)
    || await fs.realpath(value.path) !== value.path || value.sonamePath && await fs.realpath(value.sonamePath) !== value.path) fail('Listed candidate dependency changed path or size.');
  if (digest(await fs.readFile(value.path)) !== value.sha256) fail('Listed candidate dependency changed bytes.');
  const after = await fs.lstat(value.path, { bigint: true });
  if (['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].some(k => before[k] !== after[k])) fail('Listed candidate dependency changed during observation.');
}
function exactRawWindow(args) {
  const prefix = ['-hide_banner','-loglevel','warning','-nostdin','-n','-xerror','-protocol_whitelist','file,pipe'];
  let i = 0; for (const x of prefix) if (args[i++] !== x) return false;
  let count = 0;
  while (args[i] === '-threads') {
    for (const x of ['-threads','1','-noautorotate','-f','h264','-i']) if (args[i++] !== x) return false;
    const clip = args[i++];
    if (typeof clip !== 'string' || path.resolve(clip) !== clip || !clip.startsWith(__dirname + '/owned-') || !clip.includes('/remux-evidence-')) return false;
    if (++count > 2) return false;
  }
  if (!count) return false;
  for (let n = 0; n < count; n++) for (const x of ['-map',n + ':v:0','-an','-sn','-dn','-frames:v','1','-c:v','rawvideo','-threads','1','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','framehash','-hash','sha256',n ? 'pipe:3' : 'pipe:1']) if (args[i++] !== x) return false;
  return i === args.length;
}
function invocation(pins, executable, args, options) {
  const kind = tools.find(k => pins[k].path === executable);
  if (!kind || !Array.isArray(args) || args.length > 512 || Reflect.ownKeys(args).length !== args.length + 1) fail('Fixed candidate tool and dense bounded arguments required.');
  for (let i = 0; i < args.length; i++) {
    const d = Object.getOwnPropertyDescriptor(args, String(i));
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string' || d.value.length > 16384 || d.value.includes('\0')) fail('Inert bounded arguments required.');
  }
  record(options, ['signal', 'timeoutMs', 'stdoutLimit', 'stderrLimit', 'onChild', 'onProgress', 'onStdoutChunk', 'onOutputBytes'], ['timeoutMs']);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('Native cancellation signal required.');
  for (const [k, max] of [['timeoutMs', 2147483647], ['stdoutLimit', 1024 * 1024 * 1024], ['stderrLimit', 256 * 1024]])
    if (options[k] !== undefined && (!Number.isSafeInteger(options[k]) || options[k] < 1 || options[k] > max)) fail('Positive bounded child budgets required.');
  for (const k of ['onChild', 'onProgress', 'onStdoutChunk', 'onOutputBytes']) if (options[k] !== undefined && typeof options[k] !== 'function') fail('Observation callback required.');
  for (let i = 0; i < args.length; i++) if (/^-(?:hwaccel(?:_.*)?|init_hw_device|filter_hw_device)$/.test(args[i])
    || (/^-(?:c|codec)(?::v(?::\d+)?)?$/.test(args[i]) || args[i] === '-vcodec') && !(args[i + 1] === 'copy' || args[i + 1] === 'rawvideo' && exactRawWindow(args))) fail('Candidate calibration is CPU-only.');
  return kind;
}
async function openCandidateCalibrationRuntime(manifest, testSeams = {}) {
  record(manifest, ['pins', 'runtimeIdentity', 'dependencies']); record(manifest.pins, tools);
  record(testSeams, ['execute'], []);
  if (testSeams.execute !== undefined && typeof testSeams.execute !== 'function') fail('Main-owned execution seam required.');
  const pins = Object.freeze(Object.fromEntries(tools.map(k => [k, pin(manifest.pins[k])])));
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length > 32 || Reflect.ownKeys(manifest.dependencies).length !== manifest.dependencies.length + 1) fail('Explicit dense dependency list required.');
  const dependencies = Object.freeze(Array.from({ length: manifest.dependencies.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(manifest.dependencies, String(i));
    if (!d || !Object.hasOwn(d, 'value')) fail('Dependency accessors are forbidden.'); return pin(d.value, true);
  }));
  if (new Set(dependencies.map(x => x.path)).size !== dependencies.length) fail('Duplicate dependencies are ambiguous.');
  const identity = digest(JSON.stringify(tools.map(k => ({ sizeBytes: pins[k].size, sha256: pins[k].sha256 }))));
  if (manifest.runtimeIdentity !== identity) fail('Candidate runtime identity does not match its exact pair.');
  const observer = new OperationRuntimeObserver({ runtime: Object.fromEntries(tools.map(k => [k, pins[k].path])),
    pins: Object.fromEntries(tools.map(k => [k, { sizeBytes: pins[k].size, sha256: pins[k].sha256 }])), run: testSeams.execute || runTool });
  let token, closed = false;
  const current = async signal => {
    if (closed) fail('Candidate handle is closed.');
    await observer.requireCurrent(token, { signal });
    for (const dep of dependencies) await verifyDependency(dep);
    if (signal?.aborted) throw new ToolError('CANCELLED', 'Candidate verification cancelled.');
    if (closed) fail('Candidate closed during verification.');
  };
  try { token = await observer.observe({ hardware: 'CPU' }); for (const dep of dependencies) await verifyDependency(dep); }
  catch (error) { await observer.close(); throw error; }
  const handle = Object.freeze({ pins, runtimeIdentity: identity, dependencies,
    requireCurrent: current,
    createRunner(options = {}) {
      record(options, ['onChild'], []); const { onChild } = options;
      if (onChild !== undefined && typeof onChild !== 'function') fail('Child observer required.');
      return async (executable, args, options = {}) => {
        const kind = invocation(pins, executable, args, options); args = [...args]; options = { ...options };
        await current(options.signal); let result, failure;
        try { result = await observer.invoke(token, kind, args, { stdoutLimit: 16 * 1024 * 1024, stderrLimit: 256 * 1024, ...options,
          onOutputBytes: row => options.onOutputBytes?.(row), onChild(child) { onChild?.(child); options.onChild?.(child); } }); }
        catch (error) { failure = error; }
        // Settlement integrity must not be mistaken for cancellation of the job.
        try {
          if (failure?.code === 'CANCELLED') {
            // invoke deliberately invalidates cancelled tokens. Observe again only
            // for the settlement check; never revive the campaign token.
            if (closed) fail('Candidate handle is closed.');
            const settled = await observer.observe({ hardware: 'CPU' });
            await observer.requireCurrent(settled);
            for (const dep of dependencies) await verifyDependency(dep);
            if (closed) fail('Candidate closed during settlement verification.');
          } else await current();
        } catch (post) {
          if (failure) throw new ToolError('CANDIDATE_CALIBRATION_CHANGED_AFTER_FAILURE', 'Candidate failed and post-invocation identity is stale.', { cause: failure, postVerificationFailure: { code: post.code, message: post.message } });
          throw post;
        }
        if (failure) throw failure; return result;
      };
    },
    async close() { closed = true; await observer.close(); },
  });
  handles.set(handle, true); return handle;
}
function requireCandidateCalibrationRuntime(handle) {
  if (!handle || !handles.has(handle)) fail('Only the privately issued candidate handle is accepted.'); return handle;
}
module.exports = { openCandidateCalibrationRuntime, requireCandidateCalibrationRuntime, exactRawWindow };
