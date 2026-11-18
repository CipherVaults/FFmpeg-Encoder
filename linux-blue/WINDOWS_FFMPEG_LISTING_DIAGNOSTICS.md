# Next bounded Windows listing diagnostic attempt

Source proposal only. No new job, acquisition, extraction or runtime execution performed for this change.

## Observed failure, not guessed cause

The independently attested checkpoint 063 report identifies remote 878808d685cd4a99ceee73f2dc8ed4b9c30b19a2, run 44379432870, attempt 1. Both compressed archives verified against unchanged pins. It reports FFMPEG_STARTUP_FAILED, stage listing, AssertionError/ERR_ASSERTION. Saved job log adds only that same failure/report digest, not the assertion text or listing output. Therefore neither a backslash format mismatch nor storage/ownership refusal is established.

In the old code, stage listing spans the listing child, parser, post-list capacity check and parent-ownership check. The next proposal separates these as listing-command, listing-parse, post-list-capacity and post-list-owner. Other stages, byte caps, pin verification, storage floors and child-close behavior remain unchanged.

## Small diagnostic change

Parser assertions now carry a finite reason code: malformed/unknown/duplicate field, path bound/separator/component/alias/root, size/encryption, attributes, folder conflict, directory size, expanded limit, selected-member mismatch or ancestor conflict. Acceptance predicates are unchanged. Windows backslash member names still refuse with PATH_SEPARATOR; there is no speculative separator normalization or path-policy relaxation.

A bounded structural summary includes listing byte count and digest, capped record count, only known field-name labels, unknown-field/malformed-line counts, separator-kind counts, and Windows-style versus other attribute counts. It includes no member names, raw values, unknown field names, exception messages, command output, environment or host paths. Only a frozen summary created internally by the bounded summarizer can enter the diagnostic serializer; arbitrary attached objects are ignored. Report remains the existing exclusive, attested JSON artifact under 32 KiB. Failure disposition remains failed-or-partial-unverified rather than claiming later steps never ran.

The source still accepts the exact original pinned-archive Linux listing fixture; that does not prove the format of the hosted Windows tool's stdout. Structural information and exact reason should identify whether a targeted compatibility adjustment is justified. If a genuinely different unknown field remains ambiguous, stop and review evidence. Do not automatically widen the parser or rerun.

## Raw-listing artifact decision

No raw listing upload is added. The safer first step is the bounded summary in the already attested report: it distinguishes the expected failure classes without additional artifact paths or arbitrary output exposure. If insufficient, a future separately reviewed listing-only artifact could record at most 1 MiB after before/after archive pin verification, with exact tool/command identity, exclusive retained-handle readback/hash attestation, strict stdout-only handling and no stderr, environment or command preamble. It would be explicitly public pinned-archive metadata, never a general debug-log upload. That broader path is unnecessary for this proposal.

## One next checked-in attempt

Workflow and wrapper pin the ordinary successor parent 878808d685cd4a99ceee73f2dc8ed4b9c30b19a2. Same repository/ref, after-SHA, nonforced/noncreated/nondeleted event and first-attempt restrictions apply. No workflow_dispatch, rerun, automatic retry, default-branch promotion, Electron installation, media or GPU claim. If another commit changes the expected parent, stop and review the exact new transition rather than bypassing admission.

31 file/injected tests pass, zero failures/skips. Existing original-listing acceptance and hostile input rejection are preserved. New tests cover backslash refusal/diagnosis, safe structural summaries, rejected arbitrary diagnostic objects, distinct parser reasons and all four separated failure boundaries. Main checkout remains unchanged; independent review precedes integration and Git → Notion → GitHub preservation.
