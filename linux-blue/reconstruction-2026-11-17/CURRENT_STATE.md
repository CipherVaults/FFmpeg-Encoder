# Linux 0.7 reconstruction: current state

Last reconciled: November 17, 2026, after the first surviving-source verification milestone.

## Start here

This is a separate reconstruction of surviving source from `CipherVaults/FFmpeg-Encoder-Blue-Linux`, immutable commit `f6bc64aa4afd84377e732188da6c7d5ce3bf0680`. It is not the lost working volume, a recovered Git history, or the latest unpublished Linux development. Read this record, [the execution report](EXECUTION_REPORT.md), [the full PBS session](SESSION_SUMMARY.md), then [the selected source manifest](SOURCE_MANIFEST.json).

The complete local export contains 863 byte-verified source blobs. One historical logo-comparison image was not returned by the source service and has not been replaced with an empty file. The separate November 16 Windows snapshot, including its captured corrections, remains unchanged. No mismatching Windows files were overlaid into this Linux baseline.

## What works now

- Focused baseline component checks: 78 passed, no failures or skips.
- Actual ordinary CPU service exercise: H.264, H.265 and AV1 each completed on a generated 0.4-second 320 × 180 source, with 12 frames, complete decode and copied-audio hash verification.
- The same bounded exercise checked cancellation at encode-child spawn followed by retry, changed-source refusal, existing-output protection, publication collision, source disappearance after valid completion, and refusal of unsupported changed operations.
- All 81 spawned child processes closed, maximum concurrency one, none live at completion. All 863 exported source files still matched their original hashes afterward.

## What is not complete

The broader Linux regression is **failed: 147 passed and 30 failed out of 177**. The surviving checkpoint depends on absent generated fixtures, the missing custom FFmpeg 9.0.2 runtime, missing calibration/service reports, and shared code not fully synchronized to the Linux composition. The execution report distinguishes these causes. No report was fabricated, failed test skipped, required digest repinned, or safety gate weakened.

The successful ordinary CPU exercise uses the already pinned baseline system runtime. It does not qualify the missing custom runtime, trim/resize families, broad media fidelity, actual GPU devices, native Windows behavior, Electron UI, packaging or a release. Cancellation was at child spawn, not a later active-frame cancellation claim. Ahmed retains product acceptance.

## Preservation and publication

The initial checkpoint is deliberately narrower than the complete historical repository: reviewed application/build/source/tests/required assets and Linux source, plus these new PBS records and compact evidence receipts. Private Planning, executor configuration, unreviewed historical documentation, historical raw proof artifacts, generated media, dependencies and runtime binaries are excluded. The manifest identifies included files and the exclusion policy; it is not a claim that excluded history was restored by this archive.

Local Git uses `blue/reconstruction-20261117`, explicitly a new reconstruction history. A later checkpoint receipt owns the actual local commit, Notion attachment and restoration hashes, and any independently verified GitHub publication. This record does not assert that any of those publication steps has already succeeded. Do not push this new root over the original branch or force-push to reconcile ancestry.

The earlier 35-file submission has unknown terminal disposition, not a verified approval or denial. Its exact payload remains unresolved and is not imported into this selected baseline. Separate earlier review restrictions are not presumed cleared. Current direction requires local Git → immediate verified Notion source mirror → GitHub when permitted, without using another destination to bypass review.

## Next bounded work and handoff

1. Verify the exact selected Git tree is restored from its Notion attachment, with archive and per-file hashes. Until then, report the checkpoint as local only.
2. Repair the demonstrated Linux file-identity incompatibility in `src/operation-runtime.cjs` through a narrow reviewed change. Preserve exact raw identity comparison, path/handle/size/hash checks, and Windows behavior; do not change source pins merely to open Remux.
3. Continue source-closure reconstruction and fresh evidence for the missing proportional families, separately from the working ordinary CPU route. Recovered source and newly generated evidence must have distinct provenance.
4. Reconcile any proposed shared change with the preserved Windows corrections before eventual Windows integration. Windows-native qualification remains separate.

Maintain one source writer. Preserve the original theme, shared architecture, narrow preload/IPC, main-owned execution and no-overwrite publication. Non-HDR 0.7 remains the scope, packaging stays last, and defaults, ArchiveCQ29, the separate benchmark, accepted releases and deferred HDR are unchanged. Security Cloud has not been run. The supplied Git rhythm and AI PBS 1.1 remain the working method; substantive sessions retain all thirteen adopted sections.
