# Owner Windows / RTX 5060 v0.7 acceptance suite

**Revision2 review draft, 19 November 2026. Nothing in this package has executed on Windows.**
Source inspected: checkpoint101 `e5e4d7504a2f6df2f742fe6f33708332d89c0582`. This is an isolated review proposal, not canonical code, a release approval, or an instruction to begin PC testing now. Lead integrates only after independent review. Suggested canonical destination: `linux-blue/windows-owner-acceptance/`; executable helpers require separate review under `scripts/windows-owner-acceptance/` and unit tests.

## Objective and scope

Develop and maintain the acceptance suite alongside development. Run Ahmed's native Windows/Ryzen5600X/RTX5060/32GB acceptance **last**, after useful independent v0.7 work, exact candidate freeze, package manufacture and available cloud qualification. Reuse the existing application, UI, tests and validators. This is not a new test framework or an exhaustive Cartesian matrix. Preserve all43 original requirements; v0.8 themes/languages/guides and v0.9 HDR are separate, not reasons to drop remaining v0.7 functionality.

Files: `checklist.md` contains28 staged procedures; `case-manifest.json` contains their machine-readable requirements/status/evidence fields; `requirement-map.json` accounts for all43 original requirement IDs; `validate_manifest.py` is an inert schema/coverage consistency check. No test launcher is supplied because current hosted entrypoints have deliberately narrow authority and owner-native adapters are not yet reviewed. Candidate/fixture/numerical bindings are explicitly UNBOUND and execution_ready=false. This plan is operator-runnable once the release handoff supplies the listed prerequisites, but it is **not a one-click executable Windows harness**.

## What is actually established

- checkpoint101 current-state record reports shared CI227 syntax files/338 tests per Windows and Ubuntu, plus133 Linux tests (overlapping groups). This is source-contract evidence, not final candidate acceptance.
- Retained Windows099 report: `INTEGRATION_PASSED`, two distinct-path identical-byte tiny CPU inputs, collision refusal, terminal timer frozen/DOM equality/reset, normal closure and sampled zero live descendants. It explicitly says `picker: substituted-dialog-return`, `gpu: not-qualified`, `nativeDesktop: not-qualified`, `distribution: report-only`. No owner-PC, NVENC, native-picker or comprehensive package acceptance follows.
- Existing Linux native UHD3840x2160→1440/1080/720 and ordinary routes are useful prior behavior evidence, not Windows proof. Native elapsed/cancel evidence remains tied to its exact source/package.
- Accepted private actual-service CFR60/VFR audit is fb7eb416…; corrected102 source is approved at cbda3689… per current lead/reviewer handoff. These abbreviated references must resolve to full immutable receipt/source identities at binding. Packaged VFR remains pending; private service evidence is not package-GUI proof. Do not activate inactive geometry widening merely to make a test pass.
- Existing hosted integration is parent-commit/push/run-attempt bound. **Do not fake GitHub environment variables, remove authority checks or invoke it as an owner-PC shortcut.** Reuse its reviewed assertions through a separately reviewed owner-native adapter; real pickers must not be stubbed in owner acceptance.

## Entry gates and operator sequence

1. Lead delivers immutable release candidate, source/tree and package hashes, corresponding-source/notices, exact installed runtime files and supported-feature matrix. The PC project/accepted0.5/0.6 work and benchmark corpus stay untouched. No build on unknown or dirty source.
2. Confirm portable artifact and installer really exist; report-only CI is not an artifact. If either required format is missing, S03/S05 stays BLOCKED. No general release sign-off from tests on an instrumented development entry.
3. Operator creates a unique test root (for example a newly named folder beneath their own chosen local directory), isolated app data and outputs. Use test-fixture copies only. Record exact volume/filesystem and available space. No destructive tests on personal originals.
4. Run stages0–1 (identity/startup), then2 (media),3 (lifecycle/failure),4 (product/privacy/accessibility),5 (bounded endurance/review). Stop on any P0 source-loss, corruption, security-boundary, unowned-process or unexplained runtime-identity issue. Retain evidence; do not retry blindly.
5. Run one native media job at a time. Default short fixtures8–15s, range fixture150s; one additional 30min media source or bounded queue only after short tests pass. Hard run ceilings must be chosen from measured candidate throughput before launch; a 4K slow CPU encode cannot be assigned an arbitrary short timeout and then called broken. Stop/cancel if memory/storage headroom is no longer safe or the UI/owned children cease responding. No synthetic RAM/disk exhaustion.
6. Candidate change after freeze: new identity, affected tests plus required aggregate regression and final smoke rerun. Driver/runtime/package change invalidates relevant native evidence; immutable historical results remain available but not counted for changed bytes.

## Fixture set, not a Cartesian explosion

Use already reviewed/generated fixtures when available and hash them before use. Fixture definition/probe receipt must state source time base, frame count/PTS family, audio sample rate/count/layout/delay/tail, color/depth, geometry/SAR/rotation and streams. Keep expected results independent of the output under test.

- F1 ordinary1080p SDR H264/AAC8–15s, two distinct contents for batch testing, plus no-audio variant.
- F2 UHD3840x2160 SDR short source for three single-output downscale targets.
- F3 long150s range source with approved audio/timing reference for start/end/both/late/open-end.
- F4 retained CFR60 and genuineVFR sources, one offset/tail case; independent cadence criteria from frozen contract.
- F5 representative existing MKV/MP4/MOV remux cases, subtitle/chapter/font attachment example, multitrack case. TS and extra rate/layout shapes only under current feature matrix, never silently counted complete if required and absent.
- F6 tiny corrupt/unsupported files and disposable source/output sentinels. Fault injection for ENOSPC/EACCES/races stays in isolated harness; do not fill the real volume, disconnect media, disable antivirus, alter drivers or force power loss.

Cross product reduction: six ordinary CPU/NVENC profiles at baseline; three sizes on one CPU route plus one NVENC transformed seam; representative audio/container/cadence cases plus boundary negatives. Add combinations only for changed code, risk or observed failures. 8/10-bit coverage follows actual advertised final cells, not an assumed blanket claim. No output-size equality or ffprobe codec name is proof of encoder identity, preservation or visual quality.

## Existing code reuse and command readiness

Read the exact candidate scripts before running any command; older smoke scripts may use fixed paths or candidate catalogs. Applicable deterministic examples (after reviewing prerequisites) are:

```
node --test tests/windows-adapters.test.cjs tests/windows-electron-ownership.test.cjs tests/windows-package-policy.test.cjs tests/windows-packaged-integration.test.cjs
node --test tests/app-settings.test.cjs tests/preferences.test.cjs tests/source-identity.test.cjs tests/completed-source-policy.test.cjs tests/diagnostics.test.cjs tests/diagnostics-service.test.cjs tests/container-clock.test.cjs
```

These are selected tests, not full release regression. `package.json` supplies `test:app`, `test:lifecycle`, `test:protocol`, `test:product`, `test:layout`, `test:profiles`, `make:portable`, `test:portable`. **Listed is not safe-to-run-now:** lead audits fixed paths/runtime assumptions and determines exact final release commands first. `scripts/windows-packaged-integration.cjs` already implements useful security, process-identity, two-file batch, collision and terminal-timer assertions; retain their semantics, but its hosted authority and substituted picker cannot stand in for native acceptance. Existing remux/cadence/operation tests should remain the oracle instead of writing second media validators.

Missing implementation before automated owner run: reviewed owner-native adapter with explicit local workspace/candidate binding; fixture manifest for exact final supported matrix; safe storage/interruption fault harness; native accessibility/evidence recorder; final installer manufacture/acceptance script. These are concrete development tasks, not permission to lower gates or to postpone all suite development until PC day.

## Provenance and evidence recipe

Record Windows edition/build/patch level and architecture; CPU model; physicalRAM; GPU model/device identity and exact NVIDIA driver version/date; display resolution/scaling; power mode (observe only); storage volume/filesystem/free bytes. Capture actual FFmpeg/ffprobe `-version`/build configuration and hashes; Electron and app versions/ASAR hash; source commit/tree/dirty state; dependency lock hash and build-tool versions; package/installer hash, signature state/publisher (unsigned accurately labelled), installation mode and launch command. No claim of signature authentication from hash equality alone.

For each case retain timestamp, operator/reviewer, fixture hashes, intended settings and main-owned actual argv/runtime, observed outcomes and independent validator results, before/after source+sentinel hashes, output hashes/probe summaries, published/failed/cancelled/unprocessed states, elapsed snapshot and screenshot, child identity/closure observations with sampling limits. NVENC proof requires actual requested `*_nvenc` invocation and successful output plus matching runtime/device context; Task Manager utilization is corroboration only. Do not change drivers or security settings as part of provenance capture.

Quantitative media criteria come from the candidate's **predeclared frozen validator contracts**, including units and frame/sample rounding. Do not invent sync tolerances after seeing results. Missing numerical criteria means BLOCKED before relevant tests. Terminal elapsed display should match service elapsed at its displayed precision; record full lifecycle including validation/publication, not a stopwatch estimate as exact truth.

Receipts remain local by default. Screenshots/raw traces/process inventories can reveal user paths and other apps; collect only necessary app-owned context, redact before any separately authorized sharing. No credentials, tokens or full environment dumps. Sanitized manifest may link private evidence IDs without embedding personal paths.

## Ongoing maintenance and release decisions

Every development slice declares impacted case IDs, requirements and lanes. Cloud workers update NOT_RUN/changed-byte status and prepare deterministic/hosted/Linux proofs. Do not ask Ahmed to repeatedly retest his PC during development. Perform owner Windows suite on final frozen artifacts; focused retest later only if a genuine fix changes them.

Cloud now: pure contracts/negative/fault-injection tests; source review; safe hosted Windows CPU/package manufacture and supported CI tests; Linux real-media/native journeys. Windows final: real Explorer launch/pickers/reveal, actual NVIDIA hardware/no-fallback, NTFS file/process behavior, native visual/accessibility checks, actual installer/portable lifecycle and controlled endurance. AMD/Intel hardware proof remains external; absent hardware does not close P01/P02. HDR P05–P09 deferred to v0.9 by current owner scope, with historical evidence preserved.

PASS requires evidence for that case, exact candidate identity and satisfied expected results. FAIL is observed violation. BLOCKED names prerequisite/owner/environment gap. NOT_RUN means not attempted. INCONCLUSIVE covers missed cancellation timing or incomplete observation, never silently PASS. NOT_APPLICABLE requires written supported-scope rationale and review. Required unfinished v0.7 functionality is BLOCKED/FAIL, not NOT_APPLICABLE. Reviewer resolves all43 rows and P0s; Ahmed separately accepts exact candidate with known limitations. No public release, benchmark restart, default recipe change or automatic Windows merge is implied.

## Source reading and limitations

Read checkpoint101 CURRENT_STATE/package.json; Windows099 sanitized report; hosted Windows workflow and packaged integration source; source-backed089 release-scope reconciliation;080 batch/reset/remux preparation; current lead clarification on cadence/geometry and package evidence. All43 exact requirement-column texts were freshly extracted/read from original tracker Git blob17106c10cc05ed665e279e3a28cc3bae4370607d and retained in original-requirements.json. Dated status/authority paragraphs are historical, not instructions to execute. The map carries exact text/blob identity and explicit missing subcriteria.


## Revision2 historical scenario reconciliation

Read Nov18 parallel plan https://app.notion.com/p/41cbd7ade63b81a5a7cbc1193bb25a5c (last edited2026-11-18T16:19:29.250Z), especially exact-candidate CPU-first, trueRTX-separate and redacted-evidence run sheet. Read complete Oct23 native report at `0- Documentation/Execution Summaries/2026-10-23_Native_Workflow_Acceptance.md`, Git blob6529e6b9c9f2994f8206ccfd15151e9c52127180. It observed both busy-close choices, real picker/Open, active cancellations and generated-grant revocation, but omission restart,60-plus mixed storyboard and exact640/full accessibility remained gaps. Its source3839249/instrumented Windows-main evidence, sample warnings and missed cancellation are preserved as scenario seeds only, never current candidate passes. W05/W18/W23/W25/W27 now name those scenarios. No old job budget or authority is reused.

Use MANUAL_RUN_SHEET.md without Codex quota or automation. A missing automated observer means mark the technical claim BLOCKED or use a reviewed equivalent measurement, never infer it from a screenshot. Review/manufacture/maintenance and externalAMD/Intel requirements are separate lanes, not tasks magically completed on Ahmed's NVIDIA desktop.
