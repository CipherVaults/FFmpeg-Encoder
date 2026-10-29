'use strict';
// Evidence-bound test runner for FFmpeg Encoder.
//
// Runs `node --test` on the named test files and saves an immutable receipt:
// stdout, stderr, exit code, duration, Node version, and the SHA-256 of every
// tested and tested-against file, so a later reader can tell exactly which
// bytes a pass/fail applies to. A failing run is kept, never overwritten.
//
// Usage (from the repository root):
//   node .claude/skills/evidence-run/run-tests.cjs <label> <test files...> [--covers <src files...>]
//
// Output: artifacts/v0.7/evidence/<UTC stamp>_<label>/{stdout.txt,stderr.txt,receipt.json}
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const args = process.argv.slice(2);
const label = args.shift();
if (!label || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(label)) {
  console.error('Usage: run-tests.cjs <label> <test files...> [--covers <src files...>]');
  process.exit(64);
}
const split = args.indexOf('--covers');
const tests = split === -1 ? args : args.slice(0, split);
const covers = split === -1 ? [] : args.slice(split + 1);
if (!tests.length) { console.error('At least one test file is required.'); process.exit(64); }

const root = process.cwd();
const sha = file => createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex');
const identity = files => files.map(file => ({ file, bytes: fs.statSync(path.resolve(root, file)).size, sha256: sha(file) }));
const git = (...gitArgs) => spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).stdout.trim();

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = path.join(root, 'artifacts', 'v0.7', 'evidence', `${stamp}_${label}`);
fs.mkdirSync(dir, { recursive: true });

const before = { tests: identity(tests), covers: identity(covers) };
const started = process.hrtime.bigint();
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
const after = { tests: identity(tests), covers: identity(covers) };

const summary = {};
for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
  // TAP reporters print "# pass 3"; Node's spec reporter prints "ℹ pass 3".
  const match = (run.stdout || '').match(new RegExp(`^(?:# |\\u2139 )${key} (\\d+)\\s*$`, 'm'));
  if (match) summary[key] = Number(match[1]);
}
const receipt = {
  schema: 1, label, startedAt: new Date(Date.now() - durationMs).toISOString(), durationMs: Math.round(durationMs * 1000) / 1000,
  node: process.version, platform: process.platform, head: git('rev-parse', 'HEAD'),
  dirtyPaths: git('status', '--porcelain=v1').split('\n').filter(Boolean).length,
  command: ['node', '--test', ...tests], exitCode: run.status, signal: run.signal, spawnError: run.error ? String(run.error) : null,
  summary, bytesChangedDuringRun: JSON.stringify(before) !== JSON.stringify(after), files: after,
};
fs.writeFileSync(path.join(dir, 'stdout.txt'), run.stdout || '');
fs.writeFileSync(path.join(dir, 'stderr.txt'), run.stderr || '');
fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');

const outcome = run.status === 0 && !receipt.bytesChangedDuringRun ? 'PASS' : 'FAIL';
console.log(`${outcome} ${label}: ${JSON.stringify(summary)} exit=${run.status} ${receipt.durationMs}ms`);
console.log(`receipt: ${path.relative(root, dir)}`);
if (outcome === 'FAIL') {
  const failing = (run.stdout || '').split('\n').filter(line => /^not ok |^\s+error:|^\s+code:|failureType/.test(line)).slice(0, 40);
  if (failing.length) console.log(failing.join('\n'));
}
process.exit(outcome === 'PASS' ? 0 : 1);
