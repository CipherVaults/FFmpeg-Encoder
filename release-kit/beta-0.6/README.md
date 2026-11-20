# FFmpeg Encoder 0.6 Beta release kit

Build and test scripts for the public `v0.6.0-beta.1` prerelease. They change no
application behaviour; they produce and check the bundled engine and the two
Windows downloads. Everything runs inside a disposable **Windows Sandbox** with
networking disabled; the host only stages verified inputs and reads results.

## `ffmpeg-build/` — FFmpeg 9.1 engine

- `build.sh` builds, without patches: zlib 1.4, x264 0.164.3108 (8/10-bit),
  x265 4.1 (8-bit with linked 10-bit), SVT-AV1 2.3.0, dav1d 1.5.1, NVIDIA codec
  headers 13.0.19.0 and FFmpeg 9.1 (`--enable-gpl --enable-version3`, static,
  network protocols disabled) with llvm-mingw 20261104 (UCRT). It first verifies
  the FFmpeg release signature offline (key `FCF986EA15E6E293A5644F10B4322F04D67658D8`).
- `guest.template.ps1` is the sandbox entry: it checks the size and SHA-256 of all
  19 inputs and of the two scripts, unpacks the tools, runs `build.sh`, then
  `qualify.ps1` (version, GPLv3 licence, encoder/decoder registration, NVENC
  option names, no network protocols, system-only imports, and x264/x265/SVT-AV1
  at 8 and 10 bit with profile, colour, frame-count, full-decode and AAC-packet checks).
- `launch.ps1 -Run <name>` snapshots the scripts into a new run folder, pins
  their hashes and starts the sandbox; `monitor.ps1` waits for it to finish.

## `packaging/` — portable ZIP and Setup

- `intake-pkg.ps1` downloads Electron 44.2.0, 7-Zip 26.06 (extra), the signed MSYS2
  NSIS 3.13 package and the 53 locked npm packages, each checked against its
  published SHA-256 or lockfile SHA-512.
- `guest-pkg.ps1` (sandbox) re-checks them, verifies the NSIS package signature
  against the MSYS2 keyring, lays out `node_modules` from the lockfile, runs the
  unit tests and the stock `scripts/build-portable.cjs`, compiles Setup with
  `installer.cjs`, checks the Gauge icon in both (`pe-icon.cjs`), then in the
  fresh sandbox profile: extracts the ZIP and compares every byte with staging,
  runs the packaged-app CPU smoke (`smoke.cjs`: offline launch, bundled-engine
  only, two H.264 encodes, decode readback, no-overwrite, close and reopen with
  remembered settings), installs Setup silently (`verify-installer.cjs`),
  compares the installed payload, smokes the installed app, and uninstalls,
  checking that a simulated existing 0.6 copy and the portable profile stay untouched.
- `launch-pkg.ps1` / `pkg.template.wsb` start that sandbox run.

`installer.cjs`, `verify-installer.cjs`, `smoke.cjs` and `pe-icon.cjs` are adapted
from the reviewed 0.7 Alpha packaging rehearsal kit. Not covered: GPU encoding on
real hardware, real folder dialogs, SmartScreen and code signing.
