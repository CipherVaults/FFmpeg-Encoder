# Approved amended execution plan: local 0.5.0

This is the durable implementation and acceptance record for the plan reviewed by Ahmed and Jerry/Mother Thread on September 6, 2026. It consolidates the accepted decisions and all eight amendments. Checkboxes are acceptance gates, not estimates; mark them complete only with relevant live evidence and an execution-report link.

## Objective and authorization

Complete the long-paused FFmpeg application as a locally verified Windows CPU/NVIDIA SDR encoder, with a portable ZIP, recoverable Git history, explanatory code, and synchronized project documentation. Preserve the original Desktop project before editing the verified D: working copy. Investigate and correct routine local failures autonomously through the milestones.

Separate approval remains required for GitHub creation/upload, public release, machine-global changes, credentials, destructive Git history operations, unrelated filesystem changes, and major product/architecture direction changes. Diagnose evidence that challenges an implementation choice before escalating; ordinary engineering adjustments remain authorized. Local progress continues while an external-publication gate is pending.

## Eight accepted amendments

1. Keep the canonical PBS external. Use project-specific AGENTS and short provenance/context; copy an individual canonical document only for a concrete justified need.
2. Treat old npm `1.0.0` as scaffold metadata. Continue historical 0.1–0.4 through 0.5.x, starting development at `0.5.0-dev.1`; reserve 1.0.0 for the first genuinely accepted standalone release.
3. Establish the old-runtime baseline first. Independently checkpoint and test Electron, FFmpeg/ffprobe, and the architecture refactor so regressions can be attributed and reverted separately.
4. Do not introduce background/headless encoding accidentally. On active encode close, offer “Cancel encoding and exit” or “Keep application open.” Background work/window restoration remains future scope.
5. Keep a custom local application protocol as a hardening target, after preload/context isolation/validated IPC is proven. It must not delay validation of the main-owned process architecture.
6. CRF/CQ/preset values are provisional until exact shipped encoder help and short real encodes validate combinations. Do not equate quality numbers across encoders.
7. Define HDR precisely, document and test the criteria, and never equate ten-bit video alone with HDR.
8. Use dated per-milestone Execution Summary reports with a short index. Keep Session Summary cumulative. Favor clear long-term re-entry over forcing every historical report into routine runtime context.

## Milestones and checkpoints

| Milestone | Work and evidence required |
|---|---|
| A — Preserve | Full backup under `D:\Codex Projects\FFmpeg Encoder - Backups\<timestamp>\ffmpeg-ui`; compare every source/backup/working-copy file by SHA-256. Work only in `D:\Codex Projects\FFmpeg Encoder`. |
| B — Baseline | Create unchanged-source Git commit/tag, run old-runtime native successful flow and defect characterization, preserve exact source/runtime identity and test limits. Tag `baseline-2026-09-06`. |
| C — Context/version | Add local AGENTS/active docs, versioned exact historical-doc archive, migration/provenance, cumulative Session Summary, execution index/reports; move manifest sequence to `0.5.0-dev.1`. |
| D — Electron | Upgrade Electron independently using primary-source release/provenance checks; retain old FFmpeg and source architecture, repeat relevant baseline checks, checkpoint. |
| E — FFmpeg/ffprobe | Install matching project-local pair with source/version/hash/license record; keep architecture unchanged, repeat relevant behavior, inspect encoder capabilities, checkpoint. |
| F — Architecture | Prove named preload API, isolation/sandboxing, validated IPC, main-owned paths/plans/queue/lifecycle/progress/output protection using a restricted local entry point; test security/cancel/restart races, checkpoint. |
| G — Protocol | Add allowlisted `app://` local assets, CSP, navigation/permission controls and traversal tests independently; checkpoint. |
| H — Complete product | Validate six encoder profiles and preservation/color policies with real media; connect actual settings; preview, skips/collisions, telemetry, results/new batch, responsive HTML/CSS/JS separation; checkpoint meaningful completed slices. |
| I — Local 0.5.0 | Build/extract/offline-test portable Windows ZIP, finish requirement audit and docs, record artifact hash/limits, commit clean accepted 0.5.0 milestone. |

Source baseline is `c30d335a62f6296d0c61ef25ad5fba10eb3c8438` on `codex/reentry-completion`. Use meaningful commits per boundary and corrective commits/reverts. Do not merge unrelated runtime/refactor changes merely to save a checkpoint. Git ignores dependencies, binaries, backup folders, generated media, raw chat exports, and artifacts; track provisioning manifests and useful small verification evidence.

Initial toolchain candidates are Electron 44.2.0, matching FFmpeg/ffprobe 9.0.1, Forge 7.11.2, and Playwright 1.63.0; validate exact availability and suitability at their milestones and record justified implementation adjustments. Do not make machine-global changes just to satisfy those version candidates.

## Product and interface contracts

- CPU encoders: libx264, libx265, libsvtav1. NVIDIA encoders: h264_nvenc, hevc_nvenc, av1_nvenc. Use capability probes and real short encodes; disable unavailable combinations with an explanation and no silent fallback. Default candidates are recorded in Technical Reference and remain provisional until validated.
- Top-level regular `.mp4/.mkv/.mov/.avi/.webm` inputs, deterministic alphabetical queue, distinct canonical input/output folders. No implicit recursive scan.
- Encoder-based output names such as `clip_H265-CPU.mkv` and `clip_H265-Nvidia-GPU.mkv`. Skip an existing destination, never overwrite or auto-number it. Preview effective settings and conflicts; selection resolves colliding input stems. Different quality variants require another output folder under this naming policy.
- Main issues selection/plan/job IDs and owns all filesystem work and commands. Named preload methods cover capabilities, folder selection, prepare batch, start prepared plan, cancel batch, get snapshot, and update subscriptions with unsubscribe. Validate sender/frame and payload; expose no arbitrary IPC, paths, executable choice, or argv construction.
- Encode the chosen non-attached primary video stream, explicitly preserve all supported audio/subtitle streams, attachments, chapters, metadata, and dispositions. Preserve supported resolution/cadence/color/bit depth. Unsupported preservation cases report a clear failure; no silent loss or transcode of extra content.
- SDR classification uses explicit transfer and structured HDR metadata plus bounded frame sampling. PQ/HLG/Dolby Vision/dynamic HDR are unsupported detected HDR. Incomplete, contradictory, or unsupported evidence is ambiguous/unsupported, with its own reason. Ten-bit/HEVC Main 10/BT.2020 alone are not HDR. Exact allowlist/sampling/limitations are in Technical Reference.
- Run one encode at a time through fixed binaries and shell-free argument arrays. Restrict local input protocol behavior. Keep child ownership until close, block restart until cleanup completes, and guard against stale callbacks.
- File-specific failures continue to the next eligible file; shared failures stop the remaining queue. Cancel prevents another queued file and terminates only owned processes. Closing or losing the renderer does not leave invisible encoding running.
- Use owned temporary output, successful exit plus ffprobe validation, and no-overwrite final publication. Prefer exclusive linking with exclusive-copy fallback where needed. Cleanup never touches an input, existing output, or completed result.
- Parse buffered `-progress pipe:1` records in main. Show meaningful percentage/ETA where duration is known and indeterminate progress otherwise. Final success requires process exit/output validation/publication, not a progress number.
- Preserve the recognizable setup → preview → monitor → results workflow, separate CSS/HTML/renderer responsibilities, support 720p through 4K/DPI scenarios, and allow subsequent batches after lifecycle settlement. Results distinguish success/failure/skipped/cancelled/unprocessed.

## Acceptance audit

- [x] Original preserved; all 974 files and 690,310,811 bytes matched source → backup → working copy by SHA-256 at the preservation checkpoint.
- [x] Unchanged-source baseline commit/tag exists and is recoverable.
- [x] Real legacy Electron 41.0.2 successful flow completed two controlled H.265 CPU encodes and full output decode; native OS picker was substituted and remains outside that evidence.
- [x] Twelve legacy characterization cases passed: seven known defects and five positive behaviors. TAP is preserved at `artifacts/legacy-baseline/1788732750752/unit-results.txt`; harness checkpoint 7b7b5c8. A passing defect characterization proves the defect is present, not fixed.
- [x] Active project docs, exact historical archive, manifest version, and local Git checkpoint synchronized through 14c874f/53ce087 and the parent runtime synchronization pass.
- [x] Independent Electron 44.2.0 upgrade and native baseline regression evidence checkpointed at `0dd8542`, with original FFmpeg retained; see Runtime Upgrades execution report.
- [x] Independent matching FFmpeg/ffprobe upgrade, exact provenance/hashes/notices, and regression evidence checkpointed at 9c25694; runtime execution report records evidence and limits.
- [ ] Narrow API, sender/payload validation, renderer isolation/sandbox, and main-owned architecture are implemented and tested.
- [ ] Custom local protocol, CSP, navigation/permission restrictions, asset allowlist, and traversal tests pass after architecture validation.
- [ ] All six profile capabilities and actual supported combinations are tested by short real encodes; adopted defaults and hardware limitations are documented.
- [ ] Multiple-track, attachment, chapter, metadata/disposition, video-selection, and unsupported-case tests prove the preservation policy.
- [ ] SDR/HDR classifier tests cover eight/ten-bit SDR, BT.2020 SDR, PQ, HLG, Dolby Vision, HDR10+, static-only/conflicting/missing metadata, attached pictures, and bounded-probe errors/sampling limits.
- [ ] Existing output hashes remain unchanged, duplicate stems are resolved, publication races do not overwrite, and only owned incomplete files are cleaned.
- [ ] Cancel/restart/close/lost-renderer/spawn-error/stale-callback cases prove no queued restart or orphan child; file-specific/shared errors produce correct counts and recovery.
- [ ] Structured telemetry handles chunk splits and unknown duration; preview/monitor effective settings match commands; new-batch flow works after terminal outcomes.
- [ ] Real UI interaction and responsive layouts cover supported window/DPI scenarios, long filenames, and readable error/disabled-profile reasons.
- [ ] Portable Windows ZIP built, hashed, extracted, and tested offline without global Node/FFmpeg dependencies; real encode/cancel/skip paths and resources/notices verified.
- [ ] Final docs match implementation, execution reports link code/evidence, limitations and future work are explicit, and the local 0.5.0 branch is committed and clean.

Final acceptance must inspect each requirement against current code, relevant tests, and the packaged artifact. An unchecked or weakly evidenced item stays incomplete. Do not use a mock, generated report, successful launch, or unit-test count as proof of a broader requirement it does not exercise.

## GitHub and later release

The intended repository is private, with proposed name `FFmpeg-Encoder-Desktop-App`. Confirm the exact account/name and review the concrete upload inventory before creation or upload. Preserve local progress independently. Public release, signing/distribution changes, credentials, and the future 1.0.0 acceptance remain separate decisions. Preparing a portable local ZIP is already authorized.
