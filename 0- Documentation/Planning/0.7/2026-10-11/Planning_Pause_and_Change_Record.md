# 0.7 planning pause and interrupted-change record

**October 11, 2026 — execution paused; technical plan awaiting Ahmed and Blue.** Latest direct instruction: inspect/research, produce the technical plan and design artifacts, then stop. Do not implement, change production settings, run encoding jobs or discard surviving work. The persistent execution Goal was explicitly changed to `paused` in this pass. No new Goal was started, and no recurring schedule was created, re-enabled or changed.

Current review entry: [27_0.7_Technical_Plan_For_Review.md](../../../27_0.7_Technical_Plan_For_Review.md). It is the current planning revision; plan22 and saved Goal23 remain historical/recoverable. Product amendments concerning trimmed audio, App Settings and storage remain design inputs. Their earlier execution authorization is paused by the latest direct instruction. This record is not a second milestone registry.

## What the interrupted run changed

Live branch `codex/v0.7-candidate`, HEAD `8bac91f5647bc1e3d54e0920749fbf990fea59cd`. Parent checkpoint `c08e117256d93371871c481d3ca56468fe10fbec` remains on the benchmark branch. Commit8bac91f is documentation-only; it added plan22, saved Goal23, contract24, tracker25 and a bootstrap record, and changed AGENTS/current/continuation/roadmap/session/index text. It did not commit production code.

**The working tree nevertheless contains substantive unfinished implementation.** This was reported to Ahmed before further planning. Nothing was reverted or discarded.

| Category | Preserved changes present at this pass's start |
|---|---|
| Tracked application/configuration | `.gitignore`; `main.js`; `package.json`; `package-lock.json`; `preload.js`; `src/encoder-service.cjs`; `src/inspection.cjs`; `src/ipc.cjs`; `src/outputs.cjs`; `src/source-identity.cjs` |
| New application modules | `src/diagnostics.cjs`; `src/media-evidence.cjs` |
| Tracked test changes | `tests/encoder-service.test.cjs`; `tests/inspection.test.cjs`; `tests/outputs.test.cjs` |
| New tests | `tests/completed-output-retention.test.cjs`; `tests/completed-source-policy.test.cjs`; `tests/diagnostics-service.test.cjs`; `tests/diagnostics.test.cjs`; `tests/media-evidence.test.cjs` |
| New development tools | `scripts/v07-baseline-reproduction.cjs`; `scripts/v07-native-foundation-smoke.cjs` |
| Uncommitted design/evidence | `26_0.7_Shared_Contracts.md`;15 earlier files in this Planning directory (private probes, runtime/help observations and source snapshot) |

The application changes add a journal/incident IPC surface, expanded normalized media evidence, ctime-only completed-output handling, retained-stage/publication states and lifecycle handling. Package metadata was bumped from0.6.0 to0.7.0-alpha.1; the lockfile changes mirror that version, not a runtime upgrade. Development state was redirected to `data-next-0.7`. These are unaccepted candidate changes, not merely documentation or a shipped0.7 release. The UI, accepted recipes and production media builder remain unchanged.

## What ran before the pause versus now

Preserved evidence under `artifacts/v0.7/baseline/` includes269 accepted-snapshot direct tests (12 historic Git-dependent characterizations excluded), the five-file accepted inspector/builder report, expanded metadata inspection, interrupted integration failures and later passing focused runs (including204/204 and5/5). Additional delegate reports cover focused output/disposition regressions. These records prove their specific checks, not a current final full-suite pass or native/candidate acceptance. No tests were rerun in this planning pass.

The saved baseline inspector/builder outcomes are iPhone `UNSUPPORTED_HDR`,107/108/109 `AMBIGUOUS_COLOR`, and Resolve candidate `UNSUPPORTED_STREAM`. They narrow current-policy behavior; original laptop error/settings/machine behavior remain unproven. The five supplied originals had matching recorded before/after bounded identities. The sample includes private location metadata; raw JSON stays local and is not part of the user-facing design board.

The interrupted run created a534,342-byte accepted-source snapshot under `F:\FFmpeg Encoder Project supplied videos\_FFmpeg-0.7-Owned\fixtures\accepted-v0.6-source`, small baseline/test artifacts and an ownership ledger. Saved ledger records zero media encodes and zero fixture/runtime binary downloads. It predates later small reports and is not a complete current resource inventory. No new FFmpeg/ffprobe/Electron process was running at this pass's initial census. Independent recovery found no owned native harness report or active media lease. **The native foundation harness was created and syntax-checked but never launched.** Do not launch it until a separate execution authorization.

During this planning pass: read-only Git/source/Notion/primary documentation inspection; reuse of existing metadata/help/test evidence; documentation/design artifacts; static design-board rendering using headless Chrome. No app launch, suite, probe, encode/remux, warm-up, benchmark, corpus download, dependency change or package build. Static HTML has no script, media element, app IPC or network dependency.

## Protected anchors

- Accepted0.6: `local-v0.6.0^{commit}` → `be92b12205d299b6d3bdcc2fd4b2e3a02f928862`.
- Accepted0.5: `local-v0.5.0^{commit}` → `f3efdeb47531106a740efb55299c5251b9a7a505`.
- Review pack checkpoint: `4010db7f2dbd80278fc8802c1d434159229eb5a2`; subsequent access/playback and pause records remain preserved.
-0.6 ZIP remains present at `out/portable-2026-09-23T21-19-15-055Z-196Mpn/zip/FFmpeg-Encoder-0.6.0-win32-x64.zip`,321,231,543bytes. Historical SHA256 `3b7c72ea3252dd9c3fff2d83227e3b5b04badf642b748c606063e339ead6f5bb` is reused; no new full-artifact hash claim.
- Benchmark live stage/review remain `awaiting-calibration-judgment`; finalists null;139 invocations. Its ledger is closed and untouched. No subjective feedback, selection or new evidence was inferred from this task. [Single benchmark handoff](../../../21_Phase1_Pause_Resume.md) retains its exact resources, paths and blind review procedure.

The accepted runtime remains Electron44.2.0 with paired FFmpeg/ffprobe9.0.1. Packager20.3.0/Playwright1.63.0 remain installed. Maintenance versions in the plan are proposed trials, not installations. Accepted tags/artifacts and the benchmark runtime are not replaced by the unfinished working tree.

## Known unfinished issues and acceptance gaps

Carry forward the independent findings without fixing them now:

1. Renderer-loss handling can await journal persistence before cancelling the owned encode.
2. Per-file inspection catches can lose bounded stderr detail.
3. Program/group normalization can overstate certainty for count/type/PID contradictions.
4. Rejected initialization retries, export truncation flags and user-visible persistence failures still need full integration scrutiny.
5. The new journal replaces new legacy batch-log writes; preserve the old useful logging/access contract through a reviewed adapter/summary design rather than accepting a silent regression.

Existing focused green tests are useful but do not close those gaps. No N/O completion, hardware acceptance, HDR-display acceptance,0.7 native qualification or portable candidate exists. No native harness is authorized by the existence of its script.

## Sources and current authority

Four primary Notion entries were accessible read-only: [intended roadmap](https://app.notion.com/p/3e5bd7ade63b81d5a7fcd46a0a753aae), [human roadmap](https://app.notion.com/p/3d6bd7ade63b817e9a55d61cf203bb9e), [feature board schema/views](https://app.notion.com/p/60570a27dd79480f9e567e0dd8db6d8e), and [project hub](https://app.notion.com/p/3f2bd7ade63b8137a25ccedb3c87c381). Current roadmap/hub record the earlier owner-reported execution launch; this direct pause instruction now governs action. The human roadmap/older feature text still describes intended scope and some uninspected inputs; live local evidence resolves implementation/inventory, not roadmap wording.

Relevant feature-card current sections are retained in [the earlier read-only snapshot](00_Product_Source_Snapshot.md). Their older trim-audio/storage wording is qualified by the current roadmap's later amendments. No Notion content was edited; omission of truncation/unknown-block metadata from fetched results is not a universal completeness certification. No inaccessible-source assertion was needed for the four primary entries.

The attached planning request is `C:\Users\Ahmed\.codex\attachments\e54e3538-fbd4-46d9-bdbc-33a635400f2a\Pasted text.txt`, read in full. It and the latest direct pause control this pass. The old candidate Goal file is preserved as dated history, not permission to continue now.

## Review and resume procedure

1. Ahmed and Blue review plan27, the static workspace board and three specialist appendices. Amend support cells, trade-offs or layout direction as needed.
2. Keep the execution Goal paused. A heartbeat or stale continuation note must not begin implementation, launch the harness or treat a proposed test as completed evidence.
3. Only after a **separate explicit execution Goal**: recover Git/status, these unchanged source hashes, newest records and surviving work; review salvageable O code and the outstanding findings; do not blindly restart or accept it.
4. Revalidate source/runtime/space before future jobs. Reuse completed baseline probes/tests where applicable; separate runtime trials from feature checkpoints. Parent synchronizes every completed milestone against actual evidence.
5. Benchmark visual judgment remains an independent user gate. Its unfinished research does not block independent technical work, and this plan does not adopt its winners/defaults.

## Verification of this planning pass

[interrupted-source-manifest.json](interrupted-source-manifest.json) records97 small non-documentation source/test/tool files at entry. It excludes large media/binaries and does not claim whole-disk integrity. [Final verification](planning-verification.json) confirmed all97 unchanged, no additional non-documentation file, unchanged HEAD8bac91f and49 resolving local references across the plan/contracts/review appendices. No commit, reset, branch switch, stash, push or release was performed in this pass. Existing application changes remain uncommitted and recoverable in place.

Static board screenshots: [desktop Encode](Workspace_Encode_1440.png), [small-window sketch](Workspace_Small_640.png). Rendered at1440px and640×480 viewport; the small page's measured scrollWidth equals640. This establishes artifact readability, not implemented native focus/navigation or media playback. Local document links are checked separately; source URLs describe the inspected authorities and are not publication endpoints.
