# Executed proportional service resource tests

## Change and evidence

Added only `tests/operation-proportional-service.test.cjs`, SHA-256 `13144c8648ddae8efa86a780cf15dbc7fb44329199daa3cf3c983006db7069f8`. No production source, catalog, report, runtime pin or default changed.

The test runs the real EncoderService, OperationFamilySelector, OperationRuntimeObserver, evidence-storage implementation and telemetry parser against temporary synthetic source/tool files. Tool execution is replaced with EventEmitter children that close in `finally`; no executable or media processing is launched. Synthetic metadata/qualification fixtures are testing inputs, not measured qualification.

Final evidence:
- `20261117T143159Z_proportional-service-cleanup`: 8/8 passed.
- `20261117T143201Z_proportional-service-cleanup-regression`: 55/55 storage/telemetry/service checks passed.
- Independent repeat of final test file: 8/8 passed, no skips or cancellations.
- Before cleanup-only refinement: `20261117T143035Z_proportional-service-reviewed` passed 20/20 core-plus-service; `20261117T143047Z_proportional-service-regression` passed 55/55. These earlier results identify earlier test bytes, not the final hash.

Parent checkpoint 003 is already preserved: local `f4db4ac8e7a88f2fca9c25fc974a43c682f652a9`, verified GitHub `5d3a636`, with the intervening Notion restoration verified. This new test has not thereby been committed, mirrored or pushed. A later receipt owns its publication identity.

## What the tests establish

Real service preparation and Start carry source-derived resources into actual storage admission and telemetry collection. A 0.5-second selection supplies 1280 records per stream, below the former 20000 default; a 75-second selection supplies 20224, above it. The video stream accepts exactly its derived count and refuses the first excess row at both scales. The audio stream has one synthetic row, so this is not an independently exhausted audio-limit test.

A sparse telemetry file whose logical size exceeds the derived byte ceiling is rejected with `TELEMETRY_PATH`; this proves the real file-size guard, not streaming byte-counter exhaustion. An injected stdout count at the aggregate pipe limit followed by one stderr byte produces `OPERATION_PIPE_LIMIT`. Existing retained-storage pressure refuses the derived reservation before encoding. Invalidating the genuine selector before Start prevents reservation and encoding.

Every case ends failed rather than published. Successful telemetry cases deliberately reach the unchanged collector-policy refusal after a fake encode and output probe; they are not successful complete operations. Assertions check source bytes remain unchanged, no published MKV exists, fake active-child count returns to zero, and expected child counts/reason codes hold.

## Corrections and limits

Early fixture failures were retained: 0/5 from numeric rather than exact-string source size; 7/8 from a missing invalidation diagnostic; 19/20 from an incorrect expected reason code. These were test-fixture corrections, not production fixes.

The first setup failures exposed late cleanup registration and left five small temporary fixture directories, as reported during integration. Final cleanup is registered immediately after directory creation, conditionally closes owned resources and checks the exact original directory before removal. The five earlier directories were individually verified against their exact fixture inventories and bytes, then removed. Independent final execution passed. A failure in a close operation can still stop later cleanup; this is fail-safe retention, not a universal no-leak guarantee.

No timing-expiry, cancellation-drainage, decoded-evidence aggregate exhaustion, real operating-system child drainage, media fidelity, UI, GPU or native Windows claim is made. The telemetry routing gap is now supported by executed synthetic integration, but collection and activation remain separate unfinished work. Actual production factories remain closed by their unchanged report/source/runtime gates. Collector refusal remains post-encode, not a universal pre-encode guard.

Next: preserve this test checkpoint, then separately design and test the genuine selection/plan/source/budget collector binding and an output-independent pre-encode policy check. Do not open existing gates or substitute fixtures for missing reports.
