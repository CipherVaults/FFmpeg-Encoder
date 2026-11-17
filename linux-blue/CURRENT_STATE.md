# Linux 0.7: current development state

Updated November 17, 2026, after the bounded proportional FLAC source-contract integration. Start here, then read the newest [Linux session](SESSION_SUMMARY.md), [execution report](2026-11-17_Proportional_FLAC_Contract.md) and [compact test receipts](2026-11-17_Proportional_FLAC_Receipts.json).

## Reliable continuation point

The preceding completed checkpoint is local commit `0c5d9d2fa05f68a27b1e3ed776c268c2ed0a5cf8`, preserving the Linux inode-identity correction. Its [Notion checkpoint](https://app.notion.com/p/41bbd7ade63b818b9b4fda7ffe6b7c34) has a downloaded and restored 492-file source ZIP and a cloned two-commit Git bundle; every file matched the exact local commit. Source ZIP SHA-256: `e2be52ab4af3ec7538116f914969b228454648dadebf3c0a74102d9969fb0d4e`. Inner Git bundle SHA-256: `85de339ea5a995676c79cceb1ea5efa475c0803bea333e0808002c60414bc2b8`.

The corresponding GitHub commit is `acbc83f13d8c555056a633a4c63e0606cd6b8579` on `CipherVaults/FFmpeg-Encoder-Blue-Linux`, branch `blue/linux-development`. It preserves original surviving parent `f6bc64aa4afd84377e732188da6c7d5ce3bf0680`: 12 reviewed changed/new files were read back byte-for-byte, 862 files remained unchanged and none were deleted. Local reconstruction and original remote ancestry intentionally differ; never force the reconstructed root onto that branch.

The [first baseline checkpoint](https://app.notion.com/p/41bbd7ade63b8192842fc793c89d467c) remains intact. These are conservative application-source checkpoints, not recovery of the lost volume, excluded historical records or the latest unpublished work. The earlier 35-file submission's terminal disposition remains unknown and is not replayed.

## New application change

The new source contract adds only `cfr-sdr-range-flac-v2` with `cfr720p30-flac-resources-v1`: main-owned CPU HEVC slow/quality 25, 720p30 Keep Source, SDR, exact measured QuickTime PCM s16 stereo 48 kHz input, precision-FLAC Matroska range output. Core admission requires rational video `1/15360` and audio `1/48000` clocks. Proportional AAC, resize, full and 1440 variants are not added.

Resources derive from the genuine plan's selected interval, complete source extent and exact source size. Frozen private branding binds the result to its issuing selector epoch and exact plan, rejecting copied flags, cloned results, cross-plan borrowing and invalidation. Existing `requireCurrent()` calls still own source/runtime freshness. Service routing carries derived reservation, byte accounting, child/deadline and telemetry limits while retaining legacy fixed limits and coefficients.

Final focused checks: **42/42 passed**. Portable legacy tests with an isolated path-only adaptation: **33/33 passed**, also passing on the exact parent. Independent reviewer repeat: **12/12 passed**. Final broad Linux regression: **150 passed, 27 failed of 177**, with no skips. It remains a failed broad regression, not overall acceptance. The direct core-clock negative test was red before correction; failed intermediate evidence remains retained.

Unadapted legacy comparison had the same 59 passes and 25 early Windows-path fixture failures on parent and changed source. That parity alone does not exercise the masked branches. Adapted tests are not native Windows qualification. Source hashes, commands and relevant limitations are in the compact receipts.

## Activation and qualification limits

The evidence collector was not extended. Its refusal occurs after encode in the service lifecycle; a direct no-collector-runner test is not a universal pre-encode gate. Actual production factories remain closed by unchanged exact retained-report, observer-source and runtime verification gates. No report, pin, default or factory activation changed.

Executed service-to-telemetry enforcement remains pending: current evidence covers resource values, source wiring and independent review, not that end-to-end sink. The Remux observer-source pin still refuses the unclosed dependency set; no repin shortcut was used. Missing custom 9.0.2 runtime and historical reports remain separate prerequisites.

The [baseline execution report](reconstruction-2026-11-17/EXECUTION_REPORT.md) owns the earlier real three-codec synthetic CPU proof and 81-child census at its original source identity. This new contract milestone has no new media, UI, native Windows, GPU, fidelity or release qualification. Packaging stays last; HDR remains deferred. The owner's additional Windows roadmap is cross-reference only: newer approved decisions retain 1440p/4K in 0.7 and do not reopen settled design decisions.

## Next work and checkpoint handoff

1. Complete this reviewed seven-file local Git checkpoint, immediately mirror its exact source and full local history to Notion, verify restoration, then publish the reviewed delta to the original GitHub ancestry when permitted. This pre-commit record does not claim the new cycle has completed; final identities and statuses belong to its external checkpoint receipt.
2. Add injected service-level tests that observe and enforce the exact derived storage, runner and telemetry limits without enabling media execution.
3. Separately review collector integration around genuine selection/plan/source/budget binding and complete-source verification, preserving legacy requests and current closed factory gates.
4. Resolve remaining runtime/report/source prerequisites through legitimate recovery or newly scoped qualification, never synthetic substitutes or weakened pins. Continue the agreed non-HDR Linux 0.7 plan, preserving theme, shared architecture, Windows corrections and the mandatory detailed PBS handoff.
