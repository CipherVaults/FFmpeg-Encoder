# Measure Windows precision AAC range clocks

The rebuilt Windows FFmpeg 9.1 pair produced explicit terminal AAC
discard padding for both measured layouts in Matroska. The decoded
span matched the exact selected PCM sample count in all four cases.
This is laboratory evidence from the canonical H.265 CPU slow CRF 25
range builder. No application Start, publication or production
qualification occurred.

The inputs were generated three-second, zero-origin H.264/PCM MOVs.
Video was 1280×720, progressive limited BT.709 at 30 fps. The two PCM source layouts were
48 kHz mono and 44.1 kHz stereo. The AAC outputs used their layout
defaults of 128 and 320 kb/s, respectively. The checks used off-grid middle and
source-end cuts and independent complete frame and audio decodes.
Each channel passed the bounded zero-lag signal comparison. That
comparison tests alignment after lossy AAC encoding.

| Source audio | Range (µs) | Selected and decoded samples | Signalled terminal discard (samples) | Video frames | Native duration (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| 44,100 Hz stereo | 1113371–2073917 | 42,360 | 648 | 29 | 986 |
| 44,100 Hz stereo | 2177311–3000000 | 36,280 | 584 | 24 | 846 |
| 48,000 Hz mono | 1113371–2073917 | 46,107 | 997 | 29 | 986 |
| 48,000 Hz mono | 2177311–3000000 | 39,489 | 447 | 24 | 844 |

The one priming unit remains 1,024 samples. Native CodecDelay was
23,219,955 ns at 44.1 kHz and 21,333,333 ns at 48 kHz. The independent
native read and FFprobe terminal side data matched the derived
discard. Complete decoded audio already excluded the priming and
terminal discard. The decoder did not need another subtraction.
The 44.1 kHz near-end cut begins at PCM sample 96,020. Its common
quantized audio origin is tick 96,019. Keeping those values
separate preserves the half-open range.

| Run | Report SHA-256 | Outcome |
| --- | --- | --- |
| `946a1a2e-f684-446c-801a-3593910c5683` | `63b2ca46cb938218be5a4deda3a76f6db38d3eeb30ebd5c79c5389c922485046` | Retained fixture argument failure. One child closed. |
| `290c6a12-d760-4be7-b290-fbb9c9d2da5e` | `ada0c8d909aaaacf13f8592a9e58a57db3849f311ed19a4e6cc7e9c86ec6766d` | Retained mismatch with the earlier unstated-tail assumption. Ten children closed. |
| `a2e5ef19-647f-4a2c-90ff-508a5eb09041` | `f4f2ec774ee089fec70e119d791dd1c5a52e4bcf24b986c3fa872080cfde8295` | Readback of saved source and first output. Eight children closed and no encode. |
| `c38c5ef3-0e2f-428d-ad66-0bd7c61faf3f` | `769b9bf6367d9b4be017d3f780b9d6f87d3d4b938f07d6afbc29bf10b8be2d8d` | Four cases checked. Three new direct encodes and one recovered output. 28 children closed. |

The final receipt imported the first source and output by full
identity from the retained attempt and kept those originals in
place. It generated one separate mono input and wrote three new
outputs under the owned test namespace. All 28 children closed
serially and the lease was released. The engine was the rebuilt
ordered pair
`faea502a4addd1dde4b74f1a63ae454d3615c7c04fac7d9b20b85a77c74b5590`.

Independent saved-output inspection confirmed both source hashes, all
four output hashes, the physical AAC block payloads and video frame
timestamps, exact discard arithmetic and all 28 child closures.
The controlled run passed 120 checks. Its receipt SHA-256 is
`79f4386b54a3ee8c12696e7e68d9c8e3810e6512d668431bf50c4d5c9844dbdb`.

Continue with a separately bound Windows production representation
that verifies native discard, exact sample count, packet order and
complete decoded timeline before publication. The prior Linux
unstated-tail model remains historical evidence for its exact
runtime. A new Windows family needs fresh default-service
holdouts and refusals. This proof covers the two PCM input layouts,
not existing AAC input, longer files or GPU encoding.

## Windows default service

The regular Windows factory now qualifies the explicit-discard AAC
clock on the rebuilt pair. The source gate is the measured three-second
1280×720 30 fps progressive BT.709 H.264 High QuickTime source with one
zero-origin PCM track, up to 8 MiB. The measured CPU H.265 slow CRF 25
plan keeps the source resolution and uses the layout-default bitrate.
The verifier requires a range of at least half a second within that
source. It checks the native clock, AAC track, every ordered coded and
decoded unit, explicit priming and terminal discard, complete decoded
PCM byte count and the independently observed video and audio clocks.
Pre-encoder telemetry independently binds the selected inputs.

| Fresh output AAC layout | Exact selected and decoded samples | Terminal discard (samples) | Video frames |
| --- | ---: | ---: | ---: |
| 44,100 Hz stereo | 40,929 | 31 | 27 |
| 48,000 Hz mono | 38,439 | 473 | 24 |
| 48,000 Hz mono | 32,768 | 0 | 21 |

The zero-tail holdout used an exact 32,768-sample interval and verified
zero declared discard samples. The fixed one-millisecond Matroska
clock cannot express a positive terminal span for the paired
one-extra-sample input. Prepare refused that range with the specific
clock reason. A custom 160 kb/s request also refused before Start.
Both rejected Start attempts spawned zero children.

| Run | Report SHA-256 | Outcome |
| --- | --- | --- |
| `005a3a13-12a4-4ec3-8526-6b6ab41ff549` | `553f9dc4a6db553be6f6635f278eed2176a49adb427a0e533c3163e248b22396` | Retained first service attempt. The PCM sink had no final byte-count accessor. |
| `6822d578-d758-4f1b-91a1-e5f7bcf8973c` | `ccaa8d79fe35dc83b8b0112c7d8fb5dd031a43807098f35f681a51e5418feddf` | Prospective service published two holdouts. 33 children closed. |
| `2a2ac4db-d4a2-4c78-bdba-16920f89112c` | `e29d9d4439b3829b277c4236dc556c5db36283daeb41fe963cd011afb82591da` | Initial default service published three. 48 children closed. |
| `028cc1a3-d496-4cd7-b3a0-a88a412ffb06` | `e2495e50afcce2d23bcec979c6dbf8d3176b8449bc85d24eb869beb238ae99d9` | Default service published three, with the specific range-clock refusal. 48 children closed. |
| `5a7990fb-2693-4bf8-b92a-db895cb77b1d` | `3acfbc878b4b232e0686fd19a398b8ca230adc03ce1a4ecd66d2df2e1f722e40` | Final-byte default service published three, with the AAC-specific receipt scope. 48 children closed and the lease was released. |

The exact-byte controlled regression run `q2f-windows-discard-close`
passed all 405 checks with exit code zero. Receipt SHA-256
`eb4b37b4c7f682252d76e0f78676dbf44b8b29f2f9862e1b756ab5a2b9423be2`. Three independent Windows-host checks passed for
Linux source and package inventory integrity. Native Linux execution
remains pending. The November 27 re-entry matched the current service
and test files to both saved receipts.

The exact Windows Encode policy is
`encode-windows-9.1-v2:2026-11-22:cpu-resize-and-explicit-aac-discard`.
The two Windows precision-FLAC resize families keep their prior
source and evidence budgets. The existing Linux implicit-tail AAC
policy retains its own exact runtime records. The current Linux
source/package inventory includes the shared module, with 165 current
source pins and 97 preserved historical producer pins.
