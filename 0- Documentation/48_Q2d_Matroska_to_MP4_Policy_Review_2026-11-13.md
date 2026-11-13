# Record 48 — Q2d Matroska→MP4 source and producer policy review (November 13, 2026)

**Status:** root's reviewed policy for promoting the fourth Full Remux route, `full-remux-matroska-mp4-v1`. This is the "finite source/producer-policy review" that amendment 33:50 and record 47 row Q2d require before promotion. It is not an owner acceptance; milestone Q acceptance stays with Ahmed.

## 1. How it was made

- **Draft review.** Codex (GPT-6.1 Sol, xhigh, `/codex-run`, record 40) wrote it as seven cited findings in job `q2d-mkvmp4-1`. The receipt is `artifacts/v0.7/codex/20261113T024255Z-q2d-mkvmp4-1-7d91c1`.
- **Independent check.** Root checked it with three `reviewer` lenses plus an adversarial verifier (workflow `wf_8f6840d9-7e0`), then a second round (`wf_8434a89f-1be`).
  - All seven citations were accurate.
  - The verifier confirmed one medium gap (no B-frame proof) and five low ones.
  - Codex fixed all of them in jobs `q2d-mkvmp4-2` and `q2d-mkvmp4-3`. The known limitation in §5 was recorded instead of changed.
- **Packet 63e04e96.** The failed laboratory packet supplies no run, allowance or evidence here.

## 2. Source envelope

- **Admitted.** The route admits the following, all already enforced in `src/remux-operation.cjs` `sourcePolicy`:
  - a Matroska/WebM demuxer source of at most 512 MiB;
  - a known positive container duration of at most 120 s;
  - exactly one carried progressive H.264 yuv420p 8-bit video;
  - each dimension at most 1920, and at most 2,073,600 pixels;
  - frame rate positive and at most 60 fps;
  - square pixels, and limited-range BT.709 SDR with no HDR metadata.
- **Timing.** Constant and variable cadence, and B-frame decode order, are all admitted only through complete output validation.
- **Refused.**
  - Carried subtitles, attachments (even when omitted), covers, chapters, data or timecode streams, programs, stream groups and unknown relationships.
  - Rotation (`allowRotation90: false`), anamorphic geometry and HDR.
  - `allowAncillary` stays `false`.
- **Caveat.** An explicitly omitted subtitle leaves the output, as on the existing routes. Measuring two omitted AAC tracks does not qualify arbitrary stream counts.

## 3. Audio

- **Rule.** Carried audio is not qualified for Matroska→MP4. The Slice 3 receipt records the reasons:
  - AAC priming, decoded-tail and delayed-start changes, despite matching packet hashes;
  - loss of the named PCM layout.
- **Route field.** The route carries `audio: 'explicitly-omitted-only'`. Every source audio stream needs a current explicit omission decision, or the file is refused before Start with `REMUX_AUDIO_OMISSION_REQUIRED`.
  - The field is accepted only on a Matroska→MP4 policy, and an unknown value is refused.
  - Stale decisions stay blocked by the contract.

## 4. Producer and metadata facts

- **Brand tags.** `major_brand`, `minor_version` and `compatible_brands` are existing operation-derived replacements and additions.
- **Handler.** A missing `handler_name` may take only the exact codec-type default.
- **`VENDOR_ID`.** This is a descriptive tag. A change yields `REMUX_DESCRIPTIVE_METADATA_DIFFERENCE`, as on the promoted ISOBMFF→MP4 route (evidence `1acb16cc`).
- **Average rate.** For valid VFR sources, differing average-rate summaries yield the warning that `3fa87a3` already reviewed, with every PTS, duration and interval still checked at the unchanged 1/500 s.
- **Decision.** "Saved with warning" under these existing reviewed rules is accepted for this route. No new metadata allowance was added.
- **Track tags.** MP4 cannot hold most Matroska track tags, so required track tags without a declared MP4 representation are refused before Start with `REMUX_TRACK_TAG_UNREPRESENTABLE`. Examples are mkvmerge's `BPS` and `_STATISTICS_*`. The refusal applies only to Matroska→MP4.
  - `language` is representable only as three lowercase ISO-639-2 letters, and `handler_name` only when non-empty.
  - The validator still compares both exactly.
  - Descriptive `VENDOR_ID` stays admitted.

## 5. Known limitation, not changed

The builder copies the source's stale brand values into the MP4 metadata list next to the real `ftyp`, and the validator does not check that they were replaced. This already happens on the promoted ISOBMFF→MP4 route (`1acb16cc`). It affects descriptive metadata only. A fix would need its own review and must touch only the new route.

## 6. Proof (fresh, budgeted in advance)

- **Harness.** `scripts/v07-remux-mkv-mp4-smoke.cjs` is a parameterised copy; the original harness is unchanged. Fixed limits per mode: 5 file-writing copies, 128 tool invocations, 60 minutes and 2 GiB growth. F: must hold the 25 GiB evidence floor plus the forecast.
- **Cases.** Each case has a pinned outcome and an exact warning set:
  - `timeline-video-mp4`: the owned delayed-AAC VFR master with both AAC tracks omitted.
  - `cfr-video-mp4`: owned `landscape.mp4` at 10 fps, made into a fresh MKV through the production ISOBMFF→Matroska route.
  - `bframe-video-mp4`: owned envelope fixture B (`has_b_frames=2`) made into a fresh MKV the same way, with its audio omitted.
- **Qualification run `838e1196`** (lab Matroska→MP4 policy; report SHA-256 `ee7c7ad4…16bd`). It passed with 75 invocations, 5 copies, one child at a time, 21 MB growth, sources unchanged and a clean closure. Ready→Cancel→stale-Start and the existing-output collision were both refused.

  | Case | Cadence (source → output) | Outcome | Warnings |
  |---|---|---|---|
  | VFR | variable → variable | saved with warning | `VENDOR_ID` + average rate |
  | CFR | constant → constant | saved | none |
  | B-frame | variable → variable | saved with warning | `VENDOR_ID` only |

- **Normal-service run `b154a940`** (the real four-route catalog, `full-remux-v2:2026-11-13:four-routes`; report SHA-256 `ab37baac…f6fb`). It had identical results, with the module hashes equal to the committed bytes.

## 7. Limits

- Only these three shapes were measured. The route still refuses every shape listed in §2.
- No carried-audio, subtitle, chapter or MOV claim follows.
- The HDR seal drift grows by `src/remux-catalog.cjs` and `src/remux-contract.cjs`; `src/remux-operation.cjs` had already drifted. There is no reseal (record 33, D7).
