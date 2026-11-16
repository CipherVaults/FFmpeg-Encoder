# Linux CPU partial source checkpoint

This checkpoint publishes six independently authored Linux files on `blue/linux-development`: the CPU settings policy and tests, the synthetic-only service and tests, and their two historical local handoff records. It does not publish the earlier runtime adapter, pilot, provenance records, or any unresolved earlier upload payload.

## What is usable here

`node --test linux-blue/ui-policy.test.cjs` exercises the CPU-only settings boundary. The exact policy/test bytes passed **10/10 tests**, zero failures or skips, before publication against `src/media.cjs` Git blob `0a753bb9e47980a289facd462014867ce26549bb`, which matches this branch's existing file. This is settings validation, not encoding or UI qualification.

## Incomplete dependencies

**The synthetic service is not runnable from this branch.** Its required `linux-blue/runtime.cjs` is deliberately absent. Its known synthetic fixture and generated receipts are also not included. Existing `src/outputs.cjs` matches the local reviewed dependency at Git blob `20dd0c27029240a39d97bc324e97ff451d92be06`, but that does not close the missing runtime dependency. No fallback, substitute runtime, dependency installation, or production wiring was added.

The service and service-test files passed syntax checks during this publication review. Their integration suite was not rerun. The 98/98 and 23/23 results in the two handoff records describe earlier complete **local** workspaces, not this partial published tree. Those handoff files are preserved unchanged; their statements about no publication or installed dependencies describe the time of those checkpoints.

## Scope and next boundary

All six files were checked against both prior publication path manifests and were absent from both. Their contents were read and screened for credentials and private material. No earlier rejected or uncertain payload is retried, repackaged, or transferred in this commit. Earlier review restrictions remain unresolved. Referencing a missing dependency is not permission to publish it.

No private Planning, personal media, executable binaries, raw process receipts, original project history, or runtime adapter is newly uploaded. Existing historical repository files remain unchanged. The Windows project, application startup, runtime pins, product defaults and qualification catalogs are untouched.

This is an incomplete experimental code checkpoint, not a Linux application, release, Windows/GPU/HDR validation, or complete source synchronization. Resolve the missing runtime's publication status through a supported reviewed process before claiming a runnable synthetic service.
