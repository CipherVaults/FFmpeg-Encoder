'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PINS, DEPENDENCIES, RUNTIME_ID, DEPENDENCY_ID, createAv1Runner } = require('./runtime-av1.cjs');
const { selectWorkbenchRuntime } = require('./workbench-runtime-choice.cjs');
const { ENCODE_LIMIT_MS } = require('./workbench-service.cjs');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const args = ['-nostdin', '-n', '-i', '/synthetic.mkv', '-c:v:0', 'libsvtav1', '-progress', 'pipe:1', '-f', 'matroska', '/stage.mkv'];

test('startup defaults to baseline and accepts only one explicit fixed candidate choice', () => {
  assert.equal(selectWorkbenchRuntime(['electron', 'main.cjs']), 'baseline');
  assert.equal(selectWorkbenchRuntime(['electron', '--blue-runtime=9.0.2-av1']), '9.0.2-av1');
  assert.equal(selectWorkbenchRuntime(['electron', '--blue-runtime=9.0.2-keep720-candidate']), '9.0.2-keep720-candidate');
  assert.equal(selectWorkbenchRuntime(['electron', '--blue-runtime=9.0.2-resize-candidate']), '9.0.2-resize-candidate');
  assert.equal(selectWorkbenchRuntime(['electron', '--blue-runtime=9.0.2-full-copy-candidate']), '9.0.2-full-copy-candidate');
  for (const argv of [['--blue-runtime=9.0.2-full-copy-candidate', '--blue-runtime=9.0.2-resize-candidate'], ['--blue-runtime=9.0.2-full-copy-candidate', '--blue-runtime=9.0.2-full-copy-candidate'], ['--blue-runtime=9.0.2-full-copy-candidate/path']]) assert.throws(() => selectWorkbenchRuntime(argv), { code: 'LINUX_RUNTIME_CHOICE' });
  for (const argv of [['--blue-runtime=9.0.2-resize-candidate', '--blue-runtime=9.0.2-keep720-candidate'], ['--blue-runtime=9.0.2-resize-candidate', '--blue-runtime=9.0.2-resize-candidate'], ['--blue-runtime=9.0.2-resize-candidate/path'], ['--blue-runtime=9.0.2-resize-candidate=elsewhere']]) assert.throws(() => selectWorkbenchRuntime(argv), { code: 'LINUX_RUNTIME_CHOICE' });
  assert.throws(() => selectWorkbenchRuntime(['--blue-runtime=9.0.2-av1', '--blue-runtime=9.0.2-keep720-candidate']), { code: 'LINUX_RUNTIME_CHOICE' });
  for (const argv of [['--blue-runtime=/tmp/tool'], ['--blue-runtime'], ['--blue-runtime=baseline'],
    ['--blue-runtime=9.0.2-av1', '--blue-runtime=9.0.2-av1']]) assert.throws(() => selectWorkbenchRuntime(argv), { code: 'LINUX_RUNTIME_CHOICE' });
});
test('new pair identity follows shared observer algorithm; codec dependencies have separate identity', () => {
  assert.equal(RUNTIME_ID, sha(['ffmpeg', 'ffprobe'].map(kind => ({ sizeBytes: PINS[kind].size, sha256: PINS[kind].sha256 }))));
  assert.equal(DEPENDENCY_ID, sha(DEPENDENCIES)); assert.equal(DEPENDENCIES.length, 2);
  assert.notEqual(RUNTIME_ID, require('./runtime-candidate.cjs').RUNTIME_ID);
});
test('candidate keeps ordinary deadline and terminal progress, verifies before and after', async () => {
  const events = [];
  const run = createAv1Runner({ verify: async kind => events.push(kind), execute: async (_file, _args, options) => {
    events.push('execute'); assert.equal(options.timeoutMs, ENCODE_LIMIT_MS); options.onProgress({ ended: true }); return { exitCode: 0 }; } });
  await run(PINS.ffmpeg.path, args, { timeoutMs: 0, onProgress() {} });
  assert.deepEqual(events, ['ffmpeg', 'execute', 'ffmpeg']);
});
test('no fallback, other runtime paths, GPU, unsupported options or incomplete success', async () => {
  let launched = 0;
  const run = createAv1Runner({ verify: async () => {}, execute: async () => { launched++; return { exitCode: 0 }; } });
  for (const file of ['/usr/bin/ffmpeg', 'ffmpeg', require('./runtime-candidate.cjs').PINS.ffmpeg.path])
    await assert.rejects(run(file, []), { code: 'LINUX_WORKBENCH_TOOL' });
  await assert.rejects(run(PINS.ffmpeg.path, ['-c:v', 'hevc_nvenc']), { code: 'LINUX_WORKBENCH_GPU_UNTESTED' });
  await assert.rejects(run(PINS.ffmpeg.path, [], { env: {} }), { code: 'LINUX_WORKBENCH_OPTIONS' });
  await assert.rejects(run(PINS.ffmpeg.path, [], { timeoutMs: 0 }), { code: 'LINUX_WORKBENCH_OPTIONS' });
  assert.equal(launched, 0);
  await assert.rejects(run(PINS.ffmpeg.path, args, { timeoutMs: 0, onProgress() {} }), { code: 'LINUX_WORKBENCH_INCOMPLETE' });
});
test('dependency failure prevents launch; child failure and post-check failure remain visible', async () => {
  let launched = false;
  const refused = createAv1Runner({ verify: async () => { throw Object.assign(new Error('dependency mismatch'), { code: 'DEPENDENCY_CHANGED' }); },
    execute: async () => { launched = true; } });
  await assert.rejects(refused(PINS.ffprobe.path, []), { code: 'DEPENDENCY_CHANGED' }); assert.equal(launched, false);
  let count = 0;
  const failed = createAv1Runner({ verify: async () => { if (++count === 2) throw Object.assign(new Error('changed'), { code: 'CHANGED' }); },
    execute: async () => { throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); } });
  await assert.rejects(failed(PINS.ffprobe.path, []), error => error.code === 'LINUX_AV1_CHANGED_AFTER_FAILURE'
    && error.cause.code === 'CANCELLED' && error.postVerificationFailure.code === 'CHANGED');
});
test('pre-aborted call does not launch and remains cancelled after integrity check', async () => {
  const abort = new AbortController(); abort.abort(); let launched = false;
  const run = createAv1Runner({ verify: async () => {}, execute: async () => { launched = true; } });
  await assert.rejects(run(PINS.ffprobe.path, [], { signal: abort.signal }), { code: 'CANCELLED' }); assert.equal(launched, false);
});
test('actual entry lazily selects candidate, isolates state and uses no new renderer authority', async () => {
  const main = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  assert.match(main, /runtimeChoice === 'baseline' \? createWorkbenchService/);
  assert.match(main, /workbench-av1-preview/); assert.match(main, /runtimeChoice, runtimeIdentity: service.runtimeIdentity/);
  const composition = await fs.readFile(path.join(__dirname, 'workbench-av1-service.cjs'), 'utf8');
  for (const forbidden of ['createRemuxControls', 'OperationFamilySelector', 'workbench-trim-candidate', 'operationQualifications:']) assert.ok(!composition.includes(forbidden));
  assert.match(composition, /new LinuxWorkbenchService/); assert.match(composition, /available: false/);
});
