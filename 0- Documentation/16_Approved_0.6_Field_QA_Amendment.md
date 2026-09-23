# 0.6 Field QA & M Recovery — September 23, 2026

Binding product-owner amendment. Human product authority: Ahmed. Mother Thread / strategic review: ChatGPT — Jerry. Execution surface: Codex autonomous execution. Retrieved in full September 23, 2026 from [Notion](https://app.notion.com/p/3e4bd7ade63b8105a644fc510dfa6c7b?pvs=204), page last edited 2026-09-23T05:23:48.867Z. The text below mirrors the complete page content; the final section records additional requirements from Ahmed's accompanying task message. This supersedes final M readiness and reopens CQ selection without erasing accepted J/K/L or historical Decision 15.

## Complete Notion content

**Purpose:** Ahmed-facing field-QA checkpoint after using the first unaccepted 0.6 portable candidate on real archive media. This page records real-world product feedback that arrived after Milestone L acceptance and after the first M ZIP was built.

**Date:** September 23, 2026

**Engineering source-of-truth snapshot reviewed:** Google Drive Current State / Continuation State / Execution Summaries synchronized through September 20, plus Ahmed's September 21 field screenshots and September 23 observations.

### Confirmed project position

- Milestone **L is accepted** at checkpoint `2f9d765`.
- L closure includes **269/269 direct tests**, original L native workflow, intentional generated-output re-encoding/cancel/restart/argv endpoint, Archive Quality UI, real rich 8/10-bit Archive Quality endpoints, and independent closure review.
- Archive Quality selection in Decision 15 became **HEVC NVENC P7 + UHQ + fullres + VBR-CQ32 + bf4 + B-ref each**.
- Milestone **M started** and produced a first 0.6 portable ZIP candidate.
- That ZIP is **not accepted as local-v0.6.0**. Runtime portable acceptance was still pending in the synchronized Continuation State.
- No final `local-v0.6.0` tag is justified yet.

First documented candidate:

- size: **321,229,721 bytes**
- SHA-256: `041a96338614cc19aeed69629e827d53329aed771413cd4c44df14e34c76fabf`
- build report: `out/portable-2026-09-20T13-45-32-392Z-mtZ8xU/build-report.json`

### New real-world field findings

#### 1. Samsung S21 FE / phone MP4 compatibility failure

Ahmed reports multiple completed phone recordings fail instead of encoding successfully.

Visible examples from the portable UI:

- `Screen_Recording_20260502_014538_Azahar.mp4`
- `Screen_Recording_20260502_021156_YouTube.mp4`

One expanded result shows:

- 1080 × 2340
- ~59.533 fps
- 8-bit
- one audio stream
- status **Failed**
- visible preservation diagnostic: stream-level `creation_time` metadata was not preserved across mapped streams.

**Current interpretation:** this is a field bug/compatibility gap to investigate, not yet a proven root cause. The `creation_time` preservation diagnostic is suspicious because Android/Samsung MP4 metadata may not map one-for-one into the Matroska output contract, but Codex must inspect actual logs, ffprobe structure and production validation before changing policy.

Desired outcome:

- ordinary completed phone recordings should encode when their actual audio/video/content are representable;
- important streams/metadata must not be silently lost;
- metadata that is genuinely container-specific/non-representable should be handled explicitly and honestly rather than turning otherwise valid media into an unexplained failure, if evidence supports that policy.

#### 2. False-looking “Input changed while it was being encoded” on a long completed OBS file

Visible example:

- `2026-09-17 13-10-30.mkv`
- 1920 × 1080
- 60 fps
- 8-bit
- duration ~3:33:21
- status **Failed**
- reason shown: **Input changed while it was being encoded.**

Ahmed states this was a completed recording from days earlier, not a live-growing recording.

The current app deliberately revalidates source identity before/after encoding using filesystem identity, size/timestamps and sparse content evidence. Therefore this error must **not** simply be disabled.

Codex should determine exactly which identity component changed:

- dev / file ID
- size
- mtime
- ctime
- birthtime
- sparse digest
- path/handle identity

If content truly changed, retain the fail-closed behavior. If only a non-content metadata field changed while reliable content identity remained stable, evaluate a narrower distinction between **content changed** and **filesystem metadata changed**, with regression evidence. Add a more useful diagnostic identifying which field caused refusal.

#### 3. Archive Quality CQ32 is visibly too aggressive for Ahmed's real archive preference

Ahmed's real-world result is roughly **~80% smaller than the original recording**, i.e. output around ~20% of original size.

Ahmed's desired practical range is closer to **~60–70% smaller than original**, i.e. output around ~30–40% of original size, while retaining visibly more texture/detail.

The September 20 benchmark selected CQ32 because three short 1080p60 clips landed at aggregate **+8.9% size versus the app's x265 Slow / CRF25 reference** and ~5.13× measured speed. Decision 15 explicitly warned that this was scene-specific, that one clip was +35%, town had lower metrics, and no subjective continuous-motion equivalence had been proven.

Field screenshots now show a meaningful perceptual gap in difficult foliage/grass:

- the CQ32 result loses fine grass/foliage microtexture;
- clumps merge/smear relative to the original;
- some fine crate/ground/vegetation detail is softened;
- text/HUD/coarse geometry remain comparatively intact.

This does **not** invalidate the recipe architecture. It invalidates treating CQ32 as sufficiently quality-oriented for Ahmed's actual preference without broader real-archive validation.

Next benchmark direction:

- use the actual completed source/output pairs read-only;
- retain x265 Slow / CRF25 as reference;
- start with **CQ31 and CQ30** around the same P7/UHQ/fullres recipe, with CQ29 only if evidence justifies it;
- prioritize difficult motion, foliage, grass, particles, dark areas, UI/text and high-detail surfaces;
- compare representative segments across several real recordings rather than only three short benchmark clips;
- use VMAF/SSIM as supporting evidence, not as the final subjective decision;
- target roughly 30–40% of original recording size across representative files where practical, but do not force a universal percentage at the expense of quality.

Note: moving from an output that is 20% of original to one that is 30–40% of original means roughly **1.5×–2× the current CQ32 output size**, even though it is still 60–70% smaller than the original.

### Recovery / engineering direction

Before further implementation, Codex should **Recovery-Reconcile live Git and artifacts first** because the synchronized Drive docs stop at “first M ZIP built; runtime acceptance pending,” while later local M work may exist undocumented.

Then:

1. preserve accepted J/K/L evidence unless a field bug specifically invalidates a claim;
2. treat the current 0.6 ZIP as a historical **candidate**, not accepted release;
3. reproduce and diagnose the phone-MP4 failure using logs + read-only fixtures;
4. reproduce and diagnose the long-file identity false-positive using exact identity deltas;
5. re-open only the Archive Quality **CQ selection** using broader real-world samples; keep the recipe structure unless evidence says otherwise;
6. add focused regressions/native evidence for every correction;
7. rebuild a **fresh** 0.6 portable candidate after production changes;
8. run the full remaining M packaged acceptance + independent requirement-to-evidence review;
9. synchronize documentation and only then create `local-v0.6.0`.

Personal recordings remain read-only. Use isolated project-owned copies/outputs for destructive or experimental steps. Do not broadly search unrelated personal folders, modify source media, weaken source-identity/provenance safety, or overwrite the accepted 0.5 artifact.

## Additional binding requirements from Ahmed's task message

- Reuse/realign the existing five-hour recurring continuation automation; no duplicates or automatic reset credits.
- Recover surviving M work/subagents/artifacts before replaying tests. Logs, exact ffprobe JSON, stream maps, FFmpeg stderr and output-validation evidence must support the phone diagnosis. Never broadly weaken preservation.
- If old logs lack identity values, state that limitation honestly; do not infer which historical field changed without evidence. Add field-specific diagnostics and focused regressions before changing identity policy.
- Use bounded representative segments across several completed real recordings, emphasizing foliage/grass, fine texture, movement, particles, dark scenes, UI/text and detailed surfaces. Retain exact production x265 options. Record original/x265/Archive filesize ratios and encode speed; VMAF/SSIM support original-size still/segment comparisons, not replace perceptual evidence.
- Any new CQ decision appends/supersedes Decision 15 transparently. Personal original and generated media remain read-only; isolated project-owned benchmark outputs only.
- Production or recipe changes invalidate the already-built candidate as the final artifact. After corrections: proportional direct/native evidence; affected intentional-reencode/provenance/cancellation/argv guarantees; fresh ZIP and complete extracted M contract; restricted-PATH/offline-process evidence; preferences/cache/provenance persistence; same-folder workflow; actual Blackwell Archive Quality; encode/skip/cancel/restart/shutdown; independent M review.
- Synchronize Current State, Continuation State, Roadmap, Technical/Security docs, README, CHANGELOG, Execution Index/Summary and superseding Archive decision. Preserve accepted 0.5 ZIP/tag. Only then tag `local-v0.6.0`.
- Ordinary recoverable engineering failures are not stop conditions. Existing human-approval boundaries, genuinely unsafe/unresolvable conditions or an unresolved product-direction decision remain boundaries.
