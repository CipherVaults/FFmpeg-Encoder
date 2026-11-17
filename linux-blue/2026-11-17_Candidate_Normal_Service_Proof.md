# Prove normal-service publication, collision and fresh-instance recovery

## 1. Task Overview

Run one separately reviewed bounded experiment through the real developer candidate service on immutable checkpoint `374d327a7e3fa934d046def5b4e18b45285680ed`. The goal was useful consumer-path evidence: normal preparation and Start, genuine proportional selection, actual encoding/collection/storage/publication, existing-output protection, active encoding cancellation and recovery with new instances. This is precise range-Encode work [Q2n], not production activation, all-Q completion or the separate Remux/container lane [Q2j].

Ahmed's ongoing Linux 0.7 continuation and the Git → immediate verified Notion → GitHub cadence remain in force. Blue leads with recorded GPT-6 Astra / Ultra configuration. A bounded worker prepared and executed the launcher once; an independent reviewer first checked the launcher, then audited saved artifacts without running media. The lead verified the source gate, retained the whole-tree freeze and reconciled results. No personal media or Windows files were used.

## 2. Context Used

The tested service and its reviewed cancellation/cleanup corrections are described in [the preceding source execution report](2026-11-17_Candidate_Keep720_Service.md). Checkpoint 008's [Notion source mirror](https://app.notion.com/p/41bbd7ade63b81f8bfd9e35605405e32) restored all 514 files before the runtime opened. The complete eight-commit bundle and full 212,471-byte native session page were also independently restored/read back. Original-ancestry GitHub commit `14be3e1e218d2ea97cef10583b8d166ebd771e96`, sole parent `74a82817b57ad929be56e9137e4e7dda3086097d`, was verified separately at 16:07:33 UTC, after this short campaign. The launch gate required local commit plus Notion restoration and independent launch review, not a fictitious earlier GitHub completion.

The exact candidate pair remains `1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9`. The live service required its genuine handle, seven inspected dependencies, original fixed long calibration report and 97 historical producer hashes. No historical report/runtime pin was replaced and no portable archival report was used as a factory input. The longer calibration on `54ee143` supplied narrow upstream evidence; this run establishes a new actual service-consumer result on `374d327`.

## 3. Work Performed

The launcher was frozen and independently reviewed before release, then tied to the exact committed source and restored Notion snapshot. The lead rehashed all 514 tracked files; the launcher gated 271 source/JSON records and enforced loader/currentness checks. A write-once attempt marker prevented accidental replay. Every actual child still used the existing real process runner, not a synthetic runner or test VM.

An owned copy of the previously generated 150-second source was byte-verified without modifying its original. A separate eight-second flipped/frequency-varied source was generated for independent input. The service used normal prepare/update/Start and actual current qualification/resource objects. Three cases reached genuine no-overwrite publication after full-source/selected evidence, telemetry and storage checks. The collision case created a sentinel after preparation and confirmed that Start skipped it without a new encoding process. The cancellation case waited for an actually live child and non-terminal encoding progress, then cancelled, drained and closed the old service/runtime before opening new instances for recovery.

Exactly one attempt ran. Five cases passed; no criteria were loosened and no failed case was silently retried. The cancelled incomplete stage remains retained and never published. Source, output, sentinel, runtime and dependency identities were checked after closure. Independent saved-output review followed without another media process.

## 4. Commands / Tools Used

The prepared launcher was `launch-service.cjs`, SHA-256 `b28cddc0f9f738f46e8716fa1292207a35f3526c055dec84fd0025227ec42ca5`, invoked once with Node and no CLI knobs. Its separately saved approval record identified source `374d327`, exact source hashes, verified Notion gate and independent launch review. The launcher called the normal service APIs, genuine candidate runtime and real `runTool`; FFmpeg/ffprobe calls used the same fixed runtime and unchanged source-derived policies.

Outer process timing was 16:05:59.390868–16:06:50.550056 UTC, exit 0, wall 51.159 seconds. The internal attempt marker is 16:05:59.826 UTC and the report ended 16:06:50.532 UTC, with measured internal elapsed 50,704 ms. These measure different boundaries and are not a hardware benchmark. Original launcher, completion, exit and stdout/stderr identities are recorded in [the receipt](2026-11-17_Candidate_Normal_Service_Proof_Receipts.json); machine-specific launcher paths are not published.

## 5. Verification / Testing

| Actual case | Observed result |
| --- | --- |
| 130–132 seconds from owned 150-second source | Published HEVC/FLAC output; 60 selected video frames and 96,000 stereo samples; complete source 4,500 frames and 7,200,000 samples. |
| 0.613–2.721 seconds from fresh independent eight-second source | Published output; 63 selected frames and 101,184 samples; complete source 240 frames and 384,000 samples. |
| Existing destination collision | Skipped; sentinel bytes/hash unchanged; no new target encode for that case. |
| Cancellation of a seven-second selection during actual encoding | Observed live child at frame 8, 0.490667 seconds and `ended=false`; cancelled, no published destination, incomplete stage retained. Admission closed; Start on the old service refused. |
| 1.013–1.513 seconds after old service/runtime closure | New handle and new service published 15 frames and 24,000 samples. This is fresh-instance recovery, not same-service retry. |

For each publication, selected PCM hashes/counts matched; complete-source bounds, telemetry, resource limits, evidence storage and source-unchanged assessment passed. Output metadata identified HEVC/FLAC, retained 1280×720 geometry and expected Matroska clocks/provenance. Actual output full-decode checks ran during the campaign. Lossy video-pixel identity and general perceptual quality are not claimed.

The final census is 119 spawned, 119 closed, zero live, maximum concurrency one, under the 180-child ceiling. Both service closures reported admission closed, not busy and no closure errors. The raw `census.encodes=28` field counts all child argument lists containing `-progress`, including verification calls. It is **not 28 output encodes**: three output files were published. The record preserves the original field with this correction rather than changing its historic value.

The independent audit verified all 171 pre-report artifact hashes totaling 88,343,227 bytes, source and output hashes/stat observations, 271 current and immutable committed source records, two tools plus seven dependency identities, three resource envelopes rederived independently, complete collector bindings/spools/counts/PCM, six bounded telemetry summaries, storage forecasts/final records and chronological cancellation→closure→new-session→recovery records. All 21 collector children separately had empty stderr. The lead rechecked all 514 tracked source files unchanged at 16:08:24 UTC before releasing documentation edits.

The audit did not independently re-decode every output, execute another runtime, retain streamed raw PCM or cryptographically attest chronology. Its final SHA-256 is `45fb2d5d2de9c350e72b2464a8021d7c7a251cb889655d938c94c32684e5573c`. Earlier audit drafts were superseded after a more precise child-diagnostic review; this final identity owns the conclusions here.

## 6. Problems Encountered

**Successful target encodes were not diagnostically clean.** Each of the three successful target encodes retained 499 bytes of stderr containing duplicate codec-option warnings, x265's `Failed to genrate CPU mask`, and no-thread-pool/WPP/lookahead-slice diagnostics. The cancelled target retained 1,086 bytes with those messages plus interruption-associated corrupt/partial packet, immediate-exit demux and partial PCM errors. Only the outer launcher stderr was empty. All 21 collector children had zero stderr; the 499-byte per-job accounting is target-encode diagnostics, not collector errors or merely progress text.

The measured output/timing/PCM/storage/publication contracts still passed. That does not establish that the warnings are harmless or that runtime performance and broader reliability are qualified. A subsequent read-only investigation explains the duplicate codec notices deterministically: saved target argv supplies global copy first and specific HEVC/FLAC overrides afterward; the exact retained FFmpeg 9.0.2 option matcher uses the final matching option. Successful probes confirm those intended codecs. Do not remove global copy blindly: it also preserves streams that should remain copied.

The x265 diagnostics strongly match missing CPU-topology visibility in this workspace. Post-run inspection found no `/sys`, with CPUs 0–8 available. The actual x265 4.1 static archive references the NUMA CPU-map function; matching libnuma 2.0.19 source reads sysfs node maps, and accessible x265 source emits the observed CPU-mask diagnostic when that call fails. This is a supported causal inference, not a traced sole cause: exact x265 4.1 source was unavailable, the source mapping used its upstream master mirror plus actual archive symbols, and the topology observation was post-run. See [libnuma 2.0.19](https://raw.githubusercontent.com/numactl/numactl/v2.0.19/libnuma.c), [x265 threadpool implementation](https://raw.githubusercontent.com/videolan/x265/master/source/common/threadpool.cpp) and [x265 4.1 threading](https://x265.readthedocs.io/en/4.1/threading.html).

The diagnosis ran no media, executable/library test, build, installation or system change. Native threading/performance remains unqualified; no warning suppression, forced pools setting, sysfs mount or emergency repin is justified. Preserve the observed fallback-environment result and its caveats. Independent developer-only UI wiring can proceed; native execution still requires a separately checked environment and reviewed proof. Do not rerun media or widen criteria merely to obtain a clean-looking result. The cancelled stage is retained because it never acquired a complete identity binding, not because it was successfully published and deleted afterward.

The 27 inherited broad Linux test failures remain unresolved. No test rerun was used to change those results for this evidence-only checkpoint. Source-only restoration still cannot satisfy the live factory's original raw calibration/runtime gate. Runtime binaries, original reports, sources/outputs/spools and logs remain separately retained local artifacts, not contents of this source backup.

## 7. Documentation Impact

Update Current, prepend the full owner-format session, add this execution report and its exact receipt, and preserve a [portable full report](evidence-2026-11-17/normal-service-proof-portable.json). The prior 212,471-byte session remains an exact suffix. Historical correction receipts, prior archives, tests and application code remain untouched.

The portable record changes only 26 path-bearing strings to explicit logical prefixes. All other report keys, types, measurements, hashes and authority flags are preserved. It records original report SHA and transformation, cannot reconstruct original machine-absolute bytes without an excluded mapping, and cannot satisfy a fixed pinned-report gate or grant activation. It preserves semantic evidence, not the raw binary/media working set.

## 8. Git / Version Control Impact

Checkpoint 008 is fully preserved: source ZIP SHA `9f68452735609efb9af04f30ea0d784d9588d351cced9c8155367a7a4dfdf810`, full bundle SHA `1253ec5e21976dc7046a8365b8b1ab033dc09e7c13b3941235e6c030c99645c4`, seven remote changed files verified with 889 unchanged and zero deleted. The remote tree has 896 files; the bounded local source archive has 514. Their different totals and histories are intentional.

This new evidence/documentation checkpoint is not yet committed, mirrored or published when this dated report is written. Its intended five-path scope excludes runtime binaries, raw media/logs, private Planning, historical executor files and the old terminal-unknown 35-file request. Commit explicit paths, immediately independently restore source/full-history in Notion, then publish the exact permitted delta on original GitHub ancestry. Later publication receipts own actual completion, not a retroactive rewrite of this record.

## 9. Decisions Made During Execution

Reuse the real service consumer path rather than label calibration as product proof. Keep one bounded attempt with fixed controls and a separately generated input. Demonstrate narrower fresh-instance recovery instead of reviving invalidated tokens or calling it same-service behavior. Preserve the cancellation artifact, warning diagnostics and raw counter semantics. Retain the read-only warning diagnosis and its untraced topology inference before broadening native workbench proof, not as a reason to erase measured successes or pretend runtime qualification is complete.

## 10. Items That Need Human / Coordinator Review

No routine owner decision is required to preserve this result or investigate diagnostics read-only. The coordinator must reconcile that diagnosis and independently review any subsequent command/runtime or app integration change. A useful next app-code slice is one explicit developer Keep720 workbench choice using the existing shell/theme, with unchanged defaults and no arbitrary renderer-supplied executables. Confirm that the UI can prepare a supported range without requiring an unsupported Full operation first. After cancellation, initially require closing/relaunching the developer session unless a separately reviewed fresh-service lifecycle is implemented. Native execution requires actual Electron/display availability and its own bounded review; it is not approved merely because a launcher can be written.

## 11. Current Result

The first actual normal-service proof passed all five bounded cases on exact reviewed source and runtime. Three owned outputs published; collision bytes survived; active encoding cancellation published nothing; a new runtime/service recovered. The independent saved-output audit corroborates the narrow result. Duplicate-option behavior is explained and missing sysfs strongly explains the untraced pool failure; native threading/performance remains unqualified, broader tests remain failed and no user-facing product activation or release acceptance follows.

This advances precise trim prerequisites [Q2n] beyond pure/VM service tests. It does not close the entire lane, other geometry/audio families, Remux, native GPU/Windows, GUI or packaging. Encoding-phase cancellation also does not prove cancellation during complete-source evidence collection.

## 12. Recommended Next Step

Preserve this evidence checkpoint with the required Git/Notion/GitHub verification. Retain the completed read-only codec/topology diagnosis without running more media or changing acceptance. Then implement and review the smallest useful explicit developer workbench integration using existing architecture, guided by the diagnosis and remaining inherited failures. Reuse this proof rather than repeating long calibration for its own sake. A separately bounded evidence-collection cancellation check remains useful; whole-file/resize/higher-resolution and broader audio/container work follow the agreed 0.7 plan. Keep HDR expansion deferred and packaging last; Ahmed retains final acceptance.
