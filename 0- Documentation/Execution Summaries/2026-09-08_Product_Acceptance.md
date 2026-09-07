# Milestone H — Product acceptance

Work performed September 7–8, 2026, following protocol checkpoint `d989ef6`. This report belongs to the H commit that adds it. The final independent review and parent synchronization precede that commit.

## Product changes and discoveries

The six encoder defaults are adopted without changing their proposed values: CPU H264 slower/CRF24, H265 slow/CRF25, AV1 preset6/CRF32; NVIDIA p5/CQ28,25,30 respectively. These are engineering choices verified for operation, not perceptual-quality equivalents or speed benchmarks. Startup still performs actual encode/decode checks per profile and depth on the current device.

Exact shipped behavior corrected two misleading SVT controls: CRF0 silently resolved to35; presets12/13 resolved to11, and presets10+ warned about automation tooling and possible visual artifacts. AV1 CPU now offers CRF1–63 and presets0–9. All product profiles declare eight/ten-bit support; x265's untested twelve-bit claim was removed. The renderer now shows partial-depth reasons even for an otherwise available profile, and explains when a preview has nothing eligible to encode. Such previews remain reviewable with Start disabled; users can change folders/settings.

## Requirement-to-evidence map

| Requirement | Evidence and scope |
|---|---|
| Actual settings and six profiles | `artifacts/product-smoke-1788824079931/report.json`: real UI selection, prepared settings, observed production-runner argv, twelve eight/ten-bit outputs with full decode, and six subsequent batches. Final AV1 case uses preset9. |
| Exposed preset/quality choices | 110 accepted production-builder option cases: 88 non-SVT cases in `artifacts/profile-options-2026-09-07T18-53-00-703Z-0a123b/report.json`, plus 22 final SVT cases in `artifacts/profile-options-2026-09-07T18-55-12-744Z-3f0f9a/report.json`. Default twelve-case evidence remains in the Runtime Upgrades report. Final SVT checks assert resolved preset/CRF, not merely exit status. |
| Rich preservation and primary selection | Product report: real rich fixture retains two audio tracks, subtitle, attachment hash, chapters, language/title/dispositions; independent output validation and full decode pass. Alternate-default video fixture produces exactly the selected 160-pixel-wide video. Existing inspection tests cover unsupported content and fine-grained preservation failures. |
| SDR/HDR policy | Product report: eight/ten-bit SDR and BT2020 SDR encode; real PQ/HLG and unsupported subtitle/corrupt inputs reject with reasons. Structured classifier/inspection tests cover Dolby Vision/HDR10+, static-only/missing/conflicting evidence, attached pictures, probe failures and actual sampled timestamp coverage. These structured cases are not real Dolby/HDR10+ sample encodes. |
| Output and mixed results | Product report: source and pre-existing output SHA256 values unchanged, same-stem selection permits one destination, final counts4 success/4 unsupported failures/1 skipped/1 unprocessed, then6 existing-output skips with no selectable work. F output/service tests separately prove publication races, exclusive-copy fallback, shared failures and owned cleanup. |
| Lifecycle and telemetry | F lifecycle report `artifacts/lifecycle-smoke-1788788718027/report.json` remains applicable: real child exit, cancellation, restart, close and renderer loss. Product report proves real time/byte/percent progress. Parser/service tests prove chunk-split/unknown-duration and stale/failed/cancelled work. |
| UI and native selection | Product report contains10 preview/results layouts; `artifacts/layout-smoke-1788824010407/report.json` adds15 setup/known/unknown-monitor layouts and visible partial-depth reason. Five viewport/DPR scenarios cover1280×720,1920×1080,3840×2160,1920×1080 at2×,854×480 at1.5×. No horizontal/control/container overflow; small and large screenshots visually reviewed. `artifacts/native-picker-1788807275586/report.json` proves real Windows input/output picker selection reaches the app. |

`node --test tests/*.test.cjs` passed89/89 on the final profile/UI source; output is `artifacts/h-recovery-unit-results.txt`. Native commands are `node scripts/product-smoke.cjs` and `node scripts/layout-smoke.cjs`. Product fixtures are generated reproducibly by `scripts/test-fixtures.cjs`; no user media or earlier ignored fixture is required.

## Recovery and evidence limits

Quota interruption left useful H source/tests and reports without synchronized documentation. September8 recovery read live Git and recent artifacts first, retained their evidence, realigned the existing recurring task after Ahmed's manual reset, and resumed only unfinished checks.

Harness fixes included setting generated frame color metadata explicitly, loading the module through Electron's Node module API, matching stream-qualified FFmpeg option names, tolerating floating-point DPR precision, and comparing service state before/after synthetic layouts rather than assuming startup leaves no operation ID. These were test assumptions; none relaxed the production boundary. A final product rerun verifies the corrected SVT preset9 and current UI wording.

Monitor layout snapshots and partial-depth failure examples are explicitly synthetic; real telemetry/encodes are separately evidenced. DPR is Chromium device emulation, not a changed Windows setting or another physical display. Windows picker interaction is real; lifecycle close-dialog choices remain substituted while child/queue/cleanup behavior is real. Capability/option tests ran on Ryzen5 5600X, RTX5060, driver610.74 with pinned FFmpeg/ffprobe9.0.1; other devices remain gated by startup checks. Tests do not certify every media format, all option cross-products, perceptual quality, or metadata outside bounded samples.

## Parent synchronization and next milestone

An independent acceptance-gap review inspected the final product/layout/picker reports, current harness/profile changes and unit log and found H ready to checkpoint within the stated limits. The parent separately reviewed the code diff, reports and small-monitor screenshot.

H source, acceptance gates, Current State, Roadmap, Architecture, Technical Reference, Security/Testing, beginner guide, README, CHANGELOG, Execution Index, Session Summary and continuation state are reconciled against the above evidence in the H checkpoint. I remains separate: build, extract and test the actual local portable Windows ZIP, then record hashes and final0.5.0 acceptance. GitHub creation/upload and public release remain unapproved and are not prerequisites for the local endpoint.
