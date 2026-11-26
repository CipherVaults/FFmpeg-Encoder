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
