# Execution record — Windows event-reader contract correction and release-source metadata

Final evidence cutoff: November 18, 2026 at 21:25:48.155624 UTC. The original code/test cutoff remains 21:24:30.101467 UTC; the later addition is data-only. Three reviewed source paths are integrated; four records are prepared outside main. Commit and preservation remain pending. The companion Session preserves the complete exact 068 predecessor byte-for-byte.

## 🤖 Models, Effort, Roles and Provenance
Blue owns final engineering acceptance. Separate workers observed hosted jobs and studied the source-reader boundary and release inputs. This writer records saved evidence outside main, without this writer executing the app or downloading source archives. A separate worker acquired the bounded data-only source archives recorded below. Independent source review, three-path integration and final focused tests are accepted; runtime model identity is not inferred.

## 🕒 Time
Checkpoint 068 final mirror release was recorded at 21:21:07.686035 UTC on November 18, 2026. Hosted observation was recorded at 21:21:33.515043 UTC. Original code/test cutoff is 21:24:30.101467 UTC. Final data-only evidence cutoff is 21:25:48.155624 UTC. The six archive acquisitions completed by 21:25:03.404638 UTC; no source or test result was reassigned to a later run.

## 🎯 Session Goal
Use the bounded Windows diagnostics to correct a concrete caller-contract defect without weakening the shared reader. Preserve exact prior state and improve the release-input evidence chain without confusing metadata authentication with binary reproducibility or redistribution readiness.

## 🛠️ Actions Taken
### Fully preserved base
Checkpoint 068 local `d6260eeeec3265380ddbbcc237e5ce5999d1c0d8`, tree `c1bcaaf4b1c3e0fee15903203fc239d02ff76046`, maps to remote `5885305e1eab44a32323e7b52bedc7b383a90f18`. Its 752 source files, 68 commits and native-readable records are preserved. The final Notion receipt is 203,223 bytes, SHA-256 `206edca5ed4dc9bdf245f87eb257ba8177d1206dffb2c07cc62461659372ba07`. Preserve the complete exact 068 Session suffix.

### Actual hosted 068 outcomes
Ordinary push attempt 1, shared run 44400362129, passed Linux job 135141394737 and Windows job 135141395373. Both checked 211 syntax files and passed 243 shared tests; Linux additionally passed 32. Zero failures/skips.

Windows package run 44400362116, job 135141394508, failed first preflight with invocation-owned phase `event-read`, code `ERR_ASSERTION`, capacity null. Event authority, Git source and capacity checks had not been reached. npm installation, package build and report upload were skipped; no artifact, app, media or GPU result exists. At observation time the assertion cause was unknown; keep that saved observation intact and record later source evidence separately.

### Source-proven caller mismatch and narrow successor
The actual shared `readBoundedJson` asserts its maximum must not exceed 1 MiB before opening a file. The Windows event caller supplied 2 MiB. A small valid ordinary JSON file reproduces this unconditional pre-open rejection; this is a caller-contract defect, not evidence the hosted event exceeded a size limit. The proposed fixed helper supplies the supported 1 MiB cap and feeds the existing authority check. The shared reader remains byte-identical; no limit is enlarged or guard bypassed.

The three-path proposal changes only the Windows wrapper, its policy tests and the workflow binding to the exact 068 remote parent. Author tests passed 24 with zero failures/skips. Real filesystem regression covers the old rejection, the actual new helper with authority, inclusive 1 MiB acceptance, one-byte-over rejection, malformed JSON, symlink/hardlink/directory refusal. Independent review is accepted, SHA-256 `439cda59f2391e9ad2b0dc4b67a3270e9dcfa9c1dba3317cd53bf38ddbbc1eeb`. The exact three paths are integrated. Lead rerun passed 24 focused tests, zero failures/skips; both changed JavaScript files parsed, and all 132 Linux source-plan rows remain unchanged. No fresh broad CI run is claimed; retain actual 068 hosted CI as prior unchanged-scope evidence. Actual hosted event contents and subsequent checks remain unverified; no successful successor job is claimed.

### Bounded release-input inventory
Read-only inspection verified packaged notices/provenance and retained binary development-package/static-library mappings. Existing FFmpeg 9.0.2 source archive and configuration/build evidence were found; signature evidence and its trust limits were retained. That existing archive is not a new acquisition in this metadata task. Exact x264, x265 and numactl corresponding source, Debian patches and binary build linkage were incomplete in the inspected roots. Seven host libraries remain unbundled; exact-host evidence does not establish portability. No legal clearance or public binary distribution follows.

### Signed Debian metadata chain
The pre-existing Debian archive keyring verified signed InRelease metadata, whose hashes authenticate Sources and the exact three downloaded .dsc files for x264 `2:0.164.3108+git31e19f9-2`, x265 `4.1-2` and numactl `2.0.19-1`. Matching upstream and Debian patch archive sizes/hashes are recorded for later bounded acquisition. The signed snapshot has no Valid-Until field, so newest-state freshness is not asserted. No key was imported or trust altered; original keyring installation provenance was not independently established.

Maintainer .dsc signature checks report NO_PUBKEY with the available archive keyring. Archive checksum authentication of those bytes is not independent verification of maintainer signatures. Exact binary Packages/buildinfo linkage remains unresolved, especially the x264 +b1 binary relationship. No source archives were downloaded or extracted in this step, and no installation, code execution, rebuild, runtime repin or distribution occurred. The earlier inventory’s absence finding remains historical; later metadata acquisition supplies .dsc files, not the missing source payloads.

### Completed data-only source acquisition
The later bounded acquisition completed all six upstream and Debian patch tarballs for the three source packages, totaling 2,332,490 bytes. Exact sizes and SHA-256 hashes match the signed archive-index references and were read back. The acquisition receipt SHA-256 is `76f8f8cdfcd4b94bd2476000a2064c8bb3151450e4980e8dabe5c484b617a329`; the companion owning receipt retains each public HTTPS URL, filename, version, size and hash for recovery without embedding archives or the raw Sources index. These are inert downloaded data only. No extraction, install, downloaded-code execution, rebuild, repin or key import occurred. Maintainer signature verification and exact retained binary buildinfo/reproducibility remain unresolved; no legal clearance, distribution or portability claim follows. Earlier inventory and metadata-only receipts retain their original narrower chronology.

The raw tarballs remain local only; this checkpoint records their recoverable public URL/hash/size inventory, not the archive bytes. The tarballs are not included in its Git, Notion or GitHub source/history archives.

### Native continuity
No new native attempt occurred. Retain the accepted 067 packaged-shell startup and sampled closure evidence, cancelled input picker, unchanged fixture and zero outputs. No Prepare, Apply, Start, encoding or publication is newly established.

## 🧠 Key Insights
A bounded phase diagnostic distinguished an early programming-contract error from a capacity or package failure. A metadata chain can authenticate source descriptors while leaving source payload acquisition, maintainer signatures, binary provenance and release readiness separate.

## 📌 Decisions Made
Fix the caller to the shared reader’s existing supported bound, not the reader to a larger value. Keep runtime and measured producer pins unchanged. Bind one reviewed ordinary successor push and do not rerun hosted work manually. Preserve evidence chronology and keep source-release study read-only apart from explicitly acquired metadata.

## ⚠️ Difficulties / Friction
Windows has not yet progressed beyond event-read. Its later host feasibility and actual event size remain unknown. Maintainer public keys and exact binary build records are unavailable in the inspected evidence. The native picker cancellation cause is still unproven.

## 🔧 Adjustments Made
Prepared a narrow source-contract correction and meaningful boundary regressions, plus an evidence-backed account of the Debian metadata chain. Four final records are prepared outside main; no authoritative edits or commit are made by this writer.

## ❌ Mistakes / Risks Noted
Do not interpret the 2 MiB argument failure as an oversized hosted event, claim metadata authenticity proves binary reproducibility, or call unchanged guard logic a security relaxation. Do not upload raw profiles, media metadata or desktop logs. Do not retcon earlier unknown hosted cause or missing-files inventory as though later findings were already known.

## 📍 Current Position
068 is fully preserved. Its shared CI passed; package preflight now exposes event-read/ERR_ASSERTION. Source inspection and actual-reader regression establish the fixed caller defect; review, integration and final main checks are accepted. Release metadata is authenticated within stated trust limits. Native publication and distribution are still pending.

## 🔜 Next Steps
1. Review these four records against final integration, tests and cutoff.
2. Apply only the released records, preserving the full exact 068 Session suffix.
3. Review/apply only four owning records; commit and verify Git → Notion → GitHub.
4. Observe only the admitted hosted successor and act on its actual next boundary.
5. Preserve the verified inert source payload inventory. Any extraction, build, distribution work or native retry requires its own bounded scope; do not infer those actions from acquisition success.

## ❓ Open Questions
Will the corrected event helper admit the real hosted event and reach later preflight checks? Which exact build records connect retained codec binaries to authenticated source versions? What remains for a portable release bundle and an actual native publication?

## 🧾 Session Outcome
Four records are prepared outside main: preserved base, actual hosted results, demonstrated contract defect, accepted integrated fix and bounded source metadata evidence are assembled against the final cutoff. The intended seven-path scope contains two new and five modified paths, yielding 754 tracked files if committed exactly. Checkpoint commit and preservation remain pending. No main write, staging, commit or runtime action occurred in this writing task.

## 🔍 Confidence Level
High for saved preservation and hosted results, and the reproducible pre-open caller mismatch. Metadata authentication is bounded to the existing keyring and signed archive snapshot. Source review and final integrated focused tests are accepted. Actual successor success, binary reproducibility, native publication, checkpoint preservation and release remain pending.
