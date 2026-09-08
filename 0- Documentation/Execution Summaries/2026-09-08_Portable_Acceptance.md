# Milestone I — Local portable 0.5.0 acceptance

Completed September 8, 2026, following H checkpoint `cbd548a`. The commit adding this report and tag `local-v0.5.0` identify the accepted source and synchronized documentation. This accepts the approved local milestone; it does not authorize upload or public distribution.

## Artifact and implementation

- Windows x64 ZIP: `out/FFmpeg-Encoder-0.5.0-win32-x64.zip`, **321,189,914 bytes**.
- SHA-256: `a984e102f1cf404239690e709f585d33028f851bc3e66d914e41f43d334a517f`. The adjacent `.sha256` file records the same value. This convenient copy was created exclusively and hash-compared with the tested build ZIP.
- Build evidence: `out/portable-2026-09-08T09-43-19-255Z-vyav20/build-report.json` and its `zip/` subfolder.
- Native acceptance: `artifacts/portable-acceptance-CImXm7/report.json`; results screenshot alongside it.
- [Compact tracked artifact record](2026-09-08_Portable_Artifact.json) preserves source/resource hashes, test anchors, and scope when ignored local artifacts are unavailable.

The package contains Electron 44.2.0, matching FFmpeg/ffprobe 9.0.1, the 14 application files in ASAR, runtime assets, provenance, portable instructions, and Electron/Chromium/FFmpeg notices. Exactly 79 extracted files matched the build inventory. No development dependencies, source documentation, media, logs, or previous user data enter the package. The builder verifies pristine Electron before branding, every application file, sanitized runtime package metadata, bundled resources/notices, and the final ZIP. Fresh unique build directories preserve failed attempts without overwriting earlier artifacts.

`@electron/packager` 20.3.0 and the existing 7-Zip installation build the ZIP directly. Forge 7.11.2 introduced 24 dependency advisories; trying the patched Packager exposed an incompatible callback-hook API in Forge. Removing Forge and its overrides left the pinned direct toolchain with zero reported npm vulnerabilities (`artifacts/packager-audit.json`). This changes packaging tooling only. The application has no npm runtime dependencies beyond its embedded Electron runtime.

One application correction was required: select/create portable `data` and set both Electron `userData` and `sessionData` before readiness and the single-instance lock. Earlier GPU/network processes had selected the default AppData path before the old window-time configuration. All observed Electron children now use adjacent portable data; explicit development `--user-data-dir` remains supported. Startup failures retain the error dialog and exit behavior.

## Requirement-to-evidence review

| Requirement | Observed evidence |
|---|---|
| Exact portable executable/resources | ZIP integrity and all 79 extracted files matched; executable, ASAR, binaries and notices matched recorded hashes. Actual packaged version was 0.5.0, Electron 44.2.0, Chromium 152.0.7977.76, embedded Node 24.20.0. |
| Isolation from development location | Extracted into `artifacts/portable-acceptance-CImXm7/Extracted العربية folder`; launched the real executable from a separate working directory with PATH restricted to `C:\WINDOWS\System32`. No user-data override supplied. Main and Electron children used adjacent data/resources. |
| Profiles and boundary retained | All six profiles and their twelve eight/ten-bit capability cases initialized using bundled binaries. Renderer had no Node `require`/`process` and exactly eight named bridge methods; loaded `app://encoder/index.html`. H evidence remains authoritative for full profile/settings/preservation/UI coverage. |
| Operation with network unavailable | A loopback control fetch first succeeded using a direct connection, then failed with `ERR_PROXY_CONNECTION_FAILED` under a fixed unreachable proxy with loopback bypass disabled. The unchanged production session resolved to the same proxy, while launch DNS/proxy restrictions remained active. Its bundled UI reloaded and local workflow completed. |
| Real encode and skip | Two H.264 CPU outputs completed, were probed for expected codec/color and fully decoded. Preparing again skipped both existing outputs with Start disabled and unchanged hashes. |
| Cancel and subsequent batch | Real bundled H.265 child PID 30884 belonged to actual main PID 22600. Cancel produced one cancelled and one unprocessed item, no output/temp residue, and exact child disappearance. A distinct subsequent batch completed two more outputs, both fully decoded. |
| Output/source protection and shutdown | All four source fixtures and four completed outputs retained their hashes through the entire workflow and shutdown. Actual main/observed media PIDs were absent, no remaining owned media child, no page errors, no cleanup errors. |
| Relevant regression | `npm test` passed 89/89 after the early portable-data correction; output at `artifacts/i-final-unit-results.txt`. Completed H and F/G evidence was reused because media/queue/security/UI implementation was otherwise unchanged. |

The independent reviewer inspected the actual build/native reports and current harness, independently matched all 14 current source hashes, and found no remaining material local-runtime acceptance gap. The parent inspected the results image and reconciled Current State, Roadmap, acceptance gates, Architecture, Technical Reference, Security and Testing, beginner guide, README, CHANGELOG, Execution Index, Session Summary, and continuation state before the final checkpoint.

## Diagnosed attempts and evidence limits

The first build assertion expected the development manifest byte-for-byte; Packager intentionally removes scripts/development dependencies. The corrected assertion requires precisely that sanitization while preserving source and ASAR hashes. The 04:42 build was later superseded by the early portable-data correction; only the 09:43 build above is accepted.

The first native attempt (`K61GMa`) exposed Windows PowerShell's redirected Unicode encoding mismatch. UTF-8 output fixed exact process-path comparison. Its early cleanup lacked a usable main identity and encountered the active-startup close prompt; only the exact observed test app processes were stopped, before any product encode had begun. Later failed attempts shut down cleanly.

Nominal offline controls were insufficient evidence: Electron session emulation, Playwright's legacy CDP call, and explicit CDP navigator controls left `navigator.onLine` true; a later direct network control also still fetched under nominal session offline emulation. These failures are preserved in `aGyF4s`, `r8rJJC`, `pNZSyJ`, and `HJaTon`. `Gn7bjD` exposed the need to exempt the control's literal loopback address from the test resolver rule. The final test uses independently verified proxy transport failure, not an assumed API effect or a JavaScript online-property stub. The final report truthfully records `navigator.onLine: true`.

This is **same-machine Windows portability with verified Chromium network transport isolation**, not a physically disconnected or clean-machine test, nor a sandbox for hypothetical main-process Node sockets. The application has no network workflow. Native dialog returns are substituted here; H separately verifies real Windows folder selection, while F's close choices remain substituted in otherwise real lifecycle tests. No cross-GPU, full format/preset cross-product, perceptual quality, or complete HDR-content certification is claimed. Abrupt OS/power loss and filesystem-specific publication limitations remain documented in Technical Reference.

The package is unsigned. Its notices/provenance are not a complete corresponding-source distribution or written source offer. GitHub/upload, licensing review for external distribution, signing, public release, clean-machine acceptance, and the future 1.0.0 remain separate work. The original and verified backup were preserved.

Relevant primary tooling references: [Electron session APIs](https://www.electronjs.org/docs/latest/api/session), [Chromium network emulation controls](https://chromedevtools.github.io/devtools-protocol/tot/Network/), and [Electron Packager](https://electron.github.io/packager/main/). Observed runtime behavior above takes precedence over assuming that an API call achieved its intended effect.
