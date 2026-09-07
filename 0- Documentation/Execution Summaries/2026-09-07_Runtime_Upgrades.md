# Runtime upgrades — September 7, 2026

This report separates dependency changes from application behavior changes. The original `main.js`, `renderer.js`, and `index.html` remain unchanged during these upgrades. New architecture modules under development are not loaded by the old application and are excluded from runtime checkpoint commits.

## Baseline and tooling

The source baseline is `c30d335` / `baseline-2026-09-06`; historical characterization and the native smoke harness are checkpointed in `7b7b5c8`. The full original was backed up and every file verified before development. On Electron 41.0.2 and the March 12 FFmpeg build, the native smoke test produced and fully decoded two generated H.265/AAC outputs. Report and screenshots: `artifacts/legacy-baseline/1788732750752/`; 12 historical unit checks pass. Native folder dialogs were substituted, so this proves the button/IPC path but not OS picker interaction.

Package metadata now follows `0.5.0-dev.1`; the original `1.0.0` was scaffold metadata, not a release. Playwright 1.63.0 is pinned as a development test dependency. npm audit at the original Electron version reported two high-severity affected packages (Electron and its extract-zip dependency). This is a dependency inventory, not a claim that every advisory has an exploitable application path. The independently tested Electron upgrade is next.

## Electron upgrade

Electron 44.2.0 is installed and the unchanged app passes the same two-file native smoke using the original FFmpeg executable. Evidence: `artifacts/electron-upgrade/1788750886490/report.json`, September 7 at 06:14:49 Cairo. Runtime reports Chromium 152.0.7977.76 and Node 24.20.0. The original FFmpeg hash still matches `7D4B7BE4498D2677DAF2888CB15A62ED14DD8779FEE2410EDE9B6885A58D578B`. npm audit reports zero vulnerabilities after this upgrade.

Recovery: the first launch failed because the Electron 44 npm package no longer contained the historical automatic postinstall hook and its runtime `dist` directory was absent. Inspection of the installed package's `install.js` established the supported checksum-verified installer. Running `node node_modules/electron/install.js` corrected the local dependency. The project now invokes that installer in its postinstall script so fresh `npm ci` also provisions the pinned executable. No application security settings were weakened to fix startup.

## FFmpeg and ffprobe upgrade

Gyan's matching 9.0.1 full build is now activated after Electron checkpoint `0dd8542`. Publisher SHA-256, GitHub asset digest, archive integrity, binary hashes and version commands match. `resources/binary-manifest.json` and `scripts/provision-ffmpeg.ps1` make the installation reproducible, with unchanged license/readme notices. Full source redistribution compliance remains a separate external-release requirement.

The unchanged app passes the same native smoke with the new pair: `artifacts/ffmpeg-upgrade/1788750954779/report.json`. All twelve candidate encoder combinations (six CPU/NVIDIA profiles, each eight- and ten-bit SDR) pass real short encoding, probing and decoding: `artifacts/encoder-validation-2026-09-07T03-16-28-554Z-685a17/report.json`. This includes NVIDIA H.264 High10 on the current machine. These results establish working arguments and local capability, not quality-number equivalence, universal driver support, or preservation through the new application architecture.

The first synthetic encoder matrix failed before encoder initialization because strict pixel-format negotiation exposed missing BT.709 metadata on the generated input. The fixture was explicitly tagged; strict format checks were retained and all cases rerun. This was test-fixture correction, not a reason to weaken production color/pixel preservation.

## Next checkpoint

Commit each successful runtime upgrade independently with its manifest, exact version, native smoke evidence, dependency audit, and rollback reference. Do not interpret upgrade smoke tests as verification of the new queue, security boundary, encoder profiles, or portable packaging.
