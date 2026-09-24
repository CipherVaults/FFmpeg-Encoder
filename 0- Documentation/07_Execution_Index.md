# Execution summary index

Execution reports describe what Codex actually did, which checks passed or failed, and where work can resume. Keep one dated report per meaningful milestone, with routine retries in the same report. Completed reports retain their history; append a dated correction when needed rather than silently rewriting the record.

| Report | Outcome and checkpoint |
|---|---|
| [2026-09-06 — Preservation and legacy baseline](Execution%20Summaries/2026-09-06_preservation-and-baseline.md) | Verified full backup/working copy and source checkpoint `c30d335`; Sep7 continuation records 12 legacy characterization tests and successful real Electron/FFmpeg batch smoke. |
| [2026-09-07 — Documentation and version context](Execution%20Summaries/2026-09-07_documentation-bootstrap.md) | Project-specific agent guidance, active docs, exact historical archive, cumulative session history, complete amended plan; parent coordinates commit and manifest change. |
| [2026-09-07 — Runtime upgrades](Execution%20Summaries/2026-09-07_Runtime_Upgrades.md) | Independent Electron 44.2.0 (`0dd8542`) and FFmpeg/ffprobe 9.0.1 (`9c25694`) smoke checks passed; twelve standalone encoder cases passed. Parent synchronization completed after inspecting those reports and Git. |
| [2026-09-07 — Process architecture](Execution%20Summaries/2026-09-07_Process_Architecture.md) | Milestone F: main-owned queue and isolated UI; 87 checks and real encode/lifecycle evidence passed; parent synchronization complete. |
| [2026-09-07 — Local protocol](Execution%20Summaries/2026-09-07_Local_Protocol.md) | Milestone G: exact asset allowlist and CSP, 89 automated checks, native security and app flow pass; parent synchronization complete. |
| [2026-09-08 — Product acceptance](Execution%20Summaries/2026-09-08_Product_Acceptance.md) | H requirement map: actual six-profile endpoint, preservation/color/mixed outcomes, adopted settings, native picker and responsive evidence; checkpoint cbd548a. |
| [2026-09-08 — Portable acceptance](Execution%20Summaries/2026-09-08_Portable_Acceptance.md) | I complete: pinned portable ZIP, independent native acceptance, final synchronized docs and local-v0.5.0 checkpoint. Companion JSON preserves exact artifact/source hashes. |

The latest [Current State](01_Current_State.md) owns the overall status. A future report should identify its source commit or the commit that adds the report; avoid inventing a self-referential commit hash before a commit exists.

- [September9 — Inspection reuse](Execution%20Summaries/2026-09-09_Inspection_Reuse.md): J accepted: single-worker7ff4cce, two-worker4d4a81b,153 final tests, original60-file performance and59-file supplemental native UI; independent review and synchronized closure in this report.

- [September10 — Safe output beside originals](Execution%20Summaries/2026-09-10_Same_Folder.md): K accepted; provenance, atomic publication, guarded cleanup,209 tests and native endpoint/recovery evidence.

- [September20 — Amended L workflow](Execution%20Summaries/2026-09-20_Amended_L_Workflow.md): accepted preferences/compact preview, intentional generations, canonical argv/help and benchmark-selected Archive Quality;269 direct tests, native endpoints, independent closure and parent synchronization. M is covered by the September24 report.

- [September23 — M Field QA recovery history](Execution%20Summaries/2026-09-23_M_Field_QA.md): later packaged evidence recovered; field issues subsequently corrected/narrowed under the September24 acceptance map.

- September23 field diagnosis companions: [Phone metadata](Execution%20Summaries/2026-09-23_Phone_Metadata_Field_Diagnosis.md), [Source identity](Execution%20Summaries/2026-09-23_Source_Identity_Field_Diagnosis.md), and [compact evidence](Execution%20Summaries/2026-09-23_Field_Fix_Evidence.json). Source fixes pass280direct/nativefield checks; final disposition and281-current-tests are recorded in the September24 report.

- September24: [Field CQ decision17](17_Archive_Quality_Field_Decision.md) and [35-case evidence](Execution%20Summaries/2026-09-24_Field_Quality_Evidence.json); helperCQ29, field/nativeverified; portable closure is in the September24 report.

- [September24 — Field quality independent review](Execution%20Summaries/2026-09-24_Field_Quality_Independent_Review.md): audits35cases,51packetlists,26new metric records and9historical outputs; no blocking defect in the boundedCQ29 decision.

- [September24 — Portable0.6 acceptance](Execution%20Summaries/2026-09-24_Portable_0.6_Acceptance.md) and [compact evidence](Execution%20Summaries/2026-09-24_Portable_0.6_Evidence.json): source7b41c0f, freshZIP,20 packaged cases/four sessions,281direct/currentnative checks, accepted0.5 hash protection; final independent disposition and parent checkpoint are recorded there.
