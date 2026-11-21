# Record 47 — Milestone Q plan (November 12, 2026)

**Status:** root's working plan for Q01–Q08. It is not an owner acceptance. Milestone Q acceptance stays Ahmed's (CLAUDE.md owner gates).

## 1. Authority and start

- **Start word.** Ahmed, November 12, answering "Shall I start milestone Q once the 5-hour window resets?": "Yes, after reset". This is the "say so" that record 39 decision 10 waited for.
- **Eligibility.** Record 42 §5 required two scans first: `/security-review` on C1–C4, and the `claude-security` changes scan for P. Both ran on November 12, with no vulnerabilities (Execution Index, "Security pass for milestone P").
- **Scope rule.** Record 33:18: broaden qualified SDR geometry, range, audio and timing, and compatible Full Remux, using surviving work. Keep unsupported combinations and retained failures specific. Never widen tolerances to turn failures green.
- **Never.** HDR P05–P09 stays deferred: no HDR replay and no reseal. Never change ordinary defaults, Archive CQ29, the benchmark, accepted 0.5/0.6 behaviour, or the golden ordinary argv baseline (`tests/fixtures/ordinary-argv-golden.json`).
- **Executor.** Root leads alone until Codex resets on November 18 (~01:00 Cairo). Full-throttle run: up to 95% of each window (record 44).

## 2. Where Q stands (mapping workflow `wf_13432d65-e4c`, four read-only researchers, HEAD 0ffacd9)

| Row | Qualified today (exact envelope) | Main gaps |
|---|---|---|
| Q01 | One production family, `short-sdr-range-v1`. It requires a range (0.5–30 s) and accepts Keep Source or 1080→720 only. Source: H.264 High 8-bit, 1080p or 720p, 30/60 fps CFR, SAR 1:1, BT.709, MP4/MOV, one AAC 48 kHz stereo track. | No Full (whole-file) resize; no 2160/1440 targets; no rotated or anamorphic sources. A request that already fits is refused when rotation is unreported, because orientation is checked before the fit (fixed by Q1a). |
| Q02 | Exact fields, sliders and explicit apply, inside that family. | The slider limit uses the video stream's decimal duration, falling back to the container duration when the stream reports none, while main uses the exact stream timeline ticks. Mixed-duration batch apply has no current-bytes proof. |
| Q03 | Precision AAC 320 kb/s at 48 kHz stereo, with an explicit warning for the tail of at most 1023 samples. | No FLAC in the normal app; no 44.1 kHz or mono; no bitrate overrides; no multitrack. |
| Q04 | Full audio copy on the ordinary path. The range-copy override is refused on purpose. | No packet-range copy contract or validator; no disclosure of packet limits. |
| Q05 | Exact-origin timing collector and validator for the family. | The user never sees the effective boundaries, delay or tail. Start-only and end-only requests aren't pinned by tests. No VFR, multitrack or non-zero origins. |
| Q06 | Explicit refusals: transformed subtitles, trimmed chapters. | No chapter clipping or rebasing math; no subtitle policy for a resize or a range. |
| Q07 | Three Full Remux routes: ISOBMFF→MKV, ISOBMFF→MP4, MKV→MKV. | MKV→MP4 software is ready but not promoted. No MOV route. TS input has a contract only. |
| Q08 | Collector, validator and publication for those three routes. | MOV representation evidence isn't produced in the production path. Remux provenance has no description. |

**New finding (live observation, November 12).** This PC's NVIDIA driver is now **621.14**. The family's NVIDIA cell is bound to **621.01** (`src/operation-catalog.cjs:77`), so the app now refuses NVIDIA range jobs here (fail-closed, as designed). CPU range jobs are unaffected.

## 3. Work order

Each slice: before-copies, focused tests through `/evidence-run`, the full suite (the 5 parked encode-preservation failures expected and nothing new), an independent review on substantive diffs (`/security-review` when a trust boundary moves), then commit and push.

**Seal drift.** Most Q files are hashed by `src/hdr-catalog-seals.cjs` and some by `src/encode-preservation-producers.cjs`. Editing them adds to the suspended HDR drift. Each slice records the drift; no reseal (record 33, D7).

### Wave 1 — truthful edges (software only; no new catalog cells)

| Slice | Rows | Change |
|---|---|---|
| Q1a | Q01, Q02 | The box turns with the picture, so whether a picture already fits never depends on its orientation. A file with no reported orientation that already fits now prepares on the unchanged ordinary builder (Full); a range still needs the family. Every real resize still needs orientation evidence. When a real downscale of such a file has no measured family, the refusal names the missing qualification instead of `GEOMETRY_ORIENTATION_UNKNOWN`; faults in the file's own geometry keep their codes. Grants nothing new. |
| Q1b | Q02 | Main sends its exact stream-timeline duration to the window as inert data, and the range slider uses it. The slider is disabled, with a reason, when only the container duration exists. Add tests for multi-file apply with a per-file refusal. |
| Q1c | Q05, Q03 | Show requested versus effective boundaries, the AAC delay and the tail in the changed-path result, read-only. The ordinary result shape doesn't change. Pin start-only, end-only and to-source-end requests with tests. |
| Q1d | Q06, Q04 | Two pure main-only modules, not yet wired: chapter clipping and rebasing (`src/operation-chapters.cjs`), and packet-range copy (`src/operation-packet-range.cjs`). Each has specific refusal codes. |
| Q1e | Q07, Q08 | Produce the MOV representation receipt inside the remux collector, and pass it to the validator. Add a bounded remux provenance description. The ordinary encode description and marker v1 stay byte-identical. |

### Wave 2 — measured new cells (real media in the approved owned folder `F:\FFmpeg Encoder Project supplied videos\_FFmpeg-0.7-Owned`, record 23; CPU, then NVIDIA, one at a time)

| Slice | Rows | Change |
|---|---|---|
| Q2a | Q01–Q03, Q05 | Re-measure the existing family's NVIDIA cell on driver 621.14, with the same tolerance rules. Add a new cell only from retained evidence. |
| Q2b | Q01, Q04 | A Full (whole-file) 1080→720 resize family with copied audio. The copied packets are checked against the source. |
| Q2c | Q03, Q05 | Precision FLAC range audio at 48 kHz stereo, with its own measured tolerances. |
| Q2d | Q07, Q08 | Promote MKV→MP4 (video, with AAC explicitly omitted). First a written source/producer-policy review and a fresh budgeted run (amendment 33:50); the failed laboratory packet `63e04e96` is never reused. |
| Q2e | Q07, Q08 | ISOBMFF→MOV (H.264 + AAC, no chapters), using the Q1e receipt. |
| Q2f | Q03, Q05 | 44.1 kHz stereo and 48 kHz mono AAC: the packet clock is parameterised, and each tuple is measured. |

### Wave 3 — needs Ahmed's choices or larger designs

Range packet copy (Q04), chapters in a range encode (Q06), subtitles on a resize (Q06), subtitles in a range (Q06), TS input (Q07), multitrack audio (Q03/Q05), VFR sources (Q05), rotated sources (Q01), 2160/1440 cells (Q01).

### Q1a notes (review `wf_5d465cb0-c62`)

- Three lenses and an adversarial verifier confirmed 8 findings, all applied: the orientation-independent fit rule; the re-description limited to `GEOMETRY_ORIENTATION_UNKNOWN` on a real downscale; negative tests for each guard (two mutations checked); restored spaces in the family's user-visible messages; record wording; and a pre-existing fault (since 717d967) where the family's bounded inspection walk ran for every ordinary request, so a very large valid inspection could fail an ordinary encode.
- `tests/vendor-baseline.test.cjs` now re-pins `src/operation-family.cjs` and `src/operation-contract.cjs` at their Q1a bytes, labelled Q1a; `src/media.cjs` and `src/encode-operation.cjs` keep their 253c567 pins. The golden ordinary-argv capture passes unedited. Record 45 §9's "tests only added" check no longer applies from Q1a on.
- One existing test changed: in `tests/operation-family.test.cjs` "accessors and hidden family authority are rejected before any getter runs", the orientation check on a Keep Source request now returns `{}` without reading anything, and its rejection check moved to the resize route. The getter is still never read; after the security review, a getter on `request.resolution` itself isn't read either.

### Q1b notes (review `wf_385931ae-44e`)

- The limit is the full-duration end that main accepts. Main reports null rather than a smaller end when that end would cross the absolute overflow guard, which only crafted timelines reach.
- The visible row text, not only the slider tooltip, says when the sliders are off.

### Q1c–Q1e notes (commit `4c1c305`; two reviewer agents)

- **Q1c.** The timing summary is attached only to a valid result and to a published item. Source spans use the request's timeline, so they compare directly with the asked range.
- **Q1d.** Both modules are pure and unwired. The packet-range module handles only every-key streams. Video needs decode-order evidence first. Codecs with decoder pre-roll (AAC, Opus) may need priming before the first kept packet; the reported differences are packet edges, not decoded-sample edges. Chapter ids from 64-bit Matroska UIDs must reach the module as digit text, which the inspection path doesn't do yet; wiring must add that.
- **Q1e.** No remux route writes the v4 description yet; a route adopts it only with its own measured round trip. The MOV receipt path is unreachable until a MOV route (Q2e) exists.

### Q2a notes

- The re-measure used the unchanged calibration harness and the unchanged normal-service smoke (only its catalog-count check). Calibration `0ad1d184` passed 6/6 and service `3a0b698b` passed; an auditor agent passed all six checks. The 621.14 cell has the same frozen bounds as the 621.01 cell, which stays in the catalog.

### Q2b notes (commit `f5e5455`)

- The first FULL cells cover only 1080p30 whole files whose video, audio, container and decoded source last 10–31 s, with audio within one AAC frame of the video. That is the measured shape (A 10 s, E 31 s); everything else is refused. Copied audio is proven by packet identity and exact sample equality, and a new copy clock models the Matroska duration. 60 fps, longer and shorter files each need a fixture and a calibration first.

### Q2c notes (commit `6b620fd`; Codex-built, root-reviewed)

- FLAC for trims applies only to QuickTime sources with integer 16-bit PCM at 48 kHz stereo. That is the measured shape; AAC sources cannot become lossless FLAC. The family uses `end-timestamp` with exact PCM identity, and its bounds can never exceed the AAC range family's. Wider PCM shapes (24-bit, 44.1 kHz, mono, MP4 brand) each need a fixture and a calibration.

### Q2d notes (commit `bc19e51`; Codex-built, root-reviewed)

- The written source/producer policy review is [record 48](48_Q2d_Matroska_to_MP4_Policy_Review_2026-11-13.md). The route is video only, with audio explicitly omitted, and the existing "saved with warning" rules are kept with no new allowance. B-frame, VFR and CFR sources are measured. Unrepresentable track tags are refused before Start.

### Q2e notes (commit `adb9f0e`; Codex-built and Codex-reviewed, root-decided)

- The policy review is [record 49](49_Q2e_ISOBMFF_to_MOV_Policy_Review_2026-11-13.md). The route admits one H.264 video plus one 48 kHz stereo AAC-LC track at constant 30/60 fps. It refuses other shapes before Start and publishes only when the collected cadence is constant on both sides.

## 4. Points for Ahmed (none blocks Waves 1–2)

| # | Question | Root's recommendation |
|---|---|---|
| QD1 | When a trim keeps the **original audio untouched** (no re-encode), the cut can only fall on the audio's own packet edges, about 21 ms apart. Accept "the audio may start or end up to one packet early or late, and the app tells you exactly by how much"? | Accept, with the exact difference shown. Precision re-encode stays the default. |
| QD2 | A subtitle line that **crosses the trim point**: cut it to the trim, or keep the whole line? | Cut it to the trim, and list the changed lines. |
| QD3 | **Styled (ASS) subtitles** on a resized video: rescale their positions to the new size, or refuse them? | Refuse for now; plain SubRip subtitles go first. |
| QD4 | **4K (2160p) and 1440p** cells take long CPU runs and several GB of test files. Worth it in 0.7, or later? | Later, after Waves 1–2. |

## 5. Not changed by this record

Tracker 25 requirement texts and order; the 5 parked failures (D7); HDR; O1–O10 (record 46).

## 5. Owner decisions — November 13, 2026 (scope additions)

Ahmed, after root explained how the verified remux differs from his raw FFmpeg batch files:

- "we can, yes, add that quick copy unverified option toggle ... with a warning perhaps that explains in a pop-up message that like a smaller window that can be closed in a clean, polished way about that part and its risk."
- "can we actually include the variable frame rate as well in this cycle?"

Root's plan for them:

| Slice | Rows | Change |
|---|---|---|
| Q2g | Q07, Q08 | Variable frame rate for ISOBMFF→MOV: an owned VFR fixture and a fresh proof; the post-copy check of every frame stays. Matroska→MP4 already measures VFR (record 48). |
| Q2h | Q07 | "Quick copy (unverified)" on the Remux screen, off by default. A small themed warning dialog explains the risks. It runs a plain stream copy without the measured-shape or length limits. The source stays untouched, nothing is overwritten, jobs stay one at a time, and the result row says "Quick copy, not verified". |

- **Open with Ahmed:** whether Quick copy keeps every track or one video and one audio track, as his batch files do.
- **Flagged to Ahmed:** verified remux still accepts only files up to 120 s and 512 MiB; lifting that needs measurement on longer files.
- Order: Q2g, Q2h, then Q2f, unless Ahmed reorders.

### Q2g notes (commit `d280f4e`; Codex-built and Codex-reviewed, root-decided)

- Envelope `h264-aac-lc-48k-stereo-v2` replaces v1 on the production MOV route. Constant cadence keeps the 30/60 fps rule; variable cadence up to 60 fps publishes only when it is variable on both sides. Proofs `d252713e` and `a274430b` on fixtures `a12935df`.
- Not measured: very long frame gaps, 1080p variable sources.

## 6. Owner plan — November 13, 2026 (remux completeness, settings, optimization, roadmap)

Ahmed, after root listed what the Remux tab still cannot do:

- "firstly, obviously, no length and size, obviously, because that's critical"
- Variable frame rate to MOV "if possible. If that proved not possible for MOV, then it would be grayed out and explained"
- "decide what to do on regarding the best choice for the audio on MKV to MB4 ... give me the options and trade-offs of each choice"
- Several audio tracks, subtitles and chapters: grey out and explain if difficult.
- "HDR is deferred, the TS to MB4 and MB3 on the reverse is critical."
- On the audio options: "try, yes, as you said, D and B ... but we could also offer C and all of them into the settings of the app so the user can actually choose ... we don't have to hard lock a choice ... we can have a default ... based on our actual testing, which one is it, B or D ... leave settings to accommodate such circumstances, not just this situation, but similar situations."
- "make in the polishing pass an optimization pass for the app ... we don't weaken obviously the quality of the app and the impact of its functionality in any capacity."
- "build me a roadmap artifact ... historical versions for what we have already obviously done ... And the upcoming versions ... update it as we go."

Root's plan, in order (each slice via Codex, measured on owned files before it is enabled):

| Slice | Change |
|---|---|
| Q2g | Variable frame rate to MOV. **Done** (`d280f4e`). |
| Q2i | Remove the 120 s / 512 MiB remux limits, with long owned test files. |
| Q2j | TS→MP4 and MP3→MP4. Root reads "MP3 on the reverse" as MP3→MP4; unconfirmed. |
| Q2k | Audio on MKV→MP4 as a setting: exact copy (D), copy with a stated shift (B), re-encode (C), leave out. Default from measurement: D if achievable, else B. Root brings the numbers to Ahmed before fixing the default. |
| Q2l | Other audio shapes and several audio tracks: accept a track when its decoded audio matches exactly; one real file per shape. |
| Q2m | Subtitles and chapters: keep where the target can hold them; otherwise greyed out with the specific reason. |
| Q2h | Quick copy (unverified) with a themed warning dialog. Keeps every track unless Ahmed says otherwise. |
| Q2f | 44.1 kHz and mono AAC for trims. |

- **Settings pattern (R).** Where a case has several valid answers, the app offers them as remux-only settings: a one-line trade-off each, a recommended default from measurement, greyed-out options with their reason, a per-file override, and the result row states which option was used. Ordinary encode defaults are untouched.
- **Optimization pass (R).** During polishing: speed and memory work that leaves quality, checks and behaviour unchanged, each change measured before and after.
- **Roadmap artifact.** https://claude.ai/artifact/VhJeta8oFkJ9m5xoyAmwEB; root republishes it at each phase close when features change.

## 7. Owner decisions — November 13, 2026 (evening)

Ahmed's words, in order:

- "Keep the split" — the order after 0.7 shown on the roadmap artifact: 0.8 HDR, 0.9 bigger and broader (4K/1440p, more source kinds, AMD/Intel on real hardware), 1.0 public release. This agrees the order; it is not a go to build any of it.
- "yes, to both but choose how to do it" — Quick copy keeps every track, and "MP3 on the reverse" means MP3→MP4. Root chooses the method for each.
- "the Trimming option should be for any length of videos, not just short ones (same for every future)" — no feature may be limited to short videos. The 0.5–30 s trim range and the 10–31 s whole-file resize range are removed inside 0.7.
- "and Let Codex design the logo" — a Codex job designs the logo candidates (R07) into a separate candidate folder, fitted to the dark amber and light teal themes. The shipped icon stays until Ahmed selects.
- On the roadmap artifact: an always-visible side scroll bar, the current version shown on open, a button to expand details, a light look by default, and "XS, S, M, L & XL classes" for each feature.

Changes to the plan in §6:

| Slice | Change |
|---|---|
| Q2n | Trim and whole-file resize at any length (streaming verification and proportional budgets, as Q2i does for remux). After Q2j. |
| R07 logo | Codex designs candidates; root reviews for theme fit; Ahmed selects. |

- Q2i status at this entry: Codex jobs `q2i-limits-1` (blocked on the allow list) and `q2i-limits-2` (done) removed the fixed 120 s / 512 MiB remux ceilings in the working tree; not yet reviewed, measured or committed.

## 8. Owner decision — November 13, 2026 (night): remux verification must take seconds

- **Measurement.** Q2i's first long proof (`bb1a7617`, failed and retained for a wrong harness expectation, not an app fault) remuxed a 20-minute 1080p30 file correctly. The copy took 0.24 s. Verification took about 12.7 minutes: `ffprobe` frame listing 42–46 s per side and a complete decoded video frame hash 325–327 s per side. Peak main-process memory was about 353 MB. At that rate a 2-hour file needs roughly 75 minutes.
- **Ahmed:** "yes, it's critical to bring this time to seconds not hours, almost drive write speed difference."
- **Root's technical decision (slice Q2o, built on the uncommitted Q2i tree).** Verified Full Remux proves essence identity on the compressed data instead of decoding every frame:
  - every packet of every copied stream is hashed on the source and on the output and compared in order, with its size, key flag and exact timestamps; codec parameters (extradata) must match;
  - a bounded decode check at the start and the end proves the output decodes with its own container parameters;
  - where a route would legitimately change packet bytes, the complete decoded comparison remains the method.
- **Why this is not a weaker check.** A stream copy cannot change a picture without changing a packet or the codec parameters; identical packets and parameters decode to identical pictures. The timing, metadata, disposition and publication checks are unchanged.
- The second proof run `9c1b8e43` was stopped by root when Ahmed decided this; it is incomplete and proves nothing.

## 9. Q2o progress and owner decision — November 14, 2026

- **Measured (root's qualification `0f1e9765`, 14 cases, all pinned verdicts reached, on the pre-review bytes).** Verification took 11.5–19.7 s for 20-minute files, 25.8 s for a 680 MB file and 12.6–15.0 s for 8-second fixtures; both cancel cases published nothing. Earlier failed proofs `bb1a7617`, `b4b16fc8` and `e3c45ff7` are retained; stopped run `9c1b8e43` proves nothing.
- **Independent review `q2o-review-1`.** Packet identity held against 26 adversarial negatives; ordinary, Keep Source and range jobs are unchanged. Three findings: interior video slices were no longer validated (high); storage allowance and forecast disagreed for an omitted stream on long sources (high); the stall detector could fire during a progressing publication copy (medium).
- **Root decisions.**
  - Every NAL and slice header in the whole stream is validated without decoding, on source and output. Entropy-coded slice data cannot be proven decodable without decoding, so the fast method states exactly what it proved: output identical to source, every header validated, start and end decoded; the interior is not decoded.
  - A sole track's default flag that the target muxer forces is published with a specific disclosed warning; with two or more tracks of that type, or any other disposition difference, the job is still refused.
- **Ahmed, on root's proposal of an optional deep check:** "fast check always, Deep isn't practical at all, the point of a remux is to be quick, not taking hours like encoding."
  - There is no user-facing deep verification. The complete-decode method stays only as internal code for a future route that changes packet bytes.
  - Accepted consequence: a source already damaged in its interior is copied faithfully, damage included, without a refusal. The copy is never worse than the source.
- **Speed targets given to Codex.** Fixed overhead at most 3 s per job and at most 6 s per GB. After follow-up 5: 20.1 s for the 680 MB file (29.6 s/GB by Codex's own run); targets not yet met.

### Q2i and Q2o notes (commit `bc7d299`; Codex-built, three Codex reviews, root-decided)

- All five routes use `packet-identity-v1`; policy id `full-remux-v5:2026-11-14:packet-identity-headers`. Proofs `c020cf60` and `aa9cd74a` on fixtures `b29f31e5` plus the Q2g and Q2d fixtures.
- Measured on the final bytes: 3.0–4.9 s for 8-second files, 5.5–13.8 s for 20-minute files, about 12 s for 680 MB. Root's target of 3 s fixed and 6 s per GB is not met (about 4 s and 18 s per GB); the remainder is in-app bookkeeping, for the optimization pass.
- Not done: verification progress in the window; child-process memory and hour-scale throughput are unmeasured.

### Logo candidates and MP3 method notes (November 14, 2026)

- **Logo (R07).** Codex job `logo-1` (receipt under `artifacts/v0.7/codex/`) delivered six original candidates in `assets/logo-candidates-2026-11-14/`. Each uses only the `--text` and `--orange` tokens of the two themes, with separate dark and light treatments. Codex ranks Gauge first and Witness second. Root's theme-fit check (rendered review images, both themes): all six fit; Witness reads as a generic checkbox, and the marks have no background tile, so a selected mark needs a tile or a per-background treatment for the Windows taskbar at packaging. Selection is Ahmed's gate; the shipped icon is unchanged.
- **Leftover.** The job left a small Electron cache folder `.qa-electron-state` inside the candidates folder; it is not committed.
- **MP3 to MP4.** Root's method: exact stream copy of MP3 into MP4 (no re-encode), with a stated compatibility note; re-encode to AAC is part of Q2k.

### Q2j part 1 notes (TS to MP4; Codex-built, two Codex reviews, root-decided) — November 14, 2026

- **What.** Sixth route `full-remux-mpegts-mp4-v1`; policy id `full-remux-v6:2026-11-14:packet-identity-transport`. Codex jobs `q2j-ts-1` to `q2j-ts-5`; briefs in `artifacts/v0.7/milestone-q/q2j/`.
- **Root decisions.** (1) Edit `segment_duration` is quantised by the movie timescale; the check follows the pinned muxer's exact rule (ceil for spans, floor for empty-edit delays), no tolerance. (2) A source whose own playback controls are not plain is refused, never normalised. (3) Combining the repeated traversals is deferred to the optimization pass; the receipt reports the real count.
- **Review 1 findings (all fixed but the deferred one).** Edit-list rate not verified (high); PCR not inspected; NAL count bound applied after allocation; a harness test depending on unfilled pins; more than one traversal per side (deferred).
- **Review 3 findings (all fixed).** Source-side playback rate lost on ISO routes (high); track/movie volume, flags and rate unchecked (high); `tkhd` duration rule too strict for unusual timescales; `mvhd`/`mdhd` durations unchecked.
- **Proofs.** Fixtures `8ca99b73`; qualification `1865c531`; earlier-byte runs `1c8c571e`, `23e999a9`, `16477e14`; final-byte normal-service runs `880ff036` (TS) and `17e16f69` (existing routes). Receipt `q2j-ts-full-root`.
- **Limits.** First envelope only (H.264, AAC-LC 48 kHz mono/stereo, single program). Fixtures are generated, not captured from a real broadcast or capture device. The last fix round is not yet independently re-reviewed.

### Q2j part 1 third review and fix (November 14, 2026, afternoon)

- **Review `q2j-review-4` (eight findings, all fixed by `q2j-ts-6`).** High: VFR with B-frames refused; track flags forced to 3; `tkhd` width/height unchecked; `smhd.balance` unchecked. Medium: omitted tracks tripping the track-kind guard; `stz2` refused; fragmented MP4 refused with a misleading message; source duration contradictions normalised silently.
- **Root's guiding rule.** The source-side native check may refuse a file only for a playback control the remux would not carry, never because its atoms are laid out differently from what the pinned muxer writes. Preserve-and-compare is preferred to forcing neutral values.
- **Result.** New `src/remux-fragments.cjs`; admitted flags, layer and alternate group are preserved in the owned stage before sealing and compared afterwards; new codes `REMUX_TRACK_GEOMETRY_UNSUPPORTED`, `REMUX_SOUND_BALANCE_UNSUPPORTED`, `REMUX_SAMPLE_TABLE_UNVERIFIED`, `REMUX_SOURCE_FRAGMENT_UNVERIFIED`, `REMUX_SOURCE_DURATION_UNVERIFIED`, `REMUX_PLAYBACK_WRITE_UNVERIFIED`, `STAGE_ALREADY_SEALED`. Round-trip corpus test `tests/remux-roundtrip.test.cjs`. Fragmented AAC keeps its earlier refusal.
- **Proof.** Normal service on the fixed bytes: TS `bb38424a`, existing 14 cases `c7d86a40`. Receipt `q2j-fix6-full-root`: 3049 tests, 3039 pass, the same 5 parked failures, 5 skipped. Codex audit: 221 saved outputs and 129 ISO source admissions still pass.
- **Limit.** This fix round has not been independently re-reviewed. Root's lesson: the earlier proofs and suite could not catch unwanted refusals because the test files did not include those layouts.

## 10. Owner decisions — November 14, 2026 (afternoon)

Ahmed's words are quoted; the rest is root's reading.

- **Quota and roles.** "you have full authority to use 100% of Codex's quota, and yours". "keep pushing the effort on Codex ... I need you to stay as a planner and coordinator for Codex's work, but Codex needs to do as much work as it can be done ... I have still a reset for the entire week I will use." Root does not take code work onto Claude when the Codex gate refuses a job; it tells Ahmed.
- **Logo (R07).** "I agree with your recommendation. Gauge". The amber square stays the same in both themes; "shift the white part to be black ones ... keep the yellow square as it is, and when it's in the dark mode it's a white one? no backgrounds". Windows icon (a single fixed image): show an outlined and a mid-tone option on light and dark taskbars; "We will use possibly the outlined, but no harm in seeing both."
- **QD1** accepted (untouched audio lands on its packet edges; the exact difference is shown). **QD2** cut a crossing subtitle line to the trim and list the changed lines. **QD3** refuse ASS subtitles on a resize for now.
- **QD4 reversed from root's recommendation.** "I need that. And the 4K is critical ... to downscale, let's say, from 4K to 1440p, or from 4K even to full HD ... That's even the core reason for why we are doing this regarding the scaling. Even if it takes several gigabytes of test files, use one of the hard drives ... You will have hundreds of gigabytes like that to test with." 4K and 1440p source cells are critical 0.7 work. Test media goes in the project-owned folder on F:; the personal media rule is unchanged.
- **Source playback controls.** Agreed: refuse, never normalise.
- **Record 46 owner points.** O1 yes. O2 yes. O3 keep refusing. O4: "we could use the [cheaper] check primarily and assess the pros and cons ... we don't need to hog the time significantly just because we are out of cautious"; root: the cheaper check becomes the AMD/Intel default, and the full-decode timings and what each check would catch are reported when hardware results exist. O5: "no, I don't think I need extra checks." O6: the untested mark is only a clear label where the user chooses Intel or AMD encoding; hardware testing stays as decided (H1). O7 not now; "HDR is not to be implemented at all right now for anything." O8 left to root: acknowledged, today's disclosure stays and the AMD producer question remains open until hardware exists. O9 accept. O10 later.

## 11. Evaluation rule adopted — November 14, 2026

Ahmed asked root to study Anthropic's "Building strong safety evaluations" (published November 13, 2026; root read a fetched summary, not the full text) and use it with Codex. It concerns AI model evaluations; these parts transfer and now bind every slice:

1. **State the claim first.** Each brief opens with one sentence saying what must be true for the user; tests and reviews are judged against that claim, not against "the suite passes".
2. **Both directions.** Each feature has a must-refuse set and a must-accept set of ordinary files in varied layouts; a slice is not done until both pass.
3. **Check the checker.** On a sample of files the fast verification verdict is compared with an independent full decode comparison, as a test-time tool only.
4. **Reviews ask both questions:** which bad file gets through, and which good file is refused. The reviewer is a fresh session, never the author.
5. **Real files beside generated ones** where they exist; say plainly when fixtures are only generated.
6. **Already in force and kept:** verdicts pinned before a run, tolerances never widened, failed receipts retained, limits reported.

### Q2j part 1 fourth review and fix; logo and effort decisions (November 14, 2026, late afternoon)

- **Review `q2j-review-5` (nine findings, all addressed by `q2j-ts-7`).** High: the post-mux playback write checked protected identities only after writing, so a substituted second input could be modified; `tapt` aperture geometry ignored; ISO-only track controls lost on Matroska targets. Medium: fragments without `tfdt` refused; hybrid fragmented files refused; contiguous media edits refused; an unpolled default-only `trun` loop; output-side geometry/balance checks untested; the corpus test could not detect loss of MOV support.
- **Root decision.** The app writes to nothing but its own staged output; where that could not be made airtight the write is removed and the source refused instead. Codex removed the writer and its APIs.
- **Proof.** Normal service on these bytes: TS `725f7872`, existing 14 cases `e1b2996e`. Receipt `q2j-fix7-full-root`: 3058 tests, 3048 pass, the same 5 parked failures, 5 skipped. Codex audit: 235 saved outputs and 135 ISO admissions pass.
- **Refused rather than supported (candidates for later work):** sources needing track flags, layers or alternate groups the muxer would change; non-neutral `tapt`; several media edits; fragmented AAC.
- **Logo (R07) final.** Ahmed: "Mid-tone" for the Windows icon, after seeing both options (commit `5f8c020`). In-app: amber square fixed, frame part follows the theme, no background. Wiring into the app is a queued Codex job; Ahmed sees the running app before the shipped icon is replaced.
- **Effort.** Ahmed: "the Max may be only offering a diminishing returns of 5-7% improvement in benchmarks ... while costing ~67% more." Default stays xhigh. He used the full weekly Codex reset and said to push Codex as much as wanted; earlier: use the remaining quota fully and do not ask for an early reset.

## 12. Owner decisions and root rules — November 15, 2026

- **Seeking is playback** (root, from review 8). A field a player uses to seek cannot be descriptive or covered by sequential packet identity. TS sources: same presented frame after accurate seeking; indexed sources: same first decoded packet.
- **Codex runs the builds and tests** (Ahmed: "is it absolutely necessary for you to actually make these builds yourself and tests? Can't you actually let Codex to handle this over … your quota is the bottleneck here"). Root checks the receipts' hashes against the committed bytes.
- **Blue handoff** (Ahmed: "I think it's best now to shift to Codex directly"). Development moves to a Codex lead session; [record 50](50_Blue_Handoff_Claude_to_Codex_2026-11-15.md) holds the state, rules and next actions. The Q order in §6–§10 is unchanged.

## 13. Regular v0.7 result behavior — November 21, 2026

Q08 presentation follows §8–§9 without altering the fast check. Per-file results disclose completed media verification and decode coverage only for a confirmed successful save with a recognized report from main. Preparation and failed or retained outputs do not claim completed coverage. Separate transport and full-decode wording preserves the existing shared receipts; no supported route or verification option changes. [Affected checks and limits](Execution%20Summaries/2026-11-21_Regular_Q08_Remux_Verification_Disclosure.md).

## 14. Existing Linux verification limit is visible at Prepare — November 21, 2026

Q07 readiness now agrees with the fixed packet-reader invocation limit for the existing unified single-AAC MP4-to-MP4 path. This is an early refusal of a check the current runtime would not accept, not an owner decision on duration, a relaxed verifier, a new format route or a Q2o timing result. Hosted/platform and real-file gates remain distinct. See [execution evidence](Execution%20Summaries/2026-11-21_Regular_Linux_Remux_Packet_Verification_Limit.md).

## 15. Existing Linux MKV and MOV readiness uses the same packet limit — November 21, 2026

Q07 and Q08: Extend the existing early known-budget refusal only to the already admitted verified Linux ISO input targets MKV and MOV. The actual collector and the fixed per-child ceiling never change. Current target-specific / shared-policy refusals still win. This corrects readiness, not length promises, resource optimization, media admission or native qualification. [Packet verification limit evidence](Execution%20Summaries/2026-11-21_Regular_Linux_Remux_All_Target_Packet_Bound.md).

## 16. Report the existing Linux complete-verification request limit — November 21, 2026

Q07 and Q08: leave the fixed cap, existing Prepare rules and complete evidence requirements unchanged. Distinguish H.264 video and decoded AAC checks, for the source and temporary copy, when the unchanged Linux invocation gate already rejects their requested byte budget. A forecast refusal is not a measurement or a media error. Keep Cancel and existing unpublished-stage handling. The eventual long-file proof and native executor gates remain open. [Verification request evidence](Execution%20Summaries/2026-11-21_Regular_Linux_Remux_Verification_Request_Diagnostics.md).

## 17. CP146 controlled Prepare ownership evidence, regular safe-stop — November 21, 2026

Q07/Q08: Until the current per-file inspection journal finishes, the file may expose source assessment but not Ready, the prepared command or the proposed verification. A replacement target does not inherit the old assessment while preparing or after refusal. The earlier defect was misleading presentation of preparation details; it did not prove Start or publication authority. Existing eligibility, evidence budget, timing policy, omitted-stream grants and publish rules stay unchanged. Three prior-source negatives and 44 current controlled results are retained separately from the Windows/Ubuntu source checks on CP145 and on the exact CP146 public mirror (44923351597). Neither hosted result substitutes for native Remux proof. No new protected or “unlimited” route, native result, package, requirement text, or change in accepted criteria. Work stops here pending owner reconciliation; this evidence does not reopen the queue. [Regular v0.7 safe-stop and evidence record](Execution%20Summaries/2026-11-21_Regular_v0.7_Safe_Stop.md).
