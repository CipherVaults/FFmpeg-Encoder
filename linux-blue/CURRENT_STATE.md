# Current state: codec-option proof and fresh resize calibration

Cutoff: 2026-11-18 12:27:58.603495 UTC. Checkpoint 048 is prepared; its commit and external preservation are not yet claimed here.

## Current reliability
- On immutable 047, one ordinary candidate H.265 publication now empirically has no duplicate codec-option warning. CPU-mask/WPP/lookahead warnings remain. The retained f32le source/output PCM pair was independently byte-compared: 3,072,000 bytes and 384,000 samples each. This is same-reader evidence for one reused fixture, not all-player acceptance.
- Fresh E3 calibration on the same 047 source passed its three fixed cases with all 42 children closed. Its PCM claim is s16le streaming receipt equality, not retained raw PCM comparison. First full output hashes were established by the post-close audit.
- The independently reviewed two-file resize consumer refresh is integrated and source-tested. It is not a real-service result. Full-copy remains unavailable against stale producer closure; no old evidence repin or automatic default promotion.

## Next boundary
Lead tests: 72/72 focused, 229/229 protection, 330/339 explicit Linux with nine retained Full-copy failures; source-only 16 passes/3 raw-input skips. Scopes overlap. The sole removed failure is resize currentness; downstream Full-copy checks remain blocked. Preserve the checkpoint before using the refreshed consumer. The reduced service helper has arrived frozen with seven author file/injected checks; independent delta review is not yet assigned, and no binding/gate/run exists. No new native, Windows, general media or performance claim. Runtime, ordinary audio policy and thread settings are unchanged.
