# Windows 9.1 multiple-audio MP4 copy laboratory

Two owned MP4-to-MP4 cases retained one BT.709 H.264 video and both AAC-LC
tracks. The native sample extents and edit lists, ordered payload hashes,
codec configuration, full decoded video, and edit-aware float PCM all
matched. The language, layout, track order and default flag matched for
each slot.

| Source | First audio | Second audio |
| --- | --- | --- |
| Mixed clock and layout | 48 kHz stereo English, default, 95,232 sample frames | 44.1 kHz mono Arabic, 88,064 sample frames |
| Same clock and layout | 48 kHz stereo English, 95,232 sample frames | 48 kHz stereo Arabic, default, 95,232 sample frames |

The tracks had different content. The physical negative swapped the two
same-layout payloads while restoring the original languages and default
flags. The copied tracks exchanged their decoded hashes. The comparator
refused the change at the first audio packet identity. It verified
60 video frames per input and output.

The first generated source used partial terminal AAC frames. It was
refused at the native source edit check before copy. The later fixtures
ended on full AAC frame boundaries. The source-edit criteria stayed
unchanged. Retained run `139d0c67-e4ac-4419-9b9f-4629340d8fe1`, SHA-256
`a1f158a8cd6765cec23ea2e16fb541fb0f02319c5712ec06947891b85ba3c59e`.

Passed run `2a7969b6-f64f-47f9-b302-bdf40e551082`, report SHA-256
`832a3e3dd2982c6bd4b186738c822333d34d2cfb48a2968a38b6d47f486d51e4`.
All 25 children closed, the external process census was empty and the
lease was released. The focused source tests passed 85 cases.

The evidence covers these two generated shapes only. It gives no new
normal-service admission. Other audio shapes, the MKV audio default and
the Remux throughput targets remain separate.

## Regular Windows service

The regular Windows 9.1 pair now selects
`full-remux-isobmff-mp4-two-aac-windows-9.1-v1` through the default
catalog. The held source must be the measured H.264 plus ordered English
and Arabic AAC-LC shape. The mixed shape retains 48 kHz stereo English
as default and 44.1 kHz mono Arabic. The twin shape retains both 48 kHz
stereo tracks and Arabic as default. The policy requires an exact
packet clock, priming and complete AAC units, with complete per-track
PCM and native MP4 edit/track checks before publication.

| Default holdout | Video | English AAC | Arabic AAC |
| --- | --- | --- | --- |
| Mixed layout | 60 frames | 92 packets, 93,184 sample frames | 84 packets, 84,992 sample frames |
| Twin layout | 60 frames | 90 packets, 91,136 sample frames | 90 packets, 91,136 sample frames |

The holdouts differ from the earlier lab and prospective files in
content and sample extents. Independent full decoding matched each
video and each ordered audio slot. A real swapped-payload twin kept
language and default flags but exchanged its two decoded audio hashes.
The collector refused it at `REMUX_PACKET_SIZE`. Prepare refused a
partial terminal AAC unit at `REMUX_SOURCE_EDIT_UNSUPPORTED`. Its
invalid Start launched no media child and produced no output.

| Run | Outcome | Report SHA-256 |
| --- | --- | --- |
| `7c994d79-7b92-42c3-a604-0bb51402563c` | Failed prospective attempt. The stream normalizer dropped FFprobe's AAC seek preroll before validation. One Start, 12 children closed, retained unpublished stage. | `09c252a1696f6bc7889bdde71d8b215efe609a8d73981540e42d324b2ec67f19` |
| `a4e71a9b-880d-4b87-b0d5-40c64805d8ad` | Passed prospective policy after preserving the reported field and changing the normalization cache version. Two Starts, two saved outputs, 70 children closed. | `7ec5c25541ef37fe944265f0effc8955407aec15f5ab6eb49f900d0d7df83217` |
| `7f033563-0ba4-4369-9876-83f2c7039275` | Passed default factory with only runtime and state directory injected. Two Starts, two saved outputs, 70 children closed, final census empty, lease released. | `1e23ffc87d7835df4907bf91ab13a7418449dd41ef79644741e93fb39b763975` |

The default receipt pins 120 module files and 26 runtime files. The
controlled test receipt `20261126T222435Z_q2l-windows-exact-two-track`
records 256 passes and exit 0, SHA-256
`1394af88f9ae65102f6ac04f1329f66d63f5d5ef284a86469b6ac6ea2927e094`.
Three separate Windows-host Linux inventory checks passed. Native Linux
media execution remains open. Shared source changes affect historical
exact-byte qualification bindings, and each earlier receipt retains its
original verdict. This checkpoint covers the two Windows layouts above.
Other track counts, chapter and subtitle preservation, and Remux
throughput need separate evidence.

Independent readback rehashed all producer and runtime pins and checked
1,192 physical packet extents in the five owned MP4s against the saved
evidence. The launcher recorded zero candidate processes after exit.
