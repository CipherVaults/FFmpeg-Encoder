# Independent field-quality review — September 24, 2026

**Conclusion:** the completed evidence supports CQ29 as an editable, quality-priority Archive Quality starting point under amendment16. It supports improving the response to Ahmed's foliage/grass complaint; it does not establish subjective acceptance, x265 equivalence, or a universal 30–40% whole-file size outcome. No blocking measurement or method defect was found for that bounded decision. Final M and `local-v0.6.0` remain separate pending gates.

This review changed only this report. No encodes, source-media operations, production changes, research campaign, or benchmark reruns were performed. Reviewed AGENTS, binding amendment16, historical decision15, current continuation/architecture/plan context, `scripts/field-quality-benchmark.cjs`, `selection.json`, `EVIDENCE.md`, completed `report.json`, relevant sidecars and the production encoder contribution in `src/media.cjs`.

## Evidence and independent checks

- The initial benchmark completed at `2026-09-23T16:20:09.018Z`; bounded CQ29 convergence completed at `2026-09-23T16:21:23.987Z`. There are 35 unique complete cases: x265/CQ32/CQ31/CQ30 for eight scenes, plus CQ29 for three difficult texture scenes. Nine cases reuse historical results; all 307 journaled commands have status0. Eight selected eight-second scenes cover four completed recordings; the fifth inspected recording was excluded. Every measured reference/candidate has 480 frames, 1920×1080, 60fps, 8-bit BT709.
- An independent read-only Node assertion pass recomputed 51 packet lists: original and existing-field-output intervals for eight scenes, plus all 35 candidates. Packet counts, PTS endpoints, byte totals and both stored ratio calculations match. Original/field intervals have matching first/last PTS and 480 packets. The denominator is original compressed primary-video payload, not FFV1 reference bytes. Candidate payload ratios exclude container/audio overhead; whole-file field CQ32 ratios are separate measurements and cannot forecast whole-file CQ29 ratios.
- All 35 recorded encoder option arrays match the intended comparison: production x265 slow/CRF25 with `aq-mode=3:psy-rd=2`, or NVENC P7/UHQ/fullres/VBR/CQ/zero average bitrate/bf4/B-ref each. Only CQ varies within the NVENC comparison. Production uses equivalent stream-scoped options. Every candidate input path matches its scene's FFV1 reference. Recorded seeks/durations and zero source start times support temporal alignment; metrics explicitly normalize timestamps before frame comparison.
- Independently reconciled the 26 new VMAF JSON files (480 entries each), reported means, sorted-frame P5 at index24, and SSIM stderr values. Recorded new encode/decode commands succeeded. Historical report/convergence SHA256 values still match the recovery manifest; all nine reused output files were rehashed successfully, and copied argv/size/timing/quality values match historical records exactly. Historical scene source paths, intervals and all recorded source identity fields match the current campaign snapshots. This review did not rehash large FFV1 references or personal recordings; their preservation/identity checks are campaign evidence, with the documented sparse-identity limitation.
- Inspected nine existing full-resolution PNGs: reference/CQ32/CQ29 at frame312 for grass/crates, flowers/foliage and track/foliage. CQ29 retains more ground, grass, tent-pattern and leaf detail than CQ32 in these frames. Track road/foliage texture remains softened relative to the reference. HUD/coarse structure remains aligned. These are model-assisted still observations, not human continuous-motion acceptance.

## Decision evidence

Percentages below are candidate/original **video-payload** ratios, never whole-file predictions. Each cell sequence is CQ32 / CQ30 / CQ29.

| Scene | Original-video percentage | VMAF mean | CQ29 P5 / x265 P5 | x265 VMAF mean |
|---|---:|---:|---:|---:|
| Grass/crates | 27.43 / 34.89 / 39.31% | 89.20 / 91.26 / 92.10 | 82.53 / 87.43 | 92.51 |
| Flowers/foliage | 22.75 / 29.45 / 32.13% | 82.41 / 85.69 / 86.74 | 79.70 / 81.93 | 88.94 |
| Track/foliage | 6.86 / 8.87 / 9.98% | 87.29 / 90.53 / 91.87 | 85.66 / 90.91 | 94.25 |

CQ31 and CQ30 improve supporting metrics consistently across all eight scenes. Another bounded step was justified by residual difficult-scene deficits. CQ29 improves mean/P5/SSIM further on all three tested scenes, while grass and flowers reach the requested approximate size neighborhood. Their CQ29 files are 1.43× and 1.41× the corresponding sample CQ32 files; track is 1.45×. CQ29 measured encode times are 5.49–5.55s per eight-second sample, compared with 37.72–50.35s for x265 in those scenes; startup/reference decode and same-machine conditions limit throughput generalization.

The CQ29 choice remains a preference-driven engineering tradeoff. Track and flowers still trail x265 in all three quality summaries; grass trails in mean/P5 despite higher SSIM. Dark interior already reaches 49.09% at CQ30, and CQ29 was not measured on that scene or the other four non-convergence scenes. There is no eight-scene CQ29 aggregate, full-recording CQ29 measurement, representative 10-bit quality campaign, Ada measurement, optimality proof, or human motion comparison. The narrow extension is adequate for a starting point, not a universal archive-quality claim.

## Documentation disposition

At review intake, `EVIDENCE.md` still opened with “reference preparation in progress” and described only CQ32/31/30. This stale ledger status needs a transparent completion note and a superseding decision linked to this review; preserve decision15 as history. It is a documentation reconciliation item, not a reason to repeat completed computation. A changed helper still requires affected direct/native checks, a fresh portable ZIP, full M acceptance and independent M review before any final tag.

Reviewed report SHA256: `86afb8a0c4f08a129b987cb8dad97c2fd57b30f81da397ed624e3f64a22fe48d`.

Reviewed benchmark script SHA256: `125093316178269a9dacec5da812f8627addb17b4821f9f71bc64786e439bcb7`.
