# Execution Summary: 2026-11-16 — CPU precision-FLAC trim qualification

## 1. Task Overview

Qualify a bounded CPU trim in the existing workbench, preserving the original
workflow and strict validation. This attempt is blocked before activation, not a
working feature. No runtime switch, relaxed validator or Windows change.

## 2. Context Used

After matching-ready selection acceptance (`0e3d895`), mapped the existing
`short-sdr-range-flac-v1` family, canonical builder, telemetry, evidence collector
and service lifecycle. The first Linux scope was 720p30 H264 High/8-bit SDR in
QuickTime, one PCM16 stereo/48 kHz stream, original geometry, HEVC CPU slow CRF25.
The existing Windows family spans more cases and is not Linux qualification.

## 3. Work Performed

Added a local pre-activation calibration using generated four-second video and
channel-distinct chirps. Reused the existing builder/telemetry/collector/validator;
imported only the pure pre-encode clock-bound derivation from the old calibration
module. Its Windows main and historical records were not executed or copied.
Three cases were planned: head half-second, nonaligned interior and held-out open
end. Only the first was attempted. Every result remains unpublished staging data.

## 4. Commands / Tools Used

`node --check linux-blue/workbench-flac-calibration.cjs` and
`node linux-blue/workbench-flac-calibration.cjs`.
One bounded, read-only fixed-tool FFprobe diagnostic inspected retained output.
Independent review checked the actual collector and failure evidence.

## 5. Verification / Testing

Calibration failed safely with eight spawned/eight closed children, maximum one,
zero live children. Complete source video collection checked all 120 frames.
Output encoding and telemetry collection finished, then output video evidence
failed: `STDOUT_SINK_FAILED`, caused by `OPERATION_EVIDENCE_INVALID`:
`Decoded frame duration is absent or not an integer.`

FFmpeg 7.1.5 output frames and packets have neither duration nor pkt_duration.
Reported rates are 30/1 and the output time base is 1/1000. Those facts are not a
replacement for decoded duration evidence, especially the final frame. Audio
PCM identity, complete output validation, later calibration cases, service
integration, native trim and cancellation acceptance were **not completed**.
The last code edit only preserves nested failure details for future runs; syntax
checked, not claimed as another calibration run. No full-suite or Windows claim.

## 6. Problems Encountered

The existing collector already supports both duration field names, rejects
conflicts and refuses missing observations. This is not a field-renaming fix.
Do not insert 1/30, infer from neighboring PTS, fit tolerances to the candidate,
or replace source/output evidence with encoder telemetry. Frozen mathematical
bounds alone do not establish qualification of a different runtime.

Direct inode observations also corrected an earlier hypothesis: generated media
have positive inode values; only immutable system tools showed signed overlay
inodes. No source-family identity change was needed or made.

## 7. Documentation Impact

This record distinguishes an investigated functional route from enabled behavior.
The supported ordinary CPU/remux preview remains unchanged.

## 8. Git / Version Control Impact

Only the new local calibration script and this report are staged. Generated media,
full receipts, executor paths and diagnostic JSON remain ignored/private. No
remote write, shared-source transfer, old denied-payload retry or original Windows
change. The script depends on existing shared modules and a historical pure
helper; publication eligibility has not been established. A local commit is not
an off-machine backup. Latest verified remote remains `a5f5ab29`.

## 9. Decisions Made During Execution

Keep changed encodes disabled. Independent review found no existing legitimate
fallback. Retain the failed receipt and unpublished stage, rather than change a
security/verification guard to get green tests.

## 10. Items That Need Human / Coordinator Review

Choose a bounded runtime/evidence investigation before trying to activate this
route: an explicitly separate pinned Linux runtime that supplies required
observations, or a separately designed and qualified authoritative timing method.
Neither is merely a compatibility default. Do not silently replace 7.1.5 with
Claude's suggested Windows 9.0.2 or claim Windows evidence covers Linux.

## 11. Current Result

Safe refusal established; no new trim capability enabled. Private evidence:
`workbench-flac-calibration-1.txt`, `workbench-flac-duration-diagnostic.json`, and
ignored calibration directory `flac-calibration-x0HLwg` with its complete collector
receipt. Source, telemetry and unpublished output are preserved.

## 12. Recommended Next Step

Complete the small read-only runtime-cause investigation; select an explicit
qualification strategy before more media runs. Independent useful UI/ordinary-CPU
work may continue. Preserve Gauge's both-theme visual owner gate and HDR deferral.

Subsequent result: the explicitly separate corrected runtime passed bounded
calibration. See [candidate checkpoint](RUNTIME_CANDIDATE_CHECKPOINT.md). The
original 7.1.5 refusal remains valid; the workbench has not switched runtime.
