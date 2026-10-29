# Claude Code handoff — FFmpeg Encoder
Prepared for Ahmed · October 29, 2026

Ahmed is handing you the lead and integration role for continued FFmpeg Encoder 0.7 development. The full project documentation has also been added to this Claude project's Context. Use that context together with the live repository, the local documentation, the Notion project hub, and the current GitHub branch. This prompt is a handoff map; it does not replace those project records.

## Your first responsibility: understand before editing

Before changing code, tests, documentation, Git state, Notion, or running any media or desktop operation, complete the read-only orientation below. Treat the October 29 instruction from Ahmed in this handoff as the later owner continuation that supersedes the October 26 temporary pause for the bounded non-HDR work described here. Do not revive unrelated older permissions or historical instructions.

### Mandatory system skill

Ahmed requires you to study and apply **The AI PBS (The AI Project Bootstrap System)** before continuing development. The installed local skill is:

**C:\Users\Ahmed\.codex\skills\pbs-start-resume-handoff\SKILL.md**

The skill identifies itself as **PBS Start, Resume & Handoff, method version 1.1**. Read the actual installed file at that path; do not rely on this summary alone. Read the full “Interrupt or hand off” lifecycle prompt and the relevant bundled guides, especially execution-environment verification, recovery/governance, documentation maintenance, and session/execution records. Follow linked references needed for this handoff and apply PBS at the real project boundary.

1. Record the exact skill name, version, source path, and which procedures you applied.
2. Explain how PBS governs this project's recovery, authority, source-of-truth hierarchy, evidence review, milestone plan, execution, verification, documentation, and return handoff. Keep owner permission, observed state, and acceptance distinct.
3. Use PBS as the primary system method for this continuation. If Claude has an equivalent installed skill entry or project-context copy, inspect it and reconcile it with the installed file above; do not invent a different method or silently substitute another skill.
4. If the stated path is inaccessible in Claude's execution environment and no authoritative equivalent is available in the project Context, complete only the independent read-only study and tell Ahmed exactly what could not be read. Do not edit code or start a dependent implementation until the PBS prerequisite is resolved.

### Recover the actual project state

Use this project root as your intended working copy:

**D:\Claude's Projects\FFmpeg Encoder**

Documentation root:

**D:\Claude's Projects\FFmpeg Encoder\0- Documentation**

Private GitHub repository:

**https://github.com/AE0101/FFmpeg-Encoder**

Expected candidate branch:

**codex/v0.7-candidate**

The October 29 read-only handoff check found this Claude checkout at commit **8ef7ad19122c99c5190c580ea466820a4e149621**, with extensive uncommitted documentation and application/test work. The remote candidate branch also resolved to 8ef7ad1 at that check. These are dated observations, not permission to assume today's state: verify branch, HEAD, upstream, remote privacy/access, index, working tree, untracked and ignored evidence, and relevant hashes before acting.

The separate Codex checkout is **D:\Codex Projects\FFmpeg Encoder**. Do not assume the two working trees are identical because their branch names or HEADs match. Do not reset, clean, checkout over, rebase, overwrite, or discard any existing change. Keep the current candidate history and all uncommitted work recoverable. The owner intends the Claude path above to be your work area.

## Controlling project direction

The project is a Windows desktop video encoder and media-workflow application. Its product aims include understandable quality choices, reliable long-running jobs, protection of source media, safe and useful encoding/remux workflows, trustworthy hardware capability handling, and a coherent desktop experience.

Ahmed's current direction is:

- Continue eligible **non-HDR 0.7 work** in dependency order: finish P01–P04, then eligible Q, then R, then S.
- **HDR P05–P09 is explicitly excluded from this continuation.** It remains experimental/alpha, partial and deferred. Preserve its code, research, tests, failures, limitations, and return points. Do not implement HDR expansion, rerun HDR qualification, reseal HDR producer catalogs, or call P complete because HDR work is deferred.
- Do not skip a material prerequisite in the milestone order. If live evidence reveals a dependency or authority conflict, document the exact conflict and continue only independent work already within scope.
- Packaging is last, after applicable final-source feature and interaction review, fixes and retests, and qualification of both installer and portable packages.
- Accepted local 0.5.0 and 0.6.0 remain protected. The 0.7 alpha is not accepted or released.
- Preserve ordinary defaults, Archive CQ29, the separate benchmark and its pending owner visual review, originals, private Planning records, all 43 requirement IDs and texts, and all failed/successful evidence.
- The October 26 records prohibit Security Cloud use and public-release inference. Continue to honor that boundary. Do not change default behavior, Archive CQ29, the benchmark, accepted tags/releases, or publish a release.
- One canonical repository writer/integrator is responsible for reconciling changes and evidence. That role transfers to you for this handoff; Ahmed remains the owner and acceptance authority.

## Read and reconcile these sources

Start with the live project instructions and current records, then follow references and dated evidence. Preserve chronological context; old headings that say “active,” “next,” or “current” are not automatically current authority.

1. Read the effective project instructions in **AGENTS.md** and the project entry documents **0- Documentation/01_Current_State.md** and **0- Documentation/10_Continuation_State.md**.
2. Read the latest recovery and authority owners: **0- Documentation/34_0.7_Paused_Documentation_Reconciliation_2026-10-26.md**, **0- Documentation/Execution Summaries/2026-10-26_Non_HDR_Reconciliation_and_Continuation.md**, **0- Documentation/33_0.7_Non_HDR_Completion_Amendment_2026-10-26.md**, and **0- Documentation/32_0.7_Final_Regression_and_Installer_Amendment_2026-10-23.md**.
3. Read **06_SESSION_SUMMARY.md**, **07_Execution_Index.md**, Goal 23, contracts 24 and 26, requirements/evidence 25, the reviewed/approved plans and amendments 27, 28, 31, and the architecture, technical, security/testing and project-operation guides. Use the index to locate the evidence for each claim.
4. Build an inventory of the full **0- Documentation** tree. Classify current authority, accepted contracts, technical architecture, execution evidence, session history, planning, and immutable/archive material. Read the controlling and next-milestone sources fully; follow evidence references needed to understand why decisions changed. Do not mistake an inventory or compact summary for full study.
5. Read the pause receipt **artifacts/v0.7/non-hdr-completion-2026-10-26/native-runtime-pause-2026-10-26.json** and its Markdown counterpart, the additive **native-runtime-paused-wip-2026-10-26/** snapshot, and the reconciliation audit/readback receipts in that artifact directory. Preserve the original paused snapshot and all later before-copies.
6. Inspect the actual application architecture and the current work relevant to P01–P04. Understand the Electron main/preload/renderer boundary, main-owned service and scheduler, capability discovery, provenance/evidence model, native builder/runtime draft, and the existing remux workflow. Tie each explanation to actual files and tests. Do not infer integrated product behavior from isolated modules.
7. Read the Notion hub and its current linked roadmap, planning ground, Blue handoff, and the relevant P/Q/R/S feature cards. The known hub is [FFmpeg Encoder — Project Hub](https://app.notion.com/p/FFmpeg-Encoder-Project-Hub-3f2bd7ade63b8137a25ccedb3c87c381?source=copy_link). Also inspect the [0.7 Planning Ground](https://app.notion.com/p/3e5bd7ade63b81d5a7fcd46a0a753aae), [Human Roadmap](https://app.notion.com/p/3d6bd7ade63b817e9a55d61cf203bb9e), and [Blue — Handoff](https://app.notion.com/p/3f3bd7ade63b818f96c3ebb4ac44a187). On October 29 their fetched content still reflected October 26; fetch again and record freshness. The October 29 owner instruction in this handoff supersedes their October 26 pause banner only for the scope above. The Notion hub or card is an orientation/tracking source; live artifacts and canonical local records establish what is actually implemented and verified. Keep the initial study read-only.
8. Check whether the October 26 request for an urgent cumulative session-summary correction is already satisfied in the current local records. Record what you find. Do not silently claim it was completed just because the documentation reconciliation finished.

Keep evidence dimensions distinct: what a run did, whether the evidence applies to current bytes, and whether a requirement or product decision is accepted. Do not request or reproduce private hidden reasoning; provide concise conclusions supported by artifacts.

## Known checkpoint to validate against the live tree

These are orientation facts from the October 26 reconciliation, not substitutes for your own readback:

- N is verified. O is technically complete within O01–O08. P, Q and R remain partial; S is pending.
- The latest committed/private-verified checkpoint is 8ef7ad1. Current local work includes **14 uncommitted application/test files** and a larger set of documentation and preservation artifacts. Reconcile their exact identities before touching them.
- Commit 8ef7ad1 includes a finite native H.264 8-bit, BT.709, Full/KeepSource, video-only Matroska command builder. It binds a branded source contract/probe, canonical AMF CQP/QVBR or QSV CQP/ICQ contributions, and matching native-v2 descriptive provenance. It preserves stream mapping and metadata/time behavior and uses constrained local path and .mkv stage assertions. The reported 22 focused and 68 compatibility checks and independent reviews apply to that committed builder version. It is **not wired or qualified as a production native-file policy**: policies remain zero, with no Ready/Start/publication authority.
- The uncommitted native-file runtime draft adds selected-source and device binding, owned tool discovery, child/EOF/runner/sink closure, retained staging, same-child mode observation, and fixed evidence roles. It is unfinished and outside the normal application service. The complete oracle, validation, publication, and lifecycle proof are missing.
- Saved test provenance is version-specific: tool-owner 17 passes are from an intermediate source; the earlier 48-test runtime/source/service attempt ended Node 1 with 46 passes and two raw-fixture timeouts and remains failed; the corrected runtime-only 9 passes are from another intermediate state. Later edits for generated-source/lease/digest/role behavior, the output bitexact flag, and the complete-file template observer were not run as a final tree. That observer was unreviewed and untested. Do not add these counts together or present them as current-tree acceptance.
- These software tests used synthetic children, real Node pipes, and small owned byte files. They are not actual FFmpeg encodes, media-source proof, device qualification, or GUI acceptance.
- Native file production policies remain 0; the existing production remux routes remain 3. Current raw qualification producer drift was HDR 12/69 and Full 7/32, without resealing. Re-read live state before repeating counts.
- Earlier Q07/Q08 remux evidence is preserved. One finite lab MKV-to-MP4 video-only publication preserved 41 complete native video frames, meaningful metadata and rational timestamps, with explicit omission of two AAC tracks and disclosed vendor/average-rate warnings. A separate earlier packet remains FAILED_RETAINED because a metadata-role cap blocked cancellation setup; do not erase the failure because one job published. The six-child preparation-only recovery reached Ready, Cancel, and real STALE_PLAN refusal with zero FFmpeg starts/jobs/publications. This does not qualify the production remux route; no prior job should be replayed without a new justified, bounded plan and authorization.
- P06/P07 HDR investigation evidence, including the failed-before-encode P07 probe and retained source copy, remains historical research. It does not reopen HDR work or grant a replay budget.

## Deliverable from your first pass

After finishing the skill study and read-only project study, return a concise but evidence-rich **Project Understanding and Execution Readiness** report before editing. Include:

1. The exact checkout, branch, HEAD, remote branch, index and working-tree state; distinguish repository state from the documentation snapshot.
2. A short architecture map and the real trust boundaries, identifying which process owns source selection, capabilities, job authority, output validation and publication.
3. A milestone table with accepted, complete-in-scope, partial, deferred, and pending distinctions. Show P01–P04 separately from excluded HDR P05–P09.
4. A requirement/evidence map for the next eligible non-HDR work, including current source hashes or identities, applicable tests, failed runs, stale evidence, and missing proof.
5. A clear account of the system skill: exact version/path, its operating steps, and how you will apply it to FFmpeg project continuation. Note any unavailable reference.
6. A list of material conflicts or ambiguities, including the cumulative-summary request and any difference between local docs, Notion, Context, and the live checkout.
7. The first concrete bounded P01–P04 action you propose and why it is the correct next step, plus its verification and documentation plan.

Do not provide a private chain of thought. Give evidence, decisions, uncertainties, and reasons in concise, reviewable form.

If the skill is available and the readback reveals no material authority or preservation conflict, continue the authorized non-HDR work after this report: choose the smallest dependency-correct unfinished P01–P04 task from the live 43-requirement record and surviving artifacts. If something material blocks safe execution, preserve the workspace and ask Ahmed one focused question while continuing any independent read-only work.

## Operating boundaries during implementation

- Work from the specified Claude checkout. Preserve all uncommitted source, tests, local documents, failed outputs, backups, snapshots, accepted records and private Planning evidence. Before any edit, identify and back up the exact files that will change according to project practice.
- Use evidence-driven, small steps. Review the design and security implications before implementation; test the final changed bytes and applicable consumers; obtain independent review where required by the project contract. Report skipped, failed, inconclusive and unavailable checks honestly.
- Do not run, replay, or expand media/device/native GUI work on the basis of old budgets or historical success. Revalidate the needed authorization, exact scope, input ownership, resource/lease rules, process handling and stop conditions before any such operation. A prior PC-free response is dated and does not establish current desktop availability.
- Do not work on HDR P05–P09, HDR producer reseals, HDR media qualification, Security Cloud, benchmark, ordinary defaults, Archive CQ29, accepted release artifacts, public publishing, or packaging during this continuation.
- No destructive cleanup, history rewrite, force push, branch replacement, remote migration, dependency/runtime upgrade, or personal-media writes.
- Current project records authorize tested, scoped commits and updates to the verified existing private candidate remote. Reconfirm the remote and exact diff first. Keep each commit bounded and reviewable; never push untested or unrelated WIP.
- Maintain the project's local Markdown source of truth and session/execution records. Update only the records whose facts actually change, preserve historical text, and use exact links/evidence. Read Notion during orientation; make no Notion edits during the study phase. Any later operational update must be narrowly scoped and read back.
- Stop at the completed bounded task, a real blocker, or a decision gate. Return a durable checkpoint that identifies exact changed files, commit/remote state, tests and their applicability, unresolved requirements, preserved failed evidence, and the next permitted action. Technical completion is not Ahmed's product acceptance.

