> **Current authority — execution resumed October 11, 2026.** Ahmed explicitly reauthorized the full 0.7 candidate Goal with [workbench amendments](28_0.7_Execution_Resumption_and_Workbench_Amendment.md). The earlier planning pause is historical and superseded. Preserve unfinished work, accepted0.6 and the independently paused benchmark. Implement and verify N–S; final owner acceptance remains separate.

Execute the reviewed FFmpeg Encoder 0.7 plan through a locally qualified candidate.

This is the execution Goal for the existing FFmpeg Encoder project. Implement the October 11, 2026 document titled “FFmpeg Encoder 0.7 — Technical Plan for Review,” incorporating the amendments below. This Goal authorizes the selected development work. It does not authorize accepted-release status, publication, or continuation of the paused benchmark.

Use the complete plan already in this conversation, not only its short draft Goal. Preserve a dated copy in the project documentation and record this Goal as its implementation amendment. If a persisted plan already exists, reconcile its actual path and contents rather than creating competing authorities. Where this Goal conflicts with the reviewed plan, this Goal controls. Existing security and source-preservation requirements remain in force.

1. Outcome and working boundaries

Deliver a coherent, usable, locally tested 0.7 candidate with the selected N–S scope implemented, a fresh portable package, recoverable checkpoints, an honest support matrix, and an easy owner-review entry point.

Continue in:
D:\Codex Projects\FFmpeg Encoder

Supplied originals:
F:\FFmpeg Encoder Project supplied videos

New project-owned media belongs in clearly separated downloads, fixtures, outputs and staging folders under:
F:\FFmpeg Encoder Project supplied videos\_FFmpeg-0.7-Owned

Read the current project instructions, Git state, accepted-release records, pause/resume record, source code and surviving evidence before modifying anything. Account for any work already completed; do not blindly replay the plan. Preserve unrelated user changes. Use codex/v0.7-candidate, or safely resume its existing equivalent after checking it.

Protect accepted local-v0.5.0 and local-v0.6.0, the accepted portable artifacts and their settings, the benchmark branch/checkpoint c08e117256d93371871c481d3ca56468fe10fbec, and the benchmark's pinned tools, files, mappings, ledger and unfinished visual-review gate.

The plan reports 139 benchmark invocations; the earlier pause report described 201 remaining out of 340. These can be complementary counts. Confirm definitions from the existing ledger before documenting them; do not label remaining allowance as used runs or consume any of it. No benchmark continuation, finalist selection, held-outs or new recipe recommendations.

2. Required amendments: audio and Time Range

The plan's packet-limited copied-audio paragraph does not incorporate our later decision.

For ordinary Full-video encoding, copy compatible audio by default and retain the unchanged compatibility path.

For a non-full Encode Time Range, default to an explicitly disclosed precision-oriented audio re-encode of the entire selected audio segment. Implement and document a quality-conscious, container-compatible codec/rate/channel/sample-rate policy. Preserve channels/layout and sample rate where supported; do not silently downmix or resample. Inspect the supplied sources rather than assuming all audio is 192 kb/s. Do not use “lossless,” “identical,” or guaranteed inaudibility for a lossy re-encode.

The policy should make typical gameplay/desktop captures easy to trim correctly without requiring audio expertise. Original files remain untouched. Expose the effective audio decision in preparation and output details, with meaningful advanced overrides where supported.

Offer audio copy for trimmed encodes only as an explicit supported alternative with packet-boundary limitations and its own acceptance contract. An inability to honor an override must produce a clear explanation, not a silent different operation.

Define requested versus effective video and audio boundaries, timestamp rebasing, encoder delay/padding and mux/container behavior. Establish measurable boundary and synchronization tolerances using actual decoded evidence. Do not apply the plan's copied-audio 100 ms cap as a universal precision-mode target, and do not promise zero drift merely because audio was re-encoded.

Test start-only, end-only and both-ended ranges; late seeks; VFR/nonzero timestamps; multiple audio tracks; delay/padding; supported subtitle/chapter behavior; and unsupported combinations. Keep range ownership per file, Full as the initial selection, visible handles plus precise timestamp inputs, and explicit batch application.

Remux may remain full-video-only in 0.7. Audio re-encoding inside a video Time Range is authorized by this Goal; the deferred general-purpose audio extraction/conversion toolbox is still outside scope.

3. Required amendment: dedicated App Settings

Implement a clearly accessible App Settings surface, separate from About/help content and routine per-file encoding controls. It may be a dedicated tab or a well-designed settings page reached through a persistent action; do not bury it as explanatory text.

Provide persistent defaults for implemented behaviors, including the audio policy above. Define precedence explicitly: app defaults, current batch defaults and per-file overrides. Show effective choices and where a file overrides inherited defaults.

Use typed main-side validation, versioned preferences, safe atomic persistence, migrations, corrupt-data recovery and a deliberate reset-to-defaults flow. Keep development state isolated from accepted 0.6.

Settings changes must not silently mutate frozen prepared, queued or running jobs. Changing the effective settings of a draft invalidates preparation as appropriate. Cosmetic navigation does not. Make the effect on new versus existing drafts understandable.

Do not turn safety invariants into convenient global bypass toggles. Restart must not restore temporary omission approvals, prepared execution authority or generated-output re-encode grants.

4. Implement the full selected scope

N: Finalize shared contracts and requirement-to-evidence tracking, incorporating this review. Move into implementation without another routine planning approval loop.

O: Extend persistent diagnostics across admission, inspection, unsupported-only batches, preparation, capability checks, runtime failures, validation, publication, cancellation and interrupted-session recovery. Preserve privacy, bounded retention, redacted reviewable exports and honest behavior if logging fails.

Implement the exact ctime-only policy: if the output is valid and complete comparable bounded checks show only ctime differs, retain/publish it safely and warn. Do not cancel or delete hours of valid encoding solely because ctime changed. Do not introduce mandatory whole-file pre-reading. Keep stronger observed content/identity mismatches, incomplete checks, invalid output and destination collisions distinct. Do not weaken cache freshness, source identity or re-encode authority globally. Use deterministic tests; do not wait for a random real recurrence.

Reproduce the Resolve-origin supplied input and laptop episode candidates separately with isolated accepted-runtime behavior first. Expand the inspection schema before new features depend on it, preserving typed HDR, orientation, SAR/DAR, timeline, stream/container relationship and uncertainty evidence. A missing tag is not a proven failure cause.

Seek usable remedies for known refused inputs. Preserve ancillary tracks where genuinely possible. Where a particular track cannot be represented, provide a precise, named per-file decision or supported alternative. Do not silently drop all data streams or equate a copied timecode string to its original timed track.

P: Implement useful AMD AMF and Intel QSV adapters, native quality controls and per-cell capability handling as planned. Retain distinct CRF/CQ/CQP/ICQ semantics, explicit device selection, bounded probes and no silent backend or rate-control substitution. Missing hardware must not prevent software implementation and deterministic tests, but real vendor execution remains unverified until tested on that hardware.

Implement qualified PQ/HDR10 and HLG preservation plus a real, deliberate HDR-to-SDR conversion path. For the supplied iPhone-compatible sample, qualify the explicit HLG base-layer route and the bounded Dolby Vision-aware PQ alternative described in the plan. Clearly state whether Dolby metadata is applied, discarded or retained. Do not call ordinary PQ output Dolby Vision or automatically HDR10. Do not convert to SDR silently.

Keep the user's outcome central: smaller files with good visible quality and retained HDR where supported. Do not promise a fixed size reduction, superior quality from metadata consumption, or unseen HDR-display validation. Qualify ancillary mebx tracks separately from the image/HDR route. A technically unavailable advanced route must have a concrete evidence-backed limitation and preserve the usable qualified route; do not abandon the rest of the release.

Q: Implement orientation/SAR-aware single-output downscaling without silent upscaling, cropping, stretching, deinterlacing or frame-rate changes. Preserve the ordinary Keep Source path.

Implement the amended per-file Time Range and broad compatible remux matrix, including TS input and qualified MOV cases alongside MKV/MP4. Classify actual streams and container relationships rather than trusting extensions. Disclose representation changes and unsupported preservation cases; no hidden transcoding or track loss.

R: Deliver a creative, polished tabbed workbench with dedicated Encode, Remux, Activity and Help/About functions plus App Settings. Use the current product character while improving workflow, hierarchy and clarity. Do not cram all features into the original home page.

Preserve batch-versus-file scope, clear requested/effective output summaries, accessible exact-value alternatives to sliders, usable narrow-window layouts, navigation during work, and transparent errors/diagnostics. Include the original app icon and accurate versions, licenses and credits contemplated by the plan.

S: Integrate the features, run the bounded cross-feature qualification, perform independent review, and produce the fresh portable candidate and evidence package.

5. Security begins in every milestone

Retain renderer sandboxing/context isolation, narrow validated IPC, main-owned authority, fixed trusted executables, safe argument arrays, bounded parsing/probes, owned subprocess lifecycle, no-overwrite publication and source-preserving cleanup.

Threat-check each new feature before implementing its boundary, then test it during that milestone. Include path aliases/reparse behavior, source replacement and publication races, hostile filenames/metadata, malformed preferences, cancellation timing, log privacy and resource exhaustion. Security is not a final checklist to postpone until S.

No arbitrary command/filtergraph/path APIs, global ignore-stream switches, hidden network reporting, new credential access or security-setting changes. Respect any action-time approval required by the execution environment.

6. Runtime, fixtures and resource controls

Trial the proposed Electron and paired FFmpeg/ffprobe maintenance updates in separate reversible checkpoints. Verify exact official releases, provenance, hashes and relevant behavior rather than trusting version strings in the plan alone. Keep accepted 0.6 and the benchmark runtime intact. Do not churn unrelated dependencies without an evidenced need.

Acquire a small legitimate varied HDR corpus during execution, using documented official or otherwise reputable sources and permitted testing terms. Record origin, permission constraints, exact bytes, hashes and probes. Keep supplied media private, including its location metadata. No uploads of source clips, raw probes or identifying metadata.

Latest owner resource amendment supersedes the plan's fixed F: development storage budget. F: has roughly 700 GiB free according to the owner, and elapsed download time matters more than modest local test-output growth. The owner reports at most about 25 megabits per second, not 25 megabytes per second.

Remove the 24 GiB total development-growth ceiling and the fixed 25 GiB F: reserve as project acceptance gates. Do not stop otherwise useful work merely because owned F: fixtures or outputs exceed the old allocation table. Verify actual free space, forecast peak demand and prevent exhaustion with a sensible operational margin; this is not permission to fill the disk wastefully.

D: remains a separate volume. Retain the 25 GiB D: free-space protection and move suitable project-owned bulky build/extraction/media scratch data to F: where this can be done without breaking the project or touching unrelated files. Do not assume F: free space applies to D:.

Keep an accurate ownership/storage ledger, including retained completed stages and temporary copies. The earlier 6 GiB fixture-download allowance remains a bounded acquisition allowance, not a target to consume. Prefer small representative sources, avoid large collections merely to extract seconds, cache/reuse verified downloads, inspect expected transfer sizes and estimate elapsed download time before large fetches, use bounded retries/timeouts, and account for required runtime/tool downloads separately so total network cost is visible. If a necessary download would materially expand that allowance or be unusually large/slow, explain the smallest useful alternative rather than silently downloading a large corpus. New local output growth is not the same as network transfer.

Use bounded routine fixtures and one media job at a time. Isolate performance measurements from competing work. The plan's 8–20 active-hour validation estimate is a forecast, not a requirement to burn time or an unlimited allowance. Prefer targeted evidence and reforecast materially expensive runs. Do not shrink required coverage silently or delete benchmark assets. Benchmark time/run/storage accounting remains separate and untouched.

7. Autonomy, validation and delivery

Work through ordinary engineering choices and recoverable failures autonomously. Delegate independent implementation/review where useful, with clear file ownership and one coordinated media-job scheduler. Keep real integration and source-of-truth reconciliation under one owner.

Do not make repeated Ahmed visual-review sessions a prerequisite for each intermediate milestone. Create inspectable previews, conduct your own visual/keyboard/resize checks, and continue toward the candidate. Incorporate feedback if supplied. Final owner visual acceptance remains separate. Stop only for a genuine authorization, irreversible-risk, unresolved product-scope or hard-resource decision; continue unaffected work where safe.

Use explicit requirement-to-implementation-to-test evidence for all selected scope. Test unchanged Full-video CPU/NVIDIA behavior and CQ29, new audio modes, HDR/scale/range interactions, remux compatibility, source-change dispositions, negative inputs, cancellation/publication, restart/migration and portable operation. Keep simulated evidence, actual local CPU/NVIDIA execution, missing AMD/Intel hardware, independent-machine testing and HDR-display judgment clearly distinguished.

Unsupported cells must be specific and justified. Do not label a selected feature complete merely because the UI hides it or a mock passed. Maintain separate implementation and validation status.

Make recoverable local checkpoints and synchronized project documentation throughout: current state, continuation, roadmap, execution evidence, architecture/security contracts, user-facing behavior and session summaries. Correct superseded planning-only/deferred statements without rewriting historical facts. Record interruptions and inspect surviving state before resuming. No remote push or public publication.

At completion, provide:
- A fresh portable 0.7 candidate with exact path, version, hash and launch instructions.
- One clear owner-review entry point with a short guided checklist, using the successful FFmpeg Visual Review approach where useful.
- Implemented scope and remaining evidence gaps, supported/unsupported matrix, independent review findings and resolutions.
- Test/evidence index, storage/runtime ledger, rollback instructions and next acceptance decisions.
- An accurate final project handoff preserving the separately paused benchmark.

Do not create accepted local-v0.7.0 status, declare untested hardware/display results passed, choose benchmark winners, change established recipes from assumed benchmark findings, add an installer/updater, publish, or expand into general audio tooling, multiple-cut editing, multi-output ladders or 1.0.

Begin by reconciling the current state and saving the amended implementation contract, then carry the authorized work through to the candidate endpoint.