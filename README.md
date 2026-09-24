# FFmpeg Encoder Desktop App

A local Windows desktop encoder for large gameplay/OBS archives, with directly editable H.264, H.265 and AV1 controls for CPU and supported NVIDIA hardware.

The fresh **0.6.0 portable runtime is verified**; final independent M acceptance is being reconciled in the [acceptance report](0-%20Documentation/Execution%20Summaries/2026-09-24_Portable_0.6_Acceptance.md). The accepted 0.5 tag and ZIP remain unchanged. This is an unsigned local package; independent clean-machine compatibility and public distribution are separate work.

## Run the portable application

Extract every file from the ZIP into a new writable folder, then open **FFmpeg Encoder.exe**. Keep the executable and resources together. Electron, FFmpeg and ffprobe are included; no separate Node.js or FFmpeg installation is required. NVIDIA profiles need compatible hardware and its installed driver. The application tests available encoders and bit depths on startup without silently substituting another encoder.

1. Choose input and output folders. They may be the same folder on verified local fixed NTFS storage. Valid locations and per-profile settings are remembered locally.
2. Select codec/backend, preset and CRF/CQ. These controls remain visible and editable. **Tested Default** restores the current profile's ordinary values.
3. Prepare the batch. Inspection determines duration, video/color compatibility and stream preservation. Unchanged eligible files reuse validated evidence across batches and restarts; new/changed or invalidated files need fresh inspection.
4. Review compact rows, filters, selection and per-file details. Existing destinations are skipped; select one input when two stems would share a destination. Filtering does not authorize or change selection.
5. Start encoding. Cancel stops the active operation and queued work; another batch is available after process exit and cleanup finish.

The app scans supported top-level MP4, MKV, MOV, AVI and WebM files. Supported SDR video is re-encoded while supported audio, subtitles, attachments, chapters and metadata are preserved. Additional non-primary video is intentionally omitted. Unsupported preservation cases, detected HDR and ambiguous color evidence receive explicit reasons. Ten-bit video alone is not HDR; bounded inspection cannot certify untagged or unsampled content.

Outputs use encoder-based names such as `clip_H265-CPU.mkv`. Existing files are never replaced or automatically numbered. Use another output folder to retain several quality variants with the same encoder suffix. Closing during work offers **Keep application open** or **Cancel encoding and exit**; encoding does not continue after exit.

## Generated outputs and transparent settings

Generated outputs remain excluded by default, including after restart. **Re-encode this output** deliberately admits only chosen unchanged generated files for the current preparation. Another lossy generation can reduce quality. **Treat as original** instead corrects ambiguous legacy filename classification; it does not relabel confidently recognized outputs. Previous settings are shown only when supported by available provenance, otherwise reported as unknown.

Hover or keyboard-focus help for canonical encoder option details. Expand a prepared file's details to inspect the actual main-owned FFmpeg argument array. Before launch, only its protected temporary output path is a clearly labelled placeholder; this is not a separately reconstructed shell command.

**Archive Quality — Ada/Blackwell NVENC** is a separate, capability-gated HEVC helper: P7, UHQ, full-resolution multipass, VBR-CQ29, four B frames and B-reference mode each. Applying it visibly populates editable controls and exposes the additional options. **Use standard options** removes the compound recipe. Existing saved manual values, including CQ32, are not silently changed; apply the helper to adopt its new starting point.

CQ29 follows the [field decision](0-%20Documentation/17_Archive_Quality_Field_Decision.md), which supersedes only the preferred CQ in the [historical CQ32 decision](0-%20Documentation/15_Archive_Quality_Decision.md). Tested texture scenes improve, but sizes and quality vary; no universal 30–40% size, x265 equivalence or locally verified Ada quality/speed is promised. Equal CRF/CQ numbers or preset names across encoders do not imply equivalent quality.

## Local state and compatibility

Application/session state and terminal batch logs stay in the adjacent **data** folder. **Clear cache** and **Forget preferences** are independent and preserve media/provenance. Missing locations or unavailable hardware fail gracefully. Keep the drive connected until work and cleanup finish.

MP4 track creation timestamps are preserved as exact `SOURCE_CREATION_TIME` values on the corresponding Matroska tracks, with a notice in file details. Conflicts and other preservation failures remain errors. Source-identity refusals identify changed fields and retain comparison details in local logs. Matching sparse samples cannot establish unchanged full content, so even a filesystem metadata-only change can require fresh preparation.

For rollback, use a separate extraction/state folder. The older 0.5 app cannot recognize 0.6 provenance and must not process mixed original/generated collections. The original source, backup, baseline and accepted 0.5 artifact remain recoverable.

## Development and verification

Pinned environment: Node 24, Electron 44.2.0, FFmpeg/ffprobe 9.0.1, Playwright 1.63.0 and Electron Packager 20.3.0. Install local dependencies with `npm ci`. On a fresh checkout, `scripts/provision-ffmpeg.ps1` verifies/stages the manifest-pinned runtime; `-Activate` activates it locally. Provisioning requires PowerShell 7 and an existing 7-Zip installation; nothing is installed globally.

| Command | Purpose |
|---|---|
| `npm start` | Run the development app |
| `npm test` | Direct contract/regression checks |
| `npm run test:product` | Real application profile/settings/preservation checks |
| `npm run test:lifecycle`, `test:protocol`, `test:layout` | Focused native lifecycle, security and layout checks |
| `node scripts/amended-workflow-smoke.cjs` | Intentional generations, provenance and argv checks |
| `node scripts/archive-quality-endpoint-smoke.cjs` | Real rich 8/10-bit Archive endpoint |
| `node scripts/field-qa-smoke.cjs "<phone-fixture-report.json>"` | Owned Samsung fixtures and source-identity diagnostics |
| `npm run make:portable` | Build and verify a fresh ZIP under out/portable-* |
| `npm run test:portable -- "<build-report.json>"` | Extract and exercise that exact artifact |

The field harness requires an existing completed two-phone fixture report, such as artifacts/phone-metadata-field-1790143524642-5847db51/report.json; it copies owned excerpts, not personal originals. Native tests run serially per data location. Current evidence includes 281 direct checks, affected native endpoints and 20 actual packaged cases across four process sessions. Build/source/resource hashes tie the runtime report to the artifact. The portable harness uses restricted PATH and verifies process/session network denial through an unavailable proxy/resolver; this does not claim physical disconnection, general Node socket isolation or clean-machine acceptance. Reuse relevant completed evidence rather than repeating expensive personal-media campaigns.

Main owns paths, plans, queue, processes and protected publication. The isolated renderer calls a narrow validated preload API; it cannot submit arbitrary argv, execute processes or access the filesystem directly. Source responsibilities remain separated across main.js, preload.js, src/ and ui/.

## Built With Codex

Ahmed originally built this project with ChatGPT by transferring code into Visual Studio Code. The September 2026 re-entry was human-directed AI collaboration: Ahmed defined product requirements and approval boundaries; ChatGPT's Mother/Development Thread supplied context and strategic review; Codex implemented, debugged, tested and documented the approved local work. Historical source and documentation remain preserved.

Versions 0.1–0.4 record the historical sequence. The old npm 1.0.0 value was scaffold metadata. The unchanged-source baseline is tagged baseline-2026-09-06; local-v0.5.0 preserves the accepted re-entry milestone. A future 1.0.0 or public release requires separate acceptance.

## Documentation and licenses

- [Current State](0-%20Documentation/01_Current_State.md), [Roadmap](0-%20Documentation/02_Roadmap.md), [0.6 Goal](0-%20Documentation/11_Approved_0.6_Goal.md) and [plan](0-%20Documentation/12_Approved_0.6_Plan.md).
- [Architecture](0-%20Documentation/00_Project_Architecture.md), [Technical Reference](0-%20Documentation/03_Technical_Reference.md), [Security and Testing](0-%20Documentation/04_Security_and_Testing.md) and [short project guide](0-%20Documentation/05_How_This_Project_Works.md).
- [Execution Index](0-%20Documentation/07_Execution_Index.md), [Session Summary](0-%20Documentation/06_SESSION_SUMMARY.md) and [PBS provenance](0-%20Documentation/08_PBS_Context_and_Migration.md).

The manifest declares ISC; bundled components have their own licenses. Electron/Chromium notices, FFmpeg notices and resources/binary-manifest.json accompany the package. The full static FFmpeg build is identified as GPL-3.0-or-later. Notices/provenance are not a complete corresponding-source distribution or written source offer. GitHub upload, distribution licensing review, signing and public release remain separate approval boundaries.
