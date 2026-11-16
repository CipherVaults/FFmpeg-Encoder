# Blue Linux: project bootstrap and continuation

**Scope:** the private `CipherVaults/FFmpeg-Encoder-Blue-Linux` repository, branch `blue/linux-development`. This is an experimental Linux development lane, not the Windows release or a replacement for its records.

## 1. Purpose and authority

Build useful Linux CPU and platform-independent work that can later be reviewed for reuse in Windows. Prefer small, understandable changes over a second architecture. Blue coordinates this lane; Ahmed owns product direction and acceptance. The current request authorizes this Linux-specific bootstrap. It does not authorize release, merging into the original project, changing repository visibility, or bypassing a failed review.

This is an original project-local adaptation of **AI PBS method 1.1**, not a copy of the canonical skill or a new PBS version. The existing Windows instructions remain preserved. Their Windows paths, execution allowances and historical role assignments are not automatic instructions for this separate environment. Keep their applicable safety and architecture constraints. Resolve a genuine conflict against the owner's current direction before dependent work.

## 2. Re-entry route

1. Read this file and [the branch marker](BLUE_LINUX_BRANCH.md).
2. Check the actual repository, branch, remote tip, working tree and changed-file list. Preserve unfinished work; never reset or force a clean tree for presentation.
3. Read [AGENTS](AGENTS.md), particularly implementation invariants and evidence conventions. For historical context use [PBS context](0-%20Documentation/08_PBS_Context_and_Migration.md), [the handoff](0-%20Documentation/50_Blue_Handoff_Claude_to_Codex_2026-11-15.md), [Continuation](0-%20Documentation/10_Continuation_State.md), and the relevant [Q plan](0-%20Documentation/47_Milestone_Q_Plan_2026-11-12.md). Treat dated Windows results as dated Windows results.
4. Read the code and tests for the next bounded claim, not the entire archive on every session.
5. Verify this executor's OS, CPU architecture, display, tool versions and available capabilities. Do not infer GPU support, hardware encoding or Windows behavior from an Electron dependency.
6. Identify what is already committed, local-only, verified, unverified or blocked. Choose the next permitted unfinished step from those facts.

The old Windows re-entry scripts may expect machine-local records and protected baselines that are not present here. Inspect their prerequisites before running them. Do not regenerate a baseline to hide a mismatch.

## 3. Architecture to preserve

[main.js](main.js) composes the application services and runtime verification. [package.json](package.json) identifies the Electron entry and test scripts. [candidate-runtime.cjs](src/candidate-runtime.cjs) currently describes a Windows-specific runtime; it is not proof that Linux startup works.

Keep the renderer untrusted and the preload API narrow. Main owns process execution, files, validated settings, queue state, cancellation and publication of completed outputs. Do not expose shell commands, arbitrary executable paths, arbitrary arguments or filesystem access through the UI.

Linux runtime selection belongs at a deliberate platform boundary. Do not make Windows fall back to an arbitrary PATH executable. Keep runtime identity, availability and codec qualification separate. Shared JavaScript can be reusable without proving native dialogs, file semantics, installers, GPU behavior or an end-to-end app on both platforms.

Preserve original inputs and existing outputs. Cancellation must wait for owned children to close. Output publication needs the applicable validation and no-overwrite behavior. A successful encode alone is not a successful lifecycle test.

## 4. Current bounded checkpoint

At this documentation checkpoint:

- The fork's candidate branch was observed at `1b9838a0c4a9379ef36032ddea4c422e66aaea9b`.
- The Linux branch was observed at `a1352aa6643ef0d8d164a497a25d7f66041908cd`, containing the branch marker added after that candidate. This file will be a later documentation commit.
- Remote access, private visibility and push permission were checked. No claim of complete source synchronization, complete local-work recovery, Linux app support or Windows acceptance follows.
- Separate cloud experiments exist, but this document does not publish them or certify their dependency closure. Their admission must be assessed independently before import.
- Earlier publication-review restrictions remain unresolved. New documentation is not a mechanism to reproduce blocked material or to authorize another transport for it.

This orientation read the fork's instructions, PBS context, handoff, selected current-plan passages, package entry and runtime boundary. It is **not a complete code audit**. The next implementation needs focused source review and tests.

## 5. A proportionate development loop

For each bounded change, state:

- **User benefit:** the behavior this work will enable.
- **Scope:** the files owned by this task and what is deliberately excluded.
- **Done means:** a finite, observable acceptance condition.
- **Checks:** focused tests, relevant integration checks, expected platform limits.
- **Stop point:** a failed safety condition, missing dependency, or scope expansion.

Use one writer per checkout. Review substantive changes independently. Test good inputs being accepted as well as bad inputs being refused. Fix a demonstrated defect without turning it into an unbounded framework project. When a task expands beyond its claim, record the reason and choose the smallest useful next step.

Keep hardware-dependent and Windows-only qualification explicitly pending. Do not change product defaults, benchmark baselines, accepted releases, deferred HDR scope or protected catalogs merely to make Linux tests pass.

## 6. Evidence and records

Do not manufacture a second copy of the Windows history. Maintain Linux-specific records only when their facts change:

| Question | Record |
| --- | --- |
| Where do I start; what is the current bounded state? | This bootstrap |
| What did a meaningful implementation step change and verify? | A dated Linux execution report created with that step |
| Why did the session change direction; what is unfinished? | A Linux session/handoff record at a substantive stop |
| What does the shared product require? | Existing requirement owners, linked rather than rewritten |

A verification entry states the exact commit or file hashes, command, result, limits and retained failure evidence. Distinguish unit, synthetic-media, integration, visible-UI and hardware results. A skipped test is not a pass. A historical pass does not cover changed bytes. For a substantive session summary, use the project's adopted full PBS format; this compact bootstrap is not its replacement.

## 7. Git and GitHub rhythm

Use this lane's branch for Linux work. Make a coherent commit, review the explicit path list, and publish reviewed in-scope work through an authorized supported route. Avoid blanket staging. Keep credentials, personal media, generated binaries, local application state, private planning and raw diagnostic histories out of new commits.

Use a plain-language subject and a short multiline body:

- Why the change helps.
- What changed.
- What was checked, on which source identity.
- What remains untested or unfinished.

Before a stop, make a recoverable checkpoint when permitted, clearly label unfinished work, and verify the remote commit. A local commit, uploaded object or successful API call alone does not prove the intended branch contains the work. Report local-only work honestly when publication is blocked.

Do not force-push, rewrite history or merge into the original project as a side effect. Later integration requires a reviewed diff and relevant Windows verification; a Linux pass alone cannot grant it.

## 8. Next permitted step

Read back this documentation commit and confirm its branch. Then inventory the exact candidate files for the next Linux task and establish which can be reviewed independently. Do not import unresolved prior publication payloads. Once that boundary is clear, select one shared or CPU-only behavior, define its tests, and continue within the owner's current scope.
