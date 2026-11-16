# Execution summary: AV1-preserving Linux runtime activation

## 1. Task and result

E1 of the Linux 0.7 execution plan: preserve all three CPU codecs while making
corrected FFmpeg available to the actual workbench through an explicit option.
**The separate build and real-service proof passed. Native acceptance is blocked
before a window opens, so E1 is not closed and the default has not changed.**

## 2. Context and boundary

The earlier 9.0.2 calibration build lacks SVT-AV1 and software AV1 decoding. It
cannot replace the working 7.1.5 baseline without losing a supported codec.
Both existing pairs and pins remain intact. This rebuild has a new pair identity;
none of the older trim/remux qualification transfers automatically.

## 3. Implementation

The existing main accepts exactly `--blue-runtime=9.0.2-av1`, lazily loads the new
composition and gives it separate application state and a visible runtime title.
Without that flag it uses the unchanged baseline. There is no renderer/IPC path
selection, hot switch, loader override or automatic fallback. Existing UI,
service, CPU defaults, output publication and process ownership are reused.

The new runner reuses ordinary CPU argv/options/terminal-progress guards and the
30-minute encode ceiling. It verifies exact tool and codec-library bytes before
and after each settled operation, preserving both process and integrity errors.
Remux, changed encodes, GPU and HDR remain unqualified in this explicit mode.
This is not a trim/resize implementation or a new product duration commitment.

## 4. Build and provenance

Official FFmpeg 9.0.2 source and its verified signature are the same as the
[earlier candidate](RUNTIME_CANDIDATE_CHECKPOINT.md). A new source/build directory
preserves that build. Existing verified x264/x265/numa development files were
copied; four additional official Debian packages were hash-checked and extracted
with `dpkg-deb -x`, not installed. No package scripts, system updates or root
configuration changes occurred.

| Debian package | SHA256 |
|---|---|
| libsvtav1enc-dev 2.3.0+dfsg-1 | `13a94fcea44146a19e7f579b72346cb01afc149cdbd94113b70318f34eb61c6f` |
| libsvtav1enc2 2.3.0+dfsg-1 | `cdaf961c3cc4fe78a19ff18c17d83d813f78a378fdcc4c86ccbb9b54e84ae599` |
| libdav1d-dev 1.5.1-1 | `c5d3cdd44e9ad4680d24c404f7b686759d29e9030d4f5d0deabb8792ec30a8ed` |
| libdav1d7 1.5.1-1 | `8c64de4465a8ae1ca23e1dada1dfc73d7b431540fd5ae18f21430928576d5b05` |

Source: [Debian SVT packages](https://packages.debian.org/trixie/libsvtav1enc-dev)
and [dav1d packages](https://packages.debian.org/trixie/libdav1d-dev).
The extracted libraries exactly match the installed optimized copies. Standard
SONAME resolution points to their pinned canonical paths. No RPATH/RUNPATH or
LD_LIBRARY_PATH is added. FFmpeg/x264/x265/numa are static; SVT, dav1d and ordinary
system C/C++ libraries are dynamic. This does not pin the entire operating system.

## 5. Commands

With workspace-only PKG_CONFIG_LIBDIR/SYSROOT_DIR pointing at the new codec root:

```text
./configure --prefix=<new-workspace>/install --disable-doc --disable-debug
  --disable-autodetect --disable-network --disable-x86asm --disable-shared
  --enable-static --disable-ffplay --enable-gpl --enable-libx264 --enable-libx265
  --enable-libsvtav1 --enable-libdav1d --pkg-config-flags=--static
make -j4 ffmpeg ffprobe
node --test linux-blue/runtime-av1.test.cjs linux-blue/workbench-service.test.cjs \
  linux-blue/runtime.test.cjs linux-blue/runtime-candidate.test.cjs
node linux-blue/workbench-execution-smoke.cjs --blue-runtime=9.0.2-av1
```

For a provisioned local build, the actual application command is the installed
Electron executable followed by `linux-blue/workbench-main.cjs` and the explicit
flag. To roll back, close it normally and launch without the flag. Baseline state
is separate; no settings migration or runtime-file overwrite is involved.

## 6. Verification

31 focused tests passed, zero failed/skipped. Fresh canonical H.264, H.265 and
AV1 capability tests passed at both 8 and 10 bits, including full software decode.
Real shared-service proof `workbench-execution-EPmZEX`: 81 children spawned and
81 closed, maximum one, zero live. All three ordinary 12-frame synthetic encodes
published, fully decoded, matched copied PCM packet hashes and left source bytes
unchanged. Cancellation at encode-child creation then retry, changed source,
pre-encode collision, publication-time competitor, missing source after encode,
and unqualified changed-operation refusal passed. This is not an active-frame
cancellation proof or broad media-quality certification.

## 7. Failure and interruption record

A cloud connection interruption happened after the service proof. Recovery used
the same workspace; its source, build and receipt were verified intact. One
in-flight final test session became unavailable; it was rerun to a new receipt.
Native launch then failed twice with Electron `socket() failed: Operation not
permitted`, exit 133, before a window existed. The second used the supported
execution escalation, with the app sandbox still enabled. No sandbox disabling,
security-setting changes or alternate bypass was attempted. Both logs remain.
Compiler warnings also remain; no full FFmpeg test suite was run.

## 8. Independent review

Review identified and corrected misleading candidate remux refusal text,
premature success logging before diagnostic closure, and size validation before
reading pinned artifacts. Final review checks code, exact pins and receipts;
native acceptance is a separate blocked gate, not inferred from Node tests.

## 9. Git and recovery

Source/pins/tests and this summary are the eligible checkpoint. No executables,
packages, media, raw diagnostics, private Planning or denied shared corrections
are included. A fresh clone still needs the separately provisioned exact runtime
and host dependencies; hashes identify this build, not a reproducible-build
promise. Existing remote shared-source parity gaps remain unresolved. Local
Gauge/UI changes and older local milestones are not implicitly synchronized.

## 10. Deployment and licensing limits

These workspace executables are writable by the development account. Before/after
hashing is not atomic executable-FD launch or a production immutable trust boundary.
The GPL-2.0-or-later build is for local use; SVT/dav1d notices and patent-license
text are retained with extracted packages. No binary redistribution occurs.
Packaging, corresponding source, notices and deployment review remain open.

## 11. Current state

`runtime-av1-pins.json` records the exact executable and codec-library identities.
The default still uses 7.1.5, the earlier two-codec 9.0.2 remains calibration-only,
and this AV1-capable build is explicitly selectable but not natively accepted.
No Windows/NVIDIA/AMD/Intel or full 0.7 completion is claimed.

## 12. Next step

Resolve the supported native-launch environment limitation without weakening
security; verify the original workbench startup/shutdown and ordinary route.
Then qualify actual trim/resize on this pair using genuine evidence and the
roadmap's broader source/resource requirements, not inherited fixture authority.

## 13. Recovery and remote-dependency verification

Recovery verified clean local checkpoint `13b2efb48b1bc1d8d7e3e9d505428262d646dbf3`
and remote plan checkpoint `fbfce2dc33d26f0b677f98a983a3c0586834abf9`.
The proposed runtime checkpoint contains nine exact local files: this report,
the AV1 pins, runner, tests and service composition, runtime-choice module,
and the existing workbench main, service and execution smoke updates. The
main's Gauge window-icon asset already exists remotely; this does not synchronize
the local header/UI changes. Earlier denied source and `CURRENT_STATE.md` are
excluded, not rewritten or moved to bypass their publication restriction.

A separate temporary verification snapshot used the proposed runtime source
with GitHub's exact shared dependencies. All 79 transitively loaded shared
service files matched the remote tree blobs. The focused suite passed 31/31,
and real service receipt `workbench-execution-VNHNW1` passed all three ordinary
CPU codecs, software decode, copied-audio hashes, source protection and lifecycle
refusals, with 81 children spawned/closed, maximum one and zero remaining.
Cancellation is still at child creation, not active-frame proof. This is a
dependency-combination check, not a full fresh clone, native or package acceptance.

The parity audit found ten differing shared source files, including earlier
HDR/vendor and service changes in addition to the three known remux/runtime
files. None is published by this checkpoint. No claim of complete backup or
general remux/trim availability follows from the ordinary service pass.
