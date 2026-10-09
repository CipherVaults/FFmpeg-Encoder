# Current state — October 10, 2026

## Active research: approved pre-0.7 Phase 1 benchmark

Ahmed's [Phase1 Goal](18_Phase1_Benchmark_Goal.md) authorizes the amended [protocol](19_Phase1_Benchmark_Protocol.md). Execution is isolated on codex/pre-0.7-benchmark; accepted production remains local-v0.6.0 at peeled commit be92b12205d299b6d3bdcc2fd4b2e3a02f928862. The application, presets, package version and accepted release files are unchanged. No ctime/0.7/Phase2 work is authorized.

Six unchanged source copies are SHA256-verified under artifacts/phase1-2026-10-10/inputs. Pilot selector traces preserve absolute nativePTS and match unseeked source hashes/order. CD-B and ACC-A contain719frames; Desktop-B and SF-A contain720. All20 pilot cases plus6warm-ups pass, with protected regular/NEG evidence. Focused harness checks pass24tests; independent calculation/frame/argv review passes. See the [pilot report](Execution%20Summaries/2026-10-10_Phase1_Pilot.md).

Current next step: bounded middle-point/reference coarse A block, then reforecast. The conservative full nominal matrix does not fit12hours, so lower-value breadth and extra finalist capacity remain conditional; all protected pairs, Archive29 coverage, original held-outs and reporting reserves remain. Durable live state is artifacts/phase1-2026-10-10/state.json and active-time.json; read them before trusting this prose. Ahmed's compact blind calibration review is a required later gate before frozen finalists/heldouts. [Continuation](10_Continuation_State.md) records recovery. Resource ceilings remain12active hours/55GiB/20GiB free/340encodes.

Benchmark timing correction, October10: the first coarse preflight stopped before encoding because OBS was using the GPU encoder. Earlier CPUpilot telemetry proves it was also active during the initial pilot. Pixel/content/size/metric evidence remains valid; initial speed comparisons are provisional and flagged invalid in campaign data. Ahmed stopped OBS; live idle queries and quiet preflight now show encoder0/decoder0. Continue the bounded block with fresh quiet retiming where required, preserving original results. See the correction in the pilot report; no production work is reopened.

The expanded focused checks now pass26/26, including real native-observer cleanup on persistence failure and parent death. Unknown timing is quality-only evidence; only timingValidity=true supports speed comparisons. New monitoring records foreign encoder PIDs without stopping them.

## Accepted application state — September 24, 2026

**The amended local 0.6 Goal is accepted through J–M.** Independent final M review found no unresolved approved blocker, and parent documentation synchronization is complete. The commit containing this disposition is the recoverable local-v0.6.0 checkpoint. J/K/L remain accepted. Production source is checkpoint 7b41c0f on codex/archive-workflow; subsequent closure work changes documentation only.

## Product and field-QA outcome

- Repeated completed-file inspection reuses validated local evidence; the accepted 60-file J result was 90.813s cold, 0.460s warm and 1.140s after restart, with 60 hits and no warm/restart ffprobe. That cold campaign was not repeated for M.
- Same-folder output on verified local fixed NTFS retains no-overwrite publication, source reservation, provenance and conservative cleanup. Generated outputs stay excluded until explicitly authorized for this preparation; Treat as original remains separate for ambiguous legacy files.
- Remembered folders/per-profile settings, compact preview, visible expert controls, keyboard/hover help and main-owned resolved argv are implemented. Stored strings are revalidated, never reused as authority.
- Samsung MP4 track timestamps survive as exact SOURCE_CREATION_TIME tags on corresponding Matroska tracks, with visible notices. Conflicts and other preservation failures still fail. Preservation policy2 refreshes older cache evidence once.
- Source-change errors identify fields/checkpoints and preserve local diagnostic snapshots. Retained historic OBS snapshots differ only in ctime, but the old failure-time snapshot is absent. Strict identity remains: unchanged sparse samples cannot rule out edits elsewhere. This issue is honestly narrowed, not proven retrospectively harmless.
- Archive Quality now suggests editable **CQ29**, retaining P7/UHQ/fullres/VBR-CQ/bf4/B-ref each. Decision17 supersedes only the preferred CQ in historical Decision15. Ordinary Tested Defaults and already saved manual CQ32 values are unchanged. The 35-case campaign supports better texture on tested scenes, not x265 equivalence or a universal size ratio.

## Verified artifact and evidence

Fresh ZIP: out/portable-2026-09-23T21-19-15-055Z-196Mpn/zip/FFmpeg-Encoder-0.6.0-win32-x64.zip; **321,231,543 bytes**, SHA256 **3b7c72ea3252dd9c3fff2d83227e3b5b04badf642b748c606063e339ead6f5bb**. Pinned Electron44.2.0 and FFmpeg/ffprobe9.0.1. Extract every file into a new writable folder and run FFmpeg Encoder.exe.

281 direct checks, affected native phone/identity/re-encoding/Archive endpoints and the actual extracted runtime pass. The packaged run has 20 cases, four process sessions, 25 protected files, no errors/cleanup errors and no remaining owned process. It covers restricted PATH, alternate working directory, verified process/session network restrictions, cache/prefs/provenance persistence, same-folder workflows, real CPU/Blackwell encodes, skip/cancel/restart and shutdown. See [M report](Execution%20Summaries/2026-09-24_Portable_0.6_Acceptance.md) and its [hash record](Execution%20Summaries/2026-09-24_Portable_0.6_Evidence.json).

## Recoverable baseline and boundaries

local-v0.5.0 remains f3efdeb47531106a740efb55299c5251b9a7a505. Its original ZIP out/FFmpeg-Encoder-0.5.0-win32-x64.zip remains 321,189,914 bytes, SHA256 a984e102f1cf404239690e709f585d33028f851bc3e66d914e41f43d334a517f, rechecked September24. Original C:\Users\Ahmed\Desktop\ffmpeg-ui and verified D: backup remain preserved. Use a separate extraction/data folder for rollback; 0.5 cannot recognize 0.6 provenance and must not process mixed original/generated collections.

Same-machine portability is verified; independent clean-machine and Ada hardware acceptance are not. Phone2 null-mux decode exits0 with four retained non-monotonic DTS warnings; no warning-free claim is made. CQ29 is an engineering starting point, not Ahmed's subjective continuous-motion approval. No public/GitHub release, global changes, credits, storage repairs or unrelated scope was performed. New product work still needs Ahmed's direction.

Read [Continuation State](10_Continuation_State.md) for terminal anchors and the completion control sequence. The dated execution reports and cumulative Session Summary preserve recovery history; do not restart accepted J/K/L or completed field research.
