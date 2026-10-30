---
name: phase-close
description: The FFmpeg Encoder end-of-phase routine — evidence, PBS record owners, commit, push and readback, Notion overlays, writer lock, then a plain-language stop for Ahmed's effort switch and /compact. Use at the end of every phase or work chunk, before any pause, handoff or effort change; never continue past the stop on your own.
---

# Phase close (PBS)

Work through these steps in order. Steps 4 and 8 are scripted; the rest are judgement, written in plain words.

**When it runs:**
- **Checkpoint:** steps 1–8 run at the end of every planned work step (for example each of C1, C2, C3 and C4). Afterwards, carry on with the next step of the same phase.
- **Stop:** step 9 runs only at the end of a phase, where the next work may need a different effort and a planned `/compact` fits. It also runs at any owner gate, or when Ahmed asked to be stopped at that point.
- **Current phase:** the AMD/Intel connection, C1 through C7. Its stop comes after C7, before Q01.

1. **Evidence.** Every result you will cite has an `/evidence-run` receipt for the exact final bytes. Substantive diffs (main, preload, IPC, child processes, paths, publication, scripts that spawn processes) have had `/security-review` and an independent `reviewer` pass. Fix or record every confirmed finding.
2. **Before copies.** Before editing a file whose history must be preserved, copy it into the phase's `artifacts/.../before-*` folder.
3. **Records.** Update only the owners whose facts changed. New entries go on top; older text is preserved.
   - `01_Current_State.md` and `10_Continuation_State.md`: a short dated banner on top. Say plainly whether work is active, paused, or waiting on Ahmed, and give the exact next action.
   - `25_0.7_Requirements_and_Evidence.md`: status notes only. Never edit the 43 requirement texts or their order.
   - `07_Execution_Index.md`, the dated section of the newest `Execution Summaries/` file, and `06_SESSION_SUMMARY.md` (full 14-section template, newest on top).
   - A new owner decision gets a numbered record, or a dated section in the current one, quoting Ahmed's words.
4. **Pre-commit check.** Stage explicit paths only, never Planning. Then run:
   ```bash
   node .agents/skills/phase-close/phase-close-check.cjs
   ```
   It must show no FAIL. It checks the branch, that no Planning file is staged, the session-summary template and Codex toolkit drift, and lists which owner records changed. If `.claude/` changed, run `toolkit-sync --write` first and stage the regenerated copies.
5. **Commit.** Write a plain, outcome-based subject. The body covers why, what, verification with receipt labels, and scope and limits. End it with the attribution lines.
6. **Push and read back.** Push normally to `codex/v0.7-candidate`, never with force. Then run `node .agents/skills/phase-close/phase-close-check.cjs --after-push` and `/reentry-check`.
7. **Notion.**
   - Replace the FFmpeg Encoder — Project Hub's single status callout with the current position in plain words. Never stack older callouts; the hub is not a memory (Ahmed, record 39).
   - Add a dated entry on top of Blue — Handoff, never rewriting its history.
   - Read both back.
8. **Writer lock.**
   - At a checkpoint, run `node artifacts/v0.7/claude-continuation/heartbeat.cjs "<next step>" "<next action>"` and continue.
   - At a stop, run `node artifacts/v0.7/claude-continuation/heartbeat.cjs "awaiting-owner" "<next action in plain words>"`.
9. **Stop.** End the turn with a short message in plain words: codes go in brackets, after the plain description.
   - What finished, and where it stands.
   - What the next phase is.
   - Recommended effort for that phase (table below), and whether that is a change.
   - The ask: if the effort changes, switch it in the app's model/effort picker; then type `/compact` and reply "go".

   Do not continue until Ahmed replies. When he does, read this session's effort (session metadata, `get_session` "self") and continue only if it matches his choice.

| Work in the next phase | Lead effort |
|---|---|
| Trust-boundary code or design: main/IPC/child processes/paths/publication, native integration, Q media paths, final review | xhigh |
| UI, settings, accessibility, copy, packaging, records-only stretches longer than one session | high |
| Never | max, or Opus 5.5 lower than high for the lead |

Subagent efforts are fixed in `.claude/agents/` and are not switched. Workflows set effort per agent explicitly.
