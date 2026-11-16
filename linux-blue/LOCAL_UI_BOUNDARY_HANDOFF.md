# Local Linux UI boundary checkpoint

## Result and limits

Added a small, separate CPU-settings policy to prepare a future Linux Electron
main-process composition. Final focused suite: **98/98 passing**, zero skips
or failures, including ten UI-policy tests. Independent final review closed
the snapshot finding and reported no remaining high-risk findings. This does
not start Electron, register IPC, encode a new file, or qualify a whole app.
No dependency installation, remote publication, PC change or security setting
change was made. The prior synthetic CPU pilot remains its own evidence and
was not rerun just to refresh its timestamps.

## Files

- `linux-blue/ui-policy.cjs`: exact three-field settings DTO; CPU-only admission
  enforced independently of presentation; production preset/quality validator;
  rejects Archive recipes and tool, path, evidence or process-option fields.
- `linux-blue/ui-policy.test.cjs`: positive defaults, GPU/Archive refusal,
  unexpected fields, malformed/accessor DTOs, bounds and detached choices.
- Test receipt: sibling `evidence/local-ui-boundary-tests.tap`.

Work is isolated in `local-ui-boundary`, copied from the existing `repository`.
All 1,095 baseline files present in that directory were byte-compared against
the copy: none changed or missing before this handoff was added. The intake,
workspace, repository, old receipts and Windows main/runtime verifier remain
untouched. This is LOCAL ONLY; inherited publication wording is not evidence
that this work or the full source tree was uploaded.

## Next bounded step

Electron is not installed in this executor. No UI launch was attempted. Before
adding an opt-in Linux entry point, use an official Electron dependency and
preserve renderer sandbox/context isolation and validated sender identity.
The settings function accepts a structured-cloned DTO in main, not an arbitrary
Proxy from executable code. It deliberately cannot authorize filesystem access.
Main must own file selection, probe/color evidence, output leases and validated
no-overwrite publication. Paths, subprocess arguments and capabilities must
never come from renderer settings. CPU choices are explicitly unqualified;
choices alone are not executable capability proof.

Do not simply reuse EncoderService's default capability sweep: it probes all
profiles including hardware/Archive. Supply a bounded CPU-only check before
connecting the Linux UI; do not disable Linux StorageEligibility refusal for
persistent reuse. Do not import this helper into the Windows production path.
No Windows/GPU/full-service/storage/packaging/release claim is made.

## Reproduce focused tests

```sh
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs linux-blue/runtime.test.cjs linux-blue/ui-policy.test.cjs
```

## Independent review correction

A reviewer found that the initial policy checked descriptors but reread caller
properties, allowing an in-process Proxy to switch CPU to GPU between reads.
This was not a demonstrated structured-clone renderer exploit, but violated
the helper's own boundary. The corrected helper captures each data descriptor
once into a frozen plain snapshot; both CPU admission and production validation
consume that same snapshot. Two regression tests cover the original GPU switch
and exactly-once descriptor capture with property reads prohibited.

Earlier post-fix focused suite: **96/96 pass**, zero failures/skips. Receipt:
`../evidence/local-ui-boundary-reviewed-tests.tap` relative to this checkout.
The earlier 94/94 pre-review receipt is retained. No remote or PC action occurred.

Review coverage also includes null-prototype DTOs, non-default CPU values,
minimum/maximum and out-of-range quality plus wrong types for all three CPU
profiles, including AV1. Final expanded suite: **98/98 pass**, zero skips or
failures, in `../evidence/local-ui-boundary-final-tests.tap`.
Arbitrary Proxy reflection traps can execute caller code: this helper expects
structured-cloned data, not executable objects, and is not an object sandbox.
