# Execution Summary: 2026-11-16 — CPU encoding in the original workbench

## 1. Task Overview

Continue Ahmed's authorized Linux work from the inspection-only workbench:
explain the source-identity discrepancy, exercise actual ordinary CPU execution,
then enable only the demonstrated existing route. Preserve the Windows project,
shared design, safety checks and private synchronization boundaries. PBS 1.1 and
the adopted Git workflow apply. This is experimental functionality, not release
or owner acceptance and not completion of the v0.7 roadmap.

## 2. Context Used

Started from local `0f82455c4a77a04ee76b45d8dbcf3c3cdc232982` and published
`d0b3ccaf603689c8c078bf48d81cc436623ad96f`. Read the shared service execution,
source identity, ordinary operation contract, publication fallback, output access
and relevant tests. The [previous checkpoint](WORKBENCH_PREVIEW_CHECKPOINT.md)
records unchanged dependency reuse and the still-open remux source differences.

## 3. Work Performed

Updated the four existing workbench entry/service/unit/smoke files. Added an
execution smoke, deterministic held-source regression and this report. No original
main/preload/UI/shared source file was edited or republished.

The main-owned service now permits Start only for every selected entry's existing
ordinary compatibility plan: CPU, inspected SDR, Full range, Keep source geometry,
Matroska, copied audio, no omissions and distinct input/output folders. Native,
GPU, HDR, remux, preservation-selection and changed/instrumented routes remain
refused. Superclass shape, stale-plan, source and selection validation still runs.

The ordinary service's `timeoutMs:0` request is accepted only for the identified
CPU encode invocation with progress, and explicitly becomes a **30-minute maximum
per file**. Other zero/unbounded requests stay refused. Encoding must close with
exit zero and terminal progress; exit zero alone is not success. The title names
the Linux CPU/Full SDR scope and time limit. Cancellation still owns the process
until close. The existing OutputAccess component validates published-output grants
before Electron's open/reveal APIs; no renderer-supplied path is dispatched.

## 4. Commands / Tools Used

```sh
node --test linux-blue/workbench-service.test.cjs linux-blue/workbench-execution.test.cjs
node linux-blue/workbench-execution-smoke.cjs
node linux-blue/workbench-smoke.cjs
node --test linux-blue/workbench-service.test.cjs linux-blue/workbench-execution.test.cjs tests/encoder-service.test.cjs tests/outputs.test.cjs tests/completed-output-retention.test.cjs tests/process-runner.test.cjs tests/output-access.test.cjs tests/ipc.test.cjs
```

Launch with the reviewed installed Electron: `electron linux-blue/workbench-main.cjs`.
The original `npm start` remains Windows-specific. No dependencies, credentials,
permissions, runtime pins or system settings changed.

## 5. Verification / Testing

Focused final suite: **12 pass, zero failures**. Relevant shared regression:
**220 total, 219 pass, one inherited failure, zero skips**. This is not a green
full suite or `npm test`. The failing test is explained below, not suppressed.
Existing publication tests passed, including forced unsupported-link/exclusive-copy
fallback, full-copy verification, collision protection, cancellation and uncertain
destinations. These are primitive tests, not a second real filesystem qualification.

Real shared-service campaign passed:

- H.264, H.265 and AV1 CPU at their unchanged defaults encoded a generated
  12-frame, 320×180, 30 fps, 8-bit BT.709 source. Each output had the expected codec,
  geometry, frame count and provenance marker, fully decoded and matched the
  source's copied-audio payload hash. Separate earlier capability checks cover
  8/10-bit startup availability; this ordinary-service corpus is **8-bit only**.
- Cancellation requested at encode-child registration closed the child, left no
  final output, and a freshly prepared retry succeeded. This is not a measured
  mid-progress cancellation-latency claim.
- A deliberate source change after preparation stopped before an encode child.
  An existing output stayed untouched with no encode. A competitor created after
  encoding won publication, and the completed validated stage remained retained.
- A source moved away after successful encoding produced `SOURCE_CHECK_INCOMPLETE`
  and retained the completed result without publication. A per-file range request
  remained unqualified and could not start. Synthetic mutation cases restored the
  known source bytes; positive cases left them unchanged.
- **81 spawned / 81 closed, max one, zero live**, including generation, capability
  checks and independent validation. Seven were ordinary encode attempts.

Native UI: original Prepare → Start → Succeeded for H.265, with the saved light
theme. Show in folder opened Thunar with `synthetic_H265-CPU.mkv` selected. Window
closed with exit zero, **33/33 children closed, max one, zero live**. Output was
57238 bytes, SHA256 `1f91b4c689d751630d3b6662e907d78a559e6358fa72811699e9c5032b451166`.
OS playback/Open output was not tested. Raw receipts remain local under the
experiment evidence directory: `workbench-execution-unit-final.tap`,
`workbench-execution-regression-1.tap`, `workbench-execution-real-2.json`,
`workbench-execution-desktop-1.txt` and `workbench-inspection-after-execution.json`.

## 6. Problems Encountered

The inherited missing-source fake-encoder test unlinks its source **before**
creating the output. A read-only test observer recorded immediate Linux reuse of
the original device/inode for the new output, with a different birth time. The
existing reserved `dev:ino` protection correctly refuses this earlier as
`PROTECTED_SOURCE`, before the expected missing-source completion check. The
observer receipt is retained; production guards and the inherited test are intact.

The new independent regression keeps a read descriptor open across unlink and
output creation. This prevents fixture inode recycling and proves the intended
`SOURCE_CHECK_INCOMPLETE`/retained-completed/no-publication behavior deterministically.
The real campaign also reaches that branch without fake inode reuse.

First execution smoke reached eight positive/refusal cases, then failed because
the harness incorrectly supplied range as a batch-default field. The original
contract refused it. The harness was corrected to use the existing per-file API;
no product validation was weakened. Its failed receipt remains, with 77/77
children closed. The second run owns the complete passing result.

One inherited cosmetic message says “Show-in-folder request sent to Windows” even
though Linux reveal succeeds. It is in the unchanged renderer and remains a
tracked portability wording item. Existing D-Bus/SSL native diagnostics are kept;
no network isolation attestation is inferred from a successful UI run.

## 7. Documentation Impact

This report supersedes the preview's temporary Start gate, not its historical
test record. README maintenance must start from the newer remote README and
preserve the owner's recovery-kit documentation; the stale local root README
must not replace it. HDR remains deferred and no Windows roadmap state is closed.

## 8. Git / Version Control Impact

One coherent seven-file Linux-only checkpoint: four workbench updates plus
`workbench-execution.test.cjs`, `workbench-execution-smoke.cjs` and this report.
All are independently authored paths absent from both earlier denied/uncertain
manifests. No old payload, raw receipt, generated media, binary, private Planning,
credential or complete local history is transferred. Use the same authorized
connector, verified private fork and current-tip non-force update. Preserve every
other remote blob, including the owner's recovery upload and newer README.

Exact local/remote commits and blob readback belong in the completion receipt.
The runtime is present through the owner's upload; the two older remote remux
dependencies remain unsynchronized and unused by this route. This is not full
project/PC backup or a fresh-clone execution claim. Raw evidence and media remain
local; the source smoke is published so a matching reviewed host can regenerate it.

## 9. Decisions Made During Execution

Treat the inherited failure as a test-fixture/platform identity interaction, not
permission to weaken a source guard. Reuse the original service, plans and
publication instead of creating another queue/output framework. Bound the formerly
unlimited encode explicitly. Preserve the distinct-folder verified-copy fallback
and its uncertainty states rather than claiming all publication is atomic.

## 10. Items That Need Human / Coordinator Review

Independent source/evidence review passed the bounded CPU route; final report and
publication verification are recorded at completion. No routine owner input is
needed. Full release qualification, hardware testing, packaging/licensing and
owner acceptance remain separate. Shared renderer wording needs a reviewed
platform-neutral fix in a later source-sync-safe change, not concealed rewriting.

## 11. Current Result

The actual original workbench can now encode ordinary SDR CPU jobs and save
verified outputs on this reviewed Linux host. Existing ordinary validation checks
metadata/stream structure and bounded sparse source identity. Full output decode
and audio hashing above are **smoke evidence**, not a newly installed always-on
content-preservation verifier. This corpus is not universal source fidelity,
malicious-media isolation, any-length/4K qualification, GPU/Windows proof or release.
Same-folder reuse, changed operations, remux and HDR remain unavailable here.

## 12. Recommended Next Step

Continue a bounded shared-workbench milestone from the reconciled roadmap. Before
enabling CPU remux, resolve its current source and runtime-qualified admission/
evidence controls explicitly; do not import Windows runtime catalogs or declare
Q2j closed. Keep original design and settings, preserve refused/uncertain results,
and test proportionately. Maintain eligible sync without retrying denied material.
