# Current state: native resize evidence and codec-option cleanup

Cutoff: 2026-11-18 11:49:06.537835 UTC. Checkpoint 047 is prepared, not yet committed or externally preserved in this record.

## What works, and on which source
- Immutable 046 has one audited native H.265 range/720p/Precision FLAC publication and reveal: 63 frames / 101,184 samples supported by the named receipt/spools and streaming hash receipts; 42 owned children closed. This remains evidence of 046, not the changed codec builder.
- Four reviewed codec source/test files are now integrated. They remove overlapping global codec selection and replace each precision-audio decision exactly once. No media ran after this change, so warning removal, media equivalence or performance improvement is not yet demonstrated.
- Ordinary candidate has no producer capsule and can technically construct, but new-source media qualification remains pending. Resize and Full-copy are genuinely unavailable because their exact producer closures became stale. Do not repin historical reports. Keep720 was already stale. Selecting the baseline runtime on changed source is not a rollback to unchanged source.

## Tests and next action
Focused 118/118 and protection 229/229 pass. Explicit Linux selection fell from baseline 337/337 to 327/337 with ten failures. Independent review confirms eight direct Full-copy producer refusals, one reportClosed expectation mismatch before report opening, and one resize producer refusal. Candidate cleanup still runs; blocked downstream tests are not green. Separate historical preservation selection remains 118/139 with the same 21 failures and is not the default Linux selection. Scopes overlap.

Preserve the coherent checkpoint, then review and run the smallest fresh ordinary one-target proof. Fresh resize calibration and consumer refresh must precede resize service restoration; Full-copy restoration requires its own evidence when needed. No default, audio policy, runtime or thread-setting change. Windows and general media acceptance remain unqualified.
