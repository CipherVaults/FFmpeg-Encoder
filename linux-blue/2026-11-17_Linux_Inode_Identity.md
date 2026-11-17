# Correct Linux runtime inode representation without weakening identity

Date: November 17, 2026. Parent checkpoint: `99e1430bf3c2b6156f2388842dc9e0eedb7bab83`. Source/test patch: `c4291402ba04a48f372da82858e9fc716dffe715f3e566d9e5e930b70f413fa3` (SHA-256).

## Demonstrated defect

The reconstructed runtime observer rejected both fixed baseline binaries before granting any observation. Their sizes, SHA-256 pins and single-link identities matched, but this Linux host's bigint stat records returned inode values `-9223372036854474998` and `-9223372036854474992`. The shared guard rejected every nonpositive inode. Surviving Linux tests already expected those exact raw signed representations to work.

This was a source-level platform mismatch, distinct from the missing custom runtime and historical proof artifacts. Repairing it does not justify changing any evidence or source pins.

## Change and security argument

The guard now requires a bigint and accepts either an existing positive value or, only on Linux, a negative value within signed 64-bit bounds. Zero, negatives below `-(1n << 63n)`, numbers, strings and other malformed values fail closed. Positive bigint admission is unchanged. Valid Windows/non-Linux behavior is unchanged; explicitly rejecting malformed non-bigint values is an intentional tightening because production stat calls already request bigint records.

No sign normalization, absolute value or unsigned alias is introduced. The raw inode string continues into the identity stamp. The existing code still compares held-handle and path stamps exactly, including device, inode, size, link count and timestamps. Canonical-path, ordinary-file, hardlink refusal, hash, age/invocation refresh, token currentness and process ownership remain unchanged. Existing documented same-stamp/TOCTOU observation limits remain; this is not an executable-image pinning claim.

Changed application/test files only:

- `src/operation-runtime.cjs`: bounded Linux representation predicate and explanatory boundary comment.
- `tests/operation-runtime-platform.test.cjs`: five isolated-VM matrix checks against the actual private guard, without a production test export or mutation of global `process.platform`.
- `linux-blue/workbench-remux.test.cjs`: currentness must refuse both an incremented inode and its sign-flipped counterpart.

## Verification and failures

| Receipt | Result | Meaning |
| --- | --- | --- |
| `20261117T134444Z_linux-inode-before-fix` | 2 passed, 3 failed of 5; exit 1 | Red tests demonstrate signed-value rejection and malformed-type gaps before changing production code |
| `20261117T134459Z_linux-inode-platform-and-observer` | 38 passed; exit 0 | First focused implementation check; historical after the final comment/test addition |
| `20261117T134510Z_linux-inode-real-pair-and-remux-gate` | 6 passed, 1 failed; exit 1 | Actual pinned pair works; independent source-pin gate remains closed |
| `20261117T134624Z_linux-inode-final-observer` | 38 passed, 0 failed/skipped; exit 0 | Final exact source, platform matrix and existing observer lifecycle/mutation checks |
| `20261117T134625Z_linux-inode-final-linux-regression` | 149 passed, 28 failed of 177; exit 1 | Final broad Linux run; two inode failures resolved, all remaining failures retained |

The final focused command was the project's evidence wrapper over `tests/operation-runtime-platform.test.cjs` and `tests/operation-runtime.test.cjs`, covering `src/operation-runtime.cjs`, `src/candidate-runtime.cjs` and `src/process-runner.cjs`. The final broad command ran every `linux-blue/*.test.cjs` and bound Linux source plus the affected shared runtime/family/evidence/service files. Node was `v24.22.1` on Linux. Tests ran on a working tree whose HEAD was the baseline commit; receipts bind exact changed files and preserve the dirty-tree status, not a claim that baseline HEAD contained the correction.

Compact original receipt copies and final changed-file hashes are in [the receipt record](2026-11-17_Linux_Inode_Receipts.json). Raw test logs remain locally retained at their immutable receipt directories. No failed receipt was rewritten, skipped away or relabeled successful.

The 28 remaining broad failures comprise four unavailable synthetic-fixture cases, eight missing custom-runtime cases, thirteen missing calibration/service-report cases, one legacy family-schema incompatibility, one stale pre-activation assertion, and one Remux source-digest gate. In particular, `workbench-remux.cjs` retains the required historical observer digest. The newly reviewed correction is not asserted to reproduce that missing file's complete content.

## Independent review and limits

An independent focused source review covered all three changed files against the immutable patch. It found no blocking issue, confirmed the raw-identity and platform boundaries, and specifically required retaining the source-pin failure. The reviewer did not rerun tests; final exact-tree tests were performed by the lead. This was a focused security/regression review, not Security Cloud or an exhaustive scan.

The actual-pair checks observe and hash binaries; they do not launch an encode. VM Windows guards are not native Windows filesystem qualification. No media or GUI campaign was repeated for this correction, and no GPU, broad fidelity, changed-operation or release claim follows.

## Checkpoint and continuation

Record the exact local commit, immediate Notion archive download/restoration and later permitted GitHub result separately. Keep the baseline manifest immutable as evidence for its own checkpoint. Do not publish the unresolved old 35-file payload or force the new reconstruction history onto the original branch. The next bounded implementation is shared proportional-family source closure, with its own contract, tests and independent review; runtime provisioning and real qualification remain separate.
