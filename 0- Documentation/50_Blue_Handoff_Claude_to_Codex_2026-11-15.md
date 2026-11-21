# 50 — Blue handoff: development moves from Claude to Codex (November 15, 2026)

**Status:** prepared by Claude (root) on November 15, 2026, about 18:00 Cairo, at Ahmed's request. It takes effect when Ahmed, or Blue (ChatGPT) on his word, starts the Codex lead session. Until then nobody writes to this checkout.

**Read this first if you are the incoming Codex lead.** Then `AGENTS.md` (top banner and Implementation invariants), the top of `10_Continuation_State.md`, and run the re-entry check (section 6). Trust live Git and files over this text where they differ.

## 1. Ahmed's decision, in his words

- "I think it's best now to shift to Codex directly … And call it blue handoff, because blue is ChatGPT … which is gonna be coordinating this move, and the AI PBS should help obviously significantly … the handoff should smooth things out even further. So after this fix job 14 finishes, stop and prepare these handoffs and AI PBS updates and everything as this point and its current state, so we can migrate the development from Claude to Codex once again."
- Earlier the same day: "your quota is the bottleneck here … supply Codex with work tasks and everything till this app gets finished eventually in 0.7".
- On PBS: "I meant, yes, the FFmpeg project PPS records, not further development for the PPS version 1.2 development. With that, it stays paused." FFmpeg Encoder keeps its records in the **PBS 1.1** form. PBS 1.2 is paused in its own folder and is not adopted here.
- On these records: "write it yourself if possible, since this is possibly the last job for you here, and I need it as best as possible."

## 2. Roles after the handoff (what Ahmed asked for; Blue confirms the details)

| Role | Who | Notes |
|---|---|---|
| Owner and acceptance authority | Ahmed | Unchanged. Owner gates in section 5. |
| Coordinator of the move | Blue (ChatGPT) | Relays Ahmed's decisions; does not write here. |
| Lead (root): scheduler, integrator, committer, writer of records and Notion | **Codex**, one lead session in `D:\Claude's Projects\FFmpeg Encoder` | Replaces Claude's root role from [record 35](35_0.7_Claude_Continuation_Authority_2026-10-29.md) and [record 40](40_Codex_Teammate_Arrangement_2026-10-31.md). Record 40's rule "Codex never commits, pushes, edits records or writes Notion" applied to Codex as a *worker* under Claude; it does not bind the lead session. |
| Workers and reviewers | Codex sessions the lead starts | A review is always a fresh session that did not write the work. Workers do not commit. |
| Claude | Only if Ahmed brings it back | Its toolkit stays in `.claude/`; its Codex copies are in `.agents/` and `.codex/`. |

One writer at a time still holds: the lead does not edit files while one of its own write jobs runs in the same checkout.

## 3. Where things stand (verified live, November 15, 2026)

- **Branch** `codex/v0.7-candidate` on the private remote `AE0101/FFmpeg-Encoder`. Code HEAD `4df3389` ("Give every remux playback field a check that can fail, including seeking"); the records commit that adds this file sits on top. Local and remote equal after each push. Index empty. Protected tags and the 0.5/0.6 releases untouched.
- **Uncommitted and never to be committed:** private `0- Documentation/Planning/` files; `assets/logo-candidates-2026-11-14/.qa-electron-state/` (an app state folder left by a QA run).
- **Milestone Q** ([record 47](47_Milestone_Q_Plan_2026-11-12.md)) is in progress. Done and committed: Q1a–Q1e, Q2a–Q2e, Q2g, Q2i, Q2o and Q2j part 1 (TS→MP4 plus native playback checks on every MP4/MOV route), the Gauge logo set (`5f8c020`, not wired in).
- **Q2j part 1, last state.** The remux check is driven by one declared list of 597 playback fields: 189 compared natively, 219 required to hold their default, 142 covered by a named executable witness, 47 descriptive. An unlisted box, element or descriptor is refused. Seeking counts as playback: Matroska Cues and SeekHead, ISO sync and fragment indexes and TS random-access markers are checked, with end-to-end seek witnesses (indexed sources: same first decoded packet; TS sources: same presented frame after accurate seeking).
- **Evidence for `4df3389`.** Codex receipt `20261115T151926Z_q2j-ts14-full-r2`: 3,721 tests, 3,711 pass, the 5 parked failures, 5 skipped; `20261115T150227Z_q2j-ts14-remux-final`: 1,188/1,188. Root checked by script that both receipts' file hashes equal the committed bytes and that the full receipt covers all 63 changed files. Root did not re-run the suites (Ahmed's November 15 instruction).
- **Personal media.** All 1,703 files were compared on job 12's code with no admission change (log `artifacts/v0.7/milestone-q/q2j/admission-root/admission-log.md`). On the final code only a focused set (21 real files, 7 generated framings) was compared: no real-file change.
- **The 5 parked failures** are catalog/producer tests, out of scope and unchanged since October; they are not to be "fixed" by changing the catalog.

## 4. Exact next actions for the Codex lead, in order

1. **Re-enter** (section 6). Take the writer lock: `node artifacts/v0.7/claude-continuation/heartbeat.cjs "q2j" "<next>"` writes `writer-lock.json`; set the writer to your session.
2. **Close Q2j part 1:**
   1. A fresh, read-only review (review 9) of `git diff 33d341d..4df3389` under `src/ tests/ scripts/`. Reuse `artifacts/v0.7/milestone-q/q2j/brief-review-8.md`; ask whether review 8's findings are fixed and whether the area is sound enough to stop.
   2. The full personal-media admission comparison on the final code, read-only, on a copy of the log so its saved probes are reused: `node scripts/v07-remux-admission-batch.cjs <copy of admission-log.md> artifacts/v0.7/codex/20261114T223341Z-q2j-ts-11-f3984a/before`. Any ordinary file that becomes refused is a defect.
   3. Decide whether `REMUX_POLICY_ID` must change, since admission and validation changed in `29081e4` and `4df3389` while the id stayed `full-remux-v6:2026-11-14:packet-identity-transport`. If it changes, re-run the catalog qualification and normal-service proofs as earlier slices did (`scripts/v07-remux-long-smoke.cjs`, `scripts/v07-remux-service-smoke.cjs`; the commands are in the Q2j part 1 execution summary).
   4. Fix what the review finds (same rules: a witness, a native check or a refusal; never a relaxed gate), then commit and record.
3. **Then the queue** (record 47 sections 6–10; Ahmed's order): Q2j part 2 MP3→MP4 (exact stream copy, with the Apple-player compatibility note); the Gauge logo wiring (Ahmed sees the running app in both themes before the shipped icon is replaced); Q2n trim and whole-file resize at any length, with 4K and 1440p sources as critical work; Q2k audio choices for MKV→MP4 (bring the measured numbers to Ahmed before fixing the default); Q2l; Q2m; Q2h; Q2f; the AMD/Intel cheaper check as default (O4); a sample tool that checks the fast checker against a full decode (record 47 §11 rule 3); the optimization pass (one traversal per side; target 3 s fixed plus 6 s per GB). Then milestones R and S, then packaging (portable and installer) last.

## 5. Owner gates (only Ahmed decides)

AMF same-component producer technical disposition; milestone and product acceptance; the shipped icon after he sees the running app; the Q2k default after the numbers; packaging acceptance; any scope change.

## 6. Rules the lead must keep (unchanged)

- **Hard limits** (record 35, amendments 32/33): order non-HDR P01–P04 → eligible Q → R → S, HDR P05–P09 deferred, packaging last. Never: Security Cloud; changes to ordinary defaults, Archive CQ29, the benchmark or accepted tags; public release; force push or history rewrite; staging `0- Documentation/Planning/`; dependency or runtime upgrades.
- **Personal media `F:\shadow play`:** read anything; write new files only in `F:\shadow play\FFmpeg Encoder Tests\`; never delete, move, rename or overwrite anything there.
- **Evidence:** run tests with `node .claude/skills/evidence-run/run-tests.cjs <label> <tests...> --covers <src...>` (receipts under ignored `artifacts/v0.7/evidence/`); a result applies only to the bytes in its receipt; failed receipts are kept, never relabelled; tolerances are never widened; tracker 25 requirement texts and order are never edited.
- **Records (PBS 1.1):** after each phase update only the owners whose facts changed: Current State, Continuation, tracker 25 rows, Execution Index, the dated Execution Summary, `06_SESSION_SUMMARY.md` in its full template. New entries on top; history kept. Back up a record before editing it.
- **Notion:** the hub shows one status callout, replaced in place; the Blue — Handoff page gets a dated entry on top; read both back.
- **Commits:** plain outcome subject; body with why / what / verification and its scope / limits; explicit paths only; normal push, then check that local and remote are equal.
- **Security from the left** (AGENTS.md Implementation invariants): renderer untrusted, main owns authority, no shell, bounded bytes/children/time, fail closed with specific codes, a negative test for each new guard.
- **Talk to Ahmed** in plain words, codes in brackets.
- **Re-entry check:** `node .claude/skills/reentry-check/reentry-check.cjs` (hashes, Git/remote equality, protected refs). Any FAIL stops dependent work.
- **Guard:** `.codex/hooks.json` mirrors the project guard (history, media, Planning, install rules). Do not weaken it; report a block instead.

## 7. Known traps

- **Codex helper folder.** Running `codex exec` with `-c windows.sandbox="unelevated"` rewrote `C:\Users\Ahmed\.codex\.sandbox-bin` and removed `codex-code-mode-host.exe`; Codex runs without a sandbox then failed before their first command. Restore it from the installed Codex folder of the same version (`C:\Users\Ahmed\AppData\Local\OpenAI\Codex\bin\<version>\`), checking the hash.
- **Slow test.** "a near-cap long synthetic walk" takes 44–50 s and times out at 120 s under heavy load. Run the two full suites one after the other.
- **Paths** contain an apostrophe and spaces; write multi-line text to files rather than shell strings.
- **Line endings.** Git warns that LF will become CRLF; this is harmless here.
- **Quota.** Codex weekly window 43% used on November 15 (resets November 21, 13:15 UTC); Claude's weekly allowance is nearly spent.

## 8. What Claude leaves behind

- The `codex-run` wrapper (`.claude/skills/codex-run/`) let Claude run Codex jobs with receipts and change checks; a Codex lead does not need it.
- Roadmap artifact "FFmpeg Encoder Roadmap" (claude.ai, Claude-only); its source is `artifacts/v0.7/roadmap/ffmpeg-encoder-roadmap.html` and is out of date after November 14.
- Briefs and receipts for every Q2j job under `artifacts/v0.7/milestone-q/q2j/` and `artifacts/v0.7/codex/` (ignored by Git; local only).
- PBS 1.2 work, paused, in `D:\Claude's Projects\The AI PBS` (its own `HANDOFF.md`). Not part of this project.

## 9. Dated addendum: regular v0.7 safe-stop on November 21, 2026 Cairo

The November 15 handoff above is historical and preserved as written. Its former readiness, executor assignments and ordered queue do not authorize resuming regular work after this stop. Blue owns the regular lane only; the separate Windows Alpha remains with its existing owner and qualification/publication path. No owner machine, physical GPU or additional executor action is requested by this addendum.

Re-entry reference if the owner later reconciles and authorizes resumption: exact original CP146 `fd7dc4e480f8c47fe300cac8de744019e65a87c4` / tree `3ed50e9781a2c77f2261a8515b50a0eb2bb0308c`, Current State, Continuation, and [Regular v0.7 safe-stop and evidence record](Execution%20Summaries/2026-11-21_Regular_v0.7_Safe_Stop.md). The designated public mirror and exact private recovery were verified independently, and CP146's own hosted Windows and Ubuntu source checks passed. Reconfirm alignment instead of assuming Git-history identity or package availability. Keep the exact-146 vendor composition held: 96 controlled cases passed on the composed and cold copies and the delta is privately recoverable, but uncommitted and unintegrated pending outstanding evidence and final exact review. Q and R still have real native or method-specific gaps and S manufacture remains held; no work resumes automatically and no new product, package or release claim follows.
