# Native Windows owner acceptance checklist (revision2)

All cases NOT_RUN and UNBOUND. Candidate, fixtures and numerical contracts must be frozen before execution.

## W01 · Stage 0 · P0 · Freeze and verify candidate
Requirements: N01, N02, N04, O08, S04
Lane: shared-and-manufacture-prerequisite

**Procedure:** Compare supplied source commit/tree, archive SHA256, extracted app inventory, app.asar, Electron and paired FFmpeg/ffprobe hashes with signed-off handoff; record Windows build, GPU driver, Node/build tools and package variant. Review separate Electron and paired-FFmpeg maintenance trial checkpoints and actual rollback evidence before owner execution.

**Expected:** Every identity agrees; version alone is insufficient; mismatch stops all execution. O08 remains BLOCKED if either trial/provenance/rollback prerequisite is missing; identity alone does not close it.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W02 · Stage 0 · P0 · Reserve safe test workspace
Requirements: N04, S02
Lane: owner-windows-final

**Procedure:** Create a new ordinary local NTFS test folder; inventory originals and protected sentinels; confirm free-space budget and no running app/media jobs. Use only copied synthetic inputs.

**Expected:** Fresh output/state directories, originals untouched; one media job at a time. No reformat, ACL/security change or system cleanup.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W03 · Stage 1 · P0 · Portable default launch
Requirements: O08, R07, S03
Lane: owner-windows-final

**Procedure:** Extract verified portable artifact into a Unicode/spaced user folder. Launch its normal executable through Explorer, without developer flags, then close normally. Repeat from alternate cwd and restricted PATH using a process-local environment.

**Expected:** Real native window, correct version/runtime, usable defaults, isolated state, no tool from PATH, clean close. Native picker not substituted.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W04 · Stage 1 · P0 · Installer lifecycle
Requirements: S03, S05
Lane: manufacture-then-owner-windows-final

**Procedure:** After portable tests pass, operator uses reviewed installer in its intended per-user/per-machine mode, records prompts and shortcuts, launches normal entry, then tests uninstall using disposable app state.

**Expected:** Installed bytes/version/runtime match manifest; no unexpected authority or startup/network behavior; uninstall preserves user media and follows documented data policy. Stop for unapproved terms/elevation.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W05 · Stage 1 · P0 · Native shell and security baseline
Requirements: N03, R01, R07
Lane: owner-windows-final

**Procedure:** Open real folder pickers; cancel once, then select test input/output. Inspect existing sandbox/IPC test receipts and actual packaged settings. Exercise normal output reveal. Exercise receipt-bound Open and Reveal separately, using only the owned result; close only test-opened viewer windows. Check original icon, About actual versions, licenses and credits.

**Expected:** Pickers work; cancelled picker grants no new path authority; correct output selected; sandbox/context isolation on, node integration off; no arbitrary renderer path/command authority. Open targets correct file; Reveal selects correct output; playback launch does not prove perceptual quality. Original approved icon/license/credits are present.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W06 · Stage 2 · P0 · Six ordinary encoder routes
Requirements: P04, R05, S01
Lane: owner-windows-final

**Procedure:** Run one short 1080p SDR fixture through H264/H265/AV1 CPU and H264/H265/AV1 NVENC sequentially using preserved defaults. Retain actual main-owned argv and executable identity per job. Before native runs compare ordinary Full/KeepSource canonical argv and defaults against protected golden expectations, including unchanged ArchiveCQ29; retain comparison receipt.

**Expected:** Requested encoder appears in actual invocation, correct codec/output, expected streams and no fallback. ffprobe codec alone cannot distinguish CPU from NVENC. Unsupported requested route is a failure/gap, not a substitute pass. P04 requires exact golden comparison, not merely using current defaults.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W07 · Stage 2 · P0 · Device discovery and no fallback
Requirements: P01, P02, P03, P04
Lane: shared-injected-plus-owner-nvidia-external-amd-intel

**Procedure:** Inspect RTX5060 device/driver identity and supported cells; use existing injected unavailable/stale-capability tests. Observe AMD/Intel unavailable on this PC without disabling hardware.

**Expected:** Supported NVIDIA cells reflect actual device/runtime; absent AMD/Intel labelled unavailable, not verified. Unavailable/stale requested encoder refuses before work, never silently uses CPU or another GPU.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W08 · Stage 2 · P0 · UHD downscale ladder
Requirements: P04, Q01, Q05
Lane: owner-windows-final

**Procedure:** Use one approved 3840x2160 SDR synthetic source and produce separate 2560x1440,1920x1080,1280x720 outputs. Cover CPU H265 all sizes; NVENC HEVC 1080 on same source as cross-backend seam.

**Expected:** Exact dimensions, preserved aspect/cadence, no crop/stretch/upscale; independent probe/decode and approved media validator agree. Four separate jobs (three CPU targets plus one NVENC seam), not a new multi-output feature.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W09 · Stage 2 · P0 · Geometry boundaries
Requirements: Q01, Q05
Lane: owner-windows-final

**Procedure:** Run Keep Source and no-upscale ordinary input; run one portrait/non-square-SAR/rotation fixture only if final support matrix claims it; inspect actual displayed dimensions. Include explicit single2160 output selection on a suitable source, with no-upscale and orientation/SAR/DAR expectations fixed in advance.

**Expected:** Supported shapes correct; unsupported shapes specific refusal. An unfinished required v0.7 shape is open, not passed by refusal. Inactive geometry proposal never becomes an advertised feature. Required2160/orientation/SAR/DAR cells without qualified positive behavior stay BLOCKED, not excluded by a smaller support matrix.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W10 · Stage 2 · P0 · Trim boundary and audio policy
Requirements: Q02, Q03, Q04, Q05
Lane: owner-windows-final

**Procedure:** Use 150s approved source: start/end/both/late range and open-end; select precise fields and handles; exercise Full reset and explicit batch apply. Use existing calibrated ranges rather than inventing tolerances. Exercise supported explicit range-copy override and visible packet-edge requested/effective differences as a separate policy case.

**Expected:** Requested/effective bounds disclosed; frame/sample clocks meet frozen criteria; full compatible copy vs range reencode explicit; source intact; no silent FPS conversion or audio truncation. Q04 range-copy override without qualifying evidence stays BLOCKED; precision reencode cannot substitute for it.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W11 · Stage 2 · P0 · Cadence and offset regression
Requirements: Q03, Q04, Q05
Lane: owner-windows-final

**Procedure:** Use retained CFR60 and genuine VFR fixtures plus one delayed-audio sample; exercise Full and one range/resize pair through actual packaged service.

**Expected:** Declared frame/sample/PTS rules pass independent validation; no accidental CFR normalization, cumulative drift or tail clipping. Private acquisition/source proof is not package acceptance.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W12 · Stage 2 · P0 · Audio route families
Requirements: Q03, Q04, Q05, Q08
Lane: owner-windows-final

**Procedure:** Representative AAC48k stereo Full copy; precision FLAC range; AAC44.1k and mono only where final contract supports; multitrack selection plus no-audio input.

**Expected:** Compatible copied tracks preserved under copy policy; lossy reencode explicitly labelled and validated separately; sample rate/layout/delay/tail match policy. No lossy output claimed PCM-identical.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W13 · Stage 2 · P0 · Remux container routes
Requirements: Q06, Q07, Q08, O07
Lane: owner-windows-final

**Procedure:** Use approved MKV/MP4/MOV fixtures and TS program/stream cases required by Q07. Exercise normal Remux workspace and exact mapped tracks, with one subtitles/chapters/attachment case. TS program/stream relationships remain required Q07 evidence; absent implementation or fixtures are BLOCKED. Add a qualified positive trimmed-subtitle overlap/chapter-rebasing case in its supported workflow, separate from full remux and refusal cases.

**Expected:** Actual stream-copy invocation, validated payload/timing/metadata under frozen policy, correct output extension/container; no hidden reencode or silent track loss. Container incompatibility gives specific disposition. Q06 remains BLOCKED without successful qualified overlap/rebase evidence; full preservation or unsupported refusal cannot close it.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W14 · Stage 2 · P0 · Explicit incompatible and quick-copy policies
Requirements: Q06, Q08, R08, O07
Lane: owner-windows-final

**Procedure:** Use synthetic unsupported subtitle/container/ASS-resize case and one explicit omission or generated-reencode authorization; test Quick copy only if final v0.7 build implements it.

**Expected:** No silent omission; supported approved exceptions narrow and nonpersistent; Quick copy default OFF and result permanently says not verified. Missing required feature remains open.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W15 · Stage 3 · P0 · Queue and batch isolation
Requirements: R02, R04, S01
Lane: owner-windows-final

**Procedure:** Prepare two different files; freeze plans; edit draft/global settings while first runs; navigate tabs; attempt stale prepare/start through existing negative harness.

**Expected:** Queued/running argv unchanged; draft requires replanning; explicit per-file/batch precedence; one live encode, truthful mixed success/skip/failure counts.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W16 · Stage 3 · P0 · Full elapsed UI
Requirements: O05, R01, R04, S02
Lane: owner-windows-final

**Procedure:** Observe wall clock at Start, encode and verification phases, between jobs, terminal state; compare service elapsed and rendered Batch elapsed/result. Wait 3s at terminal, then use documented return/reset control.

**Expected:** Elapsed covers full batch lifecycle, not encode time only; active monotonic display, terminal frozen, snapshot/DOM agree within displayed rounding. Return to setup is not assumed to clear history; test actual reset semantics.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W17 · Stage 3 · P0 · Cancel and recover
Requirements: O04, S02
Lane: owner-windows-final

**Procedure:** Cancel once during encode and once during output verification using bounded source long enough to observe each. Wait for closure before starting a fresh job.

**Expected:** No unpublished partial shown as success; all owned child/sink work settles; next job works. If job wins race and publishes first, record inconclusive-too-quick, not cancellation PASS.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W18 · Stage 3 · P0 · Close and isolated interruption recovery
Requirements: O04, O05, O06, S02
Lane: owner-windows-final

**Procedure:** Normal close during idle and active job; in separate disposable run use approved harness to terminate only the exact PID+creation-time-owned app, never OS power-off or unrelated process. Restart same disposable state. First choose Keep application open in the real busy-close dialog and observe work continue; later Cancel batch. In a separate bounded job choose Cancel encoding and exit, await closure, restart and inspect cancelled History.

**Expected:** Truthful interruption incident; no false success, unsafe orphan cleanup or duplicate publish; retained uncertain files protected; clean restart and eventual owned-process closure. Both busy-close choices must be observed while genuinely active; completion before interaction is INCONCLUSIVE for busy-close, not PASS.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W19 · Stage 3 · P0 · Source mutation and identity
Requirements: O03, O04, S02
Lane: owner-windows-final

**Procedure:** Existing isolated harness mutates only owned source copy between prepare/start or validation/publication; exercise ctime-only metadata fixture separately.

**Expected:** Real content/identity change refuses safely; ctime-only comparable complete evidence follows documented warn/keep policy; source-change classes not conflated.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W20 · Stage 3 · P0 · Collision and same-folder
Requirements: O04, S02
Lane: owner-windows-final

**Procedure:** Precreate destination sentinel; run ordinary collision and sandbox race harness; run source=output folder with recognised generated output, then rescan.

**Expected:** Existing bytes unchanged; no overwrite or suffix chains; generated output excluded unless explicit narrow reencode authorization; uncertain stage cleanup refuses.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W21 · Stage 3 · P0 · Storage and access failures
Requirements: O04, O05, O06, S02
Lane: owner-windows-final

**Procedure:** Use bounded injected ENOSPC/EACCES/write/readback faults and locked owned file; nonexistent destination and read-only disposable file. Do not fill disk or change system ACLs.

**Expected:** Specific user-visible error, no false completion, originals preserved, bounded retained stage, diagnostic write failure truthful; can choose valid destination and recover.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W22 · Stage 3 · P0 · Malformed media and path refusal
Requirements: O02, O05, N03, O01
Lane: owner-windows-final

**Procedure:** Use existing tiny bounded invalid/truncated container corpus and path unit tests; normal filename with spaces/Unicode/metacharacters. No live exploit corpus or network-share probing.

**Expected:** Bounded parse/probe time and memory; useful refusal; no shell interpolation/path escape; no outside-test writes. Accepted ordinary names still work.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W23 · Stage 4 · P0 · Settings and restart
Requirements: R02, R03, R08
Lane: owner-windows-final

**Procedure:** Persist profile settings and folders, restart; test corrupt/migration/reset using copy of isolated state and existing test harness; reencode/omit grants must not survive restart. Preparation-only generated source: Excluded → explicit current-draft grant → Ready; exit/restart and reprepare must be Excluded again. Check omission grant revocation separately and saved folder/profile/History persistence without prepared authority.

**Expected:** Validated settings and expected precedence survive; corrupt state recoverable and reported; reset truthful; fresh folder/runtime authority; accepted0.5/0.6 data untouched. Generated and omission grants both revoked; old historical generated-only receipt does not prove omission behavior.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W24 · Stage 4 · P0 · Diagnostics and privacy
Requirements: O05, O06, R07
Lane: owner-windows-final

**Procedure:** Trigger known owned failure, inspect History and review export before saving locally; search export for synthetic PRIVATE_SENTINEL marker, paths and environment secret markers inserted only in test data.

**Expected:** Policy-redacted information only; no credentials/environment dump/media contents; review before export, bounded retention; failed export visible. Raw local receipts never auto-uploaded.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W25 · Stage 4 · P0 · Accessibility and constrained windows
Requirements: R01, R05, R06
Lane: owner-windows-final

**Procedure:** Keyboard-only picker/prepare/settings/range/start/cancel/result; check focus order/visibility, exact slider alternative, accessible names and errors. Inspect640x480, normal1080p and125/150% Windows scaling, light/dark current themes. Record actual outer/client geometry and DPI: old642x480 observation is not exact640x480. Include complete keyboard order and screen-reader accessible-name/status checks where available.

**Expected:** All essential actions reachable and readable without clipped buttons or color-only status; no keyboard trap; selected owner workflow usable during encode. Cosmetic findings separate from blocking access defects. Unmeasured exact640 or incomplete screen-reader coverage remains explicit; old narrow captures do not pass this candidate.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W26 · Stage 4 · P1 · Offline and startup behavior
Requirements: R07, S03
Lane: owner-windows-final

**Procedure:** After dependencies/runtime fully provisioned, launch with existing network disabled by owner or use already-approved isolated network test; inspect app-owned connection observations. Do not alter firewall/VPN/security settings.

**Expected:** No required download/sign-in to encode local files; no undeclared telemetry/private-data transmission; actual warnings retained, not labelled warning-free. Mark blocked if safe offline setup unavailable.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W27 · Stage 5 · P0 · Bounded sustained workload
Requirements: N04, O05, S01, S02
Lane: owner-windows-final

**Procedure:** After short cases pass, run 30min mixed1080/UHD synthetic queue, then optional up-to2h owner-approved representative archive run. One encode at a time; monitor every60s; leave generous disk/memory headroom. Separately prepare a61-entry mixed-file storyboard using tiny owned valid/unsupported/generated/collision fixtures: inspect filtering, per-file overrides, reasons, cancellation and outcome counts. Freeze expected counts before launch; encode only an explicitly budgeted valid subset.

**Expected:** No accumulating child/handle/temp leak, frozen UI or corrupt output; cancel remains responsive. Retain throughput,RSS/commit,CPU/GPU utilization and thermal readings if available; no invented temperature threshold or artificial stress generator. 61-entry UI/storyboard evidence is distinct from two-identical-file hosted proof and from endurance; failed/blocked entries cannot silently vanish.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.

## W28 · Stage 5 · P0 · Final review and owner sign-off
Requirements: S01, S04, S05, S06, O01
Lane: independent-review-and-owner-signoff

**Procedure:** Reconcile every case and all43 requirements against exact final bytes; classify PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE/INCONCLUSIVE. Independent reviewer checks P0 and owner reviews product limitations.

**Expected:** No unresolved corruption/security/source-loss blocker; required functions cannot pass by refusal or silently move versions; artifact hashes and rollback delivered; Windows/RTX owner acceptance explicit.

**Record:** exact candidate/package/runtime and fixture identities; actual settings/argv; result/receipt; reviewer/time. Status: NOT_RUN. Binding: UNBOUND.
