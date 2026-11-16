# Execution Summary: 2026-11-16 — Real-service candidate trim lifecycle

## 1. Task Overview

Qualify successful trim publication, cancellation and fresh preparation through
the real EncoderService using the separate corrected Linux runtime. Do not
activate the candidate in either app entry or claim general trim support.

## 2. Context Used

Local base `c9761cfa80e27c7f24719cb49166a9622b9e2071` and the retained
`flac-candidate-QY90Bo` calibration. Its exact report SHA256 is
`da672b3b433d5b0be835c6743b4af677292cd190788f612e21d3ce8172415de1`.
The source copy is verified by full SHA256, then given its own fresh filesystem
identity. Original-source identity is never transplanted to the copy.

## 3. Work Performed

Added a developer-only composition and smoke/test files. Reused EncoderService,
the genuine OperationFamilySelector, runtime observer, evidence storage,
telemetry, complete-source checks, output validation and normal publication.
A restrictive wrapper admits only the copied calibrated source/probe and three
measured requests. It delegates private token issuance and validation; it does
not manufacture tokens or grant the broader 1080p/60fps/resize family. Per-job
deadline remains 120 seconds, matching the candidate runner. Default storage
checks and original application composition remain unchanged.

## 4. Commands / Tools Used

`node linux-blue/workbench-trim-candidate-smoke.cjs` and `node --test`
on `workbench-trim-candidate.test.cjs`, `runtime-candidate.test.cjs` and
`workbench-service.test.cjs` under `linux-blue/`; syntax and diff checks.

## 5. Verification / Testing

**19 selected tests passed, zero failures/skips.** Final real run
`trim-service-candidate-vVVBUN`: **six cases passed, exit 0, 94/94 children
closed, maximum one live, zero remaining**.

- Published 0–0.5s, 1.013–3.087s and open-ended 2s trims: respectively 15/62/60
  decoded output frames and 24,000/99,552/96,000 exact PCM samples per channel.
  Selected PCM hashes/bytes match; telemetry passes; every complete source has
  120 frames and 192,000 samples per channel. Outputs fully decode and carry
  normal generated-output provenance; source hashes remain unchanged.
- Cancelled only after nonterminal encoded-frame progress while a child was
  live. No destination was published. Shared cleanup deliberately retained the
  unsealed, never-identity-bound partial stage and reported that disposition.
- A freshly prepared open-ended job succeeded after cancellation.
- A destination introduced after preparation but before encoding was preserved;
  no encoder started for that collision. This is not a publication-time race test.
- An unmeasured range was unsupported and could not start. Unit negatives cover
  source/probe changes, resize, audio mode, wrong settings and forged tokens.

## 6. Problems Encountered

Preserved failures: one unit fixture omitted planId; the first real run put
per-file range/audio fields in batch defaults (32/32 children closed, no encode);
the second run wrongly expected cancellation to remove an unbound partial stage
(70/70 children closed). Corrected callers/assertions, not shared guards. Pre-run
review also corrected the expected success label and ensured closure failure
demotes the report. Failed receipts remain failed.

## 7. Documentation Impact

This checkpoint owns the bounded service evidence. The existing session
continuation and Current State pointer are updated locally, not duplicated here.

## 8. Git / Version Control Impact

Eligible new scope is this checkpoint plus `workbench-trim-candidate.cjs`,
`workbench-trim-candidate-smoke.cjs` and `workbench-trim-candidate.test.cjs`.
No earlier denied/uncertain material, shared modules, binaries or raw receipts
are transferred. Local session/current updates are outside that upload slice.

**Not a self-contained fresh-clone runner:** the exact local calibration report,
synthetic fixture, separately built candidate executables and reviewed local
`src/operation-runtime.cjs` bytes are required. Missing dependencies refuse;
they are not silently downloaded, substituted or granted by this checkpoint.
See [runtime candidate](RUNTIME_CANDIDATE_CHECKPOINT.md) for build limitations.

## 9. Decisions Made During Execution

Keep the service proof fixture-only until broader evidence exists. Preserve
safety-retained partial files rather than deleting unknown objects to satisfy a
test. Use real per-file draft APIs and repeat preparation after cancellation.

## 10. Items That Need Human / Coordinator Review

Independent code/receipt review applies to this bounded result. Broader media,
any-length trim/resize, UI activation and runtime promotion remain separate.
Prior source publication restrictions and original Windows boundaries still apply.

## 11. Current Result

Actual-service success, active cancellation, post-cancel restart and pre-encode
collision are demonstrated for the calibrated synthetic CPU requests. This is
not general-file, any-duration, 4K/1440p resize, GPU, Windows or release proof.
The current application still uses its 7.1.5 baseline.

## 12. Recommended Next Step

Align with the reviewed full 0.7 plan and extend real functional qualification
toward varied source families and critical trim/resize targets, testing both
false acceptance and false refusal. Do not replay this proof merely for a newer
timestamp or treat the developer-only fixture gate as the product's final scope.
