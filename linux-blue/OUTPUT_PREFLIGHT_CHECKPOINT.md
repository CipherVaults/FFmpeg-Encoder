# Linux temporary-output preflight checkpoint

## 1. Outcome and authority

The synthetic desktop now checks its temporary-output directory before creating
the service/window. It exercises the **existing** stage/seal/validate/atomic-only
publication primitives with two tiny known byte strings, verifies a real hard
link, and proves that a destination collision leaves the winner unchanged.
Unsupported atomic publication fails before an encode can begin.

This is the next bounded Linux storage-boundary step authorized by Ahmed's
continued non-GPU development and routine eligible private synchronization.
Blue remains the sole integrator. AI PBS 1.1 and the readable Git checkpoint
workflow apply. Windows behavior, public release and owner acceptance remain
outside this checkpoint. No broad filesystem framework was added.

## 2. Goal, scope and acceptance

Goal: catch a temporary output folder that cannot support the demo's required
exclusive-publication semantics before spending work encoding into it.

Acceptance: positive real-host publication and collision proof; canonical,
owned directory checks; cancellation and fault refusals; native startup through
the actual new gate; independent review; focused regression; local Git and
verified synchronization of only independently permissible changes.

Files:

- New `output-preflight.cjs`: main-only folder/options, owned private probe
  directory, exact known bytes, real hard-link and no-overwrite observations.
- New `output-preflight.test.cjs`: eleven positive/refusal/race tests.
- Existing new `demo-main.cjs`: import and awaited preflight before service and
  BrowserWindow construction; records a bounded result without exposing paths.
- This new checkpoint record.

No edit to shared `src/outputs.cjs`, `src/storage-eligibility.cjs`, Linux runtime,
synthetic service, CPU policy, Windows entry/preload/runtime pins, product
defaults, qualification catalogs, benchmark or package/dependency configuration.

## 3. Method and safety decisions

The helper requires a canonical absolute Linux path to an ordinary directory
owned by the current account, with no group/other write access. It creates a
fresh private probe directory, binds device/inode/birthtime/owner/mode and
rechecks both parent and probe identity repeatedly, including before return.
Normal owner writability is required in practice and is not rejected.

The first 42-byte probe is written exclusively, sealed, read back against the
exact constant and marked valid **only as probe data**, not as media. Existing
publication code is called with `atomicOnly:true`. The resulting two names must
have the same device/inode and link count two. The shared private publication
receipt and full tiny byte payload are checked.

A separate 51-byte staged probe then targets the same destination. It must
report a collision; the first destination's identity and bytes must remain
unchanged, and the second stage's bytes must remain intact. A copy substitute,
unsupported hard link, changed parent or cancellation cannot return success.
All tiny probe artifacts, including uncertain ones, are retained. No new
pathname-based cleanup routine or overwrite fallback was introduced.

Result scope is explicitly `owned-temporary-output-only` and
`persistentReuse:false`. The `link` option is a main-only fault-injection seam
for tests, never an IPC/renderer setting. Real startup supplies no override.

## 4. Verification and evidence

Final focused regression:

```sh
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs tests/outputs.test.cjs tests/completed-output-retention.test.cjs tests/storage-eligibility.test.cjs linux-blue/runtime.test.cjs linux-blue/ui-policy.test.cjs linux-blue/demo-boundary.test.cjs linux-blue/output-preflight.test.cjs
```

**187 tests: 178 pass, 0 fail, 9 skipped.** The nine skipped checks are inherited
Windows-only storage-helper tests, not passes. All eleven new preflight tests
pass. This is focused regression, not a full `npm test`. Final receipt:
`../evidence/output-preflight-corrected-final-regression.tap` relative to the
local-service checkout. The earlier 70/0/9 focused subset and 177/0/9 expanded
receipt remain historical intermediate evidence.

Coverage includes actual repeated probes, invalid paths/options, symlink parent
and ancestor, non-directory, group-writable parent, pre-aborted cancellation,
unavailable hard link without copy fallback, substituted copy, changed parent
permissions, parent inode replacement, post-link cancellation and unexpected
first-destination collision. Fault-injected cases are not claimed as observations
on other real filesystems.

One **startup-only** native Electron check used the supported cloud desktop
terminal and visible window. The log records `LINUX_DEMO_OUTPUT_PREFLIGHT` with
passed/atomicPublication/collisionPreserved true and persistentReuse false,
followed by `LINUX_DEMO_READY`. The window reached Ready and was closed normally:
**0 jobs, 0 spawned children, 0 remaining**, process exit 0. No three-codec media
campaign was replayed. Receipt: `../evidence/output-preflight-desktop.txt`.

The native probe retained its two stage files and the exclusive destination
(42/51/42 bytes, with the first stage/destination sharing an inode) beneath the
ignored desktop-demo artifacts. Electron sandbox/context isolation/web security
remain true and renderer Node remains false. Existing D-Bus/SSL warnings are
retained; this is not OS sandbox attestation or a network-isolation guarantee.

## 5. Retained failure and review

Independent review requested an additional parent-inode replacement test. Its
first assertion expected the later `LINUX_OUTPUT_CHANGED` check. The existing
publisher actually detected the vanished post-link destination first and
correctly returned `PUBLICATION_UNCERTAIN`. The failed receipt is retained at
`../evidence/output-preflight-final-reviewed-regression.tap`: 177 pass, 1 failure,
9 skips. It is not relabeled as success.

Only that incorrect test expectation changed. The corrected test requires the
exact uncertainty result, retained moved probe bytes and an untouched replacement
directory. No production guard was weakened or copied publication substituted.
Final independent source/evidence review passed: exact final helper/main/test
hashes, retained failed receipt, corrected 178/0/9 result, native preflight before
readiness and zero-job/child closure were verified. No media was rerun for review.

Refusal-before-write assertions are **helper-level** claims. Main's pre-existing
Electron userData/sessionData setup occurs before this gate and may create its
own local state directories. The preflight does not promise an entirely read-only
application startup.

## 6. Source identity, Git and recovery

Base local commit: `c386db21df0c628c954244c309df794f57069264` on
`blue/local-synthetic-demo`. Final code SHA256:

| File | SHA256 |
| --- | --- |
| output-preflight.cjs | 8d7c9e3d7de0b5248e38cf4481a8be166cefab801aca808c2f8f4a23b96f7ad2 |
| output-preflight.test.cjs | 027a7429f628413b969a8852a7a2f0172e88c8d76016d64cc86d17be2710a16e |
| demo-main.cjs | f3c538e54c662f144bc2698c6b6b94a67268ef0759c81ab1b077194d863fe0dd |

The local feature commit contains only the four listed files. The same bounded
content is eligible for the private fork's `blue/linux-development` branch,
subject to reviewer acceptance and exact tip/file readback. The final local and
remote SHAs belong in the completion receipt, not in a self-referential commit.

No denied/uncertain earlier payload or complete local history is included.
The private fork still lacks the earlier `linux-blue/runtime.cjs` and the known
synthetic fixture, so these additions **do not make the remote demo runnable**.
Raw receipts, generated probes/media, local Electron and complete local Git
history remain outside that off-machine checkpoint. Local commits are not a
complete backup. No PC files were changed.

## 7. Limits and next useful boundary

This is a point-in-time observation in one private temporary output directory.
It is not capacity prediction, removable/network-filesystem qualification,
durability/fsync proof, protection against a hostile same-user process,
persistent recovery permission or general Linux storage qualification.
StorageEligibility's Linux refusal is unchanged. Every actual synthetic job
still performs its own identity/stage/validation/atomic-only publication checks;
the preflight is never reused as authority to bypass them.

The next useful product boundary remains read-only, bounded source admission
before any arbitrary-media picker/encoding route. Keep media execution limited
to the known fixture until that source/storage contract is separately reviewed.
Resolve the remote runtime dependency through the supported publication review
process in parallel, without blocking independent local development or using
new files to reconstruct a restricted payload.
