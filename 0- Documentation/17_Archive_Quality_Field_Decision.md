# Decision 17 — Archive Quality field convergence

Date: September 24, 2026 (Cairo; measurements completed September 23 UTC).
Human product authority: Ahmed. Mother Thread / strategic review: ChatGPT — GPT-5.6 Sol / Jerry. Engineering executor: Codex — GPT-6 Astra, Ultra effort. Surface/mode: Codex autonomous execution.

## Decision and status

Adopt **CQ29** as the editable Archive Quality helper starting point, retaining HEVC NVENC, P7, UHQ, full-resolution multipass, VBR-CQ, bf4 and B-ref each. This changes the helper's suggested quality only. All six ordinary Tested Defaults remain unchanged. Previously remembered manual settings, including CQ32, remain intact until the user deliberately applies the helper again; old CQ32 provenance remains recognizable and truthful.

This is an engineering selection under Ahmed's revised preference for texture preservation. It is not a claim that Ahmed has subjectively accepted the new output, that NVENC matches x265, or that every recording will land at 30–40% of original size. Final M still requires current native/packaged evidence and independent acceptance review.

This decision supersedes **the preferred CQ choice only** in [Decision 15](15_Archive_Quality_Decision.md). Its three-clip +8.9% size versus x265 / 5.13× speed report remains valid historical evidence. Ahmed's subsequent field experience changed the acceptance emphasis; that report is not retroactively wrong.

## Evidence and bounded method

The [field evidence record](Execution%20Summaries/2026-09-24_Field_Quality_Evidence.json) preserves all35 cases and report/script hashes. Raw report, full-resolution stills, lossless reference/field clips, candidate clips, exact commands, FFprobe JSON, decode logs and per-frame VMAF are in `artifacts/field-quality-20260923`.

Eight8-second,480-frame,1920×1080/60fps/8-bit BT709 segments span four completed real recordings. They cover town detail, dark interior, combat smoke, rocky/scanner detail, fast track foliage, cockpit motion, grass/crates and flowers/foliage. Three original references and nine completed historical cases were reused by hash; no original campaign was repeated. Additional CQ29 was tested only on the three difficult texture scenes after CQ30 still trailed the x265 reference. All personal original/generated files stayed read-only, with bounded before/after identities checked.

The CPU reference is the actual app configuration: `libx265 -preset slow -crf 25 -x265-params aq-mode=3:psy-rd=2`. NVIDIA candidates differ only by CQ32/31/30/29 within the unchanged compound recipe. Pinned FFmpeg9.0.1 hashes were verified; verbose encoder output confirms the requested CQ mode. Hardware: RTX5060, driver616.92. No Ada hardware or 10-bit perceptual benchmark was performed.

Sample size ratios use **compressed video packet payloads** from exact original presentation-time windows, with480 packets and aligned endpoints, versus candidate video payload. Lossless FFV1 reference size is never the denominator. Audio/container overhead is excluded from sample ratios. Separate actual whole-file CQ32 ratios were34.5%,12.6%,10.3%,21.5% across the four paired recordings; these demonstrate variability, not predictions for CQ29 whole files.

## Difficult texture results

Percentages are output video payload / original video payload. VMAF is supporting evidence, not perceptual equivalence.

| Scene / encoder | Original size retained | VMAF mean / fifth percentile | SSIM | Encode seconds |
|---|---:|---:|---:|---:|
| Grass/crates x265 slow CRF25 |34.50%|92.51 /87.43|0.963888|37.72|
| Grass/crates CQ32 |27.42%|89.20 /77.99|0.953810|5.51|
| Grass/crates CQ31 |31.02%|90.31 /79.62|0.958311|5.51|
| Grass/crates CQ30 |34.89%|91.26 /81.24|0.962422|5.47|
| Grass/crates CQ29 |39.31%|92.10 /82.53|0.966068|5.49|
| Flowers/foliage x265 slow CRF25 |33.80%|88.94 /81.93|0.955809|42.08|
| Flowers/foliage CQ32 |22.75%|82.41 /73.47|0.936024|5.45|
| Flowers/foliage CQ31 |26.03%|84.17 /75.77|0.942169|5.49|
| Flowers/foliage CQ30 |29.45%|85.69 /77.80|0.947551|5.43|
| Flowers/foliage CQ29 |32.13%|86.74 /79.70|0.950950|5.49|
| Track foliage x265 slow CRF25 |12.81%|94.25 /90.91|0.941467|50.35|
| Track foliage CQ32 |6.86%|87.29 /79.73|0.911559|5.40|
| Track foliage CQ31 |7.80%|88.95 /82.24|0.916897|5.39|
| Track foliage CQ30 |8.87%|90.53 /84.71|0.922283|5.42|
| Track foliage CQ29 |9.98%|91.87 /85.66|0.927181|5.55|

CQ29 retains approximately1.41–1.46× the CQ32 candidate video bytes in these scenes and improves all three metrics versus CQ32. The grass and flower samples now approach Ahmed's stated size neighborhood. Track footage remains much smaller than the original and below the CPU reference metrics; forcing a universal percentage would be dishonest. On these new scenes, measured x265/CQ29 elapsed-time ratios are approximately6.87×,7.67× and9.08×; timings include lossless-reference decode/startup and recorded host load, not isolated hardware throughput.

## Visual interpretation and limits

Parent inspected original-resolution grass/crates original, actual field CQ32, candidateCQ30, x265 and candidateCQ29 stills, plus flowers original andCQ29. Fine grass/ground and foliage improve from the coarse CQ32 representation, with remaining softening and detail loss visible against the original. UI/HUD readability alone would be an inadequate acceptance test. The choice intentionally spends more bytes on texture and is supported by the measured direction of improvement.

These are selected stills and supporting temporal metrics, not a blinded human continuous-motion study. Original recordings themselves are compressed. Only three difficult scenes have CQ29 measurements; no extrapolated aggregate CQ29 result is claimed across all eight or whole files. Ahmed can fine-tune the visible CQ control; lower numbers are not presented as universally equivalent to any CRF value. Independent review and future field feedback must retain these limits.

## Integration / rollback

Same recipe ID and extra options remain valid; the recommendation's scalar changes to29. Preferences/provenance are not migrated or relabelled. Regression tests cover oldCQ32 descriptions and remembered values, currentCQ29 argv, and unchanged ordinary defaults. Reverting this decision changes the helper starting point without deleting media or state. Any production change requires a fresh portable candidate. Accepted local0.5 and the historical0.6candidate remain unchanged; neither is overwritten.

Independent closure of this bounded choice: [September24 field-quality review](Execution%20Summaries/2026-09-24_Field_Quality_Independent_Review.md) recomputed51packetlists,35ratios/options,26new480-frame metric records and9historicaloutput hashes; inspected9full-resolution reference/CQ32/CQ29 stills. No blocking evidence defect found; the stated subjective, whole-file and hardware limits remain. Native/currentpackaged gates remain separate.
