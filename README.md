# FFmpeg Encoder Desktop App

A local Windows desktop encoder for large gameplay/OBS archives, with directly editable H.264, H.265 and AV1 controls for CPU and supported NVIDIA hardware.

## Development checkpoint: 0.7.0-alpha.1 (unaccepted)

Development is currently finishing milestone **O** (diagnostics, source safety, inspection/runtime and known-input remedies) before P–S. Diagnostic corrections have216 focused and110 separate affected passing checks; the known Resolve timed-track remedy remains in progress. The prior finite HDR route is temporarily refused because strict producer-byte qualification detects the changed code. Its original evidence/pins are preserved pending reviewed requalification. Packaging is the final stage. [Current O evidence](0-%20Documentation/Execution%20Summaries/2026-10-23_O_Diagnostics_and_Source_Acceptance.md).

**Settings → Appearance** offers graphite dark and paper-white light themes across the workbench. Theme changes start saving immediately to a separate local preference; encoding settings, prepared jobs and remembered profile recipes stay separate. The original **Folded Frame** icon was created with Codex assistance and includes editable artwork and an ISC license. [Appearance/icon evidence and limits](0-%20Documentation/Execution%20Summaries/2026-10-23_Icon_and_Persistent_Themes.md) distinguishes direct tests, packaging checks and bounded display-host visual/close-restart observations from production and portable acceptance. No new portable build or release is claimed.

The preceding bounded Windows native check covers real folder pickers, CPU Encode and Full Remux, opening published outputs, cancellation, both busy-close choices and restart. Saved folders/CPU controls and History survived restart; temporary generated-source permission did not. Two trimmed AAC encodes saved with disclosed sample-count differences. The minimum-size request produced a 642×480 outer window, so exact 640×480 and full native/portable acceptance remain open. [Native workflow evidence and limits](0-%20Documentation/Execution%20Summaries/2026-10-23_Native_Workflow_Acceptance.md) records that five-job check on its unchanged source/defaults; those workflows were not rerun for the appearance change.

The alpha implements a finite Full Remux subset and previously qualified content-derived CPU HDR preservation within reviewed HEVC Main10 PQ/HLG configurations; current HDR activation is suspended as described above. Eligibility comes from complete input content; every file still needs full integrity checks, exact signal/static metadata and timing validation, source protection and no-overwrite publication. [Current support/status](0-%20Documentation/01_Current_State.md) lists the exact geometry/rate classes and limits. Reviewed generated fitting, first independent default-factory holdouts and nine actual refusal cases passed; this does not qualify arbitrary HDR files or establish display quality.

The preceding icon/theme checkpoint full direct regression reports 1619 passed, 0 failed and 4 unavailable Windows link fixtures; the 235 passing focused checks overlap. Three new artwork symlink/junction fixtures were rejected by this host; separately labelled simulated guards pass. Earlier media campaigns retain their original evidence and were not rerun. Main-private QSV observation/initialization plumbing remains separate from actual vendor hardware qualification; AMF effective-property readback is unavailable under the pinned CLI. Wider media, tone mapping, Dolby, audio/ancillary HDR, broader native UI and portable acceptance remain unfinished. Exact raw local producer seals do not establish fresh-clone or portable byte equivalence. Final candidate review remains; version0.7.0-alpha.1 is unaccepted.

[Current support/status](0-%20Documentation/01_Current_State.md) · [Continuation](0-%20Documentation/10_Continuation_State.md) · [Content-derived HDR evidence](0-%20Documentation/Execution%20Summaries/2026-10-23_CPU_HDR_Content_Eligibility.md) · [Earlier HDR/device evidence](0-%20Documentation/Execution%20Summaries/2026-10-23_0.7_Slice4a_CPU_HDR_and_Observation.md) · [Remux evidence](0-%20Documentation/Execution%20Summaries/2026-10-23_0.7_Slice3_Remux_Preservation.md)

[Current onboarding/authority receipt](0-%20Documentation/Execution%20Summaries/2026-10-23_Thread2_Migration_and_Authority_Reconciliation.md) records the safe continuation and supersession of stale pause wording. Quota renewal adds no scope. The benchmark remains a separate workstream.

The portable workflow below describes **accepted0.6**, not the unfinished alpha. Its behavior, presets and artifacts remain unchanged. Benchmark visual judgment is separately pending and does not authorize development or establish recommended winners.

**0.6.0 is locally accepted** after independent review, with a recoverable local-v0.6.0 checkpoint. The [acceptance report](0-%20Documentation/Execution%20Summaries/2026-09-24_Portable_0.6_Acceptance.md) identifies the exact artifact and evidence limits. The accepted 0.5 tag and ZIP remain unchanged. This is an unsigned local package; independent clean-machine compatibility and public distribution are separate work.

**Phase1 benchmark: Paused — awaiting user visual review.** Calibration assets are preserved; no winners/finalists/held-out acceptance. Start with the **FFmpeg Visual Review** Desktop shortcut. The [pause/resume handoff and v0.7 planning inventory](0-%20Documentation/21_Phase1_Pause_Resume.md) records the live checkpoint, exact evidence/resources, playback limits and next boundary. No production0.7 scope or encoder-default change is approved by that inventory.

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

## Accepted 0.6 development and verification reference

The commands and evidence in this section describe the accepted0.6 checkpoint. They are reference material, not instructions to run them during the earlier completed documentation/readiness stage. The unfinished current checkout instead uses candidate Electron44.7 and isolated FFmpeg/ffprobe9.0.2; see [Technical Reference](0-%20Documentation/03_Technical_Reference.md) and [Continuation](0-%20Documentation/10_Continuation_State.md) for its incomplete qualification.

Accepted0.6 pinned environment: Node 24, Electron 44.2.0, FFmpeg/ffprobe 9.0.1, Playwright 1.63.0 and Electron Packager 20.3.0. Install local dependencies with `npm ci`. On a fresh checkout, `scripts/provision-ffmpeg.ps1` verifies/stages the manifest-pinned runtime; `-Activate` activates it locally. Provisioning requires PowerShell 7 and an existing 7-Zip installation; nothing is installed globally.

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

The field harness requires an existing completed two-phone fixture report, such as artifacts/phone-metadata-field-1790143524642-5847db51/report.json; it copies owned excerpts, not personal originals. Native tests run serially per data location. Historical accepted0.6 evidence includes 281 direct checks, affected native endpoints and 20 actual packaged cases across four process sessions. Build/source/resource hashes tie the runtime report to the artifact. The portable harness uses restricted PATH and verifies process/session network denial through an unavailable proxy/resolver; this does not claim physical disconnection, general Node socket isolation or clean-machine acceptance. Reuse relevant completed evidence rather than repeating expensive personal-media campaigns.

Main owns paths, plans, queue, processes and protected publication. The isolated renderer calls a narrow validated preload API; it cannot submit arbitrary argv, execute processes or access the filesystem directly. Source responsibilities remain separated across main.js, preload.js, src/ and ui/.

## Built With Codex

Ahmed originally built this project with ChatGPT by transferring code into Visual Studio Code. The September 2026 re-entry was human-directed AI collaboration: Ahmed defined product requirements and approval boundaries; ChatGPT's Mother/Development Thread supplied context and strategic review; Codex implemented, debugged, tested and documented the approved local work. Historical source and documentation remain preserved.

Versions 0.1–0.4 record the historical sequence. The old npm 1.0.0 value was scaffold metadata. The unchanged-source baseline is tagged baseline-2026-09-06; local-v0.5.0 preserves the accepted re-entry milestone. A future 1.0.0 or public release requires separate acceptance.

## Documentation and licenses

- [Current State](0-%20Documentation/01_Current_State.md), [Roadmap](0-%20Documentation/02_Roadmap.md), [0.6 Goal](0-%20Documentation/11_Approved_0.6_Goal.md) and [plan](0-%20Documentation/12_Approved_0.6_Plan.md).
- [Architecture](0-%20Documentation/00_Project_Architecture.md), [Technical Reference](0-%20Documentation/03_Technical_Reference.md), [Security and Testing](0-%20Documentation/04_Security_and_Testing.md) and [short project guide](0-%20Documentation/05_How_This_Project_Works.md).
- [Execution Index](0-%20Documentation/07_Execution_Index.md), [Session Summary](0-%20Documentation/06_SESSION_SUMMARY.md) and [PBS provenance](0-%20Documentation/08_PBS_Context_and_Migration.md).

The manifest declares ISC; bundled components have their own licenses. Electron/Chromium notices, FFmpeg notices and resources/binary-manifest.json accompany the package. The full static FFmpeg build is identified as GPL-3.0-or-later. Notices/provenance are not a complete corresponding-source distribution or written source offer. GitHub upload, distribution licensing review, signing and public release remain separate approval boundaries.
