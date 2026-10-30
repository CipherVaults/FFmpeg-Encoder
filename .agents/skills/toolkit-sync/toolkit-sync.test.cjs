'use strict';
// Run: node --test .claude/skills/toolkit-sync/toolkit-sync.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sync = require('./toolkit-sync.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const GUARD = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.cjs"';
const settings = (extra = {}) => JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|mcp__.*', hooks: [{ type: 'command', command: GUARD, timeout: 10 }] }] }, ...extra });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-sync-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reads "diffs" — finds C:\\bugs\nmodel: opus\neffort: xhigh\n---\n\nReview rules.\n');
  put('.claude/skills/demo/SKILL.md', 'Run node .claude/skills/demo/run.cjs; baseline lives in artifacts/v0.7/claude-continuation/x.json\n');
  put('.claude/skills/demo/run.cjs', '// node .claude/skills/demo/run.cjs\n');
  put('.claude/hooks/guard.cjs', '// guard\n');
  put('.claude/hooks/guard.test.cjs', '// guard test\n');
  put('.claude/settings.json', settings());
  return { root, put };
}

test('the repository copies under .codex/ and .agents/ match .claude/', () => {
  assert.deepEqual(sync.check(repoRoot), [], 'run: node .claude/skills/toolkit-sync/toolkit-sync.cjs --write');
});

test('agent TOML escapes basic strings and refuses unsafe bodies, efforts and names', () => {
  const toml = sync.agentToml(sync.parseAgent('---\nname: a\ndescription: say "hi" \\ there\neffort: high\n---\nBody\n', 'a.md'), 'a.md');
  assert.match(toml, /^description = "say \\"hi\\" \\\\ there"$/m);
  assert.match(toml, /^model_reasoning_effort = "high"$/m);
  assert.match(toml, /^developer_instructions = '''\nBody'''$/m);
  assert.throws(() => sync.agentToml(sync.parseAgent("---\nname: a\ndescription: d\n---\nx ''' y\n", 'a.md'), 'a.md'), /cannot be a TOML literal/);
  assert.throws(() => sync.agentToml(sync.parseAgent('---\nname: a\ndescription: d\n---\nbell \u0007\n', 'a.md'), 'a.md'), /control character/);
  assert.throws(() => sync.parseAgent('---\nname: a\ndescription: d\neffort: max\n---\nx\n', 'a.md'), /no Codex equivalent/);
  assert.throws(() => sync.parseAgent('---\nname: ../evil\ndescription: d\n---\nx\n', 'a.md'), /unsafe agent name/);
  assert.throws(() => sync.parseAgent('no frontmatter', 'a.md'), /missing frontmatter/);
});

test('skill docs move only their own script path, never other .claude-named repository paths', () => {
  const out = sync.rewriteSkillDoc('node .claude/skills/demo/run.cjs and artifacts/v0.7/claude-continuation/b.json and .claude/skills/other/x.cjs', 'demo');
  assert.equal(out, 'node .agents/skills/demo/run.cjs and artifacts/v0.7/claude-continuation/b.json and .claude/skills/other/x.cjs');
});

test('write then check is clean; edits, missing files and extras are drift; CRLF is not', () => {
  const { root, put } = fixture();
  assert.equal(sync.check(root).length, 6);
  sync.write(root);
  assert.deepEqual(sync.check(root), []);
  const agent = fs.readFileSync(path.join(root, '.codex/agents/reviewer.toml'), 'utf8');
  assert.match(agent, /^description = "Reads \\"diffs\\" — finds C:\\\\bugs"$/m);
  assert.doesNotMatch(agent, /opus/, 'Claude model names are not carried into Codex');
  assert.equal(fs.readFileSync(path.join(root, '.agents/skills/demo/SKILL.md'), 'utf8'), 'Run node .agents/skills/demo/run.cjs; baseline lives in artifacts/v0.7/claude-continuation/x.json\n');
  const hooks = JSON.parse(fs.readFileSync(path.join(root, '.codex/hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.PreToolUse[0].matcher, 'Bash|mcp__.*');
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, `node '${path.join(root, '.codex', 'hooks', 'guard.cjs').replace(/'/g, `'\\''`)}'`);

  fs.writeFileSync(path.join(root, '.agents/skills/demo/run.cjs'), '// node .claude/skills/demo/run.cjs\r\n');
  assert.deepEqual(sync.check(root), [], 'CRLF line endings alone are not drift');
  put('.codex/hooks/guard.cjs', '// stale guard\n');
  put('.codex/agents/stray.toml', 'name = "stray"\n');
  fs.rmSync(path.join(root, '.agents/skills/demo/SKILL.md'));
  assert.deepEqual(sync.check(root).map(d => `${d.state.split(' ')[0]} ${d.path}`).sort(),
    ['differs .codex/hooks/guard.cjs', 'extra .codex/agents/stray.toml', 'missing .agents/skills/demo/SKILL.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('unknown hooks, agent file-name mismatches and symlinks are refused instead of guessed', () => {
  const { root, put } = fixture();
  put('.claude/settings.json', settings({}).replace(GUARD.replace(/"/g, '\\"'), 'node other.cjs'));
  assert.throws(() => sync.generate(root), /expected exactly one PreToolUse hook/);
  put('.claude/settings.json', JSON.stringify({ hooks: { ...JSON.parse(settings()).hooks, Stop: [] } }));
  assert.throws(() => sync.generate(root), /need a Codex mapping/);
  put('.claude/settings.json', settings());
  put('.claude/agents/wrong.md', '---\nname: right\ndescription: d\n---\nx\n');
  assert.throws(() => sync.generate(root), /file name must match/);
  fs.rmSync(path.join(root, '.claude/agents/wrong.md'));
  let linked = false;
  try { fs.symlinkSync(path.join(root, '.claude/hooks/guard.cjs'), path.join(root, '.claude/skills/demo/link.cjs')); linked = true; } catch { /* no symlink privilege on this machine */ }
  if (linked) assert.throws(() => sync.generate(root), /symbolic links are not synced/);
  fs.rmSync(root, { recursive: true, force: true });
});
