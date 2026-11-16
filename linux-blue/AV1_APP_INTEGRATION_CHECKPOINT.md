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

## Qualified composition, before main-route activation

The class is now used by a separate `createQualifiedAv1WorkbenchService` factory.
The original ordinary factory remains available for regression and rollback.
The final explicit main-route selection is described below.
The new factory lazily constructs fixed, independently accepted calibration and
actual-service controls for three disjoint H265 CPU slow25 FLAC families: Keep
Source range, 1080p-to-720p range and 1080p-to-720p true Full. It retains the fixed
AV1-capable runtime and ordinary runner; qualified calls use the separate private
observer/proportional runner already supported by the shared EncoderService.
No argv heuristic, fallback authority, renderer receipt injection or fake executor
is introduced. Full calibration/service hashes are exact; missing or changed
receipts fail closed rather than silently starting an ordinary-only app.

The Full service proof `full-resize-service-pgkknH` was independently accepted at
SHA256 `77e03609a3806ce1f3d7d8041791ae82f07043f3c9dcd0b5ebe854742da49a9b`.
Positive real-factory construction passed without media children. A fresh-module
pending Full fixture still verifies refusal before any receipt, runtime or storage
read. Focused security-by-design review is documented in
[the bounded manual review](AV1_APP_SECURITY_REVIEW.md), with exact source hashes
and explicit limitations, not whole-repository or native security certification.

## Composed proof: failure retained and boundary corrected

First campaign `qualified-app-service-4IU3Nb` failed before its first successful
case. Receipt SHA256:
`0a83d82c97bf7518769b4ace1a88a6389aaab16876cec822f4cefcfbc4f77b89`.
All 37 children closed, maximum one, zero live. Ordinary default H264 encoding of
the stereo-PCM MOV fixture to Matroska lost declared audio channel-layout metadata.
The unchanged output contract correctly refused `INVALID_OUTPUT` with
`audio channel_layout changed`. It did not publish an accepted output.

That ordinary MOV stereo-PCM conversion remains unsupported in this composition.
It is not relabeled a successful conversion or fixed by weakening preservation.
The corrected harness explicitly repeats it as a negative regression, requiring
the exact refusal, no output action token and no destination file. Ordinary success
uses the exact previously accepted 0.4-second FFV1/PCM Matroska fixture; its small
scope proves route integration, not broad ordinary-media compatibility. The mixed
batch contains that ordinary Matroska file and a distinct qualified MOV input.
Changed-family MOV clocks, audio tails and expected counts remain unchanged.
Independent review accepted this harness-only correction before a fresh campaign.
The new focused pre-campaign aggregate passed 51/51, no failures or skips.

## Fresh composed-service settlement

`qualified-app-service-j5kQ15/report.json` passed all 17 cases. Exact SHA256:
`a422fffa11aaed193ff0e7624fd06d8df76103c3f1d861cb2fb5bce671b23728`.
All 28 frozen source/test files matched both SHA256 and Git blob after settlement.
The persisted metrics record exit 0, 212.565 seconds and waited-child high-water
514,640 KiB, not a simultaneous process sum or product memory guarantee. A transient
execution-transport disconnect lost the streaming handle; the final persisted
report and metrics were recovered without restarting or duplicating the campaign.

- Original MOV channel-layout loss was explicitly refused with no accepted output.
- Ordinary H264, H265 and AV1 passed using the bounded Matroska fixture.
- Keep Source and 1080p-to-720p range outputs each retained 93 frames and 149,184
  samples with exact PCM; true Full resize retained 180 frames and 293,616 samples,
  preserving the 6.117-second audio tail beyond the 6-second video.
- A real mixed H265 batch published both an ordinary item and qualified range item.
- Forged family, forged runtime and stale family selections refused the whole batch
  without starting children or mutating ready items; unsupported settings refused.
- Live encode cancellation at frame 3, not ended, and live source-evidence
  cancellation after 350 bytes each settled without accepted publication. Fresh
  Full success after each retained 180 frames and 293,616 samples with exact PCM.
- Existing-output collision preserved the sentinel; all source hashes and identities
  remained unchanged. Successful outputs decoded and passed provenance/codec checks.

The campaign used the actual qualified factory, no fake executor or injected
qualifications. Census: **218 spawned / 218 closed**, maximum one, zero live;
25 children used progress-bearing encode arguments, including capability probes.
No failure or closureFailure was recorded. Source-derived limits, correlated
evidence-stage accounting, telemetry caps and storage settlement were checked,
not independently recomputed final whole-job totals or every overflow edge.
Output access proves token issuance only; no desktop application was opened.
This is composed service evidence, not a native renderer/IPC journey, perceptual
quality proof or broad ordinary-media qualification.

Independent terminal review verified the receipt, all 28 frozen source identities,
source hashes and lifecycle outcomes. The explicit `--blue-runtime=9.0.2-av1`
main route now selects this qualified factory. The default baseline factory is
unchanged and does not import optional controls through that selection. Title and
readiness status now disclose qualified per-file range/resize eligibility instead
of saying trim is unavailable. Remux stays unavailable on this runtime.

Post-wiring focused checks passed **52/52**. They cover baseline lazy selection,
exact AV1 factory choice, truthful mode/family status, existing security/closure
hooks, real qualified construction and durable pending refusal. The media campaign
preceded this small entry wiring: factory and admission executable bodies are
byte-for-byte unchanged after reversing only their updated comments; their tests
changed for the new entry choice. This does not substitute for a native launch.
Original UI/Gauge, IPC/preload, baseline and Windows entry bytes were not changed.
Native launch remains a separate socket-restricted gate; no bypass was attempted.
No Linux 0.7, Windows/GPU, packaging or release acceptance is claimed.

Source recovery remains incomplete. The previous exact35-file submission from
immutable23144377 was interrupted without a result. Read-only deterministic
reconciliation reproduced its base tree but GitHub could not retrieve the
expected resulting tree5a61c2b70f6accc89cc064785394ee5a0595f5c0. No retry or ref
update was issued for that scope; partial unattached objects cannot be excluded.
This admission module depends on the current shared selector/evidence/resource
implementation, including still-local changes. Publishing these eligible Linux
files is useful source backup, not a runnable fresh clone or permission to
reconstruct/reupload uncertain material through another route.
