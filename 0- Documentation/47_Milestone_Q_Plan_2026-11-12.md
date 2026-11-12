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

## 4. Points for Ahmed (none blocks Waves 1–2)

| # | Question | Root's recommendation |
|---|---|---|
| QD1 | When a trim keeps the **original audio untouched** (no re-encode), the cut can only fall on the audio's own packet edges, about 21 ms apart. Accept "the audio may start or end up to one packet early or late, and the app tells you exactly by how much"? | Accept, with the exact difference shown. Precision re-encode stays the default. |
| QD2 | A subtitle line that **crosses the trim point**: cut it to the trim, or keep the whole line? | Cut it to the trim, and list the changed lines. |
| QD3 | **Styled (ASS) subtitles** on a resized video: rescale their positions to the new size, or refuse them? | Refuse for now; plain SubRip subtitles go first. |
| QD4 | **4K (2160p) and 1440p** cells take long CPU runs and several GB of test files. Worth it in 0.7, or later? | Later, after Waves 1–2. |

## 5. Not changed by this record

Tracker 25 requirement texts and order; the 5 parked failures (D7); HDR; O1–O10 (record 46).
