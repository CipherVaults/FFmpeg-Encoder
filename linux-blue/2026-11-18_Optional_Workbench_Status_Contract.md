# Optional workbench status contract

Checkpoint 041 fixed cutoff: 2026-11-18T08:21:10.119189+00:00. Checkpoint 040 final immutable mapping receipt is independently verified and released; 041 preservation is pending. This source-only checkpoint adds no media/GUI result and preserves earlier dated evidence unchanged. Expected scope: six changed paths including Session, 641 files and 41 commits.

## Problem and bounded repair

The stopped ordinary native journey retained a missing `encoder:workbench-session` handler error: shared renderer/preload asks for optional status even on non-switching routes. Its separate picker REQUESTED→CANCELLED outcome remains unexplained. The status diagnostic is reproducible, but no evidence connects it causally to picker cancellation.

The two-path change adds a default read-only disabled status response in `src/ipc.cjs` and `tests/workbench-default-status.test.cjs`. A fresh disabled object reaches actual preload callers through the existing envelope. Session selection remains unregistered unless explicitly opted in. Opt-in status/select dispatch is unchanged; blocked owners permit status only. No new filesystem, runtime, permission or configuration authority is granted.

Registered-window, sender, main-frame, URL, arity and admission checks precede dispatch. Held trusted rejection diagnostics remain counted until settlement; captured retired callbacks refuse. Existing drainage protects pending requests. Renderer, preload, main, picker implementation, runtime choice, pins, theme and defaults are unchanged. Shared IPC also serves Windows, so Windows source behavior is affected even though no Windows/native execution occurred.

## Review and tests

The proposed new test against exact baseline IPC and unchanged actual preload produced one pass and three expected failures; independent review reproduced that control. Author focused checks passed 49/49. Author Linux broad passed 317/317 but excluded the newly added shared test; do not describe that run as complete new-test coverage. Independent green coverage passed 75/75 across real IPC registration/lifecycle/quit/session logic using synthetic Electron and VM preload. These counts are different overlapping scopes, not additive.

Reviewer initially attempted Git inventory in a non-Git isolated source copy; that failed before testing or writing the review, then was corrected to the exact authoritative immutable Git base. It does not change tested source identity or constitute a failed application test.

Integration at 08:15:23.657304 UTC used checkpoint 040 local `d8812dcd5b84e3562d0c35a707615df69733d604`, after its source/history restores but before its full native PBS and final GitHub mapping. Of 638 existing files, 637 were unchanged; the new test brings the checked source set to 639. No runtime action accompanied integration.

Lead tests completed 08:16:21.324755 UTC: 177/177 focused, 229/229 protection, 321/321 explicit Linux plus the new shared status file, all exit zero with zero skips/cancellations. All 639 checked source files remained byte-identical through the tests. This is not npm test, native execution or media qualification. Full commands/log identities are retained in the three referenced lead receipts.

## Preservation and continuation

Checkpoint 040 GitHub lead verification completed at 08:19:27, after this source integration. By the fixed cutoff, independent mirror mapping and the entire 040 preservation cycle were complete, and its final durable receipt was released. A mirror readback-schema adaptation stopped read-only before any receipt mutation; the corrected shape verified all six files without replaying a remote mutation. Source-only restoration excludes runtime/media inputs; prior service and native evidence remains on exact 039, not this new change.

The known-profile native preparation has eight independently reviewed tests and conditional unbound status. No runtime/gate or successful picker outcome is claimed. Preserve 041 before exact binding and a separately released controlled picker investigation. Keep ordinary 7.1.5 rollback, Full-copy pins and audio policy unchanged. Manual scoped review is not formal Security Cloud or native security-enforcement qualification.
