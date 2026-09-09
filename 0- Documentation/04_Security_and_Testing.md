# Security and testing

This document defines the approved properties and acceptance evidence. Milestones F/G implement and verify the process/renderer/protocol boundaries. H closes product requirements through 89 automated checks, 110 accepted option cases, real application encodes/preservation/native folder selection and 25 layout scenarios; its Product Acceptance report maps each requirement to evidence and limits. A requirement in this file is not automatically a passing test result; link actual outcomes from the execution index.

## Trust boundaries

Local media filenames and media metadata are untrusted input. The renderer has less authority than main even though the UI is local. Main validates both the requesting frame and each payload; preload offers only named application methods. Paths, encoder parameters, plan identities, and process state remain under main control. Native folder selection is the authority for folder access, not an arbitrary string sent by the renderer.

Remove renderer Node integration, enable context isolation and sandboxing, prevent unexpected navigation/popups/permission access, constrain the loaded content, and avoid remote content. The custom app protocol was verified as separate milestone G after basic IPC/process architecture checkpoint b7d56df. Native evidence is `artifacts/protocol-smoke-1788789338099/report.json`; the full 89-test suite and app flow also pass. Its allowlist must prevent arbitrary file reads, encoded traversal, and unexpected resource schemes. Use a CSP appropriate to the actual local assets.

Fixed executables and shell-free argv prevent renderer-controlled command construction. Validate paths and local input protocol behavior before invoking FFmpeg/ffprobe. Bound probe output/time and telemetry buffers so malformed input cannot grow unbounded memory. Do not expose raw arbitrary process execution as an API. Dependencies and binaries need version, source URL, hash, and license provenance. Security claims must match actual verification.

## Required tests

| Area | Scenarios and authoritative evidence |
|---|---|
| Baseline | Launch unchanged original-runtime working copy, exercise folder/settings/encode/telemetry/cancel paths with controlled media, document known defects. Preserve original files and hash evidence. |
| Runtime attribution | Repeat relevant baseline checks after Electron alone, then after FFmpeg/ffprobe alone. Record exact binary versions and independent commits. |
| Pure contracts | Validate profile ranges and types; reject malformed settings/IDs; deterministic scanning; same-folder and duplicate destination policy; HDR classification; chunk-split progress; result counts. |
| IPC and renderer | Reject unexpected sender/frame, forged payloads, arbitrary paths/argv, stale plans, and repeated starts. Confirm no renderer Node/require access and only the narrow preload API is exposed. |
| Local protocol | Test allowed assets and denied traversal/encoded traversal, external navigation, popups, unexpected schemes, permission requests, and CSP violations. |
| Real media | Generate controlled short fixtures and encode all six profiles when their hardware capability checks pass. Probe output codec, duration, dimensions, frame/cadence expectations, and relevant pixel/color details. |
| Preservation | Multiple audio/subtitle tracks, language/title metadata, dispositions, chapters, attachments, video selection, and unsupported-container cases. Assert output contents, not merely exit code. |
| HDR/SDR | Eight-bit SDR, ten-bit SDR, BT.2020 SDR, PQ, HLG, Dolby Vision, HDR10+ packet/frame signals, static-only HDR metadata, conflicting metadata, absent transfer, unknown transfer, late sampled metadata, probe failure/cancellation, and attached-picture exclusion. |
| Output protection | Existing output byte/hash unchanged; file appearing after preview; same-stem conflicts; input equals output directory; failed/cancelled temporary cleanup; exclusive publication; filenames with spaces, Unicode, punctuation; no deletion of completed results. |
| Lifecycle | Cancel during probe/encode/verification/publication where applicable, double cancel, immediate restart attempt, sequential completion, stale close callback, spawn error, nonzero exit, and no next file after cancel. Observe owned child exit and no orphan encoding process. |
| Close behavior | Keep-open retains the active job/window; cancel-and-exit waits for child exit/cleanup. Renderer loss cancels work. No implicit background encoding. |
| Error recovery | A corrupt/file-specific error continues the eligible queue; lost output drive, permissions, storage exhaustion, or broken shared runtime halts appropriately. Results distinguish failure/cancel/skip/unprocessed. A new batch works afterward. |
| UI | Setup/preview/monitor/results remain readable and operable at 720p and 4K/DPI scenarios. No hidden controls, clipped feedback, stale settings, timers, or old telemetry. Long filenames and disabled-profile reasons remain understandable. |
| Portable | Build Windows ZIP, extract to an isolated folder, launch offline with no Node/FFmpeg dependency on PATH, perform a real encode/cancel/output-skip check, and verify bundled binaries/licenses/resources. Record the extracted path and artifact hash. |

## Evidence strategy

Use Node's test runner for meaningful pure contracts and injected process/filesystem failures; use Playwright Electron integration tests for application behavior; use the shipped FFmpeg/ffprobe pair for controlled real encodes and metadata checks. Production defaults require successful real short encodes, not only parser acceptance. Include a modest longer sequential run where appropriate to exercise sustained telemetry and lifecycle state without using irreplaceable user media.

Native picker interaction must be described accurately: a stubbed dialog can verify application response but is not manual/native dialog evidence. Resource exhaustion or drive-loss fault injection can prove code response but is not a claim that a physical drive was removed. Same-machine extraction proves portability only on that machine; record clean-machine verification separately if available. A fixture absent from the suite is not implicitly covered by a nearby unit test.

At each milestone, record command, relevant fixture, result, limit, and code checkpoint in its dated execution report. Preserve useful small assertions/manifests in Git, keeping raw logs, generated media, screenshots, binary bundles, and build products in ignored artifact areas as appropriate. Never announce 0.5.0 complete based only on green unit tests: audit each approved requirement against the actual implementation and portable artifact.

## J inspection reuse boundary

Persistent evidence is a performance input, never renderer/path/plan authority. Reconstruct classification from bounded normalized facts with exact runtime/policy/identity keys; recompute destination, settings and device eligibility. Corruption or optional helper failure falls back to fresh inspection. Do not certify full-byte equality from a sparse digest or certify every frame from bounded sampling. The fixed Windows helper accepts only bounded drive-root data and retains owned-child cancellation.

Relevant J regression groups cover source mutation/replacement and restored timestamps; runtime/policy/schema/corruption/size invalidation; hot/disk LRU bounds and scoped cleanup; incomplete-frame/cancelled-result exclusion; unsupported-storage/helper failure; fresh plan/profile/capability/destination checks; and two-worker ownership, peer abort, restart admission and stale callbacks. The dated J report maps independent review findings and real endpoint evidence. Native junction fixture creation failed with UNKNOWN/-4094 and was stopped: injected link rejection is explicitly narrower evidence. Do not infer hardware/storage diagnoses from that fixture failure or repeat parked diagnostics.

For native performance acceptance retain the measured completed-source allowlist and read-only source identity checks. The original 60-file report contains valid numeric cold/warm/restart evidence plus a failed event/DOM observation assertion. Preserve it; a separate reuse-only UI run must establish correctly associated rendered phase/revision without rerunning expensive cold media. A passing targeted harness supplements that report rather than erasing its failure history.

## Release boundary

Local packaging does not authorize public release. Resolve exact bundled third-party notices and source/provenance requirements locally; review licensing/signing/distribution requirements before any later public upload. GitHub creation/upload requires the separately approved account, repository, and content inventory. Do not expose raw chat exports, personal media, machine logs, or secrets through an upload.

## Local 0.5.0 acceptance

The I Portable Acceptance report links the exact ZIP/build/native reports and compact tracked hash record. All 89 contract checks pass after the early data-path fix. Exact ASAR/resource inventory, isolated extraction, restricted PATH, verified Chromium proxy transport denial, real encodes/decodes, output skips, cancellation, subsequent batch, protected hashes and exact process exit pass. An independent requirement-to-evidence review passed before the parent synchronized current documents and committed local-v0.5.0.

This accepts local Windows x64 operation on the tested machine. It does not establish a clean-machine run, physical network disconnection, public-distribution readiness or broader device support. Existing H/F/G evidence retains its stated native-dialog, media-sampling and hardware limits; completed suites were not repeated without a relevant implementation change.
