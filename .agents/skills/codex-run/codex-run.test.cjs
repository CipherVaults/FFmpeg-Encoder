'use strict';
// Run: node --test .claude/skills/codex-run/codex-run.test.cjs   (uses fake-codex.cjs; never calls real Codex)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const cr = require('./codex-run.cjs');

const SCRIPT = path.join(__dirname, 'codex-run.cjs'), FAKE = path.join(__dirname, 'fake-codex.cjs');
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-'));
  const repo = path.join(root, 'repo'); fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 't@example.invalid'); git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'core.autocrlf', 'false');
  for (const [f, t] of [['README.md', 'readme\n'], ['AGENTS.md', 'rules\n'], ['src/a.cjs', 'module.exports = 0;\n']]) fs.writeFileSync(path.join(repo, f), t);
  git(repo, 'add', '--', 'README.md', 'AGENTS.md', 'src/a.cjs'); git(repo, 'commit', '-q', '-m', 'init');
  const brief = path.join(root, 'brief.md'); fs.writeFileSync(brief, 'Review src/a.cjs for defects.\n');
  return { root, repo, brief, receipts: path.join(root, 'receipts') };
}
function run(fx, mode, extra = [], fake = 'done', env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--mode', mode, '--brief', fx.brief, '--label', 'job', '--repo', fx.repo,
    '--codex-bin', FAKE, '--receipts', fx.receipts, '--timeout-sec', '30', ...extra],
  { cwd: fx.repo, encoding: 'utf8', env: { ...process.env, FAKE_CODEX_MODE: fake, ...env } });
  let summary = null; try { summary = JSON.parse(r.stdout); } catch { /* usage errors print nothing on stdout */ }
  return { status: r.status, summary, stderr: r.stderr };
}
const opts = (fx, extra = []) => cr.parseOptions(['--mode', 'review', '--brief', fx.brief, '--label', 'x', '--repo', fx.repo, '--codex-bin', FAKE, ...extra]);

test('arguments: read-only review, workspace-write slice, prompt on stdin, resume pinned read-only', () => {
  const p = { schema: 's.json', last: 'l.json', workdir: 'W' };
  const review = cr.buildArgs({ mode: 'review', model: 'gpt-6.1-sol', effort: 'xhigh' }, p);
  assert.deepEqual(review.slice(0, 5), ['exec', '--sandbox', 'read-only', '-C', 'W']);
  assert.equal(review.at(-1), '-');
  assert.ok(review.includes('model_reasoning_effort="xhigh"'));
  const slice = cr.buildArgs({ mode: 'slice', model: 'gpt-6.1-sol', effort: 'high' }, p);
  assert.deepEqual(slice.slice(1, 3), ['--sandbox', 'workspace-write']);
  const resume = cr.buildArgs({ mode: 'review', model: 'gpt-6.1-sol', effort: 'xhigh', resume: '0199fake-0000' }, p);
  assert.deepEqual(resume.slice(0, 3), ['exec', 'resume', '0199fake-0000']);
  assert.ok(resume.includes('sandbox_mode="read-only"'));
});

test('guard: every bypass, widening and unknown-config argument is refused', () => {
  const ok = ['exec', '--sandbox', 'read-only', '-'];
  assert.doesNotThrow(() => cr.assertSafeArgs(ok));
  for (const bad of ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--add-dir', '--ignore-rules',
    '--approve-for-me', '--full-auto', '--yolo', '--oss', '--worktree', '--skip-git-repo-check', '--ignore-user-config', '-p', '--profile', '--enable', '-s', '--last'])
    assert.throws(() => cr.assertSafeArgs(['exec', bad, '-']), /refused Codex argument/, bad);
  assert.throws(() => cr.assertSafeArgs(['exec', '--sandbox', 'danger-full-access', '-']), /refused/);
  assert.throws(() => cr.assertSafeArgs(['exec', '--sandbox', 'anything', '-']), /refused sandbox/);
  for (const c of ['sandbox_mode="danger-full-access"', 'shell_environment_policy.inherit=all', 'model_reasoning_effort="xhigh" x', 'sandbox_permissions=["disk-full-read-access"]'])
    assert.throws(() => cr.assertSafeArgs(['exec', '-c', c, '-']), /refused/, c);
  assert.throws(() => cr.assertSafeArgs(['exec', '--sandbox', 'read-only', 'prompt text']), /stdin/);
});

test('options: malformed, oversized and owner-gated inputs fail closed with a usage error', () => {
  const fx = fixture();
  const bad = (extra, re) => assert.throws(() => opts(fx, extra), e => e.code === 'USAGE' && re.test(e.message), extra.join(' '));
  assert.equal(opts(fx).effort, 'xhigh');
  bad(['--mode', 'deploy'], /--mode/);
  bad(['--label', 'Bad Label'], /--label/);
  bad(['--effort', 'max'], /--effort/);
  bad(['--effort', 'ultra'], /--allow-ultra/);
  assert.equal(opts(fx, ['--allow-ultra', '--effort', 'ultra']).effort, 'ultra');
  bad(['--timeout-min', '0'], /timeout/); bad(['--timeout-min', '121'], /timeout/); bad(['--timeout-sec', '2.5'], /timeout/);
  bad(['--base', 'HEAD'], /slice jobs only/);
  assert.throws(() => cr.parseOptions(['--mode', 'slice', '--brief', fx.brief, '--label', 'x', '--repo', fx.repo, '--codex-bin', FAKE, '--base', 'a..b']), /plain Git ref/);
  assert.throws(() => cr.parseOptions(['--mode', 'slice', '--brief', fx.brief, '--label', 'x', '--repo', fx.repo, '--codex-bin', FAKE, '--resume', '0199fake-0000']), /review jobs only/);
  bad(['--resume', 'x'], /session id/);
  bad(['--model', 'gpt;rm'], /--model/);
  bad(['--nope', 'x'], /unknown option/);
  bad(['--codex-bin', path.join(fx.root, 'missing.exe')], /not found/);
  const realBin = path.join(fx.root, 'codex.exe'); fs.writeFileSync(realBin, '');
  bad(['--codex-bin', realBin], /blocked from running real Codex/);
  fs.writeFileSync(fx.brief, 'x'.repeat(64 * 1024 + 1)); bad([], /brief must be/);
  fs.writeFileSync(fx.brief, ''); bad([], /brief must be/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('prompt carries the worker rules, the mode and the brief; the report validator is strict', () => {
  const p = cr.composePrompt({ mode: 'review', briefText: 'Check X.\n' });
  for (const s of ['Read AGENTS.md', 'Never commit, push', 'F:\\shadow play', 'needs_decision', 'MODE: review', '--- BRIEF ---\nCheck X.']) assert.ok(p.includes(s), s);
  const good = { status: 'done', summary: 's', changed_files: [], commands_run: [], findings: [{ severity: 'high', file: 'f', line: 3, issue: 'i' }], questions: [] };
  assert.equal(cr.validateReport(JSON.stringify(good)).ok, true);
  for (const broken of [{ ...good, status: 'ok' }, { ...good, findings: [{ severity: 'high', file: 'f', line: 1.5, issue: 'i' }] }, { ...good, questions: [1] }, [], null])
    assert.equal(cr.validateReport(JSON.stringify(broken)).ok, false);
  assert.equal(cr.validateReport('nope').ok, false);
});

test('review job: done → exit 0 with a full receipt; prompt via stdin; checkout untouched', () => {
  const fx = fixture(), echo = path.join(fx.root, 'echo.json');
  const r = run(fx, 'review', [], 'done', { FAKE_CODEX_ECHO: echo });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.summary.status, 'done'); assert.equal(r.summary.findings, 1);
  assert.equal(r.summary.sessionId, '0199fake-0000-4000-8000-000000000001');
  for (const f of ['receipt.json', 'prompt.md', 'args.json', 'stdout.jsonl', 'stderr.txt', 'last-message.json', 'report.json', 'report.schema.json'])
    assert.ok(fs.existsSync(path.join(r.summary.receipt, f)), f);
  const receipt = JSON.parse(fs.readFileSync(path.join(r.summary.receipt, 'receipt.json'), 'utf8'));
  assert.equal(receipt.checkoutChanged, false); assert.equal(receipt.codex.version, 'codex-cli 0.0.0-fake'); assert.match(receipt.codex.sha256, /^[0-9a-f]{64}$/);
  const seen = JSON.parse(fs.readFileSync(echo, 'utf8'));
  assert.ok(seen.input.includes('Review src/a.cjs for defects.')); assert.equal(seen.args.at(-1), '-');
  const again = run(fx, 'review');
  assert.notEqual(again.summary.receipt, r.summary.receipt, 'a second job never overwrites a receipt');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('failures come back as distinct statuses: failed, rejected, blocked, needs decision, timeout', () => {
  const fx = fixture();
  const fail = run(fx, 'review', [], 'fail');
  assert.equal(fail.status, 1); assert.equal(fs.readFileSync(path.join(fail.summary.receipt, 'stderr.txt'), 'utf8'), 'boom\n');
  assert.equal(run(fx, 'review', [], 'invalid').status, 5);
  const silent = run(fx, 'review', [], 'silent');
  assert.equal(silent.status, 5); assert.match(silent.summary.reason, /no final message/);
  assert.equal(run(fx, 'review', [], 'blocked').status, 3);
  const needs = run(fx, 'review', [], 'needs');
  assert.equal(needs.status, 4); assert.deepEqual(needs.summary.questions, ['Which profile should this use?']);
  const tamper = run(fx, 'review', [], 'review-tamper');
  assert.equal(tamper.status, 5); assert.match(tamper.summary.reason, /checkout changed/);
  const t0 = Date.now(), hang = run(fx, 'review', ['--timeout-sec', '2'], 'hang');
  assert.equal(hang.status, 124); assert.ok(Date.now() - t0 < 25000, 'the hung process tree was killed');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('slice job: edits come back as a patch from a removed worktree; protected paths are rejected', () => {
  const fx = fixture();
  const r = run(fx, 'slice', [], 'slice-edit');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.summary.changedFiles, ['src/added.cjs']);
  const receipt = JSON.parse(fs.readFileSync(path.join(r.summary.receipt, 'receipt.json'), 'utf8'));
  assert.equal(receipt.worktreeRemoved, true); assert.equal(fs.existsSync(receipt.worktree), false);
  assert.deepEqual(receipt.unreportedChanges, []);
  assert.match(fs.readFileSync(path.join(r.summary.receipt, 'patch.diff'), 'utf8'), /src\/added\.cjs/);
  assert.equal(git(fx.repo, 'status', '--porcelain'), '', 'the main checkout is never touched by a slice');
  const prot = run(fx, 'slice', [], 'slice-protected');
  assert.equal(prot.status, 5); assert.match(prot.summary.reason, /protected paths changed: AGENTS\.md/);
  const pr = JSON.parse(fs.readFileSync(path.join(prot.summary.receipt, 'receipt.json'), 'utf8'));
  assert.deepEqual(pr.unreportedChanges, ['AGENTS.md'], 'changes Codex did not report are listed');
  assert.equal(git(fx.repo, 'worktree', 'list').trim().split('\n').length, 1, 'no worktree is left behind');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('protected-path patterns cover records, toolkit, dependencies and the pinned runtime', () => {
  const hit = f => cr.PROTECTED.some(re => re.test(f));
  for (const f of ['0- Documentation/25_0.7_Requirements_and_Evidence.md', '.claude/settings.json', '.codex/hooks.json', '.agents/skills/x/SKILL.md',
    'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json', 'artifacts/v0.7/x', '.gitignore', 'ffmpeg/bin/ffmpeg.exe',
    '.CODEX/config.toml', '.Agents/skills/evil/SKILL.md', 'agents.md', 'src/.gitattributes', 'tests/.gitignore', 'src/.npmrc', '.gitmodules']) assert.ok(hit(f), f);
  for (const f of ['src/native-file-controls.cjs', 'tests/native-file-service.test.cjs', 'ui/styles.css']) assert.ok(!hit(f), f);
});
