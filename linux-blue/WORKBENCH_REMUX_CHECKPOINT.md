# Execution Summary: 2026-11-16 — Bounded Linux workbench remux

## 1. Task Overview

Continue the actual v0.7 workbench, preserving its existing design and shared
service. Establish a small useful CPU remux path, not a parallel application.
Ahmed authorized local development and eligible private synchronization. PBS 1.1
and the adopted Git workflow apply. Windows, its benchmark campaign and deferred
HDR remain untouched; this does not close Windows Q2j or accept a release.

## 2. Context Used

Started from local `346ab78875a62fd0fb559384aabbcac3691a95bc` and the CPU
[checkpoint](WORKBENCH_CPU_CHECKPOINT.md). The remote README was independently
updated at `b6882964187599feb31caf3f9a95a7fe6938b9c2`; do not overwrite it with
the stale local README. Read the actual remux workspace, operation controls,
observer, storage, evidence collector, validator and relevant tests.

## 3. Work Performed

Added `workbench-remux.cjs`, its tests and generated-media smoke. Composed the
existing `RemuxOperations`, `OperationRuntimeObserver` and `openEvidenceStorage`
behind the original workbench service and original Remux tab. No Windows catalog,
HDR or other changed-encode policy is imported. Existing native container admission,
source-derived budgets, diagnostic persistence, complete packet-identity evidence,
strict output validation and no-overwrite publication remain in charge.

The local preview admits only `.mp4` plus ISOBMFF inspection, Full → Matroska,
exactly one H.264 SDR video with **no audio**, chapters or omissions, and distinct
folders. Shared guards retain progressive 8-bit BT.709, geometry/orientation and
rate checks. Additional ceilings are 60 seconds and 128 MiB. The existing shared
geometry/rate ceilings are at most 1920×1080 pixels and 60 fps. These are admission
ceilings, **not demonstrated full-envelope coverage**. MOV, other targets, audio,
subtitles, attachments, transformations and same-folder publication remain refused.

Runtime identity now uses the observer's exact ordered size/hash pair format,
consistently across policies and service. This is not relabeling earlier evidence.
The dedicated main-only runner preserves binary stdout/FD3 sinks, caller budgets,
cancellation and both child observers. Ordinary CPU runner limits stay unchanged.
Copy calls require terminal progress as well as exit zero. Each observed remux
child has a positive limit no greater than ten minutes; existing source-derived
job, storage and stall accounting remains active. Verification may own two children;
ordinary CPU encoding still owns one.

## 4. Commands / Tools Used

```sh
node --test linux-blue/workbench-remux.test.cjs linux-blue/workbench-service.test.cjs linux-blue/workbench-execution.test.cjs tests/operation-runtime.test.cjs tests/operation-storage.test.cjs tests/remux-service.test.cjs tests/remux-operation.test.cjs
node linux-blue/workbench-remux-smoke.cjs
node linux-blue/workbench-execution-smoke.cjs
node linux-blue/workbench-smoke.cjs
```

Native launch: `electron linux-blue/workbench-main.cjs` with the already reviewed
Electron. No install, credential, OS permission or runtime-binary change occurred.
The original `npm start` is still the Windows launcher.

## 5. Verification / Testing

Selected regression: **157 tests passed, zero failed/skipped**, including 19 Linux
workbench tests. This is not `npm test` or a green full-project claim. The earlier
inherited fake-encoder inode-reuse fixture issue remains documented and unchanged.

The remux smoke generates one second of 320×180/30 fps H.264 SDR video, then uses
the actual workbench service. Its strict existing packet-identity verifier passed;
a separate full output decode also passed. Positive source bytes stayed unchanged.
Evidence-stage cancellation drained children and a freshly prepared retry passed.
Changed-source and tampered-output cases refused publication; an existing output
was preserved. A competitor created after copy won publication while the validated
completed stage remained retained. **46/46 children closed, maximum two, zero live.**

The verifier's precise claim is complete compressed-packet identity/timeline,
validated headers and start/end decode, **not complete interior-video decoding**.
The smoke's extra full output decode is evidence, not a newly installed always-on
production validator. There is no audio proof in this video-only preview.

Ordinary three-codec CPU smoke reran successfully: **81/81 children closed, max
one**. Inspection/settings/refusal smoke passed: **35/35 closed, max one**.
Native original UI: Remux → Prepare → Start → Succeeded; Show in folder opened
Thunar with `synthetic_Remux-MKV.mkv` selected. Clean exit zero, **39/39 children
closed, maximum two, zero live, zero closure failures**. Output: 91274 bytes,
SHA256 `587e90588234f3d7d49b5ff09ab3c76e81116d6901fd982bed9992a8c082f032`.
Native cancellation latency and OS playback were not tested.

## 6. Problems Encountered

The first prospective run stopped before copying because Node reported the system
executables' high-bit Linux overlay inodes as negative signed-64 values. Python
reported the corresponding unsigned values; held-descriptor and path stats agreed.
The shared observer had required a positive inode on every platform.

A minimal **local-only** correction in `src/operation-runtime.cjs` accepts bounded
negative signed-64, nonzero inode values only on Linux. Raw values remain exact in
all comparisons. Windows keeps its positive-inode rule; file kind, single link,
path/handle stamps and hashes are unchanged. Tests cover the actual pair, zero,
out-of-range negative values and changed inode refusal. No filesystem monkeypatch
is installed in product code. Windows itself was not run or qualified.

The second campaign passed the media and refusal cases but its harness incorrectly
expected a publication collision to be `failed`. Existing service semantics are
`skipped` with retained completed output. Correcting that assertion did not change
product logic. Both failed receipts are retained. The third prospective result was
reviewed before route enablement; the fourth repeats through the wired workbench.

The unchanged renderer still says “Show-in-folder request sent to Windows” after
successful Linux reveal. That cosmetic portability issue remains tracked. Native
D-Bus/SSL diagnostics are retained, not treated as an isolation attestation.

## 7. Documentation Impact

This report supersedes the CPU checkpoint's blanket local remux refusal, but only
for the narrow preview above. It does not supersede historical test outcomes,
Windows roadmap status, source-transfer restrictions or the broader roadmap.

## 8. Git / Version Control Impact

Local checkpoint includes the seven eligible Linux files plus the small shared
observer edit. **Only the seven Linux files are eligible for this publication.**
They are independently authored paths absent from both older restricted manifests.
No shared source, old payload, historical documentation, raw evidence, media,
binary, credential, private Planning or complete local Git ancestry is uploaded.

The remote still lacks the local versions of `src/remux-operation.cjs` and
`src/remux-native-cues.cjs`, and the new local observer correction is also withheld.
The composition checks exact SHA256 pins for all three. **On the current older
remote dependency bytes, remux deliberately remains unavailable; ordinary CPU
encoding remains available.** This is not full remote source parity or fresh-clone
remux proof. It does not promise startup with physically missing or broken required
modules; the hash gate addresses nonmatching otherwise loadable dependencies.
Do not copy, rewrite or transfer the withheld files to bypass the prior review.

Raw receipts and generated media remain local under ignored artifacts/evidence;
the observer correction is preserved only by local Git in this checkpoint. That
specific off-machine backup gap remains open. Final local/remote SHAs and exact
remote-tree verification belong in the completion receipt. Preserve the owner's
recovery upload and newer README with a fresh-tip non-force update.

## 9. Decisions Made During Execution

Reuse the complete existing ownership and verifier rather than replace them with
an FFmpeg exit-code check. Adapt the demonstrated Linux inode representation
minimally and visibly, without weakening Windows behavior. Keep the remote gate
closed instead of pretending unmatched source is qualified. Bind the preview
policy to reviewed prospective receipt `workbench-remux-2JIh4F`, not Windows
FFmpeg 9.0.2 evidence or a generic future promise. This host remains Linux 7.1.5
with pinned executables but host-provided dynamic libraries.

## 10. Items That Need Human / Coordinator Review

Independent composition/evidence review passed the bounded local route. Future
source parity must use a legitimate approved route for the three withheld shared
files; this checkpoint does not attempt one. No ordinary owner decision is needed
for unrelated local work. Broader audio/container coverage, any-length/4K work,
hardware qualification, packaging/licensing and release acceptance remain open.

## 11. Current Result

The actual original Linux workbench can locally perform this bounded video-only
MP4-to-MKV remux, preserve source/output safety and reveal its validated output.
The eligible composition/tests are synchronizable, but the remote copy correctly
refuses remux with its unmatched dependencies. CPU encoding continues to work.

Receipts: `workbench-remux-real-1.json` through `-4.json`,
`workbench-remux-regression-1.tap`, `workbench-cpu-after-remux.json`,
`workbench-inspection-after-remux-final.json`, `workbench-remux-desktop-1.txt`.
The final remux receipt owns the wired-service result; earlier failures stay failed.

## 12. Recommended Next Step

Continue useful local roadmap work, first a bounded retained-AAC remux proof or
selected ordinary CPU geometry/10-bit coverage, while tracking legitimate source
parity separately. Broaden policies only after actual preservation/refusal evidence
and proportionate review. Do not declare audio, MOV/MP4 output, long files, Windows,
GPU, HDR, all v0.7, packaging or release accepted from this checkpoint.
