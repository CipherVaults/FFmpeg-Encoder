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
  for (const [f, t] of [['README.md', 'readme\n'], ['AGENTS.md', 'rules\n'], ['src/a.cjs', 'module.exports = 0;\n'], ['.gitignore', 'ffmpeg/\n.claude/settings.local.json\n']])
    fs.writeFileSync(path.join(repo, f), t);
  git(repo, 'add', '--', 'README.md', 'AGENTS.md', 'src/a.cjs', '.gitignore'); git(repo, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(repo, 'ffmpeg')); fs.writeFileSync(path.join(repo, 'ffmpeg', 'ffmpeg.exe'), 'pinned runtime\n'); // ignored, like the real one
  const brief = path.join(root, 'brief.md'); fs.writeFileSync(brief, 'Review src/a.cjs for defects.\n');
  const home = path.join(root, 'codex-home'); fs.mkdirSync(home);
  return { root, repo, brief, home, receipts: path.join(root, 'receipts') };
}
function run(fx, mode, extra = [], fake = 'done', env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--mode', mode, '--brief', fx.brief, '--label', 'job', '--repo', fx.repo,
    '--codex-bin', FAKE, '--codex-home', fx.home, '--receipts', fx.receipts, '--timeout-sec', '30', ...extra],
  { cwd: fx.repo, encoding: 'utf8', env: { ...process.env, FAKE_CODEX_MODE: fake, ...env } });
  let summary = null; try { summary = JSON.parse(r.stdout); } catch { /* usage errors print nothing on stdout */ }
  return { status: r.status, summary, stderr: r.stderr };
}
const receiptOf = r => JSON.parse(fs.readFileSync(path.join(r.summary.receipt, 'receipt.json'), 'utf8'));
const opts = (fx, extra = [], env = {}) => cr.parseOptions(['--mode', 'review', '--brief', fx.brief, '--label', 'x', '--repo', fx.repo,
  '--codex-bin', FAKE, '--codex-home', fx.home, '--receipts', fx.receipts, ...extra], { ...process.env, ...env });
// A session file in `day` (default today) whose newest token_count event carries `limits`, written at `at`.
const seedLimits = (fx, limits, { day = null, at = new Date(), name = 'seed' } = {}) => {
  const d = day || [String(at.getFullYear()), String(at.getMonth() + 1).padStart(2, '0'), String(at.getDate()).padStart(2, '0')];
  const dir = path.join(fx.home, 'sessions', ...d); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-${name}.jsonl`), JSON.stringify({ timestamp: at.toISOString(), type: 'event_msg', payload: { type: 'token_count', rate_limits: limits } }) + '\n');
};
const win = (used, minutes, resetsAt = 4102444800) => ({ used_percent: used, window_minutes: minutes, resets_at: resetsAt });

test('arguments: full access in this folder, no user config or memories, prompt on stdin, resume keeps the same fixed set', () => {
  const p = { schema: 's.json', last: 'l.json' };
  const fresh = cr.buildArgs({ mode: 'work', model: 'gpt-6.1-sol', effort: 'xhigh', repo: 'R' }, p);
  assert.deepEqual(fresh.slice(0, 3), ['exec', '-C', 'R']);
  for (const a of ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--ignore-user-config', 'model_reasoning_effort="xhigh"', 'features.memories=false'])
    assert.ok(fresh.includes(a), a);
  assert.equal(fresh.at(-1), '-');
  const resume = cr.buildArgs({ mode: 'review', model: 'gpt-6.1-sol', effort: 'high', resume: '0199fake-0000', repo: 'R' }, p);
  assert.deepEqual(resume.slice(0, 3), ['exec', 'resume', '0199fake-0000']);
  assert.ok(resume.includes('--ignore-user-config') && !resume.includes('-C') && !resume.includes('--color'), 'resume rejects -C and --color');
});

test('guard: widening, unknown-config and missing fixed arguments are refused', () => {
  const ok = cr.buildArgs({ mode: 'review', model: 'm', effort: 'xhigh', repo: 'R' }, { schema: 's', last: 'l' });
  assert.doesNotThrow(() => cr.assertSafeArgs(ok));
  for (const bad of ['--add-dir', '--ignore-rules', '--approve-for-me', '--full-auto', '--yolo', '--oss', '--worktree', '--skip-git-repo-check', '-p', '--profile', '--enable', '--disable', '-s', '--sandbox', '--last'])
    assert.throws(() => cr.assertSafeArgs([...ok.slice(0, -1), bad, '-']), /refused Codex argument/, bad);
  for (const c of ['shell_environment_policy.inherit=all', 'model_reasoning_effort="ultra"', 'model_reasoning_effort="xhigh" x', 'features.memories=true'])
    assert.throws(() => cr.assertSafeArgs([...ok.slice(0, -1), '-c', c, '-']), /refused/, c);
  assert.throws(() => cr.assertSafeArgs(ok.filter(a => a !== '--ignore-user-config')), /missing fixed argument/);
  assert.throws(() => cr.assertSafeArgs([...ok.slice(0, -1), 'prompt text']), /stdin/);
});

test('options: malformed, oversized and out-of-policy inputs fail closed with a usage error', () => {
  const fx = fixture();
  const bad = (extra, re, env) => assert.throws(() => opts(fx, extra, env), e => e.code === 'USAGE' && re.test(e.message), extra.join(' '));
  assert.equal(opts(fx).effort, 'xhigh'); assert.equal(opts(fx).timeoutSec, 3600);
  bad(['--mode', 'slice'], /--mode/);
  bad(['--label', 'Bad Label'], /--label/);
  bad(['--effort', 'ultra'], /no ultra/);
  assert.equal(opts(fx, ['--effort', 'max']).effort, 'max');
  bad(['--allow', 'src'], /work jobs only/);
  const work = extra => cr.parseOptions(['--mode', 'work', '--brief', fx.brief, '--label', 'x', '--repo', fx.repo, '--codex-bin', FAKE, '--receipts', fx.receipts, ...extra]);
  assert.throws(() => work([]), /at least one --allow/);
  for (const a of ['../x', 'src/../AGENTS.md', '/abs', 'C:\\x', 'AGENTS.md', '.claude', '0- Documentation/x.md', 'package.json', '.', 'src//x'])
    assert.throws(() => work(['--allow', a]), /--allow/, a);
  assert.deepEqual(work(['--allow', 'src\\', '--allow', 'tests/a.test.cjs']).allow, ['src', 'tests/a.test.cjs']);
  bad(['--timeout-min', '0'], /timeout/); bad(['--timeout-min', '241'], /timeout/); bad(['--timeout-sec', '2.5'], /timeout/);
  bad(['--resume', 'x'], /session id/);
  bad(['--resume', '0199fake-0000-4000-8000-00000000dead'], /started by this wrapper/);
  bad(['--model', 'gpt;rm'], /--model/);
  bad(['--nope', 'x'], /unknown option/);
  bad(['--codex-bin', path.join(fx.root, 'missing.exe')], /not found/);
  const realBin = path.join(fx.root, 'codex.exe'); fs.writeFileSync(realBin, '');
  bad(['--codex-bin', realBin], /real Codex works only in/);
  fs.writeFileSync(fx.brief, 'x'.repeat(64 * 1024 + 1)); bad([], /brief must be/);
  fs.writeFileSync(fx.brief, ''); bad([], /brief must be/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('prompt carries the team roles, the folder, the active status, the media rule, the progress file and the brief', () => {
  const p = cr.composePrompt({ mode: 'work', allow: ['src', 'tests'], repo: 'D:\\R', briefText: 'Fix X.\n' }, { progress: 'D:\\P\\progress.md' });
  for (const s of ['Read AGENTS.md', 'Work only in this folder: D:\\R', 'October 26 archive', 'Development is ACTIVE', 'Never commit, push',
    'F:\\shadow play\\FFmpeg Encoder Tests\\', 'never delete, move, rename or overwrite', 'D:\\P\\progress.md', 'needs_decision',
    'MODE: work. Change only files under: src, tests', '--- BRIEF ---\nFix X.']) assert.ok(p.includes(s), s);
  assert.ok(cr.composePrompt({ mode: 'review', allow: [], repo: 'R', briefText: 'x' }, { progress: 'p' }).includes('MODE: review. Change no files'));
  const good = { status: 'done', summary: 's', changed_files: [], commands_run: [], findings: [{ severity: 'high', file: 'f', line: 3, issue: 'i' }], questions: [] };
  assert.equal(cr.validateReport(JSON.stringify(good)).ok, true);
  for (const broken of [{ ...good, status: 'ok' }, { ...good, findings: [{ severity: 'high', file: 'f', line: 1.5, issue: 'i' }] }, { ...good, questions: [1] }, [], null])
    assert.equal(cr.validateReport(JSON.stringify(broken)).ok, false);
  assert.equal(cr.validateReport('nope').ok, false);
});

test('quota: 80% of the 5-hour window and 100% of longer windows stop new jobs; a passed reset clears a reading', () => {
  const now = Date.parse('2026-10-31T20:00:00Z'), later = now / 1000 + 3600, earlier = now / 1000 - 60;
  const verdict = limits => cr.quotaVerdict({ at: '2026-10-31T19:59:00Z', limits }, now);
  assert.equal(cr.quotaVerdict(null).ok, true);
  assert.equal(verdict({ primary: win(79, 300, later), secondary: win(89, 10080, later) }).ok, true);
  assert.equal(verdict({ primary: win(80, 300, later), secondary: win(10, 10080, later) }).ok, false);
  assert.equal(verdict({ primary: win(5, 300, later), secondary: win(99, 10080, later) }).ok, true, 'weekly 99% still starts');
  assert.equal(verdict({ primary: win(5, 300, later), secondary: win(100, 10080, later) }).ok, false);
  assert.equal(verdict({ primary: win(99, 43200, later) }).ok, true, 'a monthly window uses the 100% limit');
  const reset = verdict({ primary: win(95, 300, earlier), secondary: win(40, 10080, later) });
  assert.equal(reset.ok, true); assert.equal(reset.windows[0].usedPercent, 0); assert.equal(reset.windows[0].resetSinceReading, true);
  assert.equal(verdict({ primary: win(10, 300, later), rate_limit_reached_type: 'primary' }).ok, false);
  assert.match(verdict({ primary: win(85, 300, later) }).note, /85% of the 300-minute window \(limit 80%\)/);
  // A reached limit clears when THAT window resets, not only when every window has.
  assert.equal(verdict({ primary: win(100, 300, earlier), secondary: win(50, 10080, later), rate_limit_reached_type: 'primary' }).ok, true);
  assert.equal(verdict({ primary: win(10, 300, earlier), secondary: win(95, 10080, later), rate_limit_reached_type: 'secondary' }).ok, false);
  // Present but unreadable readings stop the job; a window of unknown length uses the 5-hour limit.
  for (const bad of [{ rate_limit_reached_type: 'primary' }, { primary: { used_percent: 'n/a', window_minutes: 300 } }, {}])
    assert.equal(verdict(bad).ok, false, JSON.stringify(bad));
  assert.equal(verdict({ primary: { used_percent: 85 } }).ok, false);
  assert.equal(verdict({ primary: { used_percent: '85', window_minutes: 300, resets_at: later } }).ok, false, 'a numeric string still counts');
});

test('quota reading: the newest reading wins even in a long-lived session filed under an old start date', () => {
  const fx = fixture(), now = new Date();
  seedLimits(fx, { primary: win(10, 300), secondary: win(10, 10080), plan_type: 'plus' }, { at: new Date(now - 3600000), name: 'today-older' });
  seedLimits(fx, { primary: win(85, 300), secondary: win(20, 10080), plan_type: 'plus' }, { day: ['2026', '01', '01'], at: now, name: 'january-thread' });
  const reading = cr.quotaFrom(cr.sessionFiles(fx.home));
  assert.match(reading.file, /january-thread/); assert.equal(cr.quotaVerdict(reading).ok, false);
  assert.equal(run(fx, 'review').status, 6);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('quota gate: over the limit, no Codex process starts and the receipt says why', () => {
  const fx = fixture(), echo = path.join(fx.root, 'echo.json');
  seedLimits(fx, { primary: win(85, 300), secondary: win(20, 10080), plan_type: 'plus' });
  const r = run(fx, 'review', [], 'done', { FAKE_CODEX_ECHO: echo });
  assert.equal(r.status, 6); assert.match(r.summary.reason, /not started: over the limit/);
  assert.equal(fs.existsSync(echo), false, 'Codex was never started');
  assert.equal(receiptOf(r).status, 'quota');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('review job: done → exit 0 with a full receipt, quota readings and a backup of the dirty files; checkout untouched', () => {
  const fx = fixture(), echo = path.join(fx.root, 'echo.json');
  fs.writeFileSync(path.join(fx.repo, 'src', 'a.cjs'), 'module.exports = 9;\n');
  const r = run(fx, 'review', [], 'done', { FAKE_CODEX_ECHO: echo });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.summary.status, 'done'); assert.equal(r.summary.findings, 1);
  assert.equal(r.summary.sessionId, '0199fake-0000-4000-8000-000000000001');
  for (const f of ['receipt.json', 'prompt.md', 'args.json', 'stdout.jsonl', 'stderr.txt', 'last-message.json', 'report.json', 'report.schema.json', 'progress.md', 'before/SHA256SUMS'])
    assert.ok(fs.existsSync(path.join(r.summary.receipt, f)), f);
  assert.equal(fs.readFileSync(path.join(r.summary.receipt, 'before', 'src', 'a.cjs'), 'utf8'), 'module.exports = 9;\n');
  const receipt = receiptOf(r);
  assert.deepEqual(receipt.changedFiles, []); assert.equal(receipt.codex.version, 'codex-cli 0.0.0-fake'); assert.match(receipt.codex.sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.quotaBefore.note, 'no Codex quota reading found yet');
  assert.equal(receipt.quotaAfter.windows[0].usedPercent, 12); assert.equal(receipt.jobTokens.total_tokens, 1010);
  const seen = JSON.parse(fs.readFileSync(echo, 'utf8'));
  assert.ok(seen.input.includes('Review src/a.cjs for defects.')); assert.equal(seen.args.at(-1), '-');
  const again = run(fx, 'review');
  assert.notEqual(again.summary.receipt, r.summary.receipt, 'a second job never overwrites a receipt');
  assert.equal(receiptOf(again).quotaBefore.windows[1].usedPercent, 30, 'the previous job\'s reading gates the next one');
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
  assert.equal(tamper.status, 5); assert.match(tamper.summary.reason, /checkout changed during a review: README\.md/);
  const t0 = Date.now(), hang = run(fx, 'review', ['--timeout-sec', '2'], 'hang');
  assert.equal(hang.status, 124); assert.ok(Date.now() - t0 < 25000, 'the hung process tree was killed');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('work job: edits inside --allow pass; outside, protected, Planning, unreported and Git changes are rejected', () => {
  const fx = fixture(), work = (fake, extra = ['--allow', 'src']) => run(fx, 'work', extra, fake);
  const ok = work('work-edit');
  assert.equal(ok.status, 0, ok.stderr); assert.deepEqual(ok.summary.changedFiles, ['src/added.cjs']);
  assert.deepEqual(receiptOf(ok).unreportedChanges, [], 'an absolute reported path matches its repository name');
  fs.rmSync(path.join(fx.repo, 'src', 'added.cjs'));
  const outside = work('work-outside');
  assert.equal(outside.status, 5); assert.match(outside.summary.reason, /outside --allow: README\.md/);
  git(fx.repo, 'restore', '--', 'README.md');
  const prot = work('work-protected', ['--allow', 'src']);
  assert.equal(prot.status, 5); assert.match(prot.summary.reason, /protected paths changed: AGENTS\.md/);
  git(fx.repo, 'restore', '--', 'AGENTS.md');
  const plan = work('work-planning');
  assert.equal(plan.status, 5); assert.match(plan.summary.reason, /Planning records changed/);
  fs.rmSync(path.join(fx.repo, '0- Documentation'), { recursive: true });
  const unrep = work('work-unreported');
  assert.equal(unrep.status, 5); assert.match(unrep.summary.reason, /missing from the report: src\/added\.cjs/);
  fs.rmSync(path.join(fx.repo, 'src', 'added.cjs'));
  const commit = work('commit');
  assert.equal(commit.status, 5); assert.match(commit.summary.reason, /changed Git/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('a usage-limit stop returns quota with the partial changes listed; only this wrapper\'s sessions resume', () => {
  const fx = fixture();
  const hit = run(fx, 'work', ['--allow', 'src'], 'quota-hit');
  assert.equal(hit.status, 6); assert.match(hit.summary.reason, /usage limit; resume this session/);
  assert.deepEqual(hit.summary.changedFiles, ['src/added.cjs']);
  fs.writeFileSync(path.join(hit.summary.receipt, 'progress.md'), 'step 1 done; next: step 2\n');
  const echo = path.join(fx.root, 'echo.json');
  const resumed = run(fx, 'work', ['--allow', 'src', '--resume', hit.summary.sessionId], 'work-edit', { FAKE_CODEX_ECHO: echo });
  assert.equal(resumed.status, 0, resumed.stderr);
  const seen = JSON.parse(fs.readFileSync(echo, 'utf8'));
  assert.deepEqual(seen.args.slice(0, 3), ['exec', 'resume', hit.summary.sessionId]);
  assert.ok(seen.input.includes(path.join(hit.summary.receipt, 'progress.md')), 'the earlier progress notes are pointed to');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('what git status cannot show: ignored protected roots, hidden flags, a forged backup, tamper-then-timeout', () => {
  const fx = fixture();
  const ign = run(fx, 'review', [], 'ignored-tamper');
  assert.equal(ign.status, 5); assert.match(ign.summary.reason, /ignored or Git-internal paths changed: \.claude\/settings\.local\.json, ffmpeg\/ffmpeg\.exe/);
  fs.writeFileSync(path.join(fx.repo, 'ffmpeg', 'ffmpeg.exe'), 'pinned runtime\n'); fs.rmSync(path.join(fx.repo, '.claude'), { recursive: true });
  const hide = run(fx, 'work', ['--allow', 'src'], 'hide');
  assert.equal(hide.status, 5); assert.match(hide.summary.reason, /skip-worktree\/assume-unchanged flags \(AGENTS\.md\)/);
  const flagged = run(fx, 'review');
  assert.equal(flagged.status, 5); assert.match(flagged.summary.reason, /not started: Git hides changes to AGENTS\.md/);
  git(fx.repo, 'update-index', '--no-skip-worktree', 'AGENTS.md'); git(fx.repo, 'restore', '--', 'AGENTS.md');
  const forged = run(fx, 'work', ['--allow', 'src'], 'backup-tamper');
  assert.equal(forged.status, 5); assert.match(forged.summary.reason, /backup changed/);
  const t0 = Date.now(), hung = run(fx, 'work', ['--allow', 'src', '--timeout-sec', '3'], 'commit-hang');
  assert.equal(hung.status, 5); assert.match(hung.summary.reason, /^timed out; Codex changed Git/); assert.ok(Date.now() - t0 < 30000);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('start refusals and quota detection: a staged index never starts; a stdout usage-limit event is a quota stop', () => {
  const fx = fixture(), echo = path.join(fx.root, 'echo.json');
  fs.writeFileSync(path.join(fx.repo, 'src', 'a.cjs'), 'staged\n'); git(fx.repo, 'add', '--', 'src/a.cjs');
  const staged = run(fx, 'review', [], 'done', { FAKE_CODEX_ECHO: echo });
  assert.equal(staged.status, 5); assert.match(staged.summary.reason, /not started: the index is not empty/); assert.equal(fs.existsSync(echo), false);
  git(fx.repo, 'restore', '--staged', '--', 'src/a.cjs'); git(fx.repo, 'restore', '--', 'src/a.cjs');
  const q = run(fx, 'review', [], 'quota-stdout');
  assert.equal(q.status, 6); assert.match(q.summary.reason, /usage limit/);
  const work = run(fx, 'work', ['--allow', 'src'], 'work-edit');
  assert.equal(fs.readFileSync(path.join(work.summary.receipt, 'before', 'src', 'a.cjs'), 'utf8'), 'module.exports = 0;\n', 'clean tracked files under --allow are backed up');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('checkout state sees content changes to already-dirty files and reverts to clean', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.repo, 'src', 'a.cjs'), 'one\n');
  const a = cr.checkoutState(fx.repo);
  fs.writeFileSync(path.join(fx.repo, 'src', 'a.cjs'), 'two\n');
  assert.deepEqual(cr.changedPaths(a, cr.checkoutState(fx.repo)), ['src/a.cjs']);
  git(fx.repo, 'restore', '--', 'src/a.cjs');
  assert.deepEqual(cr.changedPaths(a, cr.checkoutState(fx.repo)), ['src/a.cjs']);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('protected-path patterns cover records, toolkit, dependencies and the pinned runtime', () => {
  const hit = f => cr.PROTECTED.some(re => re.test(f));
  for (const f of ['0- Documentation/25_0.7_Requirements_and_Evidence.md', '.claude/settings.json', '.codex/hooks.json', '.agents/skills/x/SKILL.md',
    'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json', 'artifacts/v0.7/x', '.gitignore', 'ffmpeg/bin/ffmpeg.exe',
    '.CODEX/config.toml', '.Agents/skills/evil/SKILL.md', 'agents.md', 'src/.gitattributes', 'tests/.gitignore', 'src/.npmrc', '.gitmodules']) assert.ok(hit(f), f);
  for (const f of ['src/native-file-controls.cjs', 'tests/native-file-service.test.cjs', 'ui/styles.css']) assert.ok(!hit(f), f);
});
