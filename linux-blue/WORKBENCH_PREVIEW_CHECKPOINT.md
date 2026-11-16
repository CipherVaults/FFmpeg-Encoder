# Execution Summary: 2026-11-16 — Original workbench on Linux

## 1. Task Overview

Port the actual FFmpeg Encoder workbench rather than treating the synthetic demo
as the product. Ahmed authorized continued private Linux development, reuse of
the Windows design and applicable v0.7 work, and routine reviewed synchronization.
This bounded checkpoint enables inspection and settings, not media execution.
PBS 1.1 and the adopted Git workflow apply; implementation is not owner acceptance.

## 2. Context Used

Started from local `28d912582e2774d3a282a7ffe3c385c92d57d27b`. Read the original
main, renderer, styles, preload, IPC, protocol, EncoderService, capabilities,
inspection, settings, process runner and storage boundaries. Coordinated roadmap
reconciliation distinguishes older Human Roadmap status from later project
records: remux closure remains open, and HDR stays deferred. Existing implemented
work should be reused, not rebuilt. Windows work and its acceptance are separate.

## 3. Work Performed

Five new files only: `workbench-main.cjs`, `workbench-service.cjs`, its unit test,
`workbench-smoke.cjs`, and this report. The original six-tab UI, dark amber and
paper-light teal themes, preload, IPC sender checks, local protocol/CSP,
EncoderService, source inspection and settings stores are imported unchanged.
The title explicitly identifies an inspection/settings-only Linux preview.

The separate entry uses app-wide sandboxing, isolated local state, denied
permissions/downloads/navigation, exact original asset URLs and a single-instance
lock. It verifies the existing fixed Linux runtime before constructing the
service and again before every child. A new main-only runner retains the original
inspection capture limits and cancellation while rejecting unsupported options,
unbounded timeouts, unknown executables and GPU requests before launch. No PATH
fallback, Windows pin bypass, security-setting change or fake capability is used.

The original capability checker genuinely tests CPU encode/probe/decode at both
depths. GPU/Archive checks are explicitly refused as untested. AMD/Intel catalog
and implementation remain intact and unavailable without Linux device discovery.
No native, changed-operation, remux or HDR authority is invented. Default storage
eligibility still disallows persistent reuse and same-folder operation on Linux.
`startBatch` is explicitly refused in the main-owned service before mutation.

## 4. Commands / Tools Used

```sh
node --test linux-blue/workbench-service.test.cjs
node linux-blue/workbench-smoke.cjs
node --test linux-blue/workbench-service.test.cjs tests/capabilities.test.cjs tests/encoder-service.test.cjs tests/ipc.test.cjs tests/local-protocol.test.cjs tests/appearance.test.cjs tests/storage-eligibility.test.cjs
```

For the installed, reviewed Electron 44.7.0 executable, launch
`electron linux-blue/workbench-main.cjs` from this repository. `npm start` remains
the unchanged Windows launcher. No installation is part of this checkpoint.
This host uses Node 24.22.1 and Debian FFmpeg/FFprobe 7.1.5, Linux x64. The fixed
runtime adapter remains host-specific; dynamic libraries are not fully pinned.

## 5. Verification / Testing

- New focused suite: **9 pass, 0 fail**; rerun after the final launcher change.
- Shared regression: **175 total, 165 pass, 1 fail, 9 Windows-only skips**. This is
  deliberately not labeled a green suite or a full `npm test` result.
- Real integration: H.264/H.265/AV1 CPU each passed canonical 8/10-bit checks.
  A newly generated synthetic 320×180/30 fps SDR source prepared through the real
  service twice with fresh inspection and zero reuse. Start, unconfigured remux
  and same-folder operations were refused; settings persisted; actual active
  cancellation drained. Input hash unchanged; output folder remained empty.
  **34 spawned / 34 closed, maximum one, zero live.**
- Native GUI: original workbench opened, selected synthetic folders through
  actual dialogs, prepared/inspected the source, displayed the explicit Start
  refusal, saved the original light theme and exited 0. **30/30 closed, max one**.
  Final launcher revision then reopened in the saved light theme and exited 0:
  **28/28 closed, max one, zero live**. A checking view was visible before close,
  but this does not prove the close interrupted an active child. The separate
  integration cancellation test owns that evidence. No selected-source encoding occurred.

Raw receipts stay local: `workbench-unit-final.tap`, `workbench-regression-1.tap`,
`workbench-real-1.json`, and `workbench-desktop-1.txt` / `workbench-desktop-2.txt`
under the experiment evidence directory. The smoke script creates its own media
under ignored artifacts and retains it; it takes no personal-media input.

## 6. Problems Encountered

The inherited ordinary-execution test “a missing source after valid completion
is incomplete evidence, not a ctime warning or publication” fails on this host:
actual `PROTECTED_SOURCE`, expected `SOURCE_CHECK_INCOMPLETE`. The same unchanged
test failed in an isolated run. The test deletes its source before writing its
fake output; conservative identity protection is reached before the expected
post-validation missing-source branch. Inode reuse is a hypothesis, not yet an
established cause. No protection or expectation was weakened. Resolve this as
part of the next execution milestone; Start remains gated here.

Independent review requested explicit creation of both Electron state folders
before `setPath`; this was implemented and startup/shutdown checked again.
Existing Electron D-Bus/SSL diagnostics remain in the raw native receipts. No
network, malicious-media or crash-injection security attestation is inferred.

## 7. Documentation Impact

This report records the first original-workbench Linux composition. The synthetic
demo remains a harness. Previous checkpoint reports remain historical; their
statements that no original workbench runs no longer describe this new preview.
No Windows roadmap/default/catalog/benchmark record is rewritten.

## 8. Git / Version Control Impact

Select only these five new independent files. Their paths are absent from both
earlier denied/uncertain publication manifests; they import existing modules,
not reconstruct rejected material. Publish through the same authorized connector
to private `CipherVaults/FFmpeg-Encoder-Blue-Linux`, `blue/linux-development`, on
top of the freshly verified tip with a non-force expected-tip update. Preserve
the owner's recovery upload and newer README. Exact local/remote commit and blob
readback belong in the completion receipt, not a self-referential commit hash.

The runtime dependency is now present through the owner's recovery upload.
Original UI, service and runtime dependencies were compared with remote tree
`6c47615123ac2c7fc12968c3083b82a1d731f570`: shared source matches except line endings
and the separately captured local corrections in `remux-native-cues.cjs` and
`remux-operation.cjs`. Those remux controls are not composed here, and these older
remote files are not replaced. This is not complete source synchronization or a
fresh-clone execution claim. The original demo's external fixture requirement is
separate; this new smoke generates its own. Raw receipts, media, installed
binaries, app state and complete local history remain off the remote.

## 9. Decisions Made During Execution

Reuse authoritative capability/inspection behavior rather than a metadata-only
replacement. Keep one preparation worker and preserve actual failure reasons.
Make the first product port useful for source review and settings, while holding
media execution behind an explicit temporary gate. Do not silently translate
Windows runtime/catalog or NTFS evidence into Linux qualification.

## 10. Items That Need Human / Coordinator Review

Independent architecture and code/evidence review found no other blocking flaw;
final source/report review and publication readback are recorded at completion.
No routine owner decision is needed. General source execution, hardware support,
distribution licensing and release/owner acceptance remain distinct work.

## 11. Current Result

The actual existing application workbench now starts on Linux and performs
canonical CPU capability checks, fresh source preparation/inspection and settings
persistence. It preserves the requested design. It is intentionally not yet an
ordinary encoder/remux UI, a malicious-media sandbox certification, general
filesystem qualification, Windows/GPU proof, packaged release or complete v0.7.
The broader regression has the one explicitly retained failure above.

## 12. Recommended Next Step

Qualify ordinary CPU execution through this same service before removing Start's
gate: investigate the inherited source-identity failure, deliberately resolve
the service's unlimited encode timeout, and test source revalidation, cancellation,
validation, no-overwrite publication and retained outcomes. The ordinary service
can use a verified-copy fallback on distinct folders, unlike the atomic-only
synthetic lane; assess that distinction explicitly. Continue applicable remux and
shared roadmap work afterward, without enabling deferred HDR or claiming GPU
evidence. Do not bypass publication review or alter the original Windows project.
