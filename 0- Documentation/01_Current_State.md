# Current state

Updated for the documentation bootstrap on September 6–7, 2026. This is a checkpoint record, not a claim that later work has completed. Inspect Git and newer execution reports when re-entering.

## Current milestone

Milestones A–E are verified: preservation, baseline, context/versioning, Electron 44.2.0 (`0dd8542`), and matching FFmpeg/ffprobe 9.0.1 (`9c25694`). Documentation/history are checkpointed in `14c874f` and exact archive checkout behavior in `53ce087`. Both independent runtime upgrades passed the unchanged native successful-flow smoke. Twelve short encoder cases passed (six profiles, each eight/ten-bit SDR), including probing and full decoding. See [runtime evidence](Execution%20Summaries/2026-09-07_Runtime_Upgrades.md). The active architecture refactor is partially written and not integrated or accepted; the runnable root entry point remains the legacy app. Next action is integration/testing, detailed in [Continuation State](10_Continuation_State.md). Portable packaging and final acceptance remain pending.

## Verified locations and checkpoint

| Item | Evidence |
|---|---|
| Original, preserved | `C:\Users\Ahmed\Desktop\ffmpeg-ui` |
| Verified backup | `D:\Codex Projects\FFmpeg Encoder - Backups\2026-09-06_211556\ffmpeg-ui` |
| Working copy | `D:\Codex Projects\FFmpeg Encoder` |
| Backup verification | Adjacent `verification.json`, verified `2026-09-06T21:16:26.8609717+03:00` |
| Inventory | 974 files, 690,310,811 bytes; every SHA-256 matched original → backup → working copy |
| Source baseline | `c30d335a62f6296d0c61ef25ad5fba10eb3c8438` |
| Baseline tag | `baseline-2026-09-06` |
| Active branch at bootstrap | `codex/reentry-completion` |

The initial commit preserves the unchanged `main.js`, `renderer.js`, `index.html`, `package.json`, and `package-lock.json`, plus a new `.gitignore`. The full backup includes dependencies, media, and historical context that are intentionally outside the source Git baseline. The archival documentation copy now prepared for versioning contains Markdown and prompt templates only.

## Implementation reality

The old app has a renderer-owned sequential loop, direct renderer filesystem access, a raw stderr telemetry parser, and a hardcoded libx265/slow/CRF 25 encode path. UI codec/hardware/preset/CRF controls do not configure the main encode operation. Cancellation clears the child handle before close and does not reliably stop the renderer queue. Child spawn/error and rejected encode paths lack complete recovery.

Those findings invalidate historical claims of a fully stable or hardened pipeline. Twelve characterization tests passed (seven reproduce known defects, five preserve positive behavior). A real Electron 41.0.2/original-FFmpeg smoke completed two generated SDR H.265 CPU encodes and full output decode with no page errors. Folder button/IPC flow was real, but the native picker return was substituted; the picker itself is untested. See `artifacts/legacy-baseline/1788732750752/report.json`, adjacent `unit-results.txt`, and the baseline execution report. Harness checkpoint: `7b7b5c8`. No new CPU/NVIDIA profile, HDR classification, preservation contract, or portable release is marked accepted here.

## Approved direction and next action

Continue milestone F of the [amended plan](09_Approved_Execution_Plan.md): complete and integrate the main-owned service and isolated preload/UI, then test its lifecycle and boundary before adding the custom protocol. Do not repeat completed baseline/runtime audits unless new evidence requires it.

`1.0.0` in the old manifest is scaffold metadata. The approved sequence is `0.5.0-dev.1` during development and `0.5.0` after local milestone acceptance; changing the version alone does not prove a release.

## Approval boundaries and honest limitations

Local execution is authorized. GitHub creation/upload awaits exact account, repository, and upload inventory review. Public release, credentials, machine-global changes, destructive history operations, unrelated files, and major direction changes remain separate boundaries. These gates do not block ordinary project-local engineering progress.

The old-runtime and both independent upgrade smoke checks are verified within their stated coverage. The twelve standalone encoder cases prove local argument/format/device operation, not the unfinished application's preservation/lifecycle contract or perceptual quality. Native picker interaction, clean-machine testing, and the offline portable ZIP remain unverified.
