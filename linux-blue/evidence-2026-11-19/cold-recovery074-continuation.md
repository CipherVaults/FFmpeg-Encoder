## Recovery addendum — November 19, 2026

The cloud workspace unexpectedly changed around 00:12 UTC. This was a real interruption, not a deliberate wipeout drill. Checkpoint 074 was recovered from its named Notion source/history archives using existing account access. This demonstrates that recovery path, not independent-account disaster recovery.

### What survived and was independently checked

- Exact local commit `407d743f2c055acab47926d38aeac645a846100b`, tree `c072d9c0692acf5443a464902a7c7cd185b53f59`, complete 74-commit history and clean checkout.
- All 788 restored files match the source ZIP byte-for-byte, with exactly the same member set. Bundle verification and full Git integrity checks passed. All tracked modes are 100644; executable runtime modes are a separate concern.
- Source ZIP: 5,991,256 bytes, SHA-256 `458703a80fe99dfd70bb354c703eb7f0307c0022077c5bce5162f70d483f278c`. History bundle: 7,730,806 bytes, SHA-256 `3d6f3838ed014caf1d693ba7a416ca3507ffb0727806f271000c57ddc35b3553`.
- Full committed session history and the exact sanitized Windows 072/073 JSON reports survived. Those reports are not their original artifact ZIPs or the executable package ZIPs they describe. No released executable is inferred from source recovery.

Independent recovery receipt: `INDEPENDENT_RECOVERY074_RECEIPT.json`, 3,980 bytes, SHA-256 `2dd0e183efcc47ca230b7c3e39b5507264a17a6d278c8cce9b17e574d8d02b46`. This independently verifies the restored local archives; the lead performed their Notion retrieval.

### First safe continuation

Restored ordinary composition and renderer-double tests passed: 74 tests, zero failures, cancellations or skips; exit 0. Command: `node --test tests/linux-ordinary-service.test.cjs tests/ui-workbench.test.cjs`. These are code-only checks, not Electron, native GUI or media execution. Three source syntax checks also passed under Node v24.22.3. No aggregate or full runtime acceptance is inferred.

Receipt `FOCUSED_CONTINUATION.json` SHA-256 `552d4f7e9c33d7baeff5e85f566da477f06c68cfe31e799779f366e8dfd287b8`; raw stdout SHA-256 `200896dd60b3e98e37e33d098be42214cd218705884d8d136b90f7a1e47f8ade`; stderr empty. The saved receipt and raw summary were read and their hashes checked for this addendum.

### What is not recovered

Post-closure local 074 executable package, native preparation, fixtures and external raw experiment/audit receipts are not currently available in the restored source/history. Installed skills, runtime binaries/system dependencies, fixture bytes and actual runnable application continuation remain separate recovery tasks. Native 074 was never launched, according to the lead; no native outcome was lost or invented for that build. Earlier 073 results remain documented historical evidence, not a claim that their original runtime artifacts or external raw audits have been restored.

Before interruption, a single remux experiment was reported to have refused at collector entry with `REMUX_EVIDENCE_COST_APPROVAL`: an explicit evidence-acquisition budget was missing. Three reported children had closed; no qualification or publication was reported. The missing failed-attempt audit was reportedly 2,630 bytes with SHA-256 `17e9b12ef5ab82832b17779f762adfeb8608afc64f2c121143df46158aa9f592`. Its raw bytes are no longer accessible here. This is a continuity account from the pre-interruption report, not retrospective verification or a reconstructed replacement audit. Any successor must re-establish its real runtime, source and fixture identities rather than fabricate the missing receipt.

### Continuation lesson

Git → Notion → GitHub preserved committed code and history through an actual cold restore. It did not automatically preserve ignored runtime artifacts or external evidence. Retain this distinction in the next normal AI PBS handoff; deliberately preserve essential sanitized reports and recovery inventories, and verify the first runnable continuation separately. No mirror redesign, new checkpoint ceremony, skill activation or canonical source change is introduced by this addendum.

## Later evidence, kept separate from the cold-restore cutoff

Checkpoint074 full Notion and GitHub closure is recorded in `checkpoint074-durable-closure.json`; earlier pending-publication wording is superseded for source/history, not rewritten. The fresh runtime pair was subsequently rebuilt with new identities. Saved CPU and precision audits in this directory provide bounded fresh evidence, not inherited historical runtime qualification. The local runtime recovery archive has not been uploaded anywhere and is not an off-machine backup. No Library or alternate binary publication was performed. Original072/073 reports and their retention index remain untouched.
