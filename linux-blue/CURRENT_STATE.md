# Linux 0.7 Current State

**Current: 17 November 2026, after the 19:19:01 UTC lead reconciliation.** Checkpoint 015 source is fully preserved in Git, independently restored from Notion ZIP/full history, and published to the original GitHub ancestry. The subsequent one-attempt developer resize calibration passed all three finite cases and its independent saved-output audit. This new evidence-only checkpoint 016 is not yet committed or backed up at this record cutoff.

## Actual present result

- Tested source: `9390681b347d732bff4ceae70d57de35495b536d`, 538 files. Fixed 1920×1080 progressive 30 fps SDR H264/PCM input to 1280×720 HEVC CPU slow/quality 25 with precise-range FLAC. Genuine source-bound family/collector and the unchanged resource formula were exercised, not the historical unqualified resize shortcut.
- A fresh 150-second source passed `[100,140)` at 1,200 frames / 1,920,000 samples and `[130,verified source end)` at 600 / 960,000. A fresh 11-second flipped-pattern heldout passed `[0.413,8.621)` at 246 / 393,984. Selected PCM hashes agree, complete-source counts and timeline/telemetry acceptance are retained.
- One outer run from 19:06:43.153 to 19:10:34.339 UTC exited zero. Monotonic elapsed was 231,185.590595 ms; wall elapsed was 231,186 ms. These are whole calibration timing, not an encode benchmark. Raw case/filename epochs retain the known roughly two-hour clock-domain difference; do not merge them into a synchronized timeline.
- All 42 children closed, none live, maximum one; three target encodes and seven collector children per case are distinct counts. All 42 stderr captures are available, complete-at-save and untruncated: 39 empty, three targets 499 bytes each with duplicate-codec notices, an x265 CPU-mask error and no-thread-pool warnings. Complete capture does not mean warning-free operation.
- The independent saved-output audit at 19:13:12 UTC verified 538 source files, nine runtime pins and 95 owned artifacts / 160,457,169 bytes. Lead reconciliation at 19:19:01 repeated all file/pin/artifact identities and released the source freeze. No further runtime execution or retry is authorized by this record.

## Evidence and qualification boundaries

[Execution](2026-11-17_Resize_Candidate_Calibration.md), [receipts](2026-11-17_Resize_Candidate_Calibration_Receipts.json), [portable report](evidence-2026-11-17/resize-candidate-calibration-portable.json) and [full session history](SESSION_SUMMARY.md) distinguish source, execution, audit and preservation.

Raw report: 125,887 bytes, SHA-256 `3fc9a4678890da318728f2c8b44ac7c6b4fe345ccd271b7f1064928f63eb1317`. Portable report is archival data with 141 root substitutions only, not an exact raw restore, runtime restore or factory authorization. Runtime binaries, media, child logs, telemetry/spools, approval files and the private inverse mapping stay local and outside the source mirror. Full output hashes were first established during the audit, not compared against an earlier full-output baseline. A full output probe JSON was not separately retained: geometry/SAR/clock acceptance relies on the reviewed executed harness assertions and retained validation/frame checks, not a fresh independent ffprobe. Returned/persisted equality was an executed launcher gate, not a comparison of two saved complete report copies. No fresh independent decode was run. Scaling does not establish video-pixel identity or visual quality.

The 27 GiB floor / 2 GiB owned admission are point checks, not hard write caps; the 30-minute abort is a request, not a guaranteed OS deadline. Nine pinned identities are not atomic loaded-image proof. These three finite cases do not establish arbitrary lengths, geometries, hardware or production usability.

## Existing failures and previous GUI proof

No unit/broad suite was rerun for this evidence-only step. Checkpoint 015 remains 148/148 focused, 125/126 service with the old missing-source diagnostic mismatch, and 178/213 broad with 35 failures: 27 inherited plus eight intentional stale-producer refusals. The old Keep720 capsule still has three stale producer pins and remains fail-closed. This calibration does not reactivate it.

The last native GUI proof remains the short Keep720 journey on `c270331`, separately preserved in checkpoint 014; its platform-neutral reveal wording change had source tests only. No native resize, new UI route or fourth Keep720 journey occurred. The archived historical native and service evidence is not relabeled as resize qualification.

## Preservation and next permitted action

Checkpoint 015: local `9390681`, remote `10c1a57532171b1b3a1846c0136d78ef06d600b1`, [verified Notion checkpoint](https://app.notion.com/p/41bbd7ade63b81cc9085f8b106f181a2). GitHub was verified at 19:07:11 UTC, while the media run was underway; local commit plus verified Notion source plus exact reviewed launch gate preceded the run.

Finish checkpoint 016 as five explicitly scoped PBS/evidence paths, immediate verified Notion source/full-history restore and unabridged native records, then expected-parent non-force GitHub publication. Dated records remain as written; later publication receipts own resulting identities.

The next engineering slice is a separate developer-only `candidate-resize-service.cjs` composition and focused tests in an isolated clone. Reuse shared service/selector/runner/storage boundaries, bind the actual new raw report and exact producer closure, retain synchronous cancellation admission closure and drain → close → fresh instance recovery. No generic factory refactor, old Keep720 repin, UI/default/catalog activation or real service/native run is part of that source assignment. After independent review and preserved integration, a separately reviewed bounded normal-service proof is next; native resize follows later.

Preserve non-HDR ordering, Windows corrections, original theme/Gauge, ArchiveCQ29/defaults and benchmark pause. HDR expansion and packaging remain deferred; release/owner acceptance is separate. The latest old 35-file upload remains terminal-unknown and is neither replayed nor reconstructed by these records. Formal Security Cloud remains deferred.
