# Keep preparation admission closed until owned receipts finish

## 1. Task Overview

Close a pre-existing shared service lifecycle gap found while replacing modeled workbench timing tests with executed base-class tests. The bounded change covers initial preparation and draft repreparation receipt waits: admission, cancellation, original correlation IDs and failure precedence. It also records independently verified acquisition of the existing pinned Electron dependency, without launching it. This is safety/continuity work supporting precise range Encode [Q2n] and integration [R], not a Remux completion claim.

Ahmed's active development authority and mandatory AI PBS/Git → immediate verified Notion → GitHub workflow remain in force. Blue's recorded lead configuration is GPT-6 Astra / Ultra. One source writer owned only `src/encoder-service.cjs` and `tests/encoder-service.test.cjs`; an independent reviewer examined the lifecycle design and patch. The lead integrated the scope and ran affected/broad checks. The Session writer owns only the cumulative session. No personal media, Gaming-PC operation or production activation occurred.

## 2. Context Used

Checkpoint 010 is preserved as local `1af9c682bda254cab04ec4e7d1ed88b76a5d9f61` and [Notion checkpoint 010](https://app.notion.com/p/41bbd7ade63b81fc81adc3eadf2cc5ec): all 522 files restored, full ten-commit bundle cloned and the complete 293,033-byte native session read back. Original-ancestry GitHub `c2046b05e5cb7ba495e15dcfe88f3bcb441ad814`, sole parent `8685c2f3d51e89c24fb3ec5ab8d549978172017a`, was verified at 16:51:04 UTC. All thirteen changed files matched exact bytes/hashes; its 904-file tree has 891 unchanged, eight modified, five new and no deleted files.

The [workbench integration report](2026-11-17_Candidate_Workbench_Integration.md) explicitly left actual awaited preparation and late callbacks unproved. Existing base tests already had real filesystem fixtures, diagnostics, deferred gates and output-grant actions, so the next work reused that harness rather than add a test-only production seam. Tests keep actual `prepareItem`, worker drainage, preparation and draft-edit methods intact; injected inspection does not run FFmpeg.

## 3. Work Performed

The first real `FILE_INSPECTED` await test found that cancelled initial preparation cleared its plan and plan ID but retained a ready-looking item. That trace showed stale presentation, not runnable authority. The corresponding draft-repreparation test already demoted the row. The initial expectation was then narrowed transparently to the actual non-runnable boundary so both tests could exercise captured old inspection callbacks after cancellation and during a fresh generation. Red evidence was retained.

A separate diagnostic held the actual initial `PREPARATION_FINISHED` call. It observed `busy=false`, phase `ready` and a live plan before the receipt settled. The test stopped at its first failed busy assertion; it did not execute overlapping Start or another preparation. Source review established the risk: readiness-based admission could let a new operation replace state while the old finalizer still had work to do. The old incident writer also resolved correlation after an await. Review then identified similar terminal-before-await exposure in initial and draft failure receipts. These were pre-existing shared paths, not defects introduced by checkpoint 010.

The scoped correction captures initial batch/plan IDs before asynchronous preparation and uses them for start/failure/final records. Initial finalization now reuses `finishPreparationReceipt`, retaining its original error message and item context. Initial and draft failure logging hold the busy preparing phase through their awaited record, retain the selected terminal result locally and enter finalization without an asynchronous admission gap. The helper retains busy admission through receipt persistence, then rechecks cancellation, revokes old authority and updates rows/draft state. Late cancellation does not relabel an already established shared failure as user cancellation. Original receipt history is followed by an explicit revocation record rather than rewritten.

No producer-map, raw-report, runtime pin, catalog/default, renderer, HTML/theme, preload or IPC change was made. Because shared `EncoderService` is in the exact candidate producer map, the existing candidate capsule now correctly refuses this changed source. That consequence is deliberate and visible, not fixed by weakening the gate. The earlier calibrated source and workbench remain recoverable in checkpoint 010. Fresh source-bound requalification is required before reopening the candidate on this revision.

## 4. Commands / Tools Used

The existing evidence wrapper ran Node v24.22.1 on Linux. The [receipt](2026-11-17_Preparation_Receipt_Lifecycle_Receipts.json) retains exact commands, timestamps, source identities and red/final evidence. Final V2 patch SHA-256 is `0bd20ede6f98d94aaf021c817c67d753b3ebe774a639938b834d3f512eb8ac7b`; shared service SHA is `5f1d0ed985bb82166f52b8498f69e72e30e018973f7c1ee361f745a26e643dc7` and test SHA is `2396154103fddf41bc00d10cdaf927871332e78c41c22e620b51eca0f4568208`. These identify the tested working-tree patch on checkpoint 010, not an already-existing commit.

The first lead affected run began at 16:56:53 UTC and took about 12.054 seconds. After the test-only V2 correction below, the final lead affected run began at 17:03:45 UTC and took about 12.438 seconds. It covered service, OutputAccess, main lifecycle, Remux, native-file and proportional service suites plus shared UI and IPC. The broad Linux run began at 16:57:05 UTC and took about 1.151 seconds. All recorded unchanged covered bytes during execution. The broad result is on the identical production source before the V2 test-only clock comparison change; it was not rerun merely to relabel that existing receipt. A separate read-only producer verifier explicitly returned the expected source-identity refusal without opening a runtime.

Later cloud inventory used supported environment attachment and desktop terminal discovery. It established an existing Linux/Xfce desktop, the same checkout and Node 24.22.1 via an absolute path. The ordinary executor's missing display variables did not mean no cloud desktop existed. No display/security settings were changed and Gaming-PC was untouched. The desktop still lacks the inspected NUMA node CPU map, so this discovery does not clear the earlier threading diagnostic caveat.

The approved project dependency workflow copied immutable package/lock inputs into an isolated helper directory outside the repository, ran `npm ci --ignore-scripts --no-audit --no-fund` (53 packages), inspected the pinned Electron installer, then explicitly ran only that installer with mirror/version overrides removed. The official npm tarball matches locked SHA512 integrity. Electron 44.7.0 Linux x64 ZIP matches its bundled checksum and independently downloaded official SHASUMS256; all 72 extracted files match ZIP bytes. Executable SHA-256 is `10a14d05c6ff4f94075cfb3eeb6ed6571be33ebcc08cbd675b5ce9ff84706564`, 228,605,256 bytes. The lead independently rehashed the ZIP and all 72 extracted files and compared each to archive bytes. It was acquired, not invoked. Native library resolution, sandbox launch and GUI behavior remain untested.

## 5. Verification / Testing

Six added tests traverse real base preparation lifecycle waits rather than manually emitted candidate snapshots:

- Initial and draft `FILE_INSPECTED` await: Start/new preparation remain busy, cancellation waits for the held operation, authority is cleared, then actual captured old progress callbacks are inert after cancellation and during a new preparation.
- Initial successful final receipt: Start, prepare and draft edits reject while held; cancellation waits; released completion revokes plan/draft/re-encode authority and preserves original finish→revocation ordering and IDs.
- Initial failed final receipt: late cancellation preserves the original shared failure and correlation.
- Initial and draft failure receipts: admission remains closed through the actual failure await, cancellation drains, original error/IDs survive and no newer plan can be admitted during that tested window.

The existing real-filesystem output tests also exercise service publication, private output-grant issuance, action dispatch through recorded host callbacks and changed-output refusal. They are not native file-manager or candidate-workbench GUI proof. No media child runs in these fixtures.

Observed results are not flattened into one green number. Baseline service tests were 75/76. The first added lifecycle run was 76/78; the final-receipt diagnostic run was 77/79. After correction, the worker affected suite was 169/170, then 170/170 after only a test whitespace edit. Final lead affected checks were **245/246**. The recurring pre-existing missing-source test expected `SOURCE_CHECK_INCOMPLETE` but observed `PROTECTED_SOURCE`; its expectation was not changed. The differing runs show intermittency, not a proven fix or an established cause.

Independent V1 repetition passed 80/82 and exposed a second test-only issue: comparing complete live snapshots also compared derived `elapsedSeconds`, which advanced from 0.005 to 0.006 while the reported state and revision were otherwise identical. That red deep-equality assertion failed before its following update-count assertion ran; the later passing V2 cases retained and passed those update-count checks. V2 excludes only that derived clock from the two callback comparisons and keeps every other field and update-count assertion. The original independent red log remains. Independent V2 repetition passed **81/82**, all six new lifecycle regressions passing and only the old diagnostic mismatch failing. Worker V2 results were 81/82 and 169/170; final lead V2 remains **245/246** with that sole baseline mismatch. The independent manual review found no remaining scoped blocker. No production source or unrelated test expectation changed for this correction.

Final broad Linux is **173 passed and 35 failed of 208**. All prior 27 failure diagnostics remain, with eight additional candidate producer/factory-dependent tests blocked by the now-changed shared hash. The exact additional names and unchanged prior set are in the receipt. The standalone verifier reported `CANDIDATE_KEEP720_SERVICE_SCOPE: Calibration producer changed: src/encoder-service.cjs`, without runtime opening. This source epoch therefore does not qualify the developer preview even though the scoped lifecycle assertions pass.

## 6. Problems Encountered

The first cancelled-ready row and the later ready-with-live-plan finalizer must not be conflated. The first was a display inconsistency with authority already revoked. The latter established an actual admission boundary being exposed before persistence finished; its potential overlap/correlation consequences were initially source analysis, not an observed destructive overlap. Post-fix tests execute explicit rejection assertions at that boundary.

The review widened the smallest correction from just the success finalizer to initial and draft failure receipts because those owned waits had the same admission pattern. It did not undertake a wholesale scheduler rewrite or claim every preparation variant and native lifecycle is now qualified. Tests use real base service/filesystem/diagnostics with injected inspection and a no-media runner; actual child cancellation, Electron and Windows native behavior remain separate.

The old candidate source gate becoming red is an intentional safety cost. Do not suppress those eight failures, change the producer map to the new hash while retaining old applicability, or substitute a portable report for original raw evidence. Fresh bounded calibration and normal-service proof must be tied to the new immutable source before a new candidate capsule is admitted. Historical results remain valid only for their original tested source.

Pinned Electron setup had no download/install failure. npm emitted a proxy-config warning and an update notice; no upgrade was performed. Official checksums and extraction equality do not establish successful executable loading or sandbox behavior. The existing desktop and dependency setup are later evidence, not retroactive corrections to the scoped observations recorded at checkpoint 010.

## 7. Documentation Impact

Update Current, prepend one full owner-format Session entry and add this execution report plus its receipt. Preserve the entire 293,033-byte prior session exactly and leave old correction receipts/archives untouched. The new session must retain the red discovery, scope change, intermittent baseline failure, fail-closed candidate cost and subsequent native setup facts. No runtime binary, original raw log or machine-private location is added to source records.

## 8. Git / Version Control Impact

At draft creation this six-path change is not committed or uploaded. Scope is the two reviewed source/test paths plus Current, Session and these two new records, expected 524 source files and eleven commits. No historical Planning/executor material or terminal-unknown old 35-file payload is replayed. The two Git histories intentionally differ: local reconstruction checkpoints and original remote ancestry are separately verified.

After final review, commit explicit paths, immediately restore the frozen source ZIP and full-history bundle in Notion, then publish the exact permitted GitHub delta with expected-SHA/non-force protection. Later external receipts own final hashes and completion. This is a recovery checkpoint of a scoped correction with candidate requalification outstanding, not a launchable new preview, release or owner acceptance.

## 9. Decisions Made During Execution

Use actual existing harness boundaries instead of expanding production injection surfaces. Preserve the first red and later more serious finding separately. Reuse the existing finalization helper, keep captured IDs and original error/item context, and protect failure awaits as well as success. Keep shared failure precedence through late cancellation. Do not change an unrelated intermittent test merely to produce green output. Preserve exact source gates and requalify changed code rather than repin history. Acquire the already-pinned Electron version through the documented official workflow, but stop before launch until new source/runtime prerequisites are satisfied.

## 10. Items That Need Human / Coordinator Review

No routine owner choice is needed for this in-scope correction or pinned dependency acquisition. Final independent patch review is complete without a scoped blocker; exact publication/PBS review remains a coordinator gate. Subsequent fresh calibration and service campaigns need their own immutable source/Notion gate, bounded launcher review, artifact ownership and actual outcomes. Native launch additionally needs verified library/sandbox compatibility without security-setting changes or unsafe fallback flags. Ahmed retains release/acceptance; no earlier source or installation permission implies that qualification already passed.

## 11. Current Result

The bounded preparation receipt correction is implemented and source-tested; actual receipt waits now retain admission and cancellation/correlation assertions pass in the affected suite. Final independent V2 review found no scoped blocker and repeated all six new regressions successfully, while retaining the one old diagnostic mismatch. The pre-existing intermittent missing-source diagnostic remains, and broad Linux has 35 failures, including eight deliberate source-gate refusals. The changed candidate is unavailable pending fresh qualification. Electron is byte-verified locally but not run. No new media/native proof or default/catalog activation occurred.

## 12. Recommended Next Step

Finish the six-path publication/PBS review and Git → verified Notion → GitHub checkpoint. Then freeze the newly committed source and run a separately reviewed bounded candidate calibration using the exact existing runtime, new report location and unchanged resource limits. Independently audit the result before updating any candidate evidence capsule. Follow with the bounded real normal-service consumer proof before native workbench media. Preserve every old report and source epoch. Verify Electron loading/sandbox and the existing desktop route without weakening security. Continue the agreed remaining 0.7 geometry/audio/container work separately; HDR expansion remains deferred and packaging last.
