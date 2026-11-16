# Shared Windows and Linux product development

## Purpose and authority

Continue substantial shared FFmpeg Encoder 0.7 development here, then transfer
reviewed deltas for Windows integration and qualification with Claude and Codex
when that lane is available and authorized. This is not a Linux rewrite followed
by a Windows rebuild from scratch. It adds cross-platform execution detail to
E0, E7 and E8 of the [existing execution plan](V0_7_LINUX_EXECUTION_PLAN_2026-11-16.md),
without changing the current Full-file/app-composition milestone or its tests.

The original PC checkout, unfinished Windows campaign and existing corrections
remain untouched. No PC execution, external collaborator contact, automatic merge,
new product acceptance wording or release is authorized by this document. HDR,
Archive/default-policy decisions, vendor evidence and owner acceptance retain
their existing boundaries.

## Reuse and qualification map

| Area | Shared product work | Target-specific boundary |
| --- | --- | --- |
| Encode requests/plans and validation | Existing contracts, command builder, source-shaped selector, resource forecasts, streaming evidence, storage and cancellation | Register measured families against each target's actual runtime and observations; Linux receipt IDs never authorize Windows |
| Current Full/range slice | `src/operation-family.cjs`, `src/operation-evidence.cjs`, `src/operation-resource-budget.cjs` and corresponding tests | Fixed Linux clocks, runtime pair, retained calibration/service receipts and owned-source orientation qualification remain local evidence |
| Workbench | Reuse current renderer, preload/IPC, service architecture, settings and approved Gauge design | Native launch, dialogs, output opening, state directories, themes/font behavior and packaging are tested on each OS |
| Runtime/process safety | Private currentness tokens, bounded arguments/output, source identity and no-overwrite publication invariants | Linux executable/library pins and process composition stay in `linux-blue/`; preserve Windows candidate runtime and driver checks |
| Distribution | Dependency/entry inventory and pure target-plan checks can be shared | Each target has an explicit Electron/runtime manifest, payload allowlist, provenance/licences and native extracted-package proof |

Keep one implementation of portable product behavior. Do not copy Linux adapters
into shared modules, add PATH/runtime fallbacks, or create a second sanitized
implementation to evade publication review. Test portability does not itself
establish native Windows behavior or vendor acceleration.

## E0: independent source closure before recovery claims

At a stable checkpoint:

1. Record exact local and intended remote commits, dirty paths, active jobs and
   a file-level shared/adapter/evidence classification. Bind each coherent slice
   to dependency hashes, tests, review and remaining target gaps.
2. Obtain the actual private GitHub branch into a separate recovery checkout.
   Verify its commit and file bytes. If only an API tree export is available,
   label it as such, not as a Git clone or full-history backup.
3. Run applicable deterministic tests and entry/dependency preflight against only
   that checkout. Trace failures to exact absent/stale modules, setup or evidence.
   Do not silently fill it with local files and call it independent recovery.
4. Account separately for generated media, raw receipts, runtime binaries and
   dynamic-library dependencies intentionally kept outside Git. Provide legitimate
   setup/requalification or authorized artifact recovery, not assumed availability.
5. Resolve uncertain/restricted publication through its supported review route.
   Recreating equivalent files, changing transport or splitting the same payload
   is not a recovery technique around a restriction.

Point-in-time baseline: local shared Full implementation `a76f9b86`; verified
remote `7392aa93`. The exact 35-file source submission from immutable `23144377`
remains uncertain after interruption. Its expected completed tree was not
retrievable in the read-only status check; no retry or branch update followed.
This is not a finding that all 35 files are unsafe, and it is not complete backup.

## E7/E8: explicit target build plans, then native qualification

Inspected packaging gap: `scripts/build-portable.cjs` selects `main.js`, preload,
shared modules, UI and assets, but excludes all `linux-blue/` adapters.
`packaging.config.cjs` specifies `win32`/`x64`, verifies `electron.exe`, and retains
Windows-specific extraction/runtime checks. Merely changing `platform` cannot
package the Linux workbench correctly.

Use a staged change, not a blind generalization:

1. Preserve the existing Windows build entry and its assertions as a regression
   baseline. Add pure target build-plan/preflight tests for entry point, target
   OS/architecture, runtime manifest and explicit dependency/file closure.
2. Define a separate Linux entry and reviewed allowlist that includes its actual
   adapter dependencies and approved assets, without broad directory globs that
   import logs, historical records, app state or generated media.
3. Keep target runtime provenance, hashes, executable/library layouts and licence/
   corresponding-source obligations explicit. Do not distribute the GPL-enabled
   build until its compliance requirements are satisfied.
4. Freeze final source before packaging; any code/config/dependency correction
   creates a new identity and reruns affected plus required aggregate checks.
5. Qualify the actual extracted Linux build: entry resolution, different cwd,
   restricted PATH, offline operation, restart, source protection, cancellation
   and output access. A cross-produced Windows artifact is a build result, not a
   native Windows pass. Windows installer/portable/native/vendor gates remain open
   until tested on the authorized Windows lane.

## Immutable Windows handoff, not a rebuild

Prepare one concise handoff for the future PC lane:

- Exact portable base, reviewed commits/diffs and dependency hashes, with each
  file classified shared, Linux-only, Windows-only or qualification evidence.
- What changed, why, commands actually run, final-source receipts and failures,
  unresolved requirements and allowed next steps. Preserve all 43 requirement IDs
  and distinguish implemented behavior from platform qualification.
- The current PC base and outstanding corrections, checked before integration;
  reconcile in a separate worktree/branch rather than resetting or overwriting
  the existing project. No automatic cross-project merge is implied.
- Windows checks for paths/case/Unicode, links/reparse points, source identity,
  atomic/no-overwrite publication, process cancellation/closure, native dialogs,
  settings restart, output opening, packaging and real device/runtime discovery.
- New Windows runtime-bound calibration/service receipts where behavior depends
  on decoding clocks, containers or libraries. Linux CPU evidence cannot qualify
  Windows or NVIDIA/AMD/Intel hardware, and unavailable hardware is reported plainly.

Claude and Codex can consume that precise continuation when their tools/quota and
owner-authorized PC lane permit. Until then, continue shared and Linux work; do
not claim parallel Windows execution or ask for routine decisions already covered
by the development plan.

## Security and acceptance throughout

Keep security in design and focused diff review: untrusted renderer/media inputs,
main-owned file/runtime authority, narrow IPC, bounded process execution, safe
output publication and restrained diagnostic/data exposure. Follow findings with
proportionate regressions. The [bounded manual integration review](AV1_APP_SECURITY_REVIEW.md)
records its actual scope and limitations; it is not a whole-repository certificate.

Current next step is independent review and acceptance of the settled Full service
receipt, then accepted-proof app composition and a real mixed/ordinary/changed-service campaign before main-route
activation. A push, build, synthetic pass or handoff is not Linux 0.7 acceptance,
Windows acceptance, or permission to merge/release.
