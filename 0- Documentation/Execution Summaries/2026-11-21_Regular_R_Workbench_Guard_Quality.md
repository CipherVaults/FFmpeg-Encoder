# Regular v0.7 R: vendor label guard and effective-recipe evidence

November 21, 2026 Cairo. **Test-only scope.** R02/R04/R05 remain partial. No product code, Linux source pins, package contents, compatibility behavior or workflow authority changed.

**Recovered negative.** The old “vendor-only starting values” mutant expects an entire assignment that no longer exists after fixed Candidate settings got an independent branch. It fails at a missing target rather than exercising the semantic assertion. The new matcher must still find exactly one instance but changes only the vendor-vs-ordinary expression; the outer Candidate settings branch remains intact. The mutated renderer is an in-memory test string. It must make an ordinary profile show “Starting values” when the unchanged guard expects “Tested Default”; the clean renderer control and unchanged disk hashes still have to pass. Other mutations retain their original oracle.

**Concrete adjacent gap.** The old busy-service fixture selected only one file. The strengthened test holds an injected first invocation and checks a separate waiting file before saving new app defaults. It verifies the saving really took effect for future plans, the same current queue still carries the earlier policy for both entries, and an attempted edit of a pending file is refused while busy. Once released, each invocation must match its prepared arguments except the assigned staging path. The prepared/actual details and each redacted invocation preview reflect the recipe used; paths remain aliases and raw source/staging names are absent. This is not an unrestricted recipe download. Existing layer-specific tests cover app/batch/file precedence, the displayed origin summary, explicit adoption/reset, settings persistence and refusal, and navigation without job mutation.

**Exact evidence.** Base original `d7011eb9186d26a3f4f2bf9b7e87a9c1f92c47b9`, tree `ce86c49e7389cb7a5849af7d029210716ef8ec0a`. The test patch SHA-256 is `7bd2f2fabfaa3016cf4412fd1e4d09bab1d4e9928eef12d289904f804734ce2b`, cold test tree `34461a1a2e2822681e134e28821872dede2ee92e` (not an integrated commit). The only changed test paths are `tests/ui-vendor.test.cjs` and `tests/encoder-service.test.cjs`.

| Exact receipt | Scope/result |
| --- | --- |
| `20261121T004031Z_r-vendor-guard-red-129` | Original vendor suite: 21 pass, 1 fail, 0 skip; exit 1 at obsolete singleton mutation precondition. |
| `20261121T004231Z_r-workbench-guard-green-129-r01` | 295 pass, 0 fail, 0 skip; exit 0. Vendor, UI workbench, App Settings, operation draft, EncoderService, diagnostics and media source suites. |
| `20261121T004302Z_r-workbench-guard-cold-129-r01` | Same scope and counts after cold application, exit 0. This overlaps the author run; do not sum. |

**Limits and integration.** These are Node 24.22.3 controlled DOM, service/runner and owned small-file tests on cloud Linux. No real FFmpeg, live adapter, desktop, owner PC, package, remote change or acceptance. The hosted Linux/Windows source checks already recorded for checkpoint 129 are not fresh results for this candidate. Blue owns independent review, compare-before-integrate, final hash/test readback and ordered checkpoint; preserve the failed receipt and leave existing native/R/Alpha/S boundaries intact.
