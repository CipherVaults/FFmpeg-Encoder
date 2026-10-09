GOAL: Complete the amended Phase 1 FFmpeg benchmark campaign and deliver trustworthy, reproducible evidence ready for my judgment and Blue’s visual reporting.
Use the Astra campaign plan already in this thread as the starting protocol. Incorporate the four review amendments below before execution. This goal authorizes Phase 1 within the stated boundaries; it does not authorize Phase 2, changes to production presets, or version 0.7 implementation.
1. Establish the actual starting state
Read the existing project instructions, accepted implementation, Astra plan and relevant documentation. Inspect the working tree before changing anything. Preserve unrelated work and never discard it to obtain a clean checkout.
The expected production baseline is local-v0.6.0 at be92b12205d299b6d3bdcc2fd4b2e3a02f928862. Verify it rather than assuming it remains current. Keep accepted release artifacts and application behavior unchanged.
The footage is at:
F:\FFmpeg Station 1\Records for FFmpeg Benchmark
It covers Assetto Corsa Competizione, Clair Obscur: Expedition 33, Crimson Desert, Desktop, Forza Horizon 5 and Starfield. Verify actual files, source identities, metadata, runtime versions, driver and available storage against the plan.
The plan reports compressed AV1 captures, native 1440p for ACC and 1080p for the others, with timestamp variation around 60fps. Preserve the actual presentation frames and timing. Do not force everything to CFR60 or scale ACC to 1080p.
2. Preserve the research questions
Use the actual accepted CPU libx265 Slow/CRF25 configuration as the practical quality/size reference, including its production options.
Retain the accepted HEVC Blackwell Archive Quality CQ29 configuration as a named anchor. Compare ordinary HEVC P7, the HEVC Archive recipe, ordinary AV1 P7, a supported AV1 quality recipe and a manageable CPU SVT-AV1 subset.
Determine:
- Which GPU configurations approach the x265 reference’s visible quality and file size while encoding substantially faster?
- Does the HEVC Archive recipe earn its additional encoding time?
- Does a supported AV1 quality recipe offer a worthwhile improvement over ordinary AV1 P7?
- What useful quality, size and speed trade-offs does CPU SVT-AV1 provide?
Report roughly 70% reduction from capture size as a separate aspiration. Do not force that target or confuse it with matching x265. Earlier AV1 speed observations are motivation, not a predetermined conclusion.
3. Apply these four amendments before the pilot
A. Protect the decisive comparisons.
Specify where Archive CQ29 remains a mandatory measured anchor. Reserve a small, preselected held-out paired comparison of ordinary and compound recipes for HEVC and AV1 where their difference remains consequential. The finalist-slot limit must not remove the comparisons required to answer our central recipe questions. Repeat decisive timing comparisons when differences are modest.
B. Prioritize measured comparability.
Allocate refinement first to bracketing the x265 quality/size region and validating important ordinary-versus-recipe comparisons. Optional ablation breadth comes afterward. Fixed-CQ ablations describe control effects; efficiency claims require retuned, measured comparisons. If a family remains unbracketed within the budget, report it as unresolved rather than inferior.
C. Resolve production and effective-setting ambiguity.
Verify whether the plan’s blanket 8-bit treatment matches the accepted x265 and Archive outputs. Preserve actual production anchors; label any normalized experimental variants separately. Record explicit, inherited, observed and unknown settings. Confirm that each ablation changes the intended behavior: removing a flag does not necessarily disable a feature.
D. Protect a small metric cross-check.
Prioritize regular VMAF and VMAF-NEG on consequential recipe comparisons, particularly those involving filtering, if the bundled model is available and works. Keep native visual review central. If NEG is unavailable, document the limitation; do not automatically download models or upgrade software.
Save a concise amendment/change list, the resulting matrix and revised budget. Reallocate lower-value optional work rather than silently expanding the campaign. If these requirements cannot fit the approved envelope, pause with a concrete choice for me.
4. Stay within the resource envelope
Maximum active campaign machine time: 12 hours, including automated staging, encoding, metrics, validation and report-artifact generation. Exclude time waiting for my review, and report that separately. Maintain an honest elapsed-time ledger across pauses and resumptions; do not restart the allowance when resuming.
Maximum campaign growth: 55 GiB. Retain at least 20 GiB free on D:. Verify that the actual storage arrangement can satisfy both before staging.
The original plan allowed up to 340 encode invocations including warm-up/support and diagnostic retries. Recalculate the amended matrix and remain within that ceiling unless I explicitly approve a change. These limits are ceilings, not targets to exhaust.
After the pilot, forecast remaining work from measured encoding and metric throughput, with contingency and reserved time for held-out validation and reporting. Do not spend the whole budget searching and leave no capacity to validate or explain the results.
5. Build an isolated, resumable benchmark harness
Use a dedicated benchmark branch and isolated benchmark-owned directories, following the project’s established conventions. Do not rewrite the production application to make the experiment easier.
Stage source copies only as planned and only after space checks. Keep originals untouched. Hash and verify staged inputs, and use the same inputs consistently.
Implement stable source/window/configuration/run IDs, exact argv arrays, no-overwrite output creation, attempt records, source/runtime identity checks and restart-safe manifests. Interrupted or invalid outputs must not be mistaken for successful results.
Validate window selection, timestamp alignment, frame counts, configuration construction and resume behavior before trusting benchmark measurements.
6. Execute in stages
Follow the amended pilot → anchors/coarse search → generalization → refinement/component experiments → held-out validation structure.
Run the pilot first. Report whether the outputs and measurements are valid and provide the updated runtime/storage forecast. Continue within the approved envelope when the pilot passes and no material decision is outstanding; do not ask me to reconfirm routine steps already authorized here.
Use evidence to refine the search. Do not blindly exhaust every combination or invent favorable settings outside the recorded matrix. Log justified matrix changes and their resource impact.
Exactly one timed encode may run at a time. No concurrent metrics, builds, copying, playback, games or heavy analysis during timing. Ultra’s parallel agents may assist with bounded inspection, review and analysis only when they cannot contaminate measurements or compete over files.
7. Measure faithfully
Retain completed-process elapsed time, validated FPS/realtime factor, video payload, container bytes, bitrates, paired size ratios, quality results, validity checks and useful lightweight telemetry.
Keep audio controlled or separately reported. Preserve the plan’s frame-alignment, timestamp, color and decode safeguards. Do not silently alter preprocessing to make scores look better.
Keep per-frame and difficult-interval evidence where useful. Interpret native 1440p ACC, desktop content and 1080p gameplay as distinct cohorts. Do not compare their raw metrics indiscriminately or conceal weak scenes inside one average.
Record every failed attempt, exclusion and retry. Diagnose ordinary recoverable errors within the allowance. Unsupported experimental settings should stop that variant, not trigger an unapproved driver upgrade, fallback recipe or production change.
8. Pause for my visual decisions
Prepare the compact calibration review pack with randomized labels and a separate reveal key. Include native stills and motion material, x265 references and the comparisons needed to judge recipe value.
Pause when my judgment is required to lock finalists. Explain what I should inspect and present a manageable decision, rather than sending an unstructured wall of files.
After I choose, freeze finalist settings before evaluating held-out material. Do not tune settings to held-out outcomes. Conduct the planned repeated timing and desktop playback checks, with the relevant limitations stated.
9. Deliver data Blue can turn into meaningful charts
Provide accessible CSV/JSON datasets and manifests containing source/window/run identities, settings, explicit and inherited options, versions, exact commands, timings, sizes, quality metrics, repeats, validity and provenance.
Prepare a clear local report with:
- Practical findings and conditional recommendations
- Quality-versus-size and speed-versus-quality evidence
- Comparable-quality and comparable-size comparisons
- Per-scene weaknesses and visual-review results
- Incremental value of ordinary versus compound recipes
- Compatibility results, failures, uncertainty and unanswered questions
Use $personalized-charts for appropriate visual deliverables. Keep the source data and renderer reproducible, with accurate model/encoder, hardware, software and settings labels. Avoid an arbitrary combined quality–size–speed score or unsupported “percent quality retained” claims.
Prepare the material for a dedicated Notion report that Blue and I can organize afterward. Do not publish or restructure Notion as part of this execution goal.
10. Completion and boundaries
Before claiming completion, obtain an independent check of calculation accuracy, requirement coverage, exclusions and the claims supported by the evidence. Verify final datasets, charts, logs and references agree. Update the campaign’s local documentation and current-state records according to project conventions.
Do not add H.264 testing or broad preset sweeps now; record them as future Phase 2. Do not change accepted defaults, implement 0.7, modify original recordings, install drivers/software, publish releases, push changes, or spend money without separate approval.
Stop for a decision if the minimum valid campaign cannot fit its limits, source integrity is uncertain, a material scope change is necessary, or my visual review is pending.
Success means a valid, reproducible Phase 1 evidence package and useful recommendations for my judgment. It does not mean a guaranteed AV1 victory, a forced 70% reduction, or an automatically accepted new production recipe.