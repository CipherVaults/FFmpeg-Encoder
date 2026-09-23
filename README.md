> Current field-QA development adds explicit preservation of MP4 track timestamps as SOURCE_CREATION_TIME in Matroska, with a notice in file details. Source-change failures identify the differing filesystem/content identity fields; conservative refusal remains when unchanged content cannot be established. Archive CQ32 is under renewed field evaluation; no new preferred CQ or final0.6release is accepted yet.

# FFmpeg Encoder Desktop App

## Current0.6 development workflow

The development app adds fast inspection reuse, same-folder output on verified local fixed NTFS, remembered folders/settings, compact filtered preview, and deliberate generated-output re-encoding. Generated files remain excluded until explicitly authorized for the current prepared batch. Treat as original is reserved for ambiguous legacy cases.

Expert controls stay visible. Hover/focus help and expandable per-file details show canonical settings and the actual prepared FFmpeg argument array. Tested Default remains separate from **Archive Quality — Ada/Blackwell NVENC**, an editable HEVC P7/UHQ/fullres/CQ32 recipe selected from bounded Blackwell measurements. Size and quality vary by scene; Ada quality/speed has not been locally verified. See the [recipe decision](0-%20Documentation/15_Archive_Quality_Decision.md).

These source changes do not replace the accepted0.5 ZIP. Final0.6 portable acceptance is still pending. The portable instructions below describe the accepted0.5 package.


A local Windows desktop batch encoder with H.264, H.265 and AV1 profiles for CPU and supported NVIDIA hardware.

**0.5.0 is verified as a local Windows x64 portable milestone.** It is an unsigned local package. Independent clean-machine compatibility and public distribution have not been accepted. See the [acceptance report](0-%20Documentation/Execution%20Summaries/2026-09-08_Portable_Acceptance.md) for the exact artifact, checks and limits.

## Run the portable application

Extract every file from the ZIP into a new writable folder, then open **FFmpeg Encoder.exe**. Keep the extracted executable and resources together. The package includes Electron, FFmpeg and ffprobe; no separate Node.js or FFmpeg installation is required. Compatible hardware and its installed driver are required for NVIDIA profiles. Available encoders and bit depths are checked on startup.

1. Choose separate input and output folders.
2. Select a profile and quality/preset settings, then review the batch.
3. Resolve any duplicate output names by selecting one input. Existing destinations are skipped.
4. Start encoding and review per-file results. Cancel stops active work and the remaining queue; a new batch is available after cleanup finishes.

The app scans supported top-level MP4, MKV, MOV, AVI and WebM files. Supported SDR video is re-encoded while supported audio, subtitles, attachments, chapters and metadata are preserved. Additional non-primary video is intentionally omitted. Unsupported preservation cases, detected HDR and ambiguous color evidence receive explicit reasons. Ten-bit video alone is not HDR. Bounded metadata/frame inspection cannot certify untagged or unsampled content.

Output names identify the encoder, such as clip_H265-CPU.mkv. Choose another output folder for a different quality variant; existing files are never replaced or automatically numbered. Equal quality numbers across encoders do not mean equal visual quality.

Application/session data and batch logs stay in the adjacent **data** folder. Closing during work offers **Keep application open** or **Cancel encoding and exit**. Encoding does not continue after exit. Keep the drive connected until work and cleanup finish.

## Development and verification

The active 0.6 development branch has accepted J inspection reuse and K same-folder output safety. Unchanged completed files on verified local fixed NTFS storage can reuse metadata/frame evidence across restarts; unsupported storage remains usable with fresh inspection. Expert controls remain visible while inspection runs. Same-folder output requires verified local fixed NTFS, uses validated markers and atomic no-overwrite publication, and excludes generated/possible prior outputs. Explicit Treat as original is available only for ambiguous unmarked files. Uncertain incomplete temporary files are retained with a notice. The0.6 changes do not replace the accepted0.5 ZIP; amended L is accepted and M portable verification remains pending. See the [0.6 plan](0-%20Documentation/12_Approved_0.6_Plan.md) and [J evidence](0-%20Documentation/Execution%20Summaries/2026-09-09_Inspection_Reuse.md) for current acceptance status.

The verified development environment uses Node 24, Electron 44.2.0, FFmpeg/ffprobe 9.0.1, Playwright 1.63.0 and direct Electron Packager 20.3.0. Install pinned development dependencies with npm ci. On a fresh checkout, use scripts/provision-ffmpeg.ps1 to verify/stage the manifest-pinned media runtime, then its -Activate switch to activate it locally. That script requires PowerShell 7 and an existing 7-Zip installation; nothing is installed globally.

| Command | Purpose |
|---|---|
| npm start | Run the development app |
| npm test | Run contract and regression checks |
| npm run test:product | Real application settings/profile/preservation acceptance |
| npm run test:lifecycle / test:protocol / test:layout | Focused native lifecycle, security and layout evidence |
| npm run make:portable | Build and verify a fresh local ZIP under out/portable-* |
| npm run test:portable -- "<build-report.json>" | Extract and exercise that exact portable artifact |

Native application tests should run serially because the app enforces a single instance per data location. The portable harness controls generated media, uses a restricted PATH and verifies network transport denial through an unreachable proxy. Its same-machine checks do not substitute for clean-machine testing. Build reports preserve file hashes; a successful build alone is not application acceptance.

Source responsibilities are separated into main.js, preload.js, services under src/, and HTML/CSS/renderer code under ui/. The sandboxed renderer uses a narrow validated API; main owns plans, paths, queue, processes and protected output publication.

## Built With Codex

Ahmed originally built this project with ChatGPT by transferring code into Visual Studio Code. The September 2026 re-entry was human-directed AI collaboration: Ahmed defined the product, documentation method, approval boundaries and amended execution plan; ChatGPT's Mother/Development Thread supplied context and reviewed direction; Codex implemented, debugged, tested and documented the approved local work. Historical source and documentation remain preserved.

Versions 0.1–0.4 describe the historical development sequence. The old npm 1.0.0 value was scaffold metadata. The re-entry reaches local 0.5.0; a later accepted standalone release may become 1.0.0. The unchanged-source baseline is tagged baseline-2026-09-06, and the local completion checkpoint is tagged local-v0.5.0.

## Documentation and licenses

- [Current State](0-%20Documentation/01_Current_State.md), [Roadmap](0-%20Documentation/02_Roadmap.md) and [approved plan](0-%20Documentation/09_Approved_Execution_Plan.md).
- [Architecture](0-%20Documentation/00_Project_Architecture.md), [Technical Reference](0-%20Documentation/03_Technical_Reference.md), [Security and Testing](0-%20Documentation/04_Security_and_Testing.md) and [beginner guide](0-%20Documentation/05_How_This_Project_Works.md).
- [Execution Index](0-%20Documentation/07_Execution_Index.md), [Session Summary](0-%20Documentation/06_SESSION_SUMMARY.md) and [PBS provenance](0-%20Documentation/08_PBS_Context_and_Migration.md).

The application manifest declares ISC; bundled components have their own licenses. The package includes Electron/Chromium notices, FFmpeg notices and resources/binary-manifest.json. The included FFmpeg full static build is identified as GPL-3.0-or-later. Its notices/provenance are not a complete corresponding-source distribution or written source offer. GitHub upload, external licensing/distribution review, signing and public release remain separate approval boundaries.

Development same-folder evidence and recovery/rollback limits: [K report](0-%20Documentation/Execution%20Summaries/2026-09-10_Same_Folder.md). The portable instructions above describe the preserved0.5 package until M accepts a separate0.6 ZIP.
