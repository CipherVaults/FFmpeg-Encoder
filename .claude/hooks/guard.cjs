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
// - never delete/move/modify anything under F:\shadow play (read-only test media);
// - never modify private Planning records or the immutable October 26 snapshot;
// - no dependency/runtime installs or upgrades.

const ALLOWED_PUSH_BRANCH = 'codex/v0.7-candidate';
const MEDIA = /shadow[\s_-]*play/i;
const FROZEN_PATHS = [
  /0- Documentation[\\/]+Planning[\\/]/i,
  /native-runtime-paused-wip-2026-10-26/i,
  /[\\/]\.git[\\/]/i,
];
// Verbs that change or remove their operands: any mention of protected media blocks.
const DESTRUCTIVE_VERBS = /(^|[\s;&|(])(rm|rmdir|del|erase|rd|mv|move|ren|rename|truncate|sed\s+-i|Remove-Item|Move-Item|Rename-Item|Clear-Content|Set-ItemProperty|attrib|icacls|takeown)\b/i;
// Verbs that write to a destination: block only when the destination is protected,
// so reading/copying media OUT to project-owned folders stays possible.
const WRITE_TO_VERBS = /(^|[\s;&|(])(cp|copy|xcopy|robocopy|touch|tee|dd|ffmpeg(\.exe)?|Copy-Item|Set-Content|Add-Content|Out-File|New-Item)\b/i;
const MEDIA_WRITE_VERBS = new RegExp(`${DESTRUCTIVE_VERBS.source}|${WRITE_TO_VERBS.source}`, 'i');

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
  for (const ch of segment) {
    if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; had = true; continue; }
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
  for (const segment of segments(command)) {
    const tokens = words(segment);
    const git = gitArgs(tokens);
    if (git) checkGit(git);
    checkInstall(tokens);
    if (MEDIA.test(segment)) {
      const positional = tokens.filter(t => !t.startsWith('-'));
      const destination = positional[positional.length - 1] || '';
      const namedDestination = tokens.some((t, i) => /^-(Destination|Path|FilePath|LiteralPath|o|out)$/i.test(t) && MEDIA.test(tokens[i + 1] || ''));
      const redirected = /(^|[^>&0-9])>{1,2}\s*["']?[^\s"']*shadow[\s_-]*play/i.test(segment);
      if (DESTRUCTIVE_VERBS.test(segment) || redirected || (WRITE_TO_VERBS.test(segment) && (MEDIA.test(destination) || namedDestination)))
        block('personal media under F:\\shadow play is read-only: no delete, move, rename, overwrite or writing into it.');
    }
    if (/(^|[\s;&|(])(rm|Remove-Item|rd|rmdir|del)\b/i.test(segment) && /(-r\b|-rf\b|-fr\b|-Recurse\b|\/s\b)/i.test(segment)) {
      const target = segment.replace(/["']/g, '');
      const scratch = /(AppData[\\/]+Local[\\/]+Temp|[\\/]tmp[\\/]|scratchpad|\$TMPDIR|os\.tmpdir)/i.test(target);
      if (!scratch) block('recursive deletes are only allowed inside temp/scratch directories.');
    }
    for (const frozen of FROZEN_PATHS) if (frozen.test(segment) && MEDIA_WRITE_VERBS.test(segment)) block('private Planning records, the immutable pause snapshot and .git internals are frozen.');
  }
}

function checkPath(file) {
  if (typeof file !== 'string' || !file) return;
  if (MEDIA.test(file)) block('personal media under F:\\shadow play is read-only.');
  for (const frozen of FROZEN_PATHS) if (frozen.test(file)) block('this path is a frozen private/immutable record.');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 4 * 1024 * 1024) block('hook input exceeded its bound.'); });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.stderr.write('Safety guard could not parse hook input; allowing.\n'); process.exit(0); }
  const name = input.tool_name || '';
  const tool = input.tool_input || {};
  if (name === 'Bash' || name === 'PowerShell') checkCommand(tool.command);
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(name)) checkPath(tool.file_path || tool.notebook_path);
  if (name.startsWith('mcp__')) checkMcp(name, tool);
  process.exit(0);
});

// MCP tools (for example Desktop Commander's terminal/filesystem tools or the
// GitHub API server) never pass through the Bash/Edit matchers, so without this
// they would bypass every rule above. Commands get the Bash rules; any
// write/move/delete-style tool gets the media and frozen-path rules on every
// path-like field; GitHub API writes are refused so git stays on the guarded CLI.
function checkMcp(name, input) {
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
