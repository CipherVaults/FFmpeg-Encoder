'use strict';
// Mechanical end-of-phase checks for the PBS close-out. Run once with the commit staged, and again with
// --after-push. It only reports: which records carry new facts stays root's judgement.
// Usage (repository root): node .claude/skills/phase-close/phase-close-check.cjs [--after-push]
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRANCH = 'codex/v0.7-candidate';
const PLANNING = '0- Documentation/Planning/';
const TEMPLATE = ['🤖 Models, Effort, Roles and Provenance', '🕒 Time', '🎯 Session Goal', '🛠️ Actions Taken', '🧠 Key Insights',
  '📌 Decisions Made', '⚠️ Difficulties / Friction', '🔧 Adjustments Made', '❌ Mistakes / Risks Noted', '📍 Current Position',
  '🔜 Next Steps', '❓ Open Questions', '🧾 Session Outcome', '🔍 Confidence Level'];
const OWNERS = ['01_Current_State.md', '10_Continuation_State.md', '25_0.7_Requirements_and_Evidence.md', '07_Execution_Index.md',
  '06_SESSION_SUMMARY.md', 'Execution Summaries/'].map(f => `0- Documentation/${f}`);
const LOCK = 'artifacts/v0.7/claude-continuation/writer-lock.json';

// The newest session entry must be on top and follow the full template, every section filled in.
function checkSessionSummary(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), problems = [];
  const first = lines.findIndex(l => /^#{1,6} /.test(l));
  if (first < 0 || !lines[first].startsWith('# 📘 Session: ')) return ['the first heading is not a "# 📘 Session: …" entry (newest entry goes on top)'];
  const sections = [];
  for (let i = first + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i])) break;
    if (lines[i].startsWith('## ')) {
      if (sections.length === TEMPLATE.length) break; // the next, older entry starts here
      sections.push({ title: lines[i].slice(3).trim(), body: [] });
    } else if (sections.length) sections.at(-1).body.push(lines[i]);
  }
  TEMPLATE.forEach((t, i) => {
    const s = sections[i];
    if (!s) problems.push(`missing section "${t}"`);
    else if (s.title !== t) problems.push(`section ${i + 1} is "${s.title}", expected "${t}"`);
    else if (!s.body.some(l => l.trim())) problems.push(`section "${t}" is empty`);
  });
  return problems;
}

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.error || r.stderr).trim()}`);
  return r.stdout;
};
const zlist = s => s.split('\0').filter(Boolean);

function runChecks(root, { afterPush = false, toolkitCheck, remoteSha, now = Date.now() } = {}) {
  const out = [], add = (level, msg) => out.push({ level, msg });
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  add(branch === BRANCH ? 'PASS' : 'FAIL', `branch is ${branch}${branch === BRANCH ? '' : `; commits go to ${BRANCH}`}`);

  // --no-renames lists both sides of a move, so moving a Planning file elsewhere still shows its Planning path.
  const staged = zlist(git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z']));
  const stagedPlanning = staged.filter(f => f.startsWith(PLANNING));
  add(stagedPlanning.length ? 'FAIL' : 'PASS', stagedPlanning.length ? `private Planning files are staged: ${stagedPlanning.join(', ')}` : 'no private Planning file is staged');
  if (!afterPush) add(staged.length ? 'INFO' : 'WARN', staged.length ? `${staged.length} path(s) staged for the phase commit` : 'nothing is staged yet');

  const unstaged = zlist(git(root, ['diff', '--name-only', '-z'])).filter(f => !f.startsWith(PLANNING));
  if (unstaged.length) add('WARN', `tracked changes not staged (forgotten, or deliberately left out?): ${unstaged.join(', ')}`);
  const untracked = zlist(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).filter(f => !f.startsWith(PLANNING));
  if (untracked.length) add('WARN', `untracked files outside Planning (new records, skills or Codex copies to stage?): ${untracked.slice(0, 20).join(', ')}${untracked.length > 20 ? ` … and ${untracked.length - 20} more` : ''}`);
  if (!afterPush && staged.length && !staged.includes('0- Documentation/06_SESSION_SUMMARY.md')) add('WARN', 'the session summary is not staged; every phase adds an entry on top');

  const touched = new Set([...staged, ...zlist(git(root, ['diff', '--name-only', '-z', 'HEAD']))]);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  for (const owner of OWNERS) {
    const changed = [...touched].some(f => owner.endsWith('/') ? f.startsWith(owner) : f === owner);
    const inHead = afterPush && zlist(git(root, ['show', '--name-only', '-z', '--format=', head])).some(f => owner.endsWith('/') ? f.startsWith(owner) : f === owner);
    add('INFO', `${owner.replace('0- Documentation/', '')}: ${changed ? 'updated in this change' : inHead ? 'updated in the last commit' : 'not changed'}`);
  }

  const summary = path.join(root, '0- Documentation', '06_SESSION_SUMMARY.md');
  const problems = fs.existsSync(summary) ? checkSessionSummary(fs.readFileSync(summary, 'utf8')) : ['06_SESSION_SUMMARY.md not found'];
  add(problems.length ? 'FAIL' : 'PASS', problems.length ? `session summary template: ${problems.join('; ')}` : 'session summary top entry follows the full template');

  if (toolkitCheck) {
    const drift = toolkitCheck(root);
    add(drift.length ? 'FAIL' : 'PASS', drift.length ? `Codex toolkit copies drifted: ${drift.map(d => d.path).join(', ')} (run toolkit-sync --write)` : 'Codex toolkit copies match .claude/');
  }

  const lockFile = path.join(root, LOCK);
  if (fs.existsSync(lockFile)) {
    let lock = null; try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { add('WARN', 'writer lock is not valid JSON'); }
    if (lock) {
      const age = Math.round((now - Date.parse(lock.heartbeatAt)) / 60000);
      const waiting = typeof lock.phase === 'string' && lock.phase.startsWith('awaiting-owner');
      add(afterPush && !waiting ? 'WARN' : 'INFO', `writer lock phase "${lock.phase}", heartbeat ${Number.isFinite(age) ? `${age} min` : 'unknown'} ago${afterPush && !waiting ? '; set it to awaiting-owner before stopping' : ''}`);
    }
  } else add('WARN', 'writer lock file not found');

  if (afterPush) {
    if (staged.length) add('FAIL', 'the index is not empty after the push');
    const remote = remoteSha ? remoteSha(root) : (git(root, ['ls-remote', 'origin', `refs/heads/${BRANCH}`]).split(/\s/)[0] || null);
    add(remote === head ? 'PASS' : 'FAIL', remote === head ? `private remote equals HEAD ${head.slice(0, 7)}` : `private remote ${remote ? remote.slice(0, 7) : 'missing'} differs from HEAD ${head.slice(0, 7)}`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2), root = path.resolve(__dirname, '..', '..', '..');
  if (args.some(a => a !== '--after-push')) { console.error('usage: phase-close-check.cjs [--after-push]'); process.exit(2); }
  let toolkitCheck = null;
  try { toolkitCheck = require(path.join(root, '.claude', 'skills', 'toolkit-sync', 'toolkit-sync.cjs')).check; } catch { /* reported below */ }
  try {
    const results = runChecks(root, { afterPush: args.includes('--after-push'), toolkitCheck });
    if (!toolkitCheck) results.push({ level: 'WARN', msg: 'toolkit-sync is not available; Codex copies were not checked' });
    for (const r of results) console.log(`${r.level.padEnd(4)}  ${r.msg}`);
    const fails = results.filter(r => r.level === 'FAIL').length;
    console.log(fails ? `\n${fails} check(s) failed` : '\nno failures');
    process.exit(fails ? 1 : 0);
  } catch (e) { console.error(`ERROR phase-close-check: ${e.message}`); process.exit(2); }
}

if (require.main === module) main();
module.exports = { checkSessionSummary, runChecks, TEMPLATE, BRANCH };
