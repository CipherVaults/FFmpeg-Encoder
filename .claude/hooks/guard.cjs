'use strict';
// PreToolUse safety guard for FFmpeg Encoder (Claude Code hook).
//
// Turns the project's preservation rules into enforcement instead of intent:
// history/branch protection, owner media protection, private-record freezing and
// no dependency/runtime changes. Exit code 2 blocks the tool call and shows the
// reason to the model; exit 0 allows it. String inspection is defence in depth,
// not a sandbox: it targets the realistic accidental forms of each action.
//
// Owner rules this enforces (record 35, AGENTS.md):
// - never force-push, rewrite history, delete branches/tags or push elsewhere
//   than the private candidate branch;
// - F:\shadow play is Ahmed's personal media: read anything; write NEW files only inside
//   F:\shadow play\FFmpeg Encoder Tests\ (owner decision October 31, record 40); never
//   delete, move, rename, link or overwrite anything there, test folder included;
// - never modify private Planning records or the immutable October 26 snapshot;
// - no dependency/runtime installs or upgrades.

const fs = require('node:fs'), path = require('node:path');
const ALLOWED_PUSH_BRANCH = 'codex/v0.7-candidate';
// Also the escaped (`shadow\ play`), wildcard (`shadow?play`) and 8.3 (`SHADOW~1`) spellings.
const MEDIA = /shadow(\\?[\s_-]|[?*])*play|shadow~\d/i;
const MEDIA_TEST_FOLDER = 'f:\\shadow play\\ffmpeg encoder tests';
const MEDIA_RULE = 'personal media under F:\\shadow play: read anything, write NEW files only in F:\\shadow play\\FFmpeg Encoder Tests\\, never delete, move, rename, link or overwrite';
const insideRoot = (full, root) => { const f = full.toLowerCase(), r = root.toLowerCase(); return f === r || f.startsWith(r + '\\'); };
// The real path of a write target, or null unless it lies inside the test folder (`root`).
// Lexical first (drive-qualified, no `..`, wildcards, 8.3 or trailing dot/space), then the
// deepest existing ancestor is resolved, so a junction or link inside the folder cannot lead out.
function testFolderPath(value, root = MEDIA_TEST_FOLDER) {
  const s = String(value || '').trim().replace(/^\/([a-z])\//i, '$1:/').replace(/\\ /g, ' ');
  if (!/^[a-z]:[\\/]/i.test(s) || s.split(/[\\/]+/).includes('..') || /[*?]|~\d|[. ]$/.test(s)) return null;
  const full = path.win32.resolve(s);
  if (!insideRoot(full, root)) return null;
  let probe = full; const rest = [];
  for (;;) {
    try { fs.lstatSync(probe); break; } catch { const up = path.win32.dirname(probe); if (up === probe) return null; rest.unshift(path.win32.basename(probe)); probe = up; }
  }
  let real; try { real = fs.realpathSync.native(probe); } catch { return null; }
  return insideRoot(path.win32.join(real, ...rest), root) ? full : null;
}
// A media write target must be a new file (or, for directory verbs, any directory) in the test folder.
function mediaTarget(value, { dir = false, sources = [], root = MEDIA_TEST_FOLDER } = {}) {
  if (!MEDIA.test(value)) return;
  const full = testFolderPath(value, root);
  if (!full) block(`${MEDIA_RULE} (target outside the test folder: ${value}).`);
  let st = null; try { st = fs.lstatSync(full); } catch { /* new */ }
  if (dir) { if (st && !st.isDirectory()) block(`${MEDIA_RULE} (${value} exists and is not a folder).`); return; }
  if (st && st.isDirectory() && sources.length) {
    for (const s of sources) {
      if (/[*?]/.test(s)) block(`${MEDIA_RULE} (a wildcard copy into the test folder could overwrite).`);
      if (fs.existsSync(path.win32.join(full, path.win32.basename(s.replace(/\//g, '\\'))))) block(`${MEDIA_RULE} (a file of that name already exists in ${value}).`);
    }
    return;
  }
  if (st) block(`${MEDIA_RULE} (${value} already exists).`);
}
// `>`, `>>`, `2>`, `&>` and `>|` targets, honouring quotes so a path with spaces is read whole; `2>&1` is not a target.
function redirectTargets(segment) {
  const out = [], re = /(?:^|[^>])(?:[0-9]|&)?>>?\|?(?![&>])\s*/g; let m;
  while ((m = re.exec(segment))) {
    const rest = segment.slice(m.index + m[0].length), q = rest[0];
    out.push(q === '"' || q === "'" ? rest.slice(1, rest.indexOf(q, 1) === -1 ? undefined : rest.indexOf(q, 1)) : rest.split(/(?<!\\)\s/)[0].replace(/\\(\s)/g, '$1'));
  }
  return out;
}
const FROZEN_PATHS = [
  /0- Documentation[\\/]+Planning[\\/]/i,
  /native-runtime-paused-wip-2026-10-26/i,
  /[\\/]\.git[\\/]/i,
];
// Verbs that change or remove their operands: any mention of protected media blocks.
const DESTRUCTIVE_VERBS = /(^|[\s;&|(])(rm|rmdir|del|erase|rd|ri|mv|mi|move|ren|rni|rename|truncate|shred|unlink|cipher|sed\s+-i|perl\s+-i|Remove-Item|Move-Item|Rename-Item|Clear-Content|clc|Clear-Item|cli|Set-ItemProperty|attrib|icacls|takeown)\b/i;
// robocopy's mirror/purge/move switches delete files.
const MEDIA_DESTRUCTIVE = /\brobocopy\b.*\/(MIR|PURGE|MOVE?)\b/i;
// Links let a later "new file" write reach an original; inline scripts cannot be read for targets.
const LINK_VERBS = /(^|[\s;&|(])(ln|mklink|fsutil|junction)\b|-ItemType\s+["']?(HardLink|SymbolicLink|Junction)\b/i;
const SCRIPTED = /(\.|::)(Delete|MoveTo|Move|Replace|Copy|CopyTo|WriteAll\w*|AppendAll\w*|Create)\s*\(|\b(unlink(Sync)?|rmSync|rmdirSync|renameSync|writeFileSync|appendFileSync|copyFileSync|cpSync|createWriteStream|os\.(remove|unlink|rename|replace)|shutil\.(rmtree|move|copy\w*))\b/i;
// Verbs that write to a destination: block only when the destination is protected,
// so reading/copying media OUT to project-owned folders stays possible.
const WRITE_TO_VERBS = /(^|[\s;&|(])(cp|copy|cpi|xcopy|robocopy|rsync|touch|tee|Tee-Object|dd|ffmpeg(\.exe)?|Copy-Item|Set-Content|sc|Add-Content|ac|Out-File|New-Item|ni|curl|wget|Invoke-WebRequest|iwr)\b/i;
const DIR_VERBS = /(^|[\s;&|(])(mkdir|md)\b|-ItemType\s+["']?Directory\b/i;
const CHANGE_DIR = /^(cd|chdir|pushd|Set-Location|sl|Push-Location)$/i;
const MEDIA_WRITE_VERBS = new RegExp(`${DESTRUCTIVE_VERBS.source}|${WRITE_TO_VERBS.source}`, 'i');

// One command segment that mentions personal media, or runs after a `cd` into it.
function checkMedia(segment, tokens, inMediaDir) {
  const cpLink = tokens.some(t => /(^|[\\/])cp$/i.test(t)) && tokens.some(t => /^-[a-zA-Z]*[ls][a-zA-Z]*$/.test(t) || /^--(link|symbolic-link)$/.test(t));
  if (DESTRUCTIVE_VERBS.test(segment) || MEDIA_DESTRUCTIVE.test(segment) || LINK_VERBS.test(segment) || cpLink || SCRIPTED.test(segment)) block(`${MEDIA_RULE}.`);
  const redirects = redirectTargets(segment), writes = WRITE_TO_VERBS.test(segment), dirs = DIR_VERBS.test(segment);
  if (inMediaDir && (writes || dirs || redirects.length)) block(`${MEDIA_RULE} (use absolute paths: writes after changing into the media folder are refused).`);
  for (const t of redirects) mediaTarget(t);
  if (!writes && !dirs) return;
  const v = tokens.findIndex(t => WRITE_TO_VERBS.test(t) || DIR_VERBS.test(t));
  const verb = String(tokens[v] || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
  // Windows tools take `/X` switches; POSIX tools take `/tmp`-style paths.
  const winSwitch = t => ['copy', 'xcopy', 'robocopy'].includes(verb) && /^\/[A-Za-z]+(:.*)?$/.test(t);
  const args = tokens.slice(v + 1), positional = args.filter(t => !t.startsWith('-') && !winSwitch(t));
  const named = names => args.flatMap((t, i) => names.test(t) ? [args[i + 1] || ''] : []);
  if (verb === 'robocopy' || verb === 'xcopy' || verb === 'rsync') {
    if (positional.slice(1).some(t => MEDIA.test(t))) block(`${MEDIA_RULE} (no bulk copies into the media folder; copy single files with cp or Copy-Item).`);
    return;
  }
  if (dirs && !writes || /-ItemType\s+["']?Directory\b/i.test(segment)) { for (const t of args) mediaTarget(t, { dir: true }); return; }
  if (['cp', 'copy', 'cpi', 'copy-item'].includes(verb)) {
    const flagged = [...named(/^-(Destination|t)$/i), ...args.filter(t => t.startsWith('--target-directory=')).map(t => t.split('=').slice(1).join('='))];
    const dest = flagged[0] ?? positional[positional.length - 1] ?? '';
    const sources = [...named(/^-(Path|LiteralPath)$/i), ...positional.filter(t => t !== dest)];
    if (flagged.length > 1) block(`${MEDIA_RULE} (more than one destination).`);
    mediaTarget(dest, { sources });
    return;
  }
  if (verb === 'ffmpeg') {
    const outputs = args.filter((t, i) => !t.startsWith('-') && args[i - 1] !== '-i' && MEDIA.test(t));
    if (outputs.length && args.includes('-y')) block(`${MEDIA_RULE} (ffmpeg -y would overwrite).`);
    for (const t of outputs) mediaTarget(t);
    return;
  }
  // Everything else that writes (touch, tee, dd, New-Item, *-Content, Out-File, downloads): every media path is a target.
  for (const t of args) if (!/^if=/i.test(t)) mediaTarget(t.replace(/^of=/i, ''));
}

function block(reason) {
  process.stderr.write(`Blocked by project safety guard: ${reason}\n`);
  process.exit(2);
}

// Split a shell command into simple segments on unquoted separators. Quotes are
// honoured so a commit message mentioning "git push --force" is not a push.
function segments(command) {
  const out = []; let current = ''; let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) { if (ch === quote) quote = null; current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '|' && command[i - 1] === '>') { current += ch; continue; } // `>|` is a redirect, not a pipe
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      out.push(current); current = ''; if (ch === '&' || (ch === '|' && command[i + 1] === '|')) i++; continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

function words(segment) {
  const result = []; let current = ''; let quote = null; let had = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; had = true; continue; }
    if (ch === '\\' && /\s/.test(segment[i + 1] || '')) { current += segment[++i]; continue; } // Git Bash `shadow\ play`
    if (/\s/.test(ch)) { if (current || had) result.push(current); current = ''; had = false; continue; }
    current += ch;
  }
  if (current || had) result.push(current);
  return result;
}

// Remove `git -C <dir>` / `-c k=v` style global options so `git -C x push` is seen.
function gitArgs(tokens) {
  let i = tokens.findIndex(t => /(^|[\\/])git(\.exe)?$/i.test(t));
  if (i === -1) return null;
  const rest = tokens.slice(i + 1);
  while (rest.length && rest[0].startsWith('-')) { const opt = rest.shift(); if (['-C', '-c', '--git-dir', '--work-tree'].includes(opt)) rest.shift(); }
  return rest;
}

function checkGit(args) {
  const [sub, ...rest] = args;
  const has = (...flags) => rest.some(a => flags.includes(a) || flags.some(f => f.endsWith('=') && a.startsWith(f)));
  switch (sub) {
    case 'push': {
      if (has('--force', '-f', '--force-with-lease', '--force-with-lease=', '--force-if-includes', '--mirror', '--delete', '-d', '--prune', '--tags', '--all'))
        block('git push may not force, mirror, delete, prune or push all refs/tags.');
      const positional = rest.filter(a => !a.startsWith('-'));
      for (const refspec of positional.slice(1)) {
        if (refspec.startsWith('+') || refspec.startsWith(':')) block(`refspec "${refspec}" forces or deletes a remote ref.`);
        const destination = refspec.includes(':') ? refspec.split(':').pop() : refspec;
        if (destination.replace(/^refs\/heads\//, '') !== ALLOWED_PUSH_BRANCH && destination !== 'HEAD')
          block(`pushes are limited to ${ALLOWED_PUSH_BRANCH} (got "${refspec}").`);
      }
      return;
    }
    case 'reset': if (has('--hard', '--merge', '--keep')) block('git reset --hard/--merge/--keep can discard preserved work.'); return;
    case 'clean': block('git clean deletes untracked work (private records and evidence live there).'); return;
    case 'checkout': if (rest.includes('--') || rest.includes('.') || has('-f', '--force')) block('git checkout of paths/force can discard uncommitted work.'); return;
    case 'restore': if (!has('--staged', '-S') || has('--worktree', '-W')) block('git restore of the worktree discards uncommitted work (only --staged is allowed).'); return;
    case 'switch': if (has('-f', '--force', '--discard-changes', '-C', '--force-create')) block('forced branch switching can discard work.'); return;
    case 'stash': if (['drop', 'clear', 'pop'].includes(rest[0])) block('git stash drop/clear/pop risks losing preserved work.'); return;
    case 'rebase': case 'filter-branch': case 'filter-repo': case 'replace': block(`git ${sub} rewrites history.`); return;
    case 'add':
      // Bulk staging would sweep the private Planning records (2 tracked-dirty, 15 untracked) into a commit.
      if (has('-A', '--all', '-u', '--update', '--no-ignore-removal') || rest.some(a => a === '.' || a === '*' || a === ':/' || a === ':(top)'))
        block('bulk staging (-A/-u/./*) is not allowed; stage explicit paths and exclude 0- Documentation/Planning.');
      if (rest.some(a => /Planning/i.test(a) && !a.startsWith(':(exclude)') && !a.startsWith(':!'))) block('private Planning records must never be staged.');
      return;
    case 'commit':
      if (has('--amend')) block('commit --amend rewrites history; make a new commit.');
      if (has('--no-verify', '-n')) block('hooks may not be skipped.');
      if (has('-a', '--all') || rest.some(a => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a) && !a.startsWith('--'))) block('commit -a would stage private Planning edits; stage explicit paths.');
      return;
    case 'branch': if (has('-D', '-d', '--delete', '-M', '-m', '--move', '-f', '--force')) block('branch delete/rename/force is not allowed.'); return;
    case 'tag': if (has('-d', '--delete', '-f', '--force')) block('tag delete/force is not allowed (accepted local-v0.5.0/0.6.0 are protected).'); return;
    case 'update-ref': if (has('-d')) block('ref deletion is not allowed.'); return;
    case 'reflog': if (rest[0] === 'expire' || rest[0] === 'delete') block('reflog expiry removes recovery history.'); return;
    case 'gc': if (rest.some(a => a.startsWith('--prune'))) block('gc --prune removes recoverable objects.'); return;
    case 'remote': if (['add', 'remove', 'rm', 'rename', 'set-url'].includes(rest[0])) block('remote changes are not authorized (no remote migration).'); return;
    case 'config': if (rest.some(a => /^(core\.hooksPath|remote\.|url\.|credential)/i.test(a))) block('git config for remotes/credentials/hooks is not allowed.'); return;
    default: return;
  }
}

function checkInstall(tokens) {
  const [tool, sub] = [String(tokens[0] || '').toLowerCase().replace(/\.(exe|cmd)$/, ''), String(tokens[1] || '').toLowerCase()];
  if (['npm', 'pnpm', 'yarn'].includes(tool) && ['install', 'i', 'add', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'audit', 'dedupe', 'prune', 'ci', 'link'].includes(sub))
    block(`${tool} ${sub} changes dependencies; dependency/runtime upgrades are not authorized.`);
  if (['npx', 'pnpx'].includes(tool) && /^(npm-check-updates|ncu|electron-rebuild)$/i.test(sub)) block('dependency upgrade tooling is not authorized.');
  if (['winget', 'choco', 'scoop', 'pip', 'pip3', 'msiexec'].includes(tool)) block(`${tool} installs software machine-wide; not authorized.`);
}

function checkCommand(command) {
  if (typeof command !== 'string') return;
  let inMediaDir = false; // a `cd` into the media folder makes later relative paths media paths
  for (const segment of segments(command)) {
    const tokens = words(segment);
    const git = gitArgs(tokens);
    if (git) checkGit(git);
    checkInstall(tokens);
    if (MEDIA.test(segment) || inMediaDir) checkMedia(segment, tokens, inMediaDir);
    if (CHANGE_DIR.test(tokens[0] || '') && MEDIA.test(segment)) inMediaDir = true;
    if (/(^|[\s;&|(])(rm|Remove-Item|rd|rmdir|del)\b/i.test(segment) && /(-r\b|-rf\b|-fr\b|-Recurse\b|\/s\b)/i.test(segment)) {
      const target = segment.replace(/["']/g, '');
      const scratch = /(AppData[\\/]+Local[\\/]+Temp|[\\/]tmp[\\/]|scratchpad|\$TMPDIR|os\.tmpdir)/i.test(target);
      if (!scratch) block('recursive deletes are only allowed inside temp/scratch directories.');
    }
    for (const frozen of FROZEN_PATHS) if (frozen.test(segment) && MEDIA_WRITE_VERBS.test(segment)) block('private Planning records, the immutable pause snapshot and .git internals are frozen.');
  }
}

function checkPath(file, name) {
  if (typeof file !== 'string' || !file) return;
  if (MEDIA.test(file)) {
    // Edit tools always change an existing file; Write may only create a new one.
    if (name !== 'Write') block(`${MEDIA_RULE} (${name} changes an existing file).`);
    mediaTarget(file);
  }
  for (const frozen of FROZEN_PATHS) if (frozen.test(file)) block('this path is a frozen private/immutable record.');
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 4 * 1024 * 1024) block('hook input exceeded its bound.'); });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch { process.stderr.write('Safety guard could not parse hook input; allowing.\n'); process.exit(0); }
    const name = input.tool_name || '';
    const tool = input.tool_input || {};
    if (name === 'Bash' || name === 'PowerShell') checkCommand(tool.command);
    if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(name)) checkPath(tool.file_path || tool.notebook_path, name);
    if (name.startsWith('mcp__')) checkMcp(name, tool);
    process.exit(0);
  });
}
// The tests reach the path helpers directly; blocking still exits the process, so they spawn the hook for verdicts.
module.exports = { testFolderPath, insideRoot, redirectTargets, MEDIA };

// MCP tools (for example Desktop Commander's terminal/filesystem tools or the
// GitHub API server) never pass through the Bash/Edit matchers, so without this
// they would bypass every rule above. Commands get the Bash rules; any
// write/move/delete-style tool gets the media and frozen-path rules on every
// path-like field; GitHub API writes are refused so git stays on the guarded CLI.
function checkMcp(name, input) {
  // Owner decision 2026-10-30 (record 36): these plugins are disabled for this
  // project. Refuse every tool call even if the plugin is still switched on.
  if (/desktop-commander|agent-memory/i.test(name)) block('this plugin is disabled for FFmpeg Encoder by owner decision (record 36); use the guarded built-in tools.');
  const tool = name.split('__').pop().toLowerCase();
  if (/github/i.test(name) && /(push|merge|delete|create_or_update|update_ref|create_branch|fork|release|update_pull|create_pull|create_repo|tag)/.test(tool))
    block(`GitHub API writes bypass the git safeguards (${tool}); use the git CLI on the candidate branch.`);
  const strings = [];
  (function collect(value, key, depth) {
    if (depth > 4 || strings.length > 200) return;
    if (typeof value === 'string') strings.push({ key: String(key || '').toLowerCase(), value });
    else if (Array.isArray(value)) value.forEach(v => collect(v, key, depth + 1));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collect(v, k, depth + 1);
  })(input, '', 0);
  if (/(process|terminal|shell|command|exec|run|interact)/.test(tool))
    for (const { key, value } of strings) if (/^(command|cmd|input|script|args?)$/.test(key)) checkCommand(value);
  if (/(write|edit|move|rename|delete|remove|create|copy|set_config|patch|append|mkdir|upload)/.test(tool))
    for (const { key, value } of strings) {
      if (!/(path|file|source|destination|target|dir|directory|from|to|old|new)/.test(key)) continue;
      if (MEDIA.test(value)) block('personal media under F:\\shadow play is read-only, including through MCP tools.');
      for (const frozen of FROZEN_PATHS) if (frozen.test(value)) block('this path is a frozen private/immutable record (MCP tool).');
    }
  if (/set_config/.test(tool)) block('changing an MCP tool\'s own safety configuration is not allowed from a session.');
}
