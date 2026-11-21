# Regular Q: Cancel when a verified Remux copy is about to be saved

November 21, 2026 Cairo. First exercised on exact 132. Final exact base original `0782895e2c7c01eeca8509dd69e0b50457724656`, tree `56c40fdfe0e543a31d3830068af9a94822fce43c`. Test-only source change to `tests/remux-service.test.cjs`; no shipped code, product pin, route, fixture acquisition or release change.

| Controlled Cancel boundary | Required and observed |
| --- | --- |
| After native-structure and packet-identity checks, before attempted save | No destination created. Keep the same SHA-bound validated stage, grant no output action, and allow a new explicit Prepare. |
| After exclusive copy fallback writes a destination but before its independent readback finishes | Close held read; retain destination and matching validated stage; final destination status is unconfirmed, not saved. No output action. Fresh Prepare skips the existing destination and keeps its exact bytes. |
| After checked filesystem publication, before the final diagnostic append and visible Saved row | The item stays Saved and its destination keeps the sealed bytes. Only the genuinely checked output receives a valid reveal grant; the shell callback is simulated, and no OS action runs. One destination link after stage cleanup. Fresh Prepare skips rather than replacing it. |

The real shared main service, validator and output helpers operate on owned inert ISO atoms. Media runner/probe observations and filesystem fallback availability are injected. All cases check cancellation joins, source bytes remain untouched, old Start is refused, and fresh preparation does not silently overwrite anything. The overall cancelled batch does not retroactively undo a checked per-file save. No actual FFmpeg/native media, crash/power-loss durability, physical cross-volume, browser, Windows/Electron, reveal/open UI, hardware, package or release test.

**Exact runs:** cloud Linux Node 24.22.3. Focused three passed. Baseline `q133-remux-publication-baseline-r01` 450 pass, 0 fail, 1 archived observation skipped; candidate `q133-remux-publication-candidate-r01` 453 pass, 0 fail, same one skip. These overlap with the affected suites; no summation. The initial fixture mistakenly expected the processing item to say Running rather than Validating; retained and not counted as product failure.

**Next:** whole Q stays partial. Do not repeat known working short copy, VFR or in-flight Cancel merely to gain counts. Remaining real/native/owner gates retain their separate names in Current State and Continuation. No new route, R or release work follows.
