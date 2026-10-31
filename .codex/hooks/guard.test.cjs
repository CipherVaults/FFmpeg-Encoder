'use strict';
// Behaviour tests for the PreToolUse safety guard. Run: node --test .claude/hooks/guard.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

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

test('personal media: new files only in the project test folder; no deletes or moves even there (owner decision October 31)', () => {
  const T = 'F:/shadow play/FFmpeg Encoder Tests';
  for (const c of [`cp "F:/shadow play/a.mkv" "${T}/a.mkv"`, `ffmpeg -i "F:/shadow play/a.mkv" -t 5 "${T}/a.mp4"`,
    `echo hi > "${T}/note.txt"`, `echo hi >> "${T}/run 1/log.txt"`, 'Copy-Item x -Destination "F:\\shadow play\\FFmpeg Encoder Tests\\x"',
    'New-Item -ItemType Directory -Path "F:\\shadow play\\FFmpeg Encoder Tests\\run1"', `mkdir -p "/f/shadow play/FFmpeg Encoder Tests/run1"`,
    `cp a.mkv "/f/shadow play/FFmpeg Encoder Tests/a.mkv"`, 'ffmpeg -i "F:/shadow play/a.mkv" -f null -', `node tools/x.cjs > "${T}/out.json"`])
    allowed('Bash', bash(c));
  for (const c of [`rm "${T}/a.mp4"`, `mv "${T}/a.mp4" "${T}/b.mp4"`, 'Remove-Item "F:\\shadow play\\FFmpeg Encoder Tests\\a.mp4"',
    `cp x "${T}/../a.mkv"`, 'cp x "F:/shadow play/FFmpeg Encoder Tests2/a.mkv"', 'ffmpeg -i x "F:/shadow play/a.mp4" -f null -',
    `echo hi > "F:/shadow play/FFmpeg Encoder Tests/../note.txt"`, `ffmpeg -i "${T}/a.mkv" -y "F:/shadow play/Alan Wake/a.mkv"`])
    blocked('Bash', bash(c));
  allowed('Write', { file_path: 'F:\\shadow play\\FFmpeg Encoder Tests\\report.txt' });
  blocked('Write', { file_path: 'F:\\shadow play\\FFmpeg Encoder Tests\\..\\x.txt' });
  blocked('Edit', { file_path: 'F:/shadow play/Alan Wake/notes.txt' });
});

// Review findings S1-S4 (October 31). README.txt is the folder's own existing file.
test('personal media: no links, overwrites, bulk copies, odd spellings or cd tricks', () => {
  const T = 'F:/shadow play/FFmpeg Encoder Tests', M = 'F:/shadow play/Alan Wake/movie.mp4';
  for (const c of [
    // Links would let a later "new file" write reach an original.
    `cp -l "${M}" "${T}/m.mp4"`, `cp --symbolic-link "${M}" "${T}/m.mp4"`, `ln "${M}" "${T}/m.mp4"`, `ln -s "${M}" "${T}/m.mp4"`,
    `New-Item -ItemType HardLink -Target "${M}" -Path "${T}/m.mp4"`, `New-Item -ItemType Junction -Target "F:\\shadow play" -Path "${T}\\j"`,
    `cmd /c mklink /J "${T}\\j" "F:\\shadow play"`, `fsutil hardlink create "${T}\\m.mp4" "${M}"`,
    // Overwriting what already exists, test folder included.
    `echo x > "${T}/README.txt"`, `echo x >> "${T}/README.txt"`, `cp -f a.txt "${T}/README.txt"`, `cp README.txt "${T}"`,
    `Set-Content -Path "${T}/README.txt" -Value x`, `tee -a "${T}/README.txt"`, `ffmpeg -y -i a.mkv "${T}/new.mp4"`,
    `ffmpeg -i a.mkv "${T}/README.txt"`, `Copy-Item a.txt -Destination "${T}/README.txt"`, `cp a.txt "${T}/*.txt"`,
    // robocopy/xcopy switches are not destinations; mirror/move modes delete.
    'robocopy "D:/empty" "F:/shadow play" /MIR', `robocopy "F:/shadow play" "D:/out" a.mkv /MOV`, 'robocopy "F:/shadow play/x" D:/x *.mkv /MOVE',
    'xcopy x.mkv "F:\\shadow play\\" /Y', `robocopy D:/out "${T}" a.mkv`,
    // Other redirects and spellings.
    `node x.cjs 2> "F:/shadow play/err.txt"`, `node x.cjs &> "F:/shadow play/out.txt"`, `echo x >| "F:/shadow play/a.txt"`,
    'rm /f/shadow\\ play/movie.mp4', 'mv /f/shadow\\ play/a.mkv /tmp/', 'echo x > /f/shadow\\ play/a.txt', 'cp a.txt /f/shadow\\ play/Alan\\ Wake/x.txt', 'rm /f/shadow?play/a.mkv', 'rm /f/SHADOW~1/a.mkv',
    'Set-Content "F:\\shadow play\\a.txt" -Value x', 'ri "F:\\shadow play\\a.mkv"', `node -e "require('fs').unlinkSync('${M}')"`,
    `powershell -c "[IO.File]::Delete('${M}')"`, `node -e "require('fs').writeFileSync('${T}/n.txt','x')"`,
    // A cd into the media folder makes relative paths media paths.
    'cd "F:/shadow play" && rm movie.mp4', `cd "${T}" && rm old.mp4`, `cd "${T}" && echo x > a.txt`, 'Set-Location "F:\\shadow play"; Remove-Item a.mkv',
  ]) blocked('Bash', bash(c));
  for (const c of [`cp "${M}" "${T}/movie-copy.mp4"`, `cp "${M}" "${T}"`, 'ffmpeg -i "F:/shadow play/a.mkv" -c copy "D:/out/a.mkv"',
    `ffmpeg -i "${M}" -t 5 "${T}/clip.mp4"`, 'node x.cjs 2>&1 | tee "D:/log.txt"', `ls "${T}"`, 'cd "F:/shadow play" && ls',
    `robocopy "F:/shadow play/Alan Wake" "D:/out" movie.mp4`, `Get-ChildItem "F:\\shadow play" | Out-File "D:\\list.txt"`])
    allowed('Bash', bash(c));
  blocked('Write', { file_path: `${T}/README.txt` });
  blocked('Edit', { file_path: `${T}/README.txt` });
  blocked('MultiEdit', { file_path: `${T}/new.txt` });
});

test('test-folder paths resolve through links: a junction inside the folder cannot lead out', () => {
  const { testFolderPath, MEDIA } = require('./guard.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-media-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-out-'));
  const folder = path.join(root, 'tests'); fs.mkdirSync(folder);
  fs.symlinkSync(outside, path.join(folder, 'j'), 'junction');
  assert.equal(testFolderPath(path.join(folder, 'new.txt'), folder), path.join(folder, 'new.txt'));
  assert.equal(testFolderPath(path.join(folder, 'sub', 'deeper', 'new.txt'), folder), path.join(folder, 'sub', 'deeper', 'new.txt'));
  assert.equal(testFolderPath(path.join(folder, 'j', 'x.txt'), folder), null, 'through the junction');
  for (const bad of [path.join(folder, '..', 'x.txt'), folder + '2\\x', 'x.txt', path.join(folder, 'a?.txt'), path.join(folder, 'a.'), path.join(folder, 'AB~1.TXT')])
    assert.equal(testFolderPath(bad, folder), null, bad);
  for (const s of ['F:/shadow play', 'shadow_play', 'shadow\\ play', 'shadow?play', 'SHADOW~1']) assert.ok(MEDIA.test(s), s);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
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

test('MCP terminal, filesystem and GitHub tools cannot bypass the guard', () => {
  const dc = n => 'mcp__plugin_desktop-commander_desktop-commander__' + n;
  blocked(dc('start_process'), { command: 'git push --force origin codex/v0.7-candidate' });
  blocked(dc('start_process'), { command: 'Remove-Item -Recurse "F:\\shadow play\\OBS"' });
  blocked(dc('interact_with_process'), { pid: 1, input: 'git reset --hard' });
  blocked(dc('write_file'), { path: 'F:\\shadow play\\x.txt', content: 'x' });
  blocked(dc('move_file'), { source: 'F:/shadow play/a.mkv', destination: 'D:/tmp/a.mkv' });
  blocked(dc('edit_block'), { file_path: 'D:/repo/0- Documentation/Planning/0.7/x.md', old_string: 'a', new_string: 'b' });
  blocked(dc('set_config_value'), { key: 'blockedCommands', value: [] });
  blocked('mcp__github__push_files', { owner: 'AE0101', repo: 'FFmpeg-Encoder', branch: 'main' });
  blocked('mcp__github__merge_pull_request', { pullNumber: 1 });
  // Owner decision 2026-10-30: Desktop Commander and agent-memory are disabled for this project entirely.
  blocked(dc('read_file'), { path: 'F:/shadow play/a.mkv' });
  blocked(dc('start_process'), { command: 'git status --porcelain' });
  blocked('mcp__plugin_agent-memory_agent-memory__memory_search', { query: 'x' });
  allowed('mcp__github__get_file_contents', { owner: 'AE0101', repo: 'FFmpeg-Encoder', path: 'README.md' });
  allowed('mcp__a8aaf34a__notion-update-page', { page_id: 'x', content: 'Notes about F:\\shadow play footage' });
});
