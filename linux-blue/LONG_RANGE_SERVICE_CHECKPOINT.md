# E3: source-derived longer-range FLAC service

## Scope and status

This checkpoint introduces a genuine main-owned source-shape family, not a list
of fixture hashes or three approved requests. It is developer-only and is not
imported by the application, renderer, preload or startup selector. E3 and the
Linux 0.7 finish line remain open.

The calibrated scope is progressive 1280x720 H264 High, 30/1 CFR, square-pixel
BT709 limited-range SDR, QuickTime with one PCM16 stereo 48 kHz audio stream, zero
origins, source clocks 1/15360 video and 1/48000 audio. Output is Keep Source,
H265 CPU slow CRF25, precision FLAC, Matroska with 1/1000 clocks. Other clocks,
resolutions, formats, cadence, orientation, audio layouts and HDR are not
qualified by this work. No GPU or Windows result is inferred.

Local base: `f5a948c8d4732f707ae6e930aa2fc1be08741c9c`.
Preceding verified remote: `87c23c1cda40a751492ecdb3b6a903d660e85cd9`.
The original PC project, original workbench/Gauge, default runtime and prior
qualified receipts remain intact. Earlier native Electron 44.7.0 acceptance of
the baseline FFmpeg 7.1.5 workbench, selection and both Gauge themes remains
valid. The later AV1-capable 9.0.2 native launch is blocked before a window by
the environment's socket restriction, with no sandbox or security bypass.

## Resource implementation

`cfr-sdr-range-flac-v2` and `cfr720p30-flac-resources-v1` use exact checked
BigInt arithmetic to derive per-child time, complete-source frame/PCM capture,
selected telemetry/spool, aggregate pipe/evidence, storage reservation and
whole-job deadlines from observed source extent, chosen range and actual file
size. Coefficients were frozen before media qualification, not fitted to make
a failed output pass. The I/O allowance is an unmeasured scheduling coefficient,
not a throughput or performance promise.

The result is frozen and privately branded. `requireCurrent` binds the genuine
plan, source identity/probe, runtime, settings, caller budget and policy; copied
or changed results cannot grant resource authority. The service consumes these
limits and retains its complete-source decode, timing, telemetry, currentness,
storage observation and no-overwrite publication gates. Legacy families retain
their 120-second/512 MiB source and 0.5–30-second range restrictions. The original
120-second/128 MiB Linux operation runner's limits and behavior are unchanged;
a separately named
fixed-runtime runner accepts positive per-source limits under structural caps.

This is not unlimited execution. Timer, streaming capture, telemetry, retained
storage and child-count capacities fail explicitly instead of silently clamping
or downgrading validation. Storage is bounded point-observation accounting, not
a kernel hard-write quota. Passing one workload does not prove every overflow
refusal or every possible length.

## Pre-catalog evidence

Command: `node linux-blue/workbench-long-range-calibration.cjs`.
Receipt: `long-range-calibration-sD4XVP/report.json`.
SHA256: `dc5af4b1c949e0ac8e6261493f67de5230ec4173d21b73a705287d183add2a33`.

- A 150-second synthetic source, longer than the legacy 120-second ceiling.
- A 100–140-second selection: 1,200 frames and 1,920,000 exact audio samples.
- A 130-second open end: 600 frames and 960,000 exact audio samples.
- Independently generated flipped content with different chirp audio, selected
  at 0.413–8.621 seconds: 246 frames and 393,984 exact audio samples.
- Full-source counts, complete output decode, exact selected PCM hashes,
  frozen clock-derived tolerances and unchanged source identities all passed.
- 42 children spawned/closed, zero live, maximum one. 333.553 seconds wall time.
  Kernel waited-child high-water 358,616 KiB is not a simultaneous process sum
  or a product memory guarantee.

This direct calibration bypasses service selection and does not itself prove
service aggregate admission, storage reservation, cancellation or publication.
Its stages remain retained and unregistered. The service composition pins the
exact successful report and reviewed runtime-observer bytes, rather than using
an older four-second receipt for the new scope.

## Actual service campaign

Command: `node linux-blue/workbench-long-range-smoke.cjs`.
Receipt: `long-range-service-eQZdcB/report.json`.
SHA256: `6d0d49b83ec5bf01a5c5aca977f412e83a8205dd6ad1e43ee558e5a5701e8039`.

All eight cases passed through the genuine shared selector and EncoderService:

- The late 40-second and open-end 20-second outputs published with the same
  exact counts as calibration, from a differently named source copy.
- Fresh vertically flipped content with different audio, absent from the
  calibration report, published a nonaligned 243-frame/389,184-sample output.
  No fixture hash or range list granted its authority.
- Encode cancellation occurred at nonterminal frame 4 from a live child. The
  unbound partial was retained and no destination was published.
- Evidence cancellation occurred after 349 bytes from a live complete-source
  frame decoder. The sealed unverified output/evidence was retained, not
  published or relabeled valid.
- Fresh preparations succeeded after each cancellation settled, each with
  62 frames and 99,552 exact audio samples. Existing output remained unchanged
  without another encode. All original source hashes remained unchanged.
- Exact derived storage forecasts, retained evidence-stage child/byte accounting,
  telemetry limits, complete source/selected counts, PCM identity, generated
  markers and independent output decode passed.
- All 143 children closed, maximum one live, zero remaining, seven encode starts.
  Wall time 605.146 seconds. Kernel waited-child high-water 358,488 KiB is not a
  simultaneous process sum or product memory guarantee.

The fifteen source/test files in the frozen campaign manifest were unchanged at
completion. Environment observation: Linux 6.18.57 x86-64, glibc 2.41,
Node v24.22.1. Evidence-stage diagnostics are not independently recomputed final
whole-job byte totals; these under-budget jobs do not prove exhaustive overflow
refusal at every service limit.

Preserved earlier preflights:

1. `long-range-service-rpt8mJ`: the new output-clock observer incorrectly
   imposed this family's two-stream layout on a video-only capability probe.
   Corrected to check nonempty Matroska stream clocks; actual expected-output
   validation still enforces the job's exact stream layout. 5/5 children closed,
   no encode. Single-video, missing/changed-clock and empty-stream tests cover
   the correction.
2. `long-range-service-ZJhyrI`: the smoke registered two input folders before
   using the first token, which the existing single-current-folder policy
   correctly invalidated. The smoke now registers each case's current input
   and output.29/29 children closed, no encode. Product authority was unchanged.

## Regression and review

184 focused tests passed on the final implementation, zero failed or skipped.
The per-case folder fix also passed all 7 composition/smoke tests.
Coverage includes resource arithmetic and capacity refusals, forged/stale
selection, complete-source extent drift, legacy scope, storage failure and
cancellation, genuine telemetry, runtime runner limits and precise clock guards.
The final aggregate log is retained with the campaign evidence.

Independent reviews found no material arithmetic or false-acceptance defect and
reviewed the separate calibration versus service acceptance boundary. Final
independent review verified the report hash, all eight cases, all fifteen frozen
source/test hashes and the 184/184 test log, and approved the eligible source-only
checkpoint without granting application or release acceptance.

## GitHub and recovery boundary

GitHub is a partial source checkpoint, not a runnable fresh-clone release or
complete backup. The earlier 31 source/test/script/UI parity gaps remain. This
work also changes shared family/collector/service files and corresponding tests;
paths covered by the previous denied publication manifests must remain local.
The five affected existing paths are `src/encoder-service.cjs`,
`src/operation-evidence.cjs`, `src/operation-family.cjs`,
`tests/operation-evidence.test.cjs` and `tests/operation-family.test.cjs`.
No alternate transport, renamed copy, split of denied content or local ancestry
push may be used to evade that restriction. New eligible Linux files can be
reviewed and synchronized separately, with missing dependencies stated plainly.

Recovery requires an authorized resolution for the exact restricted shared
dependencies, byte-parity verification, the exact reviewed observer, a locally
verified fixed runtime pair and a freshly generated or independently verified
retained calibration receipt. Do not remove the observer/receipt guards to make
a remote clone run. Raw receipts, generated media, runtime binaries and private
historical material are excluded from Git.

## Next substantive milestone

Qualify 1080p30→720p range downscaling as a distinct non-overlapping family, using
the existing Lanczos/aspect-fit and strict FLAC path. Add pixel-aware CPU time
allowances while preserving actual file-I/O, PCM and metadata accounting. Test
a 150-second source with late 40-second/open-end ranges and independently
generated nonaligned content before catalog registration and genuine service
proof. Then qualify whole-file FLAC resize separately rather than borrowing the
old copied-AAC family's timing evidence. VFR, portrait/non-square pixels, 1440p/
4K, ordinary real-media breadth, native integration and packaging remain open.
