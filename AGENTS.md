# FFmpeg Encoder: agent operating context

This is Ahmed's long-paused existing Electron application, resumed through the September 6, 2026 Mother Thread handoff and amended execution approval. Preserve its history and explain changes for a future programmer. The accepted local-v0.5.0 baseline is immutable; the active approved objective is local 0.6.0 through J–M in `0- Documentation/11_Approved_0.6_Goal.md` and `12_Approved_0.6_Plan.md`; the old npm `1.0.0` value was scaffold metadata.

## Re-entry

Read `0- Documentation/01_Current_State.md`, the newest entry in `06_SESSION_SUMMARY.md`, and the relevant sections of `00_Project_Architecture.md` and the active `12_Approved_0.6_Plan.md` (09 is the completed A–I history). Use `07_Execution_Index.md` to find evidence for the milestone you are continuing. Inspect live files and Git status before trusting recorded state. Read historical archives or external PBS documents only when the task needs them.

## Authorized work and boundaries

- Work in `D:\Codex Projects\FFmpeg Encoder`. Preserve `C:\Users\Ahmed\Desktop\ffmpeg-ui` and the verified backup. Never develop inside the original or backup.
- Execute the approved local milestones autonomously, including project-local dependencies, controlled encodes, recoverable fixes, local packaging, and Git checkpoints. Ordinary failed tests and routine implementation choices do not require renewed approval.
- Obtain separate approval for GitHub creation/upload, public release, machine-global changes, credentials, destructive Git history operations, unrelated filesystem changes, and major product or architecture direction changes. Do not send messages to other people without explicit authorization.
- Preserve current user changes. Use the `codex/` branch prefix. Commit meaningful milestones separately; use corrective commits or reverts rather than rewriting history.
- Keep Electron upgrades, FFmpeg/ffprobe upgrades, and the major process refactor independently testable and checkpointed. Establish the old-runtime baseline first.

## Implementation invariants

- Main owns folders, validation, plans, the sequential queue, child processes, output protection, and authoritative progress. The renderer presents state and calls a narrow preload API; no Node access, arbitrary filesystem API, process execution, shell command or argv submission, or unrestricted IPC bridge is exposed to it. Main may provide the validated prepared argv and runtime path through narrow read-only display APIs under the approved transparency amendment.
- Prove preload/context isolation/validated IPC before introducing the custom local application protocol as a separate hardening checkpoint.
- One encode at a time. Retain each child handle until its close event; prevent stale callbacks from clearing newer state. Cancellation stops queued work and awaits process exit/cleanup before restart.
- Closing during work offers “Cancel encoding and exit” or “Keep application open.” Renderer loss cancels active work. Background/headless encoding and window restoration are future work.
- Preserve original media and existing outputs. Use encoder-based names and skip existing destinations without numbered alternatives. Publish only a validated output using no-overwrite semantics; clean up only owned incomplete files.
- Preserve supported audio, subtitles, attachments, metadata, dispositions, and chapters. Reject an unsupported preservation case with a clear reason rather than silently dropping content.
- This milestone is SDR-first. Ten-bit pixels, HEVC Main 10, and BT.2020 primaries alone do not prove HDR. Apply the documented metadata criteria and classify unresolved/ambiguous color evidence separately from detected HDR.
- Validate the exact shipped encoder capabilities and short real encodes before adopting provisional CRF/CQ/preset defaults. Equal quality numbers across encoders do not mean equal visual quality.
- Keep explanatory comments at trust boundaries, lifecycle ownership, media decisions, and non-obvious failure handling. Keep HTML structure, CSS presentation, renderer behavior, and main system work separate.

## Evidence and documentation

At every completed milestone, the parent performs a synchronization pass across Current State, Roadmap, acceptance gates, Execution Index, Session Summary, and relevant technical documentation against actual Git and test evidence. Parallel-agent output is not a completed milestone until this reconciliation passes. Keep changes proportional; do not rewrite already-correct documentation. Resume the exact unfinished action from `0- Documentation/10_Continuation_State.md` when present, verifying live state first.

Record what was tested, the command/tool, result, artifact/checkpoint, and limits of the evidence. A mock is not proof of a native dialog or a real encode. A same-machine portable run is not a clean-machine test.

Update Current State, Architecture, Roadmap, Technical Reference, README, and CHANGELOG when behavior changes. Prepend meaningful sessions to the cumulative Session Summary; preserve earlier entries. Create one dated Execution Summary per milestone under `0- Documentation/Execution Summaries`, with an index link, concrete evidence, failures/recovery, and next step. Group routine retries into that report. Add corrections to a completed report transparently.

Keep canonical PBS external. This file and the short provenance/context document are the local adaptation. Do not copy the full PBS or unrelated projects' documentation by default. Historical source documents retain their original wording and are not current acceptance evidence.

## Windows practice

Prefer portable tools already available and project-local dependencies. Use PowerShell-safe quoting and literal paths; inspect resolved paths before any recursive move/delete. Do not compose destructive filesystem operations across shells. Launch background helpers hidden. Keep media, binaries, node_modules, raw chat exports, backups, and generated outputs out of Git; track reproducible provisioning manifests and relevant small evidence instead.

## Active 0.6 scope

September 19 binding amendment: `0- Documentation/14_Approved_0.6_Archive_Quality_Amendment.md` is the complete local mirror of Ahmed's Notion direction. It promotes HEVC Archive Quality Ada/Blackwell into L/M; verify exact pinned runtime options, benchmark CQ24 and23 against x265 slow CRF25 using representative safe footage, and require actual Blackwell plus packaged evidence. Preserve Tested Default separately; do not assert CQ/CRF equivalence or locally verified Ada. The September13 future-only recipe exclusion is superseded only for this specific HEVC feature.

September 13 amendment: Ahmed has resumed autonomous execution and approved intentional generated-output re-encoding, provenance UX, and canonical encoder/command transparency as binding L/M completion requirements. Read `0- Documentation/13_Approved_0.6_Product_Amendment.md` with the Goal/Plan and any newer product-owner direction. Preserve surviving L work and accepted J/K; require independent amended L/M evidence before final M acceptance or `local-v0.6.0`. The earlier control pause is lifted.

Execute J inspection reuse, K same-folder provenance/publication, L preferences/compact preview/Tested Default and M separate portable acceptance. Advanced controls remain primary. Keep FFmpeg/Electron pinned. Two bounded inspection workers may run; encoding stays sequential. Reuse completed planning and hardware research. D: development is explicitly authorized despite its acknowledged longstanding warning: do not diagnose/repair/relocate it; report only concrete new project I/O failures. Personal OBS media at `F:\shadow play\OBS` is read-only for development. The known active `2026-09-08 19-02-39.mkv` is excluded from representative planning/performance fixtures regardless of size. Never reset usage credits. Keep the same recurring heartbeat aligned and retire it at verified 0.6 closure or a genuine approval/unsafe boundary.
