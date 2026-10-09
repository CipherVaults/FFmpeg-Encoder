# Phase 1 benchmark pilot — October 10, 2026

Human authority: Ahmed. Starting plan: GPT-6 Astra. Execution: Codex GPT-6.1 Sol, Goal execution. Binding scope: [Goal18](../18_Phase1_Benchmark_Goal.md) and amended [protocol19](../19_Phase1_Benchmark_Protocol.md). Accepted application remains local-v0.6.0 at be92b12205d299b6d3bdcc2fd4b2e3a02f928862. Harness checkpoint82c0260 precedes timing; the commit adding this report preserves subsequent laboratory hardening. No production or release-artifact change.

## Pilot acceptance

All20 measured cases and6 family warm-ups completed. Four selectors matched unseeked decoded source hashes/order/native timestamps. CD-B and ACC-A have719 frames; Desktop-B and SF-A have720. The earlier continuation statement of ACC-A720 was incorrect and is explicitly corrected. Outputs retain native1080/1440 dimensions, Main8-bit, BT.709 limited range and native presentation order. Maximum output timestamp error is approximately0.0005seconds, within Matroska quantization. No silent CFR conversion, scaling or audio overhead was introduced.

Both ordinary and UHQ/fullres AV1 recipes execute on the pinned FFmpeg9.0.1/driver617.14/RTX5060. This proves this exact local combination; it does not prove internal unreported driver settings or another GPU generation. The accepted x265 aq-mode=3:psy-rd=2 and Archive29/P7/UHQ/fullres/VBR-CQ/bf4/B-reference each anchors remain canonical production contributions. Explicit/inherited/reported/unknown settings remain distinct.

Regular VMAF vmaf_v0.6.1 and bundled vmaf_v0.6.1neg work. All20 outputs have regular VMAF and SSIM; the ten protected CD-B/Desktop-B x265/recipe arms have NEG. Raw frame traces, means, P5, packet sizes, FPS/realtime factor and current argv were independently checked by phase1_anchor_audit. Findings before coarse: verify current argv on reuse, use exact validation-command identities in forecasts, and do not call the maximum matrix a minimum. These are corrected. Focused core/config/data checks now pass24/24.

Artifacts: artifacts/phase1-2026-10-10/state.json; active-time.json; commands; immutable runs/attempts; data/pilot/runs.csv and runs.json; per-frame metric files. Six staged sources were full-SHA256 verified against originals while staging and pre/post source identities agreed. Unsealed first-pilot metric files were later checked against retained frame counts/summaries and given explicitly dated seals; those seals are not misrepresented as original creation-time hashes. Immutable original attempt results remain preserved.

## Findings that guide search, not product recommendations

- CD foliage: x265112.90s, regularVMAF94.12, about33% of captured video payload. Middle-point HEVC/AV1 GPU outputs take approximately14–15s but score79–88 at roughly17–20% of capture payload. SVT preset5/CRF28 takes35.11s, scores99.85 and uses about77%. Equal numerical controls clearly do not match the reference region.
- Desktop: ordinaryHEVC5.36s versus Archive9.37s; ordinaryAV1 4.08s versus AV1UHQ6.64s. Recipe costs are much clearer here than on decode-limited gameplay. Metric gains require native visual interpretation, not a claim of perceptual equivalence.
- SF and ACC differ sharply from foliage. Their current GPU outputs score above the x265 reference but use more payload. A global average could hide this scene dependence. Separate1440 gameplay,1080 gameplay and desktop cohorts remain required.
- SoftwareAV1 decode/seek contributes substantially to CD/SF pipeline timing. Timed results are completed transcoding-process costs. They do not isolate encoder-only speed or establish a small recipe speed difference on their own.

CompressedAV1 captures remain transcoding references, not lossless ground truth. No finalist or new default is accepted; Ahmed's blind visual decision is still pending.

## Measured forecast and adaptive resource decision

At the first forecast, about33.0active minutes and26encodes were used; about11.45hours remained. Owned growth was18.54GB including17.83GB source copies, with68.68GB free on D:. A25GiB future output/review reserve fits the55GiB growth ceiling and20GiB free-space floor.

The conservative maximum with three hypothetical slow finalists, all protected recipe arms counted separately and original60s/40s held-outs projects about15.47total hours without optional ablations. One worst-cost finalist plus full nominal search still projects13.08hours. Reducing B breadth to23cases, with eighteen refinement cases and only known pilot reuse, projects12.45hours. These are planning estimates with25% contingency, not measured completion times or a proof that every smaller valid campaign is impossible. No supposed future overlap or untested speed advantage is spent.

Independent matrix review confirms that96coarse cases and three finalists are ceilings. The next approved local adjustment is a bounded middle-point/reference A block:36cases before8exact pilot reuses, hence28new cases. Reserve original held-outs, all protected recipe pairs/repeats, comparability refinement, selectors/support and reporting before starting it. The remaining lower-value coarse points, B-point breadth, optional ablations and extra finalist slots depend on the next measured forecast. Archive29 coverage and protected recipe questions are not traded away. No held-out window is shortened or opened.

If measured costs cannot support a valid reduced campaign, stop with a concrete Ahmed choice. The reviewed alternative is30-second held-outs, centered within the original reserved windows, or a larger active-time allowance; neither is silently adopted. At the existing visual gate, freeze exact settings and confirm the feasible finalist count before evaluating held-outs.

## Recovery and next step

Run node scripts/benchmark-lab.cjs --phase=coarse --block=anchors. It reuses complete valid pilot outputs, verifies current argv/raw metric evidence and records a deterministic schedule. New timing uses small durable child leases, quiet-workload observations, output/free-space fences and a protected time reserve. Active children must close before restart; unknown terminal evidence cannot make an output complete. Completed encodes can be recovered after interrupted metrics without duplicating timing, but only with durable successful child-close evidence and fresh validation.

After the block, reconcile live evidence and update the forecast before further search. Do not blindly run --block=remainder, trust a stale continuation note, restart the pilot or begin held-outs. Final independent review, calibration visual choice, held-out repeats/playback, charts/report and Goal completion remain unfinished.

## Same-session correction — concurrent OBS encoding

Expanded focused checks pass26/26. Two real native-observer regressions prove kill-and-await cleanup after persistence failure and parent death. Independent review identified orphan/unknown-timing risks; parent corrected guarded cleanup, atomic PID publication, descendant liveness recovery and strict timingValidity=true gates before resuming timing.

The new quiet preflight stopped the first coarse case before its encode started. Idle GPU encoder utilization remained20–22%. Windows VideoEncode counters and nvidia-smi encoder-session observations identified OBS PID28084 running HEVC1920x1080 at approximately100fps. The earlier CPUx265 pilot GPU logs independently show18–21% hardware-encoder activity, proving concurrent activity during the initial pilot. The timing claims above therefore describe provisional observed wall times, not accepted clean comparative speed evidence.

Ahmed was informed and replied that he would stop OBS encoding. OBS then exited; two idle observations and the recorded quiet preflight report encoder0/decoder0. No foreign process or personal recording was terminated by Codex. The diagnostic session monitor was stopped explicitly. No additional benchmark encode ran during the rejected preflight.

Preserve all valid pilot frame/content/payload/quality evidence and immutable original results. Campaign state and CSV mark original pilot timings invalid for clean comparisons. Reused consequential configurations receive explicit quiet retiming, with new attempts and the previous run recorded; this uses the diagnostic allowance rather than silently rewriting old timing. New telemetry also observes NVENC session PIDs during timing and rejects foreign encoder activity. Forecasts may use contaminated costs only as labelled provisional planning observations until quiet measured replacements exist. Record: artifacts/phase1-2026-10-10/pilot-timing-contamination.json. This correction supersedes the original unqualified timing acceptance; it does not discard the valid source/metric evidence or reopen production0.6.
