# Execution Summary: 2026-11-16 — Retained AAC in the Linux workbench

## 1. Task Overview

Add a bounded retained-audio remux route to the actual v0.7 workbench, reusing its
original UI and shared verifier. Ahmed authorized local work and eligible private
synchronization. PBS 1.1 and the adopted Git workflow apply. Windows and deferred
HDR remain untouched; this does not close Windows Q2j or accept a release.

## 2. Context Used

Started from local `56da729715d57bfe38f36841a90f07a2d7f7245b` and the
[video-only remux checkpoint](WORKBENCH_REMUX_CHECKPOINT.md). Remote parent at
the start was `b758c0d13509723d98b2272c885497d624083dc9`. Read the existing
packet/timeline, native admission and complete-audio evidence paths directly.

## 3. Work Performed

The Linux composition now permits Full MP4-to-MP4 stream copy with exactly one
H.264 SDR video and one retained AAC-LC track: 44.1/48 kHz, mono/stereo, observed
`fltp` format and matching channel layout. Existing video-only MP4-to-MKV remains.
AAC-to-MKV, MP4 video-only output, extra streams, chapters, omissions, MOV and other
shapes remain refused. Distinct folders, source identity, native admission,
complete packet evidence, complete decoded-audio comparison and no-overwrite
publication are unchanged. No shared source was modified in this milestone.

The 60-second/128-MiB limits and shared progressive 8-bit BT.709 geometry/rate
limits remain admission ceilings, not proof of every file up to those limits.
The new MP4 policy has its own ID and reviewed prospective evidence reference;
it does not reuse Windows runtime qualification or relax a failed tolerance.

## 4. Commands / Tools Used

```sh
node --test linux-blue/workbench-remux.test.cjs linux-blue/workbench-service.test.cjs linux-blue/workbench-execution.test.cjs tests/remux-operation.test.cjs tests/remux-validation.test.cjs tests/remux-service.test.cjs
node linux-blue/workbench-aac-remux-smoke.cjs
node linux-blue/workbench-remux-smoke.cjs
electron linux-blue/workbench-main.cjs
```

Used the already reviewed Electron 44.7.0 and pinned host FFmpeg 7.1.5. No
installation, runtime pin, credential, OS permission or Windows entrypoint change.

## 5. Verification / Testing

**135 selected tests passed, zero failed/skipped.** This is not `npm test` or a
green full-project claim. The earlier unrelated inherited fixture issue remains.

Four one-second 320×180/30-fps synthetic sources cover 44.1/48 kHz mono/stereo AAC.
The final smoke uses the actual workbench composition, not an overridden policy.
All four passed complete compressed packet/timeline and audio evidence. Separate
whole decoded-PCM hashes matched, source bytes remained unchanged, and full
output decoding passed. Source/output audio time base, duration/start ticks,
packet count, first/last timestamps, last packet duration and Skip Samples fields
matched exactly. The 1024-sample priming instruction was retained.

Decoded source/output lengths are 48128 samples at 48 kHz and 45056 at 44.1 kHz.
This proves preservation of the decoded source, **not exactly one second of PCM**.
Runtime video verification remains complete packet identity plus headers and
start/end decode; the smoke's extra full-video decode is not a new product guard.

AAC-to-MKV is refused before Start with an empty destination. Cancellation during
an actual PCM evidence child drained ownership, published nothing, and a freshly
prepared retry succeeded. Final smoke: **120/120 children closed, max two, zero
live**. Existing video-only MKV smoke reran: **46/46 closed, max two, zero live**.

Native original UI: MP4 target → Prepare → Ready → Start → Succeeded; the expanded
row showed one audio track and Show in folder selected the MP4 in Thunar. Exit 0,
**44/44 children closed, max two, zero live, zero closure failures**. Output:
109084 bytes, SHA256
`1a2986e2888a1cee5e762c699e9f6acfc6e64dba3b50ee517c7858f74cae4434`.
Independent post-exit PCM equality and full-output decode passed, another 3/3
children closed. Native cancellation latency and OS playback were not tested.

## 6. Problems Encountered

The first prospective AAC-to-MKV run correctly failed `REMUX_PACKET_TIMING` on
the last packet. Its completed stage stayed unverified and unpublished; 13/13
children closed. Diagnostic comparison showed the MKV lost the source's 1024
Skip Samples priming instruction and decoded 1024 additional samples. Its last
packet also exceeded the existing 2-ms tolerance. This is a real preservation
failure, not a reason to loosen checks or choose an aligned test duration.

MP4-to-MP4 is a separately proven route; it does not rescue or qualify AAC-to-MKV.
The first new unit-test fixture also had stale `nb_streams: 1` after adding audio.
Correcting that synthetic count fixed the test; product relationship guards were
not changed. All failed receipts remain failed and retained locally.

The unchanged renderer still says the reveal request was sent to Windows, although
Thunar successfully opened. Native D-Bus/SSL diagnostics remain recorded. A byte
comparison of the native and separate service output files differed; whole-container
byte equality is not claimed. Their independently checked decoded audio matches.

## 7. Documentation Impact

This supersedes the preceding checkpoint's blanket AAC/MP4-output refusal only
for the bounded route above. It does not supersede historical failures, source
restrictions, roadmap status or broader qualification. The remote root README
is newer than the local copy and is preserved rather than overwritten.

## 8. Git / Version Control Impact

Six independently authored Linux files are eligible: main/service composition,
remux policy/test, the new AAC smoke and this report. They are absent from both
older restricted upload manifests. No shared source, historical document, raw
receipt, media, binary, credential, Planning material or local ancestry is uploaded.

The remote still lacks the exact local versions of `src/remux-operation.cjs`,
`src/remux-native-cues.cjs` and `src/operation-runtime.cjs`. Their SHA256 gate stays
unchanged. **Remux remains unavailable with the current older remote dependencies;
ordinary CPU encoding remains available.** This is not fresh-clone remux proof or
complete parity. The gate covers nonmatching loadable modules, not missing/broken
imports. Do not rewrite or transfer withheld files to evade prior review.

Raw evidence/media and the local observer correction remain outside this off-machine
checkpoint. Final local/remote SHAs and exact tree readback are recorded separately.
Synchronization uses the fresh remote tip, preserves all other files and is non-force.

## 9. Decisions Made During Execution

Keep the demonstrated failing container route closed. Reuse complete existing
evidence and ownership rather than replace them with FFmpeg exit zero. Admit only
the four reviewed AAC forms under a distinct policy. Keep the original application
design and platform-specific safeguards; no speculative replacement framework.

## 10. Items That Need Human / Coordinator Review

Independent code/evidence and final native/report reviews passed. Legitimate
source parity for the three withheld dependencies
remains separate work, not a blocker to unrelated local milestones. This host uses
pinned executables with host-provided dynamic libraries, not a redistributable build.

## 11. Current Result

The original Linux workbench locally retains AAC in this bounded MP4-to-MP4 route,
with priming/tail/timeline and complete-audio evidence. AAC-to-MKV stays refused.
Receipts: `workbench-aac-real-1.json` through `-3.json`,
`workbench-aac-tail-diagnostic-1.json`, `workbench-aac-regression-1.tap` and `-2.tap`,
`workbench-aac-unit-fixture-diagnostic.tap`, `workbench-video-after-aac.json`,
`workbench-aac-desktop-1.txt`. Final wired-service evidence owns the positive claim.

## 12. Recommended Next Step

Continue useful existing-workbench functionality, such as selected ordinary CPU
geometry/10-bit coverage, after reading the current implementation. Track source
parity separately. MP3-to-MP4, broad remux/audio selection, long/4K files, Windows,
GPU, HDR, all v0.7, packaging and release are not accepted by this checkpoint.
