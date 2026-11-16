# Execution Summary: 2026-11-16 — Separate corrected Linux runtime

## 1. Task Overview

Qualify an explicitly separate corrected Linux runtime, preserving the system
7.1.5 baseline and strict timing proof. **Candidate calibration passed; the app
has not switched runtime and changed encodes remain disabled.**

## 2. Context Used

The first trim experiment (`9521ccc`) safely failed because decoded output frame
durations were absent. Exact n7.1.5 source unconditionally clears duration in
setpts. Upstream fixed this in [8e0de5d811](https://ffmpeg.org/pipermail/ffmpeg-cvslog/2025-August/149733.html).
Direct tag inspection found the fix in n8.1, not n8.0–n8.0.3. The selected
[official 9.0.2 release](https://ffmpeg.org/download.html) also contains it.
The fix preserves existing duration metadata, not an inferred 1/30 duration.

## 3. Work Performed

Built official FFmpeg 9.0.2 source in a separate workspace directory with local
GCC14, static FFmpeg/x264/x265/numa libraries and ordinary system C/C++ libraries.
Network features and external auto-detection are disabled. No package install,
sudo, global credential/configuration change or system-tool replacement occurred.

Verified the source tarball's detached PGP signature against FFmpeg's published
fingerprint `FCF986EA15E6E293A5644F10B4322F04D67658D8`. Its SHA256 is
`8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`.
Official Debian development packages were extracted only, with SHA256 matched
to their official download pages:

- x264 0.164.3108+git31e19f9-2+b1: `120094146e402348d7ee305d0977183f1514441aca128863b6ad2599d92a2f3c`
- x265 4.1-2: `174c683f254b7ab7ab1255aa4ee883945b6a80c04ba17ff4e9c906ad6ced5d0f`
- numa 2.0.19-1: `7fea9248b09311b008dc6707c201671e7b14ce5f9278dda4694e726990897436`

Added an explicitly invoked developer candidate adapter with fixed paths, exact
build pins, positive child budgets, cancellation and before/after byte checks.
Reused the same calibration and unchanged production builder/collector/validator.

## 4. Commands / Tools Used

Configure flags, after setting workspace-only pkg-config paths for extracted libs:

```text
--disable-doc --disable-debug --disable-autodetect --disable-network
--disable-x86asm --disable-shared --enable-static --disable-ffplay
--enable-gpl --enable-libx264 --enable-libx265 --pkg-config-flags=--static
```

`make -j4 ffmpeg ffprobe`, `node --test linux-blue/runtime-candidate.test.cjs`,
`node linux-blue/workbench-flac-candidate.cjs`, syntax/diff checks and exact
baseline/candidate byte verification. No media job ran on the original PC.

## 5. Verification / Testing

**Five selected candidate-runner tests passed; combined baseline/candidate regression was 13 passed, zero failed/skipped.** They cover exact executable
selection, before/after verification, invalid budgets/options, streaming callbacks,
pre-aborted cancellation, no fallback and retaining both child and post-check
failures. Independent review's signal/dual-error findings were corrected before
calibration.

**Three strict calibration cases passed: 34/34 children closed, maximum one,
zero live.** Source: one generated four-second 720p30 SDR H264 High QuickTime file,
PCM16 stereo48k. Output: HEVC CPU slow CRF25 and FLAC at original geometry.

- 0–0.5 seconds: 15 video frames, 24,000 exact selected samples/channel.
- 1.013–3.087 seconds: 62 video frames, 99,552 exact selected samples/channel.
- Held-out 2 seconds to end: 60 video frames, 96,000 exact selected samples/channel.

Each case used complete source checks, encoder-input telemetry, decoded
endpoint/interior timing, exact selected PCM SHA256/byte/sample identity and a
full output decode. Source hashes/identity remained unchanged. The mathematical
bounds were frozen before the first candidate encode, not fitted to outcomes;
the held-out case did not change them. Existing validators reported no errors
or warnings. All outputs remain unpublished stages.

## 6. Problems Encountered

The initial source-extraction guard refused the legitimate root directory entry;
inspection confirmed it was a directory, not an unsafe path or link. The corrected
check still restricts all members to the signed source root and regular files or
directories. First configure failed because x265's static link needed numa;
retrieved and hash-checked its official development package. Both attempts remain
recorded. Compiler warnings were present; this is not a warning-free build or a
full FFmpeg test-suite/security qualification. PGP public verification succeeded;
no private signing key or trust elevation was used.

## 7. Documentation Impact

This result supersedes only the candidate investigation blocker. It does not
change the app's supported routes, runtime pins, UI or hardware qualification.

## 8. Git / Version Control Impact

Only independently authored candidate harness, pins, tests and this record are
included. Source packages, compiled binaries, raw receipts and generated media
remain outside Git. Existing denied/shared-source material is not transferred.
The GPL-2.0-or-later build is for local qualification; no binary redistribution
occurs. Packaging and corresponding-source compliance remain separate.

A local commit is not off-machine backup. A fresh clone cannot run this candidate
without the separately built exact artifacts and its imported shared modules;
pins bind this build, not a promised reproducible binary on another machine.

## 9. Decisions Made During Execution

Use a separate official 9.0.2 build rather than weaken missing-duration checks.
Preserve the original system 7.1.5 pair. Candidate executables are workspace-owned,
not immutable system tools: before/after hashes do not eliminate path-launch
races or establish a production runtime trust boundary. No app imports the adapter.

## 10. Items That Need Human / Coordinator Review

Application integration still requires deliberate runtime deployment/trust design,
capability regression, source-dependency parity, narrow admission, runtime/storage
ownership, cancellation, refusal and native-workbench evidence. Three short
calibration cases do not authorize every source size/rate/duration or the full
existing Windows family. No GPU, Windows, long-duration, resize or HDR claim.

## 11. Current Result

Corrected-runtime pre-activation calibration passed. Exact binary identities are
in `runtime-candidate-pins.json`; private build receipt and calibration
`flac-candidate-QY90Bo` retain the full evidence. Baseline pins still verify.

## 12. Recommended Next Step

Wire the already-selected Gauge assets while keeping this candidate separate.
Then qualify the smallest explicit workbench trim route with the real service
lifecycle and appropriate deployment boundary; do not activate from this report.
