# Regular Windows 9.1 Remux timing

The default service completed two MPEG-TS → MP4 copies on the rebuilt
Windows 9.1 pair. The two generated sources have the same 60.032 s
duration, 1080p30 video, 1,800 H.264 pictures and 2,814 stereo AAC
packets. The encoder rate differs. Both source files and both verified
outputs were retained. The final report binds the current source and
runtime and uses only runtime and state directory as factory inputs.

| Coded source | Prepare to Ready | Copy child | Copy close to terminal | Full wall excluding copy | Speed envelope |
| --- | ---: | ---: | ---: | ---: | ---: |
| 14,335,940 bytes | 3.066 s | 0.077 s | 3.703 s | 7.169 s | 3.086 s |
| 110,020,420 bytes | 21.722 s | 0.189 s | 22.580 s | 44.710 s | 3.660 s |

The 3 s fixed plus 6 s per decimal GB envelope missed on both cases.
The two-point fit estimates 0.875 s fixed and 197.28 s/GB post-copy.
Including Prepare and other service work outside the copy child gives
1.545 s fixed and 392.34 s/GB. Removing the measured exclusive harness
intervals still gives 196.76 s/GB post-copy. The fitted intercepts are
provisional estimates from two sizes. The underlying disk cache was
warm from source sealing. The receipt reports logical read operations.
Physical file I/O and cold-cache throughput remain unmeasured.

The high source and output packet dumps emitted 465,767,710 and
464,936,936 bytes respectively. Their child lifetimes were 21.173 s and
20.622 s. The source retained its exact packet clocks and the published
output matched the sealed essence. The packet-dump traversal is the
first performance investigation. Measured lifetimes include backpressure
from the collector, so the timing alone cannot apportion the cost
between FFprobe and the JavaScript consumer.

- Run `7a11e48a-9bfd-4f5c-98c7-8d86f1473056`. Report SHA-256
  `89f50158402ba5a09f84d38bcc540d76f6d237aad46fbd1941f709df3d0fb5e1`.
  Status `measured-target-miss`, exit 2. Two successful Starts and
  protected outputs. All 21 children closed and the lease was released.
  The final external census was empty.
- Source revision `fc024edef22f7b02c095739c5afacdca2b098161` plus the
  timing-only harness recorded in the module pins. The controlled
  `20261126T225059Z_q2o-windows-timing-harness` receipt records
  115 passing tests and exit 0. SHA-256
  `eaeb6988703988a968103a553ad8cbed65fa37613079d678a97bfdf544f2b479`.

This measurement keeps the target open. Quick copy remains design-only.
Keep the successful packet proof and the speed verdict intact. Any
further run must recheck its actual storage reservation above the
25 GiB floor. Native Linux, full R and final S remain outstanding.

## Matched input optimization

The same two input files were read under their original SHA-256 and
filesystem identities. The repeat ran high first with new output and
state paths. It kept the 25 GiB scratch floor and checked the exact
product reservation before each Start. Its supplemental operational
margin was 32 MiB because the sources were already retained in place.

Source acquisition uses complete FFprobe metadata and packet SHA-256
with sequential raw FFmpeg data streams for the regular Windows pair
within the 20,000-record budget. The source integrity walk, packet
ordering, exact clocks, codec admission, and before-Ready guards still
apply. A narrowly typed disagreement can use the legacy collector after
the read closes cleanly on the same input. Larger record budgets use the
existing streaming collector. Neither path admits a new source shape.

For the MP4 output, a private native sample walk binds every packet to
its ordinal, exact file extent and key flag. Each extent is read under
the held stage identity and its raw hash must match independent FFprobe
metadata. Output packet checks, edit-list checks, complete coded header
validation, endpoint decodes and the file seal still apply. Both fresh
outputs reproduced the baseline's complete packet and timestamp
transcripts. Independent readback joined all 9,228 output samples to
their actual nonoverlapping MP4 extents and hashes.

| Coded source | Prepare to Ready | Copy child | Copy close to terminal | Full wall excluding copy | Speed envelope |
| --- | ---: | ---: | ---: | ---: | ---: |
| 14,335,940 bytes | 1.252 s | 0.076 s | 2.459 s | 4.119 s | 3.086 s |
| 110,020,420 bytes | 2.903 s | 0.189 s | 2.916 s | 6.215 s | 3.660 s |

The post-copy fit was 2.391 s fixed plus 4.776 s per decimal GB.
Both measured post-copy times were below the unchanged envelope. The
full run excluding the copy child fit 3.804 s fixed and 21.911 s/GB,
and both cases remained above the envelope. The source-origin storage
cache was warm and the case order differed from the baseline. These
measurements cover the stated sizes and Windows TS route. The
broader end-to-end and long-source timing targets remain open.

- Matched run `daeaab42-3eeb-4dcd-93c4-d05dec2277b8`. Report SHA-256
  `30838413eefd0e6a28a5dc88acf3b9c4106b9865aa421bf5f72bc83000dd9853`.
  The combined verdict remains `measured-target-miss`, exit 2. Two
  protected publications, 27 closed children, media lease released and
  final external census empty.
- Current normal TS seek run `5974ea64-4fea-4b0e-a972-aebd3368ddd2`.
  All 240 linear frames and all six exact first-frame hashes and PTS
  values matched. The before-Start cut-head refusal held. All 23
  children closed. Report SHA-256
  `859bcdc70b829f152a058a86aec18a0888ac2218901f354851ce02e99e927b1d`.
- Final test receipt `20261126T230432Z_q2o-windows-binary-transport-final`
  records all 204 checks passing, including a same-length wrong binary
  payload that recovered only after the child closed. SHA-256
  `13e924b9458c34ab5a83a7080b9974e486039cb30bc748accb046d3dbea0386e`.

## TS parser source checkpoint

Source `edb4beaf96d0bc1e701adf6e424ad9bb647e7a48` reduces repeated work in the native TS assessment. It passes each complete 188-byte chunk prefix to the existing integrity walk in one call, copies the partial tail and uses a bounded native search for the same Annex B start code. Every transport packet, native clock, refusal, NAL boundary, byte limit and packet hash comparison remains required.

382 transport and native inventory checks passed, as did four additional direct framing and timing checks. Three current Linux source and inert-plan checks passed with the historical pins preserved. The focused split-tail receipt `20261127T004735Z_q2o-transport-chunk-and-annexb-boundaries` is SHA-256 `8abac84cb5268b6c5f6cc3867f483be6a49579a0a2c5d206b68ced7f8bb72d0e`.

The existing measured combined-service verdict remains a miss. This change has no new normal-service timing, publication or seek receipt yet. Reuse only the exact sealed low and high inputs under the previously approved timing guard. Preserve the full timing envelope, exact packet joins and final first-frame/PTS comparisons.
