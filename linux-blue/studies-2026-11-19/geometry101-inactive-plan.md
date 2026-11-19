# Proposed bounded square-pixel geometry extension

Design only, 19 November 2026, against frozen checkpoint100. No source changes, tests, acquisition or runtime authority. This is independent of the cadence implementation and Ubuntu manufacture lanes.

## Dated state correction

The earlier reconciliation's phrase about unexecuted cadence acquisition described its study boundary. At this handoff the lead reports cadence acquisition independently audited; service integration remains pending. The original study bytes remain unchanged. No acquisition result is promoted to service or native acceptance here.

## Smallest useful scope

Extend the existing precision-AAC H265 slow/25 Matroska range mechanism to ordinary progressive square-pixel SDR portrait and non16:9 landscape inputs. Initially retain CFR30, H264 High/yuv420p, AAC LC48k stereo, zero source origin, existing source/selection/byte bounds, existing delay and clock policy, exactly two streams, no chapters/programs/groups/omissions. Keep source and the existing720 bounding-box request only. Do not simultaneously extend duration, cadence, codecs, audio layouts, presets, resolution menu, rotation or non-square SAR.

Use a conservative initial geometry envelope bounded by existing1080 decode work: positive even dimensions, each axis at most1920 and product at most1920×1080. This admits1080×1920 and1440×1080 without exceeding existing pixel work; it is a proposed operational envelope, not empirical qualification. Recheck decoder frame/spool allocation using actual dimensions before adopting it. Preserve maxima for selected duration, source bytes and complete source decode. Do not reuse proportional FLAC resource authority for AAC.

## Predicate changes and invariants

The exact1280×720/1920×1080 alternatives in src/operation-family.cjs sourceFacts, the16:9 DAR assertion, the width1920 requirement in rangeScope, and the three exact tuples in Linux ProductFamilySelector.requireAacCadence are the proposed geometry-specific constraints to replace, only for the reviewed new AAC geometry policy. They cannot be deleted globally: other FLAC, UHD and copied-audio families retain their existing admission.

Replace exact DAR16:9 with explicit coherent DAR=width/height at SAR1:1. Retain positive known progressive field order, no attached picture, SDR color/chroma declarations, exact source identity and stream relationships. Require positively reconciled identity orientation; do not expand the historical missing-orientation inference to arbitrary geometry merely because pixels look portrait. Unknown/conflicting orientation, display-matrix rotation, mirrors/translations, nonzero crop and non-square SAR remain refused or require their separate policy. Preserve all timestamp/audio checks, output clocks, selector ownership, plan fingerprint, runtime identity, settings and revalidation before Start. The token must bind the resolved output geometry and the new policy identity, not just the dimensions seen during Prepare.

## Shared geometry reuse and subtle boundary

Use operation-contract.resolveGeometry unchanged for source/already-fits/downscale and orientation-aware box selection. Its rational arithmetic picks even dimensions, does not upscale, and tolerates square-pixel aspect error up to1/1000. Importantly, square-pixel input can still cause resolveGeometry to choose a non-square OUTPUT SAR when even rounding cannot meet that aspect tolerance. The initial extension must reject that result, not silently set SAR1 or relax tolerance. Output must explicitly retain square SAR and existing aspect tolerance. No custom portrait formula, cropping or stretching.

encode-operation.cjs constructs scale from contract.output.width/height with explicit Lanczos/accurate rounding/color parameters, then validates actual output dimensions and SAR against the transformed contract. Reuse these paths. Existing operation-evidence frame fields include dimensions/pixel format/color, but not a complete decoded crop-side-data proof; existing timing/count validation is not proof of pixel composition or lack of unintended crop. Therefore inspect and document the exact source-side crop admission and add narrowly required frame/crop checks if the existing trusted source evidence cannot exclude it. Do not claim pixel identity from equal frame counts. Do not alter the collector's audio alignment or use independently zeroed origins.

## Qualification model, not invented authority

Keep original A/B AAC evidence and native091 audit immutable. They support unchanged audio/time-origin/collector mechanisms, not a new portrait geometry measurement. Add a reviewed geometry applicability record to the current evidence model, with explicit mechanism inheritance and separate new geometry evidence identity; never overwrite historical family fields to make old receipts appear to measure the new case. The shared selector, not only Linux UI filtering, must enforce the new scope. If schema requires a versioned policy/family, use one mechanism policy accepting an envelope, not one permanent family per fixture. Registration stays inactive until independently reviewed source, exact runtime binding and the new endpoint result justify it. Any envelope justification must state what is inferred from unchanged scale/validator mechanisms versus directly measured.

## Proposed inert controls

Positive:1080×1920→720 portrait box resolves720×1280;1440×1080→720 landscape box resolves960×720; square input and already-fits smaller source stay uncropped/no upscale; Keep Source retains source dimensions. Check actual rational resolver results rather than hardcoding optimistic outcomes.

Negative: zero/odd/oversized dimensions, product above envelope, inconsistent DAR/SAR, non-square OUTPUT SAR after even rounding, rotation/mirror/unknown orientation, nonzero crop, interlace, HDR, attached picture, extra streams/chapters, different audio layout/rate, non30 cadence, wrong settings, source mutation, stale generation and substituted resolved geometry. Existing valid fixed routes must retain their unchanged selection; invalid geometry must not fall back to ordinary compatibility encoding. Include Prepare→Start token revalidation and no output/publication on refusal.

## Smallest distinct real endpoint, later and separately authorized

One short portrait non16:9 source, e.g.960×1440, explicit identity orientation and square pixels, with known non-symmetric edge/corner markers, horizontal/vertical grid and moving center feature, CFR30 H264 High SDR BT709 plus stereo AAC48k. A non-frame-aligned range through720 bounding-box output should resolve720×1080. This one case exercises the portrait-box branch AND non16:9 downscale without replaying native091 Keep Source or ordinary H265.

Retain exact predeclared geometry, color/aspect/crop expectations; independently inspect the output for preserved edge/corner membership and expected aspect/scale, alongside existing decoded timing, AAC priming/tail warnings, source/runtime ownership and publication checks. Lossy scaling cannot use whole-frame pixel equality. Agree a bounded image/content comparison before execution rather than fit thresholds after seeing output. Keep source and landscape resolution arithmetic can initially use existing mechanism proof plus inert controls; only add another real endpoint if review identifies a distinct untested implementation branch. A service endpoint establishes service acceptance only; native UI acceptance is separate if the exposed controls change.

## Implementation surfaces and exit

Likely scoped surfaces: shared operation-family admission/schema and tests; Linux qualification loader/record and ProductFamilySelector; current source/package closure pins; only collector/crop checks shown necessary by the focused review. No shared geometry rewrite anticipated. First implement isolated source/inert controls, independently review predicate separation and resource/qualification rationale, then propose the single real endpoint. No activation based solely on this design or existing AAC receipts.

## Follow-up structural observation

sourceFacts currently returns width but not height. A successor geometry design must carry and bind both source dimensions, resolved output dimensions and SAR through facts/request/token validation, and audit all downstream width-only routing. Do not infer height from16:9 after removing that predicate. Keep old family dispatch/result shapes compatible or introduce an explicitly scoped successor facts object. The common helper's UHD/PCM/legacy assertions remain intact outside the new AAC policy. Source-only review should enumerate every consumer of facts.width before approving the patch.
