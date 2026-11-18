# Windows archive acquisition preparation

This source increment does not run downloads, install runtimes, generate media, change a hosted workflow or qualify Windows native behavior.

`scripts/acquire-candidate-archives.cjs --parent EXISTING_ABSOLUTE_DIRECTORY` is an explicit future Windows-only acquisition command. It obtains only the two archives from the unchanged candidate manifest: Gyan's selected third-party FFmpeg9.0.2 distribution and upstream Electron44.7.0. It reserves a fresh directory, preserves the27GiB free-space floor plus archive sizes, limits redirects/hosts/time/bytes, verifies hashes, and emits the existing schema1 transfer receipt only after both archives verify. Failed attempts remain in their own directory; there is no overwrite/recovery-cleanup mode. Signed redirect URLs and raw transport errors are not written to failure receipts. Same-user malicious filesystem swaps cannot be made fully atomic by these path checks.

FFmpeg extraction is deliberately NOT implemented here. A separately reviewed step must inspect archive paths/links/extraction size, extract into a fresh owned directory and use the existing `provision-candidate-runtime.cjs --receipt ... --payload ...` interface. That existing provisioner checks exact binaries/notices, retains its25GiB residual floor and does not overwrite an unknown destination. The acquisition receipt is evidence about compressed archives, not a successful runtime installation.

The only Electron provisioner change is optional `--archive ABSOLUTE_PATH`; no argument preserves the existing F-drive default. It still verifies the pinned archive, requires npm metadata installed with scripts disabled, uses exclusive destinations and existing receipts, and preserves its27GiB floor. No dependency/version/hash or source-family policy changes.

## Frozen eventual CPU fixture and route

Use one generated QuickTime-brand (`qt`) MOV with exactly progressive H264 High/yuv420p1920x1080 at30/1fps, square pixels/16:9, explicit BT709 limited-range/left chroma, and PCM s16le/s16 stereo48kHz. Fixed source duration4seconds; fixed range1.013s through2.787s; resize720; precision-flac; h265-cpu, preset slow, CRF25; Matroska output. Confirm every current source-family clock/geometry/side-data condition from the independently inspected real probe and full decoded content. Do not switch to AAC after a refusal. Match exact verified-pair runtime identity with production catalog selection, not encoder listing or a copied catalog identity.

A later smoke must invoke real production controls and service prepare/edit/start, requiring actual admission and output validation. If this fixture is refused, record the reason and stop the intended-positive result as blocked/failed; do not green it as a generic expected refusal or edit/reseal catalogs. A separately named out-of-family refusal probe is safety evidence only. Keep service smoke independent from Electron initially. Hardware discovery may probe available devices but establishes no NVIDIA qualification.

## Validation limits

Injected archive-stream/file tests exercise exact success, malformed transport, redirects, oversize/short/wrong digest, collision, timeout and host/argument refusal. No real archive or download is used. Hosted free-space,7-Zip extraction safety, real publisher redirects, Windows paths/filesystem and eventual CPU/Electron execution remain unverified. Existing fast CI is unchanged.

Ownership correction: retain the fresh attempt-directory identity and check it before every archive reservation/readback and receipt write. If that identity is lost, do not write failed.json through the replacement path or claim where preserved files now reside. Ordinary check/dispatch races remain a limitation. On Windows both explicit path arguments require fully-qualified drive-letter syntax and reject UNC/device/current-drive-rooted and alternate-stream paths. A drive letter alone does not establish physical locality; the eventual runner must choose a known local volume.
