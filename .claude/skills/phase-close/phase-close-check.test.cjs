'use strict';
// Run: node --test .claude/skills/phase-close/phase-close-check.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const pc = require('./phase-close-check.cjs');

const entry = (titles = pc.TEMPLATE, fill = 'text') => ['# 📘 Session: October 30, 2026 — FFmpeg Encoder — test', '',
  ...titles.flatMap(t => [`## ${t}`, fill, '']), '## October26 older entry', 'old', ''].join('\n');
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-close-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  git(root, 'init', '-q', '-b', pc.BRANCH); git(root, 'config', 'user.email', 't@example.invalid'); git(root, 'config', 'user.name', 't');
  git(root, 'config', 'core.autocrlf', 'false');
  put('0- Documentation/06_SESSION_SUMMARY.md', entry());
  put('0- Documentation/10_Continuation_State.md', 'state\n');
  put('0- Documentation/Planning/private.md', 'private\n');
  put('src/a.cjs', 'a\n');
  git(root, 'add', '--', '0- Documentation/06_SESSION_SUMMARY.md', '0- Documentation/10_Continuation_State.md', '0- Documentation/Planning/private.md', 'src/a.cjs');
  git(root, 'commit', '-q', '-m', 'init');
  put('artifacts/v0.7/claude-continuation/writer-lock.json', JSON.stringify({ phase: 'awaiting-owner', heartbeatAt: new Date().toISOString() }));
  return { root, put };
}
const levels = (results, level) => results.filter(r => r.level === level).map(r => r.msg);

test('session summary: newest full-template entry passes; missing, reordered, empty or buried entries fail', () => {
  assert.deepEqual(pc.checkSessionSummary(entry()), []);
  assert.deepEqual(pc.checkSessionSummary(entry().replace(/\n/g, '\r\n')), [], 'CRLF files are read the same');
  assert.match(pc.checkSessionSummary(entry(pc.TEMPLATE.filter(t => t !== '🧠 Key Insights'))).join(), /expected "🧠 Key Insights"/);
  assert.match(pc.checkSessionSummary(entry(pc.TEMPLATE.slice(0, 13))).join(), /expected "🔍 Confidence Level"/, 'a cut-short entry is caught even when an older entry follows');
  assert.match(pc.checkSessionSummary(entry(pc.TEMPLATE.slice(0, 13)).split('## October26')[0]).join(), /missing section "🔍 Confidence Level"/);
  const swapped = [...pc.TEMPLATE]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert.match(pc.checkSessionSummary(entry(swapped)).join(), /section 1 is "🕒 Time"/);
  assert.match(pc.checkSessionSummary(entry(pc.TEMPLATE, '')).join(), /is empty/);
  assert.match(pc.checkSessionSummary('## October26 older entry\n\n' + entry()).join(), /newest entry goes on top/);
});

test('pre-commit: clean phase commit passes and reports which owner records changed', () => {
  const { root, put } = fixture();
  put('0- Documentation/10_Continuation_State.md', 'new state\n');
  git(root, 'add', '--', '0- Documentation/10_Continuation_State.md');
  const r = pc.runChecks(root, { toolkitCheck: () => [] });
  assert.deepEqual(levels(r, 'FAIL'), []);
  assert.ok(levels(r, 'INFO').includes('10_Continuation_State.md: updated in this change'));
  assert.ok(levels(r, 'INFO').includes('01_Current_State.md: not changed'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('pre-commit failures: wrong branch, staged Planning, broken template, toolkit drift; unstaged work warns', () => {
  const { root, put } = fixture();
  put('0- Documentation/Planning/private.md', 'edited\n');
  git(root, 'add', '--', '0- Documentation/Planning/private.md');
  put('0- Documentation/06_SESSION_SUMMARY.md', entry(pc.TEMPLATE.slice(1)));
  put('src/a.cjs', 'changed but not staged\n');
  let r = pc.runChecks(root, { toolkitCheck: () => [{ path: '.codex/hooks/guard.cjs', state: 'differs' }] });
  const fails = levels(r, 'FAIL').join('\n');
  assert.match(fails, /private Planning files are staged: 0- Documentation\/Planning\/private\.md/);
  assert.match(fails, /session summary template/);
  assert.match(fails, /Codex toolkit copies drifted: \.codex\/hooks\/guard\.cjs/);
  assert.match(levels(r, 'WARN').join('\n'), /tracked changes not staged.*src\/a\.cjs/);
  assert.match(levels(r, 'WARN').join('\n'), /session summary is not staged/);
  put('src/new-skill.cjs', 'new\n');
  assert.match(levels(pc.runChecks(root, { toolkitCheck: () => [] }), 'WARN').join('\n'), /untracked files outside Planning.*src\/new-skill\.cjs/);
  git(root, 'reset', '-q');
  git(root, 'mv', '0- Documentation/Planning/private.md', 'moved.md');
  assert.match(levels(pc.runChecks(root, { toolkitCheck: () => [] }), 'FAIL').join('\n'), /Planning files are staged/, 'a staged move out of Planning is caught');
  git(root, 'checkout', '-q', '-b', 'feature');
  r = pc.runChecks(root, { toolkitCheck: () => [] });
  assert.match(levels(r, 'FAIL').join('\n'), /branch is feature/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('after push: remote must equal HEAD, the index must be empty and the lock should await the owner', () => {
  const { root, put } = fixture();
  const head = git(root, 'rev-parse', 'HEAD').trim();
  let r = pc.runChecks(root, { afterPush: true, toolkitCheck: () => [], remoteSha: () => head });
  assert.deepEqual(levels(r, 'FAIL'), []);
  assert.ok(levels(r, 'PASS').some(m => m.startsWith('private remote equals HEAD')));
  r = pc.runChecks(root, { afterPush: true, toolkitCheck: () => [], remoteSha: () => 'f'.repeat(40) });
  assert.match(levels(r, 'FAIL').join(), /differs from HEAD/);
  r = pc.runChecks(root, { afterPush: true, toolkitCheck: () => [], remoteSha: () => null });
  assert.match(levels(r, 'FAIL').join(), /private remote missing/);
  put('artifacts/v0.7/claude-continuation/writer-lock.json', JSON.stringify({ phase: 'c1-r3', heartbeatAt: new Date().toISOString() }));
  r = pc.runChecks(root, { afterPush: true, toolkitCheck: () => [], remoteSha: () => head });
  assert.match(levels(r, 'WARN').join(), /set it to awaiting-owner/);
  put('src/b.cjs', 'b\n'); git(root, 'add', '--', 'src/b.cjs');
  r = pc.runChecks(root, { afterPush: true, toolkitCheck: () => [], remoteSha: () => head });
  assert.match(levels(r, 'FAIL').join(), /index is not empty/);
  fs.rmSync(root, { recursive: true, force: true });
});
