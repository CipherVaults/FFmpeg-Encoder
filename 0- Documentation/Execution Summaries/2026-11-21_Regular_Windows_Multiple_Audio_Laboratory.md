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
