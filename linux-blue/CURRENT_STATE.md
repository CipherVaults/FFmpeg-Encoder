# Linux 0.7: current development state

Updated November 17, 2026, after the bounded runtime-identity correction. Start here, then read the newest [Linux session](SESSION_SUMMARY.md) and [execution report](2026-11-17_Linux_Inode_Identity.md).

## Reliable continuation point

The reconstructed ordinary CPU baseline is local commit `99e1430bf3c2b6156f2388842dc9e0eedb7bab83`, derived from surviving remote `f6bc64aa4afd84377e732188da6c7d5ce3bf0680`. Its 487-file selected source archive and single-root Git bundle were downloaded from Notion, restored, and matched to the exact local commit. The [verified baseline checkpoint](https://app.notion.com/p/41bbd7ade63b8192842fc793c89d467c) includes readable PBS records and the path/language index.

The baseline source ZIP SHA-256 is `7183c1bc9faeac4749bc10eedf2edfd0fe655c617d5e0ff4583e45c95e862fc6`. The Git bundle SHA-256 is `4679eed142c24995a711dcb71d2511e39caba01de4be578804a174691c8ce798`. This is a conservative application-source backup, not restoration of the lost volume, original Git ancestry, excluded historical records or the latest unpublished work.

## New application change

`src/operation-runtime.cjs` now accepts a nonzero signed 64-bit inode representation on Linux, alongside the existing positive bigint representation. This repairs rejection of the actual pinned tools on this host. Exact raw identity strings, held-handle/path equality, ordinary-file and single-link checks, canonical paths, size/hash checks and freshness remain intact. Windows and other platforms still reject negative inodes; malformed non-bigint values now fail explicitly everywhere.

Tests exercise Linux boundaries, malformed identities, simulated non-Linux guards, unchanged file/link protections, raw sign distinctions and actual pinned-pair currentness. Final focused observer/platform run: **38 passed, no failures/skips**. Final broad Linux regression: **149 passed, 28 failed of 177**, up by the two demonstrated inode failures. This is still a failed broad regression.

The Remux source pin remains unchanged and still refuses the unclosed dependency set. The new correction does not prove equivalence to missing historical code, recover missing reports, or enable an unqualified operation. Its commit/publication receipt is recorded after the checkpoint operation; this pre-commit record does not claim that publication has already happened.

## Next work

1. Finish the correction's local Git → verified Notion mirror checkpoint, preserving exact source and test receipts.
2. Reconcile the next missing shared-source dependency, beginning with proportional-family admission and evidence-budget integration. Define a bounded positive/negative contract and independent review before changing those guards.
3. Treat runtime provisioning and fresh calibration/service evidence as separate tasks. Never retag the baseline runtime as custom 9.0.2, fabricate the missing reports, or repin source merely to open the UI route.
4. Continue toward non-HDR Linux 0.7, preserving existing design, shared architecture and Windows corrections. Packaging remains last.

The [baseline execution report](reconstruction-2026-11-17/EXECUTION_REPORT.md) owns the earlier real three-codec synthetic CPU proof and 81-child census. That proof belongs to its original source identity; the current correction has focused file-observer evidence, not a repeated media/UI campaign. Windows-native, GPU, general fidelity, trim/resize, custom-runtime, UI, packaging and release acceptance remain separate and incomplete. The earlier 35-file submission's terminal disposition remains unknown, and it is not replayed by these new reviewed changes. GitHub has not been pushed, and the new reconstruction history must not overwrite the original branch.
