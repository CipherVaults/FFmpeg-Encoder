# Backend, HDR and runtime planning review — October 11, 2026

**Status: technical planning only; owner review pending.** This appendix proposes qualification and implementation contracts. It neither resumes execution nor accepts the existing candidate changes. Ahmed's latest instruction pauses execution, overriding older action language in AGENTS, Goal 23 and contract 24. The substantive product decisions in those documents remain design inputs: precision audio for trimmed Encode, dedicated App Settings, a D: free-space floor of 25 GiB, a flexible owned F: ledger and fixture downloads capped at 6 GiB. These replace conflicting parts of plan 22. No tests, capability encodes, media jobs, application launches, downloads or production edits were performed for this review.

Human product authority: Ahmed. Strategic review: Ahmed/Blue. Review executor: Codex planning specialist; inherited model configuration is not independently verified by this appendix. Surface: local Codex technical planning. Date: 2026-10-11.

## 1. Evidence and preservation anchors

- Accepted production baseline: `local-v0.6.0^{commit}` = `be92b12205d299b6d3bdcc2fd4b2e3a02f928862`. HEAD at review = `8bac91f5647bc1e3d54e0920749fbf990fea59cd`. The annotated tag object itself is a different hash; use the peeled commit when comparing source.
- Existing modified/untracked application, diagnostics, media-evidence, tests and planning files remain untouched. They are surviving candidate work, not accepted production behavior. The parent owns their reconciliation.
- Reused [plan22](../../../22_Reviewed_0.7_Technical_Plan_2026-10-11.md), [Goal23](../../../23_Approved_0.7_Candidate_Goal.md), [contract24](../../../24_0.7_Implementation_Contract.md) and [shared contracts26](../../../26_0.7_Shared_Contracts.md). The later parent planning document must reconcile obsolete clauses; this appendix is not a competing authority registry.
- Reused [environment snapshot](runtime-observations/environment.json), [FFmpeg version](runtime-observations/ffmpeg-version.txt), [ffprobe version](runtime-observations/ffprobe-version.txt), [license output](runtime-observations/ffmpeg-license.txt), six saved encoder-help files and [transform help](transform-runtime-help.txt). No runtime command was repeated here.
- The saved October 11 inventory found RTX 5060 and Windows driver version `32.0.16.1714`. It did not find an AMD or Intel GPU. CPU/32 GiB context is consistent with the owner's Ryzen 5600X machine. Read-only device inventory is not an initialization or encoder test.
- Saved binaries report paired `9.0.1-full_build-www.gyan.dev`, with AMF, libvpl, NVENC, Vulkan, libplacebo and libzimg compiled. Wrapper presence and help output establish syntax discovery, not device availability or accepted output.

Evidence vocabulary used below: **accepted** = recorded v0.6 production behavior; **observed** = saved local read-only output or inspected source; **vendor-documented** = an expectation from a primary source; **proposed** = design awaiting review/execution; **unverified** = no applicable real-device or display evidence. A vendor claim never upgrades a local cell to verified.

The Phase 1 benchmark remains paused at its independent visual-review gate. Nothing here chooses winners, consumes its run budget, changes its runtime or revises its quality recommendations.

## 2. Preserve the actual existing production path

At the accepted tag, `src/media.cjs` contains the canonical encoder contribution around lines104–113. Current source has no diff for this file or `src/capabilities.cjs`, so the following is also directly inspectable there:

| Accepted profile/recipe | Exact meaningful ordinary encoder contribution |
|---|---|
| CPU H.264 | `libx264`, preset `slower`, CRF24 |
| CPU H.265 | `libx265`, preset `slow`, CRF25, `-x265-params aq-mode=3:psy-rd=2` |
| CPU AV1 | `libsvtav1`, preset6, CRF32 |
| Ordinary NVIDIA H.264/H.265/AV1 | Respective NVENC encoder, preset `p5`; CQ28/25/30 respectively; `-rc:v:0 vbr -cq:v:0 <value> -b:v:0 0 -tune:v:0 hq` |
| HEVC Archive Quality | `hevc_nvenc`, preset `p7`, CQ29; same VBR-CQ fragment with `-tune:v:0 uhq`, plus `-multipass:v:0 fullres -bf:v:0 4 -b_ref_mode:v:0 each` |

The table omits stream mapping, preservation, pixel format and other source-dependent arguments; it is not a fabricated complete command. The real builder remains authoritative for those. Ordinary Full/KeepSource/SDR CPU/NVIDIA must continue down that exact path. Do not insert a universal filtergraph, hardware upload, timestamp reset or new rate-control helper into it just to make a new adapter abstraction look uniform.

Current accepted capability checks already execute the production builder and validate outputs. Their existing successful records should be reused for the accepted runtime, not repeated in planning. New AMF/QSV support cannot be implemented by appending profile names alone: today's quality branch assumes CPU CRF versus NVIDIA CQ and today's profile/pixel rules are not a general backend contract.

## 3. Practical backend matrix

All new cells initially target progressive 4:2:0. Support 12-bit, 4:2:2, 4:4:4, alpha and interlaced inputs only through an explicitly qualified later extension or precise refusal. A wrapper accepting a pixel format does not establish that its codec can produce that bit depth.

| Backend/codec | Initial output depth to qualify | Native quality model and controls | Local status |
|---|---|---|---|
| AMF H.264 | 8-bit only | CQP: I/P/B QP where usable,0–51; QVBR quality level0–51 as a separate mode; symbolic speed/balanced/quality/high_quality presets | Help observed; every hardware cell unverified |
| AMF HEVC | 8/10-bit, Main/Main10 | CQP: I/P QP0–51; **no `qp_b` option in the shipped HEVC wrapper**. QVBR quality0–51 separately. Same symbolic preset names, different underlying numeric values | Help observed; hardware and HDR behavior unverified |
| AMF AV1 | 8/10-bit, Main | CQP: I/P/B quantizer index0–255; QVBR quality remains0–51. Preset numeric encodings differ again | Help observed; hardware and HDR behavior unverified |
| QSV H.264 | 8-bit only | ICQ1–51; CQP0–51 with explicit I/P/B derivation; preset veryfast→veryslow | Help/source observed; hardware unverified |
| QSV HEVC | 8/10-bit, Main/Main10 | ICQ1–51 and CQP0–51 independently qualified. Do not enable12-bit/4:2:2 merely because help advertises their input formats | Help/source observed; hardware and HDR behavior unverified |
| QSV AV1 | 8/10-bit, Main | CQP initial quantizer0–255; ICQ only if the exact hardware/runtime reports and successfully uses it. Its availability must not be inferred from HEVC ICQ | Help/source observed; hardware unverified |

Local syntax evidence: [AMF H.264](runtime-observations/h264_amf.txt), [AMF HEVC](runtime-observations/hevc_amf.txt), [AMF AV1](runtime-observations/av1_amf.txt), [QSV H.264](runtime-observations/h264_qsv.txt), [QSV HEVC](runtime-observations/hevc_qsv.txt), [QSV AV1](runtime-observations/av1_qsv.txt). AMF preset numbers are not portable between these codecs; pass validated symbolic names. `-1`/automatic help values should not be exposed as if they were concrete quality recommendations.

AMD's hardware table distinguishes AV1 decoding from encoding: VCN2/3-era support cannot be assumed to encode AV1; VCN4/5 families include AV1 encoding, while some products such as Navi24 have no encode engine. H.264 remains8-bit in that table; HEVC and supported AV1 cells include8/10-bit. Use this information for explanations, not a brittle model-name allowlist. [AMD hardware support](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/GPU-and-APU-HW-Features-and-Support)

Intel graphics generation and runtime selection likewise matter. Intel documents newer Xe runtime and older Media SDK implementations separately; support for an API family is not support for every codec on every device. Its Hyper Encode guide explicitly distinguishes DG2 AV1 availability from TGL. Arc/Core Ultra generation expectations therefore need per-device verification, not one broad “Intel supported” badge. The public `vpl-gpu-rt` Linux repository is useful architectural evidence but not a Windows installation recipe. [Intel implementations](https://www.intel.com/content/www/us/en/developer/articles/technical/overview-of-onevpl-examples-and-tools.html), [DG2/TGL feature distinction](https://github.com/intel/vpl-gpu-rt/blob/main/doc/HyperEncode_FeatureDeveloperGuide.md), [runtime repository](https://github.com/intel/vpl-gpu-rt#supported-platforms)

### Functional starting values, not benchmark recommendations

Keep the accepted CPU/NVIDIA defaults above unchanged. For new backend qualification, use the following explicit engineering seeds, labelled unverified until actual evidence exists:

- AMF H.264/HEVC: `-usage:v:0 transcoding -quality:v:0 balanced -rc:v:0 cqp -qp_i:v:0 24 -qp_p:v:0 24`; add `-qp_b:v:0 24` only for the wrapper/cell that supports it. AV1 uses128 for the corresponding native QP controls. These seeds do not imply matching CRF24/25 or NVIDIA CQ24.
- AMF QVBR: use the same usage/preset with `-rc:v:0 qvbr -qvbr_quality_level:v:0 25`; do not carry CQP controls into that mode. Treat any required bitrate/HRD constraints as a distinct resolved cell, exposed in details. A rejected QVBR setup must not silently become CQP.
- QSV H.264/HEVC ICQ: preset `medium`, `-global_quality:v:0 25`, no QScale/CQP flag and no lookahead recipe. QSV CQP uses `-q:v:0 24` with explicit I/B factors1 and offsets0; AV1 CQP starts at128. Bind the resolved QPI/QPP/QPB to observed runtime evidence rather than assuming generic FFmpeg defaults. Freeze the settings for the job; no mid-encode quality adjustment is proposed.

These are encoder fragments, not executable commands: device binding, maps, format/profile, staging, source evidence and preservation come from the prepared production plan. QSV's pinned9.0.1 implementation distinguishes QScale→CQP from global_quality→ICQ, clips initial AV1 QP to0–255 and ICQ to1–51, and can report the effective rate-control mode. Its runtime may select a different mode; successful exit alone is insufficient. [FFmpeg QSV documentation](https://ffmpeg.org/ffmpeg-codecs.html#QSV-Encoders), [pinned QSV implementation](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.1/libavcodec/qsvenc.c)

Do not call these values “Tested Default” before applicable native qualification, and never call them quality-equivalent. No cross-vendor Archive recipe is proposed. Leave native expert controls visible; assistance must reveal the actual mode and options it applies.

## 4. Adapter and device contract

Use backend-specific typed settings, with a discriminated rate-control mode. An AMF CQP record contains bounded native QPs; an AMF QVBR record contains its own quality and any qualified constraints; QSV ICQ and CQP are different records. Reject fields belonging to another backend/mode. Renderer never supplies vendor dictionaries, `qsv_params`, arbitrary arguments, filtergraphs or filesystem paths.

One canonical main-owned adapter produces normalization, displayed help, encoder-option contribution, capability-probe contribution and descriptive provenance. Prepared-plan details expose the same resolved argv used for execution. Preserve all no-overwrite, publication, cleanup, explicit re-encode and source-reservation guarantees around this adapter.

Represent a capability cell using executable identity, runtime identity, selected adapter identity, driver, codec, output depth, rate-control mode and decode/filter/upload pipeline. Bind a main-issued opaque device token to a real adapter identity, not merely its current enumeration ordinal. Persisted device preferences are hints to revalidate, not authority. Driver changes, device reorder/removal, runtime replacement or policy changes stale the relevant cells and plans.

On Windows, qualify one explicit selected D3D11 device and the relevant AMF or derived QSV path. Start with software decoding and explicit, high-precision transforms for new transform operations, followed by the qualified format/upload boundary. An AMF system-memory input path can be a separately named cell if the wrapper owns upload; do not pretend it is the same pipeline. Do not require Vulkan for ordinary SDR or the common software HDR path; the Dolby-aware libplacebo alternative is separately gated. Zero-copy decode is not a prerequisite for useful first support.

CPU-only startup must succeed without loading every optional GPU backend or running every probe. Cheap discovery establishes “not detected,” “runtime missing,” or “unverified”; explicit first use/verification runs bounded selected cells later. Show concrete reasons such as “HEVC10-bit available; AV1 not verified on this adapter” or “requested ICQ was not honored.” Offer a deliberate switch to another backend rather than taking it automatically.

The Intel Windows dispatcher searches driver-store/runtime locations and can also consult executable/PATH/custom-search locations. Preserve fixed executable trust, an owned working directory and a controlled child environment; do not import arbitrary user-supplied runtime search paths into capability jobs. Record which runtime and adapter actually initialized. Driver deployment is a machine-global action and not silently performed by the application. [Intel VPL session and discovery documentation](https://intel.github.io/libvpl/latest/programming_guide/VPL_prg_session.html)

## 5. Bounded capability qualification after approval

This is a proposed future test specification, **not permission to execute it now**. It qualifies correctness and availability, not perceptual superiority or benchmark speed.

1. Read exact candidate help/version after any independently checkpointed runtime trial. Compare wrapper option changes to the saved9.0.1 observations. Enumerate devices without launching media work.
2. For each selected SDR cell, use an owned deterministic 320×180, 30fps, 96-frame fixture with motion and color patches; NV12/8-bit or P010/10-bit as requested. Use the functional seed above, Matroska staging and explicit BT.709 limited-range signaling. Keep the same fixture/frame identity across vendors.
3. Run one selected encode, one bounded metadata inspection and one full decoded verification sequentially. Suggested caps: 30 seconds encode, 20 seconds decode, 1 MiB structured stdout, 256 KiB stderr tail and 50 MiB owned output allowance. Cancellation must stop and await the owned child. A cap is a failed/unverified cell with diagnostics, not permission to increase limits repeatedly or downgrade options.
4. Distinguish five codec/depth cells per vendor (H.2648, HEVC8/10, AV18/10), then test each offered native mode separately. Ten SDR configurations/vendor is a maximum coverage map for two modes, not a startup sweep. Skip impossible/absent cells with a precise reason. Additional low-power/lookahead modes are out of the initial recipe surface unless independently justified.
5. Confirm codec/profile/depth/chroma, frame count/cadence, range/color, complete decode, selected device and **actual native mode**. QSV verbose output offers effective-mode evidence; AMF needs corresponding inspectable settings evidence from the exact wrapper/runtime. If actual-mode verification is unavailable, report that gap instead of declaring the cell proven from argv alone.
6. Qualify HEVC10-bit PQ and HLG independently of SDR. Use numeric synthetic fixtures for signal correctness, then representative legitimate HDR clips for metadata/motion and integration. Every native/vendor cell still requires actual vendor hardware; mock/source tests do not establish it.
7. Run real application prepare→start→progress→cancel/close/restart→validation→publication checks for each newly offered backend and selected transform family. A direct FFmpeg probe is necessary evidence but does not close application acceptance.

No automatic retries with CPU, different depth, low-power mode, a different adapter or different rate control. A purposeful future trial of a different cell is visible and separately recorded. Do not let hot telemetry or slow diagnostic persistence delay cancellation; keep invocation output bounded and transitions attributable.

## 6. HDR support matrix and semantic corrections

Accepted 0.6 is SDR-only and correctly does not equate 10-bit with HDR. The following is proposed 0.7 direction; none is already proven by the saved filter-help output.

| Input and chosen operation | Initial planned result | Required evidence or limitation |
|---|---|---|
| Ordinary SDR, Full/unchanged | Existing accepted path | No implicit transform or retag; preserve current defaults |
| PQ with valid BT.2020 signal, including HDR10 metadata where present | HEVC Main10 PQ, preserved valid static metadata where representable | Validate encoded bitstream and container signaling/values; PQ alone is not a guarantee of HDR10 metadata |
| Non-Dolby HLG | HEVC Main10 HLG | Preserve transfer/primaries/matrix/range; qualify on the exact encoder/depth/container |
| Supplied Dolby Vision profile8, compatibility4 HLG | Deliberate compatible HLG base-layer re-encode | Clearly disclose that Dolby Vision metadata is not retained; no invisible discard or “Dolby Vision preserved” label |
| Same supplied Dolby input, selected advanced route | Dolby-aware libplacebo rendering to BT.2020 PQ Main10 | Show metadata applied versus discarded; resulting PQ is neither retained Dolby Vision nor automatically HDR10; requires Vulkan/filter qualification |
| Qualified PQ/HLG→SDR | Explicit high-precision tone map to BT.709 SDR | Never tagging-only; numerical and visual evidence; remove stale HDR/Dolby metadata |
| Dolby profile5, dual-layer profile7/FEL or unknown contradictory variants | Precise refusal initially unless independently qualified | Do not assume an SDR/HLG-compatible base layer or discard enhancement layers |
| Dolby full remux | Separate container/direction-qualified passthrough | Stream copy, signaling, relationships and provenance marker roundtrip all required; encoding rules do not prove remux support |

HEVC Main10 is the initial HDR output core per available backend. AV1 HDR, H.264 HDR and non4:2:0 HDR should not be claimed simply because input/output depth exists. Capability is a codec×depth×signal×pipeline×container property. AMD/Intel HDR fields remain externally hardware-unverified on this machine even after local software fixtures pass.

### Evidence must survive normalization

Keep raw bounded normalized evidence plus typed states for mastering-display rationals, MaxCLL/MaxFALL, transfer/primaries/matrix/range, bit depth, chroma, HDR/Dolby side data, Dolby profile/compatibility flags and sampling coverage. Missing is not zero; unknown is not SDR; conflicting sampled values must not be flattened into a convenient first/last value. A cache schema/policy revision must invalidate insufficient old evidence.

Static HDR serialization needs backend-specific handling and output checks. An AVFrame carrying side data or an output color tag does not prove the chosen encoder wrote equivalent signaling. Do not invent mastering data when absent, turn invalid MaxCLL into a trustworthy peak, or announce complete dynamic-metadata coverage from a bounded sample. Preserve content and timeline checks alongside the HDR contract.

Qualify each auxiliary stream independently. The supplied sample's three `mebx` tracks are not audio, generic harmless metadata or authorization to discard. A selected HDR route does not grant stream omission. Remux marker roundtrip is necessary for generated-output recognition, but not sufficient to establish stream/content preservation.

### Common HDR→SDR and Dolby-aware paths

The recommended common path is software decode→explicit color/range interpretation→high-precision linear RGB→tone mapping→BT.709 output conversion→qualified encoder packing/upload. Start qualification with Hable, nominal100nit SDR and an explicit desaturation choice. Validate PQ scaling and the proposed HLG1000nit/gamma1.2 interpretation using numerical patches before encoding real footage. These are transparent transform assumptions, not universally correct scene/display luminance. Expose missing-peak assumptions and permit a precise unsupported result for contradictions.

The advanced libplacebo path must remain separate. Its documentation says applying Dolby RPU removes that metadata downstream and interprets the result as BT.2020 PQ; it also performs internal4:4:4 processing even without changing dimensions. It is therefore not a pixel-neutral pass-through. Dynamic peak detection depends on frame history, so reproducibility needs explicit fixed choices. [FFmpeg libplacebo documentation](https://ffmpeg.org/ffmpeg-filters.html#libplacebo)

For the already planned bounded supplied-file experiment, retain two4second windows `[1,5)` and `[15,19)`, comparing HLG base, PQ with Dolby application off, and PQ with it on. Fix `apply_dolbyvision`, `peak_detect=0`, `contrast_recovery=0`, `deband=0`, output transfer/primaries/matrix/range/depth and timestamps; do not rely on differing automatic settings. Do not invent a `target_peak` option absent the shipped help. Review actual output differences without presuming on/off must differ or that metadata consumption guarantees superior appearance. At most two subsequent full-sample confirmations were proposed; a2GiB experiment allowance is a forecast, not a replacement for the current flexible F: ledger. No such jobs are authorized in this planning task.

The HDR corpus can remain small: two PQ clips at different cadence, one non-Dolby HLG clip, the supplied Dolby-HLG sample, plus deterministic signal/metadata fixtures and an optional permitted negative Dolby case. Fixture acquisition belongs to later approved execution, with origin/permissions, byte accounting, hashes and no private-media uploads. Numeric/output validation and HDR-display judgment must be reported separately; do not claim unseen display acceptance.

## 7. Integration and failure contracts

Use the shared `RequestedOperation`, immutable `PreparedPlan`, `ExpectedOutput` and `JobResult` contracts. The prepared plan binds source identity/evidence, effective settings, device/cell revision, output destination and specific stream dispositions. Proposed per-file settings and App Settings inheritance may change drafts but never mutate prepared/queued/running operations. Switching encoder, depth, HDR choice, scale or range invalidates affected preparation and temporary per-file decisions appropriately.

Transform composition must be qualified as a graph: source timeline/rotation/SAR→requested interval/geometry→color operation→encoder packing, with selected audio following the same presentation interval. Trim precision audio and its delay/padding contract are the newer approved product direction. Do not inherit plan22's copied-audio100ms target as precision acceptance, erase A/V offsets by independently zeroing streams, or silently resample/downmix. HDR, scaling and trim combinations need specific integration tests; independent component passes alone are insufficient.

Failure should leave a precise result: unavailable mode/device, unqualified transform, invalid source evidence, output validation failure, changed source or publication collision. Keep valid completed staging when the existing retained-output contract requires it. No successful media job should delete an original or completed output. Recovery must not treat descriptive logs/provenance as authority to resume, publish or clean files.

Security regression coverage should exercise forged backend/mode/device IDs, raw dictionaries/argv/filter injection, oversized/malformed metadata, path replacement, source grants, renamed outputs, cancellation during each phase, publication races, child failures and corrupted persistence. Escape technical descriptions as text. Resolved command visibility remains read-only and comes from the canonical plan.

## 8. Runtime and dependency trials remain separable

Saved installed versions: Electron44.2.0 (MIT), Packager20.3.0 (BSD-2-Clause) and Playwright1.63.0 (Apache-2.0). No evidence justifies blanket dependency replacement. Keep Packager/Playwright unchanged unless a demonstrated compatibility/security need arises.

Plan22's Electron44.7.0 trial is justified as a same-major maintenance step: its October7 release includes upstream Chromium/ANGLE/V8-related fixes. This is not proof of application compatibility. After renewed execution authority, use a dedicated checkpoint and test secure renderer/preload/protocol/IPC, dialogs, lifecycle, native UI and packaging. Do not mix its failures with backend/filter changes. [Electron44.7.0 release](https://releases.electronjs.org/release/v44.7.0)

A separately pinned paired FFmpeg/ffprobe9.0.2 trial is also justified: the upstream changelog includes parser/decoder bounds fixes, Dolby-RPU padding handling and timestamp/format-related corrections. Re-inspect the exact selected distribution's build options and record its hashes; upstream tag availability is not proof that a specific Windows distributor's archive has the required filters. Retain9.0.1 accepted artifacts and the benchmark's pinned runtime unchanged. Run proportional accepted-path and new-path checks only after approval. [Pinned9.0.2 changelog](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.2/Changelog)

The saved Gyan build reports GPLv3-or-later. Keep exact package notices/source-offer evidence with candidate packaging; an upstream source link is not automatically a complete corresponding-source package for a downstream configured binary. Public distribution remains a separate approval boundary. Driver upgrades, global runtimes and repair actions are outside these application-local trials.

## 9. Three unresolved candidate findings to revisit during execution

These were rechecked by reading current source only. They are future review inputs, not fixes or reasons to discard surviving work. Earlier passing tests do not close these untested conditions.

| Finding | Current evidence | Required future correction/proof |
|---|---|---|
| Renderer-loss cancellation waits on disk-backed logging | `main.js:110–117` awaits `service.recordIncident` before `cancelCurrent` | Begin owned-child cancellation promptly; coordinate bounded durable logging without letting a slow/faulted journal extend invisible work. Simulate delayed persistence and renderer loss. |
| Per-file inspection failure drops FFmpeg/ffprobe stderr | `src/encoder-service.cjs:494–509` saves message/code/identity diagnostic, then emits FILE_INSPECTED without error.stderr | Preserve the bounded relevant stderr tail and invocation/stage correlation. Exercise a structured inspection failure whose short message alone does not explain the cause; review privacy/export redaction. |
| Typed relationship evidence overstates certainty | `src/media-evidence.cjs:221–242` validates IDs/membership and per-entry count, but does not reconcile top-level declared program/group counts or type/PID validity | A declared nonzero count with an empty array must not become confidently empty; malformed group type or PCR/PMT fields must be unknown/malformed or explicitly outside a narrowly named membership-only view. Preserve raw bounded evidence and add negative cases before P/Q uses it for admission/remux. |

The third finding does not establish that accepted0.6 already loses media; it concerns the candidate schema's promise to later operations. Do not conflate absent relationships with a complete empty result, and do not accept a remux based solely on a flat stream list.

## 10. Acceptance, rollback and recommended review outcome

Recommended staged sequence: reconcile source/evidence/diagnostics contracts and the three findings; checkpoint Electron trial; checkpoint paired FFmpeg trial; implement typed adapters and software fixtures; qualify available device cells; qualify HDR transforms; qualify range/scale/remux interactions; integrate native UI; then package and independently review requirement-to-evidence coverage. N–S labels and formal authority remain the parent's plan responsibility.

Required evidence layers are distinct:

1. Deterministic builder/parser/state/security tests, including malformed/unknown values and refusal paths.
2. Real local CPU/NVIDIA prepared-plan, transformed output, preservation, progress/cancel/restart and source/publication behavior.
3. Real AMD and Intel device evidence covering every enabled codec/depth/mode/pipeline cell. Without hardware, the candidate may retain an honestly unverified implementation, but cannot claim vendor release acceptance.
4. Real HDR signal/metadata/decode evidence and separately identified HDR-display judgment.
5. Fresh extracted portable candidate with pinned runtime, restricted PATH/offline operation and the same device/transform refusal semantics; independent machine compatibility remains distinct from same-machine portability.

Use independent requirement-to-evidence review at significant boundaries and a parent synchronization pass across Current State, Continuation, Roadmap, execution index/summary, technical/security docs and user-facing support descriptions. No broad historical rerun is needed when a requirement is covered by unchanged accepted evidence; changes to runtime/filter/metadata policy need proportional new proof.

Version capability/evidence/cache/preferences/provenance schemas independently. Stage new app data separately from accepted0.6; a downgrade must not consume new capability cells or irreversible preference migrations. Old output provenance remains readable, while new descriptive fields never grant authority. Keep accepted ZIP/tag and benchmark evidence untouched. A failed trial reverts its own candidate checkpoint/data namespace rather than rewriting accepted history.

High risks: HDR signal correctness and Dolby/ancillary handling; effective native mode/device truth; timestamp/audio/transform composition; preservation of unknown stream relationships. Medium risks: runtime upgrades, per-cell invalidation, driver/runtime diagnostics, retained-output lifecycle. Lower risks with canonical data and normal UI tests: profile-specific labels/help, explicit unsupported reasons and support-table presentation.

Owner review should approve the supported/provisional/excluded matrix and the proposed functional-only native seeds, with acceptance limits visible. It need not choose a universal quality number, redo the paused benchmark or settle AMD/Intel hardware quality in advance. Until execution is explicitly resumed, this document authorizes no jobs and the existing uncommitted implementation remains unaccepted.
