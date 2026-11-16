# FFmpeg Encoder — Blue Linux development

An experimental Linux development fork of FFmpeg Encoder. It follows the original Windows application's theme, interface design and v0.7 roadmap, adapting platform-specific pieces for Linux rather than inventing a separate product. CPU encoding and shared Electron/JavaScript work developed here can later be reviewed for reuse in Windows.

**Active development branch: `blue/linux-development`.** The fork's `codex/v0.7-candidate` branch is a different line of history; changes do not move between them automatically. This is not a packaged Linux release or an accepted 0.7 product.

## What works so far

The isolated Linux demo has been tested on Linux x64 with Electron 44.7.0 and the explicitly pinned Debian FFmpeg/ffprobe 7.1.5 executables:

- Synthetic H.264, H.265 and AV1 CPU encoding through a sandboxed desktop UI.
- Editable CPU settings, one job at a time, cancellation and orderly close.
- Validation before output publication and refusal to overwrite existing files.
- A temporary-output preflight that checks exclusive publication and collision preservation.
- A native picker and read-only MP4-family and Matroska/WebM metadata display. Inspecting a selected file does **not** authorize encoding it; Encode still uses the known synthetic fixture.

The small demo is a development test surface, not the completed original application or its final Linux interface. These are bounded results on synthetic media and one host, not general codec quality, hostile-media qualification or whole-app acceptance. The published MP4 inspection checkpoint at `7ea4b0b6` records **199 passing focused tests, 0 failures and 9 Windows-only skips**. Test counts in earlier reports describe their own checkpoints, not additional non-overlapping coverage. No GitHub CI pass is claimed.

## Start here

1. Read [Linux bootstrap and continuation](LINUX_BOOTSTRAP.md), then the applicable architecture and evidence conventions in [AGENTS.md](AGENTS.md).
2. Check the actual branch, current commit and working tree before editing. Preserve concurrent work and the Windows source history.
3. Read the latest relevant checkpoint below. Its source identity, failures and evidence limits matter more than a headline test count.

| Area | Evidence and continuation |
| --- | --- |
| Synthetic desktop | [Desktop demo checkpoint](linux-blue/DESKTOP_DEMO_CHECKPOINT.md) |
| Temporary output | [Output preflight checkpoint](linux-blue/OUTPUT_PREFLIGHT_CHECKPOINT.md) |
| Read-only source information | [Source inspection checkpoint](linux-blue/SOURCE_INSPECTION_CHECKPOINT.md) |
| MP4 read-only extension | [MP4 inspection checkpoint](linux-blue/MP4_INSPECTION_CHECKPOINT.md) |
| Original product context | [Current State](0-%20Documentation/01_Current_State.md) and [Continuation](0-%20Documentation/10_Continuation_State.md) |
| Earlier recovery kit | [Preserved kit instructions](linux-blue/RECOVERY_KIT_README.md) |

The original product records retain Windows history and requirements. Their Windows-specific run commands, old pauses and evidence are not automatic Linux instructions. Linux checkpoint reports are historical receipts; statements that the runtime was missing describe publication at that time.

## Running and testing

**A fresh checkout has not yet been verified end-to-end.** The owner added the recovery-kit runtime, pilot and tests to this branch in commit `4e9d117`. Their bytes matched the delivered kit. That closes the recorded missing-runtime-file gap, but not the complete setup/recovery check.

The desktop demo still requires its known synthetic fixture, a compatible reviewed runtime and a GUI-capable environment. The generated fixture, FFmpeg/Electron binaries, installed dependencies and raw local receipts are not supplied as a complete ready-to-run bundle. Do not substitute arbitrary media for the fixture or weaken executable pins/sandboxing to get a successful launch.

For the lightweight CPU settings check, run from the repository root with Node:

```sh
node --test linux-blue/ui-policy.test.cjs
```

This tests settings validation only. See the linked checkpoint reports for exact larger test commands and prerequisites; a prior local pass does not prove a new checkout passes.

The tested demo entry is `linux-blue/demo-main.cjs`. Its qualified local launch supplies `LINUX_BLUE_SYNTHETIC_FIXTURE` and an already reviewed Electron executable, as documented in the desktop checkpoint. **Do not use `npm start` as the Linux demo launcher:** the original application entry remains Windows-oriented.

## What remains outside the claim

- Encoding arbitrary selected media, production batch parity and persistent recovery.
- NVIDIA/AMD/Intel hardware qualification, Windows integration and HDR acceptance.
- Installers, portable distribution, complete dependency provisioning and release acceptance.
- A verified fresh-clone recovery of the complete working environment.

## Development rhythm

Use AI PBS 1.1 and the adopted Git/GitHub workflow: one useful bounded change, focused tests, independent review where warranted, a coherent commit and verified remote synchronization. Commit subjects should explain the user-visible change; multiline bodies should state why, scope, checks and remaining limits. A local commit or unattached uploaded object is not proof that a branch contains the work.

Keep credentials, personal media, generated binaries and local application state out of new commits. Preserve original inputs and existing outputs. Keep paths, processes and output authority in main, with a narrow renderer/preload interface. Respect unresolved publication-review restrictions; do not repackage restricted content or change transport to bypass them.

Future integration into the Windows project requires its own reviewed diff and relevant Windows checks. Linux results alone do not qualify Windows behavior or authorize a release.
