# Changelog

This project continues its historical development sequence. Versions 0.1–0.4 below are historical milestone labels, not newly verified releases. The old `package.json` value `1.0.0` was npm scaffold metadata and does not establish a prior 1.0 release. The first genuinely accepted standalone release may become 1.0.0 later.

## 0.5.x re-entry — in progress

The manifest now uses development version `0.5.0-dev.1`; the local acceptance milestone is `0.5.0`. Neither is marked released by this documentation checkpoint.

### Preserved

- Full original project backed up and copied to the D: workspace with every file SHA-256 verified.
- Unchanged application source checkpointed as `c30d335`, tag `baseline-2026-09-06`.
- Historical documentation archived without rewriting its original wording; new current-state and execution records distinguish verified implementation from plans.

### Approved, pending implementation and verification

- Independently checkpointed Electron and matching FFmpeg/ffprobe upgrades.
- Isolated renderer, narrow preload API, validated IPC, main-owned queue/lifecycle, and custom local application protocol hardening.
- Validated CPU/NVIDIA SDR profiles, stream preservation, protected outputs, structured telemetry, batch preview/results, and responsive UI separation.
- Portable Windows ZIP, controlled real encodes, security/lifecycle regression tests, and synchronized documentation.

## 0.4 — Real Telemetry Integration (historical)

Introduced parsing of FFmpeg stderr for FPS, speed, output size, and encoded time; a total runtime timer; buffered/throttled UI updates. These historical features require renewed correctness testing during re-entry.

## 0.3 — Encoding Pipeline Implementation (historical)

Introduced directory scanning, extension filtering, alphabetical sequential batches, generated output filenames, and FFmpeg child-process invocation through Electron IPC.

## 0.2 — Encoding Monitor UI (historical)

Introduced the monitor view, file counters, progress/telemetry display, cancellation button, runtime display, and completion summary UI.

## 0.1 — Initial Application Framework (historical)

Introduced Electron main/renderer structure, folder selection, settings UI, and the initial IPC interface.

The complete original changelog is preserved in [the legacy archive](0-%20Documentation/Archive/Legacy%20March%202026/6-%20Changelog.md). Its original informal wording and proposed future features remain historical context.
