# Current 1440p range service evidence and Windows workflow introduction

Checkpoint 061 evidence cutoff: 2026-11-18T17:50:57.086161+00:00. This final outside record awaits lead integration and coherent preservation; it is not a commit, publication receipt or activation grant.

## Purpose and starting state
Checkpoint 060 supplied the fixed current-runtime 1440p→720p H.265/precision-FLAC range service, separate from its earlier calibration. The actual service campaign tested immutable local `fb628eb6d65d3530c73a647ec70261a6fb8a1085`, mapped to remote `97ca51ff99cce5e4b382b2a9d0445949cb416cc8`, with all 704 source files held unchanged. Windows introduction work is a separate integrated four-file delta, not part of this media proof.

## Execution, audit and reconciliation
The one reviewed service run started 17:37:27.146Z and ended 17:38:28.041Z on 2026-11-18. Outer monotonic elapsed was 60,894.583283 ms; inner campaign reported 56,888 ms. Exit 0 and empty helper stderr do not mean child diagnostics were empty. Four cases support a short publication, exact post-preview collision refusal with unchanged sentinel/no target, live cancellation, and fresh-owner recovery publication. Three semantic targets are children 39, 67, 105; 27 progress-bearing child invocations include other work. All 115 owned children closed, live 0, maximum 1. Both explicit closures report closed admission/live 0/no errors.

Original output hashes/probes were captured during the run, then independently rehashed. The two final files are 441,241 and 109,548 bytes. Cancellation was observed at frame 6 and closed via existing-runner SIGKILL, retaining an unverified zero-byte stage rather than deleting it or calling it a valid output. Recovery used a distinct fresh owner, not same-service restart. No OutputAccess backend was configured, so this does not prove backend grant issuance or shell access.

The saved-only audit released 17:41:59.913845Z; lead reconciliation released 17:46:55.780944Z. The audit checked 987 identity rows/972 unique paths, all 704 source files and 97 producer pins. The lead rehashed those identities and six retained FFET1 telemetry files, without service/media replay. An initial auditor heldout-directory guess stopped before audit write and was corrected to the actual pinned input. Original artifacts were not changed.

## Diagnostics and evidence limits
Six children, including both successful targets, retain 168-byte x265 CPU-mask/thread-pool diagnostics. Four startup SVT children retain informational output. Cancelled child 67 retains 904 bytes including interrupted demux/H.264 messages; 104 other child streams are empty. No duplicate-codec warning was observed. The unchanged full original-source hash prevents calling these cancellation messages evidence of a changed source, but this is not blanket decoder-health certification.

Selected PCM equality remains original streaming hash/byte evidence. No raw PCM is retained for a new comparison, and the auditor performed no additional probe/decode or video-pixel comparison. The input is the reused 11-second heldout fixture, not a new source-family or long-duration qualification. Point-space checks, abort requests and closure-observation windows are not hard storage quotas or guaranteed termination. No native UI, Windows, GPU, broad catalog or default promotion follows.

The complete parsed report is retained in the portable companion with exactly 274 leading-root substitutions: 159 proof aliases and 115 runtime-build aliases. Every report value other than those declared strings remains unchanged. Final audit metadata is added to the wrapper only; all authority flags remain false. It cannot restore the original raw report/runtime/media or satisfy executable factory gates.

## Hosted source-contract evidence received separately
Actual 059 hosted run 44357487410 on `b7eaeb170ef29ebf08fc579ef459413e837cf66c` succeeded: 202 syntax files, 209 shared tests on each Windows/Linux job and 10 additional Linux tests. Run timestamps are 17:20:02–17:21:02Z. Although the run preceded 060's cutoff, its result was still pending in the dated 060 record; this is later receipt reconciliation, not retroactive knowledge.

Actual 060 hosted run 44360097680 on `97ca51ff99cce5e4b382b2a9d0445949cb416cc8` succeeded: 204 syntax files, 209 shared tests on each platform and 10 additional Linux tests, 17:34:02–17:34:41Z. This occurred after 060's dated cutoff. Exact jobs/log hashes and individual job times are in the receipts draft. Neither run proves Windows archive acquisition, local capacity, extraction, installation, Electron/native CPU or RTX 5060 acceptance.

## Windows introduction source, review and tests
Exactly four V3 additions were integrated at 17:50:01.989368Z: `.github/workflows/windows-archives.yml`, `scripts/windows-hosted-archive-check.cjs`, `tests/windows-hosted-archive-check.test.cjs` and `linux-blue/WINDOWS_HOSTED_ARCHIVE_CHECK.md`. All 704 inherited files remained unchanged. The reviewer approved the exact patch for one introduction from remote 060, not a generic recurring transfer grant. Both workflow and wrapper pin push.before to the expected remote parent, reject forced/created/deleted pushes and bind after/current SHA, repository/ref/attempt and checkout. The path filter is inclusion, not exclusivity; the lead must still verify actual sole Git parent and nonforced ref update. No duplicate dispatch or automatic fallback is authorized. Resource floors, host/digest/file pins and report closure remain unchanged; no extraction or installation occurs. Three-day artifacts contain reports only. Insufficient measured hosted volume may legitimately refuse.

Author 26/26 offline and independent 10/10 offline checks passed. Pure push-scope controls retained V2's 2/6 red and V3's 6/6 correction; four inherited report/floor/outcome checks remain green. These source/injected tests do not exercise real candidate downloads, native Windows filesystem behavior or hosted capacity/event/artifact services.

Lead Node v24.22.1 Linux tests ran 17:50:25.216528–17:50:39.146510Z: explicit wrapper syntax 17:50:25.216528–25.300919, test syntax 25.306614–25.362398, focused 55/55 at 25.370456–25.726026, selected CI at 25.731048–39.146510 with 209 shared + 10 Linux checks, all exit 0/no failures/skips. CI enumerated 204 already-tracked syntax files; the two new CJS files were explicitly checked separately. The future tracked enumeration should be 206, not an already-executed result. Counts overlap and are not summed as unique coverage. All 708 indexed and newly added files remained byte-identical during these checks. Historical eleven failures are carried, not rerun or declared fixed.

The Python driver emitted a benign `SyntaxWarning: invalid decimal literal` from `0for`; it still parsed, ran every command and exited 0. Actual process exits were retained before output parsing; no result-changing rerun occurred. The unchanged source-only 1440 tests were not repeated. Actual Windows hosted introduction remains unexecuted at this cutoff.

## Cost and next decisions
Saved target child intervals are 4.486 s and 1.677 s for the two successes, not whole-operation benchmarks. The seven collector child intervals sum 4.526 s and 4.031 s; complete source-video checks dominate and are contract-required. The apparently duplicated prechild identity-check cost remains unmeasured. No check, threadpool setting or runtime policy is weakened on this evidence.

Old 1080 range, Full-copy and Keep720 capsules remain unavailable on changed producers; do not repin old reports. Preserve the recoverable known 057 checkpoint and original 7.1.5 default/rollback. Current 1440 service evidence is not yet native application integration or broad 1440/4K acceptance.

Owner's later planning direction remains separate: themes, 12 languages including Arabic, an in-app illustrated guide with interactive onboarding, and UX bug work belong to 0.8; HDR is 0.9. Benchmark-feedback placement between 0.7 and 0.8 is pending. These plans must not interrupt agreed 0.7 completion. No implementation is claimed.

## Preservation handoff
Final scope is nine paths, expected 711 files and 61 local commits after coherent freeze. Four source additions plus Current, execution, receipts, complete portable evidence and the separately owned Session form that scope. Commit/archive/Notion/GitHub completion is pending at this cutoff. No later capsule-restoration proposal or result is imported.
