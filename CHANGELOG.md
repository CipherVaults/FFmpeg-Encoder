# Changelog

## 0.6.0-beta.1 — public Beta prerelease, November 20, 2026

- The accepted 0.6 encoding logic, defaults, output checks and Archive CQ29 helper are unchanged, with one engine-compatibility addition: FFmpeg 9.1 newly drops 20 source metadata keys when a stream is re-encoded (encoder tags, Matroska track statistics, iTunes gapless/loudness tags, MP4 brands), which made the unchanged preservation check refuse every MP4 source. Each encode now passes `-keep_metadata` for exactly those keys, so outputs keep the same metadata as with 9.0.
- Replaced the bundled Gyan 9.0.1 engine with FFmpeg 9.1 and FFprobe built from the signed upstream release and unmodified x264, x265 (8-bit + linked 10-bit), SVT-AV1, dav1d, zlib and NVIDIA codec headers (SDK 13, driver 570+). Network protocols are disabled in this engine. Build scripts: `release-kit/beta-0.6/ffmpeg-build`; complete corresponding source is a release download. `scripts/provision-ffmpeg.ps1` still describes the old Gyan download and does not provision this engine.
- Added the Gauge application icon (`assets/gauge`) through `packaging.config.cjs` and a per-user Windows installer (`release-kit/beta-0.6/packaging`).
- Tested in a clean, offline Windows Sandbox profile: engine codec checks, unit tests, portable ZIP and Setup install, launch, CPU encode, no-overwrite, reopen and uninstall. NVENC on hardware, real folder dialogs and SmartScreen were not tested.

## 0.6 field QA — September 23, 2026 (unreleased)

- Preserve exact MP4 stream timestamps as SOURCE_CREATION_TIME on the corresponding Matroska tracks. Preview explains the representation; conflicting aliases and other preservation failures remain errors. Inspection preservation policy2 invalidates older policy cache evidence.
- Source-identity refusals identify differing fields and retain exact comparison snapshots in local logs. Strict checks remain because matching sparse samples cannot establish unchanged full content.
-280 direct checks and native phone/identity regressions pass. Archive CQ field convergence and fresh portable M acceptance remain open; the original candidate is not the final release.

## Amended0.6 L — September20,2026

- Added validated local folder/per-profile preference restoration, independent resets, compact preview/filter/selection and keyboard-accessible canonical preset/default explanations.
- Added explicit temporary generated-output re-encoding, trustworthy available/unknown previous-generation descriptions and actual main-owned prepared/executed argv display. Existing K protections remain.
- Added separate capability-gated HEVC Archive Quality helper: P7/UHQ/fullres/VBR-CQ32/bf4/B-ref each, visible editable controls and additional options. All six Tested Defaults stay unchanged. CQ32 follows bounded Blackwell benchmark convergence; results vary by scene and do not prove equivalence or local Ada quality.
-269 direct checks and original/amended/Archive native flows pass; M portable0.6 acceptance remains pending. See the L execution report and decision15 for exact evidence and limits.


## 0.6.0-dev.1 — Archive workflow development

- Implemented J: persistent bounded inspection evidence, conservative identity/runtime/policy invalidation, optional fixed-NTFS eligibility helper, two bounded inspection workers and transparent preparation progress. Encoding stays sequential and expert controls remain visible.
- Development data uses data-next-0.6. The accepted local-v0.5.0 tag and ZIP remain recoverable. J is accepted with153 tests and independent native/evidence review in its dated report; K same-folder safety is accepted with reserved output provenance, intent/recovery, protected snapshots, explicit legacy overrides and sealed atomic publication.209 tests and native endpoint checks pass. Unbound partial outputs are retained safely; parser normalization2 invalidates older cache evidence. This earlier J/K entry is historical; amended L is now accepted by the September20 report. M portable acceptance remains pending.

This project continues its historical development sequence. Versions 0.1–0.4 below are historical milestone labels, not newly verified releases. The old `package.json` value `1.0.0` was npm scaffold metadata and does not establish a prior 1.0 release. The first genuinely accepted standalone release may become 1.0.0 later.

## 0.5.0 — Local portable acceptance, September 8, 2026

The manifest is `0.5.0`, accepted as the approved local Windows x64 milestone. The package is unsigned; public release and clean-machine compatibility remain separate work.

### Preserved

- Full original project backed up and copied to the D: workspace with every file SHA-256 verified.
- Unchanged application source checkpointed as `c30d335`, tag `baseline-2026-09-06`.
- Historical documentation archived without rewriting its original wording; new current-state and execution records distinguish verified implementation from plans.

### Implemented and verified

- Independently checkpointed Electron and matching FFmpeg/ffprobe upgrades.
- Isolated renderer, narrow preload API, validated IPC, main-owned queue/lifecycle, and custom local application protocol hardening.
- Main-owned output protection and structured telemetry, with real lifecycle/cancellation and security regression evidence.

- Six CPU/NVIDIA profiles with real 8/10-bit application outputs, preservation/color/mixed-batch evidence, actual settings/argv verification and 25 layout checks. Native Windows folder selection verified.
- Exact runtime evidence corrected AV1 CPU to CRF1–63/presets0–9 and restricted advertised depths to 8/10. Defaults adopted without claiming cross-encoder quality equivalence.

### Portable milestone I

- Added a pinned direct Packager build, exact application/resource/notice inventories, fresh portable ZIP and hash reports. Removed the unsuitable Forge candidate and its vulnerable dependency chain.
- Configure application and session data before Electron readiness so portable GPU/network/renderer processes use adjacent data.
- Verified the extracted 0.5.0 executable under a Unicode/spaced path, alternate working directory, restricted PATH and confirmed proxy transport denial; real encode, skip, cancel, subsequent batch, output protection and shutdown pass.
- Final 89/89 contract checks, independent acceptance review, synchronized project documentation and local-v0.5.0 checkpoint. See the Portable Acceptance report for exact artifact hashes and limits.

## 0.4 — Real Telemetry Integration (historical)

Introduced parsing of FFmpeg stderr for FPS, speed, output size, and encoded time; a total runtime timer; buffered/throttled UI updates. These historical features require renewed correctness testing during re-entry.

## 0.3 — Encoding Pipeline Implementation (historical)

Introduced directory scanning, extension filtering, alphabetical sequential batches, generated output filenames, and FFmpeg child-process invocation through Electron IPC.

## 0.2 — Encoding Monitor UI (historical)

Introduced the monitor view, file counters, progress/telemetry display, cancellation button, runtime display, and completion summary UI.

## 0.1 — Initial Application Framework (historical)

Introduced Electron main/renderer structure, folder selection, settings UI, and the initial IPC interface.

The complete original changelog is preserved in [the legacy archive](0-%20Documentation/Archive/Legacy%20March%202026/6-%20Changelog.md). Its original informal wording and proposed future features remain historical context.

## Archive field follow-up — September24,2026 (unreleased)

- Archive helper startingCQ changes32→29 after bounded35-case field comparison; compound options and ordinary defaults unchanged. Prior savedCQ32 and descriptive provenance remainvalid. Decision17 transparently supersedes thehistorical preferredCQ.281direct checks and current amended/Archive nativeendpoints pass; freshM pending.
