'use strict';
// Test double for codex.exe, used only by codex-run.test.cjs. FAKE_CODEX_MODE picks the behaviour.
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 0.0.0-fake'); process.exit(0); }
const val = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
const report = (status, extra = {}) => fs.writeFileSync(val('-o'),
  JSON.stringify({ status, summary: `fake ${status}`, changed_files: [], commands_run: [], findings: [], questions: [], ...extra }));
const id = args[1] === 'resume' ? args[2] : process.env.FAKE_CODEX_ID || '0199fake-0000-4000-8000-000000000001';
// Like real Codex: a session file under CODEX_HOME/sessions/<local date>/ whose token_count events carry the plan limits.
function rollout() {
  const now = new Date(), dir = path.join(process.env.CODEX_HOME, 'sessions', String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  const limits = JSON.parse(process.env.FAKE_CODEX_LIMITS || '{"primary":{"used_percent":12,"window_minutes":300,"resets_at":4102444800},'
    + '"secondary":{"used_percent":30,"window_minutes":10080,"resets_at":4102444800},"plan_type":"plus","rate_limit_reached_type":null}');
  fs.appendFileSync(path.join(dir, `rollout-fake-${id}.jsonl`), JSON.stringify({ timestamp: now.toISOString(), type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010 } }, rate_limits: limits } }) + '\n');
}
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CODEX_ECHO) fs.writeFileSync(process.env.FAKE_CODEX_ECHO, JSON.stringify({ args, input, cwd: process.cwd() }));
  console.log(JSON.stringify({ type: 'thread.started', thread_id: id }));
  rollout();
  const workdir = val('-C') || process.cwd(), write = (f, t) => fs.writeFileSync(path.join(workdir, f), t);
  switch (process.env.FAKE_CODEX_MODE || 'done') {
    case 'done': report('done', { findings: [{ severity: 'low', file: 'src/a.cjs', line: 1, issue: 'example' }] }); break;
    case 'blocked': report('blocked'); break;
    case 'needs': report('needs_decision', { questions: ['Which profile should this use?'] }); break;
    case 'invalid': fs.writeFileSync(val('-o'), 'not json'); break;
    case 'silent': break;
    case 'fail': process.stderr.write('boom\n'); process.exit(7); break;
    case 'hang': setInterval(() => {}, 1000); break;
    case 'work-edit': write('src/added.cjs', 'module.exports = 1;\n'); report('done', { changed_files: [path.join(workdir, 'src', 'added.cjs')] }); break;
    case 'work-outside': write('README.md', 'changed\n'); report('done', { changed_files: ['README.md'] }); break;
    case 'work-protected': fs.appendFileSync(path.join(workdir, 'AGENTS.md'), 'tampered\n'); report('done', { changed_files: ['AGENTS.md'] }); break;
    case 'work-unreported': write('src/added.cjs', 'module.exports = 2;\n'); report('done'); break;
    case 'work-planning': fs.mkdirSync(path.join(workdir, '0- Documentation', 'Planning'), { recursive: true });
      write('0- Documentation/Planning/x.md', 'x\n'); report('done', { changed_files: ['0- Documentation/Planning/x.md'] }); break;
    case 'commit':
      write('src/added.cjs', 'module.exports = 3;\n');
      spawnSync('git', ['add', '--', 'src/added.cjs'], { cwd: workdir }); spawnSync('git', ['commit', '-q', '-m', 'sneaky'], { cwd: workdir });
      report('done', { changed_files: ['src/added.cjs'] }); break;
    case 'quota-hit': write('src/added.cjs', 'module.exports = 4;\n');
      process.stderr.write("ERROR: You've hit your usage limit. Try again at 12:29 AM.\n"); process.exit(1); break;
    case 'review-tamper': fs.appendFileSync(path.join(workdir, 'README.md'), 'tampered\n'); report('done'); break;
    case 'quota-stdout': console.log(JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } })); process.exit(1); break;
    case 'commit-hang':
      write('src/added.cjs', 'module.exports = 5;\n');
      spawnSync('git', ['add', '--', 'src/added.cjs'], { cwd: workdir }); spawnSync('git', ['commit', '-q', '-m', 'sneaky'], { cwd: workdir });
      setInterval(() => {}, 1000); break;
    case 'ignored-tamper': // ignored files that `git status` never lists
      write('ffmpeg/ffmpeg.exe', 'swapped\n'); fs.mkdirSync(path.join(workdir, '.claude'), { recursive: true });
      write('.claude/settings.local.json', '{"disableAllHooks":true}\n'); report('done'); break;
    case 'hide': // hide an edit from `git status`
      spawnSync('git', ['update-index', '--skip-worktree', 'AGENTS.md'], { cwd: workdir });
      fs.appendFileSync(path.join(workdir, 'AGENTS.md'), 'hidden\n'); report('done'); break;
    case 'backup-tamper': {
      const progress = /append one line to (.+progress\.md):/.exec(input)[1];
      fs.writeFileSync(path.join(path.dirname(progress), 'before', 'src', 'a.cjs'), 'forged\n'); report('done'); break;
    }
    default: process.exit(9);
  }
});
