'use strict';
// Behaviour tests for the PreToolUse safety guard. Run: node --test .claude/hooks/guard.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const guard = path.join(__dirname, 'guard.cjs');
const run = (tool_name, tool_input) => spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name, tool_input }), encoding: 'utf8' });
const blocked = (tool, input) => { const r = run(tool, input); assert.equal(r.status, 2, `expected block: ${JSON.stringify(input)}\n${r.stderr}`); return r.stderr; };
const allowed = (tool, input) => { const r = run(tool, input); assert.equal(r.status, 0, `expected allow: ${JSON.stringify(input)}\n${r.stderr}`); };
const bash = command => ({ command });

test('history and branch protection', () => {
  for (const c of ['git push --force origin codex/v0.7-candidate', 'git push -f', 'git push --force-with-lease',
    'git push origin main', 'git push origin +codex/v0.7-candidate', 'git push origin :codex/v0.7-candidate', 'git push --tags',
    'git -C "D:/x" push origin HEAD:main', 'git reset --hard HEAD~1', 'git clean -fd', 'git checkout -- src/a.cjs', 'git checkout .',
    'git restore src/a.cjs', 'git rebase -i HEAD~2', 'git commit --amend -m x', 'git commit --no-verify -m x', 'git branch -D old',
    'git tag -d local-v0.6.0', 'git stash drop', 'git reflog expire --all', 'git remote set-url origin x', 'cd repo && git reset --hard'])
    blocked('Bash', bash(c));
  for (const c of ['git push origin codex/v0.7-candidate', 'git push', 'git push origin HEAD:codex/v0.7-candidate', 'git status --porcelain',
    'git restore --staged src/a.cjs', 'git commit -q -F - ', 'git log --oneline -5', 'git diff 8ef7ad1 -- src', 'git checkout -b feature',
    'git commit -m "explain why git push --force is blocked"'])
    allowed('Bash', bash(c));
});

test('private Planning records are never bulk- or explicitly staged', () => {
  for (const c of ['git add -A', 'git add .', 'git add -u', 'git add --all', 'git add "0- Documentation/Planning/x.md"', 'git commit -am "x"', 'git commit -a -m x'])
    blocked('Bash', bash(c));
  allowed('Bash', bash(`git add -- AGENTS.md "0- Documentation" ':(exclude)0- Documentation/Planning'`));
  allowed('Bash', bash('git add src/native-file-template.cjs tests/native-file-template.test.cjs'));
});

test('personal media is read-only but readable and copyable out', () => {
  for (const c of ['rm "F:/shadow play/a.mkv"', 'Remove-Item -LiteralPath "F:\\shadow play\\a.mkv"', 'mv "F:/shadow play/a.mkv" /tmp/',
    'Rename-Item "F:\\shadow play\\a.mkv" b.mkv', 'cp /tmp/x.mkv "F:/shadow play/x.mkv"', 'echo hi > "F:/shadow play/note.txt"',
    'ffmpeg -i "F:/shadow play/a.mkv" "F:/shadow play/a.mp4"', 'Copy-Item x -Destination "F:\\shadow play\\x"'])
    blocked('Bash', bash(c));
  for (const c of ['ls "F:/shadow play"', 'ffprobe -v error -show_format "F:/shadow play/a.mkv"', 'sha256sum "F:/shadow play/a.mkv"',
    'cp "F:/shadow play/a.mkv" "F:/FFmpeg Encoder Test Outputs/a.mkv"', 'ffmpeg -i "F:/shadow play/a.mkv" -t 5 "F:/FFmpeg Encoder Test Outputs/a.mp4"'])
    allowed('Bash', bash(c));
  blocked('PowerShell', bash('Remove-Item -Recurse "F:\\shadow play\\OBS"'));
  blocked('Write', { file_path: 'F:\\shadow play\\x.txt' });
  blocked('Edit', { file_path: 'F:/shadow play/x.txt' });
});

test('recursive deletes only in temp/scratch; frozen records stay frozen', () => {
  blocked('Bash', bash('rm -rf "D:/Claude\'s Projects/FFmpeg Encoder/artifacts"'));
  blocked('PowerShell', bash('Remove-Item -Recurse -Force src'));
  allowed('Bash', bash('rm -rf "/c/Users/Ahmed/AppData/Local/Temp/claude/x/scratchpad/run1"'));
  blocked('Write', { file_path: "D:\\Claude's Projects\\FFmpeg Encoder\\0- Documentation\\Planning\\0.7\\2026-10-11\\x.md" });
  blocked('Edit', { file_path: 'D:/x/artifacts/v0.7/non-hdr-completion-2026-10-26/native-runtime-paused-wip-2026-10-26/src/a.cjs' });
  allowed('Write', { file_path: "D:\\Claude's Projects\\FFmpeg Encoder\\src\\native-file-template.cjs" });
});

test('no dependency or machine-wide installs', () => {
  for (const c of ['npm install left-pad', 'npm i', 'npm update', 'npm ci', 'winget install x', 'pip install x', 'npx npm-check-updates -u'])
    blocked('Bash', bash(c));
  for (const c of ['npm test', 'node --test tests/a.test.cjs', 'npm run test:layout']) allowed('Bash', bash(c));
});

test('malformed hook input does not brick the session', () => {
  const r = spawnSync(process.execPath, [guard], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});
