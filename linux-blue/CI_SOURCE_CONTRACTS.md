# Shared Linux and Windows CI foundation

This is a deliberately bounded first GitHub Actions lane, not the complete 0.7 acceptance gate.

## What runs

`.github/workflows/shared-core.yml` runs separate Ubuntu 24.04 and Windows 2022 jobs on pushes and pull requests targeting `blue/linux-development` or `codex/v0.7-candidate`. Each job checks out the event revision and uses Node 24.22.1. The runner is `node scripts/ci-source-contracts.cjs`.

The same eight shared unit suites run on both operating systems: media settings/command arguments, container clock arithmetic, appearance, app settings, main shutdown/lifecycle, process cancellation/closure, completed-output retention and output access. Linux additionally runs the Linux UI admission-policy suite. Syntax checks cover top-level JavaScript/CommonJS files in `src`, `ui` and `linux-blue`, plus main/preload and the CI runner. These are not recursive whole-repository checks.

No npm installation is needed: these selected tests use Node built-ins and repository modules. Electron/FFmpeg are not downloaded or launched. Historical reference suites requiring excluded runtime/calibration evidence are not falsely counted as current passing tests. The workflow does not replace the lead's broader current-contract regression or independent review.

## Security and cost boundaries

Only `contents: read`; checkout does not persist credentials. Official checkout/setup-node actions are pinned to immutable commit identities resolved from their v6 tags. No secrets, `pull_request_target`, self-hosted runner, uploads, release publication, environment approvals or write token. Ten-minute job limit; obsolete runs for the same ref cancel. No dependency caches or artifact uploads. Public/private visibility and account billing settings are not changed by this workflow.

`workflow_dispatch` becomes discoverable only after this workflow exists on the repository default branch; push and pull-request triggers are the initial route on the development branch. A green result means only the named source contracts passed on that hosted OS. Windows results remain unverified until an actual Windows job completes.

## Follow-on lanes, not implemented here

Reproducible pinned FFmpeg provisioning and synthetic CPU/remux integration; Electron smoke with appropriate display support; Windows portable staging without owner-specific F-drive paths; distribution/license review before uploading binary packages. Actual NVIDIA RTX 5060/NVENC, desktop workflow, GPU drivers and final installer/portable acceptance require separate relevant hardware evidence. Do not promote default runtimes or declare 0.7 complete from this lane.

## Shared safety-contract expansion

The additional lifecycle suite executes production `main.js` inside an injected Electron harness, including the reviewed Windows shutdown IPC-settlement change. The process-runner suite mixes injected child-process events with two actual owned Node helpers for UTF-8 stdin round-trip and cancellation/PID disappearance. It checks bounded output, timeout and close settlement as well. These are production-code behavioral checks, not a native Electron launch, FFmpeg execution or descendant-process-tree qualification.

Output-retention and output-access suites create and clean small owned text fixtures under `artifacts/`; no personal media is used. They exercise collision/no-overwrite, replacement and post-copy uncertainty, retained completed staging, and stale access-token refusal. Hard-link cases are real filesystem operations and must pass, not be silently skipped if a runner does not support them. Windows-specific UNC/device/drive-relative path cases are exercised on Windows. No new skip or platform exception is added.

The expansion must be integrated together with the independently reviewed Windows shutdown V2 source/tests, not used to imply the older main implementation already has the corrected behavior. Initial local Linux candidate evaluation passed 113 additional safety tests without skips; the complete runner and actual hosted Windows/Ubuntu outcomes must be recorded separately against the integrated commit. No change is made to the pinned workflow, Node/actions, permissions, runtime defaults or packaging.
