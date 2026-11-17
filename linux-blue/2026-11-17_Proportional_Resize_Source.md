# Proportional 1080p-to-720p range source and calibration harness

November 17, 2026. Lead: Blue, configured GPT-6 Astra / Ultra, not backend telemetry. Integrated on preserved `40391115b769dd30d4a986db1e1126fa2f4a8f29`. This is a source-only checkpoint, not a media qualification. See [structured receipts](2026-11-17_Proportional_Resize_Source_Receipts.json) and the [full Session](SESSION_SUMMARY.md).

## 1. Task Overview

Extend the existing private proportional range path from Keep720 to one fixed 1080p30-to-720p SDR precision-FLAC family, then supply the minimum genuine candidate calibration entry needed to test it later. Preserve old scope and authority rather than bypassing the source guards through the historical resize entry. Retain useful red tests, incomplete coverage and the resulting intentional candidate refusal.

## 2. Context Used

Owner-authorized Linux 0.7 continuation, AI PBS 1.1 and Git → verified Notion → GitHub cadence remain in effect. The previously completed native journey and platform wording fix are fully preserved in checkpoint 014. New shared source was developed in an isolated clone while that native source was frozen; only after the actual 014 source restore did the lead apply the reviewed patches. The existing geometry builder, resource planner, family/collector private bindings, candidate runtime handle and calibration source were read before choosing the slice.

The implementation reuses the existing `cfr-sdr-range-resize-flac-v1` family and `cfr1080p30-to720p-flac-resources-v1` formula. The 3,375 ms/source-second decode charge is a fixed admission/acceptance budget, not measured hardware throughput. No new general campaign DSL, arbitrary policy channel, dependency or renderer route was introduced.

## 3. Work Performed

**Family and collector.** Two shared modules now dispatch between the two fixed proportional policies. Resize requires genuine 1920×1080 progressive 30 fps H264 High/yuv420p SDR limited BT709, left chroma, square pixels/identity orientation, exact QT brand, zero starts, s16 PCM stereo 48 kHz and the existing video/audio clock boundaries. Only a precise range to 720p with precision FLAC is admitted. Distinct fixed derived limits attach to the private result; caller overrides or a Keep720 result cannot authorize resize collection. Private plan/source/fingerprint/stat/resource references, currentness, epoch invalidation and whole-source verification remain required.

The pre-plan orientation helper previously parsed every tuple with a legacy duration bound. It now parses facts per matching family before request-scope checks, so a genuine long resize tuple can issue a main-owned exact-source absent-orientation interpretation. It does not generally assume absent metadata means zero rotation, nor let long 1080p metadata borrow legacy/Keep720 grants. Existing geometry construction remains unchanged: range trim and common-origin rebasing precede explicit BT709/tv Lanczos scaling and square-SAR normalization. Full, AAC, wrong settings, other rates/geometries and nonidentity orientation remain outside this slice.

**Developer calibration.** Inspection found the existing candidate harness hardcoded Keep720; the historical resize entry used old pins and an unbranded source policy, so it was not a legitimate shortcut. The narrow harness patch adds fixed explicit resize wrapper/helper exports, genuine final-plan selection, exact pre-plan orientation binding and repeated source/runtime checks. Existing Keep720 API/default behavior remains. Candidate artifact namespace identifies the selected fixed route. No service capsule or runtime pin map changes.

The owned child observer now retains successful and failed stderr prefixes up to 256 KiB with sequence/tool/argv, bytes, SHA-256, availability, truncation, closure and persistence state. It adds a listener without replacing consumer callbacks. Failure is rethrown after diagnostic persistence; persistence failure is retained. A child still open at settlement cannot upgrade `completeAtSave=false` later, even if live counters change. Final report semantics distinguish saved-prefix bytes from later totals. Runtime-close failures change the final returned/persisted report to failed-retained; the console summary emitted earlier is not final authority.

Calibration acceptance now explicitly requires valid telemetry, exactly video/audio streams and zero unknown input rows before canonical output acceptance. Initial unknown-row negative coverage stopped at stream-count validation; V2 adds two valid-kind streams with a nonzero unknown count and asserts that precise guard. This is test precision, not weakening a production criterion.

**Integration.** The lead verified both immutable patches, all seven final file hashes and a clean authoritative base, then applied them at 18:56:55.212692 UTC after the 014 Notion source gate. Only these seven files changed. Current factory pins intentionally remain stale at the harness, family and evidence modules; no old media report was repinned to restore a green test.

## 4. Commands / Tools Used

Independent read-only source review traced private issuance/currentness, complete-source checks, orientation, resource dispatch, telemetry, diagnostic callbacks and final closure. Pure/injected tests use ordinary Node test runners and owned byte/EventEmitter fixtures, not FFmpeg, Electron, personal media or GPU. Final lead checks used the existing evidence wrapper with explicit test and covered-source paths. Exact commands, tested hashes, counts, log identities and source integration receipt are in the structured receipts.

Git checks used immutable patch SHA-256, exact base-file identities, `git apply --check`, explicit path staging and diff checks. No dependency installation, runtime opening, real media execution, security setting, approval-file creation or remote publication was performed for this source validation. Formal Security Cloud remains deferred.

## 5. Verification / Testing

- Family/collector final new tests: 25/25; the exact final tests against baseline produced one pass and 24 failures. Independent combined checks: 125/125; an additional orientation repeat passed six tests. Earlier initial 1/15 red and a setsar-parentheses regex mistake remain documented; the builder was not changed to satisfy that mistaken test.
- Legacy baseline and patched comparison: 73/98 each with the same 25 failed names, primarily existing Windows-path fixture assumptions. No legacy expectations were edited.
- Harness V1 worker and independent combined checks: 148/148. Initial new-test red was retained; a fixture erroneously supplied a resize-only orientation grant to a source-resolution plan, then its conditional was corrected without changing the builder. V2 precise unknown-row assertion: 17/17 worker and independent focused checks.
- Final integrated focused run: 148/148, no skips, exit zero, 2,055.114 ms. Service/process run: 125/126, sole old missing-source `PROTECTED_SOURCE` versus `SOURCE_CHECK_INCOMPLETE` mismatch, 7,503.371 ms. Broad Linux: 178/213, 35 failures, 1,329.177 ms. Saved name comparison retains all prior 27 and identifies exactly eight additional candidate producer refusals.
- No complete successful synthetic resize campaign was executed. Some harness tests intentionally stop at fixture generation or missing fixture output; the final orientation-to-campaign path is partly source-traced. No actual resize, scaling-quality, service-publication or native/platform qualification follows from these source checks.

## 6. Problems Encountered

The source-only resize family was insufficient by itself because candidate calibration was Keep720-only. Reusing the old resize entry would have avoided the genuine-selection boundary; instead the minimal explicit harness route was implemented and independently reviewed. The existing telemetry result had been computed without an explicit valid assertion in this harness, so acceptance was tightened and tested.

Preserve the test-fixture/regex mistakes and the V2 unknown-row coverage correction as failure intelligence, not production defects or erased reds. The independent reviewer also identified a nonblocking reporting nuance: final console output can precede runtime close. Future execution must require the returned and persisted post-close report, complete saved stderr and balanced census. Completion-receipt writes themselves can fail on filesystem errors; reconcile outer logs/raw report/inventory rather than promising unconditional receipt creation.

The current candidate factory now refuses intentionally because three exact producers changed. Eight broad failures demonstrate that barrier, not a reason to copy new hashes into old qualification records. The 27 inherited broad failures and old missing-source diagnostic mismatch remain unresolved. No unavailable evidence is called a new implementation defect, and unreached downstream behavior remains unknown.

## 7. Documentation Impact

Current records the source implementation, actual tests and explicit non-runnable candidate state. This execution record and structured receipts separate isolated/independent/integrated tests, old failures, new expected refusals, diagnostic semantics and prospective media work. The Session must preserve the exact prior 514,996-byte body while adding a substantive full owner-format entry. Historical native/media records and archives remain unchanged. No raw runtime/media logs or private root mappings are added to source documentation.

## 8. Git / Version Control Impact

Checkpoint 014 is fully restored and original-ancestry published before this source step. The proposed 015 scope is eleven paths: seven source/tests plus Current, Session, this execution record and receipts. Three new tests plus two new records yield 538 source files and fifteen local commits. At record creation this is a working/staged checkpoint, not yet a new backup. Finish scope review, explicit coherent commit, immediate verified Notion ZIP/full-history/native PBS readback, then expected-parent non-force GitHub publication. Final external receipts own resulting identities.

No runtime binaries/dependencies, calibration outputs, future launcher/approval, private Planning, historical unknown 35-file payload, theme changes or unrelated Windows snapshot edits are included. Earlier remote historical files remain unchanged through base-tree publication; no history rewrite or deletion is intended.

## 9. Decisions Made During Execution

Use fixed existing geometry/resource building blocks, preserve the main-private authority boundary, and make the calibration route explicit rather than injecting arbitrary family/configuration. Bind orientation to the exact inspected source and qualifying tuple. Keep telemetry and final closure as acceptance conditions. Distinguish evidence acquisition from canonical validation and publication: scaling is not video-pixel equality, and selected PCM equality remains a separate output-validation condition.

Group the family/collector and minimum calibration producer source in one coherent checkpoint, rather than claiming a usable resize chain before its producer exists. Preserve the candidate refusal until fresh evidence covers the exact new producers. Do not change resource coefficients to fit observed errors or relabel earlier Keep720/native proof as resize qualification.

## 10. Items That Need Human / Coordinator Review

No routine product decision is blocked on Ahmed. The coordinator must finish preservation, then bind the actual immutable source/full-tree restore and exact runtime identities before authorizing the prepared single resize calibration. Owner release acceptance remains separate. Current source cannot run the old candidate factory; that is an explicit development boundary, not an unexplained regression or automatic permission to requalify every route.

## 11. Current Result

The narrowly scoped resize family/collector and genuine candidate calibration route are implemented, independently reviewed and integrated with focused source checks passing. Existing producer guards remain effective. No actual resize campaign, new capsule, normal-service resize publication, native resize, Windows/GPU execution, production/default/catalog activation or release has occurred. The completed native Keep720 journey remains correctly attributed to immutable c270331 and its later wording fix to checkpoint 014.

## 12. Recommended Next Step

After verified 015 preservation, bind its actual commit and all tracked bytes to the prepared reviewed launcher and a new explicit one-attempt authorization. Generate only the fixed fresh 150-second 1080p30 source and 11-second heldout, with [100,140), [130,verified source end) and [0.413,8.621) cases. Expected counts are 1,200/1,920,000, 600/960,000 and 246/393,984 frames/audio samples, with complete-source evidence, exact selected PCM, telemetry, decoded output geometry/timing, resource limits and retained diagnostics. The plan permits at most 160 serial children, a 30-minute abort request, 27 GiB free-space floor and 2 GiB owned admission, not hard OS/write/exit guarantees.

Keep source frozen through actual closure and independent saved-output audit. Only then consider a separately source/report-bound service capsule and normal-service proof; native resize comes later. No approval file or media execution exists now, no fourth Keep720 native launch is inherited, and no old report can be repinned to bypass requalification. Preserve non-HDR ordering, Windows corrections, original style, ArchiveCQ29/defaults and benchmark pause; packaging last.
