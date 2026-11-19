# Original Q07/Q08: MOV cadence gap after useful-length MOV

Read-only against canonical099 da97ee7584c771eae8e74d345e287999c6546507. No code, media, qualification or runtime changes.

Original scope: ffmpeg-remux-next094-study/ORIGINAL_SCOPE.json preserves Q2e MOV30/60 and Q2g VFR up to60, including retained historical proof. Historical runtime56006c... and fixtures are not current Linux proof. Current original-scope shortfall is real, not a v0.8 feature.

## Restriction points
- linux-blue/product-linux-remux-service.cjs85 jointly requires literal30/1 summaries for MKV and MOV. Split only MOV; keep MKV unchanged. remuxSupport notice79 must become target-specific.
- product-linux-remux-qualification.cjs27 requires MOV envelope v1. Fixed MOV JSON owns current runtime/media/lifecycle references and explicitly describes CFR30. Do not relabel that record as60/VFR proof. A reviewed successor record should distinguish existing evidence, new current-runtime evidence and mechanism inference.
- remuxPolicies passes that fixed envelope into genuine main RemuxOperations. No new renderer control is needed: actual input cadence is inspected, not selected by user.
- Shared src/remux-operation.cjs221–235 already provides v1 matching30/60 summaries and v2 positive rational summaries <=60. v2 is not arbitrary CFR<=60: once complete collection identifies constant cadence, finish408–438 still requires known matching30/60 summaries.
- Shared finish requires genuine complete source/output cadence with equal constant/variable classification; unchanged validator compares every native unit/PTS/duration/interval at existing1/500s bound. Equal average summaries are not a CFR certificate. Wrong/incomplete cadence never publishes.
- Existing MOV metadata/representation/strict AAC constraints and current proportional costs remain independent and unchanged.

## Recommended coherent slice
Prepare a target-local MOV v2 successor admitting original30/60 CFR plus qualified VFR<=60 within the existing MP4/H264 SDR/stereo48k AAC, default-track/und/default-handler metadata subset. Do not widen MOV-input extension, MKV cadence, arbitrary metadata, audio omissions, subtitles or TS. Reuse shared v2 mechanism rather than another cadence classifier or global policy rewrite.

First implement and independently review inert source wiring with an explicitly provisional/private qualification until current evidence is accepted. Existing fixed current MOV30 evidence remains separate. After preservation, use at most two representative current-runtime packaged journeys: one CFR60 and one genuine VFR with distinct native frame steps, using established scripts/v07-mov-vfr-fixtures.cjs recipe where compatible. Confirm retained payload availability before authorizing generation; historical Windows paths are not local payloads. No8s/31s/180s repetition, no format/resolution Cartesian matrix, and no extra private lifecycle followed by identical GUI run unless an actual trust-boundary gap requires it.

A VFR-only output cannot establish CFR60 native branch; two cells are justified by distinct constant/variable finish rules. Prefer a single reviewed bounded supervisor session only if setup and two independent owned outputs fit explicit runtime/storage constraints; otherwise separate exact attempts, not automatic retries. Inspect metadata/native cadence in acquisition as needed; actual preservation comes from genuine current collector/validator/publication, not fixture metadata alone.

## Focused source regressions
- Rational equivalent30/60, supported unequal positive VFR summaries; reject zero, unknown, malformed and >60. Preserve current MOV subset and MKV30 refusal.
- Constant24/25/50 summaries must not be advertised as qualified CFR merely because v2 early filter admits <=60; require fail-closed final rule and truthful UI. Do not promise Ready means final preservation acceptance.
- Complete genuine variable source/output cadence matching; refuse constant/variable mismatch, insufficient/incomplete witness, forged optional receipt, altered native units/timestamps and absent MOV representation seal.
- Real composed Prepare/Start plus stale target/plan/runtime and cancellation/failed-begin ownership controls. No renderer-supplied cadence/envelope authority.
- Reuse tests/remux-mov-vfr-smoke.test.cjs Q2g cadence/metadata negatives and mov-representation tests, adapting only inert portability seams when required. Historical smoke execution scripts must not be launched against their old runtime roots.
- After accepted exact source/evidence, derive current loader/package pins only and preserve old records.

## Actual acceptance still required
One current-runtime CFR60 and one VFR full-copy output must retain compressed packets/headers, complete existing cadence/timestamp/edit-list/priming-tail evidence, genuine MOV metadata receipt and strict unshifted decoded AAC comparison with no21ms waiver; publication/provenance, frozen batch time, real reveal and normal close. Q08 fast-check policy remains complete compressed traversal plus bounded video decode, not full interior video decoding. Exact missing evidence and candidate-only status stay explicit until saved independent audits accept these attempts.

099 long MOV and Ubuntu100 remain higher-priority independent lanes. No new qualification is claimed by this plan.
