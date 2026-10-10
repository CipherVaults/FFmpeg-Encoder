# Phase 1 reduced B generalization — October 10, 2026

Authority: Ahmed's approved Phase1 Goal. Execution: Codex GPT-6.1 Sol. This report's adding commit is the recoverable research checkpoint; accepted local-v0.6.0 and its release artifact remain unchanged.

## Scope and evidence

The saved `generalization-reduced23` schedule completed all23 requirements: x265 Slow/CRF25 and Archive CQ29 on each of six B windows; ordinary HEVC29 and ordinary/quality AV136 on CD/SF/Desktop B; SVT preset5/CRF34 on CD/Desktop B. Choices came from measured A size screening, not perceived-equivalence acceptance. Together with the earlier A block, all mandatory A/B Archive29 anchors are measured.

Independent `phase1_anchor_audit` review reconciled23 immutable result records, canonical production contributions,56 raw metric seals,40,307 metric observations and16,556 packet/frame observations. Frame counts, native dimensions, color, timestamps and both quiet observer terminations agree. Empty later analysis-revision fields were the only benign record difference. No live commands or integrity blocker remained. The bounded search reviewer separately approved the next18-case allocation. These are stage evidence checks, not final campaign or human acceptance.

Artifacts: `artifacts/phase1-2026-10-10/state.json`, `active-time.json`, immutable runs/attempts, `data/generalization/` and the latest hashed forecast. At the reviewed block closure8,034.276 active seconds; latest forecast8,037.789 seconds,115 actual encodes and16 warm-ups. Focused runner checks sequence931 pass41/41. Earlier check930 failed only a stale test assumption that optional ablation must remain nonzero; the corrected test checks the actual configured margin. Historical failed commands and two observer reconciliations remain.

## Consequential observations

Values below are source-relative regular VMAF differences versus the same-window x265 encode and video-payload ratios. One timing observation is screening evidence only.

| B scene/configuration | Payload / x265 | VMAF difference | Interpretation |
|---|---:|---:|---|
| CD ordinary HEVC29 |0.508|−14.70|Large difficult-scene deficit; P5 also weak|
| CD Archive29 |0.509|−13.47|NEG corroborates the deficit; compound recipe does not solve it at29|
| CD ordinary AV136 |0.457|−11.44|Strong compression does not imply sufficient texture preservation|
| CD quality AV136 |0.483|−10.02|Improves this fixed-CQ result but remains far below the reference|
| CD SVT34 |1.414|+4.71|Different quality/size region; no equal-quality claim|
| E33 Archive29 |0.745|−7.11|A/B scene variation matters|
| FH5 Archive29 |1.532|+2.37|Reverses the A-window weakness; do not generalize either single window|
| Desktop ordinary AV136 |0.792|+0.14|Promising metrics/size, awaiting motion/text judgment|
| Desktop quality AV136 |0.960|+0.41|Recipe cost/value remains a human and repeated-timing question|
| Desktop SVT34 |0.442|+0.63|Keep Desktop separate from gameplay aggregation|

SF-B GPU results exceed x265 source-relative metrics but cost about1.15–1.59× its payload. There is no blanket GPU victory, quality-number equivalence, or forced70% reduction conclusion.

## Allocation and accounting correction

The forecast now deducts all23 actual clean chosen B results, correcting626.7 seconds previously charged for11 already completed non-anchor B cases. Before choice, no pilot overlap is presumed. Current targeted scenario reserves29,317.9/32,997.2/36,511.1 seconds for one/two/three conservative finalist slots, against35,162.2 remaining. All original held-out lengths, protected recipe comparisons, NEG, repetitions and reporting remain; three slots do not currently fit without actual frozen overlap evidence. A25% planning margin is not a confidence interval.

Eight optional ablation invocations move to native lossless review/warm-up support: candidate maximum284, support32, diagnostic24 =340 unchanged. Next18 refinement slots prioritize four CD-B challenges, eight AV132 A cases and six AV132 B cases. SVT4/6 diagnostics are deferred. If HEVC25 still misses the CD region, report unresolved within tested range rather than displacing the useful AV132 evidence with a broad sweep.

## Recovery and next step

Run `node scripts/benchmark-lab.cjs --phase=refine --block=cd-challenges` after all agents/tests are quiet. Reforecast actual completed refinement; start AV132 on FH5, then decide from that evidence whether to finish the remaining A/B comparison block. Native review generator has pure/mock no-overwrite/resume/asset tests, but real FFV1/PNG endpoint and rendered review QA remain pending. Prepare only calibration A/B material with known source/x265 anchors and randomized candidates; stop for Ahmed before freezing finalists or opening held-outs.

Parent synchronized Current State, Roadmap, Continuation, Session Summary, Execution Index and protocol against live Git/test evidence. Application architecture/security/README/CHANGELOG are not rewritten because production behavior did not change. Accepted tags/ZIPs, masters and earlier reports remain recoverable.
