'use strict';
// Generates the Codex copies of the Claude toolkit and checks them for drift.
// Usage (repository root): node .claude/skills/toolkit-sync/toolkit-sync.cjs [--check | --write]
// .claude/ is the single source. Generated outputs: .codex/agents/*.toml, .codex/hooks/guard*.cjs,
// .codex/hooks.json and .agents/skills/**. Line endings are ignored when comparing (Git autocrlf).
const fs = require('node:fs'), path = require('node:path');

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const MANAGED = ['.codex/agents', '.codex/hooks', '.codex/hooks.json', '.agents/skills'];
const lf = s => s.replace(/\r\n/g, '\n');
const posix = p => p.split(path.sep).join('/');

function parseAgent(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(lf(text));
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = {};
  for (const line of m[1].split('\n')) { const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (kv) meta[kv[1]] = kv[2].trim(); }
  for (const k of ['name', 'description']) if (!meta[k]) throw new Error(`${file}: frontmatter needs ${k}`);
  if (!/^[a-z][a-z0-9-]*$/.test(meta.name)) throw new Error(`${file}: unsafe agent name ${JSON.stringify(meta.name)}`);
  if (meta.effort && !EFFORTS.has(meta.effort)) throw new Error(`${file}: effort ${meta.effort} has no Codex equivalent`);
  return { meta, body: m[2].trim() };
}

const tomlBasic = (s, file) => {
  if (CONTROL.test(s) || /[\t\n]/.test(s)) throw new Error(`${file}: control character in a TOML basic string`);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
};
function agentToml({ meta, body }, file) {
  if (body.includes("'''")) throw new Error(`${file}: body contains ''' and cannot be a TOML literal string`);
  if (CONTROL.test(body)) throw new Error(`${file}: control character in the agent body`);
  const lines = [`name = ${tomlBasic(meta.name, file)}`, `description = ${tomlBasic(meta.description, file)}`];
  if (meta.effort) lines.push(`model_reasoning_effort = ${tomlBasic(meta.effort, file)}`);
  lines.push(`developer_instructions = '''\n${body}'''`, '');
  return lines.join('\n');
}

// Only the skill's own script path moves. Everything else (for example artifacts/v0.7/claude-continuation/)
// is a real repository path and must stay as written; the Codex importer's blanket rename broke it.
const rewriteSkillDoc = (text, name) => text.split(`.claude/skills/${name}/`).join(`.agents/skills/${name}/`);

const shQuote = s => `'${s.replace(/'/g, `'\\''`)}'`;
function hooksJson(root, settingsText) {
  const settings = JSON.parse(settingsText);
  const pre = (settings.hooks && settings.hooks.PreToolUse) || [];
  const guardCommand = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.cjs"';
  if (pre.length !== 1 || pre[0].hooks.length !== 1 || pre[0].hooks[0].command !== guardCommand)
    throw new Error('.claude/settings.json: expected exactly one PreToolUse hook running the guard; update toolkit-sync before syncing new hooks');
  if (Object.keys(settings.hooks).length !== 1) throw new Error('.claude/settings.json: hooks other than PreToolUse need a Codex mapping in toolkit-sync');
  const hook = { type: 'command', command: `node ${shQuote(path.join(root, '.codex', 'hooks', 'guard.cjs'))}`, timeout: pre[0].hooks[0].timeout };
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: pre[0].matcher, hooks: [hook] }] } }, null, 2) + '\n';
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`${posix(path.relative(base, p))}: symbolic links are not synced`);
    if (e.isDirectory()) out.push(...walk(p, base)); else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

// Returns Map(relative POSIX output path -> text).
function generate(root) {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const out = new Map();
  const agentsDir = path.join(root, '.claude', 'agents');
  for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).sort()) {
    const rel = `.claude/agents/${f}`, agent = parseAgent(read(rel), rel);
    if (`${agent.meta.name}.md` !== f) throw new Error(`${rel}: file name must match agent name ${agent.meta.name}`);
    out.set(`.codex/agents/${agent.meta.name}.toml`, agentToml(agent, rel));
  }
  for (const f of ['guard.cjs', 'guard.test.cjs']) out.set(`.codex/hooks/${f}`, read(`.claude/hooks/${f}`));
  out.set('.codex/hooks.json', hooksJson(root, read('.claude/settings.json')));
  const skillsDir = path.join(root, '.claude', 'skills');
  for (const name of fs.readdirSync(skillsDir).sort()) {
    const dir = path.join(skillsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`.claude/skills/${name}: unsafe skill name`);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error(`.claude/skills/${name}: SKILL.md missing`);
    for (const relFile of walk(dir)) {
      const text = fs.readFileSync(path.join(dir, relFile), 'utf8');
      out.set(`.agents/skills/${name}/${posix(relFile)}`, posix(relFile) === 'SKILL.md' ? rewriteSkillDoc(text, name) : text);
    }
  }
  return out;
}

function existingManaged(root) {
  const found = [];
  for (const rel of MANAGED) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) found.push(...walk(p).map(f => `${rel}/${posix(f)}`)); else found.push(rel);
  }
  return found;
}

function check(root) {
  const outputs = generate(root), drift = [];
  for (const [rel, text] of outputs) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) drift.push({ path: rel, state: 'missing' });
    else if (lf(fs.readFileSync(p, 'utf8')) !== lf(text)) drift.push({ path: rel, state: 'differs' });
  }
  for (const rel of existingManaged(root)) if (!outputs.has(rel)) drift.push({ path: rel, state: 'extra (no .claude source; remove it by hand)' });
  return drift;
}

function write(root) {
  const written = [];
  for (const [rel, text] of generate(root)) {
    const p = path.join(root, rel);
    if (fs.existsSync(p) && lf(fs.readFileSync(p, 'utf8')) === lf(text)) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    written.push(rel);
  }
  return written;
}

function main() {
  const args = process.argv.slice(2), root = path.resolve(__dirname, '..', '..', '..');
  if (args.some(a => !['--check', '--write'].includes(a)) || args.length > 1) { console.error('usage: toolkit-sync.cjs [--check | --write]'); process.exit(2); }
  try {
    if (args[0] === '--write') { const w = write(root); console.log(w.length ? `wrote ${w.length} file(s):\n  ${w.join('\n  ')}` : 'already in sync'); }
    const drift = check(root);
    if (!drift.length) { console.log('PASS toolkit-sync: Codex copies match .claude/'); return; }
    console.log(`FAIL toolkit-sync: ${drift.length} drifted path(s)`);
    for (const d of drift) console.log(`  ${d.state}: ${d.path}`);
    process.exit(1);
  } catch (e) { console.error(`ERROR toolkit-sync: ${e.message}`); process.exit(2); }
}

if (require.main === module) main();
module.exports = { parseAgent, agentToml, rewriteSkillDoc, hooksJson, generate, check, write };
