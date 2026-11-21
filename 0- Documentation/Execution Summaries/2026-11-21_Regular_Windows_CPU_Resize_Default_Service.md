# Windows 9.1 default CPU resize

The normal factory selects two precision-FLAC resize families for the exact
rebuilt Windows FFmpeg 9.1 pair. The measured encoder settings are H.265 CPU,
slow, CRF 25. The source is progressive 30 fps H.264 High 8-bit BT.709
QuickTime with one 48 kHz stereo PCM16 track, at the measured native clocks.
The catalog supports UHD Full to 1440p, 1080p or 720p, and a 1440p range
to 720p. It derives the evidence budget from the prepared file and range.
The underlying timing, storage, telemetry and publication checks retain their
existing criteria. The shared Remux/HDR budget remains fixed.

## Fresh normal-service proof

The factory received only the verified runtime and state directory. The test
separately exercised its CPU-only capability provider. The two generated
holdouts used fresh inputs, normal Prepare, Start and publication, and the
production policy `encode-windows-9.1-v1:2026-11-21:cpu-precision-flac-resize`.
It supplied no qualification or evidence budget override.

| Job | Complete output | Exact selected PCM sample frames |
| --- | --- | --- |
| 125-second UHD Full to 720p | 3,750 frames, 20,713,896 bytes | 6,000,000 |
| 145-second 1440p to 720p, 106 seconds to source end | 1,170 frames, 8,587,591 bytes | 1,872,000 |

Independent readback reconciled both sources, both outputs, all six spools,
publication records and storage finals. Maximum video PTS and audio clock
errors were 334 µs in both cases, with exact PCM and zero sample difference.
The unsupported UHD four-second trim was refused before Start. Its output
directory was empty and the refused Start attempt launched zero tools.

Receipt `197d924e-cea4-41dc-a283-c16e5dd731cf`, SHA-256
`189dba24e7eba0e130acf5c56b932e6892135986b2cf862a4923db1dfec2e5bf`.
Two Starts and all 39 children closed. The lease was released, the external
process census was empty and all 116 producer hashes stayed exact.

## Regressions and limits

Fresh default TS run `e46bfb30-cd70-47ef-83ed-c702d8c28400` passed the six
precise seeks and the paired cut refusal. Fresh default standalone MP3 run
`ef8f6ade-b59b-4230-b1f7-47017559952d` passed three verified copies and the
bounded negative, cancellation and provenance checks. Both used the same
unoverridden factory. Their leases and media processes closed.

The final controlled Windows set passed 115 checks. A separate exact-parent
comparison on Windows reproduced the same six Linux path-fixture failures
before and after the change. All other 14 Linux proposal tests on Windows
passed. The current static source inventories checked 162 product pins and
192 inert package rows, with the historical 97 pins retained. The prior
combined receipt retains its stale branch-anchor failure. The updated anchor
and historical tuple check passed.

These results cover the named CPU operations. Physical GPU, broader route
qualification, native Linux and package acceptance remain open. Remux
throughput still needs its separate 3-second and 6-second-per-GB measurement.
