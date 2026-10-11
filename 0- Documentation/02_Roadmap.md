# Roadmap

## Approved pre-0.7 research — October 10, 2026

October11: **Paused — awaiting user visual review**. [Durable handoff and sourced v0.7 inventory](21_Phase1_Pause_Resume.md) preserve completed calibration/assets/access evidence and pending judgments/finalists/held-outs/recommendations. Planning can define diagnostics, compatibility/preservation/ctime, CPU-only presentation, HDR design and later UI polish independently of benchmark winners; a bounded approved development Goal is still required. No new presets/defaults, Phase2 or application implementation. Current linked pause record outranks historical next-action notes below.

Latest access-only update: Chrome entry retained and existing source/reference/A/B motion visibly verified in MPC-HC without decoder/renderer changes. Historical black/error cause remains unproven; all43 playback not claimed. Statistics preference hidden reversibly. Five focused checks and independent scripts review pass; [playback addendum](Execution%20Summaries/2026-10-10_Visual_Review_Access.md). Native-picture pending text below is historical. **Human judgment still blocks campaign continuation**; no new encodes, mapping/media/production changes.

Visual access complete: working **FFmpeg Visual Review** Desktop shortcut, existing six-scene interface, all129 stills browser-verified, selected candidate playback and explicit MPC-HC alternative, copyable response, five focused checks and independent review. Native-player picture confirmation remains pending. [Access report](Execution%20Summaries/2026-10-10_Visual_Review_Access.md). **Human preference gate remains unchanged**; no new encodes/finalists/held-outs or application changes. Prior browser limitation below is historical.

Calibration18 and native review assets complete. **Waiting for Ahmed's visual judgment**, with a runner guard preventing further encoding. See [gate report](Execution%20Summaries/2026-10-10_Phase1_Calibration_Review.md):139 actual encodes/45 checks, independent refinement review,43 clips/129 native stills; browser rendering limitation explicit. Frozen finalists/protected recipe settings, original held-outs/three timing repeats/NEG, playback and final data/report/charts/independent closure remain pending. The next paragraphs preserve earlier stage history.

Reduced B23 is independently accepted; the [B report](Execution%20Summaries/2026-10-10_Phase1_Generalization.md) records difficult-scene deficits and A/B counterexamples. All A/B Archive29 anchors are complete. Next: four CD-B challenges and up to14 AV1 CQ32 comparisons, within18 refinement slots. SVT preset diagnostics/optional ablations are deferred to protect measured comparability and native visual review. Support32/candidate284/diagnostic24 retains340 total. Human visual freeze, original held-outs, repeated timing, protected recipe/NEG comparisons, playback, report/charts and independent final closure remain pending. Accepted application behavior stays unchanged.

The [Phase1 benchmark Goal](18_Phase1_Benchmark_Goal.md) is separate from application0.7. Accepted0.6 remains unchanged. [Pilot acceptance](Execution%20Summaries/2026-10-10_Phase1_Pilot.md) covers20measured cases/6warm-ups,24focused checks and independent calculation/frame/argv review. Next is bounded A calibration followed by measured resource reallocation; full nominal breadth is conditional on12h capacity. Mandatory Archive29/protected recipe pairs remain. Human visual freeze, held-outs/repeated timing/playback and final report/charts/independent closure are pending. No0.7code/ctime/Phase2 or production preset change is authorized.

The March roadmap is preserved in the legacy archive. This active roadmap implements the September 6, 2026 handoff and Ahmed's eight amendments. It records reality as work progresses; an approved row is not a completed row.

Quiet A anchors accepted36/36 with independent integrity review;33focused checks pass. [Anchor report](Execution%20Summaries/2026-10-10_Phase1_Anchors.md) narrows next search to20empirically justified points, then measured gap/refinement and reducedB. All protected original held-outs remain. Human visual freeze and final campaign acceptance are still pending; this is no production acceptance.

Phase1 timing qualification: initial pilot content/metrics pass, but concurrentOBS invalidated clean speed comparisons. OBS is now stopped after Ahmed's response. The bounded A block supplies necessary quiet replacements; preserve original data and protected validation budget. This affects benchmark evidence only.

## Re-entry milestone 0.5.0

| Stage | Outcome | Verified state |
|---|---|---|
| A — Preservation | Full verified backup, D: working copy | Complete; see baseline execution report |
| B — Existing baseline | Unchanged source Git checkpoint and controlled old-runtime behavior evidence | Complete: source c30d335, harness 7b7b5c8, 12 characterization tests and real successful-flow smoke; native picker not covered |
| C — Context and versioning | Project-specific AGENTS, preserved history, current docs, 0.5.0-dev.1 metadata | Complete: 787bf94, 14c874f and archive byte preservation 53ce087 |
| D — Electron | Upgrade Electron alone and compare baseline behavior | Complete: 44.2.0 with original FFmpeg, native successful-flow smoke passed, checkpoint 0dd8542; see runtime report |
| E — Media runtime | Upgrade matching FFmpeg/ffprobe pair, record versions/hashes/capabilities | Complete: 9c25694; unchanged native smoke and twelve standalone encoder cases pass |
| F — Process architecture | Narrow preload, isolated renderer, validated IPC, main-owned plans/queue/lifecycle/output/progress | Complete: 87 checks plus real app/lifecycle smoke; see Process Architecture report and its commit |
| G — Local protocol | Custom app protocol, asset allowlist, CSP/navigation/traversal verification | Complete: 89 automated checks, native protocol/security checks and real app flow; see Local Protocol report |
| H — Complete workflow | Validated CPU/NVIDIA SDR profiles, stream preservation, preview/results, responsive UI | Complete: Product Acceptance report maps actual endpoint, profile, preservation, native picker and 25 layout checks |
| I — Local acceptance | Portable Windows ZIP, real-encode and offline extracted-app verification, synchronized docs, 0.5.0 checkpoint | Complete: Portable Acceptance report, exact artifact hashes, independent review and parent synchronization; local-v0.5.0 |

Maintain an independent recoverable commit at every meaningful boundary. Keep runtime changes separable from architecture changes so a failure can be attributed and a checkpoint reverted without losing unrelated work.

## Connection to the historical roadmap

- Historical Phase 1 introduced the prototype. Re-entry revalidates its behavior rather than assuming it passed modern acceptance criteria.
- Phase 2 quality controls become validated encoder profiles and effective settings.
- Phase 2.5 becomes preload isolation, validated IPC, process ownership, safe cancellation/restart, and output protection.
- Phase 2.6 becomes HTML/CSS/renderer separation and practical layouts from 720p through 4K/DPI scaling, preserving the existing setup → monitor → results workflow.
- Phase 3 is scoped to CPU and NVIDIA in 0.5.0. Intel QSV and AMD AMF remain future work.
- Phase 4 becomes structured progress, real duration, output size, speed/FPS, elapsed time, and meaningful ETA/indeterminate behavior.
- Phase 5 becomes batch preview, selection to resolve colliding destinations, existing-output skips, clear per-file results, and subsequent batches. Arbitrary queue reordering and a separate retry/history system are future extensions unless needed by the approved workflow.
- Phases 6–8 become final usability, portable packaging, and stability acceptance throughout implementation.

## Later work, outside this milestone

HDR preservation/tone mapping, Intel/AMD encoders, background/headless encoding, window restoration, persistent jobs/history, arbitrary FFmpeg arguments, recursive folder processing, advanced queue reordering, public distribution/signing/update services, and broader platform support are not incidental additions to this milestone. Record evidence-backed needs; seek approval for a major direction change.

Private GitHub is intended but separately gated. A later genuinely accepted standalone release may become 1.0.0. Neither repository upload nor public release is necessary to truthfully finish the authorized local 0.5.0 milestone.

## Approved local0.6 archive workflow (September9,2026)

See11_Approved_0.6_Goal and12_Approved_0.6_Plan. J inspection reuse: accepted September 9 after153 passing tests, preserved60-file performance, supplemental59-file UI evidence, independent review and parent synchronization. K same-folder provenance/publication: accepted September10,209 tests, native CPU/NVIDIA endpoint, independent review and parent synchronization. L amended remembered workflow/compact preview/intentional re-encoding/command transparency/Archive Quality: accepted September20 with269 tests, native evidence, independent review and parent synchronization; see the Amended L Workflow report. M accepted September24: fresh portable0.6 at source7b41c0f passes20 cases/four sessions;281 direct tests, current native field evidence, independent review and parent synchronization pass. The final documentation checkpoint is tagged local-v0.6.0. Historical A–I remain accepted.


## September24 field-QA disposition

Samsung stream timestamps are retained with an exact Matroska alias and visible notice; source identity remains strict with field diagnostics and an honest historical-cause limit. Decision17 adopts editable CQ29 after35 field cases while preserving ordinary defaults and historical Decision15.281 current direct checks and affected native/packaged flows pass. The September24 M report owns final acceptance, the separate ZIP, rollback and evidence limits. No future backlog item is promoted by this closure.
