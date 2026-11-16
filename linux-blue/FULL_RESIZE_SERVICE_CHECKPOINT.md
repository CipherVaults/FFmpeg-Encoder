# E3: genuine Full-file precision-FLAC resizing

## Result and boundary

The separate Full-file family passed direct calibration and a genuine eight-case
service campaign. It preserves the complete video and audio timeline, including
longer audio tails, for owned 1920x1080/30 SDR H264/PCM QuickTime signals downscaled
to 1280x720 H265 CPU slow CRF25 with precision FLAC. A Full request remains
`range: null`; it is not rewritten as a zero-to-end trim.

Existing range, copied-audio Full, UI/Gauge and baseline runtime paths remain
unchanged. HDR, arbitrary real-media orientation, perceptual/pixel quality, other
resolutions, composed application, native and package acceptance are not established.

Shared Full implementation checkpoint: local `a76f9b86510ab4e4ee6f6139bde6f16659abb93e`.
Its eligible resource-budget pair reached remote `7392aa93b33fa13272a44ea2829cb69bfd91c360`.
The other four shared Full files overlap the unresolved shared-source publication
scope and remain local. The separately submitted exact 35-file payload is frozen
at `23144377`; its interrupted connector call returned no approval or tree result.
No commit or branch update followed that call, and it has not been retried.

## Implementation

- Separate family `cfr-sdr-full-resize-flac-v1` and resource policy
  `cfr1080p30-full-to720p-flac-resources-v1`.
- Genuine source/plan/runtime/caller-bound selection and resources remain required.
- Workload uses the maximum observed video, audio and container extent. The Full
  resource API accepts no selected interval. Pixel-aware scheduling, bounded
  streaming/telemetry/storage capacities and explicit overflow refusals remain.
- Admission retains fixed clocks, zero origins, continuous stereo PCM16/48 kHz,
  square-pixel 16:9 BT709 limited source geometry and CPU settings. The existing
  source-bound interpretation of absent orientation is for owned test signals,
  not arbitrary real media.
- Complete-source verification binds each observed stream end independently;
  audio need not end with video. No trim, seek or timestamp rebase is added.
- Existing builder, contract, service and telemetry implementation needed no edits.
- Full uses its own fixed calibration receipt; range receipts cannot authorize it.
  The explicit pending-factory regression remains tested after legitimate pinning.

## Direct calibration, including the preserved failure

The first bounded campaign, `full-resize-calibration-xycJXa`, failed after its long
Full case passed. All 16 children closed, maximum one and zero live. Before the
43.217-second held-out source could spawn, a fractional fixture scheduling estimate
was correctly refused as `LINUX_AV1_OPERATION_OPTIONS`. That receipt remains failed.
The harness now rounds the fixture-only estimate upward to 321,715 ms, with a
regression for fractional, ordinary integer and invalid deadlines. Runtime guards
and operation budgets were not relaxed. Minor family wording was corrected to
include Full without changing admission.

Fresh `full-resize-calibration-KKDQwg/report.json` passed both cases. Exact SHA256:
`197c1fc42a4108a9e5b2e4997588a828acd7c4c2aa8a7fe23772376e1535e871`.
All 32 children closed, maximum one, zero live. Its 167-test focused aggregate
passed. Independent review verified both source media hashes and all nine frozen
source/test files by SHA256 and Git blob before the receipt was pinned.

- 150-second Full: 4,500 frames and 7,200,000 samples, exact 28,800,000 PCM bytes.
- Independent 43.1-second video / 43.217-second audio: 1,293 frames and 2,074,416
  samples, exact 8,297,664 PCM bytes. The longer audio tail was preserved.
- Both disclosed source timestamps with null requested/resolved intervals. Long
  output audio ended at 150,000,333 us within frozen tolerance, not exact timestamp
  identity. Timing tolerance was computed before encoding.

Wall time was 553.699 seconds; waited-child high-water was 519,900 KiB. This is
kernel-reported child high-water, not simultaneous process memory or a product
performance guarantee. Direct calibration alone did not establish service lifecycle.

## Actual service settlement

`full-resize-service-pgkknH/report.json` passed all eight cases. Exact SHA256:
`77e03609a3806ce1f3d7d8041791ae82f07043f3c9dcd0b5ebe854742da49a9b`.
The final focused aggregate passed **199/199**, no failures or skips. Independent
review verified the terminal receipt and all **15 frozen source/test files** by
SHA256 and Git blob. No failure or closureFailure was recorded; appActivated is false.

- Full long input: 4,500 frames / 7,200,000 samples.
- Calibrated audio-tail input under a different name: 1,293 / 2,074,416.
- Fresh independent 10-second video / 10.117-second audio: 300 / 485,616.
- Live encode cancellation at frame 7, progress not ended: no accepted publication.
- Fresh success after encode cancellation: 300 / 485,616.
- Live complete-source evidence cancellation after 350 observed bytes: stage
  retained as unverified, validationCurrent false, no accepted publication.
- Fresh success after evidence cancellation: 300 / 485,616.
- Existing-output collision skipped without changing the owned sentinel.

Every successful case verified exact complete PCM identity, source and selected
frame/sample extents, unchanged source identity, output codec/geometry/SAR/DAR,
markers and full decode, genuine current branded selection, correlated evidence,
source-derived reservation forecasts, telemetry and storage settlement. All Full
outputs disclosed source timestamps and null requested/resolved intervals.
All five successful evidence-stage accounting snapshots completed without failure
and stayed within child, streamed-byte, pipe and time limits; persisted storage
records had no violations. The 32 MiB storage minimum may exceed the derived
reservation forecast. These snapshots are not independently recomputed final
whole-job totals, and successful under-budget cases are not exhaustive overflow
refusal proof. Existing deterministic guards cover narrower refusal claims.

Child census: **135 spawned / 135 closed**, maximum one, zero live, seven encodes.
Wall time: 680.194 seconds; waited-child high-water: 515,480 KiB with the same
non-additive memory caveat. No native launch or renderer action was part of this run.

## Publication, recovery and next step

This checkpoint's eligible Linux source/tests are separate from the unresolved
35-file payload. Generated media, binaries and raw receipts stay outside Git;
CURRENT_STATE and the restricted shared files are not part of its publication.
A source-only checkpoint does not establish a complete backup or runnable fresh
clone: exact local observer/selector/evidence dependencies, receipt artifacts and
runtime files remain required. Fail closed when those dependencies are absent.

At the stable recovery gate, obtain the actual GitHub branch independently and
build/test only what it contains. Trace missing dependencies against immutable
local commits. Do not silently borrow local bytes, call an API snapshot a Git
clone, reconstruct restricted content as a workaround, or infer merge authority.
See the [shared-platform plan](SHARED_WINDOWS_LINUX_DEVELOPMENT_PLAN.md) and its
E0/E7/E8 links for source closure and the later Windows handoff.

The independently accepted Full service receipt is now bound into the main-only
qualified-controls builder. Next prove the actual composed service including
ordinary three-codec, changed and mixed batches before switching the explicit AV1
main route. The default runtime, original UI/Gauge and Windows checkout remain unchanged.
Earlier baseline native proof remains valid for that earlier composition. The newer
runtime's local-socket native launch failure is a separate unresolved limitation;
no sandbox or singleton bypass is permitted.
