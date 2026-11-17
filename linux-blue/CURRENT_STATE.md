# Linux 0.7: current development state

Updated November 17, 2026, after the first actual candidate normal-service proof and independent saved-output audit. Development is active. Read the [full session](SESSION_SUMMARY.md), [service proof report](2026-11-17_Candidate_Normal_Service_Proof.md) and [exact receipts](2026-11-17_Candidate_Normal_Service_Proof_Receipts.json).

## Verified source and new actual result

Tested checkpoint 008 is local `374d327a7e3fa934d046def5b4e18b45285680ed`. Its [Notion checkpoint](https://app.notion.com/p/41bbd7ade63b81f8bfd9e35605405e32) restored all 514 source files and the complete eight-commit bundle; the full 212,471-byte native session was read back unabridged. Original-ancestry GitHub `14be3e1e218d2ea97cef10583b8d166ebd771e96` has sole parent `74a82817b57ad929be56e9137e4e7dda3086097d`; all seven changed files, complete tree and fresh branch were verified: 896 remote files, 889 unchanged, three modified, four new, zero deleted. Source restoration preceded the media run; remote verification finished separately afterward. Original remote and local reconstruction histories intentionally differ.

One real normal-service attempt passed five cases on the exact candidate pair and fixed raw calibration evidence:

- Published a late two-second interval from an owned 150-second source copy: 60 frames and 96,000 selected stereo samples.
- Published a nonaligned interval from a new independent eight-second source: 63 frames and 101,184 samples.
- Preserved an existing output sentinel and skipped collision without a new target encode.
- Cancelled an actually live encode at non-terminal frame-eight progress; no destination published and incomplete stage retained.
- Closed the old runtime/service, opened new instances and published a recovery interval: 15 frames and 24,000 samples. Same-service recovery is not proved.

All 119 children closed, zero live, maximum one. Actual preparation, selection, source/runtime freshness, PCM/telemetry/full-source evidence, storage and no-overwrite publication were exercised, not VM-mocked. Independent review verified the retained 171 artifacts, 271 source records, nine runtime/dependency files and case/resource/storage chronology without another media process. The lead rechecked all 514 tracked files unchanged before releasing documentation edits.

## Important runtime diagnostic limitation

Each of the three successful target encodes retained 499-byte stderr with duplicate codec-option warnings and x265 CPU-mask/no-thread-pool/WPP/lookahead-slice diagnostics. The cancelled target retained 1,086 bytes including interruption-associated demux/PCM errors. All 21 collector children had empty stderr; only the outer launcher log was otherwise empty. The raw census field `encodes=28` counts all `-progress` children, not 28 output encodes. Three outputs were actually published.

Read-only diagnosis explains duplicate options as global copy followed by specific HEVC/FLAC overrides, with deterministic final-match precedence. The pool failure strongly matches this cloud workspace lacking `/sys` CPU topology despite nine available CPUs. Exact x265 4.1 source/child tracing were unavailable and the topology observation is post-run, so a sole cause is not proved. Measured functional contracts passed; native threading/performance remains unqualified. Do not suppress messages, force threading flags, change system mounts or silently rerun media to make the record look clean.

## Preservation and qualification boundaries

This new evidence/documentation step is not yet committed or mirrored at record creation. The [portable full report](evidence-2026-11-17/normal-service-proof-portable.json) preserves all report data except 26 explicit path-prefix substitutions. It is not the original raw report, cannot restore its bytes without excluded mapping and grants no factory/production authority. Original runtime binaries, reports, media/spools and raw logs remain local and outside the source backup. Source-only restoration cannot satisfy the live factory's fixed original calibration/runtime gate.

Latest code checks remain checkpoint 008's 97/97 lead affected and 35/35 independent focused. Broad Linux remains 171 passed and 27 failed of 198; those suites were not rerun for this evidence-only step. Prior actual calibration remains attributed to `54ee143`. Neither result qualifies arbitrary duration, Full/resize/1440p/4K, other audio, native GPU, Windows, GUI or release acceptance. Encoding cancellation does not establish evidence-collection cancellation.

This advances precise range-Encode prerequisites [Q2n], not Remux/container/MP3 [Q2j] or all Q. Preserve original theme/shared architecture and Windows corrections. The old 35-file request remains terminal-unknown, not replayed or rerouted. Earlier archives stay immutable. HDR expansion, defaults, ArchiveCQ29 and benchmark are unchanged; packaging stays last.

## Exact next actions

1. Commit the five reviewed evidence/PBS paths, immediately verify Notion ZIP and full-history restoration, then publish the permitted bounded GitHub delta on expected original ancestry. Keep measured failures and warnings explicit.
2. Carry forward the completed read-only warning diagnosis and native-threading limitation. Reconcile any future runtime/argument change independently; no current repin or suppression is needed.
3. Implement the smallest explicit developer Keep720 workbench integration using the existing shell/theme, no default change or renderer-provided executable paths. Inspect whether supported ranges are accessible without an unsupported Full plan. Preserve close/relaunch after cancellation unless a new-instance lifecycle is separately designed and proved.
4. Check actual Electron/display availability before a bounded native journey. Continue required whole-file/resize/higher-resolution/audio/container work and a separately scoped evidence-collection cancellation check without confusing this narrow proof with product completion. Ahmed retains final acceptance.
