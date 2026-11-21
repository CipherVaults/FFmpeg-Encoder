# Qualify standalone MP3 copy through regular Windows Remux

## Product path and limits

The Windows 9.1 default policy `full-remux-windows-9.1-v2:2026-11-21:transport-layer3` retains the current TS route and adds a finite MP3 route. It admits an untagged, contiguous MPEG-1 Layer III mono or stereo input at 32, 44.1 or 48 kHz, bounded to 4 MiB and 4,096 frames. Inputs with incompatible headers, hidden trailing bytes, ID3, artwork and gapless or Xing/Info/VBRI metadata require separate support. The product validates the source’s full bytes at Prepare and Start, verifies the actual temporary MP4, then checks the source and exact stage again before the existing exclusive publisher. It keeps the MP3 track without AAC conversion, marks that sole track as default and warns that some Apple players may not play it.

The three retained specimen shapes each preserve all 40 compressed frames, their packet/sample clocks, exact native MP4 representation, and 46,080 decoded signed 32-bit sample frames. The complete PCM digests match. The normal app marker and fresh output UUID are required in each result.

## Same-pair native evidence

| Run | Evidence ID | SHA-256 | Result |
| --- | --- | --- | --- |
| Latest isolated MP3 policy | `883d570b-2d2f-43f6-a911-26873be841ef` | `4981224cecee9cc093fa95b35554f28f13946d7f01a6c99c5b9c1f6b8cab460b` | Three verified copies and all lifecycle controls |
| Default MP3 service | `c54ffba8-6b23-4d00-9fc7-a86a56dac2da` | `0eef7c99eee042f4dc30d3af2656316283c844a99e5369d1aa2250fb83526102` | Same behavior through production factory policy |
| Combined policy TS seek | `e9e9783e-00ce-4bf5-bbae-16906f87a130` | `cf0ff793efc5b54ccaeb0e50019f154d1fb9d92a388e1bca7fefb37df0d42d77` | Exact 240 frames and six first sought frames, with refusal for the paired cut |

The default MP3 run accepted six Starts. Three saved copies passed verification. A changed source failed before copy, a new destination collision preserved the existing bytes, and active verification cancellation stopped its live FFprobe child and retained only unverified stage bytes. The malformed input was refused before Start. The same-folder scan excluded the marked file as generated. Recovery in a separate state directory located the matching pending intent without writing a publication record or changing the output. The lab and default each closed all 35 children, including one Windows storage helper, released the media lease and left no matching process. The TS regression closed all 19 children with the same lease and census closure.

The original product lab attempt `aa346098-529d-4cdd-a5f3-04c6e54ede04` remains failed on the storage reserve floor, with zero publications. A later trial `ff79d1a4-f95c-42eb-bf6a-a4ffa9fa6745` remains failed because its harness expected read-only provenance reconciliation to write a publication record. The stored output from that run and all failed receipts were preserved. The corrected run checked the intended pending-only behavior.

## Controlled evidence and next gates

The final Windows receipt `q-win-mp3-normal-source` passed 434 controlled checks. Three static Linux source and package-plan checks passed separately on Windows. The Linux current source inventory contains 162 pins and the three added modules. The 97 historical producer hashes and native receipts remain attached to their original artifacts. Actual Linux execution, broad TS and MP3 inputs, final package, Apple playback and new hardware evidence remain open.

Next, show the selected Gauge in a live preview before any shipped icon replacement. Continue the approved long trim and resize work, including 4K to 1440p and 1080p and a 1440p source. Keep wider Q qualification, exact performance targets, owner decisions, then R and S separate.
