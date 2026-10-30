# Claude toolkit adoption — October 30, 2026

**Executor tooling record, not product scope.** At Ahmed's request, root inventoried every Claude Code plugin and skill installed for this project and evaluated the relevant uninstalled Anthropic plugins before continuing development. The full illustrated review is the private artifact *FFmpeg Encoder Toolkit* (https://claude.ai/artifact/EPiujRVnRRgkCR6zdeBiCn). This record keeps the adopted rules in the repository so any later executor, including Codex, follows the same ones.

## What was reviewed

Eighteen installed plugins (220 skills, 39 agents, hooks in claude-context-optimizer, agent-memory and security-guidance) and eighteen uninstalled Anthropic or partner plugins from the official marketplace. Six read-only reviewers opened each plugin's SKILL, agent, command and hook files; an editor merged a ranked plan. Judgements are about this project only.

## Security finding fixed

Desktop Commander's terminal and filesystem tools and the GitHub MCP server are MCP calls. The project guard (`.claude/hooks/guard.cjs`) matched only Bash, PowerShell and the edit tools, so those calls bypassed every preservation rule. Commit `db97953` extends the guard to all `mcp__*` tools: command inputs get the Bash rules, write/move/delete paths get the media and frozen-path rules, MCP tools may not change their own safety configuration, and GitHub API writes are refused (git stays on the guarded CLI). Guard tests 7/7 pass, and a live Desktop Commander dry-run force push was blocked.

## Adopted working toolkit

| Moment | Tool |
|---|---|
| Re-entry, before commits, handoffs | `/reentry-check`, `pbs-start-resume-handoff` |
| Every cited test result | `/evidence-run` |
| Every substantive diff (main, preload, IPC, child process, paths, publication) | built-in `/security-review`, then `/code-review` |
| Independent review at phase close and before owner gates | project `reviewer` agent; `researcher` for dense records; `auditor` for mechanical checks |
| New guard + negative test | `zizi-skills:tdd-skill` mutation check (break the guard; the test must fail) |
| New boundary or workflow design (P service wiring, Q media paths, S) | `agentic-council` skeptic checklists only: threat-model, edge-case-enumeration, failure-mode-analysis (never the `/council`, `/ship` or `/handover` commands) |
| Failing tests or misbehaving FFmpeg children | `zizi-skills:debugging-and-error-recovery` |
| Passive | `security-guidance` edit-time warnings |
| Milestone R | design accessibility-review / ux-copy, advocate a11y audit, computer-use on the real app, notion-native-artwork for the chosen logo |

Never run from installed plugins: `agentic-council` `/council`, `/ship`, `/handover` (they auto-commit, create GitHub issues, merge or rewrite history and can budget millions of tokens); `zizi-skills` git-sync, handoff, done, planning, project-config, find-skills; built-in `/init` and `/loop` for this repository.

## Owner decisions pending

1. Disable Desktop Commander for this project (recommended; the guard now covers it, but its own limits can be loosened from inside a session and its telemetry is on).
2. Disable agent-memory (its hook stores every shell command line verbatim; its server fails to connect).
3. Turn off claude-context-optimizer's per-prompt and per-tool hooks (they inject the "prompt-coach" text and can block reads of large files); its `/cco-overhead` and `/cco-claudemd` reports stay useful on demand.
4. Disable the business plugins unused here (data, finance, product-management, cowork-plugin-management, engineering, productivity, pdf-viewer, 10x-Team, agentics-beyond-code) to cut always-on token cost; re-enable any time.
5. Decide whether the in-session `claude-security` plugin falls under the "Never Security Cloud" rule. If not, install it for one changes-scan at the end of P and Q and one codebase scan in S.
6. Optional: install Anthropic's `pr-review-toolkit` and use only its silent-failure-hunter and pr-test-analyzer agents.

Until Ahmed decides, root does not call Desktop Commander, agent-memory or GitHub MCP write tools; the guard enforces the dangerous cases.
