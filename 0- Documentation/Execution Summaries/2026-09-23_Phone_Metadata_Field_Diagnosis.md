# Samsung phone MP4 metadata diagnosis and correction — September 23, 2026

Status: bounded diagnosis and production correction verified. This report does not accept the portable release; parent integration, native UI evidence and fresh M acceptance remain separate.

## Evidence and cause

Only the two supplied personal recordings were read: `Screen_Recording_20260502_014538_Azahar.mp4` and `Screen_Recording_20260502_021156_YouTube.mp4` under `F:\shadow play\OBS`. Their production sparse identities matched before and after experiments. Every media destination was a new project-owned artifact with FFmpeg `-n`.

The known portable batch log `ca0be904-9149-422d-9312-424f0af875a1.json` records Archive Quality P7/CQ32 failures for both files: `Stream 1 → 0: metadata 'creation_time' was not preserved. Stream 0 → 1: metadata 'creation_time' was not preserved.` The later CPU batch log was also inspected for these exact rows. Historical logs contain result summaries, not raw probes, exact argv, FFmpeg stderr or failed staged-file bytes. No claim is made about the unavailable historical stderr or the bytes of cleaned-up staged outputs.

Both originals have audio stream 0 (AAC), video stream 1 (H.264), and per-stream `creation_time`, `language=eng` and handler names. The production map intentionally selects video as output 0 and audio as output 1. The creation times are `2026-05-01T22:45:38.000000Z` and `2026-05-01T23:11:56.000000Z`, respectively.

Pinned `ffmpeg version 9.0.1-full_build-www.gyan.dev` reproduced the exact two refusals for each three-second fixture. A direct three-second stream-copy remux of each actual original to Matroska separately retained global creation time, Android version, Samsung UTC offset, brand metadata and handler/language data, but omitted both track creation timestamps. Its stderr was empty. This isolates the container representation issue from the encoder and from stream mapping.

The [official FFmpeg Matroska muxer source](https://www.ffmpeg.org/doxygen/trunk/matroskaenc_8c_source.html) corroborates the observed behavior: `mkv_check_tag_name` filters `creation_time` from SimpleTags, while `mkv_write_info` writes global creation time as DateUTC. This current upstream source is supporting explanation; the pinned executable experiment is the exact-runtime evidence.

Reproduction evidence: `artifacts/phone-metadata-field-1790143524642-5847db51/report.json`, with exact argv, full raw ffprobe JSON, stderr, mapped indexes, validation failures and source identities. Adjacent `.ffprobe.json` files preserve the raw metadata snapshots.

## Correction and narrow limits

`src/media.cjs` now writes the exact source track `creation_time` string as `SOURCE_CREATION_TIME` on the same mapped Matroska video/audio/subtitle track. Any unequal existing alias, including case-insensitive variants, refuses preparation instead of overwriting user metadata. Conflicting case variants of the source timestamp also refuse.

`src/inspection.cjs` accepts this representation only when the output is Matroska, the mapped stream is video/audio/subtitle, the original `creation_time` key is absent from that output track, and every case-insensitive alias value equals the original string exactly. It does not use another track or a global timestamp, normalize the alias date, or ignore missing timestamps. Container, chapter, attachment and all other meaningful metadata remain subject to existing strict checks.

Inspection reconstructs `summary.metadataNotices` explaining the representation using the source stream index, including on cache reuse. The preservation policy version changes from 1 to 2. Parent UI integration displays these notices. A later encode of an aliased Matroska input copies the alias as ordinary metadata; it does not invent `creation_time` or infer a date.

## Verification

- `node --test tests/inspection.test.cjs tests/media.test.cjs tests/inspection-cache.test.cjs`: **85 passed, 0 failed**. New cases cover reordered streams with different timestamps, exact alias requirements, absent/wrong/conflicting aliases, collision refusal, unchanged global/chapter/attachment strictness, ordinary lost metadata, reconstruction notices and alias-only re-encoding.
- `node scripts/phone-metadata-field.cjs artifacts/phone-metadata-field-1790143524642-5847db51/report.json`: both owned phone fixtures encoded with the exact production Archive Quality builder and passed production output validation and full video/audio decoding. Each output preserved both exact track timestamp strings. Original identities remained unchanged.
- Copied AAC payload verification: **138 packet SHA-256 values matched in order for each fixture/output pair**.
- A subsequent production-builder encode of the first new Matroska output passed validation and retained both aliases exactly. It emitted no new timestamp representation notice because its existing aliases were simply copied.

Fixed evidence: `artifacts/phone-metadata-field-1790161461195-c78aeb14/report.json`. The reusable script is `scripts/phone-metadata-field.cjs`; supplying a prior report reuses its owned short fixtures and preserves the prior failing evidence. The successful native run preceded the addition of the script's AAC-packet assertion; the same recorded successful outputs were then probed and the exact packet comparison appended to the report without re-encoding.

The first preliminary harness run, `artifacts/phone-metadata-field-1790143415821-b11482ed`, used MP4 `use_metadata_tags`, which duplicated the fixture's global timestamp and caused an additional global validation failure. That was a fixture-generation error, not an original-media finding. The corrected extractor removed that option. The short MP4 fixtures preserve every source stream tag, but MP4 muxer bookkeeping and global vendor tags differ; direct remuxes of the originals independently establish global metadata preservation. All preliminary artifacts are retained.

This is bounded native media evidence, not full-duration processing of either personal recording, packaged UI acceptance, or an independent filesystem writer lock. Original preservation uses production sparse identity checks, not full-file hashes. Accepted 0.5 and J/K/L evidence were not rerun or changed. No commit or package was made by this subtask.

Independent review qualification: the second NVENC phone null-mux decode returned0 with four non-monotonic DTS warnings in the retained stderr. Completed decoding is not a warning-free decode claim; metadata/stream/AAC preservation checks remain verified. See2026-09-23_Field_Fix_Independent_Review.md.
