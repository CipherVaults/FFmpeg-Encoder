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
