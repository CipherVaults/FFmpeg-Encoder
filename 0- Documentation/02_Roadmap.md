# Roadmap

The March roadmap is preserved in the legacy archive. This active roadmap implements the September 6, 2026 handoff and Ahmed's eight amendments. It records reality as work progresses; an approved row is not a completed row.

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

See11_Approved_0.6_Goal and12_Approved_0.6_Plan. J inspection reuse: accepted September 9 after153 passing tests, preserved60-file performance, supplemental59-file UI evidence, independent review and parent synchronization. K same-folder provenance/publication: pending. L remembered workflow/compact preview/helpers: pending. M integrated separate portable0.6 acceptance: pending. No0.6 endpoint tag exists. Historical A–I remain accepted.
