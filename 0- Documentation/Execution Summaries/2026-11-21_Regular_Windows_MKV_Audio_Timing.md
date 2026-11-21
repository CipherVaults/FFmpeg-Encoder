# Windows 9.1 MKV to MP4 audio measurements

Two generated H.264/AAC-LC Matroska sources used 25 fps video and 48 kHz
stereo audio. We observed native AAC delay, padding and packet counts. We
compared the ordered AAC payloads and codec configuration, independently
decoded all 32 video frames, read the native MP4 edit and sample tables,
and compared all edit-aware float PCM samples. Times are relative to the
first decoded video frame.

| Route | Aligned source | Source with 64 ms audio delay and 95 terminal padding samples |
| --- | --- | --- |
| Plain stream copy | Equal AAC payload and sample count, different PCM and off-lattice frame timestamps | Equal AAC payload, 1,119 extra decoded sample frames and nonuniform placement |
| Reconstructed AAC packet clock | D. All 61,440 samples exact and audio placement exact | B. All 59,297 samples exact. Audio moves 3,072 samples, or 64 ms, earlier |
| Add the native leading edit to retain the delay | Outside this trial | Failed. Start correct, 95 trailing sample frames were exposed in edit-aware decode |

For the aligned source the packet-clock trial reconstructed all 61 coded
units at 1,024 samples each. Its MP4 edit used media sample 1,024 and
duration 61,440. The shifted trial retained all 59 coded units, used
media sample 1,024 and duration 59,297, and kept the complete decoded PCM
hash. It moved both endpoints by exactly −3,072 samples. Its unchanged
video frames gave the independent time origin. The follow-up stage kept
the media-data prefix byte-for-byte and inserted an empty edit of exactly
3,072 samples before the retained media edit. It exposed the expected
start but its edit-aware decoder returned 59,392 samples. The entire
95-sample difference was retained as failed evidence.

The actual shortened negative retained the same 32 video frames and
lost 30,720 presented audio sample frames. The recovered readback refused
both copy classifications. Two initial invocations failed at the missing
chapter-mapping argument. Another run retained the completed aligned
comparison and stopped at a harness packet lower bound on the shortened
negative. Recovery rehashed the saved aligned source and outputs, measured
the shortened copy and generated only the separate offset fixture.

| Receipt | SHA-256 | Result |
| --- | --- | --- |
| `dd82c1bc-51f9-4279-a5a1-99e76a995a01` | `3e53c13242dd849c43aad8ded120622391beab5b15de96ea73ff058bd4da64bb` | Plain comparison and true-loss negative complete. 14 closures |
| `5d598ceb-51be-4db0-9edb-2817b4a5ba82` | `9df4e4a6dbd468e791df3784256a552483d9fa112cd63a365f6b92d5fc056066` | One finite D and one finite B. 10 closures |
| `9581e0ef-2c25-4c31-bec9-8beb0a346a99` | `a5f34448cb5aa4ad11bd38aeebdd4de959e76d9d671ef7433828e05cf79a467e` | Retained failed offset-preserving trial. Four closures |

These are owned laboratory outputs on the rebuilt regular Windows pair.
All 28 children in the three comparison runs closed, with no app Starts or new service publications. Each run released its lease. The focused source set passed 76 checks. The default decision remains with Ahmed.
Normal-service admission, explicit re-encode and omit choices, other input
shapes, Linux and the Remux performance targets have separate proof.

## Ahmed’s default decision

Ahmed chose verified exact copy as the regular MKV-to-MP4 audio default on
November 21. A verified shift requires explicit choice for the current
file, with the measured time difference visible before Start. The
laboratory proof stays separate from implementation and normal-service
qualification of that decision.
