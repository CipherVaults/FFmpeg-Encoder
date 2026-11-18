---
name: packaged-runtime-acceptance
description: Design or review a bounded packaged desktop-app integration test when launcher ownership, exact artifact identity, cleanup authority, and truthful hosted acceptance claims matter. Use for packaged runtime qualification or launch/cleanup failures, not ordinary source unit tests.
---

# Packaged runtime acceptance

Produce a small acceptance record tied to the exact built artifact and actual tested journey. Separate package construction, process ownership, observed behavior, and remaining platform qualification. Adapt existing test tooling instead of building another process framework.

## Before a run

Identify the source revision, package identities, launch entrypoint, owned state/fixture/output directories, allowed operation, time budget, and permitted retry scope. This skill does not authorize live execution, workflow dispatch, external upload, or termination.

Inspect the pinned launch library's implementation when its process semantics are uncertain. A returned child process may be a shell or helper rather than the app's main executable. Keep these identities separate; never normalize away a mismatch merely to pass an assertion.

For Windows shell-launcher details and an observed example, read [the case note](references/windows-shell-case.md). Do not transplant platform-specific guards to unrelated launch mechanisms.

## Establish ownership before granting cleanup authority

Keep observations separate from validated ownership. Rejected PID/path/ancestry observations must never become fallback termination targets.

Bind the launcher to the child actually created by this harness. Establish the main-process identity through app and OS observations, its relationship to the launcher, and expected executable path and bytes. Check stable identity, not PID alone. Refresh identity immediately before destructive cleanup; ordinary lookup/signal races remain a limitation.

Use normal close first within a finite budget. Forced cleanup, if authorized and needed, may target only a still-validated owned process or tree. If ownership cannot be established, stop escalating cleanup, report unresolved process state, and do not signal guessed identities.

## Exercise the artifact, not a substitute

Launch the built executable from the intended packaged layout, with isolated state and a working directory that exposes accidental source-tree dependencies. Verify packaged status and relevant security settings from the actual process. Do not relax security flags or modify the shipped app to make the test pass.

Use the smallest representative journey and owned inputs that test the intended boundary. Reuse existing validator evidence instead of adding redundant decode/probe passes. Include source preservation, output identity, and a relevant no-overwrite check when the product writes files.

Disclose substituted interactions precisely. A deterministic file-dialog return tests renderer → IPC → service integration, not native picker usability. Count startup capability attempts separately from requested operations; GPU discovery is not GPU qualification.

## Report what was observed

Tie the run, attempt, source revision, executable/package identities, and sanitized result together using saved receipts and hashes. For hosted runs, verify the downloaded report digest against artifact metadata/job logs where available. Report-only retention does not mean the executable was independently downloaded or rerun.

Preserve:
- Primary failure phase/code, even if cleanup later fails.
- Separate cleanup outcome and failure.
- Unknown/unobserved values as unknown, not zero.
- Sampled process observations as sampled, never exhaustive.
- “Source recheck not performed” separately from “source changed.”
- Actual security assertions and closure evidence as success requirements.

When source dependencies or package bytes change, keep historical evidence tied to its original identity and assess the affected retest scope. An unchanged numerical producer alone does not qualify the changed package.

End with the narrow acceptance claim and remaining boundary. One synthetic CPU journey is not broad media, native desktop, GPU, performance, distribution, or release acceptance. Retry only within authorized scope, preserving the first attempt and changing the smallest evidence-backed cause.
