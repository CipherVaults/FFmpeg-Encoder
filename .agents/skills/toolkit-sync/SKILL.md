---
name: toolkit-sync
description: Regenerate and drift-check the Codex copies of the FFmpeg Encoder Claude toolkit (.codex/agents, .codex/hooks, .agents/skills) from .claude/. Use after any change to .claude/agents, .claude/skills, .claude/hooks or .claude/settings.json, before committing, and after the Codex app re-imports the Claude setup.
---

# Toolkit sync (Claude → Codex)

```bash
node .agents/skills/toolkit-sync/toolkit-sync.cjs --check   # PASS, or lists drifted paths (exit 1)
node .agents/skills/toolkit-sync/toolkit-sync.cjs --write   # regenerate, then check
```

- `.claude/` is the only source. Never edit the files under `.codex/` or `.agents/skills/` by hand; edit the `.claude/` original and run `--write`.
- What it generates:
  - Each `.claude/agents/<name>.md` becomes `.codex/agents/<name>.toml`, with name, description, `model_reasoning_effort` and the body as `developer_instructions`. Claude model names are not copied; Codex uses its own model.
  - The guard and its tests are copied byte for byte to `.codex/hooks/`.
  - `.codex/hooks.json` runs that copy with the same matcher as `.claude/settings.json`.
  - Each skill is copied to `.agents/skills/<name>/`. Only its own `.claude/skills/<name>/` path is rewritten in `SKILL.md`.
- Why only that one path is rewritten: the Codex app's own import on October 30 replaced every "claude" with "Codex". That pointed the skills at non-existent paths such as `.Codex/skills/...` and `artifacts/v0.7/Codex-continuation/...`. If the app imports again, run `--write`.
- Files under the managed paths that have no `.claude/` source are reported as extra. They are never deleted automatically.
- Not verified yet:
  - Whether Codex fires `.codex/hooks.json` for its own tools: the matcher uses Claude tool names.
  - Whether Codex needs the hook trusted first: it has a hook-trust step, and the bypass flag is never used here.
- Check both in the first Codex pilot. Until then, Codex is protected by its sandbox, not by this hook.
- The repo-level drift test is `toolkit-sync.test.cjs`. Run it with `/evidence-run` whenever the toolkit changes.
