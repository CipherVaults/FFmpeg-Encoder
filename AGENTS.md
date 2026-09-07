# FFmpeg Encoder: agent operating context

This is Ahmed's long-paused existing Electron application, resumed through the September 6, 2026 Mother Thread handoff and amended execution approval. Preserve its history and explain changes for a future programmer. The locally verified 0.5.0 milestone is the approved objective; the old npm `1.0.0` value was scaffold metadata.

## Re-entry

Read `0- Documentation/01_Current_State.md`, the newest entry in `06_SESSION_SUMMARY.md`, and the relevant sections of `00_Project_Architecture.md` and `09_Approved_Execution_Plan.md`. Use `07_Execution_Index.md` to find evidence for the milestone you are continuing. Inspect live files and Git status before trusting recorded state. Read historical archives or external PBS documents only when the task needs them.

## Authorized work and boundaries

- Work in `D:\Codex Projects\FFmpeg Encoder`. Preserve `C:\Users\Ahmed\Desktop\ffmpeg-ui` and the verified backup. Never develop inside the original or backup.
- Execute the approved local milestones autonomously, including project-local dependencies, controlled encodes, recoverable fixes, local packaging, and Git checkpoints. Ordinary failed tests and routine implementation choices do not require renewed approval.
- Obtain separate approval for GitHub creation/upload, public release, machine-global changes, credentials, destructive Git history operations, unrelated filesystem changes, and major product or architecture direction changes. Do not send messages to other people without explicit authorization.
- Preserve current user changes. Use the `codex/` branch prefix. Commit meaningful milestones separately; use corrective commits or reverts rather than rewriting history.
- Keep Electron upgrades, FFmpeg/ffprobe upgrades, and the major process refactor independently testable and checkpointed. Establish the old-runtime baseline first.

## Implementation invariants

- Main owns folders, validation, plans, the sequential queue, child processes, output protection, and authoritative progress. The renderer presents state and calls a narrow preload API; no Node access, arbitrary filesystem API, executable path, shell command, argv, or unrestricted IPC bridge is exposed to it.
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
