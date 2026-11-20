# Does the fast copy checker agree with a complete decode?

A test-only, read-only comparison for Milestone Q (record 47 §11). The developer restores a reviewed evidence bundle, then runs the command below. It neither launches FFmpeg nor accepts a caller-supplied verdict. No application, input routing, user-facing feature, package, or release imports these modules.

**Measured question:** Did the original fast checker accept an exact source/output pair whose *complete decoded pictures, audio and presentation timing* also match? Checks of container metadata, ordering outside the selected role, seeking and playback are separate. A fast refusal for those or for missing evidence, a failed run, stale selection, cancellation or unpublished stage is **not** a false media rejection.

## Run the frozen Linux 116 study

Use ordinary Python 3 on Linux. Do not optimize away assertions. The three directories can be restored elsewhere; they need not have their original absolute names. None of the historical paths in receipts is executed.

```sh
python3 -I -B scripts/qualification-tools/q-fast-oracle/check-sample.py \
  --fast-root "$NORMAL_QA_ROOT" \
  --source-decode-root "$SOURCE_PIPES" \
  --output-oracle-root "$OUTPUT_ORACLE"
```

- `NORMAL_QA_ROOT` contains the authenticated 116 binding, supervisor, original candidate runner and release record, plus `released-normal-116-residual-01/` with the original collector artifacts, source, published output and provenance records.
- `SOURCE_PIPES` contains the original `calls.json`, runtime observations, source media and raw source probe/frame/PCM pipes. `OUTPUT_ORACLE` contains the independent output `oracle-report.json` and all its original raw pipes. Missing inputs produce a non-comparable result, not a green test.
- The two predeclared positive pairs are the 720p mixed-rate mono/stereo pair and the 1080p twin-stereo pair. Both were generated for engineering study. They are **not** owner media.
- The third, deliberately crossed source/output uses genuine retained media from different cases. Its decoded result must differ. Its file identities must **not** join to a fast verdict on a different pair. It tests the decoder and comparison boundary, not whether the product actually refused a bad copy.

The command prints path-free JSON to stdout. Exit **0** means both frozen positive pairs agree and the cross-pair control behaves as expected; **1** means an evidenced disagreement or an unexpected comparable outcome for the declared cohort; **2** means incomplete or incomparable evidence, unavailable required controls, or invalid usage. No zero-error-rate, false-negative-rate or population-wide estimate follows from two positives. Different fast and decode implementations, byte-identical input/output roles, compatible runtime, ordered track coverage and correct method must all be established before comparison. See [how the independent decode is checked](decoded-witness.md).

## Adding a sample rather than reporting an unsupported conclusion

1. Before looking at the verdict, freeze the pair of entire-file hashes and sizes, runtime, intended ordered mapping, corpus scope, expected result, and a matched ordinary negative when available. Make media available only where authorized.
2. Preserve the fast checker's terminal collection, artifact identities and final-stage/publication bridge. A normal admission refusal or a hand-written success word is not a measured media decision. A real fast *rejection* needs an in-domain, specific decoded-media decision tied to these same bytes; otherwise report it as outside this comparison.
3. Retain a separately obtained complete decode of both files, not reused fast-checker packet hashes or a sampled beginning/end. Retain raw stdout/stderr, fixed argv, exit, runtime and exact audio/video mapping. Widen the finite profile through separate review for new shapes or clocks. A less strict tolerance cannot make a fixture pass.
4. Add an explicit corpus adapter and role validation with both ordinary accept and refuse tests. Do not accept a filesystem receipt as code or runtime authority. Keep `not-comparable` visible and keep failed historical samples. This tool currently supports only the reviewed two-AAC H.264/MP4 study, not every remux route.

Portable decision logic: `python3 -I -B tests/q-fast-check-sample.test.py`. Fast receipt tests: `python3 -I -B scripts/qualification-tools/q-fast-oracle/fast-witness-test.py`. Decode reader: `python3 -I -B tests/decoded-witness.test.py`, with the three documented fixture variables for the retained cases.
