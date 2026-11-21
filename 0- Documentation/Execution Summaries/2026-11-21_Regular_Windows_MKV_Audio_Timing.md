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

## Regular Windows service qualification

The regular Windows 9.1 factory admits only the measured one-video,
one-AAC shape. It requires 320×180 progressive 25 fps SDR H.264 and
48 kHz stereo AAC-LC, the native Matroska priming and terminal-padding
combination, and a complete source no larger than 4 MiB. The exact
copy needs no decision. When the measured placement is 64 ms earlier,
Prepare blocks the file until the user chooses that specific shift.
The choice binds the current file, full source hash, audio stream,
draft revision, target and runtime. The Inspector and Selected Files
review show the shift before Start. Saved results disclose the shift
after verification. Other clocks remain unsupported.

Every publication needs a complete match of the AVC packets and
timestamps, AAC coded units and audio configuration, independently
decoded video and float PCM, native track and seek controls, and
the complete MP4 sample and edit tables. The published bytes match
the sealed temporary output. The service keeps its original
no-overwrite output policy. MP4 marked the sole video and audio
tracks as default on both fixtures. That representation and the
descriptive encoder-tag difference both produced warnings.

| Case | Presented source and output at 48 kHz | Video | Service outcome |
| --- | --- | --- | --- |
| Exact | [0, 76800) on both sides | 40 frames, exact PTS | Saved with no audio shift |
| Explicit shift | [3072, 77729) to [0, 74657) | 40 frames, exact PTS | Saved with a 64 ms earlier warning |
| Unknown clock | Unproved native padding and alignment | No copy attempted | Refused before Start |

| Run | ID | Report SHA-256 | Result |
| --- | --- | --- | --- |
| Source holdouts | `449ea838-7423-4733-802a-baf779211e4e` | `f5f4b2fdece597e57cb5f7eb33ac87388dd762e370737ee97d2c6bada844d470` | Two exact observations and one refusal |
| Independent staged comparison | `5a829a0a-cdcb-4fb0-b365-805e38faf5fa` | `927768c64c4c82c8415ba28cfbfcb8fcc0d36485bd32156de95c07614ce9561f` | 16 children closed, both shapes compare, unreconstructed clock refused |
| Prospective policy | `fe7617d6-0113-4ab2-9e04-874c3946f56c` | `cd677c697242e54d5067ea98d1ba1badd1528acf1c5d3bd4fd6dfd5c9d47eb64` | Two publications, 25 children closed, independent saved evidence audit |
| Initial default policy | `282940fb-78b1-40cf-aeff-24b053c7420c` | `ef72505470cb69fa9a95bfd39c2465328c8c6508725334f015b8d17a5f25a764` | Two publications and full media custody, independently audited |
| Final default policy | `66eaf0ec-2264-4710-aec6-3fedbe12cc7d` | `f4f08645feea3e6b94ece7c617daf79bf9b0204502d85363cb48cf50cb1bd822` | Two publications with full native edit, track and movie controls, 25 children closed and lease released |
| Default TS seek regression | `6c9e7281-15e1-4f94-940c-1f39e58338a2` | `b680cc4aead44592c0060872cba9c42996e60196d79fc010d7922a410129f0b8` | Exact first presented frame and PTS at six fixed targets, 19 children closed |
| Default standalone MP3 regression | `5742de00-afbd-43bb-a25a-bf804de36136` | `4b6ae67dc15985f15dca21b64294b5feefbc2c6145d1efb41cdfbd8fb1ea81b` | Exact copies, refusals, protected collision and cancellation, 35 children closed |

The final default run accepted one batch Start and completed two jobs. It
refused an unapproved shift, the unknown source and fabricated or stale
choices without creating a copy child. The saved MP4 hashes were
`067ef0cd3cabdb7e33dc825107106896ba05ae06bf8e325d5480caf0e8da4027`
and `2cd42cb49a4eaaa91fb1dd6f681a907ff77c8956e107501b522e5ae14c3cca0f`.
All input files kept their owned-copy identities and full hashes.

The first service attempt `4051d21f-add3-4758-80f0-7f21e49a6e65`
retained both verified temporary copies after the shared disposition
guard refused the MP4 singleton audio flag. The next prospective
attempt `8f09f5c6-6a7d-462d-b1ee-eed9c7739495` published both files,
then failed the harness comparison against the pre-copy fixture inode.
The first default attempt `c3ca4011-b821-4e49-8a74-e1ac11fd444c`
retained both stages after the verifier required a streaming capture
field on bounded text. Each failed receipt remains in its original state.

The final Windows source run `q2k-regular-aac-windows-close` passed all
339 controlled checks with exit 0 and exact source/test hashes. The
receipt SHA-256 is
`f588a6a9ebb7c3ca3d4a5757743ef3a49563504c2a5afee40de2d69d8fb76180`.

The mixed-platform source run `q2k-regular-aac-final` recorded 322
passes and eight Windows-host failures. Two exercised the Linux-only
packager entry point and hit its host check. Six exercised the known
Linux fixture paths that also failed on the parent. The physical source
closure and unchanged 97 historical pins passed the focused static
checks. This is Windows inspection of the Linux packaging plan.

The exact regular Windows policy is
`full-remux-windows-9.1-v3:2026-11-22:aac-clock`. It keeps the
existing TS and standalone MP3 rows. The current Linux source
closure includes both shared verifier modules. Native Linux execution,
other MKV audio layouts, explicit omit and re-encode alternatives,
and the 3-second fixed plus 6-second/GB Remux targets still need their
own qualification. Continue Q2f with two exact AAC layouts and keep
the remaining Q, R and S gates visible.
