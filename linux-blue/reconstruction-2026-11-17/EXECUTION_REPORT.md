# Surviving-source reconstruction and ordinary CPU verification

Date: November 17, 2026. Source: `f6bc64aa4afd84377e732188da6c7d5ce3bf0680` from the private Linux development fork. Platform: Linux x86_64, Node `v24.22.1`.

## Claim and scope

Establish an honestly identified, usable ordinary CPU baseline from surviving source while preserving missing-work and qualification boundaries. This milestone changes no application bytes. It reconstructs source, runs proportionate checks, records failures, and prepares a narrowly reviewed restorable checkpoint.

The remote tree listed 864 blobs. Of these, 630 were reused from the verified Windows snapshot only after Git-blob equality proved identical bytes; 233 additional blobs were restored from read-only source responses. All 863 present blobs were checked for byte count, Git blob SHA-1 and SHA-256. The source bytes were checked again after the tests and real service exercise, with zero changes.

The missing file is `assets/app-icon/candidates-2026-10-29/logo-comparison-2026-10-29.png`, expected 2,050,576 bytes and Git blob `630c7841948d4bb437c5d8118c95ddab0aad42ae`. The initial response supplied empty content. Integrity validation stopped before writing that batch; the verified files were subsequently restored without this image. No placeholder was substituted. It is a historical comparison image, not the active application icon.

## Independent recovery-kit check

Before full assembly, the verified November 16 CPU recovery kit ran:

```text
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs linux-blue/runtime.test.cjs
```

Result: 88 passed, zero failures/skips/cancellations, exit 0. All 13 manifest-listed kit files remained unchanged. This is a separate source scope, not part of the application regression total. The first attempted invocation failed output redirection before tests began because of an incorrect working directory; that setup failure is retained separately. Correcting the directory did not change product code.

## Reconstructed application checks

The project's `evidence-run` wrapper retained immutable stdout, stderr, exit status, counts and tested/covered file hashes. These runs preceded Git initialization; their empty HEAD fields do not imply a clean committed checkout. Source identity is supplied by the exact reconstruction manifest and post-run revalidation instead.

| Receipt | Outcome | Scope |
| --- | --- | --- |
| `20261117T133041Z_reconstruction-baseline-components` | 78 passed, 0 failed, 0 skipped; exit 0 | Runtime/IPC/UI policy/source inspection/output preflight/workbench service/execution and resource-budget components |
| `20261117T133100Z_reconstruction-linux-regression` | 147 passed, 30 failed, 0 skipped of 177; exit 1 | Every surviving `linux-blue/*.test.cjs`, including tests dependent on missing environment artifacts |

The raw receipts remain under `artifacts/v0.7/evidence/`. Compact source-bound receipts are included in [evidence-receipts.json](evidence-receipts.json); raw diagnostic histories and generated fixtures are not included in this initial source archive. Counts from different runs must not be summed as a single regression result.

### Broad-regression failures retained

| Cause | Failed tests | Disposition |
| --- | ---: | --- |
| Missing prior synthetic fixture/environment input | 4 | Fresh fixture needed before that separate service campaign |
| Missing custom FFmpeg 9.0.2 runtime | 8 | Not recovered or silently replaced with baseline runtime |
| Missing historical calibration/service reports | 13 | Not fabricated or replaced with lookalike receipts |
| Shared legacy family schema cannot accept proportional family | 1 | Source integration incomplete |
| Historical pre-activation static assertion conflicts with later composition | 1 | Test expectation needs review against current intended boundary |
| Remux source-digest gate detects missing reviewed dependency bytes | 1 | Gate remains closed |
| Linux signed inode representation rejected by shared observer | 2 | Demonstrated bounded platform defect for next change |

The failure classification does not turn the run green. Missing reports, missing runtime and incompatible source are distinct blockers; solving one does not qualify the others.

## Actual ordinary CPU service exercise

Command:

```text
node linux-blue/workbench-execution-smoke.cjs
```

This script creates and owns its own synthetic media and isolated state/output directories. It uses the fixed baseline `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` through their existing verification boundary. No personal source, Windows checkout or existing output was used.

- H.264, H.265 and AV1: each successful, 12 frames, full decode and copied-audio hash verified.
- Cancellation at encode-child spawn followed by retry: passed.
- Changed input before Start: refused.
- Existing output: preserved.
- Competitor appearing during publication: preserved, validated completed work retained rather than overwritten.
- Source disappearing after valid completion: source assessment incomplete, output not incorrectly published.
- Unsupported changed-operation request: refused.
- Census: 81 children spawned, 81 closed, 0 live, maximum concurrency 1; seven encode children.
- Generated source SHA-256 remained `abac001d744f2b5557cb6ae71e6f20bd633cf4a68fc1905b694e5d17cd7beb64`.

The script exited 0. Its report is retained at `linux-blue/artifacts/workbench-execution-Bq05a1/report.json`; the execution log and supplemental source-binding receipt are retained under `artifacts/v0.7/evidence/20261117T133250Z_reconstruction-ordinary-cpu/`. The supplemental receipt SHA-256 is `ce13dd7753307f4c895254e560ea8901c7577da06f7a84ee78fa51dff863ae7c`.

## Security and platform limits

The source-level review checked the relevant runtime, file-identity, source-digest, admission, process and publication boundaries. No Security Cloud scan was run, and this is not a claim of an exhaustive repository security audit. Failed dependency gates were preserved rather than weakened. The renderer/preload design, main-owned tool selection and no-overwrite publication were not changed.

This result is bounded generated-media ordinary CPU evidence. It is not general fidelity acceptance; custom 9.0.2 runtime qualification; trim/resize family acceptance; active-frame cancellation proof; real GPU qualification; native Windows testing; visible Electron UI testing; clean-machine packaging; or release acceptance.

## Checkpoint and continuation

The initial staged-tree whitespace check reported six inherited whitespace diagnostics in three unchanged source/notice files: `resources/third-party/FFmpeg-README.txt`, `scripts/v07-remux-long-fixtures.cjs` and `tests/ui-vendor.test.cjs`. They were retained to preserve exact checkpoint bytes, not silently normalized. This is not a clean whitespace-check claim; new reconstruction records are checked separately.

The first selected checkpoint will include reviewed application source and new PBS records only. Its source manifest and an external publication receipt distinguish the committed tree from excluded history and locally retained raw evidence. An archive upload is not a verified backup until download and restoration match the committed tree. GitHub remains a separate third step when permitted; a new reconstruction root must not overwrite the surviving branch history.

Next: complete the verified Notion restore, then implement and independently review the narrow Linux file-identity correction, with both positive acceptance and negative/refusal tests and no source-pin shortcut. See [Current State](CURRENT_STATE.md) and [Session Summary](SESSION_SUMMARY.md).
