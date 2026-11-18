# Current state: optional workbench status contract

Checkpoint 041 cutoff: 2026-11-18T08:21:10.119189+00:00. Checkpoint 040 preservation and remote mapping are independently complete; 041 preservation is pending. Two reviewed paths are integrated: shared IPC plus one new status-contract test. No renderer/preload/main/runtime/default/pin/audio-policy change.

Non-switching routes now answer the existing read-only workbench-status request with a fresh disabled result. Selection remains opt-in. Existing sender, frame, URL, arity, admission, drainage and retirement guards remain in force. This repairs the reproduced missing-handler diagnostic, not the native picker cancellation; no causal link has been established.

Lead file-only checks pass 177/177 focused, 229/229 protection and 321/321 explicit Linux plus the new shared test, with zero skips/cancellations. All 639 checked source files stayed byte-identical. Overlapping scopes are not summed; this is not npm test or native/media qualification. Shared Windows IPC changes but Windows/native remain untested.

Prior immutable 039 supports the finite remaining service cases; its native journey stopped REQUESTED→CANCELLED before registration. Neither outcome qualifies the new IPC bytes. Next preserve this source checkpoint, then bind/review a fresh known-profile picker journey. That preparation has eight reviewed tests and conditional approval only, no bound gate or runtime. No profile reset, default promotion or audio-policy change follows.
