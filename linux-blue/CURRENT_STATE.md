# Linux 0.7: current development state

Updated November 17, 2026, after short and longer real-media candidate calibration and independent saved-output audits. Read the corrected [full session history](SESSION_SUMMARY.md), [media execution report](2026-11-17_Candidate_Media_Calibration.md) and [compact evidence receipts](2026-11-17_Candidate_Media_Calibration_Receipts.json).

## Verified source continuation point

Checkpoint 006 is local `54ee143efed8a05b70520d278dd966ec5b0dda78`. Its [Notion checkpoint](https://app.notion.com/p/41bbd7ade63b81cf9411f56f78360542) independently restored all 505 source files and cloned the complete six-commit bundle with exact HEAD/tree/file hashes. Source ZIP SHA-256: `22353ca635b6d15edbd2f5e3ddb6105ce9d290b4460c721787c2183c3e8b2f2f`; inner bundle: `487e50979bbfe41497320e74bfbc68f6cdfb436df3593052a9dedf8883f55e26`.

Verified remote `11bce729aed4a261c87e6cdd213f29c1f9efe2d0` on `CipherVaults/FFmpeg-Encoder-Blue-Linux`, branch `blue/linux-development`, has sole parent `591b6d149396efbca4b89a97792e6cb9c17080c6`. All eight changed file contents were read back and independently rehashed; remote tree 887 files, 879 unchanged, four modified, four new, zero deleted. The update used the expected previous SHA without force. Local reconstruction and original remote histories remain intentionally different.

Earlier checkpoints remain intact. This is selected source/history preservation, not recovery of the vanished workspace or missing latest unpublished changes. The earlier 35-file submission remains terminal-unknown and has not been replayed or rerouted. Current new records describe later work and do not retroactively change the immutable checkpoint archives.

## New actual-media result

Two separately reviewed, single-attempt synthetic campaigns passed on exact checkpoint 006 with the new candidate runtime pair `1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9`:

- Short legacy-policy calibration: three ranges from a four-second 720p30 SDR H.264/PCM source to CPU HEVC slow25 plus precision FLAC. Selected frames 15/62/60 and samples 24,000/99,552/96,000; 34 children spawned and closed, none live, maximum one; approximately 16.3 seconds. The short held-out range shares the same source.
- Longer genuine proportional-selection calibration: a 150-second source with a late 40-second range and open-ended range, plus an independent 11-second held-out source. Selected frames 1,200/600/246 and samples 1,920,000/960,000/393,984; 42 children spawned and closed, none live, maximum one; approximately 197.3 seconds.

The longer run genuinely crosses the old 30-second selected-range and 120-second source ceilings for this one non-resize precision-FLAC family. PCM hashes/bytes, telemetry, decoded operation contracts, complete-source counters and actual output decode checks passed. It does not establish arbitrary duration, lossy video-pixel identity or general perceptual quality.

The final runtime/source checks passed, including both tools, seven actual loaded dependencies and all 279 conservatively gated source/record hashes. Each campaign used the original frozen criteria and budgets, sequential children and a 27 GiB free-space check before every child. No retries, source changes or production pin substitutions occurred. Abort deadlines are cancellation requests, not guaranteed process exit; disk checks are not hard active-write caps.

## Independent evidence and preservation

Both read-only saved-output audits passed. They verified report/completion/source/output/spool identities, source and runtime dependency hashes, completed collector children, PCM/count/telemetry consistency and false authority flags. The long audit independently rederived each resource envelope and compared the frozen before-encode bounds. Audits did not execute another media process or independently re-decode every output; streamed raw PCM and cryptographic chronology are not claimed.

Short report SHA-256: `6143eb2f58fbdc047bb490b437a08b69c763dd8bb5f267885a25c62960108684`. Long report SHA-256: `1feb0f2958c78cc73683c70fed08835d1e61b98462e8b30e0127f95b5cf350ab`. Exact audit and source/output/receipt identities are in the compact evidence record.

Two reviewed portable archival JSON records preserve full new report data with only machine-path prefixes transformed. They explicitly are not byte-identical original reports, cannot restore raw bytes without the excluded mapping, and cannot satisfy historical pinned factory gates. Original reports/media/spools and runtime binaries remain local and outside this source archive. Source backup is not a claim that every raw runtime/media artifact is backed up.

After completion, the lead rechecked all 279 hashes at 15:30:35 UTC and released the record freeze for Ahmed's requested session-structure correction. Documentation changes are later than the tested code. The cumulative summary now follows the supplied structure with all 236 original substantive paragraphs retained across six corrected historical entries, plus a full new media session. Later clarifications are explicitly dated; the [correction receipt](2026-11-17_Session_Structure_Correction.json) records exact before/after hashes. Prior checkpoint archives remain untouched.

## Existing tests and unresolved gates

Application code is unchanged since checkpoint 006. Its latest tests remain 87/87 lead aggregate, 18/18 independent focused and 33/33 isolated path-adapted legacy tests. The prior broad Linux regression remains failed: 161 passed, 27 failed of 188. Those suites were not rerun for this media/documentation step. Passing media cases do not erase missing historical runtime/report/factory checks or qualify deeper branches behind those failures.

No normal EncoderService output was published by these calibration harnesses. Production factories, catalogs, historical runtime/source/report pins, defaults and coefficients remain unchanged. Actual service prepare/start/storage/publication and cancellation/recovery on this new runtime are the next boundary. A cancelled candidate handle deliberately stays stale; naive substitution into the old smoke cannot establish same-service recovery. Fresh-instance recovery and same-service recovery must remain distinct.

This primarily advances Q2n range-Encode prerequisites, not the separate Q2j Remux/container/MP3 lane or all Q. Other audio, multitrack, subtitle/chapter, Quick Copy, resize/full/1440p/4K work and product/platform acceptance remain unfinished. Positive source device/inode assumptions remain a separate Linux portability boundary. Preserve original theme, shared architecture and Windows corrections. No GPU, Windows, GUI, package or release acceptance is implied; HDR expansion, ArchiveCQ29/default/benchmark changes remain out of this step, and packaging stays last.

## Next bounded actions

1. Independently review the completed owner-requested session-structure correction with the coherent media evidence/current/session/portable records. Commit explicit paths, immediately verify Notion source and full-history restoration, then publish the permitted reviewed delta on expected original GitHub ancestry. This pre-commit record does not assert a completed new preservation cycle.
2. Design and test a developer-only real EncoderService proof composition consuming the exact reviewed candidate runtime and calibration. Preserve genuine selection, source/runtime freshness, normal storage and no-overwrite publication. Keep old factories and historical pins intact; do not treat the transformed archival report as an existing qualification grant.
3. Explicitly resolve the candidate runtime lifecycle for cancellation before claiming same-service recovery. A fresh service/handle is a distinct, narrower recovery proof. Run one separately bounded actual service campaign only after source review and preservation.
4. Continue the agreed non-HDR 0.7 plan and remaining platform/product checks, with meaningful checkpoints and accurate scope. Ahmed retains final acceptance.
