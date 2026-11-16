# 📋 Execution Summary: 2026-11-16 — Read-only Matroska source information

## 1. Task Overview

Ahmed authorized continued bounded Linux CPU development, PBS 1.1, readable Git
checkpoints and eligible private synchronization. Blue implemented this slice,
with an independent read-only engineering review. Goal: inspect a local source's
basic information through the native desktop without granting permission to
encode it. Stop after focused checks, review and scoped synchronization.

This is experimental Linux work, not owner acceptance, release or Windows/GPU
qualification. No original Windows files or runtime/security pins changed.

## 2. Context Used

Reconciled local commit `8e844120fb74efda9abf41481e8c69626047c1bb`, clean worktree,
project AGENTS, Linux orientation, prior preflight checkpoint, current controller,
IPC, runtime and process runner. Applied the adopted Git checkpoint skill and
PBS execution/report guidance. Prior records remain dated evidence, not current
whole-product claims. Fresh remote inspection confirmed the authorized private
fork and Linux tip `3e2b005fd9b1ebc1b620cea3c084318a5678f61d` before publication.

Official references checked: [FFprobe field selection](https://ffmpeg.org/ffprobe.html),
[FFmpeg input limits](https://ffmpeg.org/ffmpeg-formats.html), and
[Electron native dialogs](https://www.electronjs.org/docs/latest/api/dialog).
Installed FFprobe help and actual synthetic probing verified the selected flags
on this host, rather than assuming the latest documentation proves compatibility.

## 3. Work Performed

Added `source-inspection.cjs` plus its unit and controller-boundary tests. Updated
the eight existing independent demo files: controller, IPC, main, preload,
renderer, HTML, CSS and boundary tests. This report is the twelfth selected file.

The main process opens one native Matroska/WebM picker. The fifth fixed IPC
method takes **zero arguments**; renderer paths, commands and probe options are
not admitted. Main locks inspection before awaiting the picker, excludes
encoding, discards cancelled/late selections and drains a launched probe before
restart/close. A native picker has no owned child; close does not deadlock waiting
for the user's dismissal. Its late result cannot start work.

The inspector admits a canonical ordinary non-symlink `.mkv`/`.webm` file, nonzero
and at most 64 GiB, and opens it read-only with `O_NOFOLLOW | O_NONBLOCK`. The child
reads the held descriptor through main's proc-fd path, not a subsequently replaced
source pathname. Handle and named identity/size/mtime/ctime/mode/owner are checked
before and after probing. The descriptor is held until the owned probe settles.

Unchanged pinned runtime executes FFprobe only: forced Matroska demuxer, file-only
protocol, 32-stream limit, 1 MiB probe size, one-second analysis budget, ten-second
child timeout, 16 MiB **single-allocation** cap and one decoder thread. Existing
runtime bounds captures at 2 MiB stdout and 128 KiB stderr. Parsed JSON is further
limited to 64 KiB. These are not a total-memory or total-filesystem-latency limit.

Only bounded codec/type, dimensions, pixel format, rational reported frame rate,
audio rate/channels, file bytes and reported duration reach the renderer. Unknown
fields remain unknown. Tags, filenames, source paths, raw errors and argv do not.
The report is explicitly an observation with `encodeAllowed:false`. The existing
Encode button still uses only the known synthetic fixture, never this selection.

## 4. Commands / Tools Used

Node tests, Git inspection/scoped commit, official documentation reads, and the
supported cloud desktop terminal/native dialog were used. No new dependency,
credential, transport, package or OS security setting was installed or changed.
Native runtime: Electron 44.7.0; Linux x64 and fixed Debian FFmpeg 7.1.5 tools.

```sh
node --test tests/media.test.cjs tests/container-clock.test.cjs tests/process-runner.test.cjs tests/outputs.test.cjs tests/completed-output-retention.test.cjs tests/storage-eligibility.test.cjs linux-blue/runtime.test.cjs linux-blue/ui-policy.test.cjs linux-blue/demo-boundary.test.cjs linux-blue/output-preflight.test.cjs linux-blue/source-inspection.test.cjs linux-blue/source-inspection-boundary.test.cjs
```

Existing local launch remains `electron linux-blue/demo-main.cjs` with the
main-owned `LINUX_BLUE_SYNTHETIC_FIXTURE` environment setup from the desktop
checkpoint. The remote runtime/fixture gap below still prevents remote-only use.

## 5. Verification / Testing

Final focused regression: **204 tests, 195 pass, 0 fail, 9 skipped**. Skips are the
inherited Windows-only storage-helper checks. This is not full `npm test`.
Seventeen new tests cover report bounds/sanitization, fixed args, unchanged bytes,
handle closure, symlink/path refusal, source replacement/change, abort/drain,
picker/encode exclusion, late picker cancellation/close and safe error mapping.
Receipt: `../evidence/source-inspection-final-regression.tap` in the local workspace.

Actual FFprobe integration used only the existing synthetic fixture and a tiny
synthetic invalid Matroska file. The valid report observed H.264, 320×180, 30/1,
yuv420p, PCM 48 kHz stereo, 172442 bytes and reported duration 0.4 seconds.
The invalid file was refused; cancellation after child creation drained correctly.
Final run: **3 spawned / 3 closed, maximum one live, zero remaining**. Source SHA256
remained `145c63faaaa6052e7fd7b0dc206319c67355edbb8b5e2c43a2687af5100a5d06`.
Receipt: `../evidence/source-inspection-real-2.json`.

Native desktop check: picker -> visible metadata; repeated picker Cancel -> stale
report cleared and controls restored; then one H.264 synthetic job -> validated
publication; ordinary window close -> terminal exit 0. Census: **7 spawned /
7 closed, maximum one live, zero remaining**. Sandbox/context isolation/web
security remained enabled, renderer Node disabled. No three-codec replay.
Receipt: `../evidence/source-inspection-desktop-1.txt`. First path-entry interaction
returned cancelled, not inspected; reopening and using the visible Open button
produced the verified report. Failed AT-SPI typing sent no input; supported native
character entry was used. UI process-close-during-picker and probe abort timing
are covered by focused injected lifecycle tests, not claimed as visible GUI tests.

The final one-line cancelled-error normalization followed this native run; the
full focused regression covers that final change. It does not alter the checked
picker, successful inspection or synthetic encoding path. No native replay was
needed to relabel that earlier run as testing this separate cancellation branch.

## 6. Problems Encountered

The first real integration harness expected a nonexistent error name
`PROCESS_FAILED`; the unchanged process runner correctly returned `TOOL_FAILED`
for invalid media. The retained first receipt (`source-inspection-real-1.json`)
is a failed harness assertion, despite successful refusal/drain and unchanged
source. Only the harness expectation was corrected; no implementation guard was
weakened. The corrected second receipt owns the integration result.

Existing Electron D-Bus/SSL diagnostics remain in local logs. They are not evidence
of an OS sandbox audit or comprehensive network isolation. No safety rejection
was retried and no previously uncertain publication material was reconstructed.

## 7. Documentation Impact

This execution record owns the new observation boundary and continuation. Earlier
checkpoint reports remain unchanged historical evidence. Shared requirements,
Windows roadmap, presets, qualification catalogs and paused comparison work did
not change. A broader reflective session record belongs to the coordinating
conversation, not a fabricated expansion of this bounded execution report.

## 8. Git / Version Control Impact

Local and remote histories remain distinct. The local feature commit selects
only these twelve independent files. Their paths were checked absent from both
earlier denied/uncertain upload manifests. No complete local ancestry or old
payload is being repackaged. Exact local/remote commit SHAs and byte-level remote
readback belong in the completion receipt after publication, avoiding a
self-referential commit hash here.

Authorized destination: private `CipherVaults/FFmpeg-Encoder-Blue-Linux`, branch
`blue/linux-development`, same GitHub connector and expected-tip non-force update.
No candidate branch, original Windows repository, permissions or visibility change.

**Recovery gap remains:** remote lacks `linux-blue/runtime.cjs` and the known
synthetic fixture. These eligible changes do not make the fork runnable from a
fresh clone. Complete selected local history, raw receipts, generated media and
installed runtime remain local, not an off-machine backup. Existing source intake
in Library does not back up later Linux work. No CI/full-suite pass is claimed.

## 9. Decisions Made During Execution

Kept this to Matroska/WebM observation rather than a general format framework or
arbitrary-source encoder. Kept native picker and child ownership in main, with a
held descriptor and no renderer path transport. Probing is not whole-file decode,
source preservation qualification, immutable capture or persistent eligibility.
Did not duplicate the blocked runtime or alter its pins to close the backup gap.

## 10. Items That Need Human / Coordinator Review

Independent source review found no blocking flaw and requested an explicit
held-descriptor-through-abort test plus consistent cancelled error state. Both
were added and pass. Final evidence review is recorded in the completion receipt.
Owner product acceptance and the separate supported runtime-publication review
remain distinct. No extra routine decision is required for this bounded work.

## 11. Current Result

A useful local desktop source-information view is implemented and tested, without
selected-source encoding. This is not malicious-media sandbox qualification:
FFprobe remains a native parser, analysis is bounded but not whole-file validation,
filesystem metadata operations are outside its child timeout, and hostile
same-user concurrent modification is not comprehensively prevented. Inputs were
synthetic only. MP4, general media import, persistent recovery, hardware encoding,
Windows behavior, packaging/licensing and release remain outside the claim.

## 12. Recommended Next Step

Stop this slice after verified scoped synchronization. The next product decision
should be a small reviewed selected-source encode contract (owned input capture,
explicit allowed stream/color scope and existing no-overwrite validation), not
silently converting an information report into authority. Resolve the missing
runtime/fixture through supported publication review in parallel; do not rewrite
or transport uncertain material as a workaround.
