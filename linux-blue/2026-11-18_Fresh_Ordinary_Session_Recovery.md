# Fresh ordinary session recovery

Fixed checkpoint 043 cutoff: 2026-11-18T09:41:18.591336+00:00. Reviewed V3 is integrated; preservation pending. Final scope is six source/test paths (three production and three tests) plus four PBS records: expected ten changed paths, 646 files and 43 commits.

## Intended behavior and preserved authority

Read-only feasibility established that a cancelled candidate keeps admission closed and its observer must not be revived. The existing same-kind selection path cannot restart it safely. The narrow design reuses WorkbenchSession retirement/acquisition and main replacement-window/IPC fencing. A candidate-only action discards the previous batch and output capabilities, waits for resource and diagnostic settlement, acquires a fresh fixed candidate and constructs a new window. Old renderer closure remains sticky; a new document legitimately starts clean. No automatic Prepare/Start or token/grant transfer is permitted.

Retirement failure poisons replacement and retains the old owner for shutdown. Unresolved retirement remains blocked rather than granting a timeout-based replacement. Double requests, in-flight picker/IPC, stale callbacks and untrusted frame/URL/arity continue to refuse. The transition handler must not wait for itself while retiring IPC. The owned child census is not exhaustive OS enumeration.

## Review corrections and current red evidence

V1 exposed a public alternate ordinary-action path on the recovery-enabled main route. V2 accepts only restart-ordinary before transition mutation or owner effects, preserving internal bootstrap and old baseline/full-copy selection. The actual preload/IPC negative control checks unchanged factory/service/window/access/plan state on rejection. Independent V2 repeated 184/184 source/injected tests, but that narrow set omitted an older candidate route fixture.

Initial integration on evidence-only 042 at 09:34:09.047416 UTC verified that only the five declared paths changed among 644 checked files. The lead's wider tests at 09:34:48.275166 retained four failures: 185/189 focused, 229/229 protection, 329/333 broad. These overlapping scopes are not summed; do not replace the red result with the earlier narrower green review.

Updating the older route fixture to the real session, genuine OutputAccess and current title exposed an actual expected acquisition-close misclassification, exit one. V3 corrects candidate-only expected SHUTTING_DOWN after successful cleanup while retaining fatal cleanup failures. The narrow suppression requires recovery enabled, actual closing, the exact SHUTTING_DOWN code, no poisoned session and no active owner. It cannot suppress the late-owner cleanup AggregateError; baseline/full-copy behavior is unchanged. Paired resource and diagnostic failures, and other factory failure while closing, still produce fatal exit/no replacement/no READY. Expected acquisition/load close controls produce normal exit zero/no READY.

Earlier fixture corrections remain part of failure intelligence: a live-child fixture was initially active before acquisition; VM brace syntax, explicit boolean disabled state, required inert openPath callback and shutdown expectations were corrected without suppressing actual failure behavior. New tests against original production were red. Synthetic Electron/candidate acquisition in main tests differs from genuine shared components; component grant-expiry evidence is not a native media operation.

## Final V3 review and integration

Independent V3 review accepted the frozen six-path proposal and repeated 191/191 focused tests. Its author 229 protection/335 Linux scopes were separate, not claimed independently rerun. The corrected older route fixture uses actual WorkbenchSession and genuine OutputAccess construction, retaining original opt-in/security/separate-state/no-fallback/drainage assertions and updating the deliberate current title. This repair exposed and fixed a real expected-close regression, not merely weaker expectations.

V3 integrated at 09:40:40.167812 UTC. Final lead tests passed 191/191 focused, 229/229 protection and 335/335 explicit Linux with zero failures/skips/cancellations. All 644 tracked files remained byte-identical through testing. Scopes overlap and are not summed; these are source/injected checks, not npm test or native/media qualification. The original V2 integration and 185/189 and 329/333 red receipts remain intact.

Failed acquisition cleanup can leave no active owner reference. The tested guarantee is fatal error/no replacement, not complete failed-resource settlement or a retry-owner guarantee. Never-settling retirement still blocks; no hard timeout/kill is introduced.

## Scope and continuation

Production intent is existing WorkbenchSession, Linux main and shared renderer only. Shared renderer also serves Windows, but Windows/native recovery is untested. Candidate runtime/service, IPC/preload, theme/HTML/CSS, defaults, producer pins and audio policy remain unchanged. No formal Security Cloud claim.

042 preservation and prior ordinary service/native proofs remain separate historical evidence. The concise reuse-only operator plan is unbound/unexecuted, with review pending at cutoff. Later review or feasibility findings are excluded. The final source checkpoint has reviewed V3 and complete lead tests; preservation and separate runtime review/binding remain required before execution. Do not repeat broad codec qualification solely for the owner handoff. No source/PBS/Git/runtime actions were taken by this record writer.
