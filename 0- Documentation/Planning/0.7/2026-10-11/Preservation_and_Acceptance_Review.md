# 0.7 preservation and acceptance review — October 11, 2026

**Current status: planning only; all 0.7 work awaits Ahmed's plan review. No N/O milestone or candidate acceptance is granted by this appendix.** The latest owner direction pauses execution. Earlier files named Approved Goal, implementation contract, bootstrap, Current State and Continuation still contain execution instructions; those are preserved historical state, not permission to launch work now. Do not discard their useful unfinished changes or silently rewrite the evidence as accepted.

Human product authority: Ahmed. Strategic review: Ahmed/Blue. Review role: independent Codex media/trust preservation reviewer. Surface: local planning/preservation, read-only inspection except this appendix. Observations made October 11, approximately 04:01–04:05 UTC. This records the observed working tree; subsequent parent documentation synchronization may add documentation changes.

## 1. What is preserved

| Reference | Live observation | Interpretation |
|---|---|---|
| Working branch | `codex/v0.7-candidate` | Preserve it and its uncommitted changes; do not reset to the accepted application |
| HEAD | `8bac91f5647bc1e3d54e0920749fbf990fea59cd` | Documentation checkpoint preserving reviewed plan and prior execution contract, not candidate acceptance |
| Protected benchmark branch | `codex/pre-0.7-benchmark` → `c08e117256d93371871c481d3ca56468fe10fbec` | Still the separate visual-review preservation checkpoint |
| Accepted 0.6 | `local-v0.6.0` → `be92b12205d299b6d3bdcc2fd4b2e3a02f928862` | Accepted baseline remains recoverable |
| Accepted 0.5 | `local-v0.5.0` → `f3efdeb47531106a740efb55299c5251b9a7a505` | Earlier accepted baseline remains recoverable |

The accepted application paths (`main.js`, `preload.js`, `src/`, `ui/`, package/runtime records) had no application drift between accepted 0.6 and benchmark checkpoint c08e117. Research scripts, research tests and documentation did change on that research branch. **The current working application is now different from accepted 0.6** because unfinished 0.7 edits exist. A statement that all current production paths still equal accepted 0.6 would be false.

Accepted release files were inspected by path/metadata only:

- `out/portable-2026-09-23T21-19-15-055Z-196Mpn/zip/FFmpeg-Encoder-0.6.0-win32-x64.zip`: present, **321,231,543 bytes**, last-write September 23 at 21:19:42 UTC. Existing accepted SHA-256 record: `3b7c72ea3252dd9c3fff2d83227e3b5b04badf642b748c606063e339ead6f5bb`.
- `out/FFmpeg-Encoder-0.5.0-win32-x64.zip`: present, **321,189,914 bytes**, last-write September 8 at 09:43:43 UTC. Existing accepted SHA-256 record: `a984e102f1cf404239690e709f585d33028f851bc3e66d914e41f43d334a517f`.

Hashes above are reused from the [accepted release evidence](../../../Execution%20Summaries/2026-09-24_Portable_0.6_Evidence.json), not fresh integrity verification. No ZIP was opened, rebuilt, moved, changed or fully hashed in this review.

## 2. Actual unfinished work, categorized

Git reported no new implementation commit after 8bac91f. The following tracked changes remain unstaged/uncommitted; preserve their actual contents.

| Category | Paths | Meaning and current limit |
|---|---|---|
| Candidate/data isolation | `.gitignore`, `package.json`, `package-lock.json`, `main.js` | Version is now `0.7.0-alpha.1`; development data default is `data-next-0.7`. This is unfinished development, not an accepted package |
| Diagnostics boundary/lifecycle | `main.js`, `preload.js`, `src/ipc.cjs`, portions of `src/encoder-service.cjs` | Named read/history/export-preview APIs, incident integration and shutdown changes. Native proof remains pending |
| Completed-output/source policy | `src/source-identity.cjs`, `src/outputs.cjs`, relevant `src/encoder-service.cjs` portions | Bounded ctime-only warning/publication and retained-stage distinctions. Direct evidence exists; native lifecycle/owner-visible acceptance is not established |
| Inspection normalization | `src/inspection.cjs` | Expanded typed evidence and cache-policy version changes; not hardware/HDR/remux implementation |
| Existing test changes | `tests/encoder-service.test.cjs`, `tests/inspection.test.cjs`, `tests/outputs.test.cjs` | Tests were changed alongside the unfinished contracts; their existence is not acceptance |

Untracked implementation/evidence-support files also exist: `src/diagnostics.cjs`, `src/media-evidence.cjs`; `tests/completed-output-retention.test.cjs`, `tests/completed-source-policy.test.cjs`, `tests/diagnostics-service.test.cjs`, `tests/diagnostics.test.cjs`, `tests/media-evidence.test.cjs`; `scripts/v07-baseline-reproduction.cjs`, `scripts/v07-native-foundation-smoke.cjs`; [shared contract26](../../../26_0.7_Shared_Contracts.md); and the existing planning directory. They must be included in recovery reconciliation before any future approved continuation. Do not lose them through a tracked-files-only stash or assume HEAD contains them.

No tracked runtime-manifest, `ui/`, or protected benchmark script/protocol/review-guide/pause-record changes were found relative to c08e117. Package dependency versions remain Electron **44.2.0**, Playwright **1.63.0**, Packager **20.3.0**. Installed Electron package metadata reports 44.2.0; the shipped binary manifest still records FFmpeg/ffprobe **9.0.1**. Release-discovery JSON is research, not proof that a runtime update was downloaded, installed or tested. Binary hashes were not rechecked here.

## 3. Existing evidence: what it proves and does not prove

All paths in this table are under `artifacts/v0.7/baseline/`. These are existing private artifacts read in this review; no checks were executed again.

| Artifact | Recorded result | Evidence limit |
|---|---|---|
| `direct-tests.txt` | 269 passed, 0 failed; 18.630 s | Isolated accepted-0.6 direct baseline. Historical Git-dependent tests were excluded. Not new native UI/hardware evidence |
| `o-integration-tests.txt` | 70 tests: 27 passed, 43 failed | Historical integration failure involving diagnostic version validation. Preserve the failure, do not count it as green |
| `o-integration-tests-r2.txt` | 70 passed, 0 failed; 9.255 s | Corrected focused direct run, not all future feature coverage |
| `o-integrated-direct.txt` | 204 passed, 0 failed; 9.780 s | Integrated direct subset. Overlaps other runs; do not add counts into a fictitious distinct-test total |
| `diagnostics-service-tests.txt` | 5 passed, 0 failed; 0.597 s | Focused service/diagnostics integration, including failed-start retry and removal of new unbounded duplicate batch logs |
| `reproduction-8d90699c-b078-43b3-9a1d-ed9ac9aae313.json` | Completed accepted inspection/builder reproduction on five supplied files; all recorded before/after bounded identities matched | Accepted production modules and bounded ffprobe, not Electron UI or an encode; does not establish an unidentified historical laptop error |
| `expanded-native-inspection.json` | Five cases, explicitly `bounded native metadata only`, observed 03:58:32 UTC | Actual ffprobe metadata through the evolving normalizer; not decoded output/HDR appearance/remux acceptance |

The accepted-runtime reproduction records the supplied iPhone file as `UNSUPPORTED_HDR`, the three numbered MP4s as `AMBIGUOUS_COLOR`, and the Resolve-origin workshop as `UNSUPPORTED_STREAM`. These identify current reproducible policy barriers. They do not prove missing tags caused Ahmed's historical episode failure, or that the Resolve input decoder is broken. Preserve the separate cases and exact evidence.

The native foundation harness has only been authored and syntax-checked in the earlier work. **It has not been launched.** At inspection there was no `artifacts/v0.7/native-foundation/` report directory, no `artifacts/v0.7/media-job.lock`, and no entry in owned F: staging. A read-only Windows process query found no `ffmpeg.exe`, `ffprobe.exe`, `electron.exe` or `node.exe` whose command line identified this project/owned 0.7 root. This is a point-in-time scoped observation, not a global machine-idle guarantee or historical proof that no tools ever ran.

No 0.7 portable candidate or native acceptance report was found. Future real capability checks, renderer-crash/startup-quit tests and screenshots remain pending and are **not authorized by the present planning direction**.

## 4. Pending code/evidence issues for a later approved implementation

Earlier review findings led to visible code changes: capability state preserves diagnostics; failed durable session starts returning `persisted:false` retry; preparation failure reason codes are retained; bounded export now carries source assessment/disposition and aliased identities; pagination has a composite cursor; diagnostic recovery checks aggregate storage; new duplicate legacy batch logs were removed; renderer loss records a failed-session reason; early quit uses a shared shutdown path. These are source observations, not native verification or milestone acceptance.

Remaining concrete review points:

1. **Per-file inspection stderr is still lost.** `src/encoder-service.cjs` around lines 494–508 saves the caught code/message but does not pass that file's ffprobe stderr, exit/signal or invocation correlation to `FILE_INSPECTED`. This matters for malformed-media failures caught as unsupported within a mixed batch; the outer preparation failure hook does not run for them. A future bounded per-file incident should preserve the actual child failure evidence, with private raw stderr excluded from default sharing.
2. **Startup rejection retry differs from false-result retry.** `initializeDiagnostics` clears a resolved `persisted:false` promise, but a rejection from the preceding `fs.mkdir` remains cached. Test the rejected-start case separately before claiming all transient initialization failures recover. Existing five-test evidence must not be stretched beyond its exercised branches.
3. **Redacted structured truncation should remain visible.** The journal records `contextTruncated`/`messageTruncated`, but `redactEvents` omits those flags while retaining reduced context. Exports already carry logging gaps and stderr truncation. Preserve safe completeness flags too so a support reader does not mistake truncated structured evidence for a complete record.
4. **Native shutdown/source-retention evidence is absent.** Current source ordering is plausible; the unlaunched harness is not evidence that Chromium, owned children, windowless quit, crash diagnostics or retained complete outputs behave correctly on the actual runtime. Native fixtures and protected-source tests belong to later authorized execution.
5. **No current UI exposes the proposed Activity/Settings support contract.** The diagnostics preload methods are a foundation, not delivered user-facing history/export or future workbench acceptance. Likewise, expanded metadata does not implement HDR transforms, vendor adapters, ranges or remux.

This is a bounded independent review, not a repository-wide security certification. Do not change code to resolve these points during this planning pause.

## 5. Separately paused benchmark

The live benchmark state was read through selected status/accounting fields only; the randomized reveal key and candidate mappings were not opened or changed.

- Stage and human-review status: **`awaiting-calibration-judgment`**.
- Finalists: **null**. No new owner quality judgment was supplied.
- Invocations: **139 used; 201 remaining of the 340 ceiling**.
- Active-time ledger: `open=null`, accumulated **12,603,640.1433 ms**, limit **43,200,000 ms**, recorded remainder **30,596,359.8567 ms** (about 8 h 29 m 56 s).
- The existing pause record explicitly qualifies unmetered reconciliation/closure work; that remainder is not a perfectly complete wall-time claim or a promise that two finalists fit.

The [single benchmark pause/resume record](../../../21_Phase1_Pause_Resume.md) remains its authority. Existing six-scene assets, their prior hash/frame evidence, Desktop review shortcut and Chrome/MPC-HC entry are reused, not rebuilt or retested here. The user's next benchmark action remains visual judgment beginning Crimson Desert, Expedition 33 and Forza; scene letters differ. No winner/finalist freeze/held-outs or new recipe default is inferred from this planning review.

## 6. Resource and future acceptance gates

The existing `artifacts/v0.7/ownership-ledger.json` was observed at 03:53:51 UTC. It records 534,342 bytes/58 files in owned fixtures, no owned downloads/outputs/staging then, 1,376,984 bytes/six private evidence files, zero binary/media downloads and no media encodes. **Its private-evidence allocation is now stale**: more test/probe transcripts exist. It must be refreshed before a future expensive action; do not call it complete current accounting. Other work is explicitly unmetered, and no remaining development-hours entitlement can be derived from the ledger.

Retain the latest planning resource decisions: D: has a separate 25 GiB free-space safeguard; the old 24 GiB total-growth/F:25 GiB reserve acceptance gates were superseded. F: uses actual free-space/peak forecasts and a sensible margin. The 6 GiB fixture-download allowance is a ceiling, not a target. Runtime downloads are separately visible. 25 megabits/s is approximately 3.125 megabytes/s before overhead; the recorded 327,265,285-byte proposed runtime transfer has a theoretical minimum about 105 seconds, not a promised elapsed duration. No downloads are authorized now.

For later approval, maintain these milestone gates without treating a plan, mock or successful process exit as product acceptance:

| Future area | Required implementation/verification evidence | Security/resource/acceptance gate |
|---|---|---|
| Shared contracts and state | Resolve active authority; precise app→batch→file inheritance, immutable prepared plans, requested/effective audio/range contracts and versioned data isolation | Independent contract review plus parent synchronization; all current 0.7 work remains unaccepted |
| Diagnostics/source disposition | Retried logging failures, private/redacted bounded history, per-file child evidence, normal/crash/early-quit native session closure; ctime-only valid output warning, observed mismatch/incomplete/collision/cancel distinctions | No globally weakened cache/grants; no arbitrary path/process IPC; owned-only retention/cleanup; budget retained stages and export data |
| Compatibility and normalized evidence | Independent Resolve/numbered-source outcomes, stream relationship retention, uncertainty/malformed negative cases, named per-file ancillary decisions | No guessed missing color, silently dropped data or fictional historical root cause; originals stay read-only |
| Runtime trials | Separate Electron and paired FFmpeg/ffprobe official provenance/hash/relevant regression checkpoints | Preserve accepted runtime/ZIPs and benchmark tools; reversible state; recheck downloads/peak space before a later authorized trial |
| Vendor/HDR scope | Native-semantic builders and mode/device capability cells; local CPU/NVIDIA PQ/HLG/SDR output validation; bounded iPhone HLG/DV-aware evidence and mebx decisions | No silent backend/RC/SDR fallback; real AMD/Intel and suitable HDR-display evidence stay separately unverified |
| Geometry/range/remux | Rational orientation/SAR dimensions; decoded requested/effective A/V boundaries, delay/padding/sync; positive/negative container/stream matrix and provenance | No hidden resampling/downmix/crop/upscale/FPS change/transcode/drop; packet-copy is an explicit distinct mode; TS is input, not a required output target |
| Workbench/Settings | Accessible expert controls, actual defaults/inheritance, durable history, accurate runtime/help, native keyboard/resize/navigation evidence | No restored omission/re-encode authority or mutation of frozen jobs; intermediate self-QA does not become repeated owner-approval blocking |
| Candidate qualification | Fresh isolated portable artifact, exact version/path/hash, relevant cross-feature/local/offline/restricted-PATH/persistence/lifecycle results and independent requirement review | Candidate is not accepted `local-v0.7.0`; missing hardware/display/independent-machine/owner evidence is stated, not passed |

Use pairwise plus explicit high-risk combinations, reuse valid surviving evidence, and reforecast materially expensive work. One real media job at a time applies only after execution is authorized. The paused benchmark ledger is separate and cannot fund 0.7 tests.

## 7. Corrections the renewed plan must make explicit

The preserved [plan22](../../../22_Reviewed_0.7_Technical_Plan_2026-10-11.md) contains historical alternatives/defaults. A new reviewable plan should reconcile them once, without competing histories:

- Current mode is planning only. The names/status text of documents23–26 and the earlier bootstrap cannot self-authorize execution or imply N/O completion.
- Non-full Encode's precision-oriented audio re-encode default and dedicated App Settings supersede old copied-audio/help-only placements. A universal 100 ms precision target is not justified.
- The older fixed F: growth/reserve table is superseded; the separate D: safeguard and bounded fixture acquisition remain.
- Old wording requiring repeated Ahmed reviews at intermediate stages is not the later autonomy model. A future execution Goal may authorize internal previews/QA while final owner acceptance remains separate.
- “Current working code,” “accepted release,” “implemented,” “directly tested,” “native qualified” and “owner accepted” must be different labels. In particular, 204 direct checks and five diagnostic integration checks do not close O or qualify a candidate.
- Current runtime numbers are observations. Proposed maintenance versions require live official verification and an independently testable trial in a later authorized phase.
- Qualified HDR signal/metadata/decode output does not establish perceived HDR appearance. Likewise source-relative metrics do not replace the benchmark's owner judgment, and bounded source checks do not establish whole-file equality.

## 8. Exact re-entry

For the current planning task: use this preserved delta, existing media/protocol evidence and pending findings to finish the reviewable plan. Do not launch the native harness, rerun tests, acquire corpus/runtime files or change product behavior.

After a separate explicit execution approval: reconcile live Git/status, all untracked files, newer owner amendments, artifacts and the then-current ledgers; preserve accepted releases and the benchmark gate; update the implementation/requirement tracker truthfully. Resolve concrete direct gaps, then give the native harness a coordinated media slot only when its target runtime and current expectations match. Resume unfinished work rather than rebuilding the baseline or replaying the accepted benchmark.

Read-back verification for this appendix is limited to content, references, Git state and existing records. No source media, answer key, accepted artifact, benchmark ledger, application code or runtime was modified by this preservation review.
