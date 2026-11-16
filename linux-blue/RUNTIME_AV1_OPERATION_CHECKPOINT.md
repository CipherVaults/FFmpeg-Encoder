# AV1-pair strict operation evidence checkpoint

## Purpose and result

Continue E1/E3 of the Linux non-HDR plan without waiting on the native-window
environment blocker. The corrected three-codec pair now supports the streaming
callbacks required by the existing strict trim evidence collector. Three fresh
synthetic H.265/FLAC trim calibrations passed on this exact pair. This is a
developer-only prerequisite, not general trim/resize activation or completion.

Base local commit: `abc6134`. The preceding eligible ordinary-runtime checkpoint
is verified remotely at `b3de9dcc4f9375c9f4a202ac55734f6fd1354ee2` on
`blue/linux-development`. Earlier denied shared-source and UI changes remain
local only. Original Windows work, the baseline 7.1.5 pair and the earlier
two-codec 9.0.2 pair are unchanged.

## Implementation and authority boundary

`runtime-av1-operation.cjs` adds a fixed-pair, main-only evidence runner. It uses
the existing process runner and `verifyAv1Tool` before and after settled child
operations, including failures. Exact executable and codec-library checks,
positive bounded deadlines/capture budgets, no loader/environment override,
GPU-option refusals and child ownership remain in force. Invocation values are
copied before asynchronous verification. Streaming callbacks are observations,
not renderer capabilities. The ordinary workbench runner remains unchanged.

`workbench-av1-calibration.cjs` reuses the existing calibration implementation,
fixture, pre-encode frozen clock bounds, telemetry and independent decoded
validators. It supplies the new pair identity and runner, not the older receipt.
It neither registers a family nor changes the service/application launch route.
The 120-second child cap is a developer campaign bound, not the final product's
duration support contract. Raw process exit zero is not operation acceptance.

## Actual media evidence

Final-source report: `flac-candidate-FjjuSk/report.json`.
SHA256: `749a5eb326864f756cd663e3c1fc9bde854ea80a9b2650cc9dbe6b1d0caac53a`.
Runtime identity: `682e105c3586993d44c2c981149a5ae904713b9395cfa9cbfab48da9f903b0ae`.

| Request | Validated video frames | Exact selected/output audio samples |
| --- | ---: | ---: |
| First 0.5 seconds | 15 | 24,000 |
| Nonaligned 1.013 to 3.087 seconds | 62 | 99,552 |
| Held-out 2 seconds to source end | 60 | 96,000 |

All three strict decoded-operation validations passed, copied decoded PCM hashes
matched, outputs fully decoded, and original source bytes/identity remained
unchanged. Source inspection independently covered all 120 frames and 192,000
audio samples. The campaign closed all 34 children, maximum one and zero live.
These are four-second 720p30 synthetic source results, not long-file, resized,
AV1-output trim, VFR, hardware, native UI or quality-benchmark evidence.
Outputs are retained calibration stages, not published application results.

The same final runner and calibration entry also passed in the temporary
remote-dependency verification snapshot (`flac-candidate-zzqnC5`): all three
cases passed and 34/34 children closed. Its shared dependency files were taken
from the verified remote base used by the preceding runtime checkpoint. This
checks the published combination without claiming a fresh clone or native run.

## Verification and preserved interruption

The new runner has 13 deterministic tests covering streaming callbacks, child
observers, bounds, path/options/accessor refusal, CPU/GPU boundary, abort/failure
handling, integrity errors and invocation mutation during verification. The
final focused aggregate passed 44/44, zero failed/skipped. An actual pinned
FFmpeg progress run with a one-byte stdout limit correctly failed `OUTPUT_LIMIT`
and closed its single child.

Independent review found that the shared process runner only enforces its total
progress-output byte cap when a byte observer is supplied. The new runner now
always supplies that observer and forwards the caller's optional observer. The
earlier complete `flac-candidate-O0Ze5B` receipt is retained as pre-correction
evidence, not final bounded-runner acceptance. All three strict calibration
cases were rerun on the corrected source to the final receipt above.

The first real campaign was interrupted when the cloud environment restarted.
Its process handle disappeared, no owned calibration/FFmpeg process remained,
and partial evidence had no terminal report. `flac-candidate-gzDdjm` and its
interruption note remain retained. No successful completion or clean child
census is inferred for that attempt. The fresh run above owns the pass.

## Continuation and recovery limits

Next reuse the existing guarded trim-service composition with a fresh pair-bound
qualification and prove actual prepare/start/validate/publish, active-frame
cancellation and retry. Then broaden real source/duration/geometry families
with corresponding evidence; do not remove admission limits merely to pass.
Native launch, broader trim/resize, remote shared-source parity and packaging
remain open. No hardware or Windows result is inferred.

Only these source/test/summary files are eligible for synchronization. Binaries,
generated media, raw reports, interrupted artifacts and prior restricted source
remain excluded. This runner does not solve runtime provisioning or complete
off-machine recovery. A source checkpoint is not an accepted 0.7 release.
