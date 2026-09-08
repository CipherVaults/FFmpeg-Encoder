# Changelog

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
