# Process architecture — September 7, 2026

## Outcome

Milestone F replaces the renderer-owned prototype with a main-owned encoding service and an isolated UI. The Electron and media-runtime upgrades were already independently committed (`0dd8542`, `9c25694`). This checkpoint proves the architecture through a restricted local file entry point; custom protocol hardening follows separately.

`main.js` owns the window and explicit close/renderer-loss policy. `preload.js` exposes eight named methods; `src/ipc.cjs` validates window, top-level frame, exact origin and argument count before service validation. The renderer has no Node globals or arbitrary IPC/path/argv access. Only three local UI assets may load; permissions, downloads, navigation, windows and webviews are denied.

`src/encoder-service.cjs` owns canonical folder tokens, immutable prepared settings, selected-file identities, sequential work, cancellation, results and local logs. Input fingerprints are checked around inspection/encoding. The process runner retains each child until close, buffers progress records and bounds probe output/time. Output staging uses an owned temporary directory, validation before publication, exclusive hard links or exclusive copy, and cleanup of only owned incomplete files. Named languages, supported tracks, dispositions, attachment hashes and chapters are validated; Matroska's omitted `und` language is treated as its documented equivalent only for the relevant track types.

Media/profile/HDR decisions are separate pure modules; bounded inspection covers actual beginning/middle/end timestamps. Runtime capability checks use the same argument builder for real eight/ten-bit encodes and full decoding. HTML/CSS/renderer live under `ui/`; superseded root UI files remain recoverable in Git and the original backup.

## Verification

- `node --test tests/*.test.cjs`: **87 passed**, zero failed. Evidence `artifacts/architecture-unit-results.txt`. Includes historical characterizations, modern media/inspection/capability cases, sender rejection, output races, input changes, shared/per-file failure behavior, and cancel/restart ownership.
- `node scripts/app-smoke.cjs`: passed at `artifacts/app-smoke-1788788790959/report.json`. Electron confirms sandbox/context isolation/no Node; unexpected payload rejected; two real files inspected/encoded/validated/published/decoded; subsequent batch skips existing outputs. Setup screenshot visually reviewed.
- `node scripts/lifecycle-smoke.cjs`: passed at `artifacts/lifecycle-smoke-1788788718027/report.json`. Real owned FFmpeg PIDs verified: keep-open retains active process, UI cancel awaits process/temp cleanup and stops the second file, new batch after cancel works, cancel-and-exit leaves no child, and forced renderer crash cancels/cleans/exits.
- Real preservation/inspection evidence: `artifacts/inspection-validation-2026-09-07T08-44-31-810Z/` covers twelve profile outputs and rich AAC/FLAC/subtitle/attachment/chapter media, including long-GOP sample coverage. Twelve main-builder capability encodes also passed.

## Diagnosed failures and corrections

The native smoke harness originally treated an asynchronous polling predicate as ready too early; it now awaits explicit snapshot polling. Output validation exposed Matroska `und` language omission, independently confirmed in raw track metadata and named-language round trips, and received a narrowly scoped regression test. Lifecycle process observation initially used the Windows launch trampoline PID; using the real Electron main PID corrected the observation. Finalization admission remains closed while asynchronous logging completes, preventing a late old-batch callback from touching a new batch.

## Limits, parent synchronization and next action

Native picker and close-dialog choices are substituted by the automation harness; that does not prove native OS interaction. The custom protocol, broader end-to-end profile/preservation/UI matrix, packaging and offline extracted-app acceptance remain incomplete. No public or GitHub changes were made. The parent reconciled Current State, Roadmap, acceptance gates, Execution Index, Session Summary and affected technical architecture against the above evidence before committing F. Next: implement and test the custom `app://` asset protocol independently, then complete H/I acceptance.
