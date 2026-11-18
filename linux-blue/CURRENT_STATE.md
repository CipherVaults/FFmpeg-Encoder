# Current state: Linux FFmpeg Encoder 0.7

Cutoff: 2026-11-18 05:07:37.151402 UTC. Checkpoint 035 preservation is pending.

## Current contract suite

Three independently reviewed test-only slices now separate portable current contracts from optional historical qualification. Final integrated results: affected 52/52, focused 224/224, protection 229/229 and broad 296/296, with zero skips or cancellations in those scopes. All 615 checked source files remained byte-identical through testing. Overlapping scopes are not summed.

The explicit historical-reference command still reports 43 tests: 1 pass, 9 failures and 33 prerequisite cancellations, zero skips. Original bodies remain preserved and runnable. These are neither silently passed nor automatic current-release gates. No production code, default, budget, tolerance or pin changed; Full-copy's 26 producer hashes remain exact. Green portable tests do not restore missing media or implement historical features.

## Works / unsupported / untested

| Area | Supported now | Unsupported or untested boundary |
|---|---|---|
| Developer Full 1080p30 → 720 copied AAC-LC, 48 kHz stereo | Finite calibration and normal-service publication; fresh copied-sentinel collision, active cancellation and NEW runtime/service recovery; short native publication/reveal | Not arbitrary sources/durations, same-service recovery, PCM/pixel identity, Windows or hardware qualification. Original runtime/report prerequisites remain required. |
| Ordinary ↔ Full-copy opt-in switching | Source/VM ownership tests and accepted native empty-batch journey on immutable 033 | Nonempty reset, completed output-grant revocation and direct WebContents identity are not established by empty batches. |
| Normal Quit and preparation ownership | Actual-main/IPC injected regression coverage and bounded observed native close | Held picker/action or external child may keep close pending; no forced-exit guarantee or all-active-state native proof. |
| Precise Keep 720 and range resize | Genuine implemented family/collector with retained older finite evidence | Current capsules remain closed, each with four stale producer identities; Keep additionally needs complete diagnostic evidence. Not currently requalified. |
| Historical Full precision-FLAC 1080/1440 | Resource/schema contracts and refusal boundaries | Core descriptor/collector integration was already absent in surviving baseline; missing reports/runtime are separate blockers. Not working features restored by these tests. |
| Ordinary/default encoding, old AV1, Remux and vendor acceleration | Existing scoped source contracts and earlier evidence only | No general current media/native/Windows/hardware qualification inferred from Full-copy or portable tests. |

## Next priorities

Follow the owner's latest direction: know what works and improve current reliability/performance. Do not reconstruct old code or acquire obsolete runtimes merely to make historical tests green. Avoid a second compatibility framework or new technical debt. Existing 1440p/4K roadmap context is not automatic feature-restoration authorization.

After complete 035 preservation, investigate the current owner-transition/lifecycle coverage gap and attribute retained costs between startup, target encoding, decoding/evidence and GUI time. Both are assigned only at this cutoff; no finding or tuning result is claimed. No benchmark, quality/default, thread-policy or preservation-budget change. Fresh finite Keep/resize qualification is an optional product-driven decision, not a prerequisite to erase old failures.

Expected scope: 17 changed paths, 617 files and 35 commits, subject to verification. Preserve Git → immediate independently restored Notion source/history/full Session → verified GitHub. Prior 034 is fully preserved; no pending 035 commit is claimed backed up. Formal Security Cloud remains deferred; manual review is not a formal assessment.

See [execution](2026-11-18_Current_Contract_Test_Repair.md), [receipts](2026-11-18_Current_Contract_Test_Repair_Receipts.json) and [Session](SESSION_SUMMARY.md).
