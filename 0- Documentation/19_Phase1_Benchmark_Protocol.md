# Approved Phase 1 benchmark protocol — October 10, 2026

Human product authority: Ahmed. Strategic review: Jerry/Mother Thread. Starting protocol: Astra plan in this thread. Execution: Codex GPT-6.1 Sol. Surface: Codex Goal execution. The binding [Goal](18_Phase1_Benchmark_Goal.md) authorizes this research campaign only. Accepted local-v0.6.0 stays at peeled commit be92b12205d299b6d3bdcc2fd4b2e3a02f928862; the annotated tag object is 6ed4cf1c786f624831c2d38f2d6a553b0b34cb89.

## Changes after review

1. Archive CQ29 is mandatory on every A/B calibration window and the protected CD/SF/Desktop held-outs. Three finalist slots cannot remove those protected recipe comparisons. An optimized Archive setting can be a separate finalist; no held-out ACC Archive29 claim if it is not selected.
2. Reference-region bracketing and measured ordinary/compound comparability take priority over optional ablation breadth. An unbracketed family is unresolved, not inferior. Fixed-CQ contrasts establish control effects, not efficiency superiority.
3. The accepted builder preserves source depth: current yuv420p inputs produce x265 yuv420p and NVENC yuv420p/HEVC Main. No implicit 8-to-10-bit conversion is implemented. Anchors are generated from production's pure describeRecipe/buildEncodeArgs and pilot output probes must corroborate them. Explicit, inherited, observed and unknown settings are distinct. Flag removal is not feature disable.
4. Regular VMAF and bundled VMAF-NEG are protected on consequential recipe comparisons, with availability/load validation in the pilot. Unavailable NEG is documented; no model download or upgrade is authorized.

## Questions and cohorts

Compare x265 Slow/CRF25 with aq-mode=3:psy-rd=2; ordinary HEVC NVENC P7; accepted Archive CQ29/P7/UHQ/fullres/VBR-CQ/bf4/B-reference each; ordinary AV1 P7; AV1 P7/UHQ/fullres if supported; SVT-AV1 practical presets. Approximately70% smaller capture is a separate aspiration. Source fidelity and practical x265 comparison are separate questions; neither an encoder number nor VMAF equality proves perceptual equality.

Native ACC1440 gameplay, other1080 gameplay and1080 desktop remain separate result cohorts. All six discovered MP4s are compressed AV1 Main8-bit, BT.709 limited-range, with stereo48kHzAAC. Average cadence is near60fps with observed timestamp variation; nominal120 metadata on ACC/E33 is not interpreted as120fps footage.

| Source ID | A interval(seconds) | B interval | Held-out interval |
|---|---:|---:|---:|
|acc|50–62|100–112|170–230|
|e33|50–62|100–112|210–270|
|cd|50–62|95–107|140–200|
|desk|15–27|49–61|70–110|
|fh5|50–62|95–107|185–245|
|sf|20–32|95–107|210–270|

Source names and metadata are preserved in the campaign manifest. Sampled frames already confirm foliage, fine surfaces, combat particles, HUD/text, scrolling, haze and dark industrial detail. Continuous validity and full-resolution capture-artifact observations are pilot evidence, not presumed facts. Hold-outs cannot guide parameter tuning.

## Revised bounded matrix

October10 evidence-based allocation amendment: reduced B23 is complete. Reserve all18 refinement slots for comparability: four CD-B challenges (HEVC25 ordinary/Archive, AV124 ordinary/quality), eight AV132 A cases across CD/E33/FH5/SF, and six AV132 B cases across CD/SF/Desktop. Begin AV132 with FH5, then continue only if informative. Defer the four SVT4/6 diagnostics. Optional ablation8 becomes0 and those eight invocations move to native-review/warm-up support: unique maximum212, candidate284, support32, diagnostic24, unchanged total340. The original table below preserves the initial maximum; this amendment governs the narrowed execution. Mandatory Archive29, all protected recipe pairs, NEG, original held-out lengths and three timing repetitions remain. One/two conservative finalist slots currently fit; three needs actual frozen overlap/cost evidence. A measured point remains unresolved if it misses a scene's reference region; no blind extension is implied.

| Stage | Maximum distinct outputs | Conditions |
|---|---:|---|
|Pilot|20|Six families on CD-B/Desktop-B/SF-A plus x265/AV1quality ACC-A; reuse matching valid cases|
|Coarse A|96|Six windows × x265 plus3points for each other family|
|Generalization B|42|Six windows × x265, Archive29, one useful point for ordinaryHEVC/SVT/ordinaryAV1/AV1quality and one retunedArchive point; deduplicate if29|
|Refinement|18|14 comparability/bracketing;4 SVT presets4/6 on CD-B/Desktop-B|
|Optional ablation|8|Four variants × two windows, only after protected comparability needs|
|Finalist held-outs|24|x265 plus up to3 frozen finalists × six windows|
|Protected recipe held-outs|12|ordinaryHEVC, Archive29, ordinaryAV1, AV1quality × CD/SF/Desktop, independent of finalists|
|Total before overlap reuse|220|Ceiling, not an instruction to exhaust|

Two extra timing repetitions of36 held-out cases add72invocations; candidate maximum292. Warm-up/support maximum24 and retry/diagnostic maximum24 make the unchanged340encode ceiling. Reuse never enlarges another reserve. Unsupported AV1quality shrinks the matrix and is documented, without silent fallback.

Initial SVT preset5 CRF22/28/34; ordinaryHEVC and Archive CQ25/29/33; ordinaryAV1 and AV1quality CQ24/30/36. Middle points form pilot. One outward extension per global family, using initial spacing, is allowed within refinement; one-unit refinement inside measured brackets. No extrapolated claim. A setting measured only on two scenes cannot establish global matching.

Protected recipe comparison uses Archive29 as compoundHEVC arm and a calibrated/frozen ordinaryHEVC setting. OtherArchiveCQ can be a finalist, not a replacement for this anchor. Both AV1 arms are independently calibrated/frozen. Retune measured points when a fixed-CQ result does not establish comparable size/quality. Three preselected held-out pairs remain mandatory even if their configurations win no finalist slot.

Optional ablations on CD-B and Desktop-B: HEVCArchive with explicit multipass disabled; Archive with explicit tf_level0; AV1UHQ with multipass disabled; AV1HQ with fullres. Pilot logs must establish intended behavior. Removing bf/B-reference overrides would mean preset-owned, not disabled. rc-lookahead0/AQ0 are not valid proven disable controls in this wrapper. Any non-informative/ignored contrast is retained but cannot support causal claims.

## Harness, alignment and timing

Workspace: artifacts/phase1-2026-10-10, ignored by Git. Branch codex/pre-0.7-benchmark. Originals under F:\FFmpeg Station 1\Records for FFmpeg Benchmark remain unchanged. Stage identical verified copies once on D: after reserving source bytes. Hash original while copying, verify copy, compare original pre/post identity. Later commands use the same staged source identity.

Freeze frames with start<=nativePTS<end. A copyts/accurate-preseek/trim selector must produce identical source frame hashes/order/timestamps to an unseeked decode trace. Preserve native dimensions, pixel depth/color and presentation timing. Explicit enc_time_base=demux in the laboratory avoids quantizing irregular timestamps through misleading nominalr_frame_rate; this is a recorded harness timing difference from production, not a changed quality contribution. No scaling, denoising, fps/r conversion or selective hardware decoding. Validate output count and expectedPTS within Matroska time-base quantization; shifted frames invalidate the whole window block, never optimize alignment per candidate.

Primary outputs are video-onlyMKV, canonical production video options, no application provenance or audio overhead. These harness differences are recorded. Playback derivatives copy identical selectedAAC and report it separately.

One timed child only, shell=false argv arrays, exclusive ownership lock. No metrics/copies/builds/playback/heavy analysis during timing. Sequential family warm-up before first measured block and after long idle/restart, bounded by allowance. Saved deterministic rotated order; completed process launch-to-close elapsed includes decode/seek/encode/mux. Repeat decisive held-out comparisons3times; modest<=15% speed gaps or variability trigger bounded paired repeats or an unresolved timing conclusion.

Metric logs record VMAF modelversion=vmaf_v0.6.1, n_threads6, n_subsample1 and runtime/library identity; SSIMY/U/V/All; regular/NEG crosscheck on x265 plus four recipe arms on CD-B/Desktop-B and CD/SF/Desktop heldouts. NEG also covers consequential filtering ablations. Native1440 VMAF is exploratory within its cohort; native visual/SSIM review remains necessary. Per-frame mean/P5/min and worst1-second interval are retained. Frames are correlated, not independent repeated experiments.

Source-relative metrics for both candidate and x265 are primary. Matched source/x265/candidate stills and motion with randomized labels and separate reveal key support Ahmed's preference. No objective metric constitutes subjective acceptance. Desktop compatibility primaryMPC-HC2.8.2; existingWindows player secondary. No device/player installation; otherdevices unverified.

## Budget, recovery and acceptance

Active machine ceiling43200seconds across all automated stages/resumptions, growth55GiB, D:freefloor20GiB. Mutable ledger has persisted heartbeat/open owner, monotonic accounting and conservative/evidenced crash recovery. Closed human-review waits are excluded and recorded. Stable source/window/config/run IDs, immutable attempts, exactargv, logs, hashes and validity prevent interrupted work being mistaken for complete. State/logs outrank stale continuation prose.

Pilot measures encode, validation and regular/NEG costs. Forecast remaining work with25% contingency and reserve held-out/reporting first. Reduce optional refinement then ablation then B-point breadth; never consume protected comparisons to chase a leaderboard. Pause with a concrete choice if minimum valid campaign will exceed any limit. No retries conceal failed attempts.

Post-pilot allocation: the maximum96coarse/threefinalist reservation does not fit the conservative measured forecast. Begin with36 middle/reference A cases (8valid pilot reuses), with protected originalheld-outs/refinement/reporting fenced. Reforecast before lower-value search. B breadth may reduce to x265+Archive29 all6B, selectedordinaryHEVC/ordinaryAV1/AV1quality CD/SF/Desktop B and selectedSVT CD/Desktop B. Even that upper reduced search is initially borderline; neither one finalist nor the96case maximum is blindly treated as a mandatory exhaustive sweep. Additional finalist capacity depends on actual measured resources and Ahmed's visual decision. Original held-out lengths remain until Ahmed explicitly approves a change.

Human gate: compact blind calibration review, explain texture/motion/gradient/text decisions, lock finalists and paired settings before held-out outcomes. No further execution dependent on that choice until Ahmed answers. Completion requires held-out timing, playback, accessibleCSV/JSON, native review judgments, reproducible charts/localreport, independent calculation/coverage/exclusion/claim review and parent documentation synchronization.

Quiet anchors accepted:36/36,69encodes including13actual warm-ups, approximately77active minutes. Independent review passes. Next bounded20points are SVT34/HEVCordinary25/Archive25/AV1ordinary36/AV1quality36 acrossfour primary A scenes, justified by per-scene deficits and oversized results. Then reforecast before at most4extra targets/reducedB23. DifficultCD-B quality stays decisive. Forecast schema2 retains distinct-window costly observations and explicitly models targeted20, rather than labelling the full sweep a minimum. Original held-outs and all protected pairs remain. See [anchor report](Execution%20Summaries/2026-10-10_Phase1_Anchors.md).

No H.264/Phase2, presets/default changes,0.7code,ctime patch, software/driver installation, public/GitHub/Notion publication or release work. Ordinary recoverable failures are corrected within the envelope. These limits and the human gate are retained across quota continuation.
