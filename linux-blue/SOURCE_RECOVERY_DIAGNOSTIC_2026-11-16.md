# E0: exact remote source-recovery diagnostic

This is **not a Git clone, clean-room build, E0 recovery acceptance, or application execution proof**.

- Repository: CipherVaults/FFmpeg-Encoder-Blue-Linux
- Commit: `67a9aaaded07c82ce609691098a6f8314f381e92`
- Tree: `7abbd7fbbf514b502d13946d6ef4798a694ff74c`
- 121 remote text blobs exported via connected GitHub read-only API. Every byte verified with Git's SHA-1 blob header algorithm before testing and again after testing. Manifest preserves paths, modes, sizes and blob hashes. No active-workspace source, binaries, dependencies or receipts copied.
- Roots: workbench-main.cjs, preload.js, package.json, ui/index.html and six focused tests: runtime-av1, runtime-av1-operation, workbench-service, workbench-av1-service, workbench-av1-admission, workbench-qualified-encode-controls.
- Recursive literal relative `require` closure has no missing path. Shared encoder-service imports many dormant native/vendor/HDR/remux modules, hence the 121-file size. This is a literal dependency closure, not a claim that arbitrary dynamic reads are resolved.
- UI index.html, styles.css and renderer.js exported; these are the exact local-protocol allowlist. Main's PNG icon exists remotely (`6b34bc322e36dc460c52e8dd9b1b441a743e6b8a`, 2490 bytes) but the single GitHub fetch returned “only accepts UTF-8 text”. Icon was not exported; no alternate download attempted.
- Electron is the external app import. No node_modules installed. package.json retains original Windows main/start scripts. Explicit Linux main was not executed.

## Actual immutable source incompatibilities

1. `src/operation-family.cjs` exports only OperationFamilySelector, not the isProportionalFamilySelection imported by new admission. Its legacy family record requires budget/executionBudgetMs and excludes resourcePolicy; three new proportional family IDs are not implemented.
2. `src/operation-evidence.cjs` source-policy dispatch accepts only short-sdr-range-v1, short-sdr-range-flac-v1 and full-sdr-resize-copy-v1, not the three new proportional policies.
3. `src/encoder-service.cjs` operationCostLimits still gives proportional resources only to Remux; non-Remux returns legacy limits. The new resource planner itself is present with all three family constants/planners. Thus planner presence alone is not executable integration.
4. Exported observer SHA256 is `61cdd2ee05c0d2f4ca1284cc7aedc9b60955feb3f3e108e04265748a7200c34b`, while controls require `177f139bc1913051f9754673a21dd2ecb60f5dcba38f91785f84ab56d8159b1c`. Even supplying missing receipts would not satisfy observer integrity.

## Dynamic dependencies absent / deliberately not borrowed

The immutable remote tree contains none of these six required raw report paths under linux-blue/artifacts:
- long-range-calibration-sD4XVP/report.json
- resize-calibration-RQsj84/report.json
- full-resize-calibration-KKDQwg/report.json
- long-range-service-eQZdcB/report.json
- resize-service-BbTuXB/report.json
- full-resize-service-pgkknH/report.json

No raw calibration/qualification evidence, runtime binaries or codec libraries were copied or downloaded. AV1 runtime path resolution points OUTSIDE this export into the existing sibling runtime-candidates directory, and codec pins reference system libraries. Baseline uses system ffmpeg/ffprobe. Positive runtime verification/construction and all admission tests (whose suite-wide hook observes actual binaries) were intentionally not run. These paths were only computed as strings, not accessed. No media or child process spawned by app sources.

## Targeted tests and bounded refusal

- `node --test linux-blue/runtime-av1.test.cjs linux-blue/runtime-av1-operation.test.cjs linux-blue/workbench-service.test.cjs`: **33 passed**; injected verifier/executor tests and source assertions only. Log API_PURE_TESTS.txt.
- `node --test --test-name-pattern='pending Full|builder remains|new factory preserves|qualified wiring|main runtime selection' linux-blue/workbench-qualified-encode-controls.test.cjs linux-blue/workbench-av1-service.test.cjs`: **5 selected passed**; positive factory/proof tests deliberately excluded. Log API_GATED_TESTS.txt. The mock is only the enduring null/pending fixture, not manufactured successful evidence.
- API_STARTUP_DIAGNOSTIC.cjs guards promise filesystem reads to this export and forbids child-process APIs. Real qualified factory correctly refused ENOENT for its first missing long-range calibration report; zero children and zero external reads. Log API_STARTUP_DIAGNOSTIC.txt. No fallback or fake accepted proof.
- Six admission tests omitted as a group due their actual-binary suite hook. Original factory positive test, accepted-proof construction test and two raw-receipt validation tests also excluded.

Conclusion: remote text source can be exported and partially tested, but this exact snapshot is not self-contained or source-compatible for the activated qualified route. No blanket assertion about all 35 historical files is made. The specific source mismatches and missing assets above require separately authorized resolution; this diagnostic changes none of them.


## Remediation boundaries and next work

The source export is an immutable diagnostic, not a repaired checkout. Keep it
unchanged so future comparisons distinguish remote recovery from local development.
A supported Git authentication path is needed for the original fresh-clone gate;
do not borrow hidden credentials or report this API snapshot as Git history.

The four identified shared integration paths intersect earlier denied publication
manifests. The original 35-file submission remained frozen at local 23144377 and
returned no result before interruption. This diagnostic does not authorize another
submission, a differently named copy, reconstruction, alternative upload transport
or disabling an integrity check. Resolve publication through the supported normal
review process with explicit scope/result; then verify an independent remote copy.
Current newer local Full changes must not silently replace the original frozen
payload. Existing remote files can be read and compared without changing this gate.

Raw reports and runtime binaries were intentionally excluded from source commits.
A later independently reviewed provisioning/qualification distribution design must
supply legitimate exact dependencies without private raw diagnostics or silently
regenerating approval. Missing reports cannot be replaced with fabricated successful
JSON, and observer hashes must not be updated merely to match older remote code.
The single non-UTF8 icon-export refusal is a connector capability limitation, not
proof that GitHub lacks the asset. Obtain it only through a supported authorized
read route during a later complete recovery/package check.

Package and native gates remain independent: the existing Windows packager does
not include the Linux adapters, package.json retains its Windows main, and the
new runtime's native launch remains socket-restricted. Follow
[the shared-platform plan](SHARED_WINDOWS_LINUX_DEVELOPMENT_PLAN.md), not a platform
flag substitution or a sandbox/singleton bypass. Continue independent 1440p Full
implementation and proportionate tests locally without claiming the recovery gap
is closed or duplicating the uncertain upload.
