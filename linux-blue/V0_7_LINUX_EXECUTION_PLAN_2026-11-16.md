# FFmpeg Encoder 0.7: Linux development execution plan

Status: proposed executable plan for coordinator review, 16 November 2026. This is a separate planning artifact, not a claim of completed product qualification, a new release, or permission to bypass an upload refusal.

## 1. Goal and finish line

Deliver a usable Linux 0.7 non-HDR candidate using the existing encoder, remux engine, workbench and approved design. Implement the portable requirements so Windows can reuse reviewed changes later. Preserve existing vendor code, Windows evidence and historical failures. Finish with a cleanly recoverable GitHub source branch, repeatable runtime setup, final-source evidence for every applicable requirement, a tested Linux package and one precise owner-review handoff.

Three distinct gates prevent misleading completion claims:
1. **Development complete:** applicable non-HDR software and real application workflows work; unsupported cells have specific truthful reasons, not arbitrary short-clip ceilings. A required in-scope non-HDR software feature is not complete merely because the app refuses it: its required ordinary must-accept paths must work. Only genuine platform/hardware limitations or owner-agreed deferrals may remain explicitly unqualified, without being counted as completed requirements.
2. **Linux candidate qualified:** exact final source/runtime/package bytes pass the applicable matrix, fresh-clone recovery, native journeys and independent review. Missing GPU/Windows evidence is visible, not counted as passed.
3. **Owner accepted:** Ahmed reviews the exact candidate. This is not implied by a push, merge, test count or this plan. Original Windows 0.7 cannot be declared complete solely from Linux qualification.

No HDR expansion, accepted 0.5/0.6 changes, Archive CQ29/default recipe changes, benchmark continuation, unrelated redesign or public release is included.

## 2. Sources and conflict resolution

Read in full: Claude's 126-line November 16 response, materialized as `planning-inputs/Pasted text(20261116-185839).txt`, SHA256 `b11cb6da007a94ae6f97c2668e35d972c6f4788da54baec884c7ea0ab6b992a8`. The roadmap HTML is a secondary presentation snapshot, not current execution authority. Its internal dates precede the latest pause and owner amendments.

Engineering sources: original records 10 (Continuation), 25 (all 43 requirements), 30 (UX), 32 (final QA before packaging), 33 (non-HDR amendment), 47 (Q plan and November decisions), 50 (November 15 handoff), current source and Linux `linux-blue/*CHECKPOINT.md` receipts. Record 25, not record 33, contains the full 43-row matrix.

Precedence: current explicit owner direction → latest dated implementation/pause evidence → surviving requirement text and decisions → Claude advice → older roadmap graphics. Do not overwrite historical records to make this order appear retroactive.

Corrections to the HTML: Gauge is approved; QD1/QD2 are decided; 4K/1440p work belongs in 0.7; Q2j is not complete. Do not import completion percentages or old duration estimates. Claude's suggestion to ask again about a Linux runtime is superseded by Ahmed's explicit Linux development/tool authority; actual qualification and any separately required security permission remain necessary.

## 3. Honest starting position

This is a point-in-time baseline. Re-read HEAD and receipts before implementation; an active lead is working while this document is drafted.

- Original Windows candidate: `1b9838a`, plus reviewed but uncommitted corrections. Q2j comparison ended at 1,340/1,704, 364 remaining, policy-ID question unresolved; R4 candidate proof is not integrated. Do not reset or claim closure of that corpus from Linux samples.
- Local Linux baseline inspected during drafting: `c9761cf` Gauge integration. It uses the approved existing currentColor header geometry and midtone PNG; both themes were natively checked. Windows wiring is not implied.
- Coordinator's latest remote receipt: `3f5e4c5d1e0a0071ef3522aef33da3c5d6a45579` on `CipherVaults/FFmpeg-Encoder-Blue-Linux`, `blue/linux-development`. Reverify remote identity/equality before recording a new push.
- Ordinary CPU Full/Keep SDR, source inspection, original workbench, settings/search/selection, bounded remux/AAC/multitrack examples and source/cancel/publication guards have local evidence. They do not close full Q/R rows or prove all are runnable from a fresh clone.
- Shared remux dependency versions currently missing remotely: `src/remux-operation.cjs`, `src/remux-native-cues.cjs`, `src/operation-runtime.cjs`. Remote remux gate deliberately refuses mismatching bytes. Resolve publication eligibility through the coordinator's supported route, not a renamed payload or alternate account.
- Baseline FFmpeg 7.1.5 refuses the changed trim path because decoded frame durations are absent. Keep that failure. Separate official-source 9.0.2 candidate passed three frozen strict trim calibration cases, 34/34 children closed, but is NOT the app runtime. Candidate configuration currently enables x264/x265, not an assumed AV1 replacement.
- Lead update received during drafting: local HEAD `8e0365fa789c60b2d34a4e198bf91c3838305a5a` completes the developer-only exact-fixture EncoderService proof: three published trims (15/62/60 frames; 24,000/99,552/96,000 samples), active cancellation with no publication and retained unbound partial, fresh post-cancel job, pre-encode collision and scope refusal; 94/94 children closed, 19 tests and independent PASS. This does not activate the app or establish broad/long-file qualification. The exact four new files initially were denied publication for unrecognized concrete owner approval. After the authenticated owner explicitly approved those four files, the same-tool retry succeeded at remote `3f5e4c5d1e0a0071ef3522aef33da3c5d6a45579`, parent `5893925`; exact changed paths were verified and check runs were zero. This publishes the developer proof, not all dependencies or app activation. Do not duplicate this completed proof.
- Local and remote source parity, fresh-clone execution and complete off-machine recovery remain open. A remote checkpoint alone is not backup proof of all useful work.

## 4. Architecture and environment contract

Keep one coherent development line, not a second sanitized product implementation. Original source modules remain the shared engine; Linux-only launch, paths, storage, runtime discovery and packaging live behind explicit platform adapters. Renderer requests bounded typed operations; main/service validates and freezes plans; validators inspect actual output before publication. Never replace independent evidence with FFmpeg exit status or encoder telemetry alone.

Actual environment observed during this plan: Linux 6.18.57 x86-64, glibc 2.41, Node v24.22.1, 9 reported CPU slots, 9.7 GiB total memory and approximately 57 GiB free workspace storage. These are observations, not guaranteed reserved capacity. Electron 44.7.0, sandboxed native workbench previously launched, baseline FFmpeg/ffprobe 7.1.5 and separate source-built 9.0.2. Record actual Node, OS, libc, display, CPU/memory/disk and runtime build/config versions at each qualification campaign. No NVIDIA/Intel/AMD device or Windows compatibility VM is assumed.

Runtime activation work must establish paired executable provenance, supported codecs, owned storage, executable identity/currentness, no silent fallback and rollback to baseline. Workspace before/after hashing alone is not a production trust boundary. Preserve official source signature/hash and build recipe; current pins identify one build, not promised bit-reproducibility elsewhere. Record architecture and dynamic dependency requirements. Do not distribute the GPL-enabled FFmpeg build until corresponding-source, notices and packaging compliance are satisfied.

Linux seams to test explicitly: case-sensitive/non-ASCII names, symlinks and source identity, filesystem free space and publication semantics, no-shell process execution, process-group cancellation/timeout/drain, native picker, sandbox, xdg output reveal, font fallback and unavailable GPU inventory. Keep platform-specific policy separate from media math. Never translate a Linux pass into Windows path/job-object/taskbar or hardware evidence.

## 5. Work packages and executable order

Only one integration writer and one heavy media campaign at a time. Independent reviewers may inspect without changing the active checkout. Each package exits with a user-visible result, exact-byte tests, a short PBS update, commit and verified allowed push; if push is blocked, disclose the precise unbacked files while continuing independent safe work.

### E0 — Establish recoverable baseline and live goal
**Now, following the completed bounded trim proof.** Inventory local/remote branch tips and tracked/untracked source; classify required source/PBS versus generated media, binaries, credentials and private raw evidence. Reconcile the three missing shared dependencies with supported publication review. Commit this plan and its traceability appendix only after review, without staging lead WIP. Record exact next slice and stop/decision boundaries in Linux PBS.
**Exit:** remote readback plus fresh clone can reconstruct the claimed supported baseline, or an exact blocked-file ledger honestly limits recovery claims. Do not leave backup as an invisible optional chore; a persistent blocker deserves prompt owner status and a normal authorized resolution, not repeated blind retries.

Shared-platform continuation: follow the source-closure and immutable handoff steps in [the shared Windows/Linux plan](SHARED_WINDOWS_LINUX_DEVELOPMENT_PLAN.md). A fresh remote checkout must expose missing dependencies rather than silently borrowing local files or recreating restricted content.

### E1 — Qualify the corrected runtime through the actual service
The bounded service proof has passed; preserve its failures and results without replay. Next choose explicit narrow app activation after independent review of runtime ownership and capabilities. Run real prepare/start/publish, active cancel, stale plan, invalid output and collision cases through existing EncoderService; confirm no child/handle/stage leak and no source mutation. Capture native UI timing/result disclosure with the activated route. Compare unchanged ordinary CPU/remux behavior. Preserve the currently supported AV1 path explicitly: the x264/x265-only 9.0.2 candidate must not replace its working baseline route. Keep paired runtime selection and route ownership explicit until an AV1-capable candidate is separately built and qualified; no silent fallback or removal of supported AV1.
**Exit:** candidate is either deliberately integrated with rollback and native proof, or remains separate with a specific blocker. Three calibration fixtures alone cannot exit this package.

### E2 — Close inherited Q2j dependencies, then MP3 copy
Read the eight Windows corrections and policy-ID discussion; integrate only reviewed portable changes under legitimate source-publication rules. Reconcile completed versus missing corpus cases. Run accessible remaining evidence or mark unavailable original-media proof as Windows follow-up, never invent it. Qualify TS program/stream relationships, MP4/MOV playback metadata and seeking on actual supported routes. Then add exact MP3→MP4 copy with the Apple compatibility warning.
**Exit:** independently reviewed portable source, ordinary valid and invalid cases, seek evidence, precise corpus ledger and actual service output. Preserve unresolved Windows-specific corpus gaps separately. These gaps may not block independent Linux Q2n work if the reused reader/validator seam is independently reviewed and qualified; document the dependency exception rather than calling Q2j complete.

### E3 — Q2n: usable trim and whole-file resize, not a short demo
Reuse Q2i/Q2o streaming verification and existing builders. Read-only implementation mapping from the pilot reviewer identifies existing `operation-contract.cjs` output boxes/aspect-fit/no-upscale/even-dimension/SAR logic and `encode-operation` rotation/scale/SAR construction and geometry validation. Streaming line/spool/PCM/telemetry seams already exist. Inspect and reuse these rather than building another resize or verification framework. The initial widening target is existing family admission, collector source-policy whitelist and fixed changed-encode budgets (currently narrow resolution/cadence/duration/size/selection envelopes), each widened only with corresponding evidence. This is reviewer-reported code mapping, not new qualification. Remove old 0.5–30s trim and 10–31s resize restrictions through bounded-memory streaming and proportional resource accounting, not by disabling validation. Implement per-file Full/range, handles + exact fields, explicit batch apply; original size and single 2160/1440/1080/720 outputs with orientation/SAR/DAR respected and no upscale/crop/stretch/FPS or deinterlace surprise.
Test start/end/both/late/open-end ranges, variable frame cadence, audio delay/padding, 8/10-bit SDR, 1440p and 4K source downscales, portrait/non-square pixels and long ordinary files. Keep full-source and output identities, exact requested/resolved/kept boundary disclosure and independently frozen numerical criteria. QD1 packet-edge copy shows exact differences. QD2 crossing subtitle cues clip and list changes. QD3 ASS+resize refuses with reason. Integrate subtitle transformations when their qualified Q2m prerequisites exist; don't promise them from plain video proof.
**Exit:** real native trim/resize and held-out long/full-size files work with bounded memory, cancellation and truthful timing; synthetic tests accompany rather than replace those files. If real-media rights/availability is missing, name the exact corpus gap and continue eligible implementation without claiming completion.

### E4 — Q2k audio policy and Q2l expansion
Measure MKV→MP4 options D exact copy, B disclosed timing shift, C audio re-encode, omit. Preserve per-track identity, priming, tail, timing/layout differences. Retain the recorded measured preference D if achievable, otherwise B, but present actual trade-offs to Ahmed for the **default**; implement explicit non-default options and UI while waiting. Do not invent his default decision. Then qualify more sample-rate/channel/layout combinations and multiple audio tracks with real files per shape. A failed AAC→MKV priming case stays a refusal until genuine correction/evidence exists.
**Exit:** settings explain available/disabled options, file override and result choice; exact-copy accepted tracks match decoded audio; transformed tracks explicitly state transformation and validate it under their distinct policy. No silently mixed exact-copy and re-encode claims.

### E5 — Q2m, Q2h, Q2f and portable vendor checking
Q2m preserves supported subtitles/chapters, clips/rebases qualified trimmed cues and chapters, and gives specific unsupported-container reasons. Q2h adds default-OFF Quick copy with a themed warning and permanent result label **Quick copy, not verified**; it keeps all tracks and preserves source/publication/collision safety even though media-content verification is bypassed by explicit mode. Q2f completes both 44.1 kHz mono/stereo and 48 kHz mono AAC trims alongside the existing 48 kHz stereo path, subject to each qualified policy, with delay/padding disclosure.
Keep AMF/QSV/NVENC adapters and software capability-state/currentness checks; complete missing portable software seams. Implement the approved cheaper O4 output-check policy (the roadmap task label O4 is not requirement row O04) without claiming hardware timings or same-component AMF producer proof. Hardware absence is not an excuse for missing software, nor a reason to fabricate execution.
**Exit:** real CPU/container flows and negative tests; GPU status explicitly discovered/untested/unavailable/stale, never synthetic 'verified'. AMF producer disposition remains an owner/technical gate.

### E6 — Independent verifier tool and measured optimization
Build a test-time comparison tool using ordinary/held-out files: fast verdict versus independent full decode, checking false acceptance and false refusal. This is not a second user-facing deep mode. Freeze verdict corpus before optimization. Measure fixed/per-GB time, peak memory and cancellation latency. Treat 3s fixed + 6s/GB as the recorded target and old 4s + 18s/GB as historical, not measurements of this host.
**Exit:** any accepted optimization has before/after evidence and unchanged verdicts/quality; missing target is reported rather than weakening checks. Stop optimizing when the bounded pass produces useful improvement or a measured bottleneck needing separate scheduling.

### E7 — R product integration
Finish all eight R rows: dedicated workspaces/settings and inspectable preview; app→batch→file precedence; atomic versioned migration/corruption/reset; frozen queued/running plans and draft invalidation; expert options/help/canonical actual argv; complete keyboard/focus/exact slider alternatives/640×480/reflow while jobs run; actual versions/licences/credits/reviewable diagnostics; nonpersistent generated-reencode/omission permissions.
Reuse existing six-tab shell, theme tokens and selected Gauge bytes. No new layout choice is needed to finish current design; record 30's three alternatives remain unchosen. Gauge square remains amber in both themes; test existing Linux font fallback and native window/desktop behavior. Saved UI improvements are partial R evidence, not an excuse to rebuild them.
**Exit:** actual native source/destination picker, prepare/inspect/encode/remux/results/open, queue edit isolation, navigation during work, settings restart and error/recovery journeys; both themes and narrow layout inspected. Resolve concrete usability defects, not speculative redesign.

Shared-platform continuation: preserve one shared product/UI and explicit target compositions as described in [the shared Windows/Linux plan](SHARED_WINDOWS_LINUX_DEVELOPMENT_PLAN.md). Linux service/native evidence is not Windows runtime, dialog, filesystem or vendor qualification.

### E8 — S final-source qualification, then packaging
Freeze candidate source; run proportionate full direct regression and cross-feature ordinary/negative/security/lifecycle matrix. Review all 43 rows independently, including false-refuse questions and deferred/platform-limited dispositions. Fix findings and rerun affected plus required aggregate checks on final bytes.
If packaging, configuration, dependency or code fixes alter final source after the freeze, assign a new source identity and rerun affected final-source checks plus required aggregate regression before requalifying the package. A prior freeze cannot qualify changed bytes.

Then create a Linux portable archive first as a bounded development deliverable, with isolated application data, runtime provisioning/notices and explicit platform support. Qualify extracted build with different cwd, restricted PATH, offline operation, restart, source protection and cancellation. A further Linux installer format is a separate documented choice, not an excuse to skip the usable archive; retain Windows installer and portable requirements as Windows-only unfinished evidence. Obtain owner agreement before redefining the original S03/S05 product acceptance wording or Linux distribution commitments.
**Exit:** exact version/source/runtime/package hashes, test receipts, known limitations, rollback and restore instructions, Windows-transfer map, one concise owner checklist. No automatic accepted release, signing claim or public publication.

Shared-platform continuation: the current Windows packager excludes Linux adapters and asserts Windows runtime details. Use the staged target preflight and explicit Linux entry/dependency allowlist in [the shared Windows/Linux plan](SHARED_WINDOWS_LINUX_DEVELOPMENT_PLAN.md); do not change only its platform flag or infer Windows acceptance from a Linux build.

## 6. Test and evidence policy

At entry to each slice: record base commit, dirty files, exact affected requirements, supported input family and one expected user-visible outcome. Read repository scripts before execution. Current existing commands include `npm test` (`node --test tests/*.test.cjs`) and `test:app`, `test:lifecycle`, `test:protocol`, `test:product`, `test:layout`, `test:profiles`; inspect platform assumptions before treating them as Linux runnable. Linux additions use `node --test linux-blue/<affected>.test.cjs` and their documented native/media runners. Never run every broad media script blindly.

Evidence ladder: pure/deterministic checks → independent review → real media through actual service → native UI journey → held-out ordinary and must-refuse files → fresh clone/package. A higher stage does not erase earlier failures. Record passed/failed/skipped/unrun separately; do not add overlapping test counts. Source changed after a run invalidates a claim for final bytes unless rerun/review establishes the applicable scope.

For every actual media campaign: bounded CPU/disk/time/concurrency chosen to match file duration, full owned child close/EOF and sink settlement, source before/after identity, retained failure receipt, cleanup of owned disposable outputs only. Arbitrary short-file ceilings may be temporary admission guards, not the delivered 'any length' feature. Cancellation must remain responsive at every stage of long work.

## 7. Git, GitHub and PBS operating rhythm

Use normal Git and verified private fork on `blue/linux-development`; do not build another publishing-only codebase. One coherent change per commit, draft PR per meaningful integration slice where useful; integration decisions belong to development lead under existing owner authority. No force push, rewriting old history, resetting owner work or merging unreviewed WIP.

Human-readable subject, then short multiline bullets:
- Why: user problem and named milestone in plain words, not an unexplained Q2n code.
- Changed: behavior and scope.
- Checked: commands, results and exact source identity; distinguish native/media/fixture evidence.
- Still open: unsupported cases, platform limits and next step.

Commit source and relevant Linux PBS/session/evidence summary together. Push coherent reviewed checkpoints promptly and before stopping, then read back remote commit and changed-file bytes where needed. Label incomplete recoverable stops `WIP:` and state last passing source. Do not count a local commit as backup. Exclude generated media, build binaries, secrets and private raw diagnostic receipts; maintain legitimate reproducible setup instructions and evidence digests instead. Any denied payload is a blocker to resolve transparently, not a reason to split/rename/recreate it to evade review.

Maintain Linux continuation, goal, requirements evidence and session summary in the repository; Notion mirrors the human status and links, not a competing truth. Each stopping point records local HEAD, remote HEAD/equality, uncommitted work, commands actually run, failures, exact next action, runtime state, owner gates and active worker/resource ownership. Preserve original Windows PBS as provenance; Linux deltas must not claim Windows completion.

## 8. Anti-drift and decisions

At most one active implementation slice per writer. Define done before coding. A slice normally reaches reviewable code and one useful behavioral proof before broadening the matrix. After two consecutive attempts on the same blocker, stop replaying: write the observed cause, smallest next diagnostic and an independent useful task. This is a diagnostic checkpoint, not permission to abandon a critical integrity problem or to wait for Ahmed on routine choices.

Don't spend a day building a new testing framework for a narrow bug. Reuse harnesses and existing validators. Timebox exploratory work to one bounded session with an explicit question/output; coordinator revises the plan if it doesn't reduce uncertainty. Risks to source data, silent corruption, authorization or reproducible recovery justify deeper work; hypothetical low-impact polish does not block shipping. No universal numeric token quota is invented.

Ask Ahmed only for consequential reserved decisions: measured Q2k default, AMF producer disposition, changed product scope/acceptance and final candidate acceptance. Routine implementation, reviewed merge and supported in-scope pushes do not wait for him. Hardware/Windows gaps get explicit follow-up entries, not a pause of all portable work. Continue with highest requested Astra Ultra configuration; never claim a model setting without verified configuration.

## 9. Major risks and concrete mitigations

| Risk | Mitigation / trigger |
|---|---|
| Local-only work lost | E0 remote parity ledger and fresh-clone restore; immediately disclose unresolved upload scope; do not assume workspace permanence |
| Runtime upgrade breaks unrelated codecs | paired pins, codec inventory, existing baseline retained, explicit route activation, full ordinary regression and rollback |
| Long-duration feature remains a demo | streaming bounded memory, real long/4K/1440p held-outs, duration-proportional budgets and cancellation; no row closure from tiny clips |
| False acceptance or needless refusal | independent two-direction reviewer plus frozen valid/invalid corpus and test-time full-decode comparison |
| Linux changes break Windows | narrow platform seams, preserve shared semantics and Windows code, portable tests, file-level transfer map and later Windows qualification |
| No GPU/owner media available | complete software/injected tests, exact missing evidence/support cells, proceed with independent CPU/container work |
| Endless review/tool building | package-specific exit proof, reuse harnesses, two-failure diagnostic checkpoint, defer nonessential polish |
| UI looks like a different product | existing styles/six tabs, exact approved Gauge bytes, both-theme/native/narrow review; no redesign without owner decision |

## 10. Traceability appendix

The following table preserves the original 43 IDs and requirement text. Status labels below are **plan dispositions**, not replacement historical evidence. Each row's final Linux evidence must name source/runtime hashes, test receipts and platform limits. This initial package map is not the final evidence ledger: the live PBS must add a row-specific status, must-accept and must-refuse obligations, exact receipt/source links, and the next missing test before that row can close. E8 rejects generic package references as proof. Existing tracker 25 remains the source for original dated evidence.

| ID | Original requirement | Work package | Linux disposition / closure rule |
|---|---|---|---|
| N01 | Preserve full reviewed plan and controlling Goal; isolate codex/v0.7-candidate, state and accepted/benchmark boundaries | E0 / all slices | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| N02 | Shared typed evidence/draft/plan/result/incident contracts and requirement-to-evidence tracker | E0 / all slices | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| N03 | Threat review, independent review and parent documentation synchronization rules | E0 / all slices | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| N04 | Ownership, network/storage/time ledger and one-real-media-job scheduling | E0 / all slices | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O01 | Diagnose Resolve and laptop candidates independently using accepted runtime; unknown historical mapping remains explicit | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O02 | Bounded typed HDR/DOVI, geometry, timeline, audio, program/group/container evidence with cache invalidation | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O03 | ctime-only complete comparable post-validation checks safely publish with warning, no whole-file prerequisite | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O04 | Stronger source changes/incomplete sampling/invalid output/collision/cancel retain distinct outcomes; strict cache/grants unchanged | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O05 | Durable diagnostics across admission, preparation, unsupported-only, capabilities, invoke, validation, publication, cancel and recovery | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O06 | Bounded retention, safe reparse handling, privacy/redacted exports, truthful write failures and interruption recovery | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O07 | Named per-file ancillary decisions or useful compatible alternatives; no silent global dropping | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| O08 | Separate Electron and paired FFmpeg maintenance trial checkpoints with verified provenance and rollback | E1, E5–E8 | Preserve inherited foundation; requalify affected Linux behavior and final bytes |
| P01 | Useful AMF H264/HEVC/AV1 native CQP/QVBR adapters, explicit device, per-depth/RC support | E1, E5, E8 | Complete portable software; real vendor/producer qualification remains explicit external gap |
| P02 | Useful QSV H264/HEVC/AV1 native ICQ/CQP adapters, actual RC verification and no substitution | E1, E5, E8 | Complete portable software; real vendor/producer qualification remains explicit external gap |
| P03 | Discovered/untested/verified/unavailable/stale capability cells keyed by exact binary/device/driver/RC/depth/transform | E1, E5, E8 | Complete portable software; real vendor/producer qualification remains explicit external gap |
| P04 | Unchanged ordinary CPU/NVIDIA Full/KeepSource SDR args/defaults and ArchiveCQ29 | E1, E5, E8 | CPU regression locally; NVIDIA/Windows evidence not transferable |
| P05 | Qualified PQ/HDR10 and HLG preservation, truthful static/dynamic metadata and output signaling | E1, E5, E8 | Deferred HDR: preserve source/evidence/failures; no expansion or false completion |
| P06 | Actual explicit HDR-to-SDR tone mapping, numerical/color/metadata evidence and no silent SDR | E1, E5, E8 | Deferred HDR: preserve source/evidence/failures; no expansion or false completion |
| P07 | Supplied iPhone compatible HLG route with separate mebx dispositions and no retained-DV claim | E1, E5, E8 | Deferred HDR: preserve source/evidence/failures; no expansion or false completion |
| P08 | Bounded DV-aware PQ on/off qualification and explicit evidence-backed limitations/usable route | E1, E5, E8 | Deferred HDR: preserve source/evidence/failures; no expansion or false completion |
| P09 | Small legitimate varied HDR corpus with terms/origin/bytes/hash/probe, private supplied metadata | E1, E5, E8 | Deferred HDR: preserve source/evidence/failures; no expansion or false completion |
| Q01 | Orientation/SAR/DAR-aware single output2160/1440/1080/720, no upscale/crop/stretch/fps/deinterlace, KeepSource preserved | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q02 | Per-file Full initial/single range, visible handles/exact fields, explicit batch apply | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q03 | Precision trimmed-audio re-encode entire selected segment; quality-conscious codec/rate/channel/sample-rate policy | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q04 | Full compatible audio copy; explicit supported range-copy override with disclosed packet limits | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q05 | Requested/effective boundaries, rebasedPTS, delay/padding, decoded sync tolerances, start/end/both/late/VFR/multitrack tests | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q06 | Qualified subtitle overlap/chapter rebasing; unsupported combinations explicit | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q07 | MKV/MP4 and qualified MOV remux targets; TS input program/stream relationships; full only | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| Q08 | Remux essence/representation/metadata/disposition/provenance/timestamps validated; no hidden transcode/loss | E2–E6 | Partial; implement and qualify broader real-file feature, not fixtures alone |
| R01 | Polished distinct Encode/Remux/Activity/Help plus dedicated App Settings; inspectable previews | E7 | Partial; integrated native acceptance required |
| R02 | Main-validated app→batch→file preference precedence, effective values/override disclosure | E7 | Partial; integrated native acceptance required |
| R03 | Atomic versioned preferences/migration/corruption/reset and isolated0.7 state | E7 | Partial; integrated native acceptance required |
| R04 | Frozen queued/running plans immutable; draft edits invalidate appropriately; navigation never mutates authority | E7 | Partial; integrated native acceptance required |
| R05 | Visible expert settings/native quality/help/recipe/actual canonical argv; no magic settings | E7 | Partial; integrated native acceptance required |
| R06 | Accessible keyboard/slider precise alternatives, narrow640x480/resize, navigation during active work | E7 | Partial; integrated native acceptance required |
| R07 | Original icon; actual versions/license/credits and diagnostic reviewable export UI | E7 | Partial; integrated native acceptance required |
| R08 | Generated exclusion/temporary exact reencode/omission authority preserved and never restored at restart | E7 | Partial; integrated native acceptance required |
| S01 | LocalCPU/NVIDIA real cross-feature evidence + proportional direct regression/negative/security/lifecycle tests | E8 | Pending final-source qualification; platform/owner gates explicit |
| S02 | Samefolder/collision/intentionalreencode/provenance/races/cancel/restart/shutdown and source-protection evidence | E8 | Pending final-source qualification; platform/owner gates explicit |
| S03 | Fresh0.7 prerelease ZIP extracted isolated, alternatecwd/restrictedPATH/offline-process/data persistence tests | E8 | Linux archive evidence separately; original Windows installer/portable obligation remains pending |
| S04 | Independent requirement-to-evidence review with resolved findings and honest supportmatrix | E8 | Pending final-source qualification; platform/owner gates explicit |
| S05 | One owner-review entry/checklist, exact artifact hash/path/version, rollback and final handoff | E8 | Pending final-source qualification; platform/owner gates explicit |
| S06 | No accepted0.7/publication/benchmark continuation; hardware/display/independentmachine/owner acceptance gaps explicit | E8 | Pending final-source qualification; platform/owner gates explicit |

## 11. Immediate handoff

1. Preserve the completed `8e0365f` developer-only service proof and verified four-file publication at `3f5e4c5`. Next implement the reviewed explicit runtime deployment/activation boundary and codec capability inventory, not another duplicate calibration.
2. Coordinator review this plan and commit it as the persistent goal/continuation basis only after coordinating with the lead; schedule follow-through with explicit meaningful-update thresholds.
3. Run E0 recovery/parity track alongside E1 and independent Q2j reconciliation.
4. Move to E3 actual any-length trim/resize once reused prerequisites are reviewed; do not spend another session merely re-describing the roadmap.
5. Report a user-readable milestone, exact push/readback and remaining limitations in chat. Never promise uninterrupted 24/7 execution; use durable goal/checkpoints and scheduled continuation so work survives separate turns.

## 12. Plan review

Independent read-only review by the Claude-consultation worker compared this plan against the full 126-line response and confirmed 43-row coverage. Two findings were corrected: Q2f explicitly includes 48 kHz mono as well as 44.1 kHz mono/stereo; a refusal cannot stand in for implementing a required ordinary software path. Additional clarifications preserve the measured D-then-B preference without preempting Ahmed, require row-specific final evidence, and distinguish roadmap O4 from requirement O04. No new Claude consultation, media execution or repository publication was performed for this review.

A second independent plan review requested explicit AV1 preservation during runtime transition and renewed final-source identity/testing after packaging/configuration fixes. Both are now explicit in E1 and E8. The four-file developer proof publication succeeded after exact owner approval; older shared-source/UI parity gaps remain open.
