# FFmpeg Encoder — Claude Code entry

Windows desktop video encoder and media-workflow app (Electron 44.7 + pinned FFmpeg 9.0.2). Accepted local 0.5.0 and 0.6.0 are protected; 0.7.0-alpha.1 is an unaccepted candidate on private branch `codex/v0.7-candidate` (`AE0101/FFmpeg-Encoder`). Owner and acceptance authority: **Ahmed**.

This file is the Claude-specific entry. **Project truth lives only in the repository's Markdown records and Git**, so Codex or any other executor can resume from the same sources. Never put project facts only in `.claude/` or Claude memory.

## Re-entry route (AI PBS — Project Bootstrap System)

The project is governed by **PBS Start, Resume & Handoff v1.1** (skill `pbs-start-resume-handoff`). Re-enter in this order and verify live state before trusting prose:

1. `AGENTS.md` — read the top current-authority banner and the **Implementation invariants** section (shared Codex/Claude entry; dated banners below it are history).
2. `0- Documentation/35_0.7_Claude_Continuation_Authority_2026-10-29.md` — current authority, scope, executor/model policy, continuation mechanism (or the newest later authority record if one exists).
3. `0- Documentation/10_Continuation_State.md` (top) and `01_Current_State.md` (top).
4. The newest `0- Documentation/Execution Summaries/2026-10-29_*.md` section.
5. `0- Documentation/25_0.7_Requirements_and_Evidence.md` — the 43 requirement IDs; never edit their texts or order.
6. Run `/reentry-check` (hashes, Git/remote equality, protected refs) before editing.

Keep these three apart: **permission** (owner instructions/records), **observation** (Git, files, receipts), **acceptance** (owner decisions). A test result applies only to the exact bytes in its receipt.

## Scope and hard limits (record 35, amendments 32/33)

- Order: non-HDR P01–P04 → eligible Q → R → S. HDR P05–P09 deferred (no expansion, replay or catalog reseal). Packaging (portable + installer) last.
- Never: Security Cloud (an external hosted scanning service; the in-session `claude-security` plugin is allowed per record 36); change ordinary defaults / Archive CQ29 / the benchmark / accepted tags; public release; force push or history rewrite; stage `0- Documentation/Planning/` (private); dependency/runtime upgrades; delete or modify anything under `F:\shadow play` (personal media is read-only test material; outputs go to project-owned folders).
- Owner gates: AMF same-component producer technical disposition, milestone/product acceptance, logo selection, scope changes, packaging acceptance.
- `.claude/hooks/guard.cjs` enforces the history/media/Planning/install rules; do not weaken it to get past a block — report the block instead.

## Security from the left

Security is part of every change, not a final check. The trust model: the sandboxed renderer has no Node/filesystem/process access; preload exposes named actions only; IPC checks sender window/frame/URL and argument counts; **main owns** folders, validation, plans, the one-at-a-time queue, child processes, output protection and publication. When writing code: treat every renderer/IPC/file/child-output value as untrusted; accept only inert data (no getters/proxies); bound bytes, children and time; never use a shell; keep authority in main-private WeakMaps/tokens, never in caller copies; fail closed with a specific error code; add a negative test for each new guard. Run `/security-review` on substantive diffs.

## Roles and coordination

- **This root session** is the sole repository writer, scheduler, committer and integrator.
- Subagents (`.claude/agents/`) are read-only and return reports: `reviewer` (Opus xhigh; independent review), `researcher` (Opus medium; dense docs/Notion), `auditor` (Haiku; mechanical hash/inventory checks). Workflows (Ultra Code) are for adversarial multi-lens review and broad verification; workflow agents never commit.
- Delegated writes are allowed only into a disjoint folder the root names (for example a candidate-asset folder).
- Installed plugins and skills: follow `0- Documentation/36_Claude_Toolkit_Adoption_2026-10-30.md` (adopted toolkit, commands never to run here, pending owner decisions). Do not call Desktop Commander, agent-memory or GitHub MCP write tools.
- Overnight continuation: writer lock `artifacts/v0.7/claude-continuation/writer-lock.json`; refresh with `node artifacts/v0.7/claude-continuation/heartbeat.cjs "<phase>" "<next>"`. The continuation ticks are paused by Ahmed (record 39); do not re-enable them without his word.
- Working policy ([record 39](0-%20Documentation/39_Executor_Working_Policy_2026-10-30.md)):
  - Talk to Ahmed in plain words, with codes in brackets (the *FFmpeg Encoder Codebook* artifact decodes them).
  - Close every phase with `/phase-close`. It stops for his effort switch and `/compact`; never continue past that stop on your own, and never change your own effort.
  - Codex runs only through `/codex-run`, once Ahmed says the Codex quota is active; it starts with the read-only pilot.
  - After any change to `.claude/`, run `/toolkit-sync`.

## Evidence and records (PBS)

- Run tests with `/evidence-run` (`node .claude/skills/evidence-run/run-tests.cjs <label> <tests...> --covers <src...>`); it saves stdout/stderr/exit and file hashes under ignored `artifacts/v0.7/evidence/`. Failed receipts are retained, never relabelled.
- Before editing a file with preserved history, copy it to the phase's `artifacts/.../before-*` folder.
- After each phase update only the owners whose facts changed: Current State, Continuation, tracker 25 rows, Execution Index, the dated Execution Summary, and `06_SESSION_SUMMARY.md` using its established full session template (headings with emoji: Models/Effort/Roles/Provenance, Time, Session Goal, Actions Taken, Key Insights, Decisions Made, Difficulties/Friction, Adjustments, Mistakes/Risks, Current Position, Next Steps, Open Questions, Session Outcome, Confidence). New entries go on top; older entries are preserved.
- Notion hub (`FFmpeg Encoder — Project Hub`) and `Blue — Handoff` get narrow dated overlays with readback; never rewrite their history.
- Commits: plain outcome-based subject, then a body with why / what / verification and its scope / limits. Stage explicit paths only. Normal push to `codex/v0.7-candidate`, then read back remote equality.

## Commands

- Full suite: `npm test` (`node --test tests/*.test.cjs`). Focused: `node --test tests/<name>.test.cjs`.
- App: `npm start`. UI smoke scripts: `npm run test:layout`, `test:product`, `test:app` (these launch Electron windows; desktop must be free).
- Windows: Git Bash for POSIX commands; quote paths (the root contains an apostrophe and spaces).

# Compact instructions

When summarizing this conversation, keep:
- Ahmed's decisions and instructions in his own words, with dates.
- The current phase, step and exact next action.
- Whether work is active, paused, or waiting on Ahmed (an effort switch, `/compact`, an owner gate), and which question is open.
- Uncommitted or unpushed changes.
- Promises made to him.

Drop tool output that the records or Git already hold. After compaction, trust live state over the summary: run `/reentry-check` and read the top of `0- Documentation/10_Continuation_State.md` before acting.
