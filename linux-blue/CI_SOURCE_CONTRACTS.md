# Shared Linux and Windows CI foundation

This is a deliberately bounded first GitHub Actions lane, not the complete 0.7 acceptance gate.

## What runs

`.github/workflows/shared-core.yml` runs separate Ubuntu 24.04 and Windows 2022 jobs on pushes and pull requests targeting `blue/linux-development` or `codex/v0.7-candidate`. Each job checks out the event revision and uses Node 24.22.1. The runner is `node scripts/ci-source-contracts.cjs`.

The same four shared unit suites run on both operating systems: media settings/command arguments, container clock arithmetic, appearance and app settings. Linux additionally runs the Linux UI admission-policy suite. Syntax checks cover top-level JavaScript/CommonJS files in `src`, `ui` and `linux-blue`, plus main/preload and the CI runner. These are not recursive whole-repository checks.

No npm installation is needed: these selected tests use Node built-ins and repository modules. Electron/FFmpeg are not downloaded or launched. Historical reference suites requiring excluded runtime/calibration evidence are not falsely counted as current passing tests. The workflow does not replace the lead's broader current-contract regression or independent review.

## Security and cost boundaries

Only `contents: read`; checkout does not persist credentials. Official checkout/setup-node actions are pinned to immutable commit identities resolved from their v6 tags. No secrets, `pull_request_target`, self-hosted runner, uploads, release publication, environment approvals or write token. Ten-minute job limit; obsolete runs for the same ref cancel. No dependency caches or artifact uploads. Public/private visibility and account billing settings are not changed by this workflow.

`workflow_dispatch` becomes discoverable only after this workflow exists on the repository default branch; push and pull-request triggers are the initial route on the development branch. A green result means only the named source contracts passed on that hosted OS. Windows results remain unverified until an actual Windows job completes.

## Follow-on lanes, not implemented here

Reproducible pinned FFmpeg provisioning and synthetic CPU/remux integration; Electron smoke with appropriate display support; Windows portable staging without owner-specific F-drive paths; distribution/license review before uploading binary packages. Actual NVIDIA RTX 5060/NVENC, desktop workflow, GPU drivers and final installer/portable acceptance require separate relevant hardware evidence. Do not promote default runtimes or declare 0.7 complete from this lane.
