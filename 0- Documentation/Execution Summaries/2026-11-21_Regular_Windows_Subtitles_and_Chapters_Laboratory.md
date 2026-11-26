# Windows 9.1 subtitle and chapter measurements

An owned Matroska Full copy preserved five plain SubRip cues, their exact
packet hashes and millisecond intervals, Arabic language, track title and
default and forced flags. Both files independently decoded to the authored
text and the same 75 video frames. The `[500,1500)` ms component clip
omitted two cues and rebased three cues to `[0,300)`, `[250,600)` and
`[750,1000)` ms. Independent file inspection verified the emitted text.
The styled cue and inexact millisecond boundary were refused. The actual
SubRip source received the specific unsupported mapping reason for MP4.

The subtitle files also exposed a production blocker. Current native
verification refuses their non-video CueTrack entries because the index
packet mapping is unproved. The first run stopped at this check and
retains its failed verdict. The bounded measurement copied the exact
retained source into a new owned directory and recorded payload and text
results separately from the unchanged native-index refusal. The clip
is a component test with its own video, without an Encode trim job.

A separate Matroska copy retained its chapter clocks, IDs, titles, and
coded and decoded video. Native readback confirmed `Opening` at 0–1 s
and `Closing` at 1.3–2.4 s. FFmpeg 9.1 writes chapter language `und`,
confirmed on both files and in the pinned writer source. The existing
native language guard refuses that declaration. The MP4 assessment still
requires an exact chapter carrier with the complete presentation interval.
The test-only measurement preserved both refusal reasons.

| Receipt | Result |
| --- | --- |
| `b5ea170f-5d64-4f76-b685-4aff8d3df2db` | Failed at native subtitle CueTrack |
| `cb909cb1-77bf-4799-9142-9524d5d2285a` | Exact caption and clip measurement retained. The subsequent source had chapter clocks without titles |
| `927a9e3e-d60a-4778-a778-d939647c073e` | Failed at manual chapter-metadata routing |
| `7842c6e4-46fa-410f-9c30-6997cbdd51dc` | Authored chapter titles retained. Native language guard refused |
| `3b790e0d-1128-4a98-9074-d1821465bf06` | Chapter marker, timing and video readback complete. Production language refusal retained |

The caption receipt SHA-256 is
`387e06c9282b79fc61814f8a7bb8dd33b230f4ee232d43deb2b7fb08c4489ede`.
The final chapter report SHA-256 is
`d7cb28ab1fedba92c86b754fe62c5a6c8eb6d44107c74ce391217f67b7ecf8ed`.
Independent readback rehashed the seven saved media files and reconciled the
20 closure records across these two measurements. The other three runs
also released their leases. The campaign recorded zero app Starts and zero
app publications. Normal-service admission stays open.

The focused source set passed 84 cases. An earlier broad run retained
413 passing cases and a nonsettling native inventory test worker. The
owned worker was stopped and its failed receipt was kept.

## Regular Windows service

The default regular Windows 9.1 factory selects
`full-remux-matroska-timed-windows-9.1-v1` for two measured Full
Matroska shapes. One has H.264 plus two flat, named chapter markers
with native IDs 1 and 2, whole-millisecond intervals and a single
explicit `und` display language. The other has H.264 plus one plain
Arabic SubRip track with default and forced selection. The second
shape preserves the track title, text and exact intervals, including
overlaps. The muxer can assign a new file-local subtitle TrackUID.
Native references and carried tags remain checked against the track on
their own side.

| Default holdout | Verified preservation | Before-Start refusals |
| --- | --- | --- |
| Flat chapters | 75 complete decoded video frames, exact chapter IDs, 240–1130 ms and 1460–2440 ms, titles and native display language | Alternate chapter language and unqualified MP4 chapter carrier |
| Plain SubRip | 75 complete decoded video frames, five exact text payloads and intervals, native cue coverage for all five ordered blocks, including time zero | Styled text, deliberately changed CueDuration and unqualified MP4 subtitle mapping |

Both copies used packet-identity verification and protected publication.
Independent readback rehashed 310 physical packet extents and reconciled
300 full decoded frame rows, both output seals and 26 retained artifacts.
Subtitle packets were joined to native block ordinal, offset, size and
clock and hashed from their actual extents. Every selected subtitle cue
bound both relative position and duration to its native block. The
independent decoder matched each video and the emitted subtitle text.
For the five refusals, the attempted Start launched no child and left
the destination empty. All 42 final owned children closed and both
leases were released. The launcher saw no remaining candidate process.

| Run | Evidence | Report SHA-256 |
| --- | --- | --- |
| `72b1bd4f-b135-4f87-86a2-947fb74495f8` | Failed prospective chapter run. Exact saved copy and language refusal preserved. MP4 exposed a generic diagnostic before the specific carrier refusal was wired. | `5789a0b5764d545fe45a42d0aceaaa355316a5af72536e73e1cb14dca228ad1a` |
| `61321707-6bee-4e41-95f8-b73c8fbf0e86` | Passed earlier default chapter-only checkpoint. | `a6976a0744d4236de47740e3dabd5a9c557f9a254a4a5d0089406e194edb50a5` |
| `d742a6c8-bad8-434a-98bf-74b4f03916bd` | Failed prospective subtitle run. The saved product output passed its verifier. The external oracle compared the regenerated file-local UID as a semantic selection value. The failed verdict remains. | `e3e5fd8e5938d5a720290fff7c043833ec6d43fe5587bd9f534b63f128e0e5d8` |
| `0c164517-9c68-4f72-aeeb-3ed4a003e574` | Passed prospective subtitle preservation with styled-text and MP4 refusals. | `f038affd5df86c1249609637d4e8bc2c518419a75728f8a0d387d1fc499abd17` |
| `b0f690f2-48e3-4092-948e-2facc799518e` | Passed final default chapters. One Start and 19 closed children. | `98257fdcd956ab1ebc432fb8b4f5ed1ac7a8a530b90cc78ce95e68206f539331` |
| `133545fc-1a09-4c27-90da-a975b5b15dfa` | Passed final default SubRip. One Start and 23 closed children. | `6e0b4c25edb6ccddf418edfe64ab516a705e11fef6c5f744057bcae92d61e4a2` |

Final focused test receipt `20261126T224412Z_q2m-windows-timed-matroska-final`
records 243 passes and exit 0. One historical 9.0.2 fixture skipped
because its audited-pair directory was unset. SHA-256
`00df46c0d53b93bc036e5e1d395734f3c14d27c6b05829014ed9172a52f42675`.
Three separate Windows-host Linux inventory checks passed. The frozen
historical Linux producer map remains intact.

The fresh default TS check `38649b0f-7da2-4f66-ad08-a96dc1b00573`
matched all 240 linear frames and the first presented frame and PTS at
all six fixed targets. It closed 19 children. Report SHA-256
`77037b853eec4d55a6863195a6b1d5fed9c3eddde2269391aa8a8f852ca0d2f4`.
Standalone MP3 check `2a464489-8527-4af5-92a7-6988a84a0159`
passed its default-service copy and protected lifecycle tests with 35
closed children. Report SHA-256
`54e4fd86fc72fd543780ca75a77520718ba00cc5f52db598738f546612dccae4`.
The 1,340 historical TS comparison rows retain their original scope.

This Q2m checkpoint covers two separate Full Windows remux shapes.
Subtitle clipping remains component evidence. Other subtitle and chapter
shapes, native Linux, visible UI acceptance and the Q2o speed targets
require separate evidence.
