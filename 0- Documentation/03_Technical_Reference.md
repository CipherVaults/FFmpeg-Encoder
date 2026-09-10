# Technical reference

Updated September10,2026 through J/K acceptance; dated Inspection Reuse and Same Folder reports record evidence. Local 0.5.0 and its portable contract remain accepted historical evidence; legacy commands are historical.

## Current process boundary

Milestone F implements the named preload API and main-owned service in src/. The renderer under ui/ has no Node access. Main validates sender/top-level frame, settings and opaque folder/plan/file identities, then runs fixed binaries with shell disabled and a local demuxer/protocol allowlist. It validates outputs before exclusive publication and awaits child close/cleanup before restart. The Process Architecture report links tests and limits. Milestone G now serves exactly index.html, styles.css and renderer.js under app://encoder with a dedicated session allowlist and restrictive response CSP. Native traversal/resource/navigation/permission checks pass; see the Local Protocol execution report.

## Legacy command and migration

The old main process hardcodes `libx265`, preset `slow`, CRF `25`, tag `hvc1`, x265 parameters `aq-mode=3:psy-rd=2`, and audio copy. It accepts input/output paths from the renderer and uses a working-directory-relative FFmpeg path. The UI constructs settings that do not reach this command. Preserve that behavior for baseline testing, then replace it with validated main-owned profile construction.

The old manifest specified Electron `^41.0.2`. Electron `44.2.0`, Playwright `1.63.0`, and matching FFmpeg/ffprobe `9.0.1` are now installed and verified independently; see the runtime execution report and binary manifest. Electron's executable is provisioned by the project's postinstall hook. Packaging uses direct `@electron/packager` 20.3.0 and the existing 7-Zip installation. Forge 7.11.2 was rejected after dependency advisories and incompatible modern Packager hooks; the replacement reports zero npm audit vulnerabilities at the I checkpoint. Use project-local tools; no machine-global installation is authorized by this requirement.

## Encoder profiles and adopted defaults

| Product profile | Encoder | Default preset | Default quality control | Output suffix |
|---|---|---|---|---|
| H.264 CPU | `libx264` | `slower` | CRF 24 | `_H264-CPU.mkv` |
| H.265 CPU | `libx265` | `slow` | CRF 25 | `_H265-CPU.mkv` |
| AV1 CPU | `libsvtav1` | `6` | CRF 32 | `_AV1-CPU.mkv` |
| H.264 NVIDIA | `h264_nvenc` | `p5` | CQ 28 | `_H264-Nvidia-GPU.mkv` |
| H.265 NVIDIA | `hevc_nvenc` | `p5` | CQ 25 | `_H265-Nvidia-GPU.mkv` |
| AV1 NVIDIA | `av1_nvenc` | `p5` | CQ 30 | `_AV1-Nvidia-GPU.mkv` |

These defaults are adopted engineering starting points after the pinned encoder help, twelve default cases and 110 accepted preset/quality-boundary cases passed. Actual UI changes and real commands also match in the H product suite. CPU H264/H265 expose CRF0–51 and ultrafast through veryslow; AV1 CPU exposes CRF1–63/presets0–9; NVIDIA exposes p1–p7 and CQ1–51 (H264/H265) or1–63 (AV1). SVT CRF0 silently resolves to35; presets12/13 alias11 and presets10+ warn of automation-only artifacts, so those choices are excluded. Product bit depths are8/10 only; runtime checks can narrow availability. These tests do not establish every cross-product, format, speed or perceptual-quality result. Listing an NVENC encoder in FFmpeg does not establish that it works on the installed GPU/driver. Unavailable profiles are disabled with a reason; there is no silent switch to another encoder. Equal CRF/CQ numbers across encoders do not indicate equivalent quality. Historical x265 tuning may remain only in the x265 profile after validation; do not reuse those options across encoders.

Expose only choices that map to validated profile settings. Preview and monitor must show the effective settings actually used by main. Settings changes invalidate or regenerate the prepared plan so the preview cannot silently describe an older command.

## Input, plans, and stream preservation

Scan top-level regular files only, with case-insensitive extensions `.mp4`, `.mkv`, `.mov`, `.avi`, and `.webm`, in deterministic alphabetical order. Allow identical canonical input/output only after the bounded helper verifies ordinary local fixed NTFS; other storage uses a distinct output folder. Main creates opaque selection and plan identities, validates the sender/settings, reserves all baseline names and reliable identities before workers run, rejects source aliases/symlinks, and rechecks relevant source/folder/destination/provenance state before execution.

Encode the selected non-attached primary video stream. Explicitly map supported audio and subtitle streams, attachments, chapters, metadata, and dispositions into Matroska. Preserve supported resolution, cadence, color information, and bit depth. Profile limitations and unsupported stream/container combinations must be visible; do not silently drop content or silently convert audio/subtitles. Additional non-primary video is deliberately omitted under the primary-video policy. Attached-picture video, data streams and unrepresentable preservation cases are rejected rather than silently discarded.

An existing destination is a skip, including when quality settings changed but the encoder-based filename did not. Use a different output folder to make another encode. If distinct input names share the same stem and destination, require selection to resolve the conflict in preview. Do not create numbered copies automatically. A preview containing only skips/unsupported files stays reviewable with Start disabled and a Nothing to encode explanation; change folders/settings to prepare again.

## Precise SDR/HDR classification

The classification examines structured ffprobe stream data and bounded decoded-frame samples for the selected non-attached video stream. It does not guess from filenames, codec names, pixel depth, or stderr prose.

**Detected HDR, unsupported for 0.5.0:** PQ transfer (`smpte2084`), HLG transfer (`arib-std-b67`), recognized Dolby Vision configuration/RPU metadata, or recognized dynamic HDR metadata. Relevant FFmpeg labels include packet `HDR10+ Dynamic Metadata (SMPTE 2094-40)` and frame `HDR Dynamic Metadata SMPTE2094-40 (HDR10+)`. Positive HDR evidence is not erased by contradictory SDR metadata elsewhere in the sampled stream.

**Supported SDR classification:** coherent recognized SDR transfer evidence with no HDR signal or unresolved static-HDR contradiction. The explicit transfer allowlist is `bt709`, `gamma22`, `gamma28`, `smpte170m`, `smpte240m`, `iec61966-2-1`, `bt2020-10`, and `bt2020-12`. Encoder/pixel-format support is a separate decision after SDR classification.

**Ambiguous/unsupported color evidence:** no usable transfer evidence across required checks, an unknown/unsupported transfer, conflicting non-HDR transfer signals, static mastering-display/content-light metadata without coherent HDR signaling, or failure of a required probe. Report the reason as ambiguous/unsupported; do not label every such case detected HDR.

Ten-bit pixels alone are not HDR. HEVC Main 10 and BT.2020 primaries alone are not HDR. BT.2020 transfer values in the SDR allowlist are distinct from PQ/HLG. Do not use a guessed mastering-luminance threshold to resolve ambiguity.

Sampling target: first two seconds; for seekable media longer than ten seconds, also one second around the midpoint and two seconds near the end. Bound process time and output size, support cancellation, and record missing/failed coverage. Sampling cannot prove there is no HDR metadata elsewhere or that incorrectly tagged pixels truly match their tags. Document this limit in results and tests without claiming complete content certification.

## Persistent inspection evidence (J)

Fresh inspection first runs ffprobe metadata discovery (30 seconds, 16 MiB output bound): format/duration, streams, primary video, dimensions/cadence/depth, preservation fields, chapters and color evidence. JavaScript selection/normalization/mapping is inexpensive relative to media decoding. Definitive metadata HDR can finish unsupported without decoding. Potential SDR retains the established decoded start/middle/end checks (20 seconds and 8 MiB per window), with timestamp coverage and conservative missing/error handling. Positive HDR evidence is never overwritten by later ambiguity.

Cache identity includes canonical path; decimal-string bigint dev/ino/size/mtimeNs/ctimeNs/birthtimeNs; SHA256 over first/middle/last up to 256 KiB with offsets/lengths; actual ffprobe SHA256; and explicit normalization/color/sampling/selection/preservation versions. K normalization2 rejects duplicate raw JSON keys/parent containers so they cannot hide provenance; prior cached evidence intentionally misses once. Source reads use a single read-only handle with before/after handle/path checks. The storage-checked stamp must match the sampled identity. Revalidate again before and after encoding. Sparse sampling is not whole-file hashing; stopped recordings and cooperative local-file change detection remain the operating contract.

Fast reuse requires verified Fixed/NTFS storage and reliable root/file identity. An optional absolute system Windows PowerShell helper uses fixed .NET DriveInfo code, bounded JSON root data on stdin, shell:false, no profile/elevation/PATH/ExecutionPolicy bypass, a five-second timeout and 8 KiB output bound. Unknown/network/removable storage or helper failure uses fresh inspection; failure is session-memoized by root/device to avoid repeated launches. No helper output grants filesystem or IPC authority.

The state directory's cache/inspection-v1 contains normalized metadata/frame evidence and checksums. Limits: 2,000 records/128 MiB disk, 4 MiB each, 128 records/16 MiB hot memory. A stale, incompatible, malformed, truncated, corrupt or oversized record misses. Oversized otherwise usable fresh evidence still works uncached. Cancelled, timed-out or incomplete frame evidence is not stored as reusable success. Hits reconstruct color/summary under current policy; plans/settings/hardware/destinations remain fresh. Writes use owned temporary files and atomic rename; LRU timestamp updates use checked single-link handles. Clear/eviction is restricted to cache-owned names and does not remove media or provenance.

Preparation has at most two workers; identity/cache operations are bounded and serialized where required. Cancellation/shared failure stops new admission and waits for all owned children and pending finalization. Completed stable records can survive a cancelled batch. The UI reports resolved files, reused/new counts, active workers, metadata/frame stage and elapsed time. Percentage means resolved files / total files, not guessed progress within a decode window. Startup capability checks have a separate state; expert controls stay visible and locked during work. No Skip Inspection switch exists.

## Child lifecycle and protected outputs

Spawn only fixed bundled executables with argument arrays and `shell: false`. Constrain media input protocols to the required local-file behavior; reject unsupported indirection/network cases. Use the correct resource path in both development and packaged execution, without relying on the current working directory or global PATH.

Every batch and job has a stable identity. State transitions separate preparation, probing, encoding, cancellation, output verification, publication, terminal results, and readiness for the next batch. Hold the exact child handle through close; use ownership checks so old callbacks cannot clear a newer child. Handle spawn errors and nonzero exits explicitly. A cancellation request stops future queue items, terminates only owned children, waits for close, then cleans owned incomplete files. New work cannot start during cleanup.

Encode into a unique owned temporary path in the chosen output area. Successful process exit is necessary but insufficient: probe and validate the completed temporary file before publishing. Publication must not overwrite an existing destination even if another program created it after preview. Same-folder publication requires an exclusive atomic hard link and fails closed if unavailable. Distinct-folder publication retains the exclusive-copy fallback. Seal the successful child output identity before probing it. Clean only the bound owned object, never a protected input identity or replaced/unbound pathname; retain uncertain incomplete objects with an explicit per-file notice. Never delete an input, pre-existing output, or finished output during cleanup.

File-specific problems produce a failed/skipped result and allow the next eligible file to continue. Shared failures such as an unavailable output drive, permission failure affecting the destination, storage exhaustion, or missing/broken runtime halt remaining work with a useful reason. Results distinguish succeeded, failed, skipped, cancelled, and unprocessed items.

## Telemetry and UI contract

Use FFmpeg `-progress pipe:1` for machine-readable progress. Buffer partial chunks until complete lines/records; normalize progress in main. Use probed duration for determinate percentage/ETA when meaningful. Unknown duration remains indeterminate. Display elapsed time, encoded time, FPS, speed, and readable byte units; avoid stale numbers crossing job boundaries. Neither `progress=end` nor a 100% display is proof of success: process completion, output validation, and publication decide the final result.

The renderer subscribes through preload and receives an unsubscribe function. Snapshot/update events carry job/batch identity so rendering cannot mix old and current state. User controls remain responsive during probing and encoding. Results allow a new batch after the lifecycle settles.

## Portable build and operation

Use the verified Node 24 development environment, npm ci, and the pinned FFmpeg provisioning manifest. On a fresh checkout, scripts/provision-ffmpeg.ps1 requires PowerShell 7 and existing 7-Zip; its default verifies/stages the pinned pair, and -Activate places the verified pair under ffmpeg/. npm run make:portable builds into a fresh out/portable-* directory using packaging.config.cjs. npm run test:portable -- "<build-report.json>" verifies that exact artifact. Only a passing native report accepts the build; build success alone is insufficient.

The packaged executable needs no global Node or FFmpeg. Extract the entire ZIP into a writable folder. Both Electron userData and sessionData point to adjacent data before readiness, including GPU/network/renderer children. Packaged binaries are under process.resourcesPath/ffmpeg. Terminal batch snapshots are written under data/logs with unique batch IDs; logs may include local filenames and have no automatic retention policy. Keep them local unless deliberately reviewed for sharing.

The I test uses an isolated Unicode/spaced extraction, alternate cwd, PATH limited to Windows System32, and verified unreachable-proxy network isolation. A separate control session proves online success followed by ERR_PROXY_CONNECTION_FAILED, while the production session resolves the same proxy and retains its request allowlist. Nominal offline-emulation flags and navigator.onLine were not reliable evidence in this runtime; the report preserves those failed checks. This does not claim physical disconnection, arbitrary main-process socket confinement, or clean-machine compatibility.

Cancellation/close cleans bound owned work; unbound incomplete files are retained with a safety notice rather than adopted for deletion. An abrupt OS crash or power loss can leave owned temporary directories; no broad automatic sweep deletes unknown files. Exclusive-copy publication on filesystems without hard links prevents overwrite but can expose a partially copied destination to other readers before copying finishes. Do not remove the drive while work or cleanup is active. These limits do not affect the tested NTFS local workflow.

## Output provenance and legacy originals (K)

New MKV outputs carry global FFMPEG_ENCODER_PROVENANCE=1 and FFMPEG_ENCODER_OUTPUT_ID=UUID after copied metadata; output validation requires the exact main-issued UUID. Any reserved tag partial/malformed/unknown/misplaced/duplicate state is non-ready. A generated marker or reliable published-index identity excludes a file before deep inspection or destination skip. All six historical suffixes are Possible previous output and require explicit Treat as original, bound to the current plan and sparse fingerprint and rechecked before encoding; marked outputs cannot be overridden.

The local provenance-v1 journal is separate from inspection cache and future preferences. Immutable checksummed intent/published files are bounded to10,000 namespace entries/32MiB total/16KiB per record with no automatic eviction. Required intent failure stops that encode; final publication-record failure keeps valid output/intent and shows pending bookkeeping. Startup inspects at most128 pending intents without changing media; completed pairs need no recovery probe. Matching/absent/unrelated/uncertain and remaining inventory are reported. Unmatched or malformed data is preserved, never used to delete/republish.

Markers support ordinary rename/copy recognition; index identity includes dev/ino/birthtime/size/sparse digest and permits supported same-object renames. This is recognition, not authentication or full-byte proof. Removal of all marker, identity and naming/index evidence can erase attribution. Old0.5 does not understand provenance: rollback uses distinct folders/original-only sources and keeps0.6 data separate.
