# Execution Summary — Preservation and legacy baseline

## Task and context

Preserve Ahmed's existing FFmpeg Encoder before physical changes, establish recoverable local Git history, and verify existing behavior before independent runtime upgrades. Execution follows the approved September 6 re-entry plan and eight amendments. This report begins with September 6 preservation and includes the explicitly dated September 7 verification continuation.

## September 6: preservation and source checkpoint

The original is `C:\Users\Ahmed\Desktop\ffmpeg-ui`. The full backup is `D:\Codex Projects\FFmpeg Encoder - Backups\2026-09-06_211556\ffmpeg-ui`; the working copy is `D:\Codex Projects\FFmpeg Encoder`.

The backup's adjacent `source-sha256-manifest.json` and `verification.json` record 974 files and 690,310,811 bytes. At `2026-09-06T21:16:26.8609717+03:00`, every file's SHA-256 matched source → backup → working copy. These evidence files were re-read during documentation bootstrap. No source deletion or editing occurred as part of preservation.

Commit `c30d335a62f6296d0c61ef25ad5fba10eb3c8438` at September 6 21:16:56 Cairo preserves unchanged `main.js`, `renderer.js`, `index.html`, `package.json`, and `package-lock.json`, plus the new `.gitignore`. Tag: `baseline-2026-09-06`. Branch: `codex/reentry-completion`. The full backup retains dependencies, binaries, media, and raw context that are intentionally outside the source Git commit.

## September 7: behavior evidence

The baseline harness is separately checkpointed as `7b7b5c8`. `node --test tests/legacy-baseline.test.cjs` passed 12/12 characterization tests. The durable TAP output is `artifacts/legacy-baseline/1788732750752/unit-results.txt`.

Seven tests characterize existing defects: main ignores selected settings; an old close callback clears newer process ownership; the child lacks a spawn-error handler; monitor settings differ from the actual request; cancellation followed by successful close advances the queue; rejection leaves Start disabled and retains the timer; and a duration record split across stderr chunks is lost. Five positive cases preserve extension filtering/alphabetical sequential order, successful completion/timer cleanup, exit-code resolution/rejection, whole-record progress parsing, and empty-input handling. A passing defect characterization means the defect is reproducible, not fixed.

`node scripts/legacy-native-smoke.cjs legacy-baseline` exercised the real Electron window and original FFmpeg. The report at `artifacts/legacy-baseline/1788732750752/report.json` records completion at `2026-09-06T22:12:34.714Z` (September 7 01:12:34 Cairo), Electron `41.0.2`, and FFmpeg `2026-03-12-git-9dc44b43b2-full_build-www.gyan.dev`.

The harness generated two one-second 320×180, 24fps, BT.709 SDR H.264/AAC inputs in its own artifact directory. Real UI clicks and IPC selected the folders through a substituted native-dialog boundary. Two sequential H.265 CPU outputs were produced, completion count was 2, Start was enabled, both outputs decoded fully, and no page errors were captured. Setup/completed PNGs were inspected by the parent execution agent. The documentation agent independently read the report and harness; no broad native-UI claim is inferred from them.

## Verification limits and problems

The native Windows folder picker itself was not exercised: its return values were substituted. The real smoke covers the successful batch path, while known defects are characterized separately. This evidence does not prove safe cancellation, renderer isolation, stream preservation, HDR handling, new profiles, portable packaging, or the newer runtime. No irreplaceable user media was used for the generated-fixture smoke.

## Documentation and next step

The active documentation corrects historical stability/security claims without modifying the archived source wording. Backup/source checkpoint and baseline verification gates are complete. Continue independently with documentation/version context, Electron upgrade, matching FFmpeg/ffprobe upgrade, and then architecture work. Runtime changes and later tests belong in their own execution report/checkpoint.
