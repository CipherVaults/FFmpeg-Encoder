# FFmpeg Encoder Desktop App

A Windows desktop interface for sequential FFmpeg video encoding. Ahmed originally built this project with ChatGPT through manually transferred code. The September 2026 re-entry preserves that work and develops it into a locally verified portable application.

**Current status:** preservation, independent runtime upgrades, main-owned encoding architecture and local protocol hardening are verified. The approved 0.5.0 modernization remains in progress: product behavior is verified through milestone H; portable packaging remains unfinished. See [Current State](0-%20Documentation/01_Current_State.md) for the authoritative milestone status and evidence.

## Target 0.5.0 workflow

Choose input and output folders, select a CPU or NVIDIA H.264/H.265/AV1 profile, review the batch, encode sequentially, and inspect per-file results. Supported SDR video is re-encoded while supported audio, subtitle, attachment, chapter, and metadata content is preserved. Existing outputs are skipped. HDR and ambiguous color cases receive an explicit unsupported reason. Encoding does not continue after the application exits.

The intended distributable is an extracted Windows ZIP folder with the application and matching FFmpeg/ffprobe binaries. It will not require a separate Node.js or FFmpeg installation. Packaging and offline verification are pending.

## Development starting point

The source entry points are `main.js`, `preload.js`, services under `src/`, and separate HTML/CSS/renderer files under `ui/`. Run development with `npm start`, contract tests with `npm test`, and native app/lifecycle/protocol checks with the corresponding `test:*` scripts. Its original `1.0.0` value was scaffold metadata; the historical development sequence is 0.1–0.4, followed by the planned 0.5.x re-entry milestone. Do not interpret an installed dependency, existing media file, or old documentation claim as proof that the new acceptance checks passed.

The preserved baseline is commit `c30d335a62f6296d0c61ef25ad5fba10eb3c8438`, tagged `baseline-2026-09-06`. Development continues on `codex/reentry-completion`. There is no approved GitHub upload or public release at this checkpoint.

## Documentation

- [Architecture](0-%20Documentation/00_Project_Architecture.md): verified starting implementation and target responsibilities.
- [Approved execution plan](0-%20Documentation/09_Approved_Execution_Plan.md): milestone sequence, amendments, and acceptance checklist.
- [Technical reference](0-%20Documentation/03_Technical_Reference.md): encoding, output, telemetry, and HDR contracts.
- [Security and testing](0-%20Documentation/04_Security_and_Testing.md): properties, test scenarios, and evidence limits.
- [Beginner guide](0-%20Documentation/05_How_This_Project_Works.md): how the pieces fit together.
- [Session history](0-%20Documentation/06_SESSION_SUMMARY.md) and [Execution index](0-%20Documentation/07_Execution_Index.md): decisions and actual work.
- [PBS context and migration](0-%20Documentation/08_PBS_Context_and_Migration.md): provenance and preserved historical material.

The application manifest historically declares ISC. FFmpeg and bundled third-party components have their own license obligations; that metadata is not a license grant for those binaries. Exact bundled notices and provenance are required before the portable milestone; public distribution receives a separate review.
