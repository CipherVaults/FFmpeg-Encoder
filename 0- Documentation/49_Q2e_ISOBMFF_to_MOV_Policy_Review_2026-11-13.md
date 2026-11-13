# Record 49 — Q2e ISOBMFF→MOV source and producer policy review (November 13, 2026)

**Status:** root's reviewed policy for promoting the fifth Full Remux route, `full-remux-isobmff-mov-v1`. It follows the pattern of [record 48](48_Q2d_Matroska_to_MP4_Policy_Review_2026-11-13.md). It is not an owner acceptance; milestone Q acceptance stays with Ahmed.

## 1. How it was made

- **Draft and code.** Codex (GPT-6.1 Sol, xhigh, `/codex-run`) wrote the review, the route gates, the proof harness and the tests in jobs `q2e-mov-1` to `q2e-mov-4`.
- **Independent review.** A fresh Codex session in review mode (`q2e-review-1`), per Ahmed's November 13 Codex-first instruction (record 40 amendment). It confirmed the four existing routes byte-identical in 84 cases and found three medium issues: the route admitted VFR and 60 fps sources the proof never measured, one harness negative was masked, and the harness limits had no wiring tests. All three are fixed.
- **Root.** Read the final source diff, decided the cadence design (§3), ran both proofs, added the catalog entry and wrote this record.

## 2. Source envelope (`sourceEnvelope: 'h264-aac-lc-48k-stereo-v1'`)

- **Admitted.** An ISOBMFF (MP4 or MOV) source with exactly one H.264 video and one AAC-LC `fltp` 48 kHz stereo track, no chapters, no extra or omitted streams. The shared bounds stay: at most 512 MiB and 120 s, progressive yuv420p 8-bit, BT.709 limited SDR, square pixels, no rotation, at most 1920 per side.
- **Refused before Start, each with its own code.**
  - Any other stream shape: `REMUX_MOV_SOURCE_SHAPE_UNQUALIFIED`.
  - Any other audio: `REMUX_MOV_AUDIO_UNQUALIFIED`.
  - Video whose `avg_frame_rate` and `r_frame_rate` are not equal and exactly 30 or 60 fps: `REMUX_MOV_RATE_UNQUALIFIED`.
  - Required track tags MOV cannot hold: `REMUX_TRACK_TAG_UNREPRESENTABLE`.
- The field is accepted only on an unrotated ISOBMFF→MOV policy; an unknown value is refused.

## 3. Cadence decision (root, technical; it only narrows)

A rate summary cannot prove that every frame interval is constant, and complete cadence is known only after the copy. Codex asked whether to leave MOV disabled or to build timestamp collection before Ready. Root chose neither:

- the summary check stays as an early refusal, explicitly not a certificate;
- after collection, the route requires the collector's own bound evidence to classify the video cadence as `constant` on both source and output. Otherwise the job fails with `REMUX_MOV_CADENCE_UNQUALIFIED` and nothing is published.

So the route can never publish a cadence shape it has not measured. The cost is one wasted copy for a mislabelled file.

## 4. AAC, metadata and provenance

- **AAC.** Within the ISOBMFF family the copy keeps decoded alignment; the proof shows it through complete PCM hashes, sample counts, per-unit timestamps and first/end intervals. The validator does not compare edit-list atoms directly. Matroska AAC to MP4/MOV stays refused (Slice 3 receipt, line 25).
- **Metadata.** Native language and handler fields are compared exactly. The Q1e `mdhd` receipt is collected and bound for every MOV output. `use_metadata_tags` and `-write_tmcd 0` are unchanged. No new allowance was added.
- **`mov-family-metadata-mode`.** Satisfied by a MOV-specific round trip: strict publication, codec tags `avc1`/`mp4a`, handlers, the sealed native receipt, exact outcomes and warnings.
- **v4 provenance description.** Not adopted in Q2e; a new writer needs its own adoption proof (record 47, Q1e notes).
- The stale-brand limitation of record 48 §5 is unchanged.

## 5. Proof (fresh, budgeted in advance)

- **Harness.** `scripts/v07-remux-mov-smoke.cjs` (SHA-256 `996246c8…`), a parameterised copy. Limits per mode: 3 copies, 64 tool calls, 45 minutes, 2 GiB growth, the 25 GiB storage floor.
- **Cases.** Owned envelope fixtures A (1080p30 MP4), B (720p30 MOV) and C (720p60 MP4), all H.264 with B-frames and AAC.
- **Qualification run `7a7f87a2`** (report SHA-256 `17e6c6e7…`) and **normal-service run `ff1c4445`** (`25e9a3aa…`, the real five-route catalog `full-remux-v3:2026-11-13:five-routes`). Each: 51 invocations, 3 copies, one child at a time, sources unchanged, clean closure; all three cases saved with zero warnings, constant cadence on both sides, and a MOV receipt present.

## 6. Retained failure

Receipt `q2e-full` (13 failures) is retained. Its 8 extra failures were tests that asserted production MOV was still disabled; Codex job `q2e-mov-4` corrected the tests only. `q2e-full-r2` shows 2683 pass and the same 5 parked failures.

## 7. Limits

- Not measured, so refused: variable frame rate, rates other than 30 and 60 fps, other audio shapes, more than one audio track, chapters, subtitles.
- HDR seal drift grows; no reseal (record 33, D7).
