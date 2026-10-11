# 0.7 transform, Time Range and remux planning review

Date: October 11, 2026. Human product authority: Ahmed. Mother Thread / strategic review: ChatGPT — GPT-5.6 Sol / Jerry. Planning executor: Codex — GPT-6 Astra — Ultra effort; specialist transform/remux review. Surface/mode: Codex planning.

**Status: planning review, with candidate execution paused.** This appendix authorizes no execution. The latest direct instruction controls over execution language still present in recovered local records. Existing candidate source changes are preserved; their existence does not establish native transform/remux acceptance. The benchmark remains separately paused at its visual-review gate, with no new feedback or recipe decision inferred here.

## 1. Authority, evidence and compatibility boundary

Read this with the current [plan27](../../../27_0.7_Technical_Plan_For_Review.md), preserved [plan 22](../../../22_Reviewed_0.7_Technical_Plan_2026-10-11.md), [saved candidate amendments 23](../../../23_Approved_0.7_Candidate_Goal.md) and [shared contracts 26](../../../26_0.7_Shared_Contracts.md). The recovered amendments retain substantive product direction: precision-oriented audio for non-Full Encode ranges; dedicated App Settings; D: free-space floor of 25 GiB; flexible forecast-based space use on F:; and a separate 6 GiB fixture-download allowance. Their former execution instruction is paused. Exact audio rates, tolerance values, container cells and filter choices below remain engineering proposals requiring qualification, not owner-accepted performance claims. In particular, plan 22's copied-audio default and universal 100 ms interpretation must not override the later audio direction.

The accepted `local-v0.6.0` implementation in `src/media.cjs` is the compatibility anchor. It encodes the selected primary video, copies supported audio/subtitles/attachments, preserves mapped metadata/chapters/dispositions, uses a narrow Samsung creation-time representation rule, and outputs Matroska. It refuses unsupported data preservation and HDR. Ten-bit pixels alone do not establish HDR. It has no accepted scaling, range or general remux contract. Preserve the ordinary Full / Keep Source / SDR argv path and established CPU/NVIDIA settings without injecting filters, timestamp shifts or uploads merely because new builders exist.

Evidence levels must stay separate:

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Accepted 0.6 source and acceptance records | Existing behavior and invariants | New 0.7 behavior |
| [Saved pinned-runtime help](transform-runtime-help.txt) | Advertised FFmpeg 9.0.1 filter/muxer option syntax | A usable codec/device/container combination |
| [Supplied metadata](supplied-media-probe.json), [admission delta](probe-admission-delta.json), [track relationships](resolve-stream-groups.json) | Observed fields and relationships for five supplied inputs | Decode success, historical failure reproduction, output correctness |
| Preserved interrupted candidate changes | Work available for later reconciliation | Completed milestone or owner acceptance |
| Future direct/native/packaged checks | Their specific measured properties | Untested hardware/display or universal compatibility |

No new probe, decode, encode, remux, application launch or test was run for this appendix.

## 2. Concrete input mappings and bounded failure hypotheses

| Supplied input | Saved observation | Planning consequence |
|---|---|---|
| `iPhone 13 Pro 4K60p.mov` | 21.658333 s; HEVC Main 10, 3840×2160, HLG / BT.2020; Dolby Vision profile 8, compatibility 4, RPU present, no enhancement layer; AAC 44.1 kHz; three `mebx` data tracks. SAR/DAR are **not reported**. | Qualify HDR image processing and ancillary-track preservation separately. Do not infer square pixels from an absent field, equate `mebx` with disposable junk, or relabel base-layer HLG as retained Dolby Vision. |
| `Freelanzwya Sep 26th Live Workshop.mp4` | Resolve-tagged AV1, 1080p60, BT.709, AAC 48 kHz; `tmcd` data track with video/timecode Track Reference relationship. | A concrete candidate for a preservation-policy refusal. A copied timecode text tag does not preserve the original timed track and its relationship. |
| `107_new.mp4` | H.264 High, 852×480, 25 fps, AAC; SAR 640:639 and DAR 16:9; no color tags. | An important anamorphic geometry fixture. Do not replace 852:480 with assumed square-pixel aspect. Missing color tags alone do not prove its reported failure. |
| `108_new.mp4`, `109_new.mp4` | H.264 High, 1280×720, 25 fps, AAC, SAR 1:1; missing color tags. | Useful laptop-candidate inputs; their relationship to each historical incident still needs explicit mapping. |

Production-equivalent saved metadata probing for the Resolve and iPhone files completed with exit 0 and empty error-level stderr. Warnings about unknown data codecs at warning verbosity do not establish decoder failure or an invalid probe. The narrow observed issue is an ancillary-stream representation question. The interrupted parent run has since recorded accepted inspector/builder admission outcomes: Resolve UNSUPPORTED_STREAM,107/108/109 AMBIGUOUS_COLOR and iPhone UNSUPPORTED_HDR. Reuse those records; native UI/decoder/encode evidence and the historical laptop mapping remain separate future steps. Keep private location metadata out of owner-facing diagnostics exports; preservation inside an explicitly requested output is a different policy from disclosure in reports.

## 3. Single-output scaling: requested box versus effective geometry

Offer Keep Source, 2160p, 1440p, 1080p and 720p. Treat the numeric choices as **bounding boxes**, not a command to force every source to that height:

| Choice | Landscape box | Portrait box |
|---|---|---|
| 2160p | 3840×2160 | 2160×3840 |
| 1440p | 2560×1440 | 1440×2560 |
| 1080p | 1920×1080 | 1080×1920 |
| 720p | 1280×720 | 720×1280 |

Main resolves coded width/height, rational SAR and qualified orientation. Before orthogonal rotation, display aspect is `codedWidth × SAR / codedHeight`; 90°/270° rotation exchanges displayed axes. A chosen box never authorizes cropping, stretching, padding, frame-rate conversion, deinterlacing or upscaling. A source already fitting the box uses its existing geometry/SAR without a gratuitous resize. Keep Source preserves its qualified coded geometry and orientation path.

For a real downscale, compute a uniform fit factor bounded by 1 in display coordinates. Search nearby aligned integer dimensions within the box, with backend/chroma alignment constraints, rather than separately rounding both axes without checking the result. Prefer square-pixel output where relative display-aspect error is at most **0.1%**, an explicit engineering tolerance. Otherwise preserve an exact residual rational SAR if the chosen backend/container cell supports it; if neither representation is qualified, explain the unsupported resize. Normalizing anamorphic sampling density is distinct from enlarging displayed content and must appear in resolved details.

Examples: 3440×1440 square-pixel ultrawide fits a 1080p box as approximately 1920×804, not 2580×1080. The DAR rounding error is about 0.035%. The supplied 852×480 SAR 640:639 file already fits the 720p box: leave its geometry intact instead of synthesizing an unnecessary square-pixel enlargement. For missing SAR/orientation, Keep Source can remain available under existing behavior, but resizing requires a qualified decoder/container interpretation; absent metadata is not affirmative square-pixel evidence.

Normalize a qualified rotation once during an actual resize and remove the obsolete rotation instruction so a player does not rotate twice. Refuse arbitrary affine rotation, unsupported mirrored matrices, changing resolution, alpha removal or interlaced conversion until their own explicit cells exist. Respect source frame timestamps throughout.

**Proposed scaler:** a shared CPU filter path initially, with main-resolved numeric dimensions and rational SAR. Use the pinned `scale` Lanczos path with accurate rounding for ordinary SDR, and an explicitly qualified high-precision HDR/color path for HDR. Lanczos is a reproducible engineering choice, not a proven universal visual optimum; edge-ringing fixtures are required. Saved help advertises `force_original_aspect_ratio`, `force_divisible_by`, `reset_sar` and zscale Lanczos, but convenience options do not replace the planner's no-upscale/aspect proof. No raw renderer filter expression is accepted.

Subtitle geometry is part of preparation: ASS canvas coordinates, bitmap subtitles and attached fonts need operation-specific handling. “The track was copied” does not prove it still renders appropriately after resizing. A refused combination gets a precise target/change/omission decision, never silent subtitle loss or unrequested burn-in.

## 4. One per-file Time Range and a common presentation clock

Full is the initial state. Otherwise store integer microseconds `[startUs,endUs)` relative to the selected video presentation origin, with an explicit source identity and duration basis. Require finite bounded values, nonempty interval, and end within the verified timeline. Applying a range to selected files is explicit and validates each independently; never silently clamp shorter files. Unknown/discontinuous timelines retain Full or require a bounded qualification step.

Let the source video origin be `V0`, with absolute requested interval `A = V0 + start` and `B = V0 + end`. Select video frames by actual presentation timestamps `A ≤ PTS < B`, using rational time-base arithmetic. Do not derive VFR frame membership from average FPS. Record requested interval, first/last retained frame PTS and effective presentation extent. The last retained frame can extend beyond B by up to its actual presentation duration; this disclosed frame-boundary result is not a lossless arbitrary-time cut. Do not synthesize duplicate end frames or change cadence to disguise it.

All audio streams use the **same A/B origin**, retaining meaningful relative offsets and internal gaps. Do not independently apply `PTS-STARTPTS` to each track, which can erase an original delay. Decode suitable preroll near an earlier keyframe, trim decoded content, and rebase with one shared origin; avoid decoding an entire multi-hour prefix merely to make a late selection.

Proposed filter construction is typed, generated and tested in main:

- Video: rational bounds converted to the filter's time base; `trim` on the corresponding start/end PTS, followed by `setpts` subtracting A in that time base.
- Audio: a known decoded sample-rate time base, selection of samples at or after A and before B, followed by `asetpts` subtracting the same A. Round each boundary deliberately to sample ticks and report the resulting bound; do not confuse `atrim` sample timestamps with video time-base ticks or count-based sample indices.
- Use one coherent boundary mechanism per filter. No automatic `apad`, asynchronous resampling, loudness processing, speed adjustment or `-shortest` to conceal differing track ends.

The candidate seek strategy uses timestamp-aware input seeking and retained timestamps, then explicit filtering/rebasing; exact argv must be proven on the shipped build before it becomes a production template. Input seeking can begin before a keyframe; accurate transcoding seek discards preroll. `-seek_timestamp` distinguishes absolute timestamp seeking from offsets relative to file start. `-copyts` alone does not guarantee final mux timestamps. These distinctions matter for nonzero-start TS and VFR inputs. [FFmpeg input/timestamp options](https://ffmpeg.org/ffmpeg.html#Main-options)

`trim` and `atrim` do not themselves rebase timestamps. Audio timestamp-based selection differs from counting samples, and combining multiple start/end constraints can retain more than an intended intersection. The planner therefore uses one tested constraint family and separately models rebasing. [FFmpeg trim and audio-trim filters](https://ffmpeg.org/ffmpeg-filters.html#atrim)

### Audio defaults, boundaries and overrides

The confirmed product direction is compatible audio copy for **Full**, and disclosed precision-oriented re-encoding of the entire selected audio interval for **non-Full Encode**. Recommend AAC-LC as the ordinary range policy, with the recovered engineering seeds of mono 128 kb/s, stereo 320 kb/s, 5.1 at 512 kb/s and 7.1 at 768 kb/s. These are proposals to qualify, not inaudibility findings. Preserve sample rate and exact supported channel layout; unsupported or unknown layout/rate blocks that cell instead of downmixing or resampling silently. Actual supplied stereo bitrates vary; no universal 192 kb/s assumption is justified.

Advanced options: bounded AAC bitrate; qualified FLAC in Matroska; explicitly chosen packet-copy audio for individually supported cases. FLAC is lossless relative to the selected representable PCM path, not a restoration of the original lossy recording. If decoded floating samples require integer conversion, disclose and qualify that representation instead of promising bit-identical decoded audio. Packet-copy mode reports packet boundary rounding and makes no sample-accurate claim. Its permitted overhang is derived from the actual packet duration/target contract, not inherited as a universal 100 ms precision tolerance.

For precision mode, propose a decoded selection target of at most one source sample of boundary rounding, plus documented timestamp quantization. This is a filter-stage target only. The encoded/muxed/decoded result must separately account for AAC priming, padding, codec delay, container time scales and player behavior. Measure start/middle/end marker offsets; a proposed **≤1 ms excess synchronization error over the declared quantization bound** is a qualification target, not an already demonstrated guarantee. If a cell fails, diagnose its delay/padding representation, qualify a different explicit cell, or report a limitation; do not silently widen the target to 100 ms. Keep video frame quantization distinct from audio drift.

MP4/MOV edit-list and track-time-scale options exist, but their presence is not proof that a specific player honors trimming correctly. [FFmpeg MOV/MP4 muxer options](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv)

Chapters intersect the retained interval and rebase once. Subtitles active at A need their visible overlap retained, not only events starting after A. Plain-text, ASS-state and bitmap/palette cases have different qualification needs. Unsupported range preservation requires a named per-file decision. Remux remains **Full only** in this scope; no frame-accurate stream-copy trimming claim.

## 5. Directional remux matrix and preservation decisions

Remux is a separate typed operation using explicit stream maps and `-c copy`, not the primary-video Encode builder with a different filename. It must preserve all intended video tracks, including alternatives which the Encode operation deliberately does not encode. **MPEG-TS is an input in the selected 0.7 scope; TS output is not implied and is deferred.** File extension never establishes container or codec compatibility.

The following are proposed qualification cells, not claims that every listed combination already works:

| Direction | Initial useful media cells | Extra conditions / refusal classes |
|---|---|---|
| MP4 → MKV | H.264 / HEVC / AV1 video; AAC, AC-3, E-AC-3 audio | Timed text, data relationships, dispositions and metadata each need target mapping; Dolby metadata is a separate cell. |
| MKV → MP4 | H.264 / HEVC / AV1; AAC, AC-3, E-AC-3 | ASS/SRT, attachments, arbitrary tags, FLAC/Opus are not silently converted or assumed broadly playable. |
| TS → MKV | H.264 / HEVC / MPEG-2 video; AAC, AC-3, E-AC-3, MP2 audio | Start with a coherent single program and validated timestamps. Preserve or explicitly account for ancillary streams and service information. |
| TS → MP4 | H.264 / HEVC; AAC, AC-3, E-AC-3 | Qualify packet/extradata conversion, initial timing and complete track preservation. No implied support for all broadcast data/subtitle types. |
| MOV → MKV | H.264 / HEVC with AAC; representative ProRes + PCM cell separately | `tmcd`, `mebx`, track references and orientation cannot be assumed representable. |
| MOV → MP4 | H.264 / HEVC with AAC initially | Same FFmpeg muxer family does not mean every QuickTime track or metadata item transfers intact. |
| MP4 / MKV → MOV | H.264 / HEVC with AAC; qualified PCM where applicable | Explicit codec/profile/track cells; no automatic AV1 promise from a shared muxer implementation. |

Each source stream and relationship receives exactly one disposition: **preserved**, **named representation-equivalent mapping**, **required container/bitstream representation change**, **explicitly approved omission**, or **unsupported**. Container/bitstream representation change is not permission to transcode video, audio or subtitles. No generic `-ignore_unknown`, optional-all mapping or global “drop data” switch.

Preparation must resolve these cases before Start:

- `mov_text` versus SRT/ASS: do not perform an unannounced subtitle codec conversion. Offer a compatible target or precise omission decision where permitted.
- Fonts, attachments and cover art: attached files and picture streams are distinct; a copied filename is not copied content. Verify attachment bytes where represented.
- Timecode/metadata: preserve a timed `tmcd` track and relationships when supported. A tag containing its starting value is a disclosed lossy description, not equivalent preservation. `mebx` tracks may carry structured timed content; explain that specific limitation without asserting it is useless.
- Programs: for multiple TS programs, require an explicit intended-program decision; do not merge programs casually. Service identifiers/PIDs and transport semantics are not recreated by ordinary Matroska tracks. Distinguish retained media from lost transport-only structure.
- Timestamps: legitimate B-frame PTS reordering is not damage. Require valid decode timestamps and preserved relative presentation timing. Timestamp wrap handling, discontinuities and missing timestamps need their own cells; no hidden `genpts`, packet dropping or continuity repair under “remux.” A necessary common timestamp offset is recorded and validated.
- Bitstream representation: known AAC ADTS/configuration or H.264/HEVC framing changes can be legitimate copy operations, but select only the required pinned-runtime path. Record explicit and known muxer-inserted conversion behavior; changed extradata does not automatically mean changed decoded content. Do not copy a HEVC-specific filter into AV1 by analogy. [FFmpeg bitstream-filter reference](https://ffmpeg.org/ffmpeg-bitstream-filters.html)
- Metadata/dispositions/chapters: target-specific allowlists and documented equivalents, not blanket tag equality or blanket waiver. Preserve meaningful content; expose unsupported semantics. Keep the narrow accepted creation-time alias rule rather than weakening all metadata checks.
- HDR/Dolby Vision copy: bitstream and container signalling both need verification. Stream codec and ten-bit output alone are insufficient evidence of preserved HDR, Dolby profile compatibility, mastering metadata or dynamic metadata.

Outputs retain existing collision, same-folder provenance, source-reservation, publication and owned-stage cleanup protections. Omission permissions bind exact file identity, stream identity, operation and draft revision; restart and meaningful changes invalidate them. They are not authority to delete source media. Remux progress must describe copy progress honestly rather than imply encoder FPS.

## 6. HDR interactions that the transform contract must preserve

The iPhone goal is smaller files with good visible quality while retaining HDR where supported, without silent SDR conversion. Keep the reviewed HDR branches distinct: qualified PQ/HDR10 or HLG preservation; deliberate HDR-to-SDR; and the bounded Dolby-aware alternative.

For the supplied Dolby Vision 8.4-style HLG-compatible evidence, recommend the explicit HLG base-layer route as the usable default qualification target: **HLG retained, Dolby dynamic metadata discarded**, visibly disclosed. Separately qualify the saved `libplacebo` Dolby-aware mapping route to a PQ HDR output: **Dolby metadata applied during rendering, not retained as Dolby Vision**. Do not automatically label that result HDR10 unless its required output signalling and metadata contract is met. Saved help advertises `apply_dolbyvision`, but it does not prove this clip, device, filter build or output will be correct. No invented target-peak option, unvalidated brightness assumption or claim of better visible quality should enter the UI.

Scaling/ranging these paths must carry an explicit color-transform identity and dynamic-metadata disposition. Do not transplant original Dolby RPU onto newly encoded/resized content. For combined tone-map and scale, initially keep an explicitly ordered high-precision graph and test that ordering; do not swap operations opportunistically between CPU and GPU implementations. Preserve bit depth through intermediate processing and round/dither only at the declared output stage. Backend support, metadata writing, playback signalling and real HDR-display appearance are separate evidence cells. Unseen HDR-display comparison remains owner review, not a blocker to reporting a technically qualified candidate honestly.

## 7. Typed contracts, safety and acceptance sequence

Use the shared `SourceEvidence → FileRequest → PreparedPlan → ExpectedOutput → JobResult` contract. Preserve rationals and typed known/unknown/malformed states for geometry/timing/HDR/relationships. A prepared plan records requested/effective geometry, range bounds, each stream disposition, audio encoder/rate/layout, color mapping, timestamp transformation, validation tolerances and their evidence. One main-owned canonical argv supplies both execution and transparent display. Renderer inputs are narrow enums/IDs/bounded values; never raw filter graphs, paths, shell fragments or codec dictionaries.

Qualification after a separate execution resume should be staged, not a Cartesian sweep:

1. **Geometry:** saved anamorphic input; square/portrait/ultrawide; 90°/270°; small-source no-op; odd dimensions/alignment; missing SAR; rejected interlace/alpha/arbitrary matrix; subtitle canvas cases.
2. **Timeline/audio:** short deterministic CFR/VFR marker fixtures; nonzero/negative timestamps; start-only/end-only/both; late seek; 44.1/48 kHz; mono/stereo and each additional layout separately; multiple audio offsets; priming/padding/gaps; active subtitle at A and straddling chapters. Compare decoded boundary and end-to-end synchronization, not only reported durations.
3. **Remux:** one positive for each proposed direction/cell, then specific negative or explicit-decision cases for timed data, attachments, text subtitles, multiprogram TS and discontinuities. Check all intended stream identities, frame/sample counts, decode validity, relative timestamps, metadata and target playback. A process exit 0 is insufficient.
4. **Cross-feature:** one qualified HDR-preserve + downscale + range path, one deliberate SDR conversion + range path, one intentional generated-output source path, and cancellation/source-change/publication cases. Reuse unchanged accepted evidence elsewhere.
5. **Native/packaged and independent review:** actual dialogs/controls and prepared details; no silent fallback or hidden loss; requested/effective values; selected audio settings; restart invalidation; read-only command fidelity. Independent requirement-to-evidence review precedes candidate milestone closure.

Keep one media job at a time once execution is authorized. Forecast owned-output/staging space before each experiment, retain D: ≥25 GiB, and record actual F: capacity/use without reviving the superseded fixed 24 GiB cap or F: reserve. Downloads remain separately bounded and require recorded legitimate provenance; supplied originals stay untouched. No benchmark ledger, candidate mapping, pinned runtime, held-out footage or allowance is consumed by feature qualification.

High risks: combined HDR/geometry/range correctness; AAC delay/padding and mux/player interpretation; timed ancillary data and program semantics; source/publication races. Medium risks: SAR/rotation normalization, chapter/subtitle clipping, capability/persistence invalidation. Lower risks: enum-only controls and transparent requested/effective summaries once their contracts are stable. Failure of a particular technical cell narrows that cell with an explicit reason; it never silently changes codec/backend, drops content, changes the user's interval or converts HDR to SDR.

The next action is parent review and consolidation into the current planning document. This appendix does not resume the paused Goal, execute its tests, accept a candidate or alter production defaults.
