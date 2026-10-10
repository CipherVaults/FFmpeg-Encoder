# Phase 1 — Ahmed's visual review

Calibration is complete and the next benchmark stage waits for your judgment. Application0.6 remains unchanged. There are six12-second scenes,43 motion clips and129 matched native stills; candidates are randomized separately per scene. The captured source and actual x265 Slow/CRF25 reference are named.

Open [the review guide](../../artifacts/phase1-2026-10-10/calibration-review-0d206bb1-df49-4ce4-9961-647827959c6d/review-guide.html), then [the matched-still viewer](../../artifacts/phase1-2026-10-10/calibration-review-0d206bb1-df49-4ce4-9961-647827959c6d/index.html). If your Markdown viewer does not resolve the relative link, use this folder directly:

`D:\Codex Projects\FFmpeg Encoder\artifacts\phase1-2026-10-10\calibration-review-0d206bb1-df49-4ce4-9961-647827959c6d`

1. Start with Crimson Desert, Expedition33 and Forza, then check native1440 ACC, Desktop and Starfield. At the same frame/scroll position, compare source → x265 → candidates. Fit view scales images; native100% is preferable for fine detail, subject to Windows/browser display scaling.
2. Open each `scene-*.m3u` in existing MPC-HC to compare motion. Inspect foliage/texture, shimmer, particles, dark surfaces, text and gradients. The clips have no audio. Stills alone can miss temporal damage.
3. Reply with scene, preferred candidate label(s), whether close enough to x265 for your archive, and any visible objection. “Borderline” and “none close enough” are useful. Candidate A in one scene does not identify Candidate A elsewhere.
4. Keep `reveal-key.json` separate until your initial blind preference pass. We then combine your judgments with measured size/speed to choose and freeze a manageable finalist set before opening held-outs. No application setting changes automatically.

Plain text is enough. If using feedback.csv, edit a copy as my-feedback.csv; preserve the original hashed template. Budget about20–30minutes for a first pass, revisiting only meaningful differences.

Example reply:

> Crimson Desert: Candidate C is close enough; Candidate A loses moving grass detail. Expedition33: B or D, borderline in particles. Forza: E preferred; F shimmers. ACC/Desktop/Starfield: [your observations].

Those are illustrative labels only. They do not reveal any actual preference or recipe mapping.

Automated browser rendering was blocked by the tool's local-file URL policy. Native assets, exact frames, dimensions, color and hashes pass independent review; rendered interaction and subjective acceptance are still unverified. No workaround was used. The [execution report](Execution%20Summaries/2026-10-10_Phase1_Calibration_Review.md) records provenance, limitations, resource state and recovery. It contains unblinded research findings, so read it after the initial preference pass if you want to minimize expectation bias.
