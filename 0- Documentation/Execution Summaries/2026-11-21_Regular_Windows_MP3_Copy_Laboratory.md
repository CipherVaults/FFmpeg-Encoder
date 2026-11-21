# Windows MP3-to-MP4 exact copy laboratory

## What this proves

The rebuilt Windows 9.1 pair `faea502a4addd1dde4b74f1a63ae454d3615c7c04fac7d9b20b85a77c74b5590` copied three untagged MPEG-1 Layer III fixtures into MP4. The same inspection routines ran against fresh owned outputs with the actual paired media tools. Neither service nor IPC was used.

| Shape | Compressed frames | Decoded sample frames | Verified result |
| --- | ---: | ---: | --- |
| 48 kHz stereo CBR | 40 | 46,080 | Exact ordered MP3 frames, sample clocks and signed 32-bit PCM |
| 44.1 kHz mono VBR | 40 | 46,080 | Exact ordered MP3 frames, sample clocks and signed 32-bit PCM |
| 32 kHz stereo VBR | 40 | 46,080 | Exact ordered MP3 frames, sample clocks and signed 32-bit PCM |

The independent readback checked each owned source and native MP4 media extent, all 240 source and output packet records, exact rational PTS/DTS and duration, all six PCM files and the 30 mutated observations. A truncated source and a WAV named as MP3 were refused by the complete raw frame observer. The collision closed with Windows code `4294967279` for `AVERROR(EEXIST)` and an existing-output diagnostic. The protected output’s SHA-256 was unchanged. Pre-cancellation started no child.

## Evidence boundaries

The completed report `e2573f11-075d-4356-b914-315f8d1d8407` has SHA-256 `18ca21ec94d52947b60b0aa037c2c1ab6abb0ae43d933baaae8470d2b7734440`. It records 19 attempted invocations, 18 closed media children, maximum one active child, no product Starts and no remaining lease or child. All 115 producer identities matched at readback. The separate `q-win-mp3-proof-harness` receipt passed 58 controls.

The earlier report `ea173c6c-8419-41ac-9df8-f3f91593f418` has SHA-256 `d34e3cd5a74abc5efe047286bee56b97a012d3abaad39b90c011a677d4cc4f81`. It remains failed. Its harness treated the Windows unsigned collision code as unexpected. All six children closed with no active lease. The corrected run required both the known collision result and the unchanged output digest.

## Continue the product route

Use the normal Remux workspace and protected output lifecycle to admit an explicitly bounded audio-only MP3 source. Verify the complete source frames, native MP4 audio representation, exact sample timing, complete decoded audio, provenance and current identities before publication. Keep the Apple-player compatibility warning visible. A copy uses the original MP3 codec. AAC conversion remains separate. The lab covers three finite generated shapes, and supplies no Windows product, broader MP3, Apple playback or Linux acceptance.
