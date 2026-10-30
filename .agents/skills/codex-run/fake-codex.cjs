'use strict';
// Test double for codex.exe, used only by codex-run.test.cjs. FAKE_CODEX_MODE picks the behaviour.
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 0.0.0-fake'); process.exit(0); }
const val = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
const report = (status, extra = {}) => fs.writeFileSync(val('-o'),
  JSON.stringify({ status, summary: `fake ${status}`, changed_files: [], commands_run: [], findings: [], questions: [], ...extra }));
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CODEX_ECHO) fs.writeFileSync(process.env.FAKE_CODEX_ECHO, JSON.stringify({ args, input, cwd: process.cwd() }));
  console.log(JSON.stringify({ type: 'thread.started', thread_id: '0199fake-0000-4000-8000-000000000001' }));
  const workdir = val('-C') || process.cwd();
  switch (process.env.FAKE_CODEX_MODE || 'done') {
    case 'done': report('done', { findings: [{ severity: 'low', file: 'src/a.cjs', line: 1, issue: 'example' }] }); break;
    case 'blocked': report('blocked'); break;
    case 'needs': report('needs_decision', { questions: ['Which profile should this use?'] }); break;
    case 'invalid': fs.writeFileSync(val('-o'), 'not json'); break;
    case 'silent': break;
    case 'fail': process.stderr.write('boom\n'); process.exit(7); break;
    case 'hang': setInterval(() => {}, 1000); break;
    case 'slice-edit':
      fs.writeFileSync(path.join(workdir, 'src', 'added.cjs'), 'module.exports = 1;\n');
      report('done', { changed_files: ['src/added.cjs'] }); break;
    case 'slice-protected':
      fs.appendFileSync(path.join(workdir, 'AGENTS.md'), 'tampered\n');
      report('done', { changed_files: [] }); break;
    case 'review-tamper':
      fs.appendFileSync(path.join(workdir, 'README.md'), 'tampered\n');
      report('done'); break;
    default: process.exit(9);
  }
});
