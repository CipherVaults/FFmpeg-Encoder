# AV1 workbench integration: whole-batch admission seam

This is an integration source checkpoint, not application activation. The actual
shared `EncoderService` remains the only encoder. The default baseline factory,
original UI/Gauge, runtime selection, ordinary settings and Windows project are
unchanged.

The original ordinary workbench-entry predicate was extracted without changing
its logic. The new `Av1WorkbenchAdmissionService` preflights every selected entry
before superclass mutation. It accepts existing ordinary CPU Full/Keep/copy SDR
entries or genuinely current proportional H265 CPU slow25 precision-FLAC entries.
The latter require real private selector tokens and observer snapshots bound to
the actual plan, source fingerprint, settings, runtime, budget and deadline.
It does not manufacture qualifications or create runtimes. Same-folder, omissions,
GPU/HDR, Remux, native and preservation overrides remain excluded. Invalid/stale
selection handling still belongs to the superclass and cannot begin execution.

Independent review found no material guard regression or mixed-batch partial-start
hole. The 39-test baseline/admission/runtime aggregate passed. Tests create genuine
observer/selector tokens but mock execution, so this proves admission and state
transitions, not integrated media execution or publication. Snapshot validation
is not represented as a fresh binary check; the shared execution path still
performs asynchronous runtime and source currentness checks.

The class is deliberately not imported by the AV1 factory or main entry yet.
Next compose the exact reviewed runtime observer and three disjoint qualified
families from independently accepted calibration and service receipts, then wire
the existing AV1 factory. Full-file evidence is still in progress and cannot be
activated while its receipt is pending. The existing shared service already
routes qualified work through `operationRuntime.invoke` with positive remaining
budgets and streaming accounting, while ordinary jobs retain their separate
30-minute runner. No argv heuristic or fallback runner is necessary.

Before app integration is accepted, prove ordinary H264/H265/AV1, each qualified
family, one valid mixed H265 batch, whole-batch unsupported/stale refusal,
collisions, active cancellation/recovery and output access through the composed
service. Native launch remains a separate socket-restricted gate. No Linux0.7,
Windows/GPU, packaging or release acceptance is claimed.

Source recovery remains incomplete. The previous exact35-file submission from
immutable23144377 was interrupted without a result. Read-only deterministic
reconciliation reproduced its base tree but GitHub could not retrieve the
expected resulting tree5a61c2b70f6accc89cc064785394ee5a0595f5c0. No retry or ref
update was issued for that scope; partial unattached objects cannot be excluded.
This admission module depends on the current shared selector/evidence/resource
implementation, including still-local changes. Publishing these eligible Linux
files is useful source backup, not a runnable fresh clone or permission to
reconstruct/reupload uncertain material through another route.
