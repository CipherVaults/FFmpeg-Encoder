# Executor working policy — October 30, 2026

**This is an executor policy record, not product scope.** On October 30 (about 13:00–17:30 Cairo) Ahmed paused development to settle how the work is run. The owner decisions below come out of that talk, as do the observations that shaped them and the toolkit built to carry them out. Record 35 remains the authority for scope and route. Record 36 still owns the adopted plugin toolkit, which this record extends. Nothing here grants product acceptance, changes a requirement, or opens an owner gate.

Supporting private artifacts:
- *FFmpeg Encoder Model Economics*: https://claude.ai/artifact/1eLfHxqU4uyhKkdn3ZZjoL
- *FFmpeg Encoder Codebook*, a plain-words glossary of every project code: https://claude.ai/artifact/RRa9HuGn5KjGnWqdzPDQEF

## Owner decisions

1. **The hourly and backup continuation ticks are paused.** Ahmed: "Yes, pause it."
   - The session's hourly tick was deleted, and the 3-hourly backup task `ffmpeg-encoder-continuation-backup` is disabled; it is not deleted.
   - The writer lock read `paused-owner-talk` during the talk.
   - Neither restarts without Ahmed's word.
2. **Effort switching pauses the work.** Ahmed: "you need to pause, do not … continue the development automatically if we reached at a point where you suggest … that we could switch the effort." Rules:
   - A session cannot change its own effort; the app refuses it by design. Ahmed switches it in the model/effort picker.
   - Root proposes a switch only at a phase boundary, after the commit and push. It then stops in the `phase-close` stop step with the writer lock at `awaiting-owner`, and continues only after his reply.
   - After the reply, root first confirms the session's effort in the session metadata.
   - Lead efforts: **xhigh** for trust-boundary code or design and final review. That covers the rest of P (native integration C1–C4, C7), Q's media paths and S's review. **high** for UI, settings, accessibility, copy, packaging, and records-only work.
   - The close-out of a phase stays at that phase's effort. Subagent efforts stay as defined in `.claude/agents/`.
3. **Compaction.**
   - The thread stays as one continuing thread.
   - `.claude/settings.json` sets `autoCompactWindow: 500000` (Ahmed: "what if we actually set it indeed to 500,000 token ourselves?"). Automatic compaction becomes a safety net at about 500k tokens.
   - The planned compaction is Ahmed typing `/compact` at the same phase-end stop as the effort switch, right after the records are written.
   - After any compaction, root runs `/reentry-check` and reads the top of `10_Continuation_State.md` before trusting the summary. `CLAUDE.md` carries matching "Compact instructions".
   - Measured reason, from this thread's own transcript: before the first compaction, 340 calls carried 519k tokens of context on average, peaking at 957k, and 187 M tokens were re-read from cache against 0.49 M written. Anthropic's documentation says long sessions draw more usage per message.
   - Ahmed asked for 500k. His follow-up showed he expected compaction to be manual only, so root explained that the setting is automatic (a safety net that may fire mid-phase) and that only `/compact` is manual. It stays set; it can be reverted on his word.
   - Not verified yet: the setting is read when the session's process starts. It takes effect after the Claude app is fully quit and reopened, then confirmed through the session's context report.
4. **Plain-language updates.** Ahmed asked for clearer messages because the codes (C1, R3, P01, D1 …) meant nothing to him.
   - Every executor writes progress in plain words first, with a code in brackets only for looking it up.
   - The Codebook artifact decodes the scheme. Its traps:
     - the milestones are N–S, and P01-style codes are checklist items;
     - R1–R4 are fixes inside step C1, not milestone R;
     - D1–D7 are owner decisions, while D1–D3 in record 37 are security-risk labels.
5. **OpenCode stays out of the project.** Ahmed: "I agree with us leaving Open Code out of our project and equation." The research (October 30, four agents, one of them a skeptic) found:
   - The models he had heard about (Kimi K3.1 Pro, Meta's Muse Spark) are in the paid OpenCode Go plan.
   - The free models are small: the best scores 32 on Artificial Analysis Index v5.0, against 52 for Opus 5.5 high and GPT-6.1 Sol xhigh.
   - No source supports "100 M free tokens a day".
   - Most free models keep or train on prompts.
   - The terms forbid programmatic extraction of output, and the client had four remote command-execution flaws in 2026.
6. **Codex: planned, not active.** Ahmed: "just plan for it, keep it in mind, and when it's ready, I will tell you to do so. And keep in mind the documentation synchronization between both."
   - Ahmed has ChatGPT Go now, not Plus. No Codex job runs until he says the Codex quota is active.
   - The first job is a read-only pilot review of the C1 code commits (`a3d60a9`, `0807633`), to compare findings and quota use.
   - Roles: Codex is a delegated worker run through `codex-run`. Root writes the brief, reviews and tests any patch, commits it, and writes all records. There is one writer and one author of the records.
   - If Ahmed wants to drive Codex directly on this checkout, the writer lock passes first and root stops.
   - The delegated-worker rule is root's operating design while Claude leads. It is not an owner restriction on Codex. If Ahmed hands the root role to Codex, as he did the other way on October 29, Codex becomes the writer after the lock handover, under the same records.
7. **PBS documentation cost is accepted.** Ahmed: "I don't mind the extra cost of the AI PBS documentation and continuation and whole writing and the Notion bars and all of that." He cites more than ten projects where it proved its worth.
8. **Direction on hardware-blocked AMD/Intel work.** Ahmed: "that's why I called it to be labeled beta clearly in the UI … if it did not function, it would be fine, because I don't have the hardware to test that … we don't get stuck on that, and we hop into the next milestones of the project just fine."
   - This is his direction for vendor work that cannot be tested here: build it as Beta software and don't wait on hardware. It bears on D5 (the vendor qualification route) and on D1's Beta-label recommendation. It is not yet a formal answer to either, and those decisions stay his.
   - Correction: root first described this as answering **D4**. D4 is in fact "Q start order" (record 38 §8), whether Q may start before C1–C4, and he did not answer it. D4 stays open.
   - Until he answers D4, work continues in record 35's order (C1–C4, the P04 recheck and C7, then Q01), which is record 38's recommendation.
   - The design still fails closed: with no approved reference results, every AMD/Intel file job is refused, never producing a bad output.
   - D1–D7 all stay open.
9. **Skills.** Ahmed: "please do so … even if it's going to be costing a little bit of time and quota" and "build them literally before the start of the development now." The three skills below were built before development resumes.

## Observations that shaped the policy

- **Plugins.** Ahmed applied record 36's plugin decisions. His claude.ai plugin list on October 30 shows only zizi-skills, agentic-council, claude-security, pr-review-toolkit, security-guidance and the GitHub MCP. This session still shows the tools it loaded at start until it restarts; the guard keeps refusing Desktop Commander and agent-memory regardless.
- **The Codex app's "sync from Claude" import.**
  - Ahmed accepted it in the Codex app (ChatGPT Go). At about 04:00 Cairo on October 30 it imported eight Claude Code sessions as Codex threads, including this one, and converted `.claude/` into `.codex/agents`, `.codex/hooks` and `.agents/skills`.
  - It is a one-time snapshot, and its blanket "claude"→"Codex" rename broke the copied skills, pointing them at non-existent `.Codex/skills/…` and `artifacts/v0.7/Codex-continuation/…`.
  - Its guard copy predates the October 30 MCP rules.
  - Root cannot see Codex conversations; the bridge runs one way.
- **Codex on this PC.**
  - The Codex app bundles a command-line Codex (`codex-cli 0.162.0-alpha.2`, `%USERPROFILE%\.codex\.sandbox-bin\codex.exe`), signed in with ChatGPT. Its default config is `gpt-6.1-sol` at effort `ultra`.
  - `codex exec` reads the prompt from stdin and supports read-only and workspace-write sandboxes, an output schema and JSON events. `codex exec resume <id>` continues a session.
  - Codex has a hook-trust step, so its project hook may not fire until trusted. This is unverified.

## Toolkit built (Claude originals; Codex copies generated)

| Skill | What it does | Tests |
|---|---|---|
| `.claude/skills/phase-close/` | The end-of-phase routine: evidence, owner records, commit, push and readback, Notion, writer lock, then the plain-language stop for the effort switch and `/compact`. `phase-close-check.cjs` checks the branch, staged Planning, the 14-section session-summary template, toolkit drift, the writer lock and remote equality. | `phase-close-check.test.cjs` |
| `.claude/skills/codex-run/` | **Blocked for real Codex until hardened (security review FAIL).** One bounded Codex job with a receipt. Review jobs are read-only, with a check that the checkout did not change. Slice jobs run in a throwaway worktree and come back as a patch, with protected paths rejected. It refuses every bypass or widening option, enforces a time limit with a process-tree kill, requires a strict JSON report, and maps distinct exit codes (failed, blocked, needs decision, rejected, timeout). | `codex-run.test.cjs` with `fake-codex.cjs`; never calls real Codex |
| `.claude/skills/toolkit-sync/` | Regenerates `.codex/agents/*.toml`, the `.codex/hooks` guard copies, `.codex/hooks.json` and `.agents/skills/**` from `.claude/`, fixing the importer's paths, and fails on drift. | `toolkit-sync.test.cjs`, which includes a drift test over the real repository |

From this checkpoint's commit, the generated Codex copies are tracked in Git, so both executors read the same toolkit.

**Independent review (two reviewer agents, October 30).**
- **Security (`codex-run`): FAIL.** Two findings are high, both reproduced with temp sentinels:
  1. Slice cleanup with `git worktree remove --force` follows an NTFS junction the worker creates and deletes its target outside the worktree. Staging also reads the target into the patch.
  2. Every job would load the owner's `~/.codex/config.toml`. That brings in MCP servers, plugins (GitHub, Notion, Drive, computer-use, browser), memories and notify, all of which act outside the shell sandbox.

  The medium and low findings:
  - protected paths were matched case-sensitively, missing `.CODEX/` and nested `.gitattributes`;
  - orphaned grandchildren could hang the wrapper past its timeout;
  - the snapshot misses `.git/`, refs and ignored roots, and slice mode does not snapshot the checkout at all;
  - bare `git` could be resolved from the worker's folder;
  - unreported, symlink, gitlink and binary changes are not rejected;
  - the foreground shell limit is shorter than the job timeout;
  - `--resume` accepts any session id;
  - the tests miss these cases.

  **Disposition:** fixed now are the case-insensitive protected paths (plus `.gitattributes`, `.gitignore`, `.gitmodules` and `.npmrc` at any depth) and a safe `git` lookup. The wrapper is **blocked in code from running real Codex**; only the test double runs. The rest is required hardening before the pilot, listed in its SKILL.md, followed by a new security review.
- **Correctness and records: PASS WITH FINDINGS.**
  - Fixed: the D4 misreading above; the AGENTS.md wording that made the delegated-worker rule look like an owner decision; the AGENTS.md banner not mentioning the paused ticks; the "now tracked" overclaim; three false-pass gaps in `phase-close-check` (staged Planning renames, untracked files, unstaged session summary).
  - Carried to the pilot: the absolute-path, POSIX-quoted `.codex/hooks.json` (the format Codex's own importer produced); the Codex agent TOML losing the Claude `tools:` read-only restriction, since no equivalent Codex agent key is verified.

Verification receipts and the commit are recorded in the October 29–30 Execution Summary.

## Limits

- Not run yet: `codex-run` against real Codex, Codex's handling of `.codex/hooks.json`, and `resume` keeping the read-only sandbox. All are pilot checks.
- `autoCompactWindow` is unverified in the desktop Code tab until a restart.
- The skills reduce repetition but do not replace judgement. Which records carry new facts is still root's decision.
