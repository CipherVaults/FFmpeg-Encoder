'use strict';
// Read-only re-entry verification for FFmpeg Encoder (PBS "inspect before replaying").
//
// Checks live Git state, remote equality, protected release tags, the private
// Planning records and the requirement tracker against a saved baseline, and
// prints PASS/FAIL per item. `--baseline` records the current values as the new
// baseline (use only after a verified checkpoint). Never modifies tracked files.
//
// Usage (repository root): node .claude/skills/reentry-check/reentry-check.cjs [--baseline]
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = process.cwd();
const baselineFile = path.join(root, 'artifacts', 'v0.7', 'claude-continuation', 'protected-baseline.json');
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

const planningDir = path.join(root, '0- Documentation', 'Planning');
const planning = Object.fromEntries(walk(planningDir).map(f => [path.relative(root, f).split(path.sep).join('/'), sha(f)]).sort());
const tracker = fs.readFileSync(path.join(root, '0- Documentation', '25_0.7_Requirements_and_Evidence.md'), 'utf8');
const requirementRows = tracker.split('\n').filter(l => /^\| *(N0|O0|P0|Q0|R0|S0)\d \|/.test(l));
// Digest only ID + requirement text columns, so status/evidence updates do not trip it.
const requirementDigest = createHash('sha256').update(requirementRows.map(l => l.split('|').slice(1, 3).map(s => s.trim()).join('|')).join('\n')).digest('hex');

const current = {
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  head: git('rev-parse', 'HEAD'),
  remote: (git('ls-remote', 'origin', 'refs/heads/codex/v0.7-candidate') || '').split(/\s/)[0] || null,
  indexEmpty: (git('diff', '--cached', '--name-only') || '') === '',
  stagedPlanning: (git('diff', '--cached', '--name-only') || '').split('\n').filter(p => /Planning/.test(p)),
  tags: { 'local-v0.5.0': git('rev-parse', 'local-v0.5.0^{}'), 'local-v0.6.0': git('rev-parse', 'local-v0.6.0^{}') },
  planningCount: Object.keys(planning).length,
  planning,
  requirementCount: requirementRows.length,
  requirementDigest,
};

if (process.argv.includes('--baseline')) {
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  const record = { schema: 1, recordedAt: new Date().toISOString(), tags: current.tags, planning: current.planning, requirementCount: current.requirementCount, requirementDigest: current.requirementDigest };
  fs.writeFileSync(baselineFile, JSON.stringify(record, null, 2) + '\n');
  console.log(`Baseline recorded: ${current.planningCount} Planning files, ${current.requirementCount} requirements, tags ${JSON.stringify(current.tags)}`);
}

const base = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });
check('branch is codex/v0.7-candidate', current.branch === 'codex/v0.7-candidate', current.branch);
check('HEAD equals private remote branch', current.head && current.head === current.remote, `${current.head} vs ${current.remote}`);
check('index empty', current.indexEmpty, current.indexEmpty ? 'empty' : 'staged changes present');
check('no Planning file staged', current.stagedPlanning.length === 0, current.stagedPlanning.join(', ') || 'none');
check('43 requirement rows', current.requirementCount === 43, String(current.requirementCount));
if (base) {
  check('protected tags unchanged', JSON.stringify(current.tags) === JSON.stringify(base.tags), JSON.stringify(current.tags));
  const changed = Object.keys({ ...base.planning, ...current.planning }).filter(k => base.planning[k] !== current.planning[k]);
  check(`private Planning files unchanged (${Object.keys(base.planning).length})`, changed.length === 0, changed.join(', ') || 'all match');
  check('requirement IDs/texts unchanged', current.requirementDigest === base.requirementDigest, current.requirementDigest.slice(0, 16));
} else check('baseline present', false, 'run with --baseline after a verified checkpoint');

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `${failed} check(s) failed — inspect before editing.` : 'All re-entry checks passed.');
process.exit(failed ? 1 : 0);
