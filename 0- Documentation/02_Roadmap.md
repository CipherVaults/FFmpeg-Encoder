# Roadmap

The March roadmap is preserved in the legacy archive. This active roadmap implements the September 6, 2026 handoff and Ahmed's eight amendments. It records reality as work progresses; an approved row is not a completed row.

## Re-entry milestone 0.5.0

| Stage | Outcome | State at documentation bootstrap |
|---|---|---|
| A — Preservation | Full verified backup, D: working copy | Complete; see baseline execution report |
| B — Existing baseline | Unchanged source Git checkpoint and controlled old-runtime behavior evidence | Complete: source c30d335, harness7b7b5c8, 12 characterization tests and real successful-flow smoke; native picker not covered |
| C — Context and versioning | Project-specific AGENTS, preserved history, current docs, 0.5.0-dev.1 metadata | Documentation prepared and manifest normalized; parent coordinates checkpoint |
| D — Electron | Upgrade Electron alone and compare baseline behavior | Pending |
| E — Media runtime | Upgrade matching FFmpeg/ffprobe pair, record versions/hashes/capabilities | Pending |
| F — Process architecture | Narrow preload, isolated renderer, validated IPC, main-owned plans/queue/lifecycle/output/progress | Pending |
| G — Local protocol | Custom app protocol, asset allowlist, CSP/navigation/traversal verification | Pending after F is proven |
| H — Complete workflow | Validated CPU/NVIDIA SDR profiles, stream preservation, preview/results, responsive UI | Pending |
| I — Local acceptance | Portable Windows ZIP, real-encode and offline extracted-app verification, synchronized docs, 0.5.0 checkpoint | Pending |

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
