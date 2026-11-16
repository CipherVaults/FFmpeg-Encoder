# Linux synthetic-only service checkpoint

## Scope

This local-only service composes the existing pinned Linux runtime, CPU settings
policy and unchanged staging/publication primitives into a single-job lifecycle.
It admits **only the exact known 12-frame synthetic fixture** from the prior
pilot, SHA256 `145c63faaaa6052e7fd7b0dc206319c67355edbb8b5e2c43a2687af5100a5d06`.
It does not accept personal media, HDR inputs, arbitrary executable paths or
renderer-owned file paths. Constructor paths and observers are main-owned.
There is no Electron dependency, IPC registration or app launch yet.

## Evidence

Final focused suite: **23/23 pass**, zero skips/failures: eight existing runtime
tests, ten corrected CPU settings tests and five synthetic service integration
tests. Receipt: `../evidence/local-service-bounded-capture-tests.tap`. Independent
review closed the source-binding blocker for this narrow main-owned synthetic
scope and reported no remaining material blocker.

Earlier pre-review suite: **22/22 pass**, retained as historical evidence in
`../evidence/local-service-focused-tests.tap`.

- H264, H265 and AV1 all encoded through owned staging, then seal, probe, full
  decode and exact copied-audio hash validation before atomic publication.
- Expected 12 frames, dimensions, colors, pixel format, audio stream properties,
  language and title validated. Source hash verified again before publication.
- Normal three-codec run: 18 children spawned/18 closed, maximum one live;
  source unchanged. Generated outputs and JSON receipts remain in artifacts.
- Existing output refusal preserves bytes. Progress-time destination collision
  preserves the winner and retains completed staging with explicit receipt.
- Active progress cancellation drains before restart; interrupted output is
  never published. Identity-unbound partials are retained by existing cleanup.
- Close during an active child drains and permanently closes admission.
- Nonfixture source refused before any child; GPU/settings refusals remain
  covered by the CPU policy suite.

The earlier 3-test integration receipt is retained separately. All 1,098 files
from local-ui-boundary compared byte-identically in the local-service copy.
Only the new synthetic service/tests and this handoff were added, plus ignored
generated artifacts. No remote, PC, production-code or security changes.
Independent review covers this narrow service only; it is not a reviewed app.

## Running

From the local-service checkout, point the explicit test environment variable
at the already existing known synthetic-source.mkv from cpu-pilot-rFragw:

```sh
LINUX_BLUE_SYNTHETIC_FIXTURE=/absolute/path/to/known/synthetic-source.mkv node --test linux-blue/ui-policy.test.cjs linux-blue/runtime.test.cjs linux-blue/synthetic-service.test.cjs
```

This variable locates a fixture, not an encoder. Unknown bytes fail closed. The
binary paths/hashes remain code-owned in runtime.cjs. No broad suite is needed
for this isolated addition.

## Limits / next step

This is fixture-specific lifecycle evidence, not general media fidelity,
persistent recovery, full EncoderService compatibility or release qualification.
Linux persistent-storage eligibility remains fail-closed. The Windows main,
runtime pins and qualification catalog are unchanged. Do not wire production
EncoderService's all-profile capability sweep into this service. A future
Electron demo needs sandbox/context isolation, main-owned UI selection and
sender checks; demonstrate only this synthetic scope until broader source,
storage and preservation contracts are separately implemented and reviewed.

## Review correction: owned fixture capture

Independent review found a pathname-swap gap: hashing an external fixture did
not bind later child reads. The service now captures its verified bytes via a
bounded 1MiB+1 descriptor read with O_NOFOLLOW and identity checks, exclusively
writes a mode0400 copy inside its private owned directory, and gives children
only that owned pathname. It never modifies the caller's source. A regression
replaces the caller's file after capture and proves execution remains on the
verified captured bytes. Original receipts remain as historical evidence.

Latest focused result: **23/23 pass**, zero skips/failures, receipt
`../evidence/local-service-bounded-capture-tests.tap`. Independent final review closed this finding for the narrow main-owned
synthetic scope. This is not arbitrary-media support, protection against a
hostile process running as the same user, or authority for open/reveal output
actions. Those remain separate contracts. Scope remains synthetic-only.
