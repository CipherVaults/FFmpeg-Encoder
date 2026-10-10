# Phase 1 calibration closure and human review gate — October 10, 2026

Human authority: Ahmed. Execution: Codex under the approved Phase1 handoff. The commit adding this report is the recovery checkpoint. This closes calibration evidence, not the benchmark Goal or a production recipe decision. Accepted local-v0.6.0 remains `be92b12205d299b6d3bdcc2fd4b2e3a02f928862`.

## Result and remaining boundary

The18-case comparability allocation is complete: four CD-B challenges, eight AV132 A comparisons and six AV132 B comparisons. Independent review reconciled44 metric seals,31,666 metric observations and12,956 packet/frame observations, exact production contributions/metric graphs, color/timing and quiet observers. Eight protected NEG results cover the new CD/Desktop comparisons. No held-out material was opened, and no finalist is frozen.

The calibration review bundle is `artifacts/phase1-2026-10-10/calibration-review-0d206bb1-df49-4ce4-9961-647827959c6d`. It contains37 measured configurations plus six lossless decoded-source clips:43 motion clips,129 native PNGs, six MPC playlists, a matched-frame HTML viewer, guide, blank feedback CSV, separate reveal key and manifest. Six source supports passed native frame/color/timestamp validation and exact decoded-pixel/order hash comparison. Still indices are119/359/599 for719-frame ACC/CD windows and120/360/600 for720-frame windows. Candidate labels are randomized independently per scene.

Manifest SHA256: `5bd8934b4dc7366b2787d5cfd8571133c047969fc4579bd1c95232167622f406`. All183 retained bundle files passed the finalized resume hash check without another encode. The reduced CD display omits near-duplicate lower-CQ challengers; all their research evidence remains in data. There are7/7/9/7/7/6 visible choices for ACC/E33/FH5/CD/Desktop/SF respectively, including named source/x265 anchors. No unmeasured SF-B SVT point is invented.

## Evidence and interpretation

| Measured comparison | Video payload / x265 | Regular VMAF difference | Limit |
|---|---:|---:|---|
| FH5-A ordinary AV132 |0.957|+0.185|Useful measured bracket; still needs human motion/texture judgment|
| FH5-A quality AV132 |0.949|−0.134|Modest recipe timing difference has only one observation|
| CD-A ordinary / quality AV132 |1.136 /1.222|+1.94 /+2.43|A result does not predict difficult B behavior|
| E33-A ordinary / quality AV132 |1.468 /1.571|+3.05 /+3.80|Larger than reference, not a universal size match|
| SF-A ordinary / quality AV132 |1.977 /2.071|+2.73 /+2.99|Size cost must remain visible|
| CD-B ordinary / quality AV132 |0.603 /0.607|−6.43 /−6.07|NEG corroborates a difficult-scene fidelity gap|
| Desktop-B ordinary / quality AV132 |1.054 /1.215|+0.355 /+0.558|Separate Desktop cohort; CQ36 alternatives are retained in data|
| SF-B ordinary / quality AV132 |1.669 /1.693|+2.90 /+2.99|Different quality/size region from x265|

CD-B HEVC25/29 is nearly flat in size and metrics; AV124/32 is similarly flat there. Distinct output paths/hashes, exact argv and raw CQ6400/7424/8192 logs exclude a simple swapped-result or missing-builder-control explanation. No explicit maxrate/bufsize/qmin/qmax is supplied, but logs do not prove the absence of internal driver/preset constraints. Report scene-dependent weak/plateaued response under this exact runtime. Do not claim CQ is ignored, a bitrate cap is proved, all hardware fidelity is exhausted, or any global configuration is perceptually equivalent. E33 HEVC also showed weak response in the earlier A block. Source captures are themselves compressed AV1; source-relative fidelity is not lossless game-render fidelity.

## Ordinary failure and recovery

The last SF-B ordinary32 encode1082 succeeded and passed native validation. Its metric stage encountered ENOENT when growth enumeration saw the atomic heartbeat temporary after it was renamed. The ledger closed honestly and no child remained. A focused regression now tolerates only ENOENT for the exact root-level `.active-time.json.UUID.tmp`; missing media/evidence/nested paths and other errors fail closed.

First recovery found a missing prior quality value serialized as undefined. It retained successful raw metric commands1088/1089. The corrected record uses null and only reuses a known successful exact-executable/argv command with retained logs/raw evidence. The raw traces are revalidated/sealed. SF-B recovery succeeded without another encode or metric invocation; its immutable recovery/analysis evidence remains. CSV now distinguishes current failure from historical prior failure/recovered timestamp. All45 focused checks pass at sequence1162. The actual pending-human guard also refused a refine request before locking/accounting/encoding; count139 remained unchanged.

## Resources and review limitations

Latest closed ledger: about9,797.679 active seconds (2h43m18s),139 actual encodes =117 content cases (20 initial timing-contaminated,97 quiet) +16 warm-ups +6 source supports. Subsequent focused checks add about2 seconds; read the live ledger for exact continuation. Growth25,327,175,112 bytes (about23.59GiB), free61,874,741,248 bytes (about57.63GiB), within55GiB growth and20GiB free floor. The same12h/340 limits persist; no reset or fresh allowance is inferred.

At latest forecast about33,403 seconds remained. Conservative one/two/three finalist capacity costs are26,937/30,650/34,246 seconds before any actual frozen-config overlap deduction. One/two fit; three currently does not. Original held-out lengths, protected pairs/Archive29, NEG, three timing repetitions and reporting remain reserved. Finalist capacity is conditional, not an instruction to pick the fastest family or consume every slot.

Automated rendered browser QA is **limited**: browser protocol policy rejected the local file URL. No workaround, alternate browser surface or security bypass was attempted. `ui-qa-c98492cb-2a1d-4044-b5ce-4a0cbd6b464a/result.json` records that limitation and active UI-session accounting. Static keyboard/presentation tests and actual native asset/hash/frame evidence pass; browser rendering/interactions and subjective visual acceptance are not claimed. Ahmed can open the local HTML during his review. No playback-compatibility acceptance or other-device claim is made yet.

## Human review and exact continuation

Open the local `review-guide.html`, then `index.html`; start with CD, E33 and FH5. Use native stills and the scene playlists in existing MPC-HC. Record scene, candidate label(s), whether close enough to x265, and meaningful texture/motion/text objections. “Borderline” or “none close enough” are valid. Labels differ by scene. Reply in text or edit a copy of feedback.csv, preserving the original hashed template. Keep the reveal key separate until the initial blind preference pass; then combine judgment with measured size/speed.

Future wakes inspect only Git/current continuation and live humanReview/ledger/command state. If no Ahmed judgment exists, wait; do not redo calibration/research/pack generation or run encodes. A runner guard blocks encode/search phases at this boundary. After his response, preserve the original bundle/judgment, map labels to exact recipes, resolve only genuine ambiguity and perform the measured frozen-config budget/overlap check. Freeze before opening held-outs. Continue protected held-out pairs, repeats, playback, data/report/charts, independent final review and parent synchronization. Human waiting time is separate from active machine time. The Goal remains incomplete; no new scheduler, production changes or0.7 work is authorized here.

Parent synchronization covers Current State, Roadmap, Continuation, Session Summary, Execution Index and protocol. App architecture/security/README/CHANGELOG remain unchanged because production behavior and accepted release artifacts did not change.

Independent `phase1_anchor_audit` bundle closure passes:37 measured cases plus six source supports bind to the correct source/window/run, canonical argv and output hashes. All4,318 decoded-source frame hashes,129 PNG dimensions/frame indices, per-scene randomization, reveal identities, playlists, feedback and HTML data agree. The manifest lists182 content files; state seals183 including the manifest itself. No held-outs, warm-ups or contaminated timings entered the pack. It is ready for Ahmed's subjective review, with rendered interaction still explicitly unverified. No finalist or final Goal acceptance follows from this review.
