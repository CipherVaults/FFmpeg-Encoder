# E3: independently qualified 1080p30 to 720p range resizing

## Scope

This continuation adds `cfr-sdr-range-resize-flac-v1`, separate from the existing
720p Keep Source range family. It reuses the original geometry/scale builder,
genuine source-bound selection, full-source streaming evidence and publication
controls. The original Windows project, UI/Gauge, default runtime and existing
qualified paths remain unchanged.

The new scope is 1920x1080 progressive H264 High at 30/1, square-pixel 16:9,
BT709 limited SDR, zero-origin QuickTime with PCM16 stereo 48 kHz, source clocks
1/15360 video and 1/48000 audio. Output is 1280x720 H265 CPU slow CRF25 with
precision FLAC and 1/1000 Matroska clocks. The route is developer-only.

This does not complete Full-file resize, other resolutions, VFR, portrait/SAR,
10-bit, subtitles, ordinary real-media breadth, perceptual pixel quality, native
integration, packaging or Linux 0.7 acceptance. HDR remains deferred. Earlier
baseline native workbench acceptance remains valid; the newer AV1 runtime's
native startup still has its separately recorded socket restriction.

Local base: `31edf715e3ab7c0d79c12e78d5e48aab8b10a0a9`.
Shared implementation commit: `23144377b55357d3b7b8a8afd04ec2e3c8b6c4cc`.
Preceding verified remote: `3c9280f5b85f3e497bca5704dd6e5cbb2408580f`.

## Implementation and reuse

The new `cfr1080p30-to720p-flac-resources-v1` forecast charges complete-source
decoding at 9/4 of the 720p pixel rate, retains the 720p selected encode allowance,
and adds 1080p selected scaling time. File-I/O allowances remain explicit.
PCM, frame-record, telemetry and storage byte forecasts are not multiplied by
pixels because their representations/counts did not change. Checked BigInt
arithmetic and all structural capacity refusals remain intact. Coefficients are
frozen conservative scheduling allowances, not measured throughput.

Distinct source-width/resolution predicates prevent ambiguous overlap with the
Keep Source family. Existing family bounds and resource results remain unchanged.
The existing main-only orientation qualification interprets absent orientation
for these owned unrotated test signals; no rotation tags are fabricated. This
does not establish the intended orientation of arbitrary real-world content.

Calibration and service smoke are reused through two fixed main-owned variants,
not caller-supplied geometry/runtime paths. Old entry points still default to
Keep Source. The service construction helper snapshots an inert configuration,
pins each exact successful report, and retains the fixed runtime, reviewed
observer, clock guards, genuine selector and evidence store. A pending resize
receipt fails before file/runtime/storage work. Neither module is imported by
an application entry or renderer.

## Pre-catalog result

Command: `node linux-blue/workbench-resize-calibration.cjs`.
Receipt: `resize-calibration-RQsj84/report.json`.
SHA256: `dd0637354ea1ca27e57c75958074423aff98f37ab6da00a3459a6dac2b206c32`.

- A 150-second 1080p source downscaled to 720p for 100–140 seconds: 1,200 frames and
  1,920,000 exact selected audio samples.
- Its 130-second open end: 600 frames and 960,000 samples.
- Different-content held-out source at 0.413–8.621 seconds: 246 frames and
  393,984 samples.
- Actual output dimensions, square pixels/DAR, strict frozen timing, complete
  source/output decode, exact selected PCM hashes and unchanged sources passed.
- All 42 children closed, maximum one, zero live. 342.540 seconds wall time;
  kernel waited-child high-water 518,064 KiB is not a simultaneous process sum or
  product memory guarantee.

Independent review verified the report digest, all three cases and all nine
frozen source/test hashes. The exact receipt is now pinned for the separate
developer service. This direct campaign does not itself establish service
resource accounting, lifecycle, publication or native acceptance.

## Actual service campaign

Command: `node linux-blue/workbench-resize-smoke.cjs`.
Receipt: `resize-service-BbTuXB/report.json`.
SHA256: `48b8ec4e3e1a7277072bdd8d4bffd4c0a820b24a60d2f49aee6ef48f5f8f1381`.
Status: `passed-developer-resize-service-proof`; no application activation.

All eight cases passed through genuine service selection, reservation, execution,
evidence and publication controls:

- Long 100–140-second request: 1,200 frames / 1,920,000 samples.
- Long 130-second open end: 600 frames / 960,000 samples.
- Fresh unseen vflip/997-Hz source at 0.613–8.721 seconds: 243 frames /
  389,184 samples, distinct from the pre-catalog held-out case.
- Active encode cancellation after nonterminal frame 3 while the child was live;
  no publication, with the unbound incomplete stage retained safely.
- Fresh success after encode cancellation: 62 frames / 99,552 samples.
- Complete-source evidence cancellation after 350 observed bytes while its child
  was live; no accepted publication. The retained stage has no validation authority.
- Fresh success after evidence cancellation: 62 frames / 99,552 samples.
- An existing output remained unchanged and the service skipped that collision.

Successful outputs passed 720p/SAR/DAR geometry, genuine fingerprint/runtime-bound
orientation qualification, full source/selected evidence, exact PCM hashes,
telemetry limits, marker checks and full decode. Derived resource reservations
reconciled without violations. Small forecasts retain the existing 32 MiB storage
reservation floor, so an observed reservation can exceed the derived forecast.
Diagnostic accounting is correlated at `OPERATION_EVIDENCE_COLLECTED`, not an
independent recomputation of final whole-job bytes. Under-budget passes do not
prove every possible overflow refusal.

All 143 children closed, maximum one, zero live, seven encodes. Wall time was
679.863 seconds; kernel waited-child high-water 515,144 KiB is not a simultaneous
process sum or product memory guarantee. Independent review verified the exact
receipt and all 15 frozen source/test files by SHA256 and Git blob ID; no material
finding remained. No media job is still running.

Final focused regression before the campaign: 196/196 tests passed, zero failures
or skips. Independent implementation and composition review found no material
defect. This is not a full repository or Windows/GPU suite.

## Publication and continuation

The two independently eligible resource arithmetic source/test files were synced
and read back at `f9d15c84c43be9a0a5582a79d56c37479bf429cb`, tree
`bbf66a05dc3850be38f671bffe3a0de206b94624`, with exactly two changed blobs, no
deletions and zero CI check runs. This does not include the Linux resize harness
checkpoint or resolve the earlier shared-source parity gap.

The exact current 35-file source/test/UI delta was independently audited; all
bytes matched immutable local commit `23144377`. Its sorted path-to-SHA256 map
has digest `8ef8d7146aae4e5a6dd3417bc0b59aac33e138d0e9d6f990dcc1a7c34f6c7a28`.
The bounded scan found no actual secret/private-history content. Historical
documents, old Git history, media, binaries and executor configuration were
excluded. This is not a blanket or exhaustive privacy guarantee.

After explicit owner authorization for this exact scope, one intact submission
was made through the same normal GitHub tree review route. It did not return a
result before interruption after 1,547.5 seconds. No returned tree SHA, refusal,
commit creation or branch update exists for that scope. The submission is
uncertain, not published or newly denied; do not blindly retry it, split it,
rename it or use another transport. The last verified branch remains `f9d15c84`.
A supported connector result or review recovery is needed before proceeding with
that payload. The 35-file count denotes divergence, not 35 unsafe-file findings.

Keep generated media, runtime binaries and raw receipts out of Git. Source-only
sync is not fresh-clone/runtime/native qualification. Next qualify whole-file
FLAC resizing separately, then integrate qualified controls into the explicit
AV1 workbench route while preserving ordinary three-codec behavior. In
particular, the ordinary runner's zero-timeout compatibility handling cannot be
replaced blindly by the proportional runner, which requires positive limits.
