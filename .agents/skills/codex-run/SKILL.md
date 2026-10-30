---
name: codex-run
description: Run one bounded OpenAI Codex job (GPT-6.1 Sol) for FFmpeg Encoder as a delegated worker — a read-only review, or a code slice in a throwaway worktree returned as a patch — with a saved receipt. Use only after Ahmed has said the ChatGPT Plus Codex quota is active, starting with the read-only pilot in record 39.
---

# Codex as a delegated worker

> **BLOCKED for real Codex.** The October 30 independent security review failed this wrapper (record 39). The code refuses any real Codex binary; only `fake-codex.cjs` runs. Before the pilot, land and re-review:
> - junction-safe worktree scanning and cleanup, with no `git worktree remove --force` on worker-controlled trees;
> - an isolated Codex config (`--ignore-user-config`, so none of the owner's MCP servers, plugins, memories or notify), with `windows.sandbox` kept;
> - a full before/after snapshot of the checkout in both modes (`.git/`, refs, ignored protected roots);
> - `exit`/grace-timer handling for orphaned grandchildren;
> - rejection of unreported, symlink, gitlink and binary changes;
> - `--resume` only for ids from this wrapper's own review receipts.
>
> Run the wrapper with `run_in_background`, because the 30-minute limit exceeds a foreground shell call.

```bash
node .agents/skills/codex-run/codex-run.cjs --mode review --brief <brief.md> --label <name>
node .agents/skills/codex-run/codex-run.cjs --mode slice  --brief <brief.md> --label <name> [--base <ref>]
node .agents/skills/codex-run/codex-run.cjs --mode review --brief <answer.md> --label <name> --resume <session-id>
```

- **Roles.** Root (Claude) stays the only writer: it writes the brief, reads the result, and does all of the following itself:
  - reviews any patch, applies it with `git apply` and runs `/evidence-run`;
  - commits, pushes, and updates the records and Notion.
  - Codex never commits, pushes or edits records.
- **Sandbox.** The wrapper decides it, never the brief:
  - **review:** Codex runs in the checkout with a read-only sandbox. If the checkout changes anyway, the job is rejected.
  - **slice:** Codex writes only inside a throwaway `git worktree` under the system temp folder, created from `--base` (default `HEAD`). The diff comes back as `patch.diff` and the worktree is removed.
  - Any change to a protected path rejects the job: records, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/`, package files, `artifacts/` or `ffmpeg/`.
  - The worktree has no `node_modules/` and no `ffmpeg/`, so a slice brief names pure tests only. Root runs the FFmpeg- and app-driven tests after applying the patch.
- **Refused options.** Bypass and widening options are never passed. That covers sandbox and hook-trust bypass, `danger-full-access`, extra writable directories, ignoring rules or user config, profiles and features. Any `-c` other than effort or the sandbox mode is also refused. The prompt always goes in on stdin.
- **Effort.** The default is `xhigh` with `gpt-6.1-sol`. `ultra` needs `--allow-ultra` and is only for a hard review Ahmed has approved. The time limit defaults to 30 minutes (`--timeout-min`, at most 120). On timeout the whole process tree is killed.
- **Report.** Codex must end with the JSON report in `report.schema.json`: `status` (done, blocked or needs_decision), `summary`, `changed_files`, `commands_run`, `findings` and `questions`.
- **Exit codes.** The summary is printed as JSON.

  | Exit | Meaning |
  |---|---|
  | 0 | done |
  | 1 | Codex failed or could not start (quota, sign-in or crash); see `stderr.txt` |
  | 2 | usage error |
  | 3 | blocked |
  | 4 | needs a decision from Ahmed |
  | 5 | rejected: bad report, changed checkout or protected path |
  | 124 | timed out |

  A failure therefore comes back to root like a failing test. Ahmed does not need to watch Codex.
- **Questions and decisions.**
  - **Blocked:** root fixes the brief or does the work itself.
  - **Needs a decision:** root asks Ahmed in plain words, then can answer Codex in the same session with `--resume <session-id>`. That follow-up is review-only and pinned read-only.
  - Whether `resume` keeps the sandbox exactly is to be confirmed in the pilot.
- **Receipts.** Each job writes to ignored `artifacts/v0.7/codex/<UTC>-<label>-<id>/` and is never overwritten:
  - `prompt.md`, `args.json`, `stdout.jsonl`, `stderr.txt`, `last-message.json` and `report.json`;
  - `receipt.json`: Codex version and SHA-256, repository HEAD, base, durations, the session id, and changed files against the files Codex reported;
  - `patch.diff` for a slice.

  Cite them like evidence receipts.
- **Before the first real job:** `toolkit-sync --check` must pass, so Codex reads current agents, skills and guard copies. Codex must also be signed in with a plan that includes Codex.
- **Pilot:** one read-only review of the C1 code commits, to compare its findings and quota use. Also check whether Codex fires its project hook (`.codex/hooks.json`) once it is trusted.
- **Tests:** `codex-run.test.cjs` exercises every guard and exit path against `fake-codex.cjs`. It never calls real Codex.
