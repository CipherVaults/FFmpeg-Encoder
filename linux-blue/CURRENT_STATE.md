# Current state: AAC reader compatibility

Checkpoint 037 cutoff: 2026-11-18T06:38:06.365588+00:00. Evidence-only; both diagnostic reconciliations complete, commit and preservation pending. No production/test/guard/default/runtime policy changes. Checkpoint 036 remains fully preserved at local `10d2c65`, remote `7d973243`, with 621 files.

## What is now established

| Evidence | Result | Limit |
|---|---|---|
| Ordinary H.265/copied AAC output | Original decoded content survives after an exposed 1,024-sample prefix | Whole audio is not identical; timestamp-only flags did not fix it |
| System 7.1.5 reading saved candidate 9.0.2 output | Two closed children; initial_padding 1024 but no packet skip; 385,024 decoded samples | Rejects writer-only inference; no exact binary root-cause or player claim |
| Candidate 9.0.2 reading ordinary output | Three closed children; padding 0/no skip; 385,024 output versus 384,000 same-decoder source samples | Complete source is an exact suffix after 1,024 samples; no whole-audio identity |
| Cross-decoder source control | Equal counts but different float32 bytes | Do not compare hashes across decoders as though they were the same representation |
| Historical remux/trim policy | Verified scoped decisions and surviving assertions | Does not automatically authorize ordinary encode/AAC-copy acceptance or refusal |

All five diagnostic children closed with empty stderr. No new compressed media, muxing, video decode, install or default change was performed. Prior ordinary warnings and finite proof limits remain. The initially reviewed admission guard is isolated and policy-held.

Retained candidate source and upstream n7.1.5 demux differences are a causal candidate, not verified installed Debian source/binary proof. No subjective audibility, lip-sync defect, generic player compatibility, Windows or general fidelity qualification follows. Existing 298/298 Linux, 229/229 protection and 42/42 focused tests are inherited, not rerun or summed.

Next: preserve the evidence and investigate ordinary cancellation/recovery with isolated file-only real-factory/runner coverage over an inert child boundary; this work is assigned only, with no result at cutoff. Decide a proportionate audio product response without silently upgrading runtime, integrating refusal, re-encoding audio or treating historical remux rules as ordinary policy. Keep the working Full-copy producer identities and existing defaults unchanged.
