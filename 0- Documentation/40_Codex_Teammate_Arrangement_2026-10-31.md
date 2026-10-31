# Codex teammate arrangement — October 31, 2026

**This is an executor policy record, not product scope.** On October 31 Ahmed lifted his morning pause and set how Codex joins the work as a teammate under Claude's lead. This record:
- amends [record 39](39_Executor_Working_Policy_2026-10-30.md) decision 6 ("Codex: planned, not active") and the `codex-run` design it describes;
- extends the hard limits for personal media in [record 35](35_0.7_Claude_Continuation_Authority_2026-10-29.md) and `CLAUDE.md`.

Record 35 remains the authority for scope and route. Nothing here grants product acceptance, changes a requirement, or opens an owner gate.

## Owner decisions

1. **The pause is lifted; development is ACTIVE.**
   - The pause dates from ~05:00 Cairo, in Ahmed's words: "don't continue on the next heart beat, I think we can wait for when I have ChatGPT Plus, and Codex with us to help us…".
   - In the morning Ahmed had ChatGPT Plus and asked to talk before anything ran.
   - In the evening he set the arrangement below and closed with: "go ahead, Claude. You have full authority to execute and test and go with your plan and see how it goes."
   - He asked that the records say plainly that work is not paused, because Codex has stopped on old pause orders before. Every pause or stop order dated before this record is now history, whether it is in a banner, a record, a Codex thread or a memory.
2. **Roles.**
   - **Claude Code (root)** leads. It writes the briefs, reviews every change and re-runs the evidence, and it alone commits, pushes, writes the PBS records and updates Notion. Ahmed: "You'll lead the documentation, review, and all of that, and the development. Again, security is critical. And polish is important."
   - **Codex** executes bounded jobs as a teammate, through `codex-run` only. It never commits or pushes.
   - **One writer at a time.** While a Codex job runs, root does not edit project files. This keeps every receipt tied to the bytes it ran on.
3. **One folder.**
   - Codex works only in `D:\Claude's Projects\FFmpeg Encoder`, Claude's copy and the authoritative one.
   - `D:\Codex Projects\FFmpeg Encoder` is an archive of the October 26 state and is left untouched; nothing is deleted or renamed. Read-only checks on October 31 found:
     - its HEAD is `8ef7ad1`, an ancestor of this copy's `b7c8b70`, with 21 commits since;
     - its newest change dates from October 26, 16:57 Cairo;
     - its uncommitted work is the state that Claude took over and finished in this copy.
4. **A fresh local Codex session, not the old thread.** Ahmed: "I authorize that you start a new fresh like thread as long as it's local". Reasons, measured from the old thread's own session file (`01a1654e…`, 147 MB):
   - It carries about 200,000 tokens of history, and every turn re-sends it. Ahmed's one-line turn that switched the model sent 202,248 input tokens, of which only 24,064 came from cache, because a model change empties the cache. It cost about 10% of the 5-hour window. Ahmed: "just saying hi in the same thread … it used 10% of the 5-hour limit quota."
   - Its last orders are the October 29 handoff to Claude and "don't continue working just yet", and it is pinned to the archive folder.
   - It was written by the Codex desktop app (CLI 0.163); `codex-run` drives the app's bundled CLI.
   - The old thread stays as it is, and Ahmed can still open it in the Codex app.
5. **Full access, no sandbox.**
   - Ahmed trusts Codex with full access from six months of use without a failure, and the F: drive is backed up. He asked for no sandbox over-engineering.
   - The throwaway-worktree and patch design of October 30 is withdrawn, together with its "blocked for real Codex" state. The security review that failed it concerned that design (worktree junction cleanup, sandbox scope).
   - Root's own measure within this decision: jobs run without the owner's user config. The plugins, MCP servers, notify and memories stay out, for two reasons:
     - they would add tokens to every call;
     - the memories carry the old thread's state, including its pauses and its folder.

     Sign-in is expected to keep working, since Codex keeps it apart from that config. The Stage 1 pilot confirms it.
6. **Effort: xhigh.** Ahmed: "we'll leave it at extra high. It's even cheaper."
   - `ultra` delegates to helper agents that root cannot track, which breaks "one writer at a time".
   - `max` and `ultra` are refused by the wrapper.
7. **Quota limits.**
   - A Codex job starts only while the 5-hour window is under **80%** used and any longer window is under **90%**. Ahmed raised these from root's proposed 40% and 85%: "It can be upwards, I guess, of, well, 80% 5h limit quota, and for the weekly quota to be 90%".
   - Codex logs its own plan limits after every model call, so root reads them between jobs. The reading trails the newest call. At the end of Ahmed's turn it still showed 0% while the app showed 10%, so it is treated as the least that is used.
   - Ahmed: "there is a 5-hour rate limit … you'll have to think it through". Sudden stops are expected and handled the PBS way:
     - jobs are small;
     - the dirty files are backed up before each job;
     - Codex writes a progress note after each step;
     - after the reset, the same session resumes from its notes, or root finishes or undoes the slice;
     - nothing reaches Git before root has checked it.
8. **Personal media (F:\shadow play), for every executor.** Ahmed: "as long as you do not delete anything, it's feel free to use it as read and write in the appropriate location if it's going to be using and helping the development of the FFmpeg encoder in general sense." Root's proposed rule, which Ahmed accepted ("I agree with all of what you've proposed"):
   - read anything there;
   - write new files only inside `F:\shadow play\FFmpeg Encoder Tests\`;
   - never delete, move, rename or overwrite anything there, test folder included.

   The guard enforces this for Bash, PowerShell, Edit and Write:
   - Edit tools are refused anywhere there.
   - Every write target must resolve inside the test folder, following links and junctions, and must not exist yet. FFmpeg `-y` is refused.
   - Deletes, moves, renames, link creation, robocopy's mirror and move modes, and bulk copies into the folder are refused. So are inline scripts that touch it, and any write after a `cd` into it.
   - MCP file tools stay fully blocked from the folder, which is stricter than the rule.

   The guard is defence in depth, not a sandbox: a script file that writes there on its own is not seen. Whether Codex fires the project hook at all is a Stage 1 pilot check.

   Root created the test folder with a `README.txt` that states these rules.
9. **PBS stays critical.** Ahmed: "AI PPS is critical. Do not forget the documentation, writing, and Notion updates." Record 39 decision 7, which accepts the cost of documentation, stands.
10. **The continuation ticks stay off.** The hourly tick and the backup task were not part of this decision and are not re-enabled.

## Toolkit changes (this record's commit)

| Change | What it does | Tests |
|---|---|---|
| `.claude/skills/codex-run/` rewritten | The `review` and `work` modes run in place with the fixed arguments: full access, the project hook run, no user config, no memories. It also: <ul><li>refuses to start over the quota limits (exit 6), reading the newest entry in Codex's session files;</li><li>refuses to start with a non-empty index or with Git hiding flags set;</li><li>backs up the dirty files, plus the tracked files under `--allow`, to `before/`, keeping their hashes in the receipt, and gives Codex a `progress.md`;</li><li>after the job, compares Git, every changed or untracked file and what `git status` cannot show (`.git` config/info/hooks, the ignored `ffmpeg/`, `node_modules/` and toolkit files, ignore files, the backup). It rejects moved Git, Planning, protected paths, hidden-state changes, changes outside `--allow`, any change in a review, and changes missing from the report, even when the job then timed out;</li><li>reports a usage-limit stop as exit 6 with the partial changes;</li><li>resumes only its own sessions;</li><li>uses the newest Codex CLI that the app installed.</li></ul> | receipt `stage0-codex-run` 15/15 against `fake-codex.cjs` |
| `.claude/hooks/guard.cjs` | The Shadowplay rule above, including links, existing targets, robocopy switches, escaped and short-name spellings, `2>`, `&>` and `>|` redirects, and `cd` into the folder. | receipt `stage0-guard` 10/10 |
| `.codex/`, `.agents/` | Regenerated by `toolkit-sync --write`; `--check` passes | receipt `stage0-toolkit-sync` 5/5 (drift test) |

**Independent review (workflow `wf_807770ac-884`).**
- Setup: three `reviewer` lenses (security, correctness against the real CLI and Windows, records against Ahmed's words) and one adversarial verifier, 4 agents.
- Outcome: of 37 candidates, 17 were confirmed and fixed before the commit. The other 20 were duplicates or refuted.

The confirmed findings:
- **Guard, high (S1).** A link created in the test folder (`cp -l`, a hard link or a junction) would have let a later "new file" write reach an original. The first version allowed creating those links.
- **Guard, medium (S2).** Writes in the test folder could overwrite existing files, and Edit was allowed.
- **Guard, high (S3).** Pre-existing: robocopy's `/MIR` and `/MOV` and xcopy's `/Y` switches were read as the destination.
- **Guard, medium (S4).** Pre-existing: `shadow\ play`, `shadow?play`, `SHADOW~1`, `2>` and `&>` redirects, PowerShell aliases, inline scripts, and `cd` into the folder before acting.
- **Runner, high (C1).** The quota gate read only date folders named for the last 8 days. Codex files a session under the day it started, so the gate missed today's reading. It fell back to an October 27 reading from the old plan (98% weekly) and would have refused the pilot.
- **Runner (C6, S10).** A reached limit cleared only when every window had reset. Unreadable readings passed, and a window of unknown length used the 90% limit.
- **Runner, medium (S5, S6).** Changes hidden with Git's skip-worktree or assume-unchanged flags, or made in ignored roots (`ffmpeg/`, `.claude/settings.local.json`) or in the backup, went unseen.
- **Runner, medium (S7).** A job that tampered and then timed out read as a plain timeout.
- **Runner, low (C10).** Clean files with CRLF or mixed line endings could not be restored exactly.
- **Runner, low (C12).** The tests did not cover several of these paths.
- **Records, low (R6–R8, R11, C14).** The 12/12 and 8/8 results had no receipts. A phase-close stop after C3 contradicted record 39. Two `CLAUDE.md` lines still said root is the sole writer. The sign-in claim was unverified. The index linked an Execution Summary section that did not yet exist.

## Plan and test route

- **Stage 0 (root, no Codex quota):** this record, the lifted-pause banners, the toolkit changes, an independent review, the commit and the Notion status.
- **Stage 1 (Codex pilot, read-only):** one fresh job at xhigh. Codex re-enters from `AGENTS.md` and the records, then reports:
  - the folder, branch and HEAD;
  - the phase;
  - that work is active;
  - its role and limits;
  - the next step.

  It changes nothing. Root checks the report, the unchanged checkout and the quota cost, and whether the project hook fired.
- **Stage 2 (Codex work, small resumable jobs):** finish the C3 checkpoint:
  - fix the two test gaps (NS-03, NS-19) and re-run the break ledger;
  - make the `c3-focused` and full-suite receipts;
  - an independent review of the whole C3 change.

  Root then verifies the result, re-runs the receipts on the final bytes, commits (recording that Codex finished the checkpoint), pushes, reads back, and updates Notion. Work then continues with C4. The phase-close stop comes after C7, or earlier at an owner gate (record 39 decision 2).
- Then C4 in slices, the P04 recheck and C7, in the same pattern.

## Limits

- Not verified yet; these are pilot checks:
  - whether Codex fires `.codex/hooks.json` for its own tool names (the matcher uses Claude tool names);
  - whether `--ignore-user-config` keeps sign-in working;
  - whether `features.memories=false` is honoured.
- The quota reading trails the newest call. It cannot stop a job that crosses a limit mid-way; Codex's own hard limit does that, and the cut-off handling covers it.
- What the checkout comparison does not cover:
  - `node_modules/` is fingerprinted only by its top-level listing and lock file, not by hashing every file;
  - `artifacts/` (ignored, root's evidence) is not compared, except for the job's own backup;
  - the `.git` object store is not compared beyond HEAD, the branch, refs, the index, config, info and hooks.
