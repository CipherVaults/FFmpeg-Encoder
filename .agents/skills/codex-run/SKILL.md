---
name: codex-run
description: Run one bounded OpenAI Codex job (GPT-6.1 Sol, xhigh) for FFmpeg Encoder as the team's executor — a read-only review or a work slice done in place in this checkout — with a quota check first and a saved receipt. Root (Claude) writes the brief, reviews every change, re-runs the evidence and commits; Codex never commits. Arrangement: record 40.
---

# Codex as the team's executor

Owner decision, October 31, 2026 ([record 40](../../../0-%20Documentation/40_Codex_Teammate_Arrangement_2026-10-31.md)):
- Codex works **in place** in this folder (Claude's copy) with full access. There is no sandbox and no throwaway worktree.
- `D:\Codex Projects\FFmpeg Encoder` is an October 26 archive and is never used.
- Codex never commits or pushes. Root reviews the diff, re-runs the receipts on the final bytes, writes the records and Notion, then commits.
- One writer at a time: while a job runs, root does not edit project files.

Run the wrapper with `run_in_background`, because a job can outlast a foreground shell call.

```bash
node .agents/skills/codex-run/codex-run.cjs --mode review --brief <brief.md> --label <name>
node .agents/skills/codex-run/codex-run.cjs --mode work   --brief <brief.md> --label <name> --allow src/x.cjs --allow tests
node .agents/skills/codex-run/codex-run.cjs --mode work   --brief <follow-up.md> --label <name> --allow tests --resume <session-id>
```

- **Quota gate (Ahmed's limits).**
  - A job starts only while Codex's 5-hour window is under **80%** used and any longer window (weekly) is under **100%** (raised from 90% by Ahmed on November 12, 2026; record 40).
  - The reading comes from Codex's own session logs: its `token_count` events carry the plan limits and reset times.
    - The gate takes the newest reading from the most recently written session files in every date folder, because Codex files a session under the day it started.
    - The reading trails the newest model call, so treat it as the least that is used.
    - A reading that is present but unreadable stops the job.
    - A reached limit clears when that window resets.
  - Over a limit, the job is not started (exit 6) and the reset time is printed. Wait for the reset, or do root-side work meanwhile.
  - Every receipt keeps the readings before and after, plus the job's own token total, so real costs are learned per job.
- **Effort.** `xhigh` with `gpt-6.1-sol` by default. Ahmed chose xhigh over `ultra`: ultra delegates to helper agents root cannot track, and it costs more. `ultra` is refused. `--effort max` is allowed for the hardest jobs only (Ahmed, November 13, 2026): policy reviews, validator or trust-boundary work, and anything where a wrong answer would waste a fresh proof run.
- **Fixed Codex arguments.**
  - **Full access, no approvals:** `--dangerously-bypass-approvals-and-sandbox` (owner decision).
  - **The project guard runs:** `--dangerously-bypass-hook-trust` runs `.codex/hooks.json`, which `toolkit-sync` keeps identical to `.claude/`. Whether Codex fires it for its own tool names is checked in the pilot.
  - **No user config, no memories:** `--ignore-user-config` plus `features.memories=false`. Without them, the owner's plugins, MCP servers, notify and memories (which carry the old thread's state) ride along and cost tokens on every call. Sign-in is expected to keep working from `CODEX_HOME`; the pilot confirms it.
  - **Refused:** widening options (`--add-dir`, `--ignore-rules`, profiles, features, sandbox overrides) and any other `-c`. The prompt always goes in on stdin.
- **What the wrapper checks.**
  - **Before the job:** it never starts with a non-empty index or with any skip-worktree or assume-unchanged flag set.
  - **After the job:** it compares Git and the content of every changed or untracked file, plus what `git status` cannot show:
    - `.git/config`, `.git/info/` and `.git/hooks/`;
    - the ignored protected roots: `ffmpeg/` (hashed), the `node_modules/` listing and lock, and ignored files under `.claude/`, `.codex/` and `.agents/`;
    - ignore files anywhere;
    - Git's hiding flags;
    - the `before/` backup itself, whose hashes are kept in the receipt.
  - It rejects the job (exit 5) when any of these changed, even if the job then timed out or failed:
    - HEAD, the branch, any ref or the index;
    - a private Planning record;
    - a protected path: records, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/`, package files, `node_modules/`, `artifacts/`, `ffmpeg/`, `.git*` or `.npmrc`;
    - any of the hidden state above;
    - anything outside `--allow` in a work job, or anything at all in a review;
    - a change missing from Codex's report.
- **Cut-offs.**
  - Before each job, these files are copied to `before/` with `SHA256SUMS`, so a rejected or cut-off job can be put back exactly:
    - every dirty file;
    - in a work job, every tracked file under `--allow`, because Git cannot restore their exact working-copy line endings.
  - Codex appends a line to `progress.md` after each step.
  - A usage-limit stop returns exit 6 with the partial changes listed. After the reset, resume the same session with `--resume`; the prompt points at the earlier `progress.md`. Root may instead finish or undo the slice itself.
  - Only sessions found in this wrapper's own receipts can be resumed.
- **Report.** Codex ends with the JSON report in `report.schema.json`: `status` (done, blocked or needs_decision), `summary`, `changed_files`, `commands_run`, `findings` and `questions`.

  | Exit | Meaning |
  |---|---|
  | 0 | done |
  | 1 | Codex failed or could not start (sign-in or crash); see `stderr.txt` |
  | 2 | usage error |
  | 3 | blocked |
  | 4 | needs a decision from Ahmed |
  | 5 | rejected: bad report, Git moved, protected or unallowed change |
  | 6 | quota: not started over a limit, or stopped at a usage limit |
  | 124 | timed out (default 60 minutes, at most 240); the process tree is killed |

- **Receipts.** Each job writes to ignored `artifacts/v0.7/codex/<UTC>-<label>-<id>/` and is never overwritten. A job's folder holds:
  - `prompt.md`, `args.json`, `stdout.jsonl`, `stderr.txt`, `last-message.json`, `report.json`, `progress.md` and `before/`;
  - `receipt.json`: the Codex path, version and SHA-256, Git before and after, the changed files, the quota readings, the session id and durations.

  A Codex test run is evidence only for the bytes it ran on. Root re-runs `/evidence-run` on the final bytes before citing a result.
- **Before each job:** `toolkit-sync --check` passes, the index is empty, and the brief names the files, tests and done criteria.
- **Tests:** `codex-run.test.cjs` exercises the gates and exit paths against `fake-codex.cjs`. It never calls real Codex, so a real spawn failure is not covered.
