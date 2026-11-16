# FFmpeg Encoder — Blue Linux development

An experimental Linux development fork of FFmpeg Encoder. It follows the original Windows application's theme, interface design and v0.7 roadmap, adapting platform-specific pieces for Linux rather than inventing a separate product. CPU encoding and shared Electron/JavaScript work developed here can later be reviewed for reuse in Windows.

**Active development branch: `blue/linux-development`.** The fork's `codex/v0.7-candidate` branch is a different line of history; changes do not move between them automatically. This is not a packaged Linux release or an accepted 0.7 product.

## What works so far

### Original application workbench

The original six-tab workbench, dark amber and paper-light teal themes, settings, inspection and shared encoding service now run through a separate Linux entry point. On the reviewed Linux x64 host with Electron 44.7.0 and pinned Debian FFmpeg/ffprobe 7.1.5:

- H.264, H.265 and AV1 CPU jobs use the existing ordinary SDR plan: Full range, source geometry, Matroska output, copied audio, no omissions and **distinct input/output folders**.
- Each file has an explicit **30-minute encode limit**. Cancellation drains the child process; successful completion requires terminal progress, validation and protected publication.
- Source-change refusal, existing-output protection, publication collisions and retained uncertain/completed outcomes were exercised.
- The original UI completed Prepare → Start → Succeeded for H.265, and Show in folder selected the output in the Linux file manager. OS playback/Open output was not tested.

The [CPU workbench checkpoint](linux-blue/WORKBENCH_CPU_CHECKPOINT.md) at `1d7eb260` records **12 focused passes** and **219 shared regression passes with one preserved inherited failure**. The latter is a Linux test-fixture inode-reuse interaction that reaches source protection earlier than the test expects; the guard was not weakened, and a new held-source regression proves the intended missing-source behavior. This is **not a green full suite**.

Real ordinary-service smoke evidence covers three codecs on one generated **8-bit**, 12-frame SDR source, with full decode and copied-audio hash checks. Separate startup capability checks cover 8/10-bit availability; they are not equivalent to an ordinary 10-bit media campaign. Existing product validation is not a newly installed always-on full-decode/audio-hash verifier.

### Earlier synthetic test surface

The smaller `demo-main.cjs` interface remains a development harness, not the original application or final Linux design. Its existing evidence covers synthetic CPU encodes, cancellation/close, no-overwrite output and temporary-output preflight, plus read-only MP4-family and Matroska/WebM information. In **that harness**, inspecting a file does not select it for encoding: Encode still uses the known synthetic fixture.

Its MP4 checkpoint at `7ea4b0b6` recorded 199 focused passes and 9 Windows-only skips. Historical counts overlap and must not be added together. Neither lane establishes general codec quality, hostile-media qualification, whole-app acceptance or a GitHub CI pass.

## Start here

1. Read [Linux bootstrap and continuation](LINUX_BOOTSTRAP.md), then the applicable architecture and evidence conventions in [AGENTS.md](AGENTS.md).
2. Check the actual branch, current commit and working tree before editing. Preserve concurrent work and the Windows source history.
3. Read the latest relevant checkpoint below. Its source identity, failures and evidence limits matter more than a headline test count.

| Area | Evidence and continuation |
| --- | --- |
| Original workbench orientation | [Workbench preview checkpoint](linux-blue/WORKBENCH_PREVIEW_CHECKPOINT.md) |
| Ordinary CPU workbench execution | [CPU workbench checkpoint](linux-blue/WORKBENCH_CPU_CHECKPOINT.md) |
| Synthetic desktop | [Desktop demo checkpoint](linux-blue/DESKTOP_DEMO_CHECKPOINT.md) |
| Temporary output | [Output preflight checkpoint](linux-blue/OUTPUT_PREFLIGHT_CHECKPOINT.md) |
| Read-only source information | [Source inspection checkpoint](linux-blue/SOURCE_INSPECTION_CHECKPOINT.md) |
| MP4 read-only extension | [MP4 inspection checkpoint](linux-blue/MP4_INSPECTION_CHECKPOINT.md) |
| Original product context | [Current State](0-%20Documentation/01_Current_State.md) and [Continuation](0-%20Documentation/10_Continuation_State.md) |
| Earlier recovery kit | [Preserved kit instructions](linux-blue/RECOVERY_KIT_README.md) |

The original product records retain Windows history and requirements. Their Windows-specific run commands, old pauses and evidence are not automatic Linux instructions. Linux checkpoint reports are historical receipts; statements that the runtime was missing describe publication at that time.

## Running and testing

**A fresh checkout has not yet been verified end-to-end.** The owner added the recovery-kit runtime, pilot and tests to this branch in commit `4e9d117`. Their bytes matched the delivered kit. That closes the recorded missing-runtime-file gap, but not the complete setup/recovery check.

The **original workbench** uses the reviewed installed Electron executable:

```sh
electron linux-blue/workbench-main.cjs
```

This command assumes a matching reviewed Linux runtime and a GUI-capable environment; it is not a fresh-machine provisioning recipe. The published `workbench-smoke.cjs` and `workbench-execution-smoke.cjs` generate their own synthetic media on a matching host. The older synthetic demo separately requires its exact external fixture.

FFmpeg/Electron binaries, installed dependencies, generated media and raw local receipts are not a complete ready-to-run bundle in GitHub. Do not weaken executable pins or sandboxing to make another host pass. Two older remote remux dependencies remain unsynchronized and unused by the current CPU route; this is not complete project/PC recovery.

For the lightweight CPU settings check, run from the repository root with Node:

```sh
node --test linux-blue/ui-policy.test.cjs
```

This tests settings validation only. See the linked checkpoint reports for exact larger test commands and prerequisites; a prior local pass does not prove a new checkout passes.

The earlier synthetic demo entry is `linux-blue/demo-main.cjs`. Its qualified local launch supplies `LINUX_BLUE_SYNTHETIC_FIXTURE` and an already reviewed Electron executable, as documented in the desktop checkpoint. **Do not use `npm start` as either Linux launcher:** the original application entry remains Windows-oriented.

## What remains outside the claim

- General media/fidelity qualification, changed operations, remux, same-folder reuse and persistent recovery. Only the bounded ordinary CPU route described above is enabled.
- NVIDIA/AMD/Intel hardware qualification, Windows integration and HDR acceptance.
- Installers, portable distribution, complete dependency provisioning and release acceptance.
- A verified fresh-clone recovery of the complete working environment.

## Development rhythm

Use AI PBS 1.1 and the adopted Git/GitHub workflow: one useful bounded change, focused tests, independent review where warranted, a coherent commit and verified remote synchronization. Commit subjects should explain the user-visible change; multiline bodies should state why, scope, checks and remaining limits. A local commit or unattached uploaded object is not proof that a branch contains the work.

Keep credentials, personal media, generated binaries and local application state out of new commits. Preserve original inputs and existing outputs. Keep paths, processes and output authority in main, with a narrow renderer/preload interface. Respect unresolved publication-review restrictions; do not repackage restricted content or change transport to bypass them.

Future integration into the Windows project requires its own reviewed diff and relevant Windows checks. Linux results alone do not qualify Windows behavior or authorize a release.
