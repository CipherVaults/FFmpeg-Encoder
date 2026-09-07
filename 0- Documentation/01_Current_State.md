# Current state

Updated through milestone H, September 8, 2026. Inspect live Git and the continuation note for unfinished work.

## Current milestone

Milestones A–E are verified: preservation, baseline, context/versioning, Electron 44.2.0 (`0dd8542`), and matching FFmpeg/ffprobe 9.0.1 (`9c25694`). Documentation/history are checkpointed in `14c874f` and exact archive checkout behavior in `53ce087`. Both independent runtime upgrades passed the unchanged native successful-flow smoke. Twelve short encoder cases passed (six profiles, each eight/ten-bit SDR), including probing and full decoding. See [runtime evidence](Execution%20Summaries/2026-09-07_Runtime_Upgrades.md). Milestone F is implemented and verified through restricted loadFile: 87 unit/integration tests plus real app and lifecycle smoke checks pass. See the Process Architecture execution report. Milestone G now passes 89 automated tests, native session/CSP/navigation checks and the real app flow; see the Local Protocol execution report. Milestone H product checks now pass: all six UI profiles/actual arguments, rich preservation and mixed outcomes, native Windows folder selection, 110 accepted profile-option cases and 25 layout captures. See [Product Acceptance](Execution%20Summaries/2026-09-08_Product_Acceptance.md) for the requirement map and limits. Portable packaging and final acceptance I remain pending in [Continuation State](10_Continuation_State.md).

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

The current app uses main-owned folder/plan tokens, validated settings, a sequential queue, bounded probing, buffered progress, output validation/publication, and cancellation that retains process ownership until close. A sandboxed renderer calls a narrow preload API and displays snapshots. Profiles are selected independently and runtime-tested on the actual device. The legacy defects below remain historical characterization evidence, not current implementation claims.

Those findings invalidate historical claims of a fully stable or hardened pipeline. Twelve characterization tests passed (seven reproduce known defects, five preserve positive behavior). A real Electron 41.0.2/original-FFmpeg smoke completed two generated SDR H.265 CPU encodes and full output decode with no page errors. Folder button/IPC flow was real, but the native picker return was substituted; the picker itself is untested. See `artifacts/legacy-baseline/1788732750752/report.json`, adjacent `unit-results.txt`, and the baseline execution report. Harness checkpoint: `7b7b5c8`. That baseline report is historical; current CPU/NVIDIA, color and preservation evidence is in the H report. Portable release acceptance remains unfinished.

## Approved direction and next action

Continue milestone I of the [amended plan](09_Approved_Execution_Plan.md): build and independently verify the actual extracted portable application, then finalize the 0.5.0 evidence and checkpoint. Do not repeat completed baseline/runtime audits unless new evidence requires it.

`1.0.0` in the old manifest is scaffold metadata. The approved sequence is `0.5.0-dev.1` during development and `0.5.0` after local milestone acceptance; changing the version alone does not prove a release.

## Approval boundaries and honest limitations

Local execution is authorized. GitHub creation/upload awaits exact account, repository, and upload inventory review. Public release, credentials, machine-global changes, destructive history operations, unrelated files, and major direction changes remain separate boundaries. These gates do not block ordinary project-local engineering progress.

The old-runtime and both independent upgrade smoke checks are verified within their stated coverage. The standalone cases prove local operation; H adds actual application preservation/settings/UI evidence. Native folder picker interaction is verified, while native close-dialog choices are substituted in otherwise real lifecycle checks. Clean-machine testing and the offline portable ZIP remain unverified. No perceptual-quality equivalence is claimed.
