# Field source identity investigation — September 23, 2026

## Finding and limit

The exact failed job is retained in portable log ca0be904-9149-422d-9312-424f0af875a1.json: 2026-09-17 13-10-30.mkv, HEVC NVIDIA Archive Quality CQ32, failed with the generic post-encode identity refusal. The later CPU batch lists this source as unprocessed; it is not a successful counterexample.

Two retained provenance intents and two inspection-cache records for this exact source contain matching paired identities. All four embedded checksums verify. The earlier and later retained identities differ ONLY in ctimeNs; the current read-only sparse identity equals the later identity in every field. This corroborates a ctime-only event. It cannot establish the exact failure-time comparison, because the old result log did not preserve that comparison, nor prove why ctime changed. No historical full-file hash or change journal was captured. No claim that the personal media is byte-identical, modified, or safely re-encodable follows from these samples alone.

| Field | Earlier intent | Later intent and current sample |
|---|---|---|
| canonicalPath | F:\shadow play\OBS\2026-09-17 13-10-30.mkv | F:\shadow play\OBS\2026-09-17 13-10-30.mkv |
| dev | 233114340 | 233114340 |
| ino | 1688849860278712 | 1688849860278712 |
| size | 49516727408 | 49516727408 |
| mtimeNs | 1789652631889540800 | 1789652631889540800 |
| ctimeNs | 1789652631889540800 | 1789933469964962700 |
| birthtimeNs | 1789639830364247800 | 1789639830364247800 |
| sparseDigest | sha256-sparse-v1:a608e1a15b261059fbd6ad9f34f31b61808de4292116b46b974d378d424ef402 | sha256-sparse-v1:a608e1a15b261059fbd6ad9f34f31b61808de4292116b46b974d378d424ef402 |

Earlier ctime (UTC, millisecond display): 2026-09-17T13:43:51.889Z. Later ctime: 2026-09-20T19:44:29.964Z. Precise original nanosecond strings above remain authoritative.

Earlier intent d56f146c-1ea6-48ac-9aa2-e03b771340cb was created 2026-09-20T19:42:50.046Z. Later intent 931e3c9d-2d7c-4a87-98d9-46cb1bbfe016 was created 2026-09-21T01:49:09.469Z. These timestamps locate the saved observations, not the missing exact post-encode identity.

## Owned-fixture evidence and decision

An actual 4 MiB project-owned fixture changed only ctimeNs when its read-only attribute was toggled using fs.chmod. Its whole-file SHA-256 stayed bce1be3c908a66e4ef845efaf81763bb1549f635ca4e9f212ab3026562c3c810 before, during, and after the attribute change. This proves an incidental filesystem operation can produce this signature on this machine. It does not identify the historical operation.

The existing precise fixture and new service regression also demonstrate the unsafe lookalike: a same-size byte edit outside all three sparse windows followed by restoring mtime leaves dev/ino, size, mtime, birthtime, path and sparseDigest stable, with only ctime different. Therefore ignoring ctime would admit a true content edit. Strict sameStamp/sameIdentity behavior, cache identity, provenance binding, temporary authorization, publication, and cleanup policies remain unchanged. No policy narrowing is justified by available evidence.

## Local correction

- Source identity mismatches now name changed fields and store exact expected/actual values, comparison type, and checkpoint. Path resolution, path-to-handle, handle-before/after-sampling, and handle-to-path stages are distinguished.
- Main-owned per-item results and terminal JSON logs preserve this bounded diagnostic. Failed identity reads record their error code and actual:null instead of fabricating a delta.
- Post-encode ctime-only refusal says source identity changed and that matching sparse samples cannot establish unchanged full content. It tells the user to prepare the source again, without claiming bytes definitely changed.
- Preparation and pre-encode checks also use the same diagnostic helper. No full-file hashing or extra source reads were added to production.

## Validation

node --test tests/source-identity.test.cjs tests/encoder-service.test.cjs: 51 passed, 0 failed, 0 skipped. Covers every compared field, ctime-only harmless attributes versus unsampled true edits, path/handle mismatch, short bounded reads, cancellation, missing/deleted inputs, no-overwrite publication, same-folder protection, owned-partial cleanup, and temporary re-encode authorization invalidation. The new service test verifies exact diagnostics survive the actual terminal log serialization and remain under 4 KiB for its fixture. git diff --check passed. Detailed command/count/source hashes are in validation.json.

Media child work is injected in service tests. Native application/real encoder acceptance is intentionally delegated to the parent. Personal source sampling was read-only and bounded to three 256 KiB windows per identity read; no personal file was changed and no long encode was run.

## Artifacts

- evidence.json: selected exact log entries, settings/status, retained identity values, verified checksums, file SHA-256 values and current bounded identity.
- attribute-fixture.json: actual attribute-only observation and full-file hashes.
- validation.json: focused test command, counts, limits, and tested source hashes.
- owned-attribute-fixture.bin: isolated 4 MiB fixture retained under this project-owned artifact directory.

Parent must integrate this finding/limit and evidence link into durable living documentation before milestone completion. No commit or package was produced by this subtask.
