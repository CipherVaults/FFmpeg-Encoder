# Proportional FLAC contract: bounded source integration

## Outcome and scope

Implemented one main-owned, non-resize proportional precision-FLAC range-family contract and its service resource routing. This is a tested source prerequisite, not activation, recovered historical code, actual-media qualification or a completed release feature.

The reviewed patch is `c35704a638a34f822663ee42b599c1cb1463506533c1df44cb546d72611cff0e`, based on local checkpoint `0c5d9d2`. The preceding publication cycle completed local Git → verified Notion restoration → GitHub, with remote checkpoint `acbc83f` verified. Those identities describe the previous cycle, not a new commit containing this change. New commit, mirror and push results belong in the subsequent checkpoint receipt.

Three implementation files changed:
- `src/operation-family.cjs`
- `src/encoder-service.cjs`
- `tests/operation-family-proportional.test.cjs`

The published companion receipt is `linux-blue/2026-11-17_Proportional_FLAC_Receipts.json`. Current State owns immediate continuation; the cumulative Session Summary owns the detailed dated narrative. Detailed test logs remain retained locally; publication of these records does not imply inclusion of every historical artifact or raw log.

## Contract and safety boundary

The only added family is `cfr-sdr-range-flac-v2` with `cfr720p30-flac-resources-v1`: CPU HEVC slow/quality 25, 720p30 Keep Source, SDR, measured QuickTime PCM s16 stereo 48 kHz source, precision-FLAC Matroska range output, and the existing strict source/request constraints. Core admission requires exact rational video `1/15360` and audio `1/48000` clocks. It does not depend on a Linux composition wrapper to enforce those clocks.

Budgets derive from the genuine plan's selected interval, complete source extent and exact source size. Complete-source forecasting includes video/audio/container extent and rounds upward to microseconds without changing the requested interval. Fixed resource coefficients and capacities are unchanged; overflow refuses rather than clipping. Legacy 120-second source and 30-second range bounds and fixed-budget semantics remain confined to their original families. Resize, full, 1440 and proportional AAC variants are not added.

An in-process private WeakMap associates a frozen proportional result with its issuing selector epoch and exact plan object. Clones, public flags, inherited copies, cross-plan borrowing and invalidated results cannot supply proportional resources. `requireCurrent()` remains mandatory for source/request/runtime/settings/budget freshness: branding alone is not a fresh filesystem observation. The service routes accepted budgets to storage reservation, aggregate pipe/evidence accounting, child limits, deadline and telemetry configuration.

Plain descriptor and binding getters are rejected before invocation. That is not a blanket guarantee for arbitrary in-process Proxy traps. Main-owned objects remain the trust boundary.

## Verification

| Evidence run | Result and applicability |
| --- | --- |
| `20261117T141608Z_proportional-contract-final-reviewed` | 42/42 focused checks passed on final reviewed source. |
| `20261117T141644Z_proportional-contract-final-legacy-adapted` | 33/33 legacy checks passed using a test-only path adaptation. |
| `20261117T141645Z_proportional-contract-final-linux` | 177 tests: 150 passed, 27 failed. Broad Linux regression remains failed. |
| `20261117T141508Z` core-clock red check | 11 passed, 1 failed before adding core clock admission. Demonstrates the missing direct-selector restriction. |
| Independent final proportional test repeat | 12/12 pure/injected tests passed, including direct wrong-clock rejection and legitimate controls. |

The unadapted legacy suite was also compared with the parent: both produced 59 passes and 25 failures out of 84, at identical failure locations. Windows-style fixture paths fail early on Linux; identical failures alone do not demonstrate the unreachable legacy branches. The test-only path adapter passed 33/33 on both parent and changed source. Original legacy test files were not rewritten. Neither test method is native Windows qualification.

The worker's first schema-fixture run produced 1 pass and 9 failures; the fixture was corrected without changing production code for those failures. Later the clock test was deliberately red before its source fix. These are separate events and must not be presented as one uninterrupted all-green run.

## Independent review and remaining limits

Review followed forged, cloned, borrowed and stale result attempts through resource routing and inspected storage, runner and telemetry consumers. No blocking issue remained in the final patch. The last delta added the core clock restriction, corrected proportional diagnostics that still said 120 seconds, and added `150.0000001` to test genuine sub-microsecond upward rounding rather than only an already-exact microsecond value.

Telemetry values are covered by direct resource tests, source inspection and a wiring assertion. An executed service-to-telemetry enforcement test is still required before activation. The broad Linux regression's 27 failures remain explicit; this checkpoint does not claim to resolve them all.

**Collector refusal is post-encode.** Its direct test proves rejection before a collector runner call, not before an encoder call. An independently assembled main-owned service could encode before reaching that refusal. Actual production factories remain closed by unchanged retained-report, exact observer-source and runtime verification gates. No report, source pin, runtime pin, default or factory gate was changed. No actual media, UI, GPU or native Windows work was performed for this change.

## Next bounded action

First reconcile this source checkpoint and its receipt, then add an injected service-level test proving derived limits reach and are enforced by the real storage/runner/telemetry consumers. Do not activate the family to obtain that evidence. The next collector change needs a separately reviewed genuine-selection/plan/source/budget binding and complete-source checks, with unchanged legacy requests. Missing reports and the 9.0.2 runtime remain separate prerequisites; they must not be fabricated, replaced with synthetic receipts or bypassed. Earlier unresolved publication/review scopes remain separate from this newly reviewed change.
