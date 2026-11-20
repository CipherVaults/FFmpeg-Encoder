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

### Separate changed-copy control (component-only)

The deliberately swapped synthetic pair is a **different study** from the two app-shaped positives above. The earlier fast packet collector actually rejected a compressed-packet size change before issuing complete evidence. The ordinary app never ran the bad pair. The question here is whether ordered decoded content also changed while the two track labels, sample rates, layouts and default flags stayed the same.

```sh
python3 -I -B scripts/qualification-tools/q-fast-oracle/check-swapped-component.py \
  --assay-root "$RETAINED_COMPONENT_ASSAY" \
  --output-oracle-root "$RETAINED_OUTPUT_ONLY_ORACLE"
```

The first directory contains the frozen original twin source, altered sample output, failed collector, six packet spools, and the earlier independent source decoder record. The second holds the separately reviewed output-only read, fixed command evidence and four raw pipes. Missing/unbound material returns exit 2; the frozen expected observation returns 0, a comparable but unexpected result 1. The tool does not execute media, write files, recreate missing evidence or alter the normal-study counts.

The older source raw decoder pipes were not retained; its authenticated **complete** per-track and per-channel hashes, sample counts and picture-row digest were. New output PCM and frame rows can be re-read in full without replaying that source. The independent comparison checks both whole-track PCM and both channels of each ordered role before identifying a swap. A compressed-copy rejection and a decoded-content difference are reported as two separate observations. Different compressed packets alone do not diagnose a decoded mismatch or a false rejection.

Offline regression: `python3 -I -B tests/q-fast-component-swap.test.py`. With the original private recovery, set `Q_COMPONENT_ASSAY` and `Q_SWAPPED_OUTPUT_DECODE` to the first and second directory respectively for the real pair and withheld-output case; if not supplied the evidence-dependent test is explicitly skipped. `python3 -I -B scripts/qualification-tools/q-fast-oracle/swapped-fast-test.py` checks component isolation separately.
