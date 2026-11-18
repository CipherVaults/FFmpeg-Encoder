# Current state — checkpoint 050

Record cutoff: 2026-11-18 13:28:22.496419 UTC.

## What now works within the tested scope
- Fresh Full-copy calibration passed three preregistered whole-file 1080p30-to-720 H265 slow25 / copied-AAC cases on immutable checkpoint 049. All 70 owned children closed. Packet/header/padding identities and decoded timing/counts were audited; this is not PCM identity.
- The reviewed two-file Full-copy consumer binding now uses that exact fresh evidence. All 342 tests in the explicit Linux selection pass, including the same nine previously failing names. All 339 prior names remain, plus three new tests; failures were not converted to expected negatives.
- Focused 72/72 and protection 229/229 also pass. These scopes overlap. Focused source-only coverage is 14 passes and two explicitly missing raw-input prerequisite skips, not hidden production failures.

## Boundaries that remain
The updated consumer has actual-report parser and injected factory/source coverage, not a fresh normal-service or native run. Earlier bounded ordinary and post-codec resize service evidence remains separate. This is not package-wide npm test, Windows, general-player, visual-quality or performance qualification. No runtime/default/audio-policy or producer source changed. Three 168-byte CPU/pool warning streams remain; harmlessness is not established.

The source archive preserves a complete transformed report, not runtime tools, dependencies, raw media or a restorable original report. Those inputs remain necessary for genuine acquisition.

## Next
Preserve this coherent source checkpoint, then finish and independently review the reduced short Full-copy service helper. At this cutoff it was assigned only: no completed helper, review, gate or run, and no repeat 150-second target planned.

[Execution](2026-11-18_Post_Codec_Full_Copy_Calibration_and_Binding.md) · [Receipts](2026-11-18_Post_Codec_Full_Copy_Calibration_and_Binding_Receipts.json)
